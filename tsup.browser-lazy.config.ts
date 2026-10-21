import { defineConfig } from 'tsup'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'

const require = createRequire(import.meta.url)

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
  // Scene admission, ELK and the HTML5 entity table load on demand here.
  // Every import of src/shared/html-entity-table.ts gets its lazy twin, which fetches the
  // table only when renderMermaidSVGAsync sees a named code beyond XML's five.
  esbuildPlugins: [{
    name: 'lazy-browser-dependencies',
    setup(build) {
      build.onResolve({ filter: /\/html-entity-table\.ts$/ }, args =>
        ({ path: resolve(args.resolveDir, args.path.replace(/\.ts$/, '.lazy.ts')) }))
      build.onResolve({ filter: /\/elk-constructor\.ts$/ }, args =>
        ({ path: resolve(args.resolveDir, args.path.replace(/\.ts$/, '.lazy.ts')) }))
      build.onResolve({ filter: /\/admission\.ts$/ }, args => {
        const path = resolve(args.resolveDir, args.path)
        if (path !== resolve('src/scene/admission.ts')) return undefined
        return { path: path.replace(/\.ts$/, '.lazy.ts') }
      })
    },
  }],
  esbuildOptions(options) {
    options.chunkNames = 'browser-lazy/chunks/[name]-[hash]'
    options.assetNames = 'browser-lazy/assets/[name]-[hash]'
    // Keep the on-demand HTML5 table out of the XML decoder that is shared
    // by the initial loader and every family. The package's CJS and ESM
    // builds are equivalent but distinct bundler modules, so the table's
    // chunk carries only the named-reference data.
    options.alias = {
      ...options.alias,
      'entities/decode': require.resolve('entities/decode'),
    }
  },
})
