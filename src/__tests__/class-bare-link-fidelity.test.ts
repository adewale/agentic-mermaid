import { describe, expect, test } from 'bun:test'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { asClass, mutate, parseRegisteredMermaid, serializeMermaid, verifyMermaid } from '../agent/index.ts'
import { renderMermaidPNG } from '../agent/png.ts'
import { renderMermaidASCII } from '../ascii/index.ts'
import { parseClassDiagram, parseClassRelationship } from '../class/parser.ts'
import { renderMermaidSVG } from '../index.ts'

const cases = [
  { statement: 'classO .. classP : Link(Dashed)', kind: 'link-dashed', lineType: 1, label: 'Link(Dashed)' },
  { statement: 'A..B', kind: 'link-dashed', lineType: 1 },
  { statement: 'A ..B', kind: 'link-dashed', lineType: 1 },
  { statement: 'A.. B', kind: 'link-dashed', lineType: 1 },
  { statement: 'A -- B', kind: 'link-solid', lineType: 0 },
  { statement: 'A--B', kind: 'link-solid', lineType: 0 },
  { statement: 'A .. B %% comment', kind: 'link-dashed', lineType: 1 },
  { statement: 'A -- B %% comment', kind: 'link-solid', lineType: 0 },
  { statement: 'A .. B : dashed %% note', kind: 'link-dashed', lineType: 1, label: 'dashed %% note' },
  { statement: 'A"1".."*"B : dashed', kind: 'link-dashed', lineType: 1, label: 'dashed', fromCardinality: '1', toCardinality: '*' },
  { statement: 'A"1"..B', kind: 'link-dashed', lineType: 1, fromCardinality: '1' },
  { statement: 'A.."*"B', kind: 'link-dashed', lineType: 1, toCardinality: '*' },
] as const

describe('Class markerless link fidelity', () => {
  test('pinned Mermaid 11.16 gives both bare links two endpoints and no markers', () => {
    const script = `
      import DOMPurify from 'dompurify'
      DOMPurify.addHook = () => {}
      DOMPurify.sanitize = text => text
      const { default: mermaid } = await import('mermaid')
      mermaid.initialize({ startOnLoad: false })
      const statements = ${JSON.stringify(cases.map(item => item.statement))}
      const result = []
      for (const statement of statements) {
        const diagram = await mermaid.mermaidAPI.getDiagramFromText('classDiagram\\n' + statement)
        const relation = diagram.db.getRelations()[0]
        result.push({ classes: [...diagram.db.getClasses().keys()], from: relation?.id1, to: relation?.id2,
          lineType: relation?.relation.lineType, type1: relation?.relation.type1, type2: relation?.relation.type2,
          title: relation?.title, relationTitle1: relation?.relationTitle1, relationTitle2: relation?.relationTitle2 })
      }
      process.stdout.write(JSON.stringify(result))
    `
    const probe = Bun.spawnSync({ cmd: [process.execPath, '-e', script], cwd: process.cwd(), stdout: 'pipe', stderr: 'pipe' })
    expect(probe.exitCode).toBe(0)
    const upstream = JSON.parse(new TextDecoder().decode(probe.stdout)) as Array<Record<string, unknown>>
    expect(upstream).toEqual(cases.map(item => ({
      classes: item.statement.startsWith('classO') ? ['classO', 'classP'] : ['A', 'B'],
      from: item.statement.startsWith('classO') ? 'classO' : 'A',
      to: item.statement.startsWith('classO') ? 'classP' : 'B',
      lineType: item.lineType,
      type1: 'none',
      type2: 'none',
      relationTitle1: 'fromCardinality' in item ? item.fromCardinality : 'none',
      relationTitle2: 'toCardinality' in item ? item.toCardinality : 'none',
      ...('label' in item ? { title: item.label } : {}),
    })))
  })

  test('native, agent, verify, and SVG retain markerless identity and line style', () => {
    for (const item of cases) {
      const source = `classDiagram\n${item.statement}`
      const from = item.statement.startsWith('classO') ? 'classO' : 'A'
      const to = item.statement.startsWith('classO') ? 'classP' : 'B'
      const native = parseClassDiagram(source.split('\n'))
      expect(native.classes.map(node => node.id)).toEqual([from, to])
      expect(native.relationships).toEqual([expect.objectContaining({
        from, to, type: item.kind, markerAt: 'none',
        ...('fromCardinality' in item ? { fromCardinality: item.fromCardinality } : {}),
        ...('toCardinality' in item ? { toCardinality: item.toCardinality } : {}),
      })])

      const parsed = parseRegisteredMermaid(source)
      expect(parsed.ok).toBe(true)
      if (!parsed.ok) continue
      expect(asClass(parsed.value)?.body.relations).toEqual([expect.objectContaining({
        from, to, kind: item.kind,
        ...('fromCardinality' in item ? { fromCardinality: item.fromCardinality } : {}),
        ...('toCardinality' in item ? { toCardinality: item.toCardinality } : {}),
      })])
      const verified = verifyMermaid(parsed.value)
      expect(verified.ok).toBe(true)
      expect(verified.layout?.edges).toHaveLength(1)
      expect(verified.warnings.some(warning => warning.code === 'UNSUPPORTED_SYNTAX' && warning.syntax === 'empty_layout')).toBe(false)

      const svg = renderMermaidSVG(source)
      expect(svg).toContain(`data-from="${from}" data-to="${to}" data-type="${item.kind}"`)
      const relation = svg.match(/<(?:path|polyline) class="class-relationship"[^>]+>/)?.[0]
      expect(relation).toBeDefined()
      expect(relation).not.toContain('marker-start=')
      expect(relation).not.toContain('marker-end=')
      expect(relation?.includes('stroke-dasharray="6 4"')).toBe(item.kind === 'link-dashed')
      if ('label' in item) expect(svg).toContain(`data-label="${item.label}"`)

      const serialized = serializeMermaid(parsed.value)
      expect(parseClassDiagram(serialized.trim().split('\n').map(line => line.trim())).relationships).toEqual([
        expect.objectContaining({ from, to, type: item.kind }),
      ])
    }
  })

  test('cardinalities survive and renaming one endpoint preserves an unrelated arrow', () => {
    const source = 'classDiagram\nA "1" .. "*" B : dashed\nB --> C : directed'
    const parsed = parseRegisteredMermaid(source)
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    const body = asClass(parsed.value)?.body
    expect(body?.relations).toEqual([
      expect.objectContaining({ from: 'A', to: 'B', kind: 'link-dashed', fromCardinality: '1', toCardinality: '*', label: 'dashed' }),
      expect.objectContaining({ from: 'B', to: 'C', kind: 'association', label: 'directed' }),
    ])
    const renamed = mutate(parsed.value, { kind: 'rename_class', from: 'B', to: 'Branch' })
    expect(renamed.ok).toBe(true)
    if (!renamed.ok) return
    const native = parseClassDiagram(serializeMermaid(renamed.value).trim().split('\n').map(line => line.trim()))
    expect(native.relationships).toEqual([
      expect.objectContaining({ from: 'A', to: 'Branch', type: 'link-dashed', fromCardinality: '1', toCardinality: '*', label: 'dashed' }),
      expect.objectContaining({ from: 'Branch', to: 'C', type: 'association', label: 'directed' }),
    ])
  })

  test('terminal output keeps dashed/solid lines markerless', () => {
    const dashed = renderMermaidASCII('classDiagram\nA .. B', { useAscii: true, colorMode: 'none' })
    const solid = renderMermaidASCII('classDiagram\nA -- B', { useAscii: true, colorMode: 'none' })
    expect(dashed).toContain('  :')
    expect(solid).toContain('  |')
    expect(dashed).not.toMatch(/[<>^v]/)
    expect(solid).not.toMatch(/[<>^v]/)
  })

  test('delimiter-looking IDs stay intact and long malformed links finish promptly', () => {
    const source = 'classDiagram\n`A..B` .. C'
    const native = parseClassDiagram(source.split('\n'))
    expect(native.relationships).toEqual([expect.objectContaining({ from: 'A..B', to: 'C', type: 'link-dashed' })])
    expect(renderMermaidSVG(source)).toContain('data-from="A..B" data-to="C"')

    // Link bytes in an inline member are not a relationship. Mermaid accepts
    // both members; the native fail-loud guard must leave them untouched.
    for (const member of ['A : +String foo--bar', 'A : +foo() .. bar']) {
      const memberSource = `classDiagram\n${member}`
      expect(parseClassDiagram(memberSource.split('\n')).classes.map(node => node.id)).toEqual(['A'])
      expect(parseClassDiagram(memberSource.split('\n')).relationships).toHaveLength(0)
      expect(renderMermaidSVG(memberSource)).toContain('data-id="A"')
    }

    const malformed = `A${'..'.repeat(32_000)} B`
    const start = performance.now()
    expect(parseClassRelationship(malformed)).toBeNull()
    expect(performance.now() - start).toBeLessThan(500)
    const agentStart = performance.now()
    const parsed = parseRegisteredMermaid(`classDiagram\n${malformed}`)
    expect(parsed.ok).toBe(true)
    if (parsed.ok) {
      expect(parsed.value.body.kind).toBe('opaque')
      expect(verifyMermaid(parsed.value).warnings.some(warning => warning.code === 'UNSUPPORTED_SYNTAX')).toBe(true)
    }
    expect(performance.now() - agentStart).toBeLessThan(500)
    expect(parseClassRelationship('A .. B : a:b')).toBeNull()
    const invalidSource = 'classDiagram\nclass A\nclass B\nA .. B : a:b'
    const upstreamReject = Bun.spawnSync({
      cmd: [process.execPath, '-e', `
        import DOMPurify from 'dompurify'
        DOMPurify.addHook = () => {}
        DOMPurify.sanitize = text => text
        const { default: mermaid } = await import('mermaid')
        mermaid.initialize({ startOnLoad: false })
        try { await mermaid.mermaidAPI.getDiagramFromText(${JSON.stringify(invalidSource)}); process.stdout.write('accepted') }
        catch { process.stdout.write('rejected') }
      `],
      cwd: process.cwd(), stdout: 'pipe', stderr: 'pipe',
    })
    expect(upstreamReject.exitCode).toBe(0)
    expect(new TextDecoder().decode(upstreamReject.stdout)).toBe('rejected')
    expect(() => parseClassDiagram(invalidSource.split('\n'))).toThrow('Unrecognized class relationship statement')
    expect(() => renderMermaidSVG(invalidSource)).toThrow('Unrecognized class relationship statement')
    const invalidLabel = parseRegisteredMermaid(invalidSource)
    expect(invalidLabel.ok).toBe(true)
    if (invalidLabel.ok) {
      expect(invalidLabel.value.body.kind).toBe('opaque')
      const result = verifyMermaid(invalidLabel.value)
      expect(result.ok).toBe(false)
      expect(result.warnings.some(warning => warning.code === 'UNSUPPORTED_SYNTAX')).toBe(true)
      expect(result.warnings.some(warning => warning.code === 'RENDER_FAILED')).toBe(true)
    }
  })

  test('before/after visual assets are authentic same-input production output', () => {
    const source = 'classDiagram\nclassO .. classP : Link(Dashed)'
    const before = readFileSync(new URL('../../docs/pr-assets/issue-248-class-bare-link-before.svg', import.meta.url), 'utf8')
    const after = readFileSync(new URL('../../docs/pr-assets/issue-248-class-bare-link-after.svg', import.meta.url), 'utf8')
    const png = readFileSync(new URL('../../docs/pr-assets/issue-248-class-bare-link-after.png', import.meta.url))
    expect(createHash('sha256').update(before).digest('hex')).toBe('1d3844675611dce1ba9968c146bd75141ad722356eda6285a6951839b8835582')
    expect(before).toContain('width="0" height="0"')
    expect(before).not.toContain('class="class-relationship"')
    expect(after).toBe(renderMermaidSVG(source))
    expect(png.equals(Buffer.from(renderMermaidPNG(source, { scale: 2 })))).toBe(true)
  })
})
