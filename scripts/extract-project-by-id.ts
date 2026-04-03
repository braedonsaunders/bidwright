/**
 * Extract all data for a specific project by ID from the database.
 * Read-only - does not modify any data.
 *
 * Usage: npx tsx scripts/extract-project-by-id.ts
 */

import { prisma } from "../packages/db/src/client.js";

const PROJECT_ID = "project-9ce3d158-f917-4d56-b02c-6959ad1cf043";

async function main() {
  const project = await prisma.project.findUnique({
    where: { id: PROJECT_ID },
  });

  if (!project) {
    console.error(`No project found with ID: ${PROJECT_ID}`);
    const all = await prisma.project.findMany({
      select: { id: true, name: true },
    });
    console.error("All projects:", JSON.stringify(all, null, 2));
    process.exit(1);
  }

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

  // Get takeoff annotations
  const takeoffAnnotations = await prisma.takeoffAnnotation.findMany({
    where: { projectId: project.id },
  });

  // Get takeoff links
  const takeoffLinks = await prisma.takeoffLink.findMany({
    where: { projectId: project.id },
  });

  const result = {
    project,
    sourceDocuments,
    quotes,
    takeoffAnnotations,
    takeoffLinks,
  };

  console.log(JSON.stringify(result, null, 2));

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
