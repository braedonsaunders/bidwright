import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import { viteStaticCopy } from "vite-plugin-static-copy";
import { exampleRollupOutput } from "../vite-config/pluginRollupOutput";

const __dirname = dirname(fileURLToPath(import.meta.url));

const workerSource = "../cad-simple-viewer/dist/*-worker.js";
const htmlRuntimeSource = "../cad-html-plugin/dist/viewer-runtime.iife.js";

function assertRuntimeAssetsExist(): void {
  const workerDir = resolve(__dirname, "../cad-simple-viewer/dist");
  const runtimePath = resolve(__dirname, htmlRuntimeSource);
  if (!existsSync(workerDir) || !existsSync(runtimePath)) {
    throw new Error("CAD editor dependencies are not built. Run pnpm --dir apps/cad-editor run build:deps first.");
  }
}

export default defineConfig(() => {
  assertRuntimeAssetsExist();

  return {
    base: "./",
    build: {
      modulePreload: false,
      minify: true,
      rollupOptions: {
        input: {
          main: resolve(__dirname, "index.html"),
        },
        output: exampleRollupOutput,
      },
    },
    plugins: [
      viteStaticCopy({
        targets: [
          { src: workerSource, dest: "workers" },
          { src: htmlRuntimeSource, dest: "" },
        ],
      }),
    ],
  };
});
