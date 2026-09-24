import { MermaidFamilyDetectionError, parseRegisteredMermaid, renderMermaidSVG, serializeMermaid, verifyMermaid } from '../../../agent/index.ts'
import { parseMermaid } from '../../../parser.ts'
import type {
  ApplicableFidelitySurfaceExpectation,
  FidelityCaseDefinition,
  FidelityDisposition,
  FidelityJson,
  NotApplicableFidelitySurfaceExpectation,
  ObservedFidelitySurfaceEvidence,
} from '../contract.ts'

const UPSTREAM_REVISION = 'f3dea58385fd5c7dd1f4e9c9c1876751ae6943cc'

function fail(message: string): never {
  throw new Error(message)
}

function facts(evidence: ObservedFidelitySurfaceEvidence): Readonly<Record<string, FidelityJson>> {
  if (!evidence.semantics || typeof evidence.semantics !== 'object' || Array.isArray(evidence.semantics)) {
    fail('semantic evidence must be an object')
  }
  return evidence.semantics as Readonly<Record<string, FidelityJson>>
}

function applicable(
  disposition: FidelityDisposition,
  evaluate: ApplicableFidelitySurfaceExpectation['evaluate'],
  diagnosticCodes: readonly string[] = [],
): ApplicableFidelitySurfaceExpectation {
  return { applicability: 'applicable', disposition, diagnosticCodes, evaluate }
}

function notApplicable(rationale: string): NotApplicableFidelitySurfaceExpectation {
  return { applicability: 'not-applicable', rationale }
}

function parsedOrThrow(source: string) {
  const parsed = parseRegisteredMermaid(source)
  if (!parsed.ok) fail(`agent parse failed: ${parsed.error.map(error => error.code).join(', ')}`)
  return parsed.value
}

const stateTrailingCommentSource = `${['stateDiagram-v2', '  A --> B %% legal trailing comment', '  B --> C'].join('\n')}\n`

const stateTrailingComment: FidelityCaseDefinition = {
  id: 'state.comments.trailing-transition-loss',
  family: 'state',
  featureId: 'official-doc:state:section:comments',
  source: stateTrailingCommentSource,
  upstreamReference: 'https://mermaid.ai/open-source/syntax/stateDiagram.html#comments',
  upstreamRevision: UPSTREAM_REVISION,
  expected: {
    agent: applicable(
      'source-preserved',
      evidence => (facts(evidence).bodyKind === 'opaque' ? 'source-preserved' : 'native'),
      ['UNSUPPORTED_SYNTAX'],
    ),
    render: applicable('absent', evidence => {
      const renderedEdges = facts(evidence).renderedEdges
      if (!Array.isArray(renderedEdges) || renderedEdges.some(edge => typeof edge !== 'string')) fail('renderedEdges must be strings')
      return renderedEdges.includes('A->B') && renderedEdges.includes('B->C') ? 'native' : 'absent'
    }),
    serialize: applicable('source-preserved', evidence => (facts(evidence).exactBytes === true ? 'source-preserved' : 'absent')),
    mutate: notApplicable('This construct-loss seed has no mutation operation; mutation fidelity will be covered by operation-specific cases.'),
  },
  observe: () => {
    const parsed = parsedOrThrow(stateTrailingCommentSource)
    const verification = verifyMermaid(parsed)
    const renderedGraph = parseMermaid(stateTrailingCommentSource)
    const renderedEdges = renderedGraph.edges.map(edge => `${edge.source}->${edge.target}`)
    const serialized = serializeMermaid(parsed)
    return {
      agent: {
        status: 'observed',
        diagnosticCodes: verification.warnings.map(warning => warning.code).filter(code => code === 'UNSUPPORTED_SYNTAX'),
        semantics: { bodyKind: parsed.body.kind },
      },
      render: {
        status: 'observed',
        diagnosticCodes: [],
        semantics: { renderedEdges },
      },
      serialize: {
        status: 'observed',
        diagnosticCodes: [],
        semantics: { exactBytes: serialized === stateTrailingCommentSource },
      },
    }
  },
}

const journeyFractionalScoreSource = `${['journey', '  Task: 3.5: Me'].join('\n')}\n`

const journeyFractionalScore: FidelityCaseDefinition = {
  id: 'journey.scores.fractional-parser-render-seam',
  family: 'journey',
  featureId: 'official-doc:journey:section:user-journey-diagram',
  source: journeyFractionalScoreSource,
  upstreamReference: 'https://mermaid.ai/open-source/syntax/userJourney.html',
  upstreamRevision: UPSTREAM_REVISION,
  expected: {
    agent: applicable(
      'source-preserved',
      evidence => (facts(evidence).bodyKind === 'opaque' ? 'source-preserved' : 'native'),
      ['UNSUPPORTED_SYNTAX'],
    ),
    render: applicable(
      'diagnosed',
      evidence => {
        const semanticFacts = facts(evidence)
        return semanticFacts.rejectedFractionalScore === true && semanticFacts.verifierDiagnosedRenderFailure === true ? 'diagnosed' : 'absent'
      },
      ['RENDER_FAILED'],
    ),
    serialize: applicable('source-preserved', evidence => (facts(evidence).exactBytes === true ? 'source-preserved' : 'absent')),
    mutate: notApplicable('This parser/render seam has no valid structured task to target with a mutation operation.'),
  },
  observe: () => {
    const parsed = parsedOrThrow(journeyFractionalScoreSource)
    const verification = verifyMermaid(parsed)
    let renderError = ''
    try {
      renderMermaidSVG(journeyFractionalScoreSource)
    } catch (error) {
      renderError = error instanceof Error ? error.message : String(error)
    }
    const serialized = serializeMermaid(parsed)
    const verifierDiagnosedRenderFailure = verification.warnings.some(warning => warning.code === 'RENDER_FAILED')
    return {
      agent: {
        status: 'observed',
        diagnosticCodes: verification.warnings.map(warning => warning.code).filter(code => code === 'UNSUPPORTED_SYNTAX'),
        semantics: { bodyKind: parsed.body.kind },
      },
      render: {
        status: 'observed',
        diagnosticCodes: verifierDiagnosedRenderFailure ? ['RENDER_FAILED'] : [],
        semantics: {
          rejectedFractionalScore: renderError.includes('invalid score 3.5'),
          verifierDiagnosedRenderFailure,
        },
      },
      serialize: {
        status: 'observed',
        diagnosticCodes: [],
        semantics: { exactBytes: serialized === journeyFractionalScoreSource },
      },
    }
  },
}

const flowchartEdgeClassSource = `${['flowchart LR', '  A e1@--> B', '  classDef hot stroke:#ff0000,stroke-width:6px', '  class e1 hot'].join('\n')}\n`

const flowchartEdgeClass: FidelityCaseDefinition = {
  id: 'flowchart.classes.edge-paint-implication',
  family: 'flowchart',
  featureId: 'official-doc:flowchart:section:using-classdef-statements-for-animations',
  source: flowchartEdgeClassSource,
  upstreamReference: 'https://mermaid.ai/open-source/syntax/flowchart.html#using-classdef-statements-for-animations',
  upstreamRevision: UPSTREAM_REVISION,
  expected: {
    agent: applicable('native', evidence => (facts(evidence).bodyKind === 'flowchart' ? 'native' : 'source-preserved')),
    render: applicable('absent', evidence => {
      const semanticFacts = facts(evidence)
      if (typeof semanticFacts.edgeFound !== 'boolean') fail('edgeFound must be boolean')
      return semanticFacts.stroke === '#ff0000' && semanticFacts.strokeWidth === '6' ? 'native' : 'absent'
    }),
    serialize: applicable('native', evidence => (facts(evidence).exactCanonicalBytes === true ? 'native' : 'absent')),
    mutate: notApplicable('The seed isolates class-to-edge paint propagation; class mutation fidelity needs a dedicated operation case.'),
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
    const serialized = serializeMermaid(parsed)
    return {
      agent: {
        status: 'observed',
        diagnosticCodes: [],
        semantics: { bodyKind: parsed.body.kind },
      },
      render: {
        status: 'observed',
        diagnosticCodes: [],
        semantics: semanticPaint,
      },
      serialize: {
        status: 'observed',
        diagnosticCodes: [],
        semantics: { exactCanonicalBytes: serialized === flowchartEdgeClassSource },
      },
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
    agent: applicable(
      'diagnosed',
      evidence => {
        const semanticFacts = facts(evidence)
        return semanticFacts.bodyKind === 'preserved' && semanticFacts.upstreamFamilyId === 'block' ? 'diagnosed' : 'absent'
      },
      ['UNSUPPORTED_FAMILY'],
    ),
    render: applicable(
      'diagnosed',
      evidence => {
        const semanticFacts = facts(evidence)
        return semanticFacts.errorName === 'MermaidFamilyDetectionError' && semanticFacts.errorCode === 'UNSUPPORTED_FAMILY' && semanticFacts.upstreamFamilyId === 'block' ? 'diagnosed' : 'absent'
      },
      ['UNSUPPORTED_FAMILY'],
    ),
    serialize: applicable('source-preserved', evidence => (facts(evidence).exactBytes === true ? 'source-preserved' : 'absent')),
    mutate: notApplicable('Unsupported families expose no structured mutation target by design.'),
  },
  observe: () => {
    const parsed = parsedOrThrow(unsupportedBlockSource)
    const diagnosticCode = parsed.body.kind === 'preserved' ? parsed.body.diagnostic.code : ''
    let renderError: unknown
    try {
      renderMermaidSVG(unsupportedBlockSource)
    } catch (error) {
      renderError = error
    }
    const renderDiagnosticCode = renderError instanceof MermaidFamilyDetectionError ? renderError.code : ''
    const serialized = serializeMermaid(parsed)
    return {
      agent: {
        status: 'observed',
        diagnosticCodes: diagnosticCode ? [diagnosticCode] : [],
        semantics: {
          bodyKind: parsed.body.kind,
          upstreamFamilyId: parsed.body.kind === 'preserved' ? (parsed.body.preservation.upstreamFamilyId ?? null) : null,
        },
      },
      render: {
        status: 'observed',
        diagnosticCodes: renderDiagnosticCode ? [renderDiagnosticCode] : [],
        semantics: {
          errorName: renderError instanceof Error ? renderError.name : null,
          errorCode: renderDiagnosticCode || null,
          upstreamFamilyId: renderError instanceof MermaidFamilyDetectionError ? (renderError.preservation.upstreamFamilyId ?? null) : null,
        },
      },
      serialize: {
        status: 'observed',
        diagnosticCodes: [],
        semantics: { exactBytes: serialized === unsupportedBlockSource },
      },
    }
  },
}

export const fidelityCases: readonly FidelityCaseDefinition[] = Object.freeze([stateTrailingComment, journeyFractionalScore, flowchartEdgeClass, unsupportedBlock])
