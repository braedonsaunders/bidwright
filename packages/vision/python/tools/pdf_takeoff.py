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


# Same density limits as page_reader layout analysis. Bound extraction as well
# as graph work: dense linework returns facts instead of a partial measured run.
MAX_PATHS = 2000
MAX_SEGMENTS = 10000
MAX_GRID_ENTRIES = 200000
MAX_CANDIDATES = 512
MAX_QUERY_WORK = 100000


class TooDense(Exception):
    pass


def segments(page):
    drawings = page.get_cdrawings()
    if len(drawings) > MAX_PATHS or sum(len(d["items"]) for d in drawings) > MAX_SEGMENTS:
        raise TooDense()
    result, seen = [], set()
    def add(a, b):
        a, b = fitz.Point(a) * page.rotation_matrix, fitz.Point(b) * page.rotation_matrix
        key = tuple(sorted(((round(a.x, 4), round(a.y, 4)), (round(b.x, 4), round(b.y, 4)))))
        if abs(a-b) > .01 and key not in seen:
            seen.add(key)
            result.append((a, b))
            if len(result) > MAX_SEGMENTS:
                raise TooDense()
    def curve(a, b, c, d, depth=0):
        if depth >= 10 or max(abs(b-project(b, a, d)), abs(c-project(c, a, d))) <= .25:
            add(a, d)
            return
        ab, bc, cd = (a+b)*.5, (b+c)*.5, (c+d)*.5
        abc, bcd = (ab+bc)*.5, (bc+cd)*.5
        mid = (abc+bcd)*.5
        curve(a, ab, abc, mid, depth+1)
        curve(mid, bcd, cd, d, depth+1)
    for drawing in drawings:
        for item in drawing["items"]:
            if item[0] == "l":
                add(item[1], item[2])
            elif item[0] == "re":
                r = fitz.Rect(item[1])
                for a, b in [(r.tl,r.tr),(r.tr,r.br),(r.br,r.bl),(r.bl,r.tl)]:
                    add(a,b)
            elif item[0] == "qu":
                q = fitz.Quad(item[1])
                for a,b in [(q.ul,q.ur),(q.ur,q.lr),(q.lr,q.ll),(q.ll,q.ul)]:
                    add(a,b)
            elif item[0] == "c":
                curve(*(fitz.Point(p) for p in item[1:5]))
    return result


def project(p, a, b):
    dx, dy = b.x-a.x, b.y-a.y
    norm = dx*dx+dy*dy
    if norm < 1e-12:
        return a
    t = max(0, min(1, ((p.x-a.x)*dx+(p.y-a.y)*dy)/norm))
    return fitz.Point(a.x+t*dx, a.y+t*dy)


def intersection(a, b, c, d):
    u, v = b-a, d-c
    den = u.x*v.y-u.y*v.x
    if abs(den) < 1e-9:
        return None
    w = c-a
    t, s = (w.x*v.y-w.y*v.x)/den, (w.x*u.y-w.y*u.x)/den
    return a+u*t if -1e-7 <= t <= 1+1e-7 and -1e-7 <= s <= 1+1e-7 else None


class SpatialGrid:
    def __init__(self, lines, cell=24):
        self.lines, self.cell, self.cells, self.line_cells, self.work = lines, cell, {}, [], 0
        entries = 0
        for i, (a,b) in enumerate(lines):
            steps = max(1, math.ceil(max(abs(b.x-a.x),abs(b.y-a.y))/cell*2))
            if steps > MAX_GRID_ENTRIES:
                raise TooDense()
            occupied = {(math.floor((a.x+(b.x-a.x)*t/steps)/cell),math.floor((a.y+(b.y-a.y)*t/steps)/cell)) for t in range(steps+1)}
            self.line_cells.append(occupied)
            for key in occupied:
                self.cells.setdefault(key, set()).add(i)
            entries += len(occupied)
            if entries > MAX_GRID_ENTRIES:
                raise TooDense()

    def query_cells(self, cells, tolerance):
        ids = set()
        radius = math.ceil(tolerance/self.cell)+1
        for x,y in cells:
            for dx in range(-radius,radius+1):
                for dy in range(-radius,radius+1):
                    ids.update(self.cells.get((x+dx,y+dy), ()))
                    if len(ids)>MAX_CANDIDATES:
                        raise TooDense()
        self.work += len(ids)
        if self.work > MAX_QUERY_WORK:
            raise TooDense()
        return ids

    def near(self, p, tolerance):
        ids = self.query_cells([(math.floor(p.x/self.cell),math.floor(p.y/self.cell))],tolerance)
        return [i for i in ids if abs(project(p,*self.lines[i])-p)<=tolerance]

    def along(self, i, tolerance):
        return self.query_cells(self.line_cells[i],tolerance)


def snap(points, lines, tolerance, grid):
    output, details = [], []
    for i, value in enumerate(points):
        p = fitz.Point(value["x"], value["y"])
        nearby = [lines[j] for j in grid.near(p,tolerance)]
        candidates = [project(p,a,b) for a,b in nearby]
        junctions = [q for line in nearby for q in line]
        for j,(a,b) in enumerate(nearby):
            for c,d in nearby[j+1:]:
                grid.work += 1
                if grid.work > MAX_QUERY_WORK:
                    raise TooDense()
                q = intersection(a,b,c,d)
                if q is not None:
                    junctions.append(q)
        junctions = [q for q in junctions if abs(q-p)<=tolerance]
        q = min(junctions or candidates,key=lambda q:abs(q-p),default=p)
        output.append(point(q))
        details.append({"vertex":i,"snapped":bool(candidates),"distance":abs(q-p)})
    return {"points":output,"snaps":details,"unsnappedVertices":[d["vertex"] for d in details if not d["snapped"]]}


def trace(seed, lines, tolerance, limit, grid):
    p = fitz.Point(seed["x"],seed["y"])
    candidates = grid.near(p,tolerance)
    if not candidates:
        return {"paths":[],"branchPoints":[],"crossings":[],"stopReasons":["seed_not_near_linework" if lines else "no_vectors"]}
    nearest = min(candidates,key=lambda i:abs(project(p,*lines[i])-p))
    pending, queued, visited, paths, junctions, crossings = [nearest], {nearest}, set(), [], {}, set()
    while pending and len(visited)<limit:
        i = pending.pop()
        visited.add(i)
        a,b = lines[i]
        cuts = [a,b]
        for j in grid.along(i,tolerance):
            if i==j:
                continue
            c,d = lines[j]
            # End-to-end contacts and T junctions connect. Interior/interior
            # crossings are reported but never expand the traced component.
            contacts = [v for v in (c,d) if abs(project(v,a,b)-v)<=tolerance]
            contacts += [v for v in (a,b) if abs(project(v,c,d)-v)<=tolerance]
            if contacts:
                if j not in queued:
                    pending.append(j)
                    queued.add(j)
                cuts.extend(project(v,a,b) for v in contacts)
            else:
                q = intersection(a,b,c,d)
                if q is not None:
                    crossings.add((round(q.x,4),round(q.y,4)))
        cuts.sort(key=lambda v:abs(v-a))
        unique = []
        for q in cuts:
            if not unique or abs(q-unique[-1])>.01:
                unique.append(q)
        for c,d in zip(unique,unique[1:]):
            paths.append([point(c),point(d)])
            for q in (c,d):
                key = (round(q.x,2),round(q.y,2))
                junctions[key] = junctions.get(key,0)+1
    return {"paths":paths,"branchPoints":[{"x":x,"y":y} for (x,y),degree in junctions.items() if degree>2],"crossings":[{"x":x,"y":y} for x,y in sorted(crossings)],"stopReasons":["segment_limit" if pending else "connected_component_exhausted"],"segmentCount":len(visited)}


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


def dimensions(page, lines, grid):
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
            for idx in grid.near(center,24):
                a,b = lines[idx]
                length = abs(a-b)
                if length < 12 or abs(project(center, a, b)-center) > 24:
                    continue
                # Require tick/arrow strokes at BOTH ends, not just nearby text.
                ends = [any(abs(project(end, c, d)-end) <= 2 and 1 < abs(c-d) < min(24, length*.4) and abs((b.x-a.x)*(d.y-c.y)-(b.y-a.y)*(d.x-c.x)) > length*.2 for c, d in (lines[idx] for idx in grid.near(end,2))) for end in (a, b)]
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


def source_point(value, request, page):
    p = fitz.Point(value["x"], value["y"])
    view = request.get("view") or {}
    if request.get("coordinateSpace") == "view-normalized":
        if not view or not (0 <= p.x <= 1 and 0 <= p.y <= 1):
            raise ValueError("View coordinates require a view and values in 0..1")
        rotation = view.get("rotation", 0)
        if rotation % 90:
            raise ValueError("Non-orthogonal views need PDF-point coordinates")
        b = view.get("bbox") or {"x": 0, "y": 0, "width": 1, "height": 1}
        if b.get("imageWidth") and b.get("imageHeight"):
            b = {"x": b["x"]/b["imageWidth"], "y": b["y"]/b["imageHeight"], "width": b["width"]/b["imageWidth"], "height": b["height"]/b["imageHeight"]}
        matrix = fitz.Matrix(rotation)
        display = page.rect * matrix
        p = fitz.Point(display.x0+(b["x"]+p.x*b["width"])*display.width, display.y0+(b["y"]+p.y*b["height"])*display.height) * ~matrix
    elif request.get("canvas"):
        canvas = request["canvas"]
        p = fitz.Point(p.x*page.rect.width/canvas["width"], p.y*page.rect.height/canvas["height"])
    if not math.isfinite(p.x) or not math.isfinite(p.y) or not (0 <= p.x <= page.rect.width and 0 <= p.y <= page.rect.height):
        raise ValueError("Coordinates outside PDF page")
    return point(p)


def run(request):
    with fitz.open(request["pdfPath"]) as doc:
        page = doc[int(request.get("pageNumber", 1))-1]
        size = {"width": page.rect.width, "height": page.rect.height}
        op = request.get("operation", "info")
        result = {"page": size, "coordinateSpace": "pdf-points", "facts": []}
        if "points" in request:
            request = {**request, "points": [source_point(p, request, page) for p in request["points"]]}
            result["points"] = request["points"]
        if "seed" in request:
            request = {**request, "seed": source_point(request["seed"], request, page)}
        if op == "info":
            return result
        if op == "overlay":
            from page_reader import _render
            region = request.get("region")
            if region:
                a = source_point(region, request, page)
                b = source_point({"x": region["x"]+region["width"], "y": region["y"]+region["height"]}, request, page)
                clip = fitz.Rect(min(a["x"],b["x"]),min(a["y"],b["y"]),max(a["x"],b["x"]),max(a["y"],b["y"]))
            else:
                clip = page.rect
            result["bbox"] = {"x":clip.x0/page.rect.width,"y":clip.y0/page.rect.height,"width":clip.width/page.rect.width,"height":clip.height/page.rect.height}
            edge = request.get("maxEdge", 1568)
            native, width, height, dpi = _render(page, clip, 0, edge, 300)
            for pickup in request.get("pickups", []):
                meta = pickup.get("metadata") or {}
                sx = page.rect.width/(meta.get("canvasWidth") or page.rect.width)
                sy = page.rect.height/(meta.get("canvasHeight") or page.rect.height)
                pts = [fitz.Point(p["x"]*sx, p["y"]*sy) * page.derotation_matrix for p in pickup["points"]]
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
        try:
            lines = segments(page)
            grid = SpatialGrid(lines)
            if not lines:
                result["facts"].append("no_vectors")
            if op == "snap":
                result.update(snap(request["points"], lines, request.get("tolerance", 3), grid))
            elif op == "trace":
                result.update(trace(request["seed"], lines, request.get("tolerance", 3), request.get("maxSegments", 1000), grid))
            elif op == "scale":
                result["dimensions"] = dimensions(page, lines, grid)
                result["text"] = page.get_text()
        except TooDense:
            result["facts"].append("too_dense")
            if op == "snap":
                result.update({"points": request["points"], "snaps": [], "unsnappedVertices": list(range(len(request["points"])))})
            elif op == "trace":
                result.update({"paths": [], "branchPoints": [], "crossings": [], "stopReasons": ["too_dense"]})
            elif op == "scale":
                result.update({"dimensions": {"candidates": [], "clusters": [], "facts": ["too_dense"]}, "text": page.get_text()})

        return result


if __name__ == "__main__":
    print(json.dumps(run(json.load(sys.stdin))))
