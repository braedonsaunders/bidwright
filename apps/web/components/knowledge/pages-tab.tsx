"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Check,
  FileText,
  FolderPlus,
  Loader2,
  MoveRight,
  NotebookText,
  Plus,
  Search,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";
import {
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  CardTitle,
  EmptyState,
  Input,
  Label,
  ModalBackdrop,
  Select,
  Textarea,
} from "@/components/ui";
import { ConfirmModal } from "@/components/workspace/modals";
import { MarkdownRenderer } from "@/components/markdown-renderer";
import {
  CabinetDirectorySidebar,
  cabinetPathLabel,
  MoveToCabinetModal,
  type LibraryDirectoryView,
} from "@/components/knowledge/library-directory-sidebar";
import { KnowledgeDocumentEditor } from "@/components/knowledge/knowledge-document-editor";
import {
  createKnowledgeDocument,
  createKnowledgeDocumentPage,
  createKnowledgeLibraryCabinet,
  deleteKnowledgeDocument,
  deleteKnowledgeDocumentPage,
  deleteKnowledgeLibraryCabinet,
  listKnowledgeDocumentPages,
  reindexKnowledgeDocument,
  updateKnowledgeDocument,
  updateKnowledgeDocumentPage,
  updateKnowledgeLibraryCabinet,
  type KnowledgeBookRecord,
  type KnowledgeDocumentPageRecord,
  type KnowledgeDocumentRecord,
  type KnowledgeLibraryCabinetRecord,
} from "@/lib/api";
import {
  EMPTY_DOCUMENT_CONTENT,
  markdownToTiptapJson,
  tiptapJsonToMarkdown,
  tiptapJsonToPlainText,
} from "@/lib/knowledge-document-content";
import { cn } from "@/lib/utils";

const PAGE_CATEGORIES = [
  "estimating",
  "labour",
  "equipment",
  "materials",
  "safety",
  "standards",
  "general",
] as const;

function compareByTitle<T extends { title: string }>(left: T, right: T) {
  return left.title.localeCompare(right.title, undefined, { sensitivity: "base" });
}

function categoryLabel(cat: string) {
  return cat.replace(/_/g, " ").replace(/\b\w/g, (char) => char.toUpperCase());
}

function scopeTone(scope: string) {
  return scope === "global" ? ("default" as const) : ("warning" as const);
}

function statusTone(status: string) {
  if (status === "indexed") return "success" as const;
  if (status === "indexing") return "warning" as const;
  return "default" as const;
}

function matchesLibraryView(cabinetId: string | null, view: LibraryDirectoryView) {
  if (view.kind === "all") return true;
  if (view.kind === "unassigned") return !cabinetId;
  return cabinetId === view.cabinetId;
}

export function PagesTab({
  cabinets,
  documents,
  onCabinetsRefresh,
  onRefresh,
}: {
  cabinets: KnowledgeLibraryCabinetRecord[];
  documents: KnowledgeDocumentRecord[];
  books: KnowledgeBookRecord[];
  onCabinetsRefresh: () => void;
  onRefresh: () => void;
}) {
  const [selectedDocumentId, setSelectedDocumentId] = useState<string | null>(documents[0]?.id ?? null);
  const [pages, setPages] = useState<KnowledgeDocumentPageRecord[]>([]);
  const [activePageId, setActivePageId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [view, setView] = useState<LibraryDirectoryView>({ kind: "all" });
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [movingDocument, setMovingDocument] = useState<KnowledgeDocumentRecord | null>(null);
  const [moveTargetCabinetId, setMoveTargetCabinetId] = useState("__root__");
  const [savingMove, setSavingMove] = useState(false);
  const [documentToDelete, setDocumentToDelete] = useState<KnowledgeDocumentRecord | null>(null);
  const [deletingDocumentId, setDeletingDocumentId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const documentCabinets = useMemo(
    () => cabinets.filter((cabinet) => cabinet.itemType === "document").sort((a, b) => a.name.localeCompare(b.name)),
    [cabinets],
  );

  const cabinetsById = useMemo(
    () => new Map(documentCabinets.map((cabinet) => [cabinet.id, cabinet])),
    [documentCabinets],
  );

  const selectedDocument = useMemo(
    () => documents.find((document) => document.id === selectedDocumentId) ?? documents[0] ?? null,
    [documents, selectedDocumentId],
  );

  const refreshPages = useCallback(async () => {
    if (!selectedDocument) {
      setPages([]);
      setActivePageId(null);
      return;
    }
    try {
      const nextPages = await listKnowledgeDocumentPages(selectedDocument.id);
      setPages(nextPages);
      setActivePageId((current) => current && nextPages.some((page) => page.id === current) ? current : nextPages[0]?.id ?? null);
    } catch {
      setPages([]);
      setActivePageId(null);
    }
  }, [selectedDocument]);

  useEffect(() => {
    refreshPages();
  }, [refreshPages]);

  useEffect(() => {
    if (view.kind === "cabinet" && !cabinetsById.has(view.cabinetId)) {
      setView({ kind: "all" });
    }
  }, [cabinetsById, view]);

  const filteredDocuments = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    return documents
      .filter((document) => matchesLibraryView(document.cabinetId, view))
      .filter((document) => {
        if (!query) return true;
        return [
          document.title,
          document.description,
          document.category,
          document.scope,
          ...(document.tags ?? []),
        ].some((value) => value.toLowerCase().includes(query));
      })
      .sort(compareByTitle);
  }, [documents, searchQuery, view]);

  const defaultCabinetId = view.kind === "cabinet" ? view.cabinetId : null;

  const handleCreateCabinet = async (parentId: string | null) => {
    const name = prompt("Folder name");
    if (!name?.trim()) return;
    try {
      const cabinet = await createKnowledgeLibraryCabinet({ name: name.trim(), itemType: "document", parentId });
      await onCabinetsRefresh();
      setView({ kind: "cabinet", cabinetId: cabinet.id });
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create folder");
    }
  };

  const handleRenameCabinet = async (cabinetId: string, name: string) => {
    try {
      await updateKnowledgeLibraryCabinet(cabinetId, { name });
      await onCabinetsRefresh();
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to rename folder");
    }
  };

  const handleDeleteCabinet = async (cabinetId: string) => {
    const cabinet = cabinetsById.get(cabinetId);
    if (!cabinet) return;
    if (!confirm(`Delete folder "${cabinet.name}"? Pages inside will become unassigned.`)) return;
    try {
      await deleteKnowledgeLibraryCabinet(cabinetId);
      await onCabinetsRefresh();
      if (view.kind === "cabinet" && view.cabinetId === cabinetId) setView({ kind: "all" });
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete folder");
    }
  };

  const handleMoveSave = async () => {
    if (!movingDocument) return;
    setSavingMove(true);
    try {
      await updateKnowledgeDocument(movingDocument.id, {
        cabinetId: moveTargetCabinetId === "__root__" ? null : moveTargetCabinetId,
      });
      await onRefresh();
      setMovingDocument(null);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to move page library");
    } finally {
      setSavingMove(false);
    }
  };

  const handleConfirmDeleteDocument = async () => {
    if (!documentToDelete) return;
    setDeletingDocumentId(documentToDelete.id);
    try {
      await deleteKnowledgeDocument(documentToDelete.id);
      if (selectedDocumentId === documentToDelete.id) setSelectedDocumentId(null);
      await onRefresh();
      setDocumentToDelete(null);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete page library");
    } finally {
      setDeletingDocumentId(null);
    }
  };

  return (
    <>
      <div className="grid h-full min-h-0 gap-5 xl:grid-cols-[280px_minmax(0,390px)_minmax(0,1fr)]">
        <CabinetDirectorySidebar
          cabinets={documentCabinets}
          emptyLabel="Organize manual pages into folders."
          itemLabelPlural="Pages"
          onCreateCabinet={handleCreateCabinet}
          onDeleteCabinet={handleDeleteCabinet}
          onRenameCabinet={handleRenameCabinet}
          selectedView={view}
          onSelectView={setView}
        />

        <Card className="flex min-h-0 flex-col overflow-hidden">
          <CardHeader className="border-b border-line">
            <div className="flex items-center justify-between gap-3">
              <div>
                <CardTitle className="text-sm">Page Libraries</CardTitle>
                <p className="mt-1 text-xs text-fg/40">{filteredDocuments.length} libraries</p>
              </div>
              <Button size="xs" onClick={() => setShowCreateModal(true)}>
                <Plus className="h-3.5 w-3.5" />
                New
              </Button>
            </div>
            <div className="relative mt-3">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-fg/30" />
              <Input
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                placeholder="Search pages..."
                className="pl-8 text-xs"
              />
            </div>
            {error && <p className="mt-2 text-xs text-danger">{error}</p>}
          </CardHeader>

          <CardBody className="min-h-0 flex-1 overflow-y-auto p-3">
            {filteredDocuments.length === 0 ? (
              <EmptyState>
                <NotebookText className="mx-auto mb-2 h-8 w-8 text-fg/20" />
                <p className="text-sm text-fg/50">No pages here yet.</p>
              </EmptyState>
            ) : (
              <div className="space-y-2">
                {filteredDocuments.map((document) => {
                  const folder = cabinetPathLabel(document.cabinetId, cabinetsById);
                  const selected = selectedDocument?.id === document.id;
                  return (
                    <button
                      key={document.id}
                      type="button"
                      onClick={() => setSelectedDocumentId(document.id)}
                      className={cn(
                        "w-full rounded-lg border p-3 text-left transition-colors",
                        selected ? "border-accent/45 bg-accent/10" : "border-line bg-panel2/20 hover:bg-panel2/45",
                      )}
                    >
                      <div className="flex items-start gap-3">
                        <div className="mt-0.5 rounded-md border border-line bg-panel p-1.5 text-fg/55">
                          <FileText className="h-4 w-4" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <p className="truncate text-sm font-semibold text-fg">{document.title}</p>
                            <Badge tone={statusTone(document.status)}>{document.status}</Badge>
                          </div>
                          <p className="mt-1 line-clamp-2 text-xs text-fg/45">{document.description || "Manual knowledge pages"}</p>
                          <div className="mt-2 flex flex-wrap items-center gap-1.5">
                            <Badge tone="default">{categoryLabel(document.category)}</Badge>
                            <Badge tone={scopeTone(document.scope)}>{document.scope}</Badge>
                            <span className="text-[11px] text-fg/35">{document.pageCount} pages</span>
                            {folder && <span className="truncate text-[11px] text-fg/35">{folder}</span>}
                          </div>
                        </div>
                        <div className="flex shrink-0 flex-col gap-1">
                          <Button
                            size="xs"
                            variant="ghost"
                            title="Move"
                            onClick={(event) => {
                              event.stopPropagation();
                              setMovingDocument(document);
                              setMoveTargetCabinetId(document.cabinetId ?? "__root__");
                            }}
                            className="h-7 w-7 px-0"
                          >
                            <MoveRight className="h-3.5 w-3.5" />
                          </Button>
                          <Button
                            size="xs"
                            variant="ghost"
                            title="Delete"
                            onClick={(event) => {
                              event.stopPropagation();
                              setDocumentToDelete(document);
                            }}
                            className="h-7 w-7 px-0 text-danger hover:text-danger"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </CardBody>
        </Card>

        {selectedDocument ? (
          <KnowledgeDocumentDetail
            document={selectedDocument}
            pages={pages}
            activePageId={activePageId}
            onActivePageChange={setActivePageId}
            onPagesRefresh={refreshPages}
            onRefresh={onRefresh}
          />
        ) : (
          <EmptyState>
            <FolderPlus className="mx-auto mb-2 h-8 w-8 text-fg/20" />
            <p className="text-sm text-fg/50">Create a page library to begin.</p>
          </EmptyState>
        )}
      </div>

      {showCreateModal && (
        <CreateKnowledgeDocumentModal
          defaultCabinetId={defaultCabinetId}
          onClose={() => setShowCreateModal(false)}
          onCreated={(documentId) => {
            setShowCreateModal(false);
            setSelectedDocumentId(documentId);
            onRefresh();
          }}
        />
      )}

      {movingDocument && (
        <MoveToCabinetModal
          activeType="document"
          cabinets={documentCabinets}
          itemName={movingDocument.title}
          onClose={() => setMovingDocument(null)}
          onConfirm={handleMoveSave}
          onValueChange={setMoveTargetCabinetId}
          saving={savingMove}
          value={moveTargetCabinetId}
        />
      )}

      <ConfirmModal
        open={documentToDelete !== null}
        onClose={() => {
          if (!deletingDocumentId) setDocumentToDelete(null);
        }}
        title="Delete Page Library"
        message={`Delete "${documentToDelete?.title ?? "this page library"}"? This removes all pages and indexed chunks.`}
        confirmLabel="Delete"
        confirmVariant="danger"
        isPending={deletingDocumentId !== null}
        onConfirm={handleConfirmDeleteDocument}
      />
    </>
  );
}

function KnowledgeDocumentDetail({
  activePageId,
  document,
  onActivePageChange,
  onPagesRefresh,
  onRefresh,
  pages,
}: {
  activePageId: string | null;
  document: KnowledgeDocumentRecord;
  pages: KnowledgeDocumentPageRecord[];
  onActivePageChange: (pageId: string | null) => void;
  onPagesRefresh: () => void;
  onRefresh: () => void;
}) {
  const activePage = pages.find((page) => page.id === activePageId) ?? pages[0] ?? null;
  const [mode, setMode] = useState<"edit" | "preview" | "source">("edit");
  const [draftContent, setDraftContent] = useState<{
    contentJson: Record<string, unknown>;
    contentMarkdown: string;
    plainText: string;
  } | null>(null);
  const [sourceDraft, setSourceDraft] = useState("");
  const [pageTitleDraft, setPageTitleDraft] = useState("");
  const [titleDraft, setTitleDraft] = useState("");
  const [tagsDraft, setTagsDraft] = useState("");
  const [descriptionDraft, setDescriptionDraft] = useState("");
  const [categoryDraft, setCategoryDraft] = useState<KnowledgeDocumentRecord["category"]>("general");
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [reindexing, setReindexing] = useState(false);
  const [pageToDelete, setPageToDelete] = useState<KnowledgeDocumentPageRecord | null>(null);

  useEffect(() => {
    setTitleDraft(document.title);
    setDescriptionDraft(document.description);
    setTagsDraft((document.tags ?? []).join(", "));
    setCategoryDraft(document.category);
  }, [document]);

  useEffect(() => {
    setDraftContent(null);
    setSourceDraft(activePage?.contentMarkdown ?? "");
    setPageTitleDraft(activePage?.title ?? "");
    setSaveState("idle");
  }, [activePage?.id, activePage?.contentMarkdown, activePage?.title]);

  useEffect(() => {
    if (!activePage || !draftContent) return;
    setSaveState("saving");
    const timer = window.setTimeout(async () => {
      try {
        await updateKnowledgeDocumentPage(document.id, activePage.id, draftContent);
        setSaveState("saved");
        onPagesRefresh();
        onRefresh();
      } catch {
        setSaveState("error");
      }
    }, 900);
    return () => window.clearTimeout(timer);
  }, [activePage, document.id, draftContent, onPagesRefresh, onRefresh]);

  const handleCreatePage = async () => {
    const title = prompt("Page title");
    if (!title?.trim()) return;
    const contentJson = markdownToTiptapJson(`# ${title.trim()}`);
    try {
      const page = await createKnowledgeDocumentPage(document.id, {
        title: title.trim(),
        contentJson,
        contentMarkdown: tiptapJsonToMarkdown(contentJson),
        plainText: tiptapJsonToPlainText(contentJson),
      });
      await onPagesRefresh();
      await onRefresh();
      onActivePageChange(page.id);
    } catch {
      setSaveState("error");
    }
  };

  const handleSaveDocument = async () => {
    setSaveState("saving");
    try {
      await updateKnowledgeDocument(document.id, {
        title: titleDraft,
        description: descriptionDraft,
        category: categoryDraft,
        tags: tagsDraft.split(",").map((tag) => tag.trim()).filter(Boolean),
      });
      await onRefresh();
      setSaveState("saved");
    } catch {
      setSaveState("error");
    }
  };

  const handleSaveSource = async () => {
    if (!activePage) return;
    const contentJson = markdownToTiptapJson(sourceDraft);
    const payload = {
      contentJson,
      contentMarkdown: sourceDraft,
      plainText: tiptapJsonToPlainText(contentJson),
    };
    setDraftContent(payload);
    setMode("edit");
  };

  const handleReindex = async () => {
    setReindexing(true);
    try {
      await reindexKnowledgeDocument(document.id);
      await onRefresh();
      setSaveState("saved");
    } catch {
      setSaveState("error");
    } finally {
      setReindexing(false);
    }
  };

  const handleDeletePage = async () => {
    if (!pageToDelete) return;
    try {
      await deleteKnowledgeDocumentPage(document.id, pageToDelete.id);
      await onPagesRefresh();
      await onRefresh();
      setPageToDelete(null);
    } catch {
      setSaveState("error");
    }
  };

  return (
    <>
      <Card className="flex min-h-0 flex-col overflow-hidden">
        <CardHeader className="border-b border-line">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <Input
                value={titleDraft}
                onChange={(event) => setTitleDraft(event.target.value)}
                onBlur={handleSaveDocument}
                className="h-9 border-transparent bg-transparent px-0 text-base font-semibold"
              />
              <Textarea
                value={descriptionDraft}
                onChange={(event) => setDescriptionDraft(event.target.value)}
                onBlur={handleSaveDocument}
                rows={2}
                placeholder="Description"
                className="mt-1 min-h-0 resize-none border-transparent bg-transparent px-0 text-xs text-fg/50"
              />
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <Select
                  value={categoryDraft}
                  onChange={(event) => setCategoryDraft(event.target.value as KnowledgeDocumentRecord["category"])}
                  onBlur={handleSaveDocument}
                  className="h-8 w-36 text-xs"
                >
                  {PAGE_CATEGORIES.map((category) => (
                    <option key={category} value={category}>{categoryLabel(category)}</option>
                  ))}
                </Select>
                <Input
                  value={tagsDraft}
                  onChange={(event) => setTagsDraft(event.target.value)}
                  onBlur={handleSaveDocument}
                  placeholder="tags, comma separated"
                  className="h-8 min-w-[180px] flex-1 text-xs"
                />
                <Badge tone={statusTone(document.status)}>{document.status}</Badge>
                <Badge tone={scopeTone(document.scope)}>{document.scope}</Badge>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Button size="xs" variant="secondary" onClick={handleReindex} disabled={reindexing}>
                {reindexing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
                Index
              </Button>
              <div className="min-w-16 text-right text-[11px] text-fg/40">
                {saveState === "saving" && "Saving"}
                {saveState === "saved" && <span className="inline-flex items-center gap-1"><Check className="h-3 w-3" /> Saved</span>}
                {saveState === "error" && <span className="text-danger">Error</span>}
              </div>
            </div>
          </div>
        </CardHeader>

        <div className="grid min-h-0 flex-1 grid-cols-[220px_minmax(0,1fr)]">
          <div className="min-h-0 border-r border-line bg-panel2/15">
            <div className="flex items-center justify-between gap-2 border-b border-line px-3 py-2">
              <span className="text-xs font-semibold text-fg/60">Pages</span>
              <Button size="xs" variant="ghost" title="New page" onClick={handleCreatePage} className="h-7 w-7 px-0">
                <Plus className="h-3.5 w-3.5" />
              </Button>
            </div>
            <div className="min-h-0 space-y-1 overflow-y-auto p-2">
              {pages.map((page) => (
                <button
                  key={page.id}
                  type="button"
                  onClick={() => onActivePageChange(page.id)}
                  className={cn(
                    "group flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-xs",
                    activePage?.id === page.id ? "bg-accent/10 text-accent" : "text-fg/65 hover:bg-panel2",
                  )}
                >
                  <FileText className="h-3.5 w-3.5 shrink-0" />
                  <span className="min-w-0 flex-1 truncate">{page.title}</span>
                  <span
                    role="button"
                    tabIndex={0}
                    title="Delete page"
                    onClick={(event) => {
                      event.stopPropagation();
                      setPageToDelete(page);
                    }}
                    className="rounded p-1 text-fg/25 opacity-0 hover:bg-danger/10 hover:text-danger group-hover:opacity-100"
                  >
                    <Trash2 className="h-3 w-3" />
                  </span>
                </button>
              ))}
            </div>
          </div>

          <div className="flex min-h-0 flex-col">
            {activePage ? (
              <>
                <div className="flex items-center justify-between gap-3 border-b border-line px-3 py-2">
                  <Input
                    value={pageTitleDraft}
                    onChange={(event) => setPageTitleDraft(event.target.value)}
                    onBlur={() => {
                      if (!pageTitleDraft.trim() || pageTitleDraft.trim() === activePage.title) return;
                      void updateKnowledgeDocumentPage(document.id, activePage.id, { title: pageTitleDraft.trim() }).then(() => {
                        onPagesRefresh();
                        onRefresh();
                      });
                    }}
                    className="h-8 max-w-sm border-transparent bg-transparent px-0 text-sm font-semibold"
                  />
                  <div className="flex items-center gap-1 rounded-md border border-line bg-panel2/30 p-0.5">
                    {(["edit", "preview", "source"] as const).map((nextMode) => (
                      <button
                        key={nextMode}
                        type="button"
                        onClick={() => setMode(nextMode)}
                        className={cn(
                          "rounded px-2 py-1 text-[11px] font-medium capitalize",
                          mode === nextMode ? "bg-panel text-fg shadow-sm" : "text-fg/45 hover:text-fg/70",
                        )}
                      >
                        {nextMode}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="min-h-0 flex-1 p-3">
                  {mode === "edit" && (
                    <KnowledgeDocumentEditor
                      key={activePage.id}
                      contentJson={(draftContent?.contentJson ?? activePage.contentJson ?? EMPTY_DOCUMENT_CONTENT) as Record<string, unknown>}
                      onChange={setDraftContent}
                    />
                  )}
                  {mode === "preview" && (
                    <div className="h-full overflow-auto rounded-lg border border-line bg-bg p-5">
                      <MarkdownRenderer content={draftContent?.contentMarkdown ?? activePage.contentMarkdown} />
                    </div>
                  )}
                  {mode === "source" && (
                    <div className="flex h-full min-h-0 flex-col gap-2">
                      <Textarea
                        value={sourceDraft}
                        onChange={(event) => setSourceDraft(event.target.value)}
                        className="min-h-0 flex-1 resize-none font-mono text-xs"
                      />
                      <div className="flex justify-end">
                        <Button size="sm" onClick={handleSaveSource}>
                          <Check className="h-3.5 w-3.5" />
                          Apply
                        </Button>
                      </div>
                    </div>
                  )}
                </div>
              </>
            ) : (
              <EmptyState>
                <FileText className="mx-auto mb-2 h-8 w-8 text-fg/20" />
                <p className="text-sm text-fg/50">Add a page to this library.</p>
              </EmptyState>
            )}
          </div>
        </div>
      </Card>

      <ConfirmModal
        open={pageToDelete !== null}
        onClose={() => setPageToDelete(null)}
        title="Delete Page"
        message={`Delete "${pageToDelete?.title ?? "this page"}"?`}
        confirmLabel="Delete"
        confirmVariant="danger"
        onConfirm={handleDeletePage}
      />
    </>
  );
}

function CreateKnowledgeDocumentModal({
  defaultCabinetId,
  onClose,
  onCreated,
}: {
  defaultCabinetId: string | null;
  onClose: () => void;
  onCreated: (documentId: string) => void;
}) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState<KnowledgeDocumentRecord["category"]>("general");
  const [tags, setTags] = useState("");
  const [markdown, setMarkdown] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleCreate = async () => {
    if (!title.trim()) return;
    setSaving(true);
    setError(null);
    const contentJson = markdown.trim() ? markdownToTiptapJson(markdown) : markdownToTiptapJson(`# ${title.trim()}`);
    try {
      const document = await createKnowledgeDocument({
        title: title.trim(),
        description,
        category,
        cabinetId: defaultCabinetId,
        tags: tags.split(",").map((tag) => tag.trim()).filter(Boolean),
        pageTitle: title.trim(),
        contentJson,
        contentMarkdown: markdown.trim() || tiptapJsonToMarkdown(contentJson),
        plainText: tiptapJsonToPlainText(contentJson),
      });
      onCreated(document.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create page library");
    } finally {
      setSaving(false);
    }
  };

  return (
    <ModalBackdrop open={true} onClose={onClose} size="lg">
      <div className="w-full max-w-2xl rounded-xl border border-line bg-panel p-5 shadow-xl" onClick={(event) => event.stopPropagation()}>
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold text-fg">New Page Library</h2>
            <p className="mt-1 text-xs text-fg/45">Create manual knowledge pages for estimator research.</p>
          </div>
          <button type="button" onClick={onClose} className="rounded p-1 text-fg/35 hover:bg-panel2 hover:text-fg/60">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="mt-5 grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label className="text-xs">Title</Label>
            <Input value={title} onChange={(event) => setTitle(event.target.value)} autoFocus />
          </div>
          <div className="space-y-2">
            <Label className="text-xs">Category</Label>
            <Select value={category} onChange={(event) => setCategory(event.target.value as KnowledgeDocumentRecord["category"])}>
              {PAGE_CATEGORIES.map((value) => (
                <option key={value} value={value}>{categoryLabel(value)}</option>
              ))}
            </Select>
          </div>
          <div className="space-y-2 sm:col-span-2">
            <Label className="text-xs">Description</Label>
            <Textarea value={description} onChange={(event) => setDescription(event.target.value)} rows={2} />
          </div>
          <div className="space-y-2 sm:col-span-2">
            <Label className="text-xs">Tags</Label>
            <Input value={tags} onChange={(event) => setTags(event.target.value)} placeholder="pipe, labour, safety" />
          </div>
          <div className="space-y-2 sm:col-span-2">
            <Label className="text-xs">Initial Markdown</Label>
            <Textarea
              value={markdown}
              onChange={(event) => setMarkdown(event.target.value)}
              rows={9}
              placeholder="Paste markdown, notes, or tables..."
              className="font-mono text-xs"
            />
          </div>
        </div>

        {error && <p className="mt-3 text-xs text-danger">{error}</p>}

        <div className="mt-5 flex justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button size="sm" onClick={handleCreate} disabled={saving || !title.trim()}>
            {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
            Create
          </Button>
        </div>
      </div>
    </ModalBackdrop>
  );
}
