import { describe, expect, test } from 'bun:test'
import fc from 'fast-check'
import { renderMermaidASCII } from '../ascii/index.ts'

interface BoxRect { left: number; top: number; right: number; bottom: number }

function sourceWithShortcut(count: number, middleAttribute: string): string {
  const ids = Array.from({ length: count }, (_, index) => `E${index}`)
  const entities = ids.map((id, index) => `${id} {\n  string ${index === 1 ? middleAttribute : `field_${index}`}\n}`).join('\n')
  const chain = ids.slice(0, -1).map((id, index) => `${id} ||--|| ${ids[index + 1]} : link_${index}`).join('\n')
  return `erDiagram\n${entities}\n${chain}\nE0 ||--|| E2 : shortcut`
}

function expectPristineEntityBox(output: string, id: string, attribute: string): BoxRect {
  const expected = renderMermaidASCII(`erDiagram\n${id} {\n  string ${attribute}\n}`, { useAscii: true, colorMode: 'none' })
    .split('\n').map(row => row.trimEnd())
  while (expected.at(-1) === '') expected.pop()
  const expectedIdRow = expected.findIndex(row => row.includes(`| ${id} `))
  const expectedIdColumn = expected[expectedIdRow]!.indexOf(id)

  const actual = output.split('\n')
  const actualIdRow = actual.findIndex(row => row.includes(`| ${id} `))
  expect(actualIdRow, `${id}: header row`).toBeGreaterThanOrEqual(0)
  const actualIdColumn = actual[actualIdRow]!.indexOf(id)
  const top = actualIdRow - expectedIdRow
  const left = actualIdColumn - expectedIdColumn
  for (const [offset, expectedRow] of expected.entries()) {
    expect(actual[top + offset]!.slice(left, left + expectedRow.length), `${id}: box row ${offset}`).toBe(expectedRow)
  }
  return { left, top, right: left + expected[0]!.length - 1, bottom: top + expected.length - 1 }
}

describe('ER terminal relationship clearance (B05/ER5)', () => {
  test('routes a non-adjacent same-row relationship around the middle entity', () => {
    const output = renderMermaidASCII(sourceWithShortcut(9, 'middle_value'), { useAscii: true, colorMode: 'none' })
    const middle = expectPristineEntityBox(output, 'E1', 'middle_value')
    const shortcutRow = output.split('\n').findIndex(row => row.includes('shortcut'))
    expect(shortcutRow).toBeGreaterThan(middle.bottom)
  })

  test('preserves every foreign entity rectangle across deterministic grid sizes', () => {
    fc.assert(fc.property(
      fc.integer({ min: 9, max: 16 }),
      fc.stringMatching(/^[a-z]{3,12}$/),
      (count, suffix) => {
        const middleAttribute = `protected_${suffix}`
        const output = renderMermaidASCII(sourceWithShortcut(count, middleAttribute), { useAscii: true, colorMode: 'none' })
        for (let index = 1; index < count; index++) {
          if (index === 2) continue // E0 and E2 are the shortcut endpoints; every other box is foreign.
          expectPristineEntityBox(output, `E${index}`, index === 1 ? middleAttribute : `field_${index}`)
        }
      },
    ), { numRuns: 30 })
  })
})
