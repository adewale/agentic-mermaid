// ============================================================================
// HybridBackend (SPEC §3.2/§11 phase 4) — rough.js composition plus the
// native marks rough.js does not provide: pressure-sensitive perfect-freehand
// ribbons (variable-width filled outlines from a jittered centerline) and
// watercolor washes (translucent glaze + edge darkening, Curtis '97 in cheap
// form). Everything else — role policy, halos, marker carriers, defs — is the
// shared sketch walker from rough-backend.ts; geometries the native marks
// can't express (arbitrary paths) fall back to rough.js.
//
// Deterministic per the §8 substream contract: the centerline sampler and
// wash jitter draw only from nodeSeed-derived mulberry32 streams.
// ============================================================================

import { getStroke } from 'perfect-freehand'
import type { Geometry } from './ir.ts'
import { registerBackend } from './backend.ts'
import { createSketchBackend, sketchGeometryRough } from './rough-backend.ts'
import type { GeometrySketcher } from './rough-backend.ts'
import { makeRng } from './seed.ts'

const r3 = (n: number) => Math.round(n * 1000) / 1000
const lerp = (a: number, b: number, t: number) => a + (b - a) * t
const clamp01 = (t: number) => Math.max(0, Math.min(1, t))

type Pt = { x: number; y: number }

/** Convert closed geometries to a polygon for freehand/wash rendering.
 *  Returns null when the geometry can't be polygonized cheaply (paths). */
function polygonize(geom: Geometry): Pt[] | null {
  switch (geom.kind) {
    case 'rect':
      return [
        { x: geom.x, y: geom.y },
        { x: geom.x + geom.width, y: geom.y },
        { x: geom.x + geom.width, y: geom.y + geom.height },
        { x: geom.x, y: geom.y + geom.height },
      ]
    case 'polygon':
      return geom.points
    case 'circle': {
      const out: Pt[] = []
      for (let i = 0; i < 24; i++) {
        const a = (i / 24) * Math.PI * 2
        out.push({ x: geom.cx + Math.cos(a) * geom.r, y: geom.cy + Math.sin(a) * geom.r })
      }
      return out
    }
    case 'ellipse': {
      const out: Pt[] = []
      for (let i = 0; i < 28; i++) {
        const a = (i / 28) * Math.PI * 2
        out.push({ x: geom.cx + Math.cos(a) * geom.rx, y: geom.cy + Math.sin(a) * geom.ry })
      }
      return out
    }
    default:
      return null
  }
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

/** Resample a polyline/polygon into a jittered, pressure-annotated centerline
 *  (ported from the prototype's engine.ts, behavior unchanged). */
function sampledCenterline(pts: Pt[], rng: () => number, closed: boolean, wobble: number): [number, number, number][] {
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
      const p = { x: lerp(a.x, b.x, t) + nx * jitter, y: lerp(a.y, b.y, t) + ny * jitter }
      const phase = (i + t) / Math.max(1, src.length - 1)
      const pressure = clamp01(0.52 + Math.sin(phase * Math.PI * 2) * 0.12 + (rng() - 0.5) * 0.16)
      out.push([p.x, p.y, pressure])
    }
  }
  const last = src[src.length - 1]!
  out.push([last.x, last.y, closed ? out[0]?.[2] ?? 0.55 : 0.46])
  return out
}

function freehandStroke(pts: Pt[], rng: () => number, o: { width: number; closed: boolean }): string {
  if (pts.length < 2) return ''
  const input = sampledCenterline(pts, rng, o.closed, 1)
  const outline = getStroke(input, {
    size: o.width,
    thinning: 0.58,
    smoothing: 0.62,
    streamline: 0.35,
    simulatePressure: false,
    start: { cap: true, taper: o.closed ? 0 : 10 },
    end: { cap: true, taper: o.closed ? 0 : 14 },
    last: true,
  }) as number[][]
  return strokePathFromOutline(outline)
}

/** Watercolor wash: wobbled translucent fill + edge-darkening stroke. */
function watercolorWash(poly: Pt[], rng: () => number, fill: string, opacity: number, edge: number): string {
  const wob = poly.map(p => ({ x: p.x + (rng() - 0.5) * 3, y: p.y + (rng() - 0.5) * 3 }))
  const d = wob.map((p, i) => `${i ? 'L' : 'M'}${r3(p.x)},${r3(p.y)}`).join(' ') + ' Z'
  return (
    `<path d="${d}" fill="${fill}" fill-opacity="${opacity}" stroke="none" />` +
    `\n<path d="${d}" fill="none" stroke="${fill}" stroke-width="1.4" stroke-opacity="${edge}" />`
  )
}

/** The hybrid sketcher: freehand ribbons when the style asks for them, wash
 *  fills under the outline; null falls back to rough.js in the walker. */
const hybridSketcher: GeometrySketcher = (geom, opts) => {
  const strokeKind = opts.style?.stroke ?? 'jittered'
  const fillKind = opts.style?.fill ?? 'none'
  const wantsWash = fillKind === 'wash' && opts.fill !== undefined
  const wantsFreehand = strokeKind === 'freehand'
  if (!wantsWash && !wantsFreehand) return null

  const parts: string[] = []
  if (wantsWash) {
    const rng = makeRng((opts.seed ^ 0x9e3779b9) >>> 0)
    const poly = geom.kind === 'path' ? null : polygonize(geom)
    if (poly) {
      parts.push(watercolorWash(poly, rng, opts.fill!, opts.style?.washOpacity ?? 0.3, opts.style?.washEdge ?? 0.34))
    } else if (geom.kind === 'path') {
      // Arbitrary paths (pie wedges): translucent glaze on the exact path.
      parts.push(`<path d="${geom.d}" fill="${opts.fill}" fill-opacity="${opts.style?.washOpacity ?? 0.3}" stroke="${opts.fill}" stroke-width="1.4" stroke-opacity="${opts.style?.washEdge ?? 0.34}" />`)
    }
  }

  // Dashed/dotted connectors keep their dash semantics: a filled ribbon
  // cannot carry stroke-dasharray, so they fall through to the rough stroke.
  if (wantsFreehand && !opts.dash) {
    const rng = makeRng(opts.seed || 1)
    const width = Math.max(2.5, opts.width * 2.2)
    let ribbon = ''
    if (geom.kind === 'polyline') {
      ribbon = freehandStroke(geom.points, rng, { width, closed: false })
    } else if (geom.kind === 'line') {
      ribbon = freehandStroke([{ x: geom.x1, y: geom.y1 }, { x: geom.x2, y: geom.y2 }], rng, { width, closed: false })
    } else {
      const poly = polygonize(geom)
      if (poly) ribbon = freehandStroke(poly, rng, { width, closed: true })
    }
    if (ribbon) {
      parts.push(`<path d="${ribbon}" fill="${opts.stroke}" stroke="none" />`)
      return parts.join('\n')
    }
  }

  // Outline falls back to rough (jittered); wash already drew the fill.
  const outline = sketchGeometryRough(geom, opts.seed, opts.stroke, opts.width, wantsWash ? undefined : opts.fill, opts.p, opts.dash)
  if (outline) parts.push(outline)
  return parts.length > 0 ? parts.join('\n') : null
}

export const HybridBackend = createSketchBackend('hybrid', hybridSketcher)

registerBackend(HybridBackend)
