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
// markerUnits="userSpaceOnUse" injected so arrowheads don't scale with
// replacement stroke widths (the Phase 0 lesson). The original connector
// element is kept as an invisible carrier (stroke-opacity="0"), preserving
// markers, class/data-* attributes, and hit geometry under the sketch.
//
// Paint truth comes from the mark's own crisp element attributes (parsed with
// the owned-format element parser, not blind regexes): a child with
// stroke="none" never grows a synthesized outline, and fills keep their
// semantic colors (gantt status, pie slices) unless the style's fill policy
// redraws them.
// ============================================================================

import { RoughGenerator } from 'roughjs/bin/generator'
import type { Geometry, SceneDoc, SceneNode, ShapeMark, ConnectorMark, TextMark } from './ir.ts'
import type { StyleBackend, StyleBackendContext } from './backend.ts'
import { registerBackend, composeGroup } from './backend.ts'
import { nodeSeed } from './seed.ts'
import { topLevelElements } from './fidelity.ts'
import type { AestheticStyle } from './style-registry.ts'

const gen = new RoughGenerator()

/** Roles whose shapes get redrawn as sketchy strokes. Everything else keeps
 *  its crisp serialization (role-aware restraint — SPEC §3.2). */
const SKETCH_SHAPE_ROLES = new Set([
  'node', 'group', 'group-header', 'actor', 'activation', 'block', 'note',
  'entity', 'class-box', 'plate', 'section', 'task', 'milestone', 'bar',
  'pie-slice', 'event', 'period', 'service', 'actor-pill',
])

/** Connector roles that get sketched. */
const SKETCH_CONNECTOR_ROLES = new Set([
  'edge', 'relationship', 'message', 'series', 'lifeline', 'rail',
])

/** Text roles that get the readability halo. Titles/axes keep plain crisp
 *  text (they sit on clean ground). */
const HALO_TEXT_ROLES = new Set([
  'label', 'member', 'attribute', 'cardinality', 'legend', 'axis', 'section', 'group-header',
])

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

function paramsOf(style: AestheticStyle | undefined): RoughParams {
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

/** Serialize a rough Drawable's OpSets into <path> elements. */
function opsToSvg(sets: Array<{ type: string; ops: unknown[] }>, stroke: string, strokeWidth: number, fill: string | undefined, p: RoughParams, extra = ''): string {
  const out: string[] = []
  for (const set of sets) {
    const d = gen.opsToPath(set as Parameters<typeof gen.opsToPath>[0], 2)
    if (!d) continue
    if (set.type === 'path') {
      out.push(`<path d="${d}" fill="none" stroke="${stroke}" stroke-width="${strokeWidth}" stroke-linecap="round" stroke-linejoin="round"${extra} />`)
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
export function sketchGeometryRough(geom: Geometry, seed: number, stroke: string, strokeWidth: number, fill: string | undefined, p: RoughParams, dash?: string): string {
  return sketchGeometry(geom, seed, stroke, strokeWidth, fill, p, dash)
}

/** Draw one geometry with rough.js. `fill` undefined means outline-only. */
function sketchGeometry(geom: Geometry, seed: number, stroke: string, strokeWidth: number, fill: string | undefined, p: RoughParams, dash?: string): string {
  const extra = dash ? ` stroke-dasharray="${dash}"` : ''
  const opts = roughOptions(p, seed, stroke, strokeWidth, fill)
  try {
    switch (geom.kind) {
      case 'rect': {
        if ((geom.rx ?? 0) > 0.5) {
          return opsToSvg(gen.path(roundedRectPath(geom.x, geom.y, geom.width, geom.height, geom.rx!), opts).sets, stroke, strokeWidth, fill, p, extra)
        }
        return opsToSvg(gen.rectangle(geom.x, geom.y, geom.width, geom.height, opts).sets, stroke, strokeWidth, fill, p, extra)
      }
      case 'circle':
        return opsToSvg(gen.circle(geom.cx, geom.cy, geom.r * 2, opts).sets, stroke, strokeWidth, fill, p, extra)
      case 'ellipse':
        return opsToSvg(gen.ellipse(geom.cx, geom.cy, geom.rx * 2, geom.ry * 2, opts).sets, stroke, strokeWidth, fill, p, extra)
      case 'line':
        return opsToSvg(gen.line(geom.x1, geom.y1, geom.x2, geom.y2, opts).sets, stroke, strokeWidth, undefined, p, extra)
      case 'polygon':
        return opsToSvg(gen.polygon(geom.points.map(q => [q.x, q.y] as [number, number]), opts).sets, stroke, strokeWidth, fill, p, extra)
      case 'polyline':
        return opsToSvg(gen.linearPath(geom.points.map(q => [q.x, q.y] as [number, number]), opts).sets, stroke, strokeWidth, undefined, p, extra)
      case 'path':
        return opsToSvg(gen.path(geom.d, opts).sets, stroke, strokeWidth, fill, p, extra)
      case 'compound':
        // Callers handle compound per-child (per-child paint differs).
        return ''
    }
  } catch {
    return '' // unsupported path command → caller falls back to crisp
  }
}

/** Inject attributes into the first tag of an owned-format element string. */
function injectAttrs(element: string, tag: string, attrs: string): string {
  return element.replace(new RegExp(`<${tag}(\\s)`), `<${tag} ${attrs}$1`)
}

function sketchShape(node: ShapeMark, ctx: StyleBackendContext, p: RoughParams): string {
  const ctxStyle = ctx.style
  const els = topLevelElements(node.crisp)
  const geoms: Geometry[] = node.geometry.kind === 'compound' ? node.geometry.children : [node.geometry]
  if (els.length < geoms.length) return node.crisp // crisp/semantic mismatch → stay safe
  const out: string[] = []
  for (let i = 0; i < geoms.length; i++) {
    const el = els[i]!
    const elStroke = el.attrs.get('stroke')
    const elFill = el.attrs.get('fill')
    const seed = nodeSeed(ctx.seed, node.id, `outline:${i}`) || 1
    const hasStroke = elStroke !== undefined && elStroke !== 'none'
    const hasFill = elFill !== undefined && elFill !== 'none'
    // Fill policy: 'none' keeps boxes open (people write inside them);
    // semantic value fills (status colors, slice hues) are preserved either
    // solid-crisp (fill:'none' style keeps the region honest via the crisp
    // element) or re-rendered as hachure/solid sketch fill.
    const wantFill = hasFill && p.fill !== 'none' ? elFill : undefined
    if (!hasStroke && !hasFill) { out.push(el ? crispElementOf(node.crisp, i) : ''); continue }
    if (!hasStroke) {
      // Fill-only element (gantt bars, pie halo chips, state-start dots):
      // never synthesize an outline (Phase 0 lesson b). Keep the crisp fill,
      // optionally overlaid with sketch fill texture.
      out.push(crispElementOf(node.crisp, i))
      continue
    }
    const strokeWidth = p.strokeWidth * (Number(el.attrs.get('stroke-width')) || 1) / (Number(el.attrs.get('stroke-width')) ? 1 : 1)
    const width = p.strokeWidth * (Number(el.attrs.get('stroke-width')) || 1)
    void strokeWidth
    const sketched = sketchGeometryVia(activeSketcher, ctxStyle, geoms[i]!, seed, elStroke!, Math.max(0.6, Math.min(width, p.strokeWidth * 4)), wantFill, p, el.attrs.get('stroke-dasharray'))
    if (!sketched) { out.push(crispElementOf(node.crisp, i)); continue }
    // Value-colored solid fills stay: when the style suppresses sketch fills
    // but the element carries a non-default fill, under-paint it crisply so
    // semantic color survives (status bars, quadrant plates).
    if (hasFill && p.fill === 'none' && !isBoxFill(elFill!)) {
      out.push(crispElementOf(node.crisp, i).replace(/ stroke="[^"]*"/, ' stroke="none"'))
    }
    out.push(sketched)
  }
  return out.filter(Boolean).join('\n')
}

/** Default node-surface fills we may drop when a style wants open boxes;
 *  anything else (status colors, series hues, inline styles) is semantic. */
function isBoxFill(fill: string): boolean {
  return fill.startsWith('var(--_node-fill') || fill.startsWith('var(--_group') || fill === 'var(--bg)' || fill === 'var(--surface)'
}

/** Extract the i-th top-level element's source text from an owned crisp chunk. */
function crispElementOf(crisp: string, index: number): string {
  const lines = crisp.split('\n')
  if (lines.length === 1 && index === 0) return crisp
  // Multi-element crisps in this codebase place one element per line.
  return lines[index] ?? ''
}

function sketchConnector(node: ConnectorMark, ctx: StyleBackendContext, p: RoughParams): string {
  if (node.lineStyle === 'invisible' || node.crisp === '') return node.crisp
  const els = topLevelElements(node.crisp)
  const el = els[0]
  if (!el) return node.crisp
  const stroke = el.attrs.get('stroke') ?? 'var(--_line)'
  const width = p.strokeWidth * (Number(el.attrs.get('stroke-width')) || 1)
  const seed = nodeSeed(ctx.seed, node.id, 'stroke') || 1
  const dash = el.attrs.get('stroke-dasharray')
  let sketched = ''
  const geom = node.geometry
  if (geom.kind === 'polyline') {
    sketched = sketchGeometryVia(activeSketcher, ctx.style, { kind: 'polyline', points: geom.points }, seed, stroke, width, undefined, p, dash)
  } else if (geom.kind === 'line') {
    sketched = sketchGeometryVia(activeSketcher, ctx.style, geom, seed, stroke, width, undefined, p, dash)
  } else if (geom.points && geom.points.length > 1) {
    // Curved-bend paths carry their source polyline; freehand-capable
    // sketchers prefer the points, rough falls back to the path d.
    sketched = sketchGeometryVia(activeSketcher, ctx.style, { kind: 'polyline', points: geom.points }, seed, stroke, width, undefined, p, dash)
      || sketchGeometryVia(activeSketcher, ctx.style, { kind: 'path', d: geom.d }, seed, stroke, width, undefined, p, dash)
  } else {
    sketched = sketchGeometryVia(activeSketcher, ctx.style, { kind: 'path', d: geom.d }, seed, stroke, width, undefined, p, dash)
  }
  if (!sketched) return node.crisp
  // Keep the original element as an invisible carrier: markers, class/data-*
  // attributes, and hit geometry survive (stroke-opacity 0 hides the crisp
  // stroke while markers still render at full opacity from markerUnits defs).
  const carrier = injectAttrs(node.crisp, el.tag, 'stroke-opacity="0"')
  return `${carrier}\n${sketched}`
}

function haloText(node: TextMark, doc: SceneDoc): string {
  // Cartographic halo: knock the text out to the page so glyphs never sit
  // directly on strokes/fills. Injected on every <text> in the chunk;
  // tspans inherit. paint-order draws the stroke behind the glyph.
  void doc
  return node.crisp.replace(/<text /g, '<text paint-order="stroke" stroke="var(--bg)" stroke-width="3" stroke-linejoin="round" stroke-linecap="round" ')
}

function backdropFor(style: AestheticStyle | undefined, doc: SceneDoc): string {
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

/** A pluggable geometry renderer: return null to fall back to rough.js.
 *  HybridBackend supplies perfect-freehand ribbons and watercolor washes;
 *  RoughBackend uses pure rough.js. */
export type GeometrySketcher = (
  geom: Geometry,
  opts: { seed: number; stroke: string; width: number; fill: string | undefined; p: RoughParams; style: AestheticStyle | undefined; dash: string | undefined },
) => string | null

let activeSketcher: GeometrySketcher | undefined

function sketchGeometryVia(sketcher: GeometrySketcher | undefined, style: AestheticStyle | undefined, geom: Geometry, seed: number, stroke: string, width: number, fill: string | undefined, p: RoughParams, dash?: string): string {
  if (sketcher) {
    const out = sketcher(geom, { seed, stroke, width, fill, p, style, dash })
    if (out !== null) return out
  }
  return sketchGeometry(geom, seed, stroke, width, fill, p, dash)
}

function drawNodeStyled(node: SceneNode, ctx: StyleBackendContext, p: RoughParams, doc: SceneDoc): string {
  switch (node.kind) {
    case 'prelude':
      return node.crisp
    case 'raw':
      if (node.role === 'defs') {
        // Arrowheads must not scale with replacement stroke widths.
        return node.crisp.replace(/<marker (?![^>]*markerUnits)/g, '<marker markerUnits="userSpaceOnUse" ')
      }
      return node.crisp
    case 'shape':
      return SKETCH_SHAPE_ROLES.has(node.role) ? sketchShape(node, ctx, p) : node.crisp
    case 'connector':
      return SKETCH_CONNECTOR_ROLES.has(node.role) ? sketchConnector(node, ctx, p) : node.crisp
    case 'text':
      return HALO_TEXT_ROLES.has(node.role) ? haloText(node, doc) : node.crisp
    case 'group':
      return composeGroup(
        node.open,
        node.close,
        node.join,
        node.children.map(child => ({ serialized: drawNodeStyled(child.node, ctx, p, doc), indent: child.indent })),
      )
  }
}

export function createSketchBackend(id: string, sketcher?: GeometrySketcher): StyleBackend {
  return {
    id,
    drawNode(node: SceneNode, ctx: StyleBackendContext): string {
      const p = paramsOf(ctx.style)
      activeSketcher = sketcher
      try {
        return drawNodeStyled(node, ctx, p, { family: '', width: 0, height: 0, colors: { bg: '#fff', fg: '#000' }, parts: [] })
      } finally {
        activeSketcher = undefined
      }
    },
    render(doc: SceneDoc, ctx: StyleBackendContext): string {
      const p = paramsOf(ctx.style)
      activeSketcher = sketcher
      try {
        const out: string[] = []
        for (let i = 0; i < doc.parts.length; i++) {
          const part = doc.parts[i]!
          out.push(drawNodeStyled(part, ctx, p, doc))
          if (i === 0 && part.kind === 'prelude') {
            // resvg does not paint the root style="background:…" CSS, so a
            // styled document carries an explicit page rect (SPEC §10 —
            // substrate-aware output). Crisp keeps its browser-CSS behavior.
            if (!part.prelude.transparent) {
              out.push(`<rect width="${doc.width}" height="${doc.height}" fill="var(--bg)" data-backdrop="page" />`)
            }
            const backdrop = backdropFor(ctx.style, doc)
            if (backdrop) out.push(backdrop)
          }
        }
        return out.join('\n')
      } finally {
        activeSketcher = undefined
      }
    },
  }
}

export const RoughBackend: StyleBackend = createSketchBackend('rough')

registerBackend(RoughBackend)
