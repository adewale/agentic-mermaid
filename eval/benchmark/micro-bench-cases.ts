// Hotspot micro-benchmark cases for `eval/benchmark/micro-bench.ts`.
//
// Each case times one stage or hotspot that profiling of the warm SVG/ASCII
// pipeline identified (see the case descriptions). Setup runs outside the
// timed call. Every module is imported inside `setup`, never statically, so a
// case whose internal entry point does not exist at a baseline revision is
// reported as unavailable instead of preventing every other case from running.

import { flowchartMesh, flowchartTree, releaseBenchCases } from './release-bench-cases.ts'

/** A stage case's timed call and the input an earlier stage of the same
 * revision built for it. A revision comparison withholds the ratio when the
 * two sides were handed different inputs. */
export interface StagedCall {
  readonly call: () => unknown
  readonly input: string
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
} as const
type Workload = keyof typeof MICRO_WORKLOADS

const ASCII_LABEL = 'Authenticate the incoming user request'
const MIXED_LABEL = '東京 → 👩‍💻 café naïve Ελληνικά 한국어 👍🏽'
/** Plain-data text of a stage input, comparable across revisions. */
const inputText = (value: unknown) => JSON.stringify(value, (_key, item) => (item instanceof Map || item instanceof Set ? [...item] : item))
const isSvg = (value: unknown) => typeof value === 'string' && value.startsWith('<svg')
const nonEmptyString = (value: unknown) => typeof value === 'string' && value.length > 0

const src = {
  index: () => import('../../src/index.ts'),
  agent: () => import('../../src/agent/index.ts'),
  parser: () => import('../../src/parser.ts'),
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
  textMetrics: () => import('../../src/text-metrics.ts'),
  conformance: () => import('../../src/scene/backend-conformance.ts'),
  paintCertification: () => import('../../src/scene/paint-certification.ts'),
  builtinBackends: () => import('../../src/scene/builtin-backends.ts'),
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
      return () => renderMermaidSVG(MICRO_WORKLOADS[workload])
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
      return () => renderMermaidASCII(MICRO_WORKLOADS[workload], { colorMode: 'none' })
    },
    check: nonEmptyString,
  }
}

function parseCase(workload: Workload, kind: string): MicroCase {
  return {
    id: `parse:registered-${workload}`,
    description: `parseRegisteredMermaid (typed agent body), ${workload}`,
    async setup() {
      const { parseRegisteredMermaid } = await src.agent()
      return () => parseRegisteredMermaid(MICRO_WORKLOADS[workload])
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
      return () => positionResolvedFamily(plan.family.id, request)
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
      description: `snapshotBoundedExternalData on an internal lowered Scene, ${workload}`,
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
      description: `Default backend render: joins node SVG serialized during lowering (cheap by design), ${workload}`,
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
    {
      id: 'text:graphemes-ascii',
      description: 'graphemes() on a 38-character ASCII label (Intl.Segmenter)',
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
    ...sceneCases('seq20'),
    ...sceneCases('class80'),
    ...svgPassCases('class80'),
    ...(Object.keys(MICRO_WORKLOADS) as Workload[]).map(renderCase),
    asciiCase('flow5'),
    asciiCase('mesh50'),
    asciiCase('seq20'),
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
