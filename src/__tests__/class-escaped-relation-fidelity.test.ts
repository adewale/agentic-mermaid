import { afterAll, describe, expect, test } from 'bun:test'
import { asClass, mutate, parseRegisteredMermaid, serializeMermaid, verifyMermaid } from '../agent/index.ts'
import { parseClassDiagram, parseClassRelationship } from '../class/parser.ts'
import { renderMermaidSVG } from '../index.ts'
import { expectNearLinearGrowth } from './helpers/complexity.ts'
import { startUpstreamMermaid } from './helpers/upstream-mermaid.ts'

const upstream = startUpstreamMermaid()
afterAll(() => upstream.close())

/** Each statement's first relation endpoints under pinned Mermaid; null when
 * it has no relation or Mermaid rejects it. */
/** Each statement's first relation under pinned Mermaid, which must accept it. */
const upstreamLinks = (statements: readonly string[]) => upstream.projectAll(statements.map(statement => `classDiagram\n${statement}`), diagram => {
  const relation = diagram.db.getRelations()[0]
  return { from: relation?.id1, to: relation?.id2, lineType: relation?.relation.lineType }
})

const upstreamEndpoints = async (statements: readonly string[]) =>
  (await upstream.projectEach(statements.map(statement => `classDiagram\n${statement}`), diagram => {
    const relation = diagram.db.getRelations()[0]
    return relation ? { from: relation.id1, to: relation.id2 } : null
  })).map(reply => reply.ok ? reply.value : null)

const cases = [
  { statement: '`A B` --> C', from: 'A B', to: 'C', kind: 'association', lineType: 0, type1: 'none', type2: 3 },
  { statement: '`A B` ..> C', from: 'A B', to: 'C', kind: 'dependency', lineType: 1, type1: 'none', type2: 3 },
  { statement: 'A <|-- `B C`', from: 'A', to: 'B C', kind: 'inheritance', lineType: 0, type1: 1, type2: 'none' },
  { statement: '`A B` --> `C D`', from: 'A B', to: 'C D', kind: 'association', lineType: 0, type1: 'none', type2: 3 },
  { statement: '`A B`-->C', from: 'A B', to: 'C', kind: 'association', lineType: 0, type1: 'none', type2: 3 },
  { statement: 'A-->`C D`', from: 'A', to: 'C D', kind: 'association', lineType: 0, type1: 'none', type2: 3 },
  { statement: '`A B` "1" --> "*" `C D` : Link', from: 'A B', to: 'C D', kind: 'association', lineType: 0, type1: 'none', type2: 3, fromCardinality: '1', toCardinality: '*', label: 'Link' },
] as const

describe('Class escaped relationship IDs', () => {
  test('compact ordinary marked links share native and agent semantics', async () => {
    const compact = [
      { statement: 'A-->B', from: 'A', to: 'B', kind: 'association' },
      { statement: 'Foo-->B', from: 'Foo', to: 'B', kind: 'association' },
      { statement: 'Foo--|>B', from: 'Foo', to: 'B', kind: 'inheritance' },
      { statement: 'Foo--*B', from: 'Foo', to: 'B', kind: 'composition' },
      { statement: 'Foo--o B', from: 'Foo', to: 'B', kind: 'aggregation' },
      { statement: 'A o--out', from: 'A', to: 'out', kind: 'aggregation' },
      { statement: 'A o--oB', from: 'A', to: 'oB', kind: 'aggregation' },
      { statement: 'Ao--B', from: 'Ao', to: 'B', kind: 'link-solid' },
      { statement: 'Foo--oB', from: 'Foo', to: 'oB', kind: 'link-solid' },
    ] as const
    expect(await upstreamLinks(compact.map(item => item.statement))).toEqual(compact.map(item => ({
      from: item.from, to: item.to, lineType: 0,
    })))
    for (const item of compact) {
      const source = `classDiagram\n${item.statement}`
      expect(parseClassRelationship(item.statement)).toEqual(expect.objectContaining({ from: item.from, to: item.to, type: item.kind }))
      expect(parseClassDiagram(source.split('\n')).relationships).toHaveLength(1)
      const parsed = parseRegisteredMermaid(source)
      expect(parsed.ok).toBe(true)
      if (!parsed.ok) continue
      expect(asClass(parsed.value)?.body.relations).toEqual([expect.objectContaining({ from: item.from, to: item.to, kind: item.kind })])
      expect(verifyMermaid(parsed.value).ok).toBe(true)
      expect(renderMermaidSVG(source)).toContain(`data-from="${item.from}" data-to="${item.to}"`)
    }
  })

  test('2,592 ordinary endpoint/operator/asymmetric-spacing variants keep pinned identity', async () => {
    const ids = ['A', 'Ao', 'Foo', 'Zoo', 'Oo', 'AB', 'B', 'oB']
    const arrows = ['-->', '--|>', '--*', '--o', 'o--', '*--', '<|--', '<--', '..>', '..|>', '--', '..']
    const spaces = ['', ' ', '  ']
    const statements = ids.flatMap(from => ['B', 'oB', 'out'].flatMap(to => arrows.flatMap(arrow => spaces.flatMap(before => spaces.map(after => `${from}${before}${arrow}${after}${to}`)))))
    expect(statements).toHaveLength(2_592)
    const upstreamRelations = await upstreamEndpoints(statements)
    expect(statements.map(statement => {
      const relation = parseClassRelationship(statement)
      return relation ? { from: relation.from, to: relation.to } : null
    })).toEqual(upstreamRelations)
  })

  test('pinned Mermaid 11.16 retains space-bearing endpoint identity and arrow meaning', async () => {
    const relations: Array<Record<string, unknown>> = await upstream.projectAll(cases.map(item => `classDiagram\n${item.statement}`), diagram => {
      const relation = diagram.db.getRelations()[0]
      return { classes: [...diagram.db.getClasses().keys()], from: relation?.id1, to: relation?.id2,
        lineType: relation?.relation.lineType, type1: relation?.relation.type1, type2: relation?.relation.type2,
        relationTitle1: relation?.relationTitle1, relationTitle2: relation?.relationTitle2, title: relation?.title }
    })
    expect(relations).toEqual(cases.map(item => ({
      classes: [item.from, item.to], from: item.from, to: item.to,
      lineType: item.lineType, type1: item.type1, type2: item.type2,
      relationTitle1: 'fromCardinality' in item ? item.fromCardinality : 'none',
      relationTitle2: 'toCardinality' in item ? item.toCardinality : 'none',
      ...('label' in item ? { title: item.label } : {}),
    })))
  })

  test('native, agent, verify, SVG, and serialization preserve the same endpoints', () => {
    for (const item of cases) {
      const source = `classDiagram\n${item.statement}`
      const native = parseClassDiagram(source.split('\n'))
      expect(native.classes.map(node => node.id)).toEqual([item.from, item.to])
      expect(native.relationships).toEqual([expect.objectContaining({
        from: item.from, to: item.to, type: item.kind,
        ...('fromCardinality' in item ? { fromCardinality: item.fromCardinality } : {}),
        ...('toCardinality' in item ? { toCardinality: item.toCardinality } : {}),
        ...('label' in item ? { label: item.label } : {}),
      })])

      const parsed = parseRegisteredMermaid(source)
      expect(parsed.ok).toBe(true)
      if (!parsed.ok) continue
      expect(asClass(parsed.value)?.body.relations).toEqual([expect.objectContaining({
        from: item.from, to: item.to, kind: item.kind,
        ...('fromCardinality' in item ? { fromCardinality: item.fromCardinality } : {}),
        ...('toCardinality' in item ? { toCardinality: item.toCardinality } : {}),
        ...('label' in item ? { label: item.label } : {}),
      })])
      expect(verifyMermaid(parsed.value).ok).toBe(true)
      expect(renderMermaidSVG(source)).toContain(`data-from="${item.from}" data-to="${item.to}"`)

      const serialized = serializeMermaid(parsed.value)
      expect(parseClassDiagram(serialized.trim().split('\n').map(line => line.trim())).relationships).toEqual([
        expect.objectContaining({ from: item.from, to: item.to, type: item.kind }),
      ])
    }
  })

  test('1,020 endpoint/operator/spacing variants agree with pinned Mermaid identity', async () => {
    const ids = ['`A B`', '`A.B`', '`A--B`', '`A..B`', '`A$B`', '`A:B`', '`A;B`', 'A', 'B', 'o', '`o`', '`note`', '`click`', '`class`', '`link`', '`style`', '`cssClass`', '`namespace`', '$A']
    const arrows = ['-->', '..>', '<|--', '--|>', 'o--', '--o', '*--', '--*', '<--', '<..']
    const statements = ids.flatMap(from => ['B', '`C D`'].flatMap(to => arrows.flatMap(arrow => ['', ' ', '  '].map(space => `${from}${space}${arrow}${space}${to}`))))
      .filter(statement => statement.includes('`'))
    expect(statements).toHaveLength(1_020)
    const upstreamRelations = await upstreamEndpoints(statements)
    expect(statements.map(statement => {
      const relation = parseClassRelationship(statement)
      return relation ? { from: relation.from, to: relation.to } : null
    })).toEqual(upstreamRelations)
  })

  test('reserved endpoint spellings fail loudly and do not pass verification', async () => {
    const invalid = ['o --> `C D`', '`note` --> B', '$A ..> `C D`', 'A --> `click`']
    expect(await Promise.all(invalid.map(statement => upstream.accepts(`classDiagram\n${statement}`)))).toEqual(invalid.map(() => false))
    for (const statement of invalid) {
      const source = `classDiagram\n${statement}`
      expect(parseClassRelationship(statement)).toBeNull()
      expect(() => parseClassDiagram(source.split('\n'))).toThrow('Unrecognized class relationship statement')
      const parsed = parseRegisteredMermaid(source)
      expect(parsed.ok).toBe(true)
      if (!parsed.ok) continue
      expect(parsed.value.body.kind).toBe('opaque')
      expect(verifyMermaid(parsed.value).ok).toBe(false)
    }
  })

  test('invalid labels are rejected; whitespace-only upstream labels remain diagnosed', () => {
    for (const statement of ['`A B` --> C : a:b', '`A B` --> C : label;', '`A B` --> C : ', '`A` --> B : a:b', '`A` --> B : label;']) {
      const source = `classDiagram\n${statement}`
      expect(parseClassRelationship(statement)).toBeNull()
      expect(() => parseClassDiagram(source.split('\n'))).toThrow('Unrecognized class relationship statement')
      const parsed = parseRegisteredMermaid(source)
      expect(parsed.ok).toBe(true)
      if (!parsed.ok) continue
      expect(parsed.value.body.kind).toBe('opaque')
      expect(verifyMermaid(parsed.value).warnings.map(warning => warning.code)).toEqual(expect.arrayContaining([
        'UNSUPPORTED_SYNTAX', 'RENDER_FAILED',
      ]))
    }
  })

  test('malformed ordinary marked labels cannot re-enter through legacy fallbacks', async () => {
    const invalid = ['A-->B : x:y', 'Foo--*B : label;', 'Foo--|>B : a:b']
    expect(await Promise.all(invalid.map(statement => upstream.accepts(`classDiagram\n${statement}`)))).toEqual(invalid.map(() => false))
    for (const statement of invalid) {
      const source = `classDiagram\n${statement}`
      expect(parseClassRelationship(statement)).toBeNull()
      expect(() => parseClassDiagram(source.split('\n'))).toThrow('Unrecognized class relationship statement')
      const parsed = parseRegisteredMermaid(source)
      expect(parsed.ok).toBe(true)
      if (!parsed.ok) continue
      expect(parsed.value.body.kind).toBe('opaque')
      expect(verifyMermaid(parsed.value).ok).toBe(false)
    }
  })

  test('backticks confined to labels or cardinalities do not suppress ordinary links', async () => {
    const valid = [
      'A --> B : `label`',
      'A "`one`" --> B',
      'A --> "`many`" B',
    ]
    expect(await upstreamEndpoints(valid)).toEqual(valid.map(() => ({ from: 'A', to: 'B' })))
    for (const statement of valid) {
      expect(parseClassRelationship(statement)).toEqual(expect.objectContaining({ from: 'A', to: 'B' }))
      expect(parseClassDiagram(['classDiagram', statement]).relationships).toHaveLength(1)
      const parsed = parseRegisteredMermaid(`classDiagram\n${statement}`)
      expect(parsed.ok).toBe(true)
      if (parsed.ok) expect(asClass(parsed.value)?.body.relations).toHaveLength(1)
    }
  })

  test('escaped two-ended/lollipop and tilde identities remain diagnosed until modeled', async () => {
    const diagnosed = [
      '`A B` <|--|> `C D`',
      '`A B` *..* `C D`',
      'A *..* `B`',
      'A o..o `B`',
      '`A B` ()-- C',
      'A --() `C D`',
      '`A~B` --> C',
      '`A~B` -- C',
      '`A~B` .. C',
      'A -- `A~B`',
      'A .. `A~B`',
    ]
    expect(await upstreamLinks(diagnosed)).toEqual([
      { from: 'A B', to: 'C D', lineType: 0 },
      { from: 'A B', to: 'C D', lineType: 1 },
      { from: 'A', to: 'B', lineType: 1 },
      { from: 'A', to: 'B', lineType: 1 },
      { from: 'interface0', to: 'C', lineType: 0 },
      { from: 'A', to: 'interface0', lineType: 0 },
      { from: 'A', to: 'C', lineType: 0 },
      { from: 'A', to: 'C', lineType: 0 },
      { from: 'A', to: 'C', lineType: 1 },
      { from: 'A', to: 'A', lineType: 0 },
      { from: 'A', to: 'A', lineType: 1 },
    ])
    for (const statement of diagnosed) {
      expect(parseClassRelationship(statement)).toBeNull()
      expect(() => parseClassDiagram(['classDiagram', statement])).toThrow('Unrecognized class relationship statement')
      const parsed = parseRegisteredMermaid(`classDiagram\n${statement}`)
      expect(parsed.ok).toBe(true)
      if (!parsed.ok) continue
      expect(parsed.value.body.kind).toBe('opaque')
      expect(verifyMermaid(parsed.value).ok).toBe(false)
    }
  })

  test('escaped endpoint mutation preserves identity and unrelated relations', () => {
    const parsed = parseRegisteredMermaid('classDiagram\n`A B` --> C\nC .. D')
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    const renamed = mutate(parsed.value, { kind: 'rename_class', from: 'C', to: 'Branch' })
    expect(renamed.ok).toBe(true)
    if (!renamed.ok) return
    expect(parseClassDiagram(serializeMermaid(renamed.value).trim().split('\n').map(line => line.trim())).relationships).toEqual([
      expect.objectContaining({ from: 'A B', to: 'Branch', type: 'association' }),
      expect.objectContaining({ from: 'Branch', to: 'D', type: 'link-dashed' }),
    ])
  })

  test('long malformed marked links remain bounded', () => {
    expectNearLinearGrowth('long malformed marked link', size => {
      expect(parseClassRelationship(`A${'-->'.repeat(size)} \`B C\``)).toBeNull()
    }, 20_000)
  })

  test('a reserved-word escaped endpoint draws one directed relationship between both classes', () => {
    const svg = renderMermaidSVG('classDiagram\n`class A` --> B')
    const relations = svg.match(/<(?:path|polyline) class="class-relationship"[^>]*>/g) ?? []
    expect(relations).toHaveLength(1)
    expect(relations[0]).toContain('data-from="class A" data-to="B" data-type="association"')
    expect(relations[0]).toContain('marker-end="url(#cls-arrow)"')
  })
})
