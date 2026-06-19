// ============================================================================
// rough.js adapter — plugs the battle-tested hand-drawn engine into our
// strategy seam, headlessly (no DOM/canvas) and deterministically.
//
// RoughGenerator returns a Drawable whose `.sets` are OpSets of three kinds:
//   'path'       → the sketchy outline      → stroke it
//   'fillPath'   → a solid fill region      → fill it
//   'fillSketch' → hachure/cross-hatch fill → stroke it (in the fill colour)
// We serialize each via gen.opsToPath() into our own <path> elements so we keep
// control of attributes (CSS-var theming, filters) and resvg-safety.
//
// Determinism: every call takes an explicit integer `seed`; rough's PRNG is a
// pure function of it. (Pin roughjs version so seeded output is stable.)
// ============================================================================

import { RoughGenerator } from 'roughjs/bin/generator'
import type { Point } from './rough.ts'

const gen = new RoughGenerator()

export interface RoughOpts {
  seed: number
  roughness: number
  bowing?: number
  stroke: string
  strokeWidth: number
  linecap?: string
  strokeOpacity?: number
  strokeFilter?: string
  passes?: number        // 1 ⇒ single stroke (disableMultiStroke)
  // fill (optional)
  fill?: string
  fillStyle?: string     // 'hachure' | 'cross-hatch' | 'dots' | 'zigzag' | 'solid'
  fillWeight?: number
  fillOpacity?: number
  hachureGap?: number
  hachureAngle?: number
}

function toOptions(o: RoughOpts) {
  return {
    seed: o.seed,
    roughness: o.roughness,
    bowing: o.bowing ?? 1,
    stroke: o.stroke,
    strokeWidth: o.strokeWidth,
    disableMultiStroke: (o.passes ?? 2) < 2,
    fill: o.fill,
    fillStyle: o.fillStyle,
    fillWeight: o.fillWeight,
    hachureGap: o.hachureGap,
    hachureAngle: o.hachureAngle,
    preserveVertices: false,
  }
}

function render(sets: { type: string; ops: any[] }[], o: RoughOpts, opts: { outline?: boolean; fill?: boolean } = { outline: true, fill: true }): string {
  const filter = o.strokeFilter ? ` filter="url(#${o.strokeFilter})"` : ''
  const sop = o.strokeOpacity != null ? ` stroke-opacity="${o.strokeOpacity}"` : ''
  const cap = o.linecap ?? 'round'
  const out: string[] = []
  for (const set of sets) {
    const d = gen.opsToPath(set as any, 2)
    if (!d) continue
    if (set.type === 'path' && opts.outline) {
      out.push(`<path d="${d}" fill="none" stroke="${o.stroke}" stroke-width="${o.strokeWidth}" stroke-linecap="${cap}"${sop}${filter}/>`)
    } else if (set.type === 'fillPath' && opts.fill) {
      out.push(`<path d="${d}" fill="${o.fill}" fill-opacity="${o.fillOpacity ?? 1}" stroke="none"/>`)
    } else if (set.type === 'fillSketch' && opts.fill) {
      out.push(`<path d="${d}" fill="none" stroke="${o.fill}" stroke-width="${o.fillWeight ?? 1}" opacity="${o.fillOpacity ?? 1}"/>`)
    }
  }
  return out.join('')
}

const pts = (p: Point[]) => p.map(q => [q.x, q.y] as [number, number])

/** Sketchy closed polygon outline (no fill). */
export function roughPolyOutline(poly: Point[], o: RoughOpts): string {
  return render(gen.polygon(pts(poly), toOptions(o)).sets, o, { outline: true, fill: false })
}
/** Sketchy hachure/cross-hatch fill for a polygon (no outline). */
export function roughPolyFill(poly: Point[], o: RoughOpts): string {
  return render(gen.polygon(pts(poly), toOptions({ ...o, fill: o.fill ?? o.stroke })).sets, o, { outline: false, fill: true })
}
/** Sketchy open path through points (edges/connectors). */
export function roughOpen(points: Point[], o: RoughOpts): string {
  return render(gen.linearPath(pts(points), toOptions(o)).sets, o, { outline: true, fill: false })
}
/**
 * Roughen an ARBITRARY SVG path `d` (pie wedges, cylinders, curved edges) —
 * the thing our regex prototype could not handle. Outline + optional fill.
 */
export function roughPathD(d: string, o: RoughOpts): string {
  try {
    return render(gen.path(d, toOptions(o)).sets, o)
  } catch {
    return '' // malformed/unsupported path command → caller keeps original
  }
}
