// ============================================================================
// Seeded "rough" geometry engine (prototype).
//
// Everything here is a PURE function of its inputs + an explicit numeric seed.
// No Math.random(), no Date, no global state. That determinism is the whole
// point: the real repo is snapshot/golden tested, so a hand-drawn backend can
// only ship if the same diagram always produces byte-identical SVG.
//
// Output is always SVG path data ("d" strings) — no DOM, no canvas — so it
// drops straight into renderer.ts's string-concatenation model and rasterizes
// fine under resvg.
// ============================================================================

export interface Point { x: number; y: number }

// --- Seeded PRNG (mulberry32). Tiny, fast, deterministic. ------------------
export function makeRng(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// Hash a string (e.g. a node id) into a stable 32-bit seed.
export function seedFrom(s: string): number {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

const r3 = (n: number) => Math.round(n * 1000) / 1000

export interface RoughOptions {
  roughness?: number   // overall jitter amplitude in px (default 1.5)
  bowing?: number      // how much straight lines bow outward (default 1)
  passes?: number      // how many overlapping strokes per outline (default 2)
}

// A single hand-drawn line A→B, emitted as a slightly bowed cubic with
// jittered endpoints. Drawn `passes` times with a moving seed for the
// characteristic doubled, sketchy stroke.
export function roughLine(a: Point, b: Point, rng: () => number, o: RoughOptions = {}): string {
  const rough = o.roughness ?? 1.5
  const bowing = o.bowing ?? 1
  const passes = o.passes ?? 2
  const len = Math.hypot(b.x - a.x, b.y - a.y) || 1
  // Perpendicular unit vector — jitter is mostly across the line, like a pen.
  const nx = -(b.y - a.y) / len
  const ny = (b.x - a.x) / len
  const j = (amt: number) => (rng() - 0.5) * 2 * amt
  const segs: string[] = []
  for (let p = 0; p < passes; p++) {
    const amp = rough * (p === 0 ? 1 : 0.7) // second pass a touch tighter
    const ax = a.x + j(amp), ay = a.y + j(amp)
    const bx = b.x + j(amp), by = b.y + j(amp)
    // Two control points roughly 1/3 and 2/3 along, pushed off the line so
    // the stroke bows like a freehand pen rather than a ruler.
    const bow = bowing * (rng() - 0.5) * 2 * (len / 50)
    const c1x = a.x + (b.x - a.x) / 3 + nx * bow + j(amp)
    const c1y = a.y + (b.y - a.y) / 3 + ny * bow + j(amp)
    const c2x = a.x + (2 * (b.x - a.x)) / 3 + nx * bow + j(amp)
    const c2y = a.y + (2 * (b.y - a.y)) / 3 + ny * bow + j(amp)
    segs.push(`M${r3(ax)},${r3(ay)} C${r3(c1x)},${r3(c1y)} ${r3(c2x)},${r3(c2y)} ${r3(bx)},${r3(by)}`)
  }
  return segs.join(' ')
}

// Closed polygon outline, drawn as a chain of rough lines. Corners overshoot
// slightly (start before / end after each vertex) for that "didn't lift the
// pen" look.
export function roughPolygon(pts: Point[], rng: () => number, o: RoughOptions = {}): string {
  const out: string[] = []
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i]!
    const b = pts[(i + 1) % pts.length]!
    out.push(roughLine(a, b, rng, o))
  }
  return out.join(' ')
}

export function roughRect(x: number, y: number, w: number, h: number, rng: () => number, o?: RoughOptions): string {
  return roughPolygon(
    [{ x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h }],
    rng, o,
  )
}

// --- Hachure fill ----------------------------------------------------------
// Parallel pen strokes that read as "shading". See the engine notes for the
// scanline algorithm. Returns path data for the fill lines (no outline).
export function hachureFill(
  poly: Point[],
  rng: () => number,
  opts: { angleDeg?: number; gap?: number; roughness?: number } = {},
): string {
  const angle = ((opts.angleDeg ?? -41) * Math.PI) / 180
  const gap = Math.max(2, opts.gap ?? 6)
  const rough = opts.roughness ?? 0.8
  const cos = Math.cos(-angle), sin = Math.sin(-angle)
  // Rotate polygon into a frame where hachure lines are horizontal.
  const rot = poly.map(p => ({ x: p.x * cos - p.y * sin, y: p.x * sin + p.y * cos }))
  const ys = rot.map(p => p.y)
  const minY = Math.min(...ys), maxY = Math.max(...ys)
  const ucos = Math.cos(angle), usin = Math.sin(angle) // inverse rotation
  const lines: string[] = []
  // Phase-shift the first scanline by a fraction of the gap so the pattern
  // isn't identical across same-sized shapes.
  for (let yy = minY + gap * (0.3 + rng() * 0.4); yy < maxY; yy += gap) {
    // Find x-crossings of this horizontal scanline with each polygon edge.
    const xs: number[] = []
    for (let i = 0; i < rot.length; i++) {
      const a = rot[i]!, b = rot[(i + 1) % rot.length]!
      const lo = Math.min(a.y, b.y), hi = Math.max(a.y, b.y)
      if (yy < lo || yy >= hi) continue
      const t = (yy - a.y) / (b.y - a.y)
      xs.push(a.x + t * (b.x - a.x))
    }
    xs.sort((p, q) => p - q)
    // Fill between intersection pairs (handles convex + simple concave shapes).
    for (let i = 0; i + 1 < xs.length; i += 2) {
      const x1 = xs[i]!, x2 = xs[i + 1]!
      // Rotate the two endpoints back into diagram space.
      const a = { x: x1 * ucos - yy * usin, y: x1 * usin + yy * ucos }
      const b = { x: x2 * ucos - yy * usin, y: x2 * usin + yy * ucos }
      lines.push(roughLine(a, b, rng, { roughness: rough, bowing: 0.4, passes: 1 }))
    }
  }
  return lines.join(' ')
}

// Cross-hatch = two hachure passes at different angles (used by pen-and-ink).
export function crosshatchFill(
  poly: Point[], rng: () => number,
  opts: { angleDeg?: number; gap?: number; roughness?: number } = {},
): string {
  const a = opts.angleDeg ?? -41
  return hachureFill(poly, rng, opts) + ' ' + hachureFill(poly, rng, { ...opts, angleDeg: a + 90 })
}

// --- Hand-drawn arrowhead --------------------------------------------------
// Two short rough strokes forming an open "V" at `tip`, opening back along
// `angle` (radians, the direction the edge is travelling toward the tip).
export function roughArrowhead(tip: Point, angle: number, rng: () => number, size = 12): string {
  const spread = 0.5 // radians
  const back = angle + Math.PI
  const p1 = { x: tip.x + Math.cos(back + spread) * size, y: tip.y + Math.sin(back + spread) * size }
  const p2 = { x: tip.x + Math.cos(back - spread) * size, y: tip.y + Math.sin(back - spread) * size }
  return roughLine(p1, tip, rng, { roughness: 1, passes: 1 }) + ' ' +
         roughLine(p2, tip, rng, { roughness: 1, passes: 1 })
}
