import type { PromptEnvelope, SourceContextSummary } from '@bidwright/ai';
import { buildEquipmentDraftPrompt, buildPackageSummaryPrompt, buildPhaseDraftPrompt, buildQuoteQaPrompt, buildWorksheetDraftPrompt } from '@bidwright/ai';
import { createRetrievalAdapter, InMemoryChunkStore, ingestCustomerPackage, type CustomerPackageInput, type IngestionPipelineDependencies } from '@bidwright/ingestion';
import { createId } from '@bidwright/ingestion';

import { InMemoryWorkflowOrchestrator, type WorkerContext } from './orchestrator.js';

// ── Types ───────────────────────────────────────────────────────────────

export interface WorkerRuntimeConfig {
  llmProvider?: string;
  llmApiKey?: string;
  llmModel?: string;
  redisConnection?: any;
}

export interface BidwrightWorkerRuntime {
  orchestrator: InMemoryWorkflowOrchestrator;
  ingestPackage(input: CustomerPackageInput): ReturnType<typeof ingestCustomerPackage>;
  buildContextSummary(input: WorkerContext): SourceContextSummary;
  startWorkers?(): void;
  stopWorkers?(): Promise<void>;
}

// ── LLM Execution ───────────────────────────────────────────────────────

async function executeLLM(
  prompt: PromptEnvelope,
  config: WorkerRuntimeConfig,
): Promise<string | undefined> {
  if (!config.llmApiKey) return undefined;

  try {
    const { createLLMAdapter } = await import('@bidwright/agent');
    const model = config.llmModel ?? 'claude-sonnet-4-20250514';
    const adapter = createLLMAdapter({
      provider: (config.llmProvider ?? 'anthropic') as any,
      apiKey: config.llmApiKey,
      model,
    });

    const response = await adapter.chat({
      model,
      systemPrompt: prompt.system,
      messages: [{ role: 'user' as const, content: prompt.user }],
      maxTokens: 4096,
      temperature: 0.3,
    });

    const first = response.content[0];
    if (!first) return undefined;
    if (typeof first === 'string') return first;
    return (first as any).text ?? String(first);
  } catch {
    return undefined;
  }
}

// ── Runtime Factory ─────────────────────────────────────────────────────

export function createBidwrightWorkerRuntime(
  dependencies: IngestionPipelineDependencies = {},
  config: WorkerRuntimeConfig = {},
): BidwrightWorkerRuntime {
  const chunkStore = dependencies.chunkStore ?? new InMemoryChunkStore();
  const retrieval = createRetrievalAdapter(chunkStore);
  const orchestrator = new InMemoryWorkflowOrchestrator();
  const workers: any[] = [];

  const buildContextSummary = (context: WorkerContext): SourceContextSummary => ({
    projectName: context.packageName,
    documentCount: context.contextSummary.documentCount,
    knownKinds: context.contextSummary.knownKinds,
    topCitations: context.contextSummary.topCitations,
  });

  // ── Register Agent Tasks ────────────────────────────────────────────

  orchestrator.register({
    name: 'summarize-package',
    agent: 'intake',
    prompt: buildPackageSummaryPrompt({ projectName: 'Bidwright project', documentCount: 0, knownKinds: [] }),
    async run(_input, context) {
      const prompt = buildPackageSummaryPrompt(buildContextSummary(context));
      const retrievalPreview = await retrieval.retrieve({
        query: context.summary ?? context.packageName,
        limit: 6,
        sourceKind: context.sourceKind,
      });
      const response = await executeLLM(prompt, config);
      return {
        id: createId('summary'),
        prompt,
        ...(response !== undefined ? { response } : {}),
        retrievalPreview,
      };
    },
  });

  orchestrator.register({
    name: 'draft-phases',
    agent: 'phase-planning',
    prompt: buildPhaseDraftPrompt({ projectName: 'Bidwright project', documentCount: 0, knownKinds: [] }),
    async run(_input, context) {
      const prompt = buildPhaseDraftPrompt(buildContextSummary(context), context.summary);
      const response = await executeLLM(prompt, config);
      return { prompt, ...(response !== undefined ? { response } : {}), mode: 'review-first' };
    },
  });

  orchestrator.register({
    name: 'draft-worksheet',
    agent: 'worksheet-drafting',
    prompt: buildWorksheetDraftPrompt({ projectName: 'Bidwright project', documentCount: 0, knownKinds: [] }),
    async run(_input, context) {
      const prompt = buildWorksheetDraftPrompt(buildContextSummary(context), context.summary);
      const response = await executeLLM(prompt, config);
      return { prompt, ...(response !== undefined ? { response } : {}), mode: 'review-first' };
    },
  });

  orchestrator.register({
    name: 'draft-equipment',
    agent: 'equipment-inference',
    prompt: buildEquipmentDraftPrompt({ projectName: 'Bidwright project', documentCount: 0, knownKinds: [] }),
    async run(_input, context) {
      const prompt = buildEquipmentDraftPrompt(buildContextSummary(context), context.summary);
      const response = await executeLLM(prompt, config);
      return { prompt, ...(response !== undefined ? { response } : {}), mode: 'review-first' };
    },
  });

  orchestrator.register({
    name: 'quote-qa',
    agent: 'quote-qa',
    prompt: buildQuoteQaPrompt({ projectName: 'Bidwright project', documentCount: 0, knownKinds: [] }),
    async run(_input, context) {
      const prompt = buildQuoteQaPrompt(buildContextSummary(context), context.summary);
      const response = await executeLLM(prompt, config);
      return { prompt, ...(response !== undefined ? { response } : {}), mode: 'review-first' };
    },
  });

  // ── BullMQ Workers ──────────────────────────────────────────────────

  function startWorkers() {
    if (!config.redisConnection) {
      console.warn('[worker] No Redis connection configured — running without BullMQ queues');
      return;
    }

    import('bullmq').then(({ Worker }) => {
      const connection = config.redisConnection;

      const ingestionWorker = new Worker(
        'bidwright:ingestion',
        async (job: any) => {
          const { taskName, input, context } = job.data;
          if (taskName === 'ingest-package') {
            return ingestCustomerPackage(input, dependencies);
          }
          if (orchestrator.has(taskName)) {
            return orchestrator.execute(taskName, input, context);
          }
          throw new Error(`Unknown ingestion task: ${taskName}`);
        },
        { connection, concurrency: 2 },
      );
      workers.push(ingestionWorker);

      const aiWorker = new Worker(
        'bidwright:ai',
        async (job: any) => {
          const { taskName, input, context } = job.data;
          if (orchestrator.has(taskName)) {
            return orchestrator.execute(taskName, input, context);
          }
          throw new Error(`Unknown AI task: ${taskName}`);
        },
        { connection, concurrency: 3 },
      );
      workers.push(aiWorker);

      const generalWorker = new Worker(
        'bidwright:general',
        async (job: any) => {
          const { taskName, input, context } = job.data;
          if (orchestrator.has(taskName)) {
            return orchestrator.execute(taskName, input, context);
          }
          throw new Error(`Unknown general task: ${taskName}`);
        },
        { connection, concurrency: 2 },
      );
      workers.push(generalWorker);

      console.log('[worker] BullMQ workers started for queues: ingestion, ai, general');
    }).catch((err) => {
      console.warn('[worker] BullMQ not available:', err.message);
    });
  }

  async function stopWorkers() {
    await Promise.all(workers.map((w: any) => w.close()));
    console.log('[worker] All BullMQ workers stopped');
  }

  return {
    orchestrator,
    ingestPackage(input) {
      return ingestCustomerPackage(input, dependencies);
    },
    buildContextSummary,
    startWorkers,
    stopWorkers,
  };
}
