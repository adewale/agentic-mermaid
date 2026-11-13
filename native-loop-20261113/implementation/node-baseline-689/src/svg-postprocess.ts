import { formatSvgNumericAttribute, SVG_LONG_DECIMAL } from './shared/svg-number.ts'
import { projectSvgCss, scanSvgStartTags, transformSvgAttributes, transformSvgCssValues } from './svg-structure.ts'
import { decodeXML } from 'entities'
import { escapeAttr } from './multiline-utils.ts'

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
 * Existing prefixed IDs retain their names. Reserve every natural target
 * before allocating collision suffixes, including unresolved reference names
 * so a missing resource cannot accidentally acquire a target. XML entities
 * are interpreted once, while authored text and data identities remain inert.
 */
export function namespaceSvgIds(svg: string, prefix: string): string {
  if (!/^[A-Za-z0-9_.:-]+$/.test(prefix)) {
    throw new Error('idPrefix must be non-empty and contain only ASCII letters, digits, underscore, hyphen, dot, and colon')
  }
  const attributeValue = (raw: string) => decodeXML(raw.replace(/\r\n?/g, '\n').replace(/[\t\n]/g, ' '))
  const urls = (css: string, attribute: boolean, rename: (id: string) => string | undefined): string => {
    const rewrite = (source: string, cdata: boolean): string => {
      const value = cdata ? source : attribute ? attributeValue(source) : decodeXML(source.replace(/\r\n?/g, '\n'))
      const rewritten = value.replace(/url\((?:"[^"]*"|'[^']*'|[^)]*)\)/gi, raw => {
        const match = /^url\(\s*(?:"#([^"]*)"|'#([^']*)'|#([^\s)]+))\s*\)$/i.exec(raw)
        if (!match) return raw
        const id = (match[1] ?? match[2] ?? match[3])!, target = rename(id)
        if (target === undefined || target === id) return raw
        const start = raw.indexOf('#') + 1
        return raw.slice(0, start) + target + raw.slice(start + id.length)
      })
      return rewritten === value ? source : cdata ? rewritten : escapeAttr(rewritten)
    }
    // CSS in CDATA has literal ampersands; ordinary XML character data and
    // attributes expand entities before CSS tokenization, including function
    // names and quote delimiters. XML comments are not CSS character data.
    // Unchanged segments retain their raw bytes.
    if (attribute) return rewrite(css, false)
    const parts: string[] = []
    let end = 0
    for (const match of css.matchAll(/<!\[CDATA\[([\s\S]*?)\]\]>|<!--[\s\S]*?-->/g)) {
      parts.push(rewrite(css.slice(end, match.index), false), match[1] === undefined ? match[0] : `<![CDATA[${rewrite(match[1], true)}]]>`)
      end = match.index + match[0].length
    }
    parts.push(rewrite(css.slice(end), false))
    return parts.join('')
  }
  const tags = scanSvgStartTags(svg)
  const declared = new Set<string>()
  for (const tag of tags) {
    for (const attribute of tag.attributes) {
      if (attribute.name === 'id') declared.add(attributeValue(attribute.value))
    }
  }
  const missing = new Set<string>()
  const reference = (id: string): undefined => { if (!declared.has(id)) missing.add(id) }
  for (const tag of tags) for (const attribute of tag.attributes) {
    const value = attributeValue(attribute.value)
    if (attribute.name === 'aria-labelledby' || attribute.name === 'aria-describedby') {
      for (const id of value.match(/[^\t\n\r ]+/g) ?? []) reference(id)
    } else if ((attribute.name === 'href' || attribute.name === 'xlink:href') && value.startsWith('#')) reference(value.slice(1))
  }
  for (const range of projectSvgCss(svg).cssRanges) urls(svg.slice(range.start, range.end), svg[range.start - 1] === '"' || svg[range.start - 1] === "'", reference)
  const base = (id: string) => id.startsWith(prefix) ? id : `${prefix}${id}`
  const reserved = new Set([...declared].map(base))
  for (const id of missing) reserved.add(id)
  const names = new Map<string, string>()
  for (const id of declared) {
    let target = base(id)
    if (!id.startsWith(prefix) && (declared.has(target) || missing.has(target))) {
      let suffix = 1
      while (reserved.has(`${target}-${suffix}`)) suffix++
      target = `${target}-${suffix}`
    }
    reserved.add(target)
    names.set(id, target)
  }
  const attributes = transformSvgAttributes(svg, attribute => {
    const value = attributeValue(attribute.value)
    let rewritten: string | undefined
    if (attribute.name === 'id') rewritten = names.get(value)
    if (attribute.name === 'aria-labelledby' || attribute.name === 'aria-describedby') {
      rewritten = value.replace(/[^\t\n\r ]+/g, id => names.get(id) ?? id)
    }
    if ((attribute.name === 'href' || attribute.name === 'xlink:href') && value.startsWith('#')) {
      const target = names.get(value.slice(1))
      if (target !== undefined) rewritten = `#${target}`
    }
    return rewritten !== undefined && rewritten !== value ? escapeAttr(rewritten) : undefined
  })
  return transformSvgCssValues(attributes, (css, range) => urls(css, attributes[range.start - 1] === '"' || attributes[range.start - 1] === "'", id => names.get(id)))
}

