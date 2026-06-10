import { defineConfig } from 'tsup'

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    agent: 'src/agent/index.ts',
    // Node-runnable bins for npm consumers (shebang preserved from source).
    am: 'src/cli/am-bin.ts',
    'agentic-mermaid-mcp': 'src/mcp/mcp-bin.ts',
  },
  format: ['esm'],
  // Type declarations only for importable library entries, not CLI bins.
  dts: { entry: { index: 'src/index.ts', agent: 'src/agent/index.ts' } },
  splitting: false,
  sourcemap: true,
  clean: true,
  target: 'es2022',
  outDir: 'dist',
  external: ['@resvg/resvg-js', 'elkjs', 'entities', 'node:vm', 'node:fs', 'node:path', 'node:url'],
})
