import type { MermaidGraph, RenderOptions } from './types.ts'
import type { DiagramColors } from './theme.ts'
import { DEFAULTS, THEMES } from './theme.ts'
import type { MermaidRuntimeConfig, MermaidThemeVariables } from './mermaid-source.ts'

const ZINC_DARK = THEMES['zinc-dark'] ?? { bg: '#18181B', fg: '#FAFAFA' }

const MERMAID_THEME_COLORS: Record<string, DiagramColors> = {
  default: { bg: DEFAULTS.bg, fg: DEFAULTS.fg },
  base: { bg: DEFAULTS.bg, fg: DEFAULTS.fg },
  neutral: { bg: '#ffffff', fg: '#1f2937', line: '#9ca3af', accent: '#6b7280', muted: '#6b7280' },
  dark: {
    bg: ZINC_DARK.bg,
    fg: ZINC_DARK.fg,
    line: ZINC_DARK.line,
    accent: ZINC_DARK.accent,
    muted: ZINC_DARK.muted,
    surface: ZINC_DARK.surface,
    border: ZINC_DARK.border,
  },
  forest: { bg: '#f0fdf4', fg: '#14532d', line: '#4d7c0f', accent: '#15803d', muted: '#65a30d', border: '#86efac' },
}

/**
 * The internal color waist: every public color dialect is normalized to
 * DiagramColors before layout/render code sees it.
 */
export function resolveDiagramColors(
  options: RenderOptions,
  config: MermaidRuntimeConfig,
  font?: string,
): DiagramColors {
  const theme = resolveThemeColors(config.theme)
  const vars = config.themeVariables

  return {
    bg: options.bg ?? readThemeValue(vars, 'background', 'mainBkg') ?? theme?.bg ?? DEFAULTS.bg,
    fg: options.fg ?? readThemeValue(vars, 'primaryTextColor', 'textColor', 'nodeTextColor') ?? theme?.fg ?? DEFAULTS.fg,
    line: options.line ?? readThemeValue(vars, 'lineColor', 'defaultLinkColor') ?? theme?.line,
    accent: options.accent ?? readThemeValue(vars, 'arrowheadColor', 'primaryColor') ?? theme?.accent,
    muted: options.muted ?? readThemeValue(vars, 'secondaryTextColor', 'tertiaryTextColor') ?? theme?.muted,
    surface: options.surface ?? readThemeValue(vars, 'primaryColor', 'nodeBkg', 'mainBkg') ?? theme?.surface,
    border: options.border ?? readThemeValue(vars, 'primaryBorderColor', 'secondaryBorderColor') ?? theme?.border,
    shadow: options.shadow ?? theme?.shadow,
    font,
    embedFontImport: options.embedFontImport,
  }
}

export function resolveThemeColors(themeName: string | undefined): DiagramColors | undefined {
  if (!themeName) return undefined
  if (themeName in THEMES) return THEMES[themeName as keyof typeof THEMES]
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
  const match = hex.match(/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/)
  if (!match) return null
  const raw = match[1]!
  const full = raw.length === 3
    ? raw.split('').map(ch => ch + ch).join('')
    : raw
  return {
    r: Number.parseInt(full.slice(0, 2), 16),
    g: Number.parseInt(full.slice(2, 4), 16),
    b: Number.parseInt(full.slice(4, 6), 16),
  }
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
  const brightness = (rgb.r * 299 + rgb.g * 587 + rgb.b * 114) / 1000
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
