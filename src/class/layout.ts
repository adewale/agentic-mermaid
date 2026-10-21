import { connectorMarkerPaintRegions } from '../scene/bounds.ts'
import { connector } from '../scene/marks.ts'
import { assertClassDiagramWork } from '../shared/diagram-limits.ts'
import { type DisplayTextInput, prepareDisplayText, resolveLabelContent } from '../shared/display-text.ts'
import { type PixelTextBlock, preparePixelText } from '../shared/prepared-text.ts'
import { classInterfaceMarker } from './interface-occurrences.ts'
import { memberToString } from './text.ts'

export { memberToString } from './text.ts'

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

import type { ElkExtendedEdge, ElkNode, LayoutOptions } from 'elkjs'
import { elkLayoutSync } from '../elk-instance.ts'
import { directionToElk } from '../layout/direction.ts'
import { LayoutCertificationError } from '../layout/certification-error.ts'
import type { MermaidFrontmatterMap } from '../mermaid-source.ts'
import { getFrontmatterScalar } from '../mermaid-source.ts'
import type { InternalStyleFace } from '../scene/style-registry.ts'
import { checkedAuthoredStyle } from '../shared/style-props.ts'
import type { RenderStyleDefaults, ResolvedRenderStyle } from '../styles.ts'
import { diagramTitleBand, FONT_SIZES, FONT_WEIGHTS, positionDiagramTitle, resolveRenderStyle, STROKE_WIDTHS, titleOnlyCanvas } from '../styles.ts'
import { LINE_HEIGHT_RATIO } from '../text-metrics.ts'
import type { Point, RenderOptions } from '../types.ts'
import type { ClassDiagram, ClassMember, ClassNamespace, ClassNode, PositionedClassDiagram, PositionedClassNamespace, PositionedClassNode, PositionedClassRelationship } from './types.ts'

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
 * are named by verify's INEFFECTIVE_CONFIG lint (the family's config.noopKeys in
 * src/agent/families.ts), never silently accepted.
 */
export function resolveClassRenderOptions(frontmatter: MermaidFrontmatterMap | undefined, options: RenderOptions): RenderOptions {
  if (!frontmatter) return options
  const nodeSpacing = configSpacing(frontmatter, 'class', 'nodeSpacing')
  const rankSpacing = configSpacing(frontmatter, 'class', 'rankSpacing')
  const configuredHierarchy = getFrontmatterScalar<boolean>(frontmatter, ['class', 'hierarchicalNamespaces'])
  const hierarchicalNamespaces = options.class?.hierarchicalNamespaces ?? (typeof configuredHierarchy === 'boolean' ? configuredHierarchy : undefined)
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

export function classTextBlock(text: DisplayTextInput, style: ResolvedRenderStyle, role: 'node' | 'edge' | 'group', maxWidth?: number): PixelTextBlock {
  return role === 'node'
    ? preparePixelText(text, { transform: style.nodeTextTransform, fontSize: style.nodeLabelFontSize, fontWeight: style.nodeLabelFontWeight, letterSpacing: style.nodeLetterSpacing, maxWidth })
    : role === 'edge'
      ? preparePixelText(text, { transform: style.edgeTextTransform, fontSize: style.edgeLabelFontSize, fontWeight: style.edgeLabelFontWeight, letterSpacing: style.edgeLetterSpacing, maxWidth })
      : preparePixelText(text, { transform: style.groupTextTransform, fontSize: style.groupHeaderFontSize, fontWeight: style.groupHeaderFontWeight, letterSpacing: style.groupLetterSpacing, fontFamily: style.groupFont, maxWidth })
}

export function classMemberBlock(member: ClassMember): PixelTextBlock {
  return preparePixelText(classLiteralPlan(memberToString(member), member.isAbstract), { display: 'literal', fontSize: CLS.memberFontSize, fontWeight: 400, monospace: true })
}

function classLiteralPlan(text: string, italic = false): DisplayTextInput {
  const prepared = prepareDisplayText(text, 'literal')
  return italic ? { ...prepared, lines: prepared.lines.map(line => line.map(run => ({ ...run, italic: true }))) } : prepared
}

export function classAnnotationBlock(annotation: string): PixelTextBlock {
  return preparePixelText(classLiteralPlan(`<<${annotation}>>`, true), { display: 'literal', fontSize: 10, fontWeight: 500 })
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
    // Flattened siblings no longer convey their ancestry through containment.
    // Keep the full authored path visible unless an explicit label replaces it.
    if (hierarchical || ns.classIds.length > 0 || ns.label !== undefined || ns.children.length === 0) {
      out.push({ path, ...(hierarchical && parentPath ? { parentPath } : {}), ns: !hierarchical && ns.label === undefined ? { ...ns, label: path } : ns })
    }
    out.push(...flattenNamespaces(ns.children, path, hierarchical))
  }
  return out
}

/** Build ELK graph and size map from a class diagram. */
/** A namespace header band tall enough for `title`'s lines. */
function namespaceHeaderHeight(style: ResolvedRenderStyle, title: string | undefined): number {
  const lines = title === undefined ? 1 : title.split('\n').length
  return style.groupHeaderFontSize + 16 + (lines - 1) * style.groupHeaderFontSize * LINE_HEIGHT_RATIO
}

function buildClassElkGraph(diagram: ClassDiagram, options: RenderOptions, styleFace?: Readonly<InternalStyleFace>, titles: ReadonlyMap<string, string> = new Map()): { elkGraph: ElkNode; classSizes: ClassSizeMap } {
  const style = resolveRenderStyle(options, CLASS_STYLE_DEFAULTS, styleFace)
  const classSizes: ClassSizeMap = new Map()

  for (const cls of diagram.classes) {
    const labelBlock = classTextBlock(resolveLabelContent(cls.label, cls.labelContent), style, 'node')
    if (cls.isInterface) {
      const headerHeight = labelBlock.height + 2 * Math.max(16, style.nodePaddingY)
      classSizes.set(cls.id, { width: labelBlock.width + 2 * Math.max(16, style.nodePaddingX), height: headerHeight, headerHeight, attrHeight: 0, methodHeight: 0 })
      continue
    }
    const headerBaseHeight = Math.max(CLS.headerBaseHeight, labelBlock.height + style.nodePaddingY * 2)
    const headerHeight = cls.annotation !== undefined ? headerBaseHeight + CLS.annotationHeight : headerBaseHeight

    const attrHeight = cls.attributes.length > 0 ? cls.attributes.length * CLS.memberRowHeight + style.nodePaddingY : CLS.emptySectionHeight

    const methodHeight = cls.methods.length > 0 ? cls.methods.length * CLS.memberRowHeight + style.nodePaddingY : CLS.emptySectionHeight

    const annotationWidth = cls.annotation === undefined ? 0 : classAnnotationBlock(cls.annotation).width
    const headerTextW = Math.max(labelBlock.width, annotationWidth)
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
  for (const info of namespaces) {
    const headerHeight = namespaceHeaderHeight(style, titles.get(info.path) ?? classTextBlock(resolveLabelContent(info.ns.label ?? info.ns.name, info.ns.labelContent), style, 'group').text)
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
      const metrics = classTextBlock(resolveLabelContent(rel.label, rel.labelContent), style, 'edge')
      // Empty formatted text has no painted label. ELK can leave its label
      // box at the origin, which would invent off-canvas text geometry.
      if (metrics.lineBlocks.some(line => line.runs.some(run => run.text.trim().length > 0))) {
        edge.labels = [{ text: metrics.text, width: metrics.width + 8, height: metrics.height + 6 }]
      }
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
function extractClassLayout(result: ElkNode, diagram: ClassDiagram, classSizes: ClassSizeMap, style: ResolvedRenderStyle, hierarchicalNamespaces: boolean, titles: ReadonlyMap<string, string> = new Map()): PositionedClassDiagram {
  const classLookup = new Map<string, ClassNode>()
  for (const cls of diagram.classes) classLookup.set(cls.id, cls)
  const namespaceInfoByPath = new Map(flattenNamespaces(diagram.namespaces, undefined, hierarchicalNamespaces).map(info => [info.path, info]))

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
          ...(info?.ns.labelContent ? { labelContent: info.ns.labelContent } : {}),
          parentId: info?.parentPath,
          classIds: info ? [...info.ns.classIds] : [],
          x,
          y,
          width: child.width ?? 0,
          height: child.height ?? 0,
          headerHeight: namespaceHeaderHeight(style, titles.get(path) ?? classTextBlock(resolveLabelContent(info?.ns.label ?? info?.ns.name ?? path, info?.ns.labelContent), style, 'group').text),
          ...(titles.has(path) ? { title: titles.get(path)! } : {}),
        })
        walk(child, x, y)
        continue
      }
      const cls = classLookup.get(child.id)
      if (cls) {
        const size = classSizes.get(cls.id)!
        positionedClasses.push({
          id: cls.id,
          ...(cls.isInterface ? { isInterface: true } : {}),
          label: cls.label,
          ...(cls.labelContent ? { labelContent: cls.labelContent } : {}),
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
          ...(cls.tooltip !== undefined ? { tooltip: cls.tooltip } : {}),
          ...((cls.className && diagram.classDefs.get(cls.className)) || cls.inlineStyle
            ? {
                inlineStyle: { ...(cls.className ? checkedAuthoredStyle(diagram.classDefs.get(cls.className), `classDef ${cls.className}`) : {}), ...checkedAuthoredStyle(cls.inlineStyle, `style ${cls.id}`) },
              }
            : {}),
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
      lineStyle: rel.lineStyle,
      markerAt: rel.markerAt,
      fromType: rel.fromType,
      toType: rel.toType,
      label: rel.label,
      ...(rel.labelContent ? { labelContent: rel.labelContent } : {}),
      fromCardinality: rel.fromCardinality,
      ...(rel.fromCardinalityContent ? { fromCardinalityContent: rel.fromCardinalityContent } : {}),
      toCardinality: rel.toCardinality,
      ...(rel.toCardinalityContent ? { toCardinalityContent: rel.toCardinalityContent } : {}),
      points: section?.points ?? [],
      labelPosition: section?.labelPosition,
    })
  }

  let width = result.width ?? 600
  let height = result.height ?? 400
  placeClassCardinalityLabels(relationships, positionedClasses, style, width, height)

  interface NoteBox {
    x: number
    y: number
    width: number
    height: number
  }
  const occupied: NoteBox[] = positionedClasses.map(cls => ({ x: cls.x, y: cls.y, width: cls.width, height: cls.height }))
  const overlaps = (a: NoteBox, b: NoteBox, gap = 8): boolean => a.x < b.x + b.width + gap && a.x + a.width + gap > b.x && a.y < b.y + b.height + gap && a.y + a.height + gap > b.y
  let freestandingY = height + 16
  const notes = diagram.notes.map(note => {
    const metrics = preparePixelText(resolveLabelContent(note.text, note.textContent), { fontSize: 12, fontWeight: 400 })
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
      placement = candidates.find(candidate => candidate.x >= CLS.padding && candidate.y >= CLS.padding && !occupied.some(box => overlaps(candidate, box))) ?? {
        x: width + 24,
        y: target.y,
        width: noteWidth,
        height: noteHeight,
        targetX: target.x + target.width,
        targetY: target.y + target.height / 2,
        noteX: width + 24,
        noteY: target.y + noteHeight / 2,
      }
    } else {
      placement = { x: CLS.padding, y: freestandingY, width: noteWidth, height: noteHeight }
      freestandingY += noteHeight + 12
    }
    occupied.push(placement)
    width = Math.max(width, placement.x + noteWidth + CLS.padding)
    height = Math.max(height, placement.y + noteHeight + CLS.padding)
    return { text: note.text, ...(note.textContent ? { textContent: note.textContent } : {}), ...(note.for ? { for: note.for } : {}), ...placement }
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

/** ELK's compound top padding reserves child space but is traversable by edges.
 * Keep an external relationship's vertical crossing outside a flattened header,
 * changing only the crossing segment and retaining both original class ports. */
function avoidFlatNamespaceHeaders(relationships: PositionedClassRelationship[], classes: PositionedClassNode[], namespaces: PositionedClassNamespace[], style: ResolvedRenderStyle, width: number, height: number): void {
  const headers = namespaces.map(ns => ({ x: ns.x, y: ns.y, width: ns.width, height: ns.headerHeight }))
  const labels = relationships.flatMap(relation => {
    if (!relation.label || !relation.labelPosition) return []
    const block = classTextBlock(resolveLabelContent(relation.label, relation.labelContent), style, 'edge')
    return [{ x: relation.labelPosition.x - block.width / 2 - 2, y: relation.labelPosition.y - block.height / 2 - 2, width: block.width + 4, height: block.height + 4 }]
  })
  const obstacles = [...classes, ...headers, ...labels]
  const intersects = (a: Point, b: Point, box: { x: number; y: number; width: number; height: number }): boolean =>
    Math.min(a.x, b.x) < box.x + box.width - 0.01 && Math.max(a.x, b.x) > box.x + 0.01 && Math.min(a.y, b.y) < box.y + box.height - 0.01 && Math.max(a.y, b.y) > box.y + 0.01
  for (const relation of relationships) for (let namespaceIndex = 0; namespaceIndex < namespaces.length; namespaceIndex++) {
    const ns = namespaces[namespaceIndex]!, header = headers[namespaceIndex]!
    if (ns.classIds.includes(relation.from) === ns.classIds.includes(relation.to)) continue
    for (let segment = 1; segment < relation.points.length; segment++) {
      const a = relation.points[segment - 1]!, b = relation.points[segment]!
      if (a.x !== b.x || !intersects(a, b, header)) continue
      const top = ns.y - 4, bottom = ns.y + ns.headerHeight + 4
      if (Math.min(a.y, b.y) >= top || Math.max(a.y, b.y) <= bottom) continue
      const before = { x: a.x, y: a.y < b.y ? top : bottom }, after = { x: b.x, y: a.y < b.y ? bottom : top }
      const lanes = [ns.x - 8, ns.x + ns.width + 8].sort((left, right) => Math.abs(left - a.x) - Math.abs(right - a.x))
      for (const lane of lanes) {
        const detour = [before, { x: lane, y: before.y }, { x: lane, y: after.y }, after]
        if (detour.some((point, index) => point.x < 0 || point.y < 0 || point.x > width || point.y > height || index > 0 && obstacles.some(box => intersects(detour[index - 1]!, point, box)))) continue
        if (relation.labelPosition && relation.labelPosition.y > top && relation.labelPosition.y < bottom) continue
        relation.points.splice(segment, 0, ...detour)
        segment += detour.length
        break
      }
    }
    if (relation.points.some((point, index) => index > 0 && intersects(relation.points[index - 1]!, point, header))) {
      throw new LayoutCertificationError([{ strategy: 'class-flat-namespace-header', violations: [`Relationship ${relation.from} -> ${relation.to} cannot safely avoid namespace header ${ns.id}`] }])
    }
  }
}

interface CardinalityBox {
  x0: number
  y0: number
  x1: number
  y1: number
}

/** Deterministically allocate endpoint text around routes. The renderer only
 * consumes these positions; overlap freedom is a layout invariant rather than
 * an SVG-time best effort. */
function placeClassCardinalityLabels(relationships: PositionedClassRelationship[], classes: PositionedClassNode[], style: ResolvedRenderStyle, width: number, height: number): void {
  const intersects = (a: CardinalityBox, b: CardinalityBox): boolean => Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0) > 0.5 && Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0) > 0.5
  const obstacles: CardinalityBox[] = classes.map(item => ({
    x0: item.x - 1,
    y0: item.y - 1,
    x1: item.x + item.width + 1,
    y1: item.y + item.height + 1,
  }))
  for (const relationship of relationships) {
    if (!relationship.label || !relationship.labelPosition) continue
    const metrics = classTextBlock(resolveLabelContent(relationship.label, relationship.labelContent), style, 'edge')
    obstacles.push({
      x0: relationship.labelPosition.x - metrics.width / 2 - 2,
      y0: relationship.labelPosition.y - 8 - metrics.height / 2 - 2,
      x1: relationship.labelPosition.x + metrics.width / 2 + 2,
      y1: relationship.labelPosition.y - 8 + metrics.height / 2 + 2,
    })
  }

  const allocate = (text: DisplayTextInput, endpoint: Point, toward: Point): Point => {
    const metrics = preparePixelText(text, { fontSize: style.edgeLabelFontSize, fontWeight: style.edgeLabelFontWeight, letterSpacing: style.edgeLetterSpacing })
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
    const fallback = candidates.map(candidate => ({ ...candidate, collisions: obstacles.filter(obstacle => intersects(candidate.box, obstacle)).length })).sort((a, b) => a.collisions - b.collisions || a.point.y - b.point.y || a.point.x - b.point.x)[0] ?? {
      point: endpoint,
      box: { x0: endpoint.x, y0: endpoint.y, x1: endpoint.x, y1: endpoint.y },
    }
    obstacles.push(fallback.box)
    return fallback.point
  }

  for (const relationship of relationships) {
    if (relationship.points.length < 2) continue
    if (relationship.fromCardinality) {
      relationship.fromCardinalityPosition = allocate(resolveLabelContent(relationship.fromCardinality, relationship.fromCardinalityContent), relationship.points[0]!, relationship.points[1]!)
    }
    if (relationship.toCardinality) {
      const last = relationship.points.length - 1
      relationship.toCardinalityPosition = allocate(resolveLabelContent(relationship.toCardinality, relationship.toCardinalityContent), relationship.points[last]!, relationship.points[last - 1]!)
    }
  }
}

/**
 * Lay out a parsed class diagram using ELK.js.
 */
export function layoutClassDiagram(diagram: ClassDiagram, options: RenderOptions = {}, styleFace?: Readonly<InternalStyleFace>): PositionedClassDiagram {
  assertClassDiagramWork(diagram)
  const style = resolveRenderStyle(options, CLASS_STYLE_DEFAULTS, styleFace)
  if (diagram.classes.length === 0) {
    return withClassTitle({ width: 0, height: 0, accessibilityTitle: diagram.accessibilityTitle, accessibilityDescription: diagram.accessibilityDescription, classes: [], relationships: [], notes: [], namespaces: [] }, diagram.title, style)
  }

  const hierarchicalNamespaces = options.class?.hierarchicalNamespaces !== false
  // A namespace is as wide as its classes, and its header title is drawn from
  // its left edge; a title wider than that wraps, and the layout runs again
  // with a header band tall enough for the lines. Titles that fit never wrap,
  // so most diagrams lay out once.
  let titles: Map<string, string> = new Map()
  let positioned: PositionedClassDiagram | undefined
  for (let pass = 0; pass < 3; pass++) {
    const { elkGraph, classSizes } = buildClassElkGraph(diagram, options, styleFace, titles)
    positioned = extractClassLayout(elkLayoutSync(elkGraph), diagram, classSizes, style, hierarchicalNamespaces, titles)
    const wrapped = wrappedNamespaceTitles(positioned.namespaces, style)
    if (wrapped.size === titles.size && [...wrapped].every(([path, title]) => titles.get(path) === title)) break
    titles = wrapped
  }
  if (!hierarchicalNamespaces) {
    avoidFlatNamespaceHeaders(positioned!.relationships, positioned!.classes, positioned!.namespaces, style, positioned!.width, positioned!.height)
    placeClassCardinalityLabels(positioned!.relationships, positioned!.classes, style, positioned!.width, positioned!.height)
  }
  for (const cls of positioned!.classes) {
    cls.labelBlock = classTextBlock(resolveLabelContent(cls.label, cls.labelContent), style, 'node')
    cls.attributeBlocks = cls.attributes.map(classMemberBlock)
    cls.methodBlocks = cls.methods.map(classMemberBlock)
    if (cls.annotation !== undefined) cls.annotationBlock = classAnnotationBlock(cls.annotation)
  }
  for (const ns of positioned!.namespaces) ns.labelBlock = classTextBlock(resolveLabelContent(ns.label, ns.labelContent), style, 'group', ns.width - 2 * style.groupLabelPaddingX)
  for (const note of positioned!.notes) note.textBlock = preparePixelText(resolveLabelContent(note.text, note.textContent), { fontSize: 12, fontWeight: 400 })
  for (const rel of positioned!.relationships) {
    if (rel.label !== undefined) rel.labelBlock = classTextBlock(resolveLabelContent(rel.label, rel.labelContent), style, 'edge')
    for (const side of ['from', 'to'] as const) {
      const text = rel[`${side}Cardinality`]
      if (text !== undefined) rel[`${side}CardinalityBlock`] = preparePixelText(resolveLabelContent(text, rel[`${side}CardinalityContent`]), { fontSize: style.edgeLabelFontSize, fontWeight: style.edgeLabelFontWeight, letterSpacing: style.edgeLetterSpacing })
    }
  }
  const result = withClassTitle(positioned!, diagram.title, style)
  if (result.classes.some(node => node.isInterface)) {
    const interfaces = new Map(result.classes.filter(node => node.isInterface).map(node => [node.id, node]))
    // Public nodes report the visible glyph, not its invisible label anchor.
    // Use the same descriptor and connector geometry authority as the Scene;
    // like class frames, node boxes exclude their border stroke.
    const marker = { ...classInterfaceMarker('none'), paint: { fill: 'none', stroke: 'none', strokeWidth: '0' } }
    for (const relation of result.relationships) {
      const source = interfaces.get(relation.from),
        target = interfaces.get(relation.to)
      if (!source && !target) continue
      const mark = connector({ id: 'interface-projection', role: 'relationship', geometry: { kind: 'polyline', points: relation.points }, lineStyle: 'solid', paint: { strokeWidth: String(style.lineWidth) }, markers: { ...(source ? { start: marker } : {}), ...(target ? { end: marker } : {}) } })
      for (const region of connectorMarkerPaintRegions(mark)) {
        const node = region.position === 'start' ? source : target,
          box = region.bounds
        if (node && box) node.interfaceBox = { x: box.x0, y: box.y0, width: box.x1 - box.x0, height: box.y1 - box.y0 }
      }
    }
  }
  return result
}

/** The diagram's title takes a band above everything the layout placed. */
function withClassTitle(positioned: PositionedClassDiagram, title: string | undefined, style: ResolvedRenderStyle): PositionedClassDiagram {
  const band = diagramTitleBand(title, style)
  if (!band) return positioned
  if (positioned.width === 0 && positioned.height === 0) return { ...positioned, ...titleOnlyCanvas(band, CLS.padding) }
  const dy = band.height
  for (const cls of positioned.classes) cls.y += dy
  for (const ns of positioned.namespaces) ns.y += dy
  for (const note of positioned.notes) {
    note.y += dy
    if (note.targetY !== undefined) note.targetY += dy
    if (note.noteY !== undefined) note.noteY += dy
  }
  for (const rel of positioned.relationships) {
    for (const point of rel.points) point.y += dy
    for (const position of [rel.labelPosition, rel.fromCardinalityPosition, rel.toCardinalityPosition]) {
      if (position) position.y += dy
    }
  }
  const width = Math.max(positioned.width, band.width + 2 * CLS.padding)
  return { ...positioned, width, height: positioned.height + dy, title: positionDiagramTitle(band, width, CLS.padding) }
}

/** Titles of the namespaces whose header text does not fit their width, wrapped to fit. */
function wrappedNamespaceTitles(namespaces: readonly PositionedClassNamespace[], style: ResolvedRenderStyle): Map<string, string> {
  const titles = new Map<string, string>()
  for (const ns of namespaces) {
    const room = ns.width - 2 * style.groupLabelPaddingX
    const block = classTextBlock(resolveLabelContent(ns.label, ns.labelContent), style, 'group', room)
    const unwrapped = classTextBlock(resolveLabelContent(ns.label, ns.labelContent), style, 'group')
    if (block.text !== unwrapped.text) titles.set(ns.id, block.text)
  }
  return titles
}

/** Calculate the max width of a list of class members (uses mono metrics) */
function maxMemberWidth(members: ClassMember[]): number {
  if (members.length === 0) return 0
  let maxW = 0
  for (const m of members) {
    const w = classMemberBlock(m).width
    if (w > maxW) maxW = w
  }
  return maxW
}
