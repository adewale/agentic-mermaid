import { defineConfig } from 'tsup'

export default defineConfig({
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
})
