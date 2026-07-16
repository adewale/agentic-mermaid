// ============================================================================
// Executable StyleBackend conformance.
//
// Registration executes two complementary gates against the real backend:
//   1. document-level safety, determinism, and semantic preservation; and
//   2. one named witness for every declared core primitive/feature/operation
//      claim. The second gate is deliberately claim-keyed: a passing shape
//      witness cannot be cited as proof for text, Hybrid, or another feature.
//
// A StyleBackend ends at secured SVG. Native and browser PNG adapters are
// exercised separately because rasterization is downstream of this interface.
// ============================================================================

import {
  OUTPUT_SECURITY_POLICY_VERSION,
  applyOutputSecurityPolicy,
  verifyNoExternalRefs,
  verifySvgDocumentEnvelope,
} from '../output-security.ts'
import type { StyleBackend, StyleBackendContext } from './backend.ts'
import {
  CORE_SCENE_FEATURES,
  CORE_SCENE_OPERATIONS,
  CORE_SCENE_PRIMITIVES,
  primitiveCapabilityClaimKey,
  type PrimitiveCapabilityClaim,
} from './capabilities.ts'
import {
  SCENE_CONTRACT_VERSION,
  type ConnectorMark,
  type DocumentMark,
  type GroupMark,
  type SceneDoc,
  type SceneNode,
  type ShapeMark,
  type TextMark,
} from './ir.ts'
import { hitTestConnector } from './hit-test.ts'
import { serializeMarkerResource } from './marker-resources.ts'
import { assertFinalSvgByteBudget } from './scene-validation.ts'
import {
  connector,
  definitions,
  documentClose,
  documentText,
  group,
  documentOpen,
  shape,
  text,
} from './marks.ts'
import { sceneNodeSerialization } from './serialization.ts'

export const BACKEND_CONFORMANCE_VERSION = 4 as const
export const BACKEND_CONFORMANCE_FIXTURE_ID = 'backend-claim-matrix@3' as const

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
  'capability-claims',
] as const)

export type BackendConformanceCheckId = (typeof BACKEND_CONFORMANCE_CHECK_IDS)[number]

export interface BackendConformanceCheck {
  readonly id: BackendConformanceCheckId
  readonly passed: boolean
  readonly diagnostic?: string
}

export type BackendCapabilityConformanceStatus = 'passed' | 'failed' | 'unverified-extension'

/** A flattened, JSON-safe result for one exact declared claim. */
export interface BackendCapabilityConformanceResult {
  readonly claimKey: string
  readonly target: string
  readonly primitive: PrimitiveCapabilityClaim['primitive']
  readonly feature: PrimitiveCapabilityClaim['feature']
  readonly operation: PrimitiveCapabilityClaim['operation']
  readonly realization: PrimitiveCapabilityClaim['realization']
  /** The declaration's required explanation for a lossy/unsupported cell. */
  readonly limitation?: string
  /** Stable executable witness identity; absent only for namespaced extensions. */
  readonly witnessId?: string
  readonly status: BackendCapabilityConformanceStatus
  readonly observation?: string
  /** Failure/unverified explanation, distinct from the declared limitation. */
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
  /** StyleBackend is an SVG consumer/serializer; PNG is a downstream adapter. */
  readonly directOutputs: readonly ['svg']
  readonly passed: boolean
  readonly checks: readonly BackendConformanceCheck[]
  readonly claims: readonly BackendCapabilityConformanceResult[]
}

type Primitive = 'document' | 'text' | 'shape' | 'container' | 'connector' | 'marker' | 'data-mark'

interface ConformanceProbe {
  readonly primitive: Primitive
  readonly node: SceneNode
  readonly requiredFragments: readonly string[]
}

interface ConformanceNodes {
  readonly root: DocumentMark
  readonly marker: DocumentMark
  readonly shape: ShapeMark
  readonly container: GroupMark
  readonly dataMark: ShapeMark
  readonly richConnector: ConnectorMark
  readonly freehandConnector: ConnectorMark
  readonly closedConnector: ConnectorMark
  readonly multiSubpathConnector: ConnectorMark
  readonly label: TextMark
}

interface ConformanceFixture {
  readonly doc: SceneDoc
  readonly context: StyleBackendContext
  readonly probes: readonly ConformanceProbe[]
  readonly nodes: ConformanceNodes
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
    overflow: 'visible' as const,
    paint: { fill: '#a33b20', stroke: '#334155', strokeWidth: '1' },
  }
  const root = documentOpen({
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
    paint: { fill: '#f4efe6', stroke: '#334155', strokeWidth: '2' },
  }, '<rect x="8" y="16" width="34" height="24" rx="3" ry="3" fill="#f4efe6" stroke="#334155" stroke-width="2" />')
  const container = group({
    id: 'backend-conformance-container',
    role: 'group',
    open: '<g opacity="0.8" fill="#f4efe6">',
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
  const richConnector = connector({
    id: 'backend-conformance-relation',
    role: 'edge',
    geometry: {
      kind: 'path',
      d: 'M 42 28 L 62 14 Q 66 12 70 14 L 90 28',
      points: [{ x: 42, y: 28 }, { x: 66, y: 12 }, { x: 90, y: 28 }],
      markerMidpoints: [{ x: 62, y: 14 }, { x: 70, y: 14 }],
    },
    lineStyle: 'dashed',
    paint: {
      fill: 'none',
      stroke: '#334155',
      strokeWidth: '2',
      opacity: '0.65',
      strokeLinecap: 'square',
      strokeLinejoin: 'miter',
      strokeMiterlimit: '7',
      strokeDasharray: '6 3',
      strokeDashoffset: '2',
      vectorEffect: 'non-scaling-stroke',
      paintOrder: 'stroke fill',
    },
    endpoints: { from: 'backend-conformance-node', to: 'backend-conformance-data-mark' },
    relationship: { kind: 'dependency', direction: 'forward' },
    route: {
      ownership: 'layout', bendRadius: 4, labelAnchors: [{ x: 66, y: 8 }],
      contours: [{
        start: { x: 42, y: 28 }, end: { x: 90, y: 28 }, closed: false,
        startTangent: { x: 0.8192319205190405, y: -0.5734623443633283 },
        endTangent: { x: 0.8192319205190405, y: 0.5734623443633283 },
      }],
    },
    stroke: {
      opacity: 0.65,
      dash: { array: '6 3', offset: 2 },
      lineCap: 'square',
      lineJoin: 'miter',
      miterLimit: 7,
      pathLength: 77,
      paintOrder: 'stroke fill',
      nonScaling: true,
    },
    markers: { start: arrow, mid: [arrow], end: arrow },
    labels: [{
      id: 'backend-conformance-relation-label', text: 'depends on', anchor: { x: 66, y: 8 },
      clearance: 2, halo: { color: '#ffffff', width: 3 }, paint: { fill: '#172033' },
      fontSize: 11, textAnchor: 'middle', visual: { kind: 'inline' },
    }],
  }, '<path d="M 42 28 L 62 14 Q 66 12 70 14 L 90 28" fill="none" stroke="#334155" stroke-width="2" stroke-opacity="0.65" stroke-linecap="square" stroke-linejoin="miter" stroke-miterlimit="7" stroke-dasharray="6 3" stroke-dashoffset="2" pathLength="77" paint-order="stroke fill" vector-effect="non-scaling-stroke" marker-start="url(#backend-conformance-arrow)" marker-mid="url(#backend-conformance-arrow)" marker-end="url(#backend-conformance-arrow)" />')
  const freehandConnector = connector({
    id: 'backend-conformance-freehand-relation',
    role: 'edge',
    geometry: { kind: 'line', x1: 42, y1: 58, x2: 90, y2: 58 },
    lineStyle: 'solid',
    paint: {
      fill: 'none',
      stroke: '#334155',
      strokeWidth: '2',
      strokeLinecap: 'square',
      strokeLinejoin: 'miter',
      strokeMiterlimit: '7',
      vectorEffect: 'non-scaling-stroke',
    },
    endpoints: { from: 'backend-conformance-node', to: 'backend-conformance-data-mark' },
    relationship: { kind: 'association', direction: 'forward' },
    stroke: { lineCap: 'square', lineJoin: 'miter', miterLimit: 7, nonScaling: true },
    transform: { kind: 'rotate', angle: 90, cx: 42, cy: 58 },
  }, '<line x1="42" y1="58" x2="90" y2="58" fill="none" stroke="#334155" stroke-width="2" stroke-linecap="square" stroke-linejoin="miter" stroke-miterlimit="7" vector-effect="non-scaling-stroke" />')
  const closedConnector = connector({
    id: 'backend-conformance-closed-relation',
    role: 'edge',
    geometry: {
      kind: 'path',
      d: 'M 10 65 L 25 50 L 40 65 Z',
      // Deliberately omit a repeated first point: sketch backends consume the
      // routed projection and therefore expose the declared closedness loss.
      points: [{ x: 10, y: 65 }, { x: 25, y: 50 }, { x: 40, y: 65 }],
    },
    lineStyle: 'solid',
    paint: { fill: 'none', stroke: '#334155', strokeWidth: '2' },
    route: { ownership: 'authored', closed: true },
  }, '<path d="M 10 65 L 25 50 L 40 65 Z" fill="none" stroke="#334155" stroke-width="2" />')
  const multiSubpathConnector = connector({
    id: 'backend-conformance-multi-relation',
    role: 'edge',
    geometry: {
      kind: 'path',
      d: 'M 8 72 L 28 72 M 52 72 L 72 72',
      points: [{ x: 8, y: 72 }, { x: 28, y: 72 }, { x: 52, y: 72 }, { x: 72, y: 72 }],
      subpaths: [
        { points: [{ x: 8, y: 72 }, { x: 28, y: 72 }], closed: false },
        { points: [{ x: 52, y: 72 }, { x: 72, y: 72 }], closed: false },
      ],
    },
    lineStyle: 'solid',
    paint: { fill: 'none', stroke: '#334155', strokeWidth: '2' },
    markers: { start: arrow, mid: [], end: arrow },
  }, '<path d="M 8 72 L 28 72 M 52 72 L 72 72" fill="none" stroke="#334155" stroke-width="2" marker-start="url(#backend-conformance-arrow)" marker-end="url(#backend-conformance-arrow)" />')
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
    parts: [root, title, description, marker, container, dataMark, richConnector, label, documentClose()],
  }
  const probes: ConformanceProbe[] = [
    { primitive: 'document', node: root, requiredFragments: ['<svg', 'backend-conformance-title'] },
    { primitive: 'marker', node: marker, requiredFragments: ['id="backend-conformance-arrow"'] },
    { primitive: 'container', node: container, requiredFragments: ['data-id="backend-conformance-container"', 'data-id="backend-conformance-node"'] },
    { primitive: 'shape', node, requiredFragments: ['data-id="backend-conformance-node"', 'data-role="node"'] },
    { primitive: 'data-mark', node: dataMark, requiredFragments: ['data-id="backend-conformance-data-mark"', 'data-role="bar"'] },
    { primitive: 'connector', node: richConnector, requiredFragments: ['data-id="backend-conformance-relation"', 'data-role="edge"'] },
    { primitive: 'text', node: label, requiredFragments: ['data-id="backend-conformance-text"', 'Fixture label'] },
  ]
  const context: StyleBackendContext = {
    seed: 0x5eed,
    style: {
      stroke: 'freehand',
      fill: 'wash',
      roughness: 1,
      bowing: 1,
      passes: 2,
      strokeWidth: 1.5,
      hachureAngle: -41,
      hachureGap: 5,
      fillWeight: 0.8,
      washOpacity: 0.3,
      washEdge: 0.34,
      backdrop: 'plain',
    },
  }
  return deepFreeze({
    doc,
    context,
    probes,
    nodes: {
      root,
      marker,
      shape: node,
      container,
      dataMark,
      richConnector,
      freehandConnector,
      closedConnector,
      multiSubpathConnector,
      label,
    },
  })
}

const FIXTURE = createFixture()

function fragmentDiagnostic(missing: readonly string[]): string | undefined {
  return missing.length === 0 ? undefined : `missing ${missing.join(', ')}`
}

interface WitnessOutcome {
  readonly passed: boolean
  readonly observation: string
  readonly diagnostic?: string
}

type ClaimWitness = (backend: StyleBackend, claim: PrimitiveCapabilityClaim) => WitnessOutcome

function outcome(passed: boolean, observation: string, diagnostic: string): WitnessOutcome {
  return passed ? { passed, observation } : { passed, observation, diagnostic }
}

function occurrences(value: string, fragment: string): number {
  return value.split(fragment).length - 1
}

function drawn(backend: StyleBackend, node: SceneNode): string {
  const output = backend.drawNode(node, FIXTURE.context)
  assertFinalSvgByteBudget(output, 'backend conformance drawNode output')
  return output
}

function rendered(backend: StyleBackend): string {
  const output = backend.render(FIXTURE.doc, FIXTURE.context)
  assertFinalSvgByteBudget(output, 'backend conformance render output')
  return output
}

function visibleSketchProjection(output: string, crisp: string): string {
  // Sketch backends retain the authored connector as an invisible semantic
  // carrier and append their visible geometry. A native backend may make an
  // orthogonal, declared change (for example omit unsupported markers), so
  // output inequality alone cannot be used to classify it as a sketch.
  const opening = output.match(/^\s*<(?:line|polyline|path)\b[^>]*>/)?.[0] ?? ''
  if (!/\sstroke-opacity="0"/.test(opening)) return output
  return output.split('\n').slice(crisp.split('\n').length).join('\n')
}

function nativeOrEmulated(
  backend: StyleBackend,
  claim: PrimitiveCapabilityClaim,
  node: SceneNode,
  extra: (output: string, visible: string) => boolean = () => true,
): WitnessOutcome {
  const output = drawn(backend, node)
  const visible = visibleSketchProjection(output, sceneNodeSerialization(node))
  const nativeObserved = node.kind === 'text'
    ? output.includes(node.text) && output.includes(`x="${node.x}"`) && output.includes(`y="${node.y}"`)
    : node.kind === 'shape' && node.geometry.kind === 'rect'
      ? output.includes(`x="${node.geometry.x}"`)
        && output.includes(`y="${node.geometry.y}"`)
        && output.includes(`width="${node.geometry.width}"`)
        && output.includes(`height="${node.geometry.height}"`)
      : node.kind === 'connector' && node.route.geometry.kind === 'line'
        ? output.includes(`x1="${node.route.geometry.x1}"`)
          && output.includes(`y1="${node.route.geometry.y1}"`)
          && output.includes(`x2="${node.route.geometry.x2}"`)
          && output.includes(`y2="${node.route.geometry.y2}"`)
        : node.kind === 'connector' && node.route.geometry.kind === 'path'
          ? output.includes(`d="${node.route.geometry.d}"`)
      : output === sceneNodeSerialization(node)
  const realizationMatches = claim.realization === 'native'
    ? nativeObserved
    : claim.realization === 'emulated' && output !== sceneNodeSerialization(node) && visible.includes('<path')
  const hybridNonConnector = claim.target === 'backend:hybrid' && node.kind === 'shape'
    ? output.includes('fill-opacity=') && output.includes('stroke="none"')
    : true
  return outcome(
    realizationMatches && hybridNonConnector && extra(output, visible),
    claim.realization === 'native' ? 'authored serialization preserved' : 'typed mark re-realized by backend geometry',
    `backend output did not demonstrate ${claim.realization} ${claim.primitive}/${claim.feature}`,
  )
}

function connectorProjectedField(
  backend: StyleBackend,
  claim: PrimitiveCapabilityClaim,
  attribute: string,
  value: string,
): WitnessOutcome {
  const node = claim.realization === 'lossy' ? FIXTURE.nodes.freehandConnector : FIXTURE.nodes.richConnector
  const output = drawn(backend, node)
  const visible = visibleSketchProjection(output, sceneNodeSerialization(node))
  if (claim.realization === 'lossy') {
    return outcome(
      output !== sceneNodeSerialization(node) && visible.includes('stroke="none"') && !visible.includes(`${attribute}="`),
      `visible freehand ribbon intentionally omits ${attribute}; typed semantic projection remains non-visual`,
      `lossy ${attribute} projection was not observable on the visible freehand ribbon`,
    )
  }
  const carrierMode = claim.realization === 'native'
    ? output.includes('data-id="backend-conformance-relation"')
    : output !== sceneNodeSerialization(node)
  return outcome(
    carrierMode && visible.includes(`${attribute}="${value}"`),
    `${attribute}=${value} present on the ${claim.realization === 'native' ? 'authored' : 'visible generated'} stroke`,
    `${attribute}=${value} was not preserved by the ${claim.realization} realization`,
  )
}

function witnessKey(claim: PrimitiveCapabilityClaim): string {
  return [claim.primitive, claim.feature, claim.operation].join('/')
}

const CLAIM_WITNESSES: Readonly<Record<string, ClaimWitness>> = Object.freeze({
  'document/identity/serialize': backend => {
    const svg = rendered(backend)
    return outcome(
      occurrences(svg, '<svg') === 1 && svg.includes('viewBox="0 0 120 80"') && svg.trimEnd().endsWith('</svg>'),
      'one bounded SVG document serialized',
      'document envelope or bounds were not preserved',
    )
  },
  'document/resources/serialize': backend => {
    const svg = rendered(backend)
    return outcome(
      svg.includes('<defs>') && svg.includes('id="backend-conformance-arrow"') && verifyNoExternalRefs(svg).ok,
      'typed marker resource serialized without external references',
      'document resources were missing or unsafe',
    )
  },
  'document/interaction/accessibility': backend => {
    const svg = rendered(backend)
    return outcome(
      svg.includes('role="img"')
        && svg.includes('aria-labelledby="backend-conformance-title backend-conformance-description"')
        && svg.includes('<title id="backend-conformance-title">Backend conformance fixture</title>')
        && svg.includes('<desc id="backend-conformance-description">A representative Scene document</desc>'),
      'root role, title, and description preserved',
      'document accessibility projection was incomplete',
    )
  },
  'text/geometry/render': (backend, claim) => nativeOrEmulated(
    backend,
    claim,
    FIXTURE.nodes.label,
    output => output.includes('x="25"') && output.includes('y="31"') && output.includes('font-size="12"'),
  ),
  'text/paint/render': (backend, claim) => nativeOrEmulated(
    backend,
    claim,
    FIXTURE.nodes.label,
    output => output.includes('fill="#172033"'),
  ),
  'text/labels/accessibility': backend => {
    const output = drawn(backend, FIXTURE.nodes.label)
    return outcome(output.includes('Fixture label'), 'readable label text preserved', 'text label was not serialized')
  },
  'text/identity/serialize': backend => {
    const output = drawn(backend, FIXTURE.nodes.label)
    return outcome(
      output.includes('data-id="backend-conformance-text"') && output.includes('data-role="member"'),
      'text DOM identity preserved',
      'text DOM identity was lost',
    )
  },
  'shape/geometry/render': (backend, claim) => nativeOrEmulated(backend, claim, FIXTURE.nodes.shape),
  'shape/paint/render': (backend, claim) => nativeOrEmulated(
    backend,
    claim,
    FIXTURE.nodes.shape,
    output => output.includes('#334155') && output.includes('#f4efe6'),
  ),
  'shape/identity/serialize': backend => {
    const output = drawn(backend, FIXTURE.nodes.shape)
    return outcome(
      output.includes('data-id="backend-conformance-node"') && output.includes('data-role="node"'),
      'shape DOM identity preserved on backend output',
      'shape DOM identity was lost',
    )
  },
  'container/geometry/render': (backend, claim) => {
    const output = drawn(backend, FIXTURE.nodes.container)
    return outcome(
      claim.realization === 'native'
        && output.startsWith('<g ')
        && output.trimEnd().endsWith('</g>')
        && output.includes('data-id="backend-conformance-node"'),
      'container boundary and child composition preserved natively while children may be re-realized',
      'container boundary/child geometry was not preserved as a native wrapper',
    )
  },
  'container/paint/render': (backend, claim) => {
    const output = drawn(backend, FIXTURE.nodes.container)
    return outcome(
      claim.realization === 'native' && output.includes('opacity="0.8"') && output.includes('fill="#f4efe6"'),
      'container opacity and fill cascade preserved natively',
      'container paint cascade was not preserved as a native wrapper',
    )
  },
  'container/identity/serialize': backend => {
    const output = drawn(backend, FIXTURE.nodes.container)
    return outcome(
      output.includes('data-id="backend-conformance-container"') && output.includes('data-role="group"'),
      'container DOM identity preserved',
      'container DOM identity was lost',
    )
  },
  'connector/geometry/render': (backend, claim) => {
    const node = FIXTURE.nodes.richConnector
    const output = drawn(backend, node)
    const visible = visibleSketchProjection(output, sceneNodeSerialization(node))
    return outcome(
      claim.realization === 'native'
        ? node.route.geometry.kind === 'path' && output.includes(`d="${node.route.geometry.d}"`)
        : claim.realization === 'lossy'
          && output !== sceneNodeSerialization(node)
          && output.includes('Q 66 12 70 14')
          && !visible.includes('Q 66 12 70 14'),
      claim.realization === 'lossy'
        ? 'exact curve retained on the semantic carrier while visible geometry uses typed routed contours'
        : 'authored connector geometry retained',
      'connector geometry realization did not match its claim',
    )
  },
  'connector/stroke/render': (backend, claim) => nativeOrEmulated(
    backend,
    claim,
    FIXTURE.nodes.freehandConnector,
    output => output.includes('#334155'),
  ),
  'connector/transform/render': (backend, claim) => {
    const node = FIXTURE.nodes.freehandConnector
    const output = drawn(backend, node)
    const visible = visibleSketchProjection(output, sceneNodeSerialization(node))
    const projected = output.includes('transform="rotate(90 42 58)"')
      && hitTestConnector(node, { x: 42, y: 82 })
      && !hitTestConnector(node, { x: 66, y: 58 })
    return outcome(
      projected && (claim.realization === 'native'
        ? !/\sstroke-opacity="0"/.test(output.match(/^\s*<(?:line|polyline|path)\b[^>]*>/)?.[0] ?? '')
        : claim.realization === 'emulated' && visible.startsWith('<g transform="rotate(90 42 58)">')),
      'the same typed rotation governs SVG projection and world-space hit testing',
      'connector transform was not preserved by both rendering and interaction',
    )
  },
  'connector/topology/render': (backend, claim) => {
    const node = FIXTURE.nodes.richConnector
    const output = drawn(backend, node)
    const visible = visibleSketchProjection(output, sceneNodeSerialization(node))
    return outcome(
      claim.realization === 'native'
        ? node.route.geometry.kind === 'path' && output.includes(`d="${node.route.geometry.d}"`)
        : claim.realization === 'lossy'
          && output !== sceneNodeSerialization(node)
          && output.includes('Q 66 12 70 14')
          && !visible.includes('Q 66 12 70 14'),
      claim.realization === 'lossy'
        ? 'path topology remains on the carrier while the visible sketch is a flattened contour projection'
        : 'authored path topology retained',
      'connector topology realization did not match its claim',
    )
  },
  'connector/subpaths/render': (backend, claim) => {
    const node = FIXTURE.nodes.multiSubpathConnector
    const output = drawn(backend, node)
    const visible = visibleSketchProjection(output, sceneNodeSerialization(node))
    const noBridge = hitTestConnector(node, { x: 18, y: 72 })
      && hitTestConnector(node, { x: 62, y: 72 })
      && !hitTestConnector(node, { x: 40, y: 72 })
      && node.route.contours.length === 2
      && node.route.contours.every(contour => contour.startTangent?.x === 1 && contour.endTangent?.x === 1)
    const realization = claim.realization === 'native'
      ? occurrences(output.match(/^\s*<path\b[^>]*>/)?.[0] ?? '', 'M ') === 2
      : claim.realization === 'emulated' && output !== sceneNodeSerialization(node) && occurrences(visible, '<path') >= 2
    return outcome(
      noBridge && realization,
      'two typed contours render and hit-test without a synthetic bridge',
      'connector subpath boundaries were not preserved',
    )
  },
  'connector/closedness/render': (backend, claim) => {
    const node = FIXTURE.nodes.closedConnector
    const output = drawn(backend, node)
    const visible = visibleSketchProjection(output, sceneNodeSerialization(node))
    const closingSegmentHits = hitTestConnector(node, { x: 25, y: 65 })
    const passed = closingSegmentHits && (claim.realization === 'native'
      ? /\sZ(?:\s|&quot;|")/.test(output.match(/^\s*<path\b[^>]*>/)?.[0] ?? '')
      : claim.realization === 'lossy'
        && output !== sceneNodeSerialization(node)
        && /\sZ(?:\s|&quot;|")/.test(output.slice(0, output.indexOf('\n')))
        && !visible.includes('M 10 65 L 25 50 L 40 65 Z'))
    return outcome(
      passed,
      claim.realization === 'lossy'
        ? 'authored closed carrier retained while visible ribbon is rebuilt from the routed points'
        : 'authored closed subpath retained',
      'output did not demonstrate the declared closedness realization',
    )
  },
  'connector/bend-radius/render': (backend, claim) => {
    const node = FIXTURE.nodes.richConnector
    const output = drawn(backend, node)
    const visible = visibleSketchProjection(output, sceneNodeSerialization(node))
    const carrierHasCurve = output.includes('Q 66 12 70 14') && node.route.bendRadius === 4
    return outcome(
      carrierHasCurve && (claim.realization === 'native'
        ? !/\sstroke-opacity="0"/.test(output.match(/^\s*<path\b[^>]*>/)?.[0] ?? '')
        : claim.realization === 'lossy' && output !== sceneNodeSerialization(node) && !visible.includes('Q 66 12 70 14')),
      claim.realization === 'lossy'
        ? 'exact rounded carrier retained while the visible sketch uses the declared routed projection'
        : 'authored rounded connector geometry retained',
      'bend-radius realization did not match the declared capability',
    )
  },
  'connector/stroke-opacity/render': (backend, claim) => connectorProjectedField(backend, claim, 'stroke-opacity', '0.65'),
  'connector/stroke-cap/render': (backend, claim) => connectorProjectedField(backend, claim, 'stroke-linecap', 'square'),
  'connector/stroke-join/render': (backend, claim) => connectorProjectedField(backend, claim, 'stroke-linejoin', 'miter'),
  'connector/stroke-miter/render': (backend, claim) => connectorProjectedField(backend, claim, 'stroke-miterlimit', '7'),
  'connector/dash-array/render': (backend, claim) => connectorProjectedField(backend, claim, 'stroke-dasharray', '6 3'),
  'connector/dash-offset/render': (backend, claim) => connectorProjectedField(backend, claim, 'stroke-dashoffset', '2'),
  'connector/dash-restart/render': (backend, claim) => {
    const node = FIXTURE.nodes.richConnector
    const output = drawn(backend, node)
    const visible = visibleSketchProjection(output, sceneNodeSerialization(node))
    const count = occurrences(visible, 'stroke-dasharray="6 3"')
    const subpaths = occurrences(visible, 'M')
    return outcome(
      claim.realization === 'native'
        ? count === 1
        : claim.realization === 'lossy' && count >= 1 && subpaths > 1,
      claim.realization === 'lossy' ? `${subpaths} generated stroke subpaths restart independently` : 'one authored dashed path retains one dash phase',
      'dash restart boundaries did not match the declared realization',
    )
  },
  'connector/path-length/render': (backend, claim) => {
    const node = FIXTURE.nodes.richConnector
    const output = drawn(backend, node)
    const visible = visibleSketchProjection(output, sceneNodeSerialization(node))
    const count = occurrences(visible, 'pathLength="77"')
    const subpaths = occurrences(visible, 'M')
    return outcome(
      claim.realization === 'native'
        ? count === 1
        : claim.realization === 'lossy' && count >= 1 && subpaths > 1,
      claim.realization === 'lossy' ? `one pathLength value spans ${subpaths} generated stroke subpaths` : 'one authored pathLength calibration retained',
      'pathLength behavior did not match the declared realization',
    )
  },
  'connector/paint-order/render': (backend, claim) => connectorProjectedField(backend, claim, 'paint-order', 'stroke fill'),
  'connector/non-scaling-stroke/render': (backend, claim) => connectorProjectedField(backend, claim, 'vector-effect', 'non-scaling-stroke'),
  'connector/marker-orientation/render': (backend, claim) => {
    const svg = rendered(backend)
    if (claim.realization === 'unsupported') {
      return outcome(
        svg.includes('orient="auto"')
          && !svg.includes('marker-start="url(#backend-conformance-arrow)"')
          && !svg.includes('marker-mid="url(#backend-conformance-arrow)"')
          && !svg.includes('marker-end="url(#backend-conformance-arrow)"'),
        'marker resource remains serializable but the unsupported connector attachment is omitted',
        'backend declared connector marker orientation unsupported but attached the marker',
      )
    }
    const base = svg.includes('orient="auto"')
      && svg.includes('marker-start="url(#backend-conformance-arrow)"')
      && svg.includes('marker-mid="url(#backend-conformance-arrow)"')
      && svg.includes('marker-end="url(#backend-conformance-arrow)"')
    const projected = claim.realization !== 'projected' || svg.includes('markerUnits="userSpaceOnUse"')
    return outcome(
      (claim.realization === 'native' || claim.realization === 'projected') && base && projected,
      claim.realization === 'projected' ? 'typed marker kept in the marker projection with projected units/orientation' : 'native marker orientation retained',
      'marker orientation/carrier projection did not match the declaration',
    )
  },
  'connector/marker-overflow/render': (backend, claim) => {
    const svg = rendered(backend)
    const attached = svg.includes('marker-start="url(#backend-conformance-arrow)"')
      && svg.includes('marker-end="url(#backend-conformance-arrow)"')
    if (claim.realization === 'unsupported') {
      return outcome(
        svg.includes('overflow="visible"') && !attached && !svg.includes('marker-mid="url(#backend-conformance-arrow)"'),
        'marker resource remains serializable but its unsupported connector attachment is omitted',
        'backend declared connector marker overflow unsupported but attached the marker',
      )
    }
    return outcome(
      (claim.realization === 'native' || claim.realization === 'projected')
        && svg.includes('overflow="visible"')
        && attached,
      claim.realization === 'projected'
        ? 'visible overflow remains in the typed marker resource projection'
        : 'native marker overflow retained',
      'marker overflow or its connector attachment was not preserved',
    )
  },
  'connector/endpoints/serialize': backend => {
    const output = drawn(backend, FIXTURE.nodes.richConnector)
    return outcome(
      output.includes('data-from="backend-conformance-node"')
        && output.includes('data-to="backend-conformance-data-mark"'),
      'typed endpoint identities serialized on the semantic carrier',
      'connector endpoint identities were not serialized',
    )
  },
  'connector/direction/serialize': backend => {
    const output = drawn(backend, FIXTURE.nodes.richConnector)
    return outcome(
      output.includes('data-relationship="dependency"') && output.includes('data-direction="forward"'),
      'typed relationship kind and direction serialized on the semantic carrier',
      'connector relationship direction was not serialized',
    )
  },
  'connector/labels/accessibility': backend => {
    const output = drawn(backend, FIXTURE.nodes.richConnector)
    return outcome(
      output.includes('aria-label="backend-conformance-node to backend-conformance-data-mark: depends on"'),
      'typed connector label participates in the accessible relation name',
      'connector label was absent from accessibility output',
    )
  },
  'connector/labels/render': (backend, claim) => {
    const output = drawn(backend, FIXTURE.nodes.richConnector)
    return outcome(
      claim.realization === 'native'
        && output.includes('data-id="backend-conformance-relation-label"')
        && output.includes('data-connector-label-for="backend-conformance-relation"')
        && output.includes('x="66" y="6"')
        && output.includes('font-size="11"')
        && output.includes('fill="#172033"')
        && output.includes('stroke="#ffffff"')
        && output.includes('stroke-width="3"')
        && output.includes('paint-order="stroke fill"')
        && output.includes('>depends on</text>'),
      'typed label anchor, clearance, paint, typography, and halo render on the connector carrier',
      'connector label visual semantics were not preserved',
    )
  },
  'connector/relation/accessibility': backend => {
    const output = drawn(backend, FIXTURE.nodes.richConnector)
    return outcome(
      output.includes('data-from="backend-conformance-node"')
        && output.includes('data-to="backend-conformance-data-mark"')
        && output.includes('role="graphics-symbol"')
        && output.includes('aria-roledescription="relation"')
        && output.includes('aria-label="backend-conformance-node to backend-conformance-data-mark: depends on"'),
      'typed relation and accessible label preserved on the carrier',
      'connector relation accessibility semantics were lost',
    )
  },
  'connector/markers/render': (backend, claim) => {
    const output = drawn(backend, FIXTURE.nodes.richConnector)
    if (claim.realization === 'unsupported') {
      return outcome(
        !output.includes('marker-start="url(#backend-conformance-arrow)"')
          && !output.includes('marker-mid="url(#backend-conformance-arrow)"')
          && !output.includes('marker-end="url(#backend-conformance-arrow)"'),
        'backend omits the explicitly unsupported connector marker',
        'backend declared connector markers unsupported but still serialized one',
      )
    }
    return outcome(
      (claim.realization === 'native' || claim.realization === 'projected')
        && output.includes('marker-start="url(#backend-conformance-arrow)"')
        && output.includes('marker-mid="url(#backend-conformance-arrow)"')
        && output.includes('marker-end="url(#backend-conformance-arrow)"'),
      claim.realization === 'projected' ? 'marker retained in the typed marker projection' : 'native connector marker retained',
      'connector marker projection did not match the declaration',
    )
  },
  'connector/interaction/hit-test': backend => {
    const node = FIXTURE.nodes.freehandConnector
    const output = drawn(backend, node)
    return outcome(
      output.includes('data-id="backend-conformance-freehand-relation"')
        && hitTestConnector(node, { x: 42, y: 82 })
        && !hitTestConnector(node, { x: 66, y: 58 }),
      'typed hit geometry remains aligned with the backend-preserved connector carrier',
      'connector carrier or typed hit geometry was not preserved',
    )
  },
  'connector/hit-geometry/hit-test': backend => {
    const node = FIXTURE.nodes.multiSubpathConnector
    const output = drawn(backend, node)
    return outcome(
      output.includes('data-id="backend-conformance-multi-relation"')
        && hitTestConnector(node, { x: 18, y: 72 })
        && !hitTestConnector(node, { x: 40, y: 72 }),
      'typed hit geometry preserves contour gaps independently of backend artwork',
      'connector hit geometry did not preserve typed contour boundaries',
    )
  },
  'connector/identity/serialize': backend => {
    const output = drawn(backend, FIXTURE.nodes.richConnector)
    return outcome(
      output.includes('data-id="backend-conformance-relation"') && output.includes('data-role="edge"'),
      'connector DOM identity preserved on carrier',
      'connector DOM identity was lost',
    )
  },
  'marker/geometry/render': (backend, claim) => {
    const output = drawn(backend, FIXTURE.nodes.marker)
    return outcome(
      (claim.realization === 'native' || claim.realization === 'projected')
        && output.includes('M 0 0 L 8 4 L 0 8 Z')
        && output.includes('viewBox="0 0 8 8"'),
      claim.realization === 'projected' ? 'typed marker geometry reserialized in the marker resource projection' : 'native marker geometry retained',
      'marker geometry was not present in backend output',
    )
  },
  'marker/paint/render': (backend, claim) => {
    const output = drawn(backend, FIXTURE.nodes.marker)
    return outcome(
      (claim.realization === 'native' || claim.realization === 'projected')
        && output.includes('fill="#a33b20"')
        && output.includes('stroke="#334155"'),
      claim.realization === 'projected' ? 'typed marker paint retained in the marker resource projection' : 'native marker paint retained',
      'marker paint was not present in backend output',
    )
  },
  'marker/identity/serialize': backend => {
    const output = drawn(backend, FIXTURE.nodes.marker)
    return outcome(
      output.includes('id="backend-conformance-arrow"'),
      'marker resource identity retained',
      'marker resource identity was lost',
    )
  },
  'data-mark/geometry/render': (backend, claim) => nativeOrEmulated(backend, claim, FIXTURE.nodes.dataMark),
  'data-mark/paint/render': (backend, claim) => nativeOrEmulated(
    backend,
    claim,
    FIXTURE.nodes.dataMark,
    output => output.includes('#a33b20') && output.includes('#334155'),
  ),
  'data-mark/identity/serialize': backend => {
    const output = drawn(backend, FIXTURE.nodes.dataMark)
    return outcome(
      output.includes('data-id="backend-conformance-data-mark"') && output.includes('data-role="bar"'),
      'quantitative mark DOM identity retained',
      'quantitative mark DOM identity was lost',
    )
  },
})

function isCoreClaim(claim: PrimitiveCapabilityClaim): boolean {
  return (CORE_SCENE_PRIMITIVES as readonly string[]).includes(claim.primitive)
    && (CORE_SCENE_FEATURES as readonly string[]).includes(claim.feature)
    && (CORE_SCENE_OPERATIONS as readonly string[]).includes(claim.operation)
}

function runCapabilityClaims(backend: StyleBackend): BackendCapabilityConformanceResult[] {
  return backend.capabilities.map(claim => {
    const key = primitiveCapabilityClaimKey(claim)
    const witness = CLAIM_WITNESSES[witnessKey(claim)]
    const shared = {
      claimKey: key,
      target: claim.target,
      primitive: claim.primitive,
      feature: claim.feature,
      operation: claim.operation,
      realization: claim.realization,
      ...(claim.diagnostic ? { limitation: claim.diagnostic } : {}),
    }
    if (!witness) {
      return isCoreClaim(claim)
        ? {
            ...shared,
            status: 'failed' as const,
            diagnostic: 'No executable witness is registered for this core claim.',
          }
        : {
            ...shared,
            status: 'unverified-extension' as const,
            diagnostic: 'Namespaced extension claim is outside the built-in witness vocabulary.',
          }
    }
    const witnessId = `${BACKEND_CONFORMANCE_FIXTURE_ID}/${witnessKey(claim)}`
    try {
      const result = witness(backend, claim)
      return {
        ...shared,
        witnessId,
        status: result.passed ? 'passed' as const : 'failed' as const,
        observation: result.observation,
        ...(result.diagnostic ? { diagnostic: result.diagnostic } : {}),
      }
    } catch (error) {
      return {
        ...shared,
        witnessId,
        status: 'failed' as const,
        diagnostic: `Witness threw ${error instanceof Error ? error.message : String(error)}`,
      }
    }
  })
}

/** Execute the frozen document and claim fixtures against a backend. */
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
      const first = drawn(backend, probe.node)
      const second = drawn(backend, probe.node)
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
    first = rendered(backend)
    second = rendered(backend)
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
  add('single-svg-document', singleSvg, singleSvg ? undefined : 'render must return one well-formed namespaced SVG document')
  const invalidScalar = first.match(/\b(?:NaN|Infinity|undefined)\b/)?.[0]
  add('finite-serialization', !invalidScalar, invalidScalar ? `serialized ${invalidScalar}` : undefined)
  const security = verifyNoExternalRefs(first)
  let policyDiagnostic: string | undefined
  try {
    applyOutputSecurityPolicy(first, 'default')
  } catch (error) {
    policyDiagnostic = error instanceof Error ? error.message : String(error)
  }
  const outputSecure = security.ok && policyDiagnostic === undefined
  add('output-security', outputSecure, outputSecure
    ? undefined
    : [policyDiagnostic, security.ok ? undefined : `unsafe SVG constructs: ${security.refs.join(', ')}`]
        .filter(Boolean).join('; '))

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
    ['marker-semantics', ['id="backend-conformance-arrow"']],
    ['data-mark-semantics', ['data-id="backend-conformance-data-mark"', 'data-role="bar"']],
  ]
  for (const [id, fragments] of semanticChecks) {
    const missing = fragments.filter(fragment => !first.includes(fragment))
    add(id, missing.length === 0, fragmentDiagnostic(missing))
  }

  const claims = runCapabilityClaims(backend)
  const failedClaims = claims.filter(result => result.status === 'failed')
  add(
    'capability-claims',
    failedClaims.length === 0,
    failedClaims.map(result => `${result.primitive}/${result.feature}/${result.operation}: ${result.diagnostic ?? 'failed'}`).join('; ') || undefined,
  )

  const report: BackendConformanceReport = {
    version: BACKEND_CONFORMANCE_VERSION,
    fixtureId: BACKEND_CONFORMANCE_FIXTURE_ID,
    backendId: canonicalId,
    contracts: { scene: SCENE_CONTRACT_VERSION, outputSecurity: OUTPUT_SECURITY_POLICY_VERSION },
    directOutputs: ['svg'],
    passed: checks.every(check => check.passed),
    checks,
    claims,
  }
  return deepFreeze(report)
}
