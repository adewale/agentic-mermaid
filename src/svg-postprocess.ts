import { formatSvgNumericAttribute, SVG_LONG_DECIMAL } from './shared/svg-number.ts'
import { scanSvgStartTags, transformSvgAttributes, transformSvgCssValues } from './svg-structure.ts'

/** Fallback for opaque family and extension SVG. Typed writers format their
 * own numeric fields before serialization, so ordinary native output skips
 * the lexical scan. Authored text and IDs are never numeric fields. */
export function formatSvgNumbers(svg: string): string {
  if (!SVG_LONG_DECIMAL.test(svg)) return svg
  return transformSvgAttributes(svg, ({ name, value }) => formatSvgNumericAttribute(name, value))
}

/**
 * Post-process an SVG string into compact form:
 *  - Whitespace containing a newline between complete element tags collapses
 *    load-bearing, and inside text-bearing/accessibility elements. Newlines
 *    inside tags, attributes, quoted values, and authored text are retained;
 *    compaction changes serialization only, never geometry or semantic data.
 *  - `data-*` attributes and `class=` attributes survive — they're agent
 *    inspection hooks (Loop 7 audit).
 *
 * Determinism: pure function of the input string. Safe to apply to any SVG
 * the renderer produces; idempotent on already-compact input.
 */
export function compactSvg(svg: string): string {
  // Protect every XML region where whitespace is data. Text descendants cover
  // tspans/textPaths; title/desc are the accessibility payload; metadata and
  // style may contain arbitrary formats. Only indentation between tags in the
  // remaining structural segments is removable.
  const PROTECTED_BLOCK_RE = /<((?:[A-Za-z_][\w.-]*:)?(?:style|text|title|desc|metadata))\b[\s\S]*?<\/\1>/gi
  const parts: string[] = []
  // Collapse only indentation between complete tags. Replacing whitespace
  // inside tags could turn an inert `on\n load` pair into an event handler.
  const plain = (text: string) => text.replace(/>\s*\r?\n\s*</g, '><')
  let last = 0
  let m: RegExpExecArray | null
  while ((m = PROTECTED_BLOCK_RE.exec(svg)) !== null) {
    if (m.index > last) parts.push(plain(svg.slice(last, m.index)))
    parts.push(m[0])
    last = m.index + m[0].length
  }
  if (last < svg.length) parts.push(plain(svg.slice(last)))
  return parts.join('')
}

/**
 * #7540: namespace every SVG def id and its `url(#…)` references with a prefix,
 * so multiple diagrams rendered onto one HTML page don't collide on shared def
 * ids (`arrowhead`, `bm-shadow`, etc.). Node/subgraph groups use `data-id`, not
 * `id`, so this only touches defs/markers/filters — exactly the colliding set.
 *
 * Pure string rewrite, deterministic. Idempotent only if the prefix isn't
 * already applied (callers pass a fresh prefix per diagram). Skips the xmlns
 * and any id that already starts with the prefix.
 */
export function namespaceSvgIds(svg: string, prefix: string): string {
  if (!/^[A-Za-z0-9_.:-]+$/.test(prefix)) {
    throw new Error('idPrefix must be non-empty and contain only ASCII letters, digits, underscore, hyphen, dot, and colon')
  }
  // Collect declared ids so we only rewrite refs that point at our defs
  // (never an accidental `url(#…)` inside escaped label text).
  const declared = new Set<string>()
  for (const tag of scanSvgStartTags(svg)) {
    for (const attribute of tag.attributes) {
      if (attribute.name === 'id') declared.add(attribute.value)
    }
  }
  const namespaced = (id: string) => id.startsWith(prefix) ? id : `${prefix}${id}`
  const attributes = transformSvgAttributes(svg, attribute => {
    if (attribute.name === 'id') return namespaced(attribute.value)
    if (attribute.name === 'aria-labelledby' || attribute.name === 'aria-describedby') {
      return attribute.value.split(/\s+/).map(id => declared.has(id) ? namespaced(id) : id).join(' ')
    }
    if ((attribute.name === 'href' || attribute.name === 'xlink:href') && attribute.value.startsWith('#')) {
      const id = attribute.value.slice(1)
      return declared.has(id) ? `#${namespaced(id)}` : attribute.value
    }
    return undefined
  })
  return transformSvgCssValues(attributes, css =>
    css.replace(/url\(#([^)]+)\)/g, (full, id: string) => declared.has(id) ? `url(#${namespaced(id)})` : full))
}

