"use client";

import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";
import {
  Bold,
  Italic,
  Strikethrough,
  Heading1,
  Heading2,
  Heading3,
  List,
  ListOrdered,
  Quote,
  Code,
  Undo2,
  Redo2,
  Save,
  X,
} from "lucide-react";
import { Button } from "@/components/ui";
import { cn } from "@/lib/utils";

interface RichTextEditorProps {
  fileName: string;
  initialContent?: string;
  onSave?: (html: string) => void;
  onClose?: () => void;
}

export function RichTextEditor({
  fileName,
  initialContent,
  onSave,
  onClose,
}: RichTextEditorProps) {
  const editor = useEditor({
    immediatelyRender: false,
    extensions: [
      StarterKit,
      Placeholder.configure({ placeholder: "Start writing..." }),
    ],
    content: initialContent ?? "",
    editorProps: {
      attributes: {
        class: "outline-none min-h-[300px] px-4 py-3",
      },
    },
  });

  if (!editor) return null;

  const toolbarItems = [
    {
      icon: Bold,
      label: "Bold",
      action: () => editor.chain().focus().toggleBold().run(),
      active: editor.isActive("bold"),
    },
    {
      icon: Italic,
      label: "Italic",
      action: () => editor.chain().focus().toggleItalic().run(),
      active: editor.isActive("italic"),
    },
    {
      icon: Strikethrough,
      label: "Strikethrough",
      action: () => editor.chain().focus().toggleStrike().run(),
      active: editor.isActive("strike"),
    },
    { separator: true },
    {
      icon: Heading1,
      label: "Heading 1",
      action: () => editor.chain().focus().toggleHeading({ level: 1 }).run(),
      active: editor.isActive("heading", { level: 1 }),
    },
    {
      icon: Heading2,
      label: "Heading 2",
      action: () => editor.chain().focus().toggleHeading({ level: 2 }).run(),
      active: editor.isActive("heading", { level: 2 }),
    },
    {
      icon: Heading3,
      label: "Heading 3",
      action: () => editor.chain().focus().toggleHeading({ level: 3 }).run(),
      active: editor.isActive("heading", { level: 3 }),
    },
    { separator: true },
    {
      icon: List,
      label: "Bullet List",
      action: () => editor.chain().focus().toggleBulletList().run(),
      active: editor.isActive("bulletList"),
    },
    {
      icon: ListOrdered,
      label: "Ordered List",
      action: () => editor.chain().focus().toggleOrderedList().run(),
      active: editor.isActive("orderedList"),
    },
    {
      icon: Quote,
      label: "Blockquote",
      action: () => editor.chain().focus().toggleBlockquote().run(),
      active: editor.isActive("blockquote"),
    },
    {
      icon: Code,
      label: "Code",
      action: () => editor.chain().focus().toggleCode().run(),
      active: editor.isActive("code"),
    },
    { separator: true },
    {
      icon: Undo2,
      label: "Undo",
      action: () => editor.chain().focus().undo().run(),
      active: false,
    },
    {
      icon: Redo2,
      label: "Redo",
      action: () => editor.chain().focus().redo().run(),
      active: false,
    },
  ] as const;

  return (
    <div className="flex flex-col h-full border border-line rounded-lg overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 bg-panel border-b border-line">
        <span className="text-sm font-medium text-fg truncate">{fileName}</span>
        <div className="flex items-center gap-1">
          {onSave && (
            <Button
              variant="ghost"
              size="xs"
              onClick={() => onSave(editor.getHTML())}
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

      {/* Toolbar */}
      <div className="flex items-center gap-0.5 px-2 py-1 bg-panel border-b border-line flex-wrap">
        {toolbarItems.map((item, i) => {
          if ("separator" in item) {
            return (
              <div
                key={`sep-${i}`}
                className="w-px h-5 bg-line mx-1 shrink-0"
              />
            );
          }
          const Icon = item.icon;
          return (
            <Button
              key={item.label}
              variant="ghost"
              size="xs"
              onClick={item.action}
              className={cn(
                item.active && "bg-accent/15 text-accent"
              )}
              title={item.label}
            >
              <Icon className="w-4 h-4" />
            </Button>
          );
        })}
      </div>

      {/* Editor content */}
      <div className="flex-1 overflow-auto bg-bg text-fg">
        <style>{`
          .ProseMirror {
            outline: none;
            min-height: 300px;
          }
          .ProseMirror h1 {
            font-size: 1.75rem;
            font-weight: 700;
            margin: 1rem 0 0.5rem;
            line-height: 1.3;
          }
          .ProseMirror h2 {
            font-size: 1.375rem;
            font-weight: 600;
            margin: 0.875rem 0 0.375rem;
            line-height: 1.3;
          }
          .ProseMirror h3 {
            font-size: 1.125rem;
            font-weight: 600;
            margin: 0.75rem 0 0.25rem;
            line-height: 1.4;
          }
          .ProseMirror p {
            margin: 0.5rem 0;
            line-height: 1.6;
          }
          .ProseMirror ul,
          .ProseMirror ol {
            padding-left: 1.5rem;
            margin: 0.5rem 0;
          }
          .ProseMirror li {
            margin: 0.25rem 0;
          }
          .ProseMirror ul li {
            list-style-type: disc;
          }
          .ProseMirror ol li {
            list-style-type: decimal;
          }
          .ProseMirror blockquote {
            border-left: 3px solid var(--color-accent, #6366f1);
            padding-left: 1rem;
            margin: 0.75rem 0;
            opacity: 0.85;
          }
          .ProseMirror code {
            background: rgba(255, 255, 255, 0.06);
            border-radius: 3px;
            padding: 0.15em 0.35em;
            font-size: 0.9em;
            font-family: ui-monospace, monospace;
          }
          .ProseMirror pre {
            background: rgba(255, 255, 255, 0.06);
            border-radius: 6px;
            padding: 0.75rem 1rem;
            margin: 0.75rem 0;
            overflow-x: auto;
          }
          .ProseMirror pre code {
            background: none;
            padding: 0;
          }
          .ProseMirror p.is-editor-empty:first-child::before {
            content: attr(data-placeholder);
            float: left;
            pointer-events: none;
            height: 0;
            opacity: 0.4;
          }
        `}</style>
        <EditorContent editor={editor} />
      </div>
    </div>
  );
}
