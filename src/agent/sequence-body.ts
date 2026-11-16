// ============================================================================
// Sequence structured body: parse / serialize / mutate (FamilyDescriptor hooks).
//
// BUILD-18 — segment-preserving structured body. The v4 "all-or-nothing opaque
// cliff" is gone: a sequence diagram with Note/alt/loop/par/activate/
// autonumber/title keeps its participant/message mutation ops while unmodeled
// lines ride along VERBATIM as opaque-block segments.
//
//   - Structured lines  = participant/actor declarations, simple messages,
//                         notes and the `create`/`destroy` lifecycle
//                         directives.
//   - Fragments         = alt|opt|loop|par|critical|break|rect … end → a typed
//                         fragment whose branches hold messages, notes,
//                         create/destroy lines and nested fragments, written
//                         back byte for byte until an op edits it. Other
//                         lines in a branch (comments, activations, a `box`
//                         of declarations…) ride along verbatim as preserved
//                         branch statements, in source order. A block whose
//                         preserved lines would hide a message or a note (a
//                         rect the renderer reads no color for, a note the
//                         typed writer cannot spell, nesting past the host
//                         limit) → ONE opaque-block segment, inner lines
//                         kept byte-for-byte.
//   - Other single lines = activate/deactivate, autonumber, title… →
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
  SequenceBody, SequenceParticipant, SequenceMessage, SequenceMessageArrow, SequenceMessageStyle,
  SequenceStatement, SequenceMutationOp, SequenceFragment, SequenceFragmentBranch, SequenceFragmentStatement, SequenceFragmentStep, SequencePreservedLines, SequenceNoteStatement, SequenceNotePosition, SequenceCreateStatement, SequenceDestroyStatement, MutationError, Result, LayoutWarning,
} from './types.ts'
import { ok, err } from './types.ts'
import { parseSequenceMessageLine, participantEventsOf, readSequenceStatements, sequenceParticipantEvents, sequenceParticipantIdProblem, sequenceActorIdCanSerialize, SequenceParticipantIdError, type SequenceSourceStatement, type SequenceStatementSyntax } from '../sequence/parser.ts'
import { parseAccessibilityDirective } from '../shared/accessibility-directives.ts'
import { SequenceParticipantFold, type ParticipantEvent, type SequenceParticipantFoldOptions, type SequenceParticipantRecord } from '../sequence/participants.ts'
import { isCharacterReference, sequenceGrammarText } from '../sequence/family-source.ts'
import { isSequenceCommentLine, scanSequenceStatementLines, splitSequenceStatementLines } from '../sequence/statements.ts'
import { appendOpaqueSegment, coalesceOpaqueSegments } from './opaque-segments.ts'
import { writeMermaidComment } from '../shared/trailing-comment.ts'
import { normalizeSequenceMessageText, readSequenceText, writeSequenceText, writeSequenceControlledText } from '../sequence/text.ts'
import { readMetadataBlock } from '../shared/metadata-yaml.ts'
import { sequenceRectColor } from '../sequence/colors.ts'
import { DIAGRAM_WORK_LIMITS } from '../shared/diagram-limits.ts'

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
      if (declared.unmodeledMetadata?.length || declared.unknownType !== undefined) {
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

    if (syntax?.kind === 'create') {
      fold.applyAll(participantEventsOf(syntax))
      const created = typedCreate(syntax.declaration)
      // Metadata the body does not model stays verbatim, as a declaration's.
      if (created) statements.push(created)
      else appendOpaqueSegment(statements, [rawLine], sequenceOpaqueBlock)
      i++
      continue
    }

    if (syntax?.kind === 'destroy') {
      statements.push({ kind: 'destroy', actorId: syntax.actorId })
      i++
      continue
    }

    if (syntax?.kind === 'note') {
      fold.applyAll(participantEventsOf(syntax))
      const note = typedNote(syntax.note)
      if (note) statements.push(note)
      else appendOpaqueSegment(statements, [rawLine], sequenceOpaqueBlock)
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
      const fragment = parseTypedFragment(block, i)
      i = entry.endIndex! + 1
      for (const inner of block) fold.applyAll(participantEventsOf(inner.syntax))
      if (fragment) {
        statements.push({ kind: 'fragment', fragment })
      } else {
        appendOpaqueSegment(statements, blockLines, sequenceOpaqueBlock)
      }
      continue
    }

    // Any other unmodeled single line (activate/deactivate, autonumber,
    // title…) joins an adjacent opaque-block segment, kept
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
    from: msg.from, to: msg.to, text: text.value, style: sequenceMessageStyle(msg.arrow),
    ...(msg.wrap === undefined ? {} : { wrap: msg.wrap }),
    ...(text.content ? { textContent: text.content } : {}),
    arrow: msg.arrow as SequenceMessageArrow,
    ...(msg.centralStart ? { centralStart: true } : {}), ...(msg.centralEnd ? { centralEnd: true } : {}),
    ...(msg.activationMark === '+' ? { activate: true } : {}), ...(msg.activationMark === '-' ? { deactivate: true } : {}),
  }
}

/** A `create` line as a typed statement; one carrying metadata the body does
 * not model stays verbatim source, as a declaration does. */
function typedCreate(declaration: Extract<SequenceStatementSyntax, { kind: 'create' }>['declaration']): SequenceCreateStatement | undefined {
  const { id, label, type, keyword, wrap, unmodeledMetadata, unknownType } = declaration
  if (unmodeledMetadata?.length || unknownType !== undefined) return undefined
  const text = readSequenceText(label)
  return { kind: 'create', id, declaration: keyword, ...(type === keyword ? {} : { type }), label: text.value, ...(text.content ? { labelContent: text.content } : {}), ...(wrap === undefined ? {} : { wrap }) }
}

/** A note line as a typed note, when the typed writer can spell its
 * participants; otherwise it stays verbatim source. */
function typedNote(note: Extract<SequenceStatementSyntax, { kind: 'note' }>['note']): SequenceNoteStatement | undefined {
  const { position, actorIds, wrap } = note
  if (noteActorsError(position, actorIds)) return undefined
  const text = readSequenceText(note.text.trim())
  return {
    kind: 'note', position, actorIds: [...actorIds], text: text.value,
    ...(text.content ? { textContent: text.content } : {}), ...(wrap === undefined ? {} : { wrap }),
  }
}

/** Mermaid's note grammar: one participant, or two for `over`, each spelled
 * as a message receiver is. */
function noteActorsError(position: SequenceNotePosition, actorIds: readonly string[]): MutationError | undefined {
  if (actorIds.length < 1 || actorIds.length > (position === 'over' ? 2 : 1)) {
    return { code: 'INVALID_OP', message: 'A sequence note names one participant, or two when its position is "over"' }
  }
  for (const id of actorIds) {
    const invalid = actorIdError(id, 'receiver')
    if (invalid) return invalid
  }
  return undefined
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

/** A block as a typed fragment, or null when it holds a message or note
 * outside the model. Other lines stay verbatim in their branch, as at top
 * level. `offset` is the opener's index among the source statements (the
 * reader's block boundaries count from there); fragments nest as deep as the
 * host nesting limit. */
function parseTypedFragment(entries: SequenceSourceStatement[], offset: number, depth = 1): SequenceFragment | null {
  const syntax = entries[0]?.syntax
  const opener = syntax?.kind === 'block' ? syntax.opener : undefined
  if (!opener || !['alt', 'opt', 'loop', 'par', 'par_over', 'critical', 'break', 'rect'].includes(opener.type)) return null
  if (depth > DIAGRAM_WORK_LIMITS.nesting) return null
  const fragmentKind = opener.type as SequenceFragment['fragmentKind']
  // A rect's argument is a color, kept as written. One the renderer does not
  // read as a color (a `#` comment, a wrap control) stays verbatim source.
  if (fragmentKind === 'rect' && (opener.wrap !== undefined || rectColorError(opener.label))) return null
  const branches: SequenceFragment['branches'] = [{ messages: [] }]
  // Adjacent preserved lines join one statement, as top-level segments do.
  const preserve = (lines: string[]): void => {
    const branch = branches.at(-1)!
    const list = branch.statements ??= []
    const last = list.at(-1)
    if (last?.before === branch.messages.length && last.statement.kind === 'opaque-block') last.statement.lines.push(...lines)
    else list.push({ before: branch.messages.length, statement: { kind: 'opaque-block', lines: [...lines] } })
  }
  for (let at = 1; at < entries.length - 1; at++) {
    const entry = entries[at]!
    const line = entry.raw.trim()
    if (!line) continue
    const inner = entry.syntax
    if (inner?.kind === 'continuation') {
      const continuation = inner.continuation
      const text = readSequenceText(continuation.label)
      branches.push({ ...(continuation.wrap === undefined ? {} : { wrap: continuation.wrap }), ...(text.value ? { label: text.value } : {}), ...(text.content ? { labelContent: text.content } : {}), messages: [] })
      continue
    }
    if (inner?.kind === 'block') {
      const end = entry.endIndex! - offset
      const nested = parseTypedFragment(entries.slice(at, end + 1), offset + at, depth + 1)
      if (!nested) return null
      const branch = branches.at(-1)!
      ;(branch.statements ??= []).push({ before: branch.messages.length, statement: { kind: 'fragment', fragment: nested } })
      at = end
      continue
    }
    if (inner?.kind === 'box') {
      // Mermaid reads a box in a fragment as it reads one at top level: it
      // groups the participants it declares, wherever it is written. A box
      // holds declarations only; anything else keeps the block opaque.
      const end = entry.endIndex! - offset
      const box = entries.slice(at, end + 1)
      if (box.slice(1, -1).some(({ raw, syntax }) => syntax ? syntax.kind !== 'declaration' : raw.trim() && !isSequenceCommentLine(raw))) return null
      preserve(box.map(({ raw }) => raw))
      at = end
      continue
    }
    if (inner?.kind === 'create' || inner?.kind === 'destroy' || inner?.kind === 'note') {
      const statement = inner.kind === 'destroy' ? { kind: 'destroy' as const, actorId: inner.actorId }
        : inner.kind === 'note' ? typedNote(inner.note) : typedCreate(inner.declaration)
      // A note stays countable; a `create` with metadata the body does not
      // model stays verbatim, as at top level.
      if (!statement && inner.kind === 'note') return null
      if (!statement) { preserve([entry.raw]); continue }
      const branch = branches.at(-1)!
      ;(branch.statements ??= []).push({ before: branch.messages.length, statement })
      continue
    }
    if (inner?.kind === 'message') {
      branches.at(-1)!.messages.push(sequenceMessageFromParsed(inner.message))
      continue
    }
    // Any other line (a comment, activate/deactivate, autonumber, a
    // declaration…) stays verbatim in its branch.
    preserve([entry.raw])
  }
  if (fragmentKind === 'rect') return { fragmentKind, ...(opener.label ? { label: opener.label } : {}), branches, rawLines: entries.map(portableRaw) }
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

/** Where a fragment sits: the `fragmentPath` steps the fragment ops take to
 * the branch holding it (empty at top level) and its `fragmentIndex` among
 * that scope's fragments. */
export interface SequenceFragmentPlace {
  fragment: SequenceFragment
  fragmentPath: SequenceFragmentStep[]
  fragmentIndex: number
}

/** The branch a message, note or lifecycle line is written in. */
export interface SequenceBranchPlace extends SequenceFragmentPlace { branchIndex: number }

/** The typed statements in drawing order, each with the address its ops
 * take: a message's or note's `index` is its top-level index or its index in
 * its branch; a fragment comes before its contents. */
export type SequenceTimelineEntry =
  | { kind: 'message'; message: SequenceMessage; index: number; place?: SequenceBranchPlace }
  | { kind: 'note'; note: SequenceNoteStatement; index: number; place?: SequenceBranchPlace }
  | { kind: 'lifecycle'; statement: SequenceCreateStatement | SequenceDestroyStatement; place?: SequenceBranchPlace }
  | { kind: 'fragment'; place: SequenceFragmentPlace }

export function sequenceTimeline(body: SequenceBody): SequenceTimelineEntry[] {
  const out: SequenceTimelineEntry[] = []
  const visit = (fragment: SequenceFragment, fragmentPath: SequenceFragmentStep[], fragmentIndex: number): void => {
    const place = { fragment, fragmentPath, fragmentIndex }
    out.push({ kind: 'fragment', place })
    fragment.branches.forEach((branch, branchIndex) => {
      const at = { ...place, branchIndex }
      const path = [...fragmentPath, { fragmentIndex, branchIndex }]
      let message = 0
      let note = 0
      let nested = 0
      for (const item of branchItems(branch)) {
        if (!('kind' in item)) out.push({ kind: 'message', message: item, index: message++, place: at })
        else if (item.kind === 'note') out.push({ kind: 'note', note: item, index: note++, place: at })
        else if (item.kind === 'fragment') visit(item.fragment, path, nested++)
        else if (item.kind !== 'opaque-block') out.push({ kind: 'lifecycle', statement: item, place: at })
      }
    })
  }
  let note = 0
  let fragmentIndex = 0
  for (const statement of body.statements) {
    if (statement.kind === 'message') {
      const message = body.messages[statement.ref]
      if (message) out.push({ kind: 'message', message, index: statement.ref })
    } else if (statement.kind === 'note') out.push({ kind: 'note', note: statement, index: note++ })
    else if (statement.kind === 'create' || statement.kind === 'destroy') out.push({ kind: 'lifecycle', statement })
    else if (statement.kind === 'fragment') visit(statement.fragment, [], fragmentIndex++)
  }
  return out
}

/** A fragment's name in facts: `F` at top level, and for a nested fragment
 * each step's fragment and branch index before its own (`0.1.0` is fragment 0
 * of branch 1 of top-level fragment 0). */
export function sequenceFragmentName({ fragmentPath, fragmentIndex }: Pick<SequenceFragmentPlace, 'fragmentPath' | 'fragmentIndex'>): string {
  return [...fragmentPath.flatMap(step => [step.fragmentIndex, step.branchIndex]), fragmentIndex].join('.')
}

/** A message with its place in the timeline and the `index` the message ops
 * take for it: its top-level message index, or its index in its fragment
 * branch (with `fragmentIndex`, `branchIndex` and, for a nested fragment,
 * `fragmentPath`). */
export type SequenceMessageContext =
  | { scope: 'top-level'; message: SequenceMessage; index: number }
  | {
    scope: 'fragment'
    message: SequenceMessage
    index: number
    fragment: SequenceFragment
    fragmentPath?: SequenceFragmentStep[]
    fragmentIndex: number
    branchIndex: number
    fragmentKind: SequenceFragment['fragmentKind']
    fragmentLabel?: string
    branchLabel?: string
  }

/** Preserve control-flow location while exposing messages for read-back. */
export function sequenceMessageContexts(body: SequenceBody): SequenceMessageContext[] {
  return sequenceTimeline(body).flatMap((entry): SequenceMessageContext[] => {
    if (entry.kind !== 'message') return []
    const { message, index, place } = entry
    if (!place) return [{ scope: 'top-level', message, index }]
    const { fragment, fragmentPath, fragmentIndex, branchIndex } = place
    const branch = fragment.branches[branchIndex]!
    return [{
      scope: 'fragment', message, index, fragment, ...(fragmentPath.length ? { fragmentPath } : {}), fragmentIndex, branchIndex,
      fragmentKind: fragment.fragmentKind,
      ...(fragment.label ? { fragmentLabel: fragment.label } : {}),
      ...(branch.label ? { branchLabel: branch.label } : {}),
    }]
  })
}

/** Messages in rendered interaction order. Use sequenceMessageContexts when
 * branch/fragment semantics matter. */
export function sequenceMessages(body: SequenceBody): SequenceMessage[] {
  return sequenceMessageContexts(body).map(context => context.message)
}


/** Each style's Mermaid arrow: the one place the two vocabularies meet. */
const STYLE_ARROWS: Readonly<Record<SequenceMessageStyle, SequenceMessageArrow>> = {
  sync: '->>', reply: '-->>', line: '->', 'line-dashed': '-->', async: '-)', 'async-dashed': '--)',
  lost: '-x', 'lost-dashed': '--x', bidirectional: '<<->>', 'bidirectional-dashed': '<<-->>',
}
const ARROW_STYLES = new Map(Object.entries(STYLE_ARROWS).map(([style, arrow]) => [arrow as string, style as SequenceMessageStyle]))

/** The style of a Mermaid arrow. A half-arrow has no style of its own; it
 * keeps its shaft, solid (sync) or dashed (reply). */
export function sequenceMessageStyle(arrow: string): SequenceMessageStyle {
  return ARROW_STYLES.get(arrow) ?? (arrow.includes('--') ? 'reply' : 'sync')
}

// ---- Verifier ---------------------------------------------------------------

/** The constructs preserved source lines hold, named once each in source
 * order (a fragment by its keyword), so a warning can say what the typed
 * body leaves out. Messages, branch lines, `end` and a box's declarations
 * belong to their block. */
export function sequencePreservedConstructs(lines: readonly string[]): string[] {
  const names = new Set<string>()
  const { statements } = readSequenceStatements([...lines])
  const depth: number[] = []
  for (const [index, entry] of statements.entries()) {
    const syntax = entry.syntax
    // Typed fragments nest as deep as the host work limit; deeper source
    // stays preserved, and says so.
    depth[index] = (entry.parent === undefined ? 0 : depth[entry.parent]!) + (syntax?.kind === 'block' ? 1 : 0)
    if (depth[index]! > DIAGRAM_WORK_LIMITS.nesting) names.add(`fragments nested past the host limit of ${DIAGRAM_WORK_LIMITS.nesting}`)
    if (!syntax) {
      if (entry.raw.trim() && !isSequenceCommentLine(entry.raw.trim())) names.add('unrecognized statement')
      continue
    }
    const name = syntax.kind === 'block' ? `${syntax.opener.type} fragment`
      : syntax.kind === 'activation' ? 'activate/deactivate'
        : syntax.kind === 'declaration' ? (entry.parent === undefined ? 'participant declaration' : undefined)
          : syntax.kind === 'links' || syntax.kind === 'actor-data' ? 'actor data'
            : syntax.kind === 'message' || syntax.kind === 'continuation' || syntax.kind === 'end' ? undefined
              : syntax.kind
    if (name) names.add(name)
  }
  return [...names]
}

/** Every preserved line of the body in source order: top-level segments and
 * the preserved lines of fragment branches. */
export function sequencePreservedLines(body: SequenceBody): string[] {
  return body.statements.flatMap(statement => statement.kind === 'opaque-block' ? statement.lines
    : statement.kind === 'fragment' ? [...preservedSegments(statement.fragment)].flatMap(({ segment }) => segment.lines) : [])
}

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
  for (const issue of sequenceLifecycleIssues(source.statements)) warnings.push({
    code: 'UNSUPPORTED_SYNTAX', syntax: issue.syntax, line: header + source.statements[issue.entry]!.line + 2, message: issue.message,
  })
  return warnings
}

/**
 * `create`/`destroy` directives pinned Mermaid rejects or binds elsewhere.
 * Ours binds a directive to the next message that creates (is received by)
 * or involves its participant, or, when no later message does, to the
 * message right after it, and ignores `create` of a participant that already
 * exists. Mermaid binds every directive of a stack to the message right after
 * it, requires that message to be the last directive's, and refuses to create
 * a known participant. Messages count in statement order, fragments included,
 * as in Mermaid. Mermaid's binding is the next entry of its message list, which
 * also holds notes, activations, `autonumber` and fragment boundaries; its
 * renderer draws nothing for a directive bound to one of those, where ours
 * draws it at its message.
 */
export function sequenceLifecycleIssues(statements: readonly SequenceSourceStatement[]): Array<{ entry: number; syntax: string; message: string }> {
  const issues: Array<{ entry: number; syntax: string; message: string }> = []
  const fold = new SequenceParticipantFold()
  let created: { id: string; entry: number } | undefined
  let destroyed: { id: string; entry: number } | undefined
  const messages: Array<{ from: string; to: string }> = []
  const directives: Array<{ kind: 'create' | 'destroy'; id: string; entry: number; next: number }> = []
  // Directives not yet followed by an entry of Mermaid's message list, and
  // those followed by an entry that is not a message.
  let unbound: number[] = []
  const interrupted = new Map<number, string>()
  statements.forEach((entry, index) => {
    const syntax = entry.syntax
    const signal = mermaidSignal(entry, statements)
    if (signal !== undefined) {
      if (syntax?.kind !== 'message') for (const directive of unbound) interrupted.set(directive, signal)
      unbound = []
    }
    if (syntax?.kind === 'create' || syntax?.kind === 'destroy') unbound.push(index)
    if (syntax?.kind === 'create') {
      const { id } = syntax.declaration
      if (fold.has(id)) issues.push({
        entry: index, syntax: 'sequence_create_known_participant',
        message: `"create" names participant "${id}", which already exists; ours keeps the existing participant. Pinned Mermaid rejects this ("It is not possible to have actors with the same id"); create a new ID, or declare "${id}" without "create".`,
      })
      else directives.push({ kind: 'create', id, entry: index, next: messages.length })
      created = { id, entry: index }
    } else if (syntax?.kind === 'destroy') {
      directives.push({ kind: 'destroy', id: syntax.actorId, entry: index, next: messages.length })
      destroyed = { id: syntax.actorId, entry: index }
    } else if (syntax?.kind === 'message') {
      messages.push(syntax.message)
      const { from, to } = syntax.message
      // Mermaid checks a pending creation first, and a destruction only once
      // no creation is pending.
      if (created) {
        if (to !== created.id) issues.push({
          entry: created.entry, syntax: 'sequence_create_message',
          message: `The next message after "create" is not received by "${created.id}"; ours creates "${created.id}" at the next message it receives, or at this one when none does. Pinned Mermaid rejects this; put the "create" line directly above that message.`,
        })
        created = undefined
      } else if (destroyed) {
        if (from !== destroyed.id && to !== destroyed.id) issues.push({
          entry: destroyed.entry, syntax: 'sequence_destroy_message',
          message: `The next message after "destroy ${destroyed.id}" neither comes from nor goes to "${destroyed.id}"; ours ends "${destroyed.id}" at the next message it sends or receives, or at this one when none does. Pinned Mermaid rejects this; put the "destroy" line directly above that message.`,
        })
        destroyed = undefined
      }
    }
    fold.applyAll(participantEventsOf(syntax))
  })
  // A stacked directive whose participant is not in the message ending its
  // stack, but is in a later one: Mermaid accepts the stack and binds the
  // directive to the message right after it, where ours binds it later.
  // Mermaid's renderer draws a binding only for a participant its message
  // involves, so it draws nothing for this directive.
  const reported = new Set(issues.map(issue => issue.entry))
  for (const { kind, id, entry, next } of directives) {
    const signal = interrupted.get(entry)
    if (signal === undefined || reported.has(entry) || next >= messages.length) continue
    reported.add(entry)
    issues.push({
      entry, syntax: 'sequence_lifecycle_gap',
      message: `"${kind} ${id}" is followed by ${signal} before its message; ours ${kind === 'create' ? 'creates' : 'ends'} "${id}" at that message. Pinned Mermaid binds it to ${signal} and so draws no ${kind === 'create' ? 'creation' : 'destruction'} for "${id}". Move the line directly above the message.`,
    })
  }
  for (const { kind, id, entry, next } of directives) {
    const qualifies = (m: { from: string; to: string }) => kind === 'create' ? m.to === id : m.from === id || m.to === id
    if (reported.has(entry) || next >= messages.length || qualifies(messages[next]!) || !messages.slice(next + 1).some(qualifies)) continue
    issues.push({
      entry, syntax: 'sequence_stacked_lifecycle',
      message: `"${kind} ${id}" is stacked above a message ${kind === 'create' ? `"${id}" does not receive` : `without "${id}"`}; ours ${kind === 'create' ? 'creates' : 'ends'} "${id}" at its later message. Pinned Mermaid binds it to the message after the stack and so draws no ${kind === 'create' ? 'creation' : 'destruction'} for "${id}". Move the line directly above that later message.`,
    })
  }
  return issues
}

/** The entry a statement adds to Mermaid's message list, named for a
 * warning: a message, a note, an activation, `autonumber`, or a fragment's
 * opening, branch or closing line (a box adds none). */
function mermaidSignal(entry: SequenceSourceStatement, statements: readonly SequenceSourceStatement[]): string | undefined {
  const syntax = entry.syntax
  switch (syntax?.kind) {
    case 'message': return 'a message'
    case 'note': return 'a note'
    case 'activation': return `"${syntax.activate ? 'activate' : 'deactivate'} ${syntax.actorId}"`
    case 'autonumber': return '"autonumber"'
    case 'block': return `the "${syntax.opener.type}" line`
    case 'continuation': return `the "${syntax.continuation.type}" line`
    case 'end': return entry.closes !== undefined && statements[entry.closes]?.syntax?.kind === 'box' ? undefined : 'the "end" line'
    default: return undefined
  }
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
        lines.push(...preservedSource(st.lines))
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
      } else if (st.kind === 'create' || st.kind === 'destroy') {
        lines.push(renderDirective(st))
      } else if (st.kind === 'note') {
        lines.push(renderNote(st))
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

/** Preserved lines as written, a comment kept from reading as a directive. */
function preservedSource(lines: readonly string[]): string[] {
  assertParticipantDeclarations(readSequenceStatements(lines))
  return lines.map(line => isSequenceCommentLine(line) ? writeMermaidComment(line) : line)
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
    } else if (statement.kind === 'create' || statement.kind === 'destroy') {
      invalid = directiveIdError(statement)
    } else if (statement.kind === 'message') {
      const message = body.messages[statement.ref]
      if (message) invalid = messageIdError(message)
    } else if (statement.kind === 'note') {
      invalid = noteActorsError(statement.position, statement.actorIds)
    } else if (statement.kind === 'fragment') {
      for (const item of fragmentLeaves(statement.fragment)) {
        invalid = !('kind' in item) ? messageIdError(item) : item.kind === 'note' ? noteActorsError(item.position, item.actorIds)
          : item.kind === 'opaque-block' ? undefined : directiveIdError(item)
        if (invalid) return invalid
      }
    }
    if (invalid) return invalid
  }
  return undefined
}

function directiveIdError(statement: SequenceCreateStatement | SequenceDestroyStatement): MutationError | undefined {
  // Both directives spell the participant as one token.
  const id = directiveId(statement)
  return actorIdError(id, 'declaration') ?? (/\s/.test(id) ? { code: 'INVALID_OP', message: `Sequence participant ID "${id}" contains spaces; create and destroy need an ID without spaces` } : undefined)
}

const isDirective = (statement: { kind: string }): boolean => statement.kind === 'create' || statement.kind === 'destroy'
const directiveId = (statement: SequenceCreateStatement | SequenceDestroyStatement): string => statement.kind === 'create' ? statement.id : statement.actorId

type BranchItem = SequenceMessage | SequenceBranchStatementValue
type SequenceBranchStatementValue = NonNullable<SequenceFragmentBranch['statements']>[number]['statement']

/** A branch's messages, lifecycle directives, notes, nested fragments and
 * preserved lines in source order. */
export function sequenceBranchItems(branch: SequenceFragmentBranch): BranchItem[] {
  const at = (index: number) => (branch.statements ?? []).filter(entry => entry.before === index).map(entry => entry.statement)
  return [...branch.messages.flatMap((message, index) => [...at(index), message]), ...at(branch.messages.length)]
}
const branchItems = sequenceBranchItems

/** A fragment's messages, lifecycle directives, notes and preserved lines in
 * source order, those of its nested fragments included. */
function* fragmentLeaves(fragment: SequenceFragment): Generator<Exclude<BranchItem, SequenceFragmentStatement>> {
  for (const branch of fragment.branches) {
    for (const item of branchItems(branch)) {
      if ('kind' in item && item.kind === 'fragment') yield* fragmentLeaves(item.fragment)
      else yield item
    }
  }
}

export type SequenceNoteContext =
  | { scope: 'top-level'; note: SequenceNoteStatement; index: number }
  | { scope: 'fragment'; note: SequenceNoteStatement; index: number; fragmentPath?: SequenceFragmentStep[]; fragmentIndex: number; branchIndex: number }

/** Notes in drawing order, each with the `index` the note ops take: its
 * top-level note index, or its index among its branch's notes. */
export function sequenceNoteContexts(body: SequenceBody): SequenceNoteContext[] {
  return sequenceTimeline(body).flatMap((entry): SequenceNoteContext[] => {
    if (entry.kind !== 'note') return []
    const { note, index, place } = entry
    return [place ? { scope: 'fragment', note, index, ...(place.fragmentPath.length ? { fragmentPath: place.fragmentPath } : {}), fragmentIndex: place.fragmentIndex, branchIndex: place.branchIndex } : { scope: 'top-level', note, index }]
  })
}

/** A fragment's lines: as authored until an op edits it, else canonical. A
 * top-level fragment writes its body at its opener's depth; a nested
 * fragment's opener lines up with the statements beside it and its body is
 * one level deeper. */
function renderFragment(fragment: SequenceFragment, indent = '  ', nested = false): string[] {
  if (fragment.rawLines) {
    assertParticipantDeclarations(readSequenceStatements(fragment.rawLines))
    return [...fragment.rawLines]
  }
  const body = nested ? `${indent}  ` : indent
  const prefix = `${indent}${fragment.fragmentKind} `
  const opener = fragment.fragmentKind === 'rect' ? prefix + (fragment.label ?? '')
    : fragment.label || fragment.wrap !== undefined ? prefix + writeSequenceControlledText(fragment.label ?? '', fragment.labelContent, fragment.wrap, prefix) : prefix
  const lines = [opener.trimEnd()]
  fragment.branches.forEach((branch, index) => {
    if (index > 0) {
      const branchPrefix = `${indent}${BRANCH_KEYWORD[fragment.fragmentKind] ?? 'else'} `
      lines.push(branch.label || branch.wrap !== undefined ? branchPrefix + writeSequenceControlledText(branch.label ?? '', branch.labelContent, branch.wrap, branchPrefix) : branchPrefix.trimEnd())
    }
    for (const item of branchItems(branch)) {
      if ('kind' in item && item.kind === 'fragment') lines.push(...renderFragment(item.fragment, body, true))
      else if ('kind' in item && item.kind === 'opaque-block') lines.push(...atDepth(preservedSource(item.lines), body))
      else lines.push(body + (!('kind' in item) ? renderMessage(item) : item.kind === 'note' ? renderNote(item) : renderDirective(item)).trimStart())
    }
  })
  lines.push(`${indent}end`)
  return lines
}

/** Preserved branch lines written at the branch's depth, keeping their
 * indentation relative to each other. Only the line a statement starts on
 * moves: a statement's continuation lines keep their text. */
function atDepth(lines: readonly string[], indent: string): string[] {
  const starts = scanSequenceStatementLines(lines).map(span => span.line).filter(line => lines[line]!.trim())
  if (!starts.length) return [...lines]
  const leading = (line: string) => line.length - line.trimStart().length
  const shared = Math.min(...starts.map(line => leading(lines[line]!)))
  const moved = new Set(starts)
  return lines.map((line, index) => moved.has(index) ? indent + line.slice(shared) : line)
}

/** The line that starts each further branch of a multi-branch fragment. */
const BRANCH_KEYWORD: Partial<Record<SequenceFragment['fragmentKind'], string>> = { alt: 'else', par: 'and', par_over: 'and', critical: 'option' }

/** A rect's label is the fill color the renderer reads, or none. */
function rectColorError(label: string | undefined): MutationError | undefined {
  if (!label || sequenceRectColor(label)) return undefined
  return { code: 'INVALID_OP', message: `A rect fragment's label is its fill color; "${label}" is not a CSS color the renderer reads (use a color name, rgb(…) or rgba(…), or omit it)` }
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

function renderNote(note: SequenceNoteStatement): string {
  const prefix = `  Note ${note.position === 'over' ? 'over' : `${note.position} of`} ${note.actorIds.join(',')}: `
  return prefix + writeSequenceControlledText(note.text, note.textContent, note.wrap, prefix)
}

function renderDirective(statement: SequenceCreateStatement | SequenceDestroyStatement): string {
  return statement.kind === 'create' ? renderCreate(statement) : `  destroy ${statement.actorId}`
}

function renderCreate(statement: SequenceCreateStatement): string {
  // A type the keyword does not give is written as a declaration writes it.
  const metadata = statement.type !== undefined && statement.type !== statement.declaration ? `@{ "type": "${statement.type}" }` : ''
  const prefix = `  create ${statement.declaration} ${statement.id}${metadata}`
  const label = writeSequenceControlledText(statement.label, statement.labelContent, statement.wrap, `${prefix} as `)
  return `${prefix}${label !== statement.id ? ` as ${label}` : ''}`
}

function assertParticipantDeclarations(source: ReturnType<typeof readSequenceStatements>): void {
  const problem = source.issues.find(issue => issue.syntax === 'sequence_participant_id' || issue.syntax === 'sequence_participant_id_extension')
  if (problem) {
    const statement = source.statements.find(entry => entry.line === problem.line && entry.error instanceof SequenceParticipantIdError)
    throw new SequenceParticipantIdError(problem.message, { diagramType: 'sequence', line: problem.line + 1, column: statement === undefined ? undefined : statement.column + statement.raw.search(/\S/) + 1 })
  }
}

/** The participant ids a statement names, in the order Mermaid meets them. */
function statementParticipantIds(statement: SequenceStatement, participants: SequenceParticipant[], messages: SequenceMessage[]): string[] {
  const endpoints = (message: SequenceMessage | undefined) => message ? [message.from, message.to] : []
  switch (statement.kind) {
    case 'participant': return participants[statement.ref] ? [participants[statement.ref]!.id] : []
    case 'message': return endpoints(messages[statement.ref])
    case 'fragment': return [...fragmentLeaves(statement.fragment)].flatMap(item => !('kind' in item) ? endpoints(item) : item.kind === 'create' ? [item.id] : item.kind === 'note' ? [...item.actorIds]
      : item.kind === 'opaque-block' ? preservedIds(item.lines) : [])
    case 'actor-links': return [statement.actorId]
    case 'create': return [statement.id]
    // `destroy` refers to a participant without creating it.
    case 'destroy': return []
    case 'note': return [...statement.actorIds]
    case 'opaque-block': return preservedIds(statement.lines)
  }
}

const preservedIds = (lines: readonly string[]): string[] => lines.flatMap(line => preservedLineEvents(line).map(event => event.id))

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
  const prefix = `  ${from}${sequenceMessageArrow(m)}${to}:${m.to.toLowerCase() === 'title' ? '' : ' '}`
  return messageWithBoundary(m.from, prefix + writeSequenceControlledText(m.text, m.textContent, m.wrap, prefix))
}

/** The arrow a message is written with: its exact operator while that has
 * the message's style (half-arrows keep theirs), else the style's arrow, so
 * an edited style is never contradicted by a stale operator. */
export function sequenceMessageArrow(m: Pick<SequenceMessage, 'style' | 'arrow'>): SequenceMessageArrow {
  return m.arrow !== undefined && sequenceMessageStyle(m.arrow) === m.style ? m.arrow : STYLE_ARROWS[m.style]
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
  // Ops edit the body in place: keep the source the lifecycle check compares.
  const before = hasLifecycleDirective(body) ? renderedOrUndefined(body) : undefined
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
      const naming = noteStatements(statements).findIndex(({ statement }) => statement.actorIds.includes(op.id))
      if (naming >= 0) return err({ code: 'INVALID_OP', message: `Participant "${op.id}" is named by note ${naming}; remove that note (remove_note) before removing the participant` })
      participants.splice(idx, 1)
      // Drop messages touching the participant, then rebuild statements over
      // the surviving messages/participants (opaque blocks are preserved).
      const removedMsgIdx = new Set<number>()
      messages.forEach((m, mi) => { if (m.from === op.id || m.to === op.id) removedMsgIdx.add(mi) })
      const keptMessages = messages.filter((_, mi) => !removedMsgIdx.has(mi))
      const rebuilt: SequenceBody = { kind: 'sequence', participants, messages: keptMessages, statements: coalesceOpaqueSegments(rebuildStatements(statements, idx, removedMsgIdx, op.id)) }
      const invalid = lifecycleEditError(before, rebuilt)
      return invalid ? err(invalid) : ok(refolded(rebuilt))
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
      if (naming?.segment && relabelPreservedDeclaration(naming.segment, p)) {
        for (const holder of naming.holders) delete holder.rawLines
        break
      }
      // A participant its `create` line names is renamed there, in a
      // fragment branch too.
      const creating = naming === undefined ? statements[creatingStatement(statements, participants, messages, p.id)] : undefined
      const inFragment = creating?.kind === 'fragment' ? fragmentCreate(creating.fragment, p.id) : undefined
      const created = creating?.kind === 'create' ? creating : inFragment?.create
      if (created?.kind === 'create' && created.id === p.id) {
        for (const holder of inFragment?.holders ?? []) delete holder.rawLines
        created.label = p.label
        if (p.labelContent) created.labelContent = p.labelContent
        else delete created.labelContent
        break
      }
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
      const color = op.fragmentKind === 'rect' ? rectColorError(label.value) : undefined
      if (color) return err(color)
      const scope = fragmentScope(statements, op.fragmentPath)
      if (!scope.ok) return scope
      if (scope.value.enclosing.length >= DIAGRAM_WORK_LIMITS.nesting) return err({ code: 'INVALID_OP', message: `A sequence fragment nests at most ${DIAGRAM_WORK_LIMITS.nesting} deep` })
      const fragment: SequenceFragment = { fragmentKind: op.fragmentKind, ...(label.value ? { label: label.value } : {}), branches: [{ messages: [] }] }
      if (op.afterMessage !== undefined || op.beforeMessage !== undefined) {
        if (op.index !== undefined) return err({ code: 'INVALID_OP', message: 'Give a fragment index, afterMessage or beforeMessage, not more than one' })
        const placed = placeFragment(scope.value, statements, messages.length, op, fragment)
        if (!placed.ok) return placed
      } else {
        const count = scope.value.fragments.length
        const index = op.index ?? count
        if (!Number.isInteger(index) || index < 0 || index > count) return err({ code: 'INVALID_OP', message: `Sequence fragment index ${index} out of range (0..${count})${scope.value.where}` })
        scope.value.insert(index, fragment)
      }
      retire(scope.value)
      break
    }
    case 'move_fragment': {
      const target = editedFragment(statements, op.fragmentPath, op.index)
      if (!target.ok) return target
      const { scope, fragment } = target.value
      scope.remove(op.index)
      const placed = placeFragment(scope, statements, messages.length, op, fragment)
      if (!placed.ok) return placed
      retire(scope)
      break
    }
    case 'remove_fragment': {
      const target = editedFragment(statements, op.fragmentPath, op.index)
      if (!target.ok) return target
      target.value.scope.remove(op.index)
      retire(target.value.scope)
      break
    }
    case 'set_fragment_label': {
      const target = editedFragment(statements, op.fragmentPath, op.index)
      if (!target.ok) return target
      const { fragment } = target.value
      const label = normalizeFragmentLabel(op.label)
      if (!label.ok) return label
      const color = fragment.fragmentKind === 'rect' ? rectColorError(label.value) : undefined
      if (color) return err(color)
      // A matching setter can follow a direct body edit. Rebuild the source;
      // valid labelContent still preserves the label's authored spelling.
      retire(target.value.scope, fragment)
      if (fragment.label !== label.value || fragment.labelContent?.value !== fragment.label) delete fragment.labelContent
      if (label.value) fragment.label = label.value
      else delete fragment.label
      break
    }
    case 'add_fragment_branch': {
      const target = editedFragment(statements, op.fragmentPath, op.fragmentIndex)
      if (!target.ok) return target
      const { fragment } = target.value
      if (!BRANCH_KEYWORD[fragment.fragmentKind]) return err({ code: 'INVALID_OP', message: 'Only alt, par, par_over and critical fragments can have multiple branches' })
      const label = normalizeFragmentLabel(op.label)
      if (!label.ok) return label
      retire(target.value.scope, fragment)
      fragment.branches.push({ ...(label.value ? { label: label.value } : {}), messages: [] })
      break
    }
    case 'set_fragment_branch_label': {
      const target = editedBranch(statements, op.fragmentPath, op.fragmentIndex, op.branchIndex)
      if (!target.ok) return target
      const { fragment, branch } = target.value
      const label = normalizeFragmentLabel(op.label)
      if (!label.ok) return label
      const color = fragment.fragmentKind === 'rect' && op.branchIndex === 0 ? rectColorError(label.value) : undefined
      if (color) return err(color)
      target.value.retire()
      if (branch.label !== label.value || branch.labelContent?.value !== branch.label) delete branch.labelContent
      if (op.branchIndex === 0) {
        // Mermaid spells the first branch label on the fragment opener (`alt x`),
        // not on an `else`/`and` continuation line.
        if (fragment.label !== label.value || fragment.labelContent?.value !== fragment.label) delete fragment.labelContent
        if (label.value) fragment.label = label.value
        else delete fragment.label
        delete branch.label
      } else {
        if (label.value) branch.label = label.value
        else delete branch.label
      }
      break
    }
    case 'add_fragment_message': {
      const invalidId = messageIdError(op)
      if (invalidId) return err(invalidId)
      const target = editedBranch(statements, op.fragmentPath, op.fragmentIndex, op.branchIndex ?? 0)
      if (!target.ok) return target
      const { branch } = target.value
      const index = op.index ?? branch.messages.length
      if (!Number.isInteger(index) || index < 0 || index > branch.messages.length) return err({ code: 'INVALID_OP', message: `Sequence fragment message index ${index} out of range` })
      ensureParticipant(participants, op.from)
      ensureParticipant(participants, op.to)
      target.value.retire()
      branch.messages.splice(index, 0, { from: op.from, to: op.to, text: normalizeSequenceMessageText(op.text), style: op.style ?? 'sync', ...(op.wrap === undefined ? {} : { wrap: op.wrap }) })
      // As at top level, the new message takes the place of the one at
      // `index`, after the directives, notes and fragments above it.
      for (const entry of branch.statements ?? []) if (entry.before > index) entry.before++
      break
    }
    case 'remove_fragment_message':
    case 'set_fragment_message_wrap':
    case 'set_fragment_message_text': {
      const target = editedBranch(statements, op.fragmentPath, op.fragmentIndex, op.branchIndex ?? 0)
      if (!target.ok) return target
      const { branch } = target.value
      const message = branch.messages[op.index]
      if (!message) return err({ code: 'MESSAGE_NOT_FOUND', message: `No fragment message at index ${op.index}` })
      target.value.retire()
      if (op.kind === 'remove_fragment_message') {
        branch.messages.splice(op.index, 1)
        for (const entry of branch.statements ?? []) if (entry.before > op.index) entry.before--
      } else if (op.kind === 'set_fragment_message_wrap') {
        if (op.wrap === null) delete message.wrap
        else message.wrap = op.wrap
      } else {
        const text = normalizeSequenceMessageText(op.text)
        if (message.text !== text || message.textContent?.value !== message.text) delete message.textContent
        message.text = text
      }
      break
    }
    case 'add_note': {
      const invalid = noteActorsError(op.position, Array.isArray(op.actorIds) ? op.actorIds : [])
      if (invalid) return err(invalid)
      const missing = op.actorIds.find(id => !participants.some(p => p.id === id))
      if (missing !== undefined) return err({ code: 'PARTICIPANT_NOT_FOUND', message: `Participant "${missing}" not found; add it before placing a note on it` })
      const at = notePosition(statements, messages.length, op)
      if (!at.ok) return at
      statements.splice(at.value, 0, {
        kind: 'note', position: op.position, actorIds: [...op.actorIds], text: normalizeSequenceMessageText(op.text),
        ...(op.wrap === undefined ? {} : { wrap: op.wrap }),
      })
      break
    }
    case 'remove_note': {
      const target = noteStatements(statements)[op.index]
      if (!target) return err(noteNotFound(statements, op.index))
      statements.splice(target.position, 1)
      break
    }
    case 'set_note_text': {
      const target = noteStatements(statements)[op.index]
      if (!target) return err(noteNotFound(statements, op.index))
      const note = target.statement
      const text = normalizeSequenceMessageText(op.text)
      if (note.text !== text || note.textContent?.value !== note.text) delete note.textContent
      note.text = text
      break
    }
    case 'move_note': {
      const target = noteStatements(statements)[op.index]
      if (!target) return err(noteNotFound(statements, op.index))
      statements.splice(target.position, 1)
      const at = notePosition(statements, messages.length, op)
      if (!at.ok) return at
      statements.splice(at.value, 0, target.statement)
      break
    }
    case 'add_fragment_note': {
      const invalid = noteActorsError(op.position, Array.isArray(op.actorIds) ? op.actorIds : [])
      if (invalid) return err(invalid)
      const missing = op.actorIds.find(id => !participants.some(p => p.id === id))
      if (missing !== undefined) return err({ code: 'PARTICIPANT_NOT_FOUND', message: `Participant "${missing}" not found; add it before placing a note on it` })
      const target = editedBranch(statements, op.fragmentPath, op.fragmentIndex, op.branchIndex ?? 0)
      if (!target.ok) return target
      const { branch } = target.value
      const at = branchNotePosition(branch, op)
      if (!at.ok) return at
      target.value.retire()
      ;(branch.statements ??= []).splice(at.value.at, 0, { before: at.value.before, statement: {
        kind: 'note', position: op.position, actorIds: [...op.actorIds], text: normalizeSequenceMessageText(op.text),
        ...(op.wrap === undefined ? {} : { wrap: op.wrap }),
      } })
      break
    }
    case 'remove_fragment_note':
    case 'set_fragment_note_text':
    case 'move_fragment_note': {
      const target = editedBranch(statements, op.fragmentPath, op.fragmentIndex, op.branchIndex ?? 0)
      if (!target.ok) return target
      const { branch } = target.value
      const entries = branch.statements ?? []
      const notes = entries.filter(entry => entry.statement.kind === 'note')
      const entry = notes[op.index]
      if (!entry || entry.statement.kind !== 'note') return err({ code: 'INVALID_OP', message: `No note at index ${op.index} in branch ${op.branchIndex ?? 0} of sequence fragment ${op.fragmentIndex}${notes.length ? ` (0..${notes.length - 1})` : ' (the branch has no notes)'}` })
      target.value.retire()
      if (op.kind === 'set_fragment_note_text') {
        const note = entry.statement
        const text = normalizeSequenceMessageText(op.text)
        if (note.text !== text || note.textContent?.value !== note.text) delete note.textContent
        note.text = text
        break
      }
      entries.splice(entries.indexOf(entry), 1)
      if (op.kind === 'move_fragment_note') {
        const at = branchNotePosition(branch, op)
        if (!at.ok) return at
        entries.splice(at.value.at, 0, { before: at.value.before, statement: entry.statement })
      }
      break
    }
    default: {
      const _x: never = op
      return err({ code: 'INVALID_OP', message: unknownOpMessage('sequence', _x) })
    }
  }
  const next: SequenceBody = { kind: 'sequence', participants, messages, statements: coalesceOpaqueSegments(statements) }
  const invalid = serializationIdError(next) ?? lifecycleEditError(before, next)
  return invalid ? err(invalid) : ok(refolded(next))
}

function renderedOrUndefined(body: SequenceBody): string | undefined {
  try { return renderSequence(body) } catch { return undefined }
}

function hasLifecycleDirective(body: SequenceBody): boolean {
  const preserved = (lines: readonly string[]) => lines.some(line => /^\s*(?:create|destroy)\s/i.test(line))
  return body.statements.some(statement => statement.kind === 'create' || statement.kind === 'destroy'
    || (statement.kind === 'fragment' && [...fragmentLeaves(statement.fragment)].some(item => 'kind' in item && (item.kind === 'opaque-block' ? preserved(item.lines) : item.kind !== 'note')))
    || (statement.kind === 'opaque-block' && preserved(statement.lines)))
}

/** An edit may not leave a `create`/`destroy` without the message Mermaid
 * requires right after it. Source that already did keeps its issues. */
function lifecycleEditError(before: string | undefined, after: SequenceBody): MutationError | undefined {
  if (before === undefined) return undefined
  const issues = (rendered: string) => sequenceLifecycleIssues(readSequenceStatements(rendered.split('\n').slice(1)).statements).map(issue => issue.message)
  const known = issues(before)
  const added = issues(renderSequence(after)).find(message => !known.includes(message))
  return added === undefined ? undefined : { code: 'INVALID_OP', message: `This edit would leave sequence source Mermaid rejects: ${added}` }
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
 * declaration statement, or a preserved line that declares it with an alias
 * (at top level, or in a fragment branch: `segment`, in the fragments
 * `holders`). */
function namingDeclaration(statements: SequenceStatement[], ref: number, id: string): { index: number; preserved: boolean; segment?: SequencePreservedLines; holders: SequenceFragment[] } | undefined {
  // One naming rule (`as …` or a metadata alias), the parser's.
  const names = (line: string) => preservedLineEvents(line)
    .some(event => event.kind === 'declare' && event.id === id && event.label !== undefined && !event.create)
  for (let index = statements.length - 1; index >= 0; index--) {
    const statement = statements[index]!
    if (statement.kind === 'participant' && statement.ref === ref) return { index, preserved: false, holders: [] }
    if (statement.kind === 'opaque-block' && statement.lines.some(names)) return { index, preserved: true, segment: statement, holders: [] }
    const nested = statement.kind === 'fragment' ? [...preservedSegments(statement.fragment)].findLast(({ segment }) => segment.lines.some(names)) : undefined
    if (nested) return { index, preserved: true, ...nested }
  }
  return undefined
}

/** A fragment's preserved branch lines in source order, at any depth, each
 * with the fragments that hold it, outermost first. */
function* preservedSegments(fragment: SequenceFragment): Generator<{ segment: SequencePreservedLines; holders: SequenceFragment[] }> {
  for (const branch of fragment.branches) {
    for (const { statement } of branch.statements ?? []) {
      if (statement.kind === 'opaque-block') yield { segment: statement, holders: [fragment] }
      else if (statement.kind === 'fragment') for (const found of preservedSegments(statement.fragment)) yield { segment: found.segment, holders: [fragment, ...found.holders] }
    }
  }
}

/** Update the existing declaration inside a preserved segment. Adding a new
 * declaration after the entire segment can reset later actor properties or
 * duplicate box membership, even though every original source line survives. */
function relabelPreservedDeclaration(statement: SequencePreservedLines, participant: SequenceParticipant): boolean {
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
  const preserved = (lines: readonly string[]) => lines.some(line => !isSequenceCommentLine(line) && (names(line) || token.test(line)))
  return statements.some(statement =>
    (statement.kind === 'opaque-block' && preserved(statement.lines))
    || (statement.kind === 'fragment' && [...fragmentLeaves(statement.fragment)].some(item => !('kind' in item) ? item.from === id || item.to === id
      : item.kind === 'note' ? item.actorIds.includes(id) : item.kind === 'opaque-block' ? preserved(item.lines) : directiveId(item) === id)))
}

function cloneStatement(s: SequenceStatement): SequenceStatement {
  if (s.kind === 'opaque-block') return { kind: 'opaque-block', lines: [...s.lines] }
  if (s.kind === 'actor-links') return { ...s, links: { ...s.links } }
  if (s.kind === 'note') return { ...s, actorIds: [...s.actorIds] }
  if (s.kind === 'fragment') {
    return { kind: 'fragment', fragment: { ...s.fragment, branches: s.fragment.branches.map(branch => ({
      ...branch, messages: branch.messages.map(message => ({ ...message })),
      ...(branch.statements ? { statements: branch.statements.map(({ before, statement: inner }) => ({ before, statement: cloneStatement(inner) as typeof inner })) } : {}),
    })) } }
  }
  return { ...s }
}

/** The `create` line of participant `id` in a fragment, at any depth, with
 * the fragments that hold it, outermost first. */
function fragmentCreate(fragment: SequenceFragment, id: string): { create: SequenceCreateStatement; holders: SequenceFragment[] } | undefined {
  for (const branch of fragment.branches) {
    for (const { statement } of branch.statements ?? []) {
      if (statement.kind === 'create' && statement.id === id) return { create: statement, holders: [fragment] }
      const found = statement.kind === 'fragment' ? fragmentCreate(statement.fragment, id) : undefined
      if (found) return { create: found.create, holders: [fragment, ...found.holders] }
    }
  }
  return undefined
}

/** The fragments of one scope, the top level or the branch an op's
 * `fragmentPath` reaches, in source order; `enclosing` are the fragments
 * around it, whose authored spelling an edit inside retires. */
interface FragmentScope {
  fragments: SequenceFragment[]
  /** The branch `fragmentPath` reaches; none at top level. */
  branch?: SequenceFragmentBranch
  enclosing: SequenceFragment[]
  /** ` in fragment#… branch#…` for a nested scope, for messages. */
  where: string
  /** Insert a fragment before fragment `index`, or after everything. */
  insert(index: number, fragment: SequenceFragment): void
  remove(index: number): void
}

function fragmentScope(statements: SequenceStatement[], path: readonly SequenceFragmentStep[] | undefined): Result<FragmentScope, MutationError> {
  if (path !== undefined && !Array.isArray(path)) return err({ code: 'INVALID_OP', message: 'Sequence fragmentPath must be an array of { fragmentIndex, branchIndex } steps' })
  const top = statements.flatMap((statement, position) => statement.kind === 'fragment' ? [{ position, statement }] : [])
  let scope: FragmentScope = {
    fragments: top.map(entry => entry.statement.fragment), enclosing: [], where: '',
    insert: (index, fragment) => { statements.splice(top[index]?.position ?? statements.length, 0, { kind: 'fragment', fragment }) },
    remove: index => { statements.splice(top[index]!.position, 1) },
  }
  const steps: SequenceFragmentStep[] = []
  for (const step of path ?? []) {
    const { fragmentIndex, branchIndex } = typeof step === 'object' && step !== null ? step : { fragmentIndex: undefined, branchIndex: undefined }
    const fragment = scope.fragments[fragmentIndex as number]
    if (!fragment) return err({ code: 'INVALID_OP', message: `No sequence fragment at index ${fragmentIndex}${scope.where} (fragmentPath step ${steps.length}; ${countText(scope.fragments.length, 'fragment')})` })
    const branch = fragment.branches[branchIndex as number]
    const name = sequenceFragmentName({ fragmentPath: steps, fragmentIndex: fragmentIndex! })
    if (!branch) return err({ code: 'INVALID_OP', message: `No branch ${branchIndex} in sequence fragment#${name} (fragmentPath step ${steps.length}; ${countText(fragment.branches.length, 'branch')})` })
    steps.push({ fragmentIndex: fragmentIndex!, branchIndex: branchIndex! })
    scope = { ...branchScope(branch), branch, enclosing: [...scope.enclosing, fragment], where: ` in fragment#${name} branch#${branchIndex}` }
  }
  return ok(scope)
}

function branchScope(branch: SequenceFragmentBranch): Pick<FragmentScope, 'fragments' | 'insert' | 'remove'> {
  const entries = (branch.statements ?? []).filter((entry): entry is { before: number; statement: SequenceFragmentStatement } => entry.statement.kind === 'fragment')
  return {
    fragments: entries.map(entry => entry.statement.fragment),
    insert: (index, fragment) => {
      const list = branch.statements ??= []
      const next = entries[index]
      if (next) list.splice(list.indexOf(next), 0, { before: next.before, statement: { kind: 'fragment', fragment } })
      else list.push({ before: branch.messages.length, statement: { kind: 'fragment', fragment } })
    },
    remove: index => { branch.statements!.splice(branch.statements!.indexOf(entries[index]!), 1) },
  }
}

const countText = (count: number, noun: string): string => count ? `0..${count - 1}` : `no ${noun === 'branch' ? 'branches' : `${noun}s`} there`

/** The fragment `index` of the scope `path` reaches, which an op is about to
 * edit (`retire` it and its scope first). */
function editedFragment(statements: SequenceStatement[], path: readonly SequenceFragmentStep[] | undefined, index: number): Result<{ scope: FragmentScope; fragment: SequenceFragment }, MutationError> {
  const scope = fragmentScope(statements, path)
  if (!scope.ok) return scope
  const fragment = scope.value.fragments[index]
  if (!fragment) return err({ code: 'INVALID_OP', message: `No sequence fragment at index ${index}${scope.value.where}` })
  return ok({ scope: scope.value, fragment })
}

/** Branch `branchIndex` of that fragment, with `retire` for the fragment. */
function editedBranch(statements: SequenceStatement[], path: readonly SequenceFragmentStep[] | undefined, fragmentIndex: number, branchIndex: number): Result<{ fragment: SequenceFragment; branch: SequenceFragmentBranch; retire(): void }, MutationError> {
  const target = editedFragment(statements, path, fragmentIndex)
  if (!target.ok) return target
  const { scope, fragment } = target.value
  const branch = fragment.branches[branchIndex]
  if (!branch) return err({ code: 'INVALID_OP', message: `No branch ${branchIndex} in sequence fragment ${fragmentIndex}${scope.where}` })
  return ok({ fragment, branch, retire: () => retire(scope, fragment) })
}

/** An edit inside a fragment rewrites it and every fragment around it. */
function retire(scope: FragmentScope, fragment?: SequenceFragment): void {
  for (const enclosing of scope.enclosing) delete enclosing.rawLines
  if (fragment) delete fragment.rawLines
}

/** Put a fragment where a note with the same anchors would go, among the
 * statements of its scope; with neither anchor, after everything. */
function placeFragment(scope: FragmentScope, statements: SequenceStatement[], messageCount: number, anchor: { afterMessage?: number; beforeMessage?: number }, fragment: SequenceFragment): Result<void, MutationError> {
  if (scope.branch) {
    const at = branchNotePosition(scope.branch, anchor, 'fragment')
    if (!at.ok) return at
    ;(scope.branch.statements ??= []).splice(at.value.at, 0, { before: at.value.before, statement: { kind: 'fragment', fragment } })
  } else {
    const at = notePosition(statements, messageCount, anchor, 'fragment')
    if (!at.ok) return at
    statements.splice(at.value, 0, { kind: 'fragment', fragment })
  }
  return ok(undefined)
}

function noteStatements(statements: SequenceStatement[]): Array<{ position: number; statement: SequenceNoteStatement }> {
  const out: Array<{ position: number; statement: SequenceNoteStatement }> = []
  statements.forEach((statement, position) => { if (statement.kind === 'note') out.push({ position, statement }) })
  return out
}

function noteNotFound(statements: SequenceStatement[], index: number): MutationError {
  const count = noteStatements(statements).length
  return { code: 'INVALID_OP', message: `No top-level sequence note at index ${index}${count ? ` (0..${count - 1})` : ' (the diagram has no top-level notes)'}` }
}

/** Where a note (or a fragment) anchored to a top-level message goes: right
 * after message `afterMessage` and the notes already after it, right before
 * message `beforeMessage` and the create/destroy lines bound to it, or at the
 * end. */
function notePosition(statements: SequenceStatement[], messageCount: number, anchor: { afterMessage?: number; beforeMessage?: number }, subject: 'note' | 'fragment' = 'note'): Result<number, MutationError> {
  const { afterMessage, beforeMessage } = anchor
  if (afterMessage !== undefined && beforeMessage !== undefined) return err({ code: 'INVALID_OP', message: `Give a ${subject} afterMessage or beforeMessage, not both` })
  const index = afterMessage ?? beforeMessage
  if (index === undefined) return ok(statements.length)
  if (!Number.isInteger(index) || index < 0 || index >= messageCount) {
    return err({ code: anchorMissCode(subject), message: `No top-level message at index ${index}${messageCount ? ` (0..${messageCount - 1})` : ' (the diagram has no top-level messages)'}` })
  }
  let at = statements.findIndex(statement => statement.kind === 'message' && statement.ref === index)
  if (afterMessage !== undefined) {
    at++
    while (statements[at]?.kind === 'note') at++
  } else {
    while (at > 0 && (statements[at - 1]!.kind === 'create' || statements[at - 1]!.kind === 'destroy')) at--
  }
  return ok(at)
}

/** Where a note anchored to a branch message goes, as at top level (see
 * notePosition): its `before` message index and its place among the branch's
 * statements, which are kept in source order. */
function branchNotePosition(branch: SequenceFragmentBranch, anchor: { afterMessage?: number; beforeMessage?: number }, subject: 'note' | 'fragment' = 'note'): Result<{ before: number; at: number }, MutationError> {
  const { afterMessage, beforeMessage } = anchor
  if (afterMessage !== undefined && beforeMessage !== undefined) return err({ code: 'INVALID_OP', message: `Give a ${subject} afterMessage or beforeMessage, not both` })
  const entries = branch.statements ?? []
  const count = branch.messages.length
  const index = afterMessage ?? beforeMessage
  if (index === undefined) return ok({ before: count, at: entries.length })
  if (!Number.isInteger(index) || index < 0 || index >= count) {
    return err({ code: anchorMissCode(subject), message: `No message at index ${index} in this fragment branch${count ? ` (0..${count - 1})` : ' (the branch has no messages)'}` })
  }
  const before = afterMessage !== undefined ? index + 1 : index
  if (afterMessage !== undefined) {
    // Right after the message: past the notes already written below it.
    let at = entries.findIndex(entry => entry.before >= before)
    if (at < 0) at = entries.length
    while (entries[at]?.before === before && entries[at]!.statement.kind === 'note') at++
    return ok({ before, at })
  }
  // Right above the message: above the create/destroy lines bound to it.
  let at = entries.findIndex(entry => entry.before > before)
  if (at < 0) at = entries.length
  while (at > 0 && entries[at - 1]!.before === before && isDirective(entries[at - 1]!.statement)) at--
  return ok({ before, at })
}

/** A note anchor names a message that is not there; a fragment op refuses
 * the anchor itself. */
const anchorMissCode = (subject: 'note' | 'fragment'): MutationError['code'] => subject === 'note' ? 'MESSAGE_NOT_FOUND' : 'INVALID_OP'

function normalizeFragmentLabel(value: string | null | undefined): Result<string | undefined, MutationError> {
  if (value === null || value === undefined) return ok(undefined)
  if (typeof value !== 'string' || !value.trim() || /[\r\n]/.test(value)) return err({ code: 'INVALID_OP', message: 'Sequence fragment label must be a non-empty single line or null' })
  return ok(value.trim())
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
    if (s.kind === 'create' || s.kind === 'destroy') {
      if ((s.kind === 'create' ? s.id : s.actorId) !== removedParticipantId) out.push({ ...s })
      continue
    }
    // remove_participant refuses a participant a note names.
    if (s.kind === 'note') { out.push(cloneStatement(s)); continue }
    // message
    if (removedMsgIdx.has(s.ref)) continue
    let shift = 0
    for (const r of removedMsgIdx) if (r < s.ref) shift++
    out.push({ kind: 'message', ref: s.ref - shift })
  }
  return out
}
