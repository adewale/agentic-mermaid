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

export type { RenderOptions, RenderContext, MermaidGraph, PositionedDiagram, PositionedGraph, RouteCertificate, EdgeRouteCertificate, FamilyEdgeRouteCertificate, RegionContainmentCertificate, FamilyRouteCertificate, LayoutRouteCertificate, LayoutRouteClass, RouteClass, RouteBlocker, RoutePortAssignment, PortSemanticRole, AnyPort, PortSide, DiamondFacet } from './types.ts'
export type { DiagramColors, ThemeName, ResolvedColors } from './theme.ts'
export { fromShikiTheme, THEMES, DEFAULTS, resolveColors, inlineResolvedColors } from './theme.ts'
export { resolveDiagramColors } from './color-resolver.ts'
export { parseMermaid } from './parser.ts'
export { renderMermaidASCII, renderMermaidAscii } from './ascii/index.ts'
export type { AsciiRenderOptions } from './ascii/index.ts'
export type { MermaidRuntimeConfig, MermaidThemeVariables, TimelineRuntimeConfig } from './mermaid-source.ts'
export { parseArchitectureDiagram, architectureToMermaidGraph } from './architecture/parser.ts'
export { TEXT_MEASUREMENT_CONTRACT, measureText, measureTextWidth } from './text-metrics.ts'
export type { TextMeasurementContract, TextMeasurementInput, TextMeasurementResult } from './text-metrics.ts'

import { decodeXML } from 'entities'
import { compactSvg, namespaceSvgIds } from './renderer.ts'
import type { PositionedDiagram, RenderContext, RenderOptions } from './types.ts'
import type { DiagramColors } from './theme.ts'
import { inlineResolvedColors } from './theme.ts'
import { normalizeMermaidSource, detectDiagramTypeFromFirstLine } from './mermaid-source.ts'
import { readThemeValue, resolveDiagramColors } from './color-resolver.ts'
import { getFamily } from './render-family-hooks.ts'
import type { FamilyLayoutResult } from './agent/families.ts'
import type { DiagramKind } from './agent/types.ts'

function normalizeFamilyLayoutResult(
  result: FamilyLayoutResult | PositionedDiagram,
): FamilyLayoutResult {
  return 'positioned' in result ? result : { positioned: result }
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
  const colors = resolveDiagramColors(effectiveOptions, normalizedSource.config, font)
  const diagramType = detectDiagramTypeFromFirstLine(normalizedSource.firstLine) ?? 'flowchart'
  const lines = normalizedSource.lines
  const renderOptions: RenderOptions = { ...effectiveOptions, mermaidConfig: normalizedSource.config }
  const renderContext = <TPositioned extends PositionedDiagram>(
    positioned: TPositioned,
    c: DiagramColors = colors,
    opts: RenderOptions = renderOptions,
  ): RenderContext<TPositioned> => ({ positioned, colors: c, options: opts })
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

  const family = getFamily(diagramType as DiagramKind)
  if (!family?.layout || !family.renderSvg) {
    throw new Error(`No SVG renderer registered for Mermaid family ${diagramType}`)
  }

  const layout = normalizeFamilyLayoutResult(family.layout({
    source: normalizedSource,
    options,
    renderOptions,
    colors,
  }))
  const renderColors = layout.colors ?? colors
  const rawSvg = family.renderSvg(renderContext(layout.positioned, renderColors, layout.options ?? renderOptions))
  return resolve(rawSvg, renderColors, layout.injectAccessibility ?? true)
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
