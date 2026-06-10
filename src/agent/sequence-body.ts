// ============================================================================
// Sequence structured body: parse / serialize / mutate (FamilyPlugin hooks).
//
// v4 sequence fidelity: parseSequenceBody returns null if it encounters ANY
// non-blank, non-comment line it doesn't fully understand. The caller then
// falls back to an opaque body (lossless round-trip) rather than silently
// dropping the unrecognized construct.
// ============================================================================

import type {
  SequenceBody, SequenceParticipant, SequenceMessage, SequenceMessageStyle,
  SequenceMutationOp, MutationError, Result,
} from './types.ts'
import { ok, err } from './types.ts'

// ---- Parser -----------------------------------------------------------------

const PARTICIPANT_RE = /^(participant|actor)\s+([A-Za-z_][\w]*)(?:\s+as\s+(.+))?$/i
const MESSAGE_RE = /^([A-Za-z_][\w]*)\s*(-->>|--x|-->|->>|->|-x)\s*([A-Za-z_][\w]*)\s*:\s*(.+)$/

/**
 * Parse the body lines of a sequence diagram. Returns a structured body only
 * if EVERY non-blank, non-comment line is fully understood. Otherwise returns
 * null so the caller falls back to a lossless opaque body.
 */
export function parseSequenceBody(lines: string[]): SequenceBody | null {
  const participants: SequenceParticipant[] = []
  const messages: SequenceMessage[] = []
  const seen = new Set<string>()

  // NB: do NOT name this `declare` — that's a TypeScript keyword and bun's
  // transpiler misparses `declare(x)` as an ambient declaration, silently
  // dropping the statements that follow it. (Caught by running the parser.)
  const ensureKnown = (id: string) => {
    if (!seen.has(id)) { participants.push({ id, label: id, kind: 'participant' }); seen.add(id) }
  }

  for (const raw of lines) {
    const line = raw.trim()
    if (!line) continue
    if (line.startsWith('%%')) continue

    const part = line.match(PARTICIPANT_RE)
    if (part) {
      const kind = part[1]!.toLowerCase() === 'actor' ? 'actor' : 'participant'
      const id = part[2]!.trim()
      const label = part[3]?.trim() ?? id
      if (!seen.has(id)) { participants.push({ id, label, kind }); seen.add(id) }
      else { // update an implicitly-declared participant with explicit info
        const existing = participants.find(p => p.id === id)!
        existing.label = label
        existing.kind = kind
      }
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
      continue
    }

    // Anything else (Note, alt, loop, activate, autonumber, title, +/-, etc.)
    // → we don't model it. Bail to the opaque fallback so nothing is lost.
    return null
  }

  return { kind: 'sequence', participants, messages }
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
  for (const p of body.participants) {
    if (p.label !== p.id || p.kind === 'actor') {
      const tag = p.kind === 'actor' ? 'actor' : 'participant'
      lines.push(`  ${tag} ${p.id}${p.label !== p.id ? ` as ${p.label}` : ''}`)
    }
  }
  for (const m of body.messages) {
    lines.push(`  ${m.from}${arrowForStyle(m.style)}${m.to}: ${m.text}`)
  }
  return lines.join('\n') + '\n'
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

export function mutateSequence(body: SequenceBody, op: SequenceMutationOp): Result<SequenceBody, MutationError> {
  const participants = body.participants.map(p => ({ ...p }))
  const messages = body.messages.map(m => ({ ...m }))

  switch (op.kind) {
    case 'add_participant': {
      if (participants.some(p => p.id === op.id)) return err({ code: 'DUPLICATE_PARTICIPANT', message: `Participant "${op.id}" already exists` })
      participants.push({ id: op.id, label: op.label ?? op.id, kind: op.participantKind ?? 'participant' })
      break
    }
    case 'remove_participant': {
      const idx = participants.findIndex(p => p.id === op.id)
      if (idx < 0) return err({ code: 'PARTICIPANT_NOT_FOUND', message: `Participant "${op.id}" not found` })
      participants.splice(idx, 1)
      return ok({ kind: 'sequence', participants, messages: messages.filter(m => m.from !== op.id && m.to !== op.id) })
    }
    case 'add_message': {
      ensureParticipant(participants, op.from); ensureParticipant(participants, op.to)
      messages.push({ from: op.from, to: op.to, text: op.text, style: op.style ?? 'sync' })
      break
    }
    case 'remove_message': {
      if (op.index < 0 || op.index >= messages.length) return err({ code: 'MESSAGE_NOT_FOUND', message: `No message at index ${op.index}` })
      messages.splice(op.index, 1)
      break
    }
    case 'set_message_text': {
      if (op.index < 0 || op.index >= messages.length) return err({ code: 'MESSAGE_NOT_FOUND', message: `No message at index ${op.index}` })
      messages[op.index]!.text = op.text
      break
    }
    default: {
      const _x: never = op
      return err({ code: 'INVALID_OP', message: `Unknown op: ${JSON.stringify(_x)}` })
    }
  }
  return ok({ kind: 'sequence', participants, messages })
}

function ensureParticipant(ps: SequenceParticipant[], id: string): void {
  if (!ps.some(p => p.id === id)) ps.push({ id, label: id, kind: 'participant' })
}
