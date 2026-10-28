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
import { frontmatterTitle, type NormalizedMermaidSource } from '../mermaid-source.ts'
import type { ParsedDiagram } from '../agent/types.ts'
import { prepareRenderInput, type PreparedRenderInput } from '../agent/render-input.ts'
import { isBuiltinFamilyId, type AsciiContext } from '../agent/families.ts'
import { requireRegisteredMermaidFamily } from '../family-detection.ts'
import type { RenderOptions } from '../types.ts'
import { withGraphLayoutDecisionObserver } from '../layout/backend.ts'
import {
  renderContractDigest,
  receiptOf,
  resolveRenderRequestForExecution,
  resolvedFamilyRenderContextOf,
  resolvedRenderExecutionPlanOf,
  type RenderRequestReceipt,
} from '../render-contract.ts'
import { sharedRenderOptionsOf } from '../shared-render-options.ts'
import { deferredDependency } from '../layout/certification-error.ts'
import { projectTerminalStyle, withTerminalConnectorScene, type ResolvedTerminalStyle, type TerminalProjectionDiagnostic } from '../terminal-style.ts'
import { emitResolvedConfigDiagnostics } from '../render-config-diagnostics.ts'
import { visualWidth } from './width.ts'
import { graphemes } from '../shared/graphemes.ts'
import { wrapText } from './wrap.ts'
import { displayText } from '../multiline-utils.ts'
import { positionResolvedFamily, retainRequestGraphLayoutDecision } from '../positioning.ts'
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
import { AsciiWidthError } from './width-error.ts'
import { parsePieChart } from '../pie/parser.ts'
import { pieFamilyLines } from '../pie/source-title.ts'
import { safePieTerminalText } from './pie.ts'
import { retainTerminalDocument, TerminalDocument } from './terminal-document.ts'
import { certifyTerminalLayout } from './terminal-certification.ts'
import { nativeTerminalArtifact } from './terminal-artifact.ts'
import { terminalInputModel, type TerminalInputModel } from './terminal-model.ts'

// Re-export types for external use
export type { AsciiTheme, ColorMode }
export type { TerminalLayoutCertification } from './terminal-certification.ts'
export { DEFAULT_ASCII_THEME, detectColorMode, diagramColorsToAsciiTheme }
export { AsciiWidthError } from './width-error.ts'
export type { AsciiWidthErrorReason } from './width-error.ts'

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
  return executeTerminalRender(prepareRenderInput(input), options).rendered
}

/** Internal execution shared with metadata. The authored model stays local to
 * this execution rather than being retained by the public rendered result. */
export function executeTerminalRender(
  preparedInput: PreparedRenderInput,
  options: AsciiRenderOptions,
): { rendered: RenderedAscii; model: TerminalInputModel } {
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

  // Families wrap prepared display text in cells, retaining source identity.
  const widthBudget = outputPolicy.targetWidth ?? outputPolicy.maxWidth
  const outputKind = colorMode === 'html' ? 'html' : outputPolicy.useAscii ? 'ascii' : 'unicode'
  // The terminal adapter owns its cell-grid controls. Only the canonical
  // RenderOptions projection enters the shared waist; this keeps validation
  // strict without misclassifying terminal-only fields as unknown options.
  const sharedOptions = sharedRenderOptionsOf(options)
  const request = resolveRenderRequestForExecution(text, sharedOptions, outputKind, outputPolicy, {
    expectedFamilyId: preparedInput.expectedFamilyId,
  })
  emitResolvedConfigDiagnostics(request)
  const executionPlan = resolvedRenderExecutionPlanOf(request)
  const family = executionPlan.family
  // Family parsers retain authored identities and endpoints. Terminal text
  // preparation neutralizes display controls before cell fitting; the final
  // painting/encoding boundary provides the same protection for direct runs.
  const normalizedSource = request.source
  config.title = frontmatterTitle(normalizedSource.frontmatter)
  config.maxWidth = widthBudget
  config.targetWidth = outputPolicy.targetWidth
  // Source admission sees the authored `\\r` / `\\t` bytes, not the control
  // characters created by Pie's grammar. Reflect the family-owned terminal
  // projection in the shared receipt and public diagnostics as well.
  const pieControlsReplaced = family.id === 'pie' && (() => {
    const chart = parsePieChart(pieFamilyLines(normalizedSource))
    const visibleTitle = chart.displayTitle ?? chart.title
    return (visibleTitle !== undefined && safePieTerminalText(visibleTitle) !== visibleTitle)
      || chart.entries.some(entry => {
        const visible = entry.displayLabel ?? entry.label
        return safePieTerminalText(visible) !== visible
      })
  })()
  const familyContext = resolvedFamilyRenderContextOf(request)
  const diagramType = family.id
  const appearance = projectTerminalStyle(request, colorMode, outputPolicy.theme, undefined, {
    controlsReplaced: terminalControlsReplaced(normalizedSource) || pieControlsReplaced,
  })
  let projectedStyle: ResolvedTerminalStyle | undefined
  const connectorStyle = (): ResolvedTerminalStyle => {
    if (projectedStyle) return projectedStyle
    let connectorScene: SceneDoc | null = null
    let failed = false
    if (family.lowerScene && family.layout) {
      try {
        const layout = positionResolvedFamily(diagramType, request, normalizedSource)
        // ASCII draws from the connectors' terminal projections, so their
        // derivation is always cross-checked here.
        connectorScene = admitFamilyScene(family, family.lowerScene({
          positioned: layout.positioned,
          colors: connectorSceneColors(request.appearance.colors),
          resolved: familyContext,
        }), true)
      } catch (error) {
        const deferred = deferredDependency(error)
        if (deferred) throw deferred
        // Optional pixel evidence must not become a native layout dependency.
        failed = true
      }
    }
    return projectedStyle = withTerminalConnectorScene(appearance, connectorScene, failed)
  }
  // Preserve callback ordering. Native output otherwise needs only appearance;
  // full receipts evaluate the same
  // graphical evidence on first access and retain it for subsequent accesses.
  if (options.onProjectionDiagnostic) connectorStyle()
  for (const diagnostic of projectedStyle?.diagnostics ?? []) options.onProjectionDiagnostic?.(diagnostic)
  const theme: AsciiTheme = appearance.theme
  const model = terminalInputModel(text, normalizedSource.familyBody)
  const context: AsciiContext = {
    source: normalizedSource,
    ...familyContext,
    config,
    colorMode,
    theme,
    get connectorProjection() { return connectorStyle().connectorProjection.connectors },
    options: {
      maxWidth: widthBudget,
      targetWidth: outputPolicy.targetWidth,
      ganttToday: familyContext.renderOptions.ganttToday,
    },
  }
  const { artifact, legacyOutput } = withGraphLayoutDecisionObserver(decision => retainRequestGraphLayoutDecision(request, decision, 'primary'), () => {
    const artifact = nativeTerminalArtifact(family.renderAscii!, context, model)
    return { artifact, legacyOutput: artifact ? undefined : family.renderAscii!(context) }
  })
  let drawing = artifact?.document
  const title = frontmatterTitle(normalizedSource.frontmatter)
  if (drawing && title && !drawing.titleHandled && !drawing.hasOwner('title', 'label')) {
    const titled = new TerminalDocument()
    for (const line of wrapText(displayText(title), widthBudget)) titled.line([{ text: line, owner: { id: 'title', kind: 'label' }, role: 'text', textGroup: 'title' }])
    titled.line()
    titled.overlay(drawing, 0, titled.height)
    drawing = titled
  }
  const drawingDiagnostics = drawing?.diagnostics ?? []
  for (const diagnostic of drawingDiagnostics) options.onProjectionDiagnostic?.(diagnostic)
  let completedStyle: ResolvedTerminalStyle | undefined
  const terminalStyle = (): ResolvedTerminalStyle => {
    if (completedStyle) return completedStyle
    const style = connectorStyle()
    if (!drawingDiagnostics.length) return completedStyle = style
    const diagnostics = Object.freeze([...style.diagnostics, ...drawingDiagnostics])
    return completedStyle = Object.freeze({ ...style, diagnostics, digest: renderContractDigest({ style: style.digest, diagnostics }) })
  }
  const renderedOutput = drawing
    ? drawing.serialize({ ...artifact!.serialization, colorMode, theme,
      ...((drawing !== artifact!.document || outputPolicy.targetWidth !== undefined) ? { trimEnd: true } : {}),
    })
    : legacyOutput!
  // HTML is an output encoding, not permission for family renderers to emit
  // authored markup. Secure the completed artifact at the common boundary so
  // raw labels are escaped even in renderers that concatenate them beside
  // trusted color spans.
  const output = isBuiltinFamilyId(family.id)
    ? colorMode === 'html'
      ? secureTerminalHtmlOutput(renderedOutput)
      : renderedOutput
    : admitExternalTerminalOutput(renderedOutput, colorMode)
  let receipt: RenderRequestReceipt | undefined
  const resultOf = (text: string): RenderedAscii => {
    let certification: ReturnType<typeof certifyTerminalLayout> | undefined
    const certificate = () => certification ??= certifyTerminalLayout(drawing, text, colorMode)
    if (request.renderOptions.layoutSafety === 'strict' && certificate().status !== 'passed') throw new Error(`Strict terminal layout safety failed: ${certificate().issues.map(issue => issue.message).join('; ')}`)
    const result = {
      text,
      get receipt() { return receipt ??= Object.freeze({ ...receiptOf(request, terminalStyle().diagnostics), layoutCertification: certificate() }) },
      get terminalStyle() { return terminalStyle() },
      outputPolicy,
    }
    retainTerminalDocument(result, drawing)
    return result
  }

  const targetWidth = outputPolicy.targetWidth
  if (targetWidth === undefined) {
    return { rendered: resultOf(output), model }
  }
  const boundedOutput = drawing ? output : output.split('\n').map(line => line.trimEnd()).join('\n').trimEnd()
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
  return { rendered: resultOf(boundedOutput), model }
}

/** Diagnostics observe authored controls without rewriting grammar input or
 * semantic metadata. Only displayed text is sanitized by terminal adapters. */
function terminalControlsReplaced(source: Readonly<NormalizedMermaidSource>): boolean {
  const containsControls = (value: unknown): boolean => {
    if (typeof value === 'string') return sanitizeTerminalText(value) !== value
    if (Array.isArray(value)) return value.some(containsControls)
    if (value !== null && typeof value === 'object') {
      return Object.entries(value).some(([key, child]) => containsControls(key) || containsControls(child))
    }
    return false
  }
  return source.originalText.split(/\r?\n/).some(containsControls)
    || source.body.split(/\r?\n/).some(containsControls)
    || containsControls(source.config)
    || containsControls(source.frontmatter)
    || containsControls(source.initDirectives)
    || containsControls(source.comments)
    || containsControls(source.accessibility)
}
