"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import {
  AlertTriangle,
  Box,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Download,
  Edit3,
  ExternalLink,
  Eye,
  File,
  FilePlus,
  FileSpreadsheet,
  FileText,
  Folder,
  FolderOpen,
  FolderPlus,
  Image as ImageIcon,
  Loader2,
  Minus,
  MoreHorizontal,
  Plus,
  Scaling,
  Search,
  Table2,
  ClipboardCheck,
  Pencil,
  PenTool,
  Maximize2,
  Minimize2,
  MonitorUp,
  Trash2,
  Type,
  Upload,
  X,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { createPortal } from "react-dom";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import dynamic from "next/dynamic";

const RichTextEditor = dynamic(
  () => import("./editors/rich-text-editor").then((m) => ({ default: m.RichTextEditor })),
  { ssr: false }
);
const SpreadsheetEditor = dynamic(
  () => import("./editors/spreadsheet-editor").then((m) => ({ default: m.SpreadsheetEditor })),
  { ssr: false }
);
const CadViewer = dynamic(
  () => import("./editors/cad-viewer").then((m) => ({ default: m.CadViewer })),
  { ssr: false }
);
const BidwrightModelEditor = dynamic(
  () => import("./editors/bidwright-model-editor").then((m) => ({ default: m.BidwrightModelEditor })),
  { ssr: false }
);
const WhiteboardEditor = dynamic(
  () => import("./editors/whiteboard-editor").then((m) => ({ default: m.WhiteboardEditor })),
  { ssr: false }
);
const MarkdownEditor = dynamic(
  () => import("./editors/markdown-editor").then((m) => ({ default: m.MarkdownEditor })),
  { ssr: false }
);
const ChecklistEditor = dynamic(
  () => import("./editors/checklist-editor").then((m) => ({ default: m.ChecklistEditor })),
  { ssr: false }
);
const DocxViewer = dynamic(
  () => import("./viewers/docx-viewer").then((m) => ({ default: m.DocxViewer })),
  { ssr: false }
);
const XlsxViewer = dynamic(
  () => import("./viewers/xlsx-viewer").then((m) => ({ default: m.XlsxViewer })),
  { ssr: false }
);
const EmailViewer = dynamic(
  () => import("./viewers/email-viewer").then((m) => ({ default: m.EmailViewer })),
  { ssr: false }
);
const DxfViewer = dynamic(
  () => import("./viewers/dxf-viewer").then((m) => ({ default: m.DxfViewer })),
  { ssr: false }
);
const ZipViewer = dynamic(
  () => import("./viewers/zip-viewer").then((m) => ({ default: m.ZipViewer })),
  { ssr: false }
);
const RtfViewer = dynamic(
  () => import("./viewers/rtf-viewer").then((m) => ({ default: m.RtfViewer })),
  { ssr: false }
);

import type {
  FileNode,
  PackageRecord,
  ProjectWorkspaceData,
  SourceDocument,
} from "@/lib/api";
import {
  createFileNode,
  deleteFileNode,
  getFileDownloadUrl,
  getDocumentDownloadUrl,
  getFileTree,
  updateFileNode,
  uploadFile,
} from "@/lib/api";
import type { SourceDocumentStructuredData } from "@/lib/api";
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
import { buildModelEditorUrl, isBidwrightEditableModel } from "./editors/bidwright-model-editor";

/* ─── Types ─── */

interface TreeItem {
  id: string;
  name: string;
  type: "file" | "directory";
  parentId: string | null;
  children: TreeItem[];
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

const IMAGE_EXTENSIONS = new Set(["jpg", "jpeg", "png", "gif", "webp", "bmp", "tiff", "tif", "svg"]);
const PDF_EXTENSIONS = new Set(["pdf"]);
const SPREADSHEET_EXTENSIONS = new Set(["csv", "tsv"]);
const TEXT_EXTENSIONS = new Set(["txt", "md", "markdown", "json", "xml", "yaml", "yml", "log", "cfg", "ini", "html", "css", "js", "ts"]);
const CAD_EXTENSIONS = new Set(["step", "stp", "iges", "igs", "brep", "stl", "obj", "fbx", "gltf", "glb", "3ds", "dae", "ifc", "rvt"]);
const DOCX_EXTENSIONS = new Set(["docx", "doc"]);
const XLSX_EXTENSIONS = new Set(["xlsx", "xls"]);
const EMAIL_EXTENSIONS = new Set(["eml", "msg"]);
const DXF_EXTENSIONS = new Set(["dxf", "dwg"]);
const ZIP_EXTENSIONS = new Set(["zip", "7z", "rar", "tar", "gz"]);
const RTF_EXTENSIONS = new Set(["rtf"]);

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

function getFileExtension(name: string): string {
  return name.split(".").pop()?.toLowerCase() ?? "";
}

type FilePreviewType = "pdf" | "image" | "spreadsheet" | "text" | "cad" | "docx" | "xlsx" | "email" | "dxf" | "zip" | "rtf" | "none";

function getFilePreviewType(item: TreeItem): FilePreviewType {
  const ext = getFileExtension(item.name);
  if (PDF_EXTENSIONS.has(ext)) return "pdf";
  if (IMAGE_EXTENSIONS.has(ext)) return "image";
  if (TEXT_EXTENSIONS.has(ext)) return "text";
  if (CAD_EXTENSIONS.has(ext)) return "cad";
  if (DOCX_EXTENSIONS.has(ext)) return "docx";
  if (XLSX_EXTENSIONS.has(ext)) return "xlsx";
  if (SPREADSHEET_EXTENSIONS.has(ext)) return "xlsx";
  if (EMAIL_EXTENSIONS.has(ext)) return "email";
  if (DXF_EXTENSIONS.has(ext)) return "dxf";
  if (ZIP_EXTENSIONS.has(ext)) return "zip";
  if (RTF_EXTENSIONS.has(ext)) return "rtf";
  return "none";
}

function hasExtractedContent(item: TreeItem): boolean {
  if (item.extractedText) return true;
  const sd = item.sourceDocument?.structuredData;
  return !!(sd && ((sd.tables && sd.tables.length > 0) || (sd.keyValuePairs && sd.keyValuePairs.length > 0)));
}

function getDownloadUrl(item: TreeItem, projectId: string, inline = false): string | null {
  if (item.fileNode?.storagePath) {
    return getFileDownloadUrl(projectId, item.fileNode.id, inline);
  }
  if (item.sourceDocument) {
    return getDocumentDownloadUrl(projectId, item.sourceDocument.id, inline);
  }
  return null;
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
    return children.sort((a, b) => {
      if (a.type !== b.type) return a.type === "directory" ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
  }

  return attachChildren(null);
}

function isJunkFile(name: string): boolean {
  const base = name.split("/").pop() ?? name;
  if (base.startsWith("._")) return true;
  if (base === "Thumbs.db" || base === ".DS_Store") return true;
  return false;
}

function splitSourceDocumentPath(fileName: string) {
  return fileName.replace(/\\/g, "/").split("/").filter(Boolean);
}

function sortTreeItems(items: TreeItem[]): TreeItem[] {
  return items
    .map((item) => item.type === "directory" ? { ...item, children: sortTreeItems(item.children) } : item)
    .sort((a, b) => {
      if (a.type !== b.type) return a.type === "directory" ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
}

function buildSourceDocumentChildren(parentId: string, documents: SourceDocument[]): TreeItem[] {
  const rootChildren: TreeItem[] = [];
  const directoryMap = new Map<string, TreeItem>();

  for (const doc of documents) {
    const segments = splitSourceDocumentPath(doc.fileName);
    const fileName = segments.pop() ?? doc.fileName;
    let currentChildren = rootChildren;
    let currentParentId = parentId;
    let currentPath = "";

    for (const segment of segments) {
      currentPath = currentPath ? `${currentPath}/${segment}` : segment;
      let directory = directoryMap.get(currentPath);
      if (!directory) {
        directory = {
          id: `${parentId}::dir::${currentPath}`,
          name: segment,
          type: "directory",
          parentId: currentParentId,
          children: [],
          isAutoFolder: true,
          documentType: doc.documentType,
        };
        directoryMap.set(currentPath, directory);
        currentChildren.push(directory);
      }

      currentChildren = directory.children;
      currentParentId = directory.id;
    }

    currentChildren.push({
      id: `doc-${doc.id}`,
      name: fileName,
      type: "file",
      parentId: currentParentId,
      children: [],
      sourceDocument: doc,
      documentType: doc.documentType,
      fileType: doc.fileType,
      pageCount: doc.pageCount,
      createdAt: doc.createdAt,
      extractedText: doc.extractedText,
    });
  }

  return sortTreeItems(rootChildren);
}

function buildAutoFolders(documents: SourceDocument[]): TreeItem[] {
  // Filter out macOS resource forks (._*) and other junk files
  documents = documents.filter((d) => !isJunkFile(d.fileName));
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
      children: buildSourceDocumentChildren(`auto-${cfg.key}`, docs),
    });
  }

  const knownTypes = new Set(FOLDER_CONFIG.map((c) => c.documentType));
  const uncategorized = documents.filter((d) => !knownTypes.has(d.documentType));
  if (uncategorized.length > 0) {
    folders.push({
      id: "auto-other",
      name: "Other",
      type: "directory",
      parentId: null,
      isAutoFolder: true,
      children: buildSourceDocumentChildren("auto-other", uncategorized),
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

/* ─── PDF Preview (lazy loaded) ─── */

function PdfPreview({ url, fileName }: { url: string; fileName: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const pdfDocRef = useRef<any>(null);
  const renderTaskRef = useRef<any>(null);
  const fitScaleRef = useRef<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pageNumber, setPageNumber] = useState(1);
  const [pageCount, setPageCount] = useState(0);
  const [zoom, setZoom] = useState<number | null>(null); // null = fit-to-width
  const [isFitMode, setIsFitMode] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function loadPdf() {
      try {
        setLoading(true);
        setError(null);

        if (pdfDocRef.current) {
          pdfDocRef.current.destroy();
          pdfDocRef.current = null;
        }

        const pdfjs = await import("pdfjs-dist");
        if (typeof window !== "undefined" && !pdfjs.GlobalWorkerOptions.workerSrc) {
          pdfjs.GlobalWorkerOptions.workerSrc = new URL(
            "pdfjs-dist/build/pdf.worker.min.mjs",
            import.meta.url
          ).toString();
        }

        const loadingTask = pdfjs.getDocument({ url, withCredentials: true });
        const doc = await loadingTask.promise;

        if (cancelled) {
          doc.destroy();
          return;
        }

        pdfDocRef.current = doc;
        setPageCount(doc.numPages);
        setPageNumber(1);
        setZoom(null);
        setIsFitMode(true);
        setLoading(false);
      } catch (err) {
        if (!cancelled) {
          const msg = err instanceof Error ? err.message : "Failed to load PDF";
          setError(msg.includes("Invalid PDF") ? "This PDF file could not be loaded — the file may be missing or corrupted." : msg);
          setLoading(false);
        }
      }
    }

    loadPdf();
    return () => {
      cancelled = true;
    };
  }, [url]);

  const renderPage = useCallback(async () => {
    const doc = pdfDocRef.current;
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!doc || !canvas || !container) return;

    const clampedPage = Math.max(1, Math.min(pageNumber, doc.numPages));

    try {
      if (renderTaskRef.current) {
        renderTaskRef.current.cancel();
        renderTaskRef.current = null;
      }

      const page = await doc.getPage(clampedPage);

      // Calculate fit-to-width scale based on container
      const containerWidth = container.clientWidth - 32; // subtract padding
      const unscaledViewport = page.getViewport({ scale: 1 });
      const fitScale = containerWidth / unscaledViewport.width;
      fitScaleRef.current = fitScale;

      const effectiveScale = isFitMode ? fitScale : (zoom ?? fitScale);
      const viewport = page.getViewport({ scale: effectiveScale });

      // Use 2x device pixel ratio for sharp rendering
      const dpr = window.devicePixelRatio || 1;
      canvas.width = viewport.width * dpr;
      canvas.height = viewport.height * dpr;
      canvas.style.width = `${viewport.width}px`;
      canvas.style.height = `${viewport.height}px`;

      const ctx = canvas.getContext("2d");
      if (ctx) ctx.scale(dpr, dpr);

      const renderTask = page.render({
        canvasContext: ctx!,
        viewport,
      });
      renderTaskRef.current = renderTask;
      await renderTask.promise;
      renderTaskRef.current = null;
    } catch (err: unknown) {
      if (err instanceof Error && err.message?.includes("Rendering cancelled")) return;
    }
  }, [pageNumber, zoom, isFitMode]);

  useEffect(() => {
    if (!loading && !error) renderPage();
  }, [loading, error, renderPage]);

  // Re-render on container resize for fit-to-width
  useEffect(() => {
    if (!isFitMode || loading || error) return;
    const container = containerRef.current;
    if (!container) return;

    const observer = new ResizeObserver(() => {
      renderPage();
    });
    observer.observe(container);
    return () => observer.disconnect();
  }, [isFitMode, loading, error, renderPage]);

  useEffect(() => {
    return () => {
      if (renderTaskRef.current) renderTaskRef.current.cancel();
      if (pdfDocRef.current) {
        pdfDocRef.current.destroy();
        pdfDocRef.current = null;
      }
    };
  }, []);

  const displayZoom = isFitMode
    ? fitScaleRef.current ? Math.round(fitScaleRef.current * 100) : 100
    : Math.round((zoom ?? 1) * 100);

  const handleZoomOut = () => {
    const current = isFitMode ? (fitScaleRef.current ?? 1) : (zoom ?? 1);
    setIsFitMode(false);
    setZoom(Math.max(0.25, current - 0.2));
  };

  const handleZoomIn = () => {
    const current = isFitMode ? (fitScaleRef.current ?? 1) : (zoom ?? 1);
    setIsFitMode(false);
    setZoom(Math.min(4, current + 0.2));
  };

  const handleFitToWidth = () => {
    setIsFitMode(true);
    setZoom(null);
  };

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 p-8 text-sm text-danger">
        <AlertTriangle className="h-5 w-5" />
        <p>{error}</p>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center p-8">
        <Loader2 className="h-5 w-5 animate-spin text-accent" />
        <span className="ml-2 text-sm text-fg/50">Loading PDF...</span>
      </div>
    );
  }

  return (
    <div className="flex flex-col flex-1 min-h-0">
      {/* PDF Controls */}
      <div className="flex items-center justify-between border-b border-line px-3 py-2 bg-panel2/30 shrink-0">
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="xs"
            onClick={() => setPageNumber((p) => Math.max(1, p - 1))}
            disabled={pageNumber <= 1}
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <span className="text-xs text-fg/60 min-w-[80px] text-center">
            {pageNumber} / {pageCount}
          </span>
          <Button
            variant="ghost"
            size="xs"
            onClick={() => setPageNumber((p) => Math.min(pageCount, p + 1))}
            disabled={pageNumber >= pageCount}
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="xs"
            onClick={handleZoomOut}
            title="Zoom out"
          >
            <ZoomOut className="h-3.5 w-3.5" />
          </Button>
          <span className="text-xs text-fg/50 min-w-[40px] text-center">
            {displayZoom}%
          </span>
          <Button
            variant="ghost"
            size="xs"
            onClick={handleZoomIn}
            title="Zoom in"
          >
            <ZoomIn className="h-3.5 w-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="xs"
            onClick={handleFitToWidth}
            className={cn(
              "ml-1",
              isFitMode ? "text-accent" : "text-fg/50 hover:text-fg"
            )}
            title="Fit to width"
          >
            <Scaling className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      {/* PDF Canvas */}
      <div ref={containerRef} className="overflow-auto bg-bg/30 flex-1 flex justify-center p-4 min-h-0">
        <canvas ref={canvasRef} className="block shadow-lg" />
      </div>
    </div>
  );
}

/* ─── Image Preview ─── */

function ImagePreview({ url, fileName }: { url: string; fileName: string }) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  return (
    <div className="flex flex-col items-center justify-center p-4 overflow-auto bg-bg/30">
      {loading && !error && (
        <div className="flex items-center gap-2 py-4">
          <Loader2 className="h-5 w-5 animate-spin text-accent" />
          <span className="text-sm text-fg/50">Loading image...</span>
        </div>
      )}
      {error ? (
        <div className="flex flex-col items-center gap-2 p-8 text-sm text-danger">
          <ImageIcon className="h-5 w-5" />
          <p>Failed to load image</p>
        </div>
      ) : (
        /* eslint-disable-next-line @next/next/no-img-element */
        <img
          src={url}
          alt={fileName}
          className={cn("max-w-full max-h-[70vh] object-contain rounded shadow-lg", loading && "hidden")}
          onLoad={() => setLoading(false)}
          onError={() => {
            setLoading(false);
            setError(true);
          }}
        />
      )}
    </div>
  );
}

/* ─── Text Preview ─── */

function TextPreview({ url, extractedText }: { url: string | null; extractedText?: string }) {
  const [content, setContent] = useState<string | null>(extractedText ?? null);
  const [loading, setLoading] = useState(!extractedText && !!url);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (extractedText || !url) {
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);

    fetch(url)
      .then(async (res) => {
        if (!res.ok) throw new Error(`${res.status}`);
        const text = await res.text();
        if (!cancelled) {
          setContent(text);
          setLoading(false);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to load");
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [url, extractedText]);

  if (loading) {
    return (
      <div className="flex items-center justify-center p-8">
        <Loader2 className="h-5 w-5 animate-spin text-accent" />
        <span className="ml-2 text-sm text-fg/50">Loading content...</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center gap-2 p-8 text-sm text-danger">
        <AlertTriangle className="h-5 w-5" />
        <p>Failed to load: {error}</p>
      </div>
    );
  }

  if (!content) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 p-8 flex-1">
        <FileText className="h-8 w-8 text-fg/15" />
        <p className="text-sm text-fg/40">No content available for preview</p>
      </div>
    );
  }

  return (
    <div className="overflow-auto bg-bg/30 p-4 flex-1">
      <pre className="text-xs text-fg/70 leading-relaxed whitespace-pre-wrap font-mono">
        {truncateText(content, 50000)}
      </pre>
    </div>
  );
}

/* ─── Spreadsheet Preview (CSV/TSV) ─── */

function SpreadsheetPreview({ url, extractedText, fileName }: { url: string | null; extractedText?: string; fileName: string }) {
  const [content, setContent] = useState<string | null>(extractedText ?? null);
  const [loading, setLoading] = useState(!extractedText);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (extractedText || !url) return;
    let cancelled = false;
    setLoading(true);
    setError(null);

    fetch(url)
      .then(async (res) => {
        if (!res.ok) throw new Error(`${res.status}`);
        const text = await res.text();
        if (!cancelled) { setContent(text); setLoading(false); }
      })
      .catch((err) => {
        if (!cancelled) { setError(err instanceof Error ? err.message : "Failed to load"); setLoading(false); }
      });
    return () => { cancelled = true; };
  }, [url, extractedText]);

  if (loading) {
    return (
      <div className="flex items-center justify-center p-8">
        <Loader2 className="h-5 w-5 animate-spin text-accent" />
        <span className="ml-2 text-sm text-fg/50">Loading spreadsheet...</span>
      </div>
    );
  }

  if (error || !content) {
    return (
      <div className="flex flex-col items-center gap-2 p-8 text-sm text-danger">
        <AlertTriangle className="h-5 w-5" />
        <p>{error ?? "No content available"}</p>
      </div>
    );
  }

  const ext = getFileExtension(fileName);
  const separator = ext === "tsv" ? "\t" : ",";
  const rows = parseCSV(content, separator);
  const headerRow = rows[0] ?? [];
  const dataRows = rows.slice(1);

  return (
    <div className="overflow-auto bg-bg/30 flex-1 p-2">
      <table className="w-full text-xs border-collapse">
        {headerRow.length > 0 && (
          <thead>
            <tr>
              {headerRow.map((cell, i) => (
                <th
                  key={i}
                  className="sticky top-0 bg-panel2 border border-line px-2 py-1.5 text-left font-medium text-fg/70 whitespace-nowrap"
                >
                  {cell}
                </th>
              ))}
            </tr>
          </thead>
        )}
        <tbody>
          {dataRows.slice(0, 500).map((row, ri) => (
            <tr key={ri} className={ri % 2 === 0 ? "bg-panel/30" : ""}>
              {row.map((cell, ci) => (
                <td
                  key={ci}
                  className="border border-line/50 px-2 py-1 text-fg/60 whitespace-nowrap max-w-[300px] truncate"
                >
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {dataRows.length > 500 && (
        <p className="text-[11px] text-fg/30 text-center py-2">
          Showing first 500 of {dataRows.length} rows
        </p>
      )}
    </div>
  );
}

/** Simple CSV parser that handles quoted fields */
function parseCSV(text: string, separator: string): string[][] {
  const rows: string[][] = [];
  const lines = text.split("\n");
  for (const line of lines) {
    if (!line.trim()) continue;
    const cells: string[] = [];
    let current = "";
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (inQuotes) {
        if (ch === '"' && line[i + 1] === '"') {
          current += '"';
          i++;
        } else if (ch === '"') {
          inQuotes = false;
        } else {
          current += ch;
        }
      } else {
        if (ch === '"') {
          inQuotes = true;
        } else if (ch === separator) {
          cells.push(current.trim());
          current = "";
        } else {
          current += ch;
        }
      }
    }
    cells.push(current.trim());
    rows.push(cells);
  }
  return rows;
}

/* ─── Structured Content View ─── */

function StructuredContentView({
  structuredData,
  extractedText,
}: {
  structuredData: SourceDocumentStructuredData | null | undefined;
  extractedText: string | undefined;
}) {
  const tables = structuredData?.tables ?? [];
  const keyValuePairs = structuredData?.keyValuePairs ?? [];
  const hasStructured = tables.length > 0 || keyValuePairs.length > 0;

  if (hasStructured) {
    return (
      <div className="overflow-auto bg-bg/30 p-4 flex-1 space-y-6">
        {/* Key-Value Pairs */}
        {keyValuePairs.length > 0 && (
          <div>
            <h4 className="text-[11px] font-medium uppercase text-fg/40 tracking-wider mb-2 flex items-center gap-1.5">
              <FileText className="h-3 w-3" />
              Key-Value Pairs ({keyValuePairs.length})
            </h4>
            <div className="rounded-lg border border-line overflow-hidden">
              <table className="w-full text-xs">
                <thead>
                  <tr className="bg-panel2/50">
                    <th className="text-left px-3 py-1.5 font-medium text-fg/60 border-b border-line w-[30%]">Key</th>
                    <th className="text-left px-3 py-1.5 font-medium text-fg/60 border-b border-line">Value</th>
                    <th className="text-right px-3 py-1.5 font-medium text-fg/60 border-b border-line w-[80px]">Conf.</th>
                  </tr>
                </thead>
                <tbody>
                  {keyValuePairs.map((kv, i) => (
                    <tr key={i} className={i % 2 === 0 ? "bg-panel/20" : ""}>
                      <td className="px-3 py-1.5 text-fg/70 font-medium">{kv.key}</td>
                      <td className="px-3 py-1.5 text-fg/60">{kv.value || "—"}</td>
                      <td className="px-3 py-1.5 text-right text-fg/40">
                        {Math.round(kv.confidence * 100)}%
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Tables */}
        {tables.map((table, ti) => (
          <div key={ti}>
            <h4 className="text-[11px] font-medium uppercase text-fg/40 tracking-wider mb-2 flex items-center gap-1.5">
              <Table2 className="h-3 w-3" />
              Table {ti + 1}
              <span className="text-fg/25">· Page {table.pageNumber}</span>
            </h4>
            <div className="rounded-lg border border-line overflow-auto">
              <table className="w-full text-xs border-collapse">
                {table.headers.length > 0 && (
                  <thead>
                    <tr>
                      {table.headers.map((h, hi) => (
                        <th
                          key={hi}
                          className="sticky top-0 bg-panel2 border-b border-line px-2.5 py-1.5 text-left font-medium text-fg/70 whitespace-nowrap"
                        >
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                )}
                <tbody>
                  {table.rows.map((row, ri) => (
                    <tr key={ri} className={ri % 2 === 0 ? "bg-panel/20" : ""}>
                      {row.map((cell, ci) => (
                        <td
                          key={ci}
                          className="border-b border-line/30 px-2.5 py-1.5 text-fg/60 whitespace-nowrap max-w-[300px] truncate"
                        >
                          {cell}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ))}

        {/* Full text below structured data */}
        {extractedText && (
          <div>
            <h4 className="text-[11px] font-medium uppercase text-fg/40 tracking-wider mb-2">
              Full Text
            </h4>
            <pre className="text-xs text-fg/50 leading-relaxed whitespace-pre-wrap font-mono rounded-lg border border-line p-3 bg-panel/20">
              {truncateText(extractedText, 50000)}
            </pre>
          </div>
        )}
      </div>
    );
  }

  // Fallback: plain text only
  if (!extractedText) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 p-8 text-sm text-fg/40">
        <FileText className="h-8 w-8 text-fg/15" />
        <p>No extracted content available</p>
      </div>
    );
  }

  return (
    <div className="overflow-auto bg-bg/30 p-4 flex-1">
      <pre className="text-xs text-fg/70 leading-relaxed whitespace-pre-wrap font-mono">
        {truncateText(extractedText, 50000)}
      </pre>
    </div>
  );
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
  const ext = getFileExtension(item.name);
  const isImage = IMAGE_EXTENSIONS.has(ext);
  const isPdf = PDF_EXTENSIONS.has(ext);

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
      {...(item.sourceDocument ? { "data-document-id": item.sourceDocument.id } : {})}
    >
      {isPdf ? (
        <FileText className="h-3.5 w-3.5 shrink-0 text-danger/70" />
      ) : isImage ? (
        <ImageIcon className="h-3.5 w-3.5 shrink-0 text-success/70" />
      ) : item.sourceDocument ? (
        <FileText className="h-3.5 w-3.5 shrink-0" />
      ) : (
        <File className="h-3.5 w-3.5 shrink-0" />
      )}
      <span className="flex-1 truncate">{item.name}</span>
      {item.pageCount != null && item.pageCount > 0 && (
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
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(
    new Set(["auto-specs", "auto-drawings"])
  );
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [userNodes, setUserNodes] = useState<FileNode[]>([]);
  const [loadingNodes, setLoadingNodes] = useState(true);

  // Upload state
  const [uploading, setUploading] = useState(false);
  const [dragActive, setDragActive] = useState(false);

  // New folder creation
  const [creatingFolder, setCreatingFolder] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");
  const [newFolderParentId, setNewFolderParentId] = useState<string | null>(null);

  // Rename
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");

  // Error feedback
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const showError = useCallback((msg: string) => {
    setErrorMessage(msg);
    setTimeout(() => setErrorMessage(null), 5000);
  }, []);

  // Load user file nodes
  useEffect(() => {
    setLoadingNodes(true);
    getFileTree(projectId)
      .then(setUserNodes)
      .catch(() => setUserNodes([]))
      .finally(() => setLoadingNodes(false));
  }, [projectId]);

  // Build tree
  const tree = useMemo(() => {
    const autoFolders = buildAutoFolders(workspace.sourceDocuments ?? []);
    const userTree = buildTreeFromNodes(userNodes);
    return [...autoFolders, ...userTree];
  }, [workspace.sourceDocuments, userNodes]);

  const filteredTree = useMemo(
    () => filterTree(tree, searchQuery),
    [tree, searchQuery]
  );

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

  // ── Upload handling ────────────────────────────────────────────────────

  const handleUploadFiles = useCallback(async (files: FileList | File[]) => {
    if (files.length === 0) return;
    setUploading(true);
    setErrorMessage(null);

    // Determine parent: if a directory is selected, upload into it
    let parentId: string | null = null;
    if (selectedItem?.type === "directory" && selectedItem.fileNode) {
      parentId = selectedItem.fileNode.id;
    }

    try {
      for (const file of Array.from(files)) {
        const node = await uploadFile(projectId, file, parentId);
        setUserNodes((prev) => [...prev, node]);
      }
      // Expand parent if uploading into a folder
      if (parentId) {
        setExpandedFolders((prev) => new Set([...prev, parentId!]));
      }
    } catch (err) {
      showError(`Upload failed: ${err instanceof Error ? err.message : "Unknown error"}`);
    } finally {
      setUploading(false);
    }
  }, [projectId, selectedItem, showError]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    if (e.dataTransfer.files.length > 0) {
      handleUploadFiles(e.dataTransfer.files);
    }
  }, [handleUploadFiles]);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
  }, []);

  // ── CRUD handlers ──────────────────────────────────────────────────────

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
      if (newFolderParentId) {
        setExpandedFolders((prev) => new Set([...prev, newFolderParentId!]));
      }
    } catch (err) {
      showError(`Failed to create folder: ${err instanceof Error ? err.message : "Unknown error"}`);
    }
  }, [projectId, newFolderName, newFolderParentId, showError]);

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
      showError(`Failed to rename: ${err instanceof Error ? err.message : "Unknown error"}`);
    }
  }, [projectId, renamingId, renameValue, showError]);

  const handleDelete = useCallback(async (item: TreeItem) => {
    if (!item.fileNode) return;
    try {
      await deleteFileNode(projectId, item.fileNode.id);
      setUserNodes((prev) => {
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
      showError(`Failed to delete: ${err instanceof Error ? err.message : "Unknown error"}`);
    }
  }, [projectId, selectedId, showError]);

  const handleContextAction = useCallback((action: string, item: TreeItem) => {
    if (action === "rename" && item.fileNode) {
      setRenamingId(item.fileNode.id);
      setRenameValue(item.name);
    } else if (action === "delete") {
      handleDelete(item);
    }
  }, [handleDelete]);

  // ── Preview URL ────────────────────────────────────────────────────────

  const previewUrl = useMemo(() => {
    if (!selectedItem || selectedItem.type === "directory") return null;
    return getDownloadUrl(selectedItem, projectId, true);
  }, [selectedItem, projectId]);

  const downloadUrl = useMemo(() => {
    if (!selectedItem || selectedItem.type === "directory") return null;
    return getDownloadUrl(selectedItem, projectId, false);
  }, [selectedItem, projectId]);

  const filePreviewType = selectedItem ? getFilePreviewType(selectedItem) : "none";
  const isEmbeddedModelEditorPreview =
    selectedItem?.type === "file" && filePreviewType === "cad" && isBidwrightEditableModel(selectedItem.name);
  const hasExtracted = selectedItem ? hasExtractedContent(selectedItem) : false;
  // Show tabs when there is extracted content (so user can toggle between file view and text)
  const showPreviewTabs = selectedItem?.type === "file" && (hasExtracted && filePreviewType !== "none" || hasExtracted);
  const [previewTab, setPreviewTab] = useState<"file" | "extracted">("file");
  const [editorMode, setEditorMode] = useState<"none" | "rich-text" | "spreadsheet" | "whiteboard" | "markdown" | "checklist">("none");
  const [editorFileName, setEditorFileName] = useState("");

  // ── Resizable divider ──────────────────────────────────────────────────
  const [leftPanelWidth, setLeftPanelWidth] = useState(30);
  const isDraggingDivider = useRef(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const handleDividerMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    isDraggingDivider.current = true;
    document.body.style.cursor = "col-resize";
  }, []);

  useEffect(() => {
    function cleanupDrag() {
      isDraggingDivider.current = false;
      document.body.style.cursor = "";
    }
    function handleMouseMove(e: MouseEvent) {
      if (!isDraggingDivider.current || !containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      let pct = ((e.clientX - rect.left) / rect.width) * 100;
      pct = Math.max(20, Math.min(60, pct));
      setLeftPanelWidth(pct);
    }
    function handleMouseUp() {
      if (isDraggingDivider.current) cleanupDrag();
    }
    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
      cleanupDrag(); // ensure body styles are always restored on unmount
    };
  }, []);

  // ── Fullscreen ─────────────────────────────────────────────────────────
  const [isFullscreen, setIsFullscreen] = useState(false);

  useEffect(() => {
    if (!isFullscreen) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setIsFullscreen(false);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isFullscreen]);

  // ── Detached window (pop-out) ──────────────────────────────────────────
  const [isDetached, setIsDetached] = useState(false);
  const [detachedContainer, setDetachedContainer] = useState<HTMLDivElement | null>(null);
  const detachedWindowRef = useRef<Window | null>(null);

  const handlePopOut = useCallback(() => {
    if (isEmbeddedModelEditorPreview && previewUrl) {
      const editorUrl = buildModelEditorUrl(previewUrl, selectedItem?.name ?? "Model", 0);
      window.open(editorUrl, "_blank", "width=1400,height=900,resizable=yes");
      return;
    }

    if (detachedWindowRef.current && !detachedWindowRef.current.closed) {
      detachedWindowRef.current.focus();
      return;
    }
    const newWindow = window.open("", "_blank", "width=1200,height=800");
    if (!newWindow) return;
    detachedWindowRef.current = newWindow;
    setIsDetached(true);

    newWindow.document.title = selectedItem?.name ?? "Preview";
    newWindow.document.documentElement.className = document.documentElement.className;
    newWindow.document.body.className = document.body.className;
    newWindow.document.body.style.margin = "0";

    const rootStyles = document.documentElement.getAttribute("style");
    if (rootStyles) newWindow.document.documentElement.setAttribute("style", rootStyles);

    document.querySelectorAll('style, link[rel="stylesheet"]').forEach((el) => {
      newWindow.document.head.appendChild(el.cloneNode(true));
    });

    const mount = newWindow.document.createElement("div");
    mount.id = "detached-root";
    mount.style.height = "100vh";
    mount.style.display = "flex";
    mount.style.flexDirection = "column";
    newWindow.document.body.appendChild(mount);
    setDetachedContainer(mount);

    newWindow.addEventListener("beforeunload", () => {
      detachedWindowRef.current = null;
      setIsDetached(false);
      setDetachedContainer(null);
    });
  }, [isEmbeddedModelEditorPreview, previewUrl, selectedItem?.name]);

  useEffect(() => {
    if (detachedWindowRef.current && !detachedWindowRef.current.closed && selectedItem) {
      detachedWindowRef.current.document.title = selectedItem.name;
    }
  }, [selectedItem]);

  useEffect(() => {
    return () => {
      if (detachedWindowRef.current && !detachedWindowRef.current.closed) {
        detachedWindowRef.current.close();
      }
    };
  }, []);

  const handleEditorSave = useCallback(async (content: string | Blob, fileName: string, mimeType: string, extension: string) => {
    try {
      const safeName = fileName.endsWith(`.${extension}`) ? fileName : `${fileName}.${extension}`;
      const blob = content instanceof Blob ? content : new Blob([content], { type: mimeType });
      const file = new globalThis.File([blob], safeName, { type: mimeType });
      const node = await uploadFile(projectId, file);
      // Refresh tree
      const updatedNodes = await getFileTree(projectId);
      setUserNodes(updatedNodes);
      // Select the new file
      setSelectedId(node.id);
      setEditorMode("none");
    } catch (err) {
      showError(`Failed to save: ${err instanceof Error ? err.message : "Unknown error"}`);
    }
  }, [projectId, showError]);

  // Reset to file tab when selection changes
  useEffect(() => {
    setPreviewTab("file");
  }, [selectedId]);

  /* ─── Preview content (extracted for fullscreen / detach reuse) ─── */
  const previewContent = editorMode !== "none" ? (
    <div className="flex-1 overflow-hidden flex flex-col">
      {editorMode === "rich-text" && (
        <RichTextEditor fileName={editorFileName} onSave={(html) => handleEditorSave(html, editorFileName, "text/html", "html")} onClose={() => setEditorMode("none")} />
      )}
      {editorMode === "spreadsheet" && (
        <SpreadsheetEditor fileName={editorFileName} onSave={(blob) => handleEditorSave(blob, editorFileName, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "xlsx")} onClose={() => setEditorMode("none")} />
      )}
      {editorMode === "whiteboard" && (
        <WhiteboardEditor fileName={editorFileName} onSave={(data) => handleEditorSave(data, editorFileName, "application/json", "excalidraw")} onClose={() => setEditorMode("none")} />
      )}
      {editorMode === "markdown" && (
        <MarkdownEditor fileName={editorFileName} onSave={(content) => handleEditorSave(content, editorFileName, "text/markdown", "md")} onClose={() => setEditorMode("none")} />
      )}
      {editorMode === "checklist" && (
        <ChecklistEditor fileName={editorFileName} onSave={(data) => handleEditorSave(data, editorFileName, "application/json", "checklist.json")} onClose={() => setEditorMode("none")} />
      )}
    </div>
  ) : !selectedItem ? (
    <div className="flex-1 flex items-center justify-center">
      <EmptyState>Click a file or folder in the tree to view its details and preview.</EmptyState>
    </div>
  ) : selectedItem.type === "directory" ? (
    <div className="flex-1 flex flex-col">
      <div className="flex items-center justify-between px-4 py-3 border-b border-line">
        <span className="text-sm font-semibold text-fg">{selectedItem.name}</span>
        {selectedItem.isAutoFolder && (
          <Badge tone={TYPE_BADGE_TONE[selectedItem.documentType ?? ""] ?? "default"}>Auto-organized</Badge>
        )}
      </div>
      <CardBody className="flex-1">
        <div className="space-y-4">
          <div><p className="text-[11px] font-medium text-fg/40 uppercase tracking-wider">Contents</p><p className="mt-1 text-sm text-fg/70">{selectedItem.children.length} item{selectedItem.children.length !== 1 ? "s" : ""}</p></div>
          {selectedItem.fileNode && (
            <div className="flex gap-2 pt-2">
              <Button variant="secondary" size="xs" onClick={() => { setRenamingId(selectedItem.fileNode!.id); setRenameValue(selectedItem.name); }}><Edit3 className="h-3.5 w-3.5" /> Rename</Button>
              <Button variant="danger" size="xs" onClick={() => handleDelete(selectedItem)}><Trash2 className="h-3.5 w-3.5" /> Delete</Button>
            </div>
          )}
        </div>
      </CardBody>
    </div>
  ) : (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Preview area */}
      <div className="flex-1 overflow-hidden flex flex-col">
        {previewTab === "file" || !hasExtracted ? (
          <>
            {filePreviewType === "pdf" && previewUrl && <PdfPreview key={previewUrl} url={previewUrl} fileName={selectedItem.name} />}
            {filePreviewType === "image" && previewUrl && <ImagePreview key={previewUrl} url={previewUrl} fileName={selectedItem.name} />}
            {filePreviewType === "text" && <TextPreview key={selectedItem.id} url={previewUrl} extractedText={!hasExtracted ? selectedItem.extractedText : undefined} />}
            {filePreviewType === "cad" && previewUrl && (
              <div className="flex-1 min-h-[400px]">
                {isBidwrightEditableModel(selectedItem.name) ? (
                  <BidwrightModelEditor fileUrl={previewUrl} fileName={selectedItem.name} />
                ) : (
                  <CadViewer fileUrl={previewUrl} fileName={selectedItem.name} />
                )}
              </div>
            )}
            {filePreviewType === "docx" && previewUrl && <DocxViewer key={previewUrl} url={previewUrl} fileName={selectedItem.name} />}
            {filePreviewType === "xlsx" && previewUrl && <div className="flex-1 min-h-0"><XlsxViewer key={previewUrl} url={previewUrl} fileName={selectedItem.name} /></div>}
            {filePreviewType === "email" && previewUrl && <EmailViewer key={previewUrl} url={previewUrl} fileName={selectedItem.name} />}
            {filePreviewType === "dxf" && previewUrl && <div className="flex-1 min-h-[400px]"><DxfViewer key={previewUrl} url={previewUrl} fileName={selectedItem.name} /></div>}
            {filePreviewType === "zip" && previewUrl && <ZipViewer key={previewUrl} url={previewUrl} fileName={selectedItem.name} />}
            {filePreviewType === "rtf" && previewUrl && <RtfViewer key={previewUrl} url={previewUrl} fileName={selectedItem.name} />}
            {filePreviewType === "none" && (
              <div className="flex-1 flex flex-col items-center justify-center gap-3 p-8">
                <File className="h-12 w-12 text-fg/15" />
                <p className="text-sm text-fg/40">Preview not available for this file type</p>
                {downloadUrl && <a href={downloadUrl} download><Button variant="secondary" size="sm"><Download className="h-4 w-4" /> Download File</Button></a>}
                {hasExtracted && !showPreviewTabs && (
                  <div className="w-full mt-4">
                    <p className="text-[11px] font-medium text-fg/40 uppercase tracking-wider mb-2">Extracted Text</p>
                    <div className="max-h-64 overflow-y-auto rounded-md border border-line bg-bg/50 p-2.5 text-xs text-fg/60 leading-relaxed whitespace-pre-wrap">{truncateText(selectedItem.extractedText!, 2000)}</div>
                  </div>
                )}
              </div>
            )}
          </>
        ) : (
          <StructuredContentView key={selectedItem.id} structuredData={selectedItem.sourceDocument?.structuredData} extractedText={selectedItem.extractedText} />
        )}
      </div>
    </div>
  );

  return (
    <div className="flex h-full" ref={containerRef}>
      <Card className="flex flex-1 flex-row overflow-hidden">
        {/* ─── Left Panel: File Tree ─── */}
        <div className="flex flex-col overflow-hidden border-r border-line" style={{ width: `${leftPanelWidth}%` }}>
          <CardHeader className="flex flex-row items-center justify-between gap-3 shrink-0">
            <CardTitle>Project Documents</CardTitle>
            <div className="flex items-center gap-1.5">
              <DropdownMenu.Root>
                <DropdownMenu.Trigger asChild>
                  <Button variant="secondary" size="xs">
                    <FilePlus className="h-3.5 w-3.5" />
                    New
                    <ChevronDown className="h-3 w-3 ml-0.5" />
                  </Button>
                </DropdownMenu.Trigger>
                <DropdownMenu.Portal>
                  <DropdownMenu.Content
                    className="z-[100] min-w-[180px] rounded-lg border border-line bg-panel p-1 shadow-xl"
                    sideOffset={4}
                    align="end"
                  >
                    <DropdownMenu.Item
                      className="flex items-center gap-2 rounded-md px-3 py-2 text-xs text-fg/70 outline-none cursor-pointer hover:bg-panel2 transition-colors"
                      onSelect={() => {
                        setCreatingFolder(true);
                        setNewFolderParentId(null);
                      }}
                    >
                      <FolderPlus className="h-3.5 w-3.5" />
                      New Folder
                    </DropdownMenu.Item>
                    <DropdownMenu.Separator className="my-1 h-px bg-line" />
                    <DropdownMenu.Item
                      className="flex items-center gap-2 rounded-md px-3 py-2 text-xs text-fg/70 outline-none cursor-pointer hover:bg-panel2 transition-colors"
                      onSelect={() => {
                        setEditorFileName("Untitled Document");
                        setEditorMode("rich-text");
                        setSelectedId(null);
                      }}
                    >
                      <Type className="h-3.5 w-3.5" />
                      Rich Text Document
                    </DropdownMenu.Item>
                    <DropdownMenu.Item
                      className="flex items-center gap-2 rounded-md px-3 py-2 text-xs text-fg/70 outline-none cursor-pointer hover:bg-panel2 transition-colors"
                      onSelect={() => {
                        setEditorFileName("Untitled Spreadsheet");
                        setEditorMode("spreadsheet");
                        setSelectedId(null);
                      }}
                    >
                      <FileSpreadsheet className="h-3.5 w-3.5" />
                      Spreadsheet
                    </DropdownMenu.Item>
                    <DropdownMenu.Item
                      className="flex items-center gap-2 rounded-md px-3 py-2 text-xs text-fg/70 outline-none cursor-pointer hover:bg-panel2 transition-colors"
                      onSelect={() => {
                        setEditorFileName("Untitled Whiteboard");
                        setEditorMode("whiteboard");
                        setSelectedId(null);
                      }}
                    >
                      <PenTool className="h-3.5 w-3.5" />
                      Whiteboard / Diagram
                    </DropdownMenu.Item>
                    <DropdownMenu.Item
                      className="flex items-center gap-2 rounded-md px-3 py-2 text-xs text-fg/70 outline-none cursor-pointer hover:bg-panel2 transition-colors"
                      onSelect={() => {
                        setEditorFileName("Untitled Note");
                        setEditorMode("markdown");
                        setSelectedId(null);
                      }}
                    >
                      <Pencil className="h-3.5 w-3.5" />
                      Markdown Note
                    </DropdownMenu.Item>
                    <DropdownMenu.Item
                      className="flex items-center gap-2 rounded-md px-3 py-2 text-xs text-fg/70 outline-none cursor-pointer hover:bg-panel2 transition-colors"
                      onSelect={() => {
                        setEditorFileName("Untitled Checklist");
                        setEditorMode("checklist");
                        setSelectedId(null);
                      }}
                    >
                      <ClipboardCheck className="h-3.5 w-3.5" />
                      Checklist / Punch List
                    </DropdownMenu.Item>
                    <DropdownMenu.Separator className="my-1 h-px bg-line" />
                    <DropdownMenu.Label className="px-3 py-1 text-[10px] font-medium text-fg/30 uppercase tracking-wider">
                      Import
                    </DropdownMenu.Label>
                    <DropdownMenu.Item
                      className="flex items-center gap-2 rounded-md px-3 py-2 text-xs text-fg/70 outline-none cursor-pointer hover:bg-panel2 transition-colors"
                      onSelect={() => fileInputRef.current?.click()}
                    >
                      <Upload className="h-3.5 w-3.5" />
                      Upload Files
                    </DropdownMenu.Item>
                  </DropdownMenu.Content>
                </DropdownMenu.Portal>
              </DropdownMenu.Root>
              <input
                ref={fileInputRef}
                type="file"
                multiple
                className="hidden"
                onChange={(e) => {
                  if (e.target.files) handleUploadFiles(e.target.files);
                  e.target.value = "";
                }}
              />
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

          {/* Error banner */}
          <AnimatePresence>
            {errorMessage && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto" }}
                exit={{ opacity: 0, height: 0 }}
                className="border-b border-danger/20 bg-danger/5 px-4 py-2"
              >
                <div className="flex items-center gap-2">
                  <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-danger" />
                  <span className="flex-1 text-xs text-danger">{errorMessage}</span>
                  <button
                    onClick={() => setErrorMessage(null)}
                    className="text-danger/50 hover:text-danger"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Tree with drag-and-drop */}
          <div
            className={cn(
              "flex-1 overflow-y-auto px-2 py-2 transition-colors relative",
              dragActive && "bg-accent/5 ring-2 ring-inset ring-accent/30"
            )}
            onDrop={handleDrop}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
          >
            {/* Drag overlay */}
            {dragActive && (
              <div className="absolute inset-0 z-10 flex items-center justify-center bg-accent/5 pointer-events-none">
                <div className="flex flex-col items-center gap-2 text-accent">
                  <Upload className="h-8 w-8" />
                  <p className="text-sm font-medium">Drop files to upload</p>
                </div>
              </div>
            )}

            {loadingNodes ? (
              <div className="flex items-center justify-center py-8">
                <div className="h-5 w-5 animate-spin rounded-full border-2 border-accent border-t-transparent" />
              </div>
            ) : filteredTree.length === 0 ? (
              <EmptyState className="mt-4">
                No documents or files yet. Upload files or drag and drop.
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
        </div>

        {/* ─── Resizable Divider ─── */}
        <div
          className="w-1.5 shrink-0 cursor-col-resize bg-transparent hover:bg-accent/20 active:bg-accent/30 transition-colors"
          onMouseDown={handleDividerMouseDown}
        />

        {/* ─── Right Panel: Preview ─── */}
        <div className="flex flex-1 flex-col overflow-hidden min-w-0">
          {/* File header — only in normal panel view (not in fullscreen/detached) */}
          {editorMode === "none" && selectedItem && selectedItem.type === "file" && (
            <>
              <div className="flex items-center justify-between gap-3 px-4 py-2.5 border-b border-line shrink-0">
                <div className="flex min-w-0 flex-1 items-center gap-2">
                  <span className="min-w-0 truncate text-sm font-semibold text-fg">{selectedItem.name}</span>
                  {selectedItem.documentType && (
                    <Badge tone={TYPE_BADGE_TONE[selectedItem.documentType] ?? "default"}>{selectedItem.documentType}</Badge>
                  )}
                  {isEmbeddedModelEditorPreview && (
                    <div className="hidden shrink-0 items-center gap-3 text-xs text-fg/45 md:flex">
                      {selectedItem.fileType && <span className="uppercase font-medium">{selectedItem.fileType}</span>}
                      {selectedItem.size != null && <span>{formatBytes(selectedItem.size)}</span>}
                      {selectedItem.createdAt && <span>{formatDate(selectedItem.createdAt)}</span>}
                    </div>
                  )}
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  <Button variant="ghost" size="xs" onClick={() => setIsFullscreen(true)} title="Fullscreen">
                    <Maximize2 className="h-3.5 w-3.5" />
                  </Button>
                  <Button variant="ghost" size="xs" onClick={handlePopOut} title="Open in new window">
                    <MonitorUp className="h-3.5 w-3.5" />
                  </Button>
                  {downloadUrl && (
                    <a href={downloadUrl} download><Button variant="secondary" size="xs"><Download className="h-3.5 w-3.5" /> Download</Button></a>
                  )}
                  {selectedItem.fileNode && (
                    <>
                      <Button variant="secondary" size="xs" onClick={() => { setRenamingId(selectedItem.fileNode!.id); setRenameValue(selectedItem.name); }}><Edit3 className="h-3.5 w-3.5" /></Button>
                      <Button variant="danger" size="xs" onClick={() => handleDelete(selectedItem)}><Trash2 className="h-3.5 w-3.5" /></Button>
                    </>
                  )}
                </div>
              </div>
              {/* Metadata bar */}
              {!isEmbeddedModelEditorPreview && (
                <div className="flex items-center gap-4 border-b border-line px-4 py-2 text-xs text-fg/50 shrink-0">
                  {selectedItem.fileType && <span className="uppercase font-medium">{selectedItem.fileType}</span>}
                  {selectedItem.pageCount != null && selectedItem.pageCount > 0 && <span>{selectedItem.pageCount} pages</span>}
                  {selectedItem.size != null && <span>{formatBytes(selectedItem.size)}</span>}
                  {selectedItem.createdAt && <span>{formatDate(selectedItem.createdAt)}</span>}
                </div>
              )}
              {/* Preview tabs */}
              {showPreviewTabs && (
                <div className="flex items-center gap-1 px-4 border-b border-line shrink-0">
                  <button onClick={() => setPreviewTab("file")} className={cn("flex items-center gap-1.5 px-3 py-2 text-xs font-medium transition-colors border-b-2 -mb-px", previewTab === "file" ? "border-accent text-accent" : "border-transparent text-fg/50 hover:text-fg/70")}><Eye className="h-3 w-3" /> File</button>
                  <button onClick={() => setPreviewTab("extracted")} className={cn("flex items-center gap-1.5 px-3 py-2 text-xs font-medium transition-colors border-b-2 -mb-px", previewTab === "extracted" ? "border-accent text-accent" : "border-transparent text-fg/50 hover:text-fg/70")}><FileText className="h-3 w-3" /> Extracted</button>
                </div>
              )}
            </>
          )}
          {previewContent}
        </div>
      </Card>

      {/* ─── Fullscreen Overlay ─── */}
      {isFullscreen && (
        <div className="fixed inset-0 z-50 bg-bg flex flex-col" onClick={(e) => { if (e.target === e.currentTarget) setIsFullscreen(false); }}>
          <div className="flex items-center justify-between px-4 py-2.5 border-b border-line shrink-0 bg-panel">
            <div className="flex items-center gap-2 min-w-0">
              <span className="text-sm font-semibold text-fg truncate">{selectedItem?.name ?? editorFileName}</span>
              {selectedItem?.documentType && (
                <Badge tone={TYPE_BADGE_TONE[selectedItem.documentType] ?? "default"}>{selectedItem.documentType}</Badge>
              )}
            </div>
            <div className="flex items-center gap-1.5">
              {downloadUrl && (
                <a href={downloadUrl} download><Button variant="secondary" size="xs"><Download className="h-3.5 w-3.5" /> Download</Button></a>
              )}
              <Button variant="secondary" size="xs" onClick={() => setIsFullscreen(false)}>
                <Minimize2 className="h-3.5 w-3.5" />
                Exit
              </Button>
            </div>
          </div>
          <div className="flex-1 overflow-hidden flex flex-col">
            {previewContent}
          </div>
        </div>
      )}

      {/* ─── Detached Window Portal ─── */}
      {isDetached && detachedContainer && createPortal(
        <div className="flex flex-col h-full bg-bg text-fg">
          <div className="flex items-center justify-between px-4 py-2.5 border-b border-line shrink-0">
            <span className="text-sm font-semibold truncate">{selectedItem?.name ?? editorFileName}</span>
            {downloadUrl && (
              <a href={downloadUrl} download><Button variant="secondary" size="xs"><Download className="h-3.5 w-3.5" /> Download</Button></a>
            )}
          </div>
          <div className="flex-1 overflow-hidden flex flex-col">
            {previewContent}
          </div>
        </div>,
        detachedContainer
      )}
    </div>
  );
}
