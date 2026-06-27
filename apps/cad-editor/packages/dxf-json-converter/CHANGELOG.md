# @mlightcad/dxf-json-converter

## 1.9.14

### Patch Changes

- fix(data-model): correct transforms for dimensions, proxy entities, and block attributes
- Updated dependencies
  - @mlightcad/data-model@1.9.14

## 1.9.13

### Patch Changes

- feat(data-model): enhance grip editing with GRIPS sysvar and entity-specific grips
- Updated dependencies
  - @mlightcad/data-model@1.9.13

## 1.9.12

### Patch Changes

- feat(data-model,dxf-json-converter): add edit shortcuts and binary DXF parsing
- Updated dependencies
  - @mlightcad/data-model@1.9.12

## 1.9.11

### Patch Changes

- feat: implement database transaction manager with undo/redo
- Updated dependencies
  - @mlightcad/data-model@1.9.11

## 1.9.10

### Patch Changes

- feat: support reading AcDb2LineAngularDimension and add DWGNAME system variable
- Updated dependencies
  - @mlightcad/data-model@1.9.10

## 1.9.9

### Patch Changes

- feat: introduced grip point editing across entity types and unified DWG/DXF font collection through AcDbFontNameCollector for improved editing and font management consistency
- Updated dependencies
  - @mlightcad/data-model@1.9.9

## 1.9.8

### Patch Changes

- feat: improve SPLINE conversion with tolerant factory methods
- Updated dependencies
  - @mlightcad/data-model@1.9.8

## 1.9.7

### Patch Changes

- feat: improve LibreDWG converter with enhanced MLeader conversion and SHAPE entity support, and restore initial view from \*ACTIVE VPORT with added sanity checks for robustness
- Updated dependencies
  - @mlightcad/data-model@1.9.7

## 1.9.6

### Patch Changes

- feat: refactor AcGiContext into a class, fix SHAPE font resolution, and add STYLE table shape file support with draw-time database context handling
- Updated dependencies
  - @mlightcad/data-model@1.9.6

## 1.9.5

### Patch Changes

- feat: fix rendering and color resolution: resolve sub-entity RGB at draw time via AcGiContext and correctly compute ByBlock/ByLayer attribute colors from owning INSERT, improving consistency of block and entity display
- Updated dependencies
  - @mlightcad/data-model@1.9.5

## 1.9.4

### Patch Changes

- feat: upgrade libredwg-web to v0.7.4 to fix some issues on parsing dwg files
- Updated dependencies
  - @mlightcad/data-model@1.9.4

## 1.9.3

### Patch Changes

- feat: support proxy entity for dwg file
- Updated dependencies
  - @mlightcad/data-model@1.9.3

## 1.9.2

### Patch Changes

- feat: add AcDbProxyEntity with proxy graphic decoding
- Updated dependencies
  - @mlightcad/data-model@1.9.2

## 1.9.1

### Patch Changes

- fix(data-model): break circular deps via direct imports and add CJS bundle test (#106)
- Updated dependencies
  - @mlightcad/data-model@1.9.1

## 1.9.0

### Major Changes

- Extract DXF conversion from `@mlightcad/data-model` into a standalone package
- Bundle GPL-licensed `@mlightcad/dxf-json` parser in a separate Web Worker

### Minor Changes

- feat: adds area support on curve, hatch, and geometry classes, extracts DXF conversion into the standalone @mlightcad/dxf-json-converter package, and documents GPL Web Worker isolation with example JSDoc

### Patch Changes

- Updated dependencies
  - @mlightcad/data-model@1.9.0
