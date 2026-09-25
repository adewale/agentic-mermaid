import { MermaidFamilyDetectionError, mutate, parseRegisteredMermaid, renderMermaidSVG, serializeMermaid, verifyMermaid } from '../../../agent/index.ts'
import { parseJourneyDiagram } from '../../../journey/parser.ts'
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

function normalizedFlowchartClassFacts(diagram: ReturnType<typeof parsedOrThrow>): FidelityJson {
  if (diagram.body.kind !== 'flowchart') return null
  const graph = diagram.body.graph
  const hot = graph.classDefs.get('hot')
  return {
    nodeIds: [...graph.nodes.keys()].sort(),
    edges: graph.edges
      .map(edge => ({ id: edge.id ?? null, source: edge.source, target: edge.target, style: edge.style }))
      .sort((a, b) => String(a.id) < String(b.id) ? -1 : String(a.id) > String(b.id) ? 1 : 0),
    hotClass: {
      stroke: hot?.stroke ?? null,
      strokeWidth: hot?.['stroke-width'] ?? null,
    },
    e1Class: graph.classAssignments.get('e1') ?? null,
  }
}

function matchesFlowchartClassFacts(value: FidelityJson, stroke: string, strokeWidth: string): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const record = value as Readonly<Record<string, FidelityJson>>
  const nodeIds = record.nodeIds
  const edges = record.edges
  const hotClass = record.hotClass
  if (!Array.isArray(nodeIds) || nodeIds.length !== 2 || nodeIds[0] !== 'A' || nodeIds[1] !== 'B') return false
  if (!Array.isArray(edges) || edges.length !== 1) return false
  const edge = edges[0]
  if (!edge || typeof edge !== 'object' || Array.isArray(edge)) return false
  if (edge.id !== 'e1' || edge.source !== 'A' || edge.target !== 'B' || edge.style !== 'solid') return false
  if (!hotClass || typeof hotClass !== 'object' || Array.isArray(hotClass)) return false
  const hotRecord = hotClass as Readonly<Record<string, FidelityJson>>
  return hotRecord.stroke === stroke && hotRecord.strokeWidth === strokeWidth && record.e1Class === 'hot'
}

const stateTrailingCommentSource = `${['stateDiagram-v2 %% heading; Bogus --> Edge', '  A --> B %% legal trailing comment', '  B --> C'].join('\n')}\n`

const stateTrailingComment: FidelityCaseDefinition = {
  id: 'state.comments.trailing-transition-loss',
  family: 'state',
  featureId: 'official-doc:state:section:comments',
  source: stateTrailingCommentSource,
  upstreamReference: 'https://mermaid.ai/open-source/syntax/stateDiagram.html#comments',
  upstreamRevision: UPSTREAM_REVISION,
  expected: {
    agent: applicable('native', evidence => {
      const semanticFacts = facts(evidence)
      return semanticFacts.bodyKind === 'state'
        && JSON.stringify(semanticFacts.transitions) === JSON.stringify(['A->B', 'B->C'])
        && JSON.stringify(semanticFacts.droppedCommentLines) === JSON.stringify([1, 2])
        ? 'native' : 'absent'
    }, ['COMMENT_DROPPED']),
    render: applicable('native', evidence => {
      const renderedEdges = facts(evidence).renderedEdges
      if (!Array.isArray(renderedEdges) || renderedEdges.some(edge => typeof edge !== 'string')) fail('renderedEdges must be strings')
      return JSON.stringify(renderedEdges) === JSON.stringify(['A->B', 'B->C']) ? 'native' : 'absent'
    }),
    serialize: applicable('native', evidence => {
      const semanticFacts = facts(evidence)
      return JSON.stringify(semanticFacts.reparsedTransitions) === JSON.stringify(['A->B', 'B->C'])
        && semanticFacts.commentLossDiagnosed === true ? 'native' : 'absent'
    }),
    mutate: applicable('native', evidence => {
      const semanticFacts = facts(evidence)
      return semanticFacts.mutationOk === true
        && JSON.stringify(semanticFacts.transitions) === JSON.stringify(['A->B', 'B->C', 'B->A'])
        && JSON.stringify(semanticFacts.droppedCommentLines) === JSON.stringify([1, 2])
        ? 'native' : 'absent'
    }, ['COMMENT_DROPPED']),
  },
  observe: () => {
    const parsed = parsedOrThrow(stateTrailingCommentSource)
    const verification = verifyMermaid(parsed)
    const svg = renderMermaidSVG(stateTrailingCommentSource)
    const renderedEdges = [...svg.matchAll(/<(?:path|polyline)\b[^>]*data-from="([^"]+)"[^>]*data-to="([^"]+)"[^>]*>/g)].map(match => `${match[1]}->${match[2]}`)
    const serialized = serializeMermaid(parsed)
    const reparsed = parsedOrThrow(serialized)
    const mutation = mutate(parsed, { kind: 'add_transition', from: 'B', to: 'A' })
    const commentLossLines = (diagram: typeof parsed): number[] => verifyMermaid(diagram).warnings
      .filter(warning => warning.code === 'COMMENT_DROPPED')
      .flatMap(warning => warning.lines)
    const transitions = (diagram: typeof parsed): string[] => diagram.body.kind === 'state'
      ? diagram.body.transitions.map(transition => `${transition.from}->${transition.to}`)
      : []
    return {
      agent: {
        status: 'observed',
        diagnosticCodes: verification.warnings.map(warning => warning.code).filter(code => code === 'UNSUPPORTED_SYNTAX' || code === 'COMMENT_DROPPED'),
        semantics: { bodyKind: parsed.body.kind, transitions: transitions(parsed), droppedCommentLines: commentLossLines(parsed) },
      },
      render: {
        status: 'observed',
        diagnosticCodes: [],
        semantics: { renderedEdges },
      },
      serialize: {
        status: 'observed',
        diagnosticCodes: [],
        semantics: { reparsedTransitions: transitions(reparsed), commentLossDiagnosed: JSON.stringify(commentLossLines(parsed)) === JSON.stringify([1, 2]) },
      },
      mutate: {
        status: 'observed',
        diagnosticCodes: mutation.ok ? verifyMermaid(mutation.value).warnings.map(warning => warning.code).filter(code => code === 'COMMENT_DROPPED') : [mutation.error.code],
        semantics: { mutationOk: mutation.ok, transitions: mutation.ok ? transitions(mutation.value) : [], droppedCommentLines: mutation.ok ? commentLossLines(mutation.value) : [] },
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
    agent: applicable('native', evidence => {
      const semanticFacts = facts(evidence)
      return semanticFacts.bodyKind === 'journey' && semanticFacts.score === 3.5 ? 'native' : 'absent'
    }),
    render: applicable('native', evidence => {
      const semanticFacts = facts(evidence)
      return semanticFacts.nativeScore === 3.5
        && semanticFacts.exactSvgScore === true
        && semanticFacts.midpointY === true
        && semanticFacts.finiteSvg === true ? 'native' : 'absent'
    }),
    serialize: applicable('native', evidence => facts(evidence).reparsedScore === 3.5 ? 'native' : 'absent'),
    mutate: applicable('native', evidence => {
      const semanticFacts = facts(evidence)
      return semanticFacts.mutatedScore === 4.25 && semanticFacts.reparsedMutatedScore === 4.25 ? 'native' : 'absent'
    }),
  },
  observe: () => {
    const parsed = parsedOrThrow(journeyFractionalScoreSource)
    const native = parseJourneyDiagram(journeyFractionalScoreSource.trimEnd().split('\n'))
    const nativeScore = native.sections[0]?.tasks[0]?.score
    const svg = renderMermaidSVG(journeyFractionalScoreSource)
    const markerY = Number(svg.match(/<g class="journey-score-marker" data-score="3\.5">\s*<circle[^>]*\bcy="([^"]+)"/)?.[1])
    const guideY = new Map([...svg.matchAll(/<line class="journey-guide"[^>]*\by1="([^"]+)"[^>]*\/>\s*<text[^>]*class="journey-score-label"[^>]*>([1-5])<\/text>/g)]
      .map(match => [Number(match[2]), Number(match[1])]))
    const tick3Y = guideY.get(3)
    const tick4Y = guideY.get(4)
    const serialized = serializeMermaid(parsed)
    const reparsed = parsedOrThrow(serialized)
    const mutation = mutate(parsed, { kind: 'set_task_score', sectionIndex: 0, taskIndex: 0, score: 4.25 })
    const reparsedMutation = mutation.ok ? parsedOrThrow(serializeMermaid(mutation.value)) : null
    return {
      agent: {
        status: 'observed',
        diagnosticCodes: [],
        semantics: { bodyKind: parsed.body.kind, score: parsed.body.kind === 'journey' ? parsed.body.sections[0]?.tasks[0]?.score ?? null : null },
      },
      render: {
        status: 'observed',
        diagnosticCodes: [],
        semantics: {
          nativeScore: nativeScore ?? null,
          exactSvgScore: svg.includes('class="journey-score-marker" data-score="3.5"'),
          midpointY: Number.isFinite(markerY) && tick3Y !== undefined && tick4Y !== undefined
            && tick4Y < markerY && markerY < tick3Y && markerY === (tick3Y + tick4Y) / 2,
          finiteSvg: !/NaN|Infinity|undefined/.test(svg),
        },
      },
      serialize: {
        status: 'observed',
        diagnosticCodes: [],
        semantics: { reparsedScore: reparsed.body.kind === 'journey' ? reparsed.body.sections[0]?.tasks[0]?.score ?? null : null },
      },
      mutate: {
        status: 'observed',
        diagnosticCodes: mutation.ok ? [] : [mutation.error.code],
        semantics: {
          mutatedScore: mutation.ok && mutation.value.body.kind === 'journey' ? mutation.value.body.sections[0]?.tasks[0]?.score ?? null : null,
          reparsedMutatedScore: reparsedMutation?.body.kind === 'journey' ? reparsedMutation.body.sections[0]?.tasks[0]?.score ?? null : null,
        },
      },
    }
  },
}

const journeySemicolonExtensionSource = 'journey\n  A: 5: Me; B: 3: Me\n'

const journeySemicolonExtension: FidelityCaseDefinition = {
  id: 'journey.statements.semicolon-extension',
  family: 'journey',
  featureId: 'official-doc:journey:section:user-journey-diagram',
  source: journeySemicolonExtensionSource,
  upstreamReference: 'https://mermaid.ai/open-source/syntax/userJourney.html',
  upstreamRevision: UPSTREAM_REVISION,
  expected: {
    agent: applicable('diagnosed', evidence => {
      const semanticFacts = facts(evidence)
      return semanticFacts.bodyKind === 'journey'
        && JSON.stringify(semanticFacts.tasks) === JSON.stringify(['A:5', 'B:3'])
        && semanticFacts.extensionLine === 2 ? 'diagnosed' : 'absent'
    }, ['UNSUPPORTED_SYNTAX']),
    // The direct SVG API has no diagnostic channel. Its two rendered tasks
    // are a local extension, not evidence of Mermaid-native syntax support.
    render: applicable('absent', evidence => {
      const semanticFacts = facts(evidence)
      return JSON.stringify(semanticFacts.markerScores) === JSON.stringify([5, 3])
        && semanticFacts.taskLabelsVisible === true ? 'absent' : 'native'
    }),
    serialize: applicable('native', evidence => {
      const semanticFacts = facts(evidence)
      return semanticFacts.portableNewlines === true
        && JSON.stringify(semanticFacts.reparsedTasks) === JSON.stringify(['A:5', 'B:3'])
        && semanticFacts.extensionWarningCleared === true ? 'native' : 'absent'
    }),
    mutate: applicable('native', evidence => {
      const semanticFacts = facts(evidence)
      return semanticFacts.mutationOk === true
        && JSON.stringify(semanticFacts.reparsedTasks) === JSON.stringify(['A:5', 'B:4']) ? 'native' : 'absent'
    }),
  },
  observe: () => {
    const parsed = parsedOrThrow(journeySemicolonExtensionSource)
    const tasks = (diagram: typeof parsed): string[] => diagram.body.kind === 'journey'
      ? diagram.body.sections.flatMap(section => section.tasks.map(task => `${task.text}:${task.score}`))
      : []
    const warning = verifyMermaid(parsed).warnings.find(item => item.code === 'UNSUPPORTED_SYNTAX'
      && item.syntax === 'journey_semicolon_statement_extension')
    const svg = renderMermaidSVG(journeySemicolonExtensionSource)
    const markerScores = [...svg.matchAll(/<g class="journey-score-marker" data-score="([^"]+)">/g)]
      .map(match => Number(match[1]))
    const serialized = serializeMermaid(parsed)
    const reparsed = parsedOrThrow(serialized)
    const mutation = mutate(parsed, { kind: 'set_task_score', sectionIndex: 0, taskIndex: 1, score: 4 })
    const reparsedMutation = mutation.ok ? parsedOrThrow(serializeMermaid(mutation.value)) : null
    return {
      agent: {
        status: 'observed',
        diagnosticCodes: warning ? [warning.code] : [],
        semantics: { bodyKind: parsed.body.kind, tasks: tasks(parsed), extensionLine: warning && 'line' in warning ? warning.line ?? null : null },
      },
      render: {
        status: 'observed',
        diagnosticCodes: [],
        semantics: {
          markerScores,
          taskLabelsVisible: svg.includes('>A</text>') && svg.includes('>B</text>'),
        },
      },
      serialize: {
        status: 'observed',
        diagnosticCodes: [],
        semantics: {
          portableNewlines: serialized.includes('A: 5: Me\n    B: 3: Me'),
          reparsedTasks: tasks(reparsed),
          extensionWarningCleared: !verifyMermaid(reparsed).warnings.some(item => item.code === 'UNSUPPORTED_SYNTAX'
            && item.syntax === 'journey_semicolon_statement_extension'),
        },
      },
      mutate: {
        status: 'observed',
        diagnosticCodes: mutation.ok ? [] : [mutation.error.code],
        semantics: {
          mutationOk: mutation.ok,
          reparsedTasks: reparsedMutation ? tasks(reparsedMutation) : [],
        },
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
    agent: applicable('native', evidence => {
      const semanticFacts = facts(evidence)
      if (semanticFacts.bodyKind !== 'flowchart') return 'source-preserved'
      return matchesFlowchartClassFacts(semanticFacts.graphFacts ?? null, '#ff0000', '6px') ? 'native' : 'absent'
    }),
    render: applicable('absent', evidence => {
      const semanticFacts = facts(evidence)
      if (typeof semanticFacts.edgeFound !== 'boolean') fail('edgeFound must be boolean')
      return semanticFacts.stroke === '#ff0000' && semanticFacts.strokeWidth === '6' ? 'native' : 'absent'
    }),
    serialize: applicable('native', evidence => (facts(evidence).exactCanonicalBytes === true ? 'native' : 'absent')),
    mutate: applicable('native', evidence => {
      const semanticFacts = facts(evidence)
      if (semanticFacts.mutationOk === true && matchesFlowchartClassFacts(semanticFacts.graphFacts ?? null, '#00ff00', '4px')) return 'native'
      return typeof semanticFacts.errorCode === 'string' ? 'diagnosed' : 'absent'
    }),
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
    const mutation = mutate(parsed, { kind: 'define_class', name: 'hot', style: 'stroke:#00ff00,stroke-width:4px' })
    return {
      agent: {
        status: 'observed',
        diagnosticCodes: [],
        semantics: {
          bodyKind: parsed.body.kind,
          graphFacts: normalizedFlowchartClassFacts(parsed),
        },
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
      mutate: {
        status: 'observed',
        diagnosticCodes: mutation.ok ? [] : [mutation.error.code],
        semantics: {
          mutationOk: mutation.ok,
          errorCode: mutation.ok ? null : mutation.error.code,
          graphFacts: mutation.ok ? normalizedFlowchartClassFacts(mutation.value) : null,
        },
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

export const fidelityCases: readonly FidelityCaseDefinition[] = Object.freeze([stateTrailingComment, journeyFractionalScore, journeySemicolonExtension, flowchartEdgeClass, unsupportedBlock])
