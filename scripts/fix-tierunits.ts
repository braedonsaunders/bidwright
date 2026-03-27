/**
 * Fix truncated tierUnits keys in WorksheetItems.
 *
 * Problem: Some worksheet items have tierUnits keys that are truncated
 * (e.g. "rst-f6d2116a" instead of the full CUID tier ID). This causes
 * price/cost calculations to silently produce $0 because the keys don't
 * match any rate in the RateScheduleItem.rates map.
 *
 * This script:
 *  1. Finds all worksheet items where tierUnits is non-empty
 *  2. Checks if the tierUnits keys match actual RateScheduleTier IDs
 *  3. Prefix-matches truncated keys to the real tier IDs
 *  4. Recalculates price = sum(rate[tierId] * hours) * quantity
 *  5. Updates the database
 *  6. Recalculates revision totals (subtotal, cost, etc.)
 *
 * Usage: npx tsx scripts/fix-tierunits.ts
 */

import { prisma } from "../packages/db/src/client.js";

function round(v: number): number {
  return Math.round(v * 100) / 100;
}

async function main() {
  console.log("=== Fix Truncated tierUnits Keys ===\n");

  // 1. Find all worksheet items with non-empty tierUnits
  const allItems = await prisma.worksheetItem.findMany({
    where: {
      NOT: { tierUnits: { equals: {} as any } },
    },
    include: {
      worksheet: {
        include: {
          revision: {
            include: {
              rateSchedules: {
                include: {
                  tiers: true,
                  items: true,
                },
              },
            },
          },
        },
      },
    },
  });

  console.log(`Found ${allItems.length} worksheet item(s) with non-empty tierUnits.\n`);

  // Filter to items where tierUnits actually has keys
  const itemsWithTierUnits = allItems.filter((item) => {
    const tu = item.tierUnits as Record<string, unknown>;
    return tu && typeof tu === "object" && Object.keys(tu).length > 0;
  });

  console.log(`Of those, ${itemsWithTierUnits.length} have actual tier keys.\n`);

  let fixedCount = 0;
  const revisionsToSync = new Set<string>();

  for (const item of itemsWithTierUnits) {
    const tierUnits = item.tierUnits as Record<string, number>;
    const revision = item.worksheet.revision;
    const rateSchedules = revision.rateSchedules;

    if (rateSchedules.length === 0) {
      console.log(`  [SKIP] Item "${item.entityName}" (${item.id}) — no rate schedules on revision ${revision.id}`);
      continue;
    }

    // Collect all valid tier IDs across all rate schedules for this revision
    const allTierIds = rateSchedules.flatMap((rs) => rs.tiers.map((t) => t.id));

    // Check if any tierUnits key is NOT a valid tier ID
    const tierKeys = Object.keys(tierUnits);
    const brokenKeys = tierKeys.filter((k) => !allTierIds.includes(k));

    if (brokenKeys.length === 0) {
      console.log(`  [OK] Item "${item.entityName}" (${item.id}) — all tier keys valid`);
      continue;
    }

    console.log(`  [BROKEN] Item "${item.entityName}" (${item.id})`);
    console.log(`    tierUnits keys: ${JSON.stringify(tierKeys)}`);
    console.log(`    valid tier IDs: ${JSON.stringify(allTierIds)}`);
    console.log(`    broken keys:    ${JSON.stringify(brokenKeys)}`);

    // Try to fix each broken key via prefix match
    const newTierUnits: Record<string, number> = {};
    let allResolved = true;

    for (const [key, hours] of Object.entries(tierUnits)) {
      if (allTierIds.includes(key)) {
        // Key is valid, keep it
        newTierUnits[key] = hours;
      } else {
        // Try prefix match
        const match = allTierIds.find((tid) => tid.startsWith(key));
        if (match) {
          console.log(`    Mapped "${key}" -> "${match}" (${hours} hours)`);
          newTierUnits[match] = hours;
        } else {
          console.log(`    [WARN] No prefix match for "${key}" — dropping (${hours} hours)`);
          allResolved = false;
        }
      }
    }

    if (!allResolved) {
      console.log(`    [WARN] Not all keys could be resolved; updating with what we have.`);
    }

    // Recalculate price and cost using the corrected tier IDs
    // Find the matching rate schedule item
    let newPrice = 0;
    let newCost = 0;
    let matched = false;

    for (const schedule of rateSchedules) {
      let rsItem = schedule.items.find((i) => i.id === item.rateScheduleItemId);
      if (!rsItem) {
        rsItem = schedule.items.find(
          (i) => i.name === item.entityName || i.code === item.entityName,
        );
      }
      if (!rsItem) continue;

      matched = true;
      const rates = rsItem.rates as Record<string, number>;
      const costRates = rsItem.costRates as Record<string, number>;

      let totalPrice = 0;
      let totalCost = 0;

      for (const [tierId, hours] of Object.entries(newTierUnits)) {
        const h = Number(hours) || 0;
        totalPrice += (rates[tierId] ?? 0) * h;
        totalCost += (costRates[tierId] ?? 0) * h;
      }

      totalPrice *= item.quantity;
      totalCost *= item.quantity;

      // Apply burden if present
      if (rsItem.burden > 0) {
        const totalHours = Object.values(newTierUnits).reduce((s, h) => s + (Number(h) || 0), 0);
        totalCost += rsItem.burden * totalHours * item.quantity;
      }

      newPrice = round(totalPrice);
      newCost = round(totalCost);
      break;
    }

    if (!matched) {
      console.log(`    [WARN] No matching rate schedule item found — skipping price recalc.`);
    }

    console.log(`    Old price: ${item.price}, Old cost: ${item.cost}`);
    console.log(`    New price: ${newPrice}, New cost: ${newCost}`);
    console.log(`    New tierUnits: ${JSON.stringify(newTierUnits)}`);

    // Update the item
    await prisma.worksheetItem.update({
      where: { id: item.id },
      data: {
        tierUnits: newTierUnits,
        price: newPrice,
        cost: newCost,
      },
    });

    fixedCount++;
    revisionsToSync.add(revision.id);
    console.log(`    -> Updated!\n`);
  }

  // Sync revision totals
  if (revisionsToSync.size > 0) {
    console.log(`\n=== Syncing Revision Totals ===`);
    for (const revisionId of revisionsToSync) {
      // Sum up all worksheet items for this revision
      const worksheets = await prisma.worksheet.findMany({
        where: { revisionId },
        include: { items: true },
      });

      let subtotal = 0;
      let totalCost = 0;
      let totalHours = 0;

      for (const ws of worksheets) {
        for (const it of ws.items) {
          subtotal += it.price;
          totalCost += it.cost;
          const tu = it.tierUnits as Record<string, number> | null;
          if (tu && typeof tu === "object") {
            for (const h of Object.values(tu)) {
              totalHours += (Number(h) || 0) * it.quantity;
            }
          }
          // Also count legacy unit1/unit2/unit3 hours
          totalHours += (it.unit1 + it.unit2 + it.unit3) * it.quantity;
        }
      }

      subtotal = round(subtotal);
      totalCost = round(totalCost);
      const estimatedProfit = round(subtotal - totalCost);
      const estimatedMargin = subtotal > 0 ? round(estimatedProfit / subtotal) : 0;

      await prisma.quoteRevision.update({
        where: { id: revisionId },
        data: {
          subtotal,
          cost: totalCost,
          estimatedProfit,
          estimatedMargin,
          calculatedTotal: subtotal,
          totalHours: round(totalHours),
        },
      });

      console.log(`  Revision ${revisionId}: subtotal=${subtotal}, cost=${totalCost}, profit=${estimatedProfit}, margin=${estimatedMargin}, hours=${round(totalHours)}`);
    }
  }

  console.log(`\n=== Done. Fixed ${fixedCount} item(s) across ${revisionsToSync.size} revision(s). ===`);
}

main()
  .catch((err) => {
    console.error("Fatal error:", err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
