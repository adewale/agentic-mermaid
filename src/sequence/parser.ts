import { normalizeBrTags } from '../multiline-utils.ts'
import type { NormalizedMermaidSource } from '../mermaid-source.ts'
import { splitHeaderStatement } from '../mermaid-source-wrapper.ts'
import { scanAccessibilityDirectives } from '../shared/accessibility-directives.ts'
import { metadataText, readMetadataBlock } from '../shared/metadata-yaml.ts'
import { observeParserMutation, observeParserStatement, parserObservationActive } from '../shared/parser-observation.ts'
import { MermaidSyntaxError, syntaxError } from '../shared/syntax-error.ts'
import { toEntityMarkers } from '../shared/mermaid-entities.ts'
import { DeferredDependencyError } from '../layout/certification-error.ts'
import { continuationBelongsToBlock, parseSequenceBlockContinuation, parseSequenceBlockOpener, type SequenceBlockContinuation, type SequenceBlockOpener } from './block-keywords.ts'
import { readSequenceLabel, splitSequenceTextControl } from './text.ts'
import { concatDisplayText, prepareDisplayText, resolveLabelContent, type DisplayTextInput, type LabelContent } from '../shared/display-text.ts'
import { isCssColorToken, sequenceRectColor } from './colors.ts'
import { type ParticipantEvent, SequenceParticipantFold } from './participants.ts'
import { isSequenceCommentLine, type SequenceSourceSpan, scanSequenceStatementLines } from './statements.ts'
import type { Actor, Block, Message, Note, SequenceActorType, SequenceBoxGroup, SequenceDiagram, SequenceMessageHead } from './types.ts'

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
  // Preserve shorter pre-existing local spellings as compatibility aliases
  // (LOCAL_ARROW_ALIASES); Mermaid's lexer has none of these.
  ['--|', ['none', 'stick-top']], ['-|', ['none', 'stick-top']],
  ['--/', ['none', 'stick-bottom']], ['-/', ['none', 'stick-bottom']],
  ['--\\', ['none', 'stick-top']], ['-\\', ['none', 'stick-top']],
  ['|--', ['stick-top', 'none']], ['|-', ['stick-top', 'none']],
  ['/--', ['stick-bottom', 'none']], ['/-', ['stick-bottom', 'none']],
  ['\\--', ['stick-top', 'none']], ['\\-', ['stick-top', 'none']],
])

const LOCAL_ARROW_ALIASES = new Set(['--|', '-|', '--/', '-/', '--\\', '-\\', '|--', '|-', '/--', '/-', '\\--', '\\-'])
// The Mermaid arrow drawing what each local spelling draws: the same heads
// and line style.
const MERMAID_ARROW_FOR_LOCAL = new Map([...LOCAL_ARROW_ALIASES].map(local => {
  const [start, end] = SEQUENCE_ARROW_HEADS.get(local)!
  const mermaid = [...SEQUENCE_ARROW_HEADS].find(([token, heads]) => !LOCAL_ARROW_ALIASES.has(token)
    && heads[0] === start && heads[1] === end && token.includes('--') === local.includes('--'))![0]
  return [local, mermaid]
}))

const sequenceArrowTokens = [...SEQUENCE_ARROW_HEADS.keys()].sort((a, b) => b.length - a.length)
const arrowAlternatives = sequenceArrowTokens
  .map(token => token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
  .join('|')
const SEQUENCE_MESSAGE_PREFIX_RE = new RegExp(String.raw`^(\S+?)(\(\))?\s*(${arrowAlternatives})`)
const SEQUENCE_SPACED_CENTRAL_START_PREFIX_RE = new RegExp(String.raw`^(\S+?)\s+(\(\))\s*(${arrowAlternatives})`)
const SEQUENCE_SPACED_CENTRAL_RESERVED_SENDERS = new Set([
  'participant', 'actor', 'note', 'alt', 'else', 'loop', 'rect', 'opt',
  'par', 'and', 'end', 'activate', 'deactivate', 'autonumber', 'box',
  'create', 'destroy', 'link', 'links', 'critical', 'break', 'option', 'title',
  'over', 'off', 'properties', 'details', 'sequencediagram', 'par_over',
])
const SEQUENCE_SPACED_CENTRAL_RESERVED_RECEIVERS = new Set([
  ...SEQUENCE_SPACED_CENTRAL_RESERVED_SENDERS, 'acctitle', 'accdescr'])

// Mermaid's ACTOR token (sequenceDiagram.jison, "final_4.11"): it stops at
// `+`, `<`, `>`, `:`, `,`, `;` and at a dash that starts an arrow.
// Entity codes are atomic here: Mermaid protects them before its lexer, but
// our model retains their authored spelling and complete source offsets.
const MERMAID_SEQUENCE_ACTOR_RE = /(?:#\w+;|[^\/\\\+\()\+<\->\->:\n,;])+((?!(\-x|\-\-x|\-\)|\-\-\)|\-\|\\|\-\\|\-\/|\-\/\/|\-\|\/|\/\|\-|\\\|\-|\/\/\-|\\\\\-|\/\|\-|\-\-\|\\|\-\-|\(\)))[\-]*(?:#\w+;|[^\+<\->\->:\n,;])+)*/iy

/** The participant ID Mermaid's lexer reads at `index` in `line`, or ''. */
function mermaidSequenceActorAt(line: string, index: number): string {
  MERMAID_SEQUENCE_ACTOR_RE.lastIndex = index
  return MERMAID_SEQUENCE_ACTOR_RE.exec(line)?.[0].trim() ?? ''
}

/** Keep the token's physical end separate from its trimmed identity. Spaces
 * may belong inside an ACTOR token or precede the central-connection token. */
interface SequenceMessagePrefix { from: string; arrow: string; end: number; centralStart: boolean; spacedCentral: boolean }

function sequenceMessagePrefix(line: string): SequenceMessagePrefix | undefined {
  MERMAID_SEQUENCE_ACTOR_RE.lastIndex = 0
  const actor = MERMAID_SEQUENCE_ACTOR_RE.exec(line)
  if (!actor) return undefined
  let end = actor[0].length
  const central = line.startsWith('()', end)
  const spacedCentral = central && /\s$/.test(actor[0])
  if (central) end += 2
  while (end < line.length && /\s/.test(line[end]!)) end++
  const arrow = sequenceArrowTokens.find(token => line.startsWith(token, end))
  if (!arrow) return undefined
  end += arrow.length
  return { from: actor[0].trim(), arrow, end, centralStart: central, spacedCentral }
}

/** A typed writer must preserve an ID in the lexer state where it writes it.
 * Declarations admit IDs such as `accDescr` and `%`; message references admit
 * `@`, but cannot use a declaration keyword or consume the message colon. */
export function sequenceActorIdCanSerialize(id: string, context: 'declaration' | 'sender' | 'receiver'): boolean {
  if (!id || id.trim() !== id || /[\r\n]/.test(id)) return false
  const token = toEntityMarkers(id)
  if (token.startsWith('#')) return false
  if (context === 'declaration') return clearSequenceParticipantId(id) && !/:/.test(token) && !token.includes('%%{')
  if (token.startsWith('%') || token.includes('%%')) return false
  const keyword = token.toLowerCase()
  const leadingWord = /^(\w+)\b/.exec(keyword)?.[1]
  if (leadingWord && SEQUENCE_SPACED_CENTRAL_RESERVED_SENDERS.has(leadingWord)
    && (!['title', 'link', 'links', 'properties', 'details'].includes(leadingWord) || /\s/.test(keyword.slice(leadingWord.length, leadingWord.length + 1)))) return false
  if (/^(?:\d+(?:\.\d{1,2})?|\.\d{1,2})(?=\s)/.test(token)) return false
  if (SEQUENCE_SPACED_CENTRAL_RESERVED_SENDERS.has(keyword)
    && !['title', 'link', 'links', 'properties', 'details'].includes(keyword)) return false
  if (context === 'receiver' && ['acctitle', 'accdescr'].includes(keyword)) return false
  if (/^(?:left|right) of\b/.test(keyword)) return false
  return mermaidSequenceActorAt(`${token}${context === 'sender' ? '->>Z:' : ':'}`, 0) === token
}

export interface ParsedSequenceMessageLine {
  from: string
  to: string
  /** Mermaid's spelling of the arrow (see `localArrow`). */
  arrow: string
  /** A local arrow spelling Mermaid rejects, as authored; `arrow` draws the same. */
  localArrow?: string
  activationMark?: string
  label: string
  wrap?: boolean
  centralStart: boolean
  centralEnd: boolean
}

export interface SequenceBlockScope {
  /** Lexical boundaries, including fragments without any messages. */
  endMessageExclusive: number
  endNoteExclusive: number
  /** Note cursor at each else/and/option boundary, aligned with block.dividers. */
  dividerNoteIndices: number[]
  /** Indices into `diagram.notes` for notes authored inside this block's lexical scope. */
  noteIndices: number[]
  /** Indices into `diagram.blocks` for direct child blocks authored inside this block. */
  childBlockIndices: number[]
  /** Lexical section containing each direct child (zero is the first section). */
  childSectionIndices: number[]
}

const blockScopes = new WeakMap<Block, SequenceBlockScope>()
export interface SequenceBlockBoundary {
  kind: 'open' | 'divider' | 'close'
  blockIndex: number
  messageIndex: number
  noteIndex: number
  dividerIndex?: number
}
const blockBoundaries = new WeakMap<SequenceDiagram, SequenceBlockBoundary[]>()

export function getSequenceBlockBoundaries(diagram: SequenceDiagram): readonly SequenceBlockBoundary[] | undefined {
  return blockBoundaries.get(diagram)
}

/** Return the lexical scope (owned notes and direct child blocks) recorded for `block` during parsing. */
export function getSequenceBlockScope(block: Block): SequenceBlockScope | undefined {
  return blockScopes.get(block)
}

/** Native language projections retain lexical events that message intervals
 * alone cannot distinguish, including empty branches and adjacent notes. */
export function setSequenceBlockScope(block: Block, scope: SequenceBlockScope): void {
  blockScopes.set(block, scope)
}

export function setSequenceBlockBoundaries(diagram: SequenceDiagram, boundaries: SequenceBlockBoundary[]): void {
  blockBoundaries.set(diagram, boundaries)
}

/** One message-line grammar shared by renderer and agent parsers. */
export function parseSequenceMessageLine(line: string): ParsedSequenceMessageLine | null {
  let prefix = sequenceMessagePrefix(line)
  if (!prefix) {
    // Keep the reader's documented local arrow aliases. The official actor
    // token may consume those characters rather than stop at the local arrow.
    const adjacent = line.match(SEQUENCE_MESSAGE_PREFIX_RE)
    const legacy = adjacent ?? line.match(SEQUENCE_SPACED_CENTRAL_START_PREFIX_RE)
    if (legacy) prefix = { from: legacy[1]!, centralStart: Boolean(legacy[2]), arrow: legacy[3]!, end: legacy[0].length, spacedCentral: !adjacent }
  }
  if (!prefix || !isMessageArrow(prefix.arrow)) return null
  const { from, arrow, centralStart, spacedCentral } = prefix
  // Earlier lexer rules reserve numeric and statement-keyword prefixes in the
  // whitespace form of a central connection; they are not ACTOR tokens here.
  if (spacedCentral && (
    /^(?:[0-9]+(?:\.[0-9]{1,2})?|\.[0-9]{1,2})$/.test(from)
    || SEQUENCE_SPACED_CENTRAL_RESERVED_SENDERS.has(from.toLowerCase())
  )) return null
  // A single scan after the arrow admits optional spaces around Mermaid's
  // central-connection and activation markers. Avoid adjacent optional \s*
  // regex groups, which can backtrack quadratically on a long malformed line.
  let tail = line.slice(prefix.end).trimStart()
  const centralEnd = tail.startsWith('()')
  if (centralEnd) tail = tail.slice(2).trimStart()
  const activationMark = tail[0] === '+' || tail[0] === '-' ? tail[0] : undefined
  // The sender-spaced central grammar does not combine with an activation
  // marker. Mermaid rejects this shape, so do not silently promote it to a
  // verified native message.
  if (spacedCentral && activationMark) return null
  if (activationMark) tail = tail.slice(1).trimStart()
  const colon = tail.indexOf(':')
  if (colon < 1) return null
  const to = tail.slice(0, colon).trimEnd()
  // The text may be empty (`A->>B:`), as upstream's; so it is when a `#`
  // comment follows the colon (`A->>B: #a#`).
  const { text: label, wrap } = splitSequenceTextControl(tail.slice(colon + 1))
  if (!to) return null
  if (spacedCentral && (
    /[+<>]/.test(to)
    || to.includes('()')
    || SEQUENCE_SPACED_CENTRAL_RESERVED_RECEIVERS.has(to.toLowerCase())
  )) return null
  // Mermaid reads each participant ID as one lexer token. Where that token
  // ends inside our sender or receiver (`A->>B->>C`, `-xA->B`, `A--->>B`),
  // arrow tokens follow it where Mermaid expects text, so it rejects the
  // line, and what was meant is unclear: leave the statement unread. Where
  // Mermaid's sender runs on past our arrow, it reads another message.
  const grammar = toEntityMarkers(line)
  const fromToken = toEntityMarkers(from), toToken = toEntityMarkers(to)
  const receiverAt = toEntityMarkers(line.slice(0, line.length - tail.length)).length
  const sender = mermaidSequenceActorAt(grammar, 0)
  if (sender.length <= fromToken.length && (sender !== fromToken || mermaidSequenceActorAt(grammar, receiverAt) !== toToken)) return null
  return {
    from, arrow: MERMAID_ARROW_FOR_LOCAL.get(arrow) ?? arrow, activationMark,
    to, label, centralStart, centralEnd,
    ...(wrap === undefined ? {} : { wrap }),
    ...(LOCAL_ARROW_ALIASES.has(arrow) ? { localArrow: arrow } : {}),
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
 *
 * Errors name a statement's line: `opts.authoredLine(i)` for `lines[i]` when
 * the caller knows where its lines were authored (see authoredSequenceLine),
 * else its position in `lines`.
 */
export function parseSequenceDiagram(lines: string[], opts: { showSequenceNumbers?: boolean; wrap?: boolean; authoredLine?: (index: number) => number | undefined } = {}): SequenceDiagram {
  const spans = scanSequenceStatementLines(lines)
  const accessibility = scanAccessibilityDirectives(spans.map(span => span.raw))
  const kept = accessibility.familyLines.flatMap((line, index) => line.trim() ? [{ text: line.trim(), origin: spans[accessibility.familyOrigins[index]!]!.line }] : [])
  lines = kept.map(line => line.text)
  // The statement at `index` of `lines` (the header is 0) on its authored line.
  const lineOf = (index: number): number => {
    const origin = kept[index]?.origin ?? index
    return opts.authoredLine?.(origin) ?? origin + 1
  }
  if (parserObservationActive('sequence') && lines[0] !== undefined) observeParserStatement('sequence', 'header', lines[0], { line: 1, unit: 'normalized' })
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
  if (boundaryIssue) throw new Error(`SEQUENCE_BLOCK_BOUNDARY: line ${lineOf(boundaryIssue.line + 1)}: ${boundaryIssue.message}`)
  // Render data is keyed by shared statement identity, not another scope parser.
  const blocks = new Map<number, { type: Block['type']; wrap?: boolean; label: string; labelContent?: LabelContent; color?: string; startIndex: number; dividers: Block['dividers']; dividerNoteIndices: number[]; parent?: number; parentSection: number; noteIndices: number[]; childBlockIndices: number[]; childSectionIndices: number[] }>()
  const boundaries: Array<Omit<SequenceBlockBoundary, 'blockIndex'> & { blockId: number }> = []
  const blockIndexById = new Map<number, number>()
  // Visibility is independent of the message counter. Hiding or enabling it
  // does not erase step references; only an explicit start resets the value.
  const autonumber = { visible: opts.showSequenceNumbers === true, next: 1, step: 1 }
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
      ...readSequenceLabel(message.label.trim()),
      ...((message.wrap ?? opts.wrap) === undefined ? {} : { wrap: message.wrap ?? opts.wrap }),
      lineStyle: endpoint.lineStyle,
      startHead: endpoint.startHead,
      endHead: endpoint.endHead,
      centralStart: message.centralStart,
      centralEnd: message.centralEnd,
    }

    // Activation/deactivation via +/- prefix on target
    if (message.activationMark === '+') msg.activate = true
    if (message.activationMark === '-') msg.deactivate = true

    if (autonumber.visible) msg.number = autonumber.next
    // The authored precision contract is hundredths, including hidden steps.
    autonumber.next = Math.round((autonumber.next + autonumber.step) * 100) / 100

    // Bind pending create/destroy directives to this message when it involves
    // the actor (upstream ties creation to the message the actor receives and
    // destruction to the next message it sends or receives).
    bindLifecycle(pendingCreates, id => id === to, id => {
        createdAt.set(id, diagram.messages.length)
        if (parserObservationActive('sequence')) observeParserMutation('sequence', 'bind-create', { id, messageIndex: diagram.messages.length })
      },
    )
    bindLifecycle(pendingDestroys, id => id === from || id === to, id => {
        destroyedAt.set(id, diagram.messages.length)
        if (parserObservationActive('sequence')) observeParserMutation('sequence', 'bind-destroy', { id, messageIndex: diagram.messages.length })
      },
    )

    diagram.messages.push(msg)
    if (parserObservationActive('sequence')) observeParserMutation('sequence', 'add-message', msg)
  }

  for (const [index, entry] of source.statements.entries()) {
    const line = entry.raw.trim()
    if (parserObservationActive('sequence')) observeParserStatement('sequence', entry.syntax?.kind ?? 'unrecognized', entry.raw, { line: entry.line + 2, column: entry.column + 1, unit: 'normalized' })
    if (entry.error) throw entry.error
    const statement = entry.syntax
    if (!statement) {
      // Sequence's existing generous universal-directive policy keeps valid
      // messages after an unclosed accDescr opener; verify diagnoses the
      // preserved opener rather than treating it as family syntax.
      if (accessibility.unclosedIndex !== undefined && line === accessibility.familyLines[accessibility.unclosedIndex]?.trim()) continue
      if (line && !isSequenceCommentLine(line)) throw new Error(`SEQUENCE_UNSUPPORTED_STATEMENT: line ${lineOf(entry.line + 1)}: ${line}`)
      continue
    }
    for (const event of participantEventsOf(statement)) {
      participants.apply(event)
      if (parserObservationActive('sequence')) observeParserMutation('sequence', 'participant.apply', event)
    }

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
    case 'title': {
      const title = readSequenceLabel(statement.text)
      diagram.title = title.label
      diagram.titleContent = title.labelContent
      if (parserObservationActive('sequence')) observeParserMutation('sequence', 'set-title', diagram.title)
      break
    }

      // --- autonumber [off | <start> [<step>]] ---
      case 'autonumber':
      autonumber.visible = statement.numbering !== null
      if (statement.numbering?.next !== undefined) {
        autonumber.next = statement.numbering.next
        autonumber.step = statement.numbering.step ?? 1
      }
        if (parserObservationActive('sequence')) observeParserMutation('sequence', 'set-autonumber', autonumber)
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
      if (label) {
        const control = splitSequenceTextControl(label)
        Object.assign(box, readSequenceLabel(control.text))
        if ((control.wrap ?? opts.wrap) !== undefined) box.wrap = control.wrap ?? opts.wrap
      }
      // Boxes never nest; the fold places the actors of the statements
      // inside (upstream's `currentBox`).
      diagram.boxes!.push(box)
      participants.openBox(box)
        if (parserObservationActive('sequence')) observeParserMutation('sequence', 'open-box', { index: diagram.boxes!.length - 1, box })
        break
    }

      // --- destroy lifecycle directive ---
      case 'destroy':
      pendingDestroys.push(statement.actorId)
        if (parserObservationActive('sequence')) observeParserMutation('sequence', 'pending-destroy', statement.actorId)
      break

      // --- Note ---
      case 'note': {
      const { note } = statement
      const text = readSequenceLabel(note.text)
      const noteIndex = diagram.notes.length
      diagram.notes.push({
        actorIds: note.actorIds,
        text: text.label,
        ...((note.wrap ?? opts.wrap) === undefined ? {} : { wrap: note.wrap ?? opts.wrap }),
        ...(text.labelContent ? { textContent: text.labelContent } : {}),
        position: note.position,
        afterIndex: diagram.messages.length - 1,
        })
        if (parserObservationActive('sequence')) observeParserMutation('sequence', 'add-note', { note: diagram.notes.at(-1), parent: entry.parent })
      for (let p = entry.parent; p !== undefined; p = blocks.get(p)?.parent) {
        blocks.get(p)?.noteIndices.push(noteIndex)
      }
      break
    }

      // --- Block start: loop, alt, opt, par, critical, break, rect ---
      case 'block': {
      const { opener } = statement
      const blockType = opener.type
      const text = readSequenceLabel(opener.type === 'rect' ? '' : opener.label)
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
        ...text,
        ...((opener.wrap ?? opts.wrap) === undefined ? {} : { wrap: opener.wrap ?? opts.wrap }),
        ...(color ? { color } : {}),
        startIndex: diagram.messages.length,
        dividers: [],
        dividerNoteIndices: [],
        parent: entry.parent,
        parentSection: entry.parent === undefined ? 0 : (blocks.get(entry.parent)?.dividers.length ?? 0),
        noteIndices: [],
        childBlockIndices: [],
        childSectionIndices: [],
      })
      boundaries.push({ kind: 'open', blockId: index, messageIndex: diagram.messages.length, noteIndex: diagram.notes.length })
        if (parserObservationActive('sequence')) observeParserMutation('sequence', 'open-block', { id: index, block: blocks.get(index) })
      break
    }

      // --- Block divider: else, and, option (only on their owning blocks) ---
      case 'continuation': {
      const top = entry.parent !== undefined ? blocks.get(entry.parent) : undefined
      if (top) {
        boundaries.push({ kind: 'divider', blockId: entry.parent!, messageIndex: diagram.messages.length, noteIndex: diagram.notes.length, dividerIndex: top.dividers.length })
        top.dividerNoteIndices.push(diagram.notes.length)
        top.dividers.push({ index: diagram.messages.length, ...readSequenceLabel(statement.continuation.label), ...((statement.continuation.wrap ?? opts.wrap) === undefined ? {} : { wrap: statement.continuation.wrap ?? opts.wrap }) })
          if (parserObservationActive('sequence')) observeParserMutation('sequence', 'divide-block', { parent: entry.parent, divider: top.dividers.at(-1), type: statement.continuation.type })
      }
      break
    }

      // --- Block end, else box end (boxes only wrap participant
      //     declarations, so an `end` with no open block closes the open box) ---
      case 'end': {
      const completed = blocks.get(entry.closes!)
      if (completed) {
        const blockIndex = diagram.blocks.length
        blockIndexById.set(entry.closes!, blockIndex)
        boundaries.push({ kind: 'close', blockId: entry.closes!, messageIndex: diagram.messages.length, noteIndex: diagram.notes.length })
        const blockObj: Block = {
          type: completed.type,
          label: completed.label,
          ...(completed.wrap === undefined ? {} : { wrap: completed.wrap }),
          ...(completed.labelContent ? { labelContent: completed.labelContent } : {}),
          ...(completed.color ? { color: completed.color } : {}),
          startIndex: completed.startIndex,
          endIndex: Math.max(diagram.messages.length - 1, completed.startIndex),
          dividers: completed.dividers,
        }
        blockScopes.set(blockObj, {
          endMessageExclusive: diagram.messages.length,
          endNoteExclusive: diagram.notes.length,
          dividerNoteIndices: completed.dividerNoteIndices,
          noteIndices: completed.noteIndices,
          childBlockIndices: completed.childBlockIndices,
          childSectionIndices: completed.childSectionIndices,
        })
        if (completed.parent !== undefined) {
          blocks.get(completed.parent)?.childBlockIndices.push(blockIndex)
          blocks.get(completed.parent)?.childSectionIndices.push(completed.parentSection)
        }
        diagram.blocks.push(blockObj)
          if (parserObservationActive('sequence')) observeParserMutation('sequence', 'close-block', { id: entry.closes, parent: completed.parent, parentSection: completed.parentSection, block: blockObj, notes: completed.noteIndices, children: completed.childBlockIndices })
        } else {
        participants.closeBox()
          if (parserObservationActive('sequence')) observeParserMutation('sequence', 'close-box', null)
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
        if (parserObservationActive('sequence')) observeParserMutation('sequence', 'activation', diagram.activationEvents!.at(-1))
      break
    }
  }

  diagram.actors = participants.list().map(({ id, label, type, links, box, wrap }) => ({
    id, ...readSequenceLabel(label), type,
    ...((wrap ?? opts.wrap) === undefined ? {} : { wrap: wrap ?? opts.wrap }),
    ...(links ? { links } : {}),
    ...(box !== undefined ? { box } : {}),
    ...(createdAt.has(id) ? { createMessageIndex: createdAt.get(id)! } : {}),
    ...(destroyedAt.has(id) ? { destroyMessageIndex: destroyedAt.get(id)! } : {}),
  }))
  blockBoundaries.set(diagram, boundaries.map(({ blockId, ...boundary }) => ({ ...boundary, blockIndex: blockIndexById.get(blockId)! })),
  )
  return diagram
}

/** The authored line of `source.familyLines[index]`, matched in order from
 * the family header as verify matches canonical lines to authored ones, so a
 * renderer's error names the line verify reports. Computed on first use. */
export function authoredSequenceLine(source: Pick<NormalizedMermaidSource, 'familyLines' | 'originalText' | 'wrapperSource'>): (index: number) => number | undefined {
  let lines: (number | undefined)[] | undefined
  return index => {
    if (!lines) {
      const physical = source.originalText.split(/\r?\n/)
      const header = source.wrapperSource ? source.wrapperSource.split(/\r?\n/).length - 1 : 0
      // A statement on the header line is a family line of its own.
      const authored = physical.slice(header).flatMap((text, offset) =>
        (offset === 0 ? splitHeaderStatement(text).split('\n') : [text]).map(part => ({ text: part.trim(), line: header + offset + 1 })))
      let cursor = 0
      lines = source.familyLines.map(line => {
        const wanted = line.trim()
        for (let at = cursor; at < authored.length; at++) {
          // Text after an accDescr block's `}` is a family line of its own.
          const candidate = authored[at]!.text
          if (candidate !== wanted && candidate.slice(candidate.indexOf('}') + 1).trim() !== wanted) continue
          cursor = at + 1
          return authored[at]!.line
        }
        return undefined
      })
    }
    return lines[index]
  }
}

/** One sequence statement, classified by the grammar the renderer parser and
 * the typed body both read. Context (which block is open) is the caller's. */
export type SequenceStatementSyntax =
  | { kind: 'declaration'; declaration: ParsedActorDeclaration }
  | { kind: 'create'; declaration: Pick<Actor, 'id' | 'label' | 'type' | 'wrap'> }
  | { kind: 'destroy'; actorId: string }
  | { kind: 'links'; actorId: string; links: Record<string, string> }
  /** `properties A: {…}` / `details A: <element id>`: actor data the
   * renderer does not draw, but the statement still creates the actor. */
  | { kind: 'actor-data'; actorId: string }
  | { kind: 'title'; text: string }
  | { kind: 'autonumber'; numbering: { next?: number; step?: number } | null }
  | { kind: 'box'; text: string }
  | { kind: 'note'; note: Pick<Note, 'actorIds' | 'text' | 'position' | 'wrap'> }
  | { kind: 'block'; opener: { type: Exclude<SequenceBlockOpener, 'box'>; label: string; wrap?: boolean } }
  | { kind: 'continuation'; continuation: { type: SequenceBlockContinuation; label: string; wrap?: boolean } }
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
    catch (error) {
      if (error instanceof DeferredDependencyError) throw error
      return { ...span, syntax: null, error }
    }
  })
  const stack: number[] = []
  const issues: SequenceReadIssue[] = []
  const issue = (entry: SequenceSourceStatement, syntax: string, message: string): void => { issues.push({ line: entry.line, syntax, message }) }
  for (const [index, entry] of statements.entries()) {
    const { syntax } = entry
    if (stack.length) entry.parent = stack.at(-1)!
    if (!syntax) {
      if (entry.error instanceof SequenceParticipantIdError) issue(entry, 'sequence_participant_id', entry.error.message)
      else if (entry.raw.trim() && !isSequenceCommentLine(entry.raw)) issue(entry, 'sequence_statement', `Sequence statement is preserved in source but not drawn: ${entry.raw.trim()}`)
      continue
    }
    if (syntax.kind === 'block' || syntax.kind === 'box') {
      stack.push(index)
    } else if (syntax.kind === 'end') {
      const closes = stack.pop()
      if (closes === undefined) issue(entry, 'sequence_block_boundary', 'Sequence end has no open block or box')
      else { entry.closes = closes
        statements[closes]!.endIndex = index }
    } else if (syntax.kind === 'continuation') {
      const parent = entry.parent !== undefined ? statements[entry.parent]!.syntax : null
      if (parent?.kind !== 'block' || !continuationBelongsToBlock(syntax.continuation.type, parent.opener.type)) {
        issue(entry, 'sequence_block_boundary', `Sequence ${syntax.continuation.type} does not belong to the enclosing block`)
      }
    } else if (syntax.kind === 'declaration' && syntax.declaration.unmodeledMetadata?.length) {
      issue(entry, 'sequence_participant_metadata', `Participant metadata fields ${syntax.declaration.unmodeledMetadata.join(', ')} are not modeled; the declaration is preserved as source`)
    } else if (syntax.kind === 'message' && syntax.message.localArrow) {
      const { localArrow, arrow } = syntax.message
      issue(entry, 'sequence_local_arrow', `The arrow ${localArrow} is a local spelling pinned Mermaid does not read, so it rejects this line. Ours draws it as Mermaid's ${arrow} and writes ${arrow}`)
    } else if (syntax.kind === 'declaration' && syntax.declaration.unspacedAlias) {
      issue(entry, 'sequence_unspaced_alias', 'Participant text immediately following as is read as its alias. Pinned Mermaid can reject this or read it as part of the ID; write as <label> with a separating space')
    }
    if (syntax.kind === 'declaration' || syntax.kind === 'create') {
      const problem = sequenceParticipantIdProblem(syntax.declaration.id)
      if (problem) issue(entry, 'sequence_participant_id_extension', problem)
    }
    if (syntax.kind === 'message') {
      for (const [context, id] of [['sender', syntax.message.from], ['receiver', syntax.message.to]] as const) {
        if (!sequenceActorIdCanSerialize(id, context)) issue(entry, 'sequence_message_id_extension', `Participant "${id}" is read as the ${context}, but pinned Mermaid reads another token there; rename it before typed editing`)
      }
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
    // The numbering fold represents hundredths; accepting finer precision
    // would silently round an increment away or make the labels go backwards.
    const nums = rest.match(/^((?:\d+(?:\.\d{1,2})?|\.\d{1,2}))(?:\s+((?:\d+(?:\.\d{1,2})?|\.\d{1,2})))?$/)
    if (rest && !nums) return null
    if (nums && (!Number.isFinite(Number(nums[1])) || (nums[2] !== undefined && !Number.isFinite(Number(nums[2]))))) return null
    return {
      kind: 'autonumber',
      numbering: nums ? {
        next: Number.parseFloat(nums[1]!),
        ...(nums[2] === undefined ? {} : { step: Number.parseFloat(nums[2]) }),
      } : {},
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
  if (opener && opener.type !== 'box') return { kind: 'block', opener: { type: opener.type, label: opener.label, ...(opener.wrap === undefined ? {} : { wrap: opener.wrap }) } }
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
      const { id, label, type, keyword, aliased, wrap } = statement.declaration
      return [{ kind: 'declare', id, keyword, type, ...(aliased ? { label } : {}), ...(wrap === undefined ? {} : { wrap }) }]
    }
    case 'create': {
      // Creating a known participant is an upstream error, never a rename.
      const { id, label, type, wrap } = statement.declaration
      return [{ kind: 'declare', id, keyword: type === 'actor' ? 'actor' : 'participant', type, label, ...(wrap === undefined ? {} : { wrap }), create: true }]
    }
    case 'links':
      return [{ kind: 'mention', id: statement.actorId }, { kind: 'links', id: statement.actorId, links: statement.links },
      ]
    case 'actor-data':
      return [{ kind: 'mention', id: statement.actorId }]
    case 'note':
      return statement.note.actorIds.map(id => ({ kind: 'mention', id }))
    case 'message':
      return [{ kind: 'mention', id: statement.message.from }, { kind: 'mention', id: statement.message.to },
      ]
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
export type ParsedActorDeclaration = Pick<Actor, 'id' | 'label' | 'type' | 'wrap'> & { keyword: 'participant' | 'actor'; aliased: boolean; unmodeledMetadata?: string[]; unspacedAlias?: boolean }

function clearSequenceParticipantId(id: string): boolean {
  // Mermaid protects entity tokens before lexing. Their terminator is not
  // a declaration delimiter. A colon is also unambiguous in our declaration
  // grammar; preserve that authored identity even though Mermaid rejects it.
  return typeof id === 'string' && id !== '' && id.trim() === id && !/[<>,;@#\r\n]/.test(toEntityMarkers(id))
}

/** Strict admission for a newly written declaration. Native reads keep clear
 * colon IDs, but encoding or replacing them would change authored identity. */
export function sequenceParticipantIdProblem(id: string): string | null {
  const clear = clearSequenceParticipantId(id)
  if (clear && sequenceActorIdCanSerialize(id, 'declaration')) return null
  const reason = clear
    ? 'is read as authored, but pinned Mermaid rejects colons in declaration IDs'
    : 'has ambiguous declaration delimiters or whitespace'
  return `Sequence participant ID ${JSON.stringify(id)} ${reason}. Typed editing and serialization require a portable ID; rename this ID and its references, and put display punctuation in an alias`
}

export class SequenceParticipantIdError extends MermaidSyntaxError {}

function assertSequenceParticipantId(id: string): void {
  if (!clearSequenceParticipantId(id)) throw new SequenceParticipantIdError(sequenceParticipantIdProblem(id)!)
}

export function parseActorDeclaration(line: string): ParsedActorDeclaration | null {
  const metadata = line.match(/^(participant|actor)\s+([^\s@]+)\s*@\{/i)
  if (metadata) {
    const baseType = metadata[1]!.toLowerCase() as 'participant' | 'actor'
    const id = metadata[2]!
    assertSequenceParticipantId(id)
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
    const control = naming ? splitSequenceTextControl(naming[1] ?? '') : undefined
    const asText = control ? control.text || null : undefined
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
      id, label: alias ?? id, type, keyword: baseType, aliased: alias !== undefined,
      ...(control?.wrap === undefined ? {} : { wrap: control.wrap }),
      ...(unmodeledMetadata.length ? { unmodeledMetadata } : {}),
    }
  }
  if (line.includes('@{')) return null
  // The ID lexer recognizes an alias only after a single token. Otherwise
  // its wider rule consumes the complete name, including internal spaces.
  const ordinary = line.match(/^(participant|actor)\s+/i)
  if (!ordinary) return null
  const rest = line.slice(ordinary[0].length)
  const named = rest.match(/^(\S+?)\s+as(\s*)(.+)$/i)
  if (!named && (!rest || /\s/.test(rest) && /[<>:\n,;@]/.test(toEntityMarkers(rest)))) return null
  const id = named ? named[1]! : rest.trim()
  assertSequenceParticipantId(id)
  const keyword = ordinary[1]!.toLowerCase() as 'participant' | 'actor'
  const control = named?.[3] === undefined ? undefined : splitSequenceTextControl(named[3])
  return {
    id, label: control?.text ?? id, type: keyword, keyword, aliased: Boolean(named),
    ...(named?.[2] === '' ? { unspacedAlias: true } : {}),
    ...(control?.wrap === undefined ? {} : { wrap: control.wrap }),
  }
}

/** One `create participant|actor X [as Label]` grammar shared by renderer and
 *  agent parsers. */
export function parseSequenceCreateLine(line: string): Pick<Actor, 'id' | 'label' | 'type' | 'wrap'> | null {
  const match = line.match(/^create\s+(participant|actor)\s+(\S+?)(?:\s+as\s+(.+))?$/i)
  if (!match) return null
  const id = match[2]!
  assertSequenceParticipantId(id)
  const control = match[3] === undefined ? undefined : splitSequenceTextControl(match[3])
  return { id, label: control?.text ?? id, type: match[1]!.toLowerCase() as 'participant' | 'actor', ...(control?.wrap === undefined ? {} : { wrap: control.wrap }) }
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
export function parseSequenceNoteLine(line: string): Pick<Note, 'actorIds' | 'text' | 'position' | 'wrap'> | null {
  const match = line.match(/^Note\s+(left of|right of|over)\s+([^:]+):\s*(.*)$/i)
  if (!match) return null
  const placement = match[1]!.toLowerCase()
  return {
    actorIds: match[2]!.trim().split(',').map(id => id.trim()),
    ...splitSequenceTextControl(match[3]!),
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
  bind: (id: string) => void): void {
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

/** Prefix the prepared reading without turning literal tags into markup. */
export function displayMessageContent(msg: Pick<Message, 'label' | 'labelContent' | 'number'>): DisplayTextInput {
  const content = resolveLabelContent(msg.label, msg.labelContent)
  return msg.number !== undefined ? concatDisplayText([`${msg.number}. `, typeof content === 'string' ? prepareDisplayText(content) : content]) : content
}
