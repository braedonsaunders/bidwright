import strip from 'vite-plugin-strip-comments'
import peerDepsExternal from 'rollup-plugin-peer-deps-external'
import { defineConfig, PluginOption } from 'vite'

export default defineConfig({
  esbuild: {
    drop: ['console'],
    legalComments: 'none'
  },
  build: {
    outDir: 'dist',
    lib: {
      entry: 'src/index.ts',
      name: 'geometry-engine',
      fileName: 'geometry-engine',
      formats: ['umd']
    },
    minify: 'esbuild',
    rollupOptions: {
      output: {
        compact: true
      }
    }
  },
  plugins: [strip({ type: 'none' }), peerDepsExternal() as PluginOption]
})
