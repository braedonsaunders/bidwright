# Vision Tool Development Plan

## Current State (after 40 autoresearch runs)

### Tools Built (`packages/vision/python/tools/`)
1. **renderer.py** — PDF page render + region zoom. Fast (0.1-0.5s). Proven stable.
2. **find_symbols.py** — Connected component analysis for symbol discovery. Finds candidates by size/aspect.
3. **count_symbols.py** — Template matching (TM_CCOEFF_NORMED). Optimal: threshold=0.75, dpi=150, single-scale.

### Autoresearch Results
- **Best config**: threshold=0.75, render_dpi=150, no multi-scale
- **Score**: 1.000 (100% precision, 100% range accuracy, 0.28s/test)
- **Sweet spot**: threshold 0.74-0.80
- **40 runs** across 4 packages: Soprema (P&IDs), Kemira (structural/tank), Home Hardware (P&ID/steel/ISO), Birla (breeching/power plant)

### Test Packages
1. **Soprema Tillsonburg** — 11 P&IDs, chemical plant. 375 valves counted. Instrument bubbles, valve tags.
2. **Kemira Brantford** — 28 PDFs. Structural steel, tank fabrication, cooling tower. Nozzle flanges, tank matching.
3. **Home Hardware** — 36 PDFs. P&ID + steel erection + piping ISOs. Drain symbols (9), connection diamonds (20).
4. **Birla Unit 4 Breeching** — 29 PDFs. Power plant breeching replacement. Piping, civil, structural.

## Integration Plan (Next Steps)

### 1. First-class Agent Tools (MCP)
Tools are registered in `packages/mcp-server/src/tools/vision-tools.ts`:
- `renderDrawingPage` — returns image content block (agent SEES the drawing)
- `zoomDrawingRegion` — high-res crop for precise symbol identification
- `countSymbols` — runs CV pipeline with bbox from visual inspection
- `detectScale` — reads title block for scale info
- `measureLinear` — point-to-point with calibration
- `listDrawingPages` — discover available drawings

### 2. Agent Chat UI Widgets (TO BUILD)
- **Inline drawing viewer** — when agent calls renderDrawingPage, show the image in chat with interactive zoom
- **Match overlay** — when countSymbols returns, overlay match locations on the drawing with count badges
- **Symbol identification card** — when user asks "what is this?", show cropped symbol + AI description + match count
- **Progress indicator** — streaming "Scanning page 3 of 11..." with live match count updating
- **Annotation persistence** — agent findings auto-saved as TakeoffAnnotation records for later reference

### 3. Takeoff UI Enhancements (TO BUILD)
- **"Ask AI" button** — select a region, click Ask AI, get symbol identification + count
- **Quick Count mode** — select symbol → one-click count all occurrences
- **Match highlight overlay** — show all matches with confidence color coding
- **Cross-page search** — "find this on all pages" button
- **Results panel** — persistent sidebar showing count results with match thumbnails

### 4. Annotation Persistence
- Agent findings stored as `TakeoffAnnotation` records with `createdBy: "agent"`
- Metadata includes: detection_method, confidence, template_image, page_number
- Visible in takeoff sidebar alongside human annotations
- Can be edited/deleted by user
- Queryable by agent in future conversations

## What Works / What Doesn't

### Works Well
- Template matching on identical visual patterns (valves, instruments, tanks, drains)
- Fast: 0.28s per page average
- Zero false positives at threshold=0.75
- Auto-discovery of templates via connected component analysis
- Text extraction from PDFs with text layers

### Known Limitations
- Grid bubbles connected to border lines don't separate as components
- ISO callout numbers have unique content — template match finds only exact duplicates
- Rotated text (common on P&IDs) breaks OCR-based detection
- Bounding box must be in the same coordinate space as the render DPI
- Text-only symbols (different text, same shape) matched by visual shape not semantics
