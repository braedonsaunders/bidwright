/**
 * Standalone script to seed plugins from packages/db/seed-plugins/.
 * Run: npx tsx src/run-seed-plugins.ts
 */
import { PrismaClient } from "@prisma/client";
import { seedPluginTemplates } from "./seed-plugins.js";

async function main() {
  const prisma = new PrismaClient();
  await prisma.$connect();

  const organizations = await prisma.organization.findMany({ orderBy: { createdAt: "asc" } });
  if (organizations.length === 0) {
    console.error("No organizations found. Run the full seed first.");
    process.exitCode = 1;
    return;
  }

  for (const organization of organizations) {
    console.log(`Seeding plugins into organization: ${organization.name} (${organization.id})`);
    await seedPluginTemplates(prisma, organization.id);
  }
  await prisma.$disconnect();
  console.log("Done.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
