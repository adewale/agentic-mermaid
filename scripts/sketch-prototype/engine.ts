// ============================================================================
// Advanced NPR primitives (prototype) — the literature-derived upgrades.
//
// Builds on rough.ts. Everything stays a PURE, SEEDED function returning SVG
// path/element strings (no DOM), so it remains byte-deterministic for goldens.
//
// Implements, in cheap prototype form:
//   - blue-noise (best-candidate) sampling           [Secord-adjacent]
//   - tonal hachure: density+direction encode tone    [Winkenbach/Salesin; Praun TAM]
//   - stipple fill (dot density ~ tone)               [Secord]
//   - halftone fill (dot radius ~ tone)               [Ben-Day]
//   - tapered "ribbon" brush strokes (pressure)       [sumi-e footprint]
//   - watercolor wash: layered glaze + edge-darkening [Curtis]
//   - observational line tweaks (length-damped bow)   [rough.js / pencil-line]
// ============================================================================

import { getStroke } from 'perfect-freehand'
import { makeRng, type Point } from './rough.ts'

const r3 = (n: number) => Math.round(n * 1000) / 1000
const lerp = (a: number, b: number, t: number) => a + (b - a) * t
const clamp01 = (t: number) => Math.max(0, Math.min(1, t))

// --- geometry helpers -------------------------------------------------------
export function bbox(poly: Point[]) {
  const xs = poly.map(p => p.x), ys = poly.map(p => p.y)
  return { minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys) }
}
export function area(poly: Point[]): number {
  let a = 0
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i]!, q = poly[(i + 1) % poly.length]!
    a += p.x * q.y - q.x * p.y
  }
  return Math.abs(a) / 2
}
export function pointInPoly(pt: Point, poly: Point[]): boolean {
  let inside = false
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i]!, b = poly[j]!
    if ((a.y > pt.y) !== (b.y > pt.y) && pt.x < ((b.x - a.x) * (pt.y - a.y)) / (b.y - a.y) + a.x) inside = !inside
  }
  return inside
}

// Best-candidate blue-noise points inside a polygon. Deterministic given seed.
export function blueNoise(poly: Point[], n: number, rng: () => number, candidates = 8): Point[] {
  const bb = bbox(poly)
  const pts: Point[] = []
  let guard = 0
  while (pts.length < n && guard++ < n * 40) {
    let best: Point | null = null, bestD = -1
    for (let c = 0; c < candidates; c++) {
      const p = { x: lerp(bb.minX, bb.maxX, rng()), y: lerp(bb.minY, bb.maxY, rng()) }
      if (!pointInPoly(p, poly)) continue
      let d = Infinity
      for (const q of pts) { const dd = (p.x - q.x) ** 2 + (p.y - q.y) ** 2; if (dd < d) d = dd }
      if (d > bestD) { bestD = d; best = p }
    }
    if (best) pts.push(best)
  }
  return pts
}

// --- observational line (improved roughLine) -------------------------------
// Bowing scales with length but is DAMPENED so long lines don't over-curve
// (rough.js insight). Drawn `passes` times.
export function inkLine(a: Point, b: Point, rng: () => number, o: { roughness?: number; passes?: number; cap?: number } = {}): string {
  const rough = o.roughness ?? 1.4
  const passes = o.passes ?? 2
  const len = Math.hypot(b.x - a.x, b.y - a.y) || 1
  const nx = -(b.y - a.y) / len, ny = (b.x - a.x) / len
  // Dampened amplitude: grows with sqrt(len), capped.
  const amp = Math.min(rough * (0.6 + Math.sqrt(len) / 14), rough * 2.2)
  const j = (m: number) => (rng() - 0.5) * 2 * m
  const out: string[] = []
  for (let p = 0; p < passes; p++) {
    const k = p === 0 ? 1 : 0.7
    const bow = (rng() - 0.5) * 2 * (len / 55) * k
    const ax = a.x + j(amp * k), ay = a.y + j(amp * k)
    const bx = b.x + j(amp * k), by = b.y + j(amp * k)
    const c1x = a.x + (b.x - a.x) * (1 / 3) + nx * bow + j(amp * k)
    const c1y = a.y + (b.y - a.y) * (1 / 3) + ny * bow + j(amp * k)
    const c2x = a.x + (b.x - a.x) * (2 / 3) + nx * bow + j(amp * k)
    const c2y = a.y + (b.y - a.y) * (2 / 3) + ny * bow + j(amp * k)
    out.push(`M${r3(ax)},${r3(ay)} C${r3(c1x)},${r3(c1y)} ${r3(c2x)},${r3(c2y)} ${r3(bx)},${r3(by)}`)
  }
  return out.join(' ')
}

// Polygon outline with slight corner OVERSHOOT (pencil-line realism).
export function inkPolygon(poly: Point[], rng: () => number, o: { roughness?: number; passes?: number; overshoot?: number } = {}): string {
  const os = o.overshoot ?? 2.5
  const out: string[] = []
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i]!, b = poly[(i + 1) % poly.length]!
    const len = Math.hypot(b.x - a.x, b.y - a.y) || 1
    const ux = (b.x - a.x) / len, uy = (b.y - a.y) / len
    const ext = os * (0.4 + rng() * 0.6)
    out.push(inkLine({ x: a.x - ux * ext * (rng() < 0.5 ? 1 : 0), y: a.y - uy * ext * (rng() < 0.5 ? 1 : 0) },
                     { x: b.x + ux * ext, y: b.y + uy * ext }, rng, o))
  }
  return out.join(' ')
}

// --- tapered ribbon brush stroke (filled outline, variable width) ----------
function resample(a: Point, b: Point, n: number): Point[] {
  const pts: Point[] = []
  for (let i = 0; i <= n; i++) pts.push({ x: lerp(a.x, b.x, i / n), y: lerp(a.y, b.y, i / n) })
  return pts
}
// width profile: tapers to ~0 at both ends, fattest just past the middle.
function pressure(t: number, w: number): number {
  const s = Math.pow(Math.sin(Math.PI * clamp01(t)), 0.6)
  return w * (0.15 + 0.85 * s)
}
export function brushStroke(a: Point, b: Point, rng: () => number, o: { width?: number; wobble?: number } = {}): string {
  const w = o.width ?? 6, wob = o.wobble ?? 1
  const n = 10
  const mid = resample(a, b, n).map(p => ({ x: p.x + (rng() - 0.5) * 2 * wob, y: p.y + (rng() - 0.5) * 2 * wob }))
  const len = Math.hypot(b.x - a.x, b.y - a.y) || 1
  const nx = -(b.y - a.y) / len, ny = (b.x - a.x) / len
  const left: Point[] = [], right: Point[] = []
  mid.forEach((p, i) => {
    const hw = pressure(i / n, w) / 2 * (0.85 + rng() * 0.3)
    left.push({ x: p.x + nx * hw, y: p.y + ny * hw })
    right.push({ x: p.x - nx * hw, y: p.y - ny * hw })
  })
  const d = [`M${r3(left[0]!.x)},${r3(left[0]!.y)}`]
  for (let i = 1; i < left.length; i++) d.push(`L${r3(left[i]!.x)},${r3(left[i]!.y)}`)
  for (let i = right.length - 1; i >= 0; i--) d.push(`L${r3(right[i]!.x)},${r3(right[i]!.y)}`)
  d.push('Z')
  return d.join(' ')
}
// brush a whole polygon: each edge is its own stroke (calligraphic, gaps at corners)
export function brushPolygon(poly: Point[], rng: () => number, o: { width?: number; wobble?: number } = {}): string[] {
  return poly.map((a, i) => brushStroke(a, poly[(i + 1) % poly.length]!, rng, o))
}

function strokePathFromOutline(outline: number[][]): string {
  if (outline.length < 2) return ''
  const d = [`M${r3(outline[0]![0]!)},${r3(outline[0]![1]!)}`]
  for (let i = 1; i < outline.length; i++) {
    const [x0, y0] = outline[i]!
    const [x1, y1] = outline[(i + 1) % outline.length]!
    d.push(`Q${r3(x0!)},${r3(y0!)} ${r3((x0! + x1!) / 2)},${r3((y0! + y1!) / 2)}`)
  }
  d.push('Z')
  return d.join(' ')
}

function sampledCenterline(pts: Point[], rng: () => number, closed: boolean, wobble: number): [number, number, number][] {
  const src = closed ? [...pts, pts[0]!] : pts
  const out: [number, number, number][] = []
  for (let i = 0; i < src.length - 1; i++) {
    const a = src[i]!, b = src[i + 1]!
    const len = Math.hypot(b.x - a.x, b.y - a.y) || 1
    const steps = Math.max(1, Math.ceil(len / 14))
    const nx = -(b.y - a.y) / len, ny = (b.x - a.x) / len
    for (let j = 0; j < steps; j++) {
      if (i > 0 && j === 0) continue
      const t = j / steps
      const atEnd = !closed && ((i === 0 && j === 0) || (i === src.length - 2 && j === steps))
      const jitter = atEnd ? 0 : (rng() - 0.5) * 2 * wobble
      const p = {
        x: lerp(a.x, b.x, t) + nx * jitter,
        y: lerp(a.y, b.y, t) + ny * jitter,
      }
      const phase = (i + t) / Math.max(1, src.length - 1)
      const pressure = clamp01(0.52 + Math.sin(phase * Math.PI * 2) * 0.12 + (rng() - 0.5) * 0.16)
      out.push([p.x, p.y, pressure])
    }
  }
  const last = src[src.length - 1]!
  out.push([last.x, last.y, closed ? out[0]?.[2] ?? 0.55 : 0.46])
  return out
}

export function freehandStroke(pts: Point[], rng: () => number, o: { width?: number; wobble?: number; closed?: boolean } = {}): string {
  if (pts.length < 2) return ''
  const closed = o.closed ?? false
  const input = sampledCenterline(pts, rng, closed, o.wobble ?? 1)
  const outline = getStroke(input, {
    size: o.width ?? 8,
    thinning: 0.58,
    smoothing: 0.62,
    streamline: 0.35,
    simulatePressure: false,
    start: { cap: true, taper: closed ? 0 : 10 },
    end: { cap: true, taper: closed ? 0 : 14 },
    last: true,
  }) as number[][]
  return strokePathFromOutline(outline)
}

// --- fills ------------------------------------------------------------------
// Tonal hachure: tone in [0,1] selects gap (density) and number of directions.
export function tonalHachure(poly: Point[], tone: number, rng: () => number, o: { baseAngle?: number; minGap?: number; maxGap?: number } = {}): { d: string; passes: number } {
  const t = clamp01(tone)
  const base = o.baseAngle ?? -41
  const gap = lerp(o.maxGap ?? 11, o.minGap ?? 4, t)
  const angles = [base]
  if (t > 0.45) angles.push(base + 90)
  if (t > 0.78) angles.push(base + 45)
  const segs: string[] = []
  for (const ang of angles) segs.push(hachureLines(poly, ang, gap, rng))
  return { d: segs.join(' '), passes: angles.length }
}
// raw scanline hachure for a polygon at angle/gap (jittered single-pass lines)
export function hachureLines(poly: Point[], angleDeg: number, gap: number, rng: () => number): string {
  const angle = (angleDeg * Math.PI) / 180
  const cos = Math.cos(-angle), sin = Math.sin(-angle)
  const rot = poly.map(p => ({ x: p.x * cos - p.y * sin, y: p.x * sin + p.y * cos }))
  const ys = rot.map(p => p.y)
  const minY = Math.min(...ys), maxY = Math.max(...ys)
  const ucos = Math.cos(angle), usin = Math.sin(angle)
  const out: string[] = []
  for (let yy = minY + gap * (0.3 + rng() * 0.4); yy < maxY; yy += gap) {
    const xs: number[] = []
    for (let i = 0; i < rot.length; i++) {
      const a = rot[i]!, b = rot[(i + 1) % rot.length]!
      const lo = Math.min(a.y, b.y), hi = Math.max(a.y, b.y)
      if (yy < lo || yy >= hi) continue
      xs.push(a.x + ((yy - a.y) / (b.y - a.y)) * (b.x - a.x))
    }
    xs.sort((p, q) => p - q)
    for (let i = 0; i + 1 < xs.length; i += 2) {
      const j = (rng() - 0.5) * 1.2
      const p1 = { x: (xs[i]! + j) * ucos - yy * usin, y: (xs[i]! + j) * usin + yy * ucos }
      const p2 = { x: (xs[i + 1]! + j) * ucos - yy * usin, y: (xs[i + 1]! + j) * usin + yy * ucos }
      out.push(inkLine(p1, p2, rng, { roughness: 0.6, passes: 1 }))
    }
  }
  return out.join(' ')
}

// Stipple dots whose COUNT scales with tone and area.
export function stipple(poly: Point[], tone: number, rng: () => number, o: { density?: number; dot?: number } = {}): string {
  const dens = o.density ?? 0.012 // dots per px^2 at full tone
  const n = Math.min(1400, Math.round(area(poly) * dens * clamp01(tone)))
  if (n <= 0) return ''
  const dot = o.dot ?? 0.9
  return blueNoise(poly, n, rng).map(p => `M${r3(p.x)},${r3(p.y)}m${-dot},0a${dot},${dot} 0 1,0 ${dot * 2},0a${dot},${dot} 0 1,0 ${-dot * 2},0`).join('')
}

// Halftone dots on a regular grid, RADIUS scales with tone.
export function halftone(poly: Point[], tone: number, gap: number, angleDeg = 30): string {
  const t = clamp01(tone)
  const bb = bbox(poly)
  const ang = (angleDeg * Math.PI) / 180, c = Math.cos(ang), s = Math.sin(ang)
  const rMax = gap * 0.5
  const out: string[] = []
  for (let gy = bb.minY - gap; gy < bb.maxY + gap; gy += gap) {
    for (let gx = bb.minX - gap; gx < bb.maxX + gap; gx += gap) {
      // rotate grid point about bbox centre
      const cx = (bb.minX + bb.maxX) / 2, cy = (bb.minY + bb.maxY) / 2
      const px = cx + (gx - cx) * c - (gy - cy) * s
      const py = cy + (gx - cx) * s + (gy - cy) * c
      if (!pointInPoly({ x: px, y: py }, poly)) continue
      const r = rMax * Math.sqrt(t)
      if (r < 0.3) continue
      out.push(`M${r3(px)},${r3(py)}m${r3(-r)},0a${r3(r)},${r3(r)} 0 1,0 ${r3(r * 2)},0a${r3(r)},${r3(r)} 0 1,0 ${r3(-r * 2)},0`)
    }
  }
  return out.join('')
}

// Watercolor wash: a wobbly translucent fill + a darker edge-darkening stroke.
export function watercolorWash(poly: Point[], rng: () => number, fill: string, o: { opacity?: number; edge?: number } = {}): string {
  // jitter the polygon outline so the wash has an organic edge
  const wob = poly.map(p => ({ x: p.x + (rng() - 0.5) * 3, y: p.y + (rng() - 0.5) * 3 }))
  const d = wob.map((p, i) => `${i ? 'L' : 'M'}${r3(p.x)},${r3(p.y)}`).join(' ') + ' Z'
  const op = o.opacity ?? 0.22
  return (
    `<path d="${d}" fill="${fill}" fill-opacity="${op}" stroke="none"/>` +
    // edge-darkening: the same outline stroked darker (pigment pools at edges)
    `<path d="${d}" fill="none" stroke="${fill}" stroke-width="1.4" stroke-opacity="${(o.edge ?? 0.28)}"/>`
  )
}

export { makeRng }
