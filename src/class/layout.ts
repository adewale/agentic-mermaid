import { measuredRouteContactPairBudget, scoreMeasuredRouteCrossings, createOwnedMeasuredRouteContactValidator, type OwnedMeasuredRouteNumericSeed } from '../layout/measured-route-safety.ts'
import type { MeasuredGraph } from '../layout/agentic-layered-core.ts'
import { resolveDiagramColors } from '../color-resolver.ts'
import { connectorMarkerPaintRegions } from '../scene/bounds.ts'
import { connector } from '../scene/marks.ts'
import { configSpacing } from '../shared/config-spacing.ts'
import { assertClassDiagramWork } from '../shared/diagram-limits.ts'
import { type DisplayTextInput, prepareDisplayText, resolveLabelContent } from '../shared/display-text.ts'
import { type PixelTextBlock, preparePixelText } from '../shared/prepared-text.ts'
import { repairClassAnnotationSeats } from './annotation-seats.ts'
import { type ClassRectangleContact, assertClassElkSelfContactsClear, constructClassElkSelfContacts, projectClassRectangleContacts, retainClassRectangleContacts } from './elk-contacts.ts'
import { assertClassHeaderPeersClear, finalClassHeaderNumericSeed, type ClassHeaderNumericCapture } from './header-lanes.ts'
import { classInterfaceMarker } from './interface-occurrences.ts'
import { assertClassMarkerMeaning, type ClassMarkerAdmissionWork, chargeClassMarkerAdmissionWork, createClassMarkerAdmissionWork } from './marker-admission.ts'
import { buildClassEndpointMarkerTemplates } from './marker-measurement.ts'
import { classElkMarkerMinimums, classNativeMarkerMinimums } from './marker-port-capacity.ts'
import { classMarkerHeaderInsets, classOwnedSurfaceViolations, repairClassHeaderRoutes, repairClassNoteSeats } from './owned-surfaces.ts'
import { classEndpointTextCandidates } from './relationship-paint.ts'
import { memberToString } from './text.ts'

export { memberToString } from './text.ts'

/**
 * Class measured layout adapters.
 *
 * Each class box has 3 compartments:
 *   1. Header (class name + optional annotation)
 *   2. Attributes section
 *   3. Methods section
 *
 * The native producer places namespace scopes from measured frames and retains
 * authored leaf endpoints when routing across their boundaries.
 * ELK namespaces lay out as compound nodes (the flowchart-subgraph pattern):
 * member classes are children of their namespace's compound, the compound
 * reserves a header band for the label via top padding, and relationships are
 * hosted on the lowest common ancestor compound so ELK (INCLUDE_CHILDREN)
 * routes across namespace boundaries; extraction adds each host's absolute
 * offset back. Containment is therefore by construction, not by a check.
 */

import type { ElkExtendedEdge, ElkNode, LayoutOptions } from 'elkjs'
import { elkLayoutSync } from '../elk-instance.ts'
import { layoutAgenticGraph } from '../layout/agentic-layered.ts'
import { GraphLayoutUnsupportedError } from '../layout/backend.ts'
import { LayoutCertificationError } from '../layout/certification-error.ts'
import { directionToElk } from '../layout/backend.ts'
import { runMeasuredGraphBackend } from '../layout/backend.ts'
import type { MermaidFrontmatterMap } from '../mermaid-source.ts'
import { getFrontmatterScalar } from '../mermaid-source.ts'
import { measureRenderStage } from '../render-stages.ts'
import type { InternalStyleFace } from '../scene/style-registry.ts'
import { generatedIds } from '../shared/generated-identity.ts'
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

/** Preferred namespace compound ids; authored cards can use this prefix too. */
const NS_PREFIX = 'ns:'

/** Namespace membership resolved to flat paths (parent-first order). */
interface NamespaceInfo {
  path: string
  parentPath?: string
  ns: ClassNamespace
  ancestors: string[]
}

interface NamespaceLayout extends NamespaceInfo {
  headerHeight: number
  labelWidth: number
}

function flattenNamespaces(namespaces: ClassNamespace[], parent?: NamespaceInfo, hierarchical = true): NamespaceInfo[] {
  const out: NamespaceInfo[] = []
  for (const ns of namespaces) {
    const path = parent ? `${parent.path}.${ns.name}` : ns.name
    const info: NamespaceInfo = {
      path,
      parentPath: hierarchical ? parent?.path : undefined,
      ns: !hierarchical && ns.label === undefined ? { ...ns, label: path } : ns,
      ancestors: hierarchical && parent ? [...parent.ancestors, path] : [path],
    }
    // Flattened siblings no longer convey their ancestry through containment.
    // Keep the full authored path visible unless an explicit label replaces it.
    if (hierarchical || ns.classIds.length > 0 || ns.label !== undefined || ns.children.length === 0) out.push(info)
    out.push(...flattenNamespaces(ns.children, info, hierarchical))
  }
  return out
}

/** Build ELK graph and size map from a class diagram. */
/** A namespace header band tall enough for `title`'s lines. */
function namespaceHeaderHeight(style: ResolvedRenderStyle, title: string | undefined): number {
  const lines = title === undefined ? 1 : title.split('\n').length
  return style.groupHeaderFontSize + 16 + (lines - 1) * style.groupHeaderFontSize * LINE_HEIGHT_RATIO
}

function measureClassCards(diagram: ClassDiagram, style: ResolvedRenderStyle): ClassSizeMap {
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

  return classSizes
}

function buildClassElkGraph(diagram: ClassDiagram, options: RenderOptions, classSizes: ClassSizeMap, styleFace?: Readonly<InternalStyleFace>, titles: ReadonlyMap<string, string> = new Map(), headerInsets: ReadonlyMap<string, number> = new Map()): { elkGraph: ElkNode; namespaceLayouts: ReadonlyMap<string, NamespaceLayout> } {
  const style = resolveRenderStyle(options, CLASS_STYLE_DEFAULTS, styleFace)
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
  const namespaceOfClass = new Map<string, NamespaceInfo>()
  for (const info of namespaces) {
    for (const id of info.ns.classIds) {
      if (!namespaceOfClass.has(id)) namespaceOfClass.set(id, info)
    }
  }

  // Compound nodes for namespaces, parent-first so parents exist when
  // children attach. Reserve authored card identities before assigning any
  // compound identity; role comes from this map, never an authored id prefix.
  const generated = generatedIds(diagram.classes.map(cls => cls.id))
  const namespaceLayouts = new Map<string, NamespaceLayout>()
  const elkByPath = new Map<string, ElkNode>()
  for (const info of namespaces) {
    const block = classTextBlock(resolveLabelContent(info.ns.label ?? info.ns.name, info.ns.labelContent), style, 'group')
    const headerHeight = namespaceHeaderHeight(style, titles.get(info.path) ?? block.text)
    const compound: ElkNode = {
      id: generated(NS_PREFIX + info.path, ['class', 'elk-namespace', info.path]),
      layoutOptions: {
        'elk.padding': `[top=${headerHeight + Math.max(style.groupPaddingY, headerInsets.get(info.path) ?? 0)},left=${style.groupPaddingX + 8},bottom=${style.groupPaddingY + 8},right=${style.groupPaddingX + 8}]`,
        'elk.spacing.nodeNode': String(nodeSpacing),
        'elk.layered.spacing.nodeNodeBetweenLayers': String(layerSpacing),
        'elk.edgeRouting': 'ORTHOGONAL',
        'elk.edgeLabels.placement': 'CENTER',
      },
      children: [],
      edges: [],
    }
    namespaceLayouts.set(compound.id, { ...info, headerHeight, labelWidth: block.width })
    elkByPath.set(info.path, compound)
    const parent = info.parentPath ? elkByPath.get(info.parentPath)! : elkGraph
    parent.children!.push(compound)
  }

  for (const cls of diagram.classes) {
    const size = classSizes.get(cls.id)!
    const leaf: ElkNode = { id: cls.id, width: size.width, height: size.height }
    const host = namespaceOfClass.get(cls.id)
    ;(host ? elkByPath.get(host.path)! : elkGraph).children!.push(leaf)
  }

  // ELK treats a compound with no children as a leaf and ignores its padding.
  // Supply the measured frame instead of losing an authored empty namespace.
  for (const info of namespaceLayouts.values()) {
    const compound = elkByPath.get(info.path)!
    if (compound.children!.length) continue
    compound.width = info.labelWidth + 2 * Math.max(style.groupLabelPaddingX, style.groupPaddingX + 8)
    compound.height = info.headerHeight + 2 * style.groupPaddingY + 8
  }

  // Host each relationship on the lowest common ancestor compound so its
  // section coordinates come back in that compound's frame (extraction adds
  // the compound's absolute offset — the flowchart INCLUDE_CHILDREN pattern).
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
    const fromChain = namespaceOfClass.get(rel.from)?.ancestors ?? []
    const toChain = namespaceOfClass.get(rel.to)?.ancestors ?? []
    let lca: string | undefined
    for (let k = 0; k < Math.min(fromChain.length, toChain.length); k++) {
      if (fromChain[k] === toChain[k]) lca = fromChain[k]
      else break
    }
    ;(lca ? elkByPath.get(lca)! : elkGraph).edges!.push(edge)
  }

  return { elkGraph, namespaceLayouts }
}

interface ClassPlacement {
  width?: number
  height?: number
  nodes: { id: string; x: number; y: number; width?: number; height?: number; namespacePath?: string }[]
  routes: Map<number, { points: Point[]; labelPosition?: Point }>
  /** Same-pass ELK identity and measured namespace metadata; absent for Native. */
  namespaceLayouts?: ReadonlyMap<string, NamespaceLayout>
}

function projectClassElkPlacement(result: ElkNode, namespaceLayouts: ReadonlyMap<string, NamespaceLayout>): ClassPlacement {
  const nodes: ClassPlacement['nodes'] = [],
    routes: ClassPlacement['routes'] = new Map()
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
      routes.set(Number(elkEdge.id.slice(1)), { points, labelPosition })
    }

    for (const child of node.children ?? []) {
      const x = (child.x ?? 0) + offsetX,
        y = (child.y ?? 0) + offsetY
      const namespacePath = namespaceLayouts.get(child.id)?.path
      nodes.push({ id: child.id, x, y, width: child.width, height: child.height, ...(namespacePath !== undefined ? { namespacePath } : {}) })
      if (namespacePath !== undefined) walk(child, x, y)
    }
  }
  walk(result, 0, 0)
  return { width: result.width, height: result.height, nodes, routes, namespaceLayouts }
}

/** Project either measured placement through Class-owned card/marker rules. */
/** Renderer class cards inherit default paint, then their one assigned class,
 * then inline paint. The source grammar stores a single assigned class name;
 * repeated assignments already resolve to the last one in the parser.
 * Generated interface occurrences use their separate circle/label renderer. */
function classNodePaint(diagram: ClassDiagram, cls: ClassNode): Record<string, string> | undefined {
  const defaults = cls.isInterface ? undefined : diagram.classDefs.get('default'),
    named = cls.className ? diagram.classDefs.get(cls.className) : undefined
  if (!defaults && !named && !cls.inlineStyle) return undefined
  return {
    ...checkedAuthoredStyle(defaults, 'classDef default'),
    ...checkedAuthoredStyle(named, `classDef ${cls.className}`),
    ...checkedAuthoredStyle(cls.inlineStyle, `style ${cls.id}`),
  }
}

function extractClassLayout(result: ClassPlacement, diagram: ClassDiagram, classSizes: ClassSizeMap, style: ResolvedRenderStyle, hierarchicalNamespaces: boolean, titles: ReadonlyMap<string, string> = new Map()): PositionedClassDiagram {
  const classLookup = new Map<string, ClassNode>()
  for (const cls of diagram.classes) classLookup.set(cls.id, cls)
  const namespaceInfoByPath = result.namespaceLayouts ? undefined : new Map(flattenNamespaces(diagram.namespaces, undefined, hierarchicalNamespaces).map(info => [info.path, info]))

  const positionedClasses: PositionedClassNode[] = []
  const positionedNamespaces: PositionedClassNamespace[] = []
  const edgeSections = result.routes

  for (const child of result.nodes) {
    const { x, y } = child
    if (child.namespacePath !== undefined) {
      const path = child.namespacePath
      const layout = result.namespaceLayouts?.get(child.id)
      const info = layout ?? namespaceInfoByPath?.get(path)
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
        headerHeight: layout?.headerHeight ?? namespaceHeaderHeight(style, titles.get(path) ?? classTextBlock(resolveLabelContent(info?.ns.label ?? info?.ns.name ?? path, info?.ns.labelContent), style, 'group').text),
        ...(titles.has(path) ? { title: titles.get(path)! } : {}),
      })
      continue
    }
    const cls = classLookup.get(child.id)
    if (cls) {
      const size = classSizes.get(cls.id)!, local = classNodePaint(diagram, cls)
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
        methodHeight: size.methodHeight + Math.max(0, (child.height ?? size.height) - size.height),
        ...(cls.className ? { className: cls.className } : {}),
        ...(cls.href ? { href: cls.href } : {}),
        ...(cls.tooltip !== undefined ? { tooltip: cls.tooltip } : {}),
        ...(local ? { inlineStyle: local } : {}),
      })
    }
  }

  const relationships: PositionedClassRelationship[] = []
  for (let i = 0; i < diagram.relationships.length; i++) {
    const rel = diagram.relationships[i]!
    const section = edgeSections.get(i)
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
  let freestandingY = Math.max(height + 16, CLS.padding)
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

interface CardinalityBox {
  x0: number
  y0: number
  x1: number
  y1: number
}

/** Deterministically allocate endpoint text around routes. The renderer only
 * consumes these positions; overlap freedom is a layout invariant rather than
 * an SVG-time best effort. */
function placeClassCardinalityLabels(relationships: PositionedClassRelationship[], classes: PositionedClassNode[], style: ResolvedRenderStyle, width: number, height: number, extraObstacles: readonly CardinalityBox[] = [], preserveExisting = false): void {
  if (!relationships.some(relationship => relationship.fromCardinality || relationship.toCardinality)) return
  const strictIntersects = (a: CardinalityBox, b: CardinalityBox): boolean => Math.min(a.x1, b.x1) > Math.max(a.x0, b.x0) && Math.min(a.y1, b.y1) > Math.max(a.y0, b.y0)
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

  const allocate = (text: DisplayTextInput, endpoint: Point, toward: Point, preferred?: Point): Point => {
    const metrics = preparePixelText(text, { fontSize: style.edgeLabelFontSize, fontWeight: style.edgeLabelFontWeight, letterSpacing: style.edgeLetterSpacing })
    const halfW = metrics.width / 2 + 2
    const halfH = metrics.height / 2 + 2
    const accepted = (box: CardinalityBox): boolean => box.x0 >= 0 && box.y0 >= 0 && box.x1 <= width && box.y1 <= height && obstacles.every(obstacle => !intersects(box, obstacle)) && extraObstacles.every(obstacle => !strictIntersects(box, obstacle))
    if (preserveExisting && preferred) {
      const box = { x0: preferred.x - halfW, y0: preferred.y - halfH, x1: preferred.x + halfW, y1: preferred.y + halfH }
      if (accepted(box)) {
        obstacles.push(box)
        return preferred
      }
    }
    const candidates: Array<{ point: Point; box: CardinalityBox }> = []
    for (const point of classEndpointTextCandidates(endpoint, toward)) {
      const box = { x0: point.x - halfW, y0: point.y - halfH, x1: point.x + halfW, y1: point.y + halfH }
      candidates.push({ point, box })
      if (accepted(box)) {
        obstacles.push(box)
        return point
      }
    }
    // Extremely small canvases may have no perfect slot. Choose the stable
    // candidate with the fewest collisions; normal and stress layouts never
    // reach this fallback, but it keeps malformed/degenerate input renderable.
    if (preserveExisting) throw new LayoutCertificationError([{ strategy: 'class-owned-cardinality', violations: ['No collision-free endpoint text seat in the existing bounded candidates'] }])
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
      relationship.fromCardinalityPosition = allocate(resolveLabelContent(relationship.fromCardinality, relationship.fromCardinalityContent), relationship.points[0]!, relationship.points[1]!, relationship.fromCardinalityPosition)
    }
    if (relationship.toCardinality) {
      const last = relationship.points.length - 1
      relationship.toCardinalityPosition = allocate(resolveLabelContent(relationship.toCardinality, relationship.toCardinalityContent), relationship.points[last]!, relationship.points[last - 1]!, relationship.toCardinalityPosition)
    }
  }
}

/**
 * Lay out measured Class cards with the selected graph backend.
 */
export function layoutClassDiagram(diagram: ClassDiagram, options: RenderOptions = {}, styleFace?: Readonly<InternalStyleFace>, paintBackendId?: string): PositionedClassDiagram {
  assertClassDiagramWork(diagram)
  const style = resolveRenderStyle(options, CLASS_STYLE_DEFAULTS, styleFace)
  // These first-party marker overlays are canonical. Sketch notes can extend
  // outside the native note envelope, so they cannot prove final non-restoration.
  const canonicalMarkers = paintBackendId === undefined || paintBackendId === 'backend:default' || ((paintBackendId === 'backend:rough' || paintBackendId === 'backend:hybrid') && diagram.notes.length === 0)
  // Resolve once, before either callback, from the canonical request options.
  const hasMarkers = diagram.relationships.some(rel => rel.markerAt !== 'none')
  const inkWork = createClassMarkerAdmissionWork()
  const markerAdmission = canonicalMarkers && hasMarkers ? { colors: Object.freeze(resolveDiagramColors(options, options.mermaidConfig ?? {})), work: inkWork } : undefined
  if (diagram.classes.length === 0 && !diagram.namespaces.length && !diagram.notes.length) {
    const empty = (): PositionedClassDiagram => withClassTitle({ width: 0, height: 0, accessibilityTitle: diagram.accessibilityTitle, accessibilityDescription: diagram.accessibilityDescription, classes: [], relationships: [], notes: [], namespaces: [] }, diagram.title, style)
    return runMeasuredGraphBackend(options, empty, empty)
  }
  const classSizes = measureClassCards(diagram, style)
  const hierarchicalNamespaces = options.class?.hierarchicalNamespaces !== false
  let titles: Map<string, string> = new Map()
  return runMeasuredGraphBackend(
    options,
    () => {
      const namespaces = flattenNamespaces(diagram.namespaces, undefined, hierarchicalNamespaces)
      const groupIndices = new Map(namespaces.map((info, index) => [info.path, index]))
      if (groupIndices.size !== namespaces.length) throw new GraphLayoutUnsupportedError('ambiguous Class namespace paths')
      const membership = new Map<string, number>()
      for (const [index, info] of namespaces.entries()) for (const id of info.ns.classIds) if (!membership.has(id)) membership.set(id, index)
      const generated = generatedIds(diagram.classes.map(cls => cls.id))
      const groups = namespaces.map(info => {
        const block = classTextBlock(resolveLabelContent(info.ns.label ?? info.ns.name, info.ns.labelContent), style, 'group')
        const headerHeight = namespaceHeaderHeight(style, block.text)
        return {
          id: generated(`class-namespace:${info.path}`, ['class', 'namespace', info.path]),
          ...(info.parentPath ? { parent: groupIndices.get(info.parentPath)! } : {}),
          minWidth: block.width + 2 * Math.max(style.groupLabelPaddingX, style.groupPaddingX + 8),
          headerHeight,
          padding: { top: headerHeight + style.groupPaddingY, right: style.groupPaddingX + 8, bottom: style.groupPaddingY + 8, left: style.groupPaddingX + 8 },
        }
      })
      const indices = new Map(diagram.classes.map((cls, index) => [cls.id, index]))
      const labels = diagram.relationships.map(rel => {
        const block = rel.label ? classTextBlock(resolveLabelContent(rel.label, rel.labelContent), style, 'edge') : undefined
        return block?.lineBlocks.some(line => line.runs.some(run => run.text.trim())) ? { width: block.width + 8, height: block.height + 6 } : undefined
      })
      const markerTemplates = buildClassEndpointMarkerTemplates(diagram.relationships, style)
      // One Native placement, using copied minima. Extra vertical reservation
      // is blank last-compartment space; authored text measurements stay fixed.
      const nativeMinimums = inkWork ? classNativeMarkerMinimums(diagram.classes, diagram.relationships, markerTemplates, style.lineWidth, diagram.direction??'TB', inkWork) : undefined
      const chargeNativeSize=(units:number):void=>{for(let unit=0;unit<units;unit++)if(!chargeClassMarkerAdmissionWork(inkWork!))throw new LayoutCertificationError([{strategy:'class-native-marker-capacity',violations:['Class marker capacity work limit']}])}
      let nativeClassSizes = classSizes
      for(const [id,minimum] of nativeMinimums ?? []){
        chargeNativeSize(5)
        const old=classSizes.get(id)!,height=Math.max(old.height,minimum.height),width=Math.max(old.width,minimum.width)
        if(height===old.height&&width===old.width)continue
        if(nativeClassSizes===classSizes){chargeNativeSize(classSizes.size+1);nativeClassSizes=new Map(classSizes)}
        chargeNativeSize(3)
        nativeClassSizes.set(id,{...old,width,height,methodHeight:old.methodHeight+(height-old.height)})
      }
      const markerNodeStrokes = diagram.classes.map(cls => {
        const local = classNodePaint(diagram, cls)
        const parsed = Number.parseFloat(local?.['stroke-width'] ?? '')
        return Number.isFinite(parsed) && parsed > 0 ? parsed : style.nodeLineWidth
      })
      const placed = measureRenderStage('agentic', () =>
        layoutAgenticGraph({
          nodes: diagram.classes.map((cls, index) => ({ id: cls.id, width: nativeClassSizes.get(cls.id)!.width, height: nativeClassSizes.get(cls.id)!.height, paintStrokeWidth: markerNodeStrokes[index], ...(!cls.isInterface && (paintBackendId===undefined||paintBackendId==='backend:default') ? {paintCornerRadius:style.cornerRadius??0} : {}), ...(nativeMinimums?.has(cls.id) ? { minimumPortSpacing: nativeMinimums.get(cls.id)!.portSpacing } : {}), ...(membership.has(cls.id) ? { parent: membership.get(cls.id)! } : {}) })),
          groups: groups.map(group => ({ ...group, paintStrokeWidth: style.groupLineWidth, ...((paintBackendId === undefined || paintBackendId === 'backend:default') ? { paintCornerRadius: style.groupCornerRadius } : {}) })),
          edges: diagram.relationships.map((rel, index) => {
            const source = indices.get(rel.from),
              target = indices.get(rel.to)
            if (source === undefined || target === undefined) throw new Error('Class relationship references an undeclared card')
            return { source, target, minSpan: 1, markerPaint: markerTemplates[index], ...(labels[index] ? { label: labels[index] } : {}) }
          }),
          direction: diagram.direction ?? 'TB',
          padding: CLS.padding,
          nodeSpacing: options.nodeSpacing ?? CLS.nodeSpacing,
          layerSpacing: options.layerSpacing ?? CLS.layerSpacing,
          edgeSpacing: Math.max(6, style.lineWidth + 4),
          maximumEdgeStrokeWidth: style.lineWidth,
          maximumEdgeBendRadius: style.edgeBendRadius,
        }),
      )
      if (placed.nodes.length !== diagram.classes.length || (placed.groups?.length ?? 0) !== namespaces.length || placed.edges.length !== diagram.relationships.length) {
        throw new TypeError('Native Class placement lost measured subjects')
      }
      const geometry: ClassPlacement = {
        width: placed.width,
        height: placed.height,
        nodes: [
          ...placed.nodes.map((node, index) => ({ ...node, id: diagram.classes[index]!.id, width: nativeClassSizes.get(diagram.classes[index]!.id)!.width, height: nativeClassSizes.get(diagram.classes[index]!.id)!.height })),
          ...namespaces.map((info, index) => ({ ...placed.groups![index]!, id: NS_PREFIX + info.path, namespacePath: info.path })),
        ],
        routes: new Map(
          placed.edges.map((edge, index) => [
            index,
            {
              points: edge.points,
              // Class text is painted eight pixels above its stored route anchor.
              ...(edge.labelPosition ? { labelPosition: { x: edge.labelPosition.x, y: edge.labelPosition.y + 8 } } : {}),
            },
          ]),
        ),
      }
      return finishClassLayout(extractClassLayout(geometry, diagram, nativeClassSizes, style, hierarchicalNamespaces), diagram, style, markerAdmission, inkWork)
    },
    () => {
      // Wrapped namespace headers retain the existing bounded ELK sizing loop.
      let result: PositionedClassDiagram | undefined
      let headerInsets: ReadonlyMap<string, number> = new Map()
      let elkSizes = classSizes
      for (let pass = 0; pass < 3; pass++) {
        const { elkGraph, namespaceLayouts } = buildClassElkGraph(diagram, options, elkSizes, styleFace, titles, headerInsets)
        // Freestanding notes need no engine work when there is no graph to place.
        const elkResult = elkGraph.children?.length || elkGraph.edges?.length ? elkLayoutSync(elkGraph) : { ...elkGraph, width: 0, height: 0 }
        result = extractClassLayout(projectClassElkPlacement(elkResult, namespaceLayouts), diagram, elkSizes, style, hierarchicalNamespaces, titles)
        const wrapped = wrappedNamespaceTitles(result.namespaces, style)
        const nextInsets = result.namespaces.length ? classMarkerHeaderInsets(result, style, headerInsets, inkWork) : headerInsets
        const minimums = markerAdmission ? classElkMarkerMinimums(result, style, markerAdmission.work) : new Map()
        let nextSizes = elkSizes
        for (const [id, minimum] of minimums) {
          const size = elkSizes.get(id)!
          const width = Math.max(size.width, minimum.width),
            height = Math.max(size.height, minimum.height)
          if (width === size.width && height === size.height) continue
          if (nextSizes === elkSizes) nextSizes = new Map(elkSizes)
          nextSizes.set(id, { ...size, width, height, methodHeight: size.methodHeight + height - size.height })
        }
        if (nextSizes === elkSizes && wrapped.size === titles.size && [...wrapped].every(([path, title]) => titles.get(path) === title) && nextInsets.size === headerInsets.size && [...nextInsets].every(([id, inset]) => headerInsets.get(id) === inset)) break
        titles = wrapped
        headerInsets = nextInsets
        elkSizes = nextSizes
      }
      return finishClassLayout(result!, diagram, style, markerAdmission, inkWork, true, paintBackendId === undefined || paintBackendId === 'backend:default')
    },
    true,
  )
}

function finishClassLayout(positioned: PositionedClassDiagram, diagram: ClassDiagram, style: ResolvedRenderStyle, markerAdmission?: { colors: ReturnType<typeof resolveDiagramColors>; work: ClassMarkerAdmissionWork }, inkWork?: ClassMarkerAdmissionWork, elk = false, literalRectangles = false): PositionedClassDiagram {
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
  const endpointChanges = elk && literalRectangles && inkWork ? constructClassElkSelfContacts(positioned, style, inkWork) : undefined
  const contacts = retainClassRectangleContacts(positioned, inkWork)
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
  finalizeClassSurfaces(result, style, inkWork, contacts, true, endpointChanges)
  if (markerAdmission) assertClassMarkerMeaning(result, style, markerAdmission.colors, markerAdmission.work)
  return result
}

/** Shared final geometric admission for both Class producers. */
export function finalizeClassOwnedSurfaces(result: PositionedClassDiagram, style: ResolvedRenderStyle, inkWork?: ClassMarkerAdmissionWork, contacts?: readonly ClassRectangleContact[]): void {
  finalizeClassSurfaces(result, style, inkWork, contacts)
}

function finalizeClassSurfaces(result: PositionedClassDiagram, style: ResolvedRenderStyle, inkWork?: ClassMarkerAdmissionWork, contacts?: readonly ClassRectangleContact[], stableGeometry = false, endpointChanges?: ReadonlySet<number>): void {
  if (contacts) projectClassRectangleContacts(contacts, inkWork)
  const peerWork=inkWork??createClassMarkerAdmissionWork()
  let numeric:ClassHeaderNumericCapture|undefined
  if(stableGeometry&&style.edgeBendRadius===0&&result.namespaces.length&&result.relationships.length){
    if(!chargeClassMarkerAdmissionWork(peerWork))throw new LayoutCertificationError([{strategy:'class-final-sharp-contacts',violations:['Class final contact capture work limit']}])
    numeric={}
  }
  const changed = repairClassHeaderRoutes(result, style, inkWork,numeric)
  const extra = [...result.namespaces.map(ns => ({ x0: ns.x, y0: ns.y, x1: ns.x + ns.width, y1: ns.y + ns.headerHeight })), ...result.notes.map(n => ({ x0: n.x, y0: n.y, x1: n.x + n.width, y1: n.y + n.height }))]
  if (result.relationships.some(rel => rel.markerAt !== 'none')) {
    const oldLeft = result.classes[0]?.x, oldTop = result.classes[0]?.y
    repairClassNoteSeats(result, style, CLS.padding, inkWork)
    if (contacts && (result.classes[0]?.x !== oldLeft || result.classes[0]?.y !== oldTop)) projectClassRectangleContacts(contacts, inkWork)
    repairClassAnnotationSeats(result, style, inkWork ?? createClassMarkerAdmissionWork(), changed)
  } else {
    placeClassCardinalityLabels(result.relationships, result.classes, style, result.width, result.height, extra, true)
    const oldLeft = result.classes[0]?.x, oldTop = result.classes[0]?.y
    repairClassNoteSeats(result, style, CLS.padding, inkWork)
    if (contacts && (result.classes[0]?.x !== oldLeft || result.classes[0]?.y !== oldTop)) projectClassRectangleContacts(contacts, inkWork)
  }
  if (!result.relationships.some(rel => rel.markerAt !== 'none') && changed.size) repairClassAnnotationSeats(result, style, inkWork ?? createClassMarkerAdmissionWork(), changed)
  assertClassElkSelfContactsClear(result,style,endpointChanges,peerWork)
  const violations = classOwnedSurfaceViolations(result, style)
  if (violations.length) throw new LayoutCertificationError([{ strategy: 'class-owned-surfaces', violations }])
  // The private snapshot has one complete sharp authority. General/live and
  // rounded callers keep their original fresh header-peer validation.
  if(!stableGeometry||style.edgeBendRadius!==0)assertClassHeaderPeersClear(result,changed,style,()=>chargeClassMarkerAdmissionWork(peerWork))
  let seed:OwnedMeasuredRouteNumericSeed|undefined
  if(numeric){
    if(!chargeClassMarkerAdmissionWork(peerWork))throw new LayoutCertificationError([{strategy:'class-final-sharp-contacts',violations:['Class final contact capture work limit']}])
    seed=finalClassHeaderNumericSeed(numeric,result.relationships,style,()=>chargeClassMarkerAdmissionWork(peerWork))
  }
  assertFinalClassSharpContacts(result, style, peerWork, stableGeometry,changed.size>0||!!endpointChanges?.size,seed)
}

/** Title bands and leading note seats translate Number coordinates after the
 * root producer proof. Canonical SVG spelling is not translation-invariant;
 * recheck every final sharp pair against the SAME request's remaining work. */
function assertFinalClassSharpContacts(result: PositionedClassDiagram, style: ResolvedRenderStyle, work: ClassMarkerAdmissionWork, stableGeometry: boolean,validateSegments=false,seed?:OwnedMeasuredRouteNumericSeed): void {
  if (style.edgeBendRadius !== 0 || result.relationships.length < 2&&!(stableGeometry&&validateSegments)) return
  const refuse = (message: string): never => { throw new LayoutCertificationError([{ strategy: 'class-final-sharp-contacts', violations: [message] }]) }
  const pay = (amount = 1): void => {
    for (let i = 0; i < amount; i++) if (!chargeClassMarkerAdmissionWork(work)) refuse('Class final sharp contact work limit')
  }
  // Map/arrays/records and callbacks are local to this immutable final snapshot.
  pay(2 * result.classes.length + 3 * result.relationships.length + 8)
  const indices = new Map(result.classes.map((node, index) => [node.id, index]))
  const input: MeasuredGraph = {
    nodes: [],
    edges: result.relationships.map(rel => {
      const source = indices.get(rel.from), target = indices.get(rel.to)
      if (source === undefined || target === undefined) refuse('Undeclared final Class endpoint')
      return { source: source!, target: target!, minSpan: 1 }
    }),
    direction: 'TB', padding: 0, nodeSpacing: 0, layerSpacing: 0,
    maximumEdgeStrokeWidth: style.lineWidth, maximumEdgeBendRadius: 0,
  }
  const routes = result.relationships.map(rel => ({ points: rel.points, style: 'solid' }))
  pay()
  if(stableGeometry){
    const prepared=createOwnedMeasuredRouteContactValidator(routes,input,pay,pay,validateSegments,seed)
    if(prepared===false)refuse('Final Class routes have unsupported cardinal support')
    const validate=typeof prepared==='function'?prepared:refuse('Class final sharp contact work limit')
    for(let index=0;index+1<routes.length;index++){
      if(!validate(index))refuse('Final Class routes have an uncertified shared contact')
      routes[index]!.style='invisible'
    }
    return
  }
  const pairBudget = measuredRouteContactPairBudget(input)
  let remaining = 0
  for (const route of routes) { pay(); remaining += Math.max(0, route.points.length - 1) }
  for (let index = 0; index + 1 < routes.length; index++) {
    const route = routes[index]!, segments = Math.max(0, route.points.length - 1)
    remaining -= segments
    // Reserve the shared support-separation visit; the scorer charges the
    // remaining predicates only for pairs not proved disjoint.
    pay(pairBudget * segments * remaining + route.points.length + remaining + routes.length)
    if (scoreMeasuredRouteCrossings(route.points, index, routes, input, pay, pay, undefined, pairBudget, stableGeometry) === undefined) refuse('Final Class routes have an uncertified shared contact')
    // Symmetric finite orthogonal pairs were just checked against every later
    // route. No geometry or source field changes during this local traversal.
    route.style = 'invisible'
  }
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
