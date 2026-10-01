import type { SequenceDiagram, Actor, Message, Block, Note, SequenceBoxGroup, SequenceActorType, SequenceMessageHead } from './types.ts'
import { normalizeBrTags } from '../multiline-utils.ts'
import { scanAccessibilityDirectives } from '../shared/accessibility-directives.ts'
import { isCssColorToken, sequenceRectColor } from './colors.ts'
import { isSequenceCommentLine, scanSequenceStatementLines, splitSequenceStatementLines, type SequenceSourceSpan } from './statements.ts'
import { metadataText, readMetadataBlock } from '../shared/metadata-yaml.ts'
import { syntaxError } from '../shared/syntax-error.ts'
import { continuationBelongsToBlock, parseSequenceBlockContinuation, parseSequenceBlockOpener, type SequenceBlockContinuation, type SequenceBlockOpener } from './block-keywords.ts'
import { SequenceParticipantFold, type ParticipantEvent } from './participants.ts'

// Mermaid's half-arrow heads have multi-character spellings. Keep complete
// tokens here, longest first in the regex, so a prefix cannot leak into an
// actor ID (for example `A-|/B` must address B, not /B).
const SEQUENCE_ARROW_HEADS = new Map<string, readonly [SequenceMessageHead, SequenceMessageHead]>([
  ['<<-->>', ['filled', 'filled']], ['<<->>', ['filled', 'filled']],
  ['-->>', ['none', 'filled']], ['->>', ['none', 'filled']],
  ['-->', ['none', 'none']], ['->', ['none', 'none']],
  ['--x', ['none', 'cross']], ['-x', ['none', 'cross']],
  ['--)', ['none', 'open']], ['-)', ['none', 'open']],
  ['--|\\', ['none', 'half-top']], ['-|\\', ['none', 'half-top']],
  ['--|/', ['none', 'half-bottom']], ['-|/', ['none', 'half-bottom']],
  ['--\\\\', ['none', 'stick-top']], ['-\\\\', ['none', 'stick-top']],
  ['--//', ['none', 'stick-bottom']], ['-//', ['none', 'stick-bottom']],
  ['/|--', ['half-bottom', 'none']], ['/|-', ['half-bottom', 'none']],
  ['\\|--', ['half-top', 'none']], ['\\|-', ['half-top', 'none']],
  ['//--', ['stick-bottom', 'none']], ['//-', ['stick-bottom', 'none']],
  ['\\\\--', ['stick-top', 'none']], ['\\\\-', ['stick-top', 'none']],
  // Preserve shorter pre-existing local spellings as compatibility aliases.
  ['--|', ['none', 'stick-top']], ['-|', ['none', 'stick-top']],
  ['--/', ['none', 'stick-bottom']], ['-/', ['none', 'stick-bottom']],
  ['--\\', ['none', 'stick-top']], ['-\\', ['none', 'stick-top']],
  ['|--', ['stick-top', 'none']], ['|-', ['stick-top', 'none']],
  ['/--', ['stick-bottom', 'none']], ['/-', ['stick-bottom', 'none']],
  ['\\--', ['stick-top', 'none']], ['\\-', ['stick-top', 'none']],
])

const arrowAlternatives = [...SEQUENCE_ARROW_HEADS.keys()]
  .sort((a, b) => b.length - a.length)
  .map(token => token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
  .join('|')
const SEQUENCE_MESSAGE_PREFIX_RE = new RegExp(String.raw`^(\S+?)(\(\))?\s*(${arrowAlternatives})`)
const SEQUENCE_SPACED_CENTRAL_START_PREFIX_RE = new RegExp(String.raw`^(\S+?)\s+(\(\))\s*(${arrowAlternatives})`)
const SEQUENCE_SPACED_CENTRAL_ACTOR_RE = /^[\p{L}\p{N}_.$@]+$/u
const SEQUENCE_SPACED_CENTRAL_RESERVED_SENDERS = new Set([
  'participant', 'actor', 'note', 'alt', 'else', 'loop', 'rect', 'opt',
  'par', 'and', 'end', 'activate', 'deactivate', 'autonumber', 'box',
  'create', 'destroy', 'link', 'links', 'critical', 'break', 'option', 'title',
  'over', 'off', 'properties', 'details', 'sequencediagram', 'par_over',
])
const SEQUENCE_SPACED_CENTRAL_RESERVED_RECEIVERS = new Set([
  ...SEQUENCE_SPACED_CENTRAL_RESERVED_SENDERS, 'acctitle', 'accdescr',
])

export interface ParsedSequenceMessageLine {
  from: string
  to: string
  arrow: string
  activationMark?: string
  label: string
  centralStart: boolean
  centralEnd: boolean
}

/** One message-line grammar shared by renderer and agent parsers. */
export function parseSequenceMessageLine(line: string): ParsedSequenceMessageLine | null {
  const adjacentMatch = line.match(SEQUENCE_MESSAGE_PREFIX_RE)
  const spacedMatch = adjacentMatch ? null : line.match(SEQUENCE_SPACED_CENTRAL_START_PREFIX_RE)
  const match = adjacentMatch ?? spacedMatch
  if (!match || !isMessageArrow(match[3]!)) return null
  // Mermaid interprets punctuation-bearing sender prefixes differently here
  // (or rejects them). Admit only IDs confirmed by the pinned oracle for this
  // narrow whitespace form; broader Sequence identity grammar belongs to #264.
  if (spacedMatch && (
    !SEQUENCE_SPACED_CENTRAL_ACTOR_RE.test(match[1]!)
    || /^(?:[0-9]+(?:\.[0-9]{1,2})?|\.[0-9]{1,2})$/.test(match[1]!)
    || SEQUENCE_SPACED_CENTRAL_RESERVED_SENDERS.has(match[1]!.toLowerCase())
  )) return null
  // A single scan after the arrow admits optional spaces around Mermaid's
  // central-connection and activation markers. Avoid adjacent optional \s*
  // regex groups, which can backtrack quadratically on a long malformed line.
  let tail = line.slice(match[0].length).trimStart()
  const centralEnd = tail.startsWith('()')
  if (centralEnd) tail = tail.slice(2).trimStart()
  const activationMark = tail[0] === '+' || tail[0] === '-' ? tail[0] : undefined
  // The sender-spaced central grammar does not combine with an activation
  // marker. Mermaid rejects this shape, so do not silently promote it to a
  // verified native message.
  if (spacedMatch && activationMark) return null
  if (activationMark) tail = tail.slice(1).trimStart()
  const colon = tail.indexOf(':')
  if (colon < 1) return null
  const to = tail.slice(0, colon).trimEnd()
  // The text may be empty (`A->>B:`), as upstream's; so it is when a `#`
  // comment follows the colon (`A->>B: #a#`).
  const label = tail.slice(colon + 1).trimStart()
  if (!to || /\s/.test(to)) return null
  if (spacedMatch && (
    /[+<>]/.test(to)
    || to.includes('()')
    || SEQUENCE_SPACED_CENTRAL_RESERVED_RECEIVERS.has(to.toLowerCase())
  )) return null
  return {
    from: match[1]!, arrow: match[3]!, activationMark,
    to, label, centralStart: Boolean(match[2]), centralEnd,
  }
}

// ============================================================================
// Sequence diagram parser
//
// Parses Mermaid sequenceDiagram syntax into a SequenceDiagram structure.
//
// Supported syntax:
//   participant A as Alice
//   actor B as Bob
//   A->>B: Solid arrow
//   A-->>B: Dashed arrow
//   A-)B: Open arrow
//   A--)B: Dashed open arrow
//   A->>+B: Activate target
//   A-->>-B: Deactivate source
//   loop Label ... end
//   alt Label ... else Label ... end
//   opt Label ... end
//   par Label ... and Label ... end
//   Note left of A: Text
//   Note right of A: Text
//   Note over A,B: Text
//   autonumber [off | <start> [<step>]]
//   box [<color>] [Label] ... end
//   create participant|actor X [as Label]
//   destroy X
// ============================================================================

/**
 * Parse a Mermaid sequence diagram.
 * Expects the first line to be "sequenceDiagram".
 *
 * `opts.showSequenceNumbers` (the wired sequence config key) starts the
 * diagram with autonumbering already on — exactly as if the body opened with
 * an `autonumber` directive — so numbering config reaches every surface that
 * parses through here (SVG layout and ASCII alike). An explicit `autonumber`
 * directive in the body still takes precedence from its own line on.
 */
export function parseSequenceDiagram(lines: string[], opts: { showSequenceNumbers?: boolean } = {}): SequenceDiagram {
  const accessibility = scanAccessibilityDirectives(splitSequenceStatementLines(lines))
  lines = accessibility.familyLines.map(line => line.trim()).filter(Boolean)
  const diagram: SequenceDiagram = {
    actors: [],
    messages: [],
    blocks: [],
    notes: [],
    activationEvents: [],
    boxes: [],
    ...(accessibility.accessibility.title !== undefined
      ? { accessibilityTitle: normalizeBrTags(accessibility.accessibility.title) }
      : {}),
    ...(accessibility.accessibility.descr !== undefined
      ? { accessibilityDescription: normalizeBrTags(accessibility.accessibility.descr) }
      : {}),
  }

  // The participants, created and named by the shared creation rules.
  const participants = new SequenceParticipantFold()
  // Lifecycle bindings (`create X` / `destroy X`), by actor id.
  const createdAt = new Map<string, number>()
  const destroyedAt = new Map<string, number>()
  const source = readSequenceStatements(lines.slice(1))
  const boundaryIssue = source.issues.find(issue => issue.syntax === 'sequence_block_boundary')
  if (boundaryIssue) throw new Error(`SEQUENCE_BLOCK_BOUNDARY: line ${boundaryIssue.line + 2}: ${boundaryIssue.message}`)
  // Render data is keyed by shared statement identity, not another scope parser.
  const blocks = new Map<number, { type: Block['type']; label: string; color?: string; startIndex: number; dividers: Block['dividers'] }>()
  // Active autonumber state; null = numbering off
  let autonumber: { next: number; step: number } | null = opts.showSequenceNumbers === true ? { next: 1, step: 1 } : null
  // Actors awaiting their binding message (`create X` / `destroy X` directives
  // take effect at the NEXT message that involves the actor)
  const pendingCreates: string[] = []
  const pendingDestroys: string[] = []

  const pushMessage = (message: ParsedSequenceMessageLine): void => {
    const { from, to } = message
    const endpoint = parseMessageArrow(message.arrow)
    const msg: Message = {
      from,
      to,
      label: normalizeBrTags(message.label.trim()),
      lineStyle: endpoint.lineStyle,
      startHead: endpoint.startHead,
      endHead: endpoint.endHead,
      centralStart: message.centralStart,
      centralEnd: message.centralEnd,
    }

    // Activation/deactivation via +/- prefix on target
    if (message.activationMark === '+') msg.activate = true
    if (message.activationMark === '-') msg.deactivate = true

    if (autonumber) {
      msg.number = autonumber.next
      // Upstream allows decimal steps to the hundredth; round so float drift
      // can't leak into labels.
      autonumber.next = Math.round((autonumber.next + autonumber.step) * 100) / 100
    }

    // Bind pending create/destroy directives to this message when it involves
    // the actor (upstream ties creation to the message the actor receives and
    // destruction to the next message it sends or receives).
    bindLifecycle(pendingCreates, id => id === to, id => createdAt.set(id, diagram.messages.length))
    bindLifecycle(pendingDestroys, id => id === from || id === to, id => destroyedAt.set(id, diagram.messages.length))

    diagram.messages.push(msg)
  }

  for (const [index, entry] of source.statements.entries()) {
    const line = entry.raw.trim()
    if (entry.error) throw entry.error
    const statement = entry.syntax
    if (!statement) {
      // Sequence's existing generous universal-directive policy keeps valid
      // messages after an unclosed accDescr opener; verify diagnoses the
      // preserved opener rather than treating it as family syntax.
      if (accessibility.unclosedIndex !== undefined && line === accessibility.familyLines[accessibility.unclosedIndex]?.trim()) continue
      if (line && !isSequenceCommentLine(line)) throw new Error(`SEQUENCE_UNSUPPORTED_STATEMENT: line ${entry.line + 2}: ${line}`)
      continue
    }
    participants.applyAll(participantEventsOf(statement))

    switch (statement.kind) {
    // --- Participant / Actor declaration, including Mermaid 11 metadata;
    //     `create participant|actor X` binds at the next message X receives. ---
    case 'declaration':
    case 'create': {
      if (statement.kind === 'create') pendingCreates.push(statement.declaration.id)
      break
    }

    // --- Safe actor menus (`link` and JSON `links`) and undrawn actor data
    //     (`properties`, `details`): the fold records what they create. ---
    case 'links':
    case 'actor-data':
      break

    // --- title <text> (Mermaid's sequence title statement) ---
    case 'title':
      diagram.title = normalizeBrTags(statement.text)
      break

    // --- autonumber [off | <start> [<step>]] ---
    case 'autonumber':
      autonumber = statement.numbering
      break

    // --- box [<color>] [Label] … end ---
    case 'box': {
      const rest = statement.text
      const box: SequenceBoxGroup = { actorIds: [] }
      // The leading token is a color when it IS one (color functions may
      // contain spaces, so match them before splitting on whitespace);
      // `box transparent <label>` is the upstream escape hatch for labels
      // that look like colors.
      const fnColor = rest.match(/^((?:rgb|rgba|hsl|hsla)\([^)]*\))\s*(.*)$/i)
      let label = rest
      if (fnColor && isCssColorToken(fnColor[1]!)) {
        box.color = fnColor[1]!
        label = fnColor[2]?.trim() ?? ''
      } else {
        const firstWord = rest.split(/\s+/, 1)[0] ?? ''
        if (firstWord && isCssColorToken(firstWord)) {
          box.color = firstWord
          label = rest.slice(firstWord.length).trim()
        }
      }
      if (label) box.label = normalizeBrTags(label)
      // Boxes never nest; the fold places the actors of the statements
      // inside (upstream's `currentBox`).
      diagram.boxes!.push(box)
      participants.openBox(box)
      break
    }

    // --- destroy lifecycle directive ---
    case 'destroy':
      pendingDestroys.push(statement.actorId)
      break

    // --- Note ---
    case 'note': {
      const { note } = statement
      diagram.notes.push({
        actorIds: note.actorIds,
        text: normalizeBrTags(note.text),
        position: note.position,
        afterIndex: diagram.messages.length - 1,
      })
      break
    }

    // --- Block start: loop, alt, opt, par, critical, break, rect ---
    case 'block': {
      const { opener } = statement
      // Keep the pre-existing `par_over` render disposition until that
      // separate upstream construct receives its own semantic slice.
      const blockType = opener.type === 'par_over' ? 'par' : opener.type
      // The old `par` prefix match exposed the untouched `_over...` suffix as
      // its label. Keep that exact spacing/punctuation until `par_over` gains
      // its own native semantics; the shared classifier trims opener labels.
      const label = opener.type === 'rect'
        ? ''
        : normalizeBrTags(opener.type === 'par_over' ? `_over${line.slice(8)}`.trim() : opener.label)
      // Mermaid permits a bare `rect` (default fill). A hash comment after
      // the keyword also leaves the color empty; the shared statement scanner
      // already keeps its remainder out of the message stream.
      const rectArgument = opener.type === 'rect' && opener.label.startsWith('#') ? '' : opener.label
      const color = opener.type === 'rect' ? sequenceRectColor(rectArgument) : undefined
      if (opener.type === 'rect' && rectArgument && !color) {
        throw new Error('SEQUENCE_RECT_COLOR_UNSUPPORTED: rect requires a safe concrete CSS color')
      }
      blocks.set(index, {
        type: blockType,
        label,
        ...(color ? { color } : {}),
        startIndex: diagram.messages.length,
        dividers: [],
      })
      break
    }

    // --- Block divider: else, and, option (only on their owning blocks) ---
    case 'continuation': {
      const top = entry.parent !== undefined ? blocks.get(entry.parent) : undefined
      if (top) {
        top.dividers.push({ index: diagram.messages.length, label: normalizeBrTags(statement.continuation.label) })
      }
      break
    }

    // --- Block end, else box end (boxes only wrap participant
    //     declarations, so an `end` with no open block closes the open box) ---
    case 'end': {
      const completed = blocks.get(entry.closes!)
      if (completed) {
        diagram.blocks.push({
          type: completed.type,
          label: completed.label,
          ...(completed.color ? { color: completed.color } : {}),
          startIndex: completed.startIndex,
          endIndex: Math.max(diagram.messages.length - 1, completed.startIndex),
          dividers: completed.dividers,
        })
      } else {
        participants.closeBox()
      }
      break
    }

    // --- Message. Full recognition keeps endpoint semantics out of actor IDs. ---
    case 'message':
      pushMessage(statement.message)
      break

    // --- activate / deactivate explicit commands (they create no actor) ---
    case 'activation':
      diagram.activationEvents!.push({
        actorId: statement.actorId,
        kind: statement.activate ? 'activate' : 'deactivate',
        messageIndex: diagram.messages.length,
      })
      break
    }
  }

  diagram.actors = participants.list().map(({ id, label, type, links, box }) => ({
    id, label, type,
    ...(links ? { links } : {}),
    ...(box !== undefined ? { box } : {}),
    ...(createdAt.has(id) ? { createMessageIndex: createdAt.get(id)! } : {}),
    ...(destroyedAt.has(id) ? { destroyMessageIndex: destroyedAt.get(id)! } : {}),
  }))
  return diagram
}

/** One sequence statement, classified by the grammar the renderer parser and
 * the typed body both read. Context (which block is open) is the caller's. */
export type SequenceStatementSyntax =
  | { kind: 'declaration'; declaration: ParsedActorDeclaration }
  | { kind: 'create'; declaration: Pick<Actor, 'id' | 'label' | 'type'> }
  | { kind: 'destroy'; actorId: string }
  | { kind: 'links'; actorId: string; links: Record<string, string> }
  /** `properties A: {…}` / `details A: <element id>`: actor data the
   * renderer does not draw, but the statement still creates the actor. */
  | { kind: 'actor-data'; actorId: string }
  | { kind: 'title'; text: string }
  | { kind: 'autonumber'; numbering: { next: number; step: number } | null }
  | { kind: 'box'; text: string }
  | { kind: 'note'; note: Pick<Note, 'actorIds' | 'text' | 'position'> }
  | { kind: 'block'; opener: { type: Exclude<SequenceBlockOpener, 'box'>; label: string } }
  | { kind: 'continuation'; continuation: { type: SequenceBlockContinuation; label: string } }
  | { kind: 'end' }
  | { kind: 'message'; message: ParsedSequenceMessageLine }
  | { kind: 'activation'; actorId: string; activate: boolean }

export interface SequenceSourceStatement extends SequenceSourceSpan {
  syntax: SequenceStatementSyntax | null
  /** Statement index of the containing block/box and matching boundaries. */
  parent?: number
  endIndex?: number
  closes?: number
  error?: unknown
}

export interface SequenceReadIssue {
  line: number
  syntax: string
  message: string
}

/** A lossless, scope-aware grammar view shared by both projections. The
 * parser alone decides which opener owns an end or branch continuation. */
export function readSequenceStatements(lines: readonly string[]): { statements: SequenceSourceStatement[]; issues: SequenceReadIssue[] } {
  const statements: SequenceSourceStatement[] = scanSequenceStatementLines(lines).map(span => {
    if (!span.raw.trim() || isSequenceCommentLine(span.raw)) return { ...span, syntax: null }
    try { return { ...span, syntax: parseSequenceStatement(span.raw.trim()) } }
    catch (error) { return { ...span, syntax: null, error } }
  })
  const stack: number[] = []
  const issues: SequenceReadIssue[] = []
  const issue = (entry: SequenceSourceStatement, syntax: string, message: string): void => { issues.push({ line: entry.line, syntax, message }) }
  for (const [index, entry] of statements.entries()) {
    const { syntax } = entry
    if (stack.length) entry.parent = stack.at(-1)!
    if (!syntax) {
      if (entry.raw.trim() && !isSequenceCommentLine(entry.raw)) issue(entry, 'sequence_statement', `Sequence statement is preserved in source but not drawn: ${entry.raw.trim()}`)
      continue
    }
    if (syntax.kind === 'block' || syntax.kind === 'box') {
      stack.push(index)
    } else if (syntax.kind === 'end') {
      const closes = stack.pop()
      if (closes === undefined) issue(entry, 'sequence_block_boundary', 'Sequence end has no open block or box')
      else { entry.closes = closes; statements[closes]!.endIndex = index }
    } else if (syntax.kind === 'continuation') {
      const parent = entry.parent !== undefined ? statements[entry.parent]!.syntax : null
      if (parent?.kind !== 'block' || !continuationBelongsToBlock(syntax.continuation.type, parent.opener.type)) {
        issue(entry, 'sequence_block_boundary', `Sequence ${syntax.continuation.type} does not belong to the enclosing block`)
      }
    } else if (syntax.kind === 'declaration' && syntax.declaration.unmodeledMetadata?.length) {
      issue(entry, 'sequence_participant_metadata', `Participant metadata fields ${syntax.declaration.unmodeledMetadata.join(', ')} are not modeled; the declaration is preserved as source`)
    }
  }
  for (const index of stack) issue(statements[index]!, 'sequence_block_boundary', 'Sequence block or box is never closed by end')
  return { statements, issues }
}

/** Classify one trimmed statement line, or null when it is no sequence
 * statement. */
export function parseSequenceStatement(line: string): SequenceStatementSyntax | null {
  const declaration = parseActorDeclaration(line)
  if (declaration) return { kind: 'declaration', declaration }
  const links = parseActorLinks(line)
  if (links) return { kind: 'links', ...links }
  const actorData = line.match(/^(?:properties|details)\s+(\S+)\s*:/i)
  if (actorData) return { kind: 'actor-data', actorId: actorData[1]! }
  const title = line.match(/^title(?:\s*:\s*|\s+)(.+)$/i)
  if (title) return { kind: 'title', text: title[1]!.trim() }
  const autonumber = line.match(/^autonumber(?:\s+(.*))?$/i)
  if (autonumber) {
    const rest = autonumber[1]?.trim() ?? ''
    if (/^off$/i.test(rest)) return { kind: 'autonumber', numbering: null }
    const nums = rest.match(/^(\d+(?:\.\d+)?)(?:\s+(\d+(?:\.\d+)?))?$/)
    if (rest && !nums) return null
    if (nums && (!Number.isFinite(Number(nums[1])) || (nums[2] !== undefined && !Number.isFinite(Number(nums[2]))))) return null
    return {
      kind: 'autonumber',
      numbering: {
        next: nums ? Number.parseFloat(nums[1]!) : 1,
        step: nums?.[2] !== undefined ? Number.parseFloat(nums[2]) : 1,
      },
    }
  }
  const box = line.match(/^box(?:\s+(.*))?$/i)
  if (box) return { kind: 'box', text: box[1]?.trim() ?? '' }
  const created = parseSequenceCreateLine(line)
  if (created) return { kind: 'create', declaration: created }
  const destroy = line.match(/^destroy\s+(\S+)$/i)
  if (destroy) return { kind: 'destroy', actorId: destroy[1]! }
  const note = parseSequenceNoteLine(line)
  if (note) return { kind: 'note', note }
  const opener = parseSequenceBlockOpener(line)
  if (opener && opener.type !== 'box') return { kind: 'block', opener: { type: opener.type, label: opener.label } }
  const continuation = parseSequenceBlockContinuation(line)
  if (continuation) return { kind: 'continuation', continuation }
  if (line === 'end') return { kind: 'end' }
  const message = parseSequenceMessageLine(line)
  if (message) return { kind: 'message', message }
  const activation = line.match(/^(activate|deactivate)\s+(\S+)$/i)
  if (activation) return { kind: 'activation', actorId: activation[2]!, activate: activation[1]!.toLowerCase() === 'activate' }
  return null
}

/** What a classified statement does to the participants, in upstream's
 * order (see ./participants.ts): a message mentions its sender, then its
 * receiver; a note its actors; `link`/`links`/`properties`/`details` its
 * actor. `activate`, `deactivate` and `destroy` create nothing. */
export function participantEventsOf(statement: SequenceStatementSyntax | null): ParticipantEvent[] {
  switch (statement?.kind) {
    case 'declaration': {
      const { id, label, type, keyword, aliased } = statement.declaration
      return [{ kind: 'declare', id, keyword, type, ...(aliased ? { label } : {}) }]
    }
    case 'create': {
      // Creating a known participant is an upstream error, never a rename.
      const { id, label, type } = statement.declaration
      return [{ kind: 'declare', id, keyword: type === 'actor' ? 'actor' : 'participant', type, label, create: true }]
    }
    case 'links':
      return [{ kind: 'mention', id: statement.actorId }, { kind: 'links', id: statement.actorId, links: statement.links }]
    case 'actor-data':
      return [{ kind: 'mention', id: statement.actorId }]
    case 'note':
      return statement.note.actorIds.map(id => ({ kind: 'mention', id }))
    case 'message':
      return [{ kind: 'mention', id: statement.message.from }, { kind: 'mention', id: statement.message.to }]
    default:
      return []
  }
}

/** The participant events of one statement line (see participantEventsOf). */
export function sequenceParticipantEvents(line: string): ParticipantEvent[] {
  return participantEventsOf(parseSequenceStatement(line.trim()))
}

const ACTOR_TYPES = new Set<SequenceActorType>(['participant', 'actor', 'boundary', 'control', 'entity', 'database', 'collections', 'queue'])

/** A `participant`/`actor` declaration. `aliased` records whether it names the
 *  actor (`as …` or a metadata alias): Mermaid lets only a naming declaration
 *  change an actor that already exists. */
export type ParsedActorDeclaration = Pick<Actor, 'id' | 'label' | 'type'> & { keyword: 'participant' | 'actor'; aliased: boolean; unmodeledMetadata?: string[] }

export function parseActorDeclaration(line: string): ParsedActorDeclaration | null {
  const metadata = line.match(/^(participant|actor)\s+([^\s@]+)@\{/i)
  if (metadata) {
    const baseType = metadata[1]!.toLowerCase() as 'participant' | 'actor'
    const id = metadata[2]!
    // Upstream's CONFIG lexer and YAML reader (shared/metadata-yaml.ts): the
    // first `}` ends the block, and a block YAML rejects rejects the diagram.
    const block = readMetadataBlock(line, metadata[0].length - 1, 'sequence')
    const tail = block.ok ? line.slice(block.end + 1) : ''
    const naming = tail.match(/^\s+as(?:\s+(.*))?$/i)
    if (!block.ok || (tail.trim() !== '' && !naming)) {
      throw syntaxError({
        what: `Invalid participant metadata in "${line}": ${block.ok ? `unexpected "${tail.trim()}" after it` : block.message}`,
        expectedForm: 'a YAML mapping in @{…} with no "}" inside, then optionally `as <label>`',
        example: 'participant DB@{ "type": "database", "alias": "Orders" }',
      })
    }
    // `as` with no text names the actor "" upstream; keep that line unmodeled.
    const asText = naming ? naming[1]?.trim() || null : undefined
    if (asText === null) return null
    const { entries } = block
    const requestedType = entries.get('type')
    const requested = typeof requestedType === 'string' ? requestedType.toLowerCase() : baseType
    if (!ACTOR_TYPES.has(requested as SequenceActorType)) throw new Error(`Unknown sequence actor type '${requested}'`)
    const type = requested as SequenceActorType
    // Upstream's `addActor`: a truthy metadata alias names the actor unless
    // `as` gives a text other than the id (`B@{ "alias": "Y" } as B` is Y).
    const metadataAlias = metadataText(entries.get('alias'))
    const alias = metadataAlias !== undefined && (asText === undefined || asText === id) ? metadataAlias : asText
    const unmodeledMetadata = [...entries.keys()].filter(key => key !== 'type' && key !== 'alias')
    return {
      id, label: normalizeBrTags(alias ?? id), type, keyword: baseType, aliased: alias !== undefined,
      ...(unmodeledMetadata.length ? { unmodeledMetadata } : {}),
    }
  }
  if (line.includes('@{')) return null
  const ordinary = line.match(/^(participant|actor)\s+(\S+?)(?:\s+as\s+(.+))?$/i)
  if (!ordinary) return null
  const id = ordinary[2]!
  const keyword = ordinary[1]!.toLowerCase() as 'participant' | 'actor'
  return { id, label: normalizeBrTags(ordinary[3]?.trim() ?? id), type: keyword, keyword, aliased: ordinary[3] !== undefined }
}

/** One `create participant|actor X [as Label]` grammar shared by renderer and
 *  agent parsers. */
export function parseSequenceCreateLine(line: string): Pick<Actor, 'id' | 'label' | 'type'> | null {
  const match = line.match(/^create\s+(participant|actor)\s+(\S+?)(?:\s+as\s+(.+))?$/i)
  if (!match) return null
  const id = match[2]!
  return { id, label: normalizeBrTags(match[3]?.trim() ?? id), type: match[1]!.toLowerCase() as 'participant' | 'actor' }
}

export function parseActorLinks(line: string): { actorId: string; links: Record<string, string> } | null {
  const single = line.match(/^link\s+(\S+)\s*:\s*(.+?)\s*@\s*(\S+)$/i)
  if (single) {
    if (!/^(?:https?:|mailto:)/i.test(single[3]!)) return null
    return { actorId: single[1]!, links: { [single[2]!.trim()]: single[3]! } }
  }
  const multiple = line.match(/^links\s+(\S+)\s*:\s*(\{.*\})$/i)
  if (!multiple) return null
  try {
    const parsed = JSON.parse(multiple[2]!) as Record<string, unknown>
    const links: Record<string, string> = {}
    for (const [label, href] of Object.entries(parsed)) if (typeof href === 'string' && /^(?:https?:|mailto:)/i.test(href)) links[label] = href
    return Object.keys(links).length > 0 ? { actorId: multiple[1]!, links } : null
  } catch { return null }
}

/** One note-line grammar shared by renderer and agent parsers:
 *  "Note left of A: text" / "Note right of A: text" / "Note over A,B: text". */
export function parseSequenceNoteLine(line: string): Pick<Note, 'actorIds' | 'text' | 'position'> | null {
  const match = line.match(/^Note\s+(left of|right of|over)\s+([^:]+):\s*(.*)$/i)
  if (!match) return null
  const placement = match[1]!.toLowerCase()
  return {
    actorIds: match[2]!.trim().split(',').map(id => id.trim()),
    text: match[3]!.trim(),
    position: placement === 'left of' ? 'left' : placement === 'right of' ? 'right' : 'over',
  }
}

function isMessageArrow(value: string): boolean {
  return SEQUENCE_ARROW_HEADS.has(value)
}

function parseMessageArrow(arrow: string): { lineStyle: 'solid' | 'dashed'; startHead: SequenceMessageHead; endHead: SequenceMessageHead } {
  const lineStyle = arrow.includes('--') ? 'dashed' : 'solid'
  const [startHead, endHead] = SEQUENCE_ARROW_HEADS.get(arrow) ?? ['none', 'none']
  return { lineStyle, startHead, endHead }
}

/** Bind any pending create/destroy directive whose actor participates in the
 *  message being parsed; unmatched directives stay pending (and stay inert if
 *  no later message ever involves the actor). */
function bindLifecycle(
  pending: string[],
  matches: (id: string) => boolean,
  bind: (id: string) => void,
): void {
  for (let i = pending.length - 1; i >= 0; i--) {
    const id = pending[i]!
    if (!matches(id)) continue
    bind(id)
    pending.splice(i, 1)
  }
}

/** The label a display surface should draw for a message: the autonumber
 *  prefix ("1. label") composed in exactly one place, shared by the SVG
 *  layout and the ASCII renderer so the surfaces cannot drift. */
export function displayMessageLabel(msg: Pick<Message, 'label' | 'number'>): string {
  return msg.number !== undefined ? `${msg.number}. ${msg.label}` : msg.label
}
