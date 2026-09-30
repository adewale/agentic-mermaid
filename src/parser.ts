import type { MermaidGraph, MermaidNode, MermaidEdge, MermaidSubgraph, Direction, NodeShape, EdgeStyle, EdgeMarker } from './types.ts'
import { normalizeBrTags } from './multiline-utils.ts'
import { parseFlowchartLabel } from './flowchart-labels.ts'
import { createSubgraphMembership } from './shared/subgraph-membership.ts'
import { normalizeV11Shape } from './flowchart-shapes.ts'
import {
  matchNoteLine, matchNoteOpen, isNoteEnd, matchStereotypeDecl,
  isConcurrencySeparator, isStateNodeId, matchHistoryEndpoint, matchTransitionLine, historyLabel,
  stripStateComment, matchStateClassAssignment, stateNoteText,
} from './state/parse-core.ts'
import { parseStyleProps } from './shared/style-props.ts'
export { parseStyleProps } from './shared/style-props.ts'
import {
  MERMAID_IDENTIFIER_SOURCE,
  consumeClassShorthandPrefix,
  consumeMermaidIdentifier,
  isMermaidIdentifier,
  parseClassShorthandStatement,
} from './shared/mermaid-identifiers.ts'
import { metadataText, readMetadataBlock } from './shared/metadata-yaml.ts'
import { syntaxError } from './shared/syntax-error.ts'
import { classifyMermaidFamilyFromFirstLine } from './family-detection.ts'
import { detectCompatibilityGraphFamilyFromFirstLine } from './agent/family-router.ts'
import {
  coalesceFlowchartMetadataLines,
  flowchartRegionAt,
  flowchartStatementSpans,
  matchFlowchartLink,
  matchTextArrow,
  scanFlowchart,
} from './flowchart-lexer.ts'

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
export function parseMermaid(text: string): MermaidGraph {
  const rawLines = text.split('\n')
  const firstStatement = rawLines.find(line => line.trim().length > 0 && !line.trim().startsWith('%%'))?.trim() ?? ''
  // State comments can contain syntax-looking delimiters. Remove them before
  // the generic Markdown/metadata coalescers and inline-header splitter run.
  const semanticLines = /^stateDiagram(?:-v2)?(?=$|[\s;%])/i.test(firstStatement)
    ? rawLines.map(stripStateComment)
    : rawLines
  const lines = expandInlineHeaderStatements(coalesceMetadataLines(coalesceMarkdownStringLines(semanticLines)).map(l => l.trim()).filter(l => l.length > 0 && !l.startsWith('%%')))

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
  if (familyId === 'flowchart') return parseFlowchart(lines)

  if (detection.kind === 'unknown') throw new Error(`Unknown Mermaid diagram header: ${header}`)
  const detectedFamilyId = detection.kind === 'registered' ? detection.familyId : detection.match.family.id

  // This compatibility API returns a MermaidGraph and therefore cannot
  // truthfully parse non-graph families. Family-neutral callers should use
  // the agent parser instead of falling through to the flowchart grammar.
  throw new Error(`Mermaid family "${detectedFamilyId}" is not a graph family; use the family-neutral agent parser`)
}

function expandInlineHeaderStatements(lines: string[]): string[] {
  if (lines.length === 0 || !lines[0]!.includes(';')) return lines
  // The header's direction (`graph >`) is not a statement: split after it.
  const header = lines[0]!.match(/^(?:(?:graph|flowchart|swimlane)(?:[ \t]+(?:TD|TB|LR|BT|RL|[<>^v])(?![\w-]))?|stateDiagram(?:-v2)?)(?=$|[\s;])/i)
  if (!header) return lines
  const rest = lines[0]!.slice(header[0].length).trim()
  if (!rest.startsWith(';')) return lines
  return [header[0], ...splitFlowchartStatements(rest), ...lines.slice(1)]
}

/**
 * Mermaid v11 uses `id@{ ... }` metadata blocks for flowchart nodes. The
 * legacy parser is line-oriented; without this coalescing pass, multiline
 * metadata keys such as `shape:` and `label:` are treated as standalone node
 * statements. Keep the whole metadata object attached to its node token so the
 * node consumer can handle it as one unit (flowchart-lexer.ts joins the lines
 * as upstream's lexer reads them).
 */
function coalesceMetadataLines(lines: string[]): string[] {
  return coalesceFlowchartMetadataLines(lines).map(group => group.text)
}

/**
 * Mermaid markdown strings ("`…`") may contain literal newlines as explicit
 * line breaks. The parser is line-oriented, so a line that ends inside a
 * markdown string (flowchart-lexer.ts) joins the following lines until the
 * string closes. The break is joined as '<br>' — the label pipeline's
 * canonical line-break token — so the single-line shape grammars keep
 * matching and the label normalizer restores '\n'.
 * Comment lines outside an open string pass through untouched.
 */
function coalesceMarkdownStringLines(lines: string[]): string[] {
  const out: string[] = []
  let current: string[] | null = null
  for (const line of lines) {
    if (current) {
      current.push(line.trim())
      if (!endsInsideMarkdownString(current.join('<br>'))) {
        out.push(current.join('<br>'))
        current = null
      }
      continue
    }
    if (line.trim().startsWith('%%')) { out.push(line); continue }
    if (endsInsideMarkdownString(line)) {
      current = [line]
      continue
    }
    out.push(line)
  }
  if (current) out.push(current.join('<br>'))
  return out
}

function endsInsideMarkdownString(text: string): boolean {
  return text.includes('"`') && scanFlowchart(text).openAtEnd.includes('markdown')
}

function parseFlowchartSubgraphDeclaration(rest: string): { id: string; label: string } {
  // Delimiter scanning is deliberately linear. A lazy `(.+?)` matcher followed
  // by a bracketed label backtracked quadratically over long unterminated runs
  // of `[` — an input shape that fits the hosted 64 KiB source limit.
  const labelStart = rest.indexOf('[')
  if (labelStart > 0 && labelStart < rest.length - 1 && rest.endsWith(']')) {
    const id = rest.slice(0, labelStart).trim()
    if (!isMermaidIdentifier(id)) {
      throw new Error(`Invalid flowchart subgraph identifier ${JSON.stringify(id)}`)
    }
    return { id, label: parseFlowchartLabel(rest.slice(labelStart + 1, -1)).text }
  }
  const label = parseFlowchartLabel(rest).text
  // Mermaid identifiers are Unicode-aware everywhere else in this parser.
  // Preserve non-Latin letters/numbers when deriving the implicit container id
  // instead of silently collapsing a CJK title to an empty string.
  const id = rest.replace(/\s+/g, '_').replace(/[^\p{L}\p{N}_-]/gu, '')
  return { id, label }
}

/** Shared statement splitter for renderer and source-side action analysis:
 *  a `;` ends a statement where the flowchart lexer (flowchart-lexer.ts)
 *  reads it at statement level. */
export function splitFlowchartStatements(line: string): string[] {
  return flowchartStatementSpans(line).map(statement => statement.text)
}

function isFlowchartInteractionDirective(line: string): boolean {
  return /^(?:click|href)\s+/i.test(line.trim())
}

function applyFlowchartInteraction(graph: MermaidGraph, line: string): void {
  const match = line.trim().match(/^(?:click\s+)?([\w-]+)\s+(?:href\s+)?(?:"((?:\\.|[^"])*)"|(https?:\/\/\S+|mailto:\S+))/i)
  if (!match) return
  const href = (match[2] ?? match[3] ?? '').replace(/\\(["\\])/g, '$1')
  if (!/^(?:https?:|mailto:)/i.test(href)) return
  const node = graph.nodes.get(match[1]!)
  if (node) node.href = href
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
}

/** A whole `id@{…}` statement that addresses an edge, or null. Ours also
 * reads `id @{…}` and `id@ {…}` (METADATA_OPEN_SOURCE). */
function edgeMetadataStatement(graph: MermaidGraph, line: string): MetadataStatement | null {
  const statement = line.trim()
  const head = statement.match(new RegExp(`^([\\w-]+)${METADATA_OPEN_SOURCE}`))
  if (!head) return null
  const { end, entries } = readFlowchartMetadata(statement, head[0].length - 1)
  if (statement.slice(end + 1).trim() !== '') return null
  const id = head[1]!
  // As upstream's `addVertex`: the block addresses an edge declared so far
  // with that id; otherwise it declares (or refines) a node.
  return graph.edges.some(edge => edge.id === id) ? { id, entries } : null
}


// ============================================================================
// Flowchart parser
// ============================================================================

function parseFlowchart(lines: string[]): MermaidGraph {
  const headerMatch = lines[0]!.match(/^(?:(?:graph|swimlane)\s+(TD|TB|LR|BT|RL|[<>^v])|flowchart(?:\s+(TD|TB|LR|BT|RL|[<>^v]))?)\s*$/i)
  if (!headerMatch) {
    throw new Error(`Invalid mermaid header: "${lines[0]}". Expected "graph TD", "flowchart LR", "stateDiagram-v2", etc.`)
  }

  const direction = normalizeFlowchartDirection(headerMatch[1] ?? headerMatch[2] ?? 'TD')

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
  const declaredSubgraphIds = collectDeclaredFlowchartSubgraphIds(lines.slice(1))
  // Upstream's membership rule: the first subgraph to close keeps a node.
  const membership = createSubgraphMembership()

  for (let i = 1; i < lines.length; i++) {
    for (const line of splitFlowchartStatements(lines[i]!)) {
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
        const props = parseStyleProps(classDefMatch[2]!)
        if (Object.keys(props).length === 0) continue
        for (const name of names) graph.classDefs.set(name, props)
        continue
      }

      // --- class assignment: `class A,B className` ---
      const classAssignMatch = line.match(/^class\s+([\w,-]+)\s+([\w-]+)\s*;?$/)
      if (classAssignMatch) {
        const nodeIds = classAssignMatch[1]!.split(',').map(s => s.trim())
        const className = classAssignMatch[2]!
        for (const id of nodeIds) {
          graph.classAssignments.set(id, className)
        }
        continue
      }

      // --- style statement: `style A,B fill:#f00,stroke:#333` ---
      const styleMatch = line.match(/^style\s+([\w,-]+)\s+(.+)$/)
      if (styleMatch) {
        const nodeIds = styleMatch[1]!.split(',').map(s => s.trim()).filter(Boolean)
        // A styled id is a mention: it creates the node, as upstream's
        // `addVertex` does, though a `style` line makes no subgraph member.
        for (const id of nodeIds) mentionNode(graph, id, declaredSubgraphIds)
        const props = parseStyleProps(styleMatch[2]!)
        if (Object.keys(props).length === 0) continue
        for (const id of nodeIds) {
          graph.nodeStyles.set(id, { ...graph.nodeStyles.get(id), ...props })
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
        const props = parseStyleProps(linkStyleMatch[2]!)
        if (Object.keys(props).length === 0) continue
        if (target === 'default') {
          graph.linkStyles.set('default', { ...graph.linkStyles.get('default'), ...props })
        } else {
          for (const idx of indices) graph.linkStyles.set(idx, { ...graph.linkStyles.get(idx), ...props })
        }
        continue
      }

      // --- direction override: root graph or innermost subgraph ---
      const dirMatch = line.match(/^direction\s+(TD|TB|LR|BT|RL)\s*$/i)
      if (dirMatch) {
        const direction = dirMatch[1]!.toUpperCase() as Direction
        if (subgraphStack.length > 0) subgraphStack[subgraphStack.length - 1]!.direction = direction
        else graph.direction = direction
        continue
      }

      // --- subgraph start: `subgraph Label` or `subgraph id [Label]` ---
      const subgraphMatch = line.match(/^subgraph\s+(.+)$/)
      if (subgraphMatch) {
        const rest = subgraphMatch[1]!.trim()
        const { id, label } = parseFlowchartSubgraphDeclaration(rest)
        const sg: MermaidSubgraph = { id, label, nodeIds: [], children: [] }
        subgraphStack.push(sg)
        continue
      }

      // --- subgraph end ---
      if (line === 'end') {
        const completed = subgraphStack.pop()
        if (completed) {
          completed.nodeIds = membership.close(completed.id, completed.nodeIds)
          if (subgraphStack.length > 0) {
            subgraphStack[subgraphStack.length - 1]!.children.push(completed)
          } else {
            graph.subgraphs.push(completed)
          }
        }
        continue
      }

      // --- Edge/node definitions ---
      const parsed = parseEdgeLine(line, graph, subgraphStack, declaredSubgraphIds)
      if (!parsed.ok) throw invalidFlowchartStatement(line, parsed)
    }
  }

  return graph
}

/** The error for a statement the edge grammar could not consume, naming the
 * construct upstream rejects there when there is one. */
function invalidFlowchartStatement(line: string, parsed: Extract<EdgeLineParseResult, { ok: false }>): Error {
  const where = `Invalid flowchart statement "${line}"`
  if (/^<?(?:-{2,}|-\.+|={2,})/.test(parsed.remaining)) {
    return syntaxError({
      what: `${where}: "${parsed.remaining}" opens a link label that no link closes (\`--\` and \`-.\` always open a link, so a node id cannot hold them)`,
      expectedForm: 'a label closed by a link of the same stroke, or an id without `--`',
      example: 'A -- label --> B, A == label ==> B or A -. label .-> B',
    })
  }
  return new Error(`${where}: could not fully consume ${parsed.reason}; remaining input: "${parsed.remaining}"`)
}

function collectDeclaredFlowchartSubgraphIds(lines: string[]): Set<string> {
  const ids = new Set<string>()
  for (const raw of lines) {
    for (const line of splitFlowchartStatements(raw)) {
      const subgraphMatch = line.match(/^subgraph\s+(.+)$/)
      if (!subgraphMatch) continue
      const rest = subgraphMatch[1]!.trim()
      ids.add(parseFlowchartSubgraphDeclaration(rest).id)
    }
  }
  return ids
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
  // Track all composite state IDs to avoid creating duplicate nodes
  const compositeStateIds = new Set<string>()
  // Counter for unique [*] pseudostate IDs
  let startCount = 0
  let endCount = 0
  // Per-composite region counter (for stable region ids `X__r1`, `X__r2`, …).
  const regionCounts = new Map<string, number>()
  // Open block note (`note left of X` … `end note`), collecting body lines.
  let openNote: { target: string; side: 'left' | 'right'; lines: string[] } | null = null

  const addNote = (target: string, side: 'left' | 'right', text: string): void => {
    if (!graph.stateNotes) graph.stateNotes = []
    graph.stateNotes.push({ id: `note#${graph.stateNotes.length}`, target, side, text })
    // A note on an undeclared state declares it (upstream parity) — unless the
    // id is (or later becomes) a composite, which the composite opener handles.
    if (!compositeStateIds.has(target)) ensureStateNode(graph, compositeStack, target)
  }

  /** Resolve a transition endpoint: `[*]` pseudostates, `[H]`/`X[H]` history
   *  pseudostates (registered as state-history nodes), composites, and plain
   *  states. Returns the graph node id to wire the edge to. */
  const resolveEndpoint = (raw: string, endpoint: 'source' | 'target'): string => {
    if (raw === '[*]') {
      if (endpoint === 'source') {
        startCount++
        const id = `_start${startCount > 1 ? startCount : ''}`
        registerStateNode(graph, compositeStack, { id, label: '', shape: 'state-start' })
        return id
      }
      endCount++
      const id = `_end${endCount > 1 ? endCount : ''}`
      registerStateNode(graph, compositeStack, { id, label: '', shape: 'state-end' })
      return id
    }
    const history = matchHistoryEndpoint(raw)
    if (history) {
      // A bare [H]/[H*] belongs to the enclosing composite (region's parent);
      // `Base[H]` names its composite explicitly. Repeated references to the
      // same history resolve to the same node.
      const enclosing = [...compositeStack].reverse().find(sg => !sg.concurrencyRegion)
      const base = history.base !== '' ? history.base : enclosing?.id ?? ''
      const id = `${base}[H${history.deep ? '*' : ''}]`
      registerStateNode(graph, compositeStack, { id, label: historyLabel(history.deep), shape: 'state-history' })
      return id
    }
    if (!compositeStateIds.has(raw)) ensureStateNode(graph, compositeStack, raw)
    return raw
  }

  for (let i = 1; i < lines.length; i++) {
    const line = stripStateComment(lines[i]!)
    if (!line) continue

    // --- open block note: collect body lines verbatim until `end note` ---
    if (openNote) {
      if (isNoteEnd(line)) {
        addNote(openNote.target, openNote.side, stateNoteText(openNote.lines))
        openNote = null
      } else {
        openNote.lines.push(line)
      }
      continue
    }

    // --- notes: `note left|right of X : text` / `note left|right of X` ---
    const noteLine = matchNoteLine(line)
    if (noteLine) {
      addNote(noteLine.target, noteLine.side, stateNoteText([noteLine.text]))
      continue
    }
    const noteOpen = matchNoteOpen(line)
    if (noteOpen) {
      openNote = { target: noteOpen.target, side: noteOpen.side, lines: [] }
      continue
    }

    // --- direction override ---
    const dirMatch = line.match(/^direction\s+(TD|TB|LR|BT|RL)\s*$/i)
    if (dirMatch) {
      if (compositeStack.length > 0) {
        compositeStack[compositeStack.length - 1]!.direction = dirMatch[1]!.toUpperCase() as Direction
      } else {
        graph.direction = dirMatch[1]!.toUpperCase() as Direction
      }
      continue
    }

    // --- classDef: shared paint model with flowcharts ---
    const stateClassDefMatch = line.match(/^classDef\s+([\w,-]+)\s+(.+)$/)
    if (stateClassDefMatch) {
      const names = stateClassDefMatch[1]!.split(',').map(name => name.trim()).filter(Boolean)
      const props = parseStyleProps(stateClassDefMatch[2]!)
      for (const name of names) graph.classDefs.set(name, props)
      continue
    }

    // --- class/cssClass assignment and inline state style ---
    const stateClassAssignment = matchStateClassAssignment(line)
    if (stateClassAssignment) {
      for (const id of stateClassAssignment.ids) {
        ensureStateNode(graph, compositeStack, id)
        graph.classAssignments.set(id, stateClassAssignment.className)
      }
      continue
    }
    const stateInlineStyle = line.match(/^style\s+([\w\p{L},-]+)\s+(.+)$/u)
    if (stateInlineStyle) {
      const ids = stateInlineStyle[1]!.split(',').map(id => id.trim()).filter(Boolean)
      const props = parseStyleProps(stateInlineStyle[2]!)
      for (const id of ids) {
        ensureStateNode(graph, compositeStack, id)
        graph.nodeStyles.set(id, { ...graph.nodeStyles.get(id), ...props })
      }
      continue
    }

    // --- linkStyle: `linkStyle 0 stroke:#f00` or `linkStyle default stroke:#f00` ---
    const linkStyleMatch = line.match(/^linkStyle\s+(default|[\d,\s]+)\s+(.+)$/)
    if (linkStyleMatch) {
      const target = linkStyleMatch[1]!.trim()
      const props = parseStyleProps(linkStyleMatch[2]!)
      if (Object.keys(props).length === 0) continue
      if (target === 'default') {
        graph.linkStyles.set('default', { ...graph.linkStyles.get('default'), ...props })
      } else {
        const indices = target.split(',').map(s => parseInt(s.trim(), 10))
        for (const idx of indices) {
          if (!isNaN(idx)) {
            graph.linkStyles.set(idx, { ...graph.linkStyles.get(idx), ...props })
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
      graph.nodes.set(stereotype.id, { id: stereotype.id, label, shape })
      trackInStateScope(compositeStack, stereotype.id)
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
        const first: MermaidSubgraph = {
          id: `${composite.id}__r${nextRegion(regionCounts, composite.id)}`,
          label: '',
          nodeIds: composite.nodeIds.splice(0),
          children: composite.children.splice(0),
          concurrencyRegion: true,
        }
        composite.children.push(first)
      }
      const next: MermaidSubgraph = {
        id: `${composite.id}__r${nextRegion(regionCounts, composite.id)}`,
        label: '',
        nodeIds: [],
        children: [],
        concurrencyRegion: true,
      }
      composite.children.push(next)
      compositeStack.push(next)
      continue
    }

    // --- composite state start: `state CompositeState {` ---
    const compositeMatch = line.match(/^state\s+(?:"([^"]+)"\s+as\s+)?([\w\p{L}-]+)\s*\{$/u)
    if (compositeMatch) {
      const label = compositeMatch[1] ?? compositeMatch[2]!
      const id = compositeMatch[2]!
      const sg: MermaidSubgraph = { id, label, nodeIds: [], children: [] }
      compositeStack.push(sg)
      // Track this ID to avoid creating a duplicate node for the composite state
      compositeStateIds.add(id)
      // Remove any existing node that was created when parsing transitions before
      // this composite state definition (e.g., "A --> Processing" before "state Processing {")
      graph.nodes.delete(id)
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
        if (compositeStack.length > 0) {
          compositeStack[compositeStack.length - 1]!.children.push(completed)
        } else {
          graph.subgraphs.push(completed)
        }
      }
      continue
    }

    // --- state alias: `state "Description" as s1` (without brace) ---
    const stateAliasMatch = line.match(/^state\s+"([^"]+)"\s+as\s+([\w\p{L}-]+)\s*$/u)
    if (stateAliasMatch) {
      const label = normalizeBrTags(stateAliasMatch[1]!)
      const id = stateAliasMatch[2]!
      registerStateNode(graph, compositeStack, { id, label, shape: 'rounded' })
      continue
    }

    // --- transition: `s1 --> s2 [: label]`, endpoints may be [*] or history ---
    const transition = matchTransitionLine(line)
    if (transition) {
      const sourceId = resolveEndpoint(transition.from, 'source')
      const targetId = resolveEndpoint(transition.to, 'target')
      if (transition.fromClass) graph.classAssignments.set(sourceId, transition.fromClass)
      if (transition.toClass) graph.classAssignments.set(targetId, transition.toClass)
      const edgeLabel = transition.label ? normalizeBrTags(transition.label) : undefined

      graph.edges.push({
        source: sourceId,
        target: targetId,
        label: edgeLabel,
        style: 'solid',
        hasArrowStart: false,
        hasArrowEnd: true,
      })
      continue
    }

    // --- class shorthand: `s1:::highlight` ---
    // Consume before the description grammar so two of the three colons can
    // never leak into a visible `::highlight` label.
    const stateClass = parseClassShorthandStatement(line)
    if (stateClass) {
      ensureStateNode(graph, compositeStack, stateClass.id)
      graph.classAssignments.set(stateClass.id, stateClass.className)
      continue
    }

    // --- state description / bare declaration ---
    const stateDescMatch = line.match(/^([\w\p{L}-]+)\s*:\s*(.+)$/u)
    if (stateDescMatch) {
      const id = stateDescMatch[1]!
      const label = normalizeBrTags(stateDescMatch[2]!.trim())
      // A description also describes a state a transition already created
      // (Mermaid adds it either way): it replaces the id-only label, and a
      // second description stacks under the first rather than being dropped.
      const existing = graph.nodes.get(id)
      if (existing && existing.shape === 'rounded') {
        graph.nodes.set(id, { ...existing, label: existing.label === id ? label : `${existing.label}\n${label}` })
      }
      registerStateNode(graph, compositeStack, { id, label, shape: 'rounded' })
      continue
    }
    if (isStateNodeId(line)) {
      registerStateNode(graph, compositeStack, { id: line, label: line, shape: 'rounded' })
      continue
    }
  }

  // An unterminated block note still lands (lenient, like unbalanced braces).
  if (openNote) addNote(openNote.target, openNote.side, openNote.lines.join('\n'))

  return graph
}

function nextRegion(counts: Map<string, number>, compositeId: string): number {
  const n = (counts.get(compositeId) ?? 0) + 1
  counts.set(compositeId, n)
  return n
}

/** Track an id in the innermost composite/region scope (no node creation). */
function trackInStateScope(compositeStack: MermaidSubgraph[], id: string): void {
  if (compositeStack.length > 0) {
    const current = compositeStack[compositeStack.length - 1]!
    if (!current.nodeIds.includes(id)) {
      current.nodeIds.push(id)
    }
  }
}

/** Register a state node and track in composite state if applicable */
function registerStateNode(
  graph: MermaidGraph,
  compositeStack: MermaidSubgraph[],
  node: MermaidNode
): void {
  const isNew = !graph.nodes.has(node.id)
  if (isNew) {
    graph.nodes.set(node.id, node)
  }
  if (compositeStack.length > 0) {
    const current = compositeStack[compositeStack.length - 1]!
    if (!current.nodeIds.includes(node.id)) {
      current.nodeIds.push(node.id)
    }
  }
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
    // Track in composite if applicable
    if (compositeStack.length > 0) {
      const current = compositeStack[compositeStack.length - 1]!
      if (!current.nodeIds.includes(id)) {
        current.nodeIds.push(id)
      }
    }
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
  hasArrowStart: boolean
  openOp: string
  rawLabel: string
  closeOp: string
  consumed: number
}

/** `-- label -->`, `-. label .->`, and `== label ==>` (flowchart-lexer.ts
 * `matchTextArrow`): closer-shaped text inside a wholly quoted label is paint,
 * not syntax. */
function consumeTextArrow(text: string): ConsumedTextArrow | null {
  const arrow = matchTextArrow(text, 0)
  if (!arrow) return null
  return {
    hasArrowStart: arrow.hasArrowStart,
    openOp: arrow.openOp,
    rawLabel: text.slice(arrow.labelStart, arrow.labelEnd),
    closeOp: arrow.closeOp,
    consumed: arrow.end,
  }
}

/**
 * Node shape patterns — ordered from most specific delimiters to least.
 * Multi-char delimiters must be tried before single-char to avoid false matches.
 */
const flowchartNodeRegex = (suffix: string): RegExp =>
  new RegExp(`^(${MERMAID_IDENTIFIER_SOURCE})${suffix}`, 'u')

const NODE_PATTERNS: Array<{ regex: RegExp; shape: NodeShape }> = [
  // Triple delimiters (must be first)
  { regex: flowchartNodeRegex(String.raw`\(\(\((.+?)\)\)\)`), shape: 'doublecircle' },

  // Double delimiters with mixed brackets
  { regex: flowchartNodeRegex(String.raw`\(\[(.+?)\]\)`), shape: 'stadium' },
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

/**
 * How much of the identifier run at the start of `text` (`length`
 * characters) is one node id, by upstream's rule (`flow.jison` NODE_STRING):
 * a `-` belongs to an id only when neither `-` nor `.` follows it, since `--`
 * and `-.` always open a link (`A--a --> B` is A, a text-arrow label, B), and
 * an id ends where a link begins (`Go--xH` is G o--x H).
 */
function flowchartIdLength(text: string, length: number): number {
  for (let index = 1; index < length; index++) {
    if (text[index] === '-' && (text[index + 1] === '-' || text[index + 1] === '.')) return index
    if (matchFlowchartLink(text, index)) return index
  }
  return length
}

function consumeBareNodeId(text: string): { id: string; length: number } | null {
  const whole = consumeMermaidIdentifier(text)
  if (!whole) return null
  const length = flowchartIdLength(text, whole.length)
  return { id: text.slice(0, length), length }
}

const EDGE_ID_PREFIX_REGEX = /^([\w-]+)@\s*(?=(?:<)?(?:~{3,}|-\.+->|-\.+-|={2,}>|={3,}|o-{2,}[ox]|x-{2,}[ox]|-{2,}[ox]|-{2,}>|-{3,}|(?:-{2,}|-\.+|={2,})\s+))/

function consumeClassShorthand(text: string): { className: string; length: number } | null {
  const parsed = consumeClassShorthandPrefix(text)
  if (!parsed) return null
  const rest = text.slice(3)
  const end = flowchartIdLength(rest, parsed.className.length)
  return { className: rest.slice(0, end), length: 3 + end }
}

/**
 * Parse a line that contains node definitions and edges.
 * Handles chaining: A --> B --> C produces edges A→B and B→C.
 * Handles parallel links: A & B --> C & D produces 4 edges.
 */
type EdgeLineParseResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly remaining: string; readonly reason: 'expected node' | 'expected edge operator' | 'expected edge target' }

function parseEdgeLine(
  line: string,
  graph: MermaidGraph,
  subgraphStack: MermaidSubgraph[],
  declaredSubgraphIds: Set<string> = new Set(),
): EdgeLineParseResult {
  // A terminal semicolon is a Mermaid statement delimiter, not authored
  // edge/node content. The top-level splitter normally removes it; trim it
  // here as well for labels containing unmatched quote-like characters, where
  // the conservative splitter intentionally leaves the line intact.
  let remaining = line.trim().replace(/;\s*$/, '').trim()

  // Parse the first node group (possibly with & separators). A structured
  // statement is admitted only when every non-whitespace token is consumed;
  // publishing a parsed prefix would silently invent/drop authored content.
  const firstGroup = consumeNodeGroup(remaining, graph, subgraphStack, declaredSubgraphIds)
  if (!firstGroup || firstGroup.ids.length === 0) {
    return { ok: false, remaining, reason: 'expected node' }
  }

  remaining = firstGroup.remaining.trim()
  let prevGroupIds = firstGroup.ids

  // Parse arrow + node-group pairs until the line is exhausted.
  while (remaining.length > 0) {
    let hasArrowStart: boolean
    let style: EdgeStyle
    let hasArrowEnd: boolean
    let startMarker: EdgeMarker | undefined
    let endMarker: EdgeMarker | undefined
    let edgeLabel: string | undefined
    let length: number | undefined

    // v11.6 edge IDs (`e1@-->`): the authored ID is modeled as stable edge
    // identity (plan §Flowchart 7) — carried on MermaidEdge.id, re-emitted
    // verbatim by the serializer, and accepted as an op target selector.
    const edgeIdMatch = remaining.match(EDGE_ID_PREFIX_REGEX)
    const edgeId = edgeIdMatch?.[1]
    if (edgeIdMatch) remaining = remaining.slice(edgeIdMatch[0].length).trim()

    const arrowMatch = matchFlowchartLink(remaining, 0)
    if (arrowMatch) {
      const arrowOp = arrowMatch.op
      let consumed = arrowMatch.end
      const labelSuffix = remaining.slice(consumed)
      if (labelSuffix.startsWith('|')) {
        const pipeLabel = consumePipeLabel(labelSuffix)
        if (!pipeLabel) return { ok: false, remaining: labelSuffix, reason: 'expected edge target' }
        edgeLabel = parseFlowchartLabel(pipeLabel.rawLabel.trim()).text || undefined
        consumed += pipeLabel.consumed
      }
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
      hasArrowStart = textArrow.hasArrowStart
      edgeLabel = parseFlowchartLabel(textArrow.rawLabel).text || undefined
      remaining = remaining.slice(textArrow.consumed).trim()
      style = textArrowStyleFromOps(textArrow.openOp, textArrow.closeOp)
      length = textArrowLengthFromOps(textArrow.openOp, textArrow.closeOp)
      startMarker = hasArrowStart ? 'arrow' : undefined
      endMarker = endMarkerForOp(textArrow.closeOp)
      hasArrowEnd = endMarker !== undefined
    }

    // Parse the next node group
    const nextGroup = consumeNodeGroup(remaining, graph, subgraphStack, declaredSubgraphIds)
    if (!nextGroup || nextGroup.ids.length === 0) {
      return { ok: false, remaining, reason: 'expected edge target' }
    }

    remaining = nextGroup.remaining.trim()

    // Emit Cartesian product of edges: every source × every target
    for (const sourceId of prevGroupIds) {
      for (const targetId of nextGroup.ids) {
        graph.edges.push({
          source: sourceId,
          target: targetId,
          ...(edgeId !== undefined ? { id: edgeId } : {}),
          label: edgeLabel,
          style,
          hasArrowStart,
          hasArrowEnd,
          startMarker,
          endMarker,
          ...(length !== undefined ? { length } : {}),
        })
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
): ConsumedNodeGroup | null {
  const first = consumeNode(text, graph, subgraphStack, declaredSubgraphIds)
  if (!first) return null

  const ids = [first.id]
  let remaining = first.remaining.trim()

  // Check for & separators
  while (remaining.startsWith('&')) {
    remaining = remaining.slice(1).trim()
    const next = consumeNode(remaining, graph, subgraphStack, declaredSubgraphIds)
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
  const start = text.match(new RegExp(`^(${MERMAID_IDENTIFIER_SOURCE})${METADATA_OPEN_SOURCE}`, 'u'))
  if (!start || flowchartIdLength(text, start[1]!.length) < start[1]!.length) return null
  const id = start[1]!
  const { end, entries } = readFlowchartMetadata(text, start[0].length - 1)
  applyNodeMetadata(id, entries, graph, subgraphStack)
  return { id, remaining: text.slice(end + 1) }
}

/** Apply one metadata object whether authored as `A@{...}` or `A[Label]@{...}`. */
function applyNodeMetadata(
  id: string,
  entries: ReadonlyMap<string, unknown>,
  graph: MermaidGraph,
  subgraphStack: MermaidSubgraph[],
): void {
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
    : icon || image ? { shape: iconForm === 'circle' ? 'circle' as const : iconForm === 'rounded' ? 'rounded' as const : 'rectangle' as const, semanticShape: icon ? 'icon' : 'image' }
    : {}
  const mediaFields = { ...(icon ? { icon } : {}), ...(image ? { image } : {}), ...(iconForm ? { iconForm } : {}) }
  const existing = graph.nodes.get(id)
  if (existing) {
    graph.nodes.set(id, {
      ...existing,
      ...(parsedLabel !== undefined ? { label: parsedLabel.text, ...(parsedLabel.markdown ? { markdownLabel: true as const } : {}) } : {}),
      ...shapeFields,
      ...mediaFields,
    })
    trackInSubgraph(subgraphStack, id)
  } else {
    registerNode(graph, subgraphStack, {
      id,
      label: parsedLabel?.text ?? id,
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
  subgraphStack: MermaidSubgraph[],
): string | null {
  const start = text.match(new RegExp(`^${METADATA_OPEN_SOURCE}`))
  if (!start) return null
  const { end, entries } = readFlowchartMetadata(text, start[0].length - 1)
  applyNodeMetadata(id, entries, graph, subgraphStack)
  return text.slice(end + 1)
}


const QUOTED_SHAPE_DELIMITERS: Array<{ open: string; close: string; shape: NodeShape }> = [
  { open: '(((', close: ')))', shape: 'doublecircle' },
  { open: '([', close: '])', shape: 'stadium' },
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
function consumeQuotedShapeNode(
  text: string,
  graph: MermaidGraph,
  subgraphStack: MermaidSubgraph[],
): ConsumedNode | null {
  const identifier = consumeMermaidIdentifier(text)
  if (!identifier || flowchartIdLength(text, identifier.length) < identifier.length) return null
  const suffix = text.slice(identifier.length)
  for (const spec of QUOTED_SHAPE_DELIMITERS) {
    if (!suffix.startsWith(`${spec.open}"`)) continue
    const quoteStart = spec.open.length
    const quoteEnd = suffix.indexOf('"', quoteStart + 1)
    if (quoteEnd < 0 || !suffix.startsWith(spec.close, quoteEnd + 1)) continue
    const parsed = parseFlowchartLabel(suffix.slice(quoteStart + 1, quoteEnd), true)
    defineNode(graph, subgraphStack, {
      id: identifier.id,
      label: parsed.text,
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
): ConsumedNode | null {
  const metadataNode = consumeMetadataNode(text, graph, subgraphStack)
  if (metadataNode) {
    let remaining = metadataNode.remaining
    const classMatch = consumeClassShorthand(remaining)
    if (classMatch) {
      graph.classAssignments.set(metadataNode.id, classMatch.className)
      remaining = remaining.slice(classMatch.length)
    }
    return { id: metadataNode.id, remaining }
  }

  const quotedShapeNode = consumeQuotedShapeNode(text, graph, subgraphStack)
  if (quotedShapeNode) {
    let remaining = consumeNodeMetadataSuffix(quotedShapeNode.id, quotedShapeNode.remaining, graph, subgraphStack)
      ?? quotedShapeNode.remaining
    const classMatch = consumeClassShorthand(remaining)
    if (classMatch) {
      graph.classAssignments.set(quotedShapeNode.id, classMatch.className)
      remaining = remaining.slice(classMatch.length)
    }
    return { id: quotedShapeNode.id, remaining }
  }

  let id: string | null = null
  let remaining: string = text

  // Try each node pattern (shape-qualified)
  for (const { regex, shape } of NODE_PATTERNS) {
    const match = text.match(regex)
    if (match) {
      if (flowchartIdLength(text, match[1]!.length) < match[1]!.length) continue
      id = match[1]!
      const { text: label, markdown } = parseFlowchartLabel(match[2]!)
      defineNode(graph, subgraphStack, { id, label, shape, ...(markdown ? { markdownLabel: true as const } : {}) })
      remaining = text.slice(match[0].length)
      break
    }
  }

  // Bare node reference — only register if node doesn't exist yet.
  // If it already exists, do NOT track it in the current subgraph: a bare
  // reference never claims a node (first-defined-wins, docs/fork-differences.md).
  // Among the subgraphs that do list a node, the first to close keeps it.
  if (id === null) {
    const bare = consumeBareNodeId(text)
    if (bare) {
      id = bare.id
      if (mentionNode(graph, id, declaredSubgraphIds)) trackInSubgraph(subgraphStack, id)
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
    graph.classAssignments.set(id, classMatch.className)
    remaining = remaining.slice(classMatch.length)
  }

  return { id, remaining }
}

/** Register a node from a shaped definition (`b[Label]`, `b(("Label"))`). A
 * node already referenced takes the definition's label and shape, as Mermaid
 * does: `a --> b` then `b[Label B]` draws "Label B", not "b". */
function defineNode(
  graph: MermaidGraph,
  subgraphStack: MermaidSubgraph[],
  node: MermaidNode,
): void {
  const existing = graph.nodes.get(node.id)
  if (!existing) {
    registerNode(graph, subgraphStack, node)
    return
  }
  const { markdownLabel: _markdown, semanticShape: _semantic, authoredShape: _authored, ...kept } = existing
  graph.nodes.set(node.id, { ...kept, label: node.label, shape: node.shape, ...(node.markdownLabel ? { markdownLabel: true as const } : {}) })
  trackInSubgraph(subgraphStack, node.id)
}

/** Mermaid's first mention creates a node: a rectangle labelled by its id
 * (upstream's `addVertex`). A declared subgraph id names the subgraph, not a
 * node. Returns whether the node was created. */
function mentionNode(graph: MermaidGraph, id: string, declaredSubgraphIds: ReadonlySet<string>): boolean {
  if (graph.nodes.has(id) || declaredSubgraphIds.has(id)) return false
  graph.nodes.set(id, { id, label: id, shape: 'rectangle' })
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
    graph.nodes.set(node.id, node)
  }
  trackInSubgraph(subgraphStack, node.id)
}

/** Add node ID to the innermost subgraph if we're inside one */
function trackInSubgraph(subgraphStack: MermaidSubgraph[], nodeId: string): void {
  if (subgraphStack.length > 0) {
    const current = subgraphStack[subgraphStack.length - 1]!
    if (!current.nodeIds.includes(nodeId)) {
      current.nodeIds.push(nodeId)
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
    extra = op.endsWith('>') ? eq - 2 : eq - 3 // ==> base 2, === base 3
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
    extraClose = Math.max(0, count(closeOp, '=') - (closeOp.endsWith('>') ? 2 : 3))
  } else {
    extraOpen = Math.max(0, count(openOp, '-') - 2)
    extraClose = Math.max(0, count(closeOp, '-') - (closeOp.endsWith('>') ? 2 : 3))
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
