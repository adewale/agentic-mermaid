import { defineConfig } from 'tsup'
import { runtimeRenderContractPlugin } from './scripts/build/runtime-render-contract.ts'
import { compactBrowserModulesPlugin } from './scripts/build/compact-browser-modules.ts'
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'
import { readFile } from 'node:fs/promises'
import type { Plugin } from 'esbuild'

const require = createRequire(import.meta.url)

// Only the async renderer retries style acquisition. The isolated ZenUML
// entry must complete its synchronous request admission before queueing work.
export const lazyBrowserStyles: Plugin = {
  name: 'lazy-browser-styles',
  setup(build) {
    const styleRegistry = resolve(import.meta.dirname, 'src/scene/style-registry.ts')
    const styleRuntime = resolve(import.meta.dirname, 'src/browser-lazy/style-runtime.ts')
    const styleSchema = resolve(import.meta.dirname, 'src/render-style-option-schema.ts')
    build.onResolve({ filter: /\/render-style-option-schema\.ts$/ }, args =>
      args.importer !== styleRuntime && resolve(args.resolveDir, args.path) === styleSchema
        ? { path: resolve(import.meta.dirname, 'src/browser-lazy/render-style-option-schema.ts') } : undefined)
    build.onResolve({ filter: /\/style-registry\.ts$/ }, args =>
      args.importer !== styleRuntime && args.kind !== 'dynamic-import' && resolve(args.resolveDir, args.path) === styleRegistry
        ? { path: resolve(import.meta.dirname, 'src/browser-lazy/style-registry.ts') } : undefined)
  },
}

/** Only the source-only async entry selects a Native drawing consumer. The
 * canonical Scene SPI remains a real on-demand module, never a stub backend. */
export const lazyBrowserDrawingConsumer: Plugin = {
  name: 'lazy-browser-drawing-consumer',
  setup(build) {
    // These source/SDK leaves remain canonical outside this async-only graph.
    for (const leaf of ['load-family', 'render-consumer']) {
      const canonical = resolve(import.meta.dirname, `src/browser-lazy/${leaf}.ts`)
      build.onResolve({ filter: new RegExp(`/${leaf}\\.ts$`) }, args =>
        resolve(args.resolveDir, args.path) === canonical
          ? { path: resolve(import.meta.dirname, `src/browser-lazy/${leaf}.browser.ts`) } : undefined)
    }
    build.onLoad({ filter: /\/src\/browser-lazy\/families\/[^/]+\.ts$/ }, async args => ({
      contents: `${await readFile(args.path, 'utf8')}\nexport { renderLoadedFamilySvgWithReceipt } from '../render-core.ts'\n`,
      loader: 'ts', resolveDir: dirname(args.path),
    }))
    const flowParser = resolve(import.meta.dirname, 'src/flowchart-parser-entry.ts')
    build.onResolve({ filter: /\/flowchart-parser-entry\.ts$/ }, args =>
      resolve(args.resolveDir, args.path) === flowParser
        ? { path: resolve(import.meta.dirname, 'src/browser-lazy/flowchart-parser-entry.ts') } : undefined)
    const stateParser = resolve(import.meta.dirname, 'src/state-parser-entry.ts')
    build.onResolve({ filter: /\/state-parser-entry\.ts$/ }, args =>
      resolve(args.resolveDir, args.path) === stateParser
        ? { path: resolve(import.meta.dirname, 'src/browser-lazy/state-parser-entry.ts') } : undefined)
    const backend = resolve(import.meta.dirname, 'src/scene/backend.ts')
    const runtime = resolve(import.meta.dirname, 'src/browser-lazy/scene-backend-runtime.ts')
    const defaultBackend = resolve(import.meta.dirname, 'src/scene/default-backend.ts')
    const facade = resolve(import.meta.dirname, 'src/browser-lazy/scene-backend.ts')
    build.onResolve({ filter: /\/(?:backend|default-backend)\.ts$/ }, args => {
      const path = resolve(args.resolveDir, args.path)
      return args.importer !== runtime && (path === backend || path === defaultBackend) ? { path: facade } : undefined
    })
  },
}

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
  esbuildPlugins: [lazyBrowserDrawingConsumer, runtimeRenderContractPlugin({ schemaDocumentation: false, terminalAdapter: false, conformanceObservations: false, coalesceRuntimePrimitives: true, sourceOnlySceneAdmission: true, lazyLayoutOptimization: true }), lazyBrowserStyles, {
    name: 'lazy-browser-dependencies',
    setup(build) {
      // Styled and Native providers are requested after that same core has
      // loaded. Keep their shared primitives in the complete render union.
      build.onLoad({ filter: /\/src\/(?:scene\/builtin-backends|layout\/agentic-producer-core)\.ts$/ }, async args => ({
        contents: `${await readFile(args.path, 'utf8')}\nexport { renderLoadedFamilySvgWithReceipt } from '../browser-lazy/render-core.ts'\n`,
        loader: 'ts',
        resolveDir: dirname(args.path),
      }))
      // The lazy SVG API exposes rendering and receipts, not the Node option
      // and pass/shape inspectors. Omit their literal documentation prose while
      // retaining validation, shape aliases/geometry and executable contracts.
      // The SVG graph excludes agent verification, which uses shape prose in
      // substitution warnings; Node/IIFE keep that public documentation.
      build.onLoad({ filter: /\/(?:layout-engine|render-contract|flowchart-shapes)\.ts$/ }, async args => ({
        contents: (await readFile(args.path, 'utf8')).replace(/\b(doc|description): '(?:\\.|[^'\\])*'/g, "$1: ''"),
        loader: 'ts',
      }))
      build.onResolve({ filter: /\/parser-source\.ts$/ }, args =>
        args.kind === 'dynamic-import' ? undefined : { path: resolve(args.resolveDir, args.path.replace(/\.ts$/, '.lazy.ts')) })
      build.onResolve({ filter: /\/html-entity-table\.ts$/ }, args =>
        ({ path: resolve(args.resolveDir, args.path.replace(/\.ts$/, '.lazy.ts')) }))
      build.onResolve({ filter: /\/mermaid-yaml\.ts$/ }, args =>
        ({ path: resolve(args.resolveDir, args.path.replace(/\.ts$/, '.lazy.ts')) }))
      build.onResolve({ filter: /\/mermaid-config-merge\.ts$/ }, args =>
        ({ path: resolve(args.resolveDir, args.path.replace(/mermaid-config-merge\.ts$/, 'mermaid-yaml.lazy.ts')) }))
      build.onResolve({ filter: /\/elk-constructor\.ts$/ }, args =>
        ({ path: resolve(args.resolveDir, args.path.replace(/\.ts$/, '.lazy.ts')) }))
      build.onResolve({ filter: /\/edge-crossing-pair\.ts$/ }, args =>
        ({ path: resolve(args.resolveDir, args.path.replace(/\.ts$/, '.lazy.ts')) }))
      build.onResolve({ filter: /\/indexed-forest\.ts$/ }, args =>
        ({ path: resolve(args.resolveDir, args.path.replace(/\.ts$/, '.lazy.ts')) }))
      build.onResolve({ filter: /\/agentic-layered\.ts$/ }, args =>
        args.kind === 'dynamic-import' ? undefined : { path: resolve(args.resolveDir, args.path.replace(/\.ts$/, '.lazy.ts')) })
      build.onResolve({ filter: /\/trinity\.ts$/ }, args =>
        args.kind === 'dynamic-import' ? undefined : { path: resolve(args.resolveDir, args.path.replace(/\.ts$/, '.lazy.ts')) })
      build.onResolve({ filter: /\/trinity-producer\.ts$/ }, args =>
        args.kind === 'dynamic-import' ? undefined : { path: resolve(args.resolveDir, args.path.replace(/\.ts$/, '.lazy.ts')) })
      build.onResolve({ filter: /\/builtin-font-metrics\.ts$/ }, args =>
        ({ path: resolve(args.resolveDir, args.path.replace(/\.ts$/, '.lazy.ts')) }))
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
