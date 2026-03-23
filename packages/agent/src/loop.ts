import type {
  AgentConfig,
  AgentResponse,
  AgentSession,
  ChatContentBlock,
  ChatMessage,
  ToolChoice,
  ToolExecutionContext,
  ToolResult,
  ToolSpec,
} from "./types.js";
import { ToolRegistry } from "./registry.js";
import { ToolExecutor } from "./executor.js";

// ─── Context Management ───────────────────────────────────────────

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

function estimateMessageTokens(messages: ChatMessage[]): number {
  let total = 0;
  for (const m of messages) {
    if (typeof m.content === "string") {
      total += estimateTokens(m.content);
    } else if (Array.isArray(m.content)) {
      for (const block of m.content) {
        if (block.type === "text" && block.text) total += estimateTokens(block.text);
        else if (block.type === "tool_use") total += estimateTokens(JSON.stringify(block.toolInput ?? {}));
      }
    }
  }
  return total;
}

/**
 * Observation masking (NeurIPS 2025 pattern):
 * Keep assistant reasoning intact, mask old tool result data.
 */
function compactMessages(messages: ChatMessage[], keepRecent: number = 10): ChatMessage[] {
  if (messages.length <= keepRecent) return messages;

  const toCompact = messages.slice(0, messages.length - keepRecent);
  const toKeep = messages.slice(messages.length - keepRecent);

  const compacted = toCompact.map((m) => {
    if (m.role === "tool") {
      try {
        const raw = typeof m.content === "string" ? m.content : "{}";
        const result = JSON.parse(raw);
        const masked = result.success
          ? `{"success":true,"masked":true,"sideEffects":${JSON.stringify(result.sideEffects ?? [])}}`
          : `{"success":false,"error":${JSON.stringify((result.error ?? "").slice(0, 100))}}`;
        return { ...m, content: masked };
      } catch {
        return { ...m, content: '{"success":false,"masked":true}' };
      }
    }
    return m;
  });

  return [...compacted, ...toKeep];
}

// ─── Loop Detection ───────────────────────────────────────────────

function detectDuplicateToolCalls(
  history: { toolId: string; input: unknown }[],
  threshold: number = 3
): string | null {
  if (history.length < threshold) return null;

  const recent = history.slice(-threshold);
  const firstKey = `${recent[0].toolId}:${JSON.stringify(recent[0].input)}`;

  if (recent.every((tc) => `${tc.toolId}:${JSON.stringify(tc.input)}` === firstKey)) {
    return recent[0].toolId;
  }

  // Also detect "stuck in read mode" — if last N calls are all read-only
  const readTools = new Set(["project.readFile", "project.listFiles", "project.getDocumentManifest",
    "project.searchFiles", "knowledge.queryProjectDocs", "knowledge.queryKnowledge",
    "system.readMemory", "system.writeMemory"]);
  if (history.length >= 10) {
    const last10 = history.slice(-10);
    if (last10.every((tc) => readTools.has(tc.toolId))) {
      return "__stuck_reading__";
    }
  }

  return null;
}

// ─── AgentLoop ────────────────────────────────────────────────────

export class AgentLoop {
  private executor: ToolExecutor;

  constructor(
    private config: AgentConfig,
    private registry: ToolRegistry,
    executorOptions?: { timeoutMs?: number; retries?: number }
  ) {
    this.executor = new ToolExecutor(executorOptions);
  }

  async run(
    session: AgentSession,
    userMessage: string,
    context: ToolExecutionContext,
    options?: {
      toolFilter?: { category?: string; ids?: string[] };
      onConfirmationNeeded?: (toolId: string, input: unknown) => Promise<boolean>;
    }
  ): Promise<AgentResponse> {
    let messages: ChatMessage[] = [
      ...session.messages,
      { role: "user", content: userMessage },
    ];

    const allTools = this.registry.toToolSpecs(options?.toolFilter);
    const allToolCalls: AgentResponse["toolCallsExecuted"] = [];
    const toolCallHistory: { toolId: string; input: unknown; success: boolean }[] = [];
    let totalInput = 0;
    let totalOutput = 0;

    const contextBudget = this.config.llm.maxContextTokens * 0.7;

    for (let iteration = 0; iteration < this.config.maxIterations; iteration++) {
      // Check abort signal
      if (this.config.abortSignal?.aborted) {
        return {
          message: "Agent stopped by user.",
          toolCallsExecuted: allToolCalls,
          citations: [],
          tokensUsed: { input: totalInput, output: totalOutput },
        };
      }

      // Compact messages if approaching context limits
      const currentTokens = estimateMessageTokens(messages);
      if (currentTokens > contextBudget) {
        messages = compactMessages(messages, 12);
      }

      // ── prepareStep: per-iteration tool filtering + toolChoice ──
      let activeTools: ToolSpec[] = allTools;
      let toolChoice: ToolChoice | undefined;

      if (this.config.prepareStep) {
        const stepResult = this.config.prepareStep(iteration, toolCallHistory);
        if (stepResult) {
          if (stepResult.activeTools) {
            const allowed = new Set(stepResult.activeTools);
            activeTools = allTools.filter((t) => allowed.has(t.name));
          }
          if (stepResult.toolChoice) {
            toolChoice = stepResult.toolChoice;
          }
          if (stepResult.injectMessage) {
            messages.push({ role: "user", content: stepResult.injectMessage });
          }
        }
      }

      // ── Loop detection: nudge if stuck ──
      const stuckTool = detectDuplicateToolCalls(toolCallHistory, 3);
      if (stuckTool === "__stuck_reading__") {
        messages.push({
          role: "user",
          content: "You have been reading documents for many iterations without creating any worksheets or line items. STOP READING. Use quote.createWorksheet and quote.createWorksheetItem NOW to build the estimate from what you have already read.",
        });
        this.config.onMessage?.({ role: "assistant", content: "[System: Nudging agent to start creating items...]" });
      } else if (stuckTool) {
        messages.push({
          role: "user",
          content: `You called ${stuckTool} 3 times in a row with the same input. Move on to the next step.`,
        });
      }

      try {
        const response = await this.config.llm.chat({
          model: "",
          systemPrompt: this.config.systemPrompt,
          messages,
          tools: activeTools.length > 0 ? activeTools : undefined,
          toolChoice,
          maxTokens: this.config.maxTokens,
          temperature: this.config.temperature,
        });

        totalInput += response.usage.inputTokens;
        totalOutput += response.usage.outputTokens;

        if (response.stopReason === "end_turn" || response.stopReason === "max_tokens") {
          const textContent = response.content
            .filter((b): b is ChatContentBlock & { type: "text" } => b.type === "text")
            .map((b) => b.text ?? "")
            .join("");

          this.config.onMessage?.({ role: "assistant", content: textContent });

          return {
            message: textContent,
            toolCallsExecuted: allToolCalls,
            citations: [],
            tokensUsed: { input: totalInput, output: totalOutput },
          };
        }

        if (response.stopReason === "tool_use") {
          const assistantText = response.content
            .filter((b): b is ChatContentBlock & { type: "text" } => b.type === "text")
            .map((b) => b.text ?? "")
            .join("");
          if (assistantText) {
            this.config.onMessage?.({ role: "assistant", content: assistantText });
          }

          messages.push({ role: "assistant", content: response.content });

          const toolUseBlocks = response.content.filter(
            (b): b is ChatContentBlock & { type: "tool_use" } => b.type === "tool_use"
          );

          for (const block of toolUseBlocks) {
            const toolName = block.toolName!;
            const toolInput = block.toolInput;
            const toolUseId = block.toolUseId!;

            const tool = this.registry.get(toolName);
            let result: ToolResult;

            if (!tool) {
              result = { success: false, error: `Unknown tool: ${toolName}`, duration_ms: 0 };
            } else {
              if (tool.definition.requiresConfirmation && options?.onConfirmationNeeded) {
                const approved = await options.onConfirmationNeeded(toolName, toolInput);
                if (!approved) {
                  result = { success: false, error: "User rejected tool execution", duration_ms: 0 };
                  messages.push({ role: "tool", toolCallId: toolUseId, content: JSON.stringify(result) });
                  continue;
                }
              }
              result = await this.executor.execute(tool, toolInput, context);
            }

            const toolCall = { id: toolUseId, toolId: toolName, input: toolInput, result };
            allToolCalls.push(toolCall);
            toolCallHistory.push({ toolId: toolName, input: toolInput, success: result.success });
            this.config.onToolCall?.(toolCall);

            messages.push({ role: "tool", toolCallId: toolUseId, content: JSON.stringify(result) });
          }
        }
      } catch (err: unknown) {
        const errMsg = err instanceof Error ? err.message : String(err);
        if (errMsg.includes("context") || errMsg.includes("token") || errMsg.includes("too long") || errMsg.includes("maximum")) {
          messages = compactMessages(messages, 6);
          // Don't spam the UI with compaction messages — just log internally
          continue;
        }
        throw err;
      }
    }

    return {
      message: "Agent reached maximum iteration limit.",
      toolCallsExecuted: allToolCalls,
      citations: [],
      tokensUsed: { input: totalInput, output: totalOutput },
    };
  }
}
