import { isMermaidConfigDirective } from './shared/pinned-mermaid-config/directive-types.ts'
import { decodeXML } from 'entities'
// ============================================================================
// Mermaid source normalization + config extraction
//
// Handles:
//   - UTF-8 BOM stripping
//   - leading YAML frontmatter
//   - Mermaid directives / init blocks (%%{init: ...}%%)
//   - Mermaid comment stripping for downstream line-based parsers
//   - normalized, trimmed diagram lines for downstream parsers
// ============================================================================

import { mergeConfigSource, configDirective } from './shared/pinned-mermaid-config/merge.js'
import { pinnedMermaidDiagramType } from './shared/pinned-mermaid-diagram-type.ts'
import { scanStateComments } from './state/comment.ts'
import { readAuthoredGrammarAccessibility, readGrammarAccessibility } from './shared/grammar-text.ts'
import { DeferredDependencyError } from './layout/certification-error.ts'
import { detectInstalledFamilyDescriptorFromFirstLine, detectInstalledFamilyFromFirstLine, installedFamilyStatementEnds, type RegisteredFamilyResolver } from './agent/family-router.ts'
import type { FamilyDescriptor } from './agent/families.ts'
import type { FamilyId } from './agent/types.ts'
import {
  assertJsonConfigAdmission,
  assertJsonConfigSourceTextAdmission,
  JsonConfigAdmissionError,
} from './shared/json-config-admission.ts'
import {
  maskMermaidConfigForGrammar,
  nativeAccessibilityTransportEdits,
  parseAccessibilityDirective,
  scanAccessibilityDirectives,
  statementEndAt,
  type MermaidAccessibility,
} from './shared/accessibility-directives.ts'
import { splitSequenceStatementLines } from './sequence/statements.ts'
import { parseDirectiveYaml, parseMermaidYaml } from './shared/mermaid-yaml.ts'
import { syntaxError } from './shared/syntax-error.ts'
import { authoredMermaidSlice, cleanedMermaidOffset, cleanupMermaidSource, originalMermaidOffset, type MermaidCleanup, type MermaidCleanupBias } from './shared/mermaid-cleanup.ts'
import { matchMermaidFrontmatter, mermaidFirstLine, INIT_DIRECTIVE_REGEX, stripMermaidDirectives, splitHeaderStatement, toMermaidLines } from './mermaid-source-wrapper.ts'

export { toMermaidLines }

export type MermaidConfigScalar = string | number | boolean | null
export type MermaidConfigValue = MermaidConfigScalar | MermaidConfigValue[] | MermaidConfigMap

export interface MermaidConfigMap {
  [key: string]: MermaidConfigValue | undefined
}

export type MermaidFrontmatterScalar = MermaidConfigScalar
export type MermaidFrontmatterValue = MermaidConfigValue
export type MermaidFrontmatterList = MermaidFrontmatterValue[]

export interface MermaidFrontmatterMap extends MermaidConfigMap {}

/** A frontmatter `title:` is the diagram's title, as in Mermaid, which reads
 * the frontmatter before the body: a `title` statement in the body wins. */
export function withFrontmatterTitle<T extends { title?: string }>(diagram: T, frontmatter: MermaidFrontmatterMap): T {
  const title = frontmatterTitle(frontmatter)
  return diagram.title !== undefined || title === undefined ? diagram : { ...diagram, title }
}

/** The frontmatter `title:`, when it names one. */
export function frontmatterTitle(frontmatter: MermaidFrontmatterMap | undefined): string | undefined {
  const title = frontmatter?.title
  return typeof title === 'string' && title.trim() !== '' ? title : undefined
}

export interface MermaidThemeVariables extends MermaidConfigMap {
  fontFamily?: string
}

export interface TimelineRuntimeConfig extends MermaidConfigMap {
  disableMulticolor?: boolean
  sectionFills?: string[]
  sectionColours?: string[]
}

/** Mermaid stateDiagram config. Faithful ELK/measured-text fields are wired; unsupported fields warn. */
export interface StateRuntimeConfig extends MermaidConfigMap {
  titleTopMargin?: number
  arrowMarkerAbsolute?: boolean
  dividerMargin?: number
  sizeUnit?: number
  padding?: number
  textHeight?: number
  titleShift?: number
  noteMargin?: number
  nodeSpacing?: number
  rankSpacing?: number
  forkWidth?: number
  forkHeight?: number
  miniPadding?: number
  fontSizeFactor?: number
  fontSize?: number
  labelHeight?: number
  edgeLengthFactor?: string
  compositTitleSize?: number
  radius?: number
  defaultRenderer?: 'dagre-d3' | 'dagre-wrapper' | 'elk'
  layout?: string
  look?: string
  minNodeWidth?: number
  theme?: string
  wrappingWidth?: number
}

export interface XyChartRuntimeConfig extends MermaidConfigMap {
  width?: number
  height?: number
  useMaxWidth?: boolean
  useWidth?: number
  titleFontSize?: number
  titlePadding?: number
  chartOrientation?: 'vertical' | 'horizontal'
  plotReservedSpacePercent?: number
  showDataLabel?: boolean
  showDataLabelOutsideBar?: boolean
  showTitle?: boolean
  showLegend?: boolean
  legendFontSize?: number
  legendPadding?: number
  xAxis?: MermaidConfigMap
  yAxis?: MermaidConfigMap
}

export interface PieRuntimeConfig extends MermaidConfigMap {
  textPosition?: number
  donutHole?: number
  legendPosition?: 'top' | 'bottom' | 'left' | 'right' | 'center'
  highlightSlice?: string
  useMaxWidth?: boolean
  useWidth?: number
}

export interface SankeyRuntimeConfig extends MermaidConfigMap {
  width?: number
  height?: number
  linkColor?: 'source' | 'target' | 'gradient' | string
  nodeAlignment?: 'justify' | 'center' | 'left' | 'right'
  showValues?: boolean
  prefix?: string
  suffix?: string
  labelStyle?: 'legacy' | 'outlined'
  nodeWidth?: number
  nodePadding?: number
  nodeColors?: Record<string, string>
  useMaxWidth?: boolean
}

export interface RadarRuntimeConfig extends MermaidConfigMap {
  width?: number
  height?: number
  marginTop?: number
  marginRight?: number
  marginBottom?: number
  marginLeft?: number
  axisScaleFactor?: number
  axisLabelFactor?: number
  curveTension?: number
  useMaxWidth?: boolean
  useWidth?: number
  /** Agentic extension: draw the ring value labels (default off). */
  tickLabels?: boolean
}

export interface QuadrantRuntimeConfig extends MermaidConfigMap {
  chartWidth?: number
  chartHeight?: number
  titleFontSize?: number
  titlePadding?: number
  quadrantPadding?: number
  quadrantLabelFontSize?: number
  xAxisLabelFontSize?: number
  yAxisLabelFontSize?: number
  xAxisLabelPadding?: number
  yAxisLabelPadding?: number
  pointLabelFontSize?: number
  pointRadius?: number
  pointTextPadding?: number
  quadrantInternalBorderStrokeWidth?: number
  quadrantExternalBorderStrokeWidth?: number
  useMaxWidth?: boolean
  quadrantTextTopPadding?: number
  xAxisPosition?: string
  yAxisPosition?: string
  useWidth?: number
}

export interface JourneyRuntimeConfig extends MermaidConfigMap {
  diagramMarginX?: number
  diagramMarginY?: number
  leftMargin?: number
  maxLabelWidth?: number
  width?: number
  height?: number
  boxMargin?: number
  boxTextMargin?: number
  noteMargin?: number
  messageMargin?: number
  messageAlign?: 'left' | 'center' | 'right'
  bottomMarginAdj?: number
  useMaxWidth?: boolean
  rightAngles?: boolean
  taskFontSize?: string | number
  taskFontFamily?: string
  taskMargin?: number
  activationWidth?: number
  textPlacement?: string
  actorColours?: string[]
  sectionFills?: string[]
  sectionColours?: string[]
  titleColor?: string
  titleFontFamily?: string
  titleFontSize?: string | number
}

export interface GanttRuntimeConfig extends MermaidConfigMap {
  displayMode?: string
  barHeight?: number
  topAxis?: boolean
  tickInterval?: string
  barGap?: number
  topPadding?: number
  leftPadding?: number
  gridLineStartPadding?: number
  fontSize?: number
  sectionFontSize?: number
  numberSectionStyles?: number
  axisFormat?: string
  todayMarker?: string
  weekday?: string
}

/** Wired deterministic mindmap layout fields. */
export interface MindmapRuntimeConfig extends MermaidConfigMap {
  padding?: number
  maxNodeWidth?: number
}

/** Wired GitGraph presentation and replay fields. */
export interface GitGraphRuntimeConfig extends MermaidConfigMap {
  showBranches?: boolean
  showCommitLabel?: boolean
  mainBranchName?: string
  mainBranchOrder?: number
  parallelCommits?: boolean
  rotateCommitLabel?: boolean
}

/**
 * Mermaid's documented classDiagram config shape (wire-or-warn, P4):
 * nodeSpacing/rankSpacing are wired into the ELK layout
 * (src/class/layout.ts resolveClassRenderOptions); every other documented
 * key is accepted for config-shape compatibility and named by verify's
 * INEFFECTIVE_CONFIG lint (the family's config.noopKeys in src/agent/families.ts).
 */
export interface ClassRuntimeConfig extends MermaidConfigMap {
  nodeSpacing?: number
  rankSpacing?: number
  titleTopMargin?: number
  arrowMarkerAbsolute?: boolean
  dividerMargin?: number
  padding?: number
  textHeight?: number
  defaultRenderer?: string
  diagramPadding?: number
  htmlLabels?: boolean
  hideEmptyMembersBox?: boolean
  hierarchicalNamespaces?: boolean
}

/**
 * Mermaid's documented er config shape (wire-or-warn, P4): layoutDirection +
 * nodeSpacing/rankSpacing are wired (src/er/layout.ts
 * applyErFrontmatterConfig); the rest emit INEFFECTIVE_CONFIG
 * (the family's config.noopKeys in src/agent/families.ts).
 */
export interface ErRuntimeConfig extends MermaidConfigMap {
  layoutDirection?: string
  nodeSpacing?: number
  rankSpacing?: number
  titleTopMargin?: number
  diagramPadding?: number
  minEntityWidth?: number
  minEntityHeight?: number
  entityPadding?: number
  stroke?: string
  fill?: string
  fontSize?: number
}

/**
 * Mermaid's documented architecture config shape (wire-or-warn, P4): padding,
 * iconSize, fontSize, nodeSeparation, and idealEdgeLengthMultiplier are wired
 * (src/architecture/config.ts); the fcose simulation knobs — edgeElasticity,
 * numIter, seed, randomize — have no meaning in the deterministic layout and
 * emit INEFFECTIVE_CONFIG (the family's config.noopKeys in
 * src/agent/families.ts).
 */
export interface ArchitectureRuntimeConfig extends MermaidConfigMap {
  padding?: number
  iconSize?: number
  fontSize?: number
  nodeSeparation?: number
  idealEdgeLengthMultiplier?: number
  edgeElasticity?: number
  numIter?: number
  seed?: number
  randomize?: boolean
}

/**
 * Mermaid's documented flowchart config shape (wire-or-warn, P4):
 * nodeSpacing/rankSpacing/wrappingWidth are wired
 * (src/flowchart-config.ts resolveFlowchartRenderOptions); every other
 * documented key is accepted for config-shape compatibility and named by
 * verify's INEFFECTIVE_CONFIG lint (the family's config.noopKeys in
 * src/agent/families.ts).
 */
export interface FlowchartRuntimeConfig extends MermaidConfigMap {
  nodeSpacing?: number
  rankSpacing?: number
  wrappingWidth?: number
  titleTopMargin?: number
  subGraphTitleMargin?: MermaidConfigMap
  arrowMarkerAbsolute?: boolean
  diagramPadding?: number
  htmlLabels?: boolean
  curve?: string
  padding?: number
  defaultRenderer?: string
  inheritDir?: boolean
}

/**
 * Mermaid's documented sequence config shape (wire-or-warn, P4): actorMargin,
 * width, height, diagramMarginX/Y, messageMargin, noteMargin, activationWidth,
 * and showSequenceNumbers are wired (src/sequence/config.ts
 * resolveSequenceConfig → src/sequence/layout.ts); every other documented key
 * is accepted for config-shape compatibility and named by verify's
 * INEFFECTIVE_CONFIG lint (the family's config.noopKeys in
 * src/agent/families.ts).
 */
export interface SequenceRuntimeConfig extends MermaidConfigMap {
  actorMargin?: number
  width?: number
  height?: number
  diagramMarginX?: number
  diagramMarginY?: number
  messageMargin?: number
  noteMargin?: number
  activationWidth?: number
  showSequenceNumbers?: boolean
  boxMargin?: number
  boxTextMargin?: number
  messageAlign?: 'left' | 'center' | 'right'
  mirrorActors?: boolean
  bottomMarginAdj?: number
  rightAngles?: boolean
  wrap?: boolean
  wrapPadding?: number
  labelBoxWidth?: number
  labelBoxHeight?: number
  hideUnusedParticipants?: boolean
  forceMenus?: boolean
  arrowMarkerAbsolute?: boolean
  noteAlign?: 'left' | 'center' | 'right'
  actorFontSize?: string | number
  actorFontFamily?: string
  actorFontWeight?: string | number
  noteFontSize?: string | number
  noteFontFamily?: string
  noteFontWeight?: string | number
  messageFontSize?: string | number
  messageFontFamily?: string
  messageFontWeight?: string | number
}

/** C4 spacing is pixel-space; terminal layout allocates its own cell geometry. */
export interface C4RuntimeConfig extends MermaidConfigMap {
  /** Reflow budget in pixels; minimum legible geometry may exceed it with a diagnostic. */
  maxWidth?: number
  /** Compact independently measured pixel and terminal layouts. */
  compact?: boolean
  /** Automatic semantic type legend; authored legend directives remain independent. */
  typeLegend?: boolean
  diagramMarginX?: number
  diagramMarginY?: number
  c4ShapeMargin?: number
  c4ShapePadding?: number
  width?: number
  height?: number
  boxMargin?: number
  nextLinePaddingX?: number
  c4ShapeInRow?: number
  c4BoundaryInRow?: number
  wrap?: boolean
  wrapPadding?: number
  useMaxWidth?: boolean
}

export interface MermaidRuntimeConfig extends MermaidConfigMap {
  theme?: string
  fontFamily?: string
  themeVariables?: MermaidThemeVariables
  flowchart?: FlowchartRuntimeConfig
  state?: StateRuntimeConfig
  timeline?: TimelineRuntimeConfig
  journey?: JourneyRuntimeConfig
  xyChart?: XyChartRuntimeConfig
  pie?: PieRuntimeConfig
  quadrantChart?: QuadrantRuntimeConfig
  radar?: RadarRuntimeConfig
  sankey?: SankeyRuntimeConfig
  c4?: C4RuntimeConfig
  gantt?: GanttRuntimeConfig
  sequence?: SequenceRuntimeConfig
  class?: ClassRuntimeConfig
  er?: ErRuntimeConfig
  architecture?: ArchitectureRuntimeConfig
  mindmap?: MindmapRuntimeConfig
  gitGraph?: GitGraphRuntimeConfig
  useMaxWidth?: boolean
  useWidth?: number
  themeCSS?: string
}

export interface ProcessedMermaidSource {
  body: string
  lines: string[]
  frontmatter: MermaidFrontmatterMap
}

export interface MermaidSourceInitDirective {
  raw: string
  parsed: MermaidFrontmatterMap
}

export interface MermaidSourceComment {
  text: string
  line: number
}

export interface MermaidSourceAccessibility extends MermaidAccessibility {}

export interface NormalizedMermaidSource {
  /** Original bytes supplied at the public boundary. */
  originalText: string
  /** Shared cleanup receipt, with offsets back to the exact input. */
  cleanup?: MermaidCleanup
  /** Authored grammar view retained when transport decoding changes source. */
  authoredFamilyLines?: string[]
  /** Indentation-preserving grammar view for field-owned XML interpretation. */
  authoredFamilyBody?: string
  authoredHeader?: string
  authoredWrapperLength?: number
  text: string
  body: string
  lines: string[]
  /** Line-preserving body presented to family grammars after universal
   * accessibility directives have been removed. */
  familyBody: string
  /** Trimmed logical family grammar view. */
  familyText: string
  /** Family grammar view with universal accessibility directives removed. */
  familyLines: string[]
  firstLine: string
  config: MermaidRuntimeConfig
  frontmatter: MermaidFrontmatterMap
  /** Lossless universal wrapper before the family header, when present. */
  wrapperSource?: string
  initDirectives: MermaidSourceInitDirective[]
  comments: MermaidSourceComment[]
  accessibility: MermaidSourceAccessibility
}

const COMMENT_LINE_REGEX = /^\s*%%(?!\{)\s*(.*)\r?$/

/**
 * Remove universal init directives while retaining every other authored byte.
 * Canonical serializers use this to fold body-authored config into the shared
 * wrapper without leaving a second semantic owner in opaque or extension
 * source. Keep the grammar here beside normalization so new families inherit
 * the same directive boundary automatically.
 */
export function stripMermaidInitDirectives(text: string): string {
  return withoutMermaidInitDirectives(text)
}

function withoutMermaidInitDirectives(text: string, removed?: (offset: number, length: number) => void): string {
  return removed ? text.replace(INIT_DIRECTIVE_REGEX, (match, _line, _inline, offset: number) => {
    removed(offset, match.length)
    return ''
  }) : text.replace(INIT_DIRECTIVE_REGEX, '')
}

/** The preserved native grammar payload and its exact authored boundaries.
 * Sparse directive deletions compose with the shared cleanup receipt. */
export function preservedMermaidFamilySource(source: Readonly<Pick<NormalizedMermaidSource, 'originalText' | 'wrapperSource' | 'authoredWrapperLength' | 'cleanup'>>, view: 'authored' | 'render' = 'render'): { text: string; sourceOffset: (offset: number, bias?: MermaidCleanupBias) => number; familyOffset: (offset: number, bias?: MermaidCleanupBias) => number } {
  const cleanup = source.cleanup ?? cleanupMermaidSource(source.originalText)
  const wrapperLength = source.wrapperSource?.length ?? 0
  const authoredStart = source.cleanup && source.authoredWrapperLength !== undefined
    ? originalMermaidOffset(cleanup, wrapperLength, 'end', 'text') : wrapperLength
  const selectedView = source.cleanup && view === 'render' ? 'payloadText' : 'authoredPayloadText'
  const start = cleanedMermaidOffset(cleanup, authoredStart, 'end', selectedView)
  const payload = cleanup[selectedView].slice(start)
  let deletions: Array<{ at: number; before: number; after: number }> | undefined
  let removedLength = 0
  const text = withoutMermaidInitDirectives(payload, (offset, length) => {
    const at = offset - removedLength
    const previous = deletions?.at(-1)
    if (previous?.at === at) previous.after = offset + length
    else (deletions ??= []).push({ at, before: offset, after: offset + length })
    removedLength += length
  })
  return { text, sourceOffset: (offset, bias = 'start') => {
    if (!Number.isInteger(offset) || offset < 0 || offset > text.length) throw new RangeError('Family source offset is outside the preserved payload')
    let low = 0, high = deletions?.length ?? 0
    while (low < high) {
      const middle = low + Math.floor((high - low) / 2)
      if (deletions![middle]!.at <= offset) low = middle + 1
      else high = middle
    }
    const deletion = deletions?.[low - 1]
    const payloadOffset = deletion ? offset === deletion.at ? bias === 'start' ? deletion.before : deletion.after : offset + deletion.after - deletion.at : offset
    return originalMermaidOffset(cleanup, start + payloadOffset, bias, selectedView)
  }, familyOffset: (offset, bias = 'start') => {
    const position = cleanedMermaidOffset(cleanup, offset, bias, selectedView) - start
    if (position < 0 || position > payload.length) throw new RangeError('Authored offset is outside the preserved family')
    let low = 0, high = deletions?.length ?? 0
    while (low < high) {
      const middle = low + Math.floor((high - low) / 2)
      if (deletions![middle]!.before <= position) low = middle + 1
      else high = middle
    }
    const deletion = deletions?.[low - 1]
    return deletion ? position <= deletion.after ? deletion.at : position - deletion.after + deletion.at : position
  } }
}

/** Read the shared post-wrapper source without normalizing payload line endings.
 * Rendering uses the once-decoded view; authored parsing keeps entity spelling.
 * The family grammar still owns quoted payloads and accessibility directives. */
export function preservedMermaidFamilyText(source: Readonly<Pick<NormalizedMermaidSource, 'originalText' | 'wrapperSource' | 'authoredWrapperLength' | 'cleanup'>>, view: 'authored' | 'render' = 'render'): string {
  return preservedMermaidFamilySource(source, view).text
}

/**
 * Every universal init directive in `text`, in authored order. Callers that
 * need to know whether some other text already owns a directive must ask this
 * grammar rather than search for the authored bytes: a source-preserving
 * serializer may legitimately re-emit a directive with different indentation
 * or inner spacing, and a byte comparison would then emit it a second time.
 */
export function mermaidInitDirectives(text: string): MermaidSourceInitDirective[] {
  const directives: MermaidSourceInitDirective[] = []
  const regex = new RegExp(INIT_DIRECTIVE_REGEX.source, 'gm')
  let match: RegExpExecArray | null
  while ((match = regex.exec(text)) !== null) {
    if (!isMermaidConfigDirective(match[0])) continue
    directives.push({
      raw: match[0],
      parsed: mermaidInitDirectiveConfig(match[0]) ?? {},
    })
  }
  return directives
}

/** Distinguish a valid empty object from an unparsed directive payload. */
export function mermaidInitDirectiveConfig(raw: string): MermaidFrontmatterMap | undefined {
  const match = new RegExp(INIT_DIRECTIVE_REGEX.source, 'm').exec(raw)
  return match ? (match[1] !== undefined || match[2] !== undefined ? directiveConfig(match[1] ?? match[2]) : /%%\{\s*wrap\s*\}/.test(match[0]) ? { wrap: true } : {}) : undefined
}

/** Raw layer before native flattening. Single scalar/array init payloads
 * are no-ops; arrays can contribute on the multi-init assignment path.
 * Generous object reads remain repairable as canonical JSON. */
export function mermaidInitDirectivePayload(raw: string): MermaidFrontmatterValue | undefined {
  const match = new RegExp(INIT_DIRECTIVE_REGEX.source, 'm').exec(raw)
  if (!match) return undefined
  const payload = match[1] ?? match[2]
  if (payload === undefined) return null
  if (!payload.trim()) return {}
  // The pinned directive lexer captures bare words as strings, before JSON.
  if (/^\w+$/.test(payload.trim())) return payload.trim()
  assertJsonConfigSourceTextAdmission(payload, 'Mermaid init directive', { trackFlowDepth: true })
  try {
    const value: unknown = JSON.parse(payload.replace(/'/g, '"'))
    assertJsonConfigAdmission(value, 'Mermaid init directive')
    return toFrontmatterValue(value)
  } catch (error) {
    if (error instanceof JsonConfigAdmissionError) throw error
    return directiveConfig(payload)
  }
}

export interface MermaidConfigDirectiveLayer {
  kind: string
  hasArgs: boolean
  payload: MermaidFrontmatterValue
}

/** Kind is semantic: a wrap directive does not increase the init count. */
export function mermaidInitDirectiveLayer(raw: string): MermaidConfigDirectiveLayer | undefined {
  const match = new RegExp(INIT_DIRECTIVE_REGEX.source, 'm').exec(raw)
  const payload = mermaidInitDirectivePayload(raw)
  if (!match || payload === undefined) return undefined
  return { kind: /%%\{\s*(\w+)/.exec(match[0])![1]!, hasArgs: match[1] !== undefined || match[2] !== undefined, payload }
}

/** The authored YAML layer alone, without init directives folded into it. */
export function mermaidAuthoredFrontmatter(source: string): MermaidFrontmatterMap {
  const match = matchMermaidFrontmatter(source)
  return match ? parseYamlDocument(match.yaml) : {}
}

/**
 * Whitespace- and formatting-insensitive identity for one init directive.
 * A parseable payload is identified by its raw kind and scope so re-indented or
 * re-spaced re-emissions still match; an unparseable payload has no semantic
 * projection, so it falls back to its collapsed raw text.
 */
export function mermaidInitDirectiveIdentity(directive: MermaidSourceInitDirective): string {
  const layer = mermaidInitDirectiveLayer(directive.raw)
  return layer
    ? `${layer.kind}:${layer.hasArgs}:${stableConfigIdentity(layer.payload)}`
    : `raw:${directive.raw.trim().replace(/\s+/g, ' ')}`
}

/**
 * Deterministic JSON identity for config semantics. Object member order is not
 * meaningful in Mermaid config, so serializers that sort or otherwise reorder
 * keys must still be recognized as owning the same directive. Arrays retain
 * their authored order because that order is semantic.
 */
function stableConfigIdentity(value: MermaidConfigValue): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableConfigIdentity).join(',')}]`
  }
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value)
      .filter((entry): entry is [string, MermaidConfigValue] => entry[1] !== undefined)
      .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
    return `{${entries.map(([key, entry]) => `${JSON.stringify(key)}:${stableConfigIdentity(entry)}`).join(',')}}`
  }
  return JSON.stringify(value)
}

export function normalizeMermaidSource(
  text: string,
  baseConfig: MermaidRuntimeConfig = {},
  view: 'authored' | 'render' = 'authored',
  resolveFamily?: RegisteredFamilyResolver,
): NormalizedMermaidSource {
  // Native JSON before the header owns its encoded line breaks and directive
  // lookalikes. Shield that envelope before discovering a transport-decoded
  // header; family statement scope is applied to the complete source below.
  const discoveryFields = nativeAccessibilityEdits(text, null)
  const initialCleanup = cleanupMermaidSource(text, discoveryFields)
  // Detection is executable extension code. Capture its descriptor once, then
  // retain that same owner through cleanup, config and both grammar views.
  const firstLine = mermaidFirstLine(view === 'render' ? initialCleanup.text : initialCleanup.lineText)
  const family = resolveFamily
    ? resolveFamily(firstLine, 'loose')
    : detectInstalledFamilyDescriptorFromFirstLine(view === 'authored' ? decodeXML(firstLine) : firstLine, 'loose')
  const nativeFields = nativeAccessibilityEdits(text, family)
  const cleanup = discoveryFields.length > 0 || nativeFields.length > 0 ? cleanupMermaidSource(text, nativeFields) : initialCleanup
  return normalizeSource(text, baseConfig, view, cleanup, family)
}

function nativeAccessibilityEdits(text: string, family: FamilyDescriptor | null): Array<{ start: number; end: number; text: string }> {
  if (!text.includes('%% agentic-mermaid ')) return []
  const start = matchMermaidFrontmatter(text)?.source.length ?? 0
  const body = text.slice(start)
  return nativeAccessibilityTransportEdits(body, installedFamilyStatementEnds(decodeXML(mermaidFirstLine(text)), maskMermaidConfigForGrammar(body).split(/\r\n?|\n/), family))
    .map(edit => ({ ...edit, start: start + edit.start, end: start + edit.end }))
}

function normalizeSource(
  text: string,
  baseConfig: MermaidRuntimeConfig,
  view: 'authored' | 'render',
  cleanup: MermaidCleanup,
  family: FamilyDescriptor | null,
): NormalizedMermaidSource {
  const semanticText = view === 'render' ? cleanup.text : cleanup.lineText
  const processed = preprocessMermaidSource(semanticText, runtimeConfigToFrontmatterMap(baseConfig), family)
  const physicalLines = processed.body.split(/\r?\n/)
  const sequence = /^sequenceDiagram\b/i.test(processed.lines[0] ?? '')
  const accessibilityLines = sequence && /;\s*acc(?:Title|Descr)\b/i.test(processed.body)
    ? splitSequenceStatementLines(physicalLines)
    : physicalLines
  // A line inside a statement's quoted text is the family's, whatever it holds.
  const accessibilityScan = scanAccessibilityDirectives(
    accessibilityLines,
    installedFamilyStatementEnds(decodeXML(processed.lines[0] ?? ''), accessibilityLines, family),
    // Ordinary fields already passed global XML cleanup; native JSON fields
    // own their transport references and decode them only after classification.
    view === 'render' ? directive => (directive.form === 'native' ? readAuthoredGrammarAccessibility : readGrammarAccessibility)({ title: directive.value }).title! : undefined,
  )
  const envelope = sourceEnvelopeMetadata(semanticText, accessibilityScan.accessibility, family)
  const sharesAuthoredGrammar = semanticText === cleanup.lineText
  if (sharesAuthoredGrammar && semanticText !== text) {
    if (envelope.wrapperSource !== undefined) {
      envelope.wrapperSource = text.slice(0, originalMermaidOffset(cleanup, envelope.wrapperSource.length, 'end', 'lineText'))
    }
    const frontmatterEnd = matchMermaidFrontmatter(semanticText)?.source.length ?? (semanticText.startsWith('\uFEFF') ? 1 : 0)
    const matches = [...semanticText.slice(frontmatterEnd).matchAll(new RegExp(INIT_DIRECTIVE_REGEX.source, 'gm'))].filter(match => isMermaidConfigDirective(match[0])).values()
    for (const directive of envelope.initDirectives) {
      const start = frontmatterEnd + matches.next().value!.index
      const end = start + directive.raw.length
      directive.raw = authoredMermaidSlice(cleanup, start, end, 'lineText')
    }
  }
  const familyBody = accessibilityScan.familyLines.join('\n')
  const state = /^stateDiagram(?:-v2)?(?=$|[\s;%])/i.test(processed.lines[0] ?? '')
  const timeline = /^timeline(?=$|[\s;#%])/i.test(processed.lines[0] ?? '')
  const familyLines = state
    ? scanStateComments(accessibilityScan.familyLines).filter(line => line.noteBody || line.text.length > 0).map(line => line.text)
    : timeline
      // Timeline's SECTION token consumes two spaces for an explicit empty
      // heading. Trimming line ends first changes that token into a period.
      ? accessibilityScan.familyLines.map(line => line.trimStart()).filter(line => line.trim().length > 0 && !COMMENT_LINE_REGEX.test(line))
      : toMermaidLines(familyBody)
  const authored = sharesAuthoredGrammar ? undefined : normalizeSource(text, baseConfig, 'authored', cleanup, family)

  return {
    originalText: text,
    cleanup,
    ...(authored ? {
      authoredFamilyLines: authored.familyLines,
      authoredFamilyBody: authored.familyBody,
      authoredHeader: authored.lines[0] ?? '',
      authoredWrapperLength: authored.wrapperSource?.length ?? 0,
    } : {}),
    text: processed.lines.join('\n'),
    body: processed.body,
    lines: processed.lines,
    familyBody,
    familyText: familyLines.join('\n'),
    familyLines,
    firstLine: processed.lines[0]?.toLowerCase() ?? '',
    config: normalizeMermaidRuntimeConfig(processed.frontmatter),
    frontmatter: processed.frontmatter,
    ...(envelope.wrapperSource !== undefined ? { wrapperSource: envelope.wrapperSource } : {}),
    initDirectives: envelope.initDirectives,
    comments: envelope.comments,
    accessibility: envelope.accessibility,
  }
}

/** Normalize authored source once, then apply caller-owned runtime overrides.
 * Source frontmatter/init directives merge with their historical precedence;
 * explicit RenderOptions win at the public render boundary. */
export function normalizeMermaidSourceWithOverrides(
  text: string,
  overrides: MermaidRuntimeConfig = {},
  view: 'authored' | 'render' = 'authored',
  resolveFamily?: RegisteredFamilyResolver,
): NormalizedMermaidSource {
  const source = normalizeMermaidSource(text, {}, view, resolveFamily)
  if (Object.keys(overrides).length === 0) return source
  const frontmatter = mergeFrontmatterMaps(source.frontmatter, runtimeConfigToFrontmatterMap(overrides))
  return {
    ...source,
    frontmatter,
    config: normalizeMermaidRuntimeConfig(frontmatter),
  }
}

/** Semantic input for render admission and hosts that load its family first.
 * Decode transport spelling once while retaining original bytes for receipts. */
export function normalizeMermaidRenderSource(text: string, overrides?: MermaidRuntimeConfig, resolveFamily?: RegisteredFamilyResolver): NormalizedMermaidSource {
  return normalizeMermaidSourceWithOverrides(text, overrides, 'render', resolveFamily)
}

function sourceEnvelopeMetadata(text: string, accessibility: MermaidSourceAccessibility, family: FamilyDescriptor | null): {
  wrapperSource?: string
  initDirectives: MermaidSourceInitDirective[]
  comments: MermaidSourceComment[]
  accessibility: MermaidSourceAccessibility
} {
  const frontmatter = matchMermaidFrontmatter(text)
  // A standalone UTF-8 BOM is universal envelope syntax too. Treat it as an
  // exact one-byte wrapper even without frontmatter so family-owned source
  // starts at the header and source-map ownership agrees with serialization.
  const frontmatterEnd = frontmatter?.source.length ?? (text.startsWith('\uFEFF') ? 1 : 0)
  const initDirectives = mermaidInitDirectives(text.slice(frontmatterEnd))

  // Mask universal config instead of deleting it so comment locations remain
  // physical line numbers in the authored source, including after frontmatter
  // and multiline init directives.
  const maskExceptNewlines = (value: string): string => value.replace(/[^\r\n]/g, ' ')
  const withoutUniversalConfig = (frontmatter ? maskExceptNewlines(frontmatter.source) + text.slice(frontmatter.source.length) : text)
    .replace(new RegExp(INIT_DIRECTIVE_REGEX.source, 'gm'), maskExceptNewlines)
  const comments: MermaidSourceComment[] = []
  const lines = withoutUniversalConfig.split(/\r?\n/)
  const firstStatement = lines.find(line => line.trim().length > 0 && !COMMENT_LINE_REGEX.test(line))?.trim() ?? ''
  const stateComments = /^stateDiagram(?:-v2)?(?=$|[\s;%])/i.test(firstStatement)
  const sequenceComments = /^sequenceDiagram\b/i.test(firstStatement)
  const stateLines = stateComments ? scanStateComments(lines) : undefined
  const recordPackedSequenceComment = (source: string, physicalLine: number): void => {
    if (!sequenceComments) return
    const comment = splitSequenceStatementLines([source])
      .find(statement => statement.trimStart().startsWith('%%'))
    if (comment) comments.push({ text: comment.trimStart().slice(2).trim(), line: physicalLine })
  }
  const statementEnds = installedFamilyStatementEnds(decodeXML(firstStatement), lines, family)
  let statementEnd = -1
  for (let index = 0; index < lines.length; index++) {
    const accessibility = index > statementEnd ? parseAccessibilityDirective(lines, index) : null
    if (accessibility === undefined) break
    if (accessibility !== null) {
      if (accessibility.suffixLine) recordPackedSequenceComment(accessibility.suffixLine, accessibility.endIndex + 1)
      index = accessibility.endIndex
      continue
    }
    if (index > statementEnd) statementEnd = statementEndAt(statementEnds, index, lines.length)
    const line = lines[index]!
    const stateLine = stateLines?.[index]
    if (stateLine) {
      if (stateLine.commentIndex >= 0) comments.push({ text: line.slice(stateLine.commentIndex + 2).trim(), line: index + 1 })
      continue
    }
    const comment = line.match(COMMENT_LINE_REGEX)
    if (comment) comments.push({ text: comment[1]!, line: index + 1 })
    else if (sequenceComments) recordPackedSequenceComment(line, index + 1)
  }

  let wrapperEnd = frontmatterEnd
  const directiveAtStart = new RegExp(INIT_DIRECTIVE_REGEX.source)
  for (;;) {
    const rest = text.slice(wrapperEnd)
    if (rest.length === 0) break
    const directive = rest.match(directiveAtStart)
    if (directive?.index === 0 && directive[0].length > 0) { wrapperEnd += directive[0].length; continue }
    const lineEnd = rest.indexOf('\n')
    const line = lineEnd === -1 ? rest : rest.slice(0, lineEnd)
    // Native accessibility comments are mutable envelope fields, not immutable
    // wrapper trivia. Keep them outside the verbatim prefix.
    if (parseAccessibilityDirective([line], 0)?.form === 'native') break
    // COMMENT_LINE_REGEX accepts a CR terminator while this span retains it.
    if (/^\s*$/.test(line) || COMMENT_LINE_REGEX.test(line)) {
      wrapperEnd += lineEnd === -1 ? rest.length : lineEnd + 1
      continue
    }
    break
  }

  return {
    ...(wrapperEnd > 0 ? { wrapperSource: text.slice(0, wrapperEnd) } : {}),
    initDirectives,
    comments,
    accessibility,
  }
}

export function preprocessMermaidSource(
  text: string,
  baseFrontmatter: MermaidFrontmatterMap = {},
  family: FamilyDescriptor | null = detectInstalledFamilyDescriptorFromFirstLine(decodeXML(mermaidFirstLine(text)), 'loose'),
): ProcessedMermaidSource {
  const protectedFields = nativeAccessibilityEdits(text, family)
  for (const edit of protectedFields.toReversed()) text = text.slice(0, edit.start) + edit.text + text.slice(edit.end)
  const frontmatterMatch = matchMermaidFrontmatter(text)
  const yamlFrontmatter = frontmatterMatch ? canonicalizeFrontmatterMap(parseYamlDocument(frontmatterMatch.yaml)) : {}
  const rawBody = frontmatterMatch ? text.slice(frontmatterMatch.source.length) : text
  const extracted = extractInitDirectives(rawBody, mergeFrontmatterMaps(canonicalizeFrontmatterMap(baseFrontmatter), yamlFrontmatter), family)
  const body = splitHeaderStatement(extracted.body)
  const frontmatter = extracted.frontmatter

  return {
    body,
    lines: toMermaidLines(body),
    frontmatter,
  }
}


export function mergeMermaidConfigs(...configs: MermaidRuntimeConfig[]): MermaidRuntimeConfig {
  const merged: MermaidFrontmatterMap = {}

  for (const config of configs) {
    mergeInto(merged, runtimeConfigToFrontmatterMap(config))
  }

  return normalizeMermaidRuntimeConfig(merged)
}

export function mergeFrontmatterMaps(
  base: MermaidFrontmatterMap,
  override: MermaidFrontmatterMap,
): MermaidFrontmatterMap {
  return mergeFrontmatterMapsUnchecked(base, override)
}

function mergeFrontmatterMapsUnchecked(
  base: MermaidFrontmatterMap,
  override: MermaidFrontmatterMap,
): MermaidFrontmatterMap {
  const merged = cloneFrontmatterMap(base)

  for (const [key, value] of Object.entries(override)) {
    if (value === undefined) continue

    const existing = merged[key]
    if (isFrontmatterMap(existing) && isFrontmatterMap(value)) {
      merged[key] = mergeFrontmatterMapsUnchecked(existing, value)
      continue
    }

    merged[key] = cloneFrontmatterValue(value)
  }

  return merged
}

export function getFrontmatterMap(
  root: MermaidFrontmatterMap,
  path: readonly string[],
): MermaidFrontmatterMap | undefined {
  let current: MermaidFrontmatterValue | undefined = root
  for (const segment of path) {
    if (!isFrontmatterMap(current)) return undefined
    current = current[segment]
  }
  return isFrontmatterMap(current) ? current : undefined
}

export function getFrontmatterScalar<T extends MermaidFrontmatterScalar>(
  root: MermaidFrontmatterMap,
  path: readonly string[],
): T | undefined {
  let current: MermaidFrontmatterValue | undefined = root
  for (const segment of path) {
    if (!isFrontmatterMap(current)) return undefined
    current = current[segment]
  }
  return current !== undefined && !Array.isArray(current) && (typeof current !== 'object' || current === null)
    ? current as T
    : undefined
}

export function getFrontmatterList<T extends MermaidFrontmatterValue = MermaidFrontmatterValue>(
  root: MermaidFrontmatterMap,
  path: readonly string[],
): T[] | undefined {
  let current: MermaidFrontmatterValue | undefined = root
  for (const segment of path) {
    if (!isFrontmatterMap(current)) return undefined
    current = current[segment]
  }
  return Array.isArray(current) ? current as T[] : undefined
}

function runtimeConfigToFrontmatterMap(config: MermaidRuntimeConfig): MermaidFrontmatterMap {
  assertJsonConfigAdmission(config, 'Mermaid runtime configuration')
  return canonicalizeFrontmatterMap(toFrontmatterMap(config) ?? {})
}

function normalizeMermaidRuntimeConfig(raw: MermaidFrontmatterMap): MermaidRuntimeConfig {
  const config = cloneFrontmatterMap(raw) as MermaidRuntimeConfig

  if (isFrontmatterMap(config.themeVariables)) {
    config.themeVariables = cloneFrontmatterMap(config.themeVariables) as MermaidThemeVariables
  }

  if (isFrontmatterMap(config.timeline)) {
    config.timeline = normalizeTimelineRuntimeConfig(config.timeline)
  }

  if (isFrontmatterMap(config.journey)) {
    config.journey = normalizeJourneyRuntimeConfig(config.journey)
  }

  return config
}

function normalizeTimelineRuntimeConfig(raw: MermaidFrontmatterMap): TimelineRuntimeConfig {
  const config = cloneFrontmatterMap(raw) as TimelineRuntimeConfig

  if (typeof config.disableMulticolor !== 'boolean') {
    delete config.disableMulticolor
  }

  const sectionFills = normalizeStringArray(config.sectionFills)
  if (sectionFills.length > 0) {
    config.sectionFills = sectionFills
  } else {
    delete config.sectionFills
  }

  const sectionColours = normalizeStringArray(config.sectionColours)
  const sectionColors = normalizeStringArray((config as MermaidFrontmatterMap).sectionColors)
  if (sectionColours.length > 0) {
    config.sectionColours = sectionColours
  } else if (sectionColors.length > 0) {
    config.sectionColours = sectionColors
  } else {
    delete config.sectionColours
  }

  delete (config as MermaidFrontmatterMap).sectionColors
  return config
}

function normalizeJourneyRuntimeConfig(raw: MermaidFrontmatterMap): JourneyRuntimeConfig {
  const config = cloneFrontmatterMap(raw) as JourneyRuntimeConfig

  for (const key of [
    'diagramMarginX', 'diagramMarginY', 'leftMargin', 'maxLabelWidth',
    'width', 'height', 'boxMargin', 'boxTextMargin', 'noteMargin',
    'messageMargin', 'bottomMarginAdj', 'taskMargin', 'activationWidth',
  ] as const) {
    const value = config[key]
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
      delete config[key]
    }
  }

  if (typeof config.useMaxWidth !== 'boolean') delete config.useMaxWidth
  if (typeof config.rightAngles !== 'boolean') delete config.rightAngles

  if (config.messageAlign !== 'left' && config.messageAlign !== 'center' && config.messageAlign !== 'right') {
    delete config.messageAlign
  }

  const taskFontSize = normalizeCssFontSize(config.taskFontSize)
  if (taskFontSize !== undefined) config.taskFontSize = taskFontSize
  else delete config.taskFontSize

  for (const key of ['taskFontFamily', 'textPlacement', 'titleColor', 'titleFontFamily'] as const) {
    if (typeof config[key] !== 'string' || config[key]!.trim().length === 0) delete config[key]
  }

  const titleFontSize = normalizeCssFontSize(config.titleFontSize)
  if (titleFontSize !== undefined) config.titleFontSize = titleFontSize
  else delete config.titleFontSize

  for (const key of ['actorColours', 'sectionFills', 'sectionColours'] as const) {
    const colors = normalizeStringArray(config[key])
    if (colors.length > 0) config[key] = colors
    else delete config[key]
  }

  return config
}

function normalizeCssFontSize(value: MermaidConfigValue | undefined): string | number | undefined {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) return value
  if (typeof value === 'string' && value.trim().length > 0) return value.trim()
  return undefined
}

function normalizeStringArray(value: MermaidConfigValue | undefined): string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : []
}

function mergeInto(target: MermaidFrontmatterMap, source: MermaidFrontmatterMap | undefined): void {
  if (!source) return

  for (const [key, value] of Object.entries(source)) {
    if (value === undefined) continue

    if (Array.isArray(value)) {
      target[key] = value.map(entry => cloneFrontmatterValue(entry)!)
      continue
    }

    if (isFrontmatterMap(value)) {
      const existing = isFrontmatterMap(target[key]) ? target[key] as MermaidFrontmatterMap : {}
      target[key] = existing
      mergeInto(existing, value)
      continue
    }

    target[key] = value
  }
}

function canonicalizeFrontmatterMap(raw: MermaidFrontmatterMap): MermaidFrontmatterMap {
  assertJsonConfigAdmission(raw, 'Mermaid configuration')
  const topLevel = cloneFrontmatterMap(raw)
  const configRoot = isFrontmatterMap(topLevel.config) ? topLevel.config : undefined
  delete topLevel.config

  return configRoot ? mergeFrontmatterMaps(configRoot, topLevel) : topLevel
}

/** Frontmatter that is not valid YAML, which rejects the diagram, as upstream. */
export class MermaidFrontmatterError extends Error {}

/** Frontmatter is read as upstream reads it (shared/metadata-yaml.ts): YAML
 * that does not parse rejects the diagram; a document that parses but is not
 * a mapping (a scalar, a list, nothing) is empty metadata. */
function parseYamlDocument(text: string): MermaidFrontmatterMap {
  assertJsonConfigSourceTextAdmission(text, 'Mermaid frontmatter')
  const parsed = parseMermaidYaml(text)
  if (!parsed.ok) {
    throw new MermaidFrontmatterError(syntaxError({
      what: `Mermaid frontmatter is not valid YAML: ${parsed.message}`,
      expectedForm: 'a YAML mapping between the two `---` lines',
      example: '---\ntitle: "Order flow: v2"\n---',
    }).message)
  }
  assertJsonConfigAdmission(parsed.value, 'Mermaid frontmatter')
  return toFrontmatterMap(parsed.value) ?? {}
}

function extractInitDirectives(text: string, base: MermaidFrontmatterMap, family: FamilyDescriptor | null): { body: string; frontmatter: MermaidFrontmatterMap } {
  const layers = mermaidInitDirectives(text).flatMap(directive => {
    const layer = mermaidInitDirectiveLayer(directive.raw)
    return layer ? [layer] : []
  })
  const body = stripMermaidDirectives(text)
  const header = toMermaidLines(body)[0]?.split(/\s/)[0] ?? ''
  const detected = pinnedMermaidDiagramType(family?.id ?? header)
  // The base is already a fresh, admitted canonical map. An empty merge has
  // no directive state to process or configuration to clone.
  if (layers.length === 0 && Object.keys(base).length === 0) return { body, frontmatter: base }
  const inits = layers.filter(layer => /(?:init\b)|(?:initialize\b)/.test(layer.kind)).map(layer => layer.payload)
  const wrap = layers.some(layer => layer.kind === 'wrap')
  try {
    return { body, frontmatter: mergeConfigSource(base, layers.map(layer => configDirective(layer.kind, layer.payload, layer.hasArgs)).join('\n'), detected, true) as MermaidFrontmatterMap }
  } catch {
    // Invalid consumed values still need a generous read for repair. Canonical
    // admission reports the actual failure separately. Do not activate a legacy
    // config block that the multi-init sanitizer would discard before remapping.
    let merged = mergeFrontmatterMaps({}, base)
    for (const init of inits) {
      if (!init || typeof init !== 'object' || Array.isArray(init)) continue
      const layer = mergeFrontmatterMaps({}, init)
      if (layer.config !== undefined) {
        if (inits.length === 1) layer[detected === 'flowchart-v2' ? 'flowchart' : detected] = layer.config
        delete layer.config
      }
      merged = mergeFrontmatterMaps(merged, layer)
    }
    if (wrap) merged.wrap = true
    return { body, frontmatter: merged }
  }
}

/** The configuration an init directive's payload sets, or a wrap
 *  directive's (which has none): `wrap: true`, as Mermaid applies it. */
function directiveConfig(payload: string | undefined): MermaidFrontmatterMap | undefined {
  return payload === undefined ? { wrap: true } : payload.trim() === '' ? {} : parseDirectiveMap(payload.trim())
}

function parseDirectiveMap(text: string): MermaidFrontmatterMap | undefined {
  assertJsonConfigSourceTextAdmission(text, 'Mermaid init directive', { trackFlowDepth: true })
  try {
    const parsed = parseDirectiveYaml(text)
    assertJsonConfigAdmission(parsed, 'Mermaid init directive')
    return toFrontmatterMap(parsed)
  } catch (error) {
    if (error instanceof JsonConfigAdmissionError || error instanceof DeferredDependencyError) throw error
    const parsed = parseLooseObjectLiteral(text)
    if (parsed !== undefined) assertJsonConfigAdmission(parsed, 'Mermaid init directive')
    return parsed
  }
}

function toFrontmatterMap(value: unknown): MermaidFrontmatterMap | undefined {
  if (!isPlainObject(value)) return undefined

  const map: MermaidFrontmatterMap = {}
  for (const [key, entry] of Object.entries(value)) {
    const parsed = toFrontmatterValue(entry)
    if (parsed !== undefined) map[key] = parsed
  }
  return map
}

function toFrontmatterValue(value: unknown): MermaidFrontmatterValue | undefined {
  if (value === null) return null
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return value

  if (Array.isArray(value)) {
    const items: MermaidFrontmatterList = []
    for (const entry of value) {
      const parsed = toFrontmatterValue(entry)
      if (parsed === undefined) return undefined
      items.push(parsed)
    }
    return items
  }

  return toFrontmatterMap(value)
}

function cloneFrontmatterMap(value: MermaidFrontmatterMap): MermaidFrontmatterMap {
  const clone: MermaidFrontmatterMap = {}
  for (const [key, entry] of Object.entries(value)) {
    clone[key] = cloneFrontmatterValue(entry)
  }
  return clone
}

function cloneFrontmatterValue(value: MermaidFrontmatterValue | undefined): MermaidFrontmatterValue | undefined {
  if (value === undefined || value === null) return value
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return value
  if (Array.isArray(value)) return value.map(entry => cloneFrontmatterValue(entry)!)
  return cloneFrontmatterMap(value)
}

function isFrontmatterMap(value: MermaidFrontmatterValue | undefined): value is MermaidFrontmatterMap {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function parseScalar(valueText: string): MermaidFrontmatterScalar {
  if ((valueText.startsWith('"') && valueText.endsWith('"')) || (valueText.startsWith("'") && valueText.endsWith("'"))) {
    return unescapeQuotedString(valueText)
  }
  if (valueText === 'true') return true
  if (valueText === 'false') return false
  if (valueText === 'null') return null
  if (/^[+-]?(?:\d+(?:\.\d+)?|\.\d+)$/.test(valueText)) return Number(valueText)
  return valueText
}

function parseLooseObjectLiteral(text: string): MermaidFrontmatterMap | undefined {
  const parsed = parseFlowValue(text.trim())
  return isFrontmatterMap(parsed) ? parsed : undefined
}

function parseFlowValue(text: string): MermaidFrontmatterValue | undefined {
  const trimmed = text.trim()
  if (trimmed.length === 0) return undefined

  if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
    return parseFlowMap(trimmed.slice(1, -1))
  }
  if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
    return parseFlowList(trimmed.slice(1, -1))
  }

  return parseScalar(trimmed)
}

function parseFlowMap(text: string): MermaidFrontmatterMap | undefined {
  const map: MermaidFrontmatterMap = {}
  for (const entry of splitFlowEntries(text)) {
    const colonIdx = findSeparatorIndex(entry, ':')
    if (colonIdx === -1) return undefined

    const rawKey = entry.slice(0, colonIdx).trim()
    const rawValue = entry.slice(colonIdx + 1).trim()
    const key = parseFlowKey(rawKey)
    if (!key) return undefined

    const value = parseFlowValue(rawValue)
    if (value === undefined) return undefined
    map[key] = value
  }
  return map
}

function parseFlowList(text: string): MermaidFrontmatterList | undefined {
  const values: MermaidFrontmatterList = []
  for (const entry of splitFlowEntries(text)) {
    const value = parseFlowValue(entry)
    if (value === undefined) return undefined
    values.push(value)
  }
  return values
}

function parseFlowKey(text: string): string | undefined {
  const trimmed = text.trim()
  if (!trimmed) return undefined
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    return unescapeQuotedString(trimmed)
  }
  return trimmed
}

function splitFlowEntries(text: string): string[] {
  const entries: string[] = []
  let current = ''
  let quote: '"' | "'" | null = null
  let braceDepth = 0
  let bracketDepth = 0

  for (let i = 0; i < text.length; i++) {
    const char = text[i]!
    if (quote) {
      current += char
      if (char === quote && text[i - 1] !== '\\') quote = null
      continue
    }

    if (char === '"' || char === "'") {
      quote = char
      current += char
      continue
    }
    if (char === '{') {
      braceDepth++
      current += char
      continue
    }
    if (char === '}') {
      braceDepth--
      current += char
      continue
    }
    if (char === '[') {
      bracketDepth++
      current += char
      continue
    }
    if (char === ']') {
      bracketDepth--
      current += char
      continue
    }
    if (char === ',' && braceDepth === 0 && bracketDepth === 0) {
      const value = current.trim()
      if (value) entries.push(value)
      current = ''
      continue
    }

    current += char
  }

  const trailing = current.trim()
  if (trailing) entries.push(trailing)
  return entries
}

function findSeparatorIndex(text: string, separator: ':' | ','): number {
  let quote: '"' | "'" | null = null
  let braceDepth = 0
  let bracketDepth = 0

  for (let i = 0; i < text.length; i++) {
    const char = text[i]!
    if (quote) {
      if (char === quote && text[i - 1] !== '\\') quote = null
      continue
    }
    if (char === '"' || char === "'") {
      quote = char
      continue
    }
    if (char === '{') {
      braceDepth++
      continue
    }
    if (char === '}') {
      braceDepth--
      continue
    }
    if (char === '[') {
      bracketDepth++
      continue
    }
    if (char === ']') {
      bracketDepth--
      continue
    }
    if (char === separator && braceDepth === 0 && bracketDepth === 0) return i
  }

  return -1
}

function unescapeQuotedString(valueText: string): string {
  try {
    if (valueText.startsWith("'")) {
      return valueText
        .slice(1, -1)
        .replace(/\\\\/g, '\\')
        .replace(/\\'/g, "'")
    }
    return JSON.parse(valueText)
  } catch {
    return valueText.slice(1, -1)
  }
}

/** Compatibility alias: routing now accepts installed, namespaced families too. */
/**
 * Return the logical Mermaid lines after frontmatter/init/comment normalization.
 * This is a thin wrapper around the richer source preprocessing used by the
 * public SVG and ASCII entry points.
 */
export function preprocessMermaidLines(text: string): string[] {
  return preprocessMermaidSource(text).lines
}

/**
 * Detect the routed Mermaid diagram family from a normalized first logical line.
 * Returns null for headers that are known not to be routed by this renderer.
 */
export function detectDiagramTypeFromFirstLine(firstLine: string): FamilyId | null {
  return detectInstalledFamilyFromFirstLine(firstLine, 'strict')
}

/**
 * Looser family recognition for agent parsing: malformed known-family headers
 * should become opaque round-trip bodies instead of UNKNOWN_HEADER errors.
 */
export function detectLooseDiagramTypeFromFirstLine(firstLine: string): FamilyId | null {
  return detectInstalledFamilyFromFirstLine(firstLine, 'loose')
}

/**
 * Detect the routed Mermaid diagram family from source text. Unknown headers
 * return null and must be classified or diagnosed by the caller; they are
 * never coerced to Flowchart.
 */
export function detectDiagramType(text: string): FamilyId | null {
  const family = detectInstalledFamilyDescriptorFromFirstLine(mermaidFirstLine(text), 'strict')
  preprocessMermaidSource(text, {}, family)
  return family?.id ?? null
}
