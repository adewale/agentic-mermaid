// Source-to-text entry. Parsed editing and graphical receipt evidence remain
// available through the complete package entry.
import './browser-lazy/generated/terminal-synchronous.ts'
import { executeTerminalRender, type AsciiRenderOptions } from './ascii/render.ts'

/** Text-only rendering does not compute graphical projection diagnostics. */
export type AsciiSourceRenderOptions = Omit<AsciiRenderOptions, 'onProjectionDiagnostic'>

export function renderMermaidASCII(source: string, options: AsciiSourceRenderOptions = {}): string {
  if (typeof source !== 'string') throw new TypeError('The ASCII entry requires Mermaid source text')
  if ('onProjectionDiagnostic' in options) throw new TypeError('Projection diagnostics require the complete package entry')
  return executeTerminalRender({ source, resolutionOptions: {} }, options).rendered.text
}

export { AsciiWidthError, DEFAULT_ASCII_THEME, detectColorMode, diagramColorsToAsciiTheme } from './ascii/render.ts'
export type { AsciiTheme, ColorMode, AsciiWidthErrorReason } from './ascii/render.ts'
