import type { PackageSourceKind } from '@bidwright/ingestion';
import type { AgentName, PromptEnvelope, SourceContextSummary } from '@bidwright/ai';

export type WorkflowStatus = 'queued' | 'running' | 'succeeded' | 'failed';

export interface WorkflowJob<TInput = unknown, TOutput = unknown> {
  id: string;
  name: string;
  status: WorkflowStatus;
  input: TInput;
  output?: TOutput;
  error?: string;
  createdAt: string;
  updatedAt: string;
}

export interface WorkerContext {
  packageId: string;
  packageName: string;
  sourceKind: PackageSourceKind;
  summary?: string;
  contextSummary: SourceContextSummary;
}

export interface AgentTask<TInput = unknown, TOutput = unknown> {
  name: string;
  agent: AgentName;
  prompt: PromptEnvelope;
  run(input: TInput, context: WorkerContext): Promise<TOutput>;
}

export interface WorkflowOrchestrator {
  register<TInput, TOutput>(task: AgentTask<TInput, TOutput>): void;
  has(name: string): boolean;
  execute<TInput, TOutput>(name: string, input: TInput, context: WorkerContext): Promise<TOutput>;
}

export class InMemoryWorkflowOrchestrator implements WorkflowOrchestrator {
  private readonly tasks = new Map<string, AgentTask<any, any>>();

  register<TInput, TOutput>(task: AgentTask<TInput, TOutput>): void {
    this.tasks.set(task.name, task);
  }

  has(name: string): boolean {
    return this.tasks.has(name);
  }

  async execute<TInput, TOutput>(name: string, input: TInput, context: WorkerContext): Promise<TOutput> {
    const task = this.tasks.get(name);
    if (!task) {
      throw new Error(`Workflow task not found: ${name}`);
    }

    return task.run(input, context) as Promise<TOutput>;
  }
}
