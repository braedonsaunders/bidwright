/** Autodesk Viewer emits slightly different selection shapes for ordinary and
 * aggregated models. Normalize both to the first selected dbId. APS property
 * extraction stores this dbId as ModelElement.externalId, so it is the stable
 * bridge between the highlighted geometry and Bidwright's indexed element. */
export function firstAutodeskSelectedDbId(event: unknown): number | null {
  if (!event || typeof event !== "object") return null;
  const value = event as {
    dbIdArray?: unknown;
    selections?: Array<{ dbIdArray?: unknown }>;
  };
  const direct = Array.isArray(value.dbIdArray) ? value.dbIdArray : [];
  const aggregated = Array.isArray(value.selections)
    ? value.selections.flatMap((selection) => Array.isArray(selection.dbIdArray) ? selection.dbIdArray : [])
    : [];
  const selected = [...direct, ...aggregated].find((id) => Number.isInteger(id) && Number(id) > 0);
  return selected == null ? null : Number(selected);
}
