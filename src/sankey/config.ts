// ============================================================================
// Sankey runtime config — upstream's `sankey` config section, resolved in ONE
// place for every surface (SVG layout, renderer, ASCII, verify's
// INEFFECTIVE_CONFIG lint).
//
// Upstream contract (config.schema.yaml + sankey docs, v11.16.0):
//   sankey.width         number > 0, default 600 — flow-area width
//   sankey.height        number > 0, default 400 — flow-area height
//   sankey.linkColor     'source'|'target'|'gradient'|<css color>, default 'gradient'
//                        (`gradient` renders as the source→target midpoint
//                        blend — the scene contract forbids url(#…) paints,
//                        so a true SVG gradient cannot be expressed)
//   sankey.nodeAlignment 'justify'|'center'|'left'|'right', default 'justify'
//   sankey.showValues    boolean, default true — value line under node labels
//   sankey.prefix        string, default '' — prepended to displayed values
//   sankey.suffix        string, default '' — appended to displayed values
//   sankey.labelStyle    'legacy'|'outlined' (v11.15.0+), default 'legacy'
//   sankey.nodeWidth     number > 0 (v11.15.0+), default 10
//   sankey.nodePadding   number >= 0 (v11.15.0+), default 12
//   sankey.nodeColors    map label -> css color (v11.15.0+)
//
// Wire-or-warn (P4): every documented key is either resolved here or named in
// the SANKEY_NOOP_* lists that verify surfaces as Tier-3 INEFFECTIVE_CONFIG.
// ============================================================================

import type { MermaidFrontmatterMap } from '../mermaid-source.ts'
import { getFrontmatterMap } from '../mermaid-source.ts'
import { safeCssColor } from '../shared/css-color.ts'

export type SankeyNodeAlignment = 'justify' | 'center' | 'left' | 'right'
export type SankeyLabelStyle = 'legacy' | 'outlined'

/** Resolved `sankey.linkColor`: a paint mode or an authored CSS color. */
export type SankeyLinkColor = { mode: 'source' } | { mode: 'target' } | { mode: 'gradient' } | { mode: 'static'; color: string }

export interface SankeyVisualConfig {
  /** Flow-area width in px (labels and padding extend the canvas). */
  width: number
  /** Flow-area height in px. */
  height: number
  /** Link paint policy. Upstream default 'gradient'. */
  linkColor: SankeyLinkColor
  /** Horizontal layer-assignment policy. Upstream default 'justify'. */
  nodeAlignment: SankeyNodeAlignment
  /** When true, node labels carry a second `prefix + value + suffix` line. */
  showValues: boolean
  prefix: string
  suffix: string
  /** Node label rendering: 'outlined' adds a background stroke halo. */
  labelStyle: SankeyLabelStyle
  /** Node rectangle width in px. Upstream default 10. */
  nodeWidth: number
  /** Vertical gap between nodes in a layer. Upstream default 12. */
  nodePadding: number
  /** Authored per-label fills; unset labels use the categorical palette. */
  nodeColors: Readonly<Record<string, string>>
}

export const DEFAULT_SANKEY_VISUAL_CONFIG: SankeyVisualConfig = {
  width: 600,
  height: 400,
  linkColor: { mode: 'gradient' },
  nodeAlignment: 'justify',
  showValues: true,
  prefix: '',
  suffix: '',
  labelStyle: 'legacy',
  nodeWidth: 10,
  nodePadding: 12,
  nodeColors: {},
}

const NODE_ALIGNMENTS: readonly SankeyNodeAlignment[] = ['justify', 'center', 'left', 'right']
const LABEL_STYLES: readonly SankeyLabelStyle[] = ['legacy', 'outlined']
const LINK_COLOR_MODES = ['source', 'target', 'gradient'] as const

/** Domain bounds shared with the family config diagnostics. */
export const SANKEY_CONFIG_LIMITS = Object.freeze({
  width: { min: 1, max: 10000 },
  height: { min: 1, max: 10000 },
  nodeWidth: { min: 1, max: 200 },
  nodePadding: { min: 0, max: 200 },
})

function positiveNumber(value: unknown, min: number, max: number): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined
  if (value < min || value > max) return undefined
  return value
}

export function resolveSankeyVisualConfig(frontmatter: MermaidFrontmatterMap = {}): SankeyVisualConfig {
  const sankey = getFrontmatterMap(frontmatter, ['sankey']) ?? {}
  const config: SankeyVisualConfig = { ...DEFAULT_SANKEY_VISUAL_CONFIG }

  const width = positiveNumber(sankey.width, SANKEY_CONFIG_LIMITS.width.min, SANKEY_CONFIG_LIMITS.width.max)
  if (width !== undefined) config.width = width
  const height = positiveNumber(sankey.height, SANKEY_CONFIG_LIMITS.height.min, SANKEY_CONFIG_LIMITS.height.max)
  if (height !== undefined) config.height = height
  const nodeWidth = positiveNumber(sankey.nodeWidth, SANKEY_CONFIG_LIMITS.nodeWidth.min, SANKEY_CONFIG_LIMITS.nodeWidth.max)
  if (nodeWidth !== undefined) config.nodeWidth = nodeWidth
  const nodePadding = positiveNumber(sankey.nodePadding, SANKEY_CONFIG_LIMITS.nodePadding.min, SANKEY_CONFIG_LIMITS.nodePadding.max)
  if (nodePadding !== undefined) config.nodePadding = nodePadding

  const nodeAlignment = sankey.nodeAlignment
  if (typeof nodeAlignment === 'string' && (NODE_ALIGNMENTS as readonly string[]).includes(nodeAlignment)) {
    config.nodeAlignment = nodeAlignment as SankeyNodeAlignment
  }
  const labelStyle = sankey.labelStyle
  if (typeof labelStyle === 'string' && (LABEL_STYLES as readonly string[]).includes(labelStyle)) {
    config.labelStyle = labelStyle as SankeyLabelStyle
  }
  if (typeof sankey.showValues === 'boolean') config.showValues = sankey.showValues
  if (typeof sankey.prefix === 'string') config.prefix = sankey.prefix
  if (typeof sankey.suffix === 'string') config.suffix = sankey.suffix

  const linkColor = sankey.linkColor
  if (typeof linkColor === 'string') {
    if ((LINK_COLOR_MODES as readonly string[]).includes(linkColor)) {
      config.linkColor = { mode: linkColor as 'source' | 'target' | 'gradient' }
    } else {
      const color = safeCssColor(linkColor)
      if (color !== undefined) config.linkColor = { mode: 'static', color }
    }
  }

  const nodeColors = getFrontmatterMap(frontmatter, ['sankey', 'nodeColors'])
  if (nodeColors) {
    const resolved: Record<string, string> = {}
    for (const [label, value] of Object.entries(nodeColors)) {
      const color = safeCssColor(value)
      if (color !== undefined) resolved[label] = color
    }
    if (Object.keys(resolved).length > 0) config.nodeColors = Object.freeze(resolved)
  }

  return config
}

/** Documented sankey config keys wired by this family. */
export const SANKEY_WIRED_CONFIG_FIELDS = ['width', 'height', 'linkColor', 'nodeAlignment', 'showValues', 'prefix', 'suffix', 'labelStyle', 'nodeWidth', 'nodePadding', 'nodeColors'] as const

/** Documented-but-unwired sankey config section fields (Tier-3 INEFFECTIVE_CONFIG). */
export const SANKEY_NOOP_CONFIG_FIELDS = ['useMaxWidth'] as const
