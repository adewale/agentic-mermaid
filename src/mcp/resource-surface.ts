// MCP resources served by the hosted server: the MCP Apps views that
// UI-capable hosts render for UI-linked tools (extension
// io.modelcontextprotocol/ui, specification 2026-01-26). The roster is a set of
// version-static constants, so the hosted Worker serves it without a filesystem
// and every read is cacheable. Hosts without MCP Apps support ignore it: the
// linked tools return their full result either way.

import { PREVIEW_VIEW_HTML, PREVIEW_VIEW_URI } from './apps/preview-view.ts'

export const MCP_APP_MIME_TYPE = 'text/html;profile=mcp-app'

export interface McpResourceDefinition {
  readonly uri: string
  readonly name: string
  readonly title: string
  readonly description: string
  readonly mimeType: string
}

/** Content security metadata for a UI resource. The spec places `_meta.ui` on
 * the read contents item, not on the listed resource. */
export interface McpAppResourceMeta {
  readonly ui: {
    readonly csp: {
      readonly connectDomains: readonly string[]
      readonly resourceDomains: readonly string[]
      readonly frameDomains: readonly string[]
      readonly baseUriDomains: readonly string[]
    }
    readonly prefersBorder: boolean
  }
}

export interface McpResourceContents {
  readonly contents: readonly [{
    readonly uri: string
    readonly mimeType: string
    readonly text: string
    readonly _meta?: McpAppResourceMeta
  }]
}

export const PREVIEW_VIEW_RESOURCE: McpResourceDefinition = Object.freeze({
  uri: PREVIEW_VIEW_URI,
  name: 'preview-view',
  title: 'Diagram preview',
  description: 'Read-only MCP Apps view for the preview tool: the rendered diagram, its family and summary, and its verification warnings.',
  mimeType: MCP_APP_MIME_TYPE,
})

/** The view is fully self-contained, so its exact CSP is "no external origin
 * of any kind". Declaring the empty lists explicitly, rather than omitting the
 * field, records that this is the reviewed policy and not an omission. */
const PREVIEW_VIEW_META: McpAppResourceMeta = Object.freeze({
  ui: Object.freeze({
    csp: Object.freeze({
      connectDomains: Object.freeze([]),
      resourceDomains: Object.freeze([]),
      frameDomains: Object.freeze([]),
      baseUriDomains: Object.freeze([]),
    }),
    prefersBorder: true,
  }),
})

export const MCP_APP_RESOURCES: readonly McpResourceDefinition[] = Object.freeze([PREVIEW_VIEW_RESOURCE])

/** Resolve one resource read; null means the URI is not on the roster. */
export function readMcpAppResource(uri: string): McpResourceContents | null {
  if (uri !== PREVIEW_VIEW_URI) return null
  return {
    contents: [{
      uri: PREVIEW_VIEW_URI,
      mimeType: MCP_APP_MIME_TYPE,
      text: PREVIEW_VIEW_HTML,
      _meta: PREVIEW_VIEW_META,
    }],
  }
}
