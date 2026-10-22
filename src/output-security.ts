// ============================================================================
// One output-security policy for every SVG-producing path.
//
// Active content is rejected in every mode. Strict mode additionally rejects
// every external/fetching reference. The gate never rewrites XML: mutation can
// make malformed markup look safe or change authored text, so unsafe artifacts
// fail closed. DOM hosts must insert accepted SVG as parsed XML nodes, never via
// innerHTML.
// ============================================================================

import { inspectSvgOnce } from './svg-inspection-cache.ts'

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

export function normalizeCssObfuscation(svg: string): string {
  return svg
    .replace(/\/\*[\s\S]*?\*\//g, '')
    // CSS removes a backslash followed by a physical line break before it
    // tokenizes identifiers. Decode that continuation first so active schemes
    // cannot be split into apparently unrelated words such as `jav\\\nascript`.
    .replace(/\\(?:\r\n|[\n\r\f])/g, '')
    .replace(/\\([0-9a-fA-F]{1,6})\s?/g, (_, hex: string) => {
      const cp = Number.parseInt(hex, 16)
      return Number.isFinite(cp) ? String.fromCodePoint(cp) : ''
    })
    .replace(/\\([^\n\r\f])/g, '$1')
}

/** Marker CSS would create a second authority beside typed connector markers. */
export function hasMarkerCss(value: string): boolean {
  return /(?:^|;)\s*marker(?:-(?:start|mid|end))?\s*:/i.test(normalizeCssObfuscation(value))
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

const XML_NAMED_REFERENCES = new Set(['amp', 'lt', 'gt', 'quot', 'apos'])

function isXmlWhitespace(char: string | undefined): boolean {
  return char === ' ' || char === '\t' || char === '\n' || char === '\r'
}

function isXmlNameStart(char: string | undefined): boolean {
  if (char === undefined) return false
  const code = char.charCodeAt(0)
  return (code >= 65 && code <= 90) || (code >= 97 && code <= 122) || code === 95
}

function isXmlNameChar(char: string | undefined): boolean {
  if (char === undefined) return false
  const code = char.charCodeAt(0)
  return (code >= 65 && code <= 90) || (code >= 97 && code <= 122)
    || (code >= 48 && code <= 57) || code === 95 || code === 46 || code === 58 || code === 45
}

function readXmlName(source: string, start: number): { name: string; end: number } | undefined {
  if (!isXmlNameStart(source[start])) return undefined
  let end = start + 1
  while (isXmlNameChar(source[end])) end++
  return { name: source.slice(start, end), end }
}

interface XmlQualifiedName {
  readonly prefix?: string
  readonly local: string
}

/** The admitted serializer subset uses ASCII XML names. Enforce QName shape
 * separately from the lexical name scanner so a colon cannot appear more than
 * once or at either edge. */
function parseXmlQualifiedName(name: string): XmlQualifiedName | undefined {
  const parts = name.split(':')
  if (parts.length === 1) return { local: parts[0]! }
  if (parts.length !== 2 || !parts[0] || !parts[1]) return undefined
  return { prefix: parts[0], local: parts[1] }
}

const XML_NAMESPACE = 'http://www.w3.org/XML/1998/namespace'
const XMLNS_NAMESPACE = 'http://www.w3.org/2000/xmlns/'
const SVG_NAMESPACE = 'http://www.w3.org/2000/svg'

interface XmlElementFrame {
  readonly name: string
  readonly namespaces: ReadonlyMap<string, string>
}

function isAllowedXmlCodePoint(codePoint: number): boolean {
  return codePoint === 0x9 || codePoint === 0xa || codePoint === 0xd
    || (codePoint >= 0x20 && codePoint <= 0xd7ff)
    || (codePoint >= 0xe000 && codePoint <= 0xfffd)
    || (codePoint >= 0x10000 && codePoint <= 0x10ffff)
}

function hasOnlyXmlCharacters(source: string): boolean {
  for (let index = 0; index < source.length; index++) {
    const codePoint = source.codePointAt(index)!
    if (!isAllowedXmlCodePoint(codePoint)) return false
    if (codePoint > 0xffff) index++
  }
  return true
}

/** DTDs are prohibited, so only XML's five predefined names and numeric
 * references are legal. This rejects a bare `&` before any DOM can repair it. */
function hasWellFormedXmlReferences(source: string): boolean {
  for (let index = source.indexOf('&'); index >= 0; index = source.indexOf('&', index + 1)) {
    const semicolon = source.indexOf(';', index + 1)
    if (semicolon < 0) return false
    const reference = source.slice(index + 1, semicolon)
    if (reference.startsWith('#x') || reference.startsWith('#X')) {
      if (!/^[0-9a-f]+$/i.test(reference.slice(2))) return false
      if (!isAllowedXmlCodePoint(Number.parseInt(reference.slice(2), 16))) return false
    } else if (reference.startsWith('#')) {
      if (!/^[0-9]+$/.test(reference.slice(1))) return false
      if (!isAllowedXmlCodePoint(Number.parseInt(reference.slice(1), 10))) return false
    } else if (!XML_NAMED_REFERENCES.has(reference)) {
      return false
    }
    index = semicolon
  }
  return true
}

/** Linear, dependency-free XML well-formedness gate shared by backend
 * admission and every final SVG result. It deliberately accepts only the
 * bounded XML subset an SVG serializer needs: one paired `<svg>` root,
 * quoted attributes, no DTD/processing instructions, balanced tags, valid
 * characters/references, and no duplicate attributes. */
export function verifySvgDocumentEnvelope(svg: string): boolean {
  return inspectSvgOnce('xml-envelope', svg, () => verifyDocumentEnvelope(svg))
}

function verifyDocumentEnvelope(svg: string, observeAttribute?: (name: string, rawValue: string) => void): boolean {
  if (!hasOnlyXmlCharacters(svg)) return false
  const stack: XmlElementFrame[] = []
  let rootSeen = false
  let rootClosed = false
  let cursor = 0

  while (cursor < svg.length) {
    if (svg[cursor] !== '<') {
      const boundary = svg.indexOf('<', cursor)
      const end = boundary < 0 ? svg.length : boundary
      const text = svg.slice(cursor, end)
      if ((stack.length === 0 && text.trim() !== '')
        || text.includes(']]>')
        || !hasWellFormedXmlReferences(text)) return false
      cursor = end
      continue
    }

    if (svg.startsWith('<!--', cursor)) {
      if (stack.length === 0) return false
      const end = svg.indexOf('-->', cursor + 4)
      const content = end < 0 ? '' : svg.slice(cursor + 4, end)
      if (end < 0 || content.includes('--') || content.endsWith('-')) return false
      cursor = end + 3
      continue
    }
    // First-party serializers do not need CDATA. Excluding it keeps the
    // security scanner and XML parser on one text model: a fake `</style>`
    // inside CDATA cannot truncate the later CSS-reference scan.
    if (svg.startsWith('<![CDATA[', cursor)) return false
    if (svg.startsWith('<!', cursor) || svg.startsWith('<?', cursor)) return false

    if (svg.startsWith('</', cursor)) {
      const parsed = readXmlName(svg, cursor + 2)
      if (!parsed || !parseXmlQualifiedName(parsed.name)) return false
      let end = parsed.end
      while (isXmlWhitespace(svg[end])) end++
      if (svg[end] !== '>' || stack.pop()?.name !== parsed.name) return false
      cursor = end + 1
      if (stack.length === 0) {
        if (parsed.name !== 'svg' || rootClosed) return false
        rootClosed = true
      }
      continue
    }

    const parsed = readXmlName(svg, cursor + 1)
    const elementName = parsed && parseXmlQualifiedName(parsed.name)
    if (!parsed || !elementName || rootClosed) return false
    if (stack.length === 0) {
      if (rootSeen || parsed.name !== 'svg') return false
      rootSeen = true
    }

    let end = parsed.end
    const rawAttributes = new Set<string>()
    const attributes: Array<{ readonly name: string; readonly qname: XmlQualifiedName; readonly value: string }> = []
    let selfClosing = false
    for (;;) {
      const hadWhitespace = isXmlWhitespace(svg[end])
      while (isXmlWhitespace(svg[end])) end++
      if (svg[end] === '>') { end++; break }
      if (svg[end] === '/' && svg[end + 1] === '>') {
        selfClosing = true
        end += 2
        break
      }
      if (!hadWhitespace) return false
      const attribute = readXmlName(svg, end)
      const attributeName = attribute && parseXmlQualifiedName(attribute.name)
      if (!attribute || !attributeName || rawAttributes.has(attribute.name)) return false
      rawAttributes.add(attribute.name)
      end = attribute.end
      while (isXmlWhitespace(svg[end])) end++
      if (svg[end] !== '=') return false
      end++
      while (isXmlWhitespace(svg[end])) end++
      const quote = svg[end]
      if (quote !== '"' && quote !== "'") return false
      const valueStart = ++end
      while (end < svg.length && svg[end] !== quote) {
        if (svg[end] === '<') return false
        end++
      }
      if (end >= svg.length) return false
      const value = svg.slice(valueStart, end)
      if (!hasWellFormedXmlReferences(value)) return false
      attributes.push({ name: attribute.name, qname: attributeName, value: decodeXmlReferences(value) })
      observeAttribute?.(attribute.name, value)
      end++
    }

    const namespaces = new Map(stack.at(-1)?.namespaces ?? [
      ['xml', XML_NAMESPACE],
    ])
    for (const attribute of attributes) {
      const isDefaultDeclaration = attribute.name === 'xmlns'
      const isPrefixedDeclaration = attribute.qname.prefix === 'xmlns'
      if (!isDefaultDeclaration && !isPrefixedDeclaration) continue
      const prefix = isDefaultDeclaration ? '' : attribute.qname.local
      const uri = attribute.value
      if (prefix === 'xmlns'
        || uri === XMLNS_NAMESPACE
        || (prefix === 'xml' && uri !== XML_NAMESPACE)
        || (prefix !== 'xml' && uri === XML_NAMESPACE)
        || (prefix !== '' && uri === '')) return false
      namespaces.set(prefix, uri)
    }

    if (elementName.prefix === 'xmlns') return false
    const elementNamespace = elementName.prefix === undefined
      ? (namespaces.get('') ?? '')
      : namespaces.get(elementName.prefix)
    if (elementNamespace === undefined) return false
    // One deliberately small serializer subset: every element is an
    // unprefixed SVG element. Namespaced attributes (xml/xlink/extension
    // metadata) remain available, but prefixed or namespace-reset elements
    // cannot bypass local-name security checks or render differently by host.
    if (elementName.prefix !== undefined || elementNamespace !== SVG_NAMESPACE) return false
    if (stack.length > 0 && elementName.local === 'svg' && elementNamespace === SVG_NAMESPACE) {
      // Preserve the established single-SVG-document contract; nested SVG
      // roots are not part of the admitted backend serialization subset.
      return false
    }

    const expandedAttributes = new Set<string>()
    for (const attribute of attributes) {
      if (attribute.name === 'xmlns' || attribute.qname.prefix === 'xmlns') continue
      const namespace = attribute.qname.prefix === undefined
        ? ''
        : namespaces.get(attribute.qname.prefix)
      if (namespace === undefined || attribute.qname.prefix === 'xmlns') return false
      const expanded = `${namespace}\u0000${attribute.qname.local}`
      if (expandedAttributes.has(expanded)) return false
      expandedAttributes.add(expanded)
    }

    cursor = end
    if (selfClosing) {
      if (stack.length === 0) return false
    } else {
      stack.push({ name: parsed.name, namespaces })
    }
  }

  return rootSeen && rootClosed && stack.length === 0
}

/** XML parsers resolve character references before interpreting attributes.
 * Inspect that same value, including one layer of HTML double-encoding. */
function decodeXmlReferences(input: string): string {
  if (!input.includes('&')) return input
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

/** Classify inert action hrefs using the same iterative XML-reference and
 * control-whitespace normalization as the SVG output-security gate. */
export function isSafeActionHref(value: string): boolean {
  const decoded = decodeXmlReferences(value)
  // Action records retain the authored href for non-SVG hosts. Removing a
  // control solely for scheme classification would label an OSC/DCS-bearing
  // payload safe while still handing the original bytes to a TUI consumer.
  if (/[\u0000-\u001f\u007f-\u009f]/.test(decoded)) return false
  const normalized = decoded.replace(/ +/g, '').toLowerCase().trim()
  if (/^(?:https?:|mailto:)/.test(normalized)) return true
  if (/^[a-z][a-z0-9+.-]*:/.test(normalized)) return false
  return normalized.length > 0
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

interface SecurityFindings {
  readonly active: readonly string[]
  readonly refs: readonly string[]
}

function securityFindings(svg: string): SecurityFindings {
  return inspectSvgOnce('security', svg, () => inspectSecurity(svg))
}

function inspectAttributeSecurity(qualified: string, value: string, refs: string[], active: string[]): void {
  const name = qualified.slice(qualified.lastIndexOf(':') + 1).toLowerCase()
  if (/^on[a-z]/.test(name)) { refs.push('inline-event-handler'); active.push('inline-event-handler') }
  // A fragment is same-document only in the absence of XML Base. With an
  // external xml:base, href="#mark" and url(#mark) resolve against that
  // external document and can fetch after DOM insertion. Reject the base
  // semantic itself so every local-reference check below remains sound.
  if (qualified.toLowerCase() === 'xml:base') refs.push(`xml:base=${value}`)
  if ((name === 'href' || name === 'src' || name === 'data') && isUnsafeReference(value)) {
    refs.push(normalizedReference(value).startsWith('javascript:') ? 'javascript-url' : value)
  }
  if ((name === 'href' || name === 'src' || name === 'data') && isActiveReference(value)) active.push(`${qualified}=${value}`)
  if ((CSS_VALUE_ATTRIBUTES.has(name) || name === 'values' || name === 'from' || name === 'to') && unsafeCssOrAnimatedValue(value)) {
    refs.push(`${qualified}=${value}`)
  }
  if ((CSS_VALUE_ATTRIBUTES.has(name) || name === 'values' || name === 'from' || name === 'to') && unsafeActiveCss(value)) active.push(`${qualified}=${value}`)
}

function inspectSecurity(svg: string): SecurityFindings {
  const markup = svg.replace(/<!--[\s\S]*?-->/g, '')
  const refs: string[] = []
  const active: string[] = []
  for (const tag of startTags(markup)) {
    for (const match of tag.matchAll(new RegExp(ATTRIBUTE.source, 'g'))) {
      inspectAttributeSecurity(match[1]!, unquoteAttribute(match[2]!), refs, active)
    }
  }
  return inspectSecurityTail(markup, refs, active)
}

function inspectSecurityTail(markup: string, refs: string[], active: string[]): SecurityFindings {
  // Character references are decoded inside attribute values and CSS, where
  // the XML/CSS consumers interpret them. Do not decode the complete document:
  // escaped label text such as `&lt;script&gt;` remains text in XML and must not
  // be mistaken for a structural element.
  for (const style of markup.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)) {
    if (unsafeActiveCss(style[1]!)) active.push('active-css')
    refs.push(...unsafeCssReferences(style[1]!))
  }
  for (const tag of ['script', 'foreignObject', 'image', 'object', 'embed', 'iframe']) {
    if (new RegExp(`<(?:[^\\s<>/:]+:)?${tag}\\b`, 'i').test(markup)) {
      refs.push(`<${tag}>`)
      if (tag !== 'image') active.push(`<${tag}>`)
    }
  }
  if (ANIMATION_TAG.test(markup)) { refs.push('<animation>'); active.push('<animation>') }
  return Object.freeze({ active: Object.freeze(active), refs: Object.freeze(refs) })
}

export function verifyNoExternalRefs(svg: string): { ok: boolean; refs: string[] } {
  const { refs } = securityFindings(svg)
  return { ok: refs.length === 0, refs: [...refs] }
}

function inspectFinalSvg(svg: string): { readonly valid: false } | { readonly valid: true; readonly findings: SecurityFindings } {
  return inspectSvgOnce('final-security', svg, () => {
    const refs: string[] = []
    const active: string[] = []
    let failed = false
    let failure: unknown
    const valid = verifyDocumentEnvelope(svg, (name, rawValue) => {
      if (failed) return
      try {
        inspectAttributeSecurity(name, rawValue, refs, active)
      } catch (error) {
        // Finish XML validation before surfacing security errors: malformed
        // envelopes have always taken precedence, including invalid CSS escapes.
        failed = true
        failure = error
      }
    })
    if (!valid) return { valid: false }
    if (failed) throw failure
    return { valid: true, findings: inspectSecurityTail(svg.replace(/<!--[\s\S]*?-->/g, ''), refs, active) }
  })
}

export function applyOutputSecurityPolicy(svg: string, mode: OutputSecurityMode = 'default'): OutputSecurityResult {
  const inspection = inspectFinalSvg(svg)
  if (!inspection.valid) {
    throw new Error('OutputSecurityPolicy rejected an invalid SVG document envelope')
  }
  const { active, refs } = inspection.findings
  if (active.length > 0) {
    throw new Error(`OutputSecurityPolicy rejected active content: ${active.join(', ')}`)
  }
  if (mode === 'strict' && refs.length) {
    throw new Error(`OutputSecurityPolicy strict verification failed: ${refs.join(', ')}`)
  }
  return {
    svg,
    diagnostics: mode === 'strict' ? [] : refs.map(reference => ({
      code: 'EXTERNAL_REFERENCE' as const,
      reference,
    })),
  }
}
