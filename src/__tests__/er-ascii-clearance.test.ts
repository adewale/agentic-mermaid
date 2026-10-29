import { describe, expect, test } from 'bun:test'
import fc from 'fast-check'
import { fcParameters } from './helpers/fc-parameters.ts'
import { renderMermaidASCII } from '../ascii/index.ts'

interface BoxRect { left: number; top: number; right: number; bottom: number }

function sourceWithShortcut(count: number, middleAttribute: string): string {
  const ids = Array.from({ length: count }, (_, index) => `E${index}`)
  const entities = ids.map((id, index) => `${id} {\n  string ${index === 1 ? middleAttribute : `field_${index}`}\n}`).join('\n')
  const chain = ids.slice(0, -1).map((id, index) => `${id} ||--|| ${ids[index + 1]} : link_${index}`).join('\n')
  return `erDiagram\n${entities}\n${chain}\nE0 ||--|| E2 : shortcut`
}

function expectPristineEntityBox(output: string, id: string, attribute: string): BoxRect {
  const rows = output.split('\n')
  const header = rows.findIndex(row => row.includes(`| ${id} `))
  expect(header, `${id}: header row`).toBeGreaterThanOrEqual(0)
  const label = rows[header]!.indexOf(id)
  const left = rows[header]!.lastIndexOf('|', label), right = rows[header]!.indexOf('|', label)
  expect(left, `${id}: left border`).toBeGreaterThanOrEqual(0)
  expect(right, `${id}: right border`).toBeGreaterThan(left)
  const horizontal = (row: string | undefined) => row?.[left] === '+' && row[right] === '+' && /^-+$/.test(row.slice(left + 1, right))
  let top = header - 1
  while (top >= 0 && !horizontal(rows[top])) top--
  const member = rows.findIndex((row, index) => index > header && row.slice(left + 1, right).trim() === `string ${attribute}`)
  expect(member, `${id}: complete attribute`).toBeGreaterThan(header)
  let bottom = member + 1
  while (bottom < rows.length && !horizontal(rows[bottom])) bottom++
  expect(top, `${id}: top border`).toBeGreaterThanOrEqual(0)
  expect(bottom, `${id}: bottom border`).toBeLessThan(rows.length)
  for (let y = top + 1; y < bottom; y++) {
    const row = rows[y]!
    if (horizontal(row)) continue
    expect(row[left], `${id}: left border row ${y}`).toBe('|')
    expect(row[right], `${id}: right border row ${y}`).toBe('|')
    // Port demand may enlarge a card. Its body still contains exactly the
    // declared header/attribute and padding, never foreign route ink.
    expect(['', id, `string ${attribute}`], `${id}: body row ${y}`).toContain(row.slice(left + 1, right).trim())
  }
  return { left, top, right, bottom }
}

describe('ER terminal relationship clearance (B05/ER5)', () => {
  test('routes a non-adjacent same-row relationship around the middle entity', () => {
    const output = renderMermaidASCII(sourceWithShortcut(9, 'middle_value'), { useAscii: true, colorMode: 'none' })
    const middle = expectPristineEntityBox(output, 'E1', 'middle_value')
    const shortcutRow = output.split('\n').findIndex(row => row.includes('shortcut'))
    const shortcutColumn = output.split('\n')[shortcutRow]!.indexOf('shortcut')
    expect(shortcutRow < middle.top || shortcutRow > middle.bottom || shortcutColumn + 'shortcut'.length <= middle.left || shortcutColumn > middle.right).toBe(true)
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
    ), fcParameters({ numRuns: 30 }))
  })
})
