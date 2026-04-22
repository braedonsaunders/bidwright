import { calculateTotals } from "@bidwright/domain";

import type {
  EstimateTotalBreakout,
  ProjectWorkspaceData,
  QuoteRevision,
  SourceTotalEntry,
  WorksheetItemMutationResponse,
  WorkspaceResponse,
  WorkspaceWorksheet,
  WorkspaceWorksheetItem,
} from "@/lib/api";

function replaceWorksheet(
  worksheets: WorkspaceWorksheet[],
  worksheetId: string,
  update: (worksheet: WorkspaceWorksheet) => WorkspaceWorksheet,
) {
  return worksheets.map((worksheet) =>
    worksheet.id === worksheetId ? update(worksheet) : worksheet,
  );
}

function sortWorksheetItems(items: WorkspaceWorksheetItem[]) {
  return [...items].sort((left, right) => {
    if (left.lineOrder !== right.lineOrder) {
      return left.lineOrder - right.lineOrder;
    }
    return left.id.localeCompare(right.id);
  });
}

function rebuildWorkspaceEstimate(
  workspace: ProjectWorkspaceData,
  worksheets: WorkspaceWorksheet[],
  currentRevisionOverride?: QuoteRevision,
): ProjectWorkspaceData {
  const lineItems = worksheets.flatMap((worksheet) => worksheet.items);

  try {
    const totals = calculateTotals(
      (currentRevisionOverride ?? workspace.currentRevision) as any,
      worksheets as any,
      workspace.phases as any,
      workspace.adjustments as any,
      workspace.rateSchedules as any,
    );

    const nextRevision: QuoteRevision = currentRevisionOverride
      ? {
          ...currentRevisionOverride,
          regHours: totals.regHours,
          overHours: totals.overHours,
          doubleHours: totals.doubleHours,
          breakoutPackage:
            (currentRevisionOverride.breakoutPackage?.length
              ? currentRevisionOverride.breakoutPackage
              : (totals.breakout as unknown[])) ?? [],
          calculatedCategoryTotals:
            (currentRevisionOverride.calculatedCategoryTotals?.length
              ? currentRevisionOverride.calculatedCategoryTotals
              : (totals.categoryTotals as unknown[])) ?? [],
          calculatedTotal:
            currentRevisionOverride.calculatedTotal ?? totals.calculatedTotal,
        }
      : {
          ...workspace.currentRevision,
          subtotal: totals.subtotal,
          cost: totals.cost,
          estimatedProfit: totals.estimatedProfit,
          estimatedMargin: totals.estimatedMargin,
          calculatedTotal: totals.calculatedTotal,
          totalHours: totals.totalHours,
          regHours: totals.regHours,
          overHours: totals.overHours,
          doubleHours: totals.doubleHours,
          breakoutPackage: totals.breakout as unknown[],
          calculatedCategoryTotals: totals.categoryTotals as unknown[],
        };

    const breakout =
      ((nextRevision.breakoutPackage as EstimateTotalBreakout[] | undefined) ??
        totals.breakout) as EstimateTotalBreakout[];
    const categoryTotals =
      ((nextRevision.calculatedCategoryTotals as SourceTotalEntry[] | undefined) ??
        totals.categoryTotals) as SourceTotalEntry[];

    return {
      ...workspace,
      currentRevision: nextRevision,
      worksheets,
      estimate: {
        ...workspace.estimate,
        revisionId: nextRevision.id,
        lineItems,
        totals: {
          ...workspace.estimate.totals,
          ...totals,
          subtotal: nextRevision.subtotal,
          cost: nextRevision.cost,
          estimatedProfit: nextRevision.estimatedProfit,
          estimatedMargin: nextRevision.estimatedMargin,
          calculatedTotal: nextRevision.calculatedTotal ?? totals.calculatedTotal,
          totalHours: nextRevision.totalHours,
          breakout,
          categoryTotals,
        },
        summary: {
          ...workspace.estimate.summary,
          worksheetCount: worksheets.length,
          lineItemCount: lineItems.length,
        },
      },
    };
  } catch {
    return {
      ...workspace,
      worksheets,
      estimate: {
        ...workspace.estimate,
        lineItems,
        summary: {
          ...workspace.estimate.summary,
          worksheetCount: worksheets.length,
          lineItemCount: lineItems.length,
        },
      },
    };
  }
}

export function applyWorksheetItemUpsert(
  current: WorkspaceResponse,
  item: WorkspaceWorksheetItem,
  currentRevisionOverride?: QuoteRevision,
) {
  const nextWorksheets = current.workspace.worksheets.some(
    (worksheet) => worksheet.id === item.worksheetId,
  )
    ? replaceWorksheet(current.workspace.worksheets, item.worksheetId, (worksheet) => {
        const existingIndex = worksheet.items.findIndex(
          (worksheetItem) => worksheetItem.id === item.id,
        );
        const nextItems = [...worksheet.items];
        if (existingIndex >= 0) {
          nextItems[existingIndex] = item;
        } else {
          nextItems.push(item);
        }
        return {
          ...worksheet,
          items: sortWorksheetItems(nextItems),
        };
      })
    : current.workspace.worksheets;

  return {
    ...current,
    workspace: rebuildWorkspaceEstimate(
      current.workspace,
      nextWorksheets,
      currentRevisionOverride,
    ),
  };
}

export function applyWorksheetItemDelete(
  current: WorkspaceResponse,
  itemId: string,
  currentRevisionOverride?: QuoteRevision,
) {
  const nextWorksheets = current.workspace.worksheets.map((worksheet) => ({
    ...worksheet,
    items: worksheet.items.filter((item) => item.id !== itemId),
  }));

  return {
    ...current,
    workspace: rebuildWorkspaceEstimate(
      current.workspace,
      nextWorksheets,
      currentRevisionOverride,
    ),
  };
}

export function applyWorksheetItemMutation(
  current: WorkspaceResponse,
  mutation: WorksheetItemMutationResponse,
) {
  if (mutation.mode === "delete") {
    return applyWorksheetItemDelete(
      current,
      mutation.item.id,
      mutation.currentRevision,
    );
  }

  return applyWorksheetItemUpsert(
    current,
    mutation.item,
    mutation.currentRevision,
  );
}
