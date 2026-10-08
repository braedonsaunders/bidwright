import { defineConfig } from 'tsup'

export default defineConfig(options => ({
  entry: ['src/index.ts'],
  format: ['esm', 'cjs'],
  dts: true,
  splitting: false,
  sourcemap: false,
  clean: !options.watch,
  treeshake: true,
  platform: 'neutral',
  // Match upstream 2.0.2 publish layout: ESM .mjs + CJS .js
  outExtension({ format }) {
    return {
      js: format === 'cjs' ? '.js' : '.mjs'
    }
  }
}))
