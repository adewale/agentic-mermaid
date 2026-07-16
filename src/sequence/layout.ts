import type { SequenceDiagram, PositionedSequenceDiagram, PositionedActor, Lifeline, PositionedMessage, Activation, PositionedBlock, PositionedNote, PositionedBoxGroup, LifelineCross } from './types.ts'
import { displayMessageLabel } from './parser.ts'
import type { RenderOptions } from '../types.ts'
import { applyTextTransform, estimateTextWidth, FONT_SIZES, FONT_WEIGHTS, STROKE_WIDTHS, resolveRenderStyle } from '../styles.ts'
import type { RenderStyleDefaults } from '../styles.ts'
import { measureMultilineText } from '../text-metrics.ts'
import type { ResolvedSequenceConfig } from './config.ts'
import { resolveRoleStyle, type InternalStyleFace } from '../scene/style-registry.ts'

// ============================================================================
// Sequence diagram layout engine
//
// Custom timeline-based layout (no ELK — sequence diagrams aren't graphs).
//
// Layout strategy:
//   1. Space actors horizontally based on label widths + min gap
//   2. Stack messages vertically in chronological order
//   3. Track activation boxes via a stack
//   4. Position blocks (loop/alt/opt) as background rectangles
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
export function layoutSequenceDiagram(
  diagram: SequenceDiagram,
  options: RenderOptions = {},
  config: ResolvedSequenceConfig = {},
  styleFace?: Readonly<InternalStyleFace>,
): PositionedSequenceDiagram {
  const style = resolveRenderStyle(options, SEQUENCE_STYLE_DEFAULTS, styleFace)
  const padX = config.diagramMarginX ?? SEQ.padding
  const padY = config.diagramMarginY ?? SEQ.padding
  const minActorWidth = config.width ?? 80
  const noteGap = config.noteMargin ?? SEQ.noteGap
  const activationWidth = config.activationWidth ?? SEQ.activationWidth
  const actorRoleStyles = diagram.actors.map(actor => resolveRoleStyle(styleFace, 'actor', { category: actor.id }, { includeFallback: false }))
  const actorHeight = Math.max(
    config.height ?? SEQ.actorHeight,
    ...actorRoleStyles.map(role => measureMultilineText(
      'Mg',
      role?.fontSize ?? style.nodeLabelFontSize,
      role?.fontWeight ?? style.nodeLabelFontWeight,
    ).height + (role?.paddingY ?? style.nodePaddingY) * 2),
  )
  const defaultEdgeTextHeight = measureMultilineText('Mg', SEQUENCE_STYLE_DEFAULTS.edgeLabelFontSize, SEQUENCE_STYLE_DEFAULTS.edgeLabelFontWeight).height
  const edgeTextHeight = measureMultilineText('Mg', style.edgeLabelFontSize, style.edgeLabelFontWeight).height
  const baseRowHeight = config.messageMargin ?? SEQ.messageRowHeight
  const messageRowHeight = Math.max(baseRowHeight, baseRowHeight + edgeTextHeight - defaultEdgeTextHeight)
  const selfMessageHeight = Math.max(SEQ.selfMessageHeight, messageRowHeight - 10)
  const blockPadTop = Math.max(
    SEQ.blockPadTop,
    SEQ.blockPadTop
      + (style.groupHeaderFontSize - SEQUENCE_STYLE_DEFAULTS.groupHeaderFontSize)
      + (style.groupPaddingY - SEQUENCE_STYLE_DEFAULTS.groupPaddingY) * 2,
  )
  // Adjacent fragments are positioned from message rows, so their leading
  // clearance must grow with the same role-driven group padding as their
  // frames. Keeping the historical fixed 28 here made an `opt` overlap the
  // preceding `alt` whenever a public Style selected roomy group geometry.
  const blockHeaderExtra = Math.max(
    SEQ.blockHeaderExtra,
    blockPadTop + style.groupPaddingY + 20 - messageRowHeight,
  )
  if (diagram.actors.length === 0) {
    return { width: 0, height: 0, accessibilityTitle: diagram.accessibilityTitle, accessibilityDescription: diagram.accessibilityDescription, actors: [], lifelines: [], messages: [], activations: [], blocks: [], notes: [], boxes: [], destructions: [] }
  }

  // 1. Calculate actor widths and assign horizontal positions (center X)
  const actorWidths = diagram.actors.map((a, index) => {
    const role = actorRoleStyles[index]
    const transform = role?.textTransform ?? style.nodeTextTransform
    const fontSize = role?.fontSize ?? style.nodeLabelFontSize
    const fontWeight = role?.fontWeight ?? style.nodeLabelFontWeight
    const paddingX = role?.paddingX ?? style.nodePaddingX
    const displayLabel = applyTextTransform(a.label, transform)
    const letterSpacing = role?.letterSpacing ?? style.nodeLetterSpacing
    const tracking = Math.max(0, [...displayLabel].length - 1) * letterSpacing
    const textW = estimateTextWidth(displayLabel, fontSize, fontWeight) + tracking
    return Math.max(textW + paddingX * 2, minActorWidth)
  })

  // Build actor ID → index lookup before spacing: authored message labels are
  // content between lifelines, so they participate in the required span.
  const actorIndex = new Map<string, number>()
  for (let i = 0; i < diagram.actors.length; i++) actorIndex.set(diagram.actors[i]!.id, i)
  const messageGapRequirements = Array.from({ length: Math.max(0, diagram.actors.length - 1) }, () => 0)
  for (const message of diagram.messages) {
    const from = actorIndex.get(message.from)
    const to = actorIndex.get(message.to)
    if (from === undefined || to === undefined || from === to) continue
    const first = Math.min(from, to)
    const last = Math.max(from, to)
    const span = last - first
    const label = applyTextTransform(displayMessageLabel(message), style.edgeTextTransform)
    const tracking = Math.max(0, [...label].length - 1) * style.edgeLetterSpacing
    const requiredPerGap = (estimateTextWidth(label, style.edgeLabelFontSize, style.edgeLabelFontWeight) + tracking + 16) / span
    for (let gap = first; gap < last; gap++) {
      messageGapRequirements[gap] = Math.max(messageGapRequirements[gap]!, requiredPerGap)
    }
  }

  // Build actor center X positions with minimum gap. Authored actorMargin still
  // supplies the floor, while message containment may enlarge it.
  const actorCenterX: number[] = []
  let currentX = padX + actorWidths[0]! / 2
  for (let i = 0; i < diagram.actors.length; i++) {
    if (i > 0) {
      const halfWidths = (actorWidths[i - 1]! + actorWidths[i]!) / 2
      const configuredGap = config.actorMargin !== undefined
        ? halfWidths + config.actorMargin
        : Math.max(SEQ.actorGap, halfWidths + 40)
      currentX += Math.max(configuredGap, messageGapRequirements[i - 1] ?? 0)
    }
    actorCenterX.push(currentX)
  }

  // 2. Position actors at the top. `box … end` groups draw a title band above
  //    the actor boxes, so boxed diagrams reserve extra headroom for it.
  const boxGroups = (diagram.boxes ?? []).filter(b => b.actorIds.some(id => actorIndex.has(id)))
  const actorY = padY + (boxGroups.length > 0 ? SEQ.boxTitleSpace + 6 : 0)
  const actors: PositionedActor[] = diagram.actors.map((a, i) => ({
    id: a.id,
    label: a.label,
    type: a.type,
    ...(a.links ? { links: { ...a.links } } : {}),
    x: actorCenterX[i]!,
    y: actorY,
    width: actorWidths[i]!,
    height: actorHeight,
  }))

  // 3. Stack messages vertically
  let messageY = actorY + actorHeight + SEQ.headerGap
  const messages: PositionedMessage[] = []

  // Pre-scan blocks to determine which message indices need extra vertical
  // space for block headers (e.g. "alt [Valid credentials]") or divider
  // labels (e.g. "[else Invalid]"). Without this, messages inside blocks
  // overlap with the header/divider text that sits above them.
  const extraSpaceBefore = new Map<number, number>()
  for (const block of diagram.blocks) {
    // First message in the block needs room for the block header label
    const prev = extraSpaceBefore.get(block.startIndex) ?? 0
    extraSpaceBefore.set(block.startIndex, Math.max(prev, blockHeaderExtra))

    // Each divider (else/and) needs room for the divider label
    for (const div of block.dividers) {
      const prevDiv = extraSpaceBefore.get(div.index) ?? 0
      extraSpaceBefore.set(div.index, Math.max(prevDiv, SEQ.dividerExtra))
    }
  }

  // Pre-scan actor lifecycles: a `create` message row hosts the created
  // actor's header box (centered on the message), so it needs half a box of
  // clearance above and below; a `destroy` message row ends the lifeline.
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
      extraSpaceBefore.set(a.createMessageIndex, Math.max(prev, actorHeight / 2 + 8))
    }
    if (a.destroyMessageIndex !== undefined && a.destroyMessageIndex < diagram.messages.length) {
      const list = destroyAtIndex.get(a.destroyMessageIndex) ?? []
      list.push(a.id)
      destroyAtIndex.set(a.destroyMessageIndex, list)
    }
  }

  // Pre-group notes by the message index they follow, so we can position
  // them inline during the message stacking loop (avoids overlap bugs).
  const notesByAfterIndex = new Map<number, typeof diagram.notes>()
  for (const note of diagram.notes) {
    const list = notesByAfterIndex.get(note.afterIndex) ?? []
    list.push(note)
    notesByAfterIndex.set(note.afterIndex, list)
  }
  const positionedNotes: PositionedNote[] = []

  // Track activation stack per actor: array of { startY, depth } objects
  // Depth is used to offset nested activations horizontally for visual clarity
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

  const positionNote = (note: typeof diagram.notes[number], noteY: number): PositionedNote => {
    const noteText = applyTextTransform(note.text, style.nodeTextTransform)
    const noteW = Math.max(
      SEQ.noteWidth,
      estimateTextWidth(noteText, style.nodeLabelFontSize, style.nodeLabelFontWeight) + style.nodePaddingX * 2
    )
    const noteH = measureMultilineText(noteText, style.nodeLabelFontSize, style.nodeLabelFontWeight).height + style.nodePaddingY * 2
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
    let noteY = messageY
    for (const note of notesBeforeFirstMsg) {
      const positioned = positionNote(note, noteY)
      positionedNotes.push(positioned)
      noteY += positioned.height + 4
    }
    messageY = Math.max(messageY, noteY + messageRowHeight / 2)
  }

  for (let msgIdx = 0; msgIdx < diagram.messages.length; msgIdx++) {
    const msg = diagram.messages[msgIdx]!
    const fromIdx = actorIndex.get(msg.from) ?? 0
    const toIdx = actorIndex.get(msg.to) ?? 0
    const isSelf = msg.from === msg.to

    // Add extra vertical space if this message sits below a block header or divider
    const extra = extraSpaceBefore.get(msgIdx) ?? 0
    if (extra > 0) messageY += extra
    applyActivationEvents(msgIdx, messageY)

    const x1 = actorCenterX[fromIdx]!
    const x2 = actorCenterX[toIdx]!

    messages.push({
      from: msg.from,
      to: msg.to,
      label: displayMessageLabel(msg), // autonumber prefix baked in ("1. label")
      lineStyle: msg.lineStyle,
      startHead: msg.startHead,
      endHead: msg.endHead,
      centralStart: msg.centralStart ?? false,
      centralEnd: msg.centralEnd ?? false,
      x1, x2,
      y: messageY,
      isSelf,
    })

    // Lifecycle bookkeeping: created actors' header boxes sit ON this row
    // (repositioned after the loop, clearance reserved via extraSpaceBefore
    // above and the extra advance below); destroyed lifelines end here.
    const destroyedHere = destroyAtIndex.get(msgIdx)
    if (destroyedHere) for (const id of destroyedHere) destroyYByActor.set(id, messageY)

    // Message +/- markers and standalone commands share one stack machine.
    if (msg.activate) activate(msg.to, messageY)
    if (msg.deactivate) deactivate(msg.from, messageY)

    // Advance messageY past the message itself
    messageY += isSelf ? selfMessageHeight + messageRowHeight : messageRowHeight
    // Clearance below a create row for the bottom half of the created actor's box
    if (createAtIndex.has(msgIdx)) messageY += actorHeight / 2

    // Position notes that appear after this message.
    // Notes start below the self-message loop (if self) or below the arrow,
    // and consecutive notes stack vertically. If notes extend beyond the
    // normal message advance, push messageY further so subsequent messages
    // don't overlap.
    const notesForMsg = notesByAfterIndex.get(msgIdx)
    if (notesForMsg && notesForMsg.length > 0) {
      // Self-message loops extend selfMessageHeight below msg.y;
      // normal arrows sit at msg.y with no extension below.
      const selfLoopExtra = isSelf ? selfMessageHeight : 0
      // Keep the note frame clear of a preceding multiline message-label pill;
      // the pill extends below the arrow even though its text baseline is above.
      let noteY = messages[msgIdx]!.y + selfLoopExtra + 14

      for (const note of notesForMsg) {
        const positioned = positionNote(note, noteY)
        positionedNotes.push(positioned)
        noteY += positioned.height + 4 // Stack next note below with gap
      }

      // Push messageY forward if notes extended beyond the normal advance.
      // Add half a row height so the next message's label (rendered at msg.y - 6)
      // has clearance from the last note's bottom edge.
      messageY = Math.max(messageY, noteY + messageRowHeight / 2)
    }
  }

  const activationTailY = Math.max(
    messages[messages.length - 1]?.y ?? messageY,
    messageY - messageRowHeight / 2,
  )
  applyActivationEvents(diagram.messages.length, activationTailY)

  // Close any unclosed activations at the lifeline tail.
  for (const [actorId, stack] of activationStacks) {
    while (stack.length > 0) deactivate(actorId, activationTailY)
  }

  // 3b. Reposition created actors: their header box centers on the create
  //     message row instead of the diagram top (clearance was reserved during
  //     stacking). Lifelines pick the new top up in step 7.
  for (const [msgIdx, actorIdxs] of createAtIndex) {
    const msgY = messages[msgIdx]?.y
    if (msgY === undefined) continue
    for (const ai of actorIdxs) {
      actors[ai]!.y = msgY - actorHeight / 2
    }
  }

  // 4. Position blocks (loop/alt/opt)
  const blocks: PositionedBlock[] = diagram.blocks.map(block => {
    // Block spans from the Y of startIndex to endIndex messages
    const startMsg = messages[block.startIndex]
    const endMsg = messages[block.endIndex]
    const blockTop = (startMsg?.y ?? messageY) - blockPadTop
    const blockBottom = (endMsg?.y ?? messageY) + style.groupPaddingY + 12

    // Block width spans all actors involved in its messages
    const involvedActors = new Set<number>()
    for (let mi = block.startIndex; mi <= block.endIndex; mi++) {
      const m = diagram.messages[mi]
      if (m) {
        involvedActors.add(actorIndex.get(m.from) ?? 0)
        involvedActors.add(actorIndex.get(m.to) ?? 0)
      }
    }
    // Fallback: span all actors if none involved
    if (involvedActors.size === 0) {
      for (let ai = 0; ai < diagram.actors.length; ai++) involvedActors.add(ai)
    }
    const minIdx = Math.min(...involvedActors)
    const maxIdx = Math.max(...involvedActors)
    const blockLeft = actorCenterX[minIdx]! - actorWidths[minIdx]! / 2 - style.groupPaddingX
    const blockRight = actorCenterX[maxIdx]! + actorWidths[maxIdx]! / 2 + style.groupPaddingX

    // Position dividers — offset from message Y so the divider label text
    // (rendered at divider.y + 14 in the renderer) clears the message label
    // (rendered at msg.y - 6).
    //
    // Default offset 28 gives ~8px baseline clearance, which is sufficient
    // when the divider label (left-aligned at block edge) and message label
    // (centered between actors) don't share horizontal space. When they DO
    // overlap horizontally (e.g. long divider labels like "[Account locked]"
    // next to centered message labels like "403 Forbidden"), we increase the
    // offset to 36 so text bounding boxes have ~5px visual clearance.
    const dividers = block.dividers.map(d => {
      const msg = messages[d.index]
      const msgY = msg?.y ?? messageY
      let offset = 28

      // Dynamic overlap detection: increase offset when the divider label
      // and message label occupy the same horizontal region, which would
      // cause vertical text overlap at the default 8px baseline gap.
      if (d.label && msg?.label) {
        const divLabelText = applyTextTransform(`[${d.label}]`, style.edgeTextTransform)
        const divLabelW = estimateTextWidth(divLabelText, style.edgeLabelFontSize, style.edgeLabelFontWeight)
        const divLabelLeft = blockLeft + 8
        const divLabelRight = divLabelLeft + divLabelW

        const msgLabelW = estimateTextWidth(applyTextTransform(msg.label, style.edgeTextTransform), style.edgeLabelFontSize, style.edgeLabelFontWeight)
        // Self-messages render labels at x1 + 36 (left-aligned); normal
        // messages center the label between the two actor lifelines.
        const msgLabelLeft = msg.isSelf
          ? msg.x1 + 36
          : (msg.x1 + msg.x2) / 2 - msgLabelW / 2
        const msgLabelRight = msgLabelLeft + msgLabelW

        const horizontalClearance = 8
        if (divLabelRight + horizontalClearance > msgLabelLeft
          && divLabelLeft - horizontalClearance < msgLabelRight) {
          // Divider labels render at divider.y + 14 while message labels render
          // at msg.y - 10. Reserve one resolved text line, not a fixed 12px,
          // after accounting for that 24px baseline offset.
          offset = Math.max(36, Math.ceil(24 + edgeTextHeight))
        }
      }

      return { y: msgY - offset, label: d.label }
    })

    return {
      type: block.type,
      label: block.label,
      x: blockLeft,
      y: blockTop,
      width: blockRight - blockLeft,
      height: blockBottom - blockTop,
      dividers,
    }
  })

  // 5. Notes — already positioned inline during the message stacking loop
  //    (step 3) to properly account for self-message loops and vertical stacking.
  const notes = positionedNotes

  // 5b. Box group frames: span the member actors horizontally (plus padding)
  //     and run from the title band above the actor boxes to just below the
  //     lifeline ends, so the group visibly owns its lifelines.
  const lifelineBottom = messageY // lifelines end here (see step 7)
  const boxes: PositionedBoxGroup[] = boxGroups.map(box => {
    const memberIdxs = box.actorIds
      .map(id => actorIndex.get(id))
      .filter((i): i is number => i !== undefined)
    const left = Math.min(...memberIdxs.map(i => actorCenterX[i]! - actorWidths[i]! / 2)) - SEQ.boxPadX
    let right = Math.max(...memberIdxs.map(i => actorCenterX[i]! + actorWidths[i]! / 2)) + SEQ.boxPadX
    // A title wider than the member span widens the frame so it can't clip
    if (box.label) {
      const titleW = estimateTextWidth(applyTextTransform(box.label, style.groupTextTransform), style.groupHeaderFontSize, style.groupHeaderFontWeight)
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
  // Notes positioned "left of" the first actor or "right of" the last actor
  // can extend beyond the actor-based viewport. Compute the true bounding box
  // across all positioned elements, then shift everything right if anything
  // extends left of the desired padding margin and expand the width to fit.
  const diagramBottom = messageY + padY

  // Find global X extents across actors, blocks, notes, and message labels
  let globalMinX: number = padX // actors already start at padX
  let globalMaxX = 0
  for (const a of actors) {
    globalMinX = Math.min(globalMinX, a.x - a.width / 2)
    globalMaxX = Math.max(globalMaxX, a.x + a.width / 2)
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
  // Include self-message labels in bounding box — they extend to the right of the actor
  // and could be clipped if not accounted for in the SVG width
  for (const m of messages) {
    if (m.isSelf && m.label) {
      const loopW = 30 // matches renderer loopW
      const labelPadding = 8
      const labelLeft = m.x1 + loopW + labelPadding
      const labelWidth = estimateTextWidth(applyTextTransform(m.label, style.edgeTextTransform), style.edgeLabelFontSize, style.edgeLabelFontWeight)
      globalMaxX = Math.max(globalMaxX, labelLeft + labelWidth + 8) // +8 for safety margin
    }
  }

  // If elements extend left of the desired padding, shift everything right
  const shiftX = globalMinX < padX ? padX - globalMinX : 0
  if (shiftX > 0) {
    for (const a of actors) a.x += shiftX
    for (const m of messages) { m.x1 += shiftX; m.x2 += shiftX }
    for (const act of activations) act.x += shiftX
    for (const b of blocks) { b.x += shiftX; }
    for (const n of notes) n.x += shiftX
    for (const b of boxes) b.x += shiftX
    // Also shift actor center X array (used for lifelines below)
    for (let i = 0; i < actorCenterX.length; i++) actorCenterX[i]! += shiftX
  }

  // 7. Calculate final lifelines (after shift so X positions are correct).
  //    Created actors' lifelines start below their repositioned header box;
  //    destroyed actors' lifelines end at the destroy message with an X cross.
  const lifelines: Lifeline[] = diagram.actors.map((a, i) => ({
    actorId: a.id,
    x: actorCenterX[i]!,
    topY: actors[i]!.y + actorHeight,
    bottomY: destroyYByActor.get(a.id) ?? (diagramBottom - padY),
  }))
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

  return {
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
  }
}
