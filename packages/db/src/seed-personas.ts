import { PrismaClient } from "@prisma/client";
import { seedEstimatorPersonas } from "./seed-data.js";

async function main() {
  const prisma = new PrismaClient();
  await prisma.$connect();

  const orgs = await prisma.organization.findMany({ orderBy: { createdAt: "asc" } });
  if (orgs.length === 0) {
    console.log("No organizations found.");
    await prisma.$disconnect();
    return;
  }

  console.log(`Seeding estimator personas for ${orgs.length} organization(s).`);
  for (const org of orgs) {
    console.log(`\n→ ${org.name} (${org.slug})`);
    await seedEstimatorPersonas(prisma, org.id);
  }

  await prisma.$disconnect();
  console.log("\nDone.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
