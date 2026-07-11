import { describe, expect, test } from 'bun:test'
import { renderMermaidASCII } from '../ascii/index.ts'
import { visualWidth } from '../ascii/width.ts'

function locate(output: string, token: string): { row: number; col: number } {
  const rows = output.split('\n')
  const row = rows.findIndex(line => line.includes(token))
  return { row, col: row < 0 ? -1 : rows[row]!.indexOf(token) }
}

describe('State terminal notes and concurrency regions (B05/S4)', () => {
  test('places a right note beside its target instead of dropping it', () => {
    const output = renderMermaidASCII(`stateDiagram-v2
      [*] --> Active
      note right of Active : retries are bounded
      Active --> [*]`, { useAscii: true, colorMode: 'none' })
    const state = locate(output, 'Active')
    const note = locate(output, 'retries are bounded')
    expect(state.row).toBeGreaterThanOrEqual(0)
    expect(note.row).toBeGreaterThanOrEqual(0)
    expect(note.col).toBeGreaterThan(state.col)
    expect(Math.abs(note.row - state.row)).toBeLessThanOrEqual(2)
  })

  test('wraps note geometry within a hard display-cell target', () => {
    const output = renderMermaidASCII(`stateDiagram-v2
      [*] --> Active
      note right of Active : retries are bounded and failures stay visible
      Active --> [*]`, { colorMode: 'none', targetWidth: 40 })
    expect(Math.max(...output.split('\n').map(visualWidth))).toBeLessThanOrEqual(40)
    expect(output).toContain('failures stay')
  })

  test('places a left block note outside a composite frame', () => {
    const output = renderMermaidASCII(`stateDiagram-v2
      state Processing {
        Idle --> Busy
      }
      note left of Processing
        Composite note
        stays visible
      end note`, { useAscii: true, colorMode: 'none' })
    const composite = locate(output, 'Processing')
    const note = locate(output, 'Composite note')
    expect(note.row).toBeGreaterThanOrEqual(0)
    expect(note.col).toBeLessThan(composite.col)
    expect(output).toContain('stays visible')
  })

  test('renders concurrency regions as a dashed separator rather than anonymous nested frames', () => {
    const output = renderMermaidASCII(`stateDiagram-v2
      state Parallel {
        [*] --> LeftWork
        --
        RightWork --> [*]
      }`, { colorMode: 'none' })
    expect(output).toContain('Parallel')
    expect(output).toContain('LeftWork')
    expect(output).toContain('RightWork')
    expect(output).toMatch(/[┄┆]/)
  })
})
