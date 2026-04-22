export interface LegacyNecaJobConditionCriterion {
  id: string;
  label: string;
  description: string;
}

export const LEGACY_NECA_JOB_CONDITION_CRITERIA: LegacyNecaJobConditionCriterion[] = [
  { id: "workingConditions", label: "Working conditions", description: "Indoor, controlled environment, extreme conditions" },
  { id: "workingHeight", label: "Working height", description: "Up to 10', 10'-20', 20'+; ladders/lifts/scaffold; below grade" },
  { id: "buildingHeight", label: "Building height", description: "Number of floors: 1-3, 4-7, high-rise" },
  { id: "buildingSquareFootage", label: "Building sq. ft.", description: "Manageable, moderate, excessive" },
  { id: "projectSizeDollars", label: "Project size in dollars", description: "Normal, moderate, extreme" },
  { id: "siteSize", label: "Site size", description: "Urban setting, ample laydown space" },
  { id: "jobConditions", label: "Job conditions", description: "New construction, remodel, work while occupied" },
  { id: "typeOfConstruction", label: "Type of construction", description: "Frame, block, concrete or exposed" },
  { id: "hoursWorked", label: "Hours worked", description: "40 hours/week; 5, 6 or 7 day work week; 8, 10 or 12 hour work day" },
  { id: "shifts", label: "Shifts", description: "Day, 2nd, 3rd" },
  { id: "crewDensity", label: "Crew density", description: "Normal, moderate, extreme" },
  { id: "projectDuration", label: "Project duration", description: "Normal, compressed, delayed, fast track" },
  { id: "safety", label: "Safety", description: "Standard OSHA guidelines, customer directives, project specific" },
  { id: "installation", label: "Installation", description: "Repetitive, moderate repetitive, no repetition" },
  { id: "systems", label: "Systems", description: "Common systems, special, complex" },
  { id: "conduitType", label: "Conduit type", description: "PVC, EMT, Flex or GRC, IMC, Aluminum, PVC coated GRC" },
  { id: "accessibility", label: "Accessibility of work area", description: "Unlimited, limited, escorted" },
  { id: "voltage", label: "Voltage", description: "0-600V, 600-5Kv, over 5Kv" },
  { id: "supplierInventory", label: "Inventory of local supplier", description: "Adequate, moderate, limited" },
  { id: "storedMaterialsProximity", label: "Proximity of stored materials", description: "On site, in general area of project, remote" },
  { id: "projectContinuity", label: "Project continuity", description: "Interruptions: none, moderate, extreme" },
  { id: "construction", label: "Construction", description: "Standard, poor, none" },
  { id: "drawingsPlans", label: "Drawings/plans", description: "% complete: 100%, 95%, 50%, 35%, less" },
  { id: "information", label: "Information", description: "Timely, delayed, limited" },
  { id: "changeOrders", label: "Change order quantity/timing", description: "Minimal, moderate, excessive; prior to installation, during, after" },
  { id: "craftCoordination", label: "Craft coordination required", description: "Minimum, moderate, extensive" },
  { id: "authorityJurisdiction", label: "Authority having jurisdiction", description: "Experience with project type: considerable, moderate, limited" },
  { id: "decisionMaking", label: "Decision making", description: "Timely, delayed, limited" },
  { id: "bim", label: "BIM Building Integrated Modeling", description: "Proactive use, moderate use, contract-only use" },
  { id: "projectSchedule", label: "Project schedule", description: "As planned, compressed/extended, moderate, extreme" },
  { id: "generalContractors", label: "General contractors on same jobsite", description: "Single prime, two primes, three+ primes" },
  { id: "jobMeetings", label: "Job meetings", description: "Regularly scheduled, crisis meetings, minimal" },
  { id: "sharedResponsibility", label: "Shared responsibility for project", description: "One EC, two ECs, three+ ECs on site" },
  { id: "toolsEquipment", label: "Tools/equipment", description: "Standard, non-standard, specialty" },
  { id: "labourAvailability", label: "Labor availability", description: "Readily, moderately, limited, non-available" },
];

export interface NecaExtendedDurationRow {
  labourHours: number;
  labourDays: number;
  workers: number;
  crewWeeks: number;
  normalMonths: number;
  factor: number;
  extraHours: number;
}

export const NECA_EXTENDED_DURATION_ROWS: NecaExtendedDurationRow[] = [
  { labourHours: 500, labourDays: 62, workers: 2, crewWeeks: 6, normalMonths: 2, factor: 8, extraHours: 40 },
  { labourHours: 1000, labourDays: 125, workers: 3, crewWeeks: 8, normalMonths: 3, factor: 6.5, extraHours: 65 },
  { labourHours: 1250, labourDays: 156, workers: 4, crewWeeks: 8, normalMonths: 3, factor: 6.5, extraHours: 81 },
  { labourHours: 2500, labourDays: 313, workers: 5, crewWeeks: 10, normalMonths: 4, factor: 5, extraHours: 125 },
  { labourHours: 5000, labourDays: 625, workers: 8, crewWeeks: 16, normalMonths: 5, factor: 4, extraHours: 200 },
  { labourHours: 10000, labourDays: 1250, workers: 11, crewWeeks: 23, normalMonths: 7, factor: 3.5, extraHours: 350 },
  { labourHours: 15000, labourDays: 1875, workers: 14, crewWeeks: 27, normalMonths: 8, factor: 2.75, extraHours: 415 },
  { labourHours: 20000, labourDays: 2500, workers: 15, crewWeeks: 34, normalMonths: 10, factor: 2.25, extraHours: 450 },
  { labourHours: 30000, labourDays: 3750, workers: 17, crewWeeks: 44, normalMonths: 12, factor: 1.75, extraHours: 525 },
  { labourHours: 45000, labourDays: 5625, workers: 25, crewWeeks: 45, normalMonths: 12, factor: 1.75, extraHours: 785 },
  { labourHours: 60000, labourDays: 7500, workers: 30, crewWeeks: 50, normalMonths: 14, factor: 1.45, extraHours: 870 },
  { labourHours: 75000, labourDays: 9400, workers: 35, crewWeeks: 54, normalMonths: 15, factor: 1.35, extraHours: 1010 },
  { labourHours: 100000, labourDays: 12500, workers: 38, crewWeeks: 65, normalMonths: 18, factor: 1.25, extraHours: 1250 },
  { labourHours: 125000, labourDays: 15650, workers: 40, crewWeeks: 78, normalMonths: 21, factor: 1.15, extraHours: 1445 },
  { labourHours: 150000, labourDays: 18750, workers: 45, crewWeeks: 83, normalMonths: 22, factor: 1, extraHours: 1500 },
  { labourHours: 200000, labourDays: 25000, workers: 58, crewWeeks: 86, normalMonths: 23, factor: 0.95, extraHours: 1900 },
  { labourHours: 250000, labourDays: 33000, workers: 70, crewWeeks: 90, normalMonths: 24, factor: 0.85, extraHours: 2120 },
  { labourHours: 300000, labourDays: 37500, workers: 80, crewWeeks: 94, normalMonths: 26, factor: 0.84, extraHours: 2520 },
];

export interface NecaTemperatureSample {
  temperatureF: number;
  humidity: number;
  productivity: number;
}

export const NECA_TEMPERATURE_SAMPLES: NecaTemperatureSample[] = [
  { temperatureF: 40, humidity: 30, productivity: 100 },
  { temperatureF: 35, humidity: 30, productivity: 100 },
  { temperatureF: 34, humidity: 30, productivity: 98 },
  { temperatureF: 24, humidity: 30, productivity: 94 },
  { temperatureF: 14, humidity: 30, productivity: 88 },
  { temperatureF: 4, humidity: 30, productivity: 78 },
  { temperatureF: -5, humidity: 30, productivity: 62 },
  { temperatureF: -15, humidity: 30, productivity: 62 },
  { temperatureF: -15, humidity: 44, productivity: 62 },
  { temperatureF: -15, humidity: 45, productivity: 61 },
  { temperatureF: -15, humidity: 55, productivity: 60 },
  { temperatureF: -15, humidity: 65, productivity: 59 },
  { temperatureF: -15, humidity: 75, productivity: 57 },
  { temperatureF: -15, humidity: 85, productivity: 55 },
  { temperatureF: -15, humidity: 90, productivity: 55 },
  { temperatureF: -4, humidity: 90, productivity: 71 },
  { temperatureF: 5, humidity: 90, productivity: 82 },
  { temperatureF: 15, humidity: 90, productivity: 89 },
  { temperatureF: 25, humidity: 90, productivity: 93 },
  { temperatureF: 35, humidity: 90, productivity: 96 },
  { temperatureF: 45, humidity: 90, productivity: 98 },
  { temperatureF: 65, humidity: 90, productivity: 96 },
  { temperatureF: 75, humidity: 90, productivity: 93 },
  { temperatureF: 85, humidity: 90, productivity: 84 },
  { temperatureF: 95, humidity: 90, productivity: 57 },
];

export interface ShopPipeDataRow {
  nominalDiameter: number;
  actualSize: number;
  numberOfPasses: number;
  minutesPerInch: number;
  fittingHours: number;
  cuttingHours: number;
  bevellingHours: number;
  stainlessPercentAdder: number;
  oletHours: number;
  stressReliefHours: number;
  radiographicInspectionHours: number;
  mpiHours: number;
  preheatHours: number;
}

export const SHOP_PIPE_DATA: ShopPipeDataRow[] = [
  { nominalDiameter: 0.25, actualSize: 0.54, numberOfPasses: 2, minutesPerInch: 2, fittingHours: 0.45, cuttingHours: 0.2, bevellingHours: 0.33, stainlessPercentAdder: 10, oletHours: 1.1, stressReliefHours: 2.3, radiographicInspectionHours: 0.75, mpiHours: 0.6, preheatHours: 0.2 },
  { nominalDiameter: 0.375, actualSize: 0.675, numberOfPasses: 2, minutesPerInch: 2, fittingHours: 0.45, cuttingHours: 0.2, bevellingHours: 0.33, stainlessPercentAdder: 10, oletHours: 1.3, stressReliefHours: 2.3, radiographicInspectionHours: 0.75, mpiHours: 0.6, preheatHours: 0.2 },
  { nominalDiameter: 0.5, actualSize: 0.84, numberOfPasses: 2, minutesPerInch: 2, fittingHours: 0.45, cuttingHours: 0.2, bevellingHours: 0.33, stainlessPercentAdder: 10, oletHours: 1.3, stressReliefHours: 2.3, radiographicInspectionHours: 0.75, mpiHours: 0.6, preheatHours: 0.2 },
  { nominalDiameter: 0.75, actualSize: 1.05, numberOfPasses: 2, minutesPerInch: 2, fittingHours: 0.45, cuttingHours: 0.2, bevellingHours: 0.33, stainlessPercentAdder: 10, oletHours: 1.6, stressReliefHours: 2.3, radiographicInspectionHours: 0.75, mpiHours: 0.6, preheatHours: 0.2 },
  { nominalDiameter: 1, actualSize: 1.315, numberOfPasses: 2, minutesPerInch: 2, fittingHours: 0.45, cuttingHours: 0.2, bevellingHours: 0.33, stainlessPercentAdder: 10, oletHours: 1.8, stressReliefHours: 2.3, radiographicInspectionHours: 0.75, mpiHours: 0.6, preheatHours: 0.2 },
  { nominalDiameter: 1.25, actualSize: 1.66, numberOfPasses: 2, minutesPerInch: 2, fittingHours: 0.45, cuttingHours: 0.2, bevellingHours: 0.33, stainlessPercentAdder: 10, oletHours: 2, stressReliefHours: 2.3, radiographicInspectionHours: 0.75, mpiHours: 0.6, preheatHours: 0.2 },
  { nominalDiameter: 1.5, actualSize: 1.9, numberOfPasses: 2, minutesPerInch: 2, fittingHours: 0.45, cuttingHours: 0.2, bevellingHours: 0.33, stainlessPercentAdder: 10, oletHours: 2.5, stressReliefHours: 2.3, radiographicInspectionHours: 0.75, mpiHours: 0.6, preheatHours: 0.2 },
  { nominalDiameter: 2, actualSize: 2.375, numberOfPasses: 2, minutesPerInch: 2, fittingHours: 0.45, cuttingHours: 0.2, bevellingHours: 0.33, stainlessPercentAdder: 10, oletHours: 3.4, stressReliefHours: 2.3, radiographicInspectionHours: 0.75, mpiHours: 0.6, preheatHours: 0.2 },
  { nominalDiameter: 2.5, actualSize: 2.875, numberOfPasses: 3, minutesPerInch: 2, fittingHours: 0.64, cuttingHours: 0.22, bevellingHours: 0.34, stainlessPercentAdder: 10, oletHours: 4, stressReliefHours: 2.4, radiographicInspectionHours: 0.75, mpiHours: 0.7, preheatHours: 0.3 },
  { nominalDiameter: 3, actualSize: 3.5, numberOfPasses: 3, minutesPerInch: 2, fittingHours: 0.75, cuttingHours: 0.29, bevellingHours: 0.36, stainlessPercentAdder: 10, oletHours: 4.6, stressReliefHours: 2.5, radiographicInspectionHours: 0.75, mpiHours: 0.8, preheatHours: 0.4 },
  { nominalDiameter: 4, actualSize: 4.5, numberOfPasses: 3, minutesPerInch: 1.5, fittingHours: 0.94, cuttingHours: 0.4, bevellingHours: 0.39, stainlessPercentAdder: 10, oletHours: 6.1, stressReliefHours: 2.6, radiographicInspectionHours: 0.85, mpiHours: 1.1, preheatHours: 0.5 },
  { nominalDiameter: 5, actualSize: 5.563, numberOfPasses: 3, minutesPerInch: 1.5, fittingHours: 1.14, cuttingHours: 0.47, bevellingHours: 0.4, stainlessPercentAdder: 10, oletHours: 6.9, stressReliefHours: 3, radiographicInspectionHours: 0.93, mpiHours: 1.4, preheatHours: 0.6 },
  { nominalDiameter: 6, actualSize: 6.625, numberOfPasses: 3, minutesPerInch: 1.5, fittingHours: 1.36, cuttingHours: 0.64, bevellingHours: 0.46, stainlessPercentAdder: 10, oletHours: 7.6, stressReliefHours: 3.2, radiographicInspectionHours: 1.04, mpiHours: 1.7, preheatHours: 0.7 },
  { nominalDiameter: 8, actualSize: 8.625, numberOfPasses: 3, minutesPerInch: 1.5, fittingHours: 1.67, cuttingHours: 0.89, bevellingHours: 0.5, stainlessPercentAdder: 10, oletHours: 8.4, stressReliefHours: 3.6, radiographicInspectionHours: 1.17, mpiHours: 2, preheatHours: 0.8 },
  { nominalDiameter: 10, actualSize: 10.75, numberOfPasses: 3, minutesPerInch: 1.5, fittingHours: 1.92, cuttingHours: 1.24, bevellingHours: 0.91, stainlessPercentAdder: 10, oletHours: 11.8, stressReliefHours: 3.9, radiographicInspectionHours: 1.31, mpiHours: 2.5, preheatHours: 1.1 },
  { nominalDiameter: 12, actualSize: 12.75, numberOfPasses: 3, minutesPerInch: 1.5, fittingHours: 2.06, cuttingHours: 1.35, bevellingHours: 0.97, stainlessPercentAdder: 10, oletHours: 16.5, stressReliefHours: 4.3, radiographicInspectionHours: 1.49, mpiHours: 3.1, preheatHours: 1.3 },
  { nominalDiameter: 14, actualSize: 14, numberOfPasses: 3, minutesPerInch: 1.5, fittingHours: 2.6, cuttingHours: 1.7, bevellingHours: 1.2, stainlessPercentAdder: 10, oletHours: 18.4, stressReliefHours: 4.7, radiographicInspectionHours: 1.62, mpiHours: 3.4, preheatHours: 1.6 },
  { nominalDiameter: 16, actualSize: 16, numberOfPasses: 3, minutesPerInch: 1.5, fittingHours: 3.19, cuttingHours: 2.11, bevellingHours: 1.5, stainlessPercentAdder: 10, oletHours: 21.8, stressReliefHours: 5, radiographicInspectionHours: 1.81, mpiHours: 3.9, preheatHours: 1.9 },
  { nominalDiameter: 20, actualSize: 20, numberOfPasses: 3, minutesPerInch: 1.5, fittingHours: 4.22, cuttingHours: 3.22, bevellingHours: 2.28, stainlessPercentAdder: 10, oletHours: 31, stressReliefHours: 5.6, radiographicInspectionHours: 2.22, mpiHours: 4.8, preheatHours: 2.6 },
  { nominalDiameter: 24, actualSize: 24, numberOfPasses: 3, minutesPerInch: 1.5, fittingHours: 4.68, cuttingHours: 4.88, bevellingHours: 3.46, stainlessPercentAdder: 10, oletHours: 45.9, stressReliefHours: 6, radiographicInspectionHours: 2.74, mpiHours: 5.6, preheatHours: 3.1 },
];

export interface ShopWeldComponent {
  id: string;
  label: string;
  rateHours: number;
  mode: "length" | "count";
}

export const SHOP_WELD_COMPONENTS: ShopWeldComponent[] = [
  { id: "holeDrilling", label: "Hole Drilling", rateHours: 5 / 60, mode: "count" },
  { id: "filletCarbon", label: "1/4 Fillet Weld (Carbon Steel)", rateHours: 7 / 60, mode: "length" },
  { id: "filletStainless", label: "1/4 Fillet Weld (Stainless Steel)", rateHours: 10 / 60, mode: "length" },
  { id: "buffingCleaning", label: "Buffing/Cleaning", rateHours: 10 / 60, mode: "count" },
];

function toNumber(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function roundHours(value: number): number {
  return Math.round(value * 100) / 100;
}

function roundQuarterHour(value: number): number {
  return Math.round(value * 4) / 4;
}

function normalizeFeet(value: number, unit: string): number {
  switch (unit) {
    case "m":
      return value * 3.28084;
    case "cm":
      return value / 30.48;
    case "in":
      return value / 12;
    default:
      return value;
  }
}

function interpolateFields<T extends object>(lower: T, upper: T, input: number, inputKey: keyof T): T {
  const lowerInput = Number(lower[inputKey]);
  const upperInput = Number(upper[inputKey]);
  const ratio = upperInput === lowerInput ? 0 : (input - lowerInput) / (upperInput - lowerInput);
  const result = {} as T;
  for (const key of Object.keys(lower) as Array<keyof T>) {
    const lowerValue = lower[key];
    const upperValue = upper[key];
    if (typeof lowerValue === "number" && typeof upperValue === "number") {
      (result as Record<string, unknown>)[String(key)] = lowerValue + ratio * (upperValue - lowerValue);
    } else {
      (result as Record<string, unknown>)[String(key)] = lowerValue;
    }
  }
  return result;
}

export function computeLegacyNecaDifficulty(scores: Record<string, number>) {
  const totalScore = Object.values(scores).reduce((sum, value) => sum + toNumber(value), 0);
  const difficulty =
    totalScore >= 135 ? "Very Difficult" :
    totalScore >= 76 ? "Difficult" :
    "Normal";

  return { totalScore, difficulty };
}

export function computeNecaTemperatureAdjustment(input: {
  temperature: number;
  humidity: number;
  baseHours: number;
  temperatureUnit?: "C" | "F" | string;
}) {
  const temperatureF =
    String(input.temperatureUnit ?? "F").toUpperCase() === "C"
      ? (toNumber(input.temperature) * 9) / 5 + 32
      : toNumber(input.temperature);
  const humidity = toNumber(input.humidity);
  const baseHours = toNumber(input.baseHours);

  let bestMatch = NECA_TEMPERATURE_SAMPLES[0];
  let bestDistance = Number.POSITIVE_INFINITY;

  for (const sample of NECA_TEMPERATURE_SAMPLES) {
    const distance = Math.sqrt(
      (sample.temperatureF - temperatureF) ** 2 +
      (sample.humidity - humidity) ** 2,
    );
    if (distance < bestDistance) {
      bestDistance = distance;
      bestMatch = sample;
    }
  }

  const lostProductivityPercent = 100 - bestMatch.productivity;
  const additionalHours = roundHours(baseHours * (lostProductivityPercent / 100));

  return {
    productivityPercent: bestMatch.productivity,
    lostProductivityPercent,
    additionalHours,
    matchedSample: bestMatch,
  };
}

export function computeNecaExtendedDuration(input: {
  baseHours: number;
  monthsExtended: number;
  workers?: number;
}) {
  const baseHours = toNumber(input.baseHours);
  const monthsExtended = toNumber(input.monthsExtended);

  if (NECA_EXTENDED_DURATION_ROWS.length === 0) {
    return {
      recommendedWorkers: 0,
      normalDurationMonths: 0,
      extraHoursPerMonth: 0,
      totalAdditionalHours: 0,
    };
  }

  const rows = NECA_EXTENDED_DURATION_ROWS;
  let synthetic: NecaExtendedDurationRow;

  if (baseHours <= rows[0].labourHours) {
    const first = rows[0];
    const second = rows[1];
    synthetic = interpolateFields(first, second, baseHours, "labourHours");
  } else if (baseHours >= rows[rows.length - 1].labourHours) {
    const last = rows[rows.length - 1];
    const previous = rows[rows.length - 2];
    synthetic = interpolateFields(previous, last, baseHours, "labourHours");
  } else {
    let lower = rows[0];
    let upper = rows[rows.length - 1];
    for (let index = 0; index < rows.length - 1; index += 1) {
      if (rows[index].labourHours <= baseHours && rows[index + 1].labourHours >= baseHours) {
        lower = rows[index];
        upper = rows[index + 1];
        break;
      }
    }
    synthetic = interpolateFields(lower, upper, baseHours, "labourHours");
  }

  const recommendedWorkers = Math.max(1, roundHours(synthetic.workers));
  const selectedWorkers = Math.max(1, toNumber(input.workers) || recommendedWorkers);
  const extraHoursPerMonth = roundHours((synthetic.extraHours / recommendedWorkers) * selectedWorkers);
  const totalAdditionalHours = roundHours(extraHoursPerMonth * monthsExtended);

  return {
    recommendedWorkers,
    selectedWorkers,
    normalDurationMonths: roundHours(synthetic.normalMonths),
    extraHoursPerMonth,
    totalAdditionalHours,
  };
}

export function computeShopPipeEstimate(input: {
  rows: Array<Record<string, unknown>>;
  pipeType?: string;
  efficiencyModifier?: number;
  stressRelief?: boolean;
  radiographicInspection?: boolean;
  purge?: boolean;
  mpiInspection?: boolean;
  preheat?: boolean;
  purgePercentage?: number;
  handlingPercentage?: number;
}) {
  const efficiencyValue = toNumber(input.efficiencyModifier) || 100;
  const efficiencyFactor = 1 + (100 - efficiencyValue) / 100;
  const handlingPercentage = toNumber(input.handlingPercentage) || 10;
  const purgePercentage = toNumber(input.purgePercentage) || 20;
  const isStainless = String(input.pipeType ?? "carbon").toLowerCase() === "stainless";

  let weldingHours = 0;
  let handlingHours = 0;
  let oletHours = 0;
  let cuttingHours = 0;
  let bevellingHours = 0;
  let fittingHours = 0;
  let purgeHours = 0;
  let stressReliefHours = 0;
  let radiographicInspectionHours = 0;
  let mpiHours = 0;
  let preheatHours = 0;

  for (const row of input.rows) {
    const nominalSize = toNumber(row.pipeSize ?? row.nominalDiameter);
    const weldType = String(row.weldType ?? "butt");
    const weldCount = toNumber(row.weldCount);
    const oletCount = toNumber(row.oletCount);
    const pipe = SHOP_PIPE_DATA.find((entry) => entry.nominalDiameter === nominalSize);
    if (!pipe) {
      continue;
    }

    if (weldCount > 0) {
      let hoursPerWeld = (pipe.actualSize * Math.PI * pipe.numberOfPasses * pipe.minutesPerInch) / 60;
      if (isStainless) {
        hoursPerWeld *= 1 + pipe.stainlessPercentAdder / 100;
      }
      if (weldType === "fillet") {
        hoursPerWeld *= 0.7;
      }
      hoursPerWeld *= efficiencyFactor;
      weldingHours += hoursPerWeld * weldCount;

      cuttingHours += pipe.cuttingHours * efficiencyFactor * weldCount;
      bevellingHours += pipe.bevellingHours * 0.65 * efficiencyFactor * weldCount;
      fittingHours += pipe.fittingHours * efficiencyFactor * weldCount;
      handlingHours += hoursPerWeld * (handlingPercentage / 100) * weldCount;

      if (input.purge) {
        purgeHours += pipe.fittingHours * efficiencyFactor * (purgePercentage / 100) * weldCount;
      }
      if (input.stressRelief) {
        stressReliefHours += pipe.stressReliefHours * efficiencyFactor * weldCount;
      }
      if (input.radiographicInspection) {
        radiographicInspectionHours += pipe.radiographicInspectionHours * efficiencyFactor * weldCount;
      }
      if (input.mpiInspection) {
        mpiHours += pipe.mpiHours * efficiencyFactor * weldCount;
      }
      if (input.preheat) {
        preheatHours += pipe.preheatHours * efficiencyFactor * weldCount;
      }
    }

    if (oletCount > 0) {
      oletHours += pipe.oletHours * efficiencyFactor * oletCount;
    }
  }

  const breakdown = {
    weldingHours: roundHours(weldingHours),
    handlingHours: roundHours(handlingHours),
    oletHours: roundHours(oletHours),
    cuttingHours: roundHours(cuttingHours),
    bevellingHours: roundHours(bevellingHours),
    fittingHours: roundHours(fittingHours),
    purgeHours: roundHours(purgeHours),
    stressReliefHours: roundHours(stressReliefHours),
    radiographicInspectionHours: roundHours(radiographicInspectionHours),
    mpiHours: roundHours(mpiHours),
    preheatHours: roundHours(preheatHours),
  };

  const totalHours = roundQuarterHour(
    breakdown.weldingHours +
      breakdown.handlingHours +
      breakdown.oletHours +
      breakdown.cuttingHours +
      breakdown.bevellingHours +
      breakdown.fittingHours +
      breakdown.purgeHours +
      breakdown.stressReliefHours +
      breakdown.radiographicInspectionHours +
      breakdown.mpiHours +
      breakdown.preheatHours,
  );

  return { totalHours, breakdown };
}

export function computeShopWeldEstimate(input: {
  rows: Array<Record<string, unknown>>;
}) {
  let totalHours = 0;

  for (const row of input.rows) {
    const taskId = String(row.taskId ?? row.task ?? "");
    const component = SHOP_WELD_COMPONENTS.find((entry) => entry.id === taskId);
    if (!component) {
      continue;
    }

    const quantity = toNumber(row.quantity);
    const passes = Math.max(1, toNumber(row.passes) || 1);
    const unit = String(row.unit ?? "ft");

    if (component.mode === "length") {
      totalHours += normalizeFeet(quantity, unit) * passes * component.rateHours;
    } else {
      totalHours += quantity * component.rateHours;
    }
  }

  return { totalHours: roundQuarterHour(totalHours) };
}

export function sumTableHours(
  rows: Array<Record<string, unknown>>,
  options?: {
    totalField?: string;
    quantityField?: string;
    rateField?: string;
    multiplier?: number;
  },
) {
  const totalField = options?.totalField ?? "totalHours";
  const quantityField = options?.quantityField ?? "quantity";
  const rateField = options?.rateField ?? "hoursPerUnit";
  const multiplier = options?.multiplier ?? 1;

  const total = rows.reduce((sum, row) => {
    const explicitTotal = toNumber(row[totalField]);
    if (explicitTotal > 0) {
      return sum + explicitTotal;
    }
    return sum + toNumber(row[quantityField]) * toNumber(row[rateField]);
  }, 0);

  return roundHours(total * multiplier);
}
