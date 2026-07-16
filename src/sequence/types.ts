// ============================================================================
// Sequence diagram types
//
// Models the parsed and positioned representations of a Mermaid sequence diagram.
// Sequence diagrams show actor interactions over time (vertical timeline).
// ============================================================================

import type { PositionedDiagram } from '../types.ts'

/** Parsed sequence diagram — logical structure from mermaid text */
export interface SequenceDiagram {
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
export type SequenceMessageHead = 'none' | 'filled' | 'open' | 'cross' | 'half-top' | 'half-bottom'

export interface Actor {
  id: string
  label: string
  /** Closed official participant-glyph vocabulary. */
  type: SequenceActorType
  /** Safe actor-menu links; callbacks and unsafe schemes are rejected. */
  links?: Record<string, string>
  /** Index of the message this actor is created at (`create participant …`);
   *  its header box + lifeline start there instead of the diagram top. */
  createMessageIndex?: number
  /** Index of the message this actor is destroyed at (`destroy …`); the
   *  lifeline ends there with an X cross. */
  destroyMessageIndex?: number
}

/** A `box … end` group of participants. */
export interface SequenceBoxGroup {
  /** Title text drawn at the top of the box (may be absent). */
  label?: string
  /** Explicit CSS color from the source (named color, #hex, rgb()/rgba(),
   *  hsl()/hsla(), or 'transparent'). Absent = theme-derived fill. */
  color?: string
  /** Declared participant ids inside the box, in declaration order. */
  actorIds: string[]
}

export interface SequenceActivationEvent {
  actorId: string
  kind: 'activate' | 'deactivate'
  messageIndex: number
}

export interface Message {
  from: string
  to: string
  label: string
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
  /** Block type keyword */
  type: 'loop' | 'alt' | 'opt' | 'par' | 'critical' | 'break' | 'rect'
  /** Label for the block header */
  label: string
  /** Index of the first message inside this block */
  startIndex: number
  /** Index of the last message inside this block (inclusive) */
  endIndex: number
  /** For alt/par blocks: indices where "else"/"and" dividers appear (message indices) */
  dividers: Array<{ index: number; label: string }>
}

export interface Note {
  /** Which actor(s) the note is attached to */
  actorIds: string[]
  /** Note text content */
  text: string
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

export interface PositionedActor {
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
}

/** Vertical dashed line from actor to bottom of diagram */
export interface Lifeline {
  actorId: string
  x: number
  topY: number
  bottomY: number
}

export interface PositionedMessage {
  from: string
  to: string
  label: string
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
}

/** Narrow rectangle on a lifeline showing active processing */
export interface Activation {
  actorId: string
  x: number
  topY: number
  bottomY: number
  width: number
}

export interface PositionedBlock {
  type: Block['type']
  label: string
  x: number
  y: number
  width: number
  height: number
  /** Divider lines within the block (for alt/par) */
  dividers: Array<{ y: number; label: string }>
}

export interface PositionedNote {
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
