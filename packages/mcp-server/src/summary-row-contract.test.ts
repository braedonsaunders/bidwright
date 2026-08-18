import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

const tools = readFileSync(new URL("./tools/quote-tools.ts", import.meta.url), "utf8");
const api = readFileSync(new URL("../../../apps/api/src/server.ts", import.meta.url), "utf8");

/** Field names and the `type` enum the API actually accepts for a summary row. */
function apiContract() {
  const schema = api.slice(api.indexOf("const summaryRowCreateSchema = z.object({"));
  const body = schema.slice(0, schema.indexOf("\n  });"));
  return {
    fields: new Set([...body.matchAll(/^\s{4}(\w+):/gm)].map((m) => m[1])),
    types: /type: z\.enum\(\[([^\]]+)\]/.exec(body)![1]
      .split(",")
      .map((value) => value.trim().replace(/"/g, "")),
  };
}

/** Field names and `type` enum a tool sends, read from its zod schema block. */
function toolContract(name: string, nextTool: string) {
  const body = tools.slice(tools.indexOf(`"${name}"`), tools.indexOf(`"${nextTool}"`));
  const schema = body.slice(body.indexOf("    {\n"), body.indexOf("async (input)"));
  const typeEnum = /type: z\.enum\(\[([^\]]+)\]/.exec(schema);
  return {
    fields: new Set([...schema.matchAll(/^\s{6}(\w+):/gm)].map((m) => m[1])),
    types: typeEnum ? typeEnum[1].split(",").map((v) => v.trim().replace(/"/g, "")) : [],
  };
}

test("createSummaryRow only sends fields the API accepts", () => {
  // The regression: the tool offered manualValue/manualCost/modifierPercent/
  // modifierAmount/sourceCategory/sourcePhase. Zod strips unknown keys, so the
  // API dropped every one of them and created a valueless row without erroring.
  const { fields } = apiContract();
  for (const field of toolContract("createSummaryRow", "updateSummaryRow").fields) {
    assert.ok(fields.has(field), `createSummaryRow sends "${field}", which the API silently drops`);
  }
});

test("updateSummaryRow only sends fields the API accepts", () => {
  const { fields } = apiContract();
  for (const field of toolContract("updateSummaryRow", "deleteSummaryRow").fields) {
    if (field === "rowId") continue; // path parameter, not part of the body
    assert.ok(fields.has(field), `updateSummaryRow sends "${field}", which the API silently drops`);
  }
});

test("createSummaryRow offers only row types the API will accept", () => {
  // The old enum offered auto_category/auto_phase/manual/modifier, none of
  // which are in the API enum — those calls 400'd outright.
  const { types } = apiContract();
  for (const type of toolContract("createSummaryRow", "updateSummaryRow").types) {
    assert.ok(types.includes(type), `createSummaryRow offers type "${type}", which the API rejects`);
  }
});
