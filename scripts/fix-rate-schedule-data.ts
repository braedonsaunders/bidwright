/**
 * Fix rate schedule item rates/costRates in the database.
 *
 * The original import stored rates keyed by OLD tier IDs from the export source.
 * The DB has NEW tier IDs. This script reads the export JSON to understand the
 * old-tier-ID-to-tier-name mapping, then remaps each item's rates to use the
 * current DB tier IDs.
 *
 * Also fixes tier multipliers (were imported as 1.0 due to the dual-multiplier
 * schema mismatch).
 *
 * Usage: npx tsx scripts/fix-rate-schedule-data.ts <path-to-export-json>
 */

const API_BASE = "http://localhost:3001";

async function api(path: string, opts?: RequestInit) {
  const res = await fetch(`${API_BASE}${path}`, {
    ...opts,
    headers: { "Content-Type": "application/json", ...opts?.headers },
  });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} — ${path}`);
  return res.json();
}

async function main() {
  const exportPath = process.argv[2];
  if (!exportPath) {
    console.error("Usage: npx tsx scripts/fix-rate-schedule-data.ts <path-to-export.json>");
    process.exit(1);
  }

  const fs = await import("fs");
  const exportData = JSON.parse(fs.readFileSync(exportPath, "utf-8"));
  const exportSchedules: any[] = exportData.rateSchedules ?? [];

  console.log(`Loaded ${exportSchedules.length} rate schedules from export file`);

  // Build export lookup: schedule name → { tiers, items }
  // The export has tiers with names and items with rates keyed by OLD tier IDs
  const exportByName = new Map<string, any>();
  for (const s of exportSchedules) {
    exportByName.set(s.name, s);
  }

  // List all DB rate schedules
  const dbSchedules: any[] = await api("/api/rate-schedules");
  console.log(`Found ${dbSchedules.length} rate schedules in DB`);

  let fixedSchedules = 0;
  let fixedItems = 0;
  let fixedTiers = 0;

  for (const dbSched of dbSchedules) {
    // Skip project-scoped schedules
    if (dbSched.scope === "revision") continue;

    const exportSched = exportByName.get(dbSched.name);
    if (!exportSched) {
      console.log(`  SKIP: "${dbSched.name}" — not in export file`);
      continue;
    }

    // Get full detail with tiers and items
    const detail = await api(`/api/rate-schedules/${dbSched.id}`);
    const dbTiers: any[] = detail.tiers ?? [];
    const dbItems: any[] = detail.items ?? [];
    const exportTiers: any[] = exportSched.tiers ?? [];
    const exportItems: any[] = exportSched.items ?? [];

    if (dbTiers.length !== exportTiers.length) {
      console.log(`  WARN: "${dbSched.name}" tier count mismatch (db=${dbTiers.length}, export=${exportTiers.length})`);
    }

    // Step 1: Fix tier multipliers
    // Sort both by sortOrder to align
    const dbTiersSorted = [...dbTiers].sort((a, b) => a.sortOrder - b.sortOrder);
    const exportTiersSorted = [...exportTiers].sort((a, b) => a.sortOrder - b.sortOrder);

    // Build: tier name → DB tier ID
    const tierNameToDbId = new Map<string, string>();
    for (const t of dbTiersSorted) tierNameToDbId.set(t.name, t.id);

    // Build: old tier ID → tier name (from export items)
    // We can figure this out by looking at the first export item's rates keys
    // and matching their order to the export tiers order
    const oldTierIdToName = new Map<string, string>();
    if (exportItems.length > 0) {
      const firstItemRates = exportItems[0].rates ?? {};
      const oldTierIds = Object.keys(firstItemRates);

      // The export tiers are ordered by sortOrder. For each tier, figure out
      // which old ID it maps to by looking at all items' rate patterns.
      // Strategy: sort old tier IDs by the first item's rate values (ascending)
      // and match to tiers sorted by multiplier (ascending).
      // Regular (1.0x) should have the lowest rate, OT (1.5x) middle, DT (2.0x) highest.

      if (oldTierIds.length === exportTiersSorted.length) {
        // Sort old IDs by rate value from first item (lowest = base tier)
        const sortedOldIds = [...oldTierIds].sort((a, b) => (firstItemRates[a] ?? 0) - (firstItemRates[b] ?? 0));
        // Sort export tiers by multiplier (ascending)
        const tiersByMult = [...exportTiersSorted].sort((a, b) => (a.multiplier ?? 1) - (b.multiplier ?? 1));

        for (let i = 0; i < sortedOldIds.length; i++) {
          oldTierIdToName.set(sortedOldIds[i], tiersByMult[i].name);
        }
      }
    }

    // Fix tier multipliers if they're all 1.0 (broken by the dual-multiplier migration)
    for (let i = 0; i < Math.min(dbTiersSorted.length, exportTiersSorted.length); i++) {
      const dbTier = dbTiersSorted[i];
      const exportTier = exportTiersSorted[i];
      if (dbTier.name === exportTier.name && dbTier.multiplier !== exportTier.multiplier) {
        try {
          await api(`/api/rate-schedules/${dbSched.id}/tiers/${dbTier.id}`, {
            method: "PATCH",
            body: JSON.stringify({ multiplier: exportTier.multiplier }),
          });
          fixedTiers++;
        } catch (e: any) {
          console.log(`  ERR fixing tier "${dbTier.name}": ${e.message}`);
        }
      }
    }

    // Step 2: Fix item rates
    // For each DB item, find matching export item by name+code, remap rates
    for (const dbItem of dbItems) {
      const exportItem = exportItems.find(
        (ei: any) => (ei.code && ei.code === dbItem.code) || ei.name === dbItem.name
      );
      if (!exportItem) continue;

      const exportRates = exportItem.rates ?? {};
      const exportCostRates = exportItem.costRates ?? exportRates; // costRates may not be in old exports

      // Check if rates need fixing (are they keyed by old IDs that don't match DB tier IDs?)
      const dbTierIds = new Set(dbTiers.map((t: any) => t.id));
      const rateKeys = Object.keys(dbItem.rates ?? {});
      const alreadyCorrect = rateKeys.length > 0 && rateKeys.every((k) => dbTierIds.has(k));

      if (alreadyCorrect && rateKeys.length > 0) {
        // Check if values are non-zero
        const hasValues = Object.values(dbItem.rates ?? {}).some((v: any) => v !== 0);
        if (hasValues) continue; // Already looks correct
      }

      // Remap export rates (keyed by old tier IDs) to new tier IDs
      const newRates: Record<string, number> = {};
      const newCostRates: Record<string, number> = {};

      for (const [oldKey, val] of Object.entries(exportRates)) {
        const tierName = oldTierIdToName.get(oldKey) ?? oldKey; // might already be a name
        const dbTierId = tierNameToDbId.get(tierName);
        if (dbTierId) {
          newRates[dbTierId] = val as number;
        }
      }

      for (const [oldKey, val] of Object.entries(exportCostRates)) {
        const tierName = oldTierIdToName.get(oldKey) ?? oldKey;
        const dbTierId = tierNameToDbId.get(tierName);
        if (dbTierId) {
          newCostRates[dbTierId] = val as number;
        }
      }

      if (Object.keys(newRates).length > 0) {
        try {
          await api(`/api/rate-schedules/${dbSched.id}/items/${dbItem.id}`, {
            method: "PATCH",
            body: JSON.stringify({ rates: newRates, costRates: newCostRates }),
          });
          fixedItems++;
        } catch (e: any) {
          console.log(`  ERR fixing item "${dbItem.name}" in "${dbSched.name}": ${e.message}`);
        }
      }
    }

    fixedSchedules++;
    if (fixedSchedules % 10 === 0) console.log(`  Progress: ${fixedSchedules}/${dbSchedules.length} schedules...`);
  }

  console.log(`\nDone! Fixed ${fixedTiers} tiers, ${fixedItems} items across ${fixedSchedules} schedules.`);
}

main().catch((e) => { console.error(e); process.exit(1); });
