/**
 * Extract all data for a project matching "Soprema Tillsonburg" from the database.
 * Read-only - does not modify any data.
 *
 * Usage: npx tsx scripts/extract-project.ts
 */

import { prisma } from "../packages/db/src/client.js";

async function main() {
  // Find the project by name
  const projects = await prisma.project.findMany({
    where: {
      name: { contains: "Soprema", mode: "insensitive" as any },
    },
  });

  if (projects.length === 0) {
    // Try broader search
    const all = await prisma.project.findMany({
      select: { id: true, name: true },
    });
    console.error("No project found containing 'Soprema'. All projects:");
    console.error(JSON.stringify(all, null, 2));
    process.exit(1);
  }

  console.error(`Found ${projects.length} matching project(s)`);

  for (const project of projects) {
    console.error(`Extracting project: ${project.name} (${project.id})`);

    // Get quotes with all nested data
    const quotes = await prisma.quote.findMany({
      where: { projectId: project.id },
      include: {
        revisions: {
          include: {
            worksheets: {
              include: {
                items: {
                  orderBy: { lineOrder: "asc" },
                },
              },
              orderBy: { order: "asc" },
            },
            phases: { orderBy: { order: "asc" } },
            modifiers: true,
            additionalLineItems: true,
            summaryRows: { orderBy: { order: "asc" } },
            conditions: { orderBy: { order: "asc" } },
            reportSections: { orderBy: { order: "asc" } },
            rateSchedules: {
              include: {
                tiers: { orderBy: { sortOrder: "asc" } },
                items: { orderBy: { sortOrder: "asc" } },
              },
            },
          },
        },
      },
    });

    // Get source documents
    const sourceDocuments = await prisma.sourceDocument.findMany({
      where: { projectId: project.id },
      select: { id: true, fileName: true, fileType: true, documentType: true, pageCount: true },
    });

    // Get jobs
    const jobs = await prisma.job.findMany({
      where: { projectId: project.id },
    });

    const result = {
      project,
      sourceDocuments,
      quotes,
      jobs,
    };

    console.log(JSON.stringify(result, null, 2));
  }

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
