import { describe, expect, test } from 'bun:test'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { parseRegisteredMermaid as parseMermaid } from '../agent/parse.ts'
import { describeMermaidFacts, describeMermaidFactsSource, checkMermaid } from '../agent/facts.ts'
import { runCli } from '../cli/index.ts'
import { executeInSandbox } from '../mcp/sandbox.ts'

function facts(source: string): string[] {
  const parsed = parseMermaid(source)
  if (!parsed.ok) throw new Error(`parse failed: ${JSON.stringify(parsed.error)}`)
  return describeMermaidFacts(parsed.value)
}

function capture(fn: () => number): { code: number; out: string } {
  const chunks: string[] = []
  const orig = process.stdout.write.bind(process.stdout)
  ;(process.stdout as any).write = (s: string) => { chunks.push(String(s)); return true }
  let code = 0
  try { code = fn() } finally { (process.stdout as any).write = orig }
  return { code, out: chunks.join('') }
}

describe('deterministic Mermaid facts', () => {
  const cases: Array<{ family: string; source: string; expected: string[] }> = [
    { family: 'flowchart', source: 'flowchart LR\n  A[Start] -->|go| B{Done?}', expected: ['family flowchart', 'direction LR', 'node A : Start', 'node B : Done?', 'edge A -> B : go'] },
    { family: 'state', source: 'stateDiagram-v2\n  [*] --> Processing\n  Processing --> [*] : done', expected: ['family state', 'state Processing', 'edge Processing -> [*] : done'] },
    { family: 'sequence', source: 'sequenceDiagram\n  participant User\n  participant API\n  User->>API: Export\n  API-->>User: SVG', expected: ['family sequence', 'participant User : User', 'participant API : API', 'message User -> API : Export', 'message API -> User : SVG'] },
    { family: 'timeline', source: 'timeline\n  title Plan\n  2024 : Alpha : Beta', expected: ['family timeline', 'title Plan', 'period 2024', 'event 2024 : Alpha', 'event 2024 : Beta'] },
    { family: 'class', source: 'classDiagram\n  class Animal\n  class Duck {\n    +quack()\n  }\n  Animal <|-- Duck', expected: ['family class', 'class Animal', 'class Duck', 'member Duck +quack()', 'relation Animal inheritance Duck'] },
    { family: 'er', source: 'erDiagram\n  CUSTOMER ||--o{ ORDER : places\n  ORDER {\n    string id\n  }', expected: ['family er', 'entity CUSTOMER', 'entity ORDER', 'attribute ORDER string id', 'relation CUSTOMER one-only -- zero-or-many ORDER : places'] },
    { family: 'journey', source: 'journey\n  title Checkout\n  section Shopping\n    Review: 4: Agent', expected: ['family journey', 'title Checkout', 'section Shopping', 'journey task Review score 4 actors Agent'] },
    { family: 'architecture', source: 'architecture-beta\n  group backend(cloud)[Backend]\n  service api(server)[API] in backend\n  service db(database)[DB] in backend\n  api:R --> L:db', expected: ['family architecture', 'group backend : Backend', 'service api : API', 'service db : DB', 'edge api:R -> db:L'] },
    { family: 'xychart', source: 'xychart-beta\n  title Revenue\n  x-axis [Jan, Feb]\n  bar Forecast [2, 3]', expected: ['family xychart', 'title Revenue', 'x-axis categories Jan, Feb', 'series Forecast bar [2,3]'] },
    { family: 'pie', source: 'pie title Traffic\n  "Direct" : 40\n  "Docs" : 3', expected: ['family pie', 'title Traffic', 'slice Direct = 40', 'slice Docs = 3'] },
    { family: 'quadrant', source: 'quadrantChart\n  title Priorities\n  x-axis Low Effort --> High Effort\n  y-axis Low Value --> High Value\n  Docs: [0.8, 0.2]', expected: ['family quadrant', 'title Priorities', 'x-axis Low Effort -> High Effort', 'y-axis Low Value -> High Value', 'point Docs @ 0.8,0.2'] },
    { family: 'gantt', source: 'gantt\n  dateFormat YYYY-MM-DD\n  section Build\n  Core :core, 2024-01-01, 2d\n  Docs :docs, after core, 2d', expected: ['family gantt', 'section Build', 'task Core id core', 'task Docs id docs', 'task Docs start after core', 'task Docs end 2d'] },
  ]

  for (const c of cases) {
    test(`${c.family}: emits stable atomic facts`, () => {
      const out = facts(c.source)
      for (const expected of c.expected) expect(out).toContain(expected)
      expect(out).toEqual([...out].sort())
      expect(new Set(out).size).toBe(out.length)
      for (const fact of out) expect(fact).not.toContain('\n')
    })
  }

  test('source helper returns the same facts as parsed diagrams', () => {
    const source = 'pie title Traffic\n  "Docs" : 3'
    const parsed = parseMermaid(source)
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    const fromSource = describeMermaidFactsSource(source)
    expect(fromSource.ok).toBe(true)
    if (fromSource.ok) expect(fromSource.value).toEqual(describeMermaidFacts(parsed.value))
  })
})

describe('checkMermaid semantic read-back', () => {
  test('detects verify-green-but-wrong state transition label', () => {
    const parsed = parseMermaid('stateDiagram-v2\n  [*] --> Processing\n  Processing --> [*]')
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    const result = checkMermaid(parsed.value, ['edge Processing -> [*] : done'])
    expect(result.ok).toBe(false)
    expect(result.missing).toEqual(['edge Processing -> [*] : done'])
    expect(result.unexpected).toEqual([])
  })

  test('detects missing public class member visibility', () => {
    const parsed = parseMermaid('classDiagram\n  class Duck {\n    quack()\n  }')
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    const result = checkMermaid(parsed.value, { include: ['member Duck +quack()'] })
    expect(result.ok).toBe(false)
    expect(result.missing).toEqual(['member Duck +quack()'])
    expect(result.facts).toContain('member Duck quack()')
  })

  test('detects Gantt dependency expressed as a literal date', () => {
    const parsed = parseMermaid('gantt\n  dateFormat YYYY-MM-DD\n  section Build\n  Core :core, 2024-01-01, 2d\n  Docs :docs, 2024-01-03, 2d')
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    const result = checkMermaid(parsed.value, { include: ['task Docs start after core'], exclude: ['task Docs start 2024-01-03'] })
    expect(result.ok).toBe(false)
    expect(result.missing).toEqual(['task Docs start after core'])
    expect(result.unexpected).toEqual(['task Docs start 2024-01-03'])
  })

  test('passes when required facts are present and forbidden facts are absent', () => {
    const parsed = parseMermaid('pie title Traffic\n  "Docs" : 3')
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    expect(checkMermaid(parsed.value, { include: ['slice Docs = 3'], exclude: ['slice Docs = 4'] })).toMatchObject({ ok: true, missing: [], unexpected: [] })
  })
})

describe('facts through Code Mode and CLI surfaces', () => {
  test('Code Mode exposes facts and checks through mermaid.*', async () => {
    const result = await executeInSandbox(`
      const parsed = mermaid.parseRegisteredMermaid('classDiagram\\n  class Duck {\\n    +quack()\\n  }')
      if (!parsed.ok) return { error: 'parse' }
      return {
        facts: mermaid.describeMermaidFacts(parsed.value),
        check: mermaid.checkMermaid(parsed.value, ['member Duck +quack()']),
      }
    `, { trace: true })
    expect(result.ok).toBe(true)
    expect((result.value as any).facts).toContain('member Duck +quack()')
    expect((result.value as any).check.ok).toBe(true)
    expect(result.trace?.some(c => c.verb === 'facts')).toBe(true)
    expect(result.trace?.some(c => c.verb === 'check')).toBe(true)
  })

  test('Code Mode source helpers return Result envelopes', async () => {
    const result = await executeInSandbox(`
      return mermaid.checkMermaidSource('stateDiagram-v2\\n  Processing --> [*]', ['edge Processing -> [*] : done'])
    `)
    expect(result.ok).toBe(true)
    expect((result.value as any).ok).toBe(true)
    expect((result.value as any).value.ok).toBe(false)
    expect((result.value as any).value.missing).toEqual(['edge Processing -> [*] : done'])
  })

  test('am describe --format facts emits newline facts; --json wraps facts', () => {
    const dir = mkdtempSync(join(tmpdir(), 'am-facts-'))
    try {
      const file = join(dir, 'diagram.mmd')
      writeFileSync(file, 'stateDiagram-v2\n  Processing --> [*] : done')
      const text = capture(() => runCli(['describe', file, '--format', 'facts']))
      expect(text.code).toBe(0)
      expect(text.out.split('\n')).toContain('edge Processing -> [*] : done')
      const json = capture(() => runCli(['describe', file, '--format', 'facts', '--json']))
      expect(json.code).toBe(0)
      expect(JSON.parse(json.out).facts).toContain('edge Processing -> [*] : done')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
