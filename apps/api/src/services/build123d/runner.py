"""Full upstream CAD API executor. Always invoked inside an OS sandbox."""
import contextlib
from copy import deepcopy
import hashlib
import inspect
import io
import json
import math
import os
from pathlib import Path
import re
import resource
import sys
import traceback
import time


class QuietOutput(io.TextIOBase):
    def write(self, text):
        return len(text)

# Bound even the development/macOS path before loading native CAD libraries.
resource.setrlimit(resource.RLIMIT_CPU, (90, 90))
resource.setrlimit(resource.RLIMIT_FSIZE, (48 * 1024 * 1024, 48 * 1024 * 1024))
resource.setrlimit(resource.RLIMIT_NOFILE, (128, 128))
if sys.platform == "linux":
    resource.setrlimit(resource.RLIMIT_AS, (1536 * 1024 * 1024, 1536 * 1024 * 1024))

import build123d as cad
from PIL import Image, ImageDraw


def api_docs(query):
    """Inspect the installed version; no hand-maintained operation registry."""
    names = sorted(n for n in dir(cad) if not n.startswith("_"))
    result = {"version": cad.__version__, "symbols": names}
    query = query.strip()
    if not query:
        return result
    entries = []
    for token in re.split(r"[,\s]+", query):
        segments = token.removeprefix("build123d.").split(".")
        if not all(re.fullmatch(r"[A-Za-z][A-Za-z0-9_]*", s) for s in segments):
            continue
        obj = cad
        try:
            for segment in segments:
                obj = getattr(obj, segment)
            try:
                signature = str(inspect.signature(obj))
            except (ValueError, TypeError):
                signature = ""
            entry = {"symbol": token, "signature": signature,
                     "documentation": (inspect.getdoc(obj) or "")[:6500]}
            if inspect.isclass(obj):
                entry["members"] = [n for n in dir(obj) if not n.startswith("_")]
            entries.append(entry)
        except AttributeError:
            matches = [n for n in names if token.lower() in n.lower()]
            if not matches:
                matches = [n for n in names if token.lower() in (inspect.getdoc(getattr(cad, n)) or "").lower()]
            entries.append({"query": token, "matches": matches[:30]})
        if sum(len(json.dumps(e)) for e in entries) > 16000:
            break
    result["reference"] = entries
    return result


def render(parts):
    """Three measured orthographic views from the actual OCCT tessellation."""
    meshes = []
    total = 0
    colors = [(102, 155, 206), (219, 155, 81), (115, 183, 133), (185, 131, 196)]
    for index, shape in enumerate(parts):
        box = shape.bounding_box()
        tolerance = max(max(box.size) / 100, 0.15)
        vertices, faces = shape.tessellate(tolerance)
        if total + len(faces) > 50000:
            vertices, faces = shape.tessellate(max(tolerance * 5, 1))
        if total + len(faces) > 70000:
            continue
        total += len(faces)
        meshes.append(([(v.X, v.Y, v.Z) for v in vertices], faces, colors[index % len(colors)]))
    image = Image.new("RGB", (960, 360), (242, 245, 248))
    draw = ImageDraw.Draw(image)
    projections = [
        ("Isometric", lambda x, y, z: ((x - y) * .7071, (x + y) * .4082 - z * .8165, x + y + z)),
        ("Front (X/Z)", lambda x, y, z: (x, -z, -y)),
        ("Top (X/Y)", lambda x, y, z: (x, -y, z)),
    ]
    for view, (name, project) in enumerate(projections):
        triangles = []
        for vertices, faces, color in meshes:
            projected = [project(*v) for v in vertices]
            for face in faces:
                points = [projected[i] for i in face]
                triangles.append((sum(p[2] for p in points) / 3, points, color))
        if not triangles:
            continue
        points = [p for _, ps, _ in triangles for p in ps]
        xmin, xmax = min(p[0] for p in points), max(p[0] for p in points)
        ymin, ymax = min(p[1] for p in points), max(p[1] for p in points)
        scale = min(284 / max(xmax - xmin, 1e-6), 292 / max(ymax - ymin, 1e-6))
        for _, ps, color in sorted(triangles, key=lambda t: t[0]):
            polygon = [(view * 320 + 160 + (p[0] - (xmin + xmax) / 2) * scale,
                        194 + (p[1] - (ymin + ymax) / 2) * scale) for p in ps]
            draw.polygon(polygon, fill=color, outline=tuple(max(c - 35, 0) for c in color))
        draw.text((view * 320 + 12, 12), name, fill=(30, 45, 60))
        if view:
            draw.line((view * 320, 0, view * 320, 360), fill=(205, 212, 220))
    output = io.BytesIO()
    image.save(output, format="PNG")
    import base64
    return base64.b64encode(output.getvalue()).decode("ascii")


def export_parts(exports):
    result = []
    shapes = []
    targets = set()
    total_bytes = 0
    for key, item in exports.items():
        if not isinstance(key, str) or not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_-]{0,119}", key):
            raise ValueError("Part IDs must use letters, numbers, underscores or hyphens")
        metadata = item if isinstance(item, dict) else {"shape": item}
        shape = metadata.get("shape")
        if isinstance(shape, cad.BuildPart):
            shape = shape.part
        if not isinstance(shape, cad.Shape) or not shape.is_valid or not shape.solids():
            raise ValueError(f"{key}: invalid CAD geometry or no solids")
        volume = sum(s.volume for s in shape.solids())
        if not math.isfinite(volume) or volume <= 1e-9:
            raise ValueError(f"{key}: solid volume must be positive")
        node_id = metadata.get("nodeId")
        if node_id is not None and (not isinstance(node_id, str) or not node_id or len(node_id) > 160):
            raise ValueError(f"{key}: invalid target node")
        target = node_id or "cad-" + key
        if target in targets:
            raise ValueError("Two parts cannot replace the same editor node")
        targets.add(target)
        buffer = io.BytesIO()
        if not cad.export_brep(shape, buffer):
            raise ValueError(f"{key}: BREP export failed")
        brep = buffer.getvalue().decode("utf-8")
        total_bytes += len(brep)
        if total_bytes > 32 * 1024 * 1024:
            raise ValueError("Generated geometry exceeds 32 MB; split into subassemblies")
        canonical = re.sub(r"^[01]{7}$", lambda m: "000" + m[0][3:], brep, flags=re.M)
        box = shape.bounding_box()
        minimum, maximum, size = list(box.min), list(box.max), list(box.size)
        if any(not math.isfinite(v) or abs(v) > 1e7 for v in minimum + maximum + size):
            raise ValueError(f"{key}: invalid or excessive model bounds")
        record = {"id": key, "name": metadata.get("name", key.replace("_", " ")),
                  "brep": brep, "fingerprint": hashlib.sha256(canonical.encode()).hexdigest(),
                  "volumeMm3": volume, "minMm": minimum, "maxMm": maximum, "sizeMm": size}
        if node_id is not None:
            record["nodeId"] = node_id
        if metadata.get("material"):
            record["material"] = metadata["material"]
        result.append(record)
        shapes.append(shape)
    return result, shapes


def execute(payload):
    program = payload["program"]
    namespace = {"parameters": dict(program["parameters"]), "unit_scale": 25.4 if program["units"] == "in" else 1.0}
    sources = payload.get("sources", {})
    imported = {}

    def existing(key):
        if key not in program["imports"] or key not in sources:
            raise ValueError(f"No declared source snapshot {key!r}")
        if key not in imported:
            path = Path(f"input_{len(imported)}.brep")
            path.write_text(sources[key]["brep"])
            imported[key] = cad.import_brep(path)
        return deepcopy(imported[key])

    namespace["existing"] = existing
    checkpoint_count = 0
    last_checkpoint = 0.0
    def preview(exports=None, label="Building parts"):
        nonlocal checkpoint_count, last_checkpoint
        now = time.monotonic()
        if checkpoint_count >= 24 or (checkpoint_count and now - last_checkpoint < 0.3):
            return
        current = exports if exports is not None else namespace.get("parts")
        if not isinstance(current, dict) or not 1 <= len(current) <= 1000:
            return
        records, _ = export_parts(current)
        checkpoint_count += 1
        last_checkpoint = now
        temporary = Path("preview-next.json")
        temporary.write_text(json.dumps({"parts":records,"label":str(label)[:160],"sequence":checkpoint_count}))
        temporary.replace("preview.json")
    namespace["preview"] = preview
    # Arbitrary Python is intentional; the OS sandbox is the boundary.
    exec(compile(program["source"], "design.py", "exec"), namespace)
    exports = namespace.get("parts")
    if not isinstance(exports, dict) or not 1 <= len(exports) <= 1000:
        raise ValueError("Set parts to a dictionary of 1–1,000 stable part IDs and shapes")
    result, shapes = export_parts(exports)
    preview(exports, "Checking completed geometry")
    return {"parts": result, "libraryVersion": cad.__version__, "kernelVersion": "8.0.1",
            "preview": render(shapes)}


if __name__ == "__main__":
    # Generated code may print; the result is a separate bounded JSON file.
    try:
        payload = json.loads(Path("input.json").read_text())
        with contextlib.redirect_stdout(QuietOutput()), contextlib.redirect_stderr(QuietOutput()):
            result = api_docs(payload.get("query", "")) if payload.get("mode") == "docs" else execute(payload)
        result = {"ok": True, **result}
    except BaseException as error:
        result = {"ok": False, "error": f"{type(error).__name__}: {str(error)[:3000]}",
                  "traceback": traceback.format_exc(limit=6)[-6000:]}
    Path("result.json").write_text(json.dumps(result))
