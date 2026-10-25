import { afterAll, describe, expect, test } from 'bun:test'
import { parseIshikawaDiagram } from '../ishikawa/parser.ts'
import { layoutIshikawaDiagram } from '../ishikawa/layout.ts'
import { renderIshikawa } from '../agent/ishikawa-body.ts'
import { parseRegisteredMermaid, asIshikawa, layoutMermaidWithReceipt, mutate, serializeMermaid, verifyMermaid, renderMermaidSVG, renderMermaidASCII } from '../agent/core.ts'
import { startUpstreamMermaid } from './helpers/upstream-mermaid.ts'

const upstream = startUpstreamMermaid()
afterAll(() => upstream.close())

describe('native Ishikawa', () => {
  test('keyword labels retain their literal cause tree through portable typed spelling', async () => {
    for (const source of ['ishikawa\nishikawa', 'ishikawa\nProblem\n  ISHIKAWA-beta guide\n    Detail']) {
      expect(await upstream.accepts(source)).toBe(false)
      const parsed = parseRegisteredMermaid(source)
      expect(parsed.ok).toBe(true)
      if (!parsed.ok) continue
      expect(parsed.value.body.kind).toBe('ishikawa')
      expect(await upstream.publicAccepts(serializeMermaid(parsed.value))).toBe(true)
      expect(renderMermaidSVG(parsed.value)).toBe(renderMermaidSVG(source))
      expect(renderMermaidASCII(parsed.value)).toBe(renderMermaidASCII(source))
      expect(verifyMermaid(parsed.value).warnings).toContainEqual(expect.objectContaining({ code: 'UNSUPPORTED_SYNTAX', syntax: 'ishikawa_label' }))
      expect(mutate(parsed.value, { kind: 'set_effect', label: 'Changed' }).ok).toBe(true)
    }
    const parsed = parseRegisteredMermaid('ishikawa\nishikawas\n  About ishikawa')
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    expect(parsed.value.body.kind).toBe('ishikawa')
    expect(await upstream.accepts(serializeMermaid(parsed.value))).toBe(true)
    for (const label of ['ishikawa', 'ISHIKAWA-beta guide']) {
      expect(mutate(parsed.value, { kind: 'set_effect', label }).ok).toBe(true)
      expect(mutate(parsed.value, { kind: 'add_cause', label }).ok).toBe(true)
      expect(mutate(parsed.value, { kind: 'set_label', id: 'cause-1', label }).ok).toBe(true)
    }
  })
  test('box padding and corners reserve real space while the spine marker follows edge ink', () => {
    const source = 'ishikawa\nSlow release\nProcess\n  Manual checks\nTools\n  Slow builds',
      style = { roles: { node: { paddingX: 31, paddingY: 37, cornerRadius: 11, fontWeight: 400 }, edge: { strokeColor: '#ff00ff' } } },
      layout = layoutMermaidWithReceipt(source, { style }).layout
    for (const node of layout.nodes.filter(node => node.role === 'box')) {
      expect(node.w - node.labelBounds!.w).toBeGreaterThanOrEqual(61)
      expect(node.h - node.labelBounds!.h).toBeGreaterThanOrEqual(73)
    }
    expect(layout.edges.map(edge => [edge.from, edge.to])).toEqual([['cause-1', 'effect'], ['cause-2', 'cause-1'], ['cause-3', 'effect'], ['cause-4', 'cause-3']])
    const svg = renderMermaidSVG(source, { style })
    expect(svg).toContain('rx="11"')
    expect([...svg.matchAll(/<text\b[^>]*font-weight="([^"]+)"/g)].every(match => match[1] === '400')).toBe(true)
    expect(svg.match(/<marker[\s\S]*?<\/marker>/)?.[0]).toContain('fill="#ff00ff"')
  })
  test('cause indentation has its own baseline even when the effect is more indented', () => {
    const body = parseIshikawaDiagram('ishikawa\n      Blurry photo\n  Process\n    Focus\n  Equipment\n    Lens\n      Dirt')
    expect(body.nodes.map(node => [node.label, node.parentId])).toEqual([
      ['Blurry photo', undefined],
      ['Process', 'effect'],
      ['Focus', 'cause-1'],
      ['Equipment', 'effect'],
      ['Lens', 'cause-3'],
      ['Dirt', 'cause-4'],
    ])
  })
  test('nested causes retain parents and actual fishbone branches on both sides of a horizontal spine', () => {
    const source = 'ishikawa\nSlow release\nProcess\n  Manual checks\n  Queues\n    Approvals\nTooling\n  Builds\n    Cold caches\nPeople\n  Ownership'
    const model = parseIshikawaDiagram(source)
    const p = layoutIshikawaDiagram(model)
    expect(p.branches).toHaveLength(model.nodes.length - 1)
    expect(p.branches.map(branch => [branch.from, branch.to])).toEqual(expect.arrayContaining(model.nodes.filter(node => node.parentId).map(node => [node.id, node.parentId])))
    expect(p.spine[0]!.y).toBe(p.spine[1]!.y)
    const main = p.nodes.filter(node => node.depth === 1)
    expect(main.some(node => node.y < p.spine[0]!.y)).toBe(true)
    expect(main.some(node => node.y > p.spine[0]!.y)).toBe(true)
    for (const n of p.nodes) {
      expect(n.x).toBeGreaterThanOrEqual(0)
      expect(n.y).toBeGreaterThanOrEqual(0)
      expect(n.x + n.width).toBeLessThanOrEqual(p.width)
      expect(n.y + n.height).toBeLessThanOrEqual(p.height)
    }
    expect(layoutIshikawaDiagram(model)).toEqual(p)
  })
  test('typed edits preserve unrelated subtrees and reject self-parenting', () => {
    const parsed = parseRegisteredMermaid('ishikawa\nProblem\nPeople\n  Training\nProcess\n  Review')
    if (!parsed.ok) throw Error('fixture did not parse')
    const diagram = asIshikawa(parsed.value)!
    const authored = serializeMermaid(diagram)
    for (const label of ['  Accidental child', 'Trimmed text ']) {
      expect(mutate(diagram, { kind: 'set_label', id: 'cause-3', label }).ok).toBe(false)
      expect(mutate(diagram, { kind: 'set_effect', label }).ok).toBe(false)
      expect(mutate(diagram, { kind: 'add_cause', label }).ok).toBe(false)
      expect(() => renderIshikawa({ ...diagram.body, nodes: diagram.body.nodes.map(node => node.id === 'cause-3' ? { ...node, label } : node) })).toThrow('without surrounding whitespace')
    }
    expect(() => renderIshikawa({ ...diagram.body, nodes: [...diagram.body.nodes, { id: 'other-effect', label: 'Other effect' }] })).toThrow('one effect first')
    expect(() => renderIshikawa({ ...diagram.body, nodes: [diagram.body.nodes[1]!, diagram.body.nodes[0]!, ...diagram.body.nodes.slice(2)] })).toThrow('one effect first')
    expect(serializeMermaid(diagram)).toBe(authored)
    expect(diagram.body.nodes.find(node => node.id === 'cause-3')?.parentId).toBe('effect')
    expect(mutate(diagram, { kind: 'move_cause', id: 'cause-1', parentId: 'cause-2' }).ok).toBe(false)
    const changed = mutate(diagram, { kind: 'set_label', id: 'cause-2', label: 'Documentation' })
    expect(changed.ok).toBe(true)
    if (!changed.ok) return
    expect(serializeMermaid(changed.value)).toContain('    Documentation')
    expect(serializeMermaid(changed.value)).toContain('  Process\n    Review')
    expect(verifyMermaid(changed.value).ok).toBe(true)
    expect(serializeMermaid(diagram)).toContain('Training')
  })
  test('titles, wide graphemes and full cause text survive graphical and declared terminal projections', () => {
    const source = '---\ntitle: Release analysis\n---\nishikawa\nDelayed release\nPeople\n  東京 café 👩‍💻\nProcess\n  A long approval process with several teams and reviewers'
    for (const style of ['hand-drawn', 'watercolor', 'blueprint']) {
      const svg = renderMermaidSVG(source, { style })
      expect(svg).toContain('Release analysis')
      expect(svg).toContain('Delayed release')
      expect(svg).toContain('東京')
    }
    expect(renderMermaidASCII(source)).toContain('東京')
  })
})
