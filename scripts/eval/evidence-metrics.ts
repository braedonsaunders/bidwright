type RecordLike = Record<string, any>;

/** Coverage is evidence linkage, not a claim of correct visual interpretation. */
export function evidenceMetrics(workspace: RecordLike, views: RecordLike[]) {
  const items: RecordLike[] = (workspace.worksheets || []).flatMap((w: RecordLike) => w.items || []);
  const ids = new Set(views.map((v) => v.id));
  let drawingRows = 0, linkedDrawingRows = 0, missingDerivations = 0, staleDerivations = 0;
  const unsupported: string[] = [];
  const rows = items.map((item) => {
    const evidence = item.evidenceBasis || item.sourceEvidence?.evidenceBasis || {};
    const quantity = evidence.quantity || evidence;
    const derivation = item.derivation;
    const drawing = /drawing|visual_takeoff/.test(quantity.type || "");
    const viewIds: string[] = Array.isArray(quantity.viewIds) ? quantity.viewIds : [];
    if (drawing) {
      drawingRows++;
      if (viewIds.length && viewIds.every((id) => ids.has(id))) linkedDrawingRows++;
      else unsupported.push(item.id);
    }
    if (!derivation?.formula) missingDerivations++;
    if (derivation?.status === "stale") staleDerivations++;
    return { id: item.id, name: item.name || item.description || item.entityName, quantity: item.quantity,
      unit: item.unit, derivation, viewIds };
  });
  return { itemCount: items.length, drawingRows, linkedDrawingRows,
    groundedDrawingCoverage: drawingRows ? linkedDrawingRows / drawingRows : null,
    unsupported, missingDerivations, staleDerivations, viewCount: views.length,
    uniqueImages: new Set(views.map((v) => v.imageHash)).size,
    anchorRows: rows.filter((r) => /anchor|rod/i.test(r.name || "")),
    groutRows: rows.filter((r) => /grout/i.test(r.name || "")),

  };
}
