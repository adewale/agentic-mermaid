// ER sources against pinned upstream Mermaid 11.16's own database. For each
// parity row Mermaid either rejects the source, and then so must we (the
// renderer throws, and the typed body falls back to opaque), or accepts it,
// and then both of our parsers must read the same entities (identity and
// alias) and relations (ends and label). Upstream's database keeps entity
// codes as its markers; its identity is the marker text (spelled back as
// codes) and its text is what the markers display. Where Mermaid rejects a
// source whose meaning is clear, ours reads it and verify says so instead
// (ER_READ_GENEROUSLY).

import { afterAll, describe, expect, test } from 'bun:test'
import { asEr, mutate, parseRegisteredMermaid, renderMermaidSVG, serializeMermaid, verifyMermaid } from '../agent/index.ts'
import { parseErDiagram } from '../er/parser.ts'
import { normalizeMermaidSource } from '../mermaid-source.ts'
import { displayText, escapeXml } from '../multiline-utils.ts'
import { fromEntityMarkers } from '../shared/mermaid-entities.ts'
import { projectEntityMarkers } from '../shared/mermaid-entity-display.ts'
import { startUpstreamMermaid } from './helpers/upstream-mermaid.ts'

const upstream = startUpstreamMermaid()
afterAll(() => upstream.close())

interface ErReading {
  entities: Array<[id: string, alias?: string]>
  relations: Array<[from: string, to: string, label: string]>
}

type Plain = Record<string, unknown>

/** Upstream's database, or 'rejected'. */
async function mermaidReads(source: string): Promise<ErReading | 'rejected'> {
  const json = await upstream.database(source)
  if (json === undefined) return 'rejected'
  const db = JSON.parse(json) as { getEntities: Array<[string, Plain]>; getRelationships: Plain[] }
  const keyById = new Map(db.getEntities.map(([key, entity]) => [entity.id as string, key]))
  return {
    entities: db.getEntities.map(([key, entity]) => {
      const alias = entity.alias as string
      return alias ? [fromEntityMarkers(key), projectEntityMarkers(alias)] : [fromEntityMarkers(key)]
    }),
    relations: db.getRelationships.map(relation => [
      fromEntityMarkers(keyById.get(relation.entityA as string)!),
      fromEntityMarkers(keyById.get(relation.entityB as string)!),
      projectEntityMarkers(relation.roleA as string),
    ]),
  }
}

/** What the typed body reads, or 'rejected' when the renderer rejects the
 * source; a typed body that disagrees with the renderer about rejection is
 * reported as such. */
function oursReads(source: string): ErReading | 'rejected' | string {
  let renderRejected = false
  try {
    parseErDiagram(normalizeMermaidSource(source).familyLines)
  } catch {
    renderRejected = true
  }
  const parsed = parseRegisteredMermaid(source)
  const er = parsed.ok ? asEr(parsed.value) : null
  if (renderRejected) return er ? 'renderer rejects, typed body accepts' : 'rejected'
  if (!er) return 'renderer accepts, typed body is opaque'
  return {
    entities: er.body.entities.map(entity => entity.label !== undefined ? [entity.id, entity.label] : [entity.id]),
    relations: er.body.relations.map(relation => [relation.from, relation.to, relation.label ?? '']),
  }
}

async function expectParity(source: string): Promise<void> {
  expect({ source, ours: oursReads(source) }).toEqual({ source, ours: await mermaidReads(source) })
}

describe('ER relations against pinned Mermaid', () => {
  // BUG-33: a crow's-foot token needs no space to part it from a name.
  test.each([
    'erDiagram\n  id1||--||id2 : label',
    'erDiagram\n  CUSTOMER||--o{ORDER : places',
    'erDiagram\n  CUSTOMER ||--o{order : places',
    'erDiagram\n  A}o--o{B : r',
    'erDiagram\n  A|o..o|B : r',
    'erDiagram\n  A:::c||--o{B : r',
    'erDiagram\n  A-||--||B : r',
  ])('%j reads as Mermaid reads it', expectParity)
})

describe('ER text against pinned Mermaid', () => {
  // BUG-19: entity codes read with the shared codec, in aliases and labels.
  test.each([
    'erDiagram\n  A["I #9829; you"]',
    'erDiagram\n  A["#quot;q#quot; #35;1 #amp;amp; #notit; #unknown;"]',
    'erDiagram\n  A[x#35;y]',
    'erDiagram\n  A ||--o{ B : "x #35; y #quot;"',
    'erDiagram\n  A ||--o{ B : x#9829;y',
  ])('%j reads as Mermaid reads it', expectParity)

  // An entity's first alias is its alias; a later one does not replace it.
  test.each([
    'erDiagram\n  A["x"]\n  A["y"]',
    'erDiagram\n  A\n  A["y"]\n  A[z]',
    'erDiagram\n  A["x"] {\n    int a\n  }\n  A["y"] {\n    int b\n  }',
  ])('%j reads as Mermaid reads it', expectParity)

  // BUG-31: text is kept as written. Markdown and `<br>` are display, and a
  // quoted name has no alias of its own.
  test.each([
    'erDiagram\n  A["p*q*"]',
    'erDiagram\n  A[**b**]',
    'erDiagram\n  A[_i_]',
    'erDiagram\n  A["x<br>y"]',
    'erDiagram\n  A ||--o{ B : "a*b* c"',
    'erDiagram\n  "A b"||--o{"C d" : r',
    'erDiagram\n  "Entity<br>Name"',
  ])('%j reads as Mermaid reads it', expectParity)

  // A quoted label is one string: what `"a"b"` means is unclear, so ours
  // rejects it as Mermaid does.
  test.each([
    'erDiagram\n  A ||--o{ B : "a"b"',
  ])('%j is rejected as Mermaid rejects it', expectParity)
})

// Mermaid rejects each of these, but what it means is clear, so ours reads it
// and verify reports it. ER quoted text has no escapes upstream, and a quoted
// name holds no `%` or backslash and is never empty: ours reads `\"` as `"`
// (BUG-30's writer still writes `#quot;`). Mermaid ER has no trailing
// comments: ours reads a `%%` after a statement as one. The typed body leaves
// the diagram opaque where the serializer has no Mermaid spelling for an id
// or an empty name. Pinned 11.16 has no ER subgraphs; upstream's own grammar
// (11.17, erDiagram.jison) reads a subgraph id as the same quoted name.
// [source, typed body, text the render draws, syntax verify reports, its line]
const ER_READ_GENEROUSLY: ReadonlyArray<readonly [string, 'er' | 'opaque', string, string, number]> = [
  ['erDiagram\n  A["a\\"b"]', 'er', '>a&quot;b<', 'er_quoted_text', 2],
  ['erDiagram\n  A ||--o{ B : "l\\"m"', 'er', '>l&quot;m<', 'er_quoted_text', 2],
  ['erDiagram\n  "a\\"b" ||--o{ B : x', 'opaque', '>a&quot;b<', 'er_quoted_text', 2],
  ['erDiagram\n  A["a\\\\b"]', 'er', '>a\\b<', 'er_quoted_text', 2],
  ['erDiagram\n  A["100% done"]', 'er', '>100% done<', 'er_quoted_text', 2],
  ['erDiagram\n  A[""]\n  A ||--o{ B : x', 'opaque', '>B<', 'er_quoted_text', 2],
  ['erDiagram\n  subgraph "a\\"b"\n  A\n  end', 'opaque', '>a&quot;b<', 'er_quoted_text', 2],
  ['erDiagram\n  A ||--o{ B : x %% c', 'er', '>x<', 'er_trailing_comment', 2],
  ['erDiagram\n  A ||--o{ B : "x" %% c', 'er', '>x<', 'er_trailing_comment', 2],
  ['erDiagram\n  A %% c', 'er', '>A<', 'er_trailing_comment', 2],
  ['erDiagram\n  A {\n    int x %% c\n  }', 'er', '>x<', 'er_trailing_comment', 3],
  ['erDiagram\n  A\n  style A fill:#f00 %% c', 'er', 'fill="#f00"', 'er_trailing_comment', 3],
]

describe('ER source Mermaid rejects, read generously', () => {
  test.each(ER_READ_GENEROUSLY)('%j is read, drawn and reported', (source, typed, drawn, syntax, line) => {
    const parsed = parseRegisteredMermaid(source)
    expect({
      typed: parsed.ok && parsed.value.body.kind,
      draws: renderMermaidSVG(source).includes(drawn),
      reported: verifyMermaid(source).warnings.flatMap(warning => warning.code === 'UNSUPPORTED_SYNTAX' ? [`${warning.syntax}@${warning.line}`] : []),
    }).toEqual({ typed, draws: true, reported: expect.arrayContaining([`${syntax}@${line}`]) })
  })
})

describe('ER comments against pinned Mermaid', () => {
  // `%%` inside a quoted label or on a line of its own is what Mermaid reads.
  test.each([
    'erDiagram\n  A ||--o{ B : "x %% c"',
    'erDiagram\n  A ||--o{ B : r\n  %% a line of its own\n  C',
    'erDiagram\n  direction TB %% a direction reads to the end of its line\n  A',
  ])('%j reads as Mermaid reads it', expectParity)

  test('a typed attribute cannot carry a trailing comment Mermaid would reject', () => {
    const parsed = parseRegisteredMermaid('erDiagram\n  A')
    if (!parsed.ok) throw new Error('fixture rejected')
    const result = mutate(parsed.value, { kind: 'add_attribute', entity: 'A', text: 'int x %% c' })
    expect(result.ok ? 'accepted' : result.error.code).toBe('INVALID_OP')
  })
})

describe('typed ER text is written as Mermaid reads it', () => {
  // BUG-30: the serializer writes `"` (and what else a context cannot hold)
  // as an entity code, never as `\"`.
  test.each([
    'say "hi"',
    '100% done',
    'a\\b',
    '#35; and #quot; stay text',
    'I ♥ "you"',
    // BUG-31: markdown and line breaks are written as they were given.
    'p*q* and **b**',
    'x<br>y',
  ])('%j as an alias and a relation label', async text => {
    const parsed = parseRegisteredMermaid('erDiagram\n  A\n  B')
    if (!parsed.ok) throw new Error('fixture rejected')
    const labelled = mutate(parsed.value, { kind: 'set_entity_label', entity: 'A', label: text })
    if (!labelled.ok) throw new Error(`set_entity_label refused ${JSON.stringify(text)}`)
    const related = mutate(labelled.value, { kind: 'add_relation', from: 'A', to: 'B', leftCard: 'one-only', rightCard: 'zero-or-many', label: text })
    if (!related.ok) throw new Error(`add_relation refused ${JSON.stringify(text)}`)
    const source = serializeMermaid(related.value)
    const expected: ErReading = { entities: [['A', text], ['B']], relations: [['A', 'B', text]] }
    expect({ source, mermaid: await mermaidReads(source) }).toEqual({ source, mermaid: expected })
    expect({ source, ours: oursReads(source) }).toEqual({ source, ours: expected })
  })
})

describe('ER text as drawn', () => {
  // What the renderer draws for an entity code is what it displays upstream;
  // a code never forms markdown emphasis or a line break (upstream reads the
  // codes only after its markdown and <br> handling).
  test.each([
    ['A["I #9829; you"]', 'I ♥ you'],
    ['A["#42;x#42; #lt;br#gt; #95;y#95;"]', '*x* <br> _y_'],
  ])('%s draws %j', (declaration, drawn) => {
    const diagram = parseErDiagram(normalizeMermaidSource(`erDiagram\n  ${declaration}`).familyLines)
    expect({ declaration, drawn: displayText(diagram.entities[0]!.label) }).toEqual({ declaration, drawn })
    const svg = renderMermaidSVG(`erDiagram\n  ${declaration}`)
    expect({ declaration, inSvg: svg.includes(`>${escapeXml(drawn)}</text>`) }).toEqual({ declaration, inSvg: true })
  })

  // BUG-31: the typed body keeps text as written, but the renderer still
  // draws markdown and `<br>`, and a typed edit writes the source back as is.
  test('markdown stays display: drawn formatted, kept and written as written', () => {
    const source = 'erDiagram\n  A["p*q*"] {\n    int id\n  }\n  A ||--o{ B : "has <br>many"\n  subgraph G [p*q* r]\n    C\n  end'
    const drawn = parseErDiagram(normalizeMermaidSource(source).familyLines)
    expect({
      entity: drawn.entities[0]!.label,
      relation: drawn.relationships[0]!.label,
      group: drawn.groups[0]!.label,
    }).toEqual({ entity: 'p<i>q</i>', relation: 'has \nmany', group: 'p<i>q</i> r' })
    const parsed = parseRegisteredMermaid(source)
    const er = parsed.ok ? asEr(parsed.value) : null
    if (!er) throw new Error('fixture is not a typed ER body')
    expect({
      entity: er.body.entities[0]!.label,
      relation: er.body.relations[0]!.label,
      group: er.body.groups?.[0]?.label,
    }).toEqual({ entity: 'p*q*', relation: 'has <br>many', group: 'p*q* r' })
    const edited = mutate(er, { kind: 'add_entity', id: 'D' })
    if (!edited.ok) throw new Error('add_entity refused')
    const written = serializeMermaid(edited.value)
    for (const line of ['A["p*q*"] {', 'A ||--o{ B : "has <br>many"']) expect({ written, has: written.includes(line) }).toEqual({ written, has: true })
    const reread = parseRegisteredMermaid(written)
    expect(reread.ok && asEr(reread.value)?.body.groups?.[0]?.label).toBe('p*q* r')
  })

  // Known bug (BUG-19's residual): the normalized label form has no spelling
  // for a literal formatting tag, so a code that spells one formats. Upstream
  // draws the tag as text.
  test.failing('an entity code that spells a formatting tag is drawn as text', () => {
    const diagram = parseErDiagram(normalizeMermaidSource('erDiagram\n  A["#lt;b#gt;x#lt;/b#gt;"]').familyLines)
    expect(displayText(diagram.entities[0]!.label)).toBe('<b>x</b>')
  })
})
