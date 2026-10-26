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
import { parseSequenceMessageLine, participantEventsOf, readSequenceStatements, sequenceParticipantEvents, sequenceParticipantIdProblem, sequenceActorIdCanSerialize, SequenceParticipantIdError, type SequenceSourceStatement } from '../sequence/parser.ts'
import { parseAccessibilityDirective } from '../shared/accessibility-directives.ts'
import { SequenceParticipantFold, type ParticipantEvent, type SequenceParticipantFoldOptions, type SequenceParticipantRecord } from '../sequence/participants.ts'
import { isCharacterReference, sequenceGrammarText } from '../sequence/family-source.ts'
import { isSequenceCommentLine, scanSequenceStatementLines, splitSequenceStatementLines } from '../sequence/statements.ts'
import { appendOpaqueSegment } from './opaque-segments.ts'
import { writeMermaidComment } from '../shared/trailing-comment.ts'
import { normalizeSequenceMessageText, readSequenceText, writeSequenceText, writeSequenceControlledText } from '../sequence/text.ts'
import { readMetadataBlock } from '../shared/metadata-yaml.ts'

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
  assertParticipantDeclarations(source)
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
      const blockLines = block.map(portableRaw)
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

  const body: SequenceBody = { kind: 'sequence', participants: fold.list().map(typedParticipant), messages, statements }
  return serializationIdError(body) ? null : body
}

const sequenceOpaqueBlock = (lines: string[]): SequenceStatement => ({ kind: 'opaque-block', lines })

/** A folded participant as the typed body's participant; the declaration
 * keyword is kept only where it differs from the visual type. */
function typedParticipant({ id, label, type: kind, keyword, links, wrap }: SequenceParticipantRecord): SequenceParticipant {
  const text = readSequenceText(label)
  return {
    id, label: text.value, kind,
    ...(wrap === undefined ? {} : { wrap }),
    ...(text.content ? { labelContent: text.content } : {}),
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
  const text = readSequenceText(msg.label.trim())
  return {
    from: msg.from, to: msg.to, text: text.value, style: styleForArrow(msg.arrow),
    ...(msg.wrap === undefined ? {} : { wrap: msg.wrap }),
    ...(text.content ? { textContent: text.content } : {}),
    arrow: msg.arrow as import('./types.ts').SequenceMessageArrow,
    ...(msg.centralStart ? { centralStart: true } : {}), ...(msg.centralEnd ? { centralEnd: true } : {}),
    ...(msg.activationMark === '+' ? { activate: true } : {}), ...(msg.activationMark === '-' ? { deactivate: true } : {}),
  }
}

/** A statement's source as kept verbatim, but with a local arrow spelling
 * replaced by Mermaid's arrow that draws the same, so the kept source is
 * source Mermaid reads. */
function portableRaw(entry: SequenceSourceStatement): string {
  const message = entry.syntax?.kind === 'message' ? entry.syntax.message : undefined
  if (message?.label.includes('%%')) return renderMessage(sequenceMessageFromParsed(message))
  let source = entry.raw
  if (message?.localArrow) {
    // Only `()` and spaces stand between the sender and its arrow.
    const at = source.indexOf(message.localArrow, source.length - source.trimStart().length + message.from.length)
    source = source.slice(0, at) + message.arrow + source.slice(at + message.localArrow.length)
  }
  return message ? messageWithBoundary(message.from, source) : source
}

function parseTypedFragment(entries: SequenceSourceStatement[]): SequenceFragment | null {
  const syntax = entries[0]?.syntax
  const opener = syntax?.kind === 'block' ? syntax.opener : undefined
  if (!opener || !['alt', 'opt', 'loop', 'par', 'par_over'].includes(opener.type)) return null
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
      const text = readSequenceText(continuation.label)
      branches.push({ ...(continuation.wrap === undefined ? {} : { wrap: continuation.wrap }), ...(text.value ? { label: text.value } : {}), ...(text.content ? { labelContent: text.content } : {}), messages: [] })
      continue
    }
    if (inner?.kind !== 'message') return null
    branches.at(-1)!.messages.push(sequenceMessageFromParsed(inner.message))
  }
  const text = readSequenceText(opener.label)
  return {
    fragmentKind,
    ...(opener.wrap === undefined ? {} : { wrap: opener.wrap }),
    ...(text.value ? { label: text.value } : {}),
    ...(text.content ? { labelContent: text.content } : {}),
    branches,
    rawLines: entries.map(portableRaw),
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

/** Sequence source ours reads where pinned Mermaid rejects it, each on its
 * canonical line: a participant a second `box` meets stays in its first box
 * (sequence/participants.ts), and deactivating a participant that is not
 * active does nothing, where Mermaid's database throws. */
export function sequenceUnsupportedSyntaxWarnings(canonicalSource: string): LayoutWarning[] {
  const authored = canonicalSource.split(/\r?\n/)
  const authoredHeader = authored.findIndex(line => /^sequenceDiagram\b/.test(line.trim()))
  if (authoredHeader < 0) return []
  const warnings: LayoutWarning[] = []
  // Pinned Mermaid ends a statement at a named reference's `;`, which the
  // renderer reads as text (sequence/family-source.ts).
  const body = authored.slice(authoredHeader + 1)
  for (const span of scanSequenceStatementLines(body)) {
    const name = /&([a-zA-Z][a-zA-Z\d]{0,31})$/.exec(span.raw)?.[1]
    if (name !== undefined && body[span.line]![span.endColumn] === ';' && isCharacterReference(name)) warnings.push({
      code: 'UNSUPPORTED_SYNTAX', syntax: 'sequence_named_reference_semicolon', line: authoredHeader + span.line + 2,
      message: 'The renderer reads a named reference such as &amp; or &nbsp; as text, but pinned Mermaid ends the statement at its ";". Write its Mermaid entity (#amp;, #nbsp;) instead.',
    })
  }
  const lines = sequenceGrammarText(canonicalSource).split(/\r?\n/)
  const header = lines.findIndex(line => /^sequenceDiagram\b/.test(line.trim()))
  if (header < 0) return warnings
  let line = header + 1
  const fold = new SequenceParticipantFold({
    onBoxConflict: id => warnings.push({
      code: 'UNSUPPORTED_SYNTAX',
      syntax: 'sequence_participant_in_two_boxes',
      line,
      message: `Participant "${id}" in a second box stays in the box that first placed it. Pinned Mermaid rejects this; put each participant in one box only.`,
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
  // Mermaid counts each participant's activations in statement order: `+`
  // activates a message's receiver, `-` deactivates its sender.
  const active = new Map<string, number>()
  const deactivate = (id: string, how: string): void => {
    const count = active.get(id) ?? 0
    if (count > 0) { active.set(id, count - 1); return }
    warnings.push({
      code: 'UNSUPPORTED_SYNTAX', syntax: 'sequence_inactive_deactivation', line,
      message: `${how} deactivates participant "${id}", which is not active; ours ignores it. Pinned Mermaid rejects this ("Trying to inactivate an inactive participant"); activate "${id}" first or remove the deactivation.`,
    })
  }
  for (const entry of source.statements) {
    line = header + entry.line + 2
    const statement = entry.syntax
    fold.applyAll(participantEventsOf(statement))
    if (statement?.kind === 'message' && statement.message.activationMark === '+') active.set(statement.message.to, (active.get(statement.message.to) ?? 0) + 1)
    else if (statement?.kind === 'message' && statement.message.activationMark === '-') deactivate(statement.message.from, 'The "-" on this message')
    else if (statement?.kind === 'activation' && statement.activate) active.set(statement.actorId, (active.get(statement.actorId) ?? 0) + 1)
    else if (statement?.kind === 'activation') deactivate(statement.actorId, 'This statement')
    if (statement?.kind === 'box') fold.openBox({ actorIds: [] })
    else if (entry.closes !== undefined && source.statements[entry.closes]?.syntax?.kind === 'box') {
      fold.closeBox()
    }
  }
  return warnings
}

// ---- Serializer -------------------------------------------------------------

export function renderSequence(body: SequenceBody): string {
  const invalidId = serializationIdError(body)
  if (invalidId) throw new Error(invalidId.message)
  const lines: string[] = ['sequenceDiagram']

  if (body.statements.length > 0) {
    // Segment-preserving path: emit statements in order. A declaration after
    // the participant's first mention keeps its alias even when that is the
    // id, since Mermaid ignores a bare re-declaration.
    const mentioned = new Set<string>()
    for (const st of body.statements) {
      if (st.kind === 'opaque-block') {
        assertParticipantDeclarations(readSequenceStatements(st.lines))
        for (const l of st.lines) lines.push(isSequenceCommentLine(l) ? writeMermaidComment(l) : l)
      } else if (st.kind === 'participant') {
        const p = body.participants[st.ref]
        if (p) lines.push(renderParticipant(p, mentioned.has(p.id)))
      } else if (st.kind === 'actor-links') {
        // No gap after `title:`: it would start the legacy title token.
        // JSON keeps that spelling safe even for an empty menu label.
        if (st.actorId.toLowerCase() === 'title') lines.push(`  links ${st.actorId}:${JSON.stringify(st.links)}`)
        else for (const [label, href] of Object.entries(st.links)) lines.push(`  link ${st.actorId}: ${label} @ ${href}`)
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

function actorIdError(id: string, context: 'declaration' | 'sender' | 'receiver'): MutationError | undefined {
  if (context === 'declaration') {
    const problem = sequenceParticipantIdProblem(id)
    return problem ? { code: 'INVALID_OP', message: problem } : undefined
  }
  if (sequenceActorIdCanSerialize(id, context)) return undefined
  return { code: 'INVALID_OP', message: `Sequence participant ID "${id}" has no portable spelling as a ${context}; choose another ID and keep display text in its label` }
}

function messageIdError(message: Pick<SequenceMessage, 'from' | 'to'>): MutationError | undefined {
  return actorIdError(message.from, 'sender') ?? actorIdError(message.to, 'receiver')
}

/** Only modeled statements are rewritten. Preserved blocks keep their source
 * and remain subject to the existing limits on edits through opaque syntax. */
function serializationIdError(body: SequenceBody): MutationError | undefined {
  for (const statement of body.statements) {
    let invalid: MutationError | undefined
    if (statement.kind === 'participant') {
      const participant = body.participants[statement.ref]
      if (participant) {
        invalid = actorIdError(participant.id, 'declaration')
        const keyword = participant.declaration ?? (participant.kind === 'actor' ? 'actor' : 'participant')
        if (/\s/.test(participant.id) && (participant.label !== readSequenceText(participant.id).value || participant.kind !== keyword || participant.wrap !== undefined)) {
          invalid = { code: 'INVALID_OP', message: 'Sequence names containing spaces support a bare participant/actor declaration; aliases and type metadata require an ID without spaces' }
        }
      }
    } else if (statement.kind === 'actor-links') {
      invalid = actorIdError(statement.actorId, 'receiver')
    } else if (statement.kind === 'message') {
      const message = body.messages[statement.ref]
      if (message) invalid = messageIdError(message)
    } else if (statement.kind === 'fragment') {
      for (const branch of statement.fragment.branches) {
        for (const message of branch.messages) {
          invalid = messageIdError(message)
          if (invalid) return invalid
        }
      }
    }
    if (invalid) return invalid
  }
  return undefined
}

function renderFragment(fragment: SequenceFragment): string[] {
  if (fragment.rawLines) {
    assertParticipantDeclarations(readSequenceStatements(fragment.rawLines))
    return [...fragment.rawLines]
  }
  const prefix = `  ${fragment.fragmentKind} `
  const lines = [fragment.label || fragment.wrap !== undefined ? prefix + writeSequenceControlledText(fragment.label ?? '', fragment.labelContent, fragment.wrap, prefix) : prefix.trimEnd()]
  fragment.branches.forEach((branch, index) => {
    if (index > 0) {
      const branchPrefix = `  ${fragment.fragmentKind === 'par' || fragment.fragmentKind === 'par_over' ? 'and' : 'else'} `
      lines.push(branch.label || branch.wrap !== undefined ? branchPrefix + writeSequenceControlledText(branch.label ?? '', branch.labelContent, branch.wrap, branchPrefix) : branchPrefix.trimEnd())
    }
    for (const message of branch.messages) lines.push(`  ${renderMessage(message).trimStart()}`)
  })
  lines.push('  end')
  return lines
}

function renderParticipant(p: SequenceParticipant, redeclared: boolean): string {
  const problem = sequenceParticipantIdProblem(p.id)
  if (problem) throw new Error(problem)
  const tag = p.declaration ?? (p.kind === 'actor' ? 'actor' : 'participant')
  // The keyword gives its own type; any other type (`actor A@{ "type":
  // "participant" }` included) needs the metadata to survive a re-parse.
  const metadata = p.kind !== tag ? `@{ "type": "${p.kind}" }` : ''
  const prefix = `  ${tag} ${p.id}${metadata}`
  if (/\s/.test(p.id)) return prefix
  const label = writeSequenceControlledText(p.label, p.labelContent, p.wrap, `${prefix} as `)
  return `${prefix}${label !== p.id || redeclared ? ` as ${label}` : ''}`
}

function assertParticipantDeclarations(source: ReturnType<typeof readSequenceStatements>): void {
  const problem = source.issues.find(issue => issue.syntax === 'sequence_participant_id' || issue.syntax === 'sequence_participant_id_extension')
  if (problem) throw new SequenceParticipantIdError(problem.message)
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

/** ID metadata lookahead crosses newlines and preserved comments. Both raw
 * and modeled messages must end that lexical state before an `@{` sender. */
function messageWithBoundary(sender: string, source: string): string {
  return sender.startsWith('@{') ? `;${source}` : source
}

function renderMessage(m: SequenceMessage): string {
  const from = `${m.from}${m.centralStart ? '()' : ''}`
  const to = `${m.centralEnd ? '()' : ''}${m.activate ? '+' : m.deactivate ? '-' : ''}${m.to}`
  // `title: ` starts Mermaid's legacy title token; an adjacent message
  // payload keeps the same actor ID and message text.
  const prefix = `  ${from}${m.arrow ?? arrowForStyle(m.style)}${to}:${m.to.toLowerCase() === 'title' ? '' : ' '}`
  return messageWithBoundary(m.from, prefix + writeSequenceControlledText(m.text, m.textContent, m.wrap, prefix))
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
  return mutateSequenceBody(cloneSequenceBody(body), op)
}

export function createSequenceMutationDraft(body: SequenceBody): (op: SequenceMutationOp) => Result<SequenceBody, MutationError> {
  let current = cloneSequenceBody(body)
  return op => {
    const result = mutateSequenceBody(current, op)
    if (result.ok) current = result.value
    return result
  }
}

function cloneSequenceBody(body: SequenceBody): SequenceBody {
  const participants = body.participants.map(p => ({ ...p, ...(p.links ? { links: { ...p.links } } : {}) }))
  const messages = body.messages.map(m => ({ ...m }))
  const statements: SequenceStatement[] = body.statements.map(cloneStatement)
  return { kind: 'sequence', participants, messages, statements }
}

function mutateSequenceBody(body: SequenceBody, op: SequenceMutationOp): Result<SequenceBody, MutationError> {
  const { participants, messages, statements } = body

  switch (op.kind) {
    case 'add_participant': {
      const invalidId = actorIdError(op.id, 'declaration')
      if (invalidId) return err(invalidId)
      if (participants.some(p => p.id === op.id)) return err({ code: 'DUPLICATE_PARTICIPANT', message: `Participant "${op.id}" already exists` })
      if (op.label !== undefined && (!op.label.trim() || /[\r\n]/.test(op.label))) {
        return err({ code: 'INVALID_OP', message: 'Sequence participant label must be a non-empty single line' })
      }
      const defaultText = op.label === undefined ? readSequenceText(op.id) : undefined
      participants.push({
        id: op.id, label: op.label ?? defaultText!.value, kind: op.participantKind ?? 'participant',
        ...(defaultText?.content ? { labelContent: defaultText.content } : {}),
      })
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
      const invalidId = messageIdError(op)
      if (invalidId) return err(invalidId)
      if (op.index !== undefined && (!Number.isInteger(op.index) || op.index < 0 || op.index > messages.length)) {
        return err({ code: 'INVALID_OP', message: `Sequence add_message index ${op.index} out of range (0..${messages.length})` })
      }
      ensureParticipant(participants, op.from)
      ensureParticipant(participants, op.to)
      const index = op.index ?? messages.length
      messages.splice(index, 0, { from: op.from, to: op.to, text: normalizeSequenceMessageText(op.text), style: op.style ?? 'sync', ...(op.wrap === undefined ? {} : { wrap: op.wrap }) })
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
      const invalidId = actorIdError(op.id, 'declaration')
      if (invalidId) return err(invalidId)
      const p = participants.find(x => x.id === op.id)
      if (!p) return err({ code: 'PARTICIPANT_NOT_FOUND', message: `Participant "${op.id}" not found` })
      const problem = sequenceParticipantIdProblem(p.id)
      if (problem) return err({ code: 'INVALID_OP', message: problem })
      const label = typeof op.label === 'string' ? op.label.trim() : ''
      if (!label || /[\r\n]/.test(label)) {
        return err({ code: 'INVALID_OP', message: 'Sequence participant label must be a non-empty single line' })
      }
      if (/\s/.test(p.id) && label !== readSequenceText(p.id).value) return err({ code: 'INVALID_OP', message: 'Sequence names containing spaces support a bare participant/actor declaration; an alias requires an ID without spaces' })
      if (p.label !== label || p.labelContent?.value !== p.label) delete p.labelContent
      p.label = label
      // As in Mermaid, a participant's first mention places it and its last
      // aliased declaration names it. The label only survives serialize →
      // re-parse through a declaration statement: when the naming declaration
      // is preserved source (a boxed `participant A as …`), edit that original
      // declaration in place. An implied participant is declared right after
      // the statement that creates it, where the declaration renames it in
      // place; ahead of that statement it could jump a participant the
      // statement creates first (`A->>B`, relabelling B).
      const ref = participants.indexOf(p)
      const naming = namingDeclaration(statements, ref, p.id)
      if (naming?.preserved && relabelPreservedDeclaration(statements[naming.index]!, p)) break
      const at = naming === undefined ? creatingStatement(statements, participants, messages, p.id) + 1 : naming.preserved ? naming.index + 1 : undefined
      if (at === undefined) break
      const actorData = actorDataBefore({ kind: 'sequence', participants, messages, statements: statements.slice(0, at) }, p.id)
      statements.splice(at, 0, { kind: 'participant', ref })
      if (actorData.length) statements.splice(at + 1, 0, { kind: 'opaque-block', lines: actorData })
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
    case 'set_message_wrap': {
      const message = messages[op.index]
      if (!message) return err({ code: 'MESSAGE_NOT_FOUND', message: `No message at index ${op.index}` })
      if (op.wrap === null) delete message.wrap
      else message.wrap = op.wrap
      break
    }
    case 'set_message_text': {
      if (op.index < 0 || op.index >= messages.length) return err({ code: 'MESSAGE_NOT_FOUND', message: `No message at index ${op.index}` })
      const message = messages[op.index]!
      const text = normalizeSequenceMessageText(op.text)
      if (message.text !== text || message.textContent?.value !== message.text) delete message.textContent
      message.text = text
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
      // A matching setter can follow a direct body edit. Rebuild the source;
      // valid labelContent still preserves the label's authored spelling.
      delete target.statement.fragment.rawLines
      if (target.statement.fragment.label !== label.value || target.statement.fragment.labelContent?.value !== target.statement.fragment.label) delete target.statement.fragment.labelContent
      if (label.value) target.statement.fragment.label = label.value
      else delete target.statement.fragment.label
      break
    }
    case 'add_fragment_branch': {
      const target = fragmentStatements(statements)[op.fragmentIndex]
      if (!target) return err({ code: 'INVALID_OP', message: `No sequence fragment at index ${op.fragmentIndex}` })
      if (!['alt', 'par', 'par_over'].includes(target.statement.fragment.fragmentKind)) return err({ code: 'INVALID_OP', message: 'Only alt, par and par_over fragments can have multiple branches' })
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
      if (branch.value.label !== label.value || branch.value.labelContent?.value !== branch.value.label) delete branch.value.labelContent
      if (op.branchIndex === 0) {
        // Mermaid spells the first branch label on the fragment opener (`alt x`),
        // not on an `else`/`and` continuation line.
        if (target.statement.fragment.label !== label.value || target.statement.fragment.labelContent?.value !== target.statement.fragment.label) delete target.statement.fragment.labelContent
        if (label.value) target.statement.fragment.label = label.value
        else delete target.statement.fragment.label
        delete branch.value.label
      } else {
        if (label.value) branch.value.label = label.value
        else delete branch.value.label
      }
      break
    }
    case 'add_fragment_message': {
      const invalidId = messageIdError(op)
      if (invalidId) return err(invalidId)
      const target = fragmentStatements(statements)[op.fragmentIndex]
      if (!target) return err({ code: 'INVALID_OP', message: `No sequence fragment at index ${op.fragmentIndex}` })
      const branch = findFragmentBranch(statements, op.fragmentIndex, op.branchIndex ?? 0)
      if (!branch.ok) return branch
      const index = op.index ?? branch.value.messages.length
      if (!Number.isInteger(index) || index < 0 || index > branch.value.messages.length) return err({ code: 'INVALID_OP', message: `Sequence fragment message index ${index} out of range` })
      ensureParticipant(participants, op.from)
      ensureParticipant(participants, op.to)
      delete target.statement.fragment.rawLines
      branch.value.messages.splice(index, 0, { from: op.from, to: op.to, text: normalizeSequenceMessageText(op.text), style: op.style ?? 'sync', ...(op.wrap === undefined ? {} : { wrap: op.wrap }) })
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
    case 'set_fragment_message_wrap': {
      const target = fragmentStatements(statements)[op.fragmentIndex]
      if (!target) return err({ code: 'INVALID_OP', message: `No sequence fragment at index ${op.fragmentIndex}` })
      const branch = findFragmentBranch(statements, op.fragmentIndex, op.branchIndex ?? 0)
      if (!branch.ok) return branch
      const message = branch.value.messages[op.index]
      if (!message) return err({ code: 'MESSAGE_NOT_FOUND', message: `No fragment message at index ${op.index}` })
      delete target.statement.fragment.rawLines
      if (op.wrap === null) delete message.wrap
      else message.wrap = op.wrap
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
      const text = normalizeSequenceMessageText(op.text)
      if (message.text !== text || message.textContent?.value !== message.text) delete message.textContent
      message.text = text
      break
    }
    default: {
      const _x: never = op
      return err({ code: 'INVALID_OP', message: unknownOpMessage('sequence', _x) })
    }
  }
  const next: SequenceBody = { kind: 'sequence', participants, messages, statements }
  const invalid = serializationIdError(next)
  return invalid ? err(invalid) : ok(refolded(next))
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

/** Update the existing declaration inside a preserved segment. Adding a new
 * declaration after the entire segment can reset later actor properties or
 * duplicate box membership, even though every original source line survives. */
function relabelPreservedDeclaration(statement: SequenceStatement, participant: SequenceParticipant): boolean {
  if (statement.kind !== 'opaque-block') return false
  const entries = readSequenceStatements(statement.lines).statements
  const entry = entries.findLast(candidate => candidate.syntax?.kind === 'declaration'
    && candidate.syntax.declaration.id === participant.id && candidate.syntax.declaration.aliased)
  if (!entry || entry.syntax?.kind !== 'declaration') return false
  const declaration = entry.syntax.declaration
  const prefix = `${declaration.keyword} ${declaration.id}`
  const label = writeSequenceControlledText(participant.label, participant.labelContent, participant.wrap, `${prefix} as `)
  const raw = entry.raw.trim()
  const metadataAt = raw.indexOf('@{')
  let replacement: string
  if (metadataAt >= 0) {
    const block = readMetadataBlock(raw, metadataAt + 1, 'sequence')
    if (!block.ok) return false
    // Keep unmodeled metadata values while making this alias authoritative,
    // including when the new label equals the participant's identity.
    // CONFIG ends at the first closing brace even inside a quoted scalar.
    // YAML escapes avoid that boundary without adding Mermaid entity tokens.
    const metadata = JSON.stringify({ ...Object.fromEntries(block.entries), alias: writeSequenceText(participant.label, participant.labelContent) })
      .replace(/"(?:\\.|[^"\\])*"/g, scalar => scalar.replace(/}/g, '\\u007d'))
    replacement = `${prefix}@${metadata} as ${label}`
  } else replacement = `${prefix} as ${label}`
  const line = statement.lines[entry.line]!
  const indent = entry.raw.match(/^\s*/)?.[0] ?? ''
  statement.lines[entry.line] = line.slice(0, entry.column) + indent + replacement + line.slice(entry.endColumn)
  return true
}

/** Actor-data writes merge in author order, and an aliased declaration resets
 * them in Mermaid. Replay only data still live immediately before a newly
 * inserted naming declaration, as we already do for actor-menu links. */
function actorDataBefore(body: SequenceBody, id: string): string[] {
  let data: string[] = []
  for (const entry of readSequenceStatements(renderSequence(body).split('\n').slice(1)).statements) {
    const syntax = entry.syntax
    if (syntax?.kind === 'declaration' && syntax.declaration.id === id && syntax.declaration.aliased) data = []
    if (syntax?.kind === 'actor-data' && syntax.actorId === id) data.push(entry.raw)
  }
  return data
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
