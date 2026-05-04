export type EstimateConfidenceLabel = "low" | "medium" | "high" | "institutional";

export interface EstimateMaturityInputs {
  lineItemCount: number;
  sourceEvidenceCoverage: number;
  resourceCoverage: number;
  rateLinkageCoverage: number;
  takeoffCoverage: number;
  validationScore: number;
  benchmarkCoverage: number;
}

type EstimateClass = 1 | 2 | 3 | 4 | 5;

interface AccuracyRange {
  lowPct: number;
  highPct: number;
}

export interface EstimateClassification {
  estimateClass: EstimateClass;
  confidence: EstimateConfidenceLabel;
  maturityScore: number;
  expectedAccuracyRange: AccuracyRange;
  drivers: Array<{
    key: keyof EstimateMaturityInputs;
    label: string;
    score: number;
    impact: "low" | "medium" | "high";
  }>;
}

export interface SensitivityInputLine {
  id: string;
  label: string;
  category?: string;
  quantity?: number;
  unitCost?: number;
  totalCost?: number;
  uncertaintyPct?: number;
  confidence?: number;
}

export interface SensitivityDriver {
  id: string;
  label: string;
  category?: string;
  baseCost: number;
  uncertaintyPct: number;
  exposure: number;
  contributionPct: number;
  confidence?: number;
}

const weights: Record<keyof EstimateMaturityInputs, number> = {
  lineItemCount: 0.12,
  sourceEvidenceCoverage: 0.18,
  resourceCoverage: 0.14,
  rateLinkageCoverage: 0.16,
  takeoffCoverage: 0.14,
  validationScore: 0.16,
  benchmarkCoverage: 0.10,
};

const labels: Record<keyof EstimateMaturityInputs, string> = {
  lineItemCount: "Line item depth",
  sourceEvidenceCoverage: "Evidence coverage",
  resourceCoverage: "Resource breakdown",
  rateLinkageCoverage: "Rate linkage",
  takeoffCoverage: "Takeoff linkage",
  validationScore: "Validation score",
  benchmarkCoverage: "Benchmark coverage",
};

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

function normalizeCoverage(value: number): number {
  return clamp01(value > 1 ? value / 100 : value);
}

function lineItemDepthScore(count: number): number {
  if (!Number.isFinite(count) || count <= 0) return 0;
  if (count >= 150) return 1;
  if (count >= 75) return 0.85;
  if (count >= 35) return 0.65;
  if (count >= 12) return 0.4;
  return 0.2;
}

function classFromScore(score: number): EstimateClass {
  if (score >= 0.9) return 1;
  if (score >= 0.78) return 2;
  if (score >= 0.62) return 3;
  if (score >= 0.42) return 4;
  return 5;
}

function confidenceFromScore(score: number): EstimateConfidenceLabel {
  if (score >= 0.9) return "institutional";
  if (score >= 0.72) return "high";
  if (score >= 0.5) return "medium";
  return "low";
}

function accuracyRange(estimateClass: EstimateClass): AccuracyRange {
  const ranges = {
    1: { lowPct: -10, highPct: 15 },
    2: { lowPct: -15, highPct: 20 },
    3: { lowPct: -20, highPct: 30 },
    4: { lowPct: -30, highPct: 50 },
    5: { lowPct: -50, highPct: 100 },
  } satisfies Record<EstimateClass, AccuracyRange>;
  return ranges[estimateClass];
}

export function classifyEstimateMaturity(inputs: EstimateMaturityInputs): EstimateClassification {
  const normalized = {
    lineItemCount: lineItemDepthScore(inputs.lineItemCount),
    sourceEvidenceCoverage: normalizeCoverage(inputs.sourceEvidenceCoverage),
    resourceCoverage: normalizeCoverage(inputs.resourceCoverage),
    rateLinkageCoverage: normalizeCoverage(inputs.rateLinkageCoverage),
    takeoffCoverage: normalizeCoverage(inputs.takeoffCoverage),
    validationScore: normalizeCoverage(inputs.validationScore),
    benchmarkCoverage: normalizeCoverage(inputs.benchmarkCoverage),
  };

  const maturityScore = Number(
    Object.entries(normalized).reduce((sum, [key, score]) => {
      return sum + score * weights[key as keyof EstimateMaturityInputs];
    }, 0).toFixed(4),
  );

  const drivers = (Object.entries(normalized) as Array<[keyof EstimateMaturityInputs, number]>)
    .map(([key, score]) => ({
      key,
      label: labels[key],
      score: Number(score.toFixed(4)),
      impact: score < 0.45 ? "high" as const : score < 0.7 ? "medium" as const : "low" as const,
    }))
    .sort((left, right) => left.score - right.score);

  const estimateClass = classFromScore(maturityScore);
  return {
    estimateClass,
    confidence: confidenceFromScore(maturityScore),
    maturityScore,
    expectedAccuracyRange: accuracyRange(estimateClass),
    drivers,
  };
}

function lineBaseCost(line: SensitivityInputLine): number {
  if (typeof line.totalCost === "number" && Number.isFinite(line.totalCost)) return Math.max(0, line.totalCost);
  const qty = typeof line.quantity === "number" && Number.isFinite(line.quantity) ? line.quantity : 0;
  const unitCost = typeof line.unitCost === "number" && Number.isFinite(line.unitCost) ? line.unitCost : 0;
  return Math.max(0, qty * unitCost);
}

function lineUncertaintyPct(line: SensitivityInputLine, defaultUncertaintyPct: number): number {
  if (typeof line.uncertaintyPct === "number" && Number.isFinite(line.uncertaintyPct)) {
    return normalizeCoverage(line.uncertaintyPct);
  }
  if (typeof line.confidence === "number" && Number.isFinite(line.confidence)) {
    return Math.max(0.05, 1 - normalizeCoverage(line.confidence));
  }
  return defaultUncertaintyPct;
}

function normalizeTopK(topK: number | undefined, fallback: number): number {
  if (topK === undefined || !Number.isFinite(topK)) return fallback;
  return Math.max(0, Math.floor(topK));
}

export function buildSensitivityDrivers(
  lines: SensitivityInputLine[],
  options: { defaultUncertaintyPct?: number; topK?: number } = {},
): SensitivityDriver[] {
  const defaultUncertaintyPct = normalizeCoverage(options.defaultUncertaintyPct ?? 0.15);
  const drivers = lines.map((line) => {
    const baseCost = lineBaseCost(line);
    const uncertaintyPct = lineUncertaintyPct(line, defaultUncertaintyPct);
    return {
      id: line.id,
      label: line.label,
      category: line.category,
      baseCost,
      uncertaintyPct: Number(uncertaintyPct.toFixed(4)),
      exposure: Number((baseCost * uncertaintyPct).toFixed(2)),
      contributionPct: 0,
      confidence: line.confidence,
    };
  });

  const totalExposure = drivers.reduce((sum, driver) => sum + driver.exposure, 0);
  const limit = normalizeTopK(options.topK, drivers.length);
  return drivers
    .map((driver) => ({
      ...driver,
      contributionPct: totalExposure > 0 ? Number((driver.exposure / totalExposure).toFixed(4)) : 0,
    }))
    .sort((left, right) => right.exposure - left.exposure)
    .slice(0, limit);
}
