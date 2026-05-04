"use client";

import { Boxes, ChevronRight, Factory, Hammer, Package, Truck } from "lucide-react";
import { Badge, Card, CardBody, CardHeader, CardTitle, EmptyState } from "@/components/ui";
import { formatMoney } from "@/lib/format";
import { cn } from "@/lib/utils";

export type ResourceSummaryType = "labour" | "material" | "equipment" | "subcontract" | "travel" | "other";

export interface ResourceSummaryPosition {
  id: string;
  resourceId: string;
  resourceName: string;
  code?: string;
  type: ResourceSummaryType | string;
  unit?: string;
  quantity: number;
  totalCost: number;
  averageUnitRate?: number;
  hoursUnit1?: number;
  hoursUnit2?: number;
  hoursUnit3?: number;
  totalHours?: number;
  positionCount?: number;
  worksheetId?: string;
  worksheetLabel?: string;
  itemId?: string;
  itemLabel?: string;
  phaseId?: string | null;
  phaseLabel?: string;
  categoryId?: string | null;
  categoryLabel?: string;
  vendorLabel?: string;
  sourceLabel?: string;
  variantLabel?: string;
  confidence?: number;
}

export interface ResourceSummaryRow {
  id: string;
  name: string;
  type: ResourceSummaryType | string;
  code?: string;
  unit?: string;
  totalQuantity: number;
  totalCost: number;
  averageUnitRate?: number;
  hoursUnit1?: number;
  hoursUnit2?: number;
  hoursUnit3?: number;
  totalHours?: number;
  positionCount?: number;
  sourceLabel?: string;
  confidence?: number;
  variantLabel?: string;
  phaseLabel?: string;
  categoryLabel?: string;
  vendorLabel?: string;
  worksheetLabel?: string;
  positions?: ResourceSummaryPosition[];
}

export interface ResourceSummaryPanelProps {
  resources: ResourceSummaryRow[];
  loading?: boolean;
  className?: string;
  onSelectResource?: (resource: ResourceSummaryRow) => void;
}

const typeMeta: Record<
  string,
  {
    label: string;
    tone: "default" | "success" | "warning" | "danger" | "info";
    icon: typeof Hammer;
  }
> = {
  labour: { label: "Labour", tone: "info", icon: Hammer },
  material: { label: "Material", tone: "success", icon: Package },
  equipment: { label: "Equipment", tone: "warning", icon: Truck },
  subcontract: { label: "Subcontract", tone: "default", icon: Factory },
  travel: { label: "Travel", tone: "default", icon: Truck },
  other: { label: "Other", tone: "default", icon: Boxes },
};

function normalizedType(type: string) {
  const key = type
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  if (key === "labor" || key === "labour") return "labour";
  if (key === "materials") return "material";
  if (key === "subcontractor" || key === "subcontractors") return "subcontract";
  return key || "uncategorized";
}

function titleCaseLabel(value: string) {
  return value
    .trim()
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function typeLabel(type: string) {
  const key = normalizedType(type);
  return typeMeta[key]?.label ?? titleCaseLabel(type || key);
}

function formatNumber(value: number, maximumFractionDigits = 2) {
  return new Intl.NumberFormat("en-US", { maximumFractionDigits }).format(Number.isFinite(value) ? value : 0);
}

function formatCurrency(value: number) {
  return formatMoney(Number.isFinite(value) ? value : 0, 2);
}

function groupByType(resources: ResourceSummaryRow[]) {
  const groups = new Map<string, { type: string; label: string; total: number; rows: ResourceSummaryRow[] }>();
  for (const resource of resources) {
    const type = normalizedType(resource.type);
    const existing = groups.get(type) ?? { type, label: typeLabel(resource.type), total: 0, rows: [] };
    existing.total += Number(resource.totalCost) || 0;
    existing.rows.push(resource);
    groups.set(type, existing);
  }
  return Array.from(groups.values())
    .map((group) => ({
      ...group,
      rows: group.rows.slice().sort((left, right) => (right.totalCost || 0) - (left.totalCost || 0)),
    }))
    .sort((left, right) => right.total - left.total);
}

export function ResourceSummaryPanel({
  resources,
  loading = false,
  className,
  onSelectResource,
}: ResourceSummaryPanelProps) {
  const groups = groupByType(resources);
  const totalCost = resources.reduce((sum, resource) => sum + (Number(resource.totalCost) || 0), 0);
  const totalPositions = resources.reduce((sum, resource) => sum + (resource.positionCount ?? 0), 0);
  const resourceCountLabel = `${resources.length} resource${resources.length === 1 ? "" : "s"}`;

  return (
    <Card className={cn("overflow-hidden", className)}>
      <CardHeader className="flex flex-row items-start justify-between gap-3">
        <div>
          <CardTitle className="flex items-center gap-2">
            <Boxes className="h-4 w-4 text-accent" />
            Resource Summary
          </CardTitle>
          <p className="mt-1 text-xs text-fg/50">Resource composition by configured estimate category.</p>
        </div>
        <Badge tone="info">{loading ? "Loading" : resourceCountLabel}</Badge>
      </CardHeader>

      <CardBody className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <div className="rounded-lg border border-line bg-bg/35 p-3">
            <div className="text-[11px] font-medium uppercase tracking-wide text-fg/45">Total Resource Cost</div>
            <div className="mt-1 text-lg font-semibold tabular-nums text-fg">{loading ? "--" : formatCurrency(totalCost)}</div>
          </div>
          <div className="rounded-lg border border-line bg-bg/35 p-3">
            <div className="text-[11px] font-medium uppercase tracking-wide text-fg/45">Referenced Positions</div>
            <div className="mt-1 text-lg font-semibold tabular-nums text-fg">{loading ? "--" : formatNumber(totalPositions, 0)}</div>
          </div>
        </div>

        {loading ? (
          <EmptyState className="py-6">Loading resource composition...</EmptyState>
        ) : groups.length === 0 ? (
          <EmptyState className="py-6">No resource composition has been captured yet.</EmptyState>
        ) : (
          <div className="space-y-4">
            {groups.map((group) => {
              const meta = typeMeta[group.type] ?? { label: group.label, tone: "default" as const, icon: Boxes };
              const Icon = meta.icon;
              return (
                <section key={group.type} className="space-y-2">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-1.5 text-xs font-semibold text-fg/75">
                      <Icon className="h-3.5 w-3.5" />
                      {meta.label}
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-xs font-semibold text-fg">{formatCurrency(group.total)}</span>
                      <Badge tone={meta.tone}>{group.rows.length}</Badge>
                    </div>
                  </div>
                  <div className="overflow-hidden rounded-lg border border-line">
                    {group.rows.map((resource, index) => {
                      const clickable = !!onSelectResource;
                      const rowClassName = cn(
                        "grid w-full grid-cols-[minmax(0,1fr)_auto] gap-3 bg-panel px-3 py-2 text-left transition-colors",
                        index > 0 && "border-t border-line",
                        clickable && "hover:bg-panel2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent/35",
                      );
                      const rowContent = (
                        <>
                          <div className="min-w-0">
                            <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                              <span className="truncate text-sm font-medium text-fg">{resource.name}</span>
                              {resource.code ? <span className="font-mono text-[10px] text-fg/35">{resource.code}</span> : null}
                              {resource.sourceLabel ? <Badge>{resource.sourceLabel}</Badge> : null}
                              {resource.variantLabel ? <Badge tone="info">{resource.variantLabel}</Badge> : null}
                            </div>
                            <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-fg/50">
                              <span>
                                Qty <span className="font-mono text-fg/65">{formatNumber(resource.totalQuantity)}</span>
                                {resource.unit ? ` ${resource.unit}` : ""}
                              </span>
                              {resource.averageUnitRate !== undefined ? (
                                <span>Avg {formatCurrency(resource.averageUnitRate)}</span>
                              ) : null}
                              {resource.positionCount !== undefined ? (
                                <span>{formatNumber(resource.positionCount, 0)} position{resource.positionCount === 1 ? "" : "s"}</span>
                              ) : null}
                            </div>
                          </div>
                          <div className="flex items-center gap-2">
                            <span className="font-mono text-sm font-semibold text-fg">{formatCurrency(resource.totalCost)}</span>
                            {clickable ? <ChevronRight className="h-3.5 w-3.5 text-fg/35" /> : null}
                          </div>
                        </>
                      );

                      return (
                        clickable ? (
                          <button
                            key={resource.id}
                            type="button"
                            onClick={() => onSelectResource?.(resource)}
                            className={rowClassName}
                          >
                            {rowContent}
                          </button>
                        ) : (
                          <div key={resource.id} className={rowClassName}>
                            {rowContent}
                          </div>
                        )
                      );
                    })}
                  </div>
                </section>
              );
            })}
          </div>
        )}
      </CardBody>
    </Card>
  );
}
