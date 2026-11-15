// Synchronous SVG-only entry, with the same generated SVG descriptors used by
// lazy rendering. No agent/terminal registry or optional sketch backend loads.
import './browser-lazy/generated/synchronous.ts'

export { renderMermaidSVG, renderMermaidSVGWithReceipt } from './svg-api.ts'
export type { RenderedSvg, RenderOptions, RenderRequestReceipt } from './svg-api.ts'
export { PaintLayoutCertificationError } from './scene/paint-certification.ts'
export { verifyNoExternalRefs } from './output-security.ts'
