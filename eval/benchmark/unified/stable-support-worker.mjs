import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { assertBenchmarkExecutionAllowed } from '../ci-policy.ts'
import { qualifyOutput } from './qualification.ts'

assertBenchmarkExecutionAllowed()
const job = JSON.parse(readFileSync(process.argv[2], 'utf8'))
const observations = []
let api, loadError
try { api = await import(pathToFileURL(job.artifact.entry).href) } catch (error) { loadError = String(error) }
for (const testCase of job.cases) {
  const row = { suite: 'stable-support', surface: 'public-svg', runtime: `node:${process.versions.node}`, family: testCase.family, caseId: testCase.id, operation: 'render', format: 'svg', mode: 'functional-admission', status: 'blocked', metrics: { implementation: job.artifact.project, expectedAccepted: true, runtimeExecuted: false, nativeSemantic: false, paintedSemantic: false, qualificationScope: 'format-and-authored-labels' }, findings: [], detail: testCase.provenance }
  try {
    if (loadError) throw Error(loadError)
    const render = job.artifact.adapter === 'agentic' ? api.renderMermaidSVG : job.artifact.adapter === 'pele' ? api.render : undefined
    if (typeof render !== 'function') throw Error('Declared public SVG API is unavailable')
    row.metrics.runtimeExecuted = true
    const value = await render(testCase.source)
    const svg = typeof value === 'string' ? value : value?.svg
    if (typeof svg !== 'string') throw Error('Public renderer did not return SVG text')
    row.bytes = Buffer.byteLength(svg, 'utf8')
    const qualified = qualifyOutput(testCase, svg, 'svg')
    row.status = qualified.ok ? 'passed' : 'failed'
    row.findings = qualified.findings
    writeFileSync(join(job.out, testCase.id.replaceAll(':', '_') + '.svg'), svg)
  } catch (error) {
    row.status = row.metrics.runtimeExecuted ? 'failed' : 'blocked'
    row.findings.push(String(error))
  }
  observations.push(row)
}
writeFileSync(job.resultFile, JSON.stringify(observations, null, 2) + '\n')
