import assert from "node:assert/strict";
import test from "node:test";

import { Window } from "happy-dom";
import React, { act } from "react";
import { createRoot } from "react-dom/client";

function installDom() {
  const browserWindow = new Window();
  Object.defineProperty(globalThis, "window", { configurable: true, value: browserWindow });
  Object.defineProperty(globalThis, "document", { configurable: true, value: browserWindow.document });
  Object.defineProperty(globalThis, "navigator", { configurable: true, value: browserWindow.navigator });
  Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", { configurable: true, value: true });
  return browserWindow;
}

const pendingRow = {
  id: "fb-1",
  projectId: "project-1",
  revisionId: "rev-1",
  source: "human_edit",
  feedbackType: "line_correction",
  sourceLabel: "Human line corrections",
  aiSnapshot: {},
  humanSnapshot: {},
  deltaSummary: {},
  corrections: [{
    action: "update_item",
    itemId: "li-1",
    entityName: "SS Epoxy Anchors 3/4\"",
    changes: [{ field: "quantity", before: 32, after: 5 }],
    aiDerivation: { formula: "basePlates * anchorsPerPlate", result: { value: 32 } },
  }],
  lessons: [],
  notes: "",
  reviewStatus: "pending" as const,
  createdAt: "2026-10-07T15:00:00.000Z",
  updatedAt: "2026-10-07T15:00:00.000Z",
};

test("describeCorrection and suggestLessonFromCorrection turn a 32→5 edit into a readable, editable lesson", async () => {
  const { describeCorrection, suggestLessonFromCorrection } = await import("./calibration-review-panel");
  assert.match(describeCorrection(pendingRow.corrections[0]), /quantity: 32 → 5/);
  const suggestion = suggestLessonFromCorrection(pendingRow.corrections[0]);
  assert.ok(suggestion);
  assert.match(suggestion!, /32 was corrected to 5/);
  assert.match(suggestion!, /basePlates \* anchorsPerPlate/);
});

test("approving sends the edited lessons and only approved rows show as approved", async () => {
  const browserWindow = installDom();
  const { CalibrationReviewPanel } = await import("./calibration-review-panel");

  const calls: Array<{ feedbackId: string; body: Record<string, unknown> }> = [];
  const submitReview = (async (_projectId: string, feedbackId: string, body: Record<string, unknown>) => {
    calls.push({ feedbackId, body });
    return {
      ok: true,
      feedback: { ...pendingRow, reviewStatus: "approved" as const, approvedLessons: body.approvedLessons as Array<Record<string, unknown>>, reviewedBy: "estimator@example.com" },
    };
  }) as any;

  const container = browserWindow.document.createElement("div");
  browserWindow.document.body.append(container);
  const root = createRoot(container as unknown as HTMLDivElement);

  await act(async () => {
    root.render(
      <CalibrationReviewPanel
        projectId="project-1"
        loadFeedback={async () => [pendingRow]}
        submitReview={submitReview}
      />,
    );
  });
  // let the effect-driven load settle
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });

  const row = container.querySelector('[data-testid="calibration-row-fb-1"]');
  assert.ok(row, "pending row renders");
  assert.match(row!.textContent ?? "", /pending/);
  assert.match(row!.textContent ?? "", /quantity: 32 → 5/);

  const lessonBox = row!.querySelector('textarea[aria-label="Lesson"]') as HTMLTextAreaElement | null;
  assert.ok(lessonBox, "a suggested lesson is pre-filled for editing");
  assert.match(lessonBox!.value, /corrected to 5/);

  const approve = row!.querySelector('[data-testid="approve-fb-1"]') as unknown as HTMLButtonElement;
  await act(async () => { approve.click(); });
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].feedbackId, "fb-1");
  assert.equal(calls[0].body.status, "approved");
  const approvedLessons = calls[0].body.approvedLessons as Array<{ lesson: string }>;
  assert.equal(approvedLessons.length, 1);
  assert.match(approvedLessons[0].lesson, /corrected to 5/);

  // The row flips to approved and leaves the pending filter.
  assert.equal(container.querySelector('[data-testid="calibration-row-fb-1"]'), null, "approved row leaves the pending list");
  root.unmount();
});

test("approving with no lesson text is refused client-side", async () => {
  const browserWindow = installDom();
  const { CalibrationReviewPanel } = await import("./calibration-review-panel");
  const errors: string[] = [];
  let submitted = 0;
  const container = browserWindow.document.createElement("div");
  browserWindow.document.body.append(container);
  const root = createRoot(container as unknown as HTMLDivElement);
  await act(async () => {
    root.render(
      <CalibrationReviewPanel
        projectId="project-1"
        onError={(message) => errors.push(message)}
        loadFeedback={async () => [{ ...pendingRow, corrections: [] }]}
        submitReview={(async () => { submitted += 1; throw new Error("should not be called"); }) as any}
      />,
    );
  });
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
  const approve = container.querySelector('[data-testid="approve-fb-1"]') as unknown as HTMLButtonElement;
  await act(async () => { approve.click(); });
  assert.equal(submitted, 0);
  assert.ok(errors.some((message) => /at least one lesson/i.test(message)));
  root.unmount();
});
