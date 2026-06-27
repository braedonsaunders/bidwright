import { evalExpression } from "@bidwright/domain";

export interface AssemblyFormulaParameterLike {
  key: string;
  label?: string | null;
  defaultValue?: string | null;
  unit?: string | null;
}

export interface AssemblyFormulaComponentLike {
  quantityExpr?: string | null;
}

export interface AssemblyTemplateSummary {
  formulaCount: number;
  referencedParameterKeys: string[];
  unusedParameterKeys: string[];
  invalidDefaultKeys: string[];
}

const BUILTIN_FUNCTIONS = new Set(["abs", "ceil", "floor", "max", "min", "pow", "round", "sqrt"]);

export function extractFormulaVariables(expression: string): string[] {
  const variables = new Set<string>();
  for (const match of expression.matchAll(/\b[A-Za-z_][A-Za-z0-9_]*\b/g)) {
    const token = match[0];
    if (!BUILTIN_FUNCTIONS.has(token)) variables.add(token);
  }
  return Array.from(variables).sort();
}

export function buildAssemblyFormulaScope(
  parameters: AssemblyFormulaParameterLike[],
): { scope: Record<string, number>; invalidDefaultKeys: string[] } {
  const scope: Record<string, number> = {};
  const invalidDefaultKeys: string[] = [];

  for (const parameter of parameters) {
    const key = parameter.key.trim();
    if (!key) continue;
    try {
      const value = evalExpression(parameter.defaultValue || "0", scope);
      scope[key] = Number.isFinite(value) ? value : 0;
      if (!Number.isFinite(value)) invalidDefaultKeys.push(key);
    } catch {
      scope[key] = 0;
      invalidDefaultKeys.push(key);
    }
  }

  return { scope, invalidDefaultKeys };
}

export function summarizeAssemblyTemplate(
  parameters: AssemblyFormulaParameterLike[],
  components: AssemblyFormulaComponentLike[],
): AssemblyTemplateSummary {
  const parameterKeys = new Set(parameters.map((parameter) => parameter.key.trim()).filter(Boolean));
  const referenced = new Set<string>();
  let formulaCount = 0;

  for (const component of components) {
    const expression = component.quantityExpr?.trim();
    if (!expression || expression === "1") continue;
    formulaCount += 1;
    for (const variable of extractFormulaVariables(expression)) {
      if (parameterKeys.has(variable)) referenced.add(variable);
    }
  }

  const { invalidDefaultKeys } = buildAssemblyFormulaScope(parameters);

  return {
    formulaCount,
    referencedParameterKeys: Array.from(referenced).sort(),
    unusedParameterKeys: Array.from(parameterKeys).filter((key) => !referenced.has(key)).sort(),
    invalidDefaultKeys,
  };
}

export function appendFormulaVariable(expression: string, variableKey: string): string {
  const expr = expression.trim();
  const key = variableKey.trim();
  if (!key) return expr;
  if (!expr) return key;
  if (new RegExp(`\\b${key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`).test(expr)) return expr;
  return `${expr} * ${key}`;
}
