/**
 * Standalone script to seed dataset templates from packages/db/seed-datasets/.
 * Run: npx tsx src/run-seed-datasets.ts
 */
import { PrismaClient } from "@prisma/client";
import { seedDatasetTemplates } from "./seed-datasets.js";

async function main() {
  const prisma = new PrismaClient();
  await prisma.$connect();
  await seedDatasetTemplates(prisma);
  await prisma.$disconnect();
  console.log("Done.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
