"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import * as Popover from "@radix-ui/react-popover";
import {
  ArrowLeft,
  Check,
  FileText,
  FolderPlus,
  Loader2,
  MoreHorizontal,
  MoveRight,
  Plus,
  Search,
  Sparkles,
  Trash2,
} from "lucide-react";
import {
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  EmptyState,
  Input,
  Select,
  Textarea,
} from "@/components/ui";
import { ConfirmModal } from "@/components/workspace/modals";
import { MarkdownRenderer } from "@/components/markdown-renderer";
import {
  CabinetDirectorySidebar,
  cabinetDescendantIds,
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
  deleteKnowledgeLibraryCabinet,
  listKnowledgeDocumentPages,
  reindexKnowledgeDocument,
  updateKnowledgeDocument,
  updateKnowledgeDocumentPage,
  updateKnowledgeLibraryCabinet,
  type KnowledgeDocumentPageRecord,
  type KnowledgeDocumentRecord,
  type KnowledgeLibraryCabinetRecord,
} from "@/lib/api";
import {
  EMPTY_DOCUMENT_CONTENT,
  markdownToTiptapJson,
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

function matchesFolderView(
  cabinetId: string | null,
  view: LibraryDirectoryView,
  visibleCabinetIds: Set<string> | null,
) {
  if (view.kind === "all") return true;
  if (view.kind === "unassigned") return !cabinetId;
  return cabinetId ? visibleCabinetIds?.has(cabinetId) ?? cabinetId === view.cabinetId : false;
}

function nextUntitledTitle(documents: KnowledgeDocumentRecord[]) {
  const taken = new Set(documents.map((document) => document.title.toLowerCase()));
  if (!taken.has("untitled page")) return "Untitled Page";
  let index = 2;
  while (taken.has(`untitled page ${index}`)) index += 1;
  return `Untitled Page ${index}`;
}

export function PagesTab({
  cabinets,
  documents,
  onCabinetsRefresh,
  onRefresh,
}: {
  cabinets: KnowledgeLibraryCabinetRecord[];
  documents: KnowledgeDocumentRecord[];
  onCabinetsRefresh: () => void | Promise<void>;
  onRefresh: () => void | Promise<void>;
}) {
  const [selectedDocumentId, setSelectedDocumentId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [view, setView] = useState<LibraryDirectoryView>({ kind: "all" });
  const [creating, setCreating] = useState(false);
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

  const visibleCabinetIds = useMemo(
    () => (view.kind === "cabinet" ? cabinetDescendantIds(documentCabinets, view.cabinetId) : null),
    [documentCabinets, view],
  );

  const selectedDocument = useMemo(
    () => documents.find((document) => document.id === selectedDocumentId) ?? null,
    [documents, selectedDocumentId],
  );

  useEffect(() => {
    if (view.kind === "cabinet" && !cabinetsById.has(view.cabinetId)) {
      setView({ kind: "all" });
    }
  }, [cabinetsById, view]);

  useEffect(() => {
    setSelectedDocumentId(null);
  }, [view]);

  useEffect(() => {
    if (!selectedDocumentId) return;
    if (!documents.some((document) => document.id === selectedDocumentId)) {
      setSelectedDocumentId(null);
    }
  }, [documents, selectedDocumentId]);

  const filteredDocuments = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    return documents
      .filter((document) => matchesFolderView(document.cabinetId, view, visibleCabinetIds))
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
  }, [documents, searchQuery, view, visibleCabinetIds]);

  const defaultCabinetId = view.kind === "cabinet" ? view.cabinetId : null;
  const activeFolderLabel =
    view.kind === "all"
      ? "All Pages"
      : view.kind === "unassigned"
        ? "Unassigned"
        : cabinetPathLabel(view.cabinetId, cabinetsById) ?? "Folder";

  const handleCreateCabinet = async (parentId: string | null) => {
    try {
      const cabinet = await createKnowledgeLibraryCabinet({
        name: "New Folder",
        itemType: "document",
        parentId,
      });
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

  const handleCreateDocument = async () => {
    if (creating) return;
    setCreating(true);
    setError(null);
    const title = nextUntitledTitle(documents);
    try {
      const document = await createKnowledgeDocument({
        title,
        description: "",
        category: "general",
        cabinetId: defaultCabinetId,
        tags: [],
        pageTitle: title,
        contentJson: EMPTY_DOCUMENT_CONTENT,
        contentMarkdown: "",
        plainText: "",
      });
      await onRefresh();
      setSelectedDocumentId(document.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create page");
    } finally {
      setCreating(false);
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
      setError(err instanceof Error ? err.message : "Failed to move page");
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
      setError(err instanceof Error ? err.message : "Failed to delete page");
    } finally {
      setDeletingDocumentId(null);
    }
  };

  return (
    <>
      <div className="grid h-full min-h-0 gap-4 xl:grid-cols-[280px_minmax(0,1fr)]">
        <CabinetDirectorySidebar
          cabinets={documentCabinets}
          emptyLabel="Create folders and subfolders for manual pages."
          itemLabelPlural="Pages"
          onCreateCabinet={handleCreateCabinet}
          onDeleteCabinet={handleDeleteCabinet}
          onRenameCabinet={handleRenameCabinet}
          selectedView={view}
          onSelectView={setView}
        />

        <Card className="flex min-h-0 flex-col overflow-hidden">
          <CardHeader className="border-b border-line px-4 py-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="min-w-0">
                <h2 className="truncate text-sm font-semibold text-fg">{activeFolderLabel}</h2>
                <p className="mt-0.5 text-xs text-fg/40">{filteredDocuments.length} pages</p>
              </div>
              <div className="flex min-w-[260px] flex-1 items-center justify-end gap-2">
                {!selectedDocument && (
                  <div className="relative max-w-sm flex-1">
                    <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-fg/25" />
                    <Input
                      className="h-8 pl-8 text-xs"
                      placeholder="Search pages..."
                      value={searchQuery}
                      onChange={(event) => setSearchQuery(event.target.value)}
                    />
                  </div>
                )}
                <Button size="sm" onClick={handleCreateDocument} disabled={creating}>
                  {creating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
                  New Page
                </Button>
              </div>
            </div>
            {error && <p className="mt-2 text-xs text-danger">{error}</p>}
          </CardHeader>

          <CardBody className="min-h-0 flex-1 overflow-hidden p-0">
            {selectedDocument ? (
              <KnowledgeDocumentDetail
                document={selectedDocument}
                onBack={() => setSelectedDocumentId(null)}
                onRefresh={onRefresh}
              />
            ) : (
              <PageDocumentList
                cabinetsById={cabinetsById}
                documents={filteredDocuments}
                onDelete={setDocumentToDelete}
                onMove={(document) => {
                  setMovingDocument(document);
                  setMoveTargetCabinetId(document.cabinetId ?? "__root__");
                }}
                onSelect={(document) => setSelectedDocumentId(document.id)}
              />
            )}
          </CardBody>
        </Card>
      </div>

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
        title="Delete Page"
        message={`Delete "${documentToDelete?.title ?? "this page"}"? This removes its content and indexed chunks.`}
        confirmLabel="Delete"
        confirmVariant="danger"
        isPending={deletingDocumentId !== null}
        onConfirm={handleConfirmDeleteDocument}
      />
    </>
  );
}

function PageDocumentList({
  cabinetsById,
  documents,
  onDelete,
  onMove,
  onSelect,
}: {
  cabinetsById: Map<string, KnowledgeLibraryCabinetRecord>;
  documents: KnowledgeDocumentRecord[];
  onDelete: (document: KnowledgeDocumentRecord) => void;
  onMove: (document: KnowledgeDocumentRecord) => void;
  onSelect: (document: KnowledgeDocumentRecord) => void;
}) {
  if (documents.length === 0) {
    return (
      <EmptyState className="h-full">
        <FolderPlus className="mx-auto mb-2 h-8 w-8 text-fg/20" />
        <p className="text-sm text-fg/50">No pages in this folder.</p>
      </EmptyState>
    );
  }

  return (
    <div className="h-full overflow-y-auto p-4">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
        {documents.map((document) => {
          const folder = cabinetPathLabel(document.cabinetId, cabinetsById);
          return (
            <button
              key={document.id}
              type="button"
              onClick={() => onSelect(document)}
              className="group min-h-[132px] rounded-lg border border-line bg-panel2/20 p-3 text-left transition-colors hover:border-accent/35 hover:bg-accent/5"
            >
              <div className="flex items-start gap-3">
                <div className="rounded-md border border-line bg-panel p-2 text-fg/55">
                  <FileText className="h-4 w-4" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-fg">{document.title}</p>
                  <p className="mt-1 line-clamp-2 text-xs text-fg/45">
                    {document.description || "Manual knowledge page"}
                  </p>
                </div>
                <div className="flex shrink-0 gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                  <Button
                    size="xs"
                    variant="ghost"
                    title="Move"
                    onClick={(event) => {
                      event.stopPropagation();
                      onMove(document);
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
                      onDelete(document);
                    }}
                    className="h-7 w-7 px-0 text-danger hover:text-danger"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
              <div className="mt-4 flex flex-wrap items-center gap-1.5">
                <Badge tone="default">{categoryLabel(document.category)}</Badge>
                <Badge tone={scopeTone(document.scope)}>{document.scope}</Badge>
                <Badge tone={statusTone(document.status)}>{document.status}</Badge>
                {folder && <span className="truncate text-[11px] text-fg/35">{folder}</span>}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function KnowledgeDocumentDetail({
  document,
  onBack,
  onRefresh,
}: {
  document: KnowledgeDocumentRecord;
  onBack: () => void;
  onRefresh: () => void | Promise<void>;
}) {
  const [page, setPage] = useState<KnowledgeDocumentPageRecord | null>(null);
  const [loadingPage, setLoadingPage] = useState(true);
  const [mode, setMode] = useState<"edit" | "preview" | "source">("edit");
  const [draftContent, setDraftContent] = useState<{
    contentJson: Record<string, unknown>;
    contentMarkdown: string;
    plainText: string;
  } | null>(null);
  const [sourceDraft, setSourceDraft] = useState("");
  const [titleDraft, setTitleDraft] = useState("");
  const [tagsDraft, setTagsDraft] = useState("");
  const [descriptionDraft, setDescriptionDraft] = useState("");
  const [categoryDraft, setCategoryDraft] = useState<KnowledgeDocumentRecord["category"]>("general");
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [reindexing, setReindexing] = useState(false);

  const loadPage = useCallback(async () => {
    setLoadingPage(true);
    try {
      const pages = await listKnowledgeDocumentPages(document.id);
      let nextPage = pages[0] ?? null;
      if (!nextPage) {
        nextPage = await createKnowledgeDocumentPage(document.id, {
          title: document.title,
          contentJson: EMPTY_DOCUMENT_CONTENT,
          contentMarkdown: "",
          plainText: "",
        });
      }
      setPage(nextPage);
      setDraftContent(null);
      setSourceDraft(nextPage.contentMarkdown ?? "");
      setSaveState("idle");
    } catch {
      setPage(null);
      setSaveState("error");
    } finally {
      setLoadingPage(false);
    }
  }, [document.id, document.title]);

  useEffect(() => {
    setTitleDraft(document.title);
    setDescriptionDraft(document.description);
    setTagsDraft((document.tags ?? []).join(", "));
    setCategoryDraft(document.category);
  }, [document]);

  useEffect(() => {
    void loadPage();
  }, [loadPage]);

  useEffect(() => {
    if (!page || !draftContent) return;
    setSaveState("saving");
    const timer = window.setTimeout(async () => {
      try {
        const updated = await updateKnowledgeDocumentPage(document.id, page.id, draftContent);
        setPage(updated);
        setSourceDraft(draftContent.contentMarkdown);
        setDraftContent(null);
        setSaveState("saved");
        await onRefresh();
      } catch {
        setSaveState("error");
      }
    }, 750);
    return () => window.clearTimeout(timer);
  }, [draftContent, document.id, onRefresh, page]);

  const handleSaveDocument = async () => {
    const title = titleDraft.trim() || "Untitled Page";
    setSaveState("saving");
    try {
      await updateKnowledgeDocument(document.id, {
        title,
        description: descriptionDraft,
        category: categoryDraft,
        tags: tagsDraft.split(",").map((tag) => tag.trim()).filter(Boolean),
      });
      if (page && page.title !== title) {
        const updatedPage = await updateKnowledgeDocumentPage(document.id, page.id, { title });
        setPage(updatedPage);
      }
      await onRefresh();
      setSaveState("saved");
    } catch {
      setSaveState("error");
    }
  };

  const handleSaveSource = async () => {
    if (!page) return;
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

  const openSourceMode = () => {
    setSourceDraft(draftContent?.contentMarkdown ?? page?.contentMarkdown ?? "");
    setMode("source");
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex flex-wrap items-center gap-2 border-b border-line px-3 py-2">
        <Button size="sm" variant="ghost" title="Back to pages" onClick={onBack} className="h-8 w-8 px-0">
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <Input
          value={titleDraft}
          onChange={(event) => setTitleDraft(event.target.value)}
          onBlur={handleSaveDocument}
          className="h-9 min-w-[220px] flex-[2] border-transparent bg-transparent px-1 text-base font-semibold"
        />
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
          placeholder="tags"
          className="h-8 min-w-[160px] flex-1 text-xs"
        />
        <Popover.Root>
          <Popover.Trigger asChild>
            <Button size="sm" variant="ghost" title="Details" className="h-8 w-8 px-0">
              <MoreHorizontal className="h-4 w-4" />
            </Button>
          </Popover.Trigger>
          <Popover.Portal>
            <Popover.Content
              align="end"
              sideOffset={8}
              className="z-50 w-80 rounded-lg border border-line bg-panel p-3 shadow-xl"
            >
              <Textarea
                value={descriptionDraft}
                onChange={(event) => setDescriptionDraft(event.target.value)}
                onBlur={handleSaveDocument}
                rows={4}
                placeholder="Description"
                className="resize-none text-xs"
              />
            </Popover.Content>
          </Popover.Portal>
        </Popover.Root>
        <Button size="sm" variant="secondary" onClick={handleReindex} disabled={reindexing}>
          {reindexing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
          Index
        </Button>
        <div className="flex items-center gap-1 rounded-md border border-line bg-panel2/30 p-0.5">
          <button
            type="button"
            onClick={() => setMode("edit")}
            className={cn(
              "rounded px-2 py-1 text-[11px] font-medium",
              mode === "edit" ? "bg-panel text-fg shadow-sm" : "text-fg/45 hover:text-fg/70",
            )}
          >
            Edit
          </button>
          <button
            type="button"
            onClick={() => setMode("preview")}
            className={cn(
              "rounded px-2 py-1 text-[11px] font-medium",
              mode === "preview" ? "bg-panel text-fg shadow-sm" : "text-fg/45 hover:text-fg/70",
            )}
          >
            Preview
          </button>
          <button
            type="button"
            onClick={openSourceMode}
            className={cn(
              "rounded px-2 py-1 text-[11px] font-medium",
              mode === "source" ? "bg-panel text-fg shadow-sm" : "text-fg/45 hover:text-fg/70",
            )}
          >
            Source
          </button>
        </div>
        <div className="ml-auto flex items-center gap-2 text-[11px] text-fg/40">
          <Badge tone={statusTone(document.status)}>{document.status}</Badge>
          {saveState === "saving" && "Saving"}
          {saveState === "saved" && <span className="inline-flex items-center gap-1"><Check className="h-3 w-3" /> Saved</span>}
          {saveState === "error" && <span className="text-danger">Error</span>}
        </div>
      </div>

      <div className="min-h-0 flex-1 p-3">
        {loadingPage ? (
          <div className="flex h-full items-center justify-center text-xs text-fg/40">
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            Opening page
          </div>
        ) : page ? (
          <>
            {mode === "edit" && (
              <KnowledgeDocumentEditor
                key={page.id}
                contentJson={(draftContent?.contentJson ?? page.contentJson ?? EMPTY_DOCUMENT_CONTENT) as Record<string, unknown>}
                onChange={setDraftContent}
              />
            )}
            {mode === "preview" && (
              <div className="h-full overflow-auto rounded-lg border border-line bg-bg p-5">
                <MarkdownRenderer content={draftContent?.contentMarkdown ?? page.contentMarkdown} />
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
          </>
        ) : (
          <EmptyState>
            <FileText className="mx-auto mb-2 h-8 w-8 text-fg/20" />
            <p className="text-sm text-fg/50">This page could not be opened.</p>
          </EmptyState>
        )}
      </div>
    </div>
  );
}
