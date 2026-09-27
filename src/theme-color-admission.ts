import type { MermaidThemeVariables } from './mermaid-source.ts'
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
// cScale is a fill but also feeds derived color-mix() paints; `none` would
// invalidate those derived paints. Labels likewise require text ink.
const TIMELINE_NO_NONE_KEYS = new Set(
  Array.from({ length: 12 }, (_, index) => [`cScale${index}`, `cScaleLabel${index}`]).flat(),
)

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
      || GITGRAPH_INK_KEYS.has(key) || TIMELINE_NO_NONE_KEYS.has(key)
    if (typeof raw !== 'string' || drawableAuthoredCssPaint(raw, !disallowNone) === undefined) {
      throw new ThemeVariableColorError(key, value, !disallowNone)
    }
  }
}
