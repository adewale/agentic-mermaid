// ============================================================================
// Agentic Mermaid — ASCII renderer public API (published as agentic-mermaid)
//
// Renders Mermaid diagrams to ASCII or Unicode box-drawing art.
// No external dependencies — pure TypeScript.
//
// Supported diagram types:
//   - Flowcharts (graph TD / flowchart LR) — grid-based layout with A* pathfinding
//   - State diagrams (stateDiagram-v2) — same pipeline as flowcharts
//   - Architecture diagrams (architecture-beta) — dedicated entrypoint built on graph layout
//   - Sequence diagrams (sequenceDiagram) — column-based timeline layout
//   - Class diagrams (classDiagram) — level-based UML layout
//   - ER diagrams (erDiagram) — grid layout with crow's foot notation
//   - Timeline diagrams (timeline) — chronological outline with grouped milestones
//   - User Journey diagrams (journey) — scored task lists with actor annotations
//   - XY charts (xychart / xychart-beta)
//   - Pie charts (pie) — proportional slice list
//   - Quadrant charts (quadrantChart) — coordinate plot with legend
//   - Gantt charts (gantt) — sectioned schedule bars and milestones
//
// Usage:
//   import { renderMermaidASCII } from 'agentic-mermaid'
//   const ascii = renderMermaidASCII('graph LR\n  A --> B')
// ============================================================================

import { detectColorMode, DEFAULT_ASCII_THEME, diagramColorsToAsciiTheme } from './ansi.ts'
import type { AsciiConfig, AsciiTheme, ColorMode } from './types.ts'
import { normalizeMermaidSource, detectDiagramTypeFromFirstLine } from '../mermaid-source.ts'
import type { MermaidRuntimeConfig } from '../mermaid-source.ts'
import { getFamily } from '../render-family-hooks.ts'
import type { DiagramKind } from '../agent/types.ts'
import { visualWidth } from './width.ts'
import { graphemes } from '../shared/graphemes.ts'
import { wrapText } from './wrap.ts'

// Re-export types for external use
export type { AsciiTheme, ColorMode }
export { DEFAULT_ASCII_THEME, detectColorMode, diagramColorsToAsciiTheme }

export interface AsciiRenderOptions {
  /** true = ASCII chars (+,-,|,>), false = Unicode box-drawing (┌,─,│,►). Default: false */
  useAscii?: boolean
  /** Horizontal spacing between nodes. Default: 5 */
  paddingX?: number
  /** Vertical spacing between nodes. Default: 5 */
  paddingY?: number
  /** Padding inside node boxes. Default: 1 */
  boxBorderPadding?: number
  /**
   * Color mode for output.
   * - 'none': No colors (plain text)
   * - 'auto': Auto-detect (terminal ANSI capabilities, or HTML in browsers)
   * - 'ansi16': 16-color ANSI
   * - 'ansi256': 256-color xterm
   * - 'truecolor': 24-bit RGB
   * - 'html': HTML <span> tags with inline color styles (for browser rendering)
   * Default: 'auto'
   */
  colorMode?: ColorMode | 'auto'
  /** Theme colors for ASCII output. Uses default theme if not provided. */
  theme?: Partial<AsciiTheme>
  /** Optional Mermaid-style runtime config (analogous to initialize/frontmatter config). */
  mermaidConfig?: MermaidRuntimeConfig
  /**
   * Loop 9 M13: cap output width in characters. When set, node labels wrap
   * at word boundaries to fit within `maxWidth / 3` per node. Single words
   * longer than `maxWidth / 2` render anyway (with a console.warn). The
   * overall canvas may still exceed `maxWidth` if the diagram has many
   * parallel columns; this is best-effort wrapping, not hard truncation.
   */
  maxWidth?: number
  /** Hard maximum output width in terminal display cells. */
  targetWidth?: number
  /**
   * Explicit "today" for the Gantt todayMarker (date in the diagram's
   * dateFormat or ISO YYYY-MM-DD). Gantt never reads the wall clock; without
   * this the marker is not drawn.
   */
  ganttToday?: string
}

/**
 * Render Mermaid diagram text to an ASCII/Unicode string.
 *
 * Synchronous — no async layout engine needed (unlike the SVG renderer).
 * Auto-detects diagram type from the header line and dispatches to
 * the appropriate renderer.
 *
 * @param text - Mermaid source text (any supported diagram type)
 * @param options - Rendering options
 * @returns Multi-line ASCII/Unicode string
 *
 * @example
 * ```ts
 * const result = renderMermaidAscii(`
 *   graph LR
 *     A --> B --> C
 * `, { useAscii: true })
 *
 * // Output:
 * // +---+     +---+     +---+
 * // |   |     |   |     |   |
 * // | A |---->| B |---->| C |
 * // |   |     |   |     |   |
 * // +---+     +---+     +---+
 * ```
 */
export type AsciiWidthErrorReason = 'UNBREAKABLE_GRAPHEME' | 'MINIMUM_GEOMETRY' | 'INVALID_WIDTH'

export class AsciiWidthError extends Error {
  readonly code = 'ASCII_TARGET_WIDTH_IMPOSSIBLE'
  constructor(
    readonly requestedWidth: number,
    readonly requiredWidth: number,
    readonly family: DiagramKind,
    readonly reason: AsciiWidthErrorReason,
  ) {
    super(`Cannot render ${family} within ${requestedWidth} terminal cells; required width is ${requiredWidth} (${reason}).`)
    this.name = 'AsciiWidthError'
  }

  /** Backward-friendly alias for callers that name the requested bound targetWidth. */
  get targetWidth(): number { return this.requestedWidth }
}

export function renderMermaidASCII(
  text: string,
  options: AsciiRenderOptions = {},
): string {
  if (options.maxWidth !== undefined && options.targetWidth !== undefined) {
    const family = detectDiagramTypeFromFirstLine(normalizeMermaidSource(text).firstLine) ?? 'flowchart'
    throw new AsciiWidthError(options.targetWidth, 1, family as DiagramKind, 'INVALID_WIDTH')
  }
  if (options.targetWidth !== undefined && (!Number.isFinite(options.targetWidth) || options.targetWidth <= 0 || !Number.isInteger(options.targetWidth))) {
    const family = detectDiagramTypeFromFirstLine(normalizeMermaidSource(text).firstLine) ?? 'flowchart'
    throw new AsciiWidthError(options.targetWidth, 1, family as DiagramKind, 'INVALID_WIDTH')
  }
  const config: AsciiConfig = {
    useAscii: options.useAscii ?? false,
    paddingX: options.paddingX ?? (options.targetWidth === undefined ? 5 : 1),
    paddingY: options.paddingY ?? 5,
    boxBorderPadding: options.boxBorderPadding ?? 1,
    graphDirection: 'TD', // default, overridden for flowcharts below
  }

  // Resolve color mode ('auto' or unset → detect environment, otherwise use specified mode)
  const colorMode: ColorMode = options.colorMode === 'auto' || options.colorMode === undefined
    ? detectColorMode()
    : options.colorMode

  // Merge user theme with defaults
  const theme: AsciiTheme = { ...DEFAULT_ASCII_THEME, ...options.theme }
  // Loop 9 M13: apply pre-render label wrapping if maxWidth is set. Walks
  // the source and rewrites bracket-quoted labels to insert <br/> at word
  // boundaries when the label exceeds (maxWidth / 3). Family-agnostic
  // because every renderer respects <br/> as a hard line break.
  const widthBudget = options.targetWidth ?? options.maxWidth
  const sourceText = widthBudget ? wrapLabelsInSource(text, widthBudget, options.targetWidth !== undefined) : text
  const normalizedSource = normalizeMermaidSource(sourceText, options.mermaidConfig ?? {})

  const diagramType = detectDiagramTypeFromFirstLine(normalizedSource.firstLine) ?? 'flowchart'

  const family = getFamily(diagramType as DiagramKind)
  if (!family?.renderAscii) {
    throw new Error(`No ASCII renderer registered for Mermaid family ${diagramType}`)
  }
  const output = family.renderAscii({
    source: normalizedSource,
    config,
    colorMode,
    theme,
    options: {
      maxWidth: widthBudget,
      targetWidth: options.targetWidth,
      ganttToday: options.ganttToday,
    },
  })

  if (options.targetWidth === undefined) return output
  const boundedOutput = output.split('\n').map(line => line.trimEnd()).join('\n').trimEnd()
  const requiredWidth = Math.max(0, ...boundedOutput.split('\n').map(terminalLineWidth))
  if (requiredWidth > options.targetWidth) {
    const hasTooWideGrapheme = graphemes(sourceText).some(cluster => visualWidth(cluster) > options.targetWidth!)
    throw new AsciiWidthError(
      options.targetWidth,
      requiredWidth,
      diagramType as DiagramKind,
      hasTooWideGrapheme ? 'UNBREAKABLE_GRAPHEME' : 'MINIMUM_GEOMETRY',
    )
  }
  return boundedOutput
}

/** Remove renderer-owned ANSI/HTML wrappers before measuring terminal cells. */
function terminalLineWidth(line: string): number {
  const plain = line
    .replace(/\x1b\[[0-9;]*m/g, '')
    .replace(/<\/?span(?:\s[^>]*)?>/g, '')
    // HTML mode escapes renderer text once. Decode exactly that one layer so
    // `&`, `<`, and `>` occupy the same cells as plain/ANSI output while an
    // authored literal `&amp;` still measures as five displayed characters.
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
  return visualWidth(plain)
}

/** @deprecated Use `renderMermaidASCII` */
export const renderMermaidAscii = renderMermaidASCII

/**
 * Loop 9 M13: wrap a single label string at word boundaries to fit a column
 * width. Words longer than `maxLineWidth` emit a warn and render as-is.
 * Returns the label with `<br/>` separators between wrapped lines.
 */
export function wrapLabel(text: string, maxLineWidth: number): string {
  if (visualWidth(text) <= maxLineWidth) return text
  const words = text.split(/\s+/).filter(Boolean)
  const lines: string[] = []
  let current = ''
  for (const word of words) {
    if (visualWidth(word) > maxLineWidth) {
      // Word can't fit on its own line — emit warning, render anyway.
      // eslint-disable-next-line no-console
      console.warn(`wrapLabel: word "${word.slice(0, 20)}..." exceeds maxLineWidth=${maxLineWidth}`)
      if (current) lines.push(current)
      lines.push(word)
      current = ''
      continue
    }
    if (current.length === 0) current = word
    else if (visualWidth(current) + 1 + visualWidth(word) <= maxLineWidth) current += ' ' + word
    else { lines.push(current); current = word }
  }
  if (current) lines.push(current)
  return lines.join('<br/>')
}

/**
 * Walk Mermaid source and wrap bracket-quoted labels (`["..."]`, `[...]`,
 * `(...)`, `{...}`, `((...))`) whose contents exceed `maxWidth / 3` columns.
 * Family-agnostic — works on flowchart node labels, sequence message text,
 * class members, etc.
 */
function wrapLabelsInSource(source: string, maxWidth: number, hard = false): string {
  const perLabel = Math.max(hard ? 1 : 8, Math.floor(maxWidth / 3))
  // Match bracket-quoted labels: ["text"], [text], (text), {text}, ((text))
  // Skip already-wrapped labels (those containing <br/>) and identifier-only labels.
  return source.replace(/(\[\[|\(\(|\[|\(|\{)("?)([^\[\]\(\)\{\}\n]+)\2(\]\]|\)\)|\]|\)|\})/g,
    (full, open: string, quote: string, inner: string, close: string) => {
      if (visualWidth(inner) <= perLabel || inner.includes('<br/>')) return full
      // Numeric arrays and coordinate tuples are grammar, not labels. Injecting
      // <br/> into `[1, 2]` or `[0.3, 0.4]` can erase chart data or make a
      // valid quadrant fail parsing at narrow target widths.
      if (/^[\s,+.\-0-9]+$/.test(inner)) return full
      // Don't wrap identifier-like content (no spaces, looks like a variable)
      if (!inner.includes(' ')) return full
      const wrapped = hard ? wrapText(inner, perLabel).join('<br/>') : wrapLabel(inner, perLabel)
      return open + quote + wrapped + quote + close
    })
}
