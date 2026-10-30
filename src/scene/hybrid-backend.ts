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
import { createSketchBackend, sketchGeometryRough } from './rough-backend.ts'
import type { GeometrySketcher } from './rough-backend.ts'
import { makeRng } from './seed.ts'
import { escapeAttr } from '../multiline-utils.ts'

const r3 = (n: number) => Math.round(n * 1000) / 1000
const lerp = (a: number, b: number, t: number) => a + (b - a) * t
const clamp01 = (t: number) => Math.max(0, Math.min(1, t))

type Pt = { x: number; y: number }

/** Corner arcs of a rounded rect, clockwise from the top-left arc, so a
 *  rounded or stadium node keeps its rounded silhouette in the polygon. */
function roundedRectOutline(x: number, y: number, w: number, h: number, rx: number, ry: number): Pt[] {
  const out: Pt[] = []
  const corners = [
    { cx: x + rx, cy: y + ry, from: Math.PI },
    { cx: x + w - rx, cy: y + ry, from: Math.PI * 1.5 },
    { cx: x + w - rx, cy: y + h - ry, from: 0 },
    { cx: x + rx, cy: y + h - ry, from: Math.PI * 0.5 },
  ]
  const arcSteps = 6
  for (const c of corners) {
    for (let i = 0; i <= arcSteps; i++) {
      const a = c.from + (i / arcSteps) * (Math.PI / 2)
      out.push({ x: c.cx + Math.cos(a) * rx, y: c.cy + Math.sin(a) * ry })
    }
  }
  return out
}

/** Convert closed geometries to a polygon for freehand/wash rendering.
 *  Returns null when the geometry can't be polygonized cheaply (paths). */
function polygonize(geom: Geometry): Pt[] | null {
  switch (geom.kind) {
    case 'rect': {
      const rx = Math.min(Math.max(0, geom.rx ?? 0), geom.width / 2)
      const ry = Math.min(Math.max(0, geom.ry ?? geom.rx ?? 0), geom.height / 2)
      if (rx >= 0.5 && ry >= 0.5) return roundedRectOutline(geom.x, geom.y, geom.width, geom.height, rx, ry)
      return [
        { x: geom.x, y: geom.y },
        { x: geom.x + geom.width, y: geom.y },
        { x: geom.x + geom.width, y: geom.y + geom.height },
        { x: geom.x, y: geom.y + geom.height },
      ]
    }
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

/** Resample a polyline/polygon into a jittered, pressure-annotated centerline.
 *  Every authored vertex is a sample, so the stroke smoother bends at the
 *  corner instead of cutting it. A closed outline starts and ends mid-edge:
 *  no corner sits on the cap seam, so every corner is drawn the same way. */
function sampledCenterline(pts: Pt[], rng: () => number, closed: boolean, wobble: number): [number, number, number][] {
  let src = pts
  if (closed) {
    const a = pts[0]!, b = pts[1]!
    const seam = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
    src = [seam, ...pts.slice(1), a, seam]
  }
  // A corner is a vertex where the outline turns by more than ~25 degrees;
  // curve samples (circles, arcs) turn less and stay smooth.
  const isCorner = (k: number): boolean => {
    if (k <= 0 || k >= src.length - 1) return false
    const p = src[k - 1]!, q = src[k]!, r = src[k + 1]!
    const ux = q.x - p.x, uy = q.y - p.y, vx = r.x - q.x, vy = r.y - q.y
    const norm = Math.hypot(ux, uy) * Math.hypot(vx, vy)
    return norm > 0 && (ux * vx + uy * vy) / norm < 0.9
  }
  const out: [number, number, number][] = []
  for (let i = 0; i < src.length - 1; i++) {
    const a = src[i]!, b = src[i + 1]!
    const len = Math.hypot(b.x - a.x, b.y - a.y) || 1
    const steps = Math.max(1, Math.ceil(len / 14))
    const nx = -(b.y - a.y) / len, ny = (b.x - a.x) / len
    // Samples hugging a corner keep the streamlined stroke tight on it;
    // without them the smoother rounds a square corner by ~5px.
    const hug = len > 12 ? 2.5 / len : 0
    const ts: number[] = []
    for (let j = 0; j < steps; j++) {
      ts.push(j / steps)
      if (hug && j === 0 && isCorner(i)) ts.push(hug)
    }
    if (hug && isCorner(i + 1)) ts.push(1 - hug)
    for (let j = 0; j < ts.length; j++) {
      const t = ts[j]!
      const atEnd = !closed && i === 0 && j === 0
      const jitter = atEnd ? 0 : (rng() - 0.5) * 2 * wobble
      const p = { x: lerp(a.x, b.x, t) + nx * jitter, y: lerp(a.y, b.y, t) + ny * jitter }
      const phase = (i + t) / Math.max(1, src.length - 1)
      const pressure = clamp01(0.52 + Math.sin(phase * Math.PI * 2) * 0.12 + (rng() - 0.5) * 0.16)
      out.push([p.x, p.y, pressure])
    }
  }
  if (closed) {
    const [x, y, pressure] = out[0]!
    out.push([x, y, pressure])
  } else {
    const last = src[src.length - 1]!
    out.push([last.x, last.y, 0.46])
  }
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
  const fillOpacity = opts.opacity?.fill === undefined ? undefined : Number(opts.opacity.fill)
  const strokeOpacity = opts.opacity?.stroke === undefined ? undefined : Number(opts.opacity.stroke)
  if (!wantsWash && !wantsFreehand) return null

  const parts: string[] = []
  if (wantsWash) {
    const rng = makeRng((opts.seed ^ 0x9e3779b9) >>> 0)
    const poly = geom.kind === 'path' ? null : polygonize(geom)
    if (poly) {
      parts.push(watercolorWash(poly, rng, opts.fill!, fillOpacity ?? opts.style?.washOpacity ?? 0.3, opts.style?.washEdge ?? 0.34))
    } else if (geom.kind === 'path') {
      // Arbitrary paths (pie wedges): translucent glaze on the exact path.
      parts.push(`<path d="${geom.d}" fill="${opts.fill}" fill-opacity="${fillOpacity ?? opts.style?.washOpacity ?? 0.3}" stroke="${opts.fill}" stroke-width="1.4" stroke-opacity="${opts.style?.washEdge ?? 0.34}" />`)
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
      const projectionAttrs = opts.strokeProjection
        ? [
            ...(opts.strokeProjection.opacity !== undefined ? [`opacity="${escapeAttr(String(opts.strokeProjection.opacity))}"`] : []),
            ...(opts.strokeProjection.paintOrder !== undefined ? [`paint-order="${escapeAttr(opts.strokeProjection.paintOrder)}"`] : []),
            ...(opts.strokeProjection.mixBlendMode !== undefined ? [`style="mix-blend-mode:${opts.strokeProjection.mixBlendMode}"`] : []),
          ].join(' ')
        : ''
      // The ribbon is the stroke, drawn as a filled outline.
      const ribbonOpacity = strokeOpacity === undefined ? '' : ` fill-opacity="${escapeAttr(String(strokeOpacity))}"`
      parts.push(`<path d="${ribbon}" fill="${opts.stroke}" stroke="none"${ribbonOpacity}${projectionAttrs ? ` ${projectionAttrs}` : ''} />`)
      return parts.join('\n')
    }
  }

  // Outline falls back to rough (jittered); wash already drew the fill.
  const outline = sketchGeometryRough(
    geom,
    opts.seed,
    opts.stroke,
    opts.width,
    wantsWash ? undefined : opts.fill,
    opts.p,
    opts.dash,
    opts.strokeProjection,
    opts.opacity,
  )
  if (outline) parts.push(outline)
  return parts.length > 0 ? parts.join('\n') : null
}

export const HybridBackend = createSketchBackend('hybrid', hybridSketcher)
