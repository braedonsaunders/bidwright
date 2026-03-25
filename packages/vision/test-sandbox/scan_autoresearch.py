#!/usr/bin/env python3
"""
Autoresearch loop for the proactive drawing scanner.

Iterates on scanner parameters (min_size, max_size, size_tolerance,
count_threshold, min_cluster_size) to maximize symbol detection quality.

Eval metric: for each known test case, does the scanner produce a cluster
whose count falls in the expected range?

Score = accuracy × coverage × speed_bonus
  accuracy = clusters-in-range / total-test-cases
  coverage = avg(best_cluster_match_confidence) across test cases
  speed_bonus = min(1.0, 5.0 / avg_scan_time_s)
"""
import sys, os, json, time
sys.path.insert(0, os.path.dirname(__file__))
from scan_drawing import scan_page

KEMIRA = "/tmp/bidwright-test/kemira_pdfs/Kemira Brantford"
OUT = os.path.join(os.path.dirname(__file__), "scan_autoresearch_output")
os.makedirs(OUT, exist_ok=True)

# ═══════════════════════════════════════════════════════════════
# GROUND TRUTH — known symbols with expected count ranges
# For each: which scan cluster should match? We check by bbox size+location.
# ═══════════════════════════════════════════════════════════════

TEST_CASES = [
    {
        "name": "tank_nozzle_flanges",
        "pdf": f"{KEMIRA}/Tank Replacement/new tank drawing.pdf",
        "page": 1,
        "target_bbox": (4547, 1098, 113, 85),  # x, y, w, h
        "min_expected": 2, "max_expected": 6,
        "size_range": (60, 200),  # cluster avg dimension range to look for
    },
    {
        "name": "tank_nozzle_callouts",
        "pdf": f"{KEMIRA}/Tank Replacement/new tank drawing.pdf",
        "page": 1,
        "target_bbox": (2504, 1169, 161, 91),
        "min_expected": 2, "max_expected": 10,
        "size_range": (80, 200),
    },
    {
        "name": "tankbid_flanges",
        "pdf": f"{KEMIRA}/Tank Replacement/[Technical documents] TW10013-1rev.1-Model - For Bid.pdf",
        "page": 1,
        "target_bbox": (4523, 1353, 104, 75),
        "min_expected": 2, "max_expected": 6,
        "size_range": (50, 150),
    },
    {
        "name": "tankbid_circles",
        "pdf": f"{KEMIRA}/Tank Replacement/[Technical documents] TW10013-1rev.1-Model - For Bid.pdf",
        "page": 1,
        "target_bbox": (1595, 948, 86, 85),
        "min_expected": 2, "max_expected": 8,
        "size_range": (50, 120),
    },
    {
        "name": "ct_section_markers",
        "pdf": f"{KEMIRA}/Cooling Tower Platform and Ladder/Z1064957_B.pdf",
        "page": 1,
        "target_bbox": (374, 749, 24, 29),
        "min_expected": 3, "max_expected": 8,
        "size_range": (15, 40),
    },
    {
        "name": "ct_markup_bubbles",
        "pdf": f"{KEMIRA}/Cooling Tower Platform and Ladder/Z1070035MARKUP_20250526194852.050_X.pdf",
        "page": 1,
        "target_bbox": (217, 849, 20, 28),
        "min_expected": 2, "max_expected": 15,
        "size_range": (15, 35),
    },
    {
        "name": "pid_flow_symbol",
        "pdf": f"{KEMIRA}/17041-100 - 2024 10 11 - Issued.pdf",
        "page": 1,
        "target_bbox": (4784, 2144, 97, 97),
        "min_expected": 1, "max_expected": 5,
        "size_range": (60, 150),
    },
    {
        "name": "crane_layout",
        "pdf": f"{KEMIRA}/PENG STAMPED SO35080-01 2TON TR SG 38FT SPAN CRANE GENERAL LAYOUT-Model.pdf",
        "page": 1,
        "target_bbox": (920, 298, 93, 76),
        "min_expected": 1, "max_expected": 4,
        "size_range": (50, 130),
    },
]


def find_best_cluster(clusters: list, target_bbox: tuple, size_range: tuple) -> dict | None:
    """Find the cluster that best matches the target symbol."""
    bx, by, bw, bh = target_bbox
    min_sz, max_sz = size_range

    best = None
    best_score = -1

    for c in clusters:
        cw = c["avgDimensions"]["w"]
        ch = c["avgDimensions"]["h"]
        avg_dim = (cw + ch) / 2

        # Must be in the right size range
        if avg_dim < min_sz or avg_dim > max_sz:
            continue

        # Size similarity to target
        w_sim = min(cw, bw) / max(cw, bw) if max(cw, bw) > 0 else 0
        h_sim = min(ch, bh) / max(ch, bh) if max(ch, bh) > 0 else 0
        size_score = (w_sim + h_sim) / 2

        # Location overlap: does any top match overlap with target bbox?
        location_score = 0
        for m in c["topMatches"]:
            if (abs(m["x"] - bx) < max(bw, cw) * 1.5 and
                abs(m["y"] - by) < max(bh, ch) * 1.5):
                location_score = 1.0
                break

        # Confidence score
        conf_score = c["avgConfidence"]

        # Combined score
        score = size_score * 0.3 + location_score * 0.5 + conf_score * 0.2

        if score > best_score:
            best_score = score
            best = {**c, "_match_score": round(score, 3), "_size_score": round(size_score, 3),
                    "_location_score": location_score}

    return best


def run_eval(config: dict, verbose: bool = True) -> dict:
    """Run eval with specific scanner config."""
    results = []
    in_range = 0
    total_match_score = 0.0
    total_time = 0.0
    run_count = 0

    for case in TEST_CASES:
        if not os.path.exists(case["pdf"]):
            results.append({"name": case["name"], "status": "skip"})
            continue

        start = time.time()
        scan = scan_page(
            case["pdf"], case["page"],
            dpi=config.get("dpi", 150),
            min_size=config.get("min_size", 15),
            max_size=config.get("max_size", 200),
            min_cluster_size=config.get("min_cluster_size", 2),
            max_clusters=config.get("max_clusters", 12),
            count_threshold=config.get("count_threshold", 0.75),
        )
        elapsed = time.time() - start
        total_time += elapsed

        best = find_best_cluster(scan["clusters"], case["target_bbox"], case["size_range"])
        run_count += 1

        if best:
            count = best["matchCount"]
            is_in_range = case["min_expected"] <= count <= case["max_expected"]
            if is_in_range:
                in_range += 1
            total_match_score += best["_match_score"]

            r = {
                "name": case["name"],
                "status": "ok",
                "matchCount": count,
                "in_range": is_in_range,
                "expected": f"{case['min_expected']}-{case['max_expected']}",
                "clusterId": best["id"],
                "clusterSize": f"{best['avgDimensions']['w']}x{best['avgDimensions']['h']}",
                "matchScore": best["_match_score"],
                "elapsed": round(elapsed, 2),
            }
        else:
            r = {
                "name": case["name"],
                "status": "no_match",
                "totalClusters": scan["totalClusters"],
                "elapsed": round(elapsed, 2),
            }

        results.append(r)

        if verbose:
            if r["status"] == "ok":
                flag = "✓" if r["in_range"] else "✗"
                print(f'  {flag} {r["name"]}: {r["matchCount"]} (expected {r["expected"]}) '
                      f'C{r["clusterId"]} {r["clusterSize"]} score={r["matchScore"]:.2f} {r["elapsed"]:.1f}s')
            else:
                print(f'  - {r["name"]}: {r["status"]} ({scan["totalClusters"]} clusters) {r["elapsed"]:.1f}s')

    accuracy = in_range / run_count if run_count > 0 else 0
    coverage = total_match_score / run_count if run_count > 0 else 0
    avg_time = total_time / run_count if run_count > 0 else 999
    speed_bonus = min(1.0, 5.0 / avg_time) if avg_time > 0 else 1.0
    score = accuracy * (0.7 + 0.3 * coverage) * speed_bonus

    summary = {
        "config": config,
        "accuracy": round(accuracy, 3),
        "coverage": round(coverage, 3),
        "avg_time": round(avg_time, 3),
        "speed_bonus": round(speed_bonus, 3),
        "score": round(score, 3),
        "in_range": in_range,
        "run_count": run_count,
        "results": results,
    }

    if verbose:
        print(f'\n  SCORE={score:.3f} (Acc={accuracy:.3f} × Cov={coverage:.3f} × Speed={speed_bonus:.3f})')
        print(f'  InRange={in_range}/{run_count} AvgTime={avg_time:.2f}s')

    return summary


def autoresearch_loop(verbose=True):
    """Sweep scanner parameters."""
    print("█" * 70)
    print("SCAN AUTORESEARCH — parameter sweep")
    print("█" * 70)

    configs = [
        # Baseline
        {"name": "baseline", "min_size": 15, "max_size": 200, "count_threshold": 0.75,
         "min_cluster_size": 2, "max_clusters": 12},

        # Vary count_threshold
        {"name": "thresh_0.70", "min_size": 15, "max_size": 200, "count_threshold": 0.70,
         "min_cluster_size": 2, "max_clusters": 12},
        {"name": "thresh_0.65", "min_size": 15, "max_size": 200, "count_threshold": 0.65,
         "min_cluster_size": 2, "max_clusters": 12},
        {"name": "thresh_0.80", "min_size": 15, "max_size": 200, "count_threshold": 0.80,
         "min_cluster_size": 2, "max_clusters": 12},

        # Vary min_size (skip tiny text)
        {"name": "minsize_20", "min_size": 20, "max_size": 200, "count_threshold": 0.75,
         "min_cluster_size": 2, "max_clusters": 12},
        {"name": "minsize_10", "min_size": 10, "max_size": 200, "count_threshold": 0.75,
         "min_cluster_size": 2, "max_clusters": 12},

        # Vary min_cluster_size (require more candidates to form a cluster)
        {"name": "minclust_3", "min_size": 15, "max_size": 200, "count_threshold": 0.75,
         "min_cluster_size": 3, "max_clusters": 12},
        {"name": "minclust_1", "min_size": 15, "max_size": 200, "count_threshold": 0.75,
         "min_cluster_size": 1, "max_clusters": 12},

        # More clusters
        {"name": "maxclust_20", "min_size": 15, "max_size": 200, "count_threshold": 0.75,
         "min_cluster_size": 2, "max_clusters": 20},

        # Combined: lower threshold + more candidates
        {"name": "aggressive", "min_size": 10, "max_size": 250, "count_threshold": 0.70,
         "min_cluster_size": 1, "max_clusters": 20},

        # Tight: higher threshold + bigger min_size
        {"name": "tight", "min_size": 20, "max_size": 180, "count_threshold": 0.78,
         "min_cluster_size": 2, "max_clusters": 10},

        # Best guess combo
        {"name": "tuned", "min_size": 12, "max_size": 220, "count_threshold": 0.73,
         "min_cluster_size": 2, "max_clusters": 15},
    ]

    all_results = []
    best_score = 0
    best_config = None

    for i, cfg in enumerate(configs):
        name = cfg.pop("name", f"run_{i}")
        print(f"\n{'─' * 70}")
        print(f"RUN {i+1}/{len(configs)}: {name} | {cfg}")
        print(f"{'─' * 70}")

        summary = run_eval(cfg, verbose=verbose)
        run_data = {"run": i + 1, "name": name, **{k: v for k, v in summary.items() if k != "results"}}
        all_results.append(run_data)

        if summary["score"] > best_score:
            best_score = summary["score"]
            best_config = {"name": name, **cfg}
            print(f"  ★ NEW BEST: {best_score:.3f}")
        else:
            print(f"  → {summary['score'] - best_score:+.3f} from best ({best_score:.3f})")

    print(f"\n{'█' * 70}")
    print("SCAN AUTORESEARCH COMPLETE")
    print(f"{'█' * 70}")
    all_results.sort(key=lambda r: -r["score"])
    for r in all_results:
        marker = " ★" if r.get("name") == best_config.get("name") else ""
        print(f"  {r['name']:20s}: score={r['score']:.3f} acc={r['accuracy']:.3f} "
              f"cov={r['coverage']:.3f} t={r['avg_time']:.2f}s{marker}")

    print(f"\nBEST: {best_config}")
    print(f"SCORE: {best_score:.3f}")

    with open(os.path.join(OUT, "scan_autoresearch_results.json"), "w") as f:
        json.dump({"best": best_config, "best_score": best_score, "runs": all_results}, f, indent=2)

    return best_config, best_score


if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument("mode", nargs="?", default="sweep", choices=["eval", "sweep"])
    parser.add_argument("--threshold", type=float, default=0.75)
    args = parser.parse_args()

    if args.mode == "eval":
        print("═" * 70)
        print(f"SINGLE EVAL (threshold={args.threshold})")
        print("═" * 70)
        run_eval({"count_threshold": args.threshold})
    else:
        autoresearch_loop()
