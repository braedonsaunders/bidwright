export type AgentToolCategory =
  | "workspace"
  | "quote"
  | "worksheet"
  | "summary"
  | "documents"
  | "knowledge"
  | "resources"
  | "model"
  | "strategy"
  | "review"
  | "system"
  | "vision"
  | "integration"
  | "runtime";

export interface AgentToolDefinition {
  id: string;
  displayName: string;
  category: AgentToolCategory;
  mutates?: boolean;
}

export const AGENT_TOOL_REGISTRY = {
  getWorkspace: { id: "getWorkspace", displayName: "Read workspace", category: "workspace" },
  getWorksheetTree: { id: "getWorksheetTree", displayName: "Read worksheet tree", category: "worksheet" },
  getItemConfig: { id: "getItemConfig", displayName: "Read line item config", category: "worksheet" },
  createWorksheet: { id: "createWorksheet", displayName: "Create worksheet", category: "worksheet", mutates: true },
  createWorksheetFolder: { id: "createWorksheetFolder", displayName: "Create worksheet folder", category: "worksheet", mutates: true },
  updateWorksheetFolder: { id: "updateWorksheetFolder", displayName: "Update worksheet folder", category: "worksheet", mutates: true },
  deleteWorksheetFolder: { id: "deleteWorksheetFolder", displayName: "Delete worksheet folder", category: "worksheet", mutates: true },
  moveWorksheet: { id: "moveWorksheet", displayName: "Move worksheet", category: "worksheet", mutates: true },
  moveWorksheetFolder: { id: "moveWorksheetFolder", displayName: "Move worksheet folder", category: "worksheet", mutates: true },
  createWorksheetItem: { id: "createWorksheetItem", displayName: "Add worksheet line", category: "worksheet", mutates: true },
  updateWorksheetItem: { id: "updateWorksheetItem", displayName: "Update worksheet line", category: "worksheet", mutates: true },
  deleteWorksheetItem: { id: "deleteWorksheetItem", displayName: "Delete worksheet line", category: "worksheet", mutates: true },
  updateQuote: { id: "updateQuote", displayName: "Update quote", category: "quote", mutates: true },
  createCondition: { id: "createCondition", displayName: "Create condition", category: "quote", mutates: true },
  createPhase: { id: "createPhase", displayName: "Create phase", category: "quote", mutates: true },
  createScheduleTask: { id: "createScheduleTask", displayName: "Create schedule task", category: "quote", mutates: true },
  listScheduleTasks: { id: "listScheduleTasks", displayName: "List schedule tasks", category: "quote" },
  recalculateTotals: { id: "recalculateTotals", displayName: "Recalculate totals", category: "quote", mutates: true },
  listRateSchedules: { id: "listRateSchedules", displayName: "List rate schedules", category: "resources" },
  importRateSchedule: { id: "importRateSchedule", displayName: "Import rate schedule", category: "resources", mutates: true },
  listRateScheduleItems: { id: "listRateScheduleItems", displayName: "List rate items", category: "resources" },
  searchItems: { id: "searchItems", displayName: "Search item history", category: "resources" },
  listEstimateFactorLibrary: { id: "listEstimateFactorLibrary", displayName: "List factor library", category: "resources" },
  createEstimateFactorLibraryEntry: { id: "createEstimateFactorLibraryEntry", displayName: "Create factor library entry", category: "resources", mutates: true },
  updateEstimateFactorLibraryEntry: { id: "updateEstimateFactorLibraryEntry", displayName: "Update factor library entry", category: "resources", mutates: true },
  deleteEstimateFactorLibraryEntry: { id: "deleteEstimateFactorLibraryEntry", displayName: "Delete factor library entry", category: "resources", mutates: true },
  listEstimateFactors: { id: "listEstimateFactors", displayName: "List estimate factors", category: "quote" },
  createEstimateFactor: { id: "createEstimateFactor", displayName: "Create estimate factor", category: "quote", mutates: true },
  updateEstimateFactor: { id: "updateEstimateFactor", displayName: "Update estimate factor", category: "quote", mutates: true },
  deleteEstimateFactor: { id: "deleteEstimateFactor", displayName: "Delete estimate factor", category: "quote", mutates: true },
  createModifier: { id: "createModifier", displayName: "Create modifier", category: "quote", mutates: true },
  updateModifier: { id: "updateModifier", displayName: "Update modifier", category: "quote", mutates: true },
  deleteModifier: { id: "deleteModifier", displayName: "Delete modifier", category: "quote", mutates: true },
  createALI: { id: "createALI", displayName: "Create additional line", category: "quote", mutates: true },
  updateALI: { id: "updateALI", displayName: "Update additional line", category: "quote", mutates: true },
  deleteALI: { id: "deleteALI", displayName: "Delete additional line", category: "quote", mutates: true },
  createReportSection: { id: "createReportSection", displayName: "Create report section", category: "quote", mutates: true },
  updateReportSection: { id: "updateReportSection", displayName: "Update report section", category: "quote", mutates: true },
  deleteReportSection: { id: "deleteReportSection", displayName: "Delete report section", category: "quote", mutates: true },
  updateRevision: { id: "updateRevision", displayName: "Update revision", category: "quote", mutates: true },
  generateQuotePdf: { id: "generateQuotePdf", displayName: "Generate quote PDF", category: "quote", mutates: true },
  getPdfPreferences: { id: "getPdfPreferences", displayName: "Read PDF preferences", category: "quote" },
  updatePdfPreferences: { id: "updatePdfPreferences", displayName: "Update PDF preferences", category: "quote", mutates: true },
  applySummaryPreset: { id: "applySummaryPreset", displayName: "Apply summary preset", category: "summary", mutates: true },
  createSummaryRow: { id: "createSummaryRow", displayName: "Create summary row", category: "summary", mutates: true },
  updateSummaryRow: { id: "updateSummaryRow", displayName: "Update summary row", category: "summary", mutates: true },
  deleteSummaryRow: { id: "deleteSummaryRow", displayName: "Delete summary row", category: "summary", mutates: true },

  searchLineItemCandidates: { id: "searchLineItemCandidates", displayName: "Search cost sources", category: "resources" },
  recommendCostSource: { id: "recommendCostSource", displayName: "Recommend cost source", category: "resources" },
  recommendEstimateBasis: { id: "recommendEstimateBasis", displayName: "Recommend estimate basis", category: "resources" },
  recommendLaborBasis: { id: "recommendLaborBasis", displayName: "Recommend labor basis", category: "resources" },
  createWorksheetItemFromCandidate: { id: "createWorksheetItemFromCandidate", displayName: "Add priced line", category: "worksheet", mutates: true },
  listLaborUnits: { id: "listLaborUnits", displayName: "List labor units", category: "resources" },
  previewAssembly: { id: "previewAssembly", displayName: "Preview assembly", category: "resources" },

  queryKnowledge: { id: "queryKnowledge", displayName: "Search knowledge", category: "knowledge" },
  queryGlobalLibrary: { id: "queryGlobalLibrary", displayName: "Search global library", category: "knowledge" },
  queryDatasets: { id: "queryDatasets", displayName: "Query datasets", category: "knowledge" },
  createDataset: { id: "createDataset", displayName: "Create dataset", category: "knowledge", mutates: true },
  listDatasets: { id: "listDatasets", displayName: "List datasets", category: "knowledge" },
  listKnowledgeBooks: { id: "listKnowledgeBooks", displayName: "List books", category: "knowledge" },
  listKnowledgeDocuments: { id: "listKnowledgeDocuments", displayName: "List documents", category: "documents" },
  readDocumentText: { id: "readDocumentText", displayName: "Read document", category: "documents" },
  getDocumentStructured: { id: "getDocumentStructured", displayName: "Read document structure", category: "documents" },
  readSpreadsheet: { id: "readSpreadsheet", displayName: "Read spreadsheet", category: "documents" },
  getBookPage: { id: "getBookPage", displayName: "Read reference book", category: "knowledge" },
  searchCatalogs: { id: "searchCatalogs", displayName: "Search catalogs", category: "knowledge" },
  listDocuments: { id: "listDocuments", displayName: "List project documents", category: "documents" },

  listModels: { id: "listModels", displayName: "List models", category: "model" },
  getModelManifest: { id: "getModelManifest", displayName: "Read model manifest", category: "model" },
  queryModelElements: { id: "queryModelElements", displayName: "Query model elements", category: "model" },
  extractModelBom: { id: "extractModelBom", displayName: "Extract model BOM", category: "model" },
  getModelTakeoffLinks: { id: "getModelTakeoffLinks", displayName: "Read model links", category: "model" },
  linkModelElementToWorksheetItem: { id: "linkModelElementToWorksheetItem", displayName: "Link model quantity", category: "model", mutates: true },
  deleteModelTakeoffLink: { id: "deleteModelTakeoffLink", displayName: "Delete model link", category: "model", mutates: true },

  getEstimateStrategy: { id: "getEstimateStrategy", displayName: "Read estimate strategy", category: "strategy" },
  saveEstimateScopeGraph: { id: "saveEstimateScopeGraph", displayName: "Save scope graph", category: "strategy", mutates: true },
  saveEstimateExecutionPlan: { id: "saveEstimateExecutionPlan", displayName: "Save execution plan", category: "strategy", mutates: true },
  saveEstimateAssumptions: { id: "saveEstimateAssumptions", displayName: "Save assumptions", category: "strategy", mutates: true },
  saveEstimatePackagePlan: { id: "saveEstimatePackagePlan", displayName: "Save package plan", category: "strategy", mutates: true },
  recomputeEstimateBenchmarks: { id: "recomputeEstimateBenchmarks", displayName: "Recompute benchmarks", category: "strategy", mutates: true },
  saveEstimateAdjustments: { id: "saveEstimateAdjustments", displayName: "Save adjustments", category: "strategy", mutates: true },
  saveEstimateReconcile: { id: "saveEstimateReconcile", displayName: "Save reconcile check", category: "strategy", mutates: true },
  finalizeEstimateStrategy: { id: "finalizeEstimateStrategy", displayName: "Finalize estimate strategy", category: "strategy", mutates: true },

  saveReviewCoverage: { id: "saveReviewCoverage", displayName: "Save review coverage", category: "review", mutates: true },
  saveReviewFindings: { id: "saveReviewFindings", displayName: "Save review findings", category: "review", mutates: true },
  saveReviewCompetitiveness: { id: "saveReviewCompetitiveness", displayName: "Save competitiveness review", category: "review", mutates: true },
  saveReviewRecommendation: { id: "saveReviewRecommendation", displayName: "Save recommendation", category: "review", mutates: true },
  saveReviewSummary: { id: "saveReviewSummary", displayName: "Save review summary", category: "review", mutates: true },

  listDrawingPages: { id: "listDrawingPages", displayName: "List drawing pages", category: "vision" },
  renderDrawingPage: { id: "renderDrawingPage", displayName: "View drawing", category: "vision" },
  zoomDrawingRegion: { id: "zoomDrawingRegion", displayName: "Zoom drawing region", category: "vision" },
  countSymbols: { id: "countSymbols", displayName: "Count symbols", category: "vision" },
  saveCountAsAnnotations: { id: "saveCountAsAnnotations", displayName: "Save takeoff annotations", category: "vision", mutates: true },
  countSymbolsAllPages: { id: "countSymbolsAllPages", displayName: "Count symbols across drawings", category: "vision" },
  findSymbolCandidates: { id: "findSymbolCandidates", displayName: "Find symbol candidates", category: "vision" },
  scanDrawingSymbols: { id: "scanDrawingSymbols", displayName: "Scan drawing symbols", category: "vision" },
  detectScale: { id: "detectScale", displayName: "Detect drawing scale", category: "vision" },
  measureLinear: { id: "measureLinear", displayName: "Measure drawing length", category: "vision" },
  listTakeoffAnnotations: { id: "listTakeoffAnnotations", displayName: "List takeoff annotations", category: "vision" },
  linkTakeoffAnnotationToWorksheetItem: { id: "linkTakeoffAnnotationToWorksheetItem", displayName: "Link takeoff quantity", category: "vision", mutates: true },

  askUser: { id: "askUser", displayName: "Ask estimator", category: "system" },
  readMemory: { id: "readMemory", displayName: "Read memory", category: "system" },
  writeMemory: { id: "writeMemory", displayName: "Write memory", category: "system", mutates: true },
  getProjectSummary: { id: "getProjectSummary", displayName: "Read project summary", category: "system" },
  reportProgress: { id: "reportProgress", displayName: "Report progress", category: "system" },

  listIntegrations: { id: "listIntegrations", displayName: "List integrations", category: "integration" },
  describeIntegration: { id: "describeIntegration", displayName: "Describe integration", category: "integration" },
  invokeIntegrationAction: { id: "invokeIntegrationAction", displayName: "Use integration action", category: "integration", mutates: true },

  command_execution: { id: "command_execution", displayName: "Run command", category: "runtime", mutates: true },
} satisfies Record<string, AgentToolDefinition>;

export type AgentToolId = keyof typeof AGENT_TOOL_REGISTRY;

export function normalizeAgentToolId(toolId: string) {
  if (!toolId) return "";
  const lastSegment = toolId.includes(".") ? toolId.split(".").pop() || toolId : toolId;
  return lastSegment.replace(/^mcp__bidwright__/, "");
}

export function getAgentToolDefinition(toolId: string): AgentToolDefinition | null {
  const normalized = normalizeAgentToolId(toolId);
  return (AGENT_TOOL_REGISTRY as Record<string, AgentToolDefinition>)[normalized] ?? null;
}

export function formatFallbackToolDisplayName(toolId: string) {
  const normalized = normalizeAgentToolId(toolId);
  return normalized
    .replace(/[_-]+/g, " ")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^./, (letter) => letter.toUpperCase()) || "Use tool";
}

export function getAgentToolDisplayName(toolId: string) {
  return getAgentToolDefinition(toolId)?.displayName ?? formatFallbackToolDisplayName(toolId);
}

export function isAgentToolMutating(toolId: string) {
  const definition = getAgentToolDefinition(toolId);
  if (definition) return definition.mutates === true;

  const normalized = normalizeAgentToolId(toolId);
  return /^(create|update|delete|move|import|recalculate|apply|save|finalize|write|link|generate)/.test(normalized)
    || /(^|\.)(create|update|delete|add|remove|ingest|index|logActivity)/.test(toolId);
}
