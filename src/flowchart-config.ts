// ============================================================================
// Flowchart typed runtime config: wire-or-warn (plan §Flowchart 6, P4).
//
// Upstream's documented FlowchartDiagramConfig keys (schema verified
// 2026-07-10) split into:
//   WIRED — nodeSpacing → RenderOptions.nodeSpacing, rankSpacing →
//           RenderOptions.layerSpacing (both feed the ELK layered options the
//           flowchart engine already reads — the class/er
//           resolve*RenderOptions pattern), and wrappingWidth →
//           measured-pixel auto-wrap of node labels at layout sizing.
//   LINT  — every other documented key is accepted for Mermaid config-shape
//           compatibility and named by verify's INEFFECTIVE_CONFIG Tier-3
//           lint (FLOWCHART_NOOP_CONFIG_FIELDS below), never silently
//           swallowed. The NOOP table lives beside the wiring so wire and
//           warn cannot drift.
//
// wrappingWidth semantics: upstream defaults it to 200 but applies the wrap
// ONLY to markdown-string labels; regular labels never auto-wrap upstream.
// Mirrored here: markdown-string labels (MermaidNode.markdownLabel) wrap at
// FLOWCHART_DEFAULT_WRAPPING_WIDTH even with no config, while regular labels
// wrap only when flowchart.wrappingWidth is explicitly present — so existing
// corpus geometry cannot drift unless the config asks for it.
// ============================================================================

import type { MermaidFrontmatterMap } from './mermaid-source.ts'
import { getFrontmatterScalar } from './mermaid-source.ts'
import type { MermaidGraph, RenderOptions } from './types.ts'
import type { InternalStyleFace } from './scene/style-registry.ts'
import { resolveRenderStyle } from './styles.ts'
import { wrapLabelToWidth } from './shared/label-wrap.ts'

/** Upstream's default `flowchart.wrappingWidth` (applies to markdown-string
 *  labels even when the key is absent — upstream parity). */
export const FLOWCHART_DEFAULT_WRAPPING_WIDTH = 200

/**
 * Documented flowchart config keys accepted for Mermaid config-shape
 * compatibility but NOT wired to any flowchart geometry or paint (P4: each
 * presence is named by verify's INEFFECTIVE_CONFIG lint). The wired keys —
 * nodeSpacing, rankSpacing, wrappingWidth — never appear here.
 */
export const FLOWCHART_NOOP_CONFIG_FIELDS = [
  'arrowMarkerAbsolute', 'curve', 'defaultRenderer', 'diagramPadding',
  'htmlLabels', 'inheritDir', 'padding', 'subGraphTitleMargin', 'titleTopMargin',
] as const

/** The documented-but-unwired flowchart config fields present in any of the
 *  given config sections (frontmatter + init directives), sorted. */
export function flowchartIneffectiveConfigFields(configs: unknown[]): string[] {
  const present = new Set<string>()
  for (const config of configs) {
    if (!config || typeof config !== 'object') continue
    for (const field of FLOWCHART_NOOP_CONFIG_FIELDS) {
      if (field in (config as Record<string, unknown>)) present.add(field)
    }
  }
  return [...present].sort()
}

/**
 * Fold the typed `flowchart` frontmatter config section into RenderOptions:
 * nodeSpacing/rankSpacing/wrappingWidth are the wired keys — explicit
 * RenderOptions always win over frontmatter.
 */
export function resolveFlowchartRenderOptions(
  frontmatter: MermaidFrontmatterMap | undefined,
  options: RenderOptions,
): RenderOptions {
  if (!frontmatter) return options
  const nodeSpacing = configNumber(frontmatter, 'nodeSpacing')
  const rankSpacing = configNumber(frontmatter, 'rankSpacing')
  const wrappingWidth = configNumber(frontmatter, 'wrappingWidth')
  if (nodeSpacing === undefined && rankSpacing === undefined && wrappingWidth === undefined) return options
  return {
    ...options,
    nodeSpacing: options.nodeSpacing ?? nodeSpacing,
    layerSpacing: options.layerSpacing ?? rankSpacing,
    wrappingWidth: options.wrappingWidth ?? wrappingWidth,
  }
}

/** Read a finite positive number from the `flowchart` config section. */
function configNumber(frontmatter: MermaidFrontmatterMap, key: string): number | undefined {
  const value = getFrontmatterScalar<number>(frontmatter, ['flowchart', key])
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : undefined
}

/**
 * Measured-width auto-wrap of node labels (mutates the parsed graph before
 * layout sizing, so ELK, the renderer, and the SVG all see the same lines):
 *   - every node label wraps at options.wrappingWidth when it is set;
 *   - markdown-string labels additionally wrap at the upstream default of
 *     200 even when the option is absent (upstream wraps ONLY those).
 * Uses the shared measured-pixel wrap (src/shared/label-wrap.ts) with the
 * node-label font the layout measures with — no second wrap implementation.
 */
export function applyFlowchartLabelWrapping(
  graph: MermaidGraph,
  options: RenderOptions,
  styleFace?: Readonly<InternalStyleFace>,
): void {
  const explicit = options.wrappingWidth
  const style = resolveRenderStyle(options, undefined, styleFace)
  for (const node of graph.nodes.values()) {
    const budget = explicit ?? (node.markdownLabel ? FLOWCHART_DEFAULT_WRAPPING_WIDTH : undefined)
    if (budget === undefined || !node.label) continue
    const wrapped = wrapLabelToWidth(node.label, budget, style.nodeLabelFontSize, style.nodeLabelFontWeight)
    if (wrapped !== node.label) node.label = wrapped
  }
}
