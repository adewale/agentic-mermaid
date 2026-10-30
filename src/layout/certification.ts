import { assessLayout, hardViolations, type RubricMetrics } from '../layout-rubric.ts'
import { labelRect } from '../route-contracts.ts'
import type { ResolvedRenderStyle } from '../styles.ts'
import type { MermaidGraph, MermaidSubgraph, PositionedGraph, PositionedGroup, Point } from '../types.ts'
import { LayoutPassContractError, withinLayoutPreferenceBudget } from './pass.ts'
export { MAX_PREFERENCE_NODES, MAX_PREFERENCE_EDGES, withinLayoutPreferenceBudget } from './pass.ts'
import { DiagramWorkLimitError } from '../shared/diagram-limits.ts'
import { DeferredDependencyError, LayoutCertificationError, type LayoutCertificationAttempt } from './certification-error.ts'
import type { LayoutCertificationViolation, UncertifiedLayoutReceipt } from './uncertified-layout.ts'
import type { PixelTextBlock } from '../shared/prepared-text.ts'
import { prepareDisplayText, resolveLabelContent, type DisplayTextInput } from '../shared/display-text.ts'
import { observeFallback } from '../performance-observations.ts'
import { graphTextBlock } from '../graph-text.ts'

export { LayoutCertificationError, type LayoutCertificationAttempt } from './certification-error.ts'
export type { LayoutCertificationViolation, UncertifiedLayoutReceipt } from './uncertified-layout.ts'

export const MAX_LAYOUT_CANDIDATES = 4

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
  /** Placement-production attempts; an optional final routing comparison is separate. */
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

/** A certification failure. A drawable one leaves every authored element
 * drawn with its meaning; only its placement or route is imperfect. */
export interface CertificationFinding {
  text: string
  drawable?: LayoutCertificationViolation
}

const findingTexts = (findings: readonly CertificationFinding[]): string[] => findings.map(finding => finding.text)

function correspondenceViolations(graph: MermaidGraph, positioned: PositionedGraph, style: ResolvedRenderStyle): CertificationFinding[] {
  const failures: CertificationFinding[] = []
  const fail = (text: string): void => { failures.push({ text }) }
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
      fail(`${id}: changed retained prepared text`)
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
      if (actualGroups.has(group.id)) fail(`group ${group.id}: duplicate identity`)
      actualGroups.set(group.id, parent)
      positionedGroups.set(group.id, group)
      actual(group.children, group.id)
    }
  }
  expected(graph.subgraphs)
  actual(positioned.groups)
  for (const [id, parent] of expectedGroups) if (actualGroups.get(id) !== parent) fail(`group ${id}: missing or changed parent`)
  for (const id of actualGroups.keys()) if (!expectedGroups.has(id)) fail(`group ${id}: unexpected identity`)
  const nodeIds = new Set<string>()
  const positionedNodes = new Map(positioned.nodes.map(node => [node.id, node]))
  for (const node of positioned.nodes) {
    if (nodeIds.has(node.id)) fail(`node ${node.id}: duplicate identity`)
    nodeIds.add(node.id)
    if (!graph.nodes.has(node.id)) fail(`node ${node.id}: unexpected identity`)
    else if (node.label !== graph.nodes.get(node.id)!.label) fail(`node ${node.id}: changed label`)
    else {
      const authored = graph.nodes.get(node.id)!
      retainedText(`node ${node.id}`, resolveLabelContent(authored.label, authored.labelContent), node.labelBlock, 'node')
    }
  }
  for (const id of graph.nodes.keys()) if (!nodeIds.has(id) && !actualGroups.has(id)) fail(`node ${id}: missing identity`)
  for (const [id, authored] of authoredGroups) {
    const group = positionedGroups.get(id)
    if (!group) continue
    if (group.label !== authored.label) fail(`group ${id}: changed label`)
    retainedText(`group ${id}`, resolveLabelContent(authored.label, authored.labelContent), group.labelBlock, 'group')
    const parent = positionedGroups.get(expectedGroups.get(id) ?? '')
    if (parent && (group.x < parent.x - 0.5 || group.y < parent.y - 0.5 || group.x + group.width > parent.x + parent.width + 0.5 || group.y + group.height > parent.y + parent.height + 0.5)) {
      const text = `group ${id}: outside authored parent ${parent.id}`
      failures.push({ text, drawable: { kind: 'groupBreaches', targets: [parent.id, id], detail: text } })
    }
    for (const memberId of authored.nodeIds) {
      if (authoredGroups.has(memberId)) continue
      const member = positionedNodes.get(memberId)
      if (member && (member.x < group.x - 0.5 || member.y < group.y - 0.5 || member.x + member.width > group.x + group.width + 0.5 || member.y + member.height > group.y + group.height + 0.5)) {
        const text = `member ${memberId}: outside authored group ${id}`
        failures.push({ text, drawable: { kind: 'groupBreaches', targets: [id, memberId], detail: text } })
      }
    }
  }
  const edgeIndices = new Set<number>()
  for (const [index, edge] of positioned.edges.entries()) {
    const identity = edge.edgeIndex ?? index,
      authored = graph.edges[identity]
    if (edgeIndices.has(identity)) fail(`edge ${identity}: duplicate identity`)
    edgeIndices.add(identity)
    if (!authored) {
      fail(`edge ${identity}: unexpected identity`)
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
      fail(`edge ${identity}: changed endpoints, identity, label, shaft or markers`)
    }
  }
  graph.edges.forEach((_, index) => {
    if (!edgeIndices.has(index)) fail(`edge ${index}: missing identity`)
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

/** Internal final-route proof. The entire measured header band is reserved,
 * independently of title glyph ink. Exterior group endpoint contact never
 * enters this open rectangle; endpoint identity grants no route exemption. */
export function positionedHeaderRouteViolations(positioned: PositionedGraph, style: ResolvedRenderStyle): string[] {
  return findingTexts(headerRouteFindings(positioned, style))
}

function headerRouteFindings(positioned: PositionedGraph, style: ResolvedRenderStyle): CertificationFinding[] {
  const failures: CertificationFinding[] = []
  const enters = (a: Point, b: Point, group: PositionedGroup, height: number): boolean => {
    let low = 0, high = 1
    for (const [start, delta, min, max] of [
      [a.x, b.x - a.x, group.x, group.x + group.width],
      [a.y, b.y - a.y, group.y, group.y + height],
    ]) {
      if (delta === 0) { if (start! <= min! || start! >= max!) return false; continue }
      const first = (min! - start!) / delta!, last = (max! - start!) / delta!
      low = Math.max(low, Math.min(first, last)); high = Math.min(high, Math.max(first, last))
      if (low >= high) return false
    }
    return low < high
  }
  const visit = (group: PositionedGroup): void => {
    if (!group.concurrencyRegion) {
      const block = group.labelBlock ?? graphTextBlock(resolveLabelContent(group.label, group.labelContent), style, 'group')
      const height = group.headerHeight ?? style.groupHeaderFontSize + 16 + block.height - block.lineHeight
      if (!Number.isFinite(height) || height < 0) failures.push({ text: `group-header ${group.id}: invalid retained height` })
      else if (height > 0 && group.width > 0) for (const edge of positioned.edges) {
        if (edge.style === 'invisible') continue
        for (let index = 1; index < edge.points.length; index++) if (enters(edge.points[index - 1]!, edge.points[index]!, group, height)) {
          const text = `group-header ${group.id}: edge ${edge.source}->${edge.target} segment ${index} enters reserved band`
          failures.push({ text, drawable: { kind: 'groupHeaderBand', targets: [group.id, `${edge.source}->${edge.target}`], detail: text } })
          break
        }
      }
    }
    group.children.forEach(visit)
  }
  positioned.groups.forEach(visit)
  return failures
}

/** Bounds are checked on final retained geometry, independently of ELK's success flag. */
function positionedGeometryBaseViolations(positioned: PositionedGraph, style: ResolvedRenderStyle): string[] {
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

/** Final graph geometry includes the reserved header routing contract. */
export function positionedGeometryViolations(positioned: PositionedGraph, style: ResolvedRenderStyle): string[] {
  return findingTexts(positionedGeometryFindings(positioned, style))
}

/** Base geometry failures (non-finite, off-canvas, missing routes or label
 * geometry) lose content and are never drawable; header-band entries are. */
export function positionedGeometryFindings(positioned: PositionedGraph, style: ResolvedRenderStyle): CertificationFinding[] {
  const failures = positionedGeometryBaseViolations(positioned, style)
  return failures.length ? failures.map(text => ({ text })) : headerRouteFindings(positioned, style)
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

interface CertifiedCandidate {
  positioned: PositionedGraph
  strategy: string
  score: LayoutPreferenceScore
}

interface CertifiedSelection {
  selected: CertifiedCandidate
  reason: LayoutPreferenceEvidence['reason']
  compared: Array<{ strategy: string; score: LayoutPreferenceScore }>
  attempts: number
}

/** A produced candidate whose every failure is drawable. `violations` holds
 * the hard rubric findings too once `complete`; a candidate rejected before
 * its rubric ran is completed only if it is needed for the fallback. */
interface DrawableCandidate {
  positioned: PositionedGraph
  strategy: string
  violations: LayoutCertificationViolation[]
  complete: boolean
}

interface UncertifiedSelection {
  uncertified: DrawableCandidate
  attempts: number
}

/** Violation classes that can misstate structure rather than only look
 * imperfect: wrong containment, hidden nodes, an edge drawn through or away
 * from a node, a label away from its edge. */
const MISLEADING_VIOLATIONS: ReadonlySet<string> = new Set(['groupBreaches', 'groupOverlaps', 'nodeOverlaps', 'edgeThroughNode', 'offOutlineEndpoints', 'labelOffRoute'])

const rubricViolation = (violation: { metric: string; detail: string; targets?: readonly string[] }): LayoutCertificationViolation =>
  ({ kind: violation.metric, targets: violation.targets ?? [], detail: violation.detail })

/** Final candidates cannot opt out of any final geometry contract. */
export function certifyCandidate(graph: MermaidGraph, style: ResolvedRenderStyle, candidate: LayoutCertificationCandidate, strictProducer = false): ReturnType<typeof certifyCandidateForPurpose> {
  return certifyCandidateForPurpose(graph, style, candidate, strictProducer)
}

function certifyCandidateForPurpose(graph: MermaidGraph, style: ResolvedRenderStyle, candidate: LayoutCertificationCandidate, strictProducer = false, purpose: 'final' | 'placement' = 'final'): {
  certified?: CertifiedCandidate
  /** Present when the candidate failed only drawable checks. */
  drawable?: DrawableCandidate
  attempt: LayoutCertificationAttempt
} {
  try {
    const positioned = candidate.produce()
    const correspondence = correspondenceViolations(graph, positioned, style)
    if (strictProducer && correspondence.length) throw new TypeError(`Owned layout changed authored meaning: ${findingTexts(correspondence).join('; ')}`)
    const findings: CertificationFinding[] = [...correspondence, ...(purpose === 'placement' ? positionedGeometryBaseViolations(positioned, style).map(text => ({ text })) : positionedGeometryFindings(positioned, style))]
    const violations = findingTexts(findings)
    const rubric = violations.length === 0 ? assessLayout(graph, positioned, style) : undefined
    const hard = rubric ? hardViolations(rubric) : []
    violations.push(...hard.map(violation => `${violation.metric}: ${violation.detail}`))
    const preferNext = violations.length === 0 && (candidate.preferNext?.(positioned) ?? false)
    const drawable = violations.length > 0 && findings.every(finding => finding.drawable)
    return {
      attempt: { strategy: candidate.strategy, violations },
      ...(violations.length === 0 && rubric ? {
        certified: { positioned, strategy: candidate.strategy, score: preferenceScore(positioned, rubric.metrics, preferNext) },
      } : {}),
      ...(drawable ? {
        drawable: { positioned, strategy: candidate.strategy, violations: [...findings.map(finding => finding.drawable!), ...hard.map(rubricViolation)], complete: rubric !== undefined },
      } : {}),
    }
  } catch (error) {
    // A successful alternative cannot hide a broken pass or exceeded input work limit.
    if (strictProducer || error instanceof LayoutPassContractError || error instanceof DiagramWorkLimitError || error instanceof DeferredDependencyError) throw error
    return { attempt: { strategy: candidate.strategy, violations: [error instanceof Error ? error.message : String(error)] } }
  }
}

function preferredCandidate(first: CertifiedCandidate, alternative: CertifiedCandidate): {
  selected: CertifiedCandidate
  reason: LayoutPreferenceEvidence['reason']
} {
  for (const criterion of PREFERENCE_ORDER) {
    if (alternative.score[criterion] < first.score[criterion]) return { selected: alternative, reason: criterion }
    if (alternative.score[criterion] > first.score[criterion]) return { selected: first, reason: criterion }
  }
  return { selected: first, reason: 'candidate-order' }
}

/** Report-mode fallback when no candidate certifies. Deterministic: fewest
 * misleading violations, then fewest violations, then candidate order. A
 * candidate that changed authored meaning, lost geometry or threw is never
 * drawn. Candidates rejected before their rubric ran are completed here, so
 * every compared count covers the same checks. */
function bestDrawableCandidate(graph: MermaidGraph, style: ResolvedRenderStyle, drawable: readonly DrawableCandidate[]): DrawableCandidate | undefined {
  let best: { candidate: DrawableCandidate; misleading: number } | undefined
  for (const candidate of drawable) {
    if (!candidate.complete) {
      try { candidate.violations.push(...hardViolations(assessLayout(graph, candidate.positioned, style)).map(rubricViolation)) } catch { continue }
      candidate.complete = true
    }
    const misleading = candidate.violations.filter(violation => MISLEADING_VIOLATIONS.has(violation.kind)).length
    if (!best || misleading < best.misleading || (misleading === best.misleading && candidate.violations.length < best.candidate.violations.length)) best = { candidate, misleading }
  }
  return best?.candidate
}

function selectCertifiedCandidates(graph: MermaidGraph, style: ResolvedRenderStyle, candidates: readonly LayoutCertificationCandidate[], preliminary: LayoutCertificationCandidate | undefined, purpose: 'final' | 'placement', allowUncertified: boolean): CertifiedSelection | UncertifiedSelection {
  const attempts: LayoutCertificationAttempt[] = []
  const drawable: DrawableCandidate[] = []
  // A conditional producer must not evict the fourth established fallback.
  const fallbacks = candidates.slice(0, MAX_LAYOUT_CANDIDATES)
  const bounded = preliminary ? [preliminary, ...fallbacks] : fallbacks
  let deferred: CertifiedCandidate | undefined
  let probe: 'readability' | 'routing' | undefined
  let rejected = false
  const compared: CertifiedSelection['compared'] = []
  const accept = (selected: CertifiedCandidate, reason: LayoutPreferenceEvidence['reason']): CertifiedSelection =>
    ({ selected, reason, compared, attempts: attempts.length })
  for (const [index, candidate] of bounded.entries()) {
    if (deferred && probe === 'routing' && candidate.qualityAlternative === false) continue
    if (rejected) {
      observeFallback('layout-candidate', 'candidate-rejected', attempts.length + 1)
      rejected = false
    }
    const result = certifyCandidateForPurpose(graph, style, candidate, false, purpose)
    attempts.push(result.attempt)
    if (result.drawable) drawable.push(result.drawable)
    const certified = result.certified
    if (certified) {
      compared.push({ strategy: certified.strategy, score: certified.score })
      if (deferred) {
        const choice = preferredCandidate(deferred, certified)
        return accept(choice.selected, choice.reason)
      }
      const alternatives = bounded.slice(index + 1)
      if (certified.score.unreadableTitles && alternatives.length > 0) {
        deferred = certified
        probe = 'readability'
        continue
      }
      if (certified.score.edgeCrossings === 0 && certified.score.labelConflicts === 0) return accept(certified, 'first-certified')
      if (!withinLayoutPreferenceBudget(graph)) return accept(certified, 'work-budget')
      if (!alternatives.some(alternative => alternative.qualityAlternative !== false)) return accept(certified, 'no-alternative')
      deferred = certified
      probe = 'routing'
      continue
    }
    if (deferred) return accept(deferred, 'alternative-invalid')
    rejected = true
  }
  if (deferred) return accept(deferred, 'no-alternative')
  const uncertified = allowUncertified ? bestDrawableCandidate(graph, style, drawable) : undefined
  if (uncertified) return { uncertified, attempts: attempts.length }
  throw new LayoutCertificationError(attempts)
}

function retainUncertified(graph: MermaidGraph, selection: UncertifiedSelection): PositionedGraph {
  const { uncertified: { positioned, strategy, violations }, attempts } = selection
  retainAuthoredMembership(graph, positioned)
  const receipt: UncertifiedLayoutReceipt = { status: 'uncertified', strategy, attempts, violations }
  delete positioned.certification
  positioned.uncertifiedLayout = receipt
  return positioned
}

export function retainSelection(graph: MermaidGraph, selection: CertifiedSelection): PositionedGraph {
  const { selected, reason, compared, attempts } = selection
  retainAuthoredMembership(graph, selected.positioned)
  selected.positioned.certification = {
    status: 'passed', strategy: selected.strategy, attempts, hardViolations: 0,
    preference: { selectedScore: selected.score, reason, compared },
  }
  return selected.positioned
}

/** @internal Family placement retains every authored relationship's influence
 * but returns no generic routes or route certificate for a family to misuse.
 * An uncertified placement is left to the family's final certification. */
export function certifyLayoutPlacementCandidates(graph: MermaidGraph, style: ResolvedRenderStyle, candidates: readonly LayoutCertificationCandidate[], preliminary?: LayoutCertificationCandidate, allowUncertified = false): Pick<PositionedGraph, 'width' | 'height' | 'nodes' | 'groups'> {
  const selection = selectCertifiedCandidates(graph, style, candidates, preliminary, 'placement', allowUncertified)
  const positioned = 'uncertified' in selection ? selection.uncertified.positioned : selection.selected.positioned
  retainAuthoredMembership(graph, positioned)
  const { width, height, nodes, groups } = positioned
  return { width, height, nodes, groups }
}

/** Hard feasibility gates every candidate. One additional certified alternative
 * may improve a title or a bounded graph with label conflicts or crossings.
 * Stable candidate-order ties never initiate another expensive production.
 * With `allowUncertified` (report layout safety), a graph no candidate
 * certifies returns its best drawable candidate with an uncertified receipt. */
export function certifyLayoutCandidates(graph: MermaidGraph, style: ResolvedRenderStyle, candidates: readonly LayoutCertificationCandidate[], preliminary?: LayoutCertificationCandidate, allowUncertified = false): PositionedGraph {
  const selection = selectCertifiedCandidates(graph, style, candidates, preliminary, 'final', allowUncertified)
  return 'uncertified' in selection ? retainUncertified(graph, selection) : retainSelection(graph, selection)
}

/** Select placement, then optionally certify one new route proposal. The baseline
 * and score stay private to this invocation; an attached public receipt is never
 * accepted as proof that caller-owned geometry was already checked. */
export function certifyLayoutWithRouteAlternative(
  graph: MermaidGraph,
  style: ResolvedRenderStyle,
  candidates: readonly LayoutCertificationCandidate[],
  routeFor: (placed: PositionedGraph, score: Readonly<LayoutPreferenceScore>) =>
    (LayoutCertificationCandidate & { strategy: 'without-generic-bundling' }) | undefined,
  preliminary?: LayoutCertificationCandidate,
  allowUncertified = false,
): PositionedGraph {
  const placement = selectCertifiedCandidates(graph, style, candidates, preliminary, 'final', allowUncertified)
  // An uncertified placement has no certified score to compare a route against.
  if ('uncertified' in placement) return retainUncertified(graph, placement)
  const placed = retainSelection(graph, placement)
  const alternative = routeFor(placed, placement.selected.score)
  if (!alternative) return placed
  const baseline = { ...placement.selected, strategy: 'bundled' }
  const result = certifyCandidate(graph, style, alternative)
  const compared = [{ strategy: baseline.strategy, score: baseline.score }]
  if (result.certified) compared.push({ strategy: result.certified.strategy, score: result.certified.score })
  const choice = result.certified ? preferredCandidate(baseline, result.certified)
    : { selected: baseline, reason: 'alternative-invalid' as const }
  const routed = choice.selected.positioned
  retainAuthoredMembership(graph, routed)
  routed.certification = {
    ...placed.certification!,
    preference: {
      ...placed.certification!.preference,
      selectedScore: choice.selected.score,
      routing: {
        strategy: choice.selected === baseline ? 'bundled' : alternative.strategy,
        preference: { selectedScore: choice.selected.score, reason: choice.reason, compared },
      },
    },
  }
  return routed
}
