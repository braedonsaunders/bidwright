"use client";

import { useEffect, useMemo, useState, useTransition, useRef, useCallback, type DragEvent, type SetStateAction } from "react";
import { createPortal } from "react-dom";
import { motion, AnimatePresence } from "motion/react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  Check,
  BookOpen,
  ChevronDown,
  ChevronRight,
  ClipboardList,
  Copy,
  Download,
  Clock,
  FileText,
  GitCompare,
  GripVertical,
  History,
  Layers3,
  Library,
  Loader2,
  MessageSquareText,
  Percent,
  Plus,
  Printer,
  RotateCcw,
  Save,
  Settings2,
  SearchCheck,
  SlidersHorizontal,
  Sparkles,
  Target,
  Zap,
  Puzzle,
  Trash2,
  X,
} from "lucide-react";
import type {
  CreateEstimateFactorInput,
  CreateWorksheetItemInput,
  Customer,
  EstimateFactor,
  EstimateFactorApplicationScope,
  EstimateFactorConfidence,
  EstimateFactorFormulaType,
  EstimateFactorImpact,
  EstimateFactorLibraryRecord,
  EstimateFactorScope,
  EstimateFactorSourceType,
  ModelTakeoffLinkRecord,
  PhasePatchInput,
  ProjectPhase,
  EntityCategory,
  PackageRecord,
  ProjectWorkspaceData,
  QuoteRevision,
  RevisionPatchInput,
  WorkspaceResponse,
  WorkspaceWorksheet,
  WorkspaceWorksheetItem,
} from "@/lib/api";
import {
  activateRevision,
  aiAcceptEquipment,
  aiAcceptPhases,
  aiRewriteDescription,
  aiRewriteNotes,
  aiSuggestEquipment,
  aiSuggestPhases,
  copyQuote,
  createEstimateFactor,
  createEstimateFactorLibraryEntry,
  createPhase,
  createRevision,
  createWorksheet,
  createWorksheetItem,
  deletePhase,
  deleteProject,
  deleteRevisionById,
  deleteWorksheet,
  deleteWorksheetItem,

  importPreview,
  importProcess,
  makeRevisionZero,
  sendQuote,
  updatePhase,
  updateProject,
  updateProjectStatus,
  updateRevision,
  updateQuote,
  updateWorkspaceState,
  updateWorksheet,
  getProjectWorkspace,
  getCustomers,
  getEntityCategories,
  createModelTakeoffLink,
  deleteModelTakeoffLink,
  deleteEstimateFactor,
  fetchQuotePdfBlobUrl,
  getQuotePdfPreviewUrl,
  importAssignedRateSchedules,
  listRateBookAssignments,
  listModelTakeoffLinks,
  getEstimateFactorLibrary,
  updateWorksheetItem,
  updateEstimateFactor,
} from "@/lib/api";
import { getClientDisplayName } from "@/lib/client-display";
import { formatDateTime, formatMoney, formatPercent } from "@/lib/format";
import {
  modelEditorChannelName,
  postWorkspaceMutation,
  workspaceChannelName,
  type WorkspaceSyncMessage,
} from "@/lib/workspace-sync";
import { bucketHoursByMultiplier, getWorksheetHourBreakdown } from "@/lib/worksheet-hours";
import { AgentChat, type AgentNavigationIntent } from "@/components/workspace/agent-chat";
import { EstimateGrid } from "@/components/workspace/estimate-grid";
import { FactorParameterEditor } from "@/components/workspace/factor-parameter-editor";
import { SetupTab } from "@/components/workspace/setup-tab";
import { SummarizeTab } from "@/components/workspace/summarize-tab";
import { DocumentationTab } from "@/components/workspace/documentation-tab";
import { TakeoffTab } from "@/components/workspace/takeoff-tab";
import { ReviewTab } from "@/components/workspace/review-tab";
import { AuditTrailTab } from "@/components/workspace/audit-trail";
import { RevisionCompare } from "@/components/workspace/revision-compare";
import {
  ConfirmModal,
  CreateWorksheetModal,
  RenameWorksheetModal,
  SendQuoteModal,
  ImportBOMModal,
  AIModal,
  AIPhasesModal,
  AIEquipmentModal,
  type AIPhaseResult,
  type AIEquipmentResult,
} from "@/components/workspace/modals";
import { PdfPagePreview, PdfStudio } from "@/components/workspace/pdf-studio";
import { PluginToolsPanel } from "@/components/workspace/plugin-tools-panel";
import { RevisionDiffModal } from "@/components/workspace/revision-diff-modal";
import { WorkspaceI18nSurface } from "@/components/workspace/workspace-i18n-surface";
import { WorkspaceSearch, type SearchNavigationTarget } from "@/components/workspace/workspace-search";
import type {
  BidwrightModelLineItemDraft,
  BidwrightModelLinkedLineItem,
  BidwrightModelSelectionMessage,
} from "@/components/workspace/editors/bidwright-model-editor";
import { SearchablePicker } from "@/components/shared/searchable-picker";
import {
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  CardTitle,
  EmptyState,
  Input,
  Label,
  Select,
  Separator,
  Textarea,
  Toggle,
} from "@/components/ui";
import { cn } from "@/lib/utils";
import { validateEstimateWorkspace, type EstimateValidationWorkspaceLike } from "@bidwright/domain";
import type { QualityFinding } from "@/components/workspace/quality-panel";
import type { ResourceSummaryRow } from "@/components/workspace/resource-summary-panel";

/* ─── Types ─── */

type WorkspaceTab = "setup" | "estimate" | "summarize" | "documents" | "review" | "activity";
type EstimateSubTab = "takeoff" | "worksheets" | "factors" | "phases";
type PluginToolsTarget = { pluginId?: string; pluginSlug?: string; toolId?: string };

type ItemDraft = {
  mode: "create" | "edit";
  worksheetId: string;
  itemId?: string;
  phaseId: string;
  categoryId: string | null;
  category: string;
  entityType: string;
  entityName: string;
  vendor: string;
  description: string;
  quantity: number;
  uom: string;
  cost: number;
  markup: number;
  price: number;
  tierUnits: Record<string, number>;
  lineOrder: number;
};

type ModalState =
  | null
  | "deleteQuote"
  | "copyQuote"
  | "createRevision"
  | "deleteRevision"
  | "makeRevZero"
  | "createWorksheet"
  | "renameWorksheet"
  | "deleteWorksheet"
  | "sendQuote"
  | "createJob"
  | "importBOM"
  | "aiDescription"
  | "aiNotes"
  | "aiPhases"
  | "aiEquipment"
  | "activity"
  | "pdf"
  | "compare";

/* ─── Constants ─── */

const QUOTE_STATUSES = [
  { value: "Open", label: "Open", color: "success" },
  { value: "Pending", label: "Pending", color: "warning" },
  { value: "Awarded", label: "Awarded", color: "info" },
  { value: "DidNotGet", label: "Did Not Get", color: "danger" },
  { value: "Declined", label: "Declined", color: "default" },
  { value: "Cancelled", label: "Cancelled", color: "default" },
  { value: "Closed", label: "Closed", color: "default" },
  { value: "Other", label: "Other", color: "warning" },
] as const;

const tabs: Array<{ id: WorkspaceTab; label: string; icon: typeof FileText }> = [
  { id: "setup", label: "Setup", icon: Settings2 },
  { id: "estimate", label: "Estimate", icon: Layers3 },
  { id: "documents", label: "Documents", icon: FileText },
  { id: "summarize", label: "Summarize", icon: ClipboardList },
  { id: "review", label: "Review", icon: SearchCheck },
  { id: "activity", label: "Activity", icon: MessageSquareText },
];
const estimateSubTabs = ["takeoff", "worksheets", "factors", "phases"] as const;

/* ─── Utilities ─── */

function toDateInput(value: string | null | undefined): string {
  if (!value) return "";
  try {
    return new Date(value).toISOString().slice(0, 10);
  } catch {
    return "";
  }
}

function fromDateInput(value: string): string | null {
  return value || null;
}

function buildItemDraft(
  ws: WorkspaceWorksheet,
  item?: WorkspaceWorksheetItem,
  entityCategories: EntityCategory[] = [],
): ItemDraft {
  const fallbackCat = entityCategories
    .filter((c) => c.enabled)
    .slice()
    .sort((a, b) => a.order - b.order)[0];
  return {
    mode: item ? "edit" : "create", worksheetId: ws.id, itemId: item?.id,
    phaseId: item?.phaseId ?? "", categoryId: item?.categoryId ?? fallbackCat?.id ?? null, category: item?.category ?? fallbackCat?.name ?? "",
    entityType: item?.entityType ?? fallbackCat?.entityType ?? "", entityName: item?.entityName ?? "",
    vendor: item?.vendor ?? "", description: item?.description ?? "",
    quantity: item?.quantity ?? 1, uom: item?.uom ?? "EA",
    cost: item?.cost ?? 0, markup: item?.markup ?? 0.2, price: item?.price ?? 0,
    tierUnits: { ...(item?.tierUnits ?? {}) }, lineOrder: item?.lineOrder ?? ws.items.length + 1,
  };
}

function pickModelLineCategory(entityCategories: EntityCategory[]) {
  const enabled = entityCategories.filter((category) => category.enabled);
  return enabled.find((category) => {
    const haystack = `${category.name} ${category.entityType}`.toLowerCase();
    return haystack.includes("model") || haystack.includes("takeoff");
  }) ?? enabled.slice().sort((left, right) => left.order - right.order)[0] ?? null;
}

function parseNum(v: string, fb = 0) { const n = Number(v); return Number.isFinite(n) ? n : fb; }
function fmtPct(v: number) { return Number.isFinite(v) ? String(Math.round(v * 1000) / 10) : "0"; }

function statusTone(s: string | undefined | null) {
  if (!s) return "default" as const;
  switch (s.toLowerCase()) {
    case "ready": case "complete": case "review": case "quoted": case "awarded": case "open": return "success" as const;
    case "processing": case "queued": case "pending": case "other": return "warning" as const;
    case "failed": case "didnotget": case "declined": case "cancelled": return "danger" as const;
    default: return "default" as const;
  }
}

function estimateSubTabLabel(tab: EstimateSubTab) {
  if (tab === "takeoff") return "Takeoff";
  if (tab === "worksheets") return "Worksheets";
  if (tab === "factors") return "Factors";
  return "Phases";
}

function qualitySeverity(severity: "info" | "warning" | "error" | "critical"): QualityFinding["severity"] {
  return severity === "critical" ? "error" : severity;
}

function elementLabel(element: { id?: string; itemId?: string; worksheetId?: string; path?: string; label?: string } | undefined) {
  if (!element) return undefined;
  return element.label ?? element.itemId ?? element.worksheetId ?? element.id ?? element.path;
}

function inferResourceSummaryType(
  item: Pick<WorkspaceWorksheetItem, "category" | "entityType">,
  categoryBucketByName: Map<string, string>,
): ResourceSummaryRow["type"] {
  const category = item.category.trim();
  const bucket = categoryBucketByName.get(category.toLowerCase())?.trim();
  return bucket || category || item.entityType.trim() || "Uncategorized";
}

function resourceRecordsForItem(item: WorkspaceWorksheetItem): Record<string, unknown>[] {
  const composition = item.resourceComposition;
  if (!composition || typeof composition !== "object" || Array.isArray(composition)) return [];
  const resources = (composition as Record<string, unknown>).resources;
  return Array.isArray(resources)
    ? resources.filter((resource): resource is Record<string, unknown> =>
        !!resource && typeof resource === "object" && !Array.isArray(resource),
      )
    : [];
}

function resourceText(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : "";
}

function resourceNumber(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function resourceObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

const RESOURCE_SOURCE_KIND_KEYS = new Set([
  "assembly_component",
  "catalog_item",
  "cost_intelligence",
  "cost_resource",
  "labor_unit",
  "line_item_search",
  "manual",
  "mixed",
  "rate_schedule_item",
  "sub_assembly",
  "worksheet_item",
]);

function resourceKindKey(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function mergeResourceLabel(current: string | undefined, next: string | undefined) {
  if (!next) return current;
  if (!current) return next;
  return current === next ? current : "Multiple";
}

type ResourceHourFields = Required<Pick<ResourceSummaryRow, "hoursUnit1" | "hoursUnit2" | "hoursUnit3" | "totalHours">>;

function roundResourceHours(value: number) {
  return Math.round((Number.isFinite(value) ? value : 0) * 100) / 100;
}

function emptyResourceHours(): ResourceHourFields {
  return { hoursUnit1: 0, hoursUnit2: 0, hoursUnit3: 0, totalHours: 0 };
}

function scaleResourceHours(hours: ResourceHourFields, factor: number): ResourceHourFields {
  const multiplier = Number.isFinite(factor) ? factor : 0;
  const hoursUnit1 = roundResourceHours(hours.hoursUnit1 * multiplier);
  const hoursUnit2 = roundResourceHours(hours.hoursUnit2 * multiplier);
  const hoursUnit3 = roundResourceHours(hours.hoursUnit3 * multiplier);
  return {
    hoursUnit1,
    hoursUnit2,
    hoursUnit3,
    totalHours: roundResourceHours(hoursUnit1 + hoursUnit2 + hoursUnit3),
  };
}

function worksheetItemExtendedHours(
  item: WorkspaceWorksheetItem,
  rateSchedules: ProjectWorkspaceData["rateSchedules"],
): ResourceHourFields {
  const quantity = Number(item.quantity) || 0;
  const breakdown = getWorksheetHourBreakdown(item, rateSchedules ?? []);
  const buckets = bucketHoursByMultiplier(breakdown);
  const hoursUnit1 = roundResourceHours(buckets.reg * quantity);
  const hoursUnit2 = roundResourceHours(buckets.ot * quantity);
  const hoursUnit3 = roundResourceHours(buckets.dt * quantity);
  return {
    hoursUnit1,
    hoursUnit2,
    hoursUnit3,
    totalHours: roundResourceHours(hoursUnit1 + hoursUnit2 + hoursUnit3),
  };
}

function isHourBearingResource(
  type: string,
  unit: string | undefined,
  item: WorkspaceWorksheetItem,
  category: EntityCategory | undefined,
  resource?: Record<string, unknown>,
) {
  const normalizedType = resourceKindKey(type);
  const explicitResourceType = resourceText(resource?.resourceType ?? resource?.type);
  const explicitResourceTypeKey = resourceKindKey(explicitResourceType);
  const hasExplicitResourceType = !!explicitResourceType && !RESOURCE_SOURCE_KIND_KEYS.has(explicitResourceTypeKey);
  if (
    hasExplicitResourceType
    && (
      explicitResourceTypeKey.includes("material")
      || explicitResourceTypeKey.includes("equipment")
      || explicitResourceTypeKey.includes("subcontract")
      || explicitResourceTypeKey.includes("travel")
      || explicitResourceTypeKey.includes("allowance")
    )
  ) {
    return false;
  }

  if (normalizedType.includes("labour") || normalizedType.includes("labor")) return true;
  if (item.rateScheduleItemId || item.laborUnitId) return true;
  if (resourceText(resource?.laborUnitId) || resourceText(resource?.rateScheduleItemId)) return true;
  if (category?.calculationType === "tiered_rate" || category?.calculationType === "duration_rate") return true;

  const haystack = [
    type,
    unit,
    item.category,
    item.entityType,
    item.uom,
    category?.analyticsBucket,
    category?.entityType,
    ...Object.values(category?.unitLabels ?? {}),
    resourceText(resource?.resourceType),
    resourceText(resource?.type),
    resourceText(resource?.sourceType),
    resourceText(resource?.componentType),
  ].filter(Boolean).join(" ").toLowerCase();

  return /\blabou?r\b|hours?|hrs?|man\s*hours?|crew|regular|overtime|double\s*time|straight\s*time/.test(haystack);
}

function addResourceHours(target: ResourceSummaryRow, hours: ResourceHourFields) {
  target.hoursUnit1 = roundResourceHours((target.hoursUnit1 ?? 0) + hours.hoursUnit1);
  target.hoursUnit2 = roundResourceHours((target.hoursUnit2 ?? 0) + hours.hoursUnit2);
  target.hoursUnit3 = roundResourceHours((target.hoursUnit3 ?? 0) + hours.hoursUnit3);
  target.totalHours = roundResourceHours((target.totalHours ?? 0) + hours.totalHours);
}

function buildResourceSummaryRows(workspace: ProjectWorkspaceData): ResourceSummaryRow[] {
  const grouped = new Map<string, ResourceSummaryRow>();
  const phaseById = new Map(
    (workspace.phases ?? []).map((phase) => [
      phase.id,
      [phase.number, phase.name].map((part) => part?.trim()).filter(Boolean).join(" - ") || "Phase",
    ]),
  );
  const worksheetById = new Map((workspace.worksheets ?? []).map((worksheet) => [worksheet.id, worksheet.name || "Worksheet"]));
  const categoryById = new Map((workspace.entityCategories ?? []).map((category) => [category.id, category.name || category.entityType || "Uncategorized"]));
  const categoryDefinitionById = new Map((workspace.entityCategories ?? []).map((category) => [category.id, category]));
  const categoryDefinitionByName = new Map((workspace.entityCategories ?? []).map((category) => [category.name.trim().toLowerCase(), category]));
  const categoryBucketByName = new Map(
    (workspace.entityCategories ?? [])
      .filter((category) => category.analyticsBucket)
      .map((category) => [category.name.trim().toLowerCase(), category.analyticsBucket ?? ""]),
  );

  for (const worksheet of workspace.worksheets ?? []) {
    for (const item of worksheet.items ?? []) {
      const worksheetLabel = worksheetById.get(item.worksheetId) ?? worksheet.name ?? "Worksheet";
      const phaseLabel = item.phaseId ? phaseById.get(item.phaseId) ?? "Unassigned Phase" : "Unphased";
      const categoryLabel = item.categoryId
        ? categoryById.get(item.categoryId) ?? (item.category || item.entityType || "Uncategorized")
        : item.category || item.entityType || "Uncategorized";
      const itemLabel = (item.entityName || item.description || "Worksheet item").trim();
      const fallbackType = inferResourceSummaryType(item, categoryBucketByName);
      const fallbackVendor = item.vendor?.trim() || "Unassigned Vendor";
      const categoryDefinition = (item.categoryId ? categoryDefinitionById.get(item.categoryId) : undefined)
        ?? categoryDefinitionByName.get(item.category.trim().toLowerCase());
      const itemHours = worksheetItemExtendedHours(item, workspace.rateSchedules ?? []);
      const resources = resourceRecordsForItem(item);
      if (resources.length > 0) {
        const resourceHourWeights = resources.map((resource) => {
          const rawType = resourceText(resource.resourceType ?? resource.type);
          const type = rawType && !RESOURCE_SOURCE_KIND_KEYS.has(resourceKindKey(rawType)) ? rawType : fallbackType;
          const unit = resourceText(resource.uom ?? resource.unit) || item.uom || "EA";
          const quantityPerUnit = resourceNumber(resource.quantityPerUnit ?? resource.quantity ?? resource.qty) || 1;
          const quantity = (Number(item.quantity) || 0) * quantityPerUnit;
          const hourBearing = isHourBearingResource(type, unit, item, categoryDefinition, resource);
          return { hourBearing, weight: hourBearing ? Math.max(0, quantity) : 0 };
        });
        const hourBearingCount = resourceHourWeights.filter((entry) => entry.hourBearing).length;
        const hourBearingWeightTotal = resourceHourWeights.reduce((sum, entry) => sum + entry.weight, 0);

        for (const [resourceIndex, resource] of resources.entries()) {
          const sourceKind = resourceText(resource.componentType ?? resource.sourceType ?? resource.source);
          const rawType = resourceText(resource.resourceType ?? resource.type);
          const type = rawType && !RESOURCE_SOURCE_KIND_KEYS.has(resourceKindKey(rawType)) ? rawType : fallbackType;
          const name = resourceText(resource.entityName ?? resource.name ?? resource.description) || (item.entityName || item.description || "Unnamed resource").trim();
          const unit = resourceText(resource.uom ?? resource.unit) || item.uom || "EA";
          const quantityPerUnit = resourceNumber(resource.quantityPerUnit ?? resource.quantity ?? resource.qty) || 1;
          const quantity = (Number(item.quantity) || 0) * quantityPerUnit;
          const unitCost = resourceNumber(resource.unitCost ?? resource.cost ?? resource.costRate);
          const unitPrice = resourceNumber(resource.unitPrice ?? resource.price ?? resource.rate);
          const extendedCost = resourceNumber(resource.lineCost) || (unitCost > 0 ? quantity * unitCost : resourceNumber(resource.linePrice) || quantity * unitPrice);
          const sourceId = resourceText(resource.effectiveCostId ?? resource.costResourceId ?? resource.laborUnitId ?? resource.rateScheduleItemId ?? resource.itemId);
          const sourceLabel = sourceKind || (RESOURCE_SOURCE_KIND_KEYS.has(resourceKindKey(rawType)) ? rawType : "") || item.category;
          const variant = resourceObject(resource.variant);
          const code = resourceText(resource.code ?? resource.sku ?? resource.vendorSku ?? resource.partNumber);
          const variantLabel = resourceText(resource.variantLabel ?? variant?.name ?? variant?.selectedRateKey ?? variant?.selectedCostRateKey);
          const vendorLabel = resourceText(resource.vendorName ?? resource.vendor ?? resource.supplier ?? resource.manufacturer) || fallbackVendor;
          const averageUnitRate = quantity > 0 ? extendedCost / quantity : unitCost || unitPrice;
          const key = `${type.trim().toLowerCase()}|${sourceId || name.toLowerCase()}|${unit.toLowerCase()}`;
          const hourWeight = resourceHourWeights[resourceIndex];
          const hourShare = hourWeight?.hourBearing
            ? (hourBearingWeightTotal > 0 ? hourWeight.weight / hourBearingWeightTotal : 1 / Math.max(1, hourBearingCount))
            : 0;
          const positionHours = hourShare > 0 ? scaleResourceHours(itemHours, hourShare) : emptyResourceHours();
          const position = {
            id: `${item.id}:${sourceId || name}:${unit}:${resourceIndex}`,
            resourceId: key,
            resourceName: name,
            code: code || undefined,
            type,
            unit,
            quantity,
            totalCost: extendedCost,
            averageUnitRate,
            ...positionHours,
            positionCount: 1,
            worksheetId: worksheet.id,
            worksheetLabel,
            itemId: item.id,
            itemLabel,
            phaseId: item.phaseId ?? null,
            phaseLabel,
            categoryId: item.categoryId ?? null,
            categoryLabel,
            vendorLabel,
            sourceLabel,
            variantLabel: variantLabel || undefined,
            confidence: item.sourceEvidence && Object.keys(item.sourceEvidence).length > 0 ? 0.9 : item.sourceNotes ? 0.8 : 0.6,
          };
          const existing = grouped.get(key);
          if (existing) {
            existing.totalQuantity += quantity;
            existing.totalCost += extendedCost;
            existing.positionCount = (existing.positionCount ?? 0) + 1;
            existing.averageUnitRate = existing.totalQuantity > 0 ? existing.totalCost / existing.totalQuantity : 0;
            addResourceHours(existing, positionHours);
            existing.phaseLabel = mergeResourceLabel(existing.phaseLabel, phaseLabel);
            existing.categoryLabel = mergeResourceLabel(existing.categoryLabel, categoryLabel);
            existing.vendorLabel = mergeResourceLabel(existing.vendorLabel, vendorLabel);
            existing.worksheetLabel = mergeResourceLabel(existing.worksheetLabel, worksheetLabel);
            existing.positions = [...(existing.positions ?? []), position];
          } else {
            grouped.set(key, {
              id: key,
              name,
              type,
              code: code || undefined,
              unit,
              totalQuantity: quantity,
              totalCost: extendedCost,
              averageUnitRate,
              ...positionHours,
              positionCount: 1,
              sourceLabel,
              confidence: position.confidence,
              variantLabel: variantLabel || undefined,
              phaseLabel,
              categoryLabel,
              vendorLabel,
              worksheetLabel,
              positions: [position],
            });
          }
        }
        continue;
      }

      const type = fallbackType;
      const name = (item.entityName || item.description || "Unnamed resource").trim();
      const unit = item.uom || "EA";
      const key = `${type.trim().toLowerCase()}|${name.toLowerCase()}|${unit.toLowerCase()}`;
      const quantity = Number(item.quantity) || 0;
      const unitCost = Number(item.cost) || 0;
      const extendedCost = unitCost > 0 ? quantity * unitCost : Number(item.price) || 0;
      const averageUnitRate = quantity > 0 ? extendedCost / quantity : unitCost;
      const positionHours = isHourBearingResource(type, unit, item, categoryDefinition) ? itemHours : emptyResourceHours();
      const position = {
        id: `${item.id}:${name}:${unit}`,
        resourceId: key,
        resourceName: name,
        type,
        unit,
        quantity,
        totalCost: extendedCost,
        averageUnitRate,
        ...positionHours,
        positionCount: 1,
        worksheetId: worksheet.id,
        worksheetLabel,
        itemId: item.id,
        itemLabel,
        phaseId: item.phaseId ?? null,
        phaseLabel,
        categoryId: item.categoryId ?? null,
        categoryLabel,
        vendorLabel: fallbackVendor,
        sourceLabel: item.category,
        confidence: item.sourceNotes ? 0.85 : 0.55,
      };
      const existing = grouped.get(key);
      if (existing) {
        existing.totalQuantity += quantity;
        existing.totalCost += extendedCost;
        existing.positionCount = (existing.positionCount ?? 0) + 1;
        existing.averageUnitRate = existing.totalQuantity > 0 ? existing.totalCost / existing.totalQuantity : 0;
        addResourceHours(existing, positionHours);
        existing.phaseLabel = mergeResourceLabel(existing.phaseLabel, phaseLabel);
        existing.categoryLabel = mergeResourceLabel(existing.categoryLabel, categoryLabel);
        existing.vendorLabel = mergeResourceLabel(existing.vendorLabel, fallbackVendor);
        existing.worksheetLabel = mergeResourceLabel(existing.worksheetLabel, worksheetLabel);
        existing.positions = [...(existing.positions ?? []), position];
      } else {
        grouped.set(key, {
          id: key,
          name,
          type,
          unit,
          totalQuantity: quantity,
          totalCost: extendedCost,
          averageUnitRate,
          ...positionHours,
          positionCount: 1,
          sourceLabel: item.category,
          confidence: item.sourceNotes ? 0.85 : 0.55,
          phaseLabel,
          categoryLabel,
          vendorLabel: fallbackVendor,
          worksheetLabel,
          positions: [position],
        });
      }
    }
  }
  return Array.from(grouped.values()).sort((left, right) => right.totalCost - left.totalCost);
}

function isWorkspaceTab(value: string | null): value is WorkspaceTab {
  return tabs.some((tab) => tab.id === value);
}

function isEstimateSubTab(value: string | null): value is EstimateSubTab {
  return estimateSubTabs.some((tab) => tab === value);
}

/* ─── Status Dropdown ─── */
function StatusDropdown({ value, onChange, options }: {
  value: string;
  onChange: (v: string) => void;
  options: readonly { value: string; label: string; [k: string]: unknown }[];
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const tone = statusTone(value);
  const toneClasses = {
    success: "border-success/30 bg-success/10 text-success hover:bg-success/15",
    warning: "border-warning/30 bg-warning/10 text-warning hover:bg-warning/15",
    danger: "border-danger/30 bg-danger/10 text-danger hover:bg-danger/15",
    default: "border-line bg-panel2/50 text-fg/60 hover:bg-panel2/70",
    info: "border-accent/30 bg-accent/10 text-accent hover:bg-accent/15",
  };

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  return (
    <div ref={ref} className="relative shrink-0">
      <button
        onClick={() => setOpen(!open)}
        className={cn(
          "inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[10px] font-medium transition-colors",
          toneClasses[tone]
        )}
      >
        {options.find((o) => o.value === value)?.label ?? value}
        <ChevronDown className={cn("h-2.5 w-2.5 transition-transform", open && "rotate-180")} />
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: -4 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: -4 }}
            transition={{ duration: 0.12 }}
            className="absolute left-0 top-full z-50 mt-1 min-w-[120px] rounded-lg border border-line bg-panel shadow-xl py-1"
          >
            {options.map((o) => {
              const t = statusTone(o.value);
              return (
                <button
                  key={o.value}
                  onClick={() => { onChange(o.value); setOpen(false); }}
                  className={cn(
                    "w-full text-left px-3 py-1.5 text-[11px] transition-colors flex items-center gap-2",
                    value === o.value ? "bg-accent/10 text-accent font-medium" : "text-fg/70 hover:bg-panel2/60"
                  )}
                >
                  <span className={cn(
                    "h-1.5 w-1.5 rounded-full shrink-0",
                    t === "success" && "bg-success",
                    t === "warning" && "bg-warning",
                    t === "danger" && "bg-danger",
                    t === "default" && "bg-fg/30",
                  )} />
                  {o.label}
                </button>
              );
            })}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function RevisionSwitcher({
  revisions,
  currentRevision,
  isPending,
  onActivate,
  onCreate,
  onCompare,
  onMakeRevisionZero,
  onDeleteCurrent,
}: {
  revisions: QuoteRevision[];
  currentRevision: QuoteRevision;
  isPending: boolean;
  onActivate: (revisionId: string) => void;
  onCreate: () => void;
  onCompare: () => void;
  onMakeRevisionZero: () => void;
  onDeleteCurrent: () => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  function runAction(action: () => void) {
    setOpen(false);
    action();
  }

  return (
    <div ref={ref} className="relative inline-flex shrink-0">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="inline-flex items-center gap-1 rounded-md border border-line/70 bg-panel2/40 px-1.5 py-0.5 text-[11px] font-medium text-fg/55 transition-colors hover:border-accent/30 hover:text-fg/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/30"
        aria-label="Switch estimate revision"
        aria-expanded={open}
      >
        <History className="h-3 w-3" />
        <span>Rev {currentRevision.revisionNumber}</span>
        <ChevronDown className={cn("h-3 w-3 transition-transform", open && "rotate-180")} />
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, scale: 0.97, y: -4 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.97, y: -4 }}
            transition={{ duration: 0.12 }}
            className="absolute left-0 top-full z-50 mt-1 w-[360px] overflow-hidden rounded-lg border border-line bg-panel text-xs shadow-xl"
          >
            <div className="flex items-center justify-between gap-3 border-b border-line px-3 py-2">
              <div className="min-w-0">
                <div className="text-[11px] font-semibold text-fg/75">Revision history</div>
                <div className="text-[10px] text-fg/35">
                  {revisions.length} saved revision{revisions.length === 1 ? "" : "s"}
                </div>
              </div>
              <Button size="xs" variant="secondary" onClick={() => runAction(onCreate)} disabled={isPending}>
                <Plus className="h-3 w-3" /> New
              </Button>
            </div>
            <div className="max-h-[280px] overflow-y-auto p-1">
              {revisions.map((revision) => {
                const isActive = revision.id === currentRevision.id;
                return (
                  <button
                    key={revision.id}
                    type="button"
                    onClick={() => runAction(() => onActivate(revision.id))}
                    disabled={isPending || isActive}
                    title={isActive ? "Current revision" : `Switch to revision ${revision.revisionNumber}`}
                    className={cn(
                      "flex w-full items-start gap-2 rounded-md px-2 py-2 text-left transition-colors",
                      isActive ? "bg-accent/8 text-fg" : "text-fg/70 hover:bg-panel2/70 hover:text-fg",
                      "disabled:cursor-default disabled:opacity-100",
                    )}
                  >
                    <span
                      className={cn(
                        "mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-md border",
                        isActive ? "border-accent/30 bg-accent/8 text-accent" : "border-line bg-bg/40 text-fg/35",
                      )}
                    >
                      {isActive ? <Check className="h-3 w-3" /> : <RotateCcw className="h-3 w-3" />}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-2">
                        <span className="font-medium">Rev {revision.revisionNumber}</span>
                        {isActive && <Badge tone="info" className="py-0 text-[10px]">Current</Badge>}
                      </span>
                      <span className="mt-0.5 block truncate text-[11px] text-fg/45">
                        {revision.title || "Untitled revision"}
                      </span>
                      <span className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[10px] text-fg/35">
                        <span className="inline-flex items-center gap-1">
                          <Clock className="h-3 w-3" />
                          {formatDateTime(revision.updatedAt)}
                        </span>
                        <span>{formatMoney(revision.subtotal)}</span>
                        <span>{formatPercent(revision.estimatedMargin, 1)} margin</span>
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>
            <div className="grid grid-cols-2 gap-1 border-t border-line p-2">
              <Button size="xs" variant="ghost" onClick={() => runAction(onCompare)} disabled={isPending}>
                <GitCompare className="h-3 w-3" /> Compare
              </Button>
              <Button
                size="xs"
                variant="ghost"
                onClick={() => runAction(onMakeRevisionZero)}
                disabled={isPending || currentRevision.revisionNumber === 0}
                title={currentRevision.revisionNumber === 0 ? "This is already revision 0" : "Make the current revision revision 0"}
              >
                <RotateCcw className="h-3 w-3" /> Make Rev 0
              </Button>
              <Button
                size="xs"
                variant="danger"
                className="col-span-2"
                onClick={() => runAction(onDeleteCurrent)}
                disabled={isPending || currentRevision.revisionNumber === 0}
                title={currentRevision.revisionNumber === 0 ? "Revision 0 cannot be deleted" : "Delete the current revision"}
              >
                <Trash2 className="h-3 w-3" /> Delete Current Revision
              </Button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function findWs(workspace: ProjectWorkspaceData, id: string) {
  return (workspace.worksheets ?? []).find((w) => w.id === id) ?? (workspace.worksheets ?? [])[0] ?? null;
}

type ModelEditorQuantityBasis = "count" | "area" | "volume";
const MAX_MODEL_OBJECT_LINE_ITEMS = 250;

type ModelEditorChannelMessage = {
  type:
    | "model-estimate-context-request"
    | "model-line-items-request"
    | "model-send-to-estimate"
    | "model-line-item-update"
    | "model-line-item-delete";
  source?: string;
  eventId?: string;
  projectId?: string;
  modelId?: string;
  modelDocumentId?: string;
  selection?: BidwrightModelSelectionMessage;
  lineItemDraft?: BidwrightModelLineItemDraft;
  lineItemDrafts?: BidwrightModelLineItemDraft[];
  linkId?: string;
  worksheetItemId?: string;
  patch?: {
    entityName?: string;
    description?: string;
    quantity?: number;
    uom?: string;
  };
};

function formatModelEditorQuantity(value: number, unit: string) {
  if (!Number.isFinite(value) || Math.abs(value) < 0.000001) return `0 ${unit}`;
  return `${Intl.NumberFormat(undefined, { maximumFractionDigits: Math.abs(value) >= 100 ? 0 : 2 }).format(value)} ${unit}`;
}

function primaryModelEditorQuantity(selection: BidwrightModelSelectionMessage, basis: ModelEditorQuantityBasis = "count") {
  if (basis === "area" && selection.totals.surfaceArea > 0) {
    return { quantity: selection.totals.surfaceArea, uom: "model^2", label: "3D surface area" };
  }
  if (basis === "volume" && selection.totals.volume > 0) {
    return { quantity: selection.totals.volume, uom: "model^3", label: "3D volume" };
  }
  return { quantity: Math.max(1, selection.selectedCount), uom: "EA", label: "3D selected elements" };
}

function buildModelEditorLineItemFallback(
  selection: BidwrightModelSelectionMessage,
  options: { fileName?: string; markup: number; category?: EntityCategory | null },
): CreateWorksheetItemInput {
  const sourceFile = selection.documentName ?? selection.fileName ?? options.fileName ?? "selected model";
  const basis =
    typeof selection === "object" && selection && "quantityBasis" in selection
      ? ((selection as { quantityBasis?: ModelEditorQuantityBasis }).quantityBasis ?? "count")
      : "count";
  const primary = primaryModelEditorQuantity(selection, basis);
  const selectedNames = selection.nodes.map((node) => node.name).filter(Boolean).slice(0, 12);

  return {
    categoryId: options.category?.id ?? null,
    category: options.category?.name ?? "Model Takeoff",
    entityType: options.category?.entityType ?? "Model Quantity",
    entityName: selectedNames[0] || `${selection.selectedCount} model element${selection.selectedCount === 1 ? "" : "s"}`,
    description: sourceFile,
    quantity: primary.quantity,
    uom: primary.uom,
    cost: 0,
    markup: options.markup,
    price: 0,
    tierUnits: {},
    sourceNotes: [
      `From BidWright model editor: ${sourceFile}`,
      `${primary.label}: ${formatModelEditorQuantity(primary.quantity, primary.uom)}`,
      `Surface area: ${formatModelEditorQuantity(selection.totals.surfaceArea, "model^2")}`,
      `Volume: ${formatModelEditorQuantity(selection.totals.volume, "model^3")}`,
      `Faces: ${Intl.NumberFormat().format(selection.totals.faceCount)}`,
      `Solids: ${Intl.NumberFormat().format(selection.totals.solidCount)}`,
      selectedNames.length > 0 ? `Selected: ${selectedNames.join(", ")}` : "",
    ].filter(Boolean).join("\n"),
  };
}

function finiteModelMetric(value: number | undefined) {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function selectionForModelEditorNode(
  selection: BidwrightModelSelectionMessage,
  selectedNodeIds: string[] | undefined,
): BidwrightModelSelectionMessage {
  const ids = new Set(selectedNodeIds ?? []);
  const nodes = ids.size > 0 ? selection.nodes.filter((node) => ids.has(node.id)) : selection.nodes;
  if (nodes.length === selection.nodes.length) return selection;
  return {
    ...selection,
    selectedCount: nodes.length,
    nodes,
    totals: {
      surfaceArea: nodes.reduce((total, node) => total + finiteModelMetric(node.surfaceArea), 0),
      volume: nodes.reduce((total, node) => total + finiteModelMetric(node.volume), 0),
      faceCount: nodes.reduce((total, node) => total + finiteModelMetric(node.faceCount), 0),
      solidCount: nodes.reduce((total, node) => total + finiteModelMetric(node.solidCount), 0),
    },
  };
}

function modelNodePrimaryQuantity(
  node: BidwrightModelSelectionMessage["nodes"][number],
  basis: ModelEditorQuantityBasis,
) {
  if (basis === "area" && finiteModelMetric(node.surfaceArea) > 0) {
    return { quantity: finiteModelMetric(node.surfaceArea), uom: "model^2", label: "3D surface area", quantityType: "surface_area" };
  }
  if (basis === "volume" && finiteModelMetric(node.volume) > 0) {
    return { quantity: finiteModelMetric(node.volume), uom: "model^3", label: "3D volume", quantityType: "volume" };
  }
  return { quantity: 1, uom: "EA", label: "3D model object", quantityType: "count" };
}

function buildModelEditorObjectDrafts(
  selection: BidwrightModelSelectionMessage,
  options: { fileName?: string; markup: number; category?: EntityCategory | null },
): BidwrightModelLineItemDraft[] {
  const basis = selection.quantityBasis ?? "count";
  const sourceFile = selection.documentName ?? selection.fileName ?? options.fileName ?? "selected model";
  return selection.nodes.slice(0, MAX_MODEL_OBJECT_LINE_ITEMS).map((node) => {
    const primary = modelNodePrimaryQuantity(node, basis);
    return {
      categoryId: options.category?.id ?? null,
      category: options.category?.name ?? "Model Takeoff",
      entityType: options.category?.entityType ?? node.kind ?? "Model Element",
      entityName: node.name || node.id,
      description: sourceFile,
      quantity: primary.quantity,
      uom: primary.uom,
      cost: 0,
      markup: options.markup,
      price: 0,
      tierUnits: {},
      sourceNotes: [
        `From BidWright model editor: ${sourceFile}`,
        `${primary.label}: ${formatModelEditorQuantity(primary.quantity, primary.uom)}`,
        `Surface area: ${formatModelEditorQuantity(finiteModelMetric(node.surfaceArea), "model^2")}`,
        `Volume: ${formatModelEditorQuantity(finiteModelMetric(node.volume), "model^3")}`,
        `Faces: ${Intl.NumberFormat().format(finiteModelMetric(node.faceCount))}`,
        `Solids: ${Intl.NumberFormat().format(finiteModelMetric(node.solidCount))}`,
        node.externalId ? `Model object id: ${node.externalId}` : `Editor object id: ${node.id}`,
        node.path?.length ? `Path: ${node.path.join(" / ")}` : "",
      ].filter(Boolean).join("\n"),
      source: {
        kind: "model-selection",
        projectId: selection.projectId,
        modelId: selection.modelId,
        modelElementId: node.modelElementId,
        modelDocumentId: selection.modelDocumentId,
        fileName: selection.fileName,
        documentId: selection.documentId,
        quantityBasis: basis,
        quantityType: primary.quantityType,
        selectedNodeIds: [node.id],
      },
    };
  });
}

function normalizeModelEditorLineItemDraft(
  draft: BidwrightModelLineItemDraft | undefined,
  fallback: CreateWorksheetItemInput,
): CreateWorksheetItemInput {
  if (!draft) return fallback;
  return {
    category: draft.category || fallback.category,
    categoryId: draft.categoryId === undefined ? fallback.categoryId : draft.categoryId,
    entityType: draft.entityType || fallback.entityType,
    entityName: draft.entityName || fallback.entityName,
    description: draft.description ?? fallback.description,
    quantity: Number.isFinite(Number(draft.quantity)) ? Number(draft.quantity) : fallback.quantity,
    uom: draft.uom || fallback.uom,
    cost: Number.isFinite(Number(draft.cost)) ? Number(draft.cost) : fallback.cost,
    markup: Number.isFinite(Number(draft.markup)) ? Number(draft.markup) : fallback.markup,
    price: Number.isFinite(Number(draft.price)) ? Number(draft.price) : fallback.price,
    tierUnits: draft.tierUnits ?? fallback.tierUnits,
    sourceNotes: draft.sourceNotes || fallback.sourceNotes,
  };
}

function toModelEditorLinkedItem(link: ModelTakeoffLinkRecord): BidwrightModelLinkedLineItem | null {
  const item = link.worksheetItem;
  if (!item) return null;
  return {
    linkId: link.id,
    worksheetItemId: link.worksheetItemId,
    worksheetId: item.worksheet?.id ?? item.worksheetId,
    worksheetName: item.worksheet?.name ?? null,
    entityName: item.entityName,
    description: item.description ?? "",
    quantity: item.quantity,
    uom: item.uom,
    cost: item.cost,
    markup: item.markup,
    price: item.price,
    sourceNotes: item.sourceNotes ?? "",
    derivedQuantity: link.derivedQuantity,
    selection: link.selection,
  };
}

/* ─── Main Component ─── */

export function ProjectWorkspace({ initialData }: { initialData: WorkspaceResponse }) {
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const initialIsSnap =
    initialData.workspaceState?.state.quoteMode === "snap" &&
    initialData.workspaceState?.state.snapUpgraded !== true;
  const [tab, setTab] = useState<WorkspaceTab>(() => {
    const urlTab = searchParams.get("tab");
    return isWorkspaceTab(urlTab) ? urlTab : initialIsSnap ? "estimate" : "setup";
  });
  const [estimateSubTab, setEstimateSubTab] = useState<EstimateSubTab>(() => {
    const urlSubTab = searchParams.get("subtab");
    return isEstimateSubTab(urlSubTab) ? urlSubTab : initialIsSnap ? "worksheets" : "takeoff";
  });
  const [data, setData] = useState(initialData);
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedWsId, setSelectedWsId] = useState(
    typeof initialData.workspaceState?.state.selectedWorksheetId === "string"
      ? initialData.workspaceState.state.selectedWorksheetId
      : initialData.workspace.worksheets[0]?.id ?? "all"
  );
  const [revDraft, setRevDraft] = useState(() => buildRevDraftFromWs(initialData.workspace));
  const [itemDraft, setItemDraft] = useState<ItemDraft | null>(null);
  const [wsNameDraft, setWsNameDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [showActions, setShowActions] = useState(false);
  const [entityCategories, setEntityCategories] = useState<EntityCategory[]>([]);
  useEffect(() => {
    let cancelled = false;
    getEntityCategories()
      .then((cats) => { if (!cancelled) setEntityCategories(cats); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);
  const modelLineCategory = useMemo(() => pickModelLineCategory(entityCategories), [entityCategories]);
  const [modal, setModal] = useState<ModalState>(null);
  const [aiResult, setAiResult] = useState<string | null>(null);
  const [aiPhaseResult, setAiPhaseResult] = useState<AIPhaseResult[] | null>(null);
  const [aiEquipResult, setAiEquipResult] = useState<AIEquipmentResult[] | null>(null);
  const [chatOpen, setChatOpen] = useState(false);
  const [agentPrefill, setAgentPrefill] = useState<string | null>(null);
  const [autoIntake, setAutoIntake] = useState(false);
  const [intakePersonaId, setIntakePersonaId] = useState<string | null>(null);
  const [pluginToolsOpen, setPluginToolsOpen] = useState(false);
  const [pluginToolsTarget, setPluginToolsTarget] = useState<PluginToolsTarget | null>(null);
  const [revisionDiffOpen, setRevisionDiffOpen] = useState(false);
  const intakeInitRef = useRef(false);
  const workspaceSyncOriginRef = useRef(`workspace-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`);
  const [isPending, startTransition] = useTransition();
  const urlTab = searchParams.get("tab");
  const urlSubTab = searchParams.get("subtab");
  const urlIntake = searchParams.get("intake");
  const urlPersona = searchParams.get("persona");

  const [searchHighlight, setSearchHighlight] = useState<SearchNavigationTarget | null>(null);

  const openPluginTools = useCallback((target?: PluginToolsTarget) => {
    setPluginToolsTarget(target ?? null);
    setPluginToolsOpen(true);
  }, []);

  const closePluginTools = useCallback(() => {
    setPluginToolsOpen(false);
    setPluginToolsTarget(null);
  }, []);

  const openAgentChat = useCallback((prefill?: string) => {
    setAgentPrefill(prefill ?? null);
    setChatOpen(true);
  }, []);

  const updateWorkspaceUrl = useCallback((nextTab: WorkspaceTab, nextSubTab?: EstimateSubTab) => {
    const params = new URLSearchParams(searchParams.toString());
    params.set("tab", nextTab);
    if (nextTab === "estimate") {
      params.set("subtab", nextSubTab ?? "takeoff");
    } else {
      params.delete("subtab");
    }
    const nextQuery = params.toString();
    const currentQuery = searchParams.toString();
    if (nextQuery !== currentQuery) {
      router.replace(nextQuery ? `${pathname}?${nextQuery}` : pathname, { scroll: false });
    }
  }, [pathname, router, searchParams]);

  const handleTabChange = useCallback((nextTab: WorkspaceTab) => {
    setTab(nextTab);
    updateWorkspaceUrl(nextTab, nextTab === "estimate" ? estimateSubTab : undefined);
  }, [estimateSubTab, updateWorkspaceUrl]);

  const handleEstimateSubTabChange = useCallback((nextSubTab: EstimateSubTab) => {
    setTab("estimate");
    setEstimateSubTab(nextSubTab);
    updateWorkspaceUrl("estimate", nextSubTab);
  }, [updateWorkspaceUrl]);

  const handleSearchNavigate = useCallback((target: SearchNavigationTarget) => {
    if (target.tab === "estimate" && "subTab" in target) {
      const nextSubTab = target.subTab as EstimateSubTab;
      handleEstimateSubTabChange(nextSubTab);
      if (nextSubTab === "worksheets" && "worksheetId" in target && target.worksheetId) {
        setSelectedWsId(target.worksheetId);
      }
    } else {
      handleTabChange(target.tab);
    }
    setSearchHighlight(target);
    // Clear highlight after 3 seconds
    setTimeout(() => setSearchHighlight(null), 3000);
  }, [handleEstimateSubTabChange, handleTabChange]);

  const workspace = data.workspace;
  const isSnap =
    data.workspaceState?.state.quoteMode === "snap" &&
    data.workspaceState?.state.snapUpgraded !== true;
  const snapLineLimit =
    typeof data.workspaceState?.state.snapLineLimit === "number"
      ? data.workspaceState.state.snapLineLimit
      : 10;
  const snapWorksheetId =
    typeof data.workspaceState?.state.selectedWorksheetId === "string"
      ? data.workspaceState.state.selectedWorksheetId
      : workspace.worksheets[0]?.id;
  const revisions = useMemo(() => {
    const byId = new Map<string, QuoteRevision>();
    for (const revision of workspace.revisions ?? []) {
      byId.set(revision.id, revision);
    }
    byId.set(workspace.currentRevision.id, workspace.currentRevision);
    return Array.from(byId.values()).sort((left, right) => {
      if (left.revisionNumber !== right.revisionNumber) {
        return right.revisionNumber - left.revisionNumber;
      }
      return right.updatedAt.localeCompare(left.updatedAt);
    });
  }, [workspace.currentRevision, workspace.revisions]);
  const selectedWs = selectedWsId === "all" ? null : findWs(workspace, selectedWsId);
  const selectedModelWorksheet = selectedWsId === "all"
    ? (workspace.worksheets ?? [])[0] ?? null
    : findWs(workspace, selectedWsId);
  const modelEditorSyncChannelName = useMemo(
    () => modelEditorChannelName(workspace.project.id),
    [workspace.project.id],
  );
  const workspaceRef = useRef(workspace);
  const selectedModelWorksheetRef = useRef(selectedModelWorksheet);
  const modelEditorChannelRef = useRef<BroadcastChannel | null>(null);

  useEffect(() => {
    workspaceRef.current = workspace;
  }, [workspace]);

  useEffect(() => {
    selectedModelWorksheetRef.current = selectedModelWorksheet;
  }, [selectedModelWorksheet]);

  // Sync revDraft from workspace when server-side text content changes.
  useEffect(() => {
    const next = buildRevDraftFromWs(workspace);
    setRevDraft((prev) => {
      // Debug: warn if server is returning empty values that would clear local state
      if (prev.description && !next.description) {
        console.warn("[bidwright] Server returned empty description — preserving local. Prev length:", prev.description.length);
        next.description = prev.description;
      }
      if (prev.title && !next.title) {
        console.warn("[bidwright] Server returned empty title — preserving local. Prev:", prev.title);
        next.title = prev.title;
      }
      return next;
    });
  }, [workspace.currentRevision.id, workspace.currentRevision.description, workspace.currentRevision.title, workspace.currentRevision.notes]);

  useEffect(() => {
    if (!findWs(workspace, selectedWsId)) setSelectedWsId((workspace.worksheets ?? [])[0]?.id ?? "all");
  }, [workspace, selectedWsId]);

  useEffect(() => { setWsNameDraft(selectedWs?.name ?? ""); }, [selectedWs?.id, selectedWs?.name]);

  // Keep UI state in sync with URL changes/back-forward navigation.
  useEffect(() => {
    const nextTab = isWorkspaceTab(urlTab) ? urlTab : isSnap ? "estimate" : "setup";
    if (nextTab === "estimate" && urlSubTab === "quality") {
      setTab("review");
      updateWorkspaceUrl("review");
      return;
    }
    if (nextTab !== tab) {
      setTab(nextTab);
    }
    if (nextTab === "estimate") {
      const nextSubTab = isEstimateSubTab(urlSubTab) ? urlSubTab : isSnap ? "worksheets" : "takeoff";
      if (nextSubTab !== estimateSubTab) {
        setEstimateSubTab(nextSubTab);
      }
    }
  }, [estimateSubTab, isSnap, tab, updateWorkspaceUrl, urlSubTab, urlTab]);

  // Auto-open agent chat when redirected from intake.
  useEffect(() => {
    if (intakeInitRef.current) return;
    if (urlIntake === "true") {
      setChatOpen(true);
      setAutoIntake(true);
      if (urlPersona) setIntakePersonaId(urlPersona);
      intakeInitRef.current = true;
      // Remove ?intake=true (and ?persona=) from URL so it doesn't re-trigger on reload
      const url = new URL(window.location.href);
      url.searchParams.delete("intake");
      url.searchParams.delete("persona");
      window.history.replaceState({}, "", url.pathname + url.search);
    }
  }, [urlIntake, urlPersona]);

  const visibleRows = useMemo(() => {
    const rows = selectedWs ? selectedWs.items : (workspace.worksheets ?? []).flatMap((w) => w.items);
    const q = searchTerm.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) => [r.entityName, r.description, r.category, r.entityType, r.vendor ?? ""].join(" ").toLowerCase().includes(q));
  }, [searchTerm, selectedWs, workspace.worksheets]);

  const currentItem = itemDraft?.itemId ? (workspace.worksheets ?? []).flatMap((w) => w.items).find((i) => i.id === itemDraft.itemId) ?? null : null;

  const estimateQuality = useMemo(() => {
    const validationWorkspace: EstimateValidationWorkspaceLike = {
      worksheets: (workspace.worksheets ?? []).map((worksheet) => ({
        id: worksheet.id,
        name: worksheet.name,
        items: (worksheet.items ?? []).map((item) => ({
          id: item.id,
          worksheetId: item.worksheetId,
          phaseId: item.phaseId,
          category: item.category,
          entityType: item.entityType,
          entityName: item.entityName,
          vendor: item.vendor,
          description: item.description,
          quantity: item.quantity,
          uom: item.uom,
          cost: item.cost,
          price: item.price,
          rateScheduleItemId: item.rateScheduleItemId,
          itemId: item.itemId,
          costResourceId: item.costResourceId,
          effectiveCostId: item.effectiveCostId,
          laborUnitId: item.laborUnitId,
          tierUnits: item.tierUnits,
          sourceNotes: item.sourceNotes,
          sourceEvidence: item.sourceEvidence,
          resourceComposition: item.resourceComposition,
          sourceAssemblyId: item.sourceAssemblyId,
          assemblyInstanceId: item.assemblyInstanceId,
        })),
      })),
      entityCategories: entityCategories.map((category) => ({
        name: category.name,
        entityType: category.entityType,
        calculationType: category.calculationType,
        itemSource: category.itemSource,
        validUoms: category.validUoms,
        analyticsBucket: category.analyticsBucket,
      })),
      estimateStrategy: workspace.estimateStrategy
        ? {
          id: workspace.estimateStrategy.id,
          packagePlan: workspace.estimateStrategy.packagePlan,
        }
        : null,
      takeoffLinks: (workspace.takeoffLinks ?? []).map((link) => ({
        id: link.id,
        worksheetItemId: link.worksheetItemId,
        itemId: link.worksheetItemId,
      })),
      modelTakeoffLinks: [],
      rateSchedules: workspace.rateSchedules.map((schedule) => ({
        id: schedule.id,
        items: schedule.items.map((item) => ({
          id: item.id,
          name: item.name,
          code: item.code,
        })),
        tiers: schedule.tiers.map((tier) => ({
          id: tier.id,
          name: tier.name,
        })),
      })),
      evidenceLinks: workspace.citations?.map((citation) => ({
        id: citation.id,
        worksheetItemId: citation.resourceType === "worksheet_item" ? citation.resourceKey : undefined,
        sourceType: "citation",
      })) ?? [],
    };
    return validateEstimateWorkspace(validationWorkspace, { scoreFloor: 0, scoreMax: 100 });
  }, [entityCategories, workspace]);

  const qualityFindings = useMemo<QualityFinding[]>(() => (
    estimateQuality.issues.map((issue, index) => ({
      id: `${issue.ruleId}-${index}`,
      ruleId: issue.ruleId,
      title: issue.ruleName,
      message: issue.message,
      severity: qualitySeverity(issue.severity),
      category: issue.category,
      itemId: issue.element?.itemId,
      worksheetId: issue.element?.worksheetId,
      elementRef: elementLabel(issue.element),
      suggestion: issue.suggestions[0],
      actionLabel: issue.element?.itemId ? "Open row" : undefined,
    }))
  ), [estimateQuality]);

  const qualitySummary = useMemo(() => ({
    score: estimateQuality.score.value,
    status: estimateQuality.summary.bySeverity.critical + estimateQuality.summary.bySeverity.error > 0
      ? "errors" as const
      : estimateQuality.summary.bySeverity.warning > 0
        ? "warnings" as const
        : "passed" as const,
    totalRules: estimateQuality.summary.failedRuleIds.length + estimateQuality.summary.passedRuleIds.length,
    passedRules: estimateQuality.summary.passedRuleIds.length,
    errorCount: estimateQuality.summary.bySeverity.critical + estimateQuality.summary.bySeverity.error,
    warningCount: estimateQuality.summary.bySeverity.warning,
    infoCount: estimateQuality.summary.bySeverity.info,
  }), [estimateQuality]);

  const resourceSummaryRows = useMemo(() => buildResourceSummaryRows(workspace), [workspace]);

  const apply = useCallback((next: SetStateAction<WorkspaceResponse>) => {
    setData((prev) =>
      typeof next === "function"
        ? (next as (value: WorkspaceResponse) => WorkspaceResponse)(prev)
        : next,
    );
    setError(null);
  }, []);

  const refreshWorkspace = useCallback(async () => {
    try {
      const fresh = await getProjectWorkspace(workspace.project.id);
      startTransition(() => {
        apply(fresh);
      });
      return fresh;
    } catch {
      return null;
    }
  }, [apply, startTransition, workspace.project.id]);

  const handleUpgradeSnap = useCallback(() => {
    startTransition(async () => {
      try {
        const workspaceState = await updateWorkspaceState(workspace.project.id, {
          quoteMode: "quote",
          snapUpgraded: true,
          snapUpgradedAt: new Date().toISOString(),
        });
        apply((current) => ({ ...current, workspaceState }));
        setTab("estimate");
        setEstimateSubTab("worksheets");
        updateWorkspaceUrl("estimate", "worksheets");
      } catch (error) {
        setError(error instanceof Error ? error.message : "Could not upgrade Snap.");
      }
    });
  }, [apply, startTransition, updateWorkspaceUrl, workspace.project.id]);

  const handleAgentNavigate = useCallback(async (intent: AgentNavigationIntent) => {
    const fresh = await refreshWorkspace();
    const currentWorkspace = fresh?.workspace ?? workspace;

    if (intent.type === "setup") {
      handleSearchNavigate({ tab: "setup", field: intent.field });
      return;
    }

    if (intent.type === "worksheet") {
      let worksheetId = intent.worksheetId;
      if (!worksheetId && intent.itemId) {
        worksheetId = (currentWorkspace.worksheets ?? []).find((ws) =>
          ws.items.some((item) => item.id === intent.itemId),
        )?.id;
      }

      handleEstimateSubTabChange("worksheets");
      if (worksheetId) setSelectedWsId(worksheetId);
      if (intent.itemId) {
        setSearchHighlight({
          tab: "estimate",
          subTab: "worksheets",
          worksheetId: worksheetId ?? "all",
          itemId: intent.itemId,
        });
        setTimeout(() => setSearchHighlight(null), 3000);
      }
      return;
    }

    if (intent.type === "document") {
      handleSearchNavigate({ tab: "documents", documentId: intent.documentId });
      return;
    }

    if (intent.type === "summarize") {
      handleTabChange("summarize");
    }
  }, [handleEstimateSubTabChange, handleSearchNavigate, handleTabChange, refreshWorkspace, workspace]);

  useEffect(() => {
    if (typeof window === "undefined" || !("BroadcastChannel" in window)) return;

    const channel = new BroadcastChannel(workspaceChannelName(workspace.project.id));
    channel.onmessage = (event: MessageEvent<WorkspaceSyncMessage>) => {
      const msg = event.data;
      if (!msg || msg.type !== "workspace-mutated") return;
      if (msg.projectId !== workspace.project.id) return;
      if (msg.originId && msg.originId === workspaceSyncOriginRef.current) return;
      refreshWorkspace();
    };

    return () => channel.close();
  }, [refreshWorkspace, workspace.project.id]);

  const postModelEditorEstimateContext = useCallback((channel = modelEditorChannelRef.current) => {
    if (!channel) return;
    const currentWorkspace = workspaceRef.current;
    const worksheet = selectedModelWorksheetRef.current;
    channel.postMessage({
      type: "model-estimate-context",
      source: "bidwright-host",
      version: 1,
      projectId: currentWorkspace.project.id,
      estimateEnabled: Boolean(worksheet),
      estimateTargetWorksheetId: worksheet?.id,
      estimateTargetWorksheetName: worksheet?.name,
      estimateDefaultMarkup: currentWorkspace.currentRevision.defaultMarkup ?? 0.2,
      estimateQuoteLabel: currentWorkspace.quote?.quoteNumber ?? currentWorkspace.project.name,
    });
  }, []);

  const postModelEditorLineItemsState = useCallback(async (message: Pick<ModelEditorChannelMessage, "modelId" | "modelDocumentId">) => {
    const channel = modelEditorChannelRef.current;
    if (!channel) return;
    const currentWorkspace = workspaceRef.current;
    let items: BidwrightModelLinkedLineItem[] = [];

    if (message.modelId) {
      try {
        const result = await listModelTakeoffLinks(currentWorkspace.project.id, message.modelId);
        items = (result.links ?? [])
          .map(toModelEditorLinkedItem)
          .filter((item): item is BidwrightModelLinkedLineItem => Boolean(item));
      } catch {
        items = [];
      }
    }

    channel.postMessage({
      type: "model-line-items-state",
      source: "bidwright-host",
      version: 1,
      projectId: currentWorkspace.project.id,
      modelId: message.modelId,
      modelDocumentId: message.modelDocumentId,
      items,
    });
  }, []);

  const handleModelEditorCreateLineItem = useCallback(async (message: ModelEditorChannelMessage) => {
    if (!message.selection) return;
    const currentWorkspace = workspaceRef.current;
    const fallbackDrafts = buildModelEditorObjectDrafts(message.selection, {
      fileName: message.selection.fileName,
      markup: currentWorkspace.currentRevision.defaultMarkup ?? 0.2,
      category: modelLineCategory,
    });
    const drafts = (message.lineItemDrafts?.length
      ? message.lineItemDrafts
      : message.lineItemDraft
        ? [message.lineItemDraft]
        : fallbackDrafts
    ).slice(0, MAX_MODEL_OBJECT_LINE_ITEMS);

    try {
      let previousItemIds = new Set(currentWorkspace.worksheets.flatMap((worksheet) => worksheet.items).map((item) => item.id));
      let latestResult: WorkspaceResponse | null = null;

      for (const draft of drafts) {
        const targetWs =
          (draft?.worksheetId
            ? currentWorkspace.worksheets.find((worksheet) => worksheet.id === draft.worksheetId)
            : null) ??
          selectedModelWorksheetRef.current ??
          currentWorkspace.worksheets[0];

        if (!targetWs) {
          setError("Create a worksheet before sending model quantities.");
          return;
        }

        const draftSelection = selectionForModelEditorNode(message.selection, draft.source?.selectedNodeIds);
        const fallbackPayload = buildModelEditorLineItemFallback(draftSelection, {
          fileName: message.selection.fileName,
          markup: currentWorkspace.currentRevision.defaultMarkup ?? 0.2,
          category: modelLineCategory,
        });
        const payload = normalizeModelEditorLineItemDraft(draft, fallbackPayload);
        const result = await createWorksheetItem(currentWorkspace.project.id, targetWs.id, payload);
        latestResult = result;

        const createdItem = result.workspace.worksheets
          .flatMap((worksheet) => worksheet.items)
          .find((item) => !previousItemIds.has(item.id));

        if (message.modelId && createdItem) {
          await createModelTakeoffLink(currentWorkspace.project.id, message.modelId, {
            worksheetItemId: createdItem.id,
            modelElementId: draft.source?.modelElementId ?? null,
            modelQuantityId: draft.source?.modelQuantityId ?? null,
            quantityField: "quantity",
            multiplier: 1,
            derivedQuantity: payload.quantity,
            selection: {
              fileName: message.selection.fileName ?? null,
              documentId: draftSelection.documentId ?? null,
              documentName: draftSelection.documentName ?? null,
              selectedCount: draftSelection.selectedCount,
              nodes: draftSelection.nodes,
              totals: draftSelection.totals,
              quantityBasis: draft.source?.quantityBasis ?? message.selection.quantityBasis ?? "count",
              quantityType: draft.source?.quantityType ?? null,
              source: draft.source ?? null,
              lineItemDraft: payload,
            },
          });
        }

        previousItemIds = new Set(result.workspace.worksheets.flatMap((worksheet) => worksheet.items).map((item) => item.id));
      }

      if (latestResult) apply(latestResult);
      postWorkspaceMutation(currentWorkspace.project.id, {
        originId: workspaceSyncOriginRef.current,
        reason: "model-editor",
      });
      postModelEditorEstimateContext();
      await postModelEditorLineItemsState(message);
    } catch (error) {
      console.error("[model-editor] Failed to create worksheet line item:", error);
      setError("Could not create a worksheet line item from the model selection.");
    }
  }, [apply, modelLineCategory, postModelEditorEstimateContext, postModelEditorLineItemsState]);

  const handleModelEditorUpdateLineItem = useCallback(async (message: ModelEditorChannelMessage) => {
    if (!message.worksheetItemId || !message.patch) return;
    const currentWorkspace = workspaceRef.current;
    const patch = {
      ...(typeof message.patch.entityName === "string" ? { entityName: message.patch.entityName } : {}),
      ...(typeof message.patch.description === "string" ? { description: message.patch.description } : {}),
      ...(typeof message.patch.quantity === "number" && Number.isFinite(message.patch.quantity)
        ? { quantity: message.patch.quantity }
        : {}),
      ...(typeof message.patch.uom === "string" ? { uom: message.patch.uom } : {}),
    };

    try {
      const result = await updateWorksheetItem(currentWorkspace.project.id, message.worksheetItemId, patch);
      apply(result);
      postWorkspaceMutation(currentWorkspace.project.id, {
        originId: workspaceSyncOriginRef.current,
        reason: "model-editor",
      });
      await postModelEditorLineItemsState(message);
    } catch (error) {
      console.error("[model-editor] Failed to update linked line item:", error);
      setError("Could not update the linked worksheet line item.");
    }
  }, [apply, postModelEditorLineItemsState]);

  const handleModelEditorDeleteLineItem = useCallback(async (message: ModelEditorChannelMessage) => {
    if (!message.worksheetItemId) return;
    const currentWorkspace = workspaceRef.current;
    try {
      if (message.modelId && message.linkId) {
        await deleteModelTakeoffLink(currentWorkspace.project.id, message.modelId, message.linkId).catch(() => null);
      }
      const result = await deleteWorksheetItem(currentWorkspace.project.id, message.worksheetItemId);
      apply(result);
      postWorkspaceMutation(currentWorkspace.project.id, {
        originId: workspaceSyncOriginRef.current,
        reason: "model-editor",
      });
      await postModelEditorLineItemsState(message);
    } catch (error) {
      console.error("[model-editor] Failed to delete linked line item:", error);
      setError("Could not delete the linked worksheet line item.");
    }
  }, [apply, postModelEditorLineItemsState]);

  useEffect(() => {
    if (typeof window === "undefined" || !("BroadcastChannel" in window)) return;

    const channel = new BroadcastChannel(modelEditorSyncChannelName);
    modelEditorChannelRef.current = channel;
    channel.onmessage = (event: MessageEvent<ModelEditorChannelMessage>) => {
      const msg = event.data;
      if (!msg || msg.source !== "bidwright-model-editor") return;
      if (msg.projectId && msg.projectId !== workspaceRef.current.project.id) return;

      if (msg.type === "model-estimate-context-request") {
        postModelEditorEstimateContext(channel);
      } else if (msg.type === "model-line-items-request") {
        void postModelEditorLineItemsState(msg);
      } else if (msg.type === "model-send-to-estimate") {
        void handleModelEditorCreateLineItem(msg);
      } else if (msg.type === "model-line-item-update") {
        void handleModelEditorUpdateLineItem(msg);
      } else if (msg.type === "model-line-item-delete") {
        void handleModelEditorDeleteLineItem(msg);
      }
    };

    postModelEditorEstimateContext(channel);

    return () => {
      if (modelEditorChannelRef.current === channel) modelEditorChannelRef.current = null;
      channel.close();
    };
  }, [
    handleModelEditorCreateLineItem,
    handleModelEditorDeleteLineItem,
    handleModelEditorUpdateLineItem,
    modelEditorSyncChannelName,
    postModelEditorEstimateContext,
    postModelEditorLineItemsState,
  ]);

  useEffect(() => {
    postModelEditorEstimateContext();
  }, [
    postModelEditorEstimateContext,
    selectedModelWorksheet?.id,
    selectedModelWorksheet?.name,
    workspace.currentRevision.defaultMarkup,
    workspace.project.name,
    workspace.quote?.quoteNumber,
  ]);

  function closeModal() { setModal(null); setAiResult(null); setAiPhaseResult(null); setAiEquipResult(null); }

  // ─── Action handlers ───

  function handleAction(action: string) {
    setShowActions(false);
    switch (action) {
      case "createRevision": setModal("createRevision"); break;
      case "deleteRevision": setModal("deleteRevision"); break;
      case "makeRevZero": setModal("makeRevZero"); break;
      case "copyQuote": setModal("copyQuote"); break;
      case "deleteQuote": setModal("deleteQuote"); break;
      case "sendQuote": setModal("sendQuote"); break;
      case "importBOM": setModal("importBOM"); break;
      case "aiDescription": setModal("aiDescription"); setAiResult(null); break;
      case "aiNotes": setModal("aiNotes"); setAiResult(null); break;
      case "aiPhases": setModal("aiPhases"); setAiPhaseResult(null); break;
      case "aiEquipment": setModal("aiEquipment"); setAiEquipResult(null); break;
      case "pdf": setModal("pdf"); break;
      case "compare": setModal("compare"); break;
    }
  }


  function exec(fn: () => Promise<WorkspaceResponse>) {
    startTransition(async () => {
      try { apply(await fn()); closeModal(); }
      catch (e) { setError(e instanceof Error ? e.message : "Failed"); }
    });
  }

  function handleStatusChange(status: string) {
    startTransition(async () => {
      try {
        const patch: RevisionPatchInput = { status: status as any };
        apply(await updateRevision(workspace.project.id, workspace.currentRevision.id, patch));
      } catch (e) { setError(e instanceof Error ? e.message : "Failed"); }
    });
  }

  function handleRevisionActivate(revisionId: string) {
    if (revisionId === workspace.currentRevision.id) return;
    startTransition(async () => {
      try {
        const next = await activateRevision(workspace.project.id, revisionId);
        apply(next);
        setSelectedWsId((current) => {
          if (current === "all") return "all";
          return findWs(next.workspace, current)?.id ?? next.workspace.worksheets[0]?.id ?? "all";
        });
        postWorkspaceMutation(workspace.project.id, {
          originId: workspaceSyncOriginRef.current,
          reason: "revision-switch",
        });
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to switch revisions.");
      }
    });
  }

  // ─── Worksheet/Item operations (same as before) ───

  function openItemEditor(ws: WorkspaceWorksheet, item: WorkspaceWorksheetItem) { setItemDraft(buildItemDraft(ws, item, entityCategories)); setError(null); }
  function openCreateItem(ws: WorkspaceWorksheet) { setSelectedWsId(ws.id); setItemDraft(buildItemDraft(ws, undefined, entityCategories)); setError(null); }

  function saveItem() {
    if (!itemDraft) return;
    const payload: CreateWorksheetItemInput = {
      phaseId: itemDraft.phaseId || null, categoryId: itemDraft.categoryId, category: itemDraft.category, entityType: itemDraft.entityType,
      entityName: itemDraft.entityName, vendor: itemDraft.vendor || null, description: itemDraft.description,
      quantity: itemDraft.quantity, uom: itemDraft.uom, cost: itemDraft.cost, markup: itemDraft.markup,
      price: itemDraft.price, tierUnits: itemDraft.tierUnits, lineOrder: itemDraft.lineOrder,
    };
    startTransition(async () => {
      try {
        const next = itemDraft.mode === "create"
          ? await createWorksheetItem(workspace.project.id, itemDraft.worksheetId, payload)
          : await updateWorksheetItem(workspace.project.id, itemDraft.itemId!, payload);
        apply(next);
        const nws = findWs(next.workspace, itemDraft.worksheetId);
        if (nws) {
          const ni = nws.items.find((i) => i.id === itemDraft.itemId) ?? nws.items.filter((i) => i.entityName === itemDraft.entityName).sort((a, b) => b.lineOrder - a.lineOrder)[0];
          setItemDraft(ni ? buildItemDraft(nws, ni, entityCategories) : null);
        } else setItemDraft(null);
      } catch (e) { setError(e instanceof Error ? e.message : "Save failed."); }
    });
  }

  function deleteItem() {
    if (!currentItem) return;
    startTransition(async () => {
      try { apply(await deleteWorksheetItem(workspace.project.id, currentItem.id)); setItemDraft(null); }
      catch (e) { setError(e instanceof Error ? e.message : "Delete failed."); }
    });
  }

  function duplicateItem() {
    if (!currentItem || !itemDraft) return;
    const payload: CreateWorksheetItemInput = {
      phaseId: itemDraft.phaseId || null, categoryId: itemDraft.categoryId, category: itemDraft.category, entityType: itemDraft.entityType,
      entityName: itemDraft.entityName, vendor: itemDraft.vendor || null, description: itemDraft.description,
      quantity: itemDraft.quantity, uom: itemDraft.uom, cost: itemDraft.cost, markup: itemDraft.markup,
      price: itemDraft.price, tierUnits: itemDraft.tierUnits, lineOrder: itemDraft.lineOrder + 1,
    };
    startTransition(async () => {
      try { apply(await createWorksheetItem(workspace.project.id, itemDraft.worksheetId, payload)); }
      catch (e) { setError(e instanceof Error ? e.message : "Duplicate failed."); }
    });
  }

  function handleCreateWorksheet(name: string) {
    startTransition(async () => {
      try {
        const next = await createWorksheet(workspace.project.id, { name });
        apply(next);
        const ws = next.workspace.worksheets.at(-1);
        if (ws) setSelectedWsId(ws.id);
        closeModal();
      } catch (e) { setError(e instanceof Error ? e.message : "Create failed."); }
    });
  }

  function handleRenameWorksheet(name: string) {
    if (!selectedWs) return;
    startTransition(async () => {
      try { apply(await updateWorksheet(workspace.project.id, selectedWs.id, { name })); closeModal(); }
      catch (e) { setError(e instanceof Error ? e.message : "Rename failed."); }
    });
  }

  function handleDeleteWorksheet() {
    if (!selectedWs) return;
    startTransition(async () => {
      try {
        const next = await deleteWorksheet(workspace.project.id, selectedWs.id);
        apply(next);
        setSelectedWsId(next.workspace.worksheets[0]?.id ?? "all");
        setItemDraft(null);
        closeModal();
      } catch (e) { setError(e instanceof Error ? e.message : "Delete failed."); }
    });
  }

  const displayTotalHours =
    Number(workspace.currentRevision.totalHours ?? 0) > 0
      ? Number(workspace.currentRevision.totalHours ?? 0)
      : Number(workspace.estimate.totals.totalHours ?? 0);

  return (
    <WorkspaceI18nSurface>
    <div className="flex h-full min-h-0 flex-1 flex-col gap-4">
      {/* ─── Header ─── */}
      <div className="flex items-center gap-4 shrink-0">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h1 className="text-sm font-semibold truncate">{workspace.project.name}</h1>
            <StatusDropdown
              value={workspace.currentRevision.status ?? "Open"}
              onChange={handleStatusChange}
              options={QUOTE_STATUSES}
            />
            {isSnap && <Badge tone="info">Snap</Badge>}
            <Badge tone={statusTone(workspace.currentRevision.status)}>{workspace.currentRevision.type ?? "Firm"}</Badge>
          </div>
          <div className="mt-0.5 flex min-w-0 items-center gap-1.5 text-[11px] text-fg/40">
            <span>{getClientDisplayName(workspace.project, workspace.quote)}</span>
            <span>·</span>
            <span>{workspace.quote.quoteNumber}</span>
            <span>·</span>
            <RevisionSwitcher
              revisions={revisions}
              currentRevision={workspace.currentRevision}
              isPending={isPending}
              onActivate={handleRevisionActivate}
              onCreate={() => handleAction("createRevision")}
              onCompare={() => handleAction("compare")}
              onMakeRevisionZero={() => handleAction("makeRevZero")}
              onDeleteCurrent={() => handleAction("deleteRevision")}
            />
            <span>·</span>
            <span className="min-w-0 truncate">{workspace.project.location}</span>
            {workspace.currentRevision.dateDue && (
              <><span>·</span><span className="whitespace-nowrap">Due {workspace.currentRevision.dateDue}</span></>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <div className="hidden lg:flex items-stretch gap-3 text-right">
            <div className="flex h-10 flex-col items-end justify-between py-0.5 text-[10px] leading-none text-fg/50">
              <div className="whitespace-nowrap"><span className="text-fg/35">Cost</span> <span className="font-mono tabular-nums">{formatMoney(workspace.currentRevision.cost)}</span></div>
              <div className="whitespace-nowrap"><span className="text-fg/35">Profit</span> <span className={cn("font-mono tabular-nums", (workspace.currentRevision.estimatedProfit ?? 0) >= 0 ? "text-success" : "text-danger")}>{formatMoney(workspace.currentRevision.estimatedProfit)}</span></div>
              <div className="whitespace-nowrap"><span className="text-fg/35">Hrs</span> <span className="font-mono tabular-nums">{displayTotalHours.toLocaleString()}</span></div>
            </div>
            <div className="flex h-10 flex-col justify-center border-l border-line pl-3">
              <div className="text-base font-semibold tabular-nums whitespace-nowrap">{formatMoney(workspace.currentRevision.subtotal)}</div>
              <div className="text-[10px] text-fg/35">{formatPercent(workspace.currentRevision.estimatedMargin, 1)} margin</div>
            </div>
          </div>

          <ToolbarTooltip label="Open plugin tools">
            <Button
              size="sm"
              variant="secondary"
              onClick={() => openPluginTools()}
              aria-label="Open plugin tools"
            >
              <Puzzle className="h-3 w-3" />
            </Button>
          </ToolbarTooltip>

          <Button size="sm" variant="accent" onClick={() => openAgentChat()}>
            <Sparkles className="h-3 w-3" /> AI
          </Button>

          {/* Actions dropdown */}
          <div className="relative">
            <Button size="sm" variant="secondary" onClick={() => setShowActions(!showActions)}>
              Actions <ChevronDown className="h-3 w-3" />
            </Button>
            {showActions && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setShowActions(false)} />
                <div className="absolute right-0 top-full z-50 mt-1 w-52 rounded-lg border border-line bg-panel shadow-lg py-1 text-xs">
                  <MenuSection label="PDF">
                    <MenuItem onClick={() => handleAction("pdf")}>
                      Generate PDF
                    </MenuItem>
                  </MenuSection>
                  <MenuSection label="Actions">
                    <MenuItem onClick={() => handleAction("sendQuote")}>Send Quote</MenuItem>
                    <MenuItem onClick={() => handleAction("copyQuote")}>Copy Quote</MenuItem>
                  </MenuSection>
                  <MenuSection label="Revisions">
                    <MenuItem onClick={() => handleAction("createRevision")}>New Revision</MenuItem>
                    <MenuItem onClick={() => handleAction("compare")} title="Compare revisions">Compare Revisions</MenuItem>
                    <MenuItem onClick={() => handleAction("makeRevZero")}>Make Current Rev. 0</MenuItem>
                    <MenuItem onClick={() => handleAction("deleteRevision")} className="text-danger">Delete Revision</MenuItem>
                  </MenuSection>
                  <MenuSection label="Danger">
                    <MenuItem onClick={() => handleAction("deleteQuote")} className="text-danger">Delete Quote</MenuItem>
                  </MenuSection>
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      {/* ─── Tab bar ─── */}
      {!isSnap && (
      <div className="flex items-center gap-1 border-b border-line pb-px overflow-x-auto">
        {tabs.map((t) => {
          const Icon = t.icon;
          return (
            <button
              key={t.id}
              onClick={() => handleTabChange(t.id)}
              className={cn(
                "flex items-center gap-1.5 border-b-2 px-3 py-2 text-xs font-medium transition-colors whitespace-nowrap",
                tab === t.id ? "border-accent text-accent" : "border-transparent text-fg/45 hover:text-fg/70"
              )}
            >
              <Icon className="h-3.5 w-3.5" />
              {t.label}
            </button>
          );
        })}
        <div className="ml-auto shrink-0">
          <WorkspaceSearch workspace={workspace} onNavigate={handleSearchNavigate} />
        </div>
      </div>
      )}

      {error && <div className="rounded-lg border border-danger/20 bg-danger/5 px-3 py-2 text-xs text-danger">{error}</div>}

      {/* ─── Tab Content ─── */}
      <div className="flex h-full min-h-0 flex-1 flex-col">
        {isSnap ? (
          <SnapQuoteSheet
            workspace={workspace}
            snapLineLimit={snapLineLimit}
            snapWorksheetId={snapWorksheetId}
            onApply={apply}
            onError={setError}
            onRefresh={refreshWorkspace}
            onUpgrade={handleUpgradeSnap}
            onOpenPluginTools={openPluginTools}
            isPending={isPending}
          />
        ) : (
        <AnimatePresence mode="wait">
          {tab === "setup" && (
            <motion.div key="setup" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.15 }} className="flex-1 min-h-0 flex flex-col">
              <SetupTab workspace={workspace} revDraft={revDraft} setRevDraft={setRevDraft} isPending={isPending} onApply={apply} onError={setError} highlightField={searchHighlight && "field" in searchHighlight ? searchHighlight.field : undefined} />
            </motion.div>
          )}

          {tab === "estimate" && (
            <motion.div key="estimate" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.15 }} className="flex-1 min-h-0 flex flex-col gap-3">
              {/* Estimate sub-tabs */}
              <div className="flex items-center gap-1 shrink-0">
                {estimateSubTabs.map((st) => {
                  const isActive = estimateSubTab === st;
                  return (
                    <button
                      key={st}
                      onClick={() => handleEstimateSubTabChange(st)}
                      className={cn(
                        "relative px-2.5 py-1 text-[11px] font-medium rounded-md transition-colors whitespace-nowrap",
                        isActive ? "text-fg" : "text-fg/40 hover:text-fg/60",
                      )}
                    >
                      {isActive && (
                        <motion.span
                          layoutId="estimate-subtab-bg"
                          className="absolute inset-0 rounded-md bg-panel2"
                          transition={{ type: "spring", stiffness: 500, damping: 35 }}
                        />
                      )}
                      <span className="relative z-10">
                        {estimateSubTabLabel(st)}
                      </span>
                    </button>
                  );
                })}
              </div>


              <AnimatePresence mode="wait">
                {estimateSubTab === "worksheets" && (
                  <motion.div key="worksheets" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.12 }} className="flex-1 min-h-0 flex flex-col">
                    <EstimateGrid
                      workspace={workspace}
                      onApply={apply}
                      onError={setError}
                      onRefresh={refreshWorkspace}
	                      highlightItemId={searchHighlight && "itemId" in searchHighlight ? searchHighlight.itemId : undefined}
	                      activeWorksheetId={selectedWsId}
	                      onActiveWorksheetChange={setSelectedWsId}
	                      onOpenPluginTools={openPluginTools}
	                    />
                  </motion.div>
                )}

                {estimateSubTab === "phases" && (
                  <motion.div key="phases" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.12 }} className="flex-1 min-h-0 flex flex-col">
                    <PhasesTab workspace={workspace} onApply={apply} onError={setError} />
                  </motion.div>
                )}

                {estimateSubTab === "factors" && (
                  <motion.div key="factors" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.12 }} className="flex-1 min-h-0 flex flex-col">
                    <FactorsTab workspace={workspace} onApply={apply} onError={setError} />
                  </motion.div>
                )}

                {estimateSubTab === "takeoff" && (
                  <motion.div key="takeoff" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.12 }} className="flex-1 min-h-0 flex flex-col">
                    <TakeoffTab
                      workspace={workspace}
                      onOpenAgentChat={openAgentChat}
                      onOpenImportLineItems={() => setModal("importBOM")}
                      onOpenDocuments={() => handleTabChange("documents")}
                      onOpenPluginTools={() => openPluginTools()}
                      onOpenRevisionDiff={() => setRevisionDiffOpen(true)}
                      onWorkspaceMutated={refreshWorkspace}
                      workspaceSyncOriginId={workspaceSyncOriginRef.current}
                      selectedWorksheetId={selectedModelWorksheet?.id}
                    />
                  </motion.div>
                )}

              </AnimatePresence>
            </motion.div>
          )}

          {tab === "summarize" && (
            <motion.div key="summarize" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.15 }} className="flex-1 min-h-0 flex flex-col">
              <SummarizeTab
                workspace={workspace}
                resourceSummaryRows={resourceSummaryRows}
                onApply={apply}
              />
            </motion.div>
          )}
          {tab === "documents" && (
            <motion.div key="documents" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.15 }} className="flex-1 min-h-0 flex flex-col">
              <DocumentationTab
                workspace={workspace}
                apply={apply}
                packages={data.packages}
                highlightDocumentId={searchHighlight && "documentId" in searchHighlight ? searchHighlight.documentId : undefined}
                selectedWorksheet={selectedModelWorksheet}
                modelEditorChannelName={modelEditorSyncChannelName}
              />
            </motion.div>
          )}
          {tab === "review" && (
            <motion.div key="review" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.15 }} className="flex-1 min-h-0 flex flex-col">
              <ReviewTab
                workspace={workspace}
                onApply={apply}
                onError={setError}
                qualitySummary={qualitySummary}
                qualityFindings={qualityFindings}
                resourceSummaryRows={resourceSummaryRows}
                onQualityFindingAction={(finding) => {
                  if (finding.itemId && finding.worksheetId) {
                    const target: SearchNavigationTarget = {
                      tab: "estimate",
                      subTab: "worksheets",
                      worksheetId: finding.worksheetId,
                      itemId: finding.itemId,
                    };
                    handleSearchNavigate(target);
                  } else {
                    handleEstimateSubTabChange("worksheets");
                  }
                }}
              />
            </motion.div>
          )}
          {tab === "activity" && (
            <motion.div key="activity" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.15 }} className="flex-1 min-h-0 flex flex-col">
              <AuditTrailTab workspace={workspace} onApply={apply} />
            </motion.div>
          )}
        </AnimatePresence>
        )}
      </div>

      {/* ─── ALL MODALS ─── */}
      <ConfirmModal open={modal === "createRevision"} onClose={closeModal} title="New Revision"
        message="Create a new revision from the current one? All worksheets, phases, and modifiers will be copied."
        confirmLabel="Create" onConfirm={() => exec(() => createRevision(workspace.project.id))} isPending={isPending} />

      <ConfirmModal open={modal === "deleteRevision"} onClose={closeModal} title="Delete Revision"
        message="Delete the current revision? This cannot be undone." confirmLabel="Delete" confirmVariant="danger"
        onConfirm={() => exec(() => deleteRevisionById(workspace.project.id, workspace.currentRevision.id))} isPending={isPending} />

      <ConfirmModal open={modal === "makeRevZero"} onClose={closeModal} title="Make Current Revision Zero"
        message="This will set the current revision to zero and delete all other revisions. This action cannot be undone."
        confirmLabel="Confirm" confirmVariant="danger"
        onConfirm={() => exec(() => makeRevisionZero(workspace.project.id))} isPending={isPending} />

      <ConfirmModal open={modal === "copyQuote"} onClose={closeModal} title="Copy Quote"
        message="Create a complete copy of this quote with all revisions, worksheets, and line items?"
        confirmLabel="Copy" onConfirm={() => exec(() => copyQuote(workspace.project.id))} isPending={isPending} />

      <ConfirmModal open={modal === "deleteQuote"} onClose={closeModal} title="Delete Quote"
        message="Permanently delete this quote and all its data? This cannot be undone."
        confirmLabel="Delete" confirmVariant="danger"
        onConfirm={() => {
          startTransition(async () => {
            try {
              await deleteProject(workspace.project.id);
              window.location.href = "/";
            } catch (e) { setError(e instanceof Error ? e.message : "Delete failed"); }
          });
        }} isPending={isPending} />

      <ConfirmModal open={modal === "deleteWorksheet"} onClose={closeModal} title="Delete Worksheet"
        message={`Delete "${selectedWs?.name ?? "this worksheet"}" and all its line items?`} confirmLabel="Delete" confirmVariant="danger"
        onConfirm={handleDeleteWorksheet} isPending={isPending} />

      <CreateWorksheetModal open={modal === "createWorksheet"} onClose={closeModal} onConfirm={handleCreateWorksheet} isPending={isPending} />
      <RenameWorksheetModal open={modal === "renameWorksheet"} onClose={closeModal} currentName={selectedWs?.name ?? ""} onConfirm={handleRenameWorksheet} isPending={isPending} />

      <SendQuoteModal open={modal === "sendQuote"} onClose={closeModal} isPending={isPending}
        onConfirm={(contacts, message) => {
          startTransition(async () => {
            try {
              await sendQuote(workspace.project.id, { contacts, message });
              closeModal();
            } catch (e) { setError(e instanceof Error ? e.message : "Send failed"); }
          });
        }} />


      <ImportBOMModal open={modal === "importBOM"} onClose={closeModal} isPending={isPending}
        onPreview={(file) => importPreview(workspace.project.id, file)}
        onImport={(fileId, mapping) => {
          startTransition(async () => {
            try {
              const fieldMapping = Object.fromEntries(
                Object.entries(mapping)
                  .filter(([, target]) => target && target !== "skip")
                  .map(([header, target]) => [target, header])
              );
              const result = await importProcess(workspace.project.id, {
                fileId,
                worksheetId: (workspace.worksheets ?? [])[0]?.id ?? "",
                mapping: fieldMapping,
              });
              if (result) apply(result);
              closeModal();
            } catch (e) { setError(e instanceof Error ? e.message : "Import failed"); }
          });
        }} />

      <AIModal open={modal === "aiDescription"} onClose={closeModal} title="AI - Rewrite Description"
        message="Rewrite the scope of work description using AI? This will replace the current description."
        result={aiResult} isPending={isPending}
        onConfirm={() => {
          startTransition(async () => {
            try {
              const res = await aiRewriteDescription(workspace.project.id);
              setAiResult(res.description);
            } catch (e) { setError(e instanceof Error ? e.message : "AI description failed"); }
          });
        }} />

      <AIModal open={modal === "aiNotes"} onClose={closeModal} title="AI - Rewrite Notes"
        message="Rewrite the customer-facing estimate notes using AI? This will replace the current notes."
        result={aiResult} isPending={isPending}
        onConfirm={() => {
          startTransition(async () => {
            try {
              const res = await aiRewriteNotes(workspace.project.id);
              setAiResult(res.notes);
            } catch (e) { setError(e instanceof Error ? e.message : "AI notes failed"); }
          });
        }} />

      <AIPhasesModal open={modal === "aiPhases"} onClose={closeModal} isPending={isPending}
        documents={data.documents.map((d) => ({ id: d.id, fileName: d.fileName }))}
        result={aiPhaseResult}
        onGenerate={() => {
          startTransition(async () => {
            try {
              const res = await aiSuggestPhases(workspace.project.id);
              setAiPhaseResult(res.phases);
            } catch (e) { setError(e instanceof Error ? e.message : "AI phases failed"); }
          });
        }}
        onAccept={() => {
          if (!aiPhaseResult) return;
          startTransition(async () => {
            try {
              const res = await aiAcceptPhases(workspace.project.id, aiPhaseResult);
              apply(res);
              closeModal();
            } catch (e) { setError(e instanceof Error ? e.message : "Accept phases failed"); }
          });
        }} />

      <AIEquipmentModal open={modal === "aiEquipment"} onClose={closeModal} isPending={isPending}
        result={aiEquipResult}
        onGenerate={() => {
          startTransition(async () => {
            try {
              const res = await aiSuggestEquipment(workspace.project.id);
              setAiEquipResult(res.equipment.map((e) => ({ name: e.name, description: e.description, quantity: e.quantity, cost: e.estimatedCost })));
            } catch (e) { setError(e instanceof Error ? e.message : "AI equipment failed"); }
          });
        }}
        onAccept={() => {
          if (!aiEquipResult) return;
          startTransition(async () => {
            try {
              const res = await aiAcceptEquipment(workspace.project.id, aiEquipResult);
              apply(res);
              closeModal();
            } catch (e) { setError(e instanceof Error ? e.message : "Accept equipment failed"); }
          });
        }} />


      {isSnap ? (
        <SnapPdfPreviewModal
          projectId={workspace.project.id}
          quoteNumber={workspace.quote.quoteNumber}
          open={modal === "pdf"}
          onClose={closeModal}
        />
      ) : (
        <PdfStudio projectId={workspace.project.id} open={modal === "pdf"} onClose={closeModal} />
      )}

      <RevisionCompare workspace={workspace} open={modal === "compare"} onClose={closeModal} />

      <AgentChat
        projectId={workspace.project.id}
        open={chatOpen}
        onClose={() => setChatOpen(false)}
        prefill={agentPrefill}
        autoStartIntake={autoIntake}
        initialPersonaId={intakePersonaId}
        onIntakeStarted={() => setAutoIntake(false)}
        onWorkspaceMutated={refreshWorkspace}
        onAgentNavigate={handleAgentNavigate}
      />

      <RevisionDiffModal
        open={revisionDiffOpen}
        onClose={() => setRevisionDiffOpen(false)}
        projectId={workspace.project.id}
        onApplied={() => {
          startTransition(async () => {
            try {
              const { getProjectWorkspace } = await import("@/lib/api");
              const fresh = await getProjectWorkspace(workspace.project.id);
              apply(fresh);
            } catch {}
          });
        }}
      />

      <AnimatePresence>
      {pluginToolsOpen && (
      <PluginToolsPanel
        projectId={workspace.project.id}
        revisionId={workspace.currentRevision.id}
        worksheetId={selectedWsId === "all" ? undefined : selectedWsId}
        rateSchedules={workspace.rateSchedules}
        open={pluginToolsOpen}
        initialSelection={pluginToolsTarget}
        onClose={closePluginTools}
        onItemsCreated={() => {
          // Refresh workspace after plugin creates items
          startTransition(async () => {
            try {
              const { getProjectWorkspace } = await import("@/lib/api");
              const fresh = await getProjectWorkspace(workspace.project.id);
              apply(fresh);
            } catch {}
          });
        }}
      />
      )}
      </AnimatePresence>
    </div>
    </WorkspaceI18nSurface>
  );
}

function SnapPdfPreviewModal({
  projectId,
  quoteNumber,
  open,
  onClose,
}: {
  projectId: string;
  quoteNumber?: string | null;
  open: boolean;
  onClose: () => void;
}) {
  const [previewKey, setPreviewKey] = useState(0);
  const [previewLoading, setPreviewLoading] = useState(true);
  const [downloading, setDownloading] = useState(false);
  const [printing, setPrinting] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const previewUrl = useMemo(() => getQuotePdfPreviewUrl(projectId, "snap"), [projectId]);
  const fileName = `${quoteNumber || "snap-quote"}.pdf`;

  useEffect(() => {
    if (!open) return;
    setPreviewLoading(true);
    setActionError(null);
    setPreviewKey((current) => current + 1);
  }, [open, projectId]);

  const downloadPdf = useCallback(async () => {
    if (downloading) return;
    setDownloading(true);
    setActionError(null);
    try {
      const blobUrl = await fetchQuotePdfBlobUrl(projectId, "snap");
      const link = document.createElement("a");
      link.href = blobUrl;
      link.download = fileName;
      link.click();
      window.setTimeout(() => URL.revokeObjectURL(blobUrl), 1000);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "PDF download failed.");
    } finally {
      setDownloading(false);
    }
  }, [downloading, fileName, projectId]);

  const printPdf = useCallback(async () => {
    if (printing) return;
    setPrinting(true);
    setActionError(null);
    try {
      const blobUrl = await fetchQuotePdfBlobUrl(projectId, "snap");
      const frame = document.createElement("iframe");
      frame.src = blobUrl;
      frame.title = "Snap quote print preview";
      frame.style.position = "fixed";
      frame.style.right = "0";
      frame.style.bottom = "0";
      frame.style.width = "1px";
      frame.style.height = "1px";
      frame.style.border = "0";
      frame.style.opacity = "0";
      frame.style.pointerEvents = "none";

      const cleanup = () => {
        frame.remove();
        URL.revokeObjectURL(blobUrl);
      };

      frame.onload = () => {
        try {
          frame.contentWindow?.focus();
          frame.contentWindow?.print();
        } finally {
          setPrinting(false);
          window.setTimeout(cleanup, 60000);
        }
      };
      frame.onerror = () => {
        setPrinting(false);
        cleanup();
        setActionError("PDF print failed.");
      };

      document.body.appendChild(frame);
    } catch (error) {
      setPrinting(false);
      setActionError(error instanceof Error ? error.message : "PDF print failed.");
    }
  }, [printing, projectId]);

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.16 }}
          className="fixed inset-0 z-50 flex bg-black/60 backdrop-blur-sm"
        >
          <motion.div
            initial={{ y: 20, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 20, opacity: 0 }}
            transition={{ type: "spring", damping: 30, stiffness: 300, delay: 0.04 }}
            className="m-3 flex flex-1 flex-col overflow-hidden rounded-xl border border-line bg-panel shadow-2xl"
          >
            <div className="flex shrink-0 items-center justify-between border-b border-line px-4 py-3">
              <div className="flex items-center gap-2">
                <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-accent/10">
                  <FileText className="h-3.5 w-3.5 text-accent" />
                </div>
                <div>
                  <div className="text-sm font-semibold">Snap PDF</div>
                  <div className="text-[10px] text-fg/35">Preview</div>
                </div>
                {previewLoading && <Loader2 className="ml-2 h-3.5 w-3.5 animate-spin text-fg/35" />}
              </div>
              <div className="flex items-center gap-2">
                {actionError && <span className="max-w-xs truncate text-[11px] text-danger">{actionError}</span>}
                <Button size="sm" variant="secondary" onClick={printPdf} disabled={printing || downloading}>
                  {printing ? <Loader2 className="h-3 w-3 animate-spin" /> : <Printer className="h-3 w-3" />}
                  Print
                </Button>
                <Button size="sm" variant="accent" onClick={downloadPdf} disabled={downloading || printing}>
                  {downloading ? <Loader2 className="h-3 w-3 animate-spin" /> : <Download className="h-3 w-3" />}
                  Download
                </Button>
                <Button variant="ghost" size="sm" onClick={onClose} aria-label="Close PDF preview">
                  <X className="h-4 w-4" />
                </Button>
              </div>
            </div>
            <div className="min-h-0 flex-1 overflow-auto bg-panel2/30 p-6">
              <PdfPagePreview
                url={previewUrl}
                refreshKey={previewKey}
                zoom={100}
                onLoadingChange={setPreviewLoading}
              />
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function SnapQuoteSheet({
  workspace,
  snapLineLimit,
  snapWorksheetId,
  onApply,
  onError,
  onRefresh,
  onUpgrade,
  onOpenPluginTools,
  isPending,
}: {
  workspace: ProjectWorkspaceData;
  snapLineLimit: number;
  snapWorksheetId?: string;
  onApply: (next: WorkspaceResponse | ((prev: WorkspaceResponse) => WorkspaceResponse)) => void;
  onError: (message: string) => void;
  onRefresh: () => void;
  onUpgrade: () => void;
  onOpenPluginTools?: (target?: PluginToolsTarget) => void;
  isPending: boolean;
}) {
  const [title, setTitle] = useState(workspace.project.name);
  const [customerId, setCustomerId] = useState(workspace.quote.customerId ?? "");
  const [customerOptions, setCustomerOptions] = useState<Customer[]>([]);
  const [location, setLocation] = useState(workspace.project.location);
  const [description, setDescription] = useState(workspace.currentRevision.description ?? "");
  const [dateDue, setDateDue] = useState(toDateInput(workspace.currentRevision.dateDue));
  const [savingField, setSavingField] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    getCustomers()
      .then((customers) => {
        if (!cancelled) setCustomerOptions(customers);
      })
      .catch(() => {
        if (!cancelled) setCustomerOptions([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    setTitle(workspace.project.name);
    setCustomerId(workspace.quote.customerId ?? "");
    setLocation(workspace.project.location);
    setDescription(workspace.currentRevision.description ?? "");
    setDateDue(toDateInput(workspace.currentRevision.dateDue));
  }, [
    workspace.project.name,
    workspace.project.location,
    workspace.quote.customerId,
    workspace.currentRevision.description,
    workspace.currentRevision.dateDue,
  ]);

  const inferredCustomer = useMemo(() => {
    if (customerId) return customerOptions.find((customer) => customer.id === customerId) ?? null;
    const clientLabel = (workspace.quote.customerString || workspace.project.clientName || "").trim().toLowerCase();
    if (!clientLabel) return null;
    return customerOptions.find((customer) => {
      const name = customer.name.trim().toLowerCase();
      const shortName = (customer.shortName || "").trim().toLowerCase();
      return name === clientLabel || Boolean(shortName && shortName === clientLabel);
    }) ?? null;
  }, [customerId, customerOptions, workspace.project.clientName, workspace.quote.customerString]);

  const customerPickerValue = customerId || inferredCustomer?.id || null;
  const customerPickerOptions = useMemo(() => {
    const keepId = inferredCustomer?.id ?? customerId;
    return customerOptions
      .filter((customer) => customer.active || customer.id === keepId)
      .slice()
      .sort((left, right) => left.name.localeCompare(right.name))
      .map((customer) => ({
        id: customer.id,
        label: customer.name,
        secondary: customer.shortName || undefined,
      }));
  }, [customerId, customerOptions, inferredCustomer?.id]);

  async function saveProjectField(field: "name" | "location", value: string) {
    const trimmed = value.trim();
    if (field === "name" && (!trimmed || trimmed === workspace.project.name)) return;
    if (field === "location" && trimmed === workspace.project.location) return;

    setSavingField(field);
    try {
      onApply(await updateProject(workspace.project.id, { [field]: trimmed || "TBD" }));
    } catch (error) {
      onError(error instanceof Error ? error.message : "Save failed.");
    } finally {
      setSavingField(null);
    }
  }

  async function saveCustomer(nextCustomerId: string) {
    const selectedCustomer = customerOptions.find((customer) => customer.id === nextCustomerId);
    if (!selectedCustomer) return;

    const alreadyLinked = nextCustomerId === (workspace.quote.customerId ?? "");
    const alreadyNamed = selectedCustomer.name === workspace.quote.customerString && selectedCustomer.name === workspace.project.clientName;
    if (alreadyLinked && alreadyNamed) return;

    setSavingField("customerId");
    try {
      const defaultRatebooks = await listRateBookAssignments({
        customerId: selectedCustomer.id,
        active: true,
      });
      if (defaultRatebooks.length === 0) {
        onError(`Snap quotes need a default ratebook for ${selectedCustomer.name}. Add one on the client Ratebooks tab, then try again.`);
        return;
      }
      setCustomerId(nextCustomerId);
      await updateQuote(workspace.project.id, {
        customerExistingNew: "Existing",
        customerId: selectedCustomer.id,
        customerString: selectedCustomer.name,
        customerContactId: null,
        customerContactString: "",
        customerContactEmailString: "",
      });
      await updateProject(workspace.project.id, { clientName: selectedCustomer.name });
      onApply(await importAssignedRateSchedules(workspace.project.id));
    } catch (error) {
      setCustomerId(workspace.quote.customerId ?? "");
      onError(error instanceof Error ? error.message : "Save failed.");
    } finally {
      setSavingField(null);
    }
  }

  async function saveRevisionField(field: "description" | "dateDue", value: string) {
    const currentValue = field === "dateDue"
      ? toDateInput(workspace.currentRevision.dateDue)
      : String(workspace.currentRevision[field] ?? "");
    if (value === currentValue) return;

    setSavingField(field);
    try {
      const patch = field === "dateDue"
        ? { dateDue: fromDateInput(value) }
        : { [field]: value };
      onApply(await updateRevision(workspace.project.id, workspace.currentRevision.id, patch));
    } catch (error) {
      onError(error instanceof Error ? error.message : "Save failed.");
    } finally {
      setSavingField(null);
    }
  }

  const snapWorksheet = snapWorksheetId
    ? workspace.worksheets.find((worksheet) => worksheet.id === snapWorksheetId)
    : workspace.worksheets[0];
  const saving = savingField !== null;

  return (
    <div className="flex h-full min-h-0 flex-1 overflow-hidden">
      <div className="flex h-full min-h-0 w-full flex-col overflow-hidden rounded-xl border border-line bg-panel shadow-sm">
          <div className="flex shrink-0 items-center justify-between gap-4 border-b border-line px-5 py-3">
            <div className="flex min-w-0 flex-1 items-center gap-3">
              <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-accent/25 bg-accent/8 text-accent">
                <Zap className="h-4 w-4" />
              </span>
              <input
                className="h-9 min-w-0 flex-1 bg-transparent text-xl font-semibold tracking-normal text-fg outline-none placeholder:text-fg/25"
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                onBlur={() => saveProjectField("name", title)}
                disabled={saving}
                placeholder="Snap title"
              />
            </div>
            <div className="flex shrink-0 items-center gap-2">
              {savingField && (
                <span className="text-[11px] text-fg/35">Saving...</span>
              )}
              <Button size="sm" variant="secondary" onClick={onUpgrade} disabled={isPending || saving}>
                <FileText className="h-3 w-3" /> Upgrade to Quote
              </Button>
            </div>
          </div>

          <div className="grid shrink-0 gap-4 border-b border-line px-5 py-3 md:grid-cols-3">
            <div className="space-y-1.5">
              <span className="text-[10px] font-semibold uppercase tracking-normal text-fg/40">Client</span>
              <SearchablePicker
                value={customerPickerValue}
                onSelect={saveCustomer}
                options={customerPickerOptions}
                placeholder="Select client..."
                searchPlaceholder="Search clients..."
                emptyMessage="No clients found"
                disabled={saving}
                triggerClassName="h-9 rounded-lg bg-bg/50 px-3 text-sm"
                width={420}
              />
            </div>
            <label className="space-y-1.5">
              <span className="text-[10px] font-semibold uppercase tracking-normal text-fg/40">Site</span>
              <Input
                value={location}
                onChange={(event) => setLocation(event.target.value)}
                onBlur={() => saveProjectField("location", location)}
                disabled={saving}
              />
            </label>
            <label className="space-y-1.5">
              <span className="text-[10px] font-semibold uppercase tracking-normal text-fg/40">Valid Until</span>
              <Input
                type="date"
                value={dateDue}
                onChange={(event) => setDateDue(event.target.value)}
                onBlur={() => saveRevisionField("dateDue", dateDue)}
                disabled={saving}
              />
            </label>
          </div>

          <div className="shrink-0 border-b border-line px-5 py-3">
            <label className="block space-y-1.5">
              <span className="text-[10px] font-semibold uppercase tracking-normal text-fg/40">Scope</span>
              <Textarea
                className="h-16 resize-none overflow-auto"
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                onBlur={() => saveRevisionField("description", description)}
                disabled={saving}
                placeholder="Short customer-facing scope summary"
              />
            </label>
          </div>

          <div className="flex min-h-0 flex-1 flex-col border-b border-line px-5 py-3">
            <EstimateGrid
              workspace={workspace}
              onApply={onApply}
              onError={onError}
              onRefresh={onRefresh}
              onOpenPluginTools={onOpenPluginTools}
              variant="snap"
              maxLineItems={snapLineLimit}
              lockedWorksheetId={snapWorksheet?.id}
            />
          </div>
      </div>
    </div>
  );
}

/* ─── Helper to build rev draft ─── */

function buildRevDraftFromWs(workspace: ProjectWorkspaceData) {
  const r = workspace.currentRevision;
  return {
    title: r.title, description: r.description, notes: r.notes,
    breakoutStyle: r.breakoutStyle,
  };
}

/* ─── Action Menu Components ─── */

function MenuSection({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="group/section [&:last-child>.menu-divider]:hidden">
      <div className="px-3 py-1 text-[10px] font-medium uppercase text-fg/30">{label}</div>
      {children}
      <div className="menu-divider h-px bg-line mx-2 my-1" />
    </div>
  );
}

function MenuItem({ children, onClick, className, title }: { children: React.ReactNode; onClick: () => void; className?: string; title?: string }) {
  return (
    <button title={title} onClick={onClick} className={cn("block w-full px-3 py-1.5 text-left transition-colors hover:bg-panel2", className)}>
      {children}
    </button>
  );
}

function ToolbarTooltip({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="group relative inline-flex">
      {children}
      <div
        role="tooltip"
        className="pointer-events-none absolute right-0 top-full z-50 mt-2 whitespace-nowrap rounded-md border border-line bg-panel px-2 py-1 text-[10px] font-medium text-fg/70 opacity-0 shadow-lg transition-opacity group-hover:opacity-100 group-focus-within:opacity-100"
      >
        {label}
      </div>
    </div>
  );
}

/* ─── Factors Tab ─── */

const FACTOR_IMPACT_OPTIONS: Array<{ value: EstimateFactorImpact; label: string }> = [
  { value: "labor_hours", label: "Labor hours" },
  { value: "resource_units", label: "Resource units" },
  { value: "direct_cost", label: "Direct cost" },
  { value: "sell_price", label: "Sell price" },
];

const FACTOR_CONFIDENCE_OPTIONS: Array<{ value: EstimateFactorConfidence; label: string }> = [
  { value: "high", label: "High" },
  { value: "medium", label: "Medium" },
  { value: "low", label: "Low" },
];

const FACTOR_SOURCE_OPTIONS: Array<{ value: EstimateFactorSourceType; label: string }> = [
  { value: "knowledge", label: "Knowledge book" },
  { value: "library", label: "Library" },
  { value: "labor_unit", label: "Labor unit" },
  { value: "condition_difficulty", label: "Condition difficulty" },
  { value: "neca_difficulty", label: "Legacy condition difficulty" },
  { value: "agent", label: "Agent" },
  { value: "custom", label: "Custom" },
];

const FACTOR_APPLICATION_SCOPE_OPTIONS: Array<{ value: EstimateFactorApplicationScope; label: string }> = [
  { value: "global", label: "Global" },
  { value: "line", label: "Line" },
  { value: "both", label: "Both" },
];

const FACTOR_FORMULA_OPTIONS: Array<{ value: EstimateFactorFormulaType; label: string }> = [
  { value: "fixed_multiplier", label: "Fixed multiplier" },
  { value: "per_unit_scale", label: "Scaled input" },
  { value: "condition_score", label: "Condition score" },
  { value: "temperature_productivity", label: "Temperature productivity" },
  { value: "neca_condition_score", label: "Condition score sheet" },
  { value: "extended_duration", label: "Extended duration" },
];

function factorImpactLabel(value: EstimateFactorImpact | string) {
  return FACTOR_IMPACT_OPTIONS.find((option) => option.value === value)?.label ?? value.replace(/_/g, " ");
}

function sourceTypeLabel(value: string | undefined) {
  switch (value) {
    case "knowledge": return "Knowledge";
    case "labor_unit": return "Labor unit";
    case "condition_difficulty": return "Condition difficulty";
    case "neca_difficulty": return "Condition difficulty";
    case "agent": return "Agent";
    case "library": return "Library";
    default: return "Custom";
  }
}

function factorPercent(value: number) {
  return Number.isFinite(value) ? (value - 1) * 100 : 0;
}

function multiplierFromPercent(value: number) {
  return Math.max(0.05, Math.min(10, Math.round((1 + value / 100) * 10_000) / 10_000));
}

function factorScopeValueFromScope(scope: EstimateFactorScope = {}) {
  if (scope.phaseIds?.[0]) return `phase:${scope.phaseIds[0]}`;
  if (scope.worksheetIds?.[0]) return `worksheet:${scope.worksheetIds[0]}`;
  if (scope.categoryIds?.[0]) return `category:${scope.categoryIds[0]}`;
  if (scope.analyticsBuckets?.[0]) return `bucket:${scope.analyticsBuckets[0]}`;
  return "all";
}

function factorScopeValue(factor: EstimateFactor) {
  return factorScopeValueFromScope(factor.scope);
}

function factorScopeFromValue(value: string, workspace: ProjectWorkspaceData): { scope: EstimateFactorScope; appliesTo: string } {
  if (value.startsWith("bucket:")) {
    const bucket = value.slice("bucket:".length);
    return { scope: { mode: "category", analyticsBuckets: [bucket] }, appliesTo: bucket === "labour" ? "Labour" : bucket };
  }
  if (value.startsWith("category:")) {
    const categoryId = value.slice("category:".length);
    const category = workspace.entityCategories.find((entry) => entry.id === categoryId);
    return {
      scope: { mode: "category", categoryIds: [categoryId], categoryNames: category ? [category.name] : undefined },
      appliesTo: category?.name ?? "Category",
    };
  }
  if (value.startsWith("phase:")) {
    const phaseId = value.slice("phase:".length);
    const phase = workspace.phases.find((entry) => entry.id === phaseId);
    return { scope: { mode: "phase", phaseIds: [phaseId] }, appliesTo: phase?.name ?? "Phase" };
  }
  if (value.startsWith("worksheet:")) {
    const worksheetId = value.slice("worksheet:".length);
    const worksheet = workspace.worksheets.find((entry) => entry.id === worksheetId);
    return { scope: { mode: "worksheet", worksheetIds: [worksheetId] }, appliesTo: worksheet?.name ?? "Worksheet" };
  }
  return { scope: { mode: "all" }, appliesTo: "Entire estimate" };
}

function factorScopeOptions(workspace: ProjectWorkspaceData) {
  const bucketOptions = [
    { value: "bucket:labour", label: "Labour bucket" },
    { value: "bucket:material", label: "Material bucket" },
    { value: "bucket:equipment", label: "Equipment bucket" },
    { value: "bucket:subcontract", label: "Subcontract bucket" },
  ];
  return [
    { value: "all", label: "Entire estimate" },
    ...bucketOptions,
    ...workspace.entityCategories
      .filter((category) => category.enabled)
      .slice()
      .sort((left, right) => left.order - right.order)
      .map((category) => ({ value: `category:${category.id}`, label: `Category: ${category.name}` })),
    ...buildPhaseHierarchy(workspace.phases).nodes.map((phase) => ({
      value: `phase:${phase.id}`,
      label: `Phase: ${phase.depth > 0 ? `${"--".repeat(phase.depth)} ` : ""}${phaseDisplayLabel(phase)}`,
    })),
    ...workspace.worksheets.map((worksheet) => ({ value: `worksheet:${worksheet.id}`, label: `Worksheet: ${worksheet.name}` })),
  ];
}

function factorDeltaClass(value: number) {
  if (value > 0) return "text-warning";
  if (value < 0) return "text-success";
  return "text-fg/55";
}

function factorScopeLabel(value: string, options: Array<{ value: string; label: string }>) {
  return options.find((option) => option.value === value)?.label ?? "Entire estimate";
}

function factorSourceRefText(sourceRef: Record<string, unknown> | undefined, key: string) {
  const value = sourceRef?.[key];
  return typeof value === "string" ? value : "";
}

function factorEvidenceLabel(factor: Pick<EstimateFactor, "sourceRef" | "sourceType">) {
  const ref = factor.sourceRef ?? {};
  return factorSourceRefText(ref, "locator") || factorSourceRefText(ref, "title") || sourceTypeLabel(factor.sourceType);
}

function factorPercentLabel(value: number) {
  const percent = factorPercent(value);
  return `${percent >= 0 ? "+" : ""}${Math.round(percent * 100) / 100}%`;
}

function factorApplicationScopeLabel(value: EstimateFactorApplicationScope | string | undefined) {
  return FACTOR_APPLICATION_SCOPE_OPTIONS.find((option) => option.value === value)?.label ?? "Global";
}

function factorFormulaLabel(value: EstimateFactorFormulaType | string | undefined) {
  return FACTOR_FORMULA_OPTIONS.find((option) => option.value === value)?.label ?? "Fixed multiplier";
}

type FactorFlyoutState =
  | { mode: "create" }
  | { mode: "preset"; entry: EstimateFactorLibraryRecord }
  | { mode: "edit"; factor: EstimateFactor };

interface FactorDraft {
  name: string;
  code: string;
  description: string;
  category: string;
  impact: EstimateFactorImpact;
  percent: string;
  active: boolean;
  applicationScope: EstimateFactorApplicationScope;
  scopeValue: string;
  formulaType: EstimateFactorFormulaType;
  parameters: Record<string, unknown>;
  confidence: EstimateFactorConfidence;
  sourceType: EstimateFactorSourceType;
  sourceId: string;
  evidence: string;
  locator: string;
  tags: string;
  saveToLibrary: boolean;
}

function factorDraftFromState(state: FactorFlyoutState, workspace: ProjectWorkspaceData): FactorDraft {
  const source = state.mode === "edit" ? state.factor : state.mode === "preset" ? state.entry : null;
  const sourceRef = source?.sourceRef ?? {};
  const baseScope = source?.scope ?? { mode: "all" };
  const defaultScopeValue = state.mode === "create" ? "all" : factorScopeValueFromScope(baseScope);
  return {
    name: source?.name ?? "Custom Productivity Factor",
    code: source?.code ?? "CUSTOM",
    description: source?.description ?? "",
    category: source?.category ?? "Productivity",
    impact: (source?.impact ?? "labor_hours") as EstimateFactorImpact,
    percent: String(Math.round(factorPercent(source?.value ?? 1) * 100) / 100),
    active: state.mode === "edit" ? state.factor.active : true,
    applicationScope: (source?.applicationScope ?? (state.mode === "create" ? "global" : "both")) as EstimateFactorApplicationScope,
    scopeValue: factorScopeOptions(workspace).some((option) => option.value === defaultScopeValue) ? defaultScopeValue : "all",
    formulaType: (source?.formulaType ?? "fixed_multiplier") as EstimateFactorFormulaType,
    parameters: source?.parameters ?? {},
    confidence: (source?.confidence ?? "medium") as EstimateFactorConfidence,
    sourceType: (source?.sourceType ?? "custom") as EstimateFactorSourceType,
    sourceId: source?.sourceId ?? "",
    evidence: factorSourceRefText(sourceRef, "basis"),
    locator: factorSourceRefText(sourceRef, "locator"),
    tags: (source?.tags ?? ["custom"]).join(", "),
    saveToLibrary: false,
  };
}

function tagsFromDraft(value: string) {
  return value.split(",").map((entry) => entry.trim()).filter(Boolean);
}

function factorInputFromDraft(draft: FactorDraft, workspace: ProjectWorkspaceData, baseSourceRef?: Record<string, unknown>): CreateEstimateFactorInput {
  const scope = factorScopeFromValue(draft.scopeValue, workspace);
  const sourceRef = {
    ...(baseSourceRef ?? {}),
    ...(draft.evidence.trim() ? { basis: draft.evidence.trim() } : {}),
    ...(draft.locator.trim() ? { locator: draft.locator.trim() } : {}),
  };
  return {
    name: draft.name.trim() || "Factor",
    code: draft.code.trim(),
    description: draft.description.trim(),
    category: draft.category.trim() || "Productivity",
    impact: draft.impact,
    value: multiplierFromPercent(parseNum(draft.percent, 0)),
    active: draft.active,
    appliesTo: scope.appliesTo,
    applicationScope: draft.applicationScope,
    scope: scope.scope,
    formulaType: draft.formulaType,
    parameters: draft.parameters,
    confidence: draft.confidence,
    sourceType: draft.sourceType,
    sourceId: draft.sourceId.trim() || null,
    sourceRef,
    tags: tagsFromDraft(draft.tags),
  };
}

function FactorFormulaEditor({ draft, updateDraft }: { draft: FactorDraft; updateDraft: (patch: Partial<FactorDraft>) => void }) {
  return (
    <FactorParameterEditor
      formulaType={draft.formulaType}
      parameters={draft.parameters ?? {}}
      onChange={(parameters) => updateDraft({ parameters })}
    />
  );
}

function FactorsTab({ workspace, onApply, onError }: { workspace: ProjectWorkspaceData; onApply: (n: WorkspaceResponse) => void; onError: (m: string) => void }) {
  const [isPending, startTransition] = useTransition();
  const [library, setLibrary] = useState<EstimateFactorLibraryRecord[]>([]);
  const [libraryQuery, setLibraryQuery] = useState("");
  const [flyout, setFlyout] = useState<FactorFlyoutState | null>(null);
  const projectId = workspace.project.id;
  const allFactors = [...(workspace.estimateFactors ?? [])].sort((left, right) => left.order - right.order || left.name.localeCompare(right.name));
  const factors = allFactors.filter((factor) => (factor.applicationScope ?? "global") !== "line");
  const lineFactorCount = allFactors.length - factors.length;
  const factorTotalsById = useMemo(() => new Map((workspace.estimate.totals.factorTotals ?? []).map((entry) => [entry.id, entry])), [workspace.estimate.totals.factorTotals]);
  const activeFactors = factors.filter((factor) => factor.active);
  const valueDelta = (workspace.estimate.totals.factorTotals ?? []).reduce((sum, entry) => sum + entry.valueDelta, 0);
  const hoursDelta = (workspace.estimate.totals.factorTotals ?? []).reduce((sum, entry) => sum + entry.hoursDelta, 0);
  const scopeOptions = useMemo(() => factorScopeOptions(workspace), [workspace]);

  useEffect(() => {
    let cancelled = false;
    getEstimateFactorLibrary(projectId)
      .then((entries) => {
        if (!cancelled) setLibrary(entries);
      })
      .catch((cause) => {
        if (!cancelled) onError(cause instanceof Error ? cause.message : "Failed to load factor library");
      });
    return () => { cancelled = true; };
  }, [projectId, onError]);

  const filteredLibrary = useMemo(() => {
    const query = libraryQuery.trim().toLowerCase();
    const globalLibrary = library.filter((entry) => (entry.applicationScope ?? "both") !== "line");
    if (!query) return globalLibrary;
    return globalLibrary.filter((entry) => `${entry.name} ${entry.code} ${entry.description} ${entry.tags.join(" ")}`.toLowerCase().includes(query));
  }, [library, libraryQuery]);

  function runMutation(task: () => Promise<WorkspaceResponse>) {
    startTransition(async () => {
      try {
        onApply(await task());
      } catch (cause) {
        onError(cause instanceof Error ? cause.message : "Factor operation failed");
      }
    });
  }

  function removeFactor(factorId: string) {
    runMutation(() => deleteEstimateFactor(projectId, factorId));
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <div className="grid gap-2 md:grid-cols-4">
        <FactorMetric icon={SlidersHorizontal} label="Global Factors" value={`${activeFactors.length}/${factors.length}`} />
        <FactorMetric icon={Percent} label="Sell Impact" value={formatMoney(valueDelta)} valueClassName={factorDeltaClass(valueDelta)} />
        <FactorMetric icon={Clock} label="Hour Impact" value={`${hoursDelta >= 0 ? "+" : ""}${Math.round(hoursDelta * 100) / 100} hr`} valueClassName={factorDeltaClass(hoursDelta)} />
        <FactorMetric icon={Target} label="Before Factors" value={formatMoney(workspace.estimate.totals.lineSubtotalBeforeFactors ?? workspace.estimate.totals.subtotal)} />
      </div>

      <div className="grid min-h-0 flex-1 gap-3 xl:grid-cols-[minmax(340px,0.9fr)_minmax(520px,1.35fr)]">
        <section className="flex min-h-0 flex-col overflow-hidden rounded-lg border border-line bg-panel">
          <div className="shrink-0 border-b border-line px-4 py-3">
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="flex items-center gap-2 text-sm font-semibold text-fg"><Library className="h-4 w-4 text-accent" /> Factor Library</div>
                <div className="mt-1 text-[11px] text-fg/55">Book-backed productivity factors and organization standards.</div>
              </div>
              <Button size="xs" variant="secondary" onClick={() => setFlyout({ mode: "create" })} disabled={isPending}><Plus className="h-3 w-3" /> Custom</Button>
            </div>
            <div className="relative mt-3">
              <SearchCheck className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-fg/35" />
              <Input className="h-8 pl-7 text-xs" value={libraryQuery} onChange={(event) => setLibraryQuery(event.target.value)} placeholder="Search factors" />
            </div>
          </div>
          <div className="min-h-0 flex-1 space-y-2 overflow-auto p-3">
            {filteredLibrary.map((entry) => (
              <div key={entry.id} className="rounded-lg border border-line/80 bg-bg/35 p-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-semibold text-fg">{entry.name}</div>
                    <div className="mt-1 flex flex-wrap items-center gap-1.5">
                      <Badge tone="info">{entry.category}</Badge>
                      <Badge tone={entry.value >= 1 ? "warning" : "success"}>{entry.value >= 1 ? "+" : ""}{formatPercent(entry.value - 1)}</Badge>
                      <Badge tone="default">{factorImpactLabel(entry.impact)}</Badge>
                      <Badge tone="info">{factorApplicationScopeLabel(entry.applicationScope)}</Badge>
                      <Badge tone="default">{factorFormulaLabel(entry.formulaType)}</Badge>
                      <Badge tone={entry.sourceType === "knowledge" ? "success" : "default"}>
                        {entry.sourceType === "knowledge" ? "Book" : "Org"}
                      </Badge>
                    </div>
                  </div>
                  <Button size="xs" onClick={() => setFlyout({ mode: "preset", entry })} disabled={isPending}><Plus className="h-3 w-3" /> Add</Button>
                </div>
                <p className="mt-2 line-clamp-3 text-xs leading-5 text-fg/60">{entry.description}</p>
                <div className="mt-2 truncate text-[10px] text-fg/40">{factorEvidenceLabel(entry)}</div>
              </div>
            ))}
            {filteredLibrary.length === 0 ? <EmptyState>No matching library factors</EmptyState> : null}
          </div>
        </section>

        <section className="flex min-h-0 flex-col overflow-hidden rounded-lg border border-line bg-panel">
          <div className="shrink-0 border-b border-line px-4 py-3">
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="flex items-center gap-2 text-sm font-semibold text-fg"><Zap className="h-4 w-4 text-accent" /> Applied Factors</div>
                <div className="mt-1 text-[11px] text-fg/55">Global factors change the estimate production model before rollups, summaries, and quote-level adjustments. Line factors stay in the worksheet column.</div>
              </div>
              <div className="flex items-center gap-2">
                {lineFactorCount > 0 ? <Badge tone="info">{lineFactorCount} line</Badge> : null}
                <Badge tone={valueDelta >= 0 ? "warning" : "success"}>{valueDelta >= 0 ? "+" : ""}{formatMoney(valueDelta)}</Badge>
              </div>
            </div>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden">
            {factors.length === 0 ? (
              <EmptyState>Use a library factor or create a custom factor</EmptyState>
            ) : (
              <div className="w-full">
                <div className="grid grid-cols-[minmax(0,1fr)_84px_78px_92px_64px] gap-2 border-b border-line bg-panel2/55 px-3 py-2 text-[10px] font-medium uppercase text-fg/35">
                  <div>Factor</div>
                  <div>Scope</div>
                  <div>Mult.</div>
                  <div>Delta</div>
                  <div />
                </div>
                {factors.map((factor) => (
                  <FactorRow
                    key={factor.id}
                    factor={factor}
                    totals={factorTotalsById.get(factor.id)}
                    scopeOptions={scopeOptions}
                    scopeValue={factorScopeValue(factor)}
                    onEdit={() => setFlyout({ mode: "edit", factor })}
                    onDelete={() => removeFactor(factor.id)}
                    disabled={isPending}
                  />
                ))}
              </div>
            )}
          </div>
        </section>
      </div>
      <FactorFlyout
        state={flyout}
        workspace={workspace}
        library={library}
        onClose={() => setFlyout(null)}
        onApply={onApply}
        onError={onError}
        onLibrarySaved={(entry) => setLibrary((current) => [entry, ...current.filter((candidate) => candidate.id !== entry.id)])}
      />
    </div>
  );
}

function FactorMetric({ icon: Icon, label, value, valueClassName }: { icon: typeof SlidersHorizontal; label: string; value: string; valueClassName?: string }) {
  return (
    <div className="rounded-lg border border-line bg-panel px-3 py-2">
      <div className="flex items-center gap-2 text-[11px] font-medium uppercase text-fg/40"><Icon className="h-3.5 w-3.5" /> {label}</div>
      <div className={cn("mt-1 text-lg font-semibold text-fg", valueClassName)}>{value}</div>
    </div>
  );
}

function FactorRow({
  factor,
  totals,
  scopeOptions,
  scopeValue,
  onEdit,
  onDelete,
  disabled,
}: {
  factor: EstimateFactor;
  totals?: ProjectWorkspaceData["estimate"]["totals"]["factorTotals"][number];
  scopeOptions: Array<{ value: string; label: string }>;
  scopeValue: string;
  onEdit: () => void;
  onDelete: () => void;
  disabled: boolean;
}) {
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_84px_78px_92px_64px] items-center gap-2 border-b border-line/70 px-3 py-2 text-xs">
      <div className="min-w-0">
        <div className="flex min-w-0 items-center gap-1.5">
          <Badge tone={factor.active ? "success" : "default"}>{factor.active ? "On" : "Off"}</Badge>
          <button className="block min-w-0 flex-1 truncate text-left font-medium text-fg hover:text-accent" onClick={onEdit} disabled={disabled}>{factor.name}</button>
        </div>
        <div className="mt-1 flex min-w-0 items-center gap-1.5 text-[10px] text-fg/45">
          <BookOpen className="h-3 w-3" />
          <span className="truncate">{factor.code || factor.category || "Factor"}</span>
          <span className="text-fg/25">/</span>
          <span className="truncate">{factorImpactLabel(factor.impact)}</span>
          <span className="text-fg/25">/</span>
          <span className="truncate">{factorEvidenceLabel(factor)}</span>
        </div>
      </div>
      <div className="min-w-0 truncate text-fg/60" title={factorScopeLabel(scopeValue, scopeOptions)}>{factorScopeLabel(scopeValue, scopeOptions)}</div>
      <div className={cn("min-w-0 truncate font-mono text-[11px]", factor.value >= 1 ? "text-warning" : "text-success")} title={factorFormulaLabel(factor.formulaType)}>
        {factorPercentLabel(totals?.value ?? factor.value)}
      </div>
      <div className="font-mono text-[11px]">
        <div className={factorDeltaClass(totals?.valueDelta ?? 0)}>{formatMoney(totals?.valueDelta ?? 0)}</div>
        <div className="mt-0.5 text-fg/40">{totals?.targetCount ?? 0} targets</div>
      </div>
      <div className="flex justify-end gap-1">
        <Button size="xs" variant="ghost" className="h-8 px-2" onClick={onEdit} disabled={disabled}>
          <Settings2 className="h-3.5 w-3.5" />
        </Button>
        <Button size="xs" variant="ghost" className="h-8 px-2" onClick={onDelete} disabled={disabled}>
          <Trash2 className="h-3.5 w-3.5 text-danger" />
        </Button>
      </div>
    </div>
  );
}

function FactorFlyout({
  state,
  workspace,
  library,
  onClose,
  onApply,
  onError,
  onLibrarySaved,
}: {
  state: FactorFlyoutState | null;
  workspace: ProjectWorkspaceData;
  library: EstimateFactorLibraryRecord[];
  onClose: () => void;
  onApply: (payload: WorkspaceResponse) => void;
  onError: (message: string) => void;
  onLibrarySaved: (entry: EstimateFactorLibraryRecord) => void;
}) {
  const [isPending, startTransition] = useTransition();
  const [draft, setDraft] = useState<FactorDraft | null>(null);
  const scopeOptions = useMemo(() => factorScopeOptions(workspace), [workspace]);

  useEffect(() => {
    setDraft(state ? factorDraftFromState(state, workspace) : null);
  }, [state, workspace]);

  if (!state || !draft || typeof document === "undefined") return null;

  const baseSourceRef = state.mode === "edit" ? state.factor.sourceRef : state.mode === "preset" ? state.entry.sourceRef : {};
  const title = state.mode === "edit" ? "Edit Factor" : state.mode === "preset" ? "Add Factor" : "Create Factor";
  // All library entries are user-owned org rows now (no built-in/read-only
  // shadow set), so saving back to the library is always allowed.
  const canSaveToLibrary = true;
  const alreadyInLibrary = state.mode === "preset" || (state.mode === "edit" && library.some((entry) => entry.id === state.factor.sourceId));

  function updateDraft(patch: Partial<FactorDraft>) {
    setDraft((current) => current ? { ...current, ...patch } : current);
  }

  function save() {
    const currentState = state;
    const currentDraft = draft;
    if (!currentState || !currentDraft) return;
    startTransition(async () => {
      try {
        const input = factorInputFromDraft(currentDraft, workspace, baseSourceRef);
        let sourceInput = input;
        if (currentDraft.saveToLibrary && canSaveToLibrary) {
          const libraryEntry = await createEstimateFactorLibraryEntry({
            ...input,
            active: undefined,
            sourceRef: { ...(input.sourceRef ?? {}), addedFrom: currentState.mode },
          });
          onLibrarySaved(libraryEntry);
          sourceInput = {
            ...input,
            sourceType: "library",
            sourceId: libraryEntry.id,
            sourceRef: { ...(input.sourceRef ?? {}), libraryEntryId: libraryEntry.id },
          };
        } else if (currentState.mode === "preset") {
          sourceInput = {
            ...input,
            sourceId: currentState.entry.id,
            sourceRef: { ...(input.sourceRef ?? {}), libraryEntryId: currentState.entry.id },
          };
        }

        const payload = currentState.mode === "edit"
          ? await updateEstimateFactor(workspace.project.id, currentState.factor.id, sourceInput)
          : await createEstimateFactor(workspace.project.id, sourceInput);
        onApply(payload);
        onClose();
      } catch (cause) {
        onError(cause instanceof Error ? cause.message : "Failed to save factor");
      }
    });
  }

  return createPortal(
    <AnimatePresence>
      <motion.div key="factor-flyout-backdrop" className="fixed inset-0 z-[80] bg-black/35" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose} />
      <motion.aside
        key="factor-flyout-panel"
        className="fixed bottom-0 right-0 top-0 z-[81] flex w-full max-w-[560px] flex-col border-l border-line bg-panel shadow-2xl"
        initial={{ x: "100%" }}
        animate={{ x: 0 }}
        exit={{ x: "100%" }}
        transition={{ type: "spring", damping: 26, stiffness: 280 }}
      >
        <div className="flex items-center justify-between border-b border-line px-5 py-4">
          <div>
            <div className="text-sm font-semibold text-fg">{title}</div>
            <div className="mt-1 text-[11px] text-fg/45">{draft.code || sourceTypeLabel(draft.sourceType)}</div>
          </div>
          <Button size="xs" variant="ghost" className="h-8 w-8 px-0" onClick={onClose}><X className="h-4 w-4" /></Button>
        </div>

        <div className="min-h-0 flex-1 space-y-4 overflow-auto p-5">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5 sm:col-span-2">
              <Label>Name</Label>
              <Input value={draft.name} onChange={(event) => updateDraft({ name: event.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label>Code</Label>
              <Input value={draft.code} onChange={(event) => updateDraft({ code: event.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label>Category</Label>
              <Input value={draft.category} onChange={(event) => updateDraft({ category: event.target.value })} />
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label>Description</Label>
              <Textarea rows={3} value={draft.description} onChange={(event) => updateDraft({ description: event.target.value })} />
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>Impact</Label>
              <Select value={draft.impact} onValueChange={(impact) => updateDraft({ impact: impact as EstimateFactorImpact })} options={FACTOR_IMPACT_OPTIONS} />
            </div>
            <div className="space-y-1.5">
              <Label>Percent</Label>
              <div className="relative">
                <Input className="pr-8 text-right font-mono" value={draft.percent} onChange={(event) => updateDraft({ percent: event.target.value })} />
                <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-fg/45">%</span>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Scope</Label>
              <Select value={draft.scopeValue} onValueChange={(scopeValue) => updateDraft({ scopeValue })} options={scopeOptions} />
            </div>
            <div className="space-y-1.5">
              <Label>Apply As</Label>
              <Select value={draft.applicationScope} onValueChange={(applicationScope) => updateDraft({ applicationScope: applicationScope as EstimateFactorApplicationScope })} options={FACTOR_APPLICATION_SCOPE_OPTIONS} />
            </div>
            <div className="space-y-1.5">
              <Label>Formula</Label>
              <Select value={draft.formulaType} onValueChange={(formulaType) => updateDraft({ formulaType: formulaType as EstimateFactorFormulaType })} options={FACTOR_FORMULA_OPTIONS} />
            </div>
            <div className="space-y-1.5">
              <Label>Confidence</Label>
              <Select value={draft.confidence} onValueChange={(confidence) => updateDraft({ confidence: confidence as EstimateFactorConfidence })} options={FACTOR_CONFIDENCE_OPTIONS} />
            </div>
            <div className="space-y-1.5">
              <Label>Source</Label>
              <Select value={draft.sourceType} onValueChange={(sourceType) => updateDraft({ sourceType: sourceType as EstimateFactorSourceType })} options={FACTOR_SOURCE_OPTIONS} />
            </div>
            <div className="space-y-1.5">
              <Label>Source ID</Label>
              <Input value={draft.sourceId} onChange={(event) => updateDraft({ sourceId: event.target.value })} />
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label>Evidence</Label>
              <Textarea rows={3} value={draft.evidence} onChange={(event) => updateDraft({ evidence: event.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label>Locator</Label>
              <Input value={draft.locator} onChange={(event) => updateDraft({ locator: event.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label>Tags</Label>
              <Input value={draft.tags} onChange={(event) => updateDraft({ tags: event.target.value })} />
            </div>
          </div>

          <FactorFormulaEditor draft={draft} updateDraft={updateDraft} />

          <div className="flex items-center justify-between rounded-lg border border-line bg-bg/35 px-3 py-2">
            <div>
              <div className="text-xs font-medium text-fg">Active</div>
              <div className="mt-0.5 text-[10px] text-fg/45">{draft.active ? "Included in totals" : "Held out of totals"}</div>
            </div>
            <Toggle checked={draft.active} onChange={(active) => updateDraft({ active })} />
          </div>

          {canSaveToLibrary && !alreadyInLibrary ? (
            <div className="flex items-center justify-between rounded-lg border border-line bg-bg/35 px-3 py-2">
              <div>
                <div className="text-xs font-medium text-fg">Add to Library</div>
                <div className="mt-0.5 text-[10px] text-fg/45">Create an organization reusable factor.</div>
              </div>
              <Toggle checked={draft.saveToLibrary} onChange={(saveToLibrary) => updateDraft({ saveToLibrary })} />
            </div>
          ) : null}
        </div>

        <div className="flex items-center justify-between border-t border-line px-5 py-4">
          <div className="text-[11px] text-fg/45">{factorPercentLabel(multiplierFromPercent(parseNum(draft.percent, 0)))} {factorImpactLabel(draft.impact).toLowerCase()}</div>
          <div className="flex gap-2">
            <Button variant="secondary" onClick={onClose} disabled={isPending}>Cancel</Button>
            <Button onClick={save} disabled={isPending}><Save className="h-4 w-4" /> Save</Button>
          </div>
        </div>
      </motion.aside>
    </AnimatePresence>,
    document.body,
  );
}

/* ─── Phases Tab ─── */

type PhaseTableNode = ProjectPhase & {
  depth: number;
  childCount: number;
  path: string;
};

type PhaseTotals = {
  itemCount: number;
  hours: number;
  cost: number;
  price: number;
};

type PhaseStats = {
  direct: PhaseTotals;
  total: PhaseTotals;
};

type PhaseDropPosition = "before" | "inside" | "after";
type PhaseDropTarget = {
  phaseId: string;
  anchorId: string | null;
  parentId: string | null;
  position: PhaseDropPosition;
};

const PHASE_FALLBACK_COLOR = "#64748b";

function emptyPhaseTotals(): PhaseTotals {
  return { itemCount: 0, hours: 0, cost: 0, price: 0 };
}

function clonePhaseTotals(value: PhaseTotals): PhaseTotals {
  return { itemCount: value.itemCount, hours: value.hours, cost: value.cost, price: value.price };
}

function addPhaseTotals(target: PhaseTotals, source: PhaseTotals) {
  target.itemCount += source.itemCount;
  target.hours += source.hours;
  target.cost += source.cost;
  target.price += source.price;
}

function phaseDisplayLabel(phase: Pick<ProjectPhase, "number" | "name">) {
  return [phase.number, phase.name].map((part) => part?.trim()).filter(Boolean).join(" - ") || "Phase";
}

function normalizePhaseColor(color: string | null | undefined) {
  return /^#[0-9a-f]{6}$/i.test(color ?? "") ? color! : PHASE_FALLBACK_COLOR;
}

function phaseSort(left: Pick<ProjectPhase, "order" | "number" | "name">, right: Pick<ProjectPhase, "order" | "number" | "name">) {
  if (left.order !== right.order) return left.order - right.order;
  const leftLabel = left.number || left.name;
  const rightLabel = right.number || right.name;
  return leftLabel.localeCompare(rightLabel, undefined, { numeric: true, sensitivity: "base" });
}

function buildPhaseHierarchy(phases: ProjectPhase[]) {
  const byId = new Map(phases.map((phase) => [phase.id, phase]));
  const childrenByParent = new Map<string | null, ProjectPhase[]>();

  for (const phase of phases) {
    const parentId = phase.parentId && byId.has(phase.parentId) ? phase.parentId : null;
    const siblings = childrenByParent.get(parentId) ?? [];
    siblings.push(phase);
    childrenByParent.set(parentId, siblings);
  }

  for (const siblings of childrenByParent.values()) {
    siblings.sort(phaseSort);
  }

  const nodes: PhaseTableNode[] = [];
  const pathById = new Map<string, string>();
  const visited = new Set<string>();

  const visit = (parentId: string | null, depth: number, ancestors: Set<string>) => {
    for (const phase of childrenByParent.get(parentId) ?? []) {
      if (visited.has(phase.id) || ancestors.has(phase.id)) continue;
      visited.add(phase.id);
      const label = phaseDisplayLabel(phase);
      const parentPath = parentId ? pathById.get(parentId) : "";
      const path = parentPath ? `${parentPath} / ${label}` : label;
      pathById.set(phase.id, path);
      nodes.push({
        ...phase,
        parentId,
        depth,
        childCount: childrenByParent.get(phase.id)?.length ?? 0,
        path,
      });
      const nextAncestors = new Set(ancestors);
      nextAncestors.add(phase.id);
      visit(phase.id, depth + 1, nextAncestors);
    }
  };

  visit(null, 0, new Set());
  for (const phase of [...phases].sort(phaseSort)) {
    if (visited.has(phase.id)) continue;
    pathById.set(phase.id, phaseDisplayLabel(phase));
    visited.add(phase.id);
    nodes.push({
      ...phase,
      parentId: null,
      depth: 0,
      childCount: childrenByParent.get(phase.id)?.length ?? 0,
      path: phaseDisplayLabel(phase),
    });
    visit(phase.id, 1, new Set([phase.id]));
  }

  const descendantsById = new Map<string, Set<string>>();
  const collectDescendants = (phaseId: string, ancestors = new Set<string>()): Set<string> => {
    const existing = descendantsById.get(phaseId);
    if (existing) return existing;
    const descendants = new Set<string>();
    for (const child of childrenByParent.get(phaseId) ?? []) {
      if (ancestors.has(child.id)) continue;
      descendants.add(child.id);
      const nextAncestors = new Set(ancestors);
      nextAncestors.add(child.id);
      for (const nestedId of collectDescendants(child.id, nextAncestors)) {
        descendants.add(nestedId);
      }
    }
    descendantsById.set(phaseId, descendants);
    return descendants;
  };

  for (const phase of phases) {
    collectDescendants(phase.id, new Set([phase.id]));
  }

  return {
    nodes,
    nodeById: new Map(nodes.map((node) => [node.id, node])),
    childrenByParent,
    descendantsById,
  };
}

function phaseLineCost(item: WorkspaceWorksheetItem) {
  return (Number(item.quantity) || 0) * (Number(item.cost) || 0);
}

function phaseRollupItems(workspace: ProjectWorkspaceData) {
  const adjusted = workspace.estimate?.totals?.adjustedLineItems ?? [];
  if (adjusted.length > 0) return adjusted;
  const estimateItems = workspace.estimate?.lineItems ?? [];
  if (estimateItems.length > 0) return estimateItems;
  return (workspace.worksheets ?? []).flatMap((worksheet) => worksheet.items ?? []);
}

function phaseItemHours(item: WorkspaceWorksheetItem, rateSchedules: ProjectWorkspaceData["rateSchedules"]) {
  return getWorksheetHourBreakdown(item, rateSchedules ?? []).total;
}

function buildPhaseStats(workspace: ProjectWorkspaceData, hierarchy: ReturnType<typeof buildPhaseHierarchy>) {
  const direct = new Map<string, PhaseTotals>();
  const stats = new Map<string, PhaseStats>();

  for (const phase of workspace.phases ?? []) {
    direct.set(phase.id, emptyPhaseTotals());
  }

  for (const item of phaseRollupItems(workspace)) {
    if (!item.phaseId || !direct.has(item.phaseId)) continue;
    const totals = direct.get(item.phaseId)!;
    totals.itemCount += 1;
    totals.cost += phaseLineCost(item);
    totals.price += Number(item.price) || 0;
    totals.hours += phaseItemHours(item, workspace.rateSchedules ?? []);
  }

  const totalForPhase = (phaseId: string, ancestors = new Set<string>()): PhaseTotals => {
    const total = clonePhaseTotals(direct.get(phaseId) ?? emptyPhaseTotals());
    for (const child of hierarchy.childrenByParent.get(phaseId) ?? []) {
      if (ancestors.has(child.id)) continue;
      const nextAncestors = new Set(ancestors);
      nextAncestors.add(child.id);
      addPhaseTotals(total, totalForPhase(child.id, nextAncestors));
    }
    stats.set(phaseId, {
      direct: clonePhaseTotals(direct.get(phaseId) ?? emptyPhaseTotals()),
      total,
    });
    return total;
  };

  for (const node of hierarchy.nodes) {
    if (!stats.has(node.id)) totalForPhase(node.id, new Set([node.id]));
  }

  return stats;
}

function formatPhaseHours(value: number) {
  if (!value) return "-";
  return value.toLocaleString(undefined, { maximumFractionDigits: value >= 10 ? 0 : 1 });
}

function phaseMargin(total: PhaseTotals) {
  return total.price > 0 ? (total.price - total.cost) / total.price : 0;
}

function phaseParentOptions(nodes: PhaseTableNode[], phaseId: string, descendants: Set<string>) {
  return [
    { value: "", label: "Top level" },
    ...nodes
      .filter((node) => node.id !== phaseId && !descendants.has(node.id))
      .map((node) => ({
        value: node.id,
        label: `${node.depth > 0 ? `${"--".repeat(node.depth)} ` : ""}${phaseDisplayLabel(node)}`,
      })),
  ];
}

function PhasesTab({ workspace, onApply, onError }: { workspace: ProjectWorkspaceData; onApply: (n: WorkspaceResponse) => void; onError: (m: string) => void }) {
  const [isPending, startTransition] = useTransition();
  const phases = workspace.phases ?? [];
  const [collapsedIds, setCollapsedIds] = useState<Set<string>>(() => new Set());
  const [detailPhaseId, setDetailPhaseId] = useState<string | null>(null);
  const [dragPhaseId, setDragPhaseId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<PhaseDropTarget | null>(null);
  const hierarchy = useMemo(() => buildPhaseHierarchy(phases), [phases]);
  const phaseStats = useMemo(() => buildPhaseStats(workspace, hierarchy), [workspace, hierarchy]);
  const visibleNodes = useMemo(
    () => hierarchy.nodes.filter((node) => {
      let parentId = node.parentId ?? null;
      while (parentId) {
        if (collapsedIds.has(parentId)) return false;
        parentId = hierarchy.nodeById.get(parentId)?.parentId ?? null;
      }
      return true;
    }),
    [collapsedIds, hierarchy],
  );
  const topLevelCount = hierarchy.nodes.filter((node) => !node.parentId).length;
  const detailPhase = detailPhaseId ? hierarchy.nodeById.get(detailPhaseId) ?? null : null;

  function nextPhaseNumber(parentId: string | null) {
    const phaseById = new Map(phases.map((phase) => [phase.id, phase]));
    const siblings = phases.filter((phase) => {
      const normalizedParentId = phase.parentId && phaseById.has(phase.parentId) ? phase.parentId : null;
      return normalizedParentId === parentId;
    });
    const next = siblings.length + 1;
    const parent = parentId ? phaseById.get(parentId) : null;
    return parent?.number ? `${parent.number}.${next}` : String(next).padStart(2, "0");
  }

  function addPhase(parentId: string | null = null) {
    startTransition(async () => {
      try {
        onApply(await createPhase(workspace.project.id, {
          parentId,
          number: nextPhaseNumber(parentId),
          name: parentId ? "New child phase" : "New phase",
        }));
        if (parentId) {
          setCollapsedIds((prev) => {
            const next = new Set(prev);
            next.delete(parentId);
            return next;
          });
        }
      }
      catch (e) { onError(e instanceof Error ? e.message : "Failed"); }
    });
  }

  function savePhase(phaseId: string, patch: PhasePatchInput) {
    if (Object.keys(patch).length === 0) return;
    startTransition(async () => {
      try { onApply(await updatePhase(workspace.project.id, phaseId, patch)); }
      catch (e) { onError(e instanceof Error ? e.message : "Failed"); }
    });
  }

  function normalizedParentId(phase: ProjectPhase) {
    return phase.parentId && hierarchy.nodeById.has(phase.parentId) ? phase.parentId : null;
  }

  function phaseSiblings(parentId: string | null, excludeId?: string) {
    return phases
      .filter((phase) => normalizedParentId(phase) === parentId && phase.id !== excludeId)
      .sort(phaseSort);
  }

  function movePhase(draggedId: string, target: PhaseDropTarget) {
    if (draggedId === target.phaseId && target.anchorId === target.phaseId) return;
    const dragged = hierarchy.nodeById.get(draggedId);
    const hoverTarget = hierarchy.nodeById.get(target.phaseId);
    if (!dragged || !hoverTarget) return;
    if (target.parentId === draggedId || hierarchy.descendantsById.get(draggedId)?.has(target.parentId ?? "")) return;

    const siblings = phaseSiblings(target.parentId, draggedId);
    const insertIndex = target.position === "inside"
      ? siblings.length
      : target.anchorId
        ? Math.max(0, siblings.findIndex((phase) => phase.id === target.anchorId) + (target.position === "after" ? 1 : 0))
        : (target.position === "before" ? 0 : siblings.length);
    const ordered = [...siblings];
    ordered.splice(insertIndex, 0, dragged);

    startTransition(async () => {
      try {
        let last: WorkspaceResponse | null = null;
        for (const [index, phase] of ordered.entries()) {
          const order = index + 1;
          const currentParentId = phase.id === draggedId ? (dragged.parentId ?? null) : normalizedParentId(phase);
          const patch: PhasePatchInput = {};
          if (currentParentId !== target.parentId) patch.parentId = target.parentId;
          if (phase.order !== order) patch.order = order;
          if (Object.keys(patch).length > 0) {
            last = await updatePhase(workspace.project.id, phase.id, patch);
          }
        }
        if (target.position === "inside") {
          setCollapsedIds((prev) => {
            const next = new Set(prev);
            next.delete(target.phaseId);
            return next;
          });
        }
        if (last) onApply(last);
      } catch (e) {
        onError(e instanceof Error ? e.message : "Move failed");
      }
    });
  }

  function resolveDepthParent(flatNodes: PhaseTableNode[], insertionIndex: number, desiredDepth: number) {
    let depth = desiredDepth;
    while (depth > 0) {
      for (let index = insertionIndex - 1; index >= 0; index -= 1) {
        const candidate = flatNodes[index];
        if (candidate.depth === depth - 1) {
          return { parentId: candidate.id, depth };
        }
      }
      depth -= 1;
    }
    return { parentId: null, depth: 0 };
  }

  function resolveSiblingAnchor(flatNodes: PhaseTableNode[], insertionIndex: number, parentId: string | null) {
    for (let index = insertionIndex - 1; index >= 0; index -= 1) {
      const candidate = flatNodes[index];
      if ((candidate.parentId ?? null) === parentId) {
        return { anchorId: candidate.id, position: "after" as const };
      }
    }
    for (let index = insertionIndex; index < flatNodes.length; index += 1) {
      const candidate = flatNodes[index];
      if ((candidate.parentId ?? null) === parentId) {
        return { anchorId: candidate.id, position: "before" as const };
      }
    }
    return { anchorId: null, position: "before" as const };
  }

  function buildPhaseDropTarget(phaseId: string, event: DragEvent<HTMLTableRowElement>): PhaseDropTarget | null {
    if (!dragPhaseId) return null;
    const target = hierarchy.nodeById.get(phaseId);
    if (!target) return null;
    const rect = event.currentTarget.getBoundingClientRect();
    const ratio = (event.clientY - rect.top) / Math.max(1, rect.height);
    const rowIndentX = rect.left + 42;
    const indentWidth = 18;
    const draggedDescendants = hierarchy.descendantsById.get(dragPhaseId) ?? new Set<string>();

    if (dragPhaseId !== phaseId && !draggedDescendants.has(phaseId)) {
      const targetIndentX = rowIndentX + target.depth * indentWidth;
      const horizontalOffset = event.clientX - targetIndentX;
      if (ratio >= 0.25 && ratio <= 0.75 && horizontalOffset > 42) {
        return { phaseId, anchorId: null, parentId: phaseId, position: "inside" };
      }
    }

    const flatNodes = visibleNodes.filter((node) => node.id !== dragPhaseId && !draggedDescendants.has(node.id));
    const targetIndex = flatNodes.findIndex((node) => node.id === phaseId);
    if (targetIndex < 0) return null;

    const insertionIndex = ratio < 0.5 ? targetIndex : targetIndex + 1;
    const previousNode = flatNodes[insertionIndex - 1] ?? null;
    const maxDepth = previousNode ? previousNode.depth + 1 : 0;
    const desiredDepth = Math.max(0, Math.min(maxDepth, Math.round((event.clientX - rowIndentX) / indentWidth)));
    const { parentId } = resolveDepthParent(flatNodes, insertionIndex, desiredDepth);
    if (parentId === dragPhaseId || draggedDescendants.has(parentId ?? "")) return null;

    const anchor = resolveSiblingAnchor(flatNodes, insertionIndex, parentId);
    return {
      phaseId,
      anchorId: anchor.anchorId,
      parentId,
      position: anchor.position,
    };
  }

  function handlePhaseDragOver(phaseId: string, event: DragEvent<HTMLTableRowElement>) {
    if (!dragPhaseId) return;
    const target = buildPhaseDropTarget(phaseId, event);
    if (!target) {
      setDropTarget(null);
      return;
    }
    event.preventDefault();
    setDropTarget(target);
  }

  function handlePhaseDrop(phaseId: string, event: DragEvent<HTMLTableRowElement>) {
    event.preventDefault();
    const draggedId = dragPhaseId ?? event.dataTransfer.getData("text/plain");
    const target = dropTarget?.phaseId === phaseId
      ? dropTarget
      : { phaseId, anchorId: phaseId, parentId: hierarchy.nodeById.get(phaseId)?.parentId ?? null, position: "after" as const };
    setDragPhaseId(null);
    setDropTarget(null);
    if (draggedId) movePhase(draggedId, target);
  }

  function removePhase(phaseId: string) {
    const node = hierarchy.nodeById.get(phaseId);
    const stats = phaseStats.get(phaseId)?.direct ?? emptyPhaseTotals();
    const warnings = [
      node?.childCount ? `${node.childCount} child phase${node.childCount === 1 ? "" : "s"} will move up one level` : "",
      stats.itemCount ? `${stats.itemCount} directly assigned item${stats.itemCount === 1 ? "" : "s"} will become unphased` : "",
    ].filter(Boolean);
    if (warnings.length > 0 && !window.confirm(`Delete ${node?.name || "phase"}?\n\n${warnings.join(". ")}.`)) {
      return;
    }
    startTransition(async () => {
      try { onApply(await deletePhase(workspace.project.id, phaseId)); }
      catch (e) { onError(e instanceof Error ? e.message : "Failed"); }
    });
    if (detailPhaseId === phaseId) setDetailPhaseId(null);
  }

  function togglePhase(phaseId: string) {
    setCollapsedIds((prev) => {
      const next = new Set(prev);
      if (next.has(phaseId)) next.delete(phaseId);
      else next.add(phaseId);
      return next;
    });
  }

  return (
    <>
    <Card className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <CardHeader className="shrink-0 px-4 py-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <CardTitle>Phase Register</CardTitle>
              <Badge tone="info">{phases.length} phases</Badge>
              <Badge tone="info">{topLevelCount} top level</Badge>
            </div>
          </div>
          <Button size="xs" onClick={() => addPhase(null)} disabled={isPending}><Plus className="h-3.5 w-3.5" /> Add phase</Button>
        </div>
      </CardHeader>
      <CardBody className="min-h-0 flex-1 overflow-hidden p-0">
        {phases.length === 0 ? (
          <div className="flex h-full items-center justify-center p-8">
            <EmptyState>No phases defined</EmptyState>
          </div>
        ) : (
          <div className="h-full overflow-y-auto overflow-x-hidden bg-bg/20">
            <table className="w-full table-fixed border-separate border-spacing-0 text-xs">
              <colgroup>
                <col className="w-[56%]" />
                <col className="w-[15%]" />
                <col className="w-[20%]" />
                <col className="w-[9%]" />
              </colgroup>
              <thead className="sticky top-0 z-10 bg-panel/95 text-[11px] font-medium uppercase text-fg/40 backdrop-blur">
                <tr>
                  <th className="border-b border-line px-3 py-1.5 text-left">Phase</th>
                  <th className="border-b border-line px-2 py-1.5 text-right">Scope</th>
                  <th className="border-b border-line px-2 py-1.5 text-right">Estimate</th>
                  <th className="border-b border-line px-2 py-1.5"></th>
                </tr>
              </thead>
              <tbody>
                {visibleNodes.map((phase) => (
                  <PhaseRow
                    key={phase.id}
                    phase={phase}
                    stats={phaseStats.get(phase.id) ?? { direct: emptyPhaseTotals(), total: emptyPhaseTotals() }}
                    isCollapsed={collapsedIds.has(phase.id)}
                    dragState={dropTarget?.phaseId === phase.id ? dropTarget.position : null}
                    onToggle={togglePhase}
                    onAddChild={addPhase}
                    onOpenDetail={setDetailPhaseId}
                    onDelete={removePhase}
                    onDragStart={(id, event) => {
                      setDragPhaseId(id);
                      event.dataTransfer.effectAllowed = "move";
                      event.dataTransfer.setData("text/plain", id);
                    }}
                    onDragOver={handlePhaseDragOver}
                    onDragLeave={() => setDropTarget(null)}
                    onDrop={handlePhaseDrop}
                    onDragEnd={() => {
                      setDragPhaseId(null);
                      setDropTarget(null);
                    }}
                    isPending={isPending}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardBody>
    </Card>
    {detailPhase ? (
      <PhaseDetailFlyout
        phase={detailPhase}
        stats={phaseStats.get(detailPhase.id) ?? { direct: emptyPhaseTotals(), total: emptyPhaseTotals() }}
        parentOptions={phaseParentOptions(hierarchy.nodes, detailPhase.id, hierarchy.descendantsById.get(detailPhase.id) ?? new Set())}
        onClose={() => setDetailPhaseId(null)}
        onSave={savePhase}
        onAddChild={addPhase}
        onDelete={removePhase}
        isPending={isPending}
      />
    ) : null}
    </>
  );
}

function PhaseRow({
  phase,
  stats,
  isCollapsed,
  dragState,
  onToggle,
  onAddChild,
  onOpenDetail,
  onDelete,
  onDragStart,
  onDragOver,
  onDragLeave,
  onDrop,
  onDragEnd,
  isPending,
}: {
  phase: PhaseTableNode;
  stats: PhaseStats;
  isCollapsed: boolean;
  dragState: PhaseDropPosition | null;
  onToggle: (id: string) => void;
  onAddChild: (parentId: string) => void;
  onOpenDetail: (id: string) => void;
  onDelete: (id: string) => void;
  onDragStart: (id: string, event: DragEvent<HTMLButtonElement>) => void;
  onDragOver: (id: string, event: DragEvent<HTMLTableRowElement>) => void;
  onDragLeave: () => void;
  onDrop: (id: string, event: DragEvent<HTMLTableRowElement>) => void;
  onDragEnd: () => void;
  isPending: boolean;
}) {
  const hasChildren = phase.childCount > 0;
  const colorValue = normalizePhaseColor(phase.color);
  const directLabel = stats.direct.itemCount !== stats.total.itemCount || stats.direct.hours !== stats.total.hours || stats.direct.cost !== stats.total.cost || stats.direct.price !== stats.total.price;
  const margin = phaseMargin(stats.total);

  return (
    <tr
      className={cn(
        "group relative bg-panel transition-colors hover:bg-panel2/45",
        dragState === "inside" && "bg-accent/8",
        dragState === "before" && "shadow-[inset_0_2px_0_rgba(59,130,246,0.75)]",
        dragState === "after" && "shadow-[inset_0_-2px_0_rgba(59,130,246,0.75)]",
      )}
      onDragOver={(event) => onDragOver(phase.id, event)}
      onDragLeave={onDragLeave}
      onDrop={(event) => onDrop(phase.id, event)}
    >
      <td className="border-b border-line px-3 py-1 align-middle">
        <div className="flex min-w-0 items-center gap-1.5" style={{ paddingLeft: Math.min(phase.depth * 18, 90) }}>
          <button
            type="button"
            draggable
            onDragStart={(event) => onDragStart(phase.id, event)}
            onDragEnd={onDragEnd}
            className="flex h-5 w-4 shrink-0 cursor-grab items-center justify-center rounded text-fg/25 hover:bg-bg hover:text-fg/55 active:cursor-grabbing"
            title="Drag up/down to reorder; drag right to indent or left to outdent"
            aria-label="Drag phase"
          >
            <GripVertical className="h-3.5 w-3.5" />
          </button>
          <div className="relative flex items-center">
            {phase.depth > 0 ? <span className="absolute right-full mr-1.5 h-px w-3 bg-line" /> : null}
            <button
              type="button"
              className={cn("flex h-5 w-5 shrink-0 items-center justify-center rounded text-fg/45 hover:bg-bg hover:text-fg", !hasChildren && "invisible")}
              onClick={() => onToggle(phase.id)}
              disabled={!hasChildren}
              aria-label={isCollapsed ? "Expand phase" : "Collapse phase"}
            >
              {isCollapsed ? <ChevronRight className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
            </button>
          </div>
          <div className="h-6 w-1 shrink-0 rounded-full" style={{ backgroundColor: colorValue }} />
          <button type="button" onClick={() => onOpenDetail(phase.id)} className="min-w-0 flex-1 text-left">
            <div className="flex min-w-0 items-center gap-2">
              <span className="shrink-0 rounded border border-line bg-bg/65 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-fg/60">{phase.number || "-"}</span>
              <span className="truncate text-xs font-semibold text-fg">{phase.name || "Untitled phase"}</span>
              {hasChildren ? <span className="shrink-0 rounded bg-bg px-1.5 py-0.5 text-[10px] text-fg/45">{phase.childCount}</span> : null}
              {phase.description ? <span className="hidden min-w-0 truncate text-[10px] text-fg/35 xl:block">{phase.description}</span> : null}
            </div>
          </button>
        </div>
      </td>
      <td className="border-b border-line px-2 py-1 text-right align-middle tabular-nums">
        <div className="whitespace-nowrap text-[11px] font-semibold text-fg/75">{stats.total.itemCount} items</div>
        <div className="whitespace-nowrap text-[10px] text-fg/40">{formatPhaseHours(stats.total.hours)} hrs{directLabel ? ` / ${stats.direct.itemCount} direct` : ""}</div>
      </td>
      <td className="border-b border-line px-2 py-1 text-right align-middle tabular-nums">
        <div className="whitespace-nowrap text-[11px] font-semibold text-fg">{formatMoney(stats.total.price)}</div>
        <div className="whitespace-nowrap text-[10px] text-fg/40">{formatMoney(stats.total.cost)} / {formatPercent(margin)}</div>
      </td>
      <td className="border-b border-line px-2 py-1 align-middle">
        <div className="flex justify-end gap-0.5">
          <Button size="xs" variant="ghost" className="h-6 w-6 px-0" onClick={() => onAddChild(phase.id)} disabled={isPending} title="Add child phase" aria-label="Add child phase">
            <Plus className="h-3.5 w-3.5" />
          </Button>
          <Button size="xs" variant="ghost" className="h-6 w-6 px-0" onClick={() => onOpenDetail(phase.id)} disabled={isPending} title="Edit phase" aria-label="Edit phase">
            <Settings2 className="h-3.5 w-3.5" />
          </Button>
          <Button size="xs" variant="ghost" className="h-6 w-6 px-0" onClick={() => onDelete(phase.id)} disabled={isPending} title="Delete phase" aria-label="Delete phase">
            <Trash2 className="h-3.5 w-3.5 text-danger" />
          </Button>
        </div>
      </td>
    </tr>
  );
}

function PhaseDetailFlyout({
  phase,
  stats,
  parentOptions,
  onClose,
  onSave,
  onAddChild,
  onDelete,
  isPending,
}: {
  phase: PhaseTableNode;
  stats: PhaseStats;
  parentOptions: Array<{ value: string; label: string; disabled?: boolean }>;
  onClose: () => void;
  onSave: (id: string, patch: PhasePatchInput) => void;
  onAddChild: (parentId: string) => void;
  onDelete: (id: string) => void;
  isPending: boolean;
}) {
  const [draft, setDraft] = useState({
    number: phase.number,
    name: phase.name,
    parentId: phase.parentId ?? "",
    description: phase.description,
    startDate: phase.startDate ?? "",
    endDate: phase.endDate ?? "",
    order: String(phase.order ?? 0),
    color: normalizePhaseColor(phase.color),
  });

  useEffect(() => {
    setDraft({
      number: phase.number,
      name: phase.name,
      parentId: phase.parentId ?? "",
      description: phase.description,
      startDate: phase.startDate ?? "",
      endDate: phase.endDate ?? "",
      order: String(phase.order ?? 0),
      color: normalizePhaseColor(phase.color),
    });
  }, [phase]);

  function updateDraft(patch: Partial<typeof draft>) {
    setDraft((current) => ({ ...current, ...patch }));
  }

  function save() {
    const patch: PhasePatchInput = {};
    if (draft.number !== phase.number) patch.number = draft.number;
    if (draft.name !== phase.name) patch.name = draft.name;
    if (draft.parentId !== (phase.parentId ?? "")) patch.parentId = draft.parentId || null;
    if (draft.description !== phase.description) patch.description = draft.description;
    if (draft.startDate !== (phase.startDate ?? "")) patch.startDate = draft.startDate || null;
    if (draft.endDate !== (phase.endDate ?? "")) patch.endDate = draft.endDate || null;
    if (draft.color !== normalizePhaseColor(phase.color)) patch.color = draft.color;
    const nextOrder = Number.parseInt(draft.order, 10);
    if (Number.isFinite(nextOrder) && nextOrder !== phase.order) patch.order = nextOrder;
    onSave(phase.id, patch);
  }

  return createPortal(
    <AnimatePresence>
      <motion.div key="phase-flyout-backdrop" className="fixed inset-0 z-[80] bg-black/30" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose} />
      <motion.aside
        key="phase-flyout-panel"
        className="fixed bottom-0 right-0 top-0 z-[81] flex w-full max-w-[560px] flex-col border-l border-line bg-panel shadow-2xl"
        initial={{ x: "100%" }}
        animate={{ x: 0 }}
        exit={{ x: "100%" }}
        transition={{ type: "spring", damping: 26, stiffness: 280 }}
      >
        <div className="flex items-start justify-between border-b border-line px-5 py-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="h-3 w-3 rounded-full" style={{ backgroundColor: normalizePhaseColor(draft.color) }} />
              <div className="truncate text-sm font-semibold text-fg">{phaseDisplayLabel(phase)}</div>
            </div>
            <div className="mt-1 truncate text-[11px] text-fg/45">{phase.path}</div>
          </div>
          <Button size="xs" variant="ghost" className="h-8 w-8 px-0" onClick={onClose}><X className="h-4 w-4" /></Button>
        </div>

        <div className="min-h-0 flex-1 space-y-5 overflow-auto p-5">
          <div className="grid grid-cols-3 gap-3 rounded-lg border border-line bg-bg/35 p-3">
            <div>
              <div className="text-[10px] uppercase text-fg/35">Items</div>
              <div className="mt-1 text-lg font-semibold tabular-nums">{stats.total.itemCount}</div>
            </div>
            <div>
              <div className="text-[10px] uppercase text-fg/35">Hours</div>
              <div className="mt-1 text-lg font-semibold tabular-nums">{formatPhaseHours(stats.total.hours)}</div>
            </div>
            <div>
              <div className="text-[10px] uppercase text-fg/35">Value</div>
              <div className="mt-1 text-lg font-semibold tabular-nums">{formatMoney(stats.total.price)}</div>
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-[120px_1fr]">
            <div className="space-y-1.5">
              <Label>Number</Label>
              <Input value={draft.number} onChange={(event) => updateDraft({ number: event.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label>Name</Label>
              <Input value={draft.name} onChange={(event) => updateDraft({ name: event.target.value })} />
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>Parent</Label>
              <Select value={draft.parentId} onValueChange={(parentId) => updateDraft({ parentId })} options={parentOptions} />
            </div>
            <div className="space-y-1.5">
              <Label>Order</Label>
              <Input value={draft.order} inputMode="numeric" onChange={(event) => updateDraft({ order: event.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label>Start</Label>
              <Input type="date" value={draft.startDate} onChange={(event) => updateDraft({ startDate: event.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label>End</Label>
              <Input type="date" value={draft.endDate} onChange={(event) => updateDraft({ endDate: event.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label>Color</Label>
              <div className="flex h-9 items-center gap-3 rounded-lg border border-line bg-bg/50 px-3">
                <input type="color" value={draft.color} onChange={(event) => updateDraft({ color: event.target.value })} className="h-6 w-8 cursor-pointer rounded border-0 bg-transparent p-0" />
                <span className="font-mono text-xs text-fg/55">{draft.color}</span>
              </div>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>Description</Label>
            <Textarea rows={5} value={draft.description} onChange={(event) => updateDraft({ description: event.target.value })} />
          </div>
        </div>

        <div className="flex items-center justify-between border-t border-line px-5 py-4">
          <div className="flex gap-2">
            <Button variant="ghost" onClick={() => onAddChild(phase.id)} disabled={isPending}><Plus className="h-4 w-4" /> Child</Button>
            <Button variant="danger" onClick={() => onDelete(phase.id)} disabled={isPending}><Trash2 className="h-4 w-4" /> Delete</Button>
          </div>
          <div className="flex gap-2">
            <Button variant="secondary" onClick={onClose} disabled={isPending}>Cancel</Button>
            <Button onClick={save} disabled={isPending}><Save className="h-4 w-4" /> Save</Button>
          </div>
        </div>
      </motion.aside>
    </AnimatePresence>,
    document.body,
  );
}
