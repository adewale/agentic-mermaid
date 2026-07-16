// ============================================================================
// Agentic Mermaid — ASCII renderer public API (published as agentic-mermaid)
//
// Renders Mermaid diagrams to ASCII or Unicode box-drawing art.
// No external dependencies — pure TypeScript.
//
// Supported families are owned by the FamilyDescriptor registry and surfaced
// through capabilities. Keeping a second roster here would drift.
//
// Usage:
//   import { renderMermaidASCII } from 'agentic-mermaid'
//   const ascii = renderMermaidASCII('graph LR\n  A --> B')
// ============================================================================

import { detectColorMode, DEFAULT_ASCII_THEME, diagramColorsToAsciiTheme } from './ansi.ts'
import type { AsciiConfig, AsciiTheme, ColorMode } from './types.ts'
import { normalizeMermaidSource, toMermaidLines, type NormalizedMermaidSource } from '../mermaid-source.ts'
import type { FamilyId, ParsedDiagram } from '../agent/types.ts'
import { prepareRenderInput } from '../agent/render-input.ts'
import { isBuiltinFamilyId } from '../agent/families.ts'
import { requireRegisteredMermaidFamily } from '../family-detection.ts'
import type { RenderOptions } from '../types.ts'
import {
  NON_SERIALIZABLE_RENDER_OPTION_FIELDS,
  SHARED_RENDER_OPTION_FIELDS,
  receiptOf,
  resolveRenderRequestForExecution,
  resolvedFamilyRenderContextOf,
  resolvedRenderExecutionPlanOf,
  type RenderRequestReceipt,
} from '../render-contract.ts'
import { projectTerminalStyle, type ResolvedTerminalStyle, type TerminalProjectionDiagnostic } from '../terminal-style.ts'
import { emitResolvedConfigDiagnostics } from '../render-config-diagnostics.ts'
import { visualWidth } from './width.ts'
import { graphemes } from '../shared/graphemes.ts'
import { wrapText } from './wrap.ts'
import { positionResolvedFamily } from '../positioning.ts'
import type { SceneDoc } from '../scene/ir.ts'
import { admitFamilyScene } from '../scene/admission.ts'
import type { DiagramColors } from '../theme.ts'
import { safeCssPaint } from '../shared/css-color.ts'
import { safeCssFontFamily } from '../shared/css-font.ts'
import {
  resolveTerminalOutputPolicy,
  type ResolvedTerminalOutputPolicy,
  type TerminalOutputPolicyInput,
} from '../terminal-contract.ts'
import {
  admitExternalTerminalOutput,
  sanitizeTerminalText,
  secureTerminalHtmlOutput,
  terminalOutputLineWidth,
} from '../terminal-security.ts'

// Re-export types for external use
export type { AsciiTheme, ColorMode }
export { DEFAULT_ASCII_THEME, detectColorMode, diagramColorsToAsciiTheme }

/** Scene lowering supplies typed connector semantics to terminal output, but
 * its prelude is graphical. Give that non-emitted prelude inert values while
 * retaining the original appearance in the terminal projection so unsafe
 * inputs receive stable diagnostics instead of being hidden or executed. */
function connectorSceneColors(colors: Readonly<DiagramColors>): DiagramColors {
  const optionalPaint = (value: string | undefined): string | undefined =>
    value === undefined ? undefined : safeCssPaint(value)
  return {
    ...colors,
    bg: safeCssPaint(colors.bg) ?? '#ffffff',
    fg: safeCssPaint(colors.fg) ?? '#27272a',
    line: optionalPaint(colors.line),
    accent: optionalPaint(colors.accent),
    muted: optionalPaint(colors.muted),
    surface: optionalPaint(colors.surface),
    border: optionalPaint(colors.border),
    font: safeCssFontFamily(colors.font) ?? 'Inter',
  }
}

export interface AsciiRenderOptions extends RenderOptions, TerminalOutputPolicyInput {
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
  /** Receives explicit graphical-to-terminal projection losses. */
  onProjectionDiagnostic?: (diagnostic: TerminalProjectionDiagnostic) => void
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
 * const result = renderMermaidASCII(`
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
    readonly family: FamilyId,
    readonly reason: AsciiWidthErrorReason,
  ) {
    super(`Cannot render ${family} within ${requestedWidth} terminal cells; required width is ${requiredWidth} (${reason}).`)
    this.name = 'AsciiWidthError'
  }

}

export function renderMermaidASCII(
  text: ParsedDiagram | string,
  options: AsciiRenderOptions = {},
): string {
  return renderMermaidASCIIWithReceipt(text, options).text
}

export interface RenderedAscii {
  text: string
  receipt: RenderRequestReceipt
  terminalStyle: ResolvedTerminalStyle
  outputPolicy: ResolvedTerminalOutputPolicy
}

export function renderMermaidASCIIWithReceipt(
  input: ParsedDiagram | string,
  options: AsciiRenderOptions = {},
): RenderedAscii {
  const preparedInput = prepareRenderInput(input)
  const text = preparedInput.source
  const outputPolicy: ResolvedTerminalOutputPolicy = resolveTerminalOutputPolicy({
    useAscii: options.useAscii,
    paddingX: options.paddingX,
    paddingY: options.paddingY,
    boxBorderPadding: options.boxBorderPadding,
    colorMode: options.colorMode,
    theme: options.theme,
    maxWidth: options.maxWidth,
    targetWidth: options.targetWidth,
  })
  const config: AsciiConfig = {
    useAscii: outputPolicy.useAscii,
    paddingX: outputPolicy.paddingX,
    paddingY: outputPolicy.paddingY,
    boxBorderPadding: outputPolicy.boxBorderPadding,
    graphDirection: 'TD', // default, overridden for flowcharts below
  }
  const colorMode = outputPolicy.colorMode

  // Loop 9 M13: apply pre-render label wrapping if maxWidth is set. Walks
  // the source and rewrites bracket-quoted labels to insert <br/> at word
  // boundaries when the label exceeds (maxWidth / 3). Family-agnostic
  // because every renderer respects <br/> as a hard line break.
  const widthBudget = outputPolicy.targetWidth ?? outputPolicy.maxWidth
  const outputKind = colorMode === 'html' ? 'html' : outputPolicy.useAscii ? 'ascii' : 'unicode'
  // The terminal adapter owns its cell-grid controls. Only the canonical
  // RenderOptions projection enters the shared waist; this keeps validation
  // strict without misclassifying terminal-only fields as unknown options.
  const sharedOptions = Object.fromEntries(
    [...SHARED_RENDER_OPTION_FIELDS, ...NON_SERIALIZABLE_RENDER_OPTION_FIELDS]
      .filter(field => options[field] !== undefined)
      .map(field => [field, options[field]]),
  ) as RenderOptions
  const request = resolveRenderRequestForExecution(text, sharedOptions, outputKind, outputPolicy, {
    expectedFamilyId: preparedInput.expectedFamilyId,
  })
  emitResolvedConfigDiagnostics(request)
  // Sanitize user-derived text before layout, cell measurement, or trusted
  // ANSI/HTML wrappers are introduced. A visible one-cell replacement keeps
  // renderer geometry and emitted geometry coherent.
  const terminalSource = projectTerminalSafeSource(request.source)
  // Width-driven label wrapping is an output projection. Project only the
  // already-normalized diagram body: reparsing the authored wrapper would
  // merge frontmatter/init config a second time and historically lost nested
  // config on width-bounded renders. Keep the authored source and its resolved
  // config in the shared receipt.
  const normalizedSource = widthBudget
    ? projectLabelsInNormalizedSource(terminalSource.source, widthBudget, outputPolicy.targetWidth !== undefined)
    : terminalSource.source
  const executionPlan = resolvedRenderExecutionPlanOf(request)
  const family = executionPlan.family
  const familyContext = resolvedFamilyRenderContextOf(request)
  const diagramType = family.id
  let connectorScene: SceneDoc | null = null
  let connectorProjectionFailed = false
  if (family.lowerScene && family.layout) {
    try {
      const layout = positionResolvedFamily(diagramType, request, terminalSource.source)
      connectorScene = admitFamilyScene(family, family.lowerScene({
        positioned: layout.positioned,
        colors: connectorSceneColors(request.appearance.colors),
        resolved: familyContext,
      }))
    } catch {
      // Scene evidence enriches terminal connector semantics, but renderAscii
      // is the complete negotiated terminal tuple. Optional graphical hooks
      // must never become an undeclared runtime prerequisite.
      connectorProjectionFailed = true
    }
  }
  const terminalStyle = projectTerminalStyle(
    request,
    colorMode,
    outputPolicy.theme,
    connectorScene,
    {
      controlsReplaced: terminalSource.controlsReplaced,
      connectorProjectionFailed,
    },
  )
  for (const diagnostic of terminalStyle.diagnostics) options.onProjectionDiagnostic?.(diagnostic)
  const theme: AsciiTheme = terminalStyle.theme
  const renderedOutput = family.renderAscii!({
    source: normalizedSource,
    // Forward the canonical family context as one unit. Enumerating today's
    // fields here previously dropped styleFace and made the terminal hook a
    // narrower contract than layout and Scene lowering.
    ...familyContext,
    config,
    colorMode,
    theme,
    connectorProjection: terminalStyle.connectorProjection.connectors,
    options: {
      maxWidth: widthBudget,
      targetWidth: outputPolicy.targetWidth,
      ganttToday: familyContext.renderOptions.ganttToday,
    },
  })
  // HTML is an output encoding, not permission for family renderers to emit
  // authored markup. Secure the completed artifact at the common boundary so
  // raw labels are escaped even in renderers that concatenate them beside
  // trusted color spans.
  const output = isBuiltinFamilyId(family.id)
    ? colorMode === 'html'
      ? secureTerminalHtmlOutput(renderedOutput)
      : renderedOutput
    : admitExternalTerminalOutput(renderedOutput, colorMode)
  const receipt = receiptOf(request, terminalStyle.diagnostics)

  const targetWidth = outputPolicy.targetWidth
  if (targetWidth === undefined) {
    return { text: output, receipt, terminalStyle, outputPolicy }
  }
  const boundedOutput = output.split('\n').map(line => line.trimEnd()).join('\n').trimEnd()
  const requiredWidth = Math.max(
    0,
    ...boundedOutput.split('\n').map(line => terminalOutputLineWidth(line, colorMode)),
  )
  if (requiredWidth > targetWidth) {
    const hasTooWideGrapheme = graphemes(normalizedSource.body).some(cluster => visualWidth(cluster) > targetWidth)
    throw new AsciiWidthError(
      targetWidth,
      requiredWidth,
      diagramType,
      hasTooWideGrapheme ? 'UNBREAKABLE_GRAPHEME' : 'MINIMUM_GEOMETRY',
    )
  }
  return { text: boundedOutput, receipt, terminalStyle, outputPolicy }
}

interface TerminalSafeSourceProjection {
  readonly source: NormalizedMermaidSource
  readonly controlsReplaced: boolean
}

/** Clone/freeze source metadata while neutralizing every string that a family
 * terminal renderer can consume. Structural CR/LF survive only in source
 * bodies; metadata strings never carry terminal controls. */
function projectTerminalSafeSource(source: Readonly<NormalizedMermaidSource>): TerminalSafeSourceProjection {
  let controlsReplaced = false
  const sanitizeStructural = (value: string): string => {
    const result = sanitizeTerminalText(value, true)
    if (result !== value) controlsReplaced = true
    return result
  }
  const sanitizeValue = <T>(value: T): T => {
    if (typeof value === 'string') {
      const result = sanitizeTerminalText(value)
      if (result !== value) controlsReplaced = true
      return result as T
    }
    if (Array.isArray(value)) return Object.freeze(value.map(sanitizeValue)) as T
    if (value !== null && typeof value === 'object') {
      return Object.freeze(Object.fromEntries(
        Object.entries(value).map(([key, child]) => [sanitizeValue(key), sanitizeValue(child)]),
      )) as T
    }
    return value
  }

  const body = sanitizeStructural(source.body)
  const lines = toMermaidLines(body)
  const projected = normalizeMermaidSource(body)
  const safeSource: NormalizedMermaidSource = {
    ...source,
    originalText: sanitizeStructural(source.originalText),
    text: lines.join('\n'),
    body,
    lines: Object.freeze(lines) as unknown as string[],
    familyBody: projected.familyBody,
    familyText: projected.familyText,
    familyLines: Object.freeze(projected.familyLines) as unknown as string[],
    firstLine: lines[0]?.toLowerCase() ?? '',
    config: sanitizeValue(source.config),
    frontmatter: sanitizeValue(source.frontmatter),
    ...(source.wrapperSource === undefined ? {} : { wrapperSource: sanitizeStructural(source.wrapperSource) }),
    initDirectives: sanitizeValue(source.initDirectives),
    comments: sanitizeValue(source.comments),
    accessibility: sanitizeValue(source.accessibility),
  }
  return Object.freeze({ source: Object.freeze(safeSource), controlsReplaced })
}

function projectLabelsInNormalizedSource(
  source: NormalizedMermaidSource,
  width: number,
  hard: boolean,
): NormalizedMermaidSource {
  const body = source.body
    .split(/\r?\n/)
    .map(line => /^\s*%%/.test(line) ? line : wrapLabelsInSource(line, width, hard))
    .join('\n')
  if (body === source.body) return source
  const lines = toMermaidLines(body)
  const projected = normalizeMermaidSource(body)
  return Object.freeze({
    ...source,
    body,
    text: lines.join('\n'),
    lines: Object.freeze(lines) as unknown as string[],
    familyBody: projected.familyBody,
    familyText: projected.familyText,
    familyLines: Object.freeze(projected.familyLines) as unknown as string[],
    firstLine: lines[0]?.toLowerCase() ?? '',
  })
}

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
