"""
Symbol-library batch matcher.

Loads N pre-cropped template PNGs and matches each against ONE rendered PDF
page. The single page render is shared across all templates, so the cost is
amortised: one PyMuPDF render + N cv2.matchTemplate passes. This is the
engine behind the "Run Project Library" UI button and the
`runProjectSymbolLibrary` agent tool.

Usage as CLI:
    echo '{
      "pdfPath": "/path.pdf",
      "pageNumber": 3,
      "dpi": 150,
      "templates": [
        {"id": "tpl_a", "imagePath": "/.../a.png", "threshold": 0.75, "crossScale": false},
        {"id": "tpl_b", "imagePath": "/.../b.png", "threshold": 0.80, "crossScale": true}
      ]
    }' | python -m tools.count_library

Output schema:
    {
      "success": true,
      "imageWidth": <int>,
      "imageHeight": <int>,
      "elapsed_ms": <int>,
      "results": [
        {
          "templateId": "tpl_a",
          "totalCount": <int>,
          "matches": [{x, y, w, h, confidence}, ...],
          "elapsed_ms": <int>,
          "error": <optional string>
        }, ...
      ]
    }

Coordinates are in target-page image-pixel space at the rendered DPI. The
caller is responsible for mapping them back to its own canvas coordinate
system (multiply by canvasWidth / imageWidth, etc).
"""
import sys
import json
import time
import base64
from typing import Any

import cv2
import numpy as np
import fitz

try:
    from tools.count_symbols import count_matches, count_matches_cross_scale
except ImportError:
    from count_symbols import count_matches, count_matches_cross_scale


MAX_DIMENSION = 8000


def _render_page(pdf_path: str, page: int, dpi: int) -> tuple[np.ndarray, int, int]:
    """Render a page to a BGR numpy array. Returns (img, width_px, height_px)."""
    doc = fitz.open(pdf_path, filetype="pdf")
    try:
        if page < 1 or page > doc.page_count:
            raise ValueError(f"Page {page} out of range (1-{doc.page_count})")
        pg = doc.load_page(page - 1)
        zoom = min(dpi / 72.0, MAX_DIMENSION / pg.rect.width, MAX_DIMENSION / pg.rect.height)
        pix = pg.get_pixmap(matrix=fitz.Matrix(zoom, zoom))
        img = np.frombuffer(pix.samples, dtype=np.uint8).reshape(pix.height, pix.width, 3)
        return img.copy(), pix.width, pix.height
    finally:
        doc.close()


def _load_template(spec: dict[str, Any]) -> np.ndarray:
    """Load a template image from either an on-disk path or a data: URL."""
    if spec.get("imagePath"):
        img = cv2.imread(spec["imagePath"], cv2.IMREAD_COLOR)
        if img is None:
            raise ValueError(f"Could not read template image at {spec['imagePath']}")
        return img
    if spec.get("imageBase64"):
        raw = spec["imageBase64"]
        if raw.startswith("data:"):
            raw = raw.split(",", 1)[1]
        buf = np.frombuffer(base64.b64decode(raw), dtype=np.uint8)
        img = cv2.imdecode(buf, cv2.IMREAD_COLOR)
        if img is None:
            raise ValueError("Could not decode template base64")
        return img
    raise ValueError("template requires imagePath or imageBase64")


def run_library_on_page(
    pdf_path: str,
    page: int,
    templates: list[dict[str, Any]],
    dpi: int = 150,
) -> dict[str, Any]:
    """
    Match every enabled template against a single page render.

    Args:
        pdf_path: Absolute path to the PDF on disk.
        page: 1-indexed page number.
        templates: List of template specs. Each spec has:
            - id (required): unique identifier, echoed back in the result
            - imagePath OR imageBase64 (required)
            - threshold (optional, default 0.75)
            - crossScale (optional, default False)
            - maxMatches (optional, default 500) — per-template cap
        dpi: Render DPI for the target page. 150 is the autoresearch
            optimum and matches what templates were cropped at.

    Returns dict with per-template results. Templates that fail to load
    appear in the result list with an error string and an empty match
    array — failure is non-fatal so the rest of the library still runs.
    """
    start = time.time()

    if not templates:
        return {
            "success": True,
            "imageWidth": 0,
            "imageHeight": 0,
            "results": [],
            "elapsed_ms": 0,
        }

    page_img, img_w, img_h = _render_page(pdf_path, page, dpi)

    results: list[dict[str, Any]] = []
    for spec in templates:
        tpl_start = time.time()
        template_id = spec.get("id")
        if not template_id:
            continue
        try:
            tpl_img = _load_template(spec)
        except Exception as err:
            results.append({
                "templateId": template_id,
                "totalCount": 0,
                "matches": [],
                "elapsed_ms": int((time.time() - tpl_start) * 1000),
                "error": str(err),
            })
            continue

        threshold = float(spec.get("threshold", 0.75))
        cross_scale = bool(spec.get("crossScale", False))
        max_matches = int(spec.get("maxMatches", 500))

        if cross_scale:
            matches = count_matches_cross_scale(
                tpl_img, page_img,
                threshold=threshold,
                max_matches=max_matches,
            )
        else:
            matches = count_matches(
                tpl_img, page_img,
                threshold=threshold,
                max_matches=max_matches,
            )

        # Strip the elapsed_ms shimmed onto each match by count_matches —
        # we report it once per template instead.
        for m in matches:
            m.pop("elapsed_ms", None)

        results.append({
            "templateId": template_id,
            "totalCount": len(matches),
            "matches": matches,
            "elapsed_ms": int((time.time() - tpl_start) * 1000),
        })

    return {
        "success": True,
        "imageWidth": img_w,
        "imageHeight": img_h,
        "pageNumber": page,
        "dpi": dpi,
        "results": results,
        "elapsed_ms": int((time.time() - start) * 1000),
    }


if __name__ == "__main__":
    payload = json.loads(sys.stdin.read())
    try:
        result = run_library_on_page(
            pdf_path=payload["pdfPath"],
            page=int(payload.get("pageNumber", 1)),
            templates=list(payload.get("templates", [])),
            dpi=int(payload.get("dpi", 150)),
        )
        print(json.dumps(result))
    except Exception as err:
        print(json.dumps({
            "success": False,
            "error": str(err),
            "results": [],
        }))
        sys.exit(1)
