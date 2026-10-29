import { parseClassLikeStyleProps } from './shared/class-like-style.ts'
import { scanStateComments } from './state/comment.ts'
import { readStateLabel, readStateText } from './state/text.ts'
import { resolveStateIdentities, type StateIdentities } from './state/identity.ts'
import type { LabelContent } from './shared/display-text.ts'
import { parseFlowchartLabel, unquoteFlowchartLabel } from './flowchart-labels.ts'
import { normalizeV11Shape } from './flowchart-shapes.ts'
import { normalizeBrTags } from './multiline-utils.ts'
import { assertDiagramWorkLimit } from './shared/diagram-limits.ts'
import { appendGraphClass } from './shared/graph-classes.ts'
import { observeParserMutation, observeParserStatement, observeParserToken, parserObservationActive } from './shared/parser-observation.ts'
import { mergeStyleProps, parseStyleProps } from './shared/style-props.ts'
import { createSubgraphMembership } from './shared/subgraph-membership.ts'
import {
  historyLabel,
  isConcurrencySeparator,
  isNoteEnd,
  matchHistoryEndpoint,
  matchNoteLine, matchNoteOpen, matchFloatingNote,
  matchStateClassAssignment, matchStateDeclarationLine, matchStateLayoutDirective,
  matchStereotypeDecl, matchTransitionLine, readStateStatements,
  STATE_ALIAS_RE,
  STATE_CLASS_DEF_RE, STATE_COMPOSITE_OPEN_RE, STATE_DESCRIPTION_RE,
  STATE_DIRECTION_RE,
  STATE_LINK_STYLE_RE, STATE_STYLE_RE, type StateStatement,
} from './state/parse-core.ts'
import type { Direction, EdgeMarker, EdgeStyle, MermaidEdge, MermaidGraph, MermaidNode, MermaidSubgraph, NodeShape } from './types.ts'

export { parseStyleProps } from './shared/style-props.ts'
import { detectCompatibilityGraphFamilyFromFirstLine } from './agent/family-router.ts'
import { classifyMermaidFamilyFromFirstLine } from './family-detection.ts'
import { checkedFlowchartStyleProps, coalesceFlowchartLines, commaInNodeId, continuesNodeId, findTextArrow, FLOWCHART_EDGE_ID_SOURCE, FLOWCHART_LINK_SOURCE, flowchartNodeIdLength, flowchartRegionAt, flowchartStatementSpans, labelReferencesAsEntityCodes, labelTextHoldsDelimiter, matchFlowchartLink, matchTextArrow, subgraphTitleUnreadable } from './flowchart-lexer.ts'
import { consumeClassShorthandPrefix,
  MERMAID_IDENTIFIER_SOURCE, parseClassShorthandStatement } from './shared/mermaid-identifiers.ts'
import { metadataText, readMetadataBlock } from './shared/metadata-yaml.ts'
import { DeferredDependencyError } from './layout/certification-error.ts'
import { syntaxError } from './shared/syntax-error.ts'

// ============================================================================
// Mermaid parser — flowcharts and state diagrams
//
// Supports:
//   Flowcharts: graph TD / flowchart LR
//   State diagrams: stateDiagram-v2
//
// Line-by-line regex approach — the grammar is regular enough
// that we don't need a grammar generator or full parser combinator.
// ============================================================================

/**
 * Parse Mermaid text into a logical graph structure.
 * Auto-detects diagram type (flowchart or state diagram).
 * Throws on invalid/unsupported input.
 */
/**
 * The flowchart a renderer draws, given its source as authored and as the
 * render path entity-decodes it (render-contract.ts): the authored text, as
 * Mermaid's parser and the typed body read it, with each XML reference in
 * label text read as the Mermaid code for its character, so the label shows
 * it (flowchart-lexer.ts labelReferencesAsEntityCodes); where ours cannot
 * read the authored text, the decoded one, as a page hands HTML-escaped
 * Mermaid (`A --&gt; B`) to Mermaid's browser runner.
 */
export function parseFlowchartRenderSource(authoredFamilyText: string, decodedFamilyText: string): MermaidGraph {
  if (authoredFamilyText === decodedFamilyText) return parseMermaid(decodedFamilyText)
  try {
    return parseMermaid(labelReferencesAsEntityCodes(authoredFamilyText))
  } catch (error) {
    if (error instanceof DeferredDependencyError) throw error
    return parseMermaid(decodedFamilyText)
  }
}

export function parseMermaid(text: string): MermaidGraph {
  const rawLines = text.split('\n')
  const firstStatement = rawLines.find(line => line.trim().length > 0 && !line.trim().startsWith('%%'))?.trim() ?? ''
  // State note text must not pass through Flowchart's string coalescers or
  // the generic whole-line comment filter. A `//` line is dropped only
  // outside a string, which reads it as text, as the typed body does.
  const state = /^stateDiagram(?:-v2)?(?=$|[\s;%])/i.test(firstStatement)
  const statements = state ? [] : coalesceStatementLines(rawLines)
  const lines = expandInlineHeaderStatements(state
    ? scanStateComments(rawLines).filter((line, index, scanned) => line.noteBody
      || (line.text.length > 0 && (!line.text.startsWith('//') || scanned[index - 1]?.openQuote === true))).map(line => line.text)
    : statements.map(statement => statement.text))
  // The statements a header line holds (`flowchart TD; A`) start the lines.
  const headerStatements = lines.length - statements.length
  const breaks = headerStatements > 0
    ? [...Array<undefined>(headerStatements + 1), ...statements.slice(1).map(statement => statement.breaks)]
    : statements.map(statement => statement.breaks)

  if (lines.length === 0) {
    throw new Error('Empty mermaid diagram')
  }

  // Detect diagram type from header
  const header = lines[0]!

  const detection = classifyMermaidFamilyFromFirstLine(header, 'strict')
  const familyId = detection.kind === 'registered'
    ? detection.familyId
    : detectCompatibilityGraphFamilyFromFirstLine(header)

  if (familyId === 'state') {
    return parseStateDiagram(lines)
  }
  if (familyId === 'flowchart') return parseFlowchart(lines, breaks)

  if (detection.kind === 'unknown') throw new Error(`Unknown Mermaid diagram header: ${header}`)
  const detectedFamilyId = detection.kind === 'registered' ? detection.familyId : detection.match.family.id

  // This compatibility API returns a MermaidGraph and therefore cannot
  // truthfully parse non-graph families. Family-neutral callers should use
  // the agent parser instead of falling through to the flowchart grammar.
  throw new Error(`Mermaid family "${detectedFamilyId}" is not a graph family; use the family-neutral agent parser`)
}

function expandInlineHeaderStatements(lines: string[]): string[] {
  const split = lines.length > 0 ? splitInlineHeaderStatements(lines[0]!) : undefined
  return split ? [split.header, ...split.statements, ...lines.slice(1)] : lines
}

/** A trimmed header line with statements after `;` (`flowchart TD; A`):
 * the header, and the statements after it; undefined for a bare header. */
export function splitInlineHeaderStatements(line: string): { header: string; statements: string[] } | undefined {
  if (!line.includes(';')) return undefined
  // The header's direction (`graph >`) is not a statement: split after it.
  const header = line.match(/^(?:(?:graph|flowchart|swimlane)(?:[ \t]+(?:TD|TB|LR|BT|RL|[<>^v])(?![\w-]))?|stateDiagram(?:-v2)?)(?=$|[\s;])/i)
  if (!header) return undefined
  const rest = line.slice(header[0].length).trim()
  if (!rest.startsWith(';')) return undefined
  // The State reader splits its own statements (readStateStatements).
  return { header: header[0], statements: /^stateDiagram/i.test(header[0]) ? [rest] : splitFlowchartStatements(rest) }
}

/**
 * The parser is line-oriented, but upstream's lexer is not: a string, label,
 * `@{…}` block or link may run across lines. flowchart-lexer.ts joins each
 * such run into one line, a label's line breaks as '<br>' — the label
 * pipeline's canonical line-break token — so the single-line shape grammars
 * keep matching and the label normalizer restores '\n'.
 */
function coalesceStatementLines(lines: string[]): Array<{ text: string; breaks?: number[] }> {
  return coalesceFlowchartLines(lines).flatMap(group => {
    const text = group.text.trim()
    if (!text || text.startsWith('%%')) return []
    // Where each later line joined on, in the trimmed text.
    const lead = group.text.length - group.text.trimStart().length
    return [{ text, ...(group.joined ? { breaks: group.joined.map(piece => piece.at - lead) } : {}) }]
  })
}

/** A subgraph title `id[title]`: the id and the title's text as authored. */
function subgraphBracketTitle(rest: string): { id: string; title: string } | undefined {
  // Delimiter scanning is deliberately linear. A lazy `(.+?)` matcher followed
  // by a bracketed label backtracked quadratically over long unterminated runs
  // of `[` — an input shape that fits the hosted 64 KiB source limit.
  const labelStart = rest.indexOf('[')
  return labelStart > 0 && labelStart < rest.length - 1 && rest.endsWith(']')
    ? { id: rest.slice(0, labelStart).trim(), title: rest.slice(labelStart + 1, -1) }
    : undefined
}

/** A subgraph declaration: `titled` when it has a bracket title, whose id
 * part names the group, repeats included, whatever it holds. */
type SubgraphDeclaration = Pick<MermaidSubgraph, 'id' | 'label' | 'labelContent'> & { generated: boolean; identity: string; titled: boolean }

function parseFlowchartSubgraphDeclaration(rest: string): SubgraphDeclaration {
  const titled = subgraphBracketTitle(rest)
  if (titled) {
    const parsed = parseFlowchartLabel(titled.title)
    const label = { label: parsed.text, ...(parsed.labelContent ? { labelContent: parsed.labelContent } : {}) }
    if (isFlowchartNodeId(titled.id)) return { id: titled.id, ...label, generated: false, identity: titled.id, titled: true }
    // Upstream's id there is any title it reads without brackets (`a b`,
    // `"a b"`); one that is no node id cannot be named in a link, so ours
    // derives one, as for a title alone.
    if (subgraphTitleUnreadable(titled.id)) {
      throw new Error(`Invalid flowchart subgraph identifier ${JSON.stringify(titled.id)}`)
    }
    const identity = unquoteFlowchartLabel(titled.id).trim()
    if (isFlowchartNodeId(identity)) return { id: identity, ...label, generated: false, identity, titled: true }
    return { id: derivedSubgraphId(identity), ...label, generated: true, identity, titled: true }
  }
  const parsed = parseFlowchartLabel(rest)
  // Identity comes from the logical source spelling, before display decoding.
  // Two titles can paint identically without naming the same container. A
  // markdown string's identity is its text, as upstream's id is.
  const unquoted = unquoteFlowchartLabel(rest).trim()
  const identity = unquoted !== rest && /^`[\s\S]*`$/.test(unquoted) ? unquoted.slice(1, -1).trim() : unquoted
  // A title that is one node id (`a.b`, `**Two**`) is the subgraph's id, as
  // upstream reads it there, so a link to that id ends at the subgraph.
  if (isFlowchartNodeId(identity)) {
    return { id: identity, label: parsed.text, ...(parsed.labelContent ? { labelContent: parsed.labelContent } : {}), generated: false, identity, titled: false }
  }
  return { id: derivedSubgraphId(identity), label: parsed.text, ...(parsed.labelContent ? { labelContent: parsed.labelContent } : {}), generated: true, identity, titled: false }
}

/** A container id derived from a subgraph's identity. Mermaid identifiers
 * are Unicode-aware everywhere else in this parser: non-Latin letters and
 * numbers stay, so a CJK title does not collapse to an empty string. A markup
 * tag separates words like a space: a line break the title runs across is
 * `<br>` here (coalesceFlowchartLines), and `a<br>b` is `a_b`, not `abrb`. */
function derivedSubgraphId(identity: string): string {
  return identity.replace(/<\/?[a-z][^<>]*>/gi, ' ').trim().replace(/\s+/g, '_').replace(/[^\p{L}\p{N}_-]/gu, '').replace(/-{2,}/g, '_') || 'group'
}

/** Whether `text` is one whole node id (flowchartNodeIdLength). */
function isFlowchartNodeId(text: string): boolean {
  return text.length > 0 && flowchartNodeIdLength(text) === text.length
}

/** Shared statement splitter for renderer and source-side action analysis:
 *  a `;` ends a statement where the flowchart lexer (flowchart-lexer.ts)
 *  reads it at statement level. */
export function splitFlowchartStatements(line: string): string[] {
  return flowchartStatementSpans(line).map(statement => statement.text)
}

/** A `class` or `style` statement's match, when its first operand is a `,`
 * list of node ids (flowchartNodeIdLength), else null. */
function nodeIdListStatement(match: RegExpMatchArray | null): RegExpMatchArray | null {
  return match && match[1]!.split(',').every(id => id === '' || flowchartNodeIdLength(id) === id.length) ? match : null
}

function isFlowchartInteractionDirective(line: string): boolean {
  return /^(?:click|href)\s+/i.test(line.trim())
}

function applyFlowchartInteraction(graph: MermaidGraph, line: string): void {
  const match = line.trim().match(/^(?:click\s+)?(\S+)\s+(?:href\s+)?(?:"((?:\\.|[^"])*)"|(https?:\/\/\S+|mailto:\S+))/i)
  if (!match) return
  const href = (match[2] ?? match[3] ?? '').replace(/\\(["\\])/g, '$1')
  if (!/^(?:https?:|mailto:)/i.test(href)) return
  const node = graph.nodes.get(match[1]!)
  if (node) {
    node.href = href
    if (parserObservationActive('flowchart')) observeParserMutation('flowchart', 'set-interaction', { id: node.id, href })
  }
}

/** Upstream's metadata token is exactly `@{`, right after its id. Ours also
 * reads a space before `@` or inside `@{`; verify reports it. */
const METADATA_OPEN_SOURCE = String.raw`\s*@\s*\{`

/** Read the `@{…}` block whose `{` is at `open` as upstream does (YAML under
 * upstream's lexer, shared/metadata-yaml.ts); a block upstream rejects is a
 * syntax error here too. */
function readFlowchartMetadata(statement: string, open: number): { end: number; entries: ReadonlyMap<string, unknown> } {
  const block = readMetadataBlock(statement, open, 'flowchart')
  if (!block.ok) {
    throw syntaxError({
      what: `Invalid @{} metadata in "${statement}": ${block.message}`,
      expectedForm: 'a YAML mapping with "double-quoted" strings (a single-quoted one may not hold `"` or `}`)',
      example: 'A@{ shape: rect, label: "Start: a}b" }',
    })
  }
  return block
}

/** A metadata text field: upstream reads only a truthy value. */
function metadataField(entries: ReadonlyMap<string, unknown>, key: string): string | undefined {
  return metadataText(entries.get(key))?.trim() || undefined
}

interface MetadataStatement {
  id: string
  entries: ReadonlyMap<string, unknown>
}

function applyFlowchartEdgeMetadata(graph: MermaidGraph, { id, entries }: MetadataStatement): void {
  const edge = graph.edges.find(candidate => candidate.id === id)
  if (!edge) return
  const curve = metadataField(entries, 'curve')
  if (curve && /^[a-z][a-z0-9-]*$/i.test(curve)) edge.curve = curve
  const animate = metadataField(entries, 'animate')?.toLowerCase()
  const animation = metadataField(entries, 'animation')?.toLowerCase()
  if (animate === 'true' || animate === 'fast' || animate === 'slow' || animation === 'fast' || animation === 'slow') {
    edge.animate = true
    const speed = animate === 'fast' || animate === 'slow' ? animate : animation
    if (speed === 'fast' || speed === 'slow') edge.animation = speed
  }
  if (parserObservationActive('flowchart')) observeParserMutation('flowchart', 'set-edge-metadata', edge)
}

/** A whole `id@{…}` statement that addresses an edge, or null. Ours also
 * reads `id @{…}` and `id@ {…}` (METADATA_OPEN_SOURCE). */
function edgeMetadataStatement(graph: MermaidGraph, line: string): MetadataStatement | null {
  const statement = line.trim()
  // Upstream reads the id before `@{` as a node id (`e.1@{…}`).
  const idLength = flowchartNodeIdLength(statement)
  const open = idLength > 0 ? statement.slice(idLength).match(new RegExp(`^${METADATA_OPEN_SOURCE}`)) : null
  if (!open) return null
  const { end, entries } = readFlowchartMetadata(statement, idLength + open[0].length - 1)
  if (statement.slice(end + 1).trim() !== '') return null
  const id = statement.slice(0, idLength)
  // As upstream's `addVertex`: the block addresses an edge declared so far
  // with that id; otherwise it declares (or refines) a node.
  return graph.edges.some(edge => edge.id === id) ? { id, entries } : null
}

// ============================================================================
// Flowchart parser
// ============================================================================

// Count open containers as well as closed ones without exposing parser work
// bookkeeping in the authored graph or its observation snapshots.
const graphContainerCounts = new WeakMap<MermaidGraph, number>()
function assertGraphNodeInsertion(graph: MermaidGraph): void {
  assertDiagramWorkLimit('nodes', graph.nodes.size + (graphContainerCounts.get(graph) ?? 0) + 1)
}

function parseFlowchart(lines: string[], breaks: ReadonlyArray<readonly number[] | undefined> = []): MermaidGraph {
  const headerMatch = lines[0]!.match(/^(?:(?:graph|swimlane)\s+(TD|TB|LR|BT|RL|[<>^v])|flowchart(?:\s+(TD|TB|LR|BT|RL|[<>^v]))?)\s*$/i)
  if (!headerMatch) {
    throw new Error(`Invalid mermaid header: "${lines[0]}". Expected "graph TD", "flowchart LR", "stateDiagram-v2", etc.`)
  }

  const direction = normalizeFlowchartDirection(headerMatch[1] ?? headerMatch[2] ?? 'TD')
  if (parserObservationActive('flowchart')) {
    observeParserStatement('flowchart', 'header', lines[0]!, { line: 1, unit: 'normalized' })
    observeParserMutation('flowchart', 'set-direction', direction)
  }

  const graph: MermaidGraph = {
    direction,
    nodes: new Map(),
    edges: [],
    subgraphs: [],
    classDefs: new Map(),
    classAssignments: new Map(),
    nodeStyles: new Map(),
    linkStyles: new Map(),
  }

  // Subgraph stack for nested subgraphs.
  const subgraphStack: MermaidSubgraph[] = []
  const subgraphsById = new Map<string, MermaidSubgraph>()
  const placedSubgraphs = new Set<string>()
  const declarations = collectFlowchartSubgraphDeclarations(lines.slice(1), breaks.slice(1))
  let nextDeclaration = 0
  const declaredSubgraphIds = new Set([...declarations.values()].map(group => group.id))
  // Upstream's membership rule: the first subgraph to close keeps a node.
  const membership = createSubgraphMembership()
  // Resolve group references after all declarations have closed.
  const listings: Array<{ lister: string; ids: string[] }> = []

  /** Close the innermost open subgraph, if any. */
  const closeSubgraph = (): void => {
    const completed = subgraphStack.pop()
    if (!completed) return
    // A repeated declaration extends one container; every projection
    // sees the same members, first title and unique group identity.
    const canonical = subgraphsById.get(completed.id)!
    const members = membership.close(completed.id, completed.nodeIds)
    const listed = members.filter(id => declaredSubgraphIds.has(id) && id !== completed.id)
    if (listed.length) listings.push({ lister: completed.id, ids: listed })
    canonical.nodeIds = [...new Set([...canonical.nodeIds, ...members.filter(id => !declaredSubgraphIds.has(id))])]
    for (const child of completed.children) if (child !== canonical && !canonical.children.some(existing => existing.id === child.id)) canonical.children.push(child)
    canonical.direction ??= completed.direction
    const parent = subgraphStack.at(-1)
    // A redeclaration inside its own ancestor extends that ancestor;
    // attaching it here would make a self-edge or an S -> T -> S cycle.
    if (!placedSubgraphs.has(completed.id) && !subgraphStack.some(ancestor => ancestor.id === completed.id)) {
      if (parent) parent.children.push(canonical)
      else graph.subgraphs.push(canonical)
      placedSubgraphs.add(completed.id)
      if (parserObservationActive('flowchart')) observeParserMutation('flowchart', 'attach-group', { id: completed.id, parent: parent?.id })
    }
    if (parserObservationActive('flowchart')) observeParserMutation('flowchart', 'close-group', { id: canonical.id, label: canonical.label, members: canonical.nodeIds, children: canonical.children.map(child => child.id), direction: canonical.direction })
  }

  for (let i = 1; i < lines.length; i++) {
    for (const line of splitFlowchartStatements(lines[i]!)) {
      if (parserObservationActive('flowchart')) observeParserStatement('flowchart', 'statement', line, { line: i + 1, unit: 'normalized' })
      // --- source-level directives that do not affect local layout ---
      if (isFlowchartInteractionDirective(line)) {
        applyFlowchartInteraction(graph, line)
        continue
      }
      const edgeMetadata = edgeMetadataStatement(graph, line)
      if (edgeMetadata) {
        applyFlowchartEdgeMetadata(graph, edgeMetadata)
        continue
      }

      // --- classDef: `classDef name prop:val,prop:val` ---
      const classDefMatch = line.match(/^classDef\s+([\w,-]+)\s+(.+)$/)
      if (classDefMatch) {
        const names = classDefMatch[1]!.split(',').map(s => s.trim()).filter(Boolean)
        const props = checkedFlowchartStyleProps(parseStyleProps(classDefMatch[2]!))
        if (Object.keys(props).length === 0) continue
        for (const name of names) {
          graph.classDefs.set(name, props)
          if (parserObservationActive('flowchart')) observeParserMutation('flowchart', 'define-class', { name, props })
        }
        continue
      }

      // --- class assignment: `class A,B className` ---
      const classAssignMatch = nodeIdListStatement(line.match(/^class\s+(\S+)\s+([\w-]+)\s*;?$/))
      if (classAssignMatch) {
        const nodeIds = classAssignMatch[1]!.split(',').map(s => s.trim())
        const className = classAssignMatch[2]!
        for (const id of nodeIds) {
          appendGraphClass(graph.classAssignments, id, className)
          if (parserObservationActive('flowchart')) observeParserMutation('flowchart', 'append-class', { id, name: className, classes: graph.classAssignments.get(id) })
        }
        continue
      }

      // --- style statement: `style A,B fill:#f00,stroke:#333` ---
      const styleMatch = nodeIdListStatement(line.match(/^style\s+(\S+)\s+(.+)$/))
      if (styleMatch) {
        const nodeIds = styleMatch[1]!.split(',').map(s => s.trim()).filter(Boolean)
        // A styled id is a mention: it creates the node, as upstream's
        // `addVertex` does, though a `style` line makes no subgraph member.
        for (const id of nodeIds) mentionNode(graph, id, declaredSubgraphIds)
        const props = checkedFlowchartStyleProps(parseStyleProps(styleMatch[2]!))
        if (Object.keys(props).length === 0) continue
        for (const id of nodeIds) {
          graph.nodeStyles.set(id, { ...graph.nodeStyles.get(id), ...props })
          if (parserObservationActive('flowchart')) observeParserMutation('flowchart', 'set-node-style', { id, props: graph.nodeStyles.get(id) })
        }
        continue
      }

      // --- linkStyle: `linkStyle 0 stroke:#f00` or `linkStyle default stroke:#f00` ---
      const linkStyleMatch = line.match(/^linkStyle\s+(default|[\d,\s]+)\s+(.+)$/)
      if (linkStyleMatch) {
        const target = linkStyleMatch[1]!.trim()
        const indices = target === 'default' ? [] : target.split(',').map(s => parseInt(s.trim(), 10)).filter(idx => !isNaN(idx))
        // Upstream's `updateLink` rejects an index past the links defined
        // above the line. Ours styles that link wherever it is defined, and a
        // style whose index names no link draws nothing; verify reports both
        // (agent/flowchart-unsupported.ts).
        const props = checkedFlowchartStyleProps(parseStyleProps(linkStyleMatch[2]!))
        if (Object.keys(props).length === 0) continue
        if (target === 'default') {
          graph.linkStyles.set('default', { ...graph.linkStyles.get('default'), ...props })
          if (parserObservationActive('flowchart')) observeParserMutation('flowchart', 'set-link-style', { target, props: graph.linkStyles.get('default') })
        } else {
          for (const idx of indices) {
            graph.linkStyles.set(idx, { ...graph.linkStyles.get(idx), ...props })
            if (parserObservationActive('flowchart')) observeParserMutation('flowchart', 'set-link-style', { target: idx, props: graph.linkStyles.get(idx) })
          }
        }
        continue
      }

      // --- direction override: root graph or innermost subgraph ---
      const dirMatch = line.match(/^direction\s+(TD|TB|LR|BT|RL)\s*$/i)
      if (dirMatch) {
        const direction = dirMatch[1]!.toUpperCase() as Direction
        if (subgraphStack.length > 0) subgraphStack[subgraphStack.length - 1]!.direction = direction
        else graph.direction = direction
        if (parserObservationActive('flowchart')) observeParserMutation('flowchart', 'set-direction', { parent: subgraphStack.at(-1)?.id, direction })
        continue
      }

      // --- subgraph start: `subgraph Label` or `subgraph id [Label]` ---
      // Upstream's grammar has a subgraph with neither, which its DB then
      // fails to read; ours names neither a group nor a node `subgraph`.
      if (line === 'subgraph') {
        throw syntaxError({
          what: `Invalid flowchart statement "${line}": a subgraph needs an id or a title (upstream fails on one with neither)`,
          expectedForm: 'subgraph id, subgraph id[Title] or subgraph "Title"',
          example: 'subgraph S["Stage one"]',
        })
      }
      const subgraphMatch = line.match(/^subgraph\s+(.+)$/)
      if (subgraphMatch) {
        const { id, label, labelContent } = declarations[nextDeclaration++]!
        const sg: MermaidSubgraph = { id, label, ...(labelContent ? { labelContent } : {}), nodeIds: [], children: [] }
        if (!subgraphsById.has(id)) {
          assertDiagramWorkLimit('nodes', graph.nodes.size + subgraphsById.size + 1)
          // Syntax occurrences collect their own bodies; the shared model
          // must not alias an open occurrence that will close again later.
          subgraphsById.set(id, { id, label, ...(labelContent ? { labelContent } : {}), nodeIds: [], children: [] })
          graphContainerCounts.set(graph, subgraphsById.size)
        }
        assertDiagramWorkLimit('nesting', subgraphStack.length + 1)
        subgraphStack.push(sg)
        if (parserObservationActive('flowchart')) observeParserMutation('flowchart', 'open-group', { id, label, scope: subgraphStack.at(-2)?.id })
        continue
      }

      // --- subgraph end ---
      if (line === 'end') {
        closeSubgraph()
        continue
      }

      // --- Edge/node definitions ---
      const parsed = parseEdgeLine(line, graph, subgraphStack, declaredSubgraphIds)
      if (!parsed.ok) throw invalidFlowchartStatement(line, parsed)
    }
  }

  // A subgraph no `end` closes runs to the end of the source, where Mermaid
  // rejects the diagram; verify reports it (flowchart_unclosed_subgraph).
  while (subgraphStack.length > 0) closeSubgraph()
  listSubgraphs(graph, listings.map(({ lister, ids }) => ({ lister: subgraphsById.get(lister)!, ids: ids.map(id => subgraphsById.get(id)) })))
  return graph
}

/**
 * Nest each subgraph a subgraph's body references in the first lister to close,
 * when it is top-level. One declared inside another stays there, and none is
 * nested inside itself or its own descendant.
 */
function listSubgraphs(graph: MermaidGraph, listings: ReadonlyArray<{ lister: MermaidSubgraph; ids: ReadonlyArray<MermaidSubgraph | undefined> }>): void {
  const contains = (outer: MermaidSubgraph, inner: MermaidSubgraph): boolean =>
    outer === inner || outer.children.some(child => contains(child, inner))
  for (const { lister, ids } of listings) {
    for (const child of ids) {
      const at = child ? graph.subgraphs.indexOf(child) : -1
      if (at < 0 || contains(child!, lister)) continue
      graph.subgraphs.splice(at, 1)
      lister.children.push(child!)
      if (parserObservationActive('flowchart')) observeParserMutation('flowchart', 'attach-group', { id: child!.id, parent: lister.id })
    }
  }
}

/** A spelling ours reads in a statement where pinned Mermaid's lexer reads
 * otherwise, which verify reports: label text holding a character
 * upstream's lexer reads as a delimiter there (flowchart-lexer.ts
 * labelTextHoldsDelimiter), and a subgraph title it cannot read without
 * quotes (subgraphTitleUnreadable), a node whose text runs on without a
 * blank to an `@`, or a pipe label whose text does from its pipe, which
 * upstream reads as an edge id (`A[a@b]`, `A -->|a@b| B`); and where ours
 * rejects a statement, a node id (commaIdStop) upstream reads there that
 * ours does not, or a link label whose markers make no link type there
 * (mismatchedLinkMarkers). An empty quoted label (`A[""]`), which
 * upstream's string token cannot read, is noted too, as is a pipe label
 * with nothing between its pipes (`A -->|| B`), which upstream's grammar
 * cannot, and a link whose edge id an earlier link has, which the parser
 * leaves off it, as upstream does. */
export type FlowchartStatementNote = 'empty-string' | 'empty-pipe-label' | 'label-delimiter' | 'subgraph-title' | 'node-edge-id' | 'comma-id' | 'link-markers' | 'duplicate-edge-id'

/** Statements the parser reads before its node and link grammar, other than
 * `subgraph`. */
const NON_NODE_STATEMENT_RE = /^(?:end$|(?:direction|classDef|class|style|linkStyle|click|href)\s)/i

/** A flowchart with nothing read into it yet. */
export function emptyFlowchartGraph(): MermaidGraph {
  return { direction: 'TD', nodes: new Map(), edges: [], subgraphs: [], classDefs: new Map(), classAssignments: new Map(), nodeStyles: new Map(), linkStyles: new Map() }
}

/** The notes on one statement, as the parser reads it into `graph`; when
 * ours rejects it, only the reason it does. Reading a diagram's statements
 * in order into one graph notes a link repeating an earlier link's edge id. */
export function flowchartStatementNotes(statement: string, graph: MermaidGraph = emptyFlowchartGraph()): ReadonlySet<FlowchartStatementNote> {
  const notes = new Set<FlowchartStatementNote>()
  const subgraph = statement.match(/^subgraph\s+(.+)$/)
  if (subgraph) {
    const title = subgraph[1]!.trim()
    const titled = subgraphBracketTitle(title)
    if (titled ? labelTextHoldsDelimiter(titled.title, 'text') : subgraphTitleUnreadable(title)) notes.add(titled ? 'label-delimiter' : 'subgraph-title')
    if (EMPTY_STRING_LABEL_RE.test(titled ? titled.title : title)) notes.add('empty-string')
    // A run of the id part reaching an `@` (`S[a@b]`) is an edge id upstream.
    const bracket = titled ? title.length - titled.title.length - 2 : -1
    if ([...title.matchAll(/(?:^|\s)[^\s"]+@(?![{"])/g)].some(run => run.index < bracket)) notes.add('node-edge-id')
    return notes
  }
  if (NON_NODE_STATEMENT_RE.test(statement)) return notes
  try {
    const parsed = parseEdgeLine(statement, graph, [], new Set(), notes)
    if (parsed.ok) return notes
    if (commaIdStop(statement, parsed)) return new Set(['comma-id'])
    return new Set(mismatchedLinkMarkers(parsed) !== undefined ? ['link-markers'] : [])
  } catch (error) {
    if (error instanceof DeferredDependencyError) throw error
    return new Set() // Metadata ours rejects fails the parse; verify reports that.
  }
}

/** The error for a statement the edge grammar could not consume, naming the
 * construct upstream rejects there when there is one. */
function invalidFlowchartStatement(line: string, parsed: Extract<EdgeLineParseResult, { ok: false }>): Error {
  const where = `Invalid flowchart statement "${line}"`
  if (/^<?(?:-{2,}|-\.+|={2,})/.test(parsed.remaining)) {
    const found = findTextArrow(parsed.remaining, 0)
    if (found && 'stray' in found) {
      const stray = parsed.remaining.slice(found.stray, found.stray + 2)
      return syntaxError({
        what: `${where}: the link label in "${parsed.remaining}" holds a \`${stray}\` before the link that closes it, which upstream's lexer rejects`,
        expectedForm: `a label without \`${stray}\`, or a quoted one`,
        example: `A -- "x ${stray} y" --> B`,
      })
    }
    return syntaxError({
      what: `${where}: "${parsed.remaining}" opens a link label that no link closes (\`--\` and \`-.\` always open a link, so a node id cannot hold them)`,
      expectedForm: 'a label closed by a link of the same stroke, or an id without `--`',
      example: 'A -- label --> B, A == label ==> B or A -. label .-> B',
    })
  }
  const markers = mismatchedLinkMarkers(parsed)
  if (markers !== undefined) {
    return syntaxError({
      what: `${where}: the link "${markers}" starts with an \`${markers[0]}\` marker and ends otherwise; upstream reads it as a link of no type, and ours reads an \`x\` or \`o\` start only before the same end`,
      expectedForm: 'the same marker at both ends of a link label, or none',
      example: 'A x-- label --x B or A -- label --> B',
    })
  }
  if (commaIdStop(line, parsed)) {
    return syntaxError({
      what: `${where}: upstream reads the "," before "${parsed.remaining.slice(1)}" as part of one node id (\`A,B\` is one node there), and ours reads no "," in a node id`,
      expectedForm: 'a node id without ",", or `&` between nodes',
      example: 'A & B --> C',
    })
  }
  return new Error(`${where}: could not fully consume ${parsed.reason}; remaining input: "${parsed.remaining}"`)
}

/** Whether a statement's parse stopped at a `,` upstream's id grammar reads
 * into a node id: one right after id characters (`A,B`), or one where a node
 * begins (`,A`, `A --> ,B`). Ours reads no `,` in a node id. */
function commaIdStop(line: string, parsed: Extract<EdgeLineParseResult, { ok: false }>): boolean {
  const statement = line.trim().replace(/;\s*$/, '').trim()
  return parsed.remaining.startsWith(',') && statement.endsWith(parsed.remaining)
    && (parsed.reason !== 'expected edge operator' || commaInNodeId(statement, statement.length - parsed.remaining.length))
}

/** Each `subgraph` statement's declaration, in source order. Derived names are
 * allocated after reserving authored identities, including names declared
 * later in the source. A title with no whitespace is its group's identity, so
 * its repeats reuse one allocation, as upstream reads such a title as the id.
 * One holding whitespace, or a line break (`breaks`: for each line, the
 * offsets where a line joined on, coalesceFlowchartLines), names no group:
 * each such block is a group of its own, as upstream's `subGraphN`. */
function collectFlowchartSubgraphDeclarations(lines: string[], breaks: ReadonlyArray<readonly number[] | undefined> = []): SubgraphDeclaration[] {
  const declarations: SubgraphDeclaration[] = []
  const distinct = new Set<SubgraphDeclaration>()
  const reserved = new Set<string>()
  for (const [lineIndex, raw] of lines.entries()) {
    for (const { text: line, start } of flowchartStatementSpans(raw)) {
      const match = line.match(/^subgraph\s+(.+)$/)
      if (match) {
        const rest = match[1]!.trim()
        const declaration = parseFlowchartSubgraphDeclaration(rest)
        declarations.push(declaration)
        if (!declaration.generated) reserved.add(declaration.id)
        else if (!declaration.titled && (/\s/.test(declaration.identity) || breaks[lineIndex]?.some(at => at > start && at < start + line.length))) distinct.add(declaration)
      } else {
        // Reserving every node id the line could hold also covers
        // declarations inside compound chains and metadata without executing
        // their Cartesian expansion. Identifier runs keep the unbroken
        // directive operands (`class A,B c`) reserved too.
        for (const token of line.matchAll(new RegExp(MERMAID_IDENTIFIER_SOURCE, 'gu'))) reserved.add(token[0])
        for (let index = 0; index < line.length;) {
          const length = flowchartNodeIdLength(line, index)
          if (length > 0) reserved.add(line.slice(index, index + length))
          index = matchFlowchartLink(line, index)?.end ?? index + Math.max(length, 1)
        }
      }
    }
  }
  const allocated = new Map<string, string>()
  for (const declaration of declarations) {
    if (!declaration.generated) continue
    const prior = distinct.has(declaration) ? undefined : allocated.get(declaration.identity)
    if (prior) { declaration.id = prior; continue }
    const base = declaration.id
    let id = base
    for (let suffix = 2; reserved.has(id); suffix++) id = `${base}_${suffix}`
    if (!distinct.has(declaration)) allocated.set(declaration.identity, id)
    reserved.add(id)
    declaration.id = id
  }
  return declarations
}

function normalizeFlowchartDirection(raw: string): Direction {
  const direction = raw.toUpperCase()
  if (direction === '>') return 'LR'
  if (direction === '<') return 'RL'
  if (direction === '^') return 'BT'
  if (direction === 'V') return 'TB'
  return direction as Direction
}

// ============================================================================
// State diagram parser
//
// Supported syntax:
//   stateDiagram-v2
//   s1 : Description
//   state "Description" as s1
//   s1 --> s2 : label
//   [*] --> s1            (start pseudostate)
//   s1 --> [*]            (end pseudostate)
//   state CompositeState {
//     inner1 --> inner2
//     --                  (concurrency region separator)
//   }
//   state f1 <<fork|join|choice|history|H|deephistory|H*>>
//   note left|right of s1 : text     (and the block form … end note)
//   s1 --> s2[H]          (history transition endpoints, incl. bare [H]/[H*])
//
// Notes, pseudostate stereotypes, history endpoints, and concurrency
// separators are recognized through the ONE state grammar in
// src/state/parse-core.ts, which the structured agent body also consumes
// (plan §State 1-2, repo #118) — the two surfaces cannot drift.
// ============================================================================

function parseStateDiagram(lines: string[]): MermaidGraph {
  if (parserObservationActive('state')) observeParserStatement('state', 'header', lines[0]!, { line: 1, unit: 'normalized' })
  const graph: MermaidGraph = {
    direction: 'TD',
    nodes: new Map(),
    edges: [],
    subgraphs: [],
    classDefs: new Map(),
    classAssignments: new Map(),
    nodeStyles: new Map(),
    linkStyles: new Map(),
  }

  // Track composite state nesting (like subgraphs). Concurrency regions are
  // pushed as synthetic child subgraphs flagged concurrencyRegion, so member
  // tracking lands in the active region automatically.
  const compositeStack: MermaidSubgraph[] = []
  const statements = readStateStatements(scanStateComments(lines.slice(1))).statements
  // State ids are global: a composite's id names the composite wherever it
  // is mentioned, before or after its block, never a second, simple state
  // (as in the typed body, parseStateBody).
  const identities = resolveStateIdentities(statements)
  if (identities.issue) throw new Error(identities.issue)
  const compositeStateIds = identities.compositeIds
  const composites = new Map<string, MermaidSubgraph>()
  let stateGroupCount = 0
  const labeledStateIds = new Set<string>()
  // Each labelled state's or composite's label as written, one piece per line
  // (a label and the descriptions under it), read by the State text codec.
  const labelPieces = new Map<string, readonly string[]>()
  /** Label a composite as `X : text` (`stack`: under an earlier label) or
   *  `state "L" as X` (only while it has none) labels a simple state. */
  const labelComposite = (id: string, piece: string, stack: boolean): void => {
    if (labeledStateIds.has(id) && !stack) return
    const pieces = [...(labeledStateIds.has(id) ? labelPieces.get(id) ?? [] : []), piece]
    labelPieces.set(id, pieces)
    labeledStateIds.add(id)
    const group = composites.get(id)
    if (group) Object.assign(group, stateLabel(group, pieces))
  }
  // Per-composite region counter (for stable region ids `X__r1`, `X__r2`, …).
  const regionCounts = new Map<string, number>()
  // The parent each composite was attached under, and each open group's depth
  // in the tree. A later `state X {` block for the same id continues X where
  // it first appeared, as Mermaid draws every block's states inside the one
  // state X; its depth, not the open-block count, is what the nesting limit
  // measures.
  const compositeParents = new Map<MermaidSubgraph, string | undefined>()
  const groupDepths = new Map<MermaidSubgraph, number>()
  // Composites whose direction an earlier block set; a later block keeps it.
  const directionSet = new Set<MermaidSubgraph>()
  const depthOfTop = (): number => {
    const top = compositeStack.at(-1)
    return top ? groupDepths.get(top) ?? compositeStack.length : 0
  }
  const pushGroup = (group: MermaidSubgraph, depth = depthOfTop() + 1): void => {
    assertDiagramWorkLimit('nesting', depth)
    groupDepths.set(group, depth)
    compositeStack.push(group)
  }
  // Open block note (`note left of X` … `end note`), collecting body lines.
  let openNote: { target: string; side: 'left' | 'right'; lines: string[] } | null = null

  const addNote = (target: string, side: 'left' | 'right', authored: string): void => {
    if (!graph.stateNotes) graph.stateNotes = []
    const { text, content } = readStateText(authored)
    graph.stateNotes.push({ id: `note#${graph.stateNotes.length}`, target, side, text, ...(content ? { textContent: content } : {}) })
    if (parserObservationActive('state')) observeParserMutation('state', 'add-note', graph.stateNotes.at(-1))
    // A note on an undeclared state declares it (upstream parity) — unless the
    // id is (or later becomes) a composite, which the composite opener handles.
    if (!compositeStateIds.has(target)) ensureStateNode(graph, compositeStack, target)
  }
  const floatingNoteIds = new Set<string>()

  /** Resolve a transition endpoint: `[*]` pseudostates, `[H]`/`X[H]` history
   *  pseudostates (registered as state-history nodes), composites, and plain
   *  states. Returns the graph node id to wire the edge to. */
  const resolveEndpoint = (raw: string, endpoint: 'source' | 'target', statement: StateStatement): string => {
    if (raw === '[*]') {
      const id = identities.pseudostateId(endpoint === 'source' ? 'start' : 'end', statement)
      registerStateNode(graph, compositeStack, { id, label: '', shape: endpoint === 'source' ? 'state-start' : 'state-end' })
      return id
    }
    const history = matchHistoryEndpoint(raw)
    if (history) {
      // A bare [H]/[H*] belongs to the enclosing composite (region's parent);
      // `Base[H]` names its composite explicitly. Repeated references to the
      // same history resolve to the same node.
      const enclosing = [...compositeStack].reverse().find(sg => !sg.concurrencyRegion)
      const base = history.base !== '' ? history.base : (enclosing?.id ?? '')
      const id = `${base}[H${history.deep ? '*' : ''}]`
      registerStateNode(graph, compositeStack, { id, label: historyLabel(history.deep), shape: 'state-history' })
      return id
    }
    if (!compositeStateIds.has(raw)) ensureStateNode(graph, compositeStack, raw)
    return raw
  }

  for (const statement of statements) {
    const line = statement.text
    const source = { line: statement.line + 2, unit: 'normalized' } as const
    if (parserObservationActive('state')) observeParserStatement('state', openNote ? 'note-body' : 'statement', line, source)

    // --- open block note: collect body lines verbatim until `end note` ---
    if (openNote) {
      if (isNoteEnd(line)) {
        addNote(openNote.target, openNote.side, openNote.lines.join('\n'))
        openNote = null
      } else {
        openNote.lines.push(line)
      }
      continue
    }

    if (!line) continue

    const floating = matchFloatingNote(line)
    if (floating) {
      if (floatingNoteIds.has(floating.id)) throw new Error(`Duplicate floating State note "${floating.id}"`)
      floatingNoteIds.add(floating.id)
      const { text, content } = readStateText(floating.text)
      const scope = identities.scopeOf(statement)
      const nodeId = identities.floatingNoteId(floating.id)
      const note = { id: floating.id, text, ...(content ? { textContent: content } : {}), ...(scope ? { scope } : {}), nodeId }
      if (!graph.floatingStateNotes) graph.floatingStateNotes = []
      graph.floatingStateNotes.push(note)
      assertGraphNodeInsertion(graph)
      graph.nodes.set(nodeId, { id: nodeId, label: text, ...(content ? { labelContent: content } : {}), shape: 'state-note', floatingNoteId: floating.id })
      if (parserObservationActive('state')) {
        observeParserMutation('state', 'add-floating-note', note)
        observeParserMutation('state', 'add-node', graph.nodes.get(nodeId))
      }
      continue
    }

    // Comment-only source carries no drawing content. Keep note text above
    // literal; opaque parsing preserves slash comments and layout directives.
    if (matchStateLayoutDirective(line)) continue

    // --- notes: `note left|right of X : text` / `note left|right of X` ---
    const noteLine = matchNoteLine(line)
    if (noteLine) {
      addNote(noteLine.target, noteLine.side, noteLine.text)
      continue
    }
    const noteOpen = matchNoteOpen(line)
    if (noteOpen) {
      openNote = { target: noteOpen.target, side: noteOpen.side, lines: [] }
      continue
    }

    // --- direction override ---
    const dirMatch = line.match(STATE_DIRECTION_RE)
    if (dirMatch) {
      const top = compositeStack.at(-1)
      if (top) {
        // The first block to set a reopened composite's direction keeps it.
        if (!directionSet.has(top)) top.direction = dirMatch[1]!.toUpperCase() as Direction
      } else {
        graph.direction = dirMatch[1]!.toUpperCase() as Direction
      }
      if (parserObservationActive('state')) observeParserMutation('state', 'set-direction', { parent: compositeStack.at(-1)?.id, direction: dirMatch[1]!.toUpperCase() })
      continue
    }

    // --- classDef: shared paint model with flowcharts ---
    const stateClassDefMatch = line.match(STATE_CLASS_DEF_RE)
    if (stateClassDefMatch) {
      const names = stateClassDefMatch[1]!.split(',').map(name => name.trim()).filter(Boolean)
      const props = parseClassLikeStyleProps(stateClassDefMatch[2]!)
      for (const name of names) {
        graph.classDefs.set(name, mergeStyleProps(graph.classDefs.get(name), props))
        if (parserObservationActive('state')) observeParserMutation('state', 'define-class', { name, props })
      }
      continue
    }

    // --- class/cssClass assignment and inline state style ---
    const stateClassAssignment = matchStateClassAssignment(line)
    if (stateClassAssignment) {
      for (const id of stateClassAssignment.ids) {
        // A paint assignment targets existing/future declarations; it does
        // not introduce a state (including inside a composite scope).
        appendGraphClass(graph.classAssignments, id, stateClassAssignment.className)
        if (parserObservationActive('state')) observeParserMutation('state', 'assign-class', { id, name: stateClassAssignment.className })
      }
      continue
    }
    const stateInlineStyle = line.match(STATE_STYLE_RE)
    if (stateInlineStyle) {
      const ids = stateInlineStyle[1]!.split(',').map(id => id.trim()).filter(Boolean)
      const props = parseClassLikeStyleProps(stateInlineStyle[2]!)
      for (const id of ids) {
        graph.nodeStyles.set(id, { ...props })
        if (parserObservationActive('state')) observeParserMutation('state', 'set-node-style', { id, props: graph.nodeStyles.get(id) })
      }
      continue
    }

    // --- linkStyle: `linkStyle 0 stroke:#f00` or `linkStyle default stroke:#f00` ---
    const linkStyleMatch = line.match(STATE_LINK_STYLE_RE)
    if (linkStyleMatch) {
      const target = linkStyleMatch[1]!.trim()
      const props = parseStyleProps(linkStyleMatch[2]!)
      if (Object.keys(props).length === 0) continue
      if (target === 'default') {
        graph.linkStyles.set('default', { ...graph.linkStyles.get('default'), ...props })
        if (parserObservationActive('state')) observeParserMutation('state', 'set-link-style', { target, props: graph.linkStyles.get('default') })
      } else {
        const indices = target.split(',').map(s => parseInt(s.trim(), 10))
        for (const idx of indices) {
          if (!isNaN(idx)) {
            graph.linkStyles.set(idx, { ...graph.linkStyles.get(idx), ...props })
            if (parserObservationActive('state')) observeParserMutation('state', 'set-link-style', { target: idx, props: graph.linkStyles.get(idx) })
          }
        }
      }
      continue
    }

    // --- pseudostate stereotype: `state f1 <<fork|join|choice|history|…>>` ---
    const stereotype = matchStereotypeDecl(line)
    if (stereotype) {
      const shape: NodeShape =
        stereotype.stereotype === 'fork' ? 'state-fork'
        : stereotype.stereotype === 'join' ? 'state-join'
        : stereotype.stereotype === 'choice' ? 'state-choice'
        : 'state-history'
      const label = shape === 'state-history'
        ? historyLabel(stereotype.stereotype === 'deep-history')
        : ''
      // Upsert: a transition may have referenced the id first (creating a
      // plain rounded node) — the declaration owns the shape either way.
      if (!graph.nodes.has(stereotype.id)) assertGraphNodeInsertion(graph)
      graph.nodes.set(stereotype.id, { id: stereotype.id, label, shape })
      if (parserObservationActive('state')) observeParserMutation('state', 'upsert-node', graph.nodes.get(stereotype.id))
      trackInStateScope(graph, compositeStack, stereotype.id)
      continue
    }

    // --- concurrency region separator inside a composite: `--` ---
    if (isConcurrencySeparator(line) && compositeStack.length > 0) {
      const top = compositeStack[compositeStack.length - 1]!
      let composite: MermaidSubgraph
      if (top.concurrencyRegion) {
        // Close the current region (already attached to its composite).
        compositeStack.pop()
        composite = compositeStack[compositeStack.length - 1]!
      } else {
        // First separator in this composite: everything collected so far
        // becomes region 1.
        composite = top
        assertDiagramWorkLimit('nodes', graph.nodes.size + ++stateGroupCount)
        graphContainerCounts.set(graph, stateGroupCount)
        const first: MermaidSubgraph = {
          id: identities.regionId(composite.id, nextRegion(regionCounts, composite.id) - 1),
          label: '',
          nodeIds: composite.nodeIds.splice(0),
          children: composite.children.splice(0),
          concurrencyRegion: true,
        }
        composite.children.push(first)
        groupDepths.set(first, depthOfTop() + 1)
        if (parserObservationActive('state')) observeParserMutation('state', 'add-region', { id: first.id, parent: composite.id, members: first.nodeIds, children: first.children.map(child => child.id) })
      }
      assertDiagramWorkLimit('nodes', graph.nodes.size + ++stateGroupCount)
      graphContainerCounts.set(graph, stateGroupCount)
      const next: MermaidSubgraph = {
        id: identities.regionId(composite.id, nextRegion(regionCounts, composite.id) - 1),
        label: '',
        nodeIds: [],
        children: [],
        concurrencyRegion: true,
      }
      composite.children.push(next)
      pushGroup(next)
      if (parserObservationActive('state')) observeParserMutation('state', 'add-region', { id: next.id, parent: composite.id, members: next.nodeIds })
      continue
    }

    // --- composite state start: `state CompositeState {` ---
    const compositeMatch = line.match(STATE_COMPOSITE_OPEN_RE)
    if (compositeMatch) {
      const id = compositeMatch[2]!
      const reopened = composites.get(id)
      // A state reopened inside itself is a duplicate identity, left for the
      // layout to refuse; anywhere else, a reopened block continues the state,
      // and its label is one more line of the composite's label.
      if (reopened && !compositeStack.includes(reopened)) {
        if (compositeMatch[1] !== undefined) labelComposite(id, compositeMatch[1], true)
        if (reopened.direction !== undefined) directionSet.add(reopened)
        graph.nodes.delete(id)
        pushGroup(reopened, groupDepths.get(reopened))
        // A state already split by `--` continues in its last region.
        const lastRegion = reopened.children.at(-1)
        if (lastRegion?.concurrencyRegion) pushGroup(lastRegion, groupDepths.get(lastRegion))
        if (parserObservationActive('state')) observeParserMutation('state', 'open-group', { id, label: reopened.label, parent: compositeParents.get(reopened) })
        continue
      }
      if (compositeMatch[1] !== undefined) {
        labelPieces.set(id, [compositeMatch[1]])
        labeledStateIds.add(id)
      }
      const pieces = labeledStateIds.has(id) ? labelPieces.get(id) : undefined
      const sg: MermaidSubgraph = { id, label: id, nodeIds: [], children: [], stateComposite: true }
      if (pieces !== undefined) Object.assign(sg, stateLabel(sg, pieces))
      const label = sg.label
      assertDiagramWorkLimit('nodes', graph.nodes.size - Number(graph.nodes.has(id)) + ++stateGroupCount)
      graphContainerCounts.set(graph, stateGroupCount)
      pushGroup(sg)
      composites.set(id, sg)
      // A pseudostate declared with this id is the composite now.
      graph.nodes.delete(id)
      if (parserObservationActive('state')) observeParserMutation('state', 'open-group', { id, label, parent: compositeStack.at(-2)?.id })
      continue
    }

    // --- composite state end ---
    if (line === '}') {
      // An open concurrency region closes with its composite.
      if (compositeStack.length > 0 && compositeStack[compositeStack.length - 1]!.concurrencyRegion) {
        compositeStack.pop()
      }
      const completed = compositeStack.pop()
      if (completed) {
        // A reopened state is already in place, under its first parent.
        if (!compositeParents.has(completed)) {
          const parent = compositeStack.at(-1)
          if (parent) parent.children.push(completed)
          else graph.subgraphs.push(completed)
          compositeParents.set(completed, parent?.id)
        }
        if (parserObservationActive('state')) observeParserMutation('state', 'close-group', { id: completed.id, label: completed.label, members: completed.nodeIds, children: completed.children.map(child => child.id), parent: compositeParents.get(completed) })
      }
      continue
    }

    // --- state alias: `state "Description" as s1` (without brace) ---
    const stateAliasMatch = line.match(STATE_ALIAS_RE)
    if (stateAliasMatch) {
      const pieces = [stateAliasMatch[1]!]
      const id = stateAliasMatch[2]!
      if (compositeStateIds.has(id)) {
        labelComposite(id, stateAliasMatch[1]!, false)
        continue
      }
      const existing = graph.nodes.get(id)
      if (existing?.shape === 'rounded' && !labeledStateIds.has(id)) {
        labelPieces.set(id, pieces)
        graph.nodes.set(id, stateLabel(existing, pieces))
        if (parserObservationActive('state')) observeParserMutation('state', 'set-label', { id, label: graph.nodes.get(id)!.label })
      }
      if (!existing) labelPieces.set(id, pieces)
      registerStateNode(graph, compositeStack, stateLabel({ id, label: id, shape: 'rounded' }, pieces))
      labeledStateIds.add(id)
      continue
    }

    // --- transition: `s1 --> s2 [: label]`, endpoints may be [*] or history ---
    const transition = matchTransitionLine(line)
    if (transition) {
      const sourceId = resolveEndpoint(transition.from, 'source', statement)
      const targetId = resolveEndpoint(transition.to, 'target', statement)
      if (transition.fromClass) {
        appendGraphClass(graph.classAssignments, sourceId, transition.fromClass)
      if (parserObservationActive('state')) observeParserMutation('state', 'assign-class', { id: sourceId, name: transition.fromClass })
      }
      if (transition.toClass) {
        appendGraphClass(graph.classAssignments, targetId, transition.toClass)
        if (parserObservationActive('state')) observeParserMutation('state', 'assign-class', { id: targetId, name: transition.toClass })
      }
      const edgeLabel = transition.label ? readStateText(transition.label) : undefined

      assertDiagramWorkLimit('edges', graph.edges.length + 1)
      graph.edges.push({
        source: sourceId,
        target: targetId,
        label: edgeLabel?.text,
        ...(edgeLabel?.content ? { labelContent: edgeLabel.content } : {}),
        style: 'solid',
        hasArrowStart: false,
        hasArrowEnd: true,
      })
      if (parserObservationActive('state')) observeParserMutation('state', 'add-edge', graph.edges.at(-1), source)
      continue
    }

    // --- class shorthand: `s1:::highlight` ---
    // Consume before the description grammar so two of the three colons can
    // never leak into a visible `::highlight` label.
    const stateClass = parseClassShorthandStatement(line)
    if (stateClass) {
      if (!compositeStateIds.has(stateClass.id)) ensureStateNode(graph, compositeStack, stateClass.id)
      appendGraphClass(graph.classAssignments, stateClass.id, stateClass.className)
      if (parserObservationActive('state')) observeParserMutation('state', 'assign-class', { id: stateClass.id, name: stateClass.className })
      continue
    }

    // --- state description / bare declaration ---
    const stateDescMatch = line.match(STATE_DESCRIPTION_RE)
    if (stateDescMatch) {
      const id = stateDescMatch[1]!
      const piece = stateDescMatch[2]!.trim()
      if (compositeStateIds.has(id)) {
        labelComposite(id, piece, true)
        continue
      }
      // A description also describes a state a transition already created
      // (Mermaid adds it either way): it replaces the id-only label, and a
      // second description stacks under the first rather than being dropped.
      const existing = graph.nodes.get(id)
      const pieces = [...(labeledStateIds.has(id) ? labelPieces.get(id) ?? [] : []), piece]
      if (existing && existing.shape === 'rounded') {
        labelPieces.set(id, pieces)
        graph.nodes.set(id, stateLabel(existing, pieces))
        if (parserObservationActive('state')) observeParserMutation('state', 'set-label', { id, label: graph.nodes.get(id)!.label })
      }
      if (!existing) labelPieces.set(id, pieces)
      registerStateNode(graph, compositeStack, stateLabel({ id, label: id, shape: 'rounded' }, pieces))
      labeledStateIds.add(id)
      continue
    }
    const declaredId = matchStateDeclarationLine(line)
    if (declaredId !== null) {
      if (!compositeStateIds.has(declaredId)) registerStateNode(graph, compositeStack, { id: declaredId, label: declaredId, shape: 'rounded' })
      continue
    }

    // Mermaid reads the rest of the line after `as` as one name, so
    // `state "L" as X Y` names a state `X Y` that no transition can name.
    const alias = /^state\s+"[^"]*"\s+as\s+/.exec(line)
    const aliasName = alias ? line.slice(alias[0].length).replace(/\{$/, '').trimEnd() : ''
    if (/\s/.test(aliasName)) throw syntaxError({
      what: `Unsupported state syntax: "${line}"`,
      expectedForm: `one word after \`as\`; pinned Mermaid reads "${aliasName}" as one name, which no transition can refer to`,
      example: 'state "Long name" as LongName',
    })
    throw syntaxError({
      what: `Unsupported state syntax: "${line}"`,
      expectedForm: 'a state declaration, transition, composite, note, direction, or paint directive',
      example: 'A --> B : continue',
    })
  }

  // A composite the source never closes cannot be drawn: where it was meant
  // to end cannot be told, and its members must not appear without it.
  // Mermaid rejects it too (readStateStatements' unclosedLines).
  const unclosed = compositeStack.find(group => !group.concurrencyRegion)
  if (unclosed) {
    throw syntaxError({
      what: `Composite state "${unclosed.id}" is never closed`,
      expectedForm: 'a `}` where the composite ends',
      example: 'state X { A }',
    })
  }

  // An unterminated block note still lands (lenient, like a stray `}`).
  if (openNote) addNote(openNote.target, openNote.side, openNote.lines.join('\n'))

  applyStateGraphOwnership(graph, composites, identities)
  return graph
}

function applyStateGraphOwnership(graph: MermaidGraph, composites: ReadonlyMap<string, MermaidSubgraph>, identities: StateIdentities): void {
  const scopes = new Map(composites)
  for (const group of composites.values()) {
    for (const region of group.children.filter(child => child.concurrencyRegion)) scopes.set(region.id, region)
  }
  for (const scope of scopes.values()) {
    scope.nodeIds = scope.nodeIds.filter(id => !identities.authored.has(id))
    scope.children = scope.children.filter(group => !group.stateComposite)
    if (parserObservationActive('state')) observeParserMutation('state', 'reset-scope-membership', { id: scope.id, members: scope.nodeIds, children: scope.children.map(child => child.id) })
  }
  graph.subgraphs = []
  for (const group of composites.values()) {
    const owner = identities.ownerOf(group.id)
    const parent = owner ? scopes.get(identities.scopeId(owner)) : undefined
    if (owner && !parent) throw new Error(`Missing State scope for ${group.id}`)
    if (parent) parent.children.push(group)
    else graph.subgraphs.push(group)
    if (parserObservationActive('state')) observeParserMutation('state', 'resolve-group-owner', { id: group.id, parent: parent?.id })
  }
  for (const id of identities.ownedIds()) {
    if (!graph.nodes.has(id)) continue
    const owner = identities.ownerOf(id)
    if (!owner) continue
    const scope = scopes.get(identities.scopeId(owner))
    if (!scope) throw new Error(`Missing State scope for ${id}`)
    scope.nodeIds.push(id)
    if (parserObservationActive('state')) observeParserMutation('state', 'resolve-member-owner', { id, parent: scope.id })
  }
  for (const note of graph.floatingStateNotes ?? []) {
    if (!note.scope) continue
    const scope = scopes.get(identities.scopeId(note.scope))
    if (!scope) throw new Error(`Missing State scope for floating note ${note.id}`)
    scope.nodeIds.push(note.nodeId)
    if (parserObservationActive('state')) observeParserMutation('state', 'resolve-member-owner', { id: note.nodeId, parent: scope.id })
  }
  const pending = graph.subgraphs.map(group => ({ group, depth: 1 }))
  while (pending.length) {
    const { group, depth } = pending.pop()!
    assertDiagramWorkLimit('nesting', depth)
    for (const child of group.children) pending.push({ group: child, depth: depth + 1 })
  }
}

function nextRegion(counts: Map<string, number>, compositeId: string): number {
  const n = (counts.get(compositeId) ?? 0) + 1
  counts.set(compositeId, n)
  return n
}

/** Track an id in the innermost composite/region scope (no node creation). */
/** `target` labelled with State text as written, one piece per line: the
 *  label it reads, and the text as written where it holds an entity code. */
function stateLabel<T extends { label: string; labelContent?: LabelContent }>(target: T, pieces: readonly string[]): T {
  const { text, content } = readStateLabel(pieces)
  const { labelContent: _previous, ...rest } = target
  return { ...rest, label: text, ...(content ? { labelContent: content } : {}) } as T
}

// The composite (or concurrency region) that first took each state. A state
// belongs to one: a later mention in another composite or region, such as a
// transition to it, reaches across to it rather than adding it there too.
const stateMemberOwners = new WeakMap<MermaidGraph, Map<string, MermaidSubgraph>>()

function trackInStateScope(graph: MermaidGraph, compositeStack: MermaidSubgraph[], id: string): void {
  const current = compositeStack.at(-1)
  if (!current || current.nodeIds.includes(id)) return
  let owners = stateMemberOwners.get(graph)
  if (!owners) stateMemberOwners.set(graph, owners = new Map())
  if (owners.has(id)) return
  owners.set(id, current)
  current.nodeIds.push(id)
  if (parserObservationActive('state')) observeParserMutation('state', 'add-member', { parent: current.id, id })
}

/** Register a state node and track in composite state if applicable */
function registerStateNode(
  graph: MermaidGraph,
  compositeStack: MermaidSubgraph[],
  node: MermaidNode
): void {
  const isNew = !graph.nodes.has(node.id)
  if (isNew) {
    assertGraphNodeInsertion(graph)
    graph.nodes.set(node.id, node)
    if (parserObservationActive('state')) observeParserMutation('state', 'add-node', node)
  }
  trackInStateScope(graph, compositeStack, node.id)
}

/** Ensure a state node exists with default rounded shape */
function ensureStateNode(
  graph: MermaidGraph,
  compositeStack: MermaidSubgraph[],
  id: string
): void {
  if (!graph.nodes.has(id)) {
    registerStateNode(graph, compositeStack, { id, label: id, shape: 'rounded' })
  } else {
    trackInStateScope(graph, compositeStack, id)
  }
}

// ============================================================================
// Shared utilities
// ============================================================================

/** Parse "fill:#f00,stroke:#333" style property strings into a Record */
/**
 * Split on top-level commas only — commas inside parentheses (e.g.
 * `rgb(10,10,10)`, `rgba(0,0,0,.5)`, `hsl(120,50%,50%)`) are NOT separators.
 * Fixes the bug where `fill:rgb(10,10,10)` was split into `fill:rgb(10`.
 */
// ============================================================================
// Flowchart edge line parser
//
// Handles chained edges like: A[Label] --> B(Label) -.-> C{Label}
// Also handles & parallel links: A & B --> C & D
// ============================================================================

/**
 * Arrow regex — matches all arrow operators with optional labels. Operators
 * are VARIABLE LENGTH (Mermaid lets you lengthen a link to push rank): every
 * shaft accepts extra units —
 *   -->  --->  ---->   solid arrow      ---  ----  -----   solid line
 *   -.-> -..->         dotted arrow     -.-  -..-          dotted line
 *   ==>  ===>          thick arrow      ===  ====          thick line
 *   ~~~  ~~~~          invisible link (participates in layout, draws nothing)
 *   --o --x o--o …     circle / cross endpoint markers (also length-variable)
 *   <--> <-.-> <==>    bidirectional variants (leading `<`)
 *
 * Alternation order matters (leftmost wins): the dotted/thick/marker forms
 * with explicit terminators MUST precede the bare solid-line `-{3,}`, or a
 * greedy dash run would swallow a marker/arrow prefix and mangle the line.
 *
 * Optional label: -->|label text|
 *
 * The operator (flowchart-lexer.ts `matchFlowchartLink`), the pipe label and
 * the text-arrow label are delimited by the one flowchart lexer, so the
 * statement splitter and this parser read the same extents.
 */

/** A `|label|` after an operator: the lexer's pipe region (a `"…"` string
 * inside it masks a `|`). */
function consumePipeLabel(text: string): { rawLabel: string; consumed: number } | null {
  const pipe = flowchartRegionAt(text, 0)
  if (pipe?.kind !== 'pipe' || !pipe.closed) return null
  return { rawLabel: text.slice(pipe.contentStart, pipe.contentEnd), consumed: pipe.end }
}

interface ConsumedTextArrow {
  startMarker: EdgeMarker | undefined
  openOp: string
  rawLabel: string
  closeOp: string
  consumed: number
}

/** `-- label -->`, `-. label .->`, and `== label ==>` (flowchart-lexer.ts
 * `matchTextArrow`): closer-shaped text inside a wholly quoted label is paint,
 * not syntax. An `x` or `o` opener (`x-- a --x`) is upstream's start marker
 * only before a closer with the same end, and its link is invalid otherwise. */
function consumeTextArrow(text: string): ConsumedTextArrow | null {
  const arrow = matchTextArrow(text, 0)
  if (!arrow) return null
  const startMarker = arrow.startMark === 'x' ? 'cross' : arrow.startMark === 'o' ? 'circle' : arrow.startMark ? 'arrow' : undefined
  if ((arrow.startMark === 'x' || arrow.startMark === 'o') && startMarker !== endMarkerForOp(arrow.closeOp)) return null
  return {
    startMarker,
    openOp: arrow.openOp,
    rawLabel: text.slice(arrow.labelStart, arrow.labelEnd),
    closeOp: arrow.closeOp,
    consumed: arrow.end,
  }
}

/**
 * Node shape patterns, matched after the node id (flowchartNodeIdLength) —
 * ordered from most specific delimiters to least. Multi-char delimiters must
 * be tried before single-char to avoid false matches.
 */
const flowchartNodeRegex = (suffix: string): RegExp => new RegExp(`^${suffix}`, 'u')

const NODE_PATTERNS: Array<{ regex: RegExp; shape: NodeShape }> = [
  // Triple delimiters (must be first)
  { regex: flowchartNodeRegex(String.raw`\(\(\((.+?)\)\)\)`), shape: 'doublecircle' },

  // Double delimiters with mixed brackets
  { regex: flowchartNodeRegex(String.raw`\(\[(.+?)\]\)`), shape: 'stadium' },
  { regex: flowchartNodeRegex(String.raw`\(-(.+?)-\)`), shape: 'ellipse' },
  { regex: flowchartNodeRegex(String.raw`\(\((.+?)\)\)`), shape: 'circle' },
  { regex: flowchartNodeRegex(String.raw`\[\[(.+?)\]\]`), shape: 'subroutine' },
  { regex: flowchartNodeRegex(String.raw`\[\((.+?)\)\]`), shape: 'cylinder' },

  // Trapezoid + parallelogram variants — must come before plain [text].
  { regex: flowchartNodeRegex(String.raw`\[\/([^\]]+?)\\\]`), shape: 'trapezoid' },
  { regex: flowchartNodeRegex(String.raw`\[\\([^\]]+?)\/\]`), shape: 'trapezoid-alt' },
  { regex: flowchartNodeRegex(String.raw`\[\/([^\]]+?)\/\]`), shape: 'lean-r' },
  { regex: flowchartNodeRegex(String.raw`\[\\([^\]]+?)\\\]`), shape: 'lean-l' },

  { regex: flowchartNodeRegex(String.raw`>(.+?)\]`), shape: 'asymmetric' },
  { regex: flowchartNodeRegex(String.raw`\{\{(.+?)\}\}`), shape: 'hexagon' },
  { regex: flowchartNodeRegex(String.raw`\[(.+?)\]`), shape: 'rectangle' },
  { regex: flowchartNodeRegex(String.raw`\((.+?)\)`), shape: 'rounded' },
  { regex: flowchartNodeRegex(String.raw`\{(.+?)\}`), shape: 'diamond' },
]

/** The shapes upstream lexes in its trapezoid text state. */
const TRAPEZOID_SHAPES: ReadonlySet<NodeShape> = new Set(['trapezoid', 'trapezoid-alt', 'lean-r', 'lean-l'])

/** The node id at the start of `text`, as upstream's lexer reads one
 * (flowchartNodeIdLength): `--` and `-.` always open a link, so
 * `A--a --> B` is A, a text-arrow label, B. */
function consumeBareNodeId(text: string): { id: string; length: number } | null {
  const length = flowchartNodeIdLength(text)
  return length > 0 ? { id: text.slice(0, length), length } : null
}

const EDGE_ID_PREFIX_REGEX = new RegExp(String.raw`^(${FLOWCHART_EDGE_ID_SOURCE})@\s*(?=${FLOWCHART_LINK_SOURCE}|(?:-{2,}|-\.+|={2,})\s+)`, 'u')

/** Where a statement's parse stopped expecting a link, a link label opened
 * with an `x` or `o` start marker and closed by a link with another end
 * (`x-- a -->`), which upstream reads as a link of no type, or undefined. */
function mismatchedLinkMarkers(parsed: Extract<EdgeLineParseResult, { ok: false }>): string | undefined {
  if (parsed.reason !== 'expected edge operator') return undefined
  const arrow = matchTextArrow(parsed.remaining, 0)
  if (arrow?.startMark !== 'x' && arrow?.startMark !== 'o') return undefined
  return endMarkerForOp(arrow.closeOp) === (arrow.startMark === 'x' ? 'cross' : 'circle') ? undefined : parsed.remaining.slice(0, arrow.end)
}

function consumeClassShorthand(text: string): { className: string; length: number } | null {
  const parsed = consumeClassShorthandPrefix(text)
  if (!parsed) return null
  const rest = text.slice(3)
  const end = Math.min(parsed.className.length, flowchartNodeIdLength(rest))
  if (end === 0) return null
  return { className: rest.slice(0, end), length: 3 + end }
}

/**
 * Parse a line that contains node definitions and edges.
 * Handles chaining: A --> B --> C produces edges A→B and B→C.
 * Handles parallel links: A & B --> C & D produces 4 edges.
 */
type EdgeLineParseResult = {
  readonly ok: true
}
  | { readonly ok: false; readonly remaining: string; readonly reason: 'expected node' | 'expected edge operator' | 'expected edge target' }

function parseEdgeLine(
  line: string,
  graph: MermaidGraph,
  subgraphStack: MermaidSubgraph[],
  declaredSubgraphIds: Set<string> = new Set(),
  notes?: Set<FlowchartStatementNote>): EdgeLineParseResult {
  // A terminal semicolon is a Mermaid statement delimiter, not authored
  // edge/node content. The top-level splitter normally removes it; trim it
  // here as well for labels containing unmatched quote-like characters, where
  // the conservative splitter intentionally leaves the line intact.
  let remaining = line.trim().replace(/;\s*$/, '').trim()
  const nodeNotes = notes ? flowchartNodeNotes(remaining, notes) : undefined

  // Parse the first node group (possibly with & separators). A structured
  // statement is admitted only when every non-whitespace token is consumed;
  // publishing a parsed prefix would silently invent/drop authored content.
  const firstGroup = consumeNodeGroup(remaining, graph, subgraphStack, declaredSubgraphIds, nodeNotes)
  if (!firstGroup || firstGroup.ids.length === 0) {
    return { ok: false, remaining, reason: 'expected node' }
  }

  remaining = firstGroup.remaining.trim()
  if (remaining.length === 0) return { ok: true }
  let prevGroupIds = firstGroup.ids

  // Parse arrow + node-group pairs until the line is exhausted.
  while (remaining.length > 0) {
    let hasArrowStart: boolean
    let style: EdgeStyle
    let hasArrowEnd: boolean
    let startMarker: EdgeMarker | undefined
    let endMarker: EdgeMarker | undefined
    let edgeLabel: string | undefined
    let labelContent: MermaidEdge['labelContent']
    let length: number | undefined

    // v11.6 edge IDs (`e1@-->`): the authored ID is modeled as stable edge
    // identity (plan §Flowchart 7) — carried on MermaidEdge.id, re-emitted
    // verbatim by the serializer, and accepted as an op target selector.
    const edgeIdMatch = remaining.match(EDGE_ID_PREFIX_REGEX)
    const edgeId = edgeIdMatch?.[1]
    if (edgeIdMatch) {
      if (parserObservationActive('flowchart')) observeParserToken('flowchart', 'edge-id', edgeIdMatch[0])
      remaining = remaining.slice(edgeIdMatch[0].length).trim()
    }

    const arrowMatch = matchFlowchartLink(remaining, 0)
    if (arrowMatch) {
      const arrowOp = arrowMatch.op
      let consumed = arrowMatch.end
      // Upstream's link token takes the whitespace after it, so a pipe label
      // may follow a space (`A --> |yes| B`).
      const gap = /^\s*/.exec(remaining.slice(consumed))![0].length
      const labelSuffix = remaining.slice(consumed + gap)
      if (labelSuffix.startsWith('|')) {
        const pipeLabel = consumePipeLabel(labelSuffix)
        if (!pipeLabel) return { ok: false, remaining: labelSuffix, reason: 'expected edge target' }
        if (labelTextHoldsDelimiter(pipeLabel.rawLabel, 'text')) notes?.add('label-delimiter')
        if (EMPTY_STRING_LABEL_RE.test(pipeLabel.rawLabel)) notes?.add('empty-string')
        // Upstream's pipe label needs text, a blank at least (`| |`).
        if (pipeLabel.rawLabel === '') notes?.add('empty-pipe-label')
        // Its edge-id token is tried before its pipe, so a run from the pipe
        // to an `@` is an edge id there (`A -->|a@b| B` is the id `|a`).
        if (PIPE_LABEL_EDGE_ID_RE.test(pipeLabel.rawLabel)) notes?.add('node-edge-id')
        const parsedLabel = parseFlowchartLabel(pipeLabel.rawLabel.trim())
        edgeLabel = parsedLabel.text || undefined
        labelContent = parsedLabel.labelContent
        consumed += gap + pipeLabel.consumed
      }
      if (parserObservationActive('flowchart')) observeParserToken('flowchart', 'link', remaining.slice(0, consumed))
      remaining = remaining.slice(consumed).trim()
      style = arrowStyleFromOp(arrowOp)
      length = arrowLengthFromOp(arrowOp)
      startMarker = startMarkerForOp(arrowOp, arrowMatch.hasArrowStart)
      endMarker = endMarkerForOp(arrowOp)
      hasArrowStart = startMarker !== undefined
      hasArrowEnd = endMarker !== undefined
    } else {
      // Fallback: text-embedded label syntax (-- Yes -->, -. Maybe .->, == Sure ==>)
      const textArrow = consumeTextArrow(remaining)
      if (!textArrow) return { ok: false, remaining, reason: 'expected edge operator' }
      if (labelTextHoldsDelimiter(textArrow.rawLabel, 'edge-text')) notes?.add('label-delimiter')
      if (EMPTY_STRING_LABEL_RE.test(textArrow.rawLabel)) notes?.add('empty-string')
      const parsedLabel = parseFlowchartLabel(textArrow.rawLabel)
      edgeLabel = parsedLabel.text || undefined
      labelContent = parsedLabel.labelContent
      if (parserObservationActive('flowchart')) observeParserToken('flowchart', 'text-link', remaining.slice(0, textArrow.consumed))
      remaining = remaining.slice(textArrow.consumed).trim()
      style = textArrowStyleFromOps(textArrow.openOp, textArrow.closeOp)
      length = textArrowLengthFromOps(textArrow.openOp, textArrow.closeOp)
      startMarker = textArrow.startMarker
      hasArrowStart = startMarker !== undefined
      endMarker = endMarkerForOp(textArrow.closeOp)
      hasArrowEnd = endMarker !== undefined
    }

    // Parse the next node group
    const nextGroup = consumeNodeGroup(remaining, graph, subgraphStack, declaredSubgraphIds, nodeNotes)
    if (!nextGroup || nextGroup.ids.length === 0) {
      return { ok: false, remaining, reason: 'expected edge target' }
    }

    remaining = nextGroup.remaining.trim()

    // Admit the expansion before allocating any of its edges.
    assertDiagramWorkLimit('edges', graph.edges.length + prevGroupIds.length * nextGroup.ids.length)
    // Emit Cartesian product of edges: every source × every target. Its edge
    // id names one edge, as upstream's: the first from the last source to
    // the first target (`A & B e1@--> C & D` names B→C). An id an earlier
    // link has names none: upstream's `addSingleLink` leaves it off, and
    // edge ids stay unique.
    const repeated = edgeId !== undefined && graph.edges.some(edge => edge.id === edgeId)
    if (repeated) notes?.add('duplicate-edge-id')
    let pendingId = repeated ? undefined : edgeId
    for (const sourceId of prevGroupIds) {
      for (const targetId of nextGroup.ids) {
        const id = sourceId === prevGroupIds.at(-1) && targetId === nextGroup.ids[0] ? pendingId : undefined
        if (id !== undefined) pendingId = undefined
        graph.edges.push({
          source: sourceId,
          target: targetId,
          ...(id !== undefined ? { id } : {}),
          label: edgeLabel,
          ...(labelContent ? { labelContent } : {}),
          style,
          hasArrowStart,
          hasArrowEnd,
          startMarker,
          endMarker,
          ...(length !== undefined ? { length } : {}),
        })
        if (parserObservationActive('flowchart')) observeParserMutation('flowchart', 'add-edge', graph.edges.at(-1))
      }
    }

    prevGroupIds = nextGroup.ids
  }
  return { ok: true }
}

interface ConsumedNodeGroup {
  ids: string[]
  remaining: string
}

/**
 * Consume one or more nodes separated by `&`.
 * E.g. "A & B & C --> ..." returns ids: ['A', 'B', 'C']
 */
function consumeNodeGroup(
  text: string,
  graph: MermaidGraph,
  subgraphStack: MermaidSubgraph[],
  declaredSubgraphIds: Set<string>,
  notes?: FlowchartNodeNotes): ConsumedNodeGroup | null {
  const first = consumeNode(text, graph, subgraphStack, declaredSubgraphIds, notes)
  if (!first) return null

  const ids = [first.id]
  let remaining = first.remaining.trim()

  // Check for & separators. One that no node follows (upstream reads one on
  // its line only) stays unconsumed, so the statement fails.
  while (remaining.startsWith('&')) {
    if (parserObservationActive('flowchart')) observeParserToken('flowchart', 'parallel-separator', '&')
    const next = consumeNode(remaining.slice(1).trim(), graph, subgraphStack, declaredSubgraphIds, notes)
    if (!next) break
    ids.push(next.id)
    remaining = next.remaining.trim()
  }

  return { ids, remaining }
}

interface ConsumedNode {
  id: string
  remaining: string
}

function consumeMetadataNode(
  text: string,
  graph: MermaidGraph,
  subgraphStack: MermaidSubgraph[]
): ConsumedNode | null {
  const identifier = consumeBareNodeId(text)
  const open = identifier && text.slice(identifier.length).match(new RegExp(`^${METADATA_OPEN_SOURCE}`))
  if (!identifier || !open) return null
  const id = identifier.id
  const { end, entries } = readFlowchartMetadata(text, identifier.length + open[0].length - 1)
  applyNodeMetadata(id, entries, graph, subgraphStack)
  return { id, remaining: text.slice(end + 1) }
}

/** Apply one metadata object whether authored as `A@{...}` or `A[Label]@{...}`. */
function applyNodeMetadata(
  id: string,
  entries: ReadonlyMap<string, unknown>,
  graph: MermaidGraph,
  subgraphStack: MermaidSubgraph[]): void {
  // Upstream reads a truthy `label` only; an explicit empty label stays empty
  // here, the spelling a label-less shape (`sm-circ`) is written with.
  const rawLabel = entries.get('label')
  const label = rawLabel === '' ? '' : metadataText(rawLabel)
  const parsedLabel = label !== undefined ? parseFlowchartLabel(label, true) : undefined
  // v11 typed shapes (repo #44): documented `@{ shape: ... }` names normalize
  // through the ONE table in src/flowchart-shapes.ts to a semantic shape id +
  // rendering geometry; the authored spelling is preserved for round-trip.
  // Undocumented names keep the #29 safety floor (labeled rectangle).
  const shapeName = metadataField(entries, 'shape')
  const v11 = shapeName !== undefined ? normalizeV11Shape(shapeName) : null
  const icon = metadataField(entries, 'icon')
  const image = metadataField(entries, 'img')
  const form = metadataField(entries, 'form')
  const iconForm: MermaidNode['iconForm'] = form === 'circle' || form === 'rounded' || form === 'square' ? form : undefined
  const shapeFields = v11 ? { shape: v11.geometry, semanticShape: v11.canonical, authoredShape: shapeName! }
    : icon || image ? { shape: iconForm === 'circle' ? ('circle' as const) : iconForm === 'rounded' ? ('rounded' as const) : ('rectangle' as const), semanticShape: icon ? 'icon' : 'image' }
    : {}
  const mediaFields = { ...(icon ? { icon } : {}), ...(image ? { image } : {}), ...(iconForm ? { iconForm } : {}) }
  const existing = graph.nodes.get(id)
  if (existing) {
    graph.nodes.set(id, {
      ...existing,
      ...(parsedLabel !== undefined ? { label: parsedLabel.text, labelContent: parsedLabel.labelContent, ...(parsedLabel.markdown ? { markdownLabel: true as const } : {}) } : {}),
      ...shapeFields,
      ...mediaFields,
    })
    if (parserObservationActive('flowchart')) observeParserMutation('flowchart', 'set-node-metadata', graph.nodes.get(id))
    trackInSubgraph(subgraphStack, id)
  } else {
    registerNode(graph, subgraphStack, {
      id,
      label: parsedLabel?.text ?? id,
      ...(parsedLabel?.labelContent ? { labelContent: parsedLabel.labelContent } : {}),
      shape: 'rectangle',
      ...(parsedLabel?.markdown ? { markdownLabel: true as const } : {}),
      ...shapeFields,
      ...mediaFields,
    })
  }
}

function consumeNodeMetadataSuffix(
  id: string,
  text: string,
  graph: MermaidGraph,
  subgraphStack: MermaidSubgraph[]): string | null {
  const start = text.match(new RegExp(`^${METADATA_OPEN_SOURCE}`))
  if (!start) return null
  const { end, entries } = readFlowchartMetadata(text, start[0].length - 1)
  applyNodeMetadata(id, entries, graph, subgraphStack)
  return text.slice(end + 1)
}


const QUOTED_SHAPE_DELIMITERS: Array<{ open: string; close: string; shape: NodeShape }> = [
  { open: '(((', close: ')))', shape: 'doublecircle' },
  { open: '([', close: '])', shape: 'stadium' },
  { open: '(-', close: '-)', shape: 'ellipse' },
  { open: '((', close: '))', shape: 'circle' },
  { open: '[[', close: ']]', shape: 'subroutine' },
  { open: '[(', close: ')]', shape: 'cylinder' },
  { open: '[/', close: '\\]', shape: 'trapezoid' },
  { open: '[\\', close: '/]', shape: 'trapezoid-alt' },
  { open: '[/', close: '/]', shape: 'lean-r' },
  { open: '[\\', close: '\\]', shape: 'lean-l' },
  { open: '>', close: ']', shape: 'asymmetric' },
  { open: '{{', close: '}}', shape: 'hexagon' },
  { open: '[', close: ']', shape: 'rectangle' },
  { open: '(', close: ')', shape: 'rounded' },
  { open: '{', close: '}', shape: 'diamond' },
]

/** Quote-aware shape consumption: delimiters inside an authored quoted label
 * are text, not the end of the node. One scanner covers every legacy shape. */
/** A label that is an empty string (`A[""]`, `|""|`): upstream's string
 * token needs a character, and it rejects the label. */
const EMPTY_STRING_LABEL_RE = /^\s*""\s*$/

function consumeQuotedShapeNode(
  text: string,
  graph: MermaidGraph,
  subgraphStack: MermaidSubgraph[],
  notes?: FlowchartNodeNotes): ConsumedNode | null {
  const identifier = consumeBareNodeId(text)
  if (!identifier) return null
  const suffix = text.slice(identifier.length)
  for (const spec of QUOTED_SHAPE_DELIMITERS) {
    if (!suffix.startsWith(`${spec.open}"`)) continue
    const quoteStart = spec.open.length
    const quoteEnd = suffix.indexOf('"', quoteStart + 1)
    if (quoteEnd < 0 || !suffix.startsWith(spec.close, quoteEnd + 1)) continue
    if (quoteEnd === quoteStart + 1) notes?.add('empty-string')
    const parsed = parseFlowchartLabel(suffix.slice(quoteStart + 1, quoteEnd), true)
    defineNode(graph, subgraphStack, {
      id: identifier.id,
      label: parsed.text,
      ...(parsed.labelContent ? { labelContent: parsed.labelContent } : {}),
      shape: spec.shape,
      ...(parsed.markdown ? { markdownLabel: true as const } : {}),
    })
    const consumed = identifier.length + quoteEnd + 1 + spec.close.length
    return { id: identifier.id, remaining: text.slice(consumed) }
  }
  return null
}

/**
 * Try to consume a node definition from the start of `text`.
 * If the node has a shape+label (e.g. A[Text]), it's registered in the graph.
 * If it's a bare reference (e.g. A), we look it up or create a default.
 * Also handles ::: class shorthand suffix.
 */
function consumeNode(
  text: string,
  graph: MermaidGraph,
  subgraphStack: MermaidSubgraph[],
  declaredSubgraphIds: Set<string>,
  notes?: FlowchartNodeNotes): ConsumedNode | null {
  const metadataNode = consumeMetadataNode(text, graph, subgraphStack)
  if (metadataNode) {
    let remaining = metadataNode.remaining
    const classMatch = consumeClassShorthand(remaining)
    if (classMatch) {
      appendGraphClass(graph.classAssignments, metadataNode.id, classMatch.className)
      if (parserObservationActive('flowchart')) observeParserMutation('flowchart', 'append-class', { id: metadataNode.id, name: classMatch.className, classes: graph.classAssignments.get(metadataNode.id) })
      remaining = remaining.slice(classMatch.length)
    }
    if (parserObservationActive('flowchart')) observeParserToken('flowchart', 'metadata-node', text.slice(0, text.length - remaining.length))
    return { id: metadataNode.id, remaining }
  }

  const quotedShapeNode = consumeQuotedShapeNode(text, graph, subgraphStack, notes)
  if (quotedShapeNode) {
    let remaining = consumeNodeMetadataSuffix(quotedShapeNode.id, quotedShapeNode.remaining, graph, subgraphStack)
      ?? quotedShapeNode.remaining
    const classMatch = consumeClassShorthand(remaining)
    if (classMatch) {
      appendGraphClass(graph.classAssignments, quotedShapeNode.id, classMatch.className)
      if (parserObservationActive('flowchart')) observeParserMutation('flowchart', 'append-class', { id: quotedShapeNode.id, name: classMatch.className, classes: graph.classAssignments.get(quotedShapeNode.id) })
      remaining = remaining.slice(classMatch.length)
    }
    if (parserObservationActive('flowchart')) observeParserToken('flowchart', 'quoted-node', text.slice(0, text.length - remaining.length))
    return { id: quotedShapeNode.id, remaining }
  }

  let id: string | null = null
  let remaining: string = text

  // Try each node pattern (shape-qualified)
  const identifier = consumeBareNodeId(text)
  const shapeText = identifier ? text.slice(identifier.length) : ''
  for (const { regex, shape } of identifier ? NODE_PATTERNS : []) {
    const match = shapeText.match(regex)
    if (match) {
      id = identifier!.id
      if (labelTextHoldsDelimiter(match[1]!, TRAPEZOID_SHAPES.has(shape) ? 'trapezoid' : 'text')) notes?.add('label-delimiter')
      if (EMPTY_STRING_LABEL_RE.test(match[1]!)) notes?.add('empty-string')
      const { text: label, markdown, labelContent } = parseFlowchartLabel(match[1]!)
      defineNode(graph, subgraphStack, { id, label, shape, ...(markdown ? { markdownLabel: true as const } : {}), ...(labelContent ? { labelContent } : {}) })
      remaining = shapeText.slice(match[0].length)
      break
    }
  }

  // Creation and membership are independent: a reference contributes to its
  // current block even when the identity was declared elsewhere. Ownership
  // is resolved once, when each block closes.
  if (id === null) {
    const bare = consumeBareNodeId(text)
    if (bare) {
      id = bare.id
      mentionNode(graph, id, declaredSubgraphIds)
      trackInSubgraph(subgraphStack, id)
      remaining = text.slice(bare.length)
    }
  }

  if (id === null) return null

  // Metadata may refine an inline node definition (`A[Label]@{...}`) without
  // becoming an unexplained suffix or a set of phantom key-nodes.
  remaining = consumeNodeMetadataSuffix(id, remaining, graph, subgraphStack) ?? remaining

  // Check for ::: class shorthand suffix immediately after the node
  const classMatch = consumeClassShorthand(remaining)
  if (classMatch) {
    appendGraphClass(graph.classAssignments, id, classMatch.className)
    if (parserObservationActive('flowchart')) observeParserMutation('flowchart', 'append-class', { id, name: classMatch.className, classes: graph.classAssignments.get(id) })
    remaining = remaining.slice(classMatch.length)
  }

  // Upstream's node string runs on through a `.` or `"` right after a class
  // name (`A:::c.-> B`), which begins no link or string here: the statement
  // fails.
  if (continuesNodeId(text, text.length - remaining.length)) return null

  // Upstream's lexer reads a run without blanks or `"` from a node's start to
  // an `@` (not `@{`) as an edge id (`A[a@b]` is the edge id `A[a` there).
  if (notes?.nodeEdgeId(text)) notes.add('node-edge-id')
  if (parserObservationActive('flowchart')) observeParserToken('flowchart', 'node', text.slice(0, text.length - remaining.length))
  return { id, remaining }
}

interface FlowchartNodeNotes {
  add(note: FlowchartStatementNote): void
  nodeEdgeId(suffix: string): boolean
}

/** Index the diagnostic's /^[^\s"]+@(?![{"])/ once, rather than scanning
 * the remaining chain at every node. Node consumers only take suffixes of
 * this trimmed statement, so their length gives the original offset. */
function flowchartNodeNotes(statement: string, notes: Set<FlowchartStatementNote>): FlowchartNodeNotes {
  const edgeIds = new Uint8Array(statement.length)
  let reachesEdgeId = false
  for (let index = statement.length - 1; index >= 0; index--) {
    const char = statement[index]!
    if (/[\s"]/.test(char)) reachesEdgeId = false
    else {
      edgeIds[index] = reachesEdgeId ? 1 : 0
      // An @ needs at least one preceding character in the same run.
      if (char === '@' && statement[index + 1] !== '{' && statement[index + 1] !== '"') reachesEdgeId = true
    }
  }
  return {
    add: note => { notes.add(note) },
    nodeEdgeId: suffix => edgeIds[statement.length - suffix.length] === 1,
  }
}
/** A pipe label's text from its opening pipe to an `@` without a blank or
 * `"`, which upstream's lexer reads, with the pipe, as an edge id. */
const PIPE_LABEL_EDGE_ID_RE = /^[^\s"]*@(?![{"])/

/** Register a node from a shaped definition (`b[Label]`, `b(("Label"))`). A
 * node already referenced takes the definition's label and shape, as Mermaid
 * does: `a --> b` then `b[Label B]` draws "Label B", not "b". */
function defineNode(
  graph: MermaidGraph,
  subgraphStack: MermaidSubgraph[],
  node: MermaidNode): void {
  const existing = graph.nodes.get(node.id)
  if (!existing) {
    registerNode(graph, subgraphStack, node)
    return
  }
  const { markdownLabel: _markdown, semanticShape: _semantic, authoredShape: _authored, labelContent: _content, ...kept } = existing
  graph.nodes.set(node.id, { ...kept, label: node.label, shape: node.shape, ...(node.markdownLabel ? { markdownLabel: true as const } : {}), ...(node.labelContent ? { labelContent: node.labelContent } : {}) })
  if (parserObservationActive('flowchart')) observeParserMutation('flowchart', 'define-node', graph.nodes.get(node.id))
  trackInSubgraph(subgraphStack, node.id)
}

/** Mermaid's first mention creates a node: a rectangle labelled by its id
 * (upstream's `addVertex`). A declared subgraph id names the subgraph, not a
 * node. Returns whether the node was created. */
function mentionNode(graph: MermaidGraph, id: string, declaredSubgraphIds: ReadonlySet<string>): boolean {
  if (graph.nodes.has(id) || declaredSubgraphIds.has(id)) return false
  assertGraphNodeInsertion(graph)
  graph.nodes.set(id, { id, label: id, shape: 'rectangle' })
  if (parserObservationActive('flowchart')) observeParserMutation('flowchart', 'add-node', graph.nodes.get(id))
  return true
}

/** Register a node in the graph and track it in the current subgraph */
function registerNode(
  graph: MermaidGraph,
  subgraphStack: MermaidSubgraph[],
  node: MermaidNode
): void {
  const isNew = !graph.nodes.has(node.id)
  if (isNew) {
    assertGraphNodeInsertion(graph)
    graph.nodes.set(node.id, node)
    if (parserObservationActive('flowchart')) observeParserMutation('flowchart', 'add-node', node)
  }
  trackInSubgraph(subgraphStack, node.id)
}

/** Add node ID to the innermost subgraph if we're inside one */
function trackInSubgraph(subgraphStack: MermaidSubgraph[], nodeId: string): void {
  if (subgraphStack.length > 0) {
    const current = subgraphStack[subgraphStack.length - 1]!
    if (!current.nodeIds.includes(nodeId)) {
      current.nodeIds.push(nodeId)
      if (parserObservationActive('flowchart')) observeParserMutation('flowchart', 'add-member', { parent: current.id, id: nodeId })
    }
  }
}

/** Map arrow operator string to edge style (ignoring direction/length) */
function arrowStyleFromOp(op: string): EdgeStyle {
  if (op[0] === '~') return 'invisible'
  if (op.includes('.')) return 'dotted'
  if (op.includes('=')) return 'thick'
  return 'solid'
}

/**
 * Mermaid link length (rank distance): 1 for a base operator, +1 per extra
 * shaft unit. Returns undefined for the base length so base-form edges carry
 * no `length` field and serialize byte-identically.
 */
function arrowLengthFromOp(op: string): number | undefined {
  let extra: number
  if (op[0] === '~') {
    extra = op.length - 3 // ~~~ base
  } else if (op.includes('.')) {
    extra = (op.match(/\./g)?.length ?? 1) - 1 // -.-> / -.- base = 1 dot
  } else if (op.includes('=')) {
    const eq = op.match(/=/g)?.length ?? 2
    extra = /[>ox]$/.test(op) ? eq - 2 : eq - 3 // ==> and ==x base 2, === base 3
  } else {
    const dashes = op.match(/-/g)?.length ?? 2
    const terminated = /[>ox]$/.test(op) || /^[ox]/.test(op)
    extra = terminated ? dashes - 2 : dashes - 3 // --> base 2, --- base 3
  }
  return extra > 0 ? extra + 1 : undefined
}

/** Map text-embedded arrow open/close operators to edge style */
function textArrowStyleFromOps(openOp: string, closeOp: string): EdgeStyle {
  if (openOp.includes('.') || closeOp.includes('.')) return 'dotted'
  if (openOp.includes('=') || closeOp.includes('=')) return 'thick'
  return 'solid'
}

/**
 * Mermaid's text-embedded label syntax splits the operator around the label
 * (`-- label -->`, `-. label .->`, `== label ==>`). Extra shaft units may be
 * written on either side; serialize them through the single MermaidEdge length
 * field so round-tripping does not collapse rank distance.
 */
function textArrowLengthFromOps(openOp: string, closeOp: string): number | undefined {
  const style = textArrowStyleFromOps(openOp, closeOp)
  const count = (s: string, ch: string) => (s.match(new RegExp(`\\${ch}`, 'g')) ?? []).length
  let extraOpen = 0
  let extraClose = 0
  if (style === 'dotted') {
    extraOpen = Math.max(0, count(openOp, '.') - 1)
    extraClose = Math.max(0, count(closeOp, '.') - 1)
  } else if (style === 'thick') {
    extraOpen = Math.max(0, count(openOp, '=') - 2)
    extraClose = Math.max(0, count(closeOp, '=') - (/[>ox]$/.test(closeOp) ? 2 : 3))
  } else {
    extraOpen = Math.max(0, count(openOp, '-') - 2)
    extraClose = Math.max(0, count(closeOp, '-') - (/[>ox]$/.test(closeOp) ? 2 : 3))
  }
  const extra = Math.max(extraOpen, extraClose)
  return extra > 0 ? extra + 1 : undefined
}

function startMarkerForOp(op: string, hasLeftAngle: boolean): EdgeMarker | undefined {
  if (hasLeftAngle) return 'arrow'
  if (op.startsWith('o')) return 'circle'
  if (op.startsWith('x')) return 'cross'
  return undefined
}

function endMarkerForOp(op: string): EdgeMarker | undefined {
  const last = op[op.length - 1]
  if (last === '>') return 'arrow'
  if (last === 'o') return 'circle'
  if (last === 'x') return 'cross'
  return undefined
}
