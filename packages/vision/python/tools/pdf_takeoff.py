"""Read-only PDF geometry in top-left page points, including intrinsic rotation."""
import base64
import json
import math
import re
import sys
try:
    import pymupdf as fitz
except ImportError:
    import fitz


def point(p):
    return {"x": p.x, "y": p.y}


def segments(page):
    result = []
    seen = set()
    def add(a, b):
        a, b = a * page.rotation_matrix, b * page.rotation_matrix
        key = tuple(sorted(((round(a.x, 4), round(a.y, 4)), (round(b.x, 4), round(b.y, 4)))))
        if abs(a - b) > 0.01 and key not in seen:
            seen.add(key)
            result.append((a, b))
    for drawing in page.get_drawings():
        for item in drawing["items"]:
            if item[0] == "l":
                add(item[1], item[2])
            elif item[0] == "re":
                r = item[1]
                for a, b in [(r.tl, r.tr), (r.tr, r.br), (r.br, r.bl), (r.bl, r.tl)]:
                    add(a, b)
            elif item[0] == "qu":
                q = item[1]
                for a, b in [(q.ul, q.ur), (q.ur, q.lr), (q.lr, q.ll), (q.ll, q.ul)]:
                    add(a, b)
            elif item[0] == "c":
                # Flatten cubic curves in native points, independently of render DPI.
                a, b, c, d = item[1:5]
                previous = a
                for i in range(1, 33):
                    t = i / 32
                    p = a * ((1-t)**3) + b * (3*(1-t)**2*t) + c * (3*(1-t)*t*t) + d * (t**3)
                    add(previous, p)
                    previous = p
    return result


def project(p, a, b):
    dx, dy = b.x-a.x, b.y-a.y
    t = max(0, min(1, ((p.x-a.x)*dx+(p.y-a.y)*dy)/(dx*dx+dy*dy)))
    return fitz.Point(a.x+t*dx, a.y+t*dy)


def intersection(a, b, c, d):
    u, v = b-a, d-c
    den = u.x*v.y-u.y*v.x
    if abs(den) < 1e-9:
        return None
    w = c-a
    t, s = (w.x*v.y-w.y*v.x)/den, (w.x*u.y-w.y*u.x)/den
    return a+u*t if -1e-7 <= t <= 1+1e-7 and -1e-7 <= s <= 1+1e-7 else None


def snap(points, lines, tolerance):
    output, details = [], []
    for i, value in enumerate(points):
        p = fitz.Point(value["x"], value["y"])
        nearby = [(a, b) for a, b in lines if abs(project(p, a, b)-p) <= tolerance]
        candidates = [project(p, a, b) for a, b in nearby]
        # Prefer a junction/endpoint when it is as close as the line projection.
        junctions = [q for line in nearby for q in line]
        for j, (a, b) in enumerate(nearby):
            for c, d in nearby[j+1:]:
                q = intersection(a, b, c, d)
                if q is not None:
                    junctions.append(q)
        junctions = [q for q in junctions if abs(q-p) <= tolerance]
        q = min(junctions or candidates, key=lambda q: abs(q-p), default=p)
        distance = abs(q-p)
        output.append(point(q))
        details.append({"vertex": i, "snapped": bool(candidates), "distance": distance})
    return {"points": output, "snaps": details, "unsnappedVertices": [d["vertex"] for d in details if not d["snapped"]]}


def trace(seed, lines, tolerance, limit):
    p = fitz.Point(seed["x"], seed["y"])
    if not lines:
        return {"paths": [], "branchPoints": [], "stopReasons": ["no_vectors"]}
    nearest = min(range(len(lines)), key=lambda i: abs(project(p, *lines[i])-p))
    if abs(project(p, *lines[nearest])-p) > tolerance:
        return {"paths": [], "branchPoints": [], "stopReasons": ["seed_not_near_linework"]}
    # Grow only the seed-connected component. Split visited edges at junctions,
    # including a branch that ends on the interior of another line.
    pending, visited, paths, junctions = [nearest], set(), [], {}
    while pending and len(visited) < limit:
        i = pending.pop()
        if i in visited:
            continue
        visited.add(i)
        a, b = lines[i]
        cuts = [a, b]
        for j, (c, d) in enumerate(lines):
            if i == j:
                continue
            q = intersection(a, b, c, d)
            contacts = [q] if q is not None else [v for v in (c, d) if abs(project(v, a, b)-v) <= tolerance]
            contacts += [v for v in (a, b) if abs(project(v, c, d)-v) <= tolerance]
            if contacts:
                if j not in visited:
                    pending.append(j)
                cuts.extend(project(v, a, b) for v in contacts)
        cuts.sort(key=lambda v: abs(v-a))
        unique = []
        for q in cuts:
            if not unique or abs(q-unique[-1]) > 0.01:
                unique.append(q)
        for c, d in zip(unique, unique[1:]):
            paths.append([point(c), point(d)])
            for q in (c, d):
                key = (round(q.x, 2), round(q.y, 2))
                junctions[key] = junctions.get(key, 0)+1
    return {"paths": paths, "branchPoints": [{"x": x, "y": y} for (x, y), degree in junctions.items() if degree > 2], "stopReasons": ["segment_limit" if pending else "connected_component_exhausted"], "segmentCount": len(visited)}


def dimension_meters(text):
    metric = re.fullmatch(r'\s*(\d+(?:\.\d+)?)\s*(mm|cm|m|ft|in|\x27|\x22)\s*', text, re.I)
    if metric:
        return float(metric[1]) * {"mm": .001, "cm": .01, "m": 1, "ft": .3048, "in": .0254, "'": .3048, '"': .0254}[metric[2].lower()]
    feet_inches = re.fullmatch(r'\s*(\d+)\s*\x27\s*-?\s*(\d+(?:\.\d+)?)?\s*(?:(\d+)/(\d+))?\s*"\s*', text)
    if feet_inches:
        feet, inches, numerator, denominator = feet_inches.groups()
        if denominator == "0":
            return None
        return .3048*float(feet)+.0254*(float(inches or 0)+(float(numerator)/float(denominator) if denominator else 0))
    return None


def dimensions(page, lines):
    candidates = []
    # Explicit units only. A bare number has no defensible unit conversion.
    for block in page.get_text("dict")["blocks"]:
        for line in block.get("lines", []):
            text = "".join(s["text"] for s in line["spans"])
            meters = dimension_meters(text)
            if meters is None:
                continue
            rect = fitz.Rect(line["bbox"]) * page.rotation_matrix
            center = (rect.tl+rect.br)*0.5
            eligible = []
            for a, b in lines:
                length = abs(a-b)
                if length < 12 or abs(project(center, a, b)-center) > 24:
                    continue
                # Require tick/arrow strokes at BOTH ends, not just nearby text.
                ends = [any(abs(project(end, c, d)-end) <= 2 and 1 < abs(c-d) < min(24, length*.4) and abs((b.x-a.x)*(d.y-c.y)-(b.y-a.y)*(d.x-c.x)) > length*.2 for c, d in lines) for end in (a, b)]
                if all(ends):
                    eligible.append((abs(project(center, a, b)-center), a, b))
            if eligible and meters > 0:
                _, a, b = min(eligible, key=lambda v: v[0])
                candidates.append({"text": text, "ratio": meters/(abs(a-b)*.0254/72), "line": [point(a), point(b)], "region": {"x": rect.x0, "y": rect.y0, "width": rect.width, "height": rect.height}})
    clusters = []
    for candidate in sorted(candidates, key=lambda c: c["ratio"]):
        cluster = next((c for c in clusters if abs(candidate["ratio"]/c[0]["ratio"]-1) < .05), None)
        if cluster is None:
            clusters.append([candidate])
        else:
            cluster.append(candidate)
    return {"candidates": candidates, "clusters": [{"ratio": sorted(c["ratio"] for c in group)[len(group)//2], "spread": max(c["ratio"] for c in group)-min(c["ratio"] for c in group), "count": len(group)} for group in clusters], "facts": ["multiple_dimension_scales"] if len(clusters) > 1 else []}


def run(request):
    with fitz.open(request["pdfPath"]) as doc:
        page = doc[int(request.get("pageNumber", 1))-1]
        size = {"width": page.rect.width, "height": page.rect.height}
        op = request.get("operation", "info")
        result = {"page": size, "coordinateSpace": "pdf-points", "facts": []}
        if op == "info":
            result["facts"] = [] if page.get_drawings() else ["no_vectors"]
            return result
        if op == "overlay":
            from page_reader import _render
            region = request.get("region")
            clip = fitz.Rect(region["x"], region["y"], region["x"]+region["width"], region["y"]+region["height"]) if region else page.rect
            edge = request.get("maxEdge", 1568)
            native, width, height, dpi = _render(page, clip, 0, edge, 300)
            for pickup in request.get("pickups", []):
                pts = [fitz.Point(p["x"], p["y"]) * page.derotation_matrix for p in pickup["points"]]
                if not pts:
                    continue
                if pickup["annotationType"] == "count":
                    for p in pts:
                        page.draw_circle(p, 3, color=(1, 0, 0), width=1)
                elif len(pts) > 1:
                    page.draw_polyline(pts, color=(1, 0, 0), width=1, closePath=pickup["annotationType"].startswith("area"))
                page.insert_text(pts[0], pickup["id"], fontsize=7, color=(1, 0, 0))
            overlay, _, _, _ = _render(page, clip, 0, edge, 300)
            return {**result, "nativeImage": "data:image/png;base64,"+base64.b64encode(native).decode(), "overlayImage": "data:image/png;base64,"+base64.b64encode(overlay).decode(), "width": width, "height": height, "dpi": dpi}
        lines = segments(page)
        if not lines:
            result["facts"].append("no_vectors")
        if op == "snap":
            result.update(snap(request["points"], lines, request.get("tolerance", 3)))
        elif op == "trace":
            result.update(trace(request["seed"], lines, request.get("tolerance", 3), request.get("maxSegments", 1000)))
        elif op == "scale":
            result["dimensions"] = dimensions(page, lines)
            result["text"] = page.get_text()
        return result


if __name__ == "__main__":
    print(json.dumps(run(json.load(sys.stdin))))
