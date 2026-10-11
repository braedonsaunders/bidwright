---
name: cad-takeoff
description: Query and render DWG/DXF layers, blocks and entities for native geometry takeoff.
---

getSourceOverview reports persisted CAD processing and converter status; no synchronous ingest is triggered by the overview.
describeTools exposes CAD query/render/save tools; invokeTool accepts the same arguments as direct calls.
queryCadEntities reads scoped native IDs, layers, block counts and lengths. renderCadDrawing provides a visual check of the selection.
Layer names and block names are useful filters, not proof of scope. Modelspace and paperspace may show the same installed object.
Block instances can expand into several entities; distinguish instance count from component count and avoid counting both representations.
Use returned units and explicit conversions. Unknown drawing units do not imply metres or millimetres.
saveCadEntityTakeoff explicitly saves selected native entity IDs to the shared Pickup spine and can link rows.
Preserve existing human pickups. Changes to drawing revisions can invalidate an entity reference even when its label looks unchanged.
