export function sourceQuantityTakeoffHint(documentId: string, sourceRefs: Record<string, unknown>[] = [{ text: "<source row>" }]) {
  return `Quantities from this project source can be saved as takeoff marks with saveSourceQuantityTakeoff; example: ${JSON.stringify({ documentId, quantity: 1, unit: "EA", label: "<quantity label>", sourceRefs })}.`;
}

export function modelQuantityTakeoffHint(modelId: string) {
  return `Model quantities can be saved as linked takeoff marks with linkModelElementToWorksheetItem; example: ${JSON.stringify({ modelId, modelQuantityId: "<quantity id from queryModelElements>", worksheetItemId: "<row id>" })}.`;
}

export function pickupRowLinkFacts(pickupIds: string[]) {
  pickupIds = [...new Set(pickupIds)];
  return {
    pickupIds,
    rowLinkFact: `Saved marks can drive a row quantity via createWorksheetItem/updateWorksheetItem; example: ${JSON.stringify({ takeoff: (pickupIds.length ? pickupIds.slice(0, 2) : ["<pickupId>"]).map(pickupId => ({ pickupId })) })}. On update takeoff replaces the link set.`,
  };
}

/** Saved-tool response shapes; never mistake a link id for a pickup id. */
export function savedPickupFacts(result: any) {
  const ids: string[] = [...(result.pickupIds ?? [])];
  if (result.pickup?.id) ids.push(result.pickup.id);
  if (result.pickupId) ids.push(result.pickupId);
  if (result.link?.pickupId) ids.push(result.link.pickupId);
  for (const pickup of result.pickups ?? result.annotations ?? []) if (pickup.pickup?.id ?? pickup.id) ids.push(pickup.pickup?.id ?? pickup.id);
  for (const entry of Array.isArray(result.saved) ? result.saved : []) if (entry.pickup?.id) ids.push(entry.pickup.id);
  return { ...result, ...pickupRowLinkFacts(ids) };
}
