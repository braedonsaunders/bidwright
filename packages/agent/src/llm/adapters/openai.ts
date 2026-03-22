import type { ChatRequest, ChatResponse, ChatContentBlock, LLMAdapter } from "../types.js";

export class OpenAIAdapter implements LLMAdapter {
  id = "openai";
  name = "OpenAI";
  supportsTools = true;
  supportsVision = true;
  maxContextTokens = 128000;

  constructor(private apiKey: string, private defaultModel = "gpt-4o", private baseUrl?: string) {}

  async chat(request: ChatRequest): Promise<ChatResponse> {
    const { default: OpenAI } = await import("openai");
    const client = new OpenAI({ apiKey: this.apiKey, baseURL: this.baseUrl });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const messages: any[] = [{ role: "system", content: request.systemPrompt }];
    for (const m of request.messages) {
      if (m.role === "tool") {
        messages.push({ role: "tool", tool_call_id: m.toolCallId, content: typeof m.content === "string" ? m.content : JSON.stringify(m.content) });
      } else if (typeof m.content === "string") {
        messages.push({ role: m.role, content: m.content });
      } else {
        const blocks = m.content ?? [];
        const assistantToolCalls = blocks.filter(b => b.type === "tool_use").map(b => ({
          id: b.toolUseId!, type: "function" as const, function: { name: b.toolName!, arguments: JSON.stringify(b.toolInput ?? {}) }
        }));
        if (assistantToolCalls.length > 0) {
          const textParts = blocks.filter(b => b.type === "text").map(b => b.text).join("");
          messages.push({ role: "assistant", content: textParts || null, tool_calls: assistantToolCalls });
        } else {
          const textParts = blocks.filter(b => b.type === "text").map(b => b.text).join("");
          messages.push({ role: m.role, content: textParts });
        }
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
          content.push({
            type: "tool_use",
            toolUseId: tc.id,
            toolName: tc.function.name,
            toolInput: JSON.parse(tc.function.arguments),
          });
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
