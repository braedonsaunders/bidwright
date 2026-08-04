export type ModelElementGroupAxis =
  | "uniformat"
  | "masterformat"
  | "elementClass"
  | "elementType"
  | "system"
  | "level"
  | "material";

export interface GroupableModelElement {
  id: string;
  elementClass?: string | null;
  elementType?: string | null;
  system?: string | null;
  level?: string | null;
  material?: string | null;
  classification?: Record<string, string> | null;
}

export interface ModelElementGroup<T extends GroupableModelElement> {
  key: string;
  label: string;
  elements: T[];
  unclassified: boolean;
}

const AXIS_LABELS: Record<ModelElementGroupAxis, string> = {
  uniformat: "Uniformat",
  masterformat: "MasterFormat",
  elementClass: "Class",
  elementType: "Type",
  system: "System",
  level: "Level",
  material: "Material",
};

function valueForAxis(element: GroupableModelElement, axis: ModelElementGroupAxis) {
  if (axis === "uniformat" || axis === "masterformat") {
    return element.classification?.[axis]?.trim() ?? "";
  }
  return element[axis]?.trim() ?? "";
}

/** Groups model elements by an ordered set of estimating axes. Multiple axes
 * form one composite pickup group, for example "Pipework · Carbon steel · L2".
 * The complete element list stays attached to each group so promoting a group
 * to one worksheet row can retain links to every underlying BIM object. */
export function groupModelElements<T extends GroupableModelElement>(
  elements: T[],
  axes: ModelElementGroupAxis[],
): ModelElementGroup<T>[] {
  if (axes.length === 0) return [];

  const groups = new Map<string, ModelElementGroup<T>>();
  for (const element of elements) {
    let unclassified = false;
    const parts = axes.map((axis) => {
      const value = valueForAxis(element, axis);
      if (value) return value;
      unclassified = true;
      return `No ${AXIS_LABELS[axis].toLowerCase()}`;
    });
    const key = axes.map((axis, index) => `${axis}:${parts[index]}`).join("\u001f");
    const existing = groups.get(key);
    if (existing) {
      existing.elements.push(element);
    } else {
      groups.set(key, {
        key,
        label: parts.join(" · "),
        elements: [element],
        unclassified,
      });
    }
  }

  return Array.from(groups.values()).sort((a, b) => {
    if (a.unclassified !== b.unclassified) return a.unclassified ? 1 : -1;
    return a.label.localeCompare(b.label, undefined, { numeric: true, sensitivity: "base" });
  });
}
