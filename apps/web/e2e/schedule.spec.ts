import { expect, test, type Locator, type Page } from "@playwright/test";

async function dragBy(locator: Locator, page: Page, deltaX: number) {
  const box = await locator.boundingBox();
  if (!box) {
    throw new Error("Unable to resolve drag target bounding box.");
  }
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + deltaX, box.y + box.height / 2, { steps: 12 });
  await page.mouse.up();
}

async function dragFromPoint(
  locator: Locator,
  page: Page,
  {
    deltaX,
    deltaY = 0,
    startXRatio = 0.5,
    startYRatio = 0.5,
  }: { deltaX: number; deltaY?: number; startXRatio?: number; startYRatio?: number }
) {
  const box = await locator.boundingBox();
  if (!box) {
    throw new Error("Unable to resolve drag target bounding box.");
  }
  const startX = box.x + box.width * startXRatio;
  const startY = box.y + box.height * startYRatio;
  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(startX + deltaX, startY + deltaY, { steps: 12 });
  await page.mouse.up();
}

test("schedule harness supports gantt, baseline, calendar, resource, and task editing flows", async ({ page }) => {
  await page.setViewportSize({ width: 900, height: 1200 });
  await page.goto("/qa/schedule");

  await expect(page.getByTestId("schedule-tab")).toBeVisible();
  await expect(page.getByText("Schedule Module Browser Harness")).toBeVisible();
  const toolbar = page.getByTestId("schedule-toolbar");
  await expect(toolbar).toBeVisible();
  const toolbarFits = await toolbar.evaluate((element) => element.scrollWidth <= element.clientWidth);
  expect(toolbarFits).toBeTruthy();
  await page.setViewportSize({ width: 1280, height: 1200 });

  const ganttScrollRegion = page.getByTestId("gantt-scroll-region");
  await expect(ganttScrollRegion).toBeVisible();
  const splitter = page.getByTestId("gantt-splitter");
  await expect(splitter).toHaveCount(1);

  await page.getByTestId("schedule-zoom-month").click();
  const monthHeaders = await page.locator('[data-testid^="gantt-header-column-"]').allTextContents();
  expect(monthHeaders.length).toBeGreaterThanOrEqual(12);
  expect(monthHeaders.some((label) => label.includes("Sep") || label.includes("Oct") || label.includes("Jan"))).toBeTruthy();

  await page.getByTestId("schedule-zoom-day").click();
  const closeoutBar = page.getByTestId("gantt-bar-task-closeout");
  await expect(closeoutBar).toBeVisible();
  const mobilizeToggle = page.getByRole("button", { name: /(collapse|expand) mobilize and layout/i });
  await mobilizeToggle.click();
  await expect(page.getByTestId("gantt-bar-task-curbs")).toHaveCount(0);
  await mobilizeToggle.click();
  await expect(page.getByTestId("gantt-bar-task-curbs")).toBeVisible();
  const ganttHasOverflow = await ganttScrollRegion.evaluate((element) => element.scrollWidth > element.clientWidth);
  expect(ganttHasOverflow).toBeTruthy();
  const scrollLeftBefore = await ganttScrollRegion.evaluate((element) => element.scrollLeft);
  await dragFromPoint(ganttScrollRegion, page, { deltaX: -180, startXRatio: 0.7, startYRatio: 0.08 });
  const scrollLeftAfter = await ganttScrollRegion.evaluate((element) => element.scrollLeft);
  expect(scrollLeftAfter).toBeGreaterThan(scrollLeftBefore + 50);

  await dragBy(page.getByTestId("gantt-bar-move-task-closeout"), page, 120);
  await dragBy(page.getByTestId("gantt-bar-end-task-closeout"), page, 60);
  await expect(page.getByText("Schedule action failed")).toHaveCount(0);

  await page.getByTestId("schedule-manage").click();
  const managementModal = page.getByTestId("schedule-management-modal");
  await expect(managementModal).toBeVisible();

  await page.getByTestId("baseline-name-input").fill("Field Snapshot");
  await page.getByTestId("baseline-create").click();
  await expect(managementModal.locator("p").filter({ hasText: "Field Snapshot" }).first()).toBeVisible();

  await page.getByRole("tab", { name: "Calendars" }).click();
  await page.getByTestId("calendar-name-input").fill("Saturday Shift");
  await page.getByTestId("calendar-create").click();
  await expect(managementModal.locator("p").filter({ hasText: "Saturday Shift" }).first()).toBeVisible();

  await page.getByRole("tab", { name: "Resources" }).click();
  await page.getByTestId("resource-name-input").fill("Crew B");
  await page.getByTestId("resource-create").click();
  await expect(managementModal.locator("p").filter({ hasText: "Crew B" }).first()).toBeVisible();

  await page.getByTestId("schedule-management-close").click();
  await expect(page.getByTestId("schedule-management-modal")).toHaveCount(0);

  await page.getByTestId("schedule-view-list").click();
  await expect(page.getByTestId("schedule-list")).toBeVisible();
  await expect(page.getByTestId("schedule-list-row-task-curbs")).toContainText("Crew A");
  await page.getByTestId("schedule-list-select-task-closeout").check();
  await page.getByTestId("schedule-list-bulk-in-progress").click();
  await expect(page.getByTestId("schedule-list-row-task-closeout")).toContainText("In Progress");
  await page.getByTestId("schedule-list-row-task-curbs").click({ button: "right" });
  await page.getByText("Add Child Task", { exact: true }).click();
  await expect(page.getByTestId("schedule-list")).toContainText("New Child Task");

  await page.getByTestId("schedule-view-board").click();
  await expect(page.getByTestId("schedule-board")).toBeVisible();
  await page.getByTestId("schedule-board-card-task-closeout").dragTo(page.getByTestId("schedule-board-column-complete"));
  const completeColumn = page.getByTestId("schedule-board-column-complete");
  await expect(completeColumn.getByTestId("schedule-board-card-task-closeout")).toBeVisible();

  await completeColumn.getByTestId("schedule-board-card-task-closeout").click();
  await expect(page.getByTestId("task-popover")).toBeVisible();
  const taskPopoverPanel = page.getByTestId("task-popover-panel");
  const modalHeightBefore = (await taskPopoverPanel.boundingBox())?.height ?? 0;
  await page.getByRole("tab", { name: "Placement" }).click();
  await expect(page.getByText("Hierarchy Rules")).toBeVisible();
  const modalHeightAfterPlacement = (await taskPopoverPanel.boundingBox())?.height ?? 0;
  expect(Math.abs(modalHeightAfterPlacement - modalHeightBefore)).toBeLessThan(2);
  await page.getByRole("tab", { name: "Dates" }).click();
  await page.getByTestId("task-deadline-date").fill("2026-04-18");
  await page.getByRole("tab", { name: "Resources" }).click();
  const modalHeightAfterResources = (await taskPopoverPanel.boundingBox())?.height ?? 0;
  expect(Math.abs(modalHeightAfterResources - modalHeightBefore)).toBeLessThan(2);
  await page.getByTestId("task-add-resource").click();
  await page.getByTestId("task-resource-1").selectOption({ label: "Crew B" });
  await page.getByTestId("task-resource-role-1").fill("Support");
  await page.getByTestId("task-save").click();
  await expect(page.getByTestId("task-popover")).toHaveCount(0);
  await expect(completeColumn.getByTestId("schedule-board-card-task-closeout")).toContainText("Crew B");
  await expect(page.getByText("Schedule action failed")).toHaveCount(0);
});
