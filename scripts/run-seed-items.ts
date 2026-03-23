import { PrismaClient } from "@prisma/client";
import { seedCatalogTemplates } from "../packages/db/src/seed-items.js";

async function main() {
  const prisma = new PrismaClient();
  await prisma.$connect();
  await seedCatalogTemplates(prisma);
  await prisma.$disconnect();
  console.log("Done!");
}
main().catch(console.error);
