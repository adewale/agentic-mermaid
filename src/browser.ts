// ============================================================================
// Browser entry point for Agentic Mermaid
//
// Exposes renderMermaid and renderMermaidAscii on window.__mermaid so they
// can be called from inline <script> tags in samples.html.
//
// Bundled via `Bun.build({ target: 'browser' })` in scripts/site/editor.ts and website/build.ts.
// ============================================================================

import { renderMermaidSVGAsync, verifyNoExternalRefs } from './index.ts'
import { verifyMermaid } from './agent/verify.ts'
import { renderMermaidASCII, diagramColorsToAsciiTheme } from './ascii/index.ts'
import { THEMES } from './theme.ts'
import { knownStyles, getStyle } from './scene/style-registry.ts'
import { getSeriesColor, CHART_ACCENT_FALLBACK } from './xychart/colors.ts'

declare const window: unknown

;(window as Record<string, unknown>).__mermaid = {
  renderMermaidSVGAsync,
  verifyNoExternalRefs,
  verifyMermaid,
  renderMermaidASCII,
  diagramColorsToAsciiTheme,
  THEMES,
  knownStyles,
  getStyle,
  getSeriesColor,
  CHART_ACCENT_FALLBACK,
}
