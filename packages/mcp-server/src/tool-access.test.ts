import assert from "node:assert/strict";
import { test } from "node:test";
import { isToolAllowed } from "./tool-access.js";

test("review reports can be saved but estimator mutations cannot", () => {
  for (const tool of ["createWorksheetItem", "updateWorksheetItem", "deleteWorksheetItem", "finalizeEstimate", "updateQuote", "writeMemory"]) {
    assert.equal(isToolAllowed(tool, "qa", true), false, tool);
  }
  for (const tool of ["saveReviewCoverage", "saveReviewFindings", "saveReviewSummary", "getWorkspace", "readDrawingPage", "readDrawingTile", "getLineDerivation"]) {
    assert.equal(isToolAllowed(tool, "qa", true), true, tool);
  }
  assert.equal(isToolAllowed("saveReviewSummary", "qa"), false);
  assert.equal(isToolAllowed("updateWorksheetItem", "build_estimate"), true);
});

test("unknown tools fail closed; dynamic integrations have a declared policy", async () => {
  const { getAgentToolDefinition } = await import("@bidwright/domain");
  assert.equal(isToolAllowed("apparentlyReadOnlyButUnknown", "qa"), false);
  assert.equal(getAgentToolDefinition("integration_example_lookup")?.mutates, true);
  assert.equal(isToolAllowed("integration_example_lookup", "qa"), false);
});

test("every registered MCP tool has a registry definition, including integration actions", async (t) => {
  const { getAgentToolDefinition } = await import("@bidwright/domain");
  const { registerTools } = await import("./index.js");
  const registered: string[] = [];
  t.mock.method(globalThis, "fetch", async (url: string) => Response.json(
    url.endsWith("/integrations")
      ? { integrations: [{ id: "example", slug: "example", enabled: true, exposeToMcp: true }] }
      : { manifest: { capabilities: { actions: [{ id: "lookup", input: [], mutates: false }] } } },
  ));
  const capture = (name: string) => { registered.push(name); };
  await registerTools({ tool: capture, registerTool: capture } as any);
  assert.ok(registered.includes("integration_example_lookup"));
  assert.ok(registered.length > 150);
  for (const name of registered) assert.ok(getAgentToolDefinition(name), `Missing registry entry: ${name}`);
});
