import assert from "node:assert/strict";
import test from "node:test";

import {
  buildModeConversationContext,
  hasFinalAssistantAnswer,
} from "./cli-conversation.js";

test("requires a substantive assistant answer after the final tool result", () => {
  assert.equal(hasFinalAssistantAnswer([
    { type: "message", data: { role: "assistant", content: "Let me look that up." } },
    { type: "tool_call", data: { toolId: "queryKnowledgeDataset" } },
    { type: "tool_result", data: { content: "exact row" } },
    { type: "progress", data: { phase: "Turn complete" } },
  ]), false);

  assert.equal(hasFinalAssistantAnswer([
    { type: "tool_call", data: { toolId: "queryKnowledgeDataset" } },
    { type: "tool_result", data: { content: "exact row" } },
    { type: "message", data: { role: "assistant", content: "160 joints take about 326 MH." } },
  ]), true);
});

test("builds provider-neutral context and omits unfinished assistant chatter", () => {
  const context = buildModeConversationContext([
    {
      input: { prompt: "It is 3-inch 304L Sch 10S." },
      output: { events: [
        { type: "message", data: { role: "user", content: "It is 3-inch 304L Sch 10S." } },
        { type: "message", data: { role: "assistant", content: "About 326 MH using the dedicated 10% stainless adder." } },
      ] },
    },
    {
      input: { prompt: "How long for 160 butt welds?" },
      output: { events: [
        { type: "message", data: { role: "user", content: "How long for 160 butt welds?" } },
        { type: "message", data: { role: "assistant", content: "Let me pull the data." } },
        { type: "tool_result", data: { content: "row" } },
      ] },
    },
  ]);

  assert.match(context, /How long for 160 butt welds/);
  assert.doesNotMatch(context, /Let me pull the data/);
  assert.match(context, /It is 3-inch 304L Sch 10S/);
  assert.match(context, /About 326 MH/);
});
