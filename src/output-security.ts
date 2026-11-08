import { writtenTagOf } from './svg-writer-evidence.ts'
// ============================================================================
// One output-security policy for every SVG-producing path.
//
// Active content is rejected in every mode. Strict mode additionally rejects
// every external/fetching reference. The gate never rewrites XML: mutation can
// make malformed markup look safe or change authored text, so unsafe artifacts
// fail closed. DOM hosts must insert accepted SVG as parsed XML nodes, never via
// innerHTML.
// ============================================================================

import { createSvgInspector } from './svg-inspection-cache.ts'
import { xmlTokenAt, xmlSlice, xmlIndexOf as findXmlToken } from './shared/xml-name.ts'

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
const SECURITY_ELEMENT_TAG = /<(?:([^\s<>/:]+):)?(script|foreignObject|image|object|embed|iframe|animate(?:Motion|Transform)?|set)\b/gi
const SECURITY_ELEMENT_NAME = /^(script|foreignObject|image|object|embed|iframe|animate(?:Motion|Transform)?|set)\b/i
const SECURITY_ELEMENT_NAMES = ['script', 'foreignObject', 'image', 'object', 'embed', 'iframe'] as const
const CSS_SECURITY_DELIMITERS = /[(:@\\&]/
const ACTIVE_REFERENCE_SCHEME = /^(?:javascript|vbscript|data|file):/
const ACTIVE_CSS_SCHEME = /(?:javascript|vbscript|data|file)\s*:/i
const ACTIVE_CSS_FUNCTION = /(?:expression|behavior)\s*\(/i
const ACTIVE_CSS_SCAN = /(?:expression|behavior)\s*\(|-moz-binding\s*:/i

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
type XmlWork = (operations: number) => void
const XML_WORK_EXHAUSTED = Symbol('xml-work-exhausted')

function xmlHasColon(value: string): boolean { for (let i = 0; i < value.length; i++) if (value[i] === ':') return true; return false }
function xmlAsciiLetter(character: string | undefined): boolean { return character !== undefined && (character >= 'A' && character <= 'Z' || character >= 'a' && character <= 'z') }
function xmlNameCharacter(character: string | undefined): boolean { return xmlAsciiLetter(character) || character !== undefined && (character >= '0' && character <= '9' || character === '_' || character === '-' || character === '.' || character === ':') }
function xmlScalarCharacter(character: string): boolean { return character === '\t' || character === '\n' || character === '\r' || character >= '\u0020' && character <= '\ud7ff' || character >= '\ue000' && character <= '\ufffd' }

function xmlIndexOf(source: string, needle: string, start: number, work?: XmlWork): number {
  if (!work) return source.indexOf(needle, start)
  return findXmlToken(source, needle, start, work)
}

function isXmlWhitespace(char: string | undefined): boolean {
  return char === ' ' || char === '\t' || char === '\n' || char === '\r'
}

function readXmlNameEnd(source: string, start: number, work?: XmlWork): number {
  work?.(1)
  const character = start < source.length ? source[start] : undefined
  if (!xmlAsciiLetter(character) && character !== '_') return -1
  let end = start + 1
  for (;;) { work?.(1); if (!xmlNameCharacter(end < source.length ? source[end] : undefined)) break; end++ }
  return end
}

interface XmlQualifiedName {
  readonly prefix: string
  readonly local: string
}

/** The admitted serializer subset uses ASCII XML names. Enforce QName shape
 * separately from the lexical name scanner so a colon cannot appear more than
 * once or at either edge. */
function parsePrefixedXmlName(name: string, work?: XmlWork): XmlQualifiedName | undefined {
  const colon = xmlIndexOf(name, ':', 0, work)
  if (colon <= 0 || colon === name.length - 1 || xmlIndexOf(name, ':', colon + 1, work) >= 0) return undefined
  work?.(1)
  if (!xmlAsciiLetter(name[colon + 1]) && name[colon + 1] !== '_') return undefined
  return { prefix: xmlSlice(name, 0, colon, work), local: xmlSlice(name, colon + 1, name.length, work) }
}

const XML_NAMESPACE = 'http://www.w3.org/XML/1998/namespace'
const XMLNS_NAMESPACE = 'http://www.w3.org/2000/xmlns/'
const SVG_NAMESPACE = 'http://www.w3.org/2000/svg'

interface XmlParserList<T> { length: number; [index: number]: T }
function xmlParserList<T>(): XmlParserList<T> { const result = Object.create(null) as XmlParserList<T>; result.length = 0; return result }

interface XmlElementFrame {
  readonly name: string
  readonly namespaces: ReadonlyMap<string, string>
  readonly styleStart?: number
}

function isAllowedXmlCodePoint(codePoint: number): boolean {
  return codePoint === 0x9 || codePoint === 0xa || codePoint === 0xd
    || (codePoint >= 0x20 && codePoint <= 0xd7ff)
    || (codePoint >= 0xe000 && codePoint <= 0xfffd)
    || (codePoint >= 0x10000 && codePoint <= 0x10ffff)
}

function hasOnlyXmlCharacters(source: string): boolean {
  // Unicode matching consumes valid astral pairs and rejects lone surrogates.
  return !/[\0-\x08\x0b\x0c\x0e-\x1f\ud800-\udfff\ufffe\uffff]/u.test(source)
}

/** DTDs are prohibited, so only XML's five predefined names and numeric
 * references are legal. This rejects a bare `&` before any DOM can repair it. */
function hasWellFormedXmlReferences(source: string, work?: XmlWork): boolean {
  for (let index = xmlIndexOf(source, '&', 0, work); index >= 0; index = xmlIndexOf(source, '&', index + 1, work)) {
    const semicolon = xmlIndexOf(source, ';', index + 1, work)
    if (semicolon < 0) return false
    const reference = xmlSlice(source, index + 1, semicolon, work)
    // Reserve the numeric slice, lexical check and integer conversion before
    // materializing them; named references also fit this character bound.
    work?.(reference.length * 3 + 4)
    if (reference.startsWith('#x')) {
      const digits = reference.slice(2)
      if (!/^[0-9a-f]+$/i.test(digits)) return false
      if (!isAllowedXmlCodePoint(Number.parseInt(digits, 16))) return false
    } else if (reference.startsWith('#')) {
      const digits = reference.slice(1)
      if (!/^[0-9]+$/.test(digits)) return false
      if (!isAllowedXmlCodePoint(Number.parseInt(digits, 10))) return false
    } else if (!XML_NAMED_REFERENCES.has(reference)) {
      return false
    }
    index = semicolon
  }
  return true
}

/** Consume one reference without copying or rescanning its enclosing span. */
function readXmlReferenceEnd(source: string, start: number, work?: XmlWork): number {
  let cursor = start + 1
  work?.(1)
  if (source[cursor] === '#') {
    cursor++
    work?.(1)
    const hex = source[cursor] === 'x'
    if (hex) cursor++
    let value = 0, digits = 0
    while (cursor < source.length) {
      work?.(2)
      const character = source[cursor]!
      if (character === ';') return digits > 0 && isAllowedXmlCodePoint(value) ? cursor + 1 : -1
      const digit = character >= '0' && character <= '9' ? +character
        : hex && (character === 'a' || character === 'A') ? 10 : hex && (character === 'b' || character === 'B') ? 11
          : hex && (character === 'c' || character === 'C') ? 12 : hex && (character === 'd' || character === 'D') ? 13
            : hex && (character === 'e' || character === 'E') ? 14 : hex && (character === 'f' || character === 'F') ? 15 : -1
      if (digit < 0) return -1
      value = value * (hex ? 16 : 10) + digit
      if (value > 0x10ffff) return -1
      digits++; cursor++
    }
    return -1
  }
  const nameStart = cursor
  while (cursor < source.length) {
    work?.(1)
    const character = source[cursor]!
    if (character === ';') {
      const name = xmlSlice(source, nameStart, cursor, work)
      work?.(name.length + 1)
      return XML_NAMED_REFERENCES.has(name) ? cursor + 1 : -1
    }
    if (cursor - nameStart >= 4 || character < 'a' || character > 'z') return -1
    cursor++
  }
  return -1
}

/** One pass owns scalar, reference and delimiter checks for text or a quoted
 * attribute. Only consumers of raw attribute bytes materialize a slice. */
function readXmlDataEnd(source: string, start: number, quote: string | undefined, outside: boolean, work?: XmlWork): number {
  let cursor = start, brackets = 0
  while (cursor < source.length) {
    work?.(1)
    const character = source[cursor]!
    if (character === quote || quote === undefined && character === '<') return cursor
    if (outside && !isXmlWhitespace(character)) return -1
    if (character === '&') {
      const end = readXmlReferenceEnd(source, cursor, work)
      if (end < 0) return -1
      brackets = 0; cursor = end
      continue
    }
    if (quote !== undefined && character === '<') return -1
    if (quote === undefined) {
      if (character === '>' && brackets >= 2) return -1
      brackets = character === ']' ? brackets < 2 ? brackets + 1 : 2 : 0
    }
    if (character >= '\ud800' && character <= '\udbff') {
      work?.(1)
      const low = cursor + 1 < source.length ? source[cursor + 1]! : ''
      if (!(low >= '\udc00' && low <= '\udfff')) return -1
      cursor += 2
    } else {
      if (!xmlScalarCharacter(character)) return -1
      cursor++
    }
  }
  return quote === undefined ? cursor : -1
}

function readXmlCommentEnd(source: string, start: number, work?: XmlWork): number {
  let cursor = start
  while (cursor < source.length) {
    work?.(1)
    const character = source[cursor]!
    if (character === '-') {
      work?.(2)
      if (cursor + 1 < source.length && source[cursor + 1] === '-') return cursor + 2 < source.length && source[cursor + 2] === '>' ? cursor + 3 : -1
    }
    if (character >= '\ud800' && character <= '\udbff') {
      work?.(1)
      const low = cursor + 1 < source.length ? source[cursor + 1]! : ''
      if (!(low >= '\udc00' && low <= '\udfff')) return -1
      cursor += 2
    } else {
      if (!xmlScalarCharacter(character)) return -1
      cursor++
    }
  }
  return -1
}

/** Validate a text span inside an already delimited SVG element. */
export function isWellFormedSvgText(value: string): boolean {
  return hasOnlyXmlCharacters(value) && !value.includes('<') && !value.includes(']]>')
    && hasWellFormedXmlReferences(value)
}

const inspectDocumentEnvelope = createSvgInspector('xml-envelope', verifyDocumentEnvelope)

/** Dependency-free XML well-formedness gate shared by backend
 * admission and every final SVG result. It deliberately accepts only the
 * bounded XML subset an SVG serializer needs: one paired `<svg>` root,
 * quoted attributes, no DTD/processing instructions, balanced tags, valid
 * characters/references, and no duplicate attributes. */
export function verifySvgDocumentEnvelope(svg: string, work?: (operations: number) => boolean): boolean {
  // Proof callers must inspect fresh bytes: the public inspection cache is an
  // optimization whose caller-supplied results cannot issue paint authority.
  if (work) {
    try {
      return verifyDocumentEnvelope(svg, undefined, operations => { if (!work(operations)) throw XML_WORK_EXHAUSTED })
    } catch (error) {
      if (error === XML_WORK_EXHAUSTED) return false
      throw error
    }
  }
  return inspectDocumentEnvelope(svg)
}

/** Extra rejection obligations for private XML construction projections.
 * Every occupied SPACE must occur in parsed DATA inside the SVG root; none
 * may be skipped by an attribute, comment, tag or reference scanner. This
 * does not exempt any bytes from the ordinary fresh XML checks. */
export function verifySvgDocumentDataPositions(svg: string, positions: Readonly<ArrayLike<number>>, work?: (operations: number) => boolean): boolean {
  const charge: XmlWork = operations => { if (work && !work(operations)) throw XML_WORK_EXHAUSTED }
  let next = 0, previous = -1
  const data = (start: number, end: number, inside: boolean): boolean => {
    charge(1)
    while (next < positions.length) {
      charge(2)
      const position = positions[next]!
      if (position >= end) break
      if (!Number.isSafeInteger(position) || position < start || position <= previous || !inside || svg[position] !== ' ') return false
      previous = position; next++
    }
    return true
  }
  try {
    const valid = verifyDocumentEnvelope(svg, undefined, charge, data)
    charge(1)
    return valid && next === positions.length
  } catch (error) {
    if (error === XML_WORK_EXHAUSTED) return false
    throw error
  }
}

interface WrittenDocumentInspection { elements: number; styleStarts: number[]; styleEnds: Array<{ start: number; end: number }> }

function verifyDocumentEnvelope(svg: string, observeAttribute?: (name: string, rawValue: string) => void, work?: XmlWork, observeData?: (start: number, end: number, inside: boolean) => boolean, useWritten = false, observeWritten?: (refs: readonly string[], active: readonly string[]) => void, document?: WrittenDocumentInspection): boolean {
  const stack = xmlParserList<XmlElementFrame>()
  const shortAttributeNames = xmlParserList<string>()
  let longAttributeNames: Set<string> | undefined
  let rootSeen = false
  let rootClosed = false
  let styleDepth = 0
  // A leading decoded byte-order mark is legal XML; elsewhere it is text,
  // so it cannot stand in for XML whitespace outside the root.
  work?.(1)
  let cursor = svg[0] === '\ufeff' ? 1 : 0

  while (cursor < svg.length) {
    work?.(1)
    if (svg[cursor] !== '<') {
      const end = readXmlDataEnd(svg, cursor, undefined, stack.length === 0, work)
      if (end < 0 || observeData && !observeData(cursor, end, stack.length > 0)) return false
      cursor = end
      continue
    }

    work?.(24)
    if (xmlTokenAt(svg, '<!--', cursor)) {
      if (stack.length === 0) return false
      const end = readXmlCommentEnd(svg, cursor + 4, work)
      if (end < 0) return false
      cursor = end
      continue
    }
    // First-party serializers do not need CDATA. Excluding it keeps the
    // security scanner and XML parser on one text model: a fake `</style>`
    // inside CDATA cannot truncate the later CSS-reference scan.
    if (xmlTokenAt(svg, '<![CDATA[', cursor)) return false
    if (xmlTokenAt(svg, '<!', cursor) || xmlTokenAt(svg, '<?', cursor)) return false

    if (xmlTokenAt(svg, '</', cursor)) {
      let end = readXmlNameEnd(svg, cursor + 2, work)
      if (end < 0) return false
      const name = xmlSlice(svg, cursor + 2, end, work)
      work?.(name.length * 2 + 1)
      if (xmlHasColon(name)) return false
      while (isXmlWhitespace(svg[end])) { work?.(1); end++ }
      work?.(1)
      if (svg[end] !== '>' || stack.length === 0) return false
      const frame = stack[--stack.length]
      delete stack[stack.length]
      if (frame?.name !== name) return false
      if (frame.styleStart !== undefined) {
        styleDepth--
        document?.styleEnds.push({ start: cursor, end: end + 1 })
      }
      cursor = end + 1
      if (stack.length === 0) {
        if (name !== 'svg' || rootClosed) return false
        rootClosed = true
      }
      continue
    }

    if (styleDepth > 0) return false
    const nameEnd = readXmlNameEnd(svg, cursor + 1, work)
    // The admitted serializer subset has only unprefixed SVG elements.
    // Qualified-name objects are needed for attributes, never for elements.
    if (nameEnd < 0 || rootClosed) return false
    const name = xmlSlice(svg, cursor + 1, nameEnd, work)
    work?.(name.length)
    if (xmlHasColon(name)) return false
    if (stack.length === 0) {
      if (rootSeen || name !== 'svg') return false
      rootSeen = true
    }

    if (useWritten && !work && stack.length > 0 && stack[stack.length - 1]!.namespaces.get('') === SVG_NAMESPACE) {
      const close = svg.indexOf('>', nameEnd)
      const written = close < 0 ? undefined : writtenTagOf(svg.slice(cursor, close + 1))
      if (written) {
        for (const attribute of written.attributes) observeWritten?.(attribute.refs, attribute.active)
        if (!written.selfClosing) {
          const namespaces = stack[stack.length - 1]!.namespaces
          stack[stack.length++] = { name, namespaces }
        }
        cursor = close + 1
        continue
      }
    }

    const styleStart = cursor
    work?.(5)
    const isStyle = name.length === 5 && (name[0] === 's' || name[0] === 'S') && (name[1] === 't' || name[1] === 'T')
      && (name[2] === 'y' || name[2] === 'Y') && (name[3] === 'l' || name[3] === 'L') && (name[4] === 'e' || name[4] === 'E')
    if (document) {
      if (/^style\b/i.test(name)) document.styleStarts.push(styleStart)
      const unsafe = SECURITY_ELEMENT_NAME.exec(name)?.[1]
      if (unsafe) {
        const index = SECURITY_ELEMENT_NAMES.findIndex(tag => tag.toLowerCase() === unsafe.toLowerCase())
        document.elements |= 1 << (index < 0 ? SECURITY_ELEMENT_NAMES.length : index)
      }
    }

    let end = nameEnd
    // Metered paint proof retains its admitted hash-lookup work plan. The
    // public unmetered scan can use Main's bounded small-attribute scratch.
    const rawAttributes = work ? new Set<string>() : undefined
    let attributeCount = 0
    let usingLongAttributes = false
    const namespaceAttributes = xmlParserList<{ readonly name: string; readonly prefix?: string; readonly local?: string; readonly value: string }>()
    let selfClosing = false
    for (;;) {
      work?.(4)
      const hadWhitespace = isXmlWhitespace(svg[end])
      while (isXmlWhitespace(svg[end])) { work?.(1); end++ }
      if (svg[end] === '>') { end++; break }
      if (svg[end] === '/' && svg[end + 1] === '>') {
        selfClosing = true
        end += 2
        break
      }
      if (!hadWhitespace) return false
      const attributeEnd = readXmlNameEnd(svg, end, work)
      if (attributeEnd < 0) return false
      const attribute = xmlSlice(svg, end, attributeEnd, work)
      work?.(attribute.length * 3 + 2)
      if (rawAttributes) {
        if (rawAttributes.has(attribute)) return false
        rawAttributes.add(attribute)
      } else if (attributeCount < 16) {
        for (let index = 0; index < attributeCount; index++) {
          work?.(1)
          if (shortAttributeNames[index] === attribute) return false
        }
        shortAttributeNames[attributeCount++] = attribute
      } else {
        if (!usingLongAttributes) {
          longAttributeNames ??= new Set()
          longAttributeNames.clear()
          for (let index = 0; index < attributeCount; index++) { work?.(1); longAttributeNames.add(shortAttributeNames[index]!) }
          usingLongAttributes = true
        }
        work?.(2)
        if (longAttributeNames!.has(attribute)) return false
        longAttributeNames!.add(attribute)
      }
      const prefixed = xmlHasColon(attribute)
      const attributeName = prefixed ? parsePrefixedXmlName(attribute, work) : undefined
      if (prefixed && !attributeName) return false
      end = attributeEnd
      while (isXmlWhitespace(svg[end])) { work?.(1); end++ }
      if (svg[end] !== '=') return false
      end++
      while (isXmlWhitespace(svg[end])) { work?.(1); end++ }
      const quote = svg[end]
      if (quote !== '"' && quote !== "'") return false
      const valueStart = ++end
      end = readXmlDataEnd(svg, valueStart, quote, false, work)
      if (end < 0) return false
      // Namespace expansion never consumes ordinary unprefixed attributes:
      // their raw names already prove uniqueness. Still validate every value
      // and report its raw bytes to security in the original lexical order.
      if (attributeName || attribute === 'xmlns' || observeAttribute) {
        const value = xmlSlice(svg, valueStart, end, work)
        if (attributeName || attribute === 'xmlns') {
          work?.(1)
          namespaceAttributes[namespaceAttributes.length++] = { name: attribute, ...attributeName, value: decodeXmlNamespaceValue(value, work) }
        }
        observeAttribute?.(attribute, value)
      }
      end++
    }

    // Frames share inherited bindings until a declaration changes them. Never
    // mutate a parent's map: a child's declarations cannot leak to siblings.
    work?.(2)
    const inheritedNamespaces = stack.length ? stack[stack.length - 1]!.namespaces : undefined
    let namespaces: ReadonlyMap<string, string>
    if (inheritedNamespaces) namespaces = inheritedNamespaces
    else { const initial = new Map<string, string>(); initial.set('xml', XML_NAMESPACE); namespaces = initial }
    let declaredNamespaces: Map<string, string> | undefined
    for (let index = 0; index < namespaceAttributes.length; index++) {
      const attribute = namespaceAttributes[index]!
      work?.(4)
      const isDefaultDeclaration = attribute.name === 'xmlns'
      const isPrefixedDeclaration = attribute.prefix === 'xmlns'
      if (!isDefaultDeclaration && !isPrefixedDeclaration) continue
      const prefix = isDefaultDeclaration ? '' : attribute.local!
      const uri = attribute.value
      if (prefix === 'xmlns'
        || uri === XMLNS_NAMESPACE
        || (prefix === 'xml' && uri !== XML_NAMESPACE)
        || (prefix !== 'xml' && uri === XML_NAMESPACE)
        || (prefix !== '' && uri === '')) return false
      if (!declaredNamespaces) {
        // Copying inherited bindings is depth dependent, rather than linear
        // in this element's markup. Reserve the actual map before allocation.
        work?.(namespaces.size)
        declaredNamespaces = new Map(namespaces)
        namespaces = declaredNamespaces
      }
      work?.(prefix.length + 1)
      declaredNamespaces.set(prefix, uri)
    }

    // One deliberately small serializer subset: every element is an
    // unprefixed SVG element. Namespaced attributes (xml/xlink/extension
    // metadata) remain available, but prefixed or namespace-reset elements
    // cannot bypass local-name security checks or render differently by host.
    work?.(1)
    if (namespaces.get('') !== SVG_NAMESPACE) return false
    if (stack.length > 0 && name === 'svg') {
      // Preserve the established single-SVG-document contract; nested SVG
      // roots are not part of the admitted backend serialization subset.
      return false
    }

    let expandedAttributes: Set<string> | undefined
    for (let index = 0; index < namespaceAttributes.length; index++) {
      const attribute = namespaceAttributes[index]!
      work?.(2)
      if (attribute.name === 'xmlns' || attribute.prefix === 'xmlns') continue
      // Raw-name uniqueness already proves unprefixed attributes unique.
      // A declared prefix always has a nonempty URI, so only prefixed names
      // can alias one another after namespace expansion.
      work?.(attribute.prefix!.length + 1)
      const namespace = namespaces.get(attribute.prefix!)
      if (namespace === undefined) return false
      // A long inherited URI can be repeated by many short QName attributes.
      // Pay construction and both set-key visits before creating that string.
      work?.((namespace.length + 1 + attribute.local!.length) * 3 + 2)
      const expanded = `${namespace}\u0000${attribute.local}`
      if (!expandedAttributes) expandedAttributes = new Set()
      if (expandedAttributes.has(expanded)) return false
      expandedAttributes.add(expanded)
    }

    cursor = end
    if (selfClosing) {
      if (stack.length === 0) return false
    } else {
      work?.(1)
      if (isStyle) styleDepth++
      stack[stack.length++] = { name, namespaces, ...(isStyle ? { styleStart } : {}) }
    }
  }

  return rootSeen && rootClosed && stack.length === 0
}

/** Namespace identity uses XML's literal-whitespace normalization followed by
 * exactly one reference expansion. Security's recursive decoding below cannot
 * supply that identity: it can merge distinct names or split aliases. */
function decodeXmlNamespaceValue(input: string, work?: XmlWork): string {
  work?.(input.length)
  let value = input
  if (/[\t\r\n]/.test(input)) {
    work?.(input.length * 2)
    value = input.replace(/\r\n|[\t\r\n]/g, ' ')
  }
  work?.(value.length)
  if (!value.includes('&')) return value
  // Reserve the original-match scan, capture, numeric conversion and output
  // before replacement. Every admitted reference shortens its source span.
  work?.(value.length * 5 + 1)
  return value.replace(/&(?:#x([0-9a-fA-F]+)|#([0-9]+)|(amp|lt|gt|quot|apos));/g, (match, hex: string | undefined, decimal: string | undefined, named: string | undefined) => {
    if (hex !== undefined) return String.fromCodePoint(Number.parseInt(hex, 16))
    if (decimal !== undefined) return String.fromCodePoint(Number.parseInt(decimal, 10))
    switch (named) {
      case 'amp': return '&'
      case 'lt': return '<'
      case 'gt': return '>'
      case 'quot': return '"'
      case 'apos': return "'"
      default: return match
    }
  })
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

function unsafeActiveCss(value: string): boolean {
  const scan = normalizeCssObfuscation(decodeXmlReferences(value))
  return unsafeActiveCssScan(scan)
}

function unsafeActiveCssScan(scan: string): boolean {
  if (ACTIVE_CSS_SCAN.test(scan)) return true
  if (ACTIVE_CSS_SCHEME.test(scan)) return true
  return false
}

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

const securityFindings = createSvgInspector('security', inspectSecurity)

/** Private writer admission. Empty findings are shared per tag rather than
 * allocating arrays for each scalar field. Errors defer to final admission. */
export function writtenAttributesFindings(fields: readonly string[]): readonly { readonly name: string; readonly value: string; readonly order: number; readonly refs: readonly string[]; readonly active: readonly string[] }[] | undefined {
  const refs: string[] = [], active: string[] = []
  const findings: Array<{ name: string; value: string; order: number; refs: readonly string[]; active: readonly string[] }> = []
  const names = new Set<string>()
  for (let i = 0; i < fields.length; i += 2) {
    const name = fields[i]!, value = fields[i + 1]!
    if (typeof name !== 'string' || typeof value !== 'string' || !/^(?:[A-Za-z_][A-Za-z0-9_.-]*|xml:space)$/.test(name) || name === 'xmlns' || names.has(name)
      || /["<>]/.test(value) || !hasWellFormedXmlReferences(value)) return undefined
    names.add(name)
    const beforeRefs = refs.length, beforeActive = active.length
    try { inspectAttributeSecurity(name, value, refs, active) } catch { return undefined }
    if (refs.length !== beforeRefs || active.length !== beforeActive) findings.push(Object.freeze({ name, value, order: i / 2,
      refs: Object.freeze(refs.slice(beforeRefs)), active: Object.freeze(active.slice(beforeActive)) }))
  }
  return Object.freeze(findings)
}

function inspectAttributeSecurity(qualified: string, value: string, refs: string[], active: string[]): void {
  const lower = qualified.toLowerCase()
  const colon = lower.lastIndexOf(':')
  const name = colon < 0 ? lower : lower.slice(colon + 1)
  if (name.startsWith('on') && name.length > 2 && name.charCodeAt(2) >= 97 && name.charCodeAt(2) <= 122) {
    refs.push('inline-event-handler'); active.push('inline-event-handler')
  }
  // XML Base changes even fragment references into external fetches.
  if (lower === 'xml:base') refs.push(`xml:base=${value}`)
  switch (name) {
    case 'href': case 'src': case 'data': {
      const normalized = normalizedReference(value)
      if (normalized !== '' && !normalized.startsWith('#')) refs.push(normalized.startsWith('javascript:') ? 'javascript-url' : value)
      if (ACTIVE_REFERENCE_SCHEME.test(normalized)) active.push(`${qualified}=${value}`)
      return
    }
    case 'clip-path': case 'cursor': case 'fill': case 'filter':
    case 'marker-end': case 'marker-mid': case 'marker-start': case 'mask':
    case 'stroke': case 'style': case 'values': case 'from': case 'to':
      break
    default: return
  }
  // Ordinary scalar paint needs no CSS normalization. Encoded/escaped values
  // retain the same complete reference and active-content inspection.
  if (!CSS_SECURITY_DELIMITERS.test(value)) return
  const scan = normalizeCssObfuscation(decodeXmlReferences(value))
  if (unsafeCssReferences(scan).length > 0
    || ACTIVE_CSS_SCHEME.test(scan)
    || ACTIVE_CSS_FUNCTION.test(scan)) refs.push(`${qualified}=${value}`)
  if (unsafeActiveCssScan(scan)) active.push(`${qualified}=${value}`)
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
  // This raw-reference API accepts unvalidated markup. Element-bearing CSS
  // cannot prove safe references; final admission rejects it at the XML gate.
  for (const style of markup.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style[\t\n\r ]*>/gi)) {
    if (/<[^\s!?/<>]/.test(style[1]!)) { refs.push('style-element-content'); active.push('style-element-content') }
  }
  return inspectSecurityTail(markup, refs, active)
}

function inspectSecurityTail(markup: string, refs: string[], active: string[], knownElements?: number): SecurityFindings {
  // Character references are decoded inside attribute values and CSS, where
  // the XML/CSS consumers interpret them. Do not decode the complete document:
  // escaped label text such as `&lt;script&gt;` remains text in XML and must not
  // be mistaken for a structural element.
  for (const style of markup.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style[\t\n\r ]*>/gi)) {
    if (unsafeActiveCss(style[1]!)) active.push('active-css')
    refs.push(...unsafeCssReferences(style[1]!))
  }
  // Scan the union once, then preserve the established diagnostic order and
  // one finding per tag kind even when hostile markup repeats an element.
  let elementKinds = knownElements ?? 0
  if (knownElements === undefined) for (const match of markup.matchAll(SECURITY_ELEMENT_TAG)) {
    // The raw-reference API also accepts unvalidated markup. Preserve its
    // conservative finding for an unsafe namespace prefix as well as the tag.
    const prefix = match[1] && SECURITY_ELEMENT_NAME.exec(match[1])?.[1]
    for (const value of [prefix, match[2]]) if (value) {
      const name = value.toLowerCase()
      const index = SECURITY_ELEMENT_NAMES.findIndex(tag => tag.toLowerCase() === name)
      elementKinds |= 1 << (index < 0 ? SECURITY_ELEMENT_NAMES.length : index)
    }
  }
  for (const [index, tag] of SECURITY_ELEMENT_NAMES.entries()) if (elementKinds & (1 << index)) {
    refs.push(`<${tag}>`)
    if (tag !== 'image') active.push(`<${tag}>`)
  }
  if (elementKinds & (1 << SECURITY_ELEMENT_NAMES.length)) { refs.push('<animation>'); active.push('<animation>') }
  return Object.freeze({ active: Object.freeze(active), refs: Object.freeze(refs) })
}

export function verifyNoExternalRefs(svg: string): { ok: boolean; refs: string[] } {
  const { refs } = securityFindings(svg)
  return { ok: refs.length === 0, refs: [...refs] }
}

function inspectFinalDocument(svg: string, useWritten = false): SecurityFindings | false {
  const refs: string[] = []
  const active: string[] = []
  let failed = false
  let failure: unknown
  const document: WrittenDocumentInspection | undefined = useWritten ? { elements: 0, styleStarts: [], styleEnds: [] } : undefined
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
  }, undefined, undefined, useWritten, (writtenRefs, writtenActive) => { refs.push(...writtenRefs); active.push(...writtenActive) }, document)
  if (!valid) return false
  if (failed) throw failure
  if (document) {
    let end = -1, closing = 0
    const styles: string[] = []
    for (const start of document.styleStarts) {
      if (start < end) continue
      const open = svg.indexOf('>', start)
      while (closing < document.styleEnds.length && document.styleEnds[closing]!.start <= open) closing++
      const close = document.styleEnds[closing]
      if (!close) break
      end = close.end
      styles.push(svg.slice(start, end))
    }
    return inspectSecurityTail(styles.join('').replace(/<!--[\s\S]*?-->/g, ''), refs, active, document.elements)
  }
  return inspectSecurityTail(svg.replace(/<!--[\s\S]*?-->/g, ''), refs, active)
}
const inspectFinalSvg = createSvgInspector('final-security', inspectFinalDocument)
const inspectFinalWrittenSvg = createSvgInspector('final-security-written', svg => inspectFinalDocument(svg, true))

function applySecurityPolicy(svg: string, mode: OutputSecurityMode, useWritten: boolean): OutputSecurityResult {
  const inspection = useWritten ? inspectFinalWrittenSvg(svg) : inspectFinalSvg(svg)
  if (!inspection) {
    throw new Error('OutputSecurityPolicy rejected an invalid SVG document envelope')
  }
  const { active, refs } = inspection
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

/** Public boundary always examines arbitrary supplied SVG bytes. */
export function applyOutputSecurityPolicy(svg: string, mode: OutputSecurityMode = 'default'): OutputSecurityResult {
  return applySecurityPolicy(svg, mode, false)
}

/** Private original-writer boundary; opaque output and unrecorded changes
 * retain full admission within the same envelope walk. */
export function applyWrittenOutputSecurityPolicy(svg: string, mode: OutputSecurityMode = 'default'): OutputSecurityResult {
  return applySecurityPolicy(svg, mode, true)
}
