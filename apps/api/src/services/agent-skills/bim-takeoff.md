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
