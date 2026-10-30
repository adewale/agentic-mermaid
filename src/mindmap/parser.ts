import { readAuthoredGrammarAccessibility, readGrammarAuthoredText, readGrammarText } from '../shared/grammar-text.ts'
import { encodeMermaidEntities, mermaidEntityPrepass, protectMermaidEntityPrepass, toEntityMarkers } from '../shared/mermaid-entities.ts'
import { parserObservationActive, observeParserStatement, observeParserMutation } from '../shared/parser-observation.ts'
import { normalizeBrTags } from '../multiline-utils.ts'
import type { MindmapDiagram, MindmapNode, MindmapShape } from './types.ts'
import {
  appendNativeAccessibilityLines,
  parseAccessibilityDirective,
  scanAccessibilityDirectives,
} from '../shared/accessibility-directives.ts'

export class MindmapParseError extends Error {
  constructor(message: string, readonly line?: number) { super(message); this.name = 'MindmapParseError' }
}

/** @deprecated No longer thrown: a repeated node identity is read as a
 * separate node with an occurrence id (see assignMindmapIdentities). Kept
 * for API compatibility. */
export class MindmapDuplicateIdError extends MindmapParseError {
  readonly code = 'MINDMAP_DUPLICATE_ID'
  constructor(readonly id: string, line: number) { super(`Duplicate mindmap node identity '${id}' on line ${line}; every node identity must be unique.`, line) }
}

/** The identity the author wrote for a node: its explicit id, or a default
 * node's text. A later node repeating it keeps it here as `sourceId`. */
export function mindmapAuthoredId(node: Pick<MindmapNode, 'id' | 'sourceId'>): string {
  return node.sourceId ?? node.id
}

/** Give every node a distinct, addressable id from its authored identity, in
 * document order: the first node with an identity keeps it, and each later
 * one gets `<identity>#<n>` (n = 2, 3, …; the second `X` is `X#2`) with
 * `sourceId` keeping the authored identity. No authored identity in the
 * diagram is ever given to another node, so a node written as `X#2` keeps
 * that id and the generated one moves on. Parsing and every typed edit apply
 * this one rule, so a body's ids are the ids a fresh parse of its source
 * gives. */
export function assignMindmapIdentities(root: MindmapNode): void {
  const nodes: MindmapNode[] = []
  const visit = (node: MindmapNode): void => { nodes.push(node); node.children.forEach(visit) }
  visit(root)
  const authored = new Set(nodes.map(mindmapAuthoredId))
  const used = new Set<string>()
  const seen = new Map<string, number>()
  for (const node of nodes) {
    const source = mindmapAuthoredId(node)
    let occurrence = (seen.get(source) ?? 0) + 1
    seen.set(source, occurrence)
    let id = source
    if (occurrence > 1) {
      id = `${source}#${occurrence}`
      while (authored.has(id) || used.has(id)) id = `${source}#${++occurrence}`
    }
    used.add(id)
    node.id = id
    if (id === source) delete node.sourceId
    else node.sourceId = source
  }
}

interface ParsedNode { id: string; label: string; shape: MindmapShape; markdown?: true }

/** Parse the indentation-sensitive source from the untrimmed normalized body. */
export function parseMindmap(source: string): MindmapDiagram {
  const sourceLines = source.replace(/^\uFEFF/, '').split(/\r?\n/)
  // Accessibility directives use the ordinary inline-comment rule. Shaped
  // node labels have their own lexer state, where %% remains literal text.
  const accessibilityLines = sourceLines.map(line =>
    parseAccessibilityDirective([line], 0)?.form === 'inline' ? stripMindmapComment(line, false) : line)
  const scanned = scanAccessibilityDirectives(accessibilityLines, mindmapStatementEnds(accessibilityLines))
  if (scanned.unclosedIndex !== undefined) {
    throw new MindmapParseError('Unclosed accDescr block', scanned.unclosedIndex + 1)
  }
  const accessibility = readAuthoredGrammarAccessibility(scanned.accessibility)
  const rawLines = scanned.familyLines
  const headerIndex = rawLines.findIndex(line => /^\s*mindmap\s*$/i.test(line))
  if (headerIndex < 0) throw new MindmapParseError('Mindmap source must start with the mindmap header')
  if (parserObservationActive('mindmap')) observeParserStatement('mindmap', 'header', rawLines[headerIndex]!, { line: headerIndex + 1, unit: 'normalized' })
  const stack: Array<{ indent: number; node: MindmapNode }> = []
  let root: MindmapNode | undefined
  let lastNode: MindmapNode | undefined
  // Accessibility is plain metadata, not node formatting. In particular a
  // literal <br/> in a native JSON field is not a physical description line.
  const accessibilityTitle = accessibility.title
  const accessibilityDescription = accessibility.descr

  if (parserObservationActive('mindmap')) observeParserMutation('mindmap', 'initialize', { accessibilityTitle, accessibilityDescription })

  for (const { raw, start, end: index } of mindmapStatements(rawLines, headerIndex + 1)) {
    const startLine = start + 1
    const trimmed = raw.trim()
    if (!trimmed || trimmed.startsWith('%%')) continue
    if (/^acc(?:Title|Descr)\b/i.test(trimmed)) {
      const kind = /^accTitle\b/i.test(trimmed) ? 'accTitle' : 'accDescr'
      throw new MindmapParseError(`Mindmap ${kind} must contain a non-empty value`, index + 1)
    }
    if (/^::icon\b/i.test(trimmed)) {
      if (parserObservationActive('mindmap')) observeParserStatement('mindmap', 'icon', trimmed, { line: startLine, unit: 'normalized' })
      const icon = trimmed.match(/^::icon\(([^)]*)\)$/i)
      const value = icon?.[1]?.trim()
      if (!icon || !value) throw new MindmapParseError('Mindmap icon decoration must contain a non-empty value without closing parentheses', index + 1)
      if (!lastNode) throw new MindmapParseError('Mindmap icon decoration requires a preceding node', index + 1)
      lastNode.icon = value
      if (parserObservationActive('mindmap')) observeParserMutation('mindmap', 'setIcon', { id: lastNode.id, icon: value }, { line: startLine, unit: 'normalized' })
      continue
    }
    if (trimmed.startsWith(':::')) {
      if (parserObservationActive('mindmap')) observeParserStatement('mindmap', 'class', trimmed, { line: startLine, unit: 'normalized' })
      const className = trimmed.match(/^:::\s*(.+)$/)
      if (!className) throw new MindmapParseError('Mindmap class decoration must contain at least one class name', index + 1)
      if (!lastNode) throw new MindmapParseError('Mindmap class decoration requires a preceding node', index + 1)
      lastNode.className = className[1]!.trim().replace(/\s+/g, ' ')
      if (parserObservationActive('mindmap')) observeParserMutation('mindmap', 'setClass', { id: lastNode.id, className: lastNode.className }, { line: startLine, unit: 'normalized' })
      continue
    }

    const parsed = parseNode(trimmed)
    if (parserObservationActive('mindmap')) observeParserStatement('mindmap', parsed ? 'node' : 'invalid', trimmed, { line: startLine, unit: 'normalized' })
    if (!parsed) {
      throw new MindmapParseError(`Invalid mindmap node syntax on line ${index + 1}: ${trimmed}`, index + 1)
    }
    const node: MindmapNode = { ...parsed, children: [] }
    if (parserObservationActive('mindmap')) observeParserMutation('mindmap', 'createNode', node, { line: startLine, unit: 'normalized' })
    const indent = indentation(raw)
    while (stack.length > 0 && stack[stack.length - 1]!.indent >= indent) stack.pop()
    if (stack.length === 0) {
      if (root) throw new MindmapParseError(`There can be only one mindmap root; '${node.label}' has no parent on line ${index + 1}.`, index + 1)
      root = node
      if (parserObservationActive('mindmap')) observeParserMutation('mindmap', 'setRoot', { id: node.id }, { line: startLine, unit: 'normalized' })
    } else {
      stack[stack.length - 1]!.node.children.push(node)
      if (parserObservationActive('mindmap')) observeParserMutation('mindmap', 'attachChild', { id: node.id, parentId: stack[stack.length - 1]!.node.id }, { line: startLine, unit: 'normalized' })
    }
    stack.push({ indent, node })
    lastNode = node
  }
  if (!root) throw new MindmapParseError('Mindmap requires exactly one root node')
  assignMindmapIdentities(root)
  return { root, ...(accessibilityTitle ? { accessibilityTitle } : {}), ...(accessibilityDescription ? { accessibilityDescription } : {}) }
}

/** For each line, the last line of the statement that starts there: a
 * shape's description or a Markdown String runs on to its closing delimiter
 * (FamilyOperations.statementEnds). */
export function mindmapStatementEnds(lines: readonly string[]): number[] {
  const ends = lines.map((_, index) => index)
  try {
    for (const { start, end } of mindmapStatements(lines, 0)) ends[start] = end
  } catch {
    // An unclosed Markdown String: the parser reports it; no line is hidden.
  }
  return ends
}

/** The statements from line `from` on, each with its inline comment removed,
 * from line `start` to line `end`. A Markdown String, or a shape's
 * description, runs on across line breaks to its closing delimiter, as in
 * Mermaid's NODE lexer state.
 */
function* mindmapStatements(rawLines: readonly string[], from: number): Generator<{ raw: string; start: number; end: number }> {
  let joined: string | undefined
  let lineStarts: number[] | undefined
  for (let index = from; index < rawLines.length; index++) {
    const start = index
    let raw = rawLines[index]!
    if (raw.includes('["`') && !raw.includes('`"]')) {
      const parts = [raw]
      let closed = false
      while (++index < rawLines.length) {
        parts.push(rawLines[index]!)
        if (rawLines[index]!.includes('`"]')) { closed = true; break }
      }
      if (!closed) throw new MindmapParseError('Unclosed mindmap Markdown String', index + 1)
      raw = parts.join('\n')
    }
    // Keep each break in a shape's description, not the indentation after
    // it; a `%%` line in it is a comment, as upstream.
    if (scanNodeFrame(raw.trimStart()) === 'open') {
      const comment = (line: string): boolean => /^\s*%%/.test(line)
      joined ??= rawLines.map(line => comment(line) ? '' : line).join('\n')
      lineStarts ??= rawLines.reduce<number[]>((starts, line, at) => (starts.push(at === 0 ? 0 : starts[at - 1]! + (comment(rawLines[at - 1]!) ? 0 : rawLines[at - 1]!.length) + 1), starts), [])
      const begin = lineStarts[index]! + raw.length - raw.trimStart().length
      const frame = scanNodeFrame(joined.slice(begin))
      if (frame && frame !== 'open') {
        const end = index + joined.slice(begin, begin + frame.end).split('\n').length - 1
        raw = [rawLines[index]!.trimEnd(), ...rawLines.slice(index + 1, end + 1).filter(line => !comment(line)).map(line => line.trim())].join('\n')
        index = end
      }
    }
    yield { raw: stripMindmapComment(raw), start, end: index }
  }
}

/** The lines (1-based) of the nodes in `source` read from shape text that
 * holds its own delimiters, which pinned Mermaid rejects (see readNode). */
export function mindmapNestedShapeLines(source: string): number[] {
  const lines = source.split(/\r?\n/)
  const header = lines.findIndex(line => /^\s*mindmap\s*$/i.test(line))
  if (header < 0) return []
  // Accessibility directives are no nodes; blank them in place.
  for (let index = header + 1; index < lines.length; index++) {
    const directive = parseAccessibilityDirective(lines, index)
    if (directive === undefined) break
    if (directive === null) continue
    lines.fill('', index, directive.endIndex + 1)
    index = directive.endIndex
  }
  const nested: number[] = []
  for (const { raw, start } of mindmapStatements(lines, header + 1)) {
    const text = raw.trim()
    if (!text || text.startsWith('%%') || /^::icon\b/i.test(text) || text.startsWith(':::')) continue
    if (readNode(text)?.nested) nested.push(start + 1)
  }
  return nested
}

interface NodeFrame { id: string; label: string; shape: MindmapShape; end: number }

function readNodeFrame(source: string): NodeFrame | null {
  const frame = scanNodeFrame(source)
  return frame === 'open' ? null : frame
}

/** Read the first shape boundary in the same states as Mindmap's lexer:
 * nested opening brackets are ordinary label text, closing tokens end it,
 * and a quote at the beginning of the description protects delimiters.
 * `open` when the source ends before the shape closes.
 */
function scanNodeFrame(source: string): NodeFrame | 'open' | null {
  const opening = source.match(/^([^()[{}]*?)(\(\(|\{\{|\[|\)\)|\)|\()/)
  if (!opening) return null
  const opener = opening[2]!
  const begin = opening[0].length
  let end = begin
  if (source.startsWith('"`', begin)) {
    const closing = source.indexOf('`"', begin + 2)
    if (closing < 0) return 'open'
    end = closing + 2
  } else if (source[begin] === '"') {
    end = begin + 1
    while (end < source.length) {
      if (source[end] === '\\') { end += 2; continue }
      if (source[end++] === '"') break
    }
    if (source[end - 1] !== '"' || end === begin + 1) return 'open'
  } else {
    while (end < source.length && !/[)\](}]/.test(source[end]!)) end++
  }
  const label = source.slice(begin, end)
  // A quoted description's shape closes on its closing quote's line.
  const quoted = source[begin] === '"'
  while (end < source.length && (quoted ? /[ \t]/ : /\s/).test(source[end]!)) end++
  if (end === source.length) return quoted ? null : 'open'
  const closer = ['))', '}}', '((', '(-', '-)', ')', ']', '('].find(token => source.startsWith(token, end))
  if (!closer) return null
  const shape: MindmapShape = opener === '[' ? 'rect' : opener === '{{' ? 'hexagon'
    : opener === '((' ? 'circle' : opener === '))' ? 'bang'
    : opener === ')' || closer !== ')' ? 'cloud' : 'rounded'
  return { id: opening[1]!.trim(), label, shape, end: end + closer.length }
}

export function stripMindmapComment(line: string, shapedLabel = true): string {
  if (line.trimStart().startsWith(':::')) return line
  const inlineDirective = parseAccessibilityDirective([line], 0)?.form === 'inline'
  const trimmed = line.trimStart()
  const frame = shapedLabel && !trimmed.startsWith('::') ? readNodeFrame(trimmed) : null
  if (frame) {
    const comment = line.indexOf('%%', line.length - trimmed.length + frame.end)
    return comment < 0 ? line : line.slice(0, comment)
  }
  let quoted = false
  let escaped = false
  for (let index = 0; index < line.length - 1; index++) {
    const char = line[index]!
    if (escaped) { escaped = false; continue }
    if (char === '\\') { escaped = true; continue }
    if (char === '"') { quoted = !quoted; continue }
    if (quoted || char !== '%' || line[index + 1] !== '%') continue
    const prefix = line.slice(0, index).trim()
    // Bare-node, shape, icon and class payloads consume %% as text. Once a
    // shape or icon closes, the lexer can start a trailing comment again.
    if (!prefix || inlineDirective || /^::icon\([^)]*\)$/.test(prefix)) return line.slice(0, index)
    const node = parseNode(prefix)
    if (node && node.shape !== 'default') return line.slice(0, index)
  }
  return line
}

function indentation(line: string): number {
  let width = 0
  for (const char of line) {
    if (char === ' ') width++
    else if (char === '\t') width += 4
    else break
  }
  return width
}

/** Mermaid's NODE_ID token is `[^\(\[\n\)\{\}]+`, so a node's explicit id, or
 * a default node's whole text, holds no `(`, `[`, `)`, `{`, `}` or line break
 * (a `]` is text), and does not start with the word `mindmap`, which its
 * lexer takes first as the header keyword (`mindmapper` is a name). Text that
 * does is not one node. An anonymous shape's id, which comes from its
 * description, is not bound by this. */
const NODE_ID_TEXT = /^(?!mindmap\b)[^([\r\n){}]*$/i

function parseNode(source: string): ParsedNode | null {
  return readNode(source)?.node ?? null
}

// A shape around the rest of a statement: the id before its opening
// delimiter, and the text up to its last closing one.
const ENCLOSING_SHAPES: ReadonlyArray<{ regex: RegExp; shape: MindmapShape }> = [
  { regex: /^(.*?)\(\((.*)\)\)$/, shape: 'circle' },
  { regex: /^(.*?)\{\{(.*)\}\}$/, shape: 'hexagon' },
  { regex: /^(.*?)\[([\s\S]*)\]$/, shape: 'rect' },
  { regex: /^(.*?)\)\)(.*)\(\($/, shape: 'bang' },
  { regex: /^(.*?)\)(.*)\($/, shape: 'cloud' },
  { regex: /^(.*?)\((.*)\)$/, shape: 'rounded' },
]

/** One node statement. `nested` marks shape text holding its own delimiters
 * in pairs, as `root((a (b) c))` or `[f(x)]`: Mermaid ends the shape at its
 * first closing delimiter and rejects the rest. The meaning is clear, so ours
 * reads the text inside the outermost pair, verify reports it, and the writer
 * quotes it. Unpaired delimiters, or a quote, leave no clear reading and are
 * rejected, as upstream. */
function readNode(source: string): { node: ParsedNode; nested?: true } | null {
  const frame = readNodeFrame(source)
  if (frame && !source.slice(frame.end).trim()) {
    const node = shapedNode(frame.id, frame.label, frame.shape)
    return node && { node }
  }
  for (const { regex, shape } of ENCLOSING_SHAPES) {
    const match = source.match(regex)
    if (!match) continue
    const text = match[2]!
    const node = !text.includes('"') && paired(text) ? shapedNode(match[1]!.trim(), text, shape) : null
    return node && { node, nested: true }
  }
  if (!NODE_ID_TEXT.test(source)) return null
  const cleaned = cleanLabel(source)
  const id = plainLabel(cleaned.label)
  return id ? { node: { id, label: cleaned.label, shape: 'default', ...(cleaned.markdown ? { markdown: true } : {}) } } : null
}

function shapedNode(explicit: string, text: string, shape: MindmapShape): ParsedNode | null {
  if (!NODE_ID_TEXT.test(explicit)) return null
  const cleaned = cleanLabel(text)
  const id = explicit || plainLabel(cleaned.label)
  return id && cleaned.label ? { id, label: cleaned.label, shape, ...(cleaned.markdown ? { markdown: true } : {}) } : null
}

/** Whether each `(`, `[` and `{` in `text` closes in order, and nothing else
 * closes. */
function paired(text: string): boolean {
  const closers: string[] = []
  for (const char of text) {
    const closer = char === '(' ? ')' : char === '[' ? ']' : char === '{' ? '}' : undefined
    if (closer) closers.push(closer)
    else if ((char === ')' || char === ']' || char === '}') && closers.pop() !== char) return false
  }
  return closers.length === 0
}

function cleanLabel(value: string): { label: string; markdown: boolean } {
  let label = value.trim()
  const markdown = label.startsWith('"`') && label.endsWith('`"')
  if (markdown) label = markdownToInlineTags(readGrammarAuthoredText(label.slice(2, -2)))
  else {
    if (label.startsWith('"') && label.endsWith('"')) label = label.slice(1, -1)
    label = readGrammarAuthoredText(label)
    label = label.replace(/\*\*([^*]+)\*\*/g, '$1').replace(/\*([^*]+)\*/g, '$1')
  }
  return { label: readGrammarText(normalizeBrTags(label), '*()[]').trim(), markdown }
}

function markdownToInlineTags(value: string): string {
  return value
    .replace(/\*\*([\s\S]+?)\*\*/g, '<b>$1</b>')
    .replace(/\*([\s\S]+?)\*/g, '<i>$1</i>')
}

function writeMindmapText(value: string, mode: 'bare' | 'quoted' | 'unquoted' | 'markdown', additionalReserved = ''): string {
  const text = (part: string) => {
    const reserved = (mode === 'bare' ? '*()[{}' : '#&*' + (mode === 'unquoted' ? '' : '"`')) + additionalReserved + (part.includes('%%{') || mode === 'bare' && /^%%/.test(value) ? '%' : '')
    let written = encodeMermaidEntities(mode === 'markdown' ? part : part.replace(/\n/g, '<br/>'), reserved)
    if (mode === 'bare' && /^mindmap\b/i.test(written)) written = `#${written.codePointAt(0)!};${written.slice(1)}`
    return written
  }
  // Formatting delimiters are emitted from modeled tags. Literal stars are
  // escaped before the Markdown reader, independently of those delimiters.
  return mode === 'markdown' ? value.split(/(<\/?[bi]>)/gi).map(part => /^<\/?b>$/i.test(part) ? '**' : /^<\/?i>$/i.test(part) ? '*' : text(part)).join('') : text(value)
}

function plainLabel(value: string): string {
  return value.replace(/<\/?(?:b|i)>/gi, '').trim()
}

function writeMindmapNode(node: MindmapNode): string {
  const markdown = node.markdown
  const mode = markdown ? 'markdown' : node.shape === 'default' ? 'bare' : /[()\]}]/.test(node.label) || node.label.startsWith('"') ? 'quoted' : 'unquoted'
  // The author's identity, not a later occurrence's generated id.
  const authored = mindmapAuthoredId(node)
  const id = authored === plainLabel(node.label) && (/[()[\]{}\r\n]/.test(authored) || authored.includes('%%{') || !NODE_ID_TEXT.test(authored)) ? '' : authored
  return protectMermaidEntityPrepass(reserved => {
    const payload = writeMindmapText(node.label, mode, reserved)
    const label = markdown ? `"\`${payload}\`"` : mode === 'quoted' ? `"${payload}"` : payload
    return node.shape === 'default' ? label
      : node.shape === 'rect' ? `${id}[${label}]`
      : node.shape === 'rounded' ? `${id}(${label})`
      : node.shape === 'circle' ? `${id}((${label}))`
      : node.shape === 'hexagon' ? `${id}{{${label}}}`
      : node.shape === 'cloud' ? `${id})${label}(`
      : `${id}))${label}((`
  })
}

/** Decorations and explicit identities use different lexer states from text.
 * Anonymous shaped nodes derive their logical identity after label decoding. */
export function mindmapSerializationProblem(diagram: MindmapDiagram, authoredSource?: string): string | undefined {
  const visit = (node: MindmapNode): string | undefined => {
    if (node.shape === 'default' && (writeMindmapNode(node) !== node.label.replace(/\n/g, '<br/>') || cleanLabel(node.label).label !== node.label)) return `Mindmap default node "${node.id}" needs text escapes that would change its identity; choose a bordered shape with an explicit identity before editing this text`
    const authored = mindmapAuthoredId(node)
    const anonymous = node.shape !== 'default' && authored === plainLabel(node.label)
    if ((!anonymous && authored.includes('%%{')) || [node.icon, node.className].some(value => value?.includes('%%{'))) {
      return `Mindmap node "${node.id}" has an explicit identity or decoration containing a directive opener; rename that identity before editing its text`
    }
    for (const child of node.children) { const problem = visit(child); if (problem) return problem }
    return undefined
  }
  const problem = visit(diagram.root)
  if (problem || authoredSource === undefined) return problem
  const lines = authoredSource.split(/\r?\n/)
  const header = lines.findIndex(line => /^\s*mindmap\s*$/i.test(line))
  const scanned = scanAccessibilityDirectives(lines, mindmapStatementEnds(lines))
  for (const { raw } of mindmapStatements(scanned.familyLines, header + 1)) {
    const text = raw.trim()
    if (!text || text.startsWith('%%') || text.startsWith('::')) continue
    const node = readNode(text)?.node
    if (!node || node.shape !== 'default') continue
    // A bare node has one token for both identity and label. XML decoding or
    // formatting may give us a clear display value without retaining that
    // token. Preserve the source when its lexical identity cannot be rebuilt.
    // The pinned DB's HTML sanitizer canonicalizes each actual br tag to
    // <br>. Entity tokens stay protected and cannot become a tag here.
    const tokenIdentity = (value: string): string => toEntityMarkers(mermaidEntityPrepass(value)).replace(/<br\s*\/?>/gi, '<br>')
    const originalIdentity = tokenIdentity(text)
    const writtenIdentity = tokenIdentity(writeMindmapNode({ ...node, children: [] }))
    if (writtenIdentity !== originalIdentity) return `Mindmap default node "${node.id}" has an authored identity that cannot be reconstructed without changing its token; its source remains preserved`
  }
  return undefined
}

/** Inspect statements independently of indentation: verifier input may be
 * normalized, but the literal text and its physical line still survive. */
export function mindmapNonportableTextLines(source: string): Array<{ line: number; message: string }> {
  const lines = source.split(/\r?\n/)
  const header = lines.findIndex(line => /^\s*mindmap\s*$/i.test(line))
  const problems: Array<{ line: number; message: string }> = []
  if (header < 0) return problems
  for (const { raw, start } of mindmapStatements(lines, header + 1)) {
    const text = raw.trim()
    if (!text || text.startsWith('%%') || /^acc(?:Title|Descr)\b/i.test(text)) continue
    const node = readNode(text)?.node
    const payload = readNodeFrame(text)?.label
    const unprotectedText = text.includes('%%{') || payload !== undefined && /^"[\s\S]*"$/.test(payload)
      && /["`]/.test(payload.slice(payload.startsWith('"`') ? 2 : 1, payload.endsWith('`"') ? -2 : -1))
    const problem = unprotectedText ? 'Mindmap label delimiters need grammar escapes for pinned Mermaid; the writer preserves their literal text'
      : node ? mindmapSerializationProblem({ root: { ...node, children: [] } }, `mindmap\n${text}`)
      : /^::/.test(text) && text.includes('%%{') ? 'Mindmap decoration contains a directive opener with no portable spelling that preserves its text' : undefined
    if (problem) problems.push({ line: start + 1, message: problem })
  }
  return problems
}

export function serializeMindmap(diagram: MindmapDiagram): string {
  const problem = mindmapSerializationProblem(diagram)
  if (problem) throw new MindmapParseError(problem)
  const lines = ['mindmap']
  appendNativeAccessibilityLines(lines, diagram)
  const visit = (node: MindmapNode, depth: number): void => {
    const indent = '  '.repeat(depth + 1)
    const text = writeMindmapNode(node)
    lines.push(indent + text)
    if (node.icon) lines.push(`${indent}  ::icon(${node.icon})`)
    if (node.className) lines.push(`${indent}  :::${node.className}`)
    for (const child of node.children) visit(child, depth + 1)
  }
  visit(diagram.root, 0)
  return lines.join('\n') + '\n'
}
