import assert from "node:assert/strict";
import test from "node:test";
import type OpenAI from "openai";
import { streamCompletion } from "./stream-completion.js";
function client(chunks: unknown[], onAbort: () => void) {
  return {
    chat: {
      completions: {
        create: async (params: any) => {
          assert.equal(params.stream, true);
          return {
            controller: { abort: onAbort },
            async *[Symbol.asyncIterator]() {
              yield* chunks;
            },
          };
        },
      },
    },
  } as unknown as OpenAI;
}
const choice = (delta: any, finish_reason: string | null = null) => ({
  choices: [{ index: 0, delta, finish_reason }],
});
test("tool fragments stream publicly and assemble multiple complete tool calls by index", async () => {
  const deltas: unknown[] = [];
  let closed = 0;
  const result = await streamCompletion(
    client(
      [
        choice({ content: "Building the chassis." }),
        choice({
          tool_calls: [{ index: 1, id: "b", function: { name: "finish_design", arguments: '{"apply":' } }],
        }),
        choice({
          tool_calls: [{ index: 0, id: "a", function: { name: "cad_execute", arguments: '{"program":' } }],
        }),
        choice({
          tool_calls: [
            { index: 0, function: { arguments: '{"source":"parts={}"}}' } },
            { index: 1, function: { arguments: "true}" } },
          ],
        }),
        choice({ reasoning_content: "private reasoning" }, "tool_calls"),
      ],
      () => closed++,
    ),
    { model: "model", messages: [] },
    { model: "model", systemPrompt: "", messages: [], onDelta: (delta) => deltas.push(delta) },
  );
  const calls = result.choices[0].message
    .tool_calls as OpenAI.Chat.Completions.ChatCompletionMessageFunctionToolCall[];
  assert.deepEqual(
    calls.map((c) => c.id),
    ["a", "b"],
  );
  assert.equal(JSON.parse(calls[0].function.arguments).program.source, "parts={}");
  assert.equal(result.choices[0].message.content, "Building the chassis.");
  assert.ok(deltas.length > 2);
  assert.doesNotMatch(JSON.stringify(deltas), /private reasoning/);
  assert.equal(closed, 1);
});
test("truncated streams never execute partial tool arguments and always close", async () => {
  let closed = false;
  await assert.rejects(
    streamCompletion(
      client(
        [
          choice({
            tool_calls: [{ index: 0, id: "a", function: { name: "cad_execute", arguments: '{"program":' } }],
          }),
        ],
        () => (closed = true),
      ),
      { model: "model", messages: [] },
      { model: "model", systemPrompt: "", messages: [] },
    ),
    /ended before completion/,
  );
  assert.equal(closed, true);
});
test("cancellation closes the provider stream", async () => {
  const abort = new AbortController();
  let closed = false;
  await assert.rejects(
    streamCompletion(
      client([choice({ content: "First" }), choice({ content: "Second" })], () => (closed = true)),
      { model: "model", messages: [] },
      {
        model: "model",
        systemPrompt: "",
        messages: [],
        signal: abort.signal,
        onDelta: () => abort.abort(new Error("Stopped")),
      },
    ),
    /Stopped/,
  );
  assert.equal(closed, true);
});
test("an output-limit finish never returns a candidate to execute", async () => {
  let closed = false;
  await assert.rejects(
    streamCompletion(
      client(
        [
          choice(
            {
              tool_calls: [
                { index: 0, id: "a", function: { name: "cad_execute", arguments: '{"program":{}}' } },
              ],
            },
            "length",
          ),
        ],
        () => (closed = true),
      ),
      { model: "model", messages: [] },
      { model: "model", systemPrompt: "", messages: [] },
    ),
    /token budget/,
  );
  assert.equal(closed, true);
});
test("reasoning-only streams send a content-free heartbeat and preserve provider context", async () => {
  const deltas: unknown[] = [];
  const result = await streamCompletion(
    client(
      [
        choice({
          reasoning: "private plan",
          reasoning_details: [{ index: 0, type: "reasoning.text", text: "private " }],
        }),
        choice({ reasoning_details: [{ index: 0, type: "reasoning.text", text: "plan" }] }),
        choice({ content: "Building the frame." }, "stop"),
      ],
      () => {},
    ),
    { model: "kimi", messages: [] },
    {
      model: "kimi",
      systemPrompt: "",
      messages: [],
      onDelta: (d) => deltas.push(d),
    },
  );
  assert.deepEqual(deltas.slice(0, 2), [
    { type: "activity", text: "" },
    { type: "activity", text: "" },
  ]);
  assert.doesNotMatch(JSON.stringify(deltas), /private/);
  assert.equal((result.providerState?.reasoningDetails?.[0] as any).text, "private plan");
});
