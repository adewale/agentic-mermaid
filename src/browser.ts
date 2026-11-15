// ============================================================================
// Browser entry point for Agentic Mermaid
//
// Exposes receipt-bearing graphical and terminal adapters on window.__mermaid
// for the browser-local editor and other browser consumers.
//
// Bundled via `Bun.build({ target: 'browser' })` in scripts/site/editor.ts and website/build.ts.
// ============================================================================

import './scene/builtin-backends.ts'
import { renderMermaidSVGWithReceipt } from './svg.ts'
import {
  SHARED_RENDER_OPTION_FIELDS,
  sharedRenderOptionsJsonSchema,
  validateSerializableRenderOptions,
} from './render-contract.ts'
import { verifyNoExternalRefs } from './output-security.ts'
import { verifyMermaid } from './agent/verify.ts'
import { WARNING_SEVERITY, WARNING_TIER } from './agent/types.ts'
import {
  renderMermaidASCII,
  renderMermaidASCIIWithReceipt,
  diagramColorsToAsciiTheme,
  type AsciiRenderOptions,
} from './ascii/index.ts'
import { STYLE_COLOR_TOKEN_DESCRIPTORS, knownStyles, knownStyleDescriptors, getStyle } from './scene/style-registry.ts'
import { getSeriesColor, CHART_ACCENT_FALLBACK } from './xychart/colors.ts'
import { renderMermaidPNGInBrowserWithReceipt } from './browser-png.ts'
import { resolveEditorRenderOptions } from './editor-render-options.ts'

declare const window: unknown

/** Explicit Unicode projection for browser consumers. The historical
 * renderMermaidASCIIWithReceipt entrypoint remains the shared ASCII/Unicode
 * adapter; this name removes the need for browser callers to know its default. */
function renderMermaidUnicodeWithReceipt(text: string, options: AsciiRenderOptions = {}) {
  return renderMermaidASCIIWithReceipt(text, { ...options, useAscii: false })
}

async function renderMermaidSVGAsync(text: string, options = {}) {
  return renderMermaidSVGWithReceipt(text, options).svg
}

/** Typed browser/editor boundary. The global bundle installs this exact object;
 * tests can exercise the adapter without inferring parity from bundle shape. */
export const BROWSER_EDITOR_ADAPTER = {
  renderMermaidSVGAsync,
  renderMermaidSVGWithReceipt,
  SHARED_RENDER_OPTION_FIELDS,
  STYLE_COLOR_TOKEN_FIELDS: Object.freeze(Object.keys(STYLE_COLOR_TOKEN_DESCRIPTORS)),
  SHARED_RENDER_OPTIONS_JSON_SCHEMA: sharedRenderOptionsJsonSchema(),
  validateSerializableRenderOptions,
  verifyNoExternalRefs,
  verifyMermaid,
  WARNING_TIER: Object.freeze({ ...WARNING_TIER }),
  WARNING_SEVERITY: Object.freeze({ ...WARNING_SEVERITY }),
  renderMermaidASCII,
  renderMermaidASCIIWithReceipt,
  renderMermaidUnicodeWithReceipt,
  renderMermaidPNGInBrowserWithReceipt,
  diagramColorsToAsciiTheme,
  knownStyles,
  knownStyleDescriptors,
  getStyle,
  getSeriesColor,
  CHART_ACCENT_FALLBACK,
  resolveEditorRenderOptions,
}

if (typeof window !== 'undefined') {
  ;(window as Record<string, unknown>).__mermaid = BROWSER_EDITOR_ADAPTER
}
