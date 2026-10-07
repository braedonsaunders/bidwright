import assert from "node:assert/strict";
import test from "node:test";
import { findPendingQuestionEvent, type QuestionHistoryEvent } from "./cli-question-history.js";

const ask: QuestionHistoryEvent = { type: "askUser", data: { questionId: "ask-1", question: "Include hose routing?" }, timestamp: "2026-10-07T16:53:24.835Z" };
test("buffered triggering activity cannot erase an unanswered question", () => {
  const events = [ask,
    { type: "message", timestamp: "2026-10-07T16:53:23.124Z", data: { role: "assistant" } },
    { type: "tool_call", timestamp: "2026-10-07T16:53:24.829Z", data: { toolId: "mcp__bidwright__askUser" } },
  ];
  assert.equal(findPendingQuestionEvent(events), ask);
  assert.equal(findPendingQuestionEvent(events, "ask-1"), ask);
});
test("later progress, tool traffic and usage do not constitute a user answer", () => {
  const events = [ask, ...["progress", "usage", "message", "tool_call", "tool_result"].map((type) => ({ type, timestamp: "2026-10-07T16:53:25.000Z" }))];
  assert.equal(findPendingQuestionEvent(events), ask);
});
test("explicit resolution survives reversed persistence order", () => {
  for (const type of ["userAnswer", "askUserTimeout"]) {
    const resolution = { type, data: { questionId: "ask-1" }, timestamp: "2026-10-07T16:54:00.000Z" };
    assert.equal(findPendingQuestionEvent([resolution, ask]), null);
    assert.equal(findPendingQuestionEvent([ask, resolution]), null);
  }
});
test("an unrelated answer does not clear the question and a new question supersedes it", () => {
  assert.equal(findPendingQuestionEvent([ask, { type: "userAnswer", data: { questionId: "other" } }]), ask);
  const next = { ...ask, data: { questionId: "ask-2" }, timestamp: "2026-10-07T16:54:00.000Z" };
  assert.equal(findPendingQuestionEvent([next, ask]), next);
  assert.equal(findPendingQuestionEvent([next, ask], "ask-1"), ask);
});
