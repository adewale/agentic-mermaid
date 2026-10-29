import { pathToFileURL } from 'node:url'
import { resolve } from 'node:path'
import { writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
const [entry = 'work/agentic-scaling/dist/index.js', output = 'work/verification/limits-sparse-node24.json'] = process.argv.slice(2)
const api = await import(pathToFileURL(resolve(entry)).href)
const rows = []
for (const count of [4096, 5000]) for (const relationships of [1, 4]) for (const backend of ['elk', 'agentic']) for (const direction of ['TB', 'BT', 'LR', 'RL']) {
  const source = `erDiagram\ndirection ${direction}\n` + Array.from({ length: relationships }, (_, i) => `N${i * 2} ||--|| N${i * 2 + 1} : owns`).join('\n') + '\n' + Array.from({ length: count }, (_, i) => `N${i}`).join('\n')
  const expectedOutcome = backend === 'agentic' && count > 4096 ? 'declared-graph-size-rejection' : 'rendered-and-certified'
  let row = { count, relationships, backend, direction, expectedOutcome }
  try {
    const returned = api.renderMermaidSVGWithReceipt(source, { graphLayout: { backend, fallback: 'none' } })
    const receipt = JSON.parse(JSON.stringify(returned.receipt))
    const ids = [...returned.svg.matchAll(/<g class="entity" data-id="([^"]+)"/g)].map(match => match[1])
    const relationEndpoints = [...returned.svg.matchAll(/class="er-relationship"[^>]*data-from="([^"]+)"[^>]*data-to="([^"]+)"/g)].map(match => [match[1], match[2]])
    const actualRelations = relationEndpoints.length
    const identitiesMatch = JSON.stringify(ids.toSorted()) === JSON.stringify(Array.from({length:count}, (_,i) => `N${i}`).toSorted())
    const endpointsMatch = JSON.stringify(relationEndpoints) === JSON.stringify(Array.from({length:relationships}, (_,i) => [`N${i*2}`, `N${i*2+1}`]))
    const certification = receipt.layoutCertification
    const passed = identitiesMatch && endpointsMatch && certification?.status === 'passed' && ids.length === count && new Set(ids).size === count && actualRelations === relationships && receipt.layoutDecisions.every(d => d.requested === backend && d.selected === backend && d.fallback === 'none' && d.attempts.length === 1)
    row = { ...row, verifiedExpectation: passed && expectedOutcome === 'rendered-and-certified', rendered: true, svgBytes: Buffer.byteLength(returned.svg), svgSha256: createHash('sha256').update(returned.svg).digest('hex'), identitiesMatch, endpointsMatch, receipt, entities: ids.length, uniqueEntities: new Set(ids).size, actualRelations, certification: certification?.status, checks: certification?.checks, issues: certification?.issues, decisions: receipt.layoutDecisions }
  } catch (error) { row = { ...row, rendered: false, verifiedExpectation: expectedOutcome === 'declared-graph-size-rejection' && error.name === 'GraphLayoutUnsupportedError' && error.message === 'Agentic graph layout does not support this input: agentic local graph-size limit', error: String(error) } }
  rows.push(row)
  console.log(count, relationships, backend, direction, row.verifiedExpectation ? 'passed' : 'failed', row.checks?.operations)
}
writeFileSync(output, JSON.stringify({ mode: 'Untimed public SVG and fully consumed receipt correctness replay', runtime: { node: process.versions.node, executable: process.execPath }, rows }, null, 2) + '\n')
if (rows.some(row => !row.verifiedExpectation)) process.exitCode = 1
