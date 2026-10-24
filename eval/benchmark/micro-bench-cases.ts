// Hotspot micro-benchmark cases for `eval/benchmark/micro-bench.ts`.
//
// Each case times a public render, stage or hotspot in the warm SVG/PNG/ASCII
// pipeline (see the case descriptions). Setup runs outside the
// timed call. Every module is imported inside `setup`, never statically, so a
// case whose internal entry point does not exist at a baseline revision is
// reported as unavailable instead of preventing every other case from running.

import { createHash } from 'node:crypto'
import { decodeXML } from 'entities'
import type { RenderedSvg } from '../../src/index.ts'
import type { OutputSecurityDiagnostic } from '../../src/output-security.ts'
import { flowchartMesh, flowchartTree, releaseBenchCases } from './release-bench-cases.ts'

/** A stage case's timed call and the input an earlier stage of the same
 * revision built for it. A revision comparison withholds the ratio when the
 * two sides were handed different inputs. */
export interface StagedCall {
  readonly call: () => unknown
  readonly input: string
  /** Optional all-return validation, strictly outside clocks/GCProfiler. */
  readonly consume?: (result: unknown) => void
  /** Prepare one equivalent input outside timing; requires single-call capture. */
  readonly beforeCall?: () => void
  readonly captureBatchSize?: number
  readonly evidence?: unknown
}

export interface MicroCase {
  id: string
  description: string
  /** Prepare inputs outside timing and return the timed call. */
  setup(): Promise<(() => unknown) | StagedCall>
  /** Optional sanity check on one result, so a fast failure is never timed. */
  check?(result: unknown): boolean
}

const release = (id: string): string => {
  const found = releaseBenchCases().find(input => input.id === id)
  if (!found) throw new Error(`release benchmark case ${id} is missing`)
  return found.source
}

/** Deterministic inputs. Tree/mesh sizes follow the dated peer comparison in
 * docs/comparison.md; class/ER/state reuse the release benchmark generators. */
export const MICRO_WORKLOADS = {
  flow5: 'flowchart TD\n  A[Start] --> B{Check}\n  B -->|yes| C[Do it]\n  B -->|no| D[Skip]\n  C --> E[End]\n  D --> E',
  tree50: flowchartTree(50),
  mesh50: flowchartMesh(50, 20),
  seq20: ['sequenceDiagram', ...Array.from({ length: 20 }, (_, i) => `  P${i % 5}->>P${(i * 3 + 1) % 5}: message ${i}`)].join('\n'),
  c4: 'C4Context\n  Person(u, "User")\n  System(s, "System")\n  System_Ext(e, "Email")\n  Rel(u, s, "Uses")\n  Rel(s, e, "Sends")',
  class80: release('class:80-classes'),
  er40: release('er:40-entities'),
  state80: release('state:80-states'),
  packet240: release('packet:240-fields'),
  kanban240: release('kanban:12-columns-240-cards'),
  requirement100: release('requirement:100-requirements-99-relations'),
  treemap260: release('treemap:20-groups-240-leaves'),
  ishikawa133: release('ishikawa:12-categories-120-causes'),
  block120: release('block:120-grid-blocks'),
} as const
type Workload = keyof typeof MICRO_WORKLOADS
const STABLE_WORKLOADS = { packet240: 'packet', kanban240: 'kanban', requirement100: 'requirement', treemap260: 'treemap', ishikawa133: 'ishikawa', block120: 'block' } as const

const ASCII_LABEL = 'Authenticate the incoming user request'
const MIXED_LABEL = '東京 → 👩‍💻 café naïve Ελληνικά 한국어 👍🏽'
/** Plain-data text of a stage input, comparable across revisions. */
const inputText = (value: unknown) => JSON.stringify(value, (_key, item) => (item instanceof Map || item instanceof Set ? [...item] : item))
const isSvg = (value: unknown) => typeof value === 'string' && value.startsWith('<svg')
const isPng = (value: unknown) => value instanceof Uint8Array && [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((byte, index) => value[index] === byte)
const nonEmptyString = (value: unknown) => typeof value === 'string' && value.length > 0

// Same authored bytes at every revision: cleanup is measured through existing
// source, typed-parse and render-request boundaries, including their callers.
const ENTITY_FLOW50 = ['flowchart TD', ...Array.from({ length: 50 }, (_, i) =>
  `  N${i}["Item ${i} #amp; #35; #quot; #lt;literal#gt;"]${i ? ` --> N${i - 1}` : ''}`)].join('\n')
const WRAPPED_ENTITY_FLOW50 = `\uFEFF---\r\ntitle: Cleanup benchmark\r\n---\r\n%%{init: {"theme":"default"}}%%\r\n%% authored comment\r\n${ENTITY_FLOW50.replace(/\n/g, '\r\n')}\r\n`
const ENTITY_SEQUENCE20 = ['sequenceDiagram', ...Array.from({ length: 20 }, (_, i) =>
  `  P${i % 5}->>P${(i + 1) % 5}: message ${i} #amp; #35; #quot; #lt;literal#gt;`)].join('\n')

const src = {
  index: () => import('../../src/index.ts'),
  agent: () => import('../../src/agent/index.ts'),
  parser: () => import('../../src/parser.ts'),
  source: () => import('../../src/mermaid-source.ts'),
  layoutEngine: () => import('../../src/layout-engine.ts'),
  elk: () => import('../../src/elk-instance.ts'),
  rubric: () => import('../../src/layout-rubric.ts'),
  routes: () => import('../../src/route-contracts.ts'),
  contract: () => import('../../src/render-contract.ts'),
  positioning: () => import('../../src/positioning.ts'),
  graphical: () => import('../../src/graphical-render.ts'),
  snapshot: () => import('../../src/scene/external-data-snapshot.ts'),
  validation: () => import('../../src/scene/scene-validation.ts'),
  security: () => import('../../src/output-security.ts'),
  structure: () => import('../../src/svg-structure.ts'),
  styleScope: () => import('../../src/svg-style-scope.ts'),
  fontGeometry: () => import('../../src/custom-font-geometry.ts'),
  theme: () => import('../../src/theme.ts'),
  graphemes: () => import('../../src/shared/graphemes.ts'),
  displayText: () => import('../../src/shared/display-text.ts'),
  preparedText: () => import('../../src/shared/prepared-text.ts'),
  ganttParser: () => import('../../src/gantt/parser.ts'),
  ganttSchedule: () => import('../../src/gantt/schedule.ts'),
  textMetrics: () => import('../../src/text-metrics.ts'),
  conformance: () => import('../../src/scene/backend-conformance.ts'),
  paintCertification: () => import('../../src/scene/paint-certification.ts'),
  builtinBackends: () => import('../../src/scene/builtin-backends.ts'),
  inspection: () => import('../../src/svg-inspection-cache.ts'),
}

// Literal authored labels, independent of the parser/lowering being measured.
const receiptLabels = (workload: Workload): readonly (string | { visible: string; accessible: string })[] => {
  const range = (prefix: string, count: number) => Array.from({ length: count }, (_, index) => `${prefix}${index}`)
  switch (workload) {
    case 'flow5': return ['Start', 'Check', 'Do it', 'Skip', 'End']
    case 'tree50': return range('Node ', 50)
    case 'mesh50': return range('label ', 20)
    case 'seq20': return range('message ', 20)
    case 'c4': return ['User', 'Email', 'Uses', 'Sends']
    case 'class80': return range('C', 80)
    case 'er40': return range('E', 40)
    case 'state80': return range('S', 81)
    case 'packet240': return ['Protocol fields', ...range('Field ', 240)]
    case 'kanban240': return Array.from({ length: 12 }, (_, column) => [`Stage ${column}`, ...Array.from({ length: 20 }, (_, row) => `Task ${column}.${row}`)]).flat()
    case 'requirement100': return range('Text: Requirement ', 100)
    case 'treemap260': return ['Product allocation', ...Array.from({ length: 20 }, (_, group) => [`Group ${group}`, ...Array.from({ length: 12 }, (_, leaf) => ({ visible: `Investment ${group}.${leaf}`, accessible: `Investment ${group}.${leaf}: ${(leaf + 1) * 10}` }))]).flat()]
    case 'ishikawa133': return ['Delayed delivery', ...Array.from({ length: 12 }, (_, category) => [`Category ${category}`, ...Array.from({ length: 10 }, (_, cause) => `Cause ${category}.${cause}`)]).flat()]
    case 'block120': return range('Component ', 120)
  }
}

/** Independent BigInt FNV reference, outside measurement; production uses
 * 32-bit halves. Hash the actual secured SVG's JSON string, as receipts specify. */
function svgDigest(svg: string): string {
  const text = JSON.stringify(svg)
  let hash = 0xcbf29ce484222325n
  for (let index = 0; index < text.length; index++) hash = BigInt.asUintN(64, (hash ^ BigInt(text.charCodeAt(index))) * 0x100000001b3n)
  return `fnv1a64:${hash.toString(16).padStart(16, '0')}`
}

async function receiptConsumer(expected: RenderedSvg, workload: Workload) {
  const { Resvg } = await import('@resvg/resvg-js')
  // resvg parses real XML, rather than trusting the benchmark's SVG prefix.
  new Resvg(expected.svg, { font: { loadSystemFonts: false } })
  const visible = new Set<string>()
  for (const tag of ['text', 'tspan']) {
    for (const [, inner] of expected.svg.matchAll(new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'g'))) {
      visible.add(decodeXML(inner!.replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim())
    }
  }
  // Tiny Treemap cells retain their exact authored label and quantity in a
  // native title instead of painting text that cannot fit. Other labels must
  // still be painted; a tooltip cannot stand in for missing visible text.
  const accessible = new Set([...expected.svg.matchAll(/<title\b[^>]*>([\s\S]*?)<\/title>/g)]
    .map(([, inner]) => decodeXML(inner!).trim()))
  const missing = receiptLabels(workload).filter(label => typeof label === 'string'
    ? !visible.has(label)
    : !visible.has(label.visible) && !accessible.has(label.accessible))
    .map(label => typeof label === 'string' ? label : label.visible)
  if (missing.length) throw new Error(`receipt SVG lost literal labels: ${missing.join(', ')}`)
  const digest = svgDigest(expected.svg)
  if (expected.receipt.output !== 'svg' || expected.receipt.graphicalProjectionDigest !== digest || expected.receipt.layoutCertification?.outputDigest !== digest) {
    throw new Error('receipt is not bound to the actual secured SVG')
  }
  const serialized = JSON.stringify(expected)
  return {
    consume(value: unknown): void {
      // Consume every SVG byte and every receipt field after each timed batch.
      if (JSON.stringify(value) !== serialized) throw new Error('SVG or complete bound receipt changed after the public reference render')
    },
    captureBatchSize: Math.max(1, Math.min(64, Math.floor(1024 * 1024 / serialized.length))),
    evidence: {
      svgSha256: createHash('sha256').update(expected.svg).digest('hex'),
      svgBytes: Buffer.byteLength(expected.svg),
      receipt: expected.receipt,
      validation: 'all returns: complete public artifact equality; reference: resvg XML, literal text/tspan labels, independent BigInt output digest',
      limitations: 'diagnostic source-runtime case; equality to the public API is a recipe/determinism oracle, not independent geometry/security proof; timed capture stores/clocks included, validation and capture-array allocation excluded',
    },
  }
}

function receiptCase(workload: Workload, postLayout: boolean): MicroCase {
  return {
    id: postLayout ? `scene:post-layout-secured-receipt-${workload}` : `render:svg-receipt-${workload}`,
    description: postLayout
      ? `Equivalent positioned input through fresh lowering/admission, paint certification, secured SVG and bound receipt, ${workload}`
      : `Public renderMermaidSVGWithReceipt, complete artifact consumed outside timing, ${workload}`,
    async setup() {
      const { renderMermaidSVGWithReceipt } = await src.index()
      const expected = renderMermaidSVGWithReceipt(MICRO_WORKLOADS[workload])
      const consumer = await receiptConsumer(expected, workload)
      if (!postLayout) return { call: () => renderMermaidSVGWithReceipt(MICRO_WORKLOADS[workload]), input: MICRO_WORKLOADS[workload], ...consumer }
      const [{ resolveRenderRequest, resolvedRenderExecutionPlanOf, receiptOf }, { positionResolvedFamily }, { renderPositionedMermaidSVG, renderedSvgDigest }, { withSvgInspectionCache }] = await Promise.all([src.contract(), src.positioning(), src.graphical(), src.inspection()])
      let request = resolveRenderRequest(MICRO_WORKLOADS[workload], {}, 'svg')
      const layout = positionResolvedFamily(resolvedRenderExecutionPlanOf(request).family.id, request)
      return {
        input: inputText({ positioned: layout.positioned, options: request.renderOptions, appearance: request.appearance }),
        ...consumer,
        captureBatchSize: 1,
        evidence: { ...consumer.evidence, inputPreparation: 'fresh equivalent resolved request before every call, outside clock/GCProfiler; original positioned wrapper retains its final geometry projection; layout generation excluded' },
        beforeCall: () => { request = resolveRenderRequest(MICRO_WORKLOADS[workload], {}, 'svg') },
        call: () => withSvgInspectionCache(() => {
          const diagnostics: OutputSecurityDiagnostic[] = []
          // Fresh requests defeat Scene/certification reuse without losing the
          // original layout wrapper's private final geometry projection.
          const rendered = renderPositionedMermaidSVG(request, layout, diagnostics)
          const receipt = receiptOf(request, diagnostics)
          const outputDigest = renderedSvgDigest(rendered.svg)
          return Object.freeze({
            svg: rendered.svg,
            receipt: Object.freeze({
              ...receipt,
              graphicalProjectionDigest: outputDigest,
              executionDecision: rendered.executionDecision,
              ...(rendered.layoutCertification ? { layoutCertification: Object.freeze({ ...rendered.layoutCertification, outputDigest }) } : {}),
            }),
          })
        }),
      }
    },
  }
}

function cleanupCases(): MicroCase[] {
  return [
    ...([['plain-flow5', MICRO_WORKLOADS.flow5], ['wrapped-entities-flow50', WRAPPED_ENTITY_FLOW50]] as const).map(([name, source]): MicroCase => ({
      id: `cleanup:normalize-${name}`,
      description: `normalizeMermaidSource on ${name}, exact authored source`,
      async setup() {
        const { normalizeMermaidSource } = await src.source()
        return () => normalizeMermaidSource(source)
      },
      check: value => (value as { firstLine?: string }).firstLine === 'flowchart td',
    })),
    ...([['entities-flow50', ENTITY_FLOW50, 'flowchart'], ['entities-seq20', ENTITY_SEQUENCE20, 'sequence']] as const).map(([name, source, kind]): MicroCase => ({
      id: `cleanup:registered-${name}`,
      description: `parseRegisteredMermaid on ${name}, exact authored source`,
      async setup() {
        const { parseRegisteredMermaid } = await src.agent()
        return () => parseRegisteredMermaid(source)
      },
      check: value => {
        const parsed = value as { ok?: boolean; value?: { body?: { kind?: string } } }
        return parsed.ok === true && parsed.value?.body?.kind === kind
      },
    })),
    {
      id: 'cleanup:resolve-wrapped-entities-flow50',
      description: 'resolveRenderRequest on wrapped-entities-flow50, exact authored source',
      async setup() {
        await src.index()
        const { resolveRenderRequest } = await src.contract()
        return () => resolveRenderRequest(WRAPPED_ENTITY_FLOW50, {}, 'svg')
      },
      check: value => value !== undefined && value !== null,
    },
  ]
}

/** The staged SVG pipeline, run once outside timing: request → positioned
 * layout → admitted Scene → backend SVG → public final SVG. */
async function staged(workload: Workload) {
  await src.index()
  const [{ resolveRenderRequest, resolvedRenderExecutionPlanOf }, { positionResolvedFamily }, { lowerPositionedFamilyScene }, { renderMermaidSVG }] = await Promise.all([src.contract(), src.positioning(), src.graphical(), src.index()])
  const source = MICRO_WORKLOADS[workload]
  const request = resolveRenderRequest(source, {}, 'svg')
  const plan = resolvedRenderExecutionPlanOf(request)
  const layout = positionResolvedFamily(plan.family.id, request)
  const scene = lowerPositionedFamilyScene(request, layout)
  const backend = plan.backend?.backend
  if (!backend) throw new Error(`${workload} has no Scene backend`)
  return { source, request, plan, layout, scene, backend, rawSvg: backend.render(scene, { seed: 0 }), finalSvg: renderMermaidSVG(source) }
}

async function flowchartGraph(workload: Workload) {
  const { parseMermaid } = await src.parser()
  return parseMermaid(MICRO_WORKLOADS[workload])
}

function renderCase(workload: Workload): MicroCase {
  return {
    id: `render:svg-${workload}`,
    description: `Public renderMermaidSVG, warm, ${workload}`,
    async setup() {
      const { renderMermaidSVG } = await src.index()
      return { call: () => renderMermaidSVG(MICRO_WORKLOADS[workload]), input: MICRO_WORKLOADS[workload] }
    },
    check: isSvg,
  }
}

function asciiCase(workload: Workload): MicroCase {
  return {
    id: `render:ascii-${workload}`,
    description: `Public renderMermaidASCII, warm, ${workload}`,
    async setup() {
      const { renderMermaidASCII } = await src.index()
      // Explicit, so a TTY on the child's stdout cannot switch on ANSI colour.
      return { call: () => renderMermaidASCII(MICRO_WORKLOADS[workload], { colorMode: 'none' }), input: MICRO_WORKLOADS[workload] }
    },
    check: nonEmptyString,
  }
}

/** Include final string consumption and receipt hashing in the timed call.
 * These supplement text-only calls so lazy materialization is never mistaken
 * for a reduction in the cost of a fully consumed artifact. */
function consumedSvgCase(workload: Workload): MicroCase {
  return {
    id: `render:svg-utf8-${workload}`,
    description: `Public SVG fully UTF-8 consumed, without consuming the receipt, ${workload}`,
    async setup() {
      const { renderMermaidSVG } = await src.index()
      const encoder = new TextEncoder()
      return { call: () => encoder.encode(renderMermaidSVG(MICRO_WORKLOADS[workload])), input: MICRO_WORKLOADS[workload] }
    },
    check: result => result instanceof Uint8Array && result.length > 0,
  }
}

function consumedCase(workload: Workload, output: 'svg' | 'ascii'): MicroCase {
  return {
    id: `render:${output}-consumed-${workload}`,
    description: `Public ${output}, receipt serialized and output UTF-8 encoded, ${workload}`,
    async setup() {
      const api = await src.index()
      const encode = new TextEncoder()
      return {
        call: () => {
          const result = output === 'svg' ? api.renderMermaidSVGWithReceipt(MICRO_WORKLOADS[workload]) : api.renderMermaidASCIIWithReceipt(MICRO_WORKLOADS[workload], { colorMode: 'none' })
          const text = 'svg' in result ? result.svg : result.text
          return { bytes: encode.encode(text), receipt: JSON.stringify(result.receipt) }
        },
        input: MICRO_WORKLOADS[workload],
      }
    },
    check: result => {
      const value = result as { bytes?: Uint8Array; receipt?: string }
      return (value.bytes?.length ?? 0) > 0 && (value.receipt?.includes('requestDigest') ?? false)
    },
  }
}

function parseCase(workload: Workload, kind: string): MicroCase {
  return {
    id: `parse:registered-${workload}`,
    description: `parseRegisteredMermaid (typed agent body), ${workload}`,
    async setup() {
      const { parseRegisteredMermaid } = await src.agent()
      return { call: () => parseRegisteredMermaid(MICRO_WORKLOADS[workload]), input: MICRO_WORKLOADS[workload] }
    },
    // A degraded parse (opaque or preserved body) also returns ok, much faster.
    check: result => {
      const parsed = result as { ok?: boolean; value?: { body?: { kind?: string } } }
      return parsed.ok === true && parsed.value?.body?.kind === kind
    },
  }
}

function positionCase(workload: Workload): MicroCase {
  return {
    id: `layout:position-${workload}`,
    description: `positionResolvedFamily: family layout plus final certification, ${workload}`,
    async setup() {
      const { request, plan } = await staged(workload)
      const { positionResolvedFamily } = await src.positioning()
      return { call: () => positionResolvedFamily(plan.family.id, request), input: inputText(request) }
    },
  }
}

function projectionCase(workload: Workload): MicroCase {
  return {
    id: `layout:project-${workload}`,
    description: `Family positioned projection on retained geometry, ${workload}`,
    async setup() {
      const { plan, layout } = await staged(workload)
      return { call: () => plan.family.projectPositioned!({ positioned: layout.positioned, options: {} }), input: inputText(layout.positioned) }
    },
  }
}

function sceneCases(workload: Workload): MicroCase[] {
  return [
    {
      id: `scene:lower-admit-${workload}`,
      description: `lowerPositionedFamilyScene: family lowering plus admission (snapshot + validation), ${workload}`,
      async setup() {
        const { request, layout } = await staged(workload)
        const { lowerPositionedFamilyScene } = await src.graphical()
        // Lowering is retained per layout object; a fresh wrapper around the
        // same positioned geometry measures the work instead of a cache hit.
        return { call: () => lowerPositionedFamilyScene(request, { ...layout }), input: inputText(layout.positioned) }
      },
    },
    {
      id: `scene:paint-certify-${workload}`,
      description: `certifyScenePaint: final paint certification run by every default SVG render, ${workload}`,
      async setup() {
        const { scene, layout } = await staged(workload)
        const [{ certifyScenePaint }, { retainedFamilyProjection }] = await Promise.all([src.paintCertification(), src.positioning()])
        return { call: () => certifyScenePaint(scene, retainedFamilyProjection(layout), { outputSupported: true }), input: inputText(scene) }
      },
    },
    {
      id: `scene:snapshot-${workload}`,
      description: `snapshotBoundedExternalData on a lowered Scene, the path external Scenes take, ${workload}`,
      async setup() {
        const { scene } = await staged(workload)
        const { snapshotBoundedExternalData, EXTERNAL_SCENE_DOCUMENT_SNAPSHOT_LIMITS } = await src.snapshot()
        return { call: () => snapshotBoundedExternalData(scene, EXTERNAL_SCENE_DOCUMENT_SNAPSHOT_LIMITS, 'scene'), input: inputText(scene) }
      },
    },
    {
      id: `scene:validate-${workload}`,
      description: `assertValidSceneDoc (internal mode) on a lowered Scene, ${workload}`,
      async setup() {
        const { scene } = await staged(workload)
        const { assertValidSceneDoc } = await src.validation()
        return { call: () => assertValidSceneDoc(scene, { mode: 'internal' }), input: inputText(scene) }
      },
    },
    {
      id: `scene:backend-render-${workload}`,
      description: `Default backend render: serializes admitted typed Scene marks, ${workload}`,
      async setup() {
        const { scene, backend } = await staged(workload)
        return { call: () => backend.render(scene, { seed: 0 }), input: inputText(scene) }
      },
      check: isSvg,
    },
  ]
}

function svgPassCases(workload: Workload): MicroCase[] {
  type Stage = Awaited<ReturnType<typeof staged>>
  const pass = (name: string, description: string, svg: 'rawSvg' | 'finalSvg', make: (stage: Stage) => Promise<() => unknown>): MicroCase => ({
    id: `svg:${name}-${workload}`,
    description: `${description}, ${workload}`,
    async setup() {
      const stage = await staged(workload)
      return { call: await make(stage), input: stage[svg] }
    },
  })
  return [
    pass('inline-colors', 'inlineResolvedColors over backend SVG', 'rawSvg', async ({ rawSvg, request }) => {
      const { inlineResolvedColors } = await src.theme()
      return () => inlineResolvedColors(rawSvg, request.appearance.colors)
    }),
    pass('fit-text', 'fitUncalibratedSvgText over backend SVG', 'rawSvg', async ({ rawSvg, request }) => {
      const { fitUncalibratedSvgText } = await src.fontGeometry()
      return () => fitUncalibratedSvgText(rawSvg, request.appearance.font)
    }),
    pass('scope-styles', 'scopeSvgStyles over backend SVG', 'rawSvg', async ({ rawSvg }) => {
      const { scopeSvgStyles } = await src.styleScope()
      return () => scopeSvgStyles(rawSvg)
    }),
    pass('security', 'applyOutputSecurityPolicy (default) over final SVG', 'finalSvg', async ({ finalSvg }) => {
      const { applyOutputSecurityPolicy } = await src.security()
      return () => applyOutputSecurityPolicy(finalSvg, 'default')
    }),
    pass('scan-tags', 'scanSvgStartTags over final SVG', 'finalSvg', async ({ finalSvg }) => {
      const { scanSvgStartTags } = await src.structure()
      return () => scanSvgStartTags(finalSvg)
    }),
    pass('byte-budget', 'assertFinalSvgByteBudget (run once per post-pass) over final SVG', 'finalSvg', async ({ finalSvg }) => {
      const { assertFinalSvgByteBudget } = await src.validation()
      return () => assertFinalSvgByteBudget(finalSvg)
    }),
  ]
}

export function microCases(): readonly MicroCase[] {
  return [
    ...cleanupCases(),
    {
      id: 'text:graphemes-ascii',
      description: 'graphemes() on a 38-character ASCII label (printable-ASCII fast path)',
      async setup() {
        const { graphemes } = await src.graphemes()
        return () => graphemes(ASCII_LABEL)
      },
    },
    {
      id: 'text:graphemes-mixed',
      description: 'graphemes() on a CJK/emoji/combining-mark label',
      async setup() {
        const { graphemes } = await src.graphemes()
        return () => graphemes(MIXED_LABEL)
      },
    },
    {
      id: 'text:prepare-display-formatted',
      description: 'prepareDisplayText on a formatted ASCII label (per-cluster records)',
      async setup() {
        const { prepareDisplayText } = await src.displayText()
        return () => prepareDisplayText('**Bold** and <i>italic</i> label text here', 'formatted')
      },
    },
    {
      id: 'text:measure-width',
      description: 'measureTextWidth on an ASCII label',
      async setup() {
        const { measureTextWidth } = await src.textMetrics()
        return () => measureTextWidth(ASCII_LABEL, 16, 500)
      },
    },
    ...[false, true].map(churn => ({
      id: `text:wrap-ascii-${churn ? 'churn' : 'repeat'}`,
      description: `Prepared pixel wrapping with ${churn ? '1024 rotating keys, beyond cache capacity' : 'one repeated key'}`,
      async setup() {
        const { preparePixelText } = await src.preparedText()
        let counter = 0
        const label = 'Authenticate the incoming user request and preserve all source spans. '.repeat(20)
        return () => preparePixelText(`${String(churn ? counter++ % 1024 : 0).padStart(4, '0')} ${label}`, { fontSize: 16, fontWeight: 500, maxWidth: 240 })
      },
      check: (result: unknown) => (result as { lines?: string[] }).lines!.length > 10,
    })),
    {
      id: 'parse:flowchart-graph-tree50',
      description: 'parseMermaid → MermaidGraph (render-side parser), tree50',
      async setup() {
        const { parseMermaid } = await src.parser()
        return () => parseMermaid(MICRO_WORKLOADS.tree50)
      },
    },
    parseCase('tree50', 'flowchart'),
    parseCase('seq20', 'sequence'),
    parseCase('class80', 'class'),
    ...[128, 1024].flatMap(count => [false, true].map(reverse => ({
      id: `layout:model-order-${reverse ? 'reverse' : 'forward'}-${count}`,
      description: `Convert a ${count}-node sparse chain with ${reverse ? 'reverse-authored' : 'forward'} constraints, without ELK`,
      async setup() {
        const [{ parseMermaid }, { convertToElkFormat }] = await Promise.all([src.parser(), src.layoutEngine()])
        const ids = Array.from({ length: count }, (_, i) => `n${i}`)
        const edges = Array.from({ length: count - 1 }, (_, i) => reverse ? `n${count - 1 - i} --> n${count - 2 - i}` : `n${i} --> n${i + 1}`)
        const graph = parseMermaid(['flowchart TD', ...ids, ...edges].join('\n'))
        return () => convertToElkFormat(graph)
      },
      check: (result: unknown) => (result as { children?: unknown[] }).children?.length === count,
    }))),
    {
      id: 'gantt:calendar-weekends-long',
      description: 'Resolve 100 independent 5000-working-day tasks with weekend exclusions and the unchanged walk budget',
      async setup() {
        const [{ parseGanttModel }, { resolveGanttSchedule }] = await Promise.all([src.ganttParser(), src.ganttSchedule()])
        const source = ['gantt', 'dateFormat YYYY-MM-DD', 'excludes weekends', ...Array.from({ length: 100 }, (_, i) => `Task ${i} :t${i}, 2010-01-01, 5000d`)].join('\n')
        const model = parseGanttModel(source.split('\n'))
        return { call: () => resolveGanttSchedule(model), input: inputText(model) }
      },
      check: (result: unknown) => (result as { tasks?: unknown[] }).tasks?.length === 100,
    },
    {
      id: 'request:resolve-flow5',
      description: 'resolveRenderRequest: source, option admission, appearance and digests, flow5',
      async setup() {
        await src.index()
        const { resolveRenderRequest } = await src.contract()
        return () => resolveRenderRequest(MICRO_WORKLOADS.flow5, {}, 'svg')
      },
    },
    ...(['flow5', 'tree50', 'mesh50'] as const).map(
      (workload): MicroCase => ({
        id: `layout:elk-${workload}`,
        description: `convertToElkFormat + elkLayoutSync (ELK alone, our options), ${workload}`,
        async setup() {
          const graph = await flowchartGraph(workload)
          const [{ convertToElkFormat }, { elkLayoutSync }] = await Promise.all([src.layoutEngine(), src.elk()])
          return { call: () => elkLayoutSync(convertToElkFormat(graph)), input: inputText(convertToElkFormat(graph)) }
        },
      }),
    ),
    ...(['tree50', 'mesh50'] as const).map(
      (workload): MicroCase => ({
        id: `layout:graph-${workload}`,
        description: `layoutGraphSync: ELK, passes, route contracts and candidate certification, ${workload}`,
        async setup() {
          const graph = await flowchartGraph(workload)
          const { layoutGraphSync } = await src.layoutEngine()
          return { call: () => layoutGraphSync(graph), input: inputText(graph) }
        },
      }),
    ),
    {
      id: 'layout:rubric-mesh50',
      description: 'assessLayout (layout rubric) on a positioned mesh50',
      async setup() {
        const graph = await flowchartGraph('mesh50')
        const [{ layoutGraphSync }, { assessLayout }] = await Promise.all([src.layoutEngine(), src.rubric()])
        const positioned = layoutGraphSync(graph)
        return { call: () => assessLayout(graph, positioned), input: inputText(positioned) }
      },
    },
    {
      id: 'layout:route-audit-mesh50',
      description: 'auditRouteContracts on a positioned mesh50',
      async setup() {
        const graph = await flowchartGraph('mesh50')
        const [{ layoutGraphSync }, { auditRouteContracts }] = await Promise.all([src.layoutEngine(), src.routes()])
        const positioned = layoutGraphSync(graph)
        return { call: () => auditRouteContracts(positioned, graph), input: inputText(positioned) }
      },
    },
    positionCase('seq20'),
    positionCase('class80'),
    positionCase('er40'),
    ...Object.entries(STABLE_WORKLOADS).flatMap(([workload, kind]) => [parseCase(workload as Workload, kind), positionCase(workload as Workload), projectionCase(workload as Workload), ...sceneCases(workload as Workload), asciiCase(workload as Workload), consumedCase(workload as Workload, 'ascii')]),
    ...sceneCases('seq20'),
    ...sceneCases('class80'),
    ...svgPassCases('class80'),
    ...(Object.keys(MICRO_WORKLOADS) as Workload[]).map(renderCase),
    ...(Object.keys(MICRO_WORKLOADS) as Workload[]).map(consumedSvgCase),
    ...(Object.keys(MICRO_WORKLOADS) as Workload[]).flatMap(workload => [receiptCase(workload, false), receiptCase(workload, true)]),
    ...(['hand-drawn', 'watercolor'] as const).map((style): MicroCase => ({
      id: `render:svg-flow5-${style}`,
      description: `Public renderMermaidSVG, warm, flow5, ${style}, seed 7, strict security`,
      async setup() {
        const { renderMermaidSVG } = await src.index()
        const options = { style, seed: 7, security: 'strict' as const }
        return () => renderMermaidSVG(MICRO_WORKLOADS.flow5, options)
      },
      check: isSvg,
    })),
    // Source-runtime API cost, including rasterization. V8 allocation estimates
    // omit resvg's native raster heap; packed PNG parity has a separate keeper.
    ...(['flow5', 'seq20'] as const).map((workload): MicroCase => ({
      id: `render:png-${workload}`,
      description: `Public renderMermaidPNG, warm, ${workload}, scale 1, seed 7, strict security`,
      async setup() {
        const { renderMermaidPNG } = await src.agent()
        const options = { scale: 1, seed: 7, security: 'strict' as const }
        return () => renderMermaidPNG(MICRO_WORKLOADS[workload], options)
      },
      check: isPng,
    })),
    ...(Object.keys(MICRO_WORKLOADS) as Workload[]).map(workload => consumedCase(workload, 'svg')),
    asciiCase('flow5'),
    asciiCase('mesh50'),
    asciiCase('seq20'),
    asciiCase('class80'),
    asciiCase('er40'),
    asciiCase('state80'),
    consumedCase('seq20', 'ascii'),
    consumedCase('class80', 'ascii'),
    {
      id: 'agent:verify-tree50',
      description: 'verifyMermaid on a parsed tree50',
      async setup() {
        const { parseRegisteredMermaid, verifyMermaid } = await src.agent()
        const parsed = parseRegisteredMermaid(MICRO_WORKLOADS.tree50)
        if (!parsed.ok) throw new Error('tree50 did not parse')
        return { call: () => verifyMermaid(parsed.value), input: inputText(parsed.value) }
      },
    },
    {
      id: 'agent:serialize-class80',
      description: 'serializeMermaid on a parsed class80',
      async setup() {
        const { parseRegisteredMermaid, serializeMermaid } = await src.agent()
        const parsed = parseRegisteredMermaid(MICRO_WORKLOADS.class80)
        if (!parsed.ok) throw new Error('class80 did not parse')
        return { call: () => serializeMermaid(parsed.value), input: inputText(parsed.value) }
      },
      check: nonEmptyString,
    },
    {
      id: 'agent:edit-loop',
      description: 'parse → mutate → verify → serialize → re-parse → check → render (release benchmark agent workload)',
      async setup() {
        const [api, { renderAgentEdit, agentEditCase }] = await Promise.all([src.agent(), import('./release-bench-fidelity.ts')])
        return () => renderAgentEdit(api, agentEditCase.source)
      },
      check: isSvg,
    },
    {
      id: 'startup:backend-conformance',
      description: 'runBackendConformance over every built-in backend (runs at module import)',
      async setup() {
        const [{ runBackendConformance }, { BUILTIN_BACKENDS }] = await Promise.all([src.conformance(), src.builtinBackends()])
        return () => BUILTIN_BACKENDS.map(backend => runBackendConformance(backend))
      },
    },
  ]
}
