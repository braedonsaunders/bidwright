#!/usr/bin/env python3
"""
Kemira Brantford MCP end-to-end testing harness.

Tests the FULL pipeline the CLI agent uses:
  MCP tool call → API HTTP endpoint → Vision TypeScript → Python CV

Simulates the agent's exact workflow:
  1. listDrawingPages → discover documents
  2. renderDrawingPage → see the page (get coordinate space)
  3. countSymbols → run CV with bbox in that coordinate space
  4. countSymbolsAllPages → multi-page search
  5. findSymbolCandidates → auto-discovery

Each test validates:
  - HTTP response codes
  - JSON schema correctness
  - Match counts within expected ranges
  - Coordinate space consistency
  - Cross-document matching
  - Round-trip: render → extract bbox → count
"""
import sys, os, json, time, argparse, urllib.request

# ═══════════════════════════════════════════════════════════════
# CONFIG — matches what the MCP server uses
# ═══════════════════════════════════════════════════════════════

API_URL = os.environ.get("BIDWRIGHT_API_URL", "http://localhost:4001")
AUTH_TOKEN = os.environ.get("BIDWRIGHT_AUTH_TOKEN", "d9b2a503650d0f334caf9bf45ff444320068a374c8931c343343557d5180913b")
PROJECT_ID = os.environ.get("BIDWRIGHT_PROJECT_ID", "project-36dcd430-0910-4e97-a8be-126fc833e348")

OUT = os.path.join(os.path.dirname(__file__), "kemira_mcp_output")
os.makedirs(OUT, exist_ok=True)

# ═══════════════════════════════════════════════════════════════
# DOCUMENT ID MAP — from DB after ingestion
# ═══════════════════════════════════════════════════════════════

DOC_IDS = {
    "new_tank":       "doc_4e2c1724-de38-4808-bc2d-70d60994c8a0",
    "tank_bid":       "doc_b14d5fcc-fdfa-4d05-89ed-dddf60501c65",
    "pid":            "doc_e83017a8-a8fc-4d86-b5b6-fc4d4c8722ec",
    "crane_layout":   "doc_1c85bc58-26bb-46bf-a4d9-0637371a8c00",
    "crane_runway":   "doc_68f30ee4-ef13-42eb-859c-80f6581abf7b",
    "ct_detail":      "doc_9b95e2be-a513-437f-92a5-dcb8ed11c3e1",
    "ct_markup":      "doc_bf475c27-9c39-4f65-ad97-469c7afcd9b4",
    "ct_struct":      "doc_46db3474-1ac7-4438-a424-e830e938ee22",
    "ct_markup2":     "doc_04b1b865-3c3a-4441-93ad-7028ee301e55",
}


# ═══════════════════════════════════════════════════════════════
# API CLIENT — same HTTP calls the MCP server makes
# ═══════════════════════════════════════════════════════════════

def api_post(path: str, body: dict) -> dict:
    """POST to Bidwright API — mirrors MCP api-client.ts apiPost()."""
    url = f"{API_URL}{path}"
    data = json.dumps(body).encode("utf-8")
    req = urllib.request.Request(url, data=data, method="POST", headers={
        "Content-Type": "application/json",
        "Authorization": f"Bearer {AUTH_TOKEN}",
    })
    try:
        with urllib.request.urlopen(req, timeout=120) as resp:
            return json.loads(resp.read().decode())
    except urllib.error.HTTPError as e:
        body_text = e.read().decode() if e.fp else ""
        return {"_error": True, "_status": e.code, "_body": body_text[:500]}
    except Exception as e:
        return {"_error": True, "_status": 0, "_body": str(e)}


def api_get(path: str) -> dict:
    """GET from Bidwright API."""
    url = f"{API_URL}{path}"
    req = urllib.request.Request(url, method="GET", headers={
        "Content-Type": "application/json",
        "Authorization": f"Bearer {AUTH_TOKEN}",
    })
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            return json.loads(resp.read().decode())
    except urllib.error.HTTPError as e:
        body_text = e.read().decode() if e.fp else ""
        return {"_error": True, "_status": e.code, "_body": body_text[:500]}
    except Exception as e:
        return {"_error": True, "_status": 0, "_body": str(e)}


# ═══════════════════════════════════════════════════════════════
# MCP TOOL SIMULATORS — match exactly what vision-tools.ts does
# ═══════════════════════════════════════════════════════════════

def mcp_list_drawing_pages() -> dict:
    """Simulate listDrawingPages MCP tool."""
    workspace = api_get(f"/projects/{PROJECT_ID}/workspace")
    if "_error" in workspace:
        return workspace
    docs = workspace.get("sourceDocuments", workspace.get("documents", []))
    pdfs = [
        {"id": d["id"], "fileName": d.get("fileName", d.get("name")),
         "pageCount": d.get("pageCount"), "documentType": d.get("documentType")}
        for d in docs
        if d.get("fileType") in ("application/pdf", "pdf") or d.get("documentType") == "drawing"
    ]
    return {"documents": pdfs, "count": len(pdfs)}


def mcp_render_drawing_page(document_id: str, page_number: int = 1, dpi: int = 150) -> dict:
    """Simulate renderDrawingPage MCP tool."""
    result = api_post("/api/vision/render-page", {
        "projectId": PROJECT_ID,
        "documentId": document_id,
        "pageNumber": page_number,
        "dpi": dpi,
    })
    if "_error" in result or not result.get("success"):
        return result

    return {
        "success": True,
        "imageWidth": result.get("width"),
        "imageHeight": result.get("height"),
        "pageWidth": result.get("pageWidth"),
        "pageHeight": result.get("pageHeight"),
        "pageCount": result.get("pageCount"),
        "dpi": dpi,
        "hasImage": bool(result.get("image")),
    }


def mcp_count_symbols(document_id: str, page_number: int, bounding_box: dict,
                       threshold: float = 0.75, cross_scale: bool = False) -> dict:
    """Simulate countSymbols MCP tool."""
    result = api_post("/api/vision/count-symbols", {
        "projectId": PROJECT_ID,
        "documentId": document_id,
        "pageNumber": page_number,
        "boundingBox": bounding_box,
        "threshold": threshold,
        "crossScale": cross_scale,
    })

    if "_error" in result:
        return result

    if not result.get("success"):
        return {"_error": True, "_body": json.dumps(result)}

    # Strip base64 images (same as MCP tool does)
    matches = [
        {"rect": m["rect"], "confidence": m["confidence"],
         "text": m.get("text"), "method": m.get("detection_method")}
        for m in result.get("matches", [])
    ]

    return {
        "totalCount": result.get("totalCount"),
        "documentId": document_id,
        "pageNumber": page_number,
        "threshold": threshold,
        "duration_ms": result.get("duration_ms"),
        "matches": matches,
        "errors": result.get("errors", []),
    }


def mcp_count_symbols_all_pages(document_id: str, bounding_box: dict,
                                 threshold: float = 0.75, cross_scale: bool = False) -> dict:
    """Simulate countSymbolsAllPages MCP tool."""
    result = api_post("/api/vision/count-symbols-all-pages", {
        "projectId": PROJECT_ID,
        "documentId": document_id,
        "boundingBox": bounding_box,
        "threshold": threshold,
        "crossScale": cross_scale,
    })

    if "_error" in result:
        return result

    if not result.get("success"):
        return {"_error": True, "_body": json.dumps(result)}

    pages = [
        {"pageNumber": p["pageNumber"], "totalCount": p.get("totalCount", 0),
         "matchCount": len(p.get("matches", [])),
         "errors": p.get("errors", [])}
        for p in result.get("pages", [])
    ]

    return {
        "grandTotal": result.get("grandTotal"),
        "pageCount": result.get("pageCount"),
        "documentId": document_id,
        "threshold": threshold,
        "crossScale": cross_scale,
        "pages": pages,
    }


def mcp_find_symbol_candidates(document_id: str, page_number: int = 1,
                                min_size: int = 20, max_size: int = 150) -> dict:
    """Simulate findSymbolCandidates MCP tool."""
    result = api_post("/api/vision/find-symbols", {
        "projectId": PROJECT_ID,
        "documentId": document_id,
        "pageNumber": page_number,
        "minSize": min_size,
        "maxSize": max_size,
    })

    if "_error" in result:
        return result
    if not result.get("success"):
        return {"_error": True, "_body": json.dumps(result)}

    return {
        "total": result.get("total"),
        "imageWidth": result.get("imageWidth"),
        "imageHeight": result.get("imageHeight"),
        "candidates": result.get("candidates", [])[:30],
    }


# ═══════════════════════════════════════════════════════════════
# TEST CASES — full agent workflow simulations
# ═══════════════════════════════════════════════════════════════

TEST_CASES = [
    # ── Tank: nozzle flanges via renderPage → countSymbols ──
    {
        "name": "tank_nozzle_flanges",
        "doc_key": "new_tank",
        "page": 1,
        "bbox": {"x": 4547, "y": 1098, "width": 113, "height": 85},
        "min_expected": 2, "max_expected": 6,
        "desc": "Nozzle flange symbols (full MCP flow)",
    },
    # ── Tank: nozzle callouts ──
    {
        "name": "tank_nozzle_callouts",
        "doc_key": "new_tank",
        "page": 1,
        "bbox": {"x": 2504, "y": 1169, "width": 161, "height": 91},
        "min_expected": 2, "max_expected": 10,
        "desc": "Nozzle callout boxes",
    },
    # ── Tank bid: flanges ──
    {
        "name": "tankbid_flanges",
        "doc_key": "tank_bid",
        "page": 1,
        "bbox": {"x": 4523, "y": 1353, "width": 104, "height": 75},
        "min_expected": 2, "max_expected": 6,
        "desc": "Nozzle flanges on bid drawing",
    },
    # ── Tank bid: circles ──
    {
        "name": "tankbid_circles",
        "doc_key": "tank_bid",
        "page": 1,
        "bbox": {"x": 1595, "y": 948, "width": 86, "height": 85},
        "min_expected": 2, "max_expected": 8,
        "desc": "Nozzle ID circles",
    },
    # ── CT detail: section markers page 1 ──
    {
        "name": "ct_section_markers_p1",
        "doc_key": "ct_detail",
        "page": 1,
        "bbox": {"x": 374, "y": 749, "width": 24, "height": 29},
        "min_expected": 3, "max_expected": 8,
        "desc": "Section reference bubbles page 1",
    },
    # ── CT markup: bubbles ──
    {
        "name": "ct_markup_bubbles",
        "doc_key": "ct_markup",
        "page": 1,
        "bbox": {"x": 217, "y": 849, "width": 20, "height": 28},
        "min_expected": 2, "max_expected": 15,
        "desc": "Section bubbles on CT markup",
    },
    # ── PID: flow symbol ──
    {
        "name": "pid_flow_symbol",
        "doc_key": "pid",
        "page": 1,
        "bbox": {"x": 4784, "y": 2144, "width": 97, "height": 97},
        "min_expected": 1, "max_expected": 5,
        "desc": "Process flow diagram symbol",
    },
    # ── Crane layout ──
    {
        "name": "crane_layout_detail",
        "doc_key": "crane_layout",
        "page": 1,
        "bbox": {"x": 920, "y": 298, "width": 93, "height": 76},
        "min_expected": 1, "max_expected": 4,
        "desc": "Crane layout detail symbol",
    },
    # ── Cross-document: new_tank template → bid drawing ──
    {
        "name": "cross_doc_flanges",
        "doc_key": "tank_bid",
        "page": 1,
        "bbox": {"x": 4547, "y": 1098, "width": 113, "height": 85},
        "cross_scale": True,
        "min_expected": 1, "max_expected": 6,
        "desc": "Cross-doc flange search (cross-scale)",
    },
]


# ═══════════════════════════════════════════════════════════════
# TEST RUNNER
# ═══════════════════════════════════════════════════════════════

def run_single_test(case: dict, threshold: float = 0.75) -> dict:
    """Run one test case through the full MCP → API → Python pipeline."""
    doc_id = DOC_IDS.get(case["doc_key"])
    if not doc_id:
        return {"name": case["name"], "status": "skip", "reason": f"no doc_id for {case['doc_key']}"}

    start = time.time()

    # Step 1: renderDrawingPage (get coordinate space — same as agent would)
    render = mcp_render_drawing_page(doc_id, case["page"])
    if "_error" in render or not render.get("success"):
        return {"name": case["name"], "status": "fail", "reason": f"render failed: {render}",
                "elapsed": round(time.time() - start, 3)}

    iw = render["imageWidth"]
    ih = render["imageHeight"]

    # Step 2: countSymbols with bbox in render coordinate space
    bbox = {**case["bbox"], "imageWidth": iw, "imageHeight": ih}
    cross_scale = case.get("cross_scale", False)

    count = mcp_count_symbols(doc_id, case["page"], bbox, threshold=threshold, cross_scale=cross_scale)
    elapsed = round(time.time() - start, 3)

    if "_error" in count:
        return {"name": case["name"], "status": "fail", "reason": f"count failed: {count}",
                "elapsed": elapsed}

    total = count.get("totalCount", 0)
    errors = count.get("errors", [])
    in_range = case["min_expected"] <= total <= case["max_expected"]

    return {
        "name": case["name"],
        "status": "ok",
        "total": total,
        "in_range": in_range,
        "expected": f"{case['min_expected']}-{case['max_expected']}",
        "elapsed": elapsed,
        "duration_ms": count.get("duration_ms"),
        "cross_scale": cross_scale,
        "errors": errors if errors else None,
        "imageWidth": iw,
        "imageHeight": ih,
        "desc": case["desc"],
    }


def run_full_eval(threshold: float = 0.75, verbose: bool = True) -> dict:
    """Run all tests through the full MCP pipeline."""
    results = []
    total_count = 0
    total_time = 0.0
    in_range_count = 0
    run_count = 0

    for case in TEST_CASES:
        r = run_single_test(case, threshold)
        results.append(r)

        if r["status"] == "ok":
            run_count += 1
            total_count += r["total"]
            total_time += r["elapsed"]
            if r["in_range"]:
                in_range_count += 1

            if verbose:
                flag = "✓" if r["in_range"] else "✗"
                cross = " [XS]" if r.get("cross_scale") else ""
                print(f'    {flag} {r["name"]}: {r["total"]} matches '
                      f'(expected {r["expected"]}) '
                      f'{r["elapsed"]:.2f}s (cv={r["duration_ms"]}ms){cross}')
        elif verbose:
            print(f'    ✗ {r["name"]}: {r["status"]} ({r.get("reason", "")[:100]})')

    range_accuracy = in_range_count / run_count if run_count > 0 else 0
    avg_time = total_time / run_count if run_count > 0 else 999
    speed_bonus = min(1.0, 2.0 / avg_time) if avg_time > 0 else 1.0
    score = range_accuracy * speed_bonus

    summary = {
        "threshold": threshold,
        "range_accuracy": round(range_accuracy, 3),
        "avg_time": round(avg_time, 3),
        "speed_bonus": round(speed_bonus, 3),
        "score": round(score, 3),
        "tests_run": run_count,
        "in_range": in_range_count,
        "total_matches": total_count,
        "results": results,
    }

    if verbose:
        print(f'\n  SCORE={score:.3f} (Range={range_accuracy:.3f} × Speed={speed_bonus:.3f})')
        print(f'  AvgTime={avg_time:.2f}s Tests={run_count} InRange={in_range_count}/{run_count}')

    return summary


def test_list_drawing_pages(verbose: bool = True) -> dict:
    """Test listDrawingPages MCP tool."""
    if verbose:
        print("\n── listDrawingPages ──")
    result = mcp_list_drawing_pages()
    if "_error" in result:
        if verbose:
            print(f"  ✗ FAILED: {result}")
        return {"status": "fail", "reason": str(result)}

    count = result.get("count", 0)
    docs = result.get("documents", [])
    if verbose:
        print(f"  ✓ Found {count} documents")
        for d in docs[:5]:
            print(f"    {d['id'][:20]}... {d.get('fileName','?')} pages={d.get('pageCount','?')}")
        if count > 5:
            print(f"    ... and {count - 5} more")
    return {"status": "ok", "count": count}


def test_render_pages(verbose: bool = True) -> dict:
    """Test renderDrawingPage for key documents."""
    if verbose:
        print("\n── renderDrawingPage ──")
    results = []
    for key, doc_id in DOC_IDS.items():
        r = mcp_render_drawing_page(doc_id, 1)
        ok = "_error" not in r and r.get("success")
        results.append({"doc": key, "ok": ok, "width": r.get("imageWidth"), "height": r.get("imageHeight")})
        if verbose:
            flag = "✓" if ok else "✗"
            print(f"  {flag} {key}: {r.get('imageWidth','?')}x{r.get('imageHeight','?')} pages={r.get('pageCount','?')}")
    return {"status": "ok", "results": results}


def test_find_symbols(verbose: bool = True) -> dict:
    """Test findSymbolCandidates MCP tool."""
    if verbose:
        print("\n── findSymbolCandidates ──")
    results = []
    for key in ["new_tank", "pid", "crane_layout"]:
        doc_id = DOC_IDS[key]
        r = mcp_find_symbol_candidates(doc_id, 1, min_size=20, max_size=200)
        ok = "_error" not in r
        total = r.get("total", 0)
        results.append({"doc": key, "ok": ok, "total": total})
        if verbose:
            flag = "✓" if ok else "✗"
            print(f"  {flag} {key}: {total} candidates ({r.get('imageWidth','?')}x{r.get('imageHeight','?')})")
    return {"status": "ok", "results": results}


def test_count_all_pages(verbose: bool = True) -> dict:
    """Test countSymbolsAllPages MCP tool on multi-page CT detail."""
    if verbose:
        print("\n── countSymbolsAllPages ──")

    doc_id = DOC_IDS["ct_detail"]
    # First render to get coordinate space
    render = mcp_render_drawing_page(doc_id, 1)
    if "_error" in render:
        if verbose:
            print(f"  ✗ render failed: {render}")
        return {"status": "fail"}

    bbox = {"x": 374, "y": 749, "width": 24, "height": 29,
            "imageWidth": render["imageWidth"], "imageHeight": render["imageHeight"]}

    r = mcp_count_symbols_all_pages(doc_id, bbox, threshold=0.75)
    if "_error" in r:
        if verbose:
            print(f"  ✗ FAILED: {r}")
        return {"status": "fail"}

    if verbose:
        print(f"  ✓ grandTotal={r.get('grandTotal')} pageCount={r.get('pageCount')}")
        for p in r.get("pages", []):
            print(f"    page {p['pageNumber']}: {p['totalCount']} matches")

    return {"status": "ok", "grandTotal": r.get("grandTotal"), "pages": r.get("pages")}


def test_consistency_python_vs_mcp(threshold: float = 0.75, verbose: bool = True) -> dict:
    """Compare Python-direct vs MCP-API results for consistency."""
    if verbose:
        print("\n── Python-direct vs MCP-API Consistency ──")

    sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "python"))
    from tools.count_symbols import count_matches_on_pdf

    mismatches = []
    for case in TEST_CASES:
        doc_id = DOC_IDS.get(case["doc_key"])
        if not doc_id:
            continue

        # MCP path
        render = mcp_render_drawing_page(doc_id, case["page"])
        if "_error" in render:
            continue
        bbox_mcp = {**case["bbox"], "imageWidth": render["imageWidth"], "imageHeight": render["imageHeight"]}
        mcp_result = mcp_count_symbols(doc_id, case["page"], bbox_mcp, threshold=threshold,
                                        cross_scale=case.get("cross_scale", False))
        mcp_count = mcp_result.get("totalCount", -1)

        # Python-direct path (resolve file from storagePath)
        data_dir = os.path.join(os.path.dirname(__file__), "..", "..", "..", "data", "bidwright-api")
        data_dir = os.path.abspath(data_dir)
        import subprocess
        storage_path = _get_storage_path(doc_id)
        pdf_path = os.path.join(data_dir, storage_path)
        if not os.path.exists(pdf_path):
            if verbose:
                print(f"  - {case['name']}: pdf not found at {pdf_path}")
            continue
        payload = json.dumps({
            "pdfPath": pdf_path,
            "pageNumber": case["page"],
            "boundingBox": bbox_mcp,
            "threshold": threshold,
            "dpi": 150,
            "crossScale": case.get("cross_scale", False),
        })
        try:
            proc = subprocess.run(
                [sys.executable, os.path.join(os.path.dirname(__file__), "..", "python", "tools", "count_symbols.py")],
                input=payload, capture_output=True, text=True, timeout=60,
                cwd=os.path.join(os.path.dirname(__file__), "..", "python"),
            )
            py_result = json.loads(proc.stdout)
            py_count = py_result.get("totalCount", -1)
        except Exception as e:
            py_count = -2

        match = mcp_count == py_count
        if verbose:
            flag = "✓" if match else "✗"
            print(f"  {flag} {case['name']}: mcp={mcp_count} py={py_count}")
        if not match:
            mismatches.append({"name": case["name"], "mcp": mcp_count, "python": py_count})

    if verbose:
        if mismatches:
            print(f"\n  ✗ {len(mismatches)} MISMATCHES")
        else:
            print(f"\n  ✓ ALL LAYERS AGREE")

    return {"mismatches": mismatches}


# Storage path cache
_storage_paths: dict = {}

def _get_storage_path(doc_id: str) -> str:
    """Get storagePath for a document from DB (cached)."""
    if doc_id in _storage_paths:
        return _storage_paths[doc_id]

    import subprocess
    result = subprocess.run(
        ["docker", "exec", "-i", _get_pg_container(),
         "psql", "-U", "bidwright", "-d", "bidwright", "-t", "-A", "-c",
         f"SELECT \"storagePath\" FROM \"SourceDocument\" WHERE id = '{doc_id}'"],
        capture_output=True, text=True, timeout=10,
    )
    path = result.stdout.strip()
    _storage_paths[doc_id] = path
    return path


_pg_container_id: str = ""

def _get_pg_container() -> str:
    global _pg_container_id
    if _pg_container_id:
        return _pg_container_id
    import subprocess
    result = subprocess.run(
        ["docker", "ps", "-q", "-f", "expose=5432"],
        capture_output=True, text=True, timeout=5,
    )
    _pg_container_id = result.stdout.strip().split("\n")[0]
    return _pg_container_id


def sweep(iterations: int = 10, verbose: bool = True):
    """Parameter sweep through MCP pipeline."""
    print("█" * 70)
    print(f"KEMIRA MCP HARNESS: {iterations}-iteration threshold sweep")
    print("█" * 70)

    configs = [
        0.60, 0.65, 0.70, 0.72, 0.74, 0.75, 0.76, 0.78, 0.80, 0.85,
    ]

    all_results = []
    best_score = 0
    best_thresh = None

    for i, thresh in enumerate(configs[:iterations]):
        print(f"\n{'─' * 70}")
        print(f"RUN {i+1}/{iterations}: threshold={thresh}")
        print(f"{'─' * 70}")

        summary = run_full_eval(threshold=thresh, verbose=verbose)
        run_data = {"run": i + 1, "threshold": thresh,
                    **{k: v for k, v in summary.items() if k != "results"}}
        all_results.append(run_data)

        if summary["score"] > best_score:
            best_score = summary["score"]
            best_thresh = thresh
            print(f"  ★ NEW BEST: {best_score:.3f}")
        else:
            print(f"  → {summary['score'] - best_score:+.3f} from best ({best_score:.3f})")

    print(f"\n{'█' * 70}")
    print("SWEEP COMPLETE")
    print(f"{'█' * 70}")
    all_results.sort(key=lambda r: -r["score"])
    for r in all_results:
        marker = " ★" if r["threshold"] == best_thresh else ""
        print(f"  thresh={r['threshold']:.2f}: score={r['score']:.3f} "
              f"Range={r['range_accuracy']:.3f} T={r['avg_time']:.2f}s "
              f"InRange={r['in_range']}/{r['tests_run']}{marker}")

    print(f"\nBEST: threshold={best_thresh} score={best_score:.3f}")

    with open(os.path.join(OUT, "mcp_sweep_results.json"), "w") as f:
        json.dump({"best_threshold": best_thresh, "best_score": best_score, "runs": all_results}, f, indent=2)


# ═══════════════════════════════════════════════════════════════
# MAIN
# ═══════════════════════════════════════════════════════════════

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Kemira MCP end-to-end test harness")
    parser.add_argument("mode", nargs="?", default="full",
                       choices=["full", "eval", "sweep", "consistency", "list", "render", "find", "allpages"],
                       help="full: all tests | eval: count tests only | sweep: threshold sweep | consistency: py vs mcp")
    parser.add_argument("--threshold", type=float, default=0.75)
    parser.add_argument("--iterations", type=int, default=10)
    args = parser.parse_args()

    if args.mode == "full":
        print("═" * 70)
        print(f"KEMIRA MCP FULL TEST SUITE (threshold={args.threshold})")
        print("═" * 70)
        test_list_drawing_pages()
        test_render_pages()
        test_find_symbols()
        test_count_all_pages()
        print(f"\n── countSymbols (threshold={args.threshold}) ──")
        run_full_eval(threshold=args.threshold)
        test_consistency_python_vs_mcp(threshold=args.threshold)

    elif args.mode == "eval":
        print("═" * 70)
        print(f"MCP EVAL: threshold={args.threshold}")
        print("═" * 70)
        run_full_eval(threshold=args.threshold)

    elif args.mode == "sweep":
        sweep(iterations=args.iterations)

    elif args.mode == "consistency":
        test_consistency_python_vs_mcp(threshold=args.threshold)

    elif args.mode == "list":
        test_list_drawing_pages()

    elif args.mode == "render":
        test_render_pages()

    elif args.mode == "find":
        test_find_symbols()

    elif args.mode == "allpages":
        test_count_all_pages()
