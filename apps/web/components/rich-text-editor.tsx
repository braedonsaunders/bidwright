"use client";

import { useCallback, useRef, useEffect, useState } from "react";
import {
  Bold,
  Italic,
  Underline,
  Strikethrough,
  Heading1,
  Heading2,
  Heading3,
  List,
  ListOrdered,
  Link2,
  RemoveFormatting,
} from "lucide-react";
import { cn } from "@/lib/utils";

/* ─── Types ─── */

interface RichTextEditorProps {
  value: string;
  onChange: (html: string) => void;
  placeholder?: string;
  minHeight?: string;
  className?: string;
}

/* ─── Toolbar button definition ─── */

interface ToolbarAction {
  icon: React.ElementType;
  label: string;
  command: string;
  value?: string;
  type?: "block" | "prompt";
}

const TOOLBAR_ACTIONS: ToolbarAction[] = [
  { icon: Bold, label: "Bold", command: "bold" },
  { icon: Italic, label: "Italic", command: "italic" },
  { icon: Underline, label: "Underline", command: "underline" },
  { icon: Strikethrough, label: "Strikethrough", command: "strikeThrough" },
  { icon: Heading1, label: "Heading 1", command: "formatBlock", value: "H1", type: "block" },
  { icon: Heading2, label: "Heading 2", command: "formatBlock", value: "H2", type: "block" },
  { icon: Heading3, label: "Heading 3", command: "formatBlock", value: "H3", type: "block" },
  { icon: List, label: "Bullet List", command: "insertUnorderedList" },
  { icon: ListOrdered, label: "Numbered List", command: "insertOrderedList" },
  { icon: Link2, label: "Link", command: "createLink", type: "prompt" },
  { icon: RemoveFormatting, label: "Clear Formatting", command: "removeFormat" },
];

/* ─── Component ─── */

export function RichTextEditor({
  value,
  onChange,
  placeholder = "",
  minHeight = "120px",
  className,
}: RichTextEditorProps) {
  const editorRef = useRef<HTMLDivElement>(null);
  const isInternalChange = useRef(false);
  const [isEmpty, setIsEmpty] = useState(!value || value === "<br>");

  /* Execute a formatting command */
  function exec(command: string, val?: string) {
    document.execCommand(command, false, val);
    editorRef.current?.focus();
    emitChange();
  }

  /* Handle toolbar button click */
  function handleToolbarClick(action: ToolbarAction) {
    if (action.type === "prompt") {
      const url = prompt("Enter URL:");
      if (url) exec(action.command, url);
      return;
    }
    if (action.type === "block") {
      exec(action.command, action.value);
      return;
    }
    exec(action.command, action.value);
  }

  /* Emit change from contentEditable */
  function emitChange() {
    if (!editorRef.current) return;
    const html = editorRef.current.innerHTML;
    const text = editorRef.current.textContent ?? "";
    setIsEmpty(!text.trim() && !html.includes("<img"));
    isInternalChange.current = true;
    onChange(html);
  }

  /* Sync external value into editor (only when it truly differs) */
  useEffect(() => {
    if (isInternalChange.current) {
      isInternalChange.current = false;
      return;
    }
    if (editorRef.current && editorRef.current.innerHTML !== value) {
      editorRef.current.innerHTML = value;
      const text = editorRef.current.textContent ?? "";
      setIsEmpty(!text.trim() && !value.includes("<img"));
    }
  }, [value]);

  /* Handle paste: strip formatting to keep things clean */
  const handlePaste = useCallback((e: React.ClipboardEvent) => {
    e.preventDefault();
    const html = e.clipboardData.getData("text/html");
    const text = e.clipboardData.getData("text/plain");
    document.execCommand("insertHTML", false, html || text);
    emitChange();
  }, []);

  return (
    <div
      className={cn(
        "rounded-lg border border-line bg-bg overflow-hidden focus-within:border-accent/60 transition-colors",
        className,
      )}
    >
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-0.5 border-b border-line bg-panel2/40 px-1.5 py-1">
        {TOOLBAR_ACTIONS.map((action) => {
          const Icon = action.icon;
          return (
            <button
              key={action.command + (action.value ?? "")}
              type="button"
              title={action.label}
              onMouseDown={(e) => {
                e.preventDefault(); // prevent focus loss
                handleToolbarClick(action);
              }}
              className="flex h-7 w-7 items-center justify-center rounded text-fg/50 hover:bg-panel2 hover:text-fg transition-colors"
            >
              <Icon className="h-3.5 w-3.5" />
            </button>
          );
        })}
      </div>

      {/* Editor area */}
      <div className="relative">
        {isEmpty && placeholder && (
          <div
            className="pointer-events-none absolute inset-0 px-3 py-2 text-sm text-fg/30"
            aria-hidden
          >
            {placeholder}
          </div>
        )}
        <div
          ref={editorRef}
          contentEditable
          suppressContentEditableWarning
          onInput={emitChange}
          onBlur={emitChange}
          onPaste={handlePaste}
          className="prose prose-sm prose-invert max-w-none px-3 py-2 text-sm text-fg outline-none"
          style={{ minHeight }}
        />
      </div>
    </div>
  );
}
