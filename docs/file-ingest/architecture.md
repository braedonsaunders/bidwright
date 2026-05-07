# Bidwright File Ingest Adapter Architecture

Bidwright file ingest is a universal adapter layer over format-specific families. It does not make PDFs pretend to be BIM, and it does not make model quantities disappear into document chunks.

## Adapter Contract

Every adapter reports:

- `available`, `missing`, `unsupported`, `degraded`, or `failed` capability status
- file family: `document`, `model`, `spreadsheet`, `image`, `text`, `email`, `archive`, or `unknown`
- org-scoped configuration requirements
- source checksum, size, adapter version, provenance, and generated artifacts
- a canonical file manifest with optional child manifests

## Built-In Families

| Family | Adapter | Formats | Output |
| --- | --- | --- | --- |
| Document | `bidwright-document.universal` | `pdf`, `docx`, `doc`, `rtf`, `pptx`, `html`, `mhtml` | text, pages, tables, structured fields |
| Spreadsheet | `bidwright-document.universal` | `xlsx`, `xls`, `csv`, `tsv` | sheets as markdown tables and structured data |
| Image | `bidwright-document.universal` | `png`, `jpg`, `jpeg`, `tif`, `tiff`, `bmp`, `webp`, `gif` | image placeholder, OCR capability state |
| Text | `bidwright-document.universal` | `txt`, `md`, `json`, `xml`, `yaml`, `log`, `ini`, `toml`, `conf` | extracted text and sections |
| Model | `bidwright-model.wrapper` | `ifc`, `dxf`, `dwg`, `rvt`, `step`, `stp`, `iges`, `igs`, `brep`, `stl`, `obj`, `gltf`, `glb`, `dae`, `fbx`, `3ds` | canonical model manifest and estimate-lens candidates |

## Configuration

Configuration must be organization scoped through Bidwright settings. The file-ingest layer does not read provider credentials from server-global environment variables.

Autodesk APS remains inside the model child adapter and uses organization settings only. Azure Document Intelligence for document OCR/structured extraction also resolves from organization settings.

## Extension Pattern

To add a new file type:

1. Add a `FileIngestAdapter`.
2. Return explicit capability status for that format.
3. Persist raw and normalized artifacts separately.
4. Add the adapter to `apps/api/src/services/file-ingest/registry.ts`.
5. Add a golden fixture to `scripts/file-ingest/benchmark.ts`.

Downstream estimating should consume the file manifest first, then the child manifest that matches the family.
