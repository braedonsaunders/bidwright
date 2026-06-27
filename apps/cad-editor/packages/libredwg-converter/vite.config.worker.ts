import strip from 'vite-plugin-strip-comments'
import { visualizer } from 'rollup-plugin-visualizer'
import { defineConfig, PluginOption, Plugin } from 'vite'

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

export default defineConfig(({ mode }) => {
  const plugins: PluginOption[] = [stripCommentsSafe({ type: 'none' })]

  if (mode === 'analyze') {
    plugins.push(visualizer())
  }

  return {
    esbuild: {
      drop: ['console'],
      legalComments: 'none'
    },
    build: {
      emptyOutDir: false,
      outDir: 'dist',
      lib: {
        entry: 'src/AcDbLibreDwgParserWorker.ts',
        fileName: 'libredwg-parser-worker',
        formats: ['es']
      },
      minify: 'esbuild',
      rollupOptions: {
        external: [],
        output: {
          inlineDynamicImports: true,
          compact: true
        }
      }
    },
    plugins
  }
})
