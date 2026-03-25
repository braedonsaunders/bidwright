#!/usr/bin/env python3
"""
Kemira Brantford CV auto-count testing harness.

Autoresearch-style iterative testing for the count_symbols pipeline,
focused on the Kemira Brantford construction package.

Tests BOTH layers:
  1. Python direct (count_matches / count_matches_on_pdf)
  2. CLI stdin/stdout mode (same path the TypeScript wrapper uses)

Each iteration:
  1. Run eval across all Kemira test cases
  2. Compute composite score (precision * range_accuracy * speed_bonus)
  3. Log results
  4. Report best config
"""
import sys, os, json, time, subprocess

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "python"))
from tools.renderer import render_to_numpy
from tools.find_symbols import find_symbol_candidates, validate_bbox_has_content, crop_component
from tools.count_symbols import count_matches, count_matches_on_pdf

SANDBOX = os.path.dirname(__file__)
OUT = os.path.join(SANDBOX, "kemira_harness_output")
os.makedirs(OUT, exist_ok=True)

KEMIRA = "/tmp/bidwright-test/kemira_pdfs/Kemira Brantford"
COUNT_SYMBOLS_SCRIPT = os.path.join(SANDBOX, "..", "python", "tools", "count_symbols.py")

# ═══════════════════════════════════════════════════════════════
# TEST CASES — Kemira Brantford ground truth
# Each: pdf, page, bbox (at 150 DPI coords), expected match range, description
# ═══════════════════════════════════════════════════════════════

TEST_CASES = [
    # ── Tank Replacement: new tank drawing ──
    {
        "name": "tank_nozzle_flanges",
        "pdf": f"{KEMIRA}/Tank Replacement/new tank drawing.pdf",
        "page": 1,
        "bbox": {"x": 4547, "y": 1098, "width": 113, "height": 85, "imageWidth": 5400, "imageHeight": 3600},
        "min_expected": 2, "max_expected": 6,
        "desc": "Nozzle flange symbols on tank drawing",
    },
    {
        "name": "tank_nozzle_callouts",
        "pdf": f"{KEMIRA}/Tank Replacement/new tank drawing.pdf",
        "page": 1,
        "bbox": {"x": 2504, "y": 1169, "width": 161, "height": 91, "imageWidth": 5400, "imageHeight": 3600},
        "min_expected": 2, "max_expected": 10,
        "desc": "Nozzle ID callout boxes (N7/N9 etc)",
    },
    # ── Tank Replacement: bid drawing ──
    {
        "name": "tankbid_flanges",
        "pdf": f"{KEMIRA}/Tank Replacement/[Technical documents] TW10013-1rev.1-Model - For Bid.pdf",
        "page": 1,
        "bbox": {"x": 4523, "y": 1353, "width": 104, "height": 75, "imageWidth": 5400, "imageHeight": 3600},
        "min_expected": 2, "max_expected": 6,
        "desc": "Nozzle flanges on bid tank drawing",
    },
    {
        "name": "tankbid_circles",
        "pdf": f"{KEMIRA}/Tank Replacement/[Technical documents] TW10013-1rev.1-Model - For Bid.pdf",
        "page": 1,
        "bbox": {"x": 1595, "y": 948, "width": 86, "height": 85, "imageWidth": 5400, "imageHeight": 3600},
        "min_expected": 2, "max_expected": 8,
        "desc": "Nozzle ID circles on bid drawing",
    },
    # ── Cooling Tower: section markers ──
    {
        "name": "ct_section_markers_p1",
        "pdf": f"{KEMIRA}/Cooling Tower Platform and Ladder/Z1064957_B.pdf",
        "page": 1,
        "bbox": {"x": 374, "y": 749, "width": 24, "height": 29, "imageWidth": 1275, "imageHeight": 1650},
        "min_expected": 3, "max_expected": 8,
        "desc": "Section reference bubbles on CT detail page 1",
    },
    {
        "name": "ct_section_markers_p3",
        "pdf": f"{KEMIRA}/Cooling Tower Platform and Ladder/Z1064957_B.pdf",
        "page": 3,
        "bbox": {"x": 374, "y": 749, "width": 24, "height": 29, "imageWidth": 1275, "imageHeight": 1650},
        "min_expected": 3, "max_expected": 25,
        "desc": "Section reference bubbles on CT detail page 3",
    },
    # ── Cross-document: flanges from new_tank matched on bid drawing ──
    {
        "name": "cross_doc_flanges",
        "pdf": f"{KEMIRA}/Tank Replacement/[Technical documents] TW10013-1rev.1-Model - For Bid.pdf",
        "page": 1,
        # Template bbox from new_tank drawing, searching on bid drawing
        "bbox": {"x": 4547, "y": 1098, "width": 113, "height": 85, "imageWidth": 5400, "imageHeight": 3600},
        "cross_scale": True,
        "min_expected": 1, "max_expected": 6,
        "desc": "Cross-doc: new_tank flange template → bid drawing (cross-scale)",
    },
    # ── Cooling Tower markup drawings ──
    {
        "name": "ct_markup_bubbles",
        "pdf": f"{KEMIRA}/Cooling Tower Platform and Ladder/Z1070035MARKUP_20250526194852.050_X.pdf",
        "page": 1,
        "bbox": {"x": 217, "y": 849, "width": 20, "height": 28, "imageWidth": 1650, "imageHeight": 1275},
        "min_expected": 2, "max_expected": 15,
        "desc": "Section bubbles on CT markup drawing",
    },
    # ── P&ID (process flow) ──
    {
        "name": "pid_flow_symbol",
        "pdf": f"{KEMIRA}/17041-100 - 2024 10 11 - Issued.pdf",
        "page": 1,
        "bbox": {"x": 4784, "y": 2144, "width": 97, "height": 97, "imageWidth": 5400, "imageHeight": 3600},
        "min_expected": 1, "max_expected": 5,
        "desc": "Process flow diagram symbol (large square)",
    },
    # ── Crane drawings ──
    {
        "name": "crane_layout_detail",
        "pdf": f"{KEMIRA}/PENG STAMPED SO35080-01 2TON TR SG 38FT SPAN CRANE GENERAL LAYOUT-Model.pdf",
        "page": 1,
        "bbox": {"x": 920, "y": 298, "width": 93, "height": 76, "imageWidth": 2550, "imageHeight": 1650},
        "min_expected": 1, "max_expected": 4,
        "desc": "Crane general layout detail symbol",
    },
]


def run_single_test_python(case, threshold=0.75, render_dpi=150):
    """Run a single test via the Python API directly."""
    pdf = case["pdf"]
    if not os.path.exists(pdf):
        return {"name": case["name"], "status": "skip", "reason": f"pdf not found: {pdf}"}

    cross_scale = case.get("cross_scale", False)

    try:
        result = count_matches_on_pdf(
            pdf_path=pdf,
            page=case["page"],
            bbox=case["bbox"],
            threshold=threshold,
            render_dpi=render_dpi,
            cross_scale=cross_scale,
        )
    except Exception as e:
        return {"name": case["name"], "status": "fail", "reason": str(e)}

    if "error" in result and result["error"]:
        return {"name": case["name"], "status": "fail", "reason": result["error"]}

    matches = result.get("matches", [])
    total = result.get("totalCount", len(matches))
    elapsed = result.get("elapsed_ms", 0) / 1000.0

    # Validate matches have real content
    img, pw, ph, iw, ih = render_to_numpy(pdf, case["page"], render_dpi)
    true_pos = sum(1 for m in matches
                   if validate_bbox_has_content(img, m["x"], m["y"], m["w"], m["h"], 3.0))
    false_pos = total - true_pos
    in_range = case["min_expected"] <= true_pos <= case["max_expected"]

    return {
        "name": case["name"],
        "status": "ok",
        "layer": "python",
        "total": total,
        "true_pos": true_pos,
        "false_pos": false_pos,
        "in_range": in_range,
        "expected": f"{case['min_expected']}-{case['max_expected']}",
        "elapsed": round(elapsed, 3),
        "cross_scale": cross_scale,
        "desc": case["desc"],
    }


def run_single_test_cli(case, threshold=0.75, render_dpi=150):
    """Run a single test via CLI stdin/stdout (same path as TypeScript wrapper)."""
    pdf = case["pdf"]
    if not os.path.exists(pdf):
        return {"name": case["name"], "status": "skip", "reason": f"pdf not found: {pdf}"}

    cross_scale = case.get("cross_scale", False)

    payload = json.dumps({
        "pdfPath": pdf,
        "pageNumber": case["page"],
        "boundingBox": case["bbox"],
        "threshold": threshold,
        "dpi": render_dpi,
        "crossScale": cross_scale,
    })

    start = time.time()
    try:
        proc = subprocess.run(
            [sys.executable, COUNT_SYMBOLS_SCRIPT],
            input=payload, capture_output=True, text=True, timeout=60,
            cwd=os.path.join(SANDBOX, "..", "python"),
        )
    except subprocess.TimeoutExpired:
        return {"name": case["name"], "status": "fail", "reason": "timeout (60s)", "layer": "cli"}

    elapsed = time.time() - start

    if proc.returncode != 0:
        return {"name": case["name"], "status": "fail", "reason": f"exit {proc.returncode}: {proc.stderr[:200]}", "layer": "cli"}

    try:
        result = json.loads(proc.stdout)
    except json.JSONDecodeError:
        return {"name": case["name"], "status": "fail", "reason": f"bad JSON: {proc.stdout[:200]}", "layer": "cli"}

    if "error" in result and result["error"]:
        return {"name": case["name"], "status": "fail", "reason": result["error"], "layer": "cli"}

    matches = result.get("matches", [])
    total = result.get("totalCount", len(matches))
    in_range = case["min_expected"] <= total <= case["max_expected"]

    return {
        "name": case["name"],
        "status": "ok",
        "layer": "cli",
        "total": total,
        "true_pos": total,  # CLI doesn't validate content (same as TS wrapper behavior)
        "false_pos": 0,
        "in_range": in_range,
        "expected": f"{case['min_expected']}-{case['max_expected']}",
        "elapsed": round(elapsed, 3),
        "cross_scale": cross_scale,
        "desc": case["desc"],
    }


def run_full_eval(threshold=0.75, render_dpi=150, layer="both", verbose=True):
    """Run all test cases, compute composite score."""
    results = []
    total_tp = 0
    total_fp = 0
    total_time = 0.0
    in_range_count = 0
    run_count = 0

    layers = ["python", "cli"] if layer == "both" else [layer]

    for lyr in layers:
        if verbose and layer == "both":
            print(f"\n  ── {lyr.upper()} LAYER ──")

        for case in TEST_CASES:
            if lyr == "python":
                r = run_single_test_python(case, threshold, render_dpi)
            else:
                r = run_single_test_cli(case, threshold, render_dpi)

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
                    cross = " [XS]" if r.get("cross_scale") else ""
                    print(f'    {flag} {r["name"]}: {r["true_pos"]} matches '
                          f'(expected {r["expected"]}) FP={r["false_pos"]} '
                          f'{r["elapsed"]:.2f}s{cross}')
            elif verbose:
                print(f'    - {r["name"]}: {r["status"]} ({r.get("reason", "")})')

    # Metrics
    precision = total_tp / (total_tp + total_fp) if (total_tp + total_fp) > 0 else 0
    range_accuracy = in_range_count / run_count if run_count > 0 else 0
    avg_time = total_time / run_count if run_count > 0 else 999
    speed_bonus = min(1.0, 1.5 / avg_time) if avg_time > 0 else 1.0

    score = precision * range_accuracy * speed_bonus

    summary = {
        "threshold": threshold, "dpi": render_dpi, "layer": layer,
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
        print(f'  TP={total_tp} FP={total_fp} AvgTime={avg_time:.2f}s Tests={run_count} InRange={in_range_count}')

    return summary


def consistency_check(threshold=0.75, render_dpi=150, verbose=True):
    """Verify Python and CLI layers produce identical results."""
    if verbose:
        print("\n" + "═" * 70)
        print("CONSISTENCY CHECK: Python API vs CLI stdin/stdout")
        print("═" * 70)

    mismatches = []
    for case in TEST_CASES:
        r_py = run_single_test_python(case, threshold, render_dpi)
        r_cli = run_single_test_cli(case, threshold, render_dpi)

        if r_py["status"] != "ok" or r_cli["status"] != "ok":
            if verbose:
                print(f'  - {case["name"]}: py={r_py["status"]} cli={r_cli["status"]}')
            continue

        py_count = r_py["total"]
        cli_count = r_cli["total"]
        match = py_count == cli_count

        if verbose:
            flag = "✓" if match else "✗"
            print(f'  {flag} {case["name"]}: py={py_count} cli={cli_count}')

        if not match:
            mismatches.append({"name": case["name"], "python": py_count, "cli": cli_count})

    if verbose:
        if mismatches:
            print(f"\n  ✗ {len(mismatches)} MISMATCHES — layers disagree!")
        else:
            print(f"\n  ✓ ALL LAYERS AGREE")

    return mismatches


def autoresearch_loop(iterations=15, layer="python"):
    """Autoresearch-style parameter sweep."""
    print("█" * 70)
    print(f"KEMIRA HARNESS: {iterations} iterations, layer={layer}")
    print("█" * 70)

    configs = [
        # Coarse threshold sweep
        {"threshold": 0.60, "render_dpi": 150},
        {"threshold": 0.65, "render_dpi": 150},
        {"threshold": 0.70, "render_dpi": 150},
        {"threshold": 0.75, "render_dpi": 150},
        {"threshold": 0.80, "render_dpi": 150},
        # Fine-tune sweet spot
        {"threshold": 0.71, "render_dpi": 150},
        {"threshold": 0.72, "render_dpi": 150},
        {"threshold": 0.73, "render_dpi": 150},
        {"threshold": 0.74, "render_dpi": 150},
        {"threshold": 0.76, "render_dpi": 150},
        # Edge cases
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
        print(f"\n{'─' * 70}")
        print(f"RUN {i+1}/{iterations}: thresh={cfg['threshold']} dpi={cfg['render_dpi']}")
        print(f"{'─' * 70}")

        summary = run_full_eval(**cfg, layer=layer)
        run_data = {"run": i + 1, "config": cfg, **{k: v for k, v in summary.items() if k != "results"}}
        all_results.append(run_data)

        if summary["score"] > best_score:
            best_score = summary["score"]
            best_config = cfg
            print(f"  ★ NEW BEST: {best_score:.3f}")
        else:
            delta = summary["score"] - best_score
            print(f"  → {delta:+.3f} from best ({best_score:.3f})")

    # Final report
    print(f"\n{'█' * 70}")
    print("KEMIRA HARNESS COMPLETE")
    print(f"{'█' * 70}")
    print(f"\nAll runs (sorted by score):")
    all_results.sort(key=lambda r: -r["score"])
    for r in all_results:
        marker = " ★" if r["config"] == best_config else ""
        print(f"  Run {r['run']:2d}: score={r['score']:.3f} P={r['precision']:.3f} "
              f"Range={r['range_accuracy']:.3f} T={r['avg_time']:.2f}s "
              f"| thresh={r['config']['threshold']} dpi={r['config']['render_dpi']}{marker}")

    print(f"\nBEST CONFIG: {best_config}")
    print(f"BEST SCORE:  {best_score:.3f}")

    with open(os.path.join(OUT, "kemira_harness_results.json"), "w") as f:
        json.dump({"best_config": best_config, "best_score": best_score, "runs": all_results}, f, indent=2)

    return best_config, best_score


if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser(description="Kemira Brantford CV auto-count test harness")
    parser.add_argument("mode", nargs="?", default="eval",
                       choices=["eval", "sweep", "consistency", "cli-eval"],
                       help="eval: single run | sweep: parameter sweep | consistency: layer check | cli-eval: CLI-only eval")
    parser.add_argument("--threshold", type=float, default=0.75)
    parser.add_argument("--dpi", type=int, default=150)
    parser.add_argument("--iterations", type=int, default=15)
    args = parser.parse_args()

    if args.mode == "eval":
        print("═" * 70)
        print(f"SINGLE EVAL: threshold={args.threshold} dpi={args.dpi} (Python layer)")
        print("═" * 70)
        run_full_eval(threshold=args.threshold, render_dpi=args.dpi, layer="python")

    elif args.mode == "cli-eval":
        print("═" * 70)
        print(f"CLI EVAL: threshold={args.threshold} dpi={args.dpi}")
        print("═" * 70)
        run_full_eval(threshold=args.threshold, render_dpi=args.dpi, layer="cli")

    elif args.mode == "sweep":
        autoresearch_loop(iterations=args.iterations, layer="python")

    elif args.mode == "consistency":
        consistency_check(threshold=args.threshold, render_dpi=args.dpi)
