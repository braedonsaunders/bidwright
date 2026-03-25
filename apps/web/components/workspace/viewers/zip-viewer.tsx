"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Loader2,
  AlertTriangle,
  Folder,
  FolderOpen,
  FileText,
  ChevronRight,
  ChevronDown,
  Download,
  Eye,
  Archive,
} from "lucide-react";
import { Button } from "@/components/ui";
import { cn } from "@/lib/utils";

interface ZipViewerProps {
  url: string;
  fileName: string;
}

interface TreeNode {
  name: string;
  path: string;
  isDir: boolean;
  size: number;
  children: TreeNode[];
  data?: Uint8Array;
}

function formatFileSize(bytes: number): string {
  if (bytes === 0) return "0 B";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function buildTree(files: Record<string, Uint8Array>): TreeNode[] {
  const root: TreeNode[] = [];
  const nodeMap = new Map<string, TreeNode>();

  function ensureDir(pathParts: string[]): TreeNode {
    const key = pathParts.join("/");
    if (nodeMap.has(key)) return nodeMap.get(key)!;

    const node: TreeNode = {
      name: pathParts[pathParts.length - 1],
      path: key,
      isDir: true,
      size: 0,
      children: [],
    };
    nodeMap.set(key, node);

    if (pathParts.length === 1) {
      root.push(node);
    } else {
      const parent = ensureDir(pathParts.slice(0, -1));
      parent.children.push(node);
    }

    return node;
  }

  const sortedPaths = Object.keys(files).sort();

  for (const path of sortedPaths) {
    const parts = path.split("/").filter(Boolean);
    if (parts.length === 0) continue;

    // Skip directory entries (empty data, path ends with /)
    if (path.endsWith("/")) {
      ensureDir(parts);
      continue;
    }

    const fileNode: TreeNode = {
      name: parts[parts.length - 1],
      path,
      isDir: false,
      size: files[path].byteLength,
      children: [],
      data: files[path],
    };

    if (parts.length === 1) {
      root.push(fileNode);
    } else {
      const parent = ensureDir(parts.slice(0, -1));
      parent.children.push(fileNode);
    }
  }

  // Sort: directories first, then alphabetically
  function sortNodes(nodes: TreeNode[]) {
    nodes.sort((a, b) => {
      if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
    for (const n of nodes) {
      if (n.isDir) sortNodes(n.children);
    }
  }
  sortNodes(root);

  return root;
}

function TreeItem({ node, depth = 0 }: { node: TreeNode; depth?: number }) {
  const [expanded, setExpanded] = useState(depth < 2);

  const handlePreview = () => {
    if (!node.data) return;
    const blob = new Blob([node.data as BlobPart]);
    const blobUrl = URL.createObjectURL(blob);
    window.open(blobUrl, "_blank");
  };

  const handleDownload = () => {
    if (!node.data) return;
    const blob = new Blob([node.data as BlobPart]);
    const blobUrl = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = blobUrl;
    a.download = node.name;
    a.click();
    URL.revokeObjectURL(blobUrl);
  };

  if (node.isDir) {
    return (
      <div>
        <button
          className="flex w-full items-center gap-1.5 rounded px-2 py-1 text-sm hover:bg-panel transition-colors"
          style={{ paddingLeft: `${depth * 16 + 8}px` }}
          onClick={() => setExpanded(!expanded)}
        >
          {expanded ? (
            <ChevronDown className="h-3.5 w-3.5 text-text-secondary flex-shrink-0" />
          ) : (
            <ChevronRight className="h-3.5 w-3.5 text-text-secondary flex-shrink-0" />
          )}
          {expanded ? (
            <FolderOpen className="h-4 w-4 text-yellow-500 flex-shrink-0" />
          ) : (
            <Folder className="h-4 w-4 text-yellow-500 flex-shrink-0" />
          )}
          <span className="text-text-primary truncate">{node.name}</span>
          <span className="text-xs text-text-secondary ml-auto">
            {node.children.length} item{node.children.length !== 1 ? "s" : ""}
          </span>
        </button>
        {expanded && (
          <div>
            {node.children.map((child) => (
              <TreeItem key={child.path} node={child} depth={depth + 1} />
            ))}
          </div>
        )}
      </div>
    );
  }

  return (
    <div
      className="group flex items-center gap-1.5 rounded px-2 py-1 text-sm hover:bg-panel transition-colors"
      style={{ paddingLeft: `${depth * 16 + 24}px` }}
    >
      <FileText className="h-4 w-4 text-text-secondary flex-shrink-0" />
      <span className="text-text-primary truncate">{node.name}</span>
      <span className="text-xs text-text-secondary ml-auto mr-2">
        {formatFileSize(node.size)}
      </span>
      <div className="hidden group-hover:flex items-center gap-1">
        <Button variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={handlePreview}>
          <Eye className="h-3.5 w-3.5" />
        </Button>
        <Button variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={handleDownload}>
          <Download className="h-3.5 w-3.5" />
        </Button>
      </div>
    </div>
  );
}

export function ZipViewer({ url, fileName }: ZipViewerProps) {
  const [files, setFiles] = useState<Record<string, Uint8Array> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function loadZip() {
      setLoading(true);
      setError(null);

      try {
        const response = await fetch(url);
        if (!response.ok) throw new Error(`Failed to fetch archive: ${response.statusText}`);

        const data = await response.arrayBuffer();
        if (cancelled) return;

        const JSZip = (await import("jszip")).default;
        const zip = await JSZip.loadAsync(data);
        if (cancelled) return;

        const result: Record<string, Uint8Array> = {};
        const entries = Object.entries(zip.files);
        for (const [path, file] of entries) {
          if (!file.dir) {
            result[path] = new Uint8Array(await file.async("arraybuffer"));
          }
        }
        if (cancelled) return;

        setFiles(result);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to extract archive");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    loadZip();
    return () => { cancelled = true; };
  }, [url]);

  const tree = useMemo(() => {
    if (!files) return [];
    return buildTree(files);
  }, [files]);

  const totalFiles = files ? Object.keys(files).filter((p) => !p.endsWith("/")).length : 0;
  const totalSize = files
    ? Object.values(files).reduce((sum, data) => sum + data.byteLength, 0)
    : 0;

  if (error) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 p-8">
        <AlertTriangle className="h-10 w-10 text-yellow-500" />
        <p className="text-sm text-text-secondary">{error}</p>
        <Button variant="secondary" size="sm" onClick={() => window.location.reload()}>
          Retry
        </Button>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-text-secondary" />
        <span className="ml-2 text-sm text-text-secondary">Extracting archive...</span>
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-2 border-b border-line px-4 py-2">
        <Archive className="h-4 w-4 text-text-secondary" />
        <span className="text-sm font-medium text-text-primary truncate">{fileName}</span>
        <span className="text-xs text-text-secondary ml-auto">
          {totalFiles} file{totalFiles !== 1 ? "s" : ""} | {formatFileSize(totalSize)}
        </span>
      </div>

      {/* File tree */}
      <div className="flex-1 overflow-auto p-2">
        {tree.length === 0 ? (
          <p className="text-sm text-text-secondary text-center py-8">Empty archive</p>
        ) : (
          tree.map((node) => <TreeItem key={node.path} node={node} />)
        )}
      </div>
    </div>
  );
}
