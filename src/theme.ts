// ============================================================================
// Theme system — CSS custom property-based theming for mermaid SVG diagrams.
//
// Architecture:
//   - Two required variables: --bg (background) and --fg (foreground)
//   - Five optional enrichment variables: --line, --accent, --muted, --surface, --border
//   - Unset optionals fall back to color-mix() derivations from bg + fg
//   - All derived values computed in a <style> block inside the SVG
//
// This means the SVG is a function of its CSS variables. The caller provides
// colors, and the SVG adapts. No light/dark mode detection needed.
// ============================================================================

// ============================================================================
// Types
// ============================================================================

import { svgCssText, transformSvgCssValues } from './svg-structure.ts'

/**
 * Diagram color configuration.
 *
 * Required: bg + fg give you a clean mono diagram.
 * Optional: line, accent, muted, surface, border bring in richer color
 * from Shiki themes or custom palettes. Each falls back to a color-mix()
 * derivation from bg + fg if not set.
 */
import { parseHex, toHex, mixHex, isHexColor, luma255, ensureContrast } from './shared/color-math.ts'
import { BUILTIN_PALETTE_DEFINITIONS } from './palette-catalog.ts'
import { requireSafeCssFontFamily } from './shared/css-font.ts'
import { requireSafeCssPaint } from './shared/css-color.ts'

export interface DiagramColors {
  /** Background color → CSS variable --bg */
  bg: string
  /** Foreground / primary text color → CSS variable --fg */
  fg: string

  // -- Optional enrichment (each falls back to color-mix from bg+fg) --

  /** Edge/connector color → CSS variable --line */
  line?: string
  /** Arrow heads, highlights, special nodes → CSS variable --accent */
  accent?: string
  /** Secondary text, edge labels → CSS variable --muted */
  muted?: string
  /** Node/box fill tint → CSS variable --surface */
  surface?: string
  /** Node/group stroke color → CSS variable --border */
  border?: string

  // -- Optional visual effects --

  /** Optional explicit drop shadows on node shapes. Default: false */
  shadow?: boolean

  // -- Font (threaded for the --font CSS variable on the SVG root) --

  /**
   * Font family for all text. Emitted on the SVG root as `--font`, so the family
   * stays overridable post-render via inline style. Default: 'Inter'.
   *
   * Accepts a plain family name ('Inter'), a CSS variable reference
   * ('var(--brand-font)'), or a multi-family stack ('Inter, system-ui').
   * Only plain names get a Google Fonts `@import`; var() references and
   * stacks are emitted as-is (unquoted) and never fetched.
   */
  font?: string

  /**
   * Whether to embed the Google Fonts `@import` line in the SVG `<style>` block.
   * Default: `true` (preserves wire compatibility with all existing consumers).
   *
   * CLI / PNG paths set `false` explicitly to render offline / CSP-friendly.
   * The CSS variable `--font` is always emitted on the SVG root regardless,
   * so the family stays overridable post-render even when the @import is gone.
   */
  embedFontImport?: boolean
}

// ============================================================================
// Defaults
// ============================================================================

/** Default bg/fg when no colors are provided (zinc light) */
export const DEFAULTS: Readonly<{ bg: string; fg: string }> = {
  bg: '#FFFFFF',
  fg: '#27272A',
} as const

// ============================================================================
// color-mix() weights for derived CSS variables
//
// When an optional enrichment variable is NOT set, we compute the derived
// value by mixing --fg into --bg at these percentages. This produces a
// coherent mono hierarchy on any bg/fg combination.
// ============================================================================

export const MIX = {
  /** Primary text: near-full fg */
  text:         100, // just use --fg directly
  /** Secondary text (group headers): fg mixed at 78% — WCAG AA on text */
  textSec:      78,
  /** Muted text (edge labels, member types): fg mixed at 66% so diagram
   *  text clears WCAG AA (4.5:1) on the default themes; ≥3:1 on low-contrast
   *  palettes whose base fg/bg cannot mathematically support an AA muted tier. */
  textMuted:    66,
  /** Faint text (visibility markers, separators): fg mixed at 54% — ≥3:1 */
  textFaint:    54,
  /** Edge/connector lines: fg mixed at 50% for clear visibility */
  line:         50,
  /** Arrow head fill: fg mixed at 85% for clear visibility */
  arrow:        85,
  /** Node fill tint: fg mixed at 3% */
  nodeFill:     3,
  /** Node/group stroke: fg mixed at 20% */
  nodeStroke:   20,
  /** Group header band tint: fg mixed at 5% */
  groupHeader:  5,
  /** Inner divider strokes: fg mixed at 12% */
  innerStroke:  12,
  /** Key badge background opacity (ER diagrams) */
  keyBadge:     10,
} as const

// ============================================================================
// Well-known theme palettes
//
// Curated bg/fg pairs (+ optional enrichment) for popular editor themes.
// Users can also extract from Shiki theme objects via fromShikiTheme().
// ============================================================================

/** Legacy theme-name projection generated from the canonical built-in palette
 * catalog. New discovery and registration code must use Style descriptors. */
export const THEMES: Readonly<Record<string, DiagramColors>> = Object.freeze(
  Object.fromEntries(BUILTIN_PALETTE_DEFINITIONS.map(definition => [
    definition.legacyName,
    Object.freeze({ ...definition.colors }),
  ])),
)

export type ThemeName = keyof typeof THEMES

// ============================================================================
// Shiki theme extraction
//
// Extracts DiagramColors from a Shiki ThemeRegistrationResolved object.
// This provides native compatibility with any VS Code / TextMate theme.
// ============================================================================

/**
 * Minimal subset of Shiki's ThemeRegistrationResolved that we need.
 * We don't import from shiki to avoid a hard dependency.
 */
interface ShikiThemeLike {
  type?: string
  colors?: Record<string, string>
  tokenColors?: Array<{
    scope?: string | string[]
    settings?: { foreground?: string }
  }>
}

/**
 * Extract diagram colors from a Shiki theme object.
 * Works with any VS Code / TextMate theme loaded by Shiki.
 *
 * Maps editor UI colors to diagram roles:
 *   editor.background         → bg
 *   editor.foreground         → fg
 *   editorLineNumber.fg       → line (optional)
 *   focusBorder / keyword     → accent (optional)
 *   comment token             → muted (optional)
 *   editor.selectionBackground→ surface (optional)
 *   editorWidget.border       → border (optional)
 *
 * @example
 * ```ts
 * import { getSingletonHighlighter } from 'shiki'
 * import { fromShikiTheme } from 'agentic-mermaid'
 *
 * const hl = await getSingletonHighlighter({ themes: ['tokyo-night'] })
 * const colors = fromShikiTheme(hl.getTheme('tokyo-night'))
 * const svg = renderMermaidSVG(code, colors)
 * ```
 */
export function fromShikiTheme(theme: ShikiThemeLike): DiagramColors {
  const c = theme.colors ?? {}
  const dark = theme.type === 'dark'

  // Helper: find a token color by scope name
  const tokenColor = (scope: string): string | undefined =>
    theme.tokenColors?.find(t =>
      Array.isArray(t.scope) ? t.scope.includes(scope) : t.scope === scope
    )?.settings?.foreground

  return {
    bg: c['editor.background'] ?? (dark ? '#1e1e1e' : '#ffffff'),
    fg: c['editor.foreground'] ?? (dark ? '#d4d4d4' : '#333333'),
    line:    c['editorLineNumber.foreground'] ?? undefined,
    accent:  c['focusBorder'] ?? tokenColor('keyword') ?? undefined,
    muted:   tokenColor('comment') ?? c['editorLineNumber.foreground'] ?? undefined,
    surface: c['editor.selectionBackground'] ?? undefined,
    border:  c['editorWidget.border'] ?? undefined,
  }
}

// ============================================================================
// SVG style block — the CSS variable derivation system
//
// Generates the <style> content that maps user-facing variables (--bg, --fg,
// --line, etc.) to internal derived variables (--_text, --_line, etc.) using
// color-mix() fallbacks.
// ============================================================================

/**
 * SVG <filter> definition for subtle drop shadows on node shapes.
 * Returns the filter element to include inside <defs>, or empty string
 * when shadows are not enabled.
 *
 * The shadow uses a fixed dark color at very low opacity so it works
 * on any light background. Dark themes should use a lighter base.
 */
export function buildShadowDefs(colors: DiagramColors): string {
  if (!colors.shadow) return ''

  // Detect dark theme by checking if bg luminance is low.
  // Use a lighter shadow base for dark backgrounds so it's visible.
  const isDark = isColorDark(colors.bg)
  const floodColor = isDark ? '#ffffff' : '#000000'
  const floodOpacity = isDark ? '0.12' : '0.08'

  return (
    `  <filter id="bm-shadow" x="-12%" y="-10%" width="128%" height="136%">` +
    `\n    <feDropShadow dx="0" dy="1.5" stdDeviation="2.5" flood-color="${floodColor}" flood-opacity="${floodOpacity}" />` +
    `\n  </filter>`
  )
}

/**
 * Rough luminance check for hex colors.
 * Returns true if the color appears dark (luminance < 0.4).
 */
function isColorDark(color: string): boolean {
  const hex = color.replace('#', '')
  if (hex.length < 6) return false
  const [r, g, b] = parseHex(color)
  return luma255(r, g, b) / 255 < 0.4
}

/**
 * Build the CSS variable derivation rules for the SVG <style> block.
 *
 * When an optional variable (--line, --accent, etc.) is set on the SVG or
 * a parent element, it's used directly. When unset, the fallback computes
 * a blended value from --fg and --bg using color-mix().
 */
/**
 * True when `font` is a single plain family name (e.g. 'Inter', 'IBM Plex
 * Sans') — the only shape that can be turned into a Google Fonts @import URL
 * and safely single-quoted in CSS. var() references, multi-family stacks,
 * and already-quoted names don't qualify: URL-encoding those produces a
 * nonsense @import (e.g. family=var(--brand-font)) and quoting them produces
 * an invalid family literal (issue: CSS-variable fonts).
 */
function isPlainFontFamily(font: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9 _-]*$/.test(font)
}

/** Family substituted when a raster target cannot resolve a var() font. */
const RASTER_FONT_FALLBACK = "'Inter'"

/**
 * Resolve one `var(--font, <fallback>)` fallback to a family list usable by
 * a static rasterizer. Plain literals ('Inter', Inter, system-ui) pass
 * through unchanged; a var() reference (e.g. `var(--brand-font)`) points at
 * a host-page custom property that doesn't exist under resvg, so it resolves
 * to its own concrete fallback when present, else the default family.
 */
function resolveRasterFontFamily(fallback: string): string {
  if (!fallback.includes('var(')) return fallback
  const inner = /^var\(\s*--[\w-]+\s*,\s*([^()]+)\)$/.exec(fallback)?.[1]?.trim()
  return inner || RASTER_FONT_FALLBACK
}

/**
 * Inline the `--font` CSS variable for static rasterizers. The renderer emits
 * `font-family: var(--font, <fallback>)` (see the declaration in
 * buildStyleBlock) so browsers can live-swap the family — but resvg/librsvg
 * have no CSS custom-property support, so the declaration never matches and
 * every face silently falls back. The fallback carries the resolved family
 * (or a var() reference, resolved via resolveRasterFontFamily); substituting
 * it is raster-only and leaves SVG output byte-identical. Both PNG paths
 * (napi and wasm) share this one workaround.
 */
export function inlineFontVarForRaster(svg: string): string {
  return transformSvgCssValues(svg, inlineFontVarInCss)
}

function inlineFontVarInCss(svg: string): string {
  const marker = 'var(--font,'
  let out = ''
  let i = 0
  while (true) {
    const at = svg.indexOf(marker, i)
    if (at === -1) return out + svg.slice(i)
    out += svg.slice(i, at)
    // Scan to the matching close paren — the fallback may itself nest a
    // var() reference, so a fixed regex can't find the boundary.
    let depth = 1
    let j = at + marker.length
    while (j < svg.length && depth > 0) {
      if (svg[j] === '(') depth++
      else if (svg[j] === ')') depth--
      j++
    }
    out += resolveRasterFontFamily(svg.slice(at + marker.length, j - 1).trim())
    i = j
  }
}

export function buildStyleBlock(font: string, hasMonoFont: boolean, shadow?: boolean, embedFontImport: boolean = true): string {
  font = requireSafeCssFontFamily(font)
  // CLI / PNG path sets embedFontImport=false explicitly to render offline /
  // CSP-friendly; library default preserves wire compatibility (existing SVG
  // fixtures and consumer snapshots assert the @import is present). The family
  // @import is additionally suppressed for var() references and multi-family
  // stacks — URL-encoding those yields a nonsense Google Fonts request.
  const fontImports = embedFontImport
    ? [
        ...(isPlainFontFamily(font)
          ? [`@import url('https://fonts.googleapis.com/css2?family=${encodeURIComponent(font)}:wght@400;500;600;700&amp;display=swap');`]
          : []),
        ...(hasMonoFont
          ? [`@import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500&amp;display=swap');`]
          : []),
      ]
    : []

  // Derived CSS variables: use override if set, else mix from bg+fg.
  // The --_ prefix signals "private/derived" — not meant for external override.
  const derivedVars = `
    /* Derived from --bg and --fg (overridable via --line, --accent, etc.) */
    --_text:          var(--fg);
    --_text-sec:      var(--muted, color-mix(in srgb, var(--fg) ${MIX.textSec}%, var(--bg)));
    --_text-muted:    var(--muted, color-mix(in srgb, var(--fg) ${MIX.textMuted}%, var(--bg)));
    --_text-faint:    color-mix(in srgb, var(--fg) ${MIX.textFaint}%, var(--bg));
    --_line:          var(--line, color-mix(in srgb, var(--fg) ${MIX.line}%, var(--bg)));
    --_arrow:         var(--accent, color-mix(in srgb, var(--fg) ${MIX.arrow}%, var(--bg)));
    --_node-fill:     var(--surface, color-mix(in srgb, var(--fg) ${MIX.nodeFill}%, var(--bg)));
    --_node-stroke:   var(--border, color-mix(in srgb, var(--fg) ${MIX.nodeStroke}%, var(--bg)));
    --_group-fill:    var(--bg);
    --_group-hdr:     color-mix(in srgb, var(--fg) ${MIX.groupHeader}%, var(--bg));
    --_inner-stroke:  color-mix(in srgb, var(--fg) ${MIX.innerStroke}%, var(--bg));
    --_key-badge:     color-mix(in srgb, var(--fg) ${MIX.keyBadge}%, var(--bg));`

  // Shadow CSS — applies drop shadow to node/box groups when enabled
  const shadowRules = shadow
    ? '\n  .node, .class-node, .entity, .actor[data-type="participant"], .note, .block, .timeline-event, .journey-task { filter: url(#bm-shadow); }'
    : ''

  // CSS variable --font lets consumers swap the family post-render by mutating
  // `style="--font:Roboto"` on the SVG root. The literal default family is the
  // last-ditch fallback so SVGs viewed without the variable still render OK.
  // Plain names are single-quoted (current wire format); var() references and
  // multi-family stacks pass through unquoted — quoting those would make the
  // fallback a bogus single family literally named e.g. "var(--brand-font)".
  const fontFallback = isPlainFontFamily(font) ? `'${font}'` : font
  const fontFamilyDecl = `  text { font-family: var(--font, ${fontFallback}), system-ui, sans-serif; }`

  // Only emit @import lines when there are any (embedFontImport=false, or the
  // family import was suppressed for a non-plain font and no mono face is
  // needed). We still emit the style block (for derived vars, etc.) and the
  // font-family declaration; only the network-fetched @import disappears.
  const styleHead = fontImports.length > 0
    ? [`  ${fontImports.join('\n  ')}`, fontFamilyDecl]
    : [fontFamilyDecl]

  return [
    '<style>',
    ...styleHead,
    ...(hasMonoFont ? [`  .mono { font-family: 'JetBrains Mono', 'SF Mono', 'Fira Code', ui-monospace, monospace; }`] : []),
    `  svg {${derivedVars}`,
    `  }${shadowRules}`,
    '</style>',
  ].join('\n')
}

/**
 * Build the SVG opening tag with CSS variables set as inline styles.
 * Only includes optional variables that are actually provided — unset ones
 * will fall back to the color-mix() derivations in the <style> block.
 *
 * @param transparent - If true, omits the background style for transparent SVGs
 */
export function svgOpenTag(
  width: number,
  height: number,
  colors: DiagramColors,
  transparent?: boolean,
  extra?: Record<string, string> | {
    width?: string
    height?: string
    style?: string
    attrs?: Record<string, string | undefined>
  },
): string {
  if (colors.font !== undefined) requireSafeCssFontFamily(colors.font)
  for (const field of ['bg', 'fg', 'line', 'accent', 'muted', 'surface', 'border'] as const) {
    const value = colors[field]
    if (value !== undefined) requireSafeCssPaint(value, field)
  }
  // Build the style string with only the provided color variables.
  // `--font` is emitted alongside the colors so consumers can swap the family
  // post-render via `style="--font:Roboto"` on the SVG root.
  const vars = [
    `--bg:${colors.bg}`,
    `--fg:${colors.fg}`,
    colors.line    ? `--line:${colors.line}` : '',
    colors.accent  ? `--accent:${colors.accent}` : '',
    colors.muted   ? `--muted:${colors.muted}` : '',
    colors.surface ? `--surface:${colors.surface}` : '',
    colors.border  ? `--border:${colors.border}` : '',
    colors.font    ? `--font:${colors.font}` : '',
  ].filter(Boolean).join(';')

  const bgStyle = transparent ? '' : ';background:var(--bg)'
  const overrides = isSvgOpenTagOverrides(extra) ? extra : undefined
  const attrs = overrides?.attrs ?? (extra as Record<string, string> | undefined) ?? {}
  const style = `${vars}${bgStyle}${overrides?.style ? `;${overrides.style}` : ''}`
  const extraAttrs = Object.entries(attrs)
    .filter(([, value]) => value !== undefined)
    .map(([key, value]) => `${key}="${value}"`)
    .join(' ')
  const attrBlock = extraAttrs ? ` ${extraAttrs}` : ''

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" ` +
    `width="${overrides?.width ?? width}" height="${overrides?.height ?? height}" style="${style}"${attrBlock}>`
  )
}

// ============================================================================
// Color resolution — pre-compute concrete hex values for non-browser renderers
//
// The CSS variable system (var(--_xxx), color-mix()) works in browsers but
// fails in non-browser SVG renderers like resvg. These functions resolve all
// derived colors to hex and inline them into the SVG string, making it render
// correctly everywhere.
// ============================================================================

/**
 * All derived diagram colors resolved to concrete hex values.
 * Mirrors the CSS variable derivation system in buildStyleBlock().
 */
export interface ResolvedColors {
  bg: string
  fg: string
  text: string
  textSec: string
  textMuted: string
  textFaint: string
  line: string
  arrow: string
  nodeFill: string
  nodeStroke: string
  groupFill: string
  groupHdr: string
  innerStroke: string
  keyBadge: string
}

/**
 * Resolve all derived colors from a DiagramColors to concrete hex values.
 * Implements the same logic as the CSS color-mix() derivations in buildStyleBlock().
 */
export function resolveColors(colors: DiagramColors): ResolvedColors {
  const { bg, fg } = colors
  const nodeFill = colors.surface ?? mixHex(fg, bg, MIX.nodeFill)
  const groupHdr = mixHex(fg, bg, MIX.groupHeader)
  let text = ensureContrast(fg, bg, 4.5)
  text = ensureContrast(text, nodeFill, 4.5)
  let textSec = ensureContrast(colors.muted ?? mixHex(fg, bg, MIX.textSec), bg, 4.5, text)
  textSec = ensureContrast(textSec, groupHdr, 4.5, text)
  const textMuted = ensureContrast(colors.muted ?? mixHex(fg, bg, MIX.textMuted), bg, 4.5, text)
  const textFaint = ensureContrast(mixHex(fg, bg, MIX.textFaint), bg, 3, text)
  return {
    bg,
    fg,
    text,
    textSec,
    textMuted,
    textFaint,
    line: ensureContrast(colors.line ?? mixHex(fg, bg, MIX.line), bg, 3, text),
    arrow: ensureContrast(colors.accent ?? mixHex(fg, bg, MIX.arrow), bg, 3, text),
    nodeFill,
    nodeStroke: colors.border ?? mixHex(fg, bg, MIX.nodeStroke),
    groupFill: bg,
    groupHdr,
    innerStroke: mixHex(fg, bg, MIX.innerStroke),
    keyBadge: mixHex(fg, bg, MIX.keyBadge),
  }
}

/**
 * Resolve all CSS var() and color-mix() expressions in an SVG string to
 * concrete hex color values. This makes the SVG render correctly in
 * non-browser renderers (resvg, librsvg, etc.) that don't support CSS
 * custom properties or color-mix().
 *
 * Operates via iterative string replacement:
 *   1. Replace var(--name) with known resolved values
 *   2. Replace var(--name, fallback) — use value if known, else fallback
 *   3. Resolve color-mix(in srgb, #hex P%, #hex) to computed hex
 *   4. Extract CSS variable definitions from <style> and resolve remaining refs
 *   5. Repeat until stable
 *
 * When bg/fg are not hex colors (e.g. CSS variable strings for live theming),
 * the SVG is returned as-is since resolution isn't possible.
 */
export function inlineResolvedColors(svg: string, colors: DiagramColors): string {
  if (!isHexColor(colors.bg) || !isHexColor(colors.fg)) return svg

  const rc = resolveColors(colors)

  // Build mapping of CSS variable names → resolved hex values
  const vars = new Map<string, string>()
  // User-facing variables
  vars.set('bg', rc.bg)
  vars.set('fg', rc.fg)
  if (colors.line && isHexColor(colors.line)) vars.set('line', colors.line)
  if (colors.accent && isHexColor(colors.accent)) vars.set('accent', colors.accent)
  if (colors.muted && isHexColor(colors.muted)) vars.set('muted', colors.muted)
  if (colors.surface && isHexColor(colors.surface)) vars.set('surface', colors.surface)
  if (colors.border && isHexColor(colors.border)) vars.set('border', colors.border)

  // Some family renderers define concrete custom properties on the SVG root
  // before using them in style-block fallbacks. Learn those up front so
  // var(--family-token, fallback) prefers the authored token over fallback.
  const cssDefRegex = /--([\w-]+)\s*:\s*(#[0-9a-fA-F]{3,8})\s*;?/g
  let initialDefMatch
  while ((initialDefMatch = cssDefRegex.exec(svgCssText(svg))) !== null) {
    vars.set(initialDefMatch[1]!, initialDefMatch[2]!)
  }

  // Derived internal variables
  vars.set('_text', rc.text)
  vars.set('_text-sec', rc.textSec)
  vars.set('_text-muted', rc.textMuted)
  vars.set('_text-faint', rc.textFaint)
  vars.set('_line', rc.line)
  vars.set('_arrow', rc.arrow)
  vars.set('_node-fill', rc.nodeFill)
  vars.set('_node-stroke', rc.nodeStroke)
  vars.set('_group-fill', rc.groupFill)
  vars.set('_group-hdr', rc.groupHdr)
  vars.set('_inner-stroke', rc.innerStroke)
  vars.set('_key-badge', rc.keyBadge)

  // `--font` is intentionally left as a live CSS variable so consumers can
  // swap the family post-render. Skip it from the color-resolution phase
  // (which exists to make non-browser SVG renderers like resvg work; resvg
  // resolves CSS-variable font-families natively against the SVG root style).
  const SKIP_VARS = new Set(['font'])
  // A var()-valued font (e.g. `--font:var(--brand-font, Georgia)`) must also
  // stay a live reference for host pages — without this the generic fallback
  // pass below would collapse it to its fallback literal. Only names that are
  // not diagram color variables are protected, so a (pathological) font like
  // 'var(--fg)' doesn't break color resolution.
  if (colors.font) {
    for (const m of colors.font.matchAll(/var\(\s*--([\w-]+)/g)) {
      if (!vars.has(m[1]!)) SKIP_VARS.add(m[1]!)
    }
  }

  const resolveCss = (input: string, definitions: ReadonlyMap<string, string>, passes: number): string => {
    let text = input
    for (let pass = 0; pass < passes; pass++) {
      const prev = text
      text = text.replace(/var\(--([\w-]+)\)/g, (match, name) => {
        if (SKIP_VARS.has(name)) return match
        return definitions.get(name) ?? match
      })
      text = text.replace(/var\(--([\w-]+),\s*([^()]+)\)/g, (match, name, fallback) => {
        if (SKIP_VARS.has(name)) return match
        return definitions.get(name) ?? fallback.trim()
      })
      text = text.replace(
        /color-mix\(in srgb,\s*(#[0-9a-fA-F]{3,8})\s+(\d+(?:\.\d+)?)%,\s*(#[0-9a-fA-F]{3,8}|transparent)\)/g,
        (_match, c1, pct, c2) => {
          const cc2 = c2 === 'transparent' ? rc.bg : c2
          return mixHex(c1, cc2, parseFloat(pct))
        },
      )
      if (text === prev) break
    }
    return text
  }

  // Resolve only actual CSS-bearing contexts. Text/title/desc and ordinary
  // data attributes are authored content, even when they happen to contain a
  // string such as `var(--fg)` or `color-mix(...)`.
  let text = transformSvgCssValues(svg, css => resolveCss(css, vars, 10))

  // Phase 2: Extract CSS variable definitions from <style> blocks and resolve
  // any remaining var() references (e.g. --xychart-color-0 defined in style)
  const cssDefs = new Map<string, string>()
  const defRegex = /--([\w-]+)\s*:\s*(#[0-9a-fA-F]{3,8})\s*;/g
  const cssText = svgCssText(text)
  let defMatch
  while ((defMatch = defRegex.exec(cssText)) !== null) {
    cssDefs.set(defMatch[1]!, defMatch[2]!)
  }

  if (cssDefs.size > 0) {
    for (let pass = 0; pass < 5; pass++) {
      const resolved = transformSvgCssValues(text, css => resolveCss(css, cssDefs, 1))
      if (resolved === text) break
      text = resolved
    }
  }

  return text
}

function isSvgOpenTagOverrides(
  value: Record<string, string> | {
    width?: string
    height?: string
    style?: string
    attrs?: Record<string, string | undefined>
  } | undefined,
): value is {
  width?: string
  height?: string
  style?: string
  attrs?: Record<string, string | undefined>
} {
  return Boolean(
    value &&
    ('width' in value || 'height' in value || 'style' in value || 'attrs' in value),
  )
}
