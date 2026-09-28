// The one statement of how an agent creates and edits a diagram. Every
// agent-facing surface takes it from here: code imports these constants (the
// llms.txt digest, the init-agent bundle, the Code Mode SDK declaration), and
// Markdown embeds them as generated blocks (scripts/docs/doc-blocks.ts). Two
// hand-written versions of this policy once disagreed for months.

export const NEW_DIAGRAM_WORKFLOW = 'New diagrams: author Mermaid source directly, then parse → verify → render or return it.'

export const EXISTING_DIAGRAM_WORKFLOW = 'Existing structured diagrams: parse → narrow → mutate → verify → serialize.'

export const PROGRAMMATIC_BUILD_NOTE = '`buildMermaid(kind, ops)` / `createMermaid(kind)` build a diagram from typed ops when you are generating one programmatically (for example, from data).'

/** The new-diagram rule and when typed construction applies instead. */
export const NEW_DIAGRAM_POLICY = `${NEW_DIAGRAM_WORKFLOW} ${PROGRAMMATIC_BUILD_NOTE}`
