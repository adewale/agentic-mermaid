import { prepareDisplayText, type DisplayTextInput, type PreparedDisplayText } from './shared/display-text.ts'
// ============================================================================
// Font metrics — character width estimates for Inter at different sizes.
// Used to approximate text bounding boxes without DOM measurement.
// These are calibrated for Inter's typical glyph widths.
//
// NOTE: Theme/color system has moved to src/theme.ts. This file only
// contains font metrics, spacing constants, stroke widths, render-style
// resolution, and the shared diagram-title band.
// ============================================================================

import type { TextMark } from './scene/ir.ts'
import * as marks from './scene/marks.ts'
import { measureMonospaceTextWidth, measureMultilineText, measureTextWidth } from './text-metrics'
import type { InternalStyleFace, StyleInput } from './scene/style-registry.ts'
import type { TextTransform } from './types.ts'
import { FORMAT_TAG_SOURCE } from './shared/inline-format.ts'
import { preparePixelText, type PixelTextBlock } from './shared/prepared-text.ts'

/** Average character width in px at the given font size and weight (proportional font) */
export function estimateTextWidth(text: string, fontSize: number, fontWeight: number): number {
  // Delegate to variable-width character measurement for better accuracy
  // with mixed character sets (Latin narrow/wide, CJK, emoji, etc.)
  return measureTextWidth(text, fontSize, fontWeight)
}

/** Average character width in px for monospace fonts (uniform glyph width) */
export function estimateMonoTextWidth(text: string, fontSize: number): number {
  return measureMonospaceTextWidth(text, fontSize)
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
  strokeWidth: 0.75,
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
  /** A style input (name | spec | stack); built-in style faces are read here. */
  style?: StyleInput | StyleInput[]
  /** @internal Projected families can pass precomputed face metrics without exposing them as public style JSON. */
  styleFace?: InternalStyleFace
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

/** Preserve authored formatting syntax while transforming the complete visible
 * word. Source ranges keep tags from introducing false capitalization points. */
export function applyTextTransform(text: string, transform: TextTransform | undefined): string
export function applyTextTransform(text: PreparedDisplayText, transform: TextTransform | undefined): PreparedDisplayText
export function applyTextTransform(text: DisplayTextInput, transform: TextTransform | undefined): DisplayTextInput
export function applyTextTransform(text: DisplayTextInput, transform: TextTransform | undefined): DisplayTextInput {
  if (typeof text !== 'string') return prepareDisplayText(text, text.display, transform)
  if (!transform) return text
  const prepared = prepareDisplayText(text, 'formatted', transform)
  let cursor = 0, result = ''
  for (const runs of prepared.lines) for (const run of runs) {
    result += text.slice(cursor, run.sourceStart) + run.text
    cursor = run.sourceEnd
  }
  return result + text.slice(cursor)
}

export function resolveRenderStyle(
  options: RenderStyleOptions = {},
  defaults: RenderStyleDefaults = FLOWCHART_STYLE_DEFAULTS,
  resolvedFace?: Readonly<InternalStyleFace>,
): ResolvedRenderStyle {
  const face = resolvedFace ?? options.styleFace
  const text = face?.text
  const node = face?.node
  const edge = face?.edge
  const group = face?.group
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

// ============================================================================
// Diagram titles for families that have no title statement of their own.
//
// A frontmatter `title:` is the diagram's title in Mermaid for every family.
// Families with a `title` statement (pie, gantt, journey, …) draw it with their
// own furniture; flowchart, state, class, ER, sequence and mindmap draw it in a
// band above the content with these shared metrics, so the six agree.
// ============================================================================

export const DIAGRAM_TITLE_FONT_SIZE = 18
export const DIAGRAM_TITLE_FONT_WEIGHT = 600
/** Space between the title and the content below it. */
export const DIAGRAM_TITLE_GAP = 12

/** A title placed on the canvas: its display text centered at (x, y). */
export interface PositionedDiagramTitle {
  text: string
  x: number
  y: number
  block?: PixelTextBlock
}

/** The band a title needs above the content: display text, width, and height
 * including the gap to the content. */
export interface DiagramTitleBand {
  text: string
  width: number
  height: number
  block?: PixelTextBlock
}

export function diagramTitleBand(
  title: DisplayTextInput | undefined,
  style: Pick<ResolvedRenderStyle, 'groupTextTransform' | 'groupLetterSpacing' | 'groupFont'>,
): DiagramTitleBand | undefined {
  if (title === undefined) return undefined
  const block = preparePixelText(title, { display: 'formatted', transform: style.groupTextTransform, fontSize: DIAGRAM_TITLE_FONT_SIZE, fontWeight: DIAGRAM_TITLE_FONT_WEIGHT, letterSpacing: style.groupLetterSpacing, fontFamily: style.groupFont })
  return { text: block.text, width: block.width, height: block.height + DIAGRAM_TITLE_GAP, block }
}

/** The canvas of a diagram with nothing but a title: the title alone, padded
 * on every side, as the families whose title is their own furniture draw it.
 * Without a title, a diagram with no content stays an empty canvas. */
export function titleOnlyCanvas(band: DiagramTitleBand, padX: number, padY = padX): { width: number; height: number; title: PositionedDiagramTitle } {
  const width = band.width + 2 * padX
  return { width, height: band.height - DIAGRAM_TITLE_GAP + 2 * padY, title: positionDiagramTitle(band, width, padY) }
}

/** Where a band's title sits on a canvas `width` wide with `top` padding. */
export function positionDiagramTitle(band: DiagramTitleBand, width: number, top: number): PositionedDiagramTitle {
  return { text: band.text, x: width / 2, y: top + (band.height - DIAGRAM_TITLE_GAP) / 2, ...(band.block ? { block: band.block } : {}) }
}

export function diagramTitleMark(title: PositionedDiagramTitle, style: ResolvedRenderStyle): TextMark {
  return marks.text(diagramTitleFields(title, style))
}

export function diagramTitleFields(title: PositionedDiagramTitle, style: ResolvedRenderStyle): Parameters<typeof marks.text>[0] {
  const fill = style.groupTextColor ?? 'var(--_text)'
  return {
    id: 'diagram-title', role: 'title', text: title.text, block: title.block, x: title.x, y: title.y,
    fontSize: DIAGRAM_TITLE_FONT_SIZE, fontWeight: DIAGRAM_TITLE_FONT_WEIGHT, letterSpacing: style.groupLetterSpacing,
    anchor: 'middle', paint: { fill }, attributes: { className: 'diagram-title' },
  }
}
