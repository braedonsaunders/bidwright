"""
Fast PDF page renderer with region zoom.
Designed for rapid agentic iteration — agent renders, inspects, zooms, refines bbox.

Usage as CLI:
    echo '{"pdfPath":"/path.pdf","pageNumber":1,"dpi":150}' | python -m tools.renderer

Usage as library:
    from tools.renderer import render_page, render_region
    result = render_page("/path.pdf", page=1, dpi=150)
    zoomed = render_region("/path.pdf", page=1, x=100, y=200, w=300, h=250, img_w=5400, img_h=3600)
"""
import fitz
import base64
import numpy as np

MAX_DIMENSION = 8000


def render_page(pdf_path: str, page: int = 1, dpi: int = 150) -> dict:
    """Render a full PDF page to PNG. Returns dict with image (data URL), dimensions, page info."""
    doc = fitz.open(pdf_path, filetype="pdf")
    page_count = doc.page_count
    if page < 1 or page > page_count:
        doc.close()
        return {
            "success": False,
            "error": f"Page {page} out of range (1-{page_count})",
            "code": "page_out_of_range",
            "requestedPage": page,
            "pageCount": page_count,
        }

    pg = doc.load_page(page - 1)
    zoom = min(dpi / 72.0, MAX_DIMENSION / pg.rect.width, MAX_DIMENSION / pg.rect.height)
    pix = pg.get_pixmap(matrix=fitz.Matrix(zoom, zoom))
    png = pix.tobytes("png")

    result = {
        "success": True,
        "image": "data:image/png;base64," + base64.b64encode(png).decode(),
        "width": pix.width,
        "height": pix.height,
        "pageWidth": pg.rect.width,
        "pageHeight": pg.rect.height,
        "pageCount": page_count,
        "dpi": round(zoom * 72),
    }
    doc.close()
    return result


def render_region(pdf_path: str, page: int, x: float, y: float, w: float, h: float,
                  img_w: float, img_h: float, dpi: int = 300) -> dict:
    """Render a cropped region at high DPI. Coordinates are in rendered-image pixel space."""
    doc = fitz.open(pdf_path, filetype="pdf")
    page_count = doc.page_count
    if page < 1 or page > page_count:
        doc.close()
        return {
            "success": False,
            "error": f"Page {page} out of range (1-{page_count})",
            "code": "page_out_of_range",
            "requestedPage": page,
            "pageCount": page_count,
        }

    pg = doc.load_page(page - 1)

    # Convert image coords to PDF coords
    sx = pg.rect.width / img_w if img_w > 0 else 1.0
    sy = pg.rect.height / img_h if img_h > 0 else 1.0
    clip = fitz.Rect(x * sx, y * sy, (x + w) * sx, (y + h) * sy)

    # High-res zoom for the cropped region
    zoom = min(dpi / 72.0, MAX_DIMENSION / max(clip.width, 1), MAX_DIMENSION / max(clip.height, 1))
    pix = pg.get_pixmap(matrix=fitz.Matrix(zoom, zoom), clip=clip)
    png = pix.tobytes("png")

    result = {
        "success": True,
        "image": "data:image/png;base64," + base64.b64encode(png).decode(),
        "width": pix.width,
        "height": pix.height,
        "clip": {"x": clip.x0, "y": clip.y0, "w": clip.width, "h": clip.height},
        "zoom": round(zoom, 2),
    }
    doc.close()
    return result


def render_to_numpy(pdf_path: str, page: int = 1, dpi: int = 150) -> tuple:
    """Render page to a numpy array (BGR). Returns (img, pageWidth, pageHeight, imgWidth, imgHeight)."""
    doc = fitz.open(pdf_path, filetype="pdf")
    pg = doc.load_page(page - 1)
    zoom = min(dpi / 72.0, MAX_DIMENSION / pg.rect.width, MAX_DIMENSION / pg.rect.height)
    pix = pg.get_pixmap(matrix=fitz.Matrix(zoom, zoom))
    img = np.frombuffer(pix.samples, dtype=np.uint8).reshape(pix.height, pix.width, 3)
    pw, ph = pg.rect.width, pg.rect.height
    doc.close()
    return img, pw, ph, pix.width, pix.height


# CLI mode
if __name__ == "__main__":
    import sys, json
    payload = json.loads(sys.stdin.read())
    if "region" in payload and payload["region"]:
        r = payload["region"]
        result = render_region(payload["pdfPath"], payload.get("pageNumber", 1),
                               r["x"], r["y"], r["width"], r["height"],
                               r["imageWidth"], r["imageHeight"], payload.get("dpi", 300))
    else:
        result = render_page(payload["pdfPath"], payload.get("pageNumber", 1), payload.get("dpi", 150))
    print(json.dumps(result))
