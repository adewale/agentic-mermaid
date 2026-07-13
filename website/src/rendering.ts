import {
  renderMermaidASCIIWithReceipt,
  renderMermaidSVGWithReceipt,
  type AsciiRenderOptions,
  type RenderedAscii,
  type RenderedSvg,
} from '../../src/index.ts'
import type { RenderOptions } from '../../src/types.ts'

/**
 * Website-owned render adapters. Keep the receipt-bearing artifact intact at
 * this boundary; callers that only need markup or text project the payload
 * after the shared request has been resolved and identified.
 */
export function renderWebsiteSVGWithReceipt(
  source: string,
  options: RenderOptions = {},
): RenderedSvg {
  return renderMermaidSVGWithReceipt(source, options)
}

export function renderWebsiteASCIIWithReceipt(
  source: string,
  options: AsciiRenderOptions = {},
): RenderedAscii {
  return renderMermaidASCIIWithReceipt(source, options)
}

/** String projections retained for the static-site builder's existing call
 * sites. Their implementation deliberately goes through the receipt API. */
export function renderWebsiteSVG(source: string, options: RenderOptions = {}): string {
  return renderWebsiteSVGWithReceipt(source, options).svg
}

export function renderWebsiteASCII(source: string, options: AsciiRenderOptions = {}): string {
  return renderWebsiteASCIIWithReceipt(source, options).text
}

export interface WebsiteRepresentationFixture {
  readonly svg: RenderedSvg
  readonly unicode: RenderedAscii
  readonly ascii: RenderedAscii
}

/**
 * Deterministic parity fixture used by the website build contract. It is
 * intentionally family-neutral: every supported family must cross the same
 * SVG/Unicode/ASCII request waist and retain one shared request/appearance.
 */
export function renderWebsiteRepresentationFixture(
  source: string,
  options: RenderOptions = {},
): WebsiteRepresentationFixture {
  const svg = renderWebsiteSVGWithReceipt(source, options)
  const unicode = renderWebsiteASCIIWithReceipt(source, {
    ...options,
    useAscii: false,
    colorMode: 'none',
  })
  const ascii = renderWebsiteASCIIWithReceipt(source, {
    ...options,
    useAscii: true,
    colorMode: 'none',
  })
  const receipts = [svg.receipt, unicode.receipt, ascii.receipt]
  const sharedRequestDigests = new Set(receipts.map(receipt => receipt.sharedRequestDigest))
  const appearanceDigests = new Set(receipts.map(receipt => receipt.appearanceDigest))
  if (sharedRequestDigests.size !== 1 || appearanceDigests.size !== 1) {
    throw new Error('Website SVG and terminal artifacts resolved different shared requests or appearances')
  }
  if (svg.receipt.output !== 'svg' || unicode.receipt.output !== 'unicode' || ascii.receipt.output !== 'ascii') {
    throw new Error('Website representation fixture received an unexpected output receipt')
  }
  return Object.freeze({ svg, unicode, ascii })
}
