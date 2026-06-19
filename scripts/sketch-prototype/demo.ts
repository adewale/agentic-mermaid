// ============================================================================
// Prototype demo: render the "Agentic Core" reference diagram in the
// hand-drawn aesthetic, to both SVG and PNG.
//
//   bun run scripts/sketch-prototype/demo.ts
//
// The radial layout is hand-placed here (the prototype is about the *render*
// backend, not layout — in the real thing ELK supplies node x/y/w/h and edge
// points exactly as it does for the crisp renderer).
// ============================================================================

import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { Resvg } from '@resvg/resvg-js'
import { HandDrawn, type Aesthetic } from './aesthetic.ts'
import { seedFrom, type Point } from './rough.ts'

const W = 940, H = 700
const A: Aesthetic = HandDrawn

interface Node { id: string; lines: string[]; cx: number; cy: number; w: number; h: number; stacked?: boolean }

const center: Node = { id: 'core', lines: ['Agentic', 'Core'], cx: W / 2, cy: H / 2, w: 150, h: 110 }

// Ten satellites placed on an ellipse around the core, angles chosen to echo
// the photo (top, top-right, right, …).
const labels: { lines: string[]; stacked?: boolean }[] = [
  { lines: ['Sandboxes'], stacked: true },
  { lines: ['Dynamic', 'Workers'], stacked: true },
  { lines: ['Dynamic', 'Workflows'], stacked: true },
  { lines: ['Browser', 'Run'] },
  { lines: ['Artifacts'], stacked: true },
  { lines: ['Queues'] },
  { lines: ['Workflows'], stacked: true },
  { lines: ['Storage', '(D1, KV, R2, etc.)'] },
  { lines: ['Sub-agents', 'with loadable', 'context'], stacked: true },
  { lines: ['Bindings'], stacked: true },
]

const RX = 330, RY = 250
const satellites: Node[] = labels.map((l, i) => {
  const ang = (-90 + (360 / labels.length) * i) * (Math.PI / 180)
  const cx = W / 2 + Math.cos(ang) * RX
  const cy = H / 2 + Math.sin(ang) * RY
  const w = Math.max(110, 16 + l.lines.reduce((m, s) => Math.max(m, s.length), 0) * 10)
  const h = 40 + (l.lines.length - 1) * 22
  return { id: 'n' + i, lines: l.lines, cx, cy, w, h, stacked: l.stacked }
})

// Edge endpoint on a box border, on the line from box centre toward `toward`.
function port(n: Node, toward: Point): Point {
  const dx = toward.x - n.cx, dy = toward.y - n.cy
  const sx = dx === 0 ? Infinity : (n.w / 2) / Math.abs(dx)
  const sy = dy === 0 ? Infinity : (n.h / 2) / Math.abs(dy)
  const s = Math.min(sx, sy)
  return { x: n.cx + dx * s, y: n.cy + dy * s }
}

function boxAt(n: Node): string {
  const x = n.cx - n.w / 2, y = n.cy - n.h / 2
  const parts: string[] = []
  // "Stacked" look: two offset outlines behind the main box.
  if (n.stacked) {
    parts.push(A.box(x + 10, y + 12, n.w, n.h, seedFrom(n.id + 'b2')))
    parts.push(A.box(x + 5, y + 6, n.w, n.h, seedFrom(n.id + 'b1')))
  }
  parts.push(A.box(x, y, n.w, n.h, seedFrom(n.id)))
  // Label (upright; the handwriting font carries the look).
  const fs = 22
  const total = n.lines.length
  n.lines.forEach((line, i) => {
    const ly = n.cy - ((total - 1) * fs) / 2 + i * fs + fs * 0.32
    parts.push(
      `<text x="${n.cx}" y="${ly}" text-anchor="middle" font-family="${A.fontFamily}" ` +
      `font-size="${fs}" fill="${A.palette.ink}">${esc(line)}</text>`,
    )
  })
  return parts.join('\n')
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

// --- Assemble the SVG (same order as renderer.ts: backdrop → edges → nodes) -
const parts: string[] = []
parts.push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">`)
parts.push(`<style>${A.fontImport ?? ''}</style>`)
parts.push(A.backdrop(W, H))

for (const sat of satellites) {
  const a = port(center, { x: sat.cx, y: sat.cy })
  const b = port(sat, { x: center.cx, y: center.cy })
  parts.push(A.edge([a, b], seedFrom('e' + sat.id)))
  const ang = Math.atan2(b.y - a.y, b.x - a.x)
  parts.push(A.arrow(b, ang, seedFrom('a' + sat.id)))
}

for (const sat of satellites) parts.push(boxAt(sat))
parts.push(boxAt(center))
parts.push('</svg>')

const svg = parts.join('\n')
const outDir = join(import.meta.dir)
writeFileSync(join(outDir, 'demo.svg'), svg)

const png = new Resvg(svg, {
  background: HandDrawn.palette.bg,
  fitTo: { mode: 'width', value: W * 2 },
  font: { loadSystemFonts: false, fontFiles: [join(outDir, 'Caveat.ttf')], defaultFontFamily: 'Caveat' },
}).render().asPng()
writeFileSync(join(outDir, 'demo.png'), png)

console.log('wrote demo.svg + demo.png  (', svg.length, 'bytes svg )')
