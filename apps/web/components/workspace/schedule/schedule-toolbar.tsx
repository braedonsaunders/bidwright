"use client";

import { Calendar, ChevronLeft, ChevronRight, Download, Filter, GitBranch, LayoutGrid, List, Plus, Save } from "lucide-react";
import { Button, Separator } from "@/components/ui";
import { cn } from "@/lib/utils";
import type { ZoomLevel } from "@/lib/schedule-utils";
import { formatShortDate } from "@/lib/schedule-utils";

export type ScheduleView = "gantt" | "list" | "board";

interface ScheduleToolbarProps {
  view: ScheduleView;
  onViewChange: (v: ScheduleView) => void;
  zoomLevel: ZoomLevel;
  onZoomChange: (z: ZoomLevel) => void;
  onScrollPrev: () => void;
  onScrollToday: () => void;
  onScrollNext: () => void;
  onAddTask: () => void;
  onToggleFilters: () => void;
  filtersActive: boolean;
  showCriticalPath: boolean;
  onToggleCriticalPath: () => void;
  showBaseline: boolean;
  onToggleBaseline: () => void;
  onSaveBaseline: () => void;
  onExportPdf: () => void;
  dateStart: string | null;
  dateEnd: string | null;
}

const VIEW_OPTIONS: { value: ScheduleView; label: string; icon: typeof Calendar }[] = [
  { value: "gantt", label: "Gantt", icon: Calendar },
  { value: "list", label: "List", icon: List },
  { value: "board", label: "Board", icon: LayoutGrid },
];

export function ScheduleToolbar({
  view,
  onViewChange,
  zoomLevel,
  onZoomChange,
  onScrollPrev,
  onScrollToday,
  onScrollNext,
  onAddTask,
  onToggleFilters,
  filtersActive,
  showCriticalPath,
  onToggleCriticalPath,
  showBaseline,
  onToggleBaseline,
  onSaveBaseline,
  onExportPdf,
  dateStart,
  dateEnd,
}: ScheduleToolbarProps) {
  return (
    <div className="flex items-center gap-2 rounded-lg border border-line bg-panel px-3 py-2 flex-wrap">
      {/* View switcher */}
      <div className="flex items-center gap-0.5 rounded-md bg-bg/50 p-0.5">
        {VIEW_OPTIONS.map(({ value, label, icon: Icon }) => (
          <button
            key={value}
            onClick={() => onViewChange(value)}
            className={cn(
              "flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded transition-colors",
              view === value
                ? "bg-panel text-fg shadow-sm"
                : "text-fg/40 hover:text-fg/60"
            )}
          >
            <Icon className="h-3 w-3" />
            {label}
          </button>
        ))}
      </div>

      {view === "gantt" && (
        <>
          <Separator className="!h-6 !w-px" />

          {/* Navigation */}
          <div className="flex items-center gap-0.5">
            <Button variant="ghost" size="xs" onClick={onScrollPrev}>
              <ChevronLeft className="h-3.5 w-3.5" />
            </Button>
            <Button variant="ghost" size="xs" onClick={onScrollToday}>
              Today
            </Button>
            <Button variant="ghost" size="xs" onClick={onScrollNext}>
              <ChevronRight className="h-3.5 w-3.5" />
            </Button>
          </div>

          <Separator className="!h-6 !w-px" />

          {/* Zoom */}
          <div className="flex items-center gap-0.5 rounded-md bg-bg/50 p-0.5">
            {(["day", "week", "month"] as const).map((level) => (
              <button
                key={level}
                onClick={() => onZoomChange(level)}
                className={cn(
                  "px-2.5 py-1 text-xs font-medium rounded transition-colors",
                  zoomLevel === level
                    ? "bg-panel text-fg shadow-sm"
                    : "text-fg/40 hover:text-fg/60"
                )}
              >
                {level.charAt(0).toUpperCase() + level.slice(1)}
              </button>
            ))}
          </div>
        </>
      )}

      <Separator className="!h-6 !w-px" />

      {/* Actions */}
      <Button variant="ghost" size="xs" onClick={onAddTask}>
        <Plus className="h-3.5 w-3.5 mr-1" />
        Task
      </Button>

      <Button
        variant="ghost"
        size="xs"
        onClick={onToggleFilters}
        className={cn(filtersActive && "text-accent")}
      >
        <Filter className="h-3.5 w-3.5 mr-1" />
        Filter
      </Button>

      {view === "gantt" && (
        <Button
          variant="ghost"
          size="xs"
          onClick={onToggleCriticalPath}
          className={cn(showCriticalPath && "text-accent")}
        >
          <GitBranch className="h-3.5 w-3.5 mr-1" />
          Critical Path
        </Button>
      )}

      <div className="flex-1" />

      {/* Baseline */}
      <Button variant="ghost" size="xs" onClick={onSaveBaseline}>
        <Save className="h-3.5 w-3.5 mr-1" />
        Save Baseline
      </Button>
      <button
        onClick={onToggleBaseline}
        className={cn(
          "px-2 py-1 text-xs rounded transition-colors",
          showBaseline ? "bg-accent/10 text-accent font-medium" : "text-fg/40 hover:text-fg/60"
        )}
      >
        Baseline
      </button>

      <Separator className="!h-6 !w-px" />

      <Button variant="ghost" size="xs" onClick={onExportPdf}>
        <Download className="h-3.5 w-3.5 mr-1" />
        PDF
      </Button>

      {/* Date range */}
      <div className="flex items-center gap-2 text-xs text-fg/40">
        <Calendar className="h-3.5 w-3.5" />
        <span>
          {dateStart ? formatShortDate(new Date(dateStart)) : "TBD"}
          {" \u2014 "}
          {dateEnd ? formatShortDate(new Date(dateEnd)) : "TBD"}
        </span>
      </div>
    </div>
  );
}
