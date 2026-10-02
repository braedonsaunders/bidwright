import type OpenAI from "openai";
import type { ChatRequest } from "../types.js";

/** Shared streaming accumulation for OpenAI-compatible providers. */
export async function streamCompletion(
  client: OpenAI,
  params: OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming,
  request: ChatRequest,
): Promise<OpenAI.Chat.Completions.ChatCompletion> {
  const stream = await client.chat.completions.create(
    { ...params, stream: true },
    { signal: request.signal, timeout: request.timeoutMs },
  );
  let text = "";
  let finish: OpenAI.Chat.Completions.ChatCompletion.Choice["finish_reason"] | undefined;
  let usage: OpenAI.CompletionUsage | undefined;
  const calls = new Map<
    number,
    { id: string; type: "function"; function: { name: string; arguments: string } }
  >();
  try {
    for await (const chunk of stream) {
      request.signal?.throwIfAborted();
      if (chunk.usage) usage = chunk.usage;
      const choice = chunk.choices[0];
      if (!choice) continue;
      if (choice.finish_reason) finish = choice.finish_reason;
      if (choice.delta.content) {
        text += choice.delta.content;
        request.onDelta?.({ type: "text", text: choice.delta.content });
      }
      for (const delta of choice.delta.tool_calls ?? []) {
        const call = calls.get(delta.index) ?? {
          id: "",
          type: "function" as const,
          function: { name: "", arguments: "" },
        };
        if (delta.id) call.id = delta.id;
        if (delta.function?.name) call.function.name += delta.function.name;
        if (delta.function?.arguments) call.function.arguments += delta.function.arguments;
        calls.set(delta.index, call);
        request.onDelta?.({
          type: "tool",
          toolName: call.function.name,
          text: delta.function?.arguments ?? "",
        });
      }
    }
    if (finish === "length" || finish === "content_filter")
      throw new Error(
        "The AI response could not finish its CAD program. Try a smaller first step and continue the design from there.",
      );
    if (!finish) throw new Error("The AI response stream ended before completion. Retry the design.");
    return {
      id: "streamed",
      object: "chat.completion",
      created: 0,
      model: params.model,
      choices: [
        {
          index: 0,
          finish_reason: finish,
          logprobs: null,
          message: {
            role: "assistant",
            content: text || null,
            refusal: null,
            ...(calls.size
              ? { tool_calls: [...calls.entries()].sort((a, b) => a[0] - b[0]).map(([, call]) => call) }
              : {}),
          },
        },
      ],
      usage,
    };
  } finally {
    stream.controller.abort();
  }
}
