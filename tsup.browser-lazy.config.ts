import { defineConfig } from 'tsup'

// Framework-neutral ESM renderer. The entry contains source normalization and
// the generated family catalog; family implementations and the shared SVG
// backend arrive through native dynamic import only when requested.
export default defineConfig({
  entry: { 'browser-lazy/index': 'src/browser-lazy.ts' },
  format: ['esm'],
  platform: 'browser',
  dts: { entry: { 'browser-lazy/index': 'src/browser-lazy.ts' } },
  splitting: true,
  sourcemap: false,
  // The preceding exact-target cleanup preserves Node/IIFE siblings while
  // making this standalone build history-independent. tsup's `clean` option
  // always starts with `**/*` under outDir, so it cannot express that safely.
  clean: false,
  minify: true,
  target: 'es2022',
  outDir: 'dist',
  metafile: true,
  noExternal: [/.*/],
  external: [],
  esbuildOptions(options) {
    options.chunkNames = 'browser-lazy/chunks/[name]-[hash]'
    options.assetNames = 'browser-lazy/assets/[name]-[hash]'
  },
})
