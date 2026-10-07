"""
Page reader for the estimating agent: the agent itself looks at drawing pages.

One call returns what a person gets when they pick up a sheet:
  * an upright image sized to what the model can actually see (no 8000 px
    renders that the provider silently shrinks to mush),
  * the page's real text layer with positions, so exact strings can be quoted,
  * layout regions (views, details, tables, title block) found from the
    drawn geometry rather than fixed page proportions,
  * an addressable tile grid for zooming in at a known effective resolution.

All bboxes are normalized 0..1 in the DISPLAY frame (after auto-rotation), so
the agent can pass a region or tile straight back for a zoomed read.

Usage as CLI:
    echo '{"pdfPath":"/x.pdf","pageNumber":4,"mode":"overview"}' | python -m tools.page_reader
"""
try:
    import pymupdf as fitz
except ImportError:  # older PyMuPDF without the new name
    import fitz
import base64
import hashlib
import json
import math
import sys

DEFAULT_MAX_EDGE = 1568
MAX_DPI = 400
TILE_TARGET_DPI = 200
MAX_GRID = 6
MAX_TEXT_LINES = {"overview": 120, "tile": 400}


def _rotation_from_text(page) -> int:
    """Pick the rotation that makes most of the page's text read left-to-right."""
    weights = {0: 0.0, 90: 0.0, 180: 0.0, 270: 0.0}
    for block in page.get_text("dict").get("blocks", []):
        for line in block.get("lines", []):
            dx, dy = line.get("dir", (1.0, 0.0))
            text = "".join(span.get("text", "") for span in line.get("spans", []))
            angle = (round(math.degrees(math.atan2(dy, dx)) / 90) * 90) % 360
            weights[angle] += len(text.strip())
    angle = max(weights, key=weights.get)
    if weights[angle] == 0:
        return 0
    # Text running at `angle` degrees is upright after rotating by -angle.
    return (360 - angle) % 360


def _display_frame(page, rotation: int):
    matrix = fitz.Matrix(rotation)
    display = page.rect * matrix
    return matrix, display


def _to_display_norm(rect, matrix, display):
    r = fitz.Rect(rect) * matrix
    r.normalize()
    return {
        "x": round((r.x0 - display.x0) / display.width, 4),
        "y": round((r.y0 - display.y0) / display.height, 4),
        "width": round(r.width / display.width, 4),
        "height": round(r.height / display.height, 4),
    }


def _from_display_norm(bbox, matrix, display):
    """Display-normalized bbox -> page-space rect."""
    x0 = display.x0 + float(bbox["x"]) * display.width
    y0 = display.y0 + float(bbox["y"]) * display.height
    x1 = x0 + float(bbox["width"]) * display.width
    y1 = y0 + float(bbox["height"]) * display.height
    inverse = ~matrix
    r = fitz.Rect(x0, y0, x1, y1) * inverse
    r.normalize()
    return r


def _page_norm(rect, page):
    """Page-space rect -> normalized 0..1 of the unrotated page."""
    r = fitz.Rect(rect)
    base = page.rect
    return {
        "x": round((r.x0 - base.x0) / base.width, 4),
        "y": round((r.y0 - base.y0) / base.height, 4),
        "width": round(r.width / base.width, 4),
        "height": round(r.height / base.height, 4),
    }


def _render(page, clip, rotation, max_edge, max_dpi):
    long_edge_pt = max(clip.width, clip.height, 1.0)
    zoom = min(max_edge / long_edge_pt, max_dpi / 72.0)
    pix = page.get_pixmap(matrix=fitz.Matrix(zoom, zoom).prerotate(rotation), clip=clip, alpha=False)
    png = pix.tobytes("png")
    return png, pix.width, pix.height, round(zoom * 72)


def _text_lines(page, clip, matrix, display):
    lines = []
    for block_index, block in enumerate(page.get_text("dict", clip=clip).get("blocks", [])):
        for line in block.get("lines", []):
            spans = line.get("spans", [])
            text = "".join(span.get("text", "") for span in spans).strip()
            if not text:
                continue
            lines.append({
                "text": text,
                "bbox": _to_display_norm(line["bbox"], matrix, display),
                "pageBbox": _page_norm(line["bbox"], page),
                "size": round(max((span.get("size", 0) for span in spans), default=0), 1),
                "block": block_index,
            })
    # Reading order in the display frame.
    lines.sort(key=lambda item: (round(item["bbox"]["y"], 2), item["bbox"]["x"]))
    return lines


def _layout_regions(page, rotation, matrix, display, text_lines):
    """Cluster drawn geometry into view/detail regions; add tables and big text."""
    regions = []
    try:
        import cv2
        import numpy as np
        pix = page.get_pixmap(matrix=fitz.Matrix(1, 1).prerotate(rotation), alpha=False, colorspace=fitz.csGRAY)
        img = np.frombuffer(pix.samples, dtype=np.uint8).reshape(pix.height, pix.width)
        ink = (img < 200).astype(np.uint8) * 255
        # Drop the sheet border: a frame touching all four edges would merge everything.
        h, w = ink.shape
        border = max(4, int(min(h, w) * 0.02))
        ink[:border, :] = 0
        ink[-border:, :] = 0
        ink[:, :border] = 0
        ink[:, -border:] = 0
        # Erase sheet frames and title-block rules: lines spanning most of the
        # sheet would otherwise glue every view into one region.
        long_h = cv2.morphologyEx(ink, cv2.MORPH_OPEN, cv2.getStructuringElement(cv2.MORPH_RECT, (int(w * 0.6), 1)))
        long_v = cv2.morphologyEx(ink, cv2.MORPH_OPEN, cv2.getStructuringElement(cv2.MORPH_RECT, (1, int(h * 0.6))))
        ink = cv2.subtract(ink, cv2.bitwise_or(long_h, long_v))
        kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (max(9, w // 60), max(9, h // 60)))
        merged = cv2.dilate(ink, kernel)
        count, _labels, stats, _ = cv2.connectedComponentsWithStats(merged, connectivity=8)
        for index in range(1, count):
            x, y, bw, bh, area = stats[index]
            if bw * bh < (w * h) * 0.004:
                continue
            if bw > w * 0.96 and bh > h * 0.96:
                continue
            regions.append({
                "kind": "view",
                "bbox": {
                    "x": round(x / w, 4), "y": round(y / h, 4),
                    "width": round(bw / w, 4), "height": round(bh / h, 4),
                },
            })
    except Exception as exc:  # opencv missing or render failure: text/tables still work
        regions.append({"kind": "note", "error": f"geometry clustering unavailable: {exc}"})

    try:
        for table in page.find_tables().tables:
            regions.append({"kind": "table", "bbox": _to_display_norm(table.bbox, matrix, display)})
    except Exception:
        pass

    # Title each view with the largest text line inside or just below it.
    for region in regions:
        bbox = region.get("bbox")
        if not bbox:
            continue
        best = None
        for line in text_lines:
            lb = line["bbox"]
            cx = lb["x"] + lb["width"] / 2
            cy = lb["y"] + lb["height"] / 2
            inside_x = bbox["x"] - 0.02 <= cx <= bbox["x"] + bbox["width"] + 0.02
            inside_y = bbox["y"] - 0.02 <= cy <= bbox["y"] + bbox["height"] + 0.08
            if inside_x and inside_y and (best is None or line["size"] > best["size"]):
                best = line
        if best is not None:
            region["label"] = best["text"][:80]

    for region in regions:
        if region.get("bbox"):
            region["pageBbox"] = _page_norm(_from_display_norm(region["bbox"], matrix, display), page)

    regions.sort(key=lambda item: (item.get("bbox", {}).get("y", 0), item.get("bbox", {}).get("x", 0)))
    for index, region in enumerate(regions, start=1):
        region["id"] = f"R{index}"
    return regions


def _tile_grid(display, max_edge):
    width_in = display.width / 72.0
    height_in = display.height / 72.0
    cols = min(MAX_GRID, max(1, math.ceil(width_in * TILE_TARGET_DPI / max_edge)))
    rows = min(MAX_GRID, max(1, math.ceil(height_in * TILE_TARGET_DPI / max_edge)))
    overlap = 0.04
    tiles = []
    for row in range(rows):
        for col in range(cols):
            x0 = max(0.0, col / cols - (overlap if col else 0))
            y0 = max(0.0, row / rows - (overlap if row else 0))
            x1 = min(1.0, (col + 1) / cols + (overlap if col < cols - 1 else 0))
            y1 = min(1.0, (row + 1) / rows + (overlap if row < rows - 1 else 0))
            tiles.append({
                "id": f"r{row + 1}c{col + 1}",
                "bbox": {"x": round(x0, 4), "y": round(y0, 4), "width": round(x1 - x0, 4), "height": round(y1 - y0, 4)},
            })
    return {"rows": rows, "cols": cols, "tiles": tiles}


def read_page(request: dict) -> dict:
    pdf_path = request["pdfPath"]
    page_number = int(request.get("pageNumber", 1))
    mode = request.get("mode", "overview")
    max_edge = int(request.get("maxEdge") or DEFAULT_MAX_EDGE)
    max_dpi = int(request.get("maxDpi") or MAX_DPI)

    doc = fitz.open(pdf_path, filetype="pdf")
    try:
        if page_number < 1 or page_number > doc.page_count:
            return {
                "success": False,
                "code": "page_out_of_range",
                "error": f"Page {page_number} out of range (1-{doc.page_count})",
                "pageCount": doc.page_count,
            }
        page = doc.load_page(page_number - 1)
        rotation = request.get("rotation")
        rotation = int(rotation) % 360 if rotation is not None else _rotation_from_text(page)
        matrix, display = _display_frame(page, rotation)

        bbox = request.get("bbox")
        tile_id = request.get("tile")
        grid = _tile_grid(display, max_edge)
        if mode == "tile" and tile_id and not bbox:
            match = next((tile for tile in grid["tiles"] if tile["id"] == tile_id), None)
            if match is None:
                return {"success": False, "code": "unknown_tile", "error": f"Tile {tile_id} is not on this page's {grid['rows']}x{grid['cols']} grid"}
            bbox = match["bbox"]
        if mode == "tile" and not bbox:
            return {"success": False, "code": "missing_region", "error": "Tile mode needs a tile id or a bbox"}

        clip = _from_display_norm(bbox, matrix, display) & page.rect if bbox else page.rect
        if clip.is_empty:
            return {"success": False, "code": "empty_region", "error": "The requested region is outside the page"}
        if request.get("dpi"):
            max_dpi = min(max_dpi, int(request["dpi"]))
        png, width, height, dpi = _render(page, clip, rotation, max_edge, max_dpi)

        text_lines = _text_lines(page, clip, matrix, display)
        word_count = len(page.get_text("words"))
        drawing_count = len(page.get_drawings()) if mode == "overview" else None

        result = {
            "success": True,
            "mode": mode,
            "pageNumber": page_number,
            "pageCount": doc.page_count,
            "rotation": rotation,
            "pageSizeInches": {"width": round(display.width / 72, 2), "height": round(display.height / 72, 2)},
            "bbox": bbox or {"x": 0, "y": 0, "width": 1, "height": 1},
            "image": "data:image/png;base64," + base64.b64encode(png).decode(),
            "imageHash": hashlib.sha256(png).hexdigest(),
            "width": width,
            "height": height,
            "dpi": dpi,
            "textLines": text_lines[:MAX_TEXT_LINES.get(mode, 400)],
            "textLinesTotal": len(text_lines),
            "textLinesTruncated": len(text_lines) > MAX_TEXT_LINES.get(mode, 400),
        }
        if mode == "overview":
            result["grid"] = grid
            result["regions"] = _layout_regions(page, rotation, matrix, display, text_lines)
            result["wordCount"] = word_count
            result["drawingCount"] = drawing_count
            # CAD exports often draw dimensions and notes as strokes; those are
            # invisible to text extraction and only readable from pixels.
            result["vectorTextLikely"] = bool(drawing_count and drawing_count > 200 and word_count < 80)
        return result
    finally:
        doc.close()


if __name__ == "__main__":
    payload = json.loads(sys.stdin.read() or "{}")
    # This tool's stdout is its reply. PyMuPDF prints advice banners (e.g. from
    # find_tables) to stdout, so send everything but the reply to stderr.
    reply_stream = sys.stdout
    sys.stdout = sys.stderr
    try:
        output = read_page(payload)
    except Exception as exc:  # report, never crash with a traceback on stdout
        output = {"success": False, "code": "read_failed", "error": str(exc)}
    finally:
        sys.stdout = reply_stream
    reply_stream.write(json.dumps(output))
