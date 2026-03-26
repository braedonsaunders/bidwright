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
  createEntityCategory,
  listRateSchedules,
  getRateSchedule,
  createRateSchedule,
  addRateScheduleTier,
  addRateScheduleItem,
  listLabourCostTables,
  createLabourCostTable,
  createLabourCostEntry,
  listBurdenPeriods,
  createBurdenPeriod,
  listTravelPolicies,
  createTravelPolicy,
  getCustomers,
  getCustomer,
  createCustomer,
  createCustomerContact,
  getConditionLibrary,
  createConditionLibraryEntry,
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
  errors: string[];
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

    rateSchedules: rateScheduleDetails.map((s: any) => ({
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
        rates: i.rates,
        metadata: i.metadata || {},
        sortOrder: i.sortOrder,
      })),
    })),

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

const IMPORT_SECTIONS = [
  "Condition Library",
  "Travel Policies",
  "Burden Periods",
  "Customers",
  "Catalogs",
  "Entity Categories",
  "Labour Cost Tables",
  "Rate Schedules",
] as const;

export async function importAllDataManagement(
  data: BidwrightExportData,
  onProgress: (p: ImportProgress) => void,
): Promise<ImportResult> {
  const errors: string[] = [];
  const created: ImportSummary = {
    entityCategories: 0, catalogs: 0, catalogItems: 0,
    rateSchedules: 0, labourCostTables: 0, burdenPeriods: 0,
    travelPolicies: 0, customers: 0, conditionLibrary: 0,
  };

  const travelPolicyNameToId = new Map<string, string>();
  const catalogNameToId = new Map<string, string>();
  let sectionsComplete = 0;

  function progress(section: string) {
    onProgress({ currentSection: section, sectionsComplete, totalSections: IMPORT_SECTIONS.length, errors: [...errors] });
  }

  // 1. Condition Library
  progress("Condition Library");
  for (const entry of data.conditionLibrary ?? []) {
    try {
      await createConditionLibraryEntry({ type: entry.type, value: entry.value });
      created.conditionLibrary++;
    } catch (e: any) {
      errors.push(`Condition "${entry.value}": ${e.message}`);
    }
  }
  sectionsComplete++;

  // 2. Travel Policies
  progress("Travel Policies");
  for (const tp of data.travelPolicies ?? []) {
    try {
      const result = await createTravelPolicy(tp as any);
      travelPolicyNameToId.set(tp.name, result.id);
      created.travelPolicies++;
    } catch (e: any) {
      errors.push(`Travel Policy "${tp.name}": ${e.message}`);
    }
  }
  sectionsComplete++;

  // 3. Burden Periods
  progress("Burden Periods");
  for (const bp of data.burdenPeriods ?? []) {
    try {
      await createBurdenPeriod(bp);
      created.burdenPeriods++;
    } catch (e: any) {
      errors.push(`Burden Period "${bp.name}": ${e.message}`);
    }
  }
  sectionsComplete++;

  // 4. Customers (with contacts)
  progress("Customers");
  for (const cust of data.customers ?? []) {
    try {
      const { contacts, ...custData } = cust;
      const result = await createCustomer(custData as any);
      created.customers++;
      for (const contact of contacts ?? []) {
        try {
          await createCustomerContact(result.id, contact as any);
        } catch (e: any) {
          errors.push(`Customer Contact "${contact.name}" for "${cust.name}": ${e.message}`);
        }
      }
    } catch (e: any) {
      errors.push(`Customer "${cust.name}": ${e.message}`);
    }
  }
  sectionsComplete++;

  // 5. Catalogs (with items)
  progress("Catalogs");
  for (const cat of data.catalogs ?? []) {
    try {
      const { items, ...catData } = cat;
      const result = await createCatalog({ name: catData.name, kind: catData.kind, scope: "global", description: catData.description });
      catalogNameToId.set(cat.name, result.id);
      created.catalogs++;
      for (const item of items ?? []) {
        try {
          await createCatalogItem(result.id, {
            code: item.code,
            name: item.name,
            unit: item.unit,
            unitCost: item.unitCost,
            unitPrice: item.unitPrice,
            category: item.category,
            metadata: item.metadata,
          });
          created.catalogItems++;
        } catch (e: any) {
          errors.push(`Catalog Item "${item.name}" in "${cat.name}": ${e.message}`);
        }
      }
    } catch (e: any) {
      errors.push(`Catalog "${cat.name}": ${e.message}`);
    }
  }
  sectionsComplete++;

  // 6. Entity Categories (resolve catalogName → catalogId)
  progress("Entity Categories");
  for (const ec of data.entityCategories ?? []) {
    try {
      const { catalogName, ...ecData } = ec;
      const catalogId = catalogName ? catalogNameToId.get(catalogName) ?? null : null;
      await createEntityCategory({ ...ecData, catalogId } as any);
      created.entityCategories++;
    } catch (e: any) {
      errors.push(`Category "${ec.name}": ${e.message}`);
    }
  }
  sectionsComplete++;

  // 7. Labour Cost Tables (with entries)
  progress("Labour Cost Tables");
  for (const table of data.labourCostTables ?? []) {
    try {
      const { entries, ...tableData } = table;
      const result = await createLabourCostTable(tableData as any);
      created.labourCostTables++;
      for (const entry of entries ?? []) {
        try {
          await createLabourCostEntry(result.id, entry);
          // Note: createLabourCostEntry returns the full table, not an individual entry
        } catch (e: any) {
          errors.push(`Labour Entry "${entry.name}" in "${table.name}": ${e.message}`);
        }
      }
    } catch (e: any) {
      errors.push(`Labour Cost Table "${table.name}": ${e.message}`);
    }
  }
  sectionsComplete++;

  // 8. Rate Schedules (resolve travelPolicyName, with tiers + items)
  progress("Rate Schedules");
  for (const rs of data.rateSchedules ?? []) {
    try {
      const { tiers, items, travelPolicyName, ...rsData } = rs;
      const travelPolicyId = travelPolicyName ? travelPolicyNameToId.get(travelPolicyName) ?? undefined : undefined;
      const result = await createRateSchedule({
        name: rsData.name,
        description: rsData.description,
        category: rsData.category,
        defaultMarkup: rsData.defaultMarkup,
        autoCalculate: rsData.autoCalculate,
      });
      created.rateSchedules++;

      // Add tiers first (items may reference tier rates)
      for (const tier of tiers ?? []) {
        try {
          await addRateScheduleTier(result.id, tier);
        } catch (e: any) {
          errors.push(`Rate Tier "${tier.name}" in "${rs.name}": ${e.message}`);
        }
      }

      // Then add items
      for (const item of items ?? []) {
        try {
          await addRateScheduleItem(result.id, {
            code: item.code,
            name: item.name,
            unit: item.unit,
            rates: item.rates,
            sortOrder: item.sortOrder,
          });
        } catch (e: any) {
          errors.push(`Rate Item "${item.name}" in "${rs.name}": ${e.message}`);
        }
      }

      // Link travel policy if resolved
      if (travelPolicyId) {
        try {
          const { updateRateSchedule } = await import("./api");
          await updateRateSchedule(result.id, { travelPolicyId } as any);
        } catch {
          // non-critical
        }
      }
    } catch (e: any) {
      errors.push(`Rate Schedule "${rs.name}": ${e.message}`);
    }
  }
  sectionsComplete++;

  progress("Complete");
  return { created, errors };
}
