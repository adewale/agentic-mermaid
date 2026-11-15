import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import fc from 'fast-check'
import { asRequirement, layoutMermaid, mutate, parseRegisteredMermaid as parse, renderMermaidASCII, renderMermaidSVG, serializeMermaid, verifyMermaid } from '../agent/core.ts'
import { normalizeMermaidSource } from '../mermaid-source.ts'
import { layoutRequirementDiagram } from '../requirement/layout.ts'
import { parseRequirementDiagram } from '../requirement/parser.ts'
import type { RequirementBody } from '../requirement/types.ts'
import type { RenderOptions } from '../types.ts'
import { fcParameters } from './helpers/fc-parameters.ts'
import { renderMermaidASCIIWithMeta } from '../ascii/meta.ts'
import { decodedSvgAttributeValue, scanSvgStartTags } from '../svg-structure.ts'
import { synthesizeFromGraph } from '../agent/serialize.ts'
import { renderMermaidSVG as renderSourceSVG, renderMermaidASCII as renderSourceASCII } from '../index.ts'
import { startUpstreamMermaid } from './helpers/upstream-mermaid.ts'

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
  test('horizontal whitespace preserves declaration line breaks while malformed headers remain diagnosed source', async () => {
    const upstream = startUpstreamMermaid()
    try {
      for (const [header, declaration] of [['requirementDiagram ', 'requirement"_"{\n}'], ['requirementDiagram \t', 'requirement "__test_req__" {\nid:simulation 1\ntext: "First\nSecond"\n}'], ['requirement \t', 'requirement"_"{\n}']] as const) {
        const source = `${header}\n${declaration}`
        expect(await upstream.publicAccepts(source)).toBe(false)
        const diagram = structured(source)
        expect(diagram.body.requirements[0]!.name).toBe(declaration.includes('__test_req__') ? '__test_req__' : '_')
        expect(() => renderSourceSVG(source)).not.toThrow()
        expect(renderSourceASCII(source)).toContain(diagram.body.requirements[0]!.name)
        expect(verifyMermaid(source).warnings).toContainEqual(expect.objectContaining({ code: 'UNSUPPORTED_SYNTAX', syntax: 'requirement_whitespace', line: 1 }))
        const saved = serializeMermaid(diagram, { wrapper: 'canonical' })
        expect(await upstream.publicAccepts(saved)).toBe(true)
        expect(semantic(structured(saved).body)).toEqual(semantic(diagram.body))
        expect(renderSourceSVG(saved)).toBe(renderSourceSVG(source))
      }
      const control = 'requirementDiagram\n  \nrequirement r {\ntext: Plain text   \n}\n'
      expect(await upstream.publicAccepts(control)).toBe(true)
      expect(verifyMermaid(control).warnings).not.toContainEqual(expect.objectContaining({ syntax: 'requirement_whitespace' }))
      const source = 'requirement;Diagram\nrequirement valid {\ntext: Keep me\n}'
      const parsed = parse(source)
      if (!parsed.ok) throw Error('Malformed Requirement source must be preserved')
      expect(parsed.value.body.kind).toBe('opaque')
      expect(serializeMermaid(parsed.value).trimEnd()).toBe(source)
      expect(verifyMermaid(source).warnings).toContainEqual(expect.objectContaining({ code: 'RENDER_FAILED' }))
      expect(mutate(parsed.value, { kind: 'set_title', title: 'Changed' }).ok).toBe(false)
    } finally { upstream.close() }
  })
  test('raw entity-like style tokens preserve source and drawing while refusing typed output', async () => {
    const upstream = startUpstreamMermaid()
    try {
      for (const [id, token, gap] of [['i', '#a;', ''], ['t', '#q;', ''], ['n', '#123;', ''], ['key', 'font#quot;weight:bold', ' '], ['impo', '#a;rtantfill:#f96', ' ']] as const) {
        const source = `requirementDiagram\nrequirement e{\n}classDef ${id}${gap}${token}\n`
        const parsed = parse(source)
        if (!parsed.ok) throw new Error('Expected preserved Requirement')
        const native = parseRequirementDiagram(source)
        expect(native.classDefs).toMatchObject([{ id, styles: [token] }])
        expect(parsed.value.body.kind).toBe('opaque')
        expect(serializeMermaid(parsed.value)).toBe(source)
        expect(await upstream.accepts(source)).toBe(false)
        expect(renderMermaidSVG(parsed.value)).toBe(renderSourceSVG(source))
        expect(renderMermaidASCII(parsed.value)).toBe(renderSourceASCII(source))
        expect(verifyMermaid(parsed.value).warnings).toContainEqual(expect.objectContaining({ code: 'UNSUPPORTED_SYNTAX', syntax: 'requirement_style_token' }))
        expect(synthesizeFromGraph({ kind: 'requirement', body: native })).toMatchObject({ ok: false })
        expect(mutate(structured('requirementDiagram\nrequirement e {\n}'), { kind: 'define_class', name: id, style: token })).toMatchObject({ ok: false, error: { code: 'INVALID_OP' } })
      }
      for (const [directive, styles] of [
        ['style e font#quot;weight:bold', ['font#quot;weight:bold']],
        ['style e #a;rtantfill:#f96', ['#a;rtantfill:#f96']],
      ] as const) {
        const source = `requirementDiagram\nrequirement e {\n}\n${directive}\n`
        const parsed = parse(source)
        if (!parsed.ok) throw new Error('Expected preserved Requirement style')
        const native = parseRequirementDiagram(source)
        expect(directive.startsWith('style') ? native.requirements[0]?.directStyles : native.classDefs[0]?.styles).toEqual([...styles])
        expect(parsed.value.body.kind).toBe('opaque')
        expect(serializeMermaid(parsed.value)).toBe(source)
        expect(await upstream.publicAccepts(source)).toBe(false)
        expect(renderMermaidSVG(parsed.value)).toBe(renderSourceSVG(source))
        expect(renderMermaidASCII(parsed.value)).toBe(renderSourceASCII(source))
        expect(verifyMermaid(parsed.value).warnings).toContainEqual(expect.objectContaining({ code: 'UNSUPPORTED_SYNTAX', syntax: 'requirement_style_token' }))
        expect(synthesizeFromGraph({ kind: 'requirement', body: native })).toMatchObject({ ok: false })
      }
      const diagram = structured('requirementDiagram\nrequirement e {\n}')
      expect(mutate(diagram, { kind: 'set_node_style', id: 'e', style: 'font#quot;weight:bold' })).toMatchObject({ ok: false, error: { code: 'INVALID_OP' } })
      // The public style prepass strips the last entity-like semicolon.
      // Native output also requires valid CSS paint, as for other families.
      for (const token of ['fill:#abc;', 'fill:#123456;', 'fill:red;font#quot;weight:bold']) {
        const neighbor = structured(`requirementDiagram\nrequirement e {\n}\nclassDef safe ${token}`)
        const written = serializeMermaid(neighbor)
        expect(await upstream.publicAccepts(written)).toBe(true)
        expect(structured(written).body).toEqual(neighbor.body)
      }
      const edited = mutate(diagram, { kind: 'define_class', name: 'safe', style: 'fill:#abc;stroke:#123' })
      if (!edited.ok) throw new Error('Expected portable class definition')
      const written = serializeMermaid(edited.value)
      expect(await upstream.accepts(written)).toBe(true)
      expect(structured(written).body.classDefs).toMatchObject([{ id: 'safe', styles: ['fill:#abc', 'stroke:#123'] }])
    } finally { upstream.close() }
  })

  test('native CSS functions preserve source across every style target and refuse unspellable typed writes', async () => {
    const upstream = startUpstreamMermaid()
    const body = 'requirementDiagram\nrequirement A {\ntext: "Card"\n}'
    try {
      const control = `${body}\nstyle A fill:#f96,font-weight:650\n`
      for (const value of ['hsl(0 0% 0% / 0)', 'rgb(1,2,3)', 'var(--brand)']) {
        for (const directive of ['classDef hot', 'classDef unused', 'style A', 'style missing', 'style missing,A', 'style A,missing']) {
          const source = `${body}\n${directive} fill:${value}${directive === 'classDef hot' ? '\nclass A hot' : ''}\n`
          expect(() => renderMermaidSVG(source)).not.toThrow()
          expect(() => renderMermaidASCII(source)).not.toThrow()
          expect(await upstream.publicAccepts(source)).toBe(false)
          const escaped = value.replace(/[(), ]/g, char => `#${char.codePointAt(0)};`)
          expect(await upstream.publicAccepts(`${body}\n${directive} fill: ${escaped}\n`)).toBe(false)
          const reference = await upstream.project(control, diagram => diagram.db.getRequirements().get('A').cssStyles)
          expect(reference).toEqual({ ok: true, value: ['fill:#f96', 'font-weight:650'] })
          const parsed = parse(source)
          if (!parsed.ok) throw new Error(JSON.stringify(parsed.error))
          expect(parsed.value.body.kind).toBe('opaque')
          expect(serializeMermaid(parsed.value)).toBe(source)
          expect(renderMermaidSVG(parsed.value)).toBe(renderMermaidSVG(source))
          expect(renderMermaidASCII(parsed.value)).toBe(renderMermaidASCII(source))
          expect(verifyMermaid(source).warnings).toContainEqual(expect.objectContaining({ code: 'UNSUPPORTED_SYNTAX', syntax: 'requirement_style_token', message: expect.stringContaining('cannot spell losslessly') }))
        }
        const portable = structured(control)
        const before = serializeMermaid(portable)
        for (const op of [
          { kind: 'define_class', name: 'hot', style: `fill:${value}` },
          { kind: 'set_node_style', id: 'A', style: `fill:${value}` },
        ] as const) {
          expect(mutate(portable, op)).toMatchObject({ ok: false, error: { code: 'INVALID_OP', message: expect.stringContaining('cannot spell losslessly') } })
          expect(serializeMermaid(portable)).toBe(before)
        }
      }
    } finally { upstream.close() }
  })

  test('native font-family whitespace is retained before strict style admission', async () => {
    const upstream = startUpstreamMermaid()
    const body = 'requirementDiagram\nrequirement A {\ntext: "Card"\n}'
    try {
      for (const directive of ['classDef family', 'style A']) {
        const source = `${body}\n${directive} font-family:Foo Bar${directive.startsWith('classDef') ? '\nclass A family' : ''}\n`
        const native = parseRequirementDiagram(source)
        expect(native.requirements[0]!.cssStyles.join(',')).toContain('font-family:Foo Bar')
        const parsed = parse(source)
        if (!parsed.ok) throw new Error(JSON.stringify(parsed.error))
        expect(parsed.value.body.kind).toBe('opaque')
        expect(serializeMermaid(parsed.value)).toBe(source)
        expect(renderMermaidSVG(parsed.value)).toBe(renderMermaidSVG(source))
        const reference = await upstream.project(source, diagram => diagram.db.getRequirements().get('A').cssStyles)
        expect(reference).toEqual({ ok: true, value: ['font-family:FooBar'] })
        expect(verifyMermaid(source).warnings).toContainEqual(expect.objectContaining({ code: 'UNSUPPORTED_SYNTAX', syntax: 'requirement_style_token', message: expect.stringContaining('meaningful whitespace') }))
      }
      const portable = structured(`${body}\nstyle A font-family:Arial`)
      const before = serializeMermaid(portable)
      for (const op of [
        { kind: 'define_class', name: 'family', style: 'font-family:Foo Bar' },
        { kind: 'set_node_style', id: 'A', style: 'font-family:Foo Bar' },
      ] as const) {
        expect(mutate(portable, op)).toMatchObject({ ok: false, error: { code: 'INVALID_OP', message: expect.stringContaining('meaningful whitespace') } })
        expect(serializeMermaid(portable)).toBe(before)
      }
    } finally { upstream.close() }
  })

  test('typed comma-list values cannot lose grouping before style construction', async () => {
    const upstream = startUpstreamMermaid()
    const body = 'requirementDiagram\nrequirement A {\ntext: "Card"\n}'
    try {
      const portable = structured(`${body}\nstyle A font-family:Inter,stroke-dasharray:2`)
      const before = serializeMermaid(portable)
      for (const [property, first, second] of [['font-family', 'Inter', 'serif'], ['stroke-dasharray', '2', '3']] as const) {
        const reference = await upstream.project(`${body}\nstyle A ${property}:${first},${second}`, diagram => diagram.db.getRequirements().get('A').cssStyles)
        expect(reference).toEqual({ ok: true, value: [`${property}:${first}`, second] })
        const control = await upstream.project(`${body}\nstyle A ${property}:${first}`, diagram => diagram.db.getRequirements().get('A').cssStyles)
        expect(control).toEqual({ ok: true, value: [`${property}:${first}`] })
        for (const op of [
          { kind: 'define_class', name: 'list', style: `${property}:${first}\\,${second}` },
          { kind: 'set_node_style', id: 'A', style: `${property}:${first}\\,${second}` },
        ] as const) {
          expect(mutate(portable, op)).toMatchObject({ ok: false, error: { code: 'INVALID_OP', message: expect.stringContaining('splits into separate fields') } })
          expect(serializeMermaid(portable)).toBe(before)
        }
      }
    } finally { upstream.close() }
  })

  test('quoted lone CR identities survive structural line endings across native surfaces', () => {
    const names = ['A\rB', 'A\nB', 'C\nD']
    for (const ending of ['\n', '\r', '\r\n']) {
      const wrapper = ['---', 'title: Requirement identities', '---', '%%{init: {}}%%', ''].join(ending)
      const source = wrapper + [
        'requirementDiagram', 'accTitle: Distinct records',
        'requirement "A\rB" {', 'id: one', 'text: "First\rfield"', '}',
        'requirement "A\nB" {', 'id: two', 'text: second', '}',
        'requirement "C\r\nD" {', 'id: three', 'text: third', '}',
        '"A\rB" - traces -> "A\nB"',
      ].join(ending)
      const parsed = structured(source)
      expect(parsed.body.requirements.map(node => node.name)).toEqual(names)
      expect(parsed.body.requirements.map(node => node.requirementId)).toEqual(['one', 'two', 'three'])
      expect(parsed.body.requirements[0]?.text).toBe('First\rfield')
      expect(parsed.body.accessibilityTitle).toBe('Distinct records')
      expect(parsed.meta.wrapperSource).toBe(wrapper)
      expect(structured(serializeMermaid(parsed)).body).toEqual(parsed.body)
      expect(layoutMermaid(parsed).nodes.map(node => node.id)).toEqual(names)
      const authoredNames = ['A\rB', 'A\nB', 'C\r\nD']
      for (const [index, name] of names.entries()) {
        const span = parsed.source.spans?.labels.get(`node:${name}`)
        expect(span).toBeDefined()
        expect(source.slice(span!.start.offset, span!.end.offset)).toBe(authoredNames[index]!)
      }
      for (const renderedSource of [source, source.replace('requirementDiagram', 'requirement&#68;iagram'), source.replace(/^---/, '&#45;&#45;&#45;')]) {
        const tags = scanSvgStartTags(renderMermaidSVG(renderedSource, { embedFontImport: false }))
        const ids = tags.filter(tag => decodedSvgAttributeValue(tag, 'class')?.split(/\s+/).includes('requirement-node')).map(tag => decodedSvgAttributeValue(tag, 'data-id'))
        expect(ids).toEqual(names)
        for (const input of [renderedSource, parsed]) {
          const terminal = renderMermaidASCIIWithMeta(input, { colorMode: 'none' })
          expect(terminal.warnings).not.toContainEqual(expect.objectContaining({ code: 'ASCII_RENDER_FAILED' }))
          expect(terminal.regions.filter(region => region.kind === 'node').map(region => region.id).sort()).toEqual([...names].sort())
        }
      }
    }
  })
  test('raw requirement strings retain CRLF payloads while structural CR delimits tokens', () => {
    const body = parseRequirementDiagram('requirementDiagram\rrequirement "A\r\r\nB" {\rid: "ID\r\n1"\rtext: "Text\rfield"\r}\relement proof {\rtype: suite\r}\rproof - traces -> "A\r\r\nB"')
    expect(body.requirements[0]).toMatchObject({ name: 'A\r\r\nB', requirementId: 'ID\r\n1', text: 'Text\rfield' })
    expect(body.relations[0]).toMatchObject({ src: 'proof', dst: 'A\r\r\nB' })
  })
  test('rendered requirement identities decode XML once beside preserved CR payloads', () => {
    const source = 'requirementDiagram\nrequirement "A&amp;amp;\rB" {\ntext: first\n}\nrequirement "A&amp;\nB" {\ntext: second\n}'
    const names = ['A&amp;\rB', 'A&\nB']
    const tags = scanSvgStartTags(renderMermaidSVG(source, { embedFontImport: false }))
    expect(tags.filter(tag => decodedSvgAttributeValue(tag, 'class')?.split(/\s+/).includes('requirement-node')).map(tag => decodedSvgAttributeValue(tag, 'data-id'))).toEqual(names)
    expect(renderMermaidASCIIWithMeta(source, { colorMode: 'none' }).regions.filter(region => region.kind === 'node').map(region => region.id)).toEqual(names)
  })
  test('a retained CR next to normalized CRLF survives serialization and typed edits', () => {
    const source = 'requirementDiagram\nrequirement "A\r\r\nB" {\nid: "ID\r\r\n1"\ntext: "Text\r\r\nfield"\n}\nelement proof {\ntype: suite\n}\nproof - traces -> "A\r\r\nB"'
    const parsed = structured(source), name = 'A\r\nB'
    expect(parsed.body.requirements[0]).toMatchObject({ name, requirementId: 'ID\r\n1', text: 'Text\r\nfield' })
    const canonical = serializeMermaid(parsed)
    expect(structured(canonical).body).toEqual(parsed.body)
    expect(serializeMermaid(structured(canonical))).toBe(canonical)
    const changed = mutate(parsed, { kind: 'update_requirement', id: name, changes: { risk: 'High' } })
    expect(changed.ok).toBe(true)
    if (!changed.ok) return
    expect(asRequirement(changed.value)?.body.requirements[0]).toMatchObject({ name, requirementId: 'ID\r\n1', text: 'Text\r\nfield', risk: 'High' })
    expect(layoutMermaid(parsed).nodes.map(node => node.id)).toContain(name)
    for (const input of [source, parsed, changed.value]) {
      const terminal = renderMermaidASCIIWithMeta(input, { colorMode: 'none' })
      expect(terminal.regions.filter(region => region.kind === 'node').map(region => region.id)).toContain(name)
    }
  })
  test('accessibility-looking physical rows in quoted Requirement payloads remain text', () => {
    const name = 'A\raccTitle: hidden\rB', field = 'Before\raccDescr: hidden\rafter'
    const source = `requirementDiagram\nrequirement "${name}" {\ntext: "${field}"\n}`
    const parsed = structured(source)
    expect(parsed.body.requirements[0]).toMatchObject({ name, text: field })
    expect(parsed.meta.accessibility).toEqual({})
    expect(parsed.body.accessibilityTitle).toBeUndefined()
    expect(parsed.body.accessibilityDescription).toBeUndefined()
    expect(structured(serializeMermaid(parsed)).body).toEqual(parsed.body)
  })
  test('Requirement-like accessibility text cannot capture a later declaration label span', () => {
    const source = '---\ntitle: T\n---\nrequirementDiagram\naccDescr {\n  requirement "A" {\n}\n  requirement "A" {\n    text: hello\n  }'
    const parsed = structured(source), span = parsed.source.spans?.labels.get('node:A')
    expect(span).toBeDefined()
    expect(source.slice(span!.start.offset, span!.end.offset)).toBe('A')
    expect(span!.start.line).toBe(8)
    expect(span!.start.col).toBe(16)
  })
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
  const spacingBody = (direction: 'TB' | 'LR') => `requirementDiagram\ndirection ${direction}\nrequirement a {\ntext: First input\n}\nrequirement b {\ntext: Second input\n}\nrequirement c {\ntext: Shared result\n}\na - traces -> c\nb - traces -> c`
  const withSpacing = (body: string, nodeSpacing: unknown, rankSpacing: unknown) => `---\nconfig:\n  requirement:\n    nodeSpacing: ${JSON.stringify(nodeSpacing)}\n    rankSpacing: ${JSON.stringify(rankSpacing)}\n---\n${body}`
  const gaps = (layout: ReturnType<typeof layoutMermaid>, direction: 'TB' | 'LR') => {
    const a = layout.nodes.find(node => node.id === 'a')!,
      b = layout.nodes.find(node => node.id === 'b')!,
      c = layout.nodes.find(node => node.id === 'c')!
    const [left, right] = [a, b].sort((l, r) => direction === 'TB' ? l.x - r.x : l.y - r.y)
    return direction === 'TB'
      ? { sibling: right!.x - left!.x - left!.w, rank: c.y - Math.max(a.y + a.h, b.y + b.h) }
      : { sibling: right!.y - left!.y - left!.h, rank: c.x - Math.max(a.x + a.w, b.x + b.w) }
  }
  test('family spacing reaches public geometry through frontmatter, init and explicit config', () => {
    for (const direction of ['TB', 'LR'] as const) {
      const body = spacingBody(direction),
        baseline = layoutMermaid(structured(body)),
        config = { requirement: { nodeSpacing: 120, rankSpacing: 180 } }
      const requests: { source: string; options: RenderOptions }[] = [
        { source: withSpacing(body, 120, 180), options: {} },
        { source: `%%{init: ${JSON.stringify(config)}}%%\n${body}`, options: {} },
        { source: body, options: { mermaidConfig: config } },
      ]
      for (const { source, options } of requests) {
        const diagnostics: string[] = [],
          observed = { ...options, onConfigDiagnostic: (diagnostic: { field: string }) => diagnostics.push(diagnostic.field) },
          parsed = structured(source),
          layout = layoutMermaid(parsed, observed),
          spaced = gaps(layout, direction)
        expect(spaced.sibling, `${direction}: authored sibling clearance`).toBeGreaterThanOrEqual(119)
        expect(spaced.rank, `${direction}: authored rank clearance`).toBeGreaterThan(gaps(baseline, direction).rank + 100)
        expect(layout.nodes.map(node => node.id).sort()).toEqual(['a', 'b', 'c'])
        expect(parsed.body.relations.map(edge => [edge.src, edge.dst, edge.type])).toEqual([['a', 'c', 'traces'], ['b', 'c', 'traces']])
        expect(layoutMermaid(structured(serializeMermaid(parsed)), options).nodes).toEqual(layout.nodes)
        const svg = renderMermaidSVG(source, observed),
          size = /viewBox="0 0 ([\d.]+) ([\d.]+)"/.exec(svg)!
        // Public pixel bounds round outward; SVG retains subpixel dimensions.
        expect(Math.abs(Number(size[1]) - layout.bounds.w)).toBeLessThan(1)
        expect(Math.abs(Number(size[2]) - layout.bounds.h)).toBeLessThan(1)
        expect(diagnostics).toEqual([])
        expect(verifyMermaid(source, { renderOptions: options }).warnings.filter(warning => warning.code === 'INEFFECTIVE_CONFIG')).toEqual([])
      }
    }
  })
  test('explicit spacing overrides family config and zero remains a real spacing value', () => {
    const body = spacingBody('TB'),
      options = { nodeSpacing: 0, layerSpacing: 0 },
      expected = layoutMermaid(structured(body), options)
    expect(layoutMermaid(structured(withSpacing(body, 120, 180)), options).nodes).toEqual(expected.nodes)
    expect(layoutMermaid(structured(withSpacing(body, 0, 0))).nodes).toEqual(expected.nodes)
    expect(gaps(expected, 'TB').sibling).toBeLessThan(120)
    expect(layoutMermaid(structured(withSpacing(body, 120, 180)), { mermaidConfig: { requirement: { nodeSpacing: 0, rankSpacing: 0 } } }).nodes).toEqual(expected.nodes)
  })
  test('invalid family spacing warns and retains default geometry', () => {
    const body = spacingBody('TB'),
      expected = layoutMermaid(structured(body))
    for (const invalid of [-1, '120', null]) {
      const source = withSpacing(body, invalid, invalid),
        warnings = verifyMermaid(source).warnings.filter(warning => warning.code === 'INEFFECTIVE_CONFIG')
      expect(warnings.map(warning => warning.field)).toEqual(['requirement.nodeSpacing', 'requirement.rankSpacing'])
      expect(warnings.every(warning => warning.message.includes('finite non-negative number'))).toBe(true)
      expect(layoutMermaid(structured(source)).nodes).toEqual(expected.nodes)
    }
  })
  test('authored dash lengths retain native paint while unspellable typed edits fail atomically', async () => {
    const source = 'requirementDiagram\nrequirement A {\ntext: "Card"\n}\nclassDef dashed stroke-dasharray:5 5\nclass A dashed\n'
    expect(renderMermaidSVG(source)).toContain('stroke-dasharray="5 5"')
    expect(renderMermaidSVG(source)).toMatch(/<g\b[^>]*class="[^"]*\bdashed\b[^"]*"[^>]*data-id="A"/)
    const upstream = startUpstreamMermaid()
    try {
      expect(await upstream.project(source, diagram => diagram.db.getRequirements().get('A').cssStyles)).toEqual({ ok: true, value: ['stroke-dasharray:55'] })
      expect(await upstream.project(source.replace('5 5', '5'), diagram => diagram.db.getRequirements().get('A').cssStyles)).toEqual({ ok: true, value: ['stroke-dasharray:5'] })
    } finally { upstream.close() }
    const preserved = parse(source)
    if (!preserved.ok) throw new Error(JSON.stringify(preserved.error))
    expect(preserved.value.body.kind).toBe('opaque')
    expect(serializeMermaid(preserved.value)).toBe(source)
    const parsed = structured('requirementDiagram\nrequirement A {\ntext: "Card"\n}\nclassDef dashed stroke-dasharray:5\nclass A dashed')
    const before = serializeMermaid(parsed)
    const changed = mutate(parsed, { kind: 'set_node_style', id: 'A', style: 'stroke-dasharray:2 3' })
    expect(changed).toMatchObject({ ok: false, error: { code: 'INVALID_OP', message: expect.stringContaining('meaningful whitespace') } })
    expect(serializeMermaid(parsed)).toBe(before)
  })
  test('all retained class and inline paints are admitted before output projection', () => {
    const body = 'requirementDiagram\nrequirement A {\ntext: "Card"\n}'
    for (const value of ['notacolor', 'rgb(x)', '#12345', 'rgb(1,2,3))', 'rgb (1,2,3)', 'rgb(1,2,3)(4)', 'rgb(1,2,3']) {
      for (const [directive, subject] of [
        ['classDef unused', 'classDef unused'], ['classDef hot', 'classDef hot'], ['style A', 'style A'],
        ['style missing', 'style missing'], ['style missing,A', 'style missing'], ['style A,missing', 'style A'],
      ]) {
        const source = `${body}\n${directive} fill:${value}${directive === 'classDef hot' ? '\nclass A hot' : ''}`
        const named = `${subject}: fill ${JSON.stringify(value)} is not a CSS color`
        expect(() => renderMermaidSVG(source)).toThrow(named)
        for (const useAscii of [true, false]) expect(() => renderMermaidASCII(source, { useAscii })).toThrow(named)
        expect(verifyMermaid(source).warnings).toContainEqual({ code: 'RENDER_FAILED', reason: expect.stringContaining(named), origin: 'source' })
      }
    }
    for (const value of ['rgb(1,2,3)', 'hsl(120 100% 50%)', 'var(--brand)']) {
      const source = `${body}\nclassDef hot fill:notacolor,fill:${value}\nclass A hot\nstyle A stroke:notacolor\nstyle A stroke:#f96\nstyle missing fill:notacolor\nstyle missing fill:${value}`
      expect(renderMermaidSVG(source)).toContain(`fill="${value}"`)
      expect(() => renderMermaidASCII(source)).not.toThrow()
    }
    for (const [directives, subject] of [
      ['style A fill:notacolor\nstyle missing,A fill:red', 'style A'],
      ['style missing,A fill:notacolor\nstyle A fill:red', 'style missing'],
      ['style A fill:red\nstyle missing,A fill:notacolor', 'style A'],
      ['style A fill:notacolor\nstyle missing,A fill:red\nclassDef hot fill:blue\nclass A hot', 'style A'],
    ]) {
      const source = `${body}\n${directives}`
      const named = `${subject}: fill "notacolor" is not a CSS color`
      expect(() => parseRequirementDiagram(source)).toThrow(named)
      expect(() => renderMermaidSVG(source)).toThrow(named)
      for (const useAscii of [true, false]) expect(() => renderMermaidASCII(source, { useAscii })).toThrow(named)
      expect(verifyMermaid(source).warnings).toContainEqual({ code: 'RENDER_FAILED', reason: expect.stringContaining(named), origin: 'source' })
    }
    for (const directives of [
      'style A fill:notacolor\nstyle A,missing fill:red',
      'style A fill:notacolor\nstyle missing,A fill:red\nstyle A fill:red',
      'classDef hot fill:notacolor\nclass A hot\nclassDef hot fill:red',
      'classDef hot fill:notacolor\nclassDef hot fill:red\nclass A hot',
    ]) {
      const source = `${body}\n${directives}`
      expect(renderMermaidSVG(source)).toContain('fill="red"')
      expect(() => renderMermaidASCII(source)).not.toThrow()
    }
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
  // Reduced from the structural all-families fuzz: a relation back to an
  // earlier rank leaves the face opposite the flow, so face demand counted
  // before placement left a horizontal card too short for both ports.
  test.each(['LR', 'RL', 'TB', 'BT'])('reciprocal relations in direction %s allocate distinct terminal ports on both cards', direction => {
    const source = `requirementDiagram\n  direction ${direction}\n  requirement a {\n  }\n  requirement b {\n  }\n  a - contains -> b\n  b - derives -> a\n  a - traces -> b`
    const terminal = renderMermaidASCIIWithMeta(source, { colorMode: 'none' })
    expect(terminal.warnings).not.toContainEqual(expect.objectContaining({ code: 'ASCII_RENDER_FAILED' }))
    const ports = terminal.regions.filter(region => region.kind === 'edge').map(region => region.ports?.map(({ nodeId, end }) => `${end}:${nodeId}`))
    expect(ports.sort()).toEqual([['start:a', 'end:b'], ['start:a', 'end:b'], ['start:b', 'end:a']])
    const cells = terminal.regions.flatMap(region => region.ports?.map(({ x, y }) => `${x},${y}`) ?? [])
    expect(new Set(cells).size).toBe(cells.length)
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
