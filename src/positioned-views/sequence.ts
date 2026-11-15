// Pure positioned-artifact projection shared by graphical and agent adapters.
import type { PositionedSequenceDiagram } from '../sequence/types.ts'
import type { FamilyEdgeRouteCertificate, Point } from '../types.ts'
import type { FamilyPositionedProjectionContext, FamilyPositionedView } from '../agent/families.ts'
import type { Finite, RenderedLayoutNode } from '../agent/types.ts'
import { f, routeOrthogonal, bendCount, labelRect, retainedLabelGeometry } from './geometry.ts'

export function projectSequencePositioned({ positioned, options }: FamilyPositionedProjectionContext<PositionedSequenceDiagram>): FamilyPositionedView {
  const lifelineByActor = new Map(positioned.lifelines.map(l => [l.actorId, l.x]))
  const firstMessageY = new Map<string, number>()
  for (const message of positioned.messages) for (const id of [message.from, message.to]) if (!firstMessageY.has(id)) firstMessageY.set(id, message.y)
  const membersByBlock = new Map<string, string[]>()
  for (const note of positioned.notes) if (note.parentId !== undefined && note.id !== undefined) {
    const members = membersByBlock.get(note.parentId) ?? []
    members.push(note.id)
    membersByBlock.set(note.parentId, members)
  }
  const nodes: RenderedLayoutNode[] = [
    ...positioned.actors.map(a => ({
      id: a.id,
      x: f(a.external ? a.x : a.bounds.x),
      y: f(a.external ? firstMessageY.get(a.id) ?? a.y : a.bounds.y),
      w: f(a.external ? 0 : a.bounds.width),
      h: f(a.external ? 0 : a.bounds.height),
      shape: a.external ? 'external-anchor' : 'rectangle',
      label: a.label,
      labelBounds: labelRect(a.labelPosition.bounds),
      labelContainer: labelRect(a.bounds),
      ...(a.external ? { labelVisibility: 'semantic' as const } : {}),
      role: a.external ? 'mark' as const : 'box' as const,
    })),
    ...positioned.notes.map((n, i) => ({
      id: n.id ?? `note#${i}`,
      ...(n.parentId === undefined ? {} : { parentId: n.parentId }),
      x: f(n.x),
      y: f(n.y),
      w: f(n.width),
      h: f(n.height),
      shape: 'note',
      label: n.text,
      ...retainedLabelGeometry(n.block, n.x + n.width / 2, n.y + n.height / 2, n),
      role: 'box' as const,
    })),
  ]
  return {
    version: 1,
    nodes,
    edges: positioned.messages.map((m, i) => ({
      id: m.id ?? `msg#${i}:${m.from}->${m.to}`,
      ...(m.parentId === undefined ? {} : { parentId: m.parentId }),
      from: m.from,
      to: m.to,
      path: m.points.map(p => [f(p.x), f(p.y)] as [Finite, Finite]),
      label: m.label ? { x: f(m.labelPosition.x), y: f(m.labelPosition.y), text: m.label, bounds: labelRect(m.labelPosition.bounds) } : undefined,
      route: options.debug ? sequenceRouteCertificate(i, m, m.points, lifelineByActor) : undefined,
    })),
    groups: positioned.blocks.map((b, i) => ({
      id: b.id ?? `block#${i}:${b.type}`,
      ...(b.parentId === undefined ? {} : { parentId: b.parentId }),
      x: f(b.bounds.x),
      y: f(b.bounds.y),
      w: f(b.bounds.width),
      h: f(b.bounds.height),
      members: b.id === undefined ? [] : membersByBlock.get(b.id) ?? [],
      label: b.label,
    })),
    bounds: { w: f(positioned.width), h: f(positioned.height) },
  }
}

function sequenceRouteCertificate(edgeIndex: number, message: { from: string; to: string; x1: number; x2: number; y: number; isSelf: boolean }, points: Point[], lifelineByActor: Map<string, number>): FamilyEdgeRouteCertificate {
  const sourceX = lifelineByActor.get(message.from)
  const targetX = lifelineByActor.get(message.to)
  const first = points[0]
  const last = points[points.length - 1]
  const sourceLifeline = sourceX !== undefined && first !== undefined && Math.abs(first.x - sourceX) <= 1
  const targetLifeline = targetX !== undefined && last !== undefined && Math.abs(last.x - targetX) <= 1
  const horizontal = !message.isSelf && points.every(p => Math.abs(p.y - message.y) <= 1)
  const orthogonal = routeOrthogonal(points)
  return {
    family: 'sequence',
    edgeIndex,
    routeClass: 'family-layout',
    invariant: sourceLifeline && targetLifeline && orthogonal ? (message.isSelf ? 'self-message' : 'lifeline-message') : 'unverified-family-route',
    bendCount: bendCount(points),
    horizontal,
    sourceLifeline,
    targetLifeline,
    selfMessage: message.isSelf,
  }
}
