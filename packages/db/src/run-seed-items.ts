import { prisma } from "./client.js";
import { seedCatalogTemplates } from "./seed-items.js";

async function main() {
  await seedCatalogTemplates(prisma as any);
  await prisma.$disconnect();
  console.log("Done!");
}
main().catch(console.error);
