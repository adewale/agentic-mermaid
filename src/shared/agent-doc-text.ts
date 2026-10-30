// Repository-maintenance comments in agent-facing Markdown: generated-block
// delimiters (`<!-- BEGIN GENERATED: id -->` … `<!-- END GENERATED: id -->`,
// rewritten by scripts/docs/doc-blocks.ts) and the hand-audit annotation
// `<!-- complete: registry -->` (docs/contributing/doc-consistency.md). They stay in the
// repository sources that tooling reads; copies handed to agents (the published
// site, `am --agent-instructions`) carry only the prose between them.

const MARKER = String.raw`<!-- (?:(?:BEGIN|END) GENERATED|complete): [^>]*? -->`
const MARKER_LINE = new RegExp(String.raw`^[ \t]*${MARKER}[ \t]*\r?\n`, 'gm')
const INLINE_MARKER = new RegExp(MARKER, 'g')

/** The Markdown an agent reads: a maintenance comment on its own line goes
 * with its line, one inside a line goes alone, all other text is unchanged. */
export function agentFacingMarkdown(markdown: string): string {
  return markdown.replace(MARKER_LINE, '').replace(INLINE_MARKER, '')
}
