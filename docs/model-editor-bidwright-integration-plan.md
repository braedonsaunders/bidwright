# BidWright Model Editor Integration Plan

## Product Direction

BidWright should treat 3D models as first-class estimating sources, not just preview files. The target architecture is a model intelligence layer that connects project documents, 2D takeoff, 3D model editing, MCP tools, worksheet quantities, and quote proof.

## Implemented Integration Slice

- Forked the original model editor into BidWright-owned source under `apps/model-editor`.
- Build the model editor into `apps/web/public/model-editor`.
- Remove upstream analytics from the vendored Chili HTML.
- Remove the standalone upstream welcome screen, social links, WeChat action, and visible Chili branding from the embedded editor shell.
- Launch the editor directly into a BidWright-native model workspace.
- Embed the full BidWright model editor in the project file browser for editable model formats.
- Add explicit PDF/Model switching inside Estimate > Takeoff.
- Use the BidWright model editor in 3D takeoff for STEP/STP/IGES/IGS/BREP/STL.
- Keep BidWright's existing Three/WebIFC preview path for non-Chili model formats such as IFC.
- Add model database tables, migration, ingestion service, and API routes for model assets, elements, quantities, BOM rows, issues, revision diffs, and estimate links.
- Add server-side model indexing for IFC, OBJ, STL, glTF/GLB, and OpenCascade-backed STEP/STP/IGES/IGS/BREP quantities.
- Wire MCP model tools to persisted BidWright model intelligence instead of ad hoc file discovery.
- Add a model takeoff sidebar that syncs the model index and exposes element, quantity, BOM, and issue counts to estimators.
- Add host messaging from the embedded model editor so selected geometry can be summarized and sent into the estimate.

## Next Production Milestones

1. Move synchronous model indexing into a queued worker for very large BIM/CAD files.
2. Add deeper IFC property set extraction and classification mapping.
3. Add model revision diffing for addenda/change-order estimating.
4. Add quote proof output with model snapshots, BOM rows, element IDs, and estimator assumptions.
5. Add direct quantity-field mapping from selected model geometry to specific worksheet columns and assemblies.

## Format Strategy

- BidWright model editor editable now: STEP, STP, IGES, IGS, BREP, STL.
- Preview-supported now: IFC, OBJ, FBX, GLTF, GLB, 3DS, DAE, DXF/DWG via existing BidWright viewers.
- Target model intelligence priority: IFC first for BIM metadata, then STEP/BREP/STL geometry quantities.
