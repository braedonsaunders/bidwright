import type {
  ProjectWorkspaceData,
  QuoteRevision,
  WorksheetItemMutationResponse,
  WorkspaceResponse,
  WorkspaceWorksheet,
  WorkspaceWorksheetItem,
} from "@/lib/api";

function sortWorksheetItems(items: WorkspaceWorksheetItem[]) {
  return [...items].sort((left, right) => {
    if (left.lineOrder !== right.lineOrder) {
      return left.lineOrder - right.lineOrder;
    }
    return left.id.localeCompare(right.id);
  });
}

function applyWorkspaceMutationState(
  workspace: ProjectWorkspaceData,
  worksheets: WorkspaceWorksheet[],
  options?: {
    currentRevision?: QuoteRevision;
    estimateTotals?: ProjectWorkspaceData["estimate"]["totals"];
  },
): ProjectWorkspaceData {
  const lineItems = worksheets.flatMap((worksheet) => worksheet.items);
  const nextRevision = options?.currentRevision ?? workspace.currentRevision;

  return {
    ...workspace,
    currentRevision: nextRevision,
    worksheets,
    estimate: {
      ...workspace.estimate,
      revisionId: nextRevision.id,
      lineItems,
      totals: options?.estimateTotals
        ? {
            ...workspace.estimate.totals,
            ...options.estimateTotals,
          }
        : workspace.estimate.totals,
      summary: {
        ...workspace.estimate.summary,
        worksheetCount: worksheets.length,
        lineItemCount: lineItems.length,
      },
    },
  };
}

export function applyWorksheetItemUpsert(
  current: WorkspaceResponse,
  item: WorkspaceWorksheetItem,
  currentRevisionOverride?: QuoteRevision,
  estimateTotals?: ProjectWorkspaceData["estimate"]["totals"],
) {
  const targetExists = current.workspace.worksheets.some(
    (worksheet) => worksheet.id === item.worksheetId,
  );

  const nextWorksheets = targetExists
    ? current.workspace.worksheets.map((worksheet) => {
        if (worksheet.id === item.worksheetId) {
          // Upsert into the target worksheet.
          const existingIndex = worksheet.items.findIndex(
            (worksheetItem) => worksheetItem.id === item.id,
          );
          const nextItems = [...worksheet.items];
          if (existingIndex >= 0) {
            nextItems[existingIndex] = item;
          } else {
            nextItems.push(item);
          }
          return { ...worksheet, items: sortWorksheetItems(nextItems) };
        }
        // Remove the item from any other worksheet so a cross-worksheet move
        // doesn't leave a stale duplicate row in the source worksheet.
        if (worksheet.items.some((worksheetItem) => worksheetItem.id === item.id)) {
          return {
            ...worksheet,
            items: worksheet.items.filter((worksheetItem) => worksheetItem.id !== item.id),
          };
        }
        return worksheet;
      })
    : current.workspace.worksheets;

  return {
    ...current,
    workspace: applyWorkspaceMutationState(current.workspace, nextWorksheets, {
      currentRevision: currentRevisionOverride,
      estimateTotals,
    }),
  };
}

export function applyWorksheetItemDelete(
  current: WorkspaceResponse,
  itemId: string,
  currentRevisionOverride?: QuoteRevision,
  estimateTotals?: ProjectWorkspaceData["estimate"]["totals"],
) {
  const nextWorksheets = current.workspace.worksheets.map((worksheet) => ({
    ...worksheet,
    items: worksheet.items.filter((item) => item.id !== itemId),
  }));

  return {
    ...current,
    workspace: applyWorkspaceMutationState(current.workspace, nextWorksheets, {
      currentRevision: currentRevisionOverride,
      estimateTotals,
    }),
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
      mutation.estimateTotals,
    );
  }

  return applyWorksheetItemUpsert(
    current,
    mutation.item,
    mutation.currentRevision,
    mutation.estimateTotals,
  );
}
