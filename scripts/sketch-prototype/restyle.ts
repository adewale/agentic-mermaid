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
  freehandStroke,
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
// Don't shade huge background plates (chart plot areas, section bands) — they
// read as ground, not shapes; filling them swamps the content.
const MAX_FILL_AREA = 48000

const num = (s: string | undefined, d = 0) => (s == null ? d : parseFloat(s))
const attrName = (n: string) => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const attr = (t: string, n: string): string | undefined => t.match(new RegExp(`(?:^|\\s)${attrName(n)}="([^"]*)"`))?.[1]
const seedAt = (...n: number[]) => (Math.round(n.reduce((a, b) => a * 31 + b, 7)) >>> 0) || 1
const r3 = (n: number) => Math.round(n * 1000) / 1000
const preservedOpenAttrs = ['marker-start', 'marker-mid', 'marker-end', 'stroke-dashoffset'] as const

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
function roundedRectPoly(x: number, y: number, w: number, h: number, rx: number, ry: number): Point[] {
  const crx = Math.min(Math.max(0, rx), w / 2)
  const cry = Math.min(Math.max(0, ry), h / 2)
  if (crx <= 0 || cry <= 0) return [{ x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h }]

  const pts: Point[] = []
  const segments = 5
  const addArc = (cx: number, cy: number, start: number, end: number, includeStart: boolean) => {
    for (let i = includeStart ? 0 : 1; i <= segments; i++) {
      const a = start + ((end - start) * i) / segments
      pts.push({ x: cx + Math.cos(a) * crx, y: cy + Math.sin(a) * cry })
    }
  }
  addArc(x + w - crx, y + cry, -Math.PI / 2, 0, true)
  addArc(x + w - crx, y + h - cry, 0, Math.PI / 2, false)
  addArc(x + crx, y + h - cry, Math.PI / 2, Math.PI, false)
  addArc(x + crx, y + cry, Math.PI, Math.PI * 1.5, false)
  return pts
}
function parsePts(s: string): Point[] {
  return s.trim().split(/\s+/).map(p => { const [x, y] = p.split(',').map(Number); return { x: x!, y: y! } }).filter(p => Number.isFinite(p.x) && Number.isFinite(p.y))
}
function preserveAttrs(t: string, names = preservedOpenAttrs): string {
  return names.map(name => {
    const value = attr(t, name)
    return value ? ` ${name}="${value}"` : ''
  }).join('')
}
function pathD(poly: Point[], closed: boolean): string {
  const d = poly.map((p, i) => `${i ? 'L' : 'M'}${r3(p.x)},${r3(p.y)}`).join(' ')
  return closed ? `${d} Z` : d
}
function toneFor(st: Style, fillSrc?: string): number {
  let t = st.baseTone
  if (st.toneFromLuminance) { const l = lum(fillSrc); if (l != null) t = Math.max(t, 1 - l) }
  return Math.max(0, Math.min(1, t))
}

// --- stroke strategies ------------------------------------------------------
function strokeWrap(d: string, color: string, st: Style, fillRibbon = false, extraAttrs = '', dash?: string): string {
  const f = st.strokeFilter ? ` filter="url(#${st.strokeFilter})"` : ''
  const op = st.strokeOpacity != null ? ` stroke-opacity="${st.strokeOpacity}"` : ''
  const dashAttr = dash ? ` stroke-dasharray="${dash}"` : ''
  const mis = st.misregister
    ? `<path d="${d}" transform="translate(${st.misregister},${st.misregister})" ${fillRibbon ? `fill="${st.misColor}" fill-opacity="0.7" stroke="none"` : `fill="none" stroke="${st.misColor}" stroke-opacity="0.7" stroke-width="${st.strokeWidth}"${dashAttr}`}/>`
    : ''
  const main = fillRibbon
    ? `<path d="${d}" fill="${color}" stroke="none"${op}${f}${extraAttrs}/>`
    : `<path d="${d}" fill="none" stroke="${color}" stroke-width="${st.strokeWidth}" stroke-linecap="${st.linecap}"${dashAttr}${op}${f}${extraAttrs}/>`
  return mis + main
}
// Shared rough.js option bundle for a style.
function roughOpts(st: Style, color: string, seed: number, extra: { dash?: string; extraAttrs?: string } = {}) {
  return {
    seed, roughness: st.roughness, bowing: 1, stroke: color, strokeWidth: st.strokeWidth,
    linecap: st.linecap, strokeOpacity: st.strokeOpacity, strokeFilter: st.strokeFilter, passes: st.passes,
    ...extra,
  }
}
function strokeClosed(poly: Point[], color: string, st: Style, seed: number): string {
  if (st.stroke === 'crisp') return strokeWrap(pathD(poly, true), color, st)
  // brush is native (tapered ribbons rough.js can't do); everything else → rough.js
  if (st.stroke === 'brush') return brushPolygon(poly, makeRng(seed), { width: st.brushWidth ?? st.strokeWidth * 2, wobble: st.roughness }).map(d => strokeWrap(d, color, st, true)).join('')
  if (st.stroke === 'freehand') return strokeWrap(freehandStroke(poly, makeRng(seed), { width: st.brushWidth ?? st.strokeWidth * 3, wobble: st.roughness, closed: true }), color, st, true)
  return roughPolyOutline(poly, roughOpts(st, color, seed))
}
function openStroke(pts: Point[], color: string, st: Style, seed: number, t: string): string {
  const extraAttrs = preserveAttrs(t)
  const dash = attr(t, 'stroke-dasharray')
  if (st.stroke === 'crisp') return strokeWrap(pathD(pts, false), color, st, false, extraAttrs, dash)
  if (st.stroke === 'brush') return pts.slice(1).map((p, i) => {
      const attrs = i === pts.length - 2 ? extraAttrs : ''
      return strokeWrap(brushStroke(pts[i]!, p, makeRng(seed), { width: (st.brushWidth ?? st.strokeWidth * 2) * 0.7, wobble: st.roughness }), color, st, true, attrs, dash)
    }).join('')
  if (st.stroke === 'freehand') {
    const d = freehandStroke(pts, makeRng(seed), { width: st.brushWidth ?? st.strokeWidth * 3, wobble: st.roughness })
    const markerPath = extraAttrs ? `<path d="${pathD(pts, false)}" fill="none" stroke="${color}" stroke-width="0.1" stroke-opacity="0.01"${extraAttrs}/>` : ''
    const dashOverlay = dash ? strokeWrap(pathD(pts, false), color, st, false, '', dash) : ''
    return strokeWrap(d, color, st, true) + dashOverlay + markerPath
  }
  return roughOpen(pts, roughOpts(st, color, seed, { dash, extraAttrs }))
}

// --- fill strategies (tone-driven) -----------------------------------------
function fillRegion(poly: Point[], fillSrc: string | undefined, st: Style, seed: number): string {
  if (st.fill === 'none') return ''
  const tone = toneFor(st, fillSrc)
  if (tone <= 0.001) return ''
  const rng = makeRng(seed ^ 0x9e3779b9)
  const ink = st.keepHue && lum(fillSrc) != null ? fillSrc! : st.fillColor
  switch (st.fill) {
    case 'hachure': {
      // spot palette lets the hachure fill be a PASTEL distinct from the dark
      // stroke (Excalidraw); otherwise hatch in the ink colour.
      const hk = st.spotPalette?.length ? st.spotPalette[Math.abs(seed) % st.spotPalette.length]! : ink
      return roughPolyFill(poly, {
        seed: seed ^ 0x51, roughness: st.roughness, stroke: hk, strokeWidth: st.strokeWidth,
        fill: hk, fillStyle: tone > 0.6 ? 'cross-hatch' : 'hachure',
        fillWeight: Math.max(0.6, st.strokeWidth * 0.5), hachureGap: lerp(10, 4, tone),
        hachureAngle: st.hachureAngle, fillOpacity: st.spotPalette ? 0.9 : 0.5 + 0.4 * tone, passes: 1,
      })
    }
    case 'crosshatch':
      return roughPolyFill(poly, {
        seed: seed ^ 0x51, roughness: st.roughness, stroke: ink, strokeWidth: st.strokeWidth,
        fill: ink, fillStyle: 'cross-hatch', fillWeight: 0.9, hachureGap: lerp(5, 2.6, tone),
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
      return `<path d="${stipple(poly, Math.min(tone, 0.6), rng, { density: 0.02 })}" fill="${ink}" stroke="none"/>`
    case 'halftone':
      return `<path d="${halftone(poly, Math.min(tone, 0.55), 8, st.hachureAngle)}" fill="${ink}" stroke="none"/>`
    case 'wash': {
      // spot-palette gives watercolor/riso varied per-region pigment
      const wc = st.spotPalette?.length ? st.spotPalette[Math.abs(seed) % st.spotPalette.length]! : ink
      return watercolorWash(poly, rng, wc, { opacity: st.name === 'watercolor' ? 0.30 : 0.16 + 0.45 * tone, edge: st.name === 'watercolor' ? 0.38 : 0.22 })
    }
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
  // Arrival: draw the node as a circular variable-weight ink ring + splatter.
  if (st.ringNode) {
    const xs = poly.map(p => p.x), ys = poly.map(p => p.y)
    const cx = (Math.min(...xs) + Math.max(...xs)) / 2, cy = (Math.min(...ys) + Math.max(...ys)) / 2
    const r = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)) / 2 + 6
    const rng = makeRng(seed)
    const ring = circlePoly(cx, cy, r, r, 20)
    const out: string[] = []
    // variable weight: two overlaid rough rings at different widths
    for (const w of [st.strokeWidth, st.strokeWidth * 0.5]) out.push(roughPolyOutline(ring, { ...roughOpts(st, sc, seed ^ Math.round(w * 7)), strokeWidth: w }))
    // splatter dots/blots just outside the band
    for (let i = 0; i < 5; i++) { const a2 = rng() * Math.PI * 2, rr = r + (rng() - 0.3) * 10, dr = 0.8 + rng() * 2.2; out.push(`<circle cx="${r3(cx + Math.cos(a2) * rr)}" cy="${r3(cy + Math.sin(a2) * rr)}" r="${r3(dr)}" fill="${sc}"/>`) }
    return out.join('')
  }
  const a = area(poly); const big = a >= MIN_FILL_AREA && a <= MAX_FILL_AREA
  // Soft drop-shadow under the shape (whiteboard marker on a glossy board).
  const shadow = st.boxShadow && big
    ? `<path d="${poly.map((p, i) => `${i ? 'L' : 'M'}${r3(p.x + 2)},${r3(p.y + 4)}`).join(' ')} Z" fill="none" stroke="#00000026" stroke-width="${st.strokeWidth}" filter="url(#wbsh)"/>`
    : ''
  // Offset drop-glow behind the filled shape (screenprint registration look).
  const glow = st.glowColor && big
    ? `<path d="${poly.map((p, i) => `${i ? 'L' : 'M'}${r3(p.x + (st.glowOffset ?? 5))},${r3(p.y + (st.glowOffset ?? 5))}`).join(' ')} Z" fill="${st.glowColor}" stroke="none"/>`
    : ''
  const fillStr = big ? fillRegion(poly, fill, st, seed) : ''
  return shadow + glow + fillStr + (stroke === 'none' ? '' : strokeClosed(poly, sc, st, seed))
}

export function restyle(svg: string, st: Style, opts: { backdrop?: boolean } = {}): string {
  const defsEnd = svg.indexOf('</defs>')
  const splitAt = defsEnd >= 0 ? defsEnd + 7 : svg.indexOf('>') + 1
  const head = svg.slice(0, splitAt)
  let body = svg.slice(splitAt).replace('</svg>', '')

  body = body
    // FIRST: arbitrary <path> shapes (pie wedges, cylinders, curved series) —
    // the gap the regex prototype left un-styled. rough.js handles any `d`.
    // Runs before the shape→<path> rewrites below so it only sees originals.
    .replace(/<path\b[^>]*\/>/g, t => {
      const d = attr(t, 'd'); if (!d) return t
      const stroke = attr(t, 'stroke'), fill = attr(t, 'fill')
      const seed = seedAt(d.length, d.charCodeAt(1) || 0, d.charCodeAt(d.length - 1) || 0)
      const hasFill = fill && fill !== 'none' && fill !== 'transparent'
      const sc = stroke && stroke !== 'none' ? stroke : st.colors.line
      if (st.stroke === 'crisp') return t
      const r = roughPathD(d, {
        seed, roughness: Math.max(0.6, st.roughness), stroke: sc,
        strokeWidth: st.strokeWidth, linecap: st.linecap, passes: 1,
        fill: hasFill ? fill : undefined, fillStyle: (st.fill === 'wash' || st.fill === 'solid') ? 'solid' : 'hachure',
        fillWeight: 0.8, hachureGap: 5, fillOpacity: hasFill ? (st.fill === 'wash' ? 0.5 : 0.85) : undefined,
        dash: attr(t, 'stroke-dasharray'), extraAttrs: preserveAttrs(t),
      })
      return r || t
    })
    .replace(/<rect\b[^>]*\/>/g, t => {
      const x = num(attr(t, 'x')), y = num(attr(t, 'y')), w = num(attr(t, 'width')), h = num(attr(t, 'height'))
      if (!w || !h) return t
      const rx = num(attr(t, 'rx'), num(attr(t, 'ry')))
      const ry = num(attr(t, 'ry'), rx)
      return closedShape(roundedRectPoly(x, y, w, h, rx, ry), attr(t, 'stroke'), attr(t, 'fill'), st, seedAt(x, y, w, h))
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
      return pts.length >= 2 ? openStroke(pts, attr(t, 'stroke') ?? st.colors.line, st, seedAt(pts[0]!.x, pts[0]!.y, pts.length), t) : t
    })
    .replace(/<line\b[^>]*\/>/g, t => {
      const a = { x: num(attr(t, 'x1')), y: num(attr(t, 'y1')) }, b = { x: num(attr(t, 'x2')), y: num(attr(t, 'y2')) }
      return openStroke([a, b], attr(t, 'stroke') ?? st.colors.line, st, seedAt(a.x, a.y, b.x, b.y), t)
    })

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
  const tt = st.textTransform ? `text-transform:${st.textTransform};` : ''
  const ls = st.letterSpacing ? `letter-spacing:${st.letterSpacing}px;` : ''
  parts.push(`<style>text{font-family:'${st.font}',serif !important;fill:${ink} !important;${halo}${tt}${ls}} .edge-label-halo,.edge-label rect{fill:${st.colors.bg} !important;stroke:none !important;}</style>`)
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
      // faint blue horizontal rules only (no red margin) — matches the photo
      for (let y = 40; y < h; y += 26) p.push(`<line x1="0" y1="${y}" x2="${w}" y2="${y}" stroke="#aebfd0" stroke-width="0.8" opacity="0.4"/>`)
      break
    case 'blueprint': {
      // border frame + faint grid + bottom-right title block (cyanotype furniture)
      const m = Math.round(Math.min(w, h) * 0.035) + 8
      for (let x = m; x < w - m; x += 26) p.push(`<line x1="${x}" y1="${m}" x2="${x}" y2="${h - m}" stroke="#cfe0f2" stroke-width="0.4" opacity="0.16"/>`)
      for (let y = m; y < h - m; y += 26) p.push(`<line x1="${m}" y1="${y}" x2="${w - m}" y2="${y}" stroke="#cfe0f2" stroke-width="0.4" opacity="0.16"/>`)
      p.push(`<rect x="${m}" y="${m}" width="${w - 2 * m}" height="${h - 2 * m}" fill="none" stroke="${st.colors.line}" stroke-width="1.4"/>`)
      p.push(`<rect x="${m + 3}" y="${m + 3}" width="${w - 2 * m - 6}" height="${h - 2 * m - 6}" fill="none" stroke="${st.colors.line}" stroke-width="0.6"/>`)
      const tbW = Math.min(330, w * 0.42), tbH = 76, tx = w - m - tbW, ty = h - m - tbH
      p.push(`<rect x="${tx}" y="${ty}" width="${tbW}" height="${tbH}" fill="none" stroke="${st.colors.line}" stroke-width="1"/>`)
      p.push(`<line x1="${tx}" y1="${ty + tbH / 2}" x2="${tx + tbW}" y2="${ty + tbH / 2}" stroke="${st.colors.line}" stroke-width="0.6"/>`)
      p.push(`<line x1="${tx + tbW * 0.6}" y1="${ty}" x2="${tx + tbW * 0.6}" y2="${ty + tbH}" stroke="${st.colors.line}" stroke-width="0.6"/>`)
      const tf = `font-family="${st.font}" fill="${st.colors.fg}" letter-spacing="1"`
      p.push(`<text x="${tx + 8}" y="${ty + 20}" font-size="13" ${tf}>AGENTIC MERMAID</text>`)
      p.push(`<text x="${tx + 8}" y="${ty + tbH / 2 + 20}" font-size="11" ${tf}>DRAWN BY · M</text>`)
      p.push(`<text x="${tx + tbW * 0.6 + 8}" y="${ty + 20}" font-size="11" ${tf}>NO. 001</text>`)
      p.push(`<text x="${tx + tbW * 0.6 + 8}" y="${ty + tbH / 2 + 20}" font-size="11" ${tf}>SCALE 1:1</text>`)
      // north arrow (top-right) + graphic scale bar (bottom-left)
      const nx = w - m - 36, ny = m + 46
      p.push(`<path d="M${nx},${ny} l8,22 l-8,-7 l-8,7 Z" fill="none" stroke="${st.colors.line}" stroke-width="1"/><text x="${nx}" y="${ny - 6}" text-anchor="middle" font-family="${st.font}" font-size="11" fill="${st.colors.fg}">N</text>`)
      const sx = m + 14, sy = h - m - 16
      for (let i = 0; i < 4; i++) p.push(`<rect x="${sx + i * 18}" y="${sy}" width="18" height="5" fill="none" stroke="${st.colors.line}" stroke-width="0.8"/>`)
      break
    }
    case 'parchment': {
      // aged vellum: warm blotches + faint horizontal ruling
      p.push(`<defs><filter id="pmt"><feTurbulence type="fractalNoise" baseFrequency="0.012 0.014" numOctaves="3" result="n"/><feColorMatrix in="n" type="matrix" values="0 0 0 0 0.18  0 0 0 0 0.12  0 0 0 0 0.04  0 0 0 0.06 0"/></filter></defs><rect width="${w}" height="${h}" filter="url(#pmt)"/>`)
      for (let y = 46; y < h; y += 30) p.push(`<line x1="36" y1="${y}" x2="${w - 36}" y2="${y}" stroke="#8b6f42" stroke-width="0.5" opacity="0.18"/>`)
      p.push(`<line x1="60" y1="20" x2="60" y2="${h - 20}" stroke="#9b2d20" stroke-width="0.7" opacity="0.3"/>`)
      break
    }
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
