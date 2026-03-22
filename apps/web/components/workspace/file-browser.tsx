"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import {
  Check,
  ChevronDown,
  ChevronRight,
  Edit3,
  ExternalLink,
  File,
  FileText,
  Folder,
  FolderOpen,
  FolderPlus,
  MoreHorizontal,
  Search,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import type {
  FileNode,
  PackageRecord,
  ProjectWorkspaceData,
  SourceDocument,
} from "@/lib/api";
import {
  createFileNode,
  deleteFileNode,
  getFileTree,
  updateFileNode,
} from "@/lib/api";
import {
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  CardTitle,
  EmptyState,
  Input,
} from "@/components/ui";
import { cn } from "@/lib/utils";
import { formatDate } from "@/lib/format";

/* ─── Types ─── */

interface TreeItem {
  id: string;
  name: string;
  type: "file" | "directory";
  parentId: string | null;
  children: TreeItem[];
  // source data
  fileNode?: FileNode;
  sourceDocument?: SourceDocument;
  isAutoFolder?: boolean;
  documentType?: string;
  fileType?: string;
  size?: number;
  pageCount?: number;
  createdAt?: string;
  extractedText?: string;
}

export interface FileBrowserProps {
  workspace: ProjectWorkspaceData;
  packages?: PackageRecord[];
}

/* ─── Constants ─── */

const FOLDER_CONFIG: Array<{ key: string; label: string; documentType: string }> = [
  { key: "specs", label: "Specs", documentType: "spec" },
  { key: "drawings", label: "Drawings", documentType: "drawing" },
  { key: "rfq", label: "RFQs", documentType: "rfq" },
  { key: "addenda", label: "Addenda", documentType: "addendum" },
  { key: "vendor", label: "Vendor", documentType: "vendor" },
  { key: "reference", label: "Reference", documentType: "reference" },
];

const TYPE_BADGE_TONE: Record<string, "default" | "success" | "warning" | "danger" | "info"> = {
  spec: "info",
  drawing: "success",
  rfq: "warning",
  addendum: "danger",
  vendor: "default",
  reference: "default",
};

/* ─── Helpers ─── */

function truncateText(text: string, maxLength: number) {
  if (!text) return "";
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength) + "...";
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function buildTreeFromNodes(nodes: FileNode[]): TreeItem[] {
  const map = new Map<string | null, TreeItem[]>();
  for (const node of nodes) {
    const parentKey = node.parentId ?? null;
    if (!map.has(parentKey)) map.set(parentKey, []);
    map.get(parentKey)!.push({
      id: node.id,
      name: node.name,
      type: node.type,
      parentId: node.parentId,
      children: [],
      fileNode: node,
      fileType: node.fileType,
      size: node.size,
      createdAt: node.createdAt,
    });
  }

  function attachChildren(parentId: string | null): TreeItem[] {
    const children = map.get(parentId) ?? [];
    for (const child of children) {
      child.children = attachChildren(child.id);
    }
    // Sort: directories first, then alphabetical
    return children.sort((a, b) => {
      if (a.type !== b.type) return a.type === "directory" ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
  }

  return attachChildren(null);
}

function buildAutoFolders(documents: SourceDocument[]): TreeItem[] {
  const folders: TreeItem[] = [];

  for (const cfg of FOLDER_CONFIG) {
    const docs = documents.filter((d) => d.documentType === cfg.documentType);
    if (docs.length === 0) continue;

    folders.push({
      id: `auto-${cfg.key}`,
      name: cfg.label,
      type: "directory",
      parentId: null,
      isAutoFolder: true,
      documentType: cfg.documentType,
      children: docs.map((doc) => ({
        id: `doc-${doc.id}`,
        name: doc.fileName,
        type: "file" as const,
        parentId: `auto-${cfg.key}`,
        children: [],
        sourceDocument: doc,
        documentType: doc.documentType,
        fileType: doc.fileType,
        pageCount: doc.pageCount,
        createdAt: doc.createdAt,
        extractedText: doc.extractedText,
      })),
    });
  }

  // Uncategorized docs
  const knownTypes = new Set(FOLDER_CONFIG.map((c) => c.documentType));
  const uncategorized = documents.filter((d) => !knownTypes.has(d.documentType));
  if (uncategorized.length > 0) {
    folders.push({
      id: "auto-other",
      name: "Other",
      type: "directory",
      parentId: null,
      isAutoFolder: true,
      children: uncategorized.map((doc) => ({
        id: `doc-${doc.id}`,
        name: doc.fileName,
        type: "file" as const,
        parentId: "auto-other",
        children: [],
        sourceDocument: doc,
        documentType: doc.documentType,
        fileType: doc.fileType,
        pageCount: doc.pageCount,
        createdAt: doc.createdAt,
        extractedText: doc.extractedText,
      })),
    });
  }

  return folders;
}

function filterTree(items: TreeItem[], query: string): TreeItem[] {
  if (!query.trim()) return items;
  const q = query.toLowerCase();

  function matches(item: TreeItem): boolean {
    if (item.name.toLowerCase().includes(q)) return true;
    if (item.type === "directory") {
      return item.children.some(matches);
    }
    return false;
  }

  function prune(items: TreeItem[]): TreeItem[] {
    return items
      .filter(matches)
      .map((item) => ({
        ...item,
        children: item.type === "directory" ? prune(item.children) : [],
      }));
  }

  return prune(items);
}

/* ─── TreeNode Component ─── */

function TreeNode({
  item,
  depth,
  expandedSet,
  toggleExpand,
  selectedId,
  onSelect,
  onContextAction,
}: {
  item: TreeItem;
  depth: number;
  expandedSet: Set<string>;
  toggleExpand: (id: string) => void;
  selectedId: string | null;
  onSelect: (item: TreeItem) => void;
  onContextAction: (action: string, item: TreeItem) => void;
}) {
  const isExpanded = expandedSet.has(item.id);
  const isSelected = selectedId === item.id;
  const [showMenu, setShowMenu] = useState(false);

  if (item.type === "directory") {
    return (
      <div>
        <div
          className={cn(
            "group flex items-center gap-1 rounded-md px-2 py-1.5 text-xs transition-colors cursor-pointer",
            isSelected
              ? "bg-accent/10 text-accent"
              : "text-fg/70 hover:bg-panel2/60 hover:text-fg"
          )}
          style={{ paddingLeft: `${depth * 12 + 8}px` }}
          onClick={() => {
            toggleExpand(item.id);
            onSelect(item);
          }}
          onContextMenu={(e) => {
            if (!item.isAutoFolder) {
              e.preventDefault();
              setShowMenu(true);
            }
          }}
        >
          {isExpanded ? (
            <ChevronDown className="h-3.5 w-3.5 shrink-0 text-fg/40" />
          ) : (
            <ChevronRight className="h-3.5 w-3.5 shrink-0 text-fg/40" />
          )}
          {isExpanded ? (
            <FolderOpen className="h-3.5 w-3.5 shrink-0 text-accent" />
          ) : (
            <Folder className="h-3.5 w-3.5 shrink-0 text-accent" />
          )}
          <span className="flex-1 truncate font-medium">{item.name}</span>
          <span className="text-[10px] text-fg/30">{item.children.length}</span>

          {!item.isAutoFolder && (
            <div className="relative">
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setShowMenu(!showMenu);
                }}
                className="opacity-0 group-hover:opacity-100 text-fg/30 hover:text-fg/60 transition-opacity"
              >
                <MoreHorizontal className="h-3.5 w-3.5" />
              </button>
              {showMenu && (
                <>
                  <div
                    className="fixed inset-0 z-40"
                    onClick={() => setShowMenu(false)}
                  />
                  <div className="absolute right-0 top-5 z-50 min-w-[120px] rounded-lg border border-line bg-panel shadow-lg py-1">
                    <button
                      className="w-full px-3 py-1.5 text-left text-xs text-fg/70 hover:bg-panel2"
                      onClick={(e) => {
                        e.stopPropagation();
                        setShowMenu(false);
                        onContextAction("rename", item);
                      }}
                    >
                      Rename
                    </button>
                    <button
                      className="w-full px-3 py-1.5 text-left text-xs text-danger hover:bg-panel2"
                      onClick={(e) => {
                        e.stopPropagation();
                        setShowMenu(false);
                        onContextAction("delete", item);
                      }}
                    >
                      Delete
                    </button>
                  </div>
                </>
              )}
            </div>
          )}
        </div>

        <AnimatePresence>
          {isExpanded && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
              transition={{ duration: 0.15 }}
              className="overflow-hidden"
            >
              <div className="border-l border-line/30 ml-3">
                {item.children.length === 0 ? (
                  <p
                    className="px-2 py-1.5 text-[11px] text-fg/30 italic"
                    style={{ paddingLeft: `${(depth + 1) * 12 + 8}px` }}
                  >
                    No files
                  </p>
                ) : (
                  item.children.map((child) => (
                    <TreeNode
                      key={child.id}
                      item={child}
                      depth={depth + 1}
                      expandedSet={expandedSet}
                      toggleExpand={toggleExpand}
                      selectedId={selectedId}
                      onSelect={onSelect}
                      onContextAction={onContextAction}
                    />
                  ))
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    );
  }

  // File node
  return (
    <div
      className={cn(
        "group flex items-center gap-2 rounded-md px-2 py-1.5 text-xs transition-colors cursor-pointer",
        isSelected
          ? "bg-accent/10 text-accent"
          : "text-fg/60 hover:bg-panel2/60 hover:text-fg"
      )}
      style={{ paddingLeft: `${depth * 12 + 8}px` }}
      onClick={() => onSelect(item)}
      onContextMenu={(e) => {
        if (!item.sourceDocument) {
          e.preventDefault();
          // Could show context menu for user files
        }
      }}
    >
      {item.sourceDocument ? (
        <FileText className="h-3.5 w-3.5 shrink-0" />
      ) : (
        <File className="h-3.5 w-3.5 shrink-0" />
      )}
      <span className="flex-1 truncate">{item.name}</span>
      {item.pageCount && (
        <span className="shrink-0 text-[10px] text-fg/30">
          {item.pageCount}p
        </span>
      )}
    </div>
  );
}

/* ─── Main Component ─── */

export function FileBrowser({ workspace, packages }: FileBrowserProps) {
  const projectId = workspace.project.id;
  const [searchQuery, setSearchQuery] = useState("");
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(
    new Set(["auto-specs", "auto-drawings"])
  );
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [userNodes, setUserNodes] = useState<FileNode[]>([]);
  const [loadingNodes, setLoadingNodes] = useState(true);

  // New folder creation
  const [creatingFolder, setCreatingFolder] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");
  const [newFolderParentId, setNewFolderParentId] = useState<string | null>(null);

  // Rename
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");

  // Load user file nodes
  useEffect(() => {
    setLoadingNodes(true);
    getFileTree(projectId)
      .then(setUserNodes)
      .catch(() => setUserNodes([]))
      .finally(() => setLoadingNodes(false));
  }, [projectId]);

  // Build tree: auto-folders from source documents + user-created folders/files
  const tree = useMemo(() => {
    const autoFolders = buildAutoFolders(workspace.sourceDocuments ?? []);
    const userTree = buildTreeFromNodes(userNodes);
    return [...autoFolders, ...userTree];
  }, [workspace.sourceDocuments, userNodes]);

  const filteredTree = useMemo(
    () => filterTree(tree, searchQuery),
    [tree, searchQuery]
  );

  // Find the selected item in the tree
  const selectedItem = useMemo(() => {
    function findItem(items: TreeItem[]): TreeItem | null {
      for (const item of items) {
        if (item.id === selectedId) return item;
        const found = findItem(item.children);
        if (found) return found;
      }
      return null;
    }
    return findItem(tree);
  }, [tree, selectedId]);

  const toggleExpand = useCallback((id: string) => {
    setExpandedFolders((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const handleSelect = useCallback((item: TreeItem) => {
    setSelectedId(item.id);
  }, []);

  const handleCreateFolder = useCallback(async () => {
    if (!newFolderName.trim()) return;
    try {
      const node = await createFileNode(projectId, {
        parentId: newFolderParentId,
        name: newFolderName.trim(),
        type: "directory",
      });
      setUserNodes((prev) => [...prev, node]);
      setCreatingFolder(false);
      setNewFolderName("");
      setNewFolderParentId(null);
      // Expand to show new folder
      if (newFolderParentId) {
        setExpandedFolders((prev) => new Set([...prev, newFolderParentId!]));
      }
    } catch (err) {
      console.error("Failed to create folder:", err);
    }
  }, [projectId, newFolderName, newFolderParentId]);

  const handleRename = useCallback(async () => {
    if (!renamingId || !renameValue.trim()) return;
    try {
      const updated = await updateFileNode(projectId, renamingId, {
        name: renameValue.trim(),
      });
      setUserNodes((prev) =>
        prev.map((n) => (n.id === renamingId ? updated : n))
      );
      setRenamingId(null);
    } catch (err) {
      console.error("Failed to rename:", err);
    }
  }, [projectId, renamingId, renameValue]);

  const handleDelete = useCallback(async (item: TreeItem) => {
    if (!item.fileNode) return;
    try {
      await deleteFileNode(projectId, item.fileNode.id);
      setUserNodes((prev) => {
        // Remove node and all descendants
        const toDelete = new Set<string>([item.fileNode!.id]);
        let changed = true;
        while (changed) {
          changed = false;
          for (const n of prev) {
            if (n.parentId && toDelete.has(n.parentId) && !toDelete.has(n.id)) {
              toDelete.add(n.id);
              changed = true;
            }
          }
        }
        return prev.filter((n) => !toDelete.has(n.id));
      });
      if (selectedId === item.id) setSelectedId(null);
    } catch (err) {
      console.error("Failed to delete:", err);
    }
  }, [projectId, selectedId]);

  const handleContextAction = useCallback((action: string, item: TreeItem) => {
    if (action === "rename" && item.fileNode) {
      setRenamingId(item.fileNode.id);
      setRenameValue(item.name);
    } else if (action === "delete") {
      handleDelete(item);
    }
  }, [handleDelete]);

  return (
    <div className="flex h-full gap-4">
      {/* ─── Left Panel: File Tree ─── */}
      <div className="flex w-[40%] flex-col">
        <Card className="flex flex-1 flex-col overflow-hidden">
          <CardHeader className="flex flex-row items-center justify-between gap-3">
            <CardTitle>Project Documents</CardTitle>
            <div className="flex items-center gap-1.5">
              <Button
                variant="secondary"
                size="xs"
                onClick={() => {
                  setCreatingFolder(true);
                  setNewFolderParentId(null);
                }}
              >
                <FolderPlus className="h-3.5 w-3.5" />
                New Folder
              </Button>
              <Button variant="secondary" size="xs" disabled>
                <Upload className="h-3.5 w-3.5" />
                Upload
              </Button>
            </div>
          </CardHeader>

          {/* Search */}
          <div className="border-b border-line px-4 py-2.5">
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-fg/30" />
              <Input
                className="h-8 pl-8 text-xs"
                placeholder="Search files..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </div>
          </div>

          {/* New folder input */}
          <AnimatePresence>
            {creatingFolder && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto" }}
                exit={{ opacity: 0, height: 0 }}
                className="border-b border-line px-4 py-2"
              >
                <div className="flex items-center gap-1.5">
                  <Folder className="h-3.5 w-3.5 text-accent shrink-0" />
                  <Input
                    className="h-7 text-xs flex-1"
                    placeholder="Folder name..."
                    value={newFolderName}
                    onChange={(e) => setNewFolderName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") handleCreateFolder();
                      if (e.key === "Escape") {
                        setCreatingFolder(false);
                        setNewFolderName("");
                      }
                    }}
                    autoFocus
                  />
                  <button
                    onClick={handleCreateFolder}
                    className="text-success hover:text-success/80"
                  >
                    <Check className="h-3.5 w-3.5" />
                  </button>
                  <button
                    onClick={() => {
                      setCreatingFolder(false);
                      setNewFolderName("");
                    }}
                    className="text-fg/40 hover:text-fg/60"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Rename input */}
          <AnimatePresence>
            {renamingId && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto" }}
                exit={{ opacity: 0, height: 0 }}
                className="border-b border-line px-4 py-2"
              >
                <div className="flex items-center gap-1.5">
                  <Edit3 className="h-3.5 w-3.5 text-fg/40 shrink-0" />
                  <Input
                    className="h-7 text-xs flex-1"
                    placeholder="New name..."
                    value={renameValue}
                    onChange={(e) => setRenameValue(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") handleRename();
                      if (e.key === "Escape") setRenamingId(null);
                    }}
                    autoFocus
                  />
                  <button
                    onClick={handleRename}
                    className="text-success hover:text-success/80"
                  >
                    <Check className="h-3.5 w-3.5" />
                  </button>
                  <button
                    onClick={() => setRenamingId(null)}
                    className="text-fg/40 hover:text-fg/60"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Tree */}
          <div className="flex-1 overflow-y-auto px-2 py-2">
            {loadingNodes ? (
              <div className="flex items-center justify-center py-8">
                <div className="h-5 w-5 animate-spin rounded-full border-2 border-accent border-t-transparent" />
              </div>
            ) : filteredTree.length === 0 ? (
              <EmptyState className="mt-4">
                No documents or files yet.
              </EmptyState>
            ) : (
              filteredTree.map((item) => (
                <TreeNode
                  key={item.id}
                  item={item}
                  depth={0}
                  expandedSet={expandedFolders}
                  toggleExpand={toggleExpand}
                  selectedId={selectedId}
                  onSelect={handleSelect}
                  onContextAction={handleContextAction}
                />
              ))
            )}
          </div>
        </Card>
      </div>

      {/* ─── Right Panel: File Details ─── */}
      <div className="w-[60%]">
        <Card className="flex h-full flex-col overflow-hidden">
          <CardHeader>
            <CardTitle>
              {selectedItem ? "File Details" : "Select a File"}
            </CardTitle>
          </CardHeader>

          <CardBody className="flex-1 overflow-y-auto">
            {!selectedItem ? (
              <EmptyState>
                Click a file or folder in the tree to view its details.
              </EmptyState>
            ) : selectedItem.type === "directory" ? (
              <div className="space-y-4">
                <div>
                  <p className="text-[11px] font-medium text-fg/40 uppercase tracking-wider">
                    Folder
                  </p>
                  <p className="mt-1 text-sm font-medium text-fg">
                    {selectedItem.name}
                  </p>
                </div>
                <div>
                  <p className="text-[11px] font-medium text-fg/40 uppercase tracking-wider">
                    Contents
                  </p>
                  <p className="mt-1 text-sm text-fg/70">
                    {selectedItem.children.length} item
                    {selectedItem.children.length !== 1 ? "s" : ""}
                  </p>
                </div>
                {selectedItem.isAutoFolder && (
                  <div>
                    <Badge tone={TYPE_BADGE_TONE[selectedItem.documentType ?? ""] ?? "default"}>
                      Auto-organized from packages
                    </Badge>
                  </div>
                )}
                {selectedItem.fileNode && (
                  <div className="flex gap-2 pt-2">
                    <Button
                      variant="secondary"
                      size="xs"
                      onClick={() => {
                        setRenamingId(selectedItem.fileNode!.id);
                        setRenameValue(selectedItem.name);
                      }}
                    >
                      <Edit3 className="h-3.5 w-3.5" />
                      Rename
                    </Button>
                    <Button
                      variant="danger"
                      size="xs"
                      onClick={() => handleDelete(selectedItem)}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                      Delete
                    </Button>
                  </div>
                )}
              </div>
            ) : (
              <div className="space-y-4">
                {/* File name */}
                <div>
                  <p className="text-[11px] font-medium text-fg/40 uppercase tracking-wider">
                    Name
                  </p>
                  <p className="mt-1 text-sm font-medium text-fg break-all">
                    {selectedItem.name}
                  </p>
                </div>

                {/* Type & pages row */}
                <div className="flex items-center gap-4">
                  {selectedItem.documentType && (
                    <div>
                      <p className="text-[11px] font-medium text-fg/40 uppercase tracking-wider">
                        Document Type
                      </p>
                      <div className="mt-1">
                        <Badge
                          tone={
                            TYPE_BADGE_TONE[selectedItem.documentType] ??
                            "default"
                          }
                        >
                          {selectedItem.documentType}
                        </Badge>
                      </div>
                    </div>
                  )}
                  {selectedItem.pageCount != null && (
                    <div>
                      <p className="text-[11px] font-medium text-fg/40 uppercase tracking-wider">
                        Pages
                      </p>
                      <p className="mt-1 text-sm text-fg">
                        {selectedItem.pageCount}
                      </p>
                    </div>
                  )}
                  {selectedItem.size != null && (
                    <div>
                      <p className="text-[11px] font-medium text-fg/40 uppercase tracking-wider">
                        Size
                      </p>
                      <p className="mt-1 text-sm text-fg/70">
                        {formatBytes(selectedItem.size)}
                      </p>
                    </div>
                  )}
                </div>

                {/* File type */}
                {selectedItem.fileType && (
                  <div>
                    <p className="text-[11px] font-medium text-fg/40 uppercase tracking-wider">
                      File Type
                    </p>
                    <p className="mt-1 text-sm text-fg/70">
                      {selectedItem.fileType}
                    </p>
                  </div>
                )}

                {/* Upload/create date */}
                {selectedItem.createdAt && (
                  <div>
                    <p className="text-[11px] font-medium text-fg/40 uppercase tracking-wider">
                      Uploaded
                    </p>
                    <p className="mt-1 text-sm text-fg/70">
                      {formatDate(selectedItem.createdAt)}
                    </p>
                  </div>
                )}

                {/* Actions */}
                <div className="flex gap-2 pt-2">
                  {selectedItem.sourceDocument && (
                    <Button variant="secondary" size="xs" disabled>
                      <ExternalLink className="h-3.5 w-3.5" />
                      Open
                    </Button>
                  )}
                  {selectedItem.fileNode && (
                    <>
                      <Button
                        variant="secondary"
                        size="xs"
                        onClick={() => {
                          setRenamingId(selectedItem.fileNode!.id);
                          setRenameValue(selectedItem.name);
                        }}
                      >
                        <Edit3 className="h-3.5 w-3.5" />
                        Rename
                      </Button>
                      <Button
                        variant="danger"
                        size="xs"
                        onClick={() => handleDelete(selectedItem)}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                        Delete
                      </Button>
                    </>
                  )}
                </div>

                {/* Extracted text preview */}
                {selectedItem.extractedText && (
                  <div>
                    <p className="text-[11px] font-medium text-fg/40 uppercase tracking-wider">
                      Extracted Text Preview
                    </p>
                    <div className="mt-1 max-h-64 overflow-y-auto rounded-md border border-line bg-bg/50 p-2.5 text-xs text-fg/60 leading-relaxed whitespace-pre-wrap">
                      {truncateText(selectedItem.extractedText, 2000)}
                    </div>
                  </div>
                )}

                {/* Source document metadata */}
                {selectedItem.sourceDocument && (
                  <div>
                    <p className="text-[11px] font-medium text-fg/40 uppercase tracking-wider">
                      Checksum
                    </p>
                    <p className="mt-1 truncate text-[11px] font-mono text-fg/30">
                      {selectedItem.sourceDocument.checksum}
                    </p>
                  </div>
                )}
              </div>
            )}
          </CardBody>
        </Card>
      </div>
    </div>
  );
}
