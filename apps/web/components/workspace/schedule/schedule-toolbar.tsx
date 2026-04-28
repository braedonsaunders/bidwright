"use client";

import * as Popover from "@radix-ui/react-popover";
import {
  Calendar,
  ChevronLeft,
  ChevronRight,
  Download,
  Eye,
  EyeOff,
  Filter,
  GitBranch,
  LayoutGrid,
  List,
  Minus,
  Plus,
  Save,
  Settings2,
  Trash2,
} from "lucide-react";
import { Badge, Button, CompactSelect, Select } from "@/components/ui";
import { cn } from "@/lib/utils";
import type { ScheduleBaseline } from "@/lib/api";
import type { ScheduleInsights, ScheduleQuickFilter, ZoomLevel } from "@/lib/schedule-utils";
import { parseDate } from "@/lib/schedule-utils";

export type ScheduleView = "gantt" | "list" | "board";

interface ScheduleToolbarProps {
  view: ScheduleView;
  onViewChange: (v: ScheduleView) => void;
  zoomLevel: ZoomLevel;
  onZoomChange: (z: ZoomLevel) => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
  canZoomIn: boolean;
  canZoomOut: boolean;
  onScrollPrev: () => void;
  onScrollToday: () => void;
  onScrollNext: () => void;
  onAddTask: () => void;
  onToggleFilters: () => void;
  filtersActive: boolean;
  insights: ScheduleInsights;
  quickFilter: ScheduleQuickFilter;
  onQuickFilterChange: (filter: ScheduleQuickFilter) => void;
  showCriticalPath: boolean;
  onToggleCriticalPath: () => void;
  showBaseline: boolean;
  onToggleBaseline: () => void;
  hasBaseline: boolean;
  onSaveBaseline: () => void;
  onClearBaseline: () => void;
  baselines: ScheduleBaseline[];
  activeBaselineId: string;
  onActiveBaselineChange: (baselineId: string) => void;
  onOpenManage: () => void;
  calendarCount: number;
  resourceCount: number;
  onExportPdf: () => void;
  dateStart: string | null;
  dateEnd: string | null;
}

const VIEW_OPTIONS: Array<{
  value: ScheduleView;
  label: string;
  icon: typeof Calendar;
}> = [
  { value: "gantt", label: "Gantt", icon: Calendar },
  { value: "list", label: "List", icon: List },
  { value: "board", label: "Board", icon: LayoutGrid },
];

const HEALTH_OPTIONS: Array<{
  value: ScheduleQuickFilter;
  shortLabel: string;
}> = [
  { value: "all", shortLabel: "All" },
  { value: "lookahead_14", shortLabel: "2W" },
  { value: "critical", shortLabel: "Critical" },
  { value: "overdue", shortLabel: "Late" },
  { value: "variance", shortLabel: "Slip" },
  { value: "issues", shortLabel: "Issues" },
];

function formatCompactDate(date: Date | null) {
  if (!date) return "TBD";
  return date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

export function ScheduleToolbar({
  view,
  onViewChange,
  zoomLevel,
  onZoomChange,
  onZoomIn,
  onZoomOut,
  canZoomIn,
  canZoomOut,
  onScrollPrev,
  onScrollToday,
  onScrollNext,
  onAddTask,
  onToggleFilters,
  filtersActive,
  insights,
  quickFilter,
  onQuickFilterChange,
  showCriticalPath,
  onToggleCriticalPath,
  showBaseline,
  onToggleBaseline,
  hasBaseline,
  onSaveBaseline,
  onClearBaseline,
  baselines,
  activeBaselineId,
  onActiveBaselineChange,
  onOpenManage,
  calendarCount,
  resourceCount,
  onExportPdf,
  dateStart,
  dateEnd,
}: ScheduleToolbarProps) {
  const parsedStart = parseDate(dateStart);
  const parsedEnd = parseDate(dateEnd);
  const activeBaseline = baselines.find((baseline) => baseline.id === activeBaselineId) ?? null;
  const baselineLabel = activeBaseline?.name ?? (hasBaseline ? "Primary" : "None");
  const compactDateRange = `${formatCompactDate(parsedStart)}-${formatCompactDate(parsedEnd)}`;
  const healthCounts: Record<ScheduleQuickFilter, number> = {
    all: insights.totalTasks,
    lookahead_14: insights.lookahead14TaskIds.size,
    lookahead_28: insights.lookahead28TaskIds.size,
    critical: insights.criticalTaskIds.size,
    overdue: insights.overdueTaskIds.size,
    variance: insights.behindBaselineTaskIds.size,
    issues: insights.attentionTaskIds.size,
  };

  return (
    <div className="rounded-t-lg rounded-b-none border border-line bg-panel shadow-sm" data-testid="schedule-toolbar">
      <div className="grid w-full min-w-0 grid-cols-5 items-center gap-1 px-1 py-1">
        <div className="grid min-w-0 grid-cols-3 gap-1 rounded-md bg-bg/45 p-0.5">
          {VIEW_OPTIONS.map(({ value, label, icon: Icon }) => (
            <button
              key={value}
              type="button"
              title={label}
              aria-label={label}
              onClick={() => onViewChange(value)}
              data-testid={`schedule-view-${value}`}
              className={cn(
                "flex h-6 min-w-0 items-center justify-center gap-1 rounded-md px-1.5 text-[10px] font-semibold transition-colors",
                view === value ? "bg-panel text-fg shadow-sm" : "text-fg/45 hover:bg-panel/70 hover:text-fg/70"
              )}
            >
              <Icon className="h-3.5 w-3.5 shrink-0" />
              <span className="truncate">{label}</span>
            </button>
          ))}
        </div>

        <div className="min-w-0 rounded-md bg-bg/45 p-0.5">
          {view === "gantt" ? (
            <div className="grid grid-cols-8 gap-1">
              <Button
                variant="ghost"
                size="xs"
                title="Scroll earlier"
                aria-label="Scroll earlier"
                onClick={onScrollPrev}
                data-testid="schedule-scroll-prev"
                className="h-6 w-full rounded-md px-0 text-[10px]"
              >
                <ChevronLeft className="h-3.5 w-3.5" />
              </Button>
              <Button
                variant="ghost"
                size="xs"
                title="Jump to today"
                aria-label="Jump to today"
                onClick={onScrollToday}
                data-testid="schedule-scroll-today"
                className="h-6 w-full rounded-md px-0 text-[10px]"
              >
                <Calendar className="h-3.5 w-3.5" />
              </Button>
              <Button
                variant="ghost"
                size="xs"
                title="Scroll later"
                aria-label="Scroll later"
                onClick={onScrollNext}
                data-testid="schedule-scroll-next"
                className="h-6 w-full rounded-md px-0 text-[10px]"
              >
                <ChevronRight className="h-3.5 w-3.5" />
              </Button>
              <Button
                variant="ghost"
                size="xs"
                title="Zoom out"
                aria-label="Zoom out"
                onClick={onZoomOut}
                disabled={!canZoomOut}
                data-testid="schedule-zoom-out"
                className="h-6 w-full rounded-md px-0 text-[10px]"
              >
                <Minus className="h-3.5 w-3.5" />
              </Button>
              {(["day", "week", "month"] as const).map((level) => (
                <button
                  key={level}
                  type="button"
                  title={`Zoom ${level}`}
                  onClick={() => onZoomChange(level)}
                  data-testid={`schedule-zoom-${level}`}
                  className={cn(
                    "h-6 rounded-md px-0 text-[10px] font-semibold uppercase transition-colors",
                    zoomLevel === level ? "bg-panel text-fg shadow-sm" : "text-fg/45 hover:bg-panel/70 hover:text-fg/70"
                  )}
                >
                  {level.charAt(0)}
                </button>
              ))}
              <Button
                variant="ghost"
                size="xs"
                title="Zoom in"
                aria-label="Zoom in"
                onClick={onZoomIn}
                disabled={!canZoomIn}
                data-testid="schedule-zoom-in"
                className="h-6 w-full rounded-md px-0 text-[10px]"
              >
                <Plus className="h-3.5 w-3.5" />
              </Button>
            </div>
          ) : (
            <div className="flex h-6 items-center justify-between rounded-md bg-panel/60 px-2 text-[10px] text-fg/50">
              <span className="font-medium text-fg/65">{view === "list" ? "List Mode" : "Board Mode"}</span>
              <span>{insights.totalTasks} tasks</span>
            </div>
          )}
        </div>

        <div className="grid min-w-0 grid-cols-3 gap-1 rounded-md bg-bg/45 p-0.5">
          <Button
            variant="secondary"
            size="xs"
            title="Add task"
            aria-label="Add task"
            onClick={onAddTask}
            data-testid="schedule-add-task"
            className="h-6 w-full rounded-md px-1.5 text-[10px]"
          >
            <Calendar className="h-3.5 w-3.5" />
            Task
          </Button>
          <Button
            variant="ghost"
            size="xs"
            title="Toggle filters"
            aria-label="Toggle filters"
            onClick={onToggleFilters}
            className={cn("h-6 w-full rounded-md px-1.5 text-[10px]", filtersActive && "text-accent")}
          >
            <Filter className="h-3.5 w-3.5" />
            Filter
          </Button>
          {view === "gantt" ? (
            <Button
              variant="ghost"
              size="xs"
              title="Toggle critical path"
              aria-label="Toggle critical path"
              onClick={onToggleCriticalPath}
              className={cn("h-6 w-full rounded-md px-1.5 text-[10px]", showCriticalPath && "text-accent")}
            >
              <GitBranch className="h-3.5 w-3.5" />
              Path
            </Button>
          ) : (
            <Button
              variant="ghost"
              size="xs"
              title={showBaseline ? "Hide baseline" : "Show baseline"}
              aria-label={showBaseline ? "Hide baseline" : "Show baseline"}
              onClick={onToggleBaseline}
              disabled={!hasBaseline}
              data-testid="schedule-toggle-baseline"
              className={cn("h-6 w-full rounded-md px-1.5 text-[10px]", showBaseline && "text-accent")}
            >
              {showBaseline ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
              Base
            </Button>
          )}
        </div>

        <div className="flex min-w-0 items-center gap-1 rounded-md bg-bg/45 p-0.5">
          <CompactSelect
            value={quickFilter}
            onValueChange={(value) => onQuickFilterChange(value as ScheduleQuickFilter)}
            options={HEALTH_OPTIONS.map((option) => ({
              value: option.value,
              label: `${option.shortLabel} ${healthCounts[option.value]}`,
              disabled: option.value === "variance" && !hasBaseline,
            }))}
            className="h-6 min-w-0 flex-[1.4] text-[10px]"
            data-testid="schedule-health-select"
            title="Schedule health filter"
            aria-label="Schedule health filter"
          />
          <Badge
            tone={insights.deadlineMissTaskIds.size > 0 ? "danger" : "default"}
            className="h-6 min-w-0 flex-1 justify-center px-1 py-0 text-[10px]"
            title={`${insights.deadlineMissTaskIds.size} deadline misses`}
          >
            D {insights.deadlineMissTaskIds.size}
          </Badge>
          <Badge
            tone={insights.resourceConflictTaskIds.size > 0 ? "warning" : "default"}
            className="h-6 min-w-0 flex-1 justify-center px-1 py-0 text-[10px]"
            title={`${insights.resourceConflictTaskIds.size} resource conflicts`}
          >
            R {insights.resourceConflictTaskIds.size}
          </Badge>
          <Badge
            tone={insights.constraintViolationTaskIds.size > 0 ? "warning" : "default"}
            className="h-6 min-w-0 flex-1 justify-center px-1 py-0 text-[10px]"
            title={`${insights.constraintViolationTaskIds.size} constraint violations`}
          >
            C {insights.constraintViolationTaskIds.size}
          </Badge>
        </div>

        <div className="flex min-w-0 items-center gap-1 rounded-md bg-bg/45 p-0.5">
          <Popover.Root>
            <Popover.Trigger asChild>
              <Button
                variant="ghost"
                size="xs"
                className="h-6 min-w-0 flex-[0.95] rounded-md px-1.5 text-[10px]"
                title={`Baseline controls. Active: ${baselineLabel}`}
                aria-label={`Baseline controls. Active: ${baselineLabel}`}
              >
                <Save className="h-3.5 w-3.5" />
                <span className="truncate">Baseline</span>
              </Button>
            </Popover.Trigger>
            <Popover.Portal>
              <Popover.Content
                sideOffset={6}
                align="end"
                className="z-50 w-72 rounded-xl border border-line bg-panel p-3 shadow-xl"
              >
                <div className="space-y-3">
                  <div>
                    <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-fg/35">Baseline</p>
                    <p className="mt-1 text-xs text-fg/55">
                      Active: <span className="font-medium text-fg/75">{baselineLabel}</span>
                    </p>
                  </div>

                  <div>
                    <Select
                      data-testid="schedule-baseline-select"
                      value={activeBaselineId || "__none__"}
                      onValueChange={(v) => onActiveBaselineChange(v === "__none__" ? "" : v)}
                      disabled={baselines.length === 0}
                      className="h-8 text-xs"
                      size="sm"
                      options={[
                        { value: "__none__", label: "No Baseline" },
                        ...baselines.map((baseline) => ({
                          value: baseline.id,
                          label: `${baseline.isPrimary ? "[Primary] " : ""}${baseline.name}`,
                        })),
                      ]}
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <Button variant="secondary" size="xs" onClick={onSaveBaseline} data-testid="schedule-save-baseline">
                      <Save className="h-3.5 w-3.5" />
                      Save
                    </Button>
                    <Button
                      variant="secondary"
                      size="xs"
                      onClick={onClearBaseline}
                      disabled={!hasBaseline}
                      data-testid="schedule-clear-baseline"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                      Clear
                    </Button>
                    <Button
                      variant="secondary"
                      size="xs"
                      onClick={onToggleBaseline}
                      disabled={!hasBaseline}
                      data-testid="schedule-toggle-baseline"
                    >
                      {showBaseline ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                      {showBaseline ? "Hide" : "Show"}
                    </Button>
                    <Button variant="secondary" size="xs" onClick={onExportPdf}>
                      <Download className="h-3.5 w-3.5" />
                      PDF
                    </Button>
                  </div>
                </div>
              </Popover.Content>
            </Popover.Portal>
          </Popover.Root>

          <Button
            variant="ghost"
            size="xs"
            onClick={onOpenManage}
            data-testid="schedule-manage"
            title="Manage schedule calendars, resources, and baselines"
            aria-label="Manage schedule calendars, resources, and baselines"
            className="h-6 min-w-0 flex-[0.95] rounded-md px-1.5 text-[10px]"
          >
            <Settings2 className="h-3.5 w-3.5" />
            Control
          </Button>

          <div className="min-w-0 flex-[1.2] rounded-md bg-panel/60 px-2 py-1 text-center text-[10px] font-medium leading-tight text-fg/45">
            <span className="block truncate">{compactDateRange}</span>
            <span className="block truncate">
              {calendarCount}C / {resourceCount}R
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
