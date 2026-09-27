import type { MermaidGraph, RenderOptions } from './types.ts'
import { compositeCssColor, legibleInk, relativeLuminance, toHex, tryParseHex, WCAG_AA_NON_TEXT_CONTRAST, WCAG_AA_TEXT_CONTRAST } from './shared/color-math.ts'
import type { DiagramColors } from './theme.ts'
import { DEFAULTS, resolvedColorValue } from './theme.ts'
import type { MermaidRuntimeConfig, MermaidThemeVariables } from './mermaid-source.ts'
import { safeCssPaint } from './shared/css-color.ts'
import { checkedAuthoredStyle } from './shared/style-props.ts'

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
    const classDef = checkedAuthoredStyle(graph.classDefs.get(className), `classDef ${className}`)
    if (classDef) result = { ...classDef }
  }

  const nodeStyle = checkedAuthoredStyle(graph.nodeStyles.get(nodeId), `style ${nodeId}`)
  if (nodeStyle) result = result ? { ...result, ...nodeStyle } : { ...nodeStyle }

  return result
}

/**
 * Resolve inline edge styles from an authored edge-ID class and linkStyle
 * directives. Link styles retain their existing default/index precedence.
 */
export function resolveEdgeInlineStyle(
  edgeIndex: number,
  graph: MermaidGraph,
): Record<string, string> | undefined {
  let result: Record<string, string> | undefined

  const edgeId = graph.edges[edgeIndex]?.id
  const className = edgeId ? graph.classAssignments.get(edgeId) : undefined
  const classDef = className ? checkedAuthoredStyle(graph.classDefs.get(className), `classDef ${className}`) : undefined
  if (classDef) result = { ...classDef }

  const defaultStyle = checkedAuthoredStyle(graph.linkStyles.get('default'), 'linkStyle default')
  if (defaultStyle) result = result ? { ...result, ...defaultStyle } : { ...defaultStyle }

  const indexStyle = checkedAuthoredStyle(graph.linkStyles.get(edgeIndex), `linkStyle ${edgeIndex}`)
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

/** Ink for text drawn on an opaque fill: whichever of black and white has the
 * higher WCAG contrast. The better of the two is at least 4.58:1 against any
 * opaque color, so text on a data mark always clears WCAG AA; a brightness
 * threshold picks the weaker ink for mid-tone fills. */
export function contrastTextColor(fill: string): string | undefined {
  const rgb = parseHexToRgb(fill) ?? parseRgbFunction(fill)
  if (!rgb) return undefined
  const luminance = relativeLuminance(`rgb(${rgb.r}, ${rgb.g}, ${rgb.b})`)!
  return (luminance + 0.05) / 0.05 >= 1.05 / (luminance + 0.05) ? '#000000' : '#FFFFFF'
}

export function resolveInlineNodeTextColor(
  inlineStyle: Record<string, string> | undefined,
  fallback: string = 'var(--_text)',
): string {
  if (inlineStyle?.color) return inlineStyle.color
  if (inlineStyle?.fill) return contrastTextColor(inlineStyle.fill) ?? fallback
  return fallback
}

/** The theme's own text tones: the only paints toneOnFill moves. */
const THEME_TEXT_TONES: ReadonlySet<string> = new Set(['var(--_text)', 'var(--_text-sec)', 'var(--_text-muted)', 'var(--_text-faint)'])

/**
 * A theme tone inked for a fill the author did not choose: a node's own fill,
 * or a tint of it. The tones are repaired against the page, and a custom
 * `surface` can put the node fill far from it (black nodes on a white page),
 * so the tone is kept where it reads on the fill at WCAG AA and moved toward
 * black or white just far enough where it does not. The faint tone is
 * decoration (separators), held to the 3:1 of non-text contrast as the theme
 * holds it. Any other paint is returned as it is, and so is a tone or fill
 * that is not concrete: its color is only known at runtime. Callers pass a
 * Style's own text color around this, not through it: the Style chose it for
 * its own fill, and verify reports it when it fails.
 */
export function toneOnFill(tone: string, fill: string, colors: DiagramColors): string {
  if (!THEME_TEXT_TONES.has(tone)) return tone
  const resolvedTone = resolvedColorValue(tone, colors)
  const resolvedFill = resolvedColorValue(fill, colors)
  const composite = resolvedTone && resolvedFill ? compositeCssColor(resolvedFill, resolvedColorValue('var(--bg)', colors) ?? '#ffffff') : null
  if (!composite) return tone
  const minimum = tone === 'var(--_text-faint)' ? WCAG_AA_NON_TEXT_CONTRAST : WCAG_AA_TEXT_CONTRAST
  const ink = legibleInk(resolvedTone!, toHex(...composite), minimum)
  return ink === resolvedTone ? tone : ink
}

/**
 * Ink for text a family draws on a node. The author's `color` wins. On an
 * author-styled shape (`style X fill:…`) each tone the family would use (name,
 * secondary, muted) is kept where it reads on the author's fill at WCAG AA and
 * moved toward black or white just far enough where it does not. On an
 * unstyled one the theme tones are inked for `nodeFill`, the Style's or the
 * theme's node fill (toneOnFill); it is omitted when the Style sets the text
 * color, which then owns the text on its own fills. Either way a dark fill the
 * author chose never swallows theme-colored text.
 */
export function inkOnNodeFill(
  inlineStyle: Record<string, string> | undefined,
  colors: DiagramColors,
  nodeFill?: string,
): (tone: string) => string {
  const color = inlineStyle?.color
  if (color) return () => color
  if (!inlineStyle?.fill) return nodeFill === undefined ? tone => tone : tone => toneOnFill(tone, nodeFill, colors)
  const composite = compositeCssColor(inlineStyle.fill, resolvedColorValue('var(--bg)', colors) ?? '#ffffff')
  if (!composite) return tone => tone
  const fill = toHex(...composite)
  return tone => {
    const resolved = resolvedColorValue(tone, colors)
    return resolved ? legibleInk(resolved, fill) : contrastTextColor(fill) ?? tone
  }
}
