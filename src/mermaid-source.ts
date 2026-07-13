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

export interface NormalizedMermaidSource {
  text: string
  body: string
  lines: string[]
  firstLine: string
  config: MermaidRuntimeConfig
  frontmatter: MermaidFrontmatterMap
}

const FRONTMATTER_REGEX = /^\uFEFF?\s*---\s*\r?\n([\s\S]*?)\r?\n\s*---\s*(?:\r?\n|$)/
const INIT_DIRECTIVE_REGEX = /^\s*%%\{\s*(?:init|initialize)\s*:\s*([\s\S]*?)\}\s*%%\s*(?:\r?\n|$)?/gm

export function normalizeMermaidSource(
  text: string,
  baseConfig: MermaidRuntimeConfig = {},
): NormalizedMermaidSource {
  const processed = preprocessMermaidSource(text, runtimeConfigToFrontmatterMap(baseConfig))

  return {
    text: processed.lines.join('\n'),
    body: processed.body,
    lines: processed.lines,
    firstLine: processed.lines[0]?.toLowerCase() ?? '',
    config: normalizeMermaidRuntimeConfig(processed.frontmatter),
    frontmatter: processed.frontmatter,
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
  const merged = cloneFrontmatterMap(base)

  for (const [key, value] of Object.entries(override)) {
    if (value === undefined) continue

    const existing = merged[key]
    if (isFrontmatterMap(existing) && isFrontmatterMap(value)) {
      merged[key] = mergeFrontmatterMaps(existing, value)
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
  const topLevel = cloneFrontmatterMap(raw)
  const configRoot = isFrontmatterMap(topLevel.config) ? topLevel.config : undefined
  delete topLevel.config

  return configRoot ? mergeFrontmatterMaps(configRoot, topLevel) : topLevel
}

function parseYamlDocument(text: string): MermaidFrontmatterMap {
  try {
    return toFrontmatterMap(YAML.parse(text)) ?? {}
  } catch {
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
  try {
    return toFrontmatterMap(YAML.parse(text))
  } catch {
    return parseLooseObjectLiteral(text)
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

export type RoutedDiagramType = 'flowchart' | 'state' | 'architecture' | 'sequence' | 'class' | 'er' | 'timeline' | 'journey' | 'xychart' | 'pie' | 'quadrant' | 'gantt' | 'mindmap' | 'gitgraph'

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
export function detectDiagramTypeFromFirstLine(firstLine: string): RoutedDiagramType | null {
  const line = firstLine.split(';')[0]?.trim().toLowerCase() ?? ''
  if (/^architecture(?:-beta)?\s*$/.test(line)) return 'architecture'
  if (/^mindmap\s*$/.test(line)) return 'mindmap'
  if (/^gitgraph(?:\s+(?:lr|tb|bt))?\s*:?\s*$/.test(line)) return 'gitgraph'
  if (/^xychart(-beta)?\b/.test(line)) return 'xychart'
  if (/^pie\b/.test(line)) return 'pie'
  if (/^quadrant(?:chart)?\s*$/.test(line)) return 'quadrant'
  // Upstream accepts (and ignores) a direction token after the header.
  if (/^timeline(?:\s+(?:td|tb|lr|bt|rl))?\s*$/.test(line)) return 'timeline'
  if (/^gantt\s*$/.test(line)) return 'gantt'
  if (/^journey\s*$/.test(line)) return 'journey'
  if (/^sequencediagram\s*$/.test(line)) return 'sequence'
  if (/^classdiagram\s*$/.test(line)) return 'class'
  // Upstream's parser tolerates a flowchart-style subgraph clause riding the
  // erDiagram header (repo #103); the ER parser ignores the grouping.
  if (/^erdiagram(\s+subgraph\b.*)?\s*$/.test(line)) return 'er'
  if (/^statediagram(?:-v2)?\s*$/.test(line)) return 'state'
  if (/^(?:flowchart|graph|swimlane)\b/.test(line)) return 'flowchart'
  return null
}

/**
 * Looser family recognition for agent parsing: malformed known-family headers
 * should become opaque round-trip bodies instead of UNKNOWN_HEADER errors.
 */
export function detectLooseDiagramTypeFromFirstLine(firstLine: string): RoutedDiagramType | null {
  const line = firstLine.split(';')[0]?.trim().toLowerCase() ?? ''
  if (/^architecture(?:-beta)?\b/.test(line)) return 'architecture'
  if (/^mindmap\b/.test(line)) return 'mindmap'
  if (/^gitgraph\b/.test(line)) return 'gitgraph'
  if (/^xychart(-beta)?\b/.test(line)) return 'xychart'
  if (/^pie\b/.test(line)) return 'pie'
  if (/^quadrant(?:chart)?\b/.test(line)) return 'quadrant'
  if (/^timeline\b/.test(line)) return 'timeline'
  if (/^gantt\b/.test(line)) return 'gantt'
  if (/^journey\b/.test(line)) return 'journey'
  if (/^sequencediagram\b/.test(line)) return 'sequence'
  if (/^classdiagram\b/.test(line)) return 'class'
  if (/^erdiagram\b/.test(line)) return 'er'
  if (/^statediagram(?:-v2)?\b/.test(line)) return 'state'
  if (/^(?:flowchart|graph|swimlane)\b/.test(line)) return 'flowchart'
  return null
}

/**
 * Detect the routed Mermaid diagram family from source text. Unknown headers
 * intentionally route to the legacy flowchart path for backwards compatibility.
 */
export function detectDiagramType(text: string): RoutedDiagramType {
  return detectDiagramTypeFromFirstLine(preprocessMermaidLines(text)[0] ?? '') ?? 'flowchart'
}
