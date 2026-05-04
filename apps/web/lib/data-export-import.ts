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
  metadata: Record<string, unknown>;
  tiers: ExportRateScheduleTier[];
  items: ExportRateScheduleItem[];
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
  | "customers"
  | "catalogs"
  | "entityCategories"
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
    customers,
    conditionLibrary,
  ] = await Promise.all([
    getEntityCategories(),
    getCatalogs(),
    listRateSchedules(),
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

  // 4. Transform and strip IDs
  const exportData: BidwrightExportData = {
    bidwright_export: {
      version: EXPORT_VERSION,
      exportedAt: new Date().toISOString(),
      sections: ["entityCategories", "catalogs", "rateSchedules", "customers", "conditionLibrary"],
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
    customers: data.customers?.length ?? 0,
    conditionLibrary: data.conditionLibrary?.length ?? 0,
  };

  return { data, summary };
}

// ── Import ──────────────────────────────────────────────────────────────

export const IMPORT_SECTION_LABELS: Record<ImportSectionKey, string> = {
  conditionLibrary: "Inclusions & Exclusions",
  customers: "Customers",
  catalogs: "Catalogs",
  entityCategories: "Entity Categories",
  rateSchedules: "Rate Schedules",
};

/** Section keys in dependency order (import must proceed in this order). */
export const IMPORT_SECTION_ORDER: ImportSectionKey[] = [
  "conditionLibrary",
  "customers",
  "catalogs",
  "entityCategories",
  "rateSchedules",
];

/** Maps summary key to the BidwrightExportData field name. */
const SECTION_SUMMARY_KEY: Record<ImportSectionKey, keyof ImportSummary> = {
  conditionLibrary: "conditionLibrary",
  customers: "customers",
  catalogs: "catalogs",
  entityCategories: "entityCategories",
  rateSchedules: "rateSchedules",
};

function emptySummary(): ImportSummary {
  return { entityCategories: 0, catalogs: 0, catalogItems: 0, rateSchedules: 0, customers: 0, conditionLibrary: 0 };
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

async function deleteAllRateSchedules(errors: string[], deleted: ImportSummary) {
  const existing = await listRateSchedules();
  const globals = existing.filter((s) => (s as any).scope === "global" || !(s as any).scope);
  for (const e of globals) {
    try { await deleteRateSchedule(e.id); deleted.rateSchedules++; } catch (err: any) { errors.push(`Delete rate schedule "${e.name}": ${err.message}`); }
  }
}

const DELETE_FNS: Record<ImportSectionKey, (errors: string[], deleted: ImportSummary) => Promise<void>> = {
  conditionLibrary: deleteAllConditionLibrary,
  customers: deleteAllCustomers,
  catalogs: deleteAllCatalogs,
  entityCategories: deleteAllEntityCategories,
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

  // ── 2. Customers (with contacts) ──
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

  // ── 7. Rate Schedules (with tiers + items) ──
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

    // Build catalog item name → id lookup. Items must be linked to a catalog row.
    const catalogItemNameToId = new Map<string, string>();
    try {
      const allCatalogs = await getCatalogs();
      for (const cat of allCatalogs) {
        const catItems = await listCatalogItems(cat.id);
        for (const ci of catItems) {
          if (ci.name) catalogItemNameToId.set(ci.name, ci.id);
        }
      }
    } catch (e: any) {
      errors.push(`Could not load catalogs for rate-schedule item linking: ${e.message}`);
    }
    function resolveCatalogId(itemName: string, scheduleName: string): string | null {
      const id = catalogItemNameToId.get(itemName);
      if (!id) {
        errors.push(`Rate Item "${itemName}" in "${scheduleName}": no matching catalog item — skipped.`);
        return null;
      }
      return id;
    }

    for (const rs of data.rateSchedules ?? []) {
      try {
        const { tiers, items, ...rsData } = rs;

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
            effectiveDate: rsData.effectiveDate ?? null,
            expiryDate: rsData.expiryDate ?? null,
            metadata: rsData.metadata ?? {},
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
              const catId = resolveCatalogId(item.name, rs.name);
              if (catId) {
                await addRateScheduleItem(match.id, { catalogItemId: catId, rates: mappedRates, costRates: mappedCostRates, sortOrder: item.sortOrder });
              }
            } catch (e: any) { errors.push(`Rate Item "${item.name}" in "${rs.name}": ${e.message}`); }
          }
        } else {
          // Create new rate schedule
          const result = await createRateSchedule({
            name: rsData.name,
            description: rsData.description,
            category: rsData.category,
            defaultMarkup: rsData.defaultMarkup,
            autoCalculate: rsData.autoCalculate,
            effectiveDate: rsData.effectiveDate ?? null,
            expiryDate: rsData.expiryDate ?? null,
            metadata: rsData.metadata ?? {},
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
              const catId = resolveCatalogId(item.name, rs.name);
              if (catId) {
                await addRateScheduleItem(result.id, { catalogItemId: catId, rates: mappedRates, costRates: mappedCostRates, sortOrder: item.sortOrder });
              }
            } catch (e: any) { errors.push(`Rate Item "${item.name}" in "${rs.name}": ${e.message}`); }
          }
        }
      } catch (e: any) { errors.push(`Rate Schedule "${rs.name}": ${e.message}`); }
    }
    sectionsComplete++;
  }

  progress("Complete");
  return { created, updated, deleted, errors };
}
