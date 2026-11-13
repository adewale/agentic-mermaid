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
import { asEr, mutate, parseRegisteredMermaid, renderMermaidSVG, serializeMermaid, verifyMermaid, describeMermaidFacts, synthesizeFromGraph } from '../agent/index.ts'
import { parseErDiagram } from '../er/parser.ts'
import { erAttributeBlocks } from '../er/layout.ts'
import { normalizeMermaidSource } from '../mermaid-source.ts'
import { displayText, escapeXml } from '../multiline-utils.ts'
import { fromEntityMarkers } from '../shared/mermaid-entities.ts'
import { projectEntityMarkers } from '../shared/mermaid-entity-display.ts'
import { startUpstreamMermaid } from './helpers/upstream-mermaid.ts'
import { renderMermaidASCII } from '../index.ts'

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

// Mermaid rejects each of these, or reads it otherwise, but what it means is
// clear, so ours reads it and verify reports it. ER quoted text has no escapes upstream, and a quoted
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
  ['erDiagram\n  A {\n    int x "a\n    b" %% c\n  }', 'er', '>x<', 'er_trailing_comment', 4],
  ['erDiagram\n  A {\n    int id PK FK\n  }', 'er', '>id<', 'er_attribute_form', 3],
  ['erDiagram\n  A { int id "c" PK }', 'er', '>c<', 'er_attribute_form', 2],
  ['erDiagram\n  A\n  end', 'er', '>end<', 'er_keyword_name', 3],
  ['erDiagram\n  A ||--o{ B : places order', 'er', '>places order<', 'er_label_words', 2],
  // Mermaid reads the label `x` and declares an entity `y`.
  ['erDiagram\n  A ||--o{ B : x"y"', 'er', '>x&quot;y&quot;<', 'er_label_words', 2],
  ['erDiagram\n  A ||--o{ B : x"', 'er', '>x&quot;<', 'er_relation_label', 2],
  ['erDiagram\n  A ||--o{ B : x "y', 'er', '>x &quot;y<', 'er_relation_label', 2],
  // A relationship's label is required on its line, and Mermaid's lexer
  // reads a keyword, a cardinality or a number there before a label.
  ['erDiagram\n  A ||--o{ B :\n  C D', 'er', '>D<', 'er_relation_label', 2],
  ['erDiagram\n  "relates to" A ||--o{ 1 :end\n  places', 'er', '>end<', 'er_relation_label', 2],
  ['erDiagram\n  A ||--o{ B : 1', 'er', '>1<', 'er_relation_label', 2],
  ['erDiagram\n  A ||--o{ B : x,y', 'er', '>x,y<', 'er_relation_label', 2],
  ['erDiagram\n  A ||--o{ B : direction LR', 'er', '>direction LR<', 'er_direction_line', 2],
]

describe('ER source Mermaid rejects, read generously', () => {
  test.each(ER_READ_GENEROUSLY)('%j is read, drawn and reported', (source, typed, drawn, syntax, line) => {
    const parsed = parseRegisteredMermaid(source)
    const warnings = verifyMermaid(source).warnings
    expect({
      typed: parsed.ok && parsed.value.body.kind,
      draws: renderMermaidSVG(source).includes(drawn),
      reported: warnings.flatMap(warning => warning.code === 'UNSUPPORTED_SYNTAX' ? [`${warning.syntax}@${warning.line}`] : []),
    }).toEqual({ typed, draws: true, reported: expect.arrayContaining([`${syntax}@${line}`]) })
    if (syntax === 'er_trailing_comment') {
      expect(warnings.some(warning => warning.code === 'COMMENT_DROPPED')).toBe(false)
      if (!parsed.ok) throw new Error('parse failed')
      expect(serializeMermaid(parsed.value)).toContain('%%')
    }
  })

  // Mermaid lexes an attribute comment inside the block, where `.*direction`
  // does not apply, and a `%%` inside it, on any of its lines, is text.
  // A label word that only starts like a keyword is a label, and Mermaid
  // reads an entity code in it as text.
  test.each([
    'erDiagram\n  A {\n  int x "direction TB" } B',
    'erDiagram\n  A {\n  int x "a\n  b %% c"\n  }',
    'erDiagram\n  A ||--o{ B : oneself',
    'erDiagram\n  A ||--o{ B : #35;x',
  ])('%j has nothing to report', async source => {
    await expectParity(source)
    expect(verifyMermaid(source).warnings.filter(warning => warning.code === 'UNSUPPORTED_SYNTAX')).toEqual([])
  })
})

// A subgraph id Mermaid cannot read bare is written quoted, which it reads.
test.each([
  'erDiagram\n  subgraph "a(b)" [My (big) group]\n    A\n  end',
  'erDiagram\n  subgraph 2g [T]\n    A\n  end',
])('ER %j is written as Mermaid reads it', async source => {
  const parsed = parseRegisteredMermaid(source)
  if (!parsed.ok) throw new Error('fixture rejected')
  const written = serializeMermaid(parsed.value)
  const groups = (asEr(parsed.value)?.body.groups ?? []).map(group => [group.id, group.label])
  const mermaid = await upstream.project(written, diagram => (diagram.db.getSubGraphs() as Array<{ id: string; title: string }>).map(group => [group.id, group.title]))
  const reads: ErReading | string = await mermaidReads(written)
  expect({ written, groups: mermaid, reads }).toEqual({ written, groups: { ok: true, value: groups }, reads: oursReads(source) })
})

describe('ER comments against pinned Mermaid', () => {
  // `%%` inside a quoted label or on a line of its own is what Mermaid reads.
  test.each([
    'erDiagram\n  A ||--o{ B : "x %% c"',
    'erDiagram\n  A ||--o{ B : r\n  %% a line of its own\n  C',
    'erDiagram\n  direction TB %% a direction reads to the end of its line\n  A',
  ])('%j reads as Mermaid reads it', expectParity)

  // A typed attribute is written on a block line of its own, so it cannot
  // carry a trailing comment Mermaid would reject, or an unquoted `}`, which would end
  // the block when the line is read back.
  test.each(['int x %% c', 'int x}'])('a typed attribute cannot carry %j', text => {
    const parsed = parseRegisteredMermaid('erDiagram\n  A')
    if (!parsed.ok) throw new Error('fixture rejected')
    const result = mutate(parsed.value, { kind: 'add_attribute', entity: 'A', text })
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

// Mermaid's ER style lexer skips whitespace. The writer must protect spaces
// as well as punctuation, ending the line with `;` so the prepass keeps its
// final entity. Inspect actual DB fields after the SVG entity-resolution step.
describe('typed ER style text is written as Mermaid reads it', () => {
  test.each<[string, Record<string, string>]>([
    ['stroke-width:0.5px', { 'stroke-width': '0.5px' }],
    ['fill:rgb(1,2,3),stroke:#333', { fill: 'rgb(1,2,3)', stroke: '#333' }],
    ['font-family:"Arial",opacity:50%', { 'font-family': '"Arial"', opacity: '50%' }],
    ['fill:hsl(210.125 10.5% 20.25% / 0.123456789),stroke:rgb(1 2 3 / 0.987654321)', { fill: 'hsl(210.125 10.5% 20.25% / 0.123456789)', stroke: 'rgb(1 2 3 / 0.987654321)' }],
    ['font-family:"Noto Sans",stroke-dasharray:5  3,stroke:#1234', { 'font-family': '"Noto Sans"', 'stroke-dasharray': '5  3', stroke: '#1234' }],
    ['fill:var(--brand),font-family:Noto\tSans\u00a0Mono\u2028Aux\u3000JP\ufeffSerif', { fill: 'var(--brand)', 'font-family': 'Noto\tSans\u00a0Mono\u2028Aux\u3000JP\ufeffSerif' }],
    ['|:s,content:{|}~,font-family:ER_STYLE_ENTITY_0_', { '|': 's', content: '{|}~', 'font-family': 'ER_STYLE_ENTITY_0_' }],
  ])('%j', async (style, props) => {
    for (const placement of ['inline', 'class'] as const) {
      const source = placement === 'inline' ? `erDiagram\n  A\n  style A ${style}` : `erDiagram\n  A:::c\n  classDef c ${style}`
      const parsed = parseRegisteredMermaid(source), base = parseRegisteredMermaid('erDiagram\nA')
      if (!parsed.ok || !base.ok) throw new Error('fixture rejected')
      let edited = mutate(base.value, placement === 'inline' ? { kind: 'set_entity_style', entity: 'A', style } : { kind: 'define_class', name: 'c', style })
      expect(edited.ok).toBe(true)
      if (!edited.ok) throw new Error(edited.error.message)
      if (placement === 'class') edited = mutate(edited.value, { kind: 'set_entity_class', entity: 'A', className: 'c' })
      if (!edited.ok) throw new Error(edited.error.message)
      const written = serializeMermaid(edited.value)
      const mermaid = await upstream.project(written, diagram => ({
        styles: [...diagram.db.getEntities().values(), ...diagram.db.getClasses().values()]
          .flatMap((holder: { cssStyles?: string[]; styles?: string[] }) => holder.cssStyles ?? holder.styles ?? [])
          .map((value: string) => {
            const text = document.createElement('textarea')
            text.innerHTML = value.replace(/ﬂ°°/g, '&#').replace(/ﬂ°/g, '&').replace(/¶ß/g, ';')
            return text.value
          }),
        entities: [...diagram.db.getEntities().values()].map((entity: { label: string; cssClasses: string }) => ({ id: entity.label, classes: entity.cssClasses })),
      }))
      expect(mermaid).toEqual({ ok: true, value: { styles: Object.entries(props).map(([key, value]) => `${key}:${value}`), entities: [{ id: 'A', classes: placement === 'inline' ? 'default' : 'default c' }] } })
      const reparsed = parseRegisteredMermaid(written)
      expect(reparsed.ok && reparsed.value.body).toEqual(edited.value.body)
      expect(reparsed.ok && reparsed.value.body).toEqual(parsed.value.body)
      const native = parseErDiagram(normalizeMermaidSource(written).familyLines)
      expect(placement === 'inline' ? native.entities[0]!.inlineStyle : native.classDefs.get('c')).toEqual(props)
      expect(renderMermaidSVG(written)).toBe(renderMermaidSVG(source))
      expect(verifyMermaid(written).warnings.filter(warning => warning.code === 'UNSUPPORTED_SYNTAX')).toEqual([])
    }
  })

  test('style fields survive both global prepass rules without turning escaped text into grammar', async () => {
    const base = parseRegisteredMermaid('erDiagram\nAclassDef')
    if (!base.ok || base.value.body.kind !== 'er') throw new Error('fixture rejected')
    const props = { '|': 's', content: 'style classDef: {|}~ #35; ﬂ°°32¶ß 🛰️', 'font-family': 'Noto; Sans, Aux', stroke: '#333' }
    const created = synthesizeFromGraph({ kind: 'er', body: { ...base.value.body, entities: [{ ...base.value.body.entities[0]!, style: props, className: 'mystyle' }], classDefs: { mystyle: props } } })
    expect(created.ok).toBe(true)
    if (!created.ok) throw new Error(JSON.stringify(created.error))
    const written = serializeMermaid(created.value)
    const projected = await upstream.project(written, diagram => {
      const read = (styles: string[]) => styles.map(value => {
        const text = document.createElement('textarea')
        text.innerHTML = value.replace(/ﬂ°°/g, '&#').replace(/ﬂ°/g, '&').replace(/¶ß/g, ';')
        return text.value
      })
      const entity = [...diagram.db.getEntities().values()][0] as { label: string; cssClasses: string; cssStyles: string[] }
      return { id: entity.label, classes: entity.cssClasses, inline: read(entity.cssStyles), shared: read(diagram.db.getClasses().get('mystyle').styles) }
    })
    const styles = Object.entries(props).map(([key, value]) => `${key}:${value}`)
    expect(projected).toEqual({ ok: true, value: { id: 'AclassDef', classes: 'default mystyle', inline: styles, shared: styles } })
    const again = parseRegisteredMermaid(written)
    expect(again.ok && again.value.body).toEqual(created.value.body)
    const native = parseErDiagram(normalizeMermaidSource(written).familyLines)
    expect(native.entities[0]!.inlineStyle).toEqual(props)
    expect(native.classDefs.get('mystyle')).toEqual(props)
  })

  test('an edit holding an XML control or lone surrogate is refused atomically', () => {
    const parsed = parseRegisteredMermaid('erDiagram\n  A')
    if (!parsed.ok) throw new Error('fixture rejected')
    const before = serializeMermaid(parsed.value)
    for (const value of ['\u0000', '\u000b', '\u000c', '\u0080', '\ud800']) {
      const styled = mutate(parsed.value, { kind: 'set_entity_style', entity: 'A', style: `content:A${value}B` })
      expect(styled.ok ? 'accepted' : styled.error.code).toBe('INVALID_OP')
      expect(serializeMermaid(parsed.value)).toBe(before)
    }
    expect(mutate(parsed.value, { kind: 'set_entity_style', entity: 'A', style: 'opacity:0.5' }).ok).toBe(true)
  })
})

describe('typed ER attributes are written as Mermaid reads them', () => {
  // Keys parted by spaces or after the comment, which Mermaid rejects, are
  // written as its comma-parted key list before the comment. A comment that
  // runs across lines is written across them.
  test.each<[string, [string, string, Array<'PK' | 'FK' | 'UK'>, string]]>([
    ['A {\n    int id PK FK\n  }', ['int', 'id', ['PK', 'FK'], '']],
    ['A { int id "c" PK }', ['int', 'id', ['PK'], 'c']],
    ['A {\n    int id pk fk "c"\n  }', ['int', 'id', ['PK', 'FK'], 'c']],
    ['A {\n    int id "line1\n    line2"\n  }', ['int', 'id', [], 'line1\nline2']],
    ['A { int id PK "a }\n    b" } B', ['int', 'id', ['PK'], 'a }\nb']],
    ['A { string `geo.accuracy` PK "the comment" }', ['string', 'geo.accuracy', ['PK'], 'the comment']],
    ['A { `my.type` address }', ['my.type', 'address', [], '']],
    ['A { `my.type`? `geo.accuracy` UK "literal `ticks`" }', ['my.type?', 'geo.accuracy', ['UK'], 'literal `ticks`']],
    ['A { string `geo}accuracy` PK "literal `ticks` }" }', ['string', 'geo}accuracy', ['PK'], 'literal `ticks` }']],
    ['A { `my}type`? `geo{accuracy` UK "literal `ticks` }" }', ['my}type?', 'geo{accuracy', ['UK'], 'literal `ticks` }']],
  ])('%j', async (body, expected) => {
    const parsed = parseRegisteredMermaid(`erDiagram\n  ${body}`)
    if (!parsed.ok) throw new Error('fixture rejected')
    const source = serializeMermaid(parsed.value)
    const nativeAttributes = parseErDiagram(normalizeMermaidSource(source).familyLines).entities
      .flatMap(entity => entity.attributes.map(attribute => [attribute.type, attribute.name, attribute.keys, attribute.comment ?? '']))
    expect(nativeAttributes).toEqual([expected])
    const json = await upstream.database(source)
    const attributes = json === undefined ? 'rejected' : (JSON.parse(json) as { getEntities: Array<[string, { attributes: Plain[] }]> }).getEntities
      .flatMap(([, entity]) => entity.attributes.map(attribute => [attribute.type, attribute.name, attribute.keys, attribute.comment]))
    expect({ source, attributes }).toEqual({ source, attributes: [expected] })
  })

  test('quoted attribute braces remain text through mutation, export and both projections', async () => {
    const parsed = parseRegisteredMermaid('erDiagram\n  A\n  B')
    if (!parsed.ok) throw new Error('fixture rejected')
    const added = mutate(parsed.value, { kind: 'add_attribute', entity: 'A', text: '`my}type`? `geo{accuracy` UK "literal `ticks` }"' })
    expect(added.ok).toBe(true)
    if (!added.ok) throw new Error('quoted attribute refused')
    const following = mutate(added.value, { kind: 'add_attribute', entity: 'A', text: 'int next PK' })
    if (!following.ok) throw new Error('following attribute refused')
    const source = serializeMermaid(following.value)
    const expected = [
      { id: 'A', attributes: [{ type: 'my}type?', name: 'geo{accuracy', keys: ['UK' as const], comment: 'literal `ticks` }' }, { type: 'int', name: 'next', keys: ['PK' as const], comment: '' }] },
      { id: 'B', attributes: [] },
    ]
    const read = (text: string) => parseErDiagram(normalizeMermaidSource(text).familyLines).entities.map(entity => ({
      id: entity.id, attributes: entity.attributes.map(attribute => ({ ...attribute, comment: attribute.comment ?? '' })),
    }))
    expect(read(source)).toEqual(expected)
    const reopened = parseRegisteredMermaid(source)
    if (!reopened.ok) throw new Error('export rejected')
    expect(read(serializeMermaid(reopened.value))).toEqual(expected)
    expect(await upstream.project(source, diagram => [...diagram.db.getEntities()].map(([id, entity]) => ({ id, attributes: entity.attributes })))).toEqual({ ok: true, value: expected })
    const svg = renderMermaidSVG(following.value), terminal = renderMermaidASCII(source, { colorMode: 'none' })
    for (const text of ['my}type?', 'geo{accuracy', 'literal `ticks` }', 'next']) {
      expect(svg).toContain(`>${escapeXml(text)}</text>`)
      expect(terminal).toContain(text)
    }
  })
})

describe('typed ER names are written as Mermaid reads them', () => {
  // Mermaid's lexer reads these bare names as a keyword, a cardinality, a
  // link marker or a number first; written quoted, each is one name.
  test.each(['end', 'one', 'u-turn', '2px', '1.2.3', '1.x', '1', '10', '1.5'])('%j', async id => {
    const parsed = parseRegisteredMermaid('erDiagram\n  A')
    if (!parsed.ok) throw new Error('fixture rejected')
    const added = mutate(parsed.value, { kind: 'add_entity', id })
    if (!added.ok) throw new Error(`add_entity refused ${JSON.stringify(id)}`)
    const source = serializeMermaid(added.value)
    const expected: ErReading = { entities: [['A'], [id]], relations: [] }
    expect({ source, mermaid: await mermaidReads(source) }).toEqual({ source, mermaid: expected })
    expect({ source, ours: oursReads(source) }).toEqual({ source, ours: expected })
  })

  test('a numeric entity before another declaration stays an identity, including after an empty block', async () => {
    const source = 'erDiagram\nu{}1\nR'
    const parsed = parseRegisteredMermaid(source)
    if (!parsed.ok) throw new Error('fixture rejected')
    const written = serializeMermaid(parsed.value)
    const expected: ErReading = { entities: [['u'], ['1'], ['R']], relations: [] }
    expect(oursReads(source)).toEqual(expected)
    expect(written).toBe('erDiagram\n  u\n  "1"\n  R\n')
    expect(await mermaidReads(written)).toEqual(expected)
    expect(verifyMermaid(source).warnings).toContainEqual(expect.objectContaining({ code: 'UNSUPPORTED_SYNTAX', syntax: 'er_numeric_name', line: 2 }))
  })

  // A `style` line reads its id as style text, where a keyword or number is
  // bare; a `class` line cannot name one, so the class goes on the entity.
  test.each(['end', 'one', '2px'])('%j keeps its class and style', async id => {
    const parsed = parseRegisteredMermaid(`erDiagram\n  "${id}":::foo\n  classDef foo fill:#f00\n  style ${id} stroke:#0f0`)
    if (!parsed.ok) throw new Error('fixture rejected')
    const source = serializeMermaid(parsed.value)
    const json = await upstream.database(source)
    const entities = json === undefined ? 'rejected' : (JSON.parse(json) as { getEntities: Array<[string, { cssClasses: string; cssStyles: string[] }]> }).getEntities
      .map(([key, entity]) => [key, entity.cssClasses, entity.cssStyles])
    expect({ source, entities }).toEqual({ source, entities: [[id, 'default foo', ['stroke:#0f0']]] })
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
    const visibleText = [...svg.matchAll(/<text\b[^>]*>([\s\S]*?)<\/text>/g)].map(match => match[1]!.replace(/<[^>]+>/g, ''))
    expect({ declaration, inSvg: visibleText.includes(escapeXml(drawn)) }).toEqual({ declaration, inSvg: true })
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

  test.each([
    ['#lt;b#gt;x#lt;/b#gt;', '<b>x</b>'],
    ['#42;x#42;', '*x*'],
    ['#lt;br#gt;', '<br>'],
  ])('an unrelated edit preserves literal %s in aliases, labels and titles', async (authored, visible) => {
    const source = `erDiagram\n  subgraph G ["${authored}"]\n  A["${authored}"]\n  A ||--o{ B : "${authored}"\n  end`
    const parsed = parseRegisteredMermaid(source)
    if (!parsed.ok) throw new Error('fixture rejected')
    const edited = mutate(parsed.value, { kind: 'add_entity', id: 'C' })
    if (!edited.ok) throw new Error('edit refused')
    const written = serializeMermaid(edited.value)
    expect(await upstream.accepts(written)).toBe(true)
    for (const candidate of [source, written]) {
      const reread = parseRegisteredMermaid(candidate)
      const body = reread.ok && asEr(reread.value)?.body
      if (!body) throw new Error('structured ER required')
      expect([body.entities[0]?.label, body.relations[0]?.label, body.groups?.[0]?.label]).toEqual([visible, visible, visible])
      expect(renderMermaidSVG(candidate)).toContain(escapeXml(visible))
      expect(renderMermaidASCII(candidate)).toContain(visible)
    }
    const reread = parseRegisteredMermaid(written)
    if (!reread.ok) throw new Error('writer rejected')
    expect(serializeMermaid(reread.value)).toBe(written)
  })

  test.each([
    ['#lt;br#gt;', '<br>', ['<br>']],
    ['_word_', '_word_', ['_word_']],
    ['_word_ #9829;', '_word_ ♥', ['_word_ ♥']],
    ['_word_ #lt;i#gt;tag#lt;/i#gt; #92;n', String.raw`_word_ <i>tag</i> \n`, [String.raw`_word_ <i>tag</i> \n`]],
    ['_word_<br/>next #9829;', '_word_ next ♥', ['_word_', 'next ♥']],
  ] as const)('attribute comment %s retains its literal reading through edits, metrics and outputs', async (authored, visible, terminalParts) => {
    const source = `erDiagram\n  A {\n    string value "${authored}"\n  }`
    const parsed = parseRegisteredMermaid(source)
    if (!parsed.ok) throw new Error('comment fixture rejected')
    const edited = mutate(parsed.value, { kind: 'add_entity', id: 'B' })
    if (!edited.ok) throw new Error('edit refused')
    const written = serializeMermaid(edited.value)
    const reread = parseRegisteredMermaid(written)
    if (!reread.ok) throw new Error('written comment rejected')
    expect(describeMermaidFacts(reread.value)).toEqual(describeMermaidFacts(edited.value))
    expect(serializeMermaid(reread.value)).toBe(written)
    for (const candidate of [source, written]) {
      const attribute = parseErDiagram(normalizeMermaidSource(candidate).familyLines).entities[0]!.attributes[0]!
      expect(erAttributeBlocks(attribute).comment?.text).toBe(visible)
      expect(renderMermaidSVG(candidate)).toContain(escapeXml(visible))
      // SVG keeps comments in one row; terminal preserves authored breaks.
      const terminal = renderMermaidASCII(candidate)
      for (const part of terminalParts) expect(terminal).toContain(part)
    }
    expect(await upstream.accepts(written)).toBe(true)
  })

  test('same-value ER labels keep literal runs beside markdown and changed labels acquire their own meaning', async () => {
    const source = 'erDiagram\n A["**real** #42;literal#42; #lt;b#gt;tag#lt;/b#gt;"]'
    const parsed = parseRegisteredMermaid(source)
    if (!parsed.ok) throw new Error('fixture rejected')
    const label = asEr(parsed.value)?.body.entities[0]?.label
    if (!label) throw new Error('missing alias')
    const same = mutate(parsed.value, { kind: 'set_entity_label', entity: 'A', label })
    if (!same.ok) throw new Error('same-value edit refused')
    const written = serializeMermaid(same.value)
    expect(await upstream.accepts(written)).toBe(true)
    expect(renderMermaidASCII(written)).toContain('real *literal* <b>tag</b>')
    expect(renderMermaidSVG(written)).toContain('&lt;b&gt;tag&lt;/b&gt;')
    const changed = mutate(same.value, { kind: 'set_entity_label', entity: 'A', label: '**changed** literal #quot;' })
    if (!changed.ok) throw new Error('changed-label edit refused')
    const changedSource = serializeMermaid(changed.value)
    expect(await upstream.accepts(changedSource)).toBe(true)
    const reparsed = parseRegisteredMermaid(changedSource)
    expect(reparsed.ok && asEr(reparsed.value)?.body.entities[0]?.label).toBe('**changed** literal #quot;')
    expect(renderMermaidASCII(changedSource)).toContain('changed literal #quot;')
  })
})
