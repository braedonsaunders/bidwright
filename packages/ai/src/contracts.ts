import { z } from 'zod';

export const citationSchema = z.object({
  documentId: z.string(),
  sourcePath: z.string(),
  page: z.number().int().positive().optional(),
  excerpt: z.string().optional(),
});

export type Citation = z.infer<typeof citationSchema>;

export const groundedItemSchema = z.object({
  title: z.string(),
  rationale: z.string(),
  confidence: z.number().min(0).max(1),
  citations: z.array(citationSchema).default([]),
});

export type GroundedItem = z.infer<typeof groundedItemSchema>;

export const packageSummarySchema = z.object({
  projectName: z.string(),
  scopeSummary: z.string(),
  majorTrades: z.array(z.string()).default([]),
  risks: z.array(z.string()).default([]),
  openQuestions: z.array(z.string()).default([]),
  citations: z.array(citationSchema).default([]),
});

export type PackageSummary = z.infer<typeof packageSummarySchema>;

export const phaseDraftSchema = z.object({
  number: z.string(),
  name: z.string(),
  description: z.string(),
  order: z.number().int().nonnegative(),
  citations: z.array(citationSchema).default([]),
});

export type PhaseDraft = z.infer<typeof phaseDraftSchema>;

export const equipmentDraftSchema = z.object({
  equipmentId: z.string(),
  name: z.string(),
  durationDays: z.number().nonnegative(),
  quantity: z.number().nonnegative(),
  rationale: z.string(),
  citations: z.array(citationSchema).default([]),
});

export type EquipmentDraft = z.infer<typeof equipmentDraftSchema>;

export const worksheetLineItemDraftSchema = z.object({
  category: z.string(),
  description: z.string(),
  quantity: z.number(),
  unit: z.string(),
  rateReference: z.string().optional(),
  confidence: z.number().min(0).max(1),
  citations: z.array(citationSchema).default([]),
});

export type WorksheetLineItemDraft = z.infer<typeof worksheetLineItemDraftSchema>;

export const reviewDecisionSchema = z.object({
  accepted: z.boolean(),
  notes: z.string().optional(),
  edits: z.record(z.string(), z.unknown()).optional(),
});

export type ReviewDecision = z.infer<typeof reviewDecisionSchema>;

export type AgentName =
  | 'intake'
  | 'classification'
  | 'scope-extraction'
  | 'phase-planning'
  | 'worksheet-drafting'
  | 'equipment-inference'
  | 'quote-qa'
  | 'proposal-writing';

export interface PromptContract<TInput, TOutput> {
  agent: AgentName;
  purpose: string;
  input: TInput;
  outputSchemaName: string;
  outputSchema: z.ZodType<TOutput>;
}

export interface SourceContextSummary {
  projectName: string;
  documentCount: number;
  knownKinds: string[];
  topCitations?: Citation[];
}
