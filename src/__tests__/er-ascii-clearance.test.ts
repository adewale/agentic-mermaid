import { describe, expect, test } from 'bun:test'
import fc from 'fast-check'
import { renderMermaidASCII } from '../ascii/index.ts'

function sourceWithShortcut(count: number, middleAttribute: string): string {
  const ids = Array.from({ length: count }, (_, index) => `E${index}`)
  const entities = ids.map((id, index) => `${id} {\n  string ${index === 1 ? middleAttribute : `field_${index}`}\n}`).join('\n')
  const chain = ids.slice(0, -1).map((id, index) => `${id} ||--|| ${ids[index + 1]} : link_${index}`).join('\n')
  return `erDiagram\n${entities}\n${chain}\nE0 ||--|| E2 : shortcut`
}

describe('ER terminal relationship clearance (B05/ER2)', () => {
  test('routes a non-adjacent same-row relationship around the middle entity', () => {
    const output = renderMermaidASCII(sourceWithShortcut(9, 'middle_value'), { useAscii: true, colorMode: 'none' })
    expect(output).toContain('string middle_value')
    expect(output).toContain('shortcut')
  })

  test('preserves every foreign entity payload across deterministic grid sizes', () => {
    fc.assert(fc.property(
      fc.integer({ min: 9, max: 16 }),
      fc.stringMatching(/^[a-z]{3,12}$/),
      (count, suffix) => {
        const attribute = `protected_${suffix}`
        const output = renderMermaidASCII(sourceWithShortcut(count, attribute), { colorMode: 'none' })
        expect(output).toContain(`string ${attribute}`)
      },
    ), { numRuns: 30 })
  })
})
