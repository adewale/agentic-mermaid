import { describe, expect, test } from 'bun:test'
import { renderMermaidASCII } from '../ascii/index.ts'
import { visualWidth } from '../ascii/width.ts'

const BASIC = 'sankey-beta\n  Coal,Electricity,127.93\n  Gas,Electricity,80\n  Electricity,Homes,120\n  Electricity,Industry,87.93'

describe('sankey ASCII renderer', () => {
  test('unicode charset renders a grouped flow list with branch glyphs and bars', () => {
    const out = renderMermaidASCII(BASIC)
    expect(out).toContain('Coal  127.93')
    expect(out).toContain('└─▶ Electricity')
    expect(out).toContain('├─▶ Homes')
    expect(out).toContain('█')
  })

  test('ascii charset uses pure-ASCII glyphs', () => {
    const out = renderMermaidASCII(BASIC, { useAscii: true })
    expect(out).toContain('`-> Electricity')
    expect(out).toContain('#')
    expect(out).not.toMatch(/[█├└─▶│]/)
  })

  test('sections follow first-appearance order and branches follow authored row order', () => {
    // First appearance = source then target per row: Coal, Electricity, Gas.
    const out = renderMermaidASCII(BASIC)
    const coal = out.indexOf('Coal')
    const electricity = out.indexOf('Electricity  207.93')
    const gas = out.indexOf('Gas')
    expect(coal).toBeGreaterThanOrEqual(0)
    expect(coal).toBeLessThan(electricity)
    expect(electricity).toBeLessThan(gas)
    // Within the Electricity section, Homes (authored first) precedes Industry.
    expect(out.indexOf('Homes')).toBeLessThan(out.indexOf('Industry'))
  })

  test('bar lengths are proportional to link values', () => {
    const out = renderMermaidASCII('sankey-beta\n  A,B,100\n  A,C,25')
    const bar = (line: string) => (line.match(/█+/)?.[0] ?? '').length
    const lines = out.split('\n')
    const b = bar(lines.find(l => l.includes('B'))!)
    const c = bar(lines.find(l => l.includes('C'))!)
    expect(b).toBe(20)
    expect(c).toBe(5)
  })

  test('showValues: false hides the numeric columns but keeps bars', () => {
    const out = renderMermaidASCII(`---\nconfig:\n  sankey:\n    showValues: false\n---\n${BASIC}`)
    expect(out).not.toContain('127.93')
    expect(out).toContain('█')
  })

  test('prefix/suffix format the value columns', () => {
    const out = renderMermaidASCII(`---\nconfig:\n  sankey:\n    prefix: "€"\n    suffix: "M"\n---\n${BASIC}`)
    expect(out).toContain('€127.93M')
  })

  test('frontmatter title leads the output', () => {
    const out = renderMermaidASCII(`---\ntitle: Energy\n---\n${BASIC}`)
    expect(out.split('\n')[0]).toBe('Energy')
  })

  test('long target labels wrap under a targetWidth budget with rail continuations', () => {
    const source = 'sankey-beta\n  A very descriptive sankey source label,A very descriptive sankey target label with several words,42\n  A very descriptive sankey source label,Second target,7'
    const out = renderMermaidASCII(source, { targetWidth: 60 })
    for (const line of out.split('\n')) {
      expect(visualWidth(line)).toBeLessThanOrEqual(60)
    }
    expect(out).toContain('│')
  })

  test('deterministic across repeated renders', () => {
    const first = renderMermaidASCII(BASIC)
    expect(renderMermaidASCII(BASIC)).toBe(first)
  })
})
