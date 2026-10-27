import { defineConfig } from 'tsup'
export default defineConfig([{
  entry: { zenuml: 'src/zenuml/index.ts' },
  format: ['esm'],
  platform: 'browser',
  target: 'es2022',
  splitting: true,
  clean: false,
  minify: true,
  noExternal: [/.*/],
  external: [],
  outDir: 'dist',
  esbuildOptions(options) {
    options.chunkNames = 'zenuml/chunks/[name]-[hash]'
    options.assetNames = 'zenuml/assets/[name]-[hash]'
  },
}, {
  entry: { 'zenuml-frame': 'src/zenuml/frame.ts' },
  format: ['iife'],
  platform: 'browser',
  target: 'es2022',
  splitting: false,
  esbuildOptions(options) {
    options.legalComments = 'eof'
  },
  clean: false,
  minify: true,
  noExternal: [/.*/],
  outDir: 'dist',
}])
