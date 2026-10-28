import { copyFileSync } from 'node:fs'
import { defineConfig } from 'tsup'

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
    // The default target of package.json `#elk-constructor`; see the plugin below.
    'elk-constructor': 'src/elk-constructor.ts',
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
  external: ['@resvg/resvg-js', 'elkjs', 'entities', 'node:vm', 'node:fs', 'node:path', 'node:url', 'node:http', 'node:crypto', 'node:os'],
  // Leave the ELK constructor to the consumer's resolver: under the `node`
  // condition Node and Bun load elkjs on first use, while browser and workerd
  // bundlers of these entries still bundle it. The Node twin is copied as is,
  // because bundling would hide its literal require from a consumer's bundler.
  onSuccess: async () => copyFileSync('src/elk-constructor.node.js', 'dist/elk-constructor.node.js'),
  esbuildPlugins: [{
    name: 'conditional-elk-constructor',
    setup(build) {
      build.onResolve({ filter: /\/elk-constructor\.ts$/ }, args =>
        args.kind === 'entry-point' ? undefined : { path: '#elk-constructor', external: true })
    },
  }],
})
