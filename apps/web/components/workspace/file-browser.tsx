"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import {
  AlertTriangle,
  ArrowRight,
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
  Ruler,
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
import { loadPdfJs } from "@/lib/pdfjs-loader";

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
const BluebeamMarkupsViewer = dynamic(
  () => import("./viewers/bluebeam-markups-viewer").then((m) => ({ default: m.BluebeamMarkupsViewer })),
  { ssr: false }
);
const RtfViewer = dynamic(
  () => import("./viewers/rtf-viewer").then((m) => ({ default: m.RtfViewer })),
  { ssr: false }
);

import type {
  FileNode,
  ModelAsset,
  PackageRecord,
  ProjectWorkspaceData,
  SourceDocument,
  WorkspaceWorksheet,
} from "@/lib/api";
import {
  createFileNode,
  deleteFileNode,
  deleteSourceDocument,
  getFileDownloadUrl,
  getDocumentDownloadUrl,
  getFileTree,
  listModelAssets,
  saveFileNodeContent,
  updateFileNode,
  updateSourceDocument,
  uploadFile,
  uploadSourceDocument,
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
  Label,
  ModalBackdrop,
  Select,
} from "@/components/ui";
import { BidwrightMark } from "@/components/brand-logo";
import { cn } from "@/lib/utils";
import { formatDate } from "@/lib/format";
import { buildModelEditorUrl, isBidwrightEditableModel } from "./editors/bidwright-model-editor";
import type { BidwrightModelDocumentSaveMessage } from "./editors/bidwright-model-editor";

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
  selectedWorksheet?: WorkspaceWorksheet | null;
  modelEditorChannelName?: string;
  onOpenInTakeoff?: (documentId: string) => void;
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
const CAD_EXTENSIONS = new Set(["cd", "step", "stp", "iges", "igs", "brep", "stl", "obj", "fbx", "gltf", "glb", "3ds", "dae", "ifc", "rvt"]);
const DOCX_EXTENSIONS = new Set(["docx", "doc"]);
const XLSX_EXTENSIONS = new Set(["xlsx", "xls", "xlsm", "ods"]);
const EMAIL_EXTENSIONS = new Set(["eml", "msg"]);
const DXF_EXTENSIONS = new Set(["dxf", "dwg"]);
const ZIP_EXTENSIONS = new Set(["zip", "7z", "rar", "tar", "gz", "tgz"]);
const MARKUP_CANDIDATE_EXTENSIONS = new Set(["csv", "tsv", "xml", "xlsx", "xls", "xlsm", "ods"]);
const RTF_EXTENSIONS = new Set(["rtf"]);
const FILE_UPLOAD_ACCEPT = [
  ".zip", ".7z", ".rar", ".tar", ".gz", ".tgz",
  ".pdf",
  ".xlsx", ".xls", ".xlsm", ".ods", ".csv", ".tsv",
  ".doc", ".docx", ".rtf", ".pptx",
  ".html", ".htm", ".mhtml", ".mht", ".txt", ".xml",
  ".png", ".jpg", ".jpeg", ".tif", ".tiff", ".bmp",
  ".dwg", ".dxf", ".msg", ".eml",
  ".mpp", ".mpt", ".mpx", ".xer", ".p6xml", ".pmxml",
].join(",");
const FILE_NODE_DND_TYPE = "application/x-bidwright-file-node";
const ROOT_PARENT_VALUE = "__root__";

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

function isTakeoffOpenableFileName(name: string) {
  const ext = getFileExtension(name);
  return PDF_EXTENSIONS.has(ext) || DXF_EXTENSIONS.has(ext) || CAD_EXTENSIONS.has(ext);
}

function getTakeoffDocumentIdForItem(item: TreeItem): string | null {
  if (item.type !== "file" || !isTakeoffOpenableFileName(item.name)) return null;
  if (item.fileNode) return `file-${item.fileNode.id}`;
  if (item.sourceDocument) return item.sourceDocument.id;
  return null;
}

function ensureModelDocumentName(name?: string | null): string {
  const cleaned = name?.trim() || "Untitled Model";
  return cleaned.toLowerCase().endsWith(".cd") ? cleaned : `${cleaned.replace(/\.[^.]+$/, "")}.cd`;
}

function nextUntitledModelName(nodes: FileNode[]): string {
  const names = new Set(nodes.map((node) => node.name.toLowerCase()));
  const base = "Untitled Model";
  let index = 0;
  while (true) {
    const candidate = index === 0 ? `${base}.cd` : `${base} ${index + 1}.cd`;
    if (!names.has(candidate.toLowerCase())) return candidate;
    index += 1;
  }
}

type FilePreviewType = "pdf" | "image" | "spreadsheet" | "text" | "cad" | "docx" | "xlsx" | "email" | "dxf" | "zip" | "rtf" | "none";
type EditorMode = "none" | "rich-text" | "spreadsheet" | "whiteboard" | "markdown" | "checklist" | "model";

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

function getIngestSourceReference(item?: TreeItem | null): { sourceKind: "source_document" | "file_node"; sourceId: string } | null {
  if (!item || item.type !== "file") return null;
  if (item.fileNode) return { sourceKind: "file_node", sourceId: item.fileNode.id };
  if (item.sourceDocument) return { sourceKind: "source_document", sourceId: item.sourceDocument.id };
  return null;
}

function isMarkupCandidate(item?: TreeItem | null) {
  return Boolean(item && item.type === "file" && MARKUP_CANDIDATE_EXTENSIONS.has(getFileExtension(item.name)));
}

function findModelAssetForItem(assets: ModelAsset[], item?: TreeItem | null) {
  if (!item || item.type !== "file") return undefined;
  const fileName = item.name.toLowerCase();
  return assets.find((asset) =>
    (item.fileNode?.id && asset.fileNodeId === item.fileNode.id) ||
    (item.sourceDocument?.id && asset.sourceDocumentId === item.sourceDocument.id) ||
    asset.fileName.toLowerCase() === fileName
  );
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

function isInternalFileNodeDrag(e: React.DragEvent) {
  return Array.from(e.dataTransfer.types).includes(FILE_NODE_DND_TYPE);
}

function isDescendantFileNode(nodes: FileNode[], nodeId: string, ancestorId: string) {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  let current = byId.get(nodeId);
  while (current?.parentId) {
    if (current.parentId === ancestorId) return true;
    current = byId.get(current.parentId);
  }
  return false;
}

function getFileNodePath(nodes: FileNode[], node: FileNode) {
  const byId = new Map(nodes.map((entry) => [entry.id, entry]));
  const parts = [node.name];
  let current = node.parentId ? byId.get(node.parentId) : undefined;
  while (current) {
    parts.unshift(current.name);
    current = current.parentId ? byId.get(current.parentId) : undefined;
  }
  return parts.join(" / ");
}

function buildMoveTargetOptions(nodes: FileNode[], movingNodeId?: string) {
  const directories = nodes
    .filter((node) => node.type === "directory")
    .filter((node) => {
      if (!movingNodeId) return true;
      if (node.id === movingNodeId) return false;
      return !isDescendantFileNode(nodes, node.id, movingNodeId);
    })
    .map((node) => ({ value: node.id, label: getFileNodePath(nodes, node) }))
    .sort((a, b) => a.label.localeCompare(b.label));

  return [{ value: ROOT_PARENT_VALUE, label: "Files" }, ...directories];
}

function buildSourceDocumentMoveTargetOptions() {
  return FOLDER_CONFIG.map((folder) => ({
    value: folder.documentType,
    label: folder.label,
  }));
}

function getMutableItemId(item: TreeItem) {
  if (item.fileNode) return `fn:${item.fileNode.id}`;
  if (item.sourceDocument) return `doc:${item.sourceDocument.id}`;
  return null;
}

function findMutableTreeItem(items: TreeItem[], mutableId: string): TreeItem | null {
  for (const item of items) {
    if (getMutableItemId(item) === mutableId) return item;
    const found = findMutableTreeItem(item.children, mutableId);
    if (found) return found;
  }
  return null;
}

function renameSourceDocumentPath(document: SourceDocument, nextName: string) {
  const cleanName = nextName.replace(/[\\/]/g, "-").trim();
  const segments = splitSourceDocumentPath(document.fileName);
  if (segments.length === 0) return cleanName;
  segments[segments.length - 1] = cleanName;
  return segments.join("/");
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

        const pdfjs = await loadPdfJs();

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

/* ─── Empty Preview State ─── */

function EmptyPreviewState() {
  return (
    <div className="relative flex flex-1 items-center justify-center overflow-hidden bg-panel/90 px-6">
      <motion.div
        aria-hidden
        className="absolute inset-0 opacity-20 [background-image:linear-gradient(hsl(var(--fg)/0.07)_1px,transparent_1px),linear-gradient(90deg,hsl(var(--fg)/0.05)_1px,transparent_1px)] [background-size:32px_32px]"
        animate={{ backgroundPosition: ["0px 0px", "60px 60px"] }}
        transition={{ duration: 24, repeat: Infinity, ease: "linear" }}
      />
      <motion.div
        aria-hidden
        className="absolute inset-x-0 top-[18%] h-px bg-[linear-gradient(90deg,transparent,hsl(var(--accent)),hsl(169_62%_44%),transparent)]"
        animate={{ top: ["22%", "72%", "22%"], opacity: [0.05, 0.18, 0.05] }}
        transition={{ duration: 8.5, repeat: Infinity, ease: "easeInOut" }}
      />
      <motion.div
        initial={{ opacity: 0, y: 14, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.25, ease: "easeOut" }}
        className="relative z-10 flex flex-col items-center text-center"
      >
        <div className="flex flex-col items-center gap-3">
          <div className="flex items-center gap-3">
            <BidwrightMark className="h-12 w-12" />
            <span className="text-3xl font-semibold tracking-normal text-fg sm:text-4xl">Bidwright</span>
          </div>
          <div className="flex flex-col items-center gap-1.5">
            <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-fg/30">Construction estimating</p>
            <p className="text-sm font-medium text-fg/50">Click a file to view.</p>
          </div>
        </div>
      </motion.div>
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
  onOpenContextMenu,
  renamingId,
  renameValue,
  onRenameValueChange,
  onCommitRename,
  onCancelRename,
  onMoveNode,
  canMoveNode,
  onUploadFiles,
  draggingNodeId,
  setDraggingNodeId,
  dropTargetId,
  setDropTargetId,
}: {
  item: TreeItem;
  depth: number;
  expandedSet: Set<string>;
  toggleExpand: (id: string) => void;
  selectedId: string | null;
  onSelect: (item: TreeItem) => void;
  onOpenContextMenu: (item: TreeItem, position: { x: number; y: number }) => void;
  renamingId: string | null;
  renameValue: string;
  onRenameValueChange: (value: string) => void;
  onCommitRename: () => void;
  onCancelRename: () => void;
  onMoveNode: (nodeId: string, parentId: string | null) => void;
  canMoveNode: (nodeId: string, parentId: string | null) => boolean;
  onUploadFiles: (files: FileList | File[], parentId?: string | null, documentType?: string) => void;
  draggingNodeId: string | null;
  setDraggingNodeId: (nodeId: string | null) => void;
  dropTargetId: string | null;
  setDropTargetId: (nodeId: string | null) => void;
}) {
  const isExpanded = expandedSet.has(item.id);
  const isSelected = selectedId === item.id;
  const itemMutableId = getMutableItemId(item);
  const isRenaming = Boolean(itemMutableId && itemMutableId === renamingId);
  const isDropTarget = (item.fileNode?.id ?? item.id) === dropTargetId && item.type === "directory";
  const isDragging = item.fileNode?.id === draggingNodeId;
  const skipBlurRenameRef = useRef(false);
  const ext = getFileExtension(item.name);
  const isImage = IMAGE_EXTENSIONS.has(ext);
  const isPdf = PDF_EXTENSIONS.has(ext);

  const openContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    onSelect(item);
    onOpenContextMenu(item, { x: e.clientX, y: e.clientY });
  };

  const openButtonMenu = (e: React.MouseEvent<HTMLButtonElement>) => {
    e.preventDefault();
    e.stopPropagation();
    const rect = e.currentTarget.getBoundingClientRect();
    onSelect(item);
    onOpenContextMenu(item, { x: rect.right - 4, y: rect.bottom + 4 });
  };

  const handleDragStart = (e: React.DragEvent) => {
    if (!item.fileNode) return;
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData(FILE_NODE_DND_TYPE, item.fileNode.id);
    e.dataTransfer.setData("text/plain", item.name);
    setDraggingNodeId(item.fileNode.id);
  };

  const handleDragEnd = () => {
    setDraggingNodeId(null);
    setDropTargetId(null);
  };

  const handleDirectoryDragOver = (e: React.DragEvent) => {
    if (item.type !== "directory" || (!item.fileNode && !item.isAutoFolder)) return;
    if (isInternalFileNodeDrag(e)) {
      const draggedId = e.dataTransfer.getData(FILE_NODE_DND_TYPE) || draggingNodeId;
      if (draggedId && item.fileNode && canMoveNode(draggedId, item.fileNode.id)) {
        e.preventDefault();
        e.stopPropagation();
        e.dataTransfer.dropEffect = "move";
        setDropTargetId(item.fileNode.id);
      }
      return;
    }
    if (Array.from(e.dataTransfer.types).includes("Files")) {
      e.preventDefault();
      e.stopPropagation();
      e.dataTransfer.dropEffect = "copy";
      setDropTargetId(item.fileNode?.id ?? item.id);
    }
  };

  const handleDirectoryDrop = (e: React.DragEvent) => {
    if (item.type !== "directory" || (!item.fileNode && !item.isAutoFolder)) return;
    if (isInternalFileNodeDrag(e)) {
      const draggedId = e.dataTransfer.getData(FILE_NODE_DND_TYPE) || draggingNodeId;
      if (draggedId && item.fileNode) {
        e.preventDefault();
        e.stopPropagation();
        onMoveNode(draggedId, item.fileNode.id);
      }
      setDropTargetId(null);
      return;
    }
    if (e.dataTransfer.files.length > 0) {
      e.preventDefault();
      e.stopPropagation();
      onUploadFiles(e.dataTransfer.files, item.fileNode?.id, item.documentType);
      setDropTargetId(null);
    }
  };

  const fileIcon = isPdf ? (
    <FileText className="h-3.5 w-3.5 shrink-0 text-danger/70" />
  ) : isImage ? (
    <ImageIcon className="h-3.5 w-3.5 shrink-0 text-success/70" />
  ) : item.sourceDocument ? (
    <FileText className="h-3.5 w-3.5 shrink-0" />
  ) : (
    <File className="h-3.5 w-3.5 shrink-0" />
  );

  if (item.type === "directory") {
    return (
      <div>
        <div
          className={cn(
            "group flex items-center gap-1 rounded-md px-2 py-1.5 text-xs transition-colors cursor-pointer",
            isSelected
              ? "bg-accent/10 text-accent"
              : "text-fg/70 hover:bg-panel2/60 hover:text-fg",
            isDropTarget && "bg-accent/10 ring-1 ring-accent/40",
            isDragging && "opacity-40"
          )}
          style={{ paddingLeft: `${depth * 12 + 8}px` }}
          onClick={() => {
            toggleExpand(item.id);
            onSelect(item);
          }}
          onContextMenu={openContextMenu}
          draggable={Boolean(item.fileNode)}
          onDragStart={handleDragStart}
          onDragEnd={handleDragEnd}
          onDragOver={handleDirectoryDragOver}
          onDragLeave={() => {
            if (dropTargetId === (item.fileNode?.id ?? item.id)) setDropTargetId(null);
          }}
          onDrop={handleDirectoryDrop}
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
          {isRenaming ? (
            <input
              className="h-6 min-w-0 flex-1 rounded-md border border-accent/40 bg-bg px-2 text-xs font-medium text-fg outline-none"
              value={renameValue}
              onChange={(e) => onRenameValueChange(e.target.value)}
              onClick={(e) => e.stopPropagation()}
              onKeyDown={(e) => {
                if (e.key === "Enter") onCommitRename();
                if (e.key === "Escape") {
                  skipBlurRenameRef.current = true;
                  onCancelRename();
                }
              }}
              onBlur={() => {
                if (skipBlurRenameRef.current) {
                  skipBlurRenameRef.current = false;
                  return;
                }
                onCommitRename();
              }}
              autoFocus
            />
          ) : (
            <span className="flex-1 truncate font-medium">{item.name}</span>
          )}
          <span className="text-[10px] text-fg/30">{item.children.length}</span>

          <button
            type="button"
            title="File actions"
            onClick={openButtonMenu}
            className="rounded p-0.5 text-fg/30 opacity-0 transition-opacity hover:bg-panel2 hover:text-fg/70 group-hover:opacity-100 focus:opacity-100"
          >
            <MoreHorizontal className="h-3.5 w-3.5" />
          </button>
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
                      onOpenContextMenu={onOpenContextMenu}
                      renamingId={renamingId}
                      renameValue={renameValue}
                      onRenameValueChange={onRenameValueChange}
                      onCommitRename={onCommitRename}
                      onCancelRename={onCancelRename}
                      onMoveNode={onMoveNode}
                      canMoveNode={canMoveNode}
                      onUploadFiles={onUploadFiles}
                      draggingNodeId={draggingNodeId}
                      setDraggingNodeId={setDraggingNodeId}
                      dropTargetId={dropTargetId}
                      setDropTargetId={setDropTargetId}
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

  return (
    <div
      className={cn(
        "group flex items-center gap-2 rounded-md px-2 py-1.5 text-xs transition-colors cursor-pointer",
        isSelected
          ? "bg-accent/10 text-accent"
          : "text-fg/60 hover:bg-panel2/60 hover:text-fg",
        isDragging && "opacity-40"
      )}
      style={{ paddingLeft: `${depth * 12 + 8}px` }}
      onClick={() => onSelect(item)}
      onContextMenu={openContextMenu}
      draggable={Boolean(item.fileNode)}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      {...(item.sourceDocument ? { "data-document-id": item.sourceDocument.id } : {})}
    >
      {fileIcon}
      {isRenaming ? (
        <input
          className="h-6 min-w-0 flex-1 rounded-md border border-accent/40 bg-bg px-2 text-xs text-fg outline-none"
          value={renameValue}
          onChange={(e) => onRenameValueChange(e.target.value)}
          onClick={(e) => e.stopPropagation()}
          onKeyDown={(e) => {
            if (e.key === "Enter") onCommitRename();
            if (e.key === "Escape") {
              skipBlurRenameRef.current = true;
              onCancelRename();
            }
          }}
          onBlur={() => {
            if (skipBlurRenameRef.current) {
              skipBlurRenameRef.current = false;
              return;
            }
            onCommitRename();
          }}
          autoFocus
        />
      ) : (
        <span className="flex-1 truncate">{item.name}</span>
      )}
      {item.pageCount != null && item.pageCount > 0 && (
        <span className="shrink-0 text-[10px] text-fg/30">
          {item.pageCount}p
        </span>
      )}
      <button
        type="button"
        title="File actions"
        onClick={openButtonMenu}
        className="rounded p-0.5 text-fg/30 opacity-0 transition-opacity hover:bg-panel2 hover:text-fg/70 group-hover:opacity-100 focus:opacity-100"
      >
        <MoreHorizontal className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

type FileContextAction = "open" | "open-takeoff" | "new-folder" | "upload" | "rename" | "move" | "delete";

function FileTreeContextMenu({
  menu,
  projectId,
  canOpenInTakeoff,
  onClose,
  onAction,
}: {
  menu: { item: TreeItem; x: number; y: number } | null;
  projectId: string;
  canOpenInTakeoff?: boolean;
  onClose: () => void;
  onAction: (action: FileContextAction, item: TreeItem) => void;
}) {
  const menuRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<{ left: number; top: number } | null>(null);

  useLayoutEffect(() => {
    if (!menu) {
      setPosition(null);
      return;
    }
    const element = menuRef.current;
    if (!element) return;
    const rect = element.getBoundingClientRect();
    const gutter = 8;
    const left = Math.max(gutter, Math.min(menu.x, window.innerWidth - rect.width - gutter));
    const opensUp = menu.y + rect.height > window.innerHeight - gutter;
    const top = Math.max(gutter, opensUp ? menu.y - rect.height : menu.y);
    setPosition({ left, top });
  }, [menu]);

  useEffect(() => {
    if (!menu) return;
    const close = () => onClose();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("pointerdown", close);
    window.addEventListener("scroll", close, true);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointerdown", close);
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("keydown", onKey);
    };
  }, [menu, onClose]);

  if (!menu) return null;

  const { item } = menu;
  const canModify = Boolean(item.fileNode || item.sourceDocument);
  const canUploadInside = item.type === "directory" && Boolean(item.fileNode || item.isAutoFolder);
  const canCreateInside = item.type === "directory" && Boolean(item.fileNode);
  const downloadUrl = item.type === "file" ? getDownloadUrl(item, projectId, false) : null;
  const takeoffDocumentId = canOpenInTakeoff ? getTakeoffDocumentIdForItem(item) : null;
  const menuItemClass =
    "flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-xs text-fg/70 outline-none transition-colors hover:bg-panel2 hover:text-fg";

  const button = (action: FileContextAction, label: string, icon: React.ReactNode, className?: string) => (
    <button
      type="button"
      className={cn(menuItemClass, className)}
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => {
        e.stopPropagation();
        onAction(action, item);
      }}
    >
      {icon}
      <span className="flex-1">{label}</span>
    </button>
  );

  return createPortal(
    <div
      ref={menuRef}
      className="fixed z-[250] min-w-[190px] rounded-lg border border-line bg-panel p-1 shadow-xl"
      style={{
        left: position?.left ?? menu.x,
        top: position?.top ?? menu.y,
        visibility: position ? "visible" : "hidden",
      }}
      onPointerDown={(e) => e.stopPropagation()}
    >
      {button("open", item.type === "directory" ? "Open Folder" : "Open", <Eye className="h-3.5 w-3.5" />)}
      {takeoffDocumentId && button("open-takeoff", "Open in Takeoff", <Ruler className="h-3.5 w-3.5" />)}
      {downloadUrl && (
        <a
          href={downloadUrl}
          download
          className={menuItemClass}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={onClose}
        >
          <Download className="h-3.5 w-3.5" />
          <span className="flex-1">Download</span>
        </a>
      )}
      {canUploadInside && (
        <>
          <div className="my-1 h-px bg-line" />
          {canCreateInside && button("new-folder", "New Folder Here", <FolderPlus className="h-3.5 w-3.5" />)}
          {button("upload", "Upload Here", <Upload className="h-3.5 w-3.5" />)}
        </>
      )}
      {canModify && (
        <>
          <div className="my-1 h-px bg-line" />
          {button("rename", "Rename", <Edit3 className="h-3.5 w-3.5" />)}
          {button("move", "Move To...", <ArrowRight className="h-3.5 w-3.5" />)}
          {button("delete", "Delete", <Trash2 className="h-3.5 w-3.5" />, "text-danger hover:text-danger")}
        </>
      )}
    </div>,
    document.body
  );
}

function MoveFileModal({
  item,
  nodes,
  targetId,
  onTargetChange,
  onClose,
  onConfirm,
}: {
  item: TreeItem | null;
  nodes: FileNode[];
  targetId: string;
  onTargetChange: (targetId: string) => void;
  onClose: () => void;
  onConfirm: () => void;
}) {
  const fileNode = item?.fileNode;
  const sourceDocument = item?.sourceDocument;
  const options = useMemo(() => {
    if (sourceDocument) return buildSourceDocumentMoveTargetOptions();
    return buildMoveTargetOptions(nodes, fileNode?.id);
  }, [fileNode?.id, nodes, sourceDocument]);
  const nextParentId = targetId === ROOT_PARENT_VALUE ? null : targetId;
  const currentParentId = fileNode?.parentId ?? null;
  const isSameLocation = fileNode
    ? nextParentId === currentParentId
    : sourceDocument
      ? targetId === sourceDocument.documentType
      : true;

  return (
    <ModalBackdrop open={Boolean(item && (fileNode || sourceDocument))} onClose={onClose} size="sm">
      <Card>
        <CardHeader>
          <CardTitle>Move File</CardTitle>
          <p className="mt-1 text-xs text-fg/50">
            Choose a destination for <span className="font-medium text-fg/70">{item?.name}</span>.
          </p>
        </CardHeader>
        <CardBody className="space-y-4">
          <div className="space-y-1.5">
            <Label>Destination</Label>
            <Select value={targetId} onValueChange={onTargetChange} options={options} />
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={onClose}>Cancel</Button>
            <Button variant="accent" size="sm" onClick={onConfirm} disabled={isSameLocation}>
              Move
            </Button>
          </div>
        </CardBody>
      </Card>
    </ModalBackdrop>
  );
}

function DeleteFileModal({
  item,
  onClose,
  onConfirm,
}: {
  item: TreeItem | null;
  onClose: () => void;
  onConfirm: () => void;
}) {
  const childCount = item?.type === "directory" ? item.children.length : 0;

  return (
    <ModalBackdrop open={Boolean(item?.fileNode || item?.sourceDocument)} onClose={onClose} size="sm">
      <Card>
        <CardHeader>
          <CardTitle>Delete {item?.type === "directory" ? "Folder" : "File"}</CardTitle>
          <p className="mt-1 text-xs text-fg/50">
            This will permanently delete <span className="font-medium text-fg/70">{item?.name}</span>
            {childCount > 0 ? ` and ${childCount} nested item${childCount === 1 ? "" : "s"}` : ""}.
          </p>
        </CardHeader>
        <CardBody className="flex justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={onClose}>Cancel</Button>
          <Button variant="danger" size="sm" onClick={onConfirm}>Delete</Button>
        </CardBody>
      </Card>
    </ModalBackdrop>
  );
}

/* ─── Main Component ─── */

export function FileBrowser({ workspace, packages, selectedWorksheet, modelEditorChannelName, onOpenInTakeoff }: FileBrowserProps) {
  const projectId = workspace.project.id;
  const fileInputRef = useRef<HTMLInputElement>(null);
  const pendingUploadParentIdRef = useRef<string | null | undefined>(undefined);
  const pendingUploadDocumentTypeRef = useRef<string | undefined>(undefined);
  const [searchQuery, setSearchQuery] = useState("");
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(
    new Set(["auto-specs", "auto-drawings"])
  );
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editorMode, setEditorMode] = useState<EditorMode>("none");
  const [editorFileName, setEditorFileName] = useState("");
  const [modelEditorFileNodeId, setModelEditorFileNodeId] = useState<string | null>(null);
  const [userNodes, setUserNodes] = useState<FileNode[]>([]);
  const [sourceDocuments, setSourceDocuments] = useState<SourceDocument[]>(workspace.sourceDocuments ?? []);
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

  // Tree actions
  const [contextMenu, setContextMenu] = useState<{ item: TreeItem; x: number; y: number } | null>(null);
  const [movingItem, setMovingItem] = useState<TreeItem | null>(null);
  const [moveTargetId, setMoveTargetId] = useState(ROOT_PARENT_VALUE);
  const [deletingItem, setDeletingItem] = useState<TreeItem | null>(null);
  const [draggingNodeId, setDraggingNodeId] = useState<string | null>(null);
  const [dropTargetId, setDropTargetId] = useState<string | null>(null);

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

  useEffect(() => {
    setSourceDocuments(workspace.sourceDocuments ?? []);
  }, [workspace.sourceDocuments]);

  // Build tree
  const tree = useMemo(() => {
    const autoFolders = buildAutoFolders(sourceDocuments);
    const userTree = buildTreeFromNodes(userNodes);
    return [...autoFolders, ...userTree];
  }, [sourceDocuments, userNodes]);

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

  const activeFileParentId = useMemo(() => {
    if (!selectedItem?.fileNode) return null;
    return selectedItem.type === "directory"
      ? selectedItem.fileNode.id
      : selectedItem.fileNode.parentId ?? null;
  }, [selectedItem]);

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
    setEditorMode("none");
  }, []);

  // ── Upload handling ────────────────────────────────────────────────────

  const handleUploadFiles = useCallback(async (files: FileList | File[], parentOverride?: string | null, documentTypeOverride?: string) => {
    if (files.length === 0) return;
    setUploading(true);
    setErrorMessage(null);

    // Determine parent: if a directory is selected, upload into it
    const parentId = parentOverride !== undefined ? parentOverride : activeFileParentId;
    const shouldUploadAsFileNode = Boolean(parentId) || Boolean(selectedItem?.fileNode);
    const documentType = documentTypeOverride ?? selectedItem?.documentType ?? selectedItem?.sourceDocument?.documentType ?? "reference";

    try {
      for (const file of Array.from(files)) {
        if (shouldUploadAsFileNode) {
          const node = await uploadFile(projectId, file, parentId);
          setUserNodes((prev) => [...prev, node]);
        } else {
          const document = await uploadSourceDocument(projectId, file, { documentType });
          setSourceDocuments((prev) => [...prev, document]);
        }
      }
      // Expand parent if uploading into a folder
      if (parentId) {
        setExpandedFolders((prev) => new Set([...prev, parentId!]));
      } else {
        const folderKey = FOLDER_CONFIG.find((folder) => folder.documentType === documentType)?.key;
        if (folderKey) setExpandedFolders((prev) => new Set([...prev, `auto-${folderKey}`]));
      }
    } catch (err) {
      showError(`Upload failed: ${err instanceof Error ? err.message : "Unknown error"}`);
    } finally {
      setUploading(false);
    }
  }, [activeFileParentId, projectId, selectedItem?.documentType, selectedItem?.fileNode, selectedItem?.sourceDocument?.documentType, showError]);

  const openFilePickerForParent = useCallback((parentId?: string | null, documentType?: string) => {
    pendingUploadParentIdRef.current = parentId;
    pendingUploadDocumentTypeRef.current = documentType;
    fileInputRef.current?.click();
  }, []);

  const canMoveNode = useCallback((nodeId: string, parentId: string | null) => {
    const node = userNodes.find((entry) => entry.id === nodeId);
    if (!node) return false;
    if ((node.parentId ?? null) === parentId) return false;
    if (!parentId) return true;
    const parent = userNodes.find((entry) => entry.id === parentId);
    if (!parent || parent.type !== "directory") return false;
    if (node.type === "directory") {
      if (parentId === node.id) return false;
      if (isDescendantFileNode(userNodes, parentId, node.id)) return false;
    }
    return true;
  }, [userNodes]);

  const handleMoveNode = useCallback(async (nodeId: string, parentId: string | null) => {
    const node = userNodes.find((entry) => entry.id === nodeId);
    if (!node) return;
    if (!canMoveNode(nodeId, parentId)) {
      showError("That file cannot be moved to the selected folder.");
      return;
    }
    try {
      const updated = await updateFileNode(projectId, nodeId, { parentId });
      setUserNodes((prev) => prev.map((entry) => entry.id === nodeId ? updated : entry));
      if (parentId) {
        setExpandedFolders((prev) => new Set([...prev, parentId]));
      }
      setMovingItem(null);
    } catch (err) {
      showError(`Failed to move: ${err instanceof Error ? err.message : "Unknown error"}`);
    }
  }, [canMoveNode, projectId, showError, userNodes]);

  const handleMoveSourceDocument = useCallback(async (documentId: string, documentType: string) => {
    try {
      const updated = await updateSourceDocument(projectId, documentId, { documentType });
      setSourceDocuments((prev) => prev.map((document) => document.id === updated.id ? updated : document));
      setMovingItem(null);
      setExpandedFolders((prev) => new Set([...prev, `auto-${FOLDER_CONFIG.find((folder) => folder.documentType === documentType)?.key ?? "other"}`]));
    } catch (err) {
      showError(`Failed to move: ${err instanceof Error ? err.message : "Unknown error"}`);
    }
  }, [projectId, showError]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    setDropTargetId(null);
    if (isInternalFileNodeDrag(e)) {
      const draggedId = e.dataTransfer.getData(FILE_NODE_DND_TYPE) || draggingNodeId;
      if (draggedId) void handleMoveNode(draggedId, null);
      return;
    }
    if (e.dataTransfer.files.length > 0) {
      handleUploadFiles(e.dataTransfer.files, null);
    }
  }, [draggingNodeId, handleMoveNode, handleUploadFiles]);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (isInternalFileNodeDrag(e)) {
      e.dataTransfer.dropEffect = "move";
      setDropTargetId(null);
      return;
    }
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
    if (!renamingId) return;
    const nextName = renameValue.trim();
    if (!nextName) {
      showError("File name cannot be empty.");
      return;
    }
    const item = findMutableTreeItem(tree, renamingId);
    if (!item) {
      setRenamingId(null);
      setRenameValue("");
      return;
    }
    if (item.name === nextName) {
      setRenamingId(null);
      setRenameValue("");
      return;
    }
    try {
      if (item.fileNode) {
        const updated = await updateFileNode(projectId, item.fileNode.id, {
          name: nextName,
        });
        setUserNodes((prev) =>
          prev.map((n) => (n.id === item.fileNode!.id ? updated : n))
        );
      } else if (item.sourceDocument) {
        const updated = await updateSourceDocument(projectId, item.sourceDocument.id, {
          fileName: renameSourceDocumentPath(item.sourceDocument, nextName),
        });
        setSourceDocuments((prev) => prev.map((document) => document.id === updated.id ? updated : document));
      }
      setRenamingId(null);
      setRenameValue("");
    } catch (err) {
      showError(`Failed to rename: ${err instanceof Error ? err.message : "Unknown error"}`);
    }
  }, [projectId, renamingId, renameValue, showError, tree]);

  const handleDelete = useCallback(async (item: TreeItem) => {
    if (!item.fileNode && !item.sourceDocument) return;
    try {
      if (item.sourceDocument) {
        await deleteSourceDocument(projectId, item.sourceDocument.id);
        setSourceDocuments((prev) => prev.filter((document) => document.id !== item.sourceDocument!.id));
        if (selectedId === item.id) setSelectedId(null);
        setDeletingItem(null);
        return;
      }

      const fileNode = item.fileNode;
      if (!fileNode) return;

      await deleteFileNode(projectId, fileNode.id);
      const deletedIds = new Set<string>([fileNode.id]);
      let changed = true;
      while (changed) {
        changed = false;
        for (const n of userNodes) {
          if (n.parentId && deletedIds.has(n.parentId) && !deletedIds.has(n.id)) {
            deletedIds.add(n.id);
            changed = true;
          }
        }
      }
      setUserNodes((prev) => prev.filter((n) => !deletedIds.has(n.id)));
      if (selectedId && deletedIds.has(selectedId)) setSelectedId(null);
      if (modelEditorFileNodeId === fileNode.id) setModelEditorFileNodeId(null);
      setDeletingItem(null);
    } catch (err) {
      showError(`Failed to delete: ${err instanceof Error ? err.message : "Unknown error"}`);
    }
  }, [modelEditorFileNodeId, projectId, selectedId, showError, userNodes]);

  const handleCancelRename = useCallback(() => {
    setRenamingId(null);
    setRenameValue("");
  }, []);

  const handleOpenContextMenu = useCallback((item: TreeItem, position: { x: number; y: number }) => {
    setContextMenu({ item, ...position });
  }, []);

  const handleContextAction = useCallback((action: FileContextAction, item: TreeItem) => {
    setContextMenu(null);
    if (action === "open") {
      handleSelect(item);
      if (item.type === "directory") {
        setExpandedFolders((prev) => new Set([...prev, item.id]));
      }
    } else if (action === "open-takeoff") {
      const takeoffDocumentId = getTakeoffDocumentIdForItem(item);
      if (takeoffDocumentId) {
        onOpenInTakeoff?.(takeoffDocumentId);
      }
    } else if (action === "new-folder" && item.fileNode && item.type === "directory") {
      setCreatingFolder(true);
      setNewFolderParentId(item.fileNode.id);
      setExpandedFolders((prev) => new Set([...prev, item.fileNode!.id]));
    } else if (action === "upload" && item.type === "directory") {
      openFilePickerForParent(item.fileNode?.id, item.documentType);
    } else if (action === "rename") {
      const mutableId = getMutableItemId(item);
      if (!mutableId) return;
      setRenamingId(mutableId);
      setRenameValue(item.name);
      setSelectedId(item.id);
    } else if (action === "move" && (item.fileNode || item.sourceDocument)) {
      setMovingItem(item);
      setMoveTargetId(item.fileNode?.parentId ?? item.sourceDocument?.documentType ?? ROOT_PARENT_VALUE);
    } else if (action === "delete") {
      setDeletingItem(item);
    }
  }, [handleSelect, onOpenInTakeoff, openFilePickerForParent]);

  const handleConfirmMove = useCallback(() => {
    if (movingItem?.fileNode) {
      const parentId = moveTargetId === ROOT_PARENT_VALUE ? null : moveTargetId;
      void handleMoveNode(movingItem.fileNode.id, parentId);
      return;
    }
    if (movingItem?.sourceDocument) {
      void handleMoveSourceDocument(movingItem.sourceDocument.id, moveTargetId);
    }
  }, [handleMoveNode, handleMoveSourceDocument, moveTargetId, movingItem]);

  // ── Preview URL ────────────────────────────────────────────────────────

  const previewUrl = useMemo(() => {
    if (!selectedItem || selectedItem.type === "directory") return null;
    return getDownloadUrl(selectedItem, projectId, true);
  }, [selectedItem, projectId]);

  const downloadUrl = useMemo(() => {
    if (!selectedItem || selectedItem.type === "directory") return null;
    return getDownloadUrl(selectedItem, projectId, false);
  }, [selectedItem, projectId]);

  const ingestSourceRef = useMemo(() => getIngestSourceReference(selectedItem), [selectedItem]);
  const filePreviewType = selectedItem ? getFilePreviewType(selectedItem) : "none";
  const isEmbeddedModelEditorPreview =
    selectedItem?.type === "file" && filePreviewType === "cad" && isBidwrightEditableModel(selectedItem.name);
  const [modelAssets, setModelAssets] = useState<ModelAsset[]>([]);
  const selectedModelAsset = useMemo(
    () => findModelAssetForItem(modelAssets, selectedItem),
    [modelAssets, selectedItem],
  );
  const hasExtracted = selectedItem ? hasExtractedContent(selectedItem) : false;
  // Show tabs when there is extracted content (so user can toggle between file view and text)
  const showPreviewTabs = selectedItem?.type === "file" && (hasExtracted && filePreviewType !== "none" || hasExtracted);
  const [previewTab, setPreviewTab] = useState<"file" | "extracted">("file");

  useEffect(() => {
    if (editorMode === "model") return;
    const nativeModelNodeId =
      selectedItem?.fileNode && getFileExtension(selectedItem.fileNode.name) === "cd"
        ? selectedItem.fileNode.id
        : null;
    setModelEditorFileNodeId(nativeModelNodeId);
  }, [editorMode, selectedItem?.fileNode]);

  useEffect(() => {
    if (!isEmbeddedModelEditorPreview) return;
    let cancelled = false;
    async function loadModelAssets() {
      try {
        const listed = await listModelAssets(projectId);
        const assets = listed.assets ?? [];
        if (!cancelled) setModelAssets(assets);
      } catch {
        if (!cancelled) setModelAssets([]);
      }
    }
    void loadModelAssets();
    return () => {
      cancelled = true;
    };
  }, [isEmbeddedModelEditorPreview, projectId, selectedItem]);

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
      const editorUrl = buildModelEditorUrl(previewUrl, selectedItem?.name ?? "Model", 0, {
        projectId,
        modelAssetId: selectedModelAsset?.id,
        modelDocumentId: selectedItem?.sourceDocument?.id ?? selectedItem?.fileNode?.id ?? null,
        syncChannelName: modelEditorChannelName,
        estimateEnabled: Boolean(selectedWorksheet),
        estimateTargetWorksheetId: selectedWorksheet?.id,
        estimateTargetWorksheetName: selectedWorksheet?.name,
        estimateDefaultMarkup: workspace.currentRevision.defaultMarkup ?? 0.2,
        estimateQuoteLabel: workspace.quote?.quoteNumber ?? workspace.project.name,
      });
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
  }, [
    isEmbeddedModelEditorPreview,
    modelEditorChannelName,
    previewUrl,
    projectId,
    selectedItem?.fileNode?.id,
    selectedItem?.name,
    selectedItem?.sourceDocument?.id,
    selectedModelAsset?.id,
    selectedWorksheet,
    workspace.currentRevision.defaultMarkup,
    workspace.project.name,
    workspace.quote?.quoteNumber,
  ]);

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
      const node = await uploadFile(projectId, file, activeFileParentId);
      // Refresh tree
      const updatedNodes = await getFileTree(projectId);
      setUserNodes(updatedNodes);
      if (activeFileParentId) {
        setExpandedFolders((prev) => new Set([...prev, activeFileParentId]));
      }
      // Select the new file
      setSelectedId(node.id);
      setEditorMode("none");
    } catch (err) {
      showError(`Failed to save: ${err instanceof Error ? err.message : "Unknown error"}`);
    }
  }, [activeFileParentId, projectId, showError]);

  const handleCreateModelDocument = useCallback(async () => {
    try {
      const name = nextUntitledModelName(userNodes);
      const node = await createFileNode(projectId, {
        parentId: activeFileParentId,
        name,
        type: "file",
        fileType: "cd",
        size: 0,
        metadata: { kind: "bidwright-model", native: true },
      });
      setUserNodes((prev) => [...prev, node]);
      if (activeFileParentId) {
        setExpandedFolders((prev) => new Set([...prev, activeFileParentId]));
      }
      setSelectedId(node.id);
      setEditorFileName(node.name);
      setModelEditorFileNodeId(node.id);
      setEditorMode("model");
    } catch (err) {
      showError(`Failed to create model: ${err instanceof Error ? err.message : "Unknown error"}`);
    }
  }, [activeFileParentId, projectId, showError, userNodes]);

  const handleModelDocumentSave = useCallback(async (message: BidwrightModelDocumentSaveMessage) => {
    try {
      const selectedNativeNode = selectedItem?.fileNode && getFileExtension(selectedItem.fileNode.name) === "cd"
        ? selectedItem.fileNode
        : undefined;
      const localNativeNode = modelEditorFileNodeId
        ? userNodes.find((node) => node.id === modelEditorFileNodeId && getFileExtension(node.name) === "cd")
        : undefined;
      const messageNativeNode = message.modelDocumentId
        ? userNodes.find((node) => node.id === message.modelDocumentId && getFileExtension(node.name) === "cd")
        : undefined;
      const nativeNode = selectedNativeNode ?? localNativeNode ?? messageNativeNode;
      const fallbackName = editorFileName || message.fileName || message.documentName || selectedItem?.name || "Untitled Model";
      const fileName = ensureModelDocumentName(nativeNode?.name ?? fallbackName);
      const file = new globalThis.File(
        [JSON.stringify(message.serializedDocument)],
        fileName,
        { type: "application/json" },
      );

      const savedNode = nativeNode
        ? await saveFileNodeContent(projectId, nativeNode.id, file)
        : await uploadFile(projectId, file, selectedItem?.fileNode?.parentId ?? null);

      setUserNodes((prev) => {
        const exists = prev.some((node) => node.id === savedNode.id);
        return exists ? prev.map((node) => (node.id === savedNode.id ? savedNode : node)) : [...prev, savedNode];
      });
      setSelectedId(savedNode.id);
      setEditorFileName(savedNode.name);
      setModelEditorFileNodeId(savedNode.id);
    } catch (err) {
      showError(`Failed to save model: ${err instanceof Error ? err.message : "Unknown error"}`);
    }
  }, [editorFileName, modelEditorFileNodeId, projectId, selectedItem?.fileNode?.parentId, selectedItem?.name, showError, userNodes]);

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
      {editorMode === "model" && (
        <BidwrightModelEditor
          fileName={editorFileName}
          projectId={projectId}
          modelDocumentId={modelEditorFileNodeId}
          syncChannelName={modelEditorChannelName}
          estimateEnabled={Boolean(selectedWorksheet)}
          isolateSyncChannel={false}
          estimateTargetWorksheetId={selectedWorksheet?.id}
          estimateTargetWorksheetName={selectedWorksheet?.name}
          estimateDefaultMarkup={workspace.currentRevision.defaultMarkup ?? 0.2}
          estimateQuoteLabel={workspace.quote?.quoteNumber ?? workspace.project.name}
          onSaveDocument={handleModelDocumentSave}
        />
      )}
    </div>
  ) : !selectedItem ? (
    <EmptyPreviewState />
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
          {(selectedItem.fileNode || selectedItem.sourceDocument) && (
            <div className="flex gap-2 pt-2">
              <Button variant="secondary" size="xs" onClick={() => { const mutableId = getMutableItemId(selectedItem); if (mutableId) setRenamingId(mutableId); setRenameValue(selectedItem.name); }}><Edit3 className="h-3.5 w-3.5" /> Rename</Button>
              <Button variant="danger" size="xs" onClick={() => setDeletingItem(selectedItem)}><Trash2 className="h-3.5 w-3.5" /> Delete</Button>
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
            {filePreviewType === "text" && (
              <div className="flex min-h-0 flex-1 flex-col">
                {ingestSourceRef && isMarkupCandidate(selectedItem) && (
                  <BluebeamMarkupsViewer
                    key={`markups-${ingestSourceRef.sourceKind}-${ingestSourceRef.sourceId}`}
                    projectId={projectId}
                    sourceKind={ingestSourceRef.sourceKind}
                    sourceId={ingestSourceRef.sourceId}
                  />
                )}
                <TextPreview key={selectedItem.id} url={previewUrl} extractedText={!hasExtracted ? selectedItem.extractedText : undefined} />
              </div>
            )}
            {filePreviewType === "cad" && previewUrl && (
              <div className="flex-1 min-h-[400px]">
                {isBidwrightEditableModel(selectedItem.name) ? (
                  <BidwrightModelEditor
                    fileUrl={previewUrl}
                    fileName={selectedItem.name}
                    projectId={projectId}
                    modelAssetId={selectedModelAsset?.id}
                    modelDocumentId={selectedItem.sourceDocument?.id ?? selectedItem.fileNode?.id}
                    syncChannelName={modelEditorChannelName}
                    estimateEnabled={Boolean(selectedWorksheet)}
                    isolateSyncChannel={false}
                    estimateTargetWorksheetId={selectedWorksheet?.id}
                    estimateTargetWorksheetName={selectedWorksheet?.name}
                    estimateDefaultMarkup={workspace.currentRevision.defaultMarkup ?? 0.2}
                    estimateQuoteLabel={workspace.quote?.quoteNumber ?? workspace.project.name}
                    onSaveDocument={handleModelDocumentSave}
                  />
                ) : (
                  <CadViewer fileUrl={previewUrl} fileName={selectedItem.name} />
                )}
              </div>
            )}
            {filePreviewType === "docx" && previewUrl && <DocxViewer key={previewUrl} url={previewUrl} fileName={selectedItem.name} />}
            {filePreviewType === "xlsx" && previewUrl && (
              <div className="flex min-h-0 flex-1 flex-col">
                {ingestSourceRef && isMarkupCandidate(selectedItem) && (
                  <BluebeamMarkupsViewer
                    key={`markups-${ingestSourceRef.sourceKind}-${ingestSourceRef.sourceId}`}
                    projectId={projectId}
                    sourceKind={ingestSourceRef.sourceKind}
                    sourceId={ingestSourceRef.sourceId}
                  />
                )}
                <div className="min-h-0 flex-1">
                  <XlsxViewer key={previewUrl} url={previewUrl} fileName={selectedItem.name} />
                </div>
              </div>
            )}
            {filePreviewType === "email" && previewUrl && (
              <EmailViewer
                key={previewUrl}
                url={previewUrl}
                fileName={selectedItem.name}
                projectId={projectId}
                sourceKind={ingestSourceRef?.sourceKind}
                sourceId={ingestSourceRef?.sourceId}
              />
            )}
            {filePreviewType === "dxf" && previewUrl && <div className="flex-1 min-h-[400px]"><DxfViewer key={previewUrl} url={previewUrl} fileName={selectedItem.name} /></div>}
            {filePreviewType === "zip" && previewUrl && (
              <ZipViewer
                key={previewUrl}
                url={previewUrl}
                fileName={selectedItem.name}
                projectId={projectId}
                sourceKind={ingestSourceRef?.sourceKind}
                sourceId={ingestSourceRef?.sourceId}
              />
            )}
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
            <CardTitle>Project Files</CardTitle>
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
                        setNewFolderParentId(activeFileParentId);
                        if (activeFileParentId) {
                          setExpandedFolders((prev) => new Set([...prev, activeFileParentId]));
                        }
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
                        void handleCreateModelDocument();
                      }}
                    >
                      <Box className="h-3.5 w-3.5" />
                      3D Model
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
                      onSelect={() => openFilePickerForParent(activeFileParentId)}
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
                accept={FILE_UPLOAD_ACCEPT}
                className="hidden"
                onChange={(e) => {
                  const parentId = pendingUploadParentIdRef.current;
                  const documentType = pendingUploadDocumentTypeRef.current;
                  pendingUploadParentIdRef.current = undefined;
                  pendingUploadDocumentTypeRef.current = undefined;
                  if (e.target.files) handleUploadFiles(e.target.files, parentId, documentType);
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
                No files yet. Upload files or drag and drop.
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
                  onOpenContextMenu={handleOpenContextMenu}
                  renamingId={renamingId}
                  renameValue={renameValue}
                  onRenameValueChange={setRenameValue}
                  onCommitRename={handleRename}
                  onCancelRename={handleCancelRename}
                  onMoveNode={(nodeId, parentId) => void handleMoveNode(nodeId, parentId)}
                  canMoveNode={canMoveNode}
                  onUploadFiles={(files, parentId, documentType) => void handleUploadFiles(files, parentId, documentType)}
                  draggingNodeId={draggingNodeId}
                  setDraggingNodeId={setDraggingNodeId}
                  dropTargetId={dropTargetId}
                  setDropTargetId={setDropTargetId}
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
                  {(selectedItem.fileNode || selectedItem.sourceDocument) && (
                    <>
                      <Button variant="secondary" size="xs" onClick={() => { const mutableId = getMutableItemId(selectedItem); if (mutableId) setRenamingId(mutableId); setRenameValue(selectedItem.name); }}><Edit3 className="h-3.5 w-3.5" /></Button>
                      <Button variant="danger" size="xs" onClick={() => setDeletingItem(selectedItem)}><Trash2 className="h-3.5 w-3.5" /></Button>
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

      <FileTreeContextMenu
        menu={contextMenu}
        projectId={projectId}
        canOpenInTakeoff={Boolean(onOpenInTakeoff)}
        onClose={() => setContextMenu(null)}
        onAction={handleContextAction}
      />

      <MoveFileModal
        item={movingItem}
        nodes={userNodes}
        targetId={moveTargetId}
        onTargetChange={setMoveTargetId}
        onClose={() => setMovingItem(null)}
        onConfirm={handleConfirmMove}
      />

      <DeleteFileModal
        item={deletingItem}
        onClose={() => setDeletingItem(null)}
        onConfirm={() => {
          if (deletingItem) void handleDelete(deletingItem);
        }}
      />
    </div>
  );
}
