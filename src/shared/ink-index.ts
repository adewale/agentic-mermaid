export type InkBounds = { x0: number; y0: number; x1: number; y1: number }
export interface InkTree<T> { bounds: InkBounds; leaves?: readonly T[]; left?: InkTree<T>; right?: InkTree<T> }

/** Stable comparison and merge work must have the same ledger in every host. */
export function chargeInkSort<T>(items: T[], compare: (a: T, b: T) => number, charge: (count?: number) => void): void {
  let ordered = 1
  for (; ordered < items.length; ordered++) { charge(); if (compare(items[ordered - 1]!, items[ordered]!) > 0) break }
  if (ordered >= items.length) return
  charge(items.length)
  const middle = Math.floor(items.length / 2), left = items.slice(0, middle), right = items.slice(middle)
  chargeInkSort(left, compare, charge); chargeInkSort(right, compare, charge)
  let a = 0, b = 0
  for (let i = 0; i < items.length; i++) {
    charge()
    let takeLeft = a < left.length && b === right.length
    if (a < left.length && b < right.length) { charge(); takeLeft = !(compare(left[a]!, right[b]!) > 0) }
    items[i] = takeLeft ? left[a++]! : right[b++]!
  }
}

/** The caller owns these arrays and chooses its accounting and tie order. */
export function buildInkTree<T>(items: T[], bounds: (item: T) => InkBounds, charge?: (count?: number) => void, tie?: (a: T, b: T) => number): InkTree<T> | undefined {
  const build = (rows: T[]): InkTree<T> => {
    charge?.(rows.length + 1)
    const box = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity }
    for (const row of rows) {
      const b = bounds(row)
      box.x0 = Math.min(box.x0, b.x0); box.y0 = Math.min(box.y0, b.y0)
      box.x1 = Math.max(box.x1, b.x1); box.y1 = Math.max(box.y1, b.y1)
    }
    if (rows.length <= 8) return { bounds: box, leaves: rows }
    const axis = box.x1 - box.x0 >= box.y1 - box.y0 ? 'x0' : 'y0'
    const compare = (a: T, b: T) => bounds(a)[axis] - bounds(b)[axis] || tie?.(a, b) || 0
    if (charge) chargeInkSort(rows, compare, charge)
    else rows.sort(compare)
    const middle = Math.floor(rows.length / 2)
    return { bounds: box, left: build(rows.slice(0, middle)), right: build(rows.slice(middle)) }
  }
  return items.length ? build(items) : undefined
}

/** Immutable broad phase for one retained geometry snapshot. Queries keep the
 * original strict intersection predicate; construction and visits share the
 * caller's existing work allowance. Sparse batches stay linear: sorting a huge
 * isolated roster for a handful of contacts costs more than those scans.
 * Rebuild after any route changes. */
export function createInkIndex<T>(items: readonly T[], bounds: (item: T) => InkBounds, charge: (count?: number) => void, expectedQueries: number): (box: InkBounds) => T[] {
  let root: InkTree<T> | undefined
  // Each level scans and sorts its rows. Only pay that construction cost for
  // batches with enough planned queries to recover the squared-depth work.
  const depth = Math.ceil(Math.log2(Math.max(2, items.length)))
  const useIndex = items.length > 8 && expectedQueries > depth * depth
  return box => {
    const found: T[] = []
    const overlaps = (b: InkBounds): boolean => {
      charge()
      return box.x0 < b.x1 && box.x1 > b.x0 && box.y0 < b.y1 && box.y1 > b.y0
    }
    const visit = (branch: InkTree<T>): void => {
      if (!overlaps(branch.bounds)) return
      if (!branch.leaves) { visit(branch.left!); visit(branch.right!) }
      else for (const item of branch.leaves) if (overlaps(bounds(item))) found.push(item)
    }
    if (!root) {
      if (!useIndex) {
        for (const item of items) if (overlaps(bounds(item))) found.push(item)
        return found
      }
      root = buildInkTree([...items], bounds, charge)!
    }
    visit(root)
    return found
  }
}
