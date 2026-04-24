"use client";

import { useEffect } from "react";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";
import { Table, TableCell, TableHeader, TableRow } from "@tiptap/extension-table";
import {
  Bold,
  Code,
  Columns3,
  Heading1,
  Heading2,
  Heading3,
  Italic,
  List,
  ListOrdered,
  Minus,
  Plus,
  Quote,
  Redo2,
  Rows3,
  Strikethrough,
  Table2,
  Trash2,
  Undo2,
} from "lucide-react";
import { Button } from "@/components/ui";
import { cn } from "@/lib/utils";
import {
  EMPTY_DOCUMENT_CONTENT,
  tiptapJsonToMarkdown,
  tiptapJsonToPlainText,
  type TiptapNode,
} from "@/lib/knowledge-document-content";

interface KnowledgeDocumentEditorProps {
  contentJson?: Record<string, unknown>;
  placeholder?: string;
  onChange: (payload: {
    contentJson: Record<string, unknown>;
    contentMarkdown: string;
    plainText: string;
  }) => void;
}

export function KnowledgeDocumentEditor({
  contentJson,
  placeholder = "Start writing...",
  onChange,
}: KnowledgeDocumentEditorProps) {
  const editor = useEditor({
    immediatelyRender: false,
    extensions: [
      StarterKit,
      Table.configure({ resizable: true }),
      TableRow,
      TableHeader,
      TableCell,
      Placeholder.configure({ placeholder }),
    ],
    content: (contentJson as TiptapNode | undefined) ?? EMPTY_DOCUMENT_CONTENT,
    editorProps: {
      attributes: {
        class: "knowledge-doc-editor ProseMirror min-h-[520px] outline-none px-5 py-4 text-sm leading-relaxed",
      },
    },
    onUpdate: ({ editor }) => {
      const json = editor.getJSON() as Record<string, unknown>;
      onChange({
        contentJson: json,
        contentMarkdown: tiptapJsonToMarkdown(json),
        plainText: tiptapJsonToPlainText(json),
      });
    },
  });

  useEffect(() => {
    if (!editor) return;
    editor.commands.setContent((contentJson as TiptapNode | undefined) ?? EMPTY_DOCUMENT_CONTENT, { emitUpdate: false });
  }, [contentJson, editor]);

  if (!editor) return null;

  const toolItems = [
    { icon: Bold, label: "Bold", active: editor.isActive("bold"), action: () => editor.chain().focus().toggleBold().run() },
    { icon: Italic, label: "Italic", active: editor.isActive("italic"), action: () => editor.chain().focus().toggleItalic().run() },
    { icon: Strikethrough, label: "Strike", active: editor.isActive("strike"), action: () => editor.chain().focus().toggleStrike().run() },
    { separator: true },
    { icon: Heading1, label: "Heading 1", active: editor.isActive("heading", { level: 1 }), action: () => editor.chain().focus().toggleHeading({ level: 1 }).run() },
    { icon: Heading2, label: "Heading 2", active: editor.isActive("heading", { level: 2 }), action: () => editor.chain().focus().toggleHeading({ level: 2 }).run() },
    { icon: Heading3, label: "Heading 3", active: editor.isActive("heading", { level: 3 }), action: () => editor.chain().focus().toggleHeading({ level: 3 }).run() },
    { separator: true },
    { icon: List, label: "Bullet list", active: editor.isActive("bulletList"), action: () => editor.chain().focus().toggleBulletList().run() },
    { icon: ListOrdered, label: "Ordered list", active: editor.isActive("orderedList"), action: () => editor.chain().focus().toggleOrderedList().run() },
    { icon: Quote, label: "Blockquote", active: editor.isActive("blockquote"), action: () => editor.chain().focus().toggleBlockquote().run() },
    { icon: Code, label: "Code", active: editor.isActive("code"), action: () => editor.chain().focus().toggleCode().run() },
    { separator: true },
    { icon: Table2, label: "Insert table", active: editor.isActive("table"), action: () => editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run() },
    { icon: Rows3, label: "Add row", active: false, action: () => editor.chain().focus().addRowAfter().run() },
    { icon: Columns3, label: "Add column", active: false, action: () => editor.chain().focus().addColumnAfter().run() },
    { icon: Minus, label: "Delete row", active: false, action: () => editor.chain().focus().deleteRow().run() },
    { icon: Trash2, label: "Delete table", active: false, action: () => editor.chain().focus().deleteTable().run() },
    { separator: true },
    { icon: Undo2, label: "Undo", active: false, action: () => editor.chain().focus().undo().run() },
    { icon: Redo2, label: "Redo", active: false, action: () => editor.chain().focus().redo().run() },
  ] as const;

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-lg border border-line bg-panel">
      <div className="flex flex-wrap items-center gap-0.5 border-b border-line bg-panel2/20 px-2 py-1.5">
        {toolItems.map((item, index) => {
          if ("separator" in item) {
            return <div key={`sep-${index}`} className="mx-1 h-5 w-px bg-line" />;
          }
          const Icon = item.icon;
          return (
            <Button
              key={`${item.label}-${index}`}
              size="xs"
              variant="ghost"
              title={item.label}
              onClick={item.action}
              className={cn("h-7 w-7 px-0", item.active && "bg-accent/15 text-accent")}
            >
              <Icon className="h-3.5 w-3.5" />
            </Button>
          );
        })}
        <Button
          size="xs"
          variant="ghost"
          title="Add table row"
          onClick={() => editor.chain().focus().addRowAfter().run()}
          className="ml-auto h-7 w-7 px-0"
        >
          <Plus className="h-3.5 w-3.5" />
        </Button>
      </div>

      <div className="min-h-0 flex-1 overflow-auto bg-bg text-fg">
        <style>{`
          .knowledge-doc-editor h1 { font-size: 1.45rem; font-weight: 700; margin: 1rem 0 0.45rem; line-height: 1.25; }
          .knowledge-doc-editor h2 { font-size: 1.15rem; font-weight: 700; margin: 0.9rem 0 0.4rem; line-height: 1.3; }
          .knowledge-doc-editor h3 { font-size: 1rem; font-weight: 650; margin: 0.75rem 0 0.3rem; line-height: 1.35; }
          .knowledge-doc-editor p { margin: 0.55rem 0; }
          .knowledge-doc-editor ul, .knowledge-doc-editor ol { padding-left: 1.4rem; margin: 0.55rem 0; }
          .knowledge-doc-editor ul li { list-style: disc; margin: 0.2rem 0; }
          .knowledge-doc-editor ol li { list-style: decimal; margin: 0.2rem 0; }
          .knowledge-doc-editor blockquote { border-left: 3px solid hsl(var(--accent)); padding-left: 0.9rem; margin: 0.75rem 0; opacity: 0.78; }
          .knowledge-doc-editor code { border-radius: 4px; background: hsl(var(--panel-2) / 0.7); padding: 0.1rem 0.25rem; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 0.85em; }
          .knowledge-doc-editor pre { border-radius: 8px; background: hsl(var(--panel-2) / 0.7); padding: 0.8rem; overflow-x: auto; }
          .knowledge-doc-editor table { border-collapse: collapse; margin: 0.85rem 0; table-layout: fixed; width: 100%; overflow: hidden; }
          .knowledge-doc-editor th, .knowledge-doc-editor td { border: 1px solid hsl(var(--line)); min-width: 80px; padding: 0.45rem 0.55rem; vertical-align: top; }
          .knowledge-doc-editor th { background: hsl(var(--panel-2) / 0.55); font-weight: 650; }
          .knowledge-doc-editor .selectedCell:after { background: hsl(var(--accent) / 0.12); content: ""; inset: 0; pointer-events: none; position: absolute; z-index: 2; }
          .knowledge-doc-editor .column-resize-handle { background: hsl(var(--accent)); bottom: -2px; pointer-events: none; position: absolute; right: -2px; top: 0; width: 3px; }
          .knowledge-doc-editor p.is-editor-empty:first-child::before { content: attr(data-placeholder); float: left; height: 0; opacity: 0.4; pointer-events: none; }
        `}</style>
        <EditorContent editor={editor} />
      </div>
    </div>
  );
}
