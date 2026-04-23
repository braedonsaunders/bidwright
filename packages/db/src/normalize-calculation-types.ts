import { PrismaClient } from "@prisma/client";

const CALCULATION_TYPE_RENAMES: Record<string, string> = {
  auto_labour: "tiered_rate",
  auto_equipment: "duration_rate",
  auto_stock: "unit_markup",
  auto_consumable: "quantity_markup",
  auto_subcontract: "unit_markup",
  direct_price: "direct_total",
};

async function main() {
  const prisma = new PrismaClient();

  try {
    await prisma.$connect();

    let updated = 0;
    for (const [legacyType, genericType] of Object.entries(CALCULATION_TYPE_RENAMES)) {
      const result = await prisma.entityCategory.updateMany({
        where: { calculationType: legacyType },
        data: { calculationType: genericType },
      });
      updated += result.count;
    }

    console.log(`Normalized ${updated} category calculation type${updated === 1 ? "" : "s"}.`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
