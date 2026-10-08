# @mlightcad/common

## 1.15.1

### Patch Changes

- feat: paints wipeouts with the layout background fill so covered geometry stays hidden. DXF export expands XData points and binary chunks, and attribute definitions keep their owner ids when block table record handles collide. Imported XData is stored in a compacted form that uses less memory

## 1.15.0

### Minor Changes

- fix: aligns DWG converter license failure markers with the current @mlightcad/dwg-converter messages so expired evaluation and invalid license key errors classify correctly as license_expired and license_invalid instead of falling through as generic open failures

## 1.14.14

### Patch Changes

- feat: vendors emf-converter as the @mlightcad/emf-converter workspace package and exposes raster image and OLE frame properties so the property palette can edit them. Missing image paths draw without MTEXT control codes, and DWG import no longer aborts when handles are assigned before attributes

## 1.14.13

### Patch Changes

- feat: draws closed wide polylines with index-aligned offsetRing so outer and inner stroke loops share sample order and count, letting renderers triangulate the stroke band without area holes. fillType updates stay on the successful draw path, and closed wide polylines skip area batching

## 1.14.12

### Patch Changes

- fix: keeps compact MTEXT line spacing under the At Least style so lines expand only when the factor would pack them closer than the text height, and passes Exact spacing through DWG import. DXF load and block draw allocate less via span-based pair parsing, lazy entity geometry, in-place OCS transforms, and LRU rendering-cache eviction. Incomplete MLINESTYLE entries no longer abort opens, and WASM out-of-memory faults are reported as worker_oom

## 1.14.11

### Patch Changes

- feat: adds dynamic block INSERT drawing via anonymous \*U representations and LibreDWG dyn-block dictionary metadata, plus AcDbArcAlignedText with DXF group 90 color round-trip. AcDbBlockRepresentationData remains for converters and dyn-block references but is no longer publicly re-exported

## 1.14.10

### Patch Changes

- fix: keeps tapered LWPOLYLINE vertex widths when converting from libredwg-web 0.7.13 so valve triangles and other variable-width polylines retain start and end widths instead of collapsing to constant width

## 1.14.9

### Patch Changes

- fix: preserves complex linetype shape and text DXF extras on round-trip by reading and writing shape number, style object id, scale, rotation, X/Y offsets, and embedded text for non-dash pattern elements, so those attributes are no longer dropped when parsing or exporting DXF linetype table records

## 1.14.8

### Patch Changes

- fix: renders tapered wide polylines that taper to zero width as filled geometry instead of falling back to strokes, including collapsed-inner circular widths as solid disks. LibreDWG solid hatches named \_SOLID (and leading-underscore variants) are recognized as solid fills so empty definitionLines are no longer dropped during convert

## 1.14.7

### Patch Changes

- fix: decodes Korean CP949 DXF text via euc-kr so layer names and annotations no longer garble, hardens DXF transparency header reads and full-ellipse/full-circle hatch arcs for round-trip fidelity, and fixes Excel OLE EMF text clipping plus CJK font fallback when rendering embedded previews

## 1.14.6

### Patch Changes

- fix: anchors TEXT by DXF group 11 presence instead of matching coordinates, prefers Ole10Native BMP over OlePres WMF for Paintbrush OLE so raster previews render correctly, and flattens INSERT elevation in blockTransform so 2D clipping no longer misses elevated block references

## 1.14.5

### Patch Changes

- fix: ignores non-finite geometry points so NaN bounding boxes no longer poison spatial indexes, and empty polyline OCS boxes return an empty WCS box instead of transforming infinity. Also skips drawing non-constant ATTDEFs inside block definitions so only constant attribute templates render as block geometry while INSERT ATTRIB draws the editable values

## 1.14.4

### Patch Changes

- feat: extracts and rasterizes OLE WMF/EMF metafile previews so embedded OLE content can render as images, and classifies DWG converter license failures into clearer open-database errors. LibreDWG layer import maps CMC RGB true colors when colorIndex is 256 instead of losing those layer colors

## 1.14.3

### Patch Changes

- feat: adds chord-height curve tessellation so short arcs use fewer segments than a full circle, while opening a drawing without circleSides defaults to draft quality so stored VIEWRES 1000 is not applied accidentally. Circles, arcs, ellipses, polylines, leaders, and splines tessellate from the open-time setting, and renderers can read drawCircleSides from the draw context

## 1.14.2

### Patch Changes

- feat: adds AutoCAD-compatible DWG Compare system variables so drawings can store COMPAREHATCH, COMPARETEXT, COMPARERCMARGIN, and COMPARETOLERANCE with AutoCAD defaults and ranges, while COMPAREPROPS stays a registry-backed bitcode for property-only diffs. DXF HEADER import reads in-range compare values and ignores out-of-range ones, and the database exposes typed getters plus COMPAREPROPS color, layer, and linetype bit flags

## 1.14.1

### Patch Changes

- fix: defaults omitted DXF entity colors to ByLayer instead of the current CECOLOR system variable, matching AutoCAD when color group 62 is absent. LibreDWG dwg2dxf often writes $CECOLOR 0 while omitting that group on ByLayer entities, so import no longer copies CECOLOR onto them. Also upgrades @mlightcad/libredwg-web to 0.7.10

## 1.14.0

### Minor Changes

- feat: adds ObjectARX-style entity intersection so callers can query WCS intersection points between drawing entities via AcDbEntity.intersectWith, with extend-this, extend-arg, and extend-both flags plus optional apparent intersection on a projection plane. Curve entities, hatches, inserts, and dimensions expose primitives, while text-like entities stay empty. The geometry engine adds acgeIntersectCurves for pairwise line, arc, ellipse, and spline intersection with de-duplication

## 1.13.1

### Patch Changes

- feat: adds circular-arc factory helpers so callers can build 2D circles and arcs from center-radius, diameter, three points, start-end-bulge, and start-center-end constructions. Three-point arcs now pick a unique circumcircle and honor AutoCAD-style reverse-direction sweep, so near-collinear points and complementary arcs stay numerically stable

## 1.13.0

### Minor Changes

- feat: adds a session-scoped LOGINNAME system variable so drawings can expose the current login name, and fixes LibreDWG converter packaging so the wasm module is emitted beside the parser worker for reliable runtime loading

## 1.12.5

### Patch Changes

- feat: adds directBatchPrimitive for faster entity geometry batching, fixes OCS transforms for non-default extrusions so arcs and circles render correctly, and tolerates missing LibreDWG symbol and table names without throwing

## 1.12.4

### Patch Changes

- feat: speeds up drawing open by loading fonts on demand, skipping font work when no loader is set, streaming large-block font collection, batching font loads in parallel, and deferring mid-size block compaction

## 1.12.3

### Patch Changes

- feat: improve block rendering cache hits, trim font preload, and correctly apply ACIS body transforms to solid geometry

## 1.12.2

### Patch Changes

- feat: faster DWG/DXF parsing via zero-copy worker transfers and windowed UTF-8 decoding, plus private dwg-converter setup tooling

## 1.12.1

### Patch Changes

- feat: adds time-budgeted UI feedback, block-cache templates, MINSERT parameters, OLE2FRAME geometry, ByBlock ACI7, native DXF registration, and migrates GPL converters

## 1.12.0

### Minor Changes

- Fix xref import, add MIT DXF converter, attach ACDSDATA to 3DSOLIDs, and improve DXF open progress

## 1.11.3

### Patch Changes

- feat: support drawing thumbnails and viewport DCS-to-WCS mapping

## 1.11.2

### Patch Changes

- fix: draw ATTDEF per AutoCAD semantics and fix DXF flags

## 1.11.1

### Patch Changes

- feat: upgraded to Vite 6 & dxf-json 1.2.8, and improved data model by storing block PreviewIcons as bytes and fixed nested layer filter behavior

## 1.11.0

### Patch Changes

- feat: adds support for OLE frames and layer filters, improves image frame selection, assigns TEMP handles to unbound AcDbObjects, and refactors helper naming with consistent acdb/acge prefixes for better maintainability

## 1.10.7

### Patch Changes

- feat: added block cross-reference flags & unresolved detection, and improved data model flexibility by making the CLASSES conversion stage optional

## 1.10.6

### Patch Changes

- feat: improved DXF compatibility and data integrity with corrected group codes, CLASSES and SOLID export support, fixed proxy DXF codes, preserved SHAPE round-trip identity, and maintained circular arc endpoints when reversing loop edges

## 1.10.5

### Patch Changes

- feat: added a heuristic memory estimator for AcDbDatabase and fixed saved view restoration by correctly applying VPORT view target and twist, improving memory estimation and view consistency

## 1.10.4

### Patch Changes

- feat: sync latest upstream changes for ACIS SAB decoding, 3DSOLID wireframes, CI update, and FCF GDT/TOLERANCE improvements

## 1.10.3

### Patch Changes

- feat: add AcDbFcf and AcDb3dSolid

## 1.10.2

### Patch Changes

- feat: improved data model reliability with structured database error reporting, resilient font loading, accurate leader hook line rendering, and global handle registry to prevent cross-table handle collisions

## 1.10.1

### Patch Changes

- fix: improved AutoCAD compatibility by normalizing symbol table names and enhanced wide polyline fill rendering for self-overlapping paths

## 1.10.0

### Minor Changes

- feat: refactor symbol table storage with typed attributes, enforce write access controls, dispatch layerModified events, fix entityModified dispatch on commit, and resolve MLine grip issues for improved data integrity

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
