import { defineConfig, type Options } from 'tsup'
import browserLazyConfig, { lazyBrowserStyles } from './tsup.browser-lazy.config.ts'
const nativeBrowser = browserLazyConfig as Options
export default defineConfig([{
  // Reuse browser dependencies and validation, while keeping styles present
  // for this entry's synchronous admission before work is queued.
  ...nativeBrowser,
  esbuildPlugins: nativeBrowser.esbuildPlugins?.filter(plugin => plugin !== lazyBrowserStyles),
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
