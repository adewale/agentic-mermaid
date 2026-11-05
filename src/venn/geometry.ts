// Adapted from Pele (MIT, copyright 2026 kepano), revision 3a2f075.
// See LICENSES/pele-MIT.txt.
import type { VennSubset } from './types.ts'

export interface Circle {
  id: string
  x: number
  y: number
  r: number
}

// Where the content of a region goes: the point inside all of `inside` and outside every other
// circle that is farthest from their outlines, and how far that is. A margin of 0 or less means
// the circles as placed leave the region empty.
export interface Spot {
  x: number
  y: number
  margin: number
}

const TAU = Math.PI * 2

// For every overlap of three or more sets, adds the pairwise overlaps it implies and the diagram
// does not state, a quarter of the smaller set each, so that the circles are drawn overlapping.
// Returns the list it was given when there is nothing to add.
export function ensurePairwiseSubsets(subsets: VennSubset[]): VennSubset[] {
  const present = new Set<string>()
  const sizes = new Map<string, number>()
  for (const subset of subsets) {
    present.add(JSON.stringify([...subset.sets].sort()))
    if (subset.sets.length === 1) sizes.set(subset.sets[0]!, subset.size)
  }
  const added: VennSubset[] = []
  for (const subset of subsets) {
    if (subset.sets.length < 3) continue
    const members = [...subset.sets].sort()
    for (let i = 0; i < members.length - 1; i++) {
      for (let j = i + 1; j < members.length; j++) {
        const pair = [members[i]!, members[j]!]
        const key = JSON.stringify(pair)
        if (present.has(key)) continue
        present.add(key)
        const a = sizes.get(pair[0]!)
        const b = sizes.get(pair[1]!)
        added.push({ sets: pair, size: a !== undefined && b !== undefined ? Math.min(a, b) / 4 : 2.5, label: '' })
      }
    }
  }
  return added.length > 0 ? [...subsets, ...added] : subsets
}

// The area two circles share when their centers are d apart.
export function lensArea(r1: number, r2: number, d: number): number {
  if (d >= r1 + r2) return 0
  const small = Math.min(r1, r2)
  if (d <= Math.abs(r1 - r2)) return Math.PI * small * small
  const a1 = r1 * r1 * Math.acos((d * d + r1 * r1 - r2 * r2) / (2 * d * r1))
  const a2 = r2 * r2 * Math.acos((d * d + r2 * r2 - r1 * r1) / (2 * d * r2))
  const a3 = 0.5 * Math.sqrt(Math.max((-d + r1 + r2) * (d + r1 - r2) * (d - r1 + r2) * (d + r1 + r2), 0))
  return a1 + a2 - a3
}

// How far apart two circles sit for their overlap to have the given area. The area falls as the
// distance grows, so bisection finds it.
export function distanceForOverlap(r1: number, r2: number, area: number): number {
  let low = Math.abs(r1 - r2)
  let high = r1 + r2
  if (!(area > 0)) return high
  if (area >= Math.PI * Math.min(r1, r2) ** 2) return low
  for (let i = 0; i < 48; i++) {
    const middle = (low + high) / 2
    if (lensArea(r1, r2, middle) > area) low = middle
    else high = middle
  }
  return (low + high) / 2
}

// How far a point is from the nearest outline it must stay within or without. Gives up, with
// some value below `floor`, as soon as the point cannot reach `floor`.
function margin(circles: Circle[], inside: number[], outside: number[], x: number, y: number, floor: number): number {
  let best = Infinity
  for (const i of inside) {
    const c = circles[i]!
    const dx = x - c.x
    const dy = y - c.y
    const room = c.r - Math.sqrt(dx * dx + dy * dy)
    if (room < best) {
      if (room < floor) return room
      best = room
    }
  }
  for (const i of outside) {
    const c = circles[i]!
    const dx = x - c.x
    const dy = y - c.y
    const room = Math.sqrt(dx * dx + dy * dy) - c.r
    if (room < best) {
      if (room < floor) return room
      best = room
    }
  }
  return best
}

// Finds the roomiest point of a region by sampling the smallest of its circles on a grid and then
// walking uphill from the best sample. Ties go to the point nearest the middle of the region, so
// a symmetric arrangement gets symmetric labels.
export function findSpot(circles: Circle[], inside: number[], outside: number[], probeBudget = 640): Spot {
  let cx = 0
  let cy = 0
  let smallest = circles[inside[0]!]!
  for (const i of inside) {
    const c = circles[i]!
    cx += c.x / inside.length
    cy += c.y / inside.length
    if (c.r < smallest.r) smallest = c
  }
  const r = smallest.r
  let x = cx
  let y = cy
  let best = margin(circles, inside, outside, x, y, -Infinity)
  let off = 0
  let probes = 1
  const consider = (px: number, py: number): boolean => {
    if (++probes > probeBudget) return false
    const m = margin(circles, inside, outside, px, py, best - r * 1e-9)
    if (!(m > best - r * 1e-9)) return false
    const distance = Math.hypot(px - cx, py - cy)
    if (m > best + r * 1e-9 || distance < off - r * 1e-9) {
      best = m
      off = distance
      x = px
      y = py
      return true
    }
    return false
  }
  const GRID = Math.min(10, Math.max(0, Math.floor((Math.sqrt(probeBudget / 2) - 1) / 2)))
  for (let gy = -GRID; gy <= GRID; gy++) {
    for (let gx = -GRID; gx <= GRID; gx++) {
      if (GRID && gx * gx + gy * gy <= GRID * GRID) consider(smallest.x + (gx * r) / GRID, smallest.y + (gy * r) / GRID)
    }
  }
  let step = r / Math.max(1, GRID)
  for (let round = 0; round < 40 && probes < probeBudget && step > r * 1e-6; round++) {
    let moved = false
    for (let k = 0; k < 8; k++) {
      const angle = (k * TAU) / 8
      if (consider(x + Math.cos(angle) * step, y + Math.sin(angle) * step)) moved = true
    }
    if (!moved) step /= 2
  }
  return { x, y, margin: best }
}

// Places one circle per set, with areas in proportion to the sizes of the sets and each pair as
// far apart as its overlap asks: one and two sets exactly, more by relaxing a ring of
// circles toward those distances. Lengths are in units of the square root of a size.
export function layoutCircles(subsets: VennSubset[]): Circle[] {
  const sizes = new Map<string, number>()
  for (const subset of subsets) for (const id of subset.sets) if (!sizes.has(id)) sizes.set(id, 10)
  for (const subset of subsets) if (subset.sets.length === 1) sizes.set(subset.sets[0]!, subset.size)

  const index = new Map<string, number>()
  const circles: Circle[] = []
  let largest = 0
  for (const size of sizes.values()) if (Number.isFinite(size) && size > largest) largest = size
  if (largest === 0) largest = 10
  const widest = Math.sqrt(largest / Math.PI)
  for (const [id, size] of sizes) {
    index.set(id, circles.length)
    // Set radii preserve authored areas, including zero. Labels have their own bounds.
    const r = Number.isFinite(size) && size > 0 ? Math.sqrt(size / Math.PI) : 0
    circles.push({ id, x: 0, y: 0, r })
  }
  const n = circles.length
  if (n < 2) return circles

  // The overlap each pair was given, by the indexes of its circles.
  const overlaps = new Map<number, number>()
  for (const subset of ensurePairwiseSubsets(subsets)) {
    if (subset.sets.length !== 2) continue
    const a = index.get(subset.sets[0]!)!
    const b = index.get(subset.sets[1]!)!
    if (a !== b) overlaps.set(Math.min(a, b) * n + Math.max(a, b), subset.size)
  }
  // How far apart each overlapping pair should be. Pairs that do not overlap only have to keep a gap.
  const wanted = new Map<number, number>()
  for (const [key, area] of overlaps) {
    wanted.set(key, distanceForOverlap(circles[Math.floor(key / n)]!.r, circles[key % n]!.r, area))
  }
  const gap = widest * 0.15
  const distance = (a: number, b: number): number => wanted.get(a * n + b) ?? circles[a]!.r + circles[b]!.r + gap

  if (n === 2) {
    circles[1]!.x = distance(0, 1)
    return circles
  }

  if (n === 3) {
    // Two sets side by side and the third below, the corners of a triangle whose sides are the
    // three distances. An overlap of all three has to exist, so the triangle shrinks until it does.
    let ab = distance(0, 1)
    let ac = distance(0, 2)
    let bc = distance(1, 2)
    const triple = subsets.some(subset => new Set(subset.sets).size === 3)
    for (let attempt = 0; attempt < 40; attempt++) {
      const x = ab > 0 ? (ab * ab + ac * ac - bc * bc) / (2 * ab) : 0
      circles[1]!.x = ab
      circles[2]!.x = Math.max(-ac, Math.min(ac, x))
      circles[2]!.y = Math.sqrt(Math.max(ac * ac - x * x, 0))
      if (!triple || findSpot(circles, [0, 1, 2], []).margin > widest * 0.12) break
      ab *= 0.94
      ac *= 0.94
      bc *= 0.94
    }
    return circles
  }

  let total = 0
  for (const c of circles) total += 2 * c.r + gap
  const rounds = Math.min(300, Math.floor(3e6 / (n * n)))
  if (n <= 64) {
    const ring = total / TAU
    circles.forEach((c, i) => {
      const angle = (i * TAU) / n - Math.PI / 2
      c.x = Math.cos(angle) * ring
      c.y = Math.sin(angle) * ring
    })
  } else {
    const columns = Math.ceil(Math.sqrt(n))
    const cell = 2 * widest + gap
    circles.forEach((c, i) => {
      c.x = (i % columns) * cell
      c.y = Math.floor(i / columns) * cell
    })
  }
  const dx = new Float64Array(n)
  const dy = new Float64Array(n)
  const pulls = new Int32Array(n)
  for (let round = 0; round < rounds; round++) {
    dx.fill(0)
    dy.fill(0)
    pulls.fill(0)
    for (let a = 0; a < n; a++) {
      for (let b = a + 1; b < n; b++) {
        const overlap = wanted.get(a * n + b)
        const apart = circles[a]!.r + circles[b]!.r + gap
        let ux = circles[b]!.x - circles[a]!.x
        let uy = circles[b]!.y - circles[a]!.y
        let length = Math.hypot(ux, uy)
        if (overlap === undefined && length >= apart) continue
        if (length < 1e-9) {
          ux = Math.cos(a + b)
          uy = Math.sin(a + b)
          length = 1
        }
        const move = (length - (overlap ?? apart)) / 2 / length
        dx[a]! += ux * move
        dy[a]! += uy * move
        dx[b]! -= ux * move
        dy[b]! -= uy * move
        pulls[a]!++
        pulls[b]!++
      }
    }
    for (let i = 0; i < n; i++) {
      if (pulls[i] === 0) continue
      circles[i]!.x += dx[i]! / pulls[i]!
      circles[i]!.y += dy[i]! / pulls[i]!
    }
  }
  return circles
}

// The outline of the region all the given circles share, as an SVG path, or '' if they share none.
export function regionPath(circles: Circle[], format: (value: number) => string): string {
  const whole = (c: Circle): string => `M${format(c.x - c.r)},${format(c.y)}A${format(c.r)},${format(c.r)} 0 1 1 ${format(c.x + c.r)},${format(c.y)}A${format(c.r)},${format(c.r)} 0 1 1 ${format(c.x - c.r)},${format(c.y)}Z`
  if (circles.length === 1) return whole(circles[0]!)
  const within = (x: number, y: number, skip: Circle | undefined, other: Circle | undefined): boolean => {
    for (const c of circles) {
      if (c !== skip && c !== other && Math.hypot(x - c.x, y - c.y) > c.r * (1 + 1e-9)) return false
    }
    return true
  }
  // The corners of the region: where two outlines cross inside all the other circles.
  const corners: { x: number; y: number; a: Circle; b: Circle }[] = []
  for (let i = 0; i < circles.length; i++) {
    for (let j = i + 1; j < circles.length; j++) {
      const a = circles[i]!
      const b = circles[j]!
      const d = Math.hypot(b.x - a.x, b.y - a.y)
      if (d >= a.r + b.r || d <= Math.abs(a.r - b.r) || d === 0) continue
      const along = (a.r * a.r - b.r * b.r + d * d) / (2 * d)
      const up = Math.sqrt(Math.max(a.r * a.r - along * along, 0))
      const mx = a.x + ((b.x - a.x) * along) / d
      const my = a.y + ((b.y - a.y) * along) / d
      for (const sign of [1, -1]) {
        const x = mx + (sign * up * (b.y - a.y)) / d
        const y = my - (sign * up * (b.x - a.x)) / d
        if (within(x, y, a, b)) corners.push({ x, y, a, b })
      }
    }
  }
  if (corners.length < 2) {
    // No corners: either one circle lies inside all the others, or there is nothing shared.
    let smallest = circles[0]!
    for (const c of circles) if (c.r < smallest.r) smallest = c
    for (const c of circles) {
      if (c !== smallest && Math.hypot(c.x - smallest.x, c.y - smallest.y) + smallest.r > c.r * (1 + 1e-9)) return ''
    }
    return whole(smallest)
  }
  let cx = 0
  let cy = 0
  for (const p of corners) {
    cx += p.x / corners.length
    cy += p.y / corners.length
  }
  corners.sort((p, q) => Math.atan2(p.y - cy, p.x - cx) - Math.atan2(q.y - cy, q.x - cx))
  let d = ''
  for (let i = 0; i < corners.length; i++) {
    const from = corners[i]!
    const to = corners[(i + 1) % corners.length]!
    if (i === 0) d = `M${format(from.x)},${format(from.y)}`
    // The side between two corners is an arc of a circle that passes through both; of those, the
    // one whose arc stays inside the others.
    let arc: Circle | undefined
    let large = 0
    let narrowest = Infinity
    for (const c of [from.a, from.b]) {
      if (c !== to.a && c !== to.b) continue
      const start = Math.atan2(from.y - c.y, from.x - c.x)
      let sweep = Math.atan2(to.y - c.y, to.x - c.x) - start
      if (sweep <= 0) sweep += TAU
      const mx = c.x + c.r * Math.cos(start + sweep / 2)
      const my = c.y + c.r * Math.sin(start + sweep / 2)
      const width = Math.hypot(mx - (from.x + to.x) / 2, my - (from.y + to.y) / 2)
      if (width < narrowest) {
        narrowest = width
        arc = c
        large = sweep > Math.PI ? 1 : 0
      }
    }
    if (arc === undefined) d += `L${format(to.x)},${format(to.y)}`
    else d += `A${format(arc.r)},${format(arc.r)} 0 ${large} 1 ${format(to.x)},${format(to.y)}`
  }
  return d + 'Z'
}
