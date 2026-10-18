// Pure geometry shared by positioned views; no registry, parsing or layout.
import type { FamilyEdgeRouteCertificate, Point, RegionContainmentCertificate } from '../types.ts'
import type { FamilyPositionedView } from '../agent/families.ts'
import type { Finite, RenderedLayoutGroup, RenderedLayoutNode } from '../agent/types.ts'
import { toFinite } from '../agent/types.ts'
export { toFinite }
export { retainedLabelBounds, retainedLabelGeometry } from '../agent/layout-to-rendered.ts'

export const canvasOf = (p: { width: number; height: number }) => ({ x: 0, y: 0, width: p.width, height: p.height })
export const labelRect = (r: { x: number; y: number; width: number; height: number }) => ({ x: toFinite(r.x), y: toFinite(r.y), w: toFinite(r.width), h: toFinite(r.height) })

type ElementCertificateFamily = 'timeline' | 'xychart' | 'pie' | 'quadrant' | 'gantt'
type ElementCertificateInvariant = RegionContainmentCertificate['invariant']

export function f(n: number): Finite {
  return toFinite(Math.round(n))
}

export function fSpan(start: number, length: number): Finite {
  return toFinite(Math.round(start + length) - Math.round(start))
}

export function boxRouteCertificate(family: 'class' | 'er', edgeIndex: number, points: Point[], source: { x: number; y: number; width: number; height: number } | undefined, target: { x: number; y: number; width: number; height: number } | undefined): FamilyEdgeRouteCertificate {
  const sourceBoundary = !!(source && points[0] && pointOnRawRectBoundary(points[0].x, points[0].y, source, 1))
  const targetBoundary = !!(target && points[points.length - 1] && pointOnRawRectBoundary(points[points.length - 1]!.x, points[points.length - 1]!.y, target, 1))
  const orthogonal = routeOrthogonal(points)
  return {
    family,
    edgeIndex,
    routeClass: 'family-layout',
    invariant: sourceBoundary && targetBoundary && orthogonal ? 'orthogonal-box' : 'unverified-family-route',
    bendCount: bendCount(points),
    orthogonal,
    sourceBoundary,
    targetBoundary,
  }
}

export function routeOrthogonal(points: Point[]): boolean {
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]!,
      b = points[i]!
    if (Math.abs(a.x - b.x) > 0.5 && Math.abs(a.y - b.y) > 0.5) return false
  }
  return true
}

export function bendCount(points: Point[]): number {
  if (points.length < 3) return 0
  let bends = 0
  for (let i = 1; i < points.length - 1; i++) {
    const a = points[i - 1]!,
      b = points[i]!,
      c = points[i + 1]!
    const sameX = Math.abs(a.x - b.x) <= 0.5 && Math.abs(b.x - c.x) <= 0.5
    const sameY = Math.abs(a.y - b.y) <= 0.5 && Math.abs(b.y - c.y) <= 0.5
    if (!sameX && !sameY) bends++
  }
  return bends
}

export function pointOnRawRectBoundary(x: number, y: number, n: { x: number; y: number; width: number; height: number }, tol: number): boolean {
  const onVertical = (Math.abs(x - n.x) <= tol || Math.abs(x - (n.x + n.width)) <= tol) && y >= n.y - tol && y <= n.y + n.height + tol
  const onHorizontal = (Math.abs(y - n.y) <= tol || Math.abs(y - (n.y + n.height)) <= tol) && x >= n.x - tol && x <= n.x + n.width + tol
  return onVertical || onHorizontal
}

export function labelMidpoint(points: Array<{ x: number; y: number }>, text: string): { x: Finite; y: Finite; text: string } | undefined {
  if (points.length === 0) return undefined
  const mid = points[Math.floor(points.length / 2)]!
  return { x: f(mid.x), y: f(mid.y), text }
}

export function elementCertificates(family: ElementCertificateFamily, layout: FamilyPositionedView, invariant: ElementCertificateInvariant, referenceGroup?: RenderedLayoutGroup, containment: 'bounds' | 'center' = 'bounds'): RegionContainmentCertificate[] {
  const groupsByMember = new Map<string, RenderedLayoutGroup>()
  for (const group of layout.groups) {
    for (const member of group.members) groupsByMember.set(member, group)
  }
  return layout.nodes.map(n => {
    const withinBounds = nodeWithinBounds(n, layout.bounds)
    const group = groupsByMember.get(n.id) ?? referenceGroup
    const withinGroup = group ? (containment === 'center' ? nodeCenterWithinGroup(n, group) : nodeWithinGroup(n, group)) : undefined
    return {
      family,
      elementId: n.id,
      routeClass: 'family-layout',
      invariant: withinBounds && (withinGroup ?? true) ? invariant : 'unverified-family-layout',
      bounds: { x: n.x, y: n.y, w: n.w, h: n.h },
      center: { x: f(n.x + n.w / 2), y: f(n.y + n.h / 2) },
      containment,
      withinBounds,
      ...(group ? { groupId: group.id, withinGroup } : {}),
    }
  })
}

export function nodeWithinBounds(n: RenderedLayoutNode, bounds: FamilyPositionedView['bounds'], tol = 0.5): boolean {
  return n.x >= -tol && n.y >= -tol && n.x + n.w <= bounds.w + tol && n.y + n.h <= bounds.h + tol
}

export function nodeWithinGroup(n: RenderedLayoutNode, g: RenderedLayoutGroup, tol = 0.5): boolean {
  return n.x >= g.x - tol && n.y >= g.y - tol && n.x + n.w <= g.x + g.w + tol && n.y + n.h <= g.y + g.h + tol
}

export function nodeCenterWithinGroup(n: RenderedLayoutNode, g: RenderedLayoutGroup, tol = 0.5): boolean {
  const cx = n.x + n.w / 2
  const cy = n.y + n.h / 2
  return cx >= g.x - tol && cy >= g.y - tol && cx <= g.x + g.w + tol && cy <= g.y + g.h + tol
}
