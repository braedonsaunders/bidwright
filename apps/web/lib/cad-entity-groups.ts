export type CadEntityGroupAxis = "layer" | "type" | "layoutName";

export interface CadEntityGroupable {
  id: string;
  layer: string;
  type: string;
  layoutName: string;
  uom: string;
}

export interface CadEntityGroup<T extends CadEntityGroupable> {
  key: string;
  label: string;
  entities: T[];
}

const AXIS_LABEL: Record<CadEntityGroupAxis, string> = {
  layer: "Layer",
  type: "Type",
  layoutName: "Layout",
};

function normalized(value: string | null | undefined) {
  return value?.trim() || "Unclassified";
}

/**
 * Groups native CAD entities into worksheet-ready rollups. Unit is always an
 * implicit final partition: summing a length and an area into one line would
 * be mathematically invalid even when both entities share a layer or type.
 */
export function groupCadEntities<T extends CadEntityGroupable>(
  entities: T[],
  axes: CadEntityGroupAxis[],
): CadEntityGroup<T>[] {
  if (axes.length === 0) {
    return [{ key: "all", label: "All CAD entities", entities }];
  }

  const buckets = new Map<string, { parts: string[]; uom: string; entities: T[] }>();
  for (const entity of entities) {
    const parts = axes.map((axis) => normalized(entity[axis]));
    const uom = normalized(entity.uom);
    const key = JSON.stringify([...parts, uom]);
    const bucket = buckets.get(key) ?? { parts, uom, entities: [] };
    bucket.entities.push(entity);
    buckets.set(key, bucket);
  }

  return Array.from(buckets.entries())
    .map(([key, bucket]) => ({
      key,
      label: `${bucket.parts.map((part, index) => `${AXIS_LABEL[axes[index]]}: ${part}`).join(" · ")} · ${bucket.uom}`,
      entities: bucket.entities,
    }))
    .sort((left, right) => right.entities.length - left.entities.length || left.label.localeCompare(right.label));
}
