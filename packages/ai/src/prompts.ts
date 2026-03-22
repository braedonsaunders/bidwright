import type {
  EquipmentDraft,
  PackageSummary,
  PhaseDraft,
  PromptContract,
  SourceContextSummary,
  WorksheetLineItemDraft,
} from './contracts.js';
import {
  equipmentDraftSchema,
  packageSummarySchema,
  phaseDraftSchema,
  worksheetLineItemDraftSchema,
} from './contracts.js';

export interface PromptEnvelope {
  system: string;
  user: string;
  contract: PromptContract<unknown, unknown>;
}

function sourceOverview(context: SourceContextSummary): string {
  const citations = context.topCitations?.length ? ` Top citations available: ${context.topCitations.length}.` : '';

  return `Project: ${context.projectName}. Documents: ${context.documentCount}. Kinds: ${context.knownKinds.join(', ')}.${citations}`;
}

export function buildPackageSummaryPrompt(context: SourceContextSummary, notes: string[] = []): PromptEnvelope {
  return {
    system:
      'You are Bidwright intake. Summarize the uploaded customer package into grounded estimating intelligence. Never invent citations. Return only structured JSON matching the requested schema.',
    user: `${sourceOverview(context)}\n\nNotes:\n${notes.join('\n') || 'None'}`,
    contract: {
      agent: 'intake',
      purpose: 'Summarize the customer package and identify scope, risks, and open questions.',
      input: context,
      outputSchemaName: 'PackageSummary',
      outputSchema: packageSummarySchema,
    },
  };
}

export function buildPhaseDraftPrompt(context: SourceContextSummary, summary?: string): PromptEnvelope {
  return {
    system:
      'You are Bidwright phase planning. Break the job into broad executable phases. Prefer fewer, broader phases and ground each phase in project sources.',
    user: `${sourceOverview(context)}\n\nPackage summary:\n${summary ?? 'Unavailable'}`,
    contract: {
      agent: 'phase-planning',
      purpose: 'Draft broad project phases for review.',
      input: { context, summary },
      outputSchemaName: 'PhaseDraft[]',
      outputSchema: phaseDraftSchema.array(),
    },
  };
}

export function buildWorksheetDraftPrompt(context: SourceContextSummary, summary?: string): PromptEnvelope {
  return {
    system:
      'You are Bidwright worksheet drafting. Produce editable worksheet line items with clear quantities, units, and rationale. Do not hide uncertainty.',
    user: `${sourceOverview(context)}\n\nPackage summary:\n${summary ?? 'Unavailable'}`,
    contract: {
      agent: 'worksheet-drafting',
      purpose: 'Draft worksheet line items for human review.',
      input: { context, summary },
      outputSchemaName: 'WorksheetLineItemDraft[]',
      outputSchema: worksheetLineItemDraftSchema.array(),
    },
  };
}

export function buildEquipmentDraftPrompt(context: SourceContextSummary, summary?: string): PromptEnvelope {
  return {
    system:
      'You are Bidwright equipment inference. Suggest only justified equipment with grounded duration and quantity estimates.',
    user: `${sourceOverview(context)}\n\nPackage summary:\n${summary ?? 'Unavailable'}`,
    contract: {
      agent: 'equipment-inference',
      purpose: 'Suggest equipment requirements from the package.',
      input: { context, summary },
      outputSchemaName: 'EquipmentDraft[]',
      outputSchema: equipmentDraftSchema.array(),
    },
  };
}

export function buildQuoteQaPrompt(context: SourceContextSummary, summary?: string): PromptEnvelope {
  return {
    system:
      'You are Bidwright quote QA. Find missing scope, mismatched assumptions, and weak grounding before the estimate is released.',
    user: `${sourceOverview(context)}\n\nPackage summary:\n${summary ?? 'Unavailable'}`,
    contract: {
      agent: 'quote-qa',
      purpose: 'Review an estimate for gaps and risks.',
      input: { context, summary },
      outputSchemaName: 'PackageSummary',
      outputSchema: packageSummarySchema,
    },
  };
}
