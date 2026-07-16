import type { MermaidGraph, MermaidNode, MermaidEdge, MermaidSubgraph, Direction, NodeShape, EdgeStyle, EdgeMarker } from './types.ts'
import { normalizeBrTags } from './multiline-utils.ts'
import { normalizeV11Shape } from './flowchart-shapes.ts'
import {
  matchNoteLine, matchNoteOpen, isNoteEnd, matchStereotypeDecl,
  isConcurrencySeparator, isStateNodeId, matchHistoryEndpoint, matchTransitionLine, historyLabel,
} from './state/parse-core.ts'
import { parseStyleProps } from './shared/style-props.ts'
export { parseStyleProps } from './shared/style-props.ts'
import {
  MERMAID_IDENTIFIER_SOURCE,
  consumeClassShorthandPrefix,
  consumeMermaidIdentifier,
  parseClassShorthandStatement,
} from './shared/mermaid-identifiers.ts'
import { classifyMermaidFamilyFromFirstLine } from './family-detection.ts'

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
  const lines = expandInlineHeaderStatements(coalesceMetadataLines(coalesceMarkdownStringLines(text.split('\n'))).map(l => l.trim()).filter(l => l.length > 0 && !l.startsWith('%%')))

  if (lines.length === 0) {
    throw new Error('Empty mermaid diagram')
  }

  // Detect diagram type from header
  const header = lines[0]!

  const detection = classifyMermaidFamilyFromFirstLine(header, 'strict')
  if (detection.kind !== 'registered') {
    throw new Error(detection.kind === 'upstream'
      ? `Unsupported Mermaid family "${detection.match.family.id}" (header: ${header})`
      : `Unknown Mermaid diagram header: ${header}`)
  }

  if (detection.familyId === 'state') {
    return parseStateDiagram(lines)
  }
  if (detection.familyId === 'flowchart') return parseFlowchart(lines)

  // This compatibility API returns a MermaidGraph and therefore cannot
  // truthfully parse non-graph families. Family-neutral callers should use
  // the agent parser instead of falling through to the flowchart grammar.
  throw new Error(`Mermaid family "${detection.familyId}" is not a graph family; use the family-neutral agent parser`)
}

function expandInlineHeaderStatements(lines: string[]): string[] {
  if (lines.length === 0 || !lines[0]!.includes(';')) return lines
  if (!/^(?:graph|flowchart|swimlane|stateDiagram(?:-v2)?)(?:\b|\s)/i.test(lines[0]!)) return lines
  return [...splitFlowchartStatements(lines[0]!), ...lines.slice(1)]
}

/**
 * Mermaid v11 uses `id@{ ... }` metadata blocks for flowchart nodes. The
 * legacy parser is line-oriented; without this coalescing pass, multiline
 * metadata keys such as `shape:` and `label:` are treated as standalone node
 * statements. Keep the whole metadata object attached to its node token so the
 * node consumer can handle it as one unit.
 */
function coalesceMetadataLines(lines: string[]): string[] {
  const out: string[] = []
  let current: string[] | null = null
  let balance = 0

  for (const line of lines) {
    if (current) {
      current.push(line.trim())
      balance += metadataBraceDelta(line)
      if (balance <= 0) {
        out.push(current.join(' '))
        current = null
        balance = 0
      }
      continue
    }

    if (/@\s*\{/.test(line)) {
      balance = metadataBraceDelta(line)
      if (balance > 0) current = [line.trim()]
      else out.push(line)
      continue
    }

    out.push(line)
  }

  if (current) out.push(current.join(' '))
  return out
}

function metadataBraceDelta(text: string): number {
  let delta = 0
  let quote: '"' | "'" | null = null
  let escaped = false
  for (const ch of text) {
    if (escaped) { escaped = false; continue }
    if (ch === '\\') { escaped = true; continue }
    if (quote) {
      if (ch === quote) quote = null
      continue
    }
    if (ch === '"' || ch === "'") { quote = ch; continue }
    if (ch === '{') delta++
    else if (ch === '}') delta--
  }
  return delta
}

/**
 * Mermaid markdown strings ("`…`") may contain literal newlines as explicit
 * line breaks. The parser is line-oriented, so an open backtick string (an
 * odd number of backticks on a line) joins the following lines until the
 * string closes. The break is joined as '<br>' — the label pipeline's
 * canonical line-break token — so the single-line shape grammars keep
 * matching and markdownStringToFormattedText/normalizeBrTags restore '\n'.
 * Comment lines outside an open string pass through untouched.
 */
function coalesceMarkdownStringLines(lines: string[]): string[] {
  const out: string[] = []
  let current: string[] | null = null
  for (const line of lines) {
    if (current) {
      current.push(line.trim())
      if (countBackticks(line) % 2 === 1) {
        out.push(current.join('<br>'))
        current = null
      }
      continue
    }
    if (line.trim().startsWith('%%')) { out.push(line); continue }
    if (countBackticks(line) % 2 === 1) {
      current = [line]
      continue
    }
    out.push(line)
  }
  if (current) out.push(current.join('<br>'))
  return out
}

function countBackticks(line: string): number {
  let count = 0
  let escaped = false
  for (const ch of line) {
    if (escaped) { escaped = false; continue }
    if (ch === '\\') { escaped = true; continue }
    if (ch === '`') count++
  }
  return count
}

/**
 * Normalize Mermaid markdown-string content (repo #102): backticks are
 * consumed by the caller, explicit breaks become newlines, and the shared
 * inline-text pipeline maps bold/italic markers to styled SVG tspan runs.
 */
function markdownStringToFormattedText(inner: string): string {
  return normalizeBrTags(inner)
}

interface ParsedLabelText {
  text: string
  markdown: boolean
}

/**
 * ONE label normalization for node and edge labels: a quoted backtick string
 * ("`…`") is a Mermaid markdown string — backticks consumed, styling
 * retained as formatted runs — while everything else keeps the existing
 * normalizeBrTags pipeline (quote stripping, <br> handling, emphasis→tags).
 * `alreadyUnquoted` marks callers whose grammar consumed the double quotes
 * (consumeQuotedNode, parseMetadataLabel).
 */
function parseLabelText(raw: string, alreadyUnquoted = false): ParsedLabelText {
  const unquoted = !alreadyUnquoted && raw.length >= 2 && raw.startsWith('"') && raw.endsWith('"')
    ? raw.slice(1, -1)
    : raw
  const quoteConsumed = alreadyUnquoted || unquoted !== raw
  if (quoteConsumed && unquoted.length >= 2 && unquoted.startsWith('`') && unquoted.endsWith('`')) {
    return { text: markdownStringToFormattedText(unquoted.slice(1, -1)), markdown: true }
  }
  return { text: normalizeBrTags(raw), markdown: false }
}

function splitFlowchartStatements(line: string): string[] {
  const out: string[] = []
  let start = 0
  let depth = 0
  let quote: '"' | "'" | '`' | null = null
  let escaped = false
  let inPipeLabel = false

  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!
    if (escaped) { escaped = false; continue }
    if (ch === '\\') { escaped = true; continue }
    if (quote) {
      if (ch === quote) quote = null
      continue
    }
    if (ch === '"' || ch === "'" || ch === '`') { quote = ch; continue }
    if (ch === '|' && depth === 0) { inPipeLabel = !inPipeLabel; continue }
    if (inPipeLabel) continue
    if (ch === '[' || ch === '(' || ch === '{') depth++
    else if (ch === ']' || ch === ')' || ch === '}') depth = Math.max(0, depth - 1)
    else if (ch === ';' && depth === 0 && !semicolonInsideTextArrowLabel(line, i, start)) {
      const part = line.slice(start, i).trim()
      if (part) out.push(part)
      start = i + 1
    }
  }

  const tail = line.slice(start).trim()
  if (tail) out.push(tail)
  return out
}

function semicolonInsideTextArrowLabel(line: string, index: number, start: number): boolean {
  const before = line.slice(start, index)
  const after = line.slice(index + 1)
  const openerRe = /(?:^|\s)(?:[\w-]+@\s*)?(?:<)?(?:-{2,}|-\.+|={2,})\s+/g
  const closerRe = /(?:^|\s)(?:-{2,}>|-{3,}|\.+->|-\.+-|={2,}>|={3,})/
  let activeTextLabel = false
  for (const match of before.matchAll(openerRe)) {
    const tail = before.slice((match.index ?? 0) + match[0].length)
    if (!closerRe.test(tail)) activeTextLabel = true
  }
  return activeTextLabel && closerRe.test(after)
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

function metadataText(value: string | undefined): string | undefined {
  if (value === undefined) return undefined
  const trimmed = value.trim()
  const unquoted = trimmed.length >= 2 && ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'")))
    ? trimmed.slice(1, -1).replace(/\\(["'\\])/g, '$1')
    : trimmed
  return unquoted || undefined
}

function applyFlowchartEdgeMetadata(graph: MermaidGraph, line: string): void {
  const match = line.trim().match(/^([\w-]+)@\s*\{([\s\S]*)\}\s*$/)
  if (!match) return
  const edge = graph.edges.find(candidate => candidate.id === match[1])
  if (!edge) return
  const entries = parseMetadataEntries(match[2]!)
  const curve = metadataText(entries.get('curve'))
  if (curve && /^[a-z][a-z0-9-]*$/i.test(curve)) edge.curve = curve
  const animate = metadataText(entries.get('animate'))?.toLowerCase()
  const animation = metadataText(entries.get('animation'))?.toLowerCase()
  if (animate === 'true' || animate === 'fast' || animate === 'slow' || animation === 'fast' || animation === 'slow') {
    edge.animate = true
    const speed = animate === 'fast' || animate === 'slow' ? animate : animation
    if (speed === 'fast' || speed === 'slow') edge.animation = speed
  }
}

function isEdgeMetadataLine(graph: MermaidGraph, line: string): boolean {
  const match = line.trim().match(/^([\w-]+)@\s*\{([\s\S]*)\}\s*$/)
  if (!match) return false
  if (graph.edges.some(edge => edge.id === match[1])) return true
  // Node metadata is modeled (documented shapes) or label-preserved; edge
  // metadata has animate/curve semantics only Mermaid itself understands.
  const entries = parseMetadataEntries(match[2]!)
  return !entries.has('shape') && !entries.has('label') && !entries.has('icon') && !entries.has('img')
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

  for (let i = 1; i < lines.length; i++) {
    for (const line of splitFlowchartStatements(lines[i]!)) {
      // --- source-level directives that do not affect local layout ---
      if (isFlowchartInteractionDirective(line)) {
        applyFlowchartInteraction(graph, line)
        continue
      }
      if (isEdgeMetadataLine(graph, line)) {
        applyFlowchartEdgeMetadata(graph, line)
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
        const nodeIds = styleMatch[1]!.split(',').map(s => s.trim())
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
        // Check for "subgraph id [Label]" form
        // ID can contain hyphens (e.g. "us-east"), so use [\w-]+ not \w+
        const bracketMatch = rest.match(/^([\w-]+)\s*\[(.+)\]$/)
        let id: string
        let label: string
        if (bracketMatch) {
          id = bracketMatch[1]!
          label = parseLabelText(bracketMatch[2]!).text
        } else {
          // Use the label text as id (slugified); markdown-string labels
          // ("`**Two**`") display as plain text like every other label.
          label = parseLabelText(rest).text
          id = rest.replace(/\s+/g, '_').replace(/[^\w]/g, '')
        }
        const sg: MermaidSubgraph = { id, label, nodeIds: [], children: [] }
        subgraphStack.push(sg)
        continue
      }

      // --- subgraph end ---
      if (line === 'end') {
        const completed = subgraphStack.pop()
        if (completed) {
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
      if (!parsed.ok) {
        throw new Error(`Invalid flowchart statement "${line}": could not fully consume ${parsed.reason}; remaining input: "${parsed.remaining}"`)
      }
    }
  }

  return graph
}

function collectDeclaredFlowchartSubgraphIds(lines: string[]): Set<string> {
  const ids = new Set<string>()
  for (const raw of lines) {
    for (const line of splitFlowchartStatements(raw)) {
      const subgraphMatch = line.match(/^subgraph\s+(.+)$/)
      if (!subgraphMatch) continue
      const rest = subgraphMatch[1]!.trim()
      const bracketMatch = rest.match(/^([\w-]+)\s*\[(.+)\]$/)
      ids.add(bracketMatch ? bracketMatch[1]! : rest.replace(/\s+/g, '_').replace(/[^\w]/g, ''))
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
    const line = lines[i]!

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

    // --- notes: `note left|right of X : text` / `note left|right of X` ---
    const noteLine = matchNoteLine(line)
    if (noteLine) {
      addNote(noteLine.target, noteLine.side, normalizeBrTags(noteLine.text))
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
    const stateClassAssignment = line.match(/^(?:class|cssClass)\s+([\w\p{L},-]+)\s+([\w-]+)$/u)
    if (stateClassAssignment) {
      const ids = stateClassAssignment[1]!.split(',').map(id => id.trim()).filter(Boolean)
      for (const id of ids) {
        ensureStateNode(graph, compositeStack, id)
        graph.classAssignments.set(id, stateClassAssignment[2]!)
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
 */
const ARROW_REGEX = /^(<)?(~{3,}|-\.+->|-\.+-|={2,}>|={3,}|o-{2,}o|o-{2,}x|x-{2,}o|x-{2,}x|-{2,}[ox]|-{2,}>|-{3,})/

function closingWholePipeLabelQuote(text: string): number {
  const open = text.slice(1).search(/\S/) + 1
  if (open < 1 || text[open] !== '"') return -1
  let escaped = false
  for (let index = open + 1; index < text.length; index++) {
    const char = text[index]!
    if (escaped) { escaped = false; continue }
    if (char === '\\') { escaped = true; continue }
    if (char === '"' && /^\s*\|/.test(text.slice(index + 1))) return index
  }
  return -1
}

function consumePipeLabel(text: string): { rawLabel: string; consumed: number } | null {
  if (!text.startsWith('|')) return null
  const quotedClose = closingWholePipeLabelQuote(text)
  for (let index = 1; index < text.length; index++) {
    if (quotedClose >= 0 && index < quotedClose && text[index] === '|') continue
    if (text[index] === '|') return { rawLabel: text.slice(1, index), consumed: index + 1 }
  }
  return null
}

/** Quote-aware consumer for `-- label -->`, `-. label .->`, and `== label ==>`.
 * Closer-shaped text inside a Mermaid double-quoted label is paint, not syntax. */
const TEXT_ARROW_OPEN_REGEX = /^(<)?(-{2,}|-\.+|={2,})/
const TEXT_ARROW_CLOSE_REGEX = /^(-{2,}[>ox]|-{3,}|\.+->|-\.+-|={2,}>|={3,})/

interface ConsumedTextArrow {
  hasArrowStart: boolean
  openOp: string
  rawLabel: string
  closeOp: string
  consumed: number
}

function closingWholeTextArrowLabelQuote(text: string, start: number): number {
  const relativeOpen = text.slice(start).search(/\S/)
  const open = relativeOpen < 0 ? -1 : start + relativeOpen
  if (open < start || text[open] !== '"') return -1
  let escaped = false
  for (let index = open + 1; index < text.length; index++) {
    const char = text[index]!
    if (escaped) { escaped = false; continue }
    if (char === '\\') { escaped = true; continue }
    if (char === '"' && /^\s*(?:-{2,}[>ox]|-{3,}|\.+->|-\.+-|={2,}>|={3,})/.test(text.slice(index + 1))) return index
  }
  return -1
}

function consumeTextArrow(text: string): ConsumedTextArrow | null {
  const opener = text.match(TEXT_ARROW_OPEN_REGEX)
  if (!opener) return null
  const quotedClose = closingWholeTextArrowLabelQuote(text, opener[0].length)
  for (let index = opener[0].length; index < text.length; index++) {
    if (quotedClose >= 0 && index < quotedClose) continue
    const closer = text.slice(index).match(TEXT_ARROW_CLOSE_REGEX)
    if (!closer) continue
    const rawLabel = text.slice(opener[0].length, index).trim()
    if (rawLabel.length === 0) continue
    return {
      hasArrowStart: Boolean(opener[1]),
      openOp: opener[2]!,
      rawLabel,
      closeOp: closer[1]!,
      consumed: index + closer[0].length,
    }
  }
  return null
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

function consumeBareNodeId(text: string): { id: string; length: number } | null {
  const whole = consumeMermaidIdentifier(text)
  if (!whole) return null
  const max = whole.length
  let end = 0
  for (let i = 0; i < max; i++) {
    if (i > 0 && startsFlowchartArrow(text.slice(i))) break
    end = i + 1
  }
  return end > 0 ? { id: text.slice(0, end), length: end } : null
}

function startsFlowchartArrow(text: string): boolean {
  return ARROW_REGEX.test(text) || consumeTextArrow(text) !== null
}

function nodePatternSwallowedArrow(text: string, idLength: number): boolean {
  for (let i = 1; i < idLength; i++) {
    if (startsFlowchartArrow(text.slice(i))) return true
  }
  return false
}

const EDGE_ID_PREFIX_REGEX = /^([\w-]+)@\s*(?=(?:<)?(?:~{3,}|-\.+->|-\.+-|={2,}>|={3,}|o-{2,}[ox]|x-{2,}[ox]|-{2,}[ox]|-{2,}>|-{3,}|(?:-{2,}|-\.+|={2,})\s+))/

function consumeClassShorthand(text: string): { className: string; length: number } | null {
  const parsed = consumeClassShorthandPrefix(text)
  if (!parsed) return null
  const rest = text.slice(3)
  const max = parsed.className.length
  let end = max
  for (let i = 1; i < max; i++) {
    if (startsFlowchartArrow(rest.slice(i))) { end = i; break }
  }
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

    const arrowMatch = remaining.match(ARROW_REGEX)
    if (arrowMatch) {
      const arrowOp = arrowMatch[2]!
      let consumed = arrowMatch[0].length
      const labelSuffix = remaining.slice(consumed)
      if (labelSuffix.startsWith('|')) {
        const pipeLabel = consumePipeLabel(labelSuffix)
        if (!pipeLabel) return { ok: false, remaining: labelSuffix, reason: 'expected edge target' }
        const rawEdgeLabel = pipeLabel.rawLabel.trim()
        edgeLabel = rawEdgeLabel ? parseLabelText(rawEdgeLabel).text : undefined
        consumed += pipeLabel.consumed
      }
      remaining = remaining.slice(consumed).trim()
      style = arrowStyleFromOp(arrowOp)
      length = arrowLengthFromOp(arrowOp)
      startMarker = startMarkerForOp(arrowOp, Boolean(arrowMatch[1]))
      endMarker = endMarkerForOp(arrowOp)
      hasArrowStart = startMarker !== undefined
      hasArrowEnd = endMarker !== undefined
    } else {
      // Fallback: text-embedded label syntax (-- Yes -->, -. Maybe .->, == Sure ==>)
      const textArrow = consumeTextArrow(remaining)
      if (!textArrow) return { ok: false, remaining, reason: 'expected edge operator' }
      hasArrowStart = textArrow.hasArrowStart
      edgeLabel = parseLabelText(textArrow.rawLabel).text
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
  const start = text.match(new RegExp(`^(${MERMAID_IDENTIFIER_SOURCE})@\\s*\\{`, 'u'))
  if (!start) return null
  const id = start[1]!
  const objectStart = text.indexOf('{', start[0].indexOf('@'))
  const objectEnd = findMetadataObjectEnd(text, objectStart)
  if (objectEnd < 0) return null

  applyNodeMetadata(id, text.slice(objectStart + 1, objectEnd), graph, subgraphStack)
  return { id, remaining: text.slice(objectEnd + 1) }
}

/** Apply one metadata object whether authored as `A@{...}` or `A[Label]@{...}`. */
function applyNodeMetadata(
  id: string,
  metadata: string,
  graph: MermaidGraph,
  subgraphStack: MermaidSubgraph[],
): void {
  const entries = parseMetadataEntries(metadata)
  const label = entries.get('label')
  const parsedLabel = label !== undefined ? parseLabelText(label, true) : undefined
  // v11 typed shapes (repo #44): documented `@{ shape: ... }` names normalize
  // through the ONE table in src/flowchart-shapes.ts to a semantic shape id +
  // rendering geometry; the authored spelling is preserved for round-trip.
  // Undocumented names keep the #29 safety floor (labeled rectangle).
  const shapeName = entries.get('shape')
  const v11 = shapeName !== undefined ? normalizeV11Shape(shapeName) : null
  const icon = metadataText(entries.get('icon'))
  const image = metadataText(entries.get('img'))
  const form = metadataText(entries.get('form'))
  const iconForm: MermaidNode['iconForm'] = form === 'circle' || form === 'rounded' || form === 'square' ? form : undefined
  const shapeFields = v11 ? { shape: v11.geometry, semanticShape: v11.canonical, authoredShape: shapeName!.trim() }
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
  const start = text.match(/^@\s*\{/)
  if (!start) return null
  const objectStart = text.indexOf('{')
  const objectEnd = findMetadataObjectEnd(text, objectStart)
  if (objectEnd < 0) return null
  applyNodeMetadata(id, text.slice(objectStart + 1, objectEnd), graph, subgraphStack)
  return text.slice(objectEnd + 1)
}

function findMetadataObjectEnd(text: string, start: number): number {
  if (start < 0 || text[start] !== '{') return -1
  let depth = 0
  let quote: '"' | "'" | null = null
  let escaped = false
  for (let i = start; i < text.length; i++) {
    const ch = text[i]!
    if (escaped) { escaped = false; continue }
    if (ch === '\\') { escaped = true; continue }
    if (quote) {
      if (ch === quote) quote = null
      continue
    }
    if (ch === '"' || ch === "'") { quote = ch; continue }
    if (ch === '{') depth++
    else if (ch === '}') {
      depth--
      if (depth === 0) return i
    }
  }
  return -1
}

/**
 * THE `@{ ... }` metadata-entry grammar (one table, two consumers: this
 * parser's node consumption and the agent-side modeled/opaque gate in
 * flowchart-unsupported.ts). Entries separate on top-level commas OR
 * whitespace (upstream's multiline YAML-ish form joins to spaces); quoted
 * values never split. Keys lowercase; values unquoted/unescaped.
 */
export function parseMetadataEntries(metadata: string): Map<string, string> {
  // Mask quoted spans so key detection never fires inside a value.
  let masked = ''
  let quote: '"' | "'" | null = null
  let escaped = false
  for (const ch of metadata) {
    if (escaped) { escaped = false; masked += ' '; continue }
    if (ch === '\\') { masked += ' '; escaped = true; continue }
    if (quote) {
      if (ch === quote) quote = null
      masked += ' '
      continue
    }
    if (ch === '"' || ch === "'") { quote = ch; masked += ' '; continue }
    masked += ch
  }

  const keyRe = /(^|[,\s])([\w-]+)\s*:/g
  const found: Array<{ key: string; keyStart: number; valueStart: number }> = []
  let match: RegExpExecArray | null
  while ((match = keyRe.exec(masked)) !== null) {
    found.push({ key: match[2]!.toLowerCase(), keyStart: match.index + match[1]!.length, valueStart: match.index + match[0].length })
  }

  const entries = new Map<string, string>()
  for (let i = 0; i < found.length; i++) {
    const end = i + 1 < found.length ? found[i + 1]!.keyStart : metadata.length
    const raw = metadata.slice(found[i]!.valueStart, end).trim().replace(/,\s*$/, '').trim()
    entries.set(found[i]!.key, unquoteMetadataValue(raw))
  }
  return entries
}

function unquoteMetadataValue(raw: string): string {
  if (raw.length >= 2 && ((raw.startsWith('"') && raw.endsWith('"')) || (raw.startsWith("'") && raw.endsWith("'")))) {
    return raw.slice(1, -1).replace(/\\([\\"'])/g, '$1')
  }
  return raw
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
  if (!identifier) return null
  const suffix = text.slice(identifier.length)
  for (const spec of QUOTED_SHAPE_DELIMITERS) {
    if (!suffix.startsWith(`${spec.open}"`)) continue
    const quoteStart = spec.open.length
    let quoteEnd = -1
    let escaped = false
    for (let i = quoteStart + 1; i < suffix.length; i++) {
      const ch = suffix[i]!
      if (escaped) { escaped = false; continue }
      if (ch === '\\') { escaped = true; continue }
      if (ch === '"') { quoteEnd = i; break }
    }
    if (quoteEnd < 0 || !suffix.startsWith(spec.close, quoteEnd + 1)) continue
    const raw = suffix.slice(quoteStart + 1, quoteEnd).replace(/\\(["\\])/g, '$1')
    const parsed = parseLabelText(raw, true)
    registerNode(graph, subgraphStack, {
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
      if (nodePatternSwallowedArrow(text, match[1]!.length)) continue
      id = match[1]!
      const { text: label, markdown } = parseLabelText(match[2]!)
      registerNode(graph, subgraphStack, { id, label, shape, ...(markdown ? { markdownLabel: true as const } : {}) })
      remaining = text.slice(match[0].length)
      break
    }
  }

  // Bare node reference — only register if node doesn't exist yet.
  // If it already exists, do NOT track it in the current subgraph;
  // nodes belong to the subgraph where they're first defined.
  if (id === null) {
    const bare = consumeBareNodeId(text)
    if (bare) {
      id = bare.id
      if (!graph.nodes.has(id) && !declaredSubgraphIds.has(id)) {
        registerNode(graph, subgraphStack, { id, label: id, shape: 'rectangle' })
      }
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
// mutation-scope:text-embedded-link-length:start
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
// mutation-scope:text-embedded-link-length:end

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
