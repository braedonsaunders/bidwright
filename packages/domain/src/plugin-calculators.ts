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
