#!/usr/bin/env python3
"""
Acceptance test for pointcloud_ingest.py + segment_pointcloud.py.

Generates a synthetic scanned room (floor + wall + 3 pipes with noise) as an
ascii PLY, runs the ingest CLI, then the segmentation CLI, and asserts the
recovered geometry against ground truth. Prints PASS/FAIL lines; exits
nonzero on any failure.

Run: python test_pointcloud.py
"""
from __future__ import annotations

import json
import math
import os
import subprocess
import sys
import tempfile

import numpy as np

TOOLS_DIR = os.path.dirname(os.path.abspath(__file__))
INGEST = os.path.join(TOOLS_DIR, "pointcloud_ingest.py")
SEGMENT = os.path.join(TOOLS_DIR, "segment_pointcloud.py")

NOISE_SIGMA = 0.004

failures = 0


def check(name: str, cond: bool, detail: str = ""):
    global failures
    status = "PASS" if cond else "FAIL"
    if not cond:
        failures += 1
    print(f"{status}: {name}" + (f" — {detail}" if detail else ""))


# ---------------------------------------------------------------------------
# Synthetic scene
# ---------------------------------------------------------------------------

def gen_plane_xy(rng, n, x0, x1, y0, y1, z):
    pts = np.column_stack([
        rng.uniform(x0, x1, n),
        rng.uniform(y0, y1, n),
        np.full(n, z),
    ])
    return pts


def gen_plane_xz(rng, n, x0, x1, z0, z1, y):
    pts = np.column_stack([
        rng.uniform(x0, x1, n),
        np.full(n, y),
        rng.uniform(z0, z1, n),
    ])
    return pts


def gen_pipe(rng, n, start, end, radius):
    start = np.asarray(start, dtype=float)
    end = np.asarray(end, dtype=float)
    axis = end - start
    length = np.linalg.norm(axis)
    axis = axis / length
    helper = np.array([1.0, 0.0, 0.0]) if abs(axis[0]) < 0.9 else np.array([0.0, 1.0, 0.0])
    n1 = np.cross(axis, helper)
    n1 /= np.linalg.norm(n1)
    n2 = np.cross(axis, n1)
    t = rng.uniform(0.0, length, n)
    theta = rng.uniform(0.0, 2.0 * math.pi, n)
    return (start[None, :] + t[:, None] * axis[None, :]
            + radius * np.cos(theta)[:, None] * n1[None, :]
            + radius * np.sin(theta)[:, None] * n2[None, :])


def build_scene(rng):
    """Room: floor 6x4 at z=0, wall at y=0, three pipes."""
    parts = [
        gen_plane_xy(rng, 300_000, 0.0, 6.0, 0.0, 4.0, 0.0),          # floor 24 m^2
        gen_plane_xz(rng, 200_000, 0.0, 6.0, 0.0, 2.5, 0.0),           # wall
        gen_pipe(rng, 80_000, (1.0, 2.0, 1.5), (5.0, 2.0, 1.5), 0.025),  # 4 m horizontal
        gen_pipe(rng, 80_000, (4.5, 3.2, 0.2), (4.5, 3.2, 2.7), 0.05),   # 2.5 m vertical
        gen_pipe(rng, 70_000, (1.0, 1.0, 0.6), (2.5, 1.0, 0.6), 0.1),    # L leg 1 (1.5 m)
        gen_pipe(rng, 70_000, (2.5, 1.0, 0.6), (2.5, 1.0, 2.1), 0.1),    # L leg 2 (1.5 m)
    ]
    pts = np.vstack(parts)
    pts += rng.normal(0.0, NOISE_SIGMA, pts.shape)
    return pts


GT_PIPES = [
    {"name": "horizontal 4m r=0.025", "radius": 0.025, "length": 4.0,
     "mid": np.array([3.0, 2.0, 1.5]), "length_tol": 0.10},
    {"name": "vertical 2.5m r=0.05", "radius": 0.05, "length": 2.5,
     "mid": np.array([4.5, 3.2, 1.45]), "length_tol": 0.10},
    {"name": "L-shaped 3m r=0.1", "radius": 0.1, "length": 3.0,
     "mid": np.array([2.5, 1.0, 0.6]), "length_tol": 0.15},
]


def write_ascii_ply(path: str, pts: np.ndarray):
    with open(path, "w") as fh:
        fh.write("ply\n")
        fh.write("format ascii 1.0\n")
        fh.write(f"element vertex {pts.shape[0]}\n")
        fh.write("property float x\nproperty float y\nproperty float z\n")
        fh.write("end_header\n")
        np.savetxt(fh, pts, fmt="%.4f")


def run_tool(script: str, job: dict) -> dict:
    proc = subprocess.run(
        [sys.executable, script],
        input=json.dumps(job).encode(),
        capture_output=True,
        timeout=600,
    )
    try:
        result = json.loads(proc.stdout.decode())
    except json.JSONDecodeError:
        raise RuntimeError(
            f"{os.path.basename(script)} produced invalid JSON "
            f"(exit {proc.returncode}): {proc.stdout[:400]!r} stderr={proc.stderr[:400]!r}")
    if proc.returncode != 0:
        raise RuntimeError(f"{os.path.basename(script)} failed: {result}")
    return result


def main():
    rng = np.random.default_rng(7)

    with tempfile.TemporaryDirectory(prefix="bw-pc-test-") as tmp:
        ply_path = os.path.join(tmp, "room.ply")
        out_dir = os.path.join(tmp, "ingest")

        print("Generating synthetic room scan...")
        pts = build_scene(rng)
        total = pts.shape[0]
        write_ascii_ply(ply_path, pts)
        print(f"  {total} points -> {ply_path} ({os.path.getsize(ply_path)} bytes)")

        # ------------------------------------------------------------------
        # Ingest
        # ------------------------------------------------------------------
        print("Running ingest...")
        ingest = run_tool(INGEST, {
            "path": ply_path,
            "outDir": out_dir,
            "maxPoints": 8_000_000,
        })
        check("ingest pointCount", ingest.get("pointCount") == total,
              f"got {ingest.get('pointCount')}, expected {total}")
        check("ingest sourcePointCount", ingest.get("sourcePointCount") == total)
        check("ingest stride", ingest.get("stride") == 16)
        check("ingest hasColor false", ingest.get("hasColor") is False)

        bin_path = os.path.join(out_dir, ingest.get("file", "points.bin"))
        size = os.path.getsize(bin_path) if os.path.isfile(bin_path) else -1
        check("points.bin size", size == ingest.get("pointCount", 0) * 16,
              f"size={size}, expected {ingest.get('pointCount', 0) * 16}")

        bbox = ingest.get("bbox", {})
        bmin = np.array(bbox.get("min", [0, 0, 0]))
        bmax = np.array(bbox.get("max", [0, 0, 0]))
        extent = bmax - bmin
        gt_extent = pts.max(axis=0) - pts.min(axis=0)
        check("bbox extent sane", bool(np.allclose(extent, gt_extent, atol=0.02)),
              f"extent={extent.round(3).tolist()}, gt={gt_extent.round(3).tolist()}")
        check("bbox centered (offset applied)", bool(np.abs(bmin + bmax).max() < 1e-3),
              f"min+max={(bmin + bmax).round(5).tolist()}")
        offset = np.array(ingest.get("offset", [0, 0, 0]))
        gt_center = (pts.min(axis=0) + pts.max(axis=0)) / 2.0
        check("offset equals bbox center", bool(np.allclose(offset, gt_center, atol=0.02)),
              f"offset={offset.round(3).tolist()}, gt={gt_center.round(3).tolist()}")

        # ------------------------------------------------------------------
        # Segmentation
        # ------------------------------------------------------------------
        print("Running segmentation...")
        seg = run_tool(SEGMENT, {
            "pointsPath": bin_path,
            "pointCount": ingest["pointCount"],
            "stride": 16,
            "voxel": 0.02,
            "maxPlanes": 8,
            "minPipeRadius": 0.008,
            "maxPipeRadius": 0.4,
        })
        segments = seg.get("segments", [])
        stats = seg.get("stats", {})
        print(f"  {len(segments)} segments, workingPoints={stats.get('workingPoints')}, "
              f"planesRemoved={stats.get('planesRemoved')}, "
              f"durationMs={stats.get('durationMs')}")
        for s in segments:
            print(f"    [{s['kind']}] {s['label']} conf={s['confidence']} "
                  f"points={s['pointCount']}")

        planes = [s for s in segments if s["kind"] == "plane"]
        runs = [s for s in segments if s["kind"] == "pipe-run"]

        # Floor plane
        floors = [s for s in planes if s.get("kindDetail") == "floor"]
        check("floor plane found", len(floors) >= 1)
        if floors:
            area = floors[0].get("area") or 0.0
            check("floor area within 25% of 24 m²", abs(area - 24.0) / 24.0 <= 0.25,
                  f"area={area:.2f}")

        # Pipe runs
        check("at least 3 pipe runs", len(runs) >= 3, f"found {len(runs)}")

        # gt center-of-mass proximity requires mapping back to world:
        # segmentation ran on centered coords, so shift gt by -offset.
        matched_ids = set()
        for gt in GT_PIPES:
            gt_mid_local = gt["mid"] - offset
            candidates = []
            for s in runs:
                r = s.get("radius") or 0.0
                if abs(r - gt["radius"]) / gt["radius"] > 0.30:
                    continue
                centroid = np.array(s.get("centroid", [0, 0, 0]))
                candidates.append((float(np.linalg.norm(centroid - gt_mid_local)), s))
            candidates.sort(key=lambda c: c[0])

            if gt["name"].startswith("L-shaped"):
                # one run, or two chained pieces — total length within 15%
                near = [s for d, s in candidates if d < 1.6][:2]
                total_len = sum((s.get("length") or 0.0) for s in near)
                ok_count = 1 <= len(near) <= 2
                ok_len = abs(total_len - gt["length"]) / gt["length"] <= gt["length_tol"]
                check(f"pipe matched: {gt['name']}", ok_count and ok_len,
                      f"runs={len(near)}, totalLength={total_len:.2f} "
                      f"(target {gt['length']} ±{gt['length_tol'] * 100:.0f}%), "
                      f"radii={[s.get('radius') for s in near]}")
                if ok_count and len(near) == 1:
                    check("L-shape recovered as single run", True)
                elif ok_count:
                    check("L-shape recovered as single run", False,
                          f"came back as {len(near)} runs (chained pieces)")
                for s in near:
                    matched_ids.add(s["id"])
            else:
                best = candidates[0][1] if candidates else None
                if best is None:
                    check(f"pipe matched: {gt['name']}", False, "no run with matching radius")
                    continue
                length = best.get("length") or 0.0
                r = best.get("radius") or 0.0
                ok_len = abs(length - gt["length"]) / gt["length"] <= gt["length_tol"]
                ok_r = abs(r - gt["radius"]) / gt["radius"] <= 0.30
                check(f"pipe matched: {gt['name']}", ok_len and ok_r,
                      f"length={length:.2f} (target {gt['length']} "
                      f"±{gt['length_tol'] * 100:.0f}%), radius={r:.4f} "
                      f"(target {gt['radius']} ±30%)")
                matched_ids.add(best["id"])

        # Sample indices valid on every segment
        n_pts = ingest["pointCount"]
        ok_samples = all(
            s.get("sampleIndices")
            and len(s["sampleIndices"]) <= 5000
            and max(s["sampleIndices"]) < n_pts
            and min(s["sampleIndices"]) >= 0
            for s in segments
        )
        check("sampleIndices present and in range", ok_samples)

    print()
    if failures:
        print(f"{failures} check(s) FAILED")
        sys.exit(1)
    print("All checks passed")


if __name__ == "__main__":
    main()
