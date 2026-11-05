import { afterAll, describe, expect, test } from 'bun:test'
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
  test('public output retains region text and safe native identities through edits', async () => {
    const parsed = parseRegisteredMermaid(source)
    if (!parsed.ok || parsed.value.body.kind !== 'venn') throw Error('Expected native Venn')
    expect(renderMermaidSVG(parsed.value)).toBe(renderMermaidSVG(source))
    expect(renderMermaidASCII(source)).toContain('Shared')
    expect(verifyMermaid(source).ok).toBe(true)
    expect(await upstream.publicAccepts(serializeMermaid(parsed.value))).toBe(true)
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
