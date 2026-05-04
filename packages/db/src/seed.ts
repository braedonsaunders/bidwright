import { PrismaClient } from "@prisma/client";
import { seedAllForOrganization } from "./seed-data.js";
import { seedCatalogTemplates } from "./seed-items.js";
import { seedPluginTemplates } from "./seed-plugins.js";

async function main() {
  const prisma = new PrismaClient();
  await prisma.$connect();

  const existingOrg = await prisma.organization.findFirst({ orderBy: { createdAt: "asc" } });
  const org = existingOrg ?? await prisma.organization.create({
    data: { id: "default", name: "Default Organization", slug: "default" },
  });

  console.log(`Seeding into organization: ${org.name} (${org.slug})`);

  await prisma.organizationSettings.upsert({
    where: { organizationId: org.id },
    update: {},
    create: { organizationId: org.id },
  });

  await seedAllForOrganization(prisma, org.id);
  await seedCatalogTemplates(prisma);
  await seedPluginTemplates(prisma, org.id);

  await prisma.$disconnect();
  console.log("Done.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
