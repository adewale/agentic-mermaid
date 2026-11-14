import type { Direction } from '../types.ts'
import type { MeasuredGraph, MeasuredPlacement } from './measured-graph.ts'

export interface MeasuredScope<P extends MeasuredPlacement> {
  direction: Direction; placed: P; width: number; height: number; dx: number; dy: number
}

/** Size and project a caller-validated scope tree. The caller retains its own
 * local constraints, expansion accounting and any route projection. */
export function placeMeasuredScopes<P extends MeasuredPlacement>(
  input: MeasuredGraph, groups: NonNullable<MeasuredGraph['groups']>, children: readonly (readonly number[])[], leafCount: number,
  local: (scope: number, direction: Direction, placeChild: (id: number) => MeasuredScope<P>) => P,
  unsupported: (reason: string) => never,
  visit?: (scope: number, dx: number, dy: number, placed: P) => void,
) {
  const scopes: MeasuredScope<P>[] = new Array(groups.length + 1)
  const place = (scope: number, inherited: Direction): MeasuredScope<P> => {
    const group = groups[scope - 1], direction = group?.direction ?? inherited
    const placed = local(scope, direction, id => place(id - leafCount + 1, direction))
    const pad = group?.padding ?? { top: input.padding, right: input.padding, bottom: input.padding, left: input.padding }
    const width = Math.max(group?.minWidth ?? 0, placed.width + pad.left + pad.right, 1)
    const value = { direction, placed, width, height: Math.max(placed.height + pad.top + pad.bottom, 1), dx: pad.left + (width - placed.width - pad.left - pad.right) / 2, dy: pad.top }
    if (!Number.isFinite(value.width + value.height + value.dx + value.dy)) unsupported('agentic local coordinate-range limit')
    scopes[scope] = value
    return value
  }
  const root = place(0, input.direction)
  const nodes: MeasuredPlacement['nodes'] = new Array(leafCount), frames: NonNullable<MeasuredPlacement['groups']> = new Array(groups.length)
  const project = (scope: number, x: number, y: number): void => {
    const value = scopes[scope]!, dx = x + value.dx, dy = y + value.dy
    children[scope]!.forEach((id, index) => {
      const point = value.placed.nodes[index]!, location = { x: point.x + dx, y: point.y + dy }
      if (id < leafCount) nodes[id] = { ...location, ...(point.width === undefined ? {} : { width: point.width }), ...(point.height === undefined ? {} : { height: point.height }) }
      else {
        const groupIndex = id - leafCount, child = scopes[groupIndex + 1]!
        frames[groupIndex] = { ...location, width: child.width, height: child.height }
        project(groupIndex + 1, location.x, location.y)
      }
    })
    visit?.(scope, dx, dy, value.placed)
  }
  project(0, 0, 0)
  return { root, scopes, nodes, frames }
}
