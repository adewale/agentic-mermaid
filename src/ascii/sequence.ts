// Terminal sequence layout owns cell bounds before painting. Lexical fragment
// boundaries distinguish notes and empty sections sharing a message cursor.
import { parseSequenceDiagram, displayMessageLabel, getSequenceBlockBoundaries } from '../sequence/parser.ts'
import { resolveSequenceBlockScopes } from '../sequence/geometry.ts'
import type { SequenceMessageHead } from '../sequence/types.ts'
import type { ResolvedSequenceConfig } from '../sequence/config.ts'
import type { AsciiConfig, AsciiTheme, ColorMode, CharRole } from './types.ts'
import { TerminalDocument, finishTerminalDocument, type TerminalOwner } from './terminal-document.ts'
import { visualWidth } from './width.ts'
import { wrapText } from './wrap.ts'
import { displayText, normalizeBrTags } from '../multiline-utils.ts'
import { terminalIds } from './identity.ts'

interface CellBounds { x: number; y: number; width: number; height: number }
interface PositionedText extends CellBounds { lines: string[]; index: number; parentId?: string }
interface SequenceFrame extends CellBounds { index: number; header: string[]; dividers: Array<{ y: number; lines: string[] }> ; parentId?: string }

export function renderSequenceAscii(text: string, config: AsciiConfig, colorMode?: ColorMode, theme?: AsciiTheme, seqConfig: ResolvedSequenceConfig = {}, targetWidth?: number): string {
  targetWidth ??= config.targetWidth ?? config.maxWidth
  const diagram = parseSequenceDiagram(text.split('\n').map(line => line.trim()).filter(line => line && !line.startsWith('%%')), seqConfig)
  diagram.title ??= config.title === undefined ? undefined : normalizeBrTags(config.title)
  if (!diagram.actors.length && !diagram.blocks.length) {
    const empty = new TerminalDocument()
    if (diagram.title) for (const line of wrapText(displayText(diagram.title), targetWidth)) empty.line([{ text: line, owner: { id: 'title', kind: 'label' }, role: 'text' }])
    return finishTerminalDocument(config, empty, { colorMode, theme, trimEnd: true })
  }
  const generated = terminalIds(diagram.actors.map(actor => actor.id))
  const ascii = config.useAscii
  const H = ascii ? '-' : '─', V = ascii ? '|' : '│'
  const TL = ascii ? '+' : '┌', TR = ascii ? '+' : '┐', BL = ascii ? '+' : '└', BR = ascii ? '+' : '┘'
  const actorIndex = new Map(diagram.actors.map((actor, index) => [actor.id, index]))
  const budget = targetWidth === undefined ? undefined : Math.max(1, Math.floor(targetWidth / 3))
  const prepared = (value: string) => wrapText(displayText(value), budget)
  const actorLines = diagram.actors.map(actor => prepared(actor.type === 'participant' || actor.type === 'actor' ? actor.label : `«${actor.type}»\n${actor.label}`))
  const messageLines = diagram.messages.map(message => prepared(displayMessageLabel(message)))
  const noteLines = diagram.notes.map(note => prepared(note.text))
  const headerLines = diagram.blocks.map(block => prepared(block.label ? `${block.type} [${block.label}]` : block.type))
  const dividerLines = diagram.blocks.map(block => block.dividers.map(divider => divider.label ? prepared(`[${divider.label}]`) : ['']))
  const actorWidths = actorLines.map(lines => Math.max(0, ...lines.map(visualWidth)) + 4)
  const boxHeaders = (diagram.boxes ?? []).map(box => box.label ? prepared(box.label) : [])
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
  const messages: Array<PositionedText & { arrowY: number; fromX: number; toX: number }> = []
  const notes: PositionedText[] = []
  const frames = new Map<number, SequenceFrame>()
  const closedFrames: SequenceFrame[] = []
  const activeFrames: number[] = []
  const actorTop = new Map<number, number>()
  const currentParent = () => activeFrames.length ? generated(`block:${activeFrames.at(-1)!}`) : undefined
  let cursor = participantTop + actorBoxH
  const ownedBounds = new Map<number, CellBounds[]>()
  const own = (bounds: CellBounds) => {
    // Every ancestor owns its full contents; frame completion adds its margins.
    for (const index of activeFrames) {
      const list = ownedBounds.get(index) ?? []
      list.push(bounds); ownedBounds.set(index, list)
    }
  }
  let messageCursor = 0, noteCursor = 0, boundaryCursor = 0
  const boundaries = getSequenceBlockBoundaries(diagram) ?? []
  const consumeBoundaries = () => {
    while (boundaryCursor < boundaries.length) {
      const event = boundaries[boundaryCursor]!
      if (event.messageIndex > messageCursor || event.noteIndex > noteCursor) break
      const index = event.blockIndex
      if (event.kind === 'open') {
        cursor++
        frames.set(index, { index, x: 0, y: cursor, width: 0, height: 0, header: headerLines[index]!, dividers: [], parentId: currentParent() })
        activeFrames.push(index)
        cursor += Math.max(1, headerLines[index]!.length)
      } else if (event.kind === 'divider') {
        cursor++
        const lines = dividerLines[index]![event.dividerIndex!]!
        frames.get(index)!.dividers.push({ y: cursor, lines })
        cursor += Math.max(1, lines.length)
      } else {
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
      const width = Math.max(0, ...lines.map(visualWidth)) + 4
      const first = llX[actorIndex.get(note.actorIds[0]!) ?? 0]!
      const last = llX[actorIndex.get(note.actorIds.at(-1)!) ?? 0]!
      const x = note.position === 'left' ? first - width - 1 : note.position === 'right' ? first + 2 : Math.floor((first + last) / 2) - Math.floor(width / 2)
      const positioned = { index: noteCursor, x: Math.max(0, x), y: cursor, width, height: lines.length + 2, lines, parentId: currentParent() }
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
      const positioned = { index: messageCursor, x: self ? fromX + 6 : Math.min(fromX, toX) + Math.floor((Math.abs(toX - fromX) - width) / 2), y: self ? cursor + 1 : cursor, width, height: lines.length, lines, arrowY: self ? cursor : cursor + lines.length, fromX, toX, parentId: currentParent() }
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
  const owner = (id: string, kind: TerminalOwner['kind'] = 'node', parentId?: string): TerminalOwner => ({ id, kind, ...(parentId ? { parentId } : {}) })
  const put = (x: number, y: number, glyph: string, role: CharRole, element: TerminalOwner, kind: 'stroke' | 'marker' = 'stroke') => doc.put(x, y, glyph, { owner: element, role, kind })
  const frame = (bounds: CellBounds, element: TerminalOwner, opaque = false) => {
    doc.region(element, { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height })
    if (opaque) doc.fill(bounds.x, bounds.y, bounds.width, bounds.height, { owner: element, kind: 'surface' })
    for (let x = bounds.x + 1; x < bounds.x + bounds.width - 1; x++) { put(x, bounds.y, H, 'border', element); put(x, bounds.y + bounds.height - 1, H, 'border', element) }
    for (let y = bounds.y + 1; y < bounds.y + bounds.height - 1; y++) { put(bounds.x, y, V, 'border', element); put(bounds.x + bounds.width - 1, y, V, 'border', element) }
    put(bounds.x, bounds.y, TL, 'border', element); put(bounds.x + bounds.width - 1, bounds.y, TR, 'border', element)
    put(bounds.x, bounds.y + bounds.height - 1, BL, 'border', element); put(bounds.x + bounds.width - 1, bounds.y + bounds.height - 1, BR, 'border', element)
  }
  // Participant-group frames are background geometry with distinct ownership.
  participantGroups.forEach(group => {
    const element: TerminalOwner = { id: generated(`box:${group.index}`), kind: 'group', members: group.members }
    frame({ x: group.x, y: 0, width: group.width, height: footerY + actorBoxH + 1 }, element)
    doc.scope(element, () => group.lines.forEach((line, y) => doc.text(group.x + 1, y, line, { role: 'text', kind: 'text' })))
  })
  diagram.actors.forEach((actor, index) => {
    const element = owner(actor.id, 'node', actor.box === undefined ? undefined : generated(`box:${actor.box}`))
    const start = actorTop.has(index) ? actorTop.get(index)! + actorBoxH : participantTop + actorBoxH
    const end = actor.destroyMessageIndex === undefined ? footerY : messages[actor.destroyMessageIndex]?.arrowY ?? footerY
    for (let y = start; y <= end; y++) put(llX[index]!, y, V, 'line', element)
  })
  // Activations are owned spans, drawn behind opaque labels and notes.
  const activationStacks = new Map<string, Array<{ y: number; id: number }>>()
  let activationIndex = 0
  const activation = (id: string, y: number, enable: boolean) => {
    const stack = activationStacks.get(id) ?? []
    if (enable) stack.push({ y, id: activationIndex++ })
    else if (stack.length) {
      const opened = stack.pop()!, start = opened.y, ai = actorIndex.get(id)!, x = llX[ai]! + stack.length
      const element = owner(generated(`activation:${opened.id}`), 'band', id)
      doc.region(element, { x: x - 1, y: start, width: 3, height: Math.max(1, y - start + 1) })
      for (let row = start; row <= y; row++) { put(x - 1, row, V, 'line', element); put(x + 1, row, V, 'line', element) }
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
    const element = owner(actor.id, 'node', actor.box === undefined ? undefined : generated(`box:${actor.box}`))
    const drawActor = (top: number) => {
      const width = actorWidths[index]!, lines = actorLines[index]!, x = llX[index]! - Math.floor(width / 2)
      frame({ x, y: top, width, height: actorBoxH }, element, true)
      doc.scope(element, () => lines.forEach((line, row) => doc.text(x + 2 + Math.floor((width - 4 - visualWidth(line)) / 2), top + 1 + row, line, { owner: element, role: 'text', kind: 'text' })))
    }
    drawActor(actorTop.get(index) ?? participantTop)
    if (actor.destroyMessageIndex === undefined) drawActor(footerY)
    else put(llX[index]!, messages[actor.destroyMessageIndex]?.arrowY ?? footerY, 'X', 'arrow', element, 'marker')
    if (!ascii) {
      if (actor.createMessageIndex === undefined) put(llX[index]!, participantTop + actorBoxH - 1, '┬', 'junction', element)
      if (actor.destroyMessageIndex === undefined) put(llX[index]!, footerY, '┴', 'junction', element)
    }
  })
  for (const positioned of messages) {
    const message = diagram.messages[positioned.index]!, self = message.from === message.to
    const element = owner(generated(`message:${positioned.index}`), 'edge', positioned.parentId)
    const line = message.lineStyle === 'dashed' ? (ascii ? '.' : '╌') : H
    const y = positioned.arrowY, from = positioned.fromX, to = positioned.toX
    const endpoint = (start: boolean, right: boolean): string => {
      if (start ? message.centralStart : message.centralEnd) return ascii ? 'o' : '○'
      const head = start ? message.startHead : message.endHead
      return head === 'none' ? '' : sequenceHeadGlyph(head, right, ascii)
    }
    const startGlyph = endpoint(true, self || from > to), endGlyph = endpoint(false, !self && from < to)
    doc.port(element, { nodeId: message.from, x: from, y, side: self || from < to ? 'R' : 'L', end: 'start' })
    doc.port(element, { nodeId: message.to, x: to, y: self ? y + positioned.lines.length + 1 : y, side: self || from > to ? 'R' : 'L', end: 'end' })
    if (self) {
      put(from, y, ascii ? '+' : '├', 'junction', element)
      for (let x = from + 1; x < from + 4; x++) put(x, y, line, 'line', element)
      put(from + 4, y, ascii ? '+' : '┐', 'corner', element)
      for (let row = y + 1; row <= y + positioned.lines.length; row++) put(from + 4, row, V, 'line', element)
      const bottom = y + positioned.lines.length + 1
      for (let x = from + 1; x < from + 4; x++) put(x, bottom, line, 'line', element)
      put(from + 4, bottom, ascii ? '+' : '┘', 'corner', element)
      if (endGlyph) put(from, bottom, endGlyph, 'arrow', element, 'marker')
      if (startGlyph) put(from, y, startGlyph, 'arrow', element, 'marker')
    } else {
      for (let x = Math.min(from, to) + 1; x < Math.max(from, to); x++) put(x, y, line, 'line', element)
      if (startGlyph) put(from, y, startGlyph, 'arrow', element, 'marker')
      if (endGlyph) put(to, y, endGlyph, 'arrow', element, 'marker')
    }
    positioned.lines.forEach((line, index) => {
      const x = self ? positioned.x : Math.min(from, to) + Math.floor((Math.abs(to - from) - visualWidth(line)) / 2)
      doc.text(x, positioned.y + index, line, { owner: element, role: 'text', kind: 'text' })
    })
  }
  // Frames use measured owned bounds, including complete conditions and notes.
  for (const positioned of [...closedFrames].reverse()) {
    const element = owner(generated(`block:${positioned.index}`), 'compartment', positioned.parentId)
    frame(positioned, element)
    positioned.header.forEach((line, row) => doc.text(positioned.x + 1, positioned.y + row, line, { owner: element, role: 'text', kind: 'text' }))
    positioned.dividers.forEach(divider => {
      for (let x = positioned.x; x < positioned.x + positioned.width; x++) put(x, divider.y, ascii ? '-' : '╌', 'line', element)
      divider.lines.forEach((line, row) => { if (line) doc.text(positioned.x + 1, divider.y + row, line, { owner: element, role: 'text', kind: 'text' }) })
    })
  }
  for (const positioned of notes) {
    const element = owner(generated(`note:${positioned.index}`), 'node', positioned.parentId)
    frame(positioned, element, true)
    positioned.lines.forEach((line, row) => doc.text(positioned.x + 2, positioned.y + row + 1, line, { owner: element, role: 'text', kind: 'text' }))
  }
  if (diagram.title) {
    const lines = wrapText(displayText(diagram.title), targetWidth)
    const titled = new TerminalDocument(Math.max(doc.width, ...lines.map(visualWidth)), doc.height + lines.length + 1)
    const element = owner('title', 'label')
    titled.scope(element, () => lines.forEach((line, y) => titled.text(Math.floor((titled.width - visualWidth(line)) / 2), y, line, { role: 'text', kind: 'text' })))
    titled.overlay(doc, 0, lines.length + 1)
    return finishTerminalDocument(config, titled, { colorMode, theme })
  }
  return finishTerminalDocument(config, doc, { colorMode, theme })
}

function sequenceHeadGlyph(head: SequenceMessageHead, right: boolean, ascii: boolean): string {
  if (head === 'cross') return 'X'
  if (head === 'half-top') return right ? (ascii ? '/' : '◜') : (ascii ? '\\' : '◝')
  if (head === 'half-bottom') return right ? (ascii ? '\\' : '◟') : (ascii ? '/' : '◞')
  if (head === 'stick-top') return right ? '/' : '\\'
  if (head === 'stick-bottom') return right ? '\\' : '/'
  if (head === 'filled') return right ? (ascii ? '>' : '▶') : (ascii ? '<' : '◀')
  return right ? (ascii ? '>' : '▷') : (ascii ? '<' : '◁')
}
