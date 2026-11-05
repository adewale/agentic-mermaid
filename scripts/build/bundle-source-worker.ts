import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/** Repository source execution and standalone builds only. */
export async function bundleNodeSourceWorker(entry = fileURLToPath(new URL('../../src/mcp/source-worker.ts', import.meta.url))): Promise<string> {
  const result = await Bun.build({
    entrypoints: [entry], target: 'node', format: 'esm', minify: true,
    // The bundle is self-contained. createRequire still needs a file URL for
    // optional Node builtins when the worker itself loads from a data URL.
    define: { 'import.meta.url': JSON.stringify('file:///agentic-mermaid-source-worker.js') },
    plugins: [{
      name: 'bundled-elk-constructor',
      setup(build) {
        build.onResolve({ filter: /^#elk-constructor$/ }, () => ({ path: resolve(dirname(entry), 'elk-constructor.js') }))
      },
    }],
  })
  if (!result.success) throw new AggregateError(result.logs, 'Could not bundle the capped Node worker')
  return result.outputs[0]!.text()
}
