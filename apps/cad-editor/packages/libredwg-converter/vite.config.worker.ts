import strip from 'vite-plugin-strip-comments'
import { visualizer } from 'rollup-plugin-visualizer'
import { defineConfig, PluginOption, Plugin } from 'vite'
import { resolve } from 'node:path'

/** Linked packages resolve outside node_modules; strip-comments breaks Emscripten glue (`"file://"`). */
function stripCommentsSafe(...args: Parameters<typeof strip>): Plugin {
  const plugin = strip(...args)
  const transform = plugin.transform
  if (transform) {
    plugin.transform = function (code, id, options) {
      if (id?.includes('libredwg-web')) {
        return { code, map: null }
      }
      return transform.call(this, code, id, options)
    }
  }
  return plugin
}

/**
 * Worker build intentionally avoids `build.lib`.
 *
 * Vite library mode always inlines assets (ignores assetsInlineLimit), which
 * turns the ~10 MB LibreDWG wasm into a multi-megabyte `data:` URI inside
 * `new URL(..., import.meta.url)`. Webpack then feeds that literal to its
 * resolver and can hang / throw (see mlightcad/cad-viewer#494).
 *
 * A normal Rollup entry emits `libredwg-web.wasm` next to the worker instead.
 */
export default defineConfig(({ mode }) => {
  const plugins: PluginOption[] = [stripCommentsSafe({ type: 'none' })]

  if (mode === 'analyze') {
    plugins.push(visualizer())
  }

  return {
    // Relative asset URLs so wasm resolves next to the worker wherever it is hosted.
    base: './',
    esbuild: {
      drop: ['console'],
      legalComments: 'none'
    },
    build: {
      emptyOutDir: false,
      outDir: 'dist',
      // Keep wasm as a sibling file (lib mode would force-inline it).
      assetsInlineLimit: 0,
      rollupOptions: {
        input: resolve(__dirname, 'src/AcDbLibreDwgParserWorker.ts'),
        external: [],
        output: {
          format: 'es',
          entryFileNames: 'libredwg-parser-worker.js',
          // Stable names so deploy/copy scripts can find assets next to the worker.
          assetFileNames: '[name][extname]',
          inlineDynamicImports: true,
          compact: true
        }
      },
      minify: 'esbuild'
    },
    plugins
  }
})
