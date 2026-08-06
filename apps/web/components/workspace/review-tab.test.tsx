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

const LONG_ANALYSIS =
  "The estimate carries 240 hours for pipe supports against a benchmark of 150 hours. "
  + "Field productivity assumed 0.62 supports per hour where the reference dataset reports 1.05. "
  + "Recommend re-basing to the shop-fabricated support rate and confirming the spool count.";

test("competitiveness rows open a drawer with the untruncated analysis", async () => {
  const browserWindow = installDom();
  const { CompetitivenessSubTab } = await import("./review-tab");

  const container = browserWindow.document.createElement("div");
  browserWindow.document.body.append(container);
  const root = createRoot(container as unknown as HTMLDivElement);

  await act(async () => {
    root.render(
      <CompetitivenessSubTab
        data={{
          overestimates: [{
            id: "over-1",
            impact: "HIGH",
            area: "Pipe supports",
            analysis: LONG_ANALYSIS,
            savingsRange: "$12k–$18k",
            currentValue: "240 hrs",
            benchmarkValue: "150 hrs",
            status: "open",
            resolutionNote: "Confirm spool count with fabrication.",
          }],
          underestimates: [{
            id: "under-1",
            impact: "MEDIUM",
            area: "Hydrotest",
            analysis: LONG_ANALYSIS,
            riskRange: "$4k–$9k",
            status: "open",
          }],
          totalSavingsRange: "$12k–$18k",
        }}
        editable={false}
        busy={false}
        onChange={() => {}}
      />,
    );
  });

  // The table itself still truncates — that is what keeps the two tables
  // readable side by side.
  const analysisCell = container.querySelector(".line-clamp-3");
  assert.ok(analysisCell, "table analysis stays clamped");

  assert.equal(browserWindow.document.querySelector('[role="dialog"]'), null, "drawer starts closed");

  const row = container.querySelector("tbody tr") as unknown as HTMLElement;
  assert.ok(row, "renders a row");
  await act(async () => { row.click(); });

  const panel = browserWindow.document.querySelector('[role="dialog"]');
  assert.ok(panel, "clicking a row opens the drawer");
  const panelText = panel!.textContent ?? "";
  assert.ok(panelText.includes("Pipe supports"), "drawer titles the area");
  assert.ok(panelText.includes(LONG_ANALYSIS), "drawer shows the complete analysis");
  assert.ok(panelText.includes("240 hrs") && panelText.includes("150 hrs"), "drawer shows current vs benchmark");
  assert.ok(panelText.includes("$12k–$18k"), "drawer shows the savings range");
  assert.ok(panelText.includes("Confirm spool count with fabrication."), "drawer shows the resolution note");

  await act(async () => { root.unmount(); });
});

test("competitiveness scroll panes are scrollable rather than clipped", async () => {
  const browserWindow = installDom();
  const { CompetitivenessSubTab } = await import("./review-tab");

  const container = browserWindow.document.createElement("div");
  browserWindow.document.body.append(container);
  const root = createRoot(container as unknown as HTMLDivElement);

  await act(async () => {
    root.render(
      <CompetitivenessSubTab
        data={{
          overestimates: Array.from({ length: 12 }, (_, index) => ({
            id: `over-${index}`,
            impact: "LOW" as const,
            area: `Area ${index}`,
            analysis: LONG_ANALYSIS,
            savingsRange: "$1k",
            status: "open" as const,
          })),
          underestimates: [],
        }}
        editable={false}
        busy={false}
        onChange={() => {}}
      />,
    );
  });

  // Stacked below xl the split grid must scroll; a clipped grid is what made
  // rows overlap with no way to reach them.
  const splitGrid = container.querySelector(".overflow-y-auto");
  assert.ok(splitGrid, "the stacked split scrolls");
  // The table body keeps its own scroll container at wide widths.
  assert.ok(container.querySelector(".overflow-auto"), "the table pane scrolls");

  await act(async () => { root.unmount(); });
});
