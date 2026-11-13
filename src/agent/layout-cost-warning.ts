// ============================================================================
// Advisory finding for a graph laid out under the bounded cost profile.
//
// layoutElkGraph estimates layered placement work from the graph alone
// (src/layout/layout-cost.ts). Above a threshold it relaxes the named ELK
// options and bounds the candidate search, and records the decision on the
// positioned graph and the render receipt (`receipt.layoutCertification.
// layoutCost`). Verify names it as LAYOUT_LIMIT_EXCEEDED, which is advisory:
// the drawing is still certified and `ok` does not change.
// ============================================================================

import type { LayoutCostReceipt } from '../layout/layout-cost.ts'
import type { LayoutWarning } from './types.ts'

export function layoutCostWarnings(positioned: unknown): LayoutWarning[] {
  const receipt = (positioned as { layoutCost?: LayoutCostReceipt } | undefined)?.layoutCost
  if (!receipt) return []
  const { estimate } = receipt
  return [{
    code: 'LAYOUT_LIMIT_EXCEEDED',
    constraint: 'layout.cost',
    message: `Layered layout work estimate (${estimate.edges} edges, ${estimate.dummySegments} long-edge dummy segments, ${estimate.maxGapEdges} edges in the densest layer gap) exceeds the host layout cost bound; relaxed ELK options: ${receipt.relaxed.join(', ')}; at most ${receipt.maxCandidates} layout candidates with ${receipt.maxElkAttemptsPerCandidate} ELK attempts each. Certification still applies; split the diagram or reduce long or parallel edges to restore the full layout search.`,
  }]
}
