"""
Symbol finder — locates candidate symbol bounding boxes on a rendered drawing page.
Uses connected component analysis to find symbol-sized elements.

This is the bbox discovery tool: agent renders a page, runs this to find candidates,
then zooms in on each to visually validate before passing to the counter.

Usage:
    from tools.find_symbols import find_symbol_candidates
    candidates = find_symbol_candidates(img, img_w, img_h,
                                         min_size=20, max_size=120,
                                         exclude_borders=True)
"""
import numpy as np
import cv2


def find_symbol_candidates(img: np.ndarray, img_w: int, img_h: int,
                           min_size: int = 20, max_size: int = 150,
                           min_area: int = 150,
                           aspect_range: tuple = (0.3, 3.0),
                           exclude_borders: bool = True,
                           exclude_title_block: bool = True,
                           border_margin: int = 150) -> list[dict]:
    """
    Find symbol-sized connected components on a drawing image.
    Returns list of {x, y, w, h, area, cx, cy, aspect} sorted by area descending.
    """
    if len(img.shape) > 2 and img.shape[2] == 3:
        gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    else:
        gray = img

    _, binary = cv2.threshold(gray, 200, 255, cv2.THRESH_BINARY_INV)
    nlabels, labels, stats, centroids = cv2.connectedComponentsWithStats(binary, connectivity=8)

    candidates = []
    for i in range(1, nlabels):  # skip background
        x, y, w, h, area = stats[i]

        # Size filter
        if w < min_size or w > max_size or h < min_size or h > max_size:
            continue
        if area < min_area:
            continue

        # Aspect ratio filter
        aspect = float(w) / float(h) if h > 0 else 0
        if aspect < aspect_range[0] or aspect > aspect_range[1]:
            continue

        # Border exclusion
        if exclude_borders:
            if x < border_margin or y < border_margin:
                continue
            if x + w > img_w - border_margin or y + h > img_h - border_margin:
                continue

        # Title block exclusion (bottom-right 30% x 20%)
        if exclude_title_block:
            if x > img_w * 0.7 and y > img_h * 0.8:
                continue

        cx, cy = centroids[i]
        candidates.append({
            "x": int(x), "y": int(y), "w": int(w), "h": int(h),
            "area": int(area),
            "cx": round(float(cx), 1), "cy": round(float(cy), 1),
            "aspect": round(aspect, 2),
        })

    candidates.sort(key=lambda c: -c["area"])
    return candidates


def find_circles(img: np.ndarray, min_radius: int = 30, max_radius: int = 200,
                 min_dist: int = 50) -> list[dict]:
    """Find circular elements using Hough transform. Good for tanks, pipes, instrument bubbles."""
    if len(img.shape) > 2 and img.shape[2] == 3:
        gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    else:
        gray = img

    gray = cv2.GaussianBlur(gray, (5, 5), 0)
    circles = cv2.HoughCircles(gray, cv2.HOUGH_GRADIENT, dp=1.5, minDist=min_dist,
                               param1=100, param2=40, minRadius=min_radius, maxRadius=max_radius)

    if circles is None:
        return []

    results = []
    for c in np.uint16(np.around(circles[0])):
        results.append({
            "cx": int(c[0]), "cy": int(c[1]), "r": int(c[2]),
            "x": int(c[0] - c[2]), "y": int(c[1] - c[2]),
            "w": int(c[2] * 2), "h": int(c[2] * 2),
        })
    results.sort(key=lambda c: -c["r"])
    return results


def crop_component(img: np.ndarray, x: int, y: int, w: int, h: int, pad: int = 5) -> np.ndarray:
    """Crop a component from the image with padding."""
    y0 = max(0, y - pad)
    y1 = min(img.shape[0], y + h + pad)
    x0 = max(0, x - pad)
    x1 = min(img.shape[1], x + w + pad)
    return img[y0:y1, x0:x1]


def validate_bbox_has_content(img: np.ndarray, x: int, y: int, w: int, h: int,
                               min_dark_pct: float = 2.0) -> bool:
    """Check that a bounding box actually contains dark content (not blank)."""
    crop = crop_component(img, x, y, w, h, pad=0)
    if crop.size == 0:
        return False
    if len(crop.shape) > 2:
        gray = cv2.cvtColor(crop, cv2.COLOR_BGR2GRAY)
    else:
        gray = crop
    dark_pct = np.sum(gray < 200) / gray.size * 100
    return dark_pct >= min_dark_pct


# CLI mode
if __name__ == "__main__":
    import sys, json
    from renderer import render_to_numpy

    payload = json.loads(sys.stdin.read())
    img, pw, ph, iw, ih = render_to_numpy(payload["pdfPath"], payload.get("pageNumber", 1),
                                            payload.get("dpi", 150))

    candidates = find_symbol_candidates(img, iw, ih,
                                         min_size=payload.get("minSize", 20),
                                         max_size=payload.get("maxSize", 150))
    print(json.dumps({
        "candidates": candidates[:50],
        "total": len(candidates),
        "imageWidth": iw,
        "imageHeight": ih,
    }))
