import { defineConfig, type Options } from 'tsup'
import browserLazyConfig from './tsup.browser-lazy.config.ts'
const nativeBrowser = browserLazyConfig as Options
export default defineConfig([{
  // Reuse the browser dependency facades, validation trimming and resolver
  // policy; only the focused entry and emitted namespace differ.
  ...nativeBrowser,
  entry: { zenuml: 'src/zenuml/index.ts' },
  dts: false,
  // The canonical browser-lazy graph owns dist/metafile-esm.json.
  metafile: false,
  esbuildOptions(options, context) {
    nativeBrowser.esbuildOptions?.(options, context)
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
