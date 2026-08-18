"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Group, Panel, Separator, useDefaultLayout, type LayoutStorage } from "react-resizable-panels";
import { ArrowRight, Check, ChevronDown, Compass, GripHorizontal, Layers, Loader2, Maximize2, Minimize2, PanelRightClose, Search, TableProperties, X } from "lucide-react";
import { Button, Input } from "@braedonsaunders/appkit-ui";
import type { CreateWorksheetItemInput, ProjectWorkspaceData, WorkspaceResponse } from "@/lib/api";
import { createLiveActionBridge } from "@/lib/live-action-bridge";
import { cn } from "@/lib/utils";
import { TakeoffTab } from "./takeoff-tab";
import { EstimateGrid, type WorksheetLineItemPickerRequest } from "./estimate-grid";
import { TakeoffLinkView, type TakeoffSelection } from "./takeoff-link-view";
import { TakeoffInspectView, type InspectActions, type InspectQuantityOption, type InspectQuantitySelection, type InspectSnapshot, type TakeoffComposeRequest } from "./takeoff-inspect-view";
import type { Pickup } from "./takeoff/annotation-canvas";
import { PersistentTakeoffController } from "./persistent-takeoff-controller";

type PluginToolsTarget = { pluginId?: string; pluginSlug?: string; toolId?: string };
/** Browse, inspect and worksheet composition are independent states. */
type RightPanelTab = "pickups" | "inspect" | "add";

export interface ComboViewProps {
  workspace: ProjectWorkspaceData;
  onApply: (next: WorkspaceResponse | ((prev: WorkspaceResponse) => WorkspaceResponse)) => void;
  onError: (msg: string) => void;
  onRefresh: () => void;
  onOpenAgentChat?: (prefill?: string) => void;
  onOpenRevisionDiff?: () => void;
  /** Navigate the workspace to the Documents tab (takeoff "Project Files" card). */
  onOpenDocuments?: () => void;
  onOpenPluginTools?: (target?: PluginToolsTarget) => void;
  onOpenTakeoffLink?: (worksheetItemId: string) => void;
  onWorkspaceMutated?: () => void;
  workspaceSyncOriginId?: string;
  selectedWorksheetId?: string | null;
  activeWorksheetId?: string;
  onActiveWorksheetChange?: (worksheetId: string) => void;
  initialDocumentId?: string | null;
  highlightItemId?: string;
  /** Forwarded to the embedded EstimateGrid so BIM-linked worksheet rows
   *  display the latest revision-diff impact chip. */
  revisionImpactByItem?: Record<string, {
    oldQuantity: number;
    newQuantity: number;
    costDelta: number;
    changeType: "added" | "removed" | "modified";
    changeName: string;
    changeClass: string;
  }>;
}

function serializeTakeoffSelection(selection: TakeoffSelection | null) {
  return selection ? JSON.stringify(selection) : "null";
}

type TakeoffViewState = { documentId: string; page: number; zoom: number };

function serializeTakeoffViewState(state: TakeoffViewState | null) {
  return state ? JSON.stringify(state) : "null";
}

function humanizeQuantityLabel(value: string) {
  return value
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[._:-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^./, (letter) => letter.toUpperCase());
}

function numericPropertyQuantityOptions(properties: Record<string, unknown>, modelUnit = "") {
  const options: InspectQuantityOption[] = [];
  const numericValue = (value: unknown) => {
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value !== "string" || !/^[-+]?(?:\d+(?:,\d{3})*|\d*)(?:\.\d+)?(?:[eE][-+]?\d+)?$/.test(value.trim())) return null;
    const parsed = Number(value.trim().replace(/,/g, ""));
    return Number.isFinite(parsed) ? parsed : null;
  };
  const inferredUnit = (key: string, explicit = "") => {
    if (explicit) return explicit;
    const lower = key.toLowerCase();
    if (lower.includes("area")) return modelUnit ? `${modelUnit}²` : "";
    if (lower.includes("volume")) return modelUnit ? `${modelUnit}³` : "";
    if (/length|width|height|depth|diameter|radius|perimeter|circumference|thickness|offset|elevation|\.(?:bop|top)$/i.test(lower)) return modelUnit;
    return "";
  };
  const inferredType = (key: string) => /length|perimeter|circumference/i.test(key) ? "length" : /area/i.test(key) ? "area" : /volume/i.test(key) ? "volume" : undefined;
  const visit = (value: unknown, path: string[], depth: number) => {
    if (options.length >= 80 || depth > 3) return;
    const directValue = numericValue(value);
    if (directValue != null) {
      const key = path.join(".");
      const leaf = path[path.length - 1] ?? "";
      if (
        !key
        || !/length|width|height|depth|diameter|radius|perimeter|circumference|thickness|area|volume|weight|count|quantity/i.test(key)
        || /(?:^|[._\s-])(?:id|guid|handle|index|revision|timestamp|line number|element number|object number|color index)(?:$|[._\s-])/i.test(key)
        || /pnp(?:id|guid)|uniqueid|objectid|ownerid|port\d*[_\s-]*(?:id|guid)|position\s*[xyz]?$/i.test(leaf)
      ) return;
      options.push({
        id: `property:${key}`,
        label: humanizeQuantityLabel((path[path.length - 1] ?? key).split(".").pop() ?? key),
        value: directValue,
        uom: inferredUnit(key),
        source: "model-property",
        detail: `Model property · ${key}`,
        propertyPath: key,
        quantityType: inferredType(key),
      });
      return;
    }
    if (!value || typeof value !== "object" || Array.isArray(value)) return;
    const record = value as Record<string, unknown>;
    const recordValue = numericValue(record.value);
    if (recordValue != null) {
      const key = path.join(".");
      options.push({
        id: `property:${key}`,
        label: humanizeQuantityLabel(path[path.length - 1] ?? key),
        value: recordValue,
        uom: inferredUnit(key, typeof record.unit === "string" ? record.unit : typeof record.uom === "string" ? record.uom : ""),
        source: "model-property",
        detail: `Model property · ${key}`,
        propertyPath: key,
        quantityType: inferredType(key),
      });
      return;
    }
    Object.entries(record).forEach(([key, child]) => visit(child, [...path, key], depth + 1));
  };
  Object.entries(properties).forEach(([key, value]) => visit(value, [key], 0));
  const score = (option: InspectQuantityOption) => /(^|\.)length$/i.test(option.propertyPath ?? "") ? 100 : /area|volume|diameter|radius/i.test(option.propertyPath ?? "") ? 80 : 0;
  return options.sort((left, right) => score(right) - score(left)).slice(0, 36);
}

function dedupeQuantityOptions(options: InspectQuantityOption[]) {
  const seen = new Set<string>();
  return options.filter((option) => {
    const key = `${option.id}:${option.value}:${option.uom}`;
    if (seen.has(key) || !Number.isFinite(option.value)) return false;
    seen.add(key);
    return true;
  });
}

function quantityOptionsForSelection(
  request: TakeoffComposeRequest,
  selection: TakeoffSelection | null,
  snapshot: InspectSnapshot | null,
): InspectQuantityOption[] {
  if (request.mode === "batch") {
    return [{
      id: "native-per-pickup",
      label: "Each pickup's measured quantity",
      value: request.count,
      uom: "lines",
      source: "derived",
      detail: "Preserves the native mapped quantity on every staged pickup",
      quantityType: "native",
    }];
  }
  if (request.quantityOptions?.length) return dedupeQuantityOptions(request.quantityOptions);
  const countOption: InspectQuantityOption = {
    id: "count",
    label: request.count === 1 ? "Count" : "Selected object count",
    value: request.count,
    uom: "EA",
    source: "derived",
    detail: `${request.count.toLocaleString()} selected`,
    quantityType: "count",
  };
  if (!selection) return [countOption];

  if (selection.kind === "model-element") {
    const element = snapshot?.modelElements.find((candidate) => candidate.id === selection.elementId);
    if (!element) return [countOption];
    const options = dedupeQuantityOptions([
      countOption,
      ...element.quantities.map((quantity) => ({
        id: `model-quantity:${quantity.id}`,
        label: humanizeQuantityLabel(quantity.quantityType),
        value: quantity.value,
        uom: quantity.unit,
        source: "model-quantity" as const,
        detail: [quantity.method, `${Math.round(quantity.confidence * 100)}% confidence`].filter(Boolean).join(" · "),
        quantityType: quantity.quantityType,
        modelQuantityId: quantity.id,
      })),
      // The element's own drawing unit, not the model's display unit: an
              // imperial Plant3D model reports feet while stamping inches.
              ...numericPropertyQuantityOptions(
                element.properties,
                element.authoredLinearUnit || element.modelUnit,
              ),
    ]);
    const semantics = [element.name, element.elementClass, element.elementType, element.system, String(element.properties["AutoCAD.Class"] ?? "")].join(" ").toLowerCase();
    const preferredType = /pipe|duct|cable|conduit|tray|linear|run/.test(semantics) ? "length" : null;
    const preferredIndex = preferredType ? options.findIndex((option) => option.quantityType === preferredType) : -1;
    if (preferredIndex > 0) {
      const [preferred] = options.splice(preferredIndex, 1);
      options.unshift(preferred);
    }
    return options;
  }
  if (selection.kind === "model-element-group") {
    return dedupeQuantityOptions([
      countOption,
      ...(selection.quantity > 0 ? [{
        id: `topology:${selection.groupSignature}`,
        label: humanizeQuantityLabel(selection.measurementType || "Detected quantity"),
        value: selection.quantity,
        uom: selection.unit || "EA",
        source: "model-quantity" as const,
        detail: `${selection.elementCount.toLocaleString()} model objects · ${Math.round(selection.confidence * 100)}% confidence`,
        quantityType: selection.measurementType,
      }] : []),
    ]);
  }
  if (selection.kind === "model-selection") {
    return dedupeQuantityOptions([
      countOption,
      { id: "selection:surface-area", label: "Surface area", value: selection.totals.surfaceArea, uom: "model²", source: "derived", detail: "Selected geometry", quantityType: "surface_area" },
      { id: "selection:volume", label: "Volume", value: selection.totals.volume, uom: "model³", source: "derived", detail: "Selected geometry", quantityType: "volume" },
      { id: "selection:faces", label: "Face count", value: selection.totals.faceCount, uom: "EA", source: "derived", detail: "Selected geometry", quantityType: "count" },
      { id: "selection:solids", label: "Solid count", value: selection.totals.solidCount, uom: "EA", source: "derived", detail: "Selected geometry", quantityType: "count" },
    ]).filter((option) => option.value > 0);
  }
  if (selection.kind === "annotation") {
    const annotation = snapshot?.annotations.find((candidate) => candidate.id === selection.pickupId);
    const measurement = annotation?.measurement;
    return dedupeQuantityOptions([
      countOption,
      ...(typeof measurement?.value === "number" ? [{ id: "measurement:value", label: "Measured value", value: measurement.value, uom: measurement.unit || "EA", source: "measurement" as const, detail: annotation?.type, quantityType: "value" }] : []),
      ...(typeof measurement?.area === "number" ? [{ id: "measurement:area", label: "Measured area", value: measurement.area, uom: measurement.unit || "SF", source: "measurement" as const, detail: annotation?.type, quantityType: "area" }] : []),
      ...(typeof measurement?.volume === "number" ? [{ id: "measurement:volume", label: "Measured volume", value: measurement.volume, uom: measurement.unit || "CF", source: "measurement" as const, detail: annotation?.type, quantityType: "volume" }] : []),
    ]);
  }
  if (selection.kind === "cad-entity") {
    const entity = snapshot?.dwgIntelligence?.entities.find((candidate) => candidate.id === selection.entityId);
    return dedupeQuantityOptions([
      countOption,
      ...(entity ? [{ id: `cad:${entity.id}`, label: entity.measurementLabel || "Measured quantity", value: entity.quantity, uom: entity.uom, source: "measurement" as const, detail: [entity.type, entity.layer].filter(Boolean).join(" · "), quantityType: entity.type }] : []),
    ]);
  }
  return [countOption];
}

export function ComboView({
  workspace,
  onApply,
  onError,
  onRefresh,
  onOpenAgentChat,
  onOpenRevisionDiff,
  onOpenDocuments,
  onOpenPluginTools,
  onOpenTakeoffLink,
  onWorkspaceMutated,
  workspaceSyncOriginId,
  selectedWorksheetId,
  activeWorksheetId,
  onActiveWorksheetChange,
  initialDocumentId,
  highlightItemId,
  revisionImpactByItem,
}: ComboViewProps) {
  const [rightPanelTab, setRightPanelTab] = useState<RightPanelTab>("pickups");
  const [composeRequest, setComposeRequest] = useState<TakeoffComposeRequest | null>(null);
  const [selectedLineItemTemplate, setSelectedLineItemTemplate] = useState<CreateWorksheetItemInput | null>(null);
  const [lineItemPickerOpen, setLineItemPickerOpen] = useState(false);
  const [lineItemPickerNonce, setLineItemPickerNonce] = useState(0);
  const [quantityOptionId, setQuantityOptionId] = useState("");
  const [quantityMultiplier, setQuantityMultiplier] = useState(1);
  const [quantityWastePercent, setQuantityWastePercent] = useState(0);
  const [addingToWorksheet, setAddingToWorksheet] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [takeoffDetached, setTakeoffDetached] = useState(false);
  const [resumeTakeoffEditor, setResumeTakeoffEditor] = useState(false);
  const [takeoffSelection, setTakeoffSelection] = useState<TakeoffSelection | null>(null);
  const [takeoffViewState, setTakeoffViewState] = useState<TakeoffViewState | null>(
    initialDocumentId ? { documentId: initialDocumentId, page: 1, zoom: 1 } : null,
  );
  const [annotationsCache, setAnnotationsCache] = useState<Pickup[]>([]);
  // One anchor ref per RightPanel instance. While the takeoff is popped out,
  // the standby studio layout stays mounted offscreen with its own copy of the
  // "Estimate item" button — a single shared ref ends up pointing at whichever
  // copy committed last (the hidden one), and the picker dropdown then clamps
  // to the top-left corner of the viewport.
  const mainLineItemPickerAnchorRef = useRef<HTMLElement | null>(null);
  const detachedLineItemPickerAnchorRef = useRef<HTMLElement | null>(null);
  const [linksReloadSignal, setLinksReloadSignal] = useState(0);
  const handleLinksMutated = useCallback(() => setLinksReloadSignal((k) => k + 1), []);
  const handleTakeoffSelectionChange = useCallback((next: TakeoffSelection | null) => {
    setTakeoffSelection((prev) => (
      serializeTakeoffSelection(prev) === serializeTakeoffSelection(next) ? prev : next
    ));
  }, []);
  const handleRequestCompose = useCallback((request: TakeoffComposeRequest) => {
    setComposeRequest(request);
    setSelectedLineItemTemplate(null);
    setQuantityOptionId(request.quantityOptions?.[0]?.id ?? "");
    setQuantityMultiplier(1);
    setQuantityWastePercent(0);
    setLineItemPickerOpen(true);
    setLineItemPickerNonce((value) => value + 1);
    setRightPanelTab("add");
  }, []);
  const takeoffViewStateSignatureRef = useRef<string | null>(serializeTakeoffViewState(takeoffViewState));
  const handleTakeoffViewStateChange = useCallback((next: TakeoffViewState) => {
    const signature = serializeTakeoffViewState(next);
    if (signature === takeoffViewStateSignatureRef.current) return;
    takeoffViewStateSignatureRef.current = signature;
    setTakeoffViewState(next);
  }, []);
  useEffect(() => {
    if (!initialDocumentId) return;
    const next = { documentId: initialDocumentId, page: 1, zoom: 1 };
    const signature = serializeTakeoffViewState(next);
    if (signature === takeoffViewStateSignatureRef.current) return;
    takeoffViewStateSignatureRef.current = signature;
    setTakeoffViewState(next);
  }, [initialDocumentId]);
  const annotationsCacheSignatureRef = useRef<string | null>(null);
  const handleAnnotationsChange = useCallback((next: Pickup[]) => {
    const signature = JSON.stringify(next);
    if (signature === annotationsCacheSignatureRef.current) return;
    annotationsCacheSignatureRef.current = signature;
    setAnnotationsCache(next);
  }, []);
  const containerRef = useRef<HTMLDivElement>(null);
  const detachedTakeoffWindowRef = useRef<Window | null>(null);

  // Inspect bridge: TakeoffTab publishes a snapshot of what's currently
  // inspectable (annotations or model elements) and populates an actions ref
  // so the side-panel Inspect tab can drive everything.
  const [inspectSnapshot, setInspectSnapshot] = useState<InspectSnapshot | null>(null);
  const inspectActionsRef = useRef<InspectActions | null>(null);
  const handleInspectSnapshotChange = useCallback((next: InspectSnapshot) => {
    setInspectSnapshot(next);
  }, []);
  const requestComposeForCurrentSelection = useCallback(() => {
    const actions = inspectActionsRef.current;
    const selection = takeoffSelection;
    if (!actions || !selection) return;
    if (selection.kind === "annotation") {
      const annotation = inspectSnapshot?.annotations.find((candidate) => candidate.id === selection.pickupId);
      handleRequestCompose({
        id: `selection:annotation:${selection.pickupId}`,
        title: annotation?.label || "Selected takeoff pickup",
        description: annotation?.measurement ? `${annotation.measurement.value ?? 1} ${annotation.measurement.unit ?? "EA"}` : undefined,
        sourceLabel: "Drawing pickup",
        count: 1,
        mode: "single",
        execute: (pick) => actions.createLineItemFromAnnotation(selection.pickupId, pick),
      });
    } else if (selection.kind === "model-element") {
      handleRequestCompose({
        id: `selection:model:${selection.elementId}`,
        title: selection.elementName,
        description: [selection.elementClass, selection.material, selection.level, selection.quantitySummary].filter(Boolean).join(" · "),
        sourceLabel: "Model element",
        count: 1,
        mode: "single",
        execute: (pick) => actions.createLineItemFromElement(selection.elementId, pick),
      });
    } else if (selection.kind === "model-element-group") {
      handleRequestCompose({
        id: `selection:model-topology:${selection.groupSignature}`,
        title: selection.groupName,
        description: `${selection.elementCount.toLocaleString()} objects · ${selection.quantity.toLocaleString(undefined, { maximumFractionDigits: 3 })} ${selection.unit}`,
        sourceLabel: `${humanizeQuantityLabel(selection.groupKind)} group`,
        count: selection.elementCount,
        mode: "group",
        quantityOptions: [{
          id: `topology:${selection.groupSignature}`,
          label: humanizeQuantityLabel(selection.measurementType),
          value: selection.quantity,
          uom: selection.unit,
          source: "model-quantity",
          detail: `${selection.elementCount.toLocaleString()} member objects`,
          quantityType: selection.measurementType,
        }],
        execute: (pick) => actions.createLineItemFromElementGroup(selection.elementIds, selection.groupName, pick),
      });
    } else if (selection.kind === "cad-entity") {
      handleRequestCompose({
        id: `selection:cad:${selection.entityId}`,
        title: selection.label || selection.entityType || "CAD entity",
        description: [selection.layer, selection.summary].filter(Boolean).join(" · "),
        sourceLabel: "CAD entity",
        count: 1,
        mode: "single",
        execute: (pick) => actions.createLineItemFromDwgEntity(selection.entityId, pick),
      });
    } else if (selection.kind === "model-selection" && selection.selectedNodeIds.length > 0) {
      handleRequestCompose({
        id: `selection:model-group:${selection.selectedNodeIds.join(",")}`,
        title: `${selection.selectedCount} selected model objects`,
        description: selection.fileName,
        sourceLabel: "3D model selection",
        count: selection.selectedCount,
        mode: "group",
        execute: (pick) => actions.createLineItemFromElementGroup(selection.selectedNodeIds, `${selection.selectedCount} selected model objects`, pick),
      });
    }
  }, [handleRequestCompose, inspectSnapshot, takeoffSelection]);

  const handleRightPanelTabChange = useCallback((tab: RightPanelTab) => {
    setRightPanelTab(tab);
  }, []);

  const lineItemPickerRequest = useMemo<WorksheetLineItemPickerRequest | null>(() => {
    if (!composeRequest || !lineItemPickerOpen) return null;
    return {
      id: `${composeRequest.id}:${lineItemPickerNonce}`,
      title: `Price ${composeRequest.title}`,
      description: `${composeRequest.sourceLabel} · Choose the exact worksheet item that should price this takeoff scope.`,
      sourceLabel: composeRequest.sourceLabel,
      selectionCount: composeRequest.count,
      creationMode: composeRequest.mode,
      anchorRef: takeoffDetached ? detachedLineItemPickerAnchorRef : mainLineItemPickerAnchorRef,
      onSelect: async (template) => {
        if (!template.categoryId) {
          onError("That worksheet item does not resolve to an enabled estimate category.");
          return;
        }
        setSelectedLineItemTemplate(template);
        setLineItemPickerOpen(false);
      },
      onCancel: () => setLineItemPickerOpen(false),
    };
  }, [composeRequest, lineItemPickerNonce, lineItemPickerOpen, onError, takeoffDetached]);

  const quantityOptions = useMemo(
    () => composeRequest ? quantityOptionsForSelection(composeRequest, takeoffSelection, inspectSnapshot) : [],
    [composeRequest, inspectSnapshot, takeoffSelection],
  );
  useEffect(() => {
    if (!composeRequest || quantityOptions.length === 0) return;
    if (!quantityOptions.some((option) => option.id === quantityOptionId)) {
      setQuantityOptionId(quantityOptions[0].id);
    }
  }, [composeRequest, quantityOptionId, quantityOptions]);
  const openLineItemPicker = useCallback(() => {
    if (!composeRequest) {
      requestComposeForCurrentSelection();
      return;
    }
    setLineItemPickerOpen(true);
    setLineItemPickerNonce((value) => value + 1);
  }, [composeRequest, requestComposeForCurrentSelection]);
  const clearComposeRequest = useCallback(() => {
    setComposeRequest(null);
    setSelectedLineItemTemplate(null);
    setLineItemPickerOpen(false);
    setQuantityOptionId("");
    setQuantityMultiplier(1);
    setQuantityWastePercent(0);
  }, []);
  const addStagedLineItem = useCallback(async () => {
    if (!composeRequest || !selectedLineItemTemplate?.categoryId) return;
    const option = quantityOptions.find((candidate) => candidate.id === quantityOptionId) ?? quantityOptions[0];
    if (!option) {
      onError("Choose a quantity source before adding this pickup.");
      return;
    }
    const multiplier = Number.isFinite(quantityMultiplier) ? Math.max(0, quantityMultiplier) : 1;
    const wastePercent = Number.isFinite(quantityWastePercent) ? Math.max(0, quantityWastePercent) : 0;
    const quantityOverride: InspectQuantitySelection | undefined = option.id === "native-per-pickup" ? undefined : {
      ...option,
      uom: option.uom || selectedLineItemTemplate.uom || "EA",
      multiplier,
      wastePercent,
      result: option.value * multiplier * (1 + wastePercent / 100),
    };
    setAddingToWorksheet(true);
    try {
      await composeRequest.execute({
        categoryId: selectedLineItemTemplate.categoryId,
        rateScheduleItemId: selectedLineItemTemplate.rateScheduleItemId ?? undefined,
        rateScheduleItemName: selectedLineItemTemplate.entityName,
        rateScheduleItemUnit: selectedLineItemTemplate.uom,
        tierUnits: selectedLineItemTemplate.tierUnits,
        lineItemTemplate: selectedLineItemTemplate,
        quantityOverride,
      });
      clearComposeRequest();
    } catch (error) {
      onError(error instanceof Error ? error.message : "Could not add the staged takeoff item to the worksheet.");
    } finally {
      setAddingToWorksheet(false);
    }
  }, [clearComposeRequest, composeRequest, onError, quantityMultiplier, quantityOptionId, quantityOptions, quantityWastePercent, selectedLineItemTemplate]);

  const toggleFullscreen = useCallback(() => {
    if (typeof document === "undefined") return;
    if (document.fullscreenElement) {
      void document.exitFullscreen();
    } else {
      void containerRef.current?.requestFullscreen();
    }
  }, []);

  useEffect(() => {
    if (typeof document === "undefined") return;
    const onChange = () => setFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  const takeoffOriginId = workspaceSyncOriginId ? `${workspaceSyncOriginId}-combo` : undefined;

  const handleDetachedWindowChange = useCallback((open: boolean, win?: Window | null) => {
    detachedTakeoffWindowRef.current = open ? win ?? detachedTakeoffWindowRef.current : null;
    setTakeoffDetached(open);
    if (open) {
      setResumeTakeoffEditor(true);
      setRightPanelTab("pickups");
    }
  }, []);

  const handleMergeDetachedTakeoff = useCallback(() => {
    const win = detachedTakeoffWindowRef.current;
    if (win && !win.closed) {
      win.close();
    }
    detachedTakeoffWindowRef.current = null;
    setResumeTakeoffEditor(true);
    setTakeoffDetached(false);
  }, []);

  useEffect(() => {
    if (!takeoffDetached) return;
    const interval = window.setInterval(() => {
      const win = detachedTakeoffWindowRef.current;
      if (win && win.closed) {
        detachedTakeoffWindowRef.current = null;
        setResumeTakeoffEditor(true);
        setTakeoffDetached(false);
      }
    }, 900);
    return () => window.clearInterval(interval);
  }, [takeoffDetached]);

  const layoutStorage = useMemo<LayoutStorage>(() => ({
    getItem: (key) => (typeof window === "undefined" ? null : window.localStorage.getItem(key)),
    setItem: (key, value) => {
      if (typeof window === "undefined") return;
      try { window.localStorage.setItem(key, value); } catch {}
    },
  }), []);

  const verticalLayout = useDefaultLayout({
    // Versioned so the Takeoff Studio cutover resets legacy, often-crushed
    // local panel sizes to the deliberate 2/3 canvas + 1/3 worksheet dock.
    id: "combo-view-vertical-studio-v1",
    panelIds: ["combo-top", "combo-bottom"],
    storage: layoutStorage,
  });
  const horizontalLayout = useDefaultLayout({
    id: "combo-view-horizontal",
    panelIds: ["combo-takeoff", "combo-right"],
    storage: layoutStorage,
  });

  const detachedLayout = useDefaultLayout({
    id: "combo-view-detached-v2",
    panelIds: ["combo-detached-worksheets", "combo-detached-entities"],
    storage: layoutStorage,
  });

  const takeoffSurface = (
    <TakeoffTab
      workspace={workspace}
      onOpenAgentChat={onOpenAgentChat}
      onOpenRevisionDiff={onOpenRevisionDiff}
      onOpenDocuments={onOpenDocuments}
      onWorkspaceMutated={onWorkspaceMutated}
      detached={takeoffDetached}
      initialEditorOpen={resumeTakeoffEditor}
      workspaceSyncOriginId={takeoffOriginId}
      selectedWorksheetId={selectedWorksheetId ?? null}
      initialDocumentId={takeoffViewState?.documentId ?? initialDocumentId}
      initialPage={takeoffViewState?.page ?? 1}
      initialZoom={takeoffViewState?.zoom ?? 1}
      selection={takeoffSelection}
      onSelectionChange={handleTakeoffSelectionChange}
      onViewStateChange={handleTakeoffViewStateChange}
      onAnnotationsChange={handleAnnotationsChange}
      linksReloadSignal={linksReloadSignal}
      onLinksMutated={handleLinksMutated}
      inspectActionsRef={inspectActionsRef}
      onOpenInspectEntities={() => setRightPanelTab("pickups")}
      onInspectSnapshotChange={handleInspectSnapshotChange}
      onDetachedWindowChange={handleDetachedWindowChange}
      detachedTargetWindow={detachedTakeoffWindowRef.current}
    />
  );

  const detachedWorkspace = takeoffDetached ? (
    <>
      <div className="flex shrink-0 items-center justify-between gap-3 border-b border-line bg-panel/80 px-3 py-1.5">
        <div className="min-w-0 text-xs">
          <span className="font-medium text-fg/75">Takeoff popped out</span>
          <span className="ml-2 text-fg/40">Worksheets left, entities right</span>
        </div>
        <button
          type="button"
          onClick={handleMergeDetachedTakeoff}
          className="inline-flex h-7 shrink-0 items-center gap-1.5 rounded-md border border-line bg-bg/40 px-2 text-[11px] font-medium text-fg/65 transition-colors hover:border-accent/40 hover:bg-accent/10 hover:text-accent"
          title="Close the detached takeoff window and restore the full workspace layout"
        >
          <PanelRightClose className="h-3.5 w-3.5" />
          Merge back
        </button>
      </div>
      <Group
          orientation="horizontal"
          className="flex-1 min-h-0"
          defaultLayout={detachedLayout.defaultLayout}
          onLayoutChanged={detachedLayout.onLayoutChanged}
        >
          <Panel id="combo-detached-worksheets" defaultSize="75%" minSize="45%">
            <div className="h-full min-h-0 pr-1.5">
              <EstimateGrid
                workspace={workspace}
                onApply={onApply}
                onError={onError}
                onRefresh={onRefresh}
                highlightItemId={highlightItemId}
                activeWorksheetId={activeWorksheetId}
                onActiveWorksheetChange={onActiveWorksheetChange}
                onOpenPluginTools={onOpenPluginTools}
                onOpenTakeoffLink={onOpenTakeoffLink}
                revisionImpactByItem={revisionImpactByItem}
                onOpenRevisionDiff={onOpenRevisionDiff}
                lineItemPickerRequest={takeoffDetached ? lineItemPickerRequest : null}
              />
            </div>
          </Panel>

          <Separator className="group relative !w-px bg-line transition-colors hover:bg-accent/60 data-[resize-active]:bg-accent">
            <div className="absolute inset-y-0 -left-1 -right-1" />
          </Separator>

          <Panel id="combo-detached-entities" defaultSize="25%" minSize="18%">
            <div className="h-full min-h-0 border-l border-line bg-panel/30">
              <RightPanel
                workspace={workspace}
                activeWorksheetId={activeWorksheetId}
                tab={rightPanelTab}
                onTabChange={handleRightPanelTabChange}
                fullscreen={fullscreen}
                onToggleFullscreen={toggleFullscreen}
                takeoffSelection={takeoffSelection}
                annotationsCache={annotationsCache}
                onLinksMutated={handleLinksMutated}
                inspectSnapshot={inspectSnapshot}
                inspectActionsRef={inspectActionsRef}
                onRequestCompose={handleRequestCompose}
                onRequestSelectionCompose={requestComposeForCurrentSelection}
                lineItemPickerAnchorRef={detachedLineItemPickerAnchorRef}
                composeRequest={composeRequest}
                selectedLineItemTemplate={selectedLineItemTemplate}
                lineItemPickerOpen={lineItemPickerOpen}
                quantityOptions={quantityOptions}
                quantityOptionId={quantityOptionId}
                quantityMultiplier={quantityMultiplier}
                quantityWastePercent={quantityWastePercent}
                addingToWorksheet={addingToWorksheet}
                onOpenLineItemPicker={openLineItemPicker}
                onQuantityOptionChange={setQuantityOptionId}
                onQuantityMultiplierChange={setQuantityMultiplier}
                onQuantityWastePercentChange={setQuantityWastePercent}
                onAddStagedLineItem={addStagedLineItem}
                onClearComposeRequest={clearComposeRequest}
              />
            </div>
          </Panel>
      </Group>
    </>
  ) : null;

  return (
    <div
      ref={containerRef}
      className={cn(
        "relative flex flex-col flex-1 min-h-0",
        fullscreen && "bg-bg p-2",
      )}
    >
      {detachedWorkspace}
      <PersistentTakeoffController detached={takeoffDetached}>
        <Group
          orientation="vertical"
          className="h-full min-h-0"
          defaultLayout={verticalLayout.defaultLayout}
          onLayoutChanged={verticalLayout.onLayoutChanged}
        >
          <Panel id="combo-top" defaultSize="67%" minSize="45%">
          <Group
            orientation="horizontal"
            className="h-full"
            defaultLayout={horizontalLayout.defaultLayout}
            onLayoutChanged={horizontalLayout.onLayoutChanged}
          >
            <Panel id="combo-takeoff" defaultSize="67%" minSize="30%">
              <div className="h-full min-h-0 flex flex-col pr-1.5 pb-1.5">
                {takeoffSurface}
              </div>
            </Panel>

            <Separator className="group relative !w-px bg-line transition-colors hover:bg-accent/60 data-[resize-active]:bg-accent">
              <div className="absolute inset-y-0 -left-1 -right-1" />
            </Separator>

            <Panel
              id="combo-right"
              defaultSize="28%"
              minSize="20%"
              collapsible
              collapsedSize="0%"
            >
              <div className="h-full min-h-0 flex flex-col bg-panel/30">
                <RightPanel
                  workspace={workspace}
                  activeWorksheetId={activeWorksheetId}
                  tab={rightPanelTab}
                  onTabChange={handleRightPanelTabChange}
                  fullscreen={fullscreen}
                  onToggleFullscreen={toggleFullscreen}
                  takeoffSelection={takeoffSelection}
                  annotationsCache={annotationsCache}
                  onLinksMutated={handleLinksMutated}
                  inspectSnapshot={inspectSnapshot}
                  inspectActionsRef={inspectActionsRef}
                  onRequestCompose={handleRequestCompose}
                  onRequestSelectionCompose={requestComposeForCurrentSelection}
                  lineItemPickerAnchorRef={mainLineItemPickerAnchorRef}
                  composeRequest={composeRequest}
                  selectedLineItemTemplate={selectedLineItemTemplate}
                  lineItemPickerOpen={lineItemPickerOpen}
                  quantityOptions={quantityOptions}
                  quantityOptionId={quantityOptionId}
                  quantityMultiplier={quantityMultiplier}
                  quantityWastePercent={quantityWastePercent}
                  addingToWorksheet={addingToWorksheet}
                  onOpenLineItemPicker={openLineItemPicker}
                  onQuantityOptionChange={setQuantityOptionId}
                  onQuantityMultiplierChange={setQuantityMultiplier}
                  onQuantityWastePercentChange={setQuantityWastePercent}
                  onAddStagedLineItem={addStagedLineItem}
                  onClearComposeRequest={clearComposeRequest}
                />
              </div>
            </Panel>
          </Group>
        </Panel>

        <Separator className="group relative !h-px bg-line transition-colors hover:bg-accent/60 data-[resize-active]:bg-accent">
          <div className="absolute inset-x-0 -top-2 -bottom-2 z-10 flex items-center justify-center">
            <span className="flex h-4 w-8 items-center justify-center rounded-full border border-line bg-panel text-fg/25 opacity-0 shadow-sm transition-opacity group-hover:opacity-100 group-data-[resize-active]:opacity-100">
              <GripHorizontal className="h-3 w-3" />
            </span>
          </div>
        </Separator>

        <Panel
          id="combo-bottom"
          defaultSize="33%"
          minSize="22%"
          maxSize="55%"
          collapsible
          collapsedSize="0%"
        >
          <div className="flex h-full min-h-0 flex-col bg-panel/15">
            <div className={cn(
              "flex h-9 shrink-0 items-center gap-2 border-b border-line px-3 transition-colors",
              composeRequest && "border-accent/30 bg-accent/5",
            )}>
              <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-panel2 text-fg/55">
                <TableProperties className="h-3.5 w-3.5" />
              </div>
              <div className="min-w-0">
                <p className="truncate text-[10px] font-semibold uppercase tracking-wider text-fg/40">Worksheet dock</p>
              </div>
              {(() => {
                const worksheet = workspace.worksheets.find((candidate) => candidate.id === activeWorksheetId) ?? workspace.worksheets[0];
                return worksheet ? (
                  <>
                    <span className="text-fg/20">/</span>
                    <select
                      aria-label="Active worksheet"
                      value={worksheet.id}
                      onChange={(event) => onActiveWorksheetChange?.(event.target.value)}
                      className="h-6 min-w-0 max-w-[260px] rounded-md border border-transparent bg-transparent px-1 text-xs font-medium text-fg/75 outline-none hover:border-line hover:bg-bg/40 focus:border-accent"
                    >
                      {workspace.worksheets.map((candidate) => (
                        <option key={candidate.id} value={candidate.id}>{candidate.name}</option>
                      ))}
                    </select>
                    <span className="shrink-0 rounded-full border border-line bg-bg/40 px-1.5 py-0.5 font-mono text-[9px] tabular-nums text-fg/40">
                      {(worksheet.items ?? []).length.toLocaleString()} lines
                    </span>
                  </>
                ) : null;
              })()}
              <div className="ml-auto flex shrink-0 items-center gap-2">
                {composeRequest && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-accent/10 px-2 py-0.5 text-[9px] font-medium text-accent">
                    <ArrowRight className="h-2.5 w-2.5" />
                    {composeRequest.mode === "batch" ? `${composeRequest.count} staged lines` : "Incoming pickup"}
                  </span>
                )}
                <span className="hidden text-[9px] text-fg/30 xl:inline">Drag divider to resize</span>
              </div>
            </div>
            <div className="min-h-0 flex-1">
              <EstimateGrid
                workspace={workspace}
                onApply={onApply}
                onError={onError}
                onRefresh={onRefresh}
                highlightItemId={highlightItemId}
                activeWorksheetId={activeWorksheetId}
                onActiveWorksheetChange={onActiveWorksheetChange}
                onOpenPluginTools={onOpenPluginTools}
                onOpenTakeoffLink={onOpenTakeoffLink}
                revisionImpactByItem={revisionImpactByItem}
                onOpenRevisionDiff={onOpenRevisionDiff}
                lineItemPickerRequest={takeoffDetached ? null : lineItemPickerRequest}
                dockMode
              />
            </div>
          </div>
        </Panel>
        </Group>
      </PersistentTakeoffController>
    </div>
  );
}

function SelectionInspectPanel({
  selection,
  snapshot,
  workspace,
  annotations,
  activeWorksheetId,
  onLinksMutated,
  onStage,
}: {
  selection: TakeoffSelection | null;
  snapshot: InspectSnapshot | null;
  workspace: ProjectWorkspaceData;
  annotations: Pickup[];
  activeWorksheetId?: string;
  onLinksMutated: () => void;
  onStage: () => void;
}) {
  const [propertyQuery, setPropertyQuery] = useState("");
  const element = selection?.kind === "model-element"
    ? snapshot?.modelElements.find((candidate) => candidate.id === selection.elementId) ?? null
    : null;
  const elementGroup = selection?.kind === "model-element-group" ? selection : null;
  const properties = useMemo(() => {
    if (!element) return [];
    const query = propertyQuery.trim().toLowerCase();
    return Object.entries(element.properties)
      .filter(([key, value]) => !query || `${key} ${String(value)}`.toLowerCase().includes(query))
      .sort(([left], [right]) => left.localeCompare(right, undefined, { numeric: true }))
      .slice(0, 120);
  }, [element, propertyQuery]);

  if (!selection) {
    return <div className="flex h-full items-center justify-center px-5 text-center text-[11px] leading-relaxed text-fg/40">Select a pickup or model object, then open Inspect. Browsing never opens this panel automatically.</div>;
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        {element && (
          <div className="space-y-2">
            <div className="rounded-lg border border-line bg-bg/45 p-2.5">
              <p className="text-[9px] font-semibold uppercase tracking-wider text-fg/35">Active model object</p>
              <p className="mt-1 text-[12px] font-semibold text-fg/85">{element.name || element.externalId}</p>
              <p className="mt-0.5 text-[10px] text-fg/45">{[element.elementClass, element.elementType, element.system, element.level].filter(Boolean).join(" · ")}</p>
              <div className="mt-2 grid grid-cols-2 gap-1.5 text-[10px]">
                {[["Material", element.material], ["Model ID", element.externalId], ["LOD", element.lod || "Not specified"], ["Quantity", element.quantitySummary]].map(([label, value]) => (
                  <div key={label} className="rounded-md border border-line/60 bg-panel/60 px-2 py-1.5">
                    <p className="text-[8px] uppercase tracking-wide text-fg/30">{label}</p>
                    <p className="mt-0.5 truncate text-fg/65" title={value || ""}>{value || "—"}</p>
                  </div>
                ))}
              </div>
            </div>
            <section className="rounded-lg border border-line bg-bg/45 p-2">
              <p className="mb-1.5 text-[9px] font-semibold uppercase tracking-wider text-fg/35">Measured quantities</p>
              <div className="space-y-1">
                {element.quantities.length > 0 ? element.quantities.map((quantity) => (
                  <div key={quantity.id} className="flex items-center justify-between gap-2 rounded-md bg-panel/70 px-2 py-1.5 text-[10px]">
                    <span className="min-w-0 truncate text-fg/55">{humanizeQuantityLabel(quantity.quantityType)}</span>
                    <span className="shrink-0 font-mono font-semibold tabular-nums text-fg/75">{quantity.value.toLocaleString(undefined, { maximumFractionDigits: 4 })} {quantity.unit}</span>
                  </div>
                )) : <p className="py-2 text-center text-[10px] text-fg/35">No native model quantities were indexed.</p>}
              </div>
            </section>
            <section className="rounded-lg border border-line bg-bg/45 p-2">
              <div className="mb-1.5 flex items-center gap-2">
                <p className="text-[9px] font-semibold uppercase tracking-wider text-fg/35">Source properties</p>
                <Input value={propertyQuery} onChange={(event) => setPropertyQuery(event.target.value)} placeholder="Filter properties" className="ml-auto h-6 w-32 px-1.5 text-[9px]" />
              </div>
              <div className="divide-y divide-line/50">
                {properties.map(([key, value]) => (
                  <div key={key} className="grid grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)] gap-2 py-1 text-[9px]">
                    <span className="truncate text-fg/35" title={key}>{key}</span>
                    <span className="break-words text-right text-fg/60">{String(value)}</span>
                  </div>
                ))}
              </div>
            </section>
          </div>
        )}
        {elementGroup && (
          <div className="space-y-2">
            <div className="rounded-lg border border-accent/25 bg-accent/5 p-2.5">
              <div className="flex items-center justify-between gap-2">
                <p className="text-[9px] font-semibold uppercase tracking-wider text-accent">Selected {humanizeQuantityLabel(elementGroup.groupKind)}</p>
                <span className="font-mono text-[9px] text-fg/40">{Math.round(elementGroup.confidence * 100)}%</span>
              </div>
              <p className="mt-1 text-[12px] font-semibold text-fg/85">{elementGroup.groupName}</p>
              <p className="mt-0.5 text-[10px] text-fg/45">{elementGroup.elementCount.toLocaleString()} highlighted model objects · {elementGroup.source}</p>
              <div className="mt-2 grid grid-cols-2 gap-1.5 text-[10px]">
                <div className="rounded-md border border-line/60 bg-panel/60 px-2 py-1.5">
                  <p className="text-[8px] uppercase tracking-wide text-fg/30">Quantity</p>
                  <p className="mt-0.5 font-mono font-semibold text-fg/70">{elementGroup.quantity.toLocaleString(undefined, { maximumFractionDigits: 4 })} {elementGroup.unit}</p>
                </div>
                <div className="rounded-md border border-line/60 bg-panel/60 px-2 py-1.5">
                  <p className="text-[8px] uppercase tracking-wide text-fg/30">Measurement</p>
                  <p className="mt-0.5 text-fg/65">{humanizeQuantityLabel(elementGroup.measurementType)}</p>
                </div>
              </div>
            </div>
            {elementGroup.warnings.length > 0 && (
              <div className="rounded-lg border border-warning/25 bg-warning/5 p-2 text-[10px] text-warning">
                {elementGroup.warnings.map((warning) => <p key={warning}>· {warning}</p>)}
              </div>
            )}
          </div>
        )}
        {!element && !elementGroup && (
          <TakeoffLinkView workspace={workspace} selection={selection} annotations={annotations} activeWorksheetId={activeWorksheetId} onLinksMutated={onLinksMutated} showLinkComposer={false} />
        )}
      </div>
      <div className="shrink-0 border-t border-line bg-panel/95 p-2">
        <Button type="button" onClick={onStage} className="h-8 w-full text-[10px]">
          <ArrowRight className="mr-1.5 h-3.5 w-3.5" />
          Continue to Add to worksheet
        </Button>
      </div>
    </div>
  );
}

function RightPanel({
  workspace,
  activeWorksheetId,
  tab,
  onTabChange,
  fullscreen,
  onToggleFullscreen,
  takeoffSelection,
  annotationsCache,
  onLinksMutated,
  inspectSnapshot,
  inspectActionsRef,
  onRequestCompose,
  onRequestSelectionCompose,
  lineItemPickerAnchorRef,
  composeRequest,
  selectedLineItemTemplate,
  lineItemPickerOpen,
  quantityOptions,
  quantityOptionId,
  quantityMultiplier,
  quantityWastePercent,
  addingToWorksheet,
  onOpenLineItemPicker,
  onQuantityOptionChange,
  onQuantityMultiplierChange,
  onQuantityWastePercentChange,
  onAddStagedLineItem,
  onClearComposeRequest,
}: {
  workspace: ProjectWorkspaceData;
  activeWorksheetId?: string;
  tab: RightPanelTab;
  onTabChange: (tab: RightPanelTab) => void;
  fullscreen: boolean;
  onToggleFullscreen: () => void;
  takeoffSelection: TakeoffSelection | null;
  annotationsCache: Pickup[];
  onLinksMutated: () => void;
  inspectSnapshot: InspectSnapshot | null;
  inspectActionsRef: React.MutableRefObject<InspectActions | null>;
  onRequestCompose: (request: TakeoffComposeRequest) => void;
  onRequestSelectionCompose: () => void;
  lineItemPickerAnchorRef: React.MutableRefObject<HTMLElement | null>;
  composeRequest: TakeoffComposeRequest | null;
  selectedLineItemTemplate: CreateWorksheetItemInput | null;
  lineItemPickerOpen: boolean;
  quantityOptions: InspectQuantityOption[];
  quantityOptionId: string;
  quantityMultiplier: number;
  quantityWastePercent: number;
  addingToWorksheet: boolean;
  onOpenLineItemPicker: () => void;
  onQuantityOptionChange: (id: string) => void;
  onQuantityMultiplierChange: (value: number) => void;
  onQuantityWastePercentChange: (value: number) => void;
  onAddStagedLineItem: () => void;
  onClearComposeRequest: () => void;
}) {
  const liveInspectActions = useMemo(
    () => createLiveActionBridge<InspectActions>(() => inspectActionsRef.current),
    [inspectActionsRef],
  );
  const tabs: Array<{ id: RightPanelTab; label: string; icon: typeof Compass }> = [
    { id: "pickups", label: "Pickups", icon: Layers },
    { id: "inspect", label: "Inspect", icon: Compass },
    { id: "add", label: "Add", icon: TableProperties },
  ];

  const FsIcon = fullscreen ? Minimize2 : Maximize2;
  const selectedQuantityOption = quantityOptions.find((option) => option.id === quantityOptionId) ?? quantityOptions[0] ?? null;
  const mappedQuantity = selectedQuantityOption
    ? selectedQuantityOption.value * quantityMultiplier * (1 + quantityWastePercent / 100)
    : 0;
  const mappedUom = selectedQuantityOption?.uom || selectedLineItemTemplate?.uom || "EA";
  const usesNativeBatchQuantities = selectedQuantityOption?.id === "native-per-pickup";

  return (
    <>
      <div className="flex items-center gap-0.5 border-b border-line px-1.5 py-1 shrink-0">
        {tabs.map((t) => {
          const Icon = t.icon;
          const isActive = tab === t.id;
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => onTabChange(t.id)}
              disabled={(t.id === "inspect" && !takeoffSelection) || (t.id === "add" && !takeoffSelection && !composeRequest)}
              className={cn(
                "flex items-center gap-1.5 rounded-md px-2 py-1 text-[11px] font-medium transition-colors",
                isActive ? "bg-panel2 text-fg" : "text-fg/45 hover:text-fg/70",
                "disabled:cursor-not-allowed disabled:opacity-35",
              )}
            >
              <Icon className="h-3 w-3" />
              {t.label}
            </button>
          );
        })}
        <button
          type="button"
          onClick={onToggleFullscreen}
          title={fullscreen ? "Exit full screen (Esc)" : "Full screen"}
          className="ml-auto rounded-md p-1 text-fg/40 transition-colors hover:bg-panel2 hover:text-fg/80"
        >
          <FsIcon className="h-3 w-3" />
        </button>
      </div>

      {/* The pickups browser stays mounted across tab switches. Unmounting it
          threw away every bit of navigation state — expanded groups, search,
          the system/run filter — so returning from Inspect meant starting the
          hunt for a component over again. */}
      <div className={cn("min-h-0 flex-1 overflow-hidden p-1.5", tab !== "pickups" && "hidden")}>
        <TakeoffInspectView
          snapshot={inspectSnapshot}
          actions={liveInspectActions}
          onRequestCompose={onRequestCompose}
        />
      </div>

      {tab === "pickups" ? null : tab === "inspect" ? (
        <SelectionInspectPanel
          selection={takeoffSelection}
          snapshot={inspectSnapshot}
          workspace={workspace}
          annotations={annotationsCache}
          activeWorksheetId={activeWorksheetId}
          onLinksMutated={onLinksMutated}
          onStage={onRequestSelectionCompose}
        />
      ) : (
        <div className="flex min-h-0 flex-1 flex-col">
          <div className="shrink-0 border-b border-line bg-panel/45 p-2">
            <div className="mb-1.5 flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="text-[9px] font-semibold uppercase tracking-wider text-fg/40">Add to worksheet</p>
                <p className="truncate text-[10px] text-fg/55">
                  {composeRequest ? `${composeRequest.sourceLabel} · ${composeRequest.title}` : "Stage the selected pickup before adding it"}
                </p>
              </div>
              {composeRequest && (
                <button
                  type="button"
                  onClick={onClearComposeRequest}
                  className="rounded p-0.5 text-fg/30 hover:bg-panel2 hover:text-fg/65"
                  aria-label="Clear staged pickup"
                >
                  <X className="h-3 w-3" />
                </button>
              )}
            </div>

            <p className="mb-1 text-[9px] font-medium text-fg/45">Estimate item</p>
            <button
              ref={(node) => { lineItemPickerAnchorRef.current = node; }}
              type="button"
              onClick={composeRequest ? onOpenLineItemPicker : onRequestSelectionCompose}
              disabled={(!takeoffSelection && !composeRequest) || addingToWorksheet}
              aria-expanded={lineItemPickerOpen}
              className={cn(
                "flex h-9 w-full items-center gap-2 rounded-md border bg-bg px-2.5 text-left transition-colors",
                lineItemPickerOpen ? "border-accent/50 ring-2 ring-accent/10" : "border-line hover:border-accent/40",
                "disabled:cursor-not-allowed disabled:opacity-45",
              )}
            >
              {selectedLineItemTemplate ? <Check className="h-3.5 w-3.5 shrink-0 text-positive" /> : <Search className="h-3.5 w-3.5 shrink-0 text-fg/35" />}
              <span className="min-w-0 flex-1">
                <span className={cn("block truncate text-[11px]", selectedLineItemTemplate ? "font-medium text-fg/85" : "text-fg/40")}>
                  {selectedLineItemTemplate?.entityName ?? "Search ratebooks, catalogues, labour units…"}
                </span>
                {selectedLineItemTemplate && (
                  <span className="block truncate text-[9px] text-fg/35">
                    {[selectedLineItemTemplate.category, selectedLineItemTemplate.uom].filter(Boolean).join(" · ")}
                  </span>
                )}
              </span>
              <ChevronDown className="h-3.5 w-3.5 shrink-0 text-fg/30" />
            </button>

            {composeRequest && (
              <div className="mt-2 rounded-md border border-line bg-bg/45 p-2">
                <div className="grid grid-cols-[minmax(0,1fr)_58px_58px] gap-1.5">
                  <label className="min-w-0">
                    <span className="mb-1 block text-[9px] font-medium text-fg/45">Quantity from</span>
                    <select
                      value={selectedQuantityOption?.id ?? ""}
                      onChange={(event) => onQuantityOptionChange(event.target.value)}
                      disabled={addingToWorksheet || quantityOptions.length === 0}
                      className="h-7 w-full rounded-md border border-line bg-bg px-1.5 text-[10px] text-fg/75 outline-none focus:border-accent"
                    >
                      {quantityOptions.map((option) => (
                        <option key={option.id} value={option.id}>
                          {option.label} — {option.value.toLocaleString(undefined, { maximumFractionDigits: 3 })}{option.uom ? ` ${option.uom}` : ""}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    <span className="mb-1 block text-[9px] font-medium text-fg/45">Multiplier</span>
                    <Input
                      type="number"
                      min={0}
                      step="any"
                      value={quantityMultiplier}
                      onChange={(event) => onQuantityMultiplierChange(Number(event.target.value))}
                      disabled={addingToWorksheet || usesNativeBatchQuantities}
                      className="h-7 px-1.5 text-[10px]"
                    />
                  </label>
                  <label>
                    <span className="mb-1 block text-[9px] font-medium text-fg/45">Waste %</span>
                    <Input
                      type="number"
                      min={0}
                      step="any"
                      value={quantityWastePercent}
                      onChange={(event) => onQuantityWastePercentChange(Number(event.target.value))}
                      disabled={addingToWorksheet || usesNativeBatchQuantities}
                      className="h-7 px-1.5 text-[10px]"
                    />
                  </label>
                </div>
                <div className="mt-1.5 flex items-center justify-between gap-2 text-[9px]">
                  <span className="min-w-0 truncate text-fg/35" title={selectedQuantityOption?.detail}>
                    {selectedQuantityOption?.detail || selectedQuantityOption?.source.replace(/-/g, " ") || "Choose a measured field"}
                  </span>
                  <span className="shrink-0 font-mono font-semibold tabular-nums text-fg/70">
                    {selectedQuantityOption
                      ? usesNativeBatchQuantities
                        ? `${selectedQuantityOption.value.toLocaleString()} lines · native quantities preserved`
                        : `${selectedQuantityOption.value.toLocaleString(undefined, { maximumFractionDigits: 3 })} × ${quantityMultiplier || 0}${quantityWastePercent ? ` × ${(1 + quantityWastePercent / 100).toFixed(3)}` : ""} = ${mappedQuantity.toLocaleString(undefined, { maximumFractionDigits: 3 })} ${mappedUom}`
                      : "No quantity available"}
                  </span>
                </div>
                {selectedQuantityOption?.coverage && selectedQuantityOption.coverage.matched < selectedQuantityOption.coverage.total && (
                  <p className="mt-1 text-[9px] text-warning">
                    Available on {selectedQuantityOption.coverage.matched} of {selectedQuantityOption.coverage.total} selected objects.
                  </p>
                )}
              </div>
            )}

          </div>
          <div className="min-h-0 flex-1 overflow-y-auto p-2">
            <TakeoffLinkView
              workspace={workspace}
              selection={takeoffSelection}
              annotations={annotationsCache}
              activeWorksheetId={activeWorksheetId}
              onLinksMutated={onLinksMutated}
              showLinkComposer={false}
            />
          </div>
          <div className="shrink-0 border-t border-line bg-panel/95 p-2 shadow-[0_-8px_20px_rgba(0,0,0,0.08)] backdrop-blur">
            <Button
              type="button"
              onClick={onAddStagedLineItem}
              disabled={!composeRequest || !selectedLineItemTemplate || !selectedQuantityOption || addingToWorksheet}
              className="h-9 w-full text-[11px] shadow-sm"
            >
              {addingToWorksheet ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <ArrowRight className="mr-1.5 h-3.5 w-3.5" />}
              {addingToWorksheet ? "Adding…" : `Add to worksheet${mappedQuantity ? usesNativeBatchQuantities ? ` · ${mappedQuantity.toLocaleString()} lines` : ` · ${mappedQuantity.toLocaleString(undefined, { maximumFractionDigits: 2 })} ${mappedUom}` : ""}`}
            </Button>
            <p className="mt-1 text-center text-[9px] leading-3 text-fg/30">
              Nothing is written until this button is clicked.
            </p>
          </div>
        </div>
      )}
    </>
  );
}
