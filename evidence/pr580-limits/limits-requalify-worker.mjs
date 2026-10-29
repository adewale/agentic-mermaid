import { readFileSync, writeFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { createHash } from 'node:crypto'
import { qualifyPortable, PORTABLE_QUALIFICATION_OBSERVER } from './trident-limits/portable/fidelity.ts'
import { layoutBackendCheck } from './trident-strict/portable/layout-backend.ts'
import { assertBenchmarkExecutionAllowed } from './trident-limits/portable/ci-policy.ts'

assertBenchmarkExecutionAllowed()
const job = JSON.parse(readFileSync(process.argv[2], 'utf8'))
const api = await import(pathToFileURL(job.entry).href)
const testCase = job.testCase
let result
try {
  const returned = await api.renderMermaidSVGWithReceipt(testCase.source, structuredClone(testCase.renderOptions))
  // Consume the complete enumerable receipt. This is an untimed correctness run;
  // historical receipt-consuming and current SVG-only clocks stay untouched.
  const { svg, ...sidecars } = returned
  const consumed = JSON.stringify(sidecars)
  const model = await api.parseRegisteredMermaid(testCase.source)
  const qualification = qualifyPortable(testCase, { svg, model, adapter: 'agentic' })
  qualification.checks.push(layoutBackendCheck(returned.receipt, testCase.layoutBackend))
  if (qualification.checks.some(check => check.status === 'failed')) qualification.passed = false
  const certificate = returned.receipt.layoutCertification
  result = {
    caseId: testCase.id,
    observer: PORTABLE_QUALIFICATION_OBSERVER,
    runtime: { node: process.versions.node, executable: process.execPath },
    svgBytes: Buffer.byteLength(svg),
    svgSha256: createHash('sha256').update(svg).digest('hex'),
    enumerableSidecarBytes: Buffer.byteLength(consumed),
    qualification,
    certification: certificate,
    passed: qualification.passed && certificate?.status === 'passed',
  }
  writeFileSync(job.prefix + '.svg', svg)
  writeFileSync(job.prefix + '-receipt.json', consumed + '\n')
} catch (error) {
  result = { caseId: testCase.id, observer: PORTABLE_QUALIFICATION_OBSERVER, passed: false, error: String(error?.stack ?? error) }
}
writeFileSync(job.prefix + '-result.json', JSON.stringify(result, null, 2) + '\n')
if (!result.passed) process.exitCode = 1
