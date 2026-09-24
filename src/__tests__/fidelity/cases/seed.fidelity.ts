import { parseRegisteredMermaid, renderMermaidSVG, serializeMermaid, verifyMermaid } from '../../../agent/index.ts'
import { parseMermaid } from '../../../parser.ts'
import type { FidelityCaseDefinition, FidelityObservations, ObservedFidelitySurface } from '../contract.ts'

const UPSTREAM_REVISION = 'f3dea58385fd5c7dd1f4e9c9c1876751ae6943cc'

function fail(message: string): never {
  throw new Error(message)
}

function requireObserved(observations: FidelityObservations, surface: keyof FidelityObservations): ObservedFidelitySurface {
  const observation = observations[surface]
  if (!observation) fail(`${surface}: missing observation`)
  if (observation.status !== 'observed') fail(`${surface}: blocked by ${observation.blockedBy}`)
  return observation
}

function parsedOrThrow(source: string) {
  const parsed = parseRegisteredMermaid(source)
  if (!parsed.ok) fail(`agent parse failed: ${parsed.error.map(error => error.code).join(', ')}`)
  return parsed.value
}

const stateTrailingCommentSource = ['stateDiagram-v2', '  A --> B %% legal trailing comment', '  B --> C'].join('\n')

const stateTrailingComment: FidelityCaseDefinition = {
  id: 'state.comments.trailing-transition-loss',
  family: 'state',
  featureId: 'official-doc:state:section:comments',
  source: stateTrailingCommentSource,
  upstreamReference: 'https://mermaid.ai/open-source/syntax/stateDiagram.html#comments',
  upstreamRevision: UPSTREAM_REVISION,
  expected: {
    agent: 'source-preserved',
    render: 'absent',
    serialize: 'source-preserved',
  },
  expectedDiagnostics: [{ surface: 'agent', code: 'UNSUPPORTED_SYNTAX' }],
  observe: () => {
    const parsed = parsedOrThrow(stateTrailingCommentSource)
    const verification = verifyMermaid(parsed)
    const renderedGraph = parseMermaid(stateTrailingCommentSource)
    const renderedEdges = renderedGraph.edges.map(edge => `${edge.source}->${edge.target}`)
    const serialized = serializeMermaid(parsed).trimEnd()
    return {
      agent: {
        status: 'observed',
        disposition: parsed.body.kind === 'opaque' ? 'source-preserved' : 'native',
        diagnosticCodes: verification.warnings.map(warning => warning.code).filter(code => code === 'UNSUPPORTED_SYNTAX'),
        semantics: { bodyKind: parsed.body.kind },
      },
      render: {
        status: 'observed',
        disposition: renderedEdges.includes('A->B') && renderedEdges.includes('B->C') ? 'native' : 'absent',
        diagnosticCodes: [],
        semantics: { renderedEdges },
      },
      serialize: {
        status: 'observed',
        disposition: serialized === stateTrailingCommentSource ? 'source-preserved' : 'absent',
        diagnosticCodes: [],
        semantics: { bytePreserved: serialized === stateTrailingCommentSource },
      },
    }
  },
  assertSemantics: observations => {
    const render = requireObserved(observations, 'render')
    const renderedEdges = (render.semantics as { renderedEdges?: unknown }).renderedEdges
    if (JSON.stringify(renderedEdges) !== JSON.stringify(['B->C'])) {
      fail(`state render receipt expected only B->C, got ${JSON.stringify(renderedEdges)}`)
    }
    const serialize = requireObserved(observations, 'serialize')
    if ((serialize.semantics as { bytePreserved?: unknown }).bytePreserved !== true) {
      fail('state source was not preserved byte-for-byte')
    }
  },
}

const journeyFractionalScoreSource = ['journey', '  Task: 3.5: Me'].join('\n')

const journeyFractionalScore: FidelityCaseDefinition = {
  id: 'journey.scores.fractional-parser-render-seam',
  family: 'journey',
  featureId: 'official-doc:journey:section:user-journey-diagram',
  source: journeyFractionalScoreSource,
  upstreamReference: 'https://mermaid.ai/open-source/syntax/userJourney.html',
  upstreamRevision: UPSTREAM_REVISION,
  expected: {
    agent: 'source-preserved',
    render: 'diagnosed',
    serialize: 'source-preserved',
  },
  expectedDiagnostics: [
    { surface: 'agent', code: 'UNSUPPORTED_SYNTAX' },
    { surface: 'render', code: 'RENDER_FAILED' },
  ],
  observe: () => {
    const parsed = parsedOrThrow(journeyFractionalScoreSource)
    const verification = verifyMermaid(parsed)
    let renderError = ''
    try {
      renderMermaidSVG(journeyFractionalScoreSource)
    } catch (error) {
      renderError = error instanceof Error ? error.message : String(error)
    }
    const serialized = serializeMermaid(parsed).trimEnd()
    return {
      agent: {
        status: 'observed',
        disposition: parsed.body.kind === 'opaque' ? 'source-preserved' : 'native',
        diagnosticCodes: verification.warnings.map(warning => warning.code).filter(code => code === 'UNSUPPORTED_SYNTAX'),
        semantics: { bodyKind: parsed.body.kind },
      },
      render: {
        status: 'observed',
        disposition: renderError && verification.warnings.some(warning => warning.code === 'RENDER_FAILED') ? 'diagnosed' : renderError ? 'absent' : 'native',
        diagnosticCodes: verification.warnings.map(warning => warning.code).filter(code => code === 'RENDER_FAILED'),
        semantics: { rejectedFractionalScore: renderError.includes('invalid score 3.5') },
      },
      serialize: {
        status: 'observed',
        disposition: serialized === journeyFractionalScoreSource ? 'source-preserved' : 'absent',
        diagnosticCodes: [],
        semantics: { bytePreserved: serialized === journeyFractionalScoreSource },
      },
    }
  },
  assertSemantics: observations => {
    const render = requireObserved(observations, 'render')
    if ((render.semantics as { rejectedFractionalScore?: unknown }).rejectedFractionalScore !== true) {
      fail('journey render did not specifically reject the fractional 3.5 score')
    }
  },
}

const flowchartEdgeClassSource = ['flowchart LR', '  A e1@--> B', '  classDef hot stroke:#ff0000,stroke-width:6px', '  class e1 hot'].join('\n')

const flowchartEdgeClass: FidelityCaseDefinition = {
  id: 'flowchart.classes.edge-paint-implication',
  family: 'flowchart',
  featureId: 'official-doc:flowchart:section:using-classdef-statements-for-animations',
  source: flowchartEdgeClassSource,
  upstreamReference: 'https://mermaid.ai/open-source/syntax/flowchart.html#using-classdef-statements-for-animations',
  upstreamRevision: UPSTREAM_REVISION,
  expected: {
    agent: 'native',
    render: 'absent',
    serialize: 'native',
  },
  observe: () => {
    const parsed = parsedOrThrow(flowchartEdgeClassSource)
    const svg = renderMermaidSVG(flowchartEdgeClassSource)
    const edgeTag = svg.match(/<polyline\b[^>]*data-id="e1"[^>]*>/)?.[0] ?? ''
    const semanticPaint = {
      edgeFound: edgeTag.length > 0,
      stroke: edgeTag.match(/\bstroke="([^"]+)"/)?.[1] ?? null,
      strokeWidth: edgeTag.match(/\bstroke-width="([^"]+)"/)?.[1] ?? null,
    }
    const serialized = serializeMermaid(parsed).trimEnd()
    return {
      agent: {
        status: 'observed',
        disposition: parsed.body.kind === 'flowchart' ? 'native' : 'source-preserved',
        diagnosticCodes: [],
        semantics: { bodyKind: parsed.body.kind },
      },
      render: {
        status: 'observed',
        disposition: semanticPaint.stroke === '#ff0000' && semanticPaint.strokeWidth === '6' ? 'native' : 'absent',
        diagnosticCodes: [],
        semantics: semanticPaint,
      },
      serialize: {
        status: 'observed',
        disposition: serialized === flowchartEdgeClassSource ? 'native' : 'absent',
        diagnosticCodes: [],
        semantics: { canonicalSourcePreserved: serialized === flowchartEdgeClassSource },
      },
    }
  },
  assertSemantics: observations => {
    const render = requireObserved(observations, 'render')
    const paint = render.semantics as { edgeFound?: unknown; stroke?: unknown; strokeWidth?: unknown }
    if (paint.edgeFound !== true || paint.stroke !== '#939395' || paint.strokeWidth !== '1') {
      fail(`flowchart edge paint receipt changed: ${JSON.stringify(paint)}`)
    }
  },
}

const unsupportedBlockSource = ['block-beta', '  columns 1', '  A'].join('\n')

const unsupportedBlock: FidelityCaseDefinition = {
  id: 'block.family.accurately-diagnosed-unsupported',
  family: 'block',
  featureId: 'official-doc:block:section:basic-structure',
  source: unsupportedBlockSource,
  upstreamReference: 'https://mermaid.ai/open-source/syntax/block.html#basic-structure',
  upstreamRevision: UPSTREAM_REVISION,
  expected: {
    agent: 'diagnosed',
    render: 'diagnosed',
    serialize: 'source-preserved',
  },
  expectedDiagnostics: [
    { surface: 'agent', code: 'UNSUPPORTED_FAMILY' },
    { surface: 'render', code: 'RENDER_FAILED' },
  ],
  observe: () => {
    const parsed = parsedOrThrow(unsupportedBlockSource)
    const verification = verifyMermaid(parsed)
    const diagnosticCode = parsed.body.kind === 'preserved' ? parsed.body.diagnostic.code : ''
    const serialized = serializeMermaid(parsed)
    return {
      agent: {
        status: 'observed',
        disposition: diagnosticCode === 'UNSUPPORTED_FAMILY' ? 'diagnosed' : 'absent',
        diagnosticCodes: diagnosticCode ? [diagnosticCode] : [],
        semantics: {
          bodyKind: parsed.body.kind,
          upstreamFamilyId: parsed.body.kind === 'preserved' ? (parsed.body.preservation.upstreamFamilyId ?? null) : null,
        },
      },
      render: {
        status: 'observed',
        disposition: verification.warnings.some(warning => warning.code === 'RENDER_FAILED') ? 'diagnosed' : 'absent',
        diagnosticCodes: verification.warnings.map(warning => warning.code).filter(code => code === 'RENDER_FAILED'),
        semantics: { verifyOk: verification.ok },
      },
      serialize: {
        status: 'observed',
        disposition: serialized === unsupportedBlockSource ? 'source-preserved' : 'absent',
        diagnosticCodes: [],
        semantics: { bytePreserved: serialized === unsupportedBlockSource },
      },
    }
  },
  assertSemantics: observations => {
    const agent = requireObserved(observations, 'agent')
    const semantics = agent.semantics as { bodyKind?: unknown; upstreamFamilyId?: unknown }
    if (semantics.bodyKind !== 'preserved' || semantics.upstreamFamilyId !== 'block') {
      fail(`block diagnostic lost upstream identity: ${JSON.stringify(semantics)}`)
    }
    const serialize = requireObserved(observations, 'serialize')
    if ((serialize.semantics as { bytePreserved?: unknown }).bytePreserved !== true) {
      fail('unsupported block source was not preserved byte-for-byte')
    }
  },
}

export const fidelityCases: readonly FidelityCaseDefinition[] = Object.freeze([stateTrailingComment, journeyFractionalScore, flowchartEdgeClass, unsupportedBlock])
