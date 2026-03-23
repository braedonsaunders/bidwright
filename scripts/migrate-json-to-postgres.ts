/**
 * One-time migration script: reads existing data/bidwright-api/state.json
 * and inserts all records into Postgres, creating an Organization.
 *
 * Usage: pnpm migrate:data [--org-name "My Company"] [--org-slug "my-company"]
 */

import { prisma as prismaClient } from '../packages/db/src/client.js';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

type PrismaClient = typeof prismaClient;

interface MigrateOptions {
  orgName: string;
  orgSlug: string;
  stateFilePath: string;
}

function parseArgs(): MigrateOptions {
  const args = process.argv.slice(2);
  let orgName = 'Bidwright';
  let orgSlug = 'bidwright';
  let stateFilePath = path.join(process.cwd(), 'data', 'bidwright-api', 'state.json');

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--org-name' && args[i + 1]) {
      orgName = args[++i];
    } else if (args[i] === '--org-slug' && args[i + 1]) {
      orgSlug = args[++i];
    } else if (args[i] === '--state-file' && args[i + 1]) {
      stateFilePath = args[++i];
    }
  }

  return { orgName, orgSlug, stateFilePath };
}

async function main() {
  const opts = parseArgs();
  const prisma = prismaClient;

  console.log(`[migrate] Reading state from: ${opts.stateFilePath}`);

  let rawState: any;
  try {
    const content = await readFile(opts.stateFilePath, 'utf8');
    rawState = JSON.parse(content);
  } catch (err) {
    console.error(`[migrate] Failed to read state file: ${err}`);
    process.exit(1);
  }

  const store = rawState.store;
  const packages = rawState.packages ?? [];
  const jobs = rawState.jobs ?? [];
  const workspaceStates = rawState.workspaceStates ?? [];
  const settings = rawState.settings ?? {};

  console.log(`[migrate] Found:`);
  console.log(`  - ${store.projects?.length ?? 0} projects`);
  console.log(`  - ${store.quotes?.length ?? 0} quotes`);
  console.log(`  - ${store.revisions?.length ?? 0} revisions`);
  console.log(`  - ${store.worksheetItems?.length ?? 0} worksheet items`);
  console.log(`  - ${store.plugins?.length ?? 0} plugins`);
  console.log(`  - ${store.knowledgeBooks?.length ?? 0} knowledge books`);
  console.log(`  - ${store.datasets?.length ?? 0} datasets`);
  console.log(`  - ${store.users?.length ?? 0} users`);
  console.log(`  - ${packages.length} packages`);

  await prisma.$transaction(async (tx) => {
    // 1. Create Organization
    console.log(`[migrate] Creating organization: ${opts.orgName} (${opts.orgSlug})`);
    const org = await tx.organization.create({
      data: {
        name: opts.orgName,
        slug: opts.orgSlug,
      },
    });
    const orgId = org.id;

    // 2. Settings
    if (settings) {
      await tx.organizationSettings.create({
        data: {
          organizationId: orgId,
          general: settings.general ?? {},
          email: settings.email ?? {},
          defaults: settings.defaults ?? {},
          integrations: settings.integrations ?? {},
        },
      });
      console.log(`[migrate] Settings migrated`);
    }

    // 3. Users
    for (const user of store.users ?? []) {
      await tx.user.create({
        data: {
          id: user.id,
          organizationId: orgId,
          email: user.email,
          name: user.name,
          role: user.role,
          active: user.active ?? true,
          passwordHash: user.passwordHash ?? '',
          lastLoginAt: user.lastLoginAt ? new Date(user.lastLoginAt) : null,
          createdAt: new Date(user.createdAt),
          updatedAt: new Date(user.updatedAt),
        },
      });
    }
    console.log(`[migrate] ${store.users?.length ?? 0} users migrated`);

    // 4. Projects
    for (const project of store.projects ?? []) {
      await tx.project.create({
        data: {
          id: project.id,
          organizationId: orgId,
          name: project.name,
          clientName: project.clientName ?? '',
          location: project.location ?? '',
          packageName: project.packageName ?? '',
          packageUploadedAt: project.packageUploadedAt ?? '',
          ingestionStatus: project.ingestionStatus ?? 'queued',
          summary: project.summary ?? '',
          createdAt: new Date(project.createdAt),
          updatedAt: new Date(project.updatedAt),
        },
      });
    }
    console.log(`[migrate] ${store.projects?.length ?? 0} projects migrated`);

    // 5. Source Documents
    for (const doc of store.sourceDocuments ?? []) {
      await tx.sourceDocument.create({
        data: {
          id: doc.id,
          projectId: doc.projectId,
          fileName: doc.fileName,
          fileType: doc.fileType ?? '',
          documentType: doc.documentType ?? 'reference',
          pageCount: doc.pageCount ?? 0,
          checksum: doc.checksum ?? '',
          storagePath: doc.storagePath ?? '',
          extractedText: doc.extractedText ?? '',
          createdAt: new Date(doc.createdAt),
          updatedAt: new Date(doc.updatedAt),
        },
      });
    }
    console.log(`[migrate] ${store.sourceDocuments?.length ?? 0} source documents migrated`);

    // 6. Quotes
    for (const quote of store.quotes ?? []) {
      await tx.quote.create({
        data: {
          id: quote.id,
          projectId: quote.projectId,
          quoteNumber: quote.quoteNumber ?? '',
          title: quote.title ?? '',
          status: quote.status ?? 'draft',
          currentRevisionId: quote.currentRevisionId ?? '',
          customerExistingNew: quote.customerExistingNew ?? 'New',
          customerId: quote.customerId ?? null,
          customerString: quote.customerString ?? '',
          customerContactId: quote.customerContactId ?? null,
          customerContactString: quote.customerContactString ?? '',
          customerContactEmailString: quote.customerContactEmailString ?? '',
          departmentId: quote.departmentId ?? null,
          userId: quote.userId ?? null,
          createdAt: new Date(quote.createdAt),
          updatedAt: new Date(quote.updatedAt),
        },
      });
    }
    console.log(`[migrate] ${store.quotes?.length ?? 0} quotes migrated`);

    // 7. Revisions
    for (const rev of store.revisions ?? []) {
      await tx.quoteRevision.create({
        data: {
          id: rev.id,
          quoteId: rev.quoteId,
          revisionNumber: rev.revisionNumber ?? 0,
          title: rev.title ?? '',
          description: rev.description ?? '',
          notes: rev.notes ?? '',
          breakoutStyle: rev.breakoutStyle ?? 'grand_total',
          phaseWorksheetEnabled: rev.phaseWorksheetEnabled ?? false,
          useCalculatedTotal: rev.useCalculatedTotal ?? false,
          type: rev.type ?? 'Firm',
          scratchpad: rev.scratchpad ?? '',
          leadLetter: rev.leadLetter ?? '',
          dateEstimatedShip: rev.dateEstimatedShip ?? null,
          dateQuote: rev.dateQuote ?? null,
          dateDue: rev.dateDue ?? null,
          dateWalkdown: rev.dateWalkdown ?? null,
          dateWorkStart: rev.dateWorkStart ?? null,
          dateWorkEnd: rev.dateWorkEnd ?? null,
          shippingMethod: rev.shippingMethod ?? '',
          shippingTerms: rev.shippingTerms ?? '',
          freightOnBoard: rev.freightOnBoard ?? '',
          status: rev.status ?? 'Open',
          defaultMarkup: rev.defaultMarkup ?? 0,
          necaDifficulty: rev.necaDifficulty ?? '',
          followUpNote: rev.followUpNote ?? '',
          printEmptyNotesColumn: rev.printEmptyNotesColumn ?? false,
          printCategory: rev.printCategory ?? [],
          printPhaseTotalOnly: rev.printPhaseTotalOnly ?? false,
          showOvertimeDoubletime: rev.showOvertimeDoubletime ?? false,
          grandTotal: rev.grandTotal ?? 0,
          regHours: rev.regHours ?? 0,
          overHours: rev.overHours ?? 0,
          doubleHours: rev.doubleHours ?? 0,
          subtotal: rev.subtotal ?? 0,
          cost: rev.cost ?? 0,
          estimatedProfit: rev.estimatedProfit ?? 0,
          estimatedMargin: rev.estimatedMargin ?? 0,
          calculatedTotal: rev.calculatedTotal ?? 0,
          totalHours: rev.totalHours ?? 0,
          breakoutPackage: rev.breakoutPackage ?? [],
          calculatedCategoryTotals: rev.calculatedCategoryTotals ?? [],
          createdAt: new Date(rev.createdAt),
          updatedAt: new Date(rev.updatedAt),
        },
      });
    }
    console.log(`[migrate] ${store.revisions?.length ?? 0} revisions migrated`);

    // 8. Worksheets
    for (const ws of store.worksheets ?? []) {
      await tx.worksheet.create({
        data: {
          id: ws.id,
          revisionId: ws.revisionId,
          name: ws.name ?? 'Worksheet',
          order: ws.order ?? 0,
        },
      });
    }
    console.log(`[migrate] ${store.worksheets?.length ?? 0} worksheets migrated`);

    // 9. Worksheet Items
    for (const item of store.worksheetItems ?? []) {
      await tx.worksheetItem.create({
        data: {
          id: item.id,
          worksheetId: item.worksheetId,
          phaseId: item.phaseId ?? null,
          category: item.category ?? 'Material',
          entityType: item.entityType ?? 'Material',
          entityName: item.entityName ?? '',
          vendor: item.vendor ?? null,
          description: item.description ?? '',
          quantity: item.quantity ?? 0,
          uom: item.uom ?? 'EA',
          cost: item.cost ?? 0,
          markup: item.markup ?? 0,
          price: item.price ?? 0,
          laborHourReg: item.laborHourReg ?? 0,
          laborHourOver: item.laborHourOver ?? 0,
          laborHourDouble: item.laborHourDouble ?? 0,
          lineOrder: item.lineOrder ?? 0,
        },
      });
    }
    console.log(`[migrate] ${store.worksheetItems?.length ?? 0} worksheet items migrated`);

    // 10. Phases
    for (const phase of store.phases ?? []) {
      await tx.phase.create({
        data: {
          id: phase.id,
          revisionId: phase.revisionId,
          number: phase.number ?? '',
          name: phase.name ?? '',
          description: phase.description ?? '',
          order: phase.order ?? 0,
        },
      });
    }

    // 11. Modifiers
    for (const mod of store.modifiers ?? []) {
      await tx.modifier.create({
        data: {
          id: mod.id,
          revisionId: mod.revisionId,
          name: mod.name ?? '',
          type: mod.type ?? 'percentage',
          appliesTo: mod.appliesTo ?? 'All',
          percentage: mod.percentage ?? null,
          amount: mod.amount ?? null,
          show: mod.show ?? 'Yes',
        },
      });
    }

    // 12. Additional Line Items
    for (const ali of store.additionalLineItems ?? []) {
      await tx.additionalLineItem.create({
        data: {
          id: ali.id,
          revisionId: ali.revisionId,
          name: ali.name ?? '',
          description: ali.description ?? null,
          type: ali.type ?? 'LineItemAdditional',
          amount: ali.amount ?? 0,
        },
      });
    }

    // 13. Conditions
    for (const cond of store.conditions ?? []) {
      await tx.condition.create({
        data: {
          id: cond.id,
          revisionId: cond.revisionId,
          type: cond.type ?? 'inclusion',
          value: cond.value ?? '',
          order: cond.order ?? 0,
        },
      });
    }

    // 14. Report Sections
    for (const section of store.reportSections ?? []) {
      await tx.reportSection.create({
        data: {
          id: section.id,
          revisionId: section.revisionId,
          sectionType: section.sectionType ?? 'text',
          title: section.title ?? '',
          content: section.content ?? '',
          order: section.order ?? 0,
          parentSectionId: section.parentSectionId ?? null,
        },
      });
    }

    // 16. Catalogs
    for (const cat of store.catalogs ?? []) {
      await tx.catalog.create({
        data: {
          id: cat.id,
          organizationId: orgId,
          name: cat.name,
          kind: cat.kind,
          scope: cat.scope ?? 'global',
          projectId: cat.projectId ?? null,
          description: cat.description ?? '',
        },
      });
    }

    // 17. Catalog Items
    for (const item of store.catalogItems ?? []) {
      await tx.catalogItem.create({
        data: {
          id: item.id,
          catalogId: item.catalogId,
          code: item.code ?? '',
          name: item.name ?? '',
          unit: item.unit ?? '',
          unitCost: item.unitCost ?? 0,
          unitPrice: item.unitPrice ?? 0,
          metadata: item.metadata ?? {},
        },
      });
    }

    // 18. AI Runs
    for (const run of store.aiRuns ?? []) {
      await tx.aiRun.create({
        data: {
          id: run.id,
          projectId: run.projectId,
          revisionId: run.revisionId ?? null,
          kind: run.kind,
          status: run.status ?? 'complete',
          model: run.model ?? '',
          promptVersion: run.promptVersion ?? '',
          input: run.input ?? {},
          output: run.output ?? {},
          createdAt: new Date(run.createdAt),
          updatedAt: new Date(run.updatedAt),
        },
      });
    }

    // 19. Citations
    for (const cite of store.citations ?? []) {
      await tx.citation.create({
        data: {
          id: cite.id,
          projectId: cite.projectId,
          aiRunId: cite.aiRunId ?? null,
          sourceDocumentId: cite.sourceDocumentId ?? null,
          resourceType: cite.resourceType ?? 'source_document',
          resourceKey: cite.resourceKey ?? '',
          pageStart: cite.pageStart ?? null,
          pageEnd: cite.pageEnd ?? null,
          excerpt: cite.excerpt ?? '',
          confidence: cite.confidence ?? 0,
        },
      });
    }

    // 20. Activities
    for (const act of store.activities ?? []) {
      await tx.activity.create({
        data: {
          id: act.id,
          projectId: act.projectId,
          revisionId: act.revisionId ?? null,
          type: act.type,
          data: act.data ?? {},
          userId: act.userId ?? null,
          createdAt: new Date(act.createdAt),
        },
      });
    }

    // 21. Jobs
    for (const job of store.jobs ?? []) {
      await tx.job.create({
        data: {
          id: job.id,
          projectId: job.projectId,
          revisionId: job.revisionId ?? '',
          name: job.name ?? '',
          foreman: job.foreman ?? '',
          projectManager: job.projectManager ?? '',
          startDate: job.startDate ?? null,
          shipDate: job.shipDate ?? null,
          poNumber: job.poNumber ?? '',
          poIssuer: job.poIssuer ?? '',
          status: job.status ?? 'Draft',
          createdAt: new Date(job.createdAt),
        },
      });
    }

    // 22. File Nodes
    for (const node of store.fileNodes ?? []) {
      await tx.fileNode.create({
        data: {
          id: node.id,
          projectId: node.projectId,
          parentId: node.parentId ?? null,
          name: node.name,
          type: node.type ?? 'file',
          fileType: node.fileType ?? null,
          size: node.size ?? null,
          documentId: node.documentId ?? null,
          storagePath: node.storagePath ?? null,
          metadata: node.metadata ?? {},
          createdAt: new Date(node.createdAt),
          updatedAt: new Date(node.updatedAt),
          createdBy: node.createdBy ?? null,
        },
      });
    }

    // 23. Condition Library
    for (const entry of store.conditionLibrary ?? []) {
      await tx.conditionLibraryEntry.create({
        data: {
          id: entry.id,
          organizationId: orgId,
          type: entry.type,
          value: entry.value,
        },
      });
    }

    // 24. Plugins
    for (const plugin of store.plugins ?? []) {
      await tx.plugin.create({
        data: {
          id: plugin.id,
          organizationId: orgId,
          name: plugin.name,
          slug: plugin.slug,
          icon: plugin.icon ?? null,
          category: plugin.category ?? 'general',
          description: plugin.description ?? '',
          llmDescription: plugin.llmDescription ?? null,
          version: plugin.version ?? '1.0.0',
          author: plugin.author ?? null,
          enabled: plugin.enabled ?? true,
          config: plugin.config ?? {},
          configSchema: plugin.configSchema ?? null,
          toolDefinitions: plugin.toolDefinitions ?? [],
          defaultOutputType: plugin.defaultOutputType ?? null,
          supportedCategories: plugin.supportedCategories ?? [],
          tags: plugin.tags ?? [],
          documentation: plugin.documentation ?? null,
          createdAt: new Date(plugin.createdAt),
          updatedAt: new Date(plugin.updatedAt),
        },
      });
    }

    // 25. Plugin Executions
    for (const exec of store.pluginExecutions ?? []) {
      await tx.pluginExecution.create({
        data: {
          id: exec.id,
          pluginId: exec.pluginId,
          toolId: exec.toolId,
          projectId: exec.projectId,
          revisionId: exec.revisionId,
          worksheetId: exec.worksheetId ?? null,
          input: exec.input ?? {},
          formState: exec.formState ?? null,
          output: exec.output ?? {},
          appliedLineItemIds: exec.appliedLineItemIds ?? [],
          status: exec.status ?? 'complete',
          error: exec.error ?? null,
          executedBy: exec.executedBy ?? null,
          agentSessionId: exec.agentSessionId ?? null,
          createdAt: new Date(exec.createdAt),
        },
      });
    }

    // 26. Knowledge Books
    for (const book of store.knowledgeBooks ?? []) {
      await tx.knowledgeBook.create({
        data: {
          id: book.id,
          organizationId: orgId,
          name: book.name,
          description: book.description ?? '',
          category: book.category ?? 'general',
          scope: book.scope ?? 'global',
          projectId: book.projectId ?? null,
          pageCount: book.pageCount ?? 0,
          chunkCount: book.chunkCount ?? 0,
          status: book.status ?? 'indexed',
          sourceFileName: book.sourceFileName ?? '',
          sourceFileSize: book.sourceFileSize ?? 0,
          metadata: book.metadata ?? {},
          createdAt: new Date(book.createdAt),
          updatedAt: new Date(book.updatedAt),
        },
      });
    }

    // 27. Knowledge Chunks
    for (const chunk of store.knowledgeChunks ?? []) {
      await tx.knowledgeChunk.create({
        data: {
          id: chunk.id,
          bookId: chunk.bookId,
          pageNumber: chunk.pageNumber ?? null,
          sectionTitle: chunk.sectionTitle ?? '',
          text: chunk.text ?? '',
          tokenCount: chunk.tokenCount ?? 0,
          order: chunk.order ?? 0,
          metadata: chunk.metadata ?? {},
        },
      });
    }

    // 28. Datasets
    for (const ds of store.datasets ?? []) {
      await tx.dataset.create({
        data: {
          id: ds.id,
          organizationId: orgId,
          name: ds.name,
          description: ds.description ?? '',
          category: ds.category ?? 'custom',
          scope: ds.scope ?? 'global',
          projectId: ds.projectId ?? null,
          columns: ds.columns ?? [],
          rowCount: ds.rowCount ?? 0,
          source: ds.source ?? 'manual',
          sourceDescription: ds.sourceDescription ?? '',
          createdAt: new Date(ds.createdAt),
          updatedAt: new Date(ds.updatedAt),
        },
      });
    }

    // 29. Dataset Rows
    for (const row of store.datasetRows ?? []) {
      await tx.datasetRow.create({
        data: {
          id: row.id,
          datasetId: row.datasetId,
          data: row.data ?? {},
          order: row.order ?? 0,
          metadata: row.metadata ?? {},
          createdAt: new Date(row.createdAt),
          updatedAt: new Date(row.updatedAt),
        },
      });
    }

    // 30. Entity Categories
    for (const ec of store.entityCategories ?? []) {
      await tx.entityCategory.create({
        data: {
          id: ec.id,
          organizationId: orgId,
          name: ec.name,
          entityType: ec.entityType,
          shortform: ec.shortform ?? '',
          defaultUom: ec.defaultUom ?? 'EA',
          validUoms: ec.validUoms ?? [],
          editableFields: ec.editableFields ?? {},
          laborHourLabels: ec.laborHourLabels ?? {},
          calculationType: ec.calculationType ?? 'manual',
        },
      });
    }

    // 31. Stored Packages
    for (const pkg of packages) {
      await tx.storedPackage.create({
        data: {
          id: pkg.id,
          projectId: pkg.projectId,
          packageName: pkg.packageName ?? '',
          originalFileName: pkg.originalFileName ?? '',
          sourceKind: pkg.sourceKind ?? 'project',
          storagePath: pkg.storagePath ?? '',
          reportPath: pkg.reportPath ?? null,
          chunksPath: pkg.chunksPath ?? null,
          checksum: pkg.checksum ?? '',
          totalBytes: pkg.totalBytes ?? 0,
          status: pkg.status ?? 'uploaded',
          documentCount: pkg.documentCount ?? 0,
          chunkCount: pkg.chunkCount ?? 0,
          documentIds: pkg.documentIds ?? [],
          unknownFiles: pkg.unknownFiles ?? [],
          uploadedAt: new Date(pkg.uploadedAt),
          ingestedAt: pkg.ingestedAt ? new Date(pkg.ingestedAt) : null,
          error: pkg.error ?? null,
        },
      });
    }

    // 32. Ingestion Jobs
    for (const job of jobs) {
      await tx.ingestionJob.create({
        data: {
          id: job.id,
          projectId: job.projectId,
          packageId: job.packageId ?? null,
          kind: job.kind,
          status: job.status ?? 'complete',
          progress: Math.round((job.progress ?? 0) * 100),
          input: job.input ?? {},
          output: job.output ?? null,
          error: job.error ?? null,
          createdAt: new Date(job.createdAt),
          updatedAt: new Date(job.updatedAt),
          startedAt: job.startedAt ? new Date(job.startedAt) : null,
          completedAt: job.completedAt ? new Date(job.completedAt) : null,
          storagePath: job.storagePath ?? null,
        },
      });
    }

    // 33. Workspace States
    for (const ws of workspaceStates) {
      await tx.workspaceState.create({
        data: {
          projectId: ws.projectId,
          state: ws.state ?? {},
        },
      });
    }

    console.log(`[migrate] All data migrated to organization: ${orgId}`);
  }, { timeout: 120000 });

  console.log('[migrate] Migration complete!');
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error('[migrate] Migration failed:', err);
  process.exit(1);
});
