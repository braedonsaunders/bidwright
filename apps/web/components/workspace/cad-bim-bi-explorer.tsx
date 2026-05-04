"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  BarChart3,
  Bookmark,
  Box,
  Database,
  Download,
  FileSpreadsheet,
  Filter,
  Layers,
  Loader2,
  RefreshCw,
  Save,
  Search,
  Sigma,
  Table2,
  Trash2,
  X,
} from "lucide-react";
import {
  Button,
  EmptyState,
  Input,
  Select,
  Separator,
  Badge,
} from "@/components/ui";
import {
  createModelTakeoffLink,
  createWorksheetItem,
  listModelAssets,
  listModelTakeoffLinks,
  queryModelElements,
  type ModelAsset,
  type ModelElement,
  type ModelQuantity,
  type ModelTakeoffLinkRecord,
  type ProjectWorkspaceData,
} from "@/lib/api";
import { downloadCsv } from "@/lib/csv";
import { cn } from "@/lib/utils";

type ExplorerTab = "table" | "pivot" | "charts" | "describe";
type AggFn = "sum" | "avg" | "min" | "max" | "count" | "count_unique";
type PivotVizMode = "table" | "heatmap" | "bars" | "matrix";
type TopDirection = "top" | "bottom";
type Scalar = string | number | boolean | null;

type Slicer = {
  column: string;
  value: string;
};

type QuantityRef = {
  quantityId: string | null;
  quantityType: string;
  unit: string;
  value: number;
};

type ExplorerRow = {
  id: string;
  modelId: string;
  modelName: string;
  fileName: string;
  elementId: string;
  externalId: string;
  name: string;
  linked: boolean;
  data: Record<string, Scalar>;
  quantityRefs: Record<string, QuantityRef>;
  rawElement: ModelElement;
};

type ModelBatch = {
  asset: ModelAsset;
  elements: ModelElement[];
  count: number;
};

type NumericStats = {
  key: string;
  count: number;
  sum: number;
  min: number;
  max: number;
  avg: number;
};

type PivotRow = {
  key: string;
  groupValues: Record<string, string>;
  values: Record<string, number>;
  sourceRows: ExplorerRow[];
};

type SavedView = {
  id: string;
  name: string;
  createdAt: string;
  assetId: string;
  tab: ExplorerTab;
  groupBy: string[];
  aggCols: string[];
  aggFn: AggFn;
  topN: number | null;
  topDirection: TopDirection;
  pivotViz: PivotVizMode;
  slicers: Slicer[];
  search: string;
  chartDimension: string;
  chartMetric: string;
  lineItemQuantityKey: string;
};

const ALL_MODELS = "__all__";
const COUNT_KEY = "__count";
const EMPTY_VALUE = "Unspecified";

const TABS: Array<{ id: ExplorerTab; label: string; icon: typeof Table2 }> = [
  { id: "table", label: "Data", icon: Table2 },
  { id: "pivot", label: "Pivot", icon: Layers },
  { id: "charts", label: "Charts", icon: BarChart3 },
  { id: "describe", label: "Describe", icon: FileSpreadsheet },
];

const DIMENSIONS = [
  "modelName",
  "elementClass",
  "elementType",
  "system",
  "level",
  "material",
  "linked",
] as const;

const AGG_OPTIONS: Array<{ value: AggFn; label: string }> = [
  { value: "sum", label: "SUM" },
  { value: "avg", label: "AVG" },
  { value: "min", label: "MIN" },
  { value: "max", label: "MAX" },
  { value: "count", label: "COUNT" },
  { value: "count_unique", label: "COUNT UNIQUE" },
];

const PIVOT_VIZ_OPTIONS: Array<{ value: PivotVizMode; label: string }> = [
  { value: "table", label: "Table" },
  { value: "heatmap", label: "Heatmap" },
  { value: "bars", label: "Bars" },
  { value: "matrix", label: "Matrix" },
];

function dimensionLabel(key: string): string {
  const labels: Record<string, string> = {
    modelName: "Model",
    elementClass: "Class",
    elementType: "Type",
    system: "System",
    level: "Level",
    material: "Material",
    linked: "Estimate Link",
    name: "Name",
    externalId: "External ID",
  };
  return labels[key] ?? key.replace(/^qty:/, "").replace(/_/g, " ");
}

function quantityLabel(key: string): string {
  if (key === COUNT_KEY) return "Objects";
  if (key === "quantityTotal") return "Quantity Total";
  if (key === "avgConfidence") return "Avg Confidence";
  if (key.startsWith("qty:")) return dimensionLabel(key.slice(4));
  return dimensionLabel(key);
}

function normalizeValue(value: unknown): string {
  if (value === null || value === undefined || value === "") return EMPTY_VALUE;
  if (typeof value === "boolean") return value ? "Linked" : "Unlinked";
  return String(value);
}

function formatNumber(value: number | null | undefined, digits = 2): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "-";
  const abs = Math.abs(value);
  if (abs >= 1000000) return value.toLocaleString(undefined, { maximumFractionDigits: 1 });
  if (abs >= 1000) return value.toLocaleString(undefined, { maximumFractionDigits: 1 });
  if (abs >= 1) return value.toLocaleString(undefined, { maximumFractionDigits: digits });
  return value.toLocaleString(undefined, { maximumFractionDigits: 4 });
}

function numericValue(value: Scalar): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function unitForQuantityType(rows: ExplorerRow[], quantityType: string): string {
  for (const row of rows) {
    const ref = row.quantityRefs[quantityType];
    if (ref?.unit) return ref.unit;
  }
  return "";
}

function safeFileName(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "") || "bidwright";
}

function toggleValue(values: string[], value: string): string[] {
  return values.includes(value) ? values.filter((item) => item !== value) : [...values, value];
}

function getPrimaryQuantity(row: ExplorerRow, quantityKey: string): QuantityRef {
  if (quantityKey.startsWith("qty:")) {
    const type = quantityKey.slice(4);
    const ref = row.quantityRefs[type];
    if (ref && Number.isFinite(ref.value) && ref.value > 0) return ref;
  }

  const preferred = ["surface_area", "area", "volume", "length"];
  for (const type of preferred) {
    const ref = row.quantityRefs[type];
    if (ref && Number.isFinite(ref.value) && ref.value > 0) return ref;
  }

  for (const ref of Object.values(row.quantityRefs)) {
    if (ref && Number.isFinite(ref.value) && ref.value > 0) return ref;
  }

  return { quantityId: null, quantityType: "count", unit: "EA", value: 1 };
}

function buildRows(batch: ModelBatch, linkedElementIds: Set<string>): ExplorerRow[] {
  return batch.elements.map((element) => {
    const quantities = element.quantities ?? [];
    const quantityRefs: Record<string, QuantityRef> = {};
    const data: Record<string, Scalar> = {
      modelName: batch.asset.fileName,
      fileName: batch.asset.fileName,
      name: element.name || element.externalId || element.id,
      externalId: element.externalId || element.id,
      elementClass: element.elementClass || EMPTY_VALUE,
      elementType: element.elementType || EMPTY_VALUE,
      system: element.system || EMPTY_VALUE,
      level: element.level || EMPTY_VALUE,
      material: element.material || EMPTY_VALUE,
      linked: linkedElementIds.has(element.id),
      [COUNT_KEY]: 1,
      quantityTotal: 0,
      avgConfidence: null,
    };

    let quantityTotal = 0;
    let confidenceTotal = 0;
    let confidenceCount = 0;

    quantities.forEach((quantity: ModelQuantity) => {
      const type = quantity.quantityType || "quantity";
      const key = `qty:${type}`;
      const previous = numericValue(data[key]) ?? 0;
      const nextValue = Number.isFinite(quantity.value) ? quantity.value : 0;
      data[key] = previous + nextValue;
      quantityTotal += nextValue;
      confidenceTotal += Number.isFinite(quantity.confidence) ? quantity.confidence : 0;
      confidenceCount += 1;
      quantityRefs[type] = {
        quantityId: quantity.id ?? null,
        quantityType: type,
        unit: quantity.unit || batch.asset.units || "",
        value: (quantityRefs[type]?.value ?? 0) + nextValue,
      };
    });

    data.quantityTotal = quantityTotal;
    data.avgConfidence = confidenceCount > 0 ? confidenceTotal / confidenceCount : null;

    return {
      id: `${batch.asset.id}:${element.id}`,
      modelId: batch.asset.id,
      modelName: batch.asset.fileName,
      fileName: batch.asset.fileName,
      elementId: element.id,
      externalId: element.externalId || element.id,
      name: element.name || element.externalId || element.id,
      linked: linkedElementIds.has(element.id),
      data,
      quantityRefs,
      rawElement: element,
    };
  });
}

function applySlicers(rows: ExplorerRow[], slicers: Slicer[]): ExplorerRow[] {
  if (slicers.length === 0) return rows;
  return rows.filter((row) =>
    slicers.every((slicer) => normalizeValue(row.data[slicer.column]) === slicer.value),
  );
}

function aggregateValues(rows: ExplorerRow[], column: string, aggFn: AggFn): number {
  if (column === COUNT_KEY && (aggFn === "sum" || aggFn === "count")) return rows.length;

  const rawValues = rows.map((row) => row.data[column]).filter((value) => value !== null && value !== undefined && value !== "");
  if (aggFn === "count") return rawValues.length;
  if (aggFn === "count_unique") return new Set(rawValues.map((value) => normalizeValue(value))).size;

  const values = rawValues.map(numericValue).filter((value): value is number => value !== null);
  if (values.length === 0) return 0;
  if (aggFn === "avg") return values.reduce((sum, value) => sum + value, 0) / values.length;
  if (aggFn === "min") return Math.min(...values);
  if (aggFn === "max") return Math.max(...values);
  return values.reduce((sum, value) => sum + value, 0);
}

function computePivot(
  rows: ExplorerRow[],
  groupBy: string[],
  aggCols: string[],
  aggFn: AggFn,
  topN: number | null,
  topDirection: TopDirection,
): PivotRow[] {
  const groups = new Map<string, ExplorerRow[]>();
  const groupColumns = groupBy.length > 0 ? groupBy : ["modelName"];

  rows.forEach((row) => {
    const key = groupColumns.map((column) => normalizeValue(row.data[column])).join(" | ");
    const bucket = groups.get(key) ?? [];
    bucket.push(row);
    groups.set(key, bucket);
  });

  const pivotRows = Array.from(groups.entries()).map(([key, sourceRows]) => {
    const groupValues = Object.fromEntries(
      groupColumns.map((column) => [column, normalizeValue(sourceRows[0]?.data[column])]),
    );
    const values = Object.fromEntries(aggCols.map((column) => [column, aggregateValues(sourceRows, column, aggFn)]));
    return { key, groupValues, values, sourceRows };
  });

  const sortColumn = aggCols[0] ?? COUNT_KEY;
  pivotRows.sort((a, b) => {
    const delta = (b.values[sortColumn] ?? 0) - (a.values[sortColumn] ?? 0);
    return topDirection === "bottom" ? -delta : delta;
  });

  return topN ? pivotRows.slice(0, topN) : pivotRows;
}

function computeStats(rows: ExplorerRow[], numericColumns: string[]): NumericStats[] {
  return numericColumns.map((key) => {
    const values = rows.map((row) => numericValue(row.data[key])).filter((value): value is number => value !== null);
    if (values.length === 0) {
      return { key, count: 0, sum: 0, min: 0, max: 0, avg: 0 };
    }
    const sum = values.reduce((total, value) => total + value, 0);
    return {
      key,
      count: values.length,
      sum,
      min: Math.min(...values),
      max: Math.max(...values),
      avg: sum / values.length,
    };
  });
}

function savedViewKey(projectId: string) {
  return `bidwright:cad-bim-bi-views:${projectId}`;
}

interface CadBimBiExplorerProps {
  workspace: ProjectWorkspaceData;
  selectedWorksheetId?: string;
  initialAssets?: ModelAsset[];
  onClose?: () => void;
  onWorkspaceMutated?: () => void;
  onLinksMutated?: () => void;
}

export function CadBimBiExplorer({
  workspace,
  selectedWorksheetId,
  initialAssets = [],
  onClose,
  onWorkspaceMutated,
  onLinksMutated,
}: CadBimBiExplorerProps) {
  const projectId = workspace.project.id;
  const [assets, setAssets] = useState<ModelAsset[]>(initialAssets);
  const [assetId, setAssetId] = useState<string>(initialAssets.length > 1 ? ALL_MODELS : initialAssets[0]?.id ?? "");
  const [batches, setBatches] = useState<ModelBatch[]>([]);
  const [links, setLinks] = useState<ModelTakeoffLinkRecord[]>([]);
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [loadingAssets, setLoadingAssets] = useState(false);
  const [loadingRows, setLoadingRows] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<{ tone: "success" | "danger" | "info"; message: string } | null>(null);
  const [tab, setTab] = useState<ExplorerTab>("pivot");
  const [slicers, setSlicers] = useState<Slicer[]>([]);
  const [groupBy, setGroupBy] = useState<string[]>(["elementClass", "level"]);
  const [aggCols, setAggCols] = useState<string[]>([COUNT_KEY]);
  const [aggFn, setAggFn] = useState<AggFn>("sum");
  const [topN, setTopN] = useState<number | null>(20);
  const [topDirection, setTopDirection] = useState<TopDirection>("top");
  const [pivotViz, setPivotViz] = useState<PivotVizMode>("heatmap");
  const [chartDimension, setChartDimension] = useState<string>("elementClass");
  const [chartMetric, setChartMetric] = useState<string>(COUNT_KEY);
  const [lineItemQuantityKey, setLineItemQuantityKey] = useState<string>(COUNT_KEY);
  const [savedViews, setSavedViews] = useState<SavedView[]>([]);
  const [creatingRowId, setCreatingRowId] = useState<string | null>(null);

  const activeAssets = useMemo(() => {
    if (assetId === ALL_MODELS) return assets;
    return assets.filter((asset) => asset.id === assetId);
  }, [assetId, assets]);

  const targetWorksheet = useMemo(
    () => workspace.worksheets.find((worksheet) => worksheet.id === selectedWorksheetId) ?? workspace.worksheets[0] ?? null,
    [selectedWorksheetId, workspace.worksheets],
  );
  const defaultEstimateCategory = useMemo(() => {
    return (workspace.entityCategories ?? [])
      .filter((category) => category.enabled)
      .slice()
      .sort((left, right) => left.order - right.order)[0] ?? null;
  }, [workspace.entityCategories]);

  const linkedElementIds = useMemo(
    () => new Set(links.map((link) => link.modelElementId).filter((id): id is string => Boolean(id))),
    [links],
  );

  const rows = useMemo(
    () => batches.flatMap((batch) => buildRows(batch, linkedElementIds)),
    [batches, linkedElementIds],
  );

  const numericColumns = useMemo(() => {
    const keys = new Set<string>([COUNT_KEY]);
    rows.forEach((row) => {
      Object.entries(row.data).forEach(([key, value]) => {
        if (typeof value === "number" && Number.isFinite(value)) keys.add(key);
      });
    });
    return Array.from(keys).sort((a, b) => {
      if (a === COUNT_KEY) return -1;
      if (b === COUNT_KEY) return 1;
      return quantityLabel(a).localeCompare(quantityLabel(b));
    });
  }, [rows]);

  const filteredRows = useMemo(() => applySlicers(rows, slicers), [rows, slicers]);

  const pivotRows = useMemo(
    () => computePivot(filteredRows, groupBy, aggCols, aggFn, topN, topDirection),
    [aggCols, aggFn, filteredRows, groupBy, topDirection, topN],
  );

  const describeStats = useMemo(() => computeStats(filteredRows, numericColumns), [filteredRows, numericColumns]);

  const chartRows = useMemo(
    () => computePivot(filteredRows, [chartDimension], [chartMetric], aggFn, topN, topDirection),
    [aggFn, chartDimension, chartMetric, filteredRows, topDirection, topN],
  );

  const modelOptions = useMemo(() => [
    ...(assets.length > 1 ? [{ value: ALL_MODELS, label: `All indexed models (${assets.length})` }] : []),
    ...assets.map((asset) => ({
      value: asset.id,
      label: `${asset.fileName}${asset._count?.elements ? ` (${asset._count.elements})` : ""}`,
    })),
  ], [assets]);

  const numericOptions = useMemo(
    () => numericColumns.map((key) => ({ value: key, label: quantityLabel(key) })),
    [numericColumns],
  );

  const dimensionOptions = useMemo(
    () => DIMENSIONS.map((key) => ({ value: key, label: dimensionLabel(key) })),
    [],
  );

  useEffect(() => {
    const timeout = window.setTimeout(() => setDebouncedSearch(search.trim()), 220);
    return () => window.clearTimeout(timeout);
  }, [search]);

  useEffect(() => {
    if (numericColumns.length === 0) return;
    setAggCols((current) => current.filter((column) => numericColumns.includes(column)));
    setChartMetric((current) => (numericColumns.includes(current) ? current : numericColumns[0]));
    setLineItemQuantityKey((current) => (numericColumns.includes(current) ? current : numericColumns[0]));
  }, [numericColumns]);

  useEffect(() => {
    if (assets.length === 0) {
      setAssetId("");
      return;
    }
    if (assetId === ALL_MODELS && assets.length > 1) return;
    if (!assets.some((asset) => asset.id === assetId)) {
      setAssetId(assets.length > 1 ? ALL_MODELS : assets[0].id);
    }
  }, [assetId, assets]);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(savedViewKey(projectId));
      setSavedViews(raw ? JSON.parse(raw) as SavedView[] : []);
    } catch {
      setSavedViews([]);
    }
  }, [projectId]);

  const persistViews = useCallback((views: SavedView[]) => {
    setSavedViews(views);
    try {
      window.localStorage.setItem(savedViewKey(projectId), JSON.stringify(views));
    } catch {
      setStatus({ tone: "danger", message: "Saved views could not be persisted in this browser." });
    }
  }, [projectId]);

  const refreshAssets = useCallback(async (force = false) => {
    setLoadingAssets(true);
    setError(null);
    try {
      const result = await listModelAssets(projectId, force);
      setAssets(result.assets ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load model assets.");
    } finally {
      setLoadingAssets(false);
    }
  }, [projectId]);

  const refreshRows = useCallback(async () => {
    if (activeAssets.length === 0) {
      setBatches([]);
      setLinks([]);
      return;
    }

    setLoadingRows(true);
    setError(null);
    try {
      const [elementResults, linkResults] = await Promise.all([
        Promise.all(
          activeAssets.map(async (asset) => {
            const result = await queryModelElements(projectId, asset.id, {
              text: debouncedSearch || undefined,
              limit: 1000,
            });
            return { asset, elements: result.elements ?? [], count: result.count ?? 0 };
          }),
        ),
        Promise.all(
          activeAssets.map(async (asset) => {
            try {
              const result = await listModelTakeoffLinks(projectId, asset.id);
              return result.links ?? [];
            } catch {
              return [];
            }
          }),
        ),
      ]);
      setBatches(elementResults);
      setLinks(linkResults.flat());
    } catch (err) {
      setBatches([]);
      setLinks([]);
      setError(err instanceof Error ? err.message : "Could not load model element rows.");
    } finally {
      setLoadingRows(false);
    }
  }, [activeAssets, debouncedSearch, projectId]);

  useEffect(() => {
    void refreshAssets(false);
  }, [refreshAssets]);

  useEffect(() => {
    void refreshRows();
  }, [refreshRows]);

  function addSlicer(column: string, value: string) {
    setSlicers((current) => {
      if (current.some((slicer) => slicer.column === column && slicer.value === value)) return current;
      return [...current, { column, value }];
    });
  }

  function removeSlicer(index: number) {
    setSlicers((current) => current.filter((_, i) => i !== index));
  }

  function saveCurrentView() {
    const name = window.prompt("Name this CAD/BIM explorer view", `View ${savedViews.length + 1}`);
    if (!name?.trim()) return;
    const view: SavedView = {
      id: `view-${Date.now()}`,
      name: name.trim(),
      createdAt: new Date().toISOString(),
      assetId,
      tab,
      groupBy,
      aggCols,
      aggFn,
      topN,
      topDirection,
      pivotViz,
      slicers,
      search,
      chartDimension,
      chartMetric,
      lineItemQuantityKey,
    };
    persistViews([view, ...savedViews].slice(0, 20));
    setStatus({ tone: "success", message: `Saved "${view.name}".` });
  }

  function applySavedView(view: SavedView) {
    setAssetId(view.assetId);
    setTab(view.tab);
    setGroupBy(view.groupBy.length ? view.groupBy : ["elementClass"]);
    setAggCols(view.aggCols.length ? view.aggCols : [COUNT_KEY]);
    setAggFn(view.aggFn);
    setTopN(view.topN);
    setTopDirection(view.topDirection);
    setPivotViz(view.pivotViz);
    setSlicers(view.slicers);
    setSearch(view.search);
    setChartDimension(view.chartDimension || "elementClass");
    setChartMetric(view.chartMetric || COUNT_KEY);
    setLineItemQuantityKey(view.lineItemQuantityKey || COUNT_KEY);
    setStatus({ tone: "info", message: `Loaded "${view.name}".` });
  }

  function deleteSavedView(viewId: string) {
    persistViews(savedViews.filter((view) => view.id !== viewId));
  }

  function exportRows() {
    const columns = [
      "modelName",
      "name",
      "externalId",
      "elementClass",
      "elementType",
      "system",
      "level",
      "material",
      "linked",
      ...numericColumns.filter((column) => column !== COUNT_KEY),
    ];
    downloadCsv(
      `${safeFileName(workspace.project.name)}-model-elements.csv`,
      columns.map((column) => column === COUNT_KEY ? "Count" : dimensionLabel(column)),
      filteredRows.map((row) => columns.map((column) => row.data[column])),
    );
  }

  function exportPivot() {
    const headers = [...groupBy.map(dimensionLabel), ...aggCols.map(quantityLabel)];
    downloadCsv(
      `${safeFileName(workspace.project.name)}-model-pivot.csv`,
      headers,
      pivotRows.map((row) => [
        ...groupBy.map((column) => row.groupValues[column] ?? EMPTY_VALUE),
        ...aggCols.map((column) => row.values[column] ?? 0),
      ]),
    );
  }

  async function createLineFromRow(row: ExplorerRow) {
    if (!targetWorksheet) {
      setStatus({ tone: "danger", message: "Create a worksheet before sending model elements to the estimate." });
      return;
    }
    if (!defaultEstimateCategory) {
      setStatus({ tone: "danger", message: "Configure at least one entity category before creating model takeoff lines." });
      return;
    }

    setCreatingRowId(row.id);
    try {
      const primary = getPrimaryQuantity(row, lineItemQuantityKey);
      const previousItemIds = new Set(
        workspace.worksheets.flatMap((worksheet) => worksheet.items).map((item) => item.id),
      );
      const quantityLabelText = primary.quantityType === "count" ? "Count" : quantityLabel(`qty:${primary.quantityType}`);
      const quantities = Object.values(row.quantityRefs)
        .map((ref) => `${quantityLabel(`qty:${ref.quantityType}`)}: ${formatNumber(ref.value)} ${ref.unit}`.trim())
        .join("\n");

      const result = await createWorksheetItem(projectId, targetWorksheet.id, {
        categoryId: defaultEstimateCategory.id,
        category: defaultEstimateCategory.name,
        entityType: defaultEstimateCategory.entityType,
        entityName: row.name,
        description: row.fileName,
        quantity: primary.value,
        uom: primary.unit || "EA",
        cost: 0,
        markup: workspace.currentRevision.defaultMarkup ?? 0.2,
        price: 0,
        sourceNotes: [
          `From CAD/BIM BI Explorer: ${row.fileName}`,
          `${quantityLabelText}: ${formatNumber(primary.value)} ${primary.unit || ""}`.trim(),
          `Element class: ${normalizeValue(row.data.elementClass)}`,
          `Element type: ${normalizeValue(row.data.elementType)}`,
          normalizeValue(row.data.level) !== EMPTY_VALUE ? `Level: ${normalizeValue(row.data.level)}` : "",
          normalizeValue(row.data.material) !== EMPTY_VALUE ? `Material: ${normalizeValue(row.data.material)}` : "",
          `External id: ${row.externalId}`,
          quantities ? `Available quantities:\n${quantities}` : "",
        ].filter(Boolean).join("\n"),
      });

      const createdItem = result.workspace.worksheets
        .flatMap((worksheet) => worksheet.items)
        .find((item) => !previousItemIds.has(item.id));

      if (createdItem) {
        await createModelTakeoffLink(projectId, row.modelId, {
          worksheetItemId: createdItem.id,
          modelElementId: row.elementId,
          modelQuantityId: primary.quantityId,
          quantityField: "quantity",
          multiplier: 1,
          derivedQuantity: primary.value,
          selection: {
            mode: "cad-bim-bi-explorer",
            modelId: row.modelId,
            fileName: row.fileName,
            externalId: row.externalId,
            elementName: row.name,
            elementClass: row.data.elementClass,
            elementType: row.data.elementType,
            system: row.data.system,
            level: row.data.level,
            material: row.data.material,
            quantityType: primary.quantityType,
            quantityKey: lineItemQuantityKey,
            groupBy,
            slicers,
          },
        });
      }

      setStatus({ tone: "success", message: `Created model takeoff line in ${targetWorksheet.name}.` });
      onWorkspaceMutated?.();
      onLinksMutated?.();
      await refreshRows();
    } catch (err) {
      setStatus({ tone: "danger", message: err instanceof Error ? err.message : "Could not create the model line item." });
    } finally {
      setCreatingRowId(null);
    }
  }

  const topMetric = aggCols[0] ?? COUNT_KEY;
  const pivotMaxByMetric = useMemo(() => {
    return Object.fromEntries(
      aggCols.map((column) => [
        column,
        Math.max(1, ...pivotRows.map((row) => Math.abs(row.values[column] ?? 0))),
      ]),
    ) as Record<string, number>;
  }, [aggCols, pivotRows]);
  const chartMax = Math.max(1, ...chartRows.map((row) => Math.abs(row.values[chartMetric] ?? 0)));
  const linkedCount = filteredRows.filter((row) => row.linked).length;

  return (
    <div className="flex h-full min-h-0 flex-col bg-panel text-fg">
      <div className="flex shrink-0 items-center gap-3 border-b border-line px-4 py-3">
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg border border-accent/25 bg-accent/10 text-accent">
            <Database className="h-4 w-4" />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h3 className="truncate text-sm font-semibold text-fg">CAD/BIM BI Explorer</h3>
              <Badge tone="info" className="text-[10px]">
                {activeAssets.length || 0} model{activeAssets.length === 1 ? "" : "s"}
              </Badge>
            </div>
            <p className="truncate text-xs text-fg/45">
              Pivot indexed model objects, isolate scope, and create estimate lines from measured quantities.
            </p>
          </div>
        </div>

        <div className="hidden items-center gap-2 lg:flex">
          {[
            ["Objects", filteredRows.length],
            ["Linked", linkedCount],
            ["Qty Fields", Math.max(0, numericColumns.length - 1)],
          ].map(([label, value]) => (
            <div key={label} className="rounded-lg border border-line bg-bg/45 px-3 py-1.5 text-right">
              <div className="text-[10px] font-medium uppercase tracking-wide text-fg/35">{label}</div>
              <div className="text-sm font-semibold text-fg">{formatNumber(Number(value), 0)}</div>
            </div>
          ))}
        </div>

        <Button variant="secondary" size="sm" onClick={() => void refreshAssets(true)} disabled={loadingAssets || loadingRows}>
          {loadingAssets ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
          Sync
        </Button>
        <Button variant="secondary" size="sm" onClick={saveCurrentView}>
          <Save className="h-3.5 w-3.5" />
          Save View
        </Button>
        <Button variant="ghost" size="sm" onClick={onClose} title="Close CAD/BIM BI Explorer">
          <X className="h-4 w-4" />
        </Button>
      </div>

      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-line bg-bg/35 px-4 py-2">
        <Filter className="h-3.5 w-3.5 text-fg/35" />
        <span className="text-[11px] font-semibold uppercase tracking-wide text-fg/40">Slicers</span>
        {slicers.length === 0 ? (
          <span className="text-xs text-fg/35">Click a pivot row or chart bar to filter every tab.</span>
        ) : (
          <>
            {slicers.map((slicer, index) => (
              <button
                key={`${slicer.column}-${slicer.value}-${index}`}
                type="button"
                onClick={() => removeSlicer(index)}
                className="inline-flex max-w-[240px] items-center gap-1 rounded-md border border-accent/25 bg-accent/10 px-2 py-1 text-[11px] font-medium text-accent hover:bg-accent/15"
                title="Remove slicer"
              >
                <span className="truncate">
                  {dimensionLabel(slicer.column)} = {slicer.value}
                </span>
                <X className="h-3 w-3 shrink-0" />
              </button>
            ))}
            <button
              type="button"
              onClick={() => setSlicers([])}
              className="text-[11px] font-medium text-fg/45 underline underline-offset-2 hover:text-fg/70"
            >
              Clear all
            </button>
          </>
        )}
        {status && (
          <Badge tone={status.tone === "danger" ? "danger" : status.tone === "success" ? "success" : "info"} className="ml-auto max-w-[360px] truncate text-[10px]">
            {status.message}
          </Badge>
        )}
      </div>

      {error && (
        <div className="shrink-0 border-b border-danger/20 bg-danger/5 px-4 py-2 text-xs text-danger">
          {error}
        </div>
      )}

      <div className="flex min-h-0 flex-1">
        <aside className="flex w-80 shrink-0 flex-col border-r border-line bg-panel">
          <div className="space-y-3 border-b border-line p-3">
            <div>
              <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-fg/40">Model Scope</label>
              <Select
                value={assetId}
                onValueChange={(value) => {
                  setAssetId(value);
                  setSlicers([]);
                }}
                options={modelOptions}
                placeholder="No indexed models"
                size="sm"
                disabled={modelOptions.length === 0}
              />
            </div>
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-2.5 h-3.5 w-3.5 text-fg/30" />
              <Input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search object name, type, material..."
                className="h-8 pl-8 text-xs"
              />
            </div>
          </div>

          <div className="min-h-0 flex-1 overflow-auto p-3">
            <section className="space-y-2">
              <div className="flex items-center justify-between gap-2">
                <h4 className="text-[11px] font-semibold uppercase tracking-wide text-fg/40">Group Fields</h4>
                <span className="text-[10px] text-fg/30">{groupBy.length} active</span>
              </div>
              <div className="grid grid-cols-2 gap-1.5">
                {DIMENSIONS.map((column) => (
                  <button
                    key={column}
                    type="button"
                    onClick={() => setGroupBy((current) => toggleValue(current, column))}
                    className={cn(
                      "h-8 truncate rounded-md border px-2 text-left text-[11px] font-medium transition-colors",
                      groupBy.includes(column)
                        ? "border-accent/30 bg-accent/10 text-accent"
                        : "border-line bg-bg/35 text-fg/55 hover:bg-panel2",
                    )}
                  >
                    {dimensionLabel(column)}
                  </button>
                ))}
              </div>
            </section>

            <Separator className="my-4" />

            <section className="space-y-2">
              <div className="flex items-center justify-between gap-2">
                <h4 className="text-[11px] font-semibold uppercase tracking-wide text-fg/40">Metrics</h4>
                <Select
                  value={aggFn}
                  onValueChange={(value) => setAggFn(value as AggFn)}
                  options={AGG_OPTIONS}
                  size="xs"
                  triggerClassName="w-32"
                />
              </div>
              <div className="space-y-1.5">
                {numericColumns.map((column) => (
                  <button
                    key={column}
                    type="button"
                    onClick={() => setAggCols((current) => toggleValue(current, column))}
                    className={cn(
                      "flex h-8 w-full items-center justify-between gap-2 rounded-md border px-2 text-left text-[11px] font-medium transition-colors",
                      aggCols.includes(column)
                        ? "border-accent/30 bg-accent/10 text-accent"
                        : "border-line bg-bg/35 text-fg/55 hover:bg-panel2",
                    )}
                  >
                    <span className="truncate">{quantityLabel(column)}</span>
                    {column.startsWith("qty:") && (
                      <span className="shrink-0 text-[10px] text-fg/35">{unitForQuantityType(rows, column.slice(4))}</span>
                    )}
                  </button>
                ))}
              </div>
            </section>

            <Separator className="my-4" />

            <section className="space-y-2">
              <h4 className="text-[11px] font-semibold uppercase tracking-wide text-fg/40">Limit</h4>
              <div className="grid grid-cols-4 gap-1.5">
                {[null, 10, 20, 50].map((value) => (
                  <button
                    key={value ?? "all"}
                    type="button"
                    onClick={() => setTopN(value)}
                    className={cn(
                      "h-7 rounded-md border text-[11px] font-medium transition-colors",
                      topN === value ? "border-accent/30 bg-accent/10 text-accent" : "border-line bg-bg/35 text-fg/55 hover:bg-panel2",
                    )}
                  >
                    {value ?? "All"}
                  </button>
                ))}
              </div>
              <div className="grid grid-cols-2 gap-1.5">
                {(["top", "bottom"] as TopDirection[]).map((direction) => (
                  <button
                    key={direction}
                    type="button"
                    onClick={() => setTopDirection(direction)}
                    className={cn(
                      "h-7 rounded-md border text-[11px] font-medium capitalize transition-colors",
                      topDirection === direction ? "border-accent/30 bg-accent/10 text-accent" : "border-line bg-bg/35 text-fg/55 hover:bg-panel2",
                    )}
                  >
                    {direction}
                  </button>
                ))}
              </div>
            </section>

            <Separator className="my-4" />

            <section className="space-y-2">
              <div className="flex items-center gap-2">
                <Bookmark className="h-3.5 w-3.5 text-fg/35" />
                <h4 className="text-[11px] font-semibold uppercase tracking-wide text-fg/40">Saved Views</h4>
              </div>
              {savedViews.length === 0 ? (
                <p className="rounded-md border border-line bg-bg/30 px-2 py-2 text-xs text-fg/40">
                  Save a pivot setup for repeated takeoff reviews.
                </p>
              ) : (
                <div className="space-y-1.5">
                  {savedViews.map((view) => (
                    <div key={view.id} className="flex items-center gap-1 rounded-md border border-line bg-bg/30 p-1">
                      <button
                        type="button"
                        onClick={() => applySavedView(view)}
                        className="min-w-0 flex-1 rounded px-2 py-1 text-left text-xs font-medium text-fg/70 hover:bg-panel2"
                      >
                        <span className="block truncate">{view.name}</span>
                        <span className="block truncate text-[10px] font-normal text-fg/35">
                          {new Date(view.createdAt).toLocaleDateString()}
                        </span>
                      </button>
                      <button
                        type="button"
                        onClick={() => deleteSavedView(view.id)}
                        className="flex h-7 w-7 items-center justify-center rounded text-fg/35 hover:bg-danger/10 hover:text-danger"
                        title="Delete saved view"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </section>
          </div>
        </aside>

        <main className="flex min-w-0 flex-1 flex-col">
          <div className="flex shrink-0 items-center gap-2 border-b border-line px-3 py-2">
            <div className="flex items-center rounded-lg border border-line bg-bg/45 p-0.5">
              {TABS.map(({ id, label, icon: Icon }) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => setTab(id)}
                  className={cn(
                    "flex h-8 items-center gap-1.5 rounded-md px-3 text-xs font-medium transition-colors",
                    tab === id ? "bg-panel2 text-fg shadow-sm" : "text-fg/45 hover:text-fg/70",
                  )}
                >
                  <Icon className="h-3.5 w-3.5" />
                  {label}
                </button>
              ))}
            </div>

            <div className="flex-1" />

            {tab === "pivot" && (
              <div className="hidden items-center gap-1 lg:flex">
                {PIVOT_VIZ_OPTIONS.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => setPivotViz(option.value)}
                    className={cn(
                      "h-7 rounded-md border px-2 text-[11px] font-medium transition-colors",
                      pivotViz === option.value ? "border-accent/30 bg-accent/10 text-accent" : "border-line bg-bg/35 text-fg/55 hover:bg-panel2",
                    )}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            )}

            <Select
              value={lineItemQuantityKey}
              onValueChange={setLineItemQuantityKey}
              options={numericOptions}
              size="xs"
              triggerClassName="w-44"
              ariaLabel="Estimate quantity basis"
            />
            <Button variant="secondary" size="xs" onClick={tab === "pivot" ? exportPivot : exportRows}>
              <Download className="h-3.5 w-3.5" />
              CSV
            </Button>
          </div>

          <div className="min-h-0 flex-1 overflow-auto bg-bg/25">
            {loadingRows ? (
              <div className="flex h-full items-center justify-center">
                <div className="flex items-center gap-3 rounded-lg border border-line bg-panel px-4 py-3 text-sm text-fg/60">
                  <Loader2 className="h-4 w-4 animate-spin text-accent" />
                  Building model analysis rows...
                </div>
              </div>
            ) : assets.length === 0 ? (
              <div className="flex h-full items-center justify-center p-6">
                <EmptyState className="max-w-xl border-none">
                  <Box className="mx-auto mb-3 h-10 w-10 text-fg/20" />
                  <p className="text-sm font-semibold text-fg/70">No indexed CAD/BIM models yet</p>
                  <p className="mt-1 text-xs text-fg/40">
                    Upload DWG, IFC, BIM, or Bidwright model files in project documents, then sync the model index to analyze quantities.
                  </p>
                  <Button className="mt-4" variant="secondary" size="sm" onClick={() => void refreshAssets(true)}>
                    <RefreshCw className="h-3.5 w-3.5" />
                    Sync Model Index
                  </Button>
                </EmptyState>
              </div>
            ) : rows.length === 0 ? (
              <div className="flex h-full items-center justify-center p-6">
                <EmptyState className="max-w-xl border-none">
                  <Database className="mx-auto mb-3 h-10 w-10 text-fg/20" />
                  <p className="text-sm font-semibold text-fg/70">No model objects matched this scope</p>
                  <p className="mt-1 text-xs text-fg/40">Clear the search, pick a different model, or sync the model index.</p>
                </EmptyState>
              </div>
            ) : tab === "table" ? (
              <DataTable
                rows={filteredRows}
                numericColumns={numericColumns}
                lineItemQuantityKey={lineItemQuantityKey}
                creatingRowId={creatingRowId}
                onCreateLine={createLineFromRow}
                onAddSlicer={addSlicer}
              />
            ) : tab === "pivot" ? (
              <PivotView
                rows={pivotRows}
                groupBy={groupBy.length ? groupBy : ["modelName"]}
                aggCols={aggCols}
                aggFn={aggFn}
                viz={pivotViz}
                maxByMetric={pivotMaxByMetric}
                topMetric={topMetric}
                onAddSlicer={addSlicer}
              />
            ) : tab === "charts" ? (
              <ChartView
                dimensionOptions={dimensionOptions}
                numericOptions={numericOptions}
                dimension={chartDimension}
                metric={chartMetric}
                rows={chartRows}
                max={chartMax}
                onDimensionChange={setChartDimension}
                onMetricChange={setChartMetric}
                onAddSlicer={addSlicer}
              />
            ) : (
              <DescribeView stats={describeStats} rows={filteredRows} />
            )}
          </div>
        </main>
      </div>
    </div>
  );
}

function DataTable({
  rows,
  numericColumns,
  lineItemQuantityKey,
  creatingRowId,
  onCreateLine,
  onAddSlicer,
}: {
  rows: ExplorerRow[];
  numericColumns: string[];
  lineItemQuantityKey: string;
  creatingRowId: string | null;
  onCreateLine: (row: ExplorerRow) => Promise<void>;
  onAddSlicer: (column: string, value: string) => void;
}) {
  const columns = [
    "name",
    "elementClass",
    "elementType",
    "system",
    "level",
    "material",
    "linked",
    ...numericColumns.filter((column) => column !== COUNT_KEY).slice(0, 8),
  ];

  return (
    <div className="h-full overflow-auto">
      <table className="min-w-full border-separate border-spacing-0 text-xs">
        <thead className="sticky top-0 z-10 bg-panel">
          <tr>
            <th className="border-b border-line px-3 py-2 text-left font-semibold text-fg/45">Action</th>
            {columns.map((column) => (
              <th key={column} className="border-b border-line px-3 py-2 text-left font-semibold text-fg/45">
                {column.startsWith("qty:") ? quantityLabel(column) : dimensionLabel(column)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.slice(0, 1000).map((row) => (
            <tr key={row.id} className="group hover:bg-panel/70">
              <td className="border-b border-line/60 px-3 py-2 align-top">
                <Button
                  variant={row.linked ? "ghost" : "secondary"}
                  size="xs"
                  disabled={row.linked || creatingRowId === row.id}
                  onClick={() => void onCreateLine(row)}
                  title={row.linked ? "This object is already linked to the estimate" : `Create line using ${quantityLabel(lineItemQuantityKey)}`}
                >
                  {creatingRowId === row.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sigma className="h-3 w-3" />}
                  {row.linked ? "Linked" : "Estimate"}
                </Button>
              </td>
              {columns.map((column) => {
                const value = row.data[column];
                const text = normalizeValue(value);
                const isNumeric = typeof value === "number";
                return (
                  <td key={column} className="max-w-[260px] border-b border-line/60 px-3 py-2 align-top text-fg/70">
                    {DIMENSIONS.includes(column as typeof DIMENSIONS[number]) ? (
                      <button
                        type="button"
                        onClick={() => onAddSlicer(column, text)}
                        className="max-w-full truncate rounded px-1.5 py-0.5 text-left hover:bg-accent/10 hover:text-accent"
                      >
                        {text}
                      </button>
                    ) : (
                      <span className={cn("block truncate", isNumeric && "font-mono")}>
                        {isNumeric ? formatNumber(value as number) : text}
                      </span>
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function PivotView({
  rows,
  groupBy,
  aggCols,
  aggFn,
  viz,
  maxByMetric,
  topMetric,
  onAddSlicer,
}: {
  rows: PivotRow[];
  groupBy: string[];
  aggCols: string[];
  aggFn: AggFn;
  viz: PivotVizMode;
  maxByMetric: Record<string, number>;
  topMetric: string;
  onAddSlicer: (column: string, value: string) => void;
}) {
  if (viz === "bars") {
    return (
      <div className="space-y-2 p-4">
        {rows.map((row) => {
          const value = row.values[topMetric] ?? 0;
          const width = `${Math.max(3, Math.min(100, (Math.abs(value) / (maxByMetric[topMetric] || 1)) * 100))}%`;
          return (
            <button
              key={row.key}
              type="button"
              onClick={() => onAddSlicer(groupBy[0], row.groupValues[groupBy[0]] ?? EMPTY_VALUE)}
              className="grid w-full grid-cols-[minmax(180px,280px)_1fr_110px] items-center gap-3 rounded-lg border border-line bg-panel px-3 py-2 text-left hover:border-accent/25 hover:bg-panel2/60"
            >
              <span className="truncate text-xs font-medium text-fg/75">{row.key}</span>
              <span className="h-2 overflow-hidden rounded-full bg-fg/8">
                <span className="block h-full rounded-full bg-accent" style={{ width }} />
              </span>
              <span className="text-right font-mono text-xs text-fg/65">{formatNumber(value)}</span>
            </button>
          );
        })}
      </div>
    );
  }

  if (viz === "matrix" && groupBy.length >= 2) {
    return <MatrixView rows={rows} rowColumn={groupBy[0]} colColumn={groupBy[1]} metric={topMetric} />;
  }

  return (
    <div className="h-full overflow-auto">
      <table className="min-w-full border-separate border-spacing-0 text-xs">
        <thead className="sticky top-0 z-10 bg-panel">
          <tr>
            {groupBy.map((column) => (
              <th key={column} className="border-b border-line px-3 py-2 text-left font-semibold text-fg/45">
                {dimensionLabel(column)}
              </th>
            ))}
            {aggCols.map((column) => (
              <th key={column} className="border-b border-line px-3 py-2 text-right font-semibold text-fg/45">
                {aggFn.toUpperCase()} {quantityLabel(column)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.key} className="hover:bg-panel/70">
              {groupBy.map((column) => {
                const value = row.groupValues[column] ?? EMPTY_VALUE;
                return (
                  <td key={column} className="max-w-[280px] border-b border-line/60 px-3 py-2 text-fg/70">
                    <button
                      type="button"
                      onClick={() => onAddSlicer(column, value)}
                      className="max-w-full truncate rounded px-1.5 py-0.5 text-left hover:bg-accent/10 hover:text-accent"
                    >
                      {value}
                    </button>
                  </td>
                );
              })}
              {aggCols.map((column) => {
                const value = row.values[column] ?? 0;
                const intensity = Math.min(0.28, Math.abs(value) / (maxByMetric[column] || 1) * 0.28);
                return (
                  <td
                    key={column}
                    className="border-b border-line/60 px-3 py-2 text-right font-mono text-fg/75"
                    style={viz === "heatmap" ? { backgroundColor: `rgba(14, 165, 233, ${intensity})` } : undefined}
                  >
                    {formatNumber(value)}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function MatrixView({
  rows,
  rowColumn,
  colColumn,
  metric,
}: {
  rows: PivotRow[];
  rowColumn: string;
  colColumn: string;
  metric: string;
}) {
  const rowKeys = Array.from(new Set(rows.map((row) => row.groupValues[rowColumn] ?? EMPTY_VALUE)));
  const colKeys = Array.from(new Set(rows.map((row) => row.groupValues[colColumn] ?? EMPTY_VALUE))).slice(0, 24);
  const values = new Map(rows.map((row) => [`${row.groupValues[rowColumn]}::${row.groupValues[colColumn]}`, row.values[metric] ?? 0]));
  const max = Math.max(1, ...Array.from(values.values()).map(Math.abs));

  return (
    <div className="h-full overflow-auto p-4">
      <table className="min-w-full border-separate border-spacing-0 text-xs">
        <thead>
          <tr>
            <th className="sticky left-0 top-0 z-20 border-b border-line bg-panel px-3 py-2 text-left font-semibold text-fg/45">
              {dimensionLabel(rowColumn)}
            </th>
            {colKeys.map((column) => (
              <th key={column} className="sticky top-0 z-10 max-w-[160px] border-b border-line bg-panel px-3 py-2 text-right font-semibold text-fg/45">
                <span className="block truncate">{column}</span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rowKeys.map((rowKey) => (
            <tr key={rowKey}>
              <td className="sticky left-0 z-10 max-w-[240px] border-b border-line/60 bg-panel px-3 py-2 font-medium text-fg/70">
                <span className="block truncate">{rowKey}</span>
              </td>
              {colKeys.map((colKey) => {
                const value = values.get(`${rowKey}::${colKey}`) ?? 0;
                const intensity = Math.min(0.32, Math.abs(value) / max * 0.32);
                return (
                  <td
                    key={colKey}
                    className="border-b border-line/60 px-3 py-2 text-right font-mono text-fg/70"
                    style={{ backgroundColor: `rgba(14, 165, 233, ${intensity})` }}
                  >
                    {value ? formatNumber(value) : "-"}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ChartView({
  dimensionOptions,
  numericOptions,
  dimension,
  metric,
  rows,
  max,
  onDimensionChange,
  onMetricChange,
  onAddSlicer,
}: {
  dimensionOptions: Array<{ value: string; label: string }>;
  numericOptions: Array<{ value: string; label: string }>;
  dimension: string;
  metric: string;
  rows: PivotRow[];
  max: number;
  onDimensionChange: (value: string) => void;
  onMetricChange: (value: string) => void;
  onAddSlicer: (column: string, value: string) => void;
}) {
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-center gap-2 border-b border-line bg-panel px-3 py-2">
        <Select value={dimension} onValueChange={onDimensionChange} options={dimensionOptions} size="sm" triggerClassName="w-44" />
        <Select value={metric} onValueChange={onMetricChange} options={numericOptions} size="sm" triggerClassName="w-44" />
      </div>
      <div className="min-h-0 flex-1 overflow-auto p-4">
        <div className="grid gap-2">
          {rows.map((row) => {
            const label = row.groupValues[dimension] ?? EMPTY_VALUE;
            const value = row.values[metric] ?? 0;
            const width = `${Math.max(3, Math.min(100, (Math.abs(value) / max) * 100))}%`;
            return (
              <button
                key={row.key}
                type="button"
                onClick={() => onAddSlicer(dimension, label)}
                className="grid grid-cols-[minmax(160px,320px)_1fr_120px] items-center gap-3 rounded-lg border border-line bg-panel px-3 py-2 text-left hover:border-accent/25 hover:bg-panel2/60"
              >
                <span className="truncate text-xs font-medium text-fg/75">{label}</span>
                <span className="h-8 rounded-md bg-bg/60 p-1">
                  <span className="block h-full rounded bg-accent/75" style={{ width }} />
                </span>
                <span className="text-right font-mono text-xs text-fg/65">{formatNumber(value)}</span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function DescribeView({ stats, rows }: { stats: NumericStats[]; rows: ExplorerRow[] }) {
  return (
    <div className="h-full overflow-auto p-4">
      <div className="mb-4 grid grid-cols-4 gap-2">
        {[
          ["Rows", rows.length],
          ["Linked", rows.filter((row) => row.linked).length],
          ["Unique Classes", new Set(rows.map((row) => normalizeValue(row.data.elementClass))).size],
          ["Unique Levels", new Set(rows.map((row) => normalizeValue(row.data.level))).size],
        ].map(([label, value]) => (
          <div key={label} className="rounded-lg border border-line bg-panel px-3 py-2">
            <div className="text-[10px] font-medium uppercase tracking-wide text-fg/35">{label}</div>
            <div className="text-sm font-semibold text-fg">{formatNumber(Number(value), 0)}</div>
          </div>
        ))}
      </div>
      <table className="min-w-full border-separate border-spacing-0 text-xs">
        <thead className="sticky top-0 z-10 bg-panel">
          <tr>
            {["Metric", "Count", "Sum", "Avg", "Min", "Max"].map((header) => (
              <th key={header} className="border-b border-line px-3 py-2 text-left font-semibold text-fg/45">
                {header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {stats.map((stat) => (
            <tr key={stat.key} className="hover:bg-panel/70">
              <td className="border-b border-line/60 px-3 py-2 font-medium text-fg/75">{quantityLabel(stat.key)}</td>
              <td className="border-b border-line/60 px-3 py-2 font-mono text-fg/65">{formatNumber(stat.count, 0)}</td>
              <td className="border-b border-line/60 px-3 py-2 font-mono text-fg/65">{formatNumber(stat.sum)}</td>
              <td className="border-b border-line/60 px-3 py-2 font-mono text-fg/65">{formatNumber(stat.avg)}</td>
              <td className="border-b border-line/60 px-3 py-2 font-mono text-fg/65">{formatNumber(stat.min)}</td>
              <td className="border-b border-line/60 px-3 py-2 font-mono text-fg/65">{formatNumber(stat.max)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
