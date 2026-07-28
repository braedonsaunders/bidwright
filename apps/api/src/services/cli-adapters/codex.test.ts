import assert from "node:assert/strict";
import { test } from "node:test";

import { codexAdapter } from "./codex.js";
import type { ParserState } from "./types.js";

function parserState(): ParserState {
  return { toolStartTimes: new Map() };
}

test("Codex protocol telemetry never becomes a chat message", () => {
  const telemetry = [
    { method: "thread/tokenUsage/updated", params: { tokenUsage: { total: { totalTokens: 712_664 } } } },
    { method: "account/rateLimits/updated", params: { rateLimits: { limitId: "codex" } } },
    { method: "thread/status/changed", params: { status: "active" } },
    { method: "remoteControl/status/changed", params: { status: "disabled" } },
    { method: "item/reasoning/textDelta", params: { delta: "internal reasoning" } },
  ];

  for (const message of telemetry) {
    assert.deepEqual(codexAdapter.parseEvent(message, parserState()), []);
  }
});

test("Codex App Server assistant messages and tool startup status remain visible", () => {
  assert.deepEqual(
    codexAdapter.parseEvent(
      {
        method: "item/completed",
        params: { item: { id: "assistant-1", type: "agentMessage", text: "Intake complete." } },
      },
      parserState(),
    ),
    [{ type: "message", data: { role: "assistant", content: "Intake complete." } }],
  );

  const progress = codexAdapter.parseEvent(
    {
      method: "mcpServer/startupStatus/updated",
      params: { server: "bidwright", status: "ready" },
    },
    parserState(),
  );
  assert.deepEqual(progress, [
    { type: "progress", data: { phase: "Tools", detail: "bidwright ready" } },
  ]);
});
