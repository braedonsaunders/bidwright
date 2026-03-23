"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { AlertTriangle, CheckCircle2, ChevronDown, ChevronRight, Loader2, RefreshCw, Send, Sparkles, X, XCircle, Wrench } from "lucide-react";
import { Badge, Button, EmptyState, Select } from "@/components/ui";
import { startIntake, getIntakeStatus, getSettings, type IntakeStatusResult } from "@/lib/api";
import { cn } from "@/lib/utils";

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

const QUICK_PROMPTS = [
  "Summarize the project scope",
  "What are the key risks?",
  "Suggest phases for this project",
  "Check if the estimate is complete",
  "What equipment do we need?",
  "Identify gaps in the bid package",
];

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

export function AgentChat({ projectId, open, onClose, autoStartIntake, onIntakeStarted }: AgentChatProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [provider, setProvider] = useState("anthropic");
  const [model, setModel] = useState("claude-sonnet-4-20250514");
  const [sessionError, setSessionError] = useState<string | null>(null);
  const [intakeSessionId, setIntakeSessionId] = useState<string | null>(null);
  const [intakeStatus, setIntakeStatus] = useState<IntakeStatusResult | null>(null);
  const [intakeLoading, setIntakeLoading] = useState(false);
  const [liveToolCalls, setLiveToolCalls] = useState<ToolCallEntry[]>([]);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Load default provider/model from org settings
  useEffect(() => {
    getSettings().then((s) => {
      const integ = s?.integrations;
      if (integ?.llmProvider) setProvider(integ.llmProvider);
      if (integ?.llmModel) setModel(integ.llmModel);
    }).catch(() => {});
  }, []);

  // Restore persisted intake session on mount
  useEffect(() => {
    const stored = localStorage.getItem(intakeStorageKey(projectId));
    if (stored) {
      try {
        const { sessionId: sid, status } = JSON.parse(stored);
        if (sid) {
          setIntakeSessionId(sid);
          // Fetch current status
          getIntakeStatus(sid).then((s) => {
            setIntakeStatus(s);
            // If completed, load full tool call history
            if (s.status !== "running") {
              setLiveToolCalls(s.recentToolCalls.map((tc: any, i: number) => ({
                id: `restored-${i}`,
                toolId: tc.toolId,
                input: {},
                result: { success: tc.success, duration_ms: tc.duration_ms },
              })));
            }
          }).catch(() => {
            // Session expired, clear storage
            localStorage.removeItem(intakeStorageKey(projectId));
          });
        }
      } catch {}
    }
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
    try {
      const result = await startIntake({ projectId, provider, model });
      setIntakeSessionId(result.sessionId);
      // Persist session ID
      localStorage.setItem(intakeStorageKey(projectId), JSON.stringify({ sessionId: result.sessionId }));
      setIntakeStatus({
        sessionId: result.sessionId,
        projectId: result.projectId,
        scope: result.scope,
        status: "running",
        toolCallCount: 0,
        messageCount: 0,
        summary: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        recentToolCalls: [],
      });
    } catch (err) {
      setSessionError(err instanceof Error ? err.message : "Failed to start intake agent");
    } finally {
      setIntakeLoading(false);
    }
  }

  // Auto-start intake when redirected from upload
  useEffect(() => {
    if (autoStartIntake && open && !intakeAutoStarted.current && !intakeSessionId) {
      intakeAutoStarted.current = true;
      handleStartIntake();
      onIntakeStarted?.();
    }
  }, [autoStartIntake, open]);

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

        if (status.status !== "running") {
          clearInterval(interval);
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
                <div className="text-[10px] text-fg/35">{provider} / {model.split("/").pop()}</div>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Select className="h-7 w-28 text-[10px]" value={provider} onChange={(e) => { setProvider(e.target.value); setSessionId(null); }}>
                <option value="anthropic">Claude</option>
                <option value="openai">OpenAI</option>
                <option value="openrouter">OpenRouter</option>
                <option value="gemini">Gemini</option>
                <option value="lmstudio">LM Studio</option>
              </Select>
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

          {/* Messages + Content */}
          <div className="flex-1 overflow-y-auto p-4 space-y-3">
            {/* Intake status banner */}
            {intakeStatus && (
              <div className={cn(
                "rounded-lg border px-3 py-2.5 text-xs",
                isIntakeRunning ? "border-accent/30 bg-accent/5" :
                isIntakeComplete ? "border-success/30 bg-success/5" :
                "border-danger/30 bg-danger/5"
              )}>
                <div className="flex items-center gap-2">
                  {isIntakeRunning && <Loader2 className="h-3.5 w-3.5 animate-spin text-accent" />}
                  {isIntakeComplete && <CheckCircle2 className="h-3.5 w-3.5 text-success" />}
                  {isIntakeFailed && <XCircle className="h-3.5 w-3.5 text-danger" />}
                  <span className="font-medium">
                    {isIntakeRunning ? "AI Estimating in progress..." :
                     isIntakeComplete ? "AI Estimating complete" :
                     "AI Estimating failed"}
                  </span>
                </div>
                <div className="mt-1 text-fg/40">
                  {intakeStatus.toolCallCount} tool calls · {intakeStatus.messageCount} messages
                </div>
              </div>
            )}

            {/* Live tool call feed */}
            {(isIntakeRunning || liveToolCalls.length > 0) && (
              <LiveToolFeed toolCalls={liveToolCalls} isRunning={isIntakeRunning} />
            )}

            {/* AI summary (after completion) */}
            {intakeStatus?.summary && !isIntakeRunning && (
              <div className="rounded-lg border border-line bg-panel2/40 px-3 py-2.5">
                <div className="text-[10px] font-medium text-fg/40 uppercase tracking-wider mb-1.5">AI Summary</div>
                <div className="text-xs text-fg/70 whitespace-pre-wrap max-h-60 overflow-y-auto">
                  {intakeStatus.summary}
                </div>
              </div>
            )}

            {/* Empty state / start intake */}
            {messages.length === 0 && !intakeStatus && (
              <div className="space-y-3">
                <EmptyState className="border-0 py-4">Ask me anything about this project</EmptyState>

                {/* Intake action */}
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

            {/* Chat messages */}
            {messages.map((msg) => (
              <div key={msg.id} className={cn("flex", msg.role === "user" ? "justify-end" : "justify-start")}>
                <div className={cn(
                  "max-w-[85%] rounded-lg px-3 py-2 text-sm",
                  msg.role === "user"
                    ? "bg-accent/15 text-fg"
                    : "bg-panel2/60 text-fg/85"
                )}>
                  <div className="whitespace-pre-wrap">{msg.content}</div>

                  {/* Tool calls */}
                  {msg.toolCalls && msg.toolCalls.length > 0 && (
                    <div className="mt-2 space-y-1.5">
                      {msg.toolCalls.map((tc) => (
                        <ToolCallDetail key={tc.id} tc={tc} />
                      ))}
                    </div>
                  )}

                  <div className="mt-1 text-[10px] text-fg/20">
                    {new Date(msg.timestamp).toLocaleTimeString()}
                  </div>
                </div>
              </div>
            ))}

            {isLoading && (
              <div className="flex justify-start">
                <div className="rounded-lg bg-panel2/60 px-3 py-2">
                  <Loader2 className="h-4 w-4 animate-spin text-fg/40" />
                </div>
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
