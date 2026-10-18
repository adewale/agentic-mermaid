import { resolveLabelContent, type DisplayTextInput } from '../shared/display-text.ts'
import { assertErDiagramWork, DIAGRAM_WORK_LIMITS } from '../shared/diagram-limits.ts'
import { preparePixelText, type PixelTextBlock } from '../shared/prepared-text.ts'
import { resolveRoleStyle } from '../scene/style-registry.ts'
/**
 * ER diagram layout engine (ELK.js).
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
import { FONT_SIZES, FONT_WEIGHTS, STROKE_WIDTHS, resolveRenderStyle, diagramTitleBand, positionDiagramTitle } from '../styles.ts'
import type { RenderStyleDefaults, ResolvedRenderStyle } from '../styles.ts'
import type { InternalStyleFace } from '../scene/style-registry.ts'
import { elkLayoutSync } from '../elk-instance.ts'
import { directionToElk } from '../layout-engine.ts'
import { checkedAuthoredStyle } from '../shared/style-props.ts'
import { configSpacing } from '../class/layout.ts'
import { erCommentText } from './text.ts'
import { rerouteEdgesThroughNodes } from '../layout/passes/index.ts'
import { segmentThroughShape } from '../layout-rubric.ts'
import { generatedIds } from '../shared/generated-identity.ts'
import { simplifyPolyline } from '../route-contracts.ts'
import { calculatePathMidpoint } from '../layout/geometry.ts'
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

export function erRelationshipBlock(rel: Pick<PositionedErRelationship, 'label' | 'identifying' | 'labelContent'>, style: ResolvedRenderStyle, styleFace?: Readonly<InternalStyleFace>): PixelTextBlock {
  const role = resolveRoleStyle(styleFace, 'relationship', { category: rel.identifying ? 'identifying' : 'non-identifying' }, { includeFallback: false })
  return preparePixelText(resolveLabelContent(rel.label, rel.labelContent), { transform: role?.textTransform ?? style.edgeTextTransform, fontSize: role?.fontSize ?? style.edgeLabelFontSize, fontWeight: role?.fontWeight ?? style.edgeLabelFontWeight, letterSpacing: role?.letterSpacing ?? style.edgeLetterSpacing })
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
    const mid = calculatePathMidpoint(rel.points), block = blocks[index]!
    return [{ x0: mid.x - block.width / 2 - 8, x1: mid.x + block.width / 2 + 8, y0: mid.y - block.height / 2 - 8, y1: mid.y + block.height / 2 + 8 }]
  })
}

export class ErRouteWorkLimitError extends RangeError {
  readonly code = 'ER_ROUTE_WORK_LIMIT'
  constructor() { super('ER_ROUTE_WORK_LIMIT: frame corridor checks exceed 400000; split the diagram or reduce its relationships'); this.name = 'ErRouteWorkLimitError' }
}

class ErRouteGeometryError extends Error {
  readonly code = 'ER_ROUTE_BLOCKED'
  constructor(from: string, to: string) { super(`ER_ROUTE_BLOCKED: no clear frame corridor from ${from} to ${to}`); this.name = 'ErRouteGeometryError' }
}

function repairErFrameRoutes(entities: PositionedErEntity[], groups: PositionedErDiagram['groups'], relationships: PositionedErRelationship[], blocks: readonly PixelTextBlock[]): void {
  if (groups.length === 0) return
  const generated = generatedIds([...entities.map(entity => entity.id), ...groups.map(group => group.id)])
  const groupIds = new Set(groups.map(group => group.id)), entityIds = new Map<string, string>()
  const obstacles: PositionedNode[] = [
    ...entities.map(entity => { const id = generated(`er-entity:${entity.id}`, ['er', 'entity', entity.id]); entityIds.set(id, entity.id); return { ...entity, id, shape: 'rectangle' as const } }),
    ...groups.map(group => ({ ...group, id: generated(`er-header:${group.id}`, ['er', 'header', group.id]), height: group.headerHeight, shape: 'rectangle' as const })),
  ]
  let operations = 0
  const charge = (count: number) => { operations += count; if (operations > 400_000) throw new ErRouteWorkLimitError() }
  for (const [index, rel] of relationships.entries()) {
    if (!groupIds.has(rel.entity1) && !groupIds.has(rel.entity2) || rel.points.length < 2) continue
    const [start, end] = [rel.points[0]!, rel.points.at(-1)!]
    const physical = obstacles.filter(node => { const id = entityIds.get(node.id); return id === undefined || groupIds.has(id) || id !== rel.entity1 && id !== rel.entity2 })
    const blocked = (points: Point[]) => points.slice(1).some((point, i) => physical.some(node => { charge(1); return segmentThroughShape(points[i]!, point, node) }))
    if (!blocked(rel.points)) continue
    // Keep actual cardinality-bearing face contacts; shared routing owns only
    // the middle between 20px terminal stems in the reserved sibling exits.
    const next = rel.points.find(point => point.x !== start.x || point.y !== start.y)!, previous = [...rel.points].reverse().find(point => point.x !== end.x || point.y !== end.y)!
    const stem = (point: Point, toward: Point, id: string): PositionedNode => {
      const ray = { x: Math.sign(toward.x - point.x), y: Math.sign(toward.y - point.y) }
      let length = 20
      for (const node of physical) {
        charge(1)
        if (!(ray.x ? point.y > node.y && point.y < node.y + node.height : point.x > node.x && point.x < node.x + node.width)) continue
        const gap = ray.x > 0 ? node.x - point.x : ray.x < 0 ? point.x - node.x - node.width : ray.y > 0 ? node.y - point.y : point.y - node.y - node.height
        // The shared bracket adds up to 12px before turning; a normal 20px
        // header gap must retain room for that turn and the cardinality ink.
        if (gap >= 0) length = Math.min(length, Math.max(0, gap - 14))
      }
      return { id, label: '', shape: 'rectangle', x: point.x + ray.x * length, y: point.y + ray.y * length, width: 0, height: 0 }
    }
    const from = stem(start, next, rel.entity1), to = stem(end, previous, rel.entity2)
    const block = blocks[index]!, padX = block.width / 2 + 8, padY = block.height / 2 + 8
    const padded = physical.map(node => ({ ...node, x: node.x - padX, y: node.y - padY, width: node.width + padX * 2, height: node.height + padY * 2 }))
    charge(physical.length)
    const edge: PositionedEdge = { source: from.id, target: to.id, style: 'solid', hasArrowStart: false, hasArrowEnd: false, points: [{ x: from.x, y: from.y }, ...rel.points.slice(1, -1), { x: to.x, y: to.y }] }
    const direction = Math.abs(end.x - start.x) >= Math.abs(end.y - start.y) ? end.x >= start.x ? 'LR' : 'RL' : end.y >= start.y ? 'TB' : 'BT'
    rerouteEdgesThroughNodes([...padded, from, to], [edge], { direction }, charge)
    if (blocked(edge.points)) {
      // A header approach can fit the actual terminal stem without fitting a
      // label along that stem. Keep measured label width in the long aisle,
      // while allowing the physical approach along the flow axis.
      charge(physical.length)
      const crossPadded = physical.map(node => direction === 'TB' || direction === 'BT'
        ? { ...node, x: node.x - padX, width: node.width + padX * 2 }
        : { ...node, y: node.y - padY, height: node.height + padY * 2 })
      rerouteEdgesThroughNodes([...crossPadded, from, to], [edge], { direction }, charge)
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

/** Build ELK graph and size map from an ER diagram. */
function buildErElkGraph(
  diagram: ErDiagram,
  options: RenderOptions,
  styleFace?: Readonly<InternalStyleFace>,
): { elkGraph: ElkNode; entitySizes: EntitySizeMap } {
  const style = resolveRenderStyle(options, ER_STYLE_DEFAULTS, styleFace)
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
      'elk.edgeLabels.placement': 'CENTER',
    },
    children: [],
    edges: [],
  }

  for (const entity of diagram.entities) {
    const size = entitySizes.get(entity.id)!
    elkGraph.children!.push({ id: entity.id, width: size.width, height: size.height })
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

/** Extract positioned entities and relationships from ELK result. */
function extractErLayout(
  result: ElkNode,
  diagram: ErDiagram,
  entitySizes: EntitySizeMap,
  style: ResolvedRenderStyle,
  styleFace?: Readonly<InternalStyleFace>,
): PositionedErDiagram {
  const entityLookup = new Map<string, ErEntity>()
  for (const entity of diagram.entities) entityLookup.set(entity.id, entity)

  const positionedEntities: PositionedErEntity[] = []
  for (const child of result.children ?? []) {
    const entity = entityLookup.get(child.id)
    if (entity) {
      const classStyle: Record<string, string> = {}
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

  const originalPositions = new Map(positionedEntities.map(entity => [entity.id, { x: entity.x, y: entity.y }]))
  const relationshipBlocks = diagram.relationships.map(rel => erRelationshipBlock(rel, style, styleFace))
  const interior = erInteriorCorridors(diagram, relationshipBlocks)
  applyErGroupDirections(diagram, positionedEntities, relationshipBlocks)
  const positionedGroups = deriveErGroups(diagram, positionedEntities, style, interior.padding)
  separateErCompounds(diagram, positionedEntities, positionedGroups, style, relationshipBlocks, interior.padding, interior.exits)
  const boxes = new Map<string, { x: number; y: number; width: number; height: number }>()
  positionedEntities.forEach(entity => boxes.set(entity.id, entity))
  positionedGroups.forEach(group => boxes.set(group.id, group))
  const edgeById = new Map((result.edges ?? []).map(edge => [edge.id, edge]))
  const relationships: PositionedErRelationship[] = []
  for (let i = 0; i < diagram.relationships.length; i++) {
    const rel = diagram.relationships[i]!
    const from = boxes.get(rel.entity1), to = boxes.get(rel.entity2)
    const originalFrom = originalPositions.get(rel.entity1), originalTo = originalPositions.get(rel.entity2)
    const dx = from && originalFrom ? from.x - originalFrom.x : undefined
    const dy = from && originalFrom ? from.y - originalFrom.y : undefined
    // A local direction or compound repair must not replace an unrelated
    // ELK route. Whole-component translations preserve its complete shape.
    const elkEdge = dx !== undefined && dy !== undefined && to && originalTo &&
      Math.abs(to.x - originalTo.x - dx) < 0.001 && Math.abs(to.y - originalTo.y - dy) < 0.001
      ? edgeById.get(`e${i}`) : undefined
    const points: Point[] = []
    if (from && to && interior.lanes.has(i)) {
      points.push(...erInteriorRoute(from, to, interior.lanes.get(i)!))
    } else if (elkEdge?.sections?.length) {
      const section = elkEdge.sections[0]!
      points.push({ x: section.startPoint.x + dx!, y: section.startPoint.y + dy! })
      for (const bp of section.bendPoints ?? []) points.push({ x: bp.x + dx!, y: bp.y + dy! })
      points.push({ x: section.endPoint.x + dx!, y: section.endPoint.y + dy! })
    } else {
      if (from && to) {
        const fromCenter = { x: from.x + from.width / 2, y: from.y + from.height / 2 }
        const toCenter = { x: to.x + to.width / 2, y: to.y + to.height / 2 }
        const start = rectBoundaryToward(from, toCenter)
        const end = rectBoundaryToward(to, fromCenter)
        points.push(start)
        if (Math.abs(start.x - end.x) > 0.5 && Math.abs(start.y - end.y) > 0.5) {
          const horizontalFirst = Math.abs(toCenter.x - fromCenter.x) >= Math.abs(toCenter.y - fromCenter.y)
          if (horizontalFirst) {
            const middleX = (start.x + end.x) / 2
            points.push({ x: middleX, y: start.y }, { x: middleX, y: end.y })
          } else {
            const middleY = (start.y + end.y) / 2
            points.push({ x: start.x, y: middleY }, { x: end.x, y: middleY })
          }
        }
        points.push(end)
      }
    }
    relationships.push({
      entity1: rel.entity1, entity2: rel.entity2,
      cardinality1: rel.cardinality1, cardinality2: rel.cardinality2,
      label: rel.label, ...(rel.labelContent ? { labelContent: rel.labelContent } : {}), labelBlock: relationshipBlocks[i], identifying: rel.identifying, points,
    })
  }

  repairErFrameRoutes(positionedEntities, positionedGroups, relationships, relationshipBlocks)

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
    for (const relationship of relationships) for (const point of relationship.points) { point.x += dx; point.y += dy }
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
  }
}

function rectBoundaryToward(box: { x: number; y: number; width: number; height: number }, target: Point): Point {
  const center = { x: box.x + box.width / 2, y: box.y + box.height / 2 }
  const dx = target.x - center.x, dy = target.y - center.y
  if (Math.abs(dx) * box.height >= Math.abs(dy) * box.width) {
    return { x: dx >= 0 ? box.x + box.width : box.x, y: center.y + (dy / (Math.abs(dx) || 1)) * box.width / 2 }
  }
  return { x: center.x + (dx / (Math.abs(dy) || 1)) * box.height / 2, y: dy >= 0 ? box.y + box.height : box.y }
}

function applyErGroupDirections(diagram: ErDiagram, entities: PositionedErEntity[], relationshipBlocks: readonly PixelTextBlock[]): Set<string> {
  const moved = new Set<string>()
  for (const group of diagram.groups) {
    if (!group.direction) continue
    const members = group.entityIds.map(id => entities.find(entity => entity.id === id)).filter((entity): entity is PositionedErEntity => Boolean(entity))
    if (members.length < 2) continue
    for (const member of members) moved.add(member.id)
    const horizontal = group.direction === 'LR' || group.direction === 'RL'
    const ordered = group.direction === 'RL' || group.direction === 'BT' ? [...members].reverse() : members
    const ids = new Set(members.map(member => member.id))
    // The scoped adapter replaces ELK routes. Retain enough straight corridor
    // for the actual label plus both cardinality glyphs before rerouting.
    const gap = Math.max(48, ...diagram.relationships.flatMap((rel, i) =>
      rel.label && ids.has(rel.entity1) && ids.has(rel.entity2)
        ? [relationshipBlocks[i]![horizontal ? 'width' : 'height'] + 56] : []))
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

function deriveErGroups(diagram: ErDiagram, entities: PositionedErEntity[], style: ResolvedRenderStyle, bottomPadding: ReadonlyMap<string, number>): PositionedErDiagram['groups'] {
  const positioned: PositionedErDiagram['groups'] = []
  for (const group of [...diagram.groups].reverse()) {
    const members = [
      ...entities.filter(entity => entity.groupId === group.id),
      ...positioned.filter(child => child.parentId === group.id),
    ]
    const pad = 20
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

/** Flat ELK placement reserves entity boxes, not their surrounding frames.
 * Pack only colliding sibling compounds/direct entities, bottom-up, moving
 * each compound as one unit so scoped directions and ownership survive.
 * Each collision advances beyond a previously placed item, bounding a local
 * repair by the number of siblings; no convergence/retry loop is needed. */
function separateErCompounds(diagram: ErDiagram, entities: PositionedErEntity[], groups: PositionedErDiagram['groups'], style: ResolvedRenderStyle, relationshipBlocks: readonly PixelTextBlock[], bottomPadding: ReadonlyMap<string, number>, exitPadding: ReadonlyMap<string, number>): boolean {
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
    const owner = new Map<string, Item>()
    const exits = new Map(items.map(item => [item, Math.max(0, ...[...item.ids].map(id => exitPadding.get(id) ?? 0))]))
    const clearances = new Map<Item, Map<Item, number>>()
    for (const item of items) for (const id of item.ids) owner.set(id, item)
    for (const [i, rel] of diagram.relationships.entries()) {
      const from = owner.get(rel.entity1), to = owner.get(rel.entity2)
      if (!rel.label || !from || !to || from === to) continue
      // 8px label clearance per side, two 18px cardinality zones, 4px slack.
      const clearance = relationshipBlocks[i]![horizontal ? 'height' : 'width'] + 56
      for (const [a, b] of [[from, to], [to, from]] as const) {
        const row = clearances.get(a) ?? new Map<Item, number>()
        row.set(b, Math.max(row.get(b) ?? 0, clearance))
        clearances.set(a, row)
      }
    }
    // Stable coordinate order retains ELK's ordering when no collision forces
    // a move. Reverse main flow changes neither cross-axis order nor padding.
    items.sort((a, b) => a.box[cross] - b.box[cross] || a.box[main] - b.box[main])
    const placed: Item[] = []
    for (const item of items) {
      for (let step = 0; step < placed.length; step++) {
        let delta = 0
        for (const other of placed) {
          const clearance = Math.max(clearances.get(item)?.get(other) ?? 0, exits.get(item)!, exits.get(other)!)
          const mainSpan = horizontal ? 'width' : 'height'
          const mainOverlap = Math.min(item.box[main] + item.box[mainSpan], other.box[main] + other.box[mainSpan]) - Math.max(item.box[main], other.box[main])
          const crossOverlap = Math.min(item.box[cross] + item.box[span], other.box[cross] + other.box[span]) - Math.max(item.box[cross], other.box[cross])
          if (mainOverlap > 0.5 && crossOverlap > -clearance + 0.5) {
            delta = Math.max(delta, other.box[cross] + other.box[span] + Math.max(20, clearance) - item.box[cross])
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
    const minX = Math.min(...items.map(item => item.box.x)) - 20
    const minY = Math.min(...items.map(item => item.box.y)) - 20 - group.headerHeight
    const maxX = Math.max(minX + (group.labelBlock?.width ?? erGroupBlock(group.label, style).width) + 20, Math.max(...items.map(item => item.box.x + item.box.width)) + 20)
    const width = maxX - minX
    const height = Math.max(...items.map(item => item.box.y + item.box.height)) + Math.max(20, bottomPadding.get(group.id) ?? 0) - minY
    if (group.x !== minX || group.y !== minY || group.width !== width || group.height !== height) changed = true
    Object.assign(group, { x: minX, y: minY, width, height })
  }
  visit(undefined, diagram.direction ?? 'LR')
  return changed
}

function layoutErGroupsOnly(diagram: ErDiagram, style: ResolvedRenderStyle, styleFace?: Readonly<InternalStyleFace>): PositionedErDiagram {
  const blocks = diagram.relationships.map(rel => erRelationshipBlock(rel, style, styleFace))
  const interior = erInteriorCorridors(diagram, blocks)
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
    let cursorX = x + 20
    let cursorY = y + headerHeight + 20
    for (const child of diagram.groups.filter(candidate => candidate.parentId === group.id)) {
      const placed = place(child, cursorX, cursorY)
      positioned.width = Math.max(positioned.width, placed.x + placed.width - x + 20)
      positioned.height = Math.max(positioned.height, placed.y + placed.height - y + Math.max(20, interior.padding.get(group.id) ?? 0))
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
  const boxes = new Map(groups.map(group => [group.id, group]))
  const relationships: PositionedErRelationship[] = diagram.relationships.map((relation, index) => {
    const from = boxes.get(relation.entity1), to = boxes.get(relation.entity2)
    const points: Point[] = []
    if (from && to && interior.lanes.has(index)) {
      points.push(...erInteriorRoute(from, to, interior.lanes.get(index)!))
    } else if (from && to) {
      const fromCenter = { x: from.x + from.width / 2, y: from.y + from.height / 2 }
      const toCenter = { x: to.x + to.width / 2, y: to.y + to.height / 2 }
      const start = rectBoundaryToward(from, toCenter), end = rectBoundaryToward(to, fromCenter)
      points.push(start)
      if (Math.abs(start.x - end.x) > 0.5 && Math.abs(start.y - end.y) > 0.5) {
        const middle = horizontal ? (start.x + end.x) / 2 : (start.y + end.y) / 2
        if (horizontal) points.push({ x: middle, y: start.y }, { x: middle, y: end.y })
        else points.push({ x: start.x, y: middle }, { x: end.x, y: middle })
      }
      points.push(end)
    }
    return { entity1: relation.entity1, entity2: relation.entity2, cardinality1: relation.cardinality1, cardinality2: relation.cardinality2, label: relation.label, ...(relation.labelContent ? { labelContent: relation.labelContent } : {}), identifying: relation.identifying, points }
  })
  repairErFrameRoutes([], groups, relationships, blocks)
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
  if (diagram.entities.length === 0) {
    if (diagram.groups.length > 0) return withErTitle(prepareErText(layoutErGroupsOnly(diagram, resolveRenderStyle(options, ER_STYLE_DEFAULTS, styleFace), styleFace), resolveRenderStyle(options, ER_STYLE_DEFAULTS, styleFace), styleFace), diagram.title, resolveRenderStyle(options, ER_STYLE_DEFAULTS, styleFace))
    return { width: 0, height: 0, accessibilityTitle: diagram.accessibilityTitle, accessibilityDescription: diagram.accessibilityDescription, entities: [], relationships: [], groups: [] }
  }

  const { elkGraph, entitySizes } = buildErElkGraph(diagram, options, styleFace)
  const result = elkLayoutSync(elkGraph)
  return withErTitle(prepareErText(extractErLayout(result, diagram, entitySizes, resolveRenderStyle(options, ER_STYLE_DEFAULTS, styleFace), styleFace), resolveRenderStyle(options, ER_STYLE_DEFAULTS, styleFace), styleFace), diagram.title, resolveRenderStyle(options, ER_STYLE_DEFAULTS, styleFace))
}

/** The diagram's title takes a band above everything the layout placed. */
function withErTitle(positioned: PositionedErDiagram, title: string | undefined, style: ResolvedRenderStyle): PositionedErDiagram {
  const band = diagramTitleBand(title, style)
  if (!band) return positioned
  const dy = band.height
  for (const entity of positioned.entities) entity.y += dy
  for (const group of positioned.groups) group.y += dy
  for (const rel of positioned.relationships) for (const point of rel.points) point.y += dy
  const width = Math.max(positioned.width, band.width + 2 * ER.padding)
  return { ...positioned, width, height: positioned.height + dy, title: positionDiagramTitle(band, width, ER.padding) }
}
