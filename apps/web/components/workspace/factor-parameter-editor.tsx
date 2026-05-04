"use client";

import type { EstimateFactorFormulaType } from "@/lib/api";
import { Badge, Input, Label, Select } from "@/components/ui";

export function factorParameterNumber(parameters: Record<string, unknown>, key: string, fallback = 0) {
  const value = parameters[key];
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
}

function factorParameterString(parameters: Record<string, unknown>, key: string, fallback = "") {
  const value = parameters[key];
  return typeof value === "string" ? value : fallback;
}

function parseNumber(value: string, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function criteriaFromParameters(parameters: Record<string, unknown>) {
  const criteria = Array.isArray(parameters.criteria) ? parameters.criteria : [];
  if (criteria.length > 0) {
    return criteria.map((entry, index) => {
      const record = entry && typeof entry === "object" && !Array.isArray(entry) ? entry as Record<string, unknown> : {};
      return {
        id: String(record.id ?? index + 1),
        condition: String(record.condition ?? `Condition ${index + 1}`),
        considerations: String(record.considerations ?? ""),
        score: Math.max(0, Math.min(5, factorParameterNumber(record, "score", 0))),
      };
    });
  }
  return [];
}

function conditionScorePercent(parameters: Record<string, unknown>) {
  const score = Math.max(0, Math.min(factorParameterNumber(parameters, "maxScore", 5), factorParameterNumber(parameters, "score", 0)));
  const calibrationTotalScore = Math.max(1, factorParameterNumber(parameters, "calibrationTotalScore", 175));
  const calibrationMultiplier = Math.max(0.05, factorParameterNumber(parameters, "calibrationMultiplier", 1.3));
  const multiplier = Math.pow(calibrationMultiplier, score / calibrationTotalScore);
  return Math.round((multiplier - 1) * 10_000) / 100;
}

export function FactorParameterEditor({
  formulaType,
  parameters,
  onChange,
  compact = false,
}: {
  formulaType: EstimateFactorFormulaType;
  parameters: Record<string, unknown>;
  onChange: (parameters: Record<string, unknown>) => void;
  compact?: boolean;
}) {
  const patchParameters = (patch: Record<string, unknown>) => onChange({ ...parameters, ...patch });

  if (formulaType === "temperature_productivity") {
    return (
      <div className={compact ? "grid gap-2" : "grid gap-3 sm:grid-cols-3"}>
        <div className="space-y-1.5">
          <Label>Temperature</Label>
          <Input className="text-right font-mono" value={String(factorParameterNumber(parameters, "temperature", 20))} onChange={(event) => patchParameters({ temperature: parseNumber(event.target.value, 20) })} />
        </div>
        <div className="space-y-1.5">
          <Label>Unit</Label>
          <Select value={factorParameterString(parameters, "temperatureUnit", "C")} onValueChange={(temperatureUnit) => patchParameters({ temperatureUnit })} options={[{ value: "C", label: "Celsius" }, { value: "F", label: "Fahrenheit" }]} />
        </div>
        <div className="space-y-1.5">
          <Label>Humidity</Label>
          <Input className="text-right font-mono" value={String(factorParameterNumber(parameters, "humidity", 60))} onChange={(event) => patchParameters({ humidity: parseNumber(event.target.value, 60) })} />
        </div>
      </div>
    );
  }

  if (formulaType === "condition_score") {
    const condition = factorParameterString(parameters, "condition", "Labor condition");
    const considerations = factorParameterString(parameters, "considerations", "");
    const maxScore = Math.max(1, factorParameterNumber(parameters, "maxScore", 5));
    const score = Math.max(0, Math.min(maxScore, factorParameterNumber(parameters, "score", 0)));
    return (
      <div className="space-y-3 rounded-lg border border-line bg-bg/35 p-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="text-xs font-semibold text-fg">{condition}</div>
            {considerations ? <div className="mt-1 text-[11px] leading-4 text-fg/50">{considerations}</div> : null}
          </div>
          <Badge tone={score > 0 ? "warning" : "default"}>{conditionScorePercent({ ...parameters, score }) >= 0 ? "+" : ""}{conditionScorePercent({ ...parameters, score })}%</Badge>
        </div>
        <div className={compact ? "grid gap-2" : "grid gap-3 sm:grid-cols-3"}>
          <div className="space-y-1.5">
            <Label>Score</Label>
            <Select
              value={String(score)}
              onValueChange={(nextScore) => patchParameters({ score: Number(nextScore) })}
              options={Array.from({ length: Math.floor(maxScore) + 1 }, (_, index) => ({ value: String(index), label: String(index) }))}
            />
          </div>
          <div className="space-y-1.5">
            <Label>Calibrated Score Total</Label>
            <Input className="text-right font-mono" value={String(factorParameterNumber(parameters, "calibrationTotalScore", 175))} onChange={(event) => patchParameters({ calibrationTotalScore: parseNumber(event.target.value, 175) })} />
          </div>
          <div className="space-y-1.5">
            <Label>Full-Scale Multiplier</Label>
            <Input className="text-right font-mono" value={String(factorParameterNumber(parameters, "calibrationMultiplier", 1.3))} onChange={(event) => patchParameters({ calibrationMultiplier: parseNumber(event.target.value, 1.3) })} />
          </div>
        </div>
      </div>
    );
  }

  if (formulaType === "neca_condition_score") {
    const criteria = criteriaFromParameters(parameters);
    const total = criteria.reduce((sum, entry) => sum + entry.score, 0);
    return (
      <div className="space-y-2">
        <div className="flex items-center justify-between rounded-lg border border-line bg-bg/40 px-3 py-2">
          <div className="text-xs font-medium text-fg">Condition score sheet</div>
          <Badge tone={total >= 135 ? "warning" : total >= 76 ? "info" : "default"}>{total} points</Badge>
        </div>
        <div className="max-h-72 overflow-auto rounded-lg border border-line">
          {criteria.map((criterion, index) => (
            <div key={`${criterion.id}-${index}`} className="grid grid-cols-[minmax(0,1fr)_72px] gap-2 border-b border-line/70 px-3 py-2 last:border-b-0">
              <div className="min-w-0">
                <div className="truncate text-xs font-medium text-fg">{criterion.condition}</div>
                {criterion.considerations ? <div className="mt-0.5 line-clamp-1 text-[10px] text-fg/45">{criterion.considerations}</div> : null}
              </div>
              <Select
                value={String(criterion.score)}
                onValueChange={(score) => {
                  const next = criteria.map((entry, entryIndex) => entryIndex === index ? { ...entry, score: Number(score) } : entry);
                  patchParameters({ criteria: next });
                }}
                options={[0, 1, 2, 3, 4, 5].map((score) => ({ value: String(score), label: String(score) }))}
              />
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (formulaType === "extended_duration") {
    return (
      <div className={compact ? "grid gap-2" : "grid gap-3 sm:grid-cols-2"}>
        <div className="space-y-1.5">
          <Label>Months Extended</Label>
          <Input className="text-right font-mono" value={String(factorParameterNumber(parameters, "monthsExtended", 0))} onChange={(event) => patchParameters({ monthsExtended: parseNumber(event.target.value, 0) })} />
        </div>
        <div className="space-y-1.5">
          <Label>Workers</Label>
          <Input className="text-right font-mono" value={parameters.workers == null ? "" : String(factorParameterNumber(parameters, "workers", 0))} onChange={(event) => patchParameters({ workers: event.target.value.trim() ? parseNumber(event.target.value, 0) : null })} placeholder="Interpolate" />
        </div>
      </div>
    );
  }

  if (formulaType === "per_unit_scale") {
    return (
      <div className={compact ? "grid gap-2" : "grid gap-3 sm:grid-cols-4"}>
        <div className="space-y-1.5">
          <Label>Input</Label>
          <Input className="text-right font-mono" value={String(factorParameterNumber(parameters, "input", 0))} onChange={(event) => patchParameters({ input: parseNumber(event.target.value, 0) })} />
        </div>
        <div className="space-y-1.5">
          <Label>Baseline</Label>
          <Input className="text-right font-mono" value={String(factorParameterNumber(parameters, "baseline", 0))} onChange={(event) => patchParameters({ baseline: parseNumber(event.target.value, 0) })} />
        </div>
        <div className="space-y-1.5">
          <Label>Rate</Label>
          <Input className="text-right font-mono" value={String(factorParameterNumber(parameters, "rate", 0))} onChange={(event) => patchParameters({ rate: parseNumber(event.target.value, 0) })} />
        </div>
        <div className="space-y-1.5">
          <Label>Unit Size</Label>
          <Input className="text-right font-mono" value={String(factorParameterNumber(parameters, "unitSize", 1))} onChange={(event) => patchParameters({ unitSize: parseNumber(event.target.value, 1) })} />
        </div>
      </div>
    );
  }

  return null;
}
