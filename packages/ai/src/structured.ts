import type { ZodType } from 'zod';

export interface StructuredPrompt<TInput, TOutput> {
  name: string;
  system: string;
  user: string;
  input: TInput;
  outputSchema: ZodType<TOutput>;
}

export interface AgentRunTrace {
  agent: string;
  promptName: string;
  startedAt: string;
  completedAt?: string;
  citationsUsed: number;
  notes?: string;
}

export function createStructuredPrompt<TInput, TOutput>(prompt: StructuredPrompt<TInput, TOutput>): StructuredPrompt<TInput, TOutput> {
  return prompt;
}
