import { describe, expect, test } from 'bun:test'
import { BUILTIN_FAMILY_METADATA, getFamily } from '../agent/families.ts'

// Deliberate architecture constraint: built-ins share Scene lowering so styles,
// security and certification have one graphical integration boundary. This is
// separate from the public rendering behavior in render-family-hooks.test.ts.
describe('render pipeline architecture', () => {
  test('built-ins use Scene lowering rather than the external SVG fallback', () => {
    for (const { id } of BUILTIN_FAMILY_METADATA) {
      const family = getFamily(id)
      expect(family?.layout, id).toBeDefined()
      expect(family?.lowerScene, id).toBeDefined()
      expect(family?.renderSvg, id).toBeUndefined()
    }
  })
})
