// Family-agnostic route audit over the public RenderedLayout.
//
// auditRouteContracts (route-contracts.ts) audits the ELK route pipeline using
// route certificates, so it only applies to the graph families that flow
// through layoutGraphSync (flowchart, state, legacy). This audits the route
// invariant that EVERY family's edges must satisfy at the rendered level — an
// edge label may not sit on a segment that runs collinear with, and overlapping,
// another edge's segment (ROUTE_LABEL_ON_SHARED_TRUNK, route-contracts §11.4):
// the reader cannot tell which edge such a label names. It runs on any family's
// layoutMermaid() output, so the label-on-shared-trunk class can no longer hide
// in sequence / class / ER / architecture / … layouts the graph audit can't see.

import type { RenderedLayout } from './types.ts'
import { measureMultilineText } from '../text-metrics.ts'
import { resolveRenderStyle } from '../styles.ts'

export type RenderedRouteFinding = { code: 'ROUTE_LABEL_ON_SHARED_TRUNK'; edge: string; sharedWith: string }

const EPS = 0.01
const CLEARANCE = 4
const PILL_PAD = 8 // matches route-contracts LABEL_PILL_PADDING

export function auditRenderedRoutes(layout: RenderedLayout): RenderedRouteFinding[] {
  const style = resolveRenderStyle({})
  const findings: RenderedRouteFinding[] = []
  for (const edge of layout.edges) {
    if (!edge.label) continue
    const m = measureMultilineText(edge.label.text, style.edgeLabelFontSize, style.edgeLabelFontWeight)
    const pw = m.width + 2 * PILL_PAD, ph = m.height + 2 * PILL_PAD
    const px = edge.label.x - pw / 2, py = edge.label.y - ph / 2
    let flagged: string | null = null
    for (const other of layout.edges) {
      if (other === edge || flagged) continue
      for (let i = 1; i < other.path.length && !flagged; i++) {
        const a = other.path[i - 1]!, b = other.path[i]!
        const vertical = Math.abs(a[0] - b[0]) < EPS
        const horizontal = Math.abs(a[1] - b[1]) < EPS
        if (!vertical && !horizontal) continue
        const sxLo = Math.min(a[0], b[0]), sxHi = Math.max(a[0], b[0])
        const syLo = Math.min(a[1], b[1]), syHi = Math.max(a[1], b[1])
        if (!(sxHi >= px && sxLo <= px + pw && syHi >= py && syLo <= py + ph)) continue
        // Shared trunk only when one of THIS edge's segments is collinear with
        // the other's; a plain perpendicular crossing under the pill is fine.
        for (let j = 1; j < edge.path.length && !flagged; j++) {
          const c = edge.path[j - 1]!, d = edge.path[j]!
          const sameAxis = vertical
            ? Math.abs(c[0] - d[0]) < EPS && Math.abs(c[0] - a[0]) < CLEARANCE
            : Math.abs(c[1] - d[1]) < EPS && Math.abs(c[1] - a[1]) < CLEARANCE
          if (!sameAxis) continue
          const cLo = vertical ? Math.min(c[1], d[1]) : Math.min(c[0], d[0])
          const cHi = vertical ? Math.max(c[1], d[1]) : Math.max(c[0], d[0])
          const oLo = vertical ? syLo : sxLo
          const oHi = vertical ? syHi : sxHi
          if (Math.min(cHi, oHi) - Math.max(cLo, oLo) > EPS) flagged = other.id
        }
      }
    }
    if (flagged) findings.push({ code: 'ROUTE_LABEL_ON_SHARED_TRUNK', edge: edge.id, sharedWith: flagged })
  }
  return findings
}
