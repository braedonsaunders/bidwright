import strip from 'vite-plugin-strip-comments'
import { visualizer } from 'rollup-plugin-visualizer'
import { defineConfig, PluginOption } from 'vite'

export default defineConfig(({ mode }) => {
  const plugins: PluginOption[] = [strip({ type: 'none' })]

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
        entry: 'src/AcDbDxfParserWorker.ts',
        fileName: 'dxf-parser-worker',
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
