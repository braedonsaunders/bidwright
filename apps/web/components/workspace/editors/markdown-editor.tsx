"use client";

import { useState } from "react";
import { Save, X } from "lucide-react";
import { Button } from "@/components/ui";

interface MarkdownEditorProps {
  fileName: string;
  initialContent?: string;
  onSave?: (content: string) => void;
  onClose?: () => void;
}

function renderMarkdown(text: string): string {
  const lines = text.split("\n");
  const htmlLines: string[] = [];
  let inList = false;

  for (let i = 0; i < lines.length; i++) {
    let line = lines[i];

    // Close list if we're no longer in one
    if (inList && !line.startsWith("- ")) {
      htmlLines.push("</ul>");
      inList = false;
    }

    // Headings
    if (line.startsWith("### ")) {
      htmlLines.push(`<h3>${applyInline(line.slice(4))}</h3>`);
      continue;
    }
    if (line.startsWith("## ")) {
      htmlLines.push(`<h2>${applyInline(line.slice(3))}</h2>`);
      continue;
    }
    if (line.startsWith("# ")) {
      htmlLines.push(`<h1>${applyInline(line.slice(2))}</h1>`);
      continue;
    }

    // List items
    if (line.startsWith("- ")) {
      if (!inList) {
        htmlLines.push("<ul>");
        inList = true;
      }
      htmlLines.push(`<li>${applyInline(line.slice(2))}</li>`);
      continue;
    }

    // Empty line = paragraph break
    if (line.trim() === "") {
      htmlLines.push("<br />");
      continue;
    }

    // Regular text
    htmlLines.push(`<p>${applyInline(line)}</p>`);
  }

  if (inList) {
    htmlLines.push("</ul>");
  }

  return htmlLines.join("\n");
}

function applyInline(text: string): string {
  // Bold
  text = text.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
  // Italic
  text = text.replace(/\*(.+?)\*/g, "<em>$1</em>");
  // Inline code
  text = text.replace(/`(.+?)`/g, "<code>$1</code>");
  return text;
}

export function MarkdownEditor({
  fileName,
  initialContent = "",
  onSave,
  onClose,
}: MarkdownEditorProps) {
  const [content, setContent] = useState(initialContent);

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 bg-panel border-b border-line">
        <span className="text-sm font-medium text-fg truncate">{fileName}</span>
        <div className="flex items-center gap-1">
          {onSave && (
            <Button
              variant="ghost"
              size="xs"
              onClick={() => onSave(content)}
            >
              <Save className="w-4 h-4 mr-1" />
              Save
            </Button>
          )}
          {onClose && (
            <Button variant="ghost" size="xs" onClick={onClose}>
              <X className="w-4 h-4" />
            </Button>
          )}
        </div>
      </div>

      {/* Body: split pane */}
      <div className="flex-1 min-h-0 flex flex-row">
        {/* Left pane: editor */}
        <textarea
          className="w-1/2 h-full resize-none p-4 bg-bg text-fg font-mono text-sm outline-none border-none"
          value={content}
          onChange={(e) => setContent(e.target.value)}
          placeholder="Write markdown here..."
        />

        {/* Right pane: preview */}
        <div
          className="w-1/2 h-full border-l border-line bg-bg/50 p-4 overflow-auto text-fg text-sm"
          dangerouslySetInnerHTML={{ __html: renderMarkdown(content) }}
          style={{}}
        >
        </div>
        <style>{`
          .w-1\\/2 h1 { font-size: 1.75rem; font-weight: 700; margin: 0.75rem 0 0.5rem; }
          .w-1\\/2 h2 { font-size: 1.375rem; font-weight: 600; margin: 0.625rem 0 0.375rem; }
          .w-1\\/2 h3 { font-size: 1.125rem; font-weight: 600; margin: 0.5rem 0 0.25rem; }
          .w-1\\/2 p { margin: 0.375rem 0; line-height: 1.6; }
          .w-1\\/2 ul { padding-left: 1.5rem; margin: 0.5rem 0; list-style-type: disc; }
          .w-1\\/2 li { margin: 0.25rem 0; }
          .w-1\\/2 code { background: rgba(255,255,255,0.06); border-radius: 3px; padding: 0.15em 0.35em; font-size: 0.9em; font-family: ui-monospace, monospace; }
          .w-1\\/2 strong { font-weight: 700; }
          .w-1\\/2 em { font-style: italic; }
        `}</style>
      </div>
    </div>
  );
}
