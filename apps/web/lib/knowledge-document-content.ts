export type TiptapNode = {
  type?: string;
  text?: string;
  attrs?: Record<string, unknown>;
  marks?: Array<{ type: string; attrs?: Record<string, unknown> }>;
  content?: TiptapNode[];
};

export const EMPTY_DOCUMENT_CONTENT: TiptapNode = {
  type: "doc",
  content: [{ type: "paragraph" }],
};

function escapeCell(value: string) {
  return value.replace(/\|/g, "\\|").replace(/\n+/g, " ").trim();
}

function inlineMarkdown(node: TiptapNode): string {
  if (node.type === "text") {
    let text = node.text ?? "";
    for (const mark of node.marks ?? []) {
      if (mark.type === "bold") text = `**${text}**`;
      if (mark.type === "italic") text = `_${text}_`;
      if (mark.type === "strike") text = `~~${text}~~`;
      if (mark.type === "code") text = `\`${text}\``;
      if (mark.type === "link" && mark.attrs?.href) text = `[${text}](${String(mark.attrs.href)})`;
    }
    return text;
  }
  if (node.type === "hardBreak") return "\n";
  return (node.content ?? []).map(inlineMarkdown).join("");
}

function nodeMarkdown(node: TiptapNode, orderedDepth = 0): string {
  const children = node.content ?? [];
  switch (node.type) {
    case "doc":
      return children.map((child) => nodeMarkdown(child, orderedDepth)).filter(Boolean).join("\n\n");
    case "paragraph":
      return inlineMarkdown(node).trim();
    case "heading": {
      const level = Math.min(Math.max(Number(node.attrs?.level ?? 2), 1), 6);
      return `${"#".repeat(level)} ${inlineMarkdown(node).trim()}`;
    }
    case "blockquote":
      return children
        .map((child) => nodeMarkdown(child, orderedDepth))
        .join("\n\n")
        .split("\n")
        .map((line) => `> ${line}`)
        .join("\n");
    case "bulletList":
      return children.map((child) => `- ${nodeMarkdown(child, orderedDepth).replace(/\n/g, "\n  ")}`).join("\n");
    case "orderedList":
      return children.map((child, index) => `${index + 1}. ${nodeMarkdown(child, orderedDepth + 1).replace(/\n/g, "\n   ")}`).join("\n");
    case "listItem":
      return children.map((child) => nodeMarkdown(child, orderedDepth)).join("\n").trim();
    case "codeBlock":
      return `\`\`\`\n${inlineMarkdown(node)}\n\`\`\``;
    case "horizontalRule":
      return "---";
    case "table": {
      const rows = children.filter((child) => child.type === "tableRow");
      if (rows.length === 0) return "";
      const matrix = rows.map((row) =>
        (row.content ?? []).map((cell) => escapeCell((cell.content ?? []).map((part) => nodeMarkdown(part, orderedDepth)).join(" ").trim())),
      );
      const width = Math.max(...matrix.map((row) => row.length), 1);
      const normalized = matrix.map((row) => [...row, ...Array(Math.max(0, width - row.length)).fill("")]);
      const header = normalized[0];
      const separator = Array(width).fill("---");
      const body = normalized.slice(1);
      return [header, separator, ...body].map((row) => `| ${row.join(" | ")} |`).join("\n");
    }
    default:
      return children.map((child) => nodeMarkdown(child, orderedDepth)).join("");
  }
}

export function tiptapJsonToMarkdown(content: Record<string, unknown> | TiptapNode | null | undefined) {
  if (!content || typeof content !== "object") return "";
  return nodeMarkdown(content as TiptapNode).trim();
}

export function tiptapJsonToPlainText(content: Record<string, unknown> | TiptapNode | null | undefined) {
  const markdown = tiptapJsonToMarkdown(content);
  return markdown
    .replace(/```[\s\S]*?```/g, (block) => block.replace(/```/g, ""))
    .replace(/[#>*_`~\[\]()]|---|\|/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function textNode(text: string): TiptapNode {
  return text ? { type: "text", text } : { type: "text", text: " " };
}

function paragraph(text: string): TiptapNode {
  return { type: "paragraph", content: [textNode(text)] };
}

function tableCell(value: string, header = false): TiptapNode {
  return {
    type: header ? "tableHeader" : "tableCell",
    content: [paragraph(value.trim())],
  };
}

function parseTable(lines: string[]): TiptapNode | null {
  if (lines.length < 2 || !/^\s*\|?[\s:-]+\|[\s|:-]*$/.test(lines[1])) return null;
  const rows = [lines[0], ...lines.slice(2)]
    .map((line) =>
      line
        .trim()
        .replace(/^\|/, "")
        .replace(/\|$/, "")
        .split("|")
        .map((cell) => cell.trim()),
    )
    .filter((row) => row.length > 0);
  if (rows.length === 0) return null;
  return {
    type: "table",
    content: rows.map((row, rowIndex) => ({
      type: "tableRow",
      content: row.map((cell) => tableCell(cell, rowIndex === 0)),
    })),
  };
}

export function markdownToTiptapJson(markdown: string): TiptapNode {
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  const nodes: TiptapNode[] = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index];
    if (!line.trim()) {
      index += 1;
      continue;
    }

    if (line.includes("|") && lines[index + 1]?.includes("|")) {
      const tableLines: string[] = [];
      while (index < lines.length && lines[index].includes("|")) {
        tableLines.push(lines[index]);
        index += 1;
      }
      const table = parseTable(tableLines);
      if (table) {
        nodes.push(table);
        continue;
      }
      nodes.push(paragraph(tableLines.join(" ")));
      continue;
    }

    const heading = line.match(/^(#{1,6})\s+(.+)$/);
    if (heading) {
      nodes.push({
        type: "heading",
        attrs: { level: heading[1].length },
        content: [textNode(heading[2].trim())],
      });
      index += 1;
      continue;
    }

    const bulletLines: string[] = [];
    while (/^\s*[-*]\s+/.test(lines[index] ?? "")) {
      bulletLines.push((lines[index] ?? "").replace(/^\s*[-*]\s+/, ""));
      index += 1;
    }
    if (bulletLines.length > 0) {
      nodes.push({
        type: "bulletList",
        content: bulletLines.map((item) => ({ type: "listItem", content: [paragraph(item)] })),
      });
      continue;
    }

    const orderedLines: string[] = [];
    while (/^\s*\d+\.\s+/.test(lines[index] ?? "")) {
      orderedLines.push((lines[index] ?? "").replace(/^\s*\d+\.\s+/, ""));
      index += 1;
    }
    if (orderedLines.length > 0) {
      nodes.push({
        type: "orderedList",
        content: orderedLines.map((item) => ({ type: "listItem", content: [paragraph(item)] })),
      });
      continue;
    }

    const paragraphLines = [line.trim()];
    index += 1;
    while (index < lines.length && lines[index].trim() && !/^(#{1,6})\s+/.test(lines[index]) && !lines[index].includes("|")) {
      paragraphLines.push(lines[index].trim());
      index += 1;
    }
    nodes.push(paragraph(paragraphLines.join(" ")));
  }

  return { type: "doc", content: nodes.length > 0 ? nodes : [{ type: "paragraph" }] };
}
