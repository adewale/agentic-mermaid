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
  StateBody, StateNode, StateNote, StateTransition, StateMutationOp,
  MutationError, Result, LayoutWarning, VerifyOptions,
} from './types.ts'
import { ok, err, DEFAULT_LABEL_CHAR_CAP } from './types.ts'
import { labelOverflowWarning } from './label-metrics.ts'
import { normalizeBrTags } from '../multiline-utils.ts'
import {
  matchNoteLine, matchNoteOpen, isNoteEnd, matchStereotypeDecl,
  matchTransitionLine, isHistoryEndpoint, stereotypeMarker,
} from '../state/parse-core.ts'

// ---- Identifiers ------------------------------------------------------------
//
// The reserved pseudostate endpoint. Mirrors mermaid's `[*]`.
export const PSEUDO = '[*]'

// Composite ids: the legacy composite regex is `[\w\p{L}]+` (NO hyphen).
const COMPOSITE_ID_RE = /^[\w\p{L}]+$/u
// Transition / description endpoint ids allow hyphens: `[\w\p{L}-]+`.
const ENDPOINT_ID_RE = /^[\w\p{L}-]+$/u

function isCompositeId(id: string): boolean {
  return COMPOSITE_ID_RE.test(id)
}
function isEndpointId(id: string): boolean {
  return id === PSEUDO || isHistoryEndpoint(id) || ENDPOINT_ID_RE.test(id)
}

// ---- Parser -----------------------------------------------------------------

const DIRECTION_RE = /^direction\s+(TD|TB|LR|BT|RL)$/i
const ALIAS_RE = /^state\s+"([^"]+)"\s+as\s+([\w\p{L}]+)\s*$/u
const COMPOSITE_OPEN_RE = /^state\s+(?:"([^"]+)"\s+as\s+)?([\w\p{L}]+)\s*\{$/u
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
  // Track composite ids so transitions referencing a composite don't create a
  // duplicate simple node (mirrors legacy compositeStateIds).
  const compositeIds = new Set<string>()
  // Pending composites awaiting their `}` — parent scope + the node to attach.
  const pending: Array<{ parent: ParseScope; node: StateNode }> = []
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
        pushNote(scope, openNote.target, openNote.side, openNote.lines.join('\n'))
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

    // `:::` is class-assignment shorthand (e.g. `A:::cls`) — unmodeled styling.
    // The legacy parser turns it into a lossy label, so keep the body opaque.
    if (line.includes(':::')) return null

    // --- direction ---
    const dir = line.match(DIRECTION_RE)
    if (dir) {
      scope.direction = dir[1]!.toUpperCase() as StateNode['direction']
      continue
    }

    // --- pseudostate stereotype: `state f1 <<fork>>` (also history forms) ---
    const stereo = matchStereotypeDecl(line)
    if (stereo) {
      if (!isCompositeId(stereo.id)) return null
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
      const label = open[1] !== undefined ? normalizeBrTags(open[1]!) : undefined
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
      compositeIds.add(id)
      pending.push({ parent: scope, node })
      stack.push(child)
      continue
    }

    // --- composite close ---
    if (line === '}') {
      if (stack.length <= 1) return null // unbalanced
      const child = stack.pop()!
      const top = pending.pop()!
      // Sync the captured arrays + direction onto the node.
      top.node.states = child.states
      top.node.transitions = child.transitions
      if (child.direction !== undefined) top.node.direction = child.direction
      continue
    }

    // --- alias: `state "Description" as id` ---
    const alias = line.match(ALIAS_RE)
    if (alias) {
      const id = alias[2]!
      const label = normalizeBrTags(alias[1]!)
      const node = ensureState(scope, id)
      // Definition-before-use: only set if not already labeled.
      if (node.label === undefined) node.label = label
      continue
    }

    // --- transition: `from --> to [: label]` (endpoints may be [*]/[H]/X[H]) ---
    const tr = matchTransitionLine(line)
    if (tr) {
      const { from, to } = tr
      const label = tr.label ? normalizeBrTags(tr.label) : undefined
      if (!isEndpointId(from) || !isEndpointId(to)) return null
      // Only materialize simple-state nodes for non-pseudo, non-history,
      // non-composite ids (pseudostates are contextual endpoint strings).
      if (from !== PSEUDO && !isHistoryEndpoint(from) && !compositeIds.has(from)) ensureState(scope, from)
      if (to !== PSEUDO && !isHistoryEndpoint(to) && !compositeIds.has(to)) ensureState(scope, to)
      scope.transitions.push({ from, to, ...(label !== undefined ? { label } : {}) })
      continue
    }

    // --- description: `id : Description` ---
    const desc = line.match(DESC_RE)
    if (desc) {
      const id = desc[1]!
      const label = normalizeBrTags(desc[2]!.trim())
      const node = ensureState(scope, id)
      if (node.label === undefined) node.label = label
      continue
    }

    // Unmodeled line → opaque.
    return null
  }

  // Unbalanced composite braces / unterminated block note → opaque.
  if (stack.length !== 1) return null
  if (openNote) return null

  const body: StateBody = {
    kind: 'state',
    states: root.states,
    transitions: root.transitions,
    ...(notes.length > 0 ? { notes } : {}),
    ...(root.direction !== undefined ? { direction: root.direction } : {}),
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
    if (s.states !== undefined || s.transitions !== undefined) {
      // Composite block.
      const header = s.label !== undefined ? `state "${s.label}" as ${s.id} {` : `state ${s.id} {`
      out.push(`${indent}${header}`)
      renderScope(s.states ?? [], s.transitions ?? [], s.direction, indent + '  ', out)
      out.push(`${indent}}`)
    } else if (s.stereotype !== undefined) {
      // Pseudostate declaration (fork/join/choice/history) — canonical marker
      // spelling; `<<H>>`/`<<H*>>` shorthands normalize on parse.
      const alias = s.label !== undefined ? `"${s.label}" as ` : ''
      out.push(`${indent}state ${alias}${s.id} ${stereotypeMarker(s.stereotype)}`)
    } else if (s.label !== undefined) {
      out.push(`${indent}state "${s.label}" as ${s.id}`)
    }
    // Bare simple states with no label are emitted implicitly via transitions;
    // a state that appears in no transition AND has no label is unreachable in
    // the legacy renderer (a bare `stateId` line is dropped) — so we do not
    // emit a standalone line for it.
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
  return out.join('\n') + '\n'
}

// ---- Projection to MermaidGraph (verify / layout / describe) ----------------
//
// State bodies reuse the flowchart geometric verify path: serialize to
// canonical source, parse with the legacy state parser. This is the renderer
// projection — the exact graph the renderer would lay out.

import { parseMermaid as parseLegacy } from '../parser.ts'
import type { MermaidGraph } from '../types.ts'

export function stateBodyToGraph(body: StateBody): MermaidGraph {
  return parseLegacy(renderState(body))
}

// ---- Mutator ----------------------------------------------------------------

function cloneState(s: StateNode): StateNode {
  return {
    id: s.id,
    ...(s.label !== undefined ? { label: s.label } : {}),
    ...(s.stereotype !== undefined ? { stereotype: s.stereotype } : {}),
    ...(s.direction !== undefined ? { direction: s.direction } : {}),
    ...(s.states !== undefined ? { states: s.states.map(cloneState) } : {}),
    ...(s.transitions !== undefined ? { transitions: s.transitions.map(t => ({ ...t })) } : {}),
  }
}

function cloneStateBody(b: StateBody): StateBody {
  return {
    kind: 'state',
    states: b.states.map(cloneState),
    transitions: b.transitions.map(t => ({ ...t })),
    ...(b.notes !== undefined ? { notes: b.notes.map(n => ({ ...n })) } : {}),
    ...(b.direction !== undefined ? { direction: b.direction } : {}),
  }
}

/** Find a state node by id, searching the whole tree. Returns the node and the
 *  scope (states + transitions arrays) that contains it. */
interface Located { node: StateNode; siblings: StateNode[]; transitions: StateTransition[] }
function locate(body: StateBody, id: string): Located | null {
  const search = (states: StateNode[], transitions: StateTransition[]): Located | null => {
    for (const s of states) {
      if (s.id === id) return { node: s, siblings: states, transitions }
      if (s.states !== undefined) {
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
    if (s.states !== undefined) collectIds(s.states, into)
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

/** Validate a transition endpoint: a state id, the reserved '[*]', or a
 *  history reference (`[H]`, `[H*]`, `Base[H]`, `Base[H*]`). */
function validEndpoint(value: unknown, field: string): Result<string, MutationError> {
  if (value === PSEUDO) return ok(PSEUDO)
  if (typeof value === 'string' && isHistoryEndpoint(value)) return ok(value)
  return validId(value, field)
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
  return s.states !== undefined || s.transitions !== undefined
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
      const node: StateNode = { id: id.value, ...(label !== undefined ? { label } : {}) }
      if (op.parent !== undefined && op.parent !== null) {
        const loc = locate(next, op.parent)
        if (!loc) return err({ code: 'STATE_NOT_FOUND', message: `Parent state '${op.parent}' not found` })
        if (!isComposite(loc.node)) {
          // Promote the simple parent into a composite.
          loc.node.states = []
          loc.node.transitions = []
        }
        loc.node.states!.push(node)
      } else {
        next.states.push(node)
      }
      break
    }
    case 'remove_state': {
      const loc = locate(next, op.id)
      if (!loc) return err({ code: 'STATE_NOT_FOUND', message: `State '${op.id}' not found` })
      const nonEmpty = isComposite(loc.node) && (loc.node.states!.length > 0 || loc.node.transitions!.length > 0)
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
      if (op.label === null) { delete loc.node.label; break }
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
      // Endpoints that are not '[*]' must reference an existing state at the
      // top level (mirrors flowchart add_edge requiring known nodes), unless we
      // auto-create. We auto-create simple top-level states for unknown ids so
      // `add_transition` is ergonomic like the flowchart idiom.
      const scope = resolveScope(next, op.parent)
      if (!scope.ok) return scope
      const target = scope.value
      let label: string | undefined
      if (op.label !== undefined && op.label !== null) {
        const l = validLabel(op.label, 'transition label')
        if (!l.ok) return l
        label = l.value
      }
      ensureSimpleInScope(next, target, from.value)
      ensureSimpleInScope(next, target, to.value)
      target.transitions.push({ from: from.value, to: to.value, ...(label !== undefined ? { label } : {}) })
      break
    }
    case 'remove_transition': {
      const scope = resolveScope(next, op.parent)
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
      const scope = resolveScope(next, op.parent)
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
        const parentLoc = locate(next, op.parent)
        if (!parentLoc) return err({ code: 'STATE_NOT_FOUND', message: `Parent state '${op.parent}' not found` })
        // Detach, then attach (transitions stay where they are — state ids
        // are global in mermaid, so cross-boundary transitions remain legal).
        loc.siblings.splice(loc.siblings.indexOf(loc.node), 1)
        if (!isComposite(parentLoc.node)) {
          // Promote the simple parent into a composite (add_state convention).
          parentLoc.node.states = []
          parentLoc.node.transitions = []
        }
        parentLoc.node.states!.push(loc.node)
      } else {
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
      loc.siblings.splice(ix, 1, ...(loc.node.states ?? []))
      loc.transitions.push(...(loc.node.transitions ?? []))
      break
    }
    case 'add_note': {
      const target = validId(op.target, 'note target')
      if (!target.ok) return target
      if (!locate(next, target.value)) return err({ code: 'STATE_NOT_FOUND', message: `State '${target.value}' not found` })
      const side = validNoteSide(op.side)
      if (!side.ok) return side
      const text = validNoteText(op.text)
      if (!text.ok) return text
      if (!next.notes) next.notes = []
      next.notes.push({ target: target.value, side: side.value, text: text.value })
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

  return ok(next)
}

/** Resolve the scope (states+transitions) named by `parent`, or the root. */
function resolveScope(body: StateBody, parent: string | null | undefined): Result<{ states: StateNode[]; transitions: StateTransition[] }, MutationError> {
  if (parent === undefined || parent === null) return ok({ states: body.states, transitions: body.transitions })
  const loc = locate(body, parent)
  if (!loc) return err({ code: 'STATE_NOT_FOUND', message: `Composite '${parent}' not found` })
  if (!isComposite(loc.node)) {
    loc.node.states = []
    loc.node.transitions = []
  }
  return ok({ states: loc.node.states!, transitions: loc.node.transitions! })
}

/** Auto-create a simple state for a non-pseudo endpoint absent from the scope. */
function ensureSimpleInScope(body: StateBody, scope: { states: StateNode[] }, id: string): void {
  if (id === PSEUDO) return
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
      if (s.states !== undefined) s.transitions = walk(s.states, s.transitions ?? [])
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
    for (const s of states) if (s.states !== undefined) walk(s.states, s.transitions ?? [])
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
    for (const s of states) if (s.states !== undefined) walk(s.states, s.transitions ?? [])
  }
  walk(body.states, body.transitions)
}

// ---- Verifier (FamilyPlugin.verify hook) — structural Tier 1 on the body ----
//
// The geometric Tier 2 checks (NODE_OVERLAP / ROUTE_SELF_CROSS) run in verify.ts
// via the graph projection. This hook adds the body-level structural checks:
// EMPTY_DIAGRAM, EDGE_MISANCHORED (transition endpoint references a missing
// state), and LABEL_OVERFLOW.

export function verifyState(body: StateBody, opts: VerifyOptions): LayoutWarning[] {
  const cap = opts.labelCharCap ?? DEFAULT_LABEL_CHAR_CAP
  const warnings: LayoutWarning[] = []
  if (body.states.length === 0 && body.transitions.length === 0 && (body.notes ?? []).length === 0) {
    return [{ code: 'EMPTY_DIAGRAM' }]
  }
  const overflow = (target: string, text: string) => {
    const w = labelOverflowWarning(target, text, cap)
    if (w) warnings.push(w)
  }
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
      if (s.states !== undefined) visit(s.states, s.transitions ?? [])
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
