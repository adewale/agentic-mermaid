// ============================================================================
// Agentic Mermaid — public API (published as agentic-mermaid)
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
//   - Pie charts (pie)
//   - Quadrant charts (quadrantChart)
//   - Gantt charts (gantt)
//
// Theming uses CSS custom properties (--bg, --fg, + optional enrichment).
// See src/theme.ts for the full variable system.
//
// Usage:
//   import { renderMermaidSVG } from 'agentic-mermaid'
//   const svg = renderMermaidSVG('graph TD\n  A --> B')
// ============================================================================

export type { RenderOptions, MermaidGraph, PositionedGraph, RouteCertificate, RouteClass, RouteBlocker } from './types.ts'
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
import { normalizeMermaidSource, detectDiagramTypeFromFirstLine } from './mermaid-source.ts'
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
import { parsePieChart } from './pie/parser.ts'
import { layoutPieChart } from './pie/layout.ts'
import { renderPieSvg } from './pie/renderer.ts'
import { parseQuadrantChart } from './quadrant/parser.ts'
import { layoutQuadrantChart } from './quadrant/layout.ts'
import { renderQuadrantSvg } from './quadrant/renderer.ts'
import { parseGanttModel, applyGanttFrontmatterConfig } from './gantt/parser.ts'
import { resolveGanttSchedule } from './gantt/schedule.ts'
import { layoutGantt } from './gantt/layout.ts'
import { renderGanttSvg } from './gantt/renderer.ts'
import { parseArchitectureDiagram } from './architecture/parser.ts'
import { layoutArchitectureDiagram } from './architecture/layout.ts'
import { renderArchitectureSvg } from './architecture/renderer.ts'
import { resolveArchitectureVisualConfig } from './architecture/config.ts'

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
 * #7645/#7695: scan an SVG for external-fetch references — `@import` URLs,
 * `<image href>`/`xlink:href` to http(s) or protocol-relative URLs,
 * `<use href>` to external, `url(http…)` / `url(//…)`
 * in styles, `<script>`, `<foreignObject>`. The `xmlns="http://www.w3.org/…"`
 * namespace declaration is NOT a fetch and is excluded. Returns the offending
 * references so it can serve as a CI gate and an agent self-check.
 */
const XML_SLASH_REF = String.raw`(?:/|&(?:amp;)?#x0*2f;|&(?:amp;)?#0*47;|&(?:amp;)?sol;)`
const XML_EXTERNAL_PREFIX = String.raw`(?:https?:)?${XML_SLASH_REF}${XML_SLASH_REF}`
const XML_EXTERNAL_ATTR_QUOTED = new RegExp(String.raw`\s(?:[^\s=<>]+:)?(?:href|src|data)\s*=\s*["']\s*${XML_EXTERNAL_PREFIX}[^"']*["']`, 'gi')
const XML_EXTERNAL_ATTR_UNQUOTED = new RegExp(String.raw`\s(?:[^\s=<>]+:)?(?:href|src|data)\s*=\s*${XML_EXTERNAL_PREFIX}[^\s>"']+`, 'gi')

export function verifyNoExternalRefs(svg: string): { ok: boolean; refs: string[] } {
  const scan = normalizeCssObfuscation(svg)
  const refs: string[] = []
  // @import url(...) or @import "..."
  for (const m of scan.matchAll(/@import\s*(?:url\()?\s*["']?\s*((?:https?:)?\/\/[^"')]+)/gi)) refs.push(`@import ${m[1]}`)
  for (const m of scan.matchAll(/@import\s*(?:url\()?\s*["']?\s*(javascript\s*:[^"')\s;]+)/gi)) refs.push(`@import ${m[1]}`)
  // href / *:href / src / data to http(s) or protocol-relative URLs (xmlns excluded — it's a declaration, not a ref)
  for (const m of scan.matchAll(/(?<!xmlns:)\b(?:[^\s=<>]+:)?(?:href|src|data)\s*=\s*["']\s*((?:https?:)?\/\/[^"']+)["']/gi)) refs.push(m[1]!)
  for (const m of scan.matchAll(/(?<!xmlns:)\b(?:[^\s=<>]+:)?(?:href|src|data)\s*=\s*((?:https?:)?\/\/[^\s>"']+)/gi)) refs.push(m[1]!)
  for (const m of scan.matchAll(XML_EXTERNAL_ATTR_QUOTED)) refs.push(m[0]!)
  for (const m of scan.matchAll(XML_EXTERNAL_ATTR_UNQUOTED)) refs.push(m[0]!)
  // url(http…) / url(//…) / url(javascript:…) inside style/attr values
  for (const m of scan.matchAll(/url\(\s*["']?\s*((?:https?:)?\/\/[^"')]+)/gi)) refs.push(m[1]!)
  for (const m of scan.matchAll(/url\(\s*["']?\s*(javascript\s*:[^"')]+)/gi)) refs.push(m[1]!)
  // active content that can fetch/exfiltrate
  if (/<(?:[^\s<>/:]+:)?script\b/i.test(scan)) refs.push('<script>')
  if (/<(?:[^\s<>/:]+:)?foreignObject\b/i.test(scan)) refs.push('<foreignObject>')
  if (/<(?:[^\s<>/:]+:)?image\b/i.test(scan)) refs.push('<image>')
  if (/<(?:[^\s<>/:]+:)?object\b/i.test(scan)) refs.push('<object>')
  if (/<(?:[^\s<>/:]+:)?embed\b/i.test(scan)) refs.push('<embed>')
  if (/<(?:[^\s<>/:]+:)?iframe\b/i.test(scan)) refs.push('<iframe>')
  if (/\son[a-z][\w:.-]*\s*=/i.test(scan)) refs.push('inline-event-handler')
  if (/\s(?:[^\s=<>]+:)?(?:href|src|data)\s*=\s*["']?\s*javascript\s*:/i.test(scan)) refs.push('javascript-url')
  return { ok: refs.length === 0, refs }
}

function normalizeCssObfuscation(svg: string): string {
  return svg
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\\([0-9a-fA-F]{1,6})\s?/g, (_, hex: string) => {
      const cp = Number.parseInt(hex, 16)
      return Number.isFinite(cp) ? String.fromCodePoint(cp) : ''
    })
    .replace(/\\([^\n\r\f])/g, '$1')
}

function stripExternalRefs(svg: string): string {
  return normalizeCssObfuscation(svg)
    .replace(/@import\s*(?:url\()?\s*["']?\s*(?:https?:)?\/\/[^\n;}]+[;)]?/gi, '')
    .replace(/@import\s*(?:url\()?\s*["']?\s*javascript\s*:[^\n;}]+[;)]?/gi, '')
    .replace(/url\(\s*["']?\s*(?:https?:)?\/\/[^"')]+["']?\s*\)/gi, 'none')
    .replace(/url\(\s*["']?\s*javascript\s*:[^"')]+["']?\s*\)/gi, 'none')
    .replace(XML_EXTERNAL_ATTR_QUOTED, '')
    .replace(XML_EXTERNAL_ATTR_UNQUOTED, '')
    .replace(/\s(?:[^\s=<>]+:)?(?:href|src|data)\s*=\s*["']\s*(?:https?:)?\/\/[^"']+["']/gi, '')
    .replace(/\s(?:[^\s=<>]+:)?(?:href|src|data)\s*=\s*(?:https?:)?\/\/[^\s>"']+/gi, '')
    .replace(/\s(?:[^\s=<>]+:)?(?:href|src|data)\s*=\s*["']\s*javascript\s*:[^"']*["']/gi, '')
    .replace(/\s(?:[^\s=<>]+:)?(?:href|src|data)\s*=\s*javascript\s*:[^\s>]+/gi, '')
    .replace(/\son[a-z][\w:.-]*\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    .replace(/<(?:[^\s<>/:]+:)?script\b[^>]*>[\s\S]*?<\/(?:[^\s<>/:]+:)?script>/gi, '')
    .replace(/<(?:[^\s<>/:]+:)?script\b[^>]*\/?>/gi, '')
    .replace(/<(?:[^\s<>/:]+:)?foreignObject\b[^>]*>[\s\S]*?<\/(?:[^\s<>/:]+:)?foreignObject>/gi, '')
    .replace(/<(?:[^\s<>/:]+:)?foreignObject\b[^>]*\/?>/gi, '')
    .replace(/<(?:[^\s<>/:]+:)?image\b[^>]*\/?>/gi, '')
    .replace(/<(?:[^\s<>/:]+:)?object\b[^>]*>[\s\S]*?<\/(?:[^\s<>/:]+:)?object>/gi, '')
    .replace(/<(?:[^\s<>/:]+:)?object\b[^>]*\/?>/gi, '')
    .replace(/<(?:[^\s<>/:]+:)?embed\b[^>]*>[\s\S]*?<\/(?:[^\s<>/:]+:)?embed>/gi, '')
    .replace(/<(?:[^\s<>/:]+:)?embed\b[^>]*\/?>/gi, '')
    .replace(/<(?:[^\s<>/:]+:)?iframe\b[^>]*>[\s\S]*?<\/(?:[^\s<>/:]+:)?iframe>/gi, '')
    .replace(/<(?:[^\s<>/:]+:)?iframe\b[^>]*\/?>/gi, '')
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
  // #7645/#7695: strict security mode disables the Google Fonts @import and
  // strips any external-fetch refs introduced by user theme/config values. The
  // --font CSS variable still declares the family; xmlns http:// is a namespace
  // declaration, not a fetch.
  const effectiveOptions: RenderOptions = options.security === 'strict'
    ? { ...options, embedFontImport: false }
    : options
  const colors = buildColors(effectiveOptions, normalizedSource.config, font)
  const transparent = options.transparent ?? false
  const diagramType = detectDiagramTypeFromFirstLine(normalizedSource.firstLine) ?? 'flowchart'
  const lines = normalizedSource.lines
  // resolve() inlines CSS variables for non-browser renderers (resvg).
  // When `compact` is on we additionally round coords and collapse whitespace.
  const compact = options.compact ?? false
  const idPrefix = options.idPrefix ?? ''
  const finalizeSvg = (svg: string) => options.security === 'strict' ? stripExternalRefs(svg) : svg
  // #7254/#7255: extract accTitle/accDescr from source for SVG <title>/<desc>
  // + ARIA. The legacy SVG path doesn't carry these through the parser, so we
  // extract here and inject as a post-pass (localized, no renderer threading).
  const acc = extractAccessibility(lines)
  const resolve = (svg: string, c: DiagramColors = colors, injectAcc = true) => {
    let out = inlineResolvedColors(svg, c)
    // #7540: namespace def ids so multiple diagrams on one page don't collide.
    if (idPrefix) out = namespaceSvgIds(out, idPrefix)
    // #7254/#7255: inject <title>/<desc>/role="img"/aria-labelledby for
    // renderers that do not carry accessibility through their family-specific
    // parser. Xychart does, so it opts out below to avoid duplicate ARIA attrs.
    if (injectAcc && (acc.title || acc.descr)) out = injectAccessibility(out, acc, idPrefix)
    out = finalizeSvg(out)
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
      const out = finalizeSvg(rawArch)
      return compact ? compactSvg(out) : out
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
      return resolve(renderXYChartSvg(positioned, chartColors, font, transparent, options.interactive ?? false, options), chartColors, false)
    }
    case 'pie': {
      const chart = parsePieChart(lines)
      const positioned = layoutPieChart(chart, options, colors)
      return resolve(renderPieSvg(positioned, colors, font, transparent, options))
    }
    case 'quadrant': {
      const chart = parseQuadrantChart(lines)
      const positioned = layoutQuadrantChart(chart, options)
      return resolve(renderQuadrantSvg(positioned, colors, font, transparent, options))
    }
    case 'gantt': {
      const model = applyGanttFrontmatterConfig(parseGanttModel(lines), normalizedSource.frontmatter)
      const schedule = resolveGanttSchedule(model, { today: options.ganttToday })
      const positioned = layoutGantt(model, schedule, { today: schedule.today })
      return resolve(renderGanttSvg(positioned, colors, font, transparent))
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
