export const TERMINAL_CERTIFICATION_LIMITS = Object.freeze({ maxOperations: 1_000_000, maxOutputCodeUnits: 2_000_000, maxIssues: 64 })

/** Owner identities a terminal document may sort, scan or name while composing
 * multi-owner cell sets, summed over every set it composes and every document
 * overlaid into it. A route adds its identity to each cell it shares, so
 * overlapping dense wiring grows this faster than quadratically: a 30 x 30 `&`
 * fan needs about 8.5 million and a 50 x 50 fan over 100 million. The largest
 * golden or corpus diagram, the release 300-node tree, needs about 1.5 million;
 * a 450-node tree about 3.6 million. */
export const TERMINAL_OWNER_COMPOSITION_LIMIT = 4_000_000

export type TerminalWorkResource = 'stroke-provenance' | 'path-witness' | 'owner-composition' | 'class-construction' | 'class-output'

/** Terminal drawing exhausted one of its work ceilings. The ceilings bound the
 * size of the cell projection a diagram needs, so exhausting one is a property
 * of the diagram, not an engine defect. No engine imports. */
export class TerminalWorkLimitError extends RangeError {
  readonly code = 'TERMINAL_WORK_LIMIT'
  constructor(readonly resource: TerminalWorkResource, readonly limit: number) {
    super(`TERMINAL_WORK_LIMIT: terminal ${resource} work exceeds its ceiling of ${limit}; split the diagram or reduce its relationships, or render it as SVG`)
    this.name = 'TerminalWorkLimitError'
  }
}
