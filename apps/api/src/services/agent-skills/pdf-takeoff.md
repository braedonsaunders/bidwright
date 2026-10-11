---
name: pdf-takeoff
description: Measure PDF drawings, reuse calibrations, and count symbols with source-linked pickups.
---

Use getSourceOverview for persisted page, extraction and pickup facts; unknown PDF kind is not evidence of a scan.
describeTools exposes drawing, vision and calibrated takeoff families; invokeTool calls tools not directly loaded.
readDrawingPage gives an overview; readDrawingTile exposes details and dimensions. Retain returned viewIds.
Pass viewId and normalized coordinates in that returned image frame (0..1); measurement tools map them to source coordinates.
Reuse page or detail-region calibration via getTakeoffCalibration. Preserve human calibration; a detail may have a different scale from its sheet.
detectDrawingScale returns OCR candidates and dimension cross-check conflicts. Incompatible scales describe uncertainty, not an average scale.
measureTakeoff computes linear, polyline, area or count quantities without saving. Snap/trace can follow native vector linework when available.
saveTakeoffMeasurement saves a Pickup; updateTakeoffMeasurement edits one. renderTakeoffOverlay shows saved object IDs with the original image.
Legend/template tools identify the drawing's symbol vocabulary. Counting is a read; save detections explicitly when useful.
Overlapping tiles and repeated elevations/details can describe the same physical instance. Count installed objects once, retaining distinct component types.
listPickups exposes existing measurements; linkPickupToWorksheetItem connects selected pickups to priced rows. Keep waste/allowances separate from measured quantity.
Never claim an image was viewed when it was not. Positioned text can be OCR and does not establish native vector geometry.
