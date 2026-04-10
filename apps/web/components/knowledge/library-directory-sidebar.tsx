"use client";

import { useMemo } from "react";
import { FolderPlus, Loader2, MoveRight, X } from "lucide-react";
import { Button, Card, CardBody, CardHeader, CardTitle, Label, ModalBackdrop, Select } from "@/components/ui";
import { TreeView, type TreeNode } from "@/components/shared/tree-view";
import type { KnowledgeLibraryCabinetRecord } from "@/lib/api";
import { cn } from "@/lib/utils";

export type LibraryDirectoryView =
  | { kind: "all" }
  | { kind: "unassigned" }
  | { kind: "cabinet"; cabinetId: string };

export function cabinetPathLabel(
  cabinetId: string | null,
  cabinetsById: Map<string, KnowledgeLibraryCabinetRecord>,
) {
  if (!cabinetId) return null;
  const parts: string[] = [];
  let currentId: string | null = cabinetId;
  let guard = 0;
  while (currentId && guard < 20) {
    const cabinet = cabinetsById.get(currentId);
    if (!cabinet) break;
    parts.unshift(cabinet.name);
    currentId = cabinet.parentId;
    guard += 1;
  }
  return parts.length > 0 ? parts.join(" / ") : null;
}

function compareByName<T extends { name: string }>(left: T, right: T) {
  return left.name.localeCompare(right.name, undefined, { sensitivity: "base" });
}

export function CabinetDirectorySidebar({
  cabinets,
  emptyLabel,
  itemLabelPlural,
  onCreateCabinet,
  onDeleteCabinet,
  onRenameCabinet,
  selectedView,
  totalCount,
  unassignedCount,
  onSelectView,
}: {
  cabinets: KnowledgeLibraryCabinetRecord[];
  emptyLabel: string;
  itemLabelPlural: string;
  onCreateCabinet: (parentId: string | null) => void;
  onDeleteCabinet: (cabinetId: string) => void;
  onRenameCabinet: (cabinetId: string, name: string) => void;
  selectedView: LibraryDirectoryView;
  totalCount: number;
  unassignedCount: number;
  onSelectView: (view: LibraryDirectoryView) => void;
}) {
  const nodes = useMemo<TreeNode[]>(
    () =>
      [...cabinets]
        .sort(compareByName)
        .map((cabinet) => ({
          id: cabinet.id,
          parentId: cabinet.parentId,
          name: cabinet.name,
          type: "directory",
        })),
    [cabinets],
  );

  return (
    <Card className="overflow-hidden">
      <CardHeader className="flex items-center justify-between gap-3 border-b border-line">
        <div>
          <CardTitle className="text-sm">{itemLabelPlural} Folders</CardTitle>
          <p className="mt-1 text-xs text-fg/40">{emptyLabel}</p>
        </div>
        <Button
          size="xs"
          variant="secondary"
          onClick={() => onCreateCabinet(selectedView.kind === "cabinet" ? selectedView.cabinetId : null)}
        >
          <FolderPlus className="h-3.5 w-3.5" />
          New
        </Button>
      </CardHeader>

      <CardBody className="space-y-3 p-3">
        <div className="grid gap-2">
          <button
            type="button"
            onClick={() => onSelectView({ kind: "all" })}
            className={cn(
              "flex items-center justify-between rounded-lg border px-3 py-2 text-left text-xs transition-colors",
              selectedView.kind === "all"
                ? "border-accent/40 bg-accent/8 text-accent"
                : "border-line bg-panel2/25 text-fg/70 hover:bg-panel2/40"
            )}
          >
            <span>All {itemLabelPlural}</span>
            <span className="rounded-full bg-panel px-1.5 py-0.5 text-[10px]">{totalCount}</span>
          </button>

          <button
            type="button"
            onClick={() => onSelectView({ kind: "unassigned" })}
            className={cn(
              "flex items-center justify-between rounded-lg border px-3 py-2 text-left text-xs transition-colors",
              selectedView.kind === "unassigned"
                ? "border-accent/40 bg-accent/8 text-accent"
                : "border-line bg-panel2/25 text-fg/70 hover:bg-panel2/40"
            )}
          >
            <span>Unassigned</span>
            <span className="rounded-full bg-panel px-1.5 py-0.5 text-[10px]">{unassignedCount}</span>
          </button>
        </div>

        <TreeView
          nodes={nodes}
          selectedId={selectedView.kind === "cabinet" ? selectedView.cabinetId : null}
          searchable
          className="min-h-[360px] rounded-lg border border-line bg-panel2/15"
          onSelect={(node) => onSelectView({ kind: "cabinet", cabinetId: node.id })}
          onCreateFolder={onCreateCabinet}
          onRename={onRenameCabinet}
          onDelete={onDeleteCabinet}
        />
      </CardBody>
    </Card>
  );
}

export function MoveToCabinetModal({
  activeType,
  cabinets,
  itemName,
  onClose,
  onConfirm,
  onValueChange,
  saving,
  value,
}: {
  activeType: "book" | "dataset";
  cabinets: KnowledgeLibraryCabinetRecord[];
  itemName: string;
  onClose: () => void;
  onConfirm: () => void;
  onValueChange: (value: string) => void;
  saving: boolean;
  value: string;
}) {
  const options = useMemo(() => {
    const children = new Map<string | null, KnowledgeLibraryCabinetRecord[]>();
    for (const cabinet of cabinets) {
      const key = cabinet.parentId ?? null;
      const list = children.get(key) ?? [];
      list.push(cabinet);
      children.set(key, list);
    }

    const rows: Array<{ id: string; label: string }> = [];
    const visit = (parentId: string | null, depth: number) => {
      const siblings = (children.get(parentId) ?? []).sort(compareByName);
      for (const cabinet of siblings) {
        rows.push({ id: cabinet.id, label: `${"  ".repeat(depth)}${cabinet.name}` });
        visit(cabinet.id, depth + 1);
      }
    };

    visit(null, 0);
    return rows;
  }, [cabinets]);

  return (
    <ModalBackdrop open={true} onClose={onClose}>
      <div
        className="w-full max-w-md rounded-xl border border-line bg-panel p-5 shadow-xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold text-fg">Move {activeType === "book" ? "Book" : "Dataset"}</h2>
            <p className="mt-1 text-xs text-fg/45">{itemName}</p>
          </div>
          <button type="button" onClick={onClose} className="rounded p-1 text-fg/35 hover:bg-panel2 hover:text-fg/60">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="mt-4 space-y-2">
          <Label className="text-xs">Folder</Label>
          <Select value={value} onChange={(event) => onValueChange(event.target.value)} className="text-xs">
            <option value="__root__">Unassigned</option>
            {options.map((option) => (
              <option key={option.id} value={option.id}>
                {option.label}
              </option>
            ))}
          </Select>
        </div>

        <div className="mt-5 flex justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button size="sm" onClick={onConfirm} disabled={saving}>
            {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <MoveRight className="h-3.5 w-3.5" />}
            Save
          </Button>
        </div>
      </div>
    </ModalBackdrop>
  );
}
