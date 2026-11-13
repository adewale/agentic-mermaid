import type { GridCoord } from './types.ts'
import { gridKey } from './types.ts'
import type { TerminalDocument, TerminalLineStyle, TerminalOwner, TerminalPort, TerminalSide } from './terminal-document.ts'
import { snapshotTerminalPort } from './terminal-document.ts'

const allocated = new WeakSet<object>()
interface PathAdmission { readonly route: TerminalRoute; readonly owner: TerminalOwner; readonly width: number; readonly height: number }
const pathAdmissions = new WeakMap<object, Readonly<PathAdmission>>()
/** Runtime authority, not a structural TypeScript brand. */
export function terminalPathAdmission(token: unknown): Readonly<PathAdmission> | undefined {
  if (!token || typeof token !== 'object') return undefined
  const admission = pathAdmissions.get(token)
  return admission && allocated.has(admission.route) ? admission : undefined
}
declare const routeBrand: unique symbol
export interface TerminalRoute {
  readonly [routeBrand]: true
  readonly id: string
  readonly source: Readonly<TerminalPort> & { readonly side: TerminalSide }
  readonly target: Readonly<TerminalPort> & { readonly side: TerminalSide }
  readonly points: readonly Readonly<GridCoord>[]
}

const delta = { T: { x: 0, y: -1 }, R: { x: 1, y: 0 }, B: { x: 0, y: 1 }, L: { x: -1, y: 0 } } as const
const bits = { T: 1, R: 2, B: 4, L: 8 } as const
const opposite = { T: 'B', R: 'L', B: 'T', L: 'R' } as const

/** A complete cell path joins either on-path ports or their outward-adjacent
 * cells. Families retain their existing physical port convention. */
export function allocateTerminalRoute(id: string, source: TerminalPort & { side: TerminalSide }, target: TerminalPort & { side: TerminalSide }, path: readonly Readonly<GridCoord>[]): TerminalRoute {
  source = snapshotTerminalPort(source); target = snapshotTerminalPort(target)
  const points = path.map(point => Object.freeze({ ...point }))
  const integer = (point: Readonly<GridCoord>) => Number.isSafeInteger(point.x) && point.x >= 0 && point.x < Number.MAX_SAFE_INTEGER
    && Number.isSafeInteger(point.y) && point.y >= 0 && point.y < Number.MAX_SAFE_INTEGER
  const same = (a: Readonly<GridCoord> | undefined, b: Readonly<GridCoord>) => a?.x === b.x && a.y === b.y
  const joins = (point: Readonly<GridCoord> | undefined, next: Readonly<GridCoord> | undefined, port: TerminalPort & { side: TerminalSide }): boolean => {
    const d = delta[port.side]
    return !!d && integer(port) && (same(point, port) || same(point, { x: port.x + d.x, y: port.y + d.y }))
      && !same(next, { x: point!.x - d.x, y: point!.y - d.y })
  }
  if (source.end !== 'start' || target.end !== 'end' || !joins(points[0], points[1], source) || !joins(points.at(-1), points.at(-2), target)) throw new Error(`Terminal route ${id} must join both physical ports from outside their endpoints`)
  for (let index = 0; index < points.length; index++) {
    const point = points[index]!, previous = points[index - 1]
    if (!integer(point) || (previous && Math.abs(point.x - previous.x) + Math.abs(point.y - previous.y) !== 1)) throw new Error(`Terminal route ${id} must be a complete contiguous cell path`)
  }
  const route = Object.freeze({ id, source: Object.freeze({ ...source }), target: Object.freeze({ ...target }), points: Object.freeze(points) }) as TerminalRoute
  allocated.add(route)
  return route
}

/** Publish declared ports only after the complete route passes stroke admission. */
export function paintTerminalRoute(document: TerminalDocument, route: TerminalRoute, owner: TerminalOwner, ascii: boolean, style: TerminalLineStyle = 'solid'): boolean {
  if (!allocated.has(route)) throw new TypeError('Terminal routes must come from complete path allocation')
  owner = { ...owner }
  if (owner.kind !== 'edge' || owner.id !== route.id || owner.from !== route.source.nodeId || owner.to !== route.target.nodeId) throw new TypeError('Terminal route identity must match its physical endpoints')
  owner = document.element(owner)
  const directions = new Map<string, { x: number; y: number; mask: number }>()
  const add = (point: Readonly<GridCoord>, side: TerminalSide) => {
    const key = gridKey(point), previous = directions.get(key)
    directions.set(key, { ...point, mask: (previous?.mask ?? 0) | bits[side] })
  }
  for (let index = 1; index < route.points.length; index++) {
    const a = route.points[index - 1]!, b = route.points[index]!
    const side = b.x > a.x ? 'R' : b.x < a.x ? 'L' : b.y > a.y ? 'B' : 'T'
    add(a, side); add(b, opposite[side])
  }
  add(route.points[0]!, opposite[route.source.side]); add(route.points.at(-1)!, opposite[route.target.side])
  const strokes = [...directions.values()].map(point => ({ ...point, role: (point.mask & 10) && (point.mask & 5) ? 'corner' as const : 'line' as const }))
  if (!document.strokeBatch(strokes, { owner, ascii, style })) return false
  document.port(owner, route.source); document.port(owner, route.target)
  // Exact-port witnesses are optional; other conventions retain connected BFS.
  const first = route.points[0], last = route.points.at(-1)
  if (owner.route === 'connected' && first?.x === route.source.x && first.y === route.source.y && last?.x === route.target.x && last.y === route.target.y) {
    document.reserveTerminalPathWitnessWork(3) // token, immutable admission record, WeakMap entry: before allocation
    const token = Object.freeze({})
    pathAdmissions.set(token, Object.freeze({ route, owner, width: document.width, height: document.height }))
    document.registerTerminalPathWitness(owner, token)
  }
  return true
}
