// ============================================================================
// Sequence structured body: parse / serialize / mutate (FamilyDescriptor hooks).
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
//   - Participants that preserved lines declare or name (a box's declarations,
//     a note, a message inside an opaque block) are still typed participants,
//     created in Mermaid's order; only their source stays verbatim.
//
// The serializer emits statements in order: opaque-block lines verbatim,
// structured lines canonical. Round-trip guarantee: every original non-blank
// line's content survives in original order (whitespace canonicalized ONLY on
// structured lines).
// ============================================================================

import { unknownOpMessage } from './mutation-ops.ts'
import type {
  SequenceBody, SequenceParticipant, SequenceMessage, SequenceMessageStyle,
  SequenceStatement, SequenceMutationOp, SequenceFragment, MutationError, Result, LayoutWarning,
} from './types.ts'
import { ok, err } from './types.ts'
import { parseSequenceMessageLine, participantEventsOf, readSequenceStatements, sequenceParticipantEvents, type SequenceSourceStatement } from '../sequence/parser.ts'
import { parseAccessibilityDirective } from '../shared/accessibility-directives.ts'
import { SequenceParticipantFold, type ParticipantEvent, type SequenceParticipantFoldOptions, type SequenceParticipantRecord } from '../sequence/participants.ts'
import { isSequenceCommentLine, splitSequenceStatementLines } from '../sequence/statements.ts'
import { appendOpaqueSegment } from './opaque-segments.ts'

// ---- Parser -----------------------------------------------------------------


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
  const messages: SequenceMessage[] = []
  const statements: SequenceStatement[] = []
  // The participants, created and named by the renderer's creation rules
  // (sequence/participants.ts): every statement's events, in source order.
  const fold = new SequenceParticipantFold()

  // Align raw (indented) lines with trimmed lines. `rawLines` has the same
  // logical content but keeps indentation/blank lines; we walk it in lockstep
  // by skipping its blank/comment lines, which `trimmedLines` already drops.
  const source = readSequenceStatements(rawLines ?? trimmedLines)
  if (source.issues.some(issue => issue.syntax === 'sequence_block_boundary')) return null
  const raw = source.statements

  // Walk the raw lines so opaque segments capture original indentation. Track a
  // parallel index into trimmedLines is unnecessary: we trim each raw line for
  // structural matching but store the raw text in opaque segments.
  let i = 0
  while (i < raw.length) {
    const entry = raw[i]!
    const rawLine = entry.raw
    const line = rawLine.trim()
    const syntax = entry.syntax
    if (!line) { i++; continue }
    if (isSequenceCommentLine(line)) {
      appendOpaqueSegment(statements, [rawLine], sequenceOpaqueBlock)
      i++
      continue
    }

    if (syntax?.kind === 'declaration') {
      const declared = syntax.declaration
      if (declared.unmodeledMetadata?.length) {
        fold.applyAll(participantEventsOf(syntax))
        appendOpaqueSegment(statements, [rawLine], sequenceOpaqueBlock)
        i++
        continue
      }
      // Mermaid ignores a bare re-declaration of a known participant, so keep
      // that line verbatim rather than re-render it from a participant it
      // does not change.
      if (fold.has(declared.id) && !declared.aliased) {
        appendOpaqueSegment(statements, [rawLine], sequenceOpaqueBlock); i++; continue
      }
      fold.applyAll(participantEventsOf(syntax))
      statements.push({ kind: 'participant', ref: fold.indexOf(declared.id) })
      i++
      continue
    }

    if (syntax?.kind === 'links') {
      fold.applyAll(participantEventsOf(syntax))
      statements.push({ kind: 'actor-links', actorId: syntax.actorId, links: { ...syntax.links } })
      i++
      continue
    }

    // `par_over` remains a distinct upstream construct, not a typed `par`
    // fragment. Preserve the previous whole-body opaque disposition until
    // its own #264 projection is implemented.
    if (syntax?.kind === 'block' && syntax.opener.type === 'par_over') return null
    if (syntax?.kind === 'message') {
      fold.applyAll(participantEventsOf(syntax))
      messages.push(sequenceMessageFromParsed(syntax.message))
      statements.push({ kind: 'message', ref: messages.length - 1 })
      i++
      continue
    }

    if (syntax?.kind === 'block' || syntax?.kind === 'box') {
      // The shared reader, not a second depth scanner, owns this boundary.
      const block = raw.slice(i, entry.endIndex! + 1)
      const blockLines = block.map(entry => entry.raw)
      i = entry.endIndex! + 1
      const fragment = parseTypedFragment(block)
      for (const inner of block) fold.applyAll(participantEventsOf(inner.syntax))
      if (fragment) {
        statements.push({ kind: 'fragment', fragment })
      } else {
        appendOpaqueSegment(statements, blockLines, sequenceOpaqueBlock)
      }
      continue
    }

    // Any other unmodeled single line (Note…, create, activate/deactivate,
    // autonumber, title…) joins an adjacent opaque-block segment, kept
    // verbatim, and still declares the participants it names.
    fold.applyAll(participantEventsOf(syntax))
    appendOpaqueSegment(statements, [rawLine], sequenceOpaqueBlock)
    i++
  }

  return { kind: 'sequence', participants: fold.list().map(typedParticipant), messages, statements }
}

const sequenceOpaqueBlock = (lines: string[]): SequenceStatement => ({ kind: 'opaque-block', lines })

/** A folded participant as the typed body's participant; the declaration
 * keyword is kept only where it differs from the visual type. */
function typedParticipant({ id, label, type: kind, keyword, links }: SequenceParticipantRecord): SequenceParticipant {
  return {
    id, label, kind,
    ...(keyword && keyword !== kind ? { declaration: keyword } : {}),
    ...(links && Object.keys(links).length > 0 ? { links } : {}),
  }
}

/** The participant events of a preserved line: the renderer's own (see
 * sequence/participants.ts). A line the renderer rejects creates nothing
 * here; it stays verbatim source, and rendering reports it. */
function preservedLineEvents(rawLine: string): ParticipantEvent[] {
  const line = rawLine.trim()
  if (!line || isSequenceCommentLine(line)) return []
  try { return sequenceParticipantEvents(line) } catch { return [] }
}

function sequenceMessageFromParsed(msg: ReturnType<typeof parseSequenceMessageLine> & {}): SequenceMessage {
  return {
    from: msg.from, to: msg.to, text: msg.label.trim(), style: styleForArrow(msg.arrow),
    arrow: msg.arrow as import('./types.ts').SequenceMessageArrow,
    ...(msg.centralStart ? { centralStart: true } : {}), ...(msg.centralEnd ? { centralEnd: true } : {}),
    ...(msg.activationMark === '+' ? { activate: true } : {}), ...(msg.activationMark === '-' ? { deactivate: true } : {}),
  }
}

function parseTypedFragment(entries: SequenceSourceStatement[]): SequenceFragment | null {
  const syntax = entries[0]?.syntax
  const opener = syntax?.kind === 'block' ? syntax.opener : undefined
  if (!opener || !['alt', 'opt', 'loop', 'par'].includes(opener.type)) return null
  const fragmentKind = opener.type as SequenceFragment['fragmentKind']
  const branches: SequenceFragment['branches'] = [{ messages: [] }]
  for (const entry of entries.slice(1, -1)) {
    const line = entry.raw.trim()
    if (!line) continue
    // Editing a fragment that carries comments would otherwise discard them.
    // Keep the entire block opaque until comments gain their own typed model.
    if (line.startsWith('%%')) return null
    const inner = entry.syntax
    if (inner?.kind === 'continuation') {
      const continuation = inner.continuation
      branches.push({ ...(continuation.label ? { label: continuation.label } : {}), messages: [] })
      continue
    }
    if (inner?.kind !== 'message') return null
    branches.at(-1)!.messages.push(sequenceMessageFromParsed(inner.message))
  }
  return {
    fragmentKind,
    ...(opener.label ? { label: opener.label } : {}),
    branches,
    rawLines: entries.map(entry => entry.raw),
  }
}

export type SequenceMessageContext =
  | { scope: 'top-level'; message: SequenceMessage }
  | {
    scope: 'fragment'
    message: SequenceMessage
    fragmentIndex: number
    branchIndex: number
    fragmentKind: SequenceFragment['fragmentKind']
    fragmentLabel?: string
    branchLabel?: string
  }

/** Preserve control-flow location while exposing messages for read-back. */
export function sequenceMessageContexts(body: SequenceBody): SequenceMessageContext[] {
  const out: SequenceMessageContext[] = []
  let fragmentIndex = 0
  for (const statement of body.statements) {
    if (statement.kind === 'message') {
      const message = body.messages[statement.ref]
      if (message) out.push({ scope: 'top-level', message })
    } else if (statement.kind === 'fragment') {
      statement.fragment.branches.forEach((branch, branchIndex) => {
        for (const message of branch.messages) out.push({
          scope: 'fragment', message, fragmentIndex, branchIndex,
          fragmentKind: statement.fragment.fragmentKind,
          ...(statement.fragment.label ? { fragmentLabel: statement.fragment.label } : {}),
          ...(branch.label ? { branchLabel: branch.label } : {}),
        })
      })
      fragmentIndex++
    }
  }
  return out
}

/** Messages in rendered interaction order. Use sequenceMessageContexts when
 * branch/fragment semantics matter. */
export function sequenceMessages(body: SequenceBody): SequenceMessage[] {
  return sequenceMessageContexts(body).map(context => context.message)
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

// ---- Verifier ---------------------------------------------------------------

/** Sequence source ours reads where Mermaid 11.16 rejects it, each on its
 * canonical line: a participant a second `box` meets stays in its first box
 * (sequence/participants.ts). */
export function sequenceUnsupportedSyntaxWarnings(canonicalSource: string): LayoutWarning[] {
  const lines = canonicalSource.split(/\r?\n/)
  const header = lines.findIndex(line => /^sequenceDiagram\b/.test(line.trim()))
  if (header < 0) return []
  const warnings: LayoutWarning[] = []
  let line = header + 1
  const fold = new SequenceParticipantFold({
    onBoxConflict: id => warnings.push({
      code: 'UNSUPPORTED_SYNTAX',
      syntax: 'sequence_participant_in_two_boxes',
      line,
      message: `Participant "${id}" in a second box stays in the box that first placed it. Mermaid 11.16 rejects this; put each participant in one box only.`,
    }),
  })
  const grammar = lines.slice(header + 1)
  for (let index = header + 1; index < lines.length; index++) {
    const directive = parseAccessibilityDirective(lines, index)
    if (directive === undefined) break
    if (directive !== null) {
      for (let at = index; at <= directive.endIndex; at++) grammar[at - header - 1] = ''
      if (directive.suffixLine) grammar[directive.endIndex - header - 1] = directive.suffixLine
      index = directive.endIndex
      continue
    }
  }
  const source = readSequenceStatements(grammar)
  for (const issue of source.issues) warnings.push({
    code: 'UNSUPPORTED_SYNTAX', syntax: issue.syntax, line: header + issue.line + 2, message: issue.message,
  })
  for (const entry of source.statements) {
    line = header + entry.line + 2
    const statement = entry.syntax
    fold.applyAll(participantEventsOf(statement))
    if (statement?.kind === 'box') fold.openBox({ actorIds: [] })
    else if (entry.closes !== undefined && source.statements[entry.closes]?.syntax?.kind === 'box') {
      fold.closeBox()
    }
  }
  return warnings
}

// ---- Serializer -------------------------------------------------------------

export function renderSequence(body: SequenceBody): string {
  const lines: string[] = ['sequenceDiagram']

  if (body.statements.length > 0) {
    // Segment-preserving path: emit statements in order. A declaration after
    // the participant's first mention keeps its alias even when that is the
    // id, since Mermaid ignores a bare re-declaration.
    const mentioned = new Set<string>()
    for (const st of body.statements) {
      if (st.kind === 'opaque-block') {
        for (const l of st.lines) lines.push(l)
      } else if (st.kind === 'participant') {
        const p = body.participants[st.ref]
        if (p) lines.push(renderParticipant(p, mentioned.has(p.id)))
      } else if (st.kind === 'actor-links') {
        for (const [label, href] of Object.entries(st.links)) lines.push(`  link ${st.actorId}: ${label} @ ${href}`)
      } else if (st.kind === 'fragment') {
        lines.push(...renderFragment(st.fragment))
      } else {
        const m = body.messages[st.ref]
        if (m) lines.push(renderMessage(m))
      }
      for (const id of statementParticipantIds(st, body.participants, body.messages)) mentioned.add(id)
    }
    return lines.join('\n') + '\n'
  }

  return lines.join('\n') + '\n'
}

function renderFragment(fragment: SequenceFragment): string[] {
  if (fragment.rawLines) return [...fragment.rawLines]
  const lines = [`  ${fragment.fragmentKind}${fragment.label ? ` ${fragment.label}` : ''}`]
  fragment.branches.forEach((branch, index) => {
    if (index > 0) lines.push(`  ${fragment.fragmentKind === 'par' ? 'and' : 'else'}${branch.label ? ` ${branch.label}` : ''}`)
    for (const message of branch.messages) lines.push(`  ${renderMessage(message).trimStart()}`)
  })
  lines.push('  end')
  return lines
}

function renderParticipant(p: SequenceParticipant, redeclared: boolean): string {
  const tag = p.declaration ?? (p.kind === 'actor' ? 'actor' : 'participant')
  // The keyword gives its own type; any other type (`actor A@{ "type":
  // "participant" }` included) needs the metadata to survive a re-parse.
  const metadata = p.kind !== tag ? `@{ "type": "${p.kind}" }` : ''
  const label = p.label.replace(/\r?\n/g, '<br/>')
  return `  ${tag} ${p.id}${metadata}${label !== p.id || redeclared ? ` as ${label}` : ''}`
}

/** The participant ids a statement names, in the order Mermaid meets them. */
function statementParticipantIds(statement: SequenceStatement, participants: SequenceParticipant[], messages: SequenceMessage[]): string[] {
  const endpoints = (message: SequenceMessage | undefined) => message ? [message.from, message.to] : []
  switch (statement.kind) {
    case 'participant': return participants[statement.ref] ? [participants[statement.ref]!.id] : []
    case 'message': return endpoints(messages[statement.ref])
    case 'fragment': return statement.fragment.branches.flatMap(branch => branch.messages.flatMap(endpoints))
    case 'actor-links': return [statement.actorId]
    case 'opaque-block': return statement.lines.flatMap(line => preservedLineEvents(line).map(event => event.id))
  }
}

function renderMessage(m: SequenceMessage): string {
  const from = `${m.from}${m.centralStart ? '()' : ''}`
  const to = `${m.centralEnd ? '()' : ''}${m.activate ? '+' : m.deactivate ? '-' : ''}${m.to}`
  return `  ${from}${m.arrow ?? arrowForStyle(m.style)}${to}: ${m.text}`
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
// remove_message / set_message_text indexes address the `messages` array's
// TOP-LEVEL
// structured messages only. Messages inside opaque blocks are invisible to ops
// and are never touched. The statements list is updated consistently on every
// op and refs are re-indexed when a message is removed.

export function mutateSequence(body: SequenceBody, op: SequenceMutationOp): Result<SequenceBody, MutationError> {
  const participants = body.participants.map(p => ({ ...p, ...(p.links ? { links: { ...p.links } } : {}) }))
  const messages = body.messages.map(m => ({ ...m }))
  const statements: SequenceStatement[] = body.statements.map(cloneStatement)

  switch (op.kind) {
    case 'add_participant': {
      if (participants.some(p => p.id === op.id)) return err({ code: 'DUPLICATE_PARTICIPANT', message: `Participant "${op.id}" already exists` })
      participants.push({ id: op.id, label: op.label ?? op.id, kind: op.participantKind ?? 'participant' })
      // A new participant comes after every existing one: declare it right
      // after the statement that creates the last of them (at the top when
      // no statement creates one), never ahead of a participant a later
      // statement creates.
      statements.splice(afterCreation(statements, participants, messages, participants.slice(0, -1).map(p => p.id)), 0, { kind: 'participant', ref: participants.length - 1 })
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
      const rebuilt = rebuildStatements(statements, idx, removedMsgIdx, op.id)
      return ok(refolded({ kind: 'sequence', participants, messages: keptMessages, statements: rebuilt }))
    }
    case 'add_message': {
      if (op.index !== undefined && (!Number.isInteger(op.index) || op.index < 0 || op.index > messages.length)) {
        return err({ code: 'INVALID_OP', message: `Sequence add_message index ${op.index} out of range (0..${messages.length})` })
      }
      ensureParticipant(participants, op.from)
      ensureParticipant(participants, op.to)
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
      // As in Mermaid, a participant's first mention places it and its last
      // aliased declaration names it. The label only survives serialize →
      // re-parse through a declaration statement: when the naming declaration
      // is preserved source (a boxed `participant A as …`), declare the new
      // label right after it. An implied participant is declared right after
      // the statement that creates it, where the declaration renames it in
      // place; ahead of that statement it could jump a participant the
      // statement creates first (`A->>B`, relabelling B).
      const ref = participants.indexOf(p)
      const naming = namingDeclaration(statements, ref, p.id)
      const at = naming === undefined ? creatingStatement(statements, participants, messages, p.id) + 1 : naming.preserved ? naming.index + 1 : undefined
      if (at === undefined) break
      statements.splice(at, 0, { kind: 'participant', ref })
      // A naming declaration resets the links in Mermaid (ours keeps them):
      // when it lands after statements that linked the participant, link it
      // again right after, so Mermaid reads them too.
      const reparsed = reparsedParticipants({ kind: 'sequence', participants, messages, statements }, { upstreamLinks: true }).find(record => record.id === p.id)
      if (p.links && JSON.stringify(reparsed?.links ?? {}) !== JSON.stringify(p.links)) {
        statements.splice(at + 1, 0, { kind: 'actor-links', actorId: p.id, links: { ...p.links } })
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
    case 'add_fragment': {
      const label = normalizeFragmentLabel(op.label)
      if (!label.ok) return label
      const fragments = fragmentStatements(statements)
      const index = op.index ?? fragments.length
      if (!Number.isInteger(index) || index < 0 || index > fragments.length) return err({ code: 'INVALID_OP', message: `Sequence fragment index ${index} out of range (0..${fragments.length})` })
      const statement: SequenceStatement = { kind: 'fragment', fragment: { fragmentKind: op.fragmentKind, ...(label.value ? { label: label.value } : {}), branches: [{ messages: [] }] } }
      const position = index < fragments.length ? fragments[index]!.position : statements.length
      statements.splice(position, 0, statement)
      break
    }
    case 'remove_fragment': {
      const target = fragmentStatements(statements)[op.index]
      if (!target) return err({ code: 'INVALID_OP', message: `No sequence fragment at index ${op.index}` })
      statements.splice(target.position, 1)
      break
    }
    case 'set_fragment_label': {
      const target = fragmentStatements(statements)[op.index]
      if (!target) return err({ code: 'INVALID_OP', message: `No sequence fragment at index ${op.index}` })
      const label = normalizeFragmentLabel(op.label)
      if (!label.ok) return label
      delete target.statement.fragment.rawLines
      if (label.value) target.statement.fragment.label = label.value
      else delete target.statement.fragment.label
      break
    }
    case 'add_fragment_branch': {
      const target = fragmentStatements(statements)[op.fragmentIndex]
      if (!target) return err({ code: 'INVALID_OP', message: `No sequence fragment at index ${op.fragmentIndex}` })
      if (target.statement.fragment.fragmentKind !== 'alt' && target.statement.fragment.fragmentKind !== 'par') return err({ code: 'INVALID_OP', message: 'Only alt and par fragments can have multiple branches' })
      const label = normalizeFragmentLabel(op.label)
      if (!label.ok) return label
      delete target.statement.fragment.rawLines
      target.statement.fragment.branches.push({ ...(label.value ? { label: label.value } : {}), messages: [] })
      break
    }
    case 'set_fragment_branch_label': {
      const target = fragmentStatements(statements)[op.fragmentIndex]
      if (!target) return err({ code: 'INVALID_OP', message: `No sequence fragment at index ${op.fragmentIndex}` })
      const branch = findFragmentBranch(statements, op.fragmentIndex, op.branchIndex)
      if (!branch.ok) return branch
      const label = normalizeFragmentLabel(op.label)
      if (!label.ok) return label
      delete target.statement.fragment.rawLines
      if (op.branchIndex === 0) {
        // Mermaid spells the first branch label on the fragment opener (`alt x`),
        // not on an `else`/`and` continuation line.
        if (label.value) target.statement.fragment.label = label.value
        else delete target.statement.fragment.label
        delete branch.value.label
      } else if (label.value) branch.value.label = label.value
      else delete branch.value.label
      break
    }
    case 'add_fragment_message': {
      const target = fragmentStatements(statements)[op.fragmentIndex]
      if (!target) return err({ code: 'INVALID_OP', message: `No sequence fragment at index ${op.fragmentIndex}` })
      const branch = findFragmentBranch(statements, op.fragmentIndex, op.branchIndex ?? 0)
      if (!branch.ok) return branch
      const index = op.index ?? branch.value.messages.length
      if (!Number.isInteger(index) || index < 0 || index > branch.value.messages.length) return err({ code: 'INVALID_OP', message: `Sequence fragment message index ${index} out of range` })
      ensureParticipant(participants, op.from)
      ensureParticipant(participants, op.to)
      delete target.statement.fragment.rawLines
      branch.value.messages.splice(index, 0, { from: op.from, to: op.to, text: op.text, style: op.style ?? 'sync' })
      break
    }
    case 'remove_fragment_message': {
      const target = fragmentStatements(statements)[op.fragmentIndex]
      if (!target) return err({ code: 'INVALID_OP', message: `No sequence fragment at index ${op.fragmentIndex}` })
      const branch = findFragmentBranch(statements, op.fragmentIndex, op.branchIndex ?? 0)
      if (!branch.ok) return branch
      if (!branch.value.messages[op.index]) return err({ code: 'MESSAGE_NOT_FOUND', message: `No fragment message at index ${op.index}` })
      delete target.statement.fragment.rawLines
      branch.value.messages.splice(op.index, 1)
      break
    }
    case 'set_fragment_message_text': {
      const target = fragmentStatements(statements)[op.fragmentIndex]
      if (!target) return err({ code: 'INVALID_OP', message: `No sequence fragment at index ${op.fragmentIndex}` })
      const branch = findFragmentBranch(statements, op.fragmentIndex, op.branchIndex ?? 0)
      if (!branch.ok) return branch
      const message = branch.value.messages[op.index]
      if (!message) return err({ code: 'MESSAGE_NOT_FOUND', message: `No fragment message at index ${op.index}` })
      delete target.statement.fragment.rawLines
      message.text = op.text
      break
    }
    default: {
      const _x: never = op
      return err({ code: 'INVALID_OP', message: unknownOpMessage('sequence', _x) })
    }
  }
  return ok(refolded({ kind: 'sequence', participants, messages, statements }))
}

/** Keep an edited body the fold of its own statements, which is what its
 * serialization re-parses to (sequence/participants.ts): participants are
 * listed in the order the statements create them (a message added ahead of
 * the others creates its new participant there), with the label, type and
 * links the statements give them (removing the message that created a
 * participant lets a later declaration create it), and one that no
 * statement creates any more (its only messages were removed) is gone, as it
 * is from the diagram. */
function refolded(body: SequenceBody): SequenceBody {
  const participants = reparsedParticipants(body).map(typedParticipant)
  if (JSON.stringify(participants) === JSON.stringify(body.participants)) return body
  const newRef = new Map(participants.map((participant, at) => [participant.id, at]))
  return {
    kind: 'sequence',
    participants,
    messages: body.messages,
    statements: body.statements.map(statement => statement.kind === 'participant' ? { kind: 'participant', ref: newRef.get(body.participants[statement.ref]!.id)! } : statement),
  }
}

/** The statement index right after the one that creates the last of `ids`
 * (0 when no statement creates any of them). */
function afterCreation(statements: SequenceStatement[], participants: SequenceParticipant[], messages: SequenceMessage[], ids: readonly string[]): number {
  const wanted = new Set(ids)
  const created = new Set<string>()
  let at = 0
  statements.forEach((statement, index) => {
    for (const id of statementParticipantIds(statement, participants, messages)) {
      if (created.has(id)) continue
      created.add(id)
      if (wanted.has(id)) at = index + 1
    }
  })
  return at
}

/** The participants the body's own serialization creates on re-parse: the
 * shared creation rules folded over the serializer's output. */
function reparsedParticipants(body: SequenceBody, options: SequenceParticipantFoldOptions = {}): SequenceParticipantRecord[] {
  const fold = new SequenceParticipantFold(options)
  for (const line of splitSequenceStatementLines(renderSequence(body).split('\n')).slice(1)) fold.applyAll(preservedLineEvents(line))
  return fold.list()
}

/** The statement whose declaration names participant `id` last: its own
 * declaration statement, or a preserved line that declares it with an alias. */
function namingDeclaration(statements: SequenceStatement[], ref: number, id: string): { index: number; preserved: boolean } | undefined {
  // One naming rule (`as …` or a metadata alias), the parser's.
  const names = (line: string) => preservedLineEvents(line)
    .some(event => event.kind === 'declare' && event.id === id && event.label !== undefined && !event.create)
  for (let index = statements.length - 1; index >= 0; index--) {
    const statement = statements[index]!
    if (statement.kind === 'participant' && statement.ref === ref) return { index, preserved: false }
    if (statement.kind === 'opaque-block' && statement.lines.some(names)) return { index, preserved: true }
  }
  return undefined
}

/** Index of the first statement that names participant `id` (and so creates
 * it on re-parse); the last statement when none does. */
function creatingStatement(statements: SequenceStatement[], participants: SequenceParticipant[], messages: SequenceMessage[], id: string): number {
  const index = statements.findIndex(statement => statementParticipantIds(statement, participants, messages).includes(id))
  return index < 0 ? statements.length - 1 : index
}

function opaqueBlocksReference(statements: SequenceStatement[], id: string): boolean {
  const escaped = id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const token = new RegExp(`(^|[^A-Za-z0-9_])${escaped}(?=$|[^A-Za-z0-9_])`)
  // A preserved line references the participant when the creation rules say
  // it names it (`d1--xA` names A with no token boundary before it), or when
  // the id appears in it as a token at all (`activate A`).
  const names = (line: string) => preservedLineEvents(line).some(event => event.id === id)
  return statements.some(statement =>
    (statement.kind === 'opaque-block' && statement.lines.some(line => !isSequenceCommentLine(line) && (names(line) || token.test(line))))
    || (statement.kind === 'fragment' && statement.fragment.branches.some(branch => branch.messages.some(message => message.from === id || message.to === id))))
}

function cloneStatement(s: SequenceStatement): SequenceStatement {
  if (s.kind === 'opaque-block') return { kind: 'opaque-block', lines: [...s.lines] }
  if (s.kind === 'actor-links') return { ...s, links: { ...s.links } }
  if (s.kind === 'fragment') return { kind: 'fragment', fragment: { ...s.fragment, branches: s.fragment.branches.map(branch => ({ ...branch, messages: branch.messages.map(message => ({ ...message })) })) } }
  return { ...s }
}

function fragmentStatements(statements: SequenceStatement[]): Array<{ position: number; statement: Extract<SequenceStatement, { kind: 'fragment' }> }> {
  const out: Array<{ position: number; statement: Extract<SequenceStatement, { kind: 'fragment' }> }> = []
  statements.forEach((statement, position) => { if (statement.kind === 'fragment') out.push({ position, statement }) })
  return out
}

function normalizeFragmentLabel(value: string | null | undefined): Result<string | undefined, MutationError> {
  if (value === null || value === undefined) return ok(undefined)
  if (typeof value !== 'string' || !value.trim() || /[\r\n]/.test(value)) return err({ code: 'INVALID_OP', message: 'Sequence fragment label must be a non-empty single line or null' })
  return ok(value.trim())
}

function findFragmentBranch(statements: SequenceStatement[], fragmentIndex: number, branchIndex: number): Result<SequenceFragment['branches'][number], MutationError> {
  const target = fragmentStatements(statements)[fragmentIndex]
  if (!target) return err({ code: 'INVALID_OP', message: `No sequence fragment at index ${fragmentIndex}` })
  const branch = target.statement.fragment.branches[branchIndex]
  return branch ? ok(branch) : err({ code: 'INVALID_OP', message: `No branch ${branchIndex} in sequence fragment ${fragmentIndex}` })
}

function ensureParticipant(ps: SequenceParticipant[], id: string): void {
  if (ps.some(p => p.id === id)) return
  ps.push({ id, label: id, kind: 'participant' })
  // Implicit participants are not declared with their own line, so no
  // statement entry is needed (the message line carries the participant id);
  // refolded lists them where that message creates them.
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
// displaced message's statement was (append when inserting at the end).
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
  removedParticipantId: string,
): SequenceStatement[] {
  const out: SequenceStatement[] = []
  for (const s of statements) {
    if (s.kind === 'opaque-block') { out.push({ kind: 'opaque-block', lines: [...s.lines] }); continue }
    if (s.kind === 'fragment') { out.push(cloneStatement(s)); continue }
    if (s.kind === 'participant') {
      if (s.ref === removedParticipantIdx) continue
      out.push({ kind: 'participant', ref: s.ref > removedParticipantIdx ? s.ref - 1 : s.ref })
      continue
    }
    if (s.kind === 'actor-links') {
      if (s.actorId !== removedParticipantId) out.push({ ...s, links: { ...s.links } })
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
