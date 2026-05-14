"use client";

import type { ReactNode } from "react";
import * as Popover from "@radix-ui/react-popover";
import {
  Calendar,
  Check,
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
  MoreHorizontal,
  Plus,
  Save,
  Settings2,
  SlidersHorizontal,
  Trash2,
  Upload,
} from "lucide-react";
import { Badge, Button } from "@/components/ui";
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
  onOpenImport: () => void;
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
  label: string;
  shortLabel: string;
}> = [
  { value: "all", label: "All Tasks", shortLabel: "All" },
  { value: "lookahead_14", label: "Next 2 Weeks", shortLabel: "2W" },
  { value: "critical", label: "Critical Path", shortLabel: "Critical" },
  { value: "overdue", label: "Late Tasks", shortLabel: "Late" },
  { value: "variance", label: "Baseline Slip", shortLabel: "Slip" },
  { value: "issues", label: "Needs Attention", shortLabel: "Issues" },
];

const ZOOM_OPTIONS: Array<{ value: ZoomLevel; label: string }> = [
  { value: "day", label: "Day" },
  { value: "week", label: "Week" },
  { value: "month", label: "Month" },
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
  onOpenImport,
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
  const activeBaseline =
    baselines.find((baseline) => baseline.id === activeBaselineId) ??
    baselines.find((baseline) => baseline.isPrimary) ??
    baselines[0] ??
    null;
  const baselineLabel = activeBaseline?.name ?? "None";
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
  const activeView = VIEW_OPTIONS.find((option) => option.value === view) ?? VIEW_OPTIONS[0];
  const activeHealth = HEALTH_OPTIONS.find((option) => option.value === quickFilter) ?? HEALTH_OPTIONS[0];

  return (
    <div className="rounded-t-lg rounded-b-none border border-line bg-panel shadow-sm" data-testid="schedule-toolbar">
      <div className="flex w-full min-w-0 flex-wrap items-center gap-1.5 px-2 py-1.5">
        <ScheduleMenu
          label={activeView.label}
          icon={activeView.icon}
          testId="schedule-view-menu"
          title="Schedule view"
        >
          {VIEW_OPTIONS.map(({ value, label, icon: Icon }) => (
            <ScheduleMenuItem
              key={value}
              icon={Icon}
              label={label}
              selected={view === value}
              onClick={() => onViewChange(value)}
              testId={`schedule-view-${value}`}
            />
          ))}
        </ScheduleMenu>

        {view === "gantt" ? (
          <ScheduleMenu
            label={`Timeline: ${ZOOM_OPTIONS.find((option) => option.value === zoomLevel)?.label ?? "Week"}`}
            icon={SlidersHorizontal}
            testId="schedule-timeline-menu"
            title="Timeline controls"
          >
            <MenuSectionLabel>Move Timeline</MenuSectionLabel>
            <div className="grid grid-cols-3 gap-1">
              <ScheduleMenuIconButton icon={ChevronLeft} label="Earlier" onClick={onScrollPrev} testId="schedule-scroll-prev" />
              <ScheduleMenuIconButton icon={Calendar} label="Today" onClick={onScrollToday} testId="schedule-scroll-today" />
              <ScheduleMenuIconButton icon={ChevronRight} label="Later" onClick={onScrollNext} testId="schedule-scroll-next" />
            </div>
            <MenuSeparator />
            <MenuSectionLabel>Zoom</MenuSectionLabel>
            <div className="grid grid-cols-[28px_1fr_28px] gap-1">
              <ScheduleMenuIconButton icon={Minus} label="Out" onClick={onZoomOut} disabled={!canZoomOut} testId="schedule-zoom-out" />
              <div className="grid grid-cols-3 gap-1">
                {ZOOM_OPTIONS.map((option) => (
                  <ScheduleMenuPill
                    key={option.value}
                    label={option.label}
                    selected={zoomLevel === option.value}
                    onClick={() => onZoomChange(option.value)}
                    testId={`schedule-zoom-${option.value}`}
                  />
                ))}
              </div>
              <ScheduleMenuIconButton icon={Plus} label="In" onClick={onZoomIn} disabled={!canZoomIn} testId="schedule-zoom-in" />
            </div>
            <MenuSeparator />
            <ScheduleMenuItem
              icon={GitBranch}
              label="Critical Path"
              selected={showCriticalPath}
              onClick={onToggleCriticalPath}
            />
          </ScheduleMenu>
        ) : null}

        <ScheduleMenu
          label={`${activeHealth.shortLabel} ${healthCounts[activeHealth.value]}`}
          icon={Filter}
          active={quickFilter !== "all"}
          testId="schedule-health-menu"
          title="Schedule health filter"
        >
          {HEALTH_OPTIONS.map((option) => (
            <ScheduleMenuItem
              key={option.value}
              icon={Filter}
              label={option.label}
              detail={`${healthCounts[option.value]} task${healthCounts[option.value] === 1 ? "" : "s"}`}
              selected={quickFilter === option.value}
              disabled={option.value === "variance" && !hasBaseline}
              onClick={() => onQuickFilterChange(option.value)}
              testId={`schedule-health-${option.value}`}
            />
          ))}
        </ScheduleMenu>

        <div className="hidden min-w-0 items-center gap-1 rounded-md bg-bg/45 p-0.5 md:flex">
          <Badge
            tone={insights.deadlineMissTaskIds.size > 0 ? "danger" : "default"}
            className="h-6 justify-center px-1.5 py-0 text-[10px]"
            title={`${insights.deadlineMissTaskIds.size} deadline misses`}
          >
            D {insights.deadlineMissTaskIds.size}
          </Badge>
          <Badge
            tone={insights.resourceConflictTaskIds.size > 0 ? "warning" : "default"}
            className="h-6 justify-center px-1.5 py-0 text-[10px]"
            title={`${insights.resourceConflictTaskIds.size} resource conflicts`}
          >
            R {insights.resourceConflictTaskIds.size}
          </Badge>
          <Badge
            tone={insights.constraintViolationTaskIds.size > 0 ? "warning" : "default"}
            className="h-6 justify-center px-1.5 py-0 text-[10px]"
            title={`${insights.constraintViolationTaskIds.size} constraint violations`}
          >
            C {insights.constraintViolationTaskIds.size}
          </Badge>
          <div className="min-w-0 rounded-md bg-panel/60 px-2 py-1 text-[10px] font-medium leading-tight text-fg/45">
            <span className="block truncate">{compactDateRange}</span>
            <span className="block truncate">
              {calendarCount}C / {resourceCount}R
            </span>
          </div>
        </div>

        <div className="min-w-0 flex-1" />

        <Button
          variant="secondary"
          size="xs"
          title="Add task"
          aria-label="Add task"
          onClick={onAddTask}
          data-testid="schedule-add-task"
          className="h-7 shrink-0 rounded-md px-2 text-[11px]"
        >
          <Calendar className="h-3.5 w-3.5 shrink-0" />
          <span className="truncate">Task</span>
        </Button>

        <ScheduleMenu
          label="Baseline"
          icon={Save}
          active={showBaseline}
          align="end"
          testId="schedule-baseline-menu"
          title={`Baseline controls. Active: ${baselineLabel}`}
        >
          <MenuSectionLabel>Active Baseline</MenuSectionLabel>
          {baselines.length === 0 ? (
            <div className="rounded-md px-2 py-2 text-[11px] text-fg/40">No baselines saved yet.</div>
          ) : (
            baselines.map((baseline) => (
              <ScheduleMenuItem
                key={baseline.id}
                icon={Save}
                label={baseline.name}
                detail={baseline.isPrimary ? "Primary" : "Snapshot"}
                selected={baseline.id === activeBaseline?.id}
                onClick={() => onActiveBaselineChange(baseline.id)}
              />
            ))
          )}
          <MenuSeparator />
          <ScheduleMenuItem icon={Save} label="Save Baseline" onClick={onSaveBaseline} testId="schedule-save-baseline" />
          <ScheduleMenuItem
            icon={showBaseline ? EyeOff : Eye}
            label={showBaseline ? "Hide Baseline" : "Show Baseline"}
            disabled={!hasBaseline}
            selected={showBaseline}
            onClick={onToggleBaseline}
            testId="schedule-toggle-baseline"
          />
          <ScheduleMenuItem
            icon={Trash2}
            label="Clear Primary Baseline"
            disabled={!hasBaseline}
            onClick={onClearBaseline}
            testId="schedule-clear-baseline"
          />
          <ScheduleMenuItem icon={Download} label="Export Schedule PDF" onClick={onExportPdf} />
        </ScheduleMenu>

        <ScheduleMenu label="More" icon={MoreHorizontal} align="end" testId="schedule-actions-menu" title="Schedule actions">
          <ScheduleMenuItem icon={Upload} label="Import Schedule" onClick={onOpenImport} />
          <ScheduleMenuItem
            icon={Filter}
            label={filtersActive ? "Hide Filters" : "Show Filters"}
            selected={filtersActive}
            onClick={onToggleFilters}
          />
          <ScheduleMenuItem icon={Settings2} label="Manage Schedule" onClick={onOpenManage} testId="schedule-manage" />
        </ScheduleMenu>
      </div>
    </div>
  );
}

type ScheduleToolbarIcon = typeof Calendar;

function ScheduleMenu({
  label,
  icon: Icon,
  active = false,
  align = "start",
  testId,
  title,
  children,
}: {
  label: string;
  icon: ScheduleToolbarIcon;
  active?: boolean;
  align?: "start" | "center" | "end";
  testId?: string;
  title?: string;
  children: ReactNode;
}) {
  return (
    <Popover.Root>
      <Popover.Trigger asChild>
        <Button
          variant={active ? "secondary" : "ghost"}
          size="xs"
          data-testid={testId}
          title={title ?? label}
          aria-label={title ?? label}
          className="h-7 min-w-0 shrink-0 gap-1.5 rounded-md px-2 text-[11px]"
        >
          <Icon className="h-3.5 w-3.5 shrink-0" />
          <span className="max-w-28 truncate">{label}</span>
          <ChevronRight className="h-3 w-3 rotate-90 text-fg/35" />
        </Button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align={align}
          sideOffset={6}
          className="z-[1000] w-56 rounded-lg border border-line bg-panel p-1.5 shadow-xl outline-none"
        >
          {children}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

function ScheduleMenuItem({
  icon: Icon,
  label,
  detail,
  selected = false,
  disabled = false,
  onClick,
  testId,
}: {
  icon: ScheduleToolbarIcon;
  label: string;
  detail?: string;
  selected?: boolean;
  disabled?: boolean;
  onClick?: () => void;
  testId?: string;
}) {
  return (
    <Popover.Close asChild>
      <button
        type="button"
        onClick={onClick}
        disabled={disabled}
        data-testid={testId}
        className={cn(
          "flex h-8 w-full items-center gap-2 rounded-md px-2 text-left text-[11px] transition-colors disabled:pointer-events-none disabled:opacity-35",
          selected ? "bg-accent/10 text-accent" : "text-fg/70 hover:bg-panel2 hover:text-fg"
        )}
      >
        <Icon className="h-3.5 w-3.5 shrink-0" />
        <span className="min-w-0 flex-1 truncate font-medium">{label}</span>
        {detail ? <span className="shrink-0 text-[10px] text-fg/35">{detail}</span> : null}
        {selected ? <Check className="h-3 w-3 shrink-0" /> : null}
      </button>
    </Popover.Close>
  );
}

function ScheduleMenuIconButton({
  icon: Icon,
  label,
  disabled = false,
  onClick,
  testId,
}: {
  icon: ScheduleToolbarIcon;
  label: string;
  disabled?: boolean;
  onClick: () => void;
  testId?: string;
}) {
  return (
    <Popover.Close asChild>
      <button
        type="button"
        title={label}
        aria-label={label}
        disabled={disabled}
        onClick={onClick}
        data-testid={testId}
        className="flex h-7 items-center justify-center rounded-md text-fg/60 transition-colors hover:bg-panel2 hover:text-fg disabled:pointer-events-none disabled:opacity-35"
      >
        <Icon className="h-3.5 w-3.5" />
      </button>
    </Popover.Close>
  );
}

function ScheduleMenuPill({
  label,
  selected,
  onClick,
  testId,
}: {
  label: string;
  selected: boolean;
  onClick: () => void;
  testId?: string;
}) {
  return (
    <Popover.Close asChild>
      <button
        type="button"
        onClick={onClick}
        data-testid={testId}
        className={cn(
          "h-7 rounded-md px-1 text-[10px] font-semibold uppercase transition-colors",
          selected ? "bg-accent/10 text-accent" : "text-fg/55 hover:bg-panel2 hover:text-fg"
        )}
      >
        {label}
      </button>
    </Popover.Close>
  );
}

function MenuSectionLabel({ children }: { children: ReactNode }) {
  return <p className="px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-fg/35">{children}</p>;
}

function MenuSeparator() {
  return <div className="my-1 h-px bg-line/70" />;
}
