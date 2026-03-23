"""
Symbol counter — focused, fast template matching on construction drawings.
Stripped to only what actually works based on testing against real P&IDs.

What works:  OpenCV template matching (TM_CCOEFF_NORMED)
What doesn't: Feature matching (SIFT/ORB/BRISK) produces mostly false positives on P&IDs
              OCR-based matching fails on rotated text (most P&ID tags are 90° rotated)

Design: autoresearch-style — single metric, fast eval, iterate.
Metric: precision (true positives / total reported)
Speed target: <3 seconds per page

Usage:
    from tools.count_symbols import count_matches
    matches = count_matches(template_img, full_page_img, threshold=0.7)
"""
import numpy as np
import cv2
import time


def count_matches(template: np.ndarray, document: np.ndarray,
                  threshold: float = 0.70,
                  max_matches: int = 200,
                  multi_scale: bool = True) -> list[dict]:
    """
    Count occurrences of template in document using template matching.

    Args:
        template: BGR or grayscale image of the symbol to find
        document: BGR or grayscale image of the full page
        threshold: minimum match confidence (0-1). 0.70 is good default for P&IDs
        max_matches: cap on number of matches returned
        multi_scale: try ±10% scale variants for robustness

    Returns:
        List of {x, y, w, h, confidence} sorted by confidence descending.
        Coordinates are in document image pixel space.
    """
    start = time.time()

    # Convert to grayscale
    tpl_gray = _to_gray(template)
    doc_gray = _to_gray(document)

    th, tw = tpl_gray.shape
    if th < 5 or tw < 5:
        return []
    if th > doc_gray.shape[0] or tw > doc_gray.shape[1]:
        return []

    # Light blur to reduce noise while preserving edges
    tpl_proc = cv2.GaussianBlur(tpl_gray, (3, 3), 0)
    doc_proc = cv2.GaussianBlur(doc_gray, (3, 3), 0)

    all_raw = []

    # Scales to try: original + slight variants for robustness
    scales = [1.0]
    if multi_scale:
        scales = [0.9, 0.95, 1.0, 1.05, 1.1]

    for scale in scales:
        if scale == 1.0:
            tpl_scaled = tpl_proc
        else:
            new_w = max(5, int(tw * scale))
            new_h = max(5, int(th * scale))
            if new_h > doc_gray.shape[0] or new_w > doc_gray.shape[1]:
                continue
            tpl_scaled = cv2.resize(tpl_proc, (new_w, new_h), interpolation=cv2.INTER_LINEAR)

        sh, sw = tpl_scaled.shape

        # TM_CCOEFF_NORMED is the most reliable method for line drawings
        result = cv2.matchTemplate(doc_proc, tpl_scaled, cv2.TM_CCOEFF_NORMED)

        # Find locations above threshold
        locs = np.where(result >= threshold)
        for y, x in zip(*locs):
            conf = float(result[y, x])
            all_raw.append({"x": int(x), "y": int(y), "w": int(sw), "h": int(sh),
                            "confidence": conf, "scale": scale})

        # Early exit if we have plenty of matches
        if len(all_raw) > max_matches * 3:
            break

    # NMS: filter overlapping matches
    filtered = _nms(all_raw, min_distance_frac=0.3)

    # Sort by confidence
    filtered.sort(key=lambda m: -m["confidence"])

    # Cap
    filtered = filtered[:max_matches]

    elapsed = time.time() - start
    for m in filtered:
        m["elapsed_ms"] = round(elapsed * 1000)

    return filtered


def count_matches_on_pdf(pdf_path: str, page: int, bbox: dict,
                         threshold: float = 0.70,
                         render_dpi: int = 150,
                         multi_scale: bool = True) -> dict:
    """
    Full pipeline: render PDF page, extract template from bbox, count matches.

    Args:
        pdf_path: path to PDF
        page: 1-based page number
        bbox: {x, y, width, height, imageWidth, imageHeight} in canvas pixel space
        threshold: match confidence threshold
        render_dpi: DPI to render the page at
        multi_scale: try scale variants

    Returns:
        {matches, totalCount, templateImage, elapsed_ms, imageWidth, imageHeight}
    """
    import fitz
    import base64

    start = time.time()

    doc = fitz.open(pdf_path, filetype="pdf")
    pg = doc.load_page(page - 1)

    # Render full page
    zoom = render_dpi / 72.0
    MAX_DIM = 8000
    zoom = min(zoom, MAX_DIM / pg.rect.width, MAX_DIM / pg.rect.height)
    pix = pg.get_pixmap(matrix=fitz.Matrix(zoom, zoom))
    full_img = np.frombuffer(pix.samples, dtype=np.uint8).reshape(pix.height, pix.width, 3)
    img_w, img_h = pix.width, pix.height

    # Extract template from bbox
    bx = int(bbox.get("x", 0))
    by = int(bbox.get("y", 0))
    bw = int(bbox.get("width", 0))
    bh = int(bbox.get("height", 0))
    src_w = bbox.get("imageWidth", img_w)
    src_h = bbox.get("imageHeight", img_h)

    # Scale bbox if it was specified for a different render size
    if src_w > 0 and src_h > 0 and (src_w != img_w or src_h != img_h):
        sx = img_w / src_w
        sy = img_h / src_h
        bx = int(bx * sx)
        by = int(by * sy)
        bw = int(bw * sx)
        bh = int(bh * sy)

    # Clamp
    bx = max(0, min(bx, img_w - 1))
    by = max(0, min(by, img_h - 1))
    bw = min(bw, img_w - bx)
    bh = min(bh, img_h - by)

    if bw < 5 or bh < 5:
        doc.close()
        return {"matches": [], "totalCount": 0, "error": "Bounding box too small",
                "elapsed_ms": round((time.time() - start) * 1000)}

    template = full_img[by:by+bh, bx:bx+bw]

    # Validate template has content
    gray_tpl = _to_gray(template)
    dark_pct = np.sum(gray_tpl < 200) / gray_tpl.size * 100
    if dark_pct < 1.0:
        doc.close()
        return {"matches": [], "totalCount": 0, "error": f"Template is blank ({dark_pct:.1f}% dark)",
                "elapsed_ms": round((time.time() - start) * 1000)}

    # Run matching
    matches = count_matches(template, full_img, threshold=threshold,
                            multi_scale=multi_scale)

    # Encode template as data URL
    _, tpl_png = cv2.imencode(".png", template)
    tpl_b64 = "data:image/png;base64," + base64.b64encode(tpl_png.tobytes()).decode()

    # Encode each match crop
    for m in matches:
        mx, my, mw, mh = m["x"], m["y"], m["w"], m["h"]
        crop = full_img[max(0,my):min(img_h,my+mh), max(0,mx):min(img_w,mx+mw)]
        _, crop_png = cv2.imencode(".png", crop)
        m["image"] = "data:image/png;base64," + base64.b64encode(crop_png.tobytes()).decode()

    doc.close()
    elapsed_ms = round((time.time() - start) * 1000)

    return {
        "matches": matches,
        "totalCount": len(matches),
        "templateImage": tpl_b64,
        "imageWidth": img_w,
        "imageHeight": img_h,
        "templateDarkPct": round(dark_pct, 1),
        "elapsed_ms": elapsed_ms,
    }


def _to_gray(img: np.ndarray) -> np.ndarray:
    if len(img.shape) > 2 and img.shape[2] == 3:
        return cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    return img


def _nms(matches: list[dict], min_distance_frac: float = 0.3) -> list[dict]:
    """Non-maximum suppression: remove overlapping matches, keep highest confidence."""
    if not matches:
        return []

    # Sort by confidence desc
    matches.sort(key=lambda m: -m["confidence"])
    kept = []

    for m in matches:
        mx, my, mw, mh = m["x"], m["y"], m["w"], m["h"]
        mcx = mx + mw / 2
        mcy = my + mh / 2
        min_dist = max(mw, mh) * min_distance_frac

        too_close = False
        for k in kept:
            kcx = k["x"] + k["w"] / 2
            kcy = k["y"] + k["h"] / 2
            dist = ((mcx - kcx)**2 + (mcy - kcy)**2)**0.5
            if dist < min_dist:
                too_close = True
                break

        if not too_close:
            kept.append(m)

    return kept


# CLI mode
if __name__ == "__main__":
    import sys, json

    payload = json.loads(sys.stdin.read())
    result = count_matches_on_pdf(
        pdf_path=payload["pdfPath"],
        page=payload.get("pageNumber", 1),
        bbox=payload["boundingBox"],
        threshold=payload.get("threshold", 0.70),
        render_dpi=payload.get("dpi", 150),
        multi_scale=payload.get("multiScale", True),
    )

    # Strip images from CLI output to keep it manageable
    for m in result.get("matches", []):
        m.pop("image", None)
    result.pop("templateImage", None)

    print(json.dumps(result))
