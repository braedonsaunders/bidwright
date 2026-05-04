import type {
  DatasetColumn,
  LaborUnit,
  Plugin,
  PluginOutput,
  PluginOutputLineItem,
  PluginOutputTemplateValue,
  PluginToolOutputTemplate,
} from "@bidwright/domain";
import {
  computeShopPipeEstimate,
  computeShopWeldEstimate,
  sumTableHours,
} from "@bidwright/domain";

interface RateScheduleSelection {
  id: string;
  name: string;
  category?: string;
  entityCategoryType?: string;
  /** Tier id for the schedule's regular (multiplier 1.0) tier, when known. */
  regularTierId?: string;
}

export interface BuiltinPluginExecutionContext {
  plugin: Plugin;
  toolId: string;
  input: Record<string, unknown>;
  formState?: Record<string, unknown>;
  revisionDifficulty?: string;
  lookupDatasetRows: (datasetRef: string) => Promise<Array<Record<string, unknown>>>;
  lookupDatasetColumns: (datasetRef: string) => Promise<DatasetColumn[]>;
  resolveRateScheduleItem: (rateScheduleItemId: string) => Promise<RateScheduleSelection | null>;
  lookupLaborUnit: (providerLabel: string, input: Record<string, unknown>) => Promise<LaborUnit | null>;
}

function toNumber(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function toStringValue(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function roundHours(value: number): number {
  return Math.round(value * 100) / 100;
}

function getFormTableRows(formState: Record<string, unknown> | undefined, tableId: string) {
  const tables = (formState?.tableData ?? formState?._tables ?? {}) as Record<string, unknown>;
  const rows = tables[tableId];
  return Array.isArray(rows) ? (rows as Array<Record<string, unknown>>) : [];
}

function getFormScores(formState: Record<string, unknown> | undefined, scoringId: string) {
  const scoring = (formState?.scoringData ?? formState?._scores ?? {}) as Record<string, unknown>;
  const values = scoring[scoringId];
  return values && typeof values === "object" ? (values as Record<string, number>) : {};
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isEmptyTemplateValue(value: unknown) {
  return value === undefined || value === null || value === "";
}

function getInputPathValue(input: Record<string, unknown>, path: string): unknown {
  return path.split(".").reduce<unknown>((current, segment) => (
    isRecord(current) ? current[segment] : undefined
  ), input);
}

function renderOutputTemplateValue(template: PluginOutputTemplateValue | undefined, input: Record<string, unknown>): unknown {
  if (template === undefined || template === null) {
    return template ?? "";
  }
  if (typeof template === "string") {
    return template;
  }
  if (typeof template === "number" || typeof template === "boolean") {
    return template;
  }
  if (!isRecord(template)) {
    return "";
  }

  if ("first" in template && Array.isArray(template.first)) {
    for (const candidate of template.first) {
      const value = renderOutputTemplateValue(candidate, input);
      if (!isEmptyTemplateValue(value)) {
        return value;
      }
    }
    return "";
  }

  if ("join" in template && Array.isArray(template.join)) {
    return template.join
      .map((candidate) => renderOutputTemplateValue(candidate, input))
      .filter((value) => !isEmptyTemplateValue(value))
      .map((value) => String(value))
      .join(template.separator ?? " ");
  }

  if ("template" in template && typeof template.template === "string") {
    return template.template.replace(/{{\s*([\w.]+)\s*}}/g, (_match, key: string) => {
      const value = getInputPathValue(input, key);
      return value === undefined || value === null ? "" : String(value);
    });
  }

  if ("from" in template && template.from === "input") {
    const rawValue = getInputPathValue(input, template.key);
    const defaultValue = template.default !== undefined
      ? renderOutputTemplateValue(template.default, input)
      : undefined;
    const value = isEmptyTemplateValue(rawValue) ? defaultValue : rawValue;
    if (template.type === "number") {
      const parsed = toNumber(value);
      let next = parsed;
      if (template.min !== undefined) {
        next = Math.max(template.min, next);
      }
      if (template.max !== undefined) {
        next = Math.min(template.max, next);
      }
      return next;
    }
    if (template.type === "boolean") {
      return value === true || value === "true";
    }
    if (template.type === "string") {
      return value === undefined || value === null ? "" : String(value).trim();
    }
    return value ?? "";
  }

  return "";
}

function validateOutputTemplate(template: PluginToolOutputTemplate, input: Record<string, unknown>) {
  for (const rule of template.validation ?? []) {
    const value = rule.value !== undefined
      ? renderOutputTemplateValue(rule.value, input)
      : rule.field
        ? getInputPathValue(input, rule.field)
        : undefined;

    if (rule.rule === "required" && isEmptyTemplateValue(value)) {
      throw new Error(rule.message);
    }
    if (rule.rule === "positive" && toNumber(value) <= 0) {
      throw new Error(rule.message);
    }
  }
}

function validateRenderedLineItem(lineItem: Record<string, unknown>, index: number) {
  for (const field of ["category", "entityType", "entityName", "description", "uom"]) {
    if (isEmptyTemplateValue(lineItem[field])) {
      throw new Error(`Plugin output template produced an empty ${field} for line item ${index + 1}.`);
    }
  }

  if (toNumber(lineItem.quantity) <= 0) {
    throw new Error(`Plugin output template produced a non-positive quantity for line item ${index + 1}.`);
  }
}

function renderDeclarativeOutput(template: PluginToolOutputTemplate | undefined, input: Record<string, unknown>): PluginOutput | null {
  if (!template || template.type !== "line_items") {
    return null;
  }

  validateOutputTemplate(template, input);
  const lineItems = template.lineItems.map((lineItemTemplate, index) => {
    const lineItem: Record<string, unknown> = {};
    for (const [key, valueTemplate] of Object.entries(lineItemTemplate)) {
      lineItem[key] = renderOutputTemplateValue(valueTemplate, input);
    }
    validateRenderedLineItem(lineItem, index);
    return lineItem as unknown as PluginOutputLineItem;
  });

  const output: PluginOutput = {
    type: "line_items",
    lineItems,
  };
  if (template.summary) {
    output.summary = {
      title: String(renderOutputTemplateValue(template.summary.title, input) ?? ""),
      sections: template.summary.sections.map((section) => ({
        label: section.label,
        value: renderOutputTemplateValue(section.value, input) as string | number,
        format: section.format,
      })),
    };
  }
  if (template.displayText !== undefined) {
    output.displayText = String(renderOutputTemplateValue(template.displayText, input) ?? "");
  }

  return output;
}

function normalizeDifficulty(value: string) {
  const normalized = value.replace(/\s+/g, " ").trim().toLowerCase();
  if (normalized === "difficult") return "Difficult";
  if (normalized === "very difficult" || normalized === "verydifficult") return "Very Difficult";
  if (normalized === "extreme") return "Extreme";
  return "Normal";
}

function buildLabourLineItem(args: {
  rateScheduleItemId: string;
  regularTierId?: string;
  entityName: string;
  category?: string;
  entityType?: string;
  description: string;
  hours: number;
  sourceNotes: string;
}) {
  const hours = roundHours(args.hours);
  const tierUnits: Record<string, number> = {};
  if (args.regularTierId && hours > 0) {
    tierUnits[args.regularTierId] = hours;
  }
  const lineItem: PluginOutputLineItem = {
    category: args.category || args.entityType || "Labour",
    entityType: args.entityType || args.category || "Labour",
    entityName: args.entityName,
    description: args.description,
    quantity: 1,
    uom: "HR",
    cost: 0,
    markup: 0,
    price: 0,
    rateScheduleItemId: args.rateScheduleItemId,
    tierUnits,
    sourceNotes: args.sourceNotes,
  };
  return lineItem;
}

function laborUnitHours(unit: LaborUnit, difficultyLabel: string) {
  if (difficultyLabel === "Difficult") {
    return unit.hoursDifficult ?? unit.hoursNormal;
  }
  if (difficultyLabel === "Very Difficult" || difficultyLabel === "Extreme") {
    return unit.hoursVeryDifficult ?? unit.hoursDifficult ?? unit.hoursNormal;
  }
  return unit.hoursNormal;
}

async function executeLaborUnitsTool(
  ctx: BuiltinPluginExecutionContext,
  providerLabel: string,
) {
  const serviceItemId = toStringValue(ctx.input.serviceItemId ?? ctx.input.serviceItem);
  const serviceItem = await ctx.resolveRateScheduleItem(serviceItemId);
  if (!serviceItem) {
    throw new Error("Select a valid labor rate from the current revision rate schedule.");
  }

  const laborUnit = await ctx.lookupLaborUnit(providerLabel, ctx.input);
  if (!laborUnit) {
    throw new Error(`No ${providerLabel} labor unit matched the selected category/class/sub-class.`);
  }

  const difficulty = normalizeDifficulty(
    toStringValue(ctx.input.difficulty) || ctx.revisionDifficulty || laborUnit.defaultDifficulty || "Normal",
  );
  const quantity = toNumber(ctx.input.quantity);
  const hoursPerUnit = laborUnitHours(laborUnit, difficulty);
  const totalHours = roundHours(quantity * hoursPerUnit);
  const description = [
    providerLabel,
    laborUnit.category,
    laborUnit.className,
    laborUnit.subClassName,
  ].filter(Boolean).join(" - ");
  const outputUom = laborUnit.outputUom || "EA";

  const output: PluginOutput = {
    type: "line_items",
    lineItems: [
      buildLabourLineItem({
        rateScheduleItemId: serviceItem.id,
            regularTierId: serviceItem.regularTierId,
        entityName: serviceItem.name,
        category: serviceItem.category || laborUnit.entityCategoryType || "Labour",
        entityType: serviceItem.entityCategoryType || laborUnit.entityCategoryType || serviceItem.category || "Labour",
        description,
        hours: totalHours,
        sourceNotes: `${providerLabel} labor unit ${laborUnit.code || laborUnit.id}: ${hoursPerUnit.toFixed(2)} hrs/${outputUom} x ${quantity} @ ${difficulty}.`,
      }),
    ],
    summary: {
      title: `${providerLabel} Labor Units`,
      sections: [
        { label: "Labor Unit", value: laborUnit.name, format: "text" },
        { label: "Hours / Unit", value: hoursPerUnit, format: "hours" },
        { label: "Quantity", value: quantity, format: "number" },
        { label: "Difficulty", value: difficulty, format: "text" },
        { label: "Total Hours", value: totalHours, format: "hours" },
      ],
    },
    displayText: `Prepared ${providerLabel} labor hours for ${serviceItem.name}.`,
  };

  return output;
}

export async function executeBuiltinPluginTool(
  ctx: BuiltinPluginExecutionContext,
): Promise<PluginOutput | null> {
  const toolDefinition = ctx.plugin.toolDefinitions.find((tool) => tool.id === ctx.toolId);
  const declarativeOutput = renderDeclarativeOutput(toolDefinition?.outputTemplate, ctx.input);
  if (declarativeOutput) {
    return declarativeOutput;
  }

  const execution = toolDefinition?.execution;
  if (!execution) {
    return null;
  }

  switch (execution.type) {
    case "labor_units":
      return executeLaborUnitsTool(ctx, execution.providerLabel);

    case "scoring_result_patch": {
      const scores = getFormScores(ctx.formState, execution.scoringId);
      if (Object.keys(scores).length === 0) {
        throw new Error("Complete the scoring sheet before applying it.");
      }

      const scoring = toolDefinition?.ui?.sections
        .map((section) => section.scoring)
        .find((entry) => entry?.id === execution.scoringId);
      if (!scoring) {
        throw new Error(`Plugin scoring definition ${execution.scoringId} was not found.`);
      }

      const totalScore = scoring.criteria.reduce((total, criterion) => {
        const rawScore = scores[criterion.id] ?? criterion.scale.min ?? 0;
        return total + toNumber(rawScore) * (criterion.weight ?? 1);
      }, 0);
      const resultBand = scoring.resultMapping.find((band) =>
        totalScore >= band.minScore && totalScore <= band.maxScore
      );
      if (!resultBand) {
        throw new Error(`No scoring result matched score ${totalScore.toFixed(2)}.`);
      }

      return {
        type: "revision_patch",
        revisionPatches: [{ field: execution.revisionField, value: resultBand.value }],
        summary: {
          title: execution.summaryTitle ?? scoring.label,
          sections: [
            { label: "Total Score", value: totalScore, format: "number" },
            { label: "Result", value: resultBand.label, format: "text" },
          ],
        },
        displayText: `Set ${execution.revisionField} to ${resultBand.value}.`,
      };
    }

    case "table_hours": {
      const serviceItemId = toStringValue(ctx.input.serviceItemId);
      const serviceItem = await ctx.resolveRateScheduleItem(serviceItemId);
      if (!serviceItem) {
        throw new Error("Select a valid labor rate from the current revision rate schedule.");
      }

      const rows = getFormTableRows(ctx.formState, execution.tableId);
      const multiplier = execution.multiplierField
        ? toNumber(ctx.input[execution.multiplierField]) || execution.defaultMultiplier || 1
        : execution.defaultMultiplier;
      const totalHours = sumTableHours(rows, {
        totalField: execution.totalField,
        quantityField: execution.quantityField,
        rateField: execution.rateField,
        multiplier,
      });
      const description = toStringValue(ctx.input.description) || execution.descriptionDefault;

      return {
        type: "line_items",
        lineItems: [
          buildLabourLineItem({
            rateScheduleItemId: serviceItem.id,
            regularTierId: serviceItem.regularTierId,
            entityName: serviceItem.name,
            description,
            hours: totalHours,
            sourceNotes: `${ctx.plugin.name} produced ${rows.length} input row(s).`,
          }),
        ],
        summary: {
          title: ctx.plugin.name,
          sections: [
            { label: "Rows", value: rows.length, format: "number" },
            { label: "Total Hours", value: totalHours, format: "hours" },
          ],
        },
        displayText: `Prepared ${totalHours.toFixed(2)} hours from ${ctx.plugin.name}.`,
      };
    }

    case "shop_pipe_estimate": {
      const serviceItemId = toStringValue(ctx.input.serviceItemId);
      const serviceItem = await ctx.resolveRateScheduleItem(serviceItemId);
      if (!serviceItem) {
        throw new Error("Select a valid labor rate from the current revision rate schedule.");
      }

      const rows = getFormTableRows(ctx.formState, execution.tableId);
      const result = computeShopPipeEstimate({
        rows,
        pipeType: toStringValue(ctx.input.pipeType) || "carbon",
        efficiencyModifier: toNumber(ctx.input.efficiencyModifier) || 75,
        stressRelief: Boolean(ctx.input.stressRelief),
        radiographicInspection: Boolean(ctx.input.radiographicInspection),
        purge: Boolean(ctx.input.purge),
        mpiInspection: Boolean(ctx.input.mpiInspection),
        preheat: Boolean(ctx.input.preheat),
        purgePercentage: toNumber(ctx.input.purgePercentage) || 20,
        handlingPercentage: toNumber(ctx.input.handlingPercentage) || 10,
      });

      return {
        type: "line_items",
        lineItems: [
          buildLabourLineItem({
            rateScheduleItemId: serviceItem.id,
            regularTierId: serviceItem.regularTierId,
            entityName: serviceItem.name,
            description: toStringValue(ctx.input.description) || execution.descriptionDefault,
            hours: result.totalHours,
            sourceNotes: `Shop pipe estimate from ${rows.length} pipe rows.`,
          }),
        ],
        summary: {
          title: "Shop Pipe Manual",
          sections: [
            { label: "Pipe Rows", value: rows.length, format: "number" },
            { label: "Welding", value: result.breakdown.weldingHours, format: "hours" },
            { label: "Fit-Up", value: result.breakdown.fittingHours, format: "hours" },
            { label: "Total Hours", value: result.totalHours, format: "hours" },
          ],
        },
        displayText: `Prepared ${result.totalHours.toFixed(2)} shop pipe hours.`,
      };
    }

    case "shop_weld_estimate": {
      const serviceItemId = toStringValue(ctx.input.serviceItemId);
      const serviceItem = await ctx.resolveRateScheduleItem(serviceItemId);
      if (!serviceItem) {
        throw new Error("Select a valid labor rate from the current revision rate schedule.");
      }

      const rows = getFormTableRows(ctx.formState, execution.tableId);
      const result = computeShopWeldEstimate({ rows });

      return {
        type: "line_items",
        lineItems: [
          buildLabourLineItem({
            rateScheduleItemId: serviceItem.id,
            regularTierId: serviceItem.regularTierId,
            entityName: serviceItem.name,
            description: toStringValue(ctx.input.description) || execution.descriptionDefault,
            hours: result.totalHours,
            sourceNotes: `Shop weld estimate from ${rows.length} task rows.`,
          }),
        ],
        summary: {
          title: "Shop Weld Prep",
          sections: [
            { label: "Task Rows", value: rows.length, format: "number" },
            { label: "Total Hours", value: result.totalHours, format: "hours" },
          ],
        },
        displayText: `Prepared ${result.totalHours.toFixed(2)} shop weld hours.`,
      };
    }

    default:
      return null;
  }
}
