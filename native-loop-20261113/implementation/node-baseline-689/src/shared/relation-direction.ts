import type { ConnectorDirection } from '../scene/ir.ts'

/** How an edge with optional arrowheads reads between its authored endpoints. */
export type ArrowheadDirection = Exclude<ConnectorDirection, 'self'>

/**
 * The one reading of an authored edge's arrowheads. Describe prose, the AX
 * tree, facts and SVG relation accessibility all take direction from here, so
 * `a <-- b` reads as pointing at `a` everywhere it is drawn that way.
 */
export function arrowheadDirection(hasArrowStart: boolean, hasArrowEnd: boolean): ArrowheadDirection {
  if (hasArrowStart && hasArrowEnd) return 'bidirectional'
  if (hasArrowStart) return 'reverse'
  return hasArrowEnd ? 'forward' : 'undirected'
}

const ARROW_TOKEN: Record<ArrowheadDirection, string> = { forward: '->', reverse: '<-', bidirectional: '<->', undirected: '--' }

/** The arrow token describe text and facts write between authored endpoints. */
export function directionArrow(direction: ArrowheadDirection): string {
  return ARROW_TOKEN[direction]
}

/** A relation's readable name, in the order its arrowheads point. */
export function relationPhrase(from: string, to: string, direction: ConnectorDirection | undefined): string {
  switch (direction) {
    case 'reverse':
      return `${to} to ${from}`
    case 'bidirectional':
      return `between ${from} and ${to} in both directions`
    case 'undirected':
      return `between ${from} and ${to}`
    default:
      return `${from} to ${to}`
  }
}
