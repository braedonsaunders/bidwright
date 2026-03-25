/**
 * Standalone script to seed plugins from packages/db/seed-plugins/.
 * Run: npx tsx src/run-seed-plugins.ts
 */
import { PrismaClient } from "@prisma/client";
import { seedPluginTemplates } from "./seed-plugins.js";

async function main() {
  const prisma = new PrismaClient();
  await prisma.$connect();

  const org = await prisma.organization.findFirst({ orderBy: { createdAt: "asc" } });
  if (!org) {
    console.error("No organization found. Run the full seed first.");
    process.exitCode = 1;
    return;
  }

  console.log(`Seeding plugins into organization: ${org.name} (${org.id})`);
  await seedPluginTemplates(prisma, org.id);
  await prisma.$disconnect();
  console.log("Done.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
