/**
 * @deprecated LLM adapters replaced by CLI-native runtimes.
 * Claude Code / Codex handle LLM calls directly. This file is kept for reference only.
 */
import type { ChatRequest, ChatResponse, ChatContentBlock, LLMAdapter } from "../types.js";

export class GeminiAdapter implements LLMAdapter {
  id = "gemini";
  name = "Google Gemini";
  supportsTools = true;
  supportsVision = true;
  maxContextTokens = 1000000;

  constructor(private apiKey: string, private defaultModel = "gemini-2.5-pro") {}

  async chat(request: ChatRequest): Promise<ChatResponse> {
    const { default: OpenAI } = await import("openai");
    const client = new OpenAI({
      apiKey: this.apiKey,
      baseURL: "https://generativelanguage.googleapis.com/v1beta/openai/",
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const messages: any[] = [{ role: "system", content: request.systemPrompt }];
    for (const m of request.messages) {
      if (m.role === "tool") {
        messages.push({ role: "tool", tool_call_id: m.toolCallId, content: typeof m.content === "string" ? m.content : JSON.stringify(m.content) });
      } else if (typeof m.content === "string") {
        messages.push({ role: m.role, content: m.content });
      } else {
        const text = (m.content ?? []).filter(b => b.type === "text").map(b => b.text).join("");
        messages.push({ role: m.role, content: text || "" });
      }
    }

    const tools = request.tools?.map(t => ({
      type: "function" as const,
      function: { name: t.name, description: t.description, parameters: t.inputSchema },
    }));

    const response = await client.chat.completions.create({
      model: request.model || this.defaultModel,
      messages,
      tools: tools?.length ? tools : undefined,
      max_tokens: request.maxTokens ?? 4096,
      temperature: request.temperature ?? 0,
    });

    const choice = response.choices[0];
    const content: ChatContentBlock[] = [];

    if (choice.message.content) {
      content.push({ type: "text", text: choice.message.content });
    }

    if (choice.message.tool_calls) {
      for (const tc of choice.message.tool_calls) {
        if (tc.type === "function") {
          content.push({ type: "tool_use", toolUseId: tc.id, toolName: tc.function.name, toolInput: JSON.parse(tc.function.arguments) });
        }
      }
    }

    return {
      content,
      stopReason: choice.finish_reason === "tool_calls" ? "tool_use" : "end_turn",
      usage: { inputTokens: response.usage?.prompt_tokens ?? 0, outputTokens: response.usage?.completion_tokens ?? 0 },
    };
  }
}
