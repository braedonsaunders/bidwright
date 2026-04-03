/**
 * Extract all data for project-ca455bdb from the database.
 * Usage: npx tsx scripts/extract-ca455bdb.ts
 */

import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import pg from "pg";

const PROJECT_ID = "project-ca455bdb-3264-4d12-a1fe-06cf6a2aab98";

async function main() {
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  const adapter = new PrismaPg(pool);
  const prisma = new PrismaClient({ adapter } as any);

  const project = await prisma.project.findUnique({ where: { id: PROJECT_ID } });
  if (!project) {
    console.error("Project not found");
    process.exit(1);
  }
  console.error(`Extracting: ${project.name}`);

  const quotes = await prisma.quote.findMany({
    where: { projectId: project.id },
    include: {
      revisions: {
        include: {
          worksheets: {
            include: { items: { orderBy: { lineOrder: "asc" } } },
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

  const sourceDocuments = await prisma.sourceDocument.findMany({
    where: { projectId: project.id },
    select: { id: true, fileName: true, fileType: true, documentType: true, pageCount: true },
  });

  const takeoffAnnotations = await (prisma as any).takeoffAnnotation.findMany({ where: { projectId: project.id } }).catch(() => []);
  const takeoffLinks = await (prisma as any).takeoffLink.findMany({ where: { projectId: project.id } }).catch(() => []);

  const result = { project, sourceDocuments, quotes, takeoffAnnotations, takeoffLinks };
  console.log(JSON.stringify(result, null, 2));

  await prisma.$disconnect();
  await pool.end();
}

main().catch((e) => { console.error(e); process.exit(1); });
