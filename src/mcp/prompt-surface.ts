// The MCP prompt surface: one prompt, shared verbatim by the local and hosted
// servers. `edit_mermaid_diagram` delivers the safe-path doctrine — the same
// embedded skill the resource surface serves — parameterized with the
// caller's source, so an MCP-only client starts on the
// parse → narrow → mutate → verify → serialize loop instead of free-styling.

import { SKILL_MARKDOWN } from './generated/skill-markdown.ts'

export interface McpPromptDefinition {
  readonly name: string
  readonly title: string
  readonly description: string
  readonly arguments: readonly {
    readonly name: string
    readonly description: string
    readonly required: boolean
  }[]
}

export interface McpPromptResult {
  readonly description: string
  readonly messages: readonly [{
    readonly role: 'user'
    readonly content: { readonly type: 'text'; readonly text: string }
  }]
}

export type McpPromptOutcome =
  | { readonly ok: true; readonly result: McpPromptResult }
  | { readonly ok: false; readonly problem: string }

/** Matches the hosted body caps: a source that cannot reach a tool cannot
 * reach a prompt either. */
export const MAX_PROMPT_SOURCE_LENGTH = 65_536

export const EDIT_PROMPT_NAME = 'edit_mermaid_diagram'

export const MCP_PROMPTS: readonly McpPromptDefinition[] = Object.freeze([
  Object.freeze({
    name: EDIT_PROMPT_NAME,
    title: 'Edit a Mermaid diagram safely',
    description: 'The typed-edit doctrine (parse → narrow → mutate → verify → serialize, with the anti-patterns to avoid) applied to the supplied Mermaid source.',
    arguments: Object.freeze([
      Object.freeze({
        name: 'source',
        description: 'The existing Mermaid source to edit.',
        required: true,
      }),
    ]),
  }),
])

export function getMcpPrompt(name: string, args: Record<string, unknown> | undefined): McpPromptOutcome {
  if (name !== EDIT_PROMPT_NAME) {
    return { ok: false, problem: `Unknown prompt: ${name}` }
  }
  const source = args?.source
  if (typeof source !== 'string' || source.trim() === '') {
    return { ok: false, problem: 'prompts/get edit_mermaid_diagram requires a non-empty string argument source' }
  }
  if (source.length > MAX_PROMPT_SOURCE_LENGTH) {
    return { ok: false, problem: `prompts/get source exceeds ${MAX_PROMPT_SOURCE_LENGTH} characters` }
  }
  const text = `${SKILL_MARKDOWN}\n---\n\nFollow the workflow above to edit the Mermaid diagram below. Parse it, narrow to its family, apply typed mutation ops for the requested change, verify, and only serialize a result whose verify passed. Do not regenerate the whole source by hand and do not edit it with string operations when a typed op exists.\n\n\`\`\`mermaid\n${source}\n\`\`\`\n`
  return {
    ok: true,
    result: {
      description: 'Typed-edit workflow for the supplied Mermaid diagram.',
      messages: [{ role: 'user', content: { type: 'text', text } }],
    },
  }
}
