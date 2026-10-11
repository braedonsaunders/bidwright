export function scoreSavedOutcome(input: {
  runCompleted: boolean; sourceReady: boolean; extractedSources: number; failedTools: number; maxToolFailures: number;
  estimating: boolean; items: number; minItems: number; pricedItems: number; total: number | null;
  referenceAccuracy?: number; defects: number; findings: number;
}) {
  const completeness = input.estimating
    ? (Math.min(1, input.items / Math.max(1, input.minItems)) +
      (input.items ? input.pricedItems / input.items : 0) + (input.total !== null && input.total > 0 ? 1 : 0)) / 3
    : 1;
  const reference = input.referenceAccuracy;
  const bands = {
    completion: input.runCompleted ? 25 : 0,
    sourceAvailability: input.sourceReady ? 10 : 0,
    toolHealth: 15 / (1 + Math.max(0, input.failedTools - input.maxToolFailures)),
    estimateCompleteness: completeness * (reference === undefined ? 40 : 20),
    sourceAgreement: 10 / (1 + input.defects),
    ...(reference === undefined ? {} : { referenceAccuracy: Math.max(0, Math.min(1, reference)) * 20 }),
  };
  const score = Math.round(Object.values(bands).reduce((sum, value) => sum + value, 0) * 10) / 10;
  const grade = !input.runCompleted || (input.estimating && input.items === 0) || input.extractedSources === 0 || score < 60 ? "fail"
    : score < 85 || input.findings > 0 || input.defects > 0 ? "needs_review" : "pass";
  return { score, grade, bands } as { score: number; grade: "fail" | "needs_review" | "pass"; bands: Record<string, number> };
}
