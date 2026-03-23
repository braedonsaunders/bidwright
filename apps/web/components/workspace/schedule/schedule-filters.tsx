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
          value={filters.phaseIds[0] ?? ""}
          onChange={(e) => {
            const val = e.target.value;
            onChange({ ...filters, phaseIds: val ? [val] : [] });
          }}
          className="h-7 text-xs w-32"
        >
          <option value="">All</option>
          {phases.map((p) => (
            <option key={p.id} value={p.id}>
              {p.number ? `${p.number}. ` : ""}{p.name}
            </option>
          ))}
        </Select>
      </div>

      {/* Status filter */}
      <div className="flex items-center gap-1.5">
        <label className="text-xs text-fg/40">Status</label>
        <Select
          value={filters.statuses[0] ?? ""}
          onChange={(e) => {
            const val = e.target.value as ScheduleTaskStatus | "";
            onChange({ ...filters, statuses: val ? [val] : [] });
          }}
          className="h-7 text-xs w-32"
        >
          <option value="">All</option>
          {(Object.entries(STATUS_LABELS) as [ScheduleTaskStatus, string][]).map(([k, v]) => (
            <option key={k} value={k}>{v}</option>
          ))}
        </Select>
      </div>

      {/* Assignee filter */}
      {assignees.length > 0 && (
        <div className="flex items-center gap-1.5">
          <label className="text-xs text-fg/40">Assignee</label>
          <Select
            value={filters.assignees[0] ?? ""}
            onChange={(e) => {
              const val = e.target.value;
              onChange({ ...filters, assignees: val ? [val] : [] });
            }}
            className="h-7 text-xs w-32"
          >
            <option value="">All</option>
            {assignees.map((a) => (
              <option key={a} value={a}>{a}</option>
            ))}
          </Select>
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
