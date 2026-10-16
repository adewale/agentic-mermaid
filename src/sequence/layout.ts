import type { SequenceDiagram, PositionedSequenceDiagram, PositionedActor, Lifeline, PositionedMessage, Activation, PositionedBlock, PositionedNote, PositionedBoxGroup, LifelineCross } from './types.ts'
import { SEQUENCE_SELF_LOOP, measureSequenceActorSpec, measureSequenceBlockSpec, measureSequenceMessageSpec, positionSequenceActor, positionSequenceBlock, positionSequenceMessage, resolveSequenceBlockScopes, translatePositionedSequence } from './geometry.ts'
import type { RenderOptions } from '../types.ts'
import { applyTextTransform, FONT_SIZES, FONT_WEIGHTS, STROKE_WIDTHS, resolveRenderStyle, diagramTitleBand, positionDiagramTitle } from '../styles.ts'
import type { RenderStyleDefaults, ResolvedRenderStyle } from '../styles.ts'
import { measureMultilineText } from '../text-metrics.ts'
import type { ResolvedSequenceConfig } from './config.ts'
import { resolveRoleStyle, type InternalStyleFace } from '../scene/style-registry.ts'

// ============================================================================
// Sequence diagram layout engine
//
// Custom timeline-based layout (no ELK — sequence diagrams aren't graphs).
//
// Layout strategy:
//   1. Space actors horizontally based on label widths + min gap + message/self-loop spans
//   2. Stack messages vertically in chronological order
//   3. Track activation boxes via a stack
//   4. Position blocks (loop/alt/opt) from complete painted bounds of owned elements
//   5. Position notes next to their target actors
// ============================================================================

/** Layout constants specific to sequence diagrams */
const SEQ = {
  /** Padding around the entire diagram */
  padding: 30,
  /** Minimum gap between actor centers */
  actorGap: 140,
  /** Actor box height */
  actorHeight: 40,
  /** Horizontal padding inside actor boxes */
  actorPadX: 16,
  /** Vertical space between actor boxes and first message */
  headerGap: 26,
  /** Vertical space per message row */
  messageRowHeight: 40,
  /** Extra vertical space for self-messages (they loop back) */
  selfMessageHeight: 30,
  /** Activation box width (narrow rectangle on lifeline) */
  activationWidth: 10,
  /** Block padding (loop/alt borders) */
  blockPadX: 10,
  blockPadTop: 40,
  blockPadBottom: 8,
  /** Extra vertical space before the first message in a block (room for the header label) */
  blockHeaderExtra: 28,
  /** Extra vertical space before a message at a divider boundary (room for else/and label) */
  dividerExtra: 24,
  /** Note dimensions */
  noteWidth: 60,
  notePadX: 12,
  notePadY: 6,
  noteGap: 10,
  /** `box … end` group frames: horizontal padding beyond the member actor
   *  boxes, vertical band reserved above the actors for the title, and the
   *  overhang below the lifeline ends. */
  boxPadX: 8,
  boxTitleSpace: 22,
  boxPadBottom: 8,
} as const

/** Shared by layout (sizing) and renderer (drawing) — keep it single-sourced. */
export const SEQUENCE_STYLE_DEFAULTS: RenderStyleDefaults = {
  nodeLabelFontSize: FONT_SIZES.nodeLabel,
  edgeLabelFontSize: FONT_SIZES.edgeLabel,
  groupHeaderFontSize: FONT_SIZES.edgeLabel,
  nodeLabelFontWeight: FONT_WEIGHTS.nodeLabel,
  edgeLabelFontWeight: FONT_WEIGHTS.edgeLabel,
  groupHeaderFontWeight: FONT_WEIGHTS.groupHeader,
  nodePaddingX: SEQ.actorPadX,
  nodePaddingY: SEQ.notePadY,
  nodeCornerRadius: 4,
  nodeLineWidth: STROKE_WIDTHS.outerBox,
  edgeLineWidth: STROKE_WIDTHS.connector,
  groupCornerRadius: 0,
  groupPaddingX: SEQ.blockPadX,
  groupPaddingY: 8,
  groupLabelPaddingX: 6,
  groupLineWidth: STROKE_WIDTHS.outerBox,
}

/**
 * Lay out a parsed sequence diagram.
 * Returns a fully positioned diagram ready for SVG rendering.
 *
 * `config` carries the WIRED sequence runtime config keys (src/sequence/
 * config.ts, family-elevation-plan §Sequence item 6). Every knob defaults to
 * the historical SEQ constant, so an absent/empty config keeps default
 * geometry byte-identical.
 */
export function layoutSequenceDiagram(diagram: SequenceDiagram, options: RenderOptions = {}, config: ResolvedSequenceConfig = {}, styleFace?: Readonly<InternalStyleFace>): PositionedSequenceDiagram {
  const style = resolveRenderStyle(options, SEQUENCE_STYLE_DEFAULTS, styleFace)
  const padX = config.diagramMarginX ?? SEQ.padding
  const padY = config.diagramMarginY ?? SEQ.padding
  const minActorWidth = config.width ?? 80
  const noteGap = config.noteMargin ?? SEQ.noteGap
  const activationWidth = config.activationWidth ?? SEQ.activationWidth
  const actorRoleStyles = diagram.actors.map(actor => resolveRoleStyle(styleFace, 'actor', { category: actor.id }, { includeFallback: false }))
  const baseActorHeight = Math.max(config.height ?? SEQ.actorHeight, ...actorRoleStyles.map(role => measureMultilineText('Mg', role?.fontSize ?? style.nodeLabelFontSize, role?.fontWeight ?? style.nodeLabelFontWeight).height + (role?.paddingY ?? style.nodePaddingY) * 2))
  const defaultEdgeTextHeight = measureMultilineText('Mg', SEQUENCE_STYLE_DEFAULTS.edgeLabelFontSize, SEQUENCE_STYLE_DEFAULTS.edgeLabelFontWeight).height
  const edgeTextHeight = measureMultilineText('Mg', style.edgeLabelFontSize, style.edgeLabelFontWeight).height
  const baseRowHeight = config.messageMargin ?? SEQ.messageRowHeight
  const messageRowHeight = Math.max(baseRowHeight, baseRowHeight + edgeTextHeight - defaultEdgeTextHeight)
  const selfMessageHeight = Math.max(SEQ.selfMessageHeight, messageRowHeight - 10)
  const blockPadTop = Math.max(SEQ.blockPadTop, SEQ.blockPadTop + (style.groupHeaderFontSize - SEQUENCE_STYLE_DEFAULTS.groupHeaderFontSize) + (style.groupPaddingY - SEQUENCE_STYLE_DEFAULTS.groupPaddingY) * 2)
  // Adjacent fragments are positioned from message rows, so their leading
  // clearance must grow with the same role-driven group padding as their
  // frames. Keeping the historical fixed 28 here made an `opt` overlap the
  // preceding `alt` whenever a public Style selected roomy group geometry.
  const blockHeaderExtra = Math.max(SEQ.blockHeaderExtra, blockPadTop + style.groupPaddingY + 20 - messageRowHeight)
  if (diagram.actors.length === 0) {
    return {
      width: 0,
      height: 0,
      accessibilityTitle: diagram.accessibilityTitle,
      accessibilityDescription: diagram.accessibilityDescription,
      actors: [],
      lifelines: [],
      messages: [],
      activations: [],
      blocks: [],
      notes: [],
      boxes: [],
      destructions: [],
    }
  }

  // 1. Measure actor header specs and message specs
  const actorSpecs = diagram.actors.map((a, index) => measureSequenceActorSpec(a, style, actorRoleStyles[index], minActorWidth, baseActorHeight))
  const actorWidths = actorSpecs.map(spec => spec.width)

  // Build actor ID → index lookup before spacing: authored message labels and
  // self-message loops/labels are content between lifelines, so they
  // participate in the required horizontal span.
  const actorIndex = new Map<string, number>()
  for (let i = 0; i < diagram.actors.length; i++) actorIndex.set(diagram.actors[i]!.id, i)
  const messageSpecs = diagram.messages.map(message => measureSequenceMessageSpec(message, style, activationWidth))
  const messageGapRequirements = Array.from({ length: Math.max(0, diagram.actors.length - 1) }, () => 0)
  for (let mi = 0; mi < diagram.messages.length; mi++) {
    const message = diagram.messages[mi]!
    const spec = messageSpecs[mi]!
    const from = actorIndex.get(message.from)
    const to = actorIndex.get(message.to)
    if (from === undefined || to === undefined) continue
    if (from === to) {
      if (from < diagram.actors.length - 1) {
        messageGapRequirements[from] = Math.max(messageGapRequirements[from]!, spec.requiredSelfNeighborGap)
      }
      continue
    }
    const first = Math.min(from, to)
    const last = Math.max(from, to)
    const span = last - first
    const requiredPerGap = spec.requiredSpanWidth / span
    for (let gap = first; gap < last; gap++) {
      messageGapRequirements[gap] = Math.max(messageGapRequirements[gap]!, requiredPerGap)
    }
  }

  // Build actor center X positions with minimum gap. Authored actorMargin still
  // supplies the floor, while message and self-loop containment may enlarge it.
  const actorCenterX: number[] = []
  let currentX = padX + actorWidths[0]! / 2
  for (let i = 0; i < diagram.actors.length; i++) {
    if (i > 0) {
      const halfWidths = (actorWidths[i - 1]! + actorWidths[i]!) / 2
      const configuredGap = config.actorMargin !== undefined ? halfWidths + config.actorMargin : Math.max(SEQ.actorGap, halfWidths + 40)
      currentX += Math.max(configuredGap, messageGapRequirements[i - 1] ?? 0)
    }
    actorCenterX.push(currentX)
  }

  // 2. Position actors at the top. `box … end` groups draw a title band above
  //    the actor boxes, so boxed diagrams reserve extra headroom for it.
  const boxGroups = (diagram.boxes ?? []).flatMap((box, index) => {
    const memberIdxs = diagram.actors.flatMap((actor, i) => (actor.box === index ? [i] : []))
    return memberIdxs.length > 0 ? [{ box, memberIdxs }] : []
  })
  const actorY = padY + (boxGroups.length > 0 ? SEQ.boxTitleSpace + 6 : 0)
  const actors: PositionedActor[] = diagram.actors.map((a, i) => positionSequenceActor(a, actorSpecs[i]!, actorCenterX[i]!, actorY))

  // Top-row (non-created) actors determine where the message timeline begins.
  // Icon participants and multiline participants extend below `actorY + baseActorHeight`,
  // so `headerBottom` uses their complete painted header bounds.
  const topRowHeaderBottoms = diagram.actors.flatMap((a, i) => {
    if (a.createMessageIndex !== undefined && a.createMessageIndex < diagram.messages.length) return []
    const bounds = actors[i]!.bounds
    return [bounds.y + bounds.height]
  })
  const headerBottom = topRowHeaderBottoms.length > 0 ? Math.max(...topRowHeaderBottoms) : actorY + baseActorHeight

  // 3. Stack messages vertically
  let messageY = headerBottom + SEQ.headerGap
  const messages: PositionedMessage[] = []

  const blockScopes = resolveSequenceBlockScopes(diagram)
  const blockSpecs = diagram.blocks.map(block => measureSequenceBlockSpec(block, style, blockPadTop, blockHeaderExtra, SEQ.dividerExtra, edgeTextHeight))

  // Pre-scan blocks to determine which message indices need extra vertical
  // space for block headers (including stacked nested headers) or divider labels.
  const extraSpaceBefore = new Map<number, number>()
  const blocksStartingAt = new Map<number, number[]>()
  const blocksEndingAt = new Map<number, number[]>()
  for (let bi = 0; bi < diagram.blocks.length; bi++) {
    const block = diagram.blocks[bi]!
    const startList = blocksStartingAt.get(block.startIndex) ?? []
    startList.push(bi)
    blocksStartingAt.set(block.startIndex, startList)

    const endList = blocksEndingAt.get(block.endIndex) ?? []
    endList.push(bi)
    blocksEndingAt.set(block.endIndex, endList)
  }

  for (const [startIdx, blockIndices] of blocksStartingAt) {
    const innermost = blockSpecs[blockIndices[0]!]!
    const nestedStep = blockIndices.slice(1).reduce((sum, bi) => sum + blockSpecs[bi]!.enclosingHeaderStep, 0)
    const prev = extraSpaceBefore.get(startIdx) ?? 0
    extraSpaceBefore.set(startIdx, Math.max(prev, innermost.blockHeaderExtra + nestedStep))
  }

  for (let bi = 0; bi < diagram.blocks.length; bi++) {
    const spec = blockSpecs[bi]!
    const scope = blockScopes[bi]!
    for (const divSpec of spec.dividers) {
      let required = divSpec.requiredExtraBefore
      for (const ci of scope.childBlockIndices) {
        if (diagram.blocks[ci]?.startIndex === divSpec.index) {
          required += blockSpecs[ci]!.blockHeaderExtra
        }
      }
      const prevDiv = extraSpaceBefore.get(divSpec.index) ?? 0
      extraSpaceBefore.set(divSpec.index, Math.max(prevDiv, required))
    }
  }

  // Pre-scan actor lifecycles: a `create` message row hosts the created
  // actor's header box (centered on the message), so it needs half a box of
  // clearance above and the remaining header extent below; a `destroy` message
  // row ends the lifeline.
  const createAtIndex = new Map<number, number[]>()
  const destroyAtIndex = new Map<number, string[]>()
  const destroyYByActor = new Map<string, number>()
  for (let ai = 0; ai < diagram.actors.length; ai++) {
    const a = diagram.actors[ai]!
    if (a.createMessageIndex !== undefined && a.createMessageIndex < diagram.messages.length) {
      const list = createAtIndex.get(a.createMessageIndex) ?? []
      list.push(ai)
      createAtIndex.set(a.createMessageIndex, list)
      const prev = extraSpaceBefore.get(a.createMessageIndex) ?? 0
      const createdTopHalf = actors[ai]!.height / 2
      extraSpaceBefore.set(a.createMessageIndex, prev > 0 ? Math.max(prev, prev + Math.max(0, createdTopHalf - 12)) : Math.max(prev, createdTopHalf + 8))
    }
    if (a.destroyMessageIndex !== undefined && a.destroyMessageIndex < diagram.messages.length) {
      const list = destroyAtIndex.get(a.destroyMessageIndex) ?? []
      list.push(a.id)
      destroyAtIndex.set(a.destroyMessageIndex, list)
    }
  }

  // Pre-group notes by the message index they follow, along with their original
  // note index so block scope ownership stays aligned.
  const notesByAfterIndex = new Map<number, Array<{ note: (typeof diagram.notes)[number]; index: number }>>()
  for (let ni = 0; ni < diagram.notes.length; ni++) {
    const note = diagram.notes[ni]!
    const list = notesByAfterIndex.get(note.afterIndex) ?? []
    list.push({ note, index: ni })
    notesByAfterIndex.set(note.afterIndex, list)
  }
  const positionedNotes: PositionedNote[] = new Array(diagram.notes.length)

  // Track activation stack per actor: array of { startY, depth } objects
  const activationStacks = new Map<string, { startY: number; depth: number }[]>()
  const activations: Activation[] = []
  const nestingOffset = 4 // Horizontal offset per nesting level
  const activationEvents = new Map<number, NonNullable<SequenceDiagram['activationEvents']>>()
  for (const event of diagram.activationEvents ?? []) {
    const list = activationEvents.get(event.messageIndex) ?? []
    list.push(event)
    activationEvents.set(event.messageIndex, list)
  }
  const activate = (actorId: string, y: number): void => {
    const stack = activationStacks.get(actorId) ?? []
    stack.push({ startY: y, depth: stack.length })
    activationStacks.set(actorId, stack)
  }
  const deactivate = (actorId: string, y: number): void => {
    const stack = activationStacks.get(actorId)
    if (!stack || stack.length === 0) return
    const { startY, depth } = stack.pop()!
    const idx = actorIndex.get(actorId)
    if (idx === undefined || y <= startY) return
    activations.push({
      actorId,
      x: actorCenterX[idx]! - activationWidth / 2 + depth * nestingOffset,
      topY: startY,
      bottomY: y,
      width: activationWidth,
    })
  }
  const applyActivationEvents = (boundary: number, y: number): void => {
    for (const event of activationEvents.get(boundary) ?? []) {
      if (event.kind === 'activate') activate(event.actorId, y)
      else deactivate(event.actorId, y)
    }
  }

  const positionNote = (note: (typeof diagram.notes)[number], noteY: number): PositionedNote => {
    const noteText = applyTextTransform(note.text, style.nodeTextTransform)
    const noteMetrics = measureMultilineText(noteText, style.nodeLabelFontSize, style.nodeLabelFontWeight, style.nodeLetterSpacing)
    const noteW = Math.max(SEQ.noteWidth, noteMetrics.width + style.nodePaddingX * 2)
    const noteH = noteMetrics.height + style.nodePaddingY * 2
    const firstActorIdx = actorIndex.get(note.actorIds[0] ?? '') ?? 0
    let noteX: number
    if (note.position === 'left') {
      noteX = actorCenterX[firstActorIdx]! - actorWidths[firstActorIdx]! / 2 - noteW - noteGap
    } else if (note.position === 'right') {
      noteX = actorCenterX[firstActorIdx]! + actorWidths[firstActorIdx]! / 2 + noteGap
    } else if (note.actorIds.length > 1) {
      const lastActorIdx = actorIndex.get(note.actorIds[note.actorIds.length - 1] ?? '') ?? firstActorIdx
      noteX = (actorCenterX[firstActorIdx]! + actorCenterX[lastActorIdx]!) / 2 - noteW / 2
    } else {
      noteX = actorCenterX[firstActorIdx]! - noteW / 2
    }
    return {
      text: note.text,
      x: noteX,
      y: noteY,
      width: noteW,
      height: noteH,
      position: note.position,
      actors: note.actorIds,
    }
  }

  const notesBeforeFirstMsg = notesByAfterIndex.get(-1)
  if (notesBeforeFirstMsg && notesBeforeFirstMsg.length > 0) {
    // If a block opens at message 0 and owns a note before message 0, apply
    // the block's leading header space before the note so the block frame and
    // header tab clear the top actor headers.
    const openingBlocksAtZero = blocksStartingAt.get(0) ?? []
    const noteOwnedByOpeningBlock = notesBeforeFirstMsg.some(({ index }) => openingBlocksAtZero.some(bi => blockScopes[bi]!.noteIndices.includes(index)))
    if (noteOwnedByOpeningBlock) {
      messageY += extraSpaceBefore.get(0) ?? 0
      extraSpaceBefore.set(0, 0)
    }
    let noteY = messageY
    for (const { note, index } of notesBeforeFirstMsg) {
      const positioned = positionNote(note, noteY)
      positionedNotes[index] = positioned
      noteY += positioned.height + 4
    }
    messageY = Math.max(messageY, noteY + messageRowHeight / 2)
  }

  for (let msgIdx = 0; msgIdx < diagram.messages.length; msgIdx++) {
    const msg = diagram.messages[msgIdx]!
    const msgSpec = messageSpecs[msgIdx]!
    const fromIdx = actorIndex.get(msg.from) ?? 0
    const toIdx = actorIndex.get(msg.to) ?? 0
    const isSelf = msg.from === msg.to

    // Add extra vertical space if this message sits below a block header,
    // divider, or has multi-line label text above the arrow shaft.
    const extra = (extraSpaceBefore.get(msgIdx) ?? 0) + msgSpec.extraAboveHeight
    if (extra > 0) messageY += extra
    applyActivationEvents(msgIdx, messageY)

    const x1 = actorCenterX[fromIdx]!
    const x2 = actorCenterX[toIdx]!

    const positionedMsg = positionSequenceMessage(msg, msgSpec, style, x1, x2, messageY)
    messages.push(positionedMsg)

    const destroyedHere = destroyAtIndex.get(msgIdx)
    if (destroyedHere) for (const id of destroyedHere) destroyYByActor.set(id, messageY)

    if (msg.activate) activate(msg.to, messageY)
    if (msg.deactivate) deactivate(msg.from, messageY)

    const selfLoopAdvance = isSelf ? Math.max(selfMessageHeight, Math.ceil(msgSpec.labelMetrics.height) + 10) : 0
    messageY += isSelf ? selfLoopAdvance + messageRowHeight : messageRowHeight

    // Clearance below a create row for the bottom portion of the created actor's
    // header (including below-icon labels for created icon participants).
    const createdHere = createAtIndex.get(msgIdx)
    if (createdHere) {
      const createdBottomClearance = Math.max(
        ...createdHere.map(ai => {
          const actor = actors[ai]!
          return actor.bounds.height - actor.height / 2
        }),
      )
      messageY += createdBottomClearance
    }

    const closingBlocksHere = blocksEndingAt.get(msgIdx) ?? []
    const notesForMsg = notesByAfterIndex.get(msgIdx)
    if (notesForMsg && notesForMsg.length > 0) {
      let noteY = messages[msgIdx]!.y + selfLoopAdvance + 14

      for (const { note, index } of notesForMsg) {
        // If a block closed at `msgIdx` BEFORE this note (so it does not own
        // this note), keep the note below the closing block's bottom border.
        const unownedClosingCount = closingBlocksHere.filter(bi => !blockScopes[bi]!.noteIndices.includes(index)).length
        if (unownedClosingCount > 0) {
          const msgBottom = positionedMsg.bounds.y + positionedMsg.bounds.height
          const closingBorderY = Math.max(messages[msgIdx]!.y + style.groupPaddingY + 12, msgBottom + (isSelf ? style.groupPaddingY + 4 : style.groupPaddingY)) + (unownedClosingCount - 1) * style.groupPaddingY
          noteY = Math.max(noteY, closingBorderY + 8)
        }

        const positioned = positionNote(note, noteY)
        positionedNotes[index] = positioned
        noteY += positioned.height + 4
      }

      const lastNoteIndex = notesForMsg[notesForMsg.length - 1]!.index
      const owningClosingCount = closingBlocksHere.filter(bi => blockScopes[bi]!.noteIndices.includes(lastNoteIndex)).length
      const closingPad = owningClosingCount > 0 ? Math.max(0, owningClosingCount * style.groupPaddingY - 4) : 0
      messageY = Math.max(messageY, noteY + closingPad + messageRowHeight / 2)
    } else if (closingBlocksHere.length > 1) {
      messageY += (closingBlocksHere.length - 1) * style.groupPaddingY
    }
  }

  const activationTailY = Math.max(messages[messages.length - 1]?.y ?? messageY, messageY - messageRowHeight / 2)
  applyActivationEvents(diagram.messages.length, activationTailY)

  // Close any unclosed activations at the lifeline tail.
  for (const [actorId, stack] of activationStacks) {
    while (stack.length > 0) deactivate(actorId, activationTailY)
  }

  // 3b. Reposition created actors: their header box centers on the create
  //     message row instead of the diagram top (clearance was reserved during
  //     stacking). Lifelines pick the new bounds up in step 7.
  for (const [msgIdx, actorIdxs] of createAtIndex) {
    const msgY = messages[msgIdx]?.y
    if (msgY === undefined) continue
    for (const ai of actorIdxs) {
      actors[ai] = positionSequenceActor(diagram.actors[ai]!, actorSpecs[ai]!, actorCenterX[ai]!, msgY - actors[ai]!.height / 2)
    }
  }

  // 4. Position blocks (loop/alt/opt/par/critical/break/rect) inner-first so
  //    enclosing blocks contain their nested child blocks, notes, and messages.
  const notes = positionedNotes.filter((n): n is PositionedNote => n !== undefined)
  const blocks: PositionedBlock[] = []
  for (let bi = 0; bi < diagram.blocks.length; bi++) {
    blocks.push(positionSequenceBlock(diagram.blocks[bi]!, blockSpecs[bi]!, blockScopes[bi]!, diagram, actorIndex, actors, messages, positionedNotes, blocks, style, edgeTextHeight, messageY))
  }

  const maxBlockBottom = blocks.reduce((max, b) => Math.max(max, b.y + b.height), 0)
  if (maxBlockBottom > 0) {
    messageY = Math.max(messageY, maxBlockBottom + 8)
  }

  // 5b. Box group frames: span the member actors horizontally (plus padding)
  //     and run from the title band above the actor boxes to just below the
  //     lifeline ends, so the group visibly owns its lifelines.
  const lifelineBottom = messageY // lifelines end here (see step 7)
  const boxes: PositionedBoxGroup[] = boxGroups.map(({ box, memberIdxs }) => {
    const left = Math.min(...memberIdxs.map(i => actors[i]!.bounds.x)) - SEQ.boxPadX
    let right = Math.max(...memberIdxs.map(i => actors[i]!.bounds.x + actors[i]!.bounds.width)) + SEQ.boxPadX
    // A title wider than the member span widens the frame so it can't clip
    if (box.label) {
      const titleW = measureMultilineText(applyTextTransform(box.label, style.groupTextTransform), style.groupHeaderFontSize, style.groupHeaderFontWeight, style.groupLetterSpacing).width
      right = Math.max(right, left + titleW + SEQ.boxPadX * 2)
    }
    const top = padY
    return {
      label: box.label,
      color: box.color,
      x: left,
      y: top,
      width: right - left,
      height: lifelineBottom + SEQ.boxPadBottom - top,
    }
  })

  // 6. Bounding-box post-processing
  //
  // Compute the true bounding box across all positioned elements using their
  // complete painted bounds, then shift everything right if anything extends
  // left of the desired padding margin and expand the width to fit.
  const diagramBottom = messageY + padY

  let globalMinX: number = padX
  let globalMaxX = 0
  for (const a of actors) {
    const b = a.bounds
    globalMinX = Math.min(globalMinX, b.x)
    globalMaxX = Math.max(globalMaxX, b.x + b.width)
  }
  for (const b of blocks) {
    globalMinX = Math.min(globalMinX, b.x)
    globalMaxX = Math.max(globalMaxX, b.x + b.width)
  }
  for (const n of notes) {
    globalMinX = Math.min(globalMinX, n.x)
    globalMaxX = Math.max(globalMaxX, n.x + n.width)
  }
  for (const b of boxes) {
    globalMinX = Math.min(globalMinX, b.x)
    globalMaxX = Math.max(globalMaxX, b.x + b.width)
  }
  for (const act of activations) {
    globalMinX = Math.min(globalMinX, act.x)
    globalMaxX = Math.max(globalMaxX, act.x + act.width)
  }
  for (const m of messages) {
    globalMinX = Math.min(globalMinX, m.bounds.x)
    const rightSafety = m.isSelf && m.label ? 8 : 0
    globalMaxX = Math.max(globalMaxX, m.bounds.x + m.bounds.width + rightSafety)
  }

  // If elements extend left of the desired padding, shift everything right
  const shiftX = globalMinX < padX ? padX - globalMinX : 0
  if (shiftX > 0) {
    translatePositionedSequence(
      {
        actors,
        messages,
        blocks,
        notes,
        boxes,
        activations,
        lifelines: [],
        destructions: [],
      },
      shiftX,
      0,
    )
    for (let i = 0; i < actorCenterX.length; i++) actorCenterX[i]! += shiftX
  }

  // 7. Calculate final lifelines (after shift so X positions are correct).
  //    Lifelines start below the complete painted actor header bounds;
  //    destroyed actors' lifelines end at the destroy message with an X cross.
  const lifelines: Lifeline[] = diagram.actors.map((a, i) => {
    const actor = actors[i]!
    const topY = actor.bounds.y + actor.bounds.height
    return {
      actorId: a.id,
      x: actorCenterX[i]!,
      topY,
      bottomY: destroyYByActor.get(a.id) ?? diagramBottom - padY,
    }
  })
  const destructions: LifelineCross[] = diagram.actors
    .filter(a => destroyYByActor.has(a.id))
    .map(a => ({
      actorId: a.id,
      x: actorCenterX[actorIndex.get(a.id)!]!,
      y: destroyYByActor.get(a.id)!,
    }))

  // 8. Calculate diagram dimensions from the bounding box
  const diagramWidth = globalMaxX + shiftX + padX
  const diagramHeight = diagramBottom

  return withSequenceTitle(
    {
      width: Math.max(diagramWidth, 200),
      height: Math.max(diagramHeight, 100),
      accessibilityTitle: diagram.accessibilityTitle,
      accessibilityDescription: diagram.accessibilityDescription,
      actors,
      lifelines,
      messages,
      activations,
      blocks,
      notes,
      boxes,
      destructions,
    },
    diagram.title,
    style,
    padX,
    padY,
  )
}

/** The diagram's title takes a band above everything the layout placed. */
function withSequenceTitle(positioned: PositionedSequenceDiagram, title: string | undefined, style: ResolvedRenderStyle, padX: number, padY: number): PositionedSequenceDiagram {
  const band = diagramTitleBand(title, style)
  if (!band) return positioned
  const dy = band.height
  translatePositionedSequence(positioned, 0, dy)
  const width = Math.max(positioned.width, band.width + 2 * padX)
  return {
    ...positioned,
    width,
    height: positioned.height + dy,
    title: positionDiagramTitle(band, width, padY),
  }
}
