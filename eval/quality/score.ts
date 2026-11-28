// The findings every quality tool reports for one layout, scored by this
// checkout's measureQuality so two revisions are judged by one scorer.

import { measureQuality } from '../../src/agent/index.ts'
import type { RenderedLayout } from '../../src/agent/types.ts'

/** Misleading-route classes and caption conflicts: each is a reader-visible
 * defect on a real diagram (docs/contributing/diagram-quality.md, "What we detect"). */
export const FINDINGS = ['touches', 'sharedRuns', 'borderRuns', 'shortShafts', 'cornerEnds', 'captionConflicts'] as const
export type Finding = typeof FINDINGS[number]

export interface Score extends Record<Finding, number> { crossings: number; bends: number; area: number }

export function score(layout: RenderedLayout): Score {
  const q = measureQuality(layout)
  return {
    touches: q.routeContacts?.touches ?? 0,
    sharedRuns: q.routeContacts?.overlaps ?? 0,
    borderRuns: q.routeClearance?.borderRuns ?? 0,
    shortShafts: q.routeClearance?.terminalShafts ?? 0,
    cornerEnds: q.routeClearance?.cornerEnds ?? 0,
    captionConflicts: q.labelConflicts?.total ?? 0,
    crossings: q.edgeCrossings,
    bends: q.routeGeometry?.bends ?? 0,
    area: Math.round(q.routeGeometry?.area ?? 0),
  }
}

export const findingCount = (s: Score): number => FINDINGS.reduce((sum, key) => sum + s[key], 0)
