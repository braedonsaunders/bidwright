import type OpenAI from "openai";
import type { ChatRequest } from "../types.js";
import { ResponseLimitError } from "./response-limit.js";

export type ProviderCompletion = OpenAI.Chat.Completions.ChatCompletion & {
  providerState?: ChatRequest["messages"][number]["providerState"];
};

/** Shared streaming accumulation for OpenAI-compatible providers. */
export async function streamCompletion(
  client: OpenAI,
  params: OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming,
  request: ChatRequest,
): Promise<ProviderCompletion> {
  const stream = await client.chat.completions.create(
    { ...params, stream: true },
    { signal: request.signal, timeout: request.timeoutMs },
  );
  let text = "";
  let reasoning = "";
  const reasoningDetails: Record<string, unknown>[] = [];
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
      // Keep provider reasoning for subsequent tool turns, but expose only a
      // content-free heartbeat. Never forward private reasoning to the viewer.
      const delta = choice.delta as typeof choice.delta & {
        reasoning?: string;
        reasoning_content?: string;
        reasoning_details?: Record<string, unknown>[];
      };
      const thinking = delta.reasoning ?? delta.reasoning_content;
      if (thinking) reasoning += thinking;
      for (const detail of delta.reasoning_details ?? []) {
        const previous = reasoningDetails.find(
          (d) =>
            d.index === detail.index && d.type === detail.type && (!d.id || !detail.id || d.id === detail.id),
        );
        if (previous) {
          for (const [key, value] of Object.entries(detail)) {
            if (["text", "summary", "data", "signature"].includes(key) && typeof value === "string")
              previous[key] = String(previous[key] ?? "") + value;
            else previous[key] = value;
          }
        } else reasoningDetails.push({ ...detail });
      }
      if (thinking || delta.reasoning_details?.length) request.onDelta?.({ type: "activity", text: "" });
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
    if (finish === "length") throw new ResponseLimitError();
    if (finish === "content_filter") throw new Error("The AI provider declined this design request.");
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
      ...(reasoning || reasoningDetails.length
        ? {
            providerState: {
              ...(reasoningDetails.length ? { reasoningDetails } : { reasoning }),
            },
          }
        : {}),
    };
  } finally {
    stream.controller.abort();
  }
}
