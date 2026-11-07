import { afterAll, describe, expect, test } from 'bun:test'
import { layoutVennDiagram } from '../venn/layout.ts'
import { parseVennDiagram } from '../venn/parser.ts'
import { mutateVenn, renderVenn, verifyVenn } from '../agent/venn-body.ts'
import { distanceForOverlap, layoutCircles, lensArea } from '../venn/geometry.ts'
import { layoutMermaid, parseRegisteredMermaid, renderMermaidASCII, renderMermaidSVG, serializeMermaid, verifyMermaid } from '../agent/core.ts'
import { startUpstreamMermaid } from './helpers/upstream-mermaid.ts'

const upstream = startUpstreamMermaid()
afterAll(() => upstream.close())

describe('native Venn', () => {
  const source = 'venn-beta\nset A["Alpha"]:20\n  text item["A note"]\nset B["Beta"]:12\nunion A,B["Shared"]:3\nstyle A fill:red'
  test('retains set and intersection identities, quantities and text ownership', () => {
    const body = parseVennDiagram(source)
    expect(body.subsets).toEqual([
      { sets: ['A'], size: 20, label: 'Alpha' },
      { sets: ['B'], size: 12, label: 'Beta' },
      { sets: ['A', 'B'], size: 3, label: 'Shared' },
    ])
    expect(body.textNodes).toEqual([{ sets: ['A'], id: 'item', label: 'A note' }])
    expect(body.styles).toEqual([{ targets: ['A'], styles: { fill: 'red' } }])
    expect(parseVennDiagram(renderVenn(body))).toEqual(body)
  })
  test('renames actual references and refuses collisions or dangling deletions atomically', () => {
    const original = parseVennDiagram(source)
    const result = mutateVenn(original, { kind: 'rename_set', from: 'A', to: 'Frontend' })
    expect(result.ok).toBe(true)
    if (!result.ok) throw Error(result.error.message)
    expect(result.value.subsets.map(subset => subset.sets)).toEqual([['Frontend'], ['B'], ['B', 'Frontend']])
    expect(result.value.textNodes[0]!.sets).toEqual(['Frontend'])
    expect(result.value.styles[0]!.targets).toEqual(['Frontend'])
    expect(mutateVenn(original, { kind: 'rename_set', from: 'A', to: 'B' }).ok).toBe(false)
    expect(mutateVenn(original, { kind: 'remove_subset', sets: ['A'] }).ok).toBe(false)
    expect(original).toEqual(parseVennDiagram(source))
  })
  test('preserves literal delimiter text through the writer', () => {
    const body = parseVennDiagram(source)
    const result = mutateVenn(body, { kind: 'set_subset', sets: ['A'], size: 20, label: 'A ["quoted"] #35; : label' })
    expect(result.ok).toBe(true)
    if (!result.ok) throw Error(result.error.message)
    expect(parseVennDiagram(renderVenn(result.value)).subsets[0]!.label).toBe('A ["quoted"] #35; : label')
    const styled = mutateVenn(body, { kind: 'set_style', targets: ['B', 'A'], styles: { fill: 'var(--brand, #35; [literal])' } })
    if (!styled.ok) throw Error(styled.error.message)
    expect(parseVennDiagram(renderVenn(styled.value)).styles.at(-1)).toEqual({ targets: ['A', 'B'], styles: { fill: 'var(--brand, #35; [literal])' } })
  })
  test.each(['quoted', 'bare'] as const)('keeps accessibility-looking lines inside a %s multiline label', form => {
    const label = 'First\n  AccTitle: literal\n\naccDescr {\n  Not metadata\n}\nLast'
    const input = `venn-beta\naccTitle: Real metadata\nset A[${form === 'quoted' ? `"${label}"` : label}]:10`
    const body = parseVennDiagram(input)
    expect(body.subsets).toEqual([{ sets: ['A'], size: 10, label }])
    expect(body.accessibilityTitle).toBe('Real metadata')
    expect(body.accessibilityDescription).toBeUndefined()
    const parsed = parseRegisteredMermaid(input)
    if (!parsed.ok || parsed.value.body.kind !== 'venn') throw Error('Expected editable multiline Venn label')
    expect(parsed.value.body.subsets).toEqual(body.subsets)
    const changed = mutateVenn(parsed.value.body, { kind: 'rename_set', from: 'A', to: 'Renamed' })
    if (!changed.ok) throw Error(changed.error.message)
    expect(parseVennDiagram(renderVenn(changed.value)).subsets).toEqual([{ sets: ['Renamed'], size: 10, label }])
    expect(parseVennDiagram(serializeMermaid(parsed.value)).subsets).toEqual(body.subsets)
    const svg = renderMermaidSVG(input)
    expect(svg).toContain('AccTitle: literal')
    expect(svg).toContain('accDescr {')
  })
  test('tiny and huge decimal areas remain typed and portable rather than becoming opaque', async () => {
    for (const [decimal, expected] of [['0.' + '0'.repeat(299) + '1', 1e-300], ['1' + '0'.repeat(300), 1e300]] as const) {
      const parsed = parseRegisteredMermaid(`venn-beta\nset A["Authored quantity"]:${decimal}`)
      if (!parsed.ok || parsed.value.body.kind !== 'venn') throw Error('Expected native finite Venn quantity')
      expect(parsed.value.body.subsets).toEqual([{ sets: ['A'], size: expected, label: 'Authored quantity' }])
      const source = serializeMermaid(parsed.value)
      expect(source).toContain(`:${decimal}`)
      expect(await upstream.publicAccepts(source)).toBe(true)
      expect(renderMermaidSVG(parsed.value)).toContain('Authored quantity')
    }
  })
  test('extreme finite areas retain the same independently known two- and three-circle geometry', () => {
    // Equal unit circles one radius apart have this lens area. Changing the
    // authored unit must preserve distances and the equilateral triangle.
    const overlap = 2 * Math.PI / 3 - Math.sqrt(3) / 2
    for (const scale of [1e-300, 1, 1e300]) {
      for (const ids of [['A', 'B'], ['A', 'B', 'C']]) {
        const subsets = ids.map(id => ({ sets: [id], size: Math.PI * scale }))
        for (let a = 0; a < ids.length; a++) for (let b = a + 1; b < ids.length; b++) subsets.push({ sets: [ids[a]!, ids[b]!], size: overlap * scale })
        const circles = layoutCircles(subsets), unit = Math.sqrt(scale)
        expect(circles.every(circle => [circle.x, circle.y, circle.r].every(Number.isFinite))).toBe(true)
        expect(circles.map(circle => circle.r / unit)).toEqual(ids.map(() => expect.closeTo(1, 12)))
        expect(circles[1]!.x / unit).toBeCloseTo(1, 11)
        if (ids.length === 3) {
          expect(circles[2]!.x / unit).toBeCloseTo(0.5, 11)
          expect(circles[2]!.y / unit).toBeCloseTo(Math.sqrt(3) / 2, 11)
        }
      }
      expect(lensArea(Math.sqrt(scale), Math.sqrt(scale), Math.sqrt(scale)) / scale).toBeCloseTo(overlap, 11)
    }
  })
  test('two-circle geometry preserves authored areas and requested pairwise overlap', () => {
    const circles = layoutCircles(parseVennDiagram(source).subsets)
    expect(Math.PI * circles[0]!.r ** 2).toBeCloseTo(20, 10)
    expect(Math.PI * circles[1]!.r ** 2).toBeCloseTo(12, 10)
    const distance = Math.hypot(circles[0]!.x - circles[1]!.x, circles[0]!.y - circles[1]!.y)
    expect(lensArea(circles[0]!.r, circles[1]!.r, distance)).toBeCloseTo(3, 9)
    expect(distanceForOverlap(1, 1, 0)).toBe(2)
  })
  test('reports approximate areas while retaining exact values and zero-area text', () => {
    const exact = parseVennDiagram(source)
    expect(verifyVenn(exact, {}).filter(warning => warning.code === 'VENN_APPROXIMATION')).toEqual([])
    const impossible = parseVennDiagram('venn-beta\nset A:10\nset B:5\nunion A,B["Excess"]:8')
    expect(verifyVenn(impossible, {})).toContainEqual(expect.objectContaining({ code: 'VENN_APPROXIMATION', message: expect.stringContaining('A ∩ B') }))
    expect(impossible.subsets[2]!.size).toBe(8)
    const zero = 'venn-beta\nset A["Empty set"]:0\ntext A note["Still retained"]'
    expect(renderMermaidSVG(zero)).toContain('Still retained')
    expect(renderMermaidASCII(zero)).toContain('Empty set')
  })
  test('keeps frontmatter accessibility and maps actual statement locations', () => {
    const result = parseRegisteredMermaid('---\ntitle: Membership\n---\nvenn-beta\naccTitle: A title\nset A:10\nset B:5\nunion A,B:2')
    if (!result.ok || result.value.body.kind !== 'venn') throw Error('Expected native Venn')
    expect(result.value.body.title).toBe('Membership')
    expect(result.value.body.accessibilityTitle).toBe('A title')
    expect(result.value.source.spans?.nodes.get('A')?.start.line).toBe(6)
    const intersection = layoutMermaid(result.value).nodes.find(node => node.id !== 'A' && node.id !== 'B')!
    expect(result.value.source.spans?.nodes.get(intersection.id)?.start.line).toBe(8)
    expect(serializeMermaid(result.value)).toContain('Membership')
  })
  test.each(([
    [['A', 'set A:10'], ['B', 'set B:5']],
    [['A', 'set A["First\n    Last"]:10'], ['B', 'set B:5']],
    [['A&amp;B', 'set "A&amp;B"["First\n    Last"]'], ['B', 'set B:5'], ['note', 'text B note["A note"]'], ['venn-region-0', 'union "A&amp;B",B:2']],
  ] as const).map(statements => [statements] as const))('maps each consumed Venn production independently on shared physical rows: %j', statements => {
    const payload = statements.map(([, statement]) => statement).join(' ')
    const source = '---\r\ntitle: Membership\r\n---\r\nvenn-beta\r\n  ' + payload.replaceAll('\n', '\r\n')
    const parsed = parseRegisteredMermaid(source)
    if (!parsed.ok || parsed.value.body.kind !== 'venn') throw Error('Expected editable Venn productions')
    const canonical = parsed.value.canonicalSource.split('\n')
    for (const [id, statement] of statements) {
      const expected = statement.replaceAll('\n', '\r\n')
      const span = parsed.value.source.spans!.nodes.get(id)!
      expect(source.slice(span.start.offset, span.end.offset)).toBe(expected)
      expect(span.start.offset).toBe(source.indexOf(expected))
      expect(parsed.value.source.spans!.labels.get(`node:${id}`)).toEqual(span)
      const location = parsed.value.source.nodes.get(id)!
      expect(canonical[location.line - 1]!.slice(location.col - 1)).toStartWith(statement.split('\n')[0]!)
    }
  })
  test.each(['accTitle: Membership', '%% retained outside label', 'title'])('copied canonical Venn retains indentation after %s', separator => {
    const source = `---\r\nconfig:\r\n  theme: base\r\n---\r\nvenn-beta\r\nset A:10\r\n${separator}\r\n  text item["Note"]`
    const original = parseRegisteredMermaid(source)
    if (!original.ok || original.value.body.kind !== 'venn') throw Error('Expected typed indented Venn text')
    const copied = parseRegisteredMermaid(original.value.canonicalSource)
    if (!copied.ok) throw Error('Expected executable copied Venn source')
    expect(copied.value.body).toEqual(original.value.body)
    const span = original.value.source.spans!.nodes.get('item')!
    expect(source.slice(span.start.offset, span.end.offset)).toBe('  text item["Note"]')
    const location = original.value.source.nodes.get('item')!
    expect(original.value.canonicalSource.split(/\r?\n/)[location.line - 1]!.slice(location.col - 1)).toBe('  text item["Note"]')
  })
  test('observed accessibility-block suffixes retain physical production offsets', () => {
    const source = 'venn-beta\r\nset Prior:20\r\naccDescr {\r\nMetadata\r\n} set A:10 set B:5 text B note["Owned by B"]'
    const parsed = parseRegisteredMermaid(source)
    if (!parsed.ok || parsed.value.body.kind !== 'venn') throw Error('Expected typed Venn accessibility suffix')
    expect(parsed.value.body.accessibilityDescription).toBe('Metadata')
    expect(parsed.value.body.textNodes).toEqual([{ sets: ['B'], id: 'note', label: 'Owned by B' }])
    for (const [id, token] of [['A', 'set A:10'], ['B', 'set B:5'], ['note', 'text B note["Owned by B"]']] as const) {
      const span = parsed.value.source.spans!.nodes.get(id)!
      expect(source.slice(span.start.offset, span.end.offset)).toBe(token)
      expect(span.start.offset).toBe(source.indexOf(token))
      const location = parsed.value.source.nodes.get(id)!
      expect(parsed.value.canonicalSource.split('\r\n')[location.line - 1]!.slice(location.col - 1)).toStartWith(token)
    }
  })
  test('public output retains region text and safe native identities through edits', async () => {
    const parsed = parseRegisteredMermaid(source)
    if (!parsed.ok || parsed.value.body.kind !== 'venn') throw Error('Expected native Venn')
    expect(renderMermaidSVG(parsed.value)).toBe(renderMermaidSVG(source))
    expect(renderMermaidASCII(source)).toContain('Shared')
    expect(verifyMermaid(source).ok).toBe(true)
    expect(await upstream.publicAccepts(serializeMermaid(parsed.value))).toBe(true)
    const styled = renderMermaidSVG(`${source}\nstyle A,B fill:red`)
    expect(styled).toContain('data-role="bar"')
    expect(styled).toContain('fill="red"')
    const collisions = 'venn-beta\nset "venn-label-0":20\nset "venn-region-0":20\nunion "venn-label-0","venn-region-0"["Intersection"]:3\ntext "venn-label-0" "venn-label-1"["Owned note"]'
    const collisionDiagram = parseRegisteredMermaid(collisions)
    if (!collisionDiagram.ok) throw Error('Expected collision-safe Venn source')
    const intersection = layoutMermaid(collisionDiagram.value).nodes.find(node => node.label === 'Intersection')!
    expect(intersection.id).not.toBe('venn-region-0')
    expect(collisionDiagram.value.source.spans?.nodes.get(intersection.id)?.start.line).toBe(4)
    const svg = renderMermaidSVG(collisions)
    expect(svg).toContain('Intersection')
    expect(svg).toContain('Owned note')
    const ids = [...svg.matchAll(/\bid="([^"]+)"/g)].map(match => match[1]!)
    expect(new Set(ids).size).toBe(ids.length)
  })
})

test('measured Venn captions fit their region or retain an owned outside leader without changing areas', () => {
  const input = 'venn-beta\nset A["Product designers"]:40\nset B["Frontend engineers"]:35\nset C["Customer advocates"]:30\nunion A,B["Design systems"]:12\nunion A,C["Discovery"]:8\nunion B,C["Support tools"]:7\nunion A,B,C["Shared product discovery, accessible implementation, and customer support workflows"]:3', body = parseVennDiagram(input), chart = layoutVennDiagram(body)
  const scale = chart.circles[0]!.r ** 2 / 40
  for (const circle of chart.circles) expect(circle.r ** 2 / body.subsets.find(subset => subset.sets.length === 1 && subset.sets[0] === circle.id)!.size).toBeCloseTo(scale)
  expect(chart.labels.some(label => label.leader)).toBe(true)
  for (const label of chart.labels) {
    const left = label.x - label.block.width / 2, right = label.x + label.block.width / 2, top = label.y - label.block.height / 2, bottom = label.y + label.block.height / 2
    expect(left).toBeGreaterThanOrEqual(0); expect(right).toBeLessThanOrEqual(chart.width); expect(top).toBeGreaterThanOrEqual(0); expect(bottom).toBeLessThanOrEqual(chart.height)
    if (label.leader) { expect(label.leader.at(-1)!.x).toBeLessThan(left); continue }
    for (const circle of chart.circles) if (label.sets.includes(circle.id)) for (const x of [left, right]) for (const y of [top, bottom]) expect(Math.hypot(x - circle.x, y - circle.y)).toBeLessThanOrEqual(circle.r)
  }
  const svg = renderMermaidSVG(input)
  expect(svg).toContain('customer support workflows')
  expect(verifyMermaid(input).ok).toBe(true)
})
