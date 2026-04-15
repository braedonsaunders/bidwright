// Extract all worksheet items for the Soprema Tillsonburg project.
import { PrismaClient } from '../../packages/db/node_modules/@prisma/client/index.js';

const prisma = new PrismaClient({
  datasources: {
    db: {
      url: process.env.DATABASE_URL || 'postgresql://bidwright:bidwright@localhost:5432/bidwright',
    },
  },
});

const PROJECT_ID = 'project-eb609d00-becb-4197-a0fd-a37554798f03';

const WORKSHEET_IDS = [
  'worksheet-07a4810b-91e6-4a84-bb1f-674796b0190f',
  'worksheet-3d2760a2-eec4-4872-9b52-cf1dd825af12',
  'worksheet-76d642c5-c67b-45dc-ad1c-0c8c622fe2f1',
  'worksheet-1b43130c-1b6c-47f2-ae87-14ebd18e9cd4',
  'worksheet-638ece7e-1442-4873-8f32-6cc09808a164',
  'worksheet-2439c057-0e75-4f15-a398-490cf2fbc216',
  'worksheet-0d04e32d-713f-4270-997d-30b7e0cc0e3f',
  'worksheet-2c35cb55-2870-4aa7-b114-dca73d0d270e',
  'worksheet-eff57845-391f-445f-8c15-caa8f9ea8454',
  'worksheet-562a0bed-db0a-45a8-aebc-2b130c6911c5',
  'worksheet-460ddbd6-66c5-491e-8d7a-628370e5423c',
  'worksheet-53b9c834-4921-4fb7-99b9-e8a7e143dee6',
  'worksheet-37defb8e-7e6d-4b44-9a6d-ff26508f5180',
  'worksheet-d112422f-0e7c-4112-a923-3a2e5dda8be7',
];

async function main() {
  // 1. Verify project exists
  const project = await prisma.project.findUnique({ where: { id: PROJECT_ID } });
  if (!project) {
    console.error('Project not found!');
    process.exit(1);
  }
  console.log(`\n=== PROJECT: ${project.name} ===`);
  console.log(`Client: ${project.clientName}`);
  console.log(`Location: ${project.location}\n`);

  // 2. Get quote and current revision
  const quotes = await prisma.quote.findMany({
    where: { projectId: PROJECT_ID },
    include: {
      revisions: {
        include: {
          rateSchedules: {
            include: { items: true, tiers: true },
          },
          phases: true,
        },
      },
    },
  });

  console.log(`Quotes found: ${quotes.length}`);

  for (const quote of quotes) {
    console.log(`\nQuote: ${quote.title || quote.quoteNumber} (status: ${quote.status})`);
    console.log(`Current revision ID: ${quote.currentRevisionId}`);

    for (const rev of quote.revisions) {
      console.log(`\n  Revision #${rev.revisionNumber}: "${rev.title}" (id: ${rev.id})`);

      // Show rate schedules for this revision
      if (rev.rateSchedules.length > 0) {
        console.log(`\n  --- Rate Schedules ---`);
        for (const rs of rev.rateSchedules) {
          console.log(`  Schedule: ${rs.name} (category: ${rs.category})`);
          console.log(`    Tiers: ${rs.tiers.map(t => `${t.name}(x${t.multiplier})`).join(', ')}`);
          for (const item of rs.items) {
            console.log(`    Item: ${item.code} - ${item.name} | unit=${item.unit} | rates=${JSON.stringify(item.rates)} | costRates=${JSON.stringify(item.costRates)} | burden=${item.burden} | perDiem=${item.perDiem}`);
          }
        }
      }

      // Show phases
      if (rev.phases.length > 0) {
        console.log(`\n  --- Phases ---`);
        for (const ph of rev.phases) {
          console.log(`  Phase: ${ph.number} - ${ph.name}`);
        }
      }
    }
  }

  // 3. Fetch all worksheets with items
  console.log('\n\n========================================');
  console.log('  ALL WORKSHEET ITEMS');
  console.log('========================================\n');

  let totalItems = 0;
  let totalLabourItems = 0;
  let grandTotalCost = 0;
  let grandTotalPrice = 0;

  for (const wsId of WORKSHEET_IDS) {
    const ws = await prisma.worksheet.findUnique({
      where: { id: wsId },
      include: {
        items: {
          orderBy: { lineOrder: 'asc' },
        },
      },
    });

    if (!ws) {
      console.log(`[MISSING] Worksheet ${wsId} not found`);
      continue;
    }

    console.log(`\n--- ${ws.name} (${ws.items.length} items) ---`);
    console.log(`Worksheet ID: ${ws.id}`);
    console.log('-'.repeat(180));
    console.log(
      'Line'.padEnd(5) +
      'Category'.padEnd(12) +
      'EntityType'.padEnd(14) +
      'EntityName'.padEnd(30) +
      'Description'.padEnd(40) +
      'Qty'.padEnd(10) +
      'UOM'.padEnd(8) +
      'Unit1(RegHr)'.padEnd(14) +
      'Unit2(OTHr)'.padEnd(14) +
      'Unit3(DTHr)'.padEnd(14) +
      'Cost'.padEnd(14) +
      'Markup'.padEnd(10) +
      'Price'.padEnd(14) +
      'TierUnits'
    );
    console.log('-'.repeat(180));

    let wsCost = 0;
    let wsPrice = 0;

    for (const item of ws.items) {
      totalItems++;
      if (item.category === 'Labour' || item.entityType === 'Labour') {
        totalLabourItems++;
      }

      const extCost = item.quantity * item.cost;
      const extPrice = item.quantity * item.price;
      wsCost += extCost;
      wsPrice += extPrice;

      const tierUnitsStr = JSON.stringify(item.tierUnits);

      console.log(
        String(item.lineOrder).padEnd(5) +
        item.category.padEnd(12) +
        item.entityType.padEnd(14) +
        (item.entityName || '').substring(0, 28).padEnd(30) +
        (item.description || '').substring(0, 38).padEnd(40) +
        String(item.quantity).padEnd(10) +
        item.uom.padEnd(8) +
        String(item.unit1).padEnd(14) +
        String(item.unit2).padEnd(14) +
        String(item.unit3).padEnd(14) +
        String(item.cost.toFixed(2)).padEnd(14) +
        String(item.markup.toFixed(2)).padEnd(10) +
        String(item.price.toFixed(2)).padEnd(14) +
        (tierUnitsStr !== '{}' ? tierUnitsStr : '')
      );
    }

    console.log('-'.repeat(180));
    console.log(`  Worksheet Totals: Extended Cost = $${wsCost.toFixed(2)} | Extended Price = $${wsPrice.toFixed(2)}`);
    grandTotalCost += wsCost;
    grandTotalPrice += wsPrice;
  }

  console.log('\n\n========================================');
  console.log('  SUMMARY');
  console.log('========================================');
  console.log(`Total items across all worksheets: ${totalItems}`);
  console.log(`Total labour items: ${totalLabourItems}`);
  console.log(`Grand Total Extended Cost: $${grandTotalCost.toFixed(2)}`);
  console.log(`Grand Total Extended Price: $${grandTotalPrice.toFixed(2)}`);

  // 4. Labour-focused detail
  console.log('\n\n========================================');
  console.log('  LABOUR ITEMS DETAIL');
  console.log('========================================\n');

  const allLabourItems = await prisma.worksheetItem.findMany({
    where: {
      worksheetId: { in: WORKSHEET_IDS },
      OR: [
        { category: 'Labour' },
        { entityType: 'Labour' },
      ],
    },
    include: { worksheet: true },
    orderBy: [{ worksheetId: 'asc' }, { lineOrder: 'asc' }],
  });

  console.log(`Found ${allLabourItems.length} labour items:\n`);

  console.log(
    'Worksheet'.padEnd(30) +
    'EntityName'.padEnd(30) +
    'Description'.padEnd(40) +
    'Qty'.padEnd(10) +
    'RegHr'.padEnd(12) +
    'OTHr'.padEnd(12) +
    'DTHr'.padEnd(12) +
    'Cost/unit'.padEnd(14) +
    'Price/unit'.padEnd(14) +
    'ExtCost'.padEnd(14) +
    'ExtPrice'.padEnd(14) +
    'TierUnits'
  );
  console.log('-'.repeat(210));

  let labourTotalCost = 0;
  let labourTotalPrice = 0;
  let totalRegHours = 0;
  let totalOTHours = 0;
  let totalDTHours = 0;

  for (const item of allLabourItems) {
    const extCost = item.quantity * item.cost;
    const extPrice = item.quantity * item.price;
    labourTotalCost += extCost;
    labourTotalPrice += extPrice;

    const regHrs = item.quantity * item.unit1;
    const otHrs = item.quantity * item.unit2;
    const dtHrs = item.quantity * item.unit3;
    totalRegHours += regHrs;
    totalOTHours += otHrs;
    totalDTHours += dtHrs;

    const tierUnitsStr = JSON.stringify(item.tierUnits);

    console.log(
      (item.worksheet.name || '').substring(0, 28).padEnd(30) +
      (item.entityName || '').substring(0, 28).padEnd(30) +
      (item.description || '').substring(0, 38).padEnd(40) +
      String(item.quantity).padEnd(10) +
      String(item.unit1).padEnd(12) +
      String(item.unit2).padEnd(12) +
      String(item.unit3).padEnd(12) +
      String(item.cost.toFixed(2)).padEnd(14) +
      String(item.price.toFixed(2)).padEnd(14) +
      String(extCost.toFixed(2)).padEnd(14) +
      String(extPrice.toFixed(2)).padEnd(14) +
      (tierUnitsStr !== '{}' ? tierUnitsStr : '')
    );
  }

  console.log('-'.repeat(210));
  console.log(`\nLabour Summary:`);
  console.log(`  Total Labour Items: ${allLabourItems.length}`);
  console.log(`  Total Regular Hours: ${totalRegHours.toFixed(2)}`);
  console.log(`  Total OT Hours: ${totalOTHours.toFixed(2)}`);
  console.log(`  Total DT Hours: ${totalDTHours.toFixed(2)}`);
  console.log(`  Total Labour Extended Cost: $${labourTotalCost.toFixed(2)}`);
  console.log(`  Total Labour Extended Price: $${labourTotalPrice.toFixed(2)}`);

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  prisma.$disconnect();
  process.exit(1);
});
