"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  BookOpen,
  ChevronDown,
  ChevronRight,
  Database,
  Download,
  FileText,
  Plus,
  Search,
  Sparkles,
  Table2,
  Trash2,
  Upload,
  X,
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
} from "@/lib/api";

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

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold text-fg">Knowledge & Datasets</h1>
          <p className="text-xs text-fg/50 mt-0.5">
            Upload books, manage reference data, and build structured datasets for estimating.
          </p>
        </div>
      </div>

      {/* Tab bar */}
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

      {tab === "books" && (
        <BooksTab books={books} onRefresh={refreshBooks} />
      )}
      {tab === "datasets" && (
        <DatasetsTab datasets={datasets} onRefresh={refreshDatasets} />
      )}
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────
// Books tab
// ────────────────────────────────────────────────────────────────────

function BooksTab({ books, onRefresh }: { books: KnowledgeBookRecord[]; onRefresh: () => void }) {
  const [expandedBookId, setExpandedBookId] = useState<string | null>(null);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");

  const filtered = searchQuery
    ? books.filter(
        (b) =>
          b.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
          b.description.toLowerCase().includes(searchQuery.toLowerCase())
      )
    : books;

  return (
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
              expanded={expandedBookId === book.id}
              onToggle={() =>
                setExpandedBookId(expandedBookId === book.id ? null : book.id)
              }
              onRefresh={onRefresh}
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
  );
}

function BookCard({
  book,
  expanded,
  onToggle,
  onRefresh,
}: {
  book: KnowledgeBookRecord;
  expanded: boolean;
  onToggle: () => void;
  onRefresh: () => void;
}) {
  const [chunks, setChunks] = useState<KnowledgeChunkRecord[]>([]);
  const [chunkSearch, setChunkSearch] = useState("");
  const [showAddChunk, setShowAddChunk] = useState(false);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    if (expanded) {
      listKnowledgeChunks(book.id).then(setChunks).catch(() => {});
    }
  }, [expanded, book.id]);

  const handleDelete = async () => {
    setDeleting(true);
    try {
      await deleteKnowledgeBook(book.id);
      onRefresh();
    } catch {
      setDeleting(false);
    }
  };

  const filteredChunks = chunkSearch
    ? chunks.filter(
        (c) =>
          c.sectionTitle.toLowerCase().includes(chunkSearch.toLowerCase()) ||
          c.text.toLowerCase().includes(chunkSearch.toLowerCase())
      )
    : chunks;

  return (
    <Card className={cn(expanded && "col-span-full")}>
      <div
        className="flex items-start gap-3 px-4 py-3 cursor-pointer"
        onClick={onToggle}
      >
        <div className="mt-0.5">
          {expanded ? (
            <ChevronDown className="h-4 w-4 text-fg/40" />
          ) : (
            <ChevronRight className="h-4 w-4 text-fg/40" />
          )}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <FileText className="h-4 w-4 text-fg/40 shrink-0" />
            <span className="text-sm font-medium text-fg truncate">
              {book.name}
            </span>
          </div>
          <p className="text-xs text-fg/50 mt-0.5 line-clamp-2">
            {book.description}
          </p>
          <div className="flex flex-wrap items-center gap-1.5 mt-2">
            <Badge tone="default">{categoryLabel(book.category)}</Badge>
            <Badge tone={scopeTone(book.scope)}>{book.scope}</Badge>
            <Badge tone={statusTone(book.status)}>{book.status}</Badge>
            <span className="text-[10px] text-fg/30">
              {book.chunkCount} chunks | {formatBytes(book.sourceFileSize)}
            </span>
          </div>
        </div>
        <Button
          variant="danger"
          size="xs"
          onClick={(e) => {
            e.stopPropagation();
            handleDelete();
          }}
          disabled={deleting}
        >
          <Trash2 className="h-3 w-3" />
        </Button>
      </div>

      {expanded && (
        <div className="border-t border-line px-4 py-3 space-y-3">
          <div className="flex items-center gap-2">
            <div className="relative flex-1">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-fg/25" />
              <Input
                className="h-7 pl-8 text-xs"
                placeholder="Search chunks..."
                value={chunkSearch}
                onChange={(e) => setChunkSearch(e.target.value)}
              />
            </div>
            <Button
              size="xs"
              variant="secondary"
              onClick={() => setShowAddChunk(true)}
            >
              <Plus className="h-3 w-3" />
              Add Text
            </Button>
          </div>

          {filteredChunks.length === 0 ? (
            <p className="text-xs text-fg/40 py-4 text-center">
              No chunks yet. Add text content to this book.
            </p>
          ) : (
            <div className="space-y-1.5 max-h-96 overflow-y-auto">
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
        </div>
      )}
    </Card>
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
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState<KnowledgeBookRecord["category"]>("general");
  const [scope, setScope] = useState<KnowledgeBookRecord["scope"]>("global");
  const [saving, setSaving] = useState(false);

  const handleSubmit = async () => {
    if (!name.trim()) return;
    setSaving(true);
    try {
      await createKnowledgeBook({
        name: name.trim(),
        description: description.trim(),
        category,
        scope,
        sourceFileName: `${name.trim()}.txt`,
        sourceFileSize: 0,
      });
      onCreated();
    } catch {
      setSaving(false);
    }
  };

  return (
    <ModalBackdrop open={true} onClose={onClose}>
      <div
        className="bg-panel border border-line rounded-xl shadow-xl w-full max-w-md p-5 space-y-4"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-sm font-semibold text-fg">Create Knowledge Book</h2>
        <div className="space-y-3">
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
            <Label className="text-xs">Description</Label>
            <Textarea
              className="mt-1 text-xs min-h-[60px]"
              placeholder="Brief description of the book's contents"
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
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="ghost" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button size="sm" onClick={handleSubmit} disabled={saving || !name.trim()}>
            {saving ? "Creating..." : "Create Book"}
          </Button>
        </div>
      </div>
    </ModalBackdrop>
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
        <div className="space-y-2">
          {filtered.map((dataset) => (
            <DatasetListItem
              key={dataset.id}
              dataset={dataset}
              onClick={() => setSelectedDatasetId(dataset.id)}
              onDelete={async () => {
                await deleteDataset(dataset.id);
                onRefresh();
              }}
            />
          ))}
        </div>
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
  const editRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const fetchRows = useCallback(async () => {
    try {
      const result = await listDatasetRows(dataset.id, {
        filter: searchQuery || undefined,
        limit: 200,
      });
      setRows(result.rows);
      setTotal(result.total);
    } catch { /* noop */ }
  }, [dataset.id, searchQuery]);

  useEffect(() => {
    fetchRows();
  }, [fetchRows]);

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
            <span className="font-medium">{col.name}</span>
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
                  {col.name}
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
                <td className="px-3 py-1.5 text-fg/30">{idx + 1}</td>
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
