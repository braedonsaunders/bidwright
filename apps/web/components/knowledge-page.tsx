"use client";

import { useCallback, useEffect, useRef, useState } from "react";
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
  Minus,
  Plus,
  Search,
  Sparkles,
  Table2,
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
import type {
  KnowledgeBookRecord,
  KnowledgeChunkRecord,
  DatasetRecord,
  DatasetRowRecord,
  DatasetColumnRecord,
} from "@/lib/api";
import {
  listKnowledgeBooks,
  createKnowledgeBook,
  deleteKnowledgeBook,
  updateKnowledgeBook,
  listKnowledgeChunks,
  createKnowledgeChunk,
  searchKnowledge,
  listDatasets,
  createDataset,
  deleteDataset,
  listDatasetRows,
  createDatasetRow,
  createDatasetRowsBatch,
  updateDatasetRow,
  deleteDatasetRow,
  searchDatasetRows,
  listDatasetLibrary,
  adoptDatasetTemplate,
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

// ────────────────────────────────────────────────────────────────────
// Main component
// ────────────────────────────────────────────────────────────────────

export function KnowledgePage({
  initialBooks,
  initialDatasets,
}: {
  initialBooks: KnowledgeBookRecord[];
  initialDatasets: DatasetRecord[];
}) {
  const [tab, setTab] = useState<Tab>("books");
  const [books, setBooks] = useState(initialBooks);
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

  // Fetch on mount since initialBooks may be empty due to race condition
  useEffect(() => {
    refreshBooks();
    refreshDatasets();
  }, [refreshBooks, refreshDatasets]);

  return (
    <div className="space-y-5">
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

      <FadeIn delay={0.1}>
      {tab === "books" && (
        <BooksTab books={books} onRefresh={refreshBooks} />
      )}
      {tab === "datasets" && (
        <DatasetsTab datasets={datasets} onRefresh={refreshDatasets} />
      )}
      </FadeIn>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────
// Books tab
// ────────────────────────────────────────────────────────────────────

function BooksTab({ books, onRefresh }: { books: KnowledgeBookRecord[]; onRefresh: () => void }) {
  const [selectedBookId, setSelectedBookId] = useState<string | null>(null);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");

  const filtered = searchQuery
    ? books.filter(
        (b) =>
          b.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
          b.description.toLowerCase().includes(searchQuery.toLowerCase())
      )
    : books;

  const selectedBook = books.find((b) => b.id === selectedBookId) ?? null;

  return (
    <>
    <div className="space-y-4">
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

      {filtered.length === 0 ? (
        <EmptyState>
          <BookOpen className="mx-auto h-8 w-8 text-fg/20 mb-2" />
          <p className="text-sm text-fg/50">No knowledge books yet.</p>
          <p className="text-xs text-fg/30 mt-1">
            Upload reference books, standards, and guides to make them available to the AI agent.
          </p>
        </EmptyState>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((book) => (
            <BookCard
              key={book.id}
              book={book}
              selected={book.id === selectedBookId}
              onSelect={() => setSelectedBookId(book.id === selectedBookId ? null : book.id)}
              onDelete={async () => {
                await deleteKnowledgeBook(book.id);
                if (selectedBookId === book.id) setSelectedBookId(null);
                onRefresh();
              }}
            />
          ))}
        </div>
      )}

      {showCreateModal && (
        <CreateBookModal
          onClose={() => setShowCreateModal(false)}
          onCreated={() => {
            setShowCreateModal(false);
            onRefresh();
          }}
        />
      )}

    </div>

    {typeof document !== "undefined" && createPortal(
      <AnimatePresence>
        {selectedBook && (
          <BookDetailPanel
            key={selectedBook.id}
            book={selectedBook}
            onClose={() => setSelectedBookId(null)}
            onRefresh={onRefresh}
          />
        )}
      </AnimatePresence>,
      document.body,
    )}
    </>
  );
}

function BookCard({
  book,
  selected,
  onSelect,
  onDelete,
}: {
  book: KnowledgeBookRecord;
  selected: boolean;
  onSelect: () => void;
  onDelete: () => void;
}) {
  const [deleting, setDeleting] = useState(false);
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
          {book.status}
        </Badge>
      </div>

      {/* Info */}
      <div className="px-3 py-2.5">
        <h3 className="text-sm font-medium text-fg truncate">{book.name}</h3>
        <p className="text-[11px] text-fg/40 mt-0.5 truncate">{book.sourceFileName}</p>
        <div className="flex flex-wrap items-center gap-1.5 mt-2">
          <Badge tone="default">{categoryLabel(book.category)}</Badge>
          <Badge tone={scopeTone(book.scope)}>{book.scope}</Badge>
        </div>
        <div className="flex items-center justify-between mt-2">
          <span className="text-[10px] text-fg/30">
            {book.pageCount} pages · {book.chunkCount} chunks · {formatBytes(book.sourceFileSize)}
          </span>
          <Button
            variant="danger"
            size="xs"
            onClick={(e) => {
              e.stopPropagation();
              setDeleting(true);
              onDelete();
            }}
            disabled={deleting}
          >
            <Trash2 className="h-3 w-3" />
          </Button>
        </div>
      </div>
    </Card>
  );
}

type DetailTab = "view" | "chunks" | "search";

function BookDetailPanel({
  book,
  onClose,
  onRefresh,
}: {
  book: KnowledgeBookRecord;
  onClose: () => void;
  onRefresh: () => void;
}) {
  const [detailTab, setDetailTab] = useState<DetailTab>("view");
  const [chunks, setChunks] = useState<KnowledgeChunkRecord[]>([]);
  const [chunkSearch, setChunkSearch] = useState("");
  const [showAddChunk, setShowAddChunk] = useState(false);

  // PDF viewer state
  const [pageNumber, setPageNumber] = useState(1);
  const [pageCount, setPageCount] = useState(0);
  const [zoom, setZoom] = useState(1.0);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  // Search state
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<Array<{ id: string; text: string; score: number; sectionTitle?: string; pageNumber?: number }>>([]);
  const [searching, setSearching] = useState(false);

  useEffect(() => {
    listKnowledgeChunks(book.id).then(setChunks).catch(() => {});
  }, [book.id]);

  const handleSearch = async () => {
    if (!searchQuery.trim()) return;
    setSearching(true);
    try {
      const res = await searchBookChunks(book.id, searchQuery);
      setSearchResults(res.hits);
    } catch { /* noop */ }
    setSearching(false);
  };

  const filteredChunks = chunkSearch
    ? chunks.filter(
        (c) =>
          c.sectionTitle.toLowerCase().includes(chunkSearch.toLowerCase()) ||
          c.text.toLowerCase().includes(chunkSearch.toLowerCase())
      )
    : chunks;

  const hasPdf = book.sourceFileName.toLowerCase().endsWith(".pdf") && book.storagePath;
  const fileUrl = getBookFileUrl(book.id);

  const detailTabs: Array<{ key: DetailTab; label: string; icon: typeof Eye }> = [
    ...(hasPdf ? [{ key: "view" as const, label: "View", icon: Eye }] : []),
    { key: "chunks", label: "Chunks", icon: FileText },
    { key: "search", label: "Search", icon: Search },
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
              <span className="text-xs text-fg/60 min-w-[80px] text-center">
                Page {pageNumber} / {pageCount || "..."}
              </span>
              <Button size="xs" variant="secondary" disabled={pageNumber >= pageCount} onClick={() => setPageNumber((p) => Math.min(pageCount, p + 1))}>
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
            </div>
            {/* PDF canvas */}
            <div className="flex-1 overflow-auto flex items-start justify-center p-4 bg-panel2/20">
              <PdfCanvasViewer
                documentUrl={fileUrl}
                pageNumber={pageNumber}
                zoom={zoom}
                onPageCount={setPageCount}
                canvasRef={canvasRef}
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

            {filteredChunks.length === 0 ? (
              <p className="text-xs text-fg/40 py-4 text-center">
                No chunks{chunkSearch ? " matching filter" : " yet"}.
              </p>
            ) : (
              <div className="space-y-1.5">
                {filteredChunks.map((chunk) => (
                  <ChunkItem key={chunk.id} chunk={chunk} />
                ))}
              </div>
            )}

            {showAddChunk && (
              <AddChunkForm
                bookId={book.id}
                onClose={() => setShowAddChunk(false)}
                onCreated={async () => {
                  setShowAddChunk(false);
                  const updatedChunks = await listKnowledgeChunks(book.id);
                  setChunks(updatedChunks);
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
              <Button size="sm" onClick={handleSearch} disabled={searching}>
                {searching ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Search className="h-3.5 w-3.5" />}
                Search
              </Button>
            </div>

            {searchResults.length > 0 ? (
              <div className="space-y-2">
                {searchResults.map((hit) => (
                  <div key={hit.id} className="rounded-lg border border-line bg-panel2/50 px-3 py-2">
                    <div className="flex items-center gap-2 mb-1">
                      {hit.sectionTitle && (
                        <span className="text-xs font-medium text-fg/70 truncate">{hit.sectionTitle}</span>
                      )}
                      {hit.pageNumber && (
                        <span className="text-[10px] text-fg/30">p.{hit.pageNumber}</span>
                      )}
                      <span className="text-[10px] text-accent ml-auto">{(hit.score * 100).toFixed(0)}% match</span>
                    </div>
                    <p className="text-xs text-fg/50 line-clamp-3">{hit.text}</p>
                  </div>
                ))}
              </div>
            ) : searchQuery && !searching ? (
              <p className="text-xs text-fg/40 py-4 text-center">No results. Try different search terms.</p>
            ) : (
              <p className="text-xs text-fg/40 py-4 text-center">
                Search across this book using semantic similarity. Results are ranked by relevance.
              </p>
            )}
          </motion.div>
        )}
        </AnimatePresence>
      </div>
    </motion.div>
  );
}

function ChunkItem({ chunk }: { chunk: KnowledgeChunkRecord }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <div
      className="rounded-lg border border-line bg-panel2/50 px-3 py-2 cursor-pointer"
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
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: () => void;
}) {
  const [name, setName] = useState("");
  const [category, setCategory] = useState<KnowledgeBookRecord["category"]>("general");
  const [scope, setScope] = useState<KnowledgeBookRecord["scope"]>("global");
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
        scope,
      });
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
          <div className="grid grid-cols-2 gap-3">
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
            <div>
              <Label className="text-xs">Scope</Label>
              <Select
                className="mt-1 text-xs"
                value={scope}
                onChange={(e) =>
                  setScope(e.target.value as KnowledgeBookRecord["scope"])
                }
              >
                <option value="global">Global</option>
                <option value="project">Project</option>
              </Select>
            </div>
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
  datasets,
  onSelect,
  onDelete,
}: {
  datasets: DatasetRecord[];
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
}) {
  const [page, setPage] = useState(0);
  const pageSize = 20;
  const totalPages = Math.ceil(datasets.length / pageSize);
  const visible = datasets.slice(page * pageSize, (page + 1) * pageSize);

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
          dataset={dataset}
          onClick={() => onSelect(dataset.id)}
          onDelete={async () => onDelete(dataset.id)}
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
  onRefresh,
}: {
  datasets: DatasetRecord[];
  onRefresh: () => void;
}) {
  const [selectedDatasetId, setSelectedDatasetId] = useState<string | null>(null);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showLibrary, setShowLibrary] = useState(false);
  const [libraryDatasets, setLibraryDatasets] = useState<DatasetRecord[]>([]);
  const [adopting, setAdopting] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");

  const filtered = searchQuery
    ? datasets.filter(
        (d) =>
          d.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
          d.description.toLowerCase().includes(searchQuery.toLowerCase())
      )
    : datasets;

  const selectedDataset = datasets.find((d) => d.id === selectedDatasetId);

  return (
    <div className="space-y-4">
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
          try { setLibraryDatasets(await listDatasetLibrary()); } catch { /* noop */ }
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

      {selectedDataset ? (
        <DatasetDetail
          dataset={selectedDataset}
          onBack={() => setSelectedDatasetId(null)}
          onRefresh={onRefresh}
        />
      ) : filtered.length === 0 ? (
        <EmptyState>
          <Database className="mx-auto h-8 w-8 text-fg/20 mb-2" />
          <p className="text-sm text-fg/50">No datasets yet.</p>
          <p className="text-xs text-fg/30 mt-1">
            Create structured datasets for labour units, equipment rates, and more.
          </p>
        </EmptyState>
      ) : (
        <DatasetListPaginated
          datasets={filtered}
          onSelect={(id) => setSelectedDatasetId(id)}
          onDelete={async (id) => {
            await deleteDataset(id);
            onRefresh();
          }}
        />
      )}

      {showCreateModal && (
        <CreateDatasetModal
          onClose={() => setShowCreateModal(false)}
          onCreated={() => {
            setShowCreateModal(false);
            onRefresh();
          }}
        />
      )}

      {showLibrary && (
        <ModalBackdrop open={showLibrary} onClose={() => setShowLibrary(false)} size="lg">
          <div className="p-5">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="text-sm font-bold text-fg">Dataset Library</h3>
                <p className="text-xs text-fg/40 mt-0.5">Add standard datasets to your organization</p>
              </div>
              <button onClick={() => setShowLibrary(false)} className="rounded p-1 hover:bg-panel2 text-fg/40">
                <X className="h-4 w-4" />
              </button>
            </div>

            {libraryDatasets.length === 0 ? (
              <div className="py-6 text-center text-sm text-fg/40">
                No datasets available in the library yet.
              </div>
            ) : (
              <div className="space-y-3 max-h-[60vh] overflow-y-auto">
                {libraryDatasets.map((tmpl) => {
                  const alreadyAdopted = datasets.some((d) => d.sourceTemplateId === tmpl.id);
                  return (
                    <div key={tmpl.id} className="rounded-lg border border-line p-4 hover:border-accent/30 transition-colors">
                      <div className="flex items-start justify-between">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <Database className="h-4 w-4 text-accent shrink-0" />
                            <span className="text-sm font-medium text-fg">{tmpl.name}</span>
                            <Badge tone="info" className="text-[10px]">{categoryLabel(tmpl.category)}</Badge>
                          </div>
                          <p className="text-xs text-fg/50 mt-1 ml-6">{tmpl.description}</p>
                          <div className="text-xs text-fg/30 mt-1 ml-6">
                            {tmpl.rowCount.toLocaleString()} rows · {tmpl.columns.length} columns
                          </div>
                        </div>
                        <div className="shrink-0 ml-4">
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
                                  await adoptDatasetTemplate(tmpl.id);
                                  onRefresh();
                                } catch { /* noop */ }
                                finally { setAdopting(null); }
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
        </ModalBackdrop>
      )}
    </div>
  );
}

function DatasetListItem({
  dataset,
  onClick,
  onDelete,
}: {
  dataset: DatasetRecord;
  onClick: () => void;
  onDelete: () => void;
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
          <p className="text-xs text-fg/50 mt-0.5">{dataset.description}</p>
        </div>
        <div className="text-right shrink-0 flex items-center gap-3">
          <div>
            <span className="text-sm font-semibold text-fg">{dataset.rowCount}</span>
            <span className="text-xs text-fg/40 ml-1">rows</span>
          </div>
          <span className="text-[10px] text-fg/30">
            {dataset.columns.length} cols
          </span>
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
  onBack,
  onRefresh,
}: {
  dataset: DatasetRecord;
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
          </div>
          <p className="text-xs text-fg/50 mt-0.5">{dataset.description}</p>
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
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: () => void;
}) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState<DatasetRecord["category"]>("custom");
  const [scope, setScope] = useState<DatasetRecord["scope"]>("global");
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
        scope,
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
          <div className="grid grid-cols-2 gap-3">
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
            <div>
              <Label className="text-xs">Scope</Label>
              <Select
                className="mt-1 text-xs"
                value={scope}
                onChange={(e) =>
                  setScope(e.target.value as DatasetRecord["scope"])
                }
              >
                <option value="global">Global</option>
                <option value="project">Project</option>
              </Select>
            </div>
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
