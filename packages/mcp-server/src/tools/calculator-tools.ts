import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

type CalculationVariables = Record<string, number | string>;

type UnitCategory = "length" | "area" | "volume" | "mass" | "time";

interface UnitDefinition {
  canonical: string;
  category: UnitCategory;
  toBase: number;
  aliases: string[];
}

interface NormalizedCalculationInput {
  expression: string;
  sourceUnit?: string;
  targetUnit?: string;
}

interface CalculationSuccess {
  ok: true;
  expression: string;
  normalizedExpression: string;
  result: number;
  displayResult: string;
  variables?: Record<string, number>;
  sourceValue?: number;
  sourceUnit?: string;
  targetUnit?: string;
  precision?: number;
}

interface CalculationFailure {
  ok: false;
  expression: string;
  error: string;
}

export type CalculationResult = CalculationSuccess | CalculationFailure;

const MAX_EXPRESSION_LENGTH = 2000;
const BLOCKED_VARIABLE_NAMES = new Set(["__proto__", "constructor", "prototype"]);

const FUNCTIONS: Record<string, { minArgs: number; maxArgs?: number; fn: (...args: number[]) => number }> = {
  abs: { minArgs: 1, maxArgs: 1, fn: Math.abs },
  acos: { minArgs: 1, maxArgs: 1, fn: Math.acos },
  asin: { minArgs: 1, maxArgs: 1, fn: Math.asin },
  atan: { minArgs: 1, maxArgs: 1, fn: Math.atan },
  avg: { minArgs: 1, fn: (...args) => args.reduce((sum, value) => sum + value, 0) / args.length },
  ceil: { minArgs: 1, maxArgs: 1, fn: Math.ceil },
  clamp: { minArgs: 3, maxArgs: 3, fn: (value, min, max) => Math.min(Math.max(value, min), max) },
  cos: { minArgs: 1, maxArgs: 1, fn: Math.cos },
  deg: { minArgs: 1, maxArgs: 1, fn: (radians) => radians * 180 / Math.PI },
  exp: { minArgs: 1, maxArgs: 1, fn: Math.exp },
  floor: { minArgs: 1, maxArgs: 1, fn: Math.floor },
  log: { minArgs: 1, maxArgs: 2, fn: (value, base = Math.E) => Math.log(value) / Math.log(base) },
  log10: { minArgs: 1, maxArgs: 1, fn: Math.log10 },
  ln: { minArgs: 1, maxArgs: 1, fn: Math.log },
  margin_to_markup: { minArgs: 1, maxArgs: 1, fn: (margin) => margin / (1 - margin) },
  markup: { minArgs: 2, maxArgs: 2, fn: (cost, markupRate) => cost * (1 + markupRate) },
  markup_to_margin: { minArgs: 1, maxArgs: 1, fn: (markupRate) => markupRate / (1 + markupRate) },
  max: { minArgs: 1, fn: Math.max },
  min: { minArgs: 1, fn: Math.min },
  percent_of: { minArgs: 2, maxArgs: 2, fn: (part, total) => total === 0 ? NaN : part / total },
  pow: { minArgs: 2, maxArgs: 2, fn: Math.pow },
  rad: { minArgs: 1, maxArgs: 1, fn: (degrees) => degrees * Math.PI / 180 },
  round: {
    minArgs: 1,
    maxArgs: 2,
    fn: (value, decimals = 0) => {
      const places = Math.trunc(decimals);
      const factor = 10 ** places;
      return Math.round(value * factor) / factor;
    },
  },
  sin: { minArgs: 1, maxArgs: 1, fn: Math.sin },
  sqrt: { minArgs: 1, maxArgs: 1, fn: Math.sqrt },
  sum: { minArgs: 1, fn: (...args) => args.reduce((sum, value) => sum + value, 0) },
  tan: { minArgs: 1, maxArgs: 1, fn: Math.tan },
};

const CONSTANTS: Record<string, number> = {
  e: Math.E,
  pi: Math.PI,
};

const UNIT_DEFINITIONS: UnitDefinition[] = [
  unit("m", "length", 1, ["m", "meter", "meters", "metre", "metres"]),
  unit("mm", "length", 0.001, ["mm", "millimeter", "millimeters", "millimetre", "millimetres"]),
  unit("cm", "length", 0.01, ["cm", "centimeter", "centimeters", "centimetre", "centimetres"]),
  unit("km", "length", 1000, ["km", "kilometer", "kilometers", "kilometre", "kilometres"]),
  unit("in", "length", 0.0254, ["in", "inch", "inches"]),
  unit("ft", "length", 0.3048, ["ft", "foot", "feet"]),
  unit("yd", "length", 0.9144, ["yd", "yard", "yards"]),
  unit("mi", "length", 1609.344, ["mi", "mile", "miles"]),

  unit("m2", "area", 1, ["m2", "sqm", "sq m", "square meter", "square meters", "square metre", "square metres"]),
  unit("mm2", "area", 0.000001, ["mm2", "sq mm", "square millimeter", "square millimeters"]),
  unit("cm2", "area", 0.0001, ["cm2", "sq cm", "square centimeter", "square centimeters"]),
  unit("ft2", "area", 0.09290304, ["ft2", "sf", "sqft", "sq ft", "square foot", "square feet"]),
  unit("in2", "area", 0.00064516, ["in2", "sq in", "square inch", "square inches"]),
  unit("yd2", "area", 0.83612736, ["yd2", "sy", "sq yd", "square yard", "square yards"]),
  unit("acre", "area", 4046.8564224, ["acre", "acres"]),

  unit("m3", "volume", 1, ["m3", "cum", "cu m", "cubic meter", "cubic meters", "cubic metre", "cubic metres"]),
  unit("cm3", "volume", 0.000001, ["cm3", "cc", "cu cm", "cubic centimeter", "cubic centimeters"]),
  unit("ft3", "volume", 0.028316846592, ["ft3", "cf", "cu ft", "cubic foot", "cubic feet"]),
  unit("in3", "volume", 0.000016387064, ["in3", "cu in", "cubic inch", "cubic inches"]),
  unit("yd3", "volume", 0.764554857984, ["yd3", "cy", "cu yd", "cubic yard", "cubic yards"]),
  unit("gal", "volume", 0.003785411784, ["gal", "gallon", "gallons", "us gallon", "us gallons"]),
  unit("l", "volume", 0.001, ["l", "liter", "liters", "litre", "litres"]),
  unit("board_ft", "volume", 0.002359737216, ["bf", "bd ft", "board foot", "board feet"]),

  unit("kg", "mass", 1, ["kg", "kilogram", "kilograms"]),
  unit("g", "mass", 0.001, ["g", "gram", "grams"]),
  unit("lb", "mass", 0.45359237, ["lb", "lbs", "pound", "pounds"]),
  unit("oz", "mass", 0.028349523125, ["oz", "ounce", "ounces"]),
  unit("short_ton", "mass", 907.18474, ["ton", "tons", "short ton", "short tons", "us ton", "us tons"]),
  unit("tonne", "mass", 1000, ["t", "tonne", "tonnes", "metric ton", "metric tons"]),

  unit("s", "time", 1, ["s", "sec", "second", "seconds"]),
  unit("min", "time", 60, ["min", "minute", "minutes"]),
  unit("hr", "time", 3600, ["h", "hr", "hrs", "hour", "hours"]),
  unit("day", "time", 86400, ["day", "days"]),
  unit("week", "time", 604800, ["week", "weeks"]),
];

const UNITS_BY_ALIAS = new Map<string, UnitDefinition>();
for (const definition of UNIT_DEFINITIONS) {
  UNITS_BY_ALIAS.set(normalizeUnitName(definition.canonical), definition);
  for (const alias of definition.aliases) {
    UNITS_BY_ALIAS.set(normalizeUnitName(alias), definition);
  }
}

const SORTED_UNIT_ALIASES = [...UNITS_BY_ALIAS.keys()].sort((a, b) => b.length - a.length);

function unit(canonical: string, category: UnitCategory, toBase: number, aliases: string[]): UnitDefinition {
  return { canonical, category, toBase, aliases };
}

function normalizeUnitName(value: string): string {
  return value.trim().toLowerCase().replace(/[._-]+/g, " ").replace(/\s+/g, " ");
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function assertFinite(value: number, context: string): number {
  if (!Number.isFinite(value)) throw new Error(`${context} produced a non-finite result`);
  return value;
}

function parseNumericLiteral(value: string): number {
  const cleaned = value.replace(/[,_]/g, "");
  const parsed = Number(cleaned);
  if (!Number.isFinite(parsed)) throw new Error(`Invalid number "${value}"`);
  return parsed;
}

function normalizeVariables(variables: CalculationVariables | undefined): Record<string, number> {
  const normalized: Record<string, number> = {};
  for (const [rawName, rawValue] of Object.entries(variables ?? {})) {
    const name = rawName.trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name) || BLOCKED_VARIABLE_NAMES.has(name)) {
      throw new Error(`Invalid variable name "${rawName}"`);
    }

    let value: number;
    if (typeof rawValue === "number") {
      value = rawValue;
    } else {
      const text = rawValue.trim();
      if (/^[+-]?(?:(?:\d{1,3}(?:,\d{3})+|\d[\d_]*)(?:\.\d[\d_]*)?|\.\d[\d_]*)(?:e[+-]?\d+)?%$/i.test(text)) {
        value = parseNumericLiteral(text.slice(0, -1)) / 100;
      } else {
        value = parseNumericLiteral(text);
      }
    }

    if (!Number.isFinite(value)) throw new Error(`Variable "${name}" must be a finite number`);
    normalized[name] = value;
    normalized[name.toLowerCase()] ??= value;
  }
  return normalized;
}

class ExpressionParser {
  private pos = 0;

  constructor(
    private readonly text: string,
    private readonly scope: Record<string, number>,
  ) {}

  parse(): number {
    const result = this.parseExpression();
    this.skipWs();
    if (this.pos < this.text.length) {
      throw new Error(`Unexpected trailing input "${this.text.slice(this.pos)}"`);
    }
    return assertFinite(result, "Expression");
  }

  private skipWs(): void {
    while (this.pos < this.text.length && /\s/.test(this.text[this.pos]!)) this.pos++;
  }

  private peek(): string {
    this.skipWs();
    return this.text[this.pos] ?? "";
  }

  private consume(ch: string): boolean {
    this.skipWs();
    if (this.text[this.pos] === ch) {
      this.pos++;
      return true;
    }
    return false;
  }

  private parseExpression(): number {
    let left = this.parseTerm();
    while (true) {
      if (this.consume("+")) {
        left += this.parseTerm();
      } else if (this.consume("-")) {
        left -= this.parseTerm();
      } else {
        return assertFinite(left, "Expression");
      }
    }
  }

  private parseTerm(): number {
    let left = this.parsePower();
    while (true) {
      if (this.consume("*")) {
        left *= this.parsePower();
      } else if (this.consume("/")) {
        const right = this.parsePower();
        if (right === 0) throw new Error("Division by zero");
        left /= right;
      } else {
        return assertFinite(left, "Term");
      }
    }
  }

  private parsePower(): number {
    let left = this.parsePostfix();
    if (this.consume("^")) {
      left = Math.pow(left, this.parsePower());
    }
    return assertFinite(left, "Power");
  }

  private parsePostfix(): number {
    let value = this.parsePrimary();
    while (this.consume("%")) {
      value /= 100;
    }
    return assertFinite(value, "Postfix expression");
  }

  private parsePrimary(): number {
    const ch = this.peek();
    if (!ch) throw new Error(`Expected value at position ${this.pos}`);

    if (this.consume("+")) return this.parsePrimary();
    if (this.consume("-")) return -this.parsePrimary();

    if (this.consume("(")) {
      const value = this.parseExpression();
      if (!this.consume(")")) throw new Error("Expected ')'");
      return value;
    }

    if (/[0-9.]/.test(ch)) return this.readNumber();

    const identifier = this.readIdentifier();
    if (identifier) {
      if (this.consume("(")) {
        const args: number[] = [];
        if (!this.consume(")")) {
          args.push(this.parseExpression());
          while (this.consume(",")) args.push(this.parseExpression());
          if (!this.consume(")")) throw new Error("Expected ')'");
        }
        return this.callFunction(identifier, args);
      }

      const constant = CONSTANTS[identifier.toLowerCase()];
      if (constant !== undefined) return constant;

      const scopedValue = this.scope[identifier] ?? this.scope[identifier.toLowerCase()];
      if (scopedValue === undefined) throw new Error(`Unknown identifier "${identifier}"`);
      return scopedValue;
    }

    throw new Error(`Unexpected character "${ch}" at position ${this.pos}`);
  }

  private readNumber(): number {
    this.skipWs();
    const match = this.text.slice(this.pos).match(/^(?:(?:\d{1,3}(?:,\d{3})+|\d[\d_]*)(?:\.\d[\d_]*)?|\.\d[\d_]*)(?:e[+-]?\d+)?/i);
    if (!match) throw new Error(`Expected number at position ${this.pos}`);
    this.pos += match[0].length;
    return parseNumericLiteral(match[0]);
  }

  private readIdentifier(): string | null {
    this.skipWs();
    const match = this.text.slice(this.pos).match(/^[A-Za-z_][A-Za-z0-9_]*/);
    if (!match) return null;
    this.pos += match[0].length;
    return match[0];
  }

  private callFunction(identifier: string, args: number[]): number {
    const name = identifier.toLowerCase();
    const fn = FUNCTIONS[name];
    if (!fn) throw new Error(`Unknown function "${identifier}"`);
    if (args.length < fn.minArgs || (fn.maxArgs !== undefined && args.length > fn.maxArgs)) {
      const max = fn.maxArgs === undefined ? "many" : String(fn.maxArgs);
      throw new Error(`Function "${identifier}" expects ${fn.minArgs}-${max} arguments`);
    }
    return assertFinite(fn.fn(...args), `Function "${identifier}"`);
  }
}

function evaluateExpression(expression: string, variables: Record<string, number>): number {
  const trimmed = expression.trim();
  if (!trimmed) throw new Error("Expression is required");
  if (trimmed.length > MAX_EXPRESSION_LENGTH) {
    throw new Error(`Expression is too long; max ${MAX_EXPRESSION_LENGTH} characters`);
  }
  if (/[\n\r;]/.test(trimmed)) {
    throw new Error("Expression must be a single arithmetic expression, without semicolons or newlines");
  }
  return new ExpressionParser(trimmed, variables).parse();
}

function getUnit(value: string): UnitDefinition {
  const normalized = normalizeUnitName(value);
  const definition = UNITS_BY_ALIAS.get(normalized);
  if (!definition) throw new Error(`Unsupported unit "${value}"`);
  return definition;
}

function convertUnit(value: number, sourceUnit: string, targetUnit: string): { value: number; source: UnitDefinition; target: UnitDefinition } {
  const source = getUnit(sourceUnit);
  const target = getUnit(targetUnit);
  if (source.category !== target.category) {
    throw new Error(`Cannot convert ${source.canonical} (${source.category}) to ${target.canonical} (${target.category})`);
  }
  return {
    value: assertFinite((value * source.toBase) / target.toBase, "Unit conversion"),
    source,
    target,
  };
}

function extractTrailingUnit(expression: string): { expression: string; unit: string } | null {
  const trimmed = expression.trim();
  for (const alias of SORTED_UNIT_ALIASES) {
    const escapedAlias = escapeRegExp(alias).replace(/\\ /g, "\\s+");
    const spaced = trimmed.match(new RegExp(`^([\\s\\S]+?)\\s+${escapedAlias}$`, "i"));
    if (spaced?.[1]?.trim()) return { expression: spaced[1].trim(), unit: alias };

    if (!alias.includes(" ")) {
      const compact = trimmed.match(new RegExp(`^([\\s\\S]*[0-9.)%])${escapedAlias}$`, "i"));
      if (compact?.[1]?.trim()) return { expression: compact[1].trim(), unit: alias };
    }
  }
  return null;
}

function normalizeCalculationInput(expression: string, sourceUnit?: string, targetUnit?: string): NormalizedCalculationInput {
  let normalizedExpression = expression.trim();
  let normalizedSourceUnit = sourceUnit?.trim() || undefined;
  let normalizedTargetUnit = targetUnit?.trim() || undefined;

  const conversionMatch = normalizedExpression.match(/^([\s\S]+?)\s+to\s+(.+)$/i);
  if (conversionMatch && !normalizedTargetUnit) {
    normalizedExpression = conversionMatch[1]!.trim();
    normalizedTargetUnit = conversionMatch[2]!.trim();
  }

  if (normalizedTargetUnit && !normalizedSourceUnit) {
    const extracted = extractTrailingUnit(normalizedExpression);
    if (!extracted) {
      throw new Error("sourceUnit is required when targetUnit is provided and the expression has no trailing unit");
    }
    normalizedExpression = extracted.expression;
    normalizedSourceUnit = extracted.unit;
  }

  return {
    expression: normalizedExpression,
    sourceUnit: normalizedSourceUnit,
    targetUnit: normalizedTargetUnit,
  };
}

function roundDecimal(value: number, precision: number | undefined): number {
  if (precision === undefined) return Number(value.toPrecision(15));
  const factor = 10 ** precision;
  return Number((Math.round(value * factor) / factor).toFixed(precision));
}

function formatResult(value: number, unitName?: string, precision?: number): string {
  const decimals = precision ?? (Math.abs(value) >= 1000 ? 4 : 8);
  const formatted = Number.isInteger(value)
    ? value.toLocaleString("en-US")
    : value.toLocaleString("en-US", { maximumFractionDigits: decimals });
  return unitName ? `${formatted} ${unitName}` : formatted;
}

export function calculateMath(input: {
  expression: string;
  variables?: CalculationVariables;
  sourceUnit?: string;
  targetUnit?: string;
  precision?: number;
}): CalculationResult {
  try {
    const variables = normalizeVariables(input.variables);
    const normalized = normalizeCalculationInput(input.expression, input.sourceUnit, input.targetUnit);
    const sourceValue = evaluateExpression(normalized.expression, variables);
    let resultValue = sourceValue;
    let canonicalSourceUnit: string | undefined;
    let canonicalTargetUnit: string | undefined;

    if (normalized.targetUnit) {
      if (!normalized.sourceUnit) throw new Error("sourceUnit is required for unit conversion");
      const converted = convertUnit(sourceValue, normalized.sourceUnit, normalized.targetUnit);
      resultValue = converted.value;
      canonicalSourceUnit = converted.source.canonical;
      canonicalTargetUnit = converted.target.canonical;
    }

    const result = roundDecimal(resultValue, input.precision);
    return {
      ok: true,
      expression: input.expression,
      normalizedExpression: normalized.expression,
      result,
      displayResult: formatResult(result, canonicalTargetUnit, input.precision),
      variables: Object.keys(variables).length > 0 ? variables : undefined,
      sourceValue: canonicalTargetUnit ? roundDecimal(sourceValue, input.precision) : undefined,
      sourceUnit: canonicalSourceUnit,
      targetUnit: canonicalTargetUnit,
      precision: input.precision,
    };
  } catch (err) {
    return {
      ok: false,
      expression: input.expression,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export function registerCalculatorTools(server: McpServer) {
  server.registerTool(
    "calculateMath",
    {
      title: "Calculate math",
      description:
        "Read-only scratch calculator for arithmetic, percentages, markups, ratios, functions, and simple final-unit conversions. Use this to check reasoning math. Do not use it to calculate or overwrite Bidwright estimate line items; use worksheet tools and recalculateTotals for committed estimate values.",
      inputSchema: {
        expression: z.string().describe("Single arithmetic expression. Supports +, -, *, /, ^, parentheses, postfix %, constants pi/e, and functions such as min, max, round, sqrt, sum, avg, markup, markup_to_margin, margin_to_markup, and percent_of. A final conversion can be written like '12 ft to in'."),
        variables: z.record(z.union([z.number(), z.string()])).optional().describe("Optional numeric variables referenced by name in the expression. String values may be numeric or percentages like '15%'."),
        sourceUnit: z.string().optional().describe("Optional source unit for converting the final numeric result, e.g. ft, sqft, m, kg, lb, hr. Usually omitted if the expression ends with a unit."),
        targetUnit: z.string().optional().describe("Optional target unit for converting the final numeric result, e.g. m, ft, sqft, yd3, kg, lb, hr."),
        precision: z.number().int().min(0).max(12).optional().describe("Optional decimal places to round the result to. Omit for high precision."),
      },
      outputSchema: z.object({
        ok: z.boolean(),
        expression: z.string(),
        normalizedExpression: z.string().optional(),
        result: z.number().optional(),
        displayResult: z.string().optional(),
        variables: z.record(z.number()).optional(),
        sourceValue: z.number().optional(),
        sourceUnit: z.string().optional(),
        targetUnit: z.string().optional(),
        precision: z.number().optional(),
        error: z.string().optional(),
      }),
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        openWorldHint: false,
      },
    },
    async ({ expression, variables, sourceUnit, targetUnit, precision }) => {
      const result = calculateMath({ expression, variables, sourceUnit, targetUnit, precision });
      return {
        isError: result.ok ? undefined : true,
        structuredContent: result as unknown as Record<string, unknown>,
        content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
      };
    },
  );
}
