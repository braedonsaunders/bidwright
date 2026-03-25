"use client";

import { useEffect, useRef, useState } from "react";
import { Loader2, AlertTriangle, FileText } from "lucide-react";
import { Button } from "@/components/ui";
import { cn } from "@/lib/utils";

interface DocxViewerProps {
  url: string;
  fileName: string;
}

export function DocxViewer({ url, fileName }: DocxViewerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function loadDocument() {
      setLoading(true);
      setError(null);

      try {
        const response = await fetch(url);
        if (!response.ok) throw new Error(`Failed to fetch document: ${response.statusText}`);

        const data = await response.arrayBuffer();
        if (cancelled) return;

        const { renderAsync } = await import("docx-preview");

        if (containerRef.current) {
          containerRef.current.innerHTML = "";
          await renderAsync(data, containerRef.current, undefined, {
            className: "docx-preview",
            inWrapper: true,
          });
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to load document");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    loadDocument();
    return () => { cancelled = true; };
  }, [url]);

  if (error) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 p-8">
        <AlertTriangle className="h-10 w-10 text-yellow-500" />
        <p className="text-sm text-fg/50">{error}</p>
        <Button variant="secondary" size="sm" onClick={() => window.location.reload()}>
          Retry
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <div className="flex items-center gap-2 border-b border-line px-4 py-2">
        <FileText className="h-4 w-4 text-fg/50" />
        <span className="text-sm font-medium text-fg truncate">{fileName}</span>
      </div>

      {loading && (
        <div className="flex flex-1 items-center justify-center">
          <Loader2 className="h-6 w-6 animate-spin text-fg/50" />
          <span className="ml-2 text-sm text-fg/50">Loading document...</span>
        </div>
      )}

      <div
        ref={containerRef}
        className={cn(
          "flex-1 overflow-auto bg-white p-4",
          loading && "hidden"
        )}
      />

      <style jsx global>{`
        .docx-preview {
          max-width: 100%;
          padding: 0;
        }
        .docx-preview .docx-wrapper {
          background: white;
          padding: 16px;
        }
        .docx-preview .docx-wrapper > section.docx {
          box-shadow: 0 1px 3px rgba(0, 0, 0, 0.12);
          margin-bottom: 16px;
          padding: 48px 64px;
          min-height: auto;
        }
        .docx-preview table {
          border-collapse: collapse;
          width: 100%;
        }
        .docx-preview td,
        .docx-preview th {
          border: 1px solid #ddd;
          padding: 4px 8px;
        }
        .docx-preview p {
          margin: 0;
          line-height: 1.5;
        }
      `}</style>
    </div>
  );
}
