// Source-only SVG boundary. Parsed-diagram editing, terminal output and PNG
// adapters belong to their own entries, while execution remains canonical.
import { executeGraphicalRequest } from './graphical-render.ts'
import type { RenderRequestReceipt } from './render-contract.ts'
import type { RenderOptions } from './types.ts'

export interface RenderedSvg {
  readonly svg: string
  readonly receipt: RenderRequestReceipt
}

export function renderMermaidSVGWithReceipt(source: string, options: RenderOptions = {}): RenderedSvg {
  if (typeof source !== 'string') throw new TypeError('The SVG entry requires Mermaid source text')
  return executeGraphicalRequest(source, options, 'svg')
}

export function renderMermaidSVG(source: string, options: RenderOptions = {}): string {
  return renderMermaidSVGWithReceipt(source, options).svg
}

export type { RenderOptions, RenderRequestReceipt }
