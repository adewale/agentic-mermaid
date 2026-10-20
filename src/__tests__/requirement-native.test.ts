import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import fc from 'fast-check'
import { asRequirement, layoutMermaid, mutate, parseRegisteredMermaid as parse, renderMermaidASCII, renderMermaidSVG, serializeMermaid, verifyMermaid } from '../agent/core.ts'
import { normalizeMermaidSource } from '../mermaid-source.ts'
import { layoutRequirementDiagram } from '../requirement/layout.ts'
import { parseRequirementDiagram } from '../requirement/parser.ts'
import type { RequirementBody } from '../requirement/types.ts'
import { fcParameters } from './helpers/fc-parameters.ts'

const cases = JSON.parse(readFileSync(new URL('../../eval/mermaid-requirement-bench/cases.json', import.meta.url), 'utf8')) as { id: string; source: string; expect: ReturnType<typeof semantic> }[]
function semantic(body: RequirementBody) {
  const project = (n: (typeof body.requirements)[number] | (typeof body.elements)[number], element: boolean) =>
    Object.fromEntries((element ? ['name', 'type', 'docRef', 'classes', 'cssStyles'] : ['name', 'type', 'requirementId', 'text', 'risk', 'verifyMethod', 'classes', 'cssStyles']).map(k => [k, (n as unknown as Record<string, unknown>)[k]]))
  return {
    direction: body.direction,
    requirements: body.requirements.map(n => project(n, false)).sort((a, b) => String(a.name).localeCompare(String(b.name))),
    elements: body.elements.map(n => project(n, true)).sort((a, b) => String(a.name).localeCompare(String(b.name))),
    relations: body.relations.map(({ type, src, dst }) => ({ type, src, dst })),
  }
}
function structured(source: string) {
  const result = parse(source)
  if (!result.ok) throw Error(JSON.stringify(result.error))
  const narrowed = asRequirement(result.value)
  if (!narrowed) throw Error('Requirement must retain a native body')
  return narrowed
}
describe('native requirement', () => {
  for (const c of cases)
    test(c.id + ' retains pinned domain data through native surfaces', () => {
      const parsed = structured(c.source)
      expect(semantic(parsed.body)).toEqual(c.expect)
      const canonical = serializeMermaid(parsed),
        again = structured(canonical)
      expect(serializeMermaid(again)).toBe(canonical)
      expect(semantic(again.body)).toEqual(c.expect)
      expect(renderMermaidSVG(c.source)).toContain('requirement-node')
      expect(renderMermaidASCII(c.source)).toContain('<<')
      expect(layoutMermaid(parsed).bounds.w).toBeGreaterThan(0)
    })
  test('typed rename, field change and repeated relation preserve endpoints and wrapper', () => {
    const source = '---\ntitle: Traceability\n---\nrequirementDiagram\nrequirement r {\ntext: Keep every field\n}\nelement evidence {\ntype: suite\n}\nevidence - verifies -> r\nevidence - traces -> r\n'
    const first = structured(source),
      renamed = mutate(first, { kind: 'rename_node', from: 'evidence', to: 'proof' })
    expect(renamed.ok).toBe(true)
    if (!renamed.ok) return
    const changed = mutate(renamed.value, { kind: 'update_requirement', id: 'r', changes: { risk: 'High', verifyMethod: 'Analysis', requirementId: 'R-1' } })
    expect(changed.ok).toBe(true)
    if (!changed.ok) return
    const text = serializeMermaid(changed.value)
    expect(text.startsWith('---\ntitle: Traceability\n---\n')).toBe(true)
    const final = structured(text)
    expect(final.body.relations.map(e => [e.src, e.dst, e.type])).toEqual([
      ['proof', 'r', 'verifies'],
      ['proof', 'r', 'traces'],
    ])
    expect(new Set(final.body.relations.map(e => e.id)).size).toBe(2)
    expect(final.body.requirements[0]).toMatchObject({ requirementId: 'R-1', risk: 'High', verifyMethod: 'Analysis', text: 'Keep every field' })
    expect(mutate(first, { kind: 'remove_node', id: 'r' }).ok).toBe(false)
  })
  test('measured compartments keep long fields inside independent node bounds', () => {
    const model = parseRequirementDiagram('requirementDiagram\ninterfaceRequirement long {\ntext: "A very long interface requirement with emoji 🧪 and wide 界 text that wraps into several owned rows"\nrisk: high\nverifymethod: inspection\n}\n'),
      p = layoutRequirementDiagram(model),
      node = p.nodes[0]!
    expect(node.headerHeight).toBeGreaterThan(node.header.height)
    for (const row of node.rows) {
      expect(row.block.width + 32).toBeLessThanOrEqual(node.width + 0.01)
      expect(row.y + row.block.height / 2).toBeLessThan(node.height)
    }
    expect(p.width).toBeGreaterThan(node.width)
    expect(p.height).toBeGreaterThan(node.height)
  })
  test('authored class and inline dash styles reach the frame paint after typed edits', () => {
    const source = 'requirementDiagram\nrequirement A {\ntext: "Card"\n}\nclassDef dashed stroke-dasharray:5 5\nclass A dashed',
      parsed = structured(source)
    expect(renderMermaidSVG(source)).toContain('stroke-dasharray="5 5"')
    expect(renderMermaidSVG(source)).toMatch(/<g\b[^>]*class="[^"]*\bdashed\b[^"]*"[^>]*data-id="A"/)
    const changed = mutate(parsed, { kind: 'set_node_style', id: 'A', style: 'stroke-dasharray:2 3' })
    expect(changed.ok).toBe(true)
    if (!changed.ok) return
    const canonical = serializeMermaid(changed.value)
    expect(renderMermaidSVG(canonical)).toContain('stroke-dasharray="2 3"')
    expect(renderMermaidSVG(canonical)).not.toContain('stroke-dasharray="5 5"')
    expect(verifyMermaid(canonical).ok).toBe(true)
  })
  test('authored class font weights remain identical in measurement and rendered compartments', () => {
    for (const [css, expected] of [
      ['normal', 400],
      ['bold', 700],
      ['650', 650],
    ] as const) {
      const source = `requirementDiagram\nrequirement A {\ntext: "Measured card"\n}\nclassDef weighted font-weight:${css}\nclass A weighted`,
        positioned = layoutRequirementDiagram(structured(source).body),
        node = positioned.nodes[0]!
      expect(node.header.fontWeight).toBe(expected)
      expect(node.rows.every(row => row.block.fontWeight === expected)).toBe(true)
      expect(renderMermaidSVG(source)).toContain(`font-weight="${expected}"`)
      expect(verifyMermaid(source).ok).toBe(true)
    }
  })
  test('semantic Style ink colors reach requirement compartments, relations and their markers', () => {
    const source = 'requirementDiagram\nrequirement r {\ntext: "Measured card"\n}\nelement proof {\ntype: "test"\n}\nproof - verifies -> r'
    for (const role of ['edge', 'relationship'] as const) {
      const options = { style: { roles: { node: { textColor: '#b91c1c' }, [role]: { strokeColor: '#174ea6', textColor: '#166534' } } } },
        svg = renderMermaidSVG(source, options)
      expect([...svg.matchAll(/<text\b[^>]*fill="#b91c1c"/g)].length).toBeGreaterThanOrEqual(4)
      expect(svg).toMatch(/<polyline\b[^>]*stroke="#174ea6"/)
      expect(svg).toMatch(/<text\b[^>]*fill="#166534"/)
      expect(svg).toMatch(/<marker\b[^>]*>[\s\S]*?stroke="#174ea6"/)
      expect(renderMermaidSVG(`${source}\nstyle r color:#661122`, options)).toContain('fill="#661122"')
      expect(verifyMermaid(source, { renderOptions: options }).ok).toBe(true)
    }
    expect(renderMermaidSVG('requirementDiagram\nrequirement r {\ntext: Card\n}\nr - traces -> r', { style: { roles: { relationship: { bendRadius: 12 } } } })).toMatch(/<path\b[^>]*d="[^"]*Q/)
  })
  test('unmodeled source stays opaque, and unresolved relations block partial rendering', () => {
    const unknown = parse('requirementDiagram\nnot a modeled statement')
    expect(unknown.ok).toBe(true)
    if (unknown.ok) expect(unknown.value.body.kind).toBe('opaque')
    expect(verifyMermaid('requirementDiagram\na - traces -> absent').ok).toBe(false)
  })
  test('independent field values survive canonical formatting', () => {
    fc.assert(
      fc.property(fc.array(fc.stringMatching(/^[A-Za-z0-9 ]{1,40}$/), { minLength: 1, maxLength: 8 }), texts => {
        const source = 'requirementDiagram\n' + texts.map((text, i) => `requirement r${i} {\nid: "ID-${i}"\ntext: "${text}"\n}\n`).join(''),
          body = structured(source),
          again = structured(serializeMermaid(body))
        expect(again.body.requirements.map(r => r.text)).toEqual(texts)
        expect(again.body.requirements.map(r => r.requirementId)).toEqual(texts.map((_, i) => `ID-${i}`))
      }),
      fcParameters({ numRuns: 40 }),
    )
  })
})
