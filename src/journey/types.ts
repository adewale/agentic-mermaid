// ============================================================================
// Journey diagram types
//
// Models Mermaid user journey diagrams in parsed and positioned form.
// Journey diagrams group scored tasks into optional sections with per-task actors.
// ============================================================================

import type { PositionedDiagram } from '../types.ts'

/** Parsed journey diagram — logical structure from Mermaid text */
export interface JourneyDiagram {
  /** Optional diagram title */
  title?: string
  /** Optional accessibility title from Mermaid accTitle */
  accessibilityTitle?: string
  /** Optional accessibility description from Mermaid accDescr */
  accessibilityDescription?: string
  /** Ordered sections in input order */
  sections: JourneySection[]
}

export interface JourneySection {
  id: string
  /** Optional section label. Undefined means an implicit / ungrouped section. */
  label?: string
  tasks: JourneyTask[]
}

export interface JourneyTask {
  id: string
  text: string
  /** Satisfaction score on a 1..5 scale */
  score: number
  /** Optional actors attached to the task */
  actors: string[]
}

// ============================================================================
// Positioned journey diagram — ready for SVG rendering
// ============================================================================

export interface PositionedJourneyDiagram extends PositionedDiagram {
  width: number
  height: number
  title?: PositionedJourneyTitle
  accessibilityTitle?: string
  accessibilityDescription?: string
  actors: PositionedJourneyActor[]
  scoreGuide: PositionedJourneyScoreGuide
  sections: PositionedJourneySection[]
}

export interface PositionedJourneyTitle {
  text: string
  x: number
  y: number
}

export interface PositionedJourneySection {
  id: string
  label?: string
  x: number
  y: number
  width: number
  height: number
  labelX: number
  labelY: number
  /** Whether to render a section span for this section. */
  framed: boolean
  /** Height of the section span. 0 when there is no visible span. */
  headerHeight: number
  tasks: PositionedJourneyTask[]
}

export interface PositionedJourneyActor {
  label: string
  x: number
  y: number
  colorIndex: number
}

export interface PositionedJourneyScoreGuide {
  x: number
  y: number
  width: number
  height: number
  ticks: PositionedJourneyScoreTick[]
  baseline: PositionedJourneyBaseline
}

export interface PositionedJourneyScoreTick {
  score: number
  x1: number
  x2: number
  y: number
  labelX: number
  labelY: number
}

export interface PositionedJourneyBaseline {
  x1: number
  y1: number
  x2: number
  y2: number
}

export interface PositionedJourneyTask {
  id: string
  sectionId: string
  text: string
  score: number
  actors: string[]
  x: number
  y: number
  width: number
  height: number
  textX: number
  textY: number
  centerX: number
  track: PositionedJourneyTrack
  marker: PositionedJourneyScoreMarker
  actorDots: PositionedJourneyActorDot[]
}

export interface PositionedJourneyTrack {
  x: number
  y1: number
  y2: number
}

export interface PositionedJourneyScoreMarker {
  cx: number
  cy: number
  r: number
  score: number
}

export interface PositionedJourneyActorDot {
  label: string
  colorIndex: number
  x: number
  y: number
  r: number
}
