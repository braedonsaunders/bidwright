---
name: bim-takeoff
description: Query BIM elements, quantities, takeoff groups and revision differences for estimating.
---

getSourceOverview reports persisted model IDs, ingest status, schema, units and authored Qto coverage where known.
describeTools exposes model element/group/BOM, topology, recipe and revision operations; invokeTool uses their schemas.
Query by native element IDs, class, system, material or level. Aggregate persisted elements rather than counting pixels.
Authored Qto is a strong candidate: inspect property name, gross/net basis, units, scope and revision. A declared value can be stale.
Geometry-derived area/volume has mesh and manifold limitations; compare consequential disagreements with authored values rather than silently preferring one.
Groups, recipes and assembly BOMs can overlap. Deduplicate element IDs when combining groups, and distinguish assembly totals from component totals.
Units reported as unknown or model are not metres. Preserve explicit conversions and quantity basis.
Topology/recipe changes and saved takeoff are explicit writes; query and aggregation are reads.
Reuse suitable human pickups and their edits. Link selected model pickups to worksheet rows through PickupLink, keeping allowances separate.
Revision diffs identify affected elements and linked rows for reconsideration without replacing human edits automatically.

## Installed quantities, purchasing and effort

A quantity record can describe installed work (for example 317 LF of pipe), while a procurement row describes stock purchased (for example seventeen 20-ft lengths = 340 LF). The difference can be recorded as cutting waste or surplus, with its calculation. A supplier lot is a priced commercial package, not an installed count.

Shop and field work can have separate person-hour calculations: 20 joints × 2 shop person-hours/joint, plus 5 closures × 3 field person-hours/joint. Crew size describes staffing; multiplying an already person-hour rate by crew size would count effort twice. An unquoted allowance can carry its amount, covered scope and uncertainty separately from measured quantities and vendor prices. Source facts and any alternate or provisional quantities can remain visible side by side.

For APS/Plant3D sources, `aggregateModelElements` can group `elementClass: "Pipe"` by the flat property `AutoCAD.Size`, with `propertyFilters: {"AutoCAD.Status":"New"}`. Length quantities carry explicit units; container nodes and repeated physical identities are excluded from aggregates. `AutoCAD.Spec` and `AutoCAD.PipeLineNumber` can help distinguish scope. A model-wide total can include other systems or revisions and need not match an RFQ-specific BOM.

Saved pickups can drive a priced row through `createWorksheetItem` or `updateWorksheetItem`: `takeoff: [{pickupId: "<saved mark id>"}]`; quantities are summed, conversions use an explicit `multiplier`, and updates replace the link set (omitting `takeoff` preserves it).
