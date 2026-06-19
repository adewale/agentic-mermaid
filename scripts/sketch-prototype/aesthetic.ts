// ============================================================================
// Pluggable aesthetic backend (prototype).
//
// The renderer today calls leaf functions like renderRect / renderEdge that
// each emit ONE crisp SVG element. The idea here is to hoist those leaves
// behind an interface so the *look* becomes a swappable strategy. The layout,
// routing, labels, and agent API never change — only how a box/edge/arrow is
// drawn, plus the page backdrop and palette.
//
// Implement this interface once per style: hand-drawn, pen-and-ink, Tufte,
// sumi-e, … and you get that style across every diagram family for free.
// ============================================================================

import {
  makeRng, roughLine, roughRect, roughPolygon, hachureFill,
  roughArrowhead, type Point,
} from './rough.ts'

export interface Palette {
  bg: string        // page
  ink: string       // primary stroke + text
  fill: string      // shape fill / hachure colour
  accent: string    // arrowheads, emphasis
  rule?: string     // ruled-paper line colour
}

export interface Aesthetic {
  name: string
  palette: Palette
  fontFamily: string
  fontImport?: string            // @import line for browser SVG (omitted for PNG)
  /** A full-page backdrop drawn first (paper, ruling, texture). */
  backdrop(w: number, h: number): string
  /** A node box. `seed` keys the deterministic jitter (usually the node id). */
  box(x: number, y: number, w: number, h: number, seed: number): string
  /** A diamond / polygon node. */
  poly(points: Point[], seed: number): string
  /** An edge path through these points. */
  edge(points: Point[], seed: number): string
  /** Arrowhead at `tip`, edge arriving along `angle` (radians). */
  arrow(tip: Point, angle: number, seed: number): string
  /** Per-node text decoration hook (e.g. slight rotation). Default: none. */
  textTransform?(seed: number): string
}

// ============================================================================
// Hand-drawn / notebook aesthetic — the one matching the reference photo.
// ============================================================================
export const HandDrawn: Aesthetic = {
  name: 'hand-drawn',
  palette: {
    bg: '#fbfaf3',          // warm cream paper
    ink: '#1f3a8a',         // blue ballpoint
    fill: '#1f3a8a',        // hachure uses the ink colour, low opacity
    accent: '#1f3a8a',
    rule: '#9fc0d8',        // faint blue ruling
  },
  fontFamily: 'Caveat',
  fontImport: "@import url('https://fonts.googleapis.com/css2?family=Caveat:wght@400;600&amp;display=swap');",

  backdrop(w, h) {
    const lines: string[] = [`<rect x="0" y="0" width="${w}" height="${h}" fill="${this.palette.bg}"/>`]
    // Horizontal ruling every 28px.
    for (let y = 60; y < h; y += 28) {
      lines.push(`<line x1="0" y1="${y}" x2="${w}" y2="${y}" stroke="${this.palette.rule}" stroke-width="0.8" opacity="0.5"/>`)
    }
    // Red-ish margin line + a faded header, à la a notebook page.
    lines.push(`<line x1="46" y1="0" x2="46" y2="${h}" stroke="#d98b8b" stroke-width="0.8" opacity="0.5"/>`)
    lines.push(`<text x="60" y="34" font-family="${this.fontFamily}" font-size="14" fill="${this.palette.ink}" opacity="0.6" letter-spacing="2">DATUM/DATE</text>`)
    return lines.join('\n')
  },

  box(x, y, w, h, seed) {
    const rng = makeRng(seed)
    const poly: Point[] = [{ x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h }]
    const fill = hachureFill(poly, makeRng(seed ^ 0x9e3779b9), { angleDeg: -41, gap: 7, roughness: 0.7 })
    const outline = roughRect(x, y, w, h, rng, { roughness: 1.6, bowing: 1.1, passes: 2 })
    return (
      `<path d="${fill}" stroke="${this.palette.fill}" stroke-width="0.7" opacity="0.12" fill="none"/>` +
      `<path d="${outline}" stroke="${this.palette.ink}" stroke-width="1.6" fill="none" stroke-linecap="round"/>`
    )
  },

  poly(points, seed) {
    const rng = makeRng(seed)
    const fill = hachureFill(points, makeRng(seed ^ 0x9e3779b9), { angleDeg: -41, gap: 7, roughness: 0.7 })
    const outline = roughPolygon(points, rng, { roughness: 1.6, bowing: 1.1, passes: 2 })
    return (
      `<path d="${fill}" stroke="${this.palette.fill}" stroke-width="0.7" opacity="0.12" fill="none"/>` +
      `<path d="${outline}" stroke="${this.palette.ink}" stroke-width="1.6" fill="none" stroke-linecap="round"/>`
    )
  },

  edge(points, seed) {
    const rng = makeRng(seed)
    const segs: string[] = []
    for (let i = 0; i + 1 < points.length; i++) {
      segs.push(roughLine(points[i]!, points[i + 1]!, rng, { roughness: 1.4, bowing: 1.2, passes: 1 }))
    }
    return `<path d="${segs.join(' ')}" stroke="${this.palette.ink}" stroke-width="1.4" fill="none" stroke-linecap="round"/>`
  },

  arrow(tip, angle, seed) {
    const d = roughArrowhead(tip, angle, makeRng(seed), 13)
    return `<path d="${d}" stroke="${this.palette.accent}" stroke-width="1.4" fill="none" stroke-linecap="round"/>`
  },
}
