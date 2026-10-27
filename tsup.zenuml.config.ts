import { defineConfig } from 'tsup'
export default defineConfig({
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
})
