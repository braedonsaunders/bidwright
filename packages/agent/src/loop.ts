import type {
  AgentConfig,
  AgentResponse,
  AgentSession,
  ChatContentBlock,
  ChatMessage,
  LLMAdapter,
  StreamChunk,
  ToolExecutionContext,
  ToolResult,
} from "./types.js";
import { ToolRegistry } from "./registry.js";
import { ToolExecutor } from "./executor.js";

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
    const messages: ChatMessage[] = [
      ...session.messages,
      { role: "user", content: userMessage },
    ];

    const tools = this.registry.toToolSpecs(options?.toolFilter);
    const allToolCalls: AgentResponse["toolCallsExecuted"] = [];
    let totalInput = 0;
    let totalOutput = 0;

    for (let iteration = 0; iteration < this.config.maxIterations; iteration++) {
      const response = await this.config.llm.chat({
        model: this.config.llm.id,
        systemPrompt: this.config.systemPrompt,
        messages,
        tools: tools.length > 0 ? tools : undefined,
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

        return {
          message: textContent,
          toolCallsExecuted: allToolCalls,
          citations: [],
          tokensUsed: { input: totalInput, output: totalOutput },
        };
      }

      if (response.stopReason === "tool_use") {
        // Add assistant message with tool calls
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
            // Check confirmation
            if (tool.definition.requiresConfirmation && options?.onConfirmationNeeded) {
              const approved = await options.onConfirmationNeeded(toolName, toolInput);
              if (!approved) {
                result = { success: false, error: "User rejected tool execution", duration_ms: 0 };
                messages.push({
                  role: "tool",
                  toolCallId: toolUseId,
                  content: JSON.stringify(result),
                });
                continue;
              }
            }

            result = await this.executor.execute(tool, toolInput, context);
          }

          allToolCalls.push({ id: toolUseId, toolId: toolName, input: toolInput, result });

          messages.push({
            role: "tool",
            toolCallId: toolUseId,
            content: JSON.stringify(result),
          });
        }
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
