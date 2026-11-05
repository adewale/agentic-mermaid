import type { FamilyPositionedProjectionContext, FamilyPositionedView } from '../agent/families.ts'
import { f, fSpan, retainedLabelGeometry } from '../positioned-views/geometry.ts'
import type { PositionedRailroad } from './layout.ts'

export function projectRailroadPositioned({ positioned: p }: FamilyPositionedProjectionContext<PositionedRailroad>): FamilyPositionedView {
  const members = new Map<string, string[]>()
  for (const label of p.labels) if (label.kind !== 'annotation') { const siblings = members.get(label.ruleId) ?? []; siblings.push(label.id); members.set(label.ruleId, siblings) }
  return { version: 1, bounds: { w: f(p.width), h: f(p.height) },
    nodes: p.labels.filter(label => label.kind !== 'annotation').map(label => ({ id: label.id, parentId: label.ruleId, shape: 'rectangle', label: label.block.text,
      x: f(label.x), y: f(label.y), w: fSpan(label.x, label.width), h: fSpan(label.y, label.height), ...retainedLabelGeometry(label.block, label.x + label.width / 2, label.y + label.height / 2, label) })),
    // Rails are grammar artwork with branches and return loops, not binary
    // authored relationships. Their owned geometry remains in the Scene.
    edges: [], groups: p.rules.map(rule => ({ id: rule.id, label: rule.name.text, x: f(rule.x), y: f(rule.y), w: f(rule.width), h: f(rule.height),
      members: members.get(rule.id) ?? [] })) }
}
