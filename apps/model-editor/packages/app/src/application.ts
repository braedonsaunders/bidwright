// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import {
    DOCUMENT_FILE_EXTENSION,
    getCurrentApplication,
    I18n,
    type IApplication,
    type ICommand,
    type IDataExchange,
    type IDocument,
    type IPluginManager,
    type IService,
    type IShapeFactory,
    type IStorage,
    type IView,
    type IVisualFactory,
    type IWindow,
    Logger,
    Material,
    ObservableCollection,
    PLUGIN_FILE_EXTENSION,
    Plane,
    PubSub,
    type Serialized,
    setCurrentApplication,
    Observable,
} from "@chili3d/core";
import { Document } from "./document";
import { PluginManager } from "./pluginManager";
import { importFiles } from "./utils";

export interface ApplicationOptions {
    visualFactory: IVisualFactory;
    shapeFactory: IShapeFactory;
    services: IService[];
    storage: IStorage;
    dataExchange: IDataExchange;
    mainWindow?: IWindow;
}

export class Application extends Observable implements IApplication {
    readonly dataExchange: IDataExchange;
    readonly visualFactory: IVisualFactory;
    readonly shapeFactory: IShapeFactory;
    readonly services: IService[];
    readonly storage: IStorage;
    readonly mainWindow?: IWindow;
    readonly pluginManager: IPluginManager;
    readonly views = new ObservableCollection<IView>();
    readonly documents: Set<IDocument> = new Set<IDocument>();

    get executingCommand(): ICommand | undefined {
        return this.getPrivateValue("executingCommand", undefined);
    }
    set executingCommand(value: ICommand | undefined) {
        this.setProperty("executingCommand", value);
    }

    get activeView(): IView | undefined {
        return this.getPrivateValue("activeView", undefined);
    }
    set activeView(value: IView | undefined) {
        this.setProperty("activeView", value, () => {
            PubSub.default.pub("activeViewChanged", value);
        });
    }

    constructor(option: ApplicationOptions) {
        super();

        if (getCurrentApplication() !== undefined) {
            throw new Error("Only one application can be created");
        }
        setCurrentApplication(this);
        this.visualFactory = option.visualFactory;
        this.shapeFactory = option.shapeFactory;
        this.services = option.services;
        this.storage = option.storage;
        this.dataExchange = option.dataExchange;
        this.mainWindow = option.mainWindow;
        this.pluginManager = new PluginManager(this);
        this.services.forEach((x) => x.register(this));
        this.services.forEach((x) => x.start());
        this.initWindowEvents();
    }

    private initWindowEvents() {
        window.onbeforeunload = this.handleWindowUnload;
        this.mainWindow?.addEventListener("dragstart", this.handleDragStart, false);
        // Use capture to intercept file-drop before nested widgets call stopPropagation().
        this.mainWindow?.addEventListener("dragover", this.handleDragOver, true);
        this.mainWindow?.addEventListener("drop", this.handleDrop, true);
        // Fallback: catch drag/drop anywhere in page, also in capture phase.
        window.addEventListener("dragover", this.handleDragOver, true);
        window.addEventListener("drop", this.handleDrop, true);
    }

    private readonly handleWindowUnload = (event: BeforeUnloadEvent) => {
        if (this.activeView) {
            // Cancel the event as stated by the standard.
            event.preventDefault();
            // Chrome requires returnValue to be set.
            event.returnValue = "";
        }
    };

    private readonly handleDragStart = (ev: DragEvent) => {
        ev.preventDefault();
    };

    private readonly handleDragOver = (ev: DragEvent) => {
        ev.stopPropagation();
        ev.preventDefault();
        if (ev.dataTransfer) {
            ev.dataTransfer.dropEffect = "copy";
        }
    };

    private readonly handleDrop = (ev: DragEvent) => {
        ev.stopPropagation();
        ev.preventDefault();
        const files = this.extractDroppedFiles(ev.dataTransfer);
        this.importFiles(files);
    };

    async importFiles(files: File[] | FileList | undefined) {
        if (!files || files.length === 0) {
            return;
        }
        const { opens, imports, plugins } = this.groupFiles(files);
        this.loadPluginsWithLoading(plugins);
        this.loadDocumentsWithLoading(opens);
        importFiles(this, imports);
    }

    private loadPluginsWithLoading(plugins: File[]) {
        PubSub.default.pub(
            "showPermanent",
            async () => {
                for (const pluginFile of plugins) {
                    await this.pluginManager.loadFromFile(pluginFile);
                }
            },
            "toast.executing{0}",
            I18n.translate("command.doc.open"),
        );
    }

    private loadDocumentsWithLoading(opens: File[]) {
        PubSub.default.pub(
            "showPermanent",
            async () => {
                for (const file of opens) {
                    const json: Serialized = JSON.parse(await file.text());
                    await this.loadDocument(json);
                    this.activeView?.cameraController.fitContent();
                }
            },
            "toast.executing{0}",
            I18n.translate("command.doc.open"),
        );
    }

    private groupFiles(files: FileList | File[]) {
        const opens: File[] = [];
        const imports: File[] = [];
        const plugins: File[] = [];
        for (const element of files) {
            const fileName = element.name.toLowerCase();
            if (fileName.endsWith(DOCUMENT_FILE_EXTENSION)) {
                opens.push(element);
            } else if (fileName.endsWith(PLUGIN_FILE_EXTENSION)) {
                plugins.push(element);
            } else {
                imports.push(element);
            }
        }
        return { opens, imports, plugins };
    }

    private extractDroppedFiles(dataTransfer: DataTransfer | null): File[] {
        if (!dataTransfer) return [];
        const fromFileList = Array.from(dataTransfer.files ?? []);
        if (fromFileList.length > 0) return fromFileList;
        const fromItems = Array.from(dataTransfer.items ?? [])
            .filter((item) => item.kind === "file")
            .map((item) => item.getAsFile())
            .filter((file): file is File => file !== null);
        return fromItems;
    }

    async openDocument(id: string): Promise<IDocument | undefined> {
        const document = await Document.open(this, id);
        await this.createActiveView(document);
        return document;
    }

    async newDocument(name: string): Promise<IDocument> {
        const document = new Document(this, name);
        const lightGray = new Material({ document, name: "LightGray", color: 0xdedede });
        const deepGray = new Material({ document, name: "DeepGray", color: 0x898989 });
        document.modelManager.materials.push(lightGray, deepGray);
        await this.createActiveView(document);
        return document;
    }

    async loadDocument(data: Serialized): Promise<IDocument | undefined> {
        const document = await Document.load(this, data);
        await this.createActiveView(document);
        return document;
    }

    async loadFileFromUrl(url: string, fileName?: string): Promise<void> {
        return Promise.try(async () => {
            const response = await fetch(url);
            if (!response.ok) {
                throw new Error(`Failed to fetch model: ${url}, statusText: ${response.statusText}`);
            }

            const filename = this.resolveImportFileName(url, fileName, response.headers.get("content-disposition"));
            if (!filename || !filename.includes(".")) {
                throw new Error(`No file name in url: ${url}`);
            }

            const blob = await response.blob();
            const file = new File([blob], filename, { type: blob.type });
            await this.importFiles([file]);
            this.activeView?.cameraController.fitContent();
        }).catch((err) => {
            Logger.error(err);
        });
    }

    private resolveImportFileName(url: string, preferredFileName?: string, contentDisposition?: string | null) {
        const preferred = this.cleanImportFileName(preferredFileName);
        if (preferred) return preferred;

        const dispositionName = this.fileNameFromContentDisposition(contentDisposition);
        if (dispositionName) return dispositionName;

        try {
            const parsedUrl = new URL(url, window.location.href);
            const queryName = this.cleanImportFileName(
                parsedUrl.searchParams.get("fileName") ?? parsedUrl.searchParams.get("name"),
            );
            if (queryName) return queryName;

            const pathName = this.cleanImportFileName(
                parsedUrl.pathname.substring(parsedUrl.pathname.lastIndexOf("/") + 1),
            );
            if (pathName) return pathName;
        } catch {
            return this.cleanImportFileName(url.substring(url.lastIndexOf("/") + 1));
        }

        return undefined;
    }

    private fileNameFromContentDisposition(contentDisposition?: string | null) {
        if (!contentDisposition) return undefined;
        const encoded = /filename\*=UTF-8''([^;]+)/i.exec(contentDisposition)?.[1];
        if (encoded) {
            return this.cleanImportFileName(decodeURIComponent(encoded));
        }

        const quoted = /filename="([^"]+)"/i.exec(contentDisposition)?.[1];
        if (quoted) return this.cleanImportFileName(quoted);

        const bare = /filename=([^;]+)/i.exec(contentDisposition)?.[1];
        return this.cleanImportFileName(bare);
    }

    private cleanImportFileName(fileName?: string | null) {
        const cleaned = fileName
            ?.trim()
            .replaceAll("\\", "/")
            .split("/")
            .pop()
            ?.split("?")[0]
            ?.split("#")[0]
            ?.trim();
        return cleaned || undefined;
    }

    protected async createActiveView(document: IDocument | undefined) {
        if (document === undefined) return undefined;
        const view = document.visual.createView("3d", Plane.XY);
        this.activeView = view;
    }
}
