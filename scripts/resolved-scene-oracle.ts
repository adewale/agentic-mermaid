// Chromium reference for the proposed ResolvedScene API (renderResolvedScene).
// It renders each diagram with the public API, has Chromium resolve the SVG's CSS
// (cascade, inheritance, var(), color-mix(), em units, transforms, markers, tspans),
// and writes what renderResolvedScene must return. With --compare it diffs the real
// API against that reference at the tolerances in the issue.
//
//   bun resolved-scene-oracle.ts corpus.json [--out oracle.json]   reference only
//   bun resolved-scene-oracle.ts corpus.json --compare             API vs reference
//   bun resolved-scene-oracle.ts corpus.json --self-test           the comparer catches what it should
//
// Inside the agentic-mermaid repository, import from '../src/index.ts' instead of
// 'agentic-mermaid' (both imports below), so the script reads the working tree.
//
// corpus.json: [{ "source": "flowchart LR\n A --> B", "style": "hand-drawn" }, ...]
import { readFileSync, writeFileSync } from 'node:fs'
import { chromium, type Page } from 'playwright'
import * as am from '../src/index.ts'
import type { SceneDoc, SceneNode } from '../src/index.ts'
import { createScenePartCapture } from '../src/scene/part-capture.ts'
import { resolveRenderRequestForExecution, resolvedRenderExecutionPlanOf } from '../src/render-contract.ts'
import { positionFamilyForNativeRender } from '../src/positioning.ts'
import { renderPositionedMermaidSVG } from '../src/graphical-render.ts'
import { scanSvgStartTags } from '../src/svg-structure.ts'

type Matrix = [number, number, number, number, number, number]
interface Paint {
  fill: string; fillOpacity: number; stroke: string; strokeOpacity: number; strokeWidth: number
  opacity: number; lineCap: string; lineJoin: string; miterLimit: number; fillRule: string
  paintOrder: string; dashArray?: number[]; dashOffset?: number
}
interface PathPrimitive { kind: 'path'; d: string; matrix: Matrix; paint: Paint; marker?: true }
interface TextPrimitive {
  kind: 'text'; text: string; x: number; y: number; fontSize: number; fontFamily: string[]
  fontWeight: number; fontStyle: string; anchor: string; baseline?: string
  textLength?: number; lengthAdjust?: string; letterSpacing?: number; matrix: Matrix; paint: Paint
}
type Primitive = PathPrimitive | TextPrimitive
interface ResolvedPart { id: string; role: string; kind: string; node: SceneNode; primitives: Primitive[] }
interface ResolvedScene {
  version: 2; family: string; width: number; height: number; svg: string
  colors: Record<string, string>; parts: ResolvedPart[]; frame: Primitive[]
}
interface Spec { source: string; style?: string }

/** The issue #528 Chromium oracle, adapted to source imports and the current
 * document-aware backend. Only ownership uses the private emission boundary;
 * Chromium independently computes every geometry and presentation value.
 * Unwrapped output must first equal the public SVG renderer byte for byte. */
function marked(spec: Spec): { svg: string; marked: string; family: string; doc: SceneDoc; parts: SceneNode[] } {
  const options = spec.style ? { style: spec.style } : {}
  const request = resolveRenderRequestForExecution(spec.source, options, 'svg')
  const plan = resolvedRenderExecutionPlanOf(request)
  const capture = createScenePartCapture()
  const { svg, layoutCertification } = renderPositionedMermaidSVG(request, positionFamilyForNativeRender(request), [], capture)
  if (svg !== am.renderMermaidSVG(spec.source, options)) throw new Error('Part capture changed the output')
  const viewport = plan.backend?.inputName === 'default' && layoutCertification?.repairs.length
    ? layoutCertification.viewport : undefined
  const doc = viewport ? { ...capture.scene!, width: viewport.width, height: viewport.height } : capture.scene!
  const parts: SceneNode[] = doc.parts.filter(node => node.kind !== 'document')
  const tags = scanSvgStartTags(svg)
  let marked = svg
  // Annotate the actual emitted tags without adding ancestor groups or changing
  // backend policy (which can itself affect native style/layout projection).
  for (let i = tags.length - 1; i >= 0; i--) {
    const owner = capture.owners![i]!
    if (owner < 0) continue
    const part = parts.indexOf(doc.parts[owner]!)
    const at = tags[i]!.start + 1 + tags[i]!.name.length
    marked = marked.slice(0, at) + ` data-oracle-part="${part}"` + marked.slice(at)
  }
  return { svg, marked, family: plan.family.id, doc, parts }
}

/** Runs in Chromium: every painted leaf, in paint order, with computed paint. */
function readInBrowser(svgText: string) {
  document.body.innerHTML = svgText
  const root = document.querySelector('svg')!
  const base = root.getCTM()!.inverse()
  const ctx = document.createElement('canvas').getContext('2d')!
  const out: { owner: number; p: any }[] = []
  const fail = (code: string, detail: string): never => { throw new Error(`${code}: ${detail}`) }
  // A computed colour as #rrggbb and its alpha. Canvas serialises opaque colours as hex.
  const colour = (v: string): [string, number] => {
    if (v === 'none') return ['none', 1]
    if (v.includes('url(')) fail('paint-server', v)
    ctx.fillStyle = '#000'; ctx.fillStyle = v
    const s = String(ctx.fillStyle)
    if (s.startsWith('#')) return [s.toLowerCase(), 1]
    const rgba = s.match(/^rgba?\(([\d.]+),\s*([\d.]+),\s*([\d.]+)(?:,\s*([\d.]+))?\)$/)
    if (rgba) return ['#' + rgba.slice(1, 4).map(n => Math.round(Number(n)).toString(16).padStart(2, '0')).join(''), Number(rgba[4] ?? 1)]
    const srgb = s.match(/^color\(srgb ([\d.e-]+) ([\d.e-]+) ([\d.e-]+)(?: \/ ([\d.e-]+))?\)$/)
    if (srgb) return ['#' + srgb.slice(1, 4).map(n => Math.round(Number(n) * 255).toString(16).padStart(2, '0')).join(''), Number(srgb[4] ?? 1)]
    return fail('unreadable-colour', `${v} -> ${s}`)
  }
  const len = (el: Element, key: string, fallback = 0): number => {
    const v = el.getAttribute(key)
    if (v == null) return fallback
    if (/^-?[\d.]+(?:e[-+]?\d+)?$/i.test(v)) return Number(v)
    if (/^-?[\d.]+em$/.test(v)) return parseFloat(v) * parseFloat(getComputedStyle(el).fontSize)
    if (/^-?[\d.]+px$/.test(v)) return parseFloat(v)
    return fail('unsupported-length', `${el.localName} ${key}="${v}"`)
  }
  const pathOf = (el: Element): string => {
    const n = (k: string, f = 0) => len(el, k, f)
    switch (el.localName) {
      case 'path': return el.getAttribute('d') ?? ''
      case 'line': return `M${n('x1')} ${n('y1')}L${n('x2')} ${n('y2')}`
      case 'polyline': case 'polygon': {
        const v = (el.getAttribute('points') ?? '').trim().split(/[\s,]+/).map(Number), pts: string[] = []
        for (let i = 0; i + 1 < v.length; i += 2) pts.push(`${v[i]} ${v[i + 1]}`)
        return 'M' + pts.join('L') + (el.localName === 'polygon' ? 'Z' : '')
      }
      case 'rect': {
        const x = n('x'), y = n('y'), w = n('width'), h = n('height')
        const rx = Math.min(n('rx', n('ry')), w / 2), ry = Math.min(n('ry', rx), h / 2)
        return rx && ry
          ? `M${x + rx} ${y}H${x + w - rx}A${rx} ${ry} 0 0 1 ${x + w} ${y + ry}V${y + h - ry}A${rx} ${ry} 0 0 1 ${x + w - rx} ${y + h}H${x + rx}A${rx} ${ry} 0 0 1 ${x} ${y + h - ry}V${y + ry}A${rx} ${ry} 0 0 1 ${x + rx} ${y}Z`
          : `M${x} ${y}h${w}v${h}h${-w}Z`
      }
      case 'circle': case 'ellipse': {
        const x = n('cx'), y = n('cy'), rx = n('rx', n('r')), ry = n('ry', n('r'))
        // An independent top-start, counterclockwise quarter-arc form avoids
        // Chromium's unstable near-180-degree arc choice after float rounding.
        return `M${x} ${y - ry}a${rx} ${ry} 0 0 0 ${-rx} ${ry}a${rx} ${ry} 0 0 0 ${rx} ${ry}a${rx} ${ry} 0 0 0 ${rx} ${-ry}a${rx} ${ry} 0 0 0 ${-rx} ${-ry}Z`
      }
      default: return fail('unsupported-element', el.localName)
    }
  }
  const visit = (el: Element, owner: number, given?: DOMMatrix, inherited = 1): void => {
    const tag = el.localName
    if (['defs', 'style', 'title', 'desc', 'metadata'].includes(tag)) return
    if (el.hasAttribute('data-oracle-part')) owner = Number(el.getAttribute('data-oracle-part'))
    const cs = getComputedStyle(el)
    if (cs.display === 'none' || cs.visibility === 'hidden') return
    for (const prop of ['filter', 'clip-path', 'mask']) {
      const v = cs.getPropertyValue(prop)
      if (v && v !== 'none') fail(prop, `${tag} ${v}`)
    }
    const opacity = inherited * Number(cs.opacity)
    if (tag === 'svg' || tag === 'g' || tag === 'a') { for (const c of el.children) visit(c, owner, given, opacity); return }
    const m = given ?? base.multiply((el as SVGGraphicsElement).getCTM()!)
    const [fill, fa] = colour(cs.fill), [stroke, sa] = colour(cs.stroke)
    const paint = {
      fill, fillOpacity: fa * Number(cs.fillOpacity), stroke, strokeOpacity: sa * Number(cs.strokeOpacity),
      strokeWidth: parseFloat(cs.strokeWidth), opacity, lineCap: cs.strokeLinecap, lineJoin: cs.strokeLinejoin,
      miterLimit: Number(cs.strokeMiterlimit), fillRule: cs.fillRule, paintOrder: cs.paintOrder,
      ...(cs.strokeDasharray !== 'none'
        ? { dashArray: cs.strokeDasharray.split(/[\s,]+/).map(parseFloat), dashOffset: parseFloat(cs.strokeDashoffset) }
        : {}),
    }
    const matrix = [m.a, m.b, m.c, m.d, m.e, m.f]
    if (tag === 'text') {
      if (el.querySelector('tspan')) {
        for (const child of el.children) {
          const clone = document.createElementNS(root.namespaceURI, 'text')
          for (const a of el.attributes) clone.setAttribute(a.name, a.value)
          for (const a of child.attributes) clone.setAttribute(a.name, a.value)
          clone.textContent = child.textContent
          el.parentNode!.appendChild(clone)
          visit(clone, owner, m, inherited)
          clone.remove()
        }
        return
      }
      out.push({ owner, p: {
        kind: 'text', text: el.textContent ?? '', x: len(el, 'x') + len(el, 'dx'), y: len(el, 'y') + len(el, 'dy'),
        fontSize: parseFloat(cs.fontSize),
        fontFamily: cs.fontFamily.split(',').map(f => f.trim().replace(/^["']|["']$/g, '')),
        fontWeight: Number(cs.fontWeight), fontStyle: cs.fontStyle, anchor: cs.textAnchor,
        ...(cs.dominantBaseline === 'auto' ? {} : { baseline: cs.dominantBaseline }),
        ...(el.hasAttribute('textLength') ? { textLength: len(el, 'textLength'), lengthAdjust: el.getAttribute('lengthAdjust') ?? 'spacing' } : {}),
        ...(cs.letterSpacing === 'normal' || parseFloat(cs.letterSpacing) === 0 ? {} : { letterSpacing: parseFloat(cs.letterSpacing) }),
        matrix, paint,
      } })
      return
    }
    out.push({ owner, p: { kind: 'path', d: pathOf(el), matrix, paint, ...(given ? { marker: true } : {}) } })
    if (cs.markerMid !== 'none') fail('marker-mid', tag)
    if (!(el instanceof SVGGeometryElement)) return
    const length = el.getTotalLength()
    for (const [prop, at] of [['marker-start', 0], ['marker-end', length]] as const) {
      const ref = cs.getPropertyValue(prop)
      if (ref === 'none') continue
      const id = ref.match(/#([^)"]+)/)?.[1]
      const marker = id ? document.getElementById(id) as unknown as SVGMarkerElement : null
      if (!marker) fail('marker', ref)
      const p = el.getPointAtLength(at), q = el.getPointAtLength(at === 0 ? Math.min(0.1, length) : Math.max(0, length - 0.1))
      let angle = Math.atan2(at === 0 ? q.y - p.y : p.y - q.y, at === 0 ? q.x - p.x : p.x - q.x) * 180 / Math.PI
      const orient = marker!.getAttribute('orient') ?? '0'
      if (!orient.startsWith('auto')) angle = Number(orient)
      else if (orient === 'auto-start-reverse' && at === 0) angle += 180
      const unit = marker!.getAttribute('markerUnits') === 'userSpaceOnUse' ? 1 : parseFloat(cs.strokeWidth)
      let mm = m.translate(p.x, p.y).rotate(angle).scale(unit)
      const vb = marker!.viewBox.baseVal
      if (vb && vb.width) mm = mm.scale(marker!.markerWidth.baseVal.value / vb.width, marker!.markerHeight.baseVal.value / vb.height).translate(-vb.x, -vb.y)
      mm = mm.translate(-marker!.refX.baseVal.value, -marker!.refY.baseVal.value)
      for (const c of marker!.children) visit(c, owner, mm, opacity)
    }
  }
  visit(root, -1)
  return out
}

export async function oracleScene(page: Page, spec: Spec): Promise<ResolvedScene> {
  const r = marked(spec)
  const leaves = await page.evaluate(readInBrowser, r.marked)
  const parts: ResolvedPart[] = r.parts.map(n => ({ id: n.id, role: n.role, kind: n.kind, node: n, primitives: [] }))
  const frame: Primitive[] = []
  for (const { owner, p } of leaves) (owner < 0 ? frame : parts[owner]!.primitives).push(p)
  const colors = Object.fromEntries(Object.entries(r.doc.colors).filter(([, v]) => typeof v === 'string')) as Record<string, string>
  return { version: 2, family: r.family, width: r.doc.width, height: r.doc.height, svg: r.svg, colors, parts, frame }
}

// ---- comparison -------------------------------------------------------------------------
const close = (a: number | undefined, b: number | undefined, tol = 1e-6) =>
  a === b || (a !== undefined && b !== undefined && Math.abs(a - b) <= tol * Math.max(1, Math.abs(b)))
const GEOMETRY_TOLERANCE = 0.05 // root user units (SVG px)
type ComparedPath = { d: string; m: number[] }

/** Compare centerlines independently of start, direction and command spelling.
 *  Chromium measures both paths; mutual sampled-polyline proximity permits
 *  equivalent encodings without trusting either path parser. Dashed strokes
 *  also use finer samples and stroke hit-testing for phase, caps and subpath
 *  resets. Sampling is bounded at 100,000 intervals per path. */
function sameGeometryInBrowser(pairs: { a: ComparedPath; b: ComparedPath; stroke?: Paint }[], tol: number) {
  const NS = 'http://www.w3.org/2000/svg', STEP = 0.1
  const svg = document.createElementNS(NS, 'svg'); document.body.appendChild(svg)
  const scale = (M: DOMMatrix) => Math.sqrt(Math.abs(M.a * M.d - M.b * M.c)) || 1
  const sample = (d: string, M: DOMMatrix, painted = false) => {
    const p = document.createElementNS(NS, 'path'); p.setAttribute('d', d); svg.appendChild(p)
    // The Frobenius norm bounds stretching along any tangent, including shear.
    const spacingScale = painted ? Math.hypot(M.a, M.b, M.c, M.d) : scale(M)
    const total = p.getTotalLength(), n = Math.min(100000, Math.ceil(total * spacingScale / (painted ? tol / 2 : STEP))), pts: DOMPoint[] = []
    for (let i = 0; i <= n; i++) pts.push(M.transformPoint(p.getPointAtLength(n ? total * i / n : 0)))
    p.remove()
    return { length: total * scale(M), pts }
  }
  const strokePath = (d: string, paint: Paint) => {
    const p = document.createElementNS(NS, 'path'); p.setAttribute('d', d); svg.appendChild(p)
    for (const [key, value] of Object.entries({
      fill: 'none', stroke: '#000', 'stroke-width': paint.strokeWidth,
      'stroke-linecap': paint.lineCap, 'stroke-linejoin': paint.lineJoin, 'stroke-miterlimit': paint.miterLimit,
      'stroke-dasharray': paint.dashArray?.join(' ') || 'none', 'stroke-dashoffset': paint.dashOffset ?? 0,
    })) p.style.setProperty(key, String(value), 'important')
    return p
  }
  const offsets = Array.from({ length: 8 }, (_, i) => [Math.cos(i * Math.PI / 4) * tol, Math.sin(i * Math.PI / 4) * tol])
  const offInk = (points: DOMPoint[], from: SVGPathElement, fromInverse: DOMMatrix, to: SVGPathElement, toInverse: DOMMatrix) => {
    for (const point of points) {
      if (!from.isPointInStroke(fromInverse.transformPoint(point))) continue
      if (to.isPointInStroke(toInverse.transformPoint(point))) continue
      if (!offsets.some(([x, y]) => to.isPointInStroke(toInverse.transformPoint(new DOMPoint(point.x + x!, point.y + y!)))))
        return `dash placement differs near (${point.x.toFixed(3)}, ${point.y.toFixed(3)})`
    }
    return ''
  }
  const segDist = (p: DOMPoint, a: DOMPoint, b: DOMPoint) => {
    const dx = b.x - a.x, dy = b.y - a.y, l = dx * dx + dy * dy
    const t = l ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l)) : 0
    return Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy)
  }
  // Index of the first point of `from` farther than tol from the polyline `to`, or -1.
  const off = (from: DOMPoint[], to: DOMPoint[]): number => {
    const cell = Math.max(tol, STEP) * 2, grid = new Map<string, number[]>()
    const add = (k: string, i: number) => (grid.get(k) ?? grid.set(k, []).get(k)!).push(i)
    for (let i = 0; i < Math.max(1, to.length - 1); i++) {
      const a = to[i]!, b = to[Math.min(i + 1, to.length - 1)]!
      for (let gx = Math.floor((Math.min(a.x, b.x) - tol) / cell); gx <= Math.floor((Math.max(a.x, b.x) + tol) / cell); gx++)
        for (let gy = Math.floor((Math.min(a.y, b.y) - tol) / cell); gy <= Math.floor((Math.max(a.y, b.y) + tol) / cell); gy++) add(`${gx},${gy}`, i)
    }
    for (const [j, p] of from.entries()) {
      const near = grid.get(`${Math.floor(p.x / cell)},${Math.floor(p.y / cell)}`) ?? []
      if (!near.some(i => segDist(p, to[i]!, to[Math.min(i + 1, to.length - 1)]!) <= tol)) return j
    }
    return -1
  }
  const result = pairs.map(({ a, b, stroke }) => {
    // Equal path data and linear maps have identical lengths. A translation
    // moves every point by the same distance, proving the geometry tolerance
    // without sampling huge hatched paths for CTM inversion roundoff.
    if (a.d === b.d && a.m.slice(0, 4).every((v, i) => v === b.m[i])
      && Math.hypot(a.m[4]! - b.m[4]!, a.m[5]! - b.m[5]!) <= tol) return ''
    if (a.d === b.d && a.m.slice(0, 4).every((v, i) =>
      Math.abs(v - b.m[i]!) <= 16 * Number.EPSILON * Math.max(1, Math.abs(v), Math.abs(b.m[i]!)))) {
      const A = new DOMMatrix(a.m), B = new DOMMatrix(b.m)
      const sa = scale(A), sb = scale(B)
      if (Math.abs(sa - sb) <= 1e-12 * Math.max(sa, sb)) {
        const path = document.createElementNS(NS, 'path'); path.setAttribute('d', a.d); svg.appendChild(path)
        const box = path.getBBox(); path.remove()
        // An affine displacement attains its maximum on a bounding-box
        // corner. This proves sub-micro-unit displacement of the entire ink,
        // and the scale check proves the length tolerance, without sampling.
        if ([[box.x, box.y], [box.x + box.width, box.y], [box.x, box.y + box.height], [box.x + box.width, box.y + box.height]].every(([x, y]) => {
          const p = A.transformPoint(new DOMPoint(x, y)), q = B.transformPoint(new DOMPoint(x, y))
          return Math.hypot(p.x - q.x, p.y - q.y) < 1e-7
        })) return ''
      }
    }
    // Finer samples reduce aliasing at dash boundaries and after a moveto.
    const A = sample(a.d, new DOMMatrix(a.m), Boolean(stroke)), B = sample(b.d, new DOMMatrix(b.m), Boolean(stroke))
    if (Math.abs(A.length - B.length) > 0.01 + 1e-4 * Math.max(A.length, B.length)) return `length ${A.length.toFixed(4)} vs ${B.length.toFixed(4)}`
    const offA = off(A.pts, B.pts)
    if (offA >= 0) return `point ${offA}/${A.pts.length - 1} of the API path is more than ${tol} from the reference`
    const offB = off(B.pts, A.pts)
    if (offB >= 0) return `point ${offB}/${B.pts.length - 1} of the reference is more than ${tol} from the API path`
    if (stroke) {
      const pa = strokePath(a.d, stroke), pb = strokePath(b.d, stroke), ia = new DOMMatrix(a.m).inverse(), ib = new DOMMatrix(b.m).inverse()
      try { return offInk(A.pts, pa, ia, pb, ib) || offInk(B.pts, pb, ib, pa, ia) }
      finally { pa.remove(); pb.remove() }
    }
    return ''
  })
  svg.remove()
  return result
}

export async function compareScenes(page: Page, api: ResolvedScene, ref: ResolvedScene): Promise<string[]> {
  const bad: string[] = []
  const say = (where: string, what: string) => bad.push(`${where}: ${what}`)
  for (const k of ['version', 'family', 'width', 'height'] as const) if (api[k] !== ref[k]) say(k, `${api[k]} vs ${ref[k]}`)
  if (api.svg !== ref.svg) say('svg', 'differs from renderMermaidSVG with the same options')
  for (const [k, v] of Object.entries(ref.colors)) if (api.colors?.[k]?.toLowerCase() !== v.toLowerCase()) say(`colors.${k}`, `${api.colors?.[k]} vs ${v}`)
  const groups: [string, Primitive[], Primitive[]][] = [['frame', api.frame ?? [], ref.frame]]
  if (api.parts.length !== ref.parts.length) say('parts', `${api.parts.length} vs ${ref.parts.length}`)
  ref.parts.forEach((rp, i) => {
    const ap = api.parts[i]
    if (!ap) return
    for (const k of ['id', 'role', 'kind'] as const) if (ap[k] !== rp[k]) say(`parts[${i}].${k}`, `${ap[k]} vs ${rp[k]}`)
    if (JSON.stringify(ap.node) !== JSON.stringify(rp.node)) say(`parts[${i}].node`, 'differs from the SceneDoc part')
    groups.push([`parts[${i}] ${rp.id}`, ap.primitives, rp.primitives])
  })
  const geometry: { where: string; a: ComparedPath; b: ComparedPath; stroke?: Paint }[] = []
  for (const [where, a, r] of groups) {
    if (a.length !== r.length) { say(where, `${a.length} primitives vs ${r.length}`); continue }
    r.forEach((rp, j) => {
      const ap = a[j]!, at = `${where} #${j}`
      if (ap.kind !== rp.kind) return say(at, `kind ${ap.kind} vs ${rp.kind}`)
      const P = ap.paint, R = rp.paint
      for (const k of ['fill', 'stroke'] as const) if (P[k]?.toLowerCase() !== R[k]) say(at, `${k} ${P[k]} vs ${R[k]}`)
      for (const k of ['lineCap', 'lineJoin', 'fillRule', 'paintOrder'] as const) if (P[k] !== R[k]) say(at, `${k} ${P[k]} vs ${R[k]}`)
      for (const k of ['strokeWidth', 'opacity', 'miterLimit', 'dashOffset'] as const) if (!close(P[k], R[k])) say(at, `${k} ${P[k]} vs ${R[k]}`)
      for (const k of ['fillOpacity', 'strokeOpacity'] as const) if (!close(P[k], R[k], 1 / 255)) say(at, `${k} ${P[k]} vs ${R[k]}`)
      if ((P.dashArray ?? []).length !== (R.dashArray ?? []).length || (R.dashArray ?? []).some((v, n) => !close(P.dashArray?.[n], v)))
        say(at, `dashArray ${P.dashArray} vs ${R.dashArray}`)
      ap.matrix.forEach((v, n) => { if (!close(v, rp.matrix[n], n < 4 ? 1e-6 : 1e-4)) say(at, `matrix[${n}] ${v} vs ${rp.matrix[n]}`) })
      if (rp.kind === 'text' && ap.kind === 'text') {
        for (const k of ['text', 'anchor', 'baseline', 'lengthAdjust', 'fontWeight', 'fontStyle'] as const) if (ap[k] !== rp[k]) say(at, `${k} ${ap[k]} vs ${rp[k]}`)
        if (ap.fontFamily?.[0] !== rp.fontFamily[0]) say(at, `fontFamily ${ap.fontFamily?.[0]} vs ${rp.fontFamily[0]}`)
        for (const k of ['x', 'y', 'fontSize', 'textLength', 'letterSpacing'] as const) if (!close(ap[k], rp[k])) say(at, `${k} ${ap[k]} vs ${rp[k]}`)
      } else if (rp.kind === 'path' && ap.kind === 'path') {
        // Matrix differences already fail the comparison independently. Avoid
        // resampling all the ink merely to report the same failure twice.
        if (ap.matrix.every((v, n) => close(v, rp.matrix[n], n < 4 ? 1e-6 : 1e-4))) {
          // Paint differences already fail above; compare placement under the
          // reference paint and transfer it only for visible dashed strokes.
          const stroke = R.stroke !== 'none' && R.strokeWidth > 0 && R.opacity > 0 && R.strokeOpacity > 0
            && R.dashArray?.some(value => value > 0) ? R : undefined
          geometry.push({ where: at, a: { d: ap.d, m: ap.matrix }, b: { d: rp.d, m: rp.matrix }, stroke })
        }
      }
    })
  }
  const verdicts: string[] = await page.evaluate(({ src, pairs, tol }) => (0, eval)(`(${src})`)(pairs, tol),
    { src: sameGeometryInBrowser.toString(), pairs: geometry.map(({ a, b, stroke }) => ({ a, b, stroke })), tol: GEOMETRY_TOLERANCE })
  verdicts.forEach((v, n) => { if (v) say(geometry[n]!.where, `geometry ${v}`) })
  return bad
}

// ---- command line -------------------------------------------------------------------------
async function main() {
  const [file, ...flags] = process.argv.slice(2)
  if (!file) throw new Error('usage: resolved-scene-oracle.ts corpus.json [--out file] [--compare] [--self-test]')
  const corpus: Spec[] = JSON.parse(readFileSync(file, 'utf8'))
  // CHROMIUM: a browser binary to use when Playwright's own download is not installed.
  const browser = await chromium.launch(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {})
  const page = await browser.newPage()
  await page.route('**/*', r => r.abort())
  await page.setContent('<!doctype html><body></body>')
  const api = (am as Record<string, unknown>).renderResolvedScene as ((s: string, o: object) => ResolvedScene) | undefined
  const scenes: ResolvedScene[] = [], failures: string[] = []
  const comparerChecks = new Set<string>()
  const bundleAt = flags.indexOf('--worker-bundle')
  if (bundleAt >= 0) {
    const bundle = readFileSync(flags[bundleAt + 1]!, 'utf8')
    const receipt = await page.evaluate(code => new Promise<Record<string, unknown>>((resolve, reject) => {
      const script = code + `;self.onmessage=()=>{try {
        const source='flowchart LR\\n A -->|uses ELK| B', options={style:'hand-drawn'};
        const scene=agenticMermaid.renderResolvedScene(source,options);
        self.postMessage({version:scene.version,parts:scene.parts.length,document:typeof document,
          equal:scene.svg===agenticMermaid.renderMermaidSVG(source,options),
          jsonSafe:JSON.stringify(JSON.parse(JSON.stringify(scene)))===JSON.stringify(scene)});
      } catch(error){self.postMessage({error:error.message})}};`
      const url = URL.createObjectURL(new Blob([script], { type: 'text/javascript' }))
      const worker = new Worker(url)
      const cleanup = () => { clearTimeout(timer); worker.terminate(); URL.revokeObjectURL(url) }
      const timer = setTimeout(() => { cleanup(); reject(new Error('Resolved Scene Worker timed out')) }, 30000)
      worker.onmessage = event => { cleanup(); resolve(event.data) }
      worker.onerror = event => { cleanup(); reject(new Error(event.message)) }
      worker.postMessage(null)
    }), bundle)
    if (receipt.error || receipt.version !== 2 || !(Number(receipt.parts) > 0)
      || receipt.document !== 'undefined' || receipt.equal !== true || receipt.jsonSafe !== true) {
      throw new Error(`Resolved Scene Worker failed: ${JSON.stringify(receipt)}`)
    }
    console.log('Browser Worker:', JSON.stringify(receipt))
  }
  for (const [i, spec] of corpus.entries()) {
    const label = `#${i} ${spec.source.split('\n')[0]!.trim()} [${spec.style ?? 'default'}]`
    if (flags.includes('--progress')) console.log(label)
    let ref: ResolvedScene
    try { ref = await oracleScene(page, spec) } catch (e) { failures.push(`${label}: oracle refused: ${(e as Error).message}`); continue }
    scenes.push(ref)
    if (flags.includes('--compare')) {
      if (!api) throw new Error('agentic-mermaid exports no renderResolvedScene')
      let got: ResolvedScene | undefined
      try { got = api(spec.source, spec.style ? { style: spec.style } : {}) } catch (e) { failures.push(`${label}: API threw ${(e as Error).message}`) }
      if (got) {
        if (JSON.stringify(JSON.parse(JSON.stringify(got))) !== JSON.stringify(got)) failures.push(`${label}: not JSON-safe`)
        if (JSON.stringify(api(spec.source, spec.style ? { style: spec.style } : {})) !== JSON.stringify(got)) failures.push(`${label}: not deterministic`)
        for (const d of await compareScenes(page, got, ref)) failures.push(`${label}: ${d}`)
      }
    }
    if (flags.includes('--self-test')) failures.push(...(await selfTest(page, ref, comparerChecks)).map(d => `${label}: ${d}`))
  }
  await browser.close()
  const out = flags[flags.indexOf('--out') + 1]
  if (flags.includes('--out') && out) writeFileSync(out, JSON.stringify(scenes, null, 1))
  const prims = scenes.reduce((n, s) => n + s.frame.length + s.parts.reduce((m, p) => m + p.primitives.length, 0), 0)
  console.log(`${corpus.length} diagrams, ${scenes.length} read, ${prims} primitives, ${failures.length} failures`)
  for (const f of failures.slice(0, 200)) console.log('  ' + f)
  if (flags.includes('--self-test')) console.log('comparer checks:', [...comparerChecks])
  process.exitCode = failures.length ? 1 : 0
}

/** Each defect is checked on its first eligible scene, once per corpus run. */
export async function selfTest(page: Page, ref: ResolvedScene, checked = new Set<string>()): Promise<string[]> {
  const copy = () => JSON.parse(JSON.stringify(ref)) as ResolvedScene
  const problems: string[] = []
  if (!checked.has('reference')) {
    checked.add('reference')
    if ((await compareScenes(page, copy(), ref)).length) problems.push('self-test: reference differs from itself')
  }
  const paths = (s: ResolvedScene) => s.parts.flatMap(p => p.primitives).filter((p): p is PathPrimitive => p.kind === 'path' && !p.marker)
  const plant = async (name: string, change: (s: ResolvedScene) => boolean, expectFailure: boolean) => {
    if (checked.has(name)) return
    const s = copy()
    if (!change(s)) return
    checked.add(name)
    const found = (await compareScenes(page, s, ref)).length > 0
    if (found !== expectFailure) problems.push(`self-test: ${name} ${expectFailure ? 'was not caught' : 'was wrongly flagged'}`)
  }
  await plant('path moved 0.1px', s => { const p = paths(s)[0]; if (!p) return false; p.matrix[4] += 0.1; return true }, true)
  await plant('fill changed', s => { const p = paths(s).find(path => path.paint.fill !== 'none'); if (!p) return false; p.paint.fill = p.paint.fill === '#000000' ? '#000001' : '#000000'; return true }, true)
  await plant('primitive dropped', s => { const p = s.parts.find(x => x.primitives.length); if (!p) return false; p.primitives.pop(); return true }, true)
  await plant('rect redrawn from another corner, other direction', s => {
    const rectangle = /^M(\S+) (\S+)h(\S+)v(\S+)h\S+Z$/
    // Reversing a dashed path can move its visible dashes despite equal geometry.
    const p = paths(s).find(path => !path.paint.dashArray?.length && rectangle.test(path.d)), m = p?.d.match(rectangle)
    if (!p || !m) return false
    const [x, y, w, h] = m.slice(1).map(Number) as [number, number, number, number]
    p.d = `M${x + w} ${y + h}V${y}H${x}V${y + h}Z`
    return true
  }, false)
  return problems
}

if (import.meta.main ?? process.argv[1]?.endsWith('resolved-scene-oracle.ts')) await main()
