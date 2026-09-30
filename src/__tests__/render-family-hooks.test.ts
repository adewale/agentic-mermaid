import { describe, expect, test } from 'bun:test'
import { renderMermaidASCII, renderMermaidSVG } from '../index.ts'
import { BUILTIN_FAMILY_METADATA, getFamily } from '../agent/families.ts'

describe('render FamilyDescriptor hooks', () => {
  test('all built-ins use one Scene graphical waist and reserve renderSvg for extension fallback', () => {
    for (const { id } of BUILTIN_FAMILY_METADATA) {
      const family = getFamily(id)
      expect(family?.layout, id).toBeDefined()
      expect(family?.lowerScene, id).toBeDefined()
      expect(family?.renderSvg, id).toBeUndefined()
      expect(family?.renderAscii, id).toBeDefined()
    }
  })

  // Dispatch smoke over the registry itself (a hand-written list had drifted to
  // 12 of the 16 families): each family's canonical example reaches both
  // public entry points. Rendering fidelity is owned by the per-family suites.
  for (const { id, example } of BUILTIN_FAMILY_METADATA) {
    test(`${id} renders through public SVG and ASCII dispatch`, () => {
      const svg = renderMermaidSVG(example, { embedFontImport: false })
      expect(svg).toContain('<svg')
      expect(svg).toContain('</svg>')

      const ascii = renderMermaidASCII(example, { colorMode: 'none' })
      expect(ascii.trim().length).toBeGreaterThan(0)
    })
  }
})
