// The one SVG normaliser for test comparisons.
//
// Golden snapshots compare with the default (whitespace-only) form: CRLF is
// folded to LF, trailing spaces are dropped per line, and the document is
// trimmed, so an editor's line endings or a final newline never turns a golden
// red while every byte of geometry, paint and text still counts.
//
// `stripPaint` additionally removes paint so two renders can be compared on
// geometry alone (property-invariance-colour.test.ts): presentation attributes
// and CSS declarations for fill/stroke/color/stop-color/flood-color/lighting-
// color/background, the colour custom properties (`--bg`, `--_line`, …), sankey's
// light/dark `mix-blend-mode`, CSS rules left empty by that, the number on
// palette-slot classes, the palette page backdrop rect, whose only geometry is
// the canvas size the root element already carries, and the root style-scope
// class (svg-style-scope.ts), a hash of the whole output that paint changes.

export interface NormalizeSvgOptions {
  /** Drop paint-only attributes, declarations and elements. Default: false. */
  stripPaint?: boolean
}

const PAINT_PROPERTIES = new Set([
  'fill',
  'stroke',
  'color',
  'stop-color',
  'flood-color',
  'lighting-color',
  'background',
  'background-color',
  'mix-blend-mode',
])

function isPaintProperty(property: string): boolean {
  const name = property.toLowerCase()
  // `--font` names the typeface, not a colour, so it survives the strip.
  return (name.startsWith('--') && name !== '--font') || PAINT_PROPERTIES.has(name)
}

/** Remove paint declarations from CSS text (a `<style>` body or a style attribute). */
function stripCssPaint(css: string): string {
  return css.replace(/(?<=^|[;{\s])([-\w]+)\s*:[^;{}]*;?/g, (declaration, property: string) =>
    isPaintProperty(property) ? '' : declaration,
  )
}

/** Paint-only rules (one per series colour, say) become empty; drop them, innermost first. */
function dropEmptyCssRules(css: string): string {
  let previous: string
  let current = css
  do {
    previous = current
    current = current.replace(/[^{};\n]*\{\s*\}[ \t]*\n?/g, '')
  } while (current !== previous)
  return current
}

// Numbered classes that index a series palette: their number follows the
// palette's length, not the diagram (mindmap `depth-N` is structure and stays).
const PALETTE_SLOT_CLASS = /^((?:xychart-color|journey-actor|journey-section(?:-band|-label)?)-)\d+$/

// The root style scope hashes the unscoped SVG, paint included, so any colour
// change renames it; it is an identifier, not geometry.
const STYLE_SCOPE_CLASS = /\bam-[0-9a-z]{14}\b/g

function stripSvgPaint(svg: string): string {
  return svg
    .replace(/<style>([\s\S]*?)<\/style>/g, (_block, css: string) => `<style>${dropEmptyCssRules(stripCssPaint(css))}</style>`)
    .replace(/\n?[ \t]*<rect\b[^>]*\bdata-backdrop="page"[^>]*\/>/g, '')
    .replace(/\s(?:fill|stroke|color|stop-color|flood-color|lighting-color)="[^"]*"/g, '')
    .replace(/\sstyle="([^"]*)"/g, (_attr, css: string) => {
      const kept = stripCssPaint(css).split(';').map(part => part.trim()).filter(Boolean).join(';')
      return kept ? ` style="${kept}"` : ''
    })
    .replace(/\sclass="([^"]*)"/g, (_attr, classes: string) =>
      ` class="${classes.split(' ').map(name => name.replace(PALETTE_SLOT_CLASS, '$1#')).join(' ')}"`,
    )
    .replace(STYLE_SCOPE_CLASS, 'am-scope')
}

export function normalizeSvg(svg: string, options: NormalizeSvgOptions = {}): string {
  const text = options.stripPaint ? stripSvgPaint(svg) : svg
  return text
    .replaceAll('\r\n', '\n')
    .split('\n')
    .map(line => line.trimEnd())
    .join('\n')
    .trim()
}
