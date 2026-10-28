import { terminalArtifact, serializeTerminalArtifact, type TerminalArtifact } from './terminal-artifact.ts'
// Terminal sequence layout owns cell bounds before painting. Lexical fragment
// boundaries distinguish notes and empty sections sharing a message cursor.
import { parseSequenceDiagram, displayMessageContent, getSequenceBlockBoundaries } from '../sequence/parser.ts'
import { resolveSequenceBlockScopes } from '../sequence/geometry.ts'
import type { SequenceDiagram, SequenceMessageHead } from '../sequence/types.ts'
import type { ResolvedSequenceConfig } from '../sequence/config.ts'
import type { AsciiConfig, AsciiTheme, ColorMode, CharRole } from './types.ts'
import { TerminalDocument, type TerminalMarker, type TerminalOwner } from './terminal-document.ts'
import { visualWidth } from './width.ts'
import { wrapText } from './wrap.ts'
import { normalizeBrTags } from '../multiline-utils.ts'
import { terminalIds } from './identity.ts'
import { paintTerminalFrame } from './terminal-geometry.ts'
import { concatDisplayText, prepareDisplayText, resolveLabelContent, type DisplayTextInput } from '../shared/display-text.ts'

interface CellBounds { x: number; y: number; width: number; height: number }
interface PositionedText extends CellBounds { lines: string[]; index: number; parentId?: string }
interface PositionedMessage extends PositionedText { arrowY: number; fromX: number; toX: number }
interface SequenceFrame extends CellBounds { index: number; header: string[]; dividers: Array<{ x?: number; y: number; lines: string[] }> ; parentId?: string }

function messageLabelX(message: PositionedMessage, line: string): number {
  return message.fromX === message.toX ? message.x : Math.min(message.fromX, message.toX) + Math.floor((Math.abs(message.toX - message.fromX) - visualWidth(line)) / 2)
}

export function renderSequenceTerminal(text: string, config: AsciiConfig, colorMode?: ColorMode, theme?: AsciiTheme, seqConfig: ResolvedSequenceConfig = {}, targetWidth?: number, authoredLine?: (index: number) => number | undefined): TerminalArtifact {
  const diagram = parseSequenceDiagram(text.split('\n').map(line => line.trim()).filter(line => line && !line.startsWith('%%')), { ...seqConfig, ...(authoredLine ? { authoredLine } : {}) })
  return renderSequenceDiagramTerminal(diagram, config, colorMode, theme, seqConfig, targetWidth)
}

/** Native sequence-language adapters share cell layout without a text roundtrip. */
export function renderSequenceDiagramTerminal(input: SequenceDiagram, config: AsciiConfig, colorMode?: ColorMode, theme?: AsciiTheme, seqConfig: ResolvedSequenceConfig = {}, targetWidth?: number): TerminalArtifact {
  targetWidth ??= config.targetWidth ?? config.maxWidth
  const diagram = input.title === undefined && config.title !== undefined ? { ...input, title: normalizeBrTags(config.title) } : input
  if (!diagram.actors.length && !diagram.blocks.length) {
    const empty = new TerminalDocument()
    if (diagram.title) for (const line of wrapText(prepareDisplayText(resolveLabelContent(diagram.title, diagram.titleContent)), targetWidth)) empty.line([{ text: line, owner: { id: 'title', kind: 'label' }, role: 'text' }])
    return terminalArtifact(empty, { colorMode, theme, trimEnd: true })
  }
  const generated = terminalIds([...diagram.actors.map(actor => actor.id), ...[...diagram.messages, ...diagram.blocks, ...diagram.notes].flatMap(item => item.id === undefined ? [] : [item.id])])
  const blockId = (index: number) => diagram.blocks[index]!.id ?? generated(`block:${index}`)
  const ascii = config.useAscii
  const actorIndex = new Map(diagram.actors.map((actor, index) => [actor.id, index]))
  const budget = targetWidth === undefined ? undefined : Math.max(1, Math.floor(targetWidth / 3))
  const prepared = (value: DisplayTextInput, wrap?: boolean) => wrapText(prepareDisplayText(value), wrap === false ? undefined : wrap ? Math.min(budget ?? 40, 40) : budget)
  const actorLines = diagram.actors.map(actor => {
    const label = prepareDisplayText(resolveLabelContent(actor.label, actor.labelContent))
    return prepared(actor.type === 'participant' || actor.type === 'actor' ? label : concatDisplayText([`«${actor.type}»\n`, label]), actor.wrap)
  })
  const messageLines = diagram.messages.map(message => prepared(displayMessageContent(message), message.wrap))
  const noteLines = diagram.notes.map(note => prepared(resolveLabelContent(note.text, note.textContent), note.wrap))
  const headerLines = diagram.blocks.map(block => prepared(block.label ? concatDisplayText([`${block.type} [`, prepareDisplayText(resolveLabelContent(block.label, block.labelContent)), ']']) : block.type, block.wrap))
  const dividerLines = diagram.blocks.map(block => block.dividers.map(divider => divider.label ? prepared(concatDisplayText(['[', prepareDisplayText(resolveLabelContent(divider.label, divider.labelContent)), ']']), divider.wrap) : ['']))
  const actorWidths = actorLines.map(lines => Math.max(0, ...lines.map(visualWidth)) + 4)
  const boxHeaders = (diagram.boxes ?? []).map(box => box.label ? prepared(resolveLabelContent(box.label, box.labelContent), box.wrap) : [])
  diagram.boxes?.forEach((box, index) => {
    const members = diagram.actors.flatMap((actor, ai) => actor.box === index ? [ai] : [])
    if (members.length !== 1) return
    const actor = members[0]!
    actorWidths[actor] = Math.max(actorWidths[actor]!, ...boxHeaders[index]!.map(line => visualWidth(line) + 2))
  })
  const participantTop = diagram.boxes?.length ? Math.max(1, ...boxHeaders.map(lines => lines.length)) + 1 : 0
  const halfBox = actorWidths.map(width => Math.ceil(width / 2))
  const actorBoxH = diagram.actors.length ? Math.max(3, ...actorLines.map(lines => lines.length + 2)) : 0
  const gaps = new Array<number>(Math.max(0, diagram.actors.length - 1)).fill(0)
  diagram.messages.forEach((message, index) => {
    const from = actorIndex.get(message.from)!, to = actorIndex.get(message.to)!
    const width = Math.max(0, ...messageLines[index]!.map(visualWidth))
    if (from === to) {
      if (from < gaps.length) gaps[from] = Math.max(gaps[from]!, width + 5)
    } else {
      for (let gap = Math.min(from, to); gap < Math.max(from, to); gap++) gaps[gap] = Math.max(gaps[gap]!, Math.ceil((width + 4) / Math.abs(to - from)))
    }
  })
  diagram.boxes?.forEach((_, index) => {
    const members = diagram.actors.flatMap((actor, ai) => actor.box === index ? [ai] : [])
    if (members.length < 2) return
    const first = Math.min(...members), last = Math.max(...members)
    const width = Math.max(0, ...boxHeaders[index]!.map(visualWidth))
    for (let gap = first; gap < last; gap++) gaps[gap] = Math.max(gaps[gap]!, Math.ceil((width + 4) / (last - first)))
  })
  let leftMargin = halfBox[0] ?? 4
  diagram.notes.forEach((note, index) => {
    const first = actorIndex.get(note.actorIds[0]!) ?? 0
    const last = actorIndex.get(note.actorIds.at(-1)!) ?? first
    const width = Math.max(0, ...noteLines[index]!.map(visualWidth)) + 4
    if (note.position === 'left') {
      if (first === 0) leftMargin = Math.max(leftMargin, width + 1)
      else gaps[first - 1] = Math.max(gaps[first - 1]!, width + 1)
    } else if (note.position === 'right') {
      if (first < gaps.length) gaps[first] = Math.max(gaps[first]!, width + 2)
    } else if (first !== last) {
      for (let gap = Math.min(first, last); gap < Math.max(first, last); gap++) gaps[gap] = Math.max(gaps[gap]!, Math.ceil((width + 2) / Math.abs(first - last)))
    } else if (first === 0) leftMargin = Math.max(leftMargin, Math.floor(width / 2))
  })
  const scopes = resolveSequenceBlockScopes(diagram)
  const parents = new Map<number, number>()
  scopes.forEach((scope, parent) => scope.childBlockIndices.forEach(child => parents.set(child, parent)))
  const depth = (index: number): number => parents.has(index) ? 1 + depth(parents.get(index)!) : 1
  const maxDepth = Math.max(0, ...diagram.blocks.map((_, index) => depth(index)))
  // Reserve nested frame margins before placing the first actor or left note.
  if (maxDepth) leftMargin += maxDepth * 4
  const llX = [leftMargin]
  for (let index = 1; index < diagram.actors.length; index++) llX[index] = llX[index - 1]! + Math.max(halfBox[index - 1]! + halfBox[index]! + (diagram.actors[index - 1]!.box !== diagram.actors[index]!.box ? 4 : 2), gaps[index - 1]! + 2, 10)
  const messageSpans = diagram.messages.map((message, index) => {
    const from = llX[actorIndex.get(message.from)!]!, to = llX[actorIndex.get(message.to)!]!
    const width = Math.max(0, ...messageLines[index]!.map(visualWidth))
    const labelX = from === to ? from + 6 : Math.min(from, to) + Math.floor((Math.abs(to - from) - width) / 2)
    const x = Math.min(from, to, labelX)
    return { x, width: Math.max(from, to, labelX + width - 1) - x + 1 }
  })
  const noteSpans = diagram.notes.map((note, index) => {
    const width = Math.max(0, ...noteLines[index]!.map(visualWidth)) + 4
    const first = llX[actorIndex.get(note.actorIds[0]!) ?? 0]!, last = llX[actorIndex.get(note.actorIds.at(-1)!) ?? 0]!
    const x = note.position === 'left' ? first - width - 1 : note.position === 'right' ? first + 2 : Math.floor((first + last) / 2) - Math.floor(width / 2)
    return { x: Math.max(0, x), width }
  })
  const frameSpans = new Map<number, { x: number; width: number }>()
  const frameSpan = (index: number): { x: number; width: number } => {
    const cached = frameSpans.get(index)
    if (cached) return cached
    const scope = scopes[index]!, block = diagram.blocks[index]!
    const contents = [...messageSpans.slice(block.startIndex, scope.endMessageExclusive), ...scope.noteIndices.map(ni => noteSpans[ni]!), ...scope.childBlockIndices.map(frameSpan)]
    const x = Math.max(0, (contents.length ? Math.min(...contents.map(item => item.x)) : llX[0]!) - 4)
    const right = contents.length ? Math.max(...contents.map(item => item.x + item.width)) : llX.at(-1)!
    const labelWidth = Math.max(0, ...headerLines[index]!.map(visualWidth), ...dividerLines[index]!.flatMap(lines => lines.map(visualWidth)))
    const span = { x, width: Math.max(right + 4 - x, labelWidth + 2) + (block.type === 'par_over' ? labelWidth : 0) }
    frameSpans.set(index, span)
    return span
  }
  const messages: PositionedMessage[] = []
  const notes: PositionedText[] = []
  const frames = new Map<number, SequenceFrame>()
  const closedFrames: SequenceFrame[] = []
  const activeFrames: number[] = []
  const actorTop = new Map<number, number>()
  const currentParent = () => activeFrames.length ? blockId(activeFrames.at(-1)!) : undefined
  let cursor = participantTop + actorBoxH
  const ownedBounds = new Map<number, CellBounds[]>()
  const overlays = new Map<number, { start: number; bottom: number; prior: CellBounds[]; pending?: number }>()
  const clearOverlay = (bounds: CellBounds): number => {
    let shift = 0
    const obstacles = [...overlays.values()].flatMap(state => state.prior)
    for (let pass = 0; pass <= obstacles.length; pass++) {
      const hit = obstacles.find(other => bounds.x < other.x + other.width + 1 && bounds.x + bounds.width + 1 > other.x
        && bounds.y + shift < other.y + other.height + 1 && bounds.y + bounds.height + shift + 1 > other.y)
      if (!hit) break
      shift = hit.y + hit.height + 1 - bounds.y
    }
    return shift
  }
  const overlayContent = (bounds: CellBounds): number => {
    let candidate = { ...bounds }
    for (const [index, state] of overlays) {
      if (state.pending === undefined) continue
      const tag = frames.get(index)!.dividers[state.pending]!
      const extra = tag.lines.length ? tag.lines.length + 1 : 0
      candidate = { x: candidate.x, y: candidate.y - extra, width: Math.max(candidate.width, ...tag.lines.map(visualWidth)), height: candidate.height + extra }
    }
    const shift = clearOverlay(candidate)
    for (const [index, state] of overlays) {
      if (state.pending === undefined) continue
      const tag = frames.get(index)!.dividers[state.pending]!
      tag.x = bounds.x; tag.y = bounds.y + shift - tag.lines.length - 1
      if (tag.lines.length) own({ x: tag.x, y: tag.y, width: Math.max(...tag.lines.map(visualWidth)), height: tag.lines.length })
      delete state.pending
    }
    return shift
  }
  const own = (bounds: CellBounds) => {
    // Every ancestor owns its full contents; frame completion adds its margins.
    for (const index of activeFrames) {
      const list = ownedBounds.get(index) ?? []
      list.push(bounds); ownedBounds.set(index, list)
    }
  }
  const finishEmptyOverlayLabel = (index: number): void => {
    const state = overlays.get(index)
    if (state?.pending === undefined) return
    const tag = frames.get(index)!.dividers[state.pending]!
    tag.x = llX[0]!; tag.y = Math.max(cursor, state.bottom) + 1
    if (tag.lines.some(Boolean)) {
      own({ x: tag.x, y: tag.y, width: Math.max(...tag.lines.map(visualWidth)), height: tag.lines.length })
      cursor = tag.y + tag.lines.length
      state.bottom = Math.max(state.bottom, cursor)
    }
    delete state.pending
  }
  let messageCursor = 0, noteCursor = 0, boundaryCursor = 0
  const boundaries = getSequenceBlockBoundaries(input) ?? []
  const consumeBoundaries = () => {
    while (boundaryCursor < boundaries.length) {
      const event = boundaries[boundaryCursor]!
      if (event.messageIndex > messageCursor || event.noteIndex > noteCursor) break
      const index = event.blockIndex
      if (event.kind === 'open') {
        if (overlays.size) {
          const span = frameSpan(index)
          for (const [overlayIndex, state] of overlays) {
            const tagRows = state.pending === undefined ? 0 : frames.get(overlayIndex)!.dividers[state.pending]!.lines.length + 1
            for (const ink of state.prior) {
              if (span.x < ink.x + ink.width + 1 && span.x + span.width + 1 > ink.x) cursor = Math.max(cursor, ink.y + ink.height + tagRows + 1)
            }
          }
          cursor += overlayContent({ ...span, y: cursor + 1, height: 1 })
        }
        cursor++
        frames.set(index, { index, x: 0, y: cursor, width: 0, height: 0, header: headerLines[index]!, dividers: [], parentId: diagram.blocks[index]!.parentId ?? currentParent() })
        activeFrames.push(index)
        cursor += Math.max(1, headerLines[index]!.length)
        if (diagram.blocks[index]!.type === 'par_over') {
          cursor += Math.max(0, ...dividerLines[index]!.map(lines => lines.length ? lines.length + 1 : 0))
          overlays.set(index, { start: cursor, bottom: cursor, prior: [] })
        }
      } else if (event.kind === 'divider') {
        const overlay = overlays.get(index)
        if (overlay) {
          finishEmptyOverlayLabel(index)
          overlay.bottom = Math.max(overlay.bottom, cursor)
          overlay.prior = [...ownedBounds.get(index) ?? []]
          cursor = overlay.start
          const frame = frames.get(index)!
          frame.dividers.push({ y: cursor, lines: dividerLines[index]![event.dividerIndex!]! })
          overlay.pending = frame.dividers.length - 1
          boundaryCursor++
          continue
        }
        cursor++
        const lines = dividerLines[index]![event.dividerIndex!]!
        frames.get(index)!.dividers.push({ y: cursor, lines })
        cursor += Math.max(1, lines.length)
      } else {
        const overlay = overlays.get(index)
        if (overlay) { finishEmptyOverlayLabel(index); cursor = Math.max(cursor, overlay.bottom); overlays.delete(index) }
        cursor++
        const frame = frames.get(index)!
        const contents = ownedBounds.get(index) ?? []
        const minX = contents.length ? Math.min(...contents.map(item => item.x)) : llX[0]!
        const maxX = contents.length ? Math.max(...contents.map(item => item.x + item.width - 1)) : llX.at(-1)!
        frame.x = Math.max(0, minX - 4)
        const labelWidth = Math.max(0, ...frame.header.map(visualWidth), ...frame.dividers.flatMap(divider => divider.lines.map(visualWidth)))
        frame.width = Math.max(maxX + 4 - frame.x + 1, labelWidth + 2)
        frame.height = cursor - frame.y + 1
        const stackIndex = activeFrames.lastIndexOf(index)
        if (stackIndex >= 0) activeFrames.splice(stackIndex, 1)
        own(frame)
        closedFrames.push(frame)
        cursor++
      }
      boundaryCursor++
    }
  }
  while (messageCursor < diagram.messages.length || noteCursor < diagram.notes.length || boundaryCursor < boundaries.length) {
    consumeBoundaries()
    const note = diagram.notes[noteCursor]
    if (note && note.afterIndex < messageCursor) {
      cursor++
      const lines = noteLines[noteCursor]!
      const positioned = { index: noteCursor, ...noteSpans[noteCursor]!, y: cursor, height: lines.length + 2, lines, parentId: diagram.notes[noteCursor]!.parentId ?? currentParent() }
      const shift = overlayContent(positioned)
      cursor += shift; positioned.y += shift
      notes.push(positioned); own(positioned); cursor += positioned.height; noteCursor++
    } else if (messageCursor < diagram.messages.length) {
      const message = diagram.messages[messageCursor]!
      // A created actor's complete header precedes its creation message.
      diagram.actors.forEach((actor, index) => {
        if (actor.createMessageIndex !== messageCursor) return
        cursor++; actorTop.set(index, cursor); cursor += actorBoxH
        own({ x: llX[index]! - Math.floor(actorWidths[index]! / 2), y: actorTop.get(index)!, width: actorWidths[index]!, height: actorBoxH })
      })
      cursor++
      const lines = messageLines[messageCursor]!
      const fromX = llX[actorIndex.get(message.from)!]!, toX = llX[actorIndex.get(message.to)!]!
      const self = fromX === toX
      const width = Math.max(0, ...lines.map(visualWidth))
      const positioned = { index: messageCursor, x: self ? fromX + 6 : Math.min(fromX, toX) + Math.floor((Math.abs(toX - fromX) - width) / 2), y: self ? cursor + 1 : cursor, width, height: lines.length, lines, arrowY: self ? cursor : cursor + lines.length, fromX, toX, parentId: message.parentId ?? currentParent() }
      const shift = overlayContent({ x: Math.min(fromX, toX, positioned.x), y: cursor, width: Math.max(fromX, toX, positioned.x + width - 1) - Math.min(fromX, toX, positioned.x) + 1, height: lines.length + (self ? 2 : 1) })
      cursor += shift; positioned.y += shift; positioned.arrowY += shift
      messages.push(positioned)
      own({ x: Math.min(fromX, toX, positioned.x), y: cursor, width: Math.max(fromX, toX, positioned.x + width - 1) - Math.min(fromX, toX, positioned.x) + 1, height: lines.length + (self ? 2 : 1) })
      cursor += lines.length + (self ? 2 : 1); messageCursor++
    } else if (note) {
      // A parser-owned note is always reachable at the current final cursor.
      messageCursor = Math.max(messageCursor, note.afterIndex + 1)
    } else if (boundaryCursor < boundaries.length) {
      // Defensive fail-closed guard against malformed private side data.
      throw new Error('Sequence terminal boundary is beyond the parsed content')
    }
  }
  const footerY = cursor + 1
  const participantGroups = (diagram.boxes ?? []).flatMap((box, index) => {
    const indices = diagram.actors.flatMap((actor, ai) => actor.box === index ? [ai] : [])
    if (!indices.length) return []
    const x = Math.max(0, Math.min(...indices.map(ai => llX[ai]! - halfBox[ai]!)) - 1)
    const right = Math.max(...indices.map(ai => llX[ai]! + halfBox[ai]!)) + 1
    return [{ index, x, width: Math.max(right - x + 1, ...boxHeaders[index]!.map(line => visualWidth(line) + 2)), lines: boxHeaders[index]!, members: indices.map(ai => diagram.actors[ai]!.id) }]
  })
  const totalW = Math.max(...participantGroups.map(group => group.x + group.width),llX.at(-1)! + (halfBox.at(-1) ?? 0) + 2, ...messages.map(item => item.x + item.width + 2), ...notes.map(item => item.x + item.width + 1), ...closedFrames.map(item => item.x + item.width))
  const doc = new TerminalDocument(totalW + 1, footerY + actorBoxH + (participantGroups.length ? 1 : 0))
  for (const actor of diagram.actors) if (actor.type !== 'participant') doc.report({ code: 'TERMINAL_FAMILY_PROJECTION', feature: `sequence.${actor.id}.glyph`, message: `The authored ${actor.type} participant uses a terminal card${actor.type === 'actor' ? '' : ' with a type stereotype'} in place of its graphical silhouette.` })
  diagram.boxes?.forEach((box, index) => {
    if (box.color && box.color.toLowerCase() !== 'transparent') doc.report({ code: 'TERMINAL_FAMILY_PROJECTION', feature: `sequence.${generated(`box:${index}`)}.background`, message: 'The authored participant-box background color is represented by an owned terminal frame; terminal output uses foreground ink without a background fill.' })
  })
  diagram.blocks.forEach((block, index) => {
    if (block.color && block.color.toLowerCase() !== 'transparent') doc.report({ code: 'TERMINAL_FAMILY_PROJECTION', feature: `sequence.${generated(`block:${index}`)}.background`, message: 'The authored rect background color is represented by an owned terminal frame; terminal output uses foreground ink without a background fill.' })
  })
  const owner = (id: string, kind: TerminalOwner['kind'] = 'node', parent?: TerminalOwner['parent']): TerminalOwner => doc.element({ id, kind, ...(parent ? { parent } : {}) })
  const stroke = (x: number, y: number, mask: number, role: CharRole, element: TerminalOwner, style: 'solid' | 'dashed' = 'solid') => doc.stroke(x, y, mask, { owner: element, role, ascii, style })
  const marker = (x: number, y: number, glyph: string, element: TerminalOwner) => doc.put(x, y, glyph, { owner: element, role: 'arrow', kind: 'marker' })
  const frame = (bounds: CellBounds, element: TerminalOwner, opaque = false) => paintTerminalFrame(doc, bounds, element, ascii, opaque)
  // Foreground text and opaque cards intentionally interrupt lifelines and
  // activation bars. Allocate those gaps before either background pass;
  // foreground routes and labels still meet the ordinary collision checks.
  const foreground = closedFrames.flatMap(frame => [
    { x: frame.x + 1, y: frame.y, width: Math.max(0, ...frame.header.map(visualWidth)), height: frame.header.length },
    ...frame.dividers.map(divider => ({ x: divider.x ?? frame.x + 1, y: divider.y, width: Math.max(0, ...divider.lines.map(visualWidth)), height: divider.lines.length })),
  ])
  foreground.push(...notes)
  messages.forEach(message => message.lines.forEach((line, row) => foreground.push({ x: messageLabelX(message, line), y: message.y + row, width: visualWidth(line), height: 1 })))
  diagram.actors.forEach((actor, index) => {
    if (actor.external) return
    const card = { x: llX[index]! - Math.floor(actorWidths[index]! / 2), y: actorTop.get(index) ?? participantTop, width: actorWidths[index]!, height: actorBoxH }
    foreground.push(card)
    if (actor.destroyMessageIndex === undefined) foreground.push({ ...card, y: footerY })
  })
  const backgroundGaps = new Map<number, Array<{ start: number; end: number }>>()
  for (const bounds of foreground) for (let row = bounds.y; row < bounds.y + bounds.height; row++) {
    const spans = backgroundGaps.get(row) ?? []
    spans.push({ start: bounds.x, end: bounds.x + bounds.width }); backgroundGaps.set(row, spans)
  }
  const reservedForeground = (x: number, y: number) => backgroundGaps.get(y)?.some(span => x >= span.start && x < span.end) ?? false
  // Participant-group frames are background geometry with distinct ownership.
  participantGroups.forEach(group => {
    const element = doc.element({ id: generated(`box:${group.index}`), kind: 'group', members: group.members })
    paintTerminalFrame(doc, { x: group.x, y: 0, width: group.width, height: footerY + actorBoxH + 1 }, element, ascii, false, reservedForeground)
    doc.scope(element, () => group.lines.forEach((line, y) => doc.text(group.x + 1, y, line, { role: 'text', kind: 'text' })))
  })
  diagram.actors.forEach((actor, index) => {
    if (actor.external) { owner(actor.id); return }
    const element = owner(actor.id, 'node', actor.box === undefined ? undefined : { id: generated(`box:${actor.box}`), kind: 'group' })
    const start = actorTop.has(index) ? actorTop.get(index)! + actorBoxH : participantTop + actorBoxH
    const end = actor.destroyMessageIndex === undefined ? footerY : messages[actor.destroyMessageIndex]?.arrowY ?? footerY
    for (let y = start; y <= end; y++) if (!reservedForeground(llX[index]!, y)) stroke(llX[index]!, y, 5, 'line', element)
  })
  // Activations are owned spans, drawn behind opaque labels and notes.
  const activationStacks = new Map<string, Array<{ y: number; id: number }>>()
  let activationIndex = 0
  const activation = (id: string, y: number, enable: boolean) => {
    const stack = activationStacks.get(id) ?? []
    if (enable) stack.push({ y, id: activationIndex++ })
    else if (stack.length) {
      const opened = stack.pop()!, start = opened.y, ai = actorIndex.get(id)!, x = llX[ai]! + stack.length
      const element = owner(generated(`activation:${opened.id}`), 'band', { id, kind: 'node' })
      doc.region(element, { x: x - 1, y: start, width: 3, height: Math.max(1, y - start + 1) })
      for (let row = start; row <= y; row++) for (const column of [x - 1, x + 1]) if (!reservedForeground(column, row)) stroke(column, row, 5, 'line', element)
    }
    activationStacks.set(id, stack)
  }
  diagram.messages.forEach((message, index) => {
    const y = messages[index]!.arrowY
    for (const event of diagram.activationEvents ?? []) if (event.messageIndex === index) activation(event.actorId, messages[index]!.y, event.kind === 'activate')
    if (message.activate) activation(message.to, y, true)
    if (message.deactivate) activation(message.from, y, false)
  })
  for (const event of diagram.activationEvents ?? []) if (event.messageIndex >= diagram.messages.length) activation(event.actorId, footerY - 1, event.kind === 'activate')
  for (const [id, stack] of activationStacks) while (stack.length) activation(id, footerY, false)
  diagram.actors.forEach((actor, index) => {
    if (actor.external) return
    const element = owner(actor.id, 'node', actor.box === undefined ? undefined : { id: generated(`box:${actor.box}`), kind: 'group' })
    const drawActor = (top: number) => {
      const width = actorWidths[index]!, lines = actorLines[index]!, x = llX[index]! - Math.floor(width / 2)
      frame({ x, y: top, width, height: actorBoxH }, element, true)
      doc.scope(element, () => lines.forEach((line, row) => doc.text(x + 2 + Math.floor((width - 4 - visualWidth(line)) / 2), top + 1 + row, line, { owner: element, role: 'text', kind: 'text' })))
    }
    drawActor(actorTop.get(index) ?? participantTop)
    if (actor.destroyMessageIndex === undefined) drawActor(footerY)
    else marker(llX[index]!, messages[actor.destroyMessageIndex]?.arrowY ?? footerY, 'X', element)
    if (!ascii) {
      if (actor.createMessageIndex === undefined) stroke(llX[index]!, participantTop + actorBoxH - 1, 14, 'junction', element)
      if (actor.destroyMessageIndex === undefined) stroke(llX[index]!, footerY, 11, 'junction', element)
    }
  })
  for (const positioned of messages) {
    const message = diagram.messages[positioned.index]!, self = message.from === message.to
    const element = doc.element({ id: message.id ?? generated(`message:${positioned.index}`), kind: 'edge', parent: positioned.parentId === undefined ? undefined : { id: positioned.parentId, kind: 'compartment' }, from: message.from, to: message.to })
    const style = message.lineStyle === 'dashed' ? 'dashed' : 'solid'
    const y = positioned.arrowY, from = positioned.fromX, to = positioned.toX
    const endpoint = (x: number, row: number, start: boolean, right: boolean): void => {
      const semantic = sequenceMarker(start ? message.startHead : message.endHead, right, ascii, start ? message.centralStart : message.centralEnd)
      if (semantic) doc.marker(x, row, semantic, { owner: element, role: 'arrow' })
    }
    doc.port(element, { nodeId: message.from, x: from, y, side: self || from < to ? 'R' : 'L', end: 'start', surface: 'lifeline' })
    doc.port(element, { nodeId: message.to, x: to, y: self ? y + positioned.lines.length + 1 : y, side: self || from > to ? 'R' : 'L', end: 'end', surface: 'lifeline' })
    const startMarker = sequenceMarker(message.startHead, !self && from > to, ascii, message.centralStart)
    const endMarker = sequenceMarker(message.endHead, !self && from < to, ascii, message.centralEnd)
    doc.expectMarkers(element, 'start', startMarker ? [startMarker] : [])
    doc.expectMarkers(element, 'end', endMarker ? [endMarker] : [])
    if (self) {
      stroke(from, y, 7, 'junction', element)
      for (let x = from + 1; x < from + 4; x++) stroke(x, y, 10, 'line', element, style)
      stroke(from + 4, y, 12, 'corner', element)
      for (let row = y + 1; row <= y + positioned.lines.length; row++) stroke(from + 4, row, 5, 'line', element)
      const bottom = y + positioned.lines.length + 1
      for (let x = from + 1; x < from + 4; x++) stroke(x, bottom, 10, 'line', element, style)
      stroke(from + 4, bottom, 9, 'corner', element)
      endpoint(from, bottom, false, false)
      endpoint(from, y, true, false)
    } else {
      for (let x = Math.min(from, to) + 1; x < Math.max(from, to); x++) stroke(x, y, 10, 'line', element, style)
      endpoint(from, y, true, from > to)
      endpoint(to, y, false, from < to)
    }
    doc.scope(element, () => positioned.lines.forEach((line, index) => {
      doc.text(messageLabelX(positioned, line), positioned.y + index, line, { owner: element, role: 'text', kind: 'text' })
    }))
  }
  // Frames use measured owned bounds, including complete conditions and notes.
  for (const positioned of [...closedFrames].reverse()) {
    const element = owner(blockId(positioned.index), 'compartment', positioned.parentId === undefined ? undefined : { id: positioned.parentId, kind: 'compartment' })
    frame(positioned, element)
    doc.textBlock(positioned.x + 1, positioned.y, positioned.header, { owner: element, role: 'text', kind: 'text' })
    positioned.dividers.forEach(divider => {
      if (diagram.blocks[positioned.index]!.type !== 'par_over') {
        for (let x = positioned.x; x < positioned.x + positioned.width; x++) stroke(x, divider.y, 10, 'line', element, ascii ? 'solid' : 'dashed')
      }
      doc.textBlock(divider.x ?? positioned.x + 1, divider.y, divider.lines, { owner: element, role: 'text', kind: 'text' })
    })
  }
  for (const positioned of notes) {
    const element = owner(diagram.notes[positioned.index]!.id ?? generated(`note:${positioned.index}`), 'node', positioned.parentId === undefined ? undefined : { id: positioned.parentId, kind: 'compartment' })
    frame(positioned, element, true)
    doc.textBlock(positioned.x + 2, positioned.y + 1, positioned.lines, { owner: element, role: 'text', kind: 'text' })
  }
  if (diagram.title) {
    const lines = wrapText(prepareDisplayText(resolveLabelContent(diagram.title, diagram.titleContent)), targetWidth)
    const titled = new TerminalDocument(Math.max(doc.width, ...lines.map(visualWidth)), doc.height + lines.length + 1)
    const element = owner('title', 'label')
    titled.scope(element, () => lines.forEach((line, y) => titled.text(Math.floor((titled.width - visualWidth(line)) / 2), y, line, { role: 'text', kind: 'text' })))
    titled.overlay(doc, 0, lines.length + 1)
    return terminalArtifact(titled, { colorMode, theme })
  }
  return terminalArtifact(doc, { colorMode, theme })
}

function sequenceMarker(head: SequenceMessageHead, right: boolean, ascii: boolean, central?: boolean): TerminalMarker | undefined {
  if (central) return { shape: 'circle', ascii }
  if (head === 'none') return undefined
  return { shape: head === 'filled' ? 'triangle' : head === 'open' ? 'open-arrow' : head === 'cross' ? 'sequence-cross' : head, direction: right ? 'R' : 'L', ascii }
}

/** Compatibility string entry point; native dispatch retains the drawing. */
export function renderSequenceAscii(...args: Parameters<typeof renderSequenceTerminal>): string {
  return serializeTerminalArtifact(renderSequenceTerminal(...args))
}
