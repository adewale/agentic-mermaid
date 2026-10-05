import type { LayoutWarning } from './types.ts'
import { normalizeV11Shape } from '../flowchart-shapes.ts'
import { parseMermaid, splitFlowchartStatements } from '../parser.ts'
import { coalesceFlowchartMetadataLines, matchTextArrow, scanFlowchart } from '../flowchart-lexer.ts'
import { metadataText, readMetadataBlock } from '../shared/metadata-yaml.ts'

type MetadataEntries = ReadonlyMap<string, unknown>

export interface FlowchartStatement {
  text: string
  line: number
}

// Edge IDs (`e1@-->`) are MODELED structured edge identity (plan §Flowchart 7)
// and no longer force the opaque fallback or a lint. Node metadata with only
// documented node metadata and the closed animate/animation/curve edge set are
// modeled too. Placement/dimension metadata and undocumented shapes keep the
// lossless opaque fallback. Markdown strings render with styled emphasis but
// stay opaque so the authored quoting round-trips byte-verbatim.
export function containsFlowchartOpaqueSyntax(source: string): boolean {
  const statements = flowchartStatements(source)
  const edgeIds = declaredEdgeIds(statements)
  return statements.some(({ text }) =>
    hasMarkdownString(text)
    || hasUnmodeledMetadata(text)
    || hasRenderedButSourcePreservedMetadata(text)
    || isUnsupportedEdgeMetadataStatement(text, edgeIds)
    || isUnsupportedFlowchartInteraction(text)
  )
}

export function flowchartUnsupportedSyntaxWarnings(source: string): LayoutWarning[] {
  const warnings: LayoutWarning[] = []
  const statements = flowchartStatements(source)
  const edgeIds = declaredEdgeIds(statements)
  const explicitNodeIds = explicitlyDeclaredNodeIds(statements)
  for (const { text, line } of statements) {
    if (isUnsupportedEdgeMetadataStatement(text, edgeIds)) {
      warnings.push({ code: 'UNSUPPORTED_SYNTAX', line, syntax: 'flowchart_edge_metadata', message: 'Unsupported edge metadata is source-preserved and ignored by the local renderer/layout; animate, animation, and curve are modeled, and an unknown label key is not reinterpreted as a phantom node.' })
    }
    if (hasLikelyTypoEndpoint(text, explicitNodeIds)) {
      warnings.push({ code: 'UNSUPPORTED_SYNTAX', line, syntax: 'flowchart_implicit_endpoint', message: 'A bare implicit edge endpoint closely matches another declared node id. Check it for a typo; Mermaid creates a new node instead of rejecting it.' })
    }
    if (hasUnmodeledNodeMetadata(text)) {
      warnings.push({ code: 'UNSUPPORTED_SYNTAX', line, syntax: 'flowchart_node_metadata', message: 'Flowchart node metadata with an undocumented shape name is preserved as source. Documented v11 shape/label/icon/img metadata is modeled.' })
    }
    if (hasImageMetadata(text)) {
      warnings.push({ code: 'UNSUPPORTED_SYNTAX', line, syntax: 'flowchart_image_placeholder', message: 'Flowchart img metadata is typed and preserved, but static offline rendering uses a deterministic placeholder instead of fetching the authored URL.' })
    }
    if (isUnsupportedFlowchartInteraction(text)) {
      warnings.push({ code: 'UNSUPPORTED_SYNTAX', line, syntax: 'flowchart_interaction_directive', message: 'Flowchart callbacks and unsafe href directives are preserved but never made executable; safe http(s)/mailto hrefs render as inert data-href metadata.' })
    }
    if (hasMarkdownString(text)) {
      warnings.push({ code: 'UNSUPPORTED_SYNTAX', line, syntax: 'flowchart_markdown_string', message: 'Flowchart markdown strings render with bold/italic styled runs, explicit breaks, and wrapping, but remain source-preserved rather than structurally mutable. The source is preserved verbatim.' })
    }
    const malformed = malformedFlowchartStatement(text)
    if (malformed) {
      warnings.push({ code: 'UNSUPPORTED_SYNTAX', line, syntax: malformed.syntax, message: malformed.message })
    }
  }
  return warnings
}

// ---- Source ours reads where Mermaid 11.16 rejects it -----------------------

/** Flowchart source ours reads where Mermaid 11.16 rejects it, each on its
 * canonical line: a `@{…}` block with a space before `@` or inside `@{`, a
 * text-arrow label that a link of another stroke closes, and a `linkStyle`
 * index past the links defined above it. */
export function flowchartUpstreamRejectedSyntaxWarnings(source: string): LayoutWarning[] {
  const statements = flowchartStatements(source)
  const warnings: LayoutWarning[] = []
  for (const { text, line } of statements) {
    for (const region of scanFlowchart(text).regions) {
      if (region.kind === 'metadata' && (text.slice(region.start, region.contentStart) !== '@{' || /\s/.test(text[region.start - 1] ?? ''))) {
        warnings.push({ code: 'UNSUPPORTED_SYNTAX', line, syntax: 'flowchart_metadata_spacing', message: 'A @{…} metadata block with a space before "@" or inside "@{" is read as its node\'s metadata. Mermaid 11.16 rejects this; write id@{ … } with no space.' })
      }
      if (region.kind === 'edge-text' && matchTextArrow(text, region.start)?.mixed) {
        warnings.push({ code: 'UNSUPPORTED_SYNTAX', line, syntax: 'flowchart_mixed_link_label', message: 'A link label opened with one stroke and closed by a link of another (A -- b ==> B) is read as one labelled link. Mermaid 11.16 rejects this; close the label with a link of its own stroke (A == b ==> B), or use a pipe label (A ==>|b| B).' })
      }
    }
  }
  return [...warnings, ...linkStyleIndexWarnings(source, statements)]
}

const NUMBERED_LINK_STYLE_RE = /^linkStyle\s+([\d,\s]+)\s+(.+)$/

/** Each `linkStyle` index past the links defined above its line, as the
 * parser counts them (upstream's `updateLink` rejects it): one that names a
 * link defined later styles it, and one that names no link styles nothing. */
function linkStyleIndexWarnings(source: string, statements: FlowchartStatement[]): LayoutWarning[] {
  const styled = statements.flatMap(({ text, line }, at) => {
    const match = text.match(NUMBERED_LINK_STYLE_RE)
    const indices = match ? match[1]!.split(',').map(index => Number.parseInt(index.trim(), 10)).filter(Number.isInteger) : []
    return indices.length > 0 ? [{ at, line, indices }] : []
  })
  if (styled.length === 0) return []
  const header = source.split(/\r?\n/, 1)[0]!
  const edgesBefore = (at: number): number | undefined => {
    try {
      return parseMermaid([header, ...statements.slice(0, at).map(statement => statement.text)].join('\n')).edges.length
    } catch {
      return undefined // A source ours cannot read fails the render; verify reports that.
    }
  }
  const total = edgesBefore(statements.length)
  // Links only accumulate, so an index below the count before the first
  // linkStyle is in range for every later one.
  const beforeFirst = edgesBefore(styled[0]!.at)
  if (total === undefined || beforeFirst === undefined) return []
  const warnings: LayoutWarning[] = []
  for (const { at, line, indices } of styled) {
    const late = indices.filter(index => index >= beforeFirst)
    if (late.length === 0) continue
    const before = edgesBefore(at) ?? beforeFirst
    for (const index of late.filter(index => index >= before)) {
      const message = index >= total
        ? `linkStyle ${index} names no link (the flowchart has ${total}), so it styles nothing. Mermaid 11.16 rejects this; ${total === 0 ? 'remove it' : `use an index from 0 to ${total - 1}, counting links in source order`}.`
        : `linkStyle ${index} comes before the link it styles, and styles it. Mermaid 11.16 rejects this; put the linkStyle after that link.`
      warnings.push({ code: 'UNSUPPORTED_SYNTAX', line, syntax: 'flowchart_link_style_index', message })
    }
  }
  return warnings
}

// ---- `@{ ... }` metadata classification ------------------------------------

/** A "`…`" markdown string, as the lexer reads one: a lone backtick is text. */
function hasMarkdownString(statement: string): boolean {
  return statement.includes('"`') && scanFlowchart(statement).regions.some(region => region.kind === 'markdown')
}

/** Every `@{ … }` object at statement level, read as the parser reads it:
 * flowchart-lexer.ts delimits it (a quoted label masks `@{`) and
 * shared/metadata-yaml.ts reads it. A block upstream rejects stops the scan:
 * it is not opaque syntax, so the typed parser runs and reports it. */
function metadataObjects(statement: string): MetadataEntries[] {
  const out: MetadataEntries[] = []
  if (!statement.includes('@')) return out
  for (const region of scanFlowchart(statement).regions) {
    if (region.kind !== 'metadata') continue
    const block = readMetadataBlock(statement, region.contentStart - 1, 'flowchart')
    if (!block.ok) break
    out.push(block.entries)
  }
  return out
}

/** Modeled node metadata has one closed key set shared with the renderer. */
function isModeledNodeMetadata(entries: MetadataEntries): boolean {
  if (entries.size === 0) return false
  const modeled = new Set(['shape', 'label', 'icon', 'img', 'form', 'pos', 'h', 'w', 'constraint'])
  for (const key of entries.keys()) if (!modeled.has(key)) return false
  if (!entries.has('shape')) return true
  const shape = metadataText(entries.get('shape'))?.trim()
  return shape !== undefined && normalizeV11Shape(shape) !== null
}

function hasUnmodeledMetadata(statement: string): boolean {
  return metadataObjects(statement).some(entries => !isModeledNodeMetadata(entries) && !isRenderedEdgeMetadata(entries))
}

/** Metadata remains opaque only when it carries dimensions/placement fields
 * the typed node model cannot reproduce. Icon/image/form and edge
 * animation/curve metadata are closed under the serializer. */
function hasRenderedButSourcePreservedMetadata(statement: string): boolean {
  return metadataObjects(statement).some(entries => [...entries.keys()].some(key => ['pos', 'h', 'w', 'constraint'].includes(key)))
}

function isRenderedEdgeMetadata(entries: MetadataEntries): boolean {
  return entries.size > 0 && [...entries.keys()].every(key => key === 'animate' || key === 'animation' || key === 'curve')
}

/** Image metadata is modeled, but offline output announces its placeholder. */
function hasImageMetadata(statement: string): boolean {
  return metadataObjects(statement).some(entries => entries.has('img'))
}

function hasUnmodeledNodeMetadata(statement: string): boolean {
  return metadataObjects(statement).some(metadata => isNodeMetadata(metadata) && !isModeledNodeMetadata(metadata))
}

// Keyword statements where brackets/quotes are free text (subgraph labels) or
// carry no node/edge content that an unclosed delimiter could swallow.
const FLOWCHART_KEYWORD_STATEMENT = /^(?:subgraph\s|end$|direction\s|classDef\s|class\s|style\s|linkStyle\s|click\s|href\s)/i

/**
 * Detect node/edge statements with an unclosed bracket, quote, or |label|
 * delimiter. The legacy parser recovers by regex-matching whatever prefix it
 * can, silently dropping everything after the unclosed delimiter — including
 * arrows, so `A[Start --> B` loses the A→B edge entirely (audit: silent
 * content loss passed verify clean). Surfaced as UNSUPPORTED_SYNTAX so the
 * loss is announced rather than silent, mirroring the other checks above.
 */
function malformedFlowchartStatement(statement: string): { syntax: string; message: string } | null {
  if (FLOWCHART_KEYWORD_STATEMENT.test(statement)) return null
  // Metadata (`id@{ … }`) may span source lines and markdown strings go
  // opaque; both already have dedicated warnings above — skip to avoid noise.
  const scan = scanFlowchart(statement)
  if (scan.regions.some(region => region.kind === 'metadata' || region.kind === 'markdown')) return null

  if (/[A-Za-z0-9_\]\)\}]\s*(?:-->|---|-\.->|==>|~~~|--o|--x)(?:\s*\|[^|]*\|)?\s*$/.test(statement)) {
    return { syntax: 'flowchart_dangling_edge', message: 'Dangling edge operator has no target; Mermaid drops the edge during tolerant parsing. Add the endpoint or remove the operator.' }
  }

  // What the lexer leaves open at the end of the statement (quoted labels
  // have no escapes, as upstream: `\` is literal and the next `"` closes).
  if (scan.openAtEnd.includes('string')) {
    return { syntax: 'flowchart_unclosed_quote', message: 'Unclosed double quote — the parser drops or mangles everything after it (labels, arrows, edges). Close the quote.' }
  }
  if (scan.openAtEnd.includes('pipe')) {
    return { syntax: 'flowchart_unclosed_pipe', message: 'Unclosed |edge label| delimiter — the parser drops the label and the edge target after it. Close the label with a second |.' }
  }
  if (scan.openAtEnd.includes('shape')) {
    return { syntax: 'flowchart_unclosed_bracket', message: 'Unclosed bracket — the parser drops or mangles everything after it, including arrows and edges (e.g. `A[Start --> B` loses the A→B edge). Close the bracket or quote the label.' }
  }
  return null
}

export function flowchartStatements(source: string): FlowchartStatement[] {
  const statements: FlowchartStatement[] = []
  // A `id@{ ... }` metadata block may span lines (the form Mermaid's docs
  // use). Join it into ONE statement anchored at the opening line, exactly as
  // the parser does, so the node-metadata lint sees the same unit the parser
  // tokenizes — otherwise the multiline form silently misses the
  // UNSUPPORTED_SYNTAX warning the single-line form gets.
  for (const { text: raw, line } of coalesceFlowchartMetadataLines(source.split(/\r?\n/).slice(1))) {
    for (const text of splitFlowchartStatements(raw)) {
      const trimmed = text.trim()
      if (!trimmed || trimmed.startsWith('%%')) continue
      statements.push({ text: trimmed, line: line + 2 })
    }
  }
  return statements
}

function isFlowchartInteractionDirective(statement: string): boolean {
  return /^(?:click|href)\s+/i.test(statement.trim())
}

function isUnsupportedFlowchartInteraction(statement: string): boolean {
  if (!isFlowchartInteractionDirective(statement)) return false
  return !/^(?:click\s+)?[\w-]+\s+(?:href\s+)?(?:"(?:https?:|mailto:)[^"]*"|(?:https?:|mailto:)\S+)\s*$/i.test(statement.trim())
}

function declaredEdgeIds(statements: FlowchartStatement[]): Set<string> {
  const ids = new Set<string>()
  const pattern = /(?:^|\s)([A-Za-z_][\w-]*)@(?:-->|---|-\.->|==>|~~~|--o|--x|--)/g
  for (const { text } of statements) {
    let match: RegExpExecArray | null
    while ((match = pattern.exec(text)) !== null) ids.add(match[1]!)
  }
  return ids
}

function isUnsupportedEdgeMetadataStatement(statement: string, edgeIds: Set<string>): boolean {
  const trimmed = statement.trim()
  const head = trimmed.match(/^([\w-]+)\s*@\s*\{/)
  if (!head) return false
  const block = readMetadataBlock(trimmed, head[0].length - 1, 'flowchart')
  if (!block.ok || trimmed.slice(block.end + 1).trim() !== '') return false
  const { entries } = block
  if (edgeIds.has(head[1]!)) return [...entries.keys()].some(key => key !== 'animate' && key !== 'animation' && key !== 'curve')
  if (isNodeMetadata(entries)) return false
  return [...entries.keys()].some(key => key !== 'animate' && key !== 'animation' && key !== 'curve')
}


function explicitlyDeclaredNodeIds(statements: FlowchartStatement[]): Set<string> {
  const ids = new Set<string>()
  // Cover every node-declaration opener accepted by Mermaid's closed grammar,
  // including asymmetric nodes (`id>label]`) and v11 metadata (`id@{...}`).
  // Edge ids use `id@-->` and deliberately do not match the metadata branch.
  const shaped = /(?:^|\s)([A-Za-z_][\w-]*)\s*(?=\[|\(|\{|>|@\s*\{)/g
  for (const { text } of statements) {
    const bare = text.trim().match(/^([A-Za-z_][\w-]*)$/)
    if (bare) ids.add(bare[1]!)
    let match: RegExpExecArray | null
    while ((match = shaped.exec(text)) !== null) ids.add(match[1]!)
  }
  return ids
}

function hasLikelyTypoEndpoint(statement: string, explicitNodeIds: Set<string>): boolean {
  const arrow = String.raw`(?:-->|---|-\.->|==>|~~~|--o|--x)`
  const endpoint = String.raw`([A-Za-z_][\w-]*)(\s*(?:\[[^\]]*\]|\([^)]*\)|\{[^}]*\}))?`
  const match = statement.match(new RegExp(`^\\s*${endpoint}\\s*${arrow}\\s*${endpoint}\\s*$`))
  if (!match) return false
  const endpoints = [
    { id: match[1]!, shaped: Boolean(match[2]) },
    { id: match[3]!, shaped: Boolean(match[4]) },
  ]
  return endpoints.some(({ id, shaped }) => {
    if (shaped || id.length < 4 || explicitNodeIds.has(id)) return false
    return [...explicitNodeIds].some(declared => oneEditApart(declared.toLowerCase(), id.toLowerCase()))
  })
}

function oneEditApart(a: string, b: string): boolean {
  if (a === b || Math.abs(a.length - b.length) > 1) return false
  if (a.length === b.length) {
    const mismatch: number[] = []
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) mismatch.push(i)
    return mismatch.length === 1
      || (mismatch.length === 2 && mismatch[1] === mismatch[0]! + 1
        && a[mismatch[0]!] === b[mismatch[1]!] && a[mismatch[1]!] === b[mismatch[0]!])
  }
  const [shorter, longer] = a.length < b.length ? [a, b] : [b, a]
  let i = 0; let j = 0; let skipped = false
  while (i < shorter.length && j < longer.length) {
    if (shorter[i] === longer[j]) { i++; j++; continue }
    if (skipped) return false
    skipped = true; j++
  }
  return true
}


function isNodeMetadata(entries: MetadataEntries): boolean {
  return entries.has('shape') || entries.has('label') || entries.has('icon') || entries.has('img')
}
