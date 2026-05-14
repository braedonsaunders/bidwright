#!/usr/bin/env python3
"""
Generic construction drawing geometry analyzer.

Clean-room OpenCV pipeline for agent and UI takeoff workflows. It intentionally
stays trade-neutral: linework, circles, text regions, symbol candidates, and
connected linear systems are returned in one compact JSON schema.
"""
from __future__ import annotations

import json
import math
import sys
import time
from collections import defaultdict, deque
from dataclasses import dataclass
from typing import Any

import cv2
import numpy as np

try:
    from tools.renderer import render_to_numpy
    from tools.find_symbols import find_symbol_candidates
except ImportError:
    from renderer import render_to_numpy
    from find_symbols import find_symbol_candidates


MAX_DEFAULT_LINES = 0
MAX_DEFAULT_REGIONS = 500
ANGLE_BUCKET_DEGREES = 2.5
MIDPOINT_BUCKET_PX = 8


@dataclass(frozen=True)
class Segment:
    id: str
    x1: float
    y1: float
    x2: float
    y2: float
    source: str
    confidence: float
    layer: str | None = None
    stroke_width: float | None = None
    color: str | None = None
    flags: tuple[str, ...] = ()

    @property
    def length(self) -> float:
        return float(math.hypot(self.x2 - self.x1, self.y2 - self.y1))

    @property
    def angle(self) -> float:
        angle = math.degrees(math.atan2(self.y2 - self.y1, self.x2 - self.x1))
        return round((angle + 180) % 180, 2)

    @property
    def bbox(self) -> dict[str, float]:
        return {
            "x": round(min(self.x1, self.x2), 2),
            "y": round(min(self.y1, self.y2), 2),
            "width": round(abs(self.x2 - self.x1), 2),
            "height": round(abs(self.y2 - self.y1), 2),
        }

    def to_json(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "x1": round(self.x1, 2),
            "y1": round(self.y1, 2),
            "x2": round(self.x2, 2),
            "y2": round(self.y2, 2),
            "lengthPx": round(self.length, 2),
            "angleDeg": self.angle,
            "bbox": self.bbox,
            "source": self.source,
            "confidence": round(self.confidence, 3),
            **({"layer": self.layer} if self.layer else {}),
            **({"strokeWidth": round(float(self.stroke_width), 3)} if self.stroke_width is not None else {}),
            **({"color": self.color} if self.color else {}),
            **({"qualityFlags": list(self.flags)} if self.flags else {}),
        }


def analyze_page(
    pdf_path: str,
    page: int = 1,
    dpi: int = 150,
    preset: str = "generic",
    geometry_source: str = "auto",
    include_symbols: bool = True,
    include_text_regions: bool = True,
    include_circles: bool = True,
    trace_systems: bool = True,
    min_line_length: float | None = None,
    snap_tolerance: float | None = None,
    max_lines: int | None = MAX_DEFAULT_LINES,
    max_regions: int = MAX_DEFAULT_REGIONS,
    line_sensitivity: float = 0.62,
    noise_rejection: float = 0.42,
) -> dict[str, Any]:
    start = time.time()
    warnings: list[str] = []
    requested_source = _normalize_geometry_source(geometry_source)

    img, page_w, page_h, img_w, img_h = render_to_numpy(pdf_path, page, dpi)
    gray = _to_gray(img)
    binary = _binary_drawing_mask(gray)
    cleaned = _clean_linework(binary)

    line_sensitivity = _clamp(float(line_sensitivity), 0.1, 1.0)
    noise_rejection = _clamp(float(noise_rejection), 0.0, 1.0)
    default_min_line = _default_min_line_length(img_w, img_h, preset)
    sensitivity_factor = 1.28 - (line_sensitivity * 0.56)
    noise_factor = 0.82 + (noise_rejection * 0.52)
    min_line = float(min_line_length or max(5.0, default_min_line * sensitivity_factor * noise_factor))
    snap = float(snap_tolerance or max(8.0, min(img_w, img_h) * (0.0016 + noise_rejection * 0.0022)))
    line_limit = _normalize_limit(max_lines)
    region_limit = max(20, int(max_regions))

    text_regions_for_filter = detect_text_regions(gray, max_regions=region_limit)
    raw_symbol_candidates = find_symbol_candidates(
        img,
        img_w,
        img_h,
        min_size=max(12, int(min(img_w, img_h) * 0.004)),
        max_size=max(80, int(min(img_w, img_h) * 0.04)),
        min_area=60,
        exclude_borders=True,
        border_margin=max(20, int(min(img_w, img_h) * 0.015)),
    )[:region_limit]
    symbol_candidates = raw_symbol_candidates if include_symbols else []

    semantic_regions = _semantic_exclusion_regions(text_regions_for_filter, raw_symbol_candidates, img_w, img_h)
    topology_mask = _mask_regions(cleaned, semantic_regions, pad=max(2, int(snap * 0.18)))
    raster_segments = detect_line_segments(
        gray,
        topology_mask,
        min_line,
        max_lines=line_limit,
        exclusion_regions=semantic_regions,
        img_w=img_w,
        img_h=img_h,
    )
    vector_segments: list[Segment] = []
    vector_stats: dict[str, Any] = {}
    if requested_source in {"auto", "pdf_vector"}:
        vector_segments, vector_stats = extract_pdf_vector_segments(
            pdf_path,
            page,
            img_w,
            img_h,
            float(page_w),
            float(page_h),
            min_line,
            max_lines=line_limit,
            exclusion_regions=semantic_regions,
        )
    segments, chosen_source, source_confidence = _choose_geometry_segments(
        requested_source,
        raster_segments,
        vector_segments,
        img_w,
        img_h,
        warnings,
    )
    segments = merge_collinear_segments(segments, snap_tolerance=snap)
    if line_limit is not None and len(segments) >= line_limit:
        warnings.append(f"Line output capped at {line_limit}; set maxLines to 0 for full output or raise the budget for dense sheets.")

    text_regions = text_regions_for_filter if include_text_regions else []
    circles = detect_circles(gray, img_w, img_h, text_regions_for_filter, max_regions=region_limit) if include_circles else []
    systems = trace_linear_systems(segments, preset=preset, snap_tolerance=snap, img_w=img_w, img_h=img_h) if trace_systems else []
    if (
        trace_systems
        and len(text_regions_for_filter) >= min(max(80, region_limit * 0.6), region_limit)
        and systems
        and float(systems[0].get("lengthPx", 0)) < min(img_w, img_h) * 0.35
    ):
        warnings.append("Text-heavy sheet detected; suppressed short text-line topology candidates.")
        systems = []
    polylines = build_polylines(segments, systems, max_regions=region_limit)
    contours = detect_contours(cleaned, img_w, img_h, max_regions=region_limit)

    duration_ms = round((time.time() - start) * 1000)
    return {
        "success": True,
        "schemaVersion": 1,
        "preset": preset,
        "geometrySource": chosen_source,
        "geometrySourceRequested": requested_source,
        "sourceConfidence": round(source_confidence, 3),
        "qualityFlags": _analysis_quality_flags(chosen_source, vector_stats, raster_segments, vector_segments),
        "pageNumber": page,
        "dpi": dpi,
        "imageWidth": img_w,
        "imageHeight": img_h,
        "pageWidth": round(float(page_w), 2),
        "pageHeight": round(float(page_h), 2),
        "scaleMetadata": {
            "dpi": dpi,
            "pdfPageWidthPt": round(float(page_w), 2),
            "pdfPageHeightPt": round(float(page_h), 2),
            "imageWidthPx": img_w,
            "imageHeightPx": img_h,
            "pixelsPerPdfPointX": round(img_w / max(float(page_w), 1.0), 6),
            "pixelsPerPdfPointY": round(img_h / max(float(page_h), 1.0), 6),
            "pixelsPerPaperInchX": round(img_w / max(float(page_w) / 72.0, 0.0001), 4),
            "pixelsPerPaperInchY": round(img_h / max(float(page_h) / 72.0, 0.0001), 4),
            "realWorldScale": None,
            "calibrationRequired": True,
        },
        "preprocessing": {
            "geometrySource": chosen_source,
            "geometrySourceRequested": requested_source,
            "threshold": "adaptive-gaussian",
            "morphology": "linework-close-open",
            "semanticMasks": {
                "textRegionsMasked": len(text_regions_for_filter),
                "symbolRegionsMasked": len(raw_symbol_candidates),
                "titleBlockExcluded": True,
                "borderExcluded": True,
            },
            "vectorSignals": vector_stats,
            "minLineLengthPx": round(min_line, 2),
            "snapTolerancePx": round(snap, 2),
            "lineSensitivity": round(line_sensitivity, 3),
            "noiseRejection": round(noise_rejection, 3),
            "maxLines": line_limit,
            "maxRegions": region_limit,
        },
        "summary": {
            "lineCount": len(segments),
            "circleCount": len(circles),
            "symbolCandidateCount": len(symbol_candidates),
            "textRegionCount": len(text_regions),
            "systemCount": len(systems),
            "polylineCount": len(polylines),
            "contourCount": len(contours),
            "totalSystemLengthPx": round(sum(float(s.get("lengthPx", 0)) for s in systems), 2),
        },
        "lines": [segment.to_json() for segment in segments],
        "polylines": polylines,
        "circles": circles,
        "contours": contours,
        "symbolCandidates": _normalize_symbol_candidates(symbol_candidates),
        "textRegions": text_regions,
        "systems": systems,
        "warnings": warnings,
        "duration_ms": duration_ms,
    }


def extract_pdf_vector_segments(
    pdf_path: str,
    page: int,
    img_w: int,
    img_h: int,
    page_w: float,
    page_h: float,
    min_line_length: float,
    max_lines: int | None,
    exclusion_regions: list[dict[str, Any]] | None = None,
) -> tuple[list[Segment], dict[str, Any]]:
    try:
        import fitz  # type: ignore
    except Exception as exc:
        return [], {"available": False, "error": f"PyMuPDF unavailable: {exc}"}

    segments: list[Segment] = []
    stats: dict[str, Any] = {
        "available": True,
        "drawingCount": 0,
        "pathItemCount": 0,
        "lineItemCount": 0,
        "rectItemCount": 0,
        "curveItemCount": 0,
        "layerCount": 0,
        "capped": False,
    }
    regions = exclusion_regions or []
    sx = img_w / max(page_w, 1.0)
    sy = img_h / max(page_h, 1.0)
    budget = None if max_lines is None else max_lines * 4
    layers: set[str] = set()

    try:
        doc = fitz.open(pdf_path, filetype="pdf")
        pg = doc.load_page(page - 1)
        drawings = pg.get_drawings()
        stats["drawingCount"] = len(drawings)
        for path in drawings:
            if budget is not None and len(segments) >= budget:
                stats["capped"] = True
                break
            layer = _clean_layer_name(path.get("layer") or path.get("oc"))
            if layer:
                layers.add(layer)
            stroke_width = _safe_float(path.get("width"))
            color = _color_to_hex(path.get("color"))
            dashes = path.get("dashes")
            flags = tuple(flag for flag in [
                "vector",
                "dashed" if _has_dash_pattern(dashes) else "",
            ] if flag)
            for item in path.get("items", []) or []:
                if budget is not None and len(segments) >= budget:
                    stats["capped"] = True
                    break
                if not item:
                    continue
                op = str(item[0])
                stats["pathItemCount"] += 1
                if op == "l" and len(item) >= 3:
                    stats["lineItemCount"] += 1
                    _append_vector_line(segments, item[1], item[2], sx, sy, min_line_length, "pdf-vector-line", 0.94, layer, stroke_width, color, flags, regions, img_w, img_h)
                elif op == "re" and len(item) >= 2:
                    stats["rectItemCount"] += 1
                    for p1, p2 in _rect_edges(item[1]):
                        _append_vector_line(segments, p1, p2, sx, sy, min_line_length, "pdf-vector-rect", 0.9, layer, stroke_width, color, flags + ("rect",), regions, img_w, img_h)
                elif op == "qu" and len(item) >= 2:
                    stats["rectItemCount"] += 1
                    for p1, p2 in _quad_edges(item[1]):
                        _append_vector_line(segments, p1, p2, sx, sy, min_line_length, "pdf-vector-quad", 0.9, layer, stroke_width, color, flags + ("quad",), regions, img_w, img_h)
                elif op == "c" and len(item) >= 5:
                    stats["curveItemCount"] += 1
                    points = [_point_xy(item[index]) for index in range(1, 5)]
                    curve_points = _sample_cubic(points, steps=10)
                    for p1, p2 in zip(curve_points, curve_points[1:]):
                        _append_vector_line(segments, p1, p2, sx, sy, max(6.0, min_line_length * 0.42), "pdf-vector-curve", 0.86, layer, stroke_width, color, flags + ("curve",), regions, img_w, img_h)
        doc.close()
    except Exception as exc:
        return [], {**stats, "error": str(exc)}

    stats["layerCount"] = len(layers)
    stats["segmentCount"] = len(segments)
    stats["totalLengthPx"] = round(sum(segment.length for segment in segments), 2)
    return segments, stats


def _append_vector_line(
    segments: list[Segment],
    p1: Any,
    p2: Any,
    sx: float,
    sy: float,
    min_line_length: float,
    source: str,
    confidence: float,
    layer: str | None,
    stroke_width: float | None,
    color: str | None,
    flags: tuple[str, ...],
    exclusion_regions: list[dict[str, Any]],
    img_w: int,
    img_h: int,
) -> None:
    x1, y1 = _point_xy(p1)
    x2, y2 = _point_xy(p2)
    segment = Segment(
        f"vec-{len(segments) + 1}",
        x1 * sx,
        y1 * sy,
        x2 * sx,
        y2 * sy,
        source,
        confidence,
        layer=layer,
        stroke_width=stroke_width,
        color=color,
        flags=flags,
    )
    if segment.length < min_line_length:
        return
    if _segment_excluded(segment, exclusion_regions, img_w, img_h):
        return
    segments.append(segment)


def _point_xy(point: Any) -> tuple[float, float]:
    if hasattr(point, "x") and hasattr(point, "y"):
        return float(point.x), float(point.y)
    if isinstance(point, dict):
        return float(point.get("x", 0.0)), float(point.get("y", 0.0))
    if isinstance(point, (list, tuple)) and len(point) >= 2:
        return float(point[0]), float(point[1])
    return 0.0, 0.0


def _rect_edges(rect: Any) -> list[tuple[tuple[float, float], tuple[float, float]]]:
    if hasattr(rect, "x0"):
        x0, y0, x1, y1 = float(rect.x0), float(rect.y0), float(rect.x1), float(rect.y1)
    elif isinstance(rect, (list, tuple)) and len(rect) >= 4:
        x0, y0, x1, y1 = [float(v) for v in rect[:4]]
    else:
        return []
    return [((x0, y0), (x1, y0)), ((x1, y0), (x1, y1)), ((x1, y1), (x0, y1)), ((x0, y1), (x0, y0))]


def _quad_edges(quad: Any) -> list[tuple[tuple[float, float], tuple[float, float]]]:
    attrs = ["ul", "ur", "lr", "ll"]
    if all(hasattr(quad, attr) for attr in attrs):
        pts = [_point_xy(getattr(quad, attr)) for attr in attrs]
    elif isinstance(quad, (list, tuple)) and len(quad) >= 4:
        pts = [_point_xy(point) for point in quad[:4]]
    else:
        return []
    return list(zip(pts, pts[1:] + pts[:1]))


def _sample_cubic(points: list[tuple[float, float]], steps: int) -> list[tuple[float, float]]:
    if len(points) != 4:
        return points
    p0, p1, p2, p3 = points
    sampled: list[tuple[float, float]] = []
    for i in range(steps + 1):
        t = i / max(steps, 1)
        mt = 1 - t
        x = (mt ** 3) * p0[0] + 3 * (mt ** 2) * t * p1[0] + 3 * mt * (t ** 2) * p2[0] + (t ** 3) * p3[0]
        y = (mt ** 3) * p0[1] + 3 * (mt ** 2) * t * p1[1] + 3 * mt * (t ** 2) * p2[1] + (t ** 3) * p3[1]
        sampled.append((x, y))
    return sampled


def _choose_geometry_segments(
    requested_source: str,
    raster_segments: list[Segment],
    vector_segments: list[Segment],
    img_w: int,
    img_h: int,
    warnings: list[str],
) -> tuple[list[Segment], str, float]:
    min_dim = min(img_w, img_h)
    vector_length = sum(segment.length for segment in vector_segments)
    raster_length = sum(segment.length for segment in raster_segments)
    vector_usable = len(vector_segments) >= 8 and vector_length >= max(500.0, min_dim * 0.42)
    vector_forced_usable = len(vector_segments) > 0 and vector_length >= max(120.0, min_dim * 0.18)
    if requested_source == "raster_cv":
        return raster_segments, "raster-cv", 0.72 if raster_segments else 0.25
    if vector_usable or (requested_source == "pdf_vector" and vector_forced_usable):
        return vector_segments, "pdf-vector", 0.94
    if requested_source == "pdf_vector":
        warnings.append("PDF vector source requested, but usable vector linework was sparse; falling back to raster CV.")
    elif vector_segments:
        warnings.append("Sparse PDF vector linework detected; raster CV used for trace completeness.")
    confidence = 0.72 if raster_segments else 0.25
    if raster_length <= 0 and vector_length > 0:
        return vector_segments, "pdf-vector", 0.62
    return raster_segments, "raster-cv", confidence


def _analysis_quality_flags(chosen_source: str, vector_stats: dict[str, Any], raster_segments: list[Segment], vector_segments: list[Segment]) -> list[str]:
    flags: list[str] = [chosen_source]
    if chosen_source == "pdf-vector":
        flags.append("native_geometry")
        if int(vector_stats.get("layerCount") or 0) > 0:
            flags.append("layered_pdf")
    else:
        flags.append("pixel_traced")
    if len(raster_segments) > 2500 or len(vector_segments) > 2500:
        flags.append("dense_sheet")
    if vector_stats.get("capped"):
        flags.append("vector_budget_capped")
    return flags


def _semantic_exclusion_regions(text_regions: list[dict[str, Any]], symbol_candidates: list[dict[str, Any]], img_w: int, img_h: int) -> list[dict[str, Any]]:
    regions: list[dict[str, Any]] = []
    for region in text_regions:
        regions.append({
            "kind": "text",
            "x": int(region.get("x", 0)),
            "y": int(region.get("y", 0)),
            "w": int(region.get("w", 0)),
            "h": int(region.get("h", 0)),
        })
    for candidate in symbol_candidates[:400]:
        w = int(candidate.get("w", 0))
        h = int(candidate.get("h", 0))
        if w <= 0 or h <= 0:
            continue
        if w > img_w * 0.12 or h > img_h * 0.12:
            continue
        regions.append({
            "kind": "symbol",
            "x": int(candidate.get("x", 0)),
            "y": int(candidate.get("y", 0)),
            "w": w,
            "h": h,
        })
    return regions


def _mask_regions(binary: np.ndarray, regions: list[dict[str, Any]], pad: int) -> np.ndarray:
    if not regions:
        return binary
    masked = binary.copy()
    img_h, img_w = masked.shape[:2]
    for region in regions:
        x = max(0, int(region.get("x", 0)) - pad)
        y = max(0, int(region.get("y", 0)) - pad)
        w = int(region.get("w", region.get("width", 0))) + pad * 2
        h = int(region.get("h", region.get("height", 0))) + pad * 2
        if w <= 0 or h <= 0 or w * h > img_w * img_h * 0.12:
            continue
        masked[y:min(img_h, y + h), x:min(img_w, x + w)] = 0
    return masked


def detect_line_segments(
    gray: np.ndarray,
    binary: np.ndarray,
    min_line_length: float,
    max_lines: int | None,
    exclusion_regions: list[dict[str, Any]] | None = None,
    img_w: int | None = None,
    img_h: int | None = None,
) -> list[Segment]:
    candidates: list[Segment] = []
    regions = exclusion_regions or []

    # Line Segment Detector gives clean vector-like segments on high-quality PDFs.
    try:
        lsd = cv2.createLineSegmentDetector(0)
        detected = lsd.detect(gray)[0]
        if detected is not None:
            for raw in _take_with_budget(detected, None if max_lines is None else max_lines * 3):
                x1, y1, x2, y2 = [float(v) for v in raw[0]]
                seg = Segment("", x1, y1, x2, y2, "lsd", 0.82)
                if seg.length >= min_line_length and not _segment_excluded(seg, regions, img_w, img_h):
                    candidates.append(seg)
    except Exception:
        pass

    edges = cv2.Canny(binary, 50, 150, apertureSize=3)
    hough = cv2.HoughLinesP(
        edges,
        rho=1,
        theta=np.pi / 180,
        threshold=60,
        minLineLength=max(10, int(min_line_length)),
        maxLineGap=max(6, int(min_line_length * 0.18)),
    )
    if hough is not None:
        for raw in _take_with_budget(hough, None if max_lines is None else max_lines * 4):
            x1, y1, x2, y2 = [float(v) for v in raw[0]]
            seg = Segment("", x1, y1, x2, y2, "hough", 0.74)
            if seg.length >= min_line_length and not _segment_excluded(seg, regions, img_w, img_h):
                candidates.append(seg)

    deduped = _dedupe_segments(candidates)
    deduped.sort(key=lambda s: (-s.length, s.y1, s.x1))
    ordered = [
        Segment(f"ln-{index + 1}", s.x1, s.y1, s.x2, s.y2, s.source, s.confidence)
        for index, s in enumerate(_take_with_budget(deduped, max_lines))
    ]
    return ordered


def detect_circles(gray: np.ndarray, img_w: int, img_h: int, text_regions: list[dict[str, Any]], max_regions: int) -> list[dict[str, Any]]:
    blurred = cv2.medianBlur(gray, 5)
    min_dim = min(img_w, img_h)
    circles = cv2.HoughCircles(
        blurred,
        cv2.HOUGH_GRADIENT,
        dp=1.35,
        minDist=max(28, min_dim * 0.018),
        param1=100,
        param2=62,
        minRadius=max(7, int(min_dim * 0.003)),
        maxRadius=max(18, int(min_dim * 0.024)),
    )
    if circles is None:
        return []
    result: list[dict[str, Any]] = []
    seen: list[tuple[int, int, int]] = []
    for c in np.round(circles[0]).astype(int):
        cx, cy, radius = [int(v) for v in c]
        if radius <= 0:
            continue
        if _point_in_sheet_margin(cx, cy, img_w, img_h) or _point_in_title_block(cx, cy, img_w, img_h):
            continue
        if _circle_hits_text_region(cx, cy, radius, text_regions):
            continue
        if not _circle_has_clean_ring(gray, cx, cy, radius):
            continue
        if any(math.hypot(cx - sx, cy - sy) < (radius + sr) * 0.72 for sx, sy, sr in seen):
            continue
        seen.append((cx, cy, radius))
        result.append({
            "id": f"cir-{len(result) + 1}",
            "cx": cx,
            "cy": cy,
            "radius": radius,
            "bbox": {"x": cx - radius, "y": cy - radius, "width": radius * 2, "height": radius * 2},
            "confidence": 0.72,
            "source": "hough-circle",
        })
        if len(result) >= max_regions:
            break
    return result


def _circle_hits_text_region(cx: int, cy: int, radius: int, text_regions: list[dict[str, Any]]) -> bool:
    circle_box = {
        "x": cx - radius,
        "y": cy - radius,
        "width": radius * 2,
        "height": radius * 2,
    }
    circle_area = max(1, circle_box["width"] * circle_box["height"])
    for region in text_regions:
        rx = int(region.get("x", 0))
        ry = int(region.get("y", 0))
        rw = int(region.get("w", region.get("width", 0)))
        rh = int(region.get("h", region.get("height", 0)))
        if rw <= 0 or rh <= 0:
            continue
        pad = max(4, int(radius * 0.22))
        region_box = {"x": rx - pad, "y": ry - pad, "width": rw + pad * 2, "height": rh + pad * 2}
        overlap_w = min(circle_box["x"] + circle_box["width"], region_box["x"] + region_box["width"]) - max(circle_box["x"], region_box["x"])
        overlap_h = min(circle_box["y"] + circle_box["height"], region_box["y"] + region_box["height"]) - max(circle_box["y"], region_box["y"])
        if overlap_w <= 0 or overlap_h <= 0:
            continue
        if (overlap_w * overlap_h) / circle_area > 0.18:
            return True
    return False


def _circle_has_clean_ring(gray: np.ndarray, cx: int, cy: int, radius: int) -> bool:
    img_h, img_w = gray.shape
    pad = max(3, int(radius * 0.22))
    x1 = max(0, cx - radius - pad)
    y1 = max(0, cy - radius - pad)
    x2 = min(img_w, cx + radius + pad)
    y2 = min(img_h, cy + radius + pad)
    if x2 <= x1 or y2 <= y1:
        return False
    crop = gray[y1:y2, x1:x2]
    edges = cv2.Canny(crop, 60, 160)
    yy, xx = np.indices(edges.shape)
    local_cx = cx - x1
    local_cy = cy - y1
    dist = np.sqrt((xx - local_cx) ** 2 + (yy - local_cy) ** 2)
    ring_mask = (dist >= radius - max(2, radius * 0.16)) & (dist <= radius + max(2, radius * 0.16))
    inner_mask = dist < radius * 0.55
    if int(np.count_nonzero(ring_mask)) == 0:
        return False
    ring_density = float(np.count_nonzero(edges[ring_mask])) / float(np.count_nonzero(ring_mask))
    inner_density = float(np.count_nonzero(edges[inner_mask])) / max(float(np.count_nonzero(inner_mask)), 1.0)
    return 0.018 <= ring_density <= 0.42 and inner_density <= 0.22


def detect_contours(binary: np.ndarray, img_w: int, img_h: int, max_regions: int) -> list[dict[str, Any]]:
    contours, _ = cv2.findContours(binary, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    min_area = max(90, int(img_w * img_h * 0.000012))
    max_area = img_w * img_h * 0.18
    results: list[dict[str, Any]] = []
    for contour in contours:
        area = float(cv2.contourArea(contour))
        if area < min_area or area > max_area:
            continue
        x, y, w, h = cv2.boundingRect(contour)
        if w < 6 or h < 6:
            continue
        perimeter = float(cv2.arcLength(contour, True))
        approx = cv2.approxPolyDP(contour, 0.025 * perimeter, True) if perimeter > 0 else contour
        points = [
            {"x": int(point[0][0]), "y": int(point[0][1])}
            for point in approx[:16]
        ]
        results.append({
            "x": int(x),
            "y": int(y),
            "w": int(w),
            "h": int(h),
            "area": round(area, 2),
            "perimeter": round(perimeter, 2),
            "pointCount": int(len(approx)),
            "points": points,
            "bbox": {"x": int(x), "y": int(y), "width": int(w), "height": int(h)},
            "confidence": 0.56,
            "source": "opencv-contour",
        })
    results.sort(key=lambda r: (-float(r["area"]), int(r["y"]), int(r["x"])))
    return [
        {"id": f"ctr-{idx + 1}", **contour}
        for idx, contour in enumerate(results[:max_regions])
    ]


def build_polylines(segments: list[Segment], systems: list[dict[str, Any]], max_regions: int) -> list[dict[str, Any]]:
    by_id = {segment.id: segment for segment in segments}
    polylines: list[dict[str, Any]] = []
    for system in systems[:max_regions]:
        component = [by_id[sid] for sid in system.get("segmentIds", []) if sid in by_id]
        if not component:
            continue
        ordered_points = _greedy_segment_chain(component)
        bounds = _component_bounds(component)
        polylines.append({
            "id": f"pl-{len(polylines) + 1}",
            "source": "system-chain",
            "systemId": system.get("id"),
            "label": system.get("label"),
            "segmentIds": [segment.id for segment in component],
            "pointCount": len(ordered_points),
            "points": ordered_points[:240],
            "pointLimitApplied": len(ordered_points) > 240,
            "lengthPx": round(sum(segment.length for segment in component), 2),
            "bbox": bounds,
            "closed": _polyline_closed(ordered_points),
            "confidence": round(float(system.get("confidence", 0.5)), 3),
        })
    return polylines


def _greedy_segment_chain(segments: list[Segment]) -> list[dict[str, float]]:
    remaining = segments[:]
    first = remaining.pop(0)
    points: list[tuple[float, float]] = [(first.x1, first.y1), (first.x2, first.y2)]
    while remaining and len(points) < 500:
        end = points[-1]
        best_index = -1
        best_reversed = False
        best_distance = float("inf")
        for idx, segment in enumerate(remaining):
            d_start = math.hypot(segment.x1 - end[0], segment.y1 - end[1])
            d_end = math.hypot(segment.x2 - end[0], segment.y2 - end[1])
            if d_start < best_distance:
                best_index = idx
                best_reversed = False
                best_distance = d_start
            if d_end < best_distance:
                best_index = idx
                best_reversed = True
                best_distance = d_end
        if best_index < 0:
            break
        segment = remaining.pop(best_index)
        points.append((segment.x1, segment.y1) if best_reversed else (segment.x2, segment.y2))
    return [{"x": round(x, 2), "y": round(y, 2)} for x, y in points]


def _polyline_closed(points: list[dict[str, float]]) -> bool:
    if len(points) < 3:
        return False
    first = points[0]
    last = points[-1]
    return math.hypot(float(last["x"]) - float(first["x"]), float(last["y"]) - float(first["y"])) <= 8


def _point_in_sheet_margin(x: float, y: float, img_w: int, img_h: int) -> bool:
    margin_x = img_w * 0.018
    margin_y = img_h * 0.018
    return x < margin_x or x > img_w - margin_x or y < margin_y or y > img_h - margin_y


def _point_in_title_block(x: float, y: float, img_w: int, img_h: int) -> bool:
    return (x > img_w * 0.60 and y > img_h * 0.74) or (y > img_h * 0.91)


def _normalize_geometry_source(value: str) -> str:
    normalized = str(value or "auto").strip().lower().replace("-", "_")
    if normalized in {"pdf", "vector", "pdf_native", "pdf_vector"}:
        return "pdf_vector"
    if normalized in {"raster", "cv", "opencv", "raster_cv"}:
        return "raster_cv"
    return "auto"


def _clean_layer_name(value: Any) -> str | None:
    text = str(value or "").strip()
    return text or None


def _safe_float(value: Any) -> float | None:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return number if math.isfinite(number) else None


def _color_to_hex(value: Any) -> str | None:
    if not isinstance(value, (list, tuple)) or len(value) < 3:
        return None
    try:
        r, g, b = [max(0, min(255, int(round(float(component) * 255)))) for component in value[:3]]
        return f"#{r:02x}{g:02x}{b:02x}"
    except (TypeError, ValueError):
        return None


def _has_dash_pattern(value: Any) -> bool:
    text = str(value or "").strip()
    if not text or text in {"[] 0", "[] 0.0", "None"}:
        return False
    return any(char.isdigit() and char != "0" for char in text)


def _segment_midpoint(segment: Segment) -> tuple[float, float]:
    return (segment.x1 + segment.x2) / 2, (segment.y1 + segment.y2) / 2


def _segment_for_topology(segment: Segment, img_w: int, img_h: int) -> bool:
    mx, my = _segment_midpoint(segment)
    if _point_in_title_block(mx, my, img_w, img_h):
        return False
    horizontal = abs(segment.y2 - segment.y1) <= max(3.0, segment.length * 0.025)
    vertical = abs(segment.x2 - segment.x1) <= max(3.0, segment.length * 0.025)
    if horizontal and (my < img_h * 0.035 or my > img_h * 0.955):
        return False
    if vertical and (mx < img_w * 0.045 or mx > img_w * 0.955):
        return False
    if segment.length > img_w * 0.72 and (my < img_h * 0.08 or my > img_h * 0.88):
        return False
    if segment.length > img_h * 0.72 and (mx < img_w * 0.08 or mx > img_w * 0.92):
        return False
    return True


def _segment_excluded(segment: Segment, regions: list[dict[str, Any]], img_w: int | None, img_h: int | None) -> bool:
    mx, my = _segment_midpoint(segment)
    if img_w and img_h and (_point_in_title_block(mx, my, img_w, img_h) or _point_in_sheet_margin(mx, my, img_w, img_h)):
        return True
    if not regions:
        return False
    overlap = _segment_region_overlap_ratio(segment, regions)
    if overlap >= 0.42:
        return True
    return segment.length < 160 and overlap >= 0.22


def _segment_region_overlap_ratio(segment: Segment, regions: list[dict[str, Any]]) -> float:
    if segment.length <= 0:
        return 0.0
    samples = max(8, min(42, int(segment.length / 24)))
    hits = 0
    for index in range(samples + 1):
        t = index / samples
        x = segment.x1 + (segment.x2 - segment.x1) * t
        y = segment.y1 + (segment.y2 - segment.y1) * t
        if _point_in_any_region(x, y, regions):
            hits += 1
    return hits / (samples + 1)


def _point_in_any_region(x: float, y: float, regions: list[dict[str, Any]]) -> bool:
    for region in regions:
        pad = 4 if region.get("kind") == "text" else 2
        rx = float(region.get("x", 0)) - pad
        ry = float(region.get("y", 0)) - pad
        rw = float(region.get("w", region.get("width", 0))) + pad * 2
        rh = float(region.get("h", region.get("height", 0))) + pad * 2
        if rw <= 0 or rh <= 0:
            continue
        if rx <= x <= rx + rw and ry <= y <= ry + rh:
            return True
    return False


def merge_collinear_segments(segments: list[Segment], snap_tolerance: float) -> list[Segment]:
    if len(segments) < 2:
        return [
            Segment(f"ln-{idx + 1}", s.x1, s.y1, s.x2, s.y2, s.source, s.confidence, s.layer, s.stroke_width, s.color, s.flags)
            for idx, s in enumerate(segments)
        ]

    angle_tol = 4.0
    max_perp = max(4.0, snap_tolerance * 0.72)
    max_gap = max(10.0, snap_tolerance * 1.8)
    groups: list[dict[str, Any]] = []
    ordered = sorted(segments, key=lambda s: (-s.length, s.y1, s.x1))
    for segment in ordered:
        matched: dict[str, Any] | None = None
        for group in groups:
            if _same_collinear_group(segment, group, angle_tol, max_perp, max_gap):
                matched = group
                break
        if matched is None:
            ux, uy = _segment_unit(segment)
            matched = {
                "ux": ux,
                "uy": uy,
                "origin": (segment.x1, segment.y1),
                "segments": [],
                "layers": set(),
                "colors": set(),
                "strokeWidths": [],
            }
            groups.append(matched)
        matched["segments"].append(segment)
        if segment.layer:
            matched["layers"].add(segment.layer)
        if segment.color:
            matched["colors"].add(segment.color)
        if segment.stroke_width is not None:
            matched["strokeWidths"].append(segment.stroke_width)

    merged: list[Segment] = []
    for group in groups:
        members: list[Segment] = group["segments"]
        if len(members) == 1:
            s = members[0]
            merged.append(Segment("", s.x1, s.y1, s.x2, s.y2, s.source, s.confidence, s.layer, s.stroke_width, s.color, s.flags))
            continue
        ux, uy = float(group["ux"]), float(group["uy"])
        px, py = -uy, ux
        ox, oy = group["origin"]
        projections: list[float] = []
        perps: list[float] = []
        for s in members:
            for x, y in [(s.x1, s.y1), (s.x2, s.y2)]:
                dx, dy = x - ox, y - oy
                projections.append(dx * ux + dy * uy)
                perps.append(dx * px + dy * py)
        min_proj, max_proj = min(projections), max(projections)
        mean_perp = sum(perps) / max(len(perps), 1)
        x1 = ox + ux * min_proj + px * mean_perp
        y1 = oy + uy * min_proj + py * mean_perp
        x2 = ox + ux * max_proj + px * mean_perp
        y2 = oy + uy * max_proj + py * mean_perp
        source = _common_value([s.source for s in members]) or "merged-linework"
        layer = _common_value(list(group["layers"]))
        color = _common_value(list(group["colors"]))
        stroke_width = None
        if group["strokeWidths"]:
            stroke_width = sum(float(v) for v in group["strokeWidths"]) / len(group["strokeWidths"])
        confidence = min(0.98, (sum(s.confidence * s.length for s in members) / max(sum(s.length for s in members), 1.0)) + 0.03)
        flags = tuple(sorted(set(flag for s in members for flag in s.flags) | {"merged"}))
        merged.append(Segment("", x1, y1, x2, y2, source, confidence, layer, stroke_width, color, flags))

    merged.sort(key=lambda s: (-s.length, s.y1, s.x1))
    return [
        Segment(f"ln-{index + 1}", s.x1, s.y1, s.x2, s.y2, s.source, s.confidence, s.layer, s.stroke_width, s.color, s.flags)
        for index, s in enumerate(merged)
    ]


def _same_collinear_group(segment: Segment, group: dict[str, Any], angle_tol: float, max_perp: float, max_gap: float) -> bool:
    members: list[Segment] = group["segments"]
    if not members:
        return False
    if segment.layer and group["layers"] and segment.layer not in group["layers"]:
        return False
    ux, uy = float(group["ux"]), float(group["uy"])
    sux, suy = _segment_unit(segment)
    dot = abs(ux * sux + uy * suy)
    angle = math.degrees(math.acos(max(-1.0, min(1.0, dot))))
    if angle > angle_tol:
        return False
    px, py = -uy, ux
    ox, oy = group["origin"]
    seg_projs: list[float] = []
    seg_perps: list[float] = []
    for x, y in [(segment.x1, segment.y1), (segment.x2, segment.y2)]:
        dx, dy = x - ox, y - oy
        seg_projs.append(dx * ux + dy * uy)
        seg_perps.append(abs(dx * px + dy * py))
    if max(seg_perps) > max_perp:
        return False
    group_projs = [
        (x - ox) * ux + (y - oy) * uy
        for s in members
        for x, y in [(s.x1, s.y1), (s.x2, s.y2)]
    ]
    return _interval_gap(min(seg_projs), max(seg_projs), min(group_projs), max(group_projs)) <= max_gap


def _segment_unit(segment: Segment) -> tuple[float, float]:
    length = max(segment.length, 0.0001)
    ux = (segment.x2 - segment.x1) / length
    uy = (segment.y2 - segment.y1) / length
    if ux < 0 or (abs(ux) < 0.0001 and uy < 0):
        ux, uy = -ux, -uy
    return ux, uy


def _interval_gap(a0: float, a1: float, b0: float, b1: float) -> float:
    if a1 < b0:
        return b0 - a1
    if b1 < a0:
        return a0 - b1
    return 0.0


def _common_value(values: list[Any]) -> Any:
    if not values:
        return None
    first = values[0]
    return first if all(value == first for value in values) else None


def detect_text_regions(gray: np.ndarray, max_regions: int) -> list[dict[str, Any]]:
    _, binary = cv2.threshold(gray, 210, 255, cv2.THRESH_BINARY_INV)
    horizontal_kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (24, 5))
    merged = cv2.dilate(binary, horizontal_kernel, iterations=2)
    contours, _ = cv2.findContours(merged, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    regions: list[dict[str, Any]] = []
    img_h, img_w = gray.shape
    min_area = max(80, int(img_w * img_h * 0.000015))
    for contour in contours:
        x, y, w, h = cv2.boundingRect(contour)
        if w * h < min_area or w < 18 or h < 6:
            continue
        if w > img_w * 0.75 or h > img_h * 0.18:
            continue
        aspect = w / max(h, 1)
        if aspect < 1.2:
            continue
        regions.append({
            "x": int(x),
            "y": int(y),
            "w": int(w),
            "h": int(h),
            "area": int(w * h),
            "aspect": round(float(aspect), 2),
            "confidence": 0.58,
            "source": "morph-text-region",
        })
    regions.sort(key=lambda r: (r["y"], r["x"]))
    return [
        {"id": f"txt-{idx + 1}", **region}
        for idx, region in enumerate(regions[:max_regions])
    ]


def trace_linear_systems(segments: list[Segment], preset: str, snap_tolerance: float, img_w: int, img_h: int) -> list[dict[str, Any]]:
    topology_segments = [segment for segment in segments if _segment_for_topology(segment, img_w, img_h)]
    if not topology_segments:
        return []

    nodes: list[dict[str, Any]] = []
    segment_nodes: dict[str, tuple[int, int]] = {}
    adjacency: dict[int, list[tuple[int, Segment]]] = defaultdict(list)

    for segment in topology_segments:
        a = _snap_node(nodes, segment.x1, segment.y1, snap_tolerance)
        b = _snap_node(nodes, segment.x2, segment.y2, snap_tolerance)
        if a == b:
            continue
        segment_nodes[segment.id] = (a, b)
        adjacency[a].append((b, segment))
        adjacency[b].append((a, segment))

    seen: set[str] = set()
    systems: list[dict[str, Any]] = []
    preset_label = _preset_label(preset)

    for segment in topology_segments:
        if segment.id in seen or segment.id not in segment_nodes:
            continue
        queue = deque([segment.id])
        component_ids: list[str] = []
        component_nodes: set[int] = set()
        while queue:
            current_id = queue.popleft()
            if current_id in seen:
                continue
            seen.add(current_id)
            component_ids.append(current_id)
            a, b = segment_nodes[current_id]
            component_nodes.update([a, b])
            for node_id in (a, b):
                for _neighbor, neighbor_seg in adjacency[node_id]:
                    if neighbor_seg.id not in seen:
                        queue.append(neighbor_seg.id)

        component_segments = [s for s in topology_segments if s.id in set(component_ids)]
        if len(component_segments) == 0:
            continue
        if _component_noise(component_segments, component_nodes, adjacency, img_w, img_h):
            continue

        fitting_counts = _infer_fittings(component_nodes, adjacency)
        crossing_count = _count_component_crossings(component_segments, snap_tolerance)
        junctions = _component_junction_summary(component_nodes, adjacency, crossing_count)
        bounds = _component_bounds(component_segments)
        length_px = sum(s.length for s in component_segments)
        confidence = _system_confidence(component_segments, component_nodes, adjacency, crossing_count)
        system_index = len(systems) + 1
        systems.append({
            "id": f"sys-{system_index}",
            "label": f"{preset_label} run {system_index}",
            "preset": preset,
            "source": _system_source(component_segments),
            "segmentIds": component_ids,
            "segmentCount": len(component_segments),
            "nodeCount": len(component_nodes),
            "lengthPx": round(length_px, 2),
            "bbox": bounds,
            "counts": fitting_counts,
            "junctions": junctions,
            "layers": sorted({s.layer for s in component_segments if s.layer}),
            "confidence": round(confidence, 3),
            "warnings": _system_warnings(fitting_counts, component_segments, crossing_count),
            "qualityFlags": _system_quality_flags(component_segments, crossing_count),
        })

    systems.sort(key=lambda s: (-float(s["lengthPx"]), str(s["id"])))
    if systems:
        min_dim = min(img_w, img_h)
        minimum_meaningful_length = max(520.0, min_dim * 0.16)
        strong_systems = [
            system
            for system in systems
            if float(system["lengthPx"]) >= minimum_meaningful_length
            or (int(system["segmentCount"]) >= 8 and float(system["lengthPx"]) >= minimum_meaningful_length * 0.75)
        ]
        if float(systems[0]["lengthPx"]) < minimum_meaningful_length:
            systems = []
        elif len(strong_systems) >= max(3, min(len(systems), 8)):
            systems = strong_systems
    return [
        {**system, "id": f"sys-{idx + 1}", "label": f"{preset_label} run {idx + 1}"}
        for idx, system in enumerate(systems)
    ]


def _to_gray(img: np.ndarray) -> np.ndarray:
    if len(img.shape) > 2:
        return cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    return img


def _binary_drawing_mask(gray: np.ndarray) -> np.ndarray:
    blurred = cv2.GaussianBlur(gray, (3, 3), 0)
    adaptive = cv2.adaptiveThreshold(
        blurred,
        255,
        cv2.ADAPTIVE_THRESH_GAUSSIAN_C,
        cv2.THRESH_BINARY_INV,
        31,
        12,
    )
    return adaptive


def _clean_linework(binary: np.ndarray) -> np.ndarray:
    close_kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (3, 3))
    open_kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (2, 2))
    closed = cv2.morphologyEx(binary, cv2.MORPH_CLOSE, close_kernel, iterations=1)
    return cv2.morphologyEx(closed, cv2.MORPH_OPEN, open_kernel, iterations=1)


def _default_min_line_length(img_w: int, img_h: int, preset: str) -> float:
    base = min(img_w, img_h)
    if preset in {"mechanical_piping", "plumbing", "fire_protection", "ductwork", "electrical"}:
        return max(22.0, base * 0.012)
    if preset in {"structural", "civil_linear"}:
        return max(36.0, base * 0.018)
    return max(28.0, base * 0.014)


def _dedupe_segments(segments: list[Segment]) -> list[Segment]:
    best_by_bucket: dict[tuple[int, int, int, int], Segment] = {}
    for seg in segments:
        if seg.length <= 0:
            continue
        mx = (seg.x1 + seg.x2) / 2
        my = (seg.y1 + seg.y2) / 2
        bucket = (
            int(mx / MIDPOINT_BUCKET_PX),
            int(my / MIDPOINT_BUCKET_PX),
            int(seg.angle / ANGLE_BUCKET_DEGREES),
            int(seg.length / 12),
        )
        existing = best_by_bucket.get(bucket)
        if existing is None or (seg.confidence, seg.length) > (existing.confidence, existing.length):
            best_by_bucket[bucket] = seg
    return list(best_by_bucket.values())


def _normalize_symbol_candidates(candidates: list[dict[str, Any]]) -> list[dict[str, Any]]:
    normalized = []
    for idx, c in enumerate(candidates):
        normalized.append({
            "id": f"sym-{idx + 1}",
            "x": int(c.get("x", 0)),
            "y": int(c.get("y", 0)),
            "w": int(c.get("w", 0)),
            "h": int(c.get("h", 0)),
            "area": int(c.get("area", 0)),
            "cx": float(c.get("cx", 0)),
            "cy": float(c.get("cy", 0)),
            "aspect": float(c.get("aspect", 0)),
            "confidence": 0.52,
            "source": "connected-component",
        })
    return normalized


def _snap_node(nodes: list[dict[str, Any]], x: float, y: float, tolerance: float) -> int:
    best_idx = -1
    best_dist = tolerance
    for idx, node in enumerate(nodes):
        dist = math.hypot(float(node["x"]) - x, float(node["y"]) - y)
        if dist <= best_dist:
            best_dist = dist
            best_idx = idx
    if best_idx >= 0:
        node = nodes[best_idx]
        count = int(node.get("count", 1))
        node["x"] = (float(node["x"]) * count + x) / (count + 1)
        node["y"] = (float(node["y"]) * count + y) / (count + 1)
        node["count"] = count + 1
        return best_idx
    nodes.append({"x": x, "y": y, "count": 1})
    return len(nodes) - 1


def _infer_fittings(component_nodes: set[int], adjacency: dict[int, list[tuple[int, Segment]]]) -> dict[str, int]:
    counts = {
        "openEnds": 0,
        "elbows45": 0,
        "elbows90": 0,
        "bends": 0,
        "tees": 0,
        "crosses": 0,
        "transitions": 0,
    }
    for node_id in component_nodes:
        connected = adjacency[node_id]
        degree = len(connected)
        if degree <= 1:
            counts["openEnds"] += 1
        elif degree == 2:
            angle = _bend_angle(connected[0][1], connected[1][1])
            if angle >= 75:
                counts["elbows90"] += 1
            elif angle >= 30:
                counts["elbows45"] += 1
            elif angle >= 12:
                counts["bends"] += 1
        elif degree == 3:
            counts["tees"] += 1
        else:
            counts["crosses"] += 1
    return counts


def _bend_angle(a: Segment, b: Segment) -> float:
    angle = abs(a.angle - b.angle)
    if angle > 90:
        angle = 180 - angle
    return float(angle)


def _component_bounds(segments: list[Segment]) -> dict[str, float]:
    xs = [coord for s in segments for coord in (s.x1, s.x2)]
    ys = [coord for s in segments for coord in (s.y1, s.y2)]
    min_x, max_x = min(xs), max(xs)
    min_y, max_y = min(ys), max(ys)
    return {
        "x": round(min_x, 2),
        "y": round(min_y, 2),
        "width": round(max_x - min_x, 2),
        "height": round(max_y - min_y, 2),
    }


def _component_noise(segments: list[Segment], nodes: set[int], adjacency: dict[int, list[tuple[int, Segment]]], img_w: int, img_h: int) -> bool:
    length = sum(s.length for s in segments)
    bounds = _component_bounds(segments)
    center_x = float(bounds["x"]) + float(bounds["width"]) / 2
    center_y = float(bounds["y"]) + float(bounds["height"]) / 2
    if _point_in_title_block(center_x, center_y, img_w, img_h):
        return True
    if center_y < img_h * 0.05 or center_y > img_h * 0.95:
        return True
    if center_x < img_w * 0.03 or center_x > img_w * 0.97:
        return True
    if len(segments) == 1 and length < 80:
        return True
    if len(segments) == 1 and length > min(img_w, img_h) * 0.40 and not segments[0].source.startswith("pdf-vector"):
        return True
    if len(nodes) <= 2 and len(segments) <= 2 and length < 120:
        return True
    vector_component = any(segment.source.startswith("pdf-vector") for segment in segments)
    if len(segments) <= 2 and float(bounds["height"]) < 8 and float(bounds["width"]) > img_w * 0.35 and not vector_component:
        return True
    if len(segments) <= 2 and float(bounds["width"]) < 8 and float(bounds["height"]) > img_h * 0.35 and not vector_component:
        return True
    high_degree = any(len(adjacency[n]) >= 3 for n in nodes)
    return len(segments) <= 2 and not high_degree and length < 150


def _system_confidence(segments: list[Segment], nodes: set[int], adjacency: dict[int, list[tuple[int, Segment]]], crossing_count: int = 0) -> float:
    if not segments:
        return 0.0
    avg_segment_confidence = sum(s.confidence for s in segments) / len(segments)
    branch_bonus = 0.08 if any(len(adjacency[n]) >= 3 for n in nodes) else 0.0
    length_bonus = min(0.12, sum(s.length for s in segments) / 5000)
    noise_penalty = 0.12 if len(segments) < 3 else 0.0
    crossing_penalty = min(0.12, crossing_count * 0.025)
    return max(0.1, min(0.96, avg_segment_confidence + branch_bonus + length_bonus - noise_penalty - crossing_penalty))


def _system_warnings(counts: dict[str, int], segments: list[Segment], crossing_count: int = 0) -> list[str]:
    warnings: list[str] = []
    if counts.get("openEnds", 0) > 2:
        warnings.append("multiple_open_ends")
    vector_component = any(segment.source.startswith("pdf-vector") for segment in segments)
    if len(segments) < 3 and not vector_component:
        warnings.append("short_run_candidate")
    if crossing_count > 0:
        warnings.append("unresolved_crossings")
    if any("dashed" in s.flags for s in segments):
        warnings.append("dashed_linework")
    return warnings


def _component_junction_summary(component_nodes: set[int], adjacency: dict[int, list[tuple[int, Segment]]], crossing_count: int) -> dict[str, int]:
    degree_counts = defaultdict(int)
    for node_id in component_nodes:
        degree_counts[len(adjacency[node_id])] += 1
    return {
        "endpoints": int(degree_counts.get(1, 0)),
        "bends": int(degree_counts.get(2, 0)),
        "tees": int(degree_counts.get(3, 0)),
        "crosses": int(sum(count for degree, count in degree_counts.items() if degree >= 4)),
        "geometricCrossings": int(crossing_count),
        "branchNodes": int(sum(count for degree, count in degree_counts.items() if degree >= 3)),
    }


def _count_component_crossings(segments: list[Segment], tolerance: float) -> int:
    count = 0
    max_checks = 25000
    checks = 0
    for i, a in enumerate(segments):
        for b in segments[i + 1:]:
            checks += 1
            if checks > max_checks:
                return count
            if _segments_share_endpoint(a, b, tolerance):
                continue
            if _segments_intersect(a, b):
                count += 1
    return count


def _segments_share_endpoint(a: Segment, b: Segment, tolerance: float) -> bool:
    for ax, ay in [(a.x1, a.y1), (a.x2, a.y2)]:
        for bx, by in [(b.x1, b.y1), (b.x2, b.y2)]:
            if math.hypot(ax - bx, ay - by) <= tolerance:
                return True
    return False


def _segments_intersect(a: Segment, b: Segment) -> bool:
    def orient(px: float, py: float, qx: float, qy: float, rx: float, ry: float) -> float:
        return (qy - py) * (rx - qx) - (qx - px) * (ry - qy)

    a1 = orient(a.x1, a.y1, a.x2, a.y2, b.x1, b.y1)
    a2 = orient(a.x1, a.y1, a.x2, a.y2, b.x2, b.y2)
    b1 = orient(b.x1, b.y1, b.x2, b.y2, a.x1, a.y1)
    b2 = orient(b.x1, b.y1, b.x2, b.y2, a.x2, a.y2)
    return (a1 * a2 < 0) and (b1 * b2 < 0)


def _system_source(segments: list[Segment]) -> str:
    if not segments:
        return "topology"
    if all(segment.source.startswith("pdf-vector") for segment in segments):
        return "pdf-vector-topology"
    if any(segment.source.startswith("pdf-vector") for segment in segments):
        return "hybrid-topology"
    return "opencv-topology"


def _system_quality_flags(segments: list[Segment], crossing_count: int) -> list[str]:
    flags = sorted(set(flag for segment in segments for flag in segment.flags))
    if crossing_count > 0:
        flags.append("crossing_review")
    if len({segment.layer for segment in segments if segment.layer}) > 1:
        flags.append("multi_layer")
    return flags


def _preset_label(preset: str) -> str:
    labels = {
        "mechanical_piping": "Mechanical piping",
        "plumbing": "Plumbing",
        "fire_protection": "Fire protection",
        "ductwork": "Ductwork",
        "electrical": "Electrical",
        "civil_linear": "Civil",
        "structural": "Structural",
    }
    return labels.get(preset, "Detected")


def _payload_bool(payload: dict[str, Any], key: str, default: bool) -> bool:
    value = payload.get(key, default)
    if isinstance(value, bool):
        return value
    if isinstance(value, str):
        return value.strip().lower() in {"1", "true", "yes", "on"}
    return bool(value)


def _clamp(value: float, low: float, high: float) -> float:
    if not math.isfinite(value):
        return low
    return max(low, min(high, value))


def _normalize_limit(value: int | float | None) -> int | None:
    if value is None:
        return None
    try:
        number = int(value)
    except (TypeError, ValueError):
        return None
    return number if number > 0 else None


def _take_with_budget(items: Any, limit: int | None):
    return items if limit is None else items[:limit]


if __name__ == "__main__":
    try:
        payload = json.loads(sys.stdin.read() or "{}")
        result = analyze_page(
            pdf_path=payload["pdfPath"],
            page=int(payload.get("pageNumber", 1)),
            dpi=int(payload.get("dpi", 150)),
            preset=str(payload.get("preset", "generic")),
            geometry_source=str(payload.get("geometrySource", "auto")),
            include_symbols=_payload_bool(payload, "includeSymbols", True),
            include_text_regions=_payload_bool(payload, "includeTextRegions", True),
            include_circles=_payload_bool(payload, "includeCircles", True),
            trace_systems=_payload_bool(payload, "traceSystems", True),
            min_line_length=payload.get("minLineLength"),
            snap_tolerance=payload.get("snapTolerance"),
            max_lines=_normalize_limit(payload.get("maxLines", MAX_DEFAULT_LINES)),
            max_regions=int(payload.get("maxRegions", MAX_DEFAULT_REGIONS)),
            line_sensitivity=float(payload.get("lineSensitivity", 0.62)),
            noise_rejection=float(payload.get("noiseRejection", 0.42)),
        )
        print(json.dumps(result))
    except Exception as exc:
        print(json.dumps({
            "success": False,
            "error": str(exc),
            "schemaVersion": 1,
            "lines": [],
            "circles": [],
            "symbolCandidates": [],
            "textRegions": [],
            "systems": [],
            "warnings": ["analysis_failed"],
        }))
        sys.exit(1)
