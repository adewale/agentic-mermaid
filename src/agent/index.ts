// ============================================================================
// agentic-mermaid — public agent surface (v4)
// Re-exports the runtime-neutral core plus the Node-native PNG renderer.
// Workerd/browser bundles import the published `agentic-mermaid/agent/core`
// entry instead: `renderMermaidPNG` loads the napi resvg addon, which only
// exists on Node/Bun.
// ============================================================================

export * from './core.ts'
export { createMermaidPNGRenderer, renderMermaidPNG, renderMermaidPNGWithReceipt } from './png.ts'
export type {
  MermaidPNGRenderer, MermaidPNGRendererHostOptions, PngOptions, RenderedPng,
} from './png.ts'
