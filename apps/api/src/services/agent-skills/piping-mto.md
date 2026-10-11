---
name: piping-mto
description: Read PCF and .piping material takeoffs while preserving explicit joint and fabrication semantics.
---

getSourceOverview identifies piping files; describeTools exposes piping MTO operations and invokeTool their current schemas.
getPipingMto reads pipe/component records, sizes, lengths and available joint semantics. savePipingTakeoff explicitly persists selected quantities as pickups.
Distinguish pipe centreline length, cut length and purchased stock length. Keep units and conversion factors explicit.
Weld/joint counts come from authored connection types, branch connections, shop/field designation and fabrication scope when supplied.
A fitting count does not imply a fixed number of welds; missing joint semantics remain an estimating uncertainty.
Flanged, threaded, socket-weld and butt-weld ends imply different work. Preserve customer-supplied/fabrication-by-others scope.
Repeated isometric views may show the same line/components. Reconcile native IDs and line scope when combining sources.
Link selected pickups to worksheet rows; keep testing, supports, allowances and procurement adjustments distinguishable from parsed quantities.

## Installed quantities, purchasing and effort

A quantity record can describe installed work (for example 317 LF of pipe), while a procurement row describes stock purchased (for example seventeen 20-ft lengths = 340 LF). The difference can be recorded as cutting waste or surplus, with its calculation. A supplier lot is a priced commercial package, not an installed count.

Shop and field work can have separate person-hour calculations: 20 joints × 2 shop person-hours/joint, plus 5 closures × 3 field person-hours/joint. Crew size describes staffing; multiplying an already person-hour rate by crew size would count effort twice. An unquoted allowance can carry its amount, covered scope and uncertainty separately from measured quantities and vendor prices. Source facts and any alternate or provisional quantities can remain visible side by side.
