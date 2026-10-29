import { erCardinalityEnvelope, erCardinalityInk, erLabelPillInk, type ErGeometryWork } from './cardinality-geometry.ts'
import { ErLabelWorkLimitError, ErRouteWorkLimitError, ErRouteGeometryError } from './errors.ts'
export { ErRouteWorkLimitError, ErRouteGeometryError } from './errors.ts'
import { resolveLabelContent, type DisplayTextInput } from '../shared/display-text.ts'
import { assertErDiagramWork, DIAGRAM_WORK_LIMITS } from '../shared/diagram-limits.ts'
import { preparePixelText, type PixelTextBlock } from '../shared/prepared-text.ts'
import { resolveRoleStyle } from '../scene/style-registry.ts'
import { projectRoundedConnectorPath } from '../scene/connector-geometry.ts'
import { visitTypedPathSegments } from '../scene/bounds.ts'
/**
 * ER measured layout adapters.
 *
 * Each entity box has:
 *   1. Header (entity name)
 *   2. Attribute rows (type, name, keys)
 */

import type { ElkNode, ElkExtendedEdge } from 'elkjs'
import type { ErAttribute, ErDiagram, ErEntity, PositionedErDiagram, PositionedErEntity, PositionedErRelationship } from './types.ts'
import type { RenderOptions, Point, Direction, PositionedNode, PositionedEdge } from '../types.ts'
import type { MermaidFrontmatterMap } from '../mermaid-source.ts'
import { getFrontmatterScalar } from '../mermaid-source.ts'
import { FONT_SIZES, FONT_WEIGHTS, STROKE_WIDTHS, resolveRenderStyle, diagramTitleBand, positionDiagramTitle, titleOnlyCanvas } from '../styles.ts'
import type { RenderStyleDefaults, ResolvedRenderStyle } from '../styles.ts'
import type { InternalStyleFace } from '../scene/style-registry.ts'
import { elkLayoutSync } from '../elk-instance.ts'
import { alignElkRoundoff } from '../layout/elk-roundoff.ts'
import { directionToElk } from '../layout/backend.ts'
import { layoutAgenticGraph } from '../layout/agentic-layered.ts'
import { runMeasuredGraphBackend } from '../layout/backend.ts'
import { LayoutCertificationError } from '../layout/certification-error.ts'
import { measureRenderStage } from '../render-stages.ts'
import { checkedAuthoredStyle } from '../shared/style-props.ts'
import { configSpacing } from '../shared/config-spacing.ts'
import { erCommentText } from './text.ts'
import { rerouteEdgesThroughNodes } from '../layout/passes/obstacle-routing.ts'
import { segmentThroughShape } from '../layout-rubric.ts'
import { generatedIds } from '../shared/generated-identity.ts'
import { simplifyPolyline } from '../route-contracts.ts'
import { calculatePathMidpoint } from '../layout/geometry.ts'
import { erCandidateCaptionClear, erRelationshipBlock, finalizeErRelationshipLabels, retainedErRelationshipLabels, separateRelationshipLabels } from './label-layout.ts'
export { erRelationshipBlock } from './label-layout.ts'
export { erCommentText } from './text.ts'

/** Layout constants for ER diagrams */
const ER = {
  padding: 40,
  boxPadX: 14,
  headerHeight: 34,
  rowHeight: 22,
  minWidth: 140,
  attrFontSize: 11,
  attrFontWeight: 400,
  nodeSpacing: 70,
  layerSpacing: 90,
} as const

/** Shared by layout (sizing) and renderer (drawing) — keep it single-sourced. */
export const ER_STYLE_DEFAULTS: RenderStyleDefaults = {
  nodeLabelFontSize: FONT_SIZES.nodeLabel,
  edgeLabelFontSize: FONT_SIZES.edgeLabel,
  groupHeaderFontSize: FONT_SIZES.groupHeader,
  nodeLabelFontWeight: 700, // entity headers are drawn bold; measure them bold too
  edgeLabelFontWeight: FONT_WEIGHTS.edgeLabel,
  groupHeaderFontWeight: FONT_WEIGHTS.groupHeader,
  nodePaddingX: ER.boxPadX,
  nodePaddingY: 8,
  nodeCornerRadius: 0,
  nodeLineWidth: STROKE_WIDTHS.outerBox,
  edgeLineWidth: STROKE_WIDTHS.connector,
  groupCornerRadius: 0,
  groupPaddingX: ER.boxPadX,
  groupPaddingY: 8,
  groupLineWidth: STROKE_WIDTHS.outerBox,
}

/**
 * Fold the typed `er` frontmatter config section into the layout inputs
 * (wire-or-warn, P4): layoutDirection + nodeSpacing/rankSpacing are the wired
 * keys. Precedence: an in-body `direction` statement > er.layoutDirection >
 * the LR default; explicit RenderOptions spacing > er.nodeSpacing/rankSpacing.
 * The documented-but-unwired keys are named by verify's INEFFECTIVE_CONFIG
 * lint (the family's config.noopKeys in src/agent/families.ts).
 */
export function applyErFrontmatterConfig(
  diagram: ErDiagram,
  frontmatter: MermaidFrontmatterMap | undefined,
  options: RenderOptions,
): { diagram: ErDiagram; options: RenderOptions } {
  return {
    diagram: applyErFrontmatterDirection(diagram, frontmatter),
    options: resolveErRenderOptions(frontmatter, options),
  }
}

/** Resolve only the source-owned direction. Request-boundary option
 * normalization is intentionally separate so layout never rewrites options. */
export function applyErFrontmatterDirection(
  diagram: ErDiagram,
  frontmatter: MermaidFrontmatterMap | undefined,
): ErDiagram {
  if (!frontmatter) return diagram
  const rawDirection = getFrontmatterScalar<string>(frontmatter, ['er', 'layoutDirection'])
  const layoutDirection = typeof rawDirection === 'string' && /^(TB|TD|BT|LR|RL)$/i.test(rawDirection)
    ? rawDirection.toUpperCase() as Direction
    : undefined
  return diagram.direction === undefined && layoutDirection !== undefined
    ? { ...diagram, direction: layoutDirection }
    : diagram
}

/** Fold ER spacing into the canonical request once. */
export function resolveErRenderOptions(
  frontmatter: MermaidFrontmatterMap | undefined,
  options: RenderOptions,
): RenderOptions {
  if (!frontmatter) return options
  const nodeSpacing = configSpacing(frontmatter, 'er', 'nodeSpacing')
  const rankSpacing = configSpacing(frontmatter, 'er', 'rankSpacing')
  return nodeSpacing === undefined && rankSpacing === undefined
    ? options
    : { ...options, nodeSpacing: options.nodeSpacing ?? nodeSpacing, layerSpacing: options.layerSpacing ?? rankSpacing }
}

export function erHeaderBlock(text: DisplayTextInput, style: ResolvedRenderStyle): PixelTextBlock {
  return preparePixelText(text, { transform: style.nodeTextTransform, fontSize: style.nodeLabelFontSize, fontWeight: style.nodeLabelFontWeight, letterSpacing: style.nodeLetterSpacing })
}

export function erGroupBlock(text: DisplayTextInput, style: ResolvedRenderStyle): PixelTextBlock {
  return preparePixelText(text, { transform: style.groupTextTransform, fontSize: style.groupHeaderFontSize, fontWeight: style.groupHeaderFontWeight, letterSpacing: style.groupLetterSpacing })
}



export function erAttributeBlocks(attr: ErAttribute) {
  const mono = { display: 'literal' as const, fontSize: ER.attrFontSize, fontWeight: ER.attrFontWeight, monospace: true }
  return {
    type: preparePixelText(attr.type, mono), name: preparePixelText(attr.name, mono),
    keys: preparePixelText(attr.keys.join(','), { display: 'literal', fontSize: 9, fontWeight: 600 }),
    ...(attr.comment ? { comment: preparePixelText(erCommentText(attr.comment, attr.commentContent), { display: 'literal', fontSize: ER.attrFontSize, fontWeight: 400 }) } : {}),
  }
}

export function erEmptyAttributeBlock(): PixelTextBlock {
  return preparePixelText('<i>(no attributes)</i>', { fontSize: ER.attrFontSize, fontWeight: ER.attrFontWeight })
}

function prepareErText(positioned: PositionedErDiagram, style: ResolvedRenderStyle, styleFace?: Readonly<InternalStyleFace>): PositionedErDiagram {
  for (const entity of positioned.entities) {
    entity.labelBlock = erHeaderBlock(resolveLabelContent(entity.label, entity.labelContent), style)
    entity.attributeBlocks = entity.attributes.map(erAttributeBlocks)
    if (entity.attributes.length === 0) entity.emptyAttributeBlock = erEmptyAttributeBlock()
  }
  for (const group of positioned.groups) group.labelBlock ??= erGroupBlock(resolveLabelContent(group.label, group.labelContent), style)
  for (const rel of positioned.relationships) rel.labelBlock ??= erRelationshipBlock(rel, style, styleFace)
  return positioned
}

type EntitySizeMap = Map<string, { width: number; height: number; headerHeight: number }>

/** An ancestor endpoint meets its descendant from the same bottom face, in
 * reserved interior space rather than through the descendant's contents. */
function erInteriorCorridors(diagram: ErDiagram, blocks: readonly PixelTextBlock[]) {
  const groupParents = new Map(diagram.groups.map(group => [group.id, group.parentId]))
  const parents = new Map([...diagram.entities.map(entity => [entity.id, entity.groupId] as const), ...groupParents])
  const isAncestor = (id: string, descendant: string) => {
    for (let parent = parents.get(descendant), depth = 0; parent !== undefined && groupParents.has(parent) && depth < DIAGRAM_WORK_LIMITS.nesting; parent = groupParents.get(parent), depth++) if (parent === id) return true
    return false
  }
  const padding = new Map<string, number>(), exits = new Map<string, number>(), ancestors = new Map<string, number[]>()
  for (const [index, rel] of diagram.relationships.entries()) {
    const ancestor = isAncestor(rel.entity1, rel.entity2) ? rel.entity1 : isAncestor(rel.entity2, rel.entity1) ? rel.entity2 : undefined
    if (!ancestor) continue
    // Actual label halo, two 18px cardinality zones and clearance on each side.
    padding.set(ancestor, (padding.get(ancestor) ?? 0) + blocks[index]!.height + 56)
    const descendant = ancestor === rel.entity1 ? rel.entity2 : rel.entity1
    exits.set(descendant, Math.max(exits.get(descendant) ?? 0, blocks[index]!.height + 40))
    const indices = ancestors.get(ancestor) ?? []
    indices.push(index); ancestors.set(ancestor, indices)
  }
  const lanes = new Map<number, number>()
  for (const indices of ancestors.values()) indices.forEach((index, lane) => lanes.set(index, (lane + 1) / (indices.length + 1)))
  return { padding, exits, lanes }
}

function erInteriorRoute(from: { x: number; y: number; width: number; height: number }, to: { x: number; y: number; width: number; height: number }, fraction: number): Point[] {
  const x = Math.max(from.x, to.x) + (Math.min(from.x + from.width, to.x + to.width) - Math.max(from.x, to.x)) * fraction
  return [{ x, y: from.y + from.height }, { x, y: to.y + to.height }]
}

function erPreferredLabelBounds(relationships: readonly PositionedErRelationship[], blocks: readonly PixelTextBlock[]) {
  return relationships.flatMap((rel, index) => {
    if (!rel.label || rel.points.length < 2) return []
    const mid = rel.labelPosition ?? calculatePathMidpoint(rel.points), block = blocks[index]!
    return [{ x0: mid.x - block.width / 2 - 8, x1: mid.x + block.width / 2 + 8, y0: mid.y - block.height / 2 - 8, y1: mid.y + block.height / 2 + 8 }]
  })
}





function erCharge(work: ErGeometryWork, count = 1): void {
  work.operations += count
  if (work.operations > 400_000) throw new ErRouteWorkLimitError()
}

function erSimpleRoute(points: readonly Point[], work: ErGeometryWork): boolean {
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]!, b = points[i]!, vertical = a.x === b.x
    erCharge(work)
    if (![a.x, a.y, b.x, b.y].every(Number.isFinite) || a.x !== b.x && a.y !== b.y || a.x === b.x && a.y === b.y) return false
    for (let j = 1; j < i; j++) {
      erCharge(work)
      const c = points[j - 1]!, d = points[j]!, otherVertical = c.x === d.x
      if (vertical === otherVertical) {
        const fixed = vertical ? 'x' : 'y', axis = vertical ? 'y' : 'x'
        if (a[fixed] !== c[fixed]) continue
        const low = Math.max(Math.min(a[axis], b[axis]), Math.min(c[axis], d[axis]))
        const high = Math.min(Math.max(a[axis], b[axis]), Math.max(c[axis], d[axis]))
        if (j === i - 1 ? low < high : low <= high) return false
      } else if (j !== i - 1) {
        const x = vertical ? a.x : c.x, y = vertical ? c.y : a.y
        if (x >= Math.min(a.x, b.x) && x <= Math.max(a.x, b.x) && y >= Math.min(a.y, b.y) && y <= Math.max(a.y, b.y)
          && x >= Math.min(c.x, d.x) && x <= Math.max(c.x, d.x) && y >= Math.min(c.y, d.y) && y <= Math.max(c.y, d.y)) return false
      }
    }
  }
  return true
}

function canonicalErContacts(entities: PositionedErEntity[], groups: PositionedErDiagram['groups'], relationships: PositionedErRelationship[], work: ErGeometryWork): void {
  const subjects = new Map([...entities, ...groups].map(box => [box.id, box]))
  const groupIds = new Set(groups.map(group => group.id))
  const charge = (count = 1) => erCharge(work, count)
  const parents = new Map([...entities.map(entity => [entity.id, entity.groupId] as const), ...groups.map(group => [group.id, group.parentId] as const)])
  const ancestor = (owner: string, child: string): boolean => {
    for (let parent = parents.get(child), depth = 0; parent !== undefined && depth < DIAGRAM_WORK_LIMITS.nesting; parent = parents.get(parent), depth++) {
      charge()
      if (parent === owner) return true
    }
    return false
  }
  for (const rel of relationships) for (const end of [false, true]) {
    const id = end ? rel.entity2 : rel.entity1, other = end ? rel.entity1 : rel.entity2, box = subjects.get(id)
    const point = end ? rel.points.at(-1) : rel.points[0]
    if (!box || !point) continue
    const next = (end ? [...rel.points].reverse() : rel.points).find(q => q.x !== point.x || q.y !== point.y)
    charge(rel.points.length)
    if (!next) continue
    // The family owns clipping: select the existing owned ray, then construct
    // its plane from the final retained rectangle. Never compare with epsilon
    // or the SVG number formatter. An ancestor's inward contact stays on S.
    if (groupIds.has(id) && ancestor(id, other)) {
      if (next.x !== point.x) throw new ErRouteGeometryError(rel.entity1, rel.entity2)
      point.y = box.y + box.height
    } else {
      // An exact retained face also identifies the terminal axis when producer
      // arithmetic gave its neighboring corner a different last bit. Rebuild
      // that corner from the endpoint's one authoritative cross coordinate.
      const horizontal = next.y === point.y && next.x !== point.x || (point.x === box.x || point.x === box.x + box.width) && next.x !== point.x
      const vertical = next.x === point.x && next.y !== point.y || (point.y === box.y || point.y === box.y + box.height) && next.y !== point.y
      if (horizontal) { point.x = next.x > point.x ? box.x + box.width : box.x; next.y = point.y }
      else if (vertical) { point.y = next.y > point.y ? box.y + box.height : box.y; next.x = point.x }
    }
  }
}

/** Reroute each relationship whose route crosses an unrelated card or a group
 * header: a route to a group frame, or one rebuilt after separating compounds
 * moved only one of its ends. */
function repairErFrameRoutes(entities: PositionedErEntity[], groups: PositionedErDiagram['groups'], relationships: PositionedErRelationship[], blocks: readonly PixelTextBlock[], style: ResolvedRenderStyle, styleFace?: Readonly<InternalStyleFace>, work: ErGeometryWork = { operations: 0 }, caption?: { indices: ReadonlySet<number>; admit: (index: number, points: Point[]) => boolean }): void {
  canonicalErContacts(entities, groups, relationships, work)
  const glyphLineWidth = style.lineWidth
  const generated = generatedIds([...entities.map(entity => entity.id), ...groups.map(group => group.id)])
  const groupIds = new Set(groups.map(group => group.id)), entityIds = new Map<string, string>(), headerIds = new Map<string, string>()
  const obstacles: PositionedNode[] = [
    ...entities.map(entity => {
      const id = generated(`er-entity:${entity.id}`, ['er', 'entity', entity.id]); entityIds.set(id, entity.id)
      const authored = Number.parseFloat(entity.inlineStyle?.['stroke-width'] ?? '')
      const half = (Number.isFinite(authored) && authored > 0 ? authored : style.nodeLineWidth) / 2
      return { ...entity, id, x: entity.x - half, y: entity.y - half, width: entity.width + 2 * half, height: entity.height + 2 * half, shape: 'rectangle' as const }
    }),
    ...groups.map(group => { const id = generated(`er-header:${group.id}`, ['er', 'header', group.id]); headerIds.set(id, group.id); return { ...group, id, height: group.headerHeight, shape: 'rectangle' as const } }),
  ]
  const charge = (count: number) => erCharge(work, count)
  for (const [index, rel] of relationships.entries()) {
    if (caption && !caption.indices.has(index)) continue
    if (rel.points.length < 2) continue
    const [start, end] = [rel.points[0]!, rel.points.at(-1)!]
    const roleStyle = resolveRoleStyle(styleFace, 'relationship', { category: rel.identifying ? 'identifying' : 'non-identifying' }, { includeFallback: false })
    // A clear sharp polyline can still cut a card when its corners are rounded.
    // Both producers reserve their actual rendered bend/stroke envelope.
    const clearance = (roleStyle?.bendRadius ?? style.edgeBendRadius) + 2 * (roleStyle?.lineWidth ?? style.lineWidth)
    const physical = obstacles.filter(node => { const id = entityIds.get(node.id); return id === undefined || groupIds.has(id) || id !== rel.entity1 && id !== rel.entity2 })
      .map(node => clearance && headerIds.get(node.id) !== rel.entity1 && headerIds.get(node.id) !== rel.entity2
        ? { ...node, x: node.x - clearance, y: node.y - clearance, width: node.width + 2 * clearance, height: node.height + 2 * clearance } : node)
    const blocked = (points: Point[]) => points.slice(1).some((point, i) => physical.some(node => { charge(1); return segmentThroughShape(points[i]!, point, node) }))
    const enoughLead = (at: Point, toward: Point, cardinality: PositionedErRelationship['cardinality1']) => {
      const pieces = erCardinalityInk(at, toward, cardinality, glyphLineWidth)
      charge(2 + (pieces?.length ?? 0))
      if (!pieces?.length) return false
      const horizontal = at.y === toward.y, sign = Math.sign(horizontal ? toward.x - at.x : toward.y - at.y)
      const depth = Math.max(...pieces.map(piece => sign > 0 ? (horizontal ? piece.x1 - at.x : piece.y1 - at.y) : (horizontal ? at.x - piece.x0 : at.y - piece.y0)))
      const length = Math.abs(horizontal ? toward.x - at.x : toward.y - at.y), radius = roleStyle?.bendRadius ?? style.edgeBendRadius
      const neighbor = at === start ? rel.points[2] : rel.points.at(-3)
      const nextLength = neighbor ? Math.abs(neighbor.x - toward.x) + Math.abs(neighbor.y - toward.y) : length
      const remaining = length - (rel.points.length > 2 ? Math.min(radius, length / 2, nextLength / 2) : 0)
      return remaining >= depth
    }
    if (!blocked(rel.points) && erSimpleRoute(rel.points, work)
      && enoughLead(start, rel.points[1]!, rel.cardinality1)
      && enoughLead(end, rel.points.at(-2)!, rel.cardinality2) && (!caption || caption.admit(index, rel.points))) continue
    // A replacement route does not preserve the producer's reserved segment.
    delete rel.labelPosition
    // Keep actual cardinality-bearing face contacts; shared routing owns only
    // the middle beyond each complete emitted glyph and rounded terminal.
    const next = rel.points.find(point => point.x !== start.x || point.y !== start.y)!, previous = [...rel.points].reverse().find(point => point.x !== end.x || point.y !== end.y)!
    const terminalZones: PositionedNode[] = []
    const middleClearance = 1 // routeClearOfNodes' actual clearance
    const glyphStroke = glyphLineWidth + .25
    const stem = (point: Point, toward: Point, id: string, cardinality: PositionedErRelationship['cardinality1']): PositionedNode => {
      const ray = { x: Math.sign(toward.x - point.x), y: Math.sign(toward.y - point.y) }
      const pieces = erCardinalityInk(point, toward, cardinality, glyphLineWidth)
      charge(2 + (pieces?.length ?? 0))
      if (!pieces?.length) throw new ErRouteGeometryError(rel.entity1, rel.entity2)
      const depth = Math.max(0, ...pieces.map(piece => ray.x > 0 ? piece.x1 - point.x : ray.x < 0 ? point.x - piece.x0 : ray.y > 0 ? piece.y1 - point.y : point.y - piece.y0))
      const protectedLength = depth + (roleStyle?.bendRadius ?? style.edgeBendRadius) + glyphStroke
      // A self-loop's middle lies beside its own card. Its caption must fit
      // there as well as its markers; terminal-only clipping cannot reserve
      // this cross-axis footprint for the generic middle router.
      const block = blocks[index]!, captionHalf = (ray.x ? block.width : block.height) / 2 + 8
      const captionLead = rel.entity1 === rel.entity2 && rel.label ? depth + captionHalf + middleClearance + glyphStroke + style.nodeLineWidth / 2 : 0
      const minimumAnchor = Math.max(protectedLength + middleClearance + glyphStroke, captionLead)
      let length = Math.max(20, minimumAnchor)
      for (const node of physical) {
        charge(1)
        if (!(ray.x ? point.y > node.y && point.y < node.y + node.height : point.x > node.x && point.x < node.x + node.width)) continue
        const gap = ray.x > 0 ? node.x - point.x : ray.x < 0 ? point.x - node.x - node.width : ray.y > 0 ? node.y - point.y : point.y - node.y - node.height
        // Leave the middle router's actual clearance beyond its virtual
        // endpoint. Never consume the real glyph-bearing normal stem.
        if (gap >= 0) length = Math.min(length, gap - middleClearance - glyphStroke)
      }
      if (length < minimumAnchor) throw new ErRouteGeometryError(rel.entity1, rel.entity2)
      const cross = Math.max(0, ...pieces.map(piece => ray.x ? Math.max(point.y - piece.y0, piece.y1 - point.y) : Math.max(point.x - piece.x0, piece.x1 - point.x)))
      const tip = { x: point.x + ray.x * protectedLength, y: point.y + ray.y * protectedLength }
      charge(pieces.length + 2)
      terminalZones.push({ id: generated(`er-terminal:${index}:${terminalZones.length}`, ['er', 'terminal', index, terminalZones.length]), label: '', shape: 'rectangle',
        x: ray.x ? Math.min(point.x, tip.x) : point.x - cross, y: ray.y ? Math.min(point.y, tip.y) : point.y - cross,
        width: ray.x ? protectedLength : cross * 2, height: ray.y ? protectedLength : cross * 2 })
      return { id, label: '', shape: 'rectangle', x: point.x + ray.x * length, y: point.y + ray.y * length, width: 0, height: 0 }
    }
    const from = stem(start, next, rel.entity1, rel.cardinality1), to = stem(end, previous, rel.entity2, rel.cardinality2)
    const middleBlocked = (points: Point[]) => blocked(points) || points.slice(1).some((point, i) => terminalZones.some(node => { charge(1); return segmentThroughShape(points[i]!, point, node) }))
    const block = blocks[index]!, padX = block.width / 2 + 8, padY = block.height / 2 + 8
    const padded = physical.map(node => ({ ...node, x: node.x - padX, y: node.y - padY, width: node.width + padX * 2, height: node.height + padY * 2 }))
    const middleScopes: PositionedNode[][] = [padded]
    charge(physical.length)
    const edge: PositionedEdge = { source: from.id, target: to.id, style: 'solid', hasArrowStart: false, hasArrowEnd: false, points: [{ x: from.x, y: from.y }, ...rel.points.slice(1, -1), { x: to.x, y: to.y }] }
    const direction = Math.abs(end.x - start.x) >= Math.abs(end.y - start.y) ? end.x >= start.x ? 'LR' : 'RL' : end.y >= start.y ? 'TB' : 'BT'
    rerouteEdgesThroughNodes([...padded, ...terminalZones, from, to], [edge], { direction }, charge)
    if (middleBlocked(edge.points)) {
      // A header approach can fit the actual terminal stem without fitting a
      // label along that stem. Keep measured label width in the long aisle,
      // while allowing the physical approach along the flow axis.
      charge(physical.length)
      const crossPadded = physical.map(node => direction === 'TB' || direction === 'BT'
        ? { ...node, x: node.x - padX, width: node.width + padX * 2 }
        : { ...node, y: node.y - padY, height: node.height + padY * 2 })
      middleScopes.push(crossPadded)
      rerouteEdgesThroughNodes([...crossPadded, ...terminalZones, from, to], [edge], { direction }, charge)
    }
    if (middleBlocked(edge.points)) {
      // A wide header can separate vertically attached ports even when their
      // centers differ more in x. Try the other aisle within the same budget.
      const otherDirection = direction === 'LR' || direction === 'RL' ? end.y >= start.y ? 'TB' : 'BT' : end.x >= start.x ? 'LR' : 'RL'
      charge(physical.length)
      const otherPadded = physical.map(node => otherDirection === 'TB' || otherDirection === 'BT'
        ? { ...node, x: node.x - padX, width: node.width + padX * 2 }
        : { ...node, y: node.y - padY, height: node.height + padY * 2 })
      middleScopes.push(otherPadded)
      rerouteEdgesThroughNodes([...otherPadded, ...terminalZones, from, to], [edge], { direction: otherDirection }, charge)
    }
    const composedClear = (middle: Point[]) => {
      if (middleBlocked(middle)) return false
      const points = simplifyPolyline([start, ...middle, end])
      return erSimpleRoute(points, work) && (!caption || caption.admit(index, points))
    }
    if (!composedClear(edge.points)) {
      // The generic bracket tries a fixed 12px hop and obstacle±10 lanes. A
      // narrow legal channel may instead be exactly on a virtual endpoint's
      // axis. Keep that axis in the finite one/two-bend corner roster.
      let found: Point[] | undefined
      for (const scope of [...middleScopes, physical]) {
        const xs = [from.x, to.x], ys = [from.y, to.y]
        for (const node of [...scope, ...terminalZones]) {
          charge(4)
          xs.push(node.x - glyphStroke, node.x + node.width + glyphStroke)
          ys.push(node.y - glyphStroke, node.y + node.height + glyphStroke)
        }
        xs.sort((a, b) => { charge(1); return Math.abs(a - (from.x + to.x) / 2) - Math.abs(b - (from.x + to.x) / 2) || a - b })
        ys.sort((a, b) => { charge(1); return Math.abs(a - (from.y + to.y) / 2) - Math.abs(b - (from.y + to.y) / 2) || a - b })
        charge((xs.length + ys.length + 2) * 4)
        const candidates = [
          [from, { x: to.x, y: from.y }, to], [from, { x: from.x, y: to.y }, to],
          ...xs.map(x => [from, { x, y: from.y }, { x, y: to.y }, to]),
          ...ys.map(y => [from, { x: from.x, y }, { x: to.x, y }, to]),
        ]
        for (const candidate of candidates) {
          const middle = simplifyPolyline(candidate)
          const blockedScope = middle.slice(1).some((point, i) => scope.some(node => { charge(1); return segmentThroughShape(middle[i]!, point, node) }))
          if (!blockedScope && composedClear(middle)) { found = middle; break }
        }
        if (found) break
      }
      if (!found) throw new ErRouteGeometryError(rel.entity1, rel.entity2)
      edge.points = found
    }
    rel.points = simplifyPolyline([start, ...edge.points, end])
    if (blocked(rel.points)) throw new ErRouteGeometryError(rel.entity1, rel.entity2)
  }
}

/** Space between an attribute's name and its comment. */
export const ER_COMMENT_GAP = 12

/** Width of an entity's comment column (0 when no attribute has a comment):
 * Mermaid draws each attribute's comment in a column after its name. */
export function erCommentColumnWidth(attributes: readonly ErAttribute[]): number {
  const widths = attributes.map(attr => attr.comment ? erAttributeBlocks(attr).comment!.width : 0)
  const widest = Math.max(0, ...widths)
  return widest > 0 ? widest + ER_COMMENT_GAP : 0
}

interface ErPlacement {
  width?: number
  height?: number
  entities: { id: string; x?: number; y?: number; width?: number; height?: number }[]
  routes: Map<number, Point[]>
  labelPositions?: Map<number, Point>
  /** Producer-owned selection metadata, independent of requested backend or surviving anchors. */
  labelPlacement?: 'shaft-aware'
  /** Scoped placement repairs must leave cardinalities outside their cards. */
  preserveTerminalNormals?: true
}

function measureErEntities(diagram: ErDiagram, style: ResolvedRenderStyle): EntitySizeMap {
  const entitySizes: EntitySizeMap = new Map()

  for (const entity of diagram.entities) {
    const labelBlock = erHeaderBlock(resolveLabelContent(entity.label, entity.labelContent), style)
    const headerTextW = labelBlock.width
    let maxAttrW = entity.attributes.length === 0 ? erEmptyAttributeBlock().width : 0
    const commentColumn = erCommentColumnWidth(entity.attributes)
    for (const attr of entity.attributes) {
      const blocks = erAttributeBlocks(attr)
      const keySlot = attr.keys.length ? blocks.keys.width + 14 : 0
      const w = blocks.type.width + blocks.name.width + keySlot + ER_COMMENT_GAP + commentColumn
      if (w > maxAttrW) maxAttrW = w
    }
    const width = Math.max(ER.minWidth, headerTextW + style.nodePaddingX * 2, maxAttrW + Math.max(8, style.nodePaddingX) * 2)
    const headerHeight = Math.max(ER.headerHeight, labelBlock.height + style.nodePaddingY * 2)
    const height = headerHeight + Math.max(entity.attributes.length, 1) * ER.rowHeight
    entitySizes.set(entity.id, { width, height, headerHeight })
  }

  return entitySizes
}

/** Construct ELK input only when that backend is selected. */
function buildErElkGraph(
  diagram: ErDiagram,
  options: RenderOptions,
  entitySizes: EntitySizeMap,
  styleFace?: Readonly<InternalStyleFace>,
  work: ErGeometryWork = { operations: 0 },
): { elkGraph: ElkNode; entitySizes: EntitySizeMap } {
  const style = resolveRenderStyle(options, ER_STYLE_DEFAULTS, styleFace)
  // ER cardinalities are real endpoint ink, unlike ELK's zero-sized ports.
  // Reserve their normal reach before ELK chooses nearby return channels.
  // Match Native's conservative per-card incidence capacity as well: ELK may
  // place every incidence on one face, including both ends of a self-loop.
  let markerClearance = 0
  const spans = new Map<string, number>()
  for (const rel of diagram.relationships) {
    const role = resolveRoleStyle(styleFace, 'relationship', { category: rel.identifying ? 'identifying' : 'non-identifying' }, { includeFallback: false })
    for (const [id, cardinality] of [[rel.entity1, rel.cardinality1], [rel.entity2, rel.cardinality2]] as const) {
      // Canonical cardinalities contain at most four shape bounds; debit
      // their construction, union and this retained capacity record together.
      erCharge(work, 12)
      const bound = erCardinalityEnvelope(cardinality, style.lineWidth)
      if (!bound) throw new ErRouteGeometryError(rel.entity1, rel.entity2)
      markerClearance = Math.max(markerClearance, bound.x1 + (role?.bendRadius ?? style.edgeBendRadius) + (role?.lineWidth ?? style.lineWidth) / 2)
      if (entitySizes.has(id)) spans.set(id, (spans.get(id) ?? 0) + bound.y1 - bound.y0 + style.lineWidth + .25)
    }
  }

  const elkGraph: ElkNode = {
    id: 'root',
    layoutOptions: {
      'elk.algorithm': 'layered',
      // direction statement (upstream v11.4+) via the shared flowchart
      // mapping; the fork default stays LR (upstream defaults TB).
      'elk.direction': directionToElk(diagram.direction ?? 'LR'),
      'elk.spacing.nodeNode': String(options.nodeSpacing ?? ER.nodeSpacing),
      'elk.layered.spacing.nodeNodeBetweenLayers': String(options.layerSpacing ?? ER.layerSpacing),
      'elk.padding': `[top=${ER.padding},left=${ER.padding},bottom=${ER.padding},right=${ER.padding}]`,
      'elk.edgeRouting': 'ORTHOGONAL',
      // Locked ELK's default is 10px. Preserve it when it already contains
      // all cardinality ink plus the actual carrier half-width/bend margin.
      ...(markerClearance > 10 ? { 'elk.layered.spacing.edgeNodeBetweenLayers': String(markerClearance) } : {}),
      'elk.edgeLabels.placement': 'CENTER',
    },
    children: [],
    edges: [],
  }

  for (const entity of diagram.entities) {
    const size = entitySizes.get(entity.id)!, span = (spans.get(entity.id) ?? 0) + 2 * Math.max(8, style.cornerRadius ?? 0)
    erCharge(work)
    elkGraph.children!.push({ id: entity.id, width: Math.max(size.width, span), height: Math.max(size.height, span) })
  }

  const entityIds = new Set(diagram.entities.map(entity => entity.id))
  for (let i = 0; i < diagram.relationships.length; i++) {
    const rel = diagram.relationships[i]!
    if (!entityIds.has(rel.entity1) || !entityIds.has(rel.entity2)) continue
    const edge: ElkExtendedEdge = { id: `e${i}`, sources: [rel.entity1], targets: [rel.entity2] }
    if (rel.label) {
      const metrics = erRelationshipBlock(rel, style, styleFace)
      const label = metrics.text
      edge.labels = [{ text: label, width: metrics.width + 8, height: metrics.height + 6 }]
    }
    elkGraph.edges!.push(edge)
  }

  return { elkGraph, entitySizes }
}

/** Project either measured placement through the ER-owned geometry rules. */
function extractErLayout(
  result: ErPlacement,
  diagram: ErDiagram,
  entitySizes: EntitySizeMap,
  style: ResolvedRenderStyle,
  styleFace?: Readonly<InternalStyleFace>,
  work: ErGeometryWork = { operations: 0 },
): PositionedErDiagram {
  const entityLookup = new Map<string, ErEntity>()
  for (const entity of diagram.entities) entityLookup.set(entity.id, entity)

  const positionedEntities: PositionedErEntity[] = []
  const defaultStyle = checkedAuthoredStyle(diagram.classDefs.get('default'), 'classDef default')
  for (const child of result.entities) {
    const entity = entityLookup.get(child.id)
    if (entity) {
      const classStyle: Record<string, string> = { ...defaultStyle }
      for (const name of entity.className?.split(/[ \t]+/) ?? []) Object.assign(classStyle, checkedAuthoredStyle(diagram.classDefs.get(name), `classDef ${name}`))
      positionedEntities.push({
        id: entity.id,
        label: entity.label,
        ...(entity.labelContent ? { labelContent: entity.labelContent } : {}),
        attributes: entity.attributes,
        x: child.x ?? 0,
        y: child.y ?? 0,
        width: child.width ?? entitySizes.get(entity.id)!.width,
        height: child.height ?? entitySizes.get(entity.id)!.height,
        headerHeight: entitySizes.get(entity.id)!.headerHeight,
        rowHeight: ER.rowHeight,
        ...(entity.className ? { className: entity.className } : {}),
        ...(Object.keys(classStyle).length > 0 || entity.inlineStyle ? {
          inlineStyle: { ...classStyle, ...checkedAuthoredStyle(entity.inlineStyle, `style ${entity.id}`) },
        } : {}),
        ...(entity.groupId ? { groupId: entity.groupId } : {}),
      })
    }
  }

  const originalPositions = new Map(positionedEntities.map(entity => [entity.id, { x: entity.x, y: entity.y, width: entity.width, height: entity.height }]))
  const relationshipBlocks = diagram.relationships.map(rel => erRelationshipBlock(rel, style, styleFace))
  const interior = erInteriorCorridors(diagram, relationshipBlocks)
  const framePadding = erFrameInkPadding(diagram, style, styleFace, work)
  applyErGroupDirections(diagram, positionedEntities, relationshipBlocks, style, styleFace, work)
  const positionedGroups = deriveErGroups(diagram, positionedEntities, style, interior.padding, framePadding)
  // Reserve a full terminal zone plus the rounded envelopes of both peers.
  // Otherwise an unrelated card can leave no legal cardinality-bearing stem.
  const siblingGap = result.preserveTerminalNormals ? 20 + 2 * Math.max(style.edgeBendRadius, ...diagram.relationships.map(rel => resolveRoleStyle(styleFace, 'relationship', { category: rel.identifying ? 'identifying' : 'non-identifying' }, { includeFallback: false })?.bendRadius ?? style.edgeBendRadius)) : 20
  separateErCompounds(diagram, positionedEntities, positionedGroups, style, relationshipBlocks, interior.padding, interior.exits, siblingGap, styleFace, work, framePadding)
  const boxes = new Map<string, { x: number; y: number; width: number; height: number }>()
  positionedEntities.forEach(entity => boxes.set(entity.id, entity))
  positionedGroups.forEach(group => boxes.set(group.id, group))
  const edgeById = result.routes
  const relationships: PositionedErRelationship[] = []
  for (let i = 0; i < diagram.relationships.length; i++) {
    const rel = diagram.relationships[i]!
    const from = boxes.get(rel.entity1), to = boxes.get(rel.entity2)
    const originalFrom = originalPositions.get(rel.entity1), originalTo = originalPositions.get(rel.entity2)
    const dx = from && originalFrom ? from.x - originalFrom.x : undefined
    const dy = from && originalFrom ? from.y - originalFrom.y : undefined
    // A local direction or compound repair must not replace an unrelated
    // producer route. Whole-component translations preserve its complete shape.
    const placementRoute = dx !== undefined && dy !== undefined && to && originalTo &&
      Math.abs(to.x - originalTo.x - dx) < 0.001 && Math.abs(to.y - originalTo.y - dy) < 0.001
      && from!.width === originalFrom!.width && from!.height === originalFrom!.height && to.width === originalTo.width && to.height === originalTo.height
      ? edgeById.get(i) : undefined
    const points: Point[] = []
    let labelPosition: Point | undefined
    if (from && to && interior.lanes.has(i)) {
      points.push(...erInteriorRoute(from, to, interior.lanes.get(i)!))
    } else if (placementRoute?.length) {
      points.push(...placementRoute.map(point => ({ x: point.x + dx!, y: point.y + dy! })))
      const reserved = result.labelPositions?.get(i)
      if (reserved) labelPosition = { x: reserved.x + dx!, y: reserved.y + dy! }
    } else {
      if (from && to) {
        points.push(...erExteriorRoute(from, to))
      }
    }
    relationships.push({
      entity1: rel.entity1, entity2: rel.entity2,
      cardinality1: rel.cardinality1, cardinality2: rel.cardinality2,
      label: rel.label, ...(rel.labelContent ? { labelContent: rel.labelContent } : {}), labelBlock: relationshipBlocks[i], identifying: rel.identifying, points,
      ...(labelPosition ? { labelPosition } : {}),
    })
  }

  repairErFrameRoutes(positionedEntities, positionedGroups, relationships, relationshipBlocks, style, styleFace, work)

  // Nested group padding can extend left/top of ELK's entity-only canvas, and
  // group endpoints are routed after ELK. Translate the complete geometry as
  // one unit so group frames, endpoint routes, and their labels retain a real
  // canvas margin instead of being clipped at x/y=0.
  const xs = [
    ...positionedEntities.flatMap(entity => [entity.x, entity.x + entity.width]),
    ...positionedGroups.flatMap(group => [group.x, group.x + group.width]),
    ...relationships.flatMap(relationship => relationship.points.map(point => point.x)),
  ]
  const ys = [
    ...positionedEntities.flatMap(entity => [entity.y, entity.y + entity.height]),
    ...positionedGroups.flatMap(group => [group.y, group.y + group.height]),
    ...relationships.flatMap(relationship => relationship.points.map(point => point.y)),
  ]
  const labelBounds = erPreferredLabelBounds(relationships, relationshipBlocks)
  const dx = Math.max(0, xs.length ? ER.padding - Math.min(...xs) : 0, ...labelBounds.map(box => -box.x0))
  const dy = Math.max(0, ys.length ? ER.padding - Math.min(...ys) : 0, ...labelBounds.map(box => -box.y0))
  if (dx !== 0 || dy !== 0) {
    for (const entity of positionedEntities) { entity.x += dx; entity.y += dy }
    for (const group of positionedGroups) { group.x += dx; group.y += dy }
    for (const relationship of relationships) {
      for (const point of relationship.points) { point.x += dx; point.y += dy }
      if (relationship.labelPosition) { relationship.labelPosition.x += dx; relationship.labelPosition.y += dy }
    }
  }
  const width = Math.max(
    (result.width ?? 600) + dx,
    ...positionedEntities.map(entity => entity.x + entity.width + ER.padding),
    ...positionedGroups.map(group => group.x + group.width + ER.padding),
    ...relationships.flatMap(relationship => relationship.points.map(point => point.x + ER.padding)),
    ...labelBounds.map(box => box.x1 + dx),
  )
  const height = Math.max(
    (result.height ?? 400) + dy,
    ...positionedEntities.map(entity => entity.y + entity.height + ER.padding),
    ...positionedGroups.map(group => group.y + group.height + ER.padding),
    ...relationships.flatMap(relationship => relationship.points.map(point => point.y + ER.padding)),
    ...labelBounds.map(box => box.y1 + dy),
  )
  return {
    width, height,
    accessibilityTitle: diagram.accessibilityTitle,
    accessibilityDescription: diagram.accessibilityDescription,
    entities: positionedEntities,
    relationships,
    groups: positionedGroups,
    ...(result.labelPlacement ? { labelPlacement: result.labelPlacement } : {}),
  }
}

function rectBoundaryToward(box: { x: number; y: number; width: number; height: number }, target: Point): { point: Point; horizontal: boolean } {
  const center = { x: box.x + box.width / 2, y: box.y + box.height / 2 }
  const dx = target.x - center.x, dy = target.y - center.y
  if (Math.abs(dx) * box.height >= Math.abs(dy) * box.width) {
    return { point: { x: dx >= 0 ? box.x + box.width : box.x, y: center.y + (dy / (Math.abs(dx) || 1)) * box.width / 2 }, horizontal: true }
  }
  return { point: { x: center.x + (dx / (Math.abs(dy) || 1)) * box.height / 2, y: dy >= 0 ? box.y + box.height : box.y }, horizontal: false }
}

/** Rebuilt frame routes leave and enter on the normals of the faces actually
 * selected by clipping. The center-to-center dominant axis does not determine
 * those faces for differently sized frames. Existing obstacle repair owns any
 * blocked middle; retained producer routes and ancestor corridors bypass this. */
function erExteriorRoute(from: { x: number; y: number; width: number; height: number }, to: { x: number; y: number; width: number; height: number }): Point[] {
  const start = rectBoundaryToward(from, { x: to.x + to.width / 2, y: to.y + to.height / 2 })
  const end = rectBoundaryToward(to, { x: from.x + from.width / 2, y: from.y + from.height / 2 })
  return erRouteBetweenContacts(start.point, end.point, start.horizontal, end.horizontal)
}

function erRouteBetweenContacts(start: Point, end: Point, startHorizontal: boolean, endHorizontal: boolean): Point[] {
  const points = [start]
  if (start.x !== end.x && start.y !== end.y) {
    if (startHorizontal !== endHorizontal) points.push(startHorizontal ? { x: end.x, y: start.y } : { x: start.x, y: end.y })
    else if (startHorizontal) {
      const x = (start.x + end.x) / 2
      points.push({ x, y: start.y }, { x, y: end.y })
    } else {
      const y = (start.y + end.y) / 2
      points.push({ x: start.x, y }, { x: end.x, y })
    }
  }
  points.push(end)
  return points
}

function applyErGroupDirections(diagram: ErDiagram, entities: PositionedErEntity[], relationshipBlocks: readonly PixelTextBlock[], style: ResolvedRenderStyle, styleFace: Readonly<InternalStyleFace> | undefined, work: ErGeometryWork): Set<string> {
  const moved = new Set<string>()
  for (const group of diagram.groups) {
    if (!group.direction) continue
    const members = group.entityIds.map(id => entities.find(entity => entity.id === id)).filter((entity): entity is PositionedErEntity => Boolean(entity))
    if (members.length < 2) continue
    for (const member of members) moved.add(member.id)
    const horizontal = group.direction === 'LR' || group.direction === 'RL'
    const ordered = group.direction === 'RL' || group.direction === 'BT' ? [...members].reverse() : members
    const ids = new Set(members.map(member => member.id))
    // The scoped adapter replaces producer routes. Retain enough straight corridor
    // for the actual label plus both cardinality glyphs before rerouting.
    const gap = Math.max(48, ...diagram.relationships.flatMap((rel, i) => {
      erCharge(work)
      if (!ids.has(rel.entity1) || !ids.has(rel.entity2)) return []
      const source = erCardinalityEnvelope(rel.cardinality1, style.lineWidth), target = erCardinalityEnvelope(rel.cardinality2, style.lineWidth)
      erCharge(work, 2)
      if (!source || !target) throw new ErRouteGeometryError(rel.entity1, rel.entity2)
      const radius = resolveRoleStyle(styleFace, 'relationship', { category: rel.identifying ? 'identifying' : 'non-identifying' }, { includeFallback: false })?.bendRadius ?? style.edgeBendRadius
      const terminal = Math.max(18, source.x1) + Math.max(18, target.x1) + 2 * radius + 2 * (style.lineWidth + .25)
      return [Math.max(rel.label ? relationshipBlocks[i]![horizontal ? 'width' : 'height'] + 56 : 0,
        terminal + (rel.label ? relationshipBlocks[i]![horizontal ? 'width' : 'height'] + 20 : 0))]
    }))
    const originX = Math.min(...members.map(member => member.x))
    const originY = Math.min(...members.map(member => member.y))
    let cursor = horizontal ? originX : originY
    for (const member of ordered) {
      if (horizontal) { member.x = cursor; member.y = originY; cursor += member.width + gap }
      else { member.x = originX; member.y = cursor; cursor += member.height + gap }
    }
  }
  return moved
}

/** A child glyph can face any side selected by the producer. Reserve its
 * actual maximum reach plus the enclosing frame stroke, with the old 20px
 * padding as a floor. Group ownership never exempts that foreign frame ink. */
function erFrameInkPadding(diagram: ErDiagram, style: ResolvedRenderStyle, styleFace: Readonly<InternalStyleFace> | undefined, work: ErGeometryWork): Map<string, number> {
  const parents = new Map([...diagram.entities.map(entity => [entity.id, entity.groupId] as const), ...diagram.groups.map(group => [group.id, group.parentId] as const)])
  const padding = new Map<string, number>()
  erCharge(work, parents.size)
  for (const rel of diagram.relationships) {
    erCharge(work)
    if (rel.label) {
      const block = erRelationshipBlock(rel, style, styleFace)
      const corridor = block.width + 16 + style.nodeLineWidth + 1.5 + 2 * (style.lineWidth + .25)
      for (const [ancestor, child] of [[rel.entity1, rel.entity2], [rel.entity2, rel.entity1]]) {
        for (let parent = parents.get(child!), depth = 0; parent !== undefined && depth < DIAGRAM_WORK_LIMITS.nesting; parent = parents.get(parent), depth++) {
          erCharge(work)
          if (parent === ancestor) { padding.set(parent, Math.max(padding.get(parent) ?? 20, corridor)); break }
        }
      }
    }
    const radius = resolveRoleStyle(styleFace, 'relationship', { category: rel.identifying ? 'identifying' : 'non-identifying' }, { includeFallback: false })?.bendRadius ?? style.edgeBendRadius
    for (const [id, kind] of [[rel.entity1, rel.cardinality1], [rel.entity2, rel.cardinality2]] as const) {
      const parent = parents.get(id)
      if (!parent) continue
      const bound = erCardinalityEnvelope(kind, style.lineWidth)
      erCharge(work)
      if (!bound) throw new ErRouteGeometryError(rel.entity1, rel.entity2)
      // The parent owns the real glyph-bearing stem and the existing
      // router's virtual endpoint, inflated obstacle, and one-pixel middle
      // clearance. Reserve those exact authorities before deriving the frame.
      const roleWidth = resolveRoleStyle(styleFace, 'relationship', { category: rel.identifying ? 'identifying' : 'non-identifying' }, { includeFallback: false })?.lineWidth ?? style.lineWidth
      const guide = bound.x1 + 2 * radius + 2 * roleWidth + 3 * (style.lineWidth + .25) + 2 + .75
      padding.set(parent, Math.max(padding.get(parent) ?? 20, guide))
    }
  }
  return padding
}

function deriveErGroups(diagram: ErDiagram, entities: PositionedErEntity[], style: ResolvedRenderStyle, bottomPadding: ReadonlyMap<string, number>, framePadding: ReadonlyMap<string, number>): PositionedErDiagram['groups'] {
  const positioned: PositionedErDiagram['groups'] = []
  for (const group of [...diagram.groups].reverse()) {
    const members = [
      ...entities.filter(entity => entity.groupId === group.id),
      ...positioned.filter(child => child.parentId === group.id),
    ]
    const pad = framePadding.get(group.id) ?? 20
    const labelBlock = erGroupBlock(resolveLabelContent(group.label, group.labelContent), style)
    const headerHeight = style.groupHeaderFontSize + 16 + labelBlock.height - labelBlock.lineHeight
    const minX = members.length ? Math.min(...members.map(member => member.x)) - pad : ER.padding
    const minY = members.length ? Math.min(...members.map(member => member.y)) - pad - headerHeight : ER.padding
    const maxX = Math.max(minX + labelBlock.width + 20, members.length ? Math.max(...members.map(member => member.x + member.width)) + pad : minX + 140)
    const maxY = members.length ? Math.max(...members.map(member => member.y + member.height)) + Math.max(pad, bottomPadding.get(group.id) ?? 0) : minY + 90
    positioned.unshift({
      id: group.id, label: group.label, ...(group.labelContent ? { labelContent: group.labelContent } : {}), labelBlock, ...(group.parentId ? { parentId: group.parentId } : {}),
      x: minX, y: minY, width: maxX - minX, height: maxY - minY, headerHeight,
    })
  }
  return positioned
}

/** Measured placement reserves entity boxes, not their surrounding frames.
 * Pack only colliding sibling compounds/direct entities, bottom-up, moving
 * each compound as one unit so scoped directions and ownership survive.
 * Each collision advances beyond a previously placed item, bounding a local
 * repair by the number of siblings; no convergence/retry loop is needed. */
function separateErCompounds(diagram: ErDiagram, entities: PositionedErEntity[], groups: PositionedErDiagram['groups'], style: ResolvedRenderStyle, relationshipBlocks: readonly PixelTextBlock[], bottomPadding: ReadonlyMap<string, number>, exitPadding: ReadonlyMap<string, number>, siblingGap = 20, styleFace?: Readonly<InternalStyleFace>, work: ErGeometryWork = { operations: 0 }, framePadding: ReadonlyMap<string, number> = new Map()): boolean {
  if (groups.length === 0) return false
  type Box = { x: number; y: number; width: number; height: number }
  type Item = { box: Box; ids: Set<string>; move: (dx: number, dy: number) => void }
  const byId = new Map(groups.map(group => [group.id, group]))
  const modelById = new Map(diagram.groups.map(group => [group.id, group]))
  const children = new Map<string | undefined, typeof groups>()
  const directEntities = new Map<string | undefined, PositionedErEntity[]>()
  for (const group of groups) {
    const parent = group.parentId && byId.has(group.parentId) ? group.parentId : undefined
    const siblings = children.get(parent) ?? []
    siblings.push(group)
    children.set(parent, siblings)
  }
  for (const entity of entities) {
    const parent = entity.groupId && byId.has(entity.groupId) ? entity.groupId : undefined
    const siblings = directEntities.get(parent) ?? []
    siblings.push(entity)
    directEntities.set(parent, siblings)
  }
  const subjects = new Map([...entities, ...groups].map(box => [box.id, box]))
  const needsSpace = (index: number): boolean => {
    erCharge(work)
    const rel = diagram.relationships[index]!, from = subjects.get(rel.entity1)!, to = subjects.get(rel.entity2)!
    const points = erExteriorRoute(from, to)
    const source = erCardinalityInk(points[0]!, points[1]!, rel.cardinality1, style.lineWidth)
    const target = erCardinalityInk(points.at(-1)!, points.at(-2)!, rel.cardinality2, style.lineWidth)
    if (!source?.length || !target?.length) return true
    const overlaps = (a: { x0: number; y0: number; x1: number; y1: number }, b: { x0: number; y0: number; x1: number; y1: number }) => { erCharge(work); return a.x0 < b.x1 && a.x1 > b.x0 && a.y0 < b.y1 && a.y1 > b.y0 }
    if (source.some(a => target.some(b => overlaps(a, b)))) return true
    const occupied = (id: string, box: typeof from) => ({ x0: box.x, y0: box.y, x1: box.x + box.width, y1: box.y + (byId.has(id) ? box.headerHeight : box.height) })
    if (source.some(piece => overlaps(piece, occupied(rel.entity2, to))) || target.some(piece => overlaps(piece, occupied(rel.entity1, from)))) return true
    if (rel.label) {
      const pill = erLabelPillInk(relationshipBlocks[index]!, calculatePathMidpoint(points))
      if (!pill || overlaps(pill, occupied(rel.entity1, from)) || overlaps(pill, occupied(rel.entity2, to))) return true
    }
    return false
  }
  let changed = false
  const moveGroup = (group: typeof groups[number], dx: number, dy: number): void => {
    group.x += dx; group.y += dy
    for (const entity of directEntities.get(group.id) ?? []) { entity.x += dx; entity.y += dy }
    for (const child of children.get(group.id) ?? []) moveGroup(child, dx, dy)
  }
  const idsWithin = (group: typeof groups[number]): Set<string> => new Set([
    group.id, ...(directEntities.get(group.id) ?? []).map(entity => entity.id),
    ...(children.get(group.id) ?? []).flatMap(child => [...idsWithin(child)]),
  ])
  const pack = (items: Item[], direction: Direction): void => {
    const horizontal = direction === 'LR' || direction === 'RL'
    const cross = horizontal ? 'y' : 'x'
    const span = horizontal ? 'height' : 'width'
    const main = horizontal ? 'x' : 'y'
    const terminalInk = (item: Item) => {
      const pieces: Array<{ x0: number; y0: number; x1: number; y1: number; overhead: number }> = []
      for (const rel of diagram.relationships) {
        erCharge(work)
        if (!item.ids.has(rel.entity1) && !item.ids.has(rel.entity2)) continue
        const from = subjects.get(rel.entity1), to = subjects.get(rel.entity2)
        if (!from || !to) continue
        const points = erExteriorRoute(from, to)
        const radius = resolveRoleStyle(styleFace, 'relationship', { category: rel.identifying ? 'identifying' : 'non-identifying' }, { includeFallback: false })?.bendRadius ?? style.edgeBendRadius
        // Actual glyph + rounded lead, the middle router's 1px clearance on
        // either side, and actual stroke gaps. This is used only after a live
        // glyph/body conflict, never as a global spacing increase.
        const overhead = 2 * radius + 2 * style.lineWidth + 4 * (style.lineWidth + .25) + 2
        for (const [id, at, toward, kind] of [[rel.entity1, points[0]!, points[1]!, rel.cardinality1], [rel.entity2, points.at(-1)!, points.at(-2)!, rel.cardinality2]] as const) {
          if (!item.ids.has(id)) continue
          const ink = erCardinalityInk(at, toward, kind, style.lineWidth)
          erCharge(work, 2 + (ink?.length ?? 0))
          if (!ink) throw new ErRouteGeometryError(rel.entity1, rel.entity2)
          pieces.push(...ink.map(box => ({ ...box, overhead })))
        }
      }
      return pieces
    }
    const itemBorder = (item: Item) => Math.max(0, ...[...item.ids].map(id => {
      erCharge(work)
      if (byId.has(id)) return .75
      const entity = subjects.get(id) as PositionedErEntity | undefined
      const authored = Number.parseFloat(entity?.inlineStyle?.['stroke-width'] ?? '')
      return (Number.isFinite(authored) && authored > 0 ? authored : style.nodeLineWidth) / 2
    }))
    const owner = new Map<string, Item>()
    const exits = new Map(items.map(item => [item, Math.max(0, ...[...item.ids].map(id => exitPadding.get(id) ?? 0))]))
    const clearances = new Map<Item, Map<Item, { cross: number; main: number; indices: number[] }>>()
    for (const item of items) for (const id of item.ids) owner.set(id, item)
    for (const [i, rel] of diagram.relationships.entries()) {
      erCharge(work)
      const from = owner.get(rel.entity1), to = owner.get(rel.entity2)
      if (!from || !to || from === to) continue
      const source = erCardinalityEnvelope(rel.cardinality1, style.lineWidth), target = erCardinalityEnvelope(rel.cardinality2, style.lineWidth)
      if (!source || !target) throw new ErRouteGeometryError(rel.entity1, rel.entity2)
      const radius = resolveRoleStyle(styleFace, 'relationship', { category: rel.identifying ? 'identifying' : 'non-identifying' }, { includeFallback: false })?.bendRadius ?? style.edgeBendRadius
      const occupied = (bounds: typeof source) => Math.max(0, bounds.x1, -bounds.x0, bounds.y1, -bounds.y0) + radius
      const terminals = occupied(source) + occupied(target) + 2 * (style.lineWidth + .25)
      // Retain the established labelled cross-clearance floor; actual glyph
      // ink also constrains the main gap and unlabelled relationships.
      const cross = rel.label ? Math.max(relationshipBlocks[i]![horizontal ? 'height' : 'width'] + 56,
        relationshipBlocks[i]![horizontal ? 'height' : 'width'] + 20 + terminals) : terminals
      const main = terminals + (rel.label ? relationshipBlocks[i]![horizontal ? 'width' : 'height'] + 20 : 0)
      for (const [a, b] of [[from, to], [to, from]] as const) {
        const row = clearances.get(a) ?? new Map<Item, { cross: number; main: number; indices: number[] }>(), previous = row.get(b)
        row.set(b, { cross: Math.max(previous?.cross ?? 0, cross), main: Math.max(previous?.main ?? 0, main), indices: [...(previous?.indices ?? []), i] })
        clearances.set(a, row)
      }
    }
    const next = new Map(items.map(item => [item, new Set<Item>()]))
    for (const rel of diagram.relationships) {
      erCharge(work)
      const from = owner.get(rel.entity1), to = owner.get(rel.entity2)
      if (from && to && from !== to) next.get(from)!.add(to)
    }
    const reaches = (from: Item, goal: Item): boolean => {
      const pending = [from], seen = new Set<Item>()
      while (pending.length) {
        erCharge(work)
        const item = pending.pop()!
        if (item === goal) return true
        if (seen.has(item)) continue
        seen.add(item)
        for (const peer of next.get(item)!) { erCharge(work); pending.push(peer) }
      }
      return false
    }
    const incoming = new Map(items.map(item => [item, [] as Item[]])), outgoing = new Map(items.map(item => [item, [] as Item[]]))
    for (const [from, peers] of next) for (const to of peers) {
      erCharge(work)
      if (reaches(to, from)) continue // a directed cycle cannot all be forward
      incoming.get(to)!.push(from); outgoing.get(from)!.push(to)
    }
    const left = new Map(items.map(item => [item, incoming.get(item)!.length])), ready = items.filter(item => left.get(item) === 0)
    const reverse = direction === 'BT' || direction === 'RL', mainSpan = horizontal ? 'width' : 'height'
    for (let head = 0; head < ready.length; head++) {
      const item = ready[head]!
      let shift = 0
      for (const previous of incoming.get(item)!) {
        erCharge(work)
        const gap = Math.max(siblingGap, clearances.get(item)?.get(previous)?.main ?? 0)
        shift = reverse ? Math.min(shift, previous.box[main] - gap - item.box[main] - item.box[mainSpan])
          : Math.max(shift, previous.box[main] + previous.box[mainSpan] + gap - item.box[main])
      }
      if (shift !== 0) { item.move(horizontal ? shift : 0, horizontal ? 0 : shift); changed = true }
      for (const to of outgoing.get(item)!) { erCharge(work); left.set(to, left.get(to)! - 1); if (left.get(to) === 0) ready.push(to) }
    }
    // Stable coordinate order retains ELK's ordering when no collision forces
    // a move. Reverse main flow changes neither cross-axis order nor padding.
    items.sort((a, b) => a.box[cross] - b.box[cross] || a.box[main] - b.box[main])
    const placed: Item[] = []
    for (const item of items) {
      for (let step = 0; step < placed.length; step++) {
        let delta = 0
        for (const other of placed) {
          erCharge(work)
          const reserved = clearances.get(item)?.get(other)
          const itemInk = terminalInk(item), otherInk = terminalInk(other)
          const itemHalf = itemBorder(item), otherHalf = itemBorder(other)
          const entersBox = (piece: typeof itemInk[number], box: Box, half: number) => { erCharge(work); return piece.x0 < box.x + box.width + half && piece.x1 > box.x - half && piece.y0 < box.y + box.height + half && piece.y1 > box.y - half }
          const glyphCollision = itemInk.some(piece => entersBox(piece, other.box, otherHalf)) || otherInk.some(piece => entersBox(piece, item.box, itemHalf))
          const outward = (ink: typeof itemInk, box: Box, high: boolean, foreignBorder: number) => Math.max(0, ...ink.map(piece => {
            erCharge(work)
            const excess = high ? (horizontal ? piece.y1 : piece.x1) - box[cross] - box[span] : box[cross] - (horizontal ? piece.y0 : piece.x0)
            return excess > 0 ? excess + piece.overhead + foreignBorder : 0
          }))
          const glyphClearance = glyphCollision ? outward(otherInk, other.box, true, itemHalf) + outward(itemInk, item.box, false, otherHalf) : 0
          const clearance = Math.max(reserved?.cross ?? 0, exits.get(item)!, exits.get(other)!, glyphClearance)
          const mainSpan = horizontal ? 'width' : 'height'
          const mainOverlap = Math.min(item.box[main] + item.box[mainSpan], other.box[main] + other.box[mainSpan]) - Math.max(item.box[main], other.box[main])
          const crossOverlap = Math.min(item.box[cross] + item.box[span], other.box[cross] + other.box[span]) - Math.max(item.box[cross], other.box[cross])
          if ((mainOverlap > 0.5 || glyphCollision || reserved && mainOverlap > -reserved.main && reserved.indices.some(needsSpace)) && crossOverlap > -Math.max(clearance, siblingGap > 20 ? siblingGap : 0) + 0.5) {
            delta = Math.max(delta, other.box[cross] + other.box[span] + Math.max(siblingGap, clearance) - item.box[cross])
          }
        }
        if (delta === 0) break
        item.move(horizontal ? 0 : delta, horizontal ? delta : 0)
        changed = true
      }
      placed.push(item)
    }
  }
  const visit = (parent: string | undefined, direction: Direction): void => {
    const childGroups = children.get(parent) ?? []
    for (const group of childGroups) visit(group.id, modelById.get(group.id)?.direction ?? direction)
    const members = directEntities.get(parent) ?? []
    const memberById = new Map(members.map(entity => [entity.id, entity]))
    const neighbors = new Map(members.map(entity => [entity.id, [] as string[]]))
    for (const rel of diagram.relationships) {
      if (!memberById.has(rel.entity1) || !memberById.has(rel.entity2)) continue
      neighbors.get(rel.entity1)!.push(rel.entity2)
      neighbors.get(rel.entity2)!.push(rel.entity1)
    }
    const seen = new Set<string>()
    const components: Item[] = []
    for (const entity of members) {
      if (seen.has(entity.id)) continue
      const component: PositionedErEntity[] = []
      const pending = [entity.id]
      while (pending.length) {
        const id = pending.pop()!
        if (seen.has(id)) continue
        seen.add(id)
        component.push(memberById.get(id)!)
        pending.push(...neighbors.get(id)!)
      }
      const x = Math.min(...component.map(member => member.x)), y = Math.min(...component.map(member => member.y))
      const box = { x, y, width: Math.max(...component.map(member => member.x + member.width)) - x, height: Math.max(...component.map(member => member.y + member.height)) - y }
      components.push({ box, ids: new Set(component.map(member => member.id)), move: (dx, dy) => {
        box.x += dx; box.y += dy
        for (const member of component) { member.x += dx; member.y += dy }
      } })
    }
    const items: Item[] = [
      ...components,
      ...childGroups.map(group => ({ box: group, ids: idsWithin(group), move: (dx: number, dy: number) => moveGroup(group, dx, dy) })),
    ]
    pack(items, direction)
    if (parent === undefined || items.length === 0) return
    const group = byId.get(parent)!
    const pad = framePadding.get(group.id) ?? 20
    const minX = Math.min(...items.map(item => item.box.x)) - pad
    const minY = Math.min(...items.map(item => item.box.y)) - pad - group.headerHeight
    const maxX = Math.max(minX + (group.labelBlock?.width ?? erGroupBlock(group.label, style).width) + 20, Math.max(...items.map(item => item.box.x + item.box.width)) + pad)
    const width = maxX - minX
    const height = Math.max(...items.map(item => item.box.y + item.box.height)) + Math.max(pad, bottomPadding.get(group.id) ?? 0) - minY
    if (group.x !== minX || group.y !== minY || group.width !== width || group.height !== height) changed = true
    Object.assign(group, { x: minX, y: minY, width, height })
  }
  visit(undefined, diagram.direction ?? 'LR')
  return changed
}

function layoutErGroupsOnly(diagram: ErDiagram, style: ResolvedRenderStyle, styleFace?: Readonly<InternalStyleFace>, work: ErGeometryWork = { operations: 0 }): PositionedErDiagram {
  const blocks = diagram.relationships.map(rel => erRelationshipBlock(rel, style, styleFace))
  const interior = erInteriorCorridors(diagram, blocks)
  const framePadding = erFrameInkPadding(diagram, style, styleFace, work)
  const horizontal = (diagram.direction ?? 'LR') === 'LR' || (diagram.direction ?? 'LR') === 'RL'
  const reverse = diagram.direction === 'RL' || diagram.direction === 'BT'
  const topLevel = diagram.groups.filter(group => !group.parentId)
  const ordered = reverse ? [...topLevel].reverse() : topLevel
  const groups: PositionedErDiagram['groups'] = []
  const place = (group: ErDiagram['groups'][number], x: number, y: number): PositionedErDiagram['groups'][number] => {
    const labelBlock = erGroupBlock(resolveLabelContent(group.label, group.labelContent), style)
    const headerHeight = style.groupHeaderFontSize + 16 + labelBlock.height - labelBlock.lineHeight
    const positioned = { id: group.id, label: group.label, ...(group.labelContent ? { labelContent: group.labelContent } : {}), labelBlock, ...(group.parentId ? { parentId: group.parentId } : {}), x, y, width: Math.max(160, labelBlock.width + 20), height: Math.max(100, headerHeight + 20), headerHeight }
    groups.push(positioned)
    const pad = framePadding.get(group.id) ?? 20
    let cursorX = x + pad
    let cursorY = y + headerHeight + pad
    for (const child of diagram.groups.filter(candidate => candidate.parentId === group.id)) {
      const placed = place(child, cursorX, cursorY)
      positioned.width = Math.max(positioned.width, placed.x + placed.width - x + pad)
      positioned.height = Math.max(positioned.height, placed.y + placed.height - y + Math.max(pad, interior.padding.get(group.id) ?? 0))
      if (horizontal) cursorX += placed.width + 20
      else cursorY += placed.height + Math.max(20, interior.exits.get(child.id) ?? 0)
    }
    return positioned
  }
  let cursorX = ER.padding
  let cursorY = ER.padding
  for (const group of ordered) {
    const placed = place(group, cursorX, cursorY)
    if (horizontal) cursorX += placed.width + 40
    else cursorY += placed.height + 30
  }
  separateErCompounds(diagram, [], groups, style, blocks, interior.padding, interior.exits, 20, styleFace, work, framePadding)
  const boxes = new Map(groups.map(group => [group.id, group]))
  const relationships: PositionedErRelationship[] = diagram.relationships.map((relation, index) => {
    const from = boxes.get(relation.entity1), to = boxes.get(relation.entity2)
    const points: Point[] = []
    if (from && to && interior.lanes.has(index)) {
      points.push(...erInteriorRoute(from, to, interior.lanes.get(index)!))
    } else if (from && to) {
      points.push(...erExteriorRoute(from, to))
    }
    return { entity1: relation.entity1, entity2: relation.entity2, cardinality1: relation.cardinality1, cardinality2: relation.cardinality2, label: relation.label, ...(relation.labelContent ? { labelContent: relation.labelContent } : {}), identifying: relation.identifying, points }
  })
  repairErFrameRoutes([], groups, relationships, blocks, style, styleFace, work)
  const points = relationships.flatMap(rel => rel.points)
  const labelBounds = erPreferredLabelBounds(relationships, blocks)
  const dx = Math.max(0, ER.padding - Math.min(...groups.map(group => group.x), ...points.map(point => point.x)), ...labelBounds.map(box => -box.x0))
  const dy = Math.max(0, ER.padding - Math.min(...groups.map(group => group.y), ...points.map(point => point.y)), ...labelBounds.map(box => -box.y0))
  for (const group of groups) { group.x += dx; group.y += dy }
  for (const point of points) { point.x += dx; point.y += dy }
  const width = Math.max(...groups.map(group => group.x + group.width + ER.padding), ...points.map(point => point.x + ER.padding), ...labelBounds.map(box => box.x1 + dx), 0)
  const height = Math.max(...groups.map(group => group.y + group.height + ER.padding), ...points.map(point => point.y + ER.padding), ...labelBounds.map(box => box.y1 + dy), 0)
  return { width, height, accessibilityTitle: diagram.accessibilityTitle, accessibilityDescription: diagram.accessibilityDescription, entities: [], relationships, groups }
}

/**
 * Lay out a parsed ER diagram using ELK.js.
 */
export function layoutErDiagram(
  diagram: ErDiagram,
  options: RenderOptions = {},
  styleFace?: Readonly<InternalStyleFace>,
): PositionedErDiagram {
  assertErDiagramWork(diagram)
  const style = resolveRenderStyle(options, ER_STYLE_DEFAULTS, styleFace)
  const work: ErGeometryWork = { operations: 0 }
  // Selection belongs to the complete family artifact. Only an explicitly
  // requested fallback may translate these known ER candidate refusals into
  // the shared selector's typed rejection; strict Native retains its errors.
  const nativeCandidate = (produce: () => PositionedErDiagram): PositionedErDiagram => {
    try { return produce() } catch (error) {
      if (options.graphLayout?.backend !== 'agentic' || options.graphLayout.fallback !== 'elk'
        || !(error instanceof ErRouteGeometryError || error instanceof ErRouteWorkLimitError || error instanceof ErLabelWorkLimitError)) throw error
      const rejected = new LayoutCertificationError([{ strategy: 'er-final-geometry', violations: [error.message] }])
      rejected.cause = error
      throw rejected
    }
  }
  if (diagram.entities.length === 0) {
    const empty = (): PositionedErDiagram => withErTitle({ width: 0, height: 0, accessibilityTitle: diagram.accessibilityTitle, accessibilityDescription: diagram.accessibilityDescription, entities: [], relationships: [], groups: [] }, diagram.title, style)
    const frames = () => diagram.groups.length ? finishErGeometry(withErTitle(prepareErText(layoutErGroupsOnly(diagram, style, styleFace, work), style, styleFace), diagram.title, style), style, styleFace, work) : empty()
    return runMeasuredGraphBackend(options, () => nativeCandidate(frames), () => { erCharge(work, 0); return frames() }, true)
  }
  const entitySizes = measureErEntities(diagram, style)
  const nativePlacement = (): ErPlacement => {
    const indices = new Map(diagram.entities.map((entity, index) => [entity.id, index]))
    const groupIds = new Set(diagram.groups.map(group => group.id))
    const subjects = new Set([...indices.keys(), ...groupIds])
    const spans = new Map<string, number>()
    let layerSpacing = options.layerSpacing ?? ER.layerSpacing
    for (const rel of diagram.relationships) {
      const role = resolveRoleStyle(styleFace, 'relationship', { category: rel.identifying ? 'identifying' : 'non-identifying' }, { includeFallback: false })
      for (const [id, kind] of [[rel.entity1, rel.cardinality1], [rel.entity2, rel.cardinality2]] as const) {
        const bound = erCardinalityEnvelope(kind, style.lineWidth)
        erCharge(work)
        if (!bound) throw new ErRouteGeometryError(rel.entity1, rel.entity2)
        const depth = bound.x1 + (role?.lineWidth ?? style.lineWidth) / 2 + style.lineWidth + .25
        const lead = depth + Math.min(role?.bendRadius ?? style.edgeBendRadius, depth)
        // The layered producer's earliest channel turn is layerSpacing/4.
        layerSpacing = Math.max(layerSpacing, 4 * lead)
        if (!groupIds.has(id)) spans.set(id, (spans.get(id) ?? 0) + bound.y1 - bound.y0 + style.lineWidth + .25)
      }
    }
    const nativeSizes = new Map(diagram.entities.map(entity => {
      const size = entitySizes.get(entity.id)!, span = (spans.get(entity.id) ?? 0) + 2 * Math.max(8, style.cornerRadius ?? 0)
      return [entity.id, { ...size, width: Math.max(size.width, span), height: Math.max(size.height, span) }] as const
    }))
    const edges = diagram.relationships.flatMap((rel, relationshipIndex) => {
      const source = groupIds.has(rel.entity1) ? undefined : indices.get(rel.entity1), target = groupIds.has(rel.entity2) ? undefined : indices.get(rel.entity2)
      if (!subjects.has(rel.entity1) || !subjects.has(rel.entity2)) throw new Error('ER relationship references an undeclared entity or frame')
      // The bottom-up compound projection below retains every frame-level
      // dependency; only leaf placement is delegated to this measured call.
      if (source === undefined || target === undefined) return []
      const block = erRelationshipBlock(rel, style, styleFace)
      return [{ relationshipIndex, source, target, minSpan: 1, ...(rel.label ? { label: { width: block.width + 16, height: block.height + 16 } } : {}) }]
    })
    const placed = measureRenderStage('agentic', () => layoutAgenticGraph({
      nodes: diagram.entities.map(entity => ({ id: entity.id, ...nativeSizes.get(entity.id)! })), edges,
      direction: diagram.direction ?? 'LR', padding: ER.padding, nodeSpacing: options.nodeSpacing ?? ER.nodeSpacing,
      layerSpacing, edgeSpacing: Math.max(6, style.lineWidth + 4),
    }))
    return { width: placed.width, height: placed.height, preserveTerminalNormals: true, labelPlacement: 'shaft-aware',
      entities: placed.nodes.map((position, index) => ({ id: diagram.entities[index]!.id, ...position, ...nativeSizes.get(diagram.entities[index]!.id)! })),
      routes: new Map(placed.edges.map((route, index) => [edges[index]!.relationshipIndex, route.points])),
      labelPositions: new Map(placed.edges.flatMap((route, index) => route.labelPosition
        ? [[edges[index]!.relationshipIndex, { ...route.labelPosition }] as const] : [])) }
  }
  const elkPlacement = (): ErPlacement => {
    // A fallback is not a fresh request or a fresh geometry-work allowance.
    erCharge(work, 0)
    const { elkGraph } = buildErElkGraph(diagram, options, entitySizes, styleFace, work)
    const placed = elkLayoutSync(elkGraph)
    return { width: placed.width, height: placed.height, entities: placed.children ?? [], routes: new Map((placed.edges ?? []).map(edge => {
      const section = edge.sections?.[0]
      return [Number(edge.id.slice(1)), section ? alignElkRoundoff([section.startPoint, ...(section.bendPoints ?? []), section.endPoint]) : []]
    })) }
  }
  const finish = (placement: ErPlacement): PositionedErDiagram => {
    const positioned = withErTitle(prepareErText(extractErLayout(placement, diagram, entitySizes, style, styleFace, work), style, styleFace), diagram.title, style)
    return finishErGeometry(positioned, style, styleFace, work)
  }
  return runMeasuredGraphBackend(options, () => nativeCandidate(() => finish(nativePlacement())), () => finish(elkPlacement()), true)
}

/** The diagram's title takes a band above everything the layout placed. */
function withErTitle(positioned: PositionedErDiagram, title: string | undefined, style: ResolvedRenderStyle): PositionedErDiagram {
  const band = diagramTitleBand(title, style)
  if (!band) return positioned
  if (positioned.width === 0 && positioned.height === 0) return { ...positioned, ...titleOnlyCanvas(band, ER.padding) }
  const dy = band.height
  for (const entity of positioned.entities) entity.y += dy
  for (const group of positioned.groups) group.y += dy
  for (const rel of positioned.relationships) {
    for (const point of rel.points) point.y += dy
    if (rel.labelPosition) rel.labelPosition.y += dy
  }
  const width = Math.max(positioned.width, band.width + 2 * ER.padding)
  return { ...positioned, width, height: positioned.height + dy, title: positionDiagramTitle(band, width, ER.padding) }
}

type ErInkBox = { x0: number; y0: number; x1: number; y1: number }

/** Actual family ink is separate from generic marker-resource certification:
 * cardinalities are ordinary compound shapes and opaque pills are later ink. */
function finishErGeometry(positioned: PositionedErDiagram, style: ResolvedRenderStyle, styleFace: Readonly<InternalStyleFace> | undefined, work: ErGeometryWork): PositionedErDiagram {
  const relationships = positioned.relationships
  if (!relationships.length) return positioned
  const charge = (count = 1) => erCharge(work, count)
  const intersects = (a: ErInkBox, b: ErInkBox): boolean => {
    charge()
    return a.x0 < b.x1 && a.x1 > b.x0 && a.y0 < b.y1 && a.y1 > b.y0
  }
  const subjects = new Map([...positioned.entities, ...positioned.groups].map(box => [box.id, box]))
  const groupIds = new Set(positioned.groups.map(group => group.id))
  canonicalErContacts(positioned.entities, positioned.groups, relationships, work)
  const obstacles: Array<{ id: string; box: ErInkBox; border?: boolean; group?: boolean }> = [
    ...positioned.entities.map(entity => {
      const authored = Number.parseFloat(entity.inlineStyle?.['stroke-width'] ?? '')
      const half = (Number.isFinite(authored) && authored > 0 ? authored : style.nodeLineWidth) / 2
      return { id: entity.id, box: { x0: entity.x - half, y0: entity.y - half, x1: entity.x + entity.width + half, y1: entity.y + entity.height + half } }
    }),
    ...positioned.groups.flatMap(group => {
      const x0 = group.x, y0 = group.y, x1 = x0 + group.width, y1 = y0 + group.height, half = .75
      return [
        { id: group.id, group: true, box: { x0, y0, x1, y1: y0 + group.headerHeight } },
        { id: group.id, group: true, border: true, box: { x0: x0 - half, y0: y0 - half, x1: x0 + half, y1: y1 + half } },
        { id: group.id, group: true, border: true, box: { x0: x1 - half, y0: y0 - half, x1: x1 + half, y1: y1 + half } },
        { id: group.id, group: true, border: true, box: { x0: x0 - half, y0: y0 - half, x1: x1 + half, y1: y0 + half } },
        { id: group.id, group: true, border: true, box: { x0: x0 - half, y0: y1 - half, x1: x1 + half, y1: y1 + half } },
      ]
    }),
  ]
  charge(obstacles.length + subjects.size)
  const glyphs = () => relationships.flatMap((rel, index) => {
    charge()
    if (rel.points.length < 2) throw new ErRouteGeometryError(rel.entity1, rel.entity2)
    return [0, 1].map(end => {
      const point = end ? rel.points.at(-1)! : rel.points[0]!, toward = end ? rel.points.at(-2)! : rel.points[1]!
      const pieces = erCardinalityInk(point, toward, end ? rel.cardinality2 : rel.cardinality1, style.lineWidth)
      charge(2 + (pieces?.length ?? 0))
      if (!pieces?.length) throw new ErRouteGeometryError(rel.entity1, rel.entity2)
      return { index, end, rel, id: end ? rel.entity2 : rel.entity1, point, toward, pieces }
    })
  })
  const terminalDepth = (pieces: readonly ErInkBox[], point: Point, horizontal: boolean, sign: number): number => Math.max(0, ...pieces.map(piece => {
    charge()
    return sign > 0 ? (horizontal ? piece.x1 - point.x : piece.y1 - point.y) : (horizontal ? point.x - piece.x0 : point.y - piece.y0)
  }))
  const shafts = () => relationships.flatMap((rel, index) => {
    const role = resolveRoleStyle(styleFace, 'relationship', { category: rel.identifying ? 'identifying' : 'non-identifying' }, { includeFallback: false })
    const half = (role?.lineWidth ?? style.lineWidth) / 2
    const radius = role?.bendRadius ?? style.edgeBendRadius
    const clipButtCap = (box: ErInkBox, a: Point, b: Point, start: boolean) => {
      charge()
      if (a.y === b.y) {
        if ((b.x > a.x) === start) box.x0 = start ? a.x : b.x
        else box.x1 = start ? a.x : b.x
      } else if (a.x === b.x) {
        if ((b.y > a.y) === start) box.y0 = start ? a.y : b.y
        else box.y1 = start ? a.y : b.y
      }
    }
    if (radius > 0 && rel.points.length > 2) {
      const geometry = projectRoundedConnectorPath(rel.points, radius, { metric: 'manhattan' }).geometry
      const boxes: Array<{ index: number; box: ErInkBox; first: boolean; last: boolean; line?: readonly [Point, Point] }> = []
      let lastLine: readonly [Point, Point] | undefined
      if (geometry.kind !== 'path' || !visitTypedPathSegments(geometry.d, part => {
        charge()
        const box = { x0: part.bounds.x0 - half, y0: part.bounds.y0 - half, x1: part.bounds.x1 + half, y1: part.bounds.y1 + half }
        if (!boxes.length && part.line) clipButtCap(box, part.line[0], part.line[1], true)
        lastLine = part.line
        boxes.push({ index, box, first: false, last: false, ...(part.line ? { line: part.line } : {}) })
        return true
      }, () => { charge(); return true })) throw new ErRouteGeometryError(rel.entity1, rel.entity2)
      // The emitted quadratic corners meet their straight neighbors tangentially.
      // A half-width expansion of each exact curve bound contains that stroke.
      if (boxes.length) {
        boxes[0]!.first = true; boxes.at(-1)!.last = true
        if (lastLine) clipButtCap(boxes.at(-1)!.box, lastLine[0], lastLine[1], false)
      }
      return boxes
    }
    return rel.points.slice(1).map((b, i) => {
      charge()
      const a = rel.points[i]!
      if (a.x !== b.x && a.y !== b.y || ![a.x, a.y, b.x, b.y, half].every(Number.isFinite)) throw new ErRouteGeometryError(rel.entity1, rel.entity2)
      // The renderer uses butt caps and miter joins. Orthogonal 90-degree
      // joins are contained in the union of these half-width rectangles.
      const box = { x0: Math.min(a.x, b.x) - half, y0: Math.min(a.y, b.y) - half, x1: Math.max(a.x, b.x) + half, y1: Math.max(a.y, b.y) + half }
      if (i === 0) clipButtCap(box, a, b, true)
      if (i === rel.points.length - 2) clipButtCap(box, a, b, false)
      return { index, box, first: i === 0, last: i === rel.points.length - 2, line: [a, b] as const }
    })
  })
  let failedCaptions = finalizeErRelationshipLabels(positioned, style, styleFace, work)
  let labels = retainedErRelationshipLabels(positioned) ?? separateRelationshipLabels(positioned, style, styleFace, work)
  const labelBoxes = (occupied: boolean) => relationships.flatMap((rel, index) => {
    charge()
    const at = labels.get(rel)
    if (!rel.label || !at) return []
    const block = rel.labelBlock ?? erRelationshipBlock(rel, style, styleFace)
    const box = occupied ? { x0: at.x - block.width / 2 - 8, y0: at.y - block.height / 2 - 8, x1: at.x + block.width / 2 + 8, y1: at.y + block.height / 2 + 8 } : erLabelPillInk(block, at)
    if (!box) throw new ErRouteGeometryError(rel.entity1, rel.entity2)
    return [{ index, box }]
  })
  let changed = false
  // Allocate automatic entity and frame face contacts. The selected face and far
  // contact remain fixed; the actual glyph, caption and foreign shaft ranges
  // determine any required shift along that face, never an arbitrary pitch.
  const faceGroups = new Map<string, Map<string, ReturnType<typeof glyphs>>>()
  for (const terminal of glyphs()) {
    charge()
    const horizontal = terminal.point.y === terminal.toward.y
    const face = horizontal ? terminal.toward.x > terminal.point.x ? 'E' : 'W' : terminal.toward.y > terminal.point.y ? 'S' : 'N'
    const owner = faceGroups.get(terminal.id) ?? new Map<string, ReturnType<typeof glyphs>>()
    const peers = owner.get(face) ?? []
    peers.push(terminal); owner.set(face, peers); faceGroups.set(terminal.id, owner)
  }
  const ordered = [...faceGroups.values()].flatMap(owner => [...owner.values()].flatMap(peers => peers.sort((a, b) => {
    charge()
    const horizontal = a.point.y === a.toward.y
    return (horizontal ? a.point.y - b.point.y : a.point.x - b.point.x) || a.index * 2 + a.end - b.index * 2 - b.end
  })))
  const order = new Map(ordered.map((terminal, index) => [terminal.index * 2 + terminal.end, index]))
  charge(ordered.length * 2)
  for (const terminal of ordered) {
    charge()
    const box = subjects.get(terminal.id)!, p = terminal.end ? terminal.rel.points.at(-1)! : terminal.rel.points[0]!
    const q = terminal.end ? terminal.rel.points.at(-2)! : terminal.rel.points[1]!
    const horizontal = q.y === p.y && q.x !== p.x, vertical = q.x === p.x && q.y !== p.y
    const sign = horizontal ? Math.sign(q.x - p.x) : Math.sign(q.y - p.y)
    const onFace = horizontal ? p.x === (sign > 0 ? box.x + box.width : box.x) : p.y === (sign > 0 ? box.y + box.height : box.y)
    // The deliberate bottom corridor of an ancestor points inward. It is not
    // an automatic exterior port and remains owned by that existing producer.
    if ((!horizontal && !vertical) || !onFace) continue
    const current = horizontal ? p.y : p.x
    const corner = groupIds.has(terminal.id) ? 6 : Math.min(style.cornerRadius ?? 0, box.width / 2, box.height / 2)
    let low = (horizontal ? box.y : box.x) + corner, high = (horizontal ? box.y + box.height : box.x + box.width) - corner
    const currentGlyphs = glyphs(), thisGlyph = currentGlyphs.find(g => g.index === terminal.index && g.end === terminal.end)!
    const laterOnFace = currentGlyphs.filter(glyph => {
      charge()
      if (glyph.id !== terminal.id || order.get(glyph.index * 2 + glyph.end)! <= order.get(terminal.index * 2 + terminal.end)!) return false
      return horizontal ? glyph.point.x === p.x && glyph.toward.y === glyph.point.y && Math.sign(glyph.toward.x - glyph.point.x) === sign
        : glyph.point.y === p.y && glyph.toward.x === glyph.point.x && Math.sign(glyph.toward.y - glyph.point.y) === sign
    })
    const laterGlyphs = new Set(laterOnFace)
    charge(laterOnFace.length)
    const peers: ErInkBox[] = [
      ...currentGlyphs.filter(g => { charge(); return (g.index !== terminal.index || g.end !== terminal.end) && !laterGlyphs.has(g) }).flatMap(g => g.pieces),
      // Caption centers are still movable; finalize them after fixed face slots.
      // They are not immutable obstacles for allocating those slots.
      ...shafts().filter(shaft => shaft.index !== terminal.index && !laterOnFace.some(g => { charge(); return g.index === shaft.index && (g.end ? shaft.last : shaft.first) })).map(shaft => shaft.box),
    ]
    const occupied = [...obstacles.filter(o => o.id !== terminal.id || !!o.group !== groupIds.has(terminal.id)).map(o => o.box), ...peers]
    const oppositePieces = new Set(currentGlyphs.filter(g => g.index === terminal.index).flatMap(g => g.pieces))
    charge(oppositePieces.size)
    const leadObstacles = [...obstacles.filter(o => (o.id !== terminal.id || !!o.group !== groupIds.has(terminal.id)) && !o.border).map(o => o.box), ...peers.filter(piece => !oppositePieces.has(piece))]
    const roleStyle = resolveRoleStyle(styleFace, 'relationship', { category: terminal.rel.identifying ? 'identifying' : 'non-identifying' }, { includeFallback: false })
    const half = (roleStyle?.lineWidth ?? style.lineWidth) / 2
    const glyphDepth = terminalDepth(thisGlyph.pieces, p, horizontal, sign)
    const protectedLength = glyphDepth + (roleStyle?.bendRadius ?? style.edgeBendRadius) + half + style.lineWidth + .25
    const length = Math.min(Math.abs(horizontal ? q.x - p.x : q.y - p.y), protectedLength)
    const endLead = horizontal ? { x: p.x + sign * length, y: p.y } : { x: p.x, y: p.y + sign * length }
    const leadBox = { x0: Math.min(p.x, endLead.x) - (horizontal ? 0 : half), x1: Math.max(p.x, endLead.x) + (horizontal ? 0 : half),
      y0: Math.min(p.y, endLead.y) - (horizontal ? half : 0), y1: Math.max(p.y, endLead.y) + (horizontal ? half : 0) }
    const reservations = [...thisGlyph.pieces.map(piece => ({ piece, occupied })), { piece: leadBox, occupied: leadObstacles }]
    charge(occupied.length + leadObstacles.length + reservations.length)
    if (current >= low && current <= high && !reservations.some(({piece, occupied}) => occupied.some(other => intersects(piece, other)))) continue
    const opposite = currentGlyphs.find(g => g.index === terminal.index && g.end !== terminal.end)!
    const oppositeHorizontal = opposite.point.y === opposite.toward.y
    if (horizontal !== oppositeHorizontal) {
      const oppositeSign = Math.sign(oppositeHorizontal ? opposite.toward.x - opposite.point.x : opposite.toward.y - opposite.point.y)
      const role = resolveRoleStyle(styleFace, 'relationship', { category: terminal.rel.identifying ? 'identifying' : 'non-identifying' }, { includeFallback: false })
      const depth = terminalDepth(opposite.pieces, opposite.point, oppositeHorizontal, oppositeSign) + (role?.lineWidth ?? style.lineWidth) / 2 + style.lineWidth + .25
      const lead = depth + Math.min(role?.bendRadius ?? style.edgeBendRadius, depth)
      const coordinate = oppositeHorizontal ? opposite.point.x : opposite.point.y
      // A mixed-axis one-bend route shares this coordinate with the far normal
      // stem. Sliding a port must not reverse or consume that far glyph lead.
      if (oppositeSign > 0) low = Math.max(low, coordinate + lead)
      else high = Math.min(high, coordinate - lead)
    }
    let candidate = Math.max(low, Math.min(current, high))
    const forbidden: Array<[number, number]> = []
    for (const { piece, occupied } of reservations) for (const other of occupied) {
      charge()
      const mainLo = horizontal ? piece.x0 : piece.y0, mainHi = horizontal ? piece.x1 : piece.y1
      const otherLo = horizontal ? other.x0 : other.y0, otherHi = horizontal ? other.x1 : other.y1
      if (mainLo >= otherHi || mainHi <= otherLo) continue
      // Separate distinct glyph strokes by one actual cardinality stroke width;
      // exact touching would visually merge their bars and depends on ULPs.
      const gap = style.lineWidth + .25
      forbidden.push([(horizontal ? other.y0 : other.x0) - ((horizontal ? piece.y1 : piece.x1) - current) - gap,
        (horizontal ? other.y1 : other.x1) - ((horizontal ? piece.y0 : piece.x0) - current) + gap])
    }
    forbidden.sort((a, b) => { charge(); return a[0] - b[0] || a[1] - b[1] })
    for (const [lo, hi] of forbidden) { charge(); if (candidate > lo && candidate < hi) candidate = hi }
    if (candidate > high) {
      // Preserve the existing forward seat priority. A crowded port near the
      // end of its face can still have a free slot on the other side; inspect
      // the same forbidden intervals backwards before declining that face.
      candidate = Math.max(low, Math.min(current, high))
      for (let i = forbidden.length - 1; i >= 0; i--) {
        charge()
        const [lo, hi] = forbidden[i]!
        if (candidate > lo && candidate < hi) candidate = lo
      }
      if (candidate < low) throw new ErRouteGeometryError(terminal.rel.entity1, terminal.rel.entity2)
    }
    if (candidate === current) continue
    if (candidate > high) throw new ErRouteGeometryError(terminal.rel.entity1, terminal.rel.entity2)
    const points = terminal.rel.points.map(point => ({ ...point })), step = terminal.end ? -1 : 1, first = terminal.end ? points.length - 1 : 0
    const cross = horizontal ? 'y' : 'x', old = p[cross], delta = candidate - old
    let last = first
    for (let i = first; i >= 0 && i < points.length && points[i]![cross] === old; i += step) { charge(); last = i }
    if (last === (terminal.end ? 0 : points.length - 1)) {
      const start = points[0]!, end = points.at(-1)!
      points[first]![cross] = candidate
      const a = currentGlyphs.find(g => g.index === terminal.index && g.end === 0)!, b = currentGlyphs.find(g => g.index === terminal.index && g.end === 1)!
      const role = resolveRoleStyle(styleFace, 'relationship', { category: terminal.rel.identifying ? 'identifying' : 'non-identifying' }, { includeFallback: false })
      const needed = (glyph: typeof a) => {
        const ray = Math.sign(horizontal ? glyph.toward.x - glyph.point.x : glyph.toward.y - glyph.point.y)
        const depth = terminalDepth(glyph.pieces, glyph.point, horizontal, ray) + (role?.lineWidth ?? style.lineWidth) / 2 + style.lineWidth + .25
        return depth + Math.min(role?.bendRadius ?? style.edgeBendRadius, depth)
      }
      const axis = horizontal ? 'x' : 'y', direction = Math.sign(end[axis] - start[axis]), from = start[axis] + direction * needed(a), to = end[axis] - direction * needed(b)
      if ((to - from) * direction < 0) throw new ErRouteGeometryError(terminal.rel.entity1, terminal.rel.entity2)
      const join = Math.max(Math.min(from, to), Math.min(Math.max(from, to), (start[axis] + end[axis]) / 2))
      terminal.rel.points = simplifyPolyline(horizontal ? [start, { x: join, y: start.y }, { x: join, y: end.y }, end] : [start, { x: start.x, y: join }, { x: end.x, y: join }, end])
    } else {
      for (let i = first; i !== last + step; i += step) { charge(); points[i]![cross] += delta }
      terminal.rel.points = simplifyPolyline(points)
    }
    if (!erSimpleRoute(terminal.rel.points, work)) throw new ErRouteGeometryError(terminal.rel.entity1, terminal.rel.entity2)
    delete terminal.rel.finalLabelPosition
    changed = true
  }
  if (changed) {
    repairErFrameRoutes(positioned.entities, positioned.groups, relationships, relationships.map(rel => rel.labelBlock ?? erRelationshipBlock(rel, style, styleFace)), style, styleFace, work)
    failedCaptions = finalizeErRelationshipLabels(positioned, style, styleFace, work)
    labels = retainedErRelationshipLabels(positioned) ?? separateRelationshipLabels(positioned, style, styleFace, work)
  }
  if (failedCaptions.length) {
    charge(relationships.length + failedCaptions.length)
    const failed = new Set(failedCaptions)
    const indices = new Set(relationships.flatMap((rel, index) => failed.has(rel) ? [index] : []))
    repairErFrameRoutes(positioned.entities, positioned.groups, relationships, relationships.map(rel => rel.labelBlock ?? erRelationshipBlock(rel, style, styleFace)), style, styleFace, work,
      { indices, admit: (index, points) => erCandidateCaptionClear(positioned, index, points, style, styleFace, work) })
    positioned.width = Math.max(positioned.width, ...relationships.flatMap(rel => rel.points.map(point => point.x + ER.padding)))
    positioned.height = Math.max(positioned.height, ...relationships.flatMap(rel => rel.points.map(point => point.y + ER.padding)))
    finalizeErRelationshipLabels(positioned, style, styleFace, work)
    labels = retainedErRelationshipLabels(positioned) ?? separateRelationshipLabels(positioned, style, styleFace, work)
  }
  const allGlyphs = glyphs(), allShafts = shafts(), allLabels = labelBoxes(false)
  for (const rel of relationships) if (!erSimpleRoute(rel.points, work)) throw new ErRouteGeometryError(rel.entity1, rel.entity2)
  // Strict body/header interiors apply to every raw segment, including an
  // incident card revisited later in a route. Legitimate outline contacts are
  // on the open boundary and therefore do not enter these rectangles.
  for (const rel of relationships) for (let i = 1; i < rel.points.length; i++) {
    for (const entity of positioned.entities) {
      charge()
      if (segmentThroughShape(rel.points[i - 1]!, rel.points[i]!, { ...entity, label: '', shape: 'rectangle' })) throw new ErRouteGeometryError(rel.entity1, rel.entity2)
    }
    for (const group of positioned.groups) {
      charge()
      if (group.headerHeight > 0 && segmentThroughShape(rel.points[i - 1]!, rel.points[i]!, { ...group, height: group.headerHeight, label: '', shape: 'rectangle' })) throw new ErRouteGeometryError(rel.entity1, rel.entity2)
    }
  }
  const terminalBorderContact = (shaft: typeof allShafts[number], id: string, box: { x: number; y: number; width: number; height: number }, borderHalf: number, radius: number, group: boolean): boolean => {
    if (groupIds.has(id) !== group) return false
    const rel = relationships[shaft.index]!
    const end = shaft.first && rel.entity1 === id ? 0 : shaft.last && rel.entity2 === id ? 1 : undefined
    if (end === undefined) return false
    const p = end ? rel.points.at(-1)! : rel.points[0]!, q = end ? rel.points.at(-2)! : rel.points[1]!
    const flatY = p.y >= box.y + radius && p.y <= box.y + box.height - radius
    const flatX = p.x >= box.x + radius && p.x <= box.x + box.width - radius
    charge()
    // Only this incident outward terminal may overlap its own visible border.
    // The entire emitted part must stay outside the border's inner edge.
    return flatY && q.y === p.y && (p.x === box.x && q.x < p.x && shaft.box.x1 <= box.x + borderHalf
      || p.x === box.x + box.width && q.x > p.x && shaft.box.x0 >= box.x + box.width - borderHalf)
      || flatX && q.x === p.x && (p.y === box.y && q.y < p.y && shaft.box.y1 <= box.y + borderHalf
      || p.y === box.y + box.height && q.y > p.y && shaft.box.y0 >= box.y + box.height - borderHalf)
  }
  for (const shaft of allShafts) {
    const rel = relationships[shaft.index]!
    for (const entity of positioned.entities) {
      const authored = Number.parseFloat(entity.inlineStyle?.['stroke-width'] ?? '')
      const half = (Number.isFinite(authored) && authored > 0 ? authored : style.nodeLineWidth) / 2
      const box = { x0: entity.x - half, y0: entity.y - half, x1: entity.x + entity.width + half, y1: entity.y + entity.height + half }
      if (intersects(shaft.box, box) && !terminalBorderContact(shaft, entity.id, entity, half, Math.min(style.cornerRadius ?? 0, entity.width / 2, entity.height / 2), false)) throw new ErRouteGeometryError(rel.entity1, rel.entity2)
    }
    for (const group of positioned.groups) {
      const header = { x0: group.x, y0: group.y, x1: group.x + group.width, y1: group.y + group.headerHeight }
      if (group.headerHeight > 0 && intersects(shaft.box, header) && !terminalBorderContact(shaft, group.id, group, .75, 6, true)) throw new ErRouteGeometryError(rel.entity1, rel.entity2)
    }
  }
  const glyphBounds = new Map(allGlyphs.map(glyph => {
    charge(glyph.pieces.length * 4 + 1)
    return [glyph, { x0: Math.min(...glyph.pieces.map(p => p.x0)), y0: Math.min(...glyph.pieces.map(p => p.y0)), x1: Math.max(...glyph.pieces.map(p => p.x1)), y1: Math.max(...glyph.pieces.map(p => p.y1)) }] as const
  }))
  for (const glyph of allGlyphs) for (const other of allGlyphs) {
    charge()
    if (other.index * 2 + other.end <= glyph.index * 2 + glyph.end || !intersects(glyphBounds.get(glyph)!, glyphBounds.get(other)!)) continue
    for (const piece of glyph.pieces) if (other.pieces.some(p => intersects(piece, p))) throw new ErRouteGeometryError(glyph.rel.entity1, glyph.rel.entity2)
  }
  for (const glyph of allGlyphs) {
    const dx = glyph.toward.x - glyph.point.x, dy = glyph.toward.y - glyph.point.y
    const horizontal = dy === 0 && dx !== 0, vertical = dx === 0 && dy !== 0
    const sign = Math.sign(horizontal ? dx : dy)
    const terminal = allShafts.find(shaft => { charge(); return shaft.index === glyph.index && (glyph.end ? shaft.last : shaft.first) })
    const line = terminal?.line, far = line && (glyph.end ? line[0] : line[1]), at = line && (glyph.end ? line[1] : line[0])
    if ((!horizontal && !vertical) || !far || !at || (horizontal ? far.y !== at.y || Math.sign(far.x - at.x) !== sign : far.x !== at.x || Math.sign(far.y - at.y) !== sign)
      || sign * ((horizontal ? far.x : far.y) - (horizontal ? glyph.point.x : glyph.point.y)) < terminalDepth(glyph.pieces, glyph.point, horizontal, sign)) throw new ErRouteGeometryError(glyph.rel.entity1, glyph.rel.entity2)
    for (const piece of glyph.pieces) {
      for (const obstacle of obstacles) if ((obstacle.id !== glyph.id || !!obstacle.group !== groupIds.has(glyph.id)) && intersects(piece, obstacle.box)) throw new ErRouteGeometryError(glyph.rel.entity1, glyph.rel.entity2)
      for (const shaft of allShafts) if ((shaft.index !== glyph.index || !(glyph.end ? shaft.last : shaft.first)) && intersects(piece, shaft.box)) throw new ErRouteGeometryError(glyph.rel.entity1, glyph.rel.entity2)
    }
  }
  for (const label of allLabels) {
    const rel = relationships[label.index]!
    for (const obstacle of obstacles) if (intersects(label.box, obstacle.box)) throw new ErRouteGeometryError(rel.entity1, rel.entity2)
    for (const glyph of allGlyphs) if (intersects(label.box, glyphBounds.get(glyph)!) && glyph.pieces.some(piece => intersects(label.box, piece))) throw new ErRouteGeometryError(rel.entity1, rel.entity2)
    for (const shaft of allShafts) if (shaft.index !== label.index && intersects(label.box, shaft.box)) throw new ErRouteGeometryError(rel.entity1, rel.entity2)
    for (const other of allLabels) if (other.index < label.index && intersects(label.box, other.box)) throw new ErRouteGeometryError(rel.entity1, rel.entity2)
  }
  return positioned
}
