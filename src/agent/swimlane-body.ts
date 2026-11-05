import { graphLabels } from './graph-labels.ts'
import type { FamilyOperations } from './families.ts'
import type { AnyMutationOp, DiagramBody, FlowchartMutationOp, MutationError, ParseError, Result } from './types.ts'
import { err, ok } from './types.ts'
import { buildFlowchartSourceMap, mutateFlowchart, parseFlowchartBody, renderFlowchart } from './flowchart-body.ts'
import { containsFlowchartOpaqueSyntax, flowchartUnsupportedSyntaxWarnings } from './flowchart-unsupported.ts'
import { swimlaneFlowchartSource } from '../swimlane/parser.ts'
import type { SwimlaneBody } from '../swimlane/types.ts'

export function parseSwimlaneBody(source: string, opaqueSource = source): Result<SwimlaneBody | Extract<DiagramBody, { kind: 'opaque' }>, ParseError[]> {
  const flowchart = swimlaneFlowchartSource(source)
  if (containsFlowchartOpaqueSyntax(flowchart)) return ok({ kind: 'opaque', family: 'swimlane', source: opaqueSource })
  const result = parseFlowchartBody(flowchart, opaqueSource)
  if (!result.ok) return result
  return ok(result.value.kind === 'opaque'
    ? { ...result.value, family: 'swimlane' }
    : { kind: 'swimlane', graph: result.value.graph })
}

export function renderSwimlane(body: SwimlaneBody): string {
  return renderFlowchart(body.graph, 'flowchart').replace(/^flowchart\b/, 'swimlane-beta')
}

export function mutateSwimlane(body: SwimlaneBody, op: FlowchartMutationOp): Result<SwimlaneBody, MutationError> {
  const result = mutateFlowchart({ kind: 'flowchart', graph: body.graph }, op)
  return result.ok ? ok({ kind: 'swimlane', graph: result.value.graph }) : result
}

export const SWIMLANE_SOURCE_HOOKS = {
  renderSource: () => 'canonical',
  extractLabels: source => { const parsed = parseSwimlaneBody(source); return parsed.ok && parsed.value.kind === 'swimlane' ? graphLabels(parsed.value.graph) : [] },
  parse: ctx => parseSwimlaneBody(ctx.source.familyBody, ctx.opaqueSource),
  serialize: body => {
    if (body.kind !== 'swimlane') throw new Error(`swimlane serializer received body kind ${body.kind}`)
    return renderSwimlane(body)
  },
  buildSourceMap: (body, source) => body.kind === 'swimlane'
    ? buildFlowchartSourceMap({ kind: 'flowchart', graph: body.graph }, source)
    : { nodes: new Map(), edges: new Map(), groups: new Map(), labels: new Map() },
  verify: body => body.kind === 'opaque' ? flowchartUnsupportedSyntaxWarnings(swimlaneFlowchartSource(body.source)) : [],
} satisfies Pick<FamilyOperations, 'renderSource' | 'parse' | 'serialize' | 'buildSourceMap' | 'verify' | 'mutate' | 'extractLabels'>

export const SWIMLANE_MUTATION_HOOKS: Pick<FamilyOperations, 'mutate'> = {
  mutate: (body, op: AnyMutationOp) => body.kind === 'swimlane'
    ? mutateSwimlane(body, op as FlowchartMutationOp)
    : err({ code: 'INVALID_OP', message: 'Swimlane source contains constructs that cannot be changed through the typed graph model' }),
}
