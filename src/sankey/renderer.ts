import { escapeAttr, escapeXml, renderMultilineText } from '../multiline-utils.ts'
import { pieSliceColors } from '../pie/palette.ts'
import { DefaultBackend } from '../scene/backend.ts'
import type { SceneDoc, SceneNode } from '../scene/ir.ts'
import * as marks from '../scene/marks.ts'
import { resolveRoleStyle } from '../scene/style-registry.ts'
import { ensureCompositedBgContrast } from '../shared/categorical-palette.ts'
import { mixHex } from '../shared/color-math.ts'
import { applyTextTransform, resolveRenderStyle } from '../styles.ts'
import { buildShadowDefs, buildStyleBlock, svgOpenTag } from '../theme.ts'
import type { RenderContext } from '../types.ts'
import type { SankeyVisualConfig } from './config.ts'
import { SANKEY_STYLE_DEFAULTS } from './layout.ts'
import type { PositionedSankeyChart } from './types.ts'

// ============================================================================
// Sankey diagram SVG renderer
//
// The chart is first lowered to a SceneGraph (SPEC §3.1): every visual mark
// becomes a scene node carrying semantic fields (role, geometry, paint,
// channels, stable id). renderSankeySvg() uses DefaultBackend serialization.
//
// Visual language:
//   - value-scaled node rectangles per layer, filled from the shared
//     categorical palette (or authored `sankey.nodeColors`)
//   - centerline Bézier link ribbons whose stroke width encodes the flow
//     value, painted per `sankey.linkColor` (source / target / gradient /
//     static color) at fixed partial opacity so crossings stay readable
//   - node labels beside the rectangles (left half → right of the node),
//     with the flow value on a second line when `sankey.showValues`
//   - optional frontmatter title centered above the chart
//
// Deterministic: no Math.random / Date.now. All geometry comes from layout.
// ============================================================================

/** Link ribbon opacity — flows overlap, so full opacity would occlude. */
const SANKEY_LINK_OPACITY = 0.5

/** Halo width for `labelStyle: outlined` labels. */
const SANKEY_LABEL_HALO_WIDTH = 3

/**
 * Render a positioned sankey diagram as an SVG string.
 */
export function renderSankeySvg(ctx: RenderContext<PositionedSankeyChart>): string {
  return DefaultBackend.render(lowerSankeyScene(ctx), { seed: 0 })
}

/**
 * Lower a positioned sankey diagram to the SceneGraph IR in canonical mark
 * order: prelude, gradient defs, links (underneath), nodes, labels, title.
 */
export function lowerSankeyScene(ctx: RenderContext<PositionedSankeyChart>): SceneDoc {
  const { positioned: chart, colors, resolved } = ctx
  const options = resolved.renderOptions
  const font = colors.font ?? 'Inter'
  const transparent = options.transparent ?? false
  const style = resolveRenderStyle(options, SANKEY_STYLE_DEFAULTS, resolved.styleFace)
  const visual = chart.visual
  const parts: SceneNode[] = []

  // One palette for node fills, ribbon paints, and the ASCII renderer (shared
  // module) — surfaces can never disagree about node identity. Authored
  // `sankey.nodeColors` overrides win per label.
  const fills = pieSliceColors(chart.nodes.length, {
    accent: colors.accent,
    bg: colors.bg,
  })
  const nodeColor = new Map<string, string>()
  chart.nodes.forEach((node, index) => {
    nodeColor.set(node.label, visual.nodeColors[node.label] ?? fills[index]!)
  })

  // Document shell: sankey <svg> open tag + shared style block + optional
  // shadow defs, in the exact pushed order (derivable from prelude fields).
  const headParts: string[] = []
  headParts.push(
    svgOpenTag(chart.width, chart.height, colors, transparent, {
      attrs: { role: 'img', 'aria-roledescription': 'sankey diagram' },
    }),
  )
  headParts.push(buildStyleBlock(font, false, colors.shadow, colors.embedFontImport))
  const shadowDefs = buildShadowDefs(colors)
  if (shadowDefs) headParts.push(`<defs>${shadowDefs}</defs>`)
  parts.push(
    marks.documentOpen(
      {
        id: 'prelude',
        width: chart.width,
        height: chart.height,
        colors,
        transparent,
        font,
        hasMonoFont: false,
      },
      headParts.join('\n'),
    ),
  )

  // Links first so nodes draw above the ribbon attach points.
  for (const link of chart.links) {
    const strokeWidth = String(link.width)
    const stroke = resolveLinkStroke(visual, colors.bg, { color: nodeColor.get(link.source)!, derived: !(link.source in visual.nodeColors) }, { color: nodeColor.get(link.target)!, derived: !(link.target in visual.nodeColors) })
    parts.push(
      marks.connector(
        {
          id: link.id,
          role: 'edge',
          geometry: { kind: 'path', d: link.path, points: link.points },
          lineStyle: 'solid',
          paint: {
            fill: 'none',
            stroke,
            strokeWidth,
            opacity: String(SANKEY_LINK_OPACITY),
          },
          endpoints: { from: link.source, to: link.target },
          relationship: { kind: 'flow', direction: 'forward' },
          channels: { category: link.source, value: link.value },
        },
        `<path class="sankey-link" d="${link.path}" fill="none" ` + `stroke="${escapeAttr(stroke)}" stroke-width="${strokeWidth}" ` + `opacity="${SANKEY_LINK_OPACITY}" data-source="${escapeAttr(link.source)}" ` + `data-target="${escapeAttr(link.target)}" data-value="${link.value}" />`,
      ),
    )
  }

  // Node rectangles.
  const nodeStroke = style.nodeBorderColor ?? 'var(--_node-stroke)'
  const nodeStrokeWidth = style.nodeLineWidth
  for (const node of chart.nodes) {
    const nodeRole = resolveRoleStyle(
      resolved.styleFace,
      'bar',
      {
        category: node.label,
        value: node.value,
      },
      { includeFallback: false },
    )
    // An authored `sankey.nodeColors` entry is concrete paint; role/binding
    // paint is a default beneath it, never a repaint authority.
    const fill = visual.nodeColors[node.label] ?? nodeRole?.fillColor ?? nodeColor.get(node.label)!
    parts.push(
      marks.shape(
        {
          id: node.label,
          role: 'bar',
          geometry: {
            kind: 'rect',
            x: node.x0,
            y: node.y0,
            width: round2(node.x1 - node.x0),
            height: round2(node.y1 - node.y0),
          },
          paint: {
            fill,
            stroke: nodeRole?.strokeColor ?? nodeRole?.borderColor ?? nodeStroke,
            strokeWidth: String(nodeRole?.lineWidth ?? nodeStrokeWidth),
          },
          channels: { category: node.label, value: node.value },
        },
        `<rect class="sankey-node" x="${node.x0}" y="${node.y0}" ` +
          `width="${round2(node.x1 - node.x0)}" height="${round2(node.y1 - node.y0)}" ` +
          `fill="${escapeAttr(fill)}" stroke="${escapeAttr(nodeRole?.strokeColor ?? nodeRole?.borderColor ?? nodeStroke)}" ` +
          `stroke-width="${nodeRole?.lineWidth ?? nodeStrokeWidth}" ` +
          `data-label="${escapeAttr(node.label)}" data-value="${node.value}" data-layer="${node.layer}" />`,
      ),
    )
  }

  // Node labels (value line included by layout when `showValues`).
  const labelFill = style.nodeTextColor ?? 'var(--_text)'
  const outlined = visual.labelStyle === 'outlined'
  const haloAttrs = outlined ? ` stroke="var(--bg)" stroke-width="${SANKEY_LABEL_HALO_WIDTH}" paint-order="stroke fill"` : ''
  for (const node of chart.nodes) {
    const text = node.labelLines.join('\n')
    parts.push(
      marks.text(
        {
          id: `label:${node.label}`,
          role: 'label',
          text,
          x: node.labelX,
          y: node.labelY,
          fontSize: style.nodeLabelFontSize,
          anchor: node.labelAnchor,
          paint: {
            fill: labelFill,
            ...(outlined
              ? {
                  stroke: 'var(--bg)',
                  strokeWidth: String(SANKEY_LABEL_HALO_WIDTH),
                  paintOrder: 'stroke fill',
                }
              : {}),
          },
          channels: { category: node.label, value: node.value },
        },
        renderMultilineText(text, node.labelX, node.labelY, style.nodeLabelFontSize, `class="sankey-node-label" text-anchor="${node.labelAnchor}" dominant-baseline="middle" ` + `font-size="${style.nodeLabelFontSize}" font-weight="${style.nodeLabelFontWeight}" ` + `fill="${escapeAttr(labelFill)}"${haloAttrs}`),
      ),
    )
  }

  // Title.
  if (chart.title) {
    const title = applyTextTransform(chart.title.text, style.groupTextTransform)
    parts.push(
      marks.text(
        {
          id: 'title',
          role: 'title',
          text: title,
          x: chart.title.x,
          y: chart.title.y,
          fontSize: style.groupHeaderFontSize,
          anchor: 'middle',
          paint: { fill: style.groupTextColor ?? style.nodeTextColor ?? 'var(--_text)' },
        },
        renderMultilineText(
          title,
          chart.title.x,
          chart.title.y,
          style.groupHeaderFontSize,
          `class="sankey-title" text-anchor="middle" dominant-baseline="middle" ` + `font-size="${style.groupHeaderFontSize}" font-weight="${style.groupHeaderFontWeight}" ` + `fill="${escapeAttr(style.groupTextColor ?? style.nodeTextColor ?? 'var(--_text)')}"`,
        ),
      ),
    )
  }

  parts.push(marks.documentClose())

  return { family: 'sankey', width: chart.width, height: chart.height, colors, transparent, parts }
}

/**
 * Ribbon stroke per `sankey.linkColor`. The scene contract forbids
 * URL-referencing paints (`url(#gradient)` is a fetching form), so the
 * upstream `gradient` mode renders as the deterministic source→target
 * midpoint blend — each source/target pairing still gets a distinct,
 * direction-coded hue.
 *
 * Ribbons draw at SANKEY_LINK_OPACITY, so a palette-derived stroke is passed
 * through `ensureCompositedBgContrast`: the wedge visibility floors must hold
 * for the color the viewer actually sees after alpha compositing, not the raw
 * paint (which the palette only guarantees opaque). Authored paints — the
 * `static` color and any `sankey.nodeColors` endpoint — stay authoritative
 * and are never repainted; an authored gradient endpoint keeps the
 * `color-mix()` form for the shared post-pass to resolve.
 */
function resolveLinkStroke(visual: SankeyVisualConfig, bg: string | undefined, source: { color: string; derived: boolean }, target: { color: string; derived: boolean }): string {
  const compensate = (paint: string, derived: boolean): string => (derived ? ensureCompositedBgContrast(paint, bg, SANKEY_LINK_OPACITY * 100) : paint)
  switch (visual.linkColor.mode) {
    case 'source':
      return compensate(source.color, source.derived)
    case 'target':
      return compensate(target.color, target.derived)
    case 'static':
      return visual.linkColor.color
    default:
      return source.derived && target.derived ? compensate(mixHex(source.color, target.color, 50), true) : `color-mix(in srgb, ${source.color} 50%, ${target.color})`
  }
}

function round2(value: number): number {
  return Math.round(value * 100) / 100
}
