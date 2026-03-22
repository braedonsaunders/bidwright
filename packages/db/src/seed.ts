import { getPrismaClient } from "./client.js";

async function main() {
  const prisma = (await getPrismaClient()) as {
    project: { upsert: (args: unknown) => Promise<unknown> };
    sourceDocument: { createMany: (args: unknown) => Promise<unknown> };
    $disconnect?: () => Promise<void>;
  };

  await prisma.project.upsert({
    where: { id: "project-harbour-pump" },
    update: {},
    create: {
      id: "project-harbour-pump",
      name: "Harbour Centre Boiler & Pump Replacement",
      customer: "Northshore Property Group",
      stage: "Bid Review",
      estimator: "Avery Chen",
      dueDate: new Date("2026-04-05T00:00:00.000Z")
    }
  });

  await prisma.sourceDocument.createMany({
    data: [
      {
        id: "doc-spec-232113",
        projectId: "project-harbour-pump",
        name: "Division 23 Mechanical Specifications",
        kind: "spec",
        discipline: "Mechanical",
        pages: 312,
        summary: "Primary mechanical specification package."
      },
      {
        id: "doc-rfq",
        projectId: "project-harbour-pump",
        name: "RFQ & Bid Form",
        kind: "rfq",
        discipline: "Commercial",
        pages: 18,
        summary: "Commercial package and bid form."
      }
    ],
    skipDuplicates: true
  });

  await prisma.$disconnect?.();
}

main().catch(async (error) => {
  console.error(error);
  try {
    const prisma = await getPrismaClient();
    await prisma.$disconnect?.();
  } catch {
    // Ignore disconnect failures when Prisma is unavailable.
  }
  process.exit(1);
});
