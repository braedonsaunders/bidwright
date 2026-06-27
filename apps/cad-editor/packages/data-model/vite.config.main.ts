import strip from 'vite-plugin-strip-comments'
import peerDepsExternal from 'rollup-plugin-peer-deps-external'
import { visualizer } from 'rollup-plugin-visualizer'
import { defineConfig, type PluginOption } from 'vite'

export default defineConfig(({ mode }) => {
  const plugins: PluginOption[] = [
    strip({ type: 'none' }),
    peerDepsExternal() as PluginOption
  ]

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
        entry: 'src/index.ts',
        fileName: 'data-model',
        formats: ['cjs']
      },
      minify: 'esbuild',
      rollupOptions: {
        output: {
          inlineDynamicImports: true,
          compact: true
        }
      }
    },
    plugins
  }
})
