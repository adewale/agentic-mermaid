// ============================================================================
// Registration-time StyleBackend conformance smoke test.
//
// This is intentionally a small executable admission gate, not a claim that
// one synthetic document proves every diagram-family or capability detail. It
// verifies the contract properties that a backend can otherwise silently
// discard at registration: deterministic Scene consumption, one safe SVG
// document, and preservation of representative semantic marks. PNG is not
// rendered here; registered backends reach it only through the canonical,
// secured SVG rasterizer.
// ============================================================================

import { OUTPUT_SECURITY_POLICY_VERSION, verifyNoExternalRefs, verifySvgDocumentEnvelope } from '../output-security.ts'
import type { StyleBackend, StyleBackendContext } from './backend.ts'
import { SCENE_CONTRACT_VERSION, type SceneDoc, type SceneNode } from './ir.ts'
import { serializeMarkerResource } from './marker-resources.ts'
import {
  connector,
  definitions,
  documentClose,
  documentText,
  group,
  prelude,
  shape,
  text,
} from './marks.ts'

export const BACKEND_CONFORMANCE_VERSION = 1 as const
export const BACKEND_CONFORMANCE_FIXTURE_ID = 'backend-registration-svg-smoke@1' as const

export const BACKEND_CONFORMANCE_CHECK_IDS = Object.freeze([
  'draw-node-determinism',
  'draw-node-semantics',
  'document-determinism',
  'single-svg-document',
  'finite-serialization',
  'output-security',
  'document-semantics',
  'container-semantics',
  'shape-semantics',
  'text-semantics',
  'connector-semantics',
  'marker-semantics',
  'data-mark-semantics',
] as const)

export type BackendConformanceCheckId = (typeof BACKEND_CONFORMANCE_CHECK_IDS)[number]

export interface BackendConformanceCheck {
  readonly id: BackendConformanceCheckId
  readonly passed: boolean
  readonly diagnostic?: string
}

export interface BackendConformanceReport {
  readonly version: typeof BACKEND_CONFORMANCE_VERSION
  readonly fixtureId: typeof BACKEND_CONFORMANCE_FIXTURE_ID
  readonly backendId: string
  readonly contracts: {
    readonly scene: typeof SCENE_CONTRACT_VERSION
    readonly outputSecurity: typeof OUTPUT_SECURITY_POLICY_VERSION
  }
  /** The registration fixture directly executes only the SVG backend API. */
  readonly directOutputs: readonly ['svg']
  /** PNG uses this backend output only after canonical security and rasterization. */
  readonly inheritedOutputs: readonly [{
    readonly output: 'png'
    readonly via: 'canonical-secured-svg-rasterizer'
    readonly directlyTested: false
  }]
  readonly passed: boolean
  readonly checks: readonly BackendConformanceCheck[]
}

interface ConformanceProbe {
  readonly primitive: 'document' | 'text' | 'shape' | 'container' | 'connector' | 'marker' | 'data-mark'
  readonly node: SceneNode
  readonly requiredFragments: readonly string[]
}

interface ConformanceFixture {
  readonly doc: SceneDoc
  readonly context: StyleBackendContext
  readonly probes: readonly ConformanceProbe[]
}

function deepFreeze<T>(value: T): T {
  if (typeof value !== 'object' || value === null || Object.isFrozen(value)) return value
  for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child)
  return Object.freeze(value)
}

function createFixture(): ConformanceFixture {
  const colors = { bg: '#ffffff', fg: '#172033', line: '#334155', accent: '#a33b20' }
  const arrow = {
    id: 'backend-conformance-arrow',
    shape: 'arrow' as const,
    geometry: { kind: 'path' as const, d: 'M 0 0 L 8 4 L 0 8 Z' },
    size: { width: 8, height: 8 },
    viewBox: { x: 0, y: 0, width: 8, height: 8 },
    ref: { x: 8, y: 4 },
    units: 'userSpaceOnUse' as const,
    orient: 'auto' as const,
  }
  const root = prelude({
    id: 'backend-conformance-prelude',
    width: 120,
    height: 80,
    colors,
    transparent: true,
    font: 'Inter',
    hasMonoFont: false,
  }, '<svg xmlns="http://www.w3.org/2000/svg" width="120" height="80" viewBox="0 0 120 80" role="img" aria-labelledby="backend-conformance-title backend-conformance-description">')
  const title = documentText({
    id: 'backend-conformance-title',
    element: 'title',
    text: 'Backend conformance fixture',
    domId: 'backend-conformance-title',
  })
  const description = documentText({
    id: 'backend-conformance-description',
    element: 'description',
    text: 'A representative Scene document',
    domId: 'backend-conformance-description',
  })
  const marker = definitions(
    { id: 'backend-conformance-definitions', markerResources: [arrow] },
    `<defs>\n${serializeMarkerResource(arrow)}\n</defs>`,
  )
  const node = shape({
    id: 'backend-conformance-node',
    role: 'node',
    geometry: { kind: 'rect', x: 8, y: 16, width: 34, height: 24, rx: 3, ry: 3 },
    paint: { fill: '#ffffff', stroke: '#334155', strokeWidth: '2' },
  }, '<rect x="8" y="16" width="34" height="24" rx="3" ry="3" fill="#ffffff" stroke="#334155" stroke-width="2" />')
  const container = group({
    id: 'backend-conformance-container',
    role: 'group',
    open: '<g>',
    close: '</g>',
    children: [{ node, indent: 2 }],
  })
  const dataMark = shape({
    id: 'backend-conformance-data-mark',
    role: 'bar',
    geometry: { kind: 'rect', x: 92, y: 48, width: 16, height: 20 },
    paint: { fill: '#a33b20', stroke: '#334155', strokeWidth: '1' },
    channels: { value: 0.75, category: 'fixture' },
  }, '<rect x="92" y="48" width="16" height="20" fill="#a33b20" stroke="#334155" stroke-width="1" />')
  const relation = connector({
    id: 'backend-conformance-relation',
    role: 'edge',
    geometry: { kind: 'line', x1: 42, y1: 28, x2: 90, y2: 28 },
    lineStyle: 'solid',
    paint: {
      fill: 'none',
      stroke: '#334155',
      strokeWidth: '2',
      strokeLinecap: 'round',
      strokeLinejoin: 'round',
    },
    endpoints: { from: 'backend-conformance-node', to: 'backend-conformance-data-mark' },
    relationship: { kind: 'dependency', direction: 'forward' },
    markers: { end: arrow },
    labels: [{ id: 'backend-conformance-relation-label', text: 'depends on' }],
    projectAccessibilityToSvg: true,
  }, '<line x1="42" y1="28" x2="90" y2="28" fill="none" stroke="#334155" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" marker-end="url(#backend-conformance-arrow)" />')
  const label = text({
    id: 'backend-conformance-text',
    role: 'member',
    text: 'Fixture label',
    x: 25,
    y: 31,
    fontSize: 12,
    anchor: 'middle',
    paint: { fill: '#172033' },
  }, '<text x="25" y="31" text-anchor="middle" font-size="12" fill="#172033">Fixture label</text>')

  const doc: SceneDoc = {
    family: 'backend-conformance',
    width: 120,
    height: 80,
    colors,
    parts: [root, title, description, marker, container, dataMark, relation, label, documentClose()],
  }
  const probes: ConformanceProbe[] = [
    { primitive: 'document', node: root, requiredFragments: ['<svg', 'backend-conformance-title'] },
    { primitive: 'marker', node: marker, requiredFragments: ['id="backend-conformance-arrow"'] },
    { primitive: 'container', node: container, requiredFragments: ['data-id="backend-conformance-container"', 'data-id="backend-conformance-node"'] },
    { primitive: 'shape', node, requiredFragments: ['data-id="backend-conformance-node"', 'data-role="node"'] },
    { primitive: 'data-mark', node: dataMark, requiredFragments: ['data-id="backend-conformance-data-mark"', 'data-role="bar"'] },
    { primitive: 'connector', node: relation, requiredFragments: ['data-id="backend-conformance-relation"', 'marker-end="url(#backend-conformance-arrow)"'] },
    { primitive: 'text', node: label, requiredFragments: ['data-id="backend-conformance-text"', 'Fixture label'] },
  ]
  const context: StyleBackendContext = {
    seed: 0x5eed,
    style: {
      stroke: 'jittered',
      fill: 'hachure',
      roughness: 1,
      bowing: 1,
      passes: 1,
      strokeWidth: 1.5,
      hachureAngle: -41,
      hachureGap: 5,
      fillWeight: 0.8,
      backdrop: 'plain',
    },
  }
  return deepFreeze({ doc, context, probes })
}

const FIXTURE = createFixture()

function fragmentDiagnostic(missing: readonly string[]): string | undefined {
  return missing.length === 0 ? undefined : `missing ${missing.join(', ')}`
}

/**
 * Execute the frozen registration fixture against a backend. The report is a
 * bounded smoke result: passing proves these SVG invariants for this fixture,
 * not exhaustive parity for every family or every declared capability.
 */
export function runBackendConformance(
  backend: StyleBackend,
  canonicalId: string = backend.id,
): BackendConformanceReport {
  const checks: BackendConformanceCheck[] = []
  const add = (id: BackendConformanceCheckId, passed: boolean, diagnostic?: string) => {
    checks.push(Object.freeze({ id, passed, ...(diagnostic ? { diagnostic } : {}) }))
  }

  const drawDeterminismProblems: string[] = []
  const drawSemanticProblems: string[] = []
  for (const probe of FIXTURE.probes) {
    try {
      const first = backend.drawNode(probe.node, FIXTURE.context)
      const second = backend.drawNode(probe.node, FIXTURE.context)
      if (typeof first !== 'string' || typeof second !== 'string') {
        drawDeterminismProblems.push(`${probe.primitive} returned a non-string`)
        drawSemanticProblems.push(`${probe.primitive} returned a non-string`)
        continue
      }
      if (first !== second) drawDeterminismProblems.push(`${probe.primitive} changed between identical calls`)
      const missing = probe.requiredFragments.filter(fragment => !first.includes(fragment))
      if (missing.length > 0) drawSemanticProblems.push(`${probe.primitive} ${fragmentDiagnostic(missing)}`)
    } catch (error) {
      const diagnostic = `${probe.primitive} threw ${error instanceof Error ? error.message : String(error)}`
      drawDeterminismProblems.push(diagnostic)
      drawSemanticProblems.push(diagnostic)
    }
  }
  add('draw-node-determinism', drawDeterminismProblems.length === 0, drawDeterminismProblems.join('; ') || undefined)
  add('draw-node-semantics', drawSemanticProblems.length === 0, drawSemanticProblems.join('; ') || undefined)

  let first = ''
  let second = ''
  let renderDiagnostic: string | undefined
  try {
    first = backend.render(FIXTURE.doc, FIXTURE.context)
    second = backend.render(FIXTURE.doc, FIXTURE.context)
    if (typeof first !== 'string' || typeof second !== 'string') {
      renderDiagnostic = 'render must return a string'
      first = typeof first === 'string' ? first : ''
      second = typeof second === 'string' ? second : ''
    } else if (first !== second) {
      renderDiagnostic = 'render changed between identical calls'
    }
  } catch (error) {
    renderDiagnostic = `render threw ${error instanceof Error ? error.message : String(error)}`
  }
  add('document-determinism', renderDiagnostic === undefined, renderDiagnostic)

  const singleSvg = verifySvgDocumentEnvelope(first)
  add('single-svg-document', singleSvg, singleSvg ? undefined : 'render must return one balanced SVG document')
  const invalidScalar = first.match(/\b(?:NaN|Infinity|undefined)\b/)?.[0]
  add('finite-serialization', !invalidScalar, invalidScalar ? `serialized ${invalidScalar}` : undefined)
  const security = verifyNoExternalRefs(first)
  add('output-security', security.ok, security.ok ? undefined : `unsafe SVG constructs: ${security.refs.join(', ')}`)

  const semanticChecks: Array<[BackendConformanceCheckId, readonly string[]]> = [
    ['document-semantics', [
      'aria-labelledby="backend-conformance-title backend-conformance-description"',
      '<title id="backend-conformance-title">Backend conformance fixture</title>',
      '<desc id="backend-conformance-description">A representative Scene document</desc>',
    ]],
    ['container-semantics', ['data-id="backend-conformance-container"', 'data-role="group"']],
    ['shape-semantics', ['data-id="backend-conformance-node"', 'data-role="node"']],
    ['text-semantics', ['data-id="backend-conformance-text"', 'data-role="member"', 'Fixture label']],
    ['connector-semantics', [
      'data-id="backend-conformance-relation"',
      'data-role="edge"',
      'data-from="backend-conformance-node"',
      'data-to="backend-conformance-data-mark"',
      'role="graphics-symbol"',
      'aria-roledescription="relation"',
      'aria-label="backend-conformance-node to backend-conformance-data-mark: depends on"',
    ]],
    ['marker-semantics', ['id="backend-conformance-arrow"', 'marker-end="url(#backend-conformance-arrow)"']],
    ['data-mark-semantics', ['data-id="backend-conformance-data-mark"', 'data-role="bar"']],
  ]
  for (const [id, fragments] of semanticChecks) {
    const missing = fragments.filter(fragment => !first.includes(fragment))
    add(id, missing.length === 0, fragmentDiagnostic(missing))
  }

  const report: BackendConformanceReport = {
    version: BACKEND_CONFORMANCE_VERSION,
    fixtureId: BACKEND_CONFORMANCE_FIXTURE_ID,
    backendId: canonicalId,
    contracts: { scene: SCENE_CONTRACT_VERSION, outputSecurity: OUTPUT_SECURITY_POLICY_VERSION },
    directOutputs: ['svg'],
    inheritedOutputs: [{ output: 'png', via: 'canonical-secured-svg-rasterizer', directlyTested: false }],
    passed: checks.every(check => check.passed),
    checks,
  }
  return deepFreeze(report)
}
