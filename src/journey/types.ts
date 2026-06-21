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
  /** Whether to render a framed background for this section. */
  framed: boolean
  /** Height of the section header band. 0 when there is no visible header row. */
  headerHeight: number
  tasks: PositionedJourneyTask[]
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
  scoreCells: PositionedJourneyScoreCell[]
  actorPills: PositionedJourneyActorPill[]
}

export interface PositionedJourneyScoreCell {
  x: number
  y: number
  size: number
  filled: boolean
}

export interface PositionedJourneyActorPill {
  label: string
  x: number
  y: number
  width: number
  height: number
}
