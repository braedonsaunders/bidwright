import {
  mockStore,
  type BidwrightStore,
} from "@bidwright/domain";
import { PrismaClient } from "@prisma/client";

function toDecimal(value: number) {
  return value.toFixed(2);
}

async function seedStore(prisma: PrismaClient, store: BidwrightStore) {
  await prisma.citation.deleteMany();
  await prisma.aiRun.deleteMany();
  await prisma.catalogItem.deleteMany();
  await prisma.catalog.deleteMany();
  await prisma.condition.deleteMany();
  await prisma.modifier.deleteMany();
  await prisma.phase.deleteMany();
  await prisma.worksheetItem.deleteMany();
  await prisma.worksheet.deleteMany();
  await prisma.quoteRevision.deleteMany();
  await prisma.quote.deleteMany();
  await prisma.sourceDocument.deleteMany();
  await prisma.project.deleteMany();

  for (const project of store.projects) {
    await prisma.project.create({
      data: {
        id: project.id,
        name: project.name,
        clientName: project.clientName,
        location: project.location,
        packageName: project.packageName,
        packageUploadedAt: new Date(project.packageUploadedAt),
        ingestionStatus: project.ingestionStatus,
        summary: project.summary,
        sourceDocuments: {
          create: store.sourceDocuments
            .filter((document) => document.projectId === project.id)
            .map((document) => ({
              id: document.id,
              fileName: document.fileName,
              fileType: document.fileType,
              documentType: document.documentType,
              pageCount: document.pageCount,
              checksum: document.checksum,
              storagePath: document.storagePath,
              extractedText: document.extractedText,
              createdAt: new Date(document.createdAt),
              updatedAt: new Date(document.updatedAt),
            })),
        },
      },
    });
  }

  for (const quote of store.quotes) {
    await prisma.quote.create({
      data: {
        id: quote.id,
        projectId: quote.projectId,
        quoteNumber: quote.quoteNumber,
        title: quote.title,
        status: quote.status,
        currentRevisionId: quote.currentRevisionId,
      },
    });
  }

  for (const revision of store.revisions) {
    await prisma.quoteRevision.create({
      data: {
        id: revision.id,
        quoteId: revision.quoteId,
        revisionNumber: revision.revisionNumber,
        title: revision.title,
        description: revision.description,
        notes: revision.notes,
        breakoutStyle: revision.breakoutStyle,
        useCalculatedTotal: revision.useCalculatedTotal,
        subtotal: toDecimal(revision.subtotal),
        cost: toDecimal(revision.cost),
        estimatedProfit: toDecimal(revision.estimatedProfit),
        estimatedMargin: revision.estimatedMargin.toFixed(4),
        totalHours: toDecimal(revision.totalHours),
        worksheets: {
          create: store.worksheets
            .filter((worksheet) => worksheet.revisionId === revision.id)
            .map((worksheet) => ({
              id: worksheet.id,
              name: worksheet.name,
              order: worksheet.order,
              items: {
                create: store.worksheetItems
                  .filter((item) => item.worksheetId === worksheet.id)
                  .map((item) => ({
                    id: item.id,
                    category: item.category,
                    entityType: item.entityType,
                    entityName: item.entityName,
                    description: item.description,
                    quantity: item.quantity.toFixed(4),
                    uom: item.uom,
                    cost: item.cost.toFixed(2),
                    markup: item.markup.toFixed(4),
                    price: item.price.toFixed(2),
                    laborHourReg: item.laborHourReg.toFixed(4),
                    laborHourOver: item.laborHourOver.toFixed(4),
                    laborHourDouble: item.laborHourDouble.toFixed(4),
                    lineOrder: item.lineOrder,
                  })),
              },
            })),
        },
        phases: {
          create: store.phases
            .filter((phase) => phase.revisionId === revision.id)
            .map((phase) => ({
              id: phase.id,
              number: phase.number,
              name: phase.name,
              description: phase.description,
              order: phase.order,
            })),
        },
        modifiers: {
          create: store.modifiers
            .filter((modifier) => modifier.revisionId === revision.id)
            .map((modifier) => ({
              id: modifier.id,
              name: modifier.name,
              type: modifier.type,
              appliesTo: modifier.appliesTo,
              percentage: modifier.percentage?.toFixed(4) ?? null,
              amount: modifier.amount?.toFixed(2) ?? null,
              show: modifier.show,
            })),
        },
        conditions: {
          create: store.conditions
            .filter((condition) => condition.revisionId === revision.id)
            .map((condition) => ({
              id: condition.id,
              type: condition.type,
              value: condition.value,
              order: condition.order,
            })),
        },
      },
    });
  }

  for (const catalog of store.catalogs) {
    await prisma.catalog.create({
      data: {
        id: catalog.id,
        projectId: catalog.projectId,
        name: catalog.name,
        kind: catalog.kind,
        scope: catalog.scope,
        description: catalog.description,
        items: {
          create: store.catalogItems
            .filter((item) => item.catalogId === catalog.id)
            .map((item) => ({
              id: item.id,
              code: item.code,
              name: item.name,
              unit: item.unit,
              unitCost: item.unitCost.toFixed(2),
              unitPrice: item.unitPrice.toFixed(2),
              metadata: item.metadata,
            })),
        },
      },
    });
  }

  for (const aiRun of store.aiRuns) {
    await prisma.aiRun.create({
      data: {
        id: aiRun.id,
        projectId: aiRun.projectId,
        revisionId: aiRun.revisionId,
        kind: aiRun.kind,
        status: aiRun.status,
        model: aiRun.model,
        promptVersion: aiRun.promptVersion,
        input: aiRun.input,
        output: aiRun.output,
        createdAt: new Date(aiRun.createdAt),
        updatedAt: new Date(aiRun.updatedAt),
      },
    });
  }

  for (const citation of store.citations) {
    await prisma.citation.create({
      data: {
        id: citation.id,
        projectId: citation.projectId,
        aiRunId: citation.aiRunId,
        sourceDocumentId: citation.sourceDocumentId,
        resourceType: citation.resourceType,
        resourceKey: citation.resourceKey,
        pageStart: citation.pageStart,
        pageEnd: citation.pageEnd,
        excerpt: citation.excerpt,
        confidence: citation.confidence.toFixed(4),
      },
    });
  }
}

async function main() {
  const prisma = new PrismaClient();
  await prisma.$connect();
  await seedStore(prisma, mockStore);
  await prisma.$disconnect();
  console.log("Bidwright mock data seeded.");
}

main().catch(async (error) => {
  console.error(error);
  process.exitCode = 1;
});
