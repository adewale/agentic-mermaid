/**
 * Class diagram layout engine (ELK.js).
 *
 * Each class box has 3 compartments:
 *   1. Header (class name + optional annotation)
 *   2. Attributes section
 *   3. Methods section
 *
 * Namespaces lay out as ELK compound nodes (the flowchart-subgraph pattern):
 * member classes are children of their namespace's compound, the compound
 * reserves a header band for the label via top padding, and relationships are
 * hosted on the lowest common ancestor compound so ELK (INCLUDE_CHILDREN)
 * routes across namespace boundaries; extraction adds each host's absolute
 * offset back. Containment is therefore by construction, not by a check.
 */

import type { ElkNode, ElkExtendedEdge } from 'elkjs'
import type { LayoutOptions } from 'elkjs'
import type { ClassDiagram, ClassNode, ClassNamespace, ClassMember, PositionedClassDiagram, PositionedClassNode, PositionedClassNamespace, PositionedClassRelationship } from './types.ts'
import type { RenderOptions, Point } from '../types.ts'
import type { MermaidFrontmatterMap } from '../mermaid-source.ts'
import { getFrontmatterScalar } from '../mermaid-source.ts'
import { ineffectiveFieldsPresent } from '../shared/config-wire-or-warn.ts'
import { applyTextTransform, estimateTextWidth, estimateMonoTextWidth, FONT_SIZES, FONT_WEIGHTS, STROKE_WIDTHS, resolveRenderStyle } from '../styles.ts'
import type { RenderStyleDefaults, ResolvedRenderStyle } from '../styles.ts'
import { measureMultilineText } from '../text-metrics.ts'
import { elkLayoutSync } from '../elk-instance.ts'
import { directionToElk } from '../layout-engine.ts'

/** Layout constants for class diagrams */
export const CLS = {
  padding: 40,
  boxPadX: 8,
  headerBaseHeight: 32,
  annotationHeight: 16,
  memberRowHeight: 20,
  sectionPadY: 8,
  emptySectionHeight: 8,
  minWidth: 120,
  memberFontSize: 11,
  memberFontWeight: 400,
  nodeSpacing: 40,
  layerSpacing: 60,
} as const

/** Shared by layout (sizing) and renderer (drawing) — keep it single-sourced. */
export const CLASS_STYLE_DEFAULTS: RenderStyleDefaults = {
  nodeLabelFontSize: FONT_SIZES.nodeLabel,
  edgeLabelFontSize: FONT_SIZES.edgeLabel,
  groupHeaderFontSize: FONT_SIZES.groupHeader,
  nodeLabelFontWeight: 700, // class titles are drawn bold; measure them bold too
  edgeLabelFontWeight: FONT_WEIGHTS.edgeLabel,
  groupHeaderFontWeight: FONT_WEIGHTS.groupHeader,
  nodePaddingX: CLS.boxPadX,
  nodePaddingY: CLS.sectionPadY,
  nodeCornerRadius: 0,
  nodeLineWidth: STROKE_WIDTHS.outerBox,
  edgeLineWidth: STROKE_WIDTHS.connector,
  groupCornerRadius: 0,
  groupPaddingX: CLS.boxPadX,
  groupPaddingY: CLS.sectionPadY,
  groupLineWidth: STROKE_WIDTHS.outerBox,
}

/**
 * Fold the typed `class` frontmatter config section into RenderOptions
 * (wire-or-warn, P4): nodeSpacing/rankSpacing are the wired keys — explicit
 * RenderOptions always win over frontmatter. The documented-but-unwired keys
 * are named by verify's INEFFECTIVE_CONFIG lint (CLASS_NOOP_CONFIG_FIELDS in
 * src/agent/verify.ts), never silently accepted.
 */
export function resolveClassRenderOptions(
  frontmatter: MermaidFrontmatterMap | undefined,
  options: RenderOptions,
): RenderOptions {
  if (!frontmatter) return options
  const nodeSpacing = configSpacing(frontmatter, 'class', 'nodeSpacing')
  const rankSpacing = configSpacing(frontmatter, 'class', 'rankSpacing')
  const configuredHierarchy = getFrontmatterScalar<boolean>(frontmatter, ['class', 'hierarchicalNamespaces'])
  const hierarchicalNamespaces = options.class?.hierarchicalNamespaces
    ?? (typeof configuredHierarchy === 'boolean' ? configuredHierarchy : undefined)
  if (nodeSpacing === undefined && rankSpacing === undefined && hierarchicalNamespaces === undefined) return options
  return {
    ...options,
    nodeSpacing: options.nodeSpacing ?? nodeSpacing,
    layerSpacing: options.layerSpacing ?? rankSpacing,
    ...(hierarchicalNamespaces !== undefined ? { class: { ...options.class, hierarchicalNamespaces } } : {}),
  }
}

/** Read a finite non-negative spacing number from a family config section. */
export function configSpacing(frontmatter: MermaidFrontmatterMap, family: string, key: string): number | undefined {
  const value = getFrontmatterScalar<number>(frontmatter, [family, key])
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined
}

/**
 * Documented classDiagram config keys accepted for Mermaid config-shape
 * compatibility but NOT wired to any class geometry or paint (P4: each
 * presence is named by verify's INEFFECTIVE_CONFIG lint). The wired keys —
 * nodeSpacing, rankSpacing — never appear here.
 */
export const CLASS_NOOP_CONFIG_FIELDS = [
  'arrowMarkerAbsolute', 'defaultRenderer', 'diagramPadding', 'dividerMargin',
  'hideEmptyMembersBox', 'htmlLabels', 'padding',
  'textHeight', 'titleTopMargin',
] as const

/** Which documented-but-unwired `class` config fields are present (sorted). */
export function classIneffectiveConfigFields(configs: unknown[]): string[] {
  return ineffectiveFieldsPresent(configs, CLASS_NOOP_CONFIG_FIELDS)
}

type ClassSizeMap = Map<string, { width: number; height: number; headerHeight: number; attrHeight: number; methodHeight: number }>

/** id prefix for namespace compound nodes — keeps them disjoint from class ids. */
const NS_PREFIX = 'ns:'

/** Namespace membership resolved to flat paths (parent-first order). */
interface NamespaceInfo {
  path: string
  parentPath?: string
  ns: ClassNamespace
}

function flattenNamespaces(namespaces: ClassNamespace[], parentPath?: string, hierarchical = true): NamespaceInfo[] {
  const out: NamespaceInfo[] = []
  for (const ns of namespaces) {
    const path = parentPath ? `${parentPath}.${ns.name}` : ns.name
    out.push({ path, ...(hierarchical && parentPath ? { parentPath } : {}), ns })
    out.push(...flattenNamespaces(ns.children, path, hierarchical))
  }
  return out
}

/** Build ELK graph and size map from a class diagram. */
function buildClassElkGraph(
  diagram: ClassDiagram,
  options: RenderOptions
): { elkGraph: ElkNode; classSizes: ClassSizeMap } {
  const style = resolveRenderStyle(options, CLASS_STYLE_DEFAULTS)
  const classSizes: ClassSizeMap = new Map()

  for (const cls of diagram.classes) {
    const label = applyTextTransform(cls.label, style.nodeTextTransform)
    const headerBaseHeight = Math.max(
      CLS.headerBaseHeight,
      measureMultilineText(label, style.nodeLabelFontSize, style.nodeLabelFontWeight).height + style.nodePaddingY * 2,
    )
    const headerHeight = cls.annotation
      ? headerBaseHeight + CLS.annotationHeight
      : headerBaseHeight

    const attrHeight = cls.attributes.length > 0
      ? cls.attributes.length * CLS.memberRowHeight + style.nodePaddingY
      : CLS.emptySectionHeight

    const methodHeight = cls.methods.length > 0
      ? cls.methods.length * CLS.memberRowHeight + style.nodePaddingY
      : CLS.emptySectionHeight

    const headerTextW = estimateTextWidth(label, style.nodeLabelFontSize, style.nodeLabelFontWeight)
    const maxAttrW = maxMemberWidth(cls.attributes)
    const maxMethodW = maxMemberWidth(cls.methods)
    const width = Math.max(CLS.minWidth, headerTextW + style.nodePaddingX * 2, maxAttrW + style.nodePaddingX * 2, maxMethodW + style.nodePaddingX * 2)
    const height = headerHeight + attrHeight + methodHeight

    classSizes.set(cls.id, { width, height, headerHeight, attrHeight, methodHeight })
  }

  const nodeSpacing = options.nodeSpacing ?? CLS.nodeSpacing
  const layerSpacing = options.layerSpacing ?? CLS.layerSpacing

  const hierarchicalNamespaces = options.class?.hierarchicalNamespaces !== false
  const namespaces = flattenNamespaces(diagram.namespaces, undefined, hierarchicalNamespaces)
  const hasNamespaces = namespaces.length > 0

  const rootOptions: LayoutOptions = {
    'elk.algorithm': 'layered',
    'elk.direction': directionToElk(diagram.direction ?? 'TB'),
    'elk.spacing.nodeNode': String(nodeSpacing),
    'elk.layered.spacing.nodeNodeBetweenLayers': String(layerSpacing),
    'elk.padding': `[top=${CLS.padding},left=${CLS.padding},bottom=${CLS.padding},right=${CLS.padding}]`,
    'elk.edgeRouting': 'ORTHOGONAL',
    'elk.edgeLabels.placement': 'CENTER',
  }
  // Compound layout only when namespaces exist: INCLUDE_CHILDREN lets ELK
  // route relationship edges across namespace boundaries without ports
  // (the flowchart subgraph pattern for direction-override-free graphs).
  if (hasNamespaces) rootOptions['elk.hierarchyHandling'] = 'INCLUDE_CHILDREN'

  const elkGraph: ElkNode = {
    id: 'root',
    layoutOptions: rootOptions,
    children: [],
    edges: [],
  }

  // Resolve each class to at most one namespace compound (parser guarantees
  // single-claim membership; guard again here so layout can't double-place).
  const namespaceOfClass = new Map<string, string>()
  for (const info of namespaces) {
    for (const id of info.ns.classIds) {
      if (!namespaceOfClass.has(id)) namespaceOfClass.set(id, info.path)
    }
  }

  // Compound nodes for namespaces, parent-first so parents exist when
  // children attach.
  const elkByPath = new Map<string, ElkNode>()
  const headerHeight = style.groupHeaderFontSize + 16
  for (const info of namespaces) {
    const compound: ElkNode = {
      id: NS_PREFIX + info.path,
      layoutOptions: {
        'elk.padding': `[top=${headerHeight + style.groupPaddingY},left=${style.groupPaddingX + 8},bottom=${style.groupPaddingY + 8},right=${style.groupPaddingX + 8}]`,
        'elk.spacing.nodeNode': String(nodeSpacing),
        'elk.layered.spacing.nodeNodeBetweenLayers': String(layerSpacing),
        'elk.edgeRouting': 'ORTHOGONAL',
        'elk.edgeLabels.placement': 'CENTER',
      },
      children: [],
      edges: [],
    }
    elkByPath.set(info.path, compound)
    const parent = info.parentPath ? elkByPath.get(info.parentPath)! : elkGraph
    parent.children!.push(compound)
  }

  for (const cls of diagram.classes) {
    const size = classSizes.get(cls.id)!
    const leaf: ElkNode = { id: cls.id, width: size.width, height: size.height }
    const host = namespaceOfClass.get(cls.id)
    ;(host ? elkByPath.get(host)! : elkGraph).children!.push(leaf)
  }

  // Host each relationship on the lowest common ancestor compound so its
  // section coordinates come back in that compound's frame (extraction adds
  // the compound's absolute offset — the flowchart INCLUDE_CHILDREN pattern).
  const ancestorsOf = (classId: string): string[] => {
    const path = namespaceOfClass.get(classId)
    if (!path) return []
    if (!hierarchicalNamespaces) return [path]
    const segments = path.split('.')
    return segments.map((_, i) => segments.slice(0, i + 1).join('.'))
  }
  for (let i = 0; i < diagram.relationships.length; i++) {
    const rel = diagram.relationships[i]!
    const edge: ElkExtendedEdge = { id: `e${i}`, sources: [rel.from], targets: [rel.to] }
    if (rel.label) {
      const label = applyTextTransform(rel.label, style.edgeTextTransform)
      const metrics = measureMultilineText(label, style.edgeLabelFontSize, style.edgeLabelFontWeight)
      edge.labels = [{ text: label, width: metrics.width + 8, height: metrics.height + 6 }]
    }
    const fromChain = ancestorsOf(rel.from)
    const toChain = ancestorsOf(rel.to)
    let lca: string | undefined
    for (let k = 0; k < Math.min(fromChain.length, toChain.length); k++) {
      if (fromChain[k] === toChain[k]) lca = fromChain[k]
      else break
    }
    ;(lca ? elkByPath.get(lca)! : elkGraph).edges!.push(edge)
  }

  return { elkGraph, classSizes }
}

/** Extract positioned classes, namespaces, and relationships from ELK result. */
function extractClassLayout(
  result: ElkNode,
  diagram: ClassDiagram,
  classSizes: ClassSizeMap,
  style: ResolvedRenderStyle,
  hierarchicalNamespaces: boolean,
): PositionedClassDiagram {
  const classLookup = new Map<string, ClassNode>()
  for (const cls of diagram.classes) classLookup.set(cls.id, cls)
  const namespaceInfoByPath = new Map(flattenNamespaces(diagram.namespaces, undefined, hierarchicalNamespaces).map(info => [info.path, info]))
  const headerHeight = style.groupHeaderFontSize + 16

  const positionedClasses: PositionedClassNode[] = []
  const positionedNamespaces: PositionedClassNamespace[] = []
  const edgeSections = new Map<string, { points: Point[]; labelPosition?: Point }>()

  const walk = (node: ElkNode, offsetX: number, offsetY: number): void => {
    for (const elkEdge of node.edges ?? []) {
      const points: Point[] = []
      if (elkEdge.sections && elkEdge.sections.length > 0) {
        const section = elkEdge.sections[0]!
        points.push({ x: section.startPoint.x + offsetX, y: section.startPoint.y + offsetY })
        for (const bp of section.bendPoints ?? []) {
          points.push({ x: bp.x + offsetX, y: bp.y + offsetY })
        }
        points.push({ x: section.endPoint.x + offsetX, y: section.endPoint.y + offsetY })
      }
      let labelPosition: Point | undefined
      const label = elkEdge.labels?.[0]
      if (label && label.x != null && label.y != null) {
        labelPosition = {
          x: label.x + (label.width ?? 0) / 2 + offsetX,
          y: label.y + (label.height ?? 0) / 2 + offsetY,
        }
      }
      edgeSections.set(elkEdge.id, { points, labelPosition })
    }

    for (const child of node.children ?? []) {
      const x = (child.x ?? 0) + offsetX
      const y = (child.y ?? 0) + offsetY
      if (child.id.startsWith(NS_PREFIX)) {
        const path = child.id.slice(NS_PREFIX.length)
        const info = namespaceInfoByPath.get(path)
        positionedNamespaces.push({
          id: path,
          name: info?.ns.name ?? path,
          label: info?.ns.label ?? info?.ns.name ?? path,
          parentId: info?.parentPath,
          classIds: info ? [...info.ns.classIds] : [],
          x,
          y,
          width: child.width ?? 0,
          height: child.height ?? 0,
          headerHeight,
        })
        walk(child, x, y)
        continue
      }
      const cls = classLookup.get(child.id)
      if (cls) {
        const size = classSizes.get(cls.id)!
        positionedClasses.push({
          id: cls.id,
          label: cls.label,
          annotation: cls.annotation,
          attributes: cls.attributes,
          methods: cls.methods,
          x,
          y,
          width: child.width ?? size.width,
          height: child.height ?? size.height,
          headerHeight: size.headerHeight,
          attrHeight: size.attrHeight,
          methodHeight: size.methodHeight,
          ...(cls.className ? { className: cls.className } : {}),
          ...(cls.href ? { href: cls.href } : {}),
          ...((cls.className && diagram.classDefs.get(cls.className)) || cls.inlineStyle ? {
            inlineStyle: { ...(cls.className ? diagram.classDefs.get(cls.className) : {}), ...cls.inlineStyle },
          } : {}),
        })
      }
    }
  }
  walk(result, 0, 0)

  const relationships: PositionedClassRelationship[] = []
  for (let i = 0; i < diagram.relationships.length; i++) {
    const rel = diagram.relationships[i]!
    const section = edgeSections.get(`e${i}`)
    relationships.push({
      from: rel.from,
      to: rel.to,
      type: rel.type,
      markerAt: rel.markerAt,
      fromType: rel.fromType,
      toType: rel.toType,
      label: rel.label,
      fromCardinality: rel.fromCardinality,
      toCardinality: rel.toCardinality,
      points: section?.points ?? [],
      labelPosition: section?.labelPosition,
    })
  }

  let width = result.width ?? 600
  let height = result.height ?? 400
  placeClassCardinalityLabels(relationships, positionedClasses, style, width, height)

  interface NoteBox { x: number; y: number; width: number; height: number }
  const occupied: NoteBox[] = positionedClasses.map(cls => ({ x: cls.x, y: cls.y, width: cls.width, height: cls.height }))
  const overlaps = (a: NoteBox, b: NoteBox, gap = 8): boolean =>
    a.x < b.x + b.width + gap && a.x + a.width + gap > b.x
    && a.y < b.y + b.height + gap && a.y + a.height + gap > b.y
  let freestandingY = height + 16
  const notes = diagram.notes.map(note => {
    const metrics = measureMultilineText(note.text, 12, 400)
    const noteWidth = Math.max(90, metrics.width + 24)
    const noteHeight = Math.max(40, metrics.height + 18)
    const target = note.for ? positionedClasses.find(cls => cls.id === note.for) : undefined
    let placement: NoteBox & { targetX?: number; targetY?: number; noteX?: number; noteY?: number }
    if (target) {
      const candidates: Array<NoteBox & { targetX: number; targetY: number; noteX: number; noteY: number }> = []
      for (let lane = 0; lane < Math.max(4, diagram.notes.length + 1); lane++) {
        const offset = lane * (noteHeight + 12)
        candidates.push(
          { x: target.x + target.width + 24, y: target.y + offset, width: noteWidth, height: noteHeight, targetX: target.x + target.width, targetY: target.y + target.height / 2, noteX: target.x + target.width + 24, noteY: target.y + offset + noteHeight / 2 },
          { x: target.x - noteWidth - 24, y: target.y + offset, width: noteWidth, height: noteHeight, targetX: target.x, targetY: target.y + target.height / 2, noteX: target.x - 24, noteY: target.y + offset + noteHeight / 2 },
          { x: target.x, y: target.y + target.height + 24 + offset, width: noteWidth, height: noteHeight, targetX: target.x + target.width / 2, targetY: target.y + target.height, noteX: target.x + noteWidth / 2, noteY: target.y + target.height + 24 + offset },
        )
      }
      placement = candidates.find(candidate => candidate.x >= CLS.padding && candidate.y >= CLS.padding && !occupied.some(box => overlaps(candidate, box)))
        ?? { x: width + 24, y: target.y, width: noteWidth, height: noteHeight, targetX: target.x + target.width, targetY: target.y + target.height / 2, noteX: width + 24, noteY: target.y + noteHeight / 2 }
    } else {
      placement = { x: CLS.padding, y: freestandingY, width: noteWidth, height: noteHeight }
      freestandingY += noteHeight + 12
    }
    occupied.push(placement)
    width = Math.max(width, placement.x + noteWidth + CLS.padding)
    height = Math.max(height, placement.y + noteHeight + CLS.padding)
    return { text: note.text, ...(note.for ? { for: note.for } : {}), ...placement }
  })

  return {
    width,
    height,
    accessibilityTitle: diagram.accessibilityTitle,
    accessibilityDescription: diagram.accessibilityDescription,
    classes: positionedClasses,
    relationships,
    notes,
    namespaces: positionedNamespaces,
  }
}

interface CardinalityBox { x0: number; y0: number; x1: number; y1: number }

/** Deterministically allocate endpoint text around routes. The renderer only
 * consumes these positions; overlap freedom is a layout invariant rather than
 * an SVG-time best effort. */
function placeClassCardinalityLabels(
  relationships: PositionedClassRelationship[],
  classes: PositionedClassNode[],
  style: ResolvedRenderStyle,
  width: number,
  height: number,
): void {
  const intersects = (a: CardinalityBox, b: CardinalityBox): boolean =>
    Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0) > 0.5
    && Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0) > 0.5
  const obstacles: CardinalityBox[] = classes.map(item => ({
    x0: item.x - 1, y0: item.y - 1, x1: item.x + item.width + 1, y1: item.y + item.height + 1,
  }))
  for (const relationship of relationships) {
    if (!relationship.label || !relationship.labelPosition) continue
    const metrics = measureMultilineText(
      applyTextTransform(relationship.label, style.edgeTextTransform),
      style.edgeLabelFontSize,
      style.edgeLabelFontWeight,
    )
    obstacles.push({
      x0: relationship.labelPosition.x - metrics.width / 2 - 2,
      y0: relationship.labelPosition.y - 8 - metrics.height / 2 - 2,
      x1: relationship.labelPosition.x + metrics.width / 2 + 2,
      y1: relationship.labelPosition.y - 8 + metrics.height / 2 + 2,
    })
  }

  const allocate = (text: string, endpoint: Point, toward: Point): Point => {
    const metrics = measureMultilineText(text, style.edgeLabelFontSize, style.edgeLabelFontWeight)
    const halfW = metrics.width / 2 + 2
    const halfH = metrics.height / 2 + 2
    const dx = toward.x - endpoint.x
    const dy = toward.y - endpoint.y
    const horizontal = Math.abs(dx) >= Math.abs(dy)
    const ux = horizontal ? Math.sign(dx || 1) : 0
    const uy = horizontal ? 0 : Math.sign(dy || 1)
    const px = -uy
    const py = ux
    const perpendicular: number[] = []
    for (let distance = 10; distance <= 190; distance += 12) perpendicular.push(-distance, distance)
    const candidates: Array<{ point: Point; box: CardinalityBox }> = []
    for (let along = 14; along <= 150; along += 10) {
      for (const offset of perpendicular) {
        const point = {
          x: endpoint.x + ux * along + px * offset,
          y: endpoint.y + uy * along + py * offset,
        }
        const box = { x0: point.x - halfW, y0: point.y - halfH, x1: point.x + halfW, y1: point.y + halfH }
        candidates.push({ point, box })
        if (box.x0 < 0 || box.y0 < 0 || box.x1 > width || box.y1 > height) continue
        if (obstacles.every(obstacle => !intersects(box, obstacle))) {
          obstacles.push(box)
          return point
        }
      }
    }
    // Extremely small canvases may have no perfect slot. Choose the stable
    // candidate with the fewest collisions; normal and stress layouts never
    // reach this fallback, but it keeps malformed/degenerate input renderable.
    const fallback = candidates
      .map(candidate => ({ ...candidate, collisions: obstacles.filter(obstacle => intersects(candidate.box, obstacle)).length }))
      .sort((a, b) => a.collisions - b.collisions || a.point.y - b.point.y || a.point.x - b.point.x)[0]
      ?? { point: endpoint, box: { x0: endpoint.x, y0: endpoint.y, x1: endpoint.x, y1: endpoint.y } }
    obstacles.push(fallback.box)
    return fallback.point
  }

  for (const relationship of relationships) {
    if (relationship.points.length < 2) continue
    if (relationship.fromCardinality) {
      relationship.fromCardinalityPosition = allocate(
        relationship.fromCardinality,
        relationship.points[0]!,
        relationship.points[1]!,
      )
    }
    if (relationship.toCardinality) {
      const last = relationship.points.length - 1
      relationship.toCardinalityPosition = allocate(
        relationship.toCardinality,
        relationship.points[last]!,
        relationship.points[last - 1]!,
      )
    }
  }
}

/**
 * Lay out a parsed class diagram using ELK.js.
 */
export function layoutClassDiagram(
  diagram: ClassDiagram,
  options: RenderOptions = {}
): PositionedClassDiagram {
  if (diagram.classes.length === 0) {
    return { width: 0, height: 0, accessibilityTitle: diagram.accessibilityTitle, accessibilityDescription: diagram.accessibilityDescription, classes: [], relationships: [], notes: [], namespaces: [] }
  }

  const { elkGraph, classSizes } = buildClassElkGraph(diagram, options)
  const result = elkLayoutSync(elkGraph)
  return extractClassLayout(
    result,
    diagram,
    classSizes,
    resolveRenderStyle(options, CLASS_STYLE_DEFAULTS),
    options.class?.hierarchicalNamespaces !== false,
  )
}

/** Calculate the max width of a list of class members (uses mono metrics) */
function maxMemberWidth(members: ClassMember[]): number {
  if (members.length === 0) return 0
  let maxW = 0
  for (const m of members) {
    const text = memberToString(m)
    const w = estimateMonoTextWidth(text, CLS.memberFontSize)
    if (w > maxW) maxW = w
  }
  return maxW
}

/** Convert a class member to its display string */
export function memberToString(m: ClassMember): string {
  const vis = m.visibility ? `${m.visibility} ` : ''
  const name = m.isMethod ? `${m.name}(${m.params || ''})` : m.name
  const type = m.type ? `: ${m.type}` : ''
  return `${vis}${name}${type}`
}
