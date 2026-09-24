import { describe, expect, test } from 'bun:test'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { asClass, mutate, parseRegisteredMermaid, serializeMermaid, verifyMermaid } from '../agent/index.ts'
import { renderMermaidPNG } from '../agent/png.ts'
import { parseClassDiagram, parseClassRelationship } from '../class/parser.ts'
import { renderMermaidSVG } from '../index.ts'

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
  test('pinned Mermaid 11.16 retains space-bearing endpoint identity and arrow meaning', () => {
    const probe = Bun.spawnSync({
      cmd: [process.execPath, '-e', `
        import DOMPurify from 'dompurify'
        DOMPurify.addHook = () => {}
        DOMPurify.sanitize = text => text
        const { default: mermaid } = await import('mermaid')
        mermaid.initialize({ startOnLoad: false })
        const result = []
        for (const statement of ${JSON.stringify(cases.map(item => item.statement))}) {
          const diagram = await mermaid.mermaidAPI.getDiagramFromText('classDiagram\\n' + statement)
          const relation = diagram.db.getRelations()[0]
          result.push({ classes: [...diagram.db.getClasses().keys()], from: relation?.id1, to: relation?.id2,
            lineType: relation?.relation.lineType, type1: relation?.relation.type1, type2: relation?.relation.type2,
            relationTitle1: relation?.relationTitle1, relationTitle2: relation?.relationTitle2, title: relation?.title })
        }
        process.stdout.write(JSON.stringify(result))
      `],
      cwd: process.cwd(), stdout: 'pipe', stderr: 'pipe',
    })
    expect(probe.exitCode).toBe(0)
    expect(JSON.parse(new TextDecoder().decode(probe.stdout))).toEqual(cases.map(item => ({
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

  test('1,020 endpoint/operator/spacing variants agree with pinned Mermaid identity', () => {
    const ids = ['`A B`', '`A.B`', '`A--B`', '`A..B`', '`A$B`', '`A:B`', '`A;B`', 'A', 'B', 'o', '`o`', '`note`', '`click`', '`class`', '`link`', '`style`', '`cssClass`', '`namespace`', '$A']
    const arrows = ['-->', '..>', '<|--', '--|>', 'o--', '--o', '*--', '--*', '<--', '<..']
    const statements = ids.flatMap(from => ['B', '`C D`'].flatMap(to => arrows.flatMap(arrow => ['', ' ', '  '].map(space => `${from}${space}${arrow}${space}${to}`))))
      .filter(statement => statement.includes('`'))
    expect(statements).toHaveLength(1_020)
    const probe = Bun.spawnSync({
      cmd: [process.execPath, '-e', `
        import DOMPurify from 'dompurify'
        DOMPurify.addHook = () => {}
        DOMPurify.sanitize = text => text
        const { default: mermaid } = await import('mermaid')
        mermaid.initialize({ startOnLoad: false })
        const result = []
        for (const statement of ${JSON.stringify(statements)}) {
          try {
            const diagram = await mermaid.mermaidAPI.getDiagramFromText('classDiagram\\n' + statement)
            const relation = diagram.db.getRelations()[0]
            result.push(relation ? { from: relation.id1, to: relation.id2 } : null)
          } catch { result.push(null) }
        }
        process.stdout.write(JSON.stringify(result))
      `],
      cwd: process.cwd(), stdout: 'pipe', stderr: 'pipe',
    })
    expect(probe.exitCode).toBe(0)
    const upstream = JSON.parse(new TextDecoder().decode(probe.stdout)) as Array<{ from: string; to: string } | null>
    expect(statements.map(statement => {
      const relation = parseClassRelationship(statement)
      return relation ? { from: relation.from, to: relation.to } : null
    })).toEqual(upstream)
  })

  test('reserved endpoint spellings fail loudly and do not pass verification', () => {
    const invalid = ['o --> `C D`', '`note` --> B', '$A ..> `C D`', 'A --> `click`']
    const probe = Bun.spawnSync({
      cmd: [process.execPath, '-e', `
        import DOMPurify from 'dompurify'
        DOMPurify.addHook = () => {}
        DOMPurify.sanitize = text => text
        const { default: mermaid } = await import('mermaid')
        mermaid.initialize({ startOnLoad: false })
        const result = []
        for (const statement of ${JSON.stringify(invalid)}) {
          try { await mermaid.mermaidAPI.getDiagramFromText('classDiagram\\n' + statement); result.push('accepted') }
          catch { result.push('rejected') }
        }
        process.stdout.write(JSON.stringify(result))
      `],
      cwd: process.cwd(), stdout: 'pipe', stderr: 'pipe',
    })
    expect(probe.exitCode).toBe(0)
    expect(JSON.parse(new TextDecoder().decode(probe.stdout))).toEqual(invalid.map(() => 'rejected'))
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

  test('backticks confined to labels or cardinalities do not suppress ordinary links', () => {
    const valid = [
      'A --> B : `label`',
      'A "`one`" --> B',
      'A --> "`many`" B',
    ]
    const probe = Bun.spawnSync({
      cmd: [process.execPath, '-e', `
        import DOMPurify from 'dompurify'
        DOMPurify.addHook = () => {}
        DOMPurify.sanitize = text => text
        const { default: mermaid } = await import('mermaid')
        mermaid.initialize({ startOnLoad: false })
        const result = []
        for (const statement of ${JSON.stringify(valid)}) {
          try { const diagram = await mermaid.mermaidAPI.getDiagramFromText('classDiagram\\n' + statement)
            result.push({ from: diagram.db.getRelations()[0]?.id1, to: diagram.db.getRelations()[0]?.id2 }) }
          catch { result.push(null) }
        }
        process.stdout.write(JSON.stringify(result))
      `],
      cwd: process.cwd(), stdout: 'pipe', stderr: 'pipe',
    })
    expect(probe.exitCode).toBe(0)
    expect(JSON.parse(new TextDecoder().decode(probe.stdout))).toEqual(valid.map(() => ({ from: 'A', to: 'B' })))
    for (const statement of valid) {
      expect(parseClassRelationship(statement)).toEqual(expect.objectContaining({ from: 'A', to: 'B' }))
      expect(parseClassDiagram(['classDiagram', statement]).relationships).toHaveLength(1)
      const parsed = parseRegisteredMermaid(`classDiagram\n${statement}`)
      expect(parsed.ok).toBe(true)
      if (parsed.ok) expect(asClass(parsed.value)?.body.relations).toHaveLength(1)
    }
  })

  test('escaped two-ended/lollipop and tilde identities remain diagnosed until modeled', () => {
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
    const probe = Bun.spawnSync({
      cmd: [process.execPath, '-e', `
        import DOMPurify from 'dompurify'
        DOMPurify.addHook = () => {}
        DOMPurify.sanitize = text => text
        const { default: mermaid } = await import('mermaid')
        mermaid.initialize({ startOnLoad: false })
        const result = []
        for (const statement of ${JSON.stringify(diagnosed)}) {
          const diagram = await mermaid.mermaidAPI.getDiagramFromText('classDiagram\\n' + statement)
          const relation = diagram.db.getRelations()[0]
          result.push({ from: relation?.id1, to: relation?.id2, lineType: relation?.relation.lineType })
        }
        process.stdout.write(JSON.stringify(result))
      `],
      cwd: process.cwd(), stdout: 'pipe', stderr: 'pipe',
    })
    expect(probe.exitCode).toBe(0)
    expect(JSON.parse(new TextDecoder().decode(probe.stdout))).toEqual([
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
    const malformed = `A${'-->'.repeat(20_000)} \`B C\``
    const start = performance.now()
    expect(parseClassRelationship(malformed)).toBeNull()
    expect(performance.now() - start).toBeLessThan(500)
  })

  test('before/after visual assets are authentic same-source production output', () => {
    const source = 'classDiagram\n`class A` --> B'
    const before = readFileSync(new URL('../../docs/pr-assets/issue-248-class-escaped-relation-before.svg', import.meta.url), 'utf8')
    const after = readFileSync(new URL('../../docs/pr-assets/issue-248-class-escaped-relation-after.svg', import.meta.url), 'utf8')
    const png = readFileSync(new URL('../../docs/pr-assets/issue-248-class-escaped-relation-after.png', import.meta.url))
    expect(createHash('sha256').update(before).digest('hex')).toBe('1d3844675611dce1ba9968c146bd75141ad722356eda6285a6951839b8835582')
    expect(before).toContain('width="0" height="0"')
    expect(before).not.toContain('class="class-relationship"')
    expect(after).toBe(renderMermaidSVG(source))
    expect(png.equals(Buffer.from(renderMermaidPNG(source, { scale: 2 })))).toBe(true)
  })
})
