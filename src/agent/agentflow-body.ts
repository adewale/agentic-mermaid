import { graphLabels } from './graph-labels.ts'
import type { FamilyOperations } from './families.ts'
import type { DiagramBody, LayoutWarning, MutationError, ParseError, Result } from './types.ts'
import { err, ok } from './types.ts'
import { buildFlowchartSourceMap, edgeSourceMapKey, mutateFlowchart } from './flowchart-body.ts'
import { parseAgentflow, agentflowMetadata, agentflowRole, agentflowShapeRole } from '../agentflow/parser.ts'
import { parseWritableAgentflow, renderAgentflow } from '../agentflow/source.ts'
import type { AgentflowBody, AgentflowMutationOp } from '../agentflow/types.ts'
import { retainParsedAgentflowModel } from './owned-render-model.ts'
import { agentflowRoleShape, projectAgentflowGraph } from '../agentflow/projection.ts'

export function parseAgentflowBody(source: string, opaqueSource = source): Result<AgentflowBody | Extract<DiagramBody, { kind: 'opaque' }>, ParseError[]> {
  try { return ok(parseWritableAgentflow(source)) }
  catch { return ok({ kind: 'opaque', family: 'agentflow', source: opaqueSource }) }
}

export function mutateAgentflow(body: AgentflowBody, op: AgentflowMutationOp): Result<AgentflowBody, MutationError> {
  const draft = structuredClone(body)
  const allIds = (): Set<string> => {
    const ids = new Set([...draft.graph.nodes.keys(), ...draft.graph.edges.flatMap(edge => edge.id ? [edge.id] : [])])
    const visit = (group: typeof draft.graph.subgraphs[number]): void => { ids.add(group.id); group.children.forEach(visit) }
    draft.graph.subgraphs.forEach(visit)
    return ids
  }
  try {
    if (op.kind === 'set_metadata') {
      if (!allIds().has(op.target)) return err({ code: 'NODE_NOT_FOUND', message: `AgentFlow metadata target ${op.target} does not exist` })
      if (op.metadata === null) draft.metadata.delete(op.target)
      else draft.metadata.set(op.target, agentflowMetadata(op.metadata))
      if (draft.graph.nodes.has(op.target)) draft.roles.set(op.target, draft.connectors.has(op.target) ? 'connector' : agentflowRole(op.metadata?.shape))
    } else if (op.kind === 'set_role') {
      if (!draft.graph.nodes.has(op.id)) return err({ code: 'NODE_NOT_FOUND', message: `AgentFlow node ${op.id} does not exist` })
      draft.roles.set(op.id, op.role)
      draft.metadata.set(op.id, { ...draft.metadata.get(op.id), shape: op.role })
      if (op.role === 'connector') { draft.connectors.add(op.id); draft.globals.add(op.id) }
      else draft.connectors.delete(op.id)
    } else {
      if (op.kind === 'move_node' && op.subgraph !== null && draft.connectors.has(op.id)) return err({ code: 'INVALID_OP', message: 'An AgentFlow connector remains global' })
      const result = mutateFlowchart({ kind: 'flowchart', graph: draft.graph }, op)
      if (!result.ok) return result
      // AgentFlow (§5.1) has three edge operators: `-->` sequence, `-.-`
      // reference and `--x` failure. Mermaid rejects every other link, so an
      // edit may not introduce one (authored links stay as read).
      const authored = new Set(body.graph.edges.map(agentflowLinkForm))
      const unwritable = result.value.graph.edges.find(edge => !authored.has(agentflowLinkForm(edge)) && !agentflowLinkWritable(edge))
      if (unwritable) return err({ code: 'INVALID_OP', message: `AgentFlow edges are -->, -.- or --x; Mermaid rejects the ${unwritable.source} -> ${unwritable.target} link this edit would write` })
      draft.graph = result.value.graph
      if (op.kind === 'rename_node') {
        // Renaming keeps authored metadata positions in insertion order.
        const renameKey = <T>(records: Map<string, T>): Map<string, T> => new Map([...records].map(([id, value]) => [id === op.from ? op.to : id, value]))
        draft.metadata = renameKey(draft.metadata)
        draft.roles = renameKey(draft.roles)
        for (const ids of [draft.connectors, draft.globals]) if (ids.delete(op.from)) ids.add(op.to)
        if (body.connectors.has(op.from)) for (const [id, data] of draft.metadata) {
          const ref = data.connectorRef
          if (typeof ref === 'string' && (ref === op.from || ref.startsWith(`${op.from}.`))) draft.metadata.set(id, { ...data, connectorRef: op.to + ref.slice(op.from.length) })
        }
      }
      if (op.kind === 'move_node' && op.subgraph !== null) draft.globals.delete(op.id)
      if (op.kind === 'set_label' && draft.metadata.get(op.target)?.label !== undefined) draft.metadata.set(op.target, { ...draft.metadata.get(op.target), label: op.label.trim() })
      if (op.kind === 'set_shape') { draft.roles.set(op.id, agentflowRole(op.shape)); draft.metadata.set(op.id, { ...draft.metadata.get(op.id), shape: op.shape }) }
      const ids = allIds()
      for (const records of [draft.metadata, draft.roles]) for (const id of records.keys()) if (!ids.has(id)) records.delete(id)
      for (const records of [draft.connectors, draft.globals]) for (const id of records) if (!ids.has(id)) records.delete(id)
    }
    // Reparse the portable writer: role/label/global interpretation must agree
    // with the source that is about to become the next editable diagram.
    return ok(parseAgentflow(renderAgentflow(draft)))
  } catch (error) { return err({ code: 'INVALID_OP', message: error instanceof Error ? error.message : String(error) }) }
}

type AgentflowEdge = AgentflowBody['graph']['edges'][number]
const agentflowLinkForm = (edge: AgentflowEdge): string =>
  JSON.stringify([edge.style, edge.hasArrowStart && (edge.startMarker ?? 'arrow'), edge.hasArrowEnd && (edge.endMarker ?? 'arrow')])
/** `-->` (solid, arrow end), `--x` (solid, cross end) or `-.-` (dotted, open). */
function agentflowLinkWritable(edge: AgentflowEdge): boolean {
  if (edge.hasArrowStart) return false
  if (edge.style === 'dotted') return !edge.hasArrowEnd
  return edge.style === 'solid' && edge.hasArrowEnd && ['arrow', 'cross'].includes(edge.endMarker ?? 'arrow')
}

function agentflowShapeWarnings(body: AgentflowBody): LayoutWarning[] {
  const warnings: LayoutWarning[] = []
  for (const [id, node] of body.graph.nodes) {
    const metadataShape = body.metadata.get(id)?.shape
    // The connector keyword owns its default silhouette independently of
    // bracket syntax. An explicit conflicting hint still needs a diagnosis.
    if (body.connectors.has(id) && (!metadataShape || metadataShape === agentflowRoleShape('connector'))) continue
    const shape = metadataShape || node.authoredShape || node.semanticShape || node.shape
    const role = body.roles.get(id)
    if (!role || agentflowShapeRole(shape) === role) continue
    warnings.push({
      code: 'UNSUPPORTED_SYNTAX', syntax: 'agentflow_shape_substitution', node: id,
      message: `AgentFlow node "${id}" retains shape ${JSON.stringify(shape)} but renders with the ${role} role geometry "${agentflowRoleShape(role)}".`,
    })
  }
  return warnings
}

export const AGENTFLOW_SOURCE_HOOKS = {
  canonicalSource: 'preserved',
  renderSource: () => 'canonical',
  extractLabels: source => { try { return graphLabels(parseAgentflow(source, false).graph) } catch { return [] } },
  parse: ctx => {
    const result = parseAgentflowBody(ctx.source.familyBody, ctx.opaqueSource)
    if (result.ok && result.value.kind === 'agentflow') retainParsedAgentflowModel(result.value, ctx.source.familyBody, projectAgentflowGraph(result.value))
    return result
  },
  serialize: body => {
    if (body.kind !== 'agentflow') throw new Error(`AgentFlow serializer received ${body.kind}`)
    return renderAgentflow(body)
  },
  verify: body => body.kind === 'agentflow' ? agentflowShapeWarnings(body) : [],
  sourceMapGrammar: 'flowchart',
  buildSourceMap: (body, source) => {
    const map = body.kind === 'agentflow'
      ? buildFlowchartSourceMap({ kind: 'flowchart', graph: body.graph }, source, 'flow')
      : { nodes: new Map(), edges: new Map(), groups: new Map(), labels: new Map() }
    if (body.kind === 'agentflow') body.graph.edges.forEach((edge, index) => {
      const location = map.edges.get(edgeSourceMapKey(index, edge))
      if (edge.id && location) map.edges.set(edge.id, location)
    })
    return map
  },
} satisfies Pick<FamilyOperations, 'canonicalSource' | 'renderSource' | 'parse' | 'serialize' | 'verify' | 'buildSourceMap' | 'sourceMapGrammar' | 'mutate' | 'extractLabels'>

export const AGENTFLOW_MUTATION_HOOKS: Pick<FamilyOperations, 'mutate'> = {
  mutate: (body, op) => body.kind === 'agentflow' ? mutateAgentflow(body, op as AgentflowMutationOp) : err({ code: 'INVALID_OP', message: 'AgentFlow source needs a supported native model for typed edits' }),
}
