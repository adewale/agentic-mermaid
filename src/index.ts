// ============================================================================
// beautiful-mermaid — public API
//
// Renders Mermaid diagrams to styled SVG strings.
// Framework-agnostic, no DOM required. Pure TypeScript.
//
// Supported diagram types:
//   - Flowcharts (graph TD / flowchart LR)
//   - State diagrams (stateDiagram-v2)
//   - Architecture diagrams (architecture-beta)
//   - Sequence diagrams (sequenceDiagram)
//   - Class diagrams (classDiagram)
//   - ER diagrams (erDiagram)
//   - Timeline diagrams (timeline)
//   - User Journey diagrams (journey)
//   - XY charts (xychart / xychart-beta)
//
// Theming uses CSS custom properties (--bg, --fg, + optional enrichment).
// See src/theme.ts for the full variable system.
//
// Usage:
//   import { renderMermaidSVG } from 'beautiful-mermaid'
//   const svg = renderMermaidSVG('graph TD\n  A --> B')
// ============================================================================

export type { RenderOptions, MermaidGraph, PositionedGraph } from './types.ts'
export type { DiagramColors, ThemeName, ResolvedColors } from './theme.ts'
export { fromShikiTheme, THEMES, DEFAULTS, resolveColors, inlineResolvedColors } from './theme.ts'
export { parseMermaid } from './parser.ts'
export { renderMermaidASCII, renderMermaidAscii } from './ascii/index.ts'
export type { AsciiRenderOptions } from './ascii/index.ts'
export type { MermaidRuntimeConfig, MermaidThemeVariables, TimelineRuntimeConfig } from './mermaid-source.ts'
export { parseArchitectureDiagram, architectureToMermaidGraph } from './architecture/parser.ts'

import { decodeXML } from 'entities'
import { parseMermaid } from './parser.ts'
import { layoutGraphSync } from './layout.ts'
import { renderSvg, compactSvg, namespaceSvgIds } from './renderer.ts'
import type { RenderOptions } from './types.ts'
import type { DiagramColors } from './theme.ts'
import { DEFAULTS, THEMES, inlineResolvedColors } from './theme.ts'
import { normalizeMermaidSource } from './mermaid-source.ts'
import type { MermaidRuntimeConfig, MermaidThemeVariables } from './mermaid-source.ts'

import { parseSequenceDiagram } from './sequence/parser.ts'
import { layoutSequenceDiagram } from './sequence/layout.ts'
import { renderSequenceSvg } from './sequence/renderer.ts'
import { parseClassDiagram } from './class/parser.ts'
import { layoutClassDiagramSync } from './class/layout.ts'
import { renderClassSvg } from './class/renderer.ts'
import { parseErDiagram } from './er/parser.ts'
import { layoutErDiagramSync } from './er/layout.ts'
import { renderErSvg } from './er/renderer.ts'
import { parseTimelineDiagram } from './timeline/parser.ts'
import { layoutTimelineDiagram } from './timeline/layout.ts'
import { renderTimelineSvg } from './timeline/renderer.ts'
import { parseJourneyDiagram } from './journey/parser.ts'
import { layoutJourneyDiagram } from './journey/layout.ts'
import { renderJourneySvg } from './journey/renderer.ts'
import { parseXYChart } from './xychart/parser.ts'
import { layoutXYChart } from './xychart/layout.ts'
import { renderXYChartSvg } from './xychart/renderer.ts'
import { parseArchitectureDiagram } from './architecture/parser.ts'
import { layoutArchitectureDiagram } from './architecture/layout.ts'
import { renderArchitectureSvg } from './architecture/renderer.ts'
import { resolveArchitectureVisualConfig } from './architecture/config.ts'

/**
 * Detect the diagram type from the mermaid source text.
 * Returns the type keyword used for routing to the correct pipeline.
 */
function detectDiagramType(firstLine: string): 'flowchart' | 'architecture' | 'sequence' | 'class' | 'er' | 'timeline' | 'journey' | 'xychart' {
  if (/^architecture-beta\s*$/.test(firstLine)) return 'architecture'
  if (/^xychart(-beta)?\b/.test(firstLine)) return 'xychart'
  if (/^timeline\s*$/.test(firstLine)) return 'timeline'
  if (/^journey\s*$/.test(firstLine)) return 'journey'
  if (/^sequencediagram\s*$/.test(firstLine)) return 'sequence'
  if (/^classdiagram\s*$/.test(firstLine)) return 'class'
  if (/^erdiagram\s*$/.test(firstLine)) return 'er'

  // Default: flowchart/state (handled by parseMermaid internally)
  return 'flowchart'
}

function firstSignificantLine(text: string): string {
  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim()
    if (line.length === 0 || line.startsWith('%%')) continue
    return line.split(';')[0]!.trim().toLowerCase()
  }
  return ''
}

/**
 * Build a DiagramColors object from render options.
 * Uses DEFAULTS for bg/fg when not provided, and passes through
 * optional enrichment colors (line, accent, muted, surface, border).
 */
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

function buildColors(options: RenderOptions, config: MermaidRuntimeConfig, font?: string): DiagramColors {
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
    // Threaded so `--font:<family>` lands on the SVG root via svgOpenTag.
    font,
    // Renderers read this to gate the Google Fonts @import. Default true preserves
    // wire compat; CLI / PNG paths set it false.
    embedFontImport: options.embedFontImport,
  }
}

function resolveThemeColors(themeName: string | undefined): DiagramColors | undefined {
  if (!themeName) return undefined
  if (themeName in THEMES) return THEMES[themeName as keyof typeof THEMES]
  return MERMAID_THEME_COLORS[themeName.toLowerCase()]
}

function readThemeValue(vars: MermaidThemeVariables | undefined, ...keys: string[]): string | undefined {
  if (!vars) return undefined

  for (const key of keys) {
    const value = vars[key]
    if (typeof value === 'string' && value.length > 0) return value
  }

  return undefined
}

/**
 * #7254/#7255: extract `accTitle:` and `accDescr:` (inline or `accDescr { … }`
 * block) from normalized source lines. These are Mermaid's accessibility
 * directives; we surface them as SVG <title>/<desc>.
 */
function extractAccessibility(lines: string[]): { title?: string; descr?: string } {
  const out: { title?: string; descr?: string } = {}
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!.trim()
    let m: RegExpMatchArray | null
    if ((m = line.match(/^accTitle\s*:\s*(.+)$/i))) out.title = m[1]!.trim()
    else if ((m = line.match(/^accDescr\s*:\s*(.+)$/i))) out.descr = m[1]!.trim()
    else if (/^accDescr\s*\{\s*$/i.test(line)) {
      const block: string[] = []
      for (let j = i + 1; j < lines.length; j++) {
        if (lines[j]!.trim() === '}') break
        block.push(lines[j]!.trim())
      }
      out.descr = block.join(' ').trim()
    }
  }
  return out
}

function escapeXmlText(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

/**
 * #7254/#7255: inject `<title>`/`<desc>` + `role="img"` + `aria-labelledby`
 * into the root <svg>. Localized post-pass (mirrors namespaceSvgIds) so we
 * don't thread accessibility through every family renderer. The title/desc ids
 * carry the same idPrefix as the rest of the doc to stay collision-free.
 */
function injectAccessibility(svg: string, acc: { title?: string; descr?: string }, idPrefix: string): string {
  const titleId = `${idPrefix}svg-title`
  const descId = `${idPrefix}svg-desc`
  const labelledby: string[] = []
  const children: string[] = []
  if (acc.title) { labelledby.push(titleId); children.push(`<title id="${titleId}">${escapeXmlText(acc.title)}</title>`) }
  if (acc.descr) { labelledby.push(descId); children.push(`<desc id="${descId}">${escapeXmlText(acc.descr)}</desc>`) }
  if (children.length === 0) return svg
  // Add role + aria-labelledby to the opening <svg …> tag (once).
  svg = svg.replace(/<svg\b([^>]*)>/, (full, attrs: string) => {
    const add = `${/\brole=/.test(attrs) ? '' : ' role="img"'} aria-labelledby="${labelledby.join(' ')}"`
    return `<svg${attrs}${add}>${children.join('')}`
  })
  return svg
}

/**
 * Render Mermaid diagram text to an SVG string — synchronously.
 *
 * Uses elk.bundled.js with a direct FakeWorker bypass (no setTimeout(0) delay).
 * The ELK singleton is created lazily on first use and cached forever.
 *
 * Use this in React components with useMemo() to avoid flash:
 *   const svg = useMemo(() => renderMermaidSVG(code, opts), [code])
 *
 * @param text - Mermaid source text
 * @param options - Rendering options (colors, font, spacing)
 * @returns A self-contained SVG string
 *
 * @example
 * ```ts
 * const svg = renderMermaidSVG('graph TD\n  A --> B')
 *
 * // With theme
 * const svg = renderMermaidSVG('graph TD\n  A --> B', {
 *   bg: '#1a1b26', fg: '#a9b1d6'
 * })
 *
 * // With CSS variables (for live theme switching)
 * const svg = renderMermaidSVG('graph TD\n  A --> B', {
 *   bg: 'var(--background)', fg: 'var(--foreground)', transparent: true
 * })
 * ```
 */
export function renderMermaidSVG(
  text: string,
  options: RenderOptions = {}
): string {
  // Decode XML entities that may leak from markdown parsers (e.g. rehype-raw).
  // Without this, escapeXml() double-encodes them: &lt; → &amp;lt; → literal "&lt;" in SVG.
  text = decodeXML(text)
  const normalizedSource = normalizeMermaidSource(text, options.mermaidConfig ?? {})

  const font = options.font
    ?? normalizedSource.config.fontFamily
    ?? readThemeValue(normalizedSource.config.themeVariables, 'fontFamily')
    ?? 'Inter'
  const colors = buildColors(options, normalizedSource.config, font)
  const transparent = options.transparent ?? false
  const diagramType = detectDiagramType(normalizedSource.firstLine)
  const lines = normalizedSource.lines
  // resolve() inlines CSS variables for non-browser renderers (resvg).
  // When `compact` is on we additionally round coords and collapse whitespace.
  const compact = options.compact ?? false
  const idPrefix = options.idPrefix ?? ''
  // #7254/#7255: extract accTitle/accDescr from source for SVG <title>/<desc>
  // + ARIA. The legacy SVG path doesn't carry these through the parser, so we
  // extract here and inject as a post-pass (localized, no renderer threading).
  const acc = extractAccessibility(lines)
  const resolve = (svg: string, c: DiagramColors = colors) => {
    let out = inlineResolvedColors(svg, c)
    // #7540: namespace def ids so multiple diagrams on one page don't collide.
    if (idPrefix) out = namespaceSvgIds(out, idPrefix)
    // #7254/#7255: inject <title>/<desc>/role="img"/aria-labelledby.
    if (acc.title || acc.descr) out = injectAccessibility(out, acc, idPrefix)
    return compact ? compactSvg(out) : out
  }

  switch (diagramType) {
    case 'architecture': {
      const archVisual = resolveArchitectureVisualConfig(normalizedSource.frontmatter, colors, options)
      const archOptions = archVisual.padding != null ? { ...options, padding: options.padding ?? archVisual.padding } : options
      const diagram = parseArchitectureDiagram(lines)
      const positioned = layoutArchitectureDiagram(diagram, archOptions, archVisual.visual)
      // Architecture renderer already inlines its own variables; apply compact
      // post-processing on the way out so the --compact flag is honored.
      const rawArch = renderArchitectureSvg(positioned, colors, font, transparent, archVisual.visual)
      return compact ? compactSvg(rawArch) : rawArch
    }
    case 'sequence': {
      const diagram = parseSequenceDiagram(lines)
      const positioned = layoutSequenceDiagram(diagram, options)
      return resolve(renderSequenceSvg(positioned, colors, font, transparent, options))
    }
    case 'class': {
      const diagram = parseClassDiagram(lines)
      const positioned = layoutClassDiagramSync(diagram, options)
      return resolve(renderClassSvg(positioned, colors, font, transparent, options))
    }
    case 'er': {
      const diagram = parseErDiagram(lines)
      const positioned = layoutErDiagramSync(diagram, options)
      return resolve(renderErSvg(positioned, colors, font, transparent, options))
    }
    case 'timeline': {
      const diagram = parseTimelineDiagram(lines)
      const positioned = layoutTimelineDiagram(diagram, options)
      return resolve(renderTimelineSvg(
        positioned,
        colors,
        font,
        transparent,
        normalizedSource.config.timeline,
        normalizedSource.config.themeVariables,
        options,
      ))
    }
    case 'journey': {
      const diagram = parseJourneyDiagram(lines)
      const positioned = layoutJourneyDiagram(diagram, options)
      return resolve(renderJourneySvg(positioned, colors, font, transparent, options))
    }
    case 'xychart': {
      const chart = parseXYChart(lines, normalizedSource.frontmatter)
      const positioned = layoutXYChart(chart, options)
      const chartColors = !options.bg && chart.theme.backgroundColor
        ? { ...colors, bg: chart.theme.backgroundColor }
        : colors
      return resolve(renderXYChartSvg(positioned, chartColors, font, transparent, options.interactive ?? false, options), chartColors)
    }
    case 'flowchart':
    default: {
      const graph = parseMermaid(normalizedSource.text)
      const positioned = layoutGraphSync(graph, options)
      return resolve(renderSvg(positioned, colors, font, transparent, options))
    }
  }
}

/**
 * Render Mermaid diagram text to an SVG string — async.
 *
 * Same result as renderMermaidSVG() but returns a Promise.
 * Useful in async contexts (server handlers, data loaders, etc.)
 */
export async function renderMermaidSVGAsync(
  text: string,
  options: RenderOptions = {}
): Promise<string> {
  return renderMermaidSVG(text, options)
}

// ---------------------------------------------------------------------------
// Backward-compatible aliases
// ---------------------------------------------------------------------------

/** @deprecated Use `renderMermaidSVG` */
export const renderMermaidSync = renderMermaidSVG

/** @deprecated Use `renderMermaidSVGAsync` */
export const renderMermaid = renderMermaidSVGAsync
