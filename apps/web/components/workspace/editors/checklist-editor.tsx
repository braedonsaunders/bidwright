"use client";

import { useState, useCallback } from "react";
import {
  Save,
  X,
  Plus,
  Trash2,
  GripVertical,
  ChevronDown,
  ChevronRight,
  CheckCircle2,
  Circle,
} from "lucide-react";
import { Button } from "@/components/ui";
import { cn } from "@/lib/utils";

/* ─── Types ─── */

interface ChecklistItem {
  id: string;
  text: string;
  checked: boolean;
  notes: string;
  priority: "low" | "normal" | "high" | "critical";
  assignee: string;
  dueDate: string;
}

interface ChecklistSection {
  id: string;
  title: string;
  collapsed: boolean;
  items: ChecklistItem[];
}

interface ChecklistData {
  title: string;
  sections: ChecklistSection[];
  createdAt: string;
  updatedAt: string;
}

interface ChecklistEditorProps {
  fileName: string;
  onSave?: (data: string) => void;
  onClose?: () => void;
}

/* ─── Helpers ─── */

function newId(): string {
  return crypto.randomUUID().slice(0, 8);
}

function newItem(): ChecklistItem {
  return { id: newId(), text: "", checked: false, notes: "", priority: "normal", assignee: "", dueDate: "" };
}

function newSection(title = "New Section"): ChecklistSection {
  return { id: newId(), title, collapsed: false, items: [newItem()] };
}

const PRIORITY_COLORS: Record<string, string> = {
  low: "text-zinc-500",
  normal: "text-blue-400",
  high: "text-amber-400",
  critical: "text-red-400",
};

const PRIORITY_LABELS: Record<string, string> = {
  low: "Low",
  normal: "Normal",
  high: "High",
  critical: "Critical",
};

/* ─── Component ─── */

export function ChecklistEditor({ fileName, onSave, onClose }: ChecklistEditorProps) {
  const [sections, setSections] = useState<ChecklistSection[]>([
    { id: newId(), title: "General", collapsed: false, items: [newItem(), newItem(), newItem()] },
  ]);

  const totalItems = sections.reduce((s, sec) => s + sec.items.length, 0);
  const checkedItems = sections.reduce((s, sec) => s + sec.items.filter((i) => i.checked).length, 0);
  const pct = totalItems > 0 ? Math.round((checkedItems / totalItems) * 100) : 0;

  const updateSection = useCallback((sectionId: string, updater: (s: ChecklistSection) => ChecklistSection) => {
    setSections((prev) => prev.map((s) => (s.id === sectionId ? updater(s) : s)));
  }, []);

  const updateItem = useCallback((sectionId: string, itemId: string, updater: (i: ChecklistItem) => ChecklistItem) => {
    setSections((prev) =>
      prev.map((s) =>
        s.id === sectionId ? { ...s, items: s.items.map((i) => (i.id === itemId ? updater(i) : i)) } : s
      )
    );
  }, []);

  const addItem = useCallback((sectionId: string) => {
    updateSection(sectionId, (s) => ({ ...s, items: [...s.items, newItem()] }));
  }, [updateSection]);

  const removeItem = useCallback((sectionId: string, itemId: string) => {
    updateSection(sectionId, (s) => ({ ...s, items: s.items.filter((i) => i.id !== itemId) }));
  }, [updateSection]);

  const addSection = useCallback(() => {
    setSections((prev) => [...prev, newSection()]);
  }, []);

  const removeSection = useCallback((sectionId: string) => {
    setSections((prev) => prev.filter((s) => s.id !== sectionId));
  }, []);

  const handleSave = useCallback(() => {
    if (!onSave) return;
    const data: ChecklistData = {
      title: fileName,
      sections,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    onSave(JSON.stringify(data, null, 2));
  }, [onSave, fileName, sections]);

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 bg-panel border-b border-line shrink-0">
        <div className="flex items-center gap-3">
          <span className="text-sm font-medium text-fg truncate">{fileName}</span>
          <div className="flex items-center gap-2">
            {/* Progress bar */}
            <div className="w-24 h-1.5 bg-panel2 rounded-full overflow-hidden">
              <div
                className={cn(
                  "h-full rounded-full transition-all",
                  pct === 100 ? "bg-green-500" : pct > 50 ? "bg-blue-500" : "bg-amber-500"
                )}
                style={{ width: `${pct}%` }}
              />
            </div>
            <span className="text-[11px] text-fg/40">
              {checkedItems}/{totalItems} ({pct}%)
            </span>
          </div>
        </div>
        <div className="flex items-center gap-1">
          {onSave && (
            <Button variant="ghost" size="xs" onClick={handleSave}>
              <Save className="w-4 h-4 mr-1" />
              Save
            </Button>
          )}
          {onClose && (
            <Button variant="ghost" size="xs" onClick={onClose}>
              <X className="w-4 h-4" />
            </Button>
          )}
        </div>
      </div>

      {/* Checklist body */}
      <div className="flex-1 overflow-auto p-4 space-y-4">
        {sections.map((section) => (
          <div key={section.id} className="rounded-lg border border-line bg-panel/50">
            {/* Section header */}
            <div className="flex items-center gap-2 px-3 py-2 border-b border-line/50">
              <button
                onClick={() => updateSection(section.id, (s) => ({ ...s, collapsed: !s.collapsed }))}
                className="text-fg/40 hover:text-fg/70"
              >
                {section.collapsed ? (
                  <ChevronRight className="h-4 w-4" />
                ) : (
                  <ChevronDown className="h-4 w-4" />
                )}
              </button>
              <input
                className="flex-1 bg-transparent text-sm font-medium text-fg outline-none placeholder:text-fg/30"
                value={section.title}
                onChange={(e) => updateSection(section.id, (s) => ({ ...s, title: e.target.value }))}
                placeholder="Section title..."
              />
              <span className="text-[11px] text-fg/30">
                {section.items.filter((i) => i.checked).length}/{section.items.length}
              </span>
              <Button
                variant="ghost"
                size="xs"
                onClick={() => addItem(section.id)}
                title="Add item"
              >
                <Plus className="h-3.5 w-3.5" />
              </Button>
              {sections.length > 1 && (
                <Button
                  variant="ghost"
                  size="xs"
                  onClick={() => removeSection(section.id)}
                  title="Remove section"
                  className="text-fg/30 hover:text-danger"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              )}
            </div>

            {/* Items */}
            {!section.collapsed && (
              <div className="divide-y divide-line/30">
                {section.items.map((item) => (
                  <div key={item.id} className="flex items-start gap-2 px-3 py-2 group">
                    <GripVertical className="h-4 w-4 text-fg/10 mt-1 shrink-0 cursor-grab" />

                    {/* Checkbox */}
                    <button
                      onClick={() => updateItem(section.id, item.id, (i) => ({ ...i, checked: !i.checked }))}
                      className="mt-0.5 shrink-0"
                    >
                      {item.checked ? (
                        <CheckCircle2 className="h-4 w-4 text-green-500" />
                      ) : (
                        <Circle className="h-4 w-4 text-fg/25 hover:text-fg/50" />
                      )}
                    </button>

                    {/* Item content */}
                    <div className="flex-1 min-w-0 space-y-1">
                      <input
                        className={cn(
                          "w-full bg-transparent text-xs text-fg outline-none placeholder:text-fg/30",
                          item.checked && "line-through text-fg/40"
                        )}
                        value={item.text}
                        onChange={(e) => updateItem(section.id, item.id, (i) => ({ ...i, text: e.target.value }))}
                        placeholder="Item description..."
                      />
                      {/* Metadata row */}
                      <div className="flex items-center gap-2 flex-wrap">
                        <select
                          className="bg-transparent text-[10px] text-fg/40 outline-none cursor-pointer"
                          value={item.priority}
                          onChange={(e) =>
                            updateItem(section.id, item.id, (i) => ({
                              ...i,
                              priority: e.target.value as ChecklistItem["priority"],
                            }))
                          }
                        >
                          {Object.entries(PRIORITY_LABELS).map(([k, v]) => (
                            <option key={k} value={k}>{v}</option>
                          ))}
                        </select>
                        <input
                          className="bg-transparent text-[10px] text-fg/40 outline-none placeholder:text-fg/20 w-20"
                          value={item.assignee}
                          onChange={(e) => updateItem(section.id, item.id, (i) => ({ ...i, assignee: e.target.value }))}
                          placeholder="Assignee"
                        />
                        <input
                          type="date"
                          className="bg-transparent text-[10px] text-fg/40 outline-none"
                          value={item.dueDate}
                          onChange={(e) => updateItem(section.id, item.id, (i) => ({ ...i, dueDate: e.target.value }))}
                        />
                        <input
                          className="bg-transparent text-[10px] text-fg/30 outline-none placeholder:text-fg/15 flex-1"
                          value={item.notes}
                          onChange={(e) => updateItem(section.id, item.id, (i) => ({ ...i, notes: e.target.value }))}
                          placeholder="Notes..."
                        />
                      </div>
                    </div>

                    {/* Delete */}
                    <button
                      onClick={() => removeItem(section.id, item.id)}
                      className="mt-0.5 text-fg/0 group-hover:text-fg/30 hover:!text-danger shrink-0 transition-colors"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}

        {/* Add section button */}
        <button
          onClick={addSection}
          className="flex items-center gap-2 px-3 py-2 text-xs text-fg/40 hover:text-fg/70 rounded-lg border border-dashed border-line hover:border-fg/30 w-full transition-colors"
        >
          <Plus className="h-3.5 w-3.5" />
          Add Section
        </button>
      </div>
    </div>
  );
}
