import assert from "node:assert/strict";
import test from "node:test";
import { isAgentToolMutating } from "@bidwright/domain";
import { unwrapInvokeToolEvent } from "./cli-runtime.js";
import type { SSEEventData } from "./cli-adapters/types.js";

test("indirect tool events expose the target identity and input while retaining result correlation", () => {
  for (const toolId of ["invokeTool", "mcp__bidwright__invokeTool"]) {
    for (const [name, args] of [
      ["createWorksheet", { name: "Mechanical" }],
      ["readDrawingPage", { documentId: "drawing", pageNumber: 2 }],
    ] as const) {
      const event: SSEEventData = { type: "tool_call", data: { toolId, toolUseId: "call-1", input: { name, args } } };
      const expected = { toolId: name, toolUseId: "call-1", input: args, invokedVia: toolId };
      assert.deepEqual(unwrapInvokeToolEvent(event).data, expected);
      assert.deepEqual(unwrapInvokeToolEvent({ ...event, data: { ...(event.data as object), input: JSON.stringify({ name, args }) } }).data, expected);
      assert.equal(isAgentToolMutating(expected.toolId), name === "createWorksheet");
      assert.equal((event.data as any).toolId, toolId);
    }
  }
  for (const event of [
    { type: "tool_call", data: { toolId: "readDrawingPage", toolUseId: "call-1", input: {} } },
    { type: "tool_result", data: { toolUseId: "call-1", content: [{ type: "image", data: "png" }] } },
    { type: "tool_call", data: { toolId: "invokeTool", input: "invalid JSON" } },
  ] satisfies SSEEventData[]) assert.equal(unwrapInvokeToolEvent(event), event);
});
