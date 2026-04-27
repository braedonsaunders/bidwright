"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  BookOpen,
  FileSpreadsheet,
  FolderPlus,
  MoveRight,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  CardTitle,
  EmptyState,
  ModalBackdrop,
  Select,
} from "@/components/ui";
import { TreeView, type TreeNode } from "@/components/shared/tree-view";
import type { CatalogImportAnalysis, CatalogSummary, KnowledgeBookRecord, FileNode } from "@/lib/api";
import { analyzeKnowledgeBookForImport, getCatalogs } from "@/lib/api";
import { CatalogImportModal } from "@/components/catalog-import-modal";
import {
  getFileTree,
  createFileNode,
  updateFileNode,
  deleteFileNode,
} from "@/lib/api";

/* ─── Types ─── */

export interface KnowledgeBrowserProps {
  projectId: string;
  books: KnowledgeBookRecord[];
  onBookSelect?: (bookId: string) => void;
  selectedBookId?: string | null;
}

/* ─── Helpers ─── */

const BOOK_PREFIX = "book-";
const FOLDER_PREFIX = "kfolder-";

function statusTone(status: string) {
  switch (status) {
    case "indexed":
      return "success" as const;
    case "processing":
    case "uploading":
      return "warning" as const;
    case "failed":
      return "danger" as const;
    default:
      return "default" as const;
  }
}

function categoryLabel(cat: string) {
  return cat
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

/* ─── Main Component ─── */

export function KnowledgeBrowser({
  projectId,
  books,
  onBookSelect,
  selectedBookId = null,
}: KnowledgeBrowserProps) {
  const [folderNodes, setFolderNodes] = useState<FileNode[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Book-to-folder mapping: bookId -> folderId (stored in metadata)
  const [bookFolderMap, setBookFolderMap] = useState<Map<string, string>>(
    new Map()
  );

  // Move modal
  const [movingBookId, setMovingBookId] = useState<string | null>(null);
  const [importBookId, setImportBookId] = useState<string | null>(null);
  const [importAnalysis, setImportAnalysis] = useState<CatalogImportAnalysis | null>(null);
  const [importLoading, setImportLoading] = useState(false);
  const [importCatalogs, setImportCatalogs] = useState<CatalogSummary[]>([]);
  const [importSourceLabel, setImportSourceLabel] = useState<string>("");
  const [moveTargetFolderId, setMoveTargetFolderId] = useState<string | null>(
    null
  );

  // Load knowledge folder structure
  useEffect(() => {
    setLoading(true);
    getFileTree(projectId, "knowledge")
      .then((nodes) => {
        setFolderNodes(nodes);
        // Build book-folder map from folder metadata
        const map = new Map<string, string>();
        for (const node of nodes) {
          if (
            node.type === "file" &&
            node.metadata?.bookId &&
            typeof node.metadata.bookId === "string"
          ) {
            map.set(node.metadata.bookId, node.parentId ?? "");
          }
        }
        setBookFolderMap(map);
      })
      .catch(() => {
        setFolderNodes([]);
      })
      .finally(() => setLoading(false));
  }, [projectId]);

  // Build the tree nodes: merge folders + books
  const treeNodes = useMemo(() => {
    const nodes: TreeNode[] = [];

    // Add folder nodes
    for (const fn of folderNodes) {
      if (fn.type === "directory") {
        nodes.push({
          id: FOLDER_PREFIX + fn.id,
          parentId: fn.parentId ? FOLDER_PREFIX + fn.parentId : null,
          name: fn.name,
          type: "directory",
          data: { fileNodeId: fn.id },
        });
      }
    }

    // Add books as leaf nodes
    for (const book of books) {
      const folderId = bookFolderMap.get(book.id);
      nodes.push({
        id: BOOK_PREFIX + book.id,
        parentId: folderId ? FOLDER_PREFIX + folderId : null,
        name: book.name,
        type: "file",
        icon: <BookOpen className="h-3.5 w-3.5 shrink-0 text-accent/70" />,
        data: {
          bookId: book.id,
          status: book.status,
          category: book.category,
          scope: book.scope,
          pageCount: book.pageCount,
          chunkCount: book.chunkCount,
          sourceFileName: book.sourceFileName,
        },
      });
    }

    return nodes;
  }, [folderNodes, books, bookFolderMap]);

  // Selected tree node
  const selectedTreeId = selectedBookId
    ? BOOK_PREFIX + selectedBookId
    : null;

  // Get the selected book record
  const selectedBook = useMemo(() => {
    if (!selectedBookId) return null;
    return books.find((b) => b.id === selectedBookId) ?? null;
  }, [books, selectedBookId]);

  // Handlers
  const handleSelect = useCallback(
    (node: TreeNode) => {
      if (node.id.startsWith(BOOK_PREFIX)) {
        const bookId = node.id.slice(BOOK_PREFIX.length);
        onBookSelect?.(bookId);
      }
    },
    [onBookSelect]
  );

  const handleCreateFolder = useCallback(
    async (parentId: string | null) => {
      const realParentId = parentId
        ? parentId.replace(FOLDER_PREFIX, "")
        : null;
      try {
        const node = await createFileNode(projectId, {
          parentId: realParentId,
          name: "New Folder",
          type: "directory",
          metadata: { scope: "knowledge" },
        });
        setFolderNodes((prev) => [...prev, node]);
      } catch (err) {
        setError(
          `Failed to create folder: ${
            err instanceof Error ? err.message : "Unknown error"
          }`
        );
        setTimeout(() => setError(null), 5000);
      }
    },
    [projectId]
  );

  const handleRename = useCallback(
    async (nodeId: string, newName: string) => {
      const realId = nodeId.replace(FOLDER_PREFIX, "");
      try {
        const updated = await updateFileNode(projectId, realId, {
          name: newName,
        });
        setFolderNodes((prev) =>
          prev.map((n) => (n.id === realId ? updated : n))
        );
      } catch (err) {
        setError(
          `Failed to rename: ${
            err instanceof Error ? err.message : "Unknown error"
          }`
        );
        setTimeout(() => setError(null), 5000);
      }
    },
    [projectId]
  );

  const handleDelete = useCallback(
    async (nodeId: string) => {
      // Only delete folder nodes, not books
      if (!nodeId.startsWith(FOLDER_PREFIX)) return;
      const realId = nodeId.replace(FOLDER_PREFIX, "");
      try {
        await deleteFileNode(projectId, realId);
        setFolderNodes((prev) => {
          const toDelete = new Set<string>([realId]);
          let changed = true;
          while (changed) {
            changed = false;
            for (const n of prev) {
              if (
                n.parentId &&
                toDelete.has(n.parentId) &&
                !toDelete.has(n.id)
              ) {
                toDelete.add(n.id);
                changed = true;
              }
            }
          }
          return prev.filter((n) => !toDelete.has(n.id));
        });
        // Move orphaned books back to root
        setBookFolderMap((prev) => {
          const next = new Map(prev);
          for (const [bookId, folderId] of next) {
            if (folderId === realId) {
              next.delete(bookId);
            }
          }
          return next;
        });
      } catch (err) {
        setError(
          `Failed to delete: ${
            err instanceof Error ? err.message : "Unknown error"
          }`
        );
        setTimeout(() => setError(null), 5000);
      }
    },
    [projectId]
  );

  // Move book to folder
  const handleMoveBook = useCallback(
    async (bookId: string, targetFolderId: string | null) => {
      // Create a file node link in the target folder for the book
      const realFolderId = targetFolderId
        ? targetFolderId.replace(FOLDER_PREFIX, "")
        : null;

      // Update our local mapping
      setBookFolderMap((prev) => {
        const next = new Map(prev);
        if (realFolderId) {
          next.set(bookId, realFolderId);
        } else {
          next.delete(bookId);
        }
        return next;
      });

      // Persist the mapping by creating/updating a file node reference
      try {
        // Find existing file node for this book
        const existingRef = folderNodes.find(
          (n) =>
            n.type === "file" &&
            n.metadata?.bookId === bookId
        );

        if (existingRef && realFolderId) {
          await updateFileNode(projectId, existingRef.id, {
            parentId: realFolderId,
          });
          setFolderNodes((prev) =>
            prev.map((n) =>
              n.id === existingRef.id
                ? { ...n, parentId: realFolderId }
                : n
            )
          );
        } else if (existingRef && !realFolderId) {
          // Moving to root — remove the file node reference
          await deleteFileNode(projectId, existingRef.id);
          setFolderNodes((prev) =>
            prev.filter((n) => n.id !== existingRef.id)
          );
        } else if (!existingRef && realFolderId) {
          // Create a new reference node
          const node = await createFileNode(projectId, {
            parentId: realFolderId,
            name: books.find((b) => b.id === bookId)?.name ?? "Book",
            type: "file",
            metadata: { scope: "knowledge", bookId },
          });
          setFolderNodes((prev) => [...prev, node]);
        }
      } catch (err) {
        setError(
          `Failed to move book: ${
            err instanceof Error ? err.message : "Unknown error"
          }`
        );
        setTimeout(() => setError(null), 5000);
      }

      setMovingBookId(null);
    },
    [projectId, folderNodes, books]
  );

  // Folder list for move dialog
  const folderList = useMemo(
    () => folderNodes.filter((n) => n.type === "directory"),
    [folderNodes]
  );

  // Render custom actions for book nodes
  const renderActions = useCallback(
    (node: TreeNode) => {
      if (!node.id.startsWith(BOOK_PREFIX)) return null;
      const bookId = node.id.slice(BOOK_PREFIX.length);
      return (
        <button
          onClick={(e) => {
            e.stopPropagation();
            setMovingBookId(bookId);
            setMoveTargetFolderId(null);
          }}
          className="text-fg/30 hover:text-fg/60"
          title="Move to folder"
        >
          <MoveRight className="h-3 w-3" />
        </button>
      );
    },
    []
  );

  return (
    <div className="flex h-full gap-4">
      {/* ─── Left: Tree ─── */}
      <div className="flex w-[40%] flex-col">
        <Card className="flex flex-1 flex-col overflow-hidden">
          <CardHeader className="flex flex-row items-center justify-between gap-3">
            <CardTitle>Knowledge Library</CardTitle>
            <Button
              variant="secondary"
              size="xs"
              onClick={() => handleCreateFolder(null)}
            >
              <FolderPlus className="h-3.5 w-3.5" />
              New Folder
            </Button>
          </CardHeader>

          {/* Error banner */}
          {error && (
            <div className="border-b border-danger/20 bg-danger/5 px-4 py-2">
              <p className="text-xs text-danger">{error}</p>
            </div>
          )}

          {loading ? (
            <div className="flex flex-1 items-center justify-center">
              <div className="h-5 w-5 animate-spin rounded-full border-2 border-accent border-t-transparent" />
            </div>
          ) : (
            <TreeView
              nodes={treeNodes}
              selectedId={selectedTreeId}
              onSelect={handleSelect}
              onCreateFolder={handleCreateFolder}
              onRename={handleRename}
              onDelete={handleDelete}
              renderActions={renderActions}
              searchable
              className="flex-1 min-h-0"
            />
          )}
        </Card>
      </div>

      {/* ─── Right: Book Details ─── */}
      <div className="w-[60%]">
        <Card className="flex h-full flex-col overflow-hidden">
          <CardHeader>
            <CardTitle>
              {selectedBook ? "Book Details" : "Select a Book"}
            </CardTitle>
          </CardHeader>

          <CardBody className="flex-1 overflow-y-auto">
            {!selectedBook ? (
              <EmptyState>
                Click a knowledge book in the tree to view its details.
              </EmptyState>
            ) : (
              <div className="space-y-4">
                <div>
                  <p className="text-[11px] font-medium text-fg/40 uppercase tracking-wider">
                    Name
                  </p>
                  <p className="mt-1 text-sm font-medium text-fg">
                    {selectedBook.name}
                  </p>
                </div>

                {selectedBook.description && (
                  <div>
                    <p className="text-[11px] font-medium text-fg/40 uppercase tracking-wider">
                      Description
                    </p>
                    <p className="mt-1 text-sm text-fg/70">
                      {selectedBook.description}
                    </p>
                  </div>
                )}

                <div className="flex items-center gap-4">
                  <div>
                    <p className="text-[11px] font-medium text-fg/40 uppercase tracking-wider">
                      Status
                    </p>
                    <div className="mt-1">
                      <Badge tone={statusTone(selectedBook.status)}>
                        {selectedBook.status}
                      </Badge>
                    </div>
                  </div>
                  <div>
                    <p className="text-[11px] font-medium text-fg/40 uppercase tracking-wider">
                      Category
                    </p>
                    <p className="mt-1 text-sm text-fg/70">
                      {categoryLabel(selectedBook.category)}
                    </p>
                  </div>
                  <div>
                    <p className="text-[11px] font-medium text-fg/40 uppercase tracking-wider">
                      Scope
                    </p>
                    <Badge tone={selectedBook.scope === "global" ? "info" : "default"}>
                      {selectedBook.scope}
                    </Badge>
                  </div>
                </div>

                <div className="flex items-center gap-4">
                  {selectedBook.pageCount > 0 && (
                    <div>
                      <p className="text-[11px] font-medium text-fg/40 uppercase tracking-wider">
                        Pages
                      </p>
                      <p className="mt-1 text-sm text-fg">
                        {selectedBook.pageCount}
                      </p>
                    </div>
                  )}
                  {selectedBook.chunkCount > 0 && (
                    <div>
                      <p className="text-[11px] font-medium text-fg/40 uppercase tracking-wider">
                        Chunks
                      </p>
                      <p className="mt-1 text-sm text-fg">
                        {selectedBook.chunkCount}
                      </p>
                    </div>
                  )}
                </div>

                <div>
                  <p className="text-[11px] font-medium text-fg/40 uppercase tracking-wider">
                    Source File
                  </p>
                  <p className="mt-1 text-sm text-fg/70 break-all">
                    {selectedBook.sourceFileName}
                  </p>
                </div>

                <div className="flex gap-2 pt-2 flex-wrap">
                  <Button
                    variant="secondary"
                    size="xs"
                    onClick={() => {
                      setMovingBookId(selectedBook.id);
                      setMoveTargetFolderId(null);
                    }}
                  >
                    <MoveRight className="h-3.5 w-3.5" />
                    Move to Folder
                  </Button>
                  {isImportableSourceFile(selectedBook.sourceFileName) && (
                    <Button
                      variant="secondary"
                      size="xs"
                      onClick={async () => {
                        setImportBookId(selectedBook.id);
                        setImportSourceLabel(selectedBook.sourceFileName ?? "");
                        setImportLoading(true);
                        try {
                          const [analysis, catalogs] = await Promise.all([
                            analyzeKnowledgeBookForImport(selectedBook.id),
                            getCatalogs(),
                          ]);
                          setImportAnalysis(analysis);
                          setImportCatalogs(catalogs);
                        } catch (e: any) {
                          setError(e?.message ?? "Failed to analyze for import");
                          setImportBookId(null);
                        } finally {
                          setImportLoading(false);
                        }
                      }}
                      disabled={importLoading}
                      title="Use AI to map columns and import this file's rows into a catalog as line items"
                    >
                      <FileSpreadsheet className="h-3.5 w-3.5" />
                      {importLoading ? "Analyzing…" : "Import as line items"}
                    </Button>
                  )}
                </div>
              </div>
            )}
          </CardBody>
        </Card>
      </div>

      {/* ─── Move Book Modal ─── */}
      <ModalBackdrop
        open={movingBookId !== null}
        onClose={() => setMovingBookId(null)}
        size="sm"
      >
        <Card>
          <CardHeader>
            <CardTitle>Move Book to Folder</CardTitle>
          </CardHeader>
          <CardBody className="space-y-4">
            <Select
              value={moveTargetFolderId ?? ""}
              onChange={(e) =>
                setMoveTargetFolderId(e.target.value || null)
              }
            >
              <option value="">(Root - no folder)</option>
              {folderList.map((f) => (
                <option key={f.id} value={FOLDER_PREFIX + f.id}>
                  {f.name}
                </option>
              ))}
            </Select>
            <div className="flex justify-end gap-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setMovingBookId(null)}
              >
                Cancel
              </Button>
              <Button
                variant="accent"
                size="sm"
                onClick={() => {
                  if (movingBookId) {
                    handleMoveBook(movingBookId, moveTargetFolderId);
                  }
                }}
              >
                Move
              </Button>
            </div>
          </CardBody>
        </Card>
      </ModalBackdrop>

      <CatalogImportModal
        open={importBookId !== null && importAnalysis !== null}
        onClose={() => {
          setImportBookId(null);
          setImportAnalysis(null);
          setImportSourceLabel("");
        }}
        catalogs={importCatalogs}
        prefillAnalysis={importAnalysis}
        sourceLabel={importSourceLabel}
        onImported={() => {
          setImportBookId(null);
          setImportAnalysis(null);
          setImportSourceLabel("");
        }}
      />
    </div>
  );
}

function isImportableSourceFile(fileName: string | undefined | null): boolean {
  if (!fileName) return false;
  const lower = fileName.toLowerCase();
  return /\.(csv|xlsx|xls|xlsm|pdf)$/.test(lower);
}
