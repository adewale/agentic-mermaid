import type { MermaidGraph, RenderOptions } from './types.ts'
import { tryParseHex, luma255 } from './shared/color-math.ts'
import type { DiagramColors } from './theme.ts'
import { DEFAULTS } from './theme.ts'
import type { MermaidRuntimeConfig, MermaidThemeVariables } from './mermaid-source.ts'
import { safeCssPaint } from './shared/css-color.ts'

const MERMAID_THEME_COLORS: Record<string, DiagramColors> = {
  default: { bg: DEFAULTS.bg, fg: DEFAULTS.fg },
  base: { bg: DEFAULTS.bg, fg: DEFAULTS.fg },
  neutral: { bg: '#ffffff', fg: '#1f2937', line: '#9ca3af', accent: '#6b7280', muted: '#6b7280' },
  dark: {
    bg: '#18181B',
    fg: '#FAFAFA',
  },
  forest: { bg: '#f0fdf4', fg: '#14532d', line: '#4d7c0f', accent: '#15803d', muted: '#65a30d', border: '#86efac' },
}

/** Mermaid themeVariables keys read per DiagramColors channel — the single
 *  source of truth shared by resolveDiagramColors and the aesthetic-defaults
 *  composition in index.ts (user theming must beat style palettes). */
export const CHANNEL_THEME_KEYS = {
  bg: ['background', 'mainBkg'],
  fg: ['primaryTextColor', 'textColor', 'nodeTextColor'],
  line: ['lineColor', 'defaultLinkColor'],
  accent: ['arrowheadColor', 'primaryColor'],
  muted: ['secondaryTextColor', 'tertiaryTextColor'],
  surface: ['primaryColor', 'nodeBkg', 'mainBkg'],
  border: ['primaryBorderColor', 'secondaryBorderColor'],
} as const

/**
 * The internal color waist: every public color dialect is normalized to
 * DiagramColors before layout/render code sees it.
 */
export function resolveDiagramColors(
  options: RenderOptions,
  config: MermaidRuntimeConfig,
  font?: string,
  preserveUnsafeThemePaints = false,
): DiagramColors {
  const theme = resolveThemeColors(config.theme)
  const vars = config.themeVariables
  const themePaint = (...keys: string[]) => {
    const value = readThemeValue(vars, ...keys)
    return preserveUnsafeThemePaints ? value : safeCssPaint(value)
  }

  return {
    bg: options.bg ?? themePaint(...CHANNEL_THEME_KEYS.bg) ?? theme?.bg ?? DEFAULTS.bg,
    fg: options.fg ?? themePaint(...CHANNEL_THEME_KEYS.fg) ?? theme?.fg ?? DEFAULTS.fg,
    line: options.line ?? themePaint(...CHANNEL_THEME_KEYS.line) ?? theme?.line,
    accent: options.accent ?? themePaint(...CHANNEL_THEME_KEYS.accent) ?? theme?.accent,
    muted: options.muted ?? themePaint(...CHANNEL_THEME_KEYS.muted) ?? theme?.muted,
    surface: options.surface ?? themePaint(...CHANNEL_THEME_KEYS.surface) ?? theme?.surface,
    border: options.border ?? themePaint(...CHANNEL_THEME_KEYS.border) ?? theme?.border,
    shadow: options.shadow ?? theme?.shadow,
    font,
    embedFontImport: options.embedFontImport,
  }
}

export function resolveThemeColors(themeName: string | undefined): DiagramColors | undefined {
  if (!themeName) return undefined
  return MERMAID_THEME_COLORS[themeName.toLowerCase()]
}

export function readThemeValue(vars: MermaidThemeVariables | undefined, ...keys: string[]): string | undefined {
  if (!vars) return undefined

  for (const key of keys) {
    const value = vars[key]
    if (typeof value === 'string' && value.length > 0) return value
  }

  return undefined
}

/**
 * Resolve inline node styles from Mermaid classDef/class/style directives.
 * Class styles are applied first; explicit style directives override them.
 */
export function resolveNodeInlineStyle(
  nodeId: string,
  graph: MermaidGraph,
): Record<string, string> | undefined {
  let result: Record<string, string> | undefined

  const className = graph.classAssignments.get(nodeId)
  if (className) {
    const classDef = graph.classDefs.get(className)
    if (classDef) result = { ...classDef }
  }

  const nodeStyle = graph.nodeStyles.get(nodeId)
  if (nodeStyle) result = result ? { ...result, ...nodeStyle } : { ...nodeStyle }

  return result
}

/**
 * Resolve inline edge styles from Mermaid linkStyle directives. Default link
 * style is applied first; edge-index-specific style overrides it.
 */
export function resolveEdgeInlineStyle(
  edgeIndex: number,
  graph: MermaidGraph,
): Record<string, string> | undefined {
  let result: Record<string, string> | undefined

  const defaultStyle = graph.linkStyles.get('default')
  if (defaultStyle) result = { ...defaultStyle }

  const indexStyle = graph.linkStyles.get(edgeIndex)
  if (indexStyle) result = result ? { ...result, ...indexStyle } : { ...indexStyle }

  return result
}

function parseHexToRgb(hex: string): { r: number; g: number; b: number } | null {
  const rgb = tryParseHex(hex)
  return rgb ? { r: rgb[0], g: rgb[1], b: rgb[2] } : null
}

function parseRgbFunction(color: string): { r: number; g: number; b: number } | null {
  const match = color.match(/^rgba?\(\s*(\d{1,3})(?:\s*,\s*|\s+)(\d{1,3})(?:\s*,\s*|\s+)(\d{1,3})/i)
  if (!match) return null
  const rgb = {
    r: Number.parseInt(match[1]!, 10),
    g: Number.parseInt(match[2]!, 10),
    b: Number.parseInt(match[3]!, 10),
  }
  return Object.values(rgb).every(v => v >= 0 && v <= 255) ? rgb : null
}

export function contrastTextColor(fill: string): string | undefined {
  const rgb = parseHexToRgb(fill) ?? parseRgbFunction(fill)
  if (!rgb) return undefined
  const brightness = luma255(rgb.r, rgb.g, rgb.b)
  return brightness > 140 ? '#000000' : '#FFFFFF'
}

export function resolveInlineNodeTextColor(
  inlineStyle: Record<string, string> | undefined,
  fallback: string = 'var(--_text)',
): string {
  if (inlineStyle?.color) return inlineStyle.color
  if (inlineStyle?.fill) return contrastTextColor(inlineStyle.fill) ?? fallback
  return fallback
}
