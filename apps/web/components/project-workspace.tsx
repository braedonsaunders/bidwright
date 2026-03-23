"use client";

import { useEffect, useMemo, useState, useTransition, useRef, useCallback } from "react";
import { motion, AnimatePresence } from "motion/react";
import { useSearchParams } from "next/navigation";
import {
  ChevronDown,
  ClipboardList,
  Copy,
  FileText,
  GitCompareArrows,
  Layers3,
  MessageSquareText,
  Plus,
  Save,
  Settings2,
  Sparkles,
  Puzzle,
  Trash2,
} from "lucide-react";
import type {
  Activity,
  CreateWorksheetItemInput,
  JobRecord,
  PackageRecord,
  ProjectWorkspaceData,
  RevisionPatchInput,
  WorkspaceResponse,
  WorkspaceWorksheet,
  WorkspaceWorksheetItem,
  WorkspaceStateRecord,
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
  updateProjectStatus,
  updateRevision,
  updateWorksheet,
  getProjectWorkspace,
  updateWorksheetItem,
} from "@/lib/api";
import { formatDateTime, formatMoney, formatPercent } from "@/lib/format";
import { AgentChat } from "@/components/workspace/agent-chat";
import { EstimateGrid } from "@/components/workspace/estimate-grid";
import { AIReviewQueue } from "@/components/ai-review-queue";
import { SetupTab } from "@/components/workspace/setup-tab";
import { SummarizeTab } from "@/components/workspace/summarize-tab";
import { DocumentationTab } from "@/components/workspace/documentation-tab";
import { TakeoffTab } from "@/components/workspace/takeoff-tab";
import { ScheduleTab } from "@/components/workspace/schedule-tab";
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
import { PdfStudio } from "@/components/workspace/pdf-studio";
import { PluginToolsPanel } from "@/components/workspace/plugin-tools-panel";
import { WorkspaceSearch, type SearchNavigationTarget } from "@/components/workspace/workspace-search";
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
  Progress,
  Select,
  Separator,
  Textarea,
  Toggle,
} from "@/components/ui";
import { cn } from "@/lib/utils";

/* ─── Types ─── */

type WorkspaceTab = "setup" | "estimate" | "summarize" | "documents" | "activity";
type EstimateSubTab = "worksheets" | "phases" | "takeoff" | "schedule";

type ItemDraft = {
  mode: "create" | "edit";
  worksheetId: string;
  itemId?: string;
  phaseId: string;
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
  laborHourReg: number;
  laborHourOver: number;
  laborHourDouble: number;
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
  { id: "summarize", label: "Summarize", icon: ClipboardList },
  { id: "documents", label: "Documents", icon: FileText },
  { id: "activity", label: "Activity", icon: MessageSquareText },
];

/* ─── Utilities ─── */

function buildItemDraft(ws: WorkspaceWorksheet, item?: WorkspaceWorksheetItem): ItemDraft {
  return {
    mode: item ? "edit" : "create", worksheetId: ws.id, itemId: item?.id,
    phaseId: item?.phaseId ?? "", category: item?.category ?? "Labour",
    entityType: item?.entityType ?? "LaborClass", entityName: item?.entityName ?? "",
    vendor: item?.vendor ?? "", description: item?.description ?? "",
    quantity: item?.quantity ?? 1, uom: item?.uom ?? "EA",
    cost: item?.cost ?? 0, markup: item?.markup ?? 0.2, price: item?.price ?? 0,
    laborHourReg: item?.laborHourReg ?? 0, laborHourOver: item?.laborHourOver ?? 0,
    laborHourDouble: item?.laborHourDouble ?? 0, lineOrder: item?.lineOrder ?? ws.items.length + 1,
  };
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

function findWs(workspace: ProjectWorkspaceData, id: string) {
  return (workspace.worksheets ?? []).find((w) => w.id === id) ?? (workspace.worksheets ?? [])[0] ?? null;
}

/* ─── Main Component ─── */

export function ProjectWorkspace({ initialData }: { initialData: WorkspaceResponse }) {
  const [tab, setTab] = useState<WorkspaceTab>("setup");
  const [estimateSubTab, setEstimateSubTab] = useState<EstimateSubTab>("worksheets");
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
  const [modal, setModal] = useState<ModalState>(null);
  const [aiResult, setAiResult] = useState<string | null>(null);
  const [aiPhaseResult, setAiPhaseResult] = useState<AIPhaseResult[] | null>(null);
  const [aiEquipResult, setAiEquipResult] = useState<AIEquipmentResult[] | null>(null);
  const [chatOpen, setChatOpen] = useState(false);
  const [autoIntake, setAutoIntake] = useState(false);
  const [pluginToolsOpen, setPluginToolsOpen] = useState(false);
  const searchParams = useSearchParams();
  const intakeInitRef = useRef(false);
  const [isPending, startTransition] = useTransition();

  const [searchHighlight, setSearchHighlight] = useState<SearchNavigationTarget | null>(null);

  const handleSearchNavigate = useCallback((target: SearchNavigationTarget) => {
    setTab(target.tab);
    if (target.tab === "estimate" && "subTab" in target) {
      setEstimateSubTab(target.subTab as EstimateSubTab);
      if (target.subTab === "worksheets" && "worksheetId" in target && target.worksheetId) {
        setSelectedWsId(target.worksheetId);
      }
    }
    setSearchHighlight(target);
    // Clear highlight after 3 seconds
    setTimeout(() => setSearchHighlight(null), 3000);
  }, []);

  const workspace = data.workspace;
  const selectedWs = selectedWsId === "all" ? null : findWs(workspace, selectedWsId);

  useEffect(() => {
    setRevDraft(buildRevDraftFromWs(workspace));
  }, [workspace.currentRevision]);

  useEffect(() => {
    if (!findWs(workspace, selectedWsId)) setSelectedWsId((workspace.worksheets ?? [])[0]?.id ?? "all");
  }, [workspace, selectedWsId]);

  useEffect(() => { setWsNameDraft(selectedWs?.name ?? ""); }, [selectedWs?.id, selectedWs?.name]);

  // Auto-open estimate tab + agent chat when redirected from intake
  useEffect(() => {
    if (intakeInitRef.current) return;
    const urlTab = searchParams.get("tab");
    const urlIntake = searchParams.get("intake");
    if (urlTab === "estimate") {
      setTab("estimate");
      setEstimateSubTab("worksheets");
    }
    if (urlIntake === "true") {
      setChatOpen(true);
      setAutoIntake(true);
      intakeInitRef.current = true;
      // Remove ?intake=true from URL so it doesn't re-trigger on reload
      const url = new URL(window.location.href);
      url.searchParams.delete("intake");
      window.history.replaceState({}, "", url.pathname + url.search);
    }
  }, [searchParams]);

  const visibleRows = useMemo(() => {
    const rows = selectedWs ? selectedWs.items : (workspace.worksheets ?? []).flatMap((w) => w.items);
    const q = searchTerm.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) => [r.entityName, r.description, r.category, r.entityType, r.vendor ?? ""].join(" ").toLowerCase().includes(q));
  }, [searchTerm, selectedWs, workspace.worksheets]);

  const currentItem = itemDraft?.itemId ? (workspace.worksheets ?? []).flatMap((w) => w.items).find((i) => i.id === itemDraft.itemId) ?? null : null;

  function apply(next: WorkspaceResponse) { setData(next); setError(null); }

  const refreshWorkspace = useCallback(() => {
    startTransition(async () => {
      try {
        const fresh = await getProjectWorkspace(workspace.project.id);
        apply(fresh);
      } catch { /* silent - user can still manually refresh */ }
    });
  }, [workspace.project.id]);

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

  // ─── Worksheet/Item operations (same as before) ───

  function openItemEditor(ws: WorkspaceWorksheet, item: WorkspaceWorksheetItem) { setItemDraft(buildItemDraft(ws, item)); setError(null); }
  function openCreateItem(ws: WorkspaceWorksheet) { setSelectedWsId(ws.id); setItemDraft(buildItemDraft(ws)); setError(null); }

  function saveItem() {
    if (!itemDraft) return;
    const payload: CreateWorksheetItemInput = {
      phaseId: itemDraft.phaseId || null, category: itemDraft.category, entityType: itemDraft.entityType,
      entityName: itemDraft.entityName, vendor: itemDraft.vendor || null, description: itemDraft.description,
      quantity: itemDraft.quantity, uom: itemDraft.uom, cost: itemDraft.cost, markup: itemDraft.markup,
      price: itemDraft.price, laborHourReg: itemDraft.laborHourReg, laborHourOver: itemDraft.laborHourOver,
      laborHourDouble: itemDraft.laborHourDouble, lineOrder: itemDraft.lineOrder,
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
          setItemDraft(ni ? buildItemDraft(nws, ni) : null);
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
      phaseId: itemDraft.phaseId || null, category: itemDraft.category, entityType: itemDraft.entityType,
      entityName: itemDraft.entityName, vendor: itemDraft.vendor || null, description: itemDraft.description,
      quantity: itemDraft.quantity, uom: itemDraft.uom, cost: itemDraft.cost, markup: itemDraft.markup,
      price: itemDraft.price, laborHourReg: itemDraft.laborHourReg, laborHourOver: itemDraft.laborHourOver,
      laborHourDouble: itemDraft.laborHourDouble, lineOrder: itemDraft.lineOrder + 1,
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

  return (
    <div className="flex flex-col flex-1 min-h-0 gap-4">
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
            <Badge tone={statusTone(workspace.currentRevision.status)}>{workspace.currentRevision.type ?? "Firm"}</Badge>
          </div>
          <div className="mt-0.5 flex items-center gap-1.5 text-[11px] text-fg/40 truncate">
            <span>{workspace.project.clientName}</span>
            <span>·</span>
            <span>{workspace.quote.quoteNumber}</span>
            <span>·</span>
            <span>Rev {workspace.currentRevision.revisionNumber}</span>
            <span>·</span>
            <span className="truncate">{workspace.project.location}</span>
            {workspace.currentRevision.dateDue && (
              <><span>·</span><span className="whitespace-nowrap">Due {workspace.currentRevision.dateDue}</span></>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <div className="hidden lg:flex items-center gap-3 text-right">
            <div className="flex items-center gap-3 text-[11px] text-fg/50">
              <div className="whitespace-nowrap"><span className="text-fg/35">Cost</span> <span className="font-mono">{formatMoney(workspace.currentRevision.cost)}</span></div>
              <div className="whitespace-nowrap"><span className="text-fg/35">Profit</span> <span className={cn("font-mono", (workspace.currentRevision.estimatedProfit ?? 0) >= 0 ? "text-success" : "text-danger")}>{formatMoney(workspace.currentRevision.estimatedProfit)}</span></div>
              <div className="whitespace-nowrap"><span className="text-fg/35">Hrs</span> <span className="font-mono">{(workspace.currentRevision.totalHours ?? 0).toLocaleString()}</span></div>
            </div>
            <div className="border-l border-line pl-3">
              <div className="text-base font-semibold tabular-nums whitespace-nowrap">{formatMoney(workspace.currentRevision.subtotal)}</div>
              <div className="text-[10px] text-fg/35">{formatPercent(workspace.currentRevision.estimatedMargin, 1)} margin</div>
            </div>
          </div>

          <Button size="sm" variant="secondary" onClick={() => handleAction("compare")}>
            <GitCompareArrows className="h-3 w-3" />
          </Button>

          <Button size="sm" variant="secondary" onClick={() => setPluginToolsOpen(true)}>
            <Puzzle className="h-3 w-3" />
          </Button>

          <Button size="sm" variant="accent" onClick={() => setChatOpen(true)}>
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
                    <MenuItem onClick={() => handleAction("pdf")}>Generate PDF</MenuItem>
                  </MenuSection>
                  <MenuSection label="Actions">
                    <MenuItem onClick={() => handleAction("sendQuote")}>Send Quote</MenuItem>
                    <MenuItem onClick={() => handleAction("copyQuote")}>Copy Quote</MenuItem>
                    <MenuItem onClick={() => handleAction("importBOM")}>Import Line Items</MenuItem>
                  </MenuSection>
                  <MenuSection label="Revisions">
                    <MenuItem onClick={() => handleAction("createRevision")}>New Revision</MenuItem>
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
      <div className="flex items-center gap-1 border-b border-line pb-px overflow-x-auto">
        {tabs.map((t) => {
          const Icon = t.icon;
          return (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
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

      {error && <div className="rounded-lg border border-danger/20 bg-danger/5 px-3 py-2 text-xs text-danger">{error}</div>}

      {/* ─── Tab Content ─── */}
      <div className="flex-1 min-h-0 flex flex-col">
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
                {(["worksheets", "phases", "takeoff", "schedule"] as const).map((st) => (
                  <button key={st} onClick={() => setEstimateSubTab(st)}
                    className={cn("px-2.5 py-1 text-[11px] font-medium rounded-md transition-colors whitespace-nowrap",
                      estimateSubTab === st ? "bg-panel2 text-fg" : "text-fg/40 hover:text-fg/60"
                    )}>
                    {st === "worksheets" ? "Worksheets" : st === "phases" ? "Phases" : st === "takeoff" ? "Takeoff" : "Schedule"}
                  </button>
                ))}
              </div>

              <AnimatePresence mode="wait">
                {estimateSubTab === "worksheets" && (
                  <motion.div key="worksheets" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.12 }} className="flex-1 min-h-0 flex flex-col">
                    <EstimateGrid workspace={workspace} onApply={apply} onError={setError} highlightItemId={searchHighlight && "itemId" in searchHighlight ? searchHighlight.itemId : undefined} />
                  </motion.div>
                )}

                {estimateSubTab === "phases" && (
                  <motion.div key="phases" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.12 }} className="flex-1 min-h-0 flex flex-col">
                    <PhasesTab workspace={workspace} onApply={apply} onError={setError} />
                  </motion.div>
                )}

                {estimateSubTab === "takeoff" && (
                  <motion.div key="takeoff" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.12 }} className="flex-1 min-h-0 flex flex-col">
                    <TakeoffTab workspace={workspace} />
                  </motion.div>
                )}

                {estimateSubTab === "schedule" && (
                  <motion.div key="schedule" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.12 }} className="flex-1 min-h-0 flex flex-col">
                    <ScheduleTab workspace={workspace} apply={apply} />
                  </motion.div>
                )}
              </AnimatePresence>
            </motion.div>
          )}

          {tab === "summarize" && (
            <motion.div key="summarize" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.15 }} className="flex-1 min-h-0 flex flex-col">
              <SummarizeTab workspace={workspace} onApply={apply} />
            </motion.div>
          )}
          {tab === "documents" && (
            <motion.div key="documents" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.15 }} className="flex-1 min-h-0 flex flex-col">
              <DocumentationTab workspace={workspace} apply={apply} packages={data.packages} highlightDocumentId={searchHighlight && "documentId" in searchHighlight ? searchHighlight.documentId : undefined} />
            </motion.div>
          )}
          {tab === "activity" && (
            <motion.div key="activity" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.15 }} className="flex-1 min-h-0 flex flex-col">
              <ActivityTab workspace={workspace} jobs={data.jobs} workspaceState={data.workspaceState} />
            </motion.div>
          )}
        </AnimatePresence>
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
        onImport={(file, mapping) => {
          startTransition(async () => {
            try {
              const preview = await importPreview(workspace.project.id, file);
              const result = await importProcess(workspace.project.id, {
                fileId: preview.fileId,
                worksheetId: (workspace.worksheets ?? [])[0]?.id ?? "",
                mapping,
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
        message="Rewrite the estimator notes using AI? This will replace the current notes."
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


      <PdfStudio projectId={workspace.project.id} open={modal === "pdf"} onClose={closeModal} />

      <RevisionCompare workspace={workspace} open={modal === "compare"} onClose={closeModal} />

      <AgentChat
        projectId={workspace.project.id}
        open={chatOpen}
        onClose={() => setChatOpen(false)}
        autoStartIntake={autoIntake}
        onIntakeStarted={() => setAutoIntake(false)}
        onWorkspaceMutated={refreshWorkspace}
      />

      <AnimatePresence>
      {pluginToolsOpen && (
      <PluginToolsPanel
        projectId={workspace.project.id}
        revisionId={workspace.currentRevision.id}
        worksheetId={selectedWsId === "all" ? undefined : selectedWsId}
        open={pluginToolsOpen}
        onClose={() => setPluginToolsOpen(false)}
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
  );
}

/* ─── Helper to build rev draft ─── */

function buildRevDraftFromWs(workspace: ProjectWorkspaceData) {
  const r = workspace.currentRevision;
  return {
    title: r.title, description: r.description, notes: r.notes,
    breakoutStyle: r.breakoutStyle, phaseWorksheetEnabled: r.phaseWorksheetEnabled ?? false,
    useCalculatedTotal: r.useCalculatedTotal,
  };
}

/* ─── Action Menu Components ─── */

function MenuSection({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <>
      <div className="px-3 py-1 text-[10px] font-medium uppercase text-fg/30">{label}</div>
      {children}
      <div className="h-px bg-line mx-2 my-1" />
    </>
  );
}

function MenuItem({ children, onClick, className }: { children: React.ReactNode; onClick: () => void; className?: string }) {
  return (
    <button onClick={onClick} className={cn("block w-full px-3 py-1.5 text-left transition-colors hover:bg-panel2", className)}>
      {children}
    </button>
  );
}

/* ─── Phases Tab ─── */

function PhasesTab({ workspace, onApply, onError }: { workspace: ProjectWorkspaceData; onApply: (n: WorkspaceResponse) => void; onError: (m: string) => void }) {
  const [isPending, startTransition] = useTransition();
  const phases = workspace.phases ?? [];

  function addPhase() {
    startTransition(async () => {
      try { onApply(await createPhase(workspace.project.id, {})); }
      catch (e) { onError(e instanceof Error ? e.message : "Failed"); }
    });
  }

  function savePhase(phaseId: string, patch: { number?: string; name?: string; description?: string }) {
    startTransition(async () => {
      try { onApply(await updatePhase(workspace.project.id, phaseId, patch)); }
      catch (e) { onError(e instanceof Error ? e.message : "Failed"); }
    });
  }

  function removePhase(phaseId: string) {
    startTransition(async () => {
      try { onApply(await deletePhase(workspace.project.id, phaseId)); }
      catch (e) { onError(e instanceof Error ? e.message : "Failed"); }
    });
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle>Phases</CardTitle>
          <Button size="xs" onClick={addPhase} disabled={isPending}><Plus className="h-3 w-3" /> Add phase</Button>
        </div>
      </CardHeader>
      <CardBody>
        {phases.length === 0 ? <EmptyState>No phases defined</EmptyState> : (
          <div className="overflow-x-auto rounded-lg border border-line">
            <table className="w-full text-sm">
              <thead className="bg-panel2/60 text-[11px] font-medium uppercase text-fg/35">
                <tr>
                  <th className="border-b border-line px-3 py-2 text-left w-20">Number</th>
                  <th className="border-b border-line px-3 py-2 text-left">Name</th>
                  <th className="border-b border-line px-3 py-2 text-left">Description</th>
                  <th className="border-b border-line px-3 py-2 w-16"></th>
                </tr>
              </thead>
              <tbody>
                {phases.map((phase) => (
                  <PhaseRow key={phase.id} phase={phase} onSave={savePhase} onDelete={removePhase} isPending={isPending} />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardBody>
    </Card>
  );
}

function PhaseRow({ phase, onSave, onDelete, isPending }: {
  phase: { id: string; number: string; name: string; description: string };
  onSave: (id: string, patch: { number?: string; name?: string; description?: string }) => void;
  onDelete: (id: string) => void;
  isPending: boolean;
}) {
  const [num, setNum] = useState(phase.number);
  const [name, setName] = useState(phase.name);
  const [desc, setDesc] = useState(phase.description);

  useEffect(() => { setNum(phase.number); setName(phase.name); setDesc(phase.description); }, [phase.number, phase.name, phase.description]);

  function handleBlur(field: "number" | "name" | "description", value: string) {
    const original = field === "number" ? phase.number : field === "name" ? phase.name : phase.description;
    if (value !== original) onSave(phase.id, { [field]: value });
  }

  return (
    <tr>
      <td className="border-b border-line px-1 py-1">
        <Input className="h-8" value={num} onChange={(e) => setNum(e.target.value)} onBlur={() => handleBlur("number", num)} />
      </td>
      <td className="border-b border-line px-1 py-1">
        <Input className="h-8" value={name} onChange={(e) => setName(e.target.value)} onBlur={() => handleBlur("name", name)} />
      </td>
      <td className="border-b border-line px-1 py-1">
        <Input className="h-8" value={desc} onChange={(e) => setDesc(e.target.value)} onBlur={() => handleBlur("description", desc)} />
      </td>
      <td className="border-b border-line px-1 py-1 text-center">
        <Button size="xs" variant="ghost" onClick={() => onDelete(phase.id)} disabled={isPending}>
          <Trash2 className="h-3 w-3 text-danger" />
        </Button>
      </td>
    </tr>
  );
}

/* ─── Estimate Tab ─── */

function EstimateTab({
  workspace, selectedWsId, setSelectedWsId, visibleRows, searchTerm, setSearchTerm,
  itemDraft, setItemDraft, openItemEditor, openCreateItem, wsNameDraft, setWsNameDraft,
  onCreateWs, onRenameWs, onDeleteWs,
  saveItem, deleteItem, duplicateItem, isPending,
}: {
  workspace: ProjectWorkspaceData; selectedWsId: string; setSelectedWsId: (v: string) => void;
  visibleRows: WorkspaceWorksheetItem[]; searchTerm: string; setSearchTerm: (v: string) => void;
  itemDraft: ItemDraft | null; setItemDraft: (v: ItemDraft | null | ((c: ItemDraft | null) => ItemDraft | null)) => void;
  openItemEditor: (ws: WorkspaceWorksheet, item: WorkspaceWorksheetItem) => void;
  openCreateItem: (ws: WorkspaceWorksheet) => void;
  wsNameDraft: string; setWsNameDraft: (v: string) => void;
  onCreateWs: () => void; onRenameWs: () => void; onDeleteWs: () => void;
  saveItem: () => void; deleteItem: () => void; duplicateItem: () => void; isPending: boolean;
}) {
  const breakout = workspace.estimate.totals.breakout;
  const currentWs = selectedWsId === "all" ? null : findWs(workspace, selectedWsId);

  return (
    <div className="grid gap-5 xl:grid-cols-[1fr_340px]">
      <div className="space-y-4">
        <div className="flex items-center gap-2 flex-wrap">
          <Select className="w-48" value={selectedWsId} onChange={(e) => setSelectedWsId(e.target.value)}>
            <option value="all">All worksheets</option>
            {(workspace.worksheets ?? []).map((ws) => <option key={ws.id} value={ws.id}>{ws.name} ({ws.items.length})</option>)}
          </Select>
          <Input className="flex-1 min-w-[200px]" placeholder="Filter..." value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} />
          <Button size="sm" variant="secondary" onClick={onCreateWs}><Plus className="h-3 w-3" /> Worksheet</Button>
          {currentWs && (
            <>
              <Button size="xs" variant="ghost" onClick={onRenameWs}>Rename</Button>
              <Button size="xs" variant="ghost" className="text-danger" onClick={onDeleteWs} disabled={(workspace.worksheets ?? []).length <= 1}>Delete</Button>
              <Button size="sm" onClick={() => openCreateItem(currentWs)}><Plus className="h-3 w-3" /> Line item</Button>
            </>
          )}
        </div>

        <div className="overflow-x-auto rounded-lg border border-line">
          <table className="w-full text-sm">
            <thead className="bg-panel2/60 text-[11px] font-medium uppercase text-fg/35">
              <tr>
                <th className="whitespace-nowrap border-b border-line px-3 py-2 text-left">#</th>
                <th className="whitespace-nowrap border-b border-line px-3 py-2 text-left">Item</th>
                <th className="whitespace-nowrap border-b border-line px-3 py-2 text-left">Category</th>
                <th className="whitespace-nowrap border-b border-line px-3 py-2 text-right">Qty</th>
                <th className="whitespace-nowrap border-b border-line px-3 py-2 text-right">Cost</th>
                <th className="whitespace-nowrap border-b border-line px-3 py-2 text-right">Markup</th>
                <th className="whitespace-nowrap border-b border-line px-3 py-2 text-right">Price</th>
                <th className="whitespace-nowrap border-b border-line px-3 py-2 text-right">Hours</th>
              </tr>
            </thead>
            <tbody>
              {visibleRows.map((row) => {
                const ws = (workspace.worksheets ?? []).find((w) => w.id === row.worksheetId)!;
                const active = itemDraft?.itemId === row.id;
                return (
                  <tr key={row.id} className={cn("cursor-pointer transition-colors hover:bg-panel2/40", active && "bg-accent/8")} onClick={() => openItemEditor(ws, row)}>
                    <td className="border-b border-line px-3 py-2.5 text-fg/40">{row.lineOrder}</td>
                    <td className="border-b border-line px-3 py-2.5">
                      <div className="font-medium">{row.entityName}</div>
                      {row.description && <div className="mt-0.5 text-[11px] text-fg/40 line-clamp-1">{row.description}</div>}
                      {selectedWsId === "all" && <div className="mt-0.5 text-[10px] text-fg/25">{ws.name}</div>}
                    </td>
                    <td className="border-b border-line px-3 py-2.5"><Badge>{row.category}</Badge></td>
                    <td className="border-b border-line px-3 py-2.5 text-right tabular-nums">{row.quantity.toLocaleString()}</td>
                    <td className="border-b border-line px-3 py-2.5 text-right tabular-nums">{formatMoney(row.cost)}</td>
                    <td className="border-b border-line px-3 py-2.5 text-right tabular-nums">{formatPercent(row.markup, 1)}</td>
                    <td className="border-b border-line px-3 py-2.5 text-right tabular-nums font-medium">{formatMoney(row.price)}</td>
                    <td className="border-b border-line px-3 py-2.5 text-right tabular-nums">{(row.laborHourReg + row.laborHourOver + row.laborHourDouble).toLocaleString()}</td>
                  </tr>
                );
              })}
              {visibleRows.length === 0 && <tr><td colSpan={8} className="px-3 py-6 text-center text-xs text-fg/30">No line items</td></tr>}
            </tbody>
            <tfoot className="bg-panel2/40 text-xs font-medium">
              <tr>
                <td colSpan={4} className="border-t border-line px-3 py-2 text-fg/50">{visibleRows.length} items</td>
                <td className="border-t border-line px-3 py-2 text-right tabular-nums">{formatMoney(workspace.estimate.totals.cost)}</td>
                <td className="border-t border-line px-3 py-2 text-right tabular-nums">{formatPercent(workspace.estimate.totals.estimatedMargin, 1)}</td>
                <td className="border-t border-line px-3 py-2 text-right tabular-nums">{formatMoney(workspace.estimate.totals.subtotal)}</td>
                <td className="border-t border-line px-3 py-2 text-right tabular-nums">{workspace.estimate.totals.totalHours.toLocaleString()}</td>
              </tr>
            </tfoot>
          </table>
        </div>

        {breakout.length > 0 && (
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {breakout.map((b) => (
              <div key={`${b.name}-${b.type ?? ""}`} className="rounded-lg border border-line bg-panel2/30 p-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs text-fg/40">{b.name}</span>
                  <span className="text-[11px] text-fg/30">{formatPercent(b.margin, 0)}</span>
                </div>
                <div className="mt-1 text-sm font-medium">{formatMoney(b.value)}</div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Line item editor sidebar */}
      <Card className="h-fit">
        <CardHeader>
          <CardTitle>{itemDraft?.mode === "create" ? "New line item" : itemDraft ? "Edit line item" : "Line item editor"}</CardTitle>
        </CardHeader>
        <CardBody className="space-y-3">
          {itemDraft ? (
            <>
              <div className="grid gap-3 grid-cols-2">
                <div><Label>Worksheet</Label><Select value={itemDraft.worksheetId} onChange={(e) => setItemDraft((c) => c ? { ...c, worksheetId: e.target.value } : c)}>
                  {(workspace.worksheets ?? []).map((ws) => <option key={ws.id} value={ws.id}>{ws.name}</option>)}
                </Select></div>
                <div><Label>Phase</Label><Select value={itemDraft.phaseId} onChange={(e) => setItemDraft((c) => c ? { ...c, phaseId: e.target.value } : c)}>
                  <option value="">None</option>
                  {(workspace.phases ?? []).map((p) => <option key={p.id} value={p.id}>{p.number} – {p.name}</option>)}
                </Select></div>
              </div>
              <div><Label>Name</Label><Input value={itemDraft.entityName} onChange={(e) => setItemDraft((c) => c ? { ...c, entityName: e.target.value } : c)} /></div>
              <div><Label>Description</Label><Textarea value={itemDraft.description} onChange={(e) => setItemDraft((c) => c ? { ...c, description: e.target.value } : c)} className="min-h-14" /></div>
              <div className="grid gap-3 grid-cols-2">
                <div><Label>Category</Label><Select value={itemDraft.category} onChange={(e) => setItemDraft((c) => c ? { ...c, category: e.target.value } : c)}>
                  {["Labour","Equipment","Stock Items","Material","Consumables","Other Charges","Travel & Per Diem","Subcontractors","Rental Equipment"].map((cat) => <option key={cat} value={cat}>{cat}</option>)}
                </Select></div>
                <div><Label>Entity type</Label><Input value={itemDraft.entityType} onChange={(e) => setItemDraft((c) => c ? { ...c, entityType: e.target.value } : c)} /></div>
              </div>
              <div className="grid gap-3 grid-cols-2">
                <div><Label>Vendor</Label><Input value={itemDraft.vendor} onChange={(e) => setItemDraft((c) => c ? { ...c, vendor: e.target.value } : c)} /></div>
                <div><Label>UOM</Label><Select value={itemDraft.uom} onChange={(e) => setItemDraft((c) => c ? { ...c, uom: e.target.value } : c)}>
                  {["EA","LF","FT","SF","HR","DAY","WK","MO","LS","CY","LB","TON","GAL","SET","LOT","IN","M","CM"].map((u) => <option key={u} value={u}>{u}</option>)}
                </Select></div>
              </div>
              <Separator />
              <div className="grid gap-3 grid-cols-3">
                <div><Label>Quantity</Label><Input type="number" step="0.01" value={String(itemDraft.quantity)} onChange={(e) => setItemDraft((c) => c ? { ...c, quantity: parseNum(e.target.value) } : c)} /></div>
                <div><Label>Cost</Label><Input type="number" step="0.01" value={String(itemDraft.cost)} onChange={(e) => setItemDraft((c) => c ? { ...c, cost: parseNum(e.target.value) } : c)} /></div>
                <div><Label>Price</Label><Input type="number" step="0.01" value={String(itemDraft.price)} onChange={(e) => setItemDraft((c) => c ? { ...c, price: parseNum(e.target.value) } : c)} /></div>
              </div>
              <div className="grid gap-3 grid-cols-2">
                <div><Label>Markup %</Label><Input type="number" step="0.1" value={fmtPct(itemDraft.markup)} onChange={(e) => setItemDraft((c) => c ? { ...c, markup: parseNum(e.target.value) / 100 } : c)} /></div>
                <div><Label>Line order</Label><Input type="number" step="1" value={String(itemDraft.lineOrder)} onChange={(e) => setItemDraft((c) => c ? { ...c, lineOrder: Math.max(1, Math.round(parseNum(e.target.value))) } : c)} /></div>
              </div>
              <div className="grid gap-3 grid-cols-3">
                <div><Label>Unit 1</Label><Input type="number" step="0.01" value={String(itemDraft.laborHourReg)} onChange={(e) => setItemDraft((c) => c ? { ...c, laborHourReg: parseNum(e.target.value) } : c)} /></div>
                <div><Label>Unit 2</Label><Input type="number" step="0.01" value={String(itemDraft.laborHourOver)} onChange={(e) => setItemDraft((c) => c ? { ...c, laborHourOver: parseNum(e.target.value) } : c)} /></div>
                <div><Label>Unit 3</Label><Input type="number" step="0.01" value={String(itemDraft.laborHourDouble)} onChange={(e) => setItemDraft((c) => c ? { ...c, laborHourDouble: parseNum(e.target.value) } : c)} /></div>
              </div>
              <Separator />
              <div className="flex gap-2">
                <Button size="sm" onClick={saveItem} disabled={isPending} className="flex-1"><Save className="h-3 w-3" /> {itemDraft.mode === "create" ? "Create" : "Save"}</Button>
                {itemDraft.mode === "edit" && (
                  <>
                    <Button size="sm" variant="secondary" onClick={duplicateItem} disabled={isPending}><Copy className="h-3 w-3" /></Button>
                    <Button size="sm" variant="danger" onClick={deleteItem} disabled={isPending}><Trash2 className="h-3 w-3" /></Button>
                  </>
                )}
                <Button size="sm" variant="ghost" onClick={() => setItemDraft(null)}>Cancel</Button>
              </div>
            </>
          ) : (
            <EmptyState>Select a row to edit</EmptyState>
          )}
        </CardBody>
      </Card>
    </div>
  );
}

/* ─── Activity Tab ─── */
function ActivityTab({ workspace, jobs, workspaceState }: { workspace: ProjectWorkspaceData; jobs: JobRecord[]; workspaceState: WorkspaceStateRecord | null }) {
  return (
    <div className="space-y-5">
      <div className="grid gap-5 lg:grid-cols-2">
        <Card>
          <CardHeader><div className="flex items-center justify-between"><CardTitle>Jobs</CardTitle><Badge>{jobs.length}</Badge></div></CardHeader>
          <CardBody className="space-y-2">
            {jobs.length === 0 ? <EmptyState>No jobs</EmptyState> : jobs.map((job) => (
              <div key={job.id} className="rounded-lg border border-line bg-panel2/40 p-3">
                <div className="flex items-center justify-between"><span className="text-sm font-medium">{job.kind.replaceAll("_", " ")}</span><Badge tone={statusTone(job.status)}>{job.status}</Badge></div>
                <Progress value={Math.round(job.progress * 100)} className="mt-2" />
                <div className="mt-1 text-[11px] text-fg/30">{formatDateTime(job.updatedAt)}</div>
                {job.error && <div className="mt-1 text-[11px] text-danger">{job.error}</div>}
              </div>
            ))}
          </CardBody>
        </Card>
        <Card>
          <CardHeader><CardTitle>Workspace state</CardTitle></CardHeader>
          <CardBody className="space-y-3">
            <div className="grid grid-cols-2 gap-2">
              <Stat label="Revision" value={`Rev ${workspace.currentRevision.revisionNumber}`} />
              <Stat label="Updated" value={formatDateTime(workspace.currentRevision.updatedAt)} />
            </div>
          </CardBody>
        </Card>
      </div>
      <AIReviewQueue runs={workspace.aiRuns} citations={workspace.citations} />
    </div>
  );
}

/* ─── Shared ─── */
function Stat({ label, value }: { label: string; value: string }) {
  return (<div className="rounded-lg bg-panel2/40 px-3 py-2"><div className="text-[11px] text-fg/35">{label}</div><div className="mt-0.5 text-sm font-medium">{value}</div></div>);
}
