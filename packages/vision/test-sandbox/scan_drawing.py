#!/usr/bin/env python3
"""
Proactive drawing scanner — scans an entire page, clusters similar symbols,
and auto-counts each cluster. Returns a structured symbol inventory.

The agent sees: "Here are 6 types of symbols on this page, with counts and thumbnails."
No zooming, no manual bbox hunting.

Usage:
    from scan_drawing import scan_page
    inventory = scan_page("/path/to.pdf", page=1)
"""
import sys, os, json, time, base64
import numpy as np
import cv2

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "python"))
from tools.renderer import render_to_numpy
from tools.find_symbols import find_symbol_candidates, validate_bbox_has_content, crop_component
from tools.count_symbols import count_matches


def cluster_candidates(candidates: list[dict], size_tolerance: float = 0.25) -> list[list[dict]]:
    """
    Cluster candidates by visual size similarity.
    Groups candidates whose width and height are within ±tolerance of each other.
    """
    if not candidates:
        return []

    used = set()
    clusters = []

    for i, c in enumerate(candidates):
        if i in used:
            continue

        cluster = [c]
        used.add(i)

        for j, other in enumerate(candidates):
            if j in used:
                continue

            # Size similarity check
            w_ratio = min(c["w"], other["w"]) / max(c["w"], other["w"]) if max(c["w"], other["w"]) > 0 else 0
            h_ratio = min(c["h"], other["h"]) / max(c["h"], other["h"]) if max(c["h"], other["h"]) > 0 else 0

            if w_ratio >= (1 - size_tolerance) and h_ratio >= (1 - size_tolerance):
                cluster.append(other)
                used.add(j)

        clusters.append(cluster)

    # Sort clusters by size (biggest clusters first)
    clusters.sort(key=lambda cl: -len(cl))
    return clusters


def pick_representative(cluster: list[dict], img: np.ndarray, iw: int, ih: int) -> dict | None:
    """Pick the best representative from a cluster — centered, high content, unclipped."""
    scored = []
    for c in cluster:
        # Skip if near edge (might be clipped)
        margin = 20
        if c["x"] < margin or c["y"] < margin or c["x"] + c["w"] > iw - margin or c["y"] + c["h"] > ih - margin:
            continue

        # Score: prefer higher content density + more centered
        if not validate_bbox_has_content(img, c["x"], c["y"], c["w"], c["h"], 3.0):
            continue

        crop = crop_component(img, c["x"], c["y"], c["w"], c["h"], pad=0)
        if crop.size == 0:
            continue

        gray = cv2.cvtColor(crop, cv2.COLOR_BGR2GRAY) if len(crop.shape) > 2 else crop
        dark_pct = np.sum(gray < 200) / gray.size * 100

        # Prefer centered on page (not in margins or title block)
        cx_norm = abs(c["cx"] / iw - 0.5)  # 0 = center, 0.5 = edge
        cy_norm = abs(c["cy"] / ih - 0.5)
        center_score = 1.0 - (cx_norm + cy_norm)  # higher = more centered

        score = dark_pct * 0.7 + center_score * 30
        scored.append((score, c))

    if not scored:
        # Fallback: just pick the first one
        return cluster[0] if cluster else None

    scored.sort(key=lambda x: -x[0])
    return scored[0][1]


def find_composite_candidates(img: np.ndarray, iw: int, ih: int,
                               min_composite: int = 50, max_composite: int = 250,
                               dilate_kernel: int = 8) -> list[dict]:
    """
    Find larger composite symbols by dilating the binary image to merge
    nearby strokes, then running connected component analysis on the merged result.
    This catches nozzle flanges, equipment details, etc. that are multi-stroke symbols.
    """
    if len(img.shape) > 2:
        gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    else:
        gray = img.copy()

    _, binary = cv2.threshold(gray, 200, 255, cv2.THRESH_BINARY_INV)

    # Dilate to merge nearby strokes into composite blobs
    kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (dilate_kernel, dilate_kernel))
    dilated = cv2.dilate(binary, kernel, iterations=2)

    nlabels, labels, stats, centroids = cv2.connectedComponentsWithStats(dilated, connectivity=8)

    candidates = []
    for i in range(1, nlabels):
        x, y, w, h, area = stats[i]

        if w < min_composite or h < min_composite:
            continue
        if w > max_composite or h > max_composite:
            continue

        # Skip title block
        if x > iw * 0.7 and y > ih * 0.8:
            continue
        # Skip border elements
        if x < 10 or y < 10 or x + w > iw - 10 or y + h > iw - 10:
            continue

        aspect = float(w) / float(h) if h > 0 else 0
        if aspect < 0.3 or aspect > 3.5:
            continue

        cx, cy = centroids[i]
        candidates.append({
            "x": int(x), "y": int(y), "w": int(w), "h": int(h),
            "area": int(area),
            "cx": round(float(cx), 1), "cy": round(float(cy), 1),
            "aspect": round(aspect, 2),
        })

    candidates.sort(key=lambda c: -c["area"])
    return candidates[:30]


def scan_page(pdf_path: str, page: int = 1, dpi: int = 150,
              min_size: int = 15, max_size: int = 200,
              min_cluster_size: int = 2,
              max_clusters: int = 12,
              count_threshold: float = 0.75) -> dict:
    """
    Scan a drawing page and return a structured symbol inventory.

    Returns:
        {
            clusters: [{
                id: int,
                representativeBox: {x, y, w, h},
                thumbnail: "data:image/png;base64,...",
                sizeCategory: "small|medium|large",
                avgDimensions: {w, h},
                candidateCount: int,        # how many raw candidates in this cluster
                matchCount: int,             # how many template matches found
                avgConfidence: float,
                topMatches: [{x, y, w, h, confidence}],  # up to 5
                countDuration_ms: int,
            }],
            imageWidth: int,
            imageHeight: int,
            totalClusters: int,
            totalSymbolsFound: int,
            scanDuration_ms: int,
        }
    """
    start = time.time()

    # 1. Render
    img, pw, ph, iw, ih = render_to_numpy(pdf_path, page, dpi)

    # 2. Find candidates — TWO passes
    # Pass A: connected component analysis (small to medium symbols)
    cc_candidates = find_symbol_candidates(img, iw, ih,
                                            min_size=min_size, max_size=max_size,
                                            min_area=80, exclude_borders=False,
                                            border_margin=30)

    # Pass B: morphological dilation merges nearby strokes → composite symbols
    composite_candidates = find_composite_candidates(img, iw, ih,
                                                      min_composite=50, max_composite=250,
                                                      dilate_kernel=8)

    # Merge and deduplicate: prefer CC candidates when overlapping
    valid = [c for c in cc_candidates if validate_bbox_has_content(img, c["x"], c["y"], c["w"], c["h"], 3.0)]

    # Add composite candidates that don't overlap with existing CC candidates
    for comp in composite_candidates:
        overlaps = False
        for v in valid:
            if (abs(comp["cx"] - v["cx"]) < max(comp["w"], v["w"]) * 0.5 and
                abs(comp["cy"] - v["cy"]) < max(comp["h"], v["h"]) * 0.5):
                overlaps = True
                break
        if not overlaps:
            valid.append(comp)

    # 3. Cluster by visual size
    clusters_raw = cluster_candidates(valid, size_tolerance=0.25)

    # 4. For each cluster: pick representative, count matches
    results = []
    total_symbols = 0

    for idx, cluster in enumerate(clusters_raw[:max_clusters]):
        if len(cluster) < min_cluster_size:
            continue

        rep = pick_representative(cluster, img, iw, ih)
        if rep is None:
            continue

        # Extract template crop
        template = crop_component(img, rep["x"], rep["y"], rep["w"], rep["h"], pad=2)
        if template.size == 0:
            continue

        # Run count_matches
        count_start = time.time()
        matches = count_matches(template, img, threshold=count_threshold)
        count_ms = round((time.time() - count_start) * 1000)

        if not matches:
            continue

        # Encode thumbnail
        _, tpl_png = cv2.imencode(".png", template)
        thumbnail = "data:image/png;base64," + base64.b64encode(tpl_png.tobytes()).decode()

        # Size category
        avg_dim = (rep["w"] + rep["h"]) / 2
        if avg_dim < 40:
            size_cat = "small"
        elif avg_dim < 100:
            size_cat = "medium"
        else:
            size_cat = "large"

        avg_conf = sum(m["confidence"] for m in matches) / len(matches) if matches else 0

        cluster_result = {
            "id": idx,
            "representativeBox": {"x": rep["x"], "y": rep["y"], "w": rep["w"], "h": rep["h"]},
            "thumbnail": thumbnail,
            "sizeCategory": size_cat,
            "avgDimensions": {
                "w": round(sum(c["w"] for c in cluster) / len(cluster)),
                "h": round(sum(c["h"] for c in cluster) / len(cluster)),
            },
            "candidateCount": len(cluster),
            "matchCount": len(matches),
            "avgConfidence": round(avg_conf, 3),
            "topMatches": [
                {"x": m["x"], "y": m["y"], "w": m["w"], "h": m["h"],
                 "confidence": round(m["confidence"], 3)}
                for m in matches[:5]
            ],
            "countDuration_ms": count_ms,
        }
        results.append(cluster_result)
        total_symbols += len(matches)

    scan_ms = round((time.time() - start) * 1000)

    return {
        "clusters": results,
        "imageWidth": iw,
        "imageHeight": ih,
        "totalClusters": len(results),
        "totalSymbolsFound": total_symbols,
        "scanDuration_ms": scan_ms,
    }


def scan_page_lite(pdf_path: str, page: int = 1, dpi: int = 150,
                   min_size: int = 15, max_size: int = 200) -> dict:
    """Lite version — no thumbnails, no match images. For CLI/testing."""
    result = scan_page(pdf_path, page, dpi, min_size, max_size)
    for c in result["clusters"]:
        c.pop("thumbnail", None)
    return result


# CLI mode
if __name__ == "__main__":
    payload = json.loads(sys.stdin.read())
    result = scan_page_lite(
        pdf_path=payload["pdfPath"],
        page=payload.get("pageNumber", 1),
        dpi=payload.get("dpi", 150),
        min_size=payload.get("minSize", 15),
        max_size=payload.get("maxSize", 200),
    )
    print(json.dumps(result))
