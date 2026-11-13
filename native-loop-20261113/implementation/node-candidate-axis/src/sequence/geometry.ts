import { preparePixelText, type PixelTextBlock } from '../shared/prepared-text.ts'
import type { Actor, Block, Message, PositionedActor, PositionedBlock, PositionedBlockDivider, PositionedBlockHeader, PositionedMessage, PositionedNote, PositionedSequenceDiagram, PositionedSequenceLabel, SequenceBounds, SequenceDiagram } from './types.ts'
import { displayMessageLabel, getSequenceBlockScope, type SequenceBlockScope } from './parser.ts'
import { displayMessageContent } from './parser.ts'
import { concatDisplayText, prepareDisplayText, resolveLabelContent, type LabelContent } from '../shared/display-text.ts'
import { ARROW_HEAD, type ResolvedRenderStyle } from '../styles.ts'
import { LINE_HEIGHT_RATIO, type MultilineMetrics } from '../text-metrics.ts'
import type { resolveRoleStyle } from '../scene/style-registry.ts'

type ResolvedRoleStyle = ReturnType<typeof resolveRoleStyle>

// ============================================================================
// Sequence Diagram Geometry Authority
//
// Owns complete painted bounds and label anchors for sequence actors,
// messages, self-message loops, notes, and fragments (`loop`, `alt`, `opt`,
// `par`, `critical`, `break`, `rect`). Both SVG lowering (`renderer.ts`) and
// agent layout projection (`family-layouts.ts`) consume these bounds directly
// instead of reconstructing independent extents.
// ============================================================================

export const SEQUENCE_SELF_LOOP = {
  width: 30,
  height: 20,
  labelPadding: 8,
} as const

/** Pixel layout owns its wrap width; terminal output owns a cell budget. */
export const SEQUENCE_TEXT_WRAP_WIDTH = 240

export interface MeasuredSequenceLabel extends PositionedSequenceLabel {
  metrics: MultilineMetrics
}

export function createSequenceLabelGeometry(text: string, x: number, y: number, anchor: 'start' | 'middle' | 'end', fontSize: number, fontWeight: number, letterSpacing = 0, block = preparePixelText(text, { fontSize, fontWeight, letterSpacing })): MeasuredSequenceLabel {
  const metrics = block
  const left = anchor === 'middle' ? x - metrics.width / 2 : anchor === 'start' ? x : x - metrics.width
  return {
    text: block.text,
    block,
    x,
    y,
    anchor,
    fontSize,
    fontWeight,
    letterSpacing,
    bounds: {
      x: left,
      y: y - metrics.height / 2,
      width: metrics.width,
      height: metrics.height,
    },
    metrics,
  }
}

export function unionSequenceBounds(a: SequenceBounds, b: SequenceBounds): SequenceBounds {
  const minX = Math.min(a.x, b.x)
  const minY = Math.min(a.y, b.y)
  const maxX = Math.max(a.x + a.width, b.x + b.width)
  const maxY = Math.max(a.y + a.height, b.y + b.height)
  return {
    x: minX,
    y: minY,
    width: maxX - minX,
    height: maxY - minY,
  }
}

export function translateSequenceBounds(bounds: SequenceBounds, dx: number, dy: number): SequenceBounds {
  return {
    x: bounds.x + dx,
    y: bounds.y + dy,
    width: bounds.width,
    height: bounds.height,
  }
}

export function translateSequenceLabel<T extends PositionedSequenceLabel>(label: T, dx: number, dy: number): T {
  return {
    ...label,
    x: label.x + dx,
    y: label.y + dy,
    bounds: translateSequenceBounds(label.bounds, dx, dy),
  }
}

// ============================================================================
// Actor Header Geometry
// ============================================================================

export interface SequenceActorGeometrySpec {
  menuBlock?: PixelTextBlock
  fontSize: number
  fontWeight: number
  letterSpacing: number
  paddingX: number
  paddingY: number
  displayLabel: string
  block: PixelTextBlock
  labelMetrics: MultilineMetrics
  width: number
  /** Box height for `participant`, or glyph height for icon participants. */
  height: number
}

export function measureSequenceActorSpec(actor: Actor, style: ResolvedRenderStyle, roleStyle: ResolvedRoleStyle | undefined, minActorWidth: number, baseActorHeight: number): SequenceActorGeometrySpec {
  const transform = roleStyle?.textTransform ?? style.nodeTextTransform
  const fontSize = roleStyle?.fontSize ?? style.nodeLabelFontSize
  const fontWeight = roleStyle?.fontWeight ?? style.nodeLabelFontWeight
  const letterSpacing = roleStyle?.letterSpacing ?? style.nodeLetterSpacing
  const paddingX = roleStyle?.paddingX ?? style.nodePaddingX
  const paddingY = roleStyle?.paddingY ?? style.nodePaddingY
  const block = preparePixelText(resolveLabelContent(actor.label, actor.labelContent), { transform, fontSize, fontWeight, letterSpacing, ...(actor.wrap ? { maxWidth: SEQUENCE_TEXT_WRAP_WIDTH } : {}) })
  const displayLabel = block.text
  const labelMetrics = block
  const width = Math.max(labelMetrics.width + paddingX * 2, minActorWidth)
  const height = actor.type === 'participant' ? Math.max(baseActorHeight, Math.ceil(labelMetrics.height + paddingY * 2)) : baseActorHeight

  return {
    fontSize,
    fontWeight,
    letterSpacing,
    paddingX,
    paddingY,
    displayLabel,
    block,
    ...(actor.links ? { menuBlock: preparePixelText('⋯', { display: 'literal', fontSize: 10, fontWeight: 400 }) } : {}),
    labelMetrics,
    width,
    height,
  }
}

export function positionSequenceActor(actor: Actor, spec: SequenceActorGeometrySpec, centerX: number, topY: number): PositionedActor {
  if (actor.type === 'participant') {
    const labelPosition = createSequenceLabelGeometry(spec.displayLabel, centerX, topY + spec.height / 2, 'middle', spec.fontSize, spec.fontWeight, spec.letterSpacing, spec.block)
    const bounds: SequenceBounds = {
      x: centerX - spec.width / 2,
      y: topY,
      width: spec.width,
      height: spec.height,
    }
    return {
      id: actor.id,
      label: actor.label,
      type: actor.type,
      ...(actor.links ? { links: { ...actor.links } } : {}),
      ...(spec.menuBlock ? { menuBlock: spec.menuBlock } : {}),
      x: centerX,
      y: topY,
      width: spec.width,
      height: spec.height,
      bounds,
      labelPosition,
    }
  }

  // Icon participants (`actor`, `boundary`, `control`, `entity`, `database`,
  // `collections`, `queue`) draw their glyph inside `[topY, glyphBottom]` and
  // their label below the glyph. Anchor the first line below the glyph so
  // multi-line labels stack downward instead of centering upward into the icon.
  const glyphBottom = actor.type === 'actor' ? topY + spec.height : Math.max(topY + spec.height, topY + 26)
  const firstLineOffset = Math.max(14, spec.labelMetrics.lineHeight / 2 + 5.5)
  const labelY = glyphBottom + firstLineOffset + ((spec.labelMetrics.lines.length - 1) / 2) * spec.labelMetrics.lineHeight
  const labelPosition = createSequenceLabelGeometry(spec.displayLabel, centerX, labelY, 'middle', spec.fontSize, spec.fontWeight, spec.letterSpacing, spec.block)
  const glyphBounds: SequenceBounds = {
    x: centerX - spec.width / 2,
    y: topY,
    width: spec.width,
    height: glyphBottom - topY,
  }
  const combined = unionSequenceBounds(glyphBounds, labelPosition.bounds)
  const bounds: SequenceBounds = {
    x: combined.x,
    y: combined.y,
    width: combined.width,
    height: combined.height + 4,
  }

  return {
    id: actor.id,
    label: actor.label,
    type: actor.type,
    ...(actor.links ? { links: { ...actor.links } } : {}),
    ...(spec.menuBlock ? { menuBlock: spec.menuBlock } : {}),
    x: centerX,
    y: topY,
    width: spec.width,
    height: spec.height,
    bounds,
    labelPosition,
  }
}

export function translatePositionedActor(actor: PositionedActor, dx: number, dy: number): void {
  actor.x += dx
  actor.y += dy
  actor.bounds = translateSequenceBounds(actor.bounds, dx, dy)
  actor.labelPosition = translateSequenceLabel(actor.labelPosition, dx, dy)
}

// ============================================================================
// Message & Self-Loop Geometry
// ============================================================================

export interface SequenceMessageGeometrySpec {
  label: string
  labelContent: LabelContent
  displayLabel: string
  block: PixelTextBlock
  labelMetrics: MultilineMetrics
  startPad: number
  endPad: number
  markerHalfHeight: number
  requiredSpanWidth: number
  selfRightExtent: number
  requiredSelfNeighborGap: number
  extraAboveHeight: number
}

export function measureSequenceMessageSpec(message: Message, style: ResolvedRenderStyle, activationWidth: number): SequenceMessageGeometrySpec {
  const label = displayMessageLabel(message)
  const labelContent = Object.freeze({ value: label, prepared: prepareDisplayText(displayMessageContent(message)) })
  const block = preparePixelText(labelContent.prepared, { transform: style.edgeTextTransform, fontSize: style.edgeLabelFontSize, fontWeight: style.edgeLabelFontWeight, letterSpacing: style.edgeLetterSpacing, ...(message.wrap ? { maxWidth: SEQUENCE_TEXT_WRAP_WIDTH } : {}) })
  const displayLabel = block.text
  const defaultLineHeight = style.edgeLabelFontSize * LINE_HEIGHT_RATIO
  const labelMetrics: MultilineMetrics = label ? block : { width: 0, height: 0, lines: [], lineHeight: defaultLineHeight }
  const startPad = Math.max(message.startHead !== 'none' ? ARROW_HEAD.width : 0, message.centralStart ? 5 : 0)
  const endPad = Math.max(message.endHead !== 'none' ? ARROW_HEAD.width : 0, message.centralEnd ? 5 : 0)
  const markerHalfHeight = Math.max(style.lineWidth / 2, message.startHead !== 'none' || message.endHead !== 'none' ? ARROW_HEAD.height / 2 : 0, message.centralStart || message.centralEnd ? 4.75 : 0)
  const shaftClearance = Math.max(16, startPad + endPad + 8)
  const requiredSpanWidth = labelMetrics.width + shaftClearance
  const selfRightExtent = SEQUENCE_SELF_LOOP.width + (labelMetrics.width > 0 ? SEQUENCE_SELF_LOOP.labelPadding + labelMetrics.width : 0)
  const requiredSelfNeighborGap = selfRightExtent + Math.max(12, activationWidth / 2 + 8)
  const extraAboveHeight = message.from === message.to ? 0 : Math.ceil(Math.max(0, labelMetrics.height - defaultLineHeight))

  return {
    label,
    labelContent,
    displayLabel,
    block,
    labelMetrics,
    startPad,
    endPad,
    markerHalfHeight,
    requiredSpanWidth,
    selfRightExtent,
    requiredSelfNeighborGap,
    extraAboveHeight,
  }
}

export function positionSequenceMessage(message: Message, spec: SequenceMessageGeometrySpec, style: ResolvedRenderStyle, x1: number, x2: number, y: number): PositionedMessage {
  const isSelf = message.from === message.to
  if (isSelf) {
    const loopW = SEQUENCE_SELF_LOOP.width
    const loopH = SEQUENCE_SELF_LOOP.height
    const points = [
      { x: x1, y },
      { x: x1 + loopW, y },
      { x: x1 + loopW, y: y + loopH },
      { x: x2, y: y + loopH },
    ]
    const labelX = x1 + loopW + SEQUENCE_SELF_LOOP.labelPadding
    const labelY = y + Math.max(loopH, spec.labelMetrics.height) / 2
    const labelPosition = createSequenceLabelGeometry(spec.displayLabel, labelX, labelY, 'start', style.edgeLabelFontSize, style.edgeLabelFontWeight, style.edgeLetterSpacing, spec.block)
    const connectorBounds: SequenceBounds = {
      x: x1 - spec.startPad,
      y: y - spec.markerHalfHeight,
      width: loopW + spec.startPad + style.lineWidth / 2,
      height: loopH + spec.markerHalfHeight * 2,
    }
    const bounds = spec.label ? unionSequenceBounds(connectorBounds, labelPosition.bounds) : connectorBounds

    return {
      from: message.from,
      to: message.to,
      label: spec.label,
      labelContent: spec.labelContent,
      lineStyle: message.lineStyle,
      startHead: message.startHead,
      endHead: message.endHead,
      centralStart: message.centralStart ?? false,
      centralEnd: message.centralEnd ?? false,
      x1,
      x2,
      y,
      isSelf,
      points,
      labelPosition,
      bounds,
    }
  }

  const points = [
    { x: x1, y },
    { x: x2, y },
  ]
  const midX = (x1 + x2) / 2
  const minClearanceAboveShaft = Math.max(2.85, style.lineWidth / 2 + 2)
  const labelOffsetAboveArrow = Math.max(10, spec.labelMetrics.height / 2 + minClearanceAboveShaft)
  const labelY = y - labelOffsetAboveArrow
  const labelPosition = createSequenceLabelGeometry(spec.displayLabel, midX, labelY, 'middle', style.edgeLabelFontSize, style.edgeLabelFontWeight, style.edgeLetterSpacing, spec.block)
  const leftPad = x1 <= x2 ? spec.startPad : spec.endPad
  const rightPad = x1 <= x2 ? spec.endPad : spec.startPad
  const minX = Math.min(x1, x2) - leftPad
  const maxX = Math.max(x1, x2) + rightPad
  const connectorBounds: SequenceBounds = {
    x: minX,
    y: y - spec.markerHalfHeight,
    width: maxX - minX,
    height: spec.markerHalfHeight * 2,
  }
  const bounds = spec.label ? unionSequenceBounds(connectorBounds, labelPosition.bounds) : connectorBounds

  return {
    from: message.from,
    to: message.to,
    label: spec.label,
    labelContent: spec.labelContent,
    lineStyle: message.lineStyle,
    startHead: message.startHead,
    endHead: message.endHead,
    centralStart: message.centralStart ?? false,
    centralEnd: message.centralEnd ?? false,
    x1,
    x2,
    y,
    isSelf,
    points,
    labelPosition,
    bounds,
  }
}

export function translatePositionedMessage(message: PositionedMessage, dx: number, dy: number): void {
  message.x1 += dx
  message.x2 += dx
  message.y += dy
  message.points = message.points.map(p => ({ x: p.x + dx, y: p.y + dy }))
  message.labelPosition = translateSequenceLabel(message.labelPosition, dx, dy)
  message.bounds = translateSequenceBounds(message.bounds, dx, dy)
}

// ============================================================================
// Fragment (`PositionedBlock`) Geometry
// ============================================================================

export interface SequenceDividerGeometrySpec {
  index: number
  label: string
  displayLabel: string
  block: PixelTextBlock
  metrics: MultilineMetrics
  firstLineOffset: number
  extraFontOffset: number
  extraLinesHeight: number
  requiredExtraBefore: number
  noteContentOffset: number
}

export interface SequenceBlockGeometrySpec {
  headerText: string
  block: PixelTextBlock
  headerMetrics: MultilineMetrics
  tabWidth: number
  tabHeight: number
  extraHeaderLinesHeight: number
  blockPadTop: number
  blockHeaderExtra: number
  enclosingHeaderStep: number
  contentTopPadding: number
  dividers: SequenceDividerGeometrySpec[]
}

export function resolveSequenceBlockScopes(diagram: SequenceDiagram): SequenceBlockScope[] {
  return diagram.blocks.map((block, bi) => {
    const recorded = getSequenceBlockScope(block)
    if (recorded) return recorded

    // Fallback when a `SequenceDiagram` literal is constructed directly in a test
    // without going through `parseSequenceDiagram`.
    const noteIndices: number[] = []
    for (let ni = 0; ni < diagram.notes.length; ni++) {
      const note = diagram.notes[ni]!
      if (note.afterIndex >= block.startIndex && note.afterIndex <= block.endIndex) {
        noteIndices.push(ni)
      }
    }
    const childBlockIndices: number[] = []
    for (let ci = 0; ci < bi; ci++) {
      const candidate = diagram.blocks[ci]!
      if (candidate.startIndex >= block.startIndex && candidate.endIndex <= block.endIndex) {
        const hasIntermediateParent = diagram.blocks.some((other, oi) => oi > ci && oi < bi && candidate.startIndex >= other.startIndex && candidate.endIndex <= other.endIndex && other.startIndex >= block.startIndex && other.endIndex <= block.endIndex)
        if (!hasIntermediateParent) childBlockIndices.push(ci)
      }
    }
    return {
      endMessageExclusive: Math.min(block.endIndex + 1, diagram.messages.length),
      dividerNoteIndices: block.dividers.map(() => -1),
      endNoteExclusive: noteIndices.length > 0 ? noteIndices.at(-1)! + 1 : diagram.notes.filter(note => note.afterIndex <= block.endIndex).length,
      noteIndices,
      childBlockIndices,
      childSectionIndices: childBlockIndices.map(ci => block.dividers.filter(divider => diagram.blocks[ci]!.startIndex >= divider.index).length),
    }
  })
}

export function measureSequenceBlockSpec(block: Block, style: ResolvedRenderStyle, baseBlockPadTop: number, baseBlockHeaderExtra: number, baseDividerExtra: number, edgeTextHeight: number): SequenceBlockGeometrySpec {
  const header = block.type === 'rect' ? '' : block.label
    ? concatDisplayText([`${block.type} [`, prepareDisplayText(resolveLabelContent(block.label, block.labelContent)), ']'])
    : block.type
  const prepared = preparePixelText(header, { transform: style.groupTextTransform, fontSize: style.groupHeaderFontSize, fontWeight: style.groupHeaderFontWeight, letterSpacing: style.groupLetterSpacing, fontFamily: style.groupFont, ...(block.wrap ? { maxWidth: SEQUENCE_TEXT_WRAP_WIDTH } : {}) })
  const headerText = prepared.text
  const defaultHeaderLineHeight = style.groupHeaderFontSize * LINE_HEIGHT_RATIO
  const headerMetrics: MultilineMetrics = headerText ? prepared : { width: 0, height: 0, lines: [], lineHeight: defaultHeaderLineHeight }
  const extraHeaderLinesHeight = Math.ceil(Math.max(0, (headerMetrics.lines.length - 1) * headerMetrics.lineHeight))
  const tabPadX = Math.max(style.groupPaddingX * 2, style.groupLabelPaddingX * 2)
  const tabWidth = block.type === 'rect' ? 0 : headerMetrics.width + tabPadX
  const tabHeight = block.type === 'rect' ? 0 : Math.max(18, style.groupHeaderFontSize + style.groupPaddingY) + extraHeaderLinesHeight
  const blockPadTop = baseBlockPadTop + extraHeaderLinesHeight
  const blockHeaderExtra = baseBlockHeaderExtra + extraHeaderLinesHeight
  const enclosingHeaderStep = block.type === 'rect' ? style.groupPaddingY : tabHeight + style.groupPaddingY

  const dividers: SequenceDividerGeometrySpec[] = block.dividers.map(d => {
    const prepared = preparePixelText(d.label ? concatDisplayText(['[', prepareDisplayText(resolveLabelContent(d.label, d.labelContent)), ']']) : '', { transform: style.edgeTextTransform, fontSize: style.edgeLabelFontSize, fontWeight: style.edgeLabelFontWeight, letterSpacing: style.edgeLetterSpacing, ...(d.wrap ? { maxWidth: SEQUENCE_TEXT_WRAP_WIDTH } : {}) })
    const displayLabel = prepared.text
    const metrics: MultilineMetrics = d.label ? prepared : { width: 0, height: 0, lines: [], lineHeight: edgeTextHeight }
    const firstLineOffset = Math.max(14, Math.ceil(metrics.lineHeight / 2 + 6))
    const extraFontOffset = Math.max(0, firstLineOffset - 14)
    const extraLinesHeight = Math.ceil(Math.max(0, (metrics.lines.length - 1) * metrics.lineHeight))
    return {
      index: d.index,
      label: d.label,
      displayLabel,
      block: prepared,
      metrics,
      firstLineOffset,
      extraFontOffset,
      extraLinesHeight,
      requiredExtraBefore: baseDividerExtra + extraLinesHeight + extraFontOffset,
      noteContentOffset: Math.ceil(Math.max(28 + extraLinesHeight + extraFontOffset,
        firstLineOffset + ((metrics.lines.length - 1) / 2) * metrics.lineHeight + metrics.height / 2 + style.groupPaddingY)),
    }
  })

  return {
    headerText,
    block: prepared,
    headerMetrics,
    tabWidth,
    tabHeight,
    extraHeaderLinesHeight,
    blockPadTop,
    blockHeaderExtra,
    enclosingHeaderStep,
    contentTopPadding: block.type === 'rect' ? style.groupPaddingY : Math.max(blockPadTop, tabHeight + style.groupPaddingY),
    dividers,
  }
}

/** A section may begin with notes, even when it contains no messages. */
export function sequenceDividerLeadingNote(block: Block, scope: SequenceBlockScope, diagram: SequenceDiagram, dividerIndex: number): number | undefined {
  const ni = scope.dividerNoteIndices[dividerIndex] ?? -1
  const end = scope.dividerNoteIndices[dividerIndex + 1] ?? scope.endNoteExclusive
  return ni >= 0 && ni < end && diagram.notes[ni]!.afterIndex < block.dividers[dividerIndex]!.index ? ni : undefined
}

/** Reserved lexical boundaries for sections that have no message/note anchor. */
export interface SequenceBlockPlacement {
  top?: number
  dividerY: Array<number | undefined>
}

export function positionSequenceBlock(
  block: Block,
  spec: SequenceBlockGeometrySpec,
  scope: SequenceBlockScope,
  diagram: SequenceDiagram,
  actorIndex: ReadonlyMap<string, number>,
  actors: readonly PositionedActor[],
  messages: readonly PositionedMessage[],
  notes: readonly PositionedNote[],
  positionedBlocks: readonly PositionedBlock[],
  style: ResolvedRenderStyle,
  edgeTextHeight: number,
  fallbackY: number,
  placement?: SequenceBlockPlacement,
): PositionedBlock {
  const startMsg = block.startIndex < scope.endMessageExclusive ? messages[block.startIndex] : undefined
  const endMsg = block.startIndex < scope.endMessageExclusive ? messages[scope.endMessageExclusive - 1] : undefined

  // 1. Horizontal bounds from involved actors, owned messages, owned notes, and child blocks
  const involvedActors = new Set<number>()
  for (let mi = block.startIndex; mi < scope.endMessageExclusive; mi++) {
    const m = diagram.messages[mi]
    if (m) {
      involvedActors.add(actorIndex.get(m.from) ?? 0)
      involvedActors.add(actorIndex.get(m.to) ?? 0)
    }
  }
  for (const ni of scope.noteIndices) {
    const note = diagram.notes[ni]
    if (note) {
      for (const actorId of note.actorIds) {
        const ai = actorIndex.get(actorId)
        if (ai !== undefined) involvedActors.add(ai)
      }
    }
  }
  if (involvedActors.size === 0) {
    for (let ai = 0; ai < diagram.actors.length; ai++) involvedActors.add(ai)
  }

  let blockLeft = Number.POSITIVE_INFINITY
  let blockRight = Number.NEGATIVE_INFINITY
  for (const ai of involvedActors) {
    const actor = actors[ai]
    if (!actor) continue
    const actorBounds = actor.bounds
    blockLeft = Math.min(blockLeft, actorBounds.x - style.groupPaddingX)
    blockRight = Math.max(blockRight, actorBounds.x + actorBounds.width + style.groupPaddingX)
  }

  for (let mi = block.startIndex; mi < scope.endMessageExclusive; mi++) {
    const msg = messages[mi]
    if (!msg) continue
    blockLeft = Math.min(blockLeft, msg.bounds.x - style.groupPaddingX)
    blockRight = Math.max(blockRight, msg.bounds.x + msg.bounds.width + style.groupPaddingX)
  }

  for (const ni of scope.noteIndices) {
    const note = notes[ni]
    if (!note) continue
    blockLeft = Math.min(blockLeft, note.x - style.groupPaddingX)
    blockRight = Math.max(blockRight, note.x + note.width + style.groupPaddingX)
  }

  for (const ci of scope.childBlockIndices) {
    const child = positionedBlocks[ci]
    if (!child) continue
    blockLeft = Math.min(blockLeft, child.x - style.groupPaddingX)
    blockRight = Math.max(blockRight, child.x + child.width + style.groupPaddingX)
  }

  // Ensure the block is wide enough to contain its own header tab and divider labels
  if (block.type !== 'rect') {
    blockRight = Math.max(blockRight, blockLeft + spec.tabWidth + style.groupPaddingX)
  }
  for (const divSpec of spec.dividers) {
    if (divSpec.label) {
      blockRight = Math.max(blockRight, blockLeft + 8 + divSpec.metrics.width + style.groupPaddingX)
    }
  }

  // 2. Vertical bounds from owned messages, created actors, owned notes, and child blocks
  const startMsgExtraAbove = startMsg && !startMsg.isSelf && startMsg.labelPosition.text.includes('\n') ? Math.ceil(Math.max(0, startMsg.labelPosition.y - startMsg.labelPosition.bounds.y - (style.edgeLabelFontSize * LINE_HEIGHT_RATIO) / 2 - 1e-6)) : 0
  const fallbackTopPadding = scope.noteIndices.length > 0 ? spec.contentTopPadding : spec.blockPadTop
  let blockTop = placement?.top ?? (startMsg ? startMsg.y - (spec.blockPadTop + startMsgExtraAbove) : fallbackY - fallbackTopPadding)

  let blockBottom = (endMsg?.y ?? fallbackY) + style.groupPaddingY + 12
  for (let mi = block.startIndex; mi < scope.endMessageExclusive; mi++) {
    const msg = messages[mi]
    if (!msg) continue
    // Consume the full upper extent too: reconstructing half the multiline
    // label height can put its first lines above the frame and header tab.
    blockTop = Math.min(blockTop, msg.bounds.y - Math.max(spec.tabHeight, style.groupPaddingY))
    const bottomPad = msg.isSelf ? style.groupPaddingY + 4 : style.groupPaddingY
    blockBottom = Math.max(blockBottom, msg.bounds.y + msg.bounds.height + bottomPad)
  }

  for (const ai of involvedActors) {
    const actorDecl = diagram.actors[ai]
    const actor = actors[ai]
    if (!actor || actorDecl?.createMessageIndex === undefined || !messages[actorDecl.createMessageIndex]) continue
    if (actorDecl.createMessageIndex >= block.startIndex && actorDecl.createMessageIndex < scope.endMessageExclusive) {
      const createdTopPad = spec.contentTopPadding
      blockTop = Math.min(blockTop, actor.bounds.y - createdTopPad)
      blockBottom = Math.max(blockBottom, actor.bounds.y + actor.bounds.height + style.groupPaddingY)
    }
  }

  for (const ni of scope.noteIndices) {
    const note = notes[ni]
    if (!note) continue
    const noteTopPad = spec.contentTopPadding
    blockTop = Math.min(blockTop, note.y - noteTopPad)
    blockBottom = Math.max(blockBottom, note.y + note.height + style.groupPaddingY)
  }

  for (const ci of scope.childBlockIndices) {
    const child = positionedBlocks[ci]
    if (!child) continue
    blockTop = Math.min(blockTop, child.y - spec.enclosingHeaderStep)
    blockBottom = Math.max(blockBottom, child.y + child.height + style.groupPaddingY)
  }

  // 3. Position dividers and their labels
  const dividers: PositionedBlockDivider[] = spec.dividers.map((divSpec, di) => {
    const noteIndex = sequenceDividerLeadingNote(block, scope, diagram, di)
    const leadingNote = noteIndex === undefined ? undefined : notes[noteIndex]
    const msg = divSpec.index < scope.endMessageExclusive ? messages[divSpec.index] : undefined
    if (block.type === 'par_over') {
      if (!divSpec.label) return { y: blockTop + spec.tabHeight, label: '' }
      let content: SequenceBounds | undefined = leadingNote ?? msg?.bounds
      for (const [childIndex, ci] of scope.childBlockIndices.entries()) {
        const child = positionedBlocks[ci]
        if (child && scope.childSectionIndices[childIndex] === di + 1 && diagram.blocks[ci]!.startIndex === divSpec.index && (!content || child.y < content.y)) content = child
      }
      const x = content?.x ?? blockLeft + 8
      const top = content ? content.y - divSpec.metrics.height - 8 : blockTop + spec.tabHeight + 8 + di * (divSpec.metrics.height + 8)
      const measured = createSequenceLabelGeometry(divSpec.displayLabel, x, top + divSpec.metrics.height / 2, 'start', style.edgeLabelFontSize, style.edgeLabelFontWeight, style.edgeLetterSpacing, divSpec.block)
      blockRight = Math.max(blockRight, measured.bounds.x + measured.bounds.width + style.groupPaddingX)
      blockBottom = Math.max(blockBottom, measured.bounds.y + measured.bounds.height + style.groupPaddingY)
      return { y: top, label: divSpec.label, labelPosition: measured }
    }
    const msgY = msg?.y ?? fallbackY
    let offset = 28 + divSpec.extraLinesHeight + divSpec.extraFontOffset

    if (divSpec.label && msg?.label) {
      const divLabelLeft = blockLeft + 8
      const divLabelRight = divLabelLeft + divSpec.metrics.width
      const msgBounds = msg.labelPosition.bounds
      const msgLabelLeft = msgBounds.x
      const msgLabelRight = msgBounds.x + msgBounds.width
      const horizontalClearance = 8
      if (divLabelRight + horizontalClearance > msgLabelLeft && divLabelLeft - horizontalClearance < msgLabelRight) {
        const extraMsgLabelAbove = Math.max(0, Math.ceil(msgY - 10 - (msgBounds.y + msgBounds.height / 2)))
        offset = Math.max(36 + divSpec.extraLinesHeight + divSpec.extraFontOffset + extraMsgLabelAbove, Math.ceil(24 + edgeTextHeight + divSpec.extraLinesHeight + divSpec.extraFontOffset + extraMsgLabelAbove))
      }
    }

    const reservedY = placement?.dividerY[di]
    let divY = reservedY ?? (leadingNote ? leadingNote.y - divSpec.noteContentOffset : msgY - offset)
    // If a child block starts at this divider's message index, keep the divider
    // and its label above the child block's top border.
    for (const [childIndex, ci] of scope.childBlockIndices.entries()) {
      const child = positionedBlocks[ci]
      const childSpec = diagram.blocks[ci]
      if (reservedY === undefined && child && childSpec?.startIndex === divSpec.index && scope.childSectionIndices[childIndex] === di + 1) {
        const divContentHeight = divSpec.noteContentOffset
        divY = Math.min(divY, child.y - divContentHeight)
      }
    }

    if (!divSpec.label) {
      return { y: divY, label: divSpec.label }
    }

    const labelY = divY + divSpec.firstLineOffset + ((divSpec.metrics.lines.length - 1) / 2) * divSpec.metrics.lineHeight
    const measured = createSequenceLabelGeometry(divSpec.displayLabel, blockLeft + 8, labelY, 'start', style.edgeLabelFontSize, style.edgeLabelFontWeight, style.edgeLetterSpacing, divSpec.block)
    blockBottom = Math.max(blockBottom, measured.bounds.y + measured.bounds.height + style.groupPaddingY)
    return {
      y: divY,
      label: divSpec.label,
      labelPosition: {
        ...measured,
        text: divSpec.displayLabel,
      },
    }
  })

  const header: PositionedBlockHeader | undefined =
    block.type === 'rect'
      ? undefined
      : (() => {
          const labelY = blockTop + spec.tabHeight / 2
          const measured = createSequenceLabelGeometry(spec.headerText, blockLeft + style.groupLabelPaddingX, labelY, 'start', style.groupHeaderFontSize, style.groupHeaderFontWeight, style.groupLetterSpacing, spec.block)
          return {
            x: blockLeft,
            y: blockTop,
            width: spec.tabWidth,
            height: spec.tabHeight,
            label: {
              ...measured,
              text: spec.headerText,
            },
          }
        })()

  const bounds: SequenceBounds = {
    x: blockLeft,
    y: blockTop,
    width: blockRight - blockLeft,
    height: blockBottom - blockTop,
  }

  return {
    type: block.type,
    label: block.label,
    ...(block.color ? { color: block.color } : {}),
    x: bounds.x,
    y: bounds.y,
    width: bounds.width,
    height: bounds.height,
    dividers,
    ...(header ? { header } : {}),
    bounds,
  }
}

export function translatePositionedBlock(block: PositionedBlock, dx: number, dy: number): void {
  block.x += dx
  block.y += dy
  block.bounds = translateSequenceBounds(block.bounds, dx, dy)
  if (block.header) {
    block.header = {
      ...block.header,
      x: block.header.x + dx,
      y: block.header.y + dy,
      label: translateSequenceLabel(block.header.label, dx, dy),
    }
  }
  for (const divider of block.dividers) {
    divider.y += dy
    if (divider.labelPosition) {
      divider.labelPosition = translateSequenceLabel(divider.labelPosition, dx, dy)
    }
  }
}

export function translatePositionedSequence(positioned: Pick<PositionedSequenceDiagram, 'actors' | 'messages' | 'blocks' | 'notes' | 'boxes' | 'activations' | 'lifelines' | 'destructions'>, dx: number, dy: number): void {
  for (const actor of positioned.actors) translatePositionedActor(actor, dx, dy)
  for (const message of positioned.messages) translatePositionedMessage(message, dx, dy)
  for (const block of positioned.blocks) translatePositionedBlock(block, dx, dy)
  for (const note of positioned.notes) {
    note.x += dx
    note.y += dy
  }
  for (const box of positioned.boxes) {
    box.x += dx
    box.y += dy
    if (box.labelY !== undefined) box.labelY += dy
  }
  for (const activation of positioned.activations) {
    activation.x += dx
    activation.topY += dy
    activation.bottomY += dy
  }
  for (const lifeline of positioned.lifelines) {
    lifeline.x += dx
    lifeline.topY += dy
    lifeline.bottomY += dy
  }
  for (const cross of positioned.destructions) {
    cross.x += dx
    cross.y += dy
  }
}
