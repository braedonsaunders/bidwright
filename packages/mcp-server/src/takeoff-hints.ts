export function sourceQuantityTakeoffHint(documentId: string, sourceRefs: Record<string, unknown>[] = [{ text: "<source row>" }]) {
  return `Quantities from this project source can be saved as takeoff marks with saveSourceQuantityTakeoff; example: ${JSON.stringify({ documentId, quantity: 1, unit: "EA", label: "<quantity label>", sourceRefs })}.`;
}

export function modelQuantityTakeoffHint(modelId: string) {
  return `Model quantities can be saved as linked takeoff marks with linkModelElementToWorksheetItem; example: ${JSON.stringify({ modelId, modelQuantityId: "<quantity id from queryModelElements>", worksheetItemId: "<row id>" })}.`;
}
