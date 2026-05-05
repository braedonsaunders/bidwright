"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "motion/react";
import { Renderer, createLibrary } from "@openuidev/react-lang";
import { openuiLibrary } from "@openuidev/react-ui/genui-lib";
import { AlertTriangle, ArrowDown, BookOpen, Bot, CheckCircle2, ChevronDown, ChevronRight, ClipboardList, ExternalLink, Eye, FileCheck2, FileText, FileSpreadsheet, FileImage, FolderSearch, Gauge, Layers3, Loader2, Navigation, PanelBottom, PanelLeft, PanelRight, RefreshCw, Search, Send, Sparkles, Square, Table2, X, XCircle, Wrench } from "lucide-react";
import { Badge, Button, Textarea } from "@/components/ui";
import { getAgentToolDisplayName, isAgentToolMutating, normalizeAgentToolId } from "@bidwright/domain";
import {
  getSettings,
  startCliSession, connectCliStream, stopCliSession, resumeCliSession, sendCliMessage, getCliStatus, detectCli,
  getCliPendingQuestion, answerCliQuestion,
  getProjectWorkspace,
  listPersonas, type EstimatorPersona,
  resolveApiUrl,
} from "@/lib/api";
import { cn } from "@/lib/utils";
import { MarkdownRenderer } from "@/components/markdown-renderer";

// Types

interface ToolCallEntry {
  id: string;
  toolId: string;
  input: unknown;
  result: {
    success: boolean;
    data?: unknown;
    error?: string;
    sideEffects?: string[];
    duration_ms: number;
    message?: string;
    uiEvent?: AgentUiEvent | null;
    images?: ToolResultImage[];
  };
  startedAt?: string;
  completedAt?: string;
  status?: "running" | "complete" | "failed" | "stopped";
}

interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  toolCalls?: ToolCallEntry[];
  timestamp: string;
}

interface AgentChatProps {
  projectId: string;
  open: boolean;
  onClose: () => void;
  prefill?: string | null;
  autoStartIntake?: boolean;
  initialPersonaId?: string | null;
  onIntakeStarted?: () => void;
  onWorkspaceMutated?: () => void;
  onAgentNavigate?: (intent: AgentNavigationIntent) => void | Promise<void>;
}

export type AgentNavigationIntent =
  | { type: "setup"; field?: string; label?: string }
  | { type: "worksheet"; worksheetId?: string; itemId?: string; label?: string }
  | { type: "document"; documentId: string; label?: string }
  | { type: "summarize"; label?: string };

interface AgentUiEvent {
  kind?: string;
  worksheetId?: string;
  itemId?: string;
  documentId?: string;
  bookId?: string;
  pageNumber?: number;
  name?: string;
  path?: string;
  entityName?: string;
  category?: string;
  quantity?: number;
  uom?: string;
  unitCost?: number;
  unitPrice?: number;
  fields?: string[];
  preset?: string;
  [key: string]: unknown;
}

interface ToolResultImage {
  imageUrl: string;
  mimeType: string;
  label?: string;
}

interface PendingQuestionStep {
  id?: string;
  prompt: string;
  options?: string[];
  allowMultiple?: boolean;
  placeholder?: string;
  context?: string;
}

interface PendingQuestionPrompt {
  id?: string | null;
  question: string;
  options?: string[];
  allowMultiple?: boolean;
  context?: string;
  questions?: PendingQuestionStep[];
}

interface IntakeStatusResult {
  sessionId: string;
  projectId: string;
  scope: string;
  status: "running" | "completed" | "failed" | "stopped" | "waiting_for_user";
  pendingQuestion?: { question: string; options?: string[]; allowMultiple?: boolean; context?: string } | null;
  toolCallCount: number;
  messageCount: number;
  summary: string | null;
  createdAt: string;
  updatedAt: string;
  recentToolCalls: Array<{ toolId: string; success: boolean; duration_ms: number }>;
  events?: any[];
}

// Helpers

const bidwrightOpenUILibrary = createLibrary({
  components: Object.values((openuiLibrary as any).components || {}) as any,
  componentGroups: (openuiLibrary as any).componentGroups,
  root: (openuiLibrary as any).root,
} as any);

function authHeaders(): Record<string, string> {
  return { "Content-Type": "application/json" };
}

function intakeStorageKey(projectId: string) {
  return `bw_intake_${projectId}`;
}

type AgentDockMode = "right" | "left" | "bottom" | "detached";

function agentDockStorageKey(projectId: string) {
  return `bw_agent_dock_${projectId}`;
}

function isAgentDockMode(value: unknown): value is AgentDockMode {
  return value === "right" || value === "left" || value === "bottom" || value === "detached";
}

type CliRuntime = string;
type CliModelOption = { id: string; name: string; description: string };
type CliRuntimeMap = Record<string, {
  id: string;
  displayName: string;
  available: boolean;
  experimental: boolean;
  primaryInstructionFile: string;
  models: CliModelOption[];
}>;

const KNOWN_RUNTIMES: readonly string[] = ["claude-code", "codex", "opencode", "gemini"];

function isCliRuntime(value: unknown, runtimeMap?: CliRuntimeMap | null): value is CliRuntime {
  if (typeof value !== "string" || !value) return false;
  if (runtimeMap) return value in runtimeMap;
  return KNOWN_RUNTIMES.includes(value);
}

function defaultCliModel(runtime: CliRuntime, runtimeMap?: CliRuntimeMap | null): string {
  // Prefer the first model surfaced for that runtime; fall back to legacy aliases
  // for the original two CLIs to preserve historical behavior.
  const list = runtimeMap?.[runtime]?.models;
  if (list && list.length > 0) {
    const def = list.find((m) => (m as any).isDefault) || list[0];
    return def.id;
  }
  if (runtime === "codex") return "gpt-5.4";
  if (runtime === "gemini") return "gemini-2.5-pro";
  if (runtime === "opencode") return "anthropic/claude-sonnet-4-5";
  return "sonnet";
}

function isCompatibleCliModel(runtime: CliRuntime, model: string, runtimeMap?: CliRuntimeMap | null): boolean {
  const list = runtimeMap?.[runtime]?.models;
  if (list && list.length > 0) return list.some((m) => m.id === model);
  // No live model list — accept anything; the server normalizes on use.
  return !!model;
}

function normalizeCliModel(runtime: CliRuntime, model: string | null | undefined, runtimeMap?: CliRuntimeMap | null): string {
  if (model && isCompatibleCliModel(runtime, model, runtimeMap)) return model;
  return defaultCliModel(runtime, runtimeMap);
}

function getAutoCliRuntime(runtimeMap: CliRuntimeMap | null): CliRuntime | null {
  if (!runtimeMap) return null;
  const stable = Object.values(runtimeMap).find((r) => r.available && !r.experimental);
  if (stable) return stable.id;
  const any = Object.values(runtimeMap).find((r) => r.available);
  return any ? any.id : null;
}

function hasMutatingToolCalls(toolCalls: Array<{ toolId: string; result?: { sideEffects?: string[] } }>): boolean {
  return toolCalls.some(
    (tc) => isAgentToolMutating(tc.toolId) || (tc.result?.sideEffects && tc.result.sideEffects.length > 0),
  );
}


// File Access Detection

const FILE_TOOL_IDS = new Set(["Read", "Glob", "Grep"]);

function isFileAccessTool(toolId: string): boolean {
  return FILE_TOOL_IDS.has(toolId);
}

function getFileIcon(fileName: string) {
  const ext = fileName.split(".").pop()?.toLowerCase();
  switch (ext) {
    case "pdf": return <FileText className="h-3.5 w-3.5 text-red-400 shrink-0" />;
    case "xlsx": case "xls": case "csv": return <FileSpreadsheet className="h-3.5 w-3.5 text-green-400 shrink-0" />;
    case "png": case "jpg": case "jpeg": case "dwg": return <FileImage className="h-3.5 w-3.5 text-blue-400 shrink-0" />;
    default: return <FileText className="h-3.5 w-3.5 text-fg/30 shrink-0" />;
  }
}

function extractFileName(input: any): string | null {
  if (!input) return null;
  const filePath = input.file_path || input.path || input.pattern || "";
  if (!filePath) return null;
  // Get just the filename from full path
  const parts = filePath.split("/");
  return parts[parts.length - 1] || filePath;
}

// Project Workspace Helpers

function FileAccessWidget({ tc }: { tc: ToolCallEntry }) {
  const fileName = extractFileName(tc.input);
  const isGlob = tc.toolId === "Glob";
  const isGrep = tc.toolId === "Grep";
  const pages = (tc.input as any)?.pages;

  return (
    <div className="flex items-center gap-2 rounded-md border border-line/50 bg-bg/40 px-2.5 py-1.5">
      {isGlob ? (
        <FolderSearch className="h-3.5 w-3.5 text-amber-400 shrink-0" />
      ) : isGrep ? (
        <Search className="h-3.5 w-3.5 text-purple-400 shrink-0" />
      ) : (
        fileName ? getFileIcon(fileName) : <FileText className="h-3.5 w-3.5 text-fg/30 shrink-0" />
      )}
      <div className="flex-1 min-w-0">
        <span className="text-[11px] font-medium text-fg/60 truncate block">
          {isGlob ? `Searching: ${(tc.input as any)?.pattern || "..."}` :
           isGrep ? `Grep: ${(tc.input as any)?.pattern || "..."}` :
           fileName || "Reading file..."}
        </span>
        {pages && <span className="text-[9px] text-fg/25">pages {pages}</span>}
      </div>
      {tc.result.success ? (
        <CheckCircle2 className="h-3 w-3 shrink-0 text-success/60" />
      ) : (
        <XCircle className="h-3 w-3 shrink-0 text-danger/60" />
      )}
    </div>
  );
}

// Thinking Helpers

function AgentWidget({ tc, isRunning }: { tc: ToolCallEntry; isRunning: boolean }) {
  const [expanded, setExpanded] = useState(false);
  const input = tc.input as any;
  // Extract a short description from the agent prompt
  const prompt = input?.prompt || input?.description || "";
  const shortPrompt = prompt.length > 120 ? prompt.substring(0, 120) + "..." : prompt;
  const hasResult = tc.result.duration_ms > 0 || tc.result.data;

  return (
    <div className="rounded-lg border border-accent/20 bg-accent/[0.03] overflow-hidden">
      <button
        className="flex w-full items-center gap-2 px-3 py-2 text-left"
        onClick={() => setExpanded(!expanded)}
      >
        <div className="flex h-6 w-6 items-center justify-center rounded-md bg-accent/10 shrink-0">
          {!hasResult && isRunning ? (
            <Loader2 className="h-3.5 w-3.5 text-accent animate-spin" />
          ) : (
            <Bot className="h-3.5 w-3.5 text-accent" />
          )}
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-[11px] font-medium text-accent/80">Sub-Agent</div>
          <div className="text-[10px] text-fg/40 truncate">{shortPrompt || "Working..."}</div>
        </div>
        {hasResult ? (
          <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-success" />
        ) : isRunning ? (
          <span className="text-[9px] text-accent/60 shrink-0 animate-pulse">running</span>
        ) : null}
        {expanded ? (
          <ChevronDown className="h-3 w-3 text-fg/20 shrink-0" />
        ) : (
          <ChevronRight className="h-3 w-3 text-fg/20 shrink-0" />
        )}
      </button>
      {expanded && (
        <div className="border-t border-accent/10 px-3 py-2 space-y-1.5">
          {prompt && (
            <div>
              <div className="text-[9px] text-fg/25 uppercase tracking-wider mb-0.5">Task</div>
              <div className="text-[10px] text-fg/50 whitespace-pre-wrap">{prompt}</div>
            </div>
          )}
          {tc.result.data && (
            <div>
              <div className="text-[9px] text-fg/25 uppercase tracking-wider mb-0.5">Result</div>
              <pre className="max-h-40 overflow-auto rounded bg-bg/50 p-1.5 text-[10px] text-fg/40 whitespace-pre-wrap break-all">
                {typeof tc.result.data === "string" ? tc.result.data : JSON.stringify(tc.result.data, null, 2)}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function isAgentTool(toolId: string): boolean {
  return toolId === "Agent" || toolId === "agent";
}

// Pending Question Helpers

function ToolCallDetail({ tc }: { tc: ToolCallEntry }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <div className="rounded border border-line bg-bg/30 px-2 py-1.5">
      <button
        className="flex w-full items-center gap-1.5 text-left"
        onClick={() => setExpanded(!expanded)}
      >
        {expanded ? (
          <ChevronDown className="h-3 w-3 text-fg/30 shrink-0" />
        ) : (
          <ChevronRight className="h-3 w-3 text-fg/30 shrink-0" />
        )}
        <Wrench className="h-3 w-3 text-fg/30 shrink-0" />
        <span className="text-[11px] font-medium text-fg/50 truncate">{humanToolName(tc.toolId)}</span>
        {tc.result.success ? (
          <CheckCircle2 className="ml-auto h-3 w-3 shrink-0 text-success" />
        ) : (
          <XCircle className="ml-auto h-3 w-3 shrink-0 text-danger" />
        )}
        <span className="text-[10px] text-fg/25 shrink-0">{tc.result.duration_ms}ms</span>
      </button>
      {expanded && (
        <div className="mt-1.5 space-y-1 border-t border-line/50 pt-1.5">
          {tc.result.error && (
            <div className="text-[10px] text-danger">{tc.result.error}</div>
          )}
          {tc.result.sideEffects && tc.result.sideEffects.length > 0 && (
            <div className="text-[10px] text-fg/35">
              {tc.result.sideEffects.join(", ")}
            </div>
          )}
          {/* Show input parameters */}
          {tc.input != null && Object.keys(tc.input as any).length > 0 && (
            <div>
              <div className="text-[9px] text-fg/25 uppercase tracking-wider mb-0.5">Input</div>
              <pre className="max-h-32 overflow-auto rounded bg-bg/50 p-1.5 text-[10px] text-fg/40 whitespace-pre-wrap break-all">
                {JSON.stringify(tc.input, null, 2)}
              </pre>
            </div>
          )}
          {/* Show result data if available */}
          {tc.result.data != null && (
            <div>
              <div className="text-[9px] text-fg/25 uppercase tracking-wider mb-0.5">Result</div>
              <pre className="max-h-40 overflow-auto rounded bg-bg/50 p-1.5 text-[10px] text-fg/50 whitespace-pre-wrap break-all">
                {typeof tc.result.data === "string" ? tc.result.data : JSON.stringify(tc.result.data, null, 2)}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// Live Tool Feed

function LiveToolFeed({ toolCalls, isRunning }: { toolCalls: ToolCallEntry[]; isRunning: boolean }) {
  const [showAll, setShowAll] = useState(false);
  if (toolCalls.length === 0) return null;

  const visible = showAll ? toolCalls : toolCalls.slice(-8);
  const hidden = toolCalls.length - visible.length;

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-medium text-fg/40 uppercase tracking-wider">
          Tool Calls ({toolCalls.length})
        </span>
        {hidden > 0 && (
          <button
            className="text-[10px] text-accent hover:underline"
            onClick={() => setShowAll(!showAll)}
          >
            {showAll ? "Show recent" : `Show all (${hidden} more)`}
          </button>
        )}
      </div>
      <div className="space-y-1">
        {visible.map((tc, i) => (
          <ToolCallDetail key={tc.id || `tc-${i}`} tc={tc} />
        ))}
      </div>
      {isRunning && (
        <div className="flex items-center gap-1.5 text-[10px] text-fg/30">
          <Loader2 className="h-3 w-3 animate-spin" />
          Waiting for next tool call...
        </div>
      )}
    </div>
  );
}

// Main Component

interface GuidedQuestion {
  id: string;
  prompt: string;
  options: string[];
  allowMultiple: boolean;
  placeholder: string;
  context?: string;
}

interface GuidedQuestionnaire {
  summary: string;
  questions: GuidedQuestion[];
}

const DEFAULTS_PATTERN = /(reasonable defaults|use defaults|proceed .*defaults)/i;
const MULTI_SELECT_PATTERN = /\b(multi[-\s]?select|select all that apply|pick all|choose all|check all|all that apply|multiple selections?)\b/i;

type GuidedResponse = { choice?: string; choices?: string[]; detail: string };

function allowsMultipleSelection(prompt: string, allowMultiple?: boolean): boolean {
  return allowMultiple === true || MULTI_SELECT_PATTERN.test(stripMarkdown(prompt));
}

function stripMarkdown(text: string): string {
  return text
    .replace(/\*\*/g, "")
    .replace(/`/g, "")
    .replace(/\[(.*?)\]\(.*?\)/g, "$1")
    .trim();
}

function normalizePromptText(text: string): string {
  return text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").trim();
}

function extractNumberedBlocks(section: string): string[] {
  const matches = section.matchAll(/(?:^|\n)(\d+)\.\s+([\s\S]*?)(?=(?:\n\d+\.\s)|$)/g);
  return Array.from(matches, (match) => match[2].trim()).filter(Boolean);
}

function looksLikeQuestionHeading(paragraph: string): boolean {
  const normalized = stripMarkdown(paragraph.replace(/\s+/g, " ").trim());
  if (!normalized) return false;
  if (/^[A-Z][A-Za-z0-9/&(),'"\- ]{1,60}:/.test(normalized)) return true;
  if (normalized.endsWith("?")) return true;
  return false;
}

function extractPromptBlocks(section: string): string[] {
  const numberedBlocks = extractNumberedBlocks(section);
  if (numberedBlocks.length > 0) return numberedBlocks;

  const paragraphs = normalizePromptText(section).split(/\n\s*\n+/).map((paragraph) => paragraph.trim()).filter(Boolean);
  const blocks: string[] = [];

  for (const paragraph of paragraphs) {
    if (blocks.length === 0 || looksLikeQuestionHeading(paragraph)) {
      blocks.push(paragraph);
      continue;
    }
    blocks[blocks.length - 1] = `${blocks[blocks.length - 1]}\n${paragraph}`;
  }

  return blocks;
}

function splitBlock(block: string) {
  const lines = normalizePromptText(block).split("\n").map((line) => line.trim()).filter(Boolean);
  const bullets: string[] = [];
  const prose: string[] = [];

  for (const [index, line] of lines.entries()) {
    if (/^[-*]\s+/.test(line)) {
      bullets.push(stripMarkdown(line.replace(/^[-*]\s+/, "")));
    } else if (index > 0 && /\?$/.test(line)) {
      bullets.push(stripMarkdown(line));
    } else {
      prose.push(line);
    }
  }

  return {
    prose: stripMarkdown(prose.join(" ")),
    bullets,
  };
}

function deriveQuestionOptions(prompt: string): string[] {
  const lower = prompt.toLowerCase();

  if (lower.includes("match your understanding") || lower.includes("scope summary")) {
    return ["Yes, that scope looks right", "Mostly right", "No, it needs changes"];
  }
  if (lower.includes("owner-furnished")) {
    return ["Owner-furnished / install only", "Include procurement", "Mixed / partial"];
  }
  if (lower.includes("electrical scope") || lower.includes("electrical work")) {
    return ["Excluded / by others", "Included in our scope", "Mixed / partial"];
  }
  if (lower.includes("subcontract") || lower.includes("rigging") || lower.includes("crane")) {
    return ["Subcontract", "Self-perform", "Mixed / unsure"];
  }
  if (lower.includes("shut down")) {
    return ["Yes", "No", "Partially / phased"];
  }
  if (lower.includes("site access hours")) {
    return ["Weekday dayshift", "Extended hours", "24/7"];
  }
  if (lower.includes("project duration") || lower.includes("target completion")) {
    return ["Less than 4 weeks", "4-6 weeks", "More than 6 weeks"];
  }
  if (lower.includes("union") || lower.includes("open shop")) {
    return ["Union", "Open shop", "Unsure"];
  }
  if (lower.includes("overtime") || lower.includes("shift premium")) {
    return ["No overtime", "Some overtime", "Shift work / premium"];
  }
  if (lower.includes("fabrication area") || lower.includes("laydown area") || lower.includes("shop fabrication location")) {
    return ["On-site laydown area", "Off-site shop fabrication", "Mixed / both"];
  }
  if (lower.includes("access equipment")) {
    return ["Scissor lifts", "Boom lifts", "Scaffolding / mixed access"];
  }
  if (lower.includes("other trades")) {
    return ["No other trades", "Some trades should be subcontracted", "Unsure"];
  }

  return ["Yes", "No", "Unsure"];
}

function deriveQuestionPlaceholder(prompt: string): string {
  const lower = prompt.toLowerCase();

  if (lower.includes("scope summary") || lower.includes("match your understanding")) {
    return "Add scope additions, exclusions, or corrections";
  }
  if (lower.includes("project duration") || lower.includes("target completion")) {
    return "Add the target duration or completion date";
  }
  if (lower.includes("site access hours")) {
    return "Add the actual working hours if needed";
  }
  if (lower.includes("other trades")) {
    return "List any additional trades or scopes";
  }
  if (lower.includes("overtime") || lower.includes("shift premium")) {
    return "Add overtime rules or shift details";
  }
  if (lower.includes("fabrication area") || lower.includes("laydown area")) {
    return "Add any fabrication or shipping constraints";
  }

  return "Add details if needed";
}

function buildGuidedQuestionnaire(prompt: PendingQuestionPrompt): GuidedQuestionnaire | null {
  if (prompt.questions && prompt.questions.length > 0) {
    return {
      summary: prompt.question,
      questions: prompt.questions.map((question, index) => ({
        id: question.id || `guided-${index + 1}`,
        prompt: question.prompt,
        options: question.options && question.options.length > 0 ? question.options : deriveQuestionOptions(question.prompt),
        allowMultiple: allowsMultipleSelection(question.prompt, question.allowMultiple),
        placeholder: question.placeholder || deriveQuestionPlaceholder(question.prompt),
        context: question.context,
      })),
    };
  }

  const text = normalizePromptText(prompt.question);
  const clarifyingMatch = text.match(/(?:\*\*CLARIFYING QUESTIONS:\*\*|##\s*Clarifying Questions|Clarifying Questions:?)([\s\S]*)$/i);
  if (!clarifyingMatch) return null;

  const clarifyingSection = clarifyingMatch[1]?.trim();
  if (!clarifyingSection) return null;

  const summary = text.slice(0, clarifyingMatch.index).trim();
  const blocks = extractPromptBlocks(clarifyingSection);
  if (blocks.length === 0) return null;

  const questions: GuidedQuestion[] = [
    {
      id: "scope-confirmation",
      prompt: "Does the scope summary match your understanding?",
      options: deriveQuestionOptions("scope summary"),
      allowMultiple: false,
      placeholder: deriveQuestionPlaceholder("scope summary"),
    },
  ];

  for (const block of blocks) {
    const { prose, bullets } = splitBlock(block);
    const promptText = prose.replace(/:\s*$/, "").trim();

    if (bullets.length > 0) {
      for (const bullet of bullets) {
        const isQuestion = /\?$/.test(bullet);
        let derivedPrompt = isQuestion ? bullet : `${bullet}?`;

        if (/^any others\??$/i.test(bullet) && /subcontract|self-perform/i.test(promptText)) {
          derivedPrompt = "Any other activities that should be subcontracted?";
        } else if (/subcontract|self-perform/i.test(promptText)) {
          derivedPrompt = `How should we handle ${bullet.replace(/\?$/, "")}?`;
        } else if (/access equipment/i.test(promptText)) {
          derivedPrompt = "What access equipment is available or planned?";
        } else if (!isQuestion && promptText) {
          derivedPrompt = `${promptText.replace(/\?$/, "")} ${bullet}`.trim();
        }

        questions.push({
          id: `${questions.length + 1}`,
          prompt: stripMarkdown(derivedPrompt),
          options: deriveQuestionOptions(`${promptText} ${bullet}`),
          allowMultiple: allowsMultipleSelection(`${promptText} ${bullet}`),
          placeholder: deriveQuestionPlaceholder(`${promptText} ${bullet}`),
        });
      }
      continue;
    }

    if (!promptText) continue;

    questions.push({
      id: `${questions.length + 1}`,
      prompt: promptText,
      options: deriveQuestionOptions(promptText),
      allowMultiple: allowsMultipleSelection(promptText),
      placeholder: deriveQuestionPlaceholder(promptText),
    });
  }

  return questions.length > 0 ? { summary, questions } : null;
}

function compileGuidedAnswer(questionnaire: GuidedQuestionnaire, responses: Record<string, GuidedResponse>) {
  const lines = ["I answered each question individually."];

  questionnaire.questions.forEach((question, index) => {
    const response = responses[question.id];
    if (!response) return;

    const detail = response.detail.trim();
    const choices = response.choices && response.choices.length > 0
      ? response.choices
      : response.choice
        ? [response.choice]
        : [];

    lines.push(`${index + 1}. ${question.prompt}`);
    if (choices.length > 0) {
      lines.push(`   ${question.allowMultiple ? "Choices" : "Choice"}: ${choices.join("; ")}`);
    }
    if (detail) {
      lines.push(`   Detail: ${detail}`);
    }
  });

  return lines.join("\n");
}

function compileMultiSelectAnswer(prompt: PendingQuestionPrompt, selections: string[], detail: string) {
  const lines = [`${prompt.question}`, "", "Selected options:"];
  for (const selection of selections) {
    lines.push(`- ${selection}`);
  }
  const trimmedDetail = detail.trim();
  if (trimmedDetail) {
    lines.push("", "Additional detail:", trimmedDetail);
  }
  return lines.join("\n");
}

function promptMatchesAskUserEvent(prompt: PendingQuestionPrompt, event: any): boolean {
  const eventId = event?.data?.questionId || event?.data?.id || null;
  if (prompt.id && eventId) return eventId === prompt.id;
  return normalizePromptText(event?.data?.question || "") === normalizePromptText(prompt.question || "");
}

function extractAnswerText(event: any): string | null {
  const data = event?.data || {};
  const candidates = [data.answer, data.text, data.content, data.message];
  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.trim()) return candidate;
  }
  return null;
}

function findAnswerForAskUser(events: any[], askIndex: number): string | null {
  const askEvent = events[askIndex];
  const askId = askEvent?.data?.questionId || askEvent?.data?.id || null;
  for (let i = askIndex + 1; i < events.length; i += 1) {
    const event = events[i];
    if (!event) continue;
    if (event.type === "run_divider") break;
    if (!askId && event.type === "askUser") break;
    if (event.type === "userAnswer") {
      const answerId = event?.data?.questionId || event?.data?.id || null;
      if (askId && answerId && answerId !== askId) continue;
      const answer = extractAnswerText(event);
      if (answer) return answer;
    }
  }

  return null;
}

function askUserEventsMatch(a: any, b: any): boolean {
  const aId = a?.data?.questionId || a?.data?.id || null;
  const bId = b?.data?.questionId || b?.data?.id || null;
  if (aId && bId) return aId === bId;
  const aQuestion = normalizePromptText(a?.data?.question || "");
  const bQuestion = normalizePromptText(b?.data?.question || "");
  return !!aQuestion && aQuestion === bQuestion;
}

function parseGuidedAnswer(answer: string | null | undefined): Map<number, string[]> {
  const result = new Map<number, string[]>();
  if (!answer) return result;

  let currentIndex: number | null = null;
  for (const rawLine of answer.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;

    const questionMatch = line.match(/^(\d+)\.\s+/);
    if (questionMatch) {
      currentIndex = Number(questionMatch[1]) - 1;
      if (!result.has(currentIndex)) result.set(currentIndex, []);
      continue;
    }

    if (currentIndex === null) continue;
    const normalized = line.replace(/^(Choices?|Detail):\s*/i, "").trim();
    if (!normalized) continue;
    result.set(currentIndex, [...(result.get(currentIndex) || []), normalized]);
  }

  return result;
}

function isDuplicateAskUserEvent(events: any[], askIndex: number): boolean {
  const current = events[askIndex];
  const currentId = current?.data?.questionId || current?.data?.id || null;
  const currentQuestion = normalizePromptText(current?.data?.question || "");
  if (!currentQuestion && !currentId) return false;

  for (let i = askIndex - 1; i >= 0; i -= 1) {
    const event = events[i];
    if (!event) continue;
    if (event.type === "run_divider") break;
    if (event.type !== "askUser") continue;

    if (askUserEventsMatch(current, event)) return true;
  }

  return false;
}

function hasAskUserEvent(events: any[] | undefined, prompt: PendingQuestionPrompt): boolean {
  const timeline = events ?? [];
  return timeline.some((event) => event?.type === "askUser" && promptMatchesAskUserEvent(prompt, event));
}

function hasOpenAskUserEvent(events: any[] | undefined, prompt: PendingQuestionPrompt): boolean {
  const timeline = events ?? [];
  return timeline.some((event, index) =>
    event?.type === "askUser"
    && promptMatchesAskUserEvent(prompt, event)
    && !isDuplicateAskUserEvent(timeline, index)
    && !findAnswerForAskUser(timeline, index),
  );
}

function appendTimelineEvent(events: any[] | undefined, event: any): any[] {
  const timeline = events ?? [];

  if (event?.type === "askUser") {
    const prompt: PendingQuestionPrompt = {
      id: (event?.data?.questionId as string | undefined) || (event?.data?.id as string | undefined) || null,
      question: event?.data?.question || "",
      options: event?.data?.options || [],
      allowMultiple: event?.data?.allowMultiple === true,
      context: event?.data?.context || "",
      questions: event?.data?.questions || [],
    };

    if (prompt.question && hasAskUserEvent(timeline, prompt)) {
      return timeline;
    }
  }

  if (event?.type === "userAnswer") {
    const answer = extractAnswerText(event);
    const questionId = event?.data?.questionId || event?.data?.id || null;
    if (answer) {
      const isDuplicateAnswer = timeline.some((candidate) => {
        if (candidate?.type !== "userAnswer") return false;
        const candidateId = candidate?.data?.questionId || candidate?.data?.id || null;
        if (questionId && candidateId) return questionId === candidateId;
        return normalizePromptText(extractAnswerText(candidate) || "") === normalizePromptText(answer);
      });
      if (isDuplicateAnswer) return timeline;
    }

    const lastEvent = timeline[timeline.length - 1];
    if (
      lastEvent?.type === "userAnswer"
      && normalizePromptText(extractAnswerText(lastEvent) || "") === normalizePromptText(answer || "")
    ) {
      return timeline;
    }
  }

  return [...timeline, { ...event, timestamp: event?.timestamp || new Date().toISOString() }];
}

function ensurePromptTimelineEvent(events: any[] | undefined, prompt: PendingQuestionPrompt | null | undefined): any[] {
  if (!prompt?.question) return events ?? [];
  if (hasOpenAskUserEvent(events, prompt)) return events ?? [];

  return appendTimelineEvent(events, {
    type: "askUser",
    data: {
      questionId: prompt.id || undefined,
      id: prompt.id || undefined,
      question: prompt.question,
      options: prompt.options || [],
      allowMultiple: prompt.allowMultiple === true,
      context: prompt.context || "",
      questions: prompt.questions || [],
    },
  });
}

function PendingQuestionCard({
  prompt,
  promptKey,
  onSubmit,
}: {
  prompt: PendingQuestionPrompt;
  promptKey: string;
  onSubmit: (answer: string) => Promise<void>;
}) {
  const questionnaire = buildGuidedQuestionnaire(prompt);
  const hasQuestionnaire = Boolean(questionnaire && questionnaire.questions.length > 0);
  const topLevelAllowsMultiple = !hasQuestionnaire
    && (prompt.options?.length ?? 0) > 0
    && allowsMultipleSelection(prompt.question, prompt.allowMultiple);
  const quickBypassOptions = hasQuestionnaire
    ? (prompt.options ?? []).filter((option) => DEFAULTS_PATTERN.test(option))
    : [];
  const [customAnswer, setCustomAnswer] = useState("");
  const [topLevelSelections, setTopLevelSelections] = useState<string[]>([]);
  const [responses, setResponses] = useState<Record<string, GuidedResponse>>({});
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    setCustomAnswer("");
    setTopLevelSelections([]);
    setResponses({});
    setIsSubmitting(false);
  }, [promptKey]);

  const submitAnswer = useCallback(async (answer: string) => {
    if (!answer.trim() || isSubmitting) return;
    setIsSubmitting(true);
    try {
      await onSubmit(answer.trim());
    } finally {
      setIsSubmitting(false);
    }
  }, [isSubmitting, onSubmit]);

  const toggleTopLevelSelection = useCallback((option: string) => {
    setTopLevelSelections((prev) =>
      prev.includes(option)
        ? prev.filter((candidate) => candidate !== option)
        : [...prev, option],
    );
  }, []);

  const submitTopLevelMultiSelect = useCallback(async () => {
    const detail = customAnswer.trim();
    if (topLevelSelections.length === 0 && !detail) return;
    await submitAnswer(compileMultiSelectAnswer(prompt, topLevelSelections, detail));
  }, [customAnswer, prompt, submitAnswer, topLevelSelections]);

  const canSubmitGuided = questionnaire
    ? questionnaire.questions.every((question) => {
      const response = responses[question.id];
      return Boolean(response?.choice || response?.choices?.length || response?.detail.trim());
    })
    : false;

  return (
    <div className="w-full rounded-lg border border-warning/25 bg-warning/[0.045] p-2.5 text-xs">
      <div className="flex items-center gap-1.5 text-[11px] font-medium text-warning">
        <AlertTriangle className="h-3 w-3" />
        Agent needs your input
      </div>
      {prompt.context && (
        <p className="mt-1 text-[11px] leading-relaxed text-fg/50">{prompt.context}</p>
      )}

      {!hasQuestionnaire && (
        <>
          <div className="mt-2 rounded-md border border-line/50 bg-bg/30 p-2 text-xs leading-relaxed text-fg/85">
            <MarkdownRenderer content={prompt.question} />
          </div>

          {prompt.options && prompt.options.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {prompt.options.map((option, index) => (
                <button
                  key={`${option}-${index}`}
                  type="button"
                  disabled={isSubmitting}
                  onClick={() => topLevelAllowsMultiple ? toggleTopLevelSelection(option) : void submitAnswer(option)}
                  className={cn(
                    "inline-flex max-w-full items-start gap-1.5 rounded-md border px-2 py-1 text-left text-[11px] font-medium transition-colors",
                    topLevelAllowsMultiple && topLevelSelections.includes(option)
                      ? "border-accent bg-accent text-white"
                      : DEFAULTS_PATTERN.test(option)
                      ? "border-line/60 bg-bg/40 text-fg/75 hover:bg-bg/60"
                      : "border-accent/30 bg-accent/5 text-accent hover:bg-accent/10",
                  )}
                >
                  {topLevelAllowsMultiple && (
                    topLevelSelections.includes(option)
                      ? <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                      : <Square className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  )}
                  <span className="min-w-0 break-words">{option}</span>
                </button>
              ))}
            </div>
          )}

          <div className="mt-2 space-y-2">
            <Textarea
              value={customAnswer}
              onChange={(e) => setCustomAnswer(e.target.value)}
              placeholder="Type your answer..."
              className="min-h-20 text-xs"
            />
            <div className="flex justify-end">
              <Button
                size="sm"
                onClick={() => topLevelAllowsMultiple ? void submitTopLevelMultiSelect() : void submitAnswer(customAnswer)}
                disabled={isSubmitting || (topLevelAllowsMultiple ? topLevelSelections.length === 0 && !customAnswer.trim() : !customAnswer.trim())}
              >
                {isSubmitting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
                {topLevelAllowsMultiple ? "Submit Selections" : "Send Answer"}
              </Button>
            </div>
          </div>
        </>
      )}

      {hasQuestionnaire && questionnaire && (
        <div className="mt-2 space-y-2">
          <div className="rounded-md border border-line/50 bg-bg/30 p-2 text-xs leading-relaxed text-fg/85">
            <MarkdownRenderer content={questionnaire.summary} />
          </div>

          {questionnaire.questions.map((question, index) => {
            const response = responses[question.id] ?? { detail: "" };
            const selectedChoices = response.choices && response.choices.length > 0
              ? response.choices
              : response.choice
                ? [response.choice]
                : [];
            return (
              <div key={question.id} className="space-y-1.5 rounded-md border border-line/50 bg-bg/20 p-2">
                <div className="text-[9px] font-medium uppercase tracking-wider text-fg/35">
                  Question {index + 1}
                </div>
                <p className="text-xs leading-relaxed text-fg/85">{question.prompt}</p>
                {question.context && (
                  <p className="text-[11px] text-fg/50">{question.context}</p>
                )}
                <div className="flex flex-wrap gap-1.5">
                  {question.options.map((option) => (
                    <button
                      key={option}
                      type="button"
                      disabled={isSubmitting}
                      onClick={() => {
                        setResponses((prev) => ({
                          ...prev,
                          [question.id]: {
                            ...prev[question.id],
                            choice: question.allowMultiple ? undefined : option,
                            choices: question.allowMultiple
                              ? (selectedChoices.includes(option)
                                ? selectedChoices.filter((candidate) => candidate !== option)
                                : [...selectedChoices, option])
                              : undefined,
                            detail: prev[question.id]?.detail ?? "",
                          },
                        }));
                      }}
                      className={cn(
                        "inline-flex max-w-full items-start gap-1.5 rounded-md border px-2 py-1 text-left text-[11px] font-medium transition-colors",
                        selectedChoices.includes(option)
                          ? "border-accent bg-accent text-white"
                          : "border-accent/30 bg-accent/5 text-accent hover:bg-accent/10",
                      )}
                    >
                      {question.allowMultiple && (
                        selectedChoices.includes(option)
                          ? <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                          : <Square className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                      )}
                      <span className="min-w-0 break-words">{option}</span>
                    </button>
                  ))}
                </div>
                <Textarea
                  value={response.detail}
                  onChange={(e) => {
                    const value = e.target.value;
                    setResponses((prev) => ({
                      ...prev,
                      [question.id]: {
                        ...prev[question.id],
                        choice: prev[question.id]?.choice,
                        choices: prev[question.id]?.choices,
                        detail: value,
                      },
                    }));
                  }}
                  placeholder={question.placeholder}
                  className="min-h-16 text-xs"
                />
              </div>
            );
          })}

          {quickBypassOptions.length > 0 && (
            <div className="space-y-2">
              <div className="text-[10px] font-medium uppercase tracking-wider text-fg/35">
                Quick actions
              </div>
              <div className="flex flex-wrap gap-2">
                {quickBypassOptions.map((option, index) => (
                  <button
                    key={`${option}-${index}`}
                    type="button"
                    disabled={isSubmitting}
                    onClick={() => void submitAnswer(option)}
                    className="rounded-md border border-line/60 bg-bg/40 px-2 py-1 text-[11px] font-medium text-fg/75 transition-colors hover:bg-bg/60"
                  >
                    {option}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="flex justify-end">
            <Button
              size="sm"
              onClick={() => void submitAnswer(compileGuidedAnswer(questionnaire, responses))}
              disabled={isSubmitting || !canSubmitGuided}
            >
              {isSubmitting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
              Submit Answers
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

function QuestionTranscriptCard({
  prompt,
  answer,
}: {
  prompt: PendingQuestionPrompt;
  answer?: string | null;
}) {
  const questionnaire = buildGuidedQuestionnaire(prompt);
  const guidedAnswers = parseGuidedAnswer(answer);
  const hasGuidedAnswers = guidedAnswers.size > 0;

  return (
    <div className="w-full space-y-2 rounded-lg border border-warning/20 bg-warning/[0.035] p-2.5 text-xs">
      <div className="flex items-center gap-1.5 text-[11px] font-medium text-warning">
        <AlertTriangle className="h-3 w-3" />
        Agent asked for input
      </div>
      {prompt.context && (
        <p className="text-[11px] text-fg/50">{prompt.context}</p>
      )}
      <div className="rounded-md border border-line/50 bg-bg/30 p-2 text-xs text-fg/85">
        <MarkdownRenderer content={questionnaire?.summary || prompt.question} />
      </div>
      {questionnaire && questionnaire.questions.length > 0 && (
        <div className="space-y-1.5">
          {questionnaire.questions.map((question, index) => {
            const responseLines = guidedAnswers.get(index) || [];
            return (
              <div key={question.id} className="rounded-md border border-line/40 bg-bg/20 px-2 py-1.5">
                <div className="text-[9px] font-medium uppercase tracking-wider text-fg/35">
                  Question {index + 1}
                </div>
                <p className="mt-0.5 text-xs leading-relaxed text-fg/85">{question.prompt}</p>
                {responseLines.length > 0 && (
                  <div className="mt-1.5 flex flex-wrap gap-1">
                    {responseLines.map((line, answerIndex) => (
                      <span
                        key={`${question.id}-answer-${answerIndex}`}
                        className="max-w-full rounded-md border border-success/20 bg-success/[0.08] px-1.5 py-0.5 text-[11px] font-medium leading-snug text-success/90"
                      >
                        {line}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
      {answer && (!questionnaire || !hasGuidedAnswers) && (
        <div className="rounded-md border border-line/50 bg-bg/30 p-2">
          <div className="text-[9px] font-medium uppercase tracking-wider text-fg/35">
            Human answer
          </div>
          <div className="mt-1 whitespace-pre-wrap text-xs leading-relaxed text-fg/85">
            <MarkdownRenderer content={answer} />
          </div>
        </div>
      )}
      {!answer && (
        <div className="rounded-md border border-warning/20 bg-warning/[0.05] px-2 py-1.5 text-[11px] font-medium text-warning">
          Waiting for answer
        </div>
      )}
    </div>
  );
}

interface IngestionDoc {
  id: string;
  fileName: string;
  fileType: string;
  documentType: string;
  pageCount: number;
  hasText: boolean;
  /** "azure_di" | "local" | other future providers, or null if pending. */
  extractionProvider: string | null;
  /** "pending" | "extracted" | "text_only" | "failed". */
  extractionState: "pending" | "extracted" | "text_only" | "failed";
  status?: "queued" | "extracting" | "classifying" | "chunking" | "complete" | "failed" | "pending";
  stage?: string;
  progress?: number;
  size?: number;
  sourcePath?: string | null;
  error?: string | null;
  updatedAt?: string | null;
}

interface IngestionSummary {
  total: number;
  extracted: number;
  pending: number;
  failed: number;
}

const READY_INGESTION_STATUSES: ReadonlySet<string> = new Set([
  "ready",
  "review",
  "quoted",
  "estimating",
]);

function ingestionProviderLabel(provider: string | null): string {
  if (!provider) return "Pending";
  if (provider === "azure_di") return "Azure DI";
  if (provider === "local") return "Local PDF parser";
  if (provider === "vision_required") return "Vision required";
  // Future providers (textract, llamaparse, ocr, …) get a Title Cased label.
  return provider
    .split(/[_-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

const OPENUI_FENCED_RE = /```openui\n([\s\S]*?)```/g;
const OPENUI_RAW_RE = /^root\s*=\s*[A-Z]\w*\(/m;

function splitOpenUI(text: string, streaming = false): { type: "text" | "openui"; content: string }[] {
  const parts: { type: "text" | "openui"; content: string }[] = [];
  let lastIdx = 0;
  let match: RegExpExecArray | null;
  const fencedRe = new RegExp(OPENUI_FENCED_RE.source, "g");

  while ((match = fencedRe.exec(text)) !== null) {
    if (match.index > lastIdx) {
      const plain = text.slice(lastIdx, match.index).trim();
      if (plain) parts.push({ type: "text", content: plain });
    }
    parts.push({ type: "openui", content: match[1].trim() });
    lastIdx = match.index + match[0].length;
  }

  if (lastIdx < text.length) {
    const tail = text.slice(lastIdx).trim();
    if (tail) parts.push({ type: "text", content: tail });
  }

  if (parts.length > 0) return parts;

  if (streaming) {
    const incompleteFence = text.match(/^([\s\S]*?)```openui\n([\s\S]*)$/i);
    if (incompleteFence) {
      const before = incompleteFence[1].trim();
      const openUIContent = incompleteFence[2].trim();
      if (before) parts.push({ type: "text", content: before });
      if (openUIContent) parts.push({ type: "openui", content: openUIContent });
      return parts.length > 0 ? parts : [{ type: "text", content: text }];
    }
  }

  const rawRootIndex = text.search(/^root\s*=\s*[A-Z]\w*\(/m);
  if (rawRootIndex >= 0 && OPENUI_RAW_RE.test(text)) {
    const before = text.slice(0, rawRootIndex).trim();
    const openUIContent = text.slice(rawRootIndex).trim();
    if (before) parts.push({ type: "text", content: before });
    parts.push({ type: "openui", content: openUIContent });
    return parts;
  }

  return [{ type: "text", content: text }];
}

function StreamingMarkdown({ content, streamKey, active = false }: { content: string; streamKey: string; active?: boolean }) {
  const [visible, setVisible] = useState(active ? "" : content);

  useEffect(() => {
    if (!active) {
      setVisible(content);
      return;
    }

    setVisible("");
    let index = 0;
    const step = Math.max(3, Math.ceil(content.length / 120));
    const timer = window.setInterval(() => {
      index = Math.min(content.length, index + step);
      setVisible(content.slice(0, index));
      if (index >= content.length) window.clearInterval(timer);
    }, 18);

    return () => window.clearInterval(timer);
  }, [active, content, streamKey]);

  const parts = splitOpenUI(visible || (active ? "" : content), active);
  return (
    <div className="space-y-2">
      {parts.map((part, index) => {
        if (part.type === "openui") {
          return (
            <div key={`openui-${index}`} className="overflow-hidden rounded-lg border border-accent/20 bg-bg/40 p-2">
              <Renderer library={bidwrightOpenUILibrary as any} response={part.content} isStreaming={active} />
            </div>
          );
        }
        return <MarkdownRenderer key={`text-${index}`} content={part.content} />;
      })}
      {active && visible.length < content.length && (
        <span className="inline-block h-3 w-1 animate-pulse rounded-full bg-accent align-middle" />
      )}
    </div>
  );
}

function tryParseJson(value: unknown): unknown {
  if (typeof value !== "string") return value;
  const trimmed = value.trim();
  if (!trimmed) return value;
  if (!(trimmed.startsWith("{") || trimmed.startsWith("["))) return value;
  try {
    return JSON.parse(trimmed);
  } catch {
    return value;
  }
}

function extractStructuredToolResult(raw: unknown, resultEnvelope?: Record<string, unknown>) {
  const parsed = tryParseJson(raw);
  const images: ToolResultImage[] = [];
  const textBlocks: string[] = [];
  const jsonObjects: Record<string, unknown>[] = [];

  const visit = (value: unknown) => {
    const parsedValue = tryParseJson(value);
    if (typeof parsedValue === "string") {
      textBlocks.push(parsedValue);
      return;
    }
    if (Array.isArray(parsedValue)) {
      for (const entry of parsedValue) visit(entry);
      return;
    }
    if (!parsedValue || typeof parsedValue !== "object") return;

    const record = parsedValue as Record<string, any>;
    if (Array.isArray(record.content)) {
      visit(record.content);
      return;
    }
    if ((record.type === "image" || record.mimeType || record.data) && typeof record.data === "string") {
      const mimeType = String(record.mimeType || "image/png");
      images.push({
        imageUrl: record.data.startsWith("data:") ? record.data : `data:${mimeType};base64,${record.data}`,
        mimeType,
        label: typeof record.label === "string" ? record.label : undefined,
      });
      return;
    }
    if (record.imageUrl || record.image) {
      images.push({
        imageUrl: String(record.imageUrl || record.image),
        mimeType: String(record.mimeType || "image/png"),
        label: typeof record.label === "string" ? record.label : undefined,
      });
    }
    if (record.type === "text" && typeof record.text === "string") {
      const textPayload = tryParseJson(record.text);
      if (textPayload && typeof textPayload === "object" && !Array.isArray(textPayload)) {
        jsonObjects.push(textPayload as Record<string, unknown>);
      } else {
        textBlocks.push(record.text);
      }
      return;
    }
    jsonObjects.push(record);
  };

  visit(parsed);

  const primaryObject =
    jsonObjects.find((entry) => !!(entry as any).uiEvent) ||
    jsonObjects.find((entry) => !!(entry as any).success || !!(entry as any).message) ||
    (parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : null);
  const uiEvent = ((primaryObject as any)?.uiEvent || (primaryObject as any)?.bidwrightUiEvent || null) as AgentUiEvent | null;
  const sideEffects = Array.isArray((primaryObject as any)?.sideEffects)
    ? (primaryObject as any).sideEffects.map(String)
    : uiEvent?.kind ? [uiEvent.kind] : undefined;
  const message = typeof (primaryObject as any)?.message === "string"
    ? (primaryObject as any).message
    : textBlocks.find((entry) => entry.trim().length > 0) || null;

  return {
    data: primaryObject ?? parsed,
    images,
    text: textBlocks.join("\n\n").trim(),
    uiEvent,
    sideEffects,
    message,
    success: typeof (resultEnvelope as any)?.success === "boolean"
      ? Boolean((resultEnvelope as any).success)
      : !String(message || raw || "").toLowerCase().includes("error"),
  };
}

function buildToolResult(raw: unknown, durationMs = 0, resultEnvelope?: Record<string, unknown>): ToolCallEntry["result"] {
  const structured = extractStructuredToolResult(raw, resultEnvelope);
  return {
    success: structured.success,
    duration_ms: durationMs,
    data: structured.data,
    error: typeof (resultEnvelope as any)?.error === "string" ? String((resultEnvelope as any).error) : undefined,
    sideEffects: structured.sideEffects,
    message: structured.message || undefined,
    uiEvent: structured.uiEvent,
    images: structured.images,
  };
}

function pairToolEvents(events: any[]): ToolCallEntry[] {
  const tools: ToolCallEntry[] = [];
  const byId = new Map<string, ToolCallEntry>();
  const closeDanglingTools = (
    completedAt?: string,
    message = "Completed",
    status: NonNullable<ToolCallEntry["status"]> = "complete",
  ) => {
    for (const tool of tools) {
      if (tool.status !== "running") continue;
      tool.completedAt = completedAt;
      tool.status = status;
      tool.result = {
        ...tool.result,
        success: status === "failed" ? false : tool.result.success,
        duration_ms: tool.result.duration_ms || 1,
        message: tool.result.message || message,
      };
    }
  };

  events.forEach((event, index) => {
    if (event?.type === "tool_call" || event?.type === "tool") {
      closeDanglingTools(event.timestamp);
      if (isAskUserToolId(event.data?.toolId)) return;
      const id = event.data?.toolUseId || `tool-${index}`;
      const entry: ToolCallEntry = {
        id,
        toolId: event.data?.toolId || "unknown",
        input: event.data?.input || {},
        startedAt: event.timestamp,
        status: "running",
        result: { success: true, duration_ms: 0 },
      };
      tools.push(entry);
      byId.set(id, entry);
      return;
    }

    if (event?.type === "tool_result") {
      const id = event.data?.toolUseId;
      const match = (id && byId.get(id)) || [...tools].reverse().find((tool) => tool.status === "running") || tools[tools.length - 1];
      if (!match) return;
      match.completedAt = event.timestamp;
      match.status = event.data?.success === false ? "failed" : "complete";
      match.result = buildToolResult(event.data?.content ?? event.data, Number(event.data?.duration_ms) || 0, event.data);
      if (!match.result.uiEvent) {
        match.result.uiEvent = inferUiEventFromTool(match.toolId, match.input, match.result.data);
      }
      if (!match.result.sideEffects?.length && match.result.uiEvent?.kind) {
        match.result.sideEffects = [match.result.uiEvent.kind];
      }
    }

    const terminalStatus = event?.type === "status" && ["completed", "stopped", "failed"].includes(String(event?.data?.status || ""));
    if (terminalStatus) {
      const status = String(event?.data?.status || "");
      closeDanglingTools(
        event.timestamp,
        status === "failed" ? "Run failed" : status === "stopped" ? "Run stopped" : "Completed",
        status === "failed" ? "failed" : status === "stopped" ? "stopped" : "complete",
      );
      return;
    }

    if (event?.type === "message" || event?.type === "askUser" || event?.type === "run_divider") {
      closeDanglingTools(event.timestamp);
    }
  });

  return tools;
}

function toolEntryFromTimelineEvent(event: any, index: number): ToolCallEntry {
  return {
    id: event.data?.toolUseId || `tool-${index}`,
    toolId: event.data?.toolId || "unknown",
    input: event.data?.input || {},
    startedAt: event.timestamp,
    status: "running",
    result: { success: true, duration_ms: 0 },
  };
}

function toolStatusLabel(tool: ToolCallEntry) {
  if (tool.status === "running") return "Running now";
  if (tool.status === "stopped") return tool.result.message || "Stopped before result";
  if (tool.status === "failed" || tool.result.success === false) return tool.result.error || tool.result.message || "Failed";
  if (tool.result.message) return tool.result.message;
  return tool.result.duration_ms > 0 ? `Finished in ${formatDuration(tool.result.duration_ms)}` : "Finished";
}

function navigationIntentFromTool(tool: ToolCallEntry): AgentNavigationIntent | null {
  const ui = tool.result.uiEvent || inferUiEventFromTool(tool.toolId, tool.input, tool.result.data);
  const kind = String(ui?.kind || "");
  const name = baseToolName(tool.toolId);
  const input = tool.input as any;

  if (kind === "quote.updated" || name === "updateQuote") {
    const fields = Array.isArray(ui?.fields) ? ui.fields.map(String) : Object.keys(input || {});
    const field = fields.includes("notes")
      ? "notes"
      : fields.includes("description") || fields.includes("projectName") || fields.includes("clientName")
        ? "description"
        : "title";
    return { type: "setup", field, label: tool.result.message || "Quote updated" };
  }
  if ((kind === "worksheet.created" || kind === "worksheet.updated") && ui?.worksheetId) {
    return { type: "worksheet", worksheetId: String(ui.worksheetId), label: tool.result.message || "Worksheet updated" };
  }
  if (
    kind === "worksheet_item.created" ||
    kind === "worksheet_item.updated" ||
    name === "createWorksheetItem" ||
    name === "createWorksheetItemFromCandidate" ||
    name === "updateWorksheetItem"
  ) {
    return {
      type: "worksheet",
      worksheetId: ui?.worksheetId ? String(ui.worksheetId) : input?.worksheetId ? String(input.worksheetId) : undefined,
      itemId: ui?.itemId ? String(ui.itemId) : input?.itemId ? String(input.itemId) : undefined,
      label: tool.result.message || "Line item updated",
    };
  }
  if (kind === "summary_preset.applied") return { type: "summarize", label: tool.result.message || "Summary updated" };
  if (ui?.documentId) return { type: "document", documentId: String(ui.documentId), label: tool.result.message || "Document opened" };
  return null;
}

function baseToolName(toolId: string) {
  if (!toolId) return "unknown";
  return normalizeAgentToolId(toolId) || "unknown";
}

function isAskUserToolId(toolId: unknown) {
  const raw = typeof toolId === "string" ? toolId : "";
  const name = baseToolName(raw);
  return name === "askUser" || raw === "askUser" || raw.endsWith("__askUser");
}

function humanToolName(toolId: string) {
  return getAgentToolDisplayName(toolId);
}

function formatDuration(ms?: number) {
  if (!ms) return "live";
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function inferUiEventFromTool(toolId: string, input: unknown, data: unknown): AgentUiEvent | null {
  const name = baseToolName(toolId);
  const body = input && typeof input === "object" && !Array.isArray(input) ? input as Record<string, any> : {};
  const result = data && typeof data === "object" && !Array.isArray(data) ? data as Record<string, any> : {};

  if (name === "updateQuote") {
    return {
      kind: "quote.updated",
      fields: Object.keys(body),
      descriptionUpdated: Boolean(body.description),
      notesUpdated: Boolean(body.notes),
      projectName: body.projectName ?? null,
      clientName: body.clientName ?? null,
    };
  }

  if (name === "createWorksheet") {
    const worksheetId = result.worksheetId || result.id || result.worksheet?.id;
    return {
      kind: "worksheet.created",
      worksheetId: worksheetId ? String(worksheetId) : undefined,
      name: body.name,
      path: body.folderPath ? `${body.folderPath} / ${body.name || "Worksheet"}` : body.name,
    };
  }

  if (name === "createWorksheetItem" || name === "createWorksheetItemFromCandidate") {
    const createdItemId = result.createdItemId || result.itemId || result.item?.id || result.worksheetItem?.id;
    const createdItem = result.item || result.worksheetItem || {};
    return {
      kind: "worksheet_item.created",
      worksheetId: body.worksheetId ? String(body.worksheetId) : createdItem.worksheetId ? String(createdItem.worksheetId) : undefined,
      itemId: createdItemId ? String(createdItemId) : undefined,
      entityName: body.entityName || createdItem.entityName,
      category: body.category || createdItem.category,
      quantity: body.quantity ?? createdItem.quantity,
      uom: body.uom || createdItem.uom,
      unitCost: body.cost ?? createdItem.cost,
      unitPrice: body.price ?? createdItem.price,
    };
  }

  if (name === "updateWorksheetItem") {
    const itemId = body.itemId || result.itemId || result.item?.id || result.worksheetItem?.id;
    const item = result.item || result.worksheetItem || {};
    return {
      kind: "worksheet_item.updated",
      worksheetId: body.worksheetId ? String(body.worksheetId) : item.worksheetId ? String(item.worksheetId) : undefined,
      itemId: itemId ? String(itemId) : undefined,
      entityName: body.entityName || item.entityName,
      category: body.category || item.category,
      quantity: body.quantity ?? item.quantity,
      uom: body.uom || item.uom,
      unitCost: body.cost ?? item.cost,
      unitPrice: body.price ?? item.price,
      fields: Object.keys(body).filter((key) => key !== "itemId"),
    };
  }

  if (name === "applySummaryPreset" || name === "createSummaryRow" || name === "updateSummaryRow") {
    return { kind: "summary_preset.applied", preset: body.preset || body.name || name };
  }

  return null;
}

function isExpectedIngestionStartError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error || "");
  return message.includes("/api/cli/start")
    && message.includes("409")
    && message.toLowerCase().includes("document extraction");
}

function IngestionGate({
  docs,
  summary,
  job,
  ingestionStatus,
}: {
  docs: IngestionDoc[];
  summary: IngestionSummary;
  job?: any;
  ingestionStatus: string | null;
}) {
  const total = summary.total || docs.length || 1;
  const complete = summary.extracted || docs.filter((doc: any) => doc.status === "complete" || doc.extractionState === "extracted").length;
  const failed = summary.failed || docs.filter((doc: any) => doc.status === "failed").length;
  const jobProgress = typeof job?.progress === "number" ? Math.min(100, Math.max(0, job.progress)) : Math.round((complete / total) * 100);
  const currentName = job?.currentDocumentName || docs.find((doc: any) => doc.status === "extracting" || doc.status === "classifying")?.fileName;
  const activeDoc = docs.find((doc: any) => doc.fileName === currentName)
    || docs.find((doc: any) => doc.status === "extracting" || doc.status === "classifying" || doc.status === "chunking")
    || docs.find((doc: any) => doc.extractionState !== "extracted" && doc.status !== "failed");
  const activeStage = activeDoc?.stage || job?.stage || "Analyzing";
  const pending = Math.max(0, summary.pending || total - complete - failed);
  const visibleDocs = docs.slice(0, 6);

  return (
    <div className="relative flex h-full min-h-0 flex-col overflow-hidden rounded-lg border border-line bg-panel p-4 shadow-inner">
      <div className="pointer-events-none absolute inset-0 opacity-60 [background-image:linear-gradient(to_right,hsl(var(--accent)/0.08)_1px,transparent_1px),linear-gradient(to_bottom,hsl(var(--fg)/0.045)_1px,transparent_1px)] [background-size:34px_34px]" />
      <motion.div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-16 bg-gradient-to-b from-accent/10 to-transparent"
        animate={{ opacity: [0.22, 0.55, 0.22] }}
        transition={{ duration: 2.4, repeat: Infinity, ease: "easeInOut" }}
      />

      <div className="relative z-10 flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-accent/25 bg-accent/10">
            <FileCheck2 className="h-5 w-5 text-accent" />
          </div>
          <div className="min-w-0">
            <div className="text-sm font-semibold text-fg">Analyzing package</div>
            <div className="truncate text-[11px] text-fg/45">{activeDoc?.fileName || job?.message || "Opening documents"}</div>
          </div>
        </div>
        <Badge tone={failed > 0 ? "danger" : "info"} className="shrink-0 text-[10px]">
          {ingestionStatus || "processing"}
        </Badge>
      </div>

      <div className="relative z-10 grid min-h-0 flex-1 grid-rows-[1fr_auto] gap-4 py-4">
        <div className="relative flex min-h-0 items-center justify-center overflow-hidden rounded-lg border border-line bg-bg/35 shadow-[inset_0_1px_0_hsl(var(--fg)/0.04)]">
          <div className="absolute inset-x-5 top-5 flex items-center justify-between text-[10px] font-semibold uppercase text-fg/35">
            <span>{activeStage}</span>
            <span>{complete}/{total} ready</span>
          </div>

          {visibleDocs.map((doc, index) => {
            const left = 18 + (index % 3) * 25;
            const delay = index * 0.42;
            return (
              <motion.div
                key={doc.id || `${doc.fileName}-${index}`}
                className="absolute top-1/2 flex h-11 w-36 items-center gap-2 rounded-md border border-line bg-panel/95 px-2 shadow-[0_10px_28px_rgba(0,0,0,0.14)]"
                style={{ left: `${left}%` }}
                initial={false}
                animate={{ y: [-110, -12, 104], opacity: [0, 1, 0], scale: [0.88, 1, 0.94] }}
                transition={{ duration: 3.5, repeat: Infinity, delay, ease: "easeInOut" }}
              >
                <FileText className="h-3.5 w-3.5 shrink-0 text-accent" />
                <span className="truncate text-[10px] font-medium text-fg/65">{doc.fileName}</span>
              </motion.div>
            );
          })}

          <motion.div
            className="relative flex h-44 w-44 items-center justify-center rounded-lg border border-accent/25 bg-panel shadow-xl shadow-black/10"
            animate={{ y: [0, -5, 0] }}
            transition={{ duration: 2.8, repeat: Infinity, ease: "easeInOut" }}
          >
            <motion.div
              className="absolute inset-3 rounded-lg border border-accent/20"
              animate={{ scale: [0.96, 1.04, 0.96], opacity: [0.35, 0.85, 0.35] }}
              transition={{ duration: 2.1, repeat: Infinity, ease: "easeInOut" }}
            />
            <motion.div
              className="absolute left-5 right-5 top-10 h-1 rounded-full bg-accent/70 shadow-[0_0_24px_hsl(var(--accent)/0.35)]"
              animate={{ y: [0, 80, 0] }}
              transition={{ duration: 2.4, repeat: Infinity, ease: "easeInOut" }}
            />
            <div
              className="flex h-28 w-28 items-center justify-center rounded-full p-2"
              style={{ background: `conic-gradient(hsl(var(--accent)) ${jobProgress * 3.6}deg, rgba(148, 163, 184, 0.18) 0deg)` }}
            >
              <div className="flex h-full w-full flex-col items-center justify-center rounded-full bg-panel text-center">
                <div className="text-3xl font-semibold tabular-nums text-fg">{jobProgress}%</div>
                <div className="mt-1 text-[9px] font-semibold uppercase text-fg/35">Intake</div>
              </div>
            </div>
          </motion.div>

          <div className="absolute inset-x-5 bottom-5">
            <div className="flex items-center justify-between gap-3 text-[11px] text-fg/45">
              <span className="truncate">{activeDoc?.fileName || "Preparing package"}</span>
              <span className="shrink-0 tabular-nums">{pending} pending</span>
            </div>
            <div className="mt-2 h-2 overflow-hidden rounded-full bg-fg/10">
              <motion.div
                className="h-full rounded-full bg-accent"
                initial={{ width: 0 }}
                animate={{ width: `${jobProgress}%` }}
                transition={{ type: "spring", stiffness: 120, damping: 22 }}
              />
            </div>
          </div>
        </div>

        <div className="grid grid-cols-3 gap-2">
          <div className="rounded-lg border border-line bg-panel2/45 px-3 py-2">
            <div className="text-[9px] font-semibold uppercase text-fg/30">Ready</div>
            <div className="mt-1 text-lg font-semibold tabular-nums text-success">{complete}</div>
          </div>
          <div className="rounded-lg border border-line bg-panel2/45 px-3 py-2">
            <div className="text-[9px] font-semibold uppercase text-fg/30">Pending</div>
            <div className="mt-1 text-lg font-semibold tabular-nums text-accent">{pending}</div>
          </div>
          <div className="rounded-lg border border-line bg-panel2/45 px-3 py-2">
            <div className="text-[9px] font-semibold uppercase text-fg/30">Failed</div>
            <div className={cn("mt-1 text-lg font-semibold tabular-nums", failed > 0 ? "text-danger" : "text-fg/45")}>{failed}</div>
          </div>
        </div>
      </div>
    </div>
  );
}

function formatMoney(value: unknown) {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return `$${value.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
}

function toolDisplayMeta(tool: ToolCallEntry) {
  const ui = tool.result.uiEvent;
  const kind = String(ui?.kind || "");
  const name = baseToolName(tool.toolId);
  const input = tool.input as any;

  if (kind === "quote.updated") {
    return {
      Icon: ClipboardList,
      title: "Update quote",
      detail: Array.isArray(ui?.fields) ? ui.fields.join(", ") : "Project setup changed",
      tone: "success" as const,
      actionLabel: "Open setup",
    };
  }

  if (kind === "worksheet.created" || kind === "worksheet.updated") {
    return {
      Icon: Layers3,
      title: kind === "worksheet.created" ? "Create worksheet" : "Update worksheet",
      detail: String(ui?.path || ui?.name || input?.worksheetId || "Worksheet"),
      tone: "accent" as const,
      actionLabel: "Open worksheet",
    };
  }

  if (kind === "worksheet_item.created" || kind === "worksheet_item.updated") {
    const created = kind === "worksheet_item.created";
    return {
      Icon: Table2,
      title: created ? humanToolName("createWorksheetItem") : humanToolName("updateWorksheetItem"),
      detail: `${ui?.entityName || tool.result.message || ui?.category || "Estimate row"}${ui?.quantity ? ` / ${ui.quantity} ${ui.uom || ""}` : ""}`,
      tone: "accent" as const,
      actionLabel: "Open row",
    };
  }

  if (kind === "summary_preset.applied") {
    return {
      Icon: Gauge,
      title: humanToolName("applySummaryPreset"),
      detail: String(ui?.preset || "Preset applied"),
      tone: "accent" as const,
      actionLabel: null,
    };
  }

  if (name === "readDocumentText" || name === "getBookPage") {
    return {
      Icon: BookOpen,
      title: name === "getBookPage" ? "Read reference book" : "Read document",
      detail: String(input?.documentId || input?.bookId || input?.fileName || "Project source"),
      tone: "neutral" as const,
      actionLabel: null,
    };
  }

  if (tool.result.images?.length) {
    return {
      Icon: FileImage,
      title: "Viewed drawing",
      detail: tool.result.images[0]?.label || name,
      tone: "neutral" as const,
      actionLabel: null,
    };
  }

  return {
    Icon: Wrench,
    title: humanToolName(tool.toolId),
    detail: toolStatusLabel(tool),
    tone: "neutral" as const,
    actionLabel: null,
  };
}

function toolToneClass(tone: "success" | "accent" | "neutral", status?: ToolCallEntry["status"], success = true) {
  if (status === "running") return "border-accent/30 bg-accent/10 text-accent";
  if (status === "stopped") return "border-warning/25 bg-warning/10 text-warning";
  if (status === "failed" || !success) return "border-danger/25 bg-danger/10 text-danger";
  if (tone === "success") return "border-success/25 bg-success/10 text-success";
  if (tone === "accent") return "border-accent/25 bg-accent/10 text-accent";
  return "border-line/70 bg-panel2 text-fg/45";
}

function ToolStatusIcon({ tool, className }: { tool: ToolCallEntry; className?: string }) {
  if (tool.status === "running") return <Loader2 className={cn("animate-spin", className)} />;
  if (tool.status === "stopped") return <Square className={className} />;
  if (tool.status === "failed" || tool.result.success === false) return <XCircle className={className} />;
  return <CheckCircle2 className={className} />;
}

function ToolExpandedContent({ tool, onNavigate }: { tool: ToolCallEntry; onNavigate?: (intent: AgentNavigationIntent) => void | Promise<void> }) {
  const ui = tool.result.uiEvent;
  const kind = String(ui?.kind || "");
  const intent = navigationIntentFromTool(tool);
  const meta = toolDisplayMeta(tool);
  const inputJson = JSON.stringify(tool.input || {}, null, 2);
  const resultJson = tool.result.data == null
    ? null
    : typeof tool.result.data === "string"
      ? tool.result.data
      : JSON.stringify(tool.result.data, null, 2);
  const metricItems = [
    ["Qty", ui?.quantity != null ? `${ui.quantity} ${ui.uom || ""}` : null],
    ["Unit cost", formatMoney(ui?.unitCost)],
    ["Unit price", formatMoney(ui?.unitPrice)],
  ].filter(([, value]) => value);

  return (
    <div className="space-y-2 pb-1 pl-7 pr-2 text-[11px]">
      {(kind === "quote.updated" || kind === "worksheet.created" || kind === "worksheet.updated" || kind === "worksheet_item.created" || kind === "worksheet_item.updated" || kind === "summary_preset.applied") && (
        <div className="rounded-md border border-line/50 bg-bg/45 px-2 py-1.5">
          <div className="flex min-w-0 items-center justify-between gap-2">
            <div className="min-w-0">
              <div className="truncate font-medium text-fg/75">{meta.title}</div>
              <div className="mt-0.5 truncate text-[10px] text-fg/35">{meta.detail}</div>
            </div>
            {intent && (
              <button
                onClick={() => void onNavigate?.(intent)}
                className="inline-flex h-6 shrink-0 items-center gap-1 rounded-md border border-line/60 bg-panel2 px-2 text-[10px] font-medium text-fg/55 hover:border-accent/25 hover:text-accent"
              >
                <Navigation className="h-3 w-3" />
                {meta.actionLabel || "Open"}
              </button>
            )}
          </div>
          {metricItems.length > 0 && (
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {metricItems.map(([label, value]) => (
                <span key={label} className="rounded border border-line/50 bg-panel2/60 px-1.5 py-0.5 text-[10px] text-fg/45">
                  {label}: <span className="font-medium text-fg/70">{value}</span>
                </span>
              ))}
            </div>
          )}
        </div>
      )}

      {tool.result.images?.length ? (
        <div className="grid gap-2 sm:grid-cols-2">
          {tool.result.images.slice(0, 2).map((image, index) => (
            <div key={`${image.imageUrl}-${index}`} className="overflow-hidden rounded-md border border-line/60 bg-bg/45">
              <img src={image.imageUrl} alt={image.label || "Agent visual"} className="h-32 w-full object-cover" />
              {image.label && <div className="truncate px-2 py-1 text-[10px] text-fg/40">{image.label}</div>}
            </div>
          ))}
        </div>
      ) : null}

      {tool.result.error && <div className="rounded-md border border-danger/25 bg-danger/5 px-2 py-1.5 text-danger">{tool.result.error}</div>}

      <details className="group rounded-md border border-line/45 bg-bg/30">
        <summary className="flex cursor-pointer list-none items-center gap-1.5 px-2 py-1.5 text-[10px] font-medium uppercase tracking-wider text-fg/30">
          <ChevronRight className="h-3 w-3 transition-transform group-open:rotate-90" />
          Payload
        </summary>
        <div className="space-y-2 border-t border-line/40 p-2">
          <pre className="max-h-28 overflow-auto whitespace-pre-wrap break-all rounded bg-panel2/60 p-2 text-[10px] leading-relaxed text-fg/45">{inputJson}</pre>
          {resultJson && <pre className="max-h-32 overflow-auto whitespace-pre-wrap break-all rounded bg-panel2/60 p-2 text-[10px] leading-relaxed text-fg/45">{resultJson}</pre>}
        </div>
      </details>
    </div>
  );
}

function AgentToolWidget({ tool, onNavigate }: { tool: ToolCallEntry; onNavigate?: (intent: AgentNavigationIntent) => void | Promise<void> }) {
  const [expanded, setExpanded] = useState(false);
  const meta = toolDisplayMeta(tool);
  const toneClass = toolToneClass(meta.tone, tool.status, tool.result.success);

  return (
    <div className="border-line/45 first:border-t-0">
      <button
        type="button"
        className="flex w-full items-center gap-2 px-2 py-1.5 text-left transition-colors hover:bg-fg/[0.025]"
        onClick={() => setExpanded((value) => !value)}
      >
        <span className={cn("flex h-5 w-5 shrink-0 items-center justify-center rounded-md border", toneClass)}>
          <meta.Icon className="h-3 w-3" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[11px] font-medium text-fg/72">{meta.title}</span>
          <span className="block truncate text-[10px] text-fg/35">{meta.detail}</span>
        </span>
        <span className="hidden shrink-0 items-center gap-1 rounded-full border border-line/50 bg-bg/35 px-1.5 py-0.5 text-[9px] font-medium text-fg/35 sm:inline-flex">
          <ToolStatusIcon tool={tool} className="h-2.5 w-2.5" />
          {tool.status === "running" ? "live" : tool.status === "stopped" ? "stopped" : tool.status === "failed" || !tool.result.success ? "failed" : "done"}
        </span>
        {expanded ? <ChevronDown className="h-3.5 w-3.5 shrink-0 text-fg/25" /> : <ChevronRight className="h-3.5 w-3.5 shrink-0 text-fg/25" />}
      </button>
      {expanded && <ToolExpandedContent tool={tool} onNavigate={onNavigate} />}
    </div>
  );
}

function AgentToolGroup({ tools, onNavigate }: { tools: ToolCallEntry[]; onNavigate?: (intent: AgentNavigationIntent) => void | Promise<void> }) {
  const [expanded, setExpanded] = useState(false);
  const latestTool = tools[tools.length - 1];
  if (!latestTool) return null;

  const latestMeta = toolDisplayMeta(latestTool);
  const runningCount = tools.filter((tool) => tool.status === "running").length;
  const failedCount = tools.filter((tool) => tool.status === "failed" || tool.result.success === false).length;
  const stoppedCount = tools.filter((tool) => tool.status === "stopped").length;
  const summary = runningCount > 0
    ? `${runningCount} live`
    : failedCount > 0
      ? `${failedCount} failed`
      : stoppedCount > 0
        ? `${stoppedCount} stopped`
        : "done";
  const summaryTone = runningCount > 0 ? "border-accent/30 bg-accent/10 text-accent" : failedCount > 0 ? "border-danger/25 bg-danger/10 text-danger" : stoppedCount > 0 ? "border-warning/25 bg-warning/10 text-warning" : "border-success/20 bg-success/[0.08] text-success";
  const orderedTools = [...tools].reverse();

  return (
    <div className="w-full overflow-hidden rounded-lg border border-line/55 bg-panel2/25">
      <button
        type="button"
        onClick={() => setExpanded((value) => !value)}
        className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left transition-colors hover:bg-fg/[0.025]"
      >
        <span className={cn("flex h-5 w-5 shrink-0 items-center justify-center rounded-md border", summaryTone)}>
          {runningCount > 0 ? <Loader2 className="h-3 w-3 animate-spin" /> : failedCount > 0 ? <XCircle className="h-3 w-3" /> : stoppedCount > 0 ? <Square className="h-3 w-3" /> : <CheckCircle2 className="h-3 w-3" />}
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex min-w-0 items-center gap-1.5">
            <span className="shrink-0 text-[10px] font-semibold uppercase tracking-wider text-fg/35">Tool use</span>
            <span className="truncate text-[11px] font-medium text-fg/72">{latestMeta.title}</span>
          </span>
          <span className="block truncate text-[10px] text-fg/35">
            {tools.length} {tools.length === 1 ? "call" : "calls"} / {summary} / {toolStatusLabel(latestTool)}
          </span>
        </span>
        {expanded ? <ChevronDown className="h-3.5 w-3.5 shrink-0 text-fg/25" /> : <ChevronRight className="h-3.5 w-3.5 shrink-0 text-fg/25" />}
      </button>
      {expanded && (
        <div className="divide-y divide-line/45 border-t border-line/45 bg-bg/[0.22]">
          {tools.length === 1 ? (
            <div className="py-2">
              <ToolExpandedContent tool={latestTool} onNavigate={onNavigate} />
            </div>
          ) : (
            orderedTools.map((tool) => (
              <AgentToolWidget key={tool.id} tool={tool} onNavigate={onNavigate} />
            ))
          )}
        </div>
      )}
    </div>
  );
}

function AgentDockControl({ mode, onChange }: { mode: AgentDockMode; onChange: (mode: AgentDockMode) => void }) {
  const Icon = mode === "left" ? PanelLeft : mode === "bottom" ? PanelBottom : mode === "detached" ? ExternalLink : PanelRight;

  return (
    <label className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg border border-line bg-bg/45 px-2 text-[11px] font-medium text-fg/70 transition-colors hover:border-accent/30">
      <Icon className="h-3.5 w-3.5 text-fg/40" />
      <select
        value={mode}
        onChange={(event) => onChange(event.target.value as AgentDockMode)}
        className="h-full bg-transparent text-[11px] font-medium text-fg/70 outline-none"
        aria-label="Agent window position"
      >
        <option value="right">Right side</option>
        <option value="left">Left side</option>
        <option value="bottom">Bottom rail</option>
        <option value="detached">Detached</option>
      </select>
    </label>
  );
}

function NativeAgentSelect({
  value,
  onChange,
  options,
  ariaLabel,
}: {
  value: string;
  onChange: (value: string) => void;
  options: Array<{ value: string; label: string }>;
  ariaLabel: string;
}) {
  return (
    <select
      value={value}
      onChange={(event) => onChange(event.target.value)}
      aria-label={ariaLabel}
      className="h-10 w-full min-w-0 rounded-lg border border-line bg-bg/55 px-3 text-xs font-medium text-fg outline-none transition-colors hover:border-accent/30 focus:border-accent/50 focus:ring-1 focus:ring-accent/20"
    >
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  );
}

function AgentSetupDropdown({
  personas,
  selectedPersonaId,
  setSelectedPersonaId,
  cliRuntime,
  cliRuntimeMap,
  effectiveCliModel,
  setCliAgentModel,
  intakeScope,
  onScopeChange,
  intakeLoading,
  ingestionReady,
  intakeStatus,
  ingestionSummary,
  ingestionDocs,
  handleStartIntake,
}: {
  personas: EstimatorPersona[];
  selectedPersonaId: string | null;
  setSelectedPersonaId: (id: string | null) => void;
  cliRuntime: CliRuntime | null;
  cliRuntimeMap: CliRuntimeMap | null;
  effectiveCliModel: string | null;
  setCliAgentModel: (model: string) => void;
  intakeScope: string;
  onScopeChange: (value: string) => void;
  intakeLoading: boolean;
  ingestionReady: boolean;
  intakeStatus: IntakeStatusResult | null;
  ingestionSummary: IngestionSummary;
  ingestionDocs: IngestionDoc[];
  handleStartIntake: () => void | Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const selectedPersona = personas.find((persona) => persona.id === selectedPersonaId) ?? null;
  const personaOptions = [
    { value: "__none__", label: "Generic estimator" },
    ...personas.map((persona) => ({ value: persona.id, label: `${persona.name} / ${persona.trade}` })),
  ];
  const modelOptions = cliRuntime ? (() => {
    const runtimeModels = cliRuntimeMap?.[cliRuntime]?.models || [];
    const unique = runtimeModels.filter((option, index) => runtimeModels.findIndex((candidate) => candidate.id === option.id) === index);
    const selectedModel = effectiveCliModel || defaultCliModel(cliRuntime, cliRuntimeMap);
    const displayOptions = unique.some((option) => option.id === selectedModel)
      ? unique
      : [
        ...unique,
        {
          id: selectedModel,
          name: selectedModel,
          description: "Current model",
        },
      ];
    return displayOptions.map((option) => ({
      value: option.id,
      label: `${option.name}${option.description ? ` / ${option.description}` : ""}`,
    }));
  })() : [];
  const documentTotal = ingestionSummary.total || ingestionDocs.length;
  const docsReadyLabel = ingestionReady
    ? documentTotal > 0 ? `${ingestionSummary.extracted || ingestionDocs.length} ready` : "Ready"
    : `${ingestionSummary.extracted}/${documentTotal || 0} ready`;
  const isRunActive = intakeLoading || intakeStatus?.status === "running" || intakeStatus?.status === "waiting_for_user";
  const canStart = !isRunActive && !!cliRuntime && ingestionReady;
  const startLabel = !cliRuntime
    ? "Runtime required"
    : !ingestionReady
      ? "Documents processing"
      : isRunActive
        ? "Run in progress"
        : intakeStatus ? "Start new run" : "Start run";

  useEffect(() => {
    if (!open) return;
    const handlePointerDown = (event: PointerEvent) => {
      if (menuRef.current?.contains(event.target as Node)) return;
      setOpen(false);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  return (
    <div ref={menuRef} className="relative shrink-0">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className={cn(
          "inline-flex h-8 items-center gap-1.5 rounded-md border px-2 text-[10px] font-medium transition-colors",
          open ? "border-accent/30 bg-accent/10 text-accent" : "border-line bg-panel2 text-fg/55 hover:text-fg/75",
        )}
        aria-expanded={open}
        aria-haspopup="menu"
      >
        <Bot className="h-3 w-3" />
        <span className="hidden sm:inline">Setup</span>
        <ChevronDown className={cn("h-3 w-3 transition-transform", open && "rotate-180")} />
      </button>

      {open && (
        <div className="absolute right-0 top-full z-50 mt-2 w-[min(92vw,430px)] overflow-hidden rounded-lg border border-line bg-panel shadow-2xl shadow-black/20">
          <div className="border-b border-line bg-bg/35 px-3 py-2">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="text-xs font-semibold text-fg">Agent setup</div>
                <div className="mt-0.5 truncate text-[10px] text-fg/35">
                  {docsReadyLabel} / {selectedPersona?.trade || "General"} / {cliRuntime ? (cliRuntimeMap?.[cliRuntime]?.displayName || cliRuntime) : "No runtime"}
                </div>
              </div>
              <button
                type="button"
                disabled={!canStart}
                onClick={() => {
                  setOpen(false);
                  void handleStartIntake();
                }}
                className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md border border-accent/30 bg-accent px-2 text-[10px] font-semibold text-accent-fg transition-opacity hover:opacity-90 disabled:pointer-events-none disabled:opacity-45"
              >
                {intakeLoading ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}
                {startLabel}
              </button>
            </div>
          </div>

          <div className="space-y-3 p-3">
            <div className="space-y-1.5">
              <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-fg/35">
                <Bot className="h-3 w-3 text-accent" />
                Estimator persona
              </div>
              <NativeAgentSelect
                value={selectedPersonaId ?? "__none__"}
                onChange={(value) => setSelectedPersonaId(value === "__none__" ? null : value)}
                options={personaOptions}
                ariaLabel="Estimator persona"
              />
              <div className="line-clamp-2 text-[11px] leading-relaxed text-fg/42">
                {selectedPersona?.description || "General project estimator with access to the project workspace and documents."}
              </div>
            </div>

            <div className="space-y-1.5">
              <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-fg/35">
                <Gauge className="h-3 w-3 text-accent" />
                Model
              </div>
              {cliRuntime ? (
                <NativeAgentSelect
                  value={effectiveCliModel || defaultCliModel(cliRuntime, cliRuntimeMap)}
                  onChange={setCliAgentModel}
                  options={modelOptions}
                  ariaLabel="Agent model"
                />
              ) : (
                <div className="rounded-lg border border-warning/25 bg-warning/5 px-3 py-2 text-xs text-warning">
                  Configure an agent runtime in settings.
                </div>
              )}
            </div>

            <div className="space-y-1.5">
              <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-fg/35">
                <ClipboardList className="h-3 w-3 text-accent" />
                Run instructions
              </div>
              <Textarea
                value={intakeScope}
                onChange={(event) => onScopeChange(event.target.value)}
                placeholder="Scope priorities, exclusions, alternates, known pricing, subcontract strategy, schedule constraints..."
                className="min-h-24 resize-y border-line/70 bg-bg/55 text-xs leading-relaxed"
              />
            </div>
          </div>

          {!cliRuntime && (
            <div className="border-t border-warning/20 bg-warning/[0.035] px-3 py-2 text-xs text-warning">
              Agent runtime is required before a run can start.
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function AgentChat({ projectId, open, onClose, prefill, autoStartIntake, initialPersonaId, onIntakeStarted, onWorkspaceMutated, onAgentNavigate }: AgentChatProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [settingsReady, setSettingsReady] = useState(false);
  const [sessionError, setSessionError] = useState<string | null>(null);
  const [intakeSessionId, setIntakeSessionId] = useState<string | null>(null);
  const [intakeStatus, setIntakeStatus] = useState<IntakeStatusResult | null>(null);
  const [intakeLoading, setIntakeLoading] = useState(false);
  const [liveToolCalls, setLiveToolCalls] = useState<ToolCallEntry[]>([]);
  const [ingestionStatus, setIngestionStatus] = useState<string | null>(null);
  const [ingestionDocs, setIngestionDocs] = useState<IngestionDoc[]>([]);
  const [ingestionSummary, setIngestionSummary] = useState<IngestionSummary>({ total: 0, extracted: 0, pending: 0, failed: 0 });
  const [ingestionJob, setIngestionJob] = useState<any>(null);
  const [docsExpanded, setDocsExpanded] = useState(false);
  const [followAgent, setFollowAgent] = useState(true);
  const [cliRuntimeMap, setCliRuntimeMap] = useState<CliRuntimeMap | null>(null);
  const [cliRuntime, setCliRuntime] = useState<CliRuntime | null>(null);
  const [cliAgentModel, setCliAgentModel] = useState<string | null>(null);
  const [cliPendingQuestion, setCliPendingQuestion] = useState<PendingQuestionPrompt | null>(null);
  const [personas, setPersonas] = useState<EstimatorPersona[]>([]);
  const [selectedPersonaId, setSelectedPersonaId] = useState<string | null>(null);
  const [sseConnected, setSseConnected] = useState(false);
  const [intakeScope, setIntakeScope] = useState("");
  const [thinkingBlocks, setThinkingBlocks] = useState<Array<{ id: string; content: string }>>([]);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const [isUserScrolledUp, setIsUserScrolledUp] = useState(false);
  const [hasUnseenMessages, setHasUnseenMessages] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const lastRefreshToolCount = useRef(0);
  const navigatedToolIds = useRef(new Set<string>());
  const eventSourceRef = useRef<EventSource | null>(null);
  const detachedWindowRef = useRef<Window | null>(null);
  const streamRevisionRef = useRef("");
  const sseReconnectCount = useRef(0);
  const pollFailCount = useRef(0);
  const intakeScopeEditedRef = useRef(false);
  const [dockMode, setDockMode] = useState<AgentDockMode>("right");
  const [detachedContainer, setDetachedContainer] = useState<HTMLDivElement | null>(null);
  const effectiveCliModel = cliRuntime ? normalizeCliModel(cliRuntime, cliAgentModel, cliRuntimeMap) : null;

  const recordCliPrompt = useCallback((prompt: PendingQuestionPrompt) => {
    setCliPendingQuestion(prompt);
    setIntakeStatus((prev) => prev ? {
      ...(prev as any),
      status: "waiting_for_user",
      events: ensurePromptTimelineEvent(((prev as any).events ?? []) as any[], prompt),
    } as any : prev);
  }, []);

  const recordCliAnswer = useCallback((answer: string, prompt?: PendingQuestionPrompt | null) => {
    if (!answer.trim()) return;
    setIntakeStatus((prev) => {
      if (!prev) return prev;
      const eventsWithPrompt = ensurePromptTimelineEvent(((prev as any).events ?? []) as any[], prompt);
      return {
        ...(prev as any),
        status: "running",
        events: appendTimelineEvent(eventsWithPrompt, {
          type: "userAnswer",
          data: {
            answer,
            questionId: prompt?.id || undefined,
            id: prompt?.id || undefined,
          },
        }),
      } as any;
    });
  }, []);

  const appendLiveEvent = useCallback((event: any) => {
    setIntakeStatus((prev) => {
      if (!prev) return prev;
      return {
        ...(prev as any),
        events: appendTimelineEvent(((prev as any).events ?? []) as any[], event),
      } as any;
    });
  }, []);

  const closeActiveToolCalls = useCallback((
    reason: string,
    completedAt = new Date().toISOString(),
    status: NonNullable<ToolCallEntry["status"]> = "complete",
  ) => {
    setLiveToolCalls((prev) => prev.map((tool) => tool.status === "running"
      ? {
          ...tool,
          completedAt,
          status,
          result: {
            ...tool.result,
            success: status === "failed" ? false : tool.result.success,
            duration_ms: tool.result.duration_ms || 1,
            message: tool.result.message || reason,
          },
        }
      : tool));
  }, []);

  const navigateFromTool = useCallback((tool: ToolCallEntry) => {
    if (!followAgent) return;
    const intent = navigationIntentFromTool(tool);
    if (!intent) return;
    const key = `${tool.id}:${tool.completedAt || tool.result.message || intent.type}`;
    if (navigatedToolIds.current.has(key)) return;
    navigatedToolIds.current.add(key);
    void onAgentNavigate?.(intent);
  }, [followAgent, onAgentNavigate]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const stored = window.localStorage.getItem(agentDockStorageKey(projectId));
    if (isAgentDockMode(stored) && stored !== "detached") setDockMode(stored);
    else setDockMode("right");
  }, [projectId]);

  const closeDetachedWindow = useCallback(() => {
    if (detachedWindowRef.current && !detachedWindowRef.current.closed) {
      detachedWindowRef.current.close();
    }
    detachedWindowRef.current = null;
    setDetachedContainer(null);
  }, []);

  const openDetachedWindow = useCallback(() => {
    if (typeof window === "undefined") return false;

    if (detachedWindowRef.current && !detachedWindowRef.current.closed && detachedContainer) {
      detachedWindowRef.current.focus();
      setDockMode("detached");
      return true;
    }

    const nextWindow = window.open("", `bw-agent-${projectId}`, "width=980,height=860,resizable=yes");
    if (!nextWindow) {
      setSessionError("The browser blocked the detached agent window.");
      return false;
    }

    detachedWindowRef.current = nextWindow;
    nextWindow.document.title = "Bidwright Agent";
    nextWindow.document.documentElement.className = document.documentElement.className;
    nextWindow.document.body.className = document.body.className;
    nextWindow.document.body.style.margin = "0";
    nextWindow.document.body.style.height = "100vh";
    nextWindow.document.body.style.overflow = "hidden";

    const rootStyles = document.documentElement.getAttribute("style");
    if (rootStyles) nextWindow.document.documentElement.setAttribute("style", rootStyles);

    document.querySelectorAll('style, link[rel="stylesheet"]').forEach((node) => {
      nextWindow.document.head.appendChild(node.cloneNode(true));
    });

    const mount = nextWindow.document.createElement("div");
    mount.id = "bidwright-agent-detached-root";
    mount.style.height = "100vh";
    mount.style.display = "flex";
    mount.style.flexDirection = "column";
    nextWindow.document.body.appendChild(mount);

    nextWindow.addEventListener("beforeunload", () => {
      detachedWindowRef.current = null;
      setDetachedContainer(null);
      setDockMode((current) => current === "detached" ? "right" : current);
    });

    setDetachedContainer(mount);
    setDockMode("detached");
    return true;
  }, [detachedContainer, projectId]);

  const handleDockModeChange = useCallback((nextMode: AgentDockMode) => {
    if (nextMode === "detached") {
      void openDetachedWindow();
      return;
    }

    if (typeof window !== "undefined") {
      window.localStorage.setItem(agentDockStorageKey(projectId), nextMode);
    }
    closeDetachedWindow();
    setDockMode(nextMode);
  }, [closeDetachedWindow, openDetachedWindow, projectId]);

  useEffect(() => {
    if (!open) closeDetachedWindow();
  }, [closeDetachedWindow, open]);

  useEffect(() => {
    return () => closeDetachedWindow();
  }, [closeDetachedWindow]);

  // Load CLI runtime and estimating playbooks from the org library
  useEffect(() => {
    let active = true;

    Promise.allSettled([
      getSettings(),
      detectCli(),
      listPersonas(),
    ]).then((results) => {
      if (!active) return;

      const [settingsResult, cliResult, personasResult] = results;

      const integ =
        settingsResult.status === "fulfilled"
          ? (settingsResult.value?.integrations as Record<string, any> | undefined)
          : undefined;

      let runtimeMap: CliRuntimeMap | null = null;
      if (cliResult.status === "fulfilled" && cliResult.value.runtimes) {
        runtimeMap = {};
        for (const [id, info] of Object.entries(cliResult.value.runtimes)) {
          runtimeMap[id] = {
            id: info.id,
            displayName: info.displayName,
            available: info.available,
            experimental: info.experimental,
            primaryInstructionFile: info.primaryInstructionFile,
            models: (info.models || []).map((m) => ({ id: m.id, name: m.name, description: m.description })),
          };
        }
        setCliRuntimeMap(runtimeMap);
      }

      const configuredRuntime = isCliRuntime(integ?.agentRuntime, runtimeMap)
        ? (integ!.agentRuntime as string)
        : cliResult.status === "fulfilled" && isCliRuntime(cliResult.value.configured?.runtime, runtimeMap)
          ? (cliResult.value.configured!.runtime as string)
          : null;
      const configuredModel = integ?.agentModel
        ?? (cliResult.status === "fulfilled" ? cliResult.value.configured?.model : null);
      const resolvedRuntime = configuredRuntime ?? getAutoCliRuntime(runtimeMap);
      setCliRuntime(resolvedRuntime);
      setCliAgentModel(resolvedRuntime ? normalizeCliModel(resolvedRuntime, configuredModel, runtimeMap) : null);

      if (personasResult.status === "fulfilled") {
        const enabled = personasResult.value.filter(p => p.enabled);
        setPersonas(enabled);
        const defaultP = enabled.find(p => p.isDefault);
        if (defaultP) setSelectedPersonaId(defaultP.id);
      }
    }).finally(() => {
      if (active) setSettingsReady(true);
    });

    return () => {
      active = false;
    };
  }, []);

  // Honor an externally requested persona (e.g. from the intake URL param).
  // Runs once when the persona list is ready or when initialPersonaId becomes set.
  useEffect(() => {
    if (!initialPersonaId) return;
    if (personas.length === 0) return;
    const requested = personas.find((p) => p.id === initialPersonaId);
    if (requested) setSelectedPersonaId(requested.id);
  }, [initialPersonaId, personas]);

  useEffect(() => {
    intakeScopeEditedRef.current = false;
    getProjectWorkspace(projectId)
      .then((workspace) => {
        if (intakeScopeEditedRef.current) return;
        setIntakeScope(workspace.workspace.project.scope || "");
      })
      .catch(() => {});
  }, [projectId]);

  // Poll ingestion status to show document extraction progress
  useEffect(() => {
    if (!open) return;
    let active = true;
    const poll = async () => {
      try {
        const res = await fetch(resolveApiUrl(`/projects/${projectId}/ingestion-status`), {
          headers: authHeaders(),
          credentials: "include",
        });
        if (!res.ok) return;
        const data = await res.json();
        if (active) {
          setIngestionStatus(data.status);
          setIngestionDocs(data.documents ?? []);
          setIngestionJob(data.job ?? null);
          if (data.summary && typeof data.summary === "object") {
            setIngestionSummary({
              total: Number(data.summary.total) || 0,
              extracted: Number(data.summary.extracted) || 0,
              pending: Number(data.summary.pending) || 0,
              failed: Number(data.summary.failed) || 0,
            });
          }
        }
      } catch {}
    };
    poll();
    const interval = setInterval(poll, 3000);
    return () => { active = false; clearInterval(interval); };
  }, [projectId, open]);

  // Restore latest CLI session on mount
  useEffect(() => {
    getCliStatus(projectId)
      .then((data) => {
        if (data.status === "none") throw new Error("no cli session");
        restoredFromDb.current = true;
        setIntakeSessionId(data.sessionId || null);
        const events = data.events || [];
        setIntakeStatus({
          sessionId: data.sessionId || "", projectId, scope: "", status: data.status as any,
          toolCallCount: events.filter((e: any) => e.type === "tool_call").length,
          messageCount: events.filter((e: any) => e.type === "message").length,
          summary: null, createdAt: data.startedAt || "", updatedAt: "", recentToolCalls: [],
          events,
        } as any);

        // Hydrate tool calls and messages from stored events
        setLiveToolCalls(pairToolEvents(events));

        const restoredMsgs: ChatMessage[] = events
          .filter((e: any) => e.type === "message")
          .map((e: any, i: number) => ({
            id: `restored-msg-${i}`,
            role: e.data?.role || "assistant",
            content: e.data?.content || "",
            timestamp: e.timestamp || "",
          }));
        setMessages(restoredMsgs);

        const restoredThinking = events
          .filter((e: any) => e.type === "thinking")
          .map((e: any, i: number) => ({ id: `restored-think-${i}`, content: e.data?.content || "" }));
        setThinkingBlocks(restoredThinking.slice(-5));

        // If running, reconnect SSE for live updates
        if (data.status === "running") {
          connectToSseStream(projectId);
        }
      })
      .catch(() => {});
  }, [projectId]);

  useEffect(() => {
    if (open && inputRef.current) {
      inputRef.current.focus();
    }
  }, [open]);

  useEffect(() => {
    if (open) {
      setInput(prefill ?? "");
    }
  }, [open, prefill]);

  // Auto-scroll only when user hasn't manually scrolled up
  useEffect(() => {
    if (!isUserScrolledUp) {
      messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages, liveToolCalls, isUserScrolledUp, cliPendingQuestion, intakeStatus]);

  // Track user scroll position
  const handleScroll = useCallback(() => {
    const el = scrollContainerRef.current;
    if (!el) return;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    const scrolledUp = distanceFromBottom > 80;
    setIsUserScrolledUp(scrolledUp);
    if (!scrolledUp) setHasUnseenMessages(false);
  }, []);

  const scrollToBottom = useCallback(() => {
    const el = scrollContainerRef.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: "auto" });
    else messagesEndRef.current?.scrollIntoView({ behavior: "auto" });
    setIsUserScrolledUp(false);
    setHasUnseenMessages(false);
  }, []);

  const intakeAutoStarted = useRef(false);
  const restoredFromDb = useRef(false);

  async function sendMessage(content: string) {
    if (!content.trim() || isLoading) return;

    const userMsg: ChatMessage = {
      id: `msg-${Date.now()}`,
      role: "user",
      content: content.trim(),
      timestamp: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, userMsg]);
    setInput("");
    setIsLoading(true);

    try {
      // CLI runtime: send message (spawns new session if previous completed)
      if (cliRuntime) {
        const result = await sendCliMessage(projectId, content.trim(), {
          runtime: cliRuntime,
          model: cliAgentModel,
          personaId: selectedPersonaId,
          scope: intakeScope.trim() || undefined,
        });
        if (result.sessionId) {
          // A new session was started
          setIntakeSessionId(result.sessionId);
          setIntakeStatus((prev) => prev ? { ...prev, status: "running" } : {
            sessionId: result.sessionId, projectId, scope: "", status: "running",
            toolCallCount: 0, messageCount: 0, summary: null,
            createdAt: new Date().toISOString(), updatedAt: "", recentToolCalls: [],
          } as any);
          connectToSseStream(projectId);
        }
        setIsLoading(false);
        return;
      }

      throw new Error("Bidwright Agent now uses the CLI runtime only. Configure and authenticate Claude Code or Codex in Agent Runtime settings before chatting.");
    } catch (e) {
      const errorMsg: ChatMessage = {
        id: `msg-${Date.now()}-err`,
        role: "assistant",
        content: `Error: ${e instanceof Error ? e.message : "Failed to reach agent"}`,
        timestamp: new Date().toISOString(),
      };
      setMessages((prev) => [...prev, errorMsg]);
    } finally {
      setIsLoading(false);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage(input);
    }
  }

  async function handleStartIntake(): Promise<boolean> {
    setIntakeLoading(true);
    setLiveToolCalls([]);
    setThinkingBlocks([]);
    lastRefreshToolCount.current = 0;
    try {
      if (!ingestionReady) {
        setSessionError(null);
        return false;
      }
      // Check if there's already a running session (e.g. page refresh)
      if (cliRuntime) {
        try {
          const existing = await getCliStatus(projectId);
          if (existing.status === "running") {
            // Session already running - just reconnect to it
            setIntakeSessionId(existing.sessionId || null);
            setIntakeStatus({
              sessionId: existing.sessionId || "", projectId, scope: "", status: "running",
              toolCallCount: (existing.events || []).filter((e: any) => e.type === "tool_call").length,
              messageCount: (existing.events || []).filter((e: any) => e.type === "message").length,
              summary: null, createdAt: existing.startedAt || "", updatedAt: "", recentToolCalls: [],
              events: existing.events,
            } as any);
            connectToSseStream(projectId);
            setIntakeLoading(false);
            return true;
          }
        } catch {}
      }

      if (cliRuntime) {
        // CLI-based intake (preferred)
        // Use the agent model from org settings, falling back to sensible defaults
        const cliModel = normalizeCliModel(cliRuntime, cliAgentModel, cliRuntimeMap);
        const result = await startCliSession({
          projectId,
          runtime: cliRuntime,
          model: cliModel,
          scope: intakeScope.trim() || undefined,
          personaId: selectedPersonaId || undefined,
        });
        setIntakeSessionId(result.sessionId);
        setIntakeStatus({
          sessionId: result.sessionId, projectId, scope: "", status: "running",
          toolCallCount: 0, messageCount: 0, summary: null,
          createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), recentToolCalls: [],
        });
        // Connect SSE stream
        connectToSseStream(projectId);
        return true;
      } else {
        throw new Error("Estimator runs now use the CLI runtime only. Configure and authenticate Claude Code or Codex in Agent Runtime settings before starting a run.");
      }
    } catch (err) {
      if (isExpectedIngestionStartError(err)) {
        setSessionError(null);
        return false;
      }
      setSessionError(err instanceof Error ? err.message : "Failed to start intake agent");
      return false;
    } finally {
      setIntakeLoading(false);
    }
  }

  async function retryIntakeSession() {
    setSessionError(null);

    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }
    setSseConnected(false);
    setCliPendingQuestion(null);

    if (cliRuntime) {
      setIntakeLoading(true);
      try {
        const resumed = await resumeCliSession(projectId);
        setIntakeSessionId(resumed.sessionId || intakeSessionId);
        setIntakeStatus((prev) => prev ? {
          ...prev,
          status: "running",
        } : {
          sessionId: resumed.sessionId || intakeSessionId || "",
          projectId,
          scope: "",
          status: "running",
          toolCallCount: 0,
          messageCount: 0,
          summary: null,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          recentToolCalls: [],
        } as any);
        connectToSseStream(projectId);
        return;
      } catch {
        // Fall back to a clean restart if the prior CLI session cannot be resumed.
      } finally {
        setIntakeLoading(false);
      }
    }

    await handleStartIntake();
  }

  // SSE stream connection for CLI runtime
  function connectToSseStream(pid: string) {
    // Cleanup existing connection
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
    }

    const es = connectCliStream(pid);
    eventSourceRef.current = es;
    setSseConnected(false);

    const stableConnectionTimer = window.setTimeout(() => {
      if (eventSourceRef.current === es && es.readyState === EventSource.OPEN) {
        sseReconnectCount.current = 0;
        setSseConnected(true);
      }
    }, 10_000);

    es.onopen = () => {
      if (eventSourceRef.current === es) setSseConnected(true);
    };

    let toolCount = 0;
    let msgCount = 0;

    es.addEventListener("thinking", (e) => {
      const data = JSON.parse(e.data);
      appendLiveEvent({ type: "thinking", data, timestamp: new Date().toISOString() });
      setThinkingBlocks((prev) => [...prev.slice(-5), { id: `think-${Date.now()}`, content: data.content }]);
    });

    es.addEventListener("tool_call", (e) => {
      const data = JSON.parse(e.data);
      const timestamp = new Date().toISOString();
      appendLiveEvent({ type: "tool_call", data, timestamp });
      if (isAskUserToolId(data.toolId)) {
        closeActiveToolCalls("Agent asked for input", timestamp);
        return;
      }

      const startedTool: ToolCallEntry = {
        id: data.toolUseId || `tc-${toolCount + 1}`,
        toolId: data.toolId,
        input: data.input,
        result: { success: true, duration_ms: 0 },
        startedAt: timestamp,
        status: "running",
      };
      toolCount++;
      setLiveToolCalls((prev) => [
        ...prev.map((tool) => tool.status === "running"
          ? {
              ...tool,
              status: "complete" as const,
              completedAt: timestamp,
              result: {
                ...tool.result,
                duration_ms: tool.result.duration_ms || 1,
                message: tool.result.message || "Completed",
              },
            }
          : tool),
        startedTool,
      ]);
      setIntakeStatus((prev) => prev ? { ...prev, toolCallCount: toolCount } : prev);
      // Refresh workspace when mutating tools are called
      if (data.toolId && isAgentToolMutating(data.toolId)) {
        onWorkspaceMutated?.();
        navigateFromTool(startedTool);
      }
    });

    es.addEventListener("tool_result", (e) => {
      const data = JSON.parse(e.data);
      const timestamp = new Date().toISOString();
      appendLiveEvent({ type: "tool_result", data, timestamp });
      // Update the matching tool call with result
      const completedToolRef: { current: ToolCallEntry | null } = { current: null };
      setLiveToolCalls((prev) => {
        const updated = [...prev];
        const match = [...updated].reverse().find((tc) => tc.id === data.toolUseId || !tc.result.duration_ms);
        if (match) {
          match.result = buildToolResult(data.content ?? data, data.duration_ms || 0, data);
          match.completedAt = timestamp;
          match.status = match.result.success ? "complete" : "failed";
          completedToolRef.current = { ...match, result: { ...match.result } };
        }
        return updated;
      });
      const completedTool = completedToolRef.current;
      if (completedTool && ((completedTool.result.sideEffects?.length ?? 0) > 0 || isAgentToolMutating(completedTool.toolId))) {
        onWorkspaceMutated?.();
        navigateFromTool(completedTool);
      }
    });

    es.addEventListener("message", (e) => {
      const data = JSON.parse(e.data);
      const timestamp = new Date().toISOString();
      closeActiveToolCalls("Completed", timestamp);
      appendLiveEvent({ type: "message", data, timestamp });
      msgCount++;
      setMessages((prev) => [...prev, {
        id: `cli-msg-${msgCount}`,
        role: data.role || "assistant",
        content: data.content,
        timestamp,
      }]);
      setIntakeStatus((prev) => prev ? { ...prev, messageCount: msgCount } : prev);
    });

    es.addEventListener("progress", (e) => {
      const data = JSON.parse(e.data);
      appendLiveEvent({ type: "progress", data, timestamp: new Date().toISOString() });
    });

    es.addEventListener("file_read", (e) => {
      const data = JSON.parse(e.data);
      appendLiveEvent({ type: "file_read", data, timestamp: new Date().toISOString() });
      // Show as a subtle indicator, not a full message
      setThinkingBlocks((prev) => [...prev.slice(-5), { id: `file-${Date.now()}`, content: `Reading: ${data.fileName}` }]);
    });

    es.addEventListener("askUser", (e) => {
      try {
        const data = JSON.parse(e.data);
        const timestamp = new Date().toISOString();
        closeActiveToolCalls("Agent asked for input", timestamp);
        appendLiveEvent({ type: "askUser", data, timestamp });
        if (data.question) {
          recordCliPrompt({
            id: data.questionId || data.id || null,
            question: data.question,
            options: data.options,
            allowMultiple: data.allowMultiple === true,
            context: data.context,
            questions: data.questions,
          });
        }
      } catch {}
    });

    es.addEventListener("userAnswer", (e) => {
      setCliPendingQuestion(null);
      try {
        const data = JSON.parse(e.data);
        appendLiveEvent({ type: "userAnswer", data, timestamp: new Date().toISOString() });
      } catch {
        setIntakeStatus((prev) => prev ? { ...(prev as any), status: "running" } as any : prev);
      }
    });

    es.addEventListener("status", (e) => {
      const data = JSON.parse(e.data);
      const timestamp = new Date().toISOString();
      if (data.status === "completed" || data.status === "stopped" || data.status === "failed") {
        closeActiveToolCalls(
          data.status === "failed" ? "Run failed" : data.status === "stopped" ? "Run stopped" : "Completed",
          timestamp,
          data.status === "failed" ? "failed" : data.status === "stopped" ? "stopped" : "complete",
        );
      }
      appendLiveEvent({ type: "status", data, timestamp });
      if (data.status === "completed" || data.status === "stopped" || data.status === "failed") {
        setIntakeStatus((prev) => prev ? { ...prev, status: data.status } : prev);
        setSseConnected(false);
        window.clearTimeout(stableConnectionTimer);
        es.close();
        eventSourceRef.current = null;
        window.setTimeout(() => {
          void getCliStatus(projectId)
          .then((latest) => {
            const events = latest.events || [];
            const tools = events.filter((evt: any) => evt.type === "tool_call");
            const msgs = events.filter((evt: any) => evt.type === "message");

            setLiveToolCalls(pairToolEvents(events));
            setMessages(msgs.map((evt: any, i: number) => ({
              id: `terminal-msg-${i}`,
              role: evt.data?.role || "assistant",
              content: evt.data?.content || "",
              timestamp: evt.timestamp || "",
            })));
            setIntakeStatus((prev) => prev ? {
              ...prev,
              status: latest.status as any,
              toolCallCount: tools.length,
              messageCount: msgs.length,
              events,
            } : prev);
          })
          .catch(() => {})
          .finally(() => {
            onWorkspaceMutated?.(); // Final refresh
          });
        }, 250);
      }
    });

    es.addEventListener("error", (e) => {
      // Try to parse error data
      try {
        const data = JSON.parse((e as any).data);
        setSessionError(data.message);
      } catch {
        // SSE connection error - might reconnect automatically
      }
    });

    es.onerror = () => {
      if (es.readyState !== EventSource.CLOSED || eventSourceRef.current !== es) {
        // Native EventSource retries in-place. Keep the header stable while
        // the browser is reconnecting to an otherwise healthy run.
        if (es.readyState === EventSource.OPEN) setSseConnected(true);
        return;
      }

      setSseConnected(false);
      // Connection fully closed - check actual backend status before reconnecting
      const attempt = sseReconnectCount.current;
      const MAX_SSE_RECONNECTS = 8;
      if (attempt >= MAX_SSE_RECONNECTS) {
        console.warn("[sse] Max reconnect attempts reached, giving up");
        window.clearTimeout(stableConnectionTimer);
        es.close();
        eventSourceRef.current = null;
        setSseConnected(false);
        return;
      }

      // Exponential backoff: 3s, 6s, 12s, 24s - capped at 30s
      const delay = Math.min(3000 * Math.pow(2, attempt), 30_000);
      sseReconnectCount.current = attempt + 1;

      setTimeout(async () => {
        // Poll backend for actual session status before reconnecting
        try {
          const data = await getCliStatus(pid);
          if (data.status !== "running") {
            // Session already finished - update state and stop reconnecting
            window.clearTimeout(stableConnectionTimer);
            es.close();
            eventSourceRef.current = null;
            sseReconnectCount.current = 0;
            setIntakeStatus((prev) => prev ? { ...prev, status: data.status as any } : prev);
            onWorkspaceMutated?.();
            return;
          }
        } catch {
          // 404 or network error - session is gone
          window.clearTimeout(stableConnectionTimer);
          es.close();
          eventSourceRef.current = null;
          sseReconnectCount.current = 0;
          setIntakeStatus((prev) => prev ? { ...prev, status: "failed" } : prev);
          setSessionError("Agent session ended unexpectedly.");
          onWorkspaceMutated?.();
          return;
        }

        // Session still running - reconnect SSE
        window.clearTimeout(stableConnectionTimer);
        es.close();
        eventSourceRef.current = null;
        connectToSseStream(pid);
      }, delay);
    };
  }

  // Cleanup SSE on unmount
  useEffect(() => {
    return () => {
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
        eventSourceRef.current = null;
      }
    };
  }, []);

  // Poll CLI status + refresh workspace periodically while agent is running
  useEffect(() => {
    if (!intakeSessionId || !cliRuntime) return;
    const status = intakeStatus?.status;
    if (status !== "running") return;

    // Refresh workspace every 10s while agent runs (catches sub-agent mutations)
    const wsRefreshInterval = setInterval(() => {
      onWorkspaceMutated?.();
    }, 10_000);

    const poll = async () => {
      try {
        const data = await getCliStatus(projectId);
        pollFailCount.current = 0; // Reset on success
        const events = data.events || [];
        if (events.length > 0) {
          // Update tool calls from persisted events
          const toolEvents = events.filter((e: any) => e.type === "tool_call");
          const tools = pairToolEvents(events);
          setLiveToolCalls(tools);

          const msgs = events.filter((e: any) => e.type === "message");
          setMessages(msgs.map((e: any, i: number) => ({
            id: `poll-msg-${i}`,
            role: e.data?.role || "assistant",
            content: e.data?.content || "",
            timestamp: e.timestamp || "",
          })));

          setIntakeStatus((prev) => prev ? {
            ...prev,
            status: data.status as any,
            toolCallCount: toolEvents.length,
            messageCount: msgs.length,
            events,
          } : prev);

          // Refresh workspace if there are new mutating tool calls since last poll
          const mutatingTools = tools.filter((tool) => isAgentToolMutating(tool.toolId) || (tool.result.sideEffects?.length ?? 0) > 0);
          if (mutatingTools.length > lastRefreshToolCount.current) {
            lastRefreshToolCount.current = mutatingTools.length;
            onWorkspaceMutated?.();
            const newest = mutatingTools[mutatingTools.length - 1];
            if (newest) navigateFromTool(newest);
          }
        }

        // Poll for pending questions from the askUser MCP tool
        try {
          const q = await getCliPendingQuestion(projectId);
          if (q.pending && q.question) {
            recordCliPrompt({
              id: q.questionId || null,
              question: q.question,
              options: q.options,
              allowMultiple: q.allowMultiple === true,
              context: q.context,
              questions: q.questions,
            });
          } else {
            setCliPendingQuestion(null);
            setIntakeStatus((prev) => prev && (prev as any).status === "waiting_for_user"
              ? { ...(prev as any), status: data.status as any } as any
              : prev);
          }
        } catch { /* ignore question poll failures */ }

        if (data.status !== "running") {
          setIntakeStatus((prev) => prev ? { ...prev, status: data.status as any } : prev);
          setCliPendingQuestion(null);
          // Session ended - close SSE if still open
          if (eventSourceRef.current) {
            eventSourceRef.current.close();
            eventSourceRef.current = null;
            setSseConnected(false);
          }
          onWorkspaceMutated?.();
        }
      } catch {
        // API unreachable (server restarting, network blip, etc.)
        // Retry a few times before giving up - the server may come back with the
        // actual final status from the DB after its startup cleanup runs.
        pollFailCount.current = (pollFailCount.current || 0) + 1;
        if (pollFailCount.current >= 4) {
          // After ~20s of failures, accept it's gone and check DB one last time
          try {
            const recovered = await getCliStatus(projectId);
            const finalStatus = recovered.status === "running" ? "stopped" : recovered.status;
            setIntakeStatus((prev) => prev ? { ...prev, status: finalStatus as any, events: recovered.events } : prev);
          } catch {
            setIntakeStatus((prev) => prev ? { ...prev, status: "stopped" } : prev);
          }
          setCliPendingQuestion(null);
          if (eventSourceRef.current) {
            eventSourceRef.current.close();
            eventSourceRef.current = null;
            setSseConnected(false);
          }
          onWorkspaceMutated?.();
          pollFailCount.current = 0;
        }
        // Otherwise silently retry on next interval
      }
    };

    const interval = setInterval(poll, 5000);
    return () => { clearInterval(interval); clearInterval(wsRefreshInterval); };
  }, [intakeSessionId, intakeStatus?.status, cliRuntime, projectId]);

  // Treat the project as ready for an AI run only after ingestion has reached
  // a "ready" lifecycle status. Starting earlier wedges the agent on a stale
  // CLAUDE.md/AGENTS.md/GEMINI.md manifest because the worker re-issues
  // SourceDocument IDs at the end of extraction.
  const ingestionReady = ingestionStatus !== null
    && READY_INGESTION_STATUSES.has(ingestionStatus);

  // Auto-start intake ONLY when redirected from upload AND no existing session
  // The restore useEffect (above) runs first and sets intakeSessionId if a session exists
  useEffect(() => {
    if (autoStartIntake && open && settingsReady && !intakeAutoStarted.current && !intakeSessionId && !restoredFromDb.current) {
      if (!ingestionReady) {
        return;
      }
      // Small delay to let the restore finish first
      const timer = setTimeout(() => {
        if (!intakeAutoStarted.current && !intakeSessionId) {
          intakeAutoStarted.current = true;
          handleStartIntake().then((started) => {
            if (started) {
              onIntakeStarted?.();
            } else {
              intakeAutoStarted.current = false;
            }
          });
        }
      }, 1500);
      return () => clearTimeout(timer);
    }
  }, [autoStartIntake, open, settingsReady, intakeSessionId, ingestionReady]);

  useEffect(() => {
    if (ingestionReady) setDocsExpanded(false);
  }, [ingestionReady, projectId]);

  const isIntakeRunning = intakeStatus?.status === "running" || intakeStatus?.status === "waiting_for_user";
  const isIntakeComplete = intakeStatus?.status === "completed";
  const isIntakeFailed = intakeStatus?.status === "failed";
  const isWaitingForUser = intakeStatus?.status === "waiting_for_user";
  const isRunStarting = intakeLoading && ingestionReady && !isIntakeRunning;
  const showIngestionGate = !ingestionReady && !isIntakeRunning;
  const timelineEvents: any[] = (intakeStatus as any)?.events ?? [];
  const pairedToolCalls = useMemo(() => pairToolEvents(timelineEvents), [timelineEvents]);
  const activityToolsSource = liveToolCalls.length >= pairedToolCalls.length ? liveToolCalls : pairedToolCalls;
  const activityTools = useMemo(() => {
    const terminalStatus = intakeStatus?.status;
    const shouldCloseDanglingTools = !isIntakeRunning && terminalStatus && terminalStatus !== "running" && terminalStatus !== "waiting_for_user";
    if (!shouldCloseDanglingTools) return activityToolsSource;
    return activityToolsSource.map((tool) => {
      if (tool.status !== "running") return tool;
      const failed = terminalStatus === "failed";
      const stopped = terminalStatus === "stopped";
      return {
        ...tool,
        status: failed ? "failed" as const : stopped ? "stopped" as const : "complete" as const,
        result: {
          ...tool.result,
          success: failed ? false : tool.result.success,
          message: tool.result.message || (failed ? "No result before failure" : stopped ? "Stopped before result" : "No result returned"),
        },
      };
    });
  }, [activityToolsSource, intakeStatus?.status, isIntakeRunning]);
  const toolById = useMemo(() => new Map(activityTools.map((tool) => [tool.id, tool])), [activityTools]);
  const timelineItems = useMemo(() => {
    const items: Array<
      | { type: "event"; event: any; index: number; key: string }
      | { type: "tool_group"; tools: ToolCallEntry[]; index: number; key: string }
    > = [];
    let pendingTools: ToolCallEntry[] = [];
    let pendingStartIndex = -1;

    const flushTools = () => {
      if (pendingTools.length === 0) return;
      items.push({
        type: "tool_group",
        tools: pendingTools,
        index: pendingStartIndex,
        key: `tool-group-${pendingStartIndex}-${pendingTools.length}`,
      });
      pendingTools = [];
      pendingStartIndex = -1;
    };

    timelineEvents.forEach((event, index) => {
      const eventType = event?.type;
      if (eventType === "tool_call" || eventType === "tool") {
        if (isAskUserToolId(event?.data?.toolId)) return;
        const fallbackTool = toolEntryFromTimelineEvent(event, index);
        pendingTools.push(toolById.get(fallbackTool.id) || fallbackTool);
        if (pendingStartIndex === -1) pendingStartIndex = index;
        return;
      }

      if (eventType === "tool_result") {
        return;
      }

      flushTools();
      items.push({ type: "event", event, index, key: `evt-${index}` });
    });

    flushTools();
    return items;
  }, [timelineEvents, toolById]);
  const statusToolCount = Math.max(intakeStatus?.toolCallCount ?? 0, activityTools.length);
  const statusMessageCount = Math.max(
    intakeStatus?.messageCount ?? 0,
    timelineEvents.filter((event) => event?.type === "message").length,
  );
  const streamRevision = useMemo(() => {
    const lastEvent = timelineEvents[timelineEvents.length - 1];
    const lastMessage = messages[messages.length - 1];
    const toolState = activityTools.map((tool) => `${tool.id}:${tool.status || ""}:${tool.result.duration_ms || 0}:${tool.result.message || ""}`).join("|");
    const lastEventContent = typeof lastEvent?.data?.content === "string" ? lastEvent.data.content.length : "";
    return [
      timelineEvents.length,
      lastEvent?.timestamp || "",
      lastEvent?.type || "",
      lastEventContent,
      messages.length,
      lastMessage?.content?.length || 0,
      toolState,
      cliPendingQuestion?.id || cliPendingQuestion?.question || "",
    ].join("::");
  }, [activityTools, cliPendingQuestion, messages, timelineEvents]);
  const latestAssistantMessageIndex = useMemo(() => {
    for (let i = timelineEvents.length - 1; i >= 0; i -= 1) {
      if (timelineEvents[i]?.type === "message" && (timelineEvents[i]?.data?.role ?? "assistant") !== "user") return i;
    }
    return -1;
  }, [timelineEvents]);
  const latestAssistantMessageIsCurrent = useMemo(() => {
    if (latestAssistantMessageIndex < 0) return false;
    return !timelineEvents.slice(latestAssistantMessageIndex + 1).some((event) => {
      if (!event) return false;
      if ((event.type === "tool_call" || event.type === "tool") && isAskUserToolId(event?.data?.toolId)) return false;
      return event.type === "tool_call"
        || event.type === "tool"
        || event.type === "askUser"
        || event.type === "progress"
        || event.type === "status";
    });
  }, [latestAssistantMessageIndex, timelineEvents]);
  const hasInlineCliPendingQuestion = Boolean(
    cliPendingQuestion && timelineEvents.some((evt, index) =>
      evt.type === "askUser"
      && promptMatchesAskUserEvent(cliPendingQuestion, evt)
      && !isDuplicateAskUserEvent(timelineEvents, index)
      && !findAnswerForAskUser(timelineEvents, index),
    ),
  );

  useEffect(() => {
    const previous = streamRevisionRef.current;
    if (streamRevision !== previous && previous && isUserScrolledUp && !showIngestionGate) {
      setHasUnseenMessages(true);
    }
    if (!isUserScrolledUp || showIngestionGate) {
      setHasUnseenMessages(false);
    }
    streamRevisionRef.current = streamRevision;
  }, [isUserScrolledUp, showIngestionGate, streamRevision]);

  const dockedClassName = cn(
    "fixed z-50 flex w-full max-w-[100vw] flex-col bg-panel shadow-2xl",
    dockMode === "left"
      ? "inset-y-0 left-0 border-r border-line sm:max-w-[720px] lg:max-w-[860px] xl:max-w-[960px]"
      : dockMode === "bottom"
        ? "inset-x-0 bottom-0 h-[42vh] min-h-[300px] border-t border-line"
        : "inset-y-0 right-0 border-l border-line sm:max-w-[720px] lg:max-w-[860px] xl:max-w-[960px]",
  );
  const dockedInitial = dockMode === "left" ? { x: "-100%" } : dockMode === "bottom" ? { y: "100%" } : { x: "100%" };
  const dockedExit = dockMode === "left" ? { x: "-100%" } : dockMode === "bottom" ? { y: "100%" } : { x: "100%" };
  const panelContent = (
    <>
          {/* Header */}
          <div className="flex items-center justify-between gap-3 border-b border-line px-4 py-3">
            <div className="flex items-center gap-2">
              <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-accent/10">
                <Sparkles className="h-3.5 w-3.5 text-accent" />
              </div>
              <div>
                <div className="text-sm font-semibold">Bidwright Agent</div>
                <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[10px] text-fg/35">
                  <span>{cliRuntime ? `${cliRuntimeMap?.[cliRuntime]?.displayName || cliRuntime} \u00B7 ${effectiveCliModel}` : "CLI runtime required"}</span>
                  {(intakeStatus || isRunStarting) && (
                    <>
                      <span className="text-fg/20">/</span>
                      <span className={cn(
                        "font-medium",
                        isWaitingForUser ? "text-warning" :
                        isRunStarting || isIntakeRunning ? "text-accent" :
                        isIntakeComplete ? "text-success" :
                        isIntakeFailed ? "text-danger" : "text-fg/45",
                      )}>
                        {isWaitingForUser ? "Waiting for input" :
                         isRunStarting ? "Starting run" :
                         isIntakeRunning ? "Estimator running" :
                         isIntakeComplete ? "Run complete" :
                         intakeStatus?.status === "stopped" ? "Stopped" :
                         "Run failed"}
                      </span>
                      <span className="text-fg/20">/</span>
                      <span>{statusToolCount} tools · {statusMessageCount} msgs</span>
                    </>
                  )}
                  {sseConnected && <span className="text-success">connected</span>}
                </div>
              </div>
            </div>
            <div className="flex min-w-0 items-center gap-2">
              <AgentSetupDropdown
                personas={personas}
                selectedPersonaId={selectedPersonaId}
                setSelectedPersonaId={setSelectedPersonaId}
                cliRuntime={cliRuntime}
                cliRuntimeMap={cliRuntimeMap}
                effectiveCliModel={effectiveCliModel}
                setCliAgentModel={setCliAgentModel}
                intakeScope={intakeScope}
                onScopeChange={(value) => {
                  intakeScopeEditedRef.current = true;
                  setIntakeScope(value);
                }}
                intakeLoading={intakeLoading}
                ingestionReady={ingestionReady}
                intakeStatus={intakeStatus}
                ingestionSummary={ingestionSummary}
                ingestionDocs={ingestionDocs}
                handleStartIntake={async () => {
                  await handleStartIntake();
                }}
              />
              <AgentDockControl mode={dockMode} onChange={handleDockModeChange} />
              {(isRunStarting || isIntakeRunning) && (
                <button
                  onClick={async () => {
                    try {
                      await stopCliSession(projectId);
                      setIntakeStatus((prev) => prev ? { ...prev, status: "stopped" as any } : prev);
                      if (eventSourceRef.current) { eventSourceRef.current.close(); eventSourceRef.current = null; }
                    } catch {}
                  }}
                  className="inline-flex h-8 items-center gap-1.5 rounded-md border border-line bg-panel2 px-2 text-[10px] font-medium text-fg/55 transition-colors hover:border-danger/25 hover:bg-danger/10 hover:text-danger"
                  title="Stop agent"
                >
                  <Square className="h-3 w-3" />
                  Stop
                </button>
              )}
              {(intakeStatus?.status === "stopped" || isIntakeFailed) && (
                <button
                  onClick={() => { void retryIntakeSession(); }}
                  className="inline-flex h-8 items-center gap-1.5 rounded-md border border-line bg-panel2 px-2 text-[10px] font-medium text-fg/55 transition-colors hover:border-accent/25 hover:bg-accent/10 hover:text-accent"
                  title="Resume or restart"
                >
                  <RefreshCw className="h-3 w-3" />
                  Start
                </button>
              )}
              <button
                onClick={() => setFollowAgent((value) => !value)}
                className={cn(
                  "hidden items-center gap-1.5 rounded-md border px-2 py-1 text-[10px] font-medium transition-colors sm:inline-flex",
                  followAgent ? "border-accent/25 bg-accent/10 text-accent" : "border-line bg-panel2 text-fg/45 hover:text-fg/70",
                )}
                title="Follow agent navigation"
              >
                <Navigation className="h-3 w-3" />
                Follow
              </button>
              <button onClick={onClose} className="rounded p-1 text-fg/40 hover:bg-panel2 hover:text-fg">
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>

          {/* Session error */}
          {sessionError && (
            <div className="mx-4 mt-3 flex items-center gap-2 rounded-lg border border-danger/30 bg-danger/5 px-3 py-2">
              <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-danger" />
              <span className="flex-1 text-xs text-danger">{sessionError}</span>
              <Button
                size="xs"
                variant="secondary"
                onClick={() => { void retryIntakeSession(); }}
              >
                <RefreshCw className="h-3 w-3" />
                Retry
              </Button>
            </div>
          )}

          {/* Unified chronological stream */}
          <div className="relative min-h-0 flex-1">
          <div
            className={cn(
              "h-full p-4",
              showIngestionGate ? "overflow-hidden" : "space-y-2 overflow-y-auto",
            )}
            ref={scrollContainerRef}
            onScroll={handleScroll}
          >
            {showIngestionGate && (
              <IngestionGate
                docs={ingestionDocs}
                summary={ingestionSummary}
                job={ingestionJob}
                ingestionStatus={ingestionStatus}
              />
            )}

            {/* Document extraction event (collapsible, starts minimized) */}
            {ingestionReady && ingestionDocs.length > 0 && (
              <div className="rounded-lg border border-line px-3 py-2 text-xs">
                <button className="flex w-full items-center gap-2 text-left" onClick={() => setDocsExpanded(!docsExpanded)}>
                  {docsExpanded ? <ChevronDown className="h-3 w-3 text-fg/30 shrink-0" /> : <ChevronRight className="h-3 w-3 text-fg/30 shrink-0" />}
                  {!ingestionReady ? (
                    <Loader2 className="h-3 w-3 animate-spin text-accent shrink-0" />
                  ) : (
                    <CheckCircle2 className="h-3 w-3 text-success shrink-0" />
                  )}
                  <span className="font-medium text-fg/60">
                    {!ingestionReady
                      ? `Extracting documents (${ingestionSummary.extracted}/${ingestionSummary.total || ingestionDocs.length})`
                      : `${ingestionDocs.length} documents extracted`}
                  </span>
                  <span className="ml-auto text-[9px] text-fg/25">{ingestionDocs.filter(d => d.hasText).length}/{ingestionDocs.length} with text</span>
                </button>
                {docsExpanded && (
                <div className="mt-1.5 space-y-0.5">
                  {ingestionDocs.map((doc) => {
                    const providerLabel = ingestionProviderLabel(doc.extractionProvider);
                    const isExtracted = doc.extractionState === "extracted";
                    return (
                      <div key={doc.id} className="flex items-center gap-1.5 text-[10px] text-fg/40">
                        {isExtracted ? (
                          <CheckCircle2 className="h-2.5 w-2.5 text-success/60 shrink-0" />
                        ) : (
                          <Loader2 className="h-2.5 w-2.5 animate-spin text-fg/30 shrink-0" />
                        )}
                        <span className="truncate flex-1">{doc.fileName}</span>
                        <span
                          className={cn(
                            "rounded border px-1 py-0.5 text-[9px] font-medium shrink-0",
                            doc.extractionProvider === "azure_di"
                              ? "border-accent/25 bg-accent/8 text-accent"
                              : doc.extractionProvider === "local"
                                ? "border-line bg-panel2 text-fg/55"
                                : "border-warning/25 bg-warning/8 text-warning"
                          )}
                          title={isExtracted ? `Extracted via ${providerLabel}` : "Pending extraction"}
                        >
                          {providerLabel}
                        </span>
                        <span className="text-[9px] text-fg/25 shrink-0">{doc.documentType}</span>
                        <span className="text-[9px] text-fg/20 shrink-0">{doc.pageCount}p</span>
                      </div>
                    );
                  })}
                </div>
                )}
              </div>
            )}

            {/* CLI pending question moved to bottom - see before messagesEndRef */}

            {/* Unified chronological stream - all events from DB in order */}
            {(() => {
              if (showIngestionGate) return null;
              return timelineItems.map((item) => {
                if (item.type === "tool_group") {
                  return (
                    <div key={item.key} className="flex justify-start">
                      <div className="w-full">
                        <AgentToolGroup tools={item.tools} onNavigate={onAgentNavigate} />
                      </div>
                    </div>
                  );
                }

                const evt = item.event;
                const i = item.index;
                const t = evt.type;
                const key = item.key;

                // Thinking block
                if (t === "thinking") {
                  const content = evt.data?.content;
                  if (!content) return null;
                  return (
                    <div key={key} className="rounded-lg border border-fg/5 bg-fg/[0.02] px-3 py-1.5 text-[10px] text-fg/30 italic">
                      {content.length > 300 ? content.substring(0, 300) + "..." : content}
                    </div>
                  );
                }

                // Message
                if (t === "message") {
                  const content = evt.data?.content;
                  if (!content || content.includes("[Context limit")) return null;
                  const role = evt.data?.role ?? "assistant";
                  const isLatestAssistant = role !== "user"
                    && i === latestAssistantMessageIndex
                    && latestAssistantMessageIsCurrent
                    && isIntakeRunning;
                  return (
                    <div key={key} className={cn("flex", role === "user" ? "justify-end" : "justify-start")}>
                      <div className={cn(
                        "text-sm leading-relaxed",
                        role === "user"
                          ? "max-w-[78%] rounded-2xl rounded-br-md bg-accent/15 px-3 py-2 text-fg shadow-sm"
                          : "w-full px-1 py-1 text-fg/[0.86]"
                      )}>
                        <StreamingMarkdown content={content} streamKey={key} active={isLatestAssistant} />
                      </div>
                    </div>
                  );
                }

                if (t === "progress") {
                  const phase = evt.data?.phase || "Working";
                  const detail = evt.data?.detail || evt.data?.message || "";
                  return (
                    <div key={key} className="rounded-lg border border-line/55 bg-panel2/25 px-2.5 py-1.5">
                      <div className="flex items-center gap-2">
                        <Sparkles className="h-3 w-3 shrink-0 text-accent" />
                        <div className="min-w-0">
                          <div className="truncate text-[11px] font-medium text-fg/70">{phase}</div>
                          {detail && <div className="truncate text-[10px] text-fg/40">{detail}</div>}
                        </div>
                      </div>
                    </div>
                  );
                }

                if (t === "askUser") {
                  const prompt = evt.data as PendingQuestionPrompt;
                  if (!prompt?.question) return null;
                  if (isDuplicateAskUserEvent(timelineEvents, i)) return null;
                  const answer = findAnswerForAskUser(timelineEvents, i);
                  const isCurrentPending = !answer
                    && cliRuntime
                    && cliPendingQuestion
                    && promptMatchesAskUserEvent(cliPendingQuestion, evt);

                  if (isCurrentPending) {
                    return (
                      <PendingQuestionCard
                        key={key}
                        prompt={cliPendingQuestion}
                        promptKey={`cli-inline-${projectId}-${cliPendingQuestion.id || cliPendingQuestion.question}`}
                        onSubmit={async (submittedAnswer) => {
                          const pendingPrompt = cliPendingQuestion;
                          try {
                            await answerCliQuestion(projectId, submittedAnswer, pendingPrompt?.id);
                            recordCliAnswer(submittedAnswer, pendingPrompt);
                            setCliPendingQuestion(null);
                          } catch (err) {
                            setSessionError(err instanceof Error ? err.message : "Failed to deliver answer to agent");
                          }
                        }}
                      />
                    );
                  }

                  return <QuestionTranscriptCard key={key} prompt={prompt} answer={answer} />;
                }

                if (t === "userAnswer") {
                  return null;
                }

                // Run divider - separates multiple sessions
                if (t === "run_divider") {
                  const startedAt = evt.data?.startedAt;
                  const dateStr = startedAt ? new Date(startedAt).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "";
                  const model = evt.data?.model || "";
                  const status = evt.data?.status || "";
                  return (
                    <div key={key} className="flex items-center gap-2 py-2">
                      <div className="h-px flex-1 bg-line" />
                      <span className="text-[10px] text-fg/30 whitespace-nowrap flex items-center gap-1.5">
                        {status === "completed" ? (
                          <span className="h-1.5 w-1.5 rounded-full bg-success" />
                        ) : status === "failed" ? (
                          <span className="h-1.5 w-1.5 rounded-full bg-danger" />
                        ) : (
                          <span className="h-1.5 w-1.5 rounded-full bg-warning" />
                        )}
                        Session {"\u00B7"} {dateStr}{model ? ` \u00B7 ${model}` : ""}
                      </span>
                      <div className="h-px flex-1 bg-line" />
                    </div>
                  );
                }

                // Status events - skip rendering (shown in header)
                return null;
              }).filter(Boolean);
            })()}

            {!showIngestionGate && timelineEvents.length === 0 && messages.map((message) => (
              <div key={message.id} className={cn("flex", message.role === "user" ? "justify-end" : "justify-start")}>
                <div className={cn(
                  "text-sm leading-relaxed",
                  message.role === "user" ? "max-w-[78%] rounded-2xl rounded-br-md bg-accent/15 px-3 py-2 text-fg shadow-sm" : "w-full px-1 py-1 text-fg/[0.86]",
                )}>
                  <StreamingMarkdown content={message.content} streamKey={message.id} active={false} />
                </div>
              </div>
            ))}

            {/* Loading indicator */}
            {!showIngestionGate && (isLoading || isRunStarting || isIntakeRunning) && (
              <div className="flex items-center gap-1.5 text-[10px] text-fg/30 py-1">
                <Loader2 className="h-3 w-3 animate-spin" />
                {isRunStarting ? "Starting estimator..." : isIntakeRunning ? (sseConnected ? "Agent working (live)..." : "Agent working...") : "Thinking..."}
              </div>
            )}

            {/* Pending question from CLI agent (askUser MCP tool) - rendered at bottom so auto-scroll keeps it visible */}
            {!showIngestionGate && cliRuntime && cliPendingQuestion && !hasInlineCliPendingQuestion && (
              <div className="animate-in fade-in slide-in-from-bottom-2 duration-300">
                <PendingQuestionCard
                  prompt={cliPendingQuestion}
                  promptKey={`cli-${projectId}-${cliPendingQuestion.id || cliPendingQuestion.question}`}
                  onSubmit={async (answer) => {
                    const pendingPrompt = cliPendingQuestion;
                    try {
                      await answerCliQuestion(projectId, answer, pendingPrompt?.id);
                      recordCliAnswer(answer, pendingPrompt);
                      setCliPendingQuestion(null);
                    } catch (err) {
                      setSessionError(err instanceof Error ? err.message : "Failed to deliver answer to agent");
                    }
                  }}
                />
              </div>
            )}

            <div ref={messagesEndRef} />

          </div>

          <AnimatePresence>
            {hasUnseenMessages && (
              <motion.button
                key="new-messages"
                initial={{ opacity: 0, y: 8, scale: 0.96 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: 8, scale: 0.96 }}
                transition={{ duration: 0.14 }}
                onClick={scrollToBottom}
                className="absolute bottom-3 left-1/2 z-20 flex -translate-x-1/2 items-center gap-1.5 rounded-full border border-accent/25 bg-panel px-3 py-1.5 text-[10px] font-medium text-accent shadow-xl shadow-black/10 transition-colors hover:bg-accent/10"
              >
                <ArrowDown className="h-3 w-3" />
                New messages
              </motion.button>
            )}
          </AnimatePresence>
          </div>

          {/* Input */}
          {!showIngestionGate && <div className="border-t border-line p-3">
            <div className="flex items-center gap-2">
              <input
                ref={inputRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Ask about this project..."
                disabled={isLoading}
                className="h-9 w-full flex-1 rounded-lg border border-line bg-bg/50 px-3 text-sm text-fg outline-none placeholder:text-fg/30 focus:border-accent/50 focus:ring-1 focus:ring-accent/20"
              />
              <Button size="sm" onClick={() => sendMessage(input)} disabled={isLoading || !input.trim()}>
                <Send className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>}
    </>
  );

  return (
    <>
      <AnimatePresence>
        {open && dockMode !== "detached" && (
          <motion.div
            key={dockMode}
            initial={dockedInitial}
            animate={{ x: 0, y: 0 }}
            exit={dockedExit}
            transition={{ type: "spring", damping: 30, stiffness: 300 }}
            className={dockedClassName}
          >
            {panelContent}
          </motion.div>
        )}
      </AnimatePresence>
      {open && dockMode === "detached" && detachedContainer
        ? createPortal(
          <div className="flex h-screen w-full flex-col bg-panel text-fg">
            {panelContent}
          </div>,
          detachedContainer,
        )
        : null}
    </>
  );
}
