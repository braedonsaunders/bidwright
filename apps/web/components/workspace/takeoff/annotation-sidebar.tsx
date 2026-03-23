"use client";

import { useState } from "react";
import { Eye, EyeOff, Pencil, Trash2, ChevronDown, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  Button,
  Card,
  CardBody,
  CardHeader,
  CardTitle,
  EmptyState,
  Separator,
} from "@/components/ui";
import type { TakeoffAnnotation } from "./annotation-canvas";

interface AnnotationSidebarProps {
  annotations: TakeoffAnnotation[];
  onToggleVisibility: (id: string) => void;
  onDelete: (id: string) => void;
  onEdit: (id: string) => void;
  onSelectAnnotation: (id: string) => void;
  selectedAnnotationId: string | null;
}

/* Group annotations by groupName or type */
function groupAnnotations(
  annotations: TakeoffAnnotation[]
): Map<string, TakeoffAnnotation[]> {
  const groups = new Map<string, TakeoffAnnotation[]>();
  for (const ann of annotations) {
    const key = ann.groupName || ann.type;
    const arr = groups.get(key) ?? [];
    arr.push(ann);
    groups.set(key, arr);
  }
  return groups;
}

/* Format measurement for display */
function formatMeasurement(ann: TakeoffAnnotation): string {
  if (!ann.measurement) return "--";
  const { value, unit } = ann.measurement;
  if (unit === "count") return `${value}`;
  return `${value.toFixed(2)} ${unit}`;
}

/* Pretty label for annotation type */
const TYPE_LABELS: Record<string, string> = {
  linear: "Linear",
  "linear-polyline": "Polyline",
  "linear-drop": "Linear Drop",
  count: "Count",
  "count-by-distance": "Count by Distance",
  "area-rectangle": "Rectangle",
  "area-polygon": "Polygon",
  "area-triangle": "Triangle",
  "area-ellipse": "Ellipse",
  "area-vertical-wall": "Vertical Wall",
  calibrate: "Calibration",
};

export function AnnotationSidebar({
  annotations,
  onToggleVisibility,
  onDelete,
  onEdit,
  onSelectAnnotation,
  selectedAnnotationId,
}: AnnotationSidebarProps) {
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());
  const groups = groupAnnotations(annotations);

  function toggleGroup(key: string) {
    setCollapsedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  /* Summary stats */
  const totalCount = annotations.length;
  const visibleCount = annotations.filter((a) => a.visible).length;

  return (
    <Card className="flex h-full w-72 shrink-0 flex-col overflow-hidden">
      <CardHeader className="py-3">
        <CardTitle>Annotations</CardTitle>
        <p className="mt-0.5 text-[11px] text-fg/40">
          {totalCount} item{totalCount !== 1 ? "s" : ""} &middot; {visibleCount} visible
        </p>
      </CardHeader>
      <CardBody className="flex flex-1 flex-col gap-1 overflow-auto py-2 px-2">
        {totalCount === 0 ? (
          <EmptyState className="py-6 border-none">
            <p className="text-xs">No annotations yet</p>
            <p className="mt-1 text-[11px] text-fg/30">
              Select a tool and click on the drawing to start measuring
            </p>
          </EmptyState>
        ) : (
          Array.from(groups.entries()).map(([groupKey, items]) => {
            const collapsed = collapsedGroups.has(groupKey);
            const groupLabel = TYPE_LABELS[groupKey] ?? groupKey;

            return (
              <div key={groupKey} className="mb-1">
                {/* Group header */}
                <button
                  onClick={() => toggleGroup(groupKey)}
                  className="flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-xs font-medium text-fg/60 hover:bg-panel2/60 transition-colors"
                >
                  {collapsed ? (
                    <ChevronRight className="h-3 w-3" />
                  ) : (
                    <ChevronDown className="h-3 w-3" />
                  )}
                  <span>{groupLabel}</span>
                  <span className="ml-auto text-[11px] text-fg/30">{items.length}</span>
                </button>

                {/* Group items */}
                {!collapsed && (
                  <div className="ml-2 space-y-0.5">
                    {items.map((ann) => (
                      <div
                        key={ann.id}
                        onClick={() => onSelectAnnotation(ann.id)}
                        className={cn(
                          "group flex items-center gap-2 rounded-md px-2 py-1.5 cursor-pointer transition-colors",
                          selectedAnnotationId === ann.id
                            ? "bg-accent/10 border border-accent/20"
                            : "hover:bg-panel2/40 border border-transparent"
                        )}
                      >
                        {/* Color indicator */}
                        <div
                          className="h-2.5 w-2.5 shrink-0 rounded-full"
                          style={{ backgroundColor: ann.color }}
                        />

                        {/* Label and measurement */}
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-xs font-medium text-fg/80">
                            {ann.label || `${TYPE_LABELS[ann.type] ?? ann.type}`}
                          </p>
                          <p className="text-[11px] text-fg/40">
                            {formatMeasurement(ann)}
                          </p>
                        </div>

                        {/* Action buttons (show on hover) */}
                        <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              onToggleVisibility(ann.id);
                            }}
                            className="rounded p-1 text-fg/30 hover:bg-panel2 hover:text-fg/60"
                            title={ann.visible ? "Hide" : "Show"}
                          >
                            {ann.visible ? (
                              <Eye className="h-3 w-3" />
                            ) : (
                              <EyeOff className="h-3 w-3" />
                            )}
                          </button>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              onEdit(ann.id);
                            }}
                            className="rounded p-1 text-fg/30 hover:bg-panel2 hover:text-fg/60"
                            title="Edit"
                          >
                            <Pencil className="h-3 w-3" />
                          </button>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              onDelete(ann.id);
                            }}
                            className="rounded p-1 text-fg/30 hover:bg-danger/10 hover:text-danger"
                            title="Delete"
                          >
                            <Trash2 className="h-3 w-3" />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })
        )}

        {/* Summary footer */}
        {totalCount > 0 && (
          <>
            <Separator className="mt-auto" />
            <div className="rounded-md bg-panel2/50 px-3 py-2 mt-1">
              <p className="text-xs font-medium text-fg/60">
                {totalCount} annotation{totalCount !== 1 ? "s" : ""}
              </p>
            </div>
          </>
        )}
      </CardBody>
    </Card>
  );
}
