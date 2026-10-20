import { assessLayout, hardViolations, type RubricMetrics } from '../layout-rubric.ts'
import { labelRect } from '../route-contracts.ts'
import type { ResolvedRenderStyle } from '../styles.ts'
import type { MermaidGraph, MermaidSubgraph, PositionedGraph, PositionedGroup } from '../types.ts'
import { LayoutPassContractError } from './pass.ts'
import { DiagramWorkLimitError } from '../shared/diagram-limits.ts'
import { LayoutCertificationError, type LayoutCertificationAttempt } from './certification-error.ts'
import type { PixelTextBlock } from '../shared/prepared-text.ts'
import { prepareDisplayText, resolveLabelContent, type DisplayTextInput } from '../shared/display-text.ts'

export { LayoutCertificationError, type LayoutCertificationAttempt } from './certification-error.ts'

export const MAX_LAYOUT_CANDIDATES = 4
// Quality exploration is deterministic and bounded independently of machine
// speed. Larger graphs keep the existing first-certified fallback behavior.
export const MAX_PREFERENCE_NODES = 64
export const MAX_PREFERENCE_EDGES = 128

export interface LayoutPreferenceScore {
  unreadableTitles: 0 | 1
  edgeCrossings: number
  labelConflicts: number
  totalBends: number
  nonCanonicalEndpointRate: number
  peerBarycenterDelta: number
  /** Candidate canvas before document title-band projection. */
  area: number
}

type PreferenceCriterion = keyof LayoutPreferenceScore
const PREFERENCE_ORDER: readonly PreferenceCriterion[] = [
  'unreadableTitles', 'edgeCrossings', 'labelConflicts', 'totalBends',
  'nonCanonicalEndpointRate', 'peerBarycenterDelta', 'area',
]

export interface LayoutPreferenceEvidence {
  /** Score of the returned geometry, including the optional final route choice. */
  selectedScore: LayoutPreferenceScore
  /** Placement-strategy decision, before the optional final route comparison. */
  reason: PreferenceCriterion | 'candidate-order' | 'first-certified' | 'work-budget' | 'no-alternative' | 'alternative-invalid'
  /** Certified placement scores before the optional final route comparison. */
  compared: readonly { strategy: string; score: LayoutPreferenceScore }[]
  /** Final bundled/unbundled decision using the selected placement's ELK result.
   * Its selected score describes the same final geometry as selectedScore above. */
  routing?: {
    strategy: 'bundled' | 'without-generic-bundling'
    preference: Omit<LayoutPreferenceEvidence, 'routing'>
  }
}

export interface LayoutCertificationReceipt {
  status: 'passed'
  strategy: string
  attempts: number
  hardViolations: 0
  preference: LayoutPreferenceEvidence
}

export interface LayoutCertificationCandidate {
  strategy: string
  produce: () => PositionedGraph
  /** Try the next bounded candidate first, retaining this already certified
   * result if the preferred alternative fails. Runs inside this attempt. */
  preferNext?: (positioned: PositionedGraph) => boolean
  /** A fallback may be identical for this graph (for example hierarchy mode
   * without groups). It remains available after failure, but is not a quality
   * probe. At most one eligible alternative is produced after certification. */
  qualityAlternative?: boolean
}

function correspondenceViolations(graph: MermaidGraph, positioned: PositionedGraph, style: ResolvedRenderStyle): string[] {
  const failures: string[] = []
  const retainedText = (id: string, label: DisplayTextInput, block: PixelTextBlock | undefined, role: 'node' | 'edge' | 'group'): void => {
    if (!block) return
    const transform = role === 'node' ? style.nodeTextTransform : role === 'edge' ? style.edgeTextTransform : style.groupTextTransform
    const expected = prepareDisplayText(label, 'formatted', transform), actual = block.prepared
    const sameRuns = actual.lines.length === expected.lines.length && actual.lines.every((runs, line) =>
      runs.length === expected.lines[line]!.length && runs.every((run, index) => {
        const authored = expected.lines[line]![index]!
        return run.text === authored.text && run.bold === authored.bold && run.italic === authored.italic &&
          run.underline === authored.underline && run.strikethrough === authored.strikethrough &&
          run.sourceStart === authored.sourceStart && run.sourceEnd === authored.sourceEnd &&
          run.clusters?.length === authored.clusters?.length && (run.clusters?.every((cluster, clusterIndex) => {
            const source = authored.clusters![clusterIndex]!
            return cluster.text === source.text && cluster.sourceStart === source.sourceStart && cluster.sourceEnd === source.sourceEnd
          }) ?? true)
      }))
    if (actual.source !== expected.source || actual.display !== expected.display || actual.transform !== expected.transform ||
        actual.lineStarts.length !== expected.lineStarts.length || actual.lineStarts.some((start, line) => start !== expected.lineStarts[line]) || !sameRuns) {
      failures.push(`${id}: changed retained prepared text`)
    }
  }
  const expectedGroups = new Map<string, string>(),
    actualGroups = new Map<string, string>()
  const authoredGroups = new Map<string, MermaidSubgraph>(),
    positionedGroups = new Map<string, PositionedGroup>()
  const expected = (groups: MermaidSubgraph[], parent = ''): void => {
    for (const group of groups) {
      expectedGroups.set(group.id, parent)
      authoredGroups.set(group.id, group)
      expected(group.children, group.id)
    }
  }
  const actual = (groups: PositionedGroup[], parent = ''): void => {
    for (const group of groups) {
      if (actualGroups.has(group.id)) failures.push(`group ${group.id}: duplicate identity`)
      actualGroups.set(group.id, parent)
      positionedGroups.set(group.id, group)
      actual(group.children, group.id)
    }
  }
  expected(graph.subgraphs)
  actual(positioned.groups)
  for (const [id, parent] of expectedGroups) if (actualGroups.get(id) !== parent) failures.push(`group ${id}: missing or changed parent`)
  for (const id of actualGroups.keys()) if (!expectedGroups.has(id)) failures.push(`group ${id}: unexpected identity`)
  const nodeIds = new Set<string>()
  const positionedNodes = new Map(positioned.nodes.map(node => [node.id, node]))
  for (const node of positioned.nodes) {
    if (nodeIds.has(node.id)) failures.push(`node ${node.id}: duplicate identity`)
    nodeIds.add(node.id)
    if (!graph.nodes.has(node.id)) failures.push(`node ${node.id}: unexpected identity`)
    else if (node.label !== graph.nodes.get(node.id)!.label) failures.push(`node ${node.id}: changed label`)
    else {
      const authored = graph.nodes.get(node.id)!
      retainedText(`node ${node.id}`, resolveLabelContent(authored.label, authored.labelContent), node.labelBlock, 'node')
    }
  }
  for (const id of graph.nodes.keys()) if (!nodeIds.has(id) && !actualGroups.has(id)) failures.push(`node ${id}: missing identity`)
  for (const [id, authored] of authoredGroups) {
    const group = positionedGroups.get(id)
    if (!group) continue
    if (group.label !== authored.label) failures.push(`group ${id}: changed label`)
    retainedText(`group ${id}`, resolveLabelContent(authored.label, authored.labelContent), group.labelBlock, 'group')
    const parent = positionedGroups.get(expectedGroups.get(id) ?? '')
    if (parent && (group.x < parent.x - 0.5 || group.y < parent.y - 0.5 || group.x + group.width > parent.x + parent.width + 0.5 || group.y + group.height > parent.y + parent.height + 0.5)) {
      failures.push(`group ${id}: outside authored parent ${parent.id}`)
    }
    for (const memberId of authored.nodeIds) {
      if (authoredGroups.has(memberId)) continue
      const member = positionedNodes.get(memberId)
      if (member && (member.x < group.x - 0.5 || member.y < group.y - 0.5 || member.x + member.width > group.x + group.width + 0.5 || member.y + member.height > group.y + group.height + 0.5)) {
        failures.push(`member ${memberId}: outside authored group ${id}`)
      }
    }
  }
  const edgeIndices = new Set<number>()
  for (const [index, edge] of positioned.edges.entries()) {
    const identity = edge.edgeIndex ?? index,
      authored = graph.edges[identity]
    if (edgeIndices.has(identity)) failures.push(`edge ${identity}: duplicate identity`)
    edgeIndices.add(identity)
    if (!authored) {
      failures.push(`edge ${identity}: unexpected identity`)
      continue
    }
    if (authored.label !== undefined) retainedText(`edge ${identity}`, resolveLabelContent(authored.label, authored.labelContent), edge.labelBlock, 'edge')
    if (
      edge.source !== authored.source ||
      edge.target !== authored.target ||
      (edge.id ?? '') !== (authored.id ?? '') ||
      (edge.label ?? '') !== (authored.label ?? '') ||
      edge.style !== authored.style ||
      edge.hasArrowStart !== authored.hasArrowStart ||
      edge.hasArrowEnd !== authored.hasArrowEnd ||
      (edge.startMarker ?? 'arrow') !== (authored.startMarker ?? 'arrow') ||
      (edge.endMarker ?? 'arrow') !== (authored.endMarker ?? 'arrow')
    ) {
      failures.push(`edge ${identity}: changed endpoints, identity, label, shaft or markers`)
    }
  }
  graph.edges.forEach((_, index) => {
    if (!edgeIndices.has(index)) failures.push(`edge ${index}: missing identity`)
  })
  return failures
}

function retainAuthoredMembership(graph: MermaidGraph, positioned: PositionedGraph): void {
  const authored = new Map<string, MermaidSubgraph>()
  const collect = (groups: MermaidSubgraph[]): void => {
    for (const group of groups) {
      authored.set(group.id, group)
      collect(group.children)
    }
  }
  collect(graph.subgraphs)
  const retain = (groups: PositionedGroup[]): void => {
    for (const group of groups) {
      group.nodeIds = authored.get(group.id)!.nodeIds.filter(id => graph.nodes.has(id) && !authored.has(id))
      retain(group.children)
    }
  }
  retain(positioned.groups)
}

/** Bounds are checked on final retained geometry, independently of ELK's success flag. */
export function positionedGeometryViolations(positioned: PositionedGraph, style: ResolvedRenderStyle): string[] {
  const failures: string[] = []
  const finite = (values: number[]) => values.every(Number.isFinite)
  if (!finite([positioned.width, positioned.height]) || positioned.width < 0 || positioned.height < 0) return ['non-finite or negative canvas']
  const box = (id: string, x: number, y: number, w: number, h: number): void => {
    if (!finite([x, y, w, h]) || w < 0 || h < 0) failures.push(`${id}: non-finite or negative geometry`)
    else if (x < -0.5 || y < -0.5 || x + w > positioned.width + 0.5 || y + h > positioned.height + 0.5) failures.push(`${id}: outside canvas`)
  }
  for (const node of positioned.nodes) box(`node ${node.id}`, node.x, node.y, node.width, node.height)
  const group = (value: PositionedGroup): void => {
    box(`group ${value.id}`, value.x, value.y, value.width, value.height)
    value.children.forEach(group)
  }
  positioned.groups.forEach(group)
  for (const edge of positioned.edges) {
    if (edge.style !== 'invisible' && edge.points.length < 2) failures.push(`edge ${edge.source}->${edge.target}: missing route`)
    if (edge.label && (!edge.labelPosition || !edge.labelBlock)) failures.push(`label ${edge.source}->${edge.target}: missing retained geometry`)
    for (const point of edge.points) box(`edge ${edge.source}->${edge.target}`, point.x, point.y, 0, 0)
    if (edge.label !== undefined && edge.labelPosition && edge.labelBlock) {
      const bounds = labelRect(edge, style)
      if (bounds) box(`label ${edge.source}->${edge.target}`, bounds.x, bounds.y, bounds.w, bounds.h)
    }
  }
  for (const note of positioned.notes ?? []) box(`note ${note.id}`, note.x, note.y, note.width, note.height)
  if (positioned.title?.block) {
    const title = positioned.title,
      block = title.block!
    box('diagram title', title.x - block.width / 2, title.y - block.height / 2, block.width, block.height)
  }
  return failures
}

function preferenceScore(positioned: PositionedGraph, metrics: RubricMetrics, preferNext: boolean): LayoutPreferenceScore {
  return {
    unreadableTitles: preferNext ? 1 : 0,
    labelConflicts: metrics.labelConflicts,
    edgeCrossings: metrics.edgeCrossings,
    totalBends: metrics.totalBends,
    nonCanonicalEndpointRate: 1 - metrics.portEndpointRate,
    peerBarycenterDelta: Math.round(metrics.peerBarycenterDelta * 1000) / 1000,
    area: positioned.width * positioned.height,
  }
}

export function withinLayoutPreferenceBudget(graph: MermaidGraph): boolean {
  let nodes = graph.nodes.size
  const count = (groups: readonly MermaidSubgraph[]): void => {
    for (const group of groups) {
      nodes++
      count(group.children)
    }
  }
  count(graph.subgraphs)
  return nodes <= MAX_PREFERENCE_NODES && graph.edges.length <= MAX_PREFERENCE_EDGES
}

/** Hard feasibility gates every candidate. One additional certified alternative
 * may improve a title or a small graph with label conflicts or crossings, with stable candidate-order
 * ties. Cosmetic scores never initiate another expensive layout production. */
export function certifyLayoutCandidates(graph: MermaidGraph, style: ResolvedRenderStyle, candidates: readonly LayoutCertificationCandidate[]): PositionedGraph {
  const attempts: LayoutCertificationAttempt[] = []
  const bounded = candidates.slice(0, MAX_LAYOUT_CANDIDATES)
  type Certified = { positioned: PositionedGraph; strategy: string; score: LayoutPreferenceScore }
  let deferred: Certified | undefined
  let probe: 'readability' | 'routing' | undefined
  const compared: Array<{ strategy: string; score: LayoutPreferenceScore }> = []
  const accept = (selected: Certified, reason: LayoutPreferenceEvidence['reason']): PositionedGraph => {
    retainAuthoredMembership(graph, selected.positioned)
    selected.positioned.certification = {
      status: 'passed', strategy: selected.strategy, attempts: attempts.length, hardViolations: 0,
      preference: { selectedScore: selected.score, reason, compared },
    }
    return selected.positioned
  }
  for (const [index, candidate] of bounded.entries()) {
    if (deferred && probe === 'routing' && candidate.qualityAlternative === false) continue
    try {
      const positioned = candidate.produce()
      const violations = [...correspondenceViolations(graph, positioned, style), ...positionedGeometryViolations(positioned, style)]
      const rubric = violations.length === 0 ? assessLayout(graph, positioned, style) : undefined
      if (rubric) violations.push(...hardViolations(rubric).map(violation => `${violation.metric}: ${violation.detail}`))
      const preferNext = violations.length === 0 && (candidate.preferNext?.(positioned) ?? false)
      attempts.push({ strategy: candidate.strategy, violations })
      if (violations.length === 0 && rubric) {
        const certified = { positioned, strategy: candidate.strategy, score: preferenceScore(positioned, rubric.metrics, preferNext) }
        compared.push({ strategy: certified.strategy, score: certified.score })
        if (deferred) {
          for (const criterion of PREFERENCE_ORDER) {
            if (certified.score[criterion] < deferred.score[criterion]) return accept(certified, criterion)
            if (certified.score[criterion] > deferred.score[criterion]) return accept(deferred, criterion)
          }
          return accept(deferred, 'candidate-order')
        }
        const alternatives = bounded.slice(index + 1)
        if (preferNext && alternatives.length > 0) {
          deferred = certified
          probe = 'readability'
          continue
        }
        if (rubric.metrics.edgeCrossings === 0 && rubric.metrics.labelConflicts === 0) return accept(certified, 'first-certified')
        if (!withinLayoutPreferenceBudget(graph)) return accept(certified, 'work-budget')
        if (!alternatives.some(alternative => alternative.qualityAlternative !== false)) return accept(certified, 'no-alternative')
        deferred = certified
        probe = 'routing'
        continue
      }
    } catch (error) {
      // A successful alternative cannot hide a broken pass or exceeded input
      // work limit. These diagnostics intentionally stop certification.
      if (error instanceof LayoutPassContractError || error instanceof DiagramWorkLimitError) throw error
      attempts.push({ strategy: candidate.strategy, violations: [error instanceof Error ? error.message : String(error)] })
    }
    if (deferred) return accept(deferred, 'alternative-invalid')
  }
  if (deferred) return accept(deferred, 'no-alternative')
  throw new LayoutCertificationError(attempts)
}
