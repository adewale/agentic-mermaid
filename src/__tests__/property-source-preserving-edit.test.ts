// Generated op sequences on generated diagrams with interleaved comments,
// blank lines and uneven indentation. Independent of the projection code:
//  - the source-preserving edit succeeds exactly when the canonical edit does;
//  - each step reads back as the same diagram as the canonical edit of the
//    same diagram (facts and canonical statements, compared as multisets);
//  - a step that reports `canonical` returns exactly the canonical source;
//  - while every step is `local`, every interleaved comment and blank line
//    survives, in order.
import { describe, expect, test } from 'bun:test'
import fc from 'fast-check'
import { describeMermaidFacts, describeOps, mutateChecked, mutatePreservingSource, parseRegisteredMermaid, serializeMermaid } from '../agent/index.ts'
import type { MutableFamilyId } from '../agent/mutation-ops.ts'
import type { ParsedDiagram } from '../agent/types.ts'
import { fcParameters } from './helpers/fc-parameters.ts'

interface Family {
  family: MutableFamilyId
  header: string
  statements: string[]
  ids: string[]
  /** Gaps (0 = before the first statement) inside blocks whose comments the
   * reader does not admit as structured: ER attribute blocks read as opaque. */
  quiet?: number[]
}

// Statements each family's grammar reads one per line, in an order that keeps
// the diagram valid however comments and blank lines are interleaved.
const FAMILIES: Family[] = [
  { family: 'flowchart', header: 'graph TD', statements: ['A["Alpha one"] --> B{Beta?}', 'B -->|yes| C(Gamma):::hot', 'B -- no --> D[Delta]', 'subgraph G["Group title"]', 'E[Eps] --> F', 'end', 'classDef hot fill:#f96;', 'style A fill:#eee'], ids: ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'hot', 'A->B'] },
  { family: 'sequence', header: 'sequenceDiagram', statements: ['participant A as Alice', 'participant B as Bob', 'A ->> B: hello', 'alt ok', 'B -->> A: fine', 'else no', 'B -x A: fail', 'end', 'Note over A,B: done'], ids: ['A', 'B'] },
  { family: 'class', header: 'classDiagram', statements: ['class Animal {', '+String name', '+eat() void', '}', 'class Dog', 'Animal <|-- Dog : extends', 'note for Dog "Good"', 'class Cat:::pet', 'classDef pet fill:#f9f'], ids: ['Animal', 'Dog', 'Cat', 'pet'] },
  { family: 'state', header: 'stateDiagram-v2', statements: ['[*] --> Idle', 'Idle --> Run: start', 'state Run {', 'Fast --> Slow', '}', 'Run --> Done: stop', 'Idle: Waiting', 'Done --> [*]'], ids: ['Idle', 'Run', 'Fast', 'Slow', 'Done'] },
  { family: 'er', header: 'erDiagram', statements: ['CUSTOMER ||--o{ ORDER : places', 'CUSTOMER {', 'string name', 'string email PK', '}', 'ORDER {', 'int id', '}', 'ITEM["Line item"]'], ids: ['CUSTOMER', 'ORDER', 'ITEM'], quiet: [2, 3, 4, 6, 7] },
  { family: 'gantt', header: 'gantt', statements: ['title Plan', 'dateFormat YYYY-MM-DD', 'section Build', 'Design :des, 2024-01-01, 5d', 'Code :code, after des, 10d', 'section Ship', 'Release :milestone, rel, 2024-01-20, 0d'], ids: ['des', 'code', 'rel'] },
]

/** One authored line between statements: a comment, a blank line or nothing. */
const gapArb = fc.oneof(
  { weight: 3, arbitrary: fc.constant<string[]>([]) },
  { weight: 1, arbitrary: fc.constantFrom([''], ['', '']) },
  { weight: 2, arbitrary: fc.tuple(fc.constantFrom('', '  ', '\t'), fc.stringMatching(/^[a-z ]{1,8}$/)).map(([indent, text]) => [`${indent}%% ${text.trim() || 'note'}`]) },
)

const blankArb = fc.constantFrom<string[]>([], [''])
const sourceArb = (family: Family) => fc.tuple(
  fc.tuple(...Array.from({ length: family.statements.length + 1 }, (_, gap) => family.quiet?.includes(gap) ? blankArb : gapArb)),
  fc.array(fc.constantFrom('', '  ', '    ', '\t'), { minLength: family.statements.length, maxLength: family.statements.length }),
).map(([gaps, indents]) => {
  const lines = [family.header, ...gaps[0]!]
  family.statements.forEach((statement, index) => lines.push(indents[index]! + statement, ...gaps[index + 1]!))
  return { source: `${lines.join('\n')}\n`, comments: lines.filter(line => line.trim().startsWith('%%') || !line.trim()) }
})

// Shape-valid ops from each family's published field docs, with every string
// drawn from the diagram's identities or a few labels (ASCII, spaced, Unicode).
type FieldDoc = { name: string; required: boolean; type: string; fields?: FieldDoc[] }
const opArb = (family: Family): fc.Arbitrary<Record<string, unknown>> => {
  const text = fc.constantFrom(...family.ids, 'N1', 'New label', 'Größe', '2024-02-01', '3d')
  const value = ({ type, fields }: Pick<FieldDoc, 'type' | 'fields'>): fc.Arbitrary<unknown> => {
    if (type.startsWith('one of ')) {
      const values = [...type.matchAll(/"(?:[^"\\]|\\.)*"/g)].map(match => JSON.parse(match[0]) as string)
      return type.endsWith(' | null') ? fc.constantFrom<unknown>(...values, null) : fc.constantFrom(...values)
    }
    switch (type) {
      case 'string': return text
      case 'number': return fc.integer({ min: 0, max: 2 })
      case 'boolean': return fc.boolean()
      case 'string | null': return fc.option(text, { nil: null })
      case 'number | null': return fc.option(fc.integer({ min: 0, max: 2 }), { nil: null })
      case 'string[]': return fc.array(text, { maxLength: 2 })
      case 'object': return record(fields ?? [])
      case 'object | null': return fields ? fc.option(record(fields), { nil: null }) : fc.constant(null)
      default: return fc.constant(undefined)
    }
  }
  const record = (fields: FieldDoc[]): fc.Arbitrary<Record<string, unknown>> =>
    fc.record(Object.fromEntries(fields.map(field => [field.name, value(field)])), { requiredKeys: fields.filter(field => field.required).map(field => field.name) })
  return fc.oneof(...Object.entries(describeOps(family.family) as Record<string, FieldDoc[]>).map(([kind, fields]) => record(fields).map(op => ({ kind, ...op }))))
}

const caseArb = fc.constantFrom(...FAMILIES).chain(family => fc.tuple(fc.constant(family.family), sourceArb(family), fc.array(opArb(family), { minLength: 1, maxLength: 3 })))

function parse(source: string): ParsedDiagram {
  const parsed = parseRegisteredMermaid(source)
  if (!parsed.ok) throw new Error(`${JSON.stringify(parsed.error)}\n${source}`)
  return parsed.value
}

const model = (d: ParsedDiagram) => ({
  facts: describeMermaidFacts(d).sort(),
  statements: serializeMermaid(d).split('\n').filter(line => line.trim() && !line.trim().startsWith('%%')).map(line => line.replace(/\s+/g, '')).sort(),
})

/** `kept` lines that are missing from `lines` as an ordered subsequence. */
function missingInOrder(kept: readonly string[], lines: readonly string[]): string[] {
  let at = 0
  return kept.filter(line => {
    const found = lines.indexOf(line, at)
    if (found < 0) return true
    at = found + 1
    return false
  })
}

/** Lines of `kept` missing from `lines`, counted as a multiset. */
function missingAnywhere(kept: readonly string[], lines: readonly string[]): string[] {
  const left = [...lines]
  return kept.filter(line => {
    const found = left.indexOf(line)
    if (found < 0) return true
    left.splice(found, 1)
    return false
  })
}

type Case = [MutableFamilyId, { source: string; comments: string[] }, Array<Record<string, unknown>>]
const gantt = (lines: string[]) => ({ source: `${lines.join('\n')}\n`, comments: lines.filter(line => line.trim().startsWith('%%') || !line) })
// Reduced counterexamples. The first caught the projection rewriting a moved
// comment's indentation; a moved line now keeps its authored bytes. The other
// two caught the property's draft, which wrongly expected comment order to
// survive a reorder: Gantt keeps comments as segments of their section, so a
// moved section may carry them past each other.
const EXAMPLES: Array<[Case]> = [
  [['gantt', gantt(['gantt', '', 'title Plan', 'dateFormat YYYY-MM-DD', '%% a', 'section Build', '%% a', 'Design :des, 2024-01-01, 5d', '%% note', 'Code :code, after des, 10d', 'section Ship', '\t%% a', 'Release :milestone, rel, 2024-01-20, 0d']), [{ kind: 'move_section', from: 0, to: 1 }, { kind: 'add_section', label: 'des' }]]],
  [['gantt', gantt(['gantt', 'title Plan', '', 'dateFormat YYYY-MM-DD', '', 'section Build', 'Design :des, 2024-01-01, 5d', '%% a', 'Code :code, after des, 10d', 'section Ship', '%% note', 'Release :milestone, rel, 2024-01-20, 0d', '%% a']), [{ kind: 'move_section', from: 1, to: 0 }]]],
  [['gantt', gantt(['gantt', '%% a', 'title Plan', 'dateFormat YYYY-MM-DD', '', 'section Build', 'Design :des, 2024-01-01, 5d', 'Code :code, after des, 10d', '%% a', 'section Ship', 'Release :milestone, rel, 2024-01-20, 0d', '%% note']), [{ kind: 'move_section', from: 0, to: 1 }, { kind: 'add_task', sectionIndex: 0, label: 'des', end: 'des' }]]],
]

describe('source-preserving edits agree with canonical edits', () => {
  test('generated op sequences on commented, unevenly indented diagrams', () => {
    let local = 0
    fc.assert(fc.property(caseArb, ([family, { source, comments }, ops]) => {
      let current = parse(source), allLocal = true, text = source
      expect(current.kind).toBe(family)
      expect(current.body.kind).not.toBe('opaque')
      for (const op of ops) {
        const canonical = mutateChecked(current, op)
        const preserved = mutatePreservingSource(current, op)
        expect({ op, ok: preserved.ok }).toEqual({ op, ok: canonical.ok })
        if (!canonical.ok || !preserved.ok) break
        expect({ op, model: model(parse(preserved.value.source)) }).toEqual({ op, model: model(canonical.value) })
        if (preserved.value.preservation?.method === 'canonical') {
          allLocal = false
          expect(preserved.value.source).toBe(serializeMermaid(canonical.value))
        } else {
          expect(preserved.value.preservation).toEqual({ method: 'local' })
          local++
        }
        current = preserved.value.diagram
        text = preserved.value.source
      }
      if (!allLocal) return
      const reordered = ops.some(op => /^(?:move|reorder)_/.test(String(op.kind)))
      const missing = (reordered ? missingAnywhere : missingInOrder)(comments, text.split('\n'))
      expect({ text, missing }).toEqual({ text, missing: [] })
    }), fcParameters({ numRuns: 1500, examples: EXAMPLES }))
    expect(local).toBeGreaterThan(300)
  }, 180_000)
})
