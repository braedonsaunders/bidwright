# @mlightcad/common

## 1.6.14

### Patch Changes

- fix(data-model): correct transforms for dimensions, proxy entities, and block attributes

## 1.6.13

### Patch Changes

- feat(data-model): enhance grip editing with GRIPS sysvar and entity-specific grips

## 1.6.12

### Patch Changes

- feat(data-model,dxf-json-converter): add edit shortcuts and binary DXF parsing

## 1.6.11

### Patch Changes

- feat: implement database transaction manager with undo/redo

## 1.6.10

### Patch Changes

- feat: support reading AcDb2LineAngularDimension and add DWGNAME system variable

## 1.6.9

### Patch Changes

- feat: introduced grip point editing across entity types and unified DWG/DXF font collection through AcDbFontNameCollector for improved editing and font management consistency

## 1.6.8

### Patch Changes

- feat: improve SPLINE conversion with tolerant factory methods

## 1.6.7

### Patch Changes

- feat: improve LibreDWG converter with enhanced MLeader conversion and SHAPE entity support, and restore initial view from \*ACTIVE VPORT with added sanity checks for robustness

## 1.6.6

### Patch Changes

- feat: refactor AcGiContext into a class, fix SHAPE font resolution, and add STYLE table shape file support with draw-time database context handling

## 1.6.5

### Patch Changes

- feat: fix rendering and color resolution: resolve sub-entity RGB at draw time via AcGiContext and correctly compute ByBlock/ByLayer attribute colors from owning INSERT, improving consistency of block and entity display

## 1.6.4

### Patch Changes

- feat: upgrade libredwg-web to v0.7.4 to fix some issues on parsing dwg files

## 1.6.3

### Patch Changes

- feat: support proxy entity for dwg file

## 1.6.2

### Patch Changes

- feat: add AcDbProxyEntity with proxy graphic decoding

## 1.6.1

### Patch Changes

- fix(data-model): break circular deps via direct imports and add CJS bundle test (#106)

## 1.6.0

### Minor Changes

- feat: adds area support on curve, hatch, and geometry classes, extracts DXF conversion into the standalone @mlightcad/dxf-json-converter package, and documents GPL Web Worker isolation with example JSDoc

## 1.5.4

### Patch Changes

- feat: added drawNoPlotLayers policy for controlling no-plot layer visibility, fixed hatch pattern angle handling when explicit lines are defined, updated project license, and migrated npm publishing to Trusted Publishing via OIDC

## 1.5.3

### Patch Changes

- feat: geometricExtents for text, dimensions, table, and viewport; VPORT aspect ratio; case-insensitive VPORT lookup

## 1.5.2

### Patch Changes

- feat(data-model): add SHAPE entity support and honor DXF visibility in blocks

## 1.5.1

### Patch Changes

- feat: extend object snap support across entities and add ORTHOMODE, POLARMODE, POLARANG, and POLARADDANG system variables

## 1.5.0

### Minor Changes

- feat: replace WHITEBKCOLOR with MODELBKCOLOR and PAPERBKCOLOR

## 1.4.40

### Patch Changes

- fix: resolve text styles during progressive conversion and fix TRACE boundary order

## 1.4.39

### Patch Changes

- feat: add AcDbCurve::getOffsetCurves and centralize offset tolerance checks with AcGeTol

## 1.4.38

### Patch Changes

- fix: default layout manager factory survives production tree-shaking

## 1.4.37

### Patch Changes

- feat: improve tree-shaking with explicit ESM exports and add geometry snap helpers

## 1.4.36

### Patch Changes

- feat: add AcDbFormatter for AutoCAD-style length, point, and angle display

## 1.4.35

### Patch Changes

- feat: LUNITS/LUPREC/AUPREC, VPORT fallbacks, angbase/angdir; pnpm 10 + CI

## 1.4.34

### Patch Changes

- fix: build entity color via assignment to support AcDbHatch override

## 1.4.33

### Patch Changes

- fix: prefer anonymous table blocks when rendering AcDbTable

## 1.4.32

### Patch Changes

- feat: add SVG rendering support for hatch gradient previews and correct anchor for non-default TEXT/ATTRIB alignment

## 1.4.31

### Patch Changes

- feat: add hatch related system variables and fix SOLID hatch handling & preview rendering

## 1.4.30

### Patch Changes

- feat: add PAT parsing, predefined libraries, and SVG preview support

## 1.4.29

### Patch Changes

- feat: refine mline rendering

## 1.4.28

### Patch Changes

- feat: add mline and mleader supports

## 1.4.27

### Patch Changes

- fix: fix cad-viewer issue #243 and #183

## 1.4.26

### Patch Changes

- feat: add gradient hatch support

## 1.4.25

### Patch Changes

- feat: introduce explicit draw order and fix issues on closed wide LWPOLYLINE rendering and OCS arc/circle conversion

## 1.4.24

### Patch Changes

- fix: fix issues on dimension selection and snapping

## 1.4.23

### Patch Changes

- fix: fix block reference osnap resolution for transformed and nested entities and issue on color resolution for libredwg-converter

## 1.4.22

### Patch Changes

- feat: render wide LWPOLYLINE entities as filled geometry and add SVG linetype previews and demo rendering in example app

## 1.4.21

### Patch Changes

- feat: add CELTYPE support across database and DXF/DWG converters

## 1.4.20

### Patch Changes

- fix: fix issue #200 in cad-viewer

## 1.4.19

### Patch Changes

- feat: add clone method

## 1.4.18

### Patch Changes

- feat: improve text style fallback resolution and bump libredwg-web to 0.6.10

## 1.4.17

### Patch Changes

- feat: implement missing geometry/entity transforms and expand transform regression coverage

## 1.4.16

### Patch Changes

- feat(sysvars): add DYNMODE and DYNPROMPT system variables

## 1.4.15

### Patch Changes

- feat: improve geometry and optimize build configuration

## 1.4.14

### Patch Changes

- fix: improve DXF export functionality and refine AcDbSpline

## 1.4.13

### Patch Changes

- fix: fix #issue 150 in cad-viewer (#43)

## 1.4.12

### Patch Changes

- fix: upgrade dxf-json to fix bug #132 in cad-viewer repo

## 1.4.11

### Patch Changes

- fix issue on converting spline with fit points

## 1.4.10

### Patch Changes

- fix: fix bugs on building loops for hatch and revome dependency on verb-nurbs

## 1.4.9

### Patch Changes

- feat: improve DXF export

## 1.4.8

### Patch Changes

- fix: fix issue on reading dxf file caused by last release

## 1.4.7

### Patch Changes

- feat: add DXF export support

## 1.4.6

### Patch Changes

- feat: support changing foreground color

## 1.4.5

### Patch Changes

- chore: add system variables MEASUREMENTCOLOR, OSMODE, and TEXTCOLOR

## 1.4.4

### Patch Changes

- feat: add configurable parser worker timeout for drawing conversion and centralize database system variable names

## 1.4.3

### Patch Changes

- fix: fix issue 101

## 1.4.2

### Patch Changes

- feat(data-model): emit sysVarChanged only when sysvar value actually changes and add system variable 'LWDISPLAY'

## 1.4.1

### Patch Changes

- feat: set entity line weight and line type scale for newly created entity

## 1.4.0

### Patch Changes

- feat: support xdata and xrecord

## 1.3.7

### Patch Changes

- feat: respect value of system variables 'cecolor' and 'clayer' when creating one new entity

## 1.3.6

### Patch Changes

- feat: enhance polyline

## 1.3.5

### Patch Changes

- fix: fix issues 89 and 90 in cad-viewer repo

## 1.3.4

### Patch Changes

- feat: support ATTDEF ATTRIB entities when reading DXF file

## 1.3.3

### Patch Changes

- feat: support ATTDEF and ATTRIB entities

## 1.3.2

### Patch Changes

- feat: refine error handling logic

## 1.3.1

### Patch Changes

- feat: update file type handling to support custom converter types

## 1.3.0

### Patch Changes

- feat: modify common, geometry-engine, and graphic-interface as dependencies of package data-model

## 1.2.7

### Patch Changes

- feat: add class AcCmTransparency

## 1.2.6

### Patch Changes

- feat: support changing layer color

## 1.2.5

### Patch Changes

- feat: refine logic to convert POLYLINE entity in dxf/dwg

## 1.2.4

### Patch Changes

- fix: bump version again because the wrong package was published in npm registry

## 1.2.3

### Patch Changes

- feat: support interruptting the entire workflow if one task throw one exception

## 1.2.2

### Patch Changes

- fix: fix bug that failed to convert one entity will result in the whole conversion interruptted

## 1.2.1

### Patch Changes

- fix: fix bug on parsing color

## 1.2.0

### Minor Changes

- fix: upgrade libredwg-web to fix bugs on getting layer name and line type name again

## 1.1.4

### Patch Changes

- fix: fix issue that AcDbBatchProcessing.processChunk doesn't wait for all chunks processed and then return

## 1.1.3

### Patch Changes

- feat: add 'FETCH_FILE' stage in AcDbDatabase.events.openProgress event

## 1.1.2

### Patch Changes

- refine methods to open database and refine typedocs of packages 'common' and 'data-model'

## 1.1.1

### Patch Changes

- add repo url in package.json

## 1.1.0

### Minor Changes

- refine constructor of spline related class to add one new parameter 'closed'

## 1.0.3

### Patch Changes

- bundle common, geometry-engine, and graphic-interface into data-model and remove dependency on lodash-es

## 1.0.2

### Patch Changes

- add readme for all of packages and remove dependencies on verb-nurbs-web
