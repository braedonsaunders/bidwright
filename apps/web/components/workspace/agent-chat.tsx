"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { AlertTriangle, CheckCircle2, ChevronDown, ChevronRight, FileText, FileSpreadsheet, FileImage, FolderSearch, Loader2, RefreshCw, Search, Send, Sparkles, Square, X, XCircle, Wrench } from "lucide-react";
import { Badge, Button, EmptyState, Select } from "@/components/ui";
import {
  startIntake, getIntakeStatus, stopIntake, getSettings, type IntakeStatusResult,
  startCliSession, connectCliStream, stopCliSession, resumeCliSession, sendCliMessage, getCliStatus, detectCli,
} from "@/lib/api";
import { cn } from "@/lib/utils";
import { isVisionTool, VisionToolWidget, ProgressIndicator } from "./vision-chat-widgets";

// ─── Types ────────────────────────────────────────────────────────────

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

// ─── Helpers ──────────────────────────────────────────────────────────

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:4001";

function authHeaders(): Record<string, string> {
  const token = typeof window !== "undefined" ? localStorage.getItem("bw_token") : null;
  const h: Record<string, string> = { "Content-Type": "application/json" };
  if (token) h["Authorization"] = `Bearer ${token}`;
  return h;
}

function intakeStorageKey(projectId: string) {
  return `bw_intake_${projectId}`;
}

const MUTATING_TOOL_PATTERNS = /^(quote\.(create|update|delete)|knowledge\.(add|update|remove|ingest|index)|system\.logActivity|mcp__bidwright__(create|update|delete|import|recalculate))/;

function hasMutatingToolCalls(toolCalls: Array<{ toolId: string; result?: { sideEffects?: string[] } }>): boolean {
  return toolCalls.some(
    (tc) => MUTATING_TOOL_PATTERNS.test(tc.toolId) || (tc.result?.sideEffects && tc.result.sideEffects.length > 0),
  );
}

const QUICK_PROMPTS = [
  "Summarize the project scope",
  "What are the key risks?",
  "Suggest phases for this project",
  "Check if the estimate is complete",
  "What equipment do we need?",
  "Identify gaps in the bid package",
];

// ─── File Access Detection ────────────────────────────────────────────

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

// ─── File Access Widget ───────────────────────────────────────────────

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

// ─── Tool Call Detail ─────────────────────────────────────────────────

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
          {tc.result.data != null && (
            <pre className="max-h-40 overflow-auto rounded bg-bg/50 p-1.5 text-[10px] text-fg/50 whitespace-pre-wrap break-all">
              {typeof tc.result.data === "string" ? tc.result.data : JSON.stringify(tc.result.data, null, 2)}
            </pre>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Live Tool Call Feed ──────────────────────────────────────────────

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

// ─── Main Component ───────────────────────────────────────────────────

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
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [provider, setProvider] = useState("anthropic");
  const [model, setModel] = useState("claude-sonnet-4-20250514");
  const [settingsReady, setSettingsReady] = useState(false);
  const [sessionError, setSessionError] = useState<string | null>(null);
  const [intakeSessionId, setIntakeSessionId] = useState<string | null>(null);
  const [intakeStatus, setIntakeStatus] = useState<IntakeStatusResult | null>(null);
  const [intakeLoading, setIntakeLoading] = useState(false);
  const [liveToolCalls, setLiveToolCalls] = useState<ToolCallEntry[]>([]);
  const [ingestionStatus, setIngestionStatus] = useState<string | null>(null);
  const [ingestionDocs, setIngestionDocs] = useState<IngestionDoc[]>([]);
  const [docsExpanded, setDocsExpanded] = useState(false);
  const [cliAvailable, setCliAvailable] = useState<{ claude: boolean; codex: boolean }>({ claude: false, codex: false });
  const [cliRuntime, setCliRuntime] = useState<"claude-code" | "codex" | null>(null);
  const [sseConnected, setSseConnected] = useState(false);
  const [thinkingBlocks, setThinkingBlocks] = useState<Array<{ id: string; content: string }>>([]);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const lastRefreshToolCount = useRef(0);
  const eventSourceRef = useRef<EventSource | null>(null);

  // Load default provider/model from org settings + detect CLIs
  useEffect(() => {
    Promise.all([
      getSettings().then((s) => {
        const integ = s?.integrations;
        if (integ?.llmProvider) setProvider(integ.llmProvider);
        if (integ?.llmModel) setModel(integ.llmModel);
        // Use configured runtime if set
        if (integ?.agentRuntime) setCliRuntime(integ.agentRuntime);
      }).catch(() => {}),
      detectCli().then((result) => {
        setCliAvailable({ claude: result.claude.available, codex: result.codex.available });
        // Auto-select best available runtime
        if (!cliRuntime) {
          if (result.claude.available) setCliRuntime("claude-code");
          else if (result.codex.available) setCliRuntime("codex");
        }
      }).catch(() => {}),
    ]).finally(() => setSettingsReady(true));
  }, []);

  // Poll ingestion status to show document extraction progress
  useEffect(() => {
    if (!open) return;
    let active = true;
    const poll = async () => {
      try {
        const res = await fetch(`${API_BASE}/projects/${projectId}/ingestion-status`, { headers: authHeaders() });
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

  // Restore latest session on mount (try CLI first, then legacy intake)
  useEffect(() => {
    // Try CLI status first
    getCliStatus(projectId)
      .then((data) => {
        if (data.status === "none") throw new Error("no cli session");
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
      .catch(() => {
        // Fall back to legacy intake session
        fetch(`${API_BASE}/api/intake/project/${projectId}/latest`, { headers: authHeaders() })
          .then(r => r.ok ? r.json() : null)
          .then(data => {
            if (!data) return;
            setIntakeSessionId(data.sessionId);
            setIntakeStatus({
              sessionId: data.sessionId, projectId, scope: "",
              status: data.status === "running" ? "running" : data.status === "stopped" ? ("stopped" as any) : data.status === "failed" ? "failed" : "completed",
              toolCallCount: data.toolCallCount ?? 0, messageCount: data.messageCount ?? 0,
              summary: data.summary, createdAt: "", updatedAt: "", recentToolCalls: [],
              events: data.events,
            } as any);
          })
          .catch(() => {});
      });
  }, [projectId]);

  useEffect(() => {
    if (open && inputRef.current) {
      inputRef.current.focus();
    }
  }, [open]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, liveToolCalls]);

  const intakeAutoStarted = useRef(false);

  const createSession = useCallback(async () => {
    try {
      setSessionError(null);
      const res = await fetch(`${API_BASE}/api/agent/sessions`, {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({ projectId, provider, model }),
      });
      if (!res.ok) {
        throw new Error(`Session creation failed (${res.status})`);
      }
      const data = await res.json();
      setSessionId(data.sessionId);
      return data.sessionId;
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to create session";
      setSessionError(msg);
      return null;
    }
  }, [projectId, provider, model]);

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

      // Legacy API-based chat
      let sid = sessionId;
      if (!sid) {
        sid = await createSession();
        if (!sid) throw new Error("Failed to create session");
      }

      const res = await fetch(`${API_BASE}/api/agent/sessions/${sid}/messages`, {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({ content: content.trim(), provider, model }),
      });
      const data = await res.json();

      const assistantMsg: ChatMessage = {
        id: `msg-${Date.now()}-resp`,
        role: "assistant",
        content: data.message,
        toolCalls: data.toolCallsExecuted,
        timestamp: new Date().toISOString(),
      };
      setMessages((prev) => [...prev, assistantMsg]);

      if (data.toolCallsExecuted?.length && hasMutatingToolCalls(data.toolCallsExecuted)) {
        onWorkspaceMutated?.();
      }
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
            // Session already running — just reconnect to it
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
        // Use the agent-specific model, not the legacy LLM model setting
        const cliModel = cliRuntime === "claude-code" ? "sonnet" : "gpt-5.4";
        const result = await startCliSession({ projectId, runtime: cliRuntime, model: cliModel });
        setIntakeSessionId(result.sessionId);
        setIntakeStatus({
          sessionId: result.sessionId, projectId, scope: "", status: "running",
          toolCallCount: 0, messageCount: 0, summary: null,
          createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), recentToolCalls: [],
        });
        // Connect SSE stream
        connectToSseStream(projectId);
      } else {
        // Legacy API-based intake (fallback)
        const result = await startIntake({ projectId, provider, model });
        setIntakeSessionId(result.sessionId);
        localStorage.setItem(intakeStorageKey(projectId), JSON.stringify({ sessionId: result.sessionId }));
        setIntakeStatus({
          sessionId: result.sessionId, projectId: result.projectId, scope: result.scope, status: "running",
          toolCallCount: 0, messageCount: 0, summary: null,
          createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), recentToolCalls: [],
        });
      }
    } catch (err) {
      setSessionError(err instanceof Error ? err.message : "Failed to start intake agent");
    } finally {
      setIntakeLoading(false);
    }
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
        const match = updated.findLast((tc) => tc.id === data.toolUseId || !tc.result.duration_ms);
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

    es.addEventListener("status", (e) => {
      const data = JSON.parse(e.data);
      if (data.status === "completed" || data.status === "stopped" || data.status === "failed") {
        setIntakeStatus((prev) => prev ? { ...prev, status: data.status } : prev);
        setSseConnected(false);
        es.close();
        eventSourceRef.current = null;
        onWorkspaceMutated?.(); // Final refresh
      }
    });

    es.addEventListener("error", (e) => {
      // Try to parse error data
      try {
        const data = JSON.parse((e as any).data);
        setSessionError(data.message);
      } catch {
        // SSE connection error — might reconnect automatically
      }
    });

    es.onerror = () => {
      setSseConnected(false);
      // EventSource auto-reconnects, but if the session is done, close
      const status = intakeStatus?.status;
      if (status && status !== "running") {
        es.close();
        eventSourceRef.current = null;
      }
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

  // Poll CLI status as fallback when SSE isn't connected (ensures events show up)
  useEffect(() => {
    if (!intakeSessionId || !cliRuntime) return;
    const status = intakeStatus?.status;
    if (status !== "running") return;

    const poll = async () => {
      try {
        const data = await getCliStatus(projectId);
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

        if (data.status !== "running") {
          setIntakeStatus((prev) => prev ? { ...prev, status: data.status as any } : prev);
          onWorkspaceMutated?.();
        }
      } catch {}
    };

    const interval = setInterval(poll, 5000);
    return () => clearInterval(interval);
  }, [intakeSessionId, intakeStatus?.status, cliRuntime, projectId]);

  // Auto-start intake when redirected from upload (wait for settings to load first)
  useEffect(() => {
    if (autoStartIntake && open && settingsReady && !intakeAutoStarted.current && !intakeSessionId) {
      intakeAutoStarted.current = true;
      handleStartIntake();
      onIntakeStarted?.();
    }
  }, [autoStartIntake, open, settingsReady]);

  // Poll intake status with live tool call accumulation
  useEffect(() => {
    if (!intakeSessionId || intakeStatus?.status !== "running") return;
    const interval = setInterval(async () => {
      try {
        const status = await getIntakeStatus(intakeSessionId);
        setIntakeStatus(status);

        // Accumulate tool calls from the status response
        if (status.recentToolCalls.length > 0) {
          setLiveToolCalls((prev) => {
            // Only add new ones (compare count)
            const newCount = status.toolCallCount;
            if (newCount > prev.length) {
              // Map the recent tool calls with proper structure
              const all = status.recentToolCalls.map((tc: any, i: number) => ({
                id: `live-${i}`,
                toolId: tc.toolId,
                input: {},
                result: { success: tc.success, duration_ms: tc.duration_ms },
              }));
              return all;
            }
            return prev;
          });
        }

        // Refresh workspace when new mutating tool calls are detected
        if (status.toolCallCount > lastRefreshToolCount.current) {
          const hasNewMutations = status.recentToolCalls.some((tc: any) =>
            MUTATING_TOOL_PATTERNS.test(tc.toolId),
          );
          if (hasNewMutations) {
            lastRefreshToolCount.current = status.toolCallCount;
            onWorkspaceMutated?.();
          }
        }

        if (status.status !== "running") {
          clearInterval(interval);
          // Final refresh to catch any last mutations
          onWorkspaceMutated?.();
          // Update persisted state
          localStorage.setItem(intakeStorageKey(projectId), JSON.stringify({
            sessionId: intakeSessionId,
            status: status.status,
          }));
        }
      } catch {
        // Silently retry
      }
    }, 2000);
    return () => clearInterval(interval);
  }, [intakeSessionId, intakeStatus?.status, projectId]);

  const isIntakeRunning = intakeStatus?.status === "running";
  const isIntakeComplete = intakeStatus?.status === "completed";
  const isIntakeFailed = intakeStatus?.status === "failed";

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
                  {cliRuntime ? `${cliRuntime === "claude-code" ? "Claude Code" : "Codex"} CLI` : `${provider} / ${model.split("/").pop()}`}
                  {sseConnected && <span className="ml-1 text-success">connected</span>}
                </div>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {!cliRuntime && (
                <Select className="h-7 w-28 text-[10px]" value={provider} onChange={(e) => { setProvider(e.target.value); setSessionId(null); }}>
                  <option value="anthropic">Claude</option>
                  <option value="openai">OpenAI</option>
                  <option value="openrouter">OpenRouter</option>
                  <option value="gemini">Gemini</option>
                  <option value="lmstudio">LM Studio</option>
                </Select>
              )}
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
                onClick={() => { setSessionError(null); createSession(); }}
              >
                <RefreshCw className="h-3 w-3" />
                Retry
              </Button>
            </div>
          )}

          {/* Unified chronological stream */}
          <div className="flex-1 overflow-y-auto p-4 space-y-2">
            {/* Start/Resume button — show when no active intake */}
            {messages.length === 0 && !intakeStatus && (
              <div className="space-y-3">
                <EmptyState className="border-0 py-4">Ask me anything about this project</EmptyState>

                <button
                  onClick={handleStartIntake}
                  disabled={intakeLoading}
                  className="w-full rounded-lg border border-accent/30 bg-accent/5 px-4 py-3 text-left transition-colors hover:bg-accent/10 disabled:opacity-50"
                >
                  <div className="flex items-center gap-2">
                    {intakeLoading ? (
                      <Loader2 className="h-4 w-4 animate-spin text-accent" />
                    ) : (
                      <Sparkles className="h-4 w-4 text-accent" />
                    )}
                    <span className="text-sm font-medium text-accent">Start AI Estimating</span>
                  </div>
                  <div className="mt-1 text-[11px] text-fg/40">
                    Automatically review bid documents and build a complete estimate
                  </div>
                </button>

                <div className="grid grid-cols-2 gap-2">
                  {QUICK_PROMPTS.map((prompt) => (
                    <button
                      key={prompt}
                      onClick={() => sendMessage(prompt)}
                      className="rounded-lg border border-line bg-panel2/50 px-3 py-2 text-left text-[11px] text-fg/50 transition-colors hover:bg-panel2 hover:text-fg/70"
                    >
                      {prompt}
                    </button>
                  ))}
                </div>
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
                {isIntakeRunning && <Loader2 className="h-3 w-3 animate-spin text-accent shrink-0" />}
                {isIntakeComplete && <CheckCircle2 className="h-3 w-3 text-success shrink-0" />}
                {isIntakeFailed && <XCircle className="h-3 w-3 text-danger shrink-0" />}
                {intakeStatus.status === "stopped" && <Square className="h-3 w-3 text-fg/40 shrink-0" />}
                <span className="font-medium">
                  {isIntakeRunning ? "AI Estimating..." :
                   isIntakeComplete ? "AI Estimating complete" :
                   intakeStatus.status === "stopped" ? "AI Estimating stopped" :
                   "AI Estimating failed"}
                </span>
                <span className="ml-auto text-fg/30">
                  {intakeStatus.toolCallCount} tools · {intakeStatus.messageCount} msgs
                </span>
                {isIntakeRunning && (
                  <button
                    onClick={async () => {
                      try {
                        if (cliRuntime) {
                          await stopCliSession(projectId);
                        } else if (intakeSessionId) {
                          await stopIntake(intakeSessionId);
                        }
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
                    onClick={async () => {
                      if (cliRuntime) {
                        try {
                          await resumeCliSession(projectId);
                          setIntakeStatus((prev) => prev ? { ...prev, status: "running" } : prev);
                          connectToSseStream(projectId);
                        } catch { handleStartIntake(); }
                      } else {
                        handleStartIntake();
                      }
                    }}
                    className="ml-auto rounded p-1 text-fg/30 hover:bg-accent/10 hover:text-accent"
                    title="Resume / Restart"
                  >
                    <RefreshCw className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
            )}

            {/* Unified chronological stream — all events from DB in order */}
            {(() => {
              // Build timeline from ALL event types, in order (DB events are chronological)
              const events: any[] = (intakeStatus as any)?.events ?? [];

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
                        <div className="whitespace-pre-wrap text-xs">{content}</div>
                      </div>
                    </div>
                  );
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

                // Status events — skip rendering (shown in header)
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

            <div ref={messagesEndRef} />
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
