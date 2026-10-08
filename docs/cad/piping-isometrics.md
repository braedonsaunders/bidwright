# Piping isometrics in BidWright

Open a project, choose **Documents → Files → New 2D model**, name the drawing, then select **Piping isometric** above the editor. Existing DXF and DWG drawings can use the same workspace; their other entities are retained.

## Turn a measured field sketch into a customer drawing

1. Set the pipe specification, nominal size, spool and line number. Enter the measured centreline length, then choose East, North, Up or the opposite direction. Continue from the last connection, or select an earlier connection to add a branch. Rolling offsets accept separate X, Y and Z measurements.
2. Use the isometric grid for sketching. Choose XY, XZ or YZ, spacing and snap. Grid picks hold the third coordinate at the starting connection. Typed dimensions retain their exact value. The grid appears only in the editor.
3. Select a connection to choose a fitting or enter its measured takeouts. Select a pipe to insert an inline component, attach a support, change its size/specification, heat number or spool, and set each end's preparation, field-weld status and tag. Imported fittings retain independent port dimensions.
4. Review **Materials & cuts** and resolve fabrication checks. Cuts subtract fitting takeouts and applicable butt-weld root gaps from the measured centreline span. Manufacturer tables or approved measured values must govern production dimensions. Unknown dimensions stop cut-list and PCF exports. Unknown weights and surface areas remain marked **MISSING**.
5. Set weld numbering in **Weld map**. Numeric and alphabetic sequences are available; explicit customer tags take precedence. Shop/field location and preparations appear in the weld schedule.
6. Add the customer, project, revision, drawing number, drafter, checker and notes in **Drawing setup**. Choose metric or fractional imperial labels, PDF paper size and included views. Review each spool and the interactive **3D review** before issuing.
7. Export the **PDF package** for the customer. It includes drawing sheets per spool/view, complete material and cut schedules, and a weld list. Drawings with unresolved fabrication checks are marked DRAFT. CSV exports support fabrication and estimating; the multi-file BOM combines compatible materials while retaining heat lots and different fitting dimensions.

## Saving and interchange

The document saves automatically after edits and when the editor closes. The host Save button and Ctrl/Cmd+S provide an explicit save, with visible status and retry on errors. The piping toolbar Save requests the same document save. Save again after a failed network request before leaving the application.

DXF and AutoCAD 2000 DWG exports contain native lines, circles, text and layers, plus an application XRECORD holding the measured piping model. Reopening either format in BidWright restores the model, specifications and schedules. DWG export uses a dedicated worker and stops on conversion errors; it is not an AutoCAD or SolidWorks verification service. Save a piping JSON alongside interchange files when another application may strip extension records.

PCF imports support pipes, elbows, tees, reducers, valves, flanges, caps, supports, welds, olets, gaskets and bolts. Coordinate and bore units must be declared. Unsupported components reject the import rather than disappear from the BOM. External files without an approved specification do not inherit carbon-steel sizes or weights; supply those values before issuing fabrication schedules. PCF export preserves component endpoints and pipeline identifiers. IDF is not supported by this release.

The default library contains Schedule 40 carbon-steel pipe from NPS 1–8, Weldbend elbow/tee/cap dimensions and selected Bonney Forge Class 150 butt-weld gate valves. It is a starting library, not a complete vendor inventory. Specifications and catalogues can be edited and exchanged as JSON. Review catalogued approximate weights, and supply the actual item dimensions for unlisted flanges, valves, reducers and materials.

3D review shows physical pipe envelopes and fitting geometry. It supports spatial review; the fabrication schedules use the measured semantic model. It does not create manufacturer-certified solid parts.

## Sources and licences

All piping symbols and workflow code were authored for BidWright. No PROCAD/SpoolCAD trial code or drawing assets are included.

- [Wheatland Schedule 40 dimensional submittal](https://www.wheatland.com/wp-content/uploads/2017/12/Schedule-40-Submittal-Sheet.pdf)
- [Weldbend catalogue](https://www.weldbend.com/catalog.pdf)
- [Bonney Forge cast steel valves](https://cad.bonneyforge.com/Asset/CSV.pdf)
- [Hexagon PCF reference](https://docs.hexagonppm.com/r/en-US/PCF-Reference-Guide/Version-15/242663)
- MLightCAD viewer 1.7.4 and data-model 1.15.1 retain their upstream licences; see [upgrade record](editor-upgrade.md).
- DWG encoding uses GNU LibreDWG 0.14, GPL-3.0-or-later. The distributed `/cad-editor/dwg-export/` includes COPYING, corresponding source archive and exact build wrapper. See [build instructions](../../scripts/cad-editor/dwg-export/README.md).
- PDF text uses Noto Sans under the SIL Open Font License; the licence accompanies the source font.
