import type { SequenceDiagram, Actor, Message, Block, Note, SequenceBoxGroup, SequenceActorType, SequenceMessageHead } from './types.ts'
import { normalizeBrTags } from '../multiline-utils.ts'
import { scanAccessibilityDirectives } from '../shared/accessibility-directives.ts'
import { isCssColorToken, sequenceRectColor } from './colors.ts'
import { splitSequenceStatementLines } from './statements.ts'
import { continuationBelongsToBlock, parseSequenceBlockContinuation, parseSequenceBlockOpener } from './block-keywords.ts'

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
const SEQUENCE_MESSAGE_RE = new RegExp(String.raw`^(\S+?)(\(\))?\s*(${arrowAlternatives})\s*(\(\))?([+-]?)(\S+?)\s*:\s*(.+)$`)

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
  const match = line.match(SEQUENCE_MESSAGE_RE)
  if (!match || !isMessageArrow(match[3]!)) return null
  return {
    from: match[1]!, arrow: match[3]!, activationMark: match[5] || undefined,
    to: match[6]!, label: match[7]!, centralStart: Boolean(match[2]), centralEnd: Boolean(match[4]),
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

  // Track actor IDs to auto-create actors referenced in messages
  const actorIds = new Set<string>()
  // Track block nesting with a stack
  const blockStack: Array<{ type: Block['type']; label: string; color?: string; startIndex: number; dividers: Block['dividers'] }> = []
  // Open `box … end` group (boxes never nest; they only wrap participant lines)
  let openBox: SequenceBoxGroup | null = null
  // Active autonumber state; null = numbering off
  let autonumber: { next: number; step: number } | null = opts.showSequenceNumbers === true ? { next: 1, step: 1 } : null
  // Actors awaiting their binding message (`create X` / `destroy X` directives
  // take effect at the NEXT message that involves the actor)
  const pendingCreates: string[] = []
  const pendingDestroys: string[] = []

  // Shared handler for the two message regex branches, so autonumber and
  // create/destroy binding cannot drift between them.
  const pushMessage = (from: string, arrow: string, activationMark: string | undefined, to: string, rawLabel: string, centralStart = false, centralEnd = false): void => {
    // Ensure both actors exist
    ensureActor(diagram, actorIds, from)
    ensureActor(diagram, actorIds, to)

    const endpoint = parseMessageArrow(arrow)
    const msg: Message = {
      from,
      to,
      label: normalizeBrTags(rawLabel.trim()),
      lineStyle: endpoint.lineStyle,
      startHead: endpoint.startHead,
      endHead: endpoint.endHead,
      centralStart,
      centralEnd,
    }

    // Activation/deactivation via +/- prefix on target
    if (activationMark === '+') msg.activate = true
    if (activationMark === '-') msg.deactivate = true

    if (autonumber) {
      msg.number = autonumber.next
      // Upstream allows decimal steps to the hundredth; round so float drift
      // can't leak into labels.
      autonumber.next = Math.round((autonumber.next + autonumber.step) * 100) / 100
    }

    // Bind pending create/destroy directives to this message when it involves
    // the actor (upstream ties creation to the message the actor receives and
    // destruction to the next message it sends or receives).
    bindLifecycle(pendingCreates, id => id === to, diagram, actor => { actor.createMessageIndex = diagram.messages.length })
    bindLifecycle(pendingDestroys, id => id === from || id === to, diagram, actor => { actor.destroyMessageIndex = diagram.messages.length })

    diagram.messages.push(msg)
  }

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i]!

    // --- Participant / Actor declaration, including Mermaid 11 metadata. ---
    const actorDeclaration = parseActorDeclaration(line)
    if (actorDeclaration) {
      const { id, label, type } = actorDeclaration
      if (!actorIds.has(id)) {
        actorIds.add(id)
        diagram.actors.push({ id, label, type })
      } else if (label !== id) {
        // As in Mermaid, re-declaring a participant with an alias renames it
        // (`participant A` in a box, then `participant A as Alice`); a bare
        // re-declaration changes nothing.
        const actor = diagram.actors.find(candidate => candidate.id === id)!
        actor.label = label
        actor.type = type
      }
      if (openBox && !openBox.actorIds.includes(id)) openBox.actorIds.push(id)
      continue
    }

    // --- Safe actor menus (`link` and JSON `links`). ---
    const actorLinks = parseActorLinks(line)
    if (actorLinks) {
      ensureActor(diagram, actorIds, actorLinks.actorId)
      const actor = diagram.actors.find(candidate => candidate.id === actorLinks.actorId)!
      actor.links = { ...actor.links, ...actorLinks.links }
      continue
    }

    // --- title <text> (Mermaid's sequence title statement) ---
    const titleMatch = line.match(/^title(?:\s*:\s*|\s+)(.+)$/i)
    if (titleMatch) {
      diagram.title = normalizeBrTags(titleMatch[1]!.trim())
      continue
    }

    // --- autonumber [off | <start> [<step>]] ---
    const autoMatch = line.match(/^autonumber(?:\s+(.*))?$/i)
    if (autoMatch) {
      const rest = autoMatch[1]?.trim() ?? ''
      if (/^off$/i.test(rest)) {
        autonumber = null
      } else {
        const nums = rest.match(/^(\d+(?:\.\d+)?)(?:\s+(\d+(?:\.\d+)?))?$/)
        autonumber = {
          next: nums ? Number.parseFloat(nums[1]!) : 1,
          step: nums?.[2] !== undefined ? Number.parseFloat(nums[2]) : 1,
        }
      }
      continue
    }

    // --- box [<color>] [Label] … end ---
    const boxMatch = line.match(/^box(?:\s+(.*))?$/i)
    if (boxMatch) {
      const rest = boxMatch[1]?.trim() ?? ''
      const box: SequenceBoxGroup = { actorIds: [] }
      // The leading token is a color when it IS one (color functions may
      // contain spaces, so match them before splitting on whitespace);
      // `box transparent <label>` is the upstream escape hatch for labels
      // that look like colors.
      const fnColor = rest.match(/^((?:rgb|rgba|hsl|hsla)\([^)]*\))\s*(.*)$/i)
      let label = rest
      if (fnColor) {
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
      diagram.boxes!.push(box)
      openBox = box
      continue
    }

    // --- create / destroy lifecycle directives ---
    const createMatch = line.match(/^create\s+(participant|actor)\s+(\S+?)(?:\s+as\s+(.+))?$/i)
    if (createMatch) {
      const type = createMatch[1]!.toLowerCase() as 'participant' | 'actor'
      const id = createMatch[2]!
      const label = normalizeBrTags(createMatch[3]?.trim() ?? id)
      if (!actorIds.has(id)) {
        actorIds.add(id)
        diagram.actors.push({ id, label, type })
      }
      pendingCreates.push(id)
      continue
    }
    const destroyMatch = line.match(/^destroy\s+(\S+)$/i)
    if (destroyMatch) {
      pendingDestroys.push(destroyMatch[1]!)
      continue
    }

    // --- Note ---
    // "Note left of A: text" / "Note right of A: text" / "Note over A,B: text"
    const noteMatch = line.match(/^Note\s+(left of|right of|over)\s+([^:]+):\s*(.+)$/i)
    if (noteMatch) {
      const posStr = noteMatch[1]!.toLowerCase()
      const actorsStr = noteMatch[2]!.trim()
      const text = normalizeBrTags(noteMatch[3]!.trim())
      const noteActorIds = actorsStr.split(',').map(s => s.trim())

      // Ensure actors exist
      for (const aid of noteActorIds) {
        ensureActor(diagram, actorIds, aid)
      }

      let position: 'left' | 'right' | 'over' = 'over'
      if (posStr === 'left of') position = 'left'
      else if (posStr === 'right of') position = 'right'

      diagram.notes.push({
        actorIds: noteActorIds,
        text,
        position,
        afterIndex: diagram.messages.length - 1,
      })
      continue
    }

    // --- Block start: loop, alt, opt, par, critical, break, rect ---
    const opener = parseSequenceBlockOpener(line)
    if (opener && opener.type !== 'box') {
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
      blockStack.push({
        type: blockType,
        label,
        ...(color ? { color } : {}),
        startIndex: diagram.messages.length,
        dividers: [],
      })
      continue
    }

    // --- Block divider: else, and, option (only on their owning blocks) ---
    const continuation = parseSequenceBlockContinuation(line)
    if (continuation && blockStack.length > 0
      && continuationBelongsToBlock(continuation.type, blockStack[blockStack.length - 1]!.type)) {
      const label = normalizeBrTags(continuation.label)
      blockStack[blockStack.length - 1]!.dividers.push({
        index: diagram.messages.length,
        label,
      })
      continue
    }

    // --- Block end ---
    if (line === 'end' && blockStack.length > 0) {
      const completed = blockStack.pop()!
      diagram.blocks.push({
        type: completed.type,
        label: completed.label,
        ...(completed.color ? { color: completed.color } : {}),
        startIndex: completed.startIndex,
        endIndex: Math.max(diagram.messages.length - 1, completed.startIndex),
        dividers: completed.dividers,
      })
      continue
    }

    // --- Box end (boxes only wrap participant declarations, so any `end`
    //     with no open block closes the open box) ---
    if (line === 'end' && openBox) {
      openBox = null
      continue
    }

    // --- Message. Full recognition keeps endpoint semantics out of actor IDs. ---
    const parsedMessage = parseSequenceMessageLine(line)
    if (parsedMessage) {
      pushMessage(parsedMessage.from, parsedMessage.arrow, parsedMessage.activationMark, parsedMessage.to, parsedMessage.label, parsedMessage.centralStart, parsedMessage.centralEnd)
      continue
    }

    // --- activate / deactivate explicit commands ---
    const activationMatch = line.match(/^(activate|deactivate)\s+(\S+)$/i)
    if (activationMatch) {
      const actorId = activationMatch[2]!
      ensureActor(diagram, actorIds, actorId)
      diagram.activationEvents!.push({
        actorId,
        kind: activationMatch[1]!.toLowerCase() as 'activate' | 'deactivate',
        messageIndex: diagram.messages.length,
      })
      continue
    }
  }

  return diagram
}

const ACTOR_TYPES = new Set<SequenceActorType>(['participant', 'actor', 'boundary', 'control', 'entity', 'database', 'collections', 'queue'])

export function parseActorDeclaration(line: string): Actor | null {
  const metadata = line.match(/^(participant|actor)\s+([^\s@]+)@\{([\s\S]+)\}(?:\s+as\s+(.+))?$/i)
  if (metadata) {
    const baseType = metadata[1]!.toLowerCase() as 'participant' | 'actor'
    const id = metadata[2]!
    let values: Record<string, unknown> = {}
    try { values = JSON.parse(`{${metadata[3]}}`) as Record<string, unknown> } catch {
      // Mermaid also accepts identifier-style keys and single-quoted string
      // values. Normalize only those documented JSON-like extensions;
      // malformed metadata still fails closed instead of being guessed.
      const normalized = metadata[3]!
        .replace(/(^|[,{])(\s*)([A-Za-z][\w-]*)\s*:/g, '$1$2"$3":')
        .replace(/'([^'\\]*(?:\\.[^'\\]*)*)'/g, (_whole, value: string) => JSON.stringify(value.replace(/\\'/g, "'")))
      try { values = JSON.parse(`{${normalized}}`) as Record<string, unknown> } catch { return null }
    }
    const requested = typeof values.type === 'string' ? values.type.toLowerCase() : baseType
    if (!ACTOR_TYPES.has(requested as SequenceActorType)) throw new Error(`Unknown sequence actor type '${requested}'`)
    const type = requested as SequenceActorType
    // Upstream gives an explicit external `as` alias precedence over inline
    // metadata so the authored presentation name remains visible.
    const alias = metadata[4]?.trim() ?? (typeof values.alias === 'string' ? values.alias : undefined)
    return { id, label: normalizeBrTags(alias ?? id), type }
  }
  const ordinary = line.match(/^(participant|actor)\s+(\S+?)(?:\s+as\s+(.+))?$/i)
  if (!ordinary) return null
  const id = ordinary[2]!
  return { id, label: normalizeBrTags(ordinary[3]?.trim() ?? id), type: ordinary[1]!.toLowerCase() as 'participant' | 'actor' }
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

function isMessageArrow(value: string): boolean {
  return SEQUENCE_ARROW_HEADS.has(value)
}

function parseMessageArrow(arrow: string): { lineStyle: 'solid' | 'dashed'; startHead: SequenceMessageHead; endHead: SequenceMessageHead } {
  const lineStyle = arrow.includes('--') ? 'dashed' : 'solid'
  const [startHead, endHead] = SEQUENCE_ARROW_HEADS.get(arrow) ?? ['none', 'none']
  return { lineStyle, startHead, endHead }
}

/** Ensure an actor exists, creating a default participant if not */
function ensureActor(diagram: SequenceDiagram, actorIds: Set<string>, id: string): void {
  if (!actorIds.has(id)) {
    actorIds.add(id)
    diagram.actors.push({ id, label: id, type: 'participant' })
  }
}

/** Bind any pending create/destroy directive whose actor participates in the
 *  message being parsed; unmatched directives stay pending (and stay inert if
 *  no later message ever involves the actor). */
function bindLifecycle(
  pending: string[],
  matches: (id: string) => boolean,
  diagram: SequenceDiagram,
  assign: (actor: Actor) => void,
): void {
  for (let i = pending.length - 1; i >= 0; i--) {
    const id = pending[i]!
    if (!matches(id)) continue
    const actor = diagram.actors.find(a => a.id === id)
    if (actor) assign(actor)
    pending.splice(i, 1)
  }
}

/** The label a display surface should draw for a message: the autonumber
 *  prefix ("1. label") composed in exactly one place, shared by the SVG
 *  layout and the ASCII renderer so the surfaces cannot drift. */
export function displayMessageLabel(msg: Pick<Message, 'label' | 'number'>): string {
  return msg.number !== undefined ? `${msg.number}. ${msg.label}` : msg.label
}
