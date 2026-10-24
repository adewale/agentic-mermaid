import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { BUILTIN_FAMILY_METADATA } from '../../../src/agent/families.ts'
import { type AnyMutationOp, type ParsedDiagram, WARNING_SEVERITY } from '../../../src/agent/types.ts'
import { qualifyOutput } from './qualification.ts'
import type { BenchmarkObservation, UnifiedRunOptions, UnifiedSuiteResult, UnifiedWorkload } from './types.ts'
import { familyFeatureWorkloads, getWorkloadEvidence } from './workloads.ts'

type AgentApi = typeof import('../../../src/agent/core.ts')
const DRIVER_ROOT = resolve(import.meta.dir, '../../..')
const errorText = (error: unknown): string => (error instanceof Error ? error.message : String(error))

/** Mutation stimuli are keyed by operation, not a second family roster. A
 * schema-admitted operation must actually change the returned diagram and
 * preserve the prior facts. This is one witness per family, not all-op proof. */
const mutationStimuli: readonly Record<string, unknown>[] = [
  { kind: 'set_accessibility_title', title: 'UnifiedBenchmarkWitness' },
  { kind: 'set_title', title: 'UnifiedBenchmarkWitness' },
  { kind: 'add_node', id: 'UnifiedBenchmarkWitness', label: 'UnifiedBenchmarkWitness', value: 7 },
  { kind: 'add_state', id: 'UnifiedBenchmarkWitness', label: 'UnifiedBenchmarkWitness' },
  { kind: 'add_participant', id: 'UnifiedBenchmarkWitness', label: 'UnifiedBenchmarkWitness' },
  { kind: 'add_entity', id: 'UnifiedBenchmarkWitness' },
  { kind: 'add_class', id: 'UnifiedBenchmarkWitness' },
  { kind: 'add_link', source: 'UnifiedBenchmarkWitness', target: 'UnifiedBenchmarkSink', value: 1 },
  { kind: 'add_field', label: 'UnifiedBenchmarkWitness', bits: 8 },
  { kind: 'add_column', id: 'UnifiedBenchmarkWitness', label: 'UnifiedBenchmarkWitness' },
  { kind: 'add_requirement', requirement: { name: 'UnifiedBenchmarkWitness', text: 'UnifiedBenchmarkWitness' } },
  { kind: 'add_block', block: { id: 'UnifiedBenchmarkWitness', label: 'UnifiedBenchmarkWitness' } },
  { kind: 'add_cause', label: 'UnifiedBenchmarkWitness' },
  { kind: 'add_element', element: { id: 'UnifiedBenchmarkWitness', label: 'UnifiedBenchmarkWitness', kind: 'system' } },
]

export function mutationWitnessForFamily(api: Pick<AgentApi, 'hasOpSchema' | 'describeOps' | 'validateOp'>, family: string): AnyMutationOp | undefined {
  if (!api.hasOpSchema(family)) return undefined
  const menu = api.describeOps(family)
  for (const stimulus of mutationStimuli) {
    const fields = menu[String(stimulus.kind)]
    if (!fields) continue
    const names = new Set(['kind', ...fields.map(field => field.name)])
    const op = Object.fromEntries(Object.entries(stimulus).filter(([name]) => names.has(name)))
    if (api.validateOp(family, op) === null) return op as AnyMutationOp
  }
  return undefined
}

/** A blank-build witness chosen from actual advertised operation signatures.
 * Operands are authored constants; schema projection only removes fields that
 * do not belong to that family's operation. The caller must check build.ok,
 * verifier outcome and the requested witness in the resulting artifact. */
export function structuralBuildWitnessForFamily(api: Pick<AgentApi, 'hasOpSchema' | 'describeOps' | 'validateOp'>, family: string): AnyMutationOp[] | undefined {
  if (!api.hasOpSchema(family)) return undefined
  const menu = api.describeOps(family)
  const admit = (stimulus: Record<string, unknown>): AnyMutationOp | undefined => {
    const fields = menu[String(stimulus.kind)]
    if (!fields) return undefined
    const names = new Set(['kind', ...fields.map(field => field.name)])
    const operation = Object.fromEntries(Object.entries(stimulus).filter(([field]) => names.has(field)))
    return api.validateOp(family, operation) === null ? (operation as AnyMutationOp) : undefined
  }
  let stimuli: Record<string, unknown>[]
  if (menu.set_effect && menu.add_cause)
    stimuli = [
      { kind: 'set_effect', label: 'UnifiedBenchmarkWitness' },
      { kind: 'add_cause', label: 'Unified cause' },
    ]
  else if (menu.add_axis && menu.add_curve) stimuli = [...['One', 'Two', 'Three'].map(name => ({ kind: 'add_axis', id: `Unified${name}`, label: `Unified ${name}` })), { kind: 'add_curve', id: 'UnifiedBenchmarkWitness', label: 'UnifiedBenchmarkWitness', values: [3, 5, 7] }]
  else if (menu.add_section && menu.add_period)
    stimuli = [
      { kind: 'add_section', label: 'Unified section' },
      { kind: 'add_period', sectionIndex: 0, label: 'UnifiedBenchmarkWitness', events: ['Unified event'] },
    ]
  else if (menu.add_section && menu.add_task)
    stimuli = [
      { kind: 'add_section', label: 'Unified section' },
      { kind: 'add_task', sectionIndex: 0, label: 'UnifiedBenchmarkWitness', text: 'UnifiedBenchmarkWitness', score: 4, actors: ['Unified actor'], taskId: 'UnifiedTask', start: '2026-01-01', end: '3d' },
    ]
  else if (menu.add_series) stimuli = [{ kind: 'add_series', kind2: 'bar', name: 'UnifiedBenchmarkWitness', values: [3, 7] }]
  else if (menu.append_commit) stimuli = [{ kind: 'append_commit', id: 'UnifiedBenchmarkWitness', message: 'UnifiedBenchmarkWitness' }]
  else if (menu.add_node?.some(field => field.name === 'parent' && field.required)) stimuli = [{ kind: 'add_node', id: 'UnifiedBenchmarkWitness', label: 'UnifiedBenchmarkWitness', parent: 'root' }]
  else {
    const candidates = [
      ...mutationStimuli.filter(stimulus => !String(stimulus.kind).startsWith('set_')),
      { kind: 'add_service', id: 'UnifiedBenchmarkWitness', label: 'UnifiedBenchmarkWitness', icon: 'server' },
      { kind: 'add_slice', label: 'UnifiedBenchmarkWitness', value: 7 },
      { kind: 'add_point', label: 'UnifiedBenchmarkWitness', x: 0.4, y: 0.6 },
    ]
    const selected = candidates.find(stimulus => admit(stimulus))
    if (!selected) return undefined
    stimuli = [selected]
  }
  const operations = stimuli.map(admit)
  return operations.every((operation): operation is AnyMutationOp => operation !== undefined) ? operations : undefined
}

function sameFacts(api: AgentApi, before: ParsedDiagram, after: ParsedDiagram): string[] {
  const left = api.describeMermaidFacts(before),
    right = api.describeMermaidFacts(after)
  const findings: string[] = []
  for (const fact of left) if (!right.includes(fact)) findings.push(`Round trip dropped semantic fact: ${fact}`)
  for (const fact of right) if (!left.includes(fact)) findings.push(`Round trip introduced semantic fact: ${fact}`)
  return findings
}

function independentAssertions(workload: UnifiedWorkload, diagram: ParsedDiagram, layout?: ReturnType<AgentApi['layoutMermaid']>): string[] {
  const assertions = getWorkloadEvidence(workload.id)?.assertions
  if (!assertions) return []
  const findings: string[] = []
  const structured = !['opaque', 'preserved', 'extension'].includes(diagram.body.kind)
  if (assertions.expectStructured === true && !structured) findings.push(`Expected native structured body, got ${diagram.body.kind}`)
  if (assertions.expectStructured === false && structured) findings.push(`Expected preserved or opaque body, got ${diagram.body.kind}`)
  const counts = layout ? { nodes: layout.nodes.length, edges: layout.edges.length, groups: layout.groups.length } : undefined
  for (const [field, count] of [
    ['nodeCount', counts?.nodes],
    ['edgeCount', counts?.edges],
    ['groupCount', counts?.groups],
  ] as const) {
    const expected = layout ? assertions[field] : undefined
    if (expected !== undefined && expected !== count) findings.push(`Independent ${field}: expected ${expected}, observed ${count ?? 'unavailable'}`)
  }
  for (const [field, count] of [
    ['minNodes', counts?.nodes],
    ['minEdges', counts?.edges],
    ['minGroups', counts?.groups],
  ] as const) {
    const expected = layout ? assertions[field] : undefined
    if (expected !== undefined && (count === undefined || count < expected)) findings.push(`Independent ${field}: expected >=${expected}, observed ${count ?? 'unavailable'}`)
  }
  return findings
}

/** Executes the candidate's public agent package. The driver owns fixture
 * selection and independent projections only; driver API calls never stand
 * in for a target package that cannot be imported. */
export async function runFamilySuite(options: UnifiedRunOptions): Promise<UnifiedSuiteResult> {
  const startedAt = new Date().toISOString(),
    observations: BenchmarkObservation[] = [],
    gaps: string[] = []
  const out = resolve(options.out)
  mkdirSync(out, { recursive: true })
  const targetRoot = resolve(options.packageRoot ?? options.root)
  const candidates = ['dist/agent-core.js', 'dist/agent.js'].map(entry => resolve(targetRoot, entry))
  if (!options.packageRoot && targetRoot === DRIVER_ROOT) candidates.push(resolve(DRIVER_ROOT, 'src/agent/core.ts'))
  const entry = candidates.find(existsSync)
  let api: AgentApi
  try {
    if (!entry) throw new Error(`Target has no installed agent-core/agent entry in ${targetRoot}`)
    api = (await import(pathToFileURL(entry).href)) as AgentApi
    for (const name of ['parseRegisteredMermaid', 'verifyMermaid', 'serializeMermaid', 'describeMermaidFacts', 'renderMermaidSVG', 'renderMermaidASCII', 'layoutMermaid', 'mutate'] as const) {
      if (typeof api[name] !== 'function') throw new Error(`Target ${entry} lacks public API ${name}`)
    }
  } catch (error) {
    return { id: 'families', status: 'blocked', startedAt, finishedAt: new Date().toISOString(), observations, gaps: [`Target family suite unavailable: ${errorText(error)}`] }
  }
  const workloads = familyFeatureWorkloads(options.profile)
  const mutationCoverage = new Map<string, Set<string>>()
  const featureEvidence: Array<Record<string, unknown>> = []
  const observedFamilies = new Set<string>()
  const record = (workload: UnifiedWorkload, operation: string, format: string, work: () => { findings?: string[]; bytes?: number; metrics?: BenchmarkObservation['metrics']; detail?: string; status?: BenchmarkObservation['status'] }): void => {
    const begin = performance.now()
    try {
      const result = work()
      observations.push({
        suite: 'families',
        surface: 'agent-package',
        runtime: `node-compatible:${process.versions.bun ? `bun-${process.versions.bun}` : `node-${process.versions.node}`}`,
        family: workload.family,
        caseId: workload.id,
        operation,
        format,
        mode: 'functionality-probe',
        status: result.status ?? (result.findings?.length ? 'failed' : 'passed'),
        samplesMs: [performance.now() - begin],
        ...result,
        metrics: { modulePath: entry!, ...result.metrics },
      })
    } catch (error) {
      observations.push({
        suite: 'families',
        surface: 'agent-package',
        runtime: process.versions.bun ? `bun-${process.versions.bun}` : `node-${process.versions.node}`,
        family: workload.family,
        caseId: workload.id,
        operation,
        format,
        mode: 'functionality-probe',
        status: 'failed',
        samplesMs: [performance.now() - begin],
        findings: [errorText(error)],
        metrics: { modulePath: entry! },
      })
    }
  }
  for (const workload of workloads) {
    observedFamilies.add(workload.family)
    const evidence = getWorkloadEvidence(workload.id)
    const parsed = api.parseRegisteredMermaid(workload.source)
    if (evidence?.diagnosticOnly) {
      observations.push({
        suite: 'families',
        surface: 'agent-package',
        runtime: process.versions.bun ? `bun-${process.versions.bun}` : `node-${process.versions.node}`,
        family: workload.family,
        caseId: workload.id,
        operation: 'negative-source-diagnostic',
        format: 'source',
        mode: 'functionality-probe',
        status: 'not-applicable',
        detail: `Reference-rejected or owner-declared diagnostic retained: local parser ${parsed.ok ? `accepted ${parsed.value.body.kind}` : 'rejected'}. Reference rejection alone is not an obligation to reject permissive input.`,
        metrics: { modulePath: entry! },
      })
      continue
    }
    record(workload, 'parse-and-independent-structure', 'ir', () => {
      if (!parsed.ok) throw new Error(JSON.stringify(parsed.error))
      const findings = parsed.value.kind === workload.family ? independentAssertions(workload, parsed.value) : [`Expected family ${workload.family}, got ${parsed.value.kind}`]
      return { findings, metrics: { representation: parsed.value.body.kind, declaredAssertionFields: Object.keys(evidence?.assertions ?? {}).length } }
    })
    if (!parsed.ok) continue
    const diagram = parsed.value
    record(workload, 'verify', 'diagnostics', () => {
      const result = api.verifyMermaid(diagram)
      return {
        metrics: { verificationOk: result.ok, warningCount: result.warnings.length },
        findings: result.ok
          ? []
          : result.warnings
              .filter(warning => WARNING_SEVERITY[warning.code] === 'error')
              .map(warning => JSON.stringify(warning))
              .concat(result.warnings.some(warning => WARNING_SEVERITY[warning.code] === 'error') ? [] : ['Verifier returned ok:false without a recognized error diagnostic']),
        detail: 'Warnings and permissive-source diagnostics are retained; a returned verifier result is distinct from verify.ok.',
      }
    })
    record(workload, 'serialize-reparse-semantic-preservation', 'source', () => {
      const source = api.serializeMermaid(diagram),
        again = api.parseRegisteredMermaid(source)
      if (!again.ok) throw new Error(`Serialized Mermaid failed to parse: ${JSON.stringify(again.error)}`)
      const findings = sameFacts(api, diagram, again.value)
      if (api.serializeMermaid(again.value) !== source) findings.push('Serialization is not stable after reparse')
      return { findings, bytes: Buffer.byteLength(source), detail: 'Metamorphic preservation of observed facts; independent source-acceptance/grammar gates run separately.' }
    })
    record(workload, 'layout-and-finite-geometry', 'layout', () => {
      const layout = api.layoutMermaid(diagram),
        findings = independentAssertions(workload, diagram, layout)
      if (layout.kind !== workload.family) findings.push(`Layout routed to ${layout.kind}`)
      for (const node of layout.nodes)
        for (const field of ['x', 'y', 'w', 'h'] as const) {
          if (!Number.isFinite(node[field])) findings.push(`Node ${node.id} has non-finite ${field}`)
          if ((field === 'w' || field === 'h') && node[field] < 0) findings.push(`Node ${node.id} has negative ${field}`)
        }
      return { findings, metrics: { nodes: layout.nodes.length, edges: layout.edges.length, groups: layout.groups.length }, bytes: Buffer.byteLength(JSON.stringify(layout)), detail: 'Finite pixel geometry and routed family; own route/ink/containment and Scene-contract suites are separate authorities.' }
    })
    for (const format of ['svg', 'unicode'] as const)
      record(workload, `render-${format}`, format, () => {
        const result = format === 'svg' ? api.renderMermaidSVG(diagram, { embedFontImport: false }) : api.renderMermaidASCII(diagram, { colorMode: 'none', useAscii: false })
        const qualification = qualifyOutput(workload, result, format)
        return { findings: qualification.findings, bytes: Buffer.byteLength(result), metrics: { qualificationScope: qualification.scope, explicitLabelExpectations: workload.expectedLabels?.length ?? 0 } }
      })
    // Mutations use the small canonical witness, once per family. Rich corpora
    // then contribute parse/structure/round-trip/render feature evidence above.
    if (workload.id === `registry:${workload.family}`)
      record(workload, 'typed-build-and-verify', 'source', () => {
        const operations = structuralBuildWitnessForFamily(api, workload.family)
        if (!operations || typeof api.applyOps !== 'function') return { status: 'blocked', findings: [], detail: 'Target lacks an admitted positive blank-build witness or public applyOps.' }
        const built = api.applyOps({ family: workload.family, ops: operations })
        if (!built.ok) throw new Error(`Typed blank build failed: ${JSON.stringify(built.error)}`)
        const again = api.parseRegisteredMermaid(built.source)
        if (!again.ok) throw new Error('Typed blank build source failed to reparse')
        const findings: string[] = []
        if (!built.verify.ok) findings.push(`Typed blank build did not verify: ${JSON.stringify(built.verify.warnings)}`)
        if (!api.describeMermaidFacts(again.value).some(fact => fact.includes('UnifiedBenchmarkWitness'))) findings.push('Typed blank build lost the independently requested witness')
        mutationCoverage.set(workload.family, new Set([...(mutationCoverage.get(workload.family) ?? []), ...operations.map(operation => operation.kind)]))
        return { findings, bytes: Buffer.byteLength(built.source), metrics: { mutationCount: operations.length }, detail: 'Actual nonempty create/build → verify → serialize → reparse through the target public declarative API.' }
      })
    if (workload.id === `registry:${workload.family}`)
      record(workload, 'typed-mutation-and-reparse', 'source', () => {
        const operation = mutationWitnessForFamily(api, workload.family)
        if (!operation) return { status: 'blocked', findings: [], detail: 'No generic non-destructive schema-admitted mutation witness; owner mutation suites remain required.' }
        const changed = api.mutate(diagram, operation)
        if (!changed.ok) throw new Error(`Schema-admitted ${operation.kind} mutation failed: ${JSON.stringify(changed.error)}`)
        const source = api.serializeMermaid(changed.value),
          reparsed = api.parseRegisteredMermaid(source)
        if (!reparsed.ok) throw new Error('Mutated source failed to reparse')
        const facts = api.describeMermaidFacts(reparsed.value),
          priorFacts = api.describeMermaidFacts(diagram)
        const findings: string[] = []
        if (!facts.some(fact => fact.includes('UnifiedBenchmarkWitness'))) findings.push('Mutation result lost its independently requested witness value')
        for (const fact of priorFacts) {
          if ((operation.kind === 'set_title' && fact.startsWith('title ')) || (operation.kind === 'set_accessibility_title' && fact.startsWith('accessibility title '))) continue
          if (!facts.includes(fact)) findings.push(`Non-destructive mutation dropped prior fact: ${fact}`)
        }
        mutationCoverage.set(workload.family, new Set([...(mutationCoverage.get(workload.family) ?? []), operation.kind]))
        return { findings, bytes: Buffer.byteLength(source), metrics: { mutation: operation.kind }, detail: 'Actual target mutation, independently requested value and preserved prior facts; not a proof of every advertised mutation operation.' }
      })
    featureEvidence.push({
      caseId: workload.id,
      family: workload.family,
      features: workload.features,
      provenance: evidence?.origins ?? [workload.provenance],
      independentStructuralFields: Object.keys(evidence?.assertions ?? {}),
      explicitLabelExpectations: workload.expectedLabels?.length ?? 0,
      dedicatedSnapshotAvailable: !!evidence?.expected || !!evidence?.reference,
      dedicatedSnapshotComparedHere: false,
    })
  }
  const familyCoverage = BUILTIN_FAMILY_METADATA.map(family => {
    const advertisedOperations = api.hasOpSchema(family.id) ? Object.keys(api.opMenu(family.id)) : []
    const observedOperations = [...(mutationCoverage.get(family.id) ?? [])]
    const unexercisedOperations = advertisedOperations.filter(operation => !observedOperations.includes(operation))
    const rows = observations.filter(observation => observation.family === family.id)
    return {
      family: family.id,
      inputs: workloads.filter(workload => workload.family === family.id).length,
      enrolled: observedFamilies.has(family.id),
      passed: rows.filter(row => row.status === 'passed').length,
      failed: rows.filter(row => row.status === 'failed').length,
      advertisedOperations,
      observedOperations,
      unexercisedOperations,
      capabilityEvidence: api.getFamily(family.id)?.capabilityEvidence ?? [],
    }
  })
  if (familyCoverage.some(family => family.unexercisedOperations.length))
    gaps.push('The generic lifecycle suite runs one independently requested non-destructive mutation per family; other mutation kinds require their existing owning suites. No all-operation completeness claim is inferred from one witness or from descriptor declarations.')
  const formatOnly = observations.filter(row => row.operation.startsWith('render-') && row.metrics?.qualificationScope === 'format-only').length
  if (formatOnly) gaps.push(`${formatOnly} output probes have format/round-trip invariants but no independently declared label expectations. Community comparison should acquire pinned-reference label expectations before timing.`)
  gaps.push(
    'Dedicated stored snapshots retain their owning-case identity but are compared by their existing independent owner suites, not by this generic lifecycle probe. Feature tags identify enrolled authored stimuli and assertion fields, not an exhaustive language-feature universe. Independent pinned grammar/native-operation tests, negative cases, Scene/route/ownership tests and reviewed visual evidence remain separate results.',
  )
  const artifact = resolve(out, 'family-feature-coverage.json')
  writeFileSync(
    artifact,
    JSON.stringify(
      {
        modulePath: entry,
        profile: options.profile,
        method: 'Fresh public target-package lifecycle calls. Independent stored counts/labels are distinguished from metamorphic source-preservation checks. Builtin descriptor conformance declarations are not counted as freshly executed tests.',
        familyCoverage,
        featureEvidence,
      },
      null,
      2,
    ) + '\n',
  )
  return { id: 'families', status: observations.some(row => row.status === 'failed') ? 'failed' : observations.some(row => row.status === 'blocked') ? 'blocked' : 'passed', startedAt, finishedAt: new Date().toISOString(), observations, gaps, artifacts: [artifact] }
}
