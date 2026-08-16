#!/usr/bin/env python3
"""
Point-cloud ingest — normalize iOS-LiDAR scan formats into a streamable binary.

Accepts PLY (ascii + binary_little_endian, point clouds or mesh vertices),
LAS/LAZ (chunked, memory-safe for 100M+ point files), E57 (optional pye57),
and XYZ/PTS text files. Emits an interleaved stride-16 little-endian binary:

    float32 x, y, z  (12 bytes)  +  uint8 r, g, b, a  (4 bytes, a=255)

Points are recentered on the bbox center (offset reported in the result) so
float32 keeps millimetre precision even for UTM-scale coordinates, optionally
voxel-downsampled toward maxPoints, and shuffled with a fixed seed so any
prefix of the file is a uniform spatial sample (the viewer streams
progressively).

CLI: job JSON on stdin, result JSON on stdout, errors as {"error": ...} with
nonzero exit.
"""
from __future__ import annotations

import json
import os
import sys
import time

import numpy as np

STRIDE = 16
NEUTRAL_GRAY = 180
TEXT_CHUNK_LINES = 1_000_000
LAS_CHUNK_POINTS = 5_000_000
# Above this many candidate points a full voxel pass (keys + sort) gets risky
# on typical machines; fall back to random subsample instead.
VOXEL_PASS_MAX_POINTS = 150_000_000


class IngestError(Exception):
    def __init__(self, message: str, code: str = "ingest-failed"):
        super().__init__(message)
        self.code = code


# ---------------------------------------------------------------------------
# Format readers — each yields (xyz float64 [N,3], rgb uint8 [N,3] | None)
# ---------------------------------------------------------------------------

def _read_ply(path: str):
    try:
        from plyfile import PlyData
    except ImportError:
        raise IngestError("PLY support requires plyfile", "missing-dependency")

    ply = PlyData.read(path)
    try:
        vertex = ply["vertex"]
    except KeyError:
        raise IngestError("PLY file has no vertex element", "bad-input")

    data = vertex.data
    names = data.dtype.names or ()
    for axis in ("x", "y", "z"):
        if axis not in names:
            raise IngestError(f"PLY vertex element missing '{axis}' property", "bad-input")

    xyz = np.column_stack([
        np.asarray(data["x"], dtype=np.float64),
        np.asarray(data["y"], dtype=np.float64),
        np.asarray(data["z"], dtype=np.float64),
    ])

    rgb = None
    color_names = None
    if all(n in names for n in ("red", "green", "blue")):
        color_names = ("red", "green", "blue")
    elif all(n in names for n in ("r", "g", "b")):
        color_names = ("r", "g", "b")
    if color_names is not None:
        channels = [np.asarray(data[n]) for n in color_names]
        rgb = _normalize_color_channels(channels)

    yield xyz, rgb


def _read_las(path: str):
    try:
        import laspy
    except ImportError:
        raise IngestError("LAS/LAZ support requires laspy[lazrs]", "missing-dependency")

    try:
        with laspy.open(path) as reader:
            dims = None
            for chunk in reader.chunk_iterator(LAS_CHUNK_POINTS):
                if dims is None:
                    dims = set(chunk.point_format.dimension_names)
                xyz = np.column_stack([
                    np.asarray(chunk.x, dtype=np.float64),
                    np.asarray(chunk.y, dtype=np.float64),
                    np.asarray(chunk.z, dtype=np.float64),
                ])
                rgb = None
                if {"red", "green", "blue"} <= dims:
                    channels = [np.asarray(chunk["red"]), np.asarray(chunk["green"]),
                                np.asarray(chunk["blue"])]
                    rgb = _normalize_color_channels(channels)
                yield xyz, rgb
    except IngestError:
        raise
    except Exception as exc:  # laspy raises various backend errors for LAZ
        if path.lower().endswith(".laz") and "laz" in str(exc).lower():
            raise IngestError("LAZ support requires the lazrs backend (laspy[lazrs])",
                              "missing-dependency")
        raise IngestError(f"Failed to read LAS/LAZ file: {exc}", "bad-input")


def _read_e57(path: str):
    try:
        import pye57  # noqa: F401
    except ImportError:
        raise IngestError("e57 support requires pye57", "missing-dependency")
    import pye57

    e57 = pye57.E57(path)
    scan_count = e57.scan_count
    if scan_count == 0:
        raise IngestError("E57 file contains no scans", "bad-input")
    for i in range(scan_count):
        scan = e57.read_scan(i, ignore_missing_fields=True, colors=True, intensity=False)
        if "cartesianX" not in scan:
            continue
        xyz = np.column_stack([
            np.asarray(scan["cartesianX"], dtype=np.float64),
            np.asarray(scan["cartesianY"], dtype=np.float64),
            np.asarray(scan["cartesianZ"], dtype=np.float64),
        ])
        rgb = None
        if all(k in scan for k in ("colorRed", "colorGreen", "colorBlue")):
            channels = [np.asarray(scan["colorRed"]), np.asarray(scan["colorGreen"]),
                        np.asarray(scan["colorBlue"])]
            rgb = _normalize_color_channels(channels)
        yield xyz, rgb


def _read_xyz_text(path: str):
    """x y z [r g b] per line; tolerates commas, comment lines, header lines."""
    with open(path, "r", errors="replace") as fh:
        while True:
            lines = fh.readlines(TEXT_CHUNK_LINES * 40)  # ~40 bytes/line hint
            if not lines:
                break
            rows = []
            color_rows = []
            for line in lines:
                line = line.strip()
                if not line or line.startswith(("#", "//")):
                    continue
                parts = line.replace(",", " ").split()
                if len(parts) < 3:
                    continue
                try:
                    x, y, z = float(parts[0]), float(parts[1]), float(parts[2])
                except ValueError:
                    continue  # header / non-numeric line
                rows.append((x, y, z))
                if len(parts) >= 6:
                    try:
                        color_rows.append((float(parts[3]), float(parts[4]), float(parts[5])))
                    except ValueError:
                        color_rows.append(None)
                else:
                    color_rows.append(None)
            if not rows:
                continue
            xyz = np.asarray(rows, dtype=np.float64)
            rgb = None
            if all(c is not None for c in color_rows):
                channels_arr = np.asarray(color_rows, dtype=np.float64)
                rgb = _normalize_color_channels([channels_arr[:, 0], channels_arr[:, 1],
                                                 channels_arr[:, 2]])
            yield xyz, rgb


def _normalize_color_channels(channels) -> np.ndarray:
    """Stack 3 channels and normalize to uint8, handling 16-bit and 0-1 floats."""
    arr = np.column_stack([np.asarray(c, dtype=np.float64) for c in channels])
    finite = arr[np.isfinite(arr)]
    peak = float(finite.max()) if finite.size else 0.0
    if peak > 255.0:
        arr = arr / 257.0  # 16-bit -> 8-bit
    elif peak <= 1.0 and peak > 0.0:
        arr = arr * 255.0
    return np.clip(np.round(arr), 0, 255).astype(np.uint8)


_READERS = {
    ".ply": _read_ply,
    ".las": _read_las,
    ".laz": _read_las,
    ".e57": _read_e57,
    ".xyz": _read_xyz_text,
    ".pts": _read_xyz_text,
}


# ---------------------------------------------------------------------------
# Downsampling
# ---------------------------------------------------------------------------

def _voxel_downsample(xyz: np.ndarray, rgb: np.ndarray, max_points: int):
    """Voxel-grid downsample keeping one representative point per occupied voxel.

    Grid size chosen so the occupied-voxel count lands near max_points.
    Fully vectorized; falls back to random subsample when the voxel pass
    would be too memory-hungry.
    """
    n = xyz.shape[0]
    if n > VOXEL_PASS_MAX_POINTS:
        return _random_subsample(xyz, rgb, max_points), "random"

    mins = xyz.min(axis=0)
    maxs = xyz.max(axis=0)
    extent = maxs - mins
    extent[extent <= 0] = 1e-9
    volume = float(extent[0] * extent[1] * extent[2])

    # Initial guess assuming uniform density, then refine — occupied voxels
    # scale sub-linearly for surface-like clouds, so iterate a few times.
    voxel = max((volume / max_points) ** (1.0 / 3.0), 1e-6)
    keep_idx = None
    for _ in range(8):
        keys = np.floor((xyz - mins) / voxel).astype(np.int64)
        dims = keys.max(axis=0).astype(np.int64) + 1
        flat = (keys[:, 0] * dims[1] + keys[:, 1]) * dims[2] + keys[:, 2]
        # unique with first-occurrence representative
        _, first_idx = np.unique(flat, return_index=True)
        occupied = first_idx.size
        keep_idx = first_idx
        if occupied <= max_points:
            if occupied >= 0.5 * max_points or voxel <= 1e-6:
                break
            voxel *= 0.7  # too coarse — refine
        else:
            voxel *= (occupied / max_points) ** 0.5  # too fine — coarsen

    if keep_idx is None or keep_idx.size > max_points:
        return _random_subsample(xyz, rgb, max_points), "random"
    return (xyz[keep_idx], rgb[keep_idx]), "voxel"


def _random_subsample(xyz: np.ndarray, rgb: np.ndarray, max_points: int):
    rng = np.random.default_rng(42)
    idx = rng.choice(xyz.shape[0], size=max_points, replace=False)
    idx.sort()
    return xyz[idx], rgb[idx]


# ---------------------------------------------------------------------------
# Main pipeline
# ---------------------------------------------------------------------------

def ingest(job: dict) -> dict:
    start = time.time()

    path = job.get("path")
    out_dir = job.get("outDir")
    if not path or not out_dir:
        raise IngestError("job requires 'path' and 'outDir'", "bad-input")
    if not os.path.isfile(path):
        raise IngestError(f"Input file not found: {path}", "bad-input")

    max_points = int(job.get("maxPoints", 8_000_000))
    if max_points <= 0:
        raise IngestError("maxPoints must be positive", "bad-input")
    units = str(job.get("units", "m"))

    ext = os.path.splitext(path)[1].lower()
    reader = _READERS.get(ext)
    if reader is None:
        raise IngestError(f"Unsupported point-cloud format: {ext or '(no extension)'}",
                          "unsupported-format")
    source_format = ext.lstrip(".")

    xyz_chunks: list[np.ndarray] = []
    rgb_chunks: list[np.ndarray] = []
    has_color = False
    source_count = 0
    chunk_budget = max(max_points * 4, 32_000_000)  # cap in-memory candidates

    for xyz, rgb in reader(path):
        if xyz.size == 0:
            continue
        # Drop non-finite rows
        finite = np.isfinite(xyz).all(axis=1)
        if not finite.all():
            xyz = xyz[finite]
            rgb = rgb[finite] if rgb is not None else None
        if xyz.shape[0] == 0:
            continue
        source_count += xyz.shape[0]
        if rgb is not None:
            has_color = True
        else:
            rgb = np.full((xyz.shape[0], 3), NEUTRAL_GRAY, dtype=np.uint8)
        xyz_chunks.append(xyz)
        rgb_chunks.append(rgb)

        # Memory safety for huge inputs: pre-thin the accumulated candidate
        # pool before it exceeds the budget. Random thinning keeps a uniform
        # sample; the final voxel pass runs on the survivors.
        pooled = sum(c.shape[0] for c in xyz_chunks)
        if pooled > chunk_budget:
            xyz_all = np.concatenate(xyz_chunks)
            rgb_all = np.concatenate(rgb_chunks)
            (xyz_all, rgb_all) = _random_subsample(xyz_all, rgb_all, chunk_budget // 2)
            xyz_chunks = [xyz_all]
            rgb_chunks = [rgb_all]

    if not xyz_chunks:
        raise IngestError("No points found in input file", "bad-input")

    xyz = np.concatenate(xyz_chunks) if len(xyz_chunks) > 1 else xyz_chunks[0]
    rgb = np.concatenate(rgb_chunks) if len(rgb_chunks) > 1 else rgb_chunks[0]
    del xyz_chunks, rgb_chunks

    if xyz.shape[0] > max_points:
        (xyz, rgb), _method = _voxel_downsample(xyz, rgb, max_points)

    # Center on bbox center (double precision) so float32 stays precise for
    # UTM-scale coordinates.
    mins = xyz.min(axis=0)
    maxs = xyz.max(axis=0)
    offset = (mins + maxs) / 2.0
    local = (xyz - offset).astype(np.float32)

    # Shuffle so any prefix of the file is a uniform spatial sample.
    perm = np.random.default_rng(42).permutation(local.shape[0])
    local = local[perm]
    rgb = rgb[perm]

    n = local.shape[0]
    records = np.empty((n, STRIDE), dtype=np.uint8)
    records[:, :12] = local.astype("<f4", copy=False).view(np.uint8).reshape(n, 12)
    records[:, 12:15] = rgb
    records[:, 15] = 255

    os.makedirs(out_dir, exist_ok=True)
    out_path = os.path.join(out_dir, "points.bin")
    records.tofile(out_path)

    local_min = (mins - offset).astype(np.float64)
    local_max = (maxs - offset).astype(np.float64)

    return {
        "pointCount": int(n),
        "stride": STRIDE,
        "file": "points.bin",
        "bbox": {
            "min": [float(v) for v in local_min],
            "max": [float(v) for v in local_max],
        },
        "offset": [float(v) for v in offset],
        "hasColor": bool(has_color),
        "units": units,
        "sourceFormat": source_format,
        "sourcePointCount": int(source_count),
        "durationMs": int(round((time.time() - start) * 1000)),
    }


if __name__ == "__main__":
    try:
        job = json.loads(sys.stdin.read() or "{}")
        print(json.dumps(ingest(job)))
    except IngestError as exc:
        print(json.dumps({"error": str(exc), "code": exc.code}))
        sys.exit(1)
    except Exception as exc:  # noqa: BLE001
        print(json.dumps({"error": str(exc), "code": "ingest-failed"}))
        sys.exit(1)
