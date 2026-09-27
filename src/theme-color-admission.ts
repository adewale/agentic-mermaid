import type { MermaidFrontmatterMap, MermaidThemeVariables } from './mermaid-source.ts'
import { CHANNEL_THEME_KEYS } from './color-resolver.ts'
import { drawableAuthoredCssPaint } from './shared/css-color.ts'
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
    checkConfigColorList(config, 'timeline', 'sectionColors', false)
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
export function checkThemeVariableColors(vars: MermaidThemeVariables | undefined, familyId: string): void {
  if (!vars) return
  const privateColorKeys = familyId === 'pie' ? PIE_COLOR_KEYS
    : familyId === 'gitgraph' ? GITGRAPH_COLOR_KEYS
    : familyId === 'timeline' ? TIMELINE_COLOR_KEYS
    : undefined
  const colorKeys = privateColorKeys ? new Set([...SHARED_COLOR_KEYS, ...privateColorKeys]) : SHARED_COLOR_KEYS
  for (const key of colorKeys) {
    if (!Object.hasOwn(vars, key)) continue
    const raw = vars[key]
    if (raw === undefined) continue
    const value = typeof raw === 'string' ? raw : JSON.stringify(raw) ?? String(raw)
    const disallowNone = SHARED_INK_KEYS.has(key) || PIE_INK_KEYS.has(key)
      || GITGRAPH_INK_KEYS.has(key) || (familyId === 'timeline' && TIMELINE_COLOR_KEYS.has(key))
    if (typeof raw !== 'string' || drawableAuthoredCssPaint(raw, !disallowNone) === undefined) {
      throw new ThemeVariableColorError(key, value, !disallowNone)
    }
  }
}
