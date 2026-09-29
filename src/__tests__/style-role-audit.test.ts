import { describe, expect, test } from 'bun:test'
import { EDITOR_EXAMPLES } from '../../editor/examples.ts'
import { BUILTIN_FAMILY_METADATA } from '../agent/families.ts'

const SUPPORTED_FAMILIES = BUILTIN_FAMILY_METADATA.map(family => family.editorDiagramType)

// Removed-role-key rejection is covered (validation and render) by
// style-options.test.ts, and one Style + Palette stack across every family by
// styled-output.test.ts "Style + Palette stacks stay deterministic…".
describe('Style + Palette contract', () => {
  test('shared editor examples cover every supported family', () => {
    expect(EDITOR_EXAMPLES.map(example => example.diagramType).sort()).toEqual([...SUPPORTED_FAMILIES].sort())
    expect(EDITOR_EXAMPLES.some(example => example.category === 'Role style presets')).toBe(false)
  })
})
