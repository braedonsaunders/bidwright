import type {
  DatasetColumn,
  Plugin,
  PluginOutput,
  PluginOutputLineItem,
  PluginOutputTemplateValue,
  PluginToolOutputTemplate,
} from "@bidwright/domain";
import {
  computeNecaExtendedDuration,
  computeNecaTemperatureAdjustment,
  computeShopPipeEstimate,
  computeShopWeldEstimate,
  getDatasetCellValue,
  getDatasetCellString,
  sumTableHours,
} from "@bidwright/domain";

interface RateScheduleSelection {
  id: string;
  name: string;
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

function getRowString(row: Record<string, unknown>, keys: string[], columns?: DatasetColumn[]) {
  for (const key of keys) {
    const value = getDatasetCellString(row, key, columns);
    if (value) {
      return value;
    }
  }
  return "";
}

function getRowNumber(row: Record<string, unknown>, keys: string[], columns?: DatasetColumn[]) {
  for (const key of keys) {
    const value = Number(getDatasetCellValue(row, key, columns));
    if (Number.isFinite(value)) {
      return value;
    }
  }
  return 0;
}

function normalizeDifficulty(value: string) {
  const normalized = value.replace(/\s+/g, " ").trim().toLowerCase();
  if (normalized === "difficult") return "Difficult";
  if (normalized === "very difficult" || normalized === "verydifficult") return "Very Difficult";
  if (normalized === "extreme") return "Extreme";
  return "Normal";
}

function findLabourDatasetRow(
  rows: Array<Record<string, unknown>>,
  input: Record<string, unknown>,
  columns?: DatasetColumn[],
) {
  const category = toStringValue(input.category);
  const labourClass = toStringValue(input.class);
  const subClass = toStringValue(input.subClass);

  const matches = rows.filter((row) =>
    getRowString(row, ["category"], columns) === category &&
    getRowString(row, ["class"], columns) === labourClass,
  );

  if (subClass) {
    const exact = matches.find((row) => getRowString(row, ["subClass"], columns) === subClass);
    if (exact) {
      return exact;
    }
  }

  return matches[0] ?? null;
}

function buildLabourLineItem(args: {
  rateScheduleItemId: string;
  entityName: string;
  description: string;
  hours: number;
  sourceNotes: string;
}) {
  const hours = roundHours(args.hours);
  const lineItem: PluginOutputLineItem = {
    category: "Labour",
    entityType: "LabourClass",
    entityName: args.entityName,
    description: args.description,
    quantity: 1,
    uom: "HR",
    cost: 0,
    markup: 0,
    price: 0,
    unit1: hours,
    unit2: 0,
    unit3: 0,
    rateScheduleItemId: args.rateScheduleItemId,
    sourceNotes: args.sourceNotes,
  };
  return lineItem;
}

async function executeDatasetBackedLabourTool(
  ctx: BuiltinPluginExecutionContext,
  datasetRef: string,
  providerLabel: string,
) {
  const serviceItemId = toStringValue(ctx.input.serviceItemId ?? ctx.input.serviceItem);
  const serviceItem = await ctx.resolveRateScheduleItem(serviceItemId);
  if (!serviceItem) {
    throw new Error("Select a valid labor rate from the current revision rate schedule.");
  }

  const datasetRows = await ctx.lookupDatasetRows(datasetRef);
  const datasetColumns = await ctx.lookupDatasetColumns(datasetRef);
  const row = findLabourDatasetRow(datasetRows, ctx.input, datasetColumns);
  if (!row) {
    throw new Error(`No ${providerLabel} labor unit matched the selected category/class/sub-class.`);
  }

  const difficulty = normalizeDifficulty(
    toStringValue(ctx.input.difficulty) || ctx.revisionDifficulty || "Normal",
  );
  const quantity = toNumber(ctx.input.quantity);
  const hoursPerUnit =
    difficulty === "Difficult"
      ? getRowNumber(row, ["hourDifficult"], datasetColumns)
      : difficulty === "Very Difficult" || difficulty === "Extreme"
        ? getRowNumber(row, ["hourVeryDifficult"], datasetColumns)
        : getRowNumber(row, ["hourNormal"], datasetColumns);
  const totalHours = roundHours(quantity * hoursPerUnit);
  const category = getRowString(row, ["category"], datasetColumns);
  const labourClass = getRowString(row, ["class"], datasetColumns);
  const subClass = getRowString(row, ["subClass"], datasetColumns);
  const description = [providerLabel, category, labourClass, subClass].filter(Boolean).join(" - ");

  const output: PluginOutput = {
    type: "line_items",
    lineItems: [
      buildLabourLineItem({
        rateScheduleItemId: serviceItem.id,
        entityName: serviceItem.name,
        description,
        hours: totalHours,
      sourceNotes: `${providerLabel} labor unit ${hoursPerUnit.toFixed(2)} hrs per unit x ${quantity} @ ${difficulty}.`,
      }),
    ],
    summary: {
      title: `${providerLabel} Labor Units`,
      sections: [
        { label: "Hours / Unit", value: hoursPerUnit, format: "hours" },
        { label: "Quantity", value: quantity, format: "number" },
        { label: "Difficulty", value: difficulty, format: "text" },
        { label: "Total Hours", value: totalHours, format: "hours" },
      ],
    },
    displayText: `Prepared ${providerLabel} labour hours for ${serviceItem.name}.`,
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
    case "dataset_labour_units":
      return executeDatasetBackedLabourTool(ctx, execution.datasetId, execution.providerLabel);

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

    case "neca_temperature_adjustment": {
      const serviceItemId = toStringValue(ctx.input.serviceItemId);
      const serviceItem = await ctx.resolveRateScheduleItem(serviceItemId);
      if (!serviceItem) {
        throw new Error("Select a valid labor rate from the current revision rate schedule.");
      }

      const result = computeNecaTemperatureAdjustment({
        temperature: toNumber(ctx.input.temperature),
        temperatureUnit: toStringValue(ctx.input.temperatureUnit) || "C",
        humidity: toNumber(ctx.input.humidity),
        baseHours: toNumber(ctx.input.baseHours),
      });

      const lineItem = buildLabourLineItem({
        rateScheduleItemId: serviceItem.id,
        entityName: serviceItem.name,
        description: "NECA temperature productivity adjustment",
        hours: result.additionalHours,
        sourceNotes: `Temperature adjustment from ${toNumber(ctx.input.baseHours).toFixed(2)} base hours with ${result.lostProductivityPercent.toFixed(2)}% lost productivity.`,
      });

      return {
        type: "line_items",
        lineItems: [lineItem],
        summary: {
          title: "NECA Temperature Adjustment",
          sections: [
            { label: "Lost Productivity", value: result.lostProductivityPercent, format: "percentage" },
            { label: "Additional Hours", value: result.additionalHours, format: "hours" },
          ],
        },
        displayText: `Prepared ${result.additionalHours.toFixed(2)} additional temperature hours.`,
      };
    }

    case "neca_extended_duration": {
      const serviceItemId = toStringValue(ctx.input.serviceItemId);
      const serviceItem = await ctx.resolveRateScheduleItem(serviceItemId);
      if (!serviceItem) {
        throw new Error("Select a valid labor rate from the current revision rate schedule.");
      }

      const result = computeNecaExtendedDuration({
        baseHours: toNumber(ctx.input.baseHours),
        workers: toNumber(ctx.input.workers),
        monthsExtended: toNumber(ctx.input.monthsExtended),
      });
      const selectedWorkers = result.selectedWorkers ?? result.recommendedWorkers ?? 0;

      const lineItem = buildLabourLineItem({
        rateScheduleItemId: serviceItem.id,
        entityName: serviceItem.name,
        description: "NECA extended duration adjustment",
        hours: result.totalAdditionalHours,
        sourceNotes: `Extended duration adjustment using ${selectedWorkers.toFixed(2)} workers over ${toNumber(ctx.input.monthsExtended)} months.`,
      });

      return {
        type: "line_items",
        lineItems: [lineItem],
        summary: {
          title: "NECA Extended Duration",
          sections: [
            { label: "Recommended Crew", value: result.recommendedWorkers, format: "number" },
            { label: "Normal Duration", value: result.normalDurationMonths, format: "number" },
            { label: "Hours / Month", value: result.extraHoursPerMonth, format: "hours" },
            { label: "Total Hours", value: result.totalAdditionalHours, format: "hours" },
          ],
        },
        displayText: `Prepared ${result.totalAdditionalHours.toFixed(2)} extended duration hours.`,
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
