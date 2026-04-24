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
    modelDocumentId?: string;
    fileName?: string;
    channelName?: string;
    estimateEnabled: boolean;
}

interface BidWrightModelSelectionMessage {
    type: "bidwright:model-selection";
    source: "bidwright-model-editor";
    version: 1;
    eventId?: string;
    projectId?: string;
    modelDocumentId?: string;
    fileName?: string;
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

type BidWrightBroadcastType = "model-selection" | "model-send-to-estimate";

function isBidWrightEmbedded() {
    const params = new URLSearchParams(window.location.search);
    return params.get("bidwright") === "1" || params.get("embedded") === "1";
}

function readBidWrightContext(): BidWrightContext {
    const params = new URLSearchParams(window.location.search);
    return {
        enabled: params.get("bidwright") === "1" || params.get("embedded") === "1",
        projectId: params.get("projectId") ?? undefined,
        modelDocumentId: params.get("modelDocumentId") ?? undefined,
        fileName: params.get("fileName") ?? undefined,
        channelName: params.get("channel") ?? undefined,
        estimateEnabled: params.get("estimate") === "1",
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
    private _lastBidWrightSelection?: BidWrightModelSelectionMessage;
    private _sidebarWidth: number = 360;
    private _isResizingSidebar: boolean = false;
    private _sidebarEl: HTMLDivElement | null = null;

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
        this._setupBidWrightEstimateBridge();
        this.clearSelectionControl();
        this.render();
    }

    private render() {
        this._sidebarEl = div(
            {
                className: style.sidebar,
                style: `width: ${this._sidebarWidth}px;`,
            },
            new ProjectView({ className: style.sidebarItem }),
            new PropertyView({ className: style.sidebarItem }),
            div({
                className: style.sidebarResizer,
                onmousedown: (e: MouseEvent) => this._startSidebarResize(e),
            }),
        );
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
    }

    disconnectedCallback(): void {
        PubSub.default.remove("showSelectionControl", this.showSelectionControl);
        PubSub.default.remove("editMaterial", this._handleMaterialEdit);
        PubSub.default.remove("clearSelectionControl", this.clearSelectionControl);
        PubSub.default.remove("selectionChanged", this._handleBidWrightSelectionChanged);
        this._bidwrightChannel?.close();
        this._bidwrightChannel = undefined;
    }

    private _setupBidWrightEstimateBridge() {
        if (!this._bidwrightContext.enabled) return;

        if (this._bidwrightContext.channelName && "BroadcastChannel" in window) {
            this._bidwrightChannel = new BroadcastChannel(this._bidwrightContext.channelName);
        }

        const panel = document.createElement("div");
        panel.className = style.bidwrightEstimatePanel;

        const label = document.createElement("span");
        label.className = style.bidwrightEstimateLabel;
        label.textContent = "Estimate";

        const status = document.createElement("span");
        status.className = style.bidwrightEstimateStatus;
        status.textContent = "No selection";

        const button = document.createElement("button");
        button.type = "button";
        button.className = style.bidwrightEstimateButton;
        button.setAttribute("data-bidwright-send-estimate", "1");
        button.textContent = "Send";
        button.onclick = this._handleBidWrightEstimateSend;

        panel.append(label, status, button);
        this._bidwrightEstimateStatus = status;
        this._bidwrightEstimateButton = button;
        this._viewportContainer.append(panel);
        this._updateBidWrightEstimatePanel();
    }

    private _updateBidWrightEstimatePanel(selection = this._lastBidWrightSelection) {
        if (!this._bidwrightEstimateStatus || !this._bidwrightEstimateButton) return;

        const canReachHost = Boolean(this._bidwrightChannel || window.parent !== window);
        const canSend = Boolean(
            this._bidwrightContext.estimateEnabled && canReachHost && selection && selection.selectedCount > 0,
        );

        if (!selection || selection.selectedCount === 0) {
            this._bidwrightEstimateStatus.textContent = "No selection";
        } else {
            const parts = [
                `${selection.selectedCount} selected`,
                formatModelQuantity(selection.totals.surfaceArea, "model^2"),
            ];
            if (selection.totals.volume > 0) {
                parts.push(formatModelQuantity(selection.totals.volume, "model^3"));
            }
            this._bidwrightEstimateStatus.textContent = parts.join(" | ");
        }

        this._bidwrightEstimateButton.disabled = !canSend;
        if (!this._bidwrightContext.estimateEnabled) {
            this._bidwrightEstimateButton.title = "Estimate link unavailable for this model tab";
        } else if (!canReachHost) {
            this._bidwrightEstimateButton.title = "Open from 3D takeoff to send quantities";
        } else if (!selection || selection.selectedCount === 0) {
            this._bidwrightEstimateButton.title = "Select model geometry to send";
        } else {
            this._bidwrightEstimateButton.title = "Send selected model quantity to the estimate";
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
    ) {
        this._bidwrightChannel?.postMessage({
            type,
            source: "bidwright-model-editor",
            version: 1,
            eventId,
            originId: this._bidwrightOriginId,
            projectId: this._bidwrightContext.projectId,
            modelDocumentId: this._bidwrightContext.modelDocumentId,
            selection,
        });
    }

    private readonly _handleBidWrightEstimateSend = () => {
        const selection = this._lastBidWrightSelection;
        if (!selection || selection.selectedCount === 0) return;

        const eventId = makeBidWrightEventId("model-estimate");
        const message = {
            type: "bidwright:model-send-to-estimate",
            source: "bidwright-model-editor",
            version: 1,
            eventId,
            projectId: this._bidwrightContext.projectId,
            modelDocumentId: this._bidwrightContext.modelDocumentId,
            selection,
        };

        if (window.parent && window.parent !== window) {
            window.parent.postMessage(message, window.location.origin);
        }
        this._postBidWrightBroadcast("model-send-to-estimate", selection, eventId);
        if (this._bidwrightEstimateStatus) {
            this._bidwrightEstimateStatus.textContent = "Sent to estimate";
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
            modelDocumentId: this._bidwrightContext.modelDocumentId,
            fileName: this._bidwrightContext.fileName,
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
