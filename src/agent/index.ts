// ============================================================================
// agentic-mermaid — public agent surface (v4)
// Re-exports the runtime-neutral core plus the Node-native PNG renderer.
// Workerd/browser bundles must import `./core.ts` instead: `renderMermaidPNG`
// loads the napi resvg addon, which only exists on Node/Bun.
// ============================================================================

export * from './core.ts'
export { renderMermaidPNG, renderMermaidPNGWithReceipt } from './png.ts'
export type { PngOptions, RenderedPng } from './png.ts'
