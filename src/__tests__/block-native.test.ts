import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import fc from 'fast-check'
import { asBlock, layoutMermaid, mutate, parseRegisteredMermaid as parse, renderMermaidASCII, renderMermaidSVG, serializeMermaid, verifyMermaid } from '../agent/core.ts'
import { layoutBlockDiagram } from '../block/layout.ts'
import { parseBlockDiagram } from '../block/parser.ts'
import { blockDisplayText } from '../block/text.ts'
import type { Block, BlockBody } from '../block/types.ts'
import { fcParameters } from './helpers/fc-parameters.ts'

const cases = JSON.parse(readFileSync(new URL('../../eval/mermaid-block-bench/cases.json', import.meta.url), 'utf8')) as { id: string; source: string; expect: unknown }[]
function semantic(body: BlockBody) {
  const project = (n: Block, path: string): unknown =>
    n.type === 'space'
      ? { type: 'space' }
      : {
          id: n.id.startsWith('block_generated_') ? `anonymous:${path}` : n.id,
          label: n.label ?? '',
          type: n.type === 'na' ? 'square' : n.type,
          columns: n.columns ?? -1,
          span: n.widthInColumns ?? 1,
          directions: n.directions ?? [],
          classes: n.classes ?? [],
          styles: n.styles ?? [],
          children: (n.children ?? []).map((c, i) => project(c, path + '.' + i)),
        }
  return { columns: body.root.columns, blocks: (body.root.children ?? []).map((n, i) => project(n, String(i))), edges: body.edges.map(e => ({ from: e.start, to: e.end, label: e.label ?? '', arrowStart: e.arrowTypeStart, arrowEnd: e.arrowTypeEnd, thickness: e.thickness, pattern: e.pattern })) }
}
// Styles compare declared paint properties, not Mermaid's temporary entity tokens or semicolon spelling.
function normalizePaint(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(normalizePaint)
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [
        k,
        k === 'styles' && Array.isArray(v)
          ? Object.fromEntries(
              v.flatMap(s => {
                const m = String(s)
                  .trim()
                  .replace(/;$/, '')
                  .match(/^([\w-]+)\s*:\s*(.+)$/)
                return m ? [[m[1], m[2]]] : []
              }),
            )
          : normalizePaint(v),
      ]),
    )
  return value
}
function structured(source: string) {
  const result = parse(source)
  if (!result.ok) throw Error(JSON.stringify(result.error))
  const narrowed = asBlock(result.value)
  if (!narrowed) throw Error('Block must retain a native body')
  return narrowed
}
describe('native block', () => {
  for (const c of cases)
    test(c.id + ' retains pinned grid semantics through native surfaces', () => {
      const parsed = structured(c.source)
      expect(normalizePaint(semantic(parsed.body))).toEqual(normalizePaint(c.expect))
      const canonical = serializeMermaid(parsed),
        again = structured(canonical)
      expect(serializeMermaid(again)).toBe(canonical)
      expect(normalizePaint(semantic(again.body))).toEqual(normalizePaint(c.expect))
      expect(renderMermaidSVG(c.source)).toContain('<svg')
      expect(renderMermaidASCII(c.source).trim()).not.toBe('')
      expect(layoutMermaid(parsed).bounds.w).toBeGreaterThan(0)
    })
  test('typed edits preserve nested titled composites, gap cells and edge identity', () => {
    const first = structured('block\ncolumns 2\nblock:g["Measured group"]\na["First"] b["Second"]\nend\nspace\na --> b\na -- "second link" --> b\n'),
      renamed = mutate(first, { kind: 'rename_block', from: 'a', to: 'api' })
    expect(renamed.ok).toBe(true)
    if (!renamed.ok) return
    const moved = mutate(renamed.value, { kind: 'move_block', id: 'b', index: 0 })
    expect(moved.ok).toBe(true)
    if (!moved.ok) return
    const final = structured(serializeMermaid(moved.value))
    expect(final.body.root.children?.map(n => n.type)).toEqual(['square', 'composite', 'space'])
    expect(final.body.root.children?.[1]?.label).toBe('Measured group')
    expect(final.body.edges.map(e => [e.start, e.end, e.label])).toEqual([
      ['api', 'b', ''],
      ['api', 'b', 'second link'],
    ])
    expect(new Set(final.body.edges.map(e => e.id)).size).toBe(2)
    expect(mutate(first, { kind: 'move_block', id: 'g', parentId: 'g' }).ok).toBe(false)
  })
  test('spanning nested cells honor authored placement and measured containment', () => {
    const model = parseBlockDiagram('block\ncolumns 3\nblock:g["A long measured group"]:2\ncolumns 2\na["A nested label"] b\nend\nc\nspace d:2\n'),
      p = layoutBlockDiagram(model),
      group = p.nodes.find(n => n.id === 'g')!,
      a = p.nodes.find(n => n.id === 'a')!,
      b = p.nodes.find(n => n.id === 'b')!,
      c = p.nodes.find(n => n.id === 'c')!
    expect(a.x).toBeGreaterThan(group.x)
    expect(b.x + b.width).toBeLessThan(group.x + group.width)
    expect(a.y).toBeGreaterThan(group.y + group.label.height)
    expect(c.x).toBeGreaterThan(group.x + group.width)
    const wider = layoutBlockDiagram(model, {}, undefined, { padding: 40 })
    expect(wider.width).toBeGreaterThan(p.width)
  })
  test('all authored links in a chain and names resembling generated ids survive', () => {
    const source = 'block\nblock_generated_1 A B\nblock\nC\nend\nA --> B --> C\nstyle A fill:#fff\n',
      body = structured(source)
    expect(body.body.edges.map(e => [e.start, e.end])).toEqual([
      ['A', 'B'],
      ['B', 'C'],
    ])
    expect(new Set(body.body.root.children?.map(n => n.id)).size).toBe(4)
    expect(semantic(structured(serializeMermaid(body)).body)).toEqual(semantic(body.body))
  })
  test('display entities and line breaks retain authored source and measured text', () => {
    const source = 'block\nA["&nbsp;&nbsp;&nbsp;"] B["Wide<br/>middle &amp; visible #lt;b#gt;"]',
      parsed = structured(source)
    expect(parsed.body.root.children?.[0]?.label).toBe('&nbsp;&nbsp;&nbsp;')
    expect(blockDisplayText(parsed.body.root.children?.[0]?.label ?? '')).toBe('\u00a0\u00a0\u00a0')
    expect(blockDisplayText(parsed.body.root.children?.[1]?.label ?? '')).toBe('Wide\nmiddle & visible <b>')
    const p = layoutBlockDiagram(parsed.body)
    expect(p.nodes[0]?.label.text).toBe('\u00a0\u00a0\u00a0')
    expect(p.nodes[1]?.label.lines).toEqual(['Wide', 'middle & visible <b>'])
    expect(renderMermaidSVG(source)).not.toContain('&amp;nbsp;')
    expect(renderMermaidASCII(source)).toContain('middle & visible <b>')
    expect(serializeMermaid(parsed)).toContain('&nbsp;&nbsp;&nbsp;')
  })
  test('authored dash styles reach rectangular and compound shape paints after typed edits', () => {
    const source = 'block\nA["Card"] B[("Database")]\nclassDef dashed stroke-dasharray:5 5\nclass A,B dashed',
      parsed = structured(source)
    expect(renderMermaidSVG(source).match(/stroke-dasharray="5 5"/g)?.length).toBeGreaterThanOrEqual(3)
    const changed = mutate(parsed, { kind: 'set_node_style', id: 'A', style: 'stroke-dasharray:2 3' })
    expect(changed.ok).toBe(true)
    if (!changed.ok) return
    const canonical = serializeMermaid(changed.value),
      svg = renderMermaidSVG(canonical)
    expect(svg).toContain('stroke-dasharray="2 3"')
    expect(svg).toContain('stroke-dasharray="5 5"')
    expect(verifyMermaid(canonical).ok).toBe(true)
  })
  test('authored class font weights remain identical in measured and rendered labels', () => {
    for (const [css, expected] of [
      ['normal', 400],
      ['bold', 700],
      ['650', 650],
    ] as const) {
      const source = `block\nA["Measured card"]\nclassDef weighted font-weight:${css}\nclass A weighted`,
        positioned = layoutBlockDiagram(structured(source).body)
      expect(positioned.nodes[0]!.label.fontWeight).toBe(expected)
      expect(renderMermaidSVG(source)).toContain(`font-weight="${expected}"`)
      expect(verifyMermaid(source).ok).toBe(true)
    }
  })
  test('unresolved style targets retain their source as opaque', () => {
    for (const source of ['block\nA\nstyle missing fill:#f00', 'block\nA\nclass missing hot']) {
      const result = parse(source)
      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.value.body.kind).toBe('opaque')
        expect(serializeMermaid(result.value)).toContain(source)
      }
    }
  })
  test('unknown statements remain opaque and missing endpoints block partial rendering', () => {
    const unknown = parse('block\nA\nunknown syntax {')
    expect(unknown.ok).toBe(true)
    if (unknown.ok) expect(unknown.value.body.kind).toBe('opaque')
    expect(verifyMermaid('block\nA\nstyle missing fill:red').ok).toBe(false)
  })
  test('wrapped authored grid routes avoid occupied cells and retain measured paint', () => {
    const source = 'block\ncolumns 3\nA["Step 0"] B["Step 1"] C["Step 2"] D["Step 3"]\nA --> B\nB --> C\nC --> D',
      result = verifyMermaid(source)
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.layoutCertification?.coverage.unmeasured).toBe(0)
    }
    expect(verifyMermaid('block\ncolumns 3\nA B C\nA --> C').ok).toBe(true)
  })
  test('independently generated labels retain order, spans and explicit gaps', () => {
    fc.assert(
      fc.property(fc.array(fc.stringMatching(/^[A-Za-z0-9 ]{1,30}$/), { minLength: 1, maxLength: 8 }), labels => {
        const source = 'block\ncolumns 2\n' + labels.map((label, i) => `n${i}["${label}"]\nspace\n`).join(''),
          again = structured(serializeMermaid(structured(source)))
        expect(again.body.root.children?.filter(n => n.type !== 'space').map(n => n.label)).toEqual(labels)
        expect(again.body.root.children?.filter(n => n.type === 'space')).toHaveLength(labels.length)
      }),
      fcParameters({ numRuns: 40 }),
    )
  })
})
