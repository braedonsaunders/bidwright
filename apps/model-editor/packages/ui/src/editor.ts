// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import {
    type AsyncController,
    type CommandKeys,
    type IApplication,
    type IDocument,
    type IFace,
    type INode,
    type IShape,
    type ISolid,
    type Material,
    NodeUtils,
    PubSub,
    type Ribbon,
    ShapeNode,
    ShapeTypes,
    Transaction,
    VisualNode,
} from "@chili3d/core";
import { div, svg } from "@chili3d/element";
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
    path?: string[];
    externalId?: string;
    modelElementId?: string;
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

type BidWrightBroadcastType = "model-selection";

interface ContextMenuAction {
    label: string;
    icon?: string;
    shortcut?: string;
    disabled?: boolean;
    checked?: boolean;
    danger?: boolean;
    action: () => void | Promise<void>;
}

interface ContextMenuSection {
    title?: string;
    items: ContextMenuAction[];
}

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

function nodePath(node: INode) {
    const path: string[] = [];
    let cursor: INode | undefined = node;
    while (cursor) {
        if (cursor.name) path.unshift(cursor.name);
        cursor = cursor.parent;
    }
    return path.slice(-10);
}

function summarizeShapeNode(node: ShapeNode): BidWrightSelectionNode {
    if (!node.shape.isOk) {
        return { id: node.id, name: node.name, kind: node.constructor.name, path: nodePath(node), externalId: node.id };
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
            path: nodePath(node),
            externalId: node.id,
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
        path: nodePath(node),
        externalId: node.id,
    };
}

export class Editor extends HTMLElement {
    private readonly _selectionController: OKCancel;
    private readonly _viewportContainer: HTMLDivElement;
    private readonly _bidwrightContext = readBidWrightContext();
    private readonly _bidwrightOriginId = makeBidWrightEventId("model-editor");
    private _bidwrightChannel?: BroadcastChannel;
    private _lastBidWrightSelection?: BidWrightModelSelectionMessage;
    private _bidwrightQuantityBasis: BidWrightQuantityBasis = "count";
    private _sidebarWidth: number = 360;
    private _isResizingSidebar: boolean = false;
    private _sidebarEl: HTMLDivElement | null = null;
    private _sidebarPanels = new Map<string, HTMLElement>();
    private _sidebarButtons = new Map<string, HTMLButtonElement>();
    private _activeSidebarTab = "items";
    private _contextMenuEl?: HTMLDivElement;

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
        this._activeSidebarTab = "items";
        this._setupBidWrightModelBridge();
        this.clearSelectionControl();
        this.render();
    }

    private render() {
        const tabs: Array<{ id: string; label: string; content: HTMLElement }> = [
            { id: "items", label: "Items", content: new ProjectView({ className: style.sidebarItem }) },
        ];
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
        this.addEventListener("contextmenu", this._handleContextMenu);
        window.addEventListener("pointerdown", this._handleContextMenuOutsidePointerDown, true);
        window.addEventListener("keydown", this._handleContextMenuKeyDown);
        window.addEventListener("resize", this._closeContextMenu);
    }

    disconnectedCallback(): void {
        PubSub.default.remove("showSelectionControl", this.showSelectionControl);
        PubSub.default.remove("editMaterial", this._handleMaterialEdit);
        PubSub.default.remove("clearSelectionControl", this.clearSelectionControl);
        PubSub.default.remove("selectionChanged", this._handleBidWrightSelectionChanged);
        this.removeEventListener("contextmenu", this._handleContextMenu);
        window.removeEventListener("pointerdown", this._handleContextMenuOutsidePointerDown, true);
        window.removeEventListener("keydown", this._handleContextMenuKeyDown);
        window.removeEventListener("resize", this._closeContextMenu);
        this._closeContextMenu();
        this._bidwrightChannel?.close();
        this._bidwrightChannel = undefined;
    }

    private readonly _handleContextMenu = (event: MouseEvent) => {
        if (this._shouldUseNativeContextMenu(event)) return;
        event.preventDefault();
        event.stopPropagation();
        this._selectContextTreeItem(event);
        this._showContextMenu(event.clientX, event.clientY);
    };

    private _shouldUseNativeContextMenu(event: MouseEvent) {
        const target = event.target instanceof HTMLElement ? event.target : null;
        return Boolean(target?.closest("input, textarea, select, [contenteditable='true']"));
    }

    private _selectContextTreeItem(event: MouseEvent) {
        const document = this.app.activeView?.document;
        const target = event.target instanceof HTMLElement ? event.target : null;
        const treeItem = target?.closest("tree-model, tree-group") as (HTMLElement & { node?: INode }) | null;
        if (!document || !treeItem?.node) return;
        const selected = document.selection.getSelectedNodes();
        if (!selected.includes(treeItem.node)) {
            document.selection.setSelection([treeItem.node], event.ctrlKey || event.metaKey);
        }
    }

    private _showContextMenu(clientX: number, clientY: number) {
        this._closeContextMenu();

        const menu = document.createElement("div");
        menu.className = style.contextMenu;
        menu.setAttribute("role", "menu");
        menu.style.visibility = "hidden";

        const activeDocument = this.app.activeView?.document;
        const selectedCount = activeDocument?.selection.getSelectedNodes().length ?? 0;
        const title = selectedCount > 0
            ? `${selectedCount} selected`
            : activeDocument?.name ?? "Model";
        const subtitle = this._lastBidWrightSelection?.selectedCount
            ? `${formatModelNumber(this._lastBidWrightSelection.selectedCount)} model element${this._lastBidWrightSelection.selectedCount === 1 ? "" : "s"}`
            : "Right-click command menu";
        const header = div(
            { className: style.contextMenuHeader },
            div({ className: style.contextMenuTitle, textContent: title }),
            div({ className: style.contextMenuSubtitle, textContent: subtitle }),
        );
        menu.append(header);

        const body = div({ className: style.contextMenuBody });
        for (const section of this._contextMenuSections()) {
            const visibleItems = section.items.filter(Boolean);
            if (visibleItems.length === 0) continue;
            const sectionEl = div({ className: style.contextMenuSection });
            if (section.title) {
                sectionEl.append(div({ className: style.contextMenuSectionTitle, textContent: section.title }));
            }
            for (const item of visibleItems) {
                sectionEl.append(this._createContextMenuButton(item));
            }
            body.append(sectionEl);
        }
        menu.append(body);

        document.body.append(menu);
        this._contextMenuEl = menu;

        requestAnimationFrame(() => {
            const margin = 8;
            const rect = menu.getBoundingClientRect();
            const left = Math.min(Math.max(margin, clientX), Math.max(margin, window.innerWidth - rect.width - margin));
            const top = Math.min(Math.max(margin, clientY), Math.max(margin, window.innerHeight - rect.height - margin));
            menu.style.left = `${left}px`;
            menu.style.top = `${top}px`;
            menu.style.visibility = "visible";
            menu.focus();
        });
    }

    private _createContextMenuButton(item: ContextMenuAction) {
        const button = document.createElement("button");
        button.type = "button";
        button.className = style.contextMenuItem;
        button.disabled = item.disabled === true;
        button.setAttribute("role", "menuitem");
        if (item.checked) button.classList.add(style.contextMenuItemChecked);
        if (item.danger) button.classList.add(style.contextMenuItemDanger);

        const icon = item.checked ? "icon-check" : item.icon;
        const iconSlot = document.createElement("span");
        iconSlot.className = style.contextMenuIcon;
        if (icon) {
            iconSlot.append(svg({ className: style.contextMenuSvg, icon }));
        }

        const label = document.createElement("span");
        label.className = style.contextMenuLabel;
        label.textContent = item.label;

        const shortcut = document.createElement("span");
        shortcut.className = style.contextMenuShortcut;
        shortcut.textContent = item.shortcut ?? "";

        button.append(iconSlot, label, shortcut);
        button.onclick = () => {
            if (item.disabled) return;
            this._closeContextMenu();
            void Promise.resolve(item.action()).catch((error) => {
                console.error("[model-editor] Context menu action failed:", error);
                PubSub.default.pub("displayError", String(error));
            });
        };
        return button;
    }

    private _contextMenuSections(): ContextMenuSection[] {
        const activeView = this.app.activeView;
        const activeDocument = activeView?.document;
        const selectedNodes = activeDocument?.selection.getSelectedNodes() ?? [];
        const visualNodes = activeDocument?.modelManager.findNodes((node) => node instanceof VisualNode) ?? [];
        const hasDocument = Boolean(activeDocument);
        const hasSelection = selectedNodes.length > 0;
        return [
            {
                title: "Selection",
                items: [
                    {
                        label: "Select All Geometry",
                        icon: "icon-all",
                        shortcut: "Ctrl+A",
                        disabled: visualNodes.length === 0,
                        action: () => this._selectAllGeometry(),
                    },
                    {
                        label: "Clear Selection",
                        icon: "icon-ban",
                        shortcut: "Esc",
                        disabled: !hasSelection,
                        action: () => this._clearModelSelection(),
                    },
                    {
                        label: "Copy Quantity Summary",
                        icon: "icon-copy",
                        disabled: !this._lastBidWrightSelection,
                        action: () => this._copyBidWrightQuantitySummary(),
                    },
                    {
                        label: "Hide Selected",
                        icon: "icon-eye-slash",
                        disabled: !hasSelection,
                        action: () => this._setSelectedVisibility(false),
                    },
                    {
                        label: "Isolate Selected",
                        icon: "icon-filter",
                        disabled: !hasSelection,
                        action: () => this._isolateSelection(),
                    },
                    {
                        label: "Show All",
                        icon: "icon-eye",
                        disabled: visualNodes.length === 0,
                        action: () => this._showAllGeometry(),
                    },
                    {
                        label: "Duplicate Selected",
                        icon: "icon-copy",
                        disabled: !hasSelection,
                        action: () => this._duplicateSelection(),
                    },
                    {
                        label: "Delete Selected",
                        icon: "icon-delete",
                        shortcut: "Del",
                        disabled: !hasSelection,
                        danger: true,
                        action: () => this._executeCommand("modify.deleteNode"),
                    },
                ],
            },
            {
                title: "View",
                items: [
                    {
                        label: "Fit Model",
                        icon: "icon-fitcontent",
                        shortcut: "F",
                        disabled: !activeView,
                        action: () => this._fitActiveView(),
                    },
                    {
                        label: "Zoom In",
                        icon: "icon-zoomin",
                        disabled: !activeView,
                        action: () => this._zoomActiveView(-5),
                    },
                    {
                        label: "Zoom Out",
                        icon: "icon-zoomout",
                        disabled: !activeView,
                        action: () => this._zoomActiveView(5),
                    },
                    {
                        label: "Orthographic",
                        icon: "icon-orthographic",
                        checked: (activeView?.cameraController as { cameraType?: string } | undefined)?.cameraType === "orthographic",
                        disabled: !activeView,
                        action: () => this._setCameraType("orthographic"),
                    },
                    {
                        label: "Perspective",
                        icon: "icon-perspective",
                        checked: (activeView?.cameraController as { cameraType?: string } | undefined)?.cameraType === "perspective",
                        disabled: !activeView,
                        action: () => this._setCameraType("perspective"),
                    },
                ],
            },
            {
                title: "Edit",
                items: [
                    { label: "Undo", icon: "icon-undo", shortcut: "Ctrl+Z", disabled: !hasDocument, action: () => this._executeCommand("edit.undo") },
                    { label: "Redo", icon: "icon-redo", shortcut: "Ctrl+Y", disabled: !hasDocument, action: () => this._executeCommand("edit.redo") },
                    { label: "Properties", icon: "icon-cog", disabled: !hasDocument, action: () => this._setActiveSidebarTab("properties") },
                    { label: "New Folder", icon: "icon-folder-plus", disabled: !hasDocument, action: () => this._executeCommand("create.folder") },
                    { label: "Import Model", icon: "icon-import", disabled: !hasDocument, action: () => this._executeCommand("file.import") },
                    { label: "Export Model", icon: "icon-export", disabled: !hasDocument, action: () => this._executeCommand("file.export") },
                ],
            },
            {
                title: "Modify",
                items: [
                    { label: "Move", icon: "icon-move", disabled: !hasSelection, action: () => this._executeCommand("modify.move") },
                    { label: "Rotate", icon: "icon-rotate", disabled: !hasSelection, action: () => this._executeCommand("modify.rotate") },
                    { label: "Mirror", icon: "icon-mirror", disabled: !hasSelection, action: () => this._executeCommand("modify.mirror") },
                    { label: "Explode", icon: "icon-explode", disabled: !hasSelection, action: () => this._executeCommand("modify.explode") },
                    { label: "Fillet", icon: "icon-fillet", disabled: !hasSelection, action: () => this._executeCommand("modify.fillet") },
                    { label: "Chamfer", icon: "icon-chamfer", disabled: !hasSelection, action: () => this._executeCommand("modify.chamfer") },
                    { label: "Simplify Shape", icon: "icon-simplify", disabled: !hasSelection, action: () => this._executeCommand("modify.simplifyShape") },
                ],
            },
            {
                title: "Create / Measure",
                items: [
                    { label: "Box", icon: "icon-box", disabled: !hasDocument, action: () => this._executeCommand("create.box") },
                    { label: "Cylinder", icon: "icon-cylinder", disabled: !hasDocument, action: () => this._executeCommand("create.cylinder") },
                    { label: "Sphere", icon: "icon-sphere", disabled: !hasDocument, action: () => this._executeCommand("create.sphere") },
                    { label: "Line", icon: "icon-line", disabled: !hasDocument, action: () => this._executeCommand("create.line") },
                    { label: "Rectangle", icon: "icon-rect", disabled: !hasDocument, action: () => this._executeCommand("create.rect") },
                    { label: "Circle", icon: "icon-circle", disabled: !hasDocument, action: () => this._executeCommand("create.circle") },
                    { label: "Measure Length", icon: "icon-measureLength", disabled: !hasDocument, action: () => this._executeCommand("measure.length") },
                    { label: "Measure Angle", icon: "icon-measureAngle", disabled: !hasDocument, action: () => this._executeCommand("measure.angle") },
                ],
            },
        ];
    }

    private async _copyBidWrightQuantitySummary() {
        const selection = this._lastBidWrightSelection;
        if (!selection) return;
        const primary = primaryBidWrightSelectionQuantity(selection, this._bidwrightQuantityBasis);
        const lines = [
            `Model: ${selection.documentName ?? selection.fileName ?? this._bidwrightContext.fileName ?? "Model"}`,
            `Worksheet: ${this._bidwrightContext.estimateTargetWorksheetName ?? "No worksheet selected"}`,
            `Quantity: ${formatModelQuantity(primary.quantity, primary.uom)}`,
            `Basis: ${primary.label}`,
            `Area: ${formatModelQuantity(selection.totals.surfaceArea, "model^2")}`,
            `Volume: ${formatModelQuantity(selection.totals.volume, "model^3")}`,
            `Faces: ${formatModelNumber(selection.totals.faceCount)}`,
            `Solids: ${formatModelNumber(selection.totals.solidCount)}`,
        ];
        await navigator.clipboard?.writeText(lines.join("\n"));
    }

    private _executeCommand(command: CommandKeys) {
        PubSub.default.pub("executeCommand", command);
    }

    private _selectAllGeometry() {
        const document = this.app.activeView?.document;
        if (!document) return;
        const nodes = document.modelManager.findNodes((node) => node instanceof VisualNode);
        document.selection.setSelection(nodes, false);
    }

    private _clearModelSelection() {
        const document = this.app.activeView?.document;
        document?.selection.clearSelection();
        document?.visual.highlighter.clear();
        document?.visual.update();
    }

    private _setSelectedVisibility(visible: boolean) {
        const document = this.app.activeView?.document;
        const selected = document?.selection.getSelectedNodes() ?? [];
        if (!document || selected.length === 0) return;
        Transaction.execute(document, visible ? "show selected" : "hide selected", () => {
            selected.forEach((node) => {
                node.visible = visible;
            });
        });
        document.visual.update();
    }

    private _isolateSelection() {
        const document = this.app.activeView?.document;
        const selected = document?.selection.getSelectedNodes() ?? [];
        if (!document || selected.length === 0) return;
        const selectedSet = new Set(selected);
        const visualNodes = document.modelManager.findNodes((node) => node instanceof VisualNode);
        Transaction.execute(document, "isolate selected", () => {
            visualNodes.forEach((node) => {
                node.visible = this._nodeIsWithinSelection(node, selectedSet);
            });
        });
        document.visual.update();
    }

    private _nodeIsWithinSelection(node: INode, selectedSet: Set<INode>) {
        let cursor: INode | undefined = node;
        while (cursor) {
            if (selectedSet.has(cursor)) return true;
            cursor = cursor.parent;
        }
        return false;
    }

    private _showAllGeometry() {
        const document = this.app.activeView?.document;
        if (!document) return;
        const nodes = document.modelManager.findNodes();
        Transaction.execute(document, "show all", () => {
            nodes.forEach((node) => {
                node.visible = true;
            });
        });
        document.visual.update();
    }

    private _duplicateSelection() {
        const document = this.app.activeView?.document;
        const selected = document?.selection.getSelectedNodes() ?? [];
        if (!document || selected.length === 0) return;
        const topLevelNodes = NodeUtils.findTopLevelNodes(new Set(selected));
        const clones: INode[] = [];
        Transaction.execute(document, "duplicate selected", () => {
            topLevelNodes.forEach((node) => {
                const clone = node.clone();
                node.parent?.insertAfter(node, clone);
                clones.push(clone);
            });
        });
        if (clones.length > 0) {
            document.selection.setSelection(clones, false);
        }
        document.visual.update();
    }

    private _fitActiveView() {
        this.app.activeView?.cameraController.fitContent();
        this.app.activeView?.update();
    }

    private _zoomActiveView(delta: number) {
        const view = this.app.activeView;
        if (!view) return;
        view.cameraController.zoom(view.width / 2, view.height / 2, delta);
        view.update();
    }

    private _setCameraType(cameraType: "orthographic" | "perspective") {
        const view = this.app.activeView;
        if (!view) return;
        view.cameraController.cameraType = cameraType;
        view.update();
    }

    private readonly _handleContextMenuOutsidePointerDown = (event: PointerEvent) => {
        if (this._contextMenuEl?.contains(event.target as Node)) return;
        this._closeContextMenu();
    };

    private readonly _handleContextMenuKeyDown = (event: KeyboardEvent) => {
        if (event.key === "Escape") {
            this._closeContextMenu();
            return;
        }
        if (event.key !== "ContextMenu" && !(event.shiftKey && event.key === "F10")) return;
        if (!(event.target instanceof Node) || !this.contains(event.target)) return;
        if (this._shouldUseNativeContextMenu(event as unknown as MouseEvent)) return;
        event.preventDefault();
        event.stopPropagation();

        const activeElement = document.activeElement instanceof HTMLElement && this.contains(document.activeElement)
            ? document.activeElement
            : this;
        const rect = activeElement.getBoundingClientRect();
        const x = rect.left + Math.min(Math.max(24, rect.width / 2), Math.max(24, rect.width - 24));
        const y = rect.top + Math.min(Math.max(24, rect.height / 2), Math.max(24, rect.height - 24));
        this._showContextMenu(x, y);
    };

    private readonly _closeContextMenu = () => {
        this._contextMenuEl?.remove();
        this._contextMenuEl = undefined;
    };

    private _setupBidWrightModelBridge() {
        if (!this._bidwrightContext.enabled) return;

        if (this._bidwrightContext.channelName && "BroadcastChannel" in window) {
            this._bidwrightChannel = new BroadcastChannel(this._bidwrightContext.channelName);
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
    ) {
        this._bidwrightChannel?.postMessage({
            type,
            source: "bidwright-model-editor",
            version: 1,
            eventId: selection.eventId,
            originId: this._bidwrightOriginId,
            projectId: this._bidwrightContext.projectId,
            modelId: this._bidwrightContext.modelId,
            modelDocumentId: this._bidwrightContext.modelDocumentId,
            selection,
        });
    }

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
        this._postBidWrightSelection(selection);
    };
}

customElements.define("chili-editor", Editor);
