import { resolve } from 'node:path'

const root = resolve(import.meta.dir, '../..')
const outputIndex = process.argv.indexOf('--outfile')
const outfile = outputIndex < 0 ? resolve(root, 'dist/am') : resolve(process.argv[outputIndex + 1]!)
const result = await Bun.build({
  root,
  entrypoints: [resolve(root, 'bin/am.ts'), resolve(root, 'src/mcp/source-worker.ts')],
  compile: { outfile },
  define: { __AM_STANDALONE__: 'true' },
})
if (!result.success) throw new AggregateError(result.logs, 'Standalone build failed')
