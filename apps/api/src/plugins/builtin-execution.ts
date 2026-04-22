import type { Plugin, PluginOutput, PluginOutputLineItem } from "@bidwright/domain";
import {
  computeLegacyNecaDifficulty,
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

function daysBetween(start: string, end: string) {
  const startTime = Date.parse(start);
  const endTime = Date.parse(end);
  if (!Number.isFinite(startTime) || !Number.isFinite(endTime) || endTime <= startTime) {
    return 0;
  }
  return Math.max(0, Math.round((endTime - startTime) / 86_400_000));
}

function getRowString(row: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = getDatasetCellString(row, key);
    if (value) {
      return value;
    }
  }
  return "";
}

function getRowNumber(row: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = Number(getDatasetCellValue(row, key));
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
) {
  const category = toStringValue(input.category);
  const labourClass = toStringValue(input.class);
  const subClass = toStringValue(input.subClass);

  const matches = rows.filter((row) =>
    getRowString(row, ["category"]) === category &&
    getRowString(row, ["class"]) === labourClass,
  );

  if (subClass) {
    const exact = matches.find((row) => getRowString(row, ["subClass"]) === subClass);
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

function buildMaterialLineItem(args: {
  name: string;
  description: string;
  vendor: string;
  quantity: number;
  cost: number;
  markup: number;
}) {
  const lineItem: PluginOutputLineItem = {
    category: "Material",
    entityType: "Material",
    entityName: args.name,
    vendor: args.vendor,
    description: args.description,
    quantity: Math.max(1, toNumber(args.quantity)),
    uom: "EA",
    cost: toNumber(args.cost),
    markup: toNumber(args.markup),
    price: 0,
    unit1: 0,
    unit2: 0,
    unit3: 0,
  };
  return lineItem;
}

function buildTravelLineItem(args: {
  name: string;
  location: string;
  totalCost: number;
  markup: number;
  crewSize: number;
  nights: number;
}) {
  const lineItem: PluginOutputLineItem = {
    category: "Travel & Per Diem",
    entityType: "Travel",
    entityName: args.name,
    vendor: "Hotel",
    description: `${args.name}${args.location ? ` - ${args.location}` : ""}`,
    quantity: 1,
    uom: "EA",
    cost: toNumber(args.totalCost),
    markup: toNumber(args.markup),
    price: 0,
    unit1: Math.max(0, toNumber(args.nights)),
    unit2: Math.max(1, toNumber(args.crewSize)),
    unit3: 0,
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
    throw new Error("Select a valid labour rate from the current revision rate schedule.");
  }

  const datasetRows = await ctx.lookupDatasetRows(datasetRef);
  const row = findLabourDatasetRow(datasetRows, ctx.input);
  if (!row) {
    throw new Error(`No ${providerLabel} labour unit matched the selected category/class/sub-class.`);
  }

  const difficulty = normalizeDifficulty(
    toStringValue(ctx.input.difficulty) || ctx.revisionDifficulty || "Normal",
  );
  const quantity = toNumber(ctx.input.quantity);
  const hoursPerUnit =
    difficulty === "Difficult"
      ? getRowNumber(row, ["hourDifficult"])
      : difficulty === "Very Difficult" || difficulty === "Extreme"
        ? getRowNumber(row, ["hourVeryDifficult"])
        : getRowNumber(row, ["hourNormal"]);
  const totalHours = roundHours(quantity * hoursPerUnit);
  const category = getRowString(row, ["category"]);
  const labourClass = getRowString(row, ["class"]);
  const subClass = getRowString(row, ["subClass"]);
  const description = [providerLabel, category, labourClass, subClass].filter(Boolean).join(" - ");

  const output: PluginOutput = {
    type: "line_items",
    lineItems: [
      buildLabourLineItem({
        rateScheduleItemId: serviceItem.id,
        entityName: serviceItem.name,
        description,
        hours: totalHours,
        sourceNotes: `${providerLabel} labour unit ${hoursPerUnit.toFixed(2)} hrs per unit x ${quantity} @ ${difficulty}.`,
      }),
    ],
    summary: {
      title: `${providerLabel} Labour Units`,
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
  switch (ctx.toolId) {
    case "neca.labourUnits":
      return executeDatasetBackedLabourTool(ctx, "ds-neca-labour", "NECA");

    case "phcc.labourUnits":
      return executeDatasetBackedLabourTool(ctx, "ds-phcc-labour", "PHCC");

    case "neca.jobCondition": {
      const scores = getFormScores(ctx.formState, "necaJobCondition");
      if (Object.keys(scores).length === 0) {
        throw new Error("Complete the NECA job condition score sheet before applying it.");
      }

      const { totalScore, difficulty } = computeLegacyNecaDifficulty(scores);
      return {
        type: "revision_patch",
        revisionPatches: [{ field: "necaDifficulty", value: difficulty }],
        summary: {
          title: "NECA Job Condition",
          sections: [
            { label: "Total Score", value: totalScore, format: "number" },
            { label: "Difficulty", value: difficulty, format: "text" },
          ],
        },
        displayText: `Set the revision NECA difficulty to ${difficulty}.`,
      };
    }

    case "neca.temperature": {
      const serviceItemId = toStringValue(ctx.input.serviceItemId);
      const serviceItem = await ctx.resolveRateScheduleItem(serviceItemId);
      if (!serviceItem) {
        throw new Error("Select a valid labour rate from the current revision rate schedule.");
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

    case "neca.extendedDuration": {
      const serviceItemId = toStringValue(ctx.input.serviceItemId);
      const serviceItem = await ctx.resolveRateScheduleItem(serviceItemId);
      if (!serviceItem) {
        throw new Error("Select a valid labour rate from the current revision rate schedule.");
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

    case "methvin.pipe":
    case "methvin.fabrication":
    case "methvin.conduit": {
      const serviceItemId = toStringValue(ctx.input.serviceItemId);
      const serviceItem = await ctx.resolveRateScheduleItem(serviceItemId);
      if (!serviceItem) {
        throw new Error("Select a valid labour rate from the current revision rate schedule.");
      }

      const tableId =
        ctx.toolId === "methvin.pipe" ? "weldComponents" :
        ctx.toolId === "methvin.fabrication" ? "fabTasks" :
        "cableRuns";
      const rows = getFormTableRows(ctx.formState, tableId);
      const totalHours =
        ctx.toolId === "methvin.pipe"
          ? sumTableHours(rows, {
              totalField: "totalMH",
              quantityField: "quantity",
              rateField: "mhPerUnit",
              multiplier: toNumber(ctx.input.efficiencyModifier) || 1,
            })
          : ctx.toolId === "methvin.fabrication"
            ? sumTableHours(rows, {
                totalField: "totalHours",
                quantityField: "quantity",
                rateField: "hoursPerUnit",
              })
            : sumTableHours(rows, {
                totalField: "totalMH",
                quantityField: "distance",
                rateField: "mhPerFoot",
              });

      const description =
        toStringValue(ctx.input.description) ||
        (ctx.toolId === "methvin.pipe"
          ? "Methvin pipe welding"
          : ctx.toolId === "methvin.fabrication"
            ? "Methvin fabrication"
            : "Methvin conduit & cable");

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

    case "shop.pipe": {
      const serviceItemId = toStringValue(ctx.input.serviceItemId);
      const serviceItem = await ctx.resolveRateScheduleItem(serviceItemId);
      if (!serviceItem) {
        throw new Error("Select a valid labour rate from the current revision rate schedule.");
      }

      const rows = getFormTableRows(ctx.formState, "pipeRows");
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
            description: toStringValue(ctx.input.description) || "Shop pipe fabrication",
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

    case "shop.weld": {
      const serviceItemId = toStringValue(ctx.input.serviceItemId);
      const serviceItem = await ctx.resolveRateScheduleItem(serviceItemId);
      if (!serviceItem) {
        throw new Error("Select a valid labour rate from the current revision rate schedule.");
      }

      const rows = getFormTableRows(ctx.formState, "weldRows");
      const result = computeShopWeldEstimate({ rows });

      return {
        type: "line_items",
        lineItems: [
          buildLabourLineItem({
            rateScheduleItemId: serviceItem.id,
            entityName: serviceItem.name,
            description: toStringValue(ctx.input.description) || "Shop weld prep",
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

    case "homedepot.search": {
      const name = toStringValue(ctx.input.name);
      const cost = toNumber(ctx.input.cost);
      if (!name || cost <= 0) {
        throw new Error("Select or enter a Home Depot product with a unit cost before adding it.");
      }

      return {
        type: "line_items",
        lineItems: [
          buildMaterialLineItem({
            name,
            description: toStringValue(ctx.input.description) || name,
            vendor: toStringValue(ctx.input.vendor) || "Home Depot",
            quantity: toNumber(ctx.input.quantity) || 1,
            cost,
            markup: toNumber(ctx.input.markup) || 15,
          }),
        ],
        summary: {
          title: "Home Depot Search",
          sections: [
            { label: "Vendor", value: toStringValue(ctx.input.vendor) || "Home Depot", format: "text" },
            { label: "Unit Cost", value: cost, format: "currency" },
          ],
        },
        displayText: `Prepared material pricing for ${name}.`,
      };
    }

    case "google.shopping": {
      const name = toStringValue(ctx.input.name);
      const cost = toNumber(ctx.input.cost);
      if (!name || cost <= 0) {
        throw new Error("Select or enter a Google Shopping result with a unit cost before adding it.");
      }

      return {
        type: "line_items",
        lineItems: [
          buildMaterialLineItem({
            name,
            description: toStringValue(ctx.input.description) || name,
            vendor: toStringValue(ctx.input.vendor) || "Google Shopping",
            quantity: toNumber(ctx.input.quantity) || 1,
            cost,
            markup: toNumber(ctx.input.markup) || 15,
          }),
        ],
        summary: {
          title: "Google Shopping",
          sections: [
            { label: "Vendor", value: toStringValue(ctx.input.vendor) || "Google Shopping", format: "text" },
            { label: "Unit Cost", value: cost, format: "currency" },
          ],
        },
        displayText: `Prepared comparison pricing for ${name}.`,
      };
    }

    case "google.hotels": {
      const hotelName = toStringValue(ctx.input.hotelName) || toStringValue(ctx.input.location);
      const nightlyRate = toNumber(ctx.input.nightlyRate);
      const nights = toNumber(ctx.input.nights) || daysBetween(toStringValue(ctx.input.checkin), toStringValue(ctx.input.checkout));
      const crewSize = Math.max(1, toNumber(ctx.input.crewSize) || 1);
      const totalCost = toNumber(ctx.input.totalCost) || roundHours(nightlyRate * nights * crewSize);

      if (!hotelName || totalCost <= 0) {
        throw new Error("Select a hotel and confirm the nightly rate before adding travel costs.");
      }

      return {
        type: "line_items",
        lineItems: [
          buildTravelLineItem({
            name: hotelName,
            location: toStringValue(ctx.input.location),
            totalCost,
            markup: toNumber(ctx.input.markup) || 15,
            crewSize,
            nights,
          }),
        ],
        summary: {
          title: "Google Hotels",
          sections: [
            { label: "Nights", value: nights, format: "number" },
            { label: "Crew Size", value: crewSize, format: "number" },
            { label: "Total Cost", value: totalCost, format: "currency" },
          ],
        },
        displayText: `Prepared travel costs for ${hotelName}.`,
      };
    }

    default:
      return null;
  }
}
