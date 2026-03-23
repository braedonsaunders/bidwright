#!/usr/bin/env python3
"""
Direct test harness for the vision tools on real P&ID drawings.
Calls render_page.py and auto_count.py directly without the API layer.
"""
import subprocess
import json
import sys
import os
import time
import base64

PYTHON = sys.executable
SCRIPT_DIR = os.path.join(os.path.dirname(__file__), "..", "python")
RENDER_SCRIPT = os.path.join(SCRIPT_DIR, "render_page.py")
AUTO_COUNT_SCRIPT = os.path.join(SCRIPT_DIR, "auto_count.py")
SANDBOX_DIR = os.path.dirname(__file__)
OUTPUT_DIR = os.path.join(SANDBOX_DIR, "test_output")
os.makedirs(OUTPUT_DIR, exist_ok=True)


def run_python_tool(script, payload):
    """Run a Python tool via stdin JSON, return parsed output."""
    start = time.time()
    proc = subprocess.run(
        [PYTHON, script, "--json"],
        input=json.dumps(payload),
        capture_output=True,
        text=True,
        timeout=120,
    )
    elapsed = time.time() - start
    if proc.returncode != 0:
        return {"success": False, "error": proc.stderr[:500], "elapsed": elapsed}
    try:
        result = json.loads(proc.stdout)
        result["elapsed"] = elapsed
        return result
    except json.JSONDecodeError:
        return {"success": False, "error": f"Bad JSON: {proc.stdout[:300]}", "elapsed": elapsed}


def save_image(data_url, filename):
    """Save a data:image/png;base64,... to a file."""
    if not data_url or not data_url.startswith("data:"):
        return None
    b64 = data_url.split(",", 1)[1]
    path = os.path.join(OUTPUT_DIR, filename)
    with open(path, "wb") as f:
        f.write(base64.b64decode(b64))
    return path


def test_render_page(pdf_path, page=1, dpi=150, label=""):
    """Test 1: Can we render a full P&ID page?"""
    print(f"\n{'='*60}")
    print(f"TEST: Render page — {label or os.path.basename(pdf_path)} p{page} @{dpi}dpi")
    print(f"{'='*60}")

    result = run_python_tool(RENDER_SCRIPT, {
        "pdfPath": pdf_path,
        "pageNumber": page,
        "dpi": dpi,
    })

    if result.get("success"):
        fname = f"render_{label or 'page'}_{page}_{dpi}dpi.png"
        saved = save_image(result.get("image"), fname)
        print(f"  OK — {result['width']}x{result['height']}px, {result['pageCount']} pages total")
        print(f"  PDF page size: {result['pageWidth']:.0f}x{result['pageHeight']:.0f}pt")
        print(f"  Saved: {saved}")
        print(f"  Time: {result['elapsed']:.2f}s")
        return result
    else:
        print(f"  FAILED: {result.get('error', 'unknown')}")
        return None


def test_zoom_region(pdf_path, page, region, dpi=300, label=""):
    """Test 2: Can we zoom into a specific region?"""
    print(f"\n{'='*60}")
    print(f"TEST: Zoom region — {label}")
    print(f"  Region: x={region['x']}, y={region['y']}, {region['width']}x{region['height']}")
    print(f"{'='*60}")

    result = run_python_tool(RENDER_SCRIPT, {
        "pdfPath": pdf_path,
        "pageNumber": page,
        "dpi": dpi,
        "region": region,
    })

    if result.get("success"):
        fname = f"zoom_{label or 'region'}.png"
        saved = save_image(result.get("image"), fname)
        print(f"  OK — {result['width']}x{result['height']}px")
        print(f"  Saved: {saved}")
        print(f"  Time: {result['elapsed']:.2f}s")
        return result
    else:
        print(f"  FAILED: {result.get('error', 'unknown')}")
        return None


def test_auto_count(pdf_path, page, bbox, threshold=0.65, label=""):
    """Test 3: Can we count symbols using a bounding box template?"""
    print(f"\n{'='*60}")
    print(f"TEST: Auto-count symbols — {label}")
    print(f"  Template bbox: x={bbox['x']}, y={bbox['y']}, {bbox['width']}x{bbox['height']}")
    print(f"  Threshold: {threshold}")
    print(f"{'='*60}")

    result = run_python_tool(AUTO_COUNT_SCRIPT, {
        "pdfPath": pdf_path,
        "pageNumber": page,
        "boundingBox": bbox,
        "threshold": threshold,
    })

    # auto_count wraps in {"result": ...}
    inner = result.get("result", result)
    elapsed = result.get("elapsed", 0)

    if inner.get("error"):
        print(f"  FAILED: {inner['error']}")
        return None

    matches = inner.get("final_matches", [])
    print(f"  Found: {len(matches)} matches")
    print(f"  Processing time: {inner.get('processing_time', 0):.2f}s (wall: {elapsed:.2f}s)")
    print(f"  Complex PDF: {inner.get('complex_pdf_detected', False)}")
    print(f"  Vector count sample: {inner.get('vector_count_sample', 0)}")

    # Save snippet
    snippet = inner.get("pdf_snippet_image")
    if snippet:
        save_image(snippet, f"snippet_{label or 'template'}.png")

    for i, m in enumerate(matches[:10]):
        method = m.get("detection_method", "?")
        conf = m.get("confidence", 0)
        text = m.get("text", "")[:30]
        rect = m.get("rect", {})
        print(f"  Match {i+1}: conf={conf:.2f} method='{method}' text='{text}' @ ({rect.get('x',0):.1f}, {rect.get('y',0):.1f})")
        # Save match images
        if m.get("image"):
            save_image(m["image"], f"match_{label}_{i+1}.png")

    if len(matches) > 10:
        print(f"  ... and {len(matches)-10} more")

    return inner


def test_text_extraction(pdf_path, page=1, label=""):
    """Test 4: Direct text extraction from PDF (for dimension harvesting)."""
    import fitz
    print(f"\n{'='*60}")
    print(f"TEST: Text extraction — {label or os.path.basename(pdf_path)} p{page}")
    print(f"{'='*60}")

    doc = fitz.open(pdf_path)
    if page > doc.page_count:
        print(f"  SKIP: only {doc.page_count} pages")
        doc.close()
        return None

    pg = doc.load_page(page - 1)
    text_dict = pg.get_text("dict")
    blocks = text_dict.get("blocks", [])

    all_spans = []
    for block in blocks:
        for line in block.get("lines", []):
            for span in line.get("spans", []):
                t = span.get("text", "").strip()
                if t:
                    all_spans.append({
                        "text": t,
                        "bbox": span.get("bbox"),
                        "size": span.get("size"),
                    })

    print(f"  Total text spans: {len(all_spans)}")

    # Find dimension-like patterns
    import re
    dim_patterns = []
    tag_patterns = []
    for s in all_spans:
        t = s["text"]
        # Dimensions: 2", 3'-6", 150mm, etc.
        if re.search(r'\d+[\'"]\s*[-]?\s*\d*[\'"]*', t) or re.search(r'\d+\s*(mm|cm|m|in|ft)\b', t, re.I):
            dim_patterns.append(t)
        # Equipment tags: like V-101, P-201, FV-301, etc.
        if re.search(r'[A-Z]{1,4}[-\s]\d{2,4}', t):
            tag_patterns.append(t)

    print(f"  Dimension-like strings: {len(dim_patterns)}")
    for d in dim_patterns[:15]:
        print(f"    '{d}'")
    if len(dim_patterns) > 15:
        print(f"    ... and {len(dim_patterns)-15} more")

    print(f"  Equipment tags: {len(tag_patterns)}")
    for t in tag_patterns[:20]:
        print(f"    '{t}'")
    if len(tag_patterns) > 20:
        print(f"    ... and {len(tag_patterns)-20} more")

    doc.close()
    return {"spans": len(all_spans), "dimensions": dim_patterns, "tags": tag_patterns}


def test_symbol_detection_on_pid(pdf_path, page=1, label=""):
    """Test 5: Full pipeline — render, find a valve symbol, count all valves."""
    import fitz
    print(f"\n{'='*60}")
    print(f"TEST: Full valve detection pipeline — {label}")
    print(f"{'='*60}")

    # Step 1: Render the page
    print("  Step 1: Rendering full page at 150 DPI...")
    render = test_render_page(pdf_path, page, 150, label=f"pid_{label}")
    if not render:
        return None

    img_w = render["width"]
    img_h = render["height"]

    # Step 2: Extract text to find equipment tags (valve tags like FV-xxx)
    print("\n  Step 2: Extracting text to find valve tags...")
    doc = fitz.open(pdf_path)
    pg = doc.load_page(page - 1)
    text_dict = pg.get_text("dict")

    valve_spans = []
    import re
    for block in text_dict.get("blocks", []):
        for line in block.get("lines", []):
            for span in line.get("spans", []):
                t = span.get("text", "").strip()
                # Look for valve-like tags: FV, BV, CV, XV, HV, PV, SV, etc.
                if re.match(r'^[A-Z]{1,3}V[-\s]?\d', t):
                    valve_spans.append({
                        "text": t,
                        "bbox": span.get("bbox"),
                    })

    print(f"  Found {len(valve_spans)} valve tag text spans")
    for vs in valve_spans[:10]:
        print(f"    '{vs['text']}' @ bbox={vs['bbox']}")

    if not valve_spans:
        # Try broader pattern
        for block in text_dict.get("blocks", []):
            for line in block.get("lines", []):
                for span in line.get("spans", []):
                    t = span.get("text", "").strip()
                    if re.match(r'^[A-Z]{1,4}[-\s]\d{2,4}', t):
                        valve_spans.append({"text": t, "bbox": span.get("bbox")})
        print(f"  Broader search found {len(valve_spans)} equipment tags")
        for vs in valve_spans[:10]:
            print(f"    '{vs['text']}' @ bbox={vs['bbox']}")

    doc.close()

    if not valve_spans:
        print("  No valve tags found — skipping auto-count")
        return None

    # Step 3: Use the first valve tag's bbox as template for auto-count
    first = valve_spans[0]
    pdf_bbox = first["bbox"]  # [x0, y0, x1, y1] in PDF coordinates

    # Convert PDF bbox to image coordinates
    scale_x = img_w / render["pageWidth"]
    scale_y = img_h / render["pageHeight"]

    img_bbox = {
        "x": pdf_bbox[0] * scale_x,
        "y": pdf_bbox[1] * scale_y,
        "width": (pdf_bbox[2] - pdf_bbox[0]) * scale_x,
        "height": (pdf_bbox[3] - pdf_bbox[1]) * scale_y,
        "imageWidth": img_w,
        "imageHeight": img_h,
    }

    # Add some padding around the tag to capture the symbol too
    pad = 15
    img_bbox["x"] = max(0, img_bbox["x"] - pad)
    img_bbox["y"] = max(0, img_bbox["y"] - pad)
    img_bbox["width"] += pad * 2
    img_bbox["height"] += pad * 2

    print(f"\n  Step 3: Zooming into first tag '{first['text']}'...")
    zoom_region = {
        "x": img_bbox["x"],
        "y": img_bbox["y"],
        "width": img_bbox["width"],
        "height": img_bbox["height"],
        "imageWidth": img_w,
        "imageHeight": img_h,
    }
    test_zoom_region(pdf_path, page, zoom_region, label=f"valve_{first['text']}")

    print(f"\n  Step 4: Running auto-count with template '{first['text']}'...")
    count_result = test_auto_count(
        pdf_path, page, img_bbox,
        threshold=0.65,
        label=f"valves_{first['text']}",
    )

    return count_result


# ─── Main ─────────────────────────────────────────────────────

if __name__ == "__main__":
    PACKAGE_DIR = os.path.join(SANDBOX_DIR, "Soprema Tillsonburg_RFQ Package")
    PID_DIR = os.path.join(PACKAGE_DIR, "P&IDs")

    # Pick a few diverse PDFs to test
    pids = sorted([f for f in os.listdir(PID_DIR) if f.endswith(".pdf")])
    print(f"Found {len(pids)} P&ID drawings")
    for p in pids:
        print(f"  - {p}")

    # Also grab the main spec/package drawing
    main_docs = [f for f in os.listdir(PACKAGE_DIR) if f.endswith(".pdf")]
    print(f"\nMain documents: {len(main_docs)}")
    for d in main_docs:
        print(f"  - {d}")

    # ─── TEST SUITE ───────────────────────────────────────────

    # Test 1: Render a P&ID page
    pid1 = os.path.join(PID_DIR, pids[0])
    test_render_page(pid1, 1, 150, label="pid1_overview")
    test_render_page(pid1, 1, 250, label="pid1_highres")

    # Test 2: Render the block flow diagram
    bfd = os.path.join(PID_DIR, "BLOCK FLOW DIAGRAM 1.pdf")
    if os.path.exists(bfd):
        test_render_page(bfd, 1, 150, label="bfd")

    # Test 3: Text extraction on multiple P&IDs
    for pid_name in pids[:4]:
        pdf_path = os.path.join(PID_DIR, pid_name)
        test_text_extraction(pdf_path, 1, label=pid_name.replace(".pdf", ""))

    # Test 4: Full valve detection pipeline on first P&ID
    test_symbol_detection_on_pid(pid1, 1, label="pid1")

    # Test 5: Try on a more complex P&ID
    if len(pids) > 3:
        pid2 = os.path.join(PID_DIR, pids[3])
        test_symbol_detection_on_pid(pid2, 1, label="pid2")

    # Test 6: Try the equipment package drawing
    equip = os.path.join(PACKAGE_DIR, "K5600-218 800U_PACKAGE REV 0.pdf")
    if os.path.exists(equip):
        test_render_page(equip, 1, 150, label="equip_pkg")
        test_text_extraction(equip, 1, label="equip_pkg")

    print(f"\n{'='*60}")
    print("ALL TESTS COMPLETE")
    print(f"Output images saved to: {OUTPUT_DIR}")
    print(f"{'='*60}")
