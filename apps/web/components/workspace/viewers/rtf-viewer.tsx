"use client";

import { useEffect, useState } from "react";
import { Loader2, AlertTriangle, FileText } from "lucide-react";
import { Button } from "@/components/ui";
import { cn } from "@/lib/utils";

interface RtfViewerProps {
  url: string;
  fileName: string;
}

function parseRtf(text: string): string {
  let result = "";
  let depth = 0;
  let i = 0;
  let skipGroup = 0;

  // Groups to skip entirely (metadata, font tables, etc.)
  const skipGroupNames = ["fonttbl", "colortbl", "stylesheet", "info", "pict", "header", "footer", "footnote"];

  while (i < text.length) {
    const ch = text[i];

    if (ch === "{") {
      depth++;
      // Check if this group should be skipped
      const ahead = text.substring(i + 1, i + 30);
      if (skipGroupNames.some((name) => ahead.startsWith(`\\${name}`) || ahead.startsWith(`\\*\\${name}`))) {
        skipGroup = depth;
      }
      i++;
      continue;
    }

    if (ch === "}") {
      if (skipGroup === depth) skipGroup = 0;
      depth--;
      i++;
      continue;
    }

    if (skipGroup > 0) {
      i++;
      continue;
    }

    if (ch === "\\") {
      i++;
      if (i >= text.length) break;

      const nextCh = text[i];

      // Escaped characters
      if (nextCh === "\\") { result += "\\"; i++; continue; }
      if (nextCh === "{") { result += "{"; i++; continue; }
      if (nextCh === "}") { result += "}"; i++; continue; }
      if (nextCh === "~") { result += "\u00A0"; i++; continue; } // non-breaking space
      if (nextCh === "-") { result += "\u00AD"; i++; continue; } // soft hyphen
      if (nextCh === "\n" || nextCh === "\r") { result += "\n"; i++; continue; }

      // Read control word
      let word = "";
      while (i < text.length && /[a-zA-Z]/.test(text[i])) {
        word += text[i];
        i++;
      }

      // Read optional numeric parameter
      let param = "";
      if (i < text.length && (text[i] === "-" || /[0-9]/.test(text[i]))) {
        if (text[i] === "-") { param += "-"; i++; }
        while (i < text.length && /[0-9]/.test(text[i])) {
          param += text[i];
          i++;
        }
      }

      // Consume trailing space delimiter
      if (i < text.length && text[i] === " ") i++;

      // Handle known control words
      switch (word) {
        case "par":
        case "line":
          result += "\n";
          break;
        case "tab":
          result += "\t";
          break;
        case "b":
          result += param === "0" ? "</b>" : "<b>";
          break;
        case "i":
          result += param === "0" ? "</i>" : "<i>";
          break;
        case "ul":
          result += param === "0" ? "</u>" : "<u>";
          break;
        case "ulnone":
          result += "</u>";
          break;
        case "u": {
          // Unicode character: \uN?
          const codePoint = parseInt(param, 10);
          if (!isNaN(codePoint) && codePoint >= 0) {
            result += String.fromCharCode(codePoint);
          }
          // Skip the replacement character that follows
          if (i < text.length && text[i] !== "\\" && text[i] !== "{" && text[i] !== "}") {
            i++;
          }
          break;
        }
        case "lquote":
          result += "\u2018";
          break;
        case "rquote":
          result += "\u2019";
          break;
        case "ldblquote":
          result += "\u201C";
          break;
        case "rdblquote":
          result += "\u201D";
          break;
        case "emdash":
          result += "\u2014";
          break;
        case "endash":
          result += "\u2013";
          break;
        case "bullet":
          result += "\u2022";
          break;
        // Skip other control words silently
      }
      continue;
    }

    // Regular character
    if (ch !== "\r" && ch !== "\n") {
      result += ch;
    }
    i++;
  }

  // Clean up multiple blank lines
  result = result.replace(/\n{3,}/g, "\n\n").trim();

  return result;
}

export function RtfViewer({ url, fileName }: RtfViewerProps) {
  const [content, setContent] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function loadRtf() {
      setLoading(true);
      setError(null);

      try {
        const response = await fetch(url);
        if (!response.ok) throw new Error(`Failed to fetch file: ${response.statusText}`);

        const text = await response.text();
        if (cancelled) return;

        const parsed = parseRtf(text);
        setContent(parsed);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to load RTF file");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    loadRtf();
    return () => { cancelled = true; };
  }, [url]);

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

  if (loading || content === null) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-text-secondary" />
        <span className="ml-2 text-sm text-text-secondary">Loading document...</span>
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <div className="flex items-center gap-2 border-b border-line px-4 py-2">
        <FileText className="h-4 w-4 text-text-secondary" />
        <span className="text-sm font-medium text-text-primary truncate">{fileName}</span>
      </div>
      <div className="flex-1 overflow-auto bg-white p-8">
        <div
          className="max-w-3xl mx-auto text-sm text-gray-900 leading-relaxed font-serif"
          style={{ whiteSpace: "pre-wrap" }}
          dangerouslySetInnerHTML={{ __html: content }}
        />
      </div>
    </div>
  );
}
