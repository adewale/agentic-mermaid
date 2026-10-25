import { readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import { createMeaningAdapter } from '../fidelity/adapters.ts'
import { assertBenchmarkExecutionAllowed } from '../ci-policy.ts'
import { executeProjectedUpstreamFiles } from './upstream-fidelity-executor.mjs'
import { projectPublicDatabase } from './upstream-fidelity-projection.mjs'

assertBenchmarkExecutionAllowed()
const job = JSON.parse(readFileSync(process.argv[2], 'utf8'))
try {
  const adapter = await createMeaningAdapter({ tool: job.tool, packageRoot: job.packageRoot, referenceRoot: job.referenceRoot })
  const files = job.files.map(file => ({ ...file, text: readFileSync(file.absolutePath, 'utf8') }))
  const result = await executeProjectedUpstreamFiles(files, async (source, family) => {
    const observed = await adapter.acquireRaw(source, family)
    if (observed.status !== 'accepted') return observed
    if (observed.family !== family) return { status: 'unavailable', error: `Original private ${family} parser entry cannot be projected onto public auto-detection of ${observed.family}; no invented rejection credit` }
    try { return { status: 'accepted', view: projectPublicDatabase(job.tool, family, observed.raw) } }
    catch (error) { return { status: 'unavailable', error: 'Actual public-model projection failed: ' + String(error.message ?? error) } }
  })
  const require = createRequire(resolve(job.tool === 'mermaid' ? job.referenceRoot : job.packageRoot, 'package.json'))
  const manifest = JSON.parse(readFileSync(job.tool === 'mermaid' ? require.resolve('mermaid/package.json') : resolve(job.packageRoot, 'package.json'), 'utf8'))
  writeFileSync(job.output, JSON.stringify({ invocationId: job.invocationId, tool: job.tool, version: adapter.version, artifact: { name: manifest.name, version: manifest.version, entry: adapter.entry }, ...result }))
} catch (error) {
  writeFileSync(job.output, JSON.stringify({ invocationId: job.invocationId, tool: job.tool, blocked: String(error.stack ?? error) }))
  process.exitCode = 2
}
