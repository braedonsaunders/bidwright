#!/usr/bin/env python3
"""
Point-cloud segmentation — extract planes, pipe runs, and equipment clusters
from an ingested points.bin (stride-16: float32 xyz + uint8 rgba).

Pipeline (numpy + scipy + scikit-learn only, no open3d):
  1. Voxel-downsample to a working set (~1.5M max) keeping the original->working
     mapping so results can reference original point indices.
  2. Iterative RANSAC plane extraction, classified floor/ceiling/wall, with
     occupancy-grid area (L-shaped rooms don't overcount).
  3. DBSCAN clustering of the remainder.
  4. Per-cluster cylinder fitting: PCA axis + sectioned robust circle fits so
     bent runs (elbows) come out as polylines.
  5. Chain pipe candidates into runs across occlusion gaps.

CLI: job JSON on stdin, result JSON on stdout, errors as {"error": ...} with
nonzero exit.
"""
from __future__ import annotations

import json
import math
import sys
import time

import numpy as np
from scipy.spatial import cKDTree
from sklearn.cluster import DBSCAN

STRIDE_DEFAULT = 16
WORKING_MAX = 1_500_000
DBSCAN_MAX = 400_000
PLANE_MIN_FRACTION = 0.03
PLANE_RANSAC_ITERS = 400
PLANE_SCORE_SUBSET = 50_000
CIRCLE_RANSAC_ITERS = 72
SECTION_LENGTH = 0.5
SECTION_MIN_POINTS = 25
PIPE_MIN_INLIER_RATIO = 0.55
CLUSTER_MIN_POINTS = 200
CHAIN_ENDPOINT_DIST = 0.3
CHAIN_MAX_ANGLE_DEG = 20.0
CHAIN_RADIUS_TOL = 0.25
SAMPLE_INDICES_MAX = 5000


class SegmentationError(Exception):
    pass


# ---------------------------------------------------------------------------
# IO + downsampling
# ---------------------------------------------------------------------------

def _read_points_bin(path: str, point_count: int, stride: int) -> np.ndarray:
    raw = np.fromfile(path, dtype=np.uint8)
    if raw.size < point_count * stride:
        raise SegmentationError(
            f"points.bin too small: {raw.size} bytes for {point_count} points at stride {stride}")
    raw = raw[: point_count * stride].reshape(point_count, stride)
    xyz = raw[:, :12].copy().view("<f4").reshape(point_count, 3).astype(np.float64)
    return xyz


def _voxel_working_set(xyz: np.ndarray, voxel: float):
    """Return (working_xyz, rep_orig_idx, inverse, counts).

    inverse maps each original point to its working-set row; counts is
    original points per working point. Voxel size grows if needed to keep
    the working set under WORKING_MAX.
    """
    mins = xyz.min(axis=0)
    v = voxel
    for _ in range(6):
        keys = np.floor((xyz - mins) / v).astype(np.int64)
        dims = keys.max(axis=0) + 1
        flat = (keys[:, 0] * dims[1] + keys[:, 1]) * dims[2] + keys[:, 2]
        uniq, first_idx, inverse, counts = np.unique(
            flat, return_index=True, return_inverse=True, return_counts=True)
        if uniq.size <= WORKING_MAX:
            return xyz[first_idx], first_idx, inverse, counts, v
        v *= (uniq.size / WORKING_MAX) ** (1.0 / 2.0)
    return xyz[first_idx], first_idx, inverse, counts, v


# ---------------------------------------------------------------------------
# Plane extraction
# ---------------------------------------------------------------------------

def _fit_plane_svd(pts: np.ndarray):
    centroid = pts.mean(axis=0)
    _, _, vt = np.linalg.svd(pts - centroid, full_matrices=False)
    normal = vt[2]
    if normal[2] < 0:
        normal = -normal
    return normal, centroid


def _ransac_plane(pts: np.ndarray, thresh: float, rng: np.random.Generator):
    n = pts.shape[0]
    if n < 100:
        return None
    score_pts = pts
    if n > PLANE_SCORE_SUBSET:
        score_pts = pts[rng.choice(n, PLANE_SCORE_SUBSET, replace=False)]

    best_count = -1
    best_model = None
    tri = rng.integers(0, n, size=(PLANE_RANSAC_ITERS, 3))
    p0, p1, p2 = pts[tri[:, 0]], pts[tri[:, 1]], pts[tri[:, 2]]
    normals = np.cross(p1 - p0, p2 - p0)
    norms = np.linalg.norm(normals, axis=1)
    ok = norms > 1e-12
    normals = normals[ok] / norms[ok, None]
    origins = p0[ok]
    for normal, origin in zip(normals, origins):
        d = np.abs((score_pts - origin) @ normal)
        count = int((d <= thresh).sum())
        if count > best_count:
            best_count = count
            best_model = (normal, origin)
    if best_model is None:
        return None

    # Refine on full set, twice
    normal, origin = best_model
    for _ in range(2):
        dist = np.abs((pts - origin) @ normal)
        mask = dist <= thresh
        if mask.sum() < 3:
            return None
        normal, origin = _fit_plane_svd(pts[mask])
    dist = np.abs((pts - origin) @ normal)
    mask = dist <= thresh
    return normal, origin, mask


def _plane_basis(normal: np.ndarray):
    helper = np.array([1.0, 0.0, 0.0]) if abs(normal[0]) < 0.9 else np.array([0.0, 1.0, 0.0])
    e1 = np.cross(normal, helper)
    e1 /= np.linalg.norm(e1)
    e2 = np.cross(normal, e1)
    return e1, e2


def _plane_area(pts: np.ndarray, normal: np.ndarray, origin: np.ndarray, cell: float) -> float:
    """Occupied-cell area on a 2D grid projected onto the plane."""
    e1, e2 = _plane_basis(normal)
    rel = pts - origin
    u = rel @ e1
    v = rel @ e2
    iu = np.floor(u / cell).astype(np.int64)
    iv = np.floor(v / cell).astype(np.int64)
    iu -= iu.min()
    iv -= iv.min()
    flat = iu * (iv.max() + 1) + iv
    occupied = np.unique(flat).size
    return float(occupied * cell * cell)


def _extract_planes(work: np.ndarray, voxel: float, max_planes: int,
                    rng: np.random.Generator):
    n0 = work.shape[0]
    thresh = 1.5 * voxel
    min_inliers = max(int(PLANE_MIN_FRACTION * n0), 200)
    median_z = float(np.median(work[:, 2]))

    remaining = np.arange(n0)
    planes = []
    for _ in range(max_planes):
        pts = work[remaining]
        model = _ransac_plane(pts, thresh, rng)
        if model is None:
            break
        normal, origin, mask = model
        if int(mask.sum()) < min_inliers:
            break
        inlier_idx = remaining[mask]
        inlier_pts = work[inlier_idx]

        nz = abs(float(normal[2]))
        centroid = inlier_pts.mean(axis=0)
        if nz > 0.85:
            detail = "floor" if centroid[2] < median_z else "ceiling"
        elif nz < 0.25:
            detail = "wall"
        else:
            detail = ""
        area = _plane_area(inlier_pts, normal, origin, cell=3.0 * voxel)
        dist = np.abs((inlier_pts - origin) @ normal)
        rmse = float(np.sqrt(np.mean(dist ** 2)))
        confidence = _clamp(1.0 - rmse / thresh, 0.3, 0.98)

        planes.append({
            "normal": [float(v) for v in normal],
            "detail": detail,
            "area": area,
            "centroid": [float(v) for v in centroid],
            "confidence": confidence,
            "workingIdx": inlier_idx,
        })
        remaining = remaining[~mask]
        if remaining.size < min_inliers:
            break
    return planes, remaining


# ---------------------------------------------------------------------------
# Cylinder / pipe fitting
# ---------------------------------------------------------------------------

def _fit_circle_kasa(xy: np.ndarray):
    """Algebraic (Kasa) least-squares circle fit. Returns (cx, cy, r) or None."""
    a = np.column_stack([2.0 * xy[:, 0], 2.0 * xy[:, 1], np.ones(len(xy))])
    b = (xy ** 2).sum(axis=1)
    try:
        sol, *_ = np.linalg.lstsq(a, b, rcond=None)
    except np.linalg.LinAlgError:
        return None
    cx, cy, c = sol
    r2 = c + cx * cx + cy * cy
    if r2 <= 0 or not np.isfinite(r2):
        return None
    return float(cx), float(cy), float(math.sqrt(r2))


def _circle_from_3pts(p: np.ndarray):
    ax, ay = p[0]
    bx, by = p[1]
    cx, cy = p[2]
    d = 2.0 * (ax * (by - cy) + bx * (cy - ay) + cx * (ay - by))
    if abs(d) < 1e-12:
        return None
    a2 = ax * ax + ay * ay
    b2 = bx * bx + by * by
    c2 = cx * cx + cy * cy
    ux = (a2 * (by - cy) + b2 * (cy - ay) + c2 * (ay - by)) / d
    uy = (a2 * (cx - bx) + b2 * (ax - cx) + c2 * (bx - ax)) / d
    r = math.hypot(ax - ux, ay - uy)
    return ux, uy, r


def _robust_circle_fit(xy: np.ndarray, tol: float, r_min: float, r_max: float,
                       rng: np.random.Generator):
    """RANSAC over 3-point algebraic circle fits, refined with Kasa on inliers.

    Returns (cx, cy, r, inlier_ratio, rmse) or None.
    """
    n = xy.shape[0]
    if n < 8:
        return None
    best = None  # (count, -rmse, cx, cy, r, mask)
    tri = rng.integers(0, n, size=(CIRCLE_RANSAC_ITERS, 3))
    for it in range(CIRCLE_RANSAC_ITERS):
        cand = _circle_from_3pts(xy[tri[it]])
        if cand is None:
            continue
        ccx, ccy, cr = cand
        if not (0.5 * r_min <= cr <= 1.5 * r_max):
            continue
        resid = np.abs(np.hypot(xy[:, 0] - ccx, xy[:, 1] - ccy) - cr)
        mask = resid <= tol
        count = int(mask.sum())
        if count < 5:
            continue
        rmse = float(np.sqrt(np.mean(resid[mask] ** 2)))
        key = (count, -rmse)
        if best is None or key > best[0]:
            best = (key, ccx, ccy, cr, mask)
    if best is None:
        return None

    _, ccx, ccy, cr, mask = best
    refined = _fit_circle_kasa(xy[mask])
    if refined is not None and 0.5 * r_min <= refined[2] <= 1.5 * r_max:
        ccx, ccy, cr = refined
        resid = np.abs(np.hypot(xy[:, 0] - ccx, xy[:, 1] - ccy) - cr)
        mask = resid <= tol
        if int(mask.sum()) < 5:
            return None
    resid = np.abs(np.hypot(xy[:, 0] - ccx, xy[:, 1] - ccy) - cr)
    inlier_ratio = float(mask.mean())
    rmse = float(np.sqrt(np.mean(resid[mask] ** 2)))
    return ccx, ccy, cr, inlier_ratio, rmse


def _principal_axis(pts: np.ndarray) -> np.ndarray:
    centered = pts - pts.mean(axis=0)
    cov = centered.T @ centered
    _, vecs = np.linalg.eigh(cov)
    axis = vecs[:, -1]
    return axis / np.linalg.norm(axis)


def _fit_pipe_candidate(pts: np.ndarray, working_idx: np.ndarray, voxel: float,
                        r_min: float, r_max: float, rng: np.random.Generator):
    """Sectioned cylinder fit. Returns pipe-candidate dict or None."""
    axis = _principal_axis(pts)
    t = pts @ axis
    t_min, t_max = float(t.min()), float(t.max())
    extent = t_max - t_min
    if extent < 4.0 * r_min:
        return None

    n_sections = max(1, int(round(extent / SECTION_LENGTH)))
    edges = np.linspace(t_min, t_max, n_sections + 1)
    tol = 2.0 * voxel

    sections = []
    for si in range(n_sections):
        lo, hi = edges[si], edges[si + 1]
        mask = (t >= lo) & (t <= hi) if si == n_sections - 1 else (t >= lo) & (t < hi)
        sec_pts = pts[mask]
        if sec_pts.shape[0] < SECTION_MIN_POINTS:
            continue
        sec_dir = _principal_axis(sec_pts) if sec_pts.shape[0] >= 8 else axis
        if sec_dir @ axis < 0:
            sec_dir = -sec_dir
        e1, e2 = _plane_basis(sec_dir)
        mean = sec_pts.mean(axis=0)
        rel = sec_pts - mean
        xy = np.column_stack([rel @ e1, rel @ e2])
        fit = _robust_circle_fit(xy, tol, r_min, r_max, rng)
        if fit is None:
            continue
        ccx, ccy, cr, ratio, rmse = fit
        center3d = mean + ccx * e1 + ccy * e2
        sections.append({
            "t": 0.5 * (lo + hi),
            "dir": sec_dir,
            "center": center3d,
            "radius": cr,
            "ratio": ratio,
            "rmse": rmse,
            "count": sec_pts.shape[0],
            "proj_lo": float((sec_pts @ sec_dir).min()),
            "proj_hi": float((sec_pts @ sec_dir).max()),
        })

    if not sections:
        return None
    sections.sort(key=lambda s: s["t"])

    weights = np.array([s["count"] for s in sections], dtype=np.float64)
    radius = float(np.median([s["radius"] for s in sections]))
    ratio = float(np.average([s["ratio"] for s in sections], weights=weights))
    rmse = float(np.median([s["rmse"] for s in sections]))

    if not (r_min <= radius <= r_max) or ratio <= PIPE_MIN_INLIER_RATIO:
        return None

    # Polyline through section circle centers, endpoints extended to the
    # extreme point projections so straight pipes report full length.
    centers = [s["center"] for s in sections]
    first, last = sections[0], sections[-1]
    start = first["center"] + first["dir"] * (first["proj_lo"] - float(first["center"] @ first["dir"]))
    end = last["center"] + last["dir"] * (last["proj_hi"] - float(last["center"] @ last["dir"]))
    polyline = [start] + centers + [end]
    # Drop near-duplicate consecutive vertices
    cleaned = [polyline[0]]
    for p in polyline[1:]:
        if np.linalg.norm(p - cleaned[-1]) > 0.25 * voxel:
            cleaned.append(p)
    if len(cleaned) < 2:
        return None
    polyline = np.array(cleaned)
    length = float(np.linalg.norm(np.diff(polyline, axis=0), axis=1).sum())
    if length <= 4.0 * radius:
        return None

    confidence = _clamp(1.0 - rmse / (0.5 * radius), 0.3, 0.98)
    return {
        "polyline": polyline,
        "radius": radius,
        "length": length,
        "confidence": confidence,
        "inlierRatio": ratio,
        "workingIdx": working_idx,
        "count": int(pts.shape[0]),
    }


# ---------------------------------------------------------------------------
# Pipe-run chaining
# ---------------------------------------------------------------------------

def _polyline_end_dir(poly: np.ndarray, at_start: bool) -> np.ndarray:
    d = poly[1] - poly[0] if at_start else poly[-1] - poly[-2]
    n = np.linalg.norm(d)
    return d / n if n > 1e-12 else np.array([0.0, 0.0, 1.0])


def _try_merge(a: dict, b: dict):
    r_a, r_b = a["radius"], b["radius"]
    if abs(r_a - r_b) / max(min(r_a, r_b), 1e-9) > CHAIN_RADIUS_TOL:
        return None
    cos_max = math.cos(math.radians(CHAIN_MAX_ANGLE_DEG))
    pa, pb = a["polyline"], b["polyline"]
    # (a endpoint, b endpoint, reversed_a, reversed_b) — orient so a's tail
    # connects to b's head.
    combos = [
        (pa, pb, pa[-1], pb[0]),
        (pa, pb[::-1], pa[-1], pb[-1]),
        (pa[::-1], pb, pa[0], pb[0]),
        (pa[::-1], pb[::-1], pa[0], pb[-1]),
    ]
    for oa, ob, ea, eb in combos:
        if np.linalg.norm(ea - eb) > CHAIN_ENDPOINT_DIST:
            continue
        dir_a = _polyline_end_dir(oa, at_start=False)
        dir_b = _polyline_end_dir(ob, at_start=True)
        if float(dir_a @ dir_b) < cos_max:
            continue
        merged_poly = np.vstack([oa, ob])
        w_a, w_b = a["count"], b["count"]
        return {
            "polyline": merged_poly,
            "radius": (r_a * w_a + r_b * w_b) / (w_a + w_b),
            "length": float(np.linalg.norm(np.diff(merged_poly, axis=0), axis=1).sum()),
            "confidence": min(a["confidence"], b["confidence"]),
            "inlierRatio": (a["inlierRatio"] * w_a + b["inlierRatio"] * w_b) / (w_a + w_b),
            "workingIdx": np.concatenate([a["workingIdx"], b["workingIdx"]]),
            "count": w_a + w_b,
        }
    return None


def _chain_pipe_runs(cands: list) -> list:
    runs = list(cands)
    merged_any = True
    while merged_any:
        merged_any = False
        for i in range(len(runs)):
            for j in range(i + 1, len(runs)):
                merged = _try_merge(runs[i], runs[j])
                if merged is not None:
                    runs[i] = merged
                    runs.pop(j)
                    merged_any = True
                    break
            if merged_any:
                break
    return runs


# ---------------------------------------------------------------------------
# Segment assembly
# ---------------------------------------------------------------------------

def _clamp(v: float, lo: float, hi: float) -> float:
    return max(lo, min(hi, v))


def _sample_original_indices(working_idx: np.ndarray, inverse: np.ndarray,
                             n_working: int, rng: np.random.Generator):
    """Map working-set indices back to original points.bin indices."""
    lookup = np.zeros(n_working, dtype=bool)
    lookup[working_idx] = True
    orig = np.nonzero(lookup[inverse])[0]
    total = int(orig.size)
    if total > SAMPLE_INDICES_MAX:
        orig = rng.choice(orig, SAMPLE_INDICES_MAX, replace=False)
        orig.sort()
    return [int(i) for i in orig], total


def _bbox_of(pts: np.ndarray) -> dict:
    return {
        "min": [float(v) for v in pts.min(axis=0)],
        "max": [float(v) for v in pts.max(axis=0)],
    }


def segment(job: dict) -> dict:
    start = time.time()

    points_path = job.get("pointsPath")
    point_count = job.get("pointCount")
    if not points_path or not point_count:
        raise SegmentationError("job requires 'pointsPath' and 'pointCount'")
    stride = int(job.get("stride", STRIDE_DEFAULT))
    voxel = float(job.get("voxel", 0.02))
    max_planes = int(job.get("maxPlanes", 8))
    r_min = float(job.get("minPipeRadius", 0.008))
    r_max = float(job.get("maxPipeRadius", 0.4))

    rng = np.random.default_rng(42)
    xyz = _read_points_bin(points_path, int(point_count), stride)
    work, _rep_idx, inverse, _counts, voxel = _voxel_working_set(xyz, voxel)
    n_working = work.shape[0]

    # --- planes ---
    planes, remaining = _extract_planes(work, voxel, max_planes, rng)
    planes_removed = sum(p["workingIdx"].size for p in planes)

    # --- clustering of the remainder ---
    eps = 3.0 * voxel
    clusters: list[np.ndarray] = []  # arrays of working-set indices
    if remaining.size >= SECTION_MIN_POINTS:
        rem_pts = work[remaining]
        if remaining.size > DBSCAN_MAX:
            sub_sel = rng.choice(remaining.size, DBSCAN_MAX, replace=False)
        else:
            sub_sel = np.arange(remaining.size)
        sub_pts = rem_pts[sub_sel]
        labels_sub = DBSCAN(eps=eps, min_samples=15).fit_predict(sub_pts)

        labels = np.full(remaining.size, -1, dtype=np.int64)
        labels[sub_sel] = labels_sub
        if remaining.size > DBSCAN_MAX:
            core_mask = labels_sub != -1
            if core_mask.any():
                tree = cKDTree(sub_pts[core_mask])
                rest_sel = np.setdiff1d(np.arange(remaining.size), sub_sel, assume_unique=False)
                if rest_sel.size:
                    dist, nn = tree.query(rem_pts[rest_sel], k=1,
                                          distance_upper_bound=eps)
                    ok = np.isfinite(dist)
                    labels[rest_sel[ok]] = labels_sub[core_mask][nn[ok]]

        for lbl in np.unique(labels):
            if lbl == -1:
                continue
            clusters.append(remaining[labels == lbl])

    # --- pipe fitting per cluster ---
    pipe_cands = []
    blob_clusters = []
    for widx in clusters:
        pts = work[widx]
        cand = _fit_pipe_candidate(pts, widx, voxel, r_min, r_max, rng)
        if cand is not None:
            pipe_cands.append(cand)
        elif widx.size >= CLUSTER_MIN_POINTS:
            blob_clusters.append(widx)

    pipe_runs = _chain_pipe_runs(pipe_cands)

    # --- assemble segments ---
    segments = []
    seg_no = 0

    def next_id():
        nonlocal seg_no
        seg_no += 1
        return f"seg-{seg_no}"

    for p in planes:
        pts = work[p["workingIdx"]]
        sample, total = _sample_original_indices(p["workingIdx"], inverse, n_working, rng)
        detail = p["detail"]
        name = detail.capitalize() if detail else "Plane"
        segments.append({
            "id": next_id(),
            "kind": "plane",
            "label": f"{name} · {p['area']:.1f} m²",
            "confidence": round(p["confidence"], 3),
            "pointCount": total,
            "polyline": [],
            "radius": None,
            "length": None,
            "area": round(p["area"], 3),
            "normal": [round(v, 5) for v in p["normal"]],
            "kindDetail": detail,
            "centroid": [round(v, 4) for v in pts.mean(axis=0)],
            "bbox": _bbox_of(pts),
            "sampleIndices": sample,
        })

    for run in pipe_runs:
        pts = work[run["workingIdx"]]
        sample, total = _sample_original_indices(run["workingIdx"], inverse, n_working, rng)
        dia_mm = round(2.0 * run["radius"] * 1000.0)
        segments.append({
            "id": next_id(),
            "kind": "pipe-run",
            "label": f"Pipe run · Ø{dia_mm}mm · {run['length']:.1f} m",
            "confidence": round(run["confidence"], 3),
            "pointCount": total,
            "polyline": [[round(float(c), 4) for c in v] for v in run["polyline"]],
            "radius": round(run["radius"], 5),
            "length": round(run["length"], 3),
            "area": None,
            "normal": None,
            "kindDetail": "",
            "centroid": [round(v, 4) for v in pts.mean(axis=0)],
            "bbox": _bbox_of(pts),
            "sampleIndices": sample,
        })

    for widx in blob_clusters:
        pts = work[widx]
        sample, total = _sample_original_indices(widx, inverse, n_working, rng)
        bbox = _bbox_of(pts)
        dims = sorted((np.array(bbox["max"]) - np.array(bbox["min"])).tolist(), reverse=True)
        segments.append({
            "id": next_id(),
            "kind": "cluster",
            "label": f"Cluster · {dims[0]:.1f}×{dims[1]:.1f}×{dims[2]:.1f} m",
            "confidence": 0.5,
            "pointCount": total,
            "polyline": [],
            "radius": None,
            "length": None,
            "area": None,
            "normal": None,
            "kindDetail": "",
            "centroid": [round(v, 4) for v in pts.mean(axis=0)],
            "bbox": bbox,
            "sampleIndices": sample,
        })

    return {
        "segments": segments,
        "stats": {
            "workingPoints": int(n_working),
            "planesRemoved": int(planes_removed),
            "durationMs": int(round((time.time() - start) * 1000)),
        },
    }


if __name__ == "__main__":
    try:
        job = json.loads(sys.stdin.read() or "{}")
        print(json.dumps(segment(job)))
    except SegmentationError as exc:
        print(json.dumps({"error": str(exc), "code": "bad-input"}))
        sys.exit(1)
    except Exception as exc:  # noqa: BLE001
        print(json.dumps({"error": str(exc), "code": "segmentation-failed"}))
        sys.exit(1)
