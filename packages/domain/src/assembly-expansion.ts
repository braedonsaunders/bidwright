// Expansion engine for assemblies.
//
// An assembly is a reusable kit composed of catalog items, rate-schedule items,
// labor units, cost intelligence costs, and nested sub-assemblies. Every component carries a `quantityExpr` — either
// a literal number or an expression like `wallHeight * 2 + 1` that references
// the assembly's named parameters. Sub-assembly components additionally carry
// `parameterBindings`, expressions evaluated in the parent scope that supply
// values for the child assembly's parameters.
//
// Expansion produces a flat list of leaf components along with their resolved quantities, ready to be snapshotted into
// WorksheetItem rows. The engine is pure — no I/O — so callers must build a
// lookup context up-front.

export interface AssemblyParameterDefinition {
  key: string;
  label?: string;
  defaultValue: string;
  paramType?: string;
  unit?: string;
}

export interface AssemblyComponentDefinition {
  id: string;
  componentType: "catalog_item" | "rate_schedule_item" | "labor_unit" | "cost_intelligence" | "sub_assembly";
  catalogItemId?: string | null;
  rateScheduleItemId?: string | null;
  laborUnitId?: string | null;
  laborDifficulty?: "normal" | "difficult" | "very_difficult" | string | null;
  costResourceId?: string | null;
  effectiveCostId?: string | null;
  subAssemblyId?: string | null;
  quantityExpr: string;
  description?: string;
  category?: string;
  uomOverride?: string | null;
  costOverride?: number | null;
  markupOverride?: number | null;
  parameterBindings?: Record<string, string>;
  notes?: string;
  sortOrder?: number;
}

export interface AssemblyDefinition {
  id: string;
  name: string;
  unit?: string;
  parameters: AssemblyParameterDefinition[];
  components: AssemblyComponentDefinition[];
}

export interface CatalogItemRef {
  id: string;
  code?: string;
  name: string;
  unit?: string;
  unitCost: number;
  unitPrice: number;
}

export interface RateScheduleItemRef {
  id: string;
  code?: string;
  name: string;
  unit?: string;
  rates?: Record<string, number>;
  costRates?: Record<string, number>;
}

export interface LaborUnitRef {
  id: string;
  code?: string;
  name: string;
  description?: string;
  category?: string;
  className?: string;
  subClassName?: string;
  outputUom?: string;
  hoursNormal: number;
  hoursDifficult?: number | null;
  hoursVeryDifficult?: number | null;
  defaultDifficulty?: "normal" | "difficult" | "very_difficult" | string | null;
  entityCategoryType?: string | null;
}

export interface EffectiveCostRef {
  id: string;
  resourceId?: string | null;
  catalogItemId?: string | null;
  code?: string;
  name: string;
  description?: string;
  category?: string;
  resourceType?: string;
  defaultUom?: string;
  uom: string;
  unitCost: number;
  unitPrice?: number | null;
  vendorName?: string;
  region?: string;
  method?: string;
  effectiveDate?: string | null;
  confidence?: number | null;
}

export interface ExpansionContext {
  assemblies: ReadonlyMap<string, AssemblyDefinition>;
  catalogItems: ReadonlyMap<string, CatalogItemRef>;
  rateScheduleItems: ReadonlyMap<string, RateScheduleItemRef>;
  laborUnits?: ReadonlyMap<string, LaborUnitRef>;
  effectiveCosts?: ReadonlyMap<string, EffectiveCostRef>;
}

export interface ExpandedComponent {
  componentPath: string[];
  componentType: "catalog_item" | "rate_schedule_item" | "labor_unit" | "cost_intelligence";
  catalogItemId?: string;
  rateScheduleItemId?: string;
  laborUnitId?: string;
  costResourceId?: string;
  effectiveCostId?: string;
  category: string;
  entityType: string;
  entityName: string;
  description: string;
  quantity: number;
  uom: string;
  unit1?: number;
  unit2?: number;
  unit3?: number;
  tierUnits?: Record<string, number>;
  unitCost: number;
  unitPrice: number;
  markup: number;
  vendor?: string;
  notes: string;
  sortOrder: number;
}

export interface AssemblyResourceRollup {
  key: string;
  componentType: "catalog_item" | "rate_schedule_item" | "labor_unit" | "cost_intelligence" | "mixed";
  catalogItemId?: string;
  rateScheduleItemId?: string;
  laborUnitId?: string;
  costResourceId?: string;
  effectiveCostId?: string;
  category: string;
  entityName: string;
  uom: string;
  quantity: number;
  lineCost: number;
  linePrice: number;
  averageUnitCost: number;
  averageUnitPrice: number;
  componentCount: number;
  componentPaths: string[][];
}

export interface ExpansionResult {
  items: ExpandedComponent[];
  warnings: string[];
}

// ── Expression evaluator ──────────────────────────────────────────────────

const FUNCTIONS: Record<string, (...args: number[]) => number> = {
  min: (...args) => Math.min(...args),
  max: (...args) => Math.max(...args),
  ceil: (x) => Math.ceil(x),
  floor: (x) => Math.floor(x),
  round: (x) => Math.round(x),
  abs: (x) => Math.abs(x),
  sqrt: (x) => Math.sqrt(x),
  pow: (x, y) => Math.pow(x, y),
};

interface Lexer {
  text: string;
  pos: number;
}

function skipWs(lex: Lexer): void {
  while (lex.pos < lex.text.length && /\s/.test(lex.text[lex.pos]!)) lex.pos++;
}

function peek(lex: Lexer): string {
  skipWs(lex);
  return lex.text[lex.pos] ?? "";
}

function consume(lex: Lexer, ch: string): boolean {
  skipWs(lex);
  if (lex.text[lex.pos] === ch) {
    lex.pos++;
    return true;
  }
  return false;
}

function readNumber(lex: Lexer): number {
  skipWs(lex);
  const start = lex.pos;
  while (lex.pos < lex.text.length && /[0-9.]/.test(lex.text[lex.pos]!)) lex.pos++;
  if (start === lex.pos) throw new Error(`Expected number at position ${start}`);
  return parseFloat(lex.text.slice(start, lex.pos));
}

function readIdent(lex: Lexer): string | null {
  skipWs(lex);
  const start = lex.pos;
  if (lex.pos >= lex.text.length || !/[a-zA-Z_]/.test(lex.text[lex.pos]!)) return null;
  lex.pos++;
  while (lex.pos < lex.text.length && /[a-zA-Z0-9_]/.test(lex.text[lex.pos]!)) lex.pos++;
  return lex.text.slice(start, lex.pos);
}

function parseExpr(lex: Lexer, scope: Record<string, number>): number {
  let left = parseTerm(lex, scope);
  while (true) {
    const ch = peek(lex);
    if (ch === "+") {
      lex.pos++;
      left += parseTerm(lex, scope);
    } else if (ch === "-") {
      lex.pos++;
      left -= parseTerm(lex, scope);
    } else {
      break;
    }
  }
  return left;
}

function parseTerm(lex: Lexer, scope: Record<string, number>): number {
  let left = parseFactor(lex, scope);
  while (true) {
    const ch = peek(lex);
    if (ch === "*") {
      lex.pos++;
      left *= parseFactor(lex, scope);
    } else if (ch === "/") {
      lex.pos++;
      const right = parseFactor(lex, scope);
      if (right === 0) throw new Error("Division by zero");
      left /= right;
    } else {
      break;
    }
  }
  return left;
}

function parseFactor(lex: Lexer, scope: Record<string, number>): number {
  const ch = peek(lex);
  if (ch === "+") {
    lex.pos++;
    return parseFactor(lex, scope);
  }
  if (ch === "-") {
    lex.pos++;
    return -parseFactor(lex, scope);
  }
  if (ch === "(") {
    lex.pos++;
    const v = parseExpr(lex, scope);
    if (!consume(lex, ")")) throw new Error("Expected ')'");
    return v;
  }
  if (/[0-9.]/.test(ch)) {
    return readNumber(lex);
  }
  const ident = readIdent(lex);
  if (ident) {
    if (peek(lex) === "(") {
      lex.pos++;
      const args: number[] = [];
      if (peek(lex) !== ")") {
        args.push(parseExpr(lex, scope));
        while (consume(lex, ",")) args.push(parseExpr(lex, scope));
      }
      if (!consume(lex, ")")) throw new Error("Expected ')'");
      const fn = FUNCTIONS[ident];
      if (!fn) throw new Error(`Unknown function "${ident}"`);
      return fn(...args);
    }
    const v = scope[ident];
    if (v === undefined) throw new Error(`Unknown identifier "${ident}"`);
    return v;
  }
  throw new Error(`Unexpected character "${ch}" at position ${lex.pos}`);
}

export function evalExpression(expr: string, scope: Record<string, number>): number {
  const trimmed = (expr ?? "").trim();
  if (trimmed.length === 0) return 0;
  const lex: Lexer = { text: trimmed, pos: 0 };
  const result = parseExpr(lex, scope);
  skipWs(lex);
  if (lex.pos < lex.text.length) {
    throw new Error(`Unexpected trailing input "${lex.text.slice(lex.pos)}"`);
  }
  return result;
}

// ── Expansion ─────────────────────────────────────────────────────────────

export function expandAssembly(
  rootAssemblyId: string,
  outerQuantity: number,
  paramOverrides: Record<string, number | string>,
  ctx: ExpansionContext,
): ExpansionResult {
  const warnings: string[] = [];
  const items: ExpandedComponent[] = [];
  const visited: string[] = [];
  let lineCounter = 0;

  const numericOverrides: Record<string, number> = {};
  for (const [key, value] of Object.entries(paramOverrides ?? {})) {
    if (typeof value === "number" && Number.isFinite(value)) {
      numericOverrides[key] = value;
    } else if (typeof value === "string" && value.trim().length > 0) {
      try {
        numericOverrides[key] = evalExpression(value, {});
      } catch {
        warnings.push(`Could not evaluate parameter override "${key}"="${value}"`);
      }
    }
  }

  function normalizeLaborDifficulty(value: string | null | undefined): "normal" | "difficult" | "very_difficult" {
    const normalized = (value ?? "").trim().toLowerCase().replace(/[\s-]+/g, "_");
    if (normalized === "difficult") return "difficult";
    if (normalized === "very_difficult" || normalized === "verydifficult" || normalized === "extreme") {
      return "very_difficult";
    }
    return "normal";
  }

  function laborUnitHoursPerOutput(unit: LaborUnitRef, difficulty: "normal" | "difficult" | "very_difficult") {
    if (difficulty === "very_difficult") {
      return unit.hoursVeryDifficult ?? unit.hoursDifficult ?? unit.hoursNormal;
    }
    if (difficulty === "difficult") {
      return unit.hoursDifficult ?? unit.hoursNormal;
    }
    return unit.hoursNormal;
  }

  function recurse(
    assemblyId: string,
    multiplier: number,
    suppliedScope: Record<string, number>,
    pathLabels: string[],
  ): void {
    if (visited.includes(assemblyId)) {
      throw new Error(
        `Cycle detected in assembly graph: ${[...visited, assemblyId].join(" -> ")}`,
      );
    }

    const assembly = ctx.assemblies.get(assemblyId);
    if (!assembly) {
      warnings.push(`Assembly ${assemblyId} not found in expansion context`);
      return;
    }

    visited.push(assemblyId);
    try {
      const localScope: Record<string, number> = {};
      for (const param of assembly.parameters) {
        if (suppliedScope[param.key] !== undefined) {
          localScope[param.key] = suppliedScope[param.key]!;
        } else {
          try {
            localScope[param.key] = evalExpression(param.defaultValue || "0", {});
          } catch {
            warnings.push(
              `Default value for parameter "${param.key}" in assembly "${assembly.name}" could not be evaluated`,
            );
            localScope[param.key] = 0;
          }
        }
      }

      const sortedComponents = [...assembly.components].sort(
        (a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0),
      );

      for (const component of sortedComponents) {
        let baseQty: number;
        try {
          baseQty = evalExpression(component.quantityExpr || "0", localScope);
        } catch (err) {
          warnings.push(
            `Quantity expression "${component.quantityExpr}" failed in assembly "${assembly.name}": ${(err as Error).message}`,
          );
          continue;
        }
        const qty = baseQty * multiplier;

        if (component.componentType === "sub_assembly") {
          if (!component.subAssemblyId) {
            warnings.push(`Sub-assembly component ${component.id} missing subAssemblyId`);
            continue;
          }
          const childScope: Record<string, number> = {};
          for (const [childKey, parentExpr] of Object.entries(component.parameterBindings ?? {})) {
            try {
              childScope[childKey] = evalExpression(String(parentExpr), localScope);
            } catch (err) {
              warnings.push(
                `Parameter binding "${childKey}=${parentExpr}" failed: ${(err as Error).message}`,
              );
            }
          }
          recurse(
            component.subAssemblyId,
            qty,
            childScope,
            [...pathLabels, assembly.name],
          );
          continue;
        }

        if (component.componentType === "catalog_item") {
          if (!component.catalogItemId) {
            warnings.push(`Catalog component ${component.id} missing catalogItemId`);
            continue;
          }
          const ci = ctx.catalogItems.get(component.catalogItemId);
          if (!ci) {
            warnings.push(`Catalog item ${component.catalogItemId} not found in expansion context`);
            continue;
          }
          items.push({
            componentPath: [...pathLabels, assembly.name],
            componentType: "catalog_item",
            catalogItemId: ci.id,
            category: component.category || "Material",
            entityType: component.category || "Material",
            entityName: ci.name,
            description: component.description || ci.name,
            quantity: qty,
            uom: component.uomOverride || ci.unit || "EA",
            unitCost: component.costOverride ?? ci.unitCost,
            unitPrice: ci.unitPrice,
            markup: component.markupOverride ?? 0,
            notes: component.notes || "",
            sortOrder: lineCounter++,
          });
          continue;
        }

        if (component.componentType === "rate_schedule_item") {
          if (!component.rateScheduleItemId) {
            warnings.push(`Rate-schedule component ${component.id} missing rateScheduleItemId`);
            continue;
          }
          const rsi = ctx.rateScheduleItems.get(component.rateScheduleItemId);
          if (!rsi) {
            warnings.push(
              `Rate-schedule item ${component.rateScheduleItemId} not found in expansion context`,
            );
            continue;
          }
          const rates = Object.values(rsi.rates ?? {});
          const costRates = Object.values(rsi.costRates ?? {});
          items.push({
            componentPath: [...pathLabels, assembly.name],
            componentType: "rate_schedule_item",
            rateScheduleItemId: rsi.id,
            category: component.category || "Labour",
            entityType: component.category || "Labour",
            entityName: rsi.name,
            description: component.description || rsi.name,
            quantity: qty,
            uom: component.uomOverride || rsi.unit || "HR",
            unitCost: component.costOverride ?? (costRates[0] ?? 0),
            unitPrice: rates[0] ?? 0,
            markup: component.markupOverride ?? 0,
            notes: component.notes || "",
            sortOrder: lineCounter++,
          });
          continue;
        }

        if (component.componentType === "labor_unit") {
          if (!component.laborUnitId) {
            warnings.push(`Labor-unit component ${component.id} missing laborUnitId`);
            continue;
          }
          if (!component.rateScheduleItemId) {
            warnings.push(`Labor-unit component ${component.id} missing rateScheduleItemId`);
            continue;
          }
          const laborUnit = ctx.laborUnits?.get(component.laborUnitId);
          if (!laborUnit) {
            warnings.push(`Labor unit ${component.laborUnitId} not found in expansion context`);
            continue;
          }
          const rsi = ctx.rateScheduleItems.get(component.rateScheduleItemId);
          if (!rsi) {
            warnings.push(
              `Rate-schedule item ${component.rateScheduleItemId} not found in expansion context`,
            );
            continue;
          }

          const difficulty = normalizeLaborDifficulty(component.laborDifficulty ?? laborUnit.defaultDifficulty);
          const hoursPerOutput = laborUnitHoursPerOutput(laborUnit, difficulty);
          const totalHours = roundQuantity(qty * hoursPerOutput);
          const rates = Object.values(rsi.rates ?? {});
          const costRates = Object.values(rsi.costRates ?? {});
          const outputUom = component.uomOverride || laborUnit.outputUom || "EA";
          const unitName = laborUnit.name || [laborUnit.category, laborUnit.className, laborUnit.subClassName].filter(Boolean).join(" - ");

          items.push({
            componentPath: [...pathLabels, assembly.name],
            componentType: "labor_unit",
            laborUnitId: laborUnit.id,
            rateScheduleItemId: rsi.id,
            category: component.category || laborUnit.entityCategoryType || "Labour",
            entityType: laborUnit.entityCategoryType || component.category || "Labour",
            entityName: rsi.name,
            description: component.description || `${unitName} (${roundQuantity(qty)} ${outputUom} @ ${hoursPerOutput} hr/${outputUom})`,
            quantity: 1,
            uom: "HR",
            unit1: totalHours,
            unit2: 0,
            unit3: 0,
            unitCost: component.costOverride ?? ((costRates[0] ?? 0) * totalHours),
            unitPrice: (rates[0] ?? 0) * totalHours,
            markup: component.markupOverride ?? 0,
            notes: component.notes || `Labor unit ${difficulty.replace("_", " ")}: ${hoursPerOutput} hr/${outputUom} x ${roundQuantity(qty)} ${outputUom}.`,
            sortOrder: lineCounter++,
          });
          continue;
        }

        if (component.componentType === "cost_intelligence") {
          if (!component.effectiveCostId) {
            warnings.push(`Cost intelligence component ${component.id} missing effectiveCostId`);
            continue;
          }
          const cost = ctx.effectiveCosts?.get(component.effectiveCostId);
          if (!cost) {
            warnings.push(`Cost intelligence cost ${component.effectiveCostId} not found in expansion context`);
            continue;
          }
          const category = component.category || cost.category || cost.resourceType || "Material";
          const vendor = cost.vendorName?.trim() || "";
          const sourceParts = [
            `Cost Intelligence cost basis ${cost.id}`,
            cost.method,
            vendor ? `vendor ${vendor}` : "",
            cost.effectiveDate ? `effective ${cost.effectiveDate}` : "",
            Number.isFinite(cost.confidence ?? NaN)
              ? `confidence ${Math.round((cost.confidence ?? 0) * 100)}%`
              : "",
          ].filter(Boolean);

          items.push({
            componentPath: [...pathLabels, assembly.name],
            componentType: "cost_intelligence",
            catalogItemId: cost.catalogItemId ?? undefined,
            costResourceId: cost.resourceId ?? undefined,
            effectiveCostId: cost.id,
            category,
            entityType: category,
            entityName: cost.name,
            description: component.description || cost.description || cost.name,
            quantity: qty,
            uom: component.uomOverride || cost.uom || cost.defaultUom || "EA",
            unitCost: component.costOverride ?? cost.unitCost,
            unitPrice: cost.unitPrice ?? cost.unitCost,
            markup: component.markupOverride ?? 0,
            vendor: vendor || undefined,
            notes: component.notes || sourceParts.join("; "),
            sortOrder: lineCounter++,
          });
          continue;
        }

        warnings.push(`Unknown component type "${component.componentType}" on ${component.id}`);
      }
    } finally {
      visited.pop();
    }
  }

  recurse(rootAssemblyId, outerQuantity, numericOverrides, []);

  return { items, warnings };
}

function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function roundQuantity(value: number): number {
  return Math.round((value + Number.EPSILON) * 1_000_000) / 1_000_000;
}

function expandedResourceKey(item: ExpandedComponent): string {
  if (item.laborUnitId && item.rateScheduleItemId) return `labor_unit:${item.laborUnitId}:${item.rateScheduleItemId}:${item.uom}`;
  if (item.effectiveCostId) return `cost_intelligence:${item.effectiveCostId}:${item.uom}`;
  if (item.costResourceId) return `cost_resource:${item.costResourceId}:${item.uom}`;
  if (item.catalogItemId) return `catalog_item:${item.catalogItemId}:${item.uom}`;
  if (item.rateScheduleItemId) return `rate_schedule_item:${item.rateScheduleItemId}:${item.uom}`;
  return `${item.componentType}:${item.category.trim().toLowerCase()}:${item.entityName.trim().toLowerCase()}:${item.uom}`;
}

export function summarizeExpandedAssemblyResources(
  items: readonly ExpandedComponent[],
): AssemblyResourceRollup[] {
  const groups = new Map<string, AssemblyResourceRollup>();

  for (const item of items) {
    const key = expandedResourceKey(item);
    const lineCost = item.quantity * item.unitCost;
    const linePrice = item.quantity * item.unitPrice * (1 + (item.markup ?? 0));
    const existing = groups.get(key);

    if (existing) {
      existing.quantity += item.quantity;
      existing.lineCost += lineCost;
      existing.linePrice += linePrice;
      existing.componentCount += 1;
      existing.componentPaths.push(item.componentPath);
      if (existing.category !== item.category) existing.category = "Mixed";
      if (existing.componentType !== item.componentType) existing.componentType = "mixed";
      continue;
    }

    groups.set(key, {
      key,
      componentType: item.componentType,
      catalogItemId: item.catalogItemId,
      rateScheduleItemId: item.rateScheduleItemId,
      laborUnitId: item.laborUnitId,
      costResourceId: item.costResourceId,
      effectiveCostId: item.effectiveCostId,
      category: item.category,
      entityName: item.entityName,
      uom: item.uom,
      quantity: item.quantity,
      lineCost,
      linePrice,
      averageUnitCost: 0,
      averageUnitPrice: 0,
      componentCount: 1,
      componentPaths: [item.componentPath],
    });
  }

  return Array.from(groups.values())
    .map((entry) => ({
      ...entry,
      quantity: roundQuantity(entry.quantity),
      lineCost: roundMoney(entry.lineCost),
      linePrice: roundMoney(entry.linePrice),
      averageUnitCost: entry.quantity > 0 ? roundMoney(entry.lineCost / entry.quantity) : 0,
      averageUnitPrice: entry.quantity > 0 ? roundMoney(entry.linePrice / entry.quantity) : 0,
    }))
    .sort((left, right) => {
      const categorySort = left.category.localeCompare(right.category);
      return categorySort !== 0 ? categorySort : right.lineCost - left.lineCost;
    });
}

// ── Static analysis helpers ───────────────────────────────────────────────

// Walks the assembly graph and returns a list of cycles detected starting from
// the given root id, or an empty array if the graph is acyclic. Used by the
// authoring UI to warn users before they save a circular reference.
export function findAssemblyCycles(
  rootAssemblyId: string,
  assemblies: ReadonlyMap<string, AssemblyDefinition>,
): string[][] {
  const cycles: string[][] = [];
  const stack: string[] = [];
  const seen = new Set<string>();

  function walk(id: string): void {
    const idx = stack.indexOf(id);
    if (idx >= 0) {
      cycles.push([...stack.slice(idx), id]);
      return;
    }
    if (seen.has(id)) return;
    const assembly = assemblies.get(id);
    if (!assembly) return;
    stack.push(id);
    for (const comp of assembly.components) {
      if (comp.componentType === "sub_assembly" && comp.subAssemblyId) {
        walk(comp.subAssemblyId);
      }
    }
    stack.pop();
    seen.add(id);
  }

  walk(rootAssemblyId);
  return cycles;
}
