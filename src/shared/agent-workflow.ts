// The one statement of how an agent creates and edits a diagram. Every
// agent-facing surface takes it from here: code imports these constants (the
// llms.txt digest, the init-agent bundle, the Code Mode SDK declaration), and
// Markdown embeds them as generated blocks (scripts/docs/doc-blocks.ts). Two
// hand-written versions of this policy once disagreed for months.

export const NEW_DIAGRAM_WORKFLOW = 'New diagrams: author Mermaid source directly, then parse → verify → render or return it.'

export const EXISTING_DIAGRAM_WORKFLOW = 'Existing structured diagrams: parse → narrow → mutate → verify → serialize.'

export const PROGRAMMATIC_BUILD_NOTE = '`buildMermaid(kind, ops)` / `createMermaid(kind)` build a diagram from typed ops when you are generating one programmatically (for example, from data).'

/** Shared vocabulary for instructions, discovery and the library reference. */
export const DIAGRAM_TERMINOLOGY = 'A **family** is a Mermaid diagram type, such as Flowchart or Sequence. A **part** is an identified element of a Scene, such as a shape, connector, text or group. A **resolved primitive** is one painted path or text run; a part can contain many primitives. A **Scene primitive** is a unit of the pre-paint drawing contract, including document structure, shapes, text and markers. Source nodes, edges and other family-specific objects are distinct from drawing parts.'

export const FAMILY_NARROWING_NOTE = 'Narrowing selects a structured, typed family with an as* helper. It does not select one element or freeze layout coordinates.'

export const VERIFY_RESULT_MEANING = '`verify.ok` means no unsuppressed error was detected, including measured content occlusion and explicit error policies. It is not a visual-quality or semantic-correctness score.'

/** The new-diagram rule and when typed construction applies instead. */
export const NEW_DIAGRAM_POLICY = `${NEW_DIAGRAM_WORKFLOW} ${PROGRAMMATIC_BUILD_NOTE}`
