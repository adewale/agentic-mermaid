/**
 * Canonical issue-88/degenerate-route enumerator.
 *
 * Every generated source is parsed and laid out exactly once. Structural,
 * contract, and certificate observations all consume that same positioned
 * graph. The command preserves the union of the two superseded gates without
 * performing either layout twice.
 *
 *   bun run eval/degenerate-etn/enumerate.ts
 *   bun run eval/degenerate-etn/enumerate.ts --limit 20
 */
import { performance } from 'node:perf_hooks'
import { assessLayout, hardViolations } from '../../src/layout-rubric.ts'
import { layoutGraphSync } from '../../src/layout-engine.ts'
import { parseMermaid } from '../../src/parser.ts'
import { auditRouteContracts, findRouteHitches } from '../../src/route-contracts.ts'
import type { Point, PositionedEdge } from '../../src/types.ts'
import { DEGENERATE_ROUTE_GENERATORS } from './generators.ts'

const limitIndex = process.argv.indexOf('--limit')
const requestedLimit = limitIndex >= 0 ? Number(process.argv[limitIndex + 1]) : Infinity
if (!(requestedLimit > 0) || (requestedLimit !== Infinity && !Number.isInteger(requestedLimit))) {
  throw new Error('--limit must be a positive integer')
}
const fullRun = requestedLimit === Infinity
const EXPECTED_CASES = 2_800
const definedCases = DEGENERATE_ROUTE_GENERATORS.reduce((sum, generator) => sum + generator.cases, 0)
if (fullRun && definedCases !== EXPECTED_CASES) {
  throw new Error(`corpus definition drift: expected ${EXPECTED_CASES} cases, generators define ${definedCases}`)
}

interface Counterexample {
  generator: string
  seed: number
  source: string
  hitches?: ReturnType<typeof findRouteHitches>
  hardViolations?: ReturnType<typeof hardViolations>
  routeFindings?: ReturnType<typeof auditRouteContracts>
  certificateFindings?: string[]
  error?: string
}

function increment(counts: Record<string, number>, key: string): void {
  counts[key] = (counts[key] ?? 0) + 1
}

function geometricBendCount(points: readonly Point[]): number {
  if (points.length < 3) return 0
  let bends = 0
  for (let index = 1; index < points.length - 1; index++) {
    const before = points[index - 1]!
    const vertex = points[index]!
    const after = points[index + 1]!
    const ax = vertex.x - before.x
    const ay = vertex.y - before.y
    const bx = after.x - vertex.x
    const by = after.y - vertex.y
    if (Math.abs(ax * by - ay * bx) > 0.01) bends++
  }
  return bends
}

function certificateFindings(edge: PositionedEdge): string[] {
  const certificate = edge.routeCertificate
  if (!certificate) return ['missing-certificate']
  const findings: string[] = []
  if (edge.edgeIndex !== certificate.edgeIndex) findings.push('edge-index-mismatch')
  if (certificate.bendCount !== geometricBendCount(edge.points)) findings.push('bend-count-mismatch')
  if (certificate.sourcePortAssignment?.port !== certificate.sourcePort &&
    (certificate.sourcePortAssignment?.port !== undefined || certificate.sourcePort !== undefined)) {
    findings.push('source-assignment-port-mismatch')
  }
  if (certificate.targetPortAssignment?.port !== certificate.targetPort &&
    (certificate.targetPortAssignment?.port !== undefined || certificate.targetPort !== undefined)) {
    findings.push('target-assignment-port-mismatch')
  }
  return findings
}

const metrics = {
  cases: 0,
  layouts: 0,
  nodes: 0,
  edges: 0,
  hitchCases: 0,
  hitches: 0,
  hardViolationCases: 0,
  hardViolations: 0,
  hardViolationsByMetric: {} as Record<string, number>,
  routeFindingCases: 0,
  routeFindings: 0,
  routeFindingsByCode: {} as Record<string, number>,
  certificates: { assessed: 0, findingEdges: 0, findings: 0, findingsByCode: {} as Record<string, number> },
  errors: 0,
  timingsMs: { layout: 0, structuralAndContractAudit: 0, total: 0 },
}
const counterexamples: Counterexample[] = []
const routeFindingExamples: Counterexample[] = []
const started = performance.now()

outer: for (const generator of DEGENERATE_ROUTE_GENERATORS) {
  for (let seed = 0; seed < generator.cases; seed++) {
    if (metrics.cases >= requestedLimit) break outer
    metrics.cases++
    const source = generator.generate(seed)
    try {
      const graph = parseMermaid(source)
      const layoutStarted = performance.now()
      const positioned = layoutGraphSync(graph)
      metrics.timingsMs.layout += performance.now() - layoutStarted
      metrics.layouts++
      metrics.nodes += positioned.nodes.length
      metrics.edges += positioned.edges.length

      const auditStarted = performance.now()
      const hitches = findRouteHitches(positioned, graph)
      const hard = hardViolations(assessLayout(graph, positioned))
      const routeFindings = auditRouteContracts(positioned, graph)
      const certificateIssues = positioned.edges.flatMap((edge, edgeIndex) =>
        certificateFindings(edge).map(code => `${edge.edgeIndex ?? edgeIndex}:${edge.source}->${edge.target}:${code}`))
      metrics.timingsMs.structuralAndContractAudit += performance.now() - auditStarted

      if (hitches.length > 0) {
        metrics.hitchCases++
        metrics.hitches += hitches.length
      }
      if (hard.length > 0) {
        metrics.hardViolationCases++
        metrics.hardViolations += hard.length
        for (const finding of hard) increment(metrics.hardViolationsByMetric, finding.metric)
      }
      if (routeFindings.length > 0) {
        metrics.routeFindingCases++
        metrics.routeFindings += routeFindings.length
        for (const finding of routeFindings) increment(metrics.routeFindingsByCode, finding.code)
        if (routeFindingExamples.length < 10) {
          routeFindingExamples.push({ generator: generator.name, seed, source, routeFindings })
        }
      }
      metrics.certificates.assessed += positioned.edges.length
      if (certificateIssues.length > 0) metrics.certificates.findingEdges += new Set(certificateIssues.map(finding => finding.split(':', 1)[0])).size
      metrics.certificates.findings += certificateIssues.length
      for (const finding of certificateIssues) increment(metrics.certificates.findingsByCode, finding.slice(finding.lastIndexOf(':') + 1))

      if (hitches.length || hard.length || certificateIssues.length) {
        counterexamples.push({
          generator: generator.name,
          seed,
          source,
          ...(hitches.length ? { hitches } : {}),
          ...(hard.length ? { hardViolations: hard } : {}),
          ...(routeFindings.length ? { routeFindings } : {}),
          ...(certificateIssues.length ? { certificateFindings: certificateIssues } : {}),
        })
      }
    } catch (error) {
      metrics.errors++
      counterexamples.push({
        generator: generator.name,
        seed,
        source,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }
}

metrics.timingsMs.total = performance.now() - started
if (fullRun && (metrics.cases !== EXPECTED_CASES || metrics.layouts !== EXPECTED_CASES)) {
  throw new Error(`corpus traversal drift: expected ${EXPECTED_CASES} cases/layouts, saw ${metrics.cases}/${metrics.layouts}`)
}

const receipt = {
  schemaVersion: 1,
  corpus: DEGENERATE_ROUTE_GENERATORS.map(({ name, cases }) => ({ name, cases })),
  expectedCases: EXPECTED_CASES,
  fullRun,
  metrics,
  counterexamples,
  routeFindingExamples,
}
console.log(JSON.stringify(receipt, null, 2))

// Preserve the union of the two superseded gates: all ROUTE_HITCH findings
// and the edgeThroughNode hard metric. Other hard/audit codes are reported so
// their existing pathological corpus baseline is visible, not silently made
// into new issue-88 policy. Internal certificate consistency remains a gate
// over existing metadata.
const failed = metrics.hitches > 0 || (metrics.hardViolationsByMetric.edgeThroughNode ?? 0) > 0 ||
  metrics.certificates.findings > 0 || metrics.errors > 0
if (failed) process.exitCode = 1
