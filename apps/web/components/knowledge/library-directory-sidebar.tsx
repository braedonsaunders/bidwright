"use client";

import { useMemo } from "react";
import { FolderPlus, Folders, Inbox, Loader2, MoveRight, X } from "lucide-react";
import { Button, Card, CardBody, CardHeader, CardTitle, Label, ModalBackdrop, Select } from "@/components/ui";
import { TreeView, type TreeNode } from "@/components/shared/tree-view";
import type { KnowledgeLibraryCabinetRecord } from "@/lib/api";

export type LibraryDirectoryView =
  | { kind: "all" }
  | { kind: "unassigned" }
  | { kind: "cabinet"; cabinetId: string };

const ALL_LIBRARY_NODE_ID = "__library_all__";
const UNASSIGNED_LIBRARY_NODE_ID = "__library_unassigned__";

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
  onSelectView,
}: {
  cabinets: KnowledgeLibraryCabinetRecord[];
  emptyLabel: string;
  itemLabelPlural: string;
  onCreateCabinet: (parentId: string | null) => void;
  onDeleteCabinet: (cabinetId: string) => void;
  onRenameCabinet: (cabinetId: string, name: string) => void;
  selectedView: LibraryDirectoryView;
  onSelectView: (view: LibraryDirectoryView) => void;
}) {
  const nodes = useMemo<TreeNode[]>(
    () =>
      [
        {
          id: ALL_LIBRARY_NODE_ID,
          parentId: null,
          name: `All ${itemLabelPlural}`,
          type: "file" as const,
          icon: <Folders className="h-3.5 w-3.5 shrink-0 text-fg/45" />,
          data: { disableContextMenu: true, sortOrder: -200 },
        },
        {
          id: UNASSIGNED_LIBRARY_NODE_ID,
          parentId: null,
          name: "Unassigned",
          type: "file" as const,
          icon: <Inbox className="h-3.5 w-3.5 shrink-0 text-fg/45" />,
          data: { disableContextMenu: true, sortOrder: -190 },
        },
        ...[...cabinets]
        .sort(compareByName)
        .map((cabinet) => ({
          id: cabinet.id,
          parentId: cabinet.parentId,
          name: cabinet.name,
          type: "directory" as const,
        })),
      ],
    [cabinets, itemLabelPlural],
  );

  return (
    <Card className="flex h-full min-h-0 flex-col overflow-hidden">
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

      <CardBody className="flex min-h-0 flex-1 flex-col p-3">
        <TreeView
          nodes={nodes}
          selectedId={
            selectedView.kind === "all"
              ? ALL_LIBRARY_NODE_ID
              : selectedView.kind === "unassigned"
                ? UNASSIGNED_LIBRARY_NODE_ID
                : selectedView.cabinetId
          }
          searchable
          className="flex-1 min-h-0 rounded-lg border border-line bg-panel2/15"
          onSelect={(node) => {
            if (node.id === ALL_LIBRARY_NODE_ID) {
              onSelectView({ kind: "all" });
              return;
            }
            if (node.id === UNASSIGNED_LIBRARY_NODE_ID) {
              onSelectView({ kind: "unassigned" });
              return;
            }
            onSelectView({ kind: "cabinet", cabinetId: node.id });
          }}
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
