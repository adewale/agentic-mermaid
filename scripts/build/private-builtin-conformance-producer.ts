/** A fresh process compiles the canonical browser producer before executing it.
 * This is build-time Bun execution, not a claim of browser execution. */
import { fileURLToPath } from 'node:url'
import { isDeepStrictEqual } from 'node:util'
import { runtimeRenderContractPlugin } from './runtime-render-contract.ts'

const scene = fileURLToPath(new URL('../../src/scene/', import.meta.url))
const source = `
import { DefaultBackend } from ${JSON.stringify(`${scene}backend.ts`)};
import { RoughBackend } from ${JSON.stringify(`${scene}rough-backend.ts`)};
import { HybridBackend } from ${JSON.stringify(`${scene}hybrid-backend.ts`)};
import { backendWithAdmittedConformanceFixture, runBackendConformance } from ${JSON.stringify(`${scene}backend-conformance.ts`)};
export const reports = [DefaultBackend, RoughBackend, HybridBackend].map(backend =>
  runBackendConformance(backend === DefaultBackend ? backendWithAdmittedConformanceFixture(backend) : backend, 'backend:' + backend.id));
export const capabilities = [DefaultBackend, RoughBackend, HybridBackend].map(backend => backend.capabilities);
`
const result = await Bun.build({
  entrypoints: ['private-builtin-conformance-producer'], target: 'browser', format: 'esm', minify: true,
  plugins: [{ name: 'conformance-producer-entry', setup(build) {
    build.onResolve({ filter: /^private-builtin-conformance-producer$/ }, () => ({ path: 'producer.ts', namespace: 'conformance-producer' }))
    build.onLoad({ filter: /.*/, namespace: 'conformance-producer' }, () => ({ contents: source, loader: 'ts', resolveDir: scene }))
  } }, runtimeRenderContractPlugin({ schemaDocumentation: false, conformanceObservations: false })],
})
if (!result.success || result.outputs.length !== 1) throw new AggregateError(result.logs, 'Built-in conformance producer compilation failed')
const code = await result.outputs[0]!.text()
const { reports, capabilities } = await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`)
if (!Array.isArray(reports) || reports.length !== 3 || reports.some(report => report.passed !== true)) {
  throw new Error(`Built-in conformance failed: ${JSON.stringify(reports)}`)
}
const payload = { reports, capabilities }
const serialized = JSON.stringify(payload)
if (!isDeepStrictEqual(JSON.parse(serialized), payload)) throw new Error('Built-in conformance proof is not losslessly serializable')
process.stdout.write(serialized)
