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
import type { RenderOptions, Point, Direction } from '../types.ts'
import type { MermaidFrontmatterMap } from '../mermaid-source.ts'
import { getFrontmatterScalar } from '../mermaid-source.ts'
import { FONT_SIZES, FONT_WEIGHTS, STROKE_WIDTHS, resolveRenderStyle, diagramTitleBand, positionDiagramTitle } from '../styles.ts'
import type { RenderStyleDefaults, ResolvedRenderStyle } from '../styles.ts'
import type { InternalStyleFace } from '../scene/style-registry.ts'
import { elkLayoutSync } from '../elk-instance.ts'
import { directionToElk } from '../layout-engine.ts'
import { checkedAuthoredStyle } from '../shared/style-props.ts'
import { configSpacing } from '../class/layout.ts'
import { breakLineTags } from '../multiline-utils.ts'

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

export function erHeaderBlock(text: string, style: ResolvedRenderStyle): PixelTextBlock {
  return preparePixelText(text, { transform: style.nodeTextTransform, fontSize: style.nodeLabelFontSize, fontWeight: style.nodeLabelFontWeight, letterSpacing: style.nodeLetterSpacing })
}

export function erGroupBlock(text: string, style: ResolvedRenderStyle): PixelTextBlock {
  return preparePixelText(text, { transform: style.groupTextTransform, fontSize: style.groupHeaderFontSize, fontWeight: style.groupHeaderFontWeight, letterSpacing: style.groupLetterSpacing })
}

export function erRelationshipBlock(rel: Pick<PositionedErRelationship, 'label' | 'identifying'>, style: ResolvedRenderStyle, styleFace?: Readonly<InternalStyleFace>): PixelTextBlock {
  const role = resolveRoleStyle(styleFace, 'relationship', { category: rel.identifying ? 'identifying' : 'non-identifying' }, { includeFallback: false })
  return preparePixelText(rel.label, { transform: role?.textTransform ?? style.edgeTextTransform, fontSize: role?.fontSize ?? style.edgeLabelFontSize, fontWeight: role?.fontWeight ?? style.edgeLabelFontWeight, letterSpacing: role?.letterSpacing ?? style.edgeLetterSpacing })
}

export function erAttributeBlocks(attr: ErAttribute) {
  const mono = { display: 'literal' as const, fontSize: ER.attrFontSize, fontWeight: ER.attrFontWeight, monospace: true }
  return {
    type: preparePixelText(attr.type, mono), name: preparePixelText(attr.name, mono),
    keys: preparePixelText(attr.keys.join(','), { display: 'literal', fontSize: 9, fontWeight: 600 }),
    ...(attr.comment ? { comment: preparePixelText(erCommentText(attr.comment), { display: 'literal', fontSize: ER.attrFontSize, fontWeight: 400 }) } : {}),
  }
}

function prepareErText(positioned: PositionedErDiagram, style: ResolvedRenderStyle, styleFace?: Readonly<InternalStyleFace>): PositionedErDiagram {
  for (const entity of positioned.entities) {
    entity.labelBlock = erHeaderBlock(entity.label, style)
    entity.attributeBlocks = entity.attributes.map(erAttributeBlocks)
  }
  for (const group of positioned.groups) group.labelBlock ??= erGroupBlock(group.label, style)
  for (const rel of positioned.relationships) rel.labelBlock = erRelationshipBlock(rel, style, styleFace)
  return positioned
}

type EntitySizeMap = Map<string, { width: number; height: number; headerHeight: number }>

/** Space between an attribute's name and its comment. */
export const ER_COMMENT_GAP = 12

/** Width of an entity's comment column (0 when no attribute has a comment):
 * Mermaid draws each attribute's comment in a column after its name. */
export function erCommentColumnWidth(attributes: readonly ErAttribute[]): number {
  const widths = attributes.map(attr => attr.comment ? erAttributeBlocks(attr).comment!.width : 0)
  const widest = Math.max(0, ...widths)
  return widest > 0 ? widest + ER_COMMENT_GAP : 0
}

/** An attribute comment as drawn on its row: line breaks become spaces. */
export function erCommentText(comment: string): string {
  return breakLineTags(comment).replace(/\s+/g, ' ').trim()
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
    const labelBlock = erHeaderBlock(entity.label, style)
    const headerTextW = labelBlock.width
    let maxAttrW = 0
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

  const movedByScopedDirection = applyErGroupDirections(diagram, positionedEntities)
  const positionedGroups = deriveErGroups(diagram, positionedEntities, style)
  const boxes = new Map<string, { x: number; y: number; width: number; height: number }>()
  positionedEntities.forEach(entity => boxes.set(entity.id, entity))
  positionedGroups.forEach(group => boxes.set(group.id, group))
  const edgeById = new Map((result.edges ?? []).map(edge => [edge.id, edge]))
  const relationships: PositionedErRelationship[] = []
  for (let i = 0; i < diagram.relationships.length; i++) {
    const rel = diagram.relationships[i]!
    const elkEdge = movedByScopedDirection.has(rel.entity1) || movedByScopedDirection.has(rel.entity2)
      ? undefined
      : edgeById.get(`e${i}`)
    const points: Point[] = []
    if (elkEdge?.sections?.length) {
      const section = elkEdge.sections[0]!
      points.push({ x: section.startPoint.x, y: section.startPoint.y })
      for (const bp of section.bendPoints ?? []) points.push({ x: bp.x, y: bp.y })
      points.push({ x: section.endPoint.x, y: section.endPoint.y })
    } else {
      const from = boxes.get(rel.entity1)
      const to = boxes.get(rel.entity2)
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
      label: rel.label, identifying: rel.identifying, points,
    })
  }

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
  const dx = xs.length > 0 && Math.min(...xs) < ER.padding ? ER.padding - Math.min(...xs) : 0
  const dy = ys.length > 0 && Math.min(...ys) < ER.padding ? ER.padding - Math.min(...ys) : 0
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
  )
  const height = Math.max(
    (result.height ?? 400) + dy,
    ...positionedEntities.map(entity => entity.y + entity.height + ER.padding),
    ...positionedGroups.map(group => group.y + group.height + ER.padding),
    ...relationships.flatMap(relationship => relationship.points.map(point => point.y + ER.padding)),
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

function applyErGroupDirections(diagram: ErDiagram, entities: PositionedErEntity[]): Set<string> {
  const moved = new Set<string>()
  for (const group of diagram.groups) {
    if (!group.direction) continue
    const members = group.entityIds.map(id => entities.find(entity => entity.id === id)).filter((entity): entity is PositionedErEntity => Boolean(entity))
    if (members.length < 2) continue
    for (const member of members) moved.add(member.id)
    const horizontal = group.direction === 'LR' || group.direction === 'RL'
    const ordered = group.direction === 'RL' || group.direction === 'BT' ? [...members].reverse() : members
    const originX = Math.min(...members.map(member => member.x))
    const originY = Math.min(...members.map(member => member.y))
    let cursor = horizontal ? originX : originY
    for (const member of ordered) {
      if (horizontal) { member.x = cursor; member.y = originY; cursor += member.width + 48 }
      else { member.x = originX; member.y = cursor; cursor += member.height + 48 }
    }
  }
  return moved
}

function deriveErGroups(diagram: ErDiagram, entities: PositionedErEntity[], style: ResolvedRenderStyle): PositionedErDiagram['groups'] {
  const positioned: PositionedErDiagram['groups'] = []
  for (const group of [...diagram.groups].reverse()) {
    const members = [
      ...entities.filter(entity => entity.groupId === group.id),
      ...positioned.filter(child => child.parentId === group.id),
    ]
    const pad = 20
    const labelBlock = erGroupBlock(group.label, style)
    const headerHeight = style.groupHeaderFontSize + 16 + labelBlock.height - labelBlock.lineHeight
    const minX = members.length ? Math.min(...members.map(member => member.x)) - pad : ER.padding
    const minY = members.length ? Math.min(...members.map(member => member.y)) - pad - headerHeight : ER.padding
    const maxX = Math.max(minX + labelBlock.width + 20, members.length ? Math.max(...members.map(member => member.x + member.width)) + pad : minX + 140)
    const maxY = members.length ? Math.max(...members.map(member => member.y + member.height)) + pad : minY + 90
    positioned.unshift({
      id: group.id, label: group.label, labelBlock, ...(group.parentId ? { parentId: group.parentId } : {}),
      x: minX, y: minY, width: maxX - minX, height: maxY - minY, headerHeight,
    })
  }
  return positioned
}

function layoutErGroupsOnly(diagram: ErDiagram, style: ResolvedRenderStyle): PositionedErDiagram {
  const horizontal = (diagram.direction ?? 'LR') === 'LR' || (diagram.direction ?? 'LR') === 'RL'
  const reverse = diagram.direction === 'RL' || diagram.direction === 'BT'
  const topLevel = diagram.groups.filter(group => !group.parentId)
  const ordered = reverse ? [...topLevel].reverse() : topLevel
  const groups: PositionedErDiagram['groups'] = []
  const place = (group: ErDiagram['groups'][number], x: number, y: number): PositionedErDiagram['groups'][number] => {
    const labelBlock = erGroupBlock(group.label, style)
    const headerHeight = style.groupHeaderFontSize + 16 + labelBlock.height - labelBlock.lineHeight
    const positioned = { id: group.id, label: group.label, labelBlock, ...(group.parentId ? { parentId: group.parentId } : {}), x, y, width: Math.max(160, labelBlock.width + 20), height: Math.max(100, headerHeight + 20), headerHeight }
    groups.push(positioned)
    let cursorX = x + 20
    let cursorY = y + headerHeight + 8
    for (const child of diagram.groups.filter(candidate => candidate.parentId === group.id)) {
      const placed = place(child, cursorX, cursorY)
      positioned.width = Math.max(positioned.width, placed.x + placed.width - x + 20)
      positioned.height = Math.max(positioned.height, placed.y + placed.height - y + 20)
      if (horizontal) cursorX += placed.width + 20
      else cursorY += placed.height + 20
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
  const relationships: PositionedErRelationship[] = diagram.relationships.map(relation => {
    const from = boxes.get(relation.entity1), to = boxes.get(relation.entity2)
    const points: Point[] = []
    if (from && to) {
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
    return { entity1: relation.entity1, entity2: relation.entity2, cardinality1: relation.cardinality1, cardinality2: relation.cardinality2, label: relation.label, identifying: relation.identifying, points }
  })
  const width = Math.max(...groups.map(group => group.x + group.width + ER.padding), 0)
  const height = Math.max(...groups.map(group => group.y + group.height + ER.padding), 0)
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
  if (diagram.entities.length === 0) {
    if (diagram.groups.length > 0) return withErTitle(prepareErText(layoutErGroupsOnly(diagram, resolveRenderStyle(options, ER_STYLE_DEFAULTS, styleFace)), resolveRenderStyle(options, ER_STYLE_DEFAULTS, styleFace), styleFace), diagram.title, resolveRenderStyle(options, ER_STYLE_DEFAULTS, styleFace))
    return { width: 0, height: 0, accessibilityTitle: diagram.accessibilityTitle, accessibilityDescription: diagram.accessibilityDescription, entities: [], relationships: [], groups: [] }
  }

  const { elkGraph, entitySizes } = buildErElkGraph(diagram, options, styleFace)
  const result = elkLayoutSync(elkGraph)
  return withErTitle(prepareErText(extractErLayout(result, diagram, entitySizes, resolveRenderStyle(options, ER_STYLE_DEFAULTS, styleFace)), resolveRenderStyle(options, ER_STYLE_DEFAULTS, styleFace), styleFace), diagram.title, resolveRenderStyle(options, ER_STYLE_DEFAULTS, styleFace))
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
