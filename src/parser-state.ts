import { assertGraphNodeInsertion, retainGraphContainerCount } from './graph-parser-work.ts'
import { parseClassLikeStyleProps } from './shared/class-like-style.ts'
import { scanStateComments } from './state/comment.ts'
import { readStateLabel, readStateText } from './state/text.ts'
import { resolveStateIdentities, type StateIdentities } from './state/identity.ts'
import type { LabelContent } from './shared/display-text.ts'

import { assertDiagramWorkLimit } from './shared/diagram-limits.ts'
import { appendGraphClass } from './shared/graph-classes.ts'
import { observeParserMutation, observeParserStatement, parserObservationActive } from './shared/parser-observation.ts'
import { mergeStyleProps, parseStyleProps } from './shared/style-props.ts'

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
import type { Direction, MermaidGraph, MermaidNode, MermaidSubgraph, NodeShape } from './types.ts'

import { parseClassShorthandStatement } from './shared/mermaid-identifiers.ts'

import { syntaxError } from './shared/syntax-error.ts'

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
        retainGraphContainerCount(graph, stateGroupCount)
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
      retainGraphContainerCount(graph, stateGroupCount)
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
      retainGraphContainerCount(graph, stateGroupCount)
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

export const STATE_GRAPH_GRAMMAR = {
  lines: (rawLines: string[]) => scanStateComments(rawLines).filter((line, index, scanned) => line.noteBody
    || (line.text.length > 0 && (!line.text.startsWith('//') || scanned[index - 1]?.openQuote === true))).map(line => line.text),
  parse: parseStateDiagram,
}
