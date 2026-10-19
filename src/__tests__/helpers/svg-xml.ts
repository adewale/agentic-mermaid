import { expect } from 'bun:test'
import { Resvg } from '@resvg/resvg-wasm'
export { renderedTextReady as svgXmlReady } from './rendered-text.ts'

/** An independent XML parser, with native resources released after each case. */
export function expectWellFormedXml(svg: string, source: string): void {
  let parseError: string | undefined
  try {
    const document = new Resvg(svg, { font: { loadSystemFonts: false } })
    document.free()
  } catch (error) {
    parseError = error instanceof Error ? error.message : String(error)
  }
  expect({ source, parseError }).toEqual({ source, parseError: undefined })
  expect(svg).not.toMatch(/="[^"]*\b(?:NaN|Infinity|undefined)\b[^"]*"/)
}
