// ============================================================================
// Browser entry point for Agentic Mermaid
//
// Exposes receipt-bearing graphical and terminal adapters on window.__mermaid
// for the browser-local editor and other browser consumers.
//
// Bundled via `Bun.build({ target: 'browser' })` in scripts/site/editor.ts and website/build.ts.
// ============================================================================

import {
  renderMermaidSVGAsync,
  renderMermaidSVGWithReceipt,
  SHARED_RENDER_OPTION_FIELDS,
  sharedRenderOptionsJsonSchema,
  validateSerializableRenderOptions,
  verifyNoExternalRefs,
} from './index.ts'
import { verifyMermaid } from './agent/verify.ts'
import {
  renderMermaidASCII,
  renderMermaidASCIIWithReceipt,
  diagramColorsToAsciiTheme,
  type AsciiRenderOptions,
} from './ascii/index.ts'
import { THEMES } from './theme.ts'
import { knownStyles, getStyle } from './scene/style-registry.ts'
import { getSeriesColor, CHART_ACCENT_FALLBACK } from './xychart/colors.ts'
import { renderMermaidPNGInBrowserWithReceipt } from './browser-png.ts'

declare const window: unknown

/** Explicit Unicode projection for browser consumers. The historical
 * renderMermaidASCIIWithReceipt entrypoint remains the shared ASCII/Unicode
 * adapter; this name removes the need for browser callers to know its default. */
function renderMermaidUnicodeWithReceipt(text: string, options: AsciiRenderOptions = {}) {
  return renderMermaidASCIIWithReceipt(text, { ...options, useAscii: false })
}

;(window as Record<string, unknown>).__mermaid = {
  renderMermaidSVGAsync,
  renderMermaidSVGWithReceipt,
  SHARED_RENDER_OPTION_FIELDS,
  SHARED_RENDER_OPTIONS_JSON_SCHEMA: sharedRenderOptionsJsonSchema(),
  validateSerializableRenderOptions,
  verifyNoExternalRefs,
  verifyMermaid,
  renderMermaidASCII,
  renderMermaidASCIIWithReceipt,
  renderMermaidUnicodeWithReceipt,
  renderMermaidPNGInBrowserWithReceipt,
  diagramColorsToAsciiTheme,
  THEMES,
  knownStyles,
  getStyle,
  getSeriesColor,
  CHART_ACCENT_FALLBACK,
}
