"use client";

import { useEffect, useRef, useCallback, useState } from "react";
import { Pencil, Trash2, Copy, ArrowUp, ArrowDown, CheckCircle2, Clock, Pause, Circle } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ScheduleTask, ScheduleTaskPatchInput } from "@/lib/api";
import type { ScheduleTaskStatus } from "@/lib/api";

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
}: ScheduleContextMenuProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [statusOpen, setStatusOpen] = useState(false);

  useEffect(() => {
    if (!menu) return;
    const handle = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        onClose();
      }
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("mousedown", handle);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("mousedown", handle);
      document.removeEventListener("keydown", handleKey);
    };
  }, [menu, onClose]);

  // Reset submenu when menu changes
  useEffect(() => {
    setStatusOpen(false);
  }, [menu]);

  if (!menu) return null;

  const { x, y, task } = menu;

  // Clamp position to viewport
  const menuWidth = 200;
  const menuHeight = 260;
  const clampedX = Math.min(x, window.innerWidth - menuWidth - 8);
  const clampedY = Math.min(y, window.innerHeight - menuHeight - 8);

  return (
    <div
      ref={ref}
      className="fixed z-[100] min-w-[180px] rounded-lg border border-line bg-panel shadow-xl py-1 text-xs animate-in fade-in zoom-in-95 duration-100"
      style={{ left: clampedX, top: clampedY }}
    >
      {/* Edit */}
      <MenuItem
        icon={Pencil}
        label="Edit Task"
        onClick={() => { onEdit(task); onClose(); }}
      />

      {/* Status submenu */}
      <div
        className="relative"
        onMouseEnter={() => setStatusOpen(true)}
        onMouseLeave={() => setStatusOpen(false)}
      >
        <div className="flex items-center gap-2 px-3 py-1.5 hover:bg-panel2/50 cursor-pointer transition-colors text-fg/70">
          <ArrowUp className="h-3.5 w-3.5 text-fg/40" />
          <span className="flex-1">Set Status</span>
          <span className="text-fg/30 text-[10px]">▸</span>
        </div>
        {statusOpen && (
          <div className="absolute left-full top-0 ml-1 min-w-[160px] rounded-lg border border-line bg-panel shadow-xl py-1 animate-in fade-in zoom-in-95 duration-75">
            {STATUS_OPTIONS.map((opt) => {
              const Icon = opt.icon;
              const isActive = task.status === opt.value;
              return (
                <div
                  key={opt.value}
                  className={cn(
                    "flex items-center gap-2 px-3 py-1.5 cursor-pointer transition-colors",
                    isActive ? "bg-accent/10 text-accent" : "text-fg/70 hover:bg-panel2/50"
                  )}
                  onClick={() => {
                    onUpdate(task.id, {
                      status: opt.value,
                      ...(opt.value === "complete" ? { progress: 1 } : {}),
                    });
                    onClose();
                  }}
                >
                  <Icon className="h-3.5 w-3.5" />
                  <span>{opt.label}</span>
                  {isActive && <span className="ml-auto text-[10px]">✓</span>}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Duplicate */}
      {onDuplicate && (
        <MenuItem
          icon={Copy}
          label="Duplicate"
          onClick={() => { onDuplicate(task); onClose(); }}
        />
      )}

      {/* Separator */}
      <div className="my-1 border-t border-line" />

      {/* Delete */}
      <MenuItem
        icon={Trash2}
        label="Delete Task"
        danger
        onClick={() => { onDelete(task.id); onClose(); }}
      />
    </div>
  );
}

function MenuItem({
  icon: Icon,
  label,
  onClick,
  danger,
}: {
  icon: typeof Pencil;
  label: string;
  onClick: () => void;
  danger?: boolean;
}) {
  return (
    <div
      className={cn(
        "flex items-center gap-2 px-3 py-1.5 cursor-pointer transition-colors",
        danger
          ? "text-danger hover:bg-danger/10"
          : "text-fg/70 hover:bg-panel2/50"
      )}
      onClick={onClick}
    >
      <Icon className="h-3.5 w-3.5" />
      <span>{label}</span>
    </div>
  );
}

/**
 * Hook to manage context menu state.
 */
export function useContextMenu() {
  const [menu, setMenu] = useState<ContextMenuState | null>(null);

  const handleContextMenu = useCallback(
    (e: React.MouseEvent, task: ScheduleTask) => {
      e.preventDefault();
      e.stopPropagation();
      setMenu({ x: e.clientX, y: e.clientY, task });
    },
    []
  );

  const closeMenu = useCallback(() => setMenu(null), []);

  return { menu, handleContextMenu, closeMenu };
}
