import { expect, test } from 'bun:test'
import { parseRegisteredMermaid, serializeMermaid } from '../agent/index.ts'
import { renderMermaidASCIIWithReceipt } from '../ascii/index.ts'
import { renderMermaidASCIIWithMeta } from '../ascii/meta.ts'
import { parsePieChart } from '../pie/parser.ts'

const diagnostic = 'TERMINAL_CONTROL_CHARACTERS_REPLACED'

test('Pie terminal output replaces controls produced by authored escapes after source admission', () => {
  for (const [escape, visible] of [['r', 'A?B'], ['t', 'A B']] as const) {
    const source = `pie\n  "A\\${escape}B" : 1\n`
    expect(parsePieChart(source.trim().split('\n')).entries[0]!.label)
      .toBe(`A${escape === 'r' ? '\r' : '\t'}B`)
    const agent = parseRegisteredMermaid(source)
    expect(agent.ok).toBe(true)
    if (agent.ok) expect(serializeMermaid(agent.value)).toBe(source)

    for (const colorMode of ['none', 'ansi16', 'html'] as const) {
      const result = renderMermaidASCIIWithReceipt(source, { colorMode })
      expect(result.text).toStartWith(`${visible}  `)
      const withoutAnsi = result.text.replace(/\u001b\[[0-9;]*m/g, '')
      expect(withoutAnsi).not.toMatch(/[\u0000-\u000d\u000e-\u001f\u007f-\u009f]/)
      expect(result.terminalStyle.diagnostics.map(item => item.code)).toContain(diagnostic)
      const meta = renderMermaidASCIIWithMeta(source, { colorMode })
      expect(meta.ascii).toBe(result.text)
      expect(meta.warnings.map(item => item.code)).toContain(diagnostic)
      expect(meta.regions.map(region => [region.id, region.projectedText, region.canvasRow, region.canvasColStart, region.canvasColEnd]))
        .toEqual([['slice-0', visible, 0, 0, 3]])
    }
    const bounded = renderMermaidASCIIWithReceipt(source, { colorMode: 'none', targetWidth: 45 })
    expect(bounded.text).toStartWith(`${visible}  `)
  }
})

test('Pie authored newlines and entity-generated backslashes remain distinct from controls', () => {
  for (const [source, visible] of [
    ['pie\n  "A\\nB" : 1\n', 'A\nB'],
    ['pie\n  "A#92;rB" : 1\n', 'A\\rB'],
  ] as const) {
    const result = renderMermaidASCIIWithReceipt(source, { colorMode: 'none' })
    expect(result.text).toStartWith(visible)
    expect(result.terminalStyle.diagnostics.map(item => item.code)).not.toContain(diagnostic)
  }
})

test('all-zero Pie output does not claim a control replacement that never rendered', () => {
  const source = 'pie\n  "A\\rB" : 0\n'
  const result = renderMermaidASCIIWithReceipt(source, { colorMode: 'none' })
  expect(result.text).toBe('')
  expect(result.terminalStyle.diagnostics.map(item => item.code)).not.toContain(diagnostic)
  const meta = renderMermaidASCIIWithMeta(source, { colorMode: 'none' })
  expect(meta.regions).toEqual([])
  expect(meta.warnings.map(item => item.code)).not.toContain(diagnostic)
})

test('metadata keeps the Pie title and safe slice hit region when the agent body is opaque', () => {
  const source = 'pie\n  title Safe chart\n  "A\\rB" : 1\n'
  for (const colorMode of ['none', 'ansi16', 'html'] as const) {
    const meta = renderMermaidASCIIWithMeta(source, { colorMode })
    expect(meta.regions.map(region => [region.id, region.projectedText, region.canvasRow, region.canvasColStart, region.canvasColEnd]))
      .toEqual([
        ['title', 'Safe chart', 0, 0, 10],
        ['slice-0', 'A?B', 1, 0, 3],
      ])
  }
})
