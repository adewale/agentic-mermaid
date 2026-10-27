import { afterAll, describe, expect, test } from 'bun:test'
import { parseIshikawaDiagram } from '../ishikawa/parser.ts'
import { layoutIshikawaDiagram } from '../ishikawa/layout.ts'
import { renderIshikawa } from '../agent/ishikawa-body.ts'
import { parseRegisteredMermaid, asIshikawa, layoutMermaidWithReceipt, mutate, serializeMermaid, verifyMermaid, renderMermaidSVG, renderMermaidASCII } from '../agent/core.ts'
import { startUpstreamMermaid } from './helpers/upstream-mermaid.ts'

const upstream = startUpstreamMermaid()
afterAll(() => upstream.close())

describe('native Ishikawa', () => {
  test('Ishikawa header comments share one direct and typed reading', async () => {
    for (const comment of ['%% explanation', '%%{', '%%{beta']) {
      const source = `ishikawa${comment}\nProblem\nPeople\n  Training\nTools`
      expect(() => parseIshikawaDiagram(source)).not.toThrow()
      const parsed = parseRegisteredMermaid(source)
      if (!parsed.ok || parsed.value.body.kind !== 'ishikawa') throw new Error('Expected typed Ishikawa')
      const expected = [['Problem', undefined], ['People', 'effect'], ['Training', 'cause-1'], ['Tools', 'effect']]
      expect(parseIshikawaDiagram(source).nodes.map(node => [node.label, node.parentId])).toEqual(expected)
      expect(renderMermaidSVG(source)).toBe(renderMermaidSVG(parsed.value))
      expect(renderMermaidASCII(source)).toBe(renderMermaidASCII(parsed.value))
      const written = serializeMermaid(parsed.value)
      expect(await upstream.publicAccepts(written)).toBe(true)
      expect(parseIshikawaDiagram(written).nodes.map(node => [node.label, node.parentId])).toEqual(expected)
      expect(verifyMermaid(source).warnings.some(warning => warning.code === 'RENDER_FAILED')).toBe(false)
    }
  })

  test('accessibility line endings cannot create fishbone nodes or escape the Result contract', async () => {
    const parsed = parseRegisteredMermaid('ishikawa\nEffect\n  Child')
    if (!parsed.ok || parsed.value.body.kind !== 'ishikawa') throw new Error('Expected typed Ishikawa')
    const before = serializeMermaid(parsed.value)
    for (const description of ['one\rtwo', 'one\r\ntwo', 'one\n  two', 'one\nEffect\n  Injected cause']) {
      const edited = mutate(parsed.value, { kind: 'set_accessibility_description', description })
      expect(edited.ok).toBe(true)
      if (!edited.ok || edited.value.body.kind !== 'ishikawa') continue
      expect(edited.value.body.accessibilityDescription).toBe(description)
      expect(edited.value.body.nodes).toEqual(parsed.value.body.nodes)
      const written = serializeMermaid(edited.value)
      const reloaded = parseRegisteredMermaid(written)
      expect(reloaded.ok && reloaded.value.body).toEqual(edited.value.body)
      expect(verifyMermaid(written).warnings).toContainEqual(expect.objectContaining({ code: 'UNSUPPORTED_SYNTAX', syntax: 'ishikawa_accessibility' }))
    }
    for (const title of ['one\rtwo', 'one\r\ntwo', 'one\ntwo', 'one\nEffect\n  Injected cause']) {
      const edited = mutate(parsed.value, { kind: 'set_accessibility_title', title })
      expect(edited.ok).toBe(true)
      if (!edited.ok || edited.value.body.kind !== 'ishikawa') continue
      expect(edited.value.body.accessibilityTitle).toBe(title)
      expect(edited.value.body.nodes).toEqual(parsed.value.body.nodes)
      const reloaded = parseRegisteredMermaid(serializeMermaid(edited.value))
      expect(reloaded.ok && reloaded.value.body).toEqual(edited.value.body)
    }
    expect(mutate(parsed.value, { kind: 'set_accessibility_title', title: '' })).toMatchObject({ ok: false, error: { code: 'INVALID_OP' } })
    expect(mutate(parsed.value, { kind: 'set_accessibility_description', description: '' })).toMatchObject({ ok: false, error: { code: 'INVALID_OP' } })
    expect(serializeMermaid(parsed.value)).toBe(before)
  })

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
