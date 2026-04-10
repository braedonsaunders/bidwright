"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import {
  Check,
  ChevronDown,
  ChevronRight,
  Edit3,
  File,
  Folder,
  FolderOpen,
  FolderPlus,
  MoreHorizontal,
  Search,
  Trash2,
  X,
} from "lucide-react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/utils";
import { EmptyState, Input } from "@/components/ui";
import * as React from "react";

/* ─── Types ─── */

export interface TreeNode {
  id: string;
  parentId: string | null;
  name: string;
  type: "file" | "directory";
  icon?: React.ReactNode;
  children?: TreeNode[];
  data?: Record<string, unknown>;
}

export interface TreeViewProps {
  nodes: TreeNode[];
  selectedId?: string | null;
  onSelect?: (node: TreeNode) => void;
  onCreateFolder?: (parentId: string | null) => void;
  onRename?: (nodeId: string, newName: string) => void;
  onDelete?: (nodeId: string) => void;
  onMove?: (nodeId: string, newParentId: string | null) => void;
  renderActions?: (node: TreeNode) => React.ReactNode;
  searchable?: boolean;
  className?: string;
}

/* ─── Helpers ─── */

function buildHierarchy(flatNodes: TreeNode[]): TreeNode[] {
  const map = new Map<string | null, TreeNode[]>();

  for (const node of flatNodes) {
    const parentKey = node.parentId ?? null;
    if (!map.has(parentKey)) map.set(parentKey, []);
    map.get(parentKey)!.push({ ...node, children: [] });
  }

  function attachChildren(parentId: string | null): TreeNode[] {
    const children = map.get(parentId) ?? [];
    for (const child of children) {
      child.children = attachChildren(child.id);
    }
    return children.sort((a, b) => {
      const leftSortOrder = typeof a.data?.sortOrder === "number" ? a.data.sortOrder : 0;
      const rightSortOrder = typeof b.data?.sortOrder === "number" ? b.data.sortOrder : 0;
      if (leftSortOrder !== rightSortOrder) return leftSortOrder - rightSortOrder;
      if (a.type !== b.type) return a.type === "directory" ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
  }

  return attachChildren(null);
}

function filterNodes(items: TreeNode[], query: string): TreeNode[] {
  if (!query.trim()) return items;
  const q = query.toLowerCase();

  function matches(item: TreeNode): boolean {
    if (item.name.toLowerCase().includes(q)) return true;
    if (item.type === "directory" && item.children) {
      return item.children.some(matches);
    }
    return false;
  }

  function prune(items: TreeNode[]): TreeNode[] {
    return items
      .filter(matches)
      .map((item) => ({
        ...item,
        children:
          item.type === "directory" && item.children
            ? prune(item.children)
            : [],
      }));
  }

  return prune(items);
}

/* ─── Context Menu ─── */

function ContextMenu({
  x,
  y,
  node,
  onClose,
  onRename,
  onDelete,
  onCreateFolder,
}: {
  x: number;
  y: number;
  node: TreeNode;
  onClose: () => void;
  onRename?: (nodeId: string, newName: string) => void;
  onDelete?: (nodeId: string) => void;
  onCreateFolder?: (parentId: string | null) => void;
}) {
  const menuRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ left: x, top: y });

  useLayoutEffect(() => {
    const menu = menuRef.current;
    if (!menu) return;

    const rect = menu.getBoundingClientRect();
    const margin = 8;
    setPosition({
      left: Math.max(margin, Math.min(x, window.innerWidth - rect.width - margin)),
      top: Math.max(margin, Math.min(y, window.innerHeight - rect.height - margin)),
    });
  }, [x, y, node.id]);

  if (typeof document === "undefined") return null;

  return createPortal(
    <>
      <div className="fixed inset-0 z-40" onClick={onClose} />
      <div
        ref={menuRef}
        className="fixed z-50 min-w-[140px] rounded-lg border border-line bg-panel shadow-lg py-1"
        style={{ left: position.left, top: position.top }}
      >
        {node.type === "directory" && onCreateFolder && (
          <button
            className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs text-fg/70 hover:bg-panel2"
            onClick={() => {
              onClose();
              onCreateFolder(node.id);
            }}
          >
            <FolderPlus className="h-3 w-3" />
            New Subfolder
          </button>
        )}
        {onRename && (
          <button
            className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs text-fg/70 hover:bg-panel2"
            onClick={() => {
              onClose();
              // Trigger inline rename — handled by parent via state
              onRename(node.id, node.name);
            }}
          >
            <Edit3 className="h-3 w-3" />
            Rename
          </button>
        )}
        {onDelete && (
          <button
            className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs text-danger hover:bg-panel2"
            onClick={() => {
              onClose();
              onDelete(node.id);
            }}
          >
            <Trash2 className="h-3 w-3" />
            Delete
          </button>
        )}
      </div>
    </>,
    document.body,
  );
}

/* ─── InlineRenameInput ─── */

function InlineRenameInput({
  initialValue,
  onConfirm,
  onCancel,
}: {
  initialValue: string;
  onConfirm: (newName: string) => void;
  onCancel: () => void;
}) {
  const [value, setValue] = useState(initialValue);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.select();
  }, []);

  return (
    <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
      <input
        ref={inputRef}
        className="h-6 flex-1 rounded border border-accent/50 bg-bg/80 px-1.5 text-xs text-fg outline-none focus:ring-1 focus:ring-accent/30"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && value.trim()) onConfirm(value.trim());
          if (e.key === "Escape") onCancel();
        }}
        autoFocus
      />
      <button
        onClick={() => value.trim() && onConfirm(value.trim())}
        className="text-success hover:text-success/80"
      >
        <Check className="h-3.5 w-3.5" />
      </button>
      <button onClick={onCancel} className="text-fg/40 hover:text-fg/60">
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

/* ─── TreeNodeRow ─── */

function TreeNodeRow({
  node,
  depth,
  expandedSet,
  toggleExpand,
  selectedId,
  onSelect,
  onContextMenu,
  renamingId,
  onRenameConfirm,
  onRenameCancel,
  renderActions,
}: {
  node: TreeNode;
  depth: number;
  expandedSet: Set<string>;
  toggleExpand: (id: string) => void;
  selectedId: string | null;
  onSelect: (node: TreeNode) => void;
  onContextMenu: (e: React.MouseEvent, node: TreeNode) => void;
  renamingId: string | null;
  onRenameConfirm: (nodeId: string, newName: string) => void;
  onRenameCancel: () => void;
  renderActions?: (node: TreeNode) => React.ReactNode;
}) {
  const isExpanded = expandedSet.has(node.id);
  const isSelected = selectedId === node.id;
  const isRenaming = renamingId === node.id;

  const isDir = node.type === "directory";

  const folderIcon = isDir ? (
    isExpanded ? (
      <FolderOpen className="h-3.5 w-3.5 shrink-0 text-accent" />
    ) : (
      <Folder className="h-3.5 w-3.5 shrink-0 text-accent" />
    )
  ) : null;

  const fileIcon = !isDir
    ? node.icon ?? <File className="h-3.5 w-3.5 shrink-0 text-fg/40" />
    : null;

  return (
    <div>
      <div
        className={cn(
          "group flex items-center gap-1 rounded-md px-2 py-1.5 text-xs transition-colors cursor-pointer",
          isSelected
            ? "bg-accent/10 text-accent"
            : "text-fg/70 hover:bg-panel2/60 hover:text-fg"
        )}
        style={{ paddingLeft: `${depth * 16 + 8}px` }}
        onClick={() => {
          if (isDir) toggleExpand(node.id);
          onSelect(node);
        }}
        onDoubleClick={(e) => {
          if (!isDir) return;
          // Double-click on directory name doesn't trigger rename here —
          // that's done via context menu or actions
        }}
        onContextMenu={(e) => {
          e.preventDefault();
          onContextMenu(e, node);
        }}
      >
        {/* Expand chevron for directories */}
        {isDir ? (
          isExpanded ? (
            <ChevronDown className="h-3.5 w-3.5 shrink-0 text-fg/40" />
          ) : (
            <ChevronRight className="h-3.5 w-3.5 shrink-0 text-fg/40" />
          )
        ) : (
          <span className="w-3.5 shrink-0" />
        )}

        {/* Icon */}
        {folderIcon}
        {fileIcon}

        {/* Name or rename input */}
        {isRenaming ? (
          <div className="flex-1 min-w-0">
            <InlineRenameInput
              initialValue={node.name}
              onConfirm={(newName) => onRenameConfirm(node.id, newName)}
              onCancel={onRenameCancel}
            />
          </div>
        ) : (
          <span className="flex-1 truncate font-medium">{node.name}</span>
        )}

        {/* Child count for directories */}
        {isDir && !isRenaming && node.children && (
          <span className="text-[10px] text-fg/30">{node.children.length}</span>
        )}

        {/* Custom actions from consumer */}
        {renderActions && !isRenaming && (
          <span className="opacity-0 group-hover:opacity-100 transition-opacity">
            {renderActions(node)}
          </span>
        )}
      </div>

      {/* Children */}
      {isDir && (
        <AnimatePresence>
          {isExpanded && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
              transition={{ duration: 0.15 }}
              className="overflow-hidden"
            >
              <div
                className="border-l border-line/30"
                style={{ marginLeft: `${depth * 16 + 16}px` }}
              >
                {node.children && node.children.length > 0 ? (
                  node.children.map((child) => (
                    <TreeNodeRow
                      key={child.id}
                      node={child}
                      depth={depth + 1}
                      expandedSet={expandedSet}
                      toggleExpand={toggleExpand}
                      selectedId={selectedId}
                      onSelect={onSelect}
                      onContextMenu={onContextMenu}
                      renamingId={renamingId}
                      onRenameConfirm={onRenameConfirm}
                      onRenameCancel={onRenameCancel}
                      renderActions={renderActions}
                    />
                  ))
                ) : (
                  <p
                    className="px-2 py-1.5 text-[11px] text-fg/30 italic"
                    style={{ paddingLeft: `${(depth + 1) * 16 + 8}px` }}
                  >
                    Empty
                  </p>
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      )}
    </div>
  );
}

/* ─── Main TreeView ─── */

export function TreeView({
  nodes,
  selectedId = null,
  onSelect,
  onCreateFolder,
  onRename,
  onDelete,
  onMove,
  renderActions,
  searchable = true,
  className,
}: TreeViewProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set());
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    node: TreeNode;
  } | null>(null);

  // Build hierarchy from flat list
  const tree = useMemo(() => buildHierarchy(nodes), [nodes]);

  // Filter tree by search
  const filteredTree = useMemo(
    () => filterNodes(tree, searchQuery),
    [tree, searchQuery]
  );

  // Auto-expand when searching
  useEffect(() => {
    if (searchQuery.trim()) {
      const allDirIds = nodes
        .filter((n) => n.type === "directory")
        .map((n) => n.id);
      setExpandedFolders(new Set(allDirIds));
    }
  }, [searchQuery, nodes]);

  const toggleExpand = useCallback((id: string) => {
    setExpandedFolders((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const handleSelect = useCallback(
    (node: TreeNode) => {
      onSelect?.(node);
    },
    [onSelect]
  );

  const handleContextMenu = useCallback(
    (e: React.MouseEvent, node: TreeNode) => {
      if (node.data?.disableContextMenu) return;
      if (!onRename && !onDelete && !onCreateFolder) return;
      setContextMenu({ x: e.clientX, y: e.clientY, node });
    },
    [onRename, onDelete, onCreateFolder]
  );

  const handleRenameConfirm = useCallback(
    (nodeId: string, newName: string) => {
      setRenamingId(null);
      onRename?.(nodeId, newName);
    },
    [onRename]
  );

  const handleRenameCancel = useCallback(() => {
    setRenamingId(null);
  }, []);

  return (
    <div className={cn("flex flex-col", className)}>
      {/* Search bar */}
      {searchable && (
        <div className="border-b border-line px-3 py-2">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-fg/30" />
            <Input
              className="h-8 pl-8 text-xs"
              placeholder="Search..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>
        </div>
      )}

      {/* Tree content */}
      <div className="flex-1 overflow-y-auto px-1.5 py-1.5">
        {filteredTree.length === 0 ? (
          <EmptyState className="mt-4 mx-2">
            {searchQuery.trim()
              ? "No matching items found."
              : "No items yet."}
          </EmptyState>
        ) : (
          filteredTree.map((node) => (
            <TreeNodeRow
              key={node.id}
              node={node}
              depth={0}
              expandedSet={expandedFolders}
              toggleExpand={toggleExpand}
              selectedId={selectedId}
              onSelect={handleSelect}
              onContextMenu={handleContextMenu}
              renamingId={renamingId}
              onRenameConfirm={handleRenameConfirm}
              onRenameCancel={handleRenameCancel}
              renderActions={renderActions}
            />
          ))
        )}
      </div>

      {/* Right-click context menu */}
      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          node={contextMenu.node}
          onClose={() => setContextMenu(null)}
          onRename={
            onRename
              ? (nodeId) => {
                  setRenamingId(nodeId);
                }
              : undefined
          }
          onDelete={onDelete}
          onCreateFolder={onCreateFolder}
        />
      )}
    </div>
  );
}
