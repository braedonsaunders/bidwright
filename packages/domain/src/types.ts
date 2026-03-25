import { z } from "zod";

export const citationSchema = z.object({
  id: z.string(),
  documentName: z.string(),
  pageLabel: z.string(),
  section: z.string(),
  excerpt: z.string(),
  sourceType: z.enum(["project", "library"])
});

export const estimateItemSchema = z.object({
  id: z.string(),
  worksheetId: z.string(),
  phaseId: z.string().nullable(),
  category: z.enum([
    "Labour",
    "Material",
    "Equipment",
    "Consumables",
    "Stock Items",
    "Other Charges",
    "Travel & Per Diem",
    "Subcontractors",
    "Rental Equipment"
  ]),
  entityName: z.string(),
  vendor: z.string().nullable(),
  description: z.string(),
  quantity: z.number(),
  uom: z.string(),
  cost: z.number(),
  markup: z.number(),
  price: z.number(),
  unit1: z.number(),
  unit2: z.number(),
  unit3: z.number(),
  citations: z.array(citationSchema)
});

export const worksheetSchema = z.object({
  id: z.string(),
  name: z.string(),
  order: z.number(),
  items: z.array(estimateItemSchema)
});

export const phaseSchema = z.object({
  id: z.string(),
  number: z.string(),
  name: z.string(),
  description: z.string(),
  order: z.number()
});

export const modifierSchema = z.object({
  id: z.string(),
  name: z.string(),
  type: z.enum(["Contingency", "Surcharge", "Discount"]),
  appliesTo: z.string(),
  percentage: z.number().nullable(),
  amount: z.number().nullable(),
  showOnQuote: z.boolean()
});

export const conditionSchema = z.object({
  id: z.string(),
  type: z.enum(["Inclusion", "Exclusion"]),
  value: z.string(),
  order: z.number()
});

export const reportSectionSchema = z.object({
  id: z.string(),
  title: z.string(),
  content: z.string(),
  order: z.number(),
  sectionType: z.enum(["content", "document", "heading"])
});

export const aiProposalSchema = z.object({
  id: z.string(),
  type: z.enum(["phase-plan", "worksheet-draft", "equipment", "conditions", "risk", "qa"]),
  title: z.string(),
  summary: z.string(),
  confidence: z.number(),
  status: z.enum(["pending", "accepted", "rejected"]),
  citations: z.array(citationSchema)
});

export const projectDocumentSchema = z.object({
  id: z.string(),
  name: z.string(),
  kind: z.enum(["spec", "drawing", "rfq", "schedule", "vendor", "reference"]),
  pages: z.number(),
  discipline: z.string(),
  summary: z.string()
});

export const projectDossierSchema = z.object({
  summary: z.string(),
  scopeMap: z.array(z.string()),
  risks: z.array(z.string()),
  gaps: z.array(z.string()),
  packageHealth: z.object({
    files: z.number(),
    indexedPages: z.number(),
    drawings: z.number(),
    specs: z.number()
  })
});

export const quoteRevisionSchema = z.object({
  id: z.string(),
  revisionNumber: z.number(),
  title: z.string(),
  status: z.string(),
  breakoutStyle: z.enum(["GrandTotal", "Category", "Phases", "PhaseDetail"]),
  subtotal: z.number(),
  cost: z.number(),
  estimatedProfit: z.number(),
  estimatedMargin: z.number(),
  worksheets: z.array(worksheetSchema),
  phases: z.array(phaseSchema),
  modifiers: z.array(modifierSchema),
  conditions: z.array(conditionSchema),
  reportSections: z.array(reportSectionSchema),
  aiProposals: z.array(aiProposalSchema)
});

export const catalogRateSchema = z.object({
  id: z.string(),
  name: z.string(),
  type: z.enum(["labour", "equipment", "material", "burden"]),
  unit: z.string(),
  value: z.number()
});

export const projectWorkspaceSchema = z.object({
  id: z.string(),
  name: z.string(),
  customer: z.string(),
  stage: z.string(),
  estimator: z.string(),
  dueDate: z.string(),
  dossier: projectDossierSchema,
  documents: z.array(projectDocumentSchema),
  activeRevision: quoteRevisionSchema,
  catalogRates: z.array(catalogRateSchema)
});

export type Citation = z.infer<typeof citationSchema>;
export type EstimateItem = z.infer<typeof estimateItemSchema>;
export type Worksheet = z.infer<typeof worksheetSchema>;
export type Phase = z.infer<typeof phaseSchema>;
export type Modifier = z.infer<typeof modifierSchema>;
export type Condition = z.infer<typeof conditionSchema>;
export type ReportSection = z.infer<typeof reportSectionSchema>;
export type AIProposal = z.infer<typeof aiProposalSchema>;
export type ProjectDocument = z.infer<typeof projectDocumentSchema>;
export type ProjectDossier = z.infer<typeof projectDossierSchema>;
export type QuoteRevision = z.infer<typeof quoteRevisionSchema>;
export type CatalogRate = z.infer<typeof catalogRateSchema>;
export type ProjectWorkspace = z.infer<typeof projectWorkspaceSchema>;
