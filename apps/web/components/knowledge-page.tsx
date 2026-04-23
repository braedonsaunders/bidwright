"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  BookOpen,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Database,
  Download,
  Eye,
  FileText,
  Library,
  Loader2,
  Maximize2,
  Minus,
  MoveRight,
  Plus,
  Search,
  Sparkles,
  Table2,
  Check,
  Trash2,
  Upload,
  X,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { motion, AnimatePresence } from "motion/react";
import {
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  CardTitle,
  EmptyState,
  FadeIn,
  Input,
  Label,
  ModalBackdrop,
  Select,
  Separator,
  Textarea,
} from "@/components/ui";
import { ConfirmModal } from "@/components/workspace/modals";
import {
  CabinetDirectorySidebar,
  cabinetPathLabel,
  MoveToCabinetModal,
  type LibraryDirectoryView,
} from "@/components/knowledge/library-directory-sidebar";
import type {
  KnowledgeBookRecord,
  KnowledgeLibraryCabinetRecord,
  KnowledgeChunkRecord,
  DatasetRecord,
  DatasetRowRecord,
  DatasetColumnRecord,
} from "@/lib/api";
import {
  listKnowledgeBooks,
  listKnowledgeLibraryCabinets,
  createKnowledgeLibraryCabinet,
  updateKnowledgeLibraryCabinet,
  deleteKnowledgeLibraryCabinet,
  createKnowledgeBook,
  deleteKnowledgeBook,
  updateKnowledgeBook,
  listKnowledgeChunksPaginated,
  createKnowledgeChunk,
  searchKnowledge,
  listDatasets,
  createDataset,
  deleteDataset,
  updateDataset,
  listDatasetRows,
  createDatasetRow,
  createDatasetRowsBatch,
  updateDatasetRow,
  deleteDatasetRow,
  searchDatasetRows,
  listDatasetLibrary,
  adoptDatasetTemplate,
  extractDatasetsFromBook,
  connectCliStream,
  stopCliSession,
  getBookFileUrl,
  getBookThumbnailUrl,
  searchBookChunks,
  ingestKnowledgeFile,
} from "@/lib/api";
import dynamic from "next/dynamic";

const PdfCanvasViewer = dynamic(
  () => import("@/components/workspace/takeoff/pdf-canvas-viewer").then((m) => m.PdfCanvasViewer),
  { ssr: false },
);

type Tab = "books" | "datasets";

const BOOK_CATEGORIES = [
  "estimating",
  "labour",
  "equipment",
  "materials",
  "safety",
  "standards",
  "general",
] as const;

const DATASET_CATEGORIES = [
  "labour_units",
  "equipment_rates",
  "material_prices",
  "productivity",
  "burden_rates",
  "custom",
] as const;

const COLUMN_TYPES = [
  "text",
  "number",
  "currency",
  "percentage",
  "boolean",
  "select",
] as const;

function categoryLabel(cat: string) {
  return cat
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function statusTone(status: string) {
  switch (status) {
    case "indexed":
      return "success" as const;
    case "processing":
    case "uploading":
      return "warning" as const;
    case "failed":
      return "default" as const;
    default:
      return "default" as const;
  }
}

function scopeTone(scope: string) {
  return scope === "global" ? ("default" as const) : ("warning" as const);
}

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function compareByName<T extends { name: string }>(left: T, right: T) {
  return left.name.localeCompare(right.name, undefined, { sensitivity: "base" });
}

function matchesLibraryView(cabinetId: string | null, view: LibraryDirectoryView) {
  if (view.kind === "all") return true;
  if (view.kind === "unassigned") return !cabinetId;
  return cabinetId === view.cabinetId;
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function buildSearchSnippet(text: string, query: string, maxLength = 240) {
  const collapsed = text.replace(/\s+/g, " ").trim();
  if (!collapsed) return "";
  if (collapsed.length <= maxLength) return collapsed;

  const terms = query
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);

  const lowerText = collapsed.toLowerCase();
  const firstMatchIndex = terms.reduce((best, term) => {
    const index = lowerText.indexOf(term);
    if (index === -1) return best;
    if (best === -1) return index;
    return Math.min(best, index);
  }, -1);

  if (firstMatchIndex === -1) {
    return `${collapsed.slice(0, maxLength).trimEnd()}...`;
  }

  const start = Math.max(0, firstMatchIndex - Math.floor(maxLength * 0.3));
  const end = Math.min(collapsed.length, start + maxLength);
  const prefix = start > 0 ? "..." : "";
  const suffix = end < collapsed.length ? "..." : "";
  return `${prefix}${collapsed.slice(start, end).trim()}${suffix}`;
}

function highlightSearchSnippet(text: string, query: string) {
  const terms = Array.from(
    new Set(
      query
        .trim()
        .split(/\s+/)
        .map((term) => term.trim())
        .filter(Boolean),
    ),
  );

  if (terms.length === 0 || !text) {
    return text;
  }

  const pattern = new RegExp(`(${terms.map(escapeRegExp).join("|")})`, "ig");
  const lowerTerms = new Set(terms.map((term) => term.toLowerCase()));

  return text.split(pattern).map((part, index) => {
    if (!part) return null;
    if (!lowerTerms.has(part.toLowerCase())) {
      return <span key={index}>{part}</span>;
    }
    return (
      <mark key={index} className="rounded-sm bg-accent/15 px-0.5 text-fg">
        {part}
      </mark>
    );
  });
}

// ────────────────────────────────────────────────────────────────────
// Main component
// ────────────────────────────────────────────────────────────────────

export function KnowledgePage({
  initialBooks,
  initialCabinets,
  initialDatasets,
}: {
  initialBooks: KnowledgeBookRecord[];
  initialCabinets: KnowledgeLibraryCabinetRecord[];
  initialDatasets: DatasetRecord[];
}) {
  const [tab, setTab] = useState<Tab>("books");
  const [books, setBooks] = useState(initialBooks);
  const [cabinets, setCabinets] = useState(initialCabinets);
  const [datasets, setDatasets] = useState(initialDatasets);

  const refreshBooks = useCallback(async () => {
    try {
      setBooks(await listKnowledgeBooks());
    } catch { /* noop */ }
  }, []);

  const refreshDatasets = useCallback(async () => {
    try {
      setDatasets(await listDatasets());
    } catch { /* noop */ }
  }, []);

  const refreshCabinets = useCallback(async () => {
    try {
      setCabinets(await listKnowledgeLibraryCabinets());
    } catch { /* noop */ }
  }, []);

  // Fetch on mount since initialBooks may be empty due to race condition
  useEffect(() => {
    refreshBooks();
    refreshCabinets();
    refreshDatasets();
  }, [refreshBooks, refreshCabinets, refreshDatasets]);

  return (
    <div className="flex h-full min-h-0 flex-col gap-5">
      <FadeIn>
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold text-fg">Knowledge & Datasets</h1>
          <p className="text-xs text-fg/50 mt-0.5">
            Upload books, manage reference data, and build structured datasets for estimating.
          </p>
        </div>
      </div>
      </FadeIn>

      {/* Tab bar */}
      <FadeIn delay={0.05}>
      <div className="flex items-center gap-1 border-b border-line">
        {(
          [
            { key: "books", label: "Books", icon: BookOpen, count: books.length },
            { key: "datasets", label: "Datasets", icon: Database, count: datasets.length },
          ] as const
        ).map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={cn(
              "flex items-center gap-1.5 px-4 py-2.5 text-xs font-medium transition-colors border-b-2 -mb-px",
              tab === t.key
                ? "border-accent text-accent"
                : "border-transparent text-fg/50 hover:text-fg/70"
            )}
          >
            <t.icon className="h-3.5 w-3.5" />
            {t.label}
            <Badge tone="default" className="ml-1">
              {t.count}
            </Badge>
          </button>
        ))}
      </div>
      </FadeIn>

      <FadeIn delay={0.1} className="min-h-0 flex-1">
      {tab === "books" && (
        <BooksTab
          books={books}
          cabinets={cabinets}
          datasets={datasets}
          onRefresh={refreshBooks}
          onCabinetsRefresh={refreshCabinets}
          onDatasetsRefresh={refreshDatasets}
        />
      )}
      {tab === "datasets" && (
        <DatasetsTab
          datasets={datasets}
          books={books}
          cabinets={cabinets}
          onRefresh={refreshDatasets}
          onCabinetsRefresh={refreshCabinets}
        />
      )}
      </FadeIn>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────
// Books tab
// ────────────────────────────────────────────────────────────────────

function BooksTab({
  books,
  cabinets,
  datasets,
  onRefresh,
  onCabinetsRefresh,
  onDatasetsRefresh,
}: {
  books: KnowledgeBookRecord[];
  cabinets: KnowledgeLibraryCabinetRecord[];
  datasets: DatasetRecord[];
  onRefresh: () => void;
  onCabinetsRefresh: () => void;
  onDatasetsRefresh: () => void;
}) {
  const [selectedBookId, setSelectedBookId] = useState<string | null>(null);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [bookToDelete, setBookToDelete] = useState<KnowledgeBookRecord | null>(null);
  const [deletingBookId, setDeletingBookId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [view, setView] = useState<LibraryDirectoryView>({ kind: "all" });
  const [movingBook, setMovingBook] = useState<KnowledgeBookRecord | null>(null);
  const [moveTargetCabinetId, setMoveTargetCabinetId] = useState("__root__");
  const [savingMove, setSavingMove] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Poll for status updates when any book is still processing
  const hasProcessing = books.some((b) => b.status === "uploading" || b.status === "processing");
  useEffect(() => {
    if (!hasProcessing) return;
    const id = setInterval(onRefresh, 3000);
    return () => clearInterval(id);
  }, [hasProcessing, onRefresh]);

  const bookCabinets = useMemo(
    () => cabinets.filter((cabinet) => cabinet.itemType === "book").sort(compareByName),
    [cabinets],
  );

  const cabinetsById = useMemo(
    () => new Map(bookCabinets.map((cabinet) => [cabinet.id, cabinet])),
    [bookCabinets],
  );

  useEffect(() => {
    if (view.kind === "cabinet" && !cabinetsById.has(view.cabinetId)) {
      setView({ kind: "all" });
    }
  }, [cabinetsById, view]);

  useEffect(() => {
    setSelectedBookId(null);
  }, [view]);

  const filtered = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    return books
      .filter((book) => matchesLibraryView(book.cabinetId, view))
      .filter((book) => {
        if (!query) return true;
        return (
          book.name.toLowerCase().includes(query) ||
          book.description.toLowerCase().includes(query) ||
          book.sourceFileName.toLowerCase().includes(query)
        );
      });
  }, [books, searchQuery, view]);

  const selectedBook = books.find((b) => b.id === selectedBookId) ?? null;
  const defaultCabinetId = view.kind === "cabinet" ? view.cabinetId : null;

  const activeFolderLabel =
    view.kind === "all"
      ? "All Books"
      : view.kind === "unassigned"
        ? "Unassigned Books"
        : cabinetsById.get(view.cabinetId)?.name ?? "Book Folder";

  const handleCreateCabinet = async (parentId: string | null) => {
    try {
      const cabinet = await createKnowledgeLibraryCabinet({
        name: "New Folder",
        itemType: "book",
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
    if (!confirm(`Delete folder "${cabinet.name}"? Books inside will become unassigned.`)) return;
    try {
      await deleteKnowledgeLibraryCabinet(cabinetId);
      await onCabinetsRefresh();
      if (view.kind === "cabinet" && view.cabinetId === cabinetId) {
        setView({ kind: "all" });
      }
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete folder");
    }
  };

  const handleMoveSave = async () => {
    if (!movingBook) return;
    setSavingMove(true);
    try {
      await updateKnowledgeBook(movingBook.id, {
        cabinetId: moveTargetCabinetId === "__root__" ? null : moveTargetCabinetId,
      });
      await onRefresh();
      setMovingBook(null);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to move book");
    } finally {
      setSavingMove(false);
    }
  };

  const handleConfirmDeleteBook = async () => {
    if (!bookToDelete) return;
    setDeletingBookId(bookToDelete.id);
    try {
      await deleteKnowledgeBook(bookToDelete.id);
      if (selectedBookId === bookToDelete.id) {
        setSelectedBookId(null);
      }
      await onRefresh();
      setError(null);
      setBookToDelete(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete book");
    } finally {
      setDeletingBookId(null);
    }
  };

  return (
    <>
    <div className="grid h-full min-h-0 gap-5 xl:grid-cols-[280px_minmax(0,1fr)]">
      <div className="min-w-0 min-h-0">
          <CabinetDirectorySidebar
            cabinets={bookCabinets}
            emptyLabel="Organize books into folders on the left."
            itemLabelPlural="Books"
            onCreateCabinet={handleCreateCabinet}
            onDeleteCabinet={handleDeleteCabinet}
            onRenameCabinet={handleRenameCabinet}
            selectedView={view}
            onSelectView={setView}
          />
      </div>

      <div className="min-w-0 space-y-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold text-fg">{activeFolderLabel}</h2>
            <p className="mt-0.5 text-xs text-fg/40">
              {filtered.length} books
              {view.kind === "cabinet" ? ` in ${activeFolderLabel}` : ""}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <div className="relative flex-1 max-w-sm">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-fg/25" />
              <Input
                className="h-8 pl-8 text-xs"
                placeholder="Search books..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </div>
            <Button size="sm" onClick={() => setShowCreateModal(true)}>
              <Upload className="h-3.5 w-3.5" />
              Upload Book
            </Button>
          </div>
        </div>

        {error && (
          <div className="rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-xs text-danger">
            {error}
          </div>
        )}

        {filtered.length === 0 ? (
          <EmptyState>
            <BookOpen className="mx-auto mb-2 h-8 w-8 text-fg/20" />
            <p className="text-sm text-fg/50">No books in this folder.</p>
            <p className="mt-1 text-xs text-fg/30">
              Upload a reference book or move an existing one into this folder.
            </p>
          </EmptyState>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {filtered.map((book) => (
              <BookCard
                key={book.id}
                book={book}
                cabinetLabel={cabinetPathLabel(book.cabinetId, cabinetsById)}
                selected={book.id === selectedBookId}
                onMove={() => {
                  setMovingBook(book);
                  setMoveTargetCabinetId(book.cabinetId ?? "__root__");
                }}
                onSelect={() => setSelectedBookId(book.id === selectedBookId ? null : book.id)}
                onDelete={() => setBookToDelete(book)}
              />
            ))}
          </div>
        )}

        {showCreateModal && (
          <CreateBookModal
            defaultCabinetId={defaultCabinetId}
            onClose={() => setShowCreateModal(false)}
            onCreated={() => {
              setShowCreateModal(false);
              onRefresh();
            }}
          />
        )}
      </div>
    </div>

    {typeof document !== "undefined" && createPortal(
      <AnimatePresence>
        {selectedBook && (
          <BookDetailPanel
            key={selectedBook.id}
            book={selectedBook}
            datasets={datasets.filter((d) => d.sourceBookId === selectedBook.id)}
            onClose={() => setSelectedBookId(null)}
            onRefresh={onRefresh}
            onDatasetsRefresh={onDatasetsRefresh}
          />
        )}
      </AnimatePresence>,
      document.body,
    )}

    {typeof document !== "undefined" && movingBook && createPortal(
      <MoveToCabinetModal
        activeType="book"
        cabinets={bookCabinets}
        itemName={movingBook.name}
        onClose={() => setMovingBook(null)}
        onConfirm={handleMoveSave}
        onValueChange={setMoveTargetCabinetId}
        saving={savingMove}
        value={moveTargetCabinetId}
      />,
      document.body,
    )}

    <ConfirmModal
      open={bookToDelete !== null}
      onClose={() => {
        if (!deletingBookId) setBookToDelete(null);
      }}
      title="Delete Book"
      message={`Delete "${bookToDelete?.name ?? "this book"}"? This will remove the book and its indexed content.`}
      confirmLabel="Delete"
      confirmVariant="danger"
      isPending={deletingBookId !== null}
      onConfirm={handleConfirmDeleteBook}
    />
    </>
  );
}

function BookCard({
  cabinetLabel,
  book,
  onMove,
  selected,
  onSelect,
  onDelete,
}: {
  cabinetLabel?: string | null;
  book: KnowledgeBookRecord;
  onMove?: () => void;
  selected: boolean;
  onSelect: () => void;
  onDelete: () => void;
}) {
  const [imgError, setImgError] = useState(false);

  return (
    <Card
      className={cn(
        "cursor-pointer transition-all hover:ring-1 hover:ring-accent/30",
        selected && "ring-2 ring-accent"
      )}
      onClick={onSelect}
    >
      {/* Thumbnail */}
      <div className="relative h-36 bg-panel2 rounded-t-lg overflow-hidden flex items-center justify-center">
        {book.storagePath && !imgError ? (
          <img
            src={getBookThumbnailUrl(book.id)}
            alt={book.name}
            className="w-full h-full object-contain"
            onError={() => setImgError(true)}
          />
        ) : (
          <BookOpen className="h-12 w-12 text-fg/10" />
        )}
        <Badge
          tone={statusTone(book.status)}
          className="absolute top-2 right-2 text-[10px]"
        >
          {(book.status === "uploading" || book.status === "processing") && (
            <Loader2 className="h-2.5 w-2.5 animate-spin" />
          )}
          {book.status === "uploading"
            ? "Extracting text..."
            : book.status === "processing"
              ? book.chunkCount > 0
                ? `Embedding ${book.chunkCount} chunks...`
                : "Processing..."
              : book.status}
        </Badge>
      </div>

      {/* Info */}
      <div className="px-3 py-2.5">
        <h3 className="text-sm font-medium text-fg truncate">{book.name}</h3>
        <p className="text-[11px] text-fg/40 mt-0.5 truncate">{book.sourceFileName}</p>
        {cabinetLabel && (
          <p className="mt-1 truncate text-[11px] text-fg/35">{cabinetLabel}</p>
        )}
        <div className="flex flex-wrap items-center gap-1.5 mt-2">
          <Badge tone="default">{categoryLabel(book.category)}</Badge>
          <Badge tone={scopeTone(book.scope)}>{book.scope}</Badge>
        </div>
        <div className="flex items-center justify-between mt-2 gap-2">
          <span className="text-[10px] text-fg/30">
            {book.pageCount} pages · {book.chunkCount} chunks · {formatBytes(book.sourceFileSize)}
          </span>
          <div className="flex items-center gap-1">
            {onMove && (
              <Button
                variant="secondary"
                size="xs"
                onClick={(e) => {
                  e.stopPropagation();
                  onMove();
                }}
              >
                <MoveRight className="h-3 w-3" />
              </Button>
            )}
            <Button
              variant="danger"
              size="xs"
              onClick={(e) => {
                e.stopPropagation();
                onDelete();
              }}
            >
              <Trash2 className="h-3 w-3" />
            </Button>
          </div>
        </div>
      </div>
    </Card>
  );
}

type DetailTab = "view" | "chunks" | "search" | "datasets";
type BookSearchHit = { id: string; text: string; score: number; sectionTitle?: string; pageNumber?: number };
type PdfSearchTarget = { key: string; pageNumber: number; text: string; query: string };

function BookDetailPanel({
  book,
  datasets,
  onClose,
  onRefresh,
  onDatasetsRefresh,
}: {
  book: KnowledgeBookRecord;
  datasets: DatasetRecord[];
  onClose: () => void;
  onRefresh: () => void;
  onDatasetsRefresh: () => void;
}) {
  const [detailTab, setDetailTab] = useState<DetailTab>("view");
  const [chunks, setChunks] = useState<KnowledgeChunkRecord[]>([]);
  const [totalChunks, setTotalChunks] = useState(0);
  const [loadingChunks, setLoadingChunks] = useState(false);
  const [chunkSearch, setChunkSearch] = useState("");
  const [showAddChunk, setShowAddChunk] = useState(false);

  const CHUNK_PAGE_SIZE = 50;

  // PDF viewer state
  const [pageNumber, setPageNumber] = useState(1);
  const [pageCount, setPageCount] = useState(0);
  const [zoom, setZoom] = useState(1.0);
  const [pageInput, setPageInput] = useState("");

  // Search state
  const [searchQuery, setSearchQuery] = useState("");
  const [submittedSearchQuery, setSubmittedSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<BookSearchHit[]>([]);
  const [searching, setSearching] = useState(false);
  const [openingSearchHitId, setOpeningSearchHitId] = useState<string | null>(null);
  const [highlightedChunkId, setHighlightedChunkId] = useState<string | null>(null);
  const [pendingChunkScrollId, setPendingChunkScrollId] = useState<string | null>(null);
  const [pdfSearchTarget, setPdfSearchTarget] = useState<PdfSearchTarget | null>(null);
  const [showGenerateDataset, setShowGenerateDataset] = useState(false);
  const [confirmRerun, setConfirmRerun] = useState(false);
  const [pdfFullscreen, setPdfFullscreen] = useState(false);
  const chunkItemRefs = useRef(new Map<string, HTMLDivElement>());
  const chunksRef = useRef<KnowledgeChunkRecord[]>([]);
  const totalChunksRef = useRef(0);

  useEffect(() => {
    chunksRef.current = chunks;
  }, [chunks]);

  useEffect(() => {
    totalChunksRef.current = totalChunks;
  }, [totalChunks]);

  useEffect(() => {
    setChunks([]);
    setTotalChunks(0);
    setLoadingChunks(true);
    listKnowledgeChunksPaginated(book.id, CHUNK_PAGE_SIZE, 0)
      .then(({ chunks: c, total }) => { setChunks(c); setTotalChunks(total); })
      .catch(() => {})
      .finally(() => setLoadingChunks(false));
  }, [book.id]);

  useEffect(() => {
    setPageNumber(1);
    setPageInput("");
    setPageCount(0);
    setSearchQuery("");
    setSubmittedSearchQuery("");
    setSearchResults([]);
    setOpeningSearchHitId(null);
    setHighlightedChunkId(null);
    setPendingChunkScrollId(null);
    setPdfSearchTarget(null);
  }, [book.id]);

  const loadMoreChunks = async () => {
    setLoadingChunks(true);
    try {
      const { chunks: more, total } = await listKnowledgeChunksPaginated(book.id, CHUNK_PAGE_SIZE, chunks.length);
      setChunks((prev) => [...prev, ...more]);
      setTotalChunks(total);
    } catch { /* noop */ }
    setLoadingChunks(false);
  };

  const handleSearch = async () => {
    const trimmedQuery = searchQuery.trim();
    if (!trimmedQuery) return;

    setSubmittedSearchQuery(trimmedQuery);
    setSearching(true);
    try {
      const res = await searchBookChunks(book.id, trimmedQuery);
      setSearchResults(res.hits);
    } catch {
      setSearchResults([]);
    }
    setSearching(false);
  };

  const hasPdf = book.sourceFileName.toLowerCase().endsWith(".pdf") && !!book.storagePath;

  const handleOpenSearchHit = useCallback(async (hit: BookSearchHit) => {
    setOpeningSearchHitId(hit.id);
    setHighlightedChunkId(hit.id);

    try {
      if (hasPdf && hit.pageNumber != null) {
        setPageInput("");
        setPageNumber(hit.pageNumber);
        setPdfSearchTarget({
          key: `${hit.id}:${Date.now()}`,
          pageNumber: hit.pageNumber,
          text: hit.text,
          query: submittedSearchQuery,
        });
        setDetailTab("view");
        return;
      }

      let loadedChunks = chunksRef.current;
      let knownTotalChunks = totalChunksRef.current;

      while (!loadedChunks.some((chunk) => chunk.id === hit.id) && loadedChunks.length < knownTotalChunks) {
        const { chunks: moreChunks, total } = await listKnowledgeChunksPaginated(
          book.id,
          CHUNK_PAGE_SIZE,
          loadedChunks.length,
        );

        if (moreChunks.length === 0) {
          break;
        }

        loadedChunks = [...loadedChunks, ...moreChunks];
        knownTotalChunks = total;
        chunksRef.current = loadedChunks;
        totalChunksRef.current = total;
        setChunks(loadedChunks);
        setTotalChunks(total);
      }

      setChunkSearch("");
      setPendingChunkScrollId(hit.id);
      setDetailTab("chunks");
    } finally {
      setOpeningSearchHitId((current) => (current === hit.id ? null : current));
    }
  }, [book.id, hasPdf]);

  useEffect(() => {
    if (detailTab !== "chunks" || !pendingChunkScrollId) {
      return;
    }

    const target = chunkItemRefs.current.get(pendingChunkScrollId);
    if (!target) {
      return;
    }

    target.scrollIntoView({ behavior: "smooth", block: "center" });
    setPendingChunkScrollId(null);
  }, [chunks, detailTab, pendingChunkScrollId]);

  const filteredChunks = chunkSearch
    ? chunks.filter(
        (c) =>
          c.sectionTitle.toLowerCase().includes(chunkSearch.toLowerCase()) ||
          c.text.toLowerCase().includes(chunkSearch.toLowerCase())
      )
    : chunks;
  const fileUrl = getBookFileUrl(book.id);

  const detailTabs: Array<{ key: DetailTab; label: string; icon: typeof Eye; count?: number }> = [
    ...(hasPdf ? [{ key: "view" as const, label: "View", icon: Eye }] : []),
    { key: "chunks", label: "Chunks", icon: FileText },
    { key: "search", label: "Search", icon: Search },
    { key: "datasets", label: "Datasets", icon: Database, count: datasets.length },
  ];

  // If no PDF, default to chunks tab
  useEffect(() => {
    if (!hasPdf && detailTab === "view") setDetailTab("chunks");
  }, [hasPdf, detailTab]);

  return (
    <motion.div
      initial={{ x: 640 }}
      animate={{ x: 0 }}
      exit={{ x: 640 }}
      transition={{ type: "spring", damping: 30, stiffness: 300 }}
      className="fixed inset-y-0 right-0 z-[101] w-[640px] bg-panel border-l border-line shadow-2xl flex flex-col"
    >
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-line bg-panel2/40">
        <BookOpen className="h-4 w-4 text-accent shrink-0" />
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-medium text-fg truncate">{book.name}</h3>
          <p className="text-[11px] text-fg/40 truncate">{book.sourceFileName} · {book.pageCount} pages · {formatBytes(book.sourceFileSize)}</p>
        </div>
        {confirmRerun ? (
          <div className="flex items-center gap-1.5">
            <span className="text-[10px] text-fg/50">{datasets.length} datasets exist. Re-run?</span>
            <Button size="xs" variant="accent" onClick={() => { setConfirmRerun(false); setShowGenerateDataset(true); }}>
              Yes
            </Button>
            <Button size="xs" variant="ghost" onClick={() => setConfirmRerun(false)}>
              No
            </Button>
          </div>
        ) : (
          <Button
            size="xs"
            variant={datasets.length > 0 ? "secondary" : "accent"}
            onClick={() => {
              if (datasets.length > 0) setConfirmRerun(true);
              else setShowGenerateDataset(true);
            }}
          >
            <Sparkles className="h-3 w-3" />
            {datasets.length > 0 ? "Re-extract Datasets" : "Extract Datasets"}
          </Button>
        )}
        <Button size="xs" variant="secondary" onClick={onClose}>
          <X className="h-3.5 w-3.5" />
        </Button>
      </div>

      {/* Tab bar */}
      <div className="flex items-center gap-1 px-4 border-b border-line">
        {detailTabs.map((t) => (
          <button
            key={t.key}
            onClick={() => setDetailTab(t.key)}
            className={cn(
              "flex items-center gap-1.5 px-3 py-2 text-xs font-medium transition-colors border-b-2 -mb-px",
              detailTab === t.key
                ? "border-accent text-accent"
                : "border-transparent text-fg/50 hover:text-fg/70"
            )}
          >
            <t.icon className="h-3 w-3" />
            {t.label}
            {t.count != null && t.count > 0 && (
              <span className="ml-0.5 rounded-full bg-accent/15 px-1.5 text-[9px] font-semibold text-accent">{t.count}</span>
            )}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div className="flex-1 overflow-auto">
        <AnimatePresence mode="wait">
        {detailTab === "view" && hasPdf && (
          <motion.div key="view" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.15 }} className="flex flex-col h-full">
            {/* PDF controls */}
            <div className="flex items-center justify-center gap-2 px-3 py-2 border-b border-line bg-panel2/30">
              <Button size="xs" variant="secondary" disabled={pageNumber <= 1} onClick={() => setPageNumber((p) => Math.max(1, p - 1))}>
                <ChevronLeft className="h-3 w-3" />
              </Button>
              <div className="flex items-center gap-1 min-w-[100px] justify-center">
                <input
                  type="text"
                  inputMode="numeric"
                  className="w-10 h-6 text-center text-xs rounded border border-line bg-bg/50 text-fg outline-none focus:border-accent/50"
                  value={pageInput || String(pageNumber)}
                  onChange={(e) => setPageInput(e.target.value)}
                  onFocus={() => setPageInput(String(pageNumber))}
                  onBlur={() => {
                    const n = parseInt(pageInput, 10);
                    if (n >= 1 && n <= pageCount) setPageNumber(n);
                    setPageInput("");
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      const n = parseInt(pageInput, 10);
                      if (n >= 1 && n <= pageCount) setPageNumber(n);
                      setPageInput("");
                      (e.target as HTMLInputElement).blur();
                    }
                  }}
                />
                <span className="text-xs text-fg/40">/ {pageCount || "..."}</span>
              </div>
              <Button size="xs" variant="secondary" disabled={pageCount === 0 || pageNumber >= pageCount} onClick={() => setPageNumber((p) => Math.min(pageCount, p + 1))}>
                <ChevronRight className="h-3 w-3" />
              </Button>
              <Separator className="h-4 mx-1" />
              <Button size="xs" variant="secondary" onClick={() => setZoom((z) => Math.max(0.25, z - 0.25))}>
                <ZoomOut className="h-3 w-3" />
              </Button>
              <span className="text-xs text-fg/60 min-w-[40px] text-center">{Math.round(zoom * 100)}%</span>
              <Button size="xs" variant="secondary" onClick={() => setZoom((z) => Math.min(3, z + 0.25))}>
                <ZoomIn className="h-3 w-3" />
              </Button>
              <Separator className="h-4 mx-1" />
              <Button size="xs" variant="secondary" onClick={() => setPdfFullscreen(true)} title="Fullscreen reader">
                <Maximize2 className="h-3 w-3" />
              </Button>
            </div>
            {/* PDF canvas */}
            <div className="flex-1 overflow-auto flex items-start justify-center p-4 bg-panel2/20">
              <PdfCanvasViewer
                documentUrl={fileUrl}
                pageNumber={pageNumber}
                mode="continuous"
                zoom={zoom}
                focusTarget={pdfSearchTarget}
                onPageChange={setPageNumber}
                onPageCount={setPageCount}
              />
            </div>
          </motion.div>
        )}

        {detailTab === "chunks" && (
          <motion.div key="chunks" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.15 }} className="p-4 space-y-3">
            <div className="flex items-center gap-2">
              <div className="relative flex-1">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-fg/25" />
                <Input
                  className="h-7 pl-8 text-xs"
                  placeholder="Filter chunks..."
                  value={chunkSearch}
                  onChange={(e) => setChunkSearch(e.target.value)}
                />
              </div>
              <Button size="xs" variant="secondary" onClick={() => setShowAddChunk(true)}>
                <Plus className="h-3 w-3" />
                Add
              </Button>
            </div>

            <p className="text-[10px] text-fg/30">
              Showing {filteredChunks.length}{chunkSearch ? " filtered" : ""} of {totalChunks} chunks
            </p>

            {filteredChunks.length === 0 ? (
              <p className="text-xs text-fg/40 py-4 text-center">
                {loadingChunks ? "Loading..." : `No chunks${chunkSearch ? " matching filter" : " yet"}.`}
              </p>
            ) : (
              <div className="space-y-1.5">
                {filteredChunks.map((chunk) => (
                  <ChunkItem
                    key={chunk.id}
                    chunk={chunk}
                    highlighted={chunk.id === highlightedChunkId}
                    itemRef={(node) => {
                      if (node) {
                        chunkItemRefs.current.set(chunk.id, node);
                      } else {
                        chunkItemRefs.current.delete(chunk.id);
                      }
                    }}
                  />
                ))}
                {!chunkSearch && chunks.length < totalChunks && (
                  <Button
                    size="sm"
                    variant="secondary"
                    className="w-full"
                    onClick={loadMoreChunks}
                    disabled={loadingChunks}
                  >
                    {loadingChunks ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
                    Load more ({totalChunks - chunks.length} remaining)
                  </Button>
                )}
              </div>
            )}

            {showAddChunk && (
              <AddChunkForm
                bookId={book.id}
                onClose={() => setShowAddChunk(false)}
                onCreated={async () => {
                  setShowAddChunk(false);
                  const { chunks: c, total } = await listKnowledgeChunksPaginated(book.id, CHUNK_PAGE_SIZE, 0);
                  setChunks(c);
                  setTotalChunks(total);
                  onRefresh();
                }}
              />
            )}
          </motion.div>
        )}

        {detailTab === "search" && (
          <motion.div key="search" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.15 }} className="p-4 space-y-3">
            <div className="flex items-center gap-2">
              <div className="relative flex-1">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-fg/25" />
                <Input
                  className="h-8 pl-8 text-xs"
                  placeholder="Semantic search this book..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleSearch()}
                />
              </div>
              <Button size="sm" onClick={handleSearch} disabled={searching || !searchQuery.trim()}>
                {searching ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Search className="h-3.5 w-3.5" />}
                Search
              </Button>
            </div>

            {submittedSearchQuery && (
              <div className="flex items-center justify-between gap-3 text-[11px] text-fg/40">
                <span>
                  {searchResults.length} result{searchResults.length === 1 ? "" : "s"} for "{submittedSearchQuery}"
                </span>
                {searchQuery.trim() !== submittedSearchQuery && (
                  <span className="text-fg/30">Press Search to update results.</span>
                )}
              </div>
            )}

            {searching ? (
              <div className="rounded-lg border border-line bg-panel2/30 px-3 py-6">
                <div className="flex items-center justify-center gap-2 text-xs text-fg/45">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  Searching this book...
                </div>
              </div>
            ) : searchResults.length > 0 ? (
              <div className="space-y-2">
                {searchResults.map((hit, index) => {
                  const pageLabel = hit.pageNumber != null ? `Open page ${hit.pageNumber}` : "Open chunk";
                  const snippet = buildSearchSnippet(hit.text, submittedSearchQuery);
                  const isOpening = openingSearchHitId === hit.id;

                  return (
                    <button
                      key={hit.id}
                      type="button"
                      onClick={() => void handleOpenSearchHit(hit)}
                      className="w-full rounded-lg border border-line bg-panel2/50 px-3 py-2 text-left transition hover:border-accent/35 hover:bg-panel focus:outline-none focus:ring-2 focus:ring-accent/25"
                    >
                      <div className="mb-1 flex items-start gap-2">
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <span className="rounded bg-accent/10 px-1.5 py-0.5 text-[10px] font-medium text-accent">
                              Result {index + 1}
                            </span>
                            {hit.sectionTitle ? (
                              <span className="text-xs font-medium text-fg/75">{hit.sectionTitle}</span>
                            ) : (
                              <span className="text-xs text-fg/45">Matched passage</span>
                            )}
                            {hit.pageNumber != null && (
                              <span className="text-[10px] text-fg/35">p.{hit.pageNumber}</span>
                            )}
                          </div>
                        </div>
                        <span className="inline-flex items-center gap-1 text-[11px] text-accent">
                          {isOpening ? <Loader2 className="h-3 w-3 animate-spin" /> : <MoveRight className="h-3 w-3" />}
                          {pageLabel}
                        </span>
                      </div>
                      <p className="text-xs leading-5 text-fg/55">
                        {highlightSearchSnippet(snippet, submittedSearchQuery)}
                      </p>
                    </button>
                  );
                })}
              </div>
            ) : submittedSearchQuery ? (
              <p className="text-xs text-fg/40 py-4 text-center">
                No results for "{submittedSearchQuery}". Try a different phrase.
              </p>
            ) : searchQuery.trim() ? (
              <p className="text-xs text-fg/40 py-4 text-center">
                Press Search or hit Enter to run the search.
              </p>
            ) : (
              <p className="text-xs text-fg/40 py-4 text-center">
                Search across this book and open a result directly to its page or chunk.
              </p>
            )}
          </motion.div>
        )}

        {detailTab === "datasets" && (
          <motion.div key="datasets" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.15 }} className="p-4 space-y-3">
            {datasets.length === 0 ? (
              <div className="py-8 text-center">
                <Database className="h-8 w-8 text-fg/15 mx-auto mb-2" />
                <p className="text-sm text-fg/50">No datasets extracted yet.</p>
                <p className="text-xs text-fg/30 mt-1">
                  Click "Extract Datasets" to have the AI read this book and create structured datasets.
                </p>
              </div>
            ) : (
              <div className="space-y-1.5">
                {datasets.map((ds) => (
                  <div key={ds.id} className="rounded-lg border border-line bg-panel2/50 px-3 py-2">
                    <div className="flex items-center gap-2">
                      <Table2 className="h-3.5 w-3.5 text-fg/30 shrink-0" />
                      <span className="text-xs font-medium text-fg/70 truncate flex-1">{ds.name}</span>
                      <Badge tone="default" className="text-[9px]">{categoryLabel(ds.category)}</Badge>
                      <span className="text-[10px] text-fg/30">{ds.rowCount} rows</span>
                    </div>
                    {ds.description && (
                      <p className="text-[11px] text-fg/40 mt-1 ml-5 line-clamp-1">{ds.description}</p>
                    )}
                    {ds.tags && ds.tags.length > 0 && (
                      <div className="flex flex-wrap gap-1 mt-1 ml-5">
                        {ds.tags.slice(0, 5).map((tag) => (
                          <span key={tag} className="inline-flex rounded bg-accent/10 px-1 py-0.5 text-[8px] text-accent/70">
                            {tag}
                          </span>
                        ))}
                        {ds.tags.length > 5 && (
                          <span className="text-[8px] text-fg/25">+{ds.tags.length - 5}</span>
                        )}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </motion.div>
        )}
        </AnimatePresence>
      </div>

      {/* Fullscreen PDF reader */}
      {typeof document !== "undefined" && pdfFullscreen && hasPdf && createPortal(
        <div className="fixed inset-0 z-[200] bg-bg flex flex-col">
          {/* Fullscreen header */}
          <div className="flex items-center gap-3 px-4 py-2.5 border-b border-line bg-panel shrink-0">
            <BookOpen className="h-4 w-4 text-accent" />
            <span className="text-sm font-medium text-fg flex-1 truncate">{book.name}</span>
            <div className="flex items-center gap-2">
              <Button size="xs" variant="secondary" disabled={pageNumber <= 1} onClick={() => setPageNumber((p) => Math.max(1, p - 1))}>
                <ChevronLeft className="h-3 w-3" />
              </Button>
              <input
                type="text"
                inputMode="numeric"
                className="w-12 h-6 text-center text-xs rounded border border-line bg-bg/50 text-fg outline-none focus:border-accent/50"
                value={pageInput || String(pageNumber)}
                onChange={(e) => setPageInput(e.target.value)}
                onFocus={() => setPageInput(String(pageNumber))}
                onBlur={() => {
                  const n = parseInt(pageInput, 10);
                  if (n >= 1 && n <= pageCount) setPageNumber(n);
                  setPageInput("");
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    const n = parseInt(pageInput, 10);
                    if (n >= 1 && n <= pageCount) setPageNumber(n);
                    setPageInput("");
                    (e.target as HTMLInputElement).blur();
                  }
                }}
              />
              <span className="text-xs text-fg/40">/ {pageCount || "..."}</span>
              <Button size="xs" variant="secondary" disabled={pageCount === 0 || pageNumber >= pageCount} onClick={() => setPageNumber((p) => Math.min(pageCount, p + 1))}>
                <ChevronRight className="h-3 w-3" />
              </Button>
              <Separator className="h-4 mx-1" />
              <Button size="xs" variant="secondary" onClick={() => setZoom((z) => Math.max(0.25, z - 0.25))}>
                <ZoomOut className="h-3 w-3" />
              </Button>
              <span className="text-xs text-fg/60 min-w-[40px] text-center">{Math.round(zoom * 100)}%</span>
              <Button size="xs" variant="secondary" onClick={() => setZoom((z) => Math.min(3, z + 0.25))}>
                <ZoomIn className="h-3 w-3" />
              </Button>
              <Separator className="h-4 mx-1" />
              <Button size="xs" variant="secondary" onClick={() => setPdfFullscreen(false)}>
                <X className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>
          {/* Fullscreen canvas */}
          <div className="flex-1 overflow-auto flex items-start justify-center p-6 bg-panel2/20">
            <PdfCanvasViewer
              documentUrl={fileUrl}
              pageNumber={pageNumber}
              mode="continuous"
              zoom={zoom}
              focusTarget={pdfSearchTarget}
              onPageChange={setPageNumber}
              onPageCount={setPageCount}
            />
          </div>
        </div>,
        document.body,
      )}

      {typeof document !== "undefined" && showGenerateDataset && createPortal(
        <GenerateDatasetFromBookModal
          book={book}
          onClose={() => setShowGenerateDataset(false)}
          onGenerated={() => {
            setShowGenerateDataset(false);
            onRefresh();
            onDatasetsRefresh();
          }}
        />,
        document.body,
      )}
    </motion.div>
  );
}

interface PendingDataset {
  id: string;
  name: string;
  description: string;
  category: string;
  tags: string[];
  columns: Array<{ key: string; label: string }>;
  previewRows: Record<string, unknown>[];
  totalRows: number;
  status: "pending" | "approved" | "rejected";
}

function GenerateDatasetFromBookModal({
  book,
  onClose,
  onGenerated,
}: {
  book: KnowledgeBookRecord;
  onClose: () => void;
  onGenerated: () => void;
}) {
  const [status, setStatus] = useState<"starting" | "running" | "done" | "error">("starting");
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [events, setEvents] = useState<Array<{ type: string; text: string }>>([]);
  const [pendingDatasets, setPendingDatasets] = useState<PendingDataset[]>([]);
  const [error, setError] = useState("");
  const [showLog, setShowLog] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const knownDatasetIdsRef = useRef<Set<string>>(new Set());

  // Auto-scroll events
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [events]);

  // After a createDataset tool_call, fetch latest datasets to get the real ID
  const resolveNewDataset = useCallback(async (input: Record<string, unknown>) => {
    // Small delay for server to finish creating
    await new Promise((r) => setTimeout(r, 1500));
    try {
      const all = await listDatasets();
      const newOne = all.find(
        (d) => d.name === input.name && !knownDatasetIdsRef.current.has(d.id)
      );
      if (newOne) {
        knownDatasetIdsRef.current.add(newOne.id);
        const columns = (Array.isArray(input.columns) ? input.columns : []).map((c: any) => ({
          key: c.key || "",
          label: c.label || c.name || c.key || "",
        }));
        const rows = Array.isArray(input.rows) ? input.rows : [];
        setPendingDatasets((prev) => [
          ...prev,
          {
            id: newOne.id,
            name: newOne.name,
            description: newOne.description || (input.description as string) || "",
            category: newOne.category || "",
            tags: newOne.tags || (input.tags as string[]) || [],
            columns,
            previewRows: rows.slice(0, 3),
            totalRows: rows.length,
            status: "pending",
          },
        ]);
      }
    } catch { /* noop */ }
  }, []);

  // Start extraction on mount
  useEffect(() => {
    let es: EventSource | null = null;
    let cancelled = false;

    // Pre-load known dataset IDs so we can diff later
    listDatasets().then((all) => {
      for (const d of all) knownDatasetIdsRef.current.add(d.id);
    }).catch(() => {});

    (async () => {
      try {
        const result = await extractDatasetsFromBook(book.id);
        if (cancelled) return;
        setSessionId(result.sessionId);
        setStatus("running");

        es = connectCliStream(book.id);

        es.addEventListener("tool_call", (e) => {
          try {
            const data = JSON.parse(e.data);
            if (data.toolId?.includes("createDataset")) {
              const input = data.input || {};
              setEvents((prev) => [
                ...prev,
                { type: "dataset", text: `Creating dataset: ${input.name || "Dataset"} (${Array.isArray(input.rows) ? input.rows.length : "?"} rows)` },
              ]);
              // Resolve the real dataset ID asynchronously
              resolveNewDataset(input);
            } else {
              setEvents((prev) => [
                ...prev,
                { type: "tool", text: `${data.toolId?.replace("mcp__bidwright__", "") || "tool"}` },
              ]);
            }
          } catch { /* ignore */ }
        });

        es.addEventListener("message", (e) => {
          try {
            const data = JSON.parse(e.data);
            if (data.content) {
              setEvents((prev) => [...prev, { type: "message", text: data.content.substring(0, 200) }]);
            }
          } catch { /* ignore */ }
        });

        es.addEventListener("thinking", (e) => {
          try {
            const data = JSON.parse(e.data);
            if (data.content) {
              setEvents((prev) => [...prev, { type: "thinking", text: data.content.substring(0, 150) }]);
            }
          } catch { /* ignore */ }
        });

        es.addEventListener("progress", (e) => {
          try {
            const data = JSON.parse(e.data);
            setEvents((prev) => [...prev, { type: "progress", text: `${data.phase}: ${data.detail}` }]);
          } catch { /* ignore */ }
        });

        es.addEventListener("file_read", (e) => {
          try {
            const data = JSON.parse(e.data);
            setEvents((prev) => [...prev, { type: "file", text: `Reading: ${data.fileName || "file"}` }]);
          } catch { /* ignore */ }
        });

        es.addEventListener("status", (e) => {
          try {
            const data = JSON.parse(e.data);
            if (data.status === "completed" || data.status === "stopped" || data.status === "failed") {
              setStatus("done");
              es?.close();
            }
          } catch { /* ignore */ }
        });

        es.addEventListener("error", (e) => {
          try {
            const data = JSON.parse((e as any).data);
            if (data.message) {
              setEvents((prev) => [...prev, { type: "error", text: data.message }]);
            }
          } catch { /* SSE connection error — ignore */ }
        });

        es.onerror = () => {};
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to start extraction");
          setStatus("error");
        }
      }
    })();

    return () => {
      cancelled = true;
      es?.close();
    };
  }, [book.id, resolveNewDataset]);

  const handleStop = async () => {
    if (sessionId) {
      try { await stopCliSession(book.id); } catch { /* noop */ }
    }
    setStatus("done");
  };

  const handleApprove = (id: string) => {
    setPendingDatasets((prev) => prev.map((d) => d.id === id ? { ...d, status: "approved" as const } : d));
  };

  const handleReject = async (id: string) => {
    setPendingDatasets((prev) => prev.map((d) => d.id === id ? { ...d, status: "rejected" as const } : d));
    try { await deleteDataset(id); } catch { /* noop */ }
  };

  const handleApproveAll = () => {
    setPendingDatasets((prev) => prev.map((d) => d.status === "pending" ? { ...d, status: "approved" as const } : d));
  };

  const handleApproveAllAndClose = () => {
    handleApproveAll();
    onGenerated();
  };

  const isActive = status === "starting" || status === "running";
  const pendingCount = pendingDatasets.filter((d) => d.status === "pending").length;
  const approvedCount = pendingDatasets.filter((d) => d.status === "approved").length;
  const rejectedCount = pendingDatasets.filter((d) => d.status === "rejected").length;

  return (
    <ModalBackdrop open={true} onClose={isActive ? () => {} : onClose}>
      <div
        className="bg-panel border border-line rounded-xl shadow-xl w-full max-w-2xl p-5 space-y-4 max-h-[85vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center gap-2 shrink-0">
          <Sparkles className="h-4 w-4 text-accent" />
          <h2 className="text-sm font-semibold text-fg flex-1">Extract Datasets from Book</h2>
          {pendingDatasets.length > 0 && (
            <div className="flex items-center gap-2 text-[10px] text-fg/40">
              {approvedCount > 0 && <span className="text-success">{approvedCount} approved</span>}
              {pendingCount > 0 && <span className="text-warning">{pendingCount} pending</span>}
              {rejectedCount > 0 && <span className="text-fg/30">{rejectedCount} rejected</span>}
            </div>
          )}
          {!isActive && (
            <button onClick={onClose} className="rounded p-1 hover:bg-panel2 text-fg/40">
              <X className="h-4 w-4" />
            </button>
          )}
        </div>

        {/* Book info */}
        <div className="rounded-lg bg-panel2/50 border border-line px-3 py-2 shrink-0">
          <div className="flex items-center gap-2">
            <BookOpen className="h-3.5 w-3.5 text-fg/40" />
            <span className="text-xs font-medium text-fg/70">{book.name}</span>
          </div>
          <p className="text-[11px] text-fg/40 mt-0.5">{book.sourceFileName} · {book.pageCount} pages</p>
        </div>

        {/* Error */}
        {status === "error" && (
          <div className="rounded-lg bg-danger/10 border border-danger/20 px-4 py-3 shrink-0">
            <p className="text-xs text-danger">{error}</p>
          </div>
        )}

        {/* Dataset review cards */}
        {pendingDatasets.length > 0 && (
          <div className="flex-1 min-h-0 overflow-y-auto space-y-2">
            {pendingDatasets.map((d) => (
              <DatasetReviewCard
                key={d.id}
                dataset={d}
                onApprove={() => handleApprove(d.id)}
                onReject={() => handleReject(d.id)}
              />
            ))}
          </div>
        )}

        {/* Live event log — collapsible */}
        {isActive && (
          <div className="shrink-0">
            <button
              onClick={() => setShowLog(!showLog)}
              className="flex items-center gap-1 text-[10px] text-fg/40 hover:text-fg/60 mb-1"
            >
              {showLog ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
              Agent activity log
            </button>
            {showLog && (
              <div
                ref={scrollRef}
                className="max-h-[120px] overflow-y-auto rounded-lg bg-panel2/30 border border-line p-2 space-y-0.5"
              >
                {events.length === 0 ? (
                  <div className="flex items-center gap-2 text-[10px] text-fg/40">
                    <Loader2 className="h-3 w-3 animate-spin" />
                    {status === "starting" ? "Starting extraction session..." : "Agent is reading the book..."}
                  </div>
                ) : (
                  events.slice(-20).map((ev, i) => (
                    <div key={i} className={cn(
                      "text-[10px] leading-relaxed",
                      ev.type === "dataset" ? "text-success font-medium" : "text-fg/30"
                    )}>
                      {ev.text}
                    </div>
                  ))
                )}
              </div>
            )}
          </div>
        )}

        {/* Status bar */}
        {isActive && (
          <div className="flex items-center gap-2 shrink-0">
            <Loader2 className="h-3.5 w-3.5 text-accent animate-spin" />
            <span className="text-xs text-fg/50 flex-1">
              Extracting datasets... {pendingDatasets.length > 0 ? `(${pendingDatasets.length} found)` : ""}
            </span>
            <div className="flex items-center gap-1.5">
              {pendingCount > 0 && (
                <Button size="xs" variant="accent" onClick={handleApproveAllAndClose}>
                  <Check className="h-3 w-3" />
                  Approve All & Close
                </Button>
              )}
              <Button size="xs" variant="danger" onClick={handleStop}>
                Stop
              </Button>
            </div>
          </div>
        )}

        {/* Done */}
        {status === "done" && (
          <div className="space-y-3 shrink-0">
            {pendingDatasets.length > 0 ? (
              <div className="rounded-lg bg-success/10 border border-success/20 px-4 py-3 text-center">
                <Database className="h-5 w-5 text-success mx-auto mb-1" />
                <p className="text-sm font-medium text-fg">
                  {approvedCount + pendingCount} dataset{approvedCount + pendingCount !== 1 ? "s" : ""} kept
                  {rejectedCount > 0 ? `, ${rejectedCount} rejected` : ""}
                </p>
              </div>
            ) : (
              <div className="rounded-lg bg-panel2/50 border border-line px-4 py-3 text-center">
                <p className="text-sm text-fg/50">Session finished — no datasets found.</p>
              </div>
            )}
            <div className="flex justify-end gap-2">
              {pendingCount > 0 && (
                <Button size="sm" variant="secondary" onClick={handleApproveAll}>
                  <Check className="h-3.5 w-3.5" />
                  Approve All Remaining
                </Button>
              )}
              <Button size="sm" onClick={onGenerated}>
                Done
              </Button>
            </div>
          </div>
        )}

        {/* Error footer */}
        {status === "error" && (
          <div className="flex justify-end gap-2 shrink-0">
            <Button variant="ghost" size="sm" onClick={onClose}>
              Close
            </Button>
          </div>
        )}
      </div>
    </ModalBackdrop>
  );
}

function DatasetReviewCard({
  dataset,
  onApprove,
  onReject,
}: {
  dataset: PendingDataset;
  onApprove: () => void;
  onReject: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const isResolved = dataset.status !== "pending";

  return (
    <div
      className={cn(
        "rounded-lg border px-3 py-2.5 transition-all",
        dataset.status === "approved" && "border-success/30 bg-success/5",
        dataset.status === "rejected" && "border-line/50 bg-panel2/30 opacity-50",
        dataset.status === "pending" && "border-accent/30 bg-accent/5",
      )}
    >
      <div className="flex items-start gap-2">
        <Database className={cn(
          "h-3.5 w-3.5 mt-0.5 shrink-0",
          dataset.status === "approved" ? "text-success" : dataset.status === "rejected" ? "text-fg/30" : "text-accent",
        )} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-xs font-medium text-fg truncate">{dataset.name}</span>
            <span className="text-[10px] text-fg/30 shrink-0">{dataset.totalRows} rows · {dataset.columns.length} cols</span>
          </div>
          {dataset.description && (
            <p className="text-[10px] text-fg/40 mt-0.5 line-clamp-1">{dataset.description}</p>
          )}
          {dataset.tags.length > 0 && (
            <div className="flex flex-wrap gap-1 mt-1">
              {dataset.tags.slice(0, 5).map((tag) => (
                <span key={tag} className="rounded px-1.5 py-0.5 text-[9px] bg-panel2 text-fg/40">{tag}</span>
              ))}
              {dataset.tags.length > 5 && (
                <span className="text-[9px] text-fg/30">+{dataset.tags.length - 5}</span>
              )}
            </div>
          )}
        </div>

        {/* Actions */}
        <div className="flex items-center gap-1 shrink-0">
          {dataset.status === "approved" && (
            <span className="text-[10px] text-success font-medium">Approved</span>
          )}
          {dataset.status === "rejected" && (
            <span className="text-[10px] text-fg/30 font-medium">Rejected</span>
          )}
          {dataset.status === "pending" && (
            <>
              <Button size="xs" variant="ghost" onClick={() => setExpanded(!expanded)} title="Preview">
                {expanded ? <ChevronDown className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
              </Button>
              <Button size="xs" variant="accent" onClick={onApprove} title="Keep this dataset">
                <Check className="h-3 w-3" />
              </Button>
              <Button size="xs" variant="danger" onClick={onReject} title="Delete this dataset">
                <Trash2 className="h-3 w-3" />
              </Button>
            </>
          )}
        </div>
      </div>

      {/* Row preview */}
      {expanded && dataset.previewRows.length > 0 && (
        <div className="mt-2 overflow-x-auto">
          <table className="w-full text-[10px]">
            <thead>
              <tr className="border-b border-line">
                {dataset.columns.map((col) => (
                  <th key={col.key} className="px-2 py-1 text-left font-medium text-fg/50">{col.label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {dataset.previewRows.map((row, ri) => (
                <tr key={ri} className="border-b border-line/50">
                  {dataset.columns.map((col) => (
                    <td key={col.key} className="px-2 py-1 text-fg/60 truncate max-w-[150px]">
                      {String(row[col.key] ?? "")}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
          {dataset.totalRows > 3 && (
            <p className="text-[9px] text-fg/30 mt-1 px-2">...and {dataset.totalRows - 3} more rows</p>
          )}
        </div>
      )}
    </div>
  );
}

function ChunkItem({
  chunk,
  highlighted = false,
  itemRef,
}: {
  chunk: KnowledgeChunkRecord;
  highlighted?: boolean;
  itemRef?: (node: HTMLDivElement | null) => void;
}) {
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    if (highlighted) {
      setExpanded(true);
    }
  }, [highlighted]);

  return (
    <div
      ref={itemRef}
      className={cn(
        "rounded-lg border bg-panel2/50 px-3 py-2 cursor-pointer transition-colors",
        highlighted ? "border-accent/45 bg-accent/5" : "border-line",
      )}
      onClick={() => setExpanded(!expanded)}
    >
      <div className="flex items-center gap-2">
        <span className="text-xs font-medium text-fg/70 truncate flex-1">
          {chunk.sectionTitle || "Untitled Section"}
        </span>
        {chunk.pageNumber && (
          <span className="text-[10px] text-fg/30">p.{chunk.pageNumber}</span>
        )}
        <span className="text-[10px] text-fg/30">{chunk.tokenCount} tokens</span>
      </div>
      <p
        className={cn(
          "text-xs text-fg/50 mt-1",
          !expanded && "line-clamp-2"
        )}
      >
        {chunk.text}
      </p>
    </div>
  );
}

function AddChunkForm({
  bookId,
  onClose,
  onCreated,
}: {
  bookId: string;
  onClose: () => void;
  onCreated: () => void;
}) {
  const [sectionTitle, setSectionTitle] = useState("");
  const [text, setText] = useState("");
  const [pageNumber, setPageNumber] = useState("");
  const [saving, setSaving] = useState(false);

  const handleSubmit = async () => {
    if (!text.trim()) return;
    setSaving(true);
    try {
      await createKnowledgeChunk(bookId, {
        sectionTitle: sectionTitle || "Manual Entry",
        text: text.trim(),
        pageNumber: pageNumber ? parseInt(pageNumber, 10) : null,
      });
      onCreated();
    } catch {
      setSaving(false);
    }
  };

  return (
    <div className="rounded-lg border border-accent/30 bg-panel p-3 space-y-2">
      <div className="flex items-center gap-2">
        <Input
          className="h-7 text-xs flex-1"
          placeholder="Section title"
          value={sectionTitle}
          onChange={(e) => setSectionTitle(e.target.value)}
        />
        <Input
          className="h-7 text-xs w-20"
          placeholder="Page #"
          type="number"
          value={pageNumber}
          onChange={(e) => setPageNumber(e.target.value)}
        />
      </div>
      <Textarea
        className="text-xs min-h-[80px]"
        placeholder="Paste text content here..."
        value={text}
        onChange={(e) => setText(e.target.value)}
      />
      <div className="flex justify-end gap-2">
        <Button size="xs" variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        <Button size="xs" onClick={handleSubmit} disabled={saving || !text.trim()}>
          {saving ? "Saving..." : "Add Chunk"}
        </Button>
      </div>
    </div>
  );
}

function CreateBookModal({
  defaultCabinetId,
  onClose,
  onCreated,
}: {
  defaultCabinetId?: string | null;
  onClose: () => void;
  onCreated: () => void;
}) {
  const [name, setName] = useState("");
  const [category, setCategory] = useState<KnowledgeBookRecord["category"]>("general");
  const [file, setFile] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [dragging, setDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const ACCEPTED = ".pdf,.doc,.docx,.txt,.csv,.xlsx,.xls";

  const handleFiles = (files: FileList | File[]) => {
    const f = files[0];
    if (!f) return;
    setFile(f);
    if (!name.trim()) {
      setName(f.name.replace(/\.[^.]+$/, ""));
    }
    setError("");
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    if (e.dataTransfer.files.length) handleFiles(e.dataTransfer.files);
  };

  const handleSubmit = async () => {
    if (!file) { setError("Please select a file to upload"); return; }
    if (!name.trim()) { setError("Name is required"); return; }
    setSaving(true);
    setError("");
    try {
      await ingestKnowledgeFile({
        file,
        title: name.trim(),
        category,
        cabinetId: defaultCabinetId ?? null,
        scope: "global",
      });
      // Close modal immediately — processing continues in the background.
      // The BooksTab polling will pick up status changes automatically.
      onCreated();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed");
      setSaving(false);
    }
  };

  return (
    <ModalBackdrop open={true} onClose={onClose}>
      <div
        className="bg-panel border border-line rounded-xl shadow-xl w-full max-w-md p-5 space-y-4"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-sm font-semibold text-fg">Upload Knowledge Book</h2>
        <div className="space-y-3">
          {/* Drop zone */}
          <div
            className={cn(
              "border-2 border-dashed rounded-lg p-6 text-center cursor-pointer transition-colors",
              dragging
                ? "border-accent bg-accent/5"
                : file
                  ? "border-green-500/40 bg-green-500/5"
                  : "border-line hover:border-fg/30",
            )}
            onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
            onDragLeave={() => setDragging(false)}
            onDrop={handleDrop}
            onClick={() => fileInputRef.current?.click()}
          >
            {file ? (
              <div className="space-y-1">
                <FileText className="h-8 w-8 mx-auto text-green-500/70" />
                <p className="text-sm font-medium text-fg truncate">{file.name}</p>
                <p className="text-[11px] text-fg/40">{formatBytes(file.size)}</p>
                <button
                  type="button"
                  className="text-[11px] text-fg/50 hover:text-fg underline"
                  onClick={(e) => { e.stopPropagation(); setFile(null); }}
                >
                  Remove
                </button>
              </div>
            ) : (
              <div className="space-y-1">
                <Upload className="h-8 w-8 mx-auto text-fg/20" />
                <p className="text-sm font-medium text-fg/60">
                  Drop a file here or click to browse
                </p>
                <p className="text-[11px] text-fg/30">
                  PDF, Word, TXT, CSV, Excel
                </p>
              </div>
            )}
            <input
              ref={fileInputRef}
              type="file"
              accept={ACCEPTED}
              className="hidden"
              onChange={(e) => {
                if (e.target.files) handleFiles(e.target.files);
                e.target.value = "";
              }}
            />
          </div>

          <div>
            <Label className="text-xs">Name</Label>
            <Input
              className="mt-1 text-xs"
              placeholder="e.g., NECA Manual of Labour Units"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <div>
            <Label className="text-xs">Category</Label>
            <Select
              className="mt-1 text-xs"
              value={category}
              onChange={(e) =>
                setCategory(
                  e.target.value as KnowledgeBookRecord["category"]
                )
              }
            >
              {BOOK_CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {categoryLabel(c)}
                </option>
              ))}
            </Select>
          </div>

          {error && <p className="text-xs text-red-500">{error}</p>}
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="ghost" size="sm" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button size="sm" onClick={handleSubmit} disabled={saving || !file || !name.trim()}>
            {saving ? (
              <>
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Uploading...
              </>
            ) : (
              <>
                <Upload className="h-3.5 w-3.5" />
                Upload Book
              </>
            )}
          </Button>
        </div>
      </div>
    </ModalBackdrop>
  );
}

// ────────────────────────────────────────────────────────────────────
// Paginated dataset list
// ────────────────────────────────────────────────────────────────────
function DatasetListPaginated({
  cabinetsById,
  datasets,
  onDelete,
  onMove,
  onSelect,
}: {
  cabinetsById: Map<string, KnowledgeLibraryCabinetRecord>;
  datasets: DatasetRecord[];
  onDelete: (id: string) => void;
  onMove: (dataset: DatasetRecord) => void;
  onSelect: (id: string) => void;
}) {
  const [page, setPage] = useState(0);
  const pageSize = 20;
  const totalPages = Math.ceil(datasets.length / pageSize);
  const visible = datasets.slice(page * pageSize, (page + 1) * pageSize);

  useEffect(() => {
    setPage(0);
  }, [datasets]);

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between text-xs text-fg/40">
        <span>{datasets.length} datasets</span>
        {totalPages > 1 && (
          <div className="flex items-center gap-2">
            <button
              className="hover:text-fg disabled:opacity-30"
              disabled={page === 0}
              onClick={() => setPage((p) => p - 1)}
            >
              ← Prev
            </button>
            <span>
              {page + 1} / {totalPages}
            </span>
            <button
              className="hover:text-fg disabled:opacity-30"
              disabled={page >= totalPages - 1}
              onClick={() => setPage((p) => p + 1)}
            >
              Next →
            </button>
          </div>
        )}
      </div>
      {visible.map((dataset) => (
        <DatasetListItem
          key={dataset.id}
          cabinetLabel={cabinetPathLabel(dataset.cabinetId, cabinetsById)}
          dataset={dataset}
          onClick={() => onSelect(dataset.id)}
          onDelete={async () => onDelete(dataset.id)}
          onMove={() => onMove(dataset)}
        />
      ))}
      {totalPages > 1 && (
        <div className="flex justify-center pt-2">
          <div className="flex items-center gap-1">
            {Array.from({ length: Math.min(totalPages, 10) }, (_, i) => (
              <button
                key={i}
                className={`h-6 w-6 rounded text-[10px] ${
                  i === page ? "bg-accent text-white" : "text-fg/40 hover:bg-panel2"
                }`}
                onClick={() => setPage(i)}
              >
                {i + 1}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────
// Datasets tab
// ────────────────────────────────────────────────────────────────────

function DatasetsTab({
  datasets,
  books,
  cabinets,
  onRefresh,
  onCabinetsRefresh,
}: {
  datasets: DatasetRecord[];
  books: KnowledgeBookRecord[];
  cabinets: KnowledgeLibraryCabinetRecord[];
  onRefresh: () => void;
  onCabinetsRefresh: () => void;
}) {
  const [selectedDatasetId, setSelectedDatasetId] = useState<string | null>(null);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [datasetToDelete, setDatasetToDelete] = useState<DatasetRecord | null>(null);
  const [deletingDatasetId, setDeletingDatasetId] = useState<string | null>(null);
  const [showLibrary, setShowLibrary] = useState(false);
  const [libraryDatasets, setLibraryDatasets] = useState<DatasetRecord[]>([]);
  const [adopting, setAdopting] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [view, setView] = useState<LibraryDirectoryView>({ kind: "all" });
  const [movingDataset, setMovingDataset] = useState<DatasetRecord | null>(null);
  const [moveTargetCabinetId, setMoveTargetCabinetId] = useState("__root__");
  const [savingMove, setSavingMove] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const datasetCabinets = useMemo(
    () => cabinets.filter((cabinet) => cabinet.itemType === "dataset").sort(compareByName),
    [cabinets],
  );

  const cabinetsById = useMemo(
    () => new Map(datasetCabinets.map((cabinet) => [cabinet.id, cabinet])),
    [datasetCabinets],
  );

  useEffect(() => {
    if (view.kind === "cabinet" && !cabinetsById.has(view.cabinetId)) {
      setView({ kind: "all" });
    }
  }, [cabinetsById, view]);

  useEffect(() => {
    setSelectedDatasetId(null);
  }, [view]);

  const filtered = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    return datasets
      .filter((dataset) => matchesLibraryView(dataset.cabinetId, view))
      .filter((dataset) => {
        if (!query) return true;
        return (
          dataset.name.toLowerCase().includes(query) ||
          dataset.description.toLowerCase().includes(query)
        );
      });
  }, [datasets, searchQuery, view]);

  const selectedDataset = datasets.find((d) => d.id === selectedDatasetId);
  const defaultCabinetId = view.kind === "cabinet" ? view.cabinetId : null;
  const activeFolderLabel =
    view.kind === "all"
      ? "All Datasets"
      : view.kind === "unassigned"
        ? "Unassigned Datasets"
        : cabinetsById.get(view.cabinetId)?.name ?? "Dataset Folder";

  const handleCreateCabinet = async (parentId: string | null) => {
    try {
      const cabinet = await createKnowledgeLibraryCabinet({
        name: "New Folder",
        itemType: "dataset",
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
    if (!confirm(`Delete folder "${cabinet.name}"? Datasets inside will become unassigned.`)) return;
    try {
      await deleteKnowledgeLibraryCabinet(cabinetId);
      await onCabinetsRefresh();
      if (view.kind === "cabinet" && view.cabinetId === cabinetId) {
        setView({ kind: "all" });
      }
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete folder");
    }
  };

  const handleMoveSave = async () => {
    if (!movingDataset) return;
    setSavingMove(true);
    try {
      await updateDataset(movingDataset.id, {
        cabinetId: moveTargetCabinetId === "__root__" ? null : moveTargetCabinetId,
      });
      await onRefresh();
      setMovingDataset(null);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to move dataset");
    } finally {
      setSavingMove(false);
    }
  };

  const handleConfirmDeleteDataset = async () => {
    if (!datasetToDelete) return;
    setDeletingDatasetId(datasetToDelete.id);
    try {
      await deleteDataset(datasetToDelete.id);
      if (selectedDatasetId === datasetToDelete.id) {
        setSelectedDatasetId(null);
      }
      await onRefresh();
      setError(null);
      setDatasetToDelete(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete dataset");
    } finally {
      setDeletingDatasetId(null);
    }
  };

  return (
    <>
      <div className="grid h-full min-h-0 gap-5 xl:grid-cols-[280px_minmax(0,1fr)]">
        <div className="min-w-0 min-h-0">
          <CabinetDirectorySidebar
            cabinets={datasetCabinets}
            emptyLabel="Organize datasets into folders on the left."
            itemLabelPlural="Datasets"
            onCreateCabinet={handleCreateCabinet}
            onDeleteCabinet={handleDeleteCabinet}
            onRenameCabinet={handleRenameCabinet}
            selectedView={view}
            onSelectView={setView}
          />
        </div>

        <div className="min-w-0 space-y-4">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold text-fg">{activeFolderLabel}</h2>
              <p className="mt-0.5 text-xs text-fg/40">
                {filtered.length} datasets
                {view.kind === "cabinet" ? ` in ${activeFolderLabel}` : ""}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <div className="relative flex-1 max-w-sm">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-fg/25" />
                <Input
                  className="h-8 pl-8 text-xs"
                  placeholder="Search datasets..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                />
              </div>
              <Button size="sm" variant="secondary" onClick={async () => {
                try {
                  setLibraryDatasets(await listDatasetLibrary());
                  setError(null);
                } catch (err) {
                  setError(err instanceof Error ? err.message : "Failed to load dataset library");
                }
                setShowLibrary(true);
              }}>
                <Library className="h-3.5 w-3.5" />
                Browse Library
              </Button>
              <Button size="sm" onClick={() => setShowCreateModal(true)}>
                <Plus className="h-3.5 w-3.5" />
                Create Dataset
              </Button>
            </div>
          </div>

          {error && (
            <div className="rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-xs text-danger">
              {error}
            </div>
          )}

      {selectedDataset ? (
        <DatasetDetail
          dataset={selectedDataset}
          books={books}
          onBack={() => setSelectedDatasetId(null)}
          onRefresh={onRefresh}
        />
      ) : filtered.length === 0 ? (
        <EmptyState>
          <Database className="mx-auto mb-2 h-8 w-8 text-fg/20" />
          <p className="text-sm text-fg/50">No datasets in this folder.</p>
          <p className="mt-1 text-xs text-fg/30">
            Create structured datasets for labour units, equipment rates, and more.
          </p>
        </EmptyState>
      ) : (
        <DatasetListPaginated
          cabinetsById={cabinetsById}
          datasets={filtered}
          onSelect={(id) => setSelectedDatasetId(id)}
          onDelete={(id) => {
            const target = datasets.find((dataset) => dataset.id === id) ?? null;
            setDatasetToDelete(target);
          }}
          onMove={(dataset) => {
            setMovingDataset(dataset);
            setMoveTargetCabinetId(dataset.cabinetId ?? "__root__");
          }}
        />
      )}
        </div>
      </div>

      {typeof document !== "undefined" && showCreateModal && createPortal(
        <CreateDatasetModal
          defaultCabinetId={defaultCabinetId}
          onClose={() => setShowCreateModal(false)}
          onCreated={() => {
            setShowCreateModal(false);
            onRefresh();
          }}
        />,
        document.body,
      )}

      {typeof document !== "undefined" && showLibrary && createPortal(
        <ModalBackdrop open={showLibrary} onClose={() => setShowLibrary(false)} size="lg">
          <div className="bg-panel border border-line rounded-xl shadow-xl p-5" onClick={(e) => e.stopPropagation()}>
            <div className="mb-4 flex items-center justify-between">
              <div>
                <h3 className="text-sm font-bold text-fg">Dataset Library</h3>
                <p className="mt-0.5 text-xs text-fg/40">Add standard datasets to your organization</p>
              </div>
              <button onClick={() => setShowLibrary(false)} className="rounded p-1 text-fg/40 hover:bg-panel2">
                <X className="h-4 w-4" />
              </button>
            </div>

            {libraryDatasets.length === 0 ? (
              <div className="py-6 text-center text-sm text-fg/40">
                No datasets available in the library yet.
              </div>
            ) : (
              <div className="max-h-[60vh] space-y-3 overflow-y-auto">
                {libraryDatasets.map((tmpl) => {
                  const alreadyAdopted = datasets.some((d) => d.sourceTemplateId === tmpl.id);
                  return (
                    <div key={tmpl.id} className="rounded-lg border border-line p-4 transition-colors hover:border-accent/30">
                      <div className="flex items-start justify-between">
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <Database className="h-4 w-4 shrink-0 text-accent" />
                            <span className="text-sm font-medium text-fg">{tmpl.name}</span>
                            <Badge tone="info" className="text-[10px]">{categoryLabel(tmpl.category)}</Badge>
                          </div>
                          <p className="ml-6 mt-1 text-xs text-fg/50">{tmpl.description}</p>
                          <div className="ml-6 mt-1 text-xs text-fg/30">
                            {tmpl.rowCount.toLocaleString()} rows · {tmpl.columns.length} columns
                          </div>
                        </div>
                        <div className="ml-4 shrink-0">
                          {alreadyAdopted ? (
                            <Badge tone="success" className="text-[10px]">Added</Badge>
                          ) : (
                            <Button
                              variant="accent"
                              size="xs"
                              disabled={adopting === tmpl.id}
                              onClick={async () => {
                                setAdopting(tmpl.id);
                                try {
                                  const adopted = await adoptDatasetTemplate(tmpl.id);
                                  if (defaultCabinetId) {
                                    await updateDataset(adopted.id, { cabinetId: defaultCabinetId });
                                  }
                                  await onRefresh();
                                  setError(null);
                                } catch (err) {
                                  setError(err instanceof Error ? err.message : "Failed to add dataset from library");
                                } finally {
                                  setAdopting(null);
                                }
                              }}
                            >
                              {adopting === tmpl.id ? (
                                <><Loader2 className="h-3 w-3 animate-spin" /> Adding...</>
                              ) : (
                                <><Plus className="h-3 w-3" /> Add</>
                              )}
                            </Button>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </ModalBackdrop>,
        document.body,
      )}

      {typeof document !== "undefined" && movingDataset && createPortal(
        <MoveToCabinetModal
          activeType="dataset"
          cabinets={datasetCabinets}
          itemName={movingDataset.name}
          onClose={() => setMovingDataset(null)}
          onConfirm={handleMoveSave}
          onValueChange={setMoveTargetCabinetId}
          saving={savingMove}
        value={moveTargetCabinetId}
      />,
      document.body,
    )}

    <ConfirmModal
      open={datasetToDelete !== null}
      onClose={() => {
        if (!deletingDatasetId) setDatasetToDelete(null);
      }}
      title="Delete Dataset"
      message={`Delete "${datasetToDelete?.name ?? "this dataset"}"? This will remove the dataset and all of its rows.`}
      confirmLabel="Delete"
      confirmVariant="danger"
      isPending={deletingDatasetId !== null}
      onConfirm={handleConfirmDeleteDataset}
    />
    </>
  );
}

function DatasetListItem({
  cabinetLabel,
  dataset,
  onClick,
  onDelete,
  onMove,
}: {
  cabinetLabel?: string | null;
  dataset: DatasetRecord;
  onClick: () => void;
  onDelete: () => void;
  onMove?: () => void;
}) {
  return (
    <Card className="cursor-pointer hover:border-accent/30 transition-colors" onClick={onClick}>
      <div className="flex items-center gap-3 px-4 py-3">
        <Table2 className="h-5 w-5 text-fg/30 shrink-0" />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-fg">{dataset.name}</span>
            <Badge tone="default">{categoryLabel(dataset.category)}</Badge>
            <Badge tone={scopeTone(dataset.scope)}>{dataset.scope}</Badge>
            <Badge tone="default">{dataset.source}</Badge>
          </div>
          <p className="text-xs text-fg/50 mt-0.5 line-clamp-1">{dataset.description}</p>
          {cabinetLabel && (
            <p className="mt-1 truncate text-[11px] text-fg/35">{cabinetLabel}</p>
          )}
          {dataset.tags && dataset.tags.length > 0 && (
            <div className="flex flex-wrap gap-1 mt-1">
              {dataset.tags.slice(0, 5).map((tag) => (
                <span key={tag} className="inline-flex rounded bg-accent/10 px-1.5 py-0.5 text-[9px] text-accent/80">
                  {tag}
                </span>
              ))}
              {dataset.tags.length > 5 && (
                <span className="text-[9px] text-fg/30">+{dataset.tags.length - 5}</span>
              )}
            </div>
          )}
        </div>
        <div className="text-right shrink-0 flex items-center gap-3">
          <div>
            <span className="text-sm font-semibold text-fg">{dataset.rowCount}</span>
            <span className="text-xs text-fg/40 ml-1">rows</span>
          </div>
          <span className="text-[10px] text-fg/30">
            {dataset.columns.length} cols
          </span>
          {onMove && (
            <Button
              variant="secondary"
              size="xs"
              onClick={(e) => {
                e.stopPropagation();
                onMove();
              }}
            >
              <MoveRight className="h-3 w-3" />
            </Button>
          )}
          <Button
            variant="danger"
            size="xs"
            onClick={(e) => {
              e.stopPropagation();
              onDelete();
            }}
          >
            <Trash2 className="h-3 w-3" />
          </Button>
        </div>
      </div>
    </Card>
  );
}

function DatasetDetail({
  dataset,
  books,
  onBack,
  onRefresh,
}: {
  dataset: DatasetRecord;
  books: KnowledgeBookRecord[];
  onBack: () => void;
  onRefresh: () => void;
}) {
  const [rows, setRows] = useState<DatasetRowRecord[]>([]);
  const [total, setTotal] = useState(0);
  const [searchQuery, setSearchQuery] = useState("");
  const [showAddRow, setShowAddRow] = useState(false);
  const [editingCell, setEditingCell] = useState<{ rowId: string; colKey: string } | null>(null);
  const [editValue, setEditValue] = useState("");
  const [page, setPage] = useState(0);
  const pageSize = 50;
  const editRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const fetchRows = useCallback(async () => {
    try {
      const result = await listDatasetRows(dataset.id, {
        filter: searchQuery || undefined,
        limit: pageSize,
        offset: page * pageSize,
      });
      setRows(result.rows);
      setTotal(result.total);
    } catch { /* noop */ }
  }, [dataset.id, searchQuery, page]);

  useEffect(() => {
    fetchRows();
  }, [fetchRows]);

  // Reset page when search changes
  useEffect(() => {
    setPage(0);
  }, [searchQuery]);

  useEffect(() => {
    if (editRef.current) editRef.current.focus();
  }, [editingCell]);

  const handleCellClick = (rowId: string, colKey: string, currentValue: unknown) => {
    setEditingCell({ rowId, colKey });
    setEditValue(currentValue != null ? String(currentValue) : "");
  };

  const handleCellSave = async () => {
    if (!editingCell) return;
    const col = dataset.columns.find((c) => c.key === editingCell.colKey);
    let parsedValue: unknown = editValue;
    if (col?.type === "number" || col?.type === "currency" || col?.type === "percentage") {
      parsedValue = parseFloat(editValue) || 0;
    } else if (col?.type === "boolean") {
      parsedValue = editValue === "true";
    }
    try {
      await updateDatasetRow(dataset.id, editingCell.rowId, { [editingCell.colKey]: parsedValue });
      await fetchRows();
    } catch { /* noop */ }
    setEditingCell(null);
  };

  const handleAddRow = async (data: Record<string, unknown>) => {
    try {
      await createDatasetRow(dataset.id, data);
      await fetchRows();
      onRefresh();
      setShowAddRow(false);
    } catch { /* noop */ }
  };

  const handleDeleteRow = async (rowId: string) => {
    try {
      await deleteDatasetRow(dataset.id, rowId);
      await fetchRows();
      onRefresh();
    } catch { /* noop */ }
  };

  const handleCsvImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const text = await file.text();
    const lines = text.split("\n").filter((l) => l.trim());
    if (lines.length < 2) return;
    const headers = lines[0].split(",").map((h) => h.trim().replace(/^"|"$/g, ""));
    const batchRows: Array<Record<string, unknown>> = [];
    for (let i = 1; i < lines.length; i++) {
      const values = lines[i].split(",").map((v) => v.trim().replace(/^"|"$/g, ""));
      const rowData: Record<string, unknown> = {};
      headers.forEach((header, idx) => {
        const col = dataset.columns.find(
          (c) => c.key === header || c.name.toLowerCase() === header.toLowerCase()
        );
        if (col) {
          const val = values[idx] ?? "";
          if (col.type === "number" || col.type === "currency" || col.type === "percentage") {
            rowData[col.key] = parseFloat(val) || 0;
          } else if (col.type === "boolean") {
            rowData[col.key] = val.toLowerCase() === "true";
          } else {
            rowData[col.key] = val;
          }
        }
      });
      if (Object.keys(rowData).length > 0) {
        batchRows.push(rowData);
      }
    }
    if (batchRows.length > 0) {
      try {
        await createDatasetRowsBatch(dataset.id, batchRows);
        await fetchRows();
        onRefresh();
      } catch { /* noop */ }
    }
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="xs" onClick={onBack}>
          &larr; Back
        </Button>
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-semibold text-fg">{dataset.name}</h2>
            <Badge tone="default">{categoryLabel(dataset.category)}</Badge>
            <Badge tone={scopeTone(dataset.scope)}>{dataset.scope}</Badge>
            {dataset.sourceBookId && (() => {
              const book = books.find((b) => b.id === dataset.sourceBookId);
              return book ? (
                <a
                  href={`/knowledge?tab=books&book=${book.id}`}
                  className="inline-flex items-center gap-1 rounded-full bg-accent/10 border border-accent/20 px-2 py-0.5 text-[10px] font-medium text-accent hover:bg-accent/20 transition-colors"
                >
                  <BookOpen className="h-3 w-3" />
                  {book.name}
                  {dataset.sourcePages && <span className="text-accent/50">p.{dataset.sourcePages}</span>}
                </a>
              ) : null;
            })()}
          </div>
          <p className="text-xs text-fg/50 mt-0.5">{dataset.description}</p>
          {dataset.tags && dataset.tags.length > 0 && (
            <div className="flex flex-wrap gap-1 mt-1">
              {dataset.tags.map((tag) => (
                <span key={tag} className="inline-flex rounded bg-accent/10 px-1.5 py-0.5 text-[9px] font-medium text-accent">
                  {tag}
                </span>
              ))}
            </div>
          )}
        </div>
        <span className="text-xs text-fg/40">{total} rows</span>
      </div>

      {/* Column definitions badges */}
      <div className="flex flex-wrap gap-1.5">
        {dataset.columns.map((col) => (
          <span
            key={col.key}
            className="inline-flex items-center gap-1 rounded-md border border-line bg-panel2/50 px-2 py-0.5 text-[10px] text-fg/60"
          >
            <span className="font-medium">{col.name || (col as any).label || col.key}</span>
            <span className="text-fg/30">{col.type}</span>
            {col.unit && <span className="text-fg/30">({col.unit})</span>}
            {col.required && <span className="text-accent">*</span>}
          </span>
        ))}
      </div>

      {/* Controls */}
      <div className="flex items-center gap-2">
        <div className="relative flex-1 max-w-sm">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-fg/25" />
          <Input
            className="h-8 pl-8 text-xs"
            placeholder="Search rows..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>
        <Button size="sm" variant="secondary" onClick={() => setShowAddRow(true)}>
          <Plus className="h-3.5 w-3.5" />
          Add Row
        </Button>
        <Button
          size="sm"
          variant="secondary"
          onClick={() => fileInputRef.current?.click()}
        >
          <Download className="h-3.5 w-3.5" />
          Import CSV
        </Button>
        <input
          ref={fileInputRef}
          type="file"
          accept=".csv"
          className="hidden"
          onChange={handleCsvImport}
        />
      </div>

      {/* Data table */}
      <div className="rounded-lg border border-line overflow-auto max-h-[500px]">
        <table className="w-full text-xs">
          <thead className="bg-panel2 sticky top-0 z-10">
            <tr>
              <th className="px-3 py-2 text-left font-medium text-fg/50 w-8">#</th>
              {dataset.columns.map((col) => (
                <th
                  key={col.key}
                  className="px-3 py-2 text-left font-medium text-fg/50 whitespace-nowrap"
                >
                  {col.name || (col as any).label || col.key}
                  {col.unit && (
                    <span className="text-fg/25 ml-1">({col.unit})</span>
                  )}
                </th>
              ))}
              <th className="px-3 py-2 w-10" />
            </tr>
          </thead>
          <tbody>
            {rows.map((row, idx) => (
              <tr
                key={row.id}
                className="border-t border-line hover:bg-panel2/30 transition-colors"
              >
                <td className="px-3 py-1.5 text-fg/30">{page * pageSize + idx + 1}</td>
                {dataset.columns.map((col) => {
                  const isEditing =
                    editingCell?.rowId === row.id &&
                    editingCell?.colKey === col.key;
                  return (
                    <td
                      key={col.key}
                      className="px-3 py-1.5 cursor-pointer"
                      onClick={() =>
                        handleCellClick(row.id, col.key, row.data[col.key])
                      }
                    >
                      {isEditing ? (
                        <input
                          ref={editRef}
                          className="w-full bg-panel border border-accent rounded px-1.5 py-0.5 text-xs text-fg outline-none"
                          value={editValue}
                          onChange={(e) => setEditValue(e.target.value)}
                          onBlur={handleCellSave}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") handleCellSave();
                            if (e.key === "Escape") setEditingCell(null);
                          }}
                        />
                      ) : (
                        <span className="text-fg/70">
                          {row.data[col.key] != null
                            ? String(row.data[col.key])
                            : ""}
                        </span>
                      )}
                    </td>
                  );
                })}
                <td className="px-2 py-1.5">
                  <button
                    className="text-fg/20 hover:text-danger transition-colors"
                    onClick={() => handleDeleteRow(row.id)}
                  >
                    <Trash2 className="h-3 w-3" />
                  </button>
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td
                  colSpan={dataset.columns.length + 2}
                  className="px-3 py-8 text-center text-fg/40"
                >
                  No rows yet. Add rows manually, import CSV, or use AI to generate data.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {total > pageSize && (
        <div className="flex items-center justify-between text-xs text-fg/50">
          <span>
            Showing {page * pageSize + 1}&ndash;{Math.min((page + 1) * pageSize, total)} of {total}
          </span>
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="xs"
              disabled={page === 0}
              onClick={() => setPage((p) => p - 1)}
            >
              <ChevronLeft className="h-3.5 w-3.5" />
              Prev
            </Button>
            <span className="px-2">
              Page {page + 1} of {Math.ceil(total / pageSize)}
            </span>
            <Button
              variant="ghost"
              size="xs"
              disabled={(page + 1) * pageSize >= total}
              onClick={() => setPage((p) => p + 1)}
            >
              Next
              <ChevronRight className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
      )}

      {showAddRow && (
        <AddRowForm
          columns={dataset.columns}
          onClose={() => setShowAddRow(false)}
          onAdd={handleAddRow}
        />
      )}
    </div>
  );
}

function AddRowForm({
  columns,
  onClose,
  onAdd,
}: {
  columns: DatasetColumnRecord[];
  onClose: () => void;
  onAdd: (data: Record<string, unknown>) => void;
}) {
  const [values, setValues] = useState<Record<string, string>>({});

  const handleSubmit = () => {
    const data: Record<string, unknown> = {};
    columns.forEach((col) => {
      const raw = values[col.key] ?? "";
      if (col.type === "number" || col.type === "currency" || col.type === "percentage") {
        data[col.key] = parseFloat(raw) || 0;
      } else if (col.type === "boolean") {
        data[col.key] = raw.toLowerCase() === "true";
      } else {
        data[col.key] = raw;
      }
    });
    onAdd(data);
  };

  return (
    <div className="rounded-lg border border-accent/30 bg-panel p-3 space-y-3">
      <h3 className="text-xs font-semibold text-fg">Add Row</h3>
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {columns.map((col) => (
          <div key={col.key}>
            <Label className="text-[10px]">
              {col.name}
              {col.required && <span className="text-accent ml-0.5">*</span>}
            </Label>
            {col.type === "select" && col.options ? (
              <Select
                className="mt-0.5 text-xs"
                value={values[col.key] ?? ""}
                onChange={(e) =>
                  setValues({ ...values, [col.key]: e.target.value })
                }
              >
                <option value="">Select...</option>
                {col.options.map((opt) => (
                  <option key={opt} value={opt}>
                    {opt}
                  </option>
                ))}
              </Select>
            ) : (
              <Input
                className="mt-0.5 text-xs h-7"
                type={
                  col.type === "number" ||
                  col.type === "currency" ||
                  col.type === "percentage"
                    ? "number"
                    : "text"
                }
                step={col.type === "currency" ? "0.01" : undefined}
                placeholder={col.unit ?? col.name}
                value={values[col.key] ?? ""}
                onChange={(e) =>
                  setValues({ ...values, [col.key]: e.target.value })
                }
              />
            )}
          </div>
        ))}
      </div>
      <div className="flex justify-end gap-2">
        <Button size="xs" variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        <Button size="xs" onClick={handleSubmit}>
          Add
        </Button>
      </div>
    </div>
  );
}

function CreateDatasetModal({
  defaultCabinetId,
  onClose,
  onCreated,
}: {
  defaultCabinetId?: string | null;
  onClose: () => void;
  onCreated: () => void;
}) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState<DatasetRecord["category"]>("custom");
  const [columns, setColumns] = useState<DatasetColumnRecord[]>([
    { key: "name", name: "Name", type: "text", required: true },
  ]);
  const [saving, setSaving] = useState(false);

  const addColumn = () => {
    const key = `col_${columns.length + 1}`;
    setColumns([
      ...columns,
      { key, name: "", type: "text", required: false },
    ]);
  };

  const removeColumn = (index: number) => {
    setColumns(columns.filter((_, i) => i !== index));
  };

  const updateColumn = (index: number, patch: Partial<DatasetColumnRecord>) => {
    setColumns(
      columns.map((col, i) => {
        if (i !== index) return col;
        const updated = { ...col, ...patch };
        if (patch.name !== undefined && !col.key.startsWith("col_")) {
          // don't auto-update key for manually set keys
        } else if (patch.name !== undefined) {
          updated.key = patch.name
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, "_")
            .replace(/^_|_$/g, "");
        }
        return updated;
      })
    );
  };

  const handleSubmit = async () => {
    if (!name.trim() || columns.length === 0) return;
    setSaving(true);
    try {
      await createDataset({
        name: name.trim(),
        description: description.trim(),
        category,
        cabinetId: defaultCabinetId ?? null,
        scope: "global",
        columns: columns.filter((c) => c.name.trim()),
      });
      onCreated();
    } catch {
      setSaving(false);
    }
  };

  return (
    <ModalBackdrop open={true} onClose={onClose}>
      <div
        className="bg-panel border border-line rounded-xl shadow-xl w-full max-w-lg p-5 space-y-4 max-h-[80vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-sm font-semibold text-fg">Create Dataset</h2>

        <div className="space-y-3">
          <div>
            <Label className="text-xs">Name</Label>
            <Input
              className="mt-1 text-xs"
              placeholder="e.g., NECA Labour Units"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <div>
            <Label className="text-xs">Description</Label>
            <Textarea
              className="mt-1 text-xs min-h-[50px]"
              placeholder="What this dataset contains"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>
          <div>
            <Label className="text-xs">Category</Label>
            <Select
              className="mt-1 text-xs"
              value={category}
              onChange={(e) =>
                setCategory(e.target.value as DatasetRecord["category"])
              }
            >
              {DATASET_CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {categoryLabel(c)}
                </option>
              ))}
            </Select>
          </div>
        </div>

        <Separator />

        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-semibold text-fg">Columns</h3>
            <Button size="xs" variant="secondary" onClick={addColumn}>
              <Plus className="h-3 w-3" />
              Add Column
            </Button>
          </div>
          {columns.map((col, idx) => (
            <div key={idx} className="flex items-center gap-2">
              <Input
                className="text-xs h-7 flex-1"
                placeholder="Column name"
                value={col.name}
                onChange={(e) => updateColumn(idx, { name: e.target.value })}
              />
              <Select
                className="text-xs h-7 w-28"
                value={col.type}
                onChange={(e) =>
                  updateColumn(idx, {
                    type: e.target.value as DatasetColumnRecord["type"],
                  })
                }
              >
                {COLUMN_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </Select>
              <Input
                className="text-xs h-7 w-20"
                placeholder="Unit"
                value={col.unit ?? ""}
                onChange={(e) => updateColumn(idx, { unit: e.target.value || undefined })}
              />
              <label className="flex items-center gap-1 text-[10px] text-fg/50">
                <input
                  type="checkbox"
                  checked={col.required}
                  onChange={(e) => updateColumn(idx, { required: e.target.checked })}
                />
                Req
              </label>
              {columns.length > 1 && (
                <button
                  className="text-fg/20 hover:text-danger"
                  onClick={() => removeColumn(idx)}
                >
                  <X className="h-3 w-3" />
                </button>
              )}
            </div>
          ))}
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <Button variant="ghost" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button
            size="sm"
            onClick={handleSubmit}
            disabled={saving || !name.trim() || columns.length === 0}
          >
            {saving ? "Creating..." : "Create Dataset"}
          </Button>
        </div>
      </div>
    </ModalBackdrop>
  );
}
