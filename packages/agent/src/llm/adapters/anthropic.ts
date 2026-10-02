/**
 * @deprecated LLM adapters replaced by CLI-native runtimes.
 * Claude Code / Codex handle LLM calls directly. This file is kept for reference only.
 */
import type { ChatRequest, ChatResponse, LLMAdapter, StreamChunk } from "../types.js";
import { ResponseLimitError } from "../response-limit.js";

export class AnthropicAdapter implements LLMAdapter {
  id = "anthropic";
  name = "Anthropic Claude";
  supportsTools = true;
  supportsVision = true;
  maxContextTokens = 200000;

  constructor(
    private apiKey: string,
    private defaultModel = "claude-sonnet-4-20250514",
  ) {}

  async chat(request: ChatRequest): Promise<ChatResponse> {
    const { default: Anthropic } = await import("@anthropic-ai/sdk");
    const client = new Anthropic({ apiKey: this.apiKey });

    const messages = request.messages
      .filter((m) => m.role !== "system")
      .map((m) => {
        if (m.role === "tool") {
          return {
            role: "user" as const,
            content: [
              {
                type: "tool_result" as const,
                tool_use_id: m.toolCallId!,
                content: typeof m.content === "string" ? m.content : JSON.stringify(m.content),
              },
            ],
          };
        }

        if (typeof m.content === "string") {
          return { role: m.role as "user" | "assistant", content: m.content };
        }

        const blocks = (m.content ?? []).map((b) => {
          if (b.type === "text") return { type: "text" as const, text: b.text ?? "" };
          if (b.type === "tool_use")
            return {
              type: "tool_use" as const,
              id: b.toolUseId!,
              name: b.toolName!,
              input: b.toolInput ?? {},
            };
          if (b.type === "tool_result")
            return { type: "tool_result" as const, tool_use_id: b.toolUseId!, content: b.toolResult ?? "" };
          if (b.type === "image")
            return {
              type: "image" as const,
              source: {
                type: "base64" as const,
                media_type: (b.imageMimeType ?? "image/png") as "image/png",
                data: b.imageData ?? "",
              },
            };
          return { type: "text" as const, text: "" };
        });

        return { role: m.role as "user" | "assistant", content: blocks };
      });

    const tools = request.tools?.map((t) => ({
      name: t.name,
      description: t.description,
      input_schema: t.inputSchema as Record<string, unknown>,
    }));

    const params = {
      model: request.model || this.defaultModel,
      system: request.systemPrompt,
      messages: messages as Parameters<typeof client.messages.create>[0]["messages"],
      tools: tools as Parameters<typeof client.messages.create>[0]["tools"],
      max_tokens: request.maxTokens ?? 4096,
      temperature: request.temperature ?? 0,
    };
    let response;
    if (request.onDelta) {
      const stream = client.messages.stream(params, { signal: request.signal, timeout: request.timeoutMs });
      const names = new Map<number, string>();
      try {
        for await (const event of stream) {
          request.signal?.throwIfAborted();
          if (event.type === "content_block_start" && event.content_block.type === "tool_use") {
            names.set(event.index, event.content_block.name);
            request.onDelta({ type: "tool", toolName: event.content_block.name, text: "" });
          } else if (event.type === "content_block_delta") {
            if (event.delta.type === "text_delta") request.onDelta({ type: "text", text: event.delta.text });
            else if (event.delta.type === "input_json_delta")
              request.onDelta({
                type: "tool",
                toolName: names.get(event.index),
                text: event.delta.partial_json,
              });
            else if (event.delta.type === "thinking_delta") request.onDelta({ type: "activity", text: "" });
          }
        }
        response = await stream.finalMessage();
      } finally {
        stream.abort();
      }
    } else
      response = await client.messages.create(params, { signal: request.signal, timeout: request.timeoutMs });

    if (response.stop_reason === "max_tokens") throw new ResponseLimitError();

    const content = response.content.map((block) => {
      if (block.type === "text") return { type: "text" as const, text: block.text };
      if (block.type === "tool_use")
        return {
          type: "tool_use" as const,
          toolUseId: block.id,
          toolName: block.name,
          toolInput: block.input,
        };
      return { type: "text" as const, text: "" };
    });

    return {
      content,
      stopReason: response.stop_reason === "tool_use" ? "tool_use" : "end_turn",
      usage: { inputTokens: response.usage.input_tokens, outputTokens: response.usage.output_tokens },
    };
  }
}
