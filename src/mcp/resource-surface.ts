// MCP resources served by BOTH the local and hosted servers. Every entry is a
// projection of an existing repo artifact — the skill file and the capability
// registry — embedded at generation time (scripts/generate-agent-doc-artifacts.ts)
// so the fs-less hosted Worker serves byte-identical content to the local
// server. There is deliberately no per-family ops resource: describe_sdk
// already serves that registry, and a second delivery path for the same data
// is what docs/mcp-code-mode-rationale.md argues against.

import { SKILL_MARKDOWN } from './generated/skill-markdown.ts'
import { CAPABILITIES_RESOURCE_JSON } from './generated/capabilities-resource.ts'

export interface McpResourceDefinition {
  readonly uri: string
  readonly name: string
  readonly title: string
  readonly description: string
  readonly mimeType: string
}

export interface McpResourceContents {
  readonly contents: readonly [{
    readonly uri: string
    readonly mimeType: string
    readonly text: string
  }]
}

export const SKILL_RESOURCE_URI = 'agentic-mermaid://skill/diagram-workflow'
export const CAPABILITIES_RESOURCE_URI = 'agentic-mermaid://capabilities'

/** The static resource roster: identical on every surface and both protocol
 * eras. The surface never changes at runtime, so capabilities advertise
 * listChanged: false and resources/subscribe stays unimplemented. */
export const MCP_RESOURCES: readonly McpResourceDefinition[] = Object.freeze([
  Object.freeze({
    uri: SKILL_RESOURCE_URI,
    name: 'diagram-workflow-skill',
    title: 'Agentic Mermaid diagram workflow',
    description: 'The agent-agnostic authoring/editing doctrine: channel selection, the parse → narrow → mutate → verify → serialize loop, and the anti-patterns to avoid. Load this before authoring or editing diagrams.',
    mimeType: 'text/markdown',
  }),
  Object.freeze({
    uri: CAPABILITIES_RESOURCE_URI,
    name: 'capabilities',
    title: 'Capability registry',
    description: 'The same projection as `am capabilities --json`: every registered family with its mutation ops, op field schemas, edit policy, warning codes, and output formats.',
    mimeType: 'application/json',
  }),
])

/** Resolve one resource read; null means the URI is not on the roster. */
export function readMcpResource(uri: string): McpResourceContents | null {
  switch (uri) {
    case SKILL_RESOURCE_URI:
      return { contents: [{ uri, mimeType: 'text/markdown', text: SKILL_MARKDOWN }] }
    case CAPABILITIES_RESOURCE_URI:
      return { contents: [{ uri, mimeType: 'application/json', text: CAPABILITIES_RESOURCE_JSON }] }
    default:
      return null
  }
}
