/**
 * Seed the Postgres database with mock data from the domain package.
 * Usage: pnpm seed
 */

import { prisma } from '../../packages/db/src/client.js';
import { mockStore } from '../../packages/domain/src/mock-data.js';

async function main() {
  console.log('[seed] Starting database seed...');

  // Check if an org already exists
  const existingOrg = await prisma.organization.findFirst();
  if (existingOrg) {
    console.log(`[seed] Organization "${existingOrg.name}" already exists (${existingOrg.id}). Skipping seed.`);
    console.log('[seed] To re-seed, drop the database first: docker compose down -v && pnpm dev');
    return;
  }

  const store = mockStore;
  const orgId = 'org-bidwright-seed';

  await prisma.$transaction(async (tx: any) => {
    // 1. Organization
    await tx.organization.create({
      data: { id: orgId, name: 'Bidwright Demo', slug: 'bidwright-demo' },
    });

    // 2. Default settings
    await tx.organizationSettings.create({
      data: {
        organizationId: orgId,
        general: { orgName: 'Bidwright Demo Co', address: '', phone: '', website: '', logoUrl: '' },
        email: { host: '', port: 587, username: '', password: '', fromAddress: '', fromName: '' },
        defaults: { defaultMarkup: 15, breakoutStyle: 'category', quoteType: 'Firm' },
        integrations: { openaiKey: '', anthropicKey: '', openrouterKey: '', geminiKey: '', llmProvider: 'anthropic', llmModel: 'claude-sonnet-4-20250514' },
      },
    });

    // 3. Default admin user
    await tx.user.create({
      data: {
        id: 'user-admin',
        organizationId: orgId,
        email: 'admin@bidwright.com',
        name: 'Admin',
        role: 'admin',
        active: true,
        passwordHash: '',
      },
    });

    // 4. Projects
    for (const p of store.projects) {
      await tx.project.create({
        data: {
          id: p.id,
          organizationId: orgId,
          name: p.name,
          clientName: p.clientName,
          location: p.location,
          packageName: p.packageName,
          packageUploadedAt: p.packageUploadedAt,
          ingestionStatus: p.ingestionStatus,
          summary: p.summary,
          createdAt: new Date(p.createdAt),
          updatedAt: new Date(p.updatedAt),
        },
      });
    }
    console.log(`[seed] ${store.projects.length} projects`);

    // 5. Source Documents
    for (const d of store.sourceDocuments) {
      await tx.sourceDocument.create({
        data: {
          id: d.id,
          projectId: d.projectId,
          fileName: d.fileName,
          fileType: d.fileType,
          documentType: d.documentType,
          pageCount: d.pageCount,
          checksum: d.checksum,
          storagePath: d.storagePath,
          extractedText: d.extractedText,
          createdAt: new Date(d.createdAt),
          updatedAt: new Date(d.updatedAt),
        },
      });
    }
    console.log(`[seed] ${store.sourceDocuments.length} documents`);

    // 6. Quotes
    for (const q of store.quotes) {
      await tx.quote.create({
        data: {
          id: q.id,
          projectId: q.projectId,
          quoteNumber: q.quoteNumber,
          title: q.title,
          status: q.status,
          currentRevisionId: q.currentRevisionId,
          customerExistingNew: q.customerExistingNew,
          customerId: q.customerId,
          customerString: q.customerString,
          customerContactId: q.customerContactId,
          customerContactString: q.customerContactString,
          customerContactEmailString: q.customerContactEmailString,
          departmentId: q.departmentId,
          userId: q.userId,
          createdAt: new Date(q.createdAt),
          updatedAt: new Date(q.updatedAt),
        },
      });
    }
    console.log(`[seed] ${store.quotes.length} quotes`);

    // 7. Revisions
    for (const r of store.revisions) {
      await tx.quoteRevision.create({
        data: {
          id: r.id,
          quoteId: r.quoteId,
          revisionNumber: r.revisionNumber,
          title: r.title,
          description: r.description,
          notes: r.notes,
          breakoutStyle: r.breakoutStyle,
          type: r.type,
          scratchpad: r.scratchpad,
          leadLetter: r.leadLetter,
          dateEstimatedShip: r.dateEstimatedShip,
          dateQuote: r.dateQuote,
          dateDue: r.dateDue,
          dateWalkdown: r.dateWalkdown,
          dateWorkStart: r.dateWorkStart,
          dateWorkEnd: r.dateWorkEnd,
          shippingMethod: r.shippingMethod,
          shippingTerms: r.shippingTerms,
          freightOnBoard: r.freightOnBoard,
          status: r.status,
          defaultMarkup: r.defaultMarkup,
          laborDifficulty: r.laborDifficulty,
          followUpNote: r.followUpNote,
          printEmptyNotesColumn: r.printEmptyNotesColumn,
          printCategory: r.printCategory,
          printPhaseTotalOnly: r.printPhaseTotalOnly,
          grandTotal: r.grandTotal,
          regHours: r.regHours,
          overHours: r.overHours,
          doubleHours: r.doubleHours,
          subtotal: r.subtotal,
          cost: r.cost,
          estimatedProfit: r.estimatedProfit,
          estimatedMargin: r.estimatedMargin,
          calculatedTotal: r.calculatedTotal ?? 0,
          totalHours: r.totalHours,
          breakoutPackage: r.breakoutPackage as any,
          calculatedCategoryTotals: r.calculatedCategoryTotals as any,
          createdAt: new Date(r.createdAt),
          updatedAt: new Date(r.updatedAt),
        },
      });
    }
    console.log(`[seed] ${store.revisions.length} revisions`);

    // 8. Worksheets
    for (const w of store.worksheets) {
      await tx.worksheet.create({
        data: { id: w.id, revisionId: w.revisionId, name: w.name, order: w.order },
      });
    }
    console.log(`[seed] ${store.worksheets.length} worksheets`);

    // 9. Worksheet Items
    for (const i of store.worksheetItems) {
      await tx.worksheetItem.create({
        data: {
          id: i.id,
          worksheetId: i.worksheetId,
          phaseId: i.phaseId ?? null,
          category: i.category,
          entityType: i.entityType,
          entityName: i.entityName,
          vendor: i.vendor ?? null,
          description: i.description,
          quantity: i.quantity,
          uom: i.uom,
          cost: i.cost,
          markup: i.markup,
          price: i.price,
          unit1: i.unit1,
          unit2: i.unit2,
          unit3: i.unit3,
          lineOrder: i.lineOrder,
        },
      });
    }
    console.log(`[seed] ${store.worksheetItems.length} items`);

    // 10. Phases
    for (const p of store.phases) {
      await tx.phase.create({
        data: {
          id: p.id,
          revisionId: p.revisionId,
          parentId: p.parentId ?? null,
          number: p.number,
          name: p.name,
          description: p.description,
          order: p.order,
          startDate: p.startDate ?? null,
          endDate: p.endDate ?? null,
          color: p.color ?? "",
        },
      });
    }
    console.log(`[seed] ${store.phases.length} phases`);

    // 11. Modifiers
    for (const m of store.modifiers) {
      await tx.modifier.create({
        data: { id: m.id, revisionId: m.revisionId, name: m.name, type: m.type, appliesTo: m.appliesTo, percentage: m.percentage, amount: m.amount, show: m.show },
      });
    }

    // 12. Additional Line Items
    for (const a of store.additionalLineItems) {
      await tx.additionalLineItem.create({
        data: { id: a.id, revisionId: a.revisionId, name: a.name, description: a.description, type: a.type, amount: a.amount },
      });
    }

    // 13. Conditions
    for (const c of store.conditions) {
      await tx.condition.create({
        data: { id: c.id, revisionId: c.revisionId, type: c.type, value: c.value, order: c.order },
      });
    }

    // 14. Catalogs
    for (const c of store.catalogs) {
      await tx.catalog.create({
        data: { id: c.id, organizationId: orgId, name: c.name, kind: c.kind, scope: c.scope, projectId: c.projectId, description: c.description },
      });
    }
    console.log(`[seed] ${store.catalogs.length} catalogs`);

    // 15. Catalog Items
    for (const i of store.catalogItems) {
      await tx.catalogItem.create({
        data: { id: i.id, catalogId: i.catalogId, code: i.code, name: i.name, unit: i.unit, unitCost: i.unitCost, unitPrice: i.unitPrice, metadata: i.metadata as any },
      });
    }

    // 16. AI Runs
    for (const r of store.aiRuns) {
      await tx.aiRun.create({
        data: {
          id: r.id, projectId: r.projectId, revisionId: r.revisionId, kind: r.kind, status: r.status,
          model: r.model, promptVersion: r.promptVersion, input: r.input as any, output: r.output as any,
          createdAt: new Date(r.createdAt), updatedAt: new Date(r.updatedAt),
        },
      });
    }

    // 17. Citations
    for (const c of store.citations) {
      await tx.citation.create({
        data: {
          id: c.id, projectId: c.projectId, aiRunId: c.aiRunId, sourceDocumentId: c.sourceDocumentId,
          resourceType: c.resourceType, resourceKey: c.resourceKey,
          pageStart: c.pageStart, pageEnd: c.pageEnd, excerpt: c.excerpt, confidence: c.confidence,
        },
      });
    }

    // 18. Plugins
    for (const p of store.plugins) {
      await tx.plugin.create({
        data: {
          id: p.id, organizationId: orgId, name: p.name, slug: p.slug,
          icon: p.icon ?? null, category: p.category, description: p.description,
          llmDescription: p.llmDescription ?? null, version: p.version,
          author: p.author ?? null, enabled: p.enabled,
          config: p.config as any, configSchema: (p.configSchema ?? null) as any,
          toolDefinitions: p.toolDefinitions as any,
          defaultOutputType: p.defaultOutputType ?? null,
          supportedCategories: p.supportedCategories ?? [],
          tags: p.tags ?? [],
          documentation: p.documentation ?? null,
          createdAt: new Date(p.createdAt), updatedAt: new Date(p.updatedAt),
        },
      });
    }
    console.log(`[seed] ${store.plugins.length} plugins`);

    // 19. Entity Categories
    for (const ec of store.entityCategories ?? []) {
      await tx.entityCategory.create({
        data: {
          id: ec.id, organizationId: orgId, name: ec.name, entityType: ec.entityType,
          shortform: ec.shortform, defaultUom: ec.defaultUom,
          validUoms: ec.validUoms, editableFields: ec.editableFields as any,
          unitLabels: ec.unitLabels as any, calculationType: ec.calculationType,
        },
      });
    }
    console.log(`[seed] ${(store.entityCategories ?? []).length} entity categories`);

    // 20. Workspace state
    for (const p of store.projects) {
      const quote = store.quotes.find(q => q.projectId === p.id);
      const revision = quote ? store.revisions.find(r => r.quoteId === quote.id) : undefined;
      const worksheet = revision ? store.worksheets.filter(w => w.revisionId === revision.id).sort((a, b) => a.order - b.order)[0] : undefined;

      await tx.workspaceState.create({
        data: {
          projectId: p.id,
          state: {
            activeTab: 'overview',
            selectedQuoteId: quote?.id ?? null,
            selectedRevisionId: revision?.id ?? null,
            selectedWorksheetId: worksheet?.id ?? null,
            selectedDocumentId: store.sourceDocuments.find(d => d.projectId === p.id)?.id ?? null,
            openDocumentIds: [],
            filters: { documentKinds: [], search: '' },
            panels: { documents: true, estimate: true, ai: true },
          },
        },
      });
    }

    console.log('[seed] Workspace states created');
  }, { timeout: 30000 });

  console.log('[seed] Done! Organization: "Bidwright Demo" (org-bidwright-seed)');
  console.log('[seed] Default org ID for dev: org-bidwright-seed');
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error('[seed] Failed:', e);
    await prisma.$disconnect();
    process.exit(1);
  });
