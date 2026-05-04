"use client";

import { Suspense, useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useSearchParams } from "next/navigation";
import { AnimatePresence, motion } from "motion/react";
import {
  ArrowRight,
  BookOpen,
  Boxes,
  ChevronDown,
  ChevronRight,
  Database,
  FileSpreadsheet,
  Gauge,
  Home,
  Layers,
  Library,
  ListTree,
  Plus,
  RefreshCw,
  Search,
  Table2,
  Trash2,
  X,
} from "lucide-react";

import { AssemblyManager } from "@/components/assembly-manager";
import { EstimatingPlaybooksManager } from "@/components/estimating-playbooks-manager";
import { ItemsManager } from "@/components/items-manager";
import { KnowledgePage } from "@/components/knowledge-page";
import { CostIntelligencePanel } from "@/components/cost-intelligence-panel";
import { RateScheduleManager } from "@/components/rate-schedule-manager";
import { Badge, Button, CompactSelect, Input, Toggle } from "@/components/ui";
import { cn } from "@/lib/utils";
import {
  getCostIntelligenceSummary,
  listEffectiveCosts,
  listCostObservations,
  listCostResources,
  createLaborUnit,
  createLaborUnitLibrary,
  deleteLaborUnit,
  deleteLaborUnitLibrary,
  listLaborUnitLibraries,
  listLaborUnitTree,
  listLaborUnits,
  updateLaborUnit,
  updateLaborUnitLibrary,
  type AssemblySummaryRecord,
  type CatalogSummary,
  type CostIntelligenceSummaryRecord,
  type DatasetRecord,
  type EffectiveCostRecord,
  type EstimatorPersona,
  type KnowledgeBookRecord,
  type KnowledgeDocumentRecord,
  type KnowledgeLibraryCabinetRecord,
  type LaborUnitLibraryRecord,
  type LaborUnitRecord,
  type LaborUnitTreeGroupRecord,
  type CostObservationRecord,
  type RateSchedule,
  type CostResourceRecord,
} from "@/lib/api";

type LibrarySurface =
  | "overview"
  | "cost"
  | "resources"
  | "labor_units"
  | "playbooks"
  | "assemblies"
  | "rates"
  | "knowledge";

type LibraryPageProps = {
  catalogs: CatalogSummary[];
  rateSchedules: RateSchedule[];
  assemblies: AssemblySummaryRecord[];
  knowledgeBooks: KnowledgeBookRecord[];
  knowledgeDocuments: KnowledgeDocumentRecord[];
  knowledgeCabinets: KnowledgeLibraryCabinetRecord[];
  datasets: DatasetRecord[];
  laborUnitLibraries: LaborUnitLibraryRecord[];
  playbooks: EstimatorPersona[];
};

const surfaceOptions = [
  {
    id: "overview",
    label: "Home",
    icon: Home,
    description: "A launch surface for library work and live coverage.",
  },
  {
    id: "cost",
    label: "Cost Intelligence",
    icon: Database,
    description: "Dynamic cost database for resources, observations, vendor products, and cost basis rows.",
  },
  {
    id: "resources",
    label: "Resources",
    icon: Boxes,
    description: "Catalogued labour, material, equipment, subcontractor, consumable, and allowance resources.",
  },
  {
    id: "labor_units",
    label: "Labor Units",
    icon: Gauge,
    description: "Production standards for hours per installed unit, linked to labor resources and rate books.",
  },
  {
    id: "playbooks",
    label: "Estimators",
    icon: BookOpen,
    description: "Estimator behavior, methodology, source bindings, and commercial policy.",
  },
  {
    id: "assemblies",
    label: "Assemblies",
    icon: Layers,
    description: "Parameterized estimating recipes that expand into priced resource lines.",
  },
  {
    id: "rates",
    label: "Rate Books",
    icon: FileSpreadsheet,
    description: "Reusable labour, equipment, burden, tiered rates, and schedule pricing logic.",
  },
  {
    id: "knowledge",
    label: "Knowledge",
    icon: BookOpen,
    description: "Reference books, datasets, extracted evidence, and agent retrieval material.",
  },
] as const satisfies readonly { id: LibrarySurface; label: string; description: string; icon: typeof Gauge }[];

function coerceSurface(value: string | null): LibrarySurface {
  return surfaceOptions.some((surface) => surface.id === value) ? (value as LibrarySurface) : "overview";
}

function totalCatalogItems(catalogs: CatalogSummary[]) {
  return catalogs.reduce((sum, catalog) => sum + (catalog.itemCount ?? catalog.items?.length ?? 0), 0);
}

function totalRateItems(schedules: RateSchedule[]) {
  return schedules.reduce((sum, schedule) => sum + (schedule.items?.length ?? 0), 0);
}

function totalAssemblyComponents(assemblies: AssemblySummaryRecord[]) {
  return assemblies.reduce((sum, assembly) => sum + assembly.componentCount, 0);
}

function formatPercent(value: number) {
  if (!Number.isFinite(value)) return "0%";
  return `${Math.round(Math.max(0, Math.min(1, value)) * 100)}%`;
}

function compactCount(value: number) {
  return new Intl.NumberFormat("en-US", { notation: value >= 10000 ? "compact" : "standard" }).format(value);
}

function formatNumber(value: number, digits = 2) {
  if (!Number.isFinite(value)) return "0";
  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits: digits,
    minimumFractionDigits: Number.isInteger(value) ? 0 : Math.min(2, digits),
  }).format(value);
}

function uniqueCount(values: Array<string | null | undefined>) {
  return new Set(values.map((value) => value?.trim()).filter(Boolean)).size;
}

function average(values: number[]) {
  const finite = values.filter((value) => Number.isFinite(value));
  if (finite.length === 0) return 0;
  return finite.reduce((sum, value) => sum + value, 0) / finite.length;
}

const emptyCostSummary: CostIntelligenceSummaryRecord = {
  resources: 0,
  observations: 0,
  effectiveCosts: 0,
  vendors: 0,
};

function useCostIntelligenceSnapshot() {
  const [resources, setResources] = useState<CostResourceRecord[]>([]);
  const [observations, setObservations] = useState<CostObservationRecord[]>([]);
  const [effectiveCosts, setEffectiveCosts] = useState<EffectiveCostRecord[]>([]);
  const [summary, setSummary] = useState<CostIntelligenceSummaryRecord>(emptyCostSummary);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [nextSummary, nextResources, nextObservations, nextCosts] = await Promise.all([
        getCostIntelligenceSummary(),
        listCostResources({ limit: 250 }),
        listCostObservations({ limit: 250 }),
        listEffectiveCosts({ limit: 250 }),
      ]);
      setSummary(nextSummary);
      setResources(nextResources);
      setObservations(nextObservations);
      setEffectiveCosts(nextCosts);
    } catch {
      setSummary(emptyCostSummary);
      setResources([]);
      setObservations([]);
      setEffectiveCosts([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { resources, observations, effectiveCosts, summary, loading, refresh };
}

function SurfaceButton({
  active,
  count,
  icon: Icon,
  label,
  onClick,
}: {
  active: boolean;
  count?: number;
  icon: typeof Gauge;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "inline-flex h-8 shrink-0 items-center justify-center gap-1.5 rounded-lg px-3 text-xs font-medium transition-colors",
        active ? "bg-fg text-bg shadow-sm" : "text-fg/52 hover:bg-panel2/75 hover:text-fg",
      )}
    >
      <Icon className="h-3.5 w-3.5" />
      <span>{label}</span>
      {typeof count === "number" && (
        <span className={cn("rounded px-1 text-[10px]", active ? "bg-bg/15 text-bg" : "bg-panel2 text-fg/40")}>
          {compactCount(count)}
        </span>
      )}
    </button>
  );
}

type LibraryTone = "accent" | "success" | "warning" | "neutral" | "info";

const launchToneClasses: Record<
  LibraryTone,
  { accent: string; icon: string; progress: string; hover: string; rail: string; wash: string }
> = {
  accent: {
    accent: "text-accent",
    icon: "border-accent/25 bg-accent/10 text-accent",
    progress: "bg-accent",
    hover: "hover:border-accent/45",
    rail: "bg-accent",
    wash: "bg-accent/5",
  },
  success: {
    accent: "text-success",
    icon: "border-success/25 bg-success/10 text-success",
    progress: "bg-success",
    hover: "hover:border-success/45",
    rail: "bg-success",
    wash: "bg-success/5",
  },
  warning: {
    accent: "text-warning",
    icon: "border-warning/25 bg-warning/10 text-warning",
    progress: "bg-warning",
    hover: "hover:border-warning/45",
    rail: "bg-warning",
    wash: "bg-warning/5",
  },
  info: {
    accent: "text-[#0b7a75]",
    icon: "border-[#0b7a75]/25 bg-[#0b7a75]/10 text-[#0b7a75]",
    progress: "bg-[#0b7a75]",
    hover: "hover:border-[#0b7a75]/45",
    rail: "bg-[#0b7a75]",
    wash: "bg-[#0b7a75]/5",
  },
  neutral: {
    accent: "text-fg/60",
    icon: "border-line bg-panel2/75 text-fg/60",
    progress: "bg-fg/45",
    hover: "hover:border-fg/25",
    rail: "bg-fg/45",
    wash: "bg-panel2/45",
  },
};

function progressBadge(value: number) {
  if (value >= 0.72) return { label: "Strong", tone: "success" as const };
  if (value >= 0.35) return { label: "Growing", tone: "info" as const };
  return { label: "Needs data", tone: "warning" as const };
}

function ProgressMeter({ value, tone }: { value: number; tone: LibraryTone }) {
  const clamped = Math.max(0, Math.min(1, value));
  return (
    <div className="h-1.5 overflow-hidden rounded-full bg-panel2">
      <div className={cn("h-full rounded-full", launchToneClasses[tone].progress)} style={{ width: `${clamped * 100}%` }} />
    </div>
  );
}

function SurfaceLaunchCard({
  body,
  detail,
  icon: Icon,
  metric,
  metricLabel,
  onClick,
  progress,
  stats,
  title,
  tone,
}: {
  body: string;
  detail: string;
  icon: typeof Gauge;
  metric: string;
  metricLabel: string;
  onClick: () => void;
  progress: number;
  stats: Array<{ label: string; value: string }>;
  title: string;
  tone: LibraryTone;
}) {
  const classes = launchToneClasses[tone];
  const status = progressBadge(progress);

  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "group relative flex min-h-[236px] min-w-0 flex-col overflow-hidden rounded-lg border border-line bg-panel p-3 text-left shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:shadow-[0_18px_48px_hsl(var(--fg)/0.10)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/35",
        classes.hover,
      )}
    >
      <div className={cn("pointer-events-none absolute inset-0 opacity-0 transition-opacity duration-200 group-hover:opacity-100", classes.wash)} />
      <div className={cn("absolute inset-x-0 top-0 h-1", classes.rail)} />

      <div className="relative flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-2.5">
          <div className={cn("flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border shadow-[inset_0_1px_0_hsl(var(--fg)/0.08)]", classes.icon)}>
            <Icon className="h-[18px] w-[18px]" />
          </div>
          <div className="min-w-0 pt-0.5">
            <div className="min-w-0">
              <div className="truncate text-sm font-semibold text-fg">{title}</div>
              <Badge tone={status.tone} className="mt-1 shrink-0 whitespace-nowrap">{status.label}</Badge>
            </div>
            <div className="mt-1 line-clamp-2 text-xs leading-relaxed text-fg/50">{body}</div>
          </div>
        </div>
        <ArrowRight className="mt-1 h-4 w-4 shrink-0 text-fg/25 transition-all group-hover:translate-x-0.5 group-hover:text-fg/60" />
      </div>

      <div className="relative mt-3">
        <div className={cn("text-[10px] font-semibold uppercase tracking-wider", classes.accent)}>{metricLabel}</div>
        <div className="mt-1 flex min-w-0 items-end justify-between gap-3">
          <span className="truncate text-3xl font-semibold leading-none tracking-normal tabular-nums text-fg">{metric}</span>
          <div className="mb-1 hidden shrink-0 items-center gap-1.5 text-[11px] text-fg/40 sm:flex">
            <span className={cn("h-2 w-2 rounded-sm", classes.rail)} />
            <span className="truncate">{formatPercent(progress)}</span>
          </div>
        </div>
      </div>

      <div className="relative mt-3">
        <ProgressMeter value={progress} tone={tone} />
        <div className="mt-2 truncate text-[11px] text-fg/40">{detail}</div>
      </div>

      <div className="relative mt-auto grid grid-cols-3 divide-x divide-line/60 border-y border-line/60">
        {stats.map((stat) => (
          <div key={stat.label} className="min-w-0 px-1.5 py-1.5">
            <div className="truncate text-[10px] font-medium uppercase tracking-wider text-fg/35">{stat.label}</div>
            <div className="mt-0.5 truncate text-xs font-semibold tabular-nums text-fg/75">{stat.value}</div>
          </div>
        ))}
      </div>
    </button>
  );
}

function LibraryOverview({
  assemblies,
  catalogs,
  datasets,
  effectiveCosts,
  costSummary,
  knowledgeBooks,
  knowledgeDocuments,
  laborUnitLibraries,
  observations,
  onSurfaceChange,
  playbooks,
  rateSchedules,
  resources,
}: {
  assemblies: AssemblySummaryRecord[];
  catalogs: CatalogSummary[];
  datasets: DatasetRecord[];
  effectiveCosts: EffectiveCostRecord[];
  costSummary: CostIntelligenceSummaryRecord;
  knowledgeBooks: KnowledgeBookRecord[];
  knowledgeDocuments: KnowledgeDocumentRecord[];
  laborUnitLibraries: LaborUnitLibraryRecord[];
  observations: CostObservationRecord[];
  onSurfaceChange: (surface: LibrarySurface) => void;
  playbooks: EstimatorPersona[];
  rateSchedules: RateSchedule[];
  resources: CostResourceRecord[];
}) {
  const itemCount = totalCatalogItems(catalogs);
  const rateItemCount = totalRateItems(rateSchedules);
  const laborUnitCount = laborUnitLibraries.reduce((sum, library) => sum + (library.unitCount ?? 0), 0);
  const activePlaybookCount = playbooks.filter((playbook) => playbook.enabled !== false).length;
  const playbookBindingCount = playbooks.reduce(
    (sum, playbook) => sum + (playbook.knowledgeBookIds?.length ?? 0) + (playbook.knowledgeDocumentIds?.length ?? 0) + (playbook.datasetTags?.length ?? 0),
    0,
  );
  const assemblyComponentCount = totalAssemblyComponents(assemblies);
  const vendorCount = costSummary.vendors || uniqueCount(observations.map((observation) => observation.vendorName));
  const resourceCount = costSummary.resources || resources.length;
  const observationCount = costSummary.observations || observations.length;
  const effectiveCostCount = costSummary.effectiveCosts || effectiveCosts.length;
  const pricedResourceRatio = resourceCount > 0 ? effectiveCostCount / resourceCount : effectiveCostCount > 0 ? 1 : 0;
  const assemblyCompleteness = assemblies.length > 0
    ? assemblies.filter((assembly) => assembly.componentCount > 0).length / assemblies.length
    : 0;
  const catalogDensity = catalogs.length > 0 ? Math.min(1, itemCount / Math.max(1, catalogs.length * 25)) : 0;
  const evidenceDepth = resourceCount > 0 ? Math.min(1, observationCount / Math.max(1, resourceCount * 2)) : 0;
  const knowledgeDepth = Math.min(1, (knowledgeBooks.length + knowledgeDocuments.length + datasets.length) / 15);
  const rateBookDepth = rateSchedules.length > 0 ? Math.min(1, rateItemCount / Math.max(1, rateSchedules.length * 12)) : 0;
  const laborUnitDepth = laborUnitLibraries.length > 0 ? Math.min(1, laborUnitCount / Math.max(1, laborUnitLibraries.length * 80)) : 0;
  const parametricAssemblyCount = assemblies.filter((assembly) => assembly.parameterCount > 0).length;
  const autoRateCount = rateSchedules.filter((schedule) => schedule.autoCalculate).length;
  const knowledgeReferenceCount = knowledgeBooks.length + knowledgeDocuments.length;
  const knowledgeRowCount = datasets.reduce((sum, dataset) => sum + dataset.rowCount, 0);
  const emptyCatalogCount = catalogs.filter((catalog) => (catalog.itemCount ?? catalog.items?.length ?? 0) === 0).length;
  const emptyAssemblyCount = assemblies.filter((assembly) => assembly.componentCount === 0).length;

  const launchCards = [
    {
      surface: "cost" as LibrarySurface,
      title: "Cost Intelligence",
      body: "Observed vendor prices, current cost basis rows, and the evidence trail behind them.",
      metric: compactCount(effectiveCostCount),
      metricLabel: "Cost basis rows",
      detail: `${compactCount(observationCount)} observations from ${vendorCount || 0} vendors`,
      icon: Database,
      tone: "success" as LibraryTone,
      progress: average([pricedResourceRatio, evidenceDepth]),
      stats: [
        { label: "Resources", value: compactCount(resourceCount) },
        { label: "Obs.", value: compactCount(observationCount) },
        { label: "Vendors", value: compactCount(vendorCount) },
      ],
    },
    {
      surface: "resources" as LibrarySurface,
      title: "Resources",
      body: "Catalogs subdivide estimating resources into the buckets used by worksheets, rate books, and assemblies.",
      metric: compactCount(itemCount),
      metricLabel: "Catalog items",
      detail: `${catalogs.length} catalogs with ${compactCount(itemCount)} catalog rows`,
      icon: Boxes,
      tone: "accent" as LibraryTone,
      progress: catalogDensity,
      stats: [
        { label: "Catalogs", value: compactCount(catalogs.length) },
        { label: "Rows", value: compactCount(itemCount) },
        { label: "Filled", value: compactCount(Math.max(0, catalogs.length - emptyCatalogCount)) },
      ],
    },
    {
      surface: "labor_units" as LibrarySurface,
      title: "Labor Units",
      body: "First-party production standards that turn installed quantities into labor hours, then price those hours through rate books.",
      metric: compactCount(laborUnitCount),
      metricLabel: "Production rows",
      detail: `${laborUnitLibraries.length} catalogs across ${uniqueCount(laborUnitLibraries.map((library) => library.provider))} providers`,
      icon: Gauge,
      tone: "info" as LibraryTone,
      progress: laborUnitDepth,
      stats: [
        { label: "Catalogs", value: compactCount(laborUnitLibraries.length) },
        { label: "Providers", value: compactCount(uniqueCount(laborUnitLibraries.map((library) => library.provider))) },
        { label: "1st Party", value: compactCount(laborUnitLibraries.filter((library) => !library.organizationId).length) },
      ],
    },
    {
      surface: "playbooks" as LibrarySurface,
      title: "Estimators",
      body: "Reusable estimating behavior with methodology, source priority, commercial policy, and review guidance.",
      metric: compactCount(activePlaybookCount),
      metricLabel: "Active estimators",
      detail: `${compactCount(playbookBindingCount)} source bindings across ${playbooks.length} estimators`,
      icon: BookOpen,
      tone: "info" as LibraryTone,
      progress: playbooks.length > 0 ? Math.min(1, playbookBindingCount / Math.max(1, playbooks.length * 3)) : 0,
      stats: [
        { label: "Total", value: compactCount(playbooks.length) },
        { label: "Active", value: compactCount(activePlaybookCount) },
        { label: "Bindings", value: compactCount(playbookBindingCount) },
      ],
    },
    {
      surface: "assemblies" as LibrarySurface,
      title: "Assemblies",
      body: "Reusable estimating recipes for crews, materials, equipment, and nested scopes.",
      metric: compactCount(assemblies.length),
      metricLabel: "Assemblies",
      detail: `${compactCount(assemblyComponentCount)} components across ${assemblies.length} assemblies`,
      icon: Layers,
      tone: "warning" as LibraryTone,
      progress: assemblyCompleteness,
      stats: [
        { label: "Comps", value: compactCount(assemblyComponentCount) },
        { label: "Params", value: compactCount(parametricAssemblyCount) },
        { label: "Empty", value: compactCount(emptyAssemblyCount) },
      ],
    },
    {
      surface: "rates" as LibrarySurface,
      title: "Rate Books",
      body: "Reusable labour, equipment, burden, tiered rates, and schedule pricing logic.",
      metric: compactCount(rateItemCount),
      metricLabel: "Rate items",
      detail: `${rateSchedules.length} books with ${autoRateCount} auto-calc schedules`,
      icon: FileSpreadsheet,
      tone: "neutral" as LibraryTone,
      progress: rateBookDepth,
      stats: [
        { label: "Books", value: compactCount(rateSchedules.length) },
        { label: "Items", value: compactCount(rateItemCount) },
        { label: "Auto", value: compactCount(autoRateCount) },
      ],
    },
    {
      surface: "knowledge" as LibrarySurface,
      title: "Knowledge",
      body: "Books, datasets, tables, extracted evidence, and agent reference material.",
      metric: compactCount(knowledgeReferenceCount + datasets.length),
      metricLabel: "References",
      detail: `${compactCount(knowledgeRowCount)} dataset rows across ${datasets.length} datasets`,
      icon: BookOpen,
      tone: "accent" as LibraryTone,
      progress: knowledgeDepth,
      stats: [
        { label: "Docs", value: compactCount(knowledgeReferenceCount) },
        { label: "Data", value: compactCount(datasets.length) },
        { label: "Rows", value: compactCount(knowledgeRowCount) },
      ],
    },
  ];

  return (
    <section className="flex h-full min-h-0 flex-col overflow-hidden rounded-lg border border-line bg-panel">
      <div className="flex shrink-0 items-center justify-between gap-3 border-b border-line px-3 py-2">
        <div className="min-w-0">
          <div className="text-xs font-semibold text-fg">Library Workspaces</div>
          <div className="mt-0.5 truncate text-[11px] text-fg/45">Open a workspace from live library coverage</div>
        </div>
        <Badge tone="info" className="lg:hidden">{launchCards.length}</Badge>
      </div>

      <div className="min-h-0 flex-1 overflow-hidden p-3">
        <div className="grid h-full min-h-0 auto-rows-[minmax(236px,auto)] gap-3 overflow-y-auto overflow-x-hidden pb-4 pr-1 md:grid-cols-2 lg:grid-cols-4">
          {launchCards.map((card) => (
            <SurfaceLaunchCard
              key={card.surface}
              body={card.body}
              detail={card.detail}
              icon={card.icon}
              metric={card.metric}
              metricLabel={card.metricLabel}
              onClick={() => onSurfaceChange(card.surface)}
              progress={card.progress}
              stats={card.stats}
              title={card.title}
              tone={card.tone}
            />
          ))}
        </div>
      </div>
    </section>
  );
}

type LaborUnitFormState = {
  catalogId: string;
  code: string;
  name: string;
  description: string;
  discipline: string;
  category: string;
  className: string;
  subClassName: string;
  outputUom: string;
  hoursNormal: string;
  hoursDifficult: string;
  hoursVeryDifficult: string;
  defaultDifficulty: LaborUnitRecord["defaultDifficulty"];
  entityCategoryType: string;
  tags: string;
};

type LaborUnitCatalogFormState = {
  name: string;
  provider: string;
  discipline: string;
  description: string;
  sourceDescription: string;
  tags: string;
};

const allLaborUnitCatalogsValue = "__all_labor_unit_catalogs__";

type LaborUnitsViewMode = "grouped" | "rows";

function emptyLaborUnitForm(catalogId = ""): LaborUnitFormState {
  return {
    catalogId,
    code: "",
    name: "",
    description: "",
    discipline: "",
    category: "",
    className: "",
    subClassName: "",
    outputUom: "EA",
    hoursNormal: "0",
    hoursDifficult: "",
    hoursVeryDifficult: "",
    defaultDifficulty: "normal",
    entityCategoryType: "Labour",
    tags: "",
  };
}

function laborUnitFormFromRecord(unit: LaborUnitRecord): LaborUnitFormState {
  return {
    catalogId: unit.libraryId,
    code: unit.code ?? "",
    name: unit.name ?? "",
    description: unit.description ?? "",
    discipline: unit.discipline ?? "",
    category: unit.category ?? "",
    className: unit.className ?? "",
    subClassName: unit.subClassName ?? "",
    outputUom: unit.outputUom || "EA",
    hoursNormal: String(unit.hoursNormal ?? 0),
    hoursDifficult: unit.hoursDifficult == null ? "" : String(unit.hoursDifficult),
    hoursVeryDifficult: unit.hoursVeryDifficult == null ? "" : String(unit.hoursVeryDifficult),
    defaultDifficulty: unit.defaultDifficulty ?? "normal",
    entityCategoryType: unit.entityCategoryType || "Labour",
    tags: unit.tags?.join(", ") ?? "",
  };
}

function emptyLaborUnitCatalogForm(): LaborUnitCatalogFormState {
  return {
    name: "",
    provider: "Internal",
    discipline: "General",
    description: "",
    sourceDescription: "",
    tags: "",
  };
}

function laborUnitCatalogFormFromRecord(catalog: LaborUnitLibraryRecord): LaborUnitCatalogFormState {
  return {
    name: catalog.name ?? "",
    provider: catalog.provider || "Internal",
    discipline: catalog.discipline || "General",
    description: catalog.description ?? "",
    sourceDescription: catalog.sourceDescription ?? "",
    tags: catalog.tags?.join(", ") ?? "",
  };
}

function splitTags(value: string) {
  return value
    .split(",")
    .map((tag) => tag.trim())
    .filter(Boolean);
}

function optionalNumber(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : Number.NaN;
}

type LaborUnitGroupLevel = LaborUnitTreeGroupRecord["level"];

type LaborUnitTreePayload = {
  nodes: LaborUnitTreeGroupRecord[];
  units: LaborUnitRecord[];
  total: number;
  loading?: boolean;
};

type LaborUnitVisibleTreeRow =
  | { kind: "group"; group: LaborUnitTreeGroupRecord; depth: number }
  | { kind: "unit"; unit: LaborUnitRecord; depth: number }
  | { kind: "loading"; id: string; depth: number }
  | { kind: "empty"; id: string; depth: number };

const laborUnitRootTreeKey = "__labor_unit_tree_root__";

const laborUnitGroupLabels: Record<LaborUnitGroupLevel, string> = {
  catalog: "Catalog",
  category: "Category",
  class: "Class",
  subclass: "Subclass",
};

const laborUnitGroupAccent = ["#0b7a75", "#a15c00", "#2563eb", "#64748b"];

function childKeyForLaborUnitGroup(group: LaborUnitTreeGroupRecord) {
  return group.id;
}

function parentTypeForLaborUnitGroup(group: LaborUnitTreeGroupRecord): "catalog" | "category" | "class" | "subclass" {
  return group.level;
}

function LaborUnitGroupRow({
  group,
  depth,
  expandedGroupIds,
  onToggleGroup,
}: {
  group: LaborUnitTreeGroupRecord;
  depth: number;
  expandedGroupIds: Set<string>;
  onToggleGroup: (group: LaborUnitTreeGroupRecord) => void;
}) {
  const expanded = expandedGroupIds.has(group.id);
  const averageNormal = group.unitCount > 0 ? group.normalHoursTotal / group.unitCount : 0;
  const accent = laborUnitGroupAccent[depth] ?? laborUnitGroupAccent[laborUnitGroupAccent.length - 1];
  const rowTone = [
    "bg-panel2/55 hover:bg-panel2/75",
    "bg-panel2/35 hover:bg-panel2/55",
    "bg-panel2/20 hover:bg-panel2/40",
    "bg-bg/55 hover:bg-panel2/25",
  ][depth] ?? "bg-bg/55 hover:bg-panel2/25";

  return (
    <tr className={cn("border-b border-line/55 transition-colors", rowTone)} style={{ borderLeft: `3px solid ${accent}` }}>
      <td colSpan={9} className="p-0">
        <button
          type="button"
          aria-expanded={expanded}
          onClick={() => onToggleGroup(group)}
          className="flex min-h-9 w-full min-w-0 items-center gap-2 px-2 py-1.5 text-left outline-none transition-colors focus-visible:bg-panel2/60 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent/30"
        >
          <span className="shrink-0" style={{ width: depth * 18 }} />
          <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md border border-line/70 bg-panel/65 text-fg/45 shadow-[inset_0_1px_0_hsl(var(--fg)/0.05)]">
            {expanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
          </span>
          <span className="min-w-0 flex-1">
            <span className="flex min-w-0 items-center gap-2">
              <span className="truncate text-xs font-semibold text-fg">{group.label}</span>
              <span className="hidden shrink-0 rounded border border-line/60 bg-bg/45 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-fg/35 sm:inline-flex">
                {laborUnitGroupLabels[group.level]}
              </span>
            </span>
            <span className="mt-0.5 flex min-w-0 items-center gap-2 text-[10px] text-fg/38">
              <span>{compactCount(group.unitCount)} row{group.unitCount === 1 ? "" : "s"}</span>
              <span className="h-1 w-1 rounded-full bg-fg/20" />
              <span>avg {formatNumber(averageNormal)} hrs</span>
            </span>
          </span>
          <span className="hidden shrink-0 text-[11px] text-fg/42 md:block">
            {group.level === "subclass" ? "items" : "sections"}
          </span>
        </button>
      </td>
    </tr>
  );
}

function flattenLaborUnitTreeRows(
  nodes: LaborUnitTreeGroupRecord[],
  treePayloadByParent: Record<string, LaborUnitTreePayload>,
  expandedGroupIds: Set<string>,
  depth = 0,
): LaborUnitVisibleTreeRow[] {
  const rows: LaborUnitVisibleTreeRow[] = [];
  for (const group of nodes) {
    rows.push({ kind: "group", group, depth });
    if (!expandedGroupIds.has(group.id)) continue;

    const childPayload = treePayloadByParent[childKeyForLaborUnitGroup(group)];
    if (!childPayload || childPayload.loading) {
      rows.push({ kind: "loading", id: `${group.id}:loading`, depth: depth + 1 });
      continue;
    }

    if (group.level === "subclass") {
      if (childPayload.units.length === 0) {
        rows.push({ kind: "empty", id: `${group.id}:empty`, depth: depth + 1 });
      } else {
        for (const unit of childPayload.units) {
          rows.push({ kind: "unit", unit, depth: depth + 1 });
        }
      }
      continue;
    }

    if (childPayload.nodes.length === 0) {
      rows.push({ kind: "empty", id: `${group.id}:empty`, depth: depth + 1 });
    } else {
      rows.push(...flattenLaborUnitTreeRows(childPayload.nodes, treePayloadByParent, expandedGroupIds, depth + 1));
    }
  }
  return rows;
}

function LaborUnitsWorkspace({ initialLibraries }: { initialLibraries: LaborUnitLibraryRecord[] }) {
  const [catalogs, setCatalogs] = useState<LaborUnitLibraryRecord[]>(initialLibraries);
  const [selectedCatalogId, setSelectedCatalogId] = useState(allLaborUnitCatalogsValue);
  const [units, setUnits] = useState<LaborUnitRecord[]>([]);
  const [total, setTotal] = useState(0);
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(100);
  const [viewMode, setViewMode] = useState<LaborUnitsViewMode>("grouped");
  const [expandedGroupIds, setExpandedGroupIds] = useState<Set<string>>(() => new Set());
  const [treePayloadByParent, setTreePayloadByParent] = useState<Record<string, LaborUnitTreePayload>>({});
  const [loading, setLoading] = useState(false);
  const [unitDrawerMode, setUnitDrawerMode] = useState<"create" | "edit" | null>(null);
  const [activeUnit, setActiveUnit] = useState<LaborUnitRecord | null>(null);
  const [unitForm, setUnitForm] = useState<LaborUnitFormState>(() => emptyLaborUnitForm());
  const [catalogDrawerOpen, setCatalogDrawerOpen] = useState(false);
  const [editingCatalogId, setEditingCatalogId] = useState<string | null>(null);
  const [catalogForm, setCatalogForm] = useState<LaborUnitCatalogFormState>(() => emptyLaborUnitCatalogForm());
  const [drawerError, setDrawerError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setCatalogs(initialLibraries);
    setSelectedCatalogId((current) =>
      current === allLaborUnitCatalogsValue || initialLibraries.some((catalog) => catalog.id === current)
        ? current
        : allLaborUnitCatalogsValue,
    );
  }, [initialLibraries]);

  const catalogById = useMemo(() => new Map(catalogs.map((catalog) => [catalog.id, catalog])), [catalogs]);
  const selectedCatalog = selectedCatalogId === allLaborUnitCatalogsValue ? null : catalogById.get(selectedCatalogId) ?? null;
  const firstCatalog = catalogs[0] ?? null;
  const selectedEditableCatalog = selectedCatalog ?? firstCatalog;
  const providers = uniqueCount(catalogs.map((catalog) => catalog.provider));
  const firstPartyCatalogs = catalogs.filter((catalog) => !catalog.organizationId).length;
  const totalCatalogRows = catalogs.reduce((sum, catalog) => sum + (catalog.unitCount ?? 0), 0);
  const groupedView = viewMode === "grouped";
  const rootTreePayload = treePayloadByParent[laborUnitRootTreeKey];
  const visibleTreeRows = useMemo(
    () => flattenLaborUnitTreeRows(rootTreePayload?.nodes ?? [], treePayloadByParent, expandedGroupIds),
    [expandedGroupIds, rootTreePayload?.nodes, treePayloadByParent],
  );
  const visibleRowsTotal = groupedView ? visibleTreeRows.length : total;
  const totalPages = Math.max(1, Math.ceil(visibleRowsTotal / pageSize));
  const pageStart = visibleRowsTotal === 0 ? 0 : page * pageSize + 1;
  const pageEnd = Math.min(visibleRowsTotal, (page + 1) * pageSize);
  const pagedTreeRows = groupedView ? visibleTreeRows.slice(page * pageSize, (page + 1) * pageSize) : [];
  const visibleGroups = visibleTreeRows.filter((row): row is Extract<LaborUnitVisibleTreeRow, { kind: "group" }> => row.kind === "group");
  const rootNormalHoursTotal = rootTreePayload?.nodes.reduce((sum, node) => sum + node.normalHoursTotal, 0) ?? 0;
  const averageHours = groupedView && total > 0 ? rootNormalHoursTotal / total : average(units.map((unit) => unit.hoursNormal));
  const categories = groupedView ? visibleGroups.filter((row) => row.group.level === "category").length : uniqueCount(units.map((unit) => unit.category));
  const classes = groupedView ? visibleGroups.filter((row) => row.group.level === "class").length : uniqueCount(units.map((unit) => unit.className));

  const refreshCatalogs = useCallback(async (nextSelectedId?: string) => {
    const rows = await listLaborUnitLibraries();
    setCatalogs(rows);
    setSelectedCatalogId((current) => {
      if (nextSelectedId) return nextSelectedId;
      return current === allLaborUnitCatalogsValue || rows.some((catalog) => catalog.id === current)
        ? current
        : allLaborUnitCatalogsValue;
    });
  }, []);

  const refreshUnits = useCallback(async () => {
    if (groupedView) return;
    setLoading(true);
    try {
      const filter = {
        libraryId: selectedCatalogId === allLaborUnitCatalogsValue ? undefined : selectedCatalogId,
        q: query,
      };
      const result = await listLaborUnits({
        ...filter,
        limit: pageSize,
        offset: page * pageSize,
      });
      setUnits(result.units);
      setTotal(result.total);
    } finally {
      setLoading(false);
    }
  }, [groupedView, page, pageSize, query, selectedCatalogId]);

  const loadTreePayload = useCallback(async (parentKey: string, group?: LaborUnitTreeGroupRecord) => {
    setTreePayloadByParent((current) => ({
      ...current,
      [parentKey]: {
        nodes: current[parentKey]?.nodes ?? [],
        units: current[parentKey]?.units ?? [],
        total: current[parentKey]?.total ?? 0,
        loading: true,
      },
    }));
    try {
      const result = await listLaborUnitTree({
        parentType: group ? parentTypeForLaborUnitGroup(group) : "root",
        libraryId: group?.libraryId ?? (selectedCatalogId === allLaborUnitCatalogsValue ? undefined : selectedCatalogId),
        q: query,
        category: group?.level === "category" || group?.level === "class" || group?.level === "subclass" ? group.category : undefined,
        className: group?.level === "class" || group?.level === "subclass" ? group.className : undefined,
        subClassName: group?.level === "subclass" ? group.subClassName : undefined,
        limit: 1000,
        offset: 0,
      });
      setTreePayloadByParent((current) => ({
        ...current,
        [parentKey]: { ...result, loading: false },
      }));
      if (!group) setTotal(result.nodes.reduce((sum, node) => sum + node.unitCount, 0));
    } catch {
      setTreePayloadByParent((current) => ({
        ...current,
        [parentKey]: { nodes: [], units: [], total: 0, loading: false },
      }));
    }
  }, [query, selectedCatalogId]);

  useEffect(() => {
    setPage(0);
  }, [pageSize, query, selectedCatalogId, viewMode]);

  useEffect(() => {
    setExpandedGroupIds(new Set());
    setTreePayloadByParent({});
  }, [query, selectedCatalogId, viewMode]);

  useEffect(() => {
    if (groupedView) void loadTreePayload(laborUnitRootTreeKey);
  }, [groupedView, loadTreePayload]);

  useEffect(() => {
    const lastPage = Math.max(0, Math.ceil(visibleRowsTotal / pageSize) - 1);
    if (page > lastPage) setPage(lastPage);
  }, [page, pageSize, visibleRowsTotal]);

  useEffect(() => {
    void refreshUnits();
  }, [refreshUnits]);

  const updateUnitForm = useCallback(<K extends keyof LaborUnitFormState,>(field: K, value: LaborUnitFormState[K]) => {
    setUnitForm((current) => ({ ...current, [field]: value }));
  }, []);

  const updateCatalogForm = useCallback(<K extends keyof LaborUnitCatalogFormState,>(field: K, value: LaborUnitCatalogFormState[K]) => {
    setCatalogForm((current) => ({ ...current, [field]: value }));
  }, []);

  const toggleGroup = useCallback((group: LaborUnitTreeGroupRecord) => {
    setExpandedGroupIds((current) => {
      const next = new Set(current);
      if (next.has(group.id)) {
        next.delete(group.id);
      } else {
        next.add(group.id);
      }
      return next;
    });
    const childKey = childKeyForLaborUnitGroup(group);
    if (!expandedGroupIds.has(group.id) && !treePayloadByParent[childKey]) {
      void loadTreePayload(childKey, group);
    }
  }, [expandedGroupIds, loadTreePayload, treePayloadByParent]);

  const expandAllGroups = useCallback(() => {
    const expandableGroups = pagedTreeRows
      .filter((row): row is Extract<LaborUnitVisibleTreeRow, { kind: "group" }> => row.kind === "group")
      .map((row) => row.group);
    setExpandedGroupIds((current) => {
      const next = new Set(current);
      for (const group of expandableGroups) next.add(group.id);
      return next;
    });
    for (const group of expandableGroups) {
      const childKey = childKeyForLaborUnitGroup(group);
      if (!treePayloadByParent[childKey]) void loadTreePayload(childKey, group);
    }
  }, [loadTreePayload, pagedTreeRows, treePayloadByParent]);

  const collapseAllGroups = useCallback(() => {
    setExpandedGroupIds(new Set());
  }, []);

  const refreshActiveLaborUnitView = useCallback(async (nextSelectedId?: string) => {
    await refreshCatalogs(nextSelectedId);
    if (groupedView) {
      setExpandedGroupIds(new Set());
      setTreePayloadByParent({});
      await loadTreePayload(laborUnitRootTreeKey);
    } else {
      await refreshUnits();
    }
  }, [groupedView, loadTreePayload, refreshCatalogs, refreshUnits]);

  const openCreateUnit = useCallback(() => {
    setActiveUnit(null);
    setDrawerError(null);
    setUnitForm(emptyLaborUnitForm(selectedEditableCatalog?.id ?? ""));
    setUnitDrawerMode("create");
  }, [selectedEditableCatalog?.id]);

  const openEditUnit = useCallback((unit: LaborUnitRecord) => {
    setActiveUnit(unit);
    setDrawerError(null);
    setUnitForm(laborUnitFormFromRecord(unit));
    setUnitDrawerMode("edit");
  }, []);

  const closeUnitDrawer = useCallback(() => {
    setUnitDrawerMode(null);
    setActiveUnit(null);
    setDrawerError(null);
  }, []);

  const openCatalogManager = useCallback(() => {
    const initialCatalog = selectedCatalog ?? firstCatalog;
    setEditingCatalogId(initialCatalog?.id ?? null);
    setCatalogForm(initialCatalog ? laborUnitCatalogFormFromRecord(initialCatalog) : emptyLaborUnitCatalogForm());
    setDrawerError(null);
    setCatalogDrawerOpen(true);
  }, [firstCatalog, selectedCatalog]);

  const closeCatalogDrawer = useCallback(() => {
    setCatalogDrawerOpen(false);
    setEditingCatalogId(null);
    setDrawerError(null);
  }, []);

  const selectCatalogForEdit = useCallback((catalog: LaborUnitLibraryRecord) => {
    setEditingCatalogId(catalog.id);
    setCatalogForm(laborUnitCatalogFormFromRecord(catalog));
    setDrawerError(null);
  }, []);

  const startNewCatalog = useCallback(() => {
    setEditingCatalogId(null);
    setCatalogForm(emptyLaborUnitCatalogForm());
    setDrawerError(null);
  }, []);

  const saveUnit = useCallback(async () => {
    const catalog = catalogById.get(unitForm.catalogId);
    if (!catalog) {
      setDrawerError("Choose a labor unit catalog before saving.");
      return;
    }
    const hoursNormal = Number(unitForm.hoursNormal);
    const hoursDifficult = optionalNumber(unitForm.hoursDifficult);
    const hoursVeryDifficult = optionalNumber(unitForm.hoursVeryDifficult);
    if (!unitForm.name.trim()) {
      setDrawerError("Labor unit name is required.");
      return;
    }
    if (!Number.isFinite(hoursNormal) || hoursNormal < 0) {
      setDrawerError("Normal hours must be a non-negative number.");
      return;
    }
    if (Number.isNaN(hoursDifficult) || Number.isNaN(hoursVeryDifficult)) {
      setDrawerError("Difficulty hours must be blank or a non-negative number.");
      return;
    }

    setSaving(true);
    setDrawerError(null);
    try {
      const payload = {
        code: unitForm.code.trim(),
        name: unitForm.name.trim(),
        description: unitForm.description.trim(),
        discipline: unitForm.discipline.trim(),
        category: unitForm.category.trim(),
        className: unitForm.className.trim(),
        subClassName: unitForm.subClassName.trim(),
        outputUom: unitForm.outputUom.trim() || "EA",
        hoursNormal,
        hoursDifficult,
        hoursVeryDifficult,
        defaultDifficulty: unitForm.defaultDifficulty,
        entityCategoryType: unitForm.entityCategoryType.trim() || "Labour",
        tags: splitTags(unitForm.tags),
      };
      if (unitDrawerMode === "edit" && activeUnit) {
        await updateLaborUnit(activeUnit.id, payload);
      } else {
        await createLaborUnit(unitForm.catalogId, payload);
      }
      await refreshActiveLaborUnitView();
      closeUnitDrawer();
    } catch (error: any) {
      setDrawerError(error?.message ?? "Failed to save labor unit.");
    } finally {
      setSaving(false);
    }
  }, [activeUnit, catalogById, closeUnitDrawer, refreshActiveLaborUnitView, unitDrawerMode, unitForm]);

  const deleteActiveUnit = useCallback(async () => {
    if (!activeUnit) return;
    if (!window.confirm(`Delete ${activeUnit.name}?`)) return;
    setSaving(true);
    setDrawerError(null);
    try {
      await deleteLaborUnit(activeUnit.id);
      await refreshActiveLaborUnitView();
      closeUnitDrawer();
    } catch (error: any) {
      setDrawerError(error?.message ?? "Failed to delete labor unit.");
    } finally {
      setSaving(false);
    }
  }, [activeUnit, closeUnitDrawer, refreshActiveLaborUnitView]);

  const saveCatalog = useCallback(async () => {
    if (!catalogForm.name.trim()) {
      setDrawerError("Catalog name is required.");
      return;
    }
    const editingCatalog = editingCatalogId ? catalogById.get(editingCatalogId) ?? null : null;
    setSaving(true);
    setDrawerError(null);
    try {
      const payload = {
        name: catalogForm.name.trim(),
        provider: catalogForm.provider.trim() || "Internal",
        discipline: catalogForm.discipline.trim() || "General",
        description: catalogForm.description.trim(),
        sourceDescription: catalogForm.sourceDescription.trim(),
        source: "manual" as const,
        tags: splitTags(catalogForm.tags),
      };
      const saved = editingCatalog
        ? await updateLaborUnitLibrary(editingCatalog.id, payload)
        : await createLaborUnitLibrary(payload);
      setEditingCatalogId(saved.id);
      setCatalogForm(laborUnitCatalogFormFromRecord(saved));
      await refreshActiveLaborUnitView(saved.id);
    } catch (error: any) {
      setDrawerError(error?.message ?? "Failed to save catalog.");
    } finally {
      setSaving(false);
    }
  }, [catalogById, catalogForm, editingCatalogId, refreshActiveLaborUnitView]);

  const deleteEditingCatalog = useCallback(async () => {
    const catalog = editingCatalogId ? catalogById.get(editingCatalogId) ?? null : null;
    if (!catalog) return;
    if (!window.confirm(`Delete ${catalog.name} and its labor units?`)) return;
    setSaving(true);
    setDrawerError(null);
    try {
      await deleteLaborUnitLibrary(catalog.id);
      startNewCatalog();
      await refreshActiveLaborUnitView(allLaborUnitCatalogsValue);
    } catch (error: any) {
      setDrawerError(error?.message ?? "Failed to delete catalog.");
    } finally {
      setSaving(false);
    }
  }, [catalogById, editingCatalogId, refreshActiveLaborUnitView, startNewCatalog]);

  const catalogOptions = useMemo(() => [
    { value: allLaborUnitCatalogsValue, label: `All catalogs (${compactCount(totalCatalogRows)})` },
    ...catalogs.map((catalog) => ({
      value: catalog.id,
      label: `${catalog.name} (${compactCount(catalog.unitCount ?? 0)})`,
    })),
  ], [catalogs, totalCatalogRows]);

  const drawer = (
    <AnimatePresence>
      {unitDrawerMode && (
        <>
          <motion.div
            key="labor-unit-drawer-backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-40 bg-black/20"
            onClick={closeUnitDrawer}
          />
          <motion.aside
            key="labor-unit-drawer"
            initial={{ x: "100%" }}
            animate={{ x: 0 }}
            exit={{ x: "100%" }}
            transition={{ type: "spring", damping: 30, stiffness: 300 }}
            className="fixed inset-y-0 right-0 z-50 flex w-[min(760px,calc(100vw-24px))] flex-col border-l border-line bg-panel shadow-2xl"
          >
            <div className="flex shrink-0 items-center justify-between gap-3 border-b border-line bg-panel2/35 px-5 py-4">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <Gauge className="h-4 w-4 text-accent" />
                  <h2 className="truncate text-sm font-semibold text-fg">
                    {unitDrawerMode === "create" ? "Create Labor Unit" : activeUnit?.name ?? "Labor Unit"}
                  </h2>
                </div>
                <p className="mt-0.5 truncate text-[11px] text-fg/45">
                  Edit the production standard used by assemblies and worksheets.
                </p>
              </div>
              <button
                type="button"
                onClick={closeUnitDrawer}
                className="rounded p-1.5 text-fg/45 transition-colors hover:bg-panel2/70 hover:text-fg"
                title="Close"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto p-5">
              {drawerError && (
                <div className="mb-4 rounded-md border border-danger/30 bg-danger/8 px-3 py-2 text-xs text-danger">{drawerError}</div>
              )}

              <div className="grid gap-4">
                  <div className="grid gap-3 md:grid-cols-[180px_minmax(0,1fr)]">
                    <label className="grid gap-1 text-[11px] font-medium text-fg/55">
                      Catalog
                      <CompactSelect
                        value={unitForm.catalogId}
                        onValueChange={(value) => updateUnitForm("catalogId", value)}
                        options={catalogs.map((catalog) => ({ value: catalog.id, label: catalog.name }))}
                        placeholder="Choose catalog"
                        disabled={unitDrawerMode === "edit"}
                      />
                    </label>
                    <label className="grid gap-1 text-[11px] font-medium text-fg/55">
                      Name
                      <Input value={unitForm.name} onChange={(event) => updateUnitForm("name", event.target.value)} className="h-8 text-xs" />
                    </label>
                  </div>

                  <div className="grid gap-3 md:grid-cols-3">
                    <label className="grid gap-1 text-[11px] font-medium text-fg/55">
                      Code
                      <Input value={unitForm.code} onChange={(event) => updateUnitForm("code", event.target.value)} className="h-8 text-xs" />
                    </label>
                    <label className="grid gap-1 text-[11px] font-medium text-fg/55">
                      Discipline
                      <Input value={unitForm.discipline} onChange={(event) => updateUnitForm("discipline", event.target.value)} className="h-8 text-xs" />
                    </label>
                    <label className="grid gap-1 text-[11px] font-medium text-fg/55">
                      Output UOM
                      <Input value={unitForm.outputUom} onChange={(event) => updateUnitForm("outputUom", event.target.value)} className="h-8 text-xs" />
                    </label>
                  </div>

                  <label className="grid gap-1 text-[11px] font-medium text-fg/55">
                    Description
                    <textarea
                      value={unitForm.description}
                      onChange={(event) => updateUnitForm("description", event.target.value)}
                      className="min-h-20 rounded-md border border-line bg-bg/45 px-3 py-2 text-xs text-fg outline-none transition-colors focus:border-accent/45"
                    />
                  </label>

                  <div className="grid gap-3 md:grid-cols-3">
                    <label className="grid gap-1 text-[11px] font-medium text-fg/55">
                      Category
                      <Input value={unitForm.category} onChange={(event) => updateUnitForm("category", event.target.value)} className="h-8 text-xs" />
                    </label>
                    <label className="grid gap-1 text-[11px] font-medium text-fg/55">
                      Class
                      <Input value={unitForm.className} onChange={(event) => updateUnitForm("className", event.target.value)} className="h-8 text-xs" />
                    </label>
                    <label className="grid gap-1 text-[11px] font-medium text-fg/55">
                      Subclass
                      <Input value={unitForm.subClassName} onChange={(event) => updateUnitForm("subClassName", event.target.value)} className="h-8 text-xs" />
                    </label>
                  </div>

                  <div className="grid gap-3 md:grid-cols-4">
                    <label className="grid gap-1 text-[11px] font-medium text-fg/55">
                      Normal Hrs
                      <Input value={unitForm.hoursNormal} onChange={(event) => updateUnitForm("hoursNormal", event.target.value)} className="h-8 text-xs" />
                    </label>
                    <label className="grid gap-1 text-[11px] font-medium text-fg/55">
                      Difficult Hrs
                      <Input value={unitForm.hoursDifficult} onChange={(event) => updateUnitForm("hoursDifficult", event.target.value)} className="h-8 text-xs" />
                    </label>
                    <label className="grid gap-1 text-[11px] font-medium text-fg/55">
                      Very Diff. Hrs
                      <Input value={unitForm.hoursVeryDifficult} onChange={(event) => updateUnitForm("hoursVeryDifficult", event.target.value)} className="h-8 text-xs" />
                    </label>
                    <label className="grid gap-1 text-[11px] font-medium text-fg/55">
                      Default
                      <CompactSelect
                        value={unitForm.defaultDifficulty}
                        onValueChange={(value) => updateUnitForm("defaultDifficulty", value as LaborUnitRecord["defaultDifficulty"])}
                        options={[
                          { value: "normal", label: "Normal" },
                          { value: "difficult", label: "Difficult" },
                          { value: "very_difficult", label: "Very Difficult" },
                        ]}
                      />
                    </label>
                  </div>

                  <label className="grid gap-1 text-[11px] font-medium text-fg/55">
                    Tags
                    <Input value={unitForm.tags} onChange={(event) => updateUnitForm("tags", event.target.value)} className="h-8 text-xs" placeholder="comma separated" />
                  </label>
                </div>
            </div>

            <div className="flex shrink-0 items-center justify-between gap-3 border-t border-line bg-panel2/25 px-5 py-3">
              <div>
                {unitDrawerMode === "edit" && (
                  <Button type="button" variant="danger" size="sm" onClick={() => void deleteActiveUnit()} disabled={saving}>
                    <Trash2 className="h-3.5 w-3.5" />
                    Delete
                  </Button>
                )}
              </div>
              <div className="flex items-center gap-2">
                <Button type="button" variant="ghost" size="sm" onClick={closeUnitDrawer} disabled={saving}>Cancel</Button>
                <Button type="button" size="sm" onClick={() => void saveUnit()} disabled={saving || !unitForm.catalogId}>
                  {saving ? "Saving" : "Save Labor Unit"}
                </Button>
              </div>
            </div>
          </motion.aside>
        </>
      )}

      {catalogDrawerOpen && (
        <>
          <motion.div
            key="labor-unit-catalog-drawer-backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-40 bg-black/20"
            onClick={closeCatalogDrawer}
          />
          <motion.aside
            key="labor-unit-catalog-drawer"
            initial={{ x: "100%" }}
            animate={{ x: 0 }}
            exit={{ x: "100%" }}
            transition={{ type: "spring", damping: 30, stiffness: 300 }}
            className="fixed inset-y-0 right-0 z-50 flex w-[min(960px,calc(100vw-24px))] flex-col border-l border-line bg-panel shadow-2xl"
          >
            <div className="flex shrink-0 items-center justify-between gap-3 border-b border-line bg-panel2/35 px-5 py-4">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <Library className="h-4 w-4 text-accent" />
                  <h2 className="truncate text-sm font-semibold text-fg">Labor Unit Catalogs</h2>
                </div>
                <p className="mt-0.5 truncate text-[11px] text-fg/45">Manage the source buckets for production standard rows.</p>
              </div>
              <button
                type="button"
                onClick={closeCatalogDrawer}
                className="rounded p-1.5 text-fg/45 transition-colors hover:bg-panel2/70 hover:text-fg"
                title="Close"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="grid min-h-0 flex-1 gap-0 overflow-hidden lg:grid-cols-[320px_minmax(0,1fr)]">
              <div className="min-h-0 overflow-y-auto border-r border-line p-3">
                <Button type="button" size="sm" className="mb-3 w-full" onClick={startNewCatalog}>
                  <Plus className="h-3.5 w-3.5" />
                  New Catalog
                </Button>
                <div className="space-y-2">
                  {catalogs.map((catalog) => {
                    const active = catalog.id === editingCatalogId;
                    return (
                      <button
                        key={catalog.id}
                        type="button"
                        onClick={() => selectCatalogForEdit(catalog)}
                        className={cn(
                          "w-full rounded-lg border px-3 py-2 text-left transition-colors",
                          active ? "border-accent/45 bg-accent/8" : "border-line bg-bg/35 hover:border-fg/20 hover:bg-panel2/40",
                        )}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <div className="truncate text-xs font-semibold text-fg">{catalog.name}</div>
                            <div className="mt-0.5 truncate text-[10px] text-fg/40">{catalog.provider || "Internal"} / {catalog.discipline || "General"}</div>
                          </div>
                          <Badge tone={catalog.organizationId ? "success" : "info"}>{catalog.organizationId ? "Org" : "First Party"}</Badge>
                        </div>
                        <div className="mt-2 flex items-center justify-between gap-2 text-[11px] text-fg/45">
                          <span>{compactCount(catalog.unitCount ?? 0)} units</span>
                          <span>{catalog.source || "manual"}</span>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="min-h-0 overflow-y-auto p-5">
                {drawerError && (
                  <div className="mb-4 rounded-md border border-danger/30 bg-danger/8 px-3 py-2 text-xs text-danger">{drawerError}</div>
                )}

                <div className="grid gap-4">
                    <div className="grid gap-3 md:grid-cols-2">
                      <label className="grid gap-1 text-[11px] font-medium text-fg/55">
                        Name
                        <Input value={catalogForm.name} onChange={(event) => updateCatalogForm("name", event.target.value)} className="h-8 text-xs" />
                      </label>
                      <label className="grid gap-1 text-[11px] font-medium text-fg/55">
                        Provider
                        <Input value={catalogForm.provider} onChange={(event) => updateCatalogForm("provider", event.target.value)} className="h-8 text-xs" />
                      </label>
                    </div>
                    <div className="grid gap-3 md:grid-cols-2">
                      <label className="grid gap-1 text-[11px] font-medium text-fg/55">
                        Discipline
                        <Input value={catalogForm.discipline} onChange={(event) => updateCatalogForm("discipline", event.target.value)} className="h-8 text-xs" />
                      </label>
                      <label className="grid gap-1 text-[11px] font-medium text-fg/55">
                        Tags
                        <Input value={catalogForm.tags} onChange={(event) => updateCatalogForm("tags", event.target.value)} className="h-8 text-xs" placeholder="comma separated" />
                      </label>
                    </div>
                    <label className="grid gap-1 text-[11px] font-medium text-fg/55">
                      Description
                      <textarea
                        value={catalogForm.description}
                        onChange={(event) => updateCatalogForm("description", event.target.value)}
                        className="min-h-24 rounded-md border border-line bg-bg/45 px-3 py-2 text-xs text-fg outline-none transition-colors focus:border-accent/45"
                      />
                    </label>
                    <label className="grid gap-1 text-[11px] font-medium text-fg/55">
                      Source Note
                      <Input value={catalogForm.sourceDescription} onChange={(event) => updateCatalogForm("sourceDescription", event.target.value)} className="h-8 text-xs" />
                    </label>
                </div>
              </div>
            </div>

            <div className="flex shrink-0 items-center justify-between gap-3 border-t border-line bg-panel2/25 px-5 py-3">
              <div>
                {editingCatalogId && (
                  <Button type="button" variant="danger" size="sm" onClick={() => void deleteEditingCatalog()} disabled={saving}>
                    <Trash2 className="h-3.5 w-3.5" />
                    Delete
                  </Button>
                )}
              </div>
              <div className="flex items-center gap-2">
                <Button type="button" variant="ghost" size="sm" onClick={closeCatalogDrawer} disabled={saving}>Close</Button>
                <Button type="button" size="sm" onClick={() => void saveCatalog()} disabled={saving}>
                  {saving ? "Saving" : editingCatalogId ? "Save Catalog" : "Create Catalog"}
                </Button>
              </div>
            </div>
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  );

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-lg border border-line bg-panel">
      <div className="shrink-0 border-b border-line px-3 py-2">
        <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold text-fg">Labor Units</div>
            <div className="mt-0.5 truncate text-[11px] text-fg/45">
              {selectedCatalog ? selectedCatalog.name : "All catalogs"} / {compactCount(total)} production standards
            </div>
          </div>
          <div className="hidden shrink-0 grid-cols-5 gap-2 xl:grid">
            {[
              { label: "Rows", value: compactCount(total) },
              { label: "Catalogs", value: compactCount(catalogs.length) },
              { label: "Providers", value: compactCount(providers) },
              { label: "Categories", value: compactCount(categories) },
              { label: "Avg Hrs", value: formatNumber(averageHours) },
            ].map((stat) => (
              <div key={stat.label} className="min-w-20 rounded-md border border-line/65 bg-bg/35 px-2 py-1.5">
                <div className="truncate text-[10px] text-fg/35">{stat.label}</div>
                <div className="truncate text-xs font-semibold tabular-nums text-fg">{stat.value}</div>
              </div>
            ))}
          </div>
        </div>

        <div className="mt-2 flex min-w-0 flex-wrap items-center gap-2">
          <div className="min-w-[240px] flex-1 md:max-w-[360px]">
            <CompactSelect
              value={selectedCatalogId}
              onValueChange={setSelectedCatalogId}
              options={catalogOptions}
              ariaLabel="Labor unit catalog"
            />
          </div>
          <div className="relative min-w-[220px] flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-fg/30" />
            <Input
              className="h-8 pl-8 text-xs"
              placeholder="Search code, class, category, or description"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </div>
          <div className="flex shrink-0 items-center gap-2 rounded-lg border border-line bg-bg/35 px-2 py-1.5">
            <Table2 className={cn("h-3.5 w-3.5", groupedView ? "text-fg/30" : "text-fg/70")} />
            <Toggle checked={groupedView} onChange={(checked) => setViewMode(checked ? "grouped" : "rows")} />
            <ListTree className={cn("h-3.5 w-3.5", groupedView ? "text-accent" : "text-fg/30")} />
            <span className="hidden text-[11px] font-medium text-fg/45 sm:inline">
              {groupedView ? "Groups" : "Rows"}
            </span>
          </div>
          {groupedView && (
            <div className="flex shrink-0 items-center gap-1">
              <Button type="button" variant="ghost" size="sm" onClick={collapseAllGroups} disabled={loading || expandedGroupIds.size === 0}>
                <ChevronRight className="h-3.5 w-3.5" />
                Collapse
              </Button>
              <Button type="button" variant="ghost" size="sm" onClick={expandAllGroups} disabled={loading || !pagedTreeRows.some((row) => row.kind === "group")}>
                <ChevronDown className="h-3.5 w-3.5" />
                Expand
              </Button>
            </div>
          )}
          <Button type="button" variant="secondary" size="sm" onClick={openCatalogManager}>
            Manage Catalogs
          </Button>
          <Button type="button" size="sm" onClick={openCreateUnit} disabled={!selectedEditableCatalog}>
            <Plus className="h-3.5 w-3.5" />
            New Labor Unit
          </Button>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden">
        <table className="w-full table-fixed text-left text-xs">
          <colgroup>
            <col className="w-[8%]" />
            <col className="w-[27%]" />
            <col className="w-[15%]" />
            <col className="w-[13%]" />
            <col className="w-[18%]" />
            <col className="w-[6%]" />
            <col className="w-[5%]" />
            <col className="w-[5%]" />
            <col className="w-[3%]" />
          </colgroup>
          <thead className="sticky top-0 z-10 bg-panel text-[10px] uppercase tracking-wide text-fg/35">
            <tr className="border-b border-line">
              <th className="px-2 py-2 font-medium">Code</th>
              <th className="px-2 py-2 font-medium">Labor Unit</th>
              <th className="px-2 py-2 font-medium">Catalog</th>
              <th className="px-2 py-2 font-medium">Category</th>
              <th className="px-2 py-2 font-medium">Class</th>
              <th className="px-2 py-2 text-right font-medium">Normal</th>
              <th className="px-2 py-2 text-right font-medium">Diff.</th>
              <th className="px-2 py-2 text-right font-medium">V. Diff.</th>
              <th className="px-2 py-2 font-medium">UOM</th>
            </tr>
          </thead>
          <tbody>
            {groupedView
              ? pagedTreeRows.map((row) => {
                  if (row.kind === "group") {
                    return (
                      <LaborUnitGroupRow
                        key={row.group.id}
                        group={row.group}
                        depth={row.depth}
                        expandedGroupIds={expandedGroupIds}
                        onToggleGroup={toggleGroup}
                      />
                    );
                  }
                  if (row.kind === "loading" || row.kind === "empty") {
                    return (
                      <tr key={row.id} className="border-b border-line/55 bg-bg/35">
                        <td colSpan={9} className="px-2 py-2 text-[11px] text-fg/38">
                          <div className="flex items-center gap-2" style={{ paddingLeft: row.depth * 18 }}>
                            <span className="h-px w-5 bg-line" />
                            {row.kind === "loading" ? "Loading branch..." : "No rows in this branch."}
                          </div>
                        </td>
                      </tr>
                    );
                  }
                  const unit = row.unit;
                  const catalog = catalogById.get(unit.libraryId);
                  return (
                    <tr
                      key={unit.id}
                      tabIndex={0}
                      onClick={() => openEditUnit(unit)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" || event.key === " ") openEditUnit(unit);
                      }}
                      className="cursor-pointer border-b border-line/55 bg-bg/40 outline-none transition-colors hover:bg-panel2/35 focus:bg-panel2/45"
                    >
                      <td className="px-2 py-2 font-mono text-[11px] text-fg/55"><div className="truncate">{unit.code || "-"}</div></td>
                      <td className="px-2 py-2">
                        <div className="flex min-w-0 items-start gap-2" style={{ paddingLeft: row.depth * 18 }}>
                          <span className="mt-1.5 h-px w-5 shrink-0 bg-line" />
                          <div className="min-w-0">
                            <div className="truncate font-medium text-fg">{unit.name}</div>
                            {unit.description && <div className="mt-0.5 truncate text-[11px] text-fg/40">{unit.description}</div>}
                          </div>
                        </div>
                      </td>
                      <td className="px-2 py-2 text-fg/55">
                        <div className="truncate">{catalog?.name ?? "Unknown"}</div>
                      </td>
                      <td className="px-2 py-2 text-fg/55"><div className="truncate">{unit.category || "-"}</div></td>
                      <td className="px-2 py-2 text-fg/55">
                        <div className="truncate">{[unit.className, unit.subClassName].filter(Boolean).join(" / ") || "-"}</div>
                      </td>
                      <td className="px-2 py-2 text-right font-mono text-fg/70">{formatNumber(unit.hoursNormal)}</td>
                      <td className="px-2 py-2 text-right font-mono text-fg/55">{unit.hoursDifficult == null ? "-" : formatNumber(unit.hoursDifficult)}</td>
                      <td className="px-2 py-2 text-right font-mono text-fg/55">{unit.hoursVeryDifficult == null ? "-" : formatNumber(unit.hoursVeryDifficult)}</td>
                      <td className="px-2 py-2 text-fg/55"><div className="truncate">{unit.outputUom || "EA"}</div></td>
                    </tr>
                  );
                })
              : units.map((unit) => {
                  const catalog = catalogById.get(unit.libraryId);
                  return (
                    <tr
                      key={unit.id}
                      tabIndex={0}
                      onClick={() => openEditUnit(unit)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" || event.key === " ") openEditUnit(unit);
                      }}
                      className="cursor-pointer border-b border-line/55 outline-none hover:bg-panel2/35 focus:bg-panel2/45"
                    >
                      <td className="px-2 py-2 font-mono text-[11px] text-fg/55"><div className="truncate">{unit.code || "-"}</div></td>
                      <td className="px-2 py-2">
                        <div className="truncate font-medium text-fg">{unit.name}</div>
                        {unit.description && <div className="mt-0.5 truncate text-[11px] text-fg/40">{unit.description}</div>}
                      </td>
                      <td className="px-2 py-2 text-fg/55">
                        <div className="truncate">{catalog?.name ?? "Unknown"}</div>
                      </td>
                      <td className="px-2 py-2 text-fg/55"><div className="truncate">{unit.category || "-"}</div></td>
                      <td className="px-2 py-2 text-fg/55">
                        <div className="truncate">{[unit.className, unit.subClassName].filter(Boolean).join(" / ") || "-"}</div>
                      </td>
                      <td className="px-2 py-2 text-right font-mono text-fg/70">{formatNumber(unit.hoursNormal)}</td>
                      <td className="px-2 py-2 text-right font-mono text-fg/55">{unit.hoursDifficult == null ? "-" : formatNumber(unit.hoursDifficult)}</td>
                      <td className="px-2 py-2 text-right font-mono text-fg/55">{unit.hoursVeryDifficult == null ? "-" : formatNumber(unit.hoursVeryDifficult)}</td>
                      <td className="px-2 py-2 text-fg/55"><div className="truncate">{unit.outputUom || "EA"}</div></td>
                    </tr>
                  );
                })}
            {!loading && (!groupedView ? units.length === 0 : visibleTreeRows.length === 0 && !rootTreePayload?.loading) && (
              <tr>
                <td colSpan={9} className="px-3 py-10 text-center text-sm text-fg/40">
                  No labor units match this view.
                </td>
              </tr>
            )}
            {(loading || (groupedView && rootTreePayload?.loading)) && (
              <tr>
                <td colSpan={9} className="px-3 py-10 text-center text-sm text-fg/40">
                  Loading labor units...
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-t border-line bg-panel2/20 px-3 py-2 text-[11px] text-fg/45">
        <span>
          {groupedView
            ? `Showing ${compactCount(pageStart)}-${compactCount(pageEnd)} of ${compactCount(visibleRowsTotal)} visible tree rows / ${compactCount(total)} labor rows`
            : `Showing ${compactCount(pageStart)}-${compactCount(pageEnd)} of ${compactCount(total)} rows / ${compactCount(totalCatalogRows)} indexed across ${compactCount(catalogs.length)} catalog${catalogs.length === 1 ? "" : "s"}`}
        </span>
        <div className="flex items-center gap-2">
          <span>{compactCount(firstPartyCatalogs)} first-party</span>
          {groupedView && <span>{compactCount(rootTreePayload?.nodes.length ?? 0)} top-level group{rootTreePayload?.nodes.length === 1 ? "" : "s"}</span>}
          <CompactSelect
            value={String(pageSize)}
            onValueChange={(value) => setPageSize(Number(value))}
            options={[
              { value: "50", label: groupedView ? "50 visible" : "50 rows" },
              { value: "100", label: groupedView ? "100 visible" : "100 rows" },
              { value: "250", label: groupedView ? "250 visible" : "250 rows" },
            ]}
            ariaLabel="Labor units page size"
            triggerClassName="h-7 w-[104px]"
          />
          <Button type="button" variant="ghost" size="xs" onClick={() => setPage((current) => Math.max(0, current - 1))} disabled={page <= 0 || loading}>
            Prev
          </Button>
          <span className="tabular-nums">Page {compactCount(page + 1)} / {compactCount(totalPages)}</span>
          <Button type="button" variant="ghost" size="xs" onClick={() => setPage((current) => Math.min(totalPages - 1, current + 1))} disabled={page >= totalPages - 1 || loading}>
            Next
          </Button>
        </div>
      </div>

      {typeof document !== "undefined" && createPortal(drawer, document.body)}
    </div>
  );
}

function WorkspaceSurface({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn("h-full min-h-0 overflow-hidden rounded-lg border border-line bg-panel", className)}>
      {children}
    </div>
  );
}

export function LibraryPage({
  catalogs,
  rateSchedules,
  assemblies,
  knowledgeBooks,
  knowledgeDocuments,
  knowledgeCabinets,
  datasets,
  laborUnitLibraries,
  playbooks,
}: LibraryPageProps) {
  const searchParams = useSearchParams();
  const initialSurface = coerceSurface(searchParams.get("surface") ?? searchParams.get("tab"));
  const [activeSurface, setActiveSurface] = useState<LibrarySurface>(initialSurface);
  const [catalogRows, setCatalogRows] = useState<CatalogSummary[]>(catalogs);
  const [rateScheduleRows, setRateScheduleRows] = useState<RateSchedule[]>(rateSchedules);
  const [playbookRows, setPlaybookRows] = useState<EstimatorPersona[]>(playbooks);
  const [globalSearch, setGlobalSearch] = useState("");
  const costSnapshot = useCostIntelligenceSnapshot();

  useEffect(() => {
    const next = coerceSurface(searchParams.get("surface") ?? searchParams.get("tab"));
    setActiveSurface(next);
  }, [searchParams]);

  useEffect(() => {
    setCatalogRows(catalogs);
  }, [catalogs]);

  useEffect(() => {
    setRateScheduleRows(rateSchedules);
  }, [rateSchedules]);

  useEffect(() => {
    setPlaybookRows(playbooks);
  }, [playbooks]);

  const setSurface = useCallback((surface: LibrarySurface) => {
    setActiveSurface(surface);
    const params = new URLSearchParams(window.location.search);
    params.set("surface", surface);
    params.delete("group");
    const query = params.toString();
    window.history.replaceState(null, "", query ? `/library?${query}` : "/library");
  }, []);

  const surfaceCounts = useMemo<Record<LibrarySurface, number>>(() => ({
    overview: catalogRows.length + rateScheduleRows.length + assemblies.length + datasets.length,
    cost: costSnapshot.summary.effectiveCosts || costSnapshot.summary.resources,
    resources: totalCatalogItems(catalogRows),
    labor_units: laborUnitLibraries.reduce((sum, library) => sum + (library.unitCount ?? 0), 0),
    playbooks: playbookRows.length,
    assemblies: assemblies.length,
    rates: totalRateItems(rateScheduleRows),
    knowledge: knowledgeBooks.length + knowledgeDocuments.length + datasets.length,
  }), [
    assemblies,
    catalogRows,
    datasets,
    knowledgeBooks.length,
    knowledgeDocuments.length,
    costSnapshot.summary.effectiveCosts,
    costSnapshot.summary.resources,
    laborUnitLibraries,
    playbookRows.length,
    rateScheduleRows,
  ]);

  const activeMeta = surfaceOptions.find((surface) => surface.id === activeSurface) ?? surfaceOptions[0];
  const ActiveSurfaceIcon = activeMeta.icon;

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden bg-bg">
      <div className="shrink-0 border-b border-line bg-panel px-4 py-2">
        <div className="flex min-h-10 items-center gap-3">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-line bg-bg/45 text-accent">
            <ActiveSurfaceIcon className="h-4 w-4" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 text-[10px] font-medium uppercase tracking-wider text-fg/35">
              <Library className="h-3 w-3" />
              Library
            </div>
            <div className="mt-0.5 flex min-w-0 items-baseline gap-2">
              <h1 className="shrink-0 text-sm font-semibold text-fg">{activeMeta.label}</h1>
              <p className="hidden min-w-0 truncate text-xs text-fg/45 lg:block">{activeMeta.description}</p>
            </div>
          </div>
          <div className="relative hidden w-64 lg:block">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-fg/30" />
            <Input
              className="h-8 pl-8 text-xs"
              placeholder="Search library surfaces"
              value={globalSearch}
              onChange={(event) => setGlobalSearch(event.target.value)}
            />
            {globalSearch.trim() && (
              <div className="absolute left-0 right-0 top-full z-40 mt-1 overflow-hidden rounded-lg border border-line bg-panel shadow-lg">
                {surfaceOptions
                  .filter((surface) => surface.label.toLowerCase().includes(globalSearch.trim().toLowerCase()))
                  .map((surface) => {
                    const Icon = surface.icon;
                    return (
                      <button
                        key={surface.id}
                        type="button"
                        onClick={() => {
                          setSurface(surface.id);
                          setGlobalSearch("");
                        }}
                        className="flex w-full items-center gap-2 border-b border-line/60 px-3 py-2 text-left text-xs text-fg/60 last:border-b-0 hover:bg-panel2 hover:text-fg"
                      >
                        <Icon className="h-3.5 w-3.5" />
                        {surface.label}
                      </button>
                    );
                  })}
              </div>
            )}
          </div>
          <Button variant="ghost" size="sm" onClick={costSnapshot.refresh} disabled={costSnapshot.loading}>
            <RefreshCw className={cn("h-3.5 w-3.5", costSnapshot.loading && "animate-spin")} />
            Refresh
          </Button>
        </div>
      </div>

      <div className="shrink-0 border-b border-line bg-panel/95 px-4 py-1.5">
        <div className="flex gap-1 overflow-x-auto rounded-lg bg-bg/35 p-1">
          {surfaceOptions.map((surface) => (
            <SurfaceButton
              key={surface.id}
              active={activeSurface === surface.id}
              count={surface.id === "overview" ? undefined : surfaceCounts[surface.id]}
              icon={surface.icon}
              label={surface.label}
              onClick={() => setSurface(surface.id)}
            />
          ))}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-hidden bg-bg/60 p-3">
        <div className="h-full min-h-0 overflow-hidden">
          {activeSurface === "overview" && (
            <LibraryOverview
              assemblies={assemblies}
              catalogs={catalogRows}
              costSummary={costSnapshot.summary}
              datasets={datasets}
              effectiveCosts={costSnapshot.effectiveCosts}
              knowledgeBooks={knowledgeBooks}
              knowledgeDocuments={knowledgeDocuments}
              laborUnitLibraries={laborUnitLibraries}
              observations={costSnapshot.observations}
              onSurfaceChange={setSurface}
              playbooks={playbookRows}
              rateSchedules={rateScheduleRows}
              resources={costSnapshot.resources}
            />
          )}

          {activeSurface === "cost" && (
            <WorkspaceSurface>
              <CostIntelligencePanel embedded entrySurface="library.cost_intelligence" />
            </WorkspaceSurface>
          )}

          {activeSurface === "resources" && (
            <WorkspaceSurface className="p-3">
              <ItemsManager embedded catalogs={catalogRows} onCatalogsChange={setCatalogRows} />
            </WorkspaceSurface>
          )}

          {activeSurface === "labor_units" && (
            <WorkspaceSurface className="p-3">
              <LaborUnitsWorkspace initialLibraries={laborUnitLibraries} />
            </WorkspaceSurface>
          )}

          {activeSurface === "playbooks" && (
            <WorkspaceSurface className="p-3">
              <EstimatingPlaybooksManager
                initialPlaybooks={playbookRows}
                initialKnowledgeBooks={knowledgeBooks}
                initialKnowledgeDocuments={knowledgeDocuments}
                onPlaybooksChange={setPlaybookRows}
              />
            </WorkspaceSurface>
          )}

          {activeSurface === "assemblies" && (
            <WorkspaceSurface className="p-3">
              <AssemblyManager embedded />
            </WorkspaceSurface>
          )}

          {activeSurface === "rates" && (
            <WorkspaceSurface className="p-3">
              <RateScheduleManager embedded schedules={rateScheduleRows} setSchedules={setRateScheduleRows} loading={false} catalogs={catalogRows} />
            </WorkspaceSurface>
          )}

          {activeSurface === "knowledge" && (
            <WorkspaceSurface className="p-3">
              <Suspense fallback={<div className="rounded-lg border border-line bg-panel px-4 py-8 text-center text-sm text-fg/40">Loading knowledge...</div>}>
                <KnowledgePage
                  embedded
                  initialBooks={knowledgeBooks}
                  initialDocuments={knowledgeDocuments}
                  initialCabinets={knowledgeCabinets}
                  initialDatasets={datasets}
                />
              </Suspense>
            </WorkspaceSurface>
          )}
        </div>
      </div>
    </div>
  );
}
