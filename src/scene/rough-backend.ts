// ============================================================================
// RoughBackend (SPEC §3.2/§11 phase 3) — rough.js-backed sketch serialization
// of the SceneGraph. Headless (RoughGenerator + opsToPath, no DOM), version-
// pinned, and deterministic: every stochastic mark is seeded per the §8
// contract — hash(options.seed, stableSceneNodeId, substream) — so identical
// input yields identical bytes.
//
// Role-aware by design (the Freestyle select→perturb shape): diagram shapes
// and connectors are redrawn as sketchy strokes; axes, grids, chrome, icons,
// legends, and ALL text stay crisp so charts remain readable. Labels get a
// page-colored paint-order halo (cartographic practice: text drawn last,
// never perturbed — SPEC §7). Marker defs pass through with
// their authored markerUnits (including SVG's strokeWidth default). The
// original connector
// element is kept as an invisible carrier (stroke-opacity="0"), preserving
// markers, class/data-* attributes, and hit geometry under the sketch.
//
// Shape paint truth still comes from the mark's owned-format element attributes
// with semantic MarkPaint as the fallback for class-painted marks. Connector
// paint/stroke/route truth is wholly typed: styled backends never inspect a
// connector's crisp serialization. A shape child with
// stroke="none" — or an author-suppressed stroke-width of 0 — never grows a
// synthesized outline, and fills keep their semantic colors (gantt status,
// pie slices) unless the style's fill policy redraws them.
// ============================================================================

import { RoughGenerator } from 'roughjs/bin/generator'
import type { Geometry, SceneDoc, SceneNode, SceneTransform, ShapeMark, ConnectorMark, TextMark } from './ir.ts'
import { connectorSubpaths } from './connector-geometry.ts'
import type { StyleBackend, StyleBackendContext } from './backend.ts'
import { composeGroup, pageRectFor } from './backend.ts'
import { nodeSeed } from './seed.ts'
import { topLevelElements } from './fidelity.ts'
import type { StyleSpec } from './style-registry.ts'
import { ensureSvgIdentity } from './identity.ts'
import { sceneRoleTraits } from './roles.ts'
import { graphicalBackendCapabilityClaims } from './capabilities.ts'
import { admitBackendSceneDocument } from './external-data-snapshot.ts'
import { escapeAttr } from '../multiline-utils.ts'

const gen = new RoughGenerator()

export interface RoughParams {
  roughness: number
  bowing: number
  passes: number
  strokeWidth: number
  fill: 'none' | 'hachure' | 'solid' | 'wash'
  hachureAngle: number
  hachureGap: number
  fillWeight: number
}

/** SVG stroke fields that survive semantic connector lowering into a visible
 * sketch path. Shape sketching leaves these unspecified and retains the
 * long-standing round-cap/round-join defaults. */
export interface SketchStrokeProjection {
  dashArray?: string
  dashOffset?: string | number
  lineCap?: 'butt' | 'round' | 'square'
  lineJoin?: 'arcs' | 'bevel' | 'miter' | 'miter-clip' | 'round'
  miterLimit?: number
  opacity?: string | number
  pathLength?: number
  paintOrder?: string
  nonScaling?: boolean
}

/** A pluggable geometry renderer: return null to fall back to rough.js.
 *  HybridBackend supplies perfect-freehand ribbons and watercolor washes;
 *  RoughBackend uses pure rough.js. */
export type GeometrySketcher = (
  geom: Geometry,
  opts: {
    seed: number
    stroke: string
    width: number
    fill: string | undefined
    p: RoughParams
    style: StyleSpec | undefined
    dash: string | undefined
    strokeProjection: SketchStrokeProjection | undefined
  },
) => string | null

/** Per-render walk state — threaded, never module-global, so backends can
 *  nest or interleave without clobbering each other's sketcher. */
interface Walk {
  ctx: StyleBackendContext
  p: RoughParams
  sketcher?: GeometrySketcher
}

function paramsOf(style: StyleSpec | undefined): RoughParams {
  return {
    roughness: style?.roughness ?? 1.0,
    bowing: style?.bowing ?? 1,
    passes: style?.passes ?? 2,
    strokeWidth: style?.strokeWidth ?? 1.6,
    fill: style?.fill ?? 'none',
    hachureAngle: style?.hachureAngle ?? -41,
    hachureGap: style?.hachureGap ?? 5,
    fillWeight: style?.fillWeight ?? 0.9,
  }
}

function roughOptions(p: RoughParams, seed: number, stroke: string, strokeWidth: number, fill?: string) {
  return {
    seed,
    roughness: p.roughness,
    bowing: p.bowing,
    stroke,
    strokeWidth,
    disableMultiStroke: p.passes < 2,
    ...(fill ? { fill, fillStyle: p.fill === 'solid' ? 'solid' : 'hachure', fillWeight: p.fillWeight, hachureGap: p.hachureGap, hachureAngle: p.hachureAngle } : {}),
    preserveVertices: false,
  }
}

function projectedStrokeAttributes(projection: SketchStrokeProjection = {}): string {
  const attrs = [
    `stroke-linecap="${projection.lineCap ?? 'round'}"`,
    `stroke-linejoin="${projection.lineJoin ?? 'round'}"`,
    ...(projection.miterLimit !== undefined ? [`stroke-miterlimit="${escapeAttr(String(projection.miterLimit))}"`] : []),
    ...(projection.dashArray !== undefined ? [`stroke-dasharray="${escapeAttr(projection.dashArray)}"`] : []),
    ...(projection.dashOffset !== undefined ? [`stroke-dashoffset="${escapeAttr(String(projection.dashOffset))}"`] : []),
    ...(projection.opacity !== undefined ? [`stroke-opacity="${escapeAttr(String(projection.opacity))}"`] : []),
    ...(projection.pathLength !== undefined ? [`pathLength="${escapeAttr(String(projection.pathLength))}"`] : []),
    ...(projection.paintOrder !== undefined ? [`paint-order="${escapeAttr(projection.paintOrder)}"`] : []),
    ...(projection.nonScaling ? ['vector-effect="non-scaling-stroke"'] : []),
  ]
  return attrs.join(' ')
}

/** Serialize a rough Drawable's OpSets into <path> elements. */
function opsToSvg(
  sets: Array<{ type: string; ops: unknown[] }>,
  stroke: string,
  strokeWidth: number,
  fill: string | undefined,
  p: RoughParams,
  projection: SketchStrokeProjection = {},
): string {
  const out: string[] = []
  const strokeAttrs = projectedStrokeAttributes(projection)
  for (const set of sets) {
    const d = gen.opsToPath(set as Parameters<typeof gen.opsToPath>[0], 2)
    if (!d) continue
    if (set.type === 'path') {
      out.push(`<path d="${d}" fill="none" stroke="${stroke}" stroke-width="${strokeWidth}" ${strokeAttrs} />`)
    } else if (set.type === 'fillPath') {
      out.push(`<path d="${d}" fill="${fill}" fill-opacity="0.92" stroke="none" />`)
    } else if (set.type === 'fillSketch') {
      out.push(`<path d="${d}" fill="none" stroke="${fill}" stroke-width="${p.fillWeight}" />`)
    }
  }
  return out.join('\n')
}

function roundedRectPath(x: number, y: number, w: number, h: number, r: number): string {
  const rr = Math.min(r, w / 2, h / 2)
  return `M ${x + rr} ${y} L ${x + w - rr} ${y} Q ${x + w} ${y} ${x + w} ${y + rr} L ${x + w} ${y + h - rr} Q ${x + w} ${y + h} ${x + w - rr} ${y + h} L ${x + rr} ${y + h} Q ${x} ${y + h} ${x} ${y + h - rr} L ${x} ${y + rr} Q ${x} ${y} ${x + rr} ${y} Z`
}

/** Draw one geometry with rough.js. `fill` undefined means outline-only.
 *  Exported for HybridBackend's fallback path. */
export function sketchGeometryRough(
  geom: Geometry,
  seed: number,
  stroke: string,
  strokeWidth: number,
  fill: string | undefined,
  p: RoughParams,
  dash?: string,
  strokeProjection?: SketchStrokeProjection,
): string {
  return sketchGeometry(geom, seed, stroke, strokeWidth, fill, p, dash, strokeProjection)
}

/** Draw one geometry with rough.js. `fill` undefined means outline-only. */
function sketchGeometry(
  geom: Geometry,
  seed: number,
  stroke: string,
  strokeWidth: number,
  fill: string | undefined,
  p: RoughParams,
  dash?: string,
  strokeProjection?: SketchStrokeProjection,
): string {
  const projection = { ...strokeProjection, ...(dash !== undefined ? { dashArray: dash } : {}) }
  const opts = roughOptions(p, seed, stroke, strokeWidth, fill)
  try {
    switch (geom.kind) {
      case 'rect': {
        if ((geom.rx ?? 0) > 0.5) {
          return opsToSvg(gen.path(roundedRectPath(geom.x, geom.y, geom.width, geom.height, geom.rx!), opts).sets, stroke, strokeWidth, fill, p, projection)
        }
        return opsToSvg(gen.rectangle(geom.x, geom.y, geom.width, geom.height, opts).sets, stroke, strokeWidth, fill, p, projection)
      }
      case 'circle':
        return opsToSvg(gen.circle(geom.cx, geom.cy, geom.r * 2, opts).sets, stroke, strokeWidth, fill, p, projection)
      case 'ellipse':
        return opsToSvg(gen.ellipse(geom.cx, geom.cy, geom.rx * 2, geom.ry * 2, opts).sets, stroke, strokeWidth, fill, p, projection)
      case 'line':
        return opsToSvg(gen.line(geom.x1, geom.y1, geom.x2, geom.y2, opts).sets, stroke, strokeWidth, undefined, p, projection)
      case 'polygon':
        return opsToSvg(gen.polygon(geom.points.map(q => [q.x, q.y] as [number, number]), opts).sets, stroke, strokeWidth, fill, p, projection)
      case 'polyline':
        return opsToSvg(gen.linearPath(geom.points.map(q => [q.x, q.y] as [number, number]), opts).sets, stroke, strokeWidth, undefined, p, projection)
      case 'path':
        return opsToSvg(gen.path(geom.d, opts).sets, stroke, strokeWidth, fill, p, projection)
      case 'compound':
        // Callers handle compound per-child (per-child paint differs).
        return ''
    }
  } catch {
    return '' // unsupported path command → caller falls back to crisp
  }
}

function sketchGeometryVia(
  walk: Walk,
  geom: Geometry,
  seed: number,
  stroke: string,
  width: number,
  fill: string | undefined,
  dash?: string,
  strokeProjection?: SketchStrokeProjection,
): string {
  if (walk.sketcher) {
    const out = walk.sketcher(geom, { seed, stroke, width, fill, p: walk.p, style: walk.ctx.style, dash, strokeProjection })
    if (out !== null) return out
  }
  return sketchGeometry(geom, seed, stroke, width, fill, walk.p, dash, strokeProjection)
}

/** Inject attributes right after the opening tag of an owned-format element.
 *  The emitters always follow the tag name with a space, so a plain string
 *  replace suffices (no per-call RegExp construction). */
function injectAttrs(element: string, tag: string, attrs: string): string {
  return element.replace(`<${tag} `, `<${tag} ${attrs} `)
}

/** Effective stroke-width ratio from a crisp attribute. Handles the cases
 *  Number() gets wrong: unit suffixes ('4px' → 4) and an explicit 0 (an
 *  author-suppressed border must NOT fall back to 1 — return 0 so the caller
 *  skips outline synthesis entirely). */
function strokeWidthRatio(attr: string | number | undefined): number {
  if (attr === undefined) return 1
  const parsed = typeof attr === 'number' ? attr : parseFloat(attr)
  if (Number.isNaN(parsed)) return 1
  return parsed
}

function attrOrPaint(attrValue: string | undefined, paintValue: string | undefined): string | undefined {
  return attrValue !== undefined ? attrValue : paintValue
}

function suppressStroke(element: string, tag: string): string {
  if (/style="/.test(element)) {
    return element.replace(/style="([^"]*)"/, (_match, style: string) => {
      const separator = style.trim().length === 0 || /;\s*$/.test(style) ? '' : ';'
      return `style="${style}${separator}stroke:none"`
    })
  }

  return injectAttrs(element, tag, 'style="stroke:none"')
}

function transformedStyledGeometry(svg: string, transform: SceneTransform | undefined): string {
  if (!transform || svg === '') return svg
  if (transform.kind === 'rotate') return `<g transform="rotate(${transform.angle} ${transform.cx} ${transform.cy})">${svg}</g>`
  return svg
}

function sketchShape(node: ShapeMark, walk: Walk): string {
  const p = walk.p
  const els = topLevelElements(node.crisp)
  const geoms: Geometry[] = node.geometry.kind === 'compound' ? node.geometry.children : [node.geometry]
  if (els.length < geoms.length) return node.crisp // crisp/semantic mismatch → stay safe
  // Multi-element crisps in this codebase place one element per line.
  const crispLines = node.crisp.split('\n')
  const crispElementOf = (i: number) => (crispLines.length === 1 && i === 0 ? node.crisp : crispLines[i] ?? '')
  const out: string[] = []
  for (let i = 0; i < geoms.length; i++) {
    const el = els[i]!
    const stroke = attrOrPaint(el.attrs.get('stroke'), node.paint.stroke)
    const fill = attrOrPaint(el.attrs.get('fill'), node.paint.fill)
    const seed = nodeSeed(walk.ctx.seed, node.id, `outline:${i}`) || 1
    const widthRatio = strokeWidthRatio(attrOrPaint(el.attrs.get('stroke-width'), node.paint.strokeWidth))
    const dash = attrOrPaint(el.attrs.get('stroke-dasharray'), node.paint.strokeDasharray)
    const hasStroke = stroke !== undefined && stroke !== 'none' && widthRatio > 0
    const hasFill = fill !== undefined && fill !== 'none'
    // Fill policy: 'none' keeps boxes open (people write inside them);
    // semantic value fills (status colors, slice hues) are preserved either
    // solid-crisp (fill:'none' style keeps the region honest via the crisp
    // element) or re-rendered as hachure/solid sketch fill.
    const wantFill = hasFill && p.fill !== 'none' ? fill : undefined
    if (!hasStroke) {
      // Stroke-less element (gantt bands, halo chips, state-start dots,
      // width-0 borders): never synthesize an outline (Phase 0 lesson b).
      if (wantFill) {
        const sketchedFill = sketchGeometryVia(walk, geoms[i]!, seed, 'none', 0, wantFill, dash)
        if (sketchedFill) {
          out.push(transformedStyledGeometry(sketchedFill, node.transform))
          continue
        }
      }
      out.push(crispElementOf(i))
      continue
    }
    const width = Math.max(0.6, Math.min(p.strokeWidth * widthRatio, p.strokeWidth * 4))
    const sketched = sketchGeometryVia(walk, geoms[i]!, seed, stroke!, width, wantFill, dash)
    if (!sketched) { out.push(crispElementOf(i)); continue }
    // Value-colored solid fills stay: when the style suppresses sketch fills
    // but the element carries a non-default fill, under-paint it crisply so
    // semantic color survives (status bars, quadrant plates).
    if (hasFill && p.fill === 'none' && !isBoxFill(fill!)) {
      out.push(suppressStroke(crispElementOf(i), el.tag))
    }
    out.push(transformedStyledGeometry(sketched, node.transform))
  }
  const serialized = out.filter(Boolean).join('\n')
  return node.identity && !/\sdata-id=/.test(serialized)
    ? ensureSvgIdentity(serialized, node.identity)
    : serialized
}

/** Default node-surface fills we may drop when a style wants open boxes;
 *  anything else (status colors, series hues, inline styles) is semantic. */
function isBoxFill(fill: string): boolean {
  return fill.startsWith('var(--_node-fill') || fill.startsWith('var(--_group') || fill === 'var(--bg)' || fill === 'var(--surface)'
}

function sketchConnector(node: ConnectorMark, walk: Walk): string {
  if (node.lineStyle === 'invisible' || node.crisp === '') return node.crisp
  const stroke = node.stroke.color
  const widthRatio = strokeWidthRatio(node.stroke.width)
  if (widthRatio <= 0) return node.crisp // author-suppressed stroke stays suppressed
  const width = walk.p.strokeWidth * widthRatio
  const seed = nodeSeed(walk.ctx.seed, node.id, 'stroke') || 1
  const dash = node.stroke.dash
    ? typeof node.stroke.dash.array === 'string' ? node.stroke.dash.array : node.stroke.dash.array.join(' ')
    : undefined
  const strokeProjection: SketchStrokeProjection = {
    ...(dash !== undefined ? { dashArray: dash } : {}),
    ...(node.stroke.dash?.offset !== undefined ? { dashOffset: node.stroke.dash.offset } : {}),
    lineCap: node.stroke.lineCap,
    lineJoin: node.stroke.lineJoin,
    miterLimit: node.stroke.miterLimit,
    ...(node.stroke.opacity !== undefined ? { opacity: node.stroke.opacity } : {}),
    ...(node.stroke.pathLength !== undefined ? { pathLength: node.stroke.pathLength } : {}),
    ...(node.stroke.paintOrder !== undefined ? { paintOrder: node.stroke.paintOrder } : {}),
    nonScaling: node.stroke.nonScaling,
  }
  let sketched = ''
  const geom = node.geometry
  if (geom.kind === 'polyline') {
    sketched = sketchGeometryVia(walk, { kind: 'polyline', points: geom.points }, seed, stroke, width, undefined, dash, strokeProjection)
  } else if (geom.kind === 'line') {
    sketched = sketchGeometryVia(walk, geom, seed, stroke, width, undefined, dash, strokeProjection)
  } else {
    const subpaths = connectorSubpaths(geom, node.route.closed)
    if (subpaths.length === 1) {
      // Preserve the authored curve exactly when there is no multi-contour
      // bridge risk. The typed routed polyline remains the authority for
      // bounds and hit testing, not a replacement drawing path.
      sketched = sketchGeometryVia(walk, { kind: 'path', d: geom.d }, seed, stroke, width, undefined, dash, strokeProjection)
    }
    if (!sketched && geom.points.length > 1) {
      // Sketch multiple typed contours independently so an SVG `M` can never
      // become a visible bridge. This also provides a bounded fallback when
      // rough.js cannot consume a supported single-contour path command.
      const projected = subpaths.map((subpath, index) => {
        const first = subpath.points[0]
        const last = subpath.points.at(-1)
        const points = subpath.closed && first && last && (first.x !== last.x || first.y !== last.y)
          ? [...subpath.points, first]
          : subpath.points
        return sketchGeometryVia(
          walk,
          { kind: 'polyline', points: [...points] },
          seed + index,
          stroke,
          width,
          undefined,
          dash,
          strokeProjection,
        )
      })
      sketched = projected.every(Boolean) ? projected.join('\n') : ''
    }
  }
  if (!sketched) return node.crisp
  // Keep the original element as an invisible carrier: markers, class/data-*
  // attributes, and hit geometry survive (stroke-opacity 0 hides the crisp
  // stroke while markers still render at full opacity from markerUnits defs).
  const hidden = node.crisp.replace(
    /\sstroke-opacity=(?:"[^"]*"|'[^']*')/,
    ' stroke-opacity="0"',
  )
  const carrier = hidden === node.crisp
    ? injectAttrs(node.crisp, node.geometry.kind, 'stroke-opacity="0"')
    : hidden
  return `${carrier}\n${transformedStyledGeometry(sketched, node.transform)}`
}

// Cartographic halo: knock the text out to the page so glyphs never sit
// directly on strokes/fills. Injected on every <text> in the chunk; tspans
// inherit. paint-order draws the stroke behind the glyph.
function haloText(node: TextMark): string {
  return node.crisp.replace(/<text /g, '<text paint-order="stroke" stroke="var(--bg)" stroke-width="3" stroke-linejoin="round" stroke-linecap="round" ')
}

function backdropFor(style: StyleSpec | undefined, doc: SceneDoc): string {
  const kind = style?.backdrop ?? 'plain'
  if (kind === 'paper-ruled') {
    const lines: string[] = ['<g data-backdrop="paper-ruled">']
    for (let y = 26; y < doc.height; y += 26) {
      lines.push(`  <line x1="0" y1="${y}" x2="${doc.width}" y2="${y}" stroke="var(--_line)" stroke-width="0.5" opacity="0.14" />`)
    }
    lines.push('</g>')
    return lines.join('\n')
  }
  if (kind === 'grid') {
    const lines: string[] = ['<g data-backdrop="grid">']
    for (let x = 22; x < doc.width; x += 22) lines.push(`  <line x1="${x}" y1="0" x2="${x}" y2="${doc.height}" stroke="var(--_line)" stroke-width="0.5" opacity="0.10" />`)
    for (let y = 22; y < doc.height; y += 22) lines.push(`  <line x1="0" y1="${y}" x2="${doc.width}" y2="${y}" stroke="var(--_line)" stroke-width="0.5" opacity="0.10" />`)
    lines.push('</g>')
    return lines.join('\n')
  }
  return ''
}

function drawNodeStyled(node: SceneNode, walk: Walk): string {
  switch (node.kind) {
    case 'prelude':
      return node.crisp
    case 'document':
      return node.crisp
    case 'raw':
      return node.crisp
    case 'shape':
      return sceneRoleTraits(node.role).sketch === 'shape' ? sketchShape(node, walk) : node.crisp
    case 'connector':
      return sceneRoleTraits(node.role).sketch === 'connector' ? sketchConnector(node, walk) : node.crisp
    case 'text':
      return sceneRoleTraits(node.role).textHalo ? haloText(node) : node.crisp
    case 'group':
      return composeGroup(
        node.open,
        node.close,
        node.join,
        node.children.map(child => ({ serialized: drawNodeStyled(child.node, walk), indent: child.indent })),
      )
  }
}

export function createSketchBackend(id: string, sketcher?: GeometrySketcher): StyleBackend {
  return {
    id,
    capabilities: graphicalBackendCapabilityClaims(`backend:${id}`, 'sketch', sketcher ? 'hybrid' : 'rough'),
    drawNode(node: SceneNode, ctx: StyleBackendContext): string {
      return drawNodeStyled(node, { ctx, p: paramsOf(ctx.style), sketcher })
    },
    render(doc: SceneDoc, ctx: StyleBackendContext): string {
      const admitted = admitBackendSceneDocument(doc)
      const walk: Walk = { ctx, p: paramsOf(ctx.style), sketcher }
      const out: string[] = []
      for (let i = 0; i < admitted.parts.length; i++) {
        const part = admitted.parts[i]!
        out.push(drawNodeStyled(part, walk))
        if (i === 0 && part.kind === 'prelude') {
          const pageRect = pageRectFor(admitted, ctx)
          if (pageRect) out.push(pageRect)
          const backdrop = backdropFor(ctx.style, admitted)
          if (backdrop) out.push(backdrop)
        }
      }
      return out.join('\n')
    },
  }
}

export const RoughBackend: StyleBackend = createSketchBackend('rough')
