"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  CheckCircle2,
  ChevronRight,
  Circle,
  Clock,
  Copy,
  Diamond,
  Pause,
  Pencil,
  Plus,
  Trash2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { ScheduleTask, ScheduleTaskPatchInput, ScheduleTaskStatus } from "@/lib/api";

interface ContextMenuState {
  x: number;
  y: number;
  task: ScheduleTask;
}

interface ScheduleContextMenuProps {
  menu: ContextMenuState | null;
  onClose: () => void;
  onEdit: (task: ScheduleTask) => void;
  onDelete: (taskId: string) => void;
  onUpdate: (taskId: string, patch: ScheduleTaskPatchInput) => void;
  onDuplicate?: (task: ScheduleTask) => void;
  onCreateSibling?: (task: ScheduleTask) => void;
  onCreateChild?: (task: ScheduleTask) => void;
  onIndent?: (taskId: string) => void;
  onOutdent?: (taskId: string) => void;
  onMove?: (taskId: string, direction: "up" | "down") => void;
}

const STATUS_OPTIONS: { value: ScheduleTaskStatus; label: string; icon: typeof Circle }[] = [
  { value: "not_started", label: "Not Started", icon: Circle },
  { value: "in_progress", label: "In Progress", icon: Clock },
  { value: "on_hold", label: "On Hold", icon: Pause },
  { value: "complete", label: "Complete", icon: CheckCircle2 },
];

export type { ContextMenuState };

export function ScheduleContextMenu({
  menu,
  onClose,
  onEdit,
  onDelete,
  onUpdate,
  onDuplicate,
  onCreateSibling,
  onCreateChild,
  onIndent,
  onOutdent,
  onMove,
}: ScheduleContextMenuProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [statusOpen, setStatusOpen] = useState(false);

  useEffect(() => {
    if (!menu) return;
    const handlePointer = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) {
        onClose();
      }
    };
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("mousedown", handlePointer);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("mousedown", handlePointer);
      document.removeEventListener("keydown", handleKey);
    };
  }, [menu, onClose]);

  useEffect(() => {
    setStatusOpen(false);
  }, [menu]);

  if (!menu) return null;

  const { x, y, task } = menu;
  const menuWidth = 220;
  const menuHeight = 430;
  const clampedX = Math.min(x, window.innerWidth - menuWidth - 8);
  const clampedY = Math.min(y, window.innerHeight - menuHeight - 8);

  return (
    <div
      ref={ref}
      className="fixed z-[100] min-w-[220px] rounded-lg border border-line bg-panel py-1 text-xs shadow-xl"
      style={{ left: clampedX, top: clampedY }}
    >
      <MenuItem icon={Pencil} label="Edit Task" onClick={() => { onEdit(task); onClose(); }} />
      {onCreateSibling && <MenuItem icon={Plus} label="Add Sibling Task" onClick={() => { onCreateSibling(task); onClose(); }} />}
      {onCreateChild && <MenuItem icon={Plus} label="Add Child Task" onClick={() => { onCreateChild(task); onClose(); }} />}

      <div className="my-1 border-t border-line" />

      {onIndent && <MenuItem icon={ChevronRight} label="Indent" onClick={() => { onIndent(task.id); onClose(); }} />}
      {onOutdent && <MenuItem icon={ChevronRight} label="Outdent" iconClassName="rotate-180" onClick={() => { onOutdent(task.id); onClose(); }} />}
      {onMove && <MenuItem icon={ArrowUp} label="Move Up" onClick={() => { onMove(task.id, "up"); onClose(); }} />}
      {onMove && <MenuItem icon={ArrowDown} label="Move Down" onClick={() => { onMove(task.id, "down"); onClose(); }} />}

      <div className="my-1 border-t border-line" />

      {task.taskType !== "task" ? (
        <MenuItem
          icon={Diamond}
          label="Convert to Task"
          onClick={() => {
            onUpdate(task.id, {
              taskType: "task",
              duration: Math.max(task.duration, 1),
            });
            onClose();
          }}
        />
      ) : null}
      {task.taskType !== "milestone" ? (
        <MenuItem
          icon={Diamond}
          label="Convert to Milestone"
          onClick={() => {
            onUpdate(task.id, {
              taskType: "milestone",
              duration: 0,
              progress: 0,
              endDate: task.startDate,
            });
            onClose();
          }}
        />
      ) : null}
      {task.taskType !== "summary" ? (
        <MenuItem
          icon={Diamond}
          label="Convert to Summary Task"
          onClick={() => {
            onUpdate(task.id, {
              taskType: "summary",
              duration: Math.max(task.duration, 1),
            });
            onClose();
          }}
        />
      ) : null}

      <div className="my-1 border-t border-line" />

      <div className="relative" onMouseEnter={() => setStatusOpen(true)} onMouseLeave={() => setStatusOpen(false)}>
        <div className="flex cursor-pointer items-center gap-2 px-3 py-1.5 text-fg/70 transition-colors hover:bg-panel2/50">
          <Clock className="h-3.5 w-3.5 text-fg/40" />
          <span className="flex-1">Set Status</span>
          <ChevronRight className="h-3.5 w-3.5 text-fg/30" />
        </div>
        {statusOpen && (
          <div className="absolute left-full top-0 ml-1 min-w-[170px] rounded-lg border border-line bg-panel py-1 shadow-xl">
            {STATUS_OPTIONS.map((option) => {
              const Icon = option.icon;
              const isActive = task.status === option.value;
              return (
                <div
                  key={option.value}
                  className={cn(
                    "flex cursor-pointer items-center gap-2 px-3 py-1.5 transition-colors",
                    isActive ? "bg-accent/10 text-accent" : "text-fg/70 hover:bg-panel2/50"
                  )}
                  onClick={() => {
                    onUpdate(task.id, {
                      status: option.value,
                      ...(option.value === "complete" ? { progress: 1 } : {}),
                    });
                    onClose();
                  }}
                >
                  <Icon className="h-3.5 w-3.5" />
                  <span>{option.label}</span>
                  {isActive ? <span className="ml-auto text-[10px]">OK</span> : null}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {onDuplicate && <MenuItem icon={Copy} label="Duplicate" onClick={() => { onDuplicate(task); onClose(); }} />}

      <div className="my-1 border-t border-line" />

      <MenuItem icon={Trash2} label="Delete Task" danger onClick={() => { onDelete(task.id); onClose(); }} />
    </div>
  );
}

function MenuItem({
  icon: Icon,
  label,
  onClick,
  danger,
  iconClassName,
}: {
  icon: typeof Pencil;
  label: string;
  onClick: () => void;
  danger?: boolean;
  iconClassName?: string;
}) {
  return (
    <div
      className={cn(
        "flex cursor-pointer items-center gap-2 px-3 py-1.5 transition-colors",
        danger ? "text-danger hover:bg-danger/10" : "text-fg/70 hover:bg-panel2/50"
      )}
      onClick={onClick}
    >
      <Icon className={cn("h-3.5 w-3.5", iconClassName)} />
      <span>{label}</span>
    </div>
  );
}

export function useContextMenu() {
  const [menu, setMenu] = useState<ContextMenuState | null>(null);

  const handleContextMenu = useCallback((event: React.MouseEvent, task: ScheduleTask) => {
    event.preventDefault();
    event.stopPropagation();
    setMenu({ x: event.clientX, y: event.clientY, task });
  }, []);

  const closeMenu = useCallback(() => setMenu(null), []);

  return { menu, handleContextMenu, closeMenu };
}
