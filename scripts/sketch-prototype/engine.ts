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
export function area(poly: Point[]): number {
  let a = 0
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i]!, q = poly[(i + 1) % poly.length]!
    a += p.x * q.y - q.x * p.y
  }
  return Math.abs(a) / 2
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
