// ============================================================================
// One output-security policy for every SVG-producing path.
//
// Active content is rejected in every mode. Strict mode additionally rejects
// every external/fetching reference. The gate never rewrites XML: mutation can
// make malformed markup look safe or change authored text, so unsafe artifacts
// fail closed. DOM hosts must insert accepted SVG as parsed XML nodes, never via
// innerHTML.
// ============================================================================

export const OUTPUT_SECURITY_POLICY_VERSION = 2 as const
export type OutputSecurityMode = 'default' | 'strict'

export interface OutputSecurityDiagnostic {
  code: 'EXTERNAL_REFERENCE' | 'ACTIVE_CONTENT'
  reference: string
}

export interface OutputSecurityResult {
  svg: string
  diagnostics: readonly OutputSecurityDiagnostic[]
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

const ATTRIBUTE = /\s([^\s=<>]+)\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/g
const ANIMATION_TAG = /<(?:[^\s<>/:]+:)?(?:animate(?:Motion|Transform)?|set)\b/i

/** Return actual opening tags without treating escaped/textual `href=…` as
 * attributes. The output gate already rejects unbalanced markup; this scanner
 * only needs to respect quotes while finding each tag boundary. */
function startTags(markup: string): string[] {
  const tags: string[] = []
  for (let start = markup.indexOf('<'); start >= 0; start = markup.indexOf('<', start + 1)) {
    const first = markup[start + 1]
    if (!first || first === '/' || first === '!' || first === '?') continue
    if (!/[^\s<>]/.test(first)) continue
    let quote: '"' | "'" | undefined
    for (let cursor = start + 1; cursor < markup.length; cursor++) {
      const char = markup[cursor]!
      if (quote) {
        if (char === quote) quote = undefined
      } else if (char === '"' || char === "'") {
        quote = char
      } else if (char === '>') {
        tags.push(markup.slice(start, cursor + 1))
        start = cursor
        break
      }
    }
  }
  return tags
}

/** Bounded structural gate shared by backend admission and every SVG result. */
export function verifySvgDocumentEnvelope(svg: string): boolean {
  const trimmed = svg.trim()
  if (!/^<svg(?:\s|>)/.test(trimmed) || !/<\/svg>$/.test(trimmed)) return false
  if ((trimmed.match(/<svg(?:\s|>)/g) ?? []).length !== 1 || (trimmed.match(/<\/svg>/g) ?? []).length !== 1) return false
  if (/<!DOCTYPE|<\?xml/i.test(trimmed)) return false
  const withoutComments = trimmed.replace(/<!--[\s\S]*?-->/g, '')
  const stack: string[] = []
  const tag = /<\/?([A-Za-z][\w:.-]*)\b[^>]*>/g
  let cursor = 0
  for (const match of withoutComments.matchAll(tag)) {
    const index = match.index ?? 0
    if (withoutComments.slice(cursor, index).includes('<')) return false
    const token = match[0]
    const name = match[1]!
    if (token.startsWith('</')) {
      if (stack.pop() !== name) return false
    } else if (!token.endsWith('/>')) {
      stack.push(name)
    }
    cursor = index + token.length
  }
  return stack.length === 0 && !withoutComments.slice(cursor).includes('<')
}

/** XML parsers resolve character references before interpreting attributes.
 * Inspect that same value, including one layer of HTML double-encoding. */
function decodeXmlReferences(input: string): string {
  let value = input
  for (let pass = 0; pass < 3; pass++) {
    const decoded = value
      .replace(/&#x([0-9a-f]+);?/gi, (_match, hex: string) => {
        const cp = Number.parseInt(hex, 16)
        return Number.isFinite(cp) && cp <= 0x10ffff ? String.fromCodePoint(cp) : ''
      })
      .replace(/&#([0-9]+);?/g, (_match, digits: string) => {
        const cp = Number.parseInt(digits, 10)
        return Number.isFinite(cp) && cp <= 0x10ffff ? String.fromCodePoint(cp) : ''
      })
      .replace(/&colon;?/gi, ':')
      .replace(/&sol;?/gi, '/')
      .replace(/&tab;?/gi, '\t')
      .replace(/&newline;?/gi, '\n')
      .replace(/&quot;?/gi, '"')
      .replace(/&apos;?/gi, "'")
      .replace(/&lt;?/gi, '<')
      .replace(/&gt;?/gi, '>')
      .replace(/&amp;?/gi, '&')
    if (decoded === value) break
    value = decoded
  }
  return value
}

function unquoteAttribute(value: string): string {
  const quote = value[0]
  return (quote === '"' || quote === "'") && value[value.length - 1] === quote
    ? value.slice(1, -1)
    : value
}

function normalizedReference(value: string): string {
  return decodeXmlReferences(value)
    .replace(/[\u0000-\u0020\u007f-\u009f]+/g, '')
    .toLowerCase()
}

function isUnsafeReference(value: string): boolean {
  const normalized = normalizedReference(value)
  // Only same-document fragments are inert in an SVG imported into a host
  // document. Absolute, protocol-relative, root-relative, and path-relative
  // values can all fetch or navigate once the XML is attached to a DOM.
  return normalized !== '' && !normalized.startsWith('#')
}

function unsafeCssReferences(value: string): string[] {
  const scan = normalizeCssObfuscation(decodeXmlReferences(value))
  const refs: string[] = []
  if (/@import\b/i.test(scan)) refs.push('@import')
  for (const match of scan.matchAll(/url\s*\(\s*(["']?)([\s\S]*?)\1\s*\)/gi)) {
    const reference = normalizedReference(match[2]!)
    if (reference !== '' && !reference.startsWith('#')) refs.push(`url(${match[2]!.trim()})`)
  }
  for (const match of scan.matchAll(/(?:-webkit-)?(?:image-set|cross-fade)\s*\(/gi)) {
    refs.push(`${match[0].slice(0, -1).trim()}()`)
  }
  return refs
}

function isActiveReference(value: string): boolean {
  return /^(?:javascript|vbscript|data|file):/.test(normalizedReference(value))
}

function unsafeActiveCss(value: string): boolean {
  const scan = normalizeCssObfuscation(decodeXmlReferences(value))
  if (/(?:expression|behavior)\s*\(|-moz-binding\s*:/i.test(scan)) return true
  if (/(?:javascript|vbscript|data|file)\s*:/i.test(scan)) return true
  return false
}

function unsafeCssOrAnimatedValue(value: string): boolean {
  const scan = normalizeCssObfuscation(decodeXmlReferences(value))
  return unsafeCssReferences(scan).length > 0
    || /(?:javascript|vbscript|data|file)\s*:/i.test(scan)
    || /(?:expression|behavior)\s*\(/i.test(scan)
}

const CSS_VALUE_ATTRIBUTES = new Set([
  'clip-path', 'cursor', 'fill', 'filter', 'marker-end', 'marker-mid',
  'marker-start', 'mask', 'stroke', 'style',
])

/** Raw Mermaid themeCSS is compatibility input, not a safe extensibility API. */
export function validateRawThemeCss(value: unknown, mode: OutputSecurityMode): string | undefined {
  if (value === undefined || value === '') return undefined
  if (typeof value !== 'string') return 'Mermaid themeCSS must be a string'
  return `Raw Mermaid themeCSS is not allowed in ${mode} security mode because selectors can escape an imported SVG; use a declarative StyleSpec`
}

function attributeSecurityFindings(svg: string): string[] {
  const refs: string[] = []
  for (const tag of startTags(svg)) {
    for (const match of tag.matchAll(new RegExp(ATTRIBUTE.source, 'g'))) {
      const qualified = match[1]!
      const name = qualified.slice(qualified.lastIndexOf(':') + 1).toLowerCase()
      const value = unquoteAttribute(match[2]!)
      if (/^on[a-z]/.test(name)) refs.push('inline-event-handler')
      if ((name === 'href' || name === 'src' || name === 'data') && isUnsafeReference(value)) {
        refs.push(normalizedReference(value).startsWith('javascript:') ? 'javascript-url' : value)
      }
      if ((CSS_VALUE_ATTRIBUTES.has(name) || name === 'values' || name === 'from' || name === 'to') && unsafeCssOrAnimatedValue(value)) {
        refs.push(`${qualified}=${value}`)
      }
    }
  }
  return refs
}

function activeContentFindings(svg: string): string[] {
  const markup = svg.replace(/<!--[\s\S]*?-->/g, '')
  const refs: string[] = []
  for (const tag of startTags(markup)) {
    for (const match of tag.matchAll(new RegExp(ATTRIBUTE.source, 'g'))) {
      const qualified = match[1]!
      const name = qualified.slice(qualified.lastIndexOf(':') + 1).toLowerCase()
      const value = unquoteAttribute(match[2]!)
      if (/^on[a-z]/.test(name)) refs.push('inline-event-handler')
      if ((name === 'href' || name === 'src' || name === 'data') && isActiveReference(value)) refs.push(`${qualified}=${value}`)
      if ((CSS_VALUE_ATTRIBUTES.has(name) || name === 'values' || name === 'from' || name === 'to') && unsafeActiveCss(value)) refs.push(`${qualified}=${value}`)
    }
  }
  // Character references are decoded inside attribute values and CSS, where
  // the XML/CSS consumers interpret them. Do not decode the complete document:
  // escaped label text such as `&lt;script&gt;` remains text in XML and must not
  // be mistaken for a structural element.
  for (const style of markup.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)) {
    if (unsafeActiveCss(style[1]!)) refs.push('active-css')
  }
  if (/<(?:[^\s<>/:]+:)?script\b/i.test(markup)) refs.push('<script>')
  if (/<(?:[^\s<>/:]+:)?foreignObject\b/i.test(markup)) refs.push('<foreignObject>')
  if (/<(?:[^\s<>/:]+:)?object\b/i.test(markup)) refs.push('<object>')
  if (/<(?:[^\s<>/:]+:)?embed\b/i.test(markup)) refs.push('<embed>')
  if (/<(?:[^\s<>/:]+:)?iframe\b/i.test(markup)) refs.push('<iframe>')
  if (ANIMATION_TAG.test(markup)) refs.push('<animation>')
  return refs
}

export function verifyNoExternalRefs(svg: string): { ok: boolean; refs: string[] } {
  const markup = svg.replace(/<!--[\s\S]*?-->/g, '')
  const refs: string[] = attributeSecurityFindings(markup)
  for (const style of markup.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)) {
    refs.push(...unsafeCssReferences(style[1]!))
  }
  if (/<(?:[^\s<>/:]+:)?script\b/i.test(markup)) refs.push('<script>')
  if (/<(?:[^\s<>/:]+:)?foreignObject\b/i.test(markup)) refs.push('<foreignObject>')
  if (/<(?:[^\s<>/:]+:)?image\b/i.test(markup)) refs.push('<image>')
  if (/<(?:[^\s<>/:]+:)?object\b/i.test(markup)) refs.push('<object>')
  if (/<(?:[^\s<>/:]+:)?embed\b/i.test(markup)) refs.push('<embed>')
  if (/<(?:[^\s<>/:]+:)?iframe\b/i.test(markup)) refs.push('<iframe>')
  if (ANIMATION_TAG.test(markup)) refs.push('<animation>')
  return { ok: refs.length === 0, refs }
}

export function applyOutputSecurityPolicy(svg: string, mode: OutputSecurityMode = 'default'): OutputSecurityResult {
  if (!verifySvgDocumentEnvelope(svg)) {
    throw new Error('OutputSecurityPolicy rejected an invalid SVG document envelope')
  }
  const active = activeContentFindings(svg)
  if (active.length > 0) {
    throw new Error(`OutputSecurityPolicy rejected active content: ${active.join(', ')}`)
  }
  const scan = verifyNoExternalRefs(svg)
  if (mode === 'strict' && !scan.ok) {
    throw new Error(`OutputSecurityPolicy strict verification failed: ${scan.refs.join(', ')}`)
  }
  return {
    svg,
    diagnostics: mode === 'strict' ? [] : scan.refs.map(reference => ({
      code: 'EXTERNAL_REFERENCE' as const,
      reference,
    })),
  }
}
