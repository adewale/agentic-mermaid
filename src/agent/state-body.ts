// ============================================================================
// State diagram structured body (BUILD-19: promotes the state family from a
// "parses AS flowchart" projection to a dedicated state IR with state-shaped
// ops and a real `asState` narrower).
//
// Modeled grammar (the state parse core, src/state/parse-core.ts, is shared
// with the renderer parser, src/parser.ts parseStateDiagram. Both projections
// also consume the shared identity/scope resolver in src/state/identity.ts:
//   stateDiagram-v2 | stateDiagram
//   state "Description" as id            — aliased simple state
//   id : Description                     — bare state description
//   from --> to [: label]                — transition (from/to may be `[*]`,
//                                          `[H]`/`[H*]`, or `Base[H]`/`Base[H*]`)
//   [*] --> id                           — start pseudostate (source)
//   id --> [*]                           — end pseudostate (target)
//   state Composite { … }                — composite block (nestable)
//   state "Label" as Composite { … }     — aliased composite block
//   state id <<fork|join|choice|history|H|deephistory|H*>> — pseudostate decl
//   note left|right of id : text         — single-line note
//   note left|right of id … end note     — block note
//   note "text" as id                    — independently identified floating note
//   --                                  — concurrent region separator
//   direction TD|TB|LR|BT|RL             — top-level or per-composite direction
//
// `[*]` is NOT a state node: it is modeled CONTEXTUALLY as the reserved
// endpoint id '[*]' on transitions, scoped per composite level — exactly as
// the legacy parser disambiguates ([*] as a transition SOURCE = start
// pseudostate, as a TARGET = end pseudostate). History endpoints (`[H]`,
// `Base[H*]`, …) are likewise contextual endpoint strings, preserved verbatim
// on transitions (verifyState announces them via the Tier-3 `state_history`
// lint; the renderer draws the (H)/(H*) circle).
//
// Structured-or-opaque: any statement (readStateStatements) that is NOT one of
// the modeled forms returns null so the caller falls back to a lossless opaque
// body. Reopened composite declarations remain source-preserved rather than
// acquiring multiple editable identities. Paint directives and bare states
// are modeled alongside the forms above.
//
// Canonical serialization emits state DEFINITIONS before transitions, keeping
// labels beside their declarations. Floating notes serialize in their owning
// scope; attached notes follow the state declarations they annotate.
// ============================================================================

import { scanStateComments } from '../state/comment.ts'
import { unknownOpMessage } from './mutation-ops.ts'
import type {
  StateBody, StateNode, StateNote, StateFloatingNote, StateRegion, StateTransition, StateMutationOp,
  MutationError, Result, LayoutWarning, VerifyOptions,
} from './types.ts'
import { ok, err } from './types.ts'
import { labelOverflowCollector } from './body-utils.ts'
import { normalizeBrTags } from '../multiline-utils.ts'
import { keepStateTextFromPrepass, readStateLabel, readStateText, writeStateDescription, writeStateText } from '../state/text.ts'
import type { LabelContent } from '../shared/display-text.ts'
import { parseAccessibilityDirective, scanAccessibilityDirectives, statementEndAt } from '../shared/accessibility-directives.ts'
import {
  matchNoteLine, matchNoteOpen, matchFloatingNote, isNoteEnd, matchStereotypeDecl,
  matchTransitionLine, readStateStatements, stateStatementEnds, lexedStateText, isConcurrencySeparator, type StateStatement, isHistoryEndpoint, matchHistoryEndpoint,
  isStateNodeId, matchStateDeclarationLine, matchStateLayoutDirective, stereotypeMarker, stripStateComment, matchStateClassAssignment,
  STATE_DIRECTION_RE, STATE_ALIAS_RE, STATE_COMPOSITE_OPEN_RE, STATE_DESCRIPTION_RE,
  STATE_CLASS_DEF_RE, STATE_STYLE_RE, STATE_LINK_STYLE_RE,
} from '../state/parse-core.ts'
import { parseClassShorthandStatement } from '../shared/mermaid-identifiers.ts'
import { graphClassNames } from '../shared/graph-classes.ts'
import { resolveStateIdentities, type StateIdentities } from '../state/identity.ts'
import { DiagramWorkLimitError } from '../shared/diagram-limits.ts'
import type { StateScope } from '../state/types.ts'

/** `record[key] = value` as an own key: a class may be named `__proto__`,
 *  which an assignment would take as the record's prototype. */
function setOwn<T>(record: Record<string, T>, key: string, value: T): void {
  Object.defineProperty(record, key, { value, enumerable: true, writable: true, configurable: true })
}

// ---- Identifiers ------------------------------------------------------------
//
// The reserved pseudostate endpoint. Mirrors mermaid's `[*]`.
export const PSEUDO = '[*]'

// Composite and simple states share one identifier grammar.
function isCompositeId(id: string): boolean {
  return isStateNodeId(id)
}
function isEndpointId(id: string): boolean {
  return id === PSEUDO || isHistoryEndpoint(id) || isStateNodeId(id)
}

// ---- Parser -----------------------------------------------------------------
/** A mutable scope used during parsing — one per composite nesting level. */
interface ParseScope {
  states: StateNode[]
  transitions: StateTransition[]
  byId: Map<string, StateNode>
  direction?: StateNode['direction']
}

function newScope(byId: Map<string, StateNode>): ParseScope {
  return { states: [], transitions: [], byId }
}

/** Ensure a non-pseudo state node exists in the scope; create a bare one if
 *  absent (label defaults to the id, matching legacy `ensureStateNode`). */
function ensureState(scope: ParseScope, id: string): StateNode {
  let node = scope.byId.get(id)
  if (!node) {
    node = { id }
    scope.states.push(node)
    scope.byId.set(id, node)
  }
  return node
}

/**
 * Parse state body lines (header excluded). Returns a structured body only if
 * EVERY statement on them is a modeled directive (transition /
 * description / alias / composite / direction). Otherwise returns null
 * (opaque fallback). A header-only body is the empty typed diagram, as it is
 * in Mermaid; verify reports it as EMPTY_DIAGRAM.
 */
export function parseStateBody(lines: string[]): StateBody | null {
  const { statements } = readStateStatements(scanStateComments(lines))
  let identities: StateIdentities
  try { identities = resolveStateIdentities(statements) } catch (error) {
    // A source beyond the host budget stays source-preserved. The renderer
    // reports its work-limit refusal through verify's normal diagnostics.
    if (error instanceof DiagramWorkLimitError) return null
    throw error
  }
  if (identities.issue) return null
  const stateById = new Map<string, StateNode>()
  const root = newScope(stateById)
  const stack: ParseScope[] = [root]
  // Discover composite declarations before materializing transition endpoints.
  // Mermaid state IDs are global even when the declaration is nested, so a
  // forward reference must never create a competing simple placeholder.
  const compositeIds = new Set<string>()
  for (const statement of statements) {
    if (statement.noteBody) continue
    const match = statement.text.match(STATE_COMPOSITE_OPEN_RE)
    if (!match) continue
    const id = match[2]!
    if (compositeIds.has(id)) return null
    compositeIds.add(id)
  }
  const pendingCompositeLabels = new Map<string, readonly string[]>()
  // The composites opened so far. Ids are global, so a later mention in any
  // scope names the composite; one before its block waits in
  // pendingCompositeLabels.
  const composites = new Map<string, StateNode>()
  // Pending composites awaiting their `}` — parent scope + the node to attach.
  const pending: Array<{ parent: ParseScope; node: StateNode; regions?: ParseScope[] }> = []
  // Paint directives can target forward declarations, so apply them after the
  // complete state tree is known.
  const classDefs: Record<string, Record<string, string>> = {}
  const classDefDeclarations: Record<string, StyleDeclaration[]> = {}
  const classAssignments: Array<{ id: string; className: string; scope: ParseScope }> = []
  const inlineStyles: Array<{ id: string; props: Record<string, string>; declarations: StyleDeclaration[]; scope: ParseScope }> = []
  const pendingLinkStyles: Array<{ target: 'default' | number[]; props: Record<string, string> }> = []
  const transitionOrder: StateTransition[] = []
  // Notes, in source order (global list — state ids are global in mermaid).
  const notes: StateNote[] = []
  const floatingNotes: StateFloatingNote[] = []
  const floatingIds = new Set<string>()
  // Open block note (`note left of X` … `end note`), collecting body lines.
  let openNote: { target: string; side: 'left' | 'right'; lines: string[] } | null = null

  // Each state's label as written, one piece per line (a label and the
  // descriptions under it), read through the State text codec.
  const labelPieces = new Map<StateNode, readonly string[]>()
  const labelState = (node: StateNode, pieces: readonly string[]): void => {
    labelPieces.set(node, pieces)
    const { text, content } = readStateLabel(pieces)
    node.label = text
    if (content) node.labelContent = content
    else delete node.labelContent
  }
  const declarations = new Map<StateNode, Map<ParseScope, number>>()
  const declare = (scope: ParseScope, node: StateNode): void => {
    let entries = declarations.get(node)
    if (!entries) { entries = new Map(); declarations.set(node, entries) }
    if (!entries.has(scope)) entries.set(scope, scope.transitions.length)
  }
  const pushNote = (scope: ParseScope, target: string, side: 'left' | 'right', authored: string): void => {
    const { text, content } = readStateText(authored)
    notes.push({ target, side, text, ...(content ? { textContent: content } : {}) })
    // A note on an undeclared state declares it (mirrors the render parser).
    if (!compositeIds.has(target) && !scope.byId.has(target)) {
      const node = ensureState(scope, target)
      node.declaredBare = true
      declare(scope, node)
    }
  }

  for (const statement of statements) {
    const line = statement.text

    const scope = stack[stack.length - 1]!

    // --- open block note: collect body lines until `end note` ---
    if (openNote) {
      if (isNoteEnd(line)) {
        pushNote(scope, openNote.target, openNote.side, openNote.lines.join('\n'))
        openNote = null
      } else {
        openNote.lines.push(line)
      }
      continue
    }

    if (!line) continue

    const floating = matchFloatingNote(line)
    if (floating) {
      if (floatingIds.has(floating.id)) return null
      floatingIds.add(floating.id)
      const { text, content } = readStateText(floating.text)
      if (!validFloatingNoteText(text).ok) return null
      const scope = identities.scopeOf(statement)
      floatingNotes.push({ id: floating.id, text, ...(content ? { textContent: content } : {}), ...(scope ? { scope } : {}) })
      continue
    }

    // --- notes (before the ::: gate: note TEXT may legally contain :::) ---
    const noteLine = matchNoteLine(line)
    if (noteLine) {
      pushNote(scope, noteLine.target, noteLine.side, noteLine.text)
      continue
    }
    const noteOpen = matchNoteOpen(line)
    if (noteOpen) {
      openNote = { target: noteOpen.target, side: noteOpen.side, lines: [] }
      continue
    }

    // --- paint directives (shared renderer grammar) ---
    const classDef = line.match(STATE_CLASS_DEF_RE)
    if (classDef) {
      const entries = compactStyleDeclarations(parseClassLikeStyleDeclarations(classDef[2]!))
      const props = portableClassLikeStyleProps(projectStyleDeclarations(entries), entries)
      if (!props || Object.keys(props).length === 0) return null
      for (const name of classDef[1]!.split(',').map(value => value.trim()).filter(Boolean)) {
        const combined = compactStyleDeclarations([...(ownStyleDeclarations(classDefDeclarations, name) ?? Object.entries(classDefs[name] ?? {})), ...entries])
        setOwn(classDefs, name, projectStyleDeclarations(combined))
        const declarations = retainedStyleDeclarations(combined)
        if (declarations) setOwn(classDefDeclarations, name, declarations)
      }
      continue
    }
    const classLine = matchStateClassAssignment(line)
    if (classLine) {
      for (const id of classLine.ids) {
        classAssignments.push({ id, className: classLine.className, scope })
      }
      continue
    }
    const styleLine = line.match(STATE_STYLE_RE)
    if (styleLine) {
      const declarations = compactStyleDeclarations(parseClassLikeStyleDeclarations(styleLine[2]!))
      const props = portableClassLikeStyleProps(projectStyleDeclarations(declarations), declarations)
      if (!props || Object.keys(props).length === 0) return null
      for (const id of styleLine[1]!.split(',').map(value => value.trim()).filter(Boolean)) {
        if (!portableStyleTarget(id)) return null
        inlineStyles.push({ id, props: { ...props }, declarations, scope })
      }
      continue
    }
    const linkStyle = line.match(STATE_LINK_STYLE_RE)
    if (linkStyle) {
      const props = parseStyleProps(linkStyle[2]!)
      if (Object.keys(props).length === 0) return null
      const target = linkStyle[1]!.trim() === 'default'
        ? 'default' as const
        : linkStyle[1]!.split(',').map(value => Number.parseInt(value.trim(), 10)).filter(Number.isInteger)
      pendingLinkStyles.push({ target, props })
      continue
    }

    // --- concurrency region separator ---
    if (isConcurrencySeparator(line)) {
      if (pending.length === 0) return null
      const owner = pending[pending.length - 1]!
      if (!owner.regions) {
        if (scope.direction !== undefined) {
          owner.node.direction = scope.direction
          delete scope.direction
        }
        const nextRegion = newScope(stateById)
        owner.regions = [scope, nextRegion]
        stack[stack.length - 1] = nextRegion
      } else {
        const nextRegion = newScope(stateById)
        owner.regions.push(nextRegion)
        stack[stack.length - 1] = nextRegion
      }
      continue
    }

    // --- direction ---
    const dir = line.match(STATE_DIRECTION_RE)
    if (dir) {
      scope.direction = dir[1]!.toUpperCase() as StateNode['direction']
      continue
    }

    // --- pseudostate stereotype: `state f1 <<fork>>` (also history forms) ---
    const stereo = matchStereotypeDecl(line)
    if (stereo) {
      if (!isCompositeId(stereo.id) || (compositeIds.has(stereo.id) && !scope.byId.has(stereo.id))) return null
      const node = ensureState(scope, stereo.id)
      declare(scope, node)
      node.stereotype = stereo.stereotype
      if (stereo.label !== undefined && node.label === undefined) labelState(node, [stereo.label])
      continue
    }

    // --- composite open: `state X {` / `state "Label" as X {` ---
    const open = line.match(STATE_COMPOSITE_OPEN_RE)
    if (open) {
      const id = open[2]!
      if (!isCompositeId(id)) return null
      const pieces = open[1] !== undefined ? [open[1]] : pendingCompositeLabels.get(id)
      const child = newScope(stateById)
      const prior = stateById.get(id)
      const node: StateNode = prior ?? { id }
      declare(scope, node)
      node.states = child.states
      node.transitions = child.transitions
      if (pieces !== undefined) labelState(node, pieces)
      // A prior reference and its later block share one editable object.
      if (!prior) scope.states.push(node)
      scope.byId.set(id, node)
      composites.set(id, node)
      pending.push({ parent: scope, node })
      stack.push(child)
      continue
    }

    // --- composite close ---
    if (line === '}') {
      // A `}` with no composite open closes nothing: dropped, as the
      // renderer drops it (verify reports it, state_brace_unopened).
      if (stack.length <= 1) continue
      const child = stack.pop()!
      const top = pending.pop()!
      if (top.regions) {
        top.node.regions = top.regions.map(region => ({
          states: region.states,
          transitions: region.transitions,
          ...(region.direction !== undefined ? { direction: region.direction } : {}),
        }))
        delete top.node.states
        delete top.node.transitions
      } else {
        // Sync the captured arrays + direction onto the node.
        top.node.states = child.states
        top.node.transitions = child.transitions
        if (child.direction !== undefined) top.node.direction = child.direction
      }
      continue
    }

    // --- alias: `state "Description" as id` ---
    const alias = line.match(STATE_ALIAS_RE)
    if (alias) {
      const id = alias[2]!
      const pieces = [alias[1]!]
      const composite = composites.get(id)
      if (composite) {
        if (composite.label === undefined) labelState(composite, pieces)
      } else if (compositeIds.has(id)) {
        if (!pendingCompositeLabels.has(id)) pendingCompositeLabels.set(id, pieces)
      } else {
        const node = ensureState(scope, id)
        declare(scope, node)
        // Definition-before-use: only set if not already labeled.
        if (node.label === undefined) labelState(node, pieces)
      }
      continue
    }

    // --- transition: `from --> to [: label]` (endpoints may be [*]/[H]/X[H]) ---
    const tr = matchTransitionLine(line)
    if (tr) {
      const { from, to } = tr
      const label = tr.label ? readStateText(tr.label) : undefined
      if (!isEndpointId(from) || !isEndpointId(to)) return null
      // A `[*]` or history endpoint is no state, so its class stays on the
      // transition: `[*]:::c --> A` is its only Mermaid spelling. Mermaid's
      // name after `:::` ends at a hyphen, so a hyphenated class there has
      // no spelling, and the body stays opaque.
      const contextual = (id: string): boolean => id === PSEUDO || isHistoryEndpoint(id)
      if ((contextual(from) && tr.fromClass?.includes('-')) || (contextual(to) && tr.toClass?.includes('-'))) return null
      if (tr.fromClass && !contextual(from)) classAssignments.push({ id: from, className: tr.fromClass, scope })
      if (tr.toClass && !contextual(to)) classAssignments.push({ id: to, className: tr.toClass, scope })
      // Only materialize simple-state nodes for non-pseudo, non-history,
      // non-composite ids (pseudostates are contextual endpoint strings).
      if (!contextual(from) && !compositeIds.has(from)) ensureState(scope, from)
      if (!contextual(to) && !compositeIds.has(to)) ensureState(scope, to)
      const transition: StateTransition = {
        from, to,
        ...(tr.fromClass && contextual(from) ? { fromClass: tr.fromClass } : {}),
        ...(tr.toClass && contextual(to) ? { toClass: tr.toClass } : {}),
        ...(label !== undefined ? { label: label.text, ...(label.content ? { labelContent: label.content } : {}) } : {}),
      }
      scope.transitions.push(transition)
      transitionOrder.push(transition)
      continue
    }

    // --- standalone class shorthand: `A:::hot` ---
    const shorthand = parseClassShorthandStatement(line)
    if (shorthand) {
      if (!compositeIds.has(shorthand.id)) {
        const node = ensureState(scope, shorthand.id)
        declare(scope, node)
        node.declaredBare = true
      }
      classAssignments.push({ id: shorthand.id, className: shorthand.className, scope })
      continue
    }

    // --- description: `id : Description` ---
    const desc = line.match(STATE_DESCRIPTION_RE)
    if (desc) {
      const id = desc[1]!
      const piece = desc[2]!.trim()
      if (compositeIds.has(id) && !composites.has(id)) {
        pendingCompositeLabels.set(id, [...(pendingCompositeLabels.get(id) ?? []), piece])
      } else {
        // A description adds a line under any label the state has.
        const node = composites.get(id) ?? ensureState(scope, id)
        declare(scope, node)
        labelState(node, [...(labelPieces.get(node) ?? []), piece])
      }
      continue
    }

    // --- standalone state declaration ---
    const declaredId = matchStateDeclarationLine(line)
    if (declaredId !== null) {
      // A composite's id names the composite, which a mention adds nothing to.
      if (compositeIds.has(declaredId)) continue
      const node = ensureState(scope, declaredId)
      declare(scope, node)
      node.declaredBare = true
      continue
    }

    // Unmodeled line → opaque.
    return null
  }

  // Unbalanced composite braces / unterminated block note → opaque.
  if (stack.length !== 1) return null
  if (openNote) return null

  // State identities are global even when declarations live in composites or
  // concurrency regions. Canonical serialization emits paint directives after
  // blocks, so resolve an existing nested target globally; use the captured
  // directive scope only when the paint line is the target's declaration.
  if (!applyStateBodyOwnership(root.states, stateById, identities)) return null
  const unresolvedClasses: NonNullable<StateBody['unresolvedClasses']> = []
  const unresolvedStyles: NonNullable<StateBody['unresolvedStyles']> = []
  // A state takes every class assigned to it, in order, as in Mermaid.
  // Missing targets remain paint intent, never fabricated declarations.
  for (const { id, className } of classAssignments) {
    const state = stateById.get(id)
    if (!state) { unresolvedClasses.push({ id, className }); continue }
    state.className = state.className === undefined ? className : `${state.className} ${className}`
  }
  for (const { id, props, declarations } of inlineStyles) {
    const state = stateById.get(id)
    const retained = retainedStyleDeclarations(declarations)
    if (!state) { unresolvedStyles.push({ id, style: { ...props }, ...(retained ? { styleDeclarations: retained } : {}) }); continue }
    state.style = { ...props }
    if (retained) state.styleDeclarations = retained
    else delete state.styleDeclarations
  }
  let defaultTransitionStyle: Record<string, string> | undefined
  for (const directive of pendingLinkStyles) {
    if (directive.target === 'default') defaultTransitionStyle = { ...defaultTransitionStyle, ...directive.props }
    else for (const index of directive.target) {
      const transition = transitionOrder[index]
      if (transition) transition.style = { ...transition.style, ...directive.props }
    }
  }

  // `state "X" as X` is how the writer declares a state with no bare
  // spelling; it reads back as that bare declaration.
  const unlabelBare = (states: StateNode[]): void => {
    for (const state of states) {
      if (state.regions) for (const region of state.regions) unlabelBare(region.states)
      else if (state.states) unlabelBare(state.states)
      else if (state.stereotype === undefined && state.label === state.id && !hasBareSpelling(state.id)) {
        delete state.label
        delete state.labelContent
        state.declaredBare = true
      }
    }
  }
  unlabelBare(root.states)
  const attachDeclarationBoundaries = (scope: ParseScope): void => {
    for (const node of scope.states) {
      const boundary = declarations.get(node)?.get(scope)
      if (boundary !== undefined) node.declarationBeforeTransition = boundary
    }
  }
  const declarationScopes = new Set<ParseScope>([root])
  for (const entries of declarations.values()) for (const scope of entries.keys()) declarationScopes.add(scope)
  for (const scope of declarationScopes) attachDeclarationBoundaries(scope)
  canonicalizeStateOrder(root.states, root.transitions)
  const body: StateBody = {
    kind: 'state',
    states: root.states,
    transitions: root.transitions,
    ...(notes.length > 0 ? { notes } : {}),
    ...(floatingNotes.length > 0 ? { floatingNotes } : {}),
    ...(root.direction !== undefined ? { direction: root.direction } : {}),
    ...(Object.keys(classDefs).length > 0 ? { classDefs } : {}),
    ...(Object.keys(classDefDeclarations).length > 0 ? { classDefDeclarations } : {}),
    ...(defaultTransitionStyle ? { defaultTransitionStyle } : {}),
    ...(unresolvedClasses.length > 0 ? { unresolvedClasses } : {}),
    ...(unresolvedStyles.length > 0 ? { unresolvedStyles } : {}),
  }
  if (stateWriteProblem(body)) return null
  preserveOrphanedImplicitStates(body)
  try { renderState(body) } catch (error) {
    if (error instanceof StateWriteError) return null
    throw error
  }
  return body
}

function applyStateBodyOwnership(root: StateNode[], states: ReadonlyMap<string, StateNode>, identities: StateIdentities): boolean {
  const scopes = new Map<string, StateNode[]>()
  for (const state of states.values()) {
    if (state.regions) state.regions.forEach((region, index) => scopes.set(identities.regionId(state.id, index), region.states))
    else if (state.states) scopes.set(state.id, state.states)
  }
  root.length = 0
  for (const scope of scopes.values()) scope.length = 0
  for (const state of states.values()) if (!identities.ownerOf(state.id)) root.push(state)
  for (const id of identities.ownedIds()) {
    const state = states.get(id)
    const owner = identities.ownerOf(id)
    if (!state || !owner) continue
    const scope = scopes.get(identities.scopeId(owner))
    if (!scope) return false
    scope.push(state)
  }
  return true
}

// ---- Serializer -------------------------------------------------------------

/** Whether Mermaid reads `id` alone as a state. It reads no hyphen in a name,
 *  and takes a keyword (`note`, `class`, …, in any case) before the line
 *  break as its statement; `state X`, the other spelling, declares nothing
 *  upstream. Such a state is written `state "X" as X`, which Mermaid draws,
 *  and read back as the bare declaration (parseStateBody). */
function hasBareSpelling(id: string): boolean {
  return !/-|^(?:state|note|scale|default|classDef|class|style|click|href|stateDiagram)$/i.test(id)
}

/** Whether `id` is a keyword Mermaid's lexer reads as one only before a blank
 *  or a line break, so it names a state with no blank after it (`note-->`). */
function namesStateGlued(id: string): boolean {
  return /^(?:state|note|scale|classDef|class|style|stateDiagram|accTitle|accDescr)$/i.test(id)
}

/** Whether a label is written as `X: label` beside the declaration, as one
 *  holding a `"` is where `X` reads alone; elsewhere the quoted label spells
 *  its `"` as `#quot;`. */
function describedApart(s: StateNode): boolean {
  return (s.label?.includes('"') ?? false) && hasBareSpelling(s.id)
}

/** `line` and the description or transition label after it. */
function describe(line: string, label: string, content?: LabelContent): string {
  return line + writeStateDescription(label, content, line)
}

/** A label as written in source, in `state "…" as X`: its line breaks as
 *  `<br/>`, kept from the prepass (nothing before it on its line holds a colon). */
function serializeStateLabel(label: string, content?: LabelContent, reserved = ''): string {
  const written = writeStateText(label, content, reserved).replace(/\r\n?|\n/g, '<br/>')
  // The STATE lexer recognizes pseudostates before it enters the quoted
  // string. Encode only marker delimiters, leaving display markup intact.
  return keepStateTextFromPrepass(written.replace(/<<(?:fork|join|choice)>>|\[\[(?:fork|join|choice)\]\]/gi, marker => marker.replace(/[<>\[\]]/g, char => `#${char.charCodeAt(0)};`)))
}

/** Whether a state has a line of its own; an implicit transition endpoint
 *  needs none. */
function hasDeclaration(s: StateNode): boolean {
  return isComposite(s) || s.stereotype !== undefined || s.label !== undefined || s.declaredBare === true
}

type ScopeStep = { state: StateNode } | { transition: StateTransition }

/**
 * The order a scope is written in, and the order a reader then creates its
 * states, which is the order the renderer lays them out in. Each transition
 * follows the declarations of the states listed before its new endpoints. A
 * new endpoint with a declaration is declared just before the transition,
 * unless an implicit endpoint is listed before it: then the transition
 * creates both and the declaration follows it. A pseudostate stereotype is
 * always declared first, as Mermaid fixes a state's type when it first
 * creates it. Composites are blocks, which a transition mention does not
 * create.
 */
function inferredScopeWriteOrder(states: StateNode[], transitions: StateTransition[]): { steps: ScopeStep[]; created: StateNode[] } {
  const byId = new Map(states.map(state => [state.id, state]))
  const position = new Map(states.map((state, index) => [state, index]))
  const created = new Set<StateNode>()
  const steps: ScopeStep[] = []
  let next = 0
  const declareBefore = (state: StateNode, fresh: ReadonlySet<StateNode>): void => {
    for (const end = position.get(state)!; next < end; next++) {
      const pending = states[next]!
      if (created.has(pending) || fresh.has(pending) || !hasDeclaration(pending)) continue
      steps.push({ state: pending })
      created.add(pending)
    }
  }
  for (const transition of transitions) {
    const fresh = new Set<StateNode>()
    for (const id of [transition.from, transition.to]) {
      const state = byId.get(id)
      if (state && !created.has(state) && !isComposite(state)) fresh.add(state)
    }
    const declared: StateNode[] = []
    const introduced: StateNode[] = []
    let implicitBefore = false
    for (const state of [...fresh].sort((a, b) => position.get(a)! - position.get(b)!)) {
      if (state.stereotype !== undefined || (hasDeclaration(state) && !implicitBefore)) declared.push(state)
      else {
        introduced.push(state)
        implicitBefore ||= !hasDeclaration(state)
      }
    }
    for (const state of declared) {
      declareBefore(state, fresh)
      steps.push({ state })
      created.add(state)
    }
    if (introduced.length > 0) declareBefore(introduced.at(-1)!, fresh)
    steps.push({ transition })
    for (const state of [...fresh].filter(state => introduced.includes(state))) {
      created.add(state)
      if (hasDeclaration(state)) steps.push({ state })
    }
  }
  for (const state of states) {
    if (created.has(state)) continue
    if (hasDeclaration(state)) steps.push({ state })
    created.add(state)
  }
  return { steps, created: [...created] }
}

/** Merge the authored declaration boundaries with the existing transition
 * sequence. Only legacy/synthetic records need the old deterministic inference. */
function scopeWriteOrder(states: StateNode[], transitions: StateTransition[]): { steps: ScopeStep[]; created: StateNode[] } {
  if (!states.some(state => state.declarationBeforeTransition !== undefined)) return inferredScopeWriteOrder(states, transitions)
  const fallback = new Map<StateNode, number>()
  let index = 0
  for (const step of inferredScopeWriteOrder(states, transitions).steps) {
    if ('transition' in step) index++
    else fallback.set(step.state, index)
  }
  const boundaries = new Map<number, StateNode[]>()
  const byId = new Map(states.map(state => [state.id, state]))
  const firstUse = new Map<string, number>()
  transitions.forEach((transition, index) => {
    for (const id of [transition.from, transition.to]) if (!firstUse.has(id)) firstUse.set(id, index)
  })
  for (const state of states) {
    if (!hasDeclaration(state)) continue
    let boundary = state.declarationBeforeTransition ?? fallback.get(state) ?? transitions.length
    if (state.stereotype !== undefined) {
      const use = firstUse.get(state.id)
      if (use !== undefined) boundary = Math.min(boundary, use)
    }
    const bucket = boundaries.get(boundary) ?? []
    bucket.push(state); boundaries.set(boundary, bucket)
  }
  const steps: ScopeStep[] = [], created = new Set<StateNode>()
  for (let boundary = 0; boundary <= transitions.length; boundary++) {
    for (const state of boundaries.get(boundary) ?? []) { steps.push({ state }); created.add(state) }
    const transition = transitions[boundary]
    if (!transition) continue
    steps.push({ transition })
    for (const id of [transition.from, transition.to]) {
      const state = byId.get(id)
      if (state && !isComposite(state)) created.add(state)
    }
  }
  for (const state of states) created.add(state)
  return { steps, created: [...created] }
}

function renderScope(states: StateNode[], transitions: StateTransition[], direction: StateNode['direction'] | undefined, indent: string, out: string[], notes: ReadonlyMap<string, readonly StateFloatingNote[]>, scope?: StateScope): void {
  if (direction !== undefined) out.push(`${indent}direction ${direction}`)
  // Each state where its scope first creates it, so a scope lays out in the
  // order it was authored.
  for (const step of scopeWriteOrder(states, transitions).steps) {
    if ('transition' in step) {
      const t = step.transition
      // `state`, `note` and the like that a blank follows start a statement
      // of their own in Mermaid's lexer, so no blank follows them here:
      // `note--> A`, `A --> note: label`, or a comment, `A --> note%%`.
      const keyword = (id: string, className: string | undefined): boolean => className === undefined && namesStateGlued(id)
      const endpoint = (id: string, className: string | undefined): string => className === undefined ? id : `${id}:::${className}`
      const glued = keyword(t.to, t.toClass)
      const arrow = `${indent}${endpoint(t.from, t.fromClass)}${keyword(t.from, t.fromClass) ? '' : ' '}--> ${endpoint(t.to, t.toClass)}`
      out.push(t.label !== undefined ? describe(`${arrow}${glued ? ':' : ' :'} `, t.label, t.labelContent) : glued ? `${arrow}%%` : arrow)
      continue
    }
    const s = step.state
    if (isComposite(s)) {
      // Composite block (ordinary or `--`-partitioned concurrency regions).
      const separateDescription = describedApart(s)
      if (separateDescription) out.push(describe(`${indent}${s.id}: `, s.label!, s.labelContent))
      const header = s.label !== undefined && !separateDescription ? `state "${serializeStateLabel(s.label, s.labelContent, '"')}" as ${s.id} {` : `state ${s.id} {`
      out.push(`${indent}${header}`)
      if (s.regions) {
        if (s.direction !== undefined) out.push(`${indent}  direction ${s.direction}`)
        s.regions.forEach((region, index) => {
          renderScope(region.states, region.transitions, region.direction, indent + '  ', out, notes, { parent: s.id, region: index })
          if (index < s.regions!.length - 1) out.push(`${indent}  --`)
        })
      } else {
        renderScope(s.states ?? [], s.transitions ?? [], s.direction, indent + '  ', out, notes, { parent: s.id })
      }
      out.push(`${indent}}`)
    } else if (s.stereotype !== undefined) {
      // Pseudostate declaration (fork/join/choice/history) — canonical marker
      // spelling; `<<H>>`/`<<H*>>` shorthands normalize on parse.
      const separateDescription = describedApart(s)
      const alias = s.label !== undefined && !separateDescription ? `"${serializeStateLabel(s.label, s.labelContent, '"')}" as ` : ''
      out.push(`${indent}state ${alias}${s.id} ${stereotypeMarker(s.stereotype)}`)
      if (separateDescription) out.push(describe(`${indent}${s.id}: `, s.label!, s.labelContent))
    } else if (s.label !== undefined) {
      out.push(isCompositeId(s.id) && !describedApart(s)
        ? `${indent}state "${serializeStateLabel(s.label, s.labelContent, '"')}" as ${s.id}`
        : describe(`${indent}${s.id}: `, s.label, s.labelContent))
    } else if (s.declaredBare) {
      out.push(`${indent}${hasBareSpelling(s.id) ? s.id + (/^as$/i.test(s.id) ? '%%' : '') : `state "${s.id}" as ${s.id}`}`)
    }
  }
  for (const note of notes.get(stateScopeKey(scope)) ?? []) {
    out.push(`${indent}note "${serializeStateLabel(note.text, note.textContent, '"')}" as ${note.id}`)
  }
}

function stateScopeKey(scope: StateScope | undefined): string {
  return JSON.stringify([scope?.parent ?? null, scope?.region ?? 0])
}

export function renderState(body: StateBody): string {
  const problem = stateWriteProblem(body)
  if (problem) throw new Error(problem)
  const noteIds = new Set<string>()
  const notesByScope = new Map<string, StateFloatingNote[]>()
  for (const note of body.floatingNotes ?? []) {
    if (!isStateNodeId(note.id) || noteIds.has(note.id)) throw new Error(`Invalid or duplicate floating State note identity "${note.id}"`)
    noteIds.add(note.id)
    const text = validFloatingNoteText(note.text)
    if (!text.ok) throw new Error(`Floating State note "${note.id}": ${text.error.message}`)
    if (note.scope) {
      const parent = locate(body, note.scope.parent)?.node
      if (!parent || !isComposite(parent)
        || (parent.regions ? !Number.isInteger(note.scope.region ?? 0) || !parent.regions[note.scope.region ?? 0] : note.scope.region !== undefined)) {
        throw new Error(`Invalid scope for floating State note "${note.id}"`)
      }
    }
    const key = stateScopeKey(note.scope)
    const notes = notesByScope.get(key) ?? []
    notes.push(note)
    notesByScope.set(key, notes)
  }
  const out: string[] = ['stateDiagram-v2']
  renderScope(body.states, body.transitions, body.direction, '  ', out, notesByScope)
  // An inline note requires text. Empty, multiline and punctuation-bearing
  // annotations use the block form; colons and semicolons end inline notes.
  for (const n of body.notes ?? []) {
    const text = writeStateText(n.text, n.textContent)
    if (!text.trim() || /[\n:;]/.test(n.text)) {
      out.push(`  note ${n.side} of ${n.target}`)
      // Mermaid reads a block whose text starts with a colon, after any
      // blank lines, as a one-line note, and then rejects its `end note`;
      // `#58;` reads as the colon.
      for (const line of text.replace(/^(\s*):/, '$1#58;').split('\n')) {
        // The pinned lexer ends a note at this prefix, even with more text.
        const escaped = line.replace(/^(\s*)(e)(?=nd note)/i, (_match, space: string, letter: string) => `${space}#${letter.charCodeAt(0)};`)
        out.push(`    ${keepStateTextFromPrepass(escaped)}`)
      }
      out.push('  end note')
    } else {
      out.push(`  note ${n.side} of ${n.target} : ${text}`)
    }
  }
  for (const [name, style] of Object.entries(body.classDefs ?? {})) out.push(classLikeStyleStatement(`  classDef ${name} `, style, undefined, ownStyleDeclarations(body.classDefDeclarations, name)))
  const styledStates: StateNode[] = []
  const transitions: StateTransition[] = []
  const collect = (states: StateNode[], scopeTransitions: StateTransition[]): void => {
    for (const state of states) {
      styledStates.push(state)
      if (state.regions) for (const region of state.regions) collect(region.states, region.transitions)
      else if (state.states) collect(state.states, state.transitions ?? [])
    }
    transitions.push(...scopeTransitions)
  }
  collect(body.states, body.transitions)
  for (const state of styledStates) {
    for (const className of graphClassNames(state.className)) out.push(stateClassAssignment(state.id, className))
    if (state.style) out.push(classLikeStyleStatement(`  style ${state.id} `, state.style, undefined, state.styleDeclarations))
  }
  for (const { id, className } of body.unresolvedClasses ?? []) out.push(stateClassAssignment(id, className))
  for (const { id, style, styleDeclarations } of body.unresolvedStyles ?? []) out.push(classLikeStyleStatement(`  style ${id} `, style, undefined, styleDeclarations))
  if (body.defaultTransitionStyle) out.push(`  linkStyle default ${serializeStyleProps(body.defaultTransitionStyle)}`)
  transitions.forEach((transition, index) => {
    if (transition.style) out.push(`  linkStyle ${index} ${serializeStyleProps(transition.style)}`)
  })
  const source = out.join('\n') + '\n'
  assertWrittenStateOwnership(body, source)
  return source
}

class StateWriteError extends Error {}

function stateClassAssignment(id: string, className: string): string {
  if (!portableStyleTarget(id)) throw new StateWriteError(`State class target "${id}" needs letters, digits or underscore for portable export`)
  return `  class ${id} ${className}`
}

/** A successful structured edit must have a Mermaid spelling with the same
 * ownership. Cross-scope references can claim a moved state before its new
 * declaration; checking the emitted statements prevents a silent move back. */
function assertWrittenStateOwnership(body: StateBody, source: string): void {
  const { statements } = readStateStatements(scanStateComments(source.split('\n')))
  const identities = resolveStateIdentities(statements)
  if (identities.issue) throw new StateWriteError(identities.issue)
  const visit = (states: StateNode[], scope?: StateScope): void => {
    for (const state of states) {
      const actual = identities.ownerOf(state.id)
      if (!identities.authored.has(state.id) || stateScopeKey(actual) !== stateScopeKey(scope)) {
        throw new StateWriteError(`State '${state.id}' cannot retain its requested scope in Mermaid source. Move or remove transitions that claim it in another scope before changing its ownership.`)
      }
      if (state.regions) state.regions.forEach((region, index) => visit(region.states, { parent: state.id, region: index }))
      else if (state.states) visit(state.states, { parent: state.id })
    }
  }
  visit(body.states)
}

const portableStyleTarget = (id: string): boolean => /^\w+$/.test(id)
const portableClassDefinition = (name: string): boolean => /^\w+$/.test(name) && !/^default$/i.test(name)

function stateWriteProblem(body: StateBody): string | undefined {
  const className = Object.keys(body.classDefs ?? {}).find(name => !portableClassDefinition(name))
  if (className !== undefined) return `State class definition name "${className}" cannot be written in pinned Mermaid; definition names must contain only letters, digits, or underscore and cannot be default`
  // Accessibility tokens are active only in the initial lexer state;
  // composites use Mermaid's exclusive struct state, where these are IDs.
  const endpoint = body.transitions.find(item => item.label !== undefined && /^acc(?:Title|Descr)$/i.test(item.to))?.to
  let invalid = body.unresolvedStyles?.find(item => !portableStyleTarget(item.id))?.id
  let invalidBoundary = false
  let invalidStyle = Object.keys(body.classDefDeclarations ?? {}).some(name => !Object.hasOwn(body.classDefs ?? {}, name)) || Object.entries(body.classDefs ?? {}).some(([name, style]) => !portableClassLikeStyleProps(style, ownStyleDeclarations(body.classDefDeclarations, name))) || body.unresolvedStyles?.some(item => !portableClassLikeStyleProps(item.style, item.styleDeclarations))
  const visit = (states: StateNode[], transitions: StateTransition[]): void => {
    for (const state of states) {
      if (state.declarationBeforeTransition !== undefined && (!Number.isInteger(state.declarationBeforeTransition) || state.declarationBeforeTransition < 0 || state.declarationBeforeTransition > transitions.length)) invalidBoundary = true
      if (state.style && !portableStyleTarget(state.id)) invalid ??= state.id
      if (state.styleDeclarations && !state.style || state.style && !portableClassLikeStyleProps(state.style, state.styleDeclarations)) invalidStyle = true
      if (state.regions) for (const region of state.regions) visit(region.states, region.transitions)
      else if (state.states) visit(state.states, state.transitions ?? [])
    }
  }
  visit(body.states, body.transitions)
  if (invalidBoundary) return 'State declaration boundary must be an integer within its owning transition sequence'
  if (invalidStyle) return 'State style contains text outside the supported SVG attribute domain'
  if (endpoint !== undefined) return `A top-level labeled State transition to "${endpoint}" cannot be written in pinned Mermaid because the destination and colon start an accessibility directive; rename the destination or remove the label for typed editing`
  return invalid === undefined ? undefined : `State style target "${invalid}" cannot be written in pinned Mermaid; style targets must contain only letters, digits, or underscore`
}

// ---- Projection to MermaidGraph (verify / layout / describe) ----------------
//
// State bodies reuse the flowchart geometric verify path: serialize to
// canonical source, parse with the legacy state parser. This is the renderer
// projection — the exact graph the renderer would lay out.

import { parseMermaid as parseLegacy, parseStyleProps } from '../parser.ts'
import { compactStyleDeclarations, ownStyleDeclarations, parseMutableStyleProps, parseStyleDeclarations, projectStyleDeclarations, retainedStyleDeclarations, serializeStyleProps, unsafeStylePaintError, type StyleDeclaration } from '../shared/style-props.ts'
import { classLikeStyleHasValueCommas, classLikeStyleStatement, parseClassLikeStyleDeclarations, parseClassLikeStyleProps, portableClassLikeStyleProps } from '../shared/class-like-style.ts'
import type { MermaidGraph } from '../types.ts'

export function stateBodyToGraph(body: StateBody): MermaidGraph {
  return parseLegacy(renderState(body))
}

// ---- Mutator ----------------------------------------------------------------

function cloneTransition(transition: StateTransition): StateTransition {
  return { ...transition, ...(transition.style ? { style: { ...transition.style } } : {}) }
}

function cloneState(s: StateNode): StateNode {
  return {
    id: s.id,
    ...(s.label !== undefined ? { label: s.label } : {}),
    ...(s.labelContent !== undefined ? { labelContent: s.labelContent } : {}),
    ...(s.declaredBare ? { declaredBare: true as const } : {}),
    ...(s.declarationBeforeTransition !== undefined ? { declarationBeforeTransition: s.declarationBeforeTransition } : {}),
    ...(s.stereotype !== undefined ? { stereotype: s.stereotype } : {}),
    ...(s.className !== undefined ? { className: s.className } : {}),
    ...(s.style !== undefined ? { style: { ...s.style } } : {}),
    ...(s.styleDeclarations ? { styleDeclarations: structuredClone(s.styleDeclarations) } : {}),
    ...(s.direction !== undefined ? { direction: s.direction } : {}),
    ...(s.states !== undefined ? { states: s.states.map(cloneState) } : {}),
    ...(s.transitions !== undefined ? { transitions: s.transitions.map(cloneTransition) } : {}),
    ...(s.regions !== undefined ? { regions: s.regions.map(region => ({
      states: region.states.map(cloneState),
      transitions: region.transitions.map(cloneTransition),
      ...(region.direction !== undefined ? { direction: region.direction } : {}),
    })) } : {}),
  }
}

function cloneStateBody(b: StateBody): StateBody {
  return {
    kind: 'state',
    states: b.states.map(cloneState),
    transitions: b.transitions.map(cloneTransition),
    ...(b.notes !== undefined ? { notes: b.notes.map(n => ({ ...n })) } : {}),
    ...(b.floatingNotes ? { floatingNotes: b.floatingNotes.map(note => ({ ...note, ...(note.scope ? { scope: { ...note.scope } } : {}) })) } : {}),
    ...(b.direction !== undefined ? { direction: b.direction } : {}),
    ...(b.classDefs !== undefined ? { classDefs: Object.fromEntries(Object.entries(b.classDefs).map(([name, style]) => [name, { ...style }])) } : {}),
    ...(b.classDefDeclarations ? { classDefDeclarations: structuredClone(b.classDefDeclarations) } : {}),
    ...(b.defaultTransitionStyle !== undefined ? { defaultTransitionStyle: { ...b.defaultTransitionStyle } } : {}),
    ...(b.unresolvedClasses ? { unresolvedClasses: b.unresolvedClasses.map(item => ({ ...item })) } : {}),
    ...(b.unresolvedStyles ? { unresolvedStyles: b.unresolvedStyles.map(item => ({ ...item, style: { ...item.style }, ...(item.styleDeclarations ? { styleDeclarations: structuredClone(item.styleDeclarations) } : {}) })) } : {}),
  }
}

/** Find a state node by id, searching the whole tree. Returns the node and the
 *  scope (states + transitions arrays) that contains it. */
interface Located { node: StateNode; siblings: StateNode[]; transitions: StateTransition[]; scope?: StateScope }
function locate(body: StateBody, id: string): Located | null {
  const search = (states: StateNode[], transitions: StateTransition[], scope?: StateScope): Located | null => {
    for (const s of states) {
      if (s.id === id) return { node: s, siblings: states, transitions, ...(scope ? { scope } : {}) }
      if (s.regions) {
        for (const [index, region] of s.regions.entries()) {
          const inner = search(region.states, region.transitions, { parent: s.id, region: index })
          if (inner) return inner
        }
      } else if (s.states !== undefined) {
        const inner = search(s.states, s.transitions ?? [], { parent: s.id })
        if (inner) return inner
      }
    }
    return null
  }
  return search(body.states, body.transitions)
}

/** Collect every state id in the tree (for duplicate detection). */
function collectIds(states: StateNode[], into: Set<string>): void {
  for (const s of states) {
    into.add(s.id)
    if (s.regions) for (const region of s.regions) collectIds(region.states, into)
    else if (s.states !== undefined) collectIds(s.states, into)
  }
}

function validLabel(value: unknown, field: string): Result<string, MutationError> {
  if (typeof value !== 'string') return err({ code: 'INVALID_OP', message: `State ${field} must be a string` })
  const v = normalizeBrTags(value).trim()
  if (v.length === 0) return err({ code: 'INVALID_OP', message: `State ${field} must be non-empty` })
  // The label is emitted inside `state "…" as id` — a bare `"` would break the
  // round-trip; reject quotes.
  if (v.includes('"')) return err({ code: 'INVALID_OP', message: `State ${field} must not contain a double quote` })
  return ok(v)
}

function validId(value: unknown, field: string): Result<string, MutationError> {
  if (typeof value !== 'string') return err({ code: 'INVALID_OP', message: `State ${field} must be a string` })
  if (!isCompositeId(value)) {
    return err({ code: 'INVALID_OP', message: `State ${field} must be an identifier (letters, digits, underscore — no spaces, hyphens, or punctuation)` })
  }
  return ok(value)
}

/** A state name a typed edit introduces. Our reader also takes hyphenated
 * names and the words `default`, `click` and `href`, but pinned Mermaid
 * cannot read them as states (verify reports `state_endpoint_name`), so an
 * edit never writes a new one. */
function validStateName(value: unknown, field: string): Result<string, MutationError> {
  const id = validId(value, field)
  if (!id.ok) return id
  if (id.value.includes('-') || /^(?:default|click|href)$/i.test(id.value)) {
    return err({ code: 'INVALID_OP', message: `State ${field} '${id.value}' is not a name Mermaid 12.2.0 reads as a state: it holds no hyphen and is not default, click or href` })
  }
  return id
}

type ClassifiedEndpoint = { value: string; kind: 'pseudo' | 'history' | 'state' }

/** Classify endpoint syntax before mutation; only ordinary state endpoints may
 * reach auto-materialization. */
function validEndpoint(value: unknown, field: string): Result<ClassifiedEndpoint, MutationError> {
  if (value === PSEUDO) return ok({ value: PSEUDO, kind: 'pseudo' })
  if (typeof value === 'string' && isHistoryEndpoint(value)) return ok({ value, kind: 'history' })
  if (typeof value !== 'string' || !isStateNodeId(value)) {
    return err({ code: 'INVALID_OP', message: `State ${field} must be a state id, [*], [H], [H*], or a qualified history endpoint` })
  }
  return ok({ value, kind: 'state' })
}

function validateHistoryContext(
  body: StateBody,
  endpoint: ClassifiedEndpoint,
  parent: string | null | undefined,
): Result<true, MutationError> {
  if (endpoint.kind !== 'history') return ok(true)
  const history = matchHistoryEndpoint(endpoint.value)!
  const base = history.base || parent
  if (!base) return err({ code: 'INVALID_OP', message: `Bare history endpoint '${endpoint.value}' requires a composite parent scope` })
  const located = locate(body, base)
  if (!located) return err({ code: 'STATE_NOT_FOUND', message: `History endpoint '${endpoint.value}' references missing composite '${base}'` })
  if (!isComposite(located.node)) return err({ code: 'INVALID_OP', message: `History endpoint '${endpoint.value}' requires '${base}' to be a composite state` })
  return ok(true)
}

/** Validate note text: non-empty; lines are trimmed and blank lines dropped
 *  (the canonical block-note form the parser produces), so serialization
 *  round-trips byte-stably; an `end note` line would truncate the block. */
function validNoteText(value: unknown): Result<string, MutationError> {
  if (typeof value !== 'string') return err({ code: 'INVALID_OP', message: 'Note text must be a string' })
  const lines = normalizeBrTags(value).split('\n').map(l => l.trim()).filter(l => l.length > 0)
  if (lines.length === 0) return err({ code: 'INVALID_OP', message: 'Note text must be non-empty' })
  if (lines.some(l => /^end\s+note$/i.test(l))) {
    return err({ code: 'INVALID_OP', message: 'Note text must not contain an "end note" line (it would terminate the serialized note block)' })
  }
  return ok(lines.join('\n'))
}

function validFloatingNoteText(value: unknown): Result<string, MutationError> {
  if (typeof value !== 'string' || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value)) {
    return err({ code: 'INVALID_OP', message: 'Floating note text must be a string without control characters' })
  }
  if (value.length === 0) return err({ code: 'INVALID_OP', message: 'Floating note text must be non-empty; use remove_floating_note to remove the annotation' })
  return ok(normalizeBrTags(value).replace(/\r\n?/g, '\n'))
}

/** Validate a note side; omitted defaults to 'right' (upstream's most common). */
function validNoteSide(value: unknown): Result<'left' | 'right', MutationError> {
  if (value === undefined || value === null) return ok('right')
  if (value === 'left' || value === 'right') return ok(value)
  return err({ code: 'INVALID_OP', message: `Note side must be "left" or "right", got ${JSON.stringify(value)}` })
}

function isComposite(s: StateNode): boolean {
  return s.states !== undefined || s.transitions !== undefined || s.regions !== undefined
}

function parseStateStyle(style: string, field: string, portable = true): Result<Record<string, string>, MutationError> {
  const parsed = parseMutableStyleProps(style)
  if (!parsed.ok) {
    const message = parsed.reason === 'NOT_STRING'
      ? `${field} must be a CSS-like style string`
      : parsed.reason === 'MULTILINE'
        ? `${field} must be a single-line CSS-like style string`
        : parsed.reason === 'UNSAFE_PAINT'
          ? unsafeStylePaintError(field, parsed.paint).message
          : `${field} must contain at least one property:value pair`
    return err({ code: 'INVALID_OP', message })
  }
  const value = portable ? portableClassLikeStyleProps(parsed.value, parseStyleDeclarations(style)) : parsed.value
  return value ? ok(value) : err({ code: 'INVALID_OP', message: `${field} contains text outside the supported SVG attribute domain` })
}

export function mutateState(body: StateBody, op: StateMutationOp): Result<StateBody, MutationError> {
  const problem = stateWriteProblem(body)
  if (problem) return err({ code: 'INVALID_OP', message: problem })
  const next = cloneStateBody(body)

  switch (op.kind) {
    case 'add_state': {
      const id = validStateName(op.id, 'state id')
      if (!id.ok) return id
      const ids = new Set<string>()
      collectIds(next.states, ids)
      if (ids.has(id.value)) return err({ code: 'DUPLICATE_STATE', message: `State '${id.value}' already exists` })
      let label: string | undefined
      if (op.label !== undefined && op.label !== null) {
        const l = validLabel(op.label, 'label')
        if (!l.ok) return l
        label = l.value
      }
      const node: StateNode = { id: id.value, ...(label !== undefined ? { label } : { declaredBare: true as const }) }
      if (op.parent !== undefined && op.parent !== null) {
        const scope = resolveScope(next, op.parent, op.region)
        if (!scope.ok) return scope
        node.declarationBeforeTransition = scope.value.transitions.length
        scope.value.states.push(node)
      } else {
        if (op.region !== undefined) return err({ code: 'INVALID_OP', message: 'add_state.region requires a composite parent' })
        node.declarationBeforeTransition = next.transitions.length
        next.states.push(node)
      }
      break
    }
    case 'remove_state': {
      const loc = locate(next, op.id)
      if (!loc) return err({ code: 'STATE_NOT_FOUND', message: `State '${op.id}' not found` })
      const nonEmpty = isComposite(loc.node) && (compositeScopes(loc.node).some(scope => scope.states.length > 0 || scope.transitions.length > 0)
        || (next.floatingNotes ?? []).some(note => note.scope?.parent === op.id))
      if (nonEmpty && op.recursive !== true) {
        return err({ code: 'INVALID_OP', message: `Refusing to remove non-empty composite '${op.id}'; remove its children first, or pass recursive: true to remove the whole subtree` })
      }
      // Collect every id that disappears (the state and, recursively, its
      // descendants) so the transition/note cascade reaches all of them.
      const removedIds = new Set<string>()
      collectIds([loc.node], removedIds)
      const ix = loc.siblings.indexOf(loc.node)
      loc.siblings.splice(ix, 1)
      // Cascade: drop every transition (at any level) and note touching a
      // removed id — including history references (`X[H]`) to removed bases.
      cascadeRemoveTransitions(next, removedIds)
      if (next.notes) {
        next.notes = next.notes.filter(n => !removedIds.has(n.target))
        if (next.notes.length === 0) delete next.notes
      }
      if (next.floatingNotes) {
        next.floatingNotes = next.floatingNotes.filter(note => !note.scope || !removedIds.has(note.scope.parent))
        if (!next.floatingNotes.length) delete next.floatingNotes
      }
      break
    }
    case 'rename_state': {
      const to = validStateName(op.to, 'rename target')
      if (!to.ok) return to
      const loc = locate(next, op.from)
      if (!loc) return err({ code: 'STATE_NOT_FOUND', message: `State '${op.from}' not found` })
      const ids = new Set<string>()
      collectIds(next.states, ids)
      if (ids.has(to.value)) return err({ code: 'DUPLICATE_STATE', message: `State '${to.value}' already exists` })
      loc.node.id = to.value
      renameInTransitions(next, op.from, to.value)
      for (const n of next.notes ?? []) {
        if (n.target === op.from) n.target = to.value
      }
      for (const note of next.floatingNotes ?? []) if (note.scope?.parent === op.from) note.scope.parent = to.value
      break
    }
    case 'set_state_label': {
      const loc = locate(next, op.id)
      if (!loc) return err({ code: 'STATE_NOT_FOUND', message: `State '${op.id}' not found` })
      if (!hasDeclaration(loc.node)) {
        const firstUse = loc.transitions.findIndex(transition => transition.from === loc.node.id || transition.to === loc.node.id)
        loc.node.declarationBeforeTransition = firstUse < 0 ? loc.transitions.length : firstUse + 1
      }
      delete loc.node.labelContent
      if (op.label === null) { delete loc.node.label; loc.node.declaredBare = true; break }
      const l = validLabel(op.label, 'label')
      if (!l.ok) return l
      loc.node.label = l.value
      delete loc.node.declaredBare
      break
    }
    case 'add_transition': {
      const from = validEndpoint(op.from, 'transition from')
      if (!from.ok) return from
      const to = validEndpoint(op.to, 'transition to')
      if (!to.ok) return to
      // A name Mermaid cannot read as a transition endpoint has no spelling
      // there, whether the state is new or already declared (`state "…" as
      // a-b` is readable; `S1 --> a-b` is not).
      for (const [endpoint, field] of [[from.value, 'transition from'], [to.value, 'transition to']] as const) {
        if (endpoint.kind !== 'state') continue
        const name = validStateName(endpoint.value, field)
        if (!name.ok) return name
      }
      const fromContext = validateHistoryContext(next, from.value, op.parent)
      if (!fromContext.ok) return fromContext
      const toContext = validateHistoryContext(next, to.value, op.parent)
      if (!toContext.ok) return toContext
      // Ordinary state endpoints remain ergonomic and may be auto-created;
      // pseudostate/history syntax is contextual and can never become a node.
      const scope = resolveScope(next, op.parent, op.region)
      if (!scope.ok) return scope
      const target = scope.value
      let label: string | undefined
      if (op.label !== undefined && op.label !== null) {
        const l = validLabel(op.label, 'transition label')
        if (!l.ok) return l
        label = l.value
      }
      if (from.value.kind === 'state') ensureSimpleInScope(next, target, from.value.value)
      if (to.value.kind === 'state') ensureSimpleInScope(next, target, to.value.value)
      target.transitions.push({ from: from.value.value, to: to.value.value, ...(label !== undefined ? { label } : {}) })
      break
    }
    case 'remove_transition': {
      const scope = resolveScope(next, op.parent, op.region)
      if (!scope.ok) return scope
      const list = scope.value.transitions
      if (op.index !== undefined) {
        if (!list[op.index]) return err({ code: 'TRANSITION_NOT_FOUND', message: `No transition at index ${op.index}` })
        removeScopeTransitions(scope.value.states, list, (_transition, index) => index === op.index)
        break
      }
      if (op.from !== undefined && op.to !== undefined) {
        const ix = list.findIndex(t => t.from === op.from && t.to === op.to)
        if (ix < 0) return err({ code: 'TRANSITION_NOT_FOUND', message: `No transition ${op.from} --> ${op.to}` })
        removeScopeTransitions(scope.value.states, list, (_transition, index) => index === ix)
        break
      }
      return err({ code: 'INVALID_OP', message: 'remove_transition needs an index or a from/to pair' })
    }
    case 'set_transition_label': {
      const scope = resolveScope(next, op.parent, op.region)
      if (!scope.ok) return scope
      const list = scope.value.transitions
      let t: StateTransition | undefined
      if (op.index !== undefined) t = list[op.index]
      else if (op.from !== undefined && op.to !== undefined) t = list.find(tr => tr.from === op.from && tr.to === op.to)
      if (!t) return err({ code: 'TRANSITION_NOT_FOUND', message: 'transition not found (need a valid index or from/to pair)' })
      delete t.labelContent
      if (op.label === null) { delete t.label; break }
      const l = validLabel(op.label, 'transition label')
      if (!l.ok) return l
      t.label = l.value
      break
    }
    case 'set_direction': {
      if (op.state === undefined || op.state === null) {
        next.direction = op.direction
        break
      }
      const loc = locate(next, op.state)
      if (!loc) return err({ code: 'STATE_NOT_FOUND', message: `State '${op.state}' not found` })
      if (!isComposite(loc.node)) {
        return err({ code: 'INVALID_OP', message: `'${op.state}' is a simple state — direction applies to the diagram (omit "state") or to a composite` })
      }
      loc.node.direction = op.direction
      break
    }
    case 'move_state': {
      const loc = locate(next, op.id)
      if (!loc) return err({ code: 'STATE_NOT_FOUND', message: `State '${op.id}' not found` })
      if (op.parent !== null) {
        if (op.parent === op.id) return err({ code: 'INVALID_OP', message: `Cannot move state '${op.id}' into itself` })
        const descendants = new Set<string>()
        collectIds([loc.node], descendants)
        if (descendants.has(op.parent)) {
          return err({ code: 'INVALID_OP', message: `Cannot move '${op.id}' into '${op.parent}' — it is a descendant of '${op.id}'` })
        }
        const targetScope = resolveScope(next, op.parent, op.region)
        if (!targetScope.ok) return targetScope
        // Detach, then attach (transitions stay where they are — state ids
        // are global in mermaid, so cross-boundary transitions remain legal).
        loc.siblings.splice(loc.siblings.indexOf(loc.node), 1)
        if (!hasDeclaration(loc.node)) loc.node.declaredBare = true
        loc.node.declarationBeforeTransition = targetScope.value.transitions.length
        targetScope.value.states.push(loc.node)
      } else {
        if (op.region !== undefined) return err({ code: 'INVALID_OP', message: 'move_state.region requires a composite parent' })
        if (loc.siblings === next.states) break // already top-level — no-op
        loc.siblings.splice(loc.siblings.indexOf(loc.node), 1)
        if (!hasDeclaration(loc.node)) loc.node.declaredBare = true
        loc.node.declarationBeforeTransition = next.transitions.length
        next.states.push(loc.node)
      }
      break
    }
    case 'dissolve_composite': {
      const loc = locate(next, op.id)
      if (!loc) return err({ code: 'STATE_NOT_FOUND', message: `State '${op.id}' not found` })
      if (!isComposite(loc.node)) {
        return err({ code: 'INVALID_OP', message: `'${op.id}' is not a composite — dissolve_composite hoists a composite's children into its parent scope` })
      }
      const referenced = transitionsTouching(next, op.id)
      if (referenced > 0) {
        return err({ code: 'INVALID_OP', message: `${referenced} transition(s) still reference composite '${op.id}'; remove or retarget them first (remove_transition / add_transition), then dissolve` })
      }
      if ((next.notes ?? []).some(n => n.target === op.id)) {
        return err({ code: 'INVALID_OP', message: `A note is anchored to composite '${op.id}'; remove it first (remove_note), then dissolve` })
      }
      // Hoist children + inner transitions into the parent scope at the
      // composite's position, then drop the composite shell (label included).
      const ix = loc.siblings.indexOf(loc.node)
      const scopes = compositeScopes(loc.node)
      const boundary = loc.node.declarationBeforeTransition ?? loc.transitions.length
      const inserted = scopes.reduce((sum, scope) => sum + scope.transitions.length, 0)
      for (const [position, state] of loc.siblings.entries()) if (state.declarationBeforeTransition !== undefined
        && (state.declarationBeforeTransition > boundary || state.declarationBeforeTransition === boundary && position > ix)) state.declarationBeforeTransition += inserted
      loc.siblings.splice(ix, 1, ...scopes.flatMap(scope => scope.states))
      let offset = boundary
      for (const scope of scopes) {
        for (const state of scope.states) if (hasDeclaration(state)) state.declarationBeforeTransition = offset + (state.declarationBeforeTransition ?? scope.transitions.length)
        offset += scope.transitions.length
      }
      loc.transitions.splice(boundary, 0, ...scopes.flatMap(scope => scope.transitions))
      for (const note of next.floatingNotes ?? []) if (note.scope?.parent === op.id) {
        if (loc.scope) note.scope = { ...loc.scope }
        else delete note.scope
      }
      break
    }
    case 'add_floating_note': {
      const id = validId(op.id, 'floating note id')
      if (!id.ok) return id
      if (next.floatingNotes?.some(note => note.id === id.value)) return err({ code: 'INVALID_OP', message: `Floating note '${id.value}' already exists` })
      const text = validFloatingNoteText(op.text)
      if (!text.ok) return text
      const scope = resolveScope(next, op.parent, op.region)
      if (!scope.ok) return scope
      const parent = op.parent ? locate(next, op.parent)!.node : undefined
      const note: StateFloatingNote = { id: id.value, text: text.value,
        ...(op.parent ? { scope: { parent: op.parent, ...(parent?.regions ? { region: op.region ?? 0 } : {}) } } : {}) }
      if (!next.floatingNotes) next.floatingNotes = []
      next.floatingNotes.push(note)
      break
    }
    case 'remove_floating_note': {
      const index = next.floatingNotes?.findIndex(note => note.id === op.id) ?? -1
      if (index < 0) return err({ code: 'NOTE_NOT_FOUND', message: `Floating note '${op.id}' not found` })
      next.floatingNotes!.splice(index, 1)
      if (!next.floatingNotes!.length) delete next.floatingNotes
      break
    }
    case 'set_floating_note_text': {
      const note = next.floatingNotes?.find(note => note.id === op.id)
      if (!note) return err({ code: 'NOTE_NOT_FOUND', message: `Floating note '${op.id}' not found` })
      const text = validFloatingNoteText(op.text)
      if (!text.ok) return text
      note.text = text.value
      delete note.textContent
      break
    }
    case 'add_note': {
      if (typeof op.target !== 'string' || !isStateNodeId(op.target)) {
        return err({ code: 'INVALID_OP', message: 'State note target must be an ordinary state identifier (letters, digits, underscore, or hyphen)' })
      }
      const target = op.target
      if (!locate(next, target)) return err({ code: 'STATE_NOT_FOUND', message: `State '${target}' not found` })
      // Mermaid's note statement ends a state name at a hyphen (state_note_target).
      if (target.includes('-')) return err({ code: 'INVALID_OP', message: `State note target '${target}' holds a hyphen, which Mermaid 12.2.0 cannot read in a note's state name; rename the state first` })
      const side = validNoteSide(op.side)
      if (!side.ok) return side
      const text = validNoteText(op.text)
      if (!text.ok) return text
      if (!next.notes) next.notes = []
      next.notes.push({ target, side: side.value, text: text.value })
      break
    }
    case 'remove_note': {
      const notes = next.notes ?? []
      if (!Number.isInteger(op.index) || op.index < 0 || op.index >= notes.length) {
        return err({ code: 'NOTE_NOT_FOUND', message: `No note at index ${op.index} (the body has ${notes.length} note(s))` })
      }
      notes.splice(op.index, 1)
      if (notes.length === 0) delete next.notes
      break
    }
    case 'set_note_text': {
      const notes = next.notes ?? []
      if (!Number.isInteger(op.index) || op.index < 0 || op.index >= notes.length) {
        return err({ code: 'NOTE_NOT_FOUND', message: `No note at index ${op.index} (the body has ${notes.length} note(s))` })
      }
      const text = validNoteText(op.text)
      if (!text.ok) return text
      notes[op.index]!.text = text.value
      delete notes[op.index]!.textContent
      break
    }
    case 'define_class': {
      if (typeof op.name !== 'string' || !portableClassDefinition(op.name)) {
        return err({ code: 'INVALID_OP', message: 'State class definition name must contain only letters, digits, or underscore and cannot be default' })
      }
      const style = parseStateStyle(op.style, 'State class style')
      if (!style.ok) return style
      if (!next.classDefs) next.classDefs = {}
      setOwn(next.classDefs, op.name, style.value)
      const declarations = retainedStyleDeclarations(parseStyleDeclarations(op.style))
      if (declarations) { next.classDefDeclarations ??= {}; setOwn(next.classDefDeclarations, op.name, declarations) }
      else if (next.classDefDeclarations) { delete next.classDefDeclarations[op.name]; if (!Object.keys(next.classDefDeclarations).length) delete next.classDefDeclarations }
      break
    }
    case 'set_state_class': {
      const loc = locate(next, op.id)
      if (!loc) return err({ code: 'STATE_NOT_FOUND', message: `State '${op.id}' not found` })
      if (op.className === null) { delete loc.node.className; break }
      if (typeof op.className !== 'string' || !/^[\w-]+$/.test(op.className)) {
        return err({ code: 'INVALID_OP', message: 'State class name must contain only letters, digits, underscore, or hyphen' })
      }
      loc.node.className = op.className
      break
    }
    case 'set_state_style': {
      const loc = locate(next, op.id)
      if (!loc) return err({ code: 'STATE_NOT_FOUND', message: `State '${op.id}' not found` })
      if (op.style === null) { delete loc.node.style; delete loc.node.styleDeclarations; break }
      if (!portableStyleTarget(loc.node.id)) return err({ code: 'INVALID_OP', message: `State style target "${loc.node.id}" cannot be written in pinned Mermaid; style targets must contain only letters, digits, or underscore` })
      const style = parseStateStyle(op.style, 'State inline style')
      if (!style.ok) return style
      loc.node.style = style.value
      loc.node.styleDeclarations = retainedStyleDeclarations(parseStyleDeclarations(op.style))
      if (!loc.node.styleDeclarations) delete loc.node.styleDeclarations
      break
    }
    case 'set_transition_style': {
      if (op.default === true) {
        if (op.index !== undefined || op.parent !== undefined || op.region !== undefined) return err({ code: 'INVALID_OP', message: 'Default transition style is diagram-wide; omit index, parent, and region' })
        if (op.style === null) delete next.defaultTransitionStyle
        else {
          const style = parseStateStyle(op.style, 'State transition style', false)
          if (!style.ok) return style
          next.defaultTransitionStyle = style.value
        }
        break
      }
      if (op.index === undefined) return err({ code: 'INVALID_OP', message: 'set_transition_style needs index, or default:true for the diagram-wide style' })
      const scope = resolveScope(next, op.parent, op.region)
      if (!scope.ok) return scope
      const transition = scope.value.transitions[op.index]
      if (!transition) return err({ code: 'TRANSITION_NOT_FOUND', message: `No transition at index ${op.index}` })
      if (op.style === null) delete transition.style
      else {
        const style = parseStateStyle(op.style, 'State transition style', false)
        if (!style.ok) return style
        transition.style = style.value
      }
      break
    }
    case 'make_composite': {
      const id = validId(op.id, 'composite id')
      if (!id.ok) return id
      const ids = new Set<string>()
      collectIds(next.states, ids)
      if (ids.has(id.value)) return err({ code: 'DUPLICATE_STATE', message: `State '${id.value}' already exists` })
      // Move the named member states (top level only) into a new composite.
      const moved: StateNode[] = []
      for (const memberId of op.members) {
        const ix = next.states.findIndex(s => s.id === memberId)
        if (ix < 0) return err({ code: 'STATE_NOT_FOUND', message: `State '${memberId}' not found at the top level` })
        moved.push(next.states[ix]!)
      }
      // Splice members out (descending index to keep positions valid).
      const memberSet = new Set(op.members)
      const remaining = next.states.filter(s => !memberSet.has(s.id))
      // Pull the matching top-level transitions (both endpoints moved) into the
      // composite; leave cross-boundary transitions at the top level.
      const inner: StateTransition[] = []
      const outer: StateTransition[] = []
      for (const t of next.transitions) {
        if (memberSet.has(t.from) && memberSet.has(t.to)) inner.push(t)
        else outer.push(t)
      }
      let label: string | undefined
      if (op.label !== undefined && op.label !== null) {
        const l = validLabel(op.label, 'label')
        if (!l.ok) return l
        label = l.value
      }
      const composite: StateNode = { id: id.value, ...(label !== undefined ? { label } : {}), states: moved, transitions: inner }
      next.states = [...remaining, composite]
      next.transitions = outer
      break
    }
    default: {
      const _x: never = op
      return err({ code: 'INVALID_OP', message: unknownOpMessage('state', _x) })
    }
  }

  // A successful edit can declare a formerly missing paint target. Consume
  // that intent in the same typed body the serializer will subsequently read.
  if (next.unresolvedClasses) {
    next.unresolvedClasses = next.unresolvedClasses.filter(item => {
      const target = locate(next, item.id)?.node
      if (!target) return true
      target.className = target.className === undefined ? item.className : `${target.className} ${item.className}`
      return false
    })
    if (next.unresolvedClasses.length === 0) delete next.unresolvedClasses
  }
  if (next.unresolvedStyles) {
    next.unresolvedStyles = next.unresolvedStyles.filter(item => {
      const target = locate(next, item.id)?.node
      if (!target) return true
      target.style = { ...item.style }
      if (item.styleDeclarations) target.styleDeclarations = structuredClone(item.styleDeclarations)
      else delete target.styleDeclarations
      return false
    })
    if (next.unresolvedStyles.length === 0) delete next.unresolvedStyles
  }
  preserveOrphanedImplicitStates(next)
  canonicalizeStateOrder(next.states, next.transitions)
  const writeProblem = stateWriteProblem(next)
  if (writeProblem) return err({ code: 'INVALID_OP', message: writeProblem })
  try { renderState(next) } catch (error) {
    if (error instanceof StateWriteError) return err({ code: 'INVALID_OP', message: error.message })
    throw error
  }
  return ok(next)
}

/**
 * Transition endpoints are allowed to introduce states implicitly, but an
 * implicit state has no standalone serializer form. When no transition in
 * its own scope creates it, emit a bare declaration there. A reference in a
 * different scope preserves the identity but cannot establish this ownership.
 */
function preserveOrphanedImplicitStates(body: StateBody): void {
  const promote = (states: StateNode[], transitions: StateTransition[]): void => {
    const referenced = new Set<string>()
    for (const transition of transitions) {
      referenced.add(transition.from)
      referenced.add(transition.to)
    }
    for (const state of states) {
      if (
        state.label === undefined
        && !state.declaredBare
        && state.stereotype === undefined
        && !isComposite(state)
        && !referenced.has(state.id)
      ) state.declaredBare = true
      if (state.regions) {
        for (const region of state.regions) promote(region.states, region.transitions)
      } else if (state.states) {
        promote(state.states, state.transitions ?? [])
      }
    }
  }
  promote(body.states, body.transitions)
}

/** List each scope's states in the order its serialization creates them, so
 * structured bodies are canonical before they leave parse/mutate, not only
 * after a serialize/reparse cycle. A parsed body is already in that order,
 * bar a stereotype first named by a transition. */
function canonicalizeStateOrder(states: StateNode[], transitions: StateTransition[]): void {
  for (const state of states) {
    if (state.regions) for (const region of state.regions) canonicalizeStateOrder(region.states, region.transitions)
    else if (state.states) canonicalizeStateOrder(state.states, state.transitions ?? [])
  }
  const order = scopeWriteOrder(states, transitions)
  let boundary = 0
  for (const step of order.steps) {
    if ('transition' in step) boundary++
    else step.state.declarationBeforeTransition = boundary
  }
  states.splice(0, states.length, ...order.created)
}

/** Return a composite's editable scopes in authored region order. */
function compositeScopes(node: StateNode): Array<{ states: StateNode[]; transitions: StateTransition[] }> {
  if (node.regions) return node.regions
  return [{ states: node.states ?? [], transitions: node.transitions ?? [] }]
}

/** Resolve the scope (states+transitions) named by `parent`, or the root. */
function resolveScope(body: StateBody, parent: string | null | undefined, region?: number): Result<{ states: StateNode[]; transitions: StateTransition[] }, MutationError> {
  if (parent === undefined || parent === null) {
    if (region !== undefined) return err({ code: 'INVALID_OP', message: 'A region index requires a composite parent' })
    return ok({ states: body.states, transitions: body.transitions })
  }
  const loc = locate(body, parent)
  if (!loc) return err({ code: 'STATE_NOT_FOUND', message: `Composite '${parent}' not found` })
  if (!isComposite(loc.node)) {
    if (region !== undefined) return err({ code: 'INVALID_OP', message: `State '${parent}' is not a concurrent composite, so region is invalid` })
    loc.node.states = []
    loc.node.transitions = []
  }
  const scopes = compositeScopes(loc.node)
  const index = region ?? 0
  if (!Number.isInteger(index) || index < 0 || index >= scopes.length) {
    return err({ code: 'INVALID_OP', message: `Composite '${parent}' has ${scopes.length} region/scope(s); region ${String(region)} is out of range` })
  }
  return ok(scopes[index]!)
}

/** Auto-create a simple state for a non-pseudo endpoint absent from the scope. */
function ensureSimpleInScope(body: StateBody, scope: { states: StateNode[] }, id: string): void {
  if (id === PSEUDO || isHistoryEndpoint(id)) return
  const ids = new Set<string>()
  collectIds(body.states, ids)
  if (ids.has(id)) return
  scope.states.push({ id })
}

/** True when a transition endpoint refers to `id` — directly, or as the base
 *  of a history reference (`id[H]` / `id[H*]`). */
function endpointTouches(endpoint: string, id: string): boolean {
  return endpoint === id || endpoint === `${id}[H]` || endpoint === `${id}[H*]`
}

/** Rebase all boundaries through one monotone survivor-prefix map. Each
 * deletion batch visits states and transitions once, including hub cascades. */
function removeScopeTransitions(states: StateNode[], transitions: StateTransition[], remove: (transition: StateTransition, index: number) => boolean): void {
  const prefix = [0], survivors: StateTransition[] = [], referenced = new Set<string>(), firstUse = new Map<string, number>()
  transitions.forEach((transition, index) => {
    for (const id of [transition.from, transition.to]) if (!firstUse.has(id)) firstUse.set(id, index)
    if (!remove(transition, index)) {
      survivors.push(transition)
      referenced.add(transition.from); referenced.add(transition.to)
    }
    prefix.push(survivors.length)
  })
  for (const state of states) {
    if (state.declarationBeforeTransition !== undefined) state.declarationBeforeTransition = prefix[state.declarationBeforeTransition]!
    else if (!hasDeclaration(state) && !referenced.has(state.id)) {
      const created = firstUse.get(state.id)
      if (created !== undefined) state.declarationBeforeTransition = prefix[created]!
    }
  }
  transitions.splice(0, transitions.length, ...survivors)
}

/** Remove every transition touching a removed identity in one scope walk. */
function cascadeRemoveTransitions(body: StateBody, removed: ReadonlySet<string>): void {
  const touches = (endpoint: string): boolean => removed.has(endpoint) || removed.has(endpoint.replace(/\[H\*?\]$/, ''))
  const walk = (states: StateNode[], transitions: StateTransition[]): void => {
    removeScopeTransitions(states, transitions, transition => touches(transition.from) || touches(transition.to))
    for (const state of states) {
      if (state.regions) for (const region of state.regions) walk(region.states, region.transitions)
      else if (state.states) walk(state.states, state.transitions ?? [])
    }
  }
  walk(body.states, body.transitions)
}

/** Count transitions (any nesting level) touching `id` (incl. history refs). */
function transitionsTouching(body: StateBody, id: string): number {
  let count = 0
  const walk = (states: StateNode[], transitions: StateTransition[]): void => {
    for (const t of transitions) {
      if (endpointTouches(t.from, id) || endpointTouches(t.to, id)) count++
    }
    for (const s of states) {
      if (s.regions) for (const region of s.regions) walk(region.states, region.transitions)
      else if (s.states !== undefined) walk(s.states, s.transitions ?? [])
    }
  }
  walk(body.states, body.transitions)
  return count
}

/** Rewrite `from`→`to` in every transition (any nesting level), including
 *  history references whose base is `from` (`from[H]` → `to[H]`). */
function renameInTransitions(body: StateBody, from: string, to: string): void {
  const rename = (endpoint: string): string => {
    if (endpoint === from) return to
    if (endpoint === `${from}[H]`) return `${to}[H]`
    if (endpoint === `${from}[H*]`) return `${to}[H*]`
    return endpoint
  }
  const walk = (states: StateNode[], transitions: StateTransition[]): void => {
    for (const t of transitions) {
      t.from = rename(t.from)
      t.to = rename(t.to)
    }
    for (const s of states) {
      if (s.regions) for (const region of s.regions) walk(region.states, region.transitions)
      else if (s.states !== undefined) walk(s.states, s.transitions ?? [])
    }
  }
  walk(body.states, body.transitions)
}

// ---- Verifier (FamilyDescriptor.verify hook) — structural Tier 1 on the body ----
//
// The geometric Tier 2 checks (NODE_OVERLAP / ROUTE_SELF_CROSS) run in verify.ts
// via the graph projection. This hook adds the body-level structural checks:
// EMPTY_DIAGRAM, EDGE_MISANCHORED (transition endpoint references a missing
// state), and LABEL_OVERFLOW.

/** State source ours reads where pinned Mermaid reads it otherwise, each on
 * its canonical line: a `;` between statements, which Mermaid reads into a
 * state name (or rejects after the header), and statements sharing a line
 * with nothing between them. Mermaid reads those apart too, but `A B` is
 * usually meant as one name with a space (mermaid#2973). A composite never
 * closed is reported where it opens: Mermaid and ours both reject it. */
export function stateUnsupportedSyntaxWarnings(canonicalSource: string, authoredLine?: (canonicalLine: number) => string | undefined): LayoutWarning[] {
  const lines = canonicalSource.split(/\r?\n/)
  const header = lines.findIndex(line => /^stateDiagram(?:-v2)?(?=$|[\s;%])/i.test(line.trim()))
  if (header < 0) return []
  const body = lines.slice(header + 1)
  // A line inside a statement's quoted or note text is the State reader's.
  const statementEnds = stateStatementEnds(body)
  for (let index = 0; index < body.length; index++) {
    const directive = parseAccessibilityDirective(body, index)
    if (directive === undefined) break
    if (directive === null) {
      index = statementEndAt(statementEnds, index, body.length)
      continue
    }
    for (let at = index; at <= directive.endIndex; at++) body[at] = ''
    if (directive.suffixLine) body[directive.endIndex] = directive.suffixLine
    index = directive.endIndex
  }
  const scan = readStateStatements(scanStateComments(body))
  const warnings: Array<LayoutWarning & { line: number }> = [
    ...scan.semicolonLines.map(index => ({
      code: 'UNSUPPORTED_SYNTAX' as const, syntax: 'state_semicolon_separator', line: header + index + 2,
      message: 'A `;` between State statements is read as a separator. Pinned Mermaid does not separate State statements with `;`: it reads the `;` into a state name, or rejects it after the header. Put each statement on its own line.',
    })),
    ...scan.juxtaposedLines.map(index => ({
      code: 'UNSUPPORTED_SYNTAX' as const, syntax: 'state_statements_share_line', line: header + index + 2,
      message: 'State statements sharing a line with nothing between them are read as separate statements, as Mermaid reads them: `A B` declares the states A and B. For one state whose name has a space, write `state "A B" as AB`; otherwise put each statement on its own line.',
    })),
    ...scan.braceNameLines.map(index => ({
      code: 'UNSUPPORTED_SYNTAX' as const, syntax: 'state_brace_after_name', line: header + index + 2,
      message: 'A `}` right after a state name, or after the name in `state "…" as A`, is read as closing its composite, and is dropped where no composite is open. Pinned Mermaid reads the `}` into the name (`A}`; after `as`, the rest of the line): inside a composite it then rejects the unclosed composite, and at the top level it draws a state named `A}`. Put the `}` on a line of its own.',
    })),
    ...scan.unopenedBraceLines.map(index => ({
      code: 'UNSUPPORTED_SYNTAX' as const, syntax: 'state_brace_unopened', line: header + index + 2,
      message: 'A `}` with no composite open closes nothing, and is dropped. Pinned Mermaid reads it as a state named `}`. Remove it, or open the composite it was meant to close with `state X {`.',
    })),
    ...scan.braceTextLines.map(index => ({
      code: 'UNSUPPORTED_SYNTAX' as const, syntax: 'state_brace_after_description', line: header + index + 2,
      message: 'A `}` ending the last description or transition label is read as closing its composite, which nothing else closes. Pinned Mermaid reads the `}` into the text and then rejects the unclosed composite. Put the `}` on a line of its own.',
    })),
    ...scan.aliasSuffixLines.map(index => ({
      code: 'UNSUPPORTED_SYNTAX' as const, syntax: 'state_alias_suffix', line: header + index + 2,
      message: 'After `state "…" as A`, `:::c` is read as the class of A and `: text` as its description, as each reads on a line of its own. Pinned Mermaid splits the rest of the line at every `:` and keeps only the text before a second colon as the description: it drops the class after `:::` (drawing an empty description instead) and the text after a colon inside the description. Write `class A c` or `A : text` on a line of its own.',
    })),
    ...scan.unclosedLines.map(index => ({
      code: 'UNSUPPORTED_SYNTAX' as const, syntax: 'state_composite_unclosed', line: header + index + 2,
      message: 'This composite state is never closed by `}`, so where it ends cannot be told and the diagram is not drawn; pinned Mermaid rejects it too. Add a `}` where the composite ends.',
    })),
  ]
  // A body line as authored, which verify has from the source it was given
  // or the parse of the diagram it was given, since canonical lines end
  // trimmed; as canonical for a diagram not parsed from source.
  const physicalLine = (index: number): string => {
    const canonical = body[index] ?? ''
    const authored = authoredLine?.(header + index + 2)
    return authored?.trim() === canonical.trim() ? authored : canonical
  }
  warnings.push(...stateReadOtherwiseWarnings(scan.statements, header, physicalLine))
  return warnings.sort((left, right) => left.line - right.line)
}

/** Statements ours reads that pinned Mermaid reads otherwise, by statement:
 *  `cssClass` and `linkStyle`, which its State grammar lacks; a declaration,
 *  transition, note or description naming a state it cannot name there; a description,
 *  transition label or one-line note it ends early; text whose `;` its
 *  entity prepass drops; and a composite given more than one label or
 *  description, which it rejects. Each at its authored line. */
function stateReadOtherwiseWarnings(statements: readonly StateStatement[], header: number, physicalLine: (line: number) => string): Array<LayoutWarning & { line: number }> {
  const warnings: Array<LayoutWarning & { line: number }> = []
  // At the line holding the construct: inside a composite a statement may
  // run across lines (`A⏎--> B : text`).
  const warn = (statement: StateStatement, syntax: string, message: string, line = statement.line): void => {
    warnings.push({ code: 'UNSUPPORTED_SYNTAX', syntax, line: header + line + 2, message })
  }
  // The line holding a statement's text, which runs to that line's end.
  const textLine = (statement: StateStatement): number => statement.textSpan?.start.line ?? statement.line
  // Mermaid's State lexer reads entity codes first, then ends a description
  // or transition label (DESCR, `":"(?:[^:\n;]|":"[^:\n;])+`) at a `;`, at
  // `::` and before a colon its line ends with. Ours reads the text to the
  // line's end, as both read the text after `state "…" as X`. A colon that
  // only blanks follow on the authored line is text to Mermaid.
  const cutText = (statement: StateStatement, value: string): void => {
    const text = lexedStateText(value)
    const line = textLine(statement)
    if (!/;|::/.test(text) && !(text.endsWith(':') && physicalLine(line).endsWith(':'))) return
    warn(statement, 'state_text_cut', 'A `;`, a `::` or a colon ending the line in a description or transition label is read as part of the text. Pinned Mermaid ends the text there: it reads the rest of the line from a `;` as further statements, the `;` starting a state name, and rejects a `::` or a colon ending the line. The writer writes them as `#59;` and `#58;`, which Mermaid reads as the text.', line)
  }
  const composites = new Set(statements.flatMap(statement => {
    const open = statement.noteBody ? null : statement.text.match(STATE_COMPOSITE_OPEN_RE)
    return open ? [open[2]!] : []
  }))
  const compositeLabels = new Map<string, number>()
  const labelComposite = (statement: StateStatement, id: string): void => {
    if (!composites.has(id)) return
    const count = (compositeLabels.get(id) ?? 0) + 1
    compositeLabels.set(id, count)
    if (count === 2) {
      warn(statement, 'state_composite_description', `Composite state '${id}' has more than one label or description, which are read as the lines of its label. Pinned Mermaid rejects a composite with more than one (\`Group nodes can only have label\`). Give it one \`state "…" as ${id}\` label.`, textLine(statement))
    }
  }
  // After a block note's opener, until its first line of text.
  let noteTextAwaited = false
  let depth = 0
  for (const statement of statements) {
    const text = statement.text
    if (!statement.noteBody) {
      if (text === '}') depth = Math.max(0, depth - 1)
      else if (statement.opens) depth++
    }
    if (text.includes('%%{') && (statement.noteBody || matchFloatingNote(text) || matchNoteLine(text) || text.match(STATE_ALIAS_RE) || text.match(STATE_COMPOSITE_OPEN_RE) || text.match(STATE_DESCRIPTION_RE) || matchTransitionLine(text)?.label !== undefined)) {
      warn(statement, 'state_text_directive', 'The directive-looking text is preserved as text. Pinned Mermaid preprocesses `%%{` even inside text; the writer escapes the percent sign as `#37;`.')
    }
    if (statement.noteBody) {
      if (/^end note/i.test(text)) warn(statement, 'state_note_terminator', 'The whole line is preserved as note text. Pinned Mermaid ends a block note at the `end note` prefix even when text follows; the writer escapes its first letter.')
      // Mermaid's one-line note text, `\s*":"[^:\n;]+`, starts after any
      // blank lines and indentation after the note's state: a block note
      // whose text starts with a colon is a one-line note there.
      if (noteTextAwaited && text) {
        noteTextAwaited = false
        if (/^\s*:[^:;\n]/.test(lexedStateText(physicalLine(statement.line)))) {
          warn(statement, 'state_note_block_colon', 'A block note whose text starts with a colon is read as a block note, the colon its text. Pinned Mermaid reads a colon starting the text after `note … of X` as starting a one-line note\'s text, and then rejects `end note`. The writer writes the colon as `#58;`, which Mermaid reads as the colon.')
        }
      }
      continue
    }
    noteTextAwaited = false
    const classDef = text.match(STATE_CLASS_DEF_RE)
    if (classDef && classDef[1]!.split(',').some(name => !portableClassDefinition(name.trim()))) {
      warn(statement, 'state_class_definition_name', 'The class definition name is preserved in source. Pinned Mermaid accepts only letters, digits, and underscore in definition names except `default`, with no quoted alternative; class references have a different grammar.')
    }
    const style = text.match(STATE_STYLE_RE)
    const paint = classDef?.[2] ?? style?.[2]
    if (paint !== undefined) {
      const props = parseStyleProps(paint)
      if (classLikeStyleHasValueCommas(paint)) warn(statement, 'state_style_commas', portableClassLikeStyleProps(props)
        ? 'Native CSS commas remain inside their property values. Pinned Mermaid splits raw commas into separate styles; the writer protects value delimiters with entity codes.'
        : 'This style contains text outside the supported SVG attribute domain. Source is preserved, but typed editing is unavailable.')
    }
    if (style && style[1]!.split(',').some(id => !portableStyleTarget(id.trim()))) {
      warn(statement, 'state_style_target', 'The style target is preserved in source. Pinned Mermaid accepts only letters, digits, and underscore in style targets, with no quoted alternative; use a portable target for typed editing.')
    }
    const classShorthand = parseClassShorthandStatement(text)
    const classTargets = matchStateClassAssignment(text)?.ids ?? (classShorthand ? [classShorthand.id] : [])
    if (classTargets.some(id => !portableStyleTarget(id))) warn(statement, 'state_class_target', 'Class membership is preserved in source. Pinned Mermaid class assignments require targets containing only letters, digits, or underscore; repair the target before typed class editing.')
    const keyword = /^(cssClass|linkStyle)\s/.exec(text)?.[1]
    if (keyword === 'cssClass') {
      warn(statement, 'state_css_class', '`cssClass` is read as `class`, and written so. Pinned Mermaid\'s State grammar has no `cssClass`: it reads the words of the line as states. Write `class A name`.')
      continue
    }
    if (keyword === 'linkStyle') {
      warn(statement, 'state_link_style', '`linkStyle` paints transitions here, and the writer writes transition paint so. Pinned Mermaid\'s State grammar has no `linkStyle`: it reads the words of the line as states, or rejects them, and draws no transition paint.')
      continue
    }
    const noteLine = matchNoteLine(text)
    const note = noteLine ?? matchNoteOpen(text)
    if (note) {
      noteTextAwaited = noteLine === null
      // Mermaid's NOTE state reads `left of` and `right of` as literals.
      const position = /note\s+(?:left|right)(\s+)of\s/i.exec(physicalLine(statement.line))
      if (position && position[1] !== ' ') {
        warn(statement, 'state_note_position', `The note is read as a note ${note.side} of '${note.target}'. Pinned Mermaid reads \`left of\` and \`right of\` only with one space between the words, and rejects this line. The writer writes one space.`)
      }
      if (note.target.includes('-')) {
        warn(statement, 'state_note_target', `The note is on '${note.target}', which pinned Mermaid cannot read as a note's state: there a state name ends at a hyphen. Mermaid rejects a note whose text follows a colon, and puts a block note on the state named before the hyphen, reading the rest as note text, here and in the output. Rename the state to keep it portable.`)
      }
      // Mermaid's one-line note text (NOTE_TEXT, `":"[^:\n;]+`) ends at
      // any colon or `;`.
      if (noteLine && /[:;]/.test(lexedStateText(noteLine.text))) {
        warn(statement, 'state_note_text_cut', 'A colon or `;` in a one-line note\'s text is read as part of the text. Pinned Mermaid ends a one-line note\'s text at either: it rejects a colon there, and reads the rest of the line from a `;` as further statements. The writer writes the note as a block note.')
      }
      continue
    }
    const transition = matchTransitionLine(text)
    if (transition) {
      if (depth === 0 && transition.label !== undefined && /^acc(?:Title|Descr)$/i.test(transition.to)) {
        warn(statement, 'state_accessibility_endpoint', 'The top-level labeled transition is preserved in source. Pinned Mermaid reads this destination followed by a colon as an accessibility directive; rename the destination or remove the label for typed editing.', statement.toLine)
      }
      for (const endpoint of new Set([transition.from, transition.to])) {
        if (endpoint === PSEUDO || isHistoryEndpoint(endpoint) || hasBareSpelling(endpoint)) continue
        const line = endpoint === transition.from ? statement.line : statement.toLine
        if (namesStateGlued(endpoint)) {
          // With no blank after the name, as the writer writes it, Mermaid reads it.
          if (statement.nameBlanks?.[endpoint === transition.from ? 0 : 1] === false) continue
          warn(statement, 'state_endpoint_name', `The transition names '${endpoint}', which pinned Mermaid cannot read as a state there: before a blank, \`note\`, \`class\`, \`classDef\`, \`style\`, \`scale\` and \`stateDiagram\` start statements of their own, as \`state\` starts a declaration it drops. Mermaid rejects or drops the transition. The writer writes no blank after the name (\`${endpoint}--> …\`, \`… --> ${endpoint}%%\`), which Mermaid reads.`, line)
        } else {
          warn(statement, 'state_endpoint_name', `The transition names '${endpoint}', which pinned Mermaid cannot read as a state there: a name holds no hyphen, and \`default\`, \`click\` and \`href\` start statements of their own. Mermaid rejects the transition, here and in the output. Rename the state to keep it portable.`, line)
        }
      }
      if (transition.label !== undefined) cutText(statement, transition.label)
      continue
    }
    const open = text.match(STATE_COMPOSITE_OPEN_RE)
    if (open) {
      if (open[1] !== undefined) labelComposite(statement, open[2]!)
      continue
    }
    const alias = text.match(STATE_ALIAS_RE)
    if (alias) {
      labelComposite(statement, alias[2]!)
      continue
    }
    // A name alone declares the state, as `A` does.
    if (isStateNodeId(text) && !isConcurrencySeparator(text)) {
      if (!hasBareSpelling(text)) {
        warn(statement, 'state_declaration_name', `The line declares '${text}', which pinned Mermaid cannot read as a state there: a name holds no hyphen, and \`default\`, \`href\` and \`stateDiagram\` start statements of their own, as \`state\` starts a declaration of the name after it, which Mermaid drops. Mermaid rejects the line, or reads it otherwise. The writer declares it as \`state "…" as ${text}\` (a composite as \`state ${text} {\`), which Mermaid reads.`)
      }
      continue
    }
    if (parseClassShorthandStatement(text)) continue
    const description = text.match(STATE_DESCRIPTION_RE)
    if (description) {
      const id = description[1]!
      labelComposite(statement, id)
      // Mermaid reads the name after `state "…" as` to the line's end.
      if (statement.afterAlias) continue
      if (!hasBareSpelling(id)) {
        warn(statement, 'state_description_name', `The description names '${id}', which pinned Mermaid cannot read as a state there: a name holds no hyphen, and \`note\`, \`class\`, \`classDef\`, \`style\`, \`default\`, \`click\`, \`href\`, \`scale\` and \`stateDiagram\` start statements of their own, as \`state\` starts a declaration it drops. Mermaid rejects or drops the description. The writer writes it as \`state "…" as ${id}\`, which Mermaid reads.`)
      }
      cutText(statement, description[2]!)
    }
  }
  return warnings
}

export function verifyOpaqueState(source: string): LayoutWarning[] {
  const directives = new Set<string>()
  let inNote = false
  const lines = source.split(/\r?\n/)
  for (const raw of scanAccessibilityDirectives(lines, stateStatementEnds(lines)).familyLines) {
    const line = stripStateComment(raw)
    if (inNote) {
      if (isNoteEnd(line)) inNote = false
      continue
    }
    if (matchNoteOpen(line)) { inNote = true; continue }
    if (!matchStateLayoutDirective(line)) continue
    directives.add(line)
  }
  return directives.size === 0 ? [] : [{
    code: 'UNSUPPORTED_SYNTAX',
    syntax: 'state_layout_directive',
    message: `State layout directives ${[...directives].map(directive => `"${directive}"`).join(', ')} are preserved in source but have no effect on local rendering; Agentic Mermaid uses its own layout. Typed mutation is unavailable for this preserved source.`,
  }]
}

export function verifyState(body: StateBody, opts: VerifyOptions): LayoutWarning[] {
  const warnings: LayoutWarning[] = []
  if (body.states.length === 0 && body.transitions.length === 0 && (body.notes ?? []).length === 0 && !body.floatingNotes?.length) {
    return [{ code: 'EMPTY_DIAGRAM' }]
  }
  const overflow = labelOverflowCollector(warnings, opts)
  // A transition endpoint may reference ANY state in the tree (cross-boundary
  // transitions to/from composite children are legal mermaid), plus the
  // reserved pseudostate. Collect the full id set once for the misanchor check.
  const known = new Set<string>([PSEUDO])
  collectIds(body.states, known)
  // A history endpoint anchors when its base names a known state (bare [H]
  // anchors to the enclosing composite, so it is always structurally valid).
  const anchors = (endpoint: string): boolean => {
    if (known.has(endpoint)) return true
    const h = endpoint.match(/^([\w\p{L}\p{M}\p{N}-]*)\[H\*?\]$/u)
    if (!h) return false
    return h[1] === '' || known.has(h[1]!)
  }
  // Tier-3 honesty lint (plan §State 2a): history semantics ("re-enter where
  // you left off") are not modeled by any local analysis — announce that the
  // transition is preserved and rendered as the standard (H)/(H*) circle.
  const historyLint = (endpoint: string): void => {
    if (!isHistoryEndpoint(endpoint)) return
    warnings.push({
      code: 'UNSUPPORTED_SYNTAX',
      syntax: 'state_history',
      node: endpoint,
      message: `History pseudostate '${endpoint}' is preserved and rendered as the standard H-circle; history re-entry semantics are not modeled by analysis.`,
    })
  }
  const visit = (states: StateNode[], transitions: StateTransition[]): void => {
    for (const s of states) {
      if (s.label !== undefined) overflow(s.id, s.label)
      if (s.stereotype === 'history' || s.stereotype === 'deep-history') {
        warnings.push({
          code: 'UNSUPPORTED_SYNTAX',
          syntax: 'state_history',
          node: s.id,
          message: `History pseudostate '${s.id}' is preserved and rendered as the standard H-circle; history re-entry semantics are not modeled by analysis.`,
        })
      }
      // P4: bars/diamonds/H-circles are anonymous glyphs (UML + upstream),
      // so an author-written alias label (`state "L" as id <<fork>>`) is
      // preserved in source but never drawn — announce it, don't stay silent.
      if (s.stereotype !== undefined && s.label !== undefined) {
        warnings.push({
          code: 'UNSUPPORTED_SYNTAX',
          syntax: 'state_pseudostate_label',
          node: s.id,
          message: `Pseudostate '${s.id}' carries the label "${s.label}", but ${s.stereotype} pseudostates render as anonymous glyphs (UML convention); the label is preserved in source and not drawn.`,
        })
      }
      if (s.regions) for (const region of s.regions) visit(region.states, region.transitions)
      else if (s.states !== undefined) visit(s.states, s.transitions ?? [])
    }
    transitions.forEach(t => {
      const edge = `${t.from}->${t.to}`
      if (!anchors(t.from) || !anchors(t.to)) {
        warnings.push({
          code: 'EDGE_MISANCHORED', edge,
          from: anchors(t.from) ? t.from : undefined,
          to: anchors(t.to) ? t.to : undefined,
        })
      }
      historyLint(t.from)
      historyLint(t.to)
      // A transition label's LABEL_OVERFLOW is reported once, by verify's
      // graph projection, under the indexed edge id (`A->B#k`) that names it
      // apart from a parallel transition.
    })
  }
  visit(body.states, body.transitions)
  body.notes?.forEach((n, i) => {
    if (!known.has(n.target)) {
      warnings.push({ code: 'EDGE_MISANCHORED', edge: `note#${i}->${n.target}`, from: `note#${i}` })
    }
    overflow(`note#${i}`, n.text)
  })
  for (const note of body.floatingNotes ?? []) overflow(`floating note ${note.id}`, note.text)
  return warnings
}
