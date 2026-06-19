// ============================================================================
// restyle(): turn a normally-rendered Mermaid SVG into a hand-rendered one,
// dispatching through the four pluggable strategies named by a Style.
//
// Prototype shortcut: we post-process the SVG the real renderer emits (walk
// rect/circle/ellipse/polygon/polyline/line). The SPEC describes pushing the
// same Style into the renderer's primitive emitters instead. Deterministic:
// every element seeds its PRNG from its rounded coordinates.
// ============================================================================

import { type Point } from './rough.ts'
import {
  makeRng, brushStroke, brushPolygon,
  stipple, halftone, watercolorWash, hachureLines,
} from './engine.ts'
import { roughPolyOutline, roughPolyFill, roughOpen, roughPathD } from './rough-adapter.ts'
import { area } from './engine.ts'
import { adjustToContrast, WCAG } from './contrast.ts'
import type { Style } from './styles.ts'

const lerp = (a: number, b: number, t: number) => a + (b - a) * t
// Don't shade regions smaller than this — keeps edge/transition-label boxes and
// tiny nodes clean so their text stays legible (an "indication"-style guard).
const MIN_FILL_AREA = 2700

const num = (s: string | undefined, d = 0) => (s == null ? d : parseFloat(s))
const attr = (t: string, n: string): string | undefined => t.match(new RegExp(`\\b${n}="([^"]*)"`))?.[1]
const seedAt = (...n: number[]) => (Math.round(n.reduce((a, b) => a * 31 + b, 7)) >>> 0) || 1
const r3 = (n: number) => Math.round(n * 1000) / 1000

function lum(hex?: string): number | null {
  if (!hex || hex === 'none' || hex === 'transparent' || hex[0] !== '#') return null
  const h = hex.slice(1)
  const f = h.length === 3 ? h.split('').map(c => c + c).join('') : h
  const r = parseInt(f.slice(0, 2), 16), g = parseInt(f.slice(2, 4), 16), b = parseInt(f.slice(4, 6), 16)
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255
}
function circlePoly(cx: number, cy: number, rx: number, ry: number, n = 24): Point[] {
  return Array.from({ length: n }, (_, i) => ({ x: cx + Math.cos((i / n) * 2 * Math.PI) * rx, y: cy + Math.sin((i / n) * 2 * Math.PI) * ry }))
}
function parsePts(s: string): Point[] {
  return s.trim().split(/\s+/).map(p => { const [x, y] = p.split(',').map(Number); return { x: x!, y: y! } }).filter(p => Number.isFinite(p.x) && Number.isFinite(p.y))
}
function toneFor(st: Style, fillSrc?: string): number {
  let t = st.baseTone
  if (st.toneFromLuminance) { const l = lum(fillSrc); if (l != null) t = Math.max(t, 1 - l) }
  return Math.max(0, Math.min(1, t))
}

// --- stroke strategies ------------------------------------------------------
function strokeWrap(d: string, color: string, st: Style, fillRibbon = false): string {
  const f = st.strokeFilter ? ` filter="url(#${st.strokeFilter})"` : ''
  const op = st.strokeOpacity != null ? ` stroke-opacity="${st.strokeOpacity}"` : ''
  const mis = st.misregister
    ? `<path d="${d}" transform="translate(${st.misregister},${st.misregister})" ${fillRibbon ? `fill="${st.misColor}" fill-opacity="0.7" stroke="none"` : `fill="none" stroke="${st.misColor}" stroke-opacity="0.7" stroke-width="${st.strokeWidth}"`}/>`
    : ''
  const main = fillRibbon
    ? `<path d="${d}" fill="${color}" stroke="none"${op}${f}/>`
    : `<path d="${d}" fill="none" stroke="${color}" stroke-width="${st.strokeWidth}" stroke-linecap="${st.linecap}"${op}${f}/>`
  return mis + main
}
// Shared rough.js option bundle for a style.
function roughOpts(st: Style, color: string, seed: number) {
  return {
    seed, roughness: st.roughness, bowing: 1, stroke: color, strokeWidth: st.strokeWidth,
    linecap: st.linecap, strokeOpacity: st.strokeOpacity, strokeFilter: st.strokeFilter, passes: st.passes,
  }
}
function strokeClosed(poly: Point[], color: string, st: Style, seed: number): string {
  // brush is native (tapered ribbons rough.js can't do); everything else → rough.js
  if (st.stroke === 'brush') return brushPolygon(poly, makeRng(seed), { width: st.brushWidth ?? st.strokeWidth * 2, wobble: st.roughness }).map(d => strokeWrap(d, color, st, true)).join('')
  return roughPolyOutline(poly, roughOpts(st, color, seed))
}
function strokeOpen(pts: Point[], color: string, st: Style, seed: number, dash?: string): string {
  if (st.stroke === 'brush') return pts.slice(1).map((p, i) => strokeWrap(brushStroke(pts[i]!, p, makeRng(seed), { width: (st.brushWidth ?? st.strokeWidth * 2) * 0.7, wobble: st.roughness }), color, st, true)).join('')
  return roughOpen(pts, roughOpts(st, color, seed))
}

// --- fill strategies (tone-driven) -----------------------------------------
function fillRegion(poly: Point[], fillSrc: string | undefined, st: Style, seed: number): string {
  if (st.fill === 'none') return ''
  const tone = toneFor(st, fillSrc)
  if (tone <= 0.001) return ''
  const rng = makeRng(seed ^ 0x9e3779b9)
  const ink = st.keepHue && lum(fillSrc) != null ? fillSrc! : st.fillColor
  switch (st.fill) {
    case 'hachure':
      // rough.js hachure; tone drives gap (density). Cross-hatch when dark.
      return roughPolyFill(poly, {
        seed: seed ^ 0x51, roughness: st.roughness, stroke: ink, strokeWidth: st.strokeWidth,
        fill: ink, fillStyle: tone > 0.55 ? 'cross-hatch' : 'hachure',
        fillWeight: Math.max(0.6, st.strokeWidth * 0.45), hachureGap: lerp(11, 4, tone),
        hachureAngle: st.hachureAngle, fillOpacity: 0.5 + 0.4 * tone, passes: 1,
      })
    case 'crosshatch':
      return roughPolyFill(poly, {
        seed: seed ^ 0x51, roughness: st.roughness, stroke: ink, strokeWidth: st.strokeWidth,
        fill: ink, fillStyle: 'cross-hatch', fillWeight: 0.7, hachureGap: lerp(6, 3, tone),
        hachureAngle: st.hachureAngle, fillOpacity: 0.8, passes: 1,
      })
    case 'scribble': {
      // loose multi-pass hachure at varying angles → crayon/chalk shading
      const g = 6 - 3 * tone
      const d = [st.hachureAngle, st.hachureAngle + 12, st.hachureAngle - 9].map(a => hachureLines(poly, a, g, rng)).join(' ')
      return `<path d="${d}" stroke="${ink}" stroke-width="${st.strokeWidth * 0.7}" fill="none" opacity="${0.4 + 0.4 * tone}"${st.strokeFilter ? ` filter="url(#${st.strokeFilter})"` : ''}/>`
    }
    case 'stipple':
      // cap density so dots never bury the label text underneath
      return `<path d="${stipple(poly, Math.min(tone, 0.5), rng, { density: 0.013 })}" fill="${ink}" stroke="none"/>`
    case 'halftone':
      return `<path d="${halftone(poly, Math.min(tone, 0.55), 8, st.hachureAngle)}" fill="${ink}" stroke="none"/>`
    case 'wash':
      return watercolorWash(poly, rng, ink, { opacity: st.name === 'watercolor' ? 0.26 : 0.12 + 0.5 * tone, edge: st.name === 'watercolor' ? 0.3 : 0.18 })
    case 'solid': {
      // flat spot-colour separation (screenprint). Pick a colour from the spot
      // palette per region (seeded) for the limited-palette look.
      const color = st.spotPalette?.length ? st.spotPalette[Math.abs(seed) % st.spotPalette.length]! : ink
      const d = poly.map((p, i) => `${i ? 'L' : 'M'}${r3(p.x)},${r3(p.y)}`).join(' ') + ' Z'
      const ff = st.fillFilter ? ` filter="url(#${st.fillFilter})"` : ''
      return `<path d="${d}" fill="${color}" fill-opacity="0.95" stroke="none"${ff}/>`
    }
    default: return ''
  }
}

// --- element transforms -----------------------------------------------------
function closedShape(poly: Point[], stroke: string | undefined, fill: string | undefined, st: Style, seed: number): string {
  if (stroke === 'none' && (!fill || fill === 'none')) return ''
  const sc = stroke && stroke !== 'none' ? stroke : st.colors.line
  const big = area(poly) >= MIN_FILL_AREA
  // Offset drop-glow behind the filled shape (screenprint registration look).
  const glow = st.glowColor && big
    ? `<path d="${poly.map((p, i) => `${i ? 'L' : 'M'}${r3(p.x + (st.glowOffset ?? 5))},${r3(p.y + (st.glowOffset ?? 5))}`).join(' ')} Z" fill="${st.glowColor}" stroke="none"/>`
    : ''
  const fillStr = big ? fillRegion(poly, fill, st, seed) : ''
  return glow + fillStr + (stroke === 'none' ? '' : strokeClosed(poly, sc, st, seed))
}

export function restyle(svg: string, st: Style, opts: { backdrop?: boolean } = {}): string {
  const defsEnd = svg.indexOf('</defs>')
  const splitAt = defsEnd >= 0 ? defsEnd + 7 : svg.indexOf('>') + 1
  const head = svg.slice(0, splitAt)
  let body = svg.slice(splitAt).replace('</svg>', '')

  if (st.stroke !== 'crisp') {
    body = body
      // FIRST: arbitrary <path> shapes (pie wedges, cylinders, curved series) —
      // the gap the regex prototype left un-styled. rough.js handles any `d`.
      // Runs before the shape→<path> rewrites below so it only sees originals.
      .replace(/<path\b[^>]*\/>/g, t => {
        const d = attr(t, 'd'); if (!d) return t
        const stroke = attr(t, 'stroke'), fill = attr(t, 'fill')
        const seed = seedAt(d.length, d.charCodeAt(1) || 0, d.charCodeAt(d.length - 1) || 0)
        const hasFill = fill && fill !== 'none' && fill !== 'transparent'
        const r = roughPathD(d, {
          seed, roughness: Math.max(0.6, st.roughness), stroke: stroke && stroke !== 'none' ? stroke : st.colors.line,
          strokeWidth: st.strokeWidth, linecap: st.linecap, passes: 1,
          fill: hasFill ? fill : undefined, fillStyle: st.fill === 'wash' ? 'solid' : 'hachure',
          fillWeight: 0.8, hachureGap: 5, fillOpacity: hasFill ? (st.fill === 'wash' ? 0.5 : 0.85) : undefined,
        })
        return r || t
      })
      .replace(/<rect\b[^>]*\/>/g, t => {
        const x = num(attr(t, 'x')), y = num(attr(t, 'y')), w = num(attr(t, 'width')), h = num(attr(t, 'height'))
        if (!w || !h) return t
        return closedShape([{ x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h }], attr(t, 'stroke'), attr(t, 'fill'), st, seedAt(x, y, w, h))
      })
      .replace(/<circle\b[^>]*\/>/g, t => {
        const cx = num(attr(t, 'cx')), cy = num(attr(t, 'cy')), r = num(attr(t, 'r'))
        return r ? closedShape(circlePoly(cx, cy, r, r), attr(t, 'stroke'), attr(t, 'fill'), st, seedAt(cx, cy, r)) : t
      })
      .replace(/<ellipse\b[^>]*\/>/g, t => {
        const cx = num(attr(t, 'cx')), cy = num(attr(t, 'cy')), rx = num(attr(t, 'rx')), ry = num(attr(t, 'ry'))
        return rx && ry ? closedShape(circlePoly(cx, cy, rx, ry), attr(t, 'stroke'), attr(t, 'fill'), st, seedAt(cx, cy, rx, ry)) : t
      })
      .replace(/<polygon\b[^>]*\/>/g, t => {
        const pts = parsePts(attr(t, 'points') ?? '')
        return pts.length >= 3 ? closedShape(pts, attr(t, 'stroke'), attr(t, 'fill'), st, seedAt(pts[0]!.x, pts[0]!.y, pts.length)) : t
      })
      .replace(/<polyline\b[^>]*\/>/g, t => {
        const pts = parsePts(attr(t, 'points') ?? '')
        return pts.length >= 2 ? strokeOpen(pts, attr(t, 'stroke') ?? st.colors.line, st, seedAt(pts[0]!.x, pts[0]!.y, pts.length), attr(t, 'stroke-dasharray')) : t
      })
      .replace(/<line\b[^>]*\/>/g, t => {
        const a = { x: num(attr(t, 'x1')), y: num(attr(t, 'y1')) }, b = { x: num(attr(t, 'x2')), y: num(attr(t, 'y2')) }
        return strokeOpen([a, b], attr(t, 'stroke') ?? st.colors.line, st, seedAt(a.x, a.y, b.x, b.y), attr(t, 'stroke-dasharray'))
      })
  }

  const vb = head.match(/viewBox="0 0 ([\d.]+) ([\d.]+)"/) || []
  const w = num(vb[1], 800), h = num(vb[2], 600)
  const parts = [head]
  if (st.defs) parts.push(`<defs>${st.defs}</defs>`)

  // WCAG readability guardrail (see contrast.ts). Every label is knocked out to
  // the PAGE colour with a paint-order halo, so it never sits directly on a fill
  // (solid spot colour, dense hachure, dots…). The ink is then chosen to clear
  // 4.5:1 against the page — the surface the halo actually reveals — which makes
  // a single ink choice valid regardless of what's painted behind the glyph.
  // Halo colour defaults to the page; a style may override it (e.g. a dark
  // "chip" behind light text). Ink defaults to auto-contrast against the halo.
  const haloColor = st.labelHalo ?? st.colors.bg
  const ink = st.labelInk ?? adjustToContrast(st.colors.fg, haloColor, WCAG.textAA)
  const halo = `paint-order:stroke;stroke:${haloColor};stroke-width:3.4px;stroke-linejoin:round;`
  parts.push(`<style>text{font-family:'${st.font}',serif !important;fill:${ink} !important;${halo}} .edge-label-halo,.edge-label rect{fill:${st.colors.bg} !important;stroke:none !important;}</style>`)
  if (opts.backdrop !== false) parts.push(backdrop(st, w, h))
  parts.push(body, '</svg>')
  return parts.join('\n')
}

// --- backdrops --------------------------------------------------------------
const rect = (x: number, y: number, w: number, h: number, fill: string) => `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${fill}"/>`
export function backdrop(st: Style, w: number, h: number): string {
  const p: string[] = [rect(0, 0, w, h, st.colors.bg)]
  switch (st.backdrop) {
    case 'paper-ruled':
      for (let y = 40; y < h; y += 26) p.push(`<line x1="0" y1="${y}" x2="${w}" y2="${y}" stroke="#9fc0d8" stroke-width="0.8" opacity="0.45"/>`)
      p.push(`<line x1="42" y1="0" x2="42" y2="${h}" stroke="#d98b8b" stroke-width="0.8" opacity="0.5"/>`)
      break
    case 'grid':
      for (let x = 0; x < w; x += 24) p.push(`<line x1="${x}" y1="0" x2="${x}" y2="${h}" stroke="#bcd6f0" stroke-width="0.5" opacity="0.28"/>`)
      for (let y = 0; y < h; y += 24) p.push(`<line x1="0" y1="${y}" x2="${w}" y2="${y}" stroke="#bcd6f0" stroke-width="0.5" opacity="0.28"/>`)
      break
    case 'slate':
      p.push(`<defs><filter id="sl"><feTurbulence type="fractalNoise" baseFrequency="0.7" numOctaves="2" result="n"/><feColorMatrix in="n" type="matrix" values="0 0 0 0 1 0 0 0 0 1 0 0 0 0 1 0 0 0 0.05 0"/></filter></defs><rect width="${w}" height="${h}" filter="url(#sl)"/>`)
      break
    case 'rice':
    case 'washi':
      p.push(`<defs><filter id="rc"><feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" result="n"/><feColorMatrix in="n" type="matrix" values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0.035 0"/></filter></defs><rect width="${w}" height="${h}" filter="url(#rc)"/>`)
      break
  }
  return p.join('\n')
}
export function seal(w: number, h: number): string {
  const s = 46, x = w - s - 24, y = h - s - 24
  return `<rect x="${x}" y="${y}" width="${s}" height="${s}" rx="4" fill="none" stroke="#b22222" stroke-width="2.5"/>` +
    `<text x="${x + s / 2}" y="${y + s / 2 + 9}" text-anchor="middle" font-family="EB Garamond,serif" font-size="26" fill="#b22222">印</text>`
}
