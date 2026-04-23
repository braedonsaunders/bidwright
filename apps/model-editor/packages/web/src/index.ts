// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { AppBuilder } from "@chili3d/builder";
import { type IApplication, Logger } from "@chili3d/core";
import { Loading } from "./loading";

const loading = new Loading();
document.body.appendChild(loading);

async function handleApplicaionBuilt(app: IApplication) {
    document.body.removeChild(loading);

    const params = new URLSearchParams(window.location.search);
    const modelUrl = params.get("url") ?? params.get("model");
    const documentName =
        params.get("fileName") ??
        modelUrl?.substring(modelUrl.lastIndexOf("/") + 1) ??
        "BidWright Model";

    await app.newDocument(documentName);

    const plugin = params.get("plugin");
    if (plugin) {
        Logger.info(`loading plugin from: ${plugin}`);
        await app.pluginManager.loadFromUrl(plugin);
    }
    if (modelUrl) {
        Logger.info(`loading file from: ${modelUrl}`);
        await app.loadFileFromUrl(modelUrl);
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
