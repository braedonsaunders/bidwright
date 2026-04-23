"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { AlertTriangle, ArrowDown, Bot, CheckCircle2, ChevronDown, ChevronRight, FileText, FileSpreadsheet, FileImage, FolderSearch, Loader2, RefreshCw, Search, Send, Sparkles, Square, X, XCircle, Wrench } from "lucide-react";
import { Badge, Button, Select, Textarea } from "@/components/ui";
import {
  getSettings,
  startCliSession, connectCliStream, stopCliSession, resumeCliSession, sendCliMessage, getCliStatus, detectCli,
  getCliPendingQuestion, answerCliQuestion,
  getProjectWorkspace,
  listPersonas, type EstimatorPersona,
} from "@/lib/api";
import { cn } from "@/lib/utils";
import { isVisionTool, VisionToolWidget, ProgressIndicator } from "./vision-chat-widgets";
import { MarkdownRenderer } from "@/components/markdown-renderer";

// Types

interface ToolCallEntry {
  id: string;
  toolId: string;
  input: unknown;
  result: { success: boolean; data?: unknown; error?: string; sideEffects?: string[]; duration_ms: number };
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
  autoStartIntake?: boolean;
  onIntakeStarted?: () => void;
  onWorkspaceMutated?: () => void;
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

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:4001";

function authHeaders(): Record<string, string> {
  return { "Content-Type": "application/json" };
}

function intakeStorageKey(projectId: string) {
  return `bw_intake_${projectId}`;
}

type CliRuntime = "claude-code" | "codex";
type CliModelOption = { id: string; name: string; description: string };

function isCliRuntime(value: unknown): value is CliRuntime {
  return value === "claude-code" || value === "codex";
}

function isClaudeCliModel(model: string) {
  return ["default", "best", "sonnet", "opus", "haiku", "sonnet[1m]", "opus[1m]", "opusplan"].includes(model) || model.startsWith("claude-");
}

function isCodexCliModel(model: string) {
  return !!model.trim() && !isClaudeCliModel(model);
}

function defaultCliModel(runtime: CliRuntime) {
  return runtime === "codex" ? "gpt-5.4" : "sonnet";
}

function normalizeCliModel(runtime: CliRuntime, model: string | null | undefined) {
  if (runtime === "codex") {
    return model && isCodexCliModel(model) ? model : defaultCliModel(runtime);
  }
  return model && isClaudeCliModel(model) ? model : defaultCliModel(runtime);
}

function getAutoCliRuntime(availability: { claude: boolean; codex: boolean }): CliRuntime | null {
  if (availability.claude) return "claude-code";
  if (availability.codex) return "codex";
  return null;
}

const MUTATING_TOOL_PATTERNS = /^(quote\.(create|update|delete)|knowledge\.(add|update|remove|ingest|index)|system\.logActivity|mcp__bidwright__(create|update|delete|import|recalculate))/;

function hasMutatingToolCalls(toolCalls: Array<{ toolId: string; result?: { sideEffects?: string[] } }>): boolean {
  return toolCalls.some(
    (tc) => MUTATING_TOOL_PATTERNS.test(tc.toolId) || (tc.result?.sideEffects && tc.result.sideEffects.length > 0),
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
        <span className="text-[11px] font-medium text-fg/50 truncate">{tc.toolId}</span>
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

function findAnswerForAskUser(events: any[], askIndex: number): string | null {
  const askEvent = events[askIndex];
  const askId = askEvent?.data?.questionId || askEvent?.data?.id || null;
  for (let i = askIndex + 1; i < events.length; i += 1) {
    const event = events[i];
    if (!event) continue;
    if (event.type === "askUser" || event.type === "run_divider") break;
    if (event.type === "userAnswer") {
      const answerId = event?.data?.questionId || null;
      if (askId && answerId && answerId !== askId) continue;
      return typeof event.data?.answer === "string" ? event.data.answer : null;
    }
  }

  return null;
}

function isDuplicateAskUserEvent(events: any[], askIndex: number): boolean {
  const current = events[askIndex];
  const currentId = current?.data?.questionId || current?.data?.id || null;
  const currentQuestion = normalizePromptText(current?.data?.question || "");
  if (!currentQuestion && !currentId) return false;

  for (let i = askIndex - 1; i >= 0; i -= 1) {
    const event = events[i];
    if (!event) continue;
    if (event.type === "userAnswer" || event.type === "run_divider") break;
    if (event.type !== "askUser") continue;

    const priorId = event?.data?.questionId || event?.data?.id || null;
    if (currentId && priorId && priorId !== currentId) continue;
    const priorQuestion = normalizePromptText(event?.data?.question || "");
    if (!currentId && priorQuestion !== currentQuestion) continue;

    return !findAnswerForAskUser(events, i);
  }

  return false;
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

    if (prompt.question && hasOpenAskUserEvent(timeline, prompt)) {
      return timeline;
    }
  }

  if (event?.type === "userAnswer") {
    const lastEvent = timeline[timeline.length - 1];
    if (
      lastEvent?.type === "userAnswer"
      && normalizePromptText(lastEvent?.data?.answer || "") === normalizePromptText(event?.data?.answer || "")
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
    <div className="rounded-lg border border-warning/30 bg-warning/5 p-4 space-y-3">
      <div className="flex items-center gap-2 text-xs font-medium text-warning">
        <AlertTriangle className="h-3.5 w-3.5" />
        Agent needs your input
      </div>
      {prompt.context && (
        <p className="text-xs text-fg/50">{prompt.context}</p>
      )}

      {!hasQuestionnaire && (
        <>
          <div className="rounded-md border border-line/50 bg-bg/30 p-3 text-sm text-fg/85">
            <MarkdownRenderer content={prompt.question} />
          </div>

          {prompt.options && prompt.options.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {prompt.options.map((option, index) => (
                <button
                  key={`${option}-${index}`}
                  type="button"
                  disabled={isSubmitting}
                  onClick={() => topLevelAllowsMultiple ? toggleTopLevelSelection(option) : void submitAnswer(option)}
                  className={cn(
                    "inline-flex max-w-full items-start gap-1.5 rounded-md border px-3 py-1.5 text-left text-xs font-medium transition-colors",
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

          <div className="space-y-2">
            <Textarea
              value={customAnswer}
              onChange={(e) => setCustomAnswer(e.target.value)}
              placeholder="Type your answer..."
              className="min-h-24 text-xs"
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
        <div className="space-y-3">
          <div className="rounded-md border border-line/50 bg-bg/30 p-3 text-sm text-fg/85">
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
              <div key={question.id} className="rounded-md border border-line/50 bg-bg/20 p-3 space-y-2">
                <div className="text-[10px] font-medium uppercase tracking-wider text-fg/35">
                  Question {index + 1}
                </div>
                <p className="text-sm text-fg/90">{question.prompt}</p>
                {question.context && (
                  <p className="text-xs text-fg/50">{question.context}</p>
                )}
                <div className="flex flex-wrap gap-2">
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
                        "inline-flex max-w-full items-start gap-1.5 rounded-md border px-3 py-1.5 text-left text-xs font-medium transition-colors",
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
                  className="min-h-20 text-xs"
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
                    className="rounded-md border border-line/60 bg-bg/40 px-3 py-1.5 text-xs font-medium text-fg/75 transition-colors hover:bg-bg/60"
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

  return (
    <div className="rounded-lg border border-warning/25 bg-warning/[0.04] p-4 space-y-3">
      <div className="flex items-center gap-2 text-xs font-medium text-warning">
        <AlertTriangle className="h-3.5 w-3.5" />
        Agent asked for input
      </div>
      {prompt.context && (
        <p className="text-xs text-fg/50">{prompt.context}</p>
      )}
      <div className="rounded-md border border-line/50 bg-bg/30 p-3 text-sm text-fg/85">
        <MarkdownRenderer content={questionnaire?.summary || prompt.question} />
      </div>
      {questionnaire && questionnaire.questions.length > 0 && (
        <div className="space-y-2">
          {questionnaire.questions.map((question, index) => (
            <div key={question.id} className="rounded-md border border-line/40 bg-bg/20 px-3 py-2">
              <div className="text-[10px] font-medium uppercase tracking-wider text-fg/35">
                Question {index + 1}
              </div>
              <p className="mt-1 text-sm text-fg/90">{question.prompt}</p>
            </div>
          ))}
        </div>
      )}
      <div className="rounded-md border border-line/50 bg-bg/30 p-3">
        <div className="text-[10px] font-medium uppercase tracking-wider text-fg/35">
          {answer ? "Your answer" : "Status"}
        </div>
        {answer ? (
          <div className="mt-1 text-sm text-fg/85 whitespace-pre-wrap">
            <MarkdownRenderer content={answer} />
          </div>
        ) : (
          <p className="mt-1 text-sm text-warning">Waiting for answer</p>
        )}
      </div>
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
}

export function AgentChat({ projectId, open, onClose, autoStartIntake, onIntakeStarted, onWorkspaceMutated }: AgentChatProps) {
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
  const [docsExpanded, setDocsExpanded] = useState(false);
  const [cliModels, setCliModels] = useState<{ claude: CliModelOption[]; codex: CliModelOption[] }>({ claude: [], codex: [] });
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
  const inputRef = useRef<HTMLInputElement>(null);
  const lastRefreshToolCount = useRef(0);
  const eventSourceRef = useRef<EventSource | null>(null);
  const sseReconnectCount = useRef(0);
  const pollFailCount = useRef(0);
  const intakeScopeEditedRef = useRef(false);
  const effectiveCliModel = cliRuntime ? normalizeCliModel(cliRuntime, cliAgentModel) : null;

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
          data: { answer },
        }),
      } as any;
    });
  }, []);

  // Load CLI runtime and personas from org settings
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

      const availability = {
        claude: cliResult.status === "fulfilled" ? cliResult.value.claude.available : false,
        codex: cliResult.status === "fulfilled" ? cliResult.value.codex.available : false,
      };
      if (cliResult.status === "fulfilled") {
        setCliModels({
          claude: cliResult.value.claude.models || [],
          codex: cliResult.value.codex.models || [],
        });
      }

      const configuredRuntime = isCliRuntime(integ?.agentRuntime)
        ? integ.agentRuntime
        : cliResult.status === "fulfilled" && isCliRuntime(cliResult.value.configured?.runtime)
          ? cliResult.value.configured.runtime
          : null;
      const configuredModel = integ?.agentModel
        ?? (cliResult.status === "fulfilled" ? cliResult.value.configured?.model : null);
      const resolvedRuntime = configuredRuntime ?? getAutoCliRuntime(availability);
      setCliRuntime(resolvedRuntime);
      setCliAgentModel(resolvedRuntime ? normalizeCliModel(resolvedRuntime, configuredModel) : null);

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
        const res = await fetch(`${API_BASE}/projects/${projectId}/ingestion-status`, {
          headers: authHeaders(),
          credentials: "include",
        });
        if (!res.ok) return;
        const data = await res.json();
        if (active) {
          setIngestionStatus(data.status);
          setIngestionDocs(data.documents ?? []);
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
        const restoredTools: ToolCallEntry[] = events
          .filter((e: any) => e.type === "tool_call")
          .map((e: any, i: number) => ({
            id: e.data?.toolUseId || `restored-tc-${i}`,
            toolId: e.data?.toolId || "unknown",
            input: e.data?.input || {},
            result: { success: true, duration_ms: 0 },
          }));
        setLiveToolCalls(restoredTools);

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

  // Auto-scroll only when user hasn't manually scrolled up
  useEffect(() => {
    if (!isUserScrolledUp) {
      messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages, liveToolCalls, isUserScrolledUp, cliPendingQuestion]);

  // Track user scroll position
  const handleScroll = useCallback(() => {
    const el = scrollContainerRef.current;
    if (!el) return;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    setIsUserScrolledUp(distanceFromBottom > 80);
  }, []);

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    setIsUserScrolledUp(false);
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
        const result = await sendCliMessage(projectId, content.trim());
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

      throw new Error("Bidwright AI now uses the CLI runtime only. Configure and authenticate Claude Code or Codex in Agent Runtime settings before chatting.");
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

  async function handleStartIntake() {
    setIntakeLoading(true);
    setLiveToolCalls([]);
    setThinkingBlocks([]);
    lastRefreshToolCount.current = 0;
    try {
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
            return;
          }
        } catch {}
      }

      if (cliRuntime) {
        // CLI-based intake (preferred)
        // Use the agent model from org settings, falling back to sensible defaults
        const cliModel = normalizeCliModel(cliRuntime, cliAgentModel);
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
      } else {
        throw new Error("AI estimating now uses the CLI runtime only. Configure and authenticate Claude Code or Codex in Agent Runtime settings before starting a run.");
      }
    } catch (err) {
      setSessionError(err instanceof Error ? err.message : "Failed to start intake agent");
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
    setSseConnected(true);
    sseReconnectCount.current = 0; // Reset backoff on successful connection

    let toolCount = 0;
    let msgCount = 0;

    es.addEventListener("thinking", (e) => {
      const data = JSON.parse(e.data);
      setThinkingBlocks((prev) => [...prev.slice(-5), { id: `think-${Date.now()}`, content: data.content }]);
    });

    es.addEventListener("tool_call", (e) => {
      const data = JSON.parse(e.data);
      toolCount++;
      setLiveToolCalls((prev) => [...prev, {
        id: data.toolUseId || `tc-${toolCount}`,
        toolId: data.toolId,
        input: data.input,
        result: { success: true, duration_ms: 0 }, // Updated when tool_result arrives
      }]);
      setIntakeStatus((prev) => prev ? { ...prev, toolCallCount: toolCount } : prev);
      // Refresh workspace when mutating tools are called
      if (data.toolId && MUTATING_TOOL_PATTERNS.test(data.toolId)) {
        onWorkspaceMutated?.();
      }
    });

    es.addEventListener("tool_result", (e) => {
      const data = JSON.parse(e.data);
      // Update the matching tool call with result
      setLiveToolCalls((prev) => {
        const updated = [...prev];
        const match = [...updated].reverse().find((tc) => tc.id === data.toolUseId || !tc.result.duration_ms);
        if (match) {
          match.result = {
            success: !data.content?.includes("error"),
            duration_ms: data.duration_ms || 0,
            data: data.content,
          };
        }
        return updated;
      });
    });

    es.addEventListener("message", (e) => {
      const data = JSON.parse(e.data);
      msgCount++;
      setMessages((prev) => [...prev, {
        id: `cli-msg-${msgCount}`,
        role: data.role || "assistant",
        content: data.content,
        timestamp: new Date().toISOString(),
      }]);
      setIntakeStatus((prev) => prev ? { ...prev, messageCount: msgCount } : prev);
    });

    es.addEventListener("progress", (e) => {
      const data = JSON.parse(e.data);
      setMessages((prev) => [...prev, {
        id: `progress-${Date.now()}`,
        role: "assistant",
        content: `[${data.phase}] ${data.detail}`,
        timestamp: new Date().toISOString(),
      }]);
    });

    es.addEventListener("file_read", (e) => {
      const data = JSON.parse(e.data);
      // Show as a subtle indicator, not a full message
      setThinkingBlocks((prev) => [...prev.slice(-5), { id: `file-${Date.now()}`, content: `Reading: ${data.fileName}` }]);
    });

    es.addEventListener("askUser", (e) => {
      try {
        const data = JSON.parse(e.data);
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
        recordCliAnswer(data.answer);
      } catch {
        setIntakeStatus((prev) => prev ? { ...(prev as any), status: "running" } as any : prev);
      }
    });

    es.addEventListener("status", (e) => {
      const data = JSON.parse(e.data);
      if (data.status === "completed" || data.status === "stopped" || data.status === "failed") {
        setIntakeStatus((prev) => prev ? { ...prev, status: data.status } : prev);
        setSseConnected(false);
        es.close();
        eventSourceRef.current = null;
        window.setTimeout(() => {
          void getCliStatus(projectId)
          .then((latest) => {
            const events = latest.events || [];
            const tools = events.filter((evt: any) => evt.type === "tool_call");
            const msgs = events.filter((evt: any) => evt.type === "message");

            setLiveToolCalls(tools.map((evt: any, i: number) => ({
              id: evt.data?.toolUseId || `terminal-tc-${i}`,
              toolId: evt.data?.toolId || "unknown",
              input: evt.data?.input || {},
              result: { success: true, duration_ms: 0 },
            })));
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
      setSseConnected(false);
      if (es.readyState !== EventSource.CLOSED || eventSourceRef.current !== es) {
        // EventSource may auto-recover - check on next tick
        if (es.readyState === EventSource.OPEN) setSseConnected(true);
        return;
      }

      // Connection fully closed - check actual backend status before reconnecting
      const attempt = sseReconnectCount.current;
      const MAX_SSE_RECONNECTS = 8;
      if (attempt >= MAX_SSE_RECONNECTS) {
        console.warn("[sse] Max reconnect attempts reached, giving up");
        es.close();
        eventSourceRef.current = null;
        setSessionError("Lost connection to agent session. Refresh the page to check status.");
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
            es.close();
            eventSourceRef.current = null;
            sseReconnectCount.current = 0;
            setIntakeStatus((prev) => prev ? { ...prev, status: data.status as any } : prev);
            onWorkspaceMutated?.();
            return;
          }
        } catch {
          // 404 or network error - session is gone
          es.close();
          eventSourceRef.current = null;
          sseReconnectCount.current = 0;
          setIntakeStatus((prev) => prev ? { ...prev, status: "failed" } : prev);
          setSessionError("Agent session ended unexpectedly.");
          onWorkspaceMutated?.();
          return;
        }

        // Session still running - reconnect SSE
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
          const tools = events.filter((e: any) => e.type === "tool_call");
          setLiveToolCalls(tools.map((e: any, i: number) => ({
            id: e.data?.toolUseId || `poll-tc-${i}`,
            toolId: e.data?.toolId || "unknown",
            input: e.data?.input || {},
            result: { success: true, duration_ms: 0 },
          })));

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
            toolCallCount: tools.length,
            messageCount: msgs.length,
            events,
          } : prev);

          // Refresh workspace if there are new mutating tool calls since last poll
          const mutatingTools = tools.filter((e: any) => MUTATING_TOOL_PATTERNS.test(e.data?.toolId || ""));
          if (mutatingTools.length > lastRefreshToolCount.current) {
            lastRefreshToolCount.current = mutatingTools.length;
            onWorkspaceMutated?.();
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

  // Auto-start intake ONLY when redirected from upload AND no existing session
  // The restore useEffect (above) runs first and sets intakeSessionId if a session exists
  useEffect(() => {
    if (autoStartIntake && open && settingsReady && !intakeAutoStarted.current && !intakeSessionId && !restoredFromDb.current) {
      // Small delay to let the restore finish first
      const timer = setTimeout(() => {
        if (!intakeAutoStarted.current && !intakeSessionId) {
          intakeAutoStarted.current = true;
          handleStartIntake();
          onIntakeStarted?.();
        }
      }, 1500);
      return () => clearTimeout(timer);
    }
  }, [autoStartIntake, open, settingsReady, intakeSessionId]);

  const isIntakeRunning = intakeStatus?.status === "running" || intakeStatus?.status === "waiting_for_user";
  const isIntakeComplete = intakeStatus?.status === "completed";
  const isIntakeFailed = intakeStatus?.status === "failed";
  const isWaitingForUser = intakeStatus?.status === "waiting_for_user";
  const showIntakeSetupCard = messages.length === 0 || Boolean(intakeStatus) || intakeLoading;
  const timelineEvents: any[] = (intakeStatus as any)?.events ?? [];
  const hasInlineCliPendingQuestion = Boolean(
    cliPendingQuestion && timelineEvents.some((evt, index) =>
      evt.type === "askUser"
      && promptMatchesAskUserEvent(cliPendingQuestion, evt)
      && !findAnswerForAskUser(timelineEvents, index),
    ),
  );

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ x: "100%" }}
          animate={{ x: 0 }}
          exit={{ x: "100%" }}
          transition={{ type: "spring", damping: 30, stiffness: 300 }}
          className="fixed inset-y-0 right-0 z-50 flex w-full max-w-md flex-col border-l border-line bg-panel shadow-2xl"
        >
          {/* Header */}
          <div className="flex items-center justify-between border-b border-line px-4 py-3">
            <div className="flex items-center gap-2">
              <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-accent/10">
                <Sparkles className="h-3.5 w-3.5 text-accent" />
              </div>
              <div>
                <div className="text-sm font-semibold">Bidwright AI</div>
                <div className="text-[10px] text-fg/35">
                  {cliRuntime ? `${cliRuntime === "claude-code" ? "Claude Code" : "Codex"} CLI \u00B7 ${effectiveCliModel}` : "CLI runtime required"}
                  {sseConnected && <span className="ml-1 text-success">connected</span>}
                </div>
              </div>
            </div>
            <div className="flex items-center gap-2">
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
          <div className="relative flex-1 overflow-y-auto p-4 space-y-2" ref={scrollContainerRef} onScroll={handleScroll}>
            {/* Intake setup */}
            {showIntakeSetupCard && (
              <div className="space-y-3 rounded-lg border border-line bg-bg/20 p-3">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <div className="text-[11px] font-medium uppercase tracking-wider text-fg/40">
                      Estimate Setup
                    </div>
                    <div className="text-[10px] text-fg/30">
                      Persona and scope instructions used for AI estimating.
                    </div>
                  </div>
                  {(isIntakeRunning || intakeLoading) && (
                    <Badge tone="info" className="text-[10px]">
                      In progress
                    </Badge>
                  )}
                </div>
                {/* Persona selection */}
                {personas.length > 0 && (
                  <div className="space-y-1.5">
                    <label className="text-[11px] font-medium text-fg/40 uppercase tracking-wider">
                      Estimator Persona
                    </label>
                    <Select
                      className="h-8 text-xs"
                      value={selectedPersonaId ?? ""}
                      onChange={(e) => setSelectedPersonaId(e.target.value || null)}
                    >
                      <option value="">No persona (generic estimator)</option>
                      {personas.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name} - {p.trade}
                        </option>
                      ))}
                    </Select>
                    {selectedPersonaId && (
                      <div className="text-[10px] text-fg/30 leading-tight">
                        {personas.find(p => p.id === selectedPersonaId)?.description || "Custom estimation persona"}
                      </div>
                    )}
                  </div>
                )}
                {/* Model selection */}
                {cliRuntime && (
                  <div className="space-y-1.5">
                    <label className="text-[11px] font-medium text-fg/40 uppercase tracking-wider">
                      Model
                    </label>
                    <Select
                      className="h-8 text-xs"
                      value={effectiveCliModel || defaultCliModel(cliRuntime)}
                      onChange={(e) => setCliAgentModel(e.target.value)}
                    >
                      {(() => {
                        const runtimeModels = cliRuntime === "claude-code" ? cliModels.claude : cliModels.codex;
                        const options = runtimeModels.filter((option, index) => runtimeModels.findIndex((candidate) => candidate.id === option.id) === index);
                        const selectedModel = effectiveCliModel || defaultCliModel(cliRuntime);
                        const displayOptions = options.some((option) => option.id === selectedModel)
                          ? options
                          : [
                              ...options,
                              {
                                id: selectedModel,
                                name: selectedModel,
                                description: "Current configured model",
                              },
                            ];
                        return displayOptions.map((option) => (
                          <option key={option.id} value={option.id}>
                            {option.name} - {option.description}
                          </option>
                        ));
                      })()}
                    </Select>
                  </div>
                )}
                <div className="space-y-1.5">
                  <label className="text-[11px] font-medium text-fg/40 uppercase tracking-wider">
                    Estimator Brief
                  </label>
                  <Textarea
                    value={intakeScope}
                    onChange={(e) => {
                      intakeScopeEditedRef.current = true;
                      setIntakeScope(e.target.value);
                    }}
                    placeholder="Commercial or scope instructions for this estimate. Example: subcontract rigging and electrical; shop fab is already quoted at $43,000; mechanical install only."
                    className="min-h-24 text-xs"
                  />
                  <div className="text-[10px] text-fg/35">
                    Passed into the AI estimate workflow as authoritative scope and commercial direction.
                  </div>
                </div>
                {isIntakeRunning ? (
                  <div className="rounded-lg border border-line/60 bg-panel2/40 px-3 py-2 text-[11px] text-fg/45">
                    Changes here do not affect the current run. They stay visible so you can review or adjust them before retrying.
                  </div>
                ) : (
                  <button
                    onClick={handleStartIntake}
                    disabled={intakeLoading || !cliRuntime}
                    className="w-full rounded-lg border border-accent/30 bg-accent/5 px-4 py-3 text-left transition-colors hover:bg-accent/10 disabled:opacity-50"
                  >
                    <div className="flex items-center gap-2">
                      {intakeLoading ? (
                        <Loader2 className="h-4 w-4 animate-spin text-accent" />
                      ) : (
                        <Sparkles className="h-4 w-4 text-accent" />
                      )}
                      <span className="text-sm font-medium text-accent">
                        {intakeStatus ? "Start New AI Run" : "Start AI Estimating"}
                      </span>
                    </div>
                    <div className="mt-1 text-[11px] text-fg/40">
                      Automatically review bid documents and build a complete estimate
                    </div>
                  </button>
                )}
                {!cliRuntime && (
                  <div className="rounded-lg border border-warning/25 bg-warning/5 px-3 py-2 text-[11px] text-fg/55">
                    AI estimating now runs only through the configured CLI runtime. Authenticate Claude Code or Codex in Agent Runtime settings to start a run.
                  </div>
                )}
              </div>
            )}

            {/* Document extraction event (collapsible, starts minimized) */}
            {ingestionDocs.length > 0 && (
              <div className="rounded-lg border border-line px-3 py-2 text-xs">
                <button className="flex w-full items-center gap-2 text-left" onClick={() => setDocsExpanded(!docsExpanded)}>
                  {docsExpanded ? <ChevronDown className="h-3 w-3 text-fg/30 shrink-0" /> : <ChevronRight className="h-3 w-3 text-fg/30 shrink-0" />}
                  {ingestionStatus === "processing" ? (
                    <Loader2 className="h-3 w-3 animate-spin text-accent shrink-0" />
                  ) : (
                    <CheckCircle2 className="h-3 w-3 text-success shrink-0" />
                  )}
                  <span className="font-medium text-fg/60">
                    {ingestionStatus === "processing" ? "Extracting documents..." : `${ingestionDocs.length} documents extracted`}
                  </span>
                  <span className="ml-auto text-[9px] text-fg/25">{ingestionDocs.filter(d => d.hasText).length}/{ingestionDocs.length} with text</span>
                </button>
                {docsExpanded && (
                <div className="mt-1.5 space-y-0.5">
                  {ingestionDocs.map((doc) => (
                    <div key={doc.id} className="flex items-center gap-1.5 text-[10px] text-fg/40">
                      {doc.hasText ? (
                        <CheckCircle2 className="h-2.5 w-2.5 text-success/60 shrink-0" />
                      ) : (
                        <XCircle className="h-2.5 w-2.5 text-fg/20 shrink-0" />
                      )}
                      <span className="truncate flex-1">{doc.fileName}</span>
                      <span className="text-[9px] text-fg/25 shrink-0">{doc.documentType}</span>
                      <span className="text-[9px] text-fg/20 shrink-0">{doc.pageCount}p</span>
                    </div>
                  ))}
                </div>
                )}
              </div>
            )}

            {/* Intake status header (compact) */}
            {intakeStatus && (
              <div className={cn(
                "rounded-lg border px-3 py-2 text-xs flex items-center gap-2",
                isIntakeRunning ? "border-accent/30 bg-accent/5" :
                isIntakeComplete ? "border-success/30 bg-success/5" :
                "border-danger/30 bg-danger/5"
              )}>
                {isWaitingForUser && <AlertTriangle className="h-3 w-3 text-warning shrink-0" />}
                {isIntakeRunning && !isWaitingForUser && <Loader2 className="h-3 w-3 animate-spin text-accent shrink-0" />}
                {isIntakeComplete && <CheckCircle2 className="h-3 w-3 text-success shrink-0" />}
                {isIntakeFailed && <XCircle className="h-3 w-3 text-danger shrink-0" />}
                {intakeStatus.status === "stopped" && <Square className="h-3 w-3 text-fg/40 shrink-0" />}
                <span className="font-medium">
                  {isWaitingForUser ? "Waiting for your input..." :
                   isIntakeRunning ? "AI Estimating..." :
                   isIntakeComplete ? "AI Estimating complete" :
                   intakeStatus.status === "stopped" ? "AI Estimating stopped" :
                   "AI Estimating failed"}
                </span>
                <span className="ml-auto text-fg/30">
                  {intakeStatus.toolCallCount} tools {"\u00B7"} {intakeStatus.messageCount} msgs
                </span>
                {isIntakeRunning && (
                  <button
                    onClick={async () => {
                      try {
                        await stopCliSession(projectId);
                        setIntakeStatus((prev) => prev ? { ...prev, status: "stopped" as any } : prev);
                        if (eventSourceRef.current) { eventSourceRef.current.close(); eventSourceRef.current = null; }
                      } catch {}
                    }}
                    className="ml-auto rounded p-1 text-fg/30 hover:bg-danger/10 hover:text-danger"
                    title="Stop agent"
                  >
                    <Square className="h-3.5 w-3.5" />
                  </button>
                )}
                {(intakeStatus.status === "stopped" || isIntakeFailed) && (
                  <button
                    onClick={() => { void retryIntakeSession(); }}
                    className="ml-auto rounded p-1 text-fg/30 hover:bg-accent/10 hover:text-accent"
                    title="Resume / Restart"
                  >
                    <RefreshCw className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
            )}

            {/* CLI pending question moved to bottom - see before messagesEndRef */}

            {/* Unified chronological stream - all events from DB in order */}
            {(() => {
              // Build timeline from ALL event types, in order (DB events are chronological)
              const events: any[] = timelineEvents;

              return events.map((evt: any, i: number) => {
                const t = evt.type;
                const key = `evt-${i}`;

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
                  return (
                    <div key={key} className={cn("flex", role === "user" ? "justify-end" : "justify-start")}>
                      <div className={cn(
                        "max-w-[90%] rounded-lg px-3 py-2 text-sm",
                        role === "user" ? "bg-accent/15 text-fg" : "bg-panel2/60 text-fg/85"
                      )}>
                        <MarkdownRenderer content={content} />
                      </div>
                    </div>
                  );
                }

                if (t === "askUser") {
                  const prompt = evt.data as PendingQuestionPrompt;
                  if (!prompt?.question) return null;
                  if (isDuplicateAskUserEvent(events, i)) return null;
                  const answer = findAnswerForAskUser(events, i);
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

                // Tool call
                if (t === "tool_call" || t === "tool") {
                  const toolId = evt.data?.toolId || "unknown";
                  const tc: ToolCallEntry = {
                    id: `tc-${i}`,
                    toolId,
                    input: evt.data?.input || {},
                    result: { success: evt.data?.success ?? true, duration_ms: evt.data?.duration_ms ?? 0 },
                  };
                  if (isAgentTool(toolId)) {
                    return <AgentWidget key={key} tc={tc} isRunning={isIntakeRunning} />;
                  }
                  if (isFileAccessTool(toolId)) {
                    return <FileAccessWidget key={key} tc={tc} />;
                  }
                  if (typeof isVisionTool === "function" && isVisionTool(toolId)) {
                    return (
                      <VisionToolWidget key={key} toolId={toolId} input={tc.input} result={tc.result} />
                    );
                  }
                  return <ToolCallDetail key={key} tc={tc} />;
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

            {/* Loading indicator */}
            {(isLoading || isIntakeRunning) && (
              <div className="flex items-center gap-1.5 text-[10px] text-fg/30 py-1">
                <Loader2 className="h-3 w-3 animate-spin" />
                {isIntakeRunning ? (sseConnected ? "Agent working (live)..." : "Agent working...") : "Thinking..."}
              </div>
            )}

            {/* Pending question from CLI agent (askUser MCP tool) - rendered at bottom so auto-scroll keeps it visible */}
            {cliRuntime && cliPendingQuestion && !hasInlineCliPendingQuestion && (
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

            {/* Scroll to bottom button */}
            {isUserScrolledUp && (
              <button
                onClick={scrollToBottom}
                className="sticky bottom-2 left-1/2 -translate-x-1/2 z-10 flex items-center gap-1 rounded-full bg-panel2 border border-line shadow-lg px-3 py-1.5 text-[10px] text-fg/60 hover:text-fg hover:bg-panel2/80 transition-all"
              >
                <ArrowDown className="h-3 w-3" />
                New messages
              </button>
            )}
          </div>

          {/* Input */}
          <div className="border-t border-line p-3">
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
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
