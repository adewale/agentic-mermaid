import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { BUILTIN_FAMILY_METADATA } from '../../../src/agent/families.ts'
import { type AnyMutationOp, type ParsedDiagram, WARNING_SEVERITY } from '../../../src/agent/types.ts'
import type { Block, BlockBody } from '../../../src/block/types.ts'
import { displayText } from '../../../src/multiline-utils.ts'
import { qualifyOutput } from './qualification.ts'
import type { BenchmarkObservation, UnifiedRunOptions, UnifiedSuiteResult, UnifiedWorkload } from './types.ts'
import { familyFeatureWorkloads, getWorkloadEvidence, type WorkloadEvidence } from './workloads.ts'
import { runOperationDiagnostics, runOperationWitnesses, typedBodyContains, type OperationWitnessResult } from './operation-witnesses.ts'

type AgentApi = typeof import('../../../src/agent/core.ts')
type ProbeResult = { findings?: string[]; bytes?: number; metrics?: BenchmarkObservation['metrics']; detail?: string; status?: BenchmarkObservation['status'] }
const DRIVER_ROOT = resolve(import.meta.dir, '../../..')
const errorText = (error: unknown): string => (error instanceof Error ? error.message : String(error))

/** Called only after strict XML/root validation reports a canvas-only failure. */
function explicitZeroCanvas(output: string): { width: number; height: number; viewBox: string } | undefined {
  type Parser = { on(event: 'opentag', callback: (tag: { attributes: Record<string, { value: string }> }) => void): void; write(source: string): Parser; close(): Parser }
  const { SaxesParser } = createRequire(import.meta.url)('saxes') as { SaxesParser: new (options: { xmlns: true }) => Parser }
  let attributes: Record<string, string> | undefined
  try {
    const parser = new SaxesParser({ xmlns: true })
    parser.on('opentag', tag => {
      attributes ??= Object.fromEntries(Object.entries(tag.attributes).map(([name, value]) => [name, value.value]))
    })
    parser.write(output).close()
  } catch {
    return undefined
  }
  if (!attributes) return undefined
  const length = (value: string): number => (/^\+?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?(?:px|pt|pc|cm|mm|in|q)?$/i.test(value.trim()) ? Number.parseFloat(value) : NaN)
  const width = attributes.width === undefined ? undefined : length(attributes.width),
    height = attributes.height === undefined ? undefined : length(attributes.height)
  if ([width, height].some(value => value !== undefined && (!Number.isFinite(value) || value < 0))) return undefined
  const viewBox = attributes.viewBox
    ?.trim()
    .split(/[\s,]+/)
    .map(Number)
  if (viewBox && (viewBox.length !== 4 || !viewBox.every(Number.isFinite) || viewBox[2]! < 0 || viewBox[3]! < 0)) return undefined
  if ((width === 0 && height === 0) || (viewBox?.[2] === 0 && viewBox[3] === 0)) return { width: 0, height: 0, viewBox: attributes.viewBox ?? '' }
  return undefined
}

export function qualifyFamilySvg(workload: UnifiedWorkload, output: string, evidence: WorkloadEvidence | undefined, observedLayout: { nodes: number; edges: number; groups: number } | undefined): ProbeResult {
  const qualification = qualifyOutput(workload, output, 'svg')
  const assertions = evidence?.assertions
  const independentlyEmpty = assertions?.nodeCount === 0 && assertions.edgeCount === 0 && assertions.groupCount === 0 && !(assertions.minNodes || assertions.minEdges || assertions.minGroups || assertions.renderError) && !assertions.labelsContain?.length && !workload.expectedLabels?.length
  const actuallyEmpty = observedLayout?.nodes === 0 && observedLayout.edges === 0 && observedLayout.groups === 0
  const canvasOnly = qualification.findings.length === 1 && qualification.findings[0] === 'SVG has no positive finite viewBox or explicit canvas'
  const zeroCanvas = canvasOnly && independentlyEmpty && actuallyEmpty ? explicitZeroCanvas(output) : undefined
  if (zeroCanvas)
    return {
      status: 'not-applicable',
      bytes: Buffer.byteLength(output),
      metrics: {
        qualificationScope: 'independently-empty-svg-positive-canvas-unmeasured',
        explicitLabelExpectations: 0,
        independentNodes: 0,
        independentEdges: 0,
        independentGroups: 0,
        observedLayoutNodes: 0,
        observedLayoutEdges: 0,
        observedLayoutGroups: 0,
        ownerProvenance: evidence!.origins.join('; '),
        emptyCanvasWidth: zeroCanvas.width,
        emptyCanvasHeight: zeroCanvas.height,
        emptyCanvasViewBox: zeroCanvas.viewBox,
      },
      detail:
        'Independent fixture assertions and actual owned layout both contain zero nodes, edges and groups, with no diagram-label expectations. XML/root namespace validation completed and an explicit finite zero canvas was independently read from root attributes; positive canvas fidelity is not applicable to this empty diagram. Parse, structure, verification, round-trip and layout observations remain separate. Universal SVG qualification is unchanged.',
    }
  return { findings: qualification.findings, bytes: Buffer.byteLength(output), metrics: { qualificationScope: qualification.scope, explicitLabelExpectations: workload.expectedLabels?.length ?? 0 } }
}

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

/** Anonymous gap cells have geometry/order, but no authored source identity.
 * Preserve their exact tree position and remap any endpoint to that same path. */
function blockRoundTripProjection(body: BlockBody): unknown {
  const spaces = new Map<string, string>()
  const index = (node: Block, path: string): void => {
    if (node.type === 'space') spaces.set(node.id, path)
    node.children?.forEach((child, position) => index(child, `${path}.${position}`))
  }
  index(body.root, 'root')
  const endpoint = (id: string | undefined) => (id === undefined ? null : spaces.has(id) ? { anonymousSpacePath: spaces.get(id) } : { authoredId: id })
  const project = (node: Block): unknown => ({
    identity: node.type === 'space' ? { anonymousSpacePath: spaces.get(node.id) } : { authoredId: node.id },
    type: node.type === 'na' ? 'square' : (node.type ?? 'square'),
    ...(node.type === 'space' ? {} : { label: node.label ?? '' }),
    span: node.widthInColumns ?? 1,
    cells: node.width ?? 1,
    columns: node.columns ?? -1,
    directions: node.directions ?? [],
    classes: node.classes ?? [],
    styles: node.styles ?? [],
    children: (node.children ?? []).map(project),
  })
  return {
    root: project(body.root),
    edges: body.edges.map(edge => ({ from: endpoint(edge.start), to: endpoint(edge.end), label: edge.label ?? '', startMarker: edge.arrowTypeStart, endMarker: edge.arrowTypeEnd, thickness: edge.thickness, pattern: edge.pattern })),
    classes: body.classDefs,
    title: body.title,
    accessibilityTitle: body.accessibilityTitle,
    accessibilityDescription: body.accessibilityDescription,
  }
}

function sameFacts(api: AgentApi, before: ParsedDiagram, after: ParsedDiagram): string[] {
  if (before.body.kind === 'block' && after.body.kind === 'block')
    return JSON.stringify(blockRoundTripProjection(before.body)) === JSON.stringify(blockRoundTripProjection(after.body)) && JSON.stringify(before.meta.accessibility) === JSON.stringify(after.meta.accessibility) ? [] : ['Round trip changed block tree order, span, authored identity, endpoint or declared content']
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
  if (layout && assertions.labelsContain) {
    const labels = [...layout.nodes.map(node => node.label ?? ''), ...layout.edges.map(edge => edge.label?.text ?? ''), ...layout.groups.map(group => group.label ?? '')].map(label => displayText(label)).join('\n')
    for (const label of assertions.labelsContain) if (!labels.includes(label)) findings.push(`Independent layout labelsContain: ${JSON.stringify(label)}`)
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
  const operationEvidence: { family: string; witnesses: OperationWitnessResult[] }[] = []
  const operationDiagnostics: { family: string; diagnostics: ReturnType<typeof runOperationDiagnostics> }[] = []
  const featureEvidence: Array<Record<string, unknown>> = []
  const observedFamilies = new Set<string>()
  const record = (workload: UnifiedWorkload, operation: string, format: string, work: () => ProbeResult): void => {
    const begin = performance.now()
    const precomputed = operation.startsWith('typed-operation-')
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
        ...(precomputed ? {} : { samplesMs: [performance.now() - begin] }),
        ...result,
        status: result.status ?? (result.findings?.length ? 'failed' : 'passed'),
        metrics: { modulePath: entry!, ...(precomputed ? { timingScope: 'functionality-only; operation executed before envelope recording' } : {}), ...result.metrics },
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
        ...(precomputed ? {} : { samplesMs: [performance.now() - begin] }),
        findings: [errorText(error)],
        metrics: { modulePath: entry!, ...(precomputed ? { timingScope: 'functionality-only; operation executed before envelope recording' } : {}) },
      })
    }
  }
  for (const workload of workloads) {
    observedFamilies.add(workload.family)
    const evidence = getWorkloadEvidence(workload.id)
    let observedLayout: { nodes: number; edges: number; groups: number } | undefined
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
        metrics: { verificationOk: result.ok, warningCount: result.warnings.length, diagnostics: JSON.stringify(result.warnings), parserOnly: !!evidence?.parserOnly, declaredEmpty: !!evidence?.emptyDiagramExpected },
        status: !result.ok && (evidence?.parserOnly || (evidence?.emptyDiagramExpected && result.warnings.every(warning => warning.code === 'EMPTY_DIAGRAM'))) ? 'not-applicable' : undefined,
        findings:
          result.ok || evidence?.parserOnly || (evidence?.emptyDiagramExpected && result.warnings.every(warning => warning.code === 'EMPTY_DIAGRAM'))
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
      if (evidence?.parserOnly) return { status: 'not-applicable', detail: 'Owner declares a parser-only fixture; successful scheduling/layout is not its contract.' }
      const layout = api.layoutMermaid(diagram),
        findings = independentAssertions(workload, diagram, layout)
      observedLayout = { nodes: layout.nodes.length, edges: layout.edges.length, groups: layout.groups.length }
      if (layout.kind !== workload.family) findings.push(`Layout routed to ${layout.kind}`)
      for (const node of layout.nodes)
        for (const field of ['x', 'y', 'w', 'h'] as const) {
          if (!Number.isFinite(node[field])) findings.push(`Node ${node.id} has non-finite ${field}`)
          if ((field === 'w' || field === 'h') && node[field] < 0) findings.push(`Node ${node.id} has negative ${field}`)
        }
      return { findings, metrics: { nodes: layout.nodes.length, edges: layout.edges.length, groups: layout.groups.length }, bytes: Buffer.byteLength(JSON.stringify(layout)), detail: 'Finite pixel geometry and routed family; own route/ink/containment and Scene-contract suites are separate authorities.' }
    })
    for (const format of ['svg', 'unicode'] as const)
      record(workload, `render-${format}`, format, (): ProbeResult => {
        if (evidence?.parserOnly) return { status: 'not-applicable', detail: 'Owner declares a parser-only fixture; output success is unmeasured.' }
        const result = format === 'svg' ? api.renderMermaidSVG(diagram, { embedFontImport: false }) : api.renderMermaidASCII(diagram, { colorMode: 'none', useAscii: false })
        if (format === 'unicode' && !result.trim() && evidence?.emptyDiagramExpected) return { status: 'not-applicable', bytes: 0, metrics: { emptyOutput: true, declaredEmpty: true }, detail: 'Owner declares an empty model; nonempty terminal ink is not promised.' }
        if (format === 'svg') return qualifyFamilySvg(workload, result, evidence, observedLayout)
        const qualification = qualifyOutput(workload, result, format)
        return { findings: qualification.findings, bytes: Buffer.byteLength(result), metrics: { qualificationScope: qualification.scope, explicitLabelExpectations: workload.expectedLabels?.length ?? 0 } }
      })
    if (evidence?.labelsContainScope === 'layout')
      record(workload, 'rendered-label-correspondence', 'svg/unicode', () => ({
        status: 'not-applicable',
        metrics: { layoutLabelAssertions: evidence.assertions?.labelsContain?.length ?? 0 },
        detail: 'Historical labelsContain assertions were executed against their actual layout owner. Per-output decoration, wrapping and interleaved values require owned text/region correspondence; generic output-envelope success is not that proof.',
      }))
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
        if (!findings.length) mutationCoverage.set(workload.family, new Set([...(mutationCoverage.get(workload.family) ?? []), ...operations.map(operation => operation.kind)]))
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
        if (!findings.length) mutationCoverage.set(workload.family, new Set([...(mutationCoverage.get(workload.family) ?? []), operation.kind]))
        return { findings, bytes: Buffer.byteLength(source), metrics: { mutation: operation.kind }, detail: 'Actual target mutation, independently requested value and preserved prior facts; not a proof of every advertised mutation operation.' }
      })
    if (workload.id === `registry:${workload.family}`) {
      const witnesses = runOperationWitnesses(api, workload.family, diagram as any)
      operationEvidence.push({ family: workload.family, witnesses })
      const diagnostics = runOperationDiagnostics(api, workload.family)
      operationDiagnostics.push({ family: workload.family, diagnostics })
      for (const diagnostic of diagnostics)
        record({ ...workload, id: `operation-diagnostic:${workload.family}:${diagnostic.kind}` }, 'typed-operation-semantic-boundary', 'source', () => ({
          status: diagnostic.status,
          findings: diagnostic.findings,
          detail: 'An edit whose meaning cannot be serialized must reject atomically. This adversarial input remains separate from the representable positive witness.',
        }))
      for (const witness of witnesses) {
        for (const phase of ['positive', 'rejection'] as const)
          record({ ...workload, id: `operation:${workload.family}:${witness.kind}:${phase}` }, `typed-operation-${phase}`, 'source', () => ({
            status: witness[phase].status,
            findings: witness[phase].findings,
            detail: witness[phase].detail,
            metrics: { operationKind: witness.kind, contractPhase: phase, ...(phase === 'positive' ? { requestedOperation: JSON.stringify(witness.positive.requestedOperation ?? null) } : {}) },
          }))
        if (witness.positive.status === 'passed') mutationCoverage.set(workload.family, new Set([...(mutationCoverage.get(workload.family) ?? []), witness.kind]))
      }
      record(workload, 'direct-api:createMermaid', 'ir', () => {
        if (typeof api.createMermaid !== 'function') return { status: 'blocked', detail: 'Target has no public createMermaid' }
        const created = api.createMermaid(workload.family as any)
        return { findings: created.kind === workload.family && created.body.kind === workload.family ? [] : ['Create returned a different family or non-structured body'], detail: 'Direct public blank factory; an empty model is distinct from a successful populated render.' }
      })
      record(workload, 'direct-api:mutateChecked', 'ir', () => {
        const operation = mutationWitnessForFamily(api, workload.family)
        if (!operation || typeof api.mutateChecked !== 'function') return { status: 'blocked', detail: 'Target has no admitted positive checked mutation stimulus' }
        const changed = api.mutateChecked(diagram, operation)
        if (!changed.ok) throw Error(JSON.stringify(changed.error))
        const source = api.serializeMermaid(changed.value),
          again = api.parseRegisteredMermaid(source)
        return {
          findings: changed.value.kind === workload.family && typedBodyContains(changed.value.body, 'UnifiedBenchmarkWitness') && again.ok && again.value.kind === workload.family && typedBodyContains(again.value.body, 'UnifiedBenchmarkWitness') ? [] : ['Checked positive mutation lost its authored value'],
          detail: 'Positive public checked edit; per-kind malformed rejection and original-input immutability are recorded separately.',
        }
      })
      const operations = structuralBuildWitnessForFamily(api, workload.family)
      for (const method of ['buildMermaid', 'buildChecked'] as const)
        record(workload, `direct-api:${method}`, 'ir', () => {
          if (!operations || typeof api[method] !== 'function') return { status: 'blocked', detail: 'Target has no admitted authored build witness or this public builder' }
          const result = api[method](workload.family as any, operations)
          if (!result.ok) throw Error(JSON.stringify(result.error))
          const findings = result.value.kind === workload.family && result.value.body.kind === workload.family && typedBodyContains(result.value.body, 'UnifiedBenchmarkWitness') ? [] : ['Builder lost the independently authored value in the typed model']
          const source = api.serializeMermaid(result.value),
            again = api.parseRegisteredMermaid(source)
          if (!again.ok || again.value.kind !== workload.family || !typedBodyContains(again.value.body, 'UnifiedBenchmarkWitness')) findings.push('Built value was lost on serialize/reparse')
          return { findings, detail: 'Direct public builder with authored operands; source echoes and descriptor declarations cannot satisfy the typed-value expectation.' }
        })
      for (const method of ['describeMermaid', 'describeMermaidTree', 'describeMermaidSource'] as const)
        record(workload, `direct-api:${method}`, 'query', () => {
          if (!operations || typeof api[method] !== 'function') return { status: 'blocked', detail: 'Target has no admitted query stimulus or this public query' }
          const built = api.applyOps({ family: workload.family, ops: operations })
          if (!built.ok) throw Error(JSON.stringify(built.error))
          const parsed = api.parseRegisteredMermaid(built.source)
          if (!parsed.ok) throw Error('Query input did not parse')
          const result = method === 'describeMermaidSource' ? api.describeMermaidSource(built.source, { format: 'facts' }) : method === 'describeMermaidTree' ? api.describeMermaidTree(parsed.value) : api.describeMermaid(parsed.value, { format: 'facts' })
          const findings = (typeof result === 'string' ? result : JSON.stringify(result)).includes('UnifiedBenchmarkWitness') ? [] : ['Public query omitted the independently authored witness']
          if (typeof result !== 'string' && result.kind !== workload.family) findings.push('Public query reported another family')
          return { findings, detail: 'Direct public query over a populated authored model. This proves its declared witness, not every query field or all function overloads.' }
        })
      if (workload.family === 'flowchart') {
        const source = 'flowchart LR\nA[Start] --> B[End]\nB --> A\nclick A href "https://example.com/benchmark"\n'
        for (const method of ['analyzeMermaid', 'analyzeMermaidSource', 'collectActionRecords'] as const)
          record({ ...workload, id: `query:${method}:authored-feedback-and-action`, source }, `direct-api:${method}`, 'query', () => {
            if (typeof api[method] !== 'function') return { status: 'blocked', detail: 'Target has no corresponding public analysis query' }
            const parsed = api.parseRegisteredMermaid(source)
            if (!parsed.ok) throw Error('Authored analysis stimulus did not parse')
            const answer = method === 'analyzeMermaidSource' ? api.analyzeMermaidSource(source) : method === 'collectActionRecords' ? api.collectActionRecords(parsed.value) : api.analyzeMermaid(parsed.value)
            const result = method === 'analyzeMermaidSource' ? ('ok' in answer && answer.ok ? answer.value : undefined) : answer
            if (!result) throw Error('Source analysis did not return a successful typed result')
            const actions = Array.isArray(result) ? result : 'actions' in result ? result.actions : []
            const findings = actions.some(action => action.target === 'A' && action.href === 'https://example.com/benchmark' && action.executable === false) ? [] : ['Analysis lost the independently authored non-executable action']
            if (!Array.isArray(result) && (!('feedbackEdges' in result) || !result.feedbackEdges.some(edge => edge.from === 'B' && edge.to === 'A'))) findings.push('Analysis lost the independently authored feedback endpoint pair')
            return { findings, detail: 'Direct analysis/actions query checks authored endpoints and safe action records without executing the action.' }
          })
      }
    }
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
    const direct = operationEvidence.find(entry => entry.family === family.id)?.witnesses ?? []
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
      positiveAttemptedOperations: direct.filter(witness => witness.positive.status !== 'blocked').map(witness => witness.kind),
      positiveFailedOperations: direct.filter(witness => witness.positive.status === 'failed').map(witness => witness.kind),
      checkedRejectionOperations: direct.filter(witness => witness.rejection.status === 'passed').map(witness => witness.kind),
      missingPositiveOperations: advertisedOperations.filter(kind => !direct.some(witness => witness.kind === kind && witness.positive.status !== 'blocked')),
      capabilityEvidence: api.getFamily(family.id)?.capabilityEvidence ?? [],
    }
  })
  if (familyCoverage.some(family => family.unexercisedOperations.length))
    gaps.push('Some advertised operation kinds have no passing positive semantic witness. Per-kind positive, checked-rejection, failed and missing cells are retained separately; setup actions and malformed-op rejection do not substitute for positive semantics.')
  const formatOnly = observations.filter(row => row.operation.startsWith('render-') && row.metrics?.qualificationScope === 'format-only').length
  if (formatOnly) gaps.push(`${formatOnly} output probes have format/round-trip invariants but no independently declared label expectations. Community comparison should acquire pinned-reference label expectations before timing.`)
  gaps.push(
    'Historical layout label expectations stay at their owning layout boundary; output envelopes do not certify decorated/wrapped label correspondence. Community fixed-core authored-label guards remain separate.',
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
        operationEvidence,
        operationDiagnostics,
        operationContractSummary: {
          advertised: operationEvidence.reduce((sum, family) => sum + family.witnesses.length, 0),
          positivePassed: operationEvidence.flatMap(family => family.witnesses).filter(witness => witness.positive.status === 'passed').length,
          positiveFailed: operationEvidence.flatMap(family => family.witnesses).filter(witness => witness.positive.status === 'failed').length,
          positiveMissing: operationEvidence.flatMap(family => family.witnesses).filter(witness => witness.positive.status === 'blocked').length,
          checkedRejectionPassed: operationEvidence.flatMap(family => family.witnesses).filter(witness => witness.rejection.status === 'passed').length,
        },
      },
      null,
      2,
    ) + '\n',
  )
  return { id: 'families', status: observations.some(row => row.status === 'failed') ? 'failed' : observations.some(row => row.status === 'blocked') ? 'blocked' : 'passed', startedAt, finishedAt: new Date().toISOString(), observations, gaps, artifacts: [artifact] }
}
