// ============================================================================
// State diagram structured body (BUILD-19: promotes the state family from a
// "parses AS flowchart" projection to a dedicated state IR with state-shaped
// ops and a real `asState` narrower).
//
// Modeled grammar (the state parse core, src/state/parse-core.ts, is shared
// with the legacy renderer parser, src/parser.ts parseStateDiagram — one
// grammar, two consumers, so the surfaces cannot drift):
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
// Structured-or-opaque: any non-blank, non-comment line that is NOT one of the
// modeled forms returns null so the caller falls back to a lossless opaque
// body. Deliberately UNMODELED: concurrency separators `--` (regions render
// via the legacy parser, but a structured region model is deferred — repo
// #118 does not list it), `classDef`/`class`/`:::` styling, bare `stateId`
// lines, and composite ids containing hyphens (the legacy composite regex
// rejects them). Each of those keeps the whole body opaque so it round-trips
// verbatim.
//
// Canonical serialization emits state DEFINITIONS before transitions, because
// the legacy parser only applies a `state "…" as id` / `id : …` label when the
// node does not yet exist (definition-before-use); a transition that mentions
// the id first would otherwise pin the label to the bare id. Notes serialize
// LAST (they are annotations over already-declared states).
// ============================================================================

import { unknownOpMessage } from './mutation-ops.ts'
import type {
  StateBody, StateNode, StateNote, StateRegion, StateTransition, StateMutationOp,
  MutationError, Result, LayoutWarning, VerifyOptions,
} from './types.ts'
import { ok, err } from './types.ts'
import { labelOverflowCollector } from './body-utils.ts'
import { normalizeBrTags } from '../multiline-utils.ts'
import {
  matchNoteLine, matchNoteOpen, isNoteEnd, matchStereotypeDecl,
  matchTransitionLine, isConcurrencySeparator, isHistoryEndpoint, matchHistoryEndpoint,
  isStateNodeId, stereotypeMarker,
} from '../state/parse-core.ts'
import { parseClassShorthandStatement } from '../shared/mermaid-identifiers.ts'

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

const DIRECTION_RE = /^direction\s+(TD|TB|LR|BT|RL)$/i
const ALIAS_RE = /^state\s+"([^"]+)"\s+as\s+([\w\p{L}-]+)\s*$/u
const COMPOSITE_OPEN_RE = /^state\s+(?:"([^"]+)"\s+as\s+)?([\w\p{L}-]+)\s*\{$/u
const DESC_RE = /^([\w\p{L}-]+)\s*:\s*(.+)$/u

/** A mutable scope used during parsing — one per composite nesting level. */
interface ParseScope {
  states: StateNode[]
  transitions: StateTransition[]
  byId: Map<string, StateNode>
  direction?: StateNode['direction']
}

function newScope(): ParseScope {
  return { states: [], transitions: [], byId: new Map() }
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
 * EVERY non-blank, non-comment line is a modeled directive (transition /
 * description / alias / composite / direction). Otherwise returns null
 * (opaque fallback). An empty body (no states, no transitions) returns null so
 * the opaque path keeps the header-only diagram lossless.
 */
export function parseStateBody(lines: string[]): StateBody | null {
  const root = newScope()
  const stack: ParseScope[] = [root]
  // Discover composite declarations before materializing transition endpoints.
  // Mermaid state IDs are global even when the declaration is nested, so a
  // forward reference must never create a competing simple placeholder.
  const compositeIds = new Set<string>()
  for (const raw of lines) {
    const match = raw.trim().match(COMPOSITE_OPEN_RE)
    if (!match) continue
    const id = match[2]!
    if (compositeIds.has(id)) return null
    compositeIds.add(id)
  }
  const pendingCompositeLabels = new Map<string, string>()
  // Pending composites awaiting their `}` — parent scope + the node to attach.
  const pending: Array<{ parent: ParseScope; node: StateNode; regions?: ParseScope[] }> = []
  // Paint directives can target forward declarations, so apply them after the
  // complete state tree is known.
  const classDefs: Record<string, Record<string, string>> = {}
  const classAssignments: Array<{ id: string; className: string; scope: ParseScope }> = []
  const inlineStyles: Array<{ id: string; props: Record<string, string>; scope: ParseScope }> = []
  const pendingLinkStyles: Array<{ target: 'default' | number[]; props: Record<string, string> }> = []
  const transitionOrder: StateTransition[] = []
  // Notes, in source order (global list — state ids are global in mermaid).
  const notes: StateNote[] = []
  // Open block note (`note left of X` … `end note`), collecting body lines.
  let openNote: { target: string; side: 'left' | 'right'; lines: string[] } | null = null

  const pushNote = (scope: ParseScope, target: string, side: 'left' | 'right', text: string): void => {
    notes.push({ target, side, text })
    // A note on an undeclared state declares it (mirrors the render parser).
    if (!compositeIds.has(target)) ensureState(scope, target)
  }

  for (const raw of lines) {
    const line = raw.trim()
    if (!line) continue
    if (line.startsWith('%%')) continue

    const scope = stack[stack.length - 1]!

    // --- open block note: collect body lines until `end note` ---
    if (openNote) {
      if (isNoteEnd(line)) {
        pushNote(scope, openNote.target, openNote.side, normalizeBrTags(openNote.lines.join('\n')))
        openNote = null
      } else {
        openNote.lines.push(line)
      }
      continue
    }

    // --- notes (before the ::: gate: note TEXT may legally contain :::) ---
    const noteLine = matchNoteLine(line)
    if (noteLine) {
      pushNote(scope, noteLine.target, noteLine.side, normalizeBrTags(noteLine.text))
      continue
    }
    const noteOpen = matchNoteOpen(line)
    if (noteOpen) {
      openNote = { target: noteOpen.target, side: noteOpen.side, lines: [] }
      continue
    }

    // --- paint directives (shared renderer grammar) ---
    const classDef = line.match(/^classDef\s+([\w,-]+)\s+(.+)$/)
    if (classDef) {
      const props = parseStyleProps(classDef[2]!)
      if (Object.keys(props).length === 0) return null
      for (const name of classDef[1]!.split(',').map(value => value.trim()).filter(Boolean)) classDefs[name] = { ...props }
      continue
    }
    const classLine = line.match(/^(?:class|cssClass)\s+([\w\p{L},-]+)\s+([\w-]+)$/u)
    if (classLine) {
      for (const id of classLine[1]!.split(',').map(value => value.trim()).filter(Boolean)) {
        classAssignments.push({ id, className: classLine[2]!, scope })
      }
      continue
    }
    const styleLine = line.match(/^style\s+([\w\p{L},-]+)\s+(.+)$/u)
    if (styleLine) {
      const props = parseStyleProps(styleLine[2]!)
      if (Object.keys(props).length === 0) return null
      for (const id of styleLine[1]!.split(',').map(value => value.trim()).filter(Boolean)) {
        inlineStyles.push({ id, props: { ...props }, scope })
      }
      continue
    }
    const linkStyle = line.match(/^linkStyle\s+(default|[\d,\s]+)\s+(.+)$/)
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
        const nextRegion = newScope()
        owner.regions = [scope, nextRegion]
        stack[stack.length - 1] = nextRegion
      } else {
        const nextRegion = newScope()
        owner.regions.push(nextRegion)
        stack[stack.length - 1] = nextRegion
      }
      continue
    }

    // --- direction ---
    const dir = line.match(DIRECTION_RE)
    if (dir) {
      scope.direction = dir[1]!.toUpperCase() as StateNode['direction']
      continue
    }

    // --- pseudostate stereotype: `state f1 <<fork>>` (also history forms) ---
    const stereo = matchStereotypeDecl(line)
    if (stereo) {
      if (!isCompositeId(stereo.id) || (compositeIds.has(stereo.id) && !scope.byId.has(stereo.id))) return null
      const node = ensureState(scope, stereo.id)
      node.stereotype = stereo.stereotype
      if (stereo.label !== undefined && node.label === undefined) node.label = normalizeBrTags(stereo.label)
      continue
    }

    // --- composite open: `state X {` / `state "Label" as X {` ---
    const open = line.match(COMPOSITE_OPEN_RE)
    if (open) {
      const id = open[2]!
      if (!isCompositeId(id)) return null
      const label = open[1] !== undefined
        ? normalizeBrTags(open[1]!)
        : pendingCompositeLabels.get(id)
      const child = newScope()
      const node: StateNode = { id, ...(label !== undefined ? { label } : {}), states: child.states, transitions: child.transitions }
      // Reuse any existing node slot (a prior transition may have referenced it),
      // but the legacy parser deletes the simple node and makes it a composite.
      const prior = scope.byId.get(id)
      if (prior) {
        const ix = scope.states.indexOf(prior)
        if (ix >= 0) scope.states.splice(ix, 1, node)
      } else {
        scope.states.push(node)
      }
      scope.byId.set(id, node)
      pending.push({ parent: scope, node })
      stack.push(child)
      continue
    }

    // --- composite close ---
    if (line === '}') {
      if (stack.length <= 1) return null // unbalanced
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
    const alias = line.match(ALIAS_RE)
    if (alias) {
      const id = alias[2]!
      const label = normalizeBrTags(alias[1]!)
      if (compositeIds.has(id) && !scope.byId.has(id)) {
        if (!pendingCompositeLabels.has(id)) pendingCompositeLabels.set(id, label)
      } else {
        const node = ensureState(scope, id)
        // Definition-before-use: only set if not already labeled.
        if (node.label === undefined) node.label = label
      }
      continue
    }

    // --- transition: `from --> to [: label]` (endpoints may be [*]/[H]/X[H]) ---
    const tr = matchTransitionLine(line)
    if (tr) {
      const { from, to } = tr
      const label = tr.label ? normalizeBrTags(tr.label) : undefined
      if (!isEndpointId(from) || !isEndpointId(to)) return null
      if (tr.fromClass) classAssignments.push({ id: from, className: tr.fromClass, scope })
      if (tr.toClass) classAssignments.push({ id: to, className: tr.toClass, scope })
      // Only materialize simple-state nodes for non-pseudo, non-history,
      // non-composite ids (pseudostates are contextual endpoint strings).
      if (from !== PSEUDO && !isHistoryEndpoint(from) && !compositeIds.has(from)) ensureState(scope, from)
      if (to !== PSEUDO && !isHistoryEndpoint(to) && !compositeIds.has(to)) ensureState(scope, to)
      const transition: StateTransition = { from, to, ...(label !== undefined ? { label } : {}) }
      scope.transitions.push(transition)
      transitionOrder.push(transition)
      continue
    }

    // --- standalone class shorthand: `A:::hot` ---
    const shorthand = parseClassShorthandStatement(line)
    if (shorthand) {
      classAssignments.push({ id: shorthand.id, className: shorthand.className, scope })
      continue
    }

    // --- description: `id : Description` ---
    const desc = line.match(DESC_RE)
    if (desc) {
      const id = desc[1]!
      const label = normalizeBrTags(desc[2]!.trim())
      if (compositeIds.has(id) && !scope.byId.has(id)) {
        if (!pendingCompositeLabels.has(id)) pendingCompositeLabels.set(id, label)
      } else {
        const node = ensureState(scope, id)
        if (node.label === undefined) node.label = label
      }
      continue
    }

    // --- standalone state declaration ---
    if (isStateNodeId(line)) {
      const node = ensureState(scope, line)
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
  const stateById = new Map<string, StateNode>()
  const indexStates = (states: StateNode[]): void => {
    for (const state of states) {
      stateById.set(state.id, state)
      if (state.regions) for (const region of state.regions) indexStates(region.states)
      else if (state.states) indexStates(state.states)
    }
  }
  indexStates(root.states)
  const styledState = (scope: ParseScope, id: string): StateNode => {
    const existing = stateById.get(id)
    if (existing) return existing
    const state = ensureState(scope, id)
    state.declaredBare = true
    stateById.set(id, state)
    return state
  }
  for (const { id, className, scope } of classAssignments) styledState(scope, id).className = className
  for (const { id, props, scope } of inlineStyles) {
    const state = styledState(scope, id)
    state.style = { ...state.style, ...props }
  }
  let defaultTransitionStyle: Record<string, string> | undefined
  for (const directive of pendingLinkStyles) {
    if (directive.target === 'default') defaultTransitionStyle = { ...defaultTransitionStyle, ...directive.props }
    else for (const index of directive.target) {
      const transition = transitionOrder[index]
      if (transition) transition.style = { ...transition.style, ...directive.props }
    }
  }

  canonicalizeStateOrder(root.states)
  const body: StateBody = {
    kind: 'state',
    states: root.states,
    transitions: root.transitions,
    ...(notes.length > 0 ? { notes } : {}),
    ...(root.direction !== undefined ? { direction: root.direction } : {}),
    ...(Object.keys(classDefs).length > 0 ? { classDefs } : {}),
    ...(defaultTransitionStyle ? { defaultTransitionStyle } : {}),
  }
  // Header-only / empty bodies stay opaque so they round-trip verbatim.
  if (body.states.length === 0 && body.transitions.length === 0 && notes.length === 0) return null
  return body
}

// ---- Serializer -------------------------------------------------------------

function renderScope(states: StateNode[], transitions: StateTransition[], direction: StateNode['direction'] | undefined, indent: string, out: string[]): void {
  if (direction !== undefined) out.push(`${indent}direction ${direction}`)
  // Definitions first (labels + composites), so the legacy parser applies the
  // label before any transition mentions the id.
  for (const s of states) {
    if (s.states !== undefined || s.transitions !== undefined || s.regions !== undefined) {
      // Composite block (ordinary or `--`-partitioned concurrency regions).
      const header = s.label !== undefined ? `state "${s.label}" as ${s.id} {` : `state ${s.id} {`
      out.push(`${indent}${header}`)
      if (s.regions) {
        if (s.direction !== undefined) out.push(`${indent}  direction ${s.direction}`)
        s.regions.forEach((region, index) => {
          renderScope(region.states, region.transitions, region.direction, indent + '  ', out)
          if (index < s.regions!.length - 1) out.push(`${indent}  --`)
        })
      } else {
        renderScope(s.states ?? [], s.transitions ?? [], s.direction, indent + '  ', out)
      }
      out.push(`${indent}}`)
    } else if (s.stereotype !== undefined) {
      // Pseudostate declaration (fork/join/choice/history) — canonical marker
      // spelling; `<<H>>`/`<<H*>>` shorthands normalize on parse.
      const alias = s.label !== undefined ? `"${s.label}" as ` : ''
      out.push(`${indent}state ${alias}${s.id} ${stereotypeMarker(s.stereotype)}`)
    } else if (s.label !== undefined) {
      out.push(isCompositeId(s.id)
        ? `${indent}state "${s.label}" as ${s.id}`
        : `${indent}${s.id} : ${s.label}`)
    } else if (s.declaredBare) {
      out.push(`${indent}${s.id}`)
    }
    // Implicit transition endpoints need no standalone declaration.
  }
  for (const t of transitions) {
    const label = t.label !== undefined ? ` : ${t.label}` : ''
    out.push(`${indent}${t.from} --> ${t.to}${label}`)
  }
}

export function renderState(body: StateBody): string {
  const out: string[] = ['stateDiagram-v2']
  renderScope(body.states, body.transitions, body.direction, '  ', out)
  // Notes last: single-line form when the text has no line break, block form
  // (`note … end note`) otherwise. Note text is canonical by construction
  // (validNoteText): trimmed lines, no blank lines, no `end note` line.
  for (const n of body.notes ?? []) {
    if (n.text.includes('\n')) {
      out.push(`  note ${n.side} of ${n.target}`)
      for (const line of n.text.split('\n')) out.push(`    ${line}`)
      out.push('  end note')
    } else {
      out.push(`  note ${n.side} of ${n.target} : ${n.text}`)
    }
  }
  const styleText = (style: Record<string, string>): string => Object.entries(style).map(([key, value]) => `${key}:${value}`).join(',')
  for (const [name, style] of Object.entries(body.classDefs ?? {})) out.push(`  classDef ${name} ${styleText(style)}`)
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
    if (state.className) out.push(`  class ${state.id} ${state.className}`)
    if (state.style) out.push(`  style ${state.id} ${styleText(state.style)}`)
  }
  if (body.defaultTransitionStyle) out.push(`  linkStyle default ${styleText(body.defaultTransitionStyle)}`)
  transitions.forEach((transition, index) => {
    if (transition.style) out.push(`  linkStyle ${index} ${styleText(transition.style)}`)
  })
  return out.join('\n') + '\n'
}

// ---- Projection to MermaidGraph (verify / layout / describe) ----------------
//
// State bodies reuse the flowchart geometric verify path: serialize to
// canonical source, parse with the legacy state parser. This is the renderer
// projection — the exact graph the renderer would lay out.

import { parseMermaid as parseLegacy, parseStyleProps } from '../parser.ts'
import { parseMutableStyleProps } from '../shared/style-props.ts'
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
    ...(s.declaredBare ? { declaredBare: true as const } : {}),
    ...(s.stereotype !== undefined ? { stereotype: s.stereotype } : {}),
    ...(s.className !== undefined ? { className: s.className } : {}),
    ...(s.style !== undefined ? { style: { ...s.style } } : {}),
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
    ...(b.direction !== undefined ? { direction: b.direction } : {}),
    ...(b.classDefs !== undefined ? { classDefs: Object.fromEntries(Object.entries(b.classDefs).map(([name, style]) => [name, { ...style }])) } : {}),
    ...(b.defaultTransitionStyle !== undefined ? { defaultTransitionStyle: { ...b.defaultTransitionStyle } } : {}),
  }
}

/** Find a state node by id, searching the whole tree. Returns the node and the
 *  scope (states + transitions arrays) that contains it. */
interface Located { node: StateNode; siblings: StateNode[]; transitions: StateTransition[] }
function locate(body: StateBody, id: string): Located | null {
  const search = (states: StateNode[], transitions: StateTransition[]): Located | null => {
    for (const s of states) {
      if (s.id === id) return { node: s, siblings: states, transitions }
      if (s.regions) {
        for (const region of s.regions) {
          const inner = search(region.states, region.transitions)
          if (inner) return inner
        }
      } else if (s.states !== undefined) {
        const inner = search(s.states, s.transitions ?? [])
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

/** Validate a note side; omitted defaults to 'right' (upstream's most common). */
function validNoteSide(value: unknown): Result<'left' | 'right', MutationError> {
  if (value === undefined || value === null) return ok('right')
  if (value === 'left' || value === 'right') return ok(value)
  return err({ code: 'INVALID_OP', message: `Note side must be "left" or "right", got ${JSON.stringify(value)}` })
}

function isComposite(s: StateNode): boolean {
  return s.states !== undefined || s.transitions !== undefined || s.regions !== undefined
}

function parseStateStyle(style: string, field: string): Result<Record<string, string>, MutationError> {
  const parsed = parseMutableStyleProps(style)
  if (!parsed.ok) {
    const message = parsed.reason === 'NOT_STRING'
      ? `${field} must be a CSS-like style string`
      : parsed.reason === 'MULTILINE'
        ? `${field} must be a single-line CSS-like style string`
        : `${field} must contain at least one property:value pair`
    return err({ code: 'INVALID_OP', message })
  }
  return ok(parsed.value)
}

export function mutateState(body: StateBody, op: StateMutationOp): Result<StateBody, MutationError> {
  const next = cloneStateBody(body)

  switch (op.kind) {
    case 'add_state': {
      const id = validId(op.id, 'state id')
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
        scope.value.states.push(node)
      } else {
        if (op.region !== undefined) return err({ code: 'INVALID_OP', message: 'add_state.region requires a composite parent' })
        next.states.push(node)
      }
      break
    }
    case 'remove_state': {
      const loc = locate(next, op.id)
      if (!loc) return err({ code: 'STATE_NOT_FOUND', message: `State '${op.id}' not found` })
      const nonEmpty = isComposite(loc.node) && compositeScopes(loc.node).some(scope => scope.states.length > 0 || scope.transitions.length > 0)
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
      for (const id of removedIds) cascadeRemoveTransitions(next, id)
      if (next.notes) {
        next.notes = next.notes.filter(n => !removedIds.has(n.target))
        if (next.notes.length === 0) delete next.notes
      }
      break
    }
    case 'rename_state': {
      const to = validId(op.to, 'rename target')
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
      break
    }
    case 'set_state_label': {
      const loc = locate(next, op.id)
      if (!loc) return err({ code: 'STATE_NOT_FOUND', message: `State '${op.id}' not found` })
      if (op.label === null) { delete loc.node.label; loc.node.declaredBare = true; break }
      const l = validLabel(op.label, 'label')
      if (!l.ok) return l
      loc.node.label = l.value
      break
    }
    case 'add_transition': {
      const from = validEndpoint(op.from, 'transition from')
      if (!from.ok) return from
      const to = validEndpoint(op.to, 'transition to')
      if (!to.ok) return to
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
        list.splice(op.index, 1)
        break
      }
      if (op.from !== undefined && op.to !== undefined) {
        const ix = list.findIndex(t => t.from === op.from && t.to === op.to)
        if (ix < 0) return err({ code: 'TRANSITION_NOT_FOUND', message: `No transition ${op.from} --> ${op.to}` })
        list.splice(ix, 1)
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
        targetScope.value.states.push(loc.node)
      } else {
        if (op.region !== undefined) return err({ code: 'INVALID_OP', message: 'move_state.region requires a composite parent' })
        if (loc.siblings === next.states) break // already top-level — no-op
        loc.siblings.splice(loc.siblings.indexOf(loc.node), 1)
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
      loc.siblings.splice(ix, 1, ...scopes.flatMap(scope => scope.states))
      loc.transitions.push(...scopes.flatMap(scope => scope.transitions))
      break
    }
    case 'add_note': {
      if (typeof op.target !== 'string' || !isStateNodeId(op.target)) {
        return err({ code: 'INVALID_OP', message: 'State note target must be an ordinary state identifier (letters, digits, underscore, or hyphen)' })
      }
      const target = op.target
      if (!locate(next, target)) return err({ code: 'STATE_NOT_FOUND', message: `State '${target}' not found` })
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
      break
    }
    case 'define_class': {
      if (typeof op.name !== 'string' || !/^[\w-]+$/.test(op.name)) {
        return err({ code: 'INVALID_OP', message: 'State class name must contain only letters, digits, underscore, or hyphen' })
      }
      const style = parseStateStyle(op.style, 'State class style')
      if (!style.ok) return style
      if (!next.classDefs) next.classDefs = {}
      next.classDefs[op.name] = style.value
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
      if (op.style === null) { delete loc.node.style; break }
      const style = parseStateStyle(op.style, 'State inline style')
      if (!style.ok) return style
      loc.node.style = style.value
      break
    }
    case 'set_transition_style': {
      if (op.default === true) {
        if (op.index !== undefined || op.parent !== undefined || op.region !== undefined) return err({ code: 'INVALID_OP', message: 'Default transition style is diagram-wide; omit index, parent, and region' })
        if (op.style === null) delete next.defaultTransitionStyle
        else {
          const style = parseStateStyle(op.style, 'State transition style')
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
        const style = parseStateStyle(op.style, 'State transition style')
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

  preserveOrphanedImplicitStates(next)
  canonicalizeStateOrder(next.states)
  return ok(next)
}

/**
 * Transition endpoints are allowed to introduce states implicitly, but an
 * implicit state has no standalone serializer form. If a mutation removes its
 * last transition, promote the surviving state to a bare declaration before
 * serialization so the typed body cannot silently lose it on reparse.
 */
function preserveOrphanedImplicitStates(body: StateBody): void {
  const referenced = new Set<string>()
  const collectReferences = (states: StateNode[], transitions: StateTransition[]): void => {
    for (const transition of transitions) {
      referenced.add(transition.from)
      referenced.add(transition.to)
    }
    for (const state of states) {
      if (state.regions) {
        for (const region of state.regions) collectReferences(region.states, region.transitions)
      } else if (state.states) {
        collectReferences(state.states, state.transitions ?? [])
      }
    }
  }
  collectReferences(body.states, body.transitions)

  const promote = (states: StateNode[]): void => {
    for (const state of states) {
      if (
        state.label === undefined
        && !state.declaredBare
        && state.stereotype === undefined
        && !isComposite(state)
        && !referenced.has(state.id)
      ) state.declaredBare = true
      if (state.regions) {
        for (const region of state.regions) promote(region.states)
      } else if (state.states) {
        promote(state.states)
      }
    }
  }
  promote(body.states)
}

/** Match the serializer's definitions-before-transitions order so structured
 * bodies are canonical before they leave parse/mutate, not only after a
 * serialize/reparse cycle. */
function canonicalizeStateOrder(states: StateNode[]): void {
  for (const state of states) {
    if (state.regions) for (const region of state.regions) canonicalizeStateOrder(region.states)
    else if (state.states) canonicalizeStateOrder(state.states)
  }
  const declared = states.filter(state => state.label !== undefined || state.declaredBare || state.stereotype !== undefined || isComposite(state))
  const implicit = states.filter(state => state.label === undefined && !state.declaredBare && state.stereotype === undefined && !isComposite(state))
  states.splice(0, states.length, ...declared, ...implicit)
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

/** Remove every transition (any nesting level) that touches `id`. */
function cascadeRemoveTransitions(body: StateBody, id: string): void {
  const walk = (states: StateNode[], transitions: StateTransition[]): StateTransition[] => {
    const kept = transitions.filter(t => !endpointTouches(t.from, id) && !endpointTouches(t.to, id))
    for (const s of states) {
      if (s.regions) for (const region of s.regions) region.transitions = walk(region.states, region.transitions)
      else if (s.states !== undefined) s.transitions = walk(s.states, s.transitions ?? [])
    }
    return kept
  }
  body.transitions = walk(body.states, body.transitions)
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

export function verifyState(body: StateBody, opts: VerifyOptions): LayoutWarning[] {
  const warnings: LayoutWarning[] = []
  if (body.states.length === 0 && body.transitions.length === 0 && (body.notes ?? []).length === 0) {
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
    const h = endpoint.match(/^([\w\p{L}-]*)\[H\*?\]$/u)
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
      if (t.label !== undefined) overflow(edge, t.label)
    })
  }
  visit(body.states, body.transitions)
  body.notes?.forEach((n, i) => {
    if (!known.has(n.target)) {
      warnings.push({ code: 'EDGE_MISANCHORED', edge: `note#${i}->${n.target}`, from: `note#${i}` })
    }
    overflow(`note#${i}`, n.text)
  })
  return warnings
}
