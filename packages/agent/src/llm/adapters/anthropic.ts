/**
 * @deprecated LLM adapters replaced by CLI-native runtimes.
 * Claude Code / Codex handle LLM calls directly. This file is kept for reference only.
 */
import type { ChatRequest, ChatResponse, LLMAdapter, StreamChunk } from "../types.js";

export class AnthropicAdapter implements LLMAdapter {
  id = "anthropic";
  name = "Anthropic Claude";
  supportsTools = true;
  supportsVision = true;
  maxContextTokens = 200000;

  constructor(private apiKey: string, private defaultModel = "claude-sonnet-4-20250514") {}

  async chat(request: ChatRequest): Promise<ChatResponse> {
    const { default: Anthropic } = await import("@anthropic-ai/sdk");
    const client = new Anthropic({ apiKey: this.apiKey });

    const messages = request.messages
      .filter(m => m.role !== "system")
      .map(m => {
        if (m.role === "tool") {
          return {
            role: "user" as const,
            content: [{
              type: "tool_result" as const,
              tool_use_id: m.toolCallId!,
              content: typeof m.content === "string" ? m.content : JSON.stringify(m.content),
            }],
          };
        }

        if (typeof m.content === "string") {
          return { role: m.role as "user" | "assistant", content: m.content };
        }

        const blocks = (m.content ?? []).map(b => {
          if (b.type === "text") return { type: "text" as const, text: b.text ?? "" };
          if (b.type === "tool_use") return { type: "tool_use" as const, id: b.toolUseId!, name: b.toolName!, input: b.toolInput ?? {} };
          if (b.type === "tool_result") return { type: "tool_result" as const, tool_use_id: b.toolUseId!, content: b.toolResult ?? "" };
          if (b.type === "image") return { type: "image" as const, source: { type: "base64" as const, media_type: (b.imageMimeType ?? "image/png") as "image/png", data: b.imageData ?? "" } };
          return { type: "text" as const, text: "" };
        });

        return { role: m.role as "user" | "assistant", content: blocks };
      });

    const tools = request.tools?.map(t => ({
      name: t.name,
      description: t.description,
      input_schema: t.inputSchema as Record<string, unknown>,
    }));

    const response = await client.messages.create({
      model: request.model || this.defaultModel,
      system: request.systemPrompt,
      messages: messages as Parameters<typeof client.messages.create>[0]["messages"],
      tools: tools as Parameters<typeof client.messages.create>[0]["tools"],
      max_tokens: request.maxTokens ?? 4096,
      temperature: request.temperature ?? 0,
    });

    const content = response.content.map(block => {
      if (block.type === "text") return { type: "text" as const, text: block.text };
      if (block.type === "tool_use") return { type: "tool_use" as const, toolUseId: block.id, toolName: block.name, toolInput: block.input };
      return { type: "text" as const, text: "" };
    });

    return {
      content,
      stopReason: response.stop_reason === "tool_use" ? "tool_use" : "end_turn",
      usage: { inputTokens: response.usage.input_tokens, outputTokens: response.usage.output_tokens },
    };
  }
}
