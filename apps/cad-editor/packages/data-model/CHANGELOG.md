# @mlightcad/data-model

## 1.9.14

### Patch Changes

- fix(data-model): correct transforms for dimensions, proxy entities, and block attributes
- Updated dependencies
  - @mlightcad/common@1.6.14
  - @mlightcad/geometry-engine@3.4.14
  - @mlightcad/graphic-interface@3.5.14

## 1.9.13

### Patch Changes

- feat(data-model): enhance grip editing with GRIPS sysvar and entity-specific grips
- Updated dependencies
  - @mlightcad/common@1.6.13
  - @mlightcad/geometry-engine@3.4.13
  - @mlightcad/graphic-interface@3.5.13

## 1.9.12

### Patch Changes

- feat(data-model,dxf-json-converter): add edit shortcuts and binary DXF parsing
- Updated dependencies
  - @mlightcad/common@1.6.12
  - @mlightcad/geometry-engine@3.4.12
  - @mlightcad/graphic-interface@3.5.12

## 1.9.11

### Patch Changes

- feat: implement database transaction manager with undo/redo
- Updated dependencies
  - @mlightcad/common@1.6.11
  - @mlightcad/geometry-engine@3.4.11
  - @mlightcad/graphic-interface@3.5.11

## 1.9.10

### Patch Changes

- feat: support reading AcDb2LineAngularDimension and add DWGNAME system variable
- Updated dependencies
  - @mlightcad/common@1.6.10
  - @mlightcad/geometry-engine@3.4.10
  - @mlightcad/graphic-interface@3.5.10

## 1.9.9

### Patch Changes

- feat: introduced grip point editing across entity types and unified DWG/DXF font collection through AcDbFontNameCollector for improved editing and font management consistency
- Updated dependencies
  - @mlightcad/common@1.6.9
  - @mlightcad/geometry-engine@3.4.9
  - @mlightcad/graphic-interface@3.5.9

## 1.9.8

### Patch Changes

- feat: improve SPLINE conversion with tolerant factory methods
- Updated dependencies
  - @mlightcad/common@1.6.8
  - @mlightcad/geometry-engine@3.4.8
  - @mlightcad/graphic-interface@3.5.8

## 1.9.7

### Patch Changes

- feat: improve LibreDWG converter with enhanced MLeader conversion and SHAPE entity support, and restore initial view from \*ACTIVE VPORT with added sanity checks for robustness
- Updated dependencies
  - @mlightcad/common@1.6.7
  - @mlightcad/geometry-engine@3.4.7
  - @mlightcad/graphic-interface@3.5.7

## 1.9.6

### Patch Changes

- feat: refactor AcGiContext into a class, fix SHAPE font resolution, and add STYLE table shape file support with draw-time database context handling
- Updated dependencies
  - @mlightcad/common@1.6.6
  - @mlightcad/geometry-engine@3.4.6
  - @mlightcad/graphic-interface@3.5.6

## 1.9.5

### Patch Changes

- feat: fix rendering and color resolution: resolve sub-entity RGB at draw time via AcGiContext and correctly compute ByBlock/ByLayer attribute colors from owning INSERT, improving consistency of block and entity display
- Updated dependencies
  - @mlightcad/common@1.6.5
  - @mlightcad/geometry-engine@3.4.5
  - @mlightcad/graphic-interface@3.5.5

## 1.9.4

### Patch Changes

- feat: upgrade libredwg-web to v0.7.4 to fix some issues on parsing dwg files
- Updated dependencies
  - @mlightcad/common@1.6.4
  - @mlightcad/geometry-engine@3.4.4
  - @mlightcad/graphic-interface@3.5.4

## 1.9.3

### Patch Changes

- feat: support proxy entity for dwg file
- Updated dependencies
  - @mlightcad/common@1.6.3
  - @mlightcad/geometry-engine@3.4.3
  - @mlightcad/graphic-interface@3.5.3

## 1.9.2

### Patch Changes

- feat: add AcDbProxyEntity with proxy graphic decoding
- Updated dependencies
  - @mlightcad/common@1.6.2
  - @mlightcad/geometry-engine@3.4.2
  - @mlightcad/graphic-interface@3.5.2

## 1.9.1

### Patch Changes

- fix(data-model): break circular deps via direct imports and add CJS bundle test (#106)
- Updated dependencies
  - @mlightcad/common@1.6.1
  - @mlightcad/geometry-engine@3.4.1
  - @mlightcad/graphic-interface@3.5.1

## 1.9.0

### Minor Changes

- feat: adds area support on curve, hatch, and geometry classes, extracts DXF conversion into the standalone @mlightcad/dxf-json-converter package, and documents GPL Web Worker isolation with example JSDoc

### Patch Changes

- Updated dependencies
  - @mlightcad/common@1.6.0
  - @mlightcad/geometry-engine@3.4.0
  - @mlightcad/graphic-interface@3.5.0

## 1.8.4

### Patch Changes

- feat: added drawNoPlotLayers policy for controlling no-plot layer visibility, fixed hatch pattern angle handling when explicit lines are defined, updated project license, and migrated npm publishing to Trusted Publishing via OIDC
- Updated dependencies
  - @mlightcad/common@1.5.4
  - @mlightcad/geometry-engine@3.3.4
  - @mlightcad/graphic-interface@3.4.4

## 1.8.3

### Patch Changes

- feat: geometricExtents for text, dimensions, table, and viewport; VPORT aspect ratio; case-insensitive VPORT lookup
- Updated dependencies
  - @mlightcad/common@1.5.3
  - @mlightcad/geometry-engine@3.3.3
  - @mlightcad/graphic-interface@3.4.3

## 1.8.2

### Patch Changes

- feat(data-model): add SHAPE entity support and honor DXF visibility in blocks
- Updated dependencies
  - @mlightcad/common@1.5.2
  - @mlightcad/geometry-engine@3.3.2
  - @mlightcad/graphic-interface@3.4.2

## 1.8.1

### Patch Changes

- feat: extend object snap support across entities and add ORTHOMODE, POLARMODE, POLARANG, and POLARADDANG system variables
- Updated dependencies
  - @mlightcad/common@1.5.1
  - @mlightcad/geometry-engine@3.3.1
  - @mlightcad/graphic-interface@3.4.1

## 1.8.0

### Minor Changes

- feat: replace WHITEBKCOLOR with MODELBKCOLOR and PAPERBKCOLOR

### Patch Changes

- Updated dependencies
  - @mlightcad/common@1.5.0
  - @mlightcad/geometry-engine@4.0.0
  - @mlightcad/graphic-interface@4.0.0

## 1.7.40

### Patch Changes

- fix: resolve text styles during progressive conversion and fix TRACE boundary order
- Updated dependencies
  - @mlightcad/common@1.4.40
  - @mlightcad/geometry-engine@3.2.40
  - @mlightcad/graphic-interface@3.3.40

## 1.7.39

### Patch Changes

- feat: add AcDbCurve::getOffsetCurves and centralize offset tolerance checks with AcGeTol
- Updated dependencies
  - @mlightcad/common@1.4.39
  - @mlightcad/geometry-engine@3.2.39
  - @mlightcad/graphic-interface@3.3.39

## 1.7.38

### Patch Changes

- fix: default layout manager factory survives production tree-shaking
- Updated dependencies
  - @mlightcad/common@1.4.38
  - @mlightcad/geometry-engine@3.2.38
  - @mlightcad/graphic-interface@3.3.38

## 1.7.37

### Patch Changes

- feat: improve tree-shaking with explicit ESM exports and add geometry snap helpers
- Updated dependencies
  - @mlightcad/common@1.4.37
  - @mlightcad/geometry-engine@3.2.37
  - @mlightcad/graphic-interface@3.3.37

## 1.7.36

### Patch Changes

- feat: add AcDbFormatter for AutoCAD-style length, point, and angle display
- Updated dependencies
  - @mlightcad/common@1.4.36
  - @mlightcad/geometry-engine@3.2.36
  - @mlightcad/graphic-interface@3.3.36

## 1.7.35

### Patch Changes

- feat: LUNITS/LUPREC/AUPREC, VPORT fallbacks, angbase/angdir; pnpm 10 + CI
- Updated dependencies
  - @mlightcad/common@1.4.35
  - @mlightcad/geometry-engine@3.2.35
  - @mlightcad/graphic-interface@3.3.35

## 1.7.34

### Patch Changes

- fix: build entity color via assignment to support AcDbHatch override
- Updated dependencies
  - @mlightcad/common@1.4.34
  - @mlightcad/geometry-engine@3.2.34
  - @mlightcad/graphic-interface@3.3.34

## 1.7.33

### Patch Changes

- fix: prefer anonymous table blocks when rendering AcDbTable
- Updated dependencies
  - @mlightcad/common@1.4.33
  - @mlightcad/geometry-engine@3.2.33
  - @mlightcad/graphic-interface@3.3.33

## 1.7.32

### Patch Changes

- feat: add SVG rendering support for hatch gradient previews and correct anchor for non-default TEXT/ATTRIB alignment
- Updated dependencies
  - @mlightcad/common@1.4.32
  - @mlightcad/geometry-engine@3.2.32
  - @mlightcad/graphic-interface@3.3.32

## 1.7.31

### Patch Changes

- feat: add hatch related system variables and fix SOLID hatch handling & preview rendering
- Updated dependencies
  - @mlightcad/common@1.4.31
  - @mlightcad/geometry-engine@3.2.31
  - @mlightcad/graphic-interface@3.3.31

## 1.7.30

### Patch Changes

- feat: add PAT parsing, predefined libraries, and SVG preview support
- Updated dependencies
  - @mlightcad/common@1.4.30
  - @mlightcad/geometry-engine@3.2.30
  - @mlightcad/graphic-interface@3.3.30

## 1.7.29

### Patch Changes

- feat: refine mline rendering
- Updated dependencies
  - @mlightcad/common@1.4.29
  - @mlightcad/geometry-engine@3.2.29
  - @mlightcad/graphic-interface@3.3.29

## 1.7.28

### Patch Changes

- feat: add mline and mleader supports
- Updated dependencies
  - @mlightcad/common@1.4.28
  - @mlightcad/geometry-engine@3.2.28
  - @mlightcad/graphic-interface@3.3.28

## 1.7.27

### Patch Changes

- fix: fix cad-viewer issue #243 and #183
- Updated dependencies
  - @mlightcad/common@1.4.27
  - @mlightcad/geometry-engine@3.2.27
  - @mlightcad/graphic-interface@3.3.27

## 1.7.26

### Patch Changes

- feat: add gradient hatch support
- Updated dependencies
  - @mlightcad/common@1.4.26
  - @mlightcad/geometry-engine@3.2.26
  - @mlightcad/graphic-interface@3.3.26

## 1.7.25

### Patch Changes

- feat: introduce explicit draw order and fix issues on closed wide LWPOLYLINE rendering and OCS arc/circle conversion
- Updated dependencies
  - @mlightcad/common@1.4.25
  - @mlightcad/geometry-engine@3.2.25
  - @mlightcad/graphic-interface@3.3.25

## 1.7.24

### Patch Changes

- fix: fix issues on dimension selection and snapping
- Updated dependencies
  - @mlightcad/common@1.4.24
  - @mlightcad/geometry-engine@3.2.24
  - @mlightcad/graphic-interface@3.3.24

## 1.7.23

### Patch Changes

- fix: fix block reference osnap resolution for transformed and nested entities and issue on color resolution for libredwg-converter
- Updated dependencies
  - @mlightcad/common@1.4.23
  - @mlightcad/geometry-engine@3.2.23
  - @mlightcad/graphic-interface@3.3.23

## 1.7.22

### Patch Changes

- feat: render wide LWPOLYLINE entities as filled geometry and add SVG linetype previews and demo rendering in example app
- Updated dependencies
  - @mlightcad/common@1.4.22
  - @mlightcad/geometry-engine@3.2.22
  - @mlightcad/graphic-interface@3.3.22

## 1.7.21

### Patch Changes

- feat: add CELTYPE support across database and DXF/DWG converters
- Updated dependencies
  - @mlightcad/common@1.4.21
  - @mlightcad/geometry-engine@3.2.21
  - @mlightcad/graphic-interface@3.3.21

## 1.7.20

### Patch Changes

- fix: fix issue #200 in cad-viewer
- Updated dependencies
  - @mlightcad/common@1.4.20
  - @mlightcad/geometry-engine@3.2.20
  - @mlightcad/graphic-interface@3.3.20

## 1.7.19

### Patch Changes

- feat: add clone method
- Updated dependencies
  - @mlightcad/common@1.4.19
  - @mlightcad/geometry-engine@3.2.19
  - @mlightcad/graphic-interface@3.3.19

## 1.7.18

### Patch Changes

- feat: improve text style fallback resolution and bump libredwg-web to 0.6.10
- Updated dependencies
  - @mlightcad/common@1.4.18
  - @mlightcad/geometry-engine@3.2.18
  - @mlightcad/graphic-interface@3.3.18

## 1.7.17

### Patch Changes

- feat: implement missing geometry/entity transforms and expand transform regression coverage
- Updated dependencies
  - @mlightcad/common@1.4.17
  - @mlightcad/geometry-engine@3.2.17
  - @mlightcad/graphic-interface@3.3.17

## 1.7.16

### Patch Changes

- feat(sysvars): add DYNMODE and DYNPROMPT system variables
- Updated dependencies
  - @mlightcad/common@1.4.16
  - @mlightcad/geometry-engine@3.2.16
  - @mlightcad/graphic-interface@3.3.16

## 1.7.15

### Patch Changes

- feat: improve geometry and optimize build configuration
- Updated dependencies
  - @mlightcad/common@1.4.15
  - @mlightcad/geometry-engine@3.2.15
  - @mlightcad/graphic-interface@3.3.15

## 1.7.14

### Patch Changes

- fix: improve DXF export functionality and refine AcDbSpline
- Updated dependencies
  - @mlightcad/common@1.4.14
  - @mlightcad/geometry-engine@3.2.14
  - @mlightcad/graphic-interface@3.3.14

## 1.7.13

### Patch Changes

- fix: fix #issue 150 in cad-viewer (#43)
- Updated dependencies
  - @mlightcad/common@1.4.13
  - @mlightcad/geometry-engine@3.2.13
  - @mlightcad/graphic-interface@3.3.13

## 1.7.12

### Patch Changes

- fix: upgrade dxf-json to fix bug #132 in cad-viewer repo
- Updated dependencies
  - @mlightcad/common@1.4.12
  - @mlightcad/geometry-engine@3.2.12
  - @mlightcad/graphic-interface@3.3.12

## 1.7.11

### Patch Changes

- fix issue on converting spline with fit points
- Updated dependencies
  - @mlightcad/common@1.4.11
  - @mlightcad/geometry-engine@3.2.11
  - @mlightcad/graphic-interface@3.3.11

## 1.7.10

### Patch Changes

- fix: fix bugs on building loops for hatch and revome dependency on verb-nurbs
- Updated dependencies
  - @mlightcad/common@1.4.10
  - @mlightcad/geometry-engine@3.2.10
  - @mlightcad/graphic-interface@3.3.10

## 1.7.9

### Patch Changes

- feat: improve DXF export
- Updated dependencies
  - @mlightcad/common@1.4.9
  - @mlightcad/geometry-engine@3.2.9
  - @mlightcad/graphic-interface@3.3.9

## 1.7.8

### Patch Changes

- fix: fix issue on reading dxf file caused by last release
- Updated dependencies
  - @mlightcad/common@1.4.8
  - @mlightcad/geometry-engine@3.2.8
  - @mlightcad/graphic-interface@3.3.8

## 1.7.7

### Patch Changes

- feat: add DXF export support
- Updated dependencies
  - @mlightcad/common@1.4.7
  - @mlightcad/geometry-engine@3.2.7
  - @mlightcad/graphic-interface@3.3.7

## 1.7.6

### Patch Changes

- feat: support changing foreground color
- Updated dependencies
  - @mlightcad/common@1.4.6
  - @mlightcad/geometry-engine@3.2.6
  - @mlightcad/graphic-interface@3.3.6

## 1.7.5

### Patch Changes

- chore: add system variables MEASUREMENTCOLOR, OSMODE, and TEXTCOLOR
- Updated dependencies
  - @mlightcad/common@1.4.5
  - @mlightcad/geometry-engine@3.2.5
  - @mlightcad/graphic-interface@3.3.5

## 1.7.4

### Patch Changes

- feat: add configurable parser worker timeout for drawing conversion and centralize database system variable names
- Updated dependencies
  - @mlightcad/common@1.4.4
  - @mlightcad/geometry-engine@3.2.4
  - @mlightcad/graphic-interface@3.3.4

## 1.7.3

### Patch Changes

- fix: fix issue 101
- Updated dependencies
  - @mlightcad/common@1.4.3
  - @mlightcad/geometry-engine@3.2.3
  - @mlightcad/graphic-interface@3.3.3

## 1.7.2

### Patch Changes

- feat(data-model): emit sysVarChanged only when sysvar value actually changes and add system variable 'LWDISPLAY'
- Updated dependencies
  - @mlightcad/common@1.4.2
  - @mlightcad/geometry-engine@3.2.2
  - @mlightcad/graphic-interface@3.3.2

## 1.7.1

### Patch Changes

- feat: set entity line weight and line type scale for newly created entity
- Updated dependencies
  - @mlightcad/common@1.4.1
  - @mlightcad/geometry-engine@3.2.1
  - @mlightcad/graphic-interface@3.3.1

## 1.7.0

### Patch Changes

- feat: support xdata and xrecord
- Updated dependencies
  - @mlightcad/common@1.3.8
  - @mlightcad/geometry-engine@3.1.11
  - @mlightcad/graphic-interface@3.2.8

## 1.6.10

### Patch Changes

- feat: respect value of system variables 'cecolor' and 'clayer' when creating one new entity
- Updated dependencies
  - @mlightcad/common@1.3.7
  - @mlightcad/geometry-engine@3.1.10
  - @mlightcad/graphic-interface@3.2.7

## 1.6.9

### Patch Changes

- feat: enhance polyline
- Updated dependencies
  - @mlightcad/common@1.3.6
  - @mlightcad/geometry-engine@3.1.9
  - @mlightcad/graphic-interface@3.2.6

## 1.6.8

### Patch Changes

- fix: fix issues 89 and 90 in cad-viewer repo
- Updated dependencies
  - @mlightcad/common@1.3.5
  - @mlightcad/geometry-engine@3.1.8
  - @mlightcad/graphic-interface@3.2.5

## 1.6.7

### Patch Changes

- feat: support ATTDEF ATTRIB entities when reading DXF file
- Updated dependencies
  - @mlightcad/common@1.3.4
  - @mlightcad/geometry-engine@3.1.7
  - @mlightcad/graphic-interface@3.2.4

## 1.6.6

### Patch Changes

- feat: support ATTDEF and ATTRIB entities
- Updated dependencies
  - @mlightcad/common@1.3.3
  - @mlightcad/geometry-engine@3.1.6
  - @mlightcad/graphic-interface@3.2.3

## 1.6.5

### Patch Changes

- Updated dependencies
  - @mlightcad/common@1.3.2
  - @mlightcad/geometry-engine@3.1.5
  - @mlightcad/graphic-interface@3.2.2

## 1.6.4

### Patch Changes

- feat: modify type of workerUrl to string | URL

## 1.6.3

### Patch Changes

- fix: fix bug on converting entities in paper space

## 1.6.2

### Patch Changes

- feat: set ltscale and celtscale value in AcDbDatabase when parsing dwg/dxf file

## 1.6.1

### Patch Changes

- feat: update file type handling to support custom converter types
- Updated dependencies
  - @mlightcad/common@1.3.1
  - @mlightcad/geometry-engine@3.1.4
  - @mlightcad/graphic-interface@3.2.1

## 1.6.0

### Minor Changes

- fix: fix regression bug on handling normal in insert and dimension entities resulted by commit d5a9966

### Patch Changes

- Updated dependencies
  - @mlightcad/graphic-interface@3.2.0

## 1.5.5

### Patch Changes

- feat: add some utility methods for AcDbOsnapMode

## 1.5.4

### Patch Changes

- feat: refiine osnap logic of insert entity

## 1.5.3

### Patch Changes

- feat: add property 'properties' for entities AcDb2dPolyline, AcDb3dPolyline, and AcDbPolyline
- Updated dependencies
  - @mlightcad/geometry-engine@3.1.3
  - @mlightcad/graphic-interface@3.1.4

## 1.5.2

### Patch Changes

- feat: support erasing entities

## 1.5.1

### Patch Changes

- fix: fix issue 38 in repo cad-viewer
- Updated dependencies
  - @mlightcad/geometry-engine@3.1.2
  - @mlightcad/graphic-interface@3.1.3

## 1.5.0

### Minor Changes

- feat: rename mehtod 'draw' to 'subWorldDraw' to keep consistent with AutoCAD ObjectARX API

## 1.4.2

### Patch Changes

- feat: refine entity osnap and properties
- Updated dependencies
  - @mlightcad/geometry-engine@3.1.1
  - @mlightcad/graphic-interface@3.1.2

## 1.4.1

### Patch Changes

- feat: refine class related to line weight
- Updated dependencies
  - @mlightcad/graphic-interface@3.1.1

## 1.4.0

### Patch Changes

- feat: modify common, geometry-engine, and graphic-interface as dependencies of package data-model
- Updated dependencies
  - @mlightcad/common@1.2.8
  - @mlightcad/geometry-engine@3.0.10
  - @mlightcad/graphic-interface@3.0.13

## 1.3.18

### Patch Changes

- feat: add class AcCmTransparency

## 1.3.17

### Patch Changes

- feat: support changing layer color

## 1.3.16

### Patch Changes

- feat: add system variable manager

## 1.3.15

### Patch Changes

- feat: refine snap related api

## 1.3.14

### Patch Changes

- feat: refine logic to convert layout again

## 1.3.13

### Patch Changes

- feat: refine logic to convert layout

## 1.3.12

### Patch Changes

- feat: add basePoint for renderer and renderable entity

## 1.3.11

### Patch Changes

- feat: add method 'properties' for more entities

## 1.3.10

### Patch Changes

- fix: fix bug on getting file extension from url when it contains query parameters

## 1.3.9

### Patch Changes

- feat: add approach to show properties of one entity

## 1.3.8

### Patch Changes

- feat: remove using enum DwgSmoothType in order to not bundle libredwg-web in libredwg-converter

## 1.3.7

### Patch Changes

- feat: upgrade libredwg-web to fix bug on converting polyline2d and polyline3d entities

## 1.3.6

### Patch Changes

- feat: add missed property dimBlockPosition for class AcDbDimension

## 1.3.5

### Patch Changes

- feat: refine logic to convert POLYLINE entity in dxf/dwg

## 1.3.4

### Patch Changes

- fix: bump version again because the wrong package was published in npm registry

## 1.3.3

### Patch Changes

- feat: support interruptting the entire workflow if one task throw one exception

## 1.3.2

### Patch Changes

- fix: fix one error on dwg version name

## 1.3.1

### Patch Changes

- feat: add api to support redrawing the database

## 1.3.0

### Minor Changes

- feat: support parsing dxf file with gbk encoding

## 1.2.25

### Patch Changes

- feat: change font type values in AcDbFontInfo

## 1.2.24

### Patch Changes

- fix: fix bug that failed to convert one entity will result in the whole conversion interruptted

## 1.2.23

### Patch Changes

- feat: support displaying 3dface entity in dwg file

## 1.2.22

### Patch Changes

- feat: support 3dface entity

## 1.2.21

### Patch Changes

- feat: refine logic to set the extents of drawing database

## 1.2.20

### Patch Changes

- feat: add method createDefaultData in class AcDbDatabase

## 1.2.19

### Patch Changes

- feat: support returning statistics of parsing task

## 1.2.18

### Patch Changes

- fix: fix bug on parsing color

## 1.2.17

### Patch Changes

- feat: upgrade package dxf-json

## 1.2.16

### Patch Changes

- feat: upgrade version of lbredwg-web to fix type of clipping boundary path of wipeout entity

## 1.2.15

### Patch Changes

- feat: adjust dependencies of libreddwg-converter

## 1.2.14

### Patch Changes

- feat: upgrade version of libredwg-web to support wipeout entity

## 1.2.13

### Patch Changes

- feat: attach entity info after created one 'group' grpahic interface entity

## 1.2.12

### Patch Changes

- feat: add one flag to delay creating one rendered entity in function AcDbEntity.draw

## 1.2.11

### Patch Changes

- feat: attach entity info (such as objectId, layerName and etc.) in rendering cache entities

## 1.2.8

### Patch Changes

- feat: destory parser web worker once parsing finished

## 1.2.7

### Patch Changes

- feat: support batch append for entities

## 1.2.6

### Patch Changes

- feat: add property layoutId for class AcDbBlockTableRecord and set property blockTableRecordId value of AcDbLayout correctly when converting DXF/DWG

## 1.2.5

### Patch Changes

- feat: enable web worker for libredwg-converter

## 1.2.4

### Patch Changes

- feat: enable web worker for dxf parser

## 1.2.3

### Patch Changes

- feat: pass error in AcDbConversionProgressCallback if one error occurs when opening one file

## 1.2.2

### Patch Changes

- feat: add properties 'extmin' and 'extmax' for class AcDbDatabase

## 1.2.1

### Patch Changes

- feat: use static string to define entity type because constructor name will be changed by building tool

## 1.2.0

### Minor Changes

- fix: upgrade libredwg-web to fix bugs on getting layer name and line type name again

## 1.1.8

### Patch Changes

- fix: normalizes the name of a block table record and use verb-nurbs-web to implement spline

## 1.1.7

### Patch Changes

- feat: regularize block space name and paper space name

## 1.1.6

### Patch Changes

- feat: add parameter 'degree' for classes AcDbSpline and AcGeSpline3d

## 1.1.5

### Patch Changes

- fix: fix issue that AcDbBatchProcessing.processChunk doesn't wait for all chunks processed and then return

## 1.1.4

### Patch Changes

- feat: add 'FETCH_FILE' stage in AcDbDatabase.events.openProgress event

## 1.1.3

### Patch Changes

- refine methods to open database and refine typedocs of packages 'common' and 'data-model'

## 1.1.2

### Patch Changes

- add repo url in package.json

## 1.1.1

### Patch Changes

- Use CatmullRomCurve3 in three.js to create one closed spline

## 1.1.0

### Minor Changes

- refine constructor of spline related class to add one new parameter 'closed'

## 1.0.7

### Patch Changes

- fix: support 'closed' property in class AcGeSpline3d

## 1.0.6

### Patch Changes

- Updated dependencies
  - @mlightcad/geometry-engine@1.0.4
  - @mlightcad/graphic-interface@1.0.4

## 1.0.5

### Patch Changes

- bundle common, geometry-engine, and graphic-interface into data-model and remove dependency on lodash-es
- Updated dependencies
  - @mlightcad/geometry-engine@1.0.3
  - @mlightcad/common@1.0.3
  - @mlightcad/graphic-interface@1.0.3

## 1.0.4

### Patch Changes

- add readme for all of packages and remove dependencies on verb-nurbs-web
- Updated dependencies
  - @mlightcad/geometry-engine@1.0.2
  - @mlightcad/common@1.0.2
  - @mlightcad/graphic-interface@1.0.2
