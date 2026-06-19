// ============================================================================
// restyle(): turn a normally-rendered Mermaid SVG into a hand-rendered one.
//
// Rather than reimplement every diagram family, we post-process the SVG the
// real renderer already produces: walk its primitive elements (rect, circle,
// polygon, polyline, line) and re-emit each as rough path data per the chosen
// Style. This is a prototype shortcut — the production design would push the
// same Style object *into* the renderer's primitive emitters — but it proves
// two things cheaply: (a) every supported diagram type is covered, and
// (b) the look is fully data-driven (swap the Style, get a new aesthetic).
//
// Deterministic: each element seeds its PRNG from its rounded coordinates.
// ============================================================================

import {
  makeRng, roughLine, roughPolygon, hachureFill, crosshatchFill, type Point,
} from './rough.ts'
import type { Style } from './styles.ts'

const num = (s: string | undefined, d = 0) => (s == null ? d : parseFloat(s))
const attr = (tag: string, name: string): string | undefined =>
  tag.match(new RegExp(`\\b${name}="([^"]*)"`))?.[1]
const seedAt = (...n: number[]) => (Math.round(n.reduce((a, b) => a * 31 + b, 7)) >>> 0) || 1
const r3 = (n: number) => Math.round(n * 1000) / 1000

function circlePoly(cx: number, cy: number, rx: number, ry: number, n = 22): Point[] {
  const pts: Point[] = []
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2
    pts.push({ x: cx + Math.cos(a) * rx, y: cy + Math.sin(a) * ry })
  }
  return pts
}

function parsePoints(s: string): Point[] {
  return s.trim().split(/\s+/).map(pair => {
    const [x, y] = pair.split(',').map(Number)
    return { x: x!, y: y! }
  }).filter(p => Number.isFinite(p.x) && Number.isFinite(p.y))
}

// Build the fill + outline replacement for a closed shape.
function drawShape(poly: Point[], stroke: string, fillSrc: string | undefined, st: Style, seed: number): string {
  const out: string[] = []
  const hasFill = st.fill !== 'none' && fillSrc && fillSrc !== 'none' && fillSrc !== 'transparent'
  if (hasFill) {
    if (st.fill === 'wash') {
      const d = poly.map((p, i) => `${i ? 'L' : 'M'}${r3(p.x)},${r3(p.y)}`).join(' ') + ' Z'
      out.push(`<path d="${d}" fill="${st.fillColor}" fill-opacity="${st.fillOpacity}" stroke="none"/>`)
    } else {
      const fr = makeRng(seed ^ 0x9e3779b9)
      const fn = st.fill === 'crosshatch' ? crosshatchFill : hachureFill
      const d = fn(poly, fr, { angleDeg: st.hachureAngle, gap: st.hachureGap, roughness: 0.7 })
      out.push(`<path d="${d}" stroke="${st.fillColor}" stroke-width="0.7" opacity="${st.fillOpacity}" fill="none"/>`)
    }
  }
  out.push(strokePath(roughPolygon(poly, makeRng(seed), strokeOpts(st)), stroke, st))
  return out.join('')
}

function strokeOpts(st: Style) {
  return { roughness: st.roughen ? st.roughness : 0, bowing: st.roughen ? st.bowing : 0, passes: st.passes }
}
function strokePath(d: string, stroke: string, st: Style): string {
  const filter = st.strokeFilter ? ` filter="url(#${st.strokeFilter})"` : ''
  return `<path d="${d}" stroke="${stroke}" stroke-width="${st.strokeWidth}" fill="none" stroke-linecap="${st.linecap}"${filter}/>`
}

// --- element transforms -----------------------------------------------------
function xformRect(tag: string, st: Style): string {
  const x = num(attr(tag, 'x')), y = num(attr(tag, 'y'))
  const w = num(attr(tag, 'width')), h = num(attr(tag, 'height'))
  if (!w || !h) return tag
  const stroke = attr(tag, 'stroke') ?? st.colors.line
  if (stroke === 'none') return tag // fill-only rects (e.g. label halos) — drop
  const poly = [{ x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h }]
  return drawShape(poly, stroke, attr(tag, 'fill'), st, seedAt(x, y, w, h))
}
function xformCircle(tag: string, st: Style): string {
  const cx = num(attr(tag, 'cx')), cy = num(attr(tag, 'cy')), r = num(attr(tag, 'r'))
  if (!r) return tag
  return drawShape(circlePoly(cx, cy, r, r), attr(tag, 'stroke') ?? st.colors.line, attr(tag, 'fill'), st, seedAt(cx, cy, r))
}
function xformEllipse(tag: string, st: Style): string {
  const cx = num(attr(tag, 'cx')), cy = num(attr(tag, 'cy')), rx = num(attr(tag, 'rx')), ry = num(attr(tag, 'ry'))
  if (!rx || !ry) return tag
  return drawShape(circlePoly(cx, cy, rx, ry), attr(tag, 'stroke') ?? st.colors.line, attr(tag, 'fill'), st, seedAt(cx, cy, rx, ry))
}
function xformPolygon(tag: string, st: Style): string {
  const pts = parsePoints(attr(tag, 'points') ?? '')
  if (pts.length < 3) return tag
  return drawShape(pts, attr(tag, 'stroke') ?? st.colors.line, attr(tag, 'fill'), st, seedAt(pts[0]!.x, pts[0]!.y, pts.length))
}
function xformPolyline(tag: string, st: Style): string {
  const pts = parsePoints(attr(tag, 'points') ?? '')
  if (pts.length < 2) return tag
  const stroke = attr(tag, 'stroke') ?? st.colors.line
  const rng = makeRng(seedAt(pts[0]!.x, pts[0]!.y, pts.length))
  const segs = pts.slice(1).map((p, i) => roughLine(pts[i]!, p, rng, strokeOpts(st)))
  const dash = attr(tag, 'stroke-dasharray')
  const dashAttr = dash ? ` stroke-dasharray="${dash}"` : ''
  const filter = st.strokeFilter ? ` filter="url(#${st.strokeFilter})"` : ''
  return `<path d="${segs.join(' ')}" stroke="${stroke}" stroke-width="${st.strokeWidth}" fill="none" stroke-linecap="${st.linecap}"${dashAttr}${filter}/>`
}
function xformLine(tag: string, st: Style): string {
  const a = { x: num(attr(tag, 'x1')), y: num(attr(tag, 'y1')) }
  const b = { x: num(attr(tag, 'x2')), y: num(attr(tag, 'y2')) }
  const stroke = attr(tag, 'stroke') ?? st.colors.line
  const d = roughLine(a, b, makeRng(seedAt(a.x, a.y, b.x, b.y)), strokeOpts(st))
  return strokePath(d, stroke, st)
}

// ============================================================================
export function restyle(svg: string, st: Style, opts: { backdrop?: boolean } = {}): string {
  // Split head (opening <svg> + <defs>) from body; never touch defs (markers).
  const defsEnd = svg.indexOf('</defs>')
  const splitAt = defsEnd >= 0 ? defsEnd + '</defs>'.length : svg.indexOf('>') + 1
  const head = svg.slice(0, splitAt)
  let body = svg.slice(splitAt)
  const close = '</svg>'
  body = body.replace(close, '')

  // Crisp styles (Tufte) keep original geometry — only recolour/typeface/page.
  if (st.roughen) {
    body = body
      .replace(/<rect\b[^>]*\/>/g, t => xformRect(t, st))
      .replace(/<circle\b[^>]*\/>/g, t => xformCircle(t, st))
      .replace(/<ellipse\b[^>]*\/>/g, t => xformEllipse(t, st))
      .replace(/<polygon\b[^>]*\/>/g, t => xformPolygon(t, st))
      .replace(/<polyline\b[^>]*\/>/g, t => xformPolyline(t, st))
      .replace(/<line\b[^>]*\/>/g, t => xformLine(t, st))
  }

  const vb = (head.match(/viewBox="0 0 ([\d.]+) ([\d.]+)"/) || [])
  const w = num(vb[1], 800), h = num(vb[2], 600)

  // Inject: extra defs, font override, optional backdrop.
  const parts: string[] = [head]
  if (st.defs) parts.push(`<defs>${st.defs}</defs>`)
  parts.push(`<style>text{font-family:'${st.font}',serif !important;} .edge-label-halo,.edge-label rect{fill:${st.colors.bg} !important;}</style>`)
  if (opts.backdrop !== false) parts.push(backdrop(st, w, h))
  parts.push(body, close)
  return parts.join('\n')
}

// --- backdrops --------------------------------------------------------------
export function backdrop(st: Style, w: number, h: number): string {
  const p: string[] = []
  const bg = st.colors.bg
  switch (st.backdrop) {
    case 'paper-ruled': {
      p.push(rect(0, 0, w, h, bg))
      for (let y = 40; y < h; y += 26) p.push(`<line x1="0" y1="${y}" x2="${w}" y2="${y}" stroke="#9fc0d8" stroke-width="0.8" opacity="0.45"/>`)
      p.push(`<line x1="42" y1="0" x2="42" y2="${h}" stroke="#d98b8b" stroke-width="0.8" opacity="0.5"/>`)
      break
    }
    case 'plain':
      p.push(rect(0, 0, w, h, bg)); break
    case 'rice': {
      p.push(rect(0, 0, w, h, bg))
      p.push(`<defs><filter id="rice"><feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" result="n"/><feColorMatrix in="n" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 0.04 0"/></filter></defs>`)
      p.push(`<rect x="0" y="0" width="${w}" height="${h}" filter="url(#rice)"/>`)
      break
    }
    case 'washi':
      p.push(rect(0, 0, w, h, bg)); break
  }
  return p.join('\n')
}
const rect = (x: number, y: number, w: number, h: number, fill: string) =>
  `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${fill}"/>`

// A red seal/chop, bottom-right (Chinese brush).
export function seal(w: number, h: number): string {
  const s = 46, x = w - s - 24, y = h - s - 24
  return `<rect x="${x}" y="${y}" width="${s}" height="${s}" rx="4" fill="none" stroke="#b22222" stroke-width="2.5"/>` +
    `<text x="${x + s / 2}" y="${y + s / 2 + 9}" text-anchor="middle" font-family="EB Garamond,serif" font-size="26" fill="#b22222">印</text>`
}
