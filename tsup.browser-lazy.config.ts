import { defineConfig } from 'tsup'
import { runtimeRenderContractPlugin } from './scripts/build/runtime-render-contract.ts'
import { compactBrowserModulesPlugin } from './scripts/build/compact-browser-modules.ts'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import { readFile } from 'node:fs/promises'

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
  // ELK, YAML and the HTML5 entity table load only when a diagram needs them.
  // Build-only facade twins preserve the synchronous source/Node APIs.
  esbuildPlugins: [runtimeRenderContractPlugin({ schemaDocumentation: false, terminalAdapter: false, conformanceObservations: false, coalesceRuntimePrimitives: true, sourceOnlySceneAdmission: true }), {
    name: 'lazy-browser-dependencies',
    setup(build) {
      // The lazy SVG API exposes rendering and receipts, not the Node option
      // and pass/shape inspectors. Omit their literal documentation prose while
      // retaining validation, shape aliases/geometry and executable contracts.
      // The SVG graph excludes agent verification, which uses shape prose in
      // substitution warnings; Node/IIFE keep that public documentation.
      build.onLoad({ filter: /\/(?:layout-engine|render-contract|flowchart-shapes)\.ts$/ }, async args => ({
        contents: (await readFile(args.path, 'utf8')).replace(/\b(doc|description): '(?:\\.|[^'\\])*'/g, "$1: ''"),
        loader: 'ts',
      }))
      build.onResolve({ filter: /\/html-entity-table\.ts$/ }, args =>
        ({ path: resolve(args.resolveDir, args.path.replace(/\.ts$/, '.lazy.ts')) }))
      build.onResolve({ filter: /\/mermaid-yaml\.ts$/ }, args =>
        ({ path: resolve(args.resolveDir, args.path.replace(/\.ts$/, '.lazy.ts')) }))
      build.onResolve({ filter: /\/elk-constructor\.ts$/ }, args =>
        ({ path: resolve(args.resolveDir, args.path.replace(/\.ts$/, '.lazy.ts')) }))
      build.onResolve({ filter: /\/edge-crossing-pair\.ts$/ }, args =>
        ({ path: resolve(args.resolveDir, args.path.replace(/\.ts$/, '.lazy.ts')) }))
      build.onResolve({ filter: /\/indexed-forest\.ts$/ }, args =>
        ({ path: resolve(args.resolveDir, args.path.replace(/\.ts$/, '.lazy.ts')) }))
      build.onResolve({ filter: /\/agentic-layered\.ts$/ }, args =>
        args.kind === 'dynamic-import' ? undefined : { path: resolve(args.resolveDir, args.path.replace(/\.ts$/, '.lazy.ts')) })
    },
  }, compactBrowserModulesPlugin()],
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
