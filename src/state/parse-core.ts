// ============================================================================
// State-diagram parse core — the ONE note/pseudostate grammar (plan §State 1-2,
// repo #118). Two consumers: the render parser (src/parser.ts
// parseStateDiagram) and the structured agent body (src/agent/state-body.ts).
// The class/journey parse-core precedent: a construct is modeled here once, so
// the renderer and the agent surface cannot drift on what a line means.
//
// Modeled constructs:
//   note left|right of X : text          — single-line note
//   note left|right of X … end note     — block note (body joined with \n)
//   state X <<fork|join|choice>>         — pseudostate stereotype declaration
//   state X <<history|H|deephistory|H*>> — history declaration (PR #5700 forms)
//   from --> to where either endpoint is [H] / [H*] / Base[H] / Base[H*]
//   --                                   — concurrency region separator
// ============================================================================

export type StateNoteSide = 'left' | 'right'

export interface StateNoteLineMatch {
  target: string
  side: StateNoteSide
  text: string
}

export interface StateNoteOpenMatch {
  target: string
  side: StateNoteSide
}

/** Canonical stereotype ids. `<<H>>` normalizes to 'history', `<<H*>>` and
 *  `<<deephistory>>` to 'deep-history' (PR #5700 accepts all four spellings). */
export type StateStereotype = 'fork' | 'join' | 'choice' | 'history' | 'deep-history'

export interface StateStereotypeMatch {
  id: string
  stereotype: StateStereotype
  /** Quoted alias label (`state "Label" as id <<choice>>`), when present. */
  label?: string
}

const NOTE_LINE_RE = /^note\s+(left|right)\s+of\s+([\w\p{L}-]+)\s*:\s*(.+)$/iu
const NOTE_OPEN_RE = /^note\s+(left|right)\s+of\s+([\w\p{L}-]+)\s*$/iu
const NOTE_END_RE = /^end\s+note$/i
const STEREOTYPE_RE = /^state\s+(?:"([^"]+)"\s+as\s+)?([\w\p{L}]+)\s*<<\s*(fork|join|choice|history|deephistory|H\*|H)\s*>>$/u
const SEPARATOR_RE = /^-{2,}$/
/** History transition endpoints: bare `[H]`/`[H*]` or suffixed `Base[H]`/`Base[H*]`. */
const HISTORY_ENDPOINT_RE = /^([\w\p{L}-]*)\[(H\*?)\]$/u
const STATE_NODE_ID_RE = /^[\w\p{L}-]+$/u

/** Ordinary simple-state/note identifier grammar (hyphens allowed). */
export function isStateNodeId(id: string): boolean {
  return STATE_NODE_ID_RE.test(id)
}

/** `note left|right of X : text` — single-line note. */
export function matchNoteLine(line: string): StateNoteLineMatch | null {
  const m = line.match(NOTE_LINE_RE)
  if (!m) return null
  return { side: m[1]!.toLowerCase() as StateNoteSide, target: m[2]!, text: m[3]!.trim() }
}

/** `note left|right of X` — opens a block note terminated by `end note`. */
export function matchNoteOpen(line: string): StateNoteOpenMatch | null {
  const m = line.match(NOTE_OPEN_RE)
  if (!m) return null
  return { side: m[1]!.toLowerCase() as StateNoteSide, target: m[2]! }
}

/** `end note` — closes a block note. */
export function isNoteEnd(line: string): boolean {
  return NOTE_END_RE.test(line)
}

/** `state X <<fork>>` (optionally `state "Label" as X <<…>>`). */
export function matchStereotypeDecl(line: string): StateStereotypeMatch | null {
  const m = line.match(STEREOTYPE_RE)
  if (!m) return null
  const raw = m[3]!
  const stereotype: StateStereotype =
    raw === 'H' || raw === 'history' ? 'history'
    : raw === 'H*' || raw === 'deephistory' ? 'deep-history'
    : (raw as StateStereotype)
  return { id: m[2]!, stereotype, ...(m[1] !== undefined ? { label: m[1] } : {}) }
}

/** `--` — concurrency region separator inside a composite. */
export function isConcurrencySeparator(line: string): boolean {
  return SEPARATOR_RE.test(line)
}

export interface HistoryEndpointMatch {
  /** The composite the history belongs to; '' for a bare `[H]` (enclosing scope). */
  base: string
  deep: boolean
}

/** `[H]`, `[H*]`, `Base[H]`, `Base[H*]` as a transition endpoint. */
export function matchHistoryEndpoint(endpoint: string): HistoryEndpointMatch | null {
  const m = endpoint.match(HISTORY_ENDPOINT_RE)
  if (!m) return null
  return { base: m[1]!, deep: m[2] === 'H*' }
}

/** Display label for a history pseudostate node. */
export function historyLabel(deep: boolean): 'H' | 'H*' {
  return deep ? 'H*' : 'H'
}

/** Transition-line matcher shared by both parsers. Endpoints accept `[*]`,
 *  plain ids, and the history forms. Returns null when the line is not a
 *  transition. */
const TRANSITION_ENDPOINT = String.raw`\[\*\]|[\w\p{L}-]+\[H\*?\]|\[H\*?\]|[\w\p{L}-]+`
const TRANSITION_RE = new RegExp(
  `^(${TRANSITION_ENDPOINT})(?::::([\\w-]+))?\\s*-->\\s*(${TRANSITION_ENDPOINT})(?::::([\\w-]+))?(?:\\s*:\\s*(.+))?$`,
  'u',
)

export interface StateTransitionMatch {
  from: string
  to: string
  fromClass?: string
  toClass?: string
  label?: string
}

export function matchTransitionLine(line: string): StateTransitionMatch | null {
  const m = line.match(TRANSITION_RE)
  if (!m) return null
  const rawLabel = m[5]?.trim()
  return {
    from: m[1]!,
    ...(m[2] ? { fromClass: m[2] } : {}),
    to: m[3]!,
    ...(m[4] ? { toClass: m[4] } : {}),
    ...(rawLabel ? { label: rawLabel } : {}),
  }
}

/** True when a transition endpoint is a history reference. */
export function isHistoryEndpoint(endpoint: string): boolean {
  return HISTORY_ENDPOINT_RE.test(endpoint)
}

/** Canonical serialized form of a stereotype declaration. */
export function stereotypeMarker(stereotype: StateStereotype): string {
  return stereotype === 'deep-history' ? '<<deephistory>>' : `<<${stereotype}>>`
}
