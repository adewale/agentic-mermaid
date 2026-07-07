// ============================================================================
// Font metrics — character width estimates for Inter at different sizes.
// Used to approximate text bounding boxes without DOM measurement.
// These are calibrated for Inter's typical glyph widths.
//
// NOTE: Theme/color system has moved to src/theme.ts. This file only
// contains font metrics, spacing constants, and stroke widths.
// ============================================================================

import { measureTextWidth } from './text-metrics'
import { styleRolesOf } from './scene/style-registry.ts'
import type { StyleInput } from './scene/style-registry.ts'
import type { DiagramStyleOptions, TextTransform } from './types.ts'

/** Average character width in px at the given font size and weight (proportional font) */
export function estimateTextWidth(text: string, fontSize: number, fontWeight: number): number {
  // Delegate to variable-width character measurement for better accuracy
  // with mixed character sets (Latin narrow/wide, CJK, emoji, etc.)
  return measureTextWidth(text, fontSize, fontWeight)
}

/** Average character width in px for monospace fonts (uniform glyph width) */
export function estimateMonoTextWidth(text: string, fontSize: number): number {
  // Monospace fonts have uniform character width — 0.6 of fontSize matches actual
  // glyph widths for JetBrains Mono / SF Mono / Fira Code at small sizes (11px).
  // Previous value of 0.55 underestimated widths, causing class member labels to
  // extend beyond their box boundaries.
  return text.length * fontSize * 0.6
}

/** Monospace font family used for code-like text (class members, types) */
export const MONO_FONT = "'JetBrains Mono'" as const

/** Full CSS fallback chain for monospace text */
export const MONO_FONT_STACK = `${MONO_FONT}, 'SF Mono', 'Fira Code', ui-monospace, monospace` as const

/** Fixed font sizes used in the renderer (in px) */
export const FONT_SIZES = {
  /** Node label text */
  nodeLabel: 13,
  /** Edge label text */
  edgeLabel: 11,
  /** Subgraph header text */
  groupHeader: 12,
} as const

/** Font weights used per element type */
export const FONT_WEIGHTS = {
  nodeLabel: 500,
  edgeLabel: 400,
  groupHeader: 600,
} as const

// ============================================================================
// Spacing & sizing constants
// ============================================================================

/** Vertical gap between a subgraph header band and the content area below it (px).
 * Without this, nested subgraph headers sit flush against their parent's header band.
 * Increased from 8 to 12 to provide more clearance for edges routing near headers. */
export const GROUP_HEADER_CONTENT_PAD = 12

/** Padding inside node shapes */
export const NODE_PADDING = {
  /** Horizontal padding inside rectangles/rounded/stadium (increased from 16 for better label fit) */
  horizontal: 20,
  /** Vertical padding inside rectangles/rounded/stadium */
  vertical: 10,
  /** Extra padding for diamond shapes (they need more space due to rotation) */
  diamondExtra: 24,
} as const

/** Stroke widths per element type (in px) */
export const STROKE_WIDTHS = {
  outerBox: 1,
  innerBox: 0.75,
  /** Edge connector stroke (increased from 0.75 for better visibility) */
  connector: 1,
} as const

/**
 * Vertical shift applied to all text elements for font-agnostic centering.
 *
 * Instead of relying on `dominant-baseline="central"` (which each font interprets
 * differently based on its own ascent/descent metrics), we use the default alphabetic
 * baseline and shift down by 0.35em. This places the optical center of text at the
 * y coordinate, regardless of font family (Inter, JetBrains Mono, system fallbacks).
 *
 * The 0.35em value approximates the distance from alphabetic baseline to visual
 * center of Latin text. Using `em` units ensures it scales with font size.
 */
export const TEXT_BASELINE_SHIFT = '0.35em' as const

/** Arrow head dimensions — matches spec: 8px wide × ~5px tall */
export const ARROW_HEAD = {
  width: 8,
  height: 5,
} as const

/** Flowchart dotted-edge stroke pattern; renderer emits stroke-dasharray="4 4". */
export const FLOWCHART_DOTTED_DASH = {
  dash: 4,
  gap: 4,
} as const

// ============================================================================
// Render style option resolution
// ============================================================================

export interface RenderStyleOptions {
  /** A style input (name | spec | stack); only its role overrides
   *  (text/node/edge/group) are read here — normalized via styleRolesOf. */
  style?: StyleInput | StyleInput[]
}

export interface RenderStyleDefaults {
  nodeLabelFontSize: number
  edgeLabelFontSize: number
  groupHeaderFontSize: number
  nodeLabelFontWeight: number
  edgeLabelFontWeight: number
  groupHeaderFontWeight: number
  nodeTextTransform?: TextTransform
  edgeTextTransform?: TextTransform
  nodeLetterSpacing?: number
  edgeLetterSpacing?: number
  groupLetterSpacing?: number
  nodePaddingX: number
  nodePaddingY: number
  diamondExtraPadding?: number
  nodeCornerRadius?: number
  nodeLineWidth?: number
  nodeFillColor?: string
  nodeBorderColor?: string
  nodeTextColor?: string
  edgeLineWidth: number
  edgeBendRadius?: number
  edgeStrokeColor?: string
  edgeTextColor?: string
  groupFont?: string
  groupTextTransform?: TextTransform
  groupCornerRadius: number
  groupBorderColor?: string
  groupFillColor?: string
  groupHeaderFillColor?: string
  groupTextColor?: string
  groupPaddingX: number
  groupPaddingY: number
  groupLabelPaddingX?: number
  groupLineWidth?: number
}

export interface ResolvedRenderStyle {
  nodeLabelFontSize: number
  edgeLabelFontSize: number
  groupHeaderFontSize: number
  nodeLabelFontWeight: number
  edgeLabelFontWeight: number
  groupHeaderFontWeight: number
  nodeTextTransform?: TextTransform
  edgeTextTransform?: TextTransform
  nodeLetterSpacing: number
  edgeLetterSpacing: number
  groupLetterSpacing: number
  nodePaddingX: number
  nodePaddingY: number
  diamondExtraPadding: number
  cornerRadius?: number
  nodeLineWidth: number
  nodeFillColor?: string
  nodeBorderColor?: string
  nodeTextColor?: string
  lineWidth: number
  edgeBendRadius: number
  edgeStrokeColor?: string
  edgeTextColor?: string
  groupFont?: string
  groupTextTransform?: TextTransform
  groupCornerRadius: number
  groupBorderColor?: string
  groupFillColor?: string
  groupHeaderFillColor?: string
  groupTextColor?: string
  groupPaddingX: number
  groupPaddingY: number
  groupLabelPaddingX: number
  groupLineWidth: number
}

export const FLOWCHART_STYLE_DEFAULTS: RenderStyleDefaults = {
  nodeLabelFontSize: FONT_SIZES.nodeLabel,
  edgeLabelFontSize: FONT_SIZES.edgeLabel,
  groupHeaderFontSize: FONT_SIZES.groupHeader,
  nodeLabelFontWeight: FONT_WEIGHTS.nodeLabel,
  edgeLabelFontWeight: FONT_WEIGHTS.edgeLabel,
  groupHeaderFontWeight: FONT_WEIGHTS.groupHeader,
  nodePaddingX: NODE_PADDING.horizontal,
  nodePaddingY: NODE_PADDING.vertical,
  diamondExtraPadding: NODE_PADDING.diamondExtra,
  edgeLineWidth: STROKE_WIDTHS.connector,
  groupCornerRadius: 0,
  groupPaddingX: 16,
  groupPaddingY: 16,
  groupLabelPaddingX: 12,
  groupLineWidth: STROKE_WIDTHS.outerBox,
}

function finiteNumber(value: number | undefined): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function positiveNumber(fallback: number, ...values: Array<number | undefined>): number {
  for (const value of values) {
    const finite = finiteNumber(value)
    if (finite != null && finite > 0) return finite
  }
  return fallback
}

function nonNegativeNumber(fallback: number, ...values: Array<number | undefined>): number
function nonNegativeNumber(fallback: undefined, ...values: Array<number | undefined>): number | undefined
function nonNegativeNumber(fallback: number | undefined, ...values: Array<number | undefined>): number | undefined {
  for (const value of values) {
    const finite = finiteNumber(value)
    if (finite != null && finite >= 0) return finite
  }
  return fallback
}

function finiteString(...values: Array<string | undefined>): string | undefined {
  for (const value of values) {
    if (typeof value === 'string' && value.trim().length > 0) return value
  }
  return undefined
}

function textTransform(...values: Array<string | undefined>): TextTransform | undefined {
  for (const value of values) {
    const normalized = finiteString(value)?.toLowerCase()
    if (normalized === 'uppercase' || normalized === 'lowercase' || normalized === 'capitalize') {
      return normalized
    }
  }
  return undefined
}

const INLINE_FORMAT_TAG = /(<\/?(?:b|strong|i|em|u|s|del)\s*>)/gi

export function applyTextTransform(text: string, transform: TextTransform | undefined): string {
  if (!transform) return text
  const transformPlain = (chunk: string): string => {
    switch (transform) {
      case 'uppercase':
        return chunk.toUpperCase()
      case 'lowercase':
        return chunk.toLowerCase()
      case 'capitalize':
        return chunk.replace(/\b\p{L}/gu, ch => ch.toUpperCase())
    }
  }
  return text
    .split(INLINE_FORMAT_TAG)
    .map(part => /^<\/?(?:b|strong|i|em|u|s|del)\s*>$/i.test(part) ? part : transformPlain(part))
    .join('')
}

export function resolveRenderStyle(
  options: RenderStyleOptions = {},
  defaults: RenderStyleDefaults = FLOWCHART_STYLE_DEFAULTS,
): ResolvedRenderStyle {
  const roles = styleRolesOf(options.style)
  const text = roles?.text
  const node = roles?.node
  const edge = roles?.edge
  const group = roles?.group
  const explicitGroupPaddingX = nonNegativeNumber(undefined, group?.paddingX)
  const cornerRadius = defaults.nodeCornerRadius == null
    ? nonNegativeNumber(undefined, node?.cornerRadius)
    : nonNegativeNumber(defaults.nodeCornerRadius, node?.cornerRadius)

  return {
    nodeLabelFontSize: positiveNumber(defaults.nodeLabelFontSize, node?.fontSize, text?.fontSize),
    edgeLabelFontSize: positiveNumber(defaults.edgeLabelFontSize, edge?.fontSize, text?.fontSize),
    groupHeaderFontSize: positiveNumber(defaults.groupHeaderFontSize, group?.fontSize, text?.fontSize),
    nodeLabelFontWeight: positiveNumber(defaults.nodeLabelFontWeight, node?.fontWeight, text?.fontWeight),
    edgeLabelFontWeight: positiveNumber(defaults.edgeLabelFontWeight, edge?.fontWeight, text?.fontWeight),
    groupHeaderFontWeight: positiveNumber(defaults.groupHeaderFontWeight, group?.fontWeight, text?.fontWeight),
    nodeTextTransform: textTransform(node?.textTransform, text?.textTransform, defaults.nodeTextTransform),
    edgeTextTransform: textTransform(edge?.textTransform, text?.textTransform, defaults.edgeTextTransform),
    nodeLetterSpacing: finiteNumber(node?.letterSpacing) ?? finiteNumber(text?.letterSpacing) ?? defaults.nodeLetterSpacing ?? 0,
    edgeLetterSpacing: finiteNumber(edge?.letterSpacing) ?? finiteNumber(text?.letterSpacing) ?? defaults.edgeLetterSpacing ?? 0,
    groupLetterSpacing: finiteNumber(group?.letterSpacing) ?? finiteNumber(text?.letterSpacing) ?? defaults.groupLetterSpacing ?? 0,
    nodePaddingX: nonNegativeNumber(defaults.nodePaddingX, node?.paddingX),
    nodePaddingY: nonNegativeNumber(defaults.nodePaddingY, node?.paddingY),
    diamondExtraPadding: defaults.diamondExtraPadding ?? NODE_PADDING.diamondExtra,
    cornerRadius,
    nodeLineWidth: positiveNumber(defaults.nodeLineWidth ?? STROKE_WIDTHS.innerBox, node?.lineWidth),
    nodeFillColor: finiteString(node?.fillColor, defaults.nodeFillColor),
    nodeBorderColor: finiteString(node?.borderColor, defaults.nodeBorderColor),
    nodeTextColor: finiteString(node?.textColor, text?.textColor, defaults.nodeTextColor),
    lineWidth: positiveNumber(defaults.edgeLineWidth, edge?.lineWidth),
    edgeBendRadius: nonNegativeNumber(defaults.edgeBendRadius ?? 0, edge?.bendRadius),
    edgeStrokeColor: finiteString(edge?.strokeColor, defaults.edgeStrokeColor),
    edgeTextColor: finiteString(edge?.textColor, text?.textColor, defaults.edgeTextColor),
    groupFont: finiteString(group?.fontFamily, defaults.groupFont),
    groupTextTransform: textTransform(group?.textTransform, text?.textTransform, defaults.groupTextTransform),
    groupCornerRadius: nonNegativeNumber(defaults.groupCornerRadius, group?.cornerRadius),
    groupBorderColor: finiteString(group?.borderColor, defaults.groupBorderColor),
    groupFillColor: finiteString(group?.fillColor, defaults.groupFillColor),
    groupHeaderFillColor: finiteString(group?.headerFillColor, defaults.groupHeaderFillColor),
    groupTextColor: finiteString(group?.textColor, text?.textColor, defaults.groupTextColor),
    groupPaddingX: explicitGroupPaddingX ?? defaults.groupPaddingX,
    groupPaddingY: nonNegativeNumber(defaults.groupPaddingY, group?.paddingY),
    groupLabelPaddingX: explicitGroupPaddingX ?? defaults.groupLabelPaddingX ?? defaults.groupPaddingX,
    groupLineWidth: positiveNumber(defaults.groupLineWidth ?? STROKE_WIDTHS.outerBox, group?.lineWidth),
  }
}
