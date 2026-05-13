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


MAX_DEFAULT_LINES = 1200
MAX_DEFAULT_REGIONS = 220
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
        }


def analyze_page(
    pdf_path: str,
    page: int = 1,
    dpi: int = 150,
    preset: str = "generic",
    include_symbols: bool = True,
    include_text_regions: bool = True,
    include_circles: bool = True,
    trace_systems: bool = True,
    min_line_length: float | None = None,
    snap_tolerance: float | None = None,
    max_lines: int = MAX_DEFAULT_LINES,
    max_regions: int = MAX_DEFAULT_REGIONS,
) -> dict[str, Any]:
    start = time.time()
    warnings: list[str] = []

    img, page_w, page_h, img_w, img_h = render_to_numpy(pdf_path, page, dpi)
    gray = _to_gray(img)
    binary = _binary_drawing_mask(gray)
    cleaned = _clean_linework(binary)

    min_line = float(min_line_length or _default_min_line_length(img_w, img_h, preset))
    snap = float(snap_tolerance or max(8.0, min(img_w, img_h) * 0.0025))

    segments = detect_line_segments(gray, cleaned, min_line, max_lines=max_lines)
    if len(segments) >= max_lines:
        warnings.append(f"Line output capped at {max_lines}; use a higher maxLines for dense sheets.")

    text_regions = detect_text_regions(gray, max_regions=max_regions) if include_text_regions else []
    symbol_candidates = (
        find_symbol_candidates(
            img,
            img_w,
            img_h,
            min_size=max(12, int(min(img_w, img_h) * 0.004)),
            max_size=max(80, int(min(img_w, img_h) * 0.04)),
            min_area=60,
            exclude_borders=True,
            border_margin=max(20, int(min(img_w, img_h) * 0.015)),
        )[:max_regions]
        if include_symbols
        else []
    )
    circles = detect_circles(gray, img_w, img_h, max_regions=max_regions) if include_circles else []
    systems = trace_linear_systems(segments, preset=preset, snap_tolerance=snap) if trace_systems else []

    duration_ms = round((time.time() - start) * 1000)
    return {
        "success": True,
        "schemaVersion": 1,
        "preset": preset,
        "pageNumber": page,
        "dpi": dpi,
        "imageWidth": img_w,
        "imageHeight": img_h,
        "pageWidth": round(float(page_w), 2),
        "pageHeight": round(float(page_h), 2),
        "preprocessing": {
            "threshold": "adaptive-gaussian",
            "morphology": "linework-close-open",
            "minLineLengthPx": round(min_line, 2),
            "snapTolerancePx": round(snap, 2),
        },
        "summary": {
            "lineCount": len(segments),
            "circleCount": len(circles),
            "symbolCandidateCount": len(symbol_candidates),
            "textRegionCount": len(text_regions),
            "systemCount": len(systems),
            "totalSystemLengthPx": round(sum(float(s.get("lengthPx", 0)) for s in systems), 2),
        },
        "lines": [segment.to_json() for segment in segments],
        "circles": circles,
        "symbolCandidates": _normalize_symbol_candidates(symbol_candidates),
        "textRegions": text_regions,
        "systems": systems,
        "warnings": warnings,
        "duration_ms": duration_ms,
    }


def detect_line_segments(gray: np.ndarray, binary: np.ndarray, min_line_length: float, max_lines: int) -> list[Segment]:
    candidates: list[Segment] = []

    # Line Segment Detector gives clean vector-like segments on high-quality PDFs.
    try:
        lsd = cv2.createLineSegmentDetector(0)
        detected = lsd.detect(gray)[0]
        if detected is not None:
            for raw in detected[: max_lines * 3]:
                x1, y1, x2, y2 = [float(v) for v in raw[0]]
                seg = Segment("", x1, y1, x2, y2, "lsd", 0.82)
                if seg.length >= min_line_length:
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
        for raw in hough[: max_lines * 4]:
            x1, y1, x2, y2 = [float(v) for v in raw[0]]
            seg = Segment("", x1, y1, x2, y2, "hough", 0.74)
            if seg.length >= min_line_length:
                candidates.append(seg)

    deduped = _dedupe_segments(candidates)
    deduped.sort(key=lambda s: (-s.length, s.y1, s.x1))
    return [
        Segment(f"ln-{index + 1}", s.x1, s.y1, s.x2, s.y2, s.source, s.confidence)
        for index, s in enumerate(deduped[:max_lines])
    ]


def detect_circles(gray: np.ndarray, img_w: int, img_h: int, max_regions: int) -> list[dict[str, Any]]:
    blurred = cv2.medianBlur(gray, 5)
    min_dim = min(img_w, img_h)
    circles = cv2.HoughCircles(
        blurred,
        cv2.HOUGH_GRADIENT,
        dp=1.4,
        minDist=max(24, min_dim * 0.015),
        param1=100,
        param2=42,
        minRadius=max(6, int(min_dim * 0.003)),
        maxRadius=max(24, int(min_dim * 0.05)),
    )
    if circles is None:
        return []
    result: list[dict[str, Any]] = []
    for idx, c in enumerate(np.round(circles[0]).astype(int)[:max_regions]):
        cx, cy, radius = [int(v) for v in c]
        if radius <= 0:
            continue
        result.append({
            "id": f"cir-{idx + 1}",
            "cx": cx,
            "cy": cy,
            "radius": radius,
            "bbox": {"x": cx - radius, "y": cy - radius, "width": radius * 2, "height": radius * 2},
            "confidence": 0.66,
            "source": "hough-circle",
        })
    return result


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


def trace_linear_systems(segments: list[Segment], preset: str, snap_tolerance: float) -> list[dict[str, Any]]:
    if not segments:
        return []

    nodes: list[dict[str, Any]] = []
    segment_nodes: dict[str, tuple[int, int]] = {}
    adjacency: dict[int, list[tuple[int, Segment]]] = defaultdict(list)

    for segment in segments:
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

    for segment in segments:
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

        component_segments = [s for s in segments if s.id in set(component_ids)]
        if len(component_segments) == 0:
            continue
        if _component_noise(component_segments, component_nodes, adjacency):
            continue

        fitting_counts = _infer_fittings(component_nodes, adjacency)
        bounds = _component_bounds(component_segments)
        length_px = sum(s.length for s in component_segments)
        confidence = _system_confidence(component_segments, component_nodes, adjacency)
        system_index = len(systems) + 1
        systems.append({
            "id": f"sys-{system_index}",
            "label": f"{preset_label} run {system_index}",
            "preset": preset,
            "source": "opencv-topology",
            "segmentIds": component_ids,
            "segmentCount": len(component_segments),
            "nodeCount": len(component_nodes),
            "lengthPx": round(length_px, 2),
            "bbox": bounds,
            "counts": fitting_counts,
            "confidence": round(confidence, 3),
            "warnings": _system_warnings(fitting_counts, component_segments),
        })

    systems.sort(key=lambda s: (-float(s["lengthPx"]), str(s["id"])))
    return [
        {**system, "id": f"sys-{idx + 1}", "label": f"{preset_label} run {idx + 1}"}
        for idx, system in enumerate(systems[:80])
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


def _component_noise(segments: list[Segment], nodes: set[int], adjacency: dict[int, list[tuple[int, Segment]]]) -> bool:
    length = sum(s.length for s in segments)
    if len(segments) == 1 and length < 80:
        return True
    if len(nodes) <= 2 and len(segments) <= 2 and length < 120:
        return True
    high_degree = any(len(adjacency[n]) >= 3 for n in nodes)
    return len(segments) <= 2 and not high_degree and length < 150


def _system_confidence(segments: list[Segment], nodes: set[int], adjacency: dict[int, list[tuple[int, Segment]]]) -> float:
    if not segments:
        return 0.0
    avg_segment_confidence = sum(s.confidence for s in segments) / len(segments)
    branch_bonus = 0.08 if any(len(adjacency[n]) >= 3 for n in nodes) else 0.0
    length_bonus = min(0.12, sum(s.length for s in segments) / 5000)
    noise_penalty = 0.12 if len(segments) < 3 else 0.0
    return max(0.1, min(0.96, avg_segment_confidence + branch_bonus + length_bonus - noise_penalty))


def _system_warnings(counts: dict[str, int], segments: list[Segment]) -> list[str]:
    warnings: list[str] = []
    if counts.get("openEnds", 0) > 2:
        warnings.append("multiple_open_ends")
    if len(segments) < 3:
        warnings.append("short_run_candidate")
    return warnings


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


if __name__ == "__main__":
    try:
        payload = json.loads(sys.stdin.read() or "{}")
        result = analyze_page(
            pdf_path=payload["pdfPath"],
            page=int(payload.get("pageNumber", 1)),
            dpi=int(payload.get("dpi", 150)),
            preset=str(payload.get("preset", "generic")),
            include_symbols=_payload_bool(payload, "includeSymbols", True),
            include_text_regions=_payload_bool(payload, "includeTextRegions", True),
            include_circles=_payload_bool(payload, "includeCircles", True),
            trace_systems=_payload_bool(payload, "traceSystems", True),
            min_line_length=payload.get("minLineLength"),
            snap_tolerance=payload.get("snapTolerance"),
            max_lines=int(payload.get("maxLines", MAX_DEFAULT_LINES)),
            max_regions=int(payload.get("maxRegions", MAX_DEFAULT_REGIONS)),
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
