import { preparePixelText } from '../shared/prepared-text.ts'
import { resolveLabelContent, type DisplayTextInput } from '../shared/display-text.ts'
import type { SequenceBounds, SequenceDiagram, PositionedSequenceDiagram, PositionedActor, Lifeline, PositionedMessage, Activation, PositionedBlock, PositionedNote, PositionedBoxGroup, LifelineCross } from './types.ts'
import { SEQUENCE_SELF_LOOP, measureSequenceActorSpec, measureSequenceBlockSpec, measureSequenceMessageSpec, positionSequenceActor, positionSequenceBlock, positionSequenceMessage, resolveSequenceBlockScopes, sequenceDividerLeadingNote, translatePositionedSequence, type SequenceBlockPlacement } from './geometry.ts'
import { getSequenceBlockBoundaries } from './parser.ts'
import { SEQUENCE_TEXT_WRAP_WIDTH } from './geometry.ts'
import type { RenderOptions } from '../types.ts'
import { FONT_SIZES, FONT_WEIGHTS, STROKE_WIDTHS, resolveRenderStyle, diagramTitleBand, positionDiagramTitle, titleOnlyCanvas } from '../styles.ts'
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
    return withSequenceTitle({
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
    }, diagram.title === undefined ? undefined : resolveLabelContent(diagram.title, diagram.titleContent), style, padX, padY)
  }

  // 1. Measure actor header specs and message specs
  const actorSpecs = diagram.actors.map((a, index) => measureSequenceActorSpec(a.wrap === undefined && config.wrap !== undefined ? { ...a, wrap: config.wrap } : a, style, actorRoleStyles[index], minActorWidth, baseActorHeight))
  const actorWidths = actorSpecs.map(spec => spec.width)

  // Build actor ID → index lookup before spacing: authored message labels and
  // self-message loops/labels are content between lifelines, so they
  // participate in the required horizontal span.
  const actorIndex = new Map<string, number>()
  for (let i = 0; i < diagram.actors.length; i++) actorIndex.set(diagram.actors[i]!.id, i)
  const messageSpecs = diagram.messages.map(message => measureSequenceMessageSpec(message.wrap === undefined && config.wrap !== undefined ? { ...message, wrap: config.wrap } : message, style, activationWidth))
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
    const createdHeaderWidth = diagram.actors[to]!.createMessageIndex === mi && diagram.actors[to]!.type === 'participant' ? actorWidths[to]! / 2 : 0
    const requiredPerGap = (spec.requiredSpanWidth + createdHeaderWidth) / span
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
    const block = box.label ? preparePixelText(resolveLabelContent(box.label, box.labelContent), { transform: style.groupTextTransform, fontSize: style.groupHeaderFontSize, fontWeight: style.groupHeaderFontWeight, letterSpacing: style.groupLetterSpacing, fontFamily: style.groupFont, ...((box.wrap ?? config.wrap) ? { maxWidth: SEQUENCE_TEXT_WRAP_WIDTH } : {}) }) : undefined
    return memberIdxs.length > 0 ? [{ box, memberIdxs, block }] : []
  })
  const boxTitleHeight = Math.max(SEQ.boxTitleSpace, ...boxGroups.map(group => (group.block?.height ?? 0) + 8))
  const actorY = padY + (boxGroups.length > 0 ? boxTitleHeight + 6 : 0)
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
  const blockSpecs = diagram.blocks.map(block => measureSequenceBlockSpec({ ...block, wrap: block.wrap ?? config.wrap, dividers: block.dividers.map(divider => ({ ...divider, wrap: divider.wrap ?? config.wrap })) }, style, blockPadTop, blockHeaderExtra, SEQ.dividerExtra, edgeTextHeight))
  const boundaries = getSequenceBlockBoundaries(diagram)

  // Pre-scan blocks to determine which message indices need extra vertical
  // space for block headers (including stacked nested headers) or divider labels.
  const extraSpaceBefore = new Map<number, number>()
  const blocksStartingAt = new Map<number, number[]>()
  const blocksStartingAtNote = new Map<number, number[]>()
  const parentBlock = new Map<number, number>()
  const dividersStartingAtNote = new Map<number, number>()
  for (let bi = 0; bi < diagram.blocks.length; bi++) {
    const block = diagram.blocks[bi]!
    const startList = blocksStartingAt.get(block.startIndex) ?? []
    startList.push(bi)
    blocksStartingAt.set(block.startIndex, startList)
    const scope = blockScopes[bi]!
    const firstNote = scope.noteIndices[0]
    if (firstNote !== undefined) {
      const noteList = blocksStartingAtNote.get(firstNote) ?? []
      noteList.push(bi)
      blocksStartingAtNote.set(firstNote, noteList)
    }
    for (const ci of scope.childBlockIndices) parentBlock.set(ci, bi)

  }

  const openedBlocks = new Set<number>()
  const anchoredSections = new Set<number>()
  if (boundaries) {
    const openingNoteIndices = new Map(boundaries.filter(boundary => boundary.kind === 'open').map(boundary => [boundary.blockIndex, boundary.noteIndex]))
    for (let bi = 0; bi < diagram.blocks.length; bi++) {
      const block = diagram.blocks[bi]!
      const scope = blockScopes[bi]!
      const childSections = new Set(scope.childSectionIndices)
      let messageStart = block.startIndex
      let noteStart = openingNoteIndices.get(bi)!
      for (let section = 0; section <= block.dividers.length; section++) {
        const messageEnd = block.dividers[section]?.index ?? scope.endMessageExclusive
        const noteEnd = scope.dividerNoteIndices[section] ?? scope.endNoteExclusive
        if (messageStart === messageEnd && noteStart === noteEnd && !childSections.has(section)) anchoredSections.add(bi)
        messageStart = messageEnd
        noteStart = noteEnd
      }
      if (scope.childBlockIndices.some(ci => diagram.blocks[ci]!.startIndex === blockScopes[ci]!.endMessageExclusive && blockScopes[ci]!.noteIndices.length === 0)) anchoredSections.add(bi)
    }
    // A child's reserved header also needs a real boundary for its enclosing
    // section; otherwise the parent could pull its divider above earlier work.
    // Children precede parents, so one pass propagates through every ancestor.
    for (let bi = 0; bi < diagram.blocks.length; bi++) {
      const parent = parentBlock.get(bi)
      if (anchoredSections.has(bi) && parent !== undefined) anchoredSections.add(parent)
    }
  }
  const openingBlocks = (messageIndex: number): number[] => (blocksStartingAt.get(messageIndex) ?? [])
    .filter(bi => !openedBlocks.has(bi) && blockScopes[bi]!.endMessageExclusive > messageIndex)
  const headerSpace = (indices: readonly number[]): number => indices.length === 0 ? 0
    : blockSpecs[indices[0]!]!.blockHeaderExtra + indices.slice(1).reduce((sum, bi) => sum + blockSpecs[bi]!.enclosingHeaderStep, 0)

  for (let bi = 0; bi < diagram.blocks.length; bi++) {
    if (anchoredSections.has(bi) || diagram.blocks[bi]!.type === 'par_over') continue
    const spec = blockSpecs[bi]!
    const scope = blockScopes[bi]!
    for (const [di, divSpec] of spec.dividers.entries()) {
      const leadingNote = sequenceDividerLeadingNote(diagram.blocks[bi]!, scope, diagram, di)
      if (leadingNote !== undefined) {
        dividersStartingAtNote.set(leadingNote, Math.max(dividersStartingAtNote.get(leadingNote) ?? 0, divSpec.noteContentOffset))
        continue
      }
      if (divSpec.index >= scope.endMessageExclusive) continue
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
    const block = preparePixelText(resolveLabelContent(note.text, note.textContent), { transform: style.nodeTextTransform, fontSize: style.nodeLabelFontSize, fontWeight: style.nodeLabelFontWeight, letterSpacing: style.nodeLetterSpacing, ...((note.wrap ?? config.wrap) ? { maxWidth: SEQUENCE_TEXT_WRAP_WIDTH } : {}) })
    const noteMetrics = block
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
      block,
      x: noteX,
      y: noteY,
      width: noteW,
      height: noteH,
      position: note.position,
      actors: note.actorIds,
    }
  }

  // Complete a fragment as soon as its lexical content has been positioned.
  // The timeline and renderer consume this same geometry; neither predicts a
  // closing border from message counts or a fixed amount of note padding.
  const blocks: PositionedBlock[] = new Array(diagram.blocks.length)
  const placements: SequenceBlockPlacement[] = []
  let completedBottom = Number.NEGATIVE_INFINITY
  let contentBottom = headerBottom
  let reservedBottom = Number.NEGATIVE_INFINITY
  let nextNoteIndex = 0
  let nextBlockIndex = 0
  let nextBoundaryIndex = 0
  let overlayEpoch = 0
  // Each overlay branch starts at one shared timeline origin. Finished
  // branches retain their ink as obstacles and join at their greatest extent.
  const overlays = new Map<number, {
    messageY: number; contentBottom: number; completedBottom: number; reservedBottom: number
    bottom: number; messageEnd: number; noteEnd: number; priorChildren: number[]
  }>()
  const overlayClearance = (bounds: SequenceBounds, messageIndex?: number, noteIndex?: number): number => {
    let shift = 0
    const obstacles: SequenceBounds[] = []
    for (const [bi, state] of overlays) {
      const block = diagram.blocks[bi]!
      for (let i = block.startIndex; i < state.messageEnd; i++) if (messages[i]) obstacles.push(messages[i]!.bounds)
      for (const i of blockScopes[bi]!.noteIndices) if (i < state.noteEnd && positionedNotes[i]) obstacles.push(positionedNotes[i]!)
      for (const i of state.priorChildren) if (blocks[i]) obstacles.push(blocks[i]!)
      for (const [di, divider] of block.dividers.entries()) {
        const spec = blockSpecs[bi]!.dividers[di]!
        if (!divider.label) continue
        const leading = sequenceDividerLeadingNote(block, blockScopes[bi]!, diagram, di)
        const priorContent = leading !== undefined && leading < state.noteEnd ? positionedNotes[leading]
          : leading === undefined && divider.index < state.messageEnd ? messages[divider.index]?.bounds : undefined
        if (priorContent) obstacles.push({ x: priorContent.x, y: priorContent.y - spec.metrics.height - 8, width: spec.metrics.width, height: spec.metrics.height })
        if ((leading === undefined && messageIndex === divider.index) || (leading !== undefined && noteIndex === leading)) {
          const height = spec.metrics.height + 8
          bounds = { x: bounds.x, y: bounds.y - height, width: Math.max(bounds.width, spec.metrics.width), height: bounds.height + height }
        }
      }
    }
    // Each move passes the bottom of at least one finite obstacle.
    for (let pass = 0; pass <= obstacles.length; pass++) {
      const hit = obstacles.find(other => bounds.x < other.x + other.width + 8 && bounds.x + bounds.width + 8 > other.x
        && bounds.y + shift < other.y + other.height + 8 && bounds.y + bounds.height + shift + 8 > other.y)
      if (!hit) break
      shift = hit.y + hit.height + 8 - bounds.y
    }
    return shift
  }
  const reserveFrame = (bi: number): void => {
    const ancestors: number[] = []
    for (let current: number | undefined = bi; current !== undefined && !openedBlocks.has(current); current = parentBlock.get(current)) ancestors.push(current)
    for (let i = ancestors.length - 1; i >= 0; i--) {
      const current = ancestors[i]!
      const top = Math.max(contentBottom, completedBottom, reservedBottom) + 8
      placements[current] = { top, dividerY: [] }
      openedBlocks.add(current)
      contentBottom = reservedBottom = top + blockSpecs[current]!.enclosingHeaderStep
    }
  }
  const completeBlock = (bi: number): void => {
    const block = diagram.blocks[bi]!
    const scope = blockScopes[bi]!
    const top = placements[bi]?.top
    const anchorY = top !== undefined && block.startIndex === scope.endMessageExclusive && scope.noteIndices.length === 0
      ? top + blockSpecs[bi]!.blockPadTop
      : positionedNotes[scope.noteIndices[0] ?? -1]?.y ?? messageY
    openedBlocks.add(bi)
    const positioned = positionSequenceBlock(block, blockSpecs[bi]!, scope, diagram, actorIndex, actors, messages, positionedNotes, blocks, style, edgeTextHeight, anchorY, placements[bi])
    blocks[bi] = positioned
    completedBottom = Math.max(completedBottom, positioned.y + positioned.height)
    const overlay = overlays.get(bi)
    if (overlay) {
      contentBottom = Math.max(contentBottom, overlay.bottom, completedBottom)
      messageY = Math.max(messageY, contentBottom + messageRowHeight / 2)
      overlays.delete(bi)
    }
  }
  const completeBlocks = (): void => {
    // Consume source boundaries in lexical order. Message/note cursors alone
    // cannot distinguish several empty siblings or sections at one boundary.
    if (boundaries) {
      while (nextBoundaryIndex < boundaries.length) {
        const boundary = boundaries[nextBoundaryIndex]!
        if (boundary.messageIndex > messages.length || boundary.noteIndex > nextNoteIndex) break
        const bi = boundary.blockIndex
        if (boundary.kind === 'open' && anchoredSections.has(bi)) reserveFrame(bi)
        if (boundary.kind === 'open' && diagram.blocks[bi]!.type === 'par_over') {
          reserveFrame(bi)
          const branchHeaderSpace = Math.max(0, ...blockSpecs[bi]!.dividers.map(divider => divider.noteContentOffset))
          reservedBottom += branchHeaderSpace
          contentBottom = reservedBottom
          messageY = Math.max(messageY, reservedBottom + messageRowHeight / 2)
          overlays.set(bi, { messageY, contentBottom, completedBottom, reservedBottom, bottom: contentBottom,
            messageEnd: diagram.blocks[bi]!.startIndex, noteEnd: boundary.noteIndex, priorChildren: [] })
          overlayEpoch++
        }
        if (boundary.kind === 'divider') {
          const overlay = overlays.get(bi)
          if (overlay) {
            overlay.bottom = Math.max(overlay.bottom, contentBottom, completedBottom, reservedBottom)
            overlay.messageEnd = boundary.messageIndex
            overlay.noteEnd = boundary.noteIndex
            overlay.priorChildren = blockScopes[bi]!.childBlockIndices.filter(index => blocks[index])
            ;({ messageY, contentBottom, completedBottom, reservedBottom } = overlay)
            overlayEpoch++
            nextBoundaryIndex++
            continue
          }
          const divSpec = blockSpecs[bi]!.dividers[boundary.dividerIndex!]!
          const y = Math.max(contentBottom, completedBottom, reservedBottom) + 8
          if (anchoredSections.has(bi)) {
            placements[bi]!.dividerY[boundary.dividerIndex!] = y
            contentBottom = reservedBottom = y + divSpec.noteContentOffset
          } else {
            // Even a message-bearing section follows the complete painted
            // content of its predecessor, including completed child frames.
            reservedBottom = y + divSpec.noteContentOffset
          }
        }
        if (boundary.kind === 'close') completeBlock(bi)
        nextBoundaryIndex++
      }
      return
    }
    // Structural diagram literals have no lexical side data; their inclusive
    // message intervals remain the best available completion boundary.
    while (nextBlockIndex < diagram.blocks.length) {
      const bi = nextBlockIndex
      const scope = blockScopes[bi]!
      if (scope.endMessageExclusive > messages.length || scope.endNoteExclusive > nextNoteIndex) break
      completeBlock(bi)
      nextBlockIndex++
    }
  }
  const placeNotes = (afterIndex: number, initialY: number): void => {
    let noteY = initialY
    for (const { note, index } of notesByAfterIndex.get(afterIndex) ?? []) {
      const epoch = overlayEpoch
      completeBlocks()
      if (epoch !== overlayEpoch) noteY = messageY
      noteY = Math.max(noteY, completedBottom + 8, reservedBottom)
      for (const bi of blocksStartingAtNote.get(index) ?? []) {
        const top = placements[bi]?.top
        if (top !== undefined) noteY = Math.max(noteY, top + blockSpecs[bi]!.contentTopPadding)
      }
      const opening = (blocksStartingAtNote.get(index) ?? []).filter(bi => !openedBlocks.has(bi))
      const sectionInset = dividersStartingAtNote.get(index) ?? 0
      if (opening.length > 0 || sectionInset > 0) {
        const topInset = sectionInset + (opening.length > 0 ? blockSpecs[opening[0]!]!.contentTopPadding + opening.slice(1).reduce((sum, bi) => sum + blockSpecs[bi]!.enclosingHeaderStep, 0) : 0)
        noteY = Math.max(noteY, Math.max(contentBottom, completedBottom) + 8 + topInset)
        for (const bi of opening) openedBlocks.add(bi)
      }
      let positioned = positionNote(note, noteY)
      const clearance = overlayClearance(positioned, undefined, index)
      if (clearance > 0) { noteY += clearance; positioned = positionNote(note, noteY) }
      positionedNotes[index] = positioned
      contentBottom = Math.max(contentBottom, positioned.y + positioned.height)
      nextNoteIndex = index + 1
      noteY = positioned.y + positioned.height + 4
    }
    if (notesByAfterIndex.has(afterIndex)) messageY = Math.max(messageY, noteY + messageRowHeight / 2)
  }

  placeNotes(-1, messageY)

  for (let msgIdx = 0; msgIdx < diagram.messages.length; msgIdx++) {
    const msg = diagram.messages[msgIdx]!
    const msgSpec = messageSpecs[msgIdx]!
    const fromIdx = actorIndex.get(msg.from) ?? 0
    const toIdx = actorIndex.get(msg.to) ?? 0
    const isSelf = msg.from === msg.to

    // Add extra vertical space if this message sits below a block header,
    // divider, or has multi-line label text above the arrow shaft.
    completeBlocks()
    const opening = openingBlocks(msgIdx)
    let extra = Math.max(extraSpaceBefore.get(msgIdx) ?? 0, headerSpace(opening))
    for (const ai of createAtIndex.get(msgIdx) ?? []) {
      const topHalf = actors[ai]!.height / 2
      extra = extra > 0 ? extra + Math.max(0, topHalf - 12) : topHalf + 8
    }
    messageY += extra + msgSpec.extraAboveHeight
    const x1 = actorCenterX[fromIdx]!
    const centerX2 = actorCenterX[toIdx]!
    const createdHeader = diagram.actors[toIdx]!.createMessageIndex === msgIdx && diagram.actors[toIdx]!.type === 'participant'
    // A creation message meets the header's boundary; later messages use the
    // lifeline. Ending at its centre puts the arrow under the opaque card.
    const x2 = createdHeader && !isSelf ? centerX2 - Math.sign(centerX2 - x1) * actorWidths[toIdx]! / 2 : centerX2
    const positionRow = (): PositionedMessage => {
      const positioned = positionSequenceMessage(msg, msgSpec, style, x1, x2, messageY)
      messages[msgIdx] = positioned
      // Created headers must have their real position before fragment geometry
      // is completed, including icon labels extending below the message row.
      for (const ai of createAtIndex.get(msgIdx) ?? []) {
        actors[ai] = positionSequenceActor(diagram.actors[ai]!, actorSpecs[ai]!, actorCenterX[ai]!, messageY - actors[ai]!.height / 2)
      }
      return positioned
    }
    let positionedMsg = positionRow()
    let firstPaintedY = positionedMsg.bounds.y
    let anchorShift = 0
    const openingSet = new Set(opening)
    const previewIndices = (blocksStartingAt.get(msgIdx) ?? []).filter(bi => openingSet.has(bi) || (placements[bi]?.top !== undefined && !blocks[bi]))
    if (previewIndices.length > 0) {
      // Preview the opening boundary using the same fragment primitive as the
      // completed frame, including real first-row created actor extents.
      // Seed only needed direct children; never copy the whole block array.
      const preview: PositionedBlock[] = []
      for (const bi of previewIndices) {
        for (const ci of blockScopes[bi]!.childBlockIndices) if (blocks[ci]) preview[ci] = blocks[ci]!
        preview[bi] = positionSequenceBlock(diagram.blocks[bi]!, blockSpecs[bi]!, blockScopes[bi]!, diagram, actorIndex, actors, messages, positionedNotes, preview, style, edgeTextHeight, messageY, placements[bi])
        const reservedTop = placements[bi]?.top
        if (reservedTop !== undefined) anchorShift = Math.max(anchorShift, reservedTop - preview[bi]!.y)
        else firstPaintedY = Math.min(firstPaintedY, preview[bi]!.y)
      }
    }
    const boundaryBottom = opening.length > 0 ? Math.max(contentBottom, completedBottom, reservedBottom) : Math.max(completedBottom, reservedBottom)
    const shift = Math.max(0, anchorShift, boundaryBottom + (opening.length > 0 ? 8 : 0) - firstPaintedY)
    if (shift > 0) {
      messageY += shift
      positionedMsg = positionRow()
    }
    const overlayShift = overlayClearance(positionedMsg.bounds, msgIdx)
    if (overlayShift > 0) { messageY += overlayShift; positionedMsg = positionRow() }
    for (const bi of opening) openedBlocks.add(bi)
    contentBottom = Math.max(contentBottom, positionedMsg.bounds.y + positionedMsg.bounds.height,
      ...(createAtIndex.get(msgIdx) ?? []).map(ai => actors[ai]!.bounds.y + actors[ai]!.bounds.height))
    applyActivationEvents(msgIdx, messageY)

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

    const noteFloor = createdHere ? contentBottom + 8 : positionedMsg.y + selfLoopAdvance + 14
    placeNotes(msgIdx, noteFloor)
  }
  completeBlocks()

  const activationTailY = Math.max(messages[messages.length - 1]?.y ?? messageY, messageY - messageRowHeight / 2)
  applyActivationEvents(diagram.messages.length, activationTailY)

  // Close any unclosed activations at the lifeline tail.
  for (const [actorId, stack] of activationStacks) {
    while (stack.length > 0) deactivate(actorId, activationTailY)
  }

  // Completed fragments are reused unchanged by all output projections.
  for (const actor of actors) if (diagram.actors[actorIndex.get(actor.id)!]?.external) actor.external = true
  for (const [index, message] of messages.entries()) {
    const source = diagram.messages[index]!
    if (source.id !== undefined) message.id = source.id
    if (source.parentId !== undefined) message.parentId = source.parentId
  }
  for (const [index, block] of blocks.entries()) {
    const source = diagram.blocks[index]!
    if (source.id !== undefined) block.id = source.id
    if (source.parentId !== undefined) block.parentId = source.parentId
  }
  for (const [index, note] of positionedNotes.entries()) {
    const source = diagram.notes[index]
    if (note && source?.id !== undefined) note.id = source.id
    if (note && source?.parentId !== undefined) note.parentId = source.parentId
  }
  const notes = positionedNotes.filter((n): n is PositionedNote => n !== undefined)

  const maxBlockBottom = blocks.reduce((max, b) => Math.max(max, b.y + b.height), 0)
  if (maxBlockBottom > 0) {
    messageY = Math.max(messageY, maxBlockBottom + 8)
  }

  // 5b. Box group frames: span the member actors horizontally (plus padding)
  //     and run from the title band above the actor boxes to just below the
  //     lifeline ends, so the group visibly owns its lifelines.
  const lifelineBottom = messageY // lifelines end here (see step 7)
  const boxes: PositionedBoxGroup[] = boxGroups.map(({ box, memberIdxs, block }) => {
    const left = Math.min(...memberIdxs.map(i => actors[i]!.bounds.x)) - SEQ.boxPadX
    let right = Math.max(...memberIdxs.map(i => actors[i]!.bounds.x + actors[i]!.bounds.width)) + SEQ.boxPadX
    // A title wider than the member span widens the frame so it can't clip
    if (box.label) {
      const titleW = block!.width
      right = Math.max(right, left + titleW + SEQ.boxPadX * 2)
    }
    const top = padY
    return {
      label: box.label,
      block,
      labelY: padY + boxTitleHeight / 2,
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
    diagram.title === undefined ? undefined : resolveLabelContent(diagram.title, diagram.titleContent),
    style,
    padX,
    padY,
  )
}

/** The diagram's title takes a band above everything the layout placed. */
function withSequenceTitle(positioned: PositionedSequenceDiagram, title: DisplayTextInput | undefined, style: ResolvedRenderStyle, padX: number, padY: number): PositionedSequenceDiagram {
  const band = diagramTitleBand(title, style)
  if (!band) return positioned
  if (positioned.width === 0 && positioned.height === 0) return { ...positioned, ...titleOnlyCanvas(band, padX, padY) }
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
