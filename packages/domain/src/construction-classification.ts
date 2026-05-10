import type {
  ConstructionClassificationLevel,
  ConstructionClassificationStandard,
  SummaryBuilderClassificationConfig,
  WorksheetItem,
  WorksheetItemClassification,
} from "./models";

const DEFAULT_CLASSIFICATION_CONFIG: SummaryBuilderClassificationConfig = {
  standard: "masterformat",
  level: "division",
  includeUnclassified: true,
};

const MASTERFORMAT_DIVISION_LABELS: Record<string, string> = {
  "00": "Procurement and Contracting",
  "01": "General Requirements",
  "02": "Existing Conditions",
  "03": "Concrete",
  "04": "Masonry",
  "05": "Metals",
  "06": "Wood, Plastics, and Composites",
  "07": "Thermal and Moisture Protection",
  "08": "Openings",
  "09": "Finishes",
  "10": "Specialties",
  "11": "Equipment",
  "12": "Furnishings",
  "13": "Special Construction",
  "14": "Conveying Equipment",
  "21": "Fire Suppression",
  "22": "Plumbing",
  "23": "HVAC",
  "25": "Integrated Automation",
  "26": "Electrical",
  "27": "Communications",
  "28": "Electronic Safety and Security",
  "31": "Earthwork",
  "32": "Exterior Improvements",
  "33": "Utilities",
  "34": "Transportation",
  "35": "Waterway and Marine",
  "40": "Process Integration",
  "41": "Material Processing and Handling Equipment",
  "42": "Process Heating, Cooling, and Drying Equipment",
  "43": "Process Gas and Liquid Handling",
  "44": "Pollution and Waste Control Equipment",
  "45": "Industry-Specific Manufacturing Equipment",
  "46": "Water and Wastewater Equipment",
  "48": "Electrical Power Generation",
};

const DIN276_GROUP_LABELS: Record<string, string> = {
  "100": "Grundstuck",
  "200": "Vorbereitende Massnahmen",
  "300": "Bauwerk - Baukonstruktionen",
  "400": "Bauwerk - Technische Anlagen",
  "500": "Aussenanlagen",
  "600": "Ausstattung und Kunstwerke",
  "700": "Baunebenkosten",
  "800": "Finanzierung",
};

const UNIFORMAT_GROUP_LABELS: Record<string, string> = {
  A: "Substructure",
  B: "Shell",
  C: "Interiors",
  D: "Services",
  E: "Equipment and Furnishings",
  F: "Special Construction and Demolition",
  G: "Building Sitework",
  Z: "General",
};

const STANDARD_ALIASES: Record<string, ConstructionClassificationStandard> = {
  masterformat: "masterformat",
  "master format": "masterformat",
  master_format: "masterformat",
  csi: "masterformat",
  csi_masterformat: "masterformat",
  uniformat: "uniformat",
  uni_format: "uniformat",
  uniformat2: "uniformat",
  uniformat_ii: "uniformat",
  "uniformat ii": "uniformat",
  astm_e1557: "uniformat",
  omniclass: "omniclass",
  omni_class: "omniclass",
  "omni class": "omniclass",
  uniclass: "uniclass",
  uni_class: "uniclass",
  "uni class": "uniclass",
  din: "din276",
  din276: "din276",
  "din 276": "din276",
  din_276: "din276",
  nrm: "nrm",
  nrm1: "nrm",
  "nrm 1": "nrm",
  nrm_1: "nrm",
  icms: "icms",
  "international cost management standard": "icms",
  international_cost_management_standard: "icms",
  costcode: "cost_code",
  "cost code": "cost_code",
  cost_code: "cost_code",
};

export interface ResolvedConstructionClassification {
  id: string;
  label: string;
  code: string | null;
  standard: ConstructionClassificationStandard;
  level: ConstructionClassificationLevel;
  unclassified: boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringValue(value: unknown): string | null {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed || null;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }
  return null;
}

function normalizeStandard(value: unknown): ConstructionClassificationStandard | null {
  const key = stringValue(value)?.toLowerCase().replace(/[\s-]+/g, "_") ?? "";
  return STANDARD_ALIASES[key] ?? null;
}

function normalizeLevel(value: unknown, standard: ConstructionClassificationStandard): ConstructionClassificationLevel {
  if (standard === "cost_code") {
    return "full";
  }
  const key = stringValue(value)?.toLowerCase() ?? "";
  if (key === "division" || key === "section" || key === "full") {
    return key;
  }
  return DEFAULT_CLASSIFICATION_CONFIG.level;
}

export function normalizeSummaryClassificationConfig(
  raw?: Partial<SummaryBuilderClassificationConfig> | null,
): SummaryBuilderClassificationConfig {
  const standard = normalizeStandard(raw?.standard) ?? DEFAULT_CLASSIFICATION_CONFIG.standard;
  return {
    standard,
    level: normalizeLevel(raw?.level, standard),
    includeUnclassified: raw?.includeUnclassified !== false,
  };
}

function classificationRecord(item: WorksheetItem): WorksheetItemClassification {
  return isRecord(item.classification) ? item.classification : {};
}

function readField(record: Record<string, unknown>, keys: string[]): unknown {
  for (const key of keys) {
    if (record[key] !== undefined && record[key] !== null) {
      return record[key];
    }
  }
  return undefined;
}

function readNested(record: Record<string, unknown>, standard: ConstructionClassificationStandard): unknown {
  const keysByStandard: Record<ConstructionClassificationStandard, string[]> = {
    masterformat: ["masterformat", "masterFormat", "MasterFormat", "csi", "CSI"],
    uniformat: ["uniformat", "uniFormat", "UniFormat", "Uniformat", "uniformat2", "uniformatII", "astmE1557"],
    omniclass: ["omniclass", "omniClass", "OmniClass"],
    uniclass: ["uniclass", "uniClass", "Uniclass"],
    din276: ["din276", "din", "DIN276", "DIN"],
    nrm: ["nrm", "NRM", "nrm1", "NRM1"],
    icms: ["icms", "ICMS"],
    cost_code: ["costCode", "cost_code", "costcode", "code"],
  };
  return readField(record, keysByStandard[standard]);
}

function extractCodeAndLabel(value: unknown): { code: string | null; label: string | null; standard: ConstructionClassificationStandard | null } {
  if (isRecord(value)) {
    const code = stringValue(readField(value, ["code", "number", "id", "value", "classificationCode", "classification_code"]));
    const label = stringValue(readField(value, ["label", "name", "title", "description"]));
    return {
      code,
      label,
      standard: normalizeStandard(readField(value, ["standard", "system", "classificationStandard", "classification_standard"])),
    };
  }

  const text = stringValue(value);
  if (!text) {
    return { code: null, label: null, standard: null };
  }

  const split = text.match(/^(.+?)\s+[-–]\s+(.+)$/);
  return {
    code: (split?.[1] ?? text).trim(),
    label: split?.[2]?.trim() ?? null,
    standard: null,
  };
}

function formatMasterFormatCode(rawCode: string, level: ConstructionClassificationLevel) {
  const digits = rawCode.replace(/\D/g, "");
  if (digits.length < 2) {
    return null;
  }
  if (level === "division") {
    return digits.slice(0, 2);
  }
  if (level === "section") {
    return digits.length >= 6 ? `${digits.slice(0, 2)} ${digits.slice(2, 4)} ${digits.slice(4, 6)}` : digits.slice(0, 2);
  }
  if (digits.length >= 6) {
    return `${digits.slice(0, 2)} ${digits.slice(2, 4)} ${digits.slice(4, 6)}${digits.length > 6 ? `.${digits.slice(6)}` : ""}`;
  }
  return rawCode.trim().replace(/\s+/g, " ");
}

function formatDin276Code(rawCode: string, level: ConstructionClassificationLevel) {
  const digits = rawCode.replace(/\D/g, "");
  if (!digits) {
    return null;
  }
  if (level === "division") {
    return `${digits.slice(0, 1)}00`;
  }
  if (level === "section") {
    return digits.length >= 2 ? `${digits.slice(0, 2)}0` : `${digits.slice(0, 1)}00`;
  }
  return digits;
}

function formatNrmCode(rawCode: string, level: ConstructionClassificationLevel) {
  const parts = rawCode
    .trim()
    .split(/[^\dA-Za-z]+/)
    .map((part) => part.trim())
    .filter(Boolean);
  if (parts.length === 0) {
    return null;
  }
  if (level === "division") {
    return parts[0];
  }
  if (level === "section") {
    return parts.slice(0, Math.min(2, parts.length)).join(".");
  }
  return parts.join(".");
}

function formatUniformatCode(rawCode: string, level: ConstructionClassificationLevel) {
  const normalized = rawCode.trim().toUpperCase().replace(/[^A-Z0-9]+/g, "");
  const match = normalized.match(/^([A-Z])(\d*)/);
  if (!match) {
    return null;
  }
  const [, group, digits = ""] = match;
  if (level === "division") {
    return group;
  }
  if (level === "section") {
    return `${group}${digits.slice(0, Math.min(2, digits.length)) || "00"}`;
  }
  return `${group}${digits}` || group;
}

function formatSegmentedCode(rawCode: string, level: ConstructionClassificationLevel) {
  const parts = rawCode
    .trim()
    .replace(/[_/]+/g, ".")
    .split(/[.\s-]+/)
    .map((part) => part.trim())
    .filter(Boolean);
  if (parts.length === 0) {
    return null;
  }
  if (level === "division") {
    return parts[0];
  }
  if (level === "section") {
    return parts.slice(0, Math.min(2, parts.length)).join(".");
  }
  return parts.join(".");
}

function normalizedCode(
  rawCode: string,
  standard: ConstructionClassificationStandard,
  level: ConstructionClassificationLevel,
) {
  switch (standard) {
    case "masterformat":
      return formatMasterFormatCode(rawCode, level);
    case "uniformat":
      return formatUniformatCode(rawCode, level);
    case "omniclass":
    case "uniclass":
      return formatSegmentedCode(rawCode, level);
    case "din276":
      return formatDin276Code(rawCode, level);
    case "nrm":
      return formatNrmCode(rawCode, level);
    case "icms":
      return formatSegmentedCode(rawCode, level);
    case "cost_code":
      return rawCode.trim().replace(/\s+/g, " ");
    default:
      return rawCode.trim();
  }
}

function displayLabel(
  code: string,
  label: string | null,
  standard: ConstructionClassificationStandard,
  level: ConstructionClassificationLevel,
) {
  if (standard === "masterformat" && level === "division") {
    return `${code} - ${MASTERFORMAT_DIVISION_LABELS[code] ?? `Division ${code}`}`;
  }
  if (standard === "din276" && level === "division") {
    return `${code} - ${DIN276_GROUP_LABELS[code] ?? `DIN ${code}`}`;
  }
  if (standard === "uniformat" && level === "division") {
    return `${code} - ${UNIFORMAT_GROUP_LABELS[code] ?? `UniFormat ${code}`}`;
  }
  if (label && label.toLowerCase() !== code.toLowerCase()) {
    return `${code} - ${label}`;
  }
  if (standard === "cost_code") {
    return code;
  }
  return `${code} - ${standardLabel(standard)}`;
}

function standardLabel(standard: ConstructionClassificationStandard) {
  switch (standard) {
    case "masterformat":
      return "MasterFormat";
    case "uniformat":
      return "UniFormat";
    case "omniclass":
      return "OmniClass";
    case "uniclass":
      return "Uniclass";
    case "din276":
      return "DIN 276";
    case "nrm":
      return "NRM";
    case "icms":
      return "ICMS";
    case "cost_code":
      return "Cost Code";
    default:
      return "Classification";
  }
}

function unclassified(config: SummaryBuilderClassificationConfig): ResolvedConstructionClassification | null {
  if (!config.includeUnclassified) {
    return null;
  }
  return {
    id: `${config.standard}:${config.level}:__unclassified__`,
    label: "(Unclassified)",
    code: null,
    standard: config.standard,
    level: config.level,
    unclassified: true,
  };
}

export function resolveConstructionClassification(
  item: WorksheetItem,
  rawConfig?: Partial<SummaryBuilderClassificationConfig> | null,
): ResolvedConstructionClassification | null {
  const config = normalizeSummaryClassificationConfig(rawConfig);
  const record = classificationRecord(item);
  const nested = readNested(record, config.standard);
  const direct = extractCodeAndLabel(nested);
  const fallback = extractCodeAndLabel(record);
  const costCode = stringValue(item.costCode) ?? stringValue(readField(record, ["costCode", "cost_code", "costcode"]));
  const rawCode = config.standard === "cost_code" ? costCode ?? direct.code ?? fallback.code : direct.code ?? fallback.code;
  const label = direct.label ?? fallback.label;

  if (direct.standard && direct.standard !== config.standard && !rawCode) {
    return unclassified(config);
  }
  if (!rawCode) {
    return unclassified(config);
  }

  const code = normalizedCode(rawCode, config.standard, config.level);
  if (!code) {
    return unclassified(config);
  }

  return {
    id: `${config.standard}:${config.level}:${code.toLowerCase().replace(/\s+/g, "_")}`,
    label: displayLabel(code, label, config.standard, config.level),
    code,
    standard: config.standard,
    level: config.level,
    unclassified: false,
  };
}
