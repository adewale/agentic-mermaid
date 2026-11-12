// Complete source-or-parsed terminal API. Source-only consumers use /ascii.
import { prepareRenderInput, type PreparedRenderInput } from '../agent/render-input.ts'
import { parseRegisteredMermaid } from '../agent/parse.ts'
import type { ParsedDiagram } from '../agent/types.ts'
import { executeTerminalRender as executeSourceTerminalRender, type AsciiRenderOptions, type RenderedAscii } from './render.ts'
export { AsciiWidthError, DEFAULT_ASCII_THEME, detectColorMode, diagramColorsToAsciiTheme } from './render.ts'
export type { AsciiRenderOptions, RenderedAscii, AsciiTheme, ColorMode, TerminalLayoutCertification, AsciiWidthErrorReason } from './render.ts'

export function renderMermaidASCII(input: ParsedDiagram | string, options: AsciiRenderOptions = {}): string {
  return renderMermaidASCIIWithReceipt(input, options).text
}

export function renderMermaidASCIIWithReceipt(input: ParsedDiagram | string, options: AsciiRenderOptions = {}): RenderedAscii {
  return executeTerminalRender(prepareRenderInput(input), options).rendered
}

/** Complete execution also retains the agent parser for terminal metadata. */
export function executeTerminalRender(preparedInput: PreparedRenderInput, options: AsciiRenderOptions) {
  return executeSourceTerminalRender(preparedInput, options, () => parseRegisteredMermaid(preparedInput.source))
}
