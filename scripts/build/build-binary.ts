import { resolve } from 'node:path'
import { bundleNodeSourceWorker } from './bundle-source-worker.ts'

const root = resolve(import.meta.dir, '../..')
const outputIndex = process.argv.indexOf('--outfile')
const outfile = outputIndex < 0 ? resolve(root, 'dist/am') : resolve(process.argv[outputIndex + 1]!)
const source = await bundleNodeSourceWorker(resolve(root, 'src/mcp/source-worker.ts'))
const result = await Bun.build({
  entrypoints: [resolve(root, 'bin/am.ts')],
  compile: { outfile },
  define: { __AM_NODE_WORKER_SOURCE__: JSON.stringify(source) },
})
if (!result.success) throw new AggregateError(result.logs, 'Standalone build failed')
