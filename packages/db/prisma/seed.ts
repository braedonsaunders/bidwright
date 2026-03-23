import { PrismaClient } from "@prisma/client";
import { seedAllForOrganization } from "../src/seed-data.js";
import { seedDatasetTemplates } from "../src/seed-datasets.js";
import { seedCatalogTemplates } from "../src/seed-items.js";

async function main() {
  const prisma = new PrismaClient();
  await prisma.$connect();

  // Use existing org if one exists (e.g. from setup wizard), otherwise create a default
  const existingOrg = await prisma.organization.findFirst({ orderBy: { createdAt: "asc" } });
  const org = existingOrg ?? await prisma.organization.create({
    data: { id: "default", name: "Default Organization", slug: "default" },
  });
  console.log(`Seeding into organization: ${org.name} (${org.slug})`);

  // Ensure org settings exist
  await prisma.organizationSettings.upsert({
    where: { organizationId: org.id },
    update: {},
    create: { organizationId: org.id },
  });

  await seedAllForOrganization(prisma, org.id);
  await seedDatasetTemplates(prisma);
  await seedCatalogTemplates(prisma);

  await prisma.$disconnect();
  console.log("Done.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
