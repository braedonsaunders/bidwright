import { z } from "zod";
import type { Tool, ToolExecutionContext, ToolResult } from "../types.js";

type StoreOperation = (ctx: ToolExecutionContext, input: Record<string, unknown>) => Promise<ToolResult>;

function createQuoteTool(def: {
  id: string;
  name: string;
  description: string;
  inputSchema: z.ZodType;
  requiresConfirmation?: boolean;
  tags: string[];
}, operation: StoreOperation): Tool {
  return {
    definition: {
      id: def.id,
      name: def.name,
      category: "quote",
      description: def.description,
      parameters: [],
      inputSchema: def.inputSchema,
      requiresConfirmation: def.requiresConfirmation ?? false,
      mutates: true,
      tags: def.tags,
    },
    async execute(input: Record<string, unknown>, context: ToolExecutionContext) {
      const start = Date.now();
      try {
        const result = await operation(context, input);
        return { ...result, duration_ms: Date.now() - start };
      } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : String(error), duration_ms: Date.now() - start };
      }
    },
  };
}

// ──────────────────────────────────────────────────────────────
// 1. quote.getWorkspace
// ──────────────────────────────────────────────────────────────
export const getWorkspaceTool = createQuoteTool({
  id: "quote.getWorkspace",
  name: "Get Project Workspace",
  description: "Get the complete current workspace including revision, worksheets, phases, modifiers, conditions, and financial totals.",
  inputSchema: z.object({}),
  tags: ["workspace", "read"],
}, async (ctx) => {
  return { success: true, data: { message: "Workspace data would be returned here" }, duration_ms: 0 };
});

// ──────────────────────────────────────────────────────────────
// 2. quote.listWorksheets
// ──────────────────────────────────────────────────────────────
export const listWorksheetsTool = createQuoteTool({
  id: "quote.listWorksheets",
  name: "List Worksheets",
  description: "List all worksheets in the current revision with their names, item counts, and subtotals.",
  inputSchema: z.object({}),
  tags: ["worksheet", "read"],
}, async (ctx) => {
  return { success: true, data: { message: "Worksheet list would be returned here" }, duration_ms: 0 };
});

// ──────────────────────────────────────────────────────────────
// 3. quote.searchItems
// ──────────────────────────────────────────────────────────────
export const searchItemsTool = createQuoteTool({
  id: "quote.searchItems",
  name: "Search Line Items",
  description: "Search line items across all worksheets by keyword, category, or price range. Returns matching items with their worksheet context.",
  inputSchema: z.object({
    query: z.string().optional().describe("Text search across entity name, description, and category"),
    category: z.string().optional().describe("Filter by category (e.g. 'Material', 'Labour', 'Equipment')"),
    worksheetId: z.string().optional().describe("Limit search to a specific worksheet"),
    minCost: z.number().optional().describe("Minimum cost filter"),
    maxCost: z.number().optional().describe("Maximum cost filter"),
    limit: z.number().optional().default(50).describe("Maximum number of results to return"),
  }),
  tags: ["item", "search", "read"],
}, async (ctx, input) => {
  return { success: true, data: { message: "Search results would be returned here", query: input }, duration_ms: 0 };
});

// ──────────────────────────────────────────────────────────────
// 4. quote.createWorksheetItem
// ──────────────────────────────────────────────────────────────
export const createWorksheetItemTool = createQuoteTool({
  id: "quote.createWorksheetItem",
  name: "Create Line Item",
  description: "Create a new line item in a worksheet. Requires worksheetId and at minimum an entityName. Costs and quantities default to 0.",
  inputSchema: z.object({
    worksheetId: z.string().describe("ID of the worksheet to add the item to"),
    category: z.string().optional().describe("Item category (e.g. 'Material', 'Labour', 'Equipment', 'Subcontractor')"),
    entityName: z.string().describe("Name of the line item"),
    description: z.string().optional().describe("Detailed description of the line item"),
    quantity: z.number().optional().default(1).describe("Quantity of the item"),
    uom: z.string().optional().default("EA").describe("Unit of measure (e.g. 'EA', 'LF', 'SF', 'HR', 'LS')"),
    cost: z.number().optional().default(0).describe("Unit cost"),
    markup: z.number().optional().default(0).describe("Markup percentage (e.g. 15 for 15%)"),
    price: z.number().optional().describe("Override unit price (if not calculated from cost+markup)"),
    laborHourReg: z.number().optional().default(0).describe("Regular labor hours per unit"),
    laborHourOver: z.number().optional().default(0).describe("Overtime labor hours per unit"),
    laborHourDouble: z.number().optional().default(0).describe("Double-time labor hours per unit"),
    phaseId: z.string().optional().describe("Phase ID to associate this item with"),
    sortOrder: z.number().optional().describe("Sort order within the worksheet"),
  }),
  tags: ["item", "create", "write"],
}, async (ctx, input) => {
  return { success: true, data: { message: "Line item created", input }, duration_ms: 0 };
});

// ──────────────────────────────────────────────────────────────
// 5. quote.updateWorksheetItem
// ──────────────────────────────────────────────────────────────
export const updateWorksheetItemTool = createQuoteTool({
  id: "quote.updateWorksheetItem",
  name: "Update Line Item",
  description: "Update an existing line item. Only fields provided will be changed.",
  inputSchema: z.object({
    itemId: z.string().describe("ID of the line item to update"),
    category: z.string().optional().describe("Item category"),
    entityName: z.string().optional().describe("Name of the line item"),
    description: z.string().optional().describe("Detailed description"),
    quantity: z.number().optional().describe("Quantity"),
    uom: z.string().optional().describe("Unit of measure"),
    cost: z.number().optional().describe("Unit cost"),
    markup: z.number().optional().describe("Markup percentage"),
    price: z.number().optional().describe("Override unit price"),
    laborHourReg: z.number().optional().describe("Regular labor hours per unit"),
    laborHourOver: z.number().optional().describe("Overtime labor hours per unit"),
    laborHourDouble: z.number().optional().describe("Double-time labor hours per unit"),
    phaseId: z.string().optional().describe("Phase ID"),
    sortOrder: z.number().optional().describe("Sort order"),
  }),
  tags: ["item", "update", "write"],
}, async (ctx, input) => {
  return { success: true, data: { message: "Line item updated", input }, duration_ms: 0 };
});

// ──────────────────────────────────────────────────────────────
// 6. quote.deleteWorksheetItem
// ──────────────────────────────────────────────────────────────
export const deleteWorksheetItemTool = createQuoteTool({
  id: "quote.deleteWorksheetItem",
  name: "Delete Line Item",
  description: "Delete a line item from a worksheet. This action requires confirmation.",
  inputSchema: z.object({
    itemId: z.string().describe("ID of the line item to delete"),
  }),
  requiresConfirmation: true,
  tags: ["item", "delete", "write"],
}, async (ctx, input) => {
  return { success: true, data: { message: "Line item deleted", itemId: input.itemId }, duration_ms: 0 };
});

// ──────────────────────────────────────────────────────────────
// 7. quote.createWorksheet
// ──────────────────────────────────────────────────────────────
export const createWorksheetTool = createQuoteTool({
  id: "quote.createWorksheet",
  name: "Create Worksheet",
  description: "Create a new worksheet in the current revision.",
  inputSchema: z.object({
    name: z.string().describe("Name of the worksheet"),
    description: z.string().optional().describe("Description of the worksheet"),
    sortOrder: z.number().optional().describe("Sort order among worksheets"),
  }),
  tags: ["worksheet", "create", "write"],
}, async (ctx, input) => {
  return { success: true, data: { message: "Worksheet created", input }, duration_ms: 0 };
});

// ──────────────────────────────────────────────────────────────
// 8. quote.updateWorksheet
// ──────────────────────────────────────────────────────────────
export const updateWorksheetTool = createQuoteTool({
  id: "quote.updateWorksheet",
  name: "Update Worksheet",
  description: "Update worksheet properties such as name or description.",
  inputSchema: z.object({
    worksheetId: z.string().describe("ID of the worksheet to update"),
    name: z.string().optional().describe("New name for the worksheet"),
    description: z.string().optional().describe("New description"),
    sortOrder: z.number().optional().describe("New sort order"),
  }),
  tags: ["worksheet", "update", "write"],
}, async (ctx, input) => {
  return { success: true, data: { message: "Worksheet updated", input }, duration_ms: 0 };
});

// ──────────────────────────────────────────────────────────────
// 9. quote.deleteWorksheet
// ──────────────────────────────────────────────────────────────
export const deleteWorksheetTool = createQuoteTool({
  id: "quote.deleteWorksheet",
  name: "Delete Worksheet",
  description: "Delete a worksheet and all its line items. This action requires confirmation.",
  inputSchema: z.object({
    worksheetId: z.string().describe("ID of the worksheet to delete"),
  }),
  requiresConfirmation: true,
  tags: ["worksheet", "delete", "write"],
}, async (ctx, input) => {
  return { success: true, data: { message: "Worksheet deleted", worksheetId: input.worksheetId }, duration_ms: 0 };
});

// ──────────────────────────────────────────────────────────────
// 10. quote.createPhase
// ──────────────────────────────────────────────────────────────
export const createPhaseTool = createQuoteTool({
  id: "quote.createPhase",
  name: "Create Phase",
  description: "Create a new phase for organizing line items (e.g. 'Demolition', 'Rough-In', 'Finish').",
  inputSchema: z.object({
    name: z.string().describe("Phase name"),
    description: z.string().optional().describe("Phase description"),
    sortOrder: z.number().optional().describe("Sort order among phases"),
    code: z.string().optional().describe("Phase code (e.g. '01', '02')"),
  }),
  tags: ["phase", "create", "write"],
}, async (ctx, input) => {
  return { success: true, data: { message: "Phase created", input }, duration_ms: 0 };
});

// ──────────────────────────────────────────────────────────────
// 11. quote.updatePhase
// ──────────────────────────────────────────────────────────────
export const updatePhaseTool = createQuoteTool({
  id: "quote.updatePhase",
  name: "Update Phase",
  description: "Update phase properties.",
  inputSchema: z.object({
    phaseId: z.string().describe("ID of the phase to update"),
    name: z.string().optional().describe("New phase name"),
    description: z.string().optional().describe("New description"),
    sortOrder: z.number().optional().describe("New sort order"),
    code: z.string().optional().describe("New phase code"),
  }),
  tags: ["phase", "update", "write"],
}, async (ctx, input) => {
  return { success: true, data: { message: "Phase updated", input }, duration_ms: 0 };
});

// ──────────────────────────────────────────────────────────────
// 12. quote.deletePhase
// ──────────────────────────────────────────────────────────────
export const deletePhaseTool = createQuoteTool({
  id: "quote.deletePhase",
  name: "Delete Phase",
  description: "Delete a phase. Items assigned to this phase will become unphased. Requires confirmation.",
  inputSchema: z.object({
    phaseId: z.string().describe("ID of the phase to delete"),
  }),
  requiresConfirmation: true,
  tags: ["phase", "delete", "write"],
}, async (ctx, input) => {
  return { success: true, data: { message: "Phase deleted", phaseId: input.phaseId }, duration_ms: 0 };
});

// ──────────────────────────────────────────────────────────────
// 13. quote.createModifier
// ──────────────────────────────────────────────────────────────
export const createModifierTool = createQuoteTool({
  id: "quote.createModifier",
  name: "Create Modifier",
  description: "Create a modifier that applies percentage or fixed-amount adjustments to the quote (e.g. overhead, profit, discount).",
  inputSchema: z.object({
    name: z.string().describe("Modifier name (e.g. 'Overhead', 'Profit', 'Discount')"),
    type: z.enum(["percentage", "fixed"]).describe("Whether this is a percentage or fixed amount modifier"),
    appliesTo: z.enum(["material", "labour", "equipment", "subcontractor", "all"]).default("all").describe("What cost categories this modifier applies to"),
    percentage: z.number().optional().describe("Percentage value (e.g. 10 for 10%). Required if type is 'percentage'"),
    amount: z.number().optional().describe("Fixed amount. Required if type is 'fixed'"),
    show: z.boolean().optional().default(true).describe("Whether to show this modifier on reports"),
    sortOrder: z.number().optional().describe("Sort order among modifiers"),
  }),
  tags: ["modifier", "create", "write"],
}, async (ctx, input) => {
  return { success: true, data: { message: "Modifier created", input }, duration_ms: 0 };
});

// ──────────────────────────────────────────────────────────────
// 14. quote.updateModifier
// ──────────────────────────────────────────────────────────────
export const updateModifierTool = createQuoteTool({
  id: "quote.updateModifier",
  name: "Update Modifier",
  description: "Update an existing modifier's properties.",
  inputSchema: z.object({
    modifierId: z.string().describe("ID of the modifier to update"),
    name: z.string().optional().describe("New name"),
    type: z.enum(["percentage", "fixed"]).optional().describe("New type"),
    appliesTo: z.enum(["material", "labour", "equipment", "subcontractor", "all"]).optional().describe("New applies-to scope"),
    percentage: z.number().optional().describe("New percentage value"),
    amount: z.number().optional().describe("New fixed amount"),
    show: z.boolean().optional().describe("Whether to show on reports"),
    sortOrder: z.number().optional().describe("New sort order"),
  }),
  tags: ["modifier", "update", "write"],
}, async (ctx, input) => {
  return { success: true, data: { message: "Modifier updated", input }, duration_ms: 0 };
});

// ──────────────────────────────────────────────────────────────
// 15. quote.deleteModifier
// ──────────────────────────────────────────────────────────────
export const deleteModifierTool = createQuoteTool({
  id: "quote.deleteModifier",
  name: "Delete Modifier",
  description: "Delete a modifier from the revision. Requires confirmation.",
  inputSchema: z.object({
    modifierId: z.string().describe("ID of the modifier to delete"),
  }),
  requiresConfirmation: true,
  tags: ["modifier", "delete", "write"],
}, async (ctx, input) => {
  return { success: true, data: { message: "Modifier deleted", modifierId: input.modifierId }, duration_ms: 0 };
});

// ──────────────────────────────────────────────────────────────
// 16. quote.createCondition
// ──────────────────────────────────────────────────────────────
export const createConditionTool = createQuoteTool({
  id: "quote.createCondition",
  name: "Create Condition",
  description: "Create a quote condition or exclusion (e.g. 'Payment net 30', 'Excludes permit fees').",
  inputSchema: z.object({
    type: z.enum(["inclusion", "exclusion", "clarification", "assumption", "term"]).describe("Type of condition"),
    text: z.string().describe("Condition text"),
    sortOrder: z.number().optional().describe("Sort order among conditions"),
  }),
  tags: ["condition", "create", "write"],
}, async (ctx, input) => {
  return { success: true, data: { message: "Condition created", input }, duration_ms: 0 };
});

// ──────────────────────────────────────────────────────────────
// 17. quote.updateCondition
// ──────────────────────────────────────────────────────────────
export const updateConditionTool = createQuoteTool({
  id: "quote.updateCondition",
  name: "Update Condition",
  description: "Update an existing condition.",
  inputSchema: z.object({
    conditionId: z.string().describe("ID of the condition to update"),
    type: z.enum(["inclusion", "exclusion", "clarification", "assumption", "term"]).optional().describe("New type"),
    text: z.string().optional().describe("New condition text"),
    sortOrder: z.number().optional().describe("New sort order"),
  }),
  tags: ["condition", "update", "write"],
}, async (ctx, input) => {
  return { success: true, data: { message: "Condition updated", input }, duration_ms: 0 };
});

// ──────────────────────────────────────────────────────────────
// 18. quote.deleteCondition
// ──────────────────────────────────────────────────────────────
export const deleteConditionTool = createQuoteTool({
  id: "quote.deleteCondition",
  name: "Delete Condition",
  description: "Delete a condition from the revision. Requires confirmation.",
  inputSchema: z.object({
    conditionId: z.string().describe("ID of the condition to delete"),
  }),
  requiresConfirmation: true,
  tags: ["condition", "delete", "write"],
}, async (ctx, input) => {
  return { success: true, data: { message: "Condition deleted", conditionId: input.conditionId }, duration_ms: 0 };
});

// ──────────────────────────────────────────────────────────────
// 19. quote.createALI
// ──────────────────────────────────────────────────────────────
export const createALITool = createQuoteTool({
  id: "quote.createALI",
  name: "Create Additional Line Item",
  description: "Create an additional line item (ALI) that appears outside the main worksheets, such as bonds, permits, or allowances.",
  inputSchema: z.object({
    name: z.string().describe("ALI name"),
    description: z.string().optional().describe("ALI description"),
    type: z.enum(["bond", "permit", "allowance", "fee", "tax", "other"]).default("other").describe("Type of additional line item"),
    amount: z.number().describe("Amount for this ALI"),
    isPercentage: z.boolean().optional().default(false).describe("If true, amount is treated as a percentage of the quote total"),
    show: z.boolean().optional().default(true).describe("Whether to show on reports"),
    sortOrder: z.number().optional().describe("Sort order among ALIs"),
  }),
  tags: ["ali", "create", "write"],
}, async (ctx, input) => {
  return { success: true, data: { message: "ALI created", input }, duration_ms: 0 };
});

// ──────────────────────────────────────────────────────────────
// 20. quote.updateALI
// ──────────────────────────────────────────────────────────────
export const updateALITool = createQuoteTool({
  id: "quote.updateALI",
  name: "Update Additional Line Item",
  description: "Update an existing additional line item.",
  inputSchema: z.object({
    aliId: z.string().describe("ID of the ALI to update"),
    name: z.string().optional().describe("New name"),
    description: z.string().optional().describe("New description"),
    type: z.enum(["bond", "permit", "allowance", "fee", "tax", "other"]).optional().describe("New type"),
    amount: z.number().optional().describe("New amount"),
    isPercentage: z.boolean().optional().describe("Whether amount is a percentage"),
    show: z.boolean().optional().describe("Whether to show on reports"),
    sortOrder: z.number().optional().describe("New sort order"),
  }),
  tags: ["ali", "update", "write"],
}, async (ctx, input) => {
  return { success: true, data: { message: "ALI updated", input }, duration_ms: 0 };
});

// ──────────────────────────────────────────────────────────────
// 21. quote.deleteALI
// ──────────────────────────────────────────────────────────────
export const deleteALITool = createQuoteTool({
  id: "quote.deleteALI",
  name: "Delete Additional Line Item",
  description: "Delete an additional line item. Requires confirmation.",
  inputSchema: z.object({
    aliId: z.string().describe("ID of the ALI to delete"),
  }),
  requiresConfirmation: true,
  tags: ["ali", "delete", "write"],
}, async (ctx, input) => {
  return { success: true, data: { message: "ALI deleted", aliId: input.aliId }, duration_ms: 0 };
});

// ──────────────────────────────────────────────────────────────
// 22. quote.createLabourRate
// ──────────────────────────────────────────────────────────────
export const createLabourRateTool = createQuoteTool({
  id: "quote.createLabourRate",
  name: "Create Labour Rate",
  description: "Create a labour rate definition used for calculating labour costs on line items.",
  inputSchema: z.object({
    name: z.string().describe("Rate name (e.g. 'Journeyman Electrician', 'Helper')"),
    regularRate: z.number().describe("Regular hourly rate"),
    overtimeRate: z.number().optional().describe("Overtime hourly rate (defaults to 1.5x regular)"),
    doubleTimeRate: z.number().optional().describe("Double-time hourly rate (defaults to 2x regular)"),
    burdenPercentage: z.number().optional().default(0).describe("Burden/benefits percentage on top of base rate"),
    code: z.string().optional().describe("Rate code identifier"),
  }),
  tags: ["labour", "rate", "create", "write"],
}, async (ctx, input) => {
  return { success: true, data: { message: "Labour rate created", input }, duration_ms: 0 };
});

// ──────────────────────────────────────────────────────────────
// 23. quote.updateLabourRate
// ──────────────────────────────────────────────────────────────
export const updateLabourRateTool = createQuoteTool({
  id: "quote.updateLabourRate",
  name: "Update Labour Rate",
  description: "Update an existing labour rate definition.",
  inputSchema: z.object({
    labourRateId: z.string().describe("ID of the labour rate to update"),
    name: z.string().optional().describe("New name"),
    regularRate: z.number().optional().describe("New regular hourly rate"),
    overtimeRate: z.number().optional().describe("New overtime hourly rate"),
    doubleTimeRate: z.number().optional().describe("New double-time hourly rate"),
    burdenPercentage: z.number().optional().describe("New burden/benefits percentage"),
    code: z.string().optional().describe("New rate code"),
  }),
  tags: ["labour", "rate", "update", "write"],
}, async (ctx, input) => {
  return { success: true, data: { message: "Labour rate updated", input }, duration_ms: 0 };
});

// ──────────────────────────────────────────────────────────────
// 24. quote.deleteLabourRate
// ──────────────────────────────────────────────────────────────
export const deleteLabourRateTool = createQuoteTool({
  id: "quote.deleteLabourRate",
  name: "Delete Labour Rate",
  description: "Delete a labour rate definition. Items using this rate will need reassignment. Requires confirmation.",
  inputSchema: z.object({
    labourRateId: z.string().describe("ID of the labour rate to delete"),
  }),
  requiresConfirmation: true,
  tags: ["labour", "rate", "delete", "write"],
}, async (ctx, input) => {
  return { success: true, data: { message: "Labour rate deleted", labourRateId: input.labourRateId }, duration_ms: 0 };
});

// ──────────────────────────────────────────────────────────────
// 25. quote.updateRevision
// ──────────────────────────────────────────────────────────────
export const updateRevisionTool = createQuoteTool({
  id: "quote.updateRevision",
  name: "Update Revision",
  description: "Update revision-level fields such as name, notes, or status.",
  inputSchema: z.object({
    name: z.string().optional().describe("Revision name"),
    notes: z.string().optional().describe("Revision notes"),
    status: z.enum(["draft", "review", "approved", "sent", "declined", "accepted"]).optional().describe("Revision status"),
    validUntil: z.string().optional().describe("Expiry date for the quote (ISO 8601)"),
  }),
  tags: ["revision", "update", "write"],
}, async (ctx, input) => {
  return { success: true, data: { message: "Revision updated", input }, duration_ms: 0 };
});

// ──────────────────────────────────────────────────────────────
// 26. quote.createRevision
// ──────────────────────────────────────────────────────────────
export const createRevisionTool = createQuoteTool({
  id: "quote.createRevision",
  name: "Create New Revision",
  description: "Create a new revision by copying the current revision. This creates a full snapshot. Requires confirmation.",
  inputSchema: z.object({
    name: z.string().optional().describe("Name for the new revision (defaults to incrementing the revision number)"),
    notes: z.string().optional().describe("Notes for why a new revision was created"),
  }),
  requiresConfirmation: true,
  tags: ["revision", "create", "write"],
}, async (ctx, input) => {
  return { success: true, data: { message: "New revision created", input }, duration_ms: 0 };
});

// ──────────────────────────────────────────────────────────────
// 27. quote.deleteRevision
// ──────────────────────────────────────────────────────────────
export const deleteRevisionTool = createQuoteTool({
  id: "quote.deleteRevision",
  name: "Delete Revision",
  description: "Delete a revision and all its data. Cannot delete the only revision. Requires confirmation.",
  inputSchema: z.object({
    revisionId: z.string().describe("ID of the revision to delete"),
  }),
  requiresConfirmation: true,
  tags: ["revision", "delete", "write"],
}, async (ctx, input) => {
  return { success: true, data: { message: "Revision deleted", revisionId: input.revisionId }, duration_ms: 0 };
});

// ──────────────────────────────────────────────────────────────
// 28. quote.copyQuote
// ──────────────────────────────────────────────────────────────
export const copyQuoteTool = createQuoteTool({
  id: "quote.copyQuote",
  name: "Copy Entire Quote",
  description: "Create a full copy of the current quote as a new project. Copies all revisions, worksheets, items, and settings. Requires confirmation.",
  inputSchema: z.object({
    newProjectName: z.string().describe("Name for the new project copy"),
    includeDocuments: z.boolean().optional().default(false).describe("Whether to also copy associated source documents"),
  }),
  requiresConfirmation: true,
  tags: ["quote", "copy", "write"],
}, async (ctx, input) => {
  return { success: true, data: { message: "Quote copied", input }, duration_ms: 0 };
});

// ──────────────────────────────────────────────────────────────
// 29. quote.updateQuote
// ──────────────────────────────────────────────────────────────
export const updateQuoteTool = createQuoteTool({
  id: "quote.updateQuote",
  name: "Update Quote",
  description: "Update quote-level fields such as project name, client info, or settings.",
  inputSchema: z.object({
    projectName: z.string().optional().describe("Project name"),
    clientName: z.string().optional().describe("Client/customer name"),
    clientEmail: z.string().optional().describe("Client email"),
    clientPhone: z.string().optional().describe("Client phone number"),
    clientAddress: z.string().optional().describe("Client address"),
    projectAddress: z.string().optional().describe("Project/job site address"),
    bidDate: z.string().optional().describe("Bid date (ISO 8601)"),
    notes: z.string().optional().describe("General project notes"),
  }),
  tags: ["quote", "update", "write"],
}, async (ctx, input) => {
  return { success: true, data: { message: "Quote updated", input }, duration_ms: 0 };
});

// ──────────────────────────────────────────────────────────────
// 30. quote.recalculateTotals
// ──────────────────────────────────────────────────────────────
export const recalculateTotalsTool = createQuoteTool({
  id: "quote.recalculateTotals",
  name: "Recalculate Financial Totals",
  description: "Force a recalculation of all financial totals including worksheet subtotals, modifiers, ALIs, and grand total.",
  inputSchema: z.object({}),
  tags: ["totals", "calculate", "write"],
}, async (ctx) => {
  return { success: true, data: { message: "Totals recalculated" }, duration_ms: 0 };
});

// ──────────────────────────────────────────────────────────────
// 31. quote.createReportSection
// ──────────────────────────────────────────────────────────────
export const createReportSectionTool = createQuoteTool({
  id: "quote.createReportSection",
  name: "Create Report Section",
  description: "Create a new section in the quote report/proposal (e.g. cover letter, scope of work, schedule).",
  inputSchema: z.object({
    title: z.string().describe("Section title"),
    content: z.string().describe("Section content (supports markdown)"),
    type: z.enum(["cover_letter", "scope", "schedule", "terms", "appendix", "custom"]).default("custom").describe("Section type"),
    sortOrder: z.number().optional().describe("Sort order among report sections"),
  }),
  tags: ["report", "section", "create", "write"],
}, async (ctx, input) => {
  return { success: true, data: { message: "Report section created", input }, duration_ms: 0 };
});

// ──────────────────────────────────────────────────────────────
// 32. quote.updateReportSection
// ──────────────────────────────────────────────────────────────
export const updateReportSectionTool = createQuoteTool({
  id: "quote.updateReportSection",
  name: "Update Report Section",
  description: "Update an existing report section.",
  inputSchema: z.object({
    sectionId: z.string().describe("ID of the report section to update"),
    title: z.string().optional().describe("New title"),
    content: z.string().optional().describe("New content (supports markdown)"),
    type: z.enum(["cover_letter", "scope", "schedule", "terms", "appendix", "custom"]).optional().describe("New section type"),
    sortOrder: z.number().optional().describe("New sort order"),
  }),
  tags: ["report", "section", "update", "write"],
}, async (ctx, input) => {
  return { success: true, data: { message: "Report section updated", input }, duration_ms: 0 };
});

// ──────────────────────────────────────────────────────────────
// 33. quote.deleteReportSection
// ──────────────────────────────────────────────────────────────
export const deleteReportSectionTool = createQuoteTool({
  id: "quote.deleteReportSection",
  name: "Delete Report Section",
  description: "Delete a report section. Requires confirmation.",
  inputSchema: z.object({
    sectionId: z.string().describe("ID of the report section to delete"),
  }),
  requiresConfirmation: true,
  tags: ["report", "section", "delete", "write"],
}, async (ctx, input) => {
  return { success: true, data: { message: "Report section deleted", sectionId: input.sectionId }, duration_ms: 0 };
});

// ──────────────────────────────────────────────────────────────
// Export all tools as array
// ──────────────────────────────────────────────────────────────
export const quoteTools: Tool[] = [
  getWorkspaceTool,
  listWorksheetsTool,
  searchItemsTool,
  createWorksheetItemTool,
  updateWorksheetItemTool,
  deleteWorksheetItemTool,
  createWorksheetTool,
  updateWorksheetTool,
  deleteWorksheetTool,
  createPhaseTool,
  updatePhaseTool,
  deletePhaseTool,
  createModifierTool,
  updateModifierTool,
  deleteModifierTool,
  createConditionTool,
  updateConditionTool,
  deleteConditionTool,
  createALITool,
  updateALITool,
  deleteALITool,
  createLabourRateTool,
  updateLabourRateTool,
  deleteLabourRateTool,
  updateRevisionTool,
  createRevisionTool,
  deleteRevisionTool,
  copyQuoteTool,
  updateQuoteTool,
  recalculateTotalsTool,
  createReportSectionTool,
  updateReportSectionTool,
  deleteReportSectionTool,
];
