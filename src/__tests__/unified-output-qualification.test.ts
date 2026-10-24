import { describe, expect, test } from 'bun:test'
import { qualifyOutput } from '../../eval/benchmark/unified/qualification.ts'
import type { UnifiedWorkload } from '../../eval/benchmark/unified/types.ts'

const workload = (labels: string[]): UnifiedWorkload => ({ id: 'authored-output-admission', family: 'flowchart', source: 'flowchart LR', features: [], provenance: 'independently authored qualification examples', expectedLabels: labels })
describe('benchmark output admission at reader-facing text', () => {
  test('admits literal authored labels inside decorated visible text runs', () => {
    const svg = '<svg><text>Free (60.0%)</text><text>alt [isWell]</text><text>Uses [HTTPS]</text><text>C1</text></svg>'
    expect(qualifyOutput(workload(['Free', 'isWell', 'HTTPS', 'C1']), svg, 'svg').ok).toBe(true)
  })
  test('does not infer an authored identity from a longer identifier', () => {
    expect(qualifyOutput(workload(['C1']), '<svg><text>C10</text></svg>', 'svg').ok).toBe(false)
    expect(qualifyOutput(workload(['Node 1']), 'Node 12', 'terminal').ok).toBe(false)
  })
  test('metadata, source echoes and attributes do not substitute for visible labels', () => {
    const svg = '<svg data-label="Cache"><metadata><text>Cache</text></metadata><!-- <text>Cache</text> --><defs><text>Cache</text></defs><text>Database</text></svg>'
    expect(qualifyOutput(workload(['Cache']), svg, 'svg').ok).toBe(false)
  })
  test('keeps interleaved values and separate text runs outside generic matching', () => {
    expect(qualifyOutput(workload(['ash (60.0%)']), '<svg><text>ash [60] (60.0%)</text></svg>', 'svg').ok).toBe(false)
    expect(qualifyOutput(workload(['First Second']), '<svg><text>First</text><text>Second</text></svg>', 'svg').ok).toBe(false)
    expect(qualifyOutput(workload(['First Second']), '│ First │\n│ Second │', 'terminal').ok).toBe(false)
  })
  test('reads escaped literal angle brackets and positioned line breaks', () => {
    const svg = '<svg><text>&lt;Customer&gt;</text><text><tspan x="0" y="10">First</tspan><tspan x="0" y="20">Second</tspan></text></svg>'
    expect(qualifyOutput(workload(['<Customer>', 'First Second']), svg, 'svg').ok).toBe(true)
  })
  test('accepts a declared empty SVG envelope but never supplies a missing label', () => {
    expect(qualifyOutput(workload([]), '<svg width="1" height="1"/>', 'svg').ok).toBe(true)
    expect(qualifyOutput(workload(['A']), '<svg width="1" height="1"/>', 'svg').ok).toBe(false)
  })
})
