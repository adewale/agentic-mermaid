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

import YAML from 'yaml'
import { detectRegisteredFamilyFromFirstLine, type FamilyId } from './agent/families.ts'
import {
  assertJsonConfigAdmission,
  assertJsonConfigSourceTextAdmission,
  JsonConfigAdmissionError,
} from './shared/json-config-admission.ts'

export type MermaidConfigScalar = string | number | boolean | null
export type MermaidConfigValue = MermaidConfigScalar | MermaidConfigValue[] | MermaidConfigMap

export interface MermaidConfigMap {
  [key: string]: MermaidConfigValue | undefined
}

export type MermaidFrontmatterScalar = MermaidConfigScalar
export type MermaidFrontmatterValue = MermaidConfigValue
export type MermaidFrontmatterList = MermaidFrontmatterValue[]

export interface MermaidFrontmatterMap extends MermaidConfigMap {}

export interface MermaidThemeVariables extends MermaidConfigMap {
  fontFamily?: string
}

export interface TimelineRuntimeConfig extends MermaidConfigMap {
  disableMulticolor?: boolean
  sectionFills?: string[]
  sectionColours?: string[]
}

/** Mermaid stateDiagram config. Faithful ELK/measured-text fields are wired; legacy fields warn. */
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
 * INEFFECTIVE_CONFIG lint (CLASS_NOOP_CONFIG_FIELDS in src/agent/verify.ts).
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
 * (ER_NOOP_CONFIG_FIELDS in src/agent/verify.ts).
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
 * emit INEFFECTIVE_CONFIG (ARCHITECTURE_NOOP_CONFIG_FIELDS in
 * src/architecture/config.ts).
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
 * verify's INEFFECTIVE_CONFIG lint (FLOWCHART_NOOP_CONFIG_FIELDS in
 * src/flowchart-config.ts).
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
 * INEFFECTIVE_CONFIG lint (SEQUENCE_NOOP_CONFIG_FIELDS in
 * src/sequence/config.ts).
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

export interface MermaidSourceAccessibility {
  title?: string
  descr?: string
}

export interface NormalizedMermaidSource {
  /** Original bytes supplied at the public boundary. */
  originalText: string
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

const FRONTMATTER_REGEX = /^\uFEFF?\s*---\s*\r?\n([\s\S]*?)\r?\n\s*---\s*(?:\r?\n|$)/
const INIT_DIRECTIVE_REGEX = /^\s*%%\{\s*(?:init|initialize)\s*:\s*([\s\S]*?)\}\s*%%\s*(?:\r?\n|$)?/gm
const COMMENT_LINE_REGEX = /^\s*%%(?!\{)\s*(.*)$/
const ACC_TITLE_REGEX = /^\s*accTitle(?:\s*:\s*|\s+)(.+)$/i
const ACC_DESCR_INLINE_REGEX = /^\s*accDescr(?:\s*:\s*|\s+)(.+)$/i
const ACC_DESCR_BLOCK_START = /^\s*accDescr\s*:?\s*\{(.*)$/i

interface AccessibilityDescriptionBlock {
  description: string
  endIndex: number
  /** Family statement following the closing brace, with its indentation. */
  suffixLine?: string
}

/** Parse one universal accDescr block without consuming a statement that
 * follows its closing brace. `undefined` means this is not a block opener;
 * `null` means the opener is malformed/unclosed and must remain family-visible. */
function accessibilityDescriptionBlockAt(
  lines: readonly string[],
  startIndex: number,
): AccessibilityDescriptionBlock | null | undefined {
  const opening = lines[startIndex]!.match(ACC_DESCR_BLOCK_START)
  if (!opening) return undefined

  const parts: string[] = []
  for (let index = startIndex; index < lines.length; index++) {
    const content = index === startIndex ? opening[1]! : lines[index]!
    const closing = content.indexOf('}')
    if (closing < 0) {
      if (content.trim()) parts.push(content.trim())
      continue
    }
    const beforeClosing = content.slice(0, closing).trim()
    if (beforeClosing) parts.push(beforeClosing)
    const suffix = content.slice(closing + 1)
    const indent = lines[index]!.match(/^\s*/)?.[0] ?? ''
    return {
      description: parts.join('\n').trim(),
      endIndex: index,
      ...(suffix.trim() ? { suffixLine: indent + suffix.trimStart() } : {}),
    }
  }
  return null
}

export function normalizeMermaidSource(
  text: string,
  baseConfig: MermaidRuntimeConfig = {},
): NormalizedMermaidSource {
  const processed = preprocessMermaidSource(text, runtimeConfigToFrontmatterMap(baseConfig))
  const envelope = sourceEnvelopeMetadata(text)
  const familyBody = withoutUniversalAccessibilityBody(processed.body)
  const familyLines = toMermaidLines(familyBody)

  return {
    originalText: text,
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

function withoutUniversalAccessibilityBody(body: string): string {
  const kept: string[] = []
  const lines = body.split(/\r?\n/)
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index]!
    const block = accessibilityDescriptionBlockAt(lines, index)
    if (block !== undefined) {
      // A malformed universal block must remain visible to the family parser
      // so it can fail or preserve the source. Hiding an unclosed block made a
      // broken Gantt/Journey silently become a valid structured diagram.
      if (block === null) {
        kept.push(...lines.slice(index))
        break
      }
      if (block.suffixLine) kept.push(block.suffixLine)
      index = block.endIndex
      continue
    }
    if (ACC_TITLE_REGEX.test(line) || ACC_DESCR_INLINE_REGEX.test(line)) continue
    kept.push(line)
  }
  return kept.join('\n')
}

/** Normalize authored source once, then apply caller-owned runtime overrides.
 * Source frontmatter/init directives merge with their historical precedence;
 * explicit RenderOptions win at the public render boundary. */
export function normalizeMermaidSourceWithOverrides(
  text: string,
  overrides: MermaidRuntimeConfig = {},
): NormalizedMermaidSource {
  const source = normalizeMermaidSource(text)
  if (Object.keys(overrides).length === 0) return source
  const frontmatter = mergeFrontmatterMaps(source.frontmatter, runtimeConfigToFrontmatterMap(overrides))
  return {
    ...source,
    frontmatter,
    config: normalizeMermaidRuntimeConfig(frontmatter),
  }
}

function sourceEnvelopeMetadata(text: string): {
  wrapperSource?: string
  initDirectives: MermaidSourceInitDirective[]
  comments: MermaidSourceComment[]
  accessibility: MermaidSourceAccessibility
} {
  const frontmatter = text.match(FRONTMATTER_REGEX)
  const frontmatterEnd = frontmatter?.[0].length ?? 0
  const initDirectives: MermaidSourceInitDirective[] = []
  const directiveRegex = new RegExp(INIT_DIRECTIVE_REGEX.source, 'gm')
  let match: RegExpExecArray | null
  const directiveSource = text.slice(frontmatterEnd)
  while ((match = directiveRegex.exec(directiveSource)) !== null) {
    initDirectives.push({
      raw: match[0],
      parsed: canonicalizeFrontmatterMap(parseDirectiveMap((match[1] ?? '').trim()) ?? {}),
    })
  }

  const withoutUniversalConfig = text
    .replace(FRONTMATTER_REGEX, '')
    .replace(new RegExp(INIT_DIRECTIVE_REGEX.source, 'gm'), '')
  const comments: MermaidSourceComment[] = []
  const accessibility: MermaidSourceAccessibility = {}
  const lines = withoutUniversalConfig.split(/\r?\n/)
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index]!
    const block = accessibilityDescriptionBlockAt(lines, index)
    if (block !== undefined) {
      if (block === null) break
      accessibility.descr = block.description
      index = block.endIndex
      continue
    }
    const title = line.match(ACC_TITLE_REGEX)
    if (title) { accessibility.title = title[1]!.trim(); continue }
    const description = line.match(ACC_DESCR_INLINE_REGEX)
    if (description) { accessibility.descr = description[1]!.trim(); continue }
    const comment = line.match(COMMENT_LINE_REGEX)
    if (comment) comments.push({ text: comment[1]!, line: index + 1 })
  }

  let wrapperEnd = frontmatter?.[0].length ?? 0
  const directiveAtStart = new RegExp(INIT_DIRECTIVE_REGEX.source)
  for (;;) {
    const rest = text.slice(wrapperEnd)
    if (rest.length === 0) break
    const directive = rest.match(directiveAtStart)
    if (directive?.index === 0 && directive[0].length > 0) { wrapperEnd += directive[0].length; continue }
    const lineEnd = rest.indexOf('\n')
    const line = lineEnd === -1 ? rest : rest.slice(0, lineEnd)
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
): ProcessedMermaidSource {
  const frontmatterMatch = text.match(FRONTMATTER_REGEX)
  const yamlFrontmatter = frontmatterMatch ? canonicalizeFrontmatterMap(parseYamlDocument(frontmatterMatch[1]!)) : {}
  const rawBody = frontmatterMatch ? text.slice(frontmatterMatch[0].length) : text
  const { body, frontmatter: directiveFrontmatter } = extractInitDirectives(rawBody)
  const frontmatter = mergeFrontmatterMaps(
    mergeFrontmatterMaps(canonicalizeFrontmatterMap(baseFrontmatter), yamlFrontmatter),
    canonicalizeFrontmatterMap(directiveFrontmatter),
  )

  return {
    body,
    lines: toMermaidLines(body),
    frontmatter,
  }
}

export function toMermaidLines(text: string): string[] {
  return text
    .replace(/^\uFEFF/, '')
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(line => line.length > 0 && !line.startsWith('%%'))
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

function parseYamlDocument(text: string): MermaidFrontmatterMap {
  assertJsonConfigSourceTextAdmission(text, 'Mermaid frontmatter')
  try {
    const parsed: unknown = YAML.parse(text)
    assertJsonConfigAdmission(parsed, 'Mermaid frontmatter')
    return toFrontmatterMap(parsed) ?? {}
  } catch (error) {
    if (error instanceof JsonConfigAdmissionError) throw error
    return {}
  }
}

function extractInitDirectives(text: string): { body: string; frontmatter: MermaidFrontmatterMap } {
  let merged: MermaidFrontmatterMap = {}

  const body = text.replace(INIT_DIRECTIVE_REGEX, (_match, payload: string) => {
    const parsed = parseDirectiveMap(payload)
    if (parsed) merged = mergeFrontmatterMaps(merged, canonicalizeFrontmatterMap(parsed))
    return ''
  })

  return { body, frontmatter: merged }
}

function parseDirectiveMap(text: string): MermaidFrontmatterMap | undefined {
  assertJsonConfigSourceTextAdmission(text, 'Mermaid init directive', { trackFlowDepth: true })
  try {
    const parsed: unknown = YAML.parse(text)
    assertJsonConfigAdmission(parsed, 'Mermaid init directive')
    return toFrontmatterMap(parsed)
  } catch (error) {
    if (error instanceof JsonConfigAdmissionError) throw error
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
  return detectRegisteredFamilyFromFirstLine(firstLine, 'strict')
}

/**
 * Looser family recognition for agent parsing: malformed known-family headers
 * should become opaque round-trip bodies instead of UNKNOWN_HEADER errors.
 */
export function detectLooseDiagramTypeFromFirstLine(firstLine: string): FamilyId | null {
  return detectRegisteredFamilyFromFirstLine(firstLine, 'loose')
}

/**
 * Detect the routed Mermaid diagram family from source text. Unknown headers
 * return null and must be classified or diagnosed by the caller; they are
 * never coerced to Flowchart.
 */
export function detectDiagramType(text: string): FamilyId | null {
  return detectDiagramTypeFromFirstLine(preprocessMermaidLines(text)[0] ?? '')
}
