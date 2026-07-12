// Universal SVG overlap auditor: extracts text boxes (measured with the same
// estimator layout uses) and primitive boxes from rendered SVG, attributes
// ownership via <g> groups where present (flowchart/state/timeline) or via
// containment where absent (gantt/pie), and reports:
//   TEXT-TEXT     two labels' boxes intersect (different owners)
//   TEXT-STRADDLE a label partially overlaps a primitive box (not contained, not its owner)
//   BOX-BOX       two primitives interpenetrate (neither contains the other, different owners)
import { measureTextWidth } from '../../src/text-metrics.ts'

export interface Box { x0: number; y0: number; x1: number; y1: number }
export interface TextBox extends Box { text: string; owner: string }
export interface PrimBox extends Box { kind: string; owner: string }
export interface OverlapFinding { kind: 'TEXT-TEXT' | 'TEXT-STRADDLE' | 'BOX-BOX' | 'OFF-CANVAS'; a: string; b: string; pen: number }

const num = (s: string | undefined): number => Number(s ?? 'NaN')

interface GroupSpan { start: number; end: number; label: string; depth: number }
// shallow <g> tree via depth tracking; label = class + data-id/from/to when present
function groupSpans(svg: string): GroupSpan[] {
  const spans: GroupSpan[] = []
  const stack: { start: number; label: string; depth: number }[] = []
  const re = /<g\b([^>]*)>|<\/g>/g
  let m: RegExpExecArray | null
  while ((m = re.exec(svg))) {
    if (m[0] === '</g>') {
      const top = stack.pop()
      if (top) spans.push({ start: top.start, end: m.index, label: top.label, depth: top.depth })
    } else {
      const attrs = m[1] ?? ''
      const cls = /class="([^"]*)"/.exec(attrs)?.[1] ?? ''
      const id = /data-id="([^"]*)"/.exec(attrs)?.[1]
      const from = /data-from="([^"]*)"/.exec(attrs)?.[1]
      const to = /data-to="([^"]*)"/.exec(attrs)?.[1]
      const label = id ? `${cls}:${id}` : from ? `${cls}:${from}->${to}` : cls || 'g'
      stack.push({ start: m.index + m[0].length, label, depth: stack.length })
    }
  }
  return spans
}
function innermostGroup(spans: GroupSpan[], pos: number): string | undefined {
  let best: GroupSpan | undefined
  for (const s of spans) {
    if (pos >= s.start && pos < s.end && (!best || s.depth > best.depth)) best = s
  }
  return best ? `${best.label}@${best.start}` : undefined
}

export function extract(svg: string): { texts: TextBox[]; prims: PrimBox[] } {
  const spans = groupSpans(svg)
  const texts: TextBox[] = []
  const textRe = /<text\b([^>]*)>([\s\S]*?)<\/text>/g
  let m: RegExpExecArray | null
  let anon = 0
  while ((m = textRe.exec(svg))) {
    const attrs = m[1]!, inner = m[2]!
    const x = num(/(?:^|\s)x="([\d.e+-]+)"/.exec(attrs)?.[1])
    const y = num(/(?:^|\s)y="([\d.e+-]+)"/.exec(attrs)?.[1])
    const fs = num(/font-size="([\d.e+-]+)"/.exec(attrs)?.[1]) || 12
    const fw = num(/font-weight="([\d.e+-]+)"/.exec(attrs)?.[1]) || 400
    const anchor = /text-anchor="([^"]*)"/.exec(attrs)?.[1] ?? 'start'
    // tspans (multi-line) or plain content
    const tspans = [...inner.matchAll(/<tspan\b([^>]*)>([\s\S]*?)<\/tspan>/g)]
    const lines: { text: string; x: number; y: number }[] = tspans.length
      ? tspans.map(t => ({
          text: t[2]!.replace(/<[^>]+>/g, ''),
          x: /(?:^|\s)x="([\d.e+-]+)"/.exec(t[1]!)?.[1] !== undefined ? num(/(?:^|\s)x="([\d.e+-]+)"/.exec(t[1]!)?.[1]) : x,
          y: /(?:^|\s)y="([\d.e+-]+)"/.exec(t[1]!)?.[1] !== undefined ? num(/(?:^|\s)y="([\d.e+-]+)"/.exec(t[1]!)?.[1]) : y,
        }))
      : [{ text: inner.replace(/<[^>]+>/g, ''), x, y }]
    const owner = innermostGroup(spans, m.index) ?? `text#${anon++}`
    const rot = /transform="rotate\((-?[\d.]+)[, ]+([\d.e+-]+)[, ]+([\d.e+-]+)\)"/.exec(attrs)
    for (const ln of lines) {
      const clean = ln.text.replace(/\s+/g, ' ').trim()
      if (!clean || !Number.isFinite(ln.x) || !Number.isFinite(ln.y)) continue
      const w = measureTextWidth(clean, fs, fw)
      let x0 = anchor === 'middle' ? ln.x - w / 2 : anchor === 'end' ? ln.x - w : ln.x
      // y is the baseline anchor (renderer centers with dy); approximate the em box
      let box: Box = { x0, y0: ln.y - fs * 0.55, x1: x0 + w, y1: ln.y + fs * 0.55 }
      if (rot) {
        const ang = ((num(rot[1]) % 360) + 360) % 360, cx = num(rot[2]), cy = num(rot[3])
        if (Math.abs(ang - 90) < 1 || Math.abs(ang - 270) < 1) {
          // Exact ±90° corner map about (cx,cy): (x,y) → (cx - s·(y-cy), cy + s·(x-cx))
          // with s = +1 for 90° and -1 for 270°. The sign matters for anchored
          // text — a start-anchored label extends to opposite sides under the
          // two rotations (the 2026-07 audit's own false positive).
          const sgn = Math.abs(ang - 90) < 1 ? 1 : -1
          const xs = [cx - sgn * (box.y0 - cy), cx - sgn * (box.y1 - cy)]
          const ys = [cy + sgn * (box.x0 - cx), cy + sgn * (box.x1 - cx)]
          box = { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) }
        } else if (ang !== 0) {
          // Generic corner map for GitGraph's 45° commit labels and any future
          // deterministic angle. The old auditor skipped arbitrary rotations,
          // which made its zero-overlap claim blind exactly where dense history
          // labels were hardest to read.
          const rad = ang * Math.PI / 180
          const cos = Math.cos(rad), sin = Math.sin(rad)
          const corners = [
            [box.x0, box.y0], [box.x1, box.y0], [box.x0, box.y1], [box.x1, box.y1],
          ].map(([px, py]) => ({
            x: cx + (px! - cx) * cos - (py! - cy) * sin,
            y: cy + (px! - cx) * sin + (py! - cy) * cos,
          }))
          box = {
            x0: Math.min(...corners.map(point => point.x)),
            y0: Math.min(...corners.map(point => point.y)),
            x1: Math.max(...corners.map(point => point.x)),
            y1: Math.max(...corners.map(point => point.y)),
          }
        }
      }
      texts.push({ text: clean, owner, ...box })
    }
  }
  const prims: PrimBox[] = []
  const push = (kind: string, pos: number, x0: number, y0: number, x1: number, y1: number): void => {
    if (!(Number.isFinite(x0) && Number.isFinite(y0) && x1 > x0 && y1 > y0)) return
    prims.push({ kind, owner: innermostGroup(spans, pos) ?? `prim#${prims.length}`, x0, y0, x1, y1 })
  }
  for (const r of svg.matchAll(/<rect\b([^>]*)>/g)) {
    const attrs = r[1]!
    const x = num(/(?:^|\s)x="([\d.e+-]+)"/.exec(attrs)?.[1])
    const y = num(/(?:^|\s)y="([\d.e+-]+)"/.exec(attrs)?.[1])
    const width = num(/(?:^|\s)width="([\d.e+-]+)"/.exec(attrs)?.[1])
    const height = num(/(?:^|\s)height="([\d.e+-]+)"/.exec(attrs)?.[1])
    let box: Box = { x0: x, y0: y, x1: x + width, y1: y + height }
    const rot = /transform="rotate\((-?[\d.]+)[, ]+([\d.e+-]+)[, ]+([\d.e+-]+)\)"/.exec(attrs)
    if (rot && Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(width) && Number.isFinite(height)) {
      const angle = num(rot[1]) * Math.PI / 180, cx = num(rot[2]), cy = num(rot[3])
      const cos = Math.cos(angle), sin = Math.sin(angle)
      const corners = [[box.x0, box.y0], [box.x1, box.y0], [box.x0, box.y1], [box.x1, box.y1]].map(([px, py]) => ({
        x: cx + (px! - cx) * cos - (py! - cy) * sin,
        y: cy + (px! - cx) * sin + (py! - cy) * cos,
      }))
      box = { x0: Math.min(...corners.map(p => p.x)), y0: Math.min(...corners.map(p => p.y)), x1: Math.max(...corners.map(p => p.x)), y1: Math.max(...corners.map(p => p.y)) }
    }
    push('rect', r.index!, box.x0, box.y0, box.x1, box.y1)
  }
  for (const e of svg.matchAll(/<ellipse\b[^>]*?cx="([\d.e+-]+)"[^>]*?cy="([\d.e+-]+)"[^>]*?rx="([\d.e+-]+)"[^>]*?ry="([\d.e+-]+)"[^>]*>/g))
    push('ellipse', e.index!, num(e[1]) - num(e[3]), num(e[2]) - num(e[4]), num(e[1]) + num(e[3]), num(e[2]) + num(e[4]))
  for (const c of svg.matchAll(/<circle\b[^>]*?cx="([\d.e+-]+)"[^>]*?cy="([\d.e+-]+)"[^>]*?r="([\d.e+-]+)"[^>]*>/g))
    push('circle', c.index!, num(c[1]) - num(c[3]), num(c[2]) - num(c[3]), num(c[1]) + num(c[3]), num(c[2]) + num(c[3]))
  for (const p of svg.matchAll(/<polygon\b[^>]*?points="([^"]+)"[^>]*>/g)) {
    const ps = p[1]!.trim().split(/\s+/).map(q => q.split(',').map(Number))
    if (ps.length < 3) continue
    push('polygon', p.index!, Math.min(...ps.map(q => q[0]!)), Math.min(...ps.map(q => q[1]!)), Math.max(...ps.map(q => q[0]!)), Math.max(...ps.map(q => q[1]!)))
  }
  return { texts, prims }
}

const inter = (a: Box, b: Box): { w: number; h: number } => ({
  w: Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0),
  h: Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0),
})
const contains = (outer: Box, inner: Box, tol: number): boolean =>
  inner.x0 >= outer.x0 - tol && inner.y0 >= outer.y0 - tol && inner.x1 <= outer.x1 + tol && inner.y1 <= outer.y1 + tol
const sameGroupFamily = (a: string, b: string): boolean => a === b

export function audit(svg: string, opts: { textText?: number; textStraddle?: number; boxBox?: number } = {}): OverlapFinding[] {
  const TT = opts.textText ?? 1.5      // min interpenetration px to flag text-text
  const TS = opts.textStraddle ?? 3    // min px a label pokes INTO a foreign box
  const BB = opts.boxBox ?? 2          // min interpenetration px to flag box-box
  const { texts, prims } = extract(svg)
  const findings: OverlapFinding[] = []
  // Canvas bounds from the root viewBox/width/height: a label rendered past
  // them is clipped in every raster consumer.
  const vb = /viewBox="0 0 ([\d.e+-]+) ([\d.e+-]+)"/.exec(svg)
  if (vb) {
    const W = num(vb[1]), H = num(vb[2])
    for (const t of texts) {
      const over = Math.max(0 - t.x0, 0 - t.y0, t.x1 - W, t.y1 - H)
      // >4px: the measured em box overshoots real glyph extents by a couple
      // of px (descender allowance), so tiny overshoots are approximation slack.
      if (over > 4) findings.push({ kind: 'OFF-CANVAS', a: `"${t.text}"(${t.owner})`, b: `canvas ${W.toFixed(0)}x${H.toFixed(0)}`, pen: over })
    }
  }
  // Region-scale prims are crossable by design (quadrant halves, architecture
  // group borders carry cross-boundary edge labels): exempt them from the
  // straddle check, keep them for TEXT-TEXT/BOX-BOX.
  const regionOwners = new Set(prims.filter(p => p.owner.startsWith('architecture-group')).map(p => p.owner))
  const isRegionPrim = (p: PrimBox): boolean => {
    if (regionOwners.has(p.owner)) return true
    if (!vb) return false
    const W = num(vb[1]), H = num(vb[2])
    return (p.x1 - p.x0) >= 0.4 * W || (p.y1 - p.y0) >= 0.4 * H
  }
  for (let i = 0; i < texts.length; i++) {
    for (let j = i + 1; j < texts.length; j++) {
      const a = texts[i]!, b = texts[j]!
      if (sameGroupFamily(a.owner, b.owner)) continue
      const { w, h } = inter(a, b)
      if (w > TT && h > TT) findings.push({ kind: 'TEXT-TEXT', a: `"${a.text}"(${a.owner})`, b: `"${b.text}"(${b.owner})`, pen: Math.min(w, h) })
    }
  }
  for (const t of texts) {
    for (const p of prims) {
      if (t.owner === p.owner) continue
      if (isRegionPrim(p)) continue          // region borders are crossable by design
      const { w, h } = inter(t, p)
      if (w <= TS || h <= TS) continue
      if (contains(p, t, 2)) continue        // fully inside a container/owner box: legitimate
      findings.push({ kind: 'TEXT-STRADDLE', a: `"${t.text}"(${t.owner})`, b: `${p.kind}(${p.owner})`, pen: Math.min(w, h) })
    }
  }
  for (let i = 0; i < prims.length; i++) {
    for (let j = i + 1; j < prims.length; j++) {
      const a = prims[i]!, b = prims[j]!
      if (a.owner === b.owner) continue
      const { w, h } = inter(a, b)
      if (w <= BB || h <= BB) continue
      if (contains(a, b, 2) || contains(b, a, 2)) continue // container pattern: legitimate
      // An anonymous label backing rect straddling a region border is the
      // crossable-border pattern (same policy as TEXT-STRADDLE); an OWNED
      // element box (service, node) crossing a region border stays flagged —
      // that is a real containment breach.
      const anonRegionPair = (isRegionPrim(a) && b.owner.startsWith('prim#')) || (isRegionPrim(b) && a.owner.startsWith('prim#'))
      if (anonRegionPair) continue
      findings.push({ kind: 'BOX-BOX', a: `${a.kind}(${a.owner})`, b: `${b.kind}(${b.owner})`, pen: Math.min(w, h) })
    }
  }
  return findings
}
