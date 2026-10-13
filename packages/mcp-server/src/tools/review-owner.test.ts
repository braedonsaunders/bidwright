import assert from "node:assert/strict";
import test from "node:test";
import { registerReviewTools } from "./review-tools.js";

test("harness-owned review never starts or polls a server reviewer", async t => {
  const handlers = new Map<string, any>();
  registerReviewTools({ tool: (name: string, ...args: any[]) => handlers.set(name, args.at(-1)) } as any);
  const old = process.env.BIDWRIGHT_REVIEW_OWNER;
  process.env.BIDWRIGHT_REVIEW_OWNER = "harness";
  t.mock.method(globalThis, "fetch", async () => { throw new Error("server reviewer must not be contacted"); });
  try {
    for (const args of [{}, { reviewId: "existing" }]) {
      const result = await handlers.get("requestEstimateReview")(args);
      assert.equal(JSON.parse(result.content[0].text).status, "scheduled_locally");
    }
  } finally { if (old === undefined) delete process.env.BIDWRIGHT_REVIEW_OWNER; else process.env.BIDWRIGHT_REVIEW_OWNER = old; }
});
