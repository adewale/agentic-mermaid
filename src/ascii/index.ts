// ============================================================================
// Agentic Mermaid — ASCII renderer public API (published as beautiful-mermaid)
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
//
// Usage:
//   import { renderMermaidASCII } from 'beautiful-mermaid'
//   const ascii = renderMermaidASCII('graph LR\n  A --> B')
// ============================================================================

import { parseMermaid } from '../parser.ts'
import { convertToAsciiGraph } from './converter.ts'
import { createMapping } from './grid.ts'
import { drawGraph } from './draw.ts'
import { canvasToString, flipCanvasVertically, flipRoleCanvasVertically } from './canvas.ts'
import { renderSequenceAscii } from './sequence.ts'
import { renderClassAscii } from './class-diagram.ts'
import { renderErAscii } from './er-diagram.ts'
import { renderTimelineAscii } from './timeline.ts'
import { renderJourneyAscii } from './journey.ts'
import { renderXYChartAscii } from './xychart.ts'
import { renderArchitectureAscii } from './architecture.ts'
import { detectColorMode, DEFAULT_ASCII_THEME, diagramColorsToAsciiTheme } from './ansi.ts'
import type { AsciiConfig, AsciiTheme, ColorMode } from './types.ts'
import { normalizeMermaidSource, detectDiagramTypeFromFirstLine } from '../mermaid-source.ts'
import type { MermaidRuntimeConfig } from '../mermaid-source.ts'

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
export function renderMermaidASCII(
  text: string,
  options: AsciiRenderOptions = {},
): string {
  const config: AsciiConfig = {
    useAscii: options.useAscii ?? false,
    paddingX: options.paddingX ?? 5,
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
  const sourceText = options.maxWidth ? wrapLabelsInSource(text, options.maxWidth) : text
  const normalizedSource = normalizeMermaidSource(sourceText, options.mermaidConfig ?? {})

  const diagramType = detectDiagramTypeFromFirstLine(normalizedSource.firstLine) ?? 'flowchart'

  switch (diagramType) {
    case 'architecture': {
      const vars = normalizedSource.config.themeVariables
      const archColors: import('../theme.ts').DiagramColors = {
        bg: (vars?.background as string) ?? '#ffffff',
        fg: (vars?.primaryTextColor as string) ?? (vars?.textColor as string) ?? '#27272A',
        line: vars?.lineColor as string | undefined,
        accent: vars?.primaryColor as string | undefined,
      }
      const archTheme = { ...theme, ...diagramColorsToAsciiTheme(archColors) }
      return renderArchitectureAscii(normalizedSource.lines, config, colorMode, archTheme)
    }

    case 'xychart':
      return renderXYChartAscii(normalizedSource.text, config, colorMode, theme, normalizedSource.frontmatter)

    case 'sequence':
      return renderSequenceAscii(normalizedSource.text, config, colorMode, theme)

    case 'class':
      return renderClassAscii(normalizedSource.text, config, colorMode, theme)

    case 'er':
      return renderErAscii(normalizedSource.text, config, colorMode, theme)

    case 'timeline':
      return renderTimelineAscii(normalizedSource.lines, config, colorMode, theme)

    case 'journey':
      return renderJourneyAscii(normalizedSource.text, config, colorMode, theme)

    case 'flowchart':
    default: {
      // Flowchart + state diagram pipeline (original)
      const parsed = parseMermaid(normalizedSource.text)

      // Normalize direction for grid layout.
      // BT is laid out as TD then flipped vertically after drawing.
      // RL is treated as LR (full RL support not yet implemented).
      if (parsed.direction === 'LR' || parsed.direction === 'RL') {
        config.graphDirection = 'LR'
      } else {
        config.graphDirection = 'TD'
      }

      const graph = convertToAsciiGraph(parsed, config)
      createMapping(graph)
      drawGraph(graph)

      // BT: flip the finished canvas vertically so the flow runs bottom→top.
      // The grid layout ran as TD; flipping + character remapping produces BT.
      if (parsed.direction === 'BT') {
        flipCanvasVertically(graph.canvas)
        flipRoleCanvasVertically(graph.roleCanvas)
      }

      return canvasToString(graph.canvas, {
        roleCanvas: graph.roleCanvas,
        colorMode,
        theme,
      })
    }
  }
}

/** @deprecated Use `renderMermaidASCII` */
export const renderMermaidAscii = renderMermaidASCII

/**
 * Loop 9 M13: wrap a single label string at word boundaries to fit a column
 * width. Words longer than `maxLineWidth` emit a warn and render as-is.
 * Returns the label with `<br/>` separators between wrapped lines.
 */
export function wrapLabel(text: string, maxLineWidth: number): string {
  if (text.length <= maxLineWidth) return text
  const words = text.split(/\s+/).filter(Boolean)
  const lines: string[] = []
  let current = ''
  for (const word of words) {
    if (word.length > maxLineWidth) {
      // Word can't fit on its own line — emit warning, render anyway.
      // eslint-disable-next-line no-console
      console.warn(`wrapLabel: word "${word.slice(0, 20)}..." exceeds maxLineWidth=${maxLineWidth}`)
      if (current) lines.push(current)
      lines.push(word)
      current = ''
      continue
    }
    if (current.length === 0) current = word
    else if (current.length + 1 + word.length <= maxLineWidth) current += ' ' + word
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
function wrapLabelsInSource(source: string, maxWidth: number): string {
  const perLabel = Math.max(8, Math.floor(maxWidth / 3))
  // Match bracket-quoted labels: ["text"], [text], (text), {text}, ((text))
  // Skip already-wrapped labels (those containing <br/>) and identifier-only labels.
  return source.replace(/(\[\[|\(\(|\[|\(|\{)("?)([^\[\]\(\)\{\}\n]+)\2(\]\]|\)\)|\]|\)|\})/g,
    (full, open: string, quote: string, inner: string, close: string) => {
      if (inner.length <= perLabel || inner.includes('<br/>')) return full
      // Don't wrap identifier-like content (no spaces, looks like a variable)
      if (!inner.includes(' ')) return full
      const wrapped = wrapLabel(inner, perLabel)
      return open + quote + wrapped + quote + close
    })
}
