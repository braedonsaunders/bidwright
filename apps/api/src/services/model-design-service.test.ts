import test from "node:test";
import assert from "node:assert/strict";
import { parseModelDesignResponse } from "./model-design-service.js";

test("clarification stays a question rather than an empty model", () => {
  assert.deepEqual(parseModelDesignResponse('{"message":"What thickness?","recipe":null}'), { message: "What thickness?", recipe: null });
});
test("fenced provider JSON is accepted but malformed designs are rejected", () => {
  assert.deepEqual(parseModelDesignResponse('```json\n{"message":"What width?","recipe":null}\n```'), { message: "What width?", recipe: null });
  assert.throws(() => parseModelDesignResponse('{"message":"Done","recipe":{"version":1}}'), /header/);
  assert.throws(() => parseModelDesignResponse('{"message":"Done"}'), /header/);
});
