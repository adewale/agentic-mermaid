import type { MermaidFrontmatterMap, MermaidThemeVariables } from './mermaid-source.ts'
import type { RenderOptions } from './types.ts'
import type { ArchitectureVisualConfig } from './architecture/config.ts'
import { CHANNEL_THEME_KEYS } from './color-resolver.ts'
import { drawableAuthoredCssPaint, splitCssColorList } from './shared/css-color.ts'
import { syntaxError } from './shared/syntax-error.ts'

const SHARED_COLOR_KEYS = new Set<string>(Object.values(CHANNEL_THEME_KEYS).flat())
const SHARED_INK_KEYS = new Set([
  'primaryTextColor', 'textColor', 'nodeTextColor',
  'secondaryTextColor', 'tertiaryTextColor',
])
const PIE_COLOR_KEYS = new Set([
  ...Array.from({ length: 12 }, (_, index) => `pie${index + 1}`),
  'pieStrokeColor', 'pieOuterStrokeColor', 'pieSectionTextColor',
  'pieTitleTextColor', 'pieLegendTextColor',
])
const PIE_INK_KEYS = new Set(['pieSectionTextColor', 'pieTitleTextColor', 'pieLegendTextColor'])
const GITGRAPH_COLOR_KEYS = new Set([
  ...Array.from({ length: 8 }, (_, index) => [`git${index}`, `gitBranchLabel${index}`, `gitInv${index}`]).flat(),
  'commitLabelColor', 'commitLabelBackground',
])
const GITGRAPH_INK_KEYS = new Set([
  ...Array.from({ length: 8 }, (_, index) => `gitBranchLabel${index}`),
  'commitLabelColor',
])
const TIMELINE_COLOR_KEYS = new Set(
  Array.from({ length: 12 }, (_, index) => [`cScale${index}`, `cScaleLabel${index}`, `cScaleInv${index}`]).flat(),
)
const RADAR_COLOR_KEYS = new Set([
  ...Array.from({ length: 12 }, (_, index) => `cScale${index}`),
  'titleColor',
])
const ARCHITECTURE_COLOR_KEYS = new Set(['clusterBkg', 'clusterBorder'])
const XYCHART_COLOR_KEYS = [
  'backgroundColor', 'titleColor', 'xAxisLabelColor', 'xAxisTickColor', 'xAxisLineColor',
  'xAxisTitleColor', 'yAxisLabelColor', 'yAxisTickColor', 'yAxisLineColor',
  'yAxisTitleColor', 'legendTextColor',
] as const
const XYCHART_STROKE_KEYS = new Set<string>([
  'xAxisTickColor', 'xAxisLineColor', 'yAxisTickColor', 'yAxisLineColor',
])
// Architecture feeds the selected source key from each shared channel into
// derived color-mix() paints. Shadowed fallbacks do not reach those sinks.
const ARCHITECTURE_MIXED_CHANNELS = [
  ['bg', CHANNEL_THEME_KEYS.bg], ['surface', CHANNEL_THEME_KEYS.surface],
  ['line', CHANNEL_THEME_KEYS.line], ['accent', CHANNEL_THEME_KEYS.accent],
] as const
// Timeline mixes both cScale fills and cScaleInv lines into derived
// color-mix() paints; `none` invalidates those colors. Labels require ink.

/** A named failure at the shared request waist, before any output can silently
 * drop a configured color or paint a browser/resvg-specific fallback. */
export class ThemeVariableColorError extends Error {
  readonly code = 'INVALID_THEME_COLOR' as const
  readonly key: string
  readonly value: string

  constructor(key: string, value: string, allowNone: boolean) {
    const reportedValue = value.length > 256 ? `${value.slice(0, 256)}…` : value
    super(syntaxError({
      what: `themeVariables.${key}: ${JSON.stringify(reportedValue)} is not a CSS color`,
      expectedForm: `a color name, #RGB, #RGBA, #RRGGBB, #RRGGBBAA, rgb(), rgba(), hsl(), hsla(), transparent, currentColor${allowNone ? ', none' : ''}, or var(--name)`,
      example: `themeVariables.${key}:#f96`,
    }).message)
    this.name = 'ThemeVariableColorError'
    this.key = key
    this.value = reportedValue
  }
}

/** A direct render color may be a valid SVG paint but an invalid operand for
 * Architecture's derived color-mix() paints. Refuse it before any output. */
export class RenderOptionColorError extends Error {
  readonly code = 'INVALID_RENDER_COLOR' as const
  readonly field: string
  readonly value: string

  constructor(field: string, value: string) {
    const reportedValue = value.length > 256 ? `${value.slice(0, 256)}…` : value
    super(syntaxError({
      what: `render option "${field}": ${JSON.stringify(reportedValue)} is not a CSS color for Architecture derived paint`,
      expectedForm: 'a drawable CSS color or var(--name)',
      example: `${field}:#f96`,
    }).message)
    this.name = 'RenderOptionColorError'
    this.field = field
    this.value = reportedValue
  }
}

/** `none` is safe as a direct fill/stroke but cannot be mixed into Architecture
 * backgrounds, surfaces, connectors, or header/junction accent paint. Judge
 * selected values after Architecture has resolved its visual overrides: an
 * explicit edge stroke shadows both line and accent fallback channels. */
export function checkArchitectureRenderOptionColors(
  options: RenderOptions | undefined,
  familyId: string,
  visual?: Readonly<ArchitectureVisualConfig>,
): void {
  if (familyId !== 'architecture' || !options) return
  const edgeStroke = visual?.edgeStroke
  if (typeof edgeStroke === 'string' && edgeStroke.trim().toLowerCase() === 'none') {
    throw new RenderOptionColorError('architecture.visual.edgeStroke', edgeStroke)
  }
  for (const field of ['bg', 'surface', 'line', 'accent'] as const) {
    const value = options[field]
    if (typeof value !== 'string' || value.trim().toLowerCase() !== 'none') continue
    if (field === 'surface' && visual?.groupSurface?.trim().toLowerCase() !== 'none') continue
    if (field === 'surface' && visual?.groupHeaderSurface) continue
    if ((field === 'line' || field === 'accent') && edgeStroke) continue
    throw new RenderOptionColorError(field, value)
  }
  const groupSurface = visual?.groupSurface
  if (!visual?.groupHeaderSurface && typeof groupSurface === 'string' && groupSurface.trim().toLowerCase() === 'none') {
    throw new RenderOptionColorError('architecture.visual.groupSurface', groupSurface)
  }
}

/** A family config paint rejected before the normalizer can silently filter
 * malformed array entries or a renderer can emit a non-color into CSS. */
export class FamilyConfigColorError extends Error {
  readonly code = 'INVALID_CONFIG_COLOR' as const
  readonly path: string
  readonly value: string

  constructor(path: string, value: unknown, allowNone: boolean, expectedArray = false) {
    const serialized = typeof value === 'string' ? value : JSON.stringify(value) ?? String(value)
    const reportedValue = serialized.length > 256 ? `${serialized.slice(0, 256)}…` : serialized
    super(syntaxError({
      what: `${path}: ${JSON.stringify(reportedValue)} is not ${expectedArray ? 'an array of CSS colors' : 'a CSS color'}`,
      expectedForm: expectedArray
        ? 'an array of drawable CSS colors'
        : `a color name, #RGB, #RGBA, #RRGGBB, #RRGGBBAA, rgb(), rgba(), hsl(), hsla(), transparent, currentColor${allowNone ? ', none' : ''}, or var(--name)`,
      example: `${path}${expectedArray ? ': ["#f96"]' : ': #f96'}`,
    }).message)
    this.name = 'FamilyConfigColorError'
    this.path = path
    this.value = reportedValue
  }
}

function configMap(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown> : undefined
}

function selectedThemeColorKey(vars: MermaidThemeVariables, keys: readonly string[]): string | undefined {
  return keys.find(key => {
    const value = vars[key]
    return typeof value === 'string' && value.length > 0
  })
}

function checkConfigColor(config: Record<string, unknown>, path: string, key: string, allowNone: boolean): void {
  const value = config[key]
  if (value === undefined) return
  if (typeof value !== 'string' || drawableAuthoredCssPaint(value, allowNone) === undefined) {
    throw new FamilyConfigColorError(`${path}.${key}`, value, allowNone)
  }
}

function checkConfigColorList(config: Record<string, unknown>, path: string, key: string, allowNone: boolean): void {
  const value = config[key]
  if (value === undefined) return
  if (!Array.isArray(value)) throw new FamilyConfigColorError(`${path}.${key}`, value, allowNone, true)
  for (let index = 0; index < value.length; index++) {
    const color = value[index]
    if (typeof color !== 'string' || drawableAuthoredCssPaint(color, allowNone) === undefined) {
      throw new FamilyConfigColorError(`${path}.${key}[${index}]`, color, allowNone)
    }
  }
}

/** Check the raw merged frontmatter rather than normalized arrays: the latter
 * historically discard non-string entries, losing the authored value. */
export function checkFamilyConfigColors(frontmatter: MermaidFrontmatterMap, familyId: string): void {
  if (familyId === 'timeline') {
    const config = configMap(frontmatter.timeline)
    if (!config) return
    checkConfigColorList(config, 'timeline', 'sectionFills', false)
    checkConfigColorList(config, 'timeline', 'sectionColours', false)
    // The American spelling is a fallback only when the canonical list is
    // empty; do not reject an alias the renderer never selects.
    if (config.sectionColours === undefined || (Array.isArray(config.sectionColours) && config.sectionColours.length === 0)) {
      checkConfigColorList(config, 'timeline', 'sectionColors', false)
    }
  } else if (familyId === 'journey') {
    const config = configMap(frontmatter.journey)
    if (!config) return
    checkConfigColorList(config, 'journey', 'actorColours', true)
    checkConfigColorList(config, 'journey', 'sectionFills', false)
    checkConfigColorList(config, 'journey', 'sectionColours', false)
    checkConfigColor(config, 'journey', 'titleColor', false)
  }
}

/** Admit only the keys that a family actually paints. Other families' private
 * theme keys are added in separately reviewed #303 slices. */
export function checkThemeVariableColors(
  vars: MermaidThemeVariables | undefined,
  familyId: string,
  renderOptions?: Pick<RenderOptions, 'bg' | 'surface' | 'line' | 'accent'>,
  architectureVisual?: Readonly<ArchitectureVisualConfig>,
): void {
  if (!vars) return
  const privateColorKeys = familyId === 'pie' ? PIE_COLOR_KEYS
    : familyId === 'gitgraph' ? GITGRAPH_COLOR_KEYS
    : familyId === 'timeline' ? TIMELINE_COLOR_KEYS
    : familyId === 'radar' ? RADAR_COLOR_KEYS
    : familyId === 'architecture' ? ARCHITECTURE_COLOR_KEYS
    : undefined
  const colorKeys = privateColorKeys ? new Set([...SHARED_COLOR_KEYS, ...privateColorKeys]) : SHARED_COLOR_KEYS
  const architectureMixedKeys = familyId === 'architecture'
    ? new Set(ARCHITECTURE_MIXED_CHANNELS.flatMap(([channel, keys]) => {
      if (renderOptions?.[channel] !== undefined) return []
      if (channel === 'surface' && architectureVisual && (
        architectureVisual?.groupHeaderSurface
        || architectureVisual?.groupSurface?.trim().toLowerCase() !== 'none'
      )) return []
      if ((channel === 'line' || channel === 'accent') && architectureVisual?.edgeStroke) return []
      return selectedThemeColorKey(vars, keys) ?? []
    }))
    : undefined
  for (const key of colorKeys) {
    if (!Object.hasOwn(vars, key)) continue
    const raw = vars[key]
    if (raw === undefined) continue
    const value = typeof raw === 'string' ? raw : JSON.stringify(raw) ?? String(raw)
    const disallowNone = SHARED_INK_KEYS.has(key) || PIE_INK_KEYS.has(key)
      || GITGRAPH_INK_KEYS.has(key) || (familyId === 'timeline' && TIMELINE_COLOR_KEYS.has(key))
      || (familyId === 'radar' && RADAR_COLOR_KEYS.has(key))
      || (familyId === 'architecture' && (
        (key === 'clusterBkg' && (!architectureVisual || (
          !architectureVisual.groupHeaderSurface
          && architectureVisual.groupSurface?.trim().toLowerCase() === 'none'
        )))
        || architectureMixedKeys?.has(key)
      ))
    if (typeof raw !== 'string' || drawableAuthoredCssPaint(raw, !disallowNone) === undefined) {
      throw new ThemeVariableColorError(key, value, !disallowNone)
    }
  }
  if (familyId === 'radar') {
    const radar = configMap(vars.radar)
    if (!radar) return
    for (const key of ['axisColor', 'graticuleColor'] as const) {
      const raw = radar[key]
      if (raw === undefined) continue
      const allowNone = key === 'graticuleColor'
      const value = typeof raw === 'string' ? raw : JSON.stringify(raw) ?? String(raw)
      if (typeof raw !== 'string' || drawableAuthoredCssPaint(raw, allowNone) === undefined) {
        throw new ThemeVariableColorError(`radar.${key}`, value, allowNone)
      }
    }
  }
  if (familyId === 'xychart') {
    const chart = configMap(vars.xyChart)
    if (!chart) return
    for (const key of XYCHART_COLOR_KEYS) {
      // The family hook selects an explicit render background ahead of the
      // chart's theme fallback; the shadowed value never reaches a paint sink.
      if (key === 'backgroundColor' && renderOptions?.bg !== undefined) continue
      const raw = chart[key]
      if (raw === undefined) continue
      const allowNone = XYCHART_STROKE_KEYS.has(key)
      const value = typeof raw === 'string' ? raw : JSON.stringify(raw) ?? String(raw)
      if (typeof raw !== 'string' || drawableAuthoredCssPaint(raw, allowNone) === undefined) {
        throw new ThemeVariableColorError(`xyChart.${key}`, value, allowNone)
      }
    }
    const palette = chart.plotColorPalette
    if (palette !== undefined) {
      const entries = typeof palette === 'string' ? splitCssColorList(palette) : palette
      if (!Array.isArray(entries)) {
        throw new ThemeVariableColorError('xyChart.plotColorPalette', JSON.stringify(palette) ?? String(palette), false)
      }
      for (const [index, raw] of entries.entries()) {
        const value = typeof raw === 'string' ? raw.trim() : JSON.stringify(raw) ?? String(raw)
        if (typeof raw !== 'string' || drawableAuthoredCssPaint(value) === undefined) {
          throw new ThemeVariableColorError(`xyChart.plotColorPalette[${index}]`, value, false)
        }
      }
    }
  }
  if (familyId === 'architecture' && (typeof vars.mainBkg !== 'string' || vars.mainBkg.length === 0)) {
    const raw = vars.secondaryColor
    if (raw !== undefined) {
      const value = typeof raw === 'string' ? raw : JSON.stringify(raw) ?? String(raw)
      if (typeof raw !== 'string' || drawableAuthoredCssPaint(raw, true) === undefined) {
        throw new ThemeVariableColorError('secondaryColor', value, true)
      }
    }
  }
}
