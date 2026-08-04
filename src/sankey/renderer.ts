import { escapeAttr, escapeXml, renderMultilineText } from '../multiline-utils.ts'
import { pieSliceColors } from '../pie/palette.ts'
import { DefaultBackend } from '../scene/backend.ts'
import { serializeLinearGradientResources } from '../scene/gradient-resources.ts'
import type { LinearGradientDescriptor, SceneDoc, SceneNode } from '../scene/ir.ts'
import * as marks from '../scene/marks.ts'
import { resolveRoleStyle } from '../scene/style-registry.ts'
import { ensureCompositedBgContrast } from '../shared/categorical-palette.ts'
import { relativeLuminance } from '../shared/color-math.ts'
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
  const linkBlendMode = sankeyLinkBlendMode(colors.bg)

  // One palette for node fills, ribbon paints, and the ASCII renderer (shared
  // module) — surfaces can never disagree about node identity. Authored
  // `sankey.nodeColors` overrides win per label.
  const fills = pieSliceColors(chart.nodes.length, {
    accent: colors.accent,
    bg: colors.bg,
  })
  const nodeColor = new Map<string, { color: string; derived: boolean; stroke: string; strokeWidth: number }>()
  const nodeStroke = style.nodeBorderColor ?? 'var(--_node-stroke)'
  const nodeStrokeWidth = style.nodeLineWidth
  chart.nodes.forEach((node, index) => {
    const nodeRole = resolveRoleStyle(
      resolved.styleFace,
      'bar',
      { category: node.label, value: node.value },
      { includeFallback: false },
    )
    const authored = visual.nodeColors[node.label]
    const roleFill = nodeRole?.fillColor
    nodeColor.set(node.label, {
      color: authored ?? roleFill ?? fills[index]!,
      derived: authored === undefined && roleFill === undefined,
      stroke: nodeRole?.strokeColor ?? nodeRole?.borderColor ?? nodeStroke,
      strokeWidth: nodeRole?.lineWidth ?? nodeStrokeWidth,
    })
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

  const gradientByLink = new Map<string, string>()
  if (visual.linkColor.mode === 'gradient') {
    const gradientResources: LinearGradientDescriptor[] = chart.links.map((link, index) => {
      const id = `sankey-gradient-${index + 1}`
      gradientByLink.set(link.sceneId, id)
      const source = nodeColor.get(link.source)!
      const target = nodeColor.get(link.target)!
      return {
        id,
        units: 'userSpaceOnUse',
        x1: link.sx,
        y1: link.sy,
        x2: link.tx,
        y2: link.ty,
        stops: [
          { offset: 0, color: compensatedEndpoint(source, colors.bg) },
          { offset: 1, color: compensatedEndpoint(target, colors.bg) },
        ],
      }
    })
    if (gradientResources.length > 0) {
      parts.push(
        marks.definitions(
          { id: 'sankey-gradient-definitions', gradientResources },
          `<defs>\n${serializeLinearGradientResources(gradientResources)}\n</defs>`,
        ),
      )
    }
  }

  // Links first so nodes draw above the ribbon attach points.
  for (const link of chart.links) {
    const strokeWidth = String(link.width)
    const stroke = resolveLinkStroke(
      visual,
      colors.bg,
      nodeColor.get(link.source)!,
      nodeColor.get(link.target)!,
      gradientByLink.get(link.sceneId),
    )
    parts.push(
      marks.connector(
        {
          id: link.sceneId,
          role: 'edge',
          geometry: { kind: 'path', d: link.path, points: link.points },
          lineStyle: 'solid',
          paint: {
            fill: 'none',
            stroke,
            strokeWidth,
            opacity: String(SANKEY_LINK_OPACITY),
          },
          stroke: { mixBlendMode: linkBlendMode },
          endpoints: { from: link.sourceId, to: link.targetId },
          relationship: { kind: 'flow', direction: 'forward' },
          channels: { category: link.source, value: link.value },
        },
        `<path class="sankey-link" d="${link.path}" fill="none" ` + `stroke="${escapeAttr(stroke)}" stroke-width="${strokeWidth}" ` + `opacity="${SANKEY_LINK_OPACITY}" style="mix-blend-mode:${linkBlendMode}" data-source="${escapeAttr(link.source)}" ` + `data-target="${escapeAttr(link.target)}" data-value="${link.value}" />`,
      ),
    )
  }

  // Node rectangles.
  for (const node of chart.nodes) {
    const nodePaint = nodeColor.get(node.label)!
    const fill = nodePaint.color
    parts.push(
      marks.shape(
        {
          id: node.id,
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
            stroke: nodePaint.stroke,
            strokeWidth: String(nodePaint.strokeWidth),
          },
          channels: { category: node.label, value: node.value },
        },
        `<rect class="sankey-node" x="${node.x0}" y="${node.y0}" ` +
          `width="${round2(node.x1 - node.x0)}" height="${round2(node.y1 - node.y0)}" ` +
          `fill="${escapeAttr(fill)}" stroke="${escapeAttr(nodePaint.stroke)}" ` +
          `stroke-width="${nodePaint.strokeWidth}" ` +
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
          id: `${node.id}:label`,
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
 * Ribbon stroke per `sankey.linkColor`. Gradient mode references a typed,
 * same-document resource owned by the Scene definitions mark. External URLs
 * remain forbidden; `url(#id)` is inert and namespaced by the shared output
 * post-pass when multiple diagrams share a document.
 *
 * Ribbons draw at SANKEY_LINK_OPACITY, so a palette-derived stroke is passed
 * through `ensureCompositedBgContrast`: the wedge visibility floors must hold
 * for the color the viewer actually sees after alpha compositing, not the raw
 * paint (which the palette only guarantees opaque). Authored paints — the
 * `static` color and any `sankey.nodeColors` endpoint — stay authoritative
 * and are never repainted. Gradient endpoints are typed definition resources,
 * so the scene validator can prove that each local paint reference resolves.
 */
function compensatedEndpoint(endpoint: { color: string; derived: boolean }, bg: string | undefined): string {
  return endpoint.derived
    ? ensureCompositedBgContrast(endpoint.color, bg, SANKEY_LINK_OPACITY * 100)
    : endpoint.color
}

/**
 * Mermaid's multiply blend keeps overlapping ribbons readable on light
 * pages. On a dark page multiply can only darken the backdrop, so even white
 * paint cannot create a visible ribbon. Preserve Mermaid's treatment where
 * it works and use normal alpha compositing on concrete dark backgrounds.
 * Unresolved CSS backgrounds retain the upstream-compatible default.
 */
function sankeyLinkBlendMode(bg: string | undefined): 'normal' | 'multiply' {
  const luminance = bg ? relativeLuminance(bg) : null
  return luminance !== null && luminance < 0.18 ? 'normal' : 'multiply'
}

function resolveLinkStroke(visual: SankeyVisualConfig, bg: string | undefined, source: { color: string; derived: boolean }, target: { color: string; derived: boolean }, gradientId?: string): string {
  const compensate = (paint: string, derived: boolean): string => (derived ? ensureCompositedBgContrast(paint, bg, SANKEY_LINK_OPACITY * 100) : paint)
  switch (visual.linkColor.mode) {
    case 'source':
      return compensate(source.color, source.derived)
    case 'target':
      return compensate(target.color, target.derived)
    case 'static':
      return visual.linkColor.color
    default:
      if (!gradientId) throw new Error('Sankey gradient mode requires a typed local gradient resource')
      return `url(#${gradientId})`
  }
}

function round2(value: number): number {
  return Math.round(value * 100) / 100
}
