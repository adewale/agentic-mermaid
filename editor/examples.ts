import { BUILTIN_FAMILY_METADATA } from '../src/agent/families.ts'

/**
 * The editor's supported-family picker is a projection of the runtime family
 * registry. Adding a built-in family no longer requires a second hand-written
 * example roster: the descriptor's canonical source is the example.
 */
export const EDITOR_EXAMPLES = BUILTIN_FAMILY_METADATA.map(family => ({
  id: family.editorExampleId,
  label: family.editorLabel,
  category: 'Supported diagrams',
  diagramType: family.editorDiagramType,
  description: family.editorDescription,
  source: family.editorExample,
  options: family.id === 'xychart' ? { interactive: true } : undefined,
}))
