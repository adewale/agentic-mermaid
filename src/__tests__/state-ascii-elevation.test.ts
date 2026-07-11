import { describe, expect, test } from 'bun:test'
import { renderMermaidASCII } from '../ascii/index.ts'
import { visualWidth } from '../ascii/width.ts'

interface Rect { left: number; right: number; top: number; bottom: number }

function locate(output: string, token: string): { row: number; col: number } {
  const rows = output.split('\n')
  const row = rows.findIndex(line => line.includes(token))
  return { row, col: row < 0 ? -1 : rows[row]!.indexOf(token) }
}

function rowBorders(output: string, token: string): { row: number; left: number; right: number } {
  const rows = output.split('\n')
  const { row, col } = locate(output, token)
  expect(row, `${token}: row`).toBeGreaterThanOrEqual(0)
  const left = rows[row]!.lastIndexOf('|', col)
  const right = rows[row]!.indexOf('|', col + token.length)
  expect(left, `${token}: left border`).toBeGreaterThanOrEqual(0)
  expect(right, `${token}: right border`).toBeGreaterThan(left)
  return { row, left, right }
}

function expectAsciiBox(output: string, token: string, rounded = false): Rect {
  const rows = output.split('\n')
  const { row, left, right } = rowBorders(output, token)
  const topChars = rounded ? new Set(['.', '+']) : new Set(['+'])
  const bottomChars = rounded ? new Set(["'", '+']) : new Set(['+'])
  let top = row
  while (top >= 0 && !(topChars.has(rows[top]![left]!) && topChars.has(rows[top]![right]!))) top--
  let bottom = row
  while (bottom < rows.length && !(bottomChars.has(rows[bottom]![left]!) && bottomChars.has(rows[bottom]![right]!))) bottom++
  expect(top, `${token}: top border`).toBeGreaterThanOrEqual(0)
  expect(bottom, `${token}: bottom border`).toBeLessThan(rows.length)
  expect(rows[top]!.slice(left + 1, right)).toMatch(/^-+$/)
  expect(rows[bottom]!.slice(left + 1, right)).toMatch(/^-+$/)
  for (let y = top + 1; y < bottom; y++) {
    expect(rows[y]![left], `${token}: left border row ${y}`).toBe('|')
    expect(rows[y]![right], `${token}: right border row ${y}`).toBe('|')
  }
  return { left, right, top, bottom }
}

describe('State terminal notes and concurrency regions (B05/S4)', () => {
  test('places an intact right-note box beside its target with a continuous connector', () => {
    const output = renderMermaidASCII(`stateDiagram-v2
      [*] --> Active
      note right of Active : retries are bounded
      Active --> [*]`, { useAscii: true, colorMode: 'none' })
    const state = rowBorders(output, 'Active')
    const note = expectAsciiBox(output, 'retries are bounded')
    expect(note.left).toBeGreaterThan(state.right)
    expect(Math.abs(note.top + Math.floor((note.bottom - note.top) / 2) - state.row)).toBeLessThanOrEqual(2)
    const connectorRow = output.split('\n')[state.row]!.slice(state.right + 1, note.left)
    expect(connectorRow).toMatch(/^\.+$/)
  })

  test('wraps note geometry within a hard display-cell target', () => {
    const output = renderMermaidASCII(`stateDiagram-v2
      [*] --> Active
      note right of Active : retries are bounded and failures stay visible
      Active --> [*]`, { colorMode: 'none', targetWidth: 40 })
    expect(Math.max(...output.split('\n').map(visualWidth))).toBeLessThanOrEqual(40)
    expect(output).toContain('failures stay')
  })

  test('places an intact left block-note box outside a composite frame with a continuous connector', () => {
    const output = renderMermaidASCII(`stateDiagram-v2
      state Processing {
        Idle --> Busy
      }
      note left of Processing
        Composite note
        stays visible
      end note`, { useAscii: true, colorMode: 'none' })
    const rows = output.split('\n')
    const composite = rowBorders(output, 'Processing')
    const note = expectAsciiBox(output, 'Composite note')
    expect(note.right).toBeLessThan(composite.left)
    expect(output).toContain('stays visible')
    const connectorRow = rows.find(row => row.slice(note.right + 1, composite.left).includes('.'))
    expect(connectorRow).toBeDefined()
    expect(connectorRow!.slice(note.right + 1, composite.left)).toMatch(/^\.+$/)
  })

  test('places one continuous concurrency separator strictly between intact region node boxes', () => {
    const output = renderMermaidASCII(`stateDiagram-v2
      state Parallel {
        [*] --> LeftWork
        --
        RightWork --> [*]
      }`, { useAscii: true, colorMode: 'none' })
    const rows = output.split('\n')
    const left = expectAsciiBox(output, 'LeftWork', true)
    const right = expectAsciiBox(output, 'RightWork', true)
    const counts = Array.from({ length: Math.max(...rows.map(row => row.length)) }, (_, col) =>
      rows.reduce((count, row) => count + (row[col] === ':' ? 1 : 0), 0),
    )
    const separator = counts.indexOf(Math.max(...counts))
    expect(separator).toBeGreaterThan(left.right)
    expect(separator).toBeLessThan(right.left)
    for (let row = Math.min(left.top, right.top); row <= Math.max(left.bottom, right.bottom); row++) {
      expect(rows[row]![separator], `separator row ${row}`).toBe(':')
    }
  })
})
