import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import peerDepsExternal from 'rollup-plugin-peer-deps-external'
import { defineConfig, PluginOption } from 'vite'
import { viteStaticCopy } from 'vite-plugin-static-copy'
import { createLibEntryFileName } from '../vite-config/pluginRollupOutput'

const packageId = 'cad-simple-viewer'
const __dirname = dirname(fileURLToPath(import.meta.url))
const workspaceNodeModules = resolve(__dirname, '../../node_modules')

export default defineConfig({
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    lib: {
      entry: 'src/index.ts',
      name: packageId,
      fileName: format => createLibEntryFileName(packageId, format)
    },
    minify: true,
    rollupOptions: {
      output: {
        chunkFileNames: `${packageId}-[name]-[hash].js`
      }
    }
  },
  plugins: [
    peerDepsExternal() as PluginOption,
    viteStaticCopy({
      targets: [
        {
          src: './node_modules/@mlightcad/dxf-json-converter/dist/dxf-parser-worker.js',
          dest: ''
        },
        {
          src: './node_modules/@mlightcad/libredwg-converter/dist/libredwg-parser-worker.js',
          dest: ''
        },
        {
          src: resolve(
            workspaceNodeModules,
            '@mlightcad/mtext-renderer/dist/mtext-renderer-worker.js'
          ),
          dest: ''
        }
      ]
    })
  ]
})
