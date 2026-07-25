import { defineConfig } from 'tsup'

export default defineConfig([
  {
    entry: {
      index: 'src/index.ts',
      agent: 'src/agent/index.ts',
      'agent-core': 'src/agent/core.ts',
      // Node-runnable bins for npm consumers (shebang preserved from source).
      am: 'src/cli/am-bin.ts',
      'agentic-mermaid-mcp': 'src/mcp/mcp-bin.ts',
    },
    format: ['esm'],
    // Type declarations only for importable library entries, not CLI bins.
    dts: { entry: { index: 'src/index.ts', agent: 'src/agent/index.ts', 'agent-core': 'src/agent/core.ts' } },
    // All ESM entries share the renderer and agent substrate. Emit shared chunks
    // instead of publishing multi-megabyte copies.
    splitting: true,
    sourcemap: true,
    clean: true,
    target: 'es2022',
    outDir: 'dist',
    // Bundle roughjs/perfect-freehand into every installed entry: Node ESM
    // cannot resolve roughjs' extensionless bin/generator subpath. They remain
    // development inputs, not runtime dependencies of the published artifact.
    noExternal: ['roughjs', 'perfect-freehand'],
    external: ['@resvg/resvg-js', 'elkjs', 'entities', 'node:vm', 'node:fs', 'node:path', 'node:url', 'node:http', 'node:crypto', 'node:os'],
  },
  // Browser artifact: one self-contained IIFE for `<script src>` and CDN use,
  // so a browser consumer never has to invent a bundling step (BUILD-30). The
  // ESM entries above stay the supported path for anyone who already bundles.
  //
  // Everything is inlined — elkjs and entities are runtime deps of the Node
  // entries but there is no resolver in a plain script tag. `platform: 'browser'`
  // makes an accidental node: import a build error rather than a runtime one;
  // dist/index.ts is browserless by contract, so nothing should reach for it.
  //
  // `clean` must stay false: this config shares outDir with the ESM build and
  // would otherwise race it.
  {
    entry: { browser: 'src/index.ts' },
    format: ['iife'],
    globalName: 'agenticMermaid',
    platform: 'browser',
    dts: false,
    splitting: false,
    sourcemap: true,
    clean: false,
    minify: true,
    target: 'es2022',
    outDir: 'dist',
    noExternal: [/.*/],
    external: [],
  },
])
