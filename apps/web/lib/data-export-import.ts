/**
 * Bulk import / export for the Data Management section of Settings.
 *
 * Export: fetches every data-management entity via existing API helpers,
 *         strips server-generated fields, and downloads as JSON.
 * Import: parses a previously exported JSON file and creates entities
 *         via the existing create-* API helpers in dependency order.
 */

import type { EntityCategory, CatalogItem, RateScheduleTier, RateScheduleItem, CustomerContact } from "@bidwright/domain";
import type { CatalogSummary } from "./api";
import {
  getEntityCategories,
  getCatalogs,
  listCatalogItems,
  createCatalog,
  createCatalogItem,
  updateCatalog,
  updateCatalogItem,
  deleteCatalog,
  createEntityCategory,
  updateEntityCategory,
  deleteEntityCategory,
  listRateSchedules,
  getRateSchedule,
  createRateSchedule,
  updateRateSchedule,
  deleteRateSchedule,
  addRateScheduleTier,
  addRateScheduleItem,
  deleteRateScheduleTier,
  deleteRateScheduleItem,
  listLabourCostTables,
  getLabourCostTable,
  createLabourCostTable,
  createLabourCostEntry,
  updateLabourCostTable,
  updateLabourCostEntry,
  deleteLabourCostTable,
  deleteLabourCostEntry,
  listBurdenPeriods,
  createBurdenPeriod,
  updateBurdenPeriod,
  deleteBurdenPeriod,
  listTravelPolicies,
  createTravelPolicy,
  updateTravelPolicy,
  deleteTravelPolicy,
  getCustomers,
  getCustomer,
  createCustomer,
  createCustomerContact,
  updateCustomer,
  updateCustomerContact,
  deleteCustomer,
  deleteCustomerContact,
  getConditionLibrary,
  createConditionLibraryEntry,
  deleteConditionLibraryEntry,
} from "./api";

// ── Export schema ────────────────────────────────────────────────────────

const EXPORT_VERSION = 1;

export interface BidwrightExportData {
  bidwright_export: {
    version: number;
    exportedAt: string;
    sections: string[];
  };
  entityCategories?: ExportEntityCategory[];
  catalogs?: ExportCatalog[];
  rateSchedules?: ExportRateSchedule[];
  labourCostTables?: ExportLabourCostTable[];
  burdenPeriods?: ExportBurdenPeriod[];
  travelPolicies?: ExportTravelPolicy[];
  customers?: ExportCustomer[];
  conditionLibrary?: ExportConditionEntry[];
}

// Exported shapes — server-generated fields stripped

interface ExportEntityCategory {
  name: string;
  entityType: string;
  shortform: string;
  defaultUom: string;
  validUoms: string[];
  editableFields: EntityCategory["editableFields"];
  unitLabels: EntityCategory["unitLabels"];
  calculationType: string;
  calcFormula: string;
  itemSource: string;
  catalogName?: string | null; // resolved from catalogId
  color: string;
  order: number;
  isBuiltIn: boolean;
  enabled: boolean;
}

interface ExportCatalogItem {
  code: string;
  name: string;
  unit: string;
  unitCost: number;
  unitPrice: number;
  category?: string;
  metadata?: Record<string, unknown>;
}

interface ExportCatalog {
  name: string;
  kind: string;
  description: string;
  source: string;
  sourceDescription: string;
  items: ExportCatalogItem[];
}

interface ExportRateScheduleTier {
  name: string;
  multiplier: number;
  sortOrder: number;
}

interface ExportRateScheduleItem {
  code: string;
  name: string;
  unit: string;
  rates: Record<string, number>;
  costRates?: Record<string, number>;
  metadata: Record<string, unknown>;
  sortOrder: number;
}

interface ExportRateSchedule {
  name: string;
  description: string;
  category: string;
  defaultMarkup: number;
  autoCalculate: boolean;
  effectiveDate: string | null;
  expiryDate: string | null;
  travelPolicyName?: string | null; // resolved from travelPolicyId
  metadata: Record<string, unknown>;
  tiers: ExportRateScheduleTier[];
  items: ExportRateScheduleItem[];
}

interface ExportLabourCostEntry {
  code: string;
  name: string;
  group: string;
  costRates: Record<string, number>;
  metadata: Record<string, unknown>;
  sortOrder: number;
}

interface ExportLabourCostTable {
  name: string;
  description: string;
  effectiveDate: string | null;
  expiryDate: string | null;
  metadata: Record<string, unknown>;
  entries: ExportLabourCostEntry[];
}

interface ExportBurdenPeriod {
  name: string;
  group: string;
  percentage: number;
  startDate: string;
  endDate: string;
}

interface ExportTravelPolicy {
  name: string;
  description: string;
  perDiemRate: number;
  perDiemEmbedMode: string;
  hoursPerDay: number;
  travelTimeHours: number;
  travelTimeTrips: number;
  kmToDestination: number;
  mileageRate: number;
  fuelSurchargePercent: number;
  fuelSurchargeAppliesTo: string;
  accommodationRate: number;
  accommodationNights: number;
  showAsSeparateLine: boolean;
  breakoutLabel: string;
  metadata: Record<string, unknown>;
}

interface ExportCustomerContact {
  name: string;
  email: string;
  phone: string;
  title: string;
  isPrimary: boolean;
}

interface ExportCustomer {
  name: string;
  code: string;
  email: string;
  phone: string;
  address: string;
  notes: string;
  contacts: ExportCustomerContact[];
}

interface ExportConditionEntry {
  type: string;
  value: string;
}

// ── Import helpers ──────────────────────────────────────────────────────

export interface ImportSummary {
  entityCategories: number;
  catalogs: number;
  catalogItems: number;
  rateSchedules: number;
  labourCostTables: number;
  burdenPeriods: number;
  travelPolicies: number;
  customers: number;
  conditionLibrary: number;
}

export interface ImportProgress {
  currentSection: string;
  sectionsComplete: number;
  totalSections: number;
  errors: string[];
}

export interface ImportResult {
  created: ImportSummary;
  updated: ImportSummary;
  deleted: ImportSummary;
  errors: string[];
}

export type ImportMode = "add" | "overwrite";

export type ImportSectionKey =
  | "conditionLibrary"
  | "travelPolicies"
  | "burdenPeriods"
  | "customers"
  | "catalogs"
  | "entityCategories"
  | "labourCostTables"
  | "rateSchedules";

export interface ImportOptions {
  mode: ImportMode;
  enabledSections: Record<ImportSectionKey, boolean>;
}

// ── Export ───────────────────────────────────────────────────────────────

export async function exportAllDataManagement(): Promise<void> {
  // 1. Fetch all data in parallel
  const [
    entityCategories,
    catalogs,
    rateSchedulesList,
    labourCostTables,
    burdenPeriods,
    travelPolicies,
    customers,
    conditionLibrary,
  ] = await Promise.all([
    getEntityCategories(),
    getCatalogs(),
    listRateSchedules(),
    listLabourCostTables(),
    listBurdenPeriods(),
    listTravelPolicies(),
    getCustomers(),
    getConditionLibrary(),
  ]);

  // 2. Fetch nested children (catalog items, rate schedule details, customer contacts)
  const globalCatalogs = catalogs.filter((c) => c.scope === "global");
  const catalogItemsMap = new Map<string, CatalogItem[]>();
  for (const cat of globalCatalogs) {
    try {
      catalogItemsMap.set(cat.id, await listCatalogItems(cat.id));
    } catch {
      catalogItemsMap.set(cat.id, []);
    }
  }

  const globalSchedules = rateSchedulesList.filter((s) => (s as any).scope === "global" || !(s as any).scope);
  const rateScheduleDetails = await Promise.all(
    globalSchedules.map((s) => getRateSchedule(s.id).catch(() => s))
  );

  const customerDetails = await Promise.all(
    customers.map((c) => getCustomer(c.id).catch(() => ({ ...c, contacts: [] })))
  );

  // 3. Build lookup maps for cross-references
  const catalogIdToName = new Map(globalCatalogs.map((c) => [c.id, c.name]));
  const travelPolicyIdToName = new Map(travelPolicies.map((t) => [t.id, t.name]));

  // 4. Transform and strip IDs
  const exportData: BidwrightExportData = {
    bidwright_export: {
      version: EXPORT_VERSION,
      exportedAt: new Date().toISOString(),
      sections: ["entityCategories", "catalogs", "rateSchedules", "labourCostTables", "burdenPeriods", "travelPolicies", "customers", "conditionLibrary"],
    },

    entityCategories: entityCategories.map((c) => ({
      name: c.name,
      entityType: c.entityType,
      shortform: c.shortform,
      defaultUom: c.defaultUom,
      validUoms: c.validUoms,
      editableFields: c.editableFields,
      unitLabels: c.unitLabels,
      calculationType: c.calculationType,
      calcFormula: c.calcFormula,
      itemSource: c.itemSource,
      catalogName: c.catalogId ? catalogIdToName.get(c.catalogId) ?? null : null,
      color: c.color,
      order: c.order,
      isBuiltIn: c.isBuiltIn,
      enabled: c.enabled,
    })),

    catalogs: globalCatalogs.map((c) => ({
      name: c.name,
      kind: c.kind || "materials",
      description: c.description || "",
      source: c.source || "",
      sourceDescription: c.sourceDescription || "",
      items: (catalogItemsMap.get(c.id) || []).map((i) => ({
        code: i.code,
        name: i.name,
        unit: i.unit,
        unitCost: i.unitCost,
        unitPrice: i.unitPrice,
        category: (i as any).category,
        metadata: i.metadata,
      })),
    })),

    rateSchedules: rateScheduleDetails.map((s: any) => {
      // Build tier ID → name map so we can export rates keyed by tier name (portable)
      const tierIdToName = new Map<string, string>((s.tiers || []).map((t: RateScheduleTier) => [t.id, t.name]));
      function remapRateKeys(rates: Record<string, number> | undefined): Record<string, number> {
        if (!rates) return {};
        const out: Record<string, number> = {};
        for (const [key, val] of Object.entries(rates)) {
          const tierName = tierIdToName.get(key);
          if (tierName) out[tierName] = val;
        }
        return out;
      }
      return {
        name: s.name,
        description: s.description || "",
        category: s.category || "labour",
        defaultMarkup: s.defaultMarkup ?? 0,
        autoCalculate: s.autoCalculate ?? false,
        effectiveDate: s.effectiveDate ?? null,
        expiryDate: s.expiryDate ?? null,
        travelPolicyName: s.travelPolicyId ? travelPolicyIdToName.get(s.travelPolicyId) ?? null : null,
        metadata: s.metadata || {},
        tiers: (s.tiers || []).map((t: RateScheduleTier) => ({
          name: t.name,
          multiplier: t.multiplier,
          sortOrder: t.sortOrder,
        })),
        items: (s.items || []).map((i: RateScheduleItem) => ({
          code: i.code,
          name: i.name,
          unit: i.unit,
          rates: remapRateKeys(i.rates),
          costRates: remapRateKeys(i.costRates),
          metadata: i.metadata || {},
          sortOrder: i.sortOrder,
        })),
      };
    }),

    labourCostTables: labourCostTables.map((t) => ({
      name: t.name,
      description: t.description || "",
      effectiveDate: t.effectiveDate ?? null,
      expiryDate: t.expiryDate ?? null,
      metadata: t.metadata || {},
      entries: (t.entries || []).map((e) => ({
        code: e.code,
        name: e.name,
        group: e.group || "",
        costRates: e.costRates,
        metadata: e.metadata || {},
        sortOrder: e.sortOrder,
      })),
    })),

    burdenPeriods: burdenPeriods.map((b) => ({
      name: b.name,
      group: b.group,
      percentage: b.percentage,
      startDate: b.startDate,
      endDate: b.endDate,
    })),

    travelPolicies: travelPolicies.map((t) => ({
      name: t.name,
      description: t.description || "",
      perDiemRate: t.perDiemRate,
      perDiemEmbedMode: t.perDiemEmbedMode,
      hoursPerDay: t.hoursPerDay,
      travelTimeHours: t.travelTimeHours,
      travelTimeTrips: t.travelTimeTrips,
      kmToDestination: t.kmToDestination,
      mileageRate: t.mileageRate,
      fuelSurchargePercent: t.fuelSurchargePercent,
      fuelSurchargeAppliesTo: t.fuelSurchargeAppliesTo,
      accommodationRate: t.accommodationRate,
      accommodationNights: t.accommodationNights,
      showAsSeparateLine: t.showAsSeparateLine,
      breakoutLabel: t.breakoutLabel || "",
      metadata: t.metadata || {},
    })),

    customers: customerDetails.map((c: any) => ({
      name: c.name || "",
      code: c.code || "",
      email: c.email || "",
      phone: c.phone || "",
      address: c.address || "",
      notes: c.notes || "",
      contacts: (c.contacts || []).map((ct: CustomerContact) => ({
        name: ct.name || "",
        email: ct.email || "",
        phone: ct.phone || "",
        title: ct.title || "",
        isPrimary: ct.isPrimary ?? false,
      })),
    })),

    conditionLibrary: conditionLibrary.map((c) => ({
      type: c.type,
      value: c.value,
    })),
  };

  // 5. Download
  const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  const date = new Date().toISOString().slice(0, 10);
  a.download = `bidwright-data-export-${date}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// ── Parse & validate ────────────────────────────────────────────────────

export async function parseExportFile(file: File): Promise<{ data: BidwrightExportData; summary: ImportSummary }> {
  const text = await file.text();
  let parsed: any;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("Invalid JSON file");
  }

  if (!parsed.bidwright_export || parsed.bidwright_export.version !== EXPORT_VERSION) {
    throw new Error(`Unsupported export format. Expected version ${EXPORT_VERSION}.`);
  }

  const data = parsed as BidwrightExportData;
  const summary: ImportSummary = {
    entityCategories: data.entityCategories?.length ?? 0,
    catalogs: data.catalogs?.length ?? 0,
    catalogItems: data.catalogs?.reduce((sum, c) => sum + (c.items?.length ?? 0), 0) ?? 0,
    rateSchedules: data.rateSchedules?.length ?? 0,
    labourCostTables: data.labourCostTables?.length ?? 0,
    burdenPeriods: data.burdenPeriods?.length ?? 0,
    travelPolicies: data.travelPolicies?.length ?? 0,
    customers: data.customers?.length ?? 0,
    conditionLibrary: data.conditionLibrary?.length ?? 0,
  };

  return { data, summary };
}

// ── Import ──────────────────────────────────────────────────────────────

export const IMPORT_SECTION_LABELS: Record<ImportSectionKey, string> = {
  conditionLibrary: "Inclusions & Exclusions",
  travelPolicies: "Travel Policies",
  burdenPeriods: "Burden Periods",
  customers: "Customers",
  catalogs: "Catalogs",
  entityCategories: "Entity Categories",
  labourCostTables: "Labour Cost Tables",
  rateSchedules: "Rate Schedules",
};

/** Section keys in dependency order (import must proceed in this order). */
export const IMPORT_SECTION_ORDER: ImportSectionKey[] = [
  "conditionLibrary",
  "travelPolicies",
  "burdenPeriods",
  "customers",
  "catalogs",
  "entityCategories",
  "labourCostTables",
  "rateSchedules",
];

/** Maps summary key to the BidwrightExportData field name. */
const SECTION_SUMMARY_KEY: Record<ImportSectionKey, keyof ImportSummary> = {
  conditionLibrary: "conditionLibrary",
  travelPolicies: "travelPolicies",
  burdenPeriods: "burdenPeriods",
  customers: "customers",
  catalogs: "catalogs",
  entityCategories: "entityCategories",
  labourCostTables: "labourCostTables",
  rateSchedules: "rateSchedules",
};

function emptySummary(): ImportSummary {
  return { entityCategories: 0, catalogs: 0, catalogItems: 0, rateSchedules: 0, labourCostTables: 0, burdenPeriods: 0, travelPolicies: 0, customers: 0, conditionLibrary: 0 };
}


export function defaultImportOptions(summary: ImportSummary): ImportOptions {
  const enabledSections = {} as Record<ImportSectionKey, boolean>;
  for (const key of IMPORT_SECTION_ORDER) {
    enabledSections[key] = (summary[SECTION_SUMMARY_KEY[key]] ?? 0) > 0;
  }
  return { mode: "add", enabledSections };
}

// ── Overwrite helpers (delete all existing before re-creating) ──────────

async function deleteAllConditionLibrary(errors: string[], deleted: ImportSummary) {
  const existing = await getConditionLibrary();
  for (const e of existing) {
    try { await deleteConditionLibraryEntry(e.id); deleted.conditionLibrary++; } catch (err: any) { errors.push(`Delete condition "${e.value}": ${err.message}`); }
  }
}

async function deleteAllTravelPolicies(errors: string[], deleted: ImportSummary) {
  const existing = await listTravelPolicies();
  for (const e of existing) {
    try { await deleteTravelPolicy(e.id); deleted.travelPolicies++; } catch (err: any) { errors.push(`Delete travel policy "${e.name}": ${err.message}`); }
  }
}

async function deleteAllBurdenPeriods(errors: string[], deleted: ImportSummary) {
  const existing = await listBurdenPeriods();
  for (const e of existing) {
    try { await deleteBurdenPeriod(e.id); deleted.burdenPeriods++; } catch (err: any) { errors.push(`Delete burden period "${e.name}": ${err.message}`); }
  }
}

async function deleteAllCustomers(errors: string[], deleted: ImportSummary) {
  const existing = await getCustomers();
  for (const e of existing) {
    try { await deleteCustomer(e.id); deleted.customers++; } catch (err: any) { errors.push(`Delete customer "${e.name}": ${err.message}`); }
  }
}

async function deleteAllCatalogs(errors: string[], deleted: ImportSummary) {
  const existing = await getCatalogs();
  const globals = existing.filter((c) => c.scope === "global");
  for (const e of globals) {
    try { await deleteCatalog(e.id); deleted.catalogs++; } catch (err: any) { errors.push(`Delete catalog "${e.name}": ${err.message}`); }
  }
}

async function deleteAllEntityCategories(errors: string[], deleted: ImportSummary) {
  const existing = await getEntityCategories();
  for (const e of existing) {
    try { await deleteEntityCategory(e.id); deleted.entityCategories++; } catch (err: any) { errors.push(`Delete category "${e.name}": ${err.message}`); }
  }
}

async function deleteAllLabourCostTables(errors: string[], deleted: ImportSummary) {
  const existing = await listLabourCostTables();
  for (const e of existing) {
    try { await deleteLabourCostTable(e.id); deleted.labourCostTables++; } catch (err: any) { errors.push(`Delete labour table "${e.name}": ${err.message}`); }
  }
}

async function deleteAllRateSchedules(errors: string[], deleted: ImportSummary) {
  const existing = await listRateSchedules();
  const globals = existing.filter((s) => (s as any).scope === "global" || !(s as any).scope);
  for (const e of globals) {
    try { await deleteRateSchedule(e.id); deleted.rateSchedules++; } catch (err: any) { errors.push(`Delete rate schedule "${e.name}": ${err.message}`); }
  }
}

const DELETE_FNS: Record<ImportSectionKey, (errors: string[], deleted: ImportSummary) => Promise<void>> = {
  conditionLibrary: deleteAllConditionLibrary,
  travelPolicies: deleteAllTravelPolicies,
  burdenPeriods: deleteAllBurdenPeriods,
  customers: deleteAllCustomers,
  catalogs: deleteAllCatalogs,
  entityCategories: deleteAllEntityCategories,
  labourCostTables: deleteAllLabourCostTables,
  rateSchedules: deleteAllRateSchedules,
};

export async function importAllDataManagement(
  data: BidwrightExportData,
  onProgress: (p: ImportProgress) => void,
  options?: ImportOptions,
): Promise<ImportResult> {
  const errors: string[] = [];
  const created = emptySummary();
  const updated = emptySummary();
  const deleted = emptySummary();

  const mode = options?.mode ?? "add";
  const enabled = options?.enabledSections;

  // Count only enabled sections for progress
  const activeSections = IMPORT_SECTION_ORDER.filter((key) => !enabled || enabled[key]);
  const totalSections = activeSections.length;

  const travelPolicyNameToId = new Map<string, string>();
  const catalogNameToId = new Map<string, string>();
  let sectionsComplete = 0;

  function progress(section: string) {
    onProgress({ currentSection: section, sectionsComplete, totalSections, errors: [...errors] });
  }

  function isEnabled(key: ImportSectionKey) {
    return !enabled || enabled[key];
  }

  // ── 1. Condition Library ──
  if (isEnabled("conditionLibrary")) {
    progress("Condition Library");
    if (mode === "overwrite") await deleteAllConditionLibrary(errors, deleted);
    for (const entry of data.conditionLibrary ?? []) {
      try {
        await createConditionLibraryEntry({ type: entry.type, value: entry.value });
        created.conditionLibrary++;
      } catch (e: any) {
        errors.push(`Condition "${entry.value}": ${e.message}`);
      }
    }
    sectionsComplete++;
  }

  // ── 2. Travel Policies ──
  if (isEnabled("travelPolicies")) {
    progress("Travel Policies");
    if (mode === "overwrite") {
      await deleteAllTravelPolicies(errors, deleted);
      // Create fresh
      for (const tp of data.travelPolicies ?? []) {
        try {
          const result = await createTravelPolicy(tp as any);
          travelPolicyNameToId.set(tp.name, result.id);
          created.travelPolicies++;
        } catch (e: any) { errors.push(`Travel Policy "${tp.name}": ${e.message}`); }
      }
    } else {
      // Add mode — match by name, update existing or create new
      const existing = await listTravelPolicies();
      const existingByName = new Map(existing.map((e) => [e.name, e]));
      for (const tp of data.travelPolicies ?? []) {
        try {
          const match = existingByName.get(tp.name);
          if (match) {
            await updateTravelPolicy(match.id, tp as any);
            travelPolicyNameToId.set(tp.name, match.id);
            updated.travelPolicies++;
          } else {
            const result = await createTravelPolicy(tp as any);
            travelPolicyNameToId.set(tp.name, result.id);
            created.travelPolicies++;
          }
        } catch (e: any) { errors.push(`Travel Policy "${tp.name}": ${e.message}`); }
      }
    }
    sectionsComplete++;
  }

  // ── 3. Burden Periods ──
  if (isEnabled("burdenPeriods")) {
    progress("Burden Periods");
    if (mode === "overwrite") {
      await deleteAllBurdenPeriods(errors, deleted);
      for (const bp of data.burdenPeriods ?? []) {
        try { await createBurdenPeriod(bp); created.burdenPeriods++; } catch (e: any) { errors.push(`Burden Period "${bp.name}": ${e.message}`); }
      }
    } else {
      const existing = await listBurdenPeriods();
      const existingByName = new Map(existing.map((e) => [e.name, e]));
      for (const bp of data.burdenPeriods ?? []) {
        try {
          const match = existingByName.get(bp.name);
          if (match) {
            await updateBurdenPeriod(match.id, bp);
            updated.burdenPeriods++;
          } else {
            await createBurdenPeriod(bp);
            created.burdenPeriods++;
          }
        } catch (e: any) { errors.push(`Burden Period "${bp.name}": ${e.message}`); }
      }
    }
    sectionsComplete++;
  }

  // ── 4. Customers (with contacts) ──
  if (isEnabled("customers")) {
    progress("Customers");
    if (mode === "overwrite") {
      await deleteAllCustomers(errors, deleted);
      for (const cust of data.customers ?? []) {
        try {
          const { contacts, ...custData } = cust;
          const result = await createCustomer(custData as any);
          created.customers++;
          for (const contact of contacts ?? []) {
            try { await createCustomerContact(result.id, contact as any); } catch (e: any) { errors.push(`Customer Contact "${contact.name}" for "${cust.name}": ${e.message}`); }
          }
        } catch (e: any) { errors.push(`Customer "${cust.name}": ${e.message}`); }
      }
    } else {
      const existing = await getCustomers();
      const existingByName = new Map(existing.map((e) => [e.name, e]));
      for (const cust of data.customers ?? []) {
        try {
          const { contacts, ...custData } = cust;
          const match = existingByName.get(cust.name);
          if (match) {
            await updateCustomer(match.id, custData as any);
            updated.customers++;
            // Update contacts by name
            const existingCustomer = await getCustomer(match.id);
            const existingContacts = new Map((existingCustomer.contacts ?? []).map((c: any) => [c.name, c]));
            for (const contact of contacts ?? []) {
              try {
                const cMatch = existingContacts.get(contact.name);
                if (cMatch) {
                  await updateCustomerContact(match.id, cMatch.id, contact as any);
                } else {
                  await createCustomerContact(match.id, contact as any);
                }
              } catch (e: any) { errors.push(`Customer Contact "${contact.name}" for "${cust.name}": ${e.message}`); }
            }
          } else {
            const result = await createCustomer(custData as any);
            created.customers++;
            for (const contact of contacts ?? []) {
              try { await createCustomerContact(result.id, contact as any); } catch (e: any) { errors.push(`Customer Contact "${contact.name}" for "${cust.name}": ${e.message}`); }
            }
          }
        } catch (e: any) { errors.push(`Customer "${cust.name}": ${e.message}`); }
      }
    }
    sectionsComplete++;
  }

  // ── 5. Catalogs (with items) ──
  if (isEnabled("catalogs")) {
    progress("Catalogs");
    if (mode === "overwrite") {
      await deleteAllCatalogs(errors, deleted);
      for (const cat of data.catalogs ?? []) {
        try {
          const { items, ...catData } = cat;
          const result = await createCatalog({ name: catData.name, kind: catData.kind, scope: "global", description: catData.description });
          catalogNameToId.set(cat.name, result.id);
          created.catalogs++;
          for (const item of items ?? []) {
            try { await createCatalogItem(result.id, { code: item.code, name: item.name, unit: item.unit, unitCost: item.unitCost, unitPrice: item.unitPrice, category: item.category, metadata: item.metadata }); created.catalogItems++; } catch (e: any) { errors.push(`Catalog Item "${item.name}" in "${cat.name}": ${e.message}`); }
          }
        } catch (e: any) { errors.push(`Catalog "${cat.name}": ${e.message}`); }
      }
    } else {
      const existing = await getCatalogs();
      const existingByName = new Map(existing.filter((c) => c.scope === "global").map((c) => [c.name, c]));
      for (const cat of data.catalogs ?? []) {
        try {
          const { items, ...catData } = cat;
          const match = existingByName.get(cat.name);
          if (match) {
            await updateCatalog(match.id, { name: catData.name, description: catData.description } as any);
            catalogNameToId.set(cat.name, match.id);
            updated.catalogs++;
            // Match items by code or name
            const existingItems = await listCatalogItems(match.id);
            const existingItemsByCode = new Map(existingItems.filter((i) => i.code).map((i) => [i.code, i]));
            const existingItemsByName = new Map(existingItems.map((i) => [i.name, i]));
            for (const item of items ?? []) {
              try {
                const iMatch = (item.code ? existingItemsByCode.get(item.code) : null) ?? existingItemsByName.get(item.name);
                if (iMatch) {
                  await updateCatalogItem(match.id, iMatch.id, { code: item.code, name: item.name, unit: item.unit, unitCost: item.unitCost, unitPrice: item.unitPrice, category: item.category, metadata: item.metadata as any });
                  updated.catalogItems++;
                } else {
                  await createCatalogItem(match.id, { code: item.code, name: item.name, unit: item.unit, unitCost: item.unitCost, unitPrice: item.unitPrice, category: item.category, metadata: item.metadata });
                  created.catalogItems++;
                }
              } catch (e: any) { errors.push(`Catalog Item "${item.name}" in "${cat.name}": ${e.message}`); }
            }
          } else {
            const result = await createCatalog({ name: catData.name, kind: catData.kind, scope: "global", description: catData.description });
            catalogNameToId.set(cat.name, result.id);
            created.catalogs++;
            for (const item of items ?? []) {
              try { await createCatalogItem(result.id, { code: item.code, name: item.name, unit: item.unit, unitCost: item.unitCost, unitPrice: item.unitPrice, category: item.category, metadata: item.metadata }); created.catalogItems++; } catch (e: any) { errors.push(`Catalog Item "${item.name}" in "${cat.name}": ${e.message}`); }
            }
          }
        } catch (e: any) { errors.push(`Catalog "${cat.name}": ${e.message}`); }
      }
    }
    sectionsComplete++;
  }

  // ── 6. Entity Categories (resolve catalogName → catalogId) ──
  if (isEnabled("entityCategories")) {
    progress("Entity Categories");
    if (mode === "overwrite") {
      await deleteAllEntityCategories(errors, deleted);
      for (const ec of data.entityCategories ?? []) {
        try {
          const { catalogName, ...ecData } = ec;
          const catalogId = catalogName ? catalogNameToId.get(catalogName) ?? null : null;
          await createEntityCategory({ ...ecData, catalogId } as any);
          created.entityCategories++;
        } catch (e: any) { errors.push(`Category "${ec.name}": ${e.message}`); }
      }
    } else {
      const existing = await getEntityCategories();
      const existingByName = new Map(existing.map((e) => [e.name, e]));
      for (const ec of data.entityCategories ?? []) {
        try {
          const { catalogName, ...ecData } = ec;
          const catalogId = catalogName ? catalogNameToId.get(catalogName) ?? null : null;
          const match = existingByName.get(ec.name);
          if (match) {
            await updateEntityCategory(match.id, { ...ecData, catalogId } as any);
            updated.entityCategories++;
          } else {
            await createEntityCategory({ ...ecData, catalogId } as any);
            created.entityCategories++;
          }
        } catch (e: any) { errors.push(`Category "${ec.name}": ${e.message}`); }
      }
    }
    sectionsComplete++;
  }

  // ── 7. Labour Cost Tables (with entries) ──
  if (isEnabled("labourCostTables")) {
    progress("Labour Cost Tables");
    if (mode === "overwrite") {
      await deleteAllLabourCostTables(errors, deleted);
      for (const table of data.labourCostTables ?? []) {
        try {
          const { entries, ...tableData } = table;
          const result = await createLabourCostTable(tableData as any);
          created.labourCostTables++;
          for (const entry of entries ?? []) {
            try { await createLabourCostEntry(result.id, entry); } catch (e: any) { errors.push(`Labour Entry "${entry.name}" in "${table.name}": ${e.message}`); }
          }
        } catch (e: any) { errors.push(`Labour Cost Table "${table.name}": ${e.message}`); }
      }
    } else {
      const existing = await listLabourCostTables();
      const existingByName = new Map(existing.map((e) => [e.name, e]));
      for (const table of data.labourCostTables ?? []) {
        try {
          const { entries, ...tableData } = table;
          const match = existingByName.get(table.name);
          if (match) {
            await updateLabourCostTable(match.id, tableData as any);
            updated.labourCostTables++;
            // Match entries by code or name
            const detail = await getLabourCostTable(match.id);
            const existingEntries = new Map<string, any>(((detail as any).entries ?? []).map((e: any) => [e.code || e.name, e]));
            for (const entry of entries ?? []) {
              try {
                const eMatch = existingEntries.get(entry.code || entry.name);
                if (eMatch) {
                  await updateLabourCostEntry(match.id, eMatch.id, entry);
                } else {
                  await createLabourCostEntry(match.id, entry);
                }
              } catch (e: any) { errors.push(`Labour Entry "${entry.name}" in "${table.name}": ${e.message}`); }
            }
          } else {
            const result = await createLabourCostTable(tableData as any);
            created.labourCostTables++;
            for (const entry of entries ?? []) {
              try { await createLabourCostEntry(result.id, entry); } catch (e: any) { errors.push(`Labour Entry "${entry.name}" in "${table.name}": ${e.message}`); }
            }
          }
        } catch (e: any) { errors.push(`Labour Cost Table "${table.name}": ${e.message}`); }
      }
    }
    sectionsComplete++;
  }

  // ── 8. Rate Schedules (resolve travelPolicyName, with tiers + items) ──
  if (isEnabled("rateSchedules")) {
    progress("Rate Schedules");
    if (mode === "overwrite") {
      await deleteAllRateSchedules(errors, deleted);
    }

    // In add mode, load existing for name matching
    let existingByName = new Map<string, any>();
    if (mode === "add") {
      const existing = await listRateSchedules();
      existingByName = new Map(existing.filter((s) => (s as any).scope === "global" || !(s as any).scope).map((s) => [s.name, s]));
    }

    for (const rs of data.rateSchedules ?? []) {
      try {
        const { tiers, items, travelPolicyName, ...rsData } = rs;
        const travelPolicyId = travelPolicyName ? travelPolicyNameToId.get(travelPolicyName) ?? undefined : undefined;

        const match = mode === "add" ? existingByName.get(rs.name) : null;

        // Build old-tier-ID → tier-name mapping for old-format exports (rates keyed by tier IDs).
        // Strategy: the export tiers are ordered by sortOrder with known multipliers (1.0, 1.5, 2.0).
        // We sort the old tier IDs from the first item's rates by value (ascending) and match them
        // to tiers sorted by multiplier (ascending), so lowest rate → lowest multiplier tier.
        const exportTiersSorted = [...(tiers ?? [])].sort((a, b) => (a.multiplier ?? 1) - (b.multiplier ?? 1));
        const oldTierIdToName = new Map<string, string>();
        if ((items ?? []).length > 0 && (tiers ?? []).length > 0) {
          const firstRates = items![0].rates ?? {};
          const rateKeys = Object.keys(firstRates);
          // Detect if keys are old tier IDs (not tier names)
          const keysAreTierNames = rateKeys.some((k) => exportTiersSorted.some((t) => t.name === k));
          if (!keysAreTierNames && rateKeys.length === exportTiersSorted.length) {
            const sortedByValue = [...rateKeys].sort((a, b) => (firstRates[a] ?? 0) - (firstRates[b] ?? 0));
            for (let i = 0; i < sortedByValue.length; i++) {
              oldTierIdToName.set(sortedByValue[i], exportTiersSorted[i].name);
            }
          }
        }

        // Remap rates: handles both tier-name keys (new format) and old-tier-ID keys (old format)
        function remapRates(rates: Record<string, number> | undefined, tierNameToId: Map<string, string>): Record<string, number> {
          if (!rates) return {};
          const out: Record<string, number> = {};
          for (const [key, val] of Object.entries(rates)) {
            // Try direct name→ID match first (new export format)
            const directId = tierNameToId.get(key);
            if (directId) { out[directId] = val; continue; }
            // Try old-tier-ID→name→new-ID (old export format)
            const tierName = oldTierIdToName.get(key);
            if (tierName) {
              const newId = tierNameToId.get(tierName);
              if (newId) { out[newId] = val; continue; }
            }
            // Fallback: keep as-is
            out[key] = val;
          }
          return out;
        }

        if (match) {
          // Update existing rate schedule
          await updateRateSchedule(match.id, {
            name: rsData.name,
            description: rsData.description,
            category: rsData.category,
            defaultMarkup: rsData.defaultMarkup,
            autoCalculate: rsData.autoCalculate,
          });
          updated.rateSchedules++;

          // Delete existing tiers and items, then recreate
          const detail = await getRateSchedule(match.id);
          for (const existingTier of (detail as any).tiers ?? []) {
            try { await deleteRateScheduleTier(match.id, existingTier.id); } catch { /* ignore */ }
          }
          for (const existingItem of (detail as any).items ?? []) {
            try { await deleteRateScheduleItem(match.id, existingItem.id); } catch { /* ignore */ }
          }

          for (const tier of tiers ?? []) {
            try { await addRateScheduleTier(match.id, tier); } catch (e: any) { errors.push(`Rate Tier "${tier.name}" in "${rs.name}": ${e.message}`); }
          }
          // Fetch schedule to get new tier IDs, build name→ID map
          const refreshed = await getRateSchedule(match.id);
          const tierNameToId = new Map<string, string>(((refreshed as any).tiers ?? []).map((t: any) => [t.name, t.id]));
          for (const item of items ?? []) {
            try {
              const mappedRates = remapRates(item.rates ?? {}, tierNameToId);
              const mappedCostRates = remapRates(item.costRates ?? item.rates ?? {}, tierNameToId);
              await addRateScheduleItem(match.id, { code: item.code, name: item.name, unit: item.unit, rates: mappedRates, costRates: mappedCostRates, sortOrder: item.sortOrder });
            } catch (e: any) { errors.push(`Rate Item "${item.name}" in "${rs.name}": ${e.message}`); }
          }
          if (travelPolicyId) {
            try { await updateRateSchedule(match.id, { travelPolicyId } as any); } catch { /* non-critical */ }
          }
        } else {
          // Create new rate schedule
          const result = await createRateSchedule({
            name: rsData.name,
            description: rsData.description,
            category: rsData.category,
            defaultMarkup: rsData.defaultMarkup,
            autoCalculate: rsData.autoCalculate,
          });
          created.rateSchedules++;

          for (const tier of tiers ?? []) {
            try { await addRateScheduleTier(result.id, tier); } catch (e: any) { errors.push(`Rate Tier "${tier.name}" in "${rs.name}": ${e.message}`); }
          }
          // Fetch schedule to get new tier IDs, build name→ID map
          const refreshed = await getRateSchedule(result.id);
          const tierNameToId = new Map<string, string>(((refreshed as any).tiers ?? []).map((t: any) => [t.name, t.id]));
          for (const item of items ?? []) {
            try {
              const mappedRates = remapRates(item.rates ?? {}, tierNameToId);
              const mappedCostRates = remapRates(item.costRates ?? item.rates ?? {}, tierNameToId);
              await addRateScheduleItem(result.id, { code: item.code, name: item.name, unit: item.unit, rates: mappedRates, costRates: mappedCostRates, sortOrder: item.sortOrder });
            } catch (e: any) { errors.push(`Rate Item "${item.name}" in "${rs.name}": ${e.message}`); }
          }
          if (travelPolicyId) {
            try { await updateRateSchedule(result.id, { travelPolicyId } as any); } catch { /* non-critical */ }
          }
        }
      } catch (e: any) { errors.push(`Rate Schedule "${rs.name}": ${e.message}`); }
    }
    sectionsComplete++;
  }

  progress("Complete");
  return { created, updated, deleted, errors };
}
