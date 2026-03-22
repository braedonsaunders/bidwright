"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, Send, Sparkles, X, Wrench } from "lucide-react";
import { Badge, Button, EmptyState, Select } from "@/components/ui";
import { cn } from "@/lib/utils";

interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  toolCalls?: Array<{
    id: string;
    toolId: string;
    input: unknown;
    result: { success: boolean; data?: unknown; error?: string; sideEffects?: string[]; duration_ms: number };
  }>;
  timestamp: string;
}

interface AgentChatProps {
  projectId: string;
  open: boolean;
  onClose: () => void;
}

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:4001";

const QUICK_PROMPTS = [
  "Summarize the project scope",
  "What are the key risks?",
  "Suggest phases for this project",
  "Check if the estimate is complete",
  "What equipment do we need?",
  "Identify gaps in the bid package",
];

export function AgentChat({ projectId, open, onClose }: AgentChatProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [provider, setProvider] = useState("anthropic");
  const [model, setModel] = useState("claude-sonnet-4-20250514");
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open && inputRef.current) {
      inputRef.current.focus();
    }
  }, [open]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const createSession = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/api/agent/sessions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId, provider, model }),
      });
      const data = await res.json();
      setSessionId(data.sessionId);
      return data.sessionId;
    } catch {
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
        headers: { "Content-Type": "application/json" },
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

  if (!open) return null;

  return (
    <div className="fixed inset-y-0 right-0 z-50 flex w-full max-w-md flex-col border-l border-line bg-panel shadow-2xl">
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

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {messages.length === 0 && (
          <div className="space-y-3">
            <EmptyState className="border-0 py-4">Ask me anything about this project</EmptyState>
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
                    <div key={tc.id} className="rounded border border-line bg-bg/30 px-2 py-1.5">
                      <div className="flex items-center gap-1.5">
                        <Wrench className="h-3 w-3 text-fg/30" />
                        <span className="text-[11px] font-medium text-fg/50">{tc.toolId}</span>
                        <Badge tone={tc.result.success ? "success" : "danger"} className="ml-auto">
                          {tc.result.success ? "ok" : "err"}
                        </Badge>
                      </div>
                      {tc.result.sideEffects && tc.result.sideEffects.length > 0 && (
                        <div className="mt-1 text-[10px] text-fg/35">
                          {tc.result.sideEffects.join(", ")}
                        </div>
                      )}
                      <div className="mt-0.5 text-[10px] text-fg/25">{tc.result.duration_ms}ms</div>
                    </div>
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
    </div>
  );
}
