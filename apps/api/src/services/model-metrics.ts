type Element = { id: string; name?: string | null; externalId?: string; elementClass?: string; elementType?: string | null; level?: string | null; system?: string | null; material?: string | null; properties?: any; bbox?: any; quantities: any[] };

const propertyValue = (properties: any, path: string) => properties?.[path] ?? path.split(".").reduce<any>((value, key) => value?.[key], properties);

export function aggregatePersistedElements(elements: Element[], input: { groupBy: string; property?: string; elementClass?: string; propertyFilters?: Record<string, string>; elementIds?: string[]; limit?: number; offset?: number }) {
  const selected = input.elementIds ? new Set(input.elementIds) : null;
  const duplicateElementIds = input.elementIds?.filter((id, i, ids) => ids.indexOf(id) !== i) ?? [];
  const excludedElementIds: string[] = [];
  const groups = new Map<string, { key: string; elementIds: string[]; quantities: Map<string, any> }>();
  for (const element of elements) {
    if (selected && !selected.has(element.id)) continue;
    if (element.properties?.estimateRelevant === false) { excludedElementIds.push(element.id); continue; }
    if (input.elementClass && element.elementClass !== input.elementClass) continue;
    if (Object.entries(input.propertyFilters ?? {}).some(([key, value]) => String(propertyValue(element.properties, key) ?? "") !== value)) continue;
    const field = input.groupBy === "class" ? "elementClass" : input.groupBy === "type" ? "elementType" : input.groupBy;
    const value = field === "property" ? (input.property ? propertyValue(element.properties, input.property) : undefined) : (element as any)[field];
    const key = value == null ? "(unspecified)" : typeof value === "object" ? JSON.stringify(value) : String(value);
    const group = groups.get(key) ?? { key, elementIds: [] as string[], quantities: new Map<string, any>() };
    group.elementIds.push(element.id);
    for (const q of element.quantities) {
      const source = /declared|qto|authored/i.test(`${q.method} ${q.metadata?.quantitySource ?? ""}`) ? "authored" : /mesh|bbox|geometr|triangulat/i.test(q.method ?? "") ? "geometric" : "derived-or-unspecified";
      const name = String(q.metadata?.qtoName ?? q.quantityType);
      const basis = /gross/i.test(name) ? "gross" : /net/i.test(name) ? "net" : "unspecified";
      const bucketKey = JSON.stringify([q.quantityType, q.unit, source, basis, q.method, name]);
      const bucket = group.quantities.get(bucketKey) ?? { quantityType: q.quantityType, name, unit: q.unit, source, basis, method: q.method,
        value: 0, quantityCount: 0, elementIds: new Set<string>() };
      if (Number.isFinite(Number(q.value))) { bucket.value += Number(q.value); bucket.quantityCount++; bucket.elementIds.add(element.id); }
      group.quantities.set(bucketKey, bucket);
    }
    groups.set(key, group);
  }
  const rows = [...groups.values()].map((g) => ({ key: g.key, elementCount: g.elementIds.length, elementIds: g.elementIds.slice(0, 100),
    elementIdsTruncated: g.elementIds.length > 100,
    quantities: [...g.quantities.values()].map((q) => ({ ...q, contributingElementCount: q.elementIds.size, elementIds: [...q.elementIds].slice(0, 100), elementIdsTruncated: q.elementIds.size > 100 })) }));
  const offset = input.offset ?? 0, limit = input.limit ?? 100;
  return { excludedElementCount: excludedElementIds.length, excludedElementIds: excludedElementIds.slice(0, 100), excludedElementIdsTruncated: excludedElementIds.length > 100, totalGroups: rows.length, offset, limit, hasMore: offset + limit < rows.length, groups: rows.slice(offset, offset + limit), duplicateElementIds: [...new Set(duplicateElementIds)] };
}

export function persistedSolidMetrics(elements: Element[]) {
  const solids = elements.filter((e) => /CAD_MESH|STL_MESH|OBJ_GROUP/.test(e.elementClass ?? "")).map((element) => {
    const closed = element.properties?.closed;
    return { elementId: element.id, name: element.name, bbox: element.bbox, closed: closed ?? null,
      instanceCount: element.properties?.assemblyInstances?.length || 1, assemblyInstances: element.properties?.assemblyInstances ?? [],
      metrics: element.quantities.filter((q) => /^(surface_area|volume)$/.test(q.quantityType) && (q.quantityType !== "volume" || closed === true))
        .map((q) => ({ quantityId: q.id, type: q.quantityType, value: q.value, unit: q.unit, method: q.method })),
      facts: [...(element.properties?.facts ?? []), ...(closed === true ? [] : [closed === false ? "not closed" : "Closure was not checked by the persisted ingest; volume unavailable"])] };
  });
  const bom = new Map<string, { partName: string; instanceCount: number; instances: typeof solids }>();
  for (const solid of solids) {
    const name = solid.name ?? solid.elementId;
    const row = bom.get(name) ?? { partName: name, instanceCount: 0, instances: [] };
    row.instanceCount += solid.instanceCount; row.instances.push(solid); bom.set(name, row);
  }
  return { solids, assemblyBom: [...bom.values()], facts: ["Metrics are persisted triangulation estimates, not exact BREP mass properties.", ...(solids.length ? [] : ["Per-solid metrics are not present in the persisted ingest."])] };
}
