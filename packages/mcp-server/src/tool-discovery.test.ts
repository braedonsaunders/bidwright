import assert from "node:assert/strict";
import test from "node:test";
import { compactToolSchema, toolDiscoveryPhase } from "./tool-discovery.js";
test("schemas for the round-seven work categories fit four phase requests", () => {
  const categories = ["workspace", "documents", "knowledge", "resources", "vision", "worksheet", "quote", "strategy", "review"];
  assert.equal(new Set(categories.map(toolDiscoveryPhase)).size, 4);
  const schema = compactToolSchema({ type: "object", required: ["quantity"], properties: { quantity: { type: "number", minimum: 0, description: "x".repeat(400) } } });
  assert.deepEqual(schema.required, ["quantity"]); assert.equal(schema.properties.quantity.minimum, 0);
  assert.equal(schema.properties.quantity.description.length, 180);
});
