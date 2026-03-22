"use client";

import { useState, useCallback, useMemo, useEffect } from "react";
import {
  Plus,
  Minus,
  GripVertical,
  ChevronDown,
  ChevronRight,
  Calculator,
  Search,
  AlertCircle,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  CardTitle,
  FadeIn,
  Input,
  Label,
  Select,
  Textarea,
  Toggle,
} from "@/components/ui";
import type {
  PluginUISchema,
  PluginUISection,
  PluginField,
  PluginTable,
  PluginTableColumn,
  PluginScoring,
  PluginFieldOption,
  PluginFieldConditional,
  PluginOutput,
} from "@/lib/api";

// ── Formula Evaluator ─────────────────────────────────────────────────

function evaluateFormula(formula: string, values: Record<string, unknown>): number {
  try {
    // Replace field references with their values
    let expr = formula;
    for (const [key, val] of Object.entries(values)) {
      const numVal = typeof val === "number" ? val : parseFloat(String(val)) || 0;
      expr = expr.replace(new RegExp(`\\b${key}\\b`, "g"), String(numVal));
    }
    // Handle string comparisons for difficulty-like fields
    for (const [key, val] of Object.entries(values)) {
      if (typeof val === "string") {
        expr = expr.replace(new RegExp(`'${val}'`, "g"), `'${val}'`);
      }
    }
    // Handle ternary and comparison operators safely
    // eslint-disable-next-line no-new-func
    const fn = new Function(
      ...Object.keys(values),
      `"use strict"; try { return (${formula}); } catch { return 0; }`
    );
    const result = fn(
      ...Object.keys(values).map((k) => values[k])
    );
    return typeof result === "number" && isFinite(result) ? result : 0;
  } catch {
    return 0;
  }
}

function formatValue(value: number, format?: string): string {
  switch (format) {
    case "currency":
      return `$${value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    case "hours":
      return `${value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} hrs`;
    case "percentage":
      return `${value.toFixed(1)}%`;
    case "number":
    default:
      return value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 4 });
  }
}

// ── Field Visibility Check ─────────────────────────────────────────────

function evaluateConditional(conditional: PluginFieldConditional, values: Record<string, unknown>): boolean {
  const fieldValue = values[conditional.field];
  switch (conditional.operator) {
    case "eq": return fieldValue === conditional.value;
    case "neq": return fieldValue !== conditional.value;
    case "gt": return Number(fieldValue) > Number(conditional.value);
    case "lt": return Number(fieldValue) < Number(conditional.value);
    case "gte": return Number(fieldValue) >= Number(conditional.value);
    case "lte": return Number(fieldValue) <= Number(conditional.value);
    case "in": return Array.isArray(conditional.value) && conditional.value.includes(fieldValue);
    case "not_in": return Array.isArray(conditional.value) && !conditional.value.includes(fieldValue);
    case "contains": return String(fieldValue).includes(String(conditional.value));
    case "truthy": return Boolean(fieldValue);
    case "falsy": return !fieldValue;
    default: return true;
  }
}

function isFieldVisible(field: PluginField, values: Record<string, unknown>): boolean {
  if (!field.conditionals?.length) return true;
  return field.conditionals.every((c) => {
    if (c.action === "show") return evaluateConditional(c, values);
    if (c.action === "hide") return !evaluateConditional(c, values);
    return true;
  });
}

// ── Width CSS ─────────────────────────────────────────────────────────

const widthClasses: Record<string, string> = {
  full: "col-span-12",
  half: "col-span-6",
  third: "col-span-4",
  quarter: "col-span-3",
};

// ── Field Renderer ────────────────────────────────────────────────────

function PluginFieldRenderer({
  field,
  value,
  onChange,
  allValues,
  error,
}: {
  field: PluginField;
  value: unknown;
  onChange: (value: unknown) => void;
  allValues: Record<string, unknown>;
  error?: string;
}) {
  if (!isFieldVisible(field, allValues)) return null;

  const computedValue = field.type === "computed" && field.computation
    ? evaluateFormula(field.computation.formula, allValues)
    : undefined;

  return (
    <div className={cn(widthClasses[field.width ?? "full"], "space-y-1")}>
      <Label htmlFor={field.id}>
        {field.label}
        {field.validation?.required && <span className="text-danger ml-0.5">*</span>}
      </Label>
      {field.description && (
        <p className="text-[10px] text-fg/40 -mt-0.5 mb-1">{field.description}</p>
      )}

      {field.type === "text" && (
        <Input
          id={field.id}
          value={String(value ?? "")}
          onChange={(e) => onChange(e.target.value)}
          placeholder={field.placeholder}
        />
      )}

      {field.type === "number" && (
        <Input
          id={field.id}
          type="number"
          value={value !== undefined && value !== null ? String(value) : ""}
          onChange={(e) => onChange(e.target.value ? parseFloat(e.target.value) : undefined)}
          placeholder={field.placeholder}
          min={field.validation?.min}
          max={field.validation?.max}
          step="any"
        />
      )}

      {field.type === "currency" && (
        <div className="relative">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs text-fg/40">$</span>
          <Input
            id={field.id}
            type="number"
            className="pl-7"
            value={value !== undefined && value !== null ? String(value) : ""}
            onChange={(e) => onChange(e.target.value ? parseFloat(e.target.value) : undefined)}
            placeholder={field.placeholder ?? "0.00"}
            step="0.01"
            min={field.validation?.min}
          />
        </div>
      )}

      {field.type === "percentage" && (
        <div className="relative">
          <Input
            id={field.id}
            type="number"
            className="pr-7"
            value={value !== undefined && value !== null ? String(value) : ""}
            onChange={(e) => onChange(e.target.value ? parseFloat(e.target.value) : undefined)}
            placeholder={field.placeholder ?? "0"}
            step="0.1"
          />
          <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-fg/40">%</span>
        </div>
      )}

      {field.type === "select" && (
        <Select
          id={field.id}
          value={String(value ?? "")}
          onChange={(e) => onChange(e.target.value)}
        >
          <option value="">{field.placeholder ?? "Select..."}</option>
          {(field.options ?? []).map((opt) => (
            <option key={opt.value} value={opt.value} disabled={opt.disabled}>
              {opt.label}
            </option>
          ))}
        </Select>
      )}

      {field.type === "multi-select" && (
        <select
          id={field.id}
          multiple
          className="h-auto min-h-[80px] w-full rounded-lg border border-line bg-bg/50 px-3 py-2 text-sm text-fg outline-none"
          value={Array.isArray(value) ? value.map(String) : []}
          onChange={(e) => {
            const selected = Array.from(e.target.selectedOptions).map((o) => o.value);
            onChange(selected);
          }}
        >
          {(field.options ?? []).map((opt) => (
            <option key={opt.value} value={opt.value}>{opt.label}</option>
          ))}
        </select>
      )}

      {field.type === "radio" && (
        <div className="flex flex-wrap gap-2">
          {(field.options ?? []).map((opt) => (
            <button
              key={opt.value}
              type="button"
              onClick={() => onChange(opt.value)}
              className={cn(
                "rounded-lg border px-3 py-2 text-xs transition-all",
                value === opt.value
                  ? "border-accent/50 bg-accent/10 text-accent"
                  : "border-line bg-bg/50 text-fg/60 hover:border-fg/30"
              )}
            >
              <span className="font-medium">{opt.label}</span>
              {opt.description && (
                <span className="block text-[10px] text-fg/40 mt-0.5">{opt.description}</span>
              )}
            </button>
          ))}
        </div>
      )}

      {field.type === "slider" && (
        <div className="flex items-center gap-3">
          <input
            id={field.id}
            type="range"
            className="flex-1 accent-accent"
            value={Number(value ?? field.defaultValue ?? 1)}
            onChange={(e) => onChange(parseFloat(e.target.value))}
            min={field.validation?.min ?? 0}
            max={field.validation?.max ?? 100}
            step={0.1}
          />
          <span className="text-xs font-mono text-fg/60 w-10 text-right">
            {Number(value ?? field.defaultValue ?? 1).toFixed(1)}
          </span>
        </div>
      )}

      {field.type === "date" && (
        <Input
          id={field.id}
          type="date"
          value={String(value ?? "")}
          onChange={(e) => onChange(e.target.value)}
        />
      )}

      {field.type === "textarea" && (
        <Textarea
          id={field.id}
          value={String(value ?? "")}
          onChange={(e) => onChange(e.target.value)}
          placeholder={field.placeholder}
        />
      )}

      {field.type === "boolean" && (
        <div className="flex items-center gap-2">
          <Toggle
            checked={Boolean(value ?? field.defaultValue)}
            onChange={(v) => onChange(v)}
          />
          <span className="text-xs text-fg/60">{value ? "Yes" : "No"}</span>
        </div>
      )}

      {field.type === "computed" && computedValue !== undefined && (
        <div className="flex items-center gap-2 rounded-lg border border-accent/20 bg-accent/5 px-3 py-2">
          <Calculator className="h-3.5 w-3.5 text-accent/60" />
          <span className="text-sm font-mono font-medium text-accent">
            {formatValue(computedValue, field.computation?.format)}
          </span>
        </div>
      )}

      {field.type === "search" && (
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-fg/30" />
          <Input
            id={field.id}
            className="pl-9"
            value={String(value ?? "")}
            onChange={(e) => onChange(e.target.value)}
            placeholder={field.placeholder}
          />
        </div>
      )}

      {field.type === "hidden" && (
        <input type="hidden" id={field.id} value={String(value ?? "")} />
      )}

      {error && (
        <p className="text-[10px] text-danger flex items-center gap-1">
          <AlertCircle className="h-3 w-3" />
          {error}
        </p>
      )}
    </div>
  );
}

// ── Table Renderer ────────────────────────────────────────────────────

function PluginTableRenderer({
  table,
  rows,
  onRowsChange,
  allValues,
}: {
  table: PluginTable;
  rows: Record<string, unknown>[];
  onRowsChange: (rows: Record<string, unknown>[]) => void;
  allValues: Record<string, unknown>;
}) {
  const addRow = useCallback(() => {
    onRowsChange([...rows, { ...table.rowTemplate }]);
  }, [rows, table.rowTemplate, onRowsChange]);

  const deleteRow = useCallback((idx: number) => {
    onRowsChange(rows.filter((_, i) => i !== idx));
  }, [rows, onRowsChange]);

  const updateCell = useCallback((rowIdx: number, colId: string, value: unknown) => {
    const updated = rows.map((row, i) => {
      if (i !== rowIdx) return row;
      const newRow = { ...row, [colId]: value };
      // Recompute computed columns
      for (const col of table.columns) {
        if (col.type === "computed" && col.computation) {
          newRow[col.id] = evaluateFormula(col.computation.formula, newRow);
        }
      }
      return newRow;
    });
    onRowsChange(updated);
  }, [rows, table.columns, onRowsChange]);

  // Calculate aggregates
  const aggregates = useMemo(() => {
    const agg: Record<string, number> = {};
    for (const col of table.columns) {
      if (col.aggregate) {
        const vals = rows.map((r) => Number(r[col.id]) || 0);
        switch (col.aggregate) {
          case "sum": agg[col.id] = vals.reduce((a, b) => a + b, 0); break;
          case "avg": agg[col.id] = vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : 0; break;
          case "min": agg[col.id] = vals.length ? Math.min(...vals) : 0; break;
          case "max": agg[col.id] = vals.length ? Math.max(...vals) : 0; break;
          case "count": agg[col.id] = vals.length; break;
        }
      }
    }
    return agg;
  }, [rows, table.columns]);

  return (
    <div className="space-y-2">
      <div className="overflow-x-auto rounded-lg border border-line">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-line bg-panel2/50">
              {table.allowReorder && <th className="w-8 px-1" />}
              {table.columns.map((col) => (
                <th
                  key={col.id}
                  className="px-3 py-2 text-left font-medium text-fg/60"
                  style={{ width: col.width }}
                >
                  {col.label}
                </th>
              ))}
              {table.allowDeleteRow && <th className="w-8 px-1" />}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, rowIdx) => (
              <tr key={rowIdx} className="border-b border-line/50 hover:bg-panel2/30">
                {table.allowReorder && (
                  <td className="px-1 text-center">
                    <GripVertical className="h-3 w-3 text-fg/20 cursor-grab" />
                  </td>
                )}
                {table.columns.map((col) => (
                  <td key={col.id} className="px-1 py-1">
                    {col.type === "computed" ? (
                      <span className="px-2 text-xs font-mono text-accent">
                        {formatValue(Number(row[col.id]) || 0, col.computation?.format)}
                      </span>
                    ) : col.type === "select" ? (
                      <select
                        className="h-7 w-full rounded border border-line/50 bg-transparent px-2 text-xs text-fg outline-none focus:border-accent/50"
                        value={String(row[col.id] ?? "")}
                        onChange={(e) => updateCell(rowIdx, col.id, e.target.value)}
                        disabled={!col.editable}
                      >
                        <option value="">Select...</option>
                        {(col.options ?? []).map((opt) => (
                          <option key={opt.value} value={opt.value}>{opt.label}</option>
                        ))}
                      </select>
                    ) : col.type === "number" || col.type === "currency" ? (
                      <input
                        type="number"
                        className="h-7 w-full rounded border border-line/50 bg-transparent px-2 text-xs text-fg outline-none focus:border-accent/50 font-mono"
                        value={row[col.id] !== undefined ? String(row[col.id]) : ""}
                        onChange={(e) => updateCell(rowIdx, col.id, e.target.value ? parseFloat(e.target.value) : 0)}
                        disabled={!col.editable}
                        step="any"
                      />
                    ) : (
                      <input
                        type="text"
                        className="h-7 w-full rounded border border-line/50 bg-transparent px-2 text-xs text-fg outline-none focus:border-accent/50"
                        value={String(row[col.id] ?? "")}
                        onChange={(e) => updateCell(rowIdx, col.id, e.target.value)}
                        disabled={!col.editable}
                      />
                    )}
                  </td>
                ))}
                {table.allowDeleteRow && (
                  <td className="px-1 text-center">
                    <button
                      type="button"
                      onClick={() => deleteRow(rowIdx)}
                      className="rounded p-0.5 text-fg/30 hover:text-danger transition-colors"
                    >
                      <Minus className="h-3 w-3" />
                    </button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
          {table.totalsRow && (
            <tfoot>
              <tr className="bg-panel2/30 font-medium">
                {table.allowReorder && <td />}
                {table.columns.map((col) => (
                  <td key={col.id} className="px-3 py-2">
                    {col.aggregate && aggregates[col.id] !== undefined ? (
                      <span className="text-xs font-mono text-accent font-semibold">
                        {formatValue(aggregates[col.id], col.computation?.format ?? "number")}
                      </span>
                    ) : col === table.columns[0] ? (
                      <span className="text-xs text-fg/50">Total</span>
                    ) : null}
                  </td>
                ))}
                {table.allowDeleteRow && <td />}
              </tr>
            </tfoot>
          )}
        </table>
      </div>
      {table.allowAddRow && (
        <Button
          type="button"
          variant="ghost"
          size="xs"
          onClick={addRow}
          disabled={table.maxRows !== undefined && rows.length >= table.maxRows}
        >
          <Plus className="h-3 w-3" />
          Add Row
        </Button>
      )}
    </div>
  );
}

// ── Scoring Renderer ──────────────────────────────────────────────────

function PluginScoringRenderer({
  scoring,
  scores,
  onScoresChange,
}: {
  scoring: PluginScoring;
  scores: Record<string, number>;
  onScoresChange: (scores: Record<string, number>) => void;
}) {
  const totalWeightedScore = useMemo(() => {
    let total = 0;
    let totalWeight = 0;
    for (const criterion of scoring.criteria) {
      const score = scores[criterion.id] ?? criterion.scale.min;
      total += score * criterion.weight;
      totalWeight += criterion.scale.max * criterion.weight;
    }
    return totalWeight > 0 ? (total / totalWeight) * 100 : 0;
  }, [scores, scoring.criteria]);

  const currentResult = useMemo(() => {
    return scoring.resultMapping.find(
      (r) => totalWeightedScore >= r.minScore && totalWeightedScore <= r.maxScore
    ) ?? scoring.resultMapping[0];
  }, [totalWeightedScore, scoring.resultMapping]);

  return (
    <div className="space-y-4">
      {scoring.description && (
        <p className="text-xs text-fg/50">{scoring.description}</p>
      )}

      <div className="space-y-3">
        {scoring.criteria.map((criterion) => {
          const value = scores[criterion.id] ?? criterion.scale.min;
          return (
            <div key={criterion.id} className="space-y-1">
              <div className="flex items-center justify-between">
                <div>
                  <span className="text-xs font-medium text-fg/80">{criterion.label}</span>
                  {criterion.description && (
                    <span className="text-[10px] text-fg/40 ml-2">{criterion.description}</span>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-[10px] text-fg/40">
                    {criterion.scale.labels?.[value] ?? ""}
                  </span>
                  <Badge tone="info" className="text-[10px] font-mono">{value}</Badge>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-[10px] text-fg/40 w-6 text-center">
                  {criterion.scale.labels?.[criterion.scale.min] ?? criterion.scale.min}
                </span>
                <input
                  type="range"
                  className="flex-1 accent-accent"
                  value={value}
                  onChange={(e) =>
                    onScoresChange({ ...scores, [criterion.id]: parseInt(e.target.value) })
                  }
                  min={criterion.scale.min}
                  max={criterion.scale.max}
                  step={criterion.scale.step}
                />
                <span className="text-[10px] text-fg/40 w-6 text-center">
                  {criterion.scale.labels?.[criterion.scale.max] ?? criterion.scale.max}
                </span>
              </div>
            </div>
          );
        })}
      </div>

      {/* Result Display */}
      <div
        className="rounded-lg border px-4 py-3 flex items-center justify-between"
        style={{
          borderColor: currentResult?.color ? `${currentResult.color}40` : undefined,
          backgroundColor: currentResult?.color ? `${currentResult.color}10` : undefined,
        }}
      >
        <div>
          <span className="text-sm font-semibold" style={{ color: currentResult?.color }}>
            {currentResult?.label}
          </span>
          {currentResult?.description && (
            <p className="text-[11px] text-fg/50 mt-0.5">{currentResult.description}</p>
          )}
        </div>
        <div className="text-right">
          <span className="text-lg font-mono font-bold" style={{ color: currentResult?.color }}>
            {totalWeightedScore.toFixed(1)}
          </span>
          <p className="text-[10px] text-fg/40">weighted score</p>
        </div>
      </div>
    </div>
  );
}

// ── Section Renderer ──────────────────────────────────────────────────

function PluginSectionRenderer({
  section,
  values,
  onChange,
  tableData,
  onTableDataChange,
  scoringData,
  onScoringDataChange,
}: {
  section: PluginUISection;
  values: Record<string, unknown>;
  onChange: (fieldId: string, value: unknown) => void;
  tableData: Record<string, Record<string, unknown>[]>;
  onTableDataChange: (tableId: string, rows: Record<string, unknown>[]) => void;
  scoringData: Record<string, Record<string, number>>;
  onScoringDataChange: (scoringId: string, scores: Record<string, number>) => void;
}) {
  const [collapsed, setCollapsed] = useState(false);

  return (
    <div className="space-y-3">
      {section.label && (
        <button
          type="button"
          className="flex items-center gap-2 w-full text-left"
          onClick={() => setCollapsed(!collapsed)}
        >
          {collapsed ? (
            <ChevronRight className="h-3.5 w-3.5 text-fg/40" />
          ) : (
            <ChevronDown className="h-3.5 w-3.5 text-fg/40" />
          )}
          <span className="text-xs font-semibold text-fg/70 uppercase tracking-wide">
            {section.label}
          </span>
          {section.description && (
            <span className="text-[10px] text-fg/40 font-normal normal-case tracking-normal">
              — {section.description}
            </span>
          )}
        </button>
      )}

      {!collapsed && (
        <FadeIn>
          {(section.type === "fields" || section.type === "search") && section.fields && (
            <div className="grid grid-cols-12 gap-3">
              {section.fields
                .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
                .map((field) => (
                  <PluginFieldRenderer
                    key={field.id}
                    field={field}
                    value={values[field.id]}
                    onChange={(v) => onChange(field.id, v)}
                    allValues={values}
                  />
                ))}
            </div>
          )}

          {section.type === "table" && section.table && (
            <PluginTableRenderer
              table={section.table}
              rows={tableData[section.table.id] ?? section.table.defaultRows ?? []}
              onRowsChange={(rows) => onTableDataChange(section.table!.id, rows)}
              allValues={values}
            />
          )}

          {section.type === "scoring" && section.scoring && (
            <PluginScoringRenderer
              scoring={section.scoring}
              scores={scoringData[section.scoring.id] ?? {}}
              onScoresChange={(scores) => onScoringDataChange(section.scoring!.id, scores)}
            />
          )}

          {section.type === "preview" && (
            <div className="rounded-lg border border-line bg-bg/50 p-4 min-h-[120px]">
              <p className="text-xs text-fg/30 italic">
                Preview will be generated after submission...
              </p>
            </div>
          )}

          {section.type === "summary" && (
            <div className="rounded-lg border border-line bg-panel2/30 p-4">
              <p className="text-xs text-fg/50">Output summary will appear here after execution.</p>
            </div>
          )}
        </FadeIn>
      )}
    </div>
  );
}

// ── Main Plugin Runtime ───────────────────────────────────────────────

export interface PluginRuntimeProps {
  schema: PluginUISchema;
  initialValues?: Record<string, unknown>;
  initialTableData?: Record<string, Record<string, unknown>[]>;
  initialScoringData?: Record<string, Record<string, number>>;
  onSubmit: (data: {
    values: Record<string, unknown>;
    tableData: Record<string, Record<string, unknown>[]>;
    scoringData: Record<string, Record<string, number>>;
  }) => void;
  onCancel?: () => void;
  submitting?: boolean;
  output?: PluginOutput | null;
}

export function PluginRuntime({
  schema,
  initialValues,
  initialTableData,
  initialScoringData,
  onSubmit,
  onCancel,
  submitting,
  output,
}: PluginRuntimeProps) {
  const [values, setValues] = useState<Record<string, unknown>>(initialValues ?? {});
  const [tableData, setTableData] = useState<Record<string, Record<string, unknown>[]>>(initialTableData ?? {});
  const [scoringData, setScoringData] = useState<Record<string, Record<string, number>>>(initialScoringData ?? {});
  const [errors, setErrors] = useState<Record<string, string>>({});

  // Initialize default values from schema
  useEffect(() => {
    const defaults: Record<string, unknown> = {};
    const tableDefs: Record<string, Record<string, unknown>[]> = {};
    for (const section of schema.sections) {
      if (section.fields) {
        for (const field of section.fields) {
          if (field.defaultValue !== undefined && values[field.id] === undefined) {
            defaults[field.id] = field.defaultValue;
          }
        }
      }
      if (section.table?.defaultRows && !tableData[section.table.id]) {
        tableDefs[section.table.id] = [...section.table.defaultRows];
      }
    }
    if (Object.keys(defaults).length > 0) {
      setValues((v) => ({ ...defaults, ...v }));
    }
    if (Object.keys(tableDefs).length > 0) {
      setTableData((t) => ({ ...tableDefs, ...t }));
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleFieldChange = useCallback((fieldId: string, value: unknown) => {
    setValues((prev) => {
      const next = { ...prev, [fieldId]: value };
      // Recompute all computed fields
      for (const section of schema.sections) {
        if (section.fields) {
          for (const field of section.fields) {
            if (field.type === "computed" && field.computation) {
              next[field.id] = evaluateFormula(field.computation.formula, next);
            }
          }
        }
      }
      return next;
    });
    // Clear error for this field
    if (errors[fieldId]) {
      setErrors((e) => {
        const { [fieldId]: _, ...rest } = e;
        return rest;
      });
    }
  }, [schema.sections, errors]);

  const handleTableDataChange = useCallback((tableId: string, rows: Record<string, unknown>[]) => {
    setTableData((prev) => ({ ...prev, [tableId]: rows }));
  }, []);

  const handleScoringDataChange = useCallback((scoringId: string, scores: Record<string, number>) => {
    setScoringData((prev) => ({ ...prev, [scoringId]: scores }));
  }, []);

  const validate = useCallback((): boolean => {
    const newErrors: Record<string, string> = {};
    for (const section of schema.sections) {
      if (!section.fields) continue;
      for (const field of section.fields) {
        if (!isFieldVisible(field, values)) continue;
        if (field.type === "computed" || field.type === "hidden") continue;
        const val = values[field.id];
        if (field.validation?.required && (val === undefined || val === null || val === "")) {
          newErrors[field.id] = `${field.label} is required`;
        }
        if (field.validation?.min !== undefined && typeof val === "number" && val < field.validation.min) {
          newErrors[field.id] = `${field.label} must be at least ${field.validation.min}`;
        }
        if (field.validation?.max !== undefined && typeof val === "number" && val > field.validation.max) {
          newErrors[field.id] = `${field.label} must be at most ${field.validation.max}`;
        }
        if (field.validation?.minLength !== undefined && typeof val === "string" && val.length < field.validation.minLength) {
          newErrors[field.id] = `${field.label} must be at least ${field.validation.minLength} characters`;
        }
      }
    }
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  }, [schema.sections, values]);

  const handleSubmit = useCallback(() => {
    if (!validate()) return;
    onSubmit({ values, tableData, scoringData });
  }, [validate, onSubmit, values, tableData, scoringData]);

  const sortedSections = useMemo(
    () => [...schema.sections].sort((a, b) => (a.order ?? 0) - (b.order ?? 0)),
    [schema.sections]
  );

  return (
    <div className="space-y-5">
      {sortedSections.map((section) => (
        <PluginSectionRenderer
          key={section.id}
          section={section}
          values={values}
          onChange={handleFieldChange}
          tableData={tableData}
          onTableDataChange={handleTableDataChange}
          scoringData={scoringData}
          onScoringDataChange={handleScoringDataChange}
        />
      ))}

      {/* Output Display */}
      {output && <PluginOutputDisplay output={output} />}

      {/* Actions */}
      <div className="flex items-center justify-end gap-2 pt-2 border-t border-line">
        {onCancel && (
          <Button variant="ghost" size="sm" onClick={onCancel} disabled={submitting}>
            {schema.cancelLabel ?? "Cancel"}
          </Button>
        )}
        <Button variant="accent" size="sm" onClick={handleSubmit} disabled={submitting}>
          {submitting ? "Processing..." : schema.submitLabel ?? "Submit"}
        </Button>
      </div>
    </div>
  );
}

// ── Plugin Output Display ─────────────────────────────────────────────

export function PluginOutputDisplay({ output }: { output: PluginOutput }) {
  return (
    <FadeIn>
      <div className="rounded-lg border border-success/20 bg-success/5 p-4 space-y-3">
        {output.displayText && (
          <p className="text-xs text-success font-medium">{output.displayText}</p>
        )}

        {output.type === "line_items" && output.lineItems && output.lineItems.length > 0 && (
          <div className="space-y-1">
            <p className="text-[10px] text-fg/50 font-medium uppercase tracking-wide">
              Line Items ({output.lineItems.length})
            </p>
            <div className="overflow-x-auto rounded border border-line/50">
              <table className="w-full text-[11px]">
                <thead>
                  <tr className="border-b border-line/30 bg-panel2/30">
                    <th className="px-2 py-1 text-left text-fg/50">Category</th>
                    <th className="px-2 py-1 text-left text-fg/50">Description</th>
                    <th className="px-2 py-1 text-right text-fg/50">Qty</th>
                    <th className="px-2 py-1 text-right text-fg/50">Cost</th>
                    <th className="px-2 py-1 text-right text-fg/50">Price</th>
                  </tr>
                </thead>
                <tbody>
                  {output.lineItems.map((item, i) => (
                    <tr key={i} className="border-b border-line/20">
                      <td className="px-2 py-1 text-fg/60">{item.category}</td>
                      <td className="px-2 py-1 text-fg/80">{item.description}</td>
                      <td className="px-2 py-1 text-right font-mono text-fg/60">
                        {item.quantity} {item.uom}
                      </td>
                      <td className="px-2 py-1 text-right font-mono text-fg/60">
                        {item.cost !== undefined ? `$${item.cost.toFixed(2)}` : "—"}
                      </td>
                      <td className="px-2 py-1 text-right font-mono text-fg/80">
                        {item.price !== undefined ? `$${item.price.toFixed(2)}` : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {output.type === "text_content" && output.textContent && (
          <div className="space-y-1">
            <p className="text-[10px] text-fg/50 font-medium">
              Output → {output.textContent.targetField}
            </p>
            <div className="rounded border border-line/50 bg-bg/50 p-3 text-xs text-fg/80 whitespace-pre-wrap max-h-48 overflow-y-auto">
              {output.textContent.content}
            </div>
          </div>
        )}

        {output.type === "revision_patch" && output.revisionPatches && (
          <div className="space-y-1">
            <p className="text-[10px] text-fg/50 font-medium uppercase tracking-wide">
              Revision Updates
            </p>
            {output.revisionPatches.map((patch, i) => (
              <div key={i} className="flex items-center justify-between rounded bg-panel2/30 px-3 py-1.5">
                <span className="text-xs text-fg/60">{patch.field}</span>
                <span className="text-xs font-mono text-accent">{String(patch.value)}</span>
              </div>
            ))}
          </div>
        )}

        {output.type === "score" && output.scores && (
          <div className="space-y-1">
            <p className="text-[10px] text-fg/50 font-medium uppercase tracking-wide">Scores</p>
            {output.scores.map((score, i) => (
              <div key={i} className="flex items-center justify-between rounded bg-panel2/30 px-3 py-1.5">
                <span className="text-xs text-fg/60">{score.label}</span>
                <span className="text-xs font-mono text-accent">
                  {score.score}/{score.maxScore}
                </span>
              </div>
            ))}
          </div>
        )}

        {output.type === "summary" && output.summary && (
          <div className="space-y-1">
            <p className="text-xs font-medium text-fg/70">{output.summary.title}</p>
            {output.summary.sections.map((sec, i) => (
              <div key={i} className="flex items-center justify-between rounded bg-panel2/30 px-3 py-1.5">
                <span className="text-xs text-fg/60">{sec.label}</span>
                <span className="text-xs font-mono text-fg/80">
                  {sec.format === "currency"
                    ? `$${Number(sec.value).toFixed(2)}`
                    : sec.format === "hours"
                    ? `${Number(sec.value).toFixed(2)} hrs`
                    : sec.format === "percentage"
                    ? `${Number(sec.value).toFixed(1)}%`
                    : String(sec.value)}
                </span>
              </div>
            ))}
          </div>
        )}

        {output.type === "composite" && output.children && (
          <div className="space-y-3">
            {output.children.map((child, i) => (
              <PluginOutputDisplay key={i} output={child} />
            ))}
          </div>
        )}
      </div>
    </FadeIn>
  );
}
