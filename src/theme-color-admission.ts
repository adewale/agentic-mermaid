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

/** This first theme layer covers the shared diagram channels and Pie-specific
 * colors. Other families' private theme keys are admitted in later #303 PRs. */
export function checkThemeVariableColors(vars: MermaidThemeVariables | undefined, familyId: string): void {
  if (!vars) return
  const colorKeys = familyId === 'pie'
    ? new Set([...SHARED_COLOR_KEYS, ...PIE_COLOR_KEYS])
    : SHARED_COLOR_KEYS
  for (const key of colorKeys) {
    if (!Object.hasOwn(vars, key)) continue
    const raw = vars[key]
    if (raw === undefined) continue
    const value = typeof raw === 'string' ? raw : JSON.stringify(raw) ?? String(raw)
    const isInk = SHARED_INK_KEYS.has(key) || PIE_INK_KEYS.has(key)
    if (typeof raw !== 'string' || drawableAuthoredCssPaint(raw, !isInk) === undefined) {
      throw new ThemeVariableColorError(key, value, !isInk)
    }
  }
}
