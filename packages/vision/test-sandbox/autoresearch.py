#!/usr/bin/env python3
"""
Autoresearch loop for the vision tool suite.
Karpathy-style: fixed eval, single metric, keep-or-revert.

Eval set spans 3 real construction packages:
  - Soprema Tillsonburg (chemical plant P&IDs)
  - Kemira Brantford (structural/tank/cooling tower)
  - Home Hardware (P&ID, piping ISOs, steel erection)

Each iteration:
  1. Run eval across all test cases
  2. Compute composite score (precision * recall * speed_bonus)
  3. Log results
  4. If score improved, keep. If not, revert.
"""
import sys, os, json, time, copy
import numpy as np, cv2

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "python"))
from tools.renderer import render_to_numpy
from tools.find_symbols import find_symbol_candidates, validate_bbox_has_content, crop_component
from tools.count_symbols import count_matches

SANDBOX = os.path.dirname(__file__)
OUT = os.path.join(SANDBOX, "autoresearch_output")
os.makedirs(OUT, exist_ok=True)

# ═══════════════════════════════════════════════════════════════
# TEST CASES — ground truth across all 3 packages
# Each case: pdf path, page, bbox (at 150 DPI), expected matches, description
# ═══════════════════════════════════════════════════════════════

SOPREMA = os.path.join(SANDBOX, "Soprema Tillsonburg_RFQ Package")
KEMIRA = os.path.join(SANDBOX, "kemira", "Kemira Brantford")
HH = os.path.join(SANDBOX, "homehardware", "Home Hardware", "HH RFP Installation Package")
BIRLA = os.path.join(SANDBOX, "birla", "Birla Unit 4 Breeching")

TEST_CASES = [
    # ── Soprema: P&ID instruments ──
    {
        "name": "soprema_LS_instruments",
        "pdf": os.path.join(SOPREMA, "P&IDs", "PID-PENTANE-0001 R1.pdf"),
        "page": 1, "bbox": {"x": 3425, "y": 2102, "w": 87, "h": 87},
        "min_expected": 2, "max_expected": 5,
        "desc": "Level switch diamond bubbles",
    },
    {
        "name": "soprema_START_buttons",
        "pdf": os.path.join(SOPREMA, "P&IDs", "PID-PENTANE-0001 R1.pdf"),
        "page": 1, "bbox": {"x": 921, "y": 1808, "w": 56, "h": 55},
        "min_expected": 2, "max_expected": 5,
        "desc": "START/GROUND circle symbols",
    },
    # ── Soprema: valve tags (auto-discovered) ──
    {
        "name": "soprema_valve_tags",
        "pdf": os.path.join(SOPREMA, "P&IDs", "PID-PENTANE-0001 R1.pdf"),
        "page": 1, "bbox": "auto:valve_tag",  # auto-discover
        "min_expected": 20, "max_expected": 60,
        "desc": "Valve specification tags (~110x42)",
    },
    # ── Kemira: tank nozzle flanges ──
    {
        "name": "kemira_nozzle_flanges",
        "pdf": os.path.join(KEMIRA, "Tank Replacement", "new tank drawing.pdf"),
        "page": 1, "bbox": {"x": 4547, "y": 1098, "w": 113, "h": 85},
        "min_expected": 2, "max_expected": 6,
        "desc": "Nozzle flange detail symbols",
    },
    # ── Kemira: tank nozzle callouts ──
    {
        "name": "kemira_nozzle_callouts",
        "pdf": os.path.join(KEMIRA, "Tank Replacement", "new tank drawing.pdf"),
        "page": 1, "bbox": {"x": 2504, "y": 1169, "w": 161, "h": 91},
        "min_expected": 2, "max_expected": 10,
        "desc": "Nozzle ID circles (N7/N9 etc)",
    },
    # ── Kemira: identical tanks ──
    {
        "name": "kemira_tanks",
        "pdf": os.path.join(SANDBOX, "kemira", "Kemira Brantford", "K5600-218 800U_PACKAGE REV 0.pdf"),
        "page": 4, "bbox": {"x": 2810, "y": 1553, "w": 360, "h": 360},
        "min_expected": 2, "max_expected": 4,
        "desc": "Identical storage tanks",
    },
    # ── Home Hardware: P&ID instruments ──
    {
        "name": "hh_pid_instruments",
        "pdf": os.path.join(HH, "PID", "006-P-HT-001,_ DEVREE FILLER HOLDING TANK Rev.F.pdf"),
        "page": 1, "bbox": "auto:instrument_bubble",
        "min_expected": 5, "max_expected": 50,
        "desc": "P&ID instrument bubbles (auto-discover)",
    },
    # ── Home Hardware: P&ID valve tags ──
    {
        "name": "hh_pid_valves",
        "pdf": os.path.join(HH, "PID", "006-P-HT-001,_ DEVREE FILLER HOLDING TANK Rev.F.pdf"),
        "page": 1, "bbox": "auto:valve_tag",
        "min_expected": 10, "max_expected": 60,
        "desc": "P&ID valve tags (auto-discover)",
    },
    # ── Home Hardware: P&ID drain symbols ──
    {
        "name": "hh_pid_drains",
        "pdf": os.path.join(HH, "PID", "006-P-HT-001,_ DEVREE FILLER HOLDING TANK Rev.F.pdf"),
        "page": 1, "bbox": {"x": 517, "y": 1484, "w": 42, "h": 37},  # drain triangle "D"
        "min_expected": 5, "max_expected": 15,
        "desc": "P&ID drain symbols (triangle-D)",
    },
    # ── Home Hardware: P&ID connection diamonds ──
    {
        "name": "hh_pid_connections",
        "pdf": os.path.join(HH, "PID", "006-P-HT-001,_ DEVREE FILLER HOLDING TANK Rev.F.pdf"),
        "page": 1, "bbox": {"x": 991, "y": 2770, "w": 76, "h": 75},  # diamond junction
        "min_expected": 10, "max_expected": 30,
        "desc": "P&ID connection junction diamonds",
    },
    # ── Birla: structural grid markers ──
    {
        "name": "birla_grid_markers",
        "pdf": os.path.join(BIRLA, "Exist Plant Struct Drawings Combined.pdf"),
        "page": 2, "bbox": {"x": 1965, "y": 1761, "w": 78, "h": 78},  # circled G section marker
        "min_expected": 3, "max_expected": 10,
        "desc": "Structural section/grid markers (circled letters)",
    },
    # ── Birla: civil north arrows ──
    {
        "name": "birla_north_arrows",
        "pdf": os.path.join(BIRLA, "Unit 4 Outlet Breeching Civil Drawings.pdf"),
        "page": 2, "bbox": "auto:north_arrow",
        "min_expected": 2, "max_expected": 4,
        "desc": "North arrow symbols on civil drawings",
    },
]


def auto_discover_template(img, iw, ih, template_type):
    """Auto-discover a template bbox based on type heuristics."""
    cands = find_symbol_candidates(img, iw, ih, min_size=15, max_size=200, min_area=80)
    valid = [c for c in cands if validate_bbox_has_content(img, c["x"], c["y"], c["w"], c["h"], 5.0)]

    if template_type == "valve_tag":
        # Wide rectangles: w/h > 1.8, width 70-160, height 25-60
        matches = [c for c in valid if 70 < c["w"] < 160 and 25 < c["h"] < 60 and c["w"] > c["h"] * 1.8]
    elif template_type == "instrument_bubble":
        # Square-ish, 40-120px, not in title block
        matches = [c for c in valid if 0.6 < c["aspect"] < 1.6 and 40 < c["w"] < 120
                   and 40 < c["h"] < 120 and c["y"] < ih * 0.85]
    elif template_type == "grid_bubble":
        # Circles, 30-80px, near edges (grid lines are at margins)
        matches = [c for c in valid if 0.7 < c["aspect"] < 1.4 and 25 < c["w"] < 80
                   and 25 < c["h"] < 80 and (c["y"] < ih * 0.15 or c["y"] > ih * 0.85
                                              or c["x"] < iw * 0.1 or c["x"] > iw * 0.85)]
    elif template_type == "callout_number":
        # Small circles/squares with numbers, 20-60px
        matches = [c for c in valid if 0.6 < c["aspect"] < 1.6 and 15 < c["w"] < 60
                   and 15 < c["h"] < 60 and c["y"] < ih * 0.85]
    elif template_type == "north_arrow":
        # Large circular symbol, 80-200px, roughly square
        matches = [c for c in valid if 0.7 < c["aspect"] < 1.4 and 80 < c["w"] < 200
                   and 80 < c["h"] < 200]
    else:
        matches = valid

    if not matches:
        return None

    matches.sort(key=lambda c: -c["area"])
    c = matches[0]
    return {"x": c["x"], "y": c["y"], "w": c["w"], "h": c["h"]}


def run_single_test(case, threshold=0.75, render_dpi=150):
    """Run a single test case. Returns {name, matches, true_pos, false_pos, elapsed}."""
    pdf = case["pdf"]
    if not pdf or not os.path.exists(pdf):
        return {"name": case["name"], "status": "skip", "reason": "pdf not found"}

    img, pw, ph, iw, ih = render_to_numpy(pdf, case["page"], render_dpi)

    # Resolve bbox
    bbox = case["bbox"]
    if isinstance(bbox, str) and bbox.startswith("auto:"):
        bbox = auto_discover_template(img, iw, ih, bbox.split(":")[1])
        if not bbox:
            return {"name": case["name"], "status": "skip", "reason": "auto-discover found nothing"}

    bx, by, bw, bh = bbox["x"], bbox["y"], bbox["w"], bbox["h"]

    # Validate template
    if not validate_bbox_has_content(img, bx, by, bw, bh):
        return {"name": case["name"], "status": "fail", "reason": "blank template"}

    template = crop_component(img, bx, by, bw, bh, pad=2)
    if template.size == 0:
        return {"name": case["name"], "status": "fail", "reason": "empty crop"}

    # Run matching
    start = time.time()
    matches = count_matches(template, img, threshold=threshold)
    elapsed = time.time() - start

    # Score: how many have real content?
    true_pos = sum(1 for m in matches
                   if validate_bbox_has_content(img, m["x"], m["y"], m["w"], m["h"], 3.0))
    false_pos = len(matches) - true_pos

    # Is the count in the expected range?
    in_range = case["min_expected"] <= true_pos <= case["max_expected"]

    return {
        "name": case["name"],
        "status": "ok",
        "total": len(matches),
        "true_pos": true_pos,
        "false_pos": false_pos,
        "in_range": in_range,
        "expected": f"{case['min_expected']}-{case['max_expected']}",
        "elapsed": round(elapsed, 3),
        "bbox": bbox,
        "desc": case["desc"],
    }


def run_full_eval(threshold=0.75, render_dpi=150, verbose=True):
    """Run all test cases, compute composite score."""
    results = []
    total_tp = 0
    total_fp = 0
    total_time = 0
    in_range_count = 0
    run_count = 0

    for case in TEST_CASES:
        r = run_single_test(case, threshold, render_dpi)
        results.append(r)

        if r["status"] == "ok":
            run_count += 1
            total_tp += r["true_pos"]
            total_fp += r["false_pos"]
            total_time += r["elapsed"]
            if r["in_range"]:
                in_range_count += 1

            if verbose:
                flag = "✓" if r["in_range"] else "✗"
                print(f'  {flag} {r["name"]}: {r["true_pos"]} matches '
                      f'(expected {r["expected"]}) FP={r["false_pos"]} {r["elapsed"]:.2f}s')
        elif verbose:
            print(f'  - {r["name"]}: {r["status"]} ({r.get("reason", "")})')

    # Metrics
    precision = total_tp / (total_tp + total_fp) if (total_tp + total_fp) > 0 else 0
    range_accuracy = in_range_count / run_count if run_count > 0 else 0
    avg_time = total_time / run_count if run_count > 0 else 999
    speed_bonus = min(1.0, 1.5 / avg_time) if avg_time > 0 else 1.0

    # Composite: precision * range_accuracy * speed_bonus
    score = precision * range_accuracy * speed_bonus

    summary = {
        "threshold": threshold, "dpi": render_dpi,
        "precision": round(precision, 3),
        "range_accuracy": round(range_accuracy, 3),
        "avg_time": round(avg_time, 3),
        "speed_bonus": round(speed_bonus, 3),
        "score": round(score, 3),
        "total_tp": total_tp, "total_fp": total_fp,
        "tests_run": run_count, "in_range": in_range_count,
        "results": results,
    }

    if verbose:
        print(f'\n  SCORE={score:.3f} (P={precision:.3f} × Range={range_accuracy:.3f} × Speed={speed_bonus:.3f})')
        print(f'  TP={total_tp} FP={total_fp} AvgTime={avg_time:.2f}s')

    return summary


def autoresearch_loop(iterations=20):
    """Run the autoresearch parameter sweep."""
    print("█" * 70)
    print(f"AUTORESEARCH: {iterations} iterations across 3 construction packages")
    print("█" * 70)

    configs = [
        # Iteration 1-5: threshold sweep at 150 DPI
        {"threshold": 0.60, "render_dpi": 150},
        {"threshold": 0.65, "render_dpi": 150},
        {"threshold": 0.70, "render_dpi": 150},
        {"threshold": 0.75, "render_dpi": 150},
        {"threshold": 0.80, "render_dpi": 150},
        # Iteration 6-10: fine-tuning 0.70-0.80 range (where the sweet spot is)
        {"threshold": 0.71, "render_dpi": 150},
        {"threshold": 0.72, "render_dpi": 150},
        {"threshold": 0.73, "render_dpi": 150},
        {"threshold": 0.74, "render_dpi": 150},
        {"threshold": 0.76, "render_dpi": 150},
        # Iteration 11-15: lower thresholds with higher DPI (can work if bbox is recalculated)
        {"threshold": 0.77, "render_dpi": 150},
        {"threshold": 0.78, "render_dpi": 150},
        {"threshold": 0.79, "render_dpi": 150},
        {"threshold": 0.68, "render_dpi": 150},
        {"threshold": 0.69, "render_dpi": 150},
        # Iteration 16-20: edge cases
        {"threshold": 0.50, "render_dpi": 150},
        {"threshold": 0.55, "render_dpi": 150},
        {"threshold": 0.85, "render_dpi": 150},
        {"threshold": 0.90, "render_dpi": 150},
        {"threshold": 0.95, "render_dpi": 150},
    ]

    all_results = []
    best_score = 0
    best_config = None

    for i, cfg in enumerate(configs[:iterations]):
        print(f"\n{'─'*70}")
        print(f"RUN {i+1}/{iterations}: thresh={cfg['threshold']} dpi={cfg['render_dpi']}")
        print(f"{'─'*70}")

        summary = run_full_eval(**cfg)
        all_results.append({"run": i + 1, "config": cfg, **{k: v for k, v in summary.items() if k != "results"}})

        if summary["score"] > best_score:
            best_score = summary["score"]
            best_config = cfg
            print(f"  ★ NEW BEST: {best_score:.3f}")
        else:
            delta = summary["score"] - best_score
            print(f"  → {delta:+.3f} from best ({best_score:.3f})")

    # Final report
    print(f"\n{'█'*70}")
    print("AUTORESEARCH COMPLETE")
    print(f"{'█'*70}")
    print(f"\nAll runs (sorted by score):")
    all_results.sort(key=lambda r: -r["score"])
    for r in all_results:
        marker = " ★" if r["config"] == best_config else ""
        print(f"  Run {r['run']:2d}: score={r['score']:.3f} P={r['precision']:.3f} "
              f"Range={r['range_accuracy']:.3f} T={r['avg_time']:.2f}s "
              f"| thresh={r['config']['threshold']} dpi={r['config']['render_dpi']}{marker}")

    print(f"\nBEST CONFIG: {best_config}")
    print(f"BEST SCORE:  {best_score:.3f}")

    with open(os.path.join(OUT, "autoresearch_results.json"), "w") as f:
        json.dump({"best_config": best_config, "best_score": best_score, "runs": all_results}, f, indent=2)

    return best_config, best_score


if __name__ == "__main__":
    n = int(sys.argv[1]) if len(sys.argv) > 1 else 20
    autoresearch_loop(n)
