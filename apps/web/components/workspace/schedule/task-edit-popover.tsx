"use client";

import { useState, useEffect } from "react";
import { X, Trash2 } from "lucide-react";
import { Button, Input, Select, Label } from "@/components/ui";
import type { ScheduleTask, ScheduleTaskPatchInput, ProjectPhase } from "@/lib/api";
import { STATUS_LABELS } from "@/lib/schedule-utils";
import type { ScheduleTaskStatus, ScheduleTaskType } from "@/lib/api";

interface TaskEditPopoverProps {
  task: ScheduleTask;
  phases: ProjectPhase[];
  onSave: (taskId: string, patch: ScheduleTaskPatchInput) => void;
  onDelete: (taskId: string) => void;
  onClose: () => void;
}

export function TaskEditPopover({ task, phases, onSave, onDelete, onClose }: TaskEditPopoverProps) {
  const [name, setName] = useState(task.name);
  const [description, setDescription] = useState(task.description);
  const [taskType, setTaskType] = useState<ScheduleTaskType>(task.taskType);
  const [status, setStatus] = useState<ScheduleTaskStatus>(task.status);
  const [startDate, setStartDate] = useState(task.startDate?.slice(0, 10) ?? "");
  const [endDate, setEndDate] = useState(task.endDate?.slice(0, 10) ?? "");
  const [progress, setProgress] = useState(task.progress);
  const [assignee, setAssignee] = useState(task.assignee);
  const [phaseId, setPhaseId] = useState(task.phaseId ?? "");

  const handleSave = () => {
    const duration = startDate && endDate
      ? Math.max(0, Math.round((new Date(endDate).getTime() - new Date(startDate).getTime()) / 86400000))
      : task.duration;

    onSave(task.id, {
      name,
      description,
      taskType,
      status,
      startDate: startDate || null,
      endDate: endDate || null,
      duration,
      progress,
      assignee,
      phaseId: phaseId || null,
    });
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/20" onClick={onClose} />
      <div className="relative bg-panel rounded-xl border border-line shadow-xl w-full max-w-md p-5 space-y-4">
        {/* Header */}
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-fg">Edit Task</h3>
          <button onClick={onClose} className="text-fg/40 hover:text-fg transition-colors">
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Name */}
        <div className="space-y-1.5">
          <Label>Name</Label>
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Task name" />
        </div>

        {/* Type + Status */}
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label>Type</Label>
            <Select value={taskType} onChange={(e) => setTaskType(e.target.value as ScheduleTaskType)}>
              <option value="task">Task</option>
              <option value="milestone">Milestone</option>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Status</Label>
            <Select value={status} onChange={(e) => setStatus(e.target.value as ScheduleTaskStatus)}>
              {(Object.entries(STATUS_LABELS) as [ScheduleTaskStatus, string][]).map(([k, v]) => (
                <option key={k} value={k}>{v}</option>
              ))}
            </Select>
          </div>
        </div>

        {/* Phase */}
        <div className="space-y-1.5">
          <Label>Phase</Label>
          <Select value={phaseId} onChange={(e) => setPhaseId(e.target.value)}>
            <option value="">No Phase</option>
            {phases.map((p) => (
              <option key={p.id} value={p.id}>
                {p.number ? `${p.number}. ` : ""}{p.name}
              </option>
            ))}
          </Select>
        </div>

        {/* Dates */}
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label>Start Date</Label>
            <Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>End Date</Label>
            <Input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
          </div>
        </div>

        {/* Progress */}
        <div className="space-y-1.5">
          <Label>Progress ({Math.round(progress * 100)}%)</Label>
          <input
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={progress}
            onChange={(e) => setProgress(parseFloat(e.target.value))}
            className="w-full h-1.5 rounded-full appearance-none bg-line cursor-pointer accent-accent"
          />
        </div>

        {/* Assignee */}
        <div className="space-y-1.5">
          <Label>Assignee</Label>
          <Input value={assignee} onChange={(e) => setAssignee(e.target.value)} placeholder="Assignee name" />
        </div>

        {/* Description */}
        <div className="space-y-1.5">
          <Label>Description</Label>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Task description..."
            rows={2}
            className="w-full rounded-lg border border-line bg-bg px-3 py-2 text-sm text-fg placeholder:text-fg/30 focus:outline-none focus:ring-2 focus:ring-accent/50"
          />
        </div>

        {/* Actions */}
        <div className="flex items-center gap-2 pt-2">
          <Button variant="danger" size="sm" onClick={() => { onDelete(task.id); onClose(); }}>
            <Trash2 className="h-3.5 w-3.5 mr-1" />
            Delete
          </Button>
          <div className="flex-1" />
          <Button variant="ghost" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="accent" size="sm" onClick={handleSave}>
            Save
          </Button>
        </div>
      </div>
    </div>
  );
}
