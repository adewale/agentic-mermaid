// ============================================================================
// Sequence structured body: parse / serialize / mutate (FamilyPlugin hooks).
//
// BUILD-18 — segment-preserving structured body. The v4 "all-or-nothing opaque
// cliff" is gone: a sequence diagram with Note/alt/loop/par/activate/
// autonumber/title keeps its participant/message mutation ops while unmodeled
// lines ride along VERBATIM as opaque-block segments.
//
//   - Structured lines  = participant/actor declarations + simple messages.
//   - Block constructs  = alt|opt|loop|par|critical|break|rect … end (nesting-
//                         tracked) → ONE opaque-block segment, inner lines kept
//                         byte-for-byte (original indentation).
//   - Other single lines = Note…, activate/deactivate, autonumber, title… →
//                         each joins an adjacent opaque-block segment.
//   - Unbalanced `end` / unclosed block / un-segmentable input → return null
//                         so the caller falls back to a whole-body opaque body
//                         (the old behavior, still lossless).
//
// The serializer emits statements in order: opaque-block lines verbatim,
// structured lines canonical. Round-trip guarantee: every original non-blank
// line's content survives in original order (whitespace canonicalized ONLY on
// structured lines).
// ============================================================================

import { unknownOpMessage } from './mutation-ops.ts'
import type {
  SequenceBody, SequenceParticipant, SequenceMessage, SequenceMessageStyle,
  SequenceStatement, SequenceMutationOp, MutationError, Result,
} from './types.ts'
import { ok, err } from './types.ts'

// ---- Parser -----------------------------------------------------------------

const PARTICIPANT_RE = /^(participant|actor)\s+([A-Za-z_][\w]*)(?:\s+as\s+(.+))?$/i
const MESSAGE_RE = /^([A-Za-z_][\w]*)\s*(-->>|--x|-->|->>|->|-x)\s*([A-Za-z_][\w]*)\s*:\s*(.+)$/

// Keywords that OPEN a nestable block (closed by a matching `end`). `box`
// belongs here: its `end` used to hit the stray-`end` rule below and collapse
// EVERY boxed diagram to the whole-body opaque fallback; as a preserved
// segment (like alt/loop) the box rides along verbatim while the rest of the
// diagram keeps its typed ops. Participants declared inside a box are part of
// the segment and stay invisible to ops, like messages inside alt/loop.
const BLOCK_OPEN_RE = /^(alt|opt|loop|par|critical|break|rect|box)\b/i
// Continuation keywords valid only INSIDE an open block — never open/close one.
const BLOCK_CONT_RE = /^(else|and|option)\b/i
const BLOCK_END_RE = /^end\b/i

/**
 * Parse the body lines of a sequence diagram into a segment-preserving
 * structured body. `trimmedLines` are the normalized (trimmed, comment-
 * stripped) body lines; `rawLines` are the original body lines WITH their
 * indentation preserved (opaque-block segments are emitted from these so the
 * verbatim round-trip holds). Pass the same array for both when raw lines are
 * unavailable.
 *
 * Returns null if the body cannot be cleanly segmented (unbalanced `end`,
 * unclosed block) so the caller falls back to a lossless whole-body opaque
 * body.
 */
export function parseSequenceBody(trimmedLines: string[], rawLines?: string[]): SequenceBody | null {
  const participants: SequenceParticipant[] = []
  const messages: SequenceMessage[] = []
  const statements: SequenceStatement[] = []
  const seen = new Set<string>()

  // Align raw (indented) lines with trimmed lines. `rawLines` has the same
  // logical content but keeps indentation/blank lines; we walk it in lockstep
  // by skipping its blank/comment lines, which `trimmedLines` already drops.
  const raw = rawLines ?? trimmedLines

  // NB: do NOT name this `declare` — that's a TypeScript keyword and bun's
  // transpiler misparses `declare(x)` as an ambient declaration.
  const ensureKnown = (id: string) => {
    if (!seen.has(id)) { participants.push({ id, label: id, kind: 'participant' }); seen.add(id) }
  }

  // Walk the raw lines so opaque segments capture original indentation. Track a
  // parallel index into trimmedLines is unnecessary: we trim each raw line for
  // structural matching but store the raw text in opaque segments.
  let i = 0
  while (i < raw.length) {
    const rawLine = raw[i]!
    const line = rawLine.trim()
    if (!line || line.startsWith('%%')) { i++; continue }

    const part = line.match(PARTICIPANT_RE)
    if (part) {
      const kind = part[1]!.toLowerCase() === 'actor' ? 'actor' : 'participant'
      const id = part[2]!.trim()
      const label = part[3]?.trim() ?? id
      if (!seen.has(id)) {
        participants.push({ id, label, kind }); seen.add(id)
        statements.push({ kind: 'participant', ref: participants.length - 1 })
      } else {
        // Update an implicitly-declared participant with explicit info, and add
        // a statement so the explicit declaration round-trips in position.
        const idx = participants.findIndex(p => p.id === id)
        participants[idx]!.label = label
        participants[idx]!.kind = kind
        statements.push({ kind: 'participant', ref: idx })
      }
      i++
      continue
    }

    const msg = line.match(MESSAGE_RE)
    if (msg) {
      const from = msg[1]!.trim()
      const arrow = msg[2]!.trim()
      const to = msg[3]!.trim()
      const text = msg[4]!.trim()
      ensureKnown(from)
      ensureKnown(to)
      messages.push({ from, to, text, style: styleForArrow(arrow) })
      statements.push({ kind: 'message', ref: messages.length - 1 })
      i++
      continue
    }

    // A stray `end` or block-continuation with no open block can't be cleanly
    // segmented → whole-body opaque fallback.
    if (BLOCK_END_RE.test(line) || BLOCK_CONT_RE.test(line)) return null

    if (BLOCK_OPEN_RE.test(line)) {
      // Capture start → matching end as ONE opaque-block (verbatim, nested).
      const blockLines: string[] = [rawLine]
      let depth = 1
      i++
      while (i < raw.length && depth > 0) {
        const inner = raw[i]!
        const innerTrim = inner.trim()
        if (innerTrim && !innerTrim.startsWith('%%')) {
          if (BLOCK_OPEN_RE.test(innerTrim)) depth++
          else if (BLOCK_END_RE.test(innerTrim)) depth--
        }
        blockLines.push(inner)
        i++
      }
      if (depth !== 0) return null // unclosed block → opaque fallback
      appendOpaque(statements, dropBlankEdges(blockLines))
      continue
    }

    // Any other unmodeled single line (Note…, activate/deactivate, autonumber,
    // title…) joins an adjacent opaque-block segment, kept verbatim.
    appendOpaque(statements, [rawLine])
    i++
  }

  return { kind: 'sequence', participants, messages, statements }
}

// Append verbatim lines to the last statement if it's an opaque-block, else
// start a new one. Coalescing keeps adjacent unmodeled lines in one segment.
function appendOpaque(statements: SequenceStatement[], lines: string[]): void {
  const last = statements[statements.length - 1]
  if (last && last.kind === 'opaque-block') last.lines.push(...lines)
  else statements.push({ kind: 'opaque-block', lines: [...lines] })
}

// Trim trailing blank lines from a captured block (the matching `end` is the
// real terminator); leading content already starts at the block keyword.
function dropBlankEdges(lines: string[]): string[] {
  const out = [...lines]
  while (out.length && out[out.length - 1]!.trim() === '') out.pop()
  return out
}

function styleForArrow(a: string): SequenceMessageStyle {
  switch (a) {
    case '->>': return 'sync'
    case '-->>': return 'reply'
    case '->': return 'async'
    case '-->': return 'async-dashed'
    case '-x': return 'lost'
    case '--x': return 'lost-dashed'
    default: return 'sync'
  }
}

// ---- Serializer -------------------------------------------------------------

export function renderSequence(body: SequenceBody): string {
  const lines: string[] = ['sequenceDiagram']

  if (body.statements && body.statements.length > 0) {
    // Segment-preserving path: emit statements in order.
    for (const st of body.statements) {
      if (st.kind === 'opaque-block') {
        for (const l of st.lines) lines.push(l)
      } else if (st.kind === 'participant') {
        const p = body.participants[st.ref]
        if (p) lines.push(renderParticipant(p))
      } else {
        const m = body.messages[st.ref]
        if (m) lines.push(renderMessage(m))
      }
    }
    return lines.join('\n') + '\n'
  }

  // Legacy / synthesized path (no statements): participants then messages.
  for (const p of body.participants) {
    if (p.label !== p.id || p.kind === 'actor') lines.push(renderParticipant(p))
  }
  for (const m of body.messages) lines.push(renderMessage(m))
  return lines.join('\n') + '\n'
}

function renderParticipant(p: SequenceParticipant): string {
  const tag = p.kind === 'actor' ? 'actor' : 'participant'
  return `  ${tag} ${p.id}${p.label !== p.id ? ` as ${p.label}` : ''}`
}

function renderMessage(m: SequenceMessage): string {
  return `  ${m.from}${arrowForStyle(m.style)}${m.to}: ${m.text}`
}

export function arrowForStyle(s: SequenceMessageStyle): string {
  switch (s) {
    case 'sync': return '->>'
    case 'reply': return '-->>'
    case 'async': return '->'
    case 'async-dashed': return '-->'
    case 'lost': return '-x'
    case 'lost-dashed': return '--x'
  }
}

// ---- Mutator ----------------------------------------------------------------
//
// Index semantics (backward compatible): remove_message / set_message_text
// indexes address the `messages` array exactly as before — TOP-LEVEL
// structured messages only. Messages inside opaque blocks are invisible to ops
// and are never touched. The statements list is updated consistently on every
// op and refs are re-indexed when a message is removed.

export function mutateSequence(body: SequenceBody, op: SequenceMutationOp): Result<SequenceBody, MutationError> {
  const participants = body.participants.map(p => ({ ...p }))
  const messages = body.messages.map(m => ({ ...m }))
  const statements: SequenceStatement[] = (body.statements ?? deriveStatements(body)).map(cloneStatement)

  switch (op.kind) {
    case 'add_participant': {
      if (participants.some(p => p.id === op.id)) return err({ code: 'DUPLICATE_PARTICIPANT', message: `Participant "${op.id}" already exists` })
      participants.push({ id: op.id, label: op.label ?? op.id, kind: op.participantKind ?? 'participant' })
      const ref = participants.length - 1
      insertParticipantStatement(statements, { kind: 'participant', ref })
      break
    }
    case 'remove_participant': {
      const idx = participants.findIndex(p => p.id === op.id)
      if (idx < 0) return err({ code: 'PARTICIPANT_NOT_FOUND', message: `Participant "${op.id}" not found` })
      if (opaqueBlocksReference(statements, op.id)) {
        return err({
          code: 'INVALID_OP',
          message: `Participant "${op.id}" is referenced by preserved sequence syntax; remove or model that opaque block before removing the participant`,
        })
      }
      participants.splice(idx, 1)
      // Drop messages touching the participant, then rebuild statements over
      // the surviving messages/participants (opaque blocks are preserved).
      const removedMsgIdx = new Set<number>()
      messages.forEach((m, mi) => { if (m.from === op.id || m.to === op.id) removedMsgIdx.add(mi) })
      const keptMessages = messages.filter((_, mi) => !removedMsgIdx.has(mi))
      const rebuilt = rebuildStatements(statements, idx, removedMsgIdx)
      return ok({ kind: 'sequence', participants, messages: keptMessages, statements: rebuilt })
    }
    case 'add_message': {
      if (op.index !== undefined && (!Number.isInteger(op.index) || op.index < 0 || op.index > messages.length)) {
        return err({ code: 'INVALID_OP', message: `Sequence add_message index ${op.index} out of range (0..${messages.length})` })
      }
      ensureParticipant(participants, statements, op.from)
      ensureParticipant(participants, statements, op.to)
      const index = op.index ?? messages.length
      messages.splice(index, 0, { from: op.from, to: op.to, text: op.text, style: op.style ?? 'sync' })
      insertMessageStatement(statements, index)
      break
    }
    case 'move_message': {
      if (!Number.isInteger(op.from) || op.from < 0 || op.from >= messages.length) {
        return err({ code: 'MESSAGE_NOT_FOUND', message: `No message at index ${op.from} (0..${Math.max(messages.length - 1, 0)})` })
      }
      if (!Number.isInteger(op.to) || op.to < 0 || op.to >= messages.length) {
        return err({ code: 'MESSAGE_NOT_FOUND', message: `No target position ${op.to} (0..${Math.max(messages.length - 1, 0)})` })
      }
      if (op.from === op.to) break
      moveMessageStatement(statements, op.from, op.to)
      const [moved] = messages.splice(op.from, 1)
      messages.splice(op.to, 0, moved!)
      break
    }
    case 'set_participant_label': {
      const p = participants.find(x => x.id === op.id)
      if (!p) return err({ code: 'PARTICIPANT_NOT_FOUND', message: `Participant "${op.id}" not found` })
      const label = typeof op.label === 'string' ? op.label.trim() : ''
      if (!label || /[\r\n]/.test(label)) {
        return err({ code: 'INVALID_OP', message: 'Sequence participant label must be a non-empty single line' })
      }
      p.label = label
      // Implicit (message-only) participants have no declaration statement;
      // the label only survives serialize → re-parse if one exists. Insert it
      // at the TOP so the renderer parser (first declaration wins) sees it
      // before any boxed/opaque re-declaration of the same id.
      const ref = participants.indexOf(p)
      if (!statements.some(s => s.kind === 'participant' && s.ref === ref)) {
        statements.unshift({ kind: 'participant', ref })
      }
      break
    }
    case 'remove_message': {
      if (op.index < 0 || op.index >= messages.length) return err({ code: 'MESSAGE_NOT_FOUND', message: `No message at index ${op.index}` })
      messages.splice(op.index, 1)
      removeMessageStatement(statements, op.index)
      break
    }
    case 'set_message_text': {
      if (op.index < 0 || op.index >= messages.length) return err({ code: 'MESSAGE_NOT_FOUND', message: `No message at index ${op.index}` })
      messages[op.index]!.text = op.text
      break
    }
    default: {
      const _x: never = op
      return err({ code: 'INVALID_OP', message: unknownOpMessage('sequence', _x) })
    }
  }
  return ok({ kind: 'sequence', participants, messages, statements })
}

function opaqueBlocksReference(statements: SequenceStatement[], id: string): boolean {
  const escaped = id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const token = new RegExp(`(^|[^A-Za-z0-9_])${escaped}(?=$|[^A-Za-z0-9_])`)
  return statements.some(statement =>
    statement.kind === 'opaque-block' && statement.lines.some(line => token.test(line)))
}

function cloneStatement(s: SequenceStatement): SequenceStatement {
  return s.kind === 'opaque-block' ? { kind: 'opaque-block', lines: [...s.lines] } : { ...s }
}

// Build a default statements list (participants then messages) for a body that
// lacks one — e.g. a synthesized payload mutated directly.
function deriveStatements(body: SequenceBody): SequenceStatement[] {
  const out: SequenceStatement[] = []
  body.participants.forEach((p, i) => { if (p.label !== p.id || p.kind === 'actor') out.push({ kind: 'participant', ref: i }) })
  body.messages.forEach((_, i) => out.push({ kind: 'message', ref: i }))
  return out
}

// Insert a participant declaration statement after the last participant
// statement, or at the top of the body (before everything) when there is none.
function insertParticipantStatement(statements: SequenceStatement[], st: SequenceStatement): void {
  let lastPart = -1
  for (let i = 0; i < statements.length; i++) if (statements[i]!.kind === 'participant') lastPart = i
  if (lastPart >= 0) statements.splice(lastPart + 1, 0, st)
  else statements.unshift(st)
}

function ensureParticipant(ps: SequenceParticipant[], statements: SequenceStatement[], id: string): void {
  if (ps.some(p => p.id === id)) return
  ps.push({ id, label: id, kind: 'participant' })
  // Implicit participants are not declared with their own line, so no
  // statement entry is needed (the message line carries the participant id).
}

// Remove the message statement for a removed top-level message and shift all
// later message refs down by one so refs stay aligned with the messages array.
function removeMessageStatement(statements: SequenceStatement[], index: number): void {
  const pos = statements.findIndex(s => s.kind === 'message' && s.ref === index)
  if (pos >= 0) statements.splice(pos, 1)
  for (const s of statements) if (s.kind === 'message' && s.ref > index) s.ref--
}

// Insert the statement for a message just spliced into the messages array at
// `index`: shift refs >= index up, then place the new statement where the
// displaced message's statement was (append when inserting at the end, which
// matches the historical add_message behavior).
function insertMessageStatement(statements: SequenceStatement[], index: number): void {
  const pos = statements.findIndex(s => s.kind === 'message' && s.ref === index)
  for (const s of statements) if (s.kind === 'message' && s.ref >= index) s.ref++
  if (pos >= 0) statements.splice(pos, 0, { kind: 'message', ref: index })
  else statements.push({ kind: 'message', ref: index })
}

// Reposition a top-level message statement so the moved message ends up as
// the `to`-th top-level message; opaque blocks and participant declarations
// keep their positions relative to the surviving neighbors. Refs are then
// renumbered sequentially — message statements always appear in ref order, so
// after the caller applies the same splice to the messages array the two
// views agree.
function moveMessageStatement(statements: SequenceStatement[], from: number, to: number): void {
  const fromPos = statements.findIndex(s => s.kind === 'message' && s.ref === from)
  if (fromPos < 0) return // derived statement lists always carry every message
  statements.splice(fromPos, 1)
  const remaining: number[] = []
  statements.forEach((s, i) => { if (s.kind === 'message') remaining.push(i) })
  const insertPos = to < remaining.length
    ? remaining[to]!
    : (remaining.length > 0 ? remaining[remaining.length - 1]! + 1 : statements.length)
  statements.splice(insertPos, 0, { kind: 'message', ref: -1 })
  let next = 0
  for (const s of statements) if (s.kind === 'message') s.ref = next++
}

// Rebuild statements after a participant removal: drop the removed
// participant's declaration statement and any message statements whose message
// was removed, then re-index surviving participant/message refs. Opaque blocks
// pass through untouched (their inner messages were never in the arrays).
function rebuildStatements(
  statements: SequenceStatement[],
  removedParticipantIdx: number,
  removedMsgIdx: Set<number>,
): SequenceStatement[] {
  const out: SequenceStatement[] = []
  for (const s of statements) {
    if (s.kind === 'opaque-block') { out.push({ kind: 'opaque-block', lines: [...s.lines] }); continue }
    if (s.kind === 'participant') {
      if (s.ref === removedParticipantIdx) continue
      out.push({ kind: 'participant', ref: s.ref > removedParticipantIdx ? s.ref - 1 : s.ref })
      continue
    }
    // message
    if (removedMsgIdx.has(s.ref)) continue
    let shift = 0
    for (const r of removedMsgIdx) if (r < s.ref) shift++
    out.push({ kind: 'message', ref: s.ref - shift })
  }
  return out
}
