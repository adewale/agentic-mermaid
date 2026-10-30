import { describe, expect, test } from 'bun:test'
import fc from 'fast-check'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { describeMermaid } from '../agent/describe.ts'
import { checkMermaid, describeMermaidFacts, describeMermaidFactsSource } from '../agent/facts.ts'
import { renderMermaidSVG } from '../index.ts'
import { fcParameters } from './helpers/fc-parameters.ts'
import { asClass, mutate, serializeMermaid } from '../agent/index.ts'
import { parseRegisteredMermaid as parseMermaid } from '../agent/parse.ts'
import { runCli } from '../cli/index.ts'
import { executeInSandbox } from '../mcp/sandbox.ts'
import { captureCli as capture } from './helpers/cli-capture.ts'
import { useTempDirs } from './helpers/temp-dir.ts'

const temp = useTempDirs()

function facts(source: string): string[] {
  const parsed = parseMermaid(source)
  if (!parsed.ok) throw new Error(`parse failed: ${JSON.stringify(parsed.error)}`)
  return describeMermaidFacts(parsed.value)
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

  test('XY point-label facts retain sparse authored labels and stable series/point identities on readback', () => {
    const source = 'xychart\n x-axis [Q1,Q2,Q3]\n line [25 "Launch",45,90 "Target Hit"]'
    const parsed = parseMermaid(source)
    if (!parsed.ok) throw new Error(JSON.stringify(parsed.error))
    const expected = ['series#0 point#0 : Launch', 'series#0 point#2 : Target Hit']
    for (const input of [source, serializeMermaid(parsed.value)]) {
      const out = facts(input)
      expect(out.filter(fact => fact.includes(' point#'))).toEqual(expected)
    }
    expect(checkMermaid(parsed.value, expected).ok).toBe(true)
  })

  test('source helper returns the same facts as parsed diagrams', () => {
    const source = 'pie title Traffic\n  "Docs" : 3'
    const parsed = parseMermaid(source)
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    const fromSource = describeMermaidFactsSource(source)
    expect(fromSource.ok).toBe(true)
    if (fromSource.ok) expect(fromSource.value).toEqual(describeMermaidFacts(parsed.value))
  })

  test('recognized messages in preserved Sequence controls remain observable without claiming typed edit indexes', () => {
    const source = 'sequenceDiagram\n title Checkout\n A->>B: start\n critical Connect\n A->>B: attempt\n option timeout\n B-->>A: retry\n end\n rect rgb(200,200,200)\n loop nested\n A->>B: #lt;b#gt;literal#lt;/b#gt;\n end\n end'
    const out = facts(source)
    for (const message of ['message A -> B : start', 'message A -> B : attempt', 'message B -> A : retry', 'message A -> B : <b>literal</b>']) expect(out).toContain(message)
    expect(out).toContain('title Checkout')
    expect(out.filter(fact => fact.startsWith('preserved-message#') && fact.includes(' -> '))).toHaveLength(3)
    expect(out.filter(fact => /^message#\d+ (?:top-level|fragment#)/.test(fact))).toEqual(['message#0 top-level A -> B : start'])
    const parsed = parseMermaid(source)
    if (!parsed.ok) throw new Error(JSON.stringify(parsed.error))
    expect(checkMermaid(parsed.value, ['message A -> B : attempt', 'message B -> A : retry']).ok).toBe(true)
    expect(facts(serializeMermaid(parsed.value))).toEqual(out)
  })

  test('Sequence text reads as drawn: alias quotes and line breaks are interpreted, as in the SVG', () => {
    // Visible lines, joined by an authored break spelling; the alias may be quoted.
    const lineArb = fc.stringMatching(/^[A-Z][a-z]{0,5}(?: [a-z]{1,4})?$/)
    fc.assert(fc.property(fc.array(lineArb, { minLength: 1, maxLength: 3 }), fc.constantFrom('<br/>', '<br>', '<br />'), fc.constantFrom('', ' '), fc.boolean(),
      (lines, br, pad, quoted) => {
        const authored = lines.join(`${pad}${br}${pad}`)
        const drawn = lines.join(`${pad}\n${pad}`)
        const source = `sequenceDiagram\n  participant A as ${quoted ? `"${authored}"` : authored}\n  A->>A: ${authored}\n  alt ${authored}\n    A->>A: x\n  end`
        const parsed = parseMermaid(source)
        if (!parsed.ok) throw new Error(JSON.stringify(parsed.error))
        const shown = drawn.replace(/\n/g, '\\n')
        const expected = [`participant A : ${shown}`, `message A -> A : ${shown}`, `fragment#0 branch#0 : ${shown}`]
        expect({ source, missing: checkMermaid(parsed.value, expected).missing }).toEqual({ source, missing: [] })
        // The renderer's own reading of the participant name.
        const label = renderMermaidSVG(source).match(/<g class="actor" data-id="A" data-label="([^"]*)"/)?.[1]?.replace(/&#10;/g, '\n')
        expect({ source, label }).toEqual({ source, label: drawn })
        const tree = JSON.parse(describeMermaid(parsed.value, { format: 'json' }))
        expect({ source, node: tree.nodes[0].label, edge: tree.edges[0].label }).toEqual({ source, node: drawn, edge: drawn })
        expect(describeMermaid(parsed.value)).toStartWith(`A sequence diagram between ${drawn}.`)
      }), fcParameters({ numRuns: 40, examples: [[['Alice', 'Smith'], '<br/>', ' ', true], [['Alice'], '<br/>', '', true]] }))
  })
})

describe('checkMermaid semantic read-back', () => {
  test('distinguishes Class relationships with opposite endpoint marker ownership', () => {
    const intended = parseMermaid('classDiagram\nPerson --|> Animal')
    const reversed = parseMermaid('classDiagram\nPerson <|-- Animal')
    if (!intended.ok || !reversed.ok) throw new Error('expected Class diagrams')
    const expected = describeMermaidFacts(intended.value)
    expect(expected).toContain('relation#0 Person inheritance Animal marker to')
    expect(checkMermaid(intended.value, expected).ok).toBe(true)
    expect(checkMermaid(reversed.value, expected)).toMatchObject({
      ok: false,
      missing: ['relation#0 Person inheritance Animal marker to'],
    })
    const legacy = ['class Animal', 'class Person', 'family class', 'relation Person inheritance Animal', 'relation#0 Person inheritance Animal']
    expect(checkMermaid(intended.value, { include: legacy, exact: true })).toMatchObject({
      ok: false,
      unexpected: ['relation#0 Person inheritance Animal line solid', 'relation#0 Person inheritance Animal marker to'],
    })
    expect(checkMermaid(intended.value, { include: [...legacy, 'relation#0 Person inheritance Animal line solid', 'relation#0 Person inheritance Animal marker to'], exact: true }).ok).toBe(true)
  })

  test.each([
    { dashed: 'o..*', solid: 'o--*', kind: 'aggregation' },
    { dashed: '()..()', solid: '()--()', kind: 'lollipop' },
  ])('distinguishes $dashed from $solid and retains shaft facts after an edit', ({ dashed, solid, kind }) => {
    const intended = parseMermaid(`classDiagram\nA ${dashed} B`)
    const changed = parseMermaid(`classDiagram\nA ${solid} B`)
    if (!intended.ok || !changed.ok) throw new Error('expected Class diagrams')
    const expected = `relation#0 A ${kind} B line dashed`
    expect(describeMermaidFacts(intended.value)).toContain(expected)
    expect(checkMermaid(changed.value, [expected])).toMatchObject({ ok: false, missing: [expected] })
    const editable = asClass(intended.value)
    if (!editable) throw new Error('expected editable Class diagram')
    const edited = mutate(editable, { kind: 'add_member', class: 'A', text: '+value: String' })
    if (!edited.ok) throw new Error(JSON.stringify(edited.error))
    const reloaded = parseMermaid(serializeMermaid(edited.value))
    if (!reloaded.ok) throw new Error('expected Class diagram after reload')
    expect(checkMermaid(reloaded.value, [expected]).ok).toBe(true)
  })

  test('distinguishes the marker kinds at both Class relationship endpoints', () => {
    const intended = parseMermaid('classDiagram\nWhole o--* Part')
    const swapped = parseMermaid('classDiagram\nWhole *--o Part')
    if (!intended.ok || !swapped.ok) throw new Error('expected Class diagrams')
    const expected = ['relation#0 Whole aggregation Part marker both', 'relation#0 from marker aggregation', 'relation#0 to marker composition']
    expect(checkMermaid(intended.value, expected).ok).toBe(true)
    expect(checkMermaid(swapped.value, expected).ok).toBe(false)
  })

  test.each([
    { relKind: 'inheritance', markerAt: 'from' },
    { relKind: 'dependency', markerAt: 'to' },
    { relKind: 'link-solid', markerAt: 'none' },
    { relKind: 'lollipop', markerAt: 'from' },
  ] as const)('keeps default $relKind marker facts through programmatic creation and reload', ({ relKind, markerAt }) => {
    const parsed = parseMermaid('classDiagram\nclass A\nclass B')
    if (!parsed.ok) throw new Error('expected Class diagram')
    const edited = mutate(asClass(parsed.value)!, relKind === 'lollipop' ? { kind: 'add_interface', class: 'B', label: 'A', side: 'from' } : { kind: 'add_relation', from: 'A', to: 'B', relKind })
    if (!edited.ok) throw new Error(JSON.stringify(edited.error))
    const expected = describeMermaidFacts(edited.value)
    expect(expected).toContain(`relation#0 ${relKind === 'lollipop' ? 'interface0' : 'A'} ${relKind} B marker ${markerAt}`)
    const reloaded = parseMermaid(serializeMermaid(edited.value))
    if (!reloaded.ok) throw new Error('expected Class diagram after reload')
    expect(describeMermaidFacts(reloaded.value)).toEqual(expected)
  })

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
    const result = await executeInSandbox(
      `
      const parsed = mermaid.parseRegisteredMermaid('classDiagram\\n  class Duck {\\n    +quack()\\n  }')
      if (!parsed.ok) return { error: 'parse' }
      return {
        facts: mermaid.describeMermaidFacts(parsed.value),
        check: mermaid.checkMermaid(parsed.value, ['member Duck +quack()']),
      }
    `,
      { trace: true },
    )
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
    const dir = temp.dir('am-facts-')
    const file = join(dir, 'diagram.mmd')
    writeFileSync(file, 'stateDiagram-v2\n  Processing --> [*] : done')
    const text = capture(() => runCli(['describe', file, '--format', 'facts']))
    expect(text.code).toBe(0)
    expect(text.out.split('\n')).toContain('edge Processing -> [*] : done')
    const json = capture(() => runCli(['describe', file, '--format', 'facts', '--json']))
    expect(json.code).toBe(0)
    expect(JSON.parse(json.out).facts).toContain('edge Processing -> [*] : done')
  })
})
