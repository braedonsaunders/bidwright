export type ClassificationKey =
  | "masterformat"
  | "uniformat"
  | "omniclass"
  | "uniclass"
  | "din276"
  | "nrm"
  | "icms"
  | "costCode";

export const CLASSIFICATION_STANDARD_OPTIONS: Array<{
  key: ClassificationKey;
  label: string;
  shortLabel: string;
  placeholder: string;
}> = [
  { key: "masterformat", label: "MasterFormat", shortLabel: "MF", placeholder: "05 12 00" },
  { key: "uniformat", label: "UniFormat", shortLabel: "UF", placeholder: "B2010" },
  { key: "omniclass", label: "OmniClass", shortLabel: "OC", placeholder: "21-02 10 20" },
  { key: "uniclass", label: "Uniclass", shortLabel: "UC", placeholder: "Ss_20_10" },
  { key: "din276", label: "DIN 276", shortLabel: "DIN", placeholder: "300" },
  { key: "nrm", label: "NRM", shortLabel: "NRM", placeholder: "2.1" },
  { key: "icms", label: "ICMS", shortLabel: "ICMS", placeholder: "1.2" },
  { key: "costCode", label: "Cost Code", shortLabel: "Cost", placeholder: "STR-120" },
];

const CLASSIFICATION_ALIASES: Record<ClassificationKey, string[]> = {
  masterformat: ["masterformat", "masterFormat", "MasterFormat", "csi", "CSI"],
  uniformat: ["uniformat", "uniFormat", "UniFormat", "Uniformat", "uniformat2", "uniformatII", "astmE1557"],
  omniclass: ["omniclass", "omniClass", "OmniClass"],
  uniclass: ["uniclass", "UniClass", "Uniclass"],
  din276: ["din276", "DIN276", "din_276"],
  nrm: ["nrm", "NRM"],
  icms: ["icms", "ICMS"],
  costCode: ["costCode", "cost_code", "costcode"],
};

export function classificationLabel(key: string) {
  return CLASSIFICATION_STANDARD_OPTIONS.find((option) => option.key === key)?.label ?? key;
}

export function stringClassificationValue(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    const record = value as Record<string, unknown>;
    const code = record.code ?? record.value ?? record.id ?? record.number;
    if (typeof code === "string") return code.trim();
    if (typeof code === "number" && Number.isFinite(code)) return String(code);
  }
  return "";
}

export function getClassificationCode(
  classification: Record<string, unknown> | undefined,
  key: ClassificationKey,
  costCode?: string | null,
) {
  if (key === "costCode" && costCode) return costCode;
  for (const alias of CLASSIFICATION_ALIASES[key]) {
    const value = stringClassificationValue(classification?.[alias]);
    if (value) return value;
  }
  return "";
}

export function setClassificationCode(
  classification: Record<string, unknown> | undefined,
  key: ClassificationKey,
  value: string,
) {
  const next = { ...(classification ?? {}) };
  const trimmed = value.trim();
  for (const alias of CLASSIFICATION_ALIASES[key]) {
    if (alias !== key) delete next[alias];
  }
  if (trimmed) {
    next[key] = trimmed;
  } else {
    delete next[key];
  }
  return next;
}
