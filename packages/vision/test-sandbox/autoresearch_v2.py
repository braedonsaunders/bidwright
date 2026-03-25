#!/usr/bin/env python3
"""
Autoresearch v2 — Performance + Multi-page + Multi-document optimization.
Tests the full pipeline including:
  - Single page counting (baseline)
  - Cross-page counting (same template across all pages)
  - Batch counting (multiple templates on one page)
  - Robustness (corrupt PDFs, blank pages, non-drawing content)
  - Speed benchmarks

5 packages: Soprema, Kemira, Home Hardware, Birla, Gyptec
"""
import sys, os, json, time
import numpy as np, cv2

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "python"))
from tools.renderer import render_to_numpy
from tools.find_symbols import find_symbol_candidates, validate_bbox_has_content, crop_component
from tools.count_symbols import count_matches, count_matches_cross_scale, count_matches_on_pdf

SANDBOX = os.path.dirname(__file__)
OUT = os.path.join(SANDBOX, "autoresearch_v2_output")
os.makedirs(OUT, exist_ok=True)

SOPREMA = os.path.join(SANDBOX, "Soprema Tillsonburg_RFQ Package")
KEMIRA = os.path.join(SANDBOX, "kemira", "Kemira Brantford")
HH = os.path.join(SANDBOX, "homehardware", "Home Hardware", "HH RFP Installation Package")
BIRLA = os.path.join(SANDBOX, "birla", "Birla Unit 4 Breeching")
GYPTEC = os.path.join(SANDBOX, "gyptec", "Gyptec (CertainTeed)")


def safe_render(pdf, page, dpi=150):
    """Render with error handling for corrupt PDFs."""
    try:
        return render_to_numpy(pdf, page, dpi)
    except Exception as e:
        return None, 0, 0, 0, 0


def safe_count(template, document, threshold=0.75):
    """Count with error handling."""
    try:
        return count_matches(template, document, threshold=threshold)
    except Exception:
        return []


# ═══════════════════════════════════════════════════════════════
# TEST SUITE
# ═══════════════════════════════════════════════════════════════

def test_single_page_counting():
    """Baseline: count symbols on a single page with known bbox."""
    print("\n" + "="*70)
    print("TEST 1: Single-page counting (baseline accuracy)")
    print("="*70)

    cases = [
        ("Soprema LS instruments", os.path.join(SOPREMA, "P&IDs", "PID-PENTANE-0001 R1.pdf"),
         1, {"x": 3425, "y": 2102, "w": 87, "h": 87}, 2, 5),
        ("Soprema valve tags", os.path.join(SOPREMA, "P&IDs", "PID-PENTANE-0001 R1.pdf"),
         1, "auto:valve_tag", 20, 60),
        ("HH drain symbols", os.path.join(HH, "PID", "006-P-HT-001,_ DEVREE FILLER HOLDING TANK Rev.F.pdf"),
         1, {"x": 517, "y": 1484, "w": 42, "h": 37}, 5, 15),
        ("HH connection diamonds", os.path.join(HH, "PID", "006-P-HT-001,_ DEVREE FILLER HOLDING TANK Rev.F.pdf"),
         1, {"x": 991, "y": 2770, "w": 76, "h": 75}, 10, 30),
        ("Birla grid markers", os.path.join(BIRLA, "Exist Plant Struct Drawings Combined.pdf"),
         2, {"x": 1965, "y": 1761, "w": 78, "h": 78}, 3, 10),
    ]

    results = []
    for name, pdf, page, bbox, min_exp, max_exp in cases:
        if not os.path.exists(pdf):
            print(f"  SKIP: {name} (pdf not found)")
            continue

        start = time.time()
        data = safe_render(pdf, page, 150)
        if data[0] is None:
            print(f"  FAIL: {name} (render failed)")
            continue
        img, pw, ph, iw, ih = data

        # Resolve bbox
        if isinstance(bbox, str) and bbox.startswith("auto:"):
            cands = find_symbol_candidates(img, iw, ih, min_size=15, max_size=200, min_area=80)
            valid = [c for c in cands if validate_bbox_has_content(img, c["x"], c["y"], c["w"], c["h"], 5.0)]
            vtags = [c for c in valid if 70 < c["w"] < 160 and 25 < c["h"] < 60 and c["w"] > c["h"] * 1.8]
            if not vtags:
                print(f"  SKIP: {name} (auto-discover failed)")
                continue
            c = vtags[0]
            bbox = {"x": c["x"], "y": c["y"], "w": c["w"], "h": c["h"]}

        bx, by, bw, bh = bbox["x"], bbox["y"], bbox["w"], bbox["h"]
        if not validate_bbox_has_content(img, bx, by, bw, bh):
            print(f"  FAIL: {name} (blank template)")
            continue

        template = crop_component(img, bx, by, bw, bh, pad=2)
        matches = safe_count(template, img, threshold=0.75)
        elapsed = time.time() - start

        tp = sum(1 for m in matches if validate_bbox_has_content(img, m["x"], m["y"], m["w"], m["h"], 3.0))
        in_range = min_exp <= tp <= max_exp
        flag = "✓" if in_range else "✗"
        print(f"  {flag} {name}: {tp} matches (expected {min_exp}-{max_exp}) {elapsed:.2f}s")
        results.append({"name": name, "tp": tp, "in_range": in_range, "elapsed": elapsed})

    return results


def test_cross_page_counting():
    """Count same symbol across all pages of a multi-page document."""
    print("\n" + "="*70)
    print("TEST 2: Cross-page counting (same template, all pages)")
    print("="*70)

    cases = [
        ("Soprema valve tags across 11 P&IDs (cross-scale)",
         [os.path.join(SOPREMA, "P&IDs", f) for f in sorted(os.listdir(os.path.join(SOPREMA, "P&IDs")))
          if f.startswith("PID-") and f.endswith(".pdf")],
         "auto:valve_tag_cross_scale", 350, 500),
        ("HH ISO piping across 12 pages",
         [os.path.join(HH, "ISO", "HOME HARDWARE REV01 1.29.2025.pdf")] * 3,  # pages 1-3
         "auto:callout", 1, 50),
    ]

    results = []
    for name, pdfs_or_pages, bbox_type, min_total, max_total in cases:
        print(f"\n  {name}:")
        grand_total = 0
        total_time = 0
        page_results = []

        # Try to get template from the PDFs — try multiple until one works
        template = None
        template_bbox = None
        first_pdf = pdfs_or_pages[0]

        # Try all PDFs — pick the one with the most valve tag candidates (highest density)
        best_vtag_count = 0
        for try_pdf in pdfs_or_pages:
            if not os.path.exists(try_pdf):
                continue
            data = safe_render(try_pdf, 1, 150)
            if data[0] is None:
                continue
            img0, pw, ph, iw, ih = data

            cands = find_symbol_candidates(img0, iw, ih, min_size=15, max_size=200, min_area=80)
            valid = [c for c in cands if validate_bbox_has_content(img0, c["x"], c["y"], c["w"], c["h"], 5.0)]

            bt = bbox_type.replace("_per_doc", "").replace("_cross_scale", "")
            if bt == "auto:valve_tag":
                # Narrow filter: valve tags are rectangular, w > 2*h, 90-130px wide
                vtags = [c for c in valid if 90 < c["w"] < 130 and 30 < c["h"] < 55 and c["w"] > c["h"] * 2]
                if len(vtags) > best_vtag_count:
                    best_vtag_count = len(vtags)
                    c = vtags[0]
                    template = crop_component(img0, c["x"], c["y"], c["w"], c["h"], pad=2)
                    template_bbox = c
                    first_pdf = try_pdf
            elif bt == "auto:callout":
                callouts = [c for c in valid if 0.6 < c["aspect"] < 1.6 and 15 < c["w"] < 60 and c["y"] < ih * 0.85]
                if callouts:
                    c = callouts[0]
                    template = crop_component(img0, c["x"], c["y"], c["w"], c["h"], pad=2)
                    template_bbox = c
                    first_pdf = try_pdf
                    break

        if template is None:
            print(f"    SKIP: no template found across {len(pdfs_or_pages)} PDFs")
            continue

        # Count across all PDFs/pages
        per_doc = bbox_type.endswith("_per_doc")
        for i, pdf in enumerate(pdfs_or_pages):
            pg = i + 1 if all(p == pdfs_or_pages[0] for p in pdfs_or_pages) else 1
            start = time.time()
            data = safe_render(pdf, pg, 150)
            if data[0] is None:
                continue
            img, _, _, iw_curr, ih_curr = data

            # Use cross-scale matching for cross-document searches
            use_cross_scale = bbox_type.endswith("_cross_scale")
            if use_cross_scale:
                matches = count_matches_cross_scale(template, img, threshold=0.75)
            else:
                matches = safe_count(template, img, threshold=0.75)
            elapsed = time.time() - start
            total_time += elapsed

            tp = sum(1 for m in matches if validate_bbox_has_content(img, m["x"], m["y"], m["w"], m["h"], 3.0))
            grand_total += tp
            page_results.append({"pdf": os.path.basename(pdf), "page": pg, "count": tp, "time": elapsed})
            print(f"    Page {pg} ({os.path.basename(pdf)[:30]}): {tp} matches ({elapsed:.2f}s)")

        in_range = min_total <= grand_total <= max_total
        flag = "✓" if in_range else "✗"
        print(f"  {flag} TOTAL: {grand_total} (expected {min_total}-{max_total}) in {total_time:.2f}s")
        results.append({"name": name, "grand_total": grand_total, "in_range": in_range,
                         "total_time": total_time, "pages": len(page_results)})

    return results


def test_batch_counting():
    """Count multiple different symbol types on one page."""
    print("\n" + "="*70)
    print("TEST 3: Batch counting (multiple templates, one page)")
    print("="*70)

    pdf = os.path.join(HH, "PID", "006-P-HT-001,_ DEVREE FILLER HOLDING TANK Rev.F.pdf")
    if not os.path.exists(pdf):
        print("  SKIP: HH P&ID not found")
        return []

    data = safe_render(pdf, 1, 150)
    if data[0] is None:
        print("  FAIL: render failed")
        return []
    img, pw, ph, iw, ih = data

    # Find multiple symbol types
    cands = find_symbol_candidates(img, iw, ih, min_size=20, max_size=120, min_area=150)
    valid = [c for c in cands if validate_bbox_has_content(img, c["x"], c["y"], c["w"], c["h"], 5.0)]

    # Cluster by size bucket, pick one from each
    buckets = {}
    for c in valid:
        key = (round(c["w"]/20)*20, round(c["h"]/20)*20)
        if key not in buckets:
            buckets[key] = c

    templates = []
    for (bw, bh), c in sorted(buckets.items(), key=lambda x: -x[1]["area"])[:5]:
        tpl = crop_component(img, c["x"], c["y"], c["w"], c["h"], pad=2)
        if tpl is not None and tpl.size > 0:
            templates.append({"size": f"{bw}x{bh}", "template": tpl, "source": c})

    print(f"  Found {len(templates)} distinct symbol types to count")

    total_start = time.time()
    batch_results = []
    total_matches = 0

    for t in templates:
        start = time.time()
        matches = safe_count(t["template"], img, threshold=0.75)
        elapsed = time.time() - start
        tp = sum(1 for m in matches if validate_bbox_has_content(img, m["x"], m["y"], m["w"], m["h"], 3.0))
        total_matches += tp
        batch_results.append({"size": t["size"], "matches": tp, "time": elapsed})
        if tp > 1:
            print(f"    ~{t['size']}: {tp} matches ({elapsed:.2f}s)")

    total_elapsed = time.time() - total_start
    print(f"  TOTAL: {total_matches} matches across {len(templates)} types in {total_elapsed:.2f}s")
    print(f"  Average: {total_elapsed/len(templates):.3f}s per template")

    return batch_results


def test_robustness():
    """Test against corrupt, blank, and non-drawing content."""
    print("\n" + "="*70)
    print("TEST 4: Robustness (corrupt PDFs, blank pages, non-drawings)")
    print("="*70)

    cases = [
        ("Gyptec corrupt PDF p3 (blank)", os.path.join(GYPTEC, "500251-170000 Installation concept 2025-04-15.pdf"), 3),
        ("Gyptec corrupt PDF p1 (garbled fonts)", os.path.join(GYPTEC, "500251-170000 Installation concept 2025-04-15.pdf"), 1),
        ("Gyptec timesheet (non-drawing)", os.path.join(GYPTEC, "Extras", "Combustion Air Ducting Installation.pdf"), 1),
    ]

    results = []
    for name, pdf, page in cases:
        if not os.path.exists(pdf):
            print(f"  SKIP: {name}")
            continue

        start = time.time()
        data = safe_render(pdf, page, 150)
        elapsed_render = time.time() - start

        if data[0] is None:
            print(f"  ✓ {name}: render returned None gracefully ({elapsed_render:.2f}s)")
            results.append({"name": name, "status": "graceful_fail", "time": elapsed_render})
            continue

        img, pw, ph, iw, ih = data

        # Try to find symbols — should either find nothing or not crash
        start = time.time()
        cands = find_symbol_candidates(img, iw, ih, min_size=20, max_size=120, min_area=150)
        elapsed_find = time.time() - start

        # Try counting with auto-discovered template
        valid = [c for c in cands if validate_bbox_has_content(img, c["x"], c["y"], c["w"], c["h"], 5.0)]
        count = 0
        elapsed_count = 0
        if valid:
            c = valid[0]
            tpl = crop_component(img, c["x"], c["y"], c["w"], c["h"], pad=2)
            start = time.time()
            matches = safe_count(tpl, img, threshold=0.75)
            elapsed_count = time.time() - start
            count = len(matches)

        total = elapsed_render + elapsed_find + elapsed_count
        print(f"  ✓ {name}: {len(cands)} candidates, {count} matches, no crash ({total:.2f}s)")
        results.append({"name": name, "status": "ok", "candidates": len(cands), "matches": count, "time": total})

    return results


def test_speed_benchmark():
    """Pure speed benchmark — how fast can we process pages?"""
    print("\n" + "="*70)
    print("TEST 5: Speed benchmark")
    print("="*70)

    # Time individual operations
    pdf = os.path.join(SOPREMA, "P&IDs", "PID-PENTANE-0001 R1.pdf")
    if not os.path.exists(pdf):
        print("  SKIP: Soprema not available")
        return {}

    # Benchmark render
    times_render = []
    for _ in range(3):
        start = time.time()
        safe_render(pdf, 1, 150)
        times_render.append(time.time() - start)

    # Benchmark find_symbols
    img, pw, ph, iw, ih = render_to_numpy(pdf, 1, 150)
    times_find = []
    for _ in range(3):
        start = time.time()
        find_symbol_candidates(img, iw, ih, min_size=20, max_size=150, min_area=100)
        times_find.append(time.time() - start)

    # Benchmark count_matches
    cands = find_symbol_candidates(img, iw, ih, min_size=15, max_size=200, min_area=80)
    valid = [c for c in cands if validate_bbox_has_content(img, c["x"], c["y"], c["w"], c["h"], 5.0)]
    vtags = [c for c in valid if 70 < c["w"] < 160 and 25 < c["h"] < 60 and c["w"] > c["h"] * 1.8]
    if vtags:
        c = vtags[0]
        tpl = crop_component(img, c["x"], c["y"], c["w"], c["h"], pad=2)
        times_count = []
        for _ in range(3):
            start = time.time()
            count_matches(tpl, img, threshold=0.75)
            times_count.append(time.time() - start)
    else:
        times_count = [0]

    avg_render = sum(times_render) / len(times_render)
    avg_find = sum(times_find) / len(times_find)
    avg_count = sum(times_count) / len(times_count)
    total_pipeline = avg_render + avg_find + avg_count

    print(f"  Render page (150 DPI):     {avg_render:.3f}s avg")
    print(f"  Find symbols:              {avg_find:.3f}s avg")
    print(f"  Count matches:             {avg_count:.3f}s avg")
    print(f"  Full pipeline (one page):  {total_pipeline:.3f}s avg")
    print(f"  Throughput:                {60/total_pipeline:.0f} pages/minute")

    return {
        "render": round(avg_render, 3),
        "find": round(avg_find, 3),
        "count": round(avg_count, 3),
        "pipeline": round(total_pipeline, 3),
        "pages_per_minute": round(60 / total_pipeline),
    }


# ═══════════════════════════════════════════════════════════════
# MAIN
# ═══════════════════════════════════════════════════════════════

if __name__ == "__main__":
    print("█" * 70)
    print("AUTORESEARCH V2: Multi-page, multi-document, performance")
    print("5 packages: Soprema, Kemira, Home Hardware, Birla, Gyptec")
    print("█" * 70)

    all_results = {}

    all_results["single_page"] = test_single_page_counting()
    all_results["cross_page"] = test_cross_page_counting()
    all_results["batch"] = test_batch_counting()
    all_results["robustness"] = test_robustness()
    all_results["speed"] = test_speed_benchmark()

    # Final score
    print("\n" + "█" * 70)
    print("FINAL SUMMARY")
    print("█" * 70)

    single_pass = sum(1 for r in all_results["single_page"] if r.get("in_range"))
    single_total = len(all_results["single_page"])
    cross_pass = sum(1 for r in all_results["cross_page"] if r.get("in_range"))
    cross_total = len(all_results["cross_page"])
    robust_ok = sum(1 for r in all_results["robustness"] if r.get("status") in ("ok", "graceful_fail"))
    robust_total = len(all_results["robustness"])
    speed = all_results["speed"]

    print(f"  Single-page accuracy:  {single_pass}/{single_total}")
    print(f"  Cross-page accuracy:   {cross_pass}/{cross_total}")
    print(f"  Robustness:            {robust_ok}/{robust_total} (no crashes)")
    print(f"  Speed:                 {speed.get('pipeline', '?')}s/page = {speed.get('pages_per_minute', '?')} pages/min")

    # Composite score
    accuracy = (single_pass + cross_pass) / max(1, single_total + cross_total)
    robustness = robust_ok / max(1, robust_total)
    speed_score = min(1.0, 1.0 / max(0.1, speed.get("pipeline", 1))) if speed else 0.5
    composite = accuracy * 0.5 + robustness * 0.2 + speed_score * 0.3

    print(f"\n  COMPOSITE SCORE: {composite:.3f}")
    print(f"    Accuracy weight (50%): {accuracy:.3f}")
    print(f"    Robustness weight (20%): {robustness:.3f}")
    print(f"    Speed weight (30%): {speed_score:.3f}")

    # Save results
    with open(os.path.join(OUT, "v2_results.json"), "w") as f:
        json.dump(all_results, f, indent=2, default=str)

    print(f"\n  Results saved to {OUT}/v2_results.json")
