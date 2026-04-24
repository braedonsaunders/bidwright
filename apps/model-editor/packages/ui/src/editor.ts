// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import {
    type AsyncController,
    type IApplication,
    type IDocument,
    type IFace,
    type INode,
    type IShape,
    type ISolid,
    type Material,
    PubSub,
    type Ribbon,
    ShapeNode,
    ShapeTypes,
} from "@chili3d/core";
import { div } from "@chili3d/element";
import style from "./editor.module.css";
import { OKCancel } from "./okCancel";
import { ProjectView } from "./project";
import { PropertyView } from "./property";
import { MaterialDataContent, MaterialEditor } from "./property/material";
import { RibbonUI } from "./ribbon";
import { Statusbar } from "./statusbar";
import { LayoutViewport } from "./viewport";

interface BidWrightSelectionNode {
    id: string;
    name: string;
    kind: string;
    surfaceArea?: number;
    volume?: number;
    faceCount?: number;
    solidCount?: number;
    bbox?: {
        min: { x: number; y: number; z: number };
        max: { x: number; y: number; z: number };
        size: { x: number; y: number; z: number };
    };
}

interface BidWrightContext {
    enabled: boolean;
    projectId?: string;
    modelId?: string;
    modelDocumentId?: string;
    fileName?: string;
    channelName?: string;
    estimateEnabled: boolean;
    estimateTargetWorksheetId?: string;
    estimateTargetWorksheetName?: string;
    estimateDefaultMarkup: number;
    estimateQuoteLabel?: string;
}

interface BidWrightModelSelectionMessage {
    type: "bidwright:model-selection";
    source: "bidwright-model-editor";
    version: 1;
    eventId?: string;
    projectId?: string;
    modelId?: string;
    modelDocumentId?: string;
    fileName?: string;
    quantityBasis?: BidWrightQuantityBasis;
    documentId?: string;
    documentName?: string;
    selectedCount: number;
    nodes: BidWrightSelectionNode[];
    totals: {
        surfaceArea: number;
        volume: number;
        faceCount: number;
        solidCount: number;
    };
}

type BidWrightQuantityBasis = "count" | "area" | "volume";

interface BidWrightLineItemDraft {
    worksheetId?: string;
    worksheetName?: string;
    category: string;
    entityType: string;
    entityName: string;
    description: string;
    quantity: number;
    uom: string;
    cost: number;
    markup: number;
    price: number;
    unit1: number;
    unit2: number;
    unit3: number;
    sourceNotes: string;
    source: {
        kind: "model-selection";
        projectId?: string;
        modelId?: string;
        modelDocumentId?: string;
        fileName?: string;
        documentId?: string;
        selectedNodeIds: string[];
    };
}

interface BidWrightLinkedLineItem {
    linkId: string;
    worksheetItemId: string;
    worksheetId?: string | null;
    worksheetName?: string | null;
    entityName: string;
    description: string;
    quantity: number;
    uom: string;
    cost: number;
    markup: number;
    price: number;
    sourceNotes?: string;
    derivedQuantity?: number;
    selection?: Record<string, unknown>;
}

type BidWrightHostLineItemsStateMessage = {
    type: "bidwright:model-line-items-state";
    source: "bidwright-host";
    version: 1;
    projectId?: string;
    modelId?: string;
    modelDocumentId?: string;
    items: BidWrightLinkedLineItem[];
};

type BidWrightHostEstimateContextMessage = {
    type: "bidwright:model-estimate-context";
    source: "bidwright-host";
    version: 1;
    projectId?: string;
    estimateEnabled?: boolean;
    estimateTargetWorksheetId?: string | null;
    estimateTargetWorksheetName?: string | null;
    estimateDefaultMarkup?: number | null;
    estimateQuoteLabel?: string | null;
};

type BidWrightBroadcastType =
    | "model-selection"
    | "model-send-to-estimate"
    | "model-line-items-request"
    | "model-line-item-update"
    | "model-line-item-delete";

function isBidWrightEmbedded() {
    const params = new URLSearchParams(window.location.search);
    return params.get("bidwright") === "1" || params.get("embedded") === "1";
}

function readBidWrightContext(): BidWrightContext {
    const params = new URLSearchParams(window.location.search);
    const rawMarkup = Number(params.get("estimateDefaultMarkup"));
    return {
        enabled: params.get("bidwright") === "1" || params.get("embedded") === "1",
        projectId: params.get("projectId") ?? undefined,
        modelId: params.get("modelId") ?? undefined,
        modelDocumentId: params.get("modelDocumentId") ?? undefined,
        fileName: params.get("fileName") ?? undefined,
        channelName: params.get("channel") ?? undefined,
        estimateEnabled: params.get("estimate") === "1",
        estimateTargetWorksheetId: params.get("estimateTargetWorksheetId") ?? undefined,
        estimateTargetWorksheetName: params.get("estimateTargetWorksheetName") ?? undefined,
        estimateDefaultMarkup: Number.isFinite(rawMarkup) ? rawMarkup : 0.2,
        estimateQuoteLabel: params.get("estimateQuoteLabel") ?? undefined,
    };
}

function makeBidWrightEventId(prefix: string) {
    return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function bboxPayload(shape: IShape) {
    const bbox = shape.boundingBox();
    return {
        min: { x: bbox.min.x, y: bbox.min.y, z: bbox.min.z },
        max: { x: bbox.max.x, y: bbox.max.y, z: bbox.max.z },
        size: {
            x: bbox.max.x - bbox.min.x,
            y: bbox.max.y - bbox.min.y,
            z: bbox.max.z - bbox.min.z,
        },
    };
}

function formatModelNumber(value: number) {
    return Intl.NumberFormat(undefined, {
        maximumFractionDigits: Math.abs(value) >= 100 ? 0 : 2,
    }).format(value);
}

function formatModelQuantity(value: number, unit: string) {
    if (!Number.isFinite(value) || Math.abs(value) < 0.000001) return `0 ${unit}`;
    return `${formatModelNumber(value)} ${unit}`;
}

function primaryBidWrightSelectionQuantity(
    selection: BidWrightModelSelectionMessage,
    basis: BidWrightQuantityBasis = "count",
) {
    if (basis === "area" && selection.totals.surfaceArea > 0) {
        return { quantity: selection.totals.surfaceArea, uom: "model^2", label: "3D surface area" };
    }
    if (basis === "volume" && selection.totals.volume > 0) {
        return { quantity: selection.totals.volume, uom: "model^3", label: "3D volume" };
    }
    return { quantity: Math.max(1, selection.selectedCount), uom: "EA", label: "3D selected elements" };
}

function buildBidWrightLineItemDraft(
    context: BidWrightContext,
    selection: BidWrightModelSelectionMessage,
    basis: BidWrightQuantityBasis = "count",
): BidWrightLineItemDraft {
    const primary = primaryBidWrightSelectionQuantity(selection, basis);
    const selectedNames = selection.nodes.map((node) => node.name).filter(Boolean);
    const entityName = selectedNames[0] || `${selection.selectedCount} model elements`;
    const sourceFile = selection.documentName ?? selection.fileName ?? context.fileName ?? "selected model";

    return {
        worksheetId: context.estimateTargetWorksheetId,
        worksheetName: context.estimateTargetWorksheetName,
        category: "Model Takeoff",
        entityType: "Model Quantity",
        entityName,
        description: sourceFile,
        quantity: primary.quantity,
        uom: primary.uom,
        cost: 0,
        markup: context.estimateDefaultMarkup,
        price: 0,
        unit1: 0,
        unit2: 0,
        unit3: 0,
        sourceNotes: [
            `From BidWright model editor: ${sourceFile}`,
            context.estimateQuoteLabel ? `Quote: ${context.estimateQuoteLabel}` : "",
            context.estimateTargetWorksheetName ? `Worksheet: ${context.estimateTargetWorksheetName}` : "",
            `${primary.label}: ${formatModelQuantity(primary.quantity, primary.uom)}`,
            `Surface area: ${formatModelQuantity(selection.totals.surfaceArea, "model^2")}`,
            `Volume: ${formatModelQuantity(selection.totals.volume, "model^3")}`,
            `Faces: ${formatModelNumber(selection.totals.faceCount)}`,
            `Solids: ${formatModelNumber(selection.totals.solidCount)}`,
            selectedNames.length > 0 ? `Selected: ${selectedNames.slice(0, 12).join(", ")}` : "",
        ].filter(Boolean).join("\n"),
        source: {
            kind: "model-selection",
            projectId: context.projectId,
            modelId: context.modelId,
            modelDocumentId: context.modelDocumentId,
            fileName: context.fileName,
            documentId: selection.documentId,
            selectedNodeIds: selection.nodes.map((node) => node.id),
        },
    };
}

function summarizeShapeNode(node: ShapeNode): BidWrightSelectionNode {
    if (!node.shape.isOk) {
        return { id: node.id, name: node.name, kind: node.constructor.name };
    }

    const sourceShape = node.shape.value;
    const worldShape = sourceShape.transformedMul(node.worldTransform());
    try {
        const faces = worldShape.findSubShapes(ShapeTypes.face) as IFace[];
        const solids = worldShape.findSubShapes(ShapeTypes.solid) as ISolid[];
        const surfaceArea = faces.reduce((total, face) => total + face.area(), 0);
        const volume = solids.reduce((total, solid) => total + solid.volume(), 0);

        return {
            id: node.id,
            name: node.name,
            kind: node.constructor.name,
            surfaceArea,
            volume,
            faceCount: faces.length,
            solidCount: solids.length,
            bbox: bboxPayload(worldShape),
        };
    } finally {
        worldShape.dispose();
    }
}

function summarizeSelectionNode(node: INode): BidWrightSelectionNode {
    if (node instanceof ShapeNode) {
        return summarizeShapeNode(node);
    }
    return {
        id: node.id,
        name: node.name,
        kind: node.constructor.name,
    };
}

export class Editor extends HTMLElement {
    private readonly _selectionController: OKCancel;
    private readonly _viewportContainer: HTMLDivElement;
    private readonly _bidwrightContext = readBidWrightContext();
    private readonly _bidwrightOriginId = makeBidWrightEventId("model-editor");
    private _bidwrightChannel?: BroadcastChannel;
    private _bidwrightEstimateStatus?: HTMLSpanElement;
    private _bidwrightEstimateButton?: HTMLButtonElement;
    private _bidwrightEstimateModel?: HTMLSpanElement;
    private _bidwrightEstimateWorksheet?: HTMLSpanElement;
    private _bidwrightEstimateLineItem?: HTMLSpanElement;
    private _bidwrightEstimateQuantity?: HTMLSpanElement;
    private _bidwrightQuantityBasisSelect?: HTMLSelectElement;
    private _bidwrightEstimateArea?: HTMLSpanElement;
    private _bidwrightEstimateVolume?: HTMLSpanElement;
    private _bidwrightEstimateFaces?: HTMLSpanElement;
    private _bidwrightEstimateSolids?: HTMLSpanElement;
    private _bidwrightLinkedItemsList?: HTMLDivElement;
    private _bidwrightLinkedItemsEmpty?: HTMLSpanElement;
    private _lastBidWrightSelection?: BidWrightModelSelectionMessage;
    private _bidwrightLinkedLineItems: BidWrightLinkedLineItem[] = [];
    private _bidwrightQuantityBasis: BidWrightQuantityBasis = "count";
    private _sidebarWidth: number = 360;
    private _isResizingSidebar: boolean = false;
    private _sidebarEl: HTMLDivElement | null = null;
    private _sidebarPanels = new Map<string, HTMLElement>();
    private _sidebarButtons = new Map<string, HTMLButtonElement>();
    private _activeSidebarTab = "items";

    constructor(
        readonly app: IApplication,
        readonly ribbonContent: Ribbon,
    ) {
        super();
        const viewport = new LayoutViewport(app);
        viewport.classList.add(style.viewport);
        this._selectionController = new OKCancel();
        this._viewportContainer = div(
            { className: style.viewportContainer },
            this._selectionController,
            viewport,
        );
        this._activeSidebarTab = this._bidwrightContext.enabled ? "estimate" : "items";
        this._setupBidWrightEstimateBridge();
        this.clearSelectionControl();
        this.render();
    }

    private render() {
        const tabs: Array<{ id: string; label: string; content: HTMLElement }> = [
            { id: "items", label: "Items", content: new ProjectView({ className: style.sidebarItem }) },
        ];
        if (this._bidwrightContext.enabled) {
            tabs.push({ id: "estimate", label: "Estimate", content: this._createBidWrightEstimateView() });
        }
        tabs.push({ id: "properties", label: "Properties", content: new PropertyView({ className: style.sidebarItem }) });

        this._sidebarPanels.clear();
        this._sidebarButtons.clear();
        const tabButtons = tabs.map((tab) => {
            const button = document.createElement("button");
            button.type = "button";
            button.className = style.sidebarTab;
            button.textContent = tab.label;
            button.onclick = () => this._setActiveSidebarTab(tab.id);
            this._sidebarButtons.set(tab.id, button);
            return button;
        });
        const panels = tabs.map((tab) => {
            const panel = div({ className: style.sidebarPanel }, tab.content);
            this._sidebarPanels.set(tab.id, panel);
            return panel;
        });

        this._sidebarEl = div(
            {
                className: style.sidebar,
                style: `width: ${this._sidebarWidth}px;`,
            },
            div({ className: style.sidebarTabs }, ...tabButtons),
            div({ className: style.sidebarPanels }, ...panels),
            div({
                className: style.sidebarResizer,
                onmousedown: (e: MouseEvent) => this._startSidebarResize(e),
            }),
        );
        this._setActiveSidebarTab(this._activeSidebarTab);
        this.append(
            div(
                { className: style.root },
                new RibbonUI(this.app, this.ribbonContent),
                div({ className: style.content }, this._sidebarEl, this._viewportContainer),
                new Statusbar(style.statusbar),
            ),
        );
        this.app.mainWindow?.appendChild(this);
    }

    private _setActiveSidebarTab(tabId: string) {
        if (!this._sidebarPanels.has(tabId)) tabId = "items";
        this._activeSidebarTab = tabId;
        for (const [id, panel] of this._sidebarPanels) {
            const active = id === tabId;
            panel.hidden = !active;
            panel.classList.toggle(style.sidebarPanelActive, active);
        }
        for (const [id, button] of this._sidebarButtons) {
            button.classList.toggle(style.sidebarTabActive, id === tabId);
            button.setAttribute("aria-selected", id === tabId ? "true" : "false");
        }
    }

    private _startSidebarResize(e: MouseEvent) {
        e.preventDefault();
        this._isResizingSidebar = true;
        if (this.app.mainWindow) this.app.mainWindow.style.cursor = "ew-resize";
        const onMouseMove = (ev: MouseEvent) => {
            if (!this._isResizingSidebar) return;
            if (!this._sidebarEl) return;
            const sidebarRect = this._sidebarEl.getBoundingClientRect();
            let newWidth = ev.clientX - sidebarRect.left;
            const minWidth = 75;
            const maxWidth = Math.floor(window.innerWidth * 0.85);
            newWidth = Math.max(minWidth, Math.min(maxWidth, newWidth));
            this._sidebarWidth = newWidth;
            this._sidebarEl.style.width = `${newWidth}px`;
        };
        const onMouseUp = () => {
            this._isResizingSidebar = false;
            if (this.app.mainWindow) this.app.mainWindow.style.cursor = "";
            this.app.mainWindow?.removeEventListener("mousemove", onMouseMove);
            this.app.mainWindow?.removeEventListener("mouseup", onMouseUp);
        };
        this.app.mainWindow?.addEventListener("mousemove", onMouseMove);
        this.app.mainWindow?.addEventListener("mouseup", onMouseUp);
    }

    connectedCallback(): void {
        PubSub.default.sub("showSelectionControl", this.showSelectionControl);
        PubSub.default.sub("editMaterial", this._handleMaterialEdit);
        PubSub.default.sub("clearSelectionControl", this.clearSelectionControl);
        PubSub.default.sub("selectionChanged", this._handleBidWrightSelectionChanged);
        window.addEventListener("message", this._handleBidWrightHostMessage);
        this._requestBidWrightEstimateContext();
        this._requestBidWrightLinkedLineItems();
        void this._loadBidWrightLinkedLineItemsFromApi();
    }

    disconnectedCallback(): void {
        PubSub.default.remove("showSelectionControl", this.showSelectionControl);
        PubSub.default.remove("editMaterial", this._handleMaterialEdit);
        PubSub.default.remove("clearSelectionControl", this.clearSelectionControl);
        PubSub.default.remove("selectionChanged", this._handleBidWrightSelectionChanged);
        window.removeEventListener("message", this._handleBidWrightHostMessage);
        this._bidwrightChannel?.close();
        this._bidwrightChannel = undefined;
    }

    private _setupBidWrightEstimateBridge() {
        if (!this._bidwrightContext.enabled) return;

        if (this._bidwrightContext.channelName && "BroadcastChannel" in window) {
            this._bidwrightChannel = new BroadcastChannel(this._bidwrightContext.channelName);
            this._bidwrightChannel.onmessage = (event: MessageEvent) => {
                this._handleBidWrightChannelMessage(event.data);
            };
        }
    }

    private _createBidWrightEstimateView() {
        const view = document.createElement("section");
        view.className = style.bidwrightEstimateView;

        const header = document.createElement("div");
        header.className = style.bidwrightEstimateHeader;
        const label = document.createElement("span");
        label.className = style.bidwrightEstimateTitle;
        label.textContent = "Estimate";

        const button = document.createElement("button");
        button.type = "button";
        button.className = style.bidwrightEstimateButton;
        button.setAttribute("data-bidwright-send-estimate", "1");
        button.textContent = "Create Line Item";
        button.onclick = this._handleBidWrightEstimateSend;
        header.append(label, button);

        const body = document.createElement("div");
        body.className = style.bidwrightEstimateBody;

        const status = document.createElement("span");
        status.className = style.bidwrightEstimateStatus;
        const model = document.createElement("span");
        model.className = style.bidwrightEstimateModel;

        const summary = document.createElement("div");
        summary.className = style.bidwrightEstimateSummary;
        summary.append(status, model);

        const details = document.createElement("div");
        details.className = style.bidwrightEstimateDetails;
        const worksheetDetail = this._createBidWrightEstimateDetail("Worksheet");
        const lineItemDetail = this._createBidWrightEstimateDetail("Line item");
        const basisDetail = this._createBidWrightEstimateSelectDetail("Qty basis", [
            { value: "count", label: "Count" },
            { value: "area", label: "Area" },
            { value: "volume", label: "Volume" },
        ]);
        basisDetail.value.value = this._bidwrightQuantityBasis;
        basisDetail.value.onchange = () => {
            this._bidwrightQuantityBasis = basisDetail.value.value as BidWrightQuantityBasis;
            if (this._lastBidWrightSelection) {
                this._lastBidWrightSelection = { ...this._lastBidWrightSelection, quantityBasis: this._bidwrightQuantityBasis };
            }
            this._updateBidWrightEstimatePanel();
        };
        details.append(worksheetDetail.item, lineItemDetail.item, basisDetail.item);

        const metrics = document.createElement("div");
        metrics.className = style.bidwrightEstimateMetrics;

        const quantityMetric = this._createBidWrightEstimateMetric("Quantity");
        const areaMetric = this._createBidWrightEstimateMetric("Area");
        const volumeMetric = this._createBidWrightEstimateMetric("Volume");
        const facesMetric = this._createBidWrightEstimateMetric("Faces");
        const solidsMetric = this._createBidWrightEstimateMetric("Solids");
        metrics.append(
            quantityMetric.item,
            areaMetric.item,
            volumeMetric.item,
            facesMetric.item,
            solidsMetric.item,
        );

        const linkedItems = document.createElement("div");
        linkedItems.className = style.bidwrightLinkedItems;
        const linkedHeader = document.createElement("div");
        linkedHeader.className = style.bidwrightLinkedItemsHeader;
        linkedHeader.textContent = "Linked line items";
        const linkedEmpty = document.createElement("span");
        linkedEmpty.className = style.bidwrightLinkedItemsEmpty;
        linkedEmpty.textContent = "No linked worksheet rows yet";
        const linkedList = document.createElement("div");
        linkedList.className = style.bidwrightLinkedItemsList;
        linkedItems.append(linkedHeader, linkedEmpty, linkedList);

        body.append(summary, details, metrics, linkedItems);
        view.append(header, body);
        this._bidwrightEstimateStatus = status;
        this._bidwrightEstimateButton = button;
        this._bidwrightEstimateModel = model;
        this._bidwrightEstimateWorksheet = worksheetDetail.value;
        this._bidwrightEstimateLineItem = lineItemDetail.value;
        this._bidwrightQuantityBasisSelect = basisDetail.value;
        this._bidwrightEstimateQuantity = quantityMetric.value;
        this._bidwrightEstimateArea = areaMetric.value;
        this._bidwrightEstimateVolume = volumeMetric.value;
        this._bidwrightEstimateFaces = facesMetric.value;
        this._bidwrightEstimateSolids = solidsMetric.value;
        this._bidwrightLinkedItemsEmpty = linkedEmpty;
        this._bidwrightLinkedItemsList = linkedList;
        this._updateBidWrightEstimatePanel();
        this._renderBidWrightLinkedLineItems();
        return view;
    }

    private _createBidWrightEstimateMetric(labelText: string) {
        const item = document.createElement("div");
        item.className = style.bidwrightEstimateMetric;

        const label = document.createElement("span");
        label.className = style.bidwrightEstimateMetricLabel;
        label.textContent = labelText;

        const value = document.createElement("span");
        value.className = style.bidwrightEstimateMetricValue;
        value.textContent = "-";

        item.append(label, value);
        return { item, value };
    }

    private _createBidWrightEstimateDetail(labelText: string) {
        const item = document.createElement("div");
        item.className = style.bidwrightEstimateDetail;

        const label = document.createElement("span");
        label.className = style.bidwrightEstimateDetailLabel;
        label.textContent = labelText;

        const value = document.createElement("span");
        value.className = style.bidwrightEstimateDetailValue;
        value.textContent = "-";

        item.append(label, value);
        return { item, value };
    }

    private _createBidWrightEstimateSelectDetail(labelText: string, options: Array<{ value: string; label: string }>) {
        const item = document.createElement("div");
        item.className = style.bidwrightEstimateDetail;

        const label = document.createElement("span");
        label.className = style.bidwrightEstimateDetailLabel;
        label.textContent = labelText;

        const value = document.createElement("select");
        value.className = style.bidwrightEstimateSelect;
        for (const option of options) {
            const element = document.createElement("option");
            element.value = option.value;
            element.textContent = option.label;
            value.append(element);
        }

        item.append(label, value);
        return { item, value };
    }

    private _normalizeBidWrightLinkedLineItem(raw: unknown): BidWrightLinkedLineItem | undefined {
        if (!raw || typeof raw !== "object") return undefined;
        const item = raw as Partial<BidWrightLinkedLineItem>;
        if (typeof item.linkId !== "string" || typeof item.worksheetItemId !== "string") return undefined;
        return {
            linkId: item.linkId,
            worksheetItemId: item.worksheetItemId,
            worksheetId: typeof item.worksheetId === "string" ? item.worksheetId : null,
            worksheetName: typeof item.worksheetName === "string" ? item.worksheetName : null,
            entityName: typeof item.entityName === "string" ? item.entityName : "Model quantity",
            description: typeof item.description === "string" ? item.description : "",
            quantity: typeof item.quantity === "number" && Number.isFinite(item.quantity) ? item.quantity : 0,
            uom: typeof item.uom === "string" ? item.uom : "EA",
            cost: typeof item.cost === "number" && Number.isFinite(item.cost) ? item.cost : 0,
            markup: typeof item.markup === "number" && Number.isFinite(item.markup) ? item.markup : 0,
            price: typeof item.price === "number" && Number.isFinite(item.price) ? item.price : 0,
            sourceNotes: typeof item.sourceNotes === "string" ? item.sourceNotes : "",
            derivedQuantity: typeof item.derivedQuantity === "number" && Number.isFinite(item.derivedQuantity)
                ? item.derivedQuantity
                : undefined,
            selection: item.selection && typeof item.selection === "object" ? item.selection : undefined,
        };
    }

    private _applyBidWrightLinkedLineItems(items: unknown[]) {
        this._bidwrightLinkedLineItems = items
            .map((item) => this._normalizeBidWrightLinkedLineItem(item))
            .filter((item): item is BidWrightLinkedLineItem => Boolean(item));
        this._renderBidWrightLinkedLineItems();
    }

    private _renderBidWrightLinkedLineItems() {
        if (!this._bidwrightLinkedItemsList || !this._bidwrightLinkedItemsEmpty) return;

        this._bidwrightLinkedItemsList.replaceChildren();
        this._bidwrightLinkedItemsEmpty.style.display = this._bidwrightLinkedLineItems.length > 0 ? "none" : "";

        for (const linkedItem of this._bidwrightLinkedLineItems) {
            const row = document.createElement("div");
            row.className = style.bidwrightLinkedItem;
            row.setAttribute("data-bidwright-linked-line-item", linkedItem.worksheetItemId);

            const meta = document.createElement("div");
            meta.className = style.bidwrightLinkedItemMeta;
            const worksheet = document.createElement("span");
            worksheet.textContent = linkedItem.worksheetName ?? "Worksheet";
            const total = document.createElement("span");
            total.textContent = formatModelQuantity(linkedItem.quantity, linkedItem.uom);
            meta.append(worksheet, total);

            const nameInput = document.createElement("input");
            nameInput.className = style.bidwrightLinkedItemName;
            nameInput.value = linkedItem.entityName;
            nameInput.setAttribute("aria-label", "Line item name");

            const quantityRow = document.createElement("div");
            quantityRow.className = style.bidwrightLinkedItemQuantityRow;
            const quantityInput = document.createElement("input");
            quantityInput.className = style.bidwrightLinkedItemQuantity;
            quantityInput.type = "number";
            quantityInput.step = "any";
            quantityInput.value = String(linkedItem.quantity);
            quantityInput.setAttribute("aria-label", "Line item quantity");
            const uomInput = document.createElement("input");
            uomInput.className = style.bidwrightLinkedItemUom;
            uomInput.value = linkedItem.uom;
            uomInput.setAttribute("aria-label", "Line item unit");
            quantityRow.append(quantityInput, uomInput);

            const actions = document.createElement("div");
            actions.className = style.bidwrightLinkedItemActions;
            const saveButton = document.createElement("button");
            saveButton.type = "button";
            saveButton.textContent = "Update";
            saveButton.onclick = () => {
                const quantity = Number(quantityInput.value);
                this._postBidWrightLineItemUpdate(linkedItem, {
                    entityName: nameInput.value.trim() || linkedItem.entityName,
                    quantity: Number.isFinite(quantity) ? quantity : linkedItem.quantity,
                    uom: uomInput.value.trim() || linkedItem.uom,
                });
            };
            const deleteButton = document.createElement("button");
            deleteButton.type = "button";
            deleteButton.textContent = "Delete";
            deleteButton.className = style.bidwrightLinkedItemDeleteButton;
            deleteButton.onclick = () => {
                if (window.confirm("Delete this linked worksheet line item?")) {
                    this._postBidWrightLineItemDelete(linkedItem);
                }
            };
            actions.append(saveButton, deleteButton);

            row.append(meta, nameInput, quantityRow, actions);
            this._bidwrightLinkedItemsList.append(row);
        }
    }

    private _isBidWrightLineItemsStateMessage(data: unknown): data is BidWrightHostLineItemsStateMessage {
        return Boolean(
            data &&
                typeof data === "object" &&
                (data as { type?: unknown }).type === "bidwright:model-line-items-state" &&
                (data as { source?: unknown }).source === "bidwright-host" &&
                Array.isArray((data as { items?: unknown }).items),
        );
    }

    private _handleBidWrightLineItemsState(data: unknown) {
        if (!this._isBidWrightLineItemsStateMessage(data)) return;
        if (this._bidwrightContext.projectId && data.projectId && data.projectId !== this._bidwrightContext.projectId) return;
        if (this._bidwrightContext.modelId && data.modelId && data.modelId !== this._bidwrightContext.modelId) return;
        if (
            this._bidwrightContext.modelDocumentId &&
            data.modelDocumentId &&
            data.modelDocumentId !== this._bidwrightContext.modelDocumentId
        ) return;
        this._applyBidWrightLinkedLineItems(data.items);
    }

    private _isBidWrightEstimateContextMessage(data: unknown): data is BidWrightHostEstimateContextMessage {
        return Boolean(
            data &&
                typeof data === "object" &&
                (data as { type?: unknown }).type === "bidwright:model-estimate-context" &&
                (data as { source?: unknown }).source === "bidwright-host",
        );
    }

    private _handleBidWrightEstimateContext(data: unknown) {
        if (!this._isBidWrightEstimateContextMessage(data)) return;
        if (this._bidwrightContext.projectId && data.projectId && data.projectId !== this._bidwrightContext.projectId) return;
        this._bidwrightContext.estimateEnabled = data.estimateEnabled ?? Boolean(data.estimateTargetWorksheetId);
        this._bidwrightContext.estimateTargetWorksheetId = data.estimateTargetWorksheetId ?? undefined;
        this._bidwrightContext.estimateTargetWorksheetName = data.estimateTargetWorksheetName ?? undefined;
        this._bidwrightContext.estimateDefaultMarkup =
            typeof data.estimateDefaultMarkup === "number" && Number.isFinite(data.estimateDefaultMarkup)
                ? data.estimateDefaultMarkup
                : this._bidwrightContext.estimateDefaultMarkup;
        this._bidwrightContext.estimateQuoteLabel = data.estimateQuoteLabel ?? undefined;
        this._updateBidWrightEstimatePanel();
    }

    private readonly _handleBidWrightHostMessage = (event: MessageEvent) => {
        if (event.origin !== window.location.origin) return;
        this._handleBidWrightLineItemsState(event.data);
        this._handleBidWrightEstimateContext(event.data);
    };

    private _handleBidWrightChannelMessage(data: unknown) {
        if (
            data &&
            typeof data === "object" &&
            (data as { type?: unknown }).type === "model-line-items-state" &&
            (data as { source?: unknown }).source === "bidwright-host"
        ) {
            this._handleBidWrightLineItemsState({
                ...(data as Record<string, unknown>),
                type: "bidwright:model-line-items-state",
            });
            return;
        }
        if (
            data &&
            typeof data === "object" &&
            (data as { type?: unknown }).type === "model-estimate-context" &&
            (data as { source?: unknown }).source === "bidwright-host"
        ) {
            this._handleBidWrightEstimateContext({
                ...(data as Record<string, unknown>),
                type: "bidwright:model-estimate-context",
            });
        }
    }

    private _postBidWrightHostMessage(message: Record<string, unknown>) {
        if (window.parent && window.parent !== window) {
            window.parent.postMessage(message, window.location.origin);
        }
    }

    private _postBidWrightChannelMessage(message: Record<string, unknown>) {
        this._bidwrightChannel?.postMessage({
            source: "bidwright-model-editor",
            version: 1,
            originId: this._bidwrightOriginId,
            projectId: this._bidwrightContext.projectId,
            modelId: this._bidwrightContext.modelId,
            modelDocumentId: this._bidwrightContext.modelDocumentId,
            ...message,
        });
    }

    private _requestBidWrightLinkedLineItems() {
        if (!this._bidwrightContext.enabled) return;
        const eventId = makeBidWrightEventId("model-line-items-request");
        this._postBidWrightHostMessage({
            type: "bidwright:model-line-items-request",
            source: "bidwright-model-editor",
            version: 1,
            eventId,
            projectId: this._bidwrightContext.projectId,
            modelId: this._bidwrightContext.modelId,
            modelDocumentId: this._bidwrightContext.modelDocumentId,
        });
        this._postBidWrightChannelMessage({
            type: "model-line-items-request",
            eventId,
        });
    }

    private _requestBidWrightEstimateContext() {
        if (!this._bidwrightContext.enabled) return;
        const eventId = makeBidWrightEventId("model-estimate-context-request");
        this._postBidWrightHostMessage({
            type: "bidwright:model-estimate-context-request",
            source: "bidwright-model-editor",
            version: 1,
            eventId,
            projectId: this._bidwrightContext.projectId,
            modelId: this._bidwrightContext.modelId,
            modelDocumentId: this._bidwrightContext.modelDocumentId,
        });
        this._postBidWrightChannelMessage({
            type: "model-estimate-context-request",
            eventId,
        });
    }

    private _postBidWrightLineItemUpdate(
        linkedItem: BidWrightLinkedLineItem,
        patch: { entityName?: string; quantity?: number; uom?: string },
    ) {
        const eventId = makeBidWrightEventId("model-line-item-update");
        const message = {
            source: "bidwright-model-editor",
            version: 1,
            eventId,
            projectId: this._bidwrightContext.projectId,
            modelId: this._bidwrightContext.modelId,
            modelDocumentId: this._bidwrightContext.modelDocumentId,
            linkId: linkedItem.linkId,
            worksheetItemId: linkedItem.worksheetItemId,
            patch,
        };
        this._postBidWrightHostMessage({
            type: "bidwright:model-line-item-update",
            ...message,
        });
        this._postBidWrightChannelMessage({
            type: "model-line-item-update",
            eventId,
            linkId: linkedItem.linkId,
            worksheetItemId: linkedItem.worksheetItemId,
            patch,
        });
        if (this._bidwrightEstimateStatus) this._bidwrightEstimateStatus.textContent = "Updating line item";
    }

    private _postBidWrightLineItemDelete(linkedItem: BidWrightLinkedLineItem) {
        const eventId = makeBidWrightEventId("model-line-item-delete");
        const message = {
            source: "bidwright-model-editor",
            version: 1,
            eventId,
            projectId: this._bidwrightContext.projectId,
            modelId: this._bidwrightContext.modelId,
            modelDocumentId: this._bidwrightContext.modelDocumentId,
            linkId: linkedItem.linkId,
            worksheetItemId: linkedItem.worksheetItemId,
        };
        this._postBidWrightHostMessage({
            type: "bidwright:model-line-item-delete",
            ...message,
        });
        this._postBidWrightChannelMessage({
            type: "model-line-item-delete",
            eventId,
            linkId: linkedItem.linkId,
            worksheetItemId: linkedItem.worksheetItemId,
        });
        if (this._bidwrightEstimateStatus) this._bidwrightEstimateStatus.textContent = "Deleting line item";
    }

    private async _loadBidWrightLinkedLineItemsFromApi() {
        if (!this._bidwrightContext.projectId || !this._bidwrightContext.modelId) return;
        try {
            const response = await fetch(
                `/api/models/${encodeURIComponent(this._bidwrightContext.projectId)}/assets/${encodeURIComponent(this._bidwrightContext.modelId)}/takeoff-links`,
                { credentials: "include", cache: "no-store" },
            );
            if (!response.ok) return;
            const data = await response.json();
            const links = Array.isArray(data?.links) ? data.links : [];
            this._applyBidWrightLinkedLineItems(links.map((link: any) => ({
                linkId: link.id,
                worksheetItemId: link.worksheetItemId,
                worksheetId: link.worksheetItem?.worksheet?.id ?? link.worksheetItem?.worksheetId ?? null,
                worksheetName: link.worksheetItem?.worksheet?.name ?? null,
                entityName: link.worksheetItem?.entityName ?? "Model quantity",
                description: link.worksheetItem?.description ?? "",
                quantity: Number(link.worksheetItem?.quantity ?? link.derivedQuantity ?? 0),
                uom: link.worksheetItem?.uom ?? "EA",
                cost: Number(link.worksheetItem?.cost ?? 0),
                markup: Number(link.worksheetItem?.markup ?? 0),
                price: Number(link.worksheetItem?.price ?? 0),
                sourceNotes: link.worksheetItem?.sourceNotes ?? "",
                derivedQuantity: Number(link.derivedQuantity ?? 0),
                selection: link.selection ?? {},
            })));
        } catch {
            // Host BroadcastChannel state is the primary path when embedded; API fetch is a standalone fallback.
        }
    }

    private _updateBidWrightEstimatePanel(selection = this._lastBidWrightSelection) {
        if (!this._bidwrightEstimateStatus || !this._bidwrightEstimateButton) return;

        const canReachHost = Boolean(this._bidwrightChannel || window.parent !== window);
        const canSend = Boolean(
            this._bidwrightContext.estimateEnabled &&
                canReachHost &&
                this._bidwrightContext.estimateTargetWorksheetId &&
                selection &&
                selection.selectedCount > 0,
        );
        const worksheetLabel = this._bidwrightContext.estimateTargetWorksheetName ?? "No worksheet selected";

        if (!selection || selection.selectedCount === 0) {
            this._bidwrightEstimateStatus.textContent = "Select model geometry";
            this._bidwrightEstimateModel!.textContent = this._bidwrightContext.fileName ?? "Model quantity";
            this._bidwrightEstimateWorksheet!.textContent = worksheetLabel;
            this._bidwrightEstimateLineItem!.textContent = "Waiting for selection";
            this._bidwrightEstimateQuantity!.textContent = "-";
            this._bidwrightEstimateArea!.textContent = "-";
            this._bidwrightEstimateVolume!.textContent = "-";
            this._bidwrightEstimateFaces!.textContent = "-";
            this._bidwrightEstimateSolids!.textContent = "-";
        } else {
            const lineItemDraft = buildBidWrightLineItemDraft(this._bidwrightContext, selection, this._bidwrightQuantityBasis);
            const firstNode = selection.nodes[0]?.name ?? "Model quantity";
            this._bidwrightEstimateStatus.textContent =
                selection.selectedCount === 1 ? firstNode : `${selection.selectedCount} model elements`;
            this._bidwrightEstimateModel!.textContent =
                selection.documentName ?? selection.fileName ?? this._bidwrightContext.fileName ?? "";
            this._bidwrightEstimateWorksheet!.textContent = worksheetLabel;
            this._bidwrightEstimateLineItem!.textContent = lineItemDraft.entityName;
            this._bidwrightEstimateQuantity!.textContent = formatModelQuantity(lineItemDraft.quantity, lineItemDraft.uom);
            this._bidwrightEstimateArea!.textContent = formatModelQuantity(selection.totals.surfaceArea, "model^2");
            this._bidwrightEstimateVolume!.textContent = formatModelQuantity(selection.totals.volume, "model^3");
            this._bidwrightEstimateFaces!.textContent = formatModelNumber(selection.totals.faceCount);
            this._bidwrightEstimateSolids!.textContent = formatModelNumber(selection.totals.solidCount);
        }

        if (this._bidwrightQuantityBasisSelect && this._bidwrightQuantityBasisSelect.value !== this._bidwrightQuantityBasis) {
            this._bidwrightQuantityBasisSelect.value = this._bidwrightQuantityBasis;
        }

        this._bidwrightEstimateButton.disabled = !canSend;
        if (!this._bidwrightContext.estimateEnabled) {
            this._bidwrightEstimateButton.title = "Estimate link unavailable for this model tab";
        } else if (!canReachHost) {
            this._bidwrightEstimateButton.title = "Open from 3D takeoff to send quantities";
        } else if (!this._bidwrightContext.estimateTargetWorksheetId) {
            this._bidwrightEstimateButton.title = "Create or select a worksheet before creating line items";
        } else if (!selection || selection.selectedCount === 0) {
            this._bidwrightEstimateButton.title = "Select model geometry to send";
        } else {
            this._bidwrightEstimateButton.title = "Create a worksheet line item from the selected geometry";
        }
    }

    private _postBidWrightSelection(selection: BidWrightModelSelectionMessage) {
        if (window.parent && window.parent !== window) {
            window.parent.postMessage(selection, window.location.origin);
        }
        this._postBidWrightBroadcast("model-selection", selection);
    }

    private _postBidWrightBroadcast(
        type: BidWrightBroadcastType,
        selection: BidWrightModelSelectionMessage,
        eventId?: string,
        lineItemDraft?: BidWrightLineItemDraft,
    ) {
        this._bidwrightChannel?.postMessage({
            type,
            source: "bidwright-model-editor",
            version: 1,
            eventId,
            originId: this._bidwrightOriginId,
            projectId: this._bidwrightContext.projectId,
            modelId: this._bidwrightContext.modelId,
            modelDocumentId: this._bidwrightContext.modelDocumentId,
            selection,
            lineItemDraft,
        });
    }

    private readonly _handleBidWrightEstimateSend = () => {
        const selection = this._lastBidWrightSelection;
        if (!selection || selection.selectedCount === 0) return;
        if (!this._bidwrightContext.estimateTargetWorksheetId) return;

        const eventId = makeBidWrightEventId("model-estimate");
        const lineItemDraft = buildBidWrightLineItemDraft(this._bidwrightContext, selection, this._bidwrightQuantityBasis);
        const message = {
            type: "bidwright:model-send-to-estimate",
            source: "bidwright-model-editor",
            version: 1,
            eventId,
            projectId: this._bidwrightContext.projectId,
            modelId: this._bidwrightContext.modelId,
            modelDocumentId: this._bidwrightContext.modelDocumentId,
            selection,
            lineItemDraft,
        };

        if (window.parent && window.parent !== window) {
            window.parent.postMessage(message, window.location.origin);
        }
        this._postBidWrightBroadcast("model-send-to-estimate", selection, eventId, lineItemDraft);
        if (this._bidwrightEstimateStatus) {
            this._bidwrightEstimateStatus.textContent = "Line item sent";
        }
    };

    private readonly showSelectionControl = (controller: AsyncController) => {
        this._selectionController.setControl(controller);
        this._selectionController.style.visibility = "visible";
        this._selectionController.style.zIndex = "1000";
    };

    private readonly clearSelectionControl = () => {
        this._selectionController.setControl(undefined);
        this._selectionController.style.visibility = "hidden";
    };

    private readonly _handleMaterialEdit = (
        document: IDocument,
        editingMaterial: Material,
        callback: (material: Material) => void,
    ) => {
        const context = new MaterialDataContent(document, callback, editingMaterial);
        this._viewportContainer.append(new MaterialEditor(context));
    };

    private readonly _handleBidWrightSelectionChanged = (document: IDocument, selected: INode[]) => {
        if (!isBidWrightEmbedded()) return;

        const nodes = selected.map((node) => summarizeSelectionNode(node));
        const selection: BidWrightModelSelectionMessage = {
            type: "bidwright:model-selection",
            source: "bidwright-model-editor",
            version: 1,
            eventId: makeBidWrightEventId("model-selection"),
            projectId: this._bidwrightContext.projectId,
            modelId: this._bidwrightContext.modelId,
            modelDocumentId: this._bidwrightContext.modelDocumentId,
            fileName: this._bidwrightContext.fileName,
            quantityBasis: this._bidwrightQuantityBasis,
            documentId: document.id,
            documentName: document.name,
            selectedCount: selected.length,
            nodes,
            totals: {
                surfaceArea: nodes.reduce((total, node) => total + (node.surfaceArea ?? 0), 0),
                volume: nodes.reduce((total, node) => total + (node.volume ?? 0), 0),
                faceCount: nodes.reduce((total, node) => total + (node.faceCount ?? 0), 0),
                solidCount: nodes.reduce((total, node) => total + (node.solidCount ?? 0), 0),
            },
        };
        this._lastBidWrightSelection = selection;
        this._updateBidWrightEstimatePanel(selection);
        this._postBidWrightSelection(selection);
    };
}

customElements.define("chili-editor", Editor);
