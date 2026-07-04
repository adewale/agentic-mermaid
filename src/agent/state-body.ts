// ============================================================================
// State diagram structured body (BUILD-19: promotes the state family from a
// "parses AS flowchart" projection to a dedicated state IR with state-shaped
// ops and a real `asState` narrower).
//
// Modeled grammar (mirrors the legacy renderer parser, src/parser.ts
// parseStateDiagram — probed empirically, see BUILD-19 notes):
//   stateDiagram-v2 | stateDiagram
//   state "Description" as id            — aliased simple state
//   id : Description                     — bare state description
//   from --> to [: label]                — transition (from/to may be `[*]`)
//   [*] --> id                           — start pseudostate (source)
//   id --> [*]                           — end pseudostate (target)
//   state Composite { … }                — composite block (nestable)
//   state "Label" as Composite { … }     — aliased composite block
//   direction TD|TB|LR|BT|RL             — top-level or per-composite direction
//
// `[*]` is NOT a state node: it is modeled CONTEXTUALLY as the reserved
// endpoint id '[*]' on transitions, scoped per composite level — exactly as
// the legacy parser disambiguates ([*] as a transition SOURCE = start
// pseudostate, as a TARGET = end pseudostate). This avoids inventing the
// `_start`/`_end` synthetic ids the flowchart projection produced.
//
// Structured-or-opaque: any non-blank, non-comment line that is NOT one of the
// modeled forms returns null so the caller falls back to a lossless opaque
// body. Deliberately UNMODELED (the legacy parser silently DROPS these, so a
// structured model would be lossy): `<<fork>>/<<choice>>/<<join>>` markers,
// history states, concurrency separators `--`, notes (`note … / end note`),
// `classDef`/`class`/`:::` styling, bare `stateId` lines, and composite ids
// containing hyphens (the legacy composite regex rejects them). Each of those
// keeps the whole body opaque so it round-trips verbatim.
//
// Canonical serialization emits state DEFINITIONS before transitions, because
// the legacy parser only applies a `state "…" as id` / `id : …` label when the
// node does not yet exist (definition-before-use); a transition that mentions
// the id first would otherwise pin the label to the bare id.
// ============================================================================

import type {
  StateBody, StateNode, StateTransition, StateMutationOp,
  MutationError, Result, LayoutWarning, VerifyOptions,
} from './types.ts'
import { ok, err, DEFAULT_LABEL_CHAR_CAP } from './types.ts'
import { labelOverflowWarning } from './label-metrics.ts'
import { normalizeBrTags } from '../multiline-utils.ts'

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
  return id === PSEUDO || ENDPOINT_ID_RE.test(id)
}

// ---- Parser -----------------------------------------------------------------

const DIRECTION_RE = /^direction\s+(TD|TB|LR|BT|RL)$/i
const ALIAS_RE = /^state\s+"([^"]+)"\s+as\s+([\w\p{L}]+)\s*$/u
const COMPOSITE_OPEN_RE = /^state\s+(?:"([^"]+)"\s+as\s+)?([\w\p{L}]+)\s*\{$/u
const TRANSITION_RE = /^(\[\*\]|[\w\p{L}-]+)\s*-->\s*(\[\*\]|[\w\p{L}-]+)(?:\s*:\s*(.+))?$/u
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

  for (const raw of lines) {
    const line = raw.trim()
    if (!line) continue
    if (line.startsWith('%%')) continue

    const scope = stack[stack.length - 1]!

    // `:::` is class-assignment shorthand (e.g. `A:::cls`) — unmodeled styling.
    // The legacy parser turns it into a lossy label, so keep the body opaque.
    if (line.includes(':::')) return null

    // --- direction ---
    const dir = line.match(DIRECTION_RE)
    if (dir) {
      scope.direction = dir[1]!.toUpperCase() as StateNode['direction']
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

    // --- transition: `from --> to [: label]` ---
    const tr = line.match(TRANSITION_RE)
    if (tr) {
      const from = tr[1]!
      const to = tr[2]!
      const rawLabel = tr[3]?.trim()
      const label = rawLabel ? normalizeBrTags(rawLabel) : undefined
      if (!isEndpointId(from) || !isEndpointId(to)) return null
      // Only materialize simple-state nodes for non-pseudo, non-composite ids.
      if (from !== PSEUDO && !compositeIds.has(from)) ensureState(scope, from)
      if (to !== PSEUDO && !compositeIds.has(to)) ensureState(scope, to)
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

  // Unbalanced composite braces → opaque.
  if (stack.length !== 1) return null

  const body: StateBody = {
    kind: 'state',
    states: root.states,
    transitions: root.transitions,
    ...(root.direction !== undefined ? { direction: root.direction } : {}),
  }
  // Header-only / empty bodies stay opaque so they round-trip verbatim.
  if (body.states.length === 0 && body.transitions.length === 0) return null
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

/** Validate a transition endpoint: a state id or the reserved '[*]'. */
function validEndpoint(value: unknown, field: string): Result<string, MutationError> {
  if (value === PSEUDO) return ok(PSEUDO)
  return validId(value, field)
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
      if (isComposite(loc.node) && (loc.node.states!.length > 0 || loc.node.transitions!.length > 0)) {
        return err({ code: 'INVALID_OP', message: `Refusing to remove non-empty composite '${op.id}'; remove its children first` })
      }
      const ix = loc.siblings.indexOf(loc.node)
      loc.siblings.splice(ix, 1)
      // Cascade: drop every transition (at any level) touching the removed id.
      cascadeRemoveTransitions(next, op.id)
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
      return err({ code: 'INVALID_OP', message: `Unknown op: ${JSON.stringify(_x)}` })
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

/** Remove every transition (any nesting level) that touches `id`. */
function cascadeRemoveTransitions(body: StateBody, id: string): void {
  const walk = (states: StateNode[], transitions: StateTransition[]): StateTransition[] => {
    const kept = transitions.filter(t => t.from !== id && t.to !== id)
    for (const s of states) {
      if (s.states !== undefined) s.transitions = walk(s.states, s.transitions ?? [])
    }
    return kept
  }
  body.transitions = walk(body.states, body.transitions)
}

/** Rewrite `from`→`to` in every transition (any nesting level). */
function renameInTransitions(body: StateBody, from: string, to: string): void {
  const walk = (states: StateNode[], transitions: StateTransition[]): void => {
    for (const t of transitions) {
      if (t.from === from) t.from = to
      if (t.to === from) t.to = to
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
  if (body.states.length === 0 && body.transitions.length === 0) {
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
  const visit = (states: StateNode[], transitions: StateTransition[]): void => {
    for (const s of states) {
      if (s.label !== undefined) overflow(s.id, s.label)
      if (s.states !== undefined) visit(s.states, s.transitions ?? [])
    }
    transitions.forEach(t => {
      const edge = `${t.from}->${t.to}`
      if (!known.has(t.from) || !known.has(t.to)) {
        warnings.push({
          code: 'EDGE_MISANCHORED', edge,
          from: known.has(t.from) ? t.from : undefined,
          to: known.has(t.to) ? t.to : undefined,
        })
      }
      if (t.label !== undefined) overflow(edge, t.label)
    })
  }
  visit(body.states, body.transitions)
  return warnings
}
