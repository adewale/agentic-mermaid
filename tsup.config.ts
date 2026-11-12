import { copyFileSync } from 'node:fs'
import { getHeapStatistics, setFlagsFromString } from 'node:v8'
import { defineConfig } from 'tsup'
import { build } from 'esbuild'

// tsup bundles declarations in a worker thread that needs between 2.5 and 3 GiB
// of heap, more than Node's default on smaller machines (about 2 GiB on 15 GiB
// RAM). A worker isolate reads the V8 heap flag when it is created, and this
// config loads before tsup starts that worker, so raise the limit here for
// every tsup invocation. A larger limit (e.g. from NODE_OPTIONS) is kept.
const DTS_HEAP_MB = 4096
if (getHeapStatistics().heap_size_limit < DTS_HEAP_MB * 2 ** 20) {
  setFlagsFromString(`--max-old-space-size=${DTS_HEAP_MB}`)
}

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    svg: 'src/svg.ts',
    'svg-styles': 'src/svg-styles.ts',
    agent: 'src/agent/index.ts',
    'agent-core': 'src/agent/core.ts',
    // Node-runnable bins for npm consumers (shebang preserved from source).
    am: 'src/cli/am-bin.ts',
    'agentic-mermaid-mcp': 'src/mcp/mcp-bin.ts',
    'source-worker': 'src/mcp/source-worker.ts',
    'source-supervisor': 'src/mcp/source-supervisor.ts',
    // The default target of package.json `#elk-constructor`; see the plugin below.
    'elk-constructor': 'src/elk-constructor.ts',
    'builtin-font-metrics': 'src/builtin-font-metrics.ts',
    'builtin-font-metrics.node': 'src/builtin-font-metrics.node.ts',
    'layout-optimization': 'src/layout/optimization-context.ts',
    'layout-optimization.node': 'src/layout/optimization-context.node.ts',
  },
  format: ['esm'],
  // Type declarations only for importable library entries, not CLI bins.
  dts: { entry: { index: 'src/index.ts', zenuml: 'src/zenuml/index.ts', svg: 'src/svg.ts', 'svg-styles': 'src/svg-styles.ts', agent: 'src/agent/index.ts', 'agent-core': 'src/agent/core.ts' } },
  // Node/bundler ESM entries share the renderer and agent substrate. The
  // directly served optional ZenUML browser ESM is built separately so it
  // cannot inherit bare Node-runtime dependency imports from these chunks.
  splitting: true,
  sourcemap: true,
  clean: true,
  target: 'es2022',
  outDir: 'dist',
  // Keep Node syntax intact: syntax folding slowed the first repeated State
  // renders in installed Node comparisons. Compact whitespace and identifiers
  // independently; documented diagnostic names remain explicit in the source.
  // The lazy ELK loader stays external; browser builds minify independently.
  esbuildOptions(options) {
    options.minifyWhitespace = true
    options.minifyIdentifiers = true
  },
  // Bundle roughjs/perfect-freehand into every installed entry: Node ESM
  // cannot resolve roughjs' extensionless bin/generator subpath. They remain
  // development inputs, not runtime dependencies of the published artifact.
  noExternal: ['roughjs', 'perfect-freehand'],
  external: ['./inter-metrics-kernel.cjs', './layout-optimization.cjs', '@resvg/resvg-js', 'elkjs', 'entities', 'node:vm', 'node:fs', 'node:path', 'node:url', 'node:http', 'node:crypto', 'node:os'],
  // Leave the ELK constructor to the consumer's resolver: under the `node`
  // condition Node and Bun load elkjs on first use, while browser and workerd
  // bundlers of these entries still bundle it. The Node twin is copied as is,
  // because bundling would hide its literal require from a consumer's bundler.
  onSuccess: async () => {
    copyFileSync('src/elk-constructor.node.js', 'dist/elk-constructor.node.js')
    copyFileSync('src/optional-kernels.node.js', 'dist/optional-kernels.node.js')
    for (const [entry, output] of [['src/inter-metrics-kernel.ts', 'inter-metrics-kernel'], ['src/layout/optimization-runtime.ts', 'layout-optimization']]) {
      await build({ entryPoints: [entry!], outfile: `dist/${output}.cjs`, bundle: true, platform: 'node', format: 'cjs', target: 'es2022', minify: true })
    }
  },
  esbuildPlugins: [{
    name: 'conditional-runtime-providers',
    setup(build) {
      // Reuse the pure kernels for synchronous non-Node consumers too.
      // Their bundler resolves CJS; installed Node still defers its require.
      build.onResolve({ filter: /\/inter-metrics-kernel\.ts$/ }, () => ({ path: './inter-metrics-kernel.cjs', external: true }))
      build.onResolve({ filter: /\/optimization-runtime\.ts$/ }, () => ({ path: './layout-optimization.cjs', external: true }))
      build.onResolve({ filter: /\/optional-kernels\.node\.js$/ }, () => ({ path: '#optional-kernels', external: true }))
      build.onResolve({ filter: /\/builtin-font-metrics\.ts$/ }, args =>
        args.kind === 'entry-point' ? undefined : { path: '#builtin-font-metrics', external: true })
      build.onResolve({ filter: /\/optimization-context\.ts$/ }, args =>
        args.kind === 'entry-point' ? undefined : { path: '#layout-optimization', external: true })
      build.onResolve({ filter: /\/elk-constructor\.ts$/ }, args =>
        args.kind === 'entry-point' ? undefined : { path: '#elk-constructor', external: true })
    },
  }],
})
