---
name: model-3d-takeoff
description: Use STEP and mesh part metrics and assembly BOMs for 3D estimating.
---

getSourceOverview identifies model IDs, persisted parts/solids, ingest status and units; unknown units remain unknown.
describeTools exposes model solid metrics and BOM operations; invokeTool discovers their exact payloads.
getModelSolidMetrics returns available per-solid area/volume and assembly structure through the existing geometry path.
Imported mesh parts are not necessarily closed solids. Volume depends on manifold geometry; recentering reduces numerical error at large coordinates.
Surface area may include internal faces; solid volume is not automatically purchased material volume or weight.
Assembly instances and repeated parts have different counts. Avoid adding assembly totals to their constituent parts again.
Keep geometric units and density conversions explicit; separate measured quantities from procurement/waste factors.
Save useful selections as pickups and deliberately link them to worksheet rows. Existing human measurements retain their provenance.
