import assert from "node:assert/strict";
import test from "node:test";
import { AnthropicAdapter } from "./anthropic.js";

function events() {
  return [
    {
      type: "message_start",
      message: {
        id: "test",
        type: "message",
        role: "assistant",
        model: "test-model",
        content: [],
        stop_reason: null,
        stop_sequence: null,
        usage: { input_tokens: 10, output_tokens: 0 },
      },
    },
    {
      type: "content_block_start",
      index: 0,
      content_block: { type: "thinking", thinking: "", signature: "" },
    },
    {
      type: "content_block_delta",
      index: 0,
      delta: { type: "thinking_delta", thinking: "Private internal content" },
    },
    { type: "content_block_stop", index: 0 },
    { type: "content_block_start", index: 1, content_block: { type: "text", text: "" } },
    { type: "content_block_delta", index: 1, delta: { type: "text_delta", text: "Building " } },
    { type: "content_block_delta", index: 1, delta: { type: "text_delta", text: "the chassis." } },
    { type: "content_block_stop", index: 1 },
    {
      type: "content_block_start",
      index: 2,
      content_block: { type: "tool_use", id: "call-a", name: "cad_execute", input: {} },
    },
    {
      type: "content_block_delta",
      index: 2,
      delta: { type: "input_json_delta", partial_json: '{"program":' },
    },
    {
      type: "content_block_delta",
      index: 2,
      delta: { type: "input_json_delta", partial_json: '{"source":"parts={}"}}' },
    },
    { type: "content_block_stop", index: 2 },
    {
      type: "message_delta",
      delta: { stop_reason: "tool_use", stop_sequence: null },
      usage: { output_tokens: 20 },
    },
    { type: "message_stop" },
  ]
    .map((event) => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`)
    .join("");
}
test("real Anthropic SDK streams public text/tool input and keeps private thinking out of activity", async () => {
  const original = globalThis.fetch;
  let request: any;
  globalThis.fetch = async (_input, init) => {
    request = JSON.parse(String(init?.body));
    return new Response(events(), { headers: { "content-type": "text/event-stream" } });
  };
  const deltas: unknown[] = [];
  try {
    const result = await new AnthropicAdapter("test-key", "test-model").chat({
      model: "test-model",
      systemPrompt: "",
      messages: [{ role: "user", content: "Trailer" }],
      onDelta: (delta) => deltas.push(delta),
      timeoutMs: 7200000,
    });
    assert.equal(request.stream, true);
    assert.match(JSON.stringify(deltas), /Building /);
    assert.match(JSON.stringify(deltas), /cad_execute/);
    assert.doesNotMatch(JSON.stringify(deltas), /Private internal content/);
    assert.equal(
      result.content.find((c) => c.type === "tool_use")?.toolInput &&
        (result.content.find((c) => c.type === "tool_use")!.toolInput as any).program.source,
      "parts={}",
    );
    assert.equal(result.stopReason, "tool_use");
    assert.equal(result.usage.inputTokens, 10);
  } finally {
    globalThis.fetch = original;
  }
});
