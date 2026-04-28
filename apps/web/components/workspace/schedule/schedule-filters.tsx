"use client";

import { X } from "lucide-react";
import { Button, Input, Select } from "@/components/ui";
import type { ScheduleFilters } from "@/lib/schedule-utils";
import { STATUS_LABELS, emptyFilters } from "@/lib/schedule-utils";
import type { ProjectPhase, ScheduleTaskStatus } from "@/lib/api";

interface ScheduleFiltersBarProps {
  filters: ScheduleFilters;
  onChange: (f: ScheduleFilters) => void;
  phases: ProjectPhase[];
  assignees: string[];
}

export function ScheduleFiltersBar({ filters, onChange, phases, assignees }: ScheduleFiltersBarProps) {
  const hasFilters =
    filters.phaseIds.length > 0 ||
    filters.statuses.length > 0 ||
    filters.assignees.length > 0 ||
    filters.dateFrom ||
    filters.dateTo;

  return (
    <div className="flex items-center gap-3 rounded-lg border border-line bg-panel2/30 px-3 py-2 flex-wrap">
      {/* Phase filter */}
      <div className="flex items-center gap-1.5">
        <label className="text-xs text-fg/40">Phase</label>
        <Select
          value={filters.phaseIds[0] ?? "__all__"}
          onValueChange={(v) => {
            onChange({ ...filters, phaseIds: v === "__all__" ? [] : [v] });
          }}
          className="w-32"
          size="xs"
          options={[
            { value: "__all__", label: "All" },
            ...phases.map((p) => ({
              value: p.id,
              label: `${p.number ? `${p.number}. ` : ""}${p.name}`,
            })),
          ]}
        />
      </div>

      {/* Status filter */}
      <div className="flex items-center gap-1.5">
        <label className="text-xs text-fg/40">Status</label>
        <Select
          value={filters.statuses[0] ?? "__all__"}
          onValueChange={(v) => {
            onChange({ ...filters, statuses: v === "__all__" ? [] : [v as ScheduleTaskStatus] });
          }}
          className="w-32"
          size="xs"
          options={[
            { value: "__all__", label: "All" },
            ...(Object.entries(STATUS_LABELS) as [ScheduleTaskStatus, string][]).map(([k, v]) => ({
              value: k,
              label: v,
            })),
          ]}
        />
      </div>

      {/* Assignee filter */}
      {assignees.length > 0 && (
        <div className="flex items-center gap-1.5">
          <label className="text-xs text-fg/40">Assignee</label>
          <Select
            value={filters.assignees[0] ?? "__all__"}
            onValueChange={(v) => {
              onChange({ ...filters, assignees: v === "__all__" ? [] : [v] });
            }}
            className="w-32"
            size="xs"
            options={[
              { value: "__all__", label: "All" },
              ...assignees.map((a) => ({ value: a, label: a })),
            ]}
          />
        </div>
      )}

      {/* Date range */}
      <div className="flex items-center gap-1.5">
        <label className="text-xs text-fg/40">From</label>
        <Input
          type="date"
          value={filters.dateFrom ?? ""}
          onChange={(e) => onChange({ ...filters, dateFrom: e.target.value || null })}
          className="h-7 text-xs w-32"
        />
      </div>
      <div className="flex items-center gap-1.5">
        <label className="text-xs text-fg/40">To</label>
        <Input
          type="date"
          value={filters.dateTo ?? ""}
          onChange={(e) => onChange({ ...filters, dateTo: e.target.value || null })}
          className="h-7 text-xs w-32"
        />
      </div>

      {hasFilters && (
        <Button variant="ghost" size="xs" onClick={() => onChange(emptyFilters)}>
          <X className="h-3 w-3 mr-1" />
          Clear
        </Button>
      )}
    </div>
  );
}
