"use client";

import { useState } from "react";
import { Layers, X } from "lucide-react";
import { saveSelectionAsAssembly } from "@/lib/api";
import { Button, Input, Label, ModalBackdrop } from "@/components/ui";
import { UomSelect } from "@/components/shared/uom-select";

interface Props {
  open: boolean;
  onClose: () => void;
  projectId: string;
  worksheetId: string | null;
  selectedItemIds: string[];
  onSaved: (info: { assemblyId: string; assemblyName: string; skippedFreeform: number }) => void;
}

export function SaveSelectionAsAssemblyModal({ open, onClose, projectId, worksheetId, selectedItemIds, onSaved }: Props) {
  const [name, setName] = useState("New assembly");
  const [code, setCode] = useState("");
  const [unit, setUnit] = useState("EA");
  const [category, setCategory] = useState("");
  const [description, setDescription] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!open) return null;

  const handleSave = async () => {
    if (!worksheetId) {
      setError("Select a worksheet first");
      return;
    }
    if (!name.trim()) {
      setError("Name is required");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const result = await saveSelectionAsAssembly(projectId, worksheetId, {
        name: name.trim(),
        code: code || undefined,
        unit: unit || "EA",
        category: category || undefined,
        description: description || undefined,
        worksheetItemIds: selectedItemIds,
      });
      onSaved({ assemblyId: result.assembly.id, assemblyName: result.assembly.name, skippedFreeform: result.skippedFreeform });
      onClose();
    } catch (e: any) {
      setError(e?.message ?? "Failed to save");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <ModalBackdrop open={open} onClose={onClose}>
      <div className="bg-panel rounded-lg shadow-2xl w-[480px] max-w-[95vw]" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-4 py-3 border-b border-fg/10">
          <div className="flex items-center gap-2">
            <Layers className="w-4 h-4" />
            <div className="text-sm font-medium">Save selection as assembly</div>
          </div>
          <Button size="sm" variant="ghost" onClick={onClose}>
            <X className="w-3.5 h-3.5" />
          </Button>
        </div>

        <div className="p-4 space-y-3">
          <div className="text-xs text-fg/50">
            Create a reusable assembly from the {selectedItemIds.length} selected line item
            {selectedItemIds.length === 1 ? "" : "s"}. Catalog and rate-schedule items will become components; freeform line
            items will be skipped.
          </div>

          {error && (
            <div className="px-3 py-2 rounded-md bg-red-500/10 text-xs text-red-400 border border-red-500/30">{error}</div>
          )}

          <div>
            <Label className="text-[10px]">Name</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} className="text-xs" autoFocus />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-[10px]">Code</Label>
              <Input value={code} onChange={(e) => setCode(e.target.value)} className="text-xs" />
            </div>
            <div>
              <Label className="text-[10px]">Unit (per assembly)</Label>
              <UomSelect value={unit} onValueChange={setUnit} size="sm" />
            </div>
            <div className="col-span-2">
              <Label className="text-[10px]">Category</Label>
              <Input value={category} onChange={(e) => setCategory(e.target.value)} className="text-xs" />
            </div>
            <div className="col-span-2">
              <Label className="text-[10px]">Description</Label>
              <Input value={description} onChange={(e) => setDescription(e.target.value)} className="text-xs" />
            </div>
          </div>
        </div>

        <div className="px-4 py-3 border-t border-fg/10 flex items-center justify-end gap-2">
          <Button size="sm" variant="ghost" onClick={onClose}>Cancel</Button>
          <Button size="sm" onClick={handleSave} disabled={submitting} className="text-xs">
            {submitting ? "Saving…" : "Create assembly"}
          </Button>
        </div>
      </div>
    </ModalBackdrop>
  );
}
