export type ErInkBounds = { x0: number; y0: number; x1: number; y1: number }

/** Immutable broad phase for one retained geometry snapshot. Queries keep the
 * original strict intersection predicate; construction and visits share the
 * caller's existing work allowance. Rebuild after any route changes. */
export function erInkIndex<T>(items: readonly T[], bounds: (item: T) => ErInkBounds, charge: (count?: number) => void): (box: ErInkBounds) => T[] {
  type Branch = { box: ErInkBounds; children?: readonly [Branch, Branch]; items?: readonly T[] }
  const build = (rows: T[]): Branch => {
    charge(rows.length + 1)
    const box = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity }
    for (const row of rows) {
      const b = bounds(row)
      box.x0 = Math.min(box.x0, b.x0); box.y0 = Math.min(box.y0, b.y0)
      box.x1 = Math.max(box.x1, b.x1); box.y1 = Math.max(box.y1, b.y1)
    }
    if (rows.length <= 8) return { box, items: rows }
    const axis = box.x1 - box.x0 >= box.y1 - box.y0 ? 'x0' : 'y0'
    rows.sort((a, b) => { charge(); return bounds(a)[axis] - bounds(b)[axis] })
    const middle = Math.floor(rows.length / 2)
    return { box, children: [build(rows.slice(0, middle)), build(rows.slice(middle))] }
  }
  const root = build([...items])
  return box => {
    const found: T[] = []
    const overlaps = (b: ErInkBounds): boolean => {
      charge()
      return box.x0 < b.x1 && box.x1 > b.x0 && box.y0 < b.y1 && box.y1 > b.y0
    }
    const visit = (branch: Branch): void => {
      if (!overlaps(branch.box)) return
      if (branch.children) { visit(branch.children[0]); visit(branch.children[1]) }
      else for (const item of branch.items!) if (overlaps(bounds(item))) found.push(item)
    }
    visit(root)
    return found
  }
}
