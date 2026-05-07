# Bidwright CAD/BIM/Model Ingest Architecture

Bidwright's ingest layer is local/open-source first, with one optional cloud provider: Autodesk APS. It does not depend on cad2data or after-the-fact converter installs.

## Goals

- Preserve the raw model source and adapter output for audit.
- Normalize useful model data into `ModelAsset`, `ModelElement`, `ModelQuantity`, `ModelBom`, and `ModelIssue`.
- Keep raw BIM/CAD noise out of estimating by creating an estimate-facing lens instead of treating every native element or mesh as a line item.
- Report capability truthfully: `available`, `missing`, `unsupported`, `degraded`, or `failed`.
- Let the Drawing Evidence Engine consume model quantities later without changing current worksheet/evidence gates.

## Adapter Lanes

| Lane | Formats | Provider |
| --- | --- | --- |
| Embedded IFC | `ifc` | `web-ifc`, with conservative entity-index fallback |
| Embedded CAD geometry | `step`, `stp`, `iges`, `igs`, `brep` | `occt-import-js` / OpenCascade |
| Embedded mesh | `stl`, `obj`, `gltf`, `glb`, `dae`, `fbx`, `3ds` | Local parsers and manifest shells |
| Embedded 2D CAD | `dxf` | Local entity/layer index |
| Autodesk native | `rvt`, `dwg` | Optional Autodesk APS activity configuration |

`dgn` is intentionally not in scope.

## Artifact Contract

Every model sync writes durable artifacts under `data/bidwright-api/model-ingest/<projectId>/<sourceId>-<checksum>/`:

- `manifest.json`: canonical ingest manifest, adapter status, provenance, issues, estimate lens.
- `elements.json`: normalized elements persisted to hot DB.
- `quantities.json`: normalized quantities persisted to hot DB.
- `bom.json`: estimator-facing BOM rows.

The hot DB keeps the current model tables. The cold artifact path lets us add JSONL, Parquet, or DuckDB later without forcing the app to depend on those formats immediately.

## Estimate Lens

Adapters produce raw/normalized elements and quantities. The estimate lens groups those rows by estimate-relevant dimensions:

- class/category
- type/family
- system
- level
- material
- native schedule or geometry quantity basis when available

Raw model elements are evidence; estimate-lens groups are candidates. This keeps tens of thousands of low-value BIM artifacts from polluting Bidwright's quoting workflow.

## Autodesk APS Boundary

Autodesk APS is the only allowed cloud/proprietary lane. Configure it in Settings > Integrations > API Keys. These values are organization-level settings stored in the database only, with no server-global fallback.

- `autodeskClientId`
- `autodeskClientSecret`
- `autodeskApsRevitActivityId` for `rvt`
- `autodeskApsAutocadActivityId` for `dwg`

The current adapter exposes a clean capability shell and provenance contract. The extraction worker/activity can fill the same canonical manifest without touching estimator orchestration.
