#!/usr/bin/env python3
"""
Autoresearch-style eval harness for the symbol counter.
Runs fixed test cases against the Soprema P&IDs, measures precision/recall/speed.

Methodology (Karpathy autoresearch):
- Fixed eval: same test cases every run
- Single metric: F1 * speed_bonus
- Keep or revert: compare against baseline
"""
import sys, os, json, time
import numpy as np
import cv2

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "python"))
from tools.renderer import render_to_numpy
from tools.find_symbols import find_symbol_candidates, validate_bbox_has_content
from tools.count_symbols import count_matches, count_matches_on_pdf

SANDBOX = os.path.dirname(__file__)
PID_DIR = os.path.join(SANDBOX, "Soprema Tillsonburg_RFQ Package", "P&IDs")
EQUIP_PDF = os.path.join(SANDBOX, "Soprema Tillsonburg_RFQ Package", "K5600-218 800U_PACKAGE REV 0.pdf")
OUTPUT_DIR = os.path.join(SANDBOX, "eval_output")
os.makedirs(OUTPUT_DIR, exist_ok=True)


# ═══════════════════════════════════════════════════════════════
# GROUND TRUTH: manually verified symbol locations from testing
# ═══════════════════════════════════════════════════════════════

GROUND_TRUTH = {
    "pentane_LS_instruments": {
        "pdf": os.path.join(PID_DIR, "PID-PENTANE-0001 R1.pdf"),
        "page": 1,
        "template_bbox": {"x": 3425, "y": 2102, "width": 87, "height": 87},  # LS-025-76
        "description": "Level switch diamond instrument bubbles",
        "known_matches": 2,  # LS-025-76 and LS-025-77
        "known_false_positives_at_default": 8,  # geometric pattern recognition garbage
    },
    "pentane_LI_instruments": {
        "pdf": os.path.join(PID_DIR, "PID-PENTANE-0001 R1.pdf"),
        "page": 1,
        "template_bbox": {"x": 4593, "y": 604, "width": 88, "height": 108},  # LI-025-01
        "description": "Level indicator + similar diamond instruments",
        "known_matches": 3,  # LI-025-01, SOL-025-01, PI-1504
        "known_false_positives_at_default": 8,
    },
    "pentane_START_buttons": {
        "pdf": os.path.join(PID_DIR, "PID-PENTANE-0001 R1.pdf"),
        "page": 1,
        "template_bbox": {"x": 921, "y": 1808, "width": 56, "height": 55},  # START
        "description": "START/GROUND circle-with-text symbols",
        "known_matches": 3,  # 2x START + 1x GROUND
        "known_false_positives_at_default": 0,
    },
    "equip_tanks": {
        "pdf": EQUIP_PDF,
        "page": 4,
        "template_bbox": {"x": 2810, "y": 1553, "width": 360, "height": 360},  # TCPP TANK at 150 DPI
        "description": "Large identical storage tanks",
        "known_matches": 2,  # TCPP + KOCT (same geometry)
        "known_false_positives_at_default": 0,
    },
}


def run_eval(threshold: float = 0.70, multi_scale: bool = True, render_dpi: int = 150) -> dict:
    """Run all test cases and compute metrics."""
    print(f"\n{'='*70}")
    print(f"EVAL RUN: threshold={threshold} multi_scale={multi_scale} dpi={render_dpi}")
    print(f"{'='*70}")

    total_time = 0
    total_true_pos = 0
    total_false_pos = 0
    total_known = 0
    results = {}

    for name, gt in GROUND_TRUTH.items():
        print(f"\n  [{name}] {gt['description']}")

        # Render and build images
        img, pw, ph, iw, ih = render_to_numpy(gt["pdf"], gt["page"], render_dpi)

        bbox = gt["template_bbox"]
        bx, by, bw, bh = bbox["x"], bbox["y"], bbox["width"], bbox["height"]

        # Validate template
        has_content = validate_bbox_has_content(img, bx, by, bw, bh)
        if not has_content:
            print(f"    SKIP: template bbox is blank!")
            results[name] = {"status": "blank_template"}
            continue

        # Extract template
        template = img[by:by+bh, bx:bx+bw]

        # Run counter
        start = time.time()
        matches = count_matches(template, img, threshold=threshold, multi_scale=multi_scale)
        elapsed = time.time() - start

        # Score: how many are true positives?
        # Heuristic: matches near the known template locations are true positives
        # For now, count matches that have content (not blank white)
        true_pos = 0
        false_pos = 0
        for m in matches:
            has = validate_bbox_has_content(img, m["x"], m["y"], m["w"], m["h"], min_dark_pct=3.0)
            if has:
                true_pos += 1
            else:
                false_pos += 1

        known = gt["known_matches"]
        precision = true_pos / len(matches) if matches else 0
        recall = min(true_pos, known) / known if known > 0 else 0
        f1 = 2 * precision * recall / (precision + recall) if (precision + recall) > 0 else 0

        total_time += elapsed
        total_true_pos += min(true_pos, known)
        total_false_pos += false_pos
        total_known += known

        results[name] = {
            "total_matches": len(matches),
            "true_positives": true_pos,
            "false_positives": false_pos,
            "known_matches": known,
            "precision": round(precision, 3),
            "recall": round(recall, 3),
            "f1": round(f1, 3),
            "elapsed_s": round(elapsed, 3),
        }

        print(f"    Matches: {len(matches)} (TP={true_pos}, FP={false_pos}) Known={known}")
        print(f"    Precision={precision:.3f} Recall={recall:.3f} F1={f1:.3f}")
        print(f"    Time: {elapsed:.2f}s")

        # Save match crops for manual review
        for i, m in enumerate(matches[:10]):
            crop = img[max(0,m["y"]):m["y"]+m["h"], max(0,m["x"]):m["x"]+m["w"]]
            cv2.imwrite(os.path.join(OUTPUT_DIR, f"{name}_match_{i+1}.png"), crop)

    # Aggregate
    overall_precision = total_true_pos / (total_true_pos + total_false_pos) if (total_true_pos + total_false_pos) > 0 else 0
    overall_recall = total_true_pos / total_known if total_known > 0 else 0
    overall_f1 = 2 * overall_precision * overall_recall / (overall_precision + overall_recall) if (overall_precision + overall_recall) > 0 else 0

    # Speed bonus: sub-2s per test gets a bonus, >5s gets a penalty
    avg_time = total_time / len(GROUND_TRUTH) if GROUND_TRUTH else 0
    speed_factor = min(1.0, 2.0 / avg_time) if avg_time > 0 else 1.0

    # Final score: F1 * speed_factor
    final_score = overall_f1 * speed_factor

    summary = {
        "threshold": threshold,
        "multi_scale": multi_scale,
        "render_dpi": render_dpi,
        "overall_precision": round(overall_precision, 3),
        "overall_recall": round(overall_recall, 3),
        "overall_f1": round(overall_f1, 3),
        "avg_time_s": round(avg_time, 3),
        "speed_factor": round(speed_factor, 3),
        "final_score": round(final_score, 3),
        "total_true_pos": total_true_pos,
        "total_false_pos": total_false_pos,
        "total_known": total_known,
        "per_test": results,
    }

    print(f"\n{'='*70}")
    print(f"OVERALL: Precision={overall_precision:.3f} Recall={overall_recall:.3f} F1={overall_f1:.3f}")
    print(f"         AvgTime={avg_time:.2f}s SpeedFactor={speed_factor:.3f}")
    print(f"         FINAL SCORE = {final_score:.3f}")
    print(f"{'='*70}")

    # Save results
    with open(os.path.join(OUTPUT_DIR, "eval_results.json"), "w") as f:
        json.dump(summary, f, indent=2)

    return summary


def parameter_sweep():
    """Try multiple parameter combinations to find optimal settings."""
    print("\n" + "█"*70)
    print("PARAMETER SWEEP")
    print("█"*70)

    configs = [
        {"threshold": 0.60, "multi_scale": False, "render_dpi": 150},
        {"threshold": 0.65, "multi_scale": False, "render_dpi": 150},
        {"threshold": 0.70, "multi_scale": False, "render_dpi": 150},
        {"threshold": 0.75, "multi_scale": False, "render_dpi": 150},
        {"threshold": 0.80, "multi_scale": False, "render_dpi": 150},
        {"threshold": 0.70, "multi_scale": True, "render_dpi": 150},
        {"threshold": 0.65, "multi_scale": True, "render_dpi": 150},
        {"threshold": 0.70, "multi_scale": False, "render_dpi": 200},
        {"threshold": 0.70, "multi_scale": True, "render_dpi": 200},
    ]

    best_score = 0
    best_config = None
    all_results = []

    for cfg in configs:
        result = run_eval(**cfg)
        all_results.append({"config": cfg, "score": result["final_score"], "f1": result["overall_f1"],
                            "precision": result["overall_precision"], "recall": result["overall_recall"],
                            "avg_time": result["avg_time_s"]})
        if result["final_score"] > best_score:
            best_score = result["final_score"]
            best_config = cfg

    print(f"\n{'█'*70}")
    print("SWEEP RESULTS:")
    print(f"{'█'*70}")
    for r in sorted(all_results, key=lambda x: -x["score"]):
        print(f"  Score={r['score']:.3f} F1={r['f1']:.3f} P={r['precision']:.3f} R={r['recall']:.3f} "
              f"T={r['avg_time']:.2f}s | thresh={r['config']['threshold']} "
              f"ms={r['config']['multi_scale']} dpi={r['config']['render_dpi']}")

    print(f"\nBEST: {best_config} → score={best_score:.3f}")

    with open(os.path.join(OUTPUT_DIR, "sweep_results.json"), "w") as f:
        json.dump({"best_config": best_config, "best_score": best_score, "all_results": all_results}, f, indent=2)

    return best_config, best_score


if __name__ == "__main__":
    if "--sweep" in sys.argv:
        parameter_sweep()
    else:
        run_eval()
