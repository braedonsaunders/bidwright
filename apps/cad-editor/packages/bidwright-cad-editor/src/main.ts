import {
  AcApDocManager,
  type AcApOpenDatabaseOptions,
  AcEdOpenMode,
} from "@mlightcad/cad-simple-viewer";
import "./styles.css";

type SourceKind = "source_document" | "file_node";
type CadMode = "preview" | "takeoff";

interface BidwrightCadEditorBootOptions {
  fileUrl: string | null;
  fileName: string;
  projectId: string | null;
  documentId: string | null;
  sourceKind: SourceKind | null;
  mode: CadMode;
  syncChannelName: string | null;
}

interface CadEntityRow {
  id: string;
  type: string;
  layer: string;
  layoutName: string;
  label: string;
  color: string;
  measurementLabel: string;
  quantity: number;
  uom: string;
  sourceEntityIds: string[];
  isLinked: boolean;
  linkCount: number;
}

interface CadLayerSummary {
  name: string;
  color: string;
  count: number;
  visible: boolean;
}

interface CadLayoutSummary {
  name: string;
  entityCount: number;
}

interface CadIntelligenceSnapshot {
  documentId: string;
  fileName: string;
  selectedLayout: string;
  selectedEntityId: string | null;
  savingEntityId: string | null;
  entityCount: number;
  visibleEntityCount: number;
  layerCount: number;
  annotationCount: number;
  layouts: CadLayoutSummary[];
  layers: CadLayerSummary[];
  entities: CadEntityRow[];
  autoCounts: [];
  systems: [];
  status: "idle" | "processing" | "ready" | "error";
  processedAt: string;
}

type HostMessage =
  | { source: "bidwright-cad-host"; type: "bidwright:cad-command"; command: string }
  | { source: "bidwright-cad-host"; type: "bidwright:cad-select-entities"; entityIds: string[] }
  | { source: "bidwright-cad-host"; type: "bidwright:cad-fit" }
  | { source: "bidwright-cad-host"; type: "bidwright:cad-save" };

type AnyRecord = Record<string, unknown>;

const SOURCE = "bidwright-cad-editor";

class BidwrightCadEditorApp {
  private readonly options: BidwrightCadEditorBootOptions;
  private readonly container: HTMLDivElement;
  private readonly statusText: HTMLSpanElement;
  private readonly channel: BroadcastChannel | null;
  private loaded = false;
  private snapshot: CadIntelligenceSnapshot | null = null;
  private selectionListenerBound = false;

  constructor(options: BidwrightCadEditorBootOptions) {
    this.options = options;
    this.container = mustGetElement<HTMLDivElement>("cad-container");
    this.statusText = mustGetElement<HTMLSpanElement>("status-text");
    this.channel = options.syncChannelName && "BroadcastChannel" in window
      ? new BroadcastChannel(options.syncChannelName)
      : null;
  }

  async start(): Promise<void> {
    this.setStatus("Initializing CAD editor");
    this.createManager();
    this.bindHostMessages();
    this.post("bidwright:cad-ready", {});

    if (this.options.fileUrl) {
      await this.openUrl(this.options.fileUrl);
    } else {
      this.setStatus("Ready for a DXF or DWG file");
      this.publishSnapshot("ready");
    }
  }

  private createManager(): void {
    AcApDocManager.createInstance({
      container: this.container,
      busyIndicatorHost: this.container,
      autoResize: true,
      baseUrl: "https://cdn.jsdelivr.net/gh/mlightcad/cad-data@main/",
      commandAliases: {
        LINE: ["L"],
        PLINE: ["PL"],
        RECTANG: ["REC"],
        CIRCLE: ["C"],
        ERASE: ["E"],
        MOVE: ["M"],
        COPY: ["CO"],
        ROTATE: ["RO"],
        OFFSET: ["O"],
        SELECT: ["SE"],
        ZOOM: ["Z"],
        UNDO: ["U"],
      },
      webworkerFileUrls: {
        dxfParser: "./workers/dxf-parser-worker.js",
        dwgParser: "./workers/libredwg-parser-worker.js",
        mtextRender: "./workers/mtext-renderer-worker.js",
      },
      htmlViewerRuntimeUrl: "./viewer-runtime.iife.js",
    });

    AcApDocManager.instance.events.documentActivated.addEventListener((args) => {
      this.setStatus(`Loaded ${args.doc.docTitle || this.options.fileName}`);
      this.bindSelectionEvents();
      this.loaded = true;
      this.publishSnapshot("ready");
      this.post("bidwright:cad-loaded", {
        documentId: this.documentId,
        fileName: this.options.fileName,
        entityCount: this.snapshot?.entityCount ?? 0,
      });
    });
  }

  private async openUrl(url: string): Promise<void> {
    this.setStatus(`Opening ${this.options.fileName}`);
    this.publishSnapshot("processing");
    try {
      const response = await fetch(url, { credentials: "include", cache: "no-store" });
      if (!response.ok) {
        throw new Error(`Download failed with ${response.status}`);
      }
      const content = await response.arrayBuffer();
      const options: AcApOpenDatabaseOptions = {
        minimumChunkSize: 1000,
        mode: AcEdOpenMode.Write,
        sysVars: {
          lwdisplay: false,
        },
      };
      const success = await AcApDocManager.instance.openDocument(this.options.fileName, content, options);
      if (!success) {
        throw new Error("The CAD parser could not open this file.");
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown CAD load error";
      this.setStatus(message);
      this.post("bidwright:cad-error", { message });
      this.publishSnapshot("error");
    }
  }

  private bindHostMessages(): void {
    window.addEventListener("message", (event) => {
      const message = event.data as Partial<HostMessage> | undefined;
      if (!message || message.source !== "bidwright-cad-host") return;
      this.handleHostMessage(message as HostMessage);
    });

    this.channel?.addEventListener("message", (event) => {
      const message = event.data as Partial<HostMessage> | undefined;
      if (!message || message.source !== "bidwright-cad-host") return;
      this.handleHostMessage(message as HostMessage);
    });
  }

  private handleHostMessage(message: HostMessage): void {
    if (message.type === "bidwright:cad-command") {
      this.runCommand(message.command);
      return;
    }
    if (message.type === "bidwright:cad-select-entities") {
      this.selectEntities(message.entityIds);
      return;
    }
    if (message.type === "bidwright:cad-fit") {
      this.runCommand("zoom\nall");
      return;
    }
    if (message.type === "bidwright:cad-save") {
      this.saveDxf();
    }
  }

  private bindSelectionEvents(): void {
    if (this.selectionListenerBound) return;
    this.selectionListenerBound = true;
    const selectionSet = AcApDocManager.instance.curView.selectionSet;
    const publish = () => this.publishSelection(selectionSet.ids);
    selectionSet.events.selectionAdded.addEventListener(publish);
    selectionSet.events.selectionRemoved.addEventListener(publish);
  }

  private runCommand(command: string): void {
    if (!this.loaded && command !== "zoom\nall") return;
    AcApDocManager.instance.sendStringToExecute(command);
    this.setStatus(command.split(/\s+/)[0]?.toUpperCase() || "Command");
    window.setTimeout(() => this.publishSnapshot("ready"), 150);
  }

  private selectEntities(ids: string[]): void {
    if (!this.loaded) return;
    const selectionSet = AcApDocManager.instance.curView.selectionSet;
    selectionSet.clear();
    if (ids.length > 0) {
      selectionSet.add(ids);
    }
    this.publishSelection(ids);
  }

  private saveDxf(): void {
    if (!this.loaded) return;
    try {
      const dxfContent = AcApDocManager.instance.curDocument.database.dxfOut(undefined, 6);
      const savedFileName = ensureDxfName(this.options.fileName);
      this.post("bidwright:cad-save", {
        documentId: this.documentId,
        sourceKind: this.options.sourceKind,
        fileName: savedFileName,
        dxfContent,
      });
      this.setStatus(`Saved ${savedFileName}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not export DXF";
      this.post("bidwright:cad-error", { message });
      this.setStatus(message);
    }
  }

  private publishSelection(entityIds: string[]): void {
    const snapshot = this.publishSnapshot("ready");
    const selectedEntities = entityIds
      .map((id) => snapshot.entities.find((entity) => entity.id === id))
      .filter((entity): entity is CadEntityRow => Boolean(entity));
    this.post("bidwright:cad-selection", {
      documentId: this.documentId,
      entityIds,
      entities: selectedEntities,
    });
  }

  private publishSnapshot(status: CadIntelligenceSnapshot["status"]): CadIntelligenceSnapshot {
    const snapshot = this.buildSnapshot(status);
    this.snapshot = snapshot;
    this.post("bidwright:cad-intelligence", { snapshot });
    return snapshot;
  }

  private buildSnapshot(status: CadIntelligenceSnapshot["status"]): CadIntelligenceSnapshot {
    if (!this.loaded || status === "error") {
      return {
        documentId: this.documentId,
        fileName: this.options.fileName,
        selectedLayout: "Model",
        selectedEntityId: null,
        savingEntityId: null,
        entityCount: 0,
        visibleEntityCount: 0,
        layerCount: 0,
        annotationCount: 0,
        layouts: [],
        layers: [],
        entities: [],
        autoCounts: [],
        systems: [],
        status,
        processedAt: new Date().toISOString(),
      };
    }

    const db = AcApDocManager.instance.curDocument.database as unknown as AnyRecord;
    const selectedIds = new Set(AcApDocManager.instance.curView.selectionSet.ids);
    const layouts = collectLayouts(db);
    const layerColorByName = collectLayerColors(db);
    const rows: CadEntityRow[] = [];
    const layoutCounts = new Map<string, number>();
    const layerCounts = new Map<string, number>();

    for (const layout of layouts) {
      const entities = collectLayoutEntities(db, layout);
      layoutCounts.set(layout.name, entities.length);
      for (const entity of entities) {
        const row = toEntityRow(entity, layout.name, layerColorByName);
        rows.push(row);
        layerCounts.set(row.layer, (layerCounts.get(row.layer) ?? 0) + 1);
      }
    }

    const layers = [...layerCounts.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([name, count]) => ({
        name,
        color: layerColorByName.get(name) ?? "#94a3b8",
        count,
        visible: true,
      }));

    return {
      documentId: this.documentId,
      fileName: this.options.fileName,
      selectedLayout: layouts[0]?.name ?? "Model",
      selectedEntityId: [...selectedIds][0] ?? null,
      savingEntityId: null,
      entityCount: rows.length,
      visibleEntityCount: rows.length,
      layerCount: layers.length,
      annotationCount: 0,
      layouts: layouts.map((layout) => ({
        name: layout.name,
        entityCount: layoutCounts.get(layout.name) ?? 0,
      })),
      layers,
      entities: rows,
      autoCounts: [],
      systems: [],
      status,
      processedAt: new Date().toISOString(),
    };
  }

  private post(type: string, payload: AnyRecord): void {
    const message = {
      source: SOURCE,
      type,
      projectId: this.options.projectId,
      documentId: this.documentId,
      mode: this.options.mode,
      ...payload,
    };
    window.parent?.postMessage(message, "*");
    this.channel?.postMessage(message);
  }

  private setStatus(text: string): void {
    this.statusText.textContent = text;
  }

  private get documentId(): string {
    return this.options.documentId || this.options.fileName;
  }
}

function collectLayouts(db: AnyRecord): Array<{ name: string; btrId: string | null; block?: AnyRecord }> {
  const layouts: Array<{ name: string; btrId: string | null; block?: AnyRecord }> = [];
  const layoutDictionary = recordAt(recordAt(db, "objects"), "layout");
  const layoutIterator = methodIterable(layoutDictionary, "newIterator");
  const blockTable = recordAt(recordAt(db, "tables"), "blockTable");

  if (layoutIterator.length > 0) {
    for (const rawLayout of layoutIterator) {
      const layout = asRecord(rawLayout);
      const name = stringValue(layout.layoutName) || stringValue(layout.name) || "Layout";
      const btrId = stringValue(layout.blockTableRecordId);
      const block = findBlockById(blockTable, btrId);
      layouts.push({ name, btrId, block });
    }
  }

  if (layouts.length === 0) {
    const modelSpace = asRecord(blockTable.modelSpace);
    layouts.push({ name: "Model", btrId: stringValue(modelSpace.objectId), block: modelSpace });
  }

  return layouts;
}

function collectLayoutEntities(db: AnyRecord, layout: { block?: AnyRecord }): AnyRecord[] {
  const block = layout.block ?? asRecord(recordAt(recordAt(recordAt(db, "tables"), "blockTable"), "modelSpace"));
  return methodIterable(block, "newIterator").map(asRecord).filter((entity) => Boolean(stringValue(entity.objectId) || stringValue(entity.id)));
}

function collectLayerColors(db: AnyRecord): Map<string, string> {
  const result = new Map<string, string>();
  const layerTable = recordAt(recordAt(db, "tables"), "layerTable");
  for (const rawLayer of methodIterable(layerTable, "newIterator")) {
    const layer = asRecord(rawLayer);
    const name = stringValue(layer.name);
    if (name) {
      result.set(name, colorToHex(layer.color ?? layer.resolvedColor));
    }
  }
  return result;
}

function findBlockById(blockTable: AnyRecord, btrId: string | null): AnyRecord | undefined {
  if (!btrId) return undefined;
  const getIdAt = blockTable.getIdAt;
  if (typeof getIdAt === "function") {
    const found = getIdAt.call(blockTable, btrId);
    if (found) return asRecord(found);
  }
  for (const rawBlock of methodIterable(blockTable, "newIterator")) {
    const block = asRecord(rawBlock);
    if (stringValue(block.objectId) === btrId) return block;
  }
  return undefined;
}

function toEntityRow(entity: AnyRecord, layoutName: string, layerColorByName: Map<string, string>): CadEntityRow {
  const id = stringValue(entity.objectId) || stringValue(entity.id) || `entity-${Math.random().toString(36).slice(2)}`;
  const type = entityType(entity);
  const layer = stringValue(entity.layer) || "0";
  const measurement = entityMeasurement(entity, type);
  return {
    id,
    type,
    layer,
    layoutName,
    label: entityLabel(entity, type),
    color: colorToHex(entity.resolvedColor ?? entity.color) || layerColorByName.get(layer) || "#94a3b8",
    measurementLabel: measurement.label,
    quantity: measurement.quantity,
    uom: measurement.uom,
    sourceEntityIds: [id],
    isLinked: false,
    linkCount: 0,
  };
}

function entityType(entity: AnyRecord): string {
  const raw = stringValue(entity.dxfTypeName) || stringValue(entity.type) || stringValue(entity.className) || stringValue(asRecord(entity.constructor).name);
  return (raw || "ENTITY").replace(/^AcDb/i, "").toUpperCase();
}

function entityLabel(entity: AnyRecord, type: string): string {
  const text = stringValue(entity.textString) || stringValue(entity.text) || stringValue(entity.contents);
  if (text) return text.length > 80 ? `${text.slice(0, 77)}...` : text;
  const id = stringValue(entity.objectId) || stringValue(entity.id);
  return id ? `${type} ${id}` : type;
}

function entityMeasurement(entity: AnyRecord, type: string): { label: string; quantity: number; uom: string } {
  const area = numberValue(entity.area);
  if (area && Number.isFinite(area) && Math.abs(area) > 0) {
    return { label: `${formatNumber(Math.abs(area))} du2`, quantity: Math.abs(area), uom: "du2" };
  }

  const length = entityLength(entity);
  if (length > 0) {
    return { label: `${formatNumber(length)} du`, quantity: length, uom: "du" };
  }

  if (type.includes("CIRCLE") || type.includes("TEXT") || type.includes("INSERT") || type.includes("POINT")) {
    return { label: "1 EA", quantity: 1, uom: "EA" };
  }

  return { label: "1 EA", quantity: 1, uom: "EA" };
}

function entityLength(entity: AnyRecord): number {
  const explicitLength = numberValue(entity.length) ?? numberValue(entity.arcLength);
  if (explicitLength && Number.isFinite(explicitLength)) return Math.abs(explicitLength);

  const start = pointValue(entity.startPoint ?? entity.start);
  const end = pointValue(entity.endPoint ?? entity.end);
  if (start && end) {
    return distance(start, end);
  }

  const vertices = arrayValue(entity.vertices ?? entity.points);
  if (vertices.length > 1) {
    let total = 0;
    const points = vertices.map(pointValue).filter((point): point is { x: number; y: number } => Boolean(point));
    for (let index = 1; index < points.length; index += 1) {
      total += distance(points[index - 1], points[index]);
    }
    if (entity.closed && points.length > 2) {
      total += distance(points[points.length - 1], points[0]);
    }
    return total;
  }

  const radius = numberValue(entity.radius);
  if (radius && Number.isFinite(radius) && radius > 0) {
    return 2 * Math.PI * radius;
  }

  return 0;
}

function distance(a: { x: number; y: number }, b: { x: number; y: number }): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

function pointValue(value: unknown): { x: number; y: number } | null {
  const record = asRecord(value);
  const x = numberValue(record.x ?? record[0]);
  const y = numberValue(record.y ?? record[1]);
  if (x == null || y == null) return null;
  return { x, y };
}

function colorToHex(value: unknown): string {
  const record = asRecord(value);
  const direct = numberValue(value) ?? numberValue(record.rgb) ?? numberValue(record.RGB) ?? numberValue(record.trueColor);
  if (direct != null && Number.isFinite(direct)) {
    return `#${Math.max(0, direct & 0xffffff).toString(16).padStart(6, "0")}`;
  }
  const css = stringValue(value) || stringValue(record.css) || stringValue(record.hex);
  if (css?.startsWith("#")) return css;
  const components = arrayValue(value);
  if (components.length >= 3) {
    const [r, g, b] = components.map((component) => numberValue(component) ?? 0);
    return `#${[r, g, b].map((component) => Math.max(0, Math.min(255, Math.round(component))).toString(16).padStart(2, "0")).join("")}`;
  }
  return "#94a3b8";
}

function recordAt(record: AnyRecord, key: string): AnyRecord {
  return asRecord(record[key]);
}

function asRecord(value: unknown): AnyRecord {
  return typeof value === "object" && value !== null ? value as AnyRecord : {};
}

function arrayValue(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function numberValue(value: unknown): number | undefined {
  const number = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  return Number.isFinite(number) ? number : undefined;
}

function iterableFrom(value: unknown): unknown[] {
  const record = asRecord(value);
  if (typeof record.toArray === "function") {
    try {
      const array = record.toArray();
      return Array.isArray(array) ? array : [];
    } catch {
      return [];
    }
  }
  if (value && typeof (value as Iterable<unknown>)[Symbol.iterator] === "function") {
    return Array.from(value as Iterable<unknown>);
  }
  return [];
}

function methodIterable(record: AnyRecord, methodName: string): unknown[] {
  const method = record[methodName];
  if (typeof method !== "function") return [];
  try {
    return iterableFrom(method.call(record));
  } catch {
    return [];
  }
}

function formatNumber(value: number): string {
  if (value >= 100) return value.toFixed(0);
  if (value >= 10) return value.toFixed(1);
  return value.toFixed(2);
}

function ensureDxfName(fileName: string): string {
  const cleaned = fileName.trim() || "Drawing";
  return cleaned.toLowerCase().endsWith(".dxf") ? cleaned : `${cleaned.replace(/\.[^.]+$/, "")}.dxf`;
}

function readBootOptions(): BidwrightCadEditorBootOptions {
  const params = new URLSearchParams(window.location.search);
  return {
    fileUrl: params.get("url"),
    fileName: params.get("fileName") || "Drawing.dxf",
    projectId: params.get("projectId"),
    documentId: params.get("documentId"),
    sourceKind: params.get("sourceKind") === "file_node" || params.get("sourceKind") === "source_document"
      ? params.get("sourceKind") as SourceKind
      : null,
    mode: params.get("mode") === "takeoff" ? "takeoff" : "preview",
    syncChannelName: params.get("syncChannelName"),
  };
}

function mustGetElement<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Missing #${id}`);
  return element as T;
}

void new BidwrightCadEditorApp(readBootOptions()).start();
