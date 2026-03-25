"use client";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { cn } from "@/lib/utils";

interface MarkdownRendererProps {
  content: string;
  className?: string;
}

export function MarkdownRenderer({ content, className }: MarkdownRendererProps) {
  return (
    <div className={cn("prose prose-sm max-w-none dark:prose-invert", className)}>
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        h1: ({ children }) => <h1 className="text-base font-bold mt-3 mb-1.5">{children}</h1>,
        h2: ({ children }) => <h2 className="text-sm font-bold mt-2.5 mb-1">{children}</h2>,
        h3: ({ children }) => <h3 className="text-sm font-semibold mt-2 mb-1">{children}</h3>,
        p: ({ children }) => <p className="text-xs text-fg/80 leading-relaxed mb-1.5">{children}</p>,
        ul: ({ children }) => <ul className="text-xs text-fg/80 list-disc pl-4 mb-1.5 space-y-0.5">{children}</ul>,
        ol: ({ children }) => <ol className="text-xs text-fg/80 list-decimal pl-4 mb-1.5 space-y-0.5">{children}</ol>,
        li: ({ children }) => <li className="text-xs text-fg/80">{children}</li>,
        strong: ({ children }) => <strong className="font-semibold text-fg">{children}</strong>,
        em: ({ children }) => <em className="italic">{children}</em>,
        code: ({ className: codeClassName, children, ...props }) => {
          const isInline = !codeClassName;
          if (isInline) {
            return (
              <code className="rounded bg-panel2/60 px-1 py-0.5 text-[11px] font-mono text-accent" {...props}>
                {children}
              </code>
            );
          }
          return (
            <pre className="rounded-lg bg-panel2/60 p-3 overflow-x-auto mb-2">
              <code className={cn("text-[11px] font-mono text-fg/80", codeClassName)} {...props}>
                {children}
              </code>
            </pre>
          );
        },
        pre: ({ children }) => <>{children}</>,
        table: ({ children }) => (
          <div className="overflow-x-auto mb-2">
            <table className="text-xs border-collapse w-full">{children}</table>
          </div>
        ),
        th: ({ children }) => (
          <th className="border border-line/50 bg-panel2/40 px-2 py-1 text-left text-[11px] font-semibold text-fg/70">{children}</th>
        ),
        td: ({ children }) => (
          <td className="border border-line/50 px-2 py-1 text-[11px] text-fg/70">{children}</td>
        ),
        blockquote: ({ children }) => (
          <blockquote className="border-l-2 border-accent/40 pl-3 my-1.5 text-fg/60">{children}</blockquote>
        ),
        a: ({ href, children }) => (
          <a href={href} target="_blank" rel="noopener noreferrer" className="text-accent underline underline-offset-2 hover:text-accent/80">
            {children}
          </a>
        ),
        hr: () => <hr className="border-line/50 my-2" />,
      }}
    >
      {content}
    </ReactMarkdown>
    </div>
  );
}
