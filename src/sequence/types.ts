import type { PixelTextBlock } from '../shared/prepared-text.ts'
import type { LabelContent } from '../shared/display-text.ts'
// ============================================================================
// Sequence diagram types
//
// Models the parsed and positioned representations of a Mermaid sequence diagram.
// Sequence diagrams show actor interactions over time (vertical timeline).
// ============================================================================

import type { PositionedDiagramTitle } from '../styles.ts'
import type { PositionedDiagram } from '../types.ts'

/** Parsed sequence diagram — logical structure from mermaid text */
export interface SequenceDiagram {
  /** The diagram's title (`title` statement, or frontmatter `title:`). */
  title?: string
  titleContent?: LabelContent
  /** Optional accessibility title (Mermaid accTitle) */
  accessibilityTitle?: string
  /** Optional accessibility description (Mermaid accDescr) */
  accessibilityDescription?: string
  /** Ordered list of actors/participants */
  actors: Actor[]
  /** Messages between actors in chronological order */
  messages: Message[]
  /** Structural blocks (loop, alt, opt, par, critical) */
  blocks: Block[]
  /** Notes attached to actors */
  notes: Note[]
  /** Ordered standalone activate/deactivate commands, anchored at the next
   * message boundary (messages.length at the source position). */
  activationEvents?: SequenceActivationEvent[]
  /** `box <color?> <label?> ... end` participant groups (upstream §Grouping/Box).
   *  Optional for hand-built diagrams; the parser always populates it. */
  boxes?: SequenceBoxGroup[]
}

export type SequenceActorType = 'participant' | 'actor' | 'boundary' | 'control' | 'entity' | 'database' | 'collections' | 'queue'
export type SequenceMessageHead = 'none' | 'filled' | 'open' | 'cross' | 'half-top' | 'half-bottom' | 'stick-top' | 'stick-bottom'

export interface Actor {
  /** An incoming endpoint outside the authored participants; no header/lifeline. */
  external?: true
  wrap?: boolean
  id: string
  label: string
  labelContent?: LabelContent
  /** Closed official participant-glyph vocabulary. */
  type: SequenceActorType
  /** Safe actor-menu links; callbacks and unsafe schemes are rejected. */
  links?: Record<string, string>
  /** Index into `SequenceDiagram.boxes` of the box that frames this actor:
   *  the one open when a statement first met it inside a box (upstream's
   *  `actor.box`). */
  box?: number
  /** Index of the message this actor is created at (`create participant …`);
   *  its header box + lifeline start there instead of the diagram top. */
  createMessageIndex?: number
  /** Index of the message this actor is destroyed at (`destroy …`); the
   *  lifeline ends there with an X cross. */
  destroyMessageIndex?: number
}

/** A `box … end` group of participants. */
export interface SequenceBoxGroup {
  wrap?: boolean
  /** Title text drawn at the top of the box (may be absent). */
  label?: string
  labelContent?: LabelContent
  /** Explicit CSS color from the source (named color, #hex, rgb()/rgba(),
   *  hsl()/hsla(), or 'transparent'). Absent = theme-derived fill. */
  color?: string
  /** Upstream's `actorKeys`: each declaration inside the box that created or
   *  renamed an actor, in order (a repeat naming declaration repeats the id).
   *  A bare declaration of an actor created earlier places it in the box
   *  (`Actor.box`) without listing it here. */
  actorIds: string[]
}

export interface SequenceActivationEvent {
  actorId: string
  kind: 'activate' | 'deactivate'
  messageIndex: number
}

export interface Message {
  /** Identity and lexical fragment supplied by another native sequence language. */
  id?: string
  parentId?: string
  /** Effective soft-wrap control; absent retains the renderer's default. */
  wrap?: boolean
  from: string
  to: string
  label: string
  labelContent?: LabelContent
  /** Arrow style: solid line or dashed line */
  lineStyle: 'solid' | 'dashed'
  /** Exact source and target endpoint semantics. */
  startHead: SequenceMessageHead
  endHead: SequenceMessageHead
  centralStart: boolean
  centralEnd: boolean
  /** Activate the target lifeline (+) */
  activate?: boolean
  /** Deactivate the source lifeline (-) */
  deactivate?: boolean
  /** Sequence number assigned by `autonumber` (absent when numbering is off).
   *  Display surfaces prefix it to the label ("1. label"). */
  number?: number
}

export interface Block {
  id?: string
  parentId?: string
  wrap?: boolean
  /** Block type keyword */
  type: 'loop' | 'alt' | 'opt' | 'par' | 'par_over' | 'critical' | 'break' | 'rect'
  /** Label for the block header */
  label: string
  labelContent?: LabelContent
  /** Source-controlled background paint for a `rect` block. */
  color?: string
  /** Index of the first message inside this block */
  startIndex: number
  /** Index of the last message inside this block (inclusive) */
  endIndex: number
  /** For alt/par blocks: indices where "else"/"and" dividers appear (message indices) */
  dividers: Array<{ index: number; label: string; labelContent?: LabelContent; wrap?: boolean }>
}

export interface Note {
  id?: string
  parentId?: string
  wrap?: boolean
  /** Which actor(s) the note is attached to */
  actorIds: string[]
  /** Note text content */
  text: string
  textContent?: LabelContent
  /** Position relative to the actor(s) */
  position: 'left' | 'right' | 'over'
  /** Message index after which this note appears */
  afterIndex: number
}

// ============================================================================
// Positioned sequence diagram — ready for SVG rendering
// ============================================================================

export interface PositionedSequenceDiagram extends PositionedDiagram {
  width: number
  height: number
  /** The diagram's title, in its band above the participants. */
  title?: PositionedDiagramTitle
  accessibilityTitle?: string
  accessibilityDescription?: string
  actors: PositionedActor[]
  lifelines: Lifeline[]
  messages: PositionedMessage[]
  activations: Activation[]
  blocks: PositionedBlock[]
  notes: PositionedNote[]
  /** Background frames for `box … end` participant groups. */
  boxes: PositionedBoxGroup[]
  /** X crosses marking `destroy` points at the end of destroyed lifelines. */
  destructions: LifelineCross[]
}

/** Positioned `box … end` background frame (drawn behind everything). */
export interface PositionedBoxGroup {
  block?: PixelTextBlock
  labelY?: number
  label?: string
  /** Explicit CSS color from the source; absent = theme-derived fill. */
  color?: string
  x: number
  y: number
  width: number
  height: number
}

/** An X cross drawn where a destroyed lifeline ends. */
export interface LifelineCross {
  actorId: string
  x: number
  y: number
}

/** Axis-aligned painted bounding box in sequence canvas coordinates. */
export interface SequenceBounds {
  x: number
  y: number
  width: number
  height: number
}

/** Positioned text label with its anchor and full painted bounding box. */
export interface PositionedSequenceLabel {
  block?: PixelTextBlock
  text: string
  x: number
  y: number
  anchor: 'start' | 'middle' | 'end'
  fontSize: number
  fontWeight: number
  letterSpacing: number
  bounds: SequenceBounds
}

/** Positioned fragment header tab and label (`loop`, `alt`, `opt`, `par`, `critical`, `break`). */
export interface PositionedBlockHeader {
  x: number
  y: number
  width: number
  height: number
  label: PositionedSequenceLabel
}

export interface PositionedActor {
  external?: true
  menuBlock?: PixelTextBlock
  id: string
  label: string
  type: SequenceActorType
  links?: Record<string, string>
  /** Center x of the actor box */
  x: number
  /** Top y of the actor box */
  y: number
  width: number
  height: number
  /** Complete painted header bounds (box or icon glyph + below-icon multiline label). */
  bounds: SequenceBounds
  /** Positioned label anchor and painted bounds. */
  labelPosition: PositionedSequenceLabel
}

/** Vertical dashed line from actor to bottom of diagram */
export interface Lifeline {
  actorId: string
  x: number
  topY: number
  bottomY: number
}

export interface PositionedMessage {
  id?: string
  parentId?: string
  from: string
  to: string
  label: string
  /** Untransformed message display meaning, including the autonumber prefix. */
  labelContent?: LabelContent
  lineStyle: 'solid' | 'dashed'
  startHead: SequenceMessageHead
  endHead: SequenceMessageHead
  centralStart: boolean
  centralEnd: boolean
  /** Start point (from actor's lifeline) */
  x1: number
  /** End point (to actor's lifeline) */
  x2: number
  /** Vertical position */
  y: number
  /** Whether this is a self-message (same actor) */
  isSelf: boolean
  /** Routed connector polyline points (2 points for horizontal messages, 4 points for self-loops). */
  points: Array<{ x: number; y: number }>
  /** Positioned label anchor and painted bounds. */
  labelPosition: PositionedSequenceLabel
  /** Complete painted bounds covering the shaft/loop, arrowheads, and label. */
  bounds: SequenceBounds
}

/** Narrow rectangle on a lifeline showing active processing */
export interface Activation {
  actorId: string
  x: number
  topY: number
  bottomY: number
  width: number
}

export interface PositionedBlockDivider {
  y: number
  label: string
  labelPosition?: PositionedSequenceLabel
}

export interface PositionedBlock {
  id?: string
  parentId?: string
  type: Block['type']
  label: string
  color?: string
  x: number
  y: number
  width: number
  height: number
  /** Divider lines within the block (for alt/par) */
  dividers: PositionedBlockDivider[]
  /** Positioned fragment header tab and label (`undefined` for `rect` blocks). */
  header?: PositionedBlockHeader
  /** Complete painted bounds covering the fragment frame, header tab, dividers, notes, and child blocks. */
  bounds: SequenceBounds
}

export interface PositionedNote {
  id?: string
  parentId?: string
  block?: PixelTextBlock
  text: string
  x: number
  y: number
  width: number
  height: number
  /** Actor IDs this note is attached to (for SVG attribution) */
  actors?: string[]
  /** Note position relative to actors (for SVG attribution) */
  position?: 'left' | 'right' | 'over'
}
