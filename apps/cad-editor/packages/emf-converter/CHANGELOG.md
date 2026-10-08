# @mlightcad/emf-converter

## 1.15.1

### Patch Changes

- feat: paints wipeouts with the layout background fill so covered geometry stays hidden. DXF export expands XData points and binary chunks, and attribute definitions keep their owner ids when block table record handles collide. Imported XData is stored in a compacted form that uses less memory

## 1.15.0

### Minor Changes

- fix: aligns DWG converter license failure markers with the current @mlightcad/dwg-converter messages so expired evaluation and invalid license key errors classify correctly as license_expired and license_invalid instead of falling through as generic open failures

## 1.14.14

### Patch Changes

- feat: vendors emf-converter as the @mlightcad/emf-converter workspace package and exposes raster image and OLE frame properties so the property palette can edit them. Missing image paths draw without MTEXT control codes, and DWG import no longer aborts when handles are assigned before attributes
