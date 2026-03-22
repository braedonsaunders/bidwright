"use client";

import { useMemo, useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  File,
  FileText,
  Folder,
  FolderOpen,
  Search,
  Upload,
} from "lucide-react";
import type {
  PackageRecord,
  ProjectWorkspaceData,
  SourceDocument,
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

/* ─── Types ─── */

interface VirtualFolder {
  key: string;
  label: string;
  documentType: string;
  documents: SourceDocument[];
}

export interface FileBrowserProps {
  workspace: ProjectWorkspaceData;
  packages: PackageRecord[];
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

function formatDate(iso: string) {
  const d = new Date(iso);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function truncateText(text: string, maxLength: number) {
  if (!text) return "";
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength) + "...";
}

/* ─── Component ─── */

export function FileBrowser({ workspace, packages }: FileBrowserProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set(["specs", "drawings"]));
  const [selectedDocId, setSelectedDocId] = useState<string | null>(null);

  // Organize documents into virtual folders
  const folders = useMemo<VirtualFolder[]>(() => {
    const docs = workspace.sourceDocuments ?? [];
    return FOLDER_CONFIG.map((cfg) => ({
      key: cfg.key,
      label: cfg.label,
      documentType: cfg.documentType,
      documents: docs.filter((d) => d.documentType === cfg.documentType),
    }));
  }, [workspace.sourceDocuments]);

  // Unclassified documents that don't match any folder
  const uncategorized = useMemo(() => {
    const knownTypes = new Set(FOLDER_CONFIG.map((c) => c.documentType));
    return (workspace.sourceDocuments ?? []).filter((d) => !knownTypes.has(d.documentType));
  }, [workspace.sourceDocuments]);

  // Filter by search query
  const filteredFolders = useMemo(() => {
    if (!searchQuery.trim()) return folders;
    const q = searchQuery.toLowerCase();
    return folders.map((f) => ({
      ...f,
      documents: f.documents.filter((d) => d.fileName.toLowerCase().includes(q)),
    }));
  }, [folders, searchQuery]);

  const filteredUncategorized = useMemo(() => {
    if (!searchQuery.trim()) return uncategorized;
    const q = searchQuery.toLowerCase();
    return uncategorized.filter((d) => d.fileName.toLowerCase().includes(q));
  }, [uncategorized, searchQuery]);

  const selectedDoc = useMemo(
    () => (workspace.sourceDocuments ?? []).find((d) => d.id === selectedDocId) ?? null,
    [workspace.sourceDocuments, selectedDocId]
  );

  function toggleFolder(key: string) {
    setExpandedFolders((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  return (
    <div className="flex h-full gap-4">
      {/* ─── Left Panel: File Tree ─── */}
      <div className="flex w-[60%] flex-col">
        <Card className="flex flex-1 flex-col overflow-hidden">
          <CardHeader className="flex flex-row items-center justify-between gap-3">
            <CardTitle>Project Documents</CardTitle>
            <Button variant="secondary" size="xs">
              <Upload className="h-3.5 w-3.5" />
              Upload
            </Button>
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

          {/* Tree */}
          <div className="flex-1 overflow-y-auto px-2 py-2">
            {filteredFolders.map((folder) => (
              <div key={folder.key}>
                {/* Folder row */}
                <button
                  type="button"
                  onClick={() => toggleFolder(folder.key)}
                  className="flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-left text-xs font-medium text-fg/70 hover:bg-panel2/60 hover:text-fg"
                >
                  {expandedFolders.has(folder.key) ? (
                    <ChevronDown className="h-3.5 w-3.5 shrink-0 text-fg/40" />
                  ) : (
                    <ChevronRight className="h-3.5 w-3.5 shrink-0 text-fg/40" />
                  )}
                  {expandedFolders.has(folder.key) ? (
                    <FolderOpen className="h-3.5 w-3.5 shrink-0 text-accent" />
                  ) : (
                    <Folder className="h-3.5 w-3.5 shrink-0 text-accent" />
                  )}
                  <span className="flex-1">{folder.label}</span>
                  <span className="text-[10px] text-fg/30">{folder.documents.length}</span>
                </button>

                {/* Expanded files */}
                {expandedFolders.has(folder.key) && (
                  <div className="ml-3 border-l border-line/50 pl-2">
                    {folder.documents.length === 0 ? (
                      <p className="px-2 py-1.5 text-[11px] text-fg/30 italic">No files</p>
                    ) : (
                      folder.documents.map((doc) => (
                        <button
                          type="button"
                          key={doc.id}
                          onClick={() => setSelectedDocId(doc.id)}
                          className={cn(
                            "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs transition-colors",
                            selectedDocId === doc.id
                              ? "bg-accent/10 text-accent"
                              : "text-fg/60 hover:bg-panel2/60 hover:text-fg"
                          )}
                        >
                          <FileText className="h-3.5 w-3.5 shrink-0" />
                          <span className="flex-1 truncate">{doc.fileName}</span>
                          <span className="shrink-0 text-[10px] text-fg/30">
                            {doc.pageCount}p
                          </span>
                        </button>
                      ))
                    )}
                  </div>
                )}
              </div>
            ))}

            {/* Uncategorized */}
            {filteredUncategorized.length > 0 && (
              <div>
                <button
                  type="button"
                  onClick={() => toggleFolder("_uncategorized")}
                  className="flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-left text-xs font-medium text-fg/70 hover:bg-panel2/60 hover:text-fg"
                >
                  {expandedFolders.has("_uncategorized") ? (
                    <ChevronDown className="h-3.5 w-3.5 shrink-0 text-fg/40" />
                  ) : (
                    <ChevronRight className="h-3.5 w-3.5 shrink-0 text-fg/40" />
                  )}
                  <Folder className="h-3.5 w-3.5 shrink-0 text-fg/40" />
                  <span className="flex-1">Other</span>
                  <span className="text-[10px] text-fg/30">{filteredUncategorized.length}</span>
                </button>
                {expandedFolders.has("_uncategorized") && (
                  <div className="ml-3 border-l border-line/50 pl-2">
                    {filteredUncategorized.map((doc) => (
                      <button
                        type="button"
                        key={doc.id}
                        onClick={() => setSelectedDocId(doc.id)}
                        className={cn(
                          "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs transition-colors",
                          selectedDocId === doc.id
                            ? "bg-accent/10 text-accent"
                            : "text-fg/60 hover:bg-panel2/60 hover:text-fg"
                        )}
                      >
                        <File className="h-3.5 w-3.5 shrink-0" />
                        <span className="flex-1 truncate">{doc.fileName}</span>
                        <span className="shrink-0 text-[10px] text-fg/30">
                          {doc.pageCount}p
                        </span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}

            {(workspace.sourceDocuments ?? []).length === 0 && (
              <EmptyState className="mt-4">
                No documents uploaded yet.
              </EmptyState>
            )}
          </div>
        </Card>
      </div>

      {/* ─── Right Panel: File Details ─── */}
      <div className="w-[40%]">
        <Card className="flex h-full flex-col overflow-hidden">
          <CardHeader>
            <CardTitle>
              {selectedDoc ? "File Details" : "Select a File"}
            </CardTitle>
          </CardHeader>

          <CardBody className="flex-1 overflow-y-auto">
            {!selectedDoc ? (
              <EmptyState>
                Click a file in the tree to view its details.
              </EmptyState>
            ) : (
              <div className="space-y-4">
                {/* File name */}
                <div>
                  <p className="text-[11px] font-medium text-fg/40 uppercase tracking-wider">Name</p>
                  <p className="mt-1 text-sm font-medium text-fg break-all">{selectedDoc.fileName}</p>
                </div>

                {/* Type & pages row */}
                <div className="flex items-center gap-3">
                  <div className="flex-1">
                    <p className="text-[11px] font-medium text-fg/40 uppercase tracking-wider">Type</p>
                    <div className="mt-1">
                      <Badge tone={TYPE_BADGE_TONE[selectedDoc.documentType] ?? "default"}>
                        {selectedDoc.documentType}
                      </Badge>
                    </div>
                  </div>
                  <div>
                    <p className="text-[11px] font-medium text-fg/40 uppercase tracking-wider">Pages</p>
                    <p className="mt-1 text-sm text-fg">{selectedDoc.pageCount}</p>
                  </div>
                </div>

                {/* File type */}
                <div>
                  <p className="text-[11px] font-medium text-fg/40 uppercase tracking-wider">File Type</p>
                  <p className="mt-1 text-sm text-fg/70">{selectedDoc.fileType}</p>
                </div>

                {/* Upload date */}
                <div>
                  <p className="text-[11px] font-medium text-fg/40 uppercase tracking-wider">Uploaded</p>
                  <p className="mt-1 text-sm text-fg/70">{formatDate(selectedDoc.createdAt)}</p>
                </div>

                {/* Extracted text preview */}
                {selectedDoc.extractedText && (
                  <div>
                    <p className="text-[11px] font-medium text-fg/40 uppercase tracking-wider">Extracted Text Preview</p>
                    <div className="mt-1 max-h-48 overflow-y-auto rounded-md border border-line bg-bg/50 p-2.5 text-xs text-fg/60 leading-relaxed">
                      {truncateText(selectedDoc.extractedText, 1200)}
                    </div>
                  </div>
                )}

                {/* Checksum */}
                <div>
                  <p className="text-[11px] font-medium text-fg/40 uppercase tracking-wider">Checksum</p>
                  <p className="mt-1 truncate text-[11px] font-mono text-fg/30">{selectedDoc.checksum}</p>
                </div>
              </div>
            )}
          </CardBody>
        </Card>
      </div>
    </div>
  );
}
