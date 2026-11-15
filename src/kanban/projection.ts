import type { FamilyPositionedProjectionContext, FamilyPositionedView } from '../agent/families.ts'
import { canvasOf, f, retainedLabelGeometry } from '../positioned-views/geometry.ts'
import type { PositionedKanbanDiagram } from './types.ts'

export function projectKanbanPositioned({ positioned }: FamilyPositionedProjectionContext<PositionedKanbanDiagram>): FamilyPositionedView {
  return {
    version: 1,
    nodes: positioned.columns.flatMap(column =>
      column.tasks.map(task => ({ id: task.id, parentId: column.id, x: f(task.x), y: f(task.y), w: f(task.width), h: f(task.height), shape: 'rectangle', label: task.label, ...retainedLabelGeometry(task.texts[0]?.block, task.texts[0]?.x ?? task.x, task.texts[0]?.y ?? task.y, canvasOf(positioned), 'start') })),
    ),
    edges: [],
    groups: positioned.columns.map(column => ({ id: column.id, label: column.label, x: f(column.x), y: f(column.y), w: f(column.width), h: f(column.height), members: column.tasks.map(task => task.id) })),
    bounds: { w: f(positioned.width), h: f(positioned.height) },
  }
}
