// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { AppBuilder } from "@chili3d/builder";
import { type IApplication, Logger } from "@chili3d/core";
import { Loading } from "./loading";

const loading = new Loading();
document.body.appendChild(loading);

const startupParams = new URLSearchParams(window.location.search);
const startupModelUrl = startupParams.get("url") ?? startupParams.get("model");
const startupDocumentName =
    startupParams.get("fileName") ??
    startupModelUrl?.substring(startupModelUrl.lastIndexOf("/") + 1) ??
    "BidWright Model";
const startupModelFilePromise = startupModelUrl
    ? fetchStartupModelFile(startupModelUrl, startupDocumentName).catch((error) =>
          error instanceof Error ? error : new Error(String(error)),
      )
    : undefined;

function cleanImportFileName(fileName?: string | null) {
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

function fileNameFromContentDisposition(contentDisposition?: string | null) {
    if (!contentDisposition) return undefined;
    const encoded = /filename\*=UTF-8''([^;]+)/i.exec(contentDisposition)?.[1];
    if (encoded) return cleanImportFileName(decodeURIComponent(encoded));
    const quoted = /filename="([^"]+)"/i.exec(contentDisposition)?.[1];
    if (quoted) return cleanImportFileName(quoted);
    const bare = /filename=([^;]+)/i.exec(contentDisposition)?.[1];
    return cleanImportFileName(bare);
}

async function fetchStartupModelFile(url: string, preferredFileName?: string) {
    const response = await fetch(url, { credentials: "include", cache: "force-cache" });
    if (!response.ok) {
        throw new Error(`Failed to fetch model: ${url}, statusText: ${response.statusText}`);
    }
    const blob = await response.blob();
    const fileName =
        cleanImportFileName(preferredFileName) ??
        fileNameFromContentDisposition(response.headers.get("content-disposition")) ??
        cleanImportFileName(new URL(url, window.location.href).pathname) ??
        "model.step";
    return new File([blob], fileName, { type: blob.type });
}

type ImportCapableApplication = IApplication & {
    importFiles(files: File[]): Promise<void>;
};

async function handleApplicaionBuilt(app: IApplication) {
    document.body.removeChild(loading);

    const params = startupParams;
    const modelUrl = startupModelUrl;
    const documentName = startupDocumentName;

    await app.newDocument(documentName);

    const plugin = params.get("plugin");
    if (plugin) {
        Logger.info(`loading plugin from: ${plugin}`);
        await app.pluginManager.loadFromUrl(plugin);
    }
    if (modelUrl) {
        Logger.info(`loading file from: ${modelUrl}`);
        try {
            const file = startupModelFilePromise ? await startupModelFilePromise : await fetchStartupModelFile(modelUrl, documentName);
            if (file instanceof Error) throw file;
            await (app as ImportCapableApplication).importFiles([file]);
            app.activeView?.cameraController.fitContent();
        } catch (error) {
            Logger.error(error);
            await app.loadFileFromUrl(modelUrl, documentName);
        }
    }
}

// prettier-ignore
new AppBuilder()
    .useIndexedDB()
    .useWasmOcc()
    .useThree()
    .useUI()
    .build()
    .then(handleApplicaionBuilt)
    .catch((err) => {
        alert(err.message);
    });
