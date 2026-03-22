import type { SourceContextSummary } from '@bidwright/ai';
import { buildEquipmentDraftPrompt, buildPackageSummaryPrompt, buildPhaseDraftPrompt, buildQuoteQaPrompt, buildWorksheetDraftPrompt } from '@bidwright/ai';
import { createRetrievalAdapter, InMemoryChunkStore, ingestCustomerPackage, type CustomerPackageInput, type IngestionPipelineDependencies } from '@bidwright/ingestion';

import { InMemoryWorkflowOrchestrator, type WorkerContext } from './orchestrator.js';
import { createId } from '@bidwright/ingestion';

export interface BidwrightWorkerRuntime {
  orchestrator: InMemoryWorkflowOrchestrator;
  ingestPackage(input: CustomerPackageInput): ReturnType<typeof ingestCustomerPackage>;
  buildContextSummary(input: WorkerContext): SourceContextSummary;
}

export function createBidwrightWorkerRuntime(dependencies: IngestionPipelineDependencies = {}): BidwrightWorkerRuntime {
  const chunkStore = dependencies.chunkStore ?? new InMemoryChunkStore();
  const retrieval = createRetrievalAdapter(chunkStore);
  const orchestrator = new InMemoryWorkflowOrchestrator();

  const buildContextSummary = (context: WorkerContext): SourceContextSummary => ({
    projectName: context.packageName,
    documentCount: context.contextSummary.documentCount,
    knownKinds: context.contextSummary.knownKinds,
    topCitations: context.contextSummary.topCitations,
  });

  orchestrator.register({
    name: 'summarize-package',
    agent: 'intake',
    prompt: buildPackageSummaryPrompt({ projectName: 'Bidwright project', documentCount: 0, knownKinds: [] }),
    async run(_input, context) {
      const prompt = buildPackageSummaryPrompt(buildContextSummary(context));
      return {
        id: createId('summary'),
        prompt,
        retrievalPreview: await retrieval.retrieve({
          query: context.summary ?? context.packageName,
          limit: 6,
          sourceKind: context.sourceKind,
        }),
      };
    },
  });

  orchestrator.register({
    name: 'draft-phases',
    agent: 'phase-planning',
    prompt: buildPhaseDraftPrompt({ projectName: 'Bidwright project', documentCount: 0, knownKinds: [] }),
    async run(_input, context) {
      return {
        prompt: buildPhaseDraftPrompt(buildContextSummary(context), context.summary),
        mode: 'review-first',
      };
    },
  });

  orchestrator.register({
    name: 'draft-worksheet',
    agent: 'worksheet-drafting',
    prompt: buildWorksheetDraftPrompt({ projectName: 'Bidwright project', documentCount: 0, knownKinds: [] }),
    async run(_input, context) {
      return {
        prompt: buildWorksheetDraftPrompt(buildContextSummary(context), context.summary),
        mode: 'review-first',
      };
    },
  });

  orchestrator.register({
    name: 'draft-equipment',
    agent: 'equipment-inference',
    prompt: buildEquipmentDraftPrompt({ projectName: 'Bidwright project', documentCount: 0, knownKinds: [] }),
    async run(_input, context) {
      return {
        prompt: buildEquipmentDraftPrompt(buildContextSummary(context), context.summary),
        mode: 'review-first',
      };
    },
  });

  orchestrator.register({
    name: 'quote-qa',
    agent: 'quote-qa',
    prompt: buildQuoteQaPrompt({ projectName: 'Bidwright project', documentCount: 0, knownKinds: [] }),
    async run(_input, context) {
      return {
        prompt: buildQuoteQaPrompt(buildContextSummary(context), context.summary),
        mode: 'review-first',
      };
    },
  });

  return {
    orchestrator,
    ingestPackage(input) {
      return ingestCustomerPackage(input, dependencies);
    },
    buildContextSummary,
  };
}
