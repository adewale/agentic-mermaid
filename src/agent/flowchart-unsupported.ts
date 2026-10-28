import type { LayoutWarning } from './types.ts'
import { normalizeV11Shape } from '../flowchart-shapes.ts'
import { emptyFlowchartGraph, flowchartStatementNotes, parseMermaid, splitFlowchartStatements, splitInlineHeaderStatements } from '../parser.ts'
import { coalesceFlowchartLines, FLOWCHART_EDGE_ID_SOURCE, FLOWCHART_LINK_SOURCE, flowchartNodeIdLength, flowchartStatementSpans, flowchartStyleValueCanSerialize, matchTextArrow, scanFlowchart } from '../flowchart-lexer.ts'
import { metadataText, readMetadataBlock } from '../shared/metadata-yaml.ts'
import { parseAccessibilityDirective } from '../shared/accessibility-directives.ts'
import { mermaidEntityPrepass } from '../shared/mermaid-entities.ts'
import { cleanupMermaidSource } from '../shared/mermaid-cleanup.ts'
import { parseStyleProps } from '../shared/style-props.ts'

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

// ---- Source ours reads where pinned Mermaid rejects it -----------------------

/** Flowchart source ours reads where pinned Mermaid rejects it, each on its
 * canonical line: a `@{…}` block with a space before `@` or inside `@{`, a
 * text-arrow label that a link of another stroke closes, a `linkStyle`
 * index past the links defined above it, an `end` with no subgraph open
 * (alone or before a statement: `end B`), a subgraph no `end` closes, an
 * empty quoted label (`A[""]`) or pipe label (`A -->|| B`), label text
 * holding a character upstream's lexer reads as a delimiter there, a
 * subgraph title it cannot read without quotes, a `;` ours ends a statement
 * at where pinned Mermaid's entity prepass reads it otherwise, a `;` between
 * style properties, which Mermaid reads as ending the statement, and a link
 * repeating an earlier link's edge id, which Mermaid accepts and, as ours
 * does, leaves off that link. */
export function flowchartUpstreamRejectedSyntaxWarnings(source: string): LayoutWarning[] {
  const statements = flowchartStatements(source)
  const warnings: LayoutWarning[] = []
  // The lines of the subgraphs open so far.
  const openSubgraphs: number[] = []
  // The links read so far, whose edge ids a later link may repeat.
  const graph = emptyFlowchartGraph()
  for (const { text, line } of statements) {
    if (/^subgraph(?![\w-])/.test(text) && /direction\s+(?:TB|BT|RL|LR|TD)/.test(text)) warnings.push({
      code: 'UNSUPPORTED_SYNTAX', line, syntax: 'flowchart_subgraph_direction_text',
      message: 'Direction-like text in a subgraph title is read as its label. Pinned Mermaid consumes the whole line as a direction token, even inside quotes; canonical export protects the label with an entity code.',
    })
    if (/^subgraph(?![\w-])/.test(text)) openSubgraphs.push(line)
    else if (text === 'end' && openSubgraphs.length > 0) openSubgraphs.pop()
    else if (text === 'end') {
      warnings.push({ code: 'UNSUPPORTED_SYNTAX', line, syntax: 'flowchart_stray_end', message: 'An `end` with no subgraph open closes nothing and is ignored. Pinned Mermaid rejects this; remove it.' })
    }
    // Mermaid's lexer reads a label after its cleanup gives a tag's
    // attributes single quotes; that rewrite itself is mermaid_cleanup's.
    const notes = text.startsWith('subgraph') || /[@[\](){}|"]/.test(text) ? flowchartStatementNotes(text.includes('<') ? cleanupMermaidSource(text).upstreamText : text, graph) : undefined
    if (/^(?:style|classDef|linkStyle)\s/.test(text) && scanFlowchart(text).separators.length > 0) {
      warnings.push({ code: 'UNSUPPORTED_SYNTAX', line, syntax: 'flowchart_style_semicolon', message: 'A `;` between style properties (fill:#f9f;stroke:#0a0) is read as separating them, as in CSS. Pinned Mermaid ends the statement at the `;` and reads the next property as a node (stroke:blue), or, after a `#` color, joins the two into one declaration that paints nothing; separate style properties with `,`.' })
    }
    const style = /^(?:style|classDef)\s+\S+\s+(.+)$/.exec(text) ?? /^linkStyle\s+(?:default|[\d,\s]+)\s+(.+)$/.exec(text)
    const unspellable = style && Object.entries(parseStyleProps(style[1]!)).find(([, value]) => !flowchartStyleValueCanSerialize(value, style[0].startsWith('classDef')))
    if (unspellable) warnings.push({ code: 'UNSUPPORTED_SYNTAX', line, syntax: 'flowchart_style_value', message: `Flowchart style ${unspellable[0]}:${unspellable[1]} is read as native CSS, but pinned Mermaid's inline-style tokens cannot preserve it. The source and drawing are retained; typed style editing is unavailable.` })
    if (notes?.has('empty-string')) {
      warnings.push({ code: 'UNSUPPORTED_SYNTAX', line, syntax: 'flowchart_empty_string', message: 'An empty quoted label (A[""], A -->|""| B, subgraph S[""]) is read as an empty label. Pinned Mermaid reads no empty string, and rejects this; put a blank between the quotes (A[" "]), which reads back as an empty label.' })
    }
    if (notes?.has('empty-pipe-label')) {
      warnings.push({ code: 'UNSUPPORTED_SYNTAX', line, syntax: 'flowchart_empty_pipe_label', message: 'A pipe label with nothing between its pipes (A -->|| B) is read as a link with no label. Pinned Mermaid reads no pipe label without text, and rejects this; leave the pipes out (A --> B), as the writer does, or put a blank between them (A -->| | B).' })
    }
    if (notes?.has('subgraph-title')) {
      warnings.push({ code: 'UNSUPPORTED_SYNTAX', line, syntax: 'flowchart_subgraph_title', message: 'This subgraph title is read as its text. Without quotes, pinned Mermaid reads only letters, digits, blanks, the backtick and !#$%&\'*+-./:?\\^_ in a title, with no link, `:::` or `"` starting a word, and rejects this one; quote the title (subgraph "a (b)"), or give an id and a quoted bracket title (subgraph id["a (b)"]).' })
    }
    if (notes?.has('node-edge-id')) {
      warnings.push({ code: 'UNSUPPORTED_SYNTAX', line, syntax: 'flowchart_node_edge_id', message: 'Text that runs on without a blank to an `@`, from a node or subgraph id into its label (A[a@b]) or from the opening pipe of a pipe label (A -->|a@b| B), is read as the id and the label. Pinned Mermaid reads that run as an edge id (any run without blanks or `"` before `@`), and rejects the statement; quote the label (A["a@b"], A -->|"a@b"| B), or put a blank after its opening bracket or pipe.' })
    }
    if (notes?.has('duplicate-edge-id')) {
      warnings.push({ code: 'UNSUPPORTED_SYNTAX', line, syntax: 'flowchart_duplicate_edge_id', message: 'A link whose edge id an earlier link already has (A e1@--> B, then C e1@--> D) is drawn without it: the id names the first link alone, and the writer leaves it off the later one. Pinned Mermaid accepts this and does the same, giving the later link an id of its own; give each link its own edge id.' })
    }
    if (notes?.has('label-delimiter')) {
      warnings.push({ code: 'UNSUPPORTED_SYNTAX', line, syntax: 'flowchart_label_delimiter', message: 'Label text holding `(`, `)`, `[`, `]`, `{`, `}`, `|`, or a `"` after the text begins, is read as written. Pinned Mermaid reads these as delimiters in unquoted text, and rejects this; put the whole label in double quotes (A["a (b) c"]), writing a `"` inside it as #quot;.' })
    }
    for (const region of scanFlowchart(text).regions) {
      if (region.kind === 'metadata' && (text.slice(region.start, region.contentStart) !== '@{' || /\s/.test(text[region.start - 1] ?? ''))) {
        warnings.push({ code: 'UNSUPPORTED_SYNTAX', line, syntax: 'flowchart_metadata_spacing', message: 'A @{…} metadata block with a space before "@" or inside "@{" is read as its node\'s metadata. Pinned Mermaid rejects this; write id@{ … } with no space.' })
      }
      if (region.kind === 'edge-text' && matchTextArrow(text, region.start)?.mixed) {
        warnings.push({ code: 'UNSUPPORTED_SYNTAX', line, syntax: 'flowchart_mixed_link_label', message: 'A link label opened with one stroke and closed by a link of another (A -- b ==> B) is read as one labelled link. Pinned Mermaid rejects this; close the label with a link of its own stroke (A == b ==> B), or use a pipe label (A ==>|b| B).' })
      }
    }
  }
  for (const line of openSubgraphs) {
    warnings.push({ code: 'UNSUPPORTED_SYNTAX', line, syntax: 'flowchart_unclosed_subgraph', message: 'A subgraph with no `end` holds everything after it, to the end of the diagram. Pinned Mermaid rejects this; close it with `end`.' })
  }
  return [...warnings, ...entitySemicolonWarnings(source), ...linkStyleIndexWarnings(source, statements)]
}

/**
 * Each line holding a `;` ours ends a statement at (a statement-level `;`, as
 * the lexer reads the line's group) where pinned Mermaid's entity prepass,
 * which runs on each physical line before its lexer, reads it otherwise:
 * the end of an entity code (`#fff;`), or the last `;` of a line where
 * `style` or `classDef` precedes `:…#`, which it drops, joining the text
 * after it to the statement.
 */
function entitySemicolonWarnings(source: string): LayoutWarning[] {
  const lines = source.split(/\r?\n/)
  const warnings: LayoutWarning[] = []
  for (const group of coalesceFlowchartLines(lines)) {
    if (group.directive || !group.text.includes(';') || group.text.trimStart().startsWith('%%')) continue
    // The `;`s that end a statement: not one between style properties.
    const scan = scanFlowchart(group.text)
    const statements = flowchartStatementSpans(group.text, scan)
    const separators = new Set(scan.separators.filter(at => !statements.some(statement => at > statement.start && at < statement.start + statement.text.length)))
    // Where each physical line's text begins in the group, and at which column.
    for (const piece of [{ at: 0, line: group.line, col: 0 }, ...(group.joined ?? [])]) {
      if (prepassSemicolons(lines[piece.line]!).some(at => at >= piece.col && separators.has(piece.at + at - piece.col))) {
        warnings.push({ code: 'UNSUPPORTED_SYNTAX', line: piece.line + 1, syntax: 'flowchart_entity_semicolon', message: 'Ours ends a statement at a `;` here. Pinned Mermaid reads `#name;` as an entity code, and drops the last `;` of a line where `style` or `classDef` comes before `:…#`, so there the `;` ends nothing: it rejects the line, or reads the text after the `;` into the statement. Drop the `;`, and put any statement after it on its own line.' })
      }
    }
  }
  return warnings
}

/** The offsets in `line` of the `;`s pinned Mermaid's entity prepass takes:
 * each that ends an entity code after its `style`/`classDef` strip, and each
 * it strips with more than blanks after it on the line. */
function prepassSemicolons(line: string): number[] {
  if (!line.includes(';')) return []
  const prepassed = mermaidEntityPrepass(line)
  // The prepass only deletes `;`s, the last ones of the line: pair the rest.
  const origin: number[] = []
  const taken: number[] = []
  for (let at = 0, kept = 0; at < line.length; at++) {
    if (kept < prepassed.length && line[at] === prepassed[kept]) origin[kept++] = at
    else if (line.slice(at + 1).trim() !== '') taken.push(at)
  }
  for (const code of prepassed.matchAll(/#\w+;/g)) taken.push(origin[code.index + code[0].length - 1]!)
  return taken
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
        ? `linkStyle ${index} names no link (the flowchart has ${total}), so it styles nothing. Pinned Mermaid rejects this; ${total === 0 ? 'remove it' : `use an index from 0 to ${total - 1}, counting links in source order`}.`
        : `linkStyle ${index} comes before the link it styles, and styles it. Pinned Mermaid rejects this; put the linkStyle after that link.`
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

/** A statement that ends in a link (with an optional pipe label) after a
 * node: the link has no target. A `.` right after id characters is the id's
 * (`B.-` is a node), so a link the node runs straight into begins otherwise. */
const DANGLING_LINK_RE = new RegExp(String.raw`[\p{L}\p{N}_\])}](?:\s+|(?!\.))${FLOWCHART_LINK_SOURCE}(?:\s*\|[^|]*\|)?\s*$`, 'u')

/**
 * Detect node/edge statements with an unclosed bracket, quote, or |label|
 * delimiter. The legacy parser recovers by regex-matching whatever prefix it
 * can, silently dropping everything after the unclosed delimiter — including
 * arrows, so `A[Start --> B` loses the A→B edge entirely (audit: silent
 * content loss passed verify clean). Surfaced as UNSUPPORTED_SYNTAX so the
 * loss is announced rather than silent, mirroring the other checks above.
 */
function malformedFlowchartStatement(statement: string): { syntax: string; message: string } | null {
  if (statement === 'subgraph') {
    return { syntax: 'flowchart_untitled_subgraph', message: 'A subgraph with neither an id nor a title cannot be read: pinned Mermaid fails on it, and ours rejects it. Give it an id or a title (subgraph S, or subgraph S["Stage one"]).' }
  }
  if (FLOWCHART_KEYWORD_STATEMENT.test(statement)) return null
  // Metadata (`id@{ … }`) may span source lines and markdown strings go
  // opaque; both already have dedicated warnings above — skip to avoid noise.
  const scan = scanFlowchart(statement)
  if (scan.regions.some(region => region.kind === 'metadata' || region.kind === 'markdown')) return null

  // Where the parse stops at a node id upstream reads and ours does not
  // (its id grammar takes a `,` into a node id: `A,B` and `,A` are one node
  // there), or at a link label whose markers make no link type there.
  const rejected = /,|[xo](?:--|-\.|==)/.test(statement) ? flowchartStatementNotes(statement) : undefined
  if (rejected?.has('comma-id')) {
    return { syntax: 'flowchart_comma_id', message: 'A "," in a node id (right after its characters, or where a node begins) is part of the id in Mermaid (`A,B` and `,A` are one node there). Ours reads no "," in a node id and rejects the statement; rename the node, or write `A & B` to list two nodes.' }
  }
  if (rejected?.has('link-markers')) {
    return { syntax: 'flowchart_link_markers', message: 'A link label opened with an `x` or `o` marker and closed by a link with another end (A x-- a --> B) is a link of no type in Mermaid. Ours rejects it; put the same marker at both ends (A x-- a --x B), or none (A -- a --> B).' }
  }

  if (DANGLING_LINK_RE.test(statement)) {
    return { syntax: 'flowchart_dangling_edge', message: 'Dangling edge operator has no target, so Mermaid rejects the diagram. Add the endpoint or remove the operator.' }
  }

  // What the lexer leaves open at the end of the statement (quoted labels
  // have no escapes, as upstream: `\` is literal and the next `"` closes).
  // One the parser reads as label text (`A[a ( b]`, `A[a"]`) is reported as
  // such (flowchart_label_delimiter), not as unclosed.
  if (scan.openAtEnd.length > 0 && flowchartStatementNotes(statement).has('label-delimiter')) return null
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
  // A `id@{ ... }` metadata block, a label or a link may span lines (the
  // form Mermaid's docs use for metadata). Join it into ONE statement anchored
  // at the opening line, exactly as the parser does, so the lints see the same
  // unit the parser tokenizes — otherwise the multiline form silently misses
  // the UNSUPPORTED_SYNTAX warning the single-line form gets, or reports a
  // delimiter or link the next line closes. The header line joins in too: a
  // statement after `;` on it (`flowchart TD;A["x`) may run on.
  // An accTitle/accDescr directive is no flowchart statement; one written
  // after a block's `}` on its line is.
  for (const { text: raw, line, directive, joined } of coalesceFlowchartLines(source.split(/\r?\n/))) {
    if (directive) {
      const suffix = parseAccessibilityDirective(raw.split('\n'), 0)?.suffixLine ?? ''
      for (const text of splitFlowchartStatements(suffix)) statements.push({ text, line: (joined?.at(-1)?.line ?? line) + 1 })
      continue
    }
    const texts = line === 0 ? splitInlineHeaderStatements(raw.trim())?.statements ?? [] : splitFlowchartStatements(raw)
    for (const text of texts) {
      const trimmed = text.trim()
      if (!trimmed || trimmed.startsWith('%%')) continue
      statements.push({ text: trimmed, line: line + 1 })
    }
  }
  return statements
}

function isFlowchartInteractionDirective(statement: string): boolean {
  return /^(?:click|href)\s+/i.test(statement.trim())
}

function isUnsupportedFlowchartInteraction(statement: string): boolean {
  if (!isFlowchartInteractionDirective(statement)) return false
  return !/^(?:click\s+)?\S+\s+(?:href\s+)?(?:"(?:https?:|mailto:)[^"]*"|(?:https?:|mailto:)\S+)\s*$/i.test(statement.trim())
}

function declaredEdgeIds(statements: FlowchartStatement[]): Set<string> {
  const ids = new Set<string>()
  const pattern = new RegExp(String.raw`(?:^|\s)(${FLOWCHART_EDGE_ID_SOURCE})@\s*(?:${FLOWCHART_LINK_SOURCE}|--)`, 'gu')
  for (const { text } of statements) {
    let match: RegExpExecArray | null
    while ((match = pattern.exec(text)) !== null) ids.add(match[1]!)
  }
  return ids
}

function isUnsupportedEdgeMetadataStatement(statement: string, edgeIds: Set<string>): boolean {
  const trimmed = statement.trim()
  // The id before `@{` is a node id (flowchartNodeIdLength), as the parser reads it.
  const idLength = flowchartNodeIdLength(trimmed)
  const open = idLength > 0 ? /^\s*@\s*\{/.exec(trimmed.slice(idLength)) : null
  if (!open) return false
  const block = readMetadataBlock(trimmed, idLength + open[0].length - 1, 'flowchart')
  if (!block.ok || trimmed.slice(block.end + 1).trim() !== '') return false
  const { entries } = block
  if (edgeIds.has(trimmed.slice(0, idLength))) return [...entries.keys()].some(key => key !== 'animate' && key !== 'animation' && key !== 'curve')
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
  const arrow = `(?:${FLOWCHART_LINK_SOURCE})`
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
