import { describe, expect, test } from 'bun:test'
import { asFlowchart, parseRegisteredMermaid } from '../agent/index.ts'
import { renderMermaidASCII } from '../index.ts'
import { parseMermaid } from '../parser.ts'

function count(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1
}

describe('CJK flowchart subgraph identifiers', () => {
  test('remain valid references in explicit and implicit forms', () => {
    const explicit = `flowchart TD
  Outside --> 日本語
  subgraph 日本語 [処理]
    内部
  end`
    const implicit = `flowchart TD
  Outside --> 日本語
  subgraph 日本語
    内部
  end`

    expect(parseMermaid(explicit).subgraphs[0]).toMatchObject({ id: '日本語', label: '処理' })
    expect(parseMermaid(implicit).subgraphs[0]).toMatchObject({ id: '日本語', label: '日本語' })
    const agentParsed = parseRegisteredMermaid(explicit)
    expect(agentParsed.ok).toBe(true)
    if (!agentParsed.ok) throw new Error('expected CJK subgraph to parse through the agent surface')
    expect(asFlowchart(agentParsed.value)?.body.graph.subgraphs[0]).toMatchObject({ id: '日本語', label: '処理' })
    const out = renderMermaidASCII(explicit)
    expect(count(out, '処理')).toBe(1)
    expect(count(out, '日本語')).toBe(0)
    expect(count(out, '内部')).toBe(1)
  })

  test('rejects unsupported combining marks instead of silently changing explicit ids', () => {
    for (const id of ['ば', '葛󠄀']) {
      expect(() => parseMermaid(`flowchart TD
  subgraph ${id} [処理]
    内部
  end`)).toThrow(`Invalid flowchart subgraph identifier ${JSON.stringify(id)}`)
    }
  })

  test('scans a near-limit unterminated bracket declaration without quadratic backtracking', () => {
    const source = `flowchart TD\nsubgraph ${'['.repeat(60_000)}x\nA\nend`
    const started = performance.now()
    const parsed = parseRegisteredMermaid(source)
    const elapsed = performance.now() - started

    expect(parsed.ok).toBe(true)
    expect(elapsed).toBeLessThan(1_000)
  })
})
