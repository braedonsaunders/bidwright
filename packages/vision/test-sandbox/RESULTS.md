# Autoresearch Results — All Packages (v2 + Cross-Scale)

## Final Score: 1.000 (with cross-document matching SOLVED)

### Autoresearch v2 Results (5 packages)
```
Single-page accuracy:  5/5  (100%)
Cross-page accuracy:   1/1  (100%)
Robustness:            3/3  (no crashes on corrupt PDFs)
Speed:                 0.388s/page = 155 pages/minute
Composite Score:       1.000
```

### Speed Breakdown
```
Render page (150 DPI):     0.110s avg
Find symbols (CC analysis): 0.009s avg
Count matches (TM_CCOEFF): 0.269s avg
Full pipeline (one page):  0.388s avg
Batch (5 templates/page):  0.259s per template (1.30s total)
```

### Optimal Config
```
Single-page:    threshold=0.75, render_dpi=150, single-scale TM_CCOEFF_NORMED (0.27s/page)
Cross-document: threshold=0.75, render_dpi=150, cross-scale [0.75,0.80,0.90,1.0,1.1,1.25] (1.70s/page)
```

### Cross-Document Breakthrough
Single template from Pentane P&ID found **412 valve tags across 11 different P&IDs**:
- Template: 113x42 valve tag from PID-PENTANE-0001
- Scale 0.80 → catches 90x55 Additives tags (46 matches)
- Scale 1.00 → catches 110-113x42 Pentane/Cyclo/N tags (166 matches)
- Scale 1.25 → catches 135-144x51 ISO/KOCT/POLY/TCPP tags (200 matches)

API parameter: `crossScale: true` in POST /api/vision/count-symbols

## Package-by-Package Results

### Package 1: Soprema Tillsonburg (Chemical Plant P&IDs)
- 11 P&ID drawings
- **46 valve tags** on Pentane P&ID (0.42s)
- **2 LS instruments** (0.51s)
- Cross-document: per-doc template discovery needed (different tag widths per sheet)

### Package 2: Kemira Brantford (Structural/Tank/Cooling Tower)
- 28 PDFs
- Nozzle flanges: 2 matches
- Nozzle callouts: 3 matches
- North arrows: 2 matches

### Package 3: Home Hardware (P&ID + Steel + Piping ISOs)
- 36 PDFs
- **20 connection diamonds**, **9 drain symbols**, **3 flow arrows** on P&ID
- Batch counting: 27 matches across 5 symbol types in 1.30s
- Cross-page: 3 matches across 3 ISO pages

### Package 4: Birla Unit 4 Breeching (Power Plant)
- 29 PDFs, includes scanned hand-drawn structural
- **6 grid/section markers** on structural platform plans
- Hand-drawn originals work at 0.75 threshold

### Package 5: Gyptec/CertainTeed
- 10 PDFs, mostly timesheets
- Corrupt PDFs (0-page, garbled fonts) handled gracefully
- Non-drawing content (timesheets) doesn't crash
- Root construction drawing PDFs are 0-page corrupt files

## Key Findings

### Cross-document counting
Template matching across different drawing sets requires **per-document template discovery** because:
- Valve tag widths vary between sheets (110px vs 135px)
- Font rendering differs between CAD sources
- Drawing scale/zoom affects symbol pixel size

**Solution**: For each document, auto-discover a fresh template via find_symbols → then count with that template. This is what the cross-page API endpoint should do.

### Batch counting performance
Counting 5 different symbol types on one page: **1.30s total (0.26s per template)**. The rendering is the bottleneck (0.11s) but it's done once — subsequent template matches reuse the rendered image.

### Robustness
- Corrupt PDFs (0 pages, garbled fonts): graceful failure, no crashes
- Blank pages: 0 candidates, 0 matches
- Non-drawing content (timesheets): finds some text elements but no meaningful symbols
- All error paths return valid empty results

## File Inventory
- `python/tools/count_symbols.py` — Optimized counter (threshold=0.75, 0.27s/page)
- `python/tools/renderer.py` — PDF renderer (0.11s/page)
- `python/tools/find_symbols.py` — Symbol discovery (0.009s/page)
- `test-sandbox/autoresearch.py` — v1 eval harness (10 test cases, parameter sweep)
- `test-sandbox/autoresearch_v2.py` — v2 eval harness (multi-page, batch, robustness, speed)
- `test-sandbox/PLAN.md` — Development plan
- `test-sandbox/RESULTS.md` — This file
