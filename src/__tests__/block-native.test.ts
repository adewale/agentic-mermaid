import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import fc from 'fast-check'
import { asBlock, layoutMermaid, mutate, parseRegisteredMermaid as parse, renderMermaidASCII, renderMermaidSVG, serializeMermaid, verifyMermaid } from '../agent/core.ts'
import { blockShapeNode, layoutBlockDiagram } from '../block/layout.ts'
import { parseBlockDiagram } from '../block/parser.ts'
import { blockDisplayText } from '../block/text.ts'
import type { Block, BlockBody, PositionedBlockDiagram } from '../block/types.ts'
import { lowerPositionedFamilyScene } from '../graphical-render.ts'
import { onShapeOutline, segmentThroughShape } from '../layout-rubric.ts'
import { positionResolvedFamily } from '../positioning.ts'
import { resolveRenderRequestForExecution } from '../render-contract.ts'
import type { GroupMark } from '../scene/ir.ts'
import { wcagContrastRatio } from '../shared/color-math.ts'
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
    // Low-level bodies may use a spacer as a route endpoint. It has geometry
    // even though it contributes no obstacle or painted node.
    const spacer = model.root.children!.find(node => node.type === 'space')!
    model.edges.push({ id: 'spacer-route', type: 'edge', start: spacer.id, end: 'd' })
    const routed = layoutBlockDiagram(model),
      edge = routed.edges.find(edge => edge.id === 'spacer-route')!,
      cell = routed.nodes.find(node => node.id === spacer.id)!,
      port = edge.points[0]!
    expect(edge.points.length).toBeGreaterThanOrEqual(2)
    expect(port.x === cell.x || port.x === cell.x + cell.width || port.y === cell.y || port.y === cell.y + cell.height).toBe(true)
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
    expect(renderMermaidSVG(source)).toContain('class="block-node dashed"')
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
  test('all retained class and inline paints are admitted before output projection', () => {
    for (const value of ['notacolor', 'rgb(x)', '#12345']) {
      for (const directive of ['classDef unused', 'classDef hot', 'style A']) {
        const source = `block\nA\n${directive} fill:${value}${directive === 'classDef hot' ? '\nclass A hot' : ''}`
        const named = `${directive}: fill ${JSON.stringify(value)} is not a CSS color`
        expect(() => renderMermaidSVG(source)).toThrow(named)
        for (const useAscii of [true, false]) expect(() => renderMermaidASCII(source, { useAscii })).toThrow(named)
        expect(verifyMermaid(source).warnings).toContainEqual({ code: 'RENDER_FAILED', reason: expect.stringContaining(named), origin: 'source' })
      }
    }
    for (const value of ['rgb(1,2,3)', 'hsl(120 100% 50%)', 'var(--brand)']) {
      const source = `block\nA\nclassDef hot fill:notacolor,fill:${value}\nclass A hot\nstyle A stroke:notacolor,stroke:#f96`
      expect(renderMermaidSVG(source)).toContain(`fill="${value}"`)
      expect(() => renderMermaidASCII(source)).not.toThrow()
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
    expect(renderMermaidSVG('block\ncolumns 3\nA B C\nA --> C', { style: { roles: { edge: { bendRadius: 12 } } } })).toMatch(/<path\b[^>]*d="[^"]*Q/)
    for (const columns of [1, 3])
      for (const directions of ['up', 'down', 'left', 'right', 'x', 'y', 'up,right', 'down,left']) {
        const source = `block\ncolumns ${columns}\nA<["Source"]>(${directions}) M["Obstacle"] B<["Target"]>(${directions})\nA <--> B`,
          p = layoutBlockDiagram(structured(source).body),
          edge = p.edges[0]!,
          svg = renderMermaidSVG(source)
        for (const [id, at, adjacent] of [
          ['A', 0, 1],
          ['B', edge.points.length - 1, edge.points.length - 2],
        ] as const) {
          const group = svg.match(new RegExp(`<g\\b[^>]*data-id="${id}"[^>]*>([\\s\\S]*?)<\\/g>`))![1]!,
            points = group
              .match(/<polygon\b[^>]*points="([^"]*)"/)![1]!
              .trim()
              .split(/\s+/)
              .map(pair => pair.split(',').map(Number)),
            point = edge.points[at]!,
            next = edge.points[adjacent]!
          // Contact is proved against the actual emitted polygon, independent
          // of the rectangular envelope used for conservative obstacle repair.
          expect(
            points.some(([x, y], index) => {
              const [nx, ny] = points[(index + 1) % points.length]!,
                dx = nx! - x!,
                dy = ny! - y!,
                t = Math.max(0, Math.min(1, ((point.x - x!) * dx + (point.y - y!) * dy) / (dx * dx + dy * dy)))
              return Math.hypot(point.x - x! - t * dx, point.y - y! - t * dy) < 1e-6
            }),
          ).toBe(true)
          expect(Math.abs(point.x - next.x) < 1e-6 !== Math.abs(point.y - next.y) < 1e-6).toBe(true)
        }
        const obstacle = blockShapeNode(p.nodes.find(node => node.id === 'M')!)
        for (let i = 1; i < edge.points.length; i++) expect(segmentThroughShape(edge.points[i - 1]!, edge.points[i]!, obstacle)).toBe(false)
        expect(svg).toContain('marker-start="url(#block-arrow-start)"')
        expect(svg).toContain('marker-end="url(#block-arrow-end)"')
      }
  })
  test('reciprocal and parallel labeled links occupy distinct clear routes without moving authored cells', () => {
    for (const columns of [1, 2]) {
      const cells = `block\ncolumns ${columns}\nA["API"] B["Database"]`,
        source = `${cells}\nA -- "Read" --> B\nB -- "Reply" --> A\nA -- "Write" --> B`,
        p = layoutBlockDiagram(structured(source).body),
        unlinked = layoutBlockDiagram(structured(cells).body),
        byId = new Map(p.nodes.map(node => [node.id, node]))
      expect(p.nodes.map(node => [node.id, node.width, node.height])).toEqual(unlinked.nodes.map(node => [node.id, node.width, node.height]))
      expect(new Set(p.edges.map(edge => JSON.stringify(edge.points)))).toHaveProperty('size', 3)
      for (const edge of p.edges) {
        expect(onShapeOutline(blockShapeNode(byId.get(edge.start!)!), edge.points[0]!)).toBe(true)
        expect(onShapeOutline(blockShapeNode(byId.get(edge.end!)!), edge.points.at(-1)!)).toBe(true)
        for (const node of p.nodes.filter(node => node.id !== edge.start && node.id !== edge.end)) for (let i = 1; i < edge.points.length; i++) expect(segmentThroughShape(edge.points[i - 1]!, edge.points[i]!, blockShapeNode(node))).toBe(false)
      }
      for (let i = 0; i < p.edges.length; i++)
        for (let j = i + 1; j < p.edges.length; j++) {
          const a = p.edges[i]!,
            b = p.edges[j]!
          expect(Math.abs(a.labelPosition.x - b.labelPosition.x) >= (a.labelBlock.width + b.labelBlock.width) / 2 + 12 || Math.abs(a.labelPosition.y - b.labelPosition.y) >= (a.labelBlock.height + b.labelBlock.height) / 2 + 8).toBe(true)
        }
      expect(verifyMermaid(source).ok).toBe(true)
      expect(renderMermaidSVG(source)).toContain('Write')
    }
  })
  test('diagonal cross-container input uses its near face instead of opposing a downstream output', () => {
    const source = readFileSync(new URL('../../eval/stable-families/fixtures/block.mmd', import.meta.url), 'utf8'),
      diagram = layoutBlockDiagram(structured(source).body),
      ingress = diagram.nodes.find(node => node.id === 'ingress')!,
      incoming = diagram.edges.find(edge => edge.start === 'sdk' && edge.end === 'ingress')!,
      outgoing = diagram.edges.find(edge => edge.start === 'ingress' && edge.end === 'queue')!
    expect(incoming.points.at(-1)).toEqual({ x: ingress.x, y: ingress.y + ingress.height / 2 })
    expect(outgoing.points[0]).toEqual({ x: ingress.x + ingress.width / 2, y: ingress.y + ingress.height })
    expect(incoming.points.at(-1)).not.toEqual(outgoing.points[0])
    const styled = positionResolvedFamily('block', resolveRenderRequestForExecution(source, { style: 'publication-figure' }, 'svg')).positioned as PositionedBlockDiagram
    for (const positioned of [diagram, styled]) for (const arrived of positioned.edges) for (const departing of positioned.edges) {
      if (arrived.end === departing.start && arrived.start !== arrived.end && departing.start !== departing.end) {
        expect(arrived.points.at(-1), `${arrived.id} and ${departing.id}: separate input/output contacts`).not.toEqual(departing.points[0])
      }
    }
    for (const edge of [incoming, outgoing]) {
      for (const node of diagram.nodes.filter(node => node.id !== edge.start && node.id !== edge.end && node.block.type !== 'composite' && node.block.type !== 'space')) {
        for (let index = 1; index < edge.points.length; index++) expect(segmentThroughShape(edge.points[index - 1]!, edge.points[index]!, blockShapeNode(node))).toBe(false)
      }
    }
    expect(verifyMermaid(source).ok).toBe(true)
    expect(renderMermaidSVG(source)).toContain('Batch')
    // The larger publication typography formerly placed Persist's opaque
    // label halo over the neighboring Audit input arrowhead.
    expect(() => renderMermaidSVG(source, { style: 'publication-figure', seed: 17, layoutSafety: 'strict' })).not.toThrow()
  })
  test('nested composites retain actual Scene containment and independent semantic Style roles', () => {
    const source = 'block\nblock:outer["Outer"]\nblock:inner["Inner"]\nA["API"]\nend\nend',
      options = { style: { roles: { node: { textColor: '#b91c1c' }, group: { textColor: '#174ea6', fontSize: 22, fontWeight: 800, paddingX: 36, paddingY: 28, cornerRadius: 17, lineWidth: 3, borderColor: '#008800', headerFillColor: '#fef3c7' } } } },
      request = resolveRenderRequestForExecution(source, options, 'svg'),
      scene = lowerPositionedFamilyScene(request, positionResolvedFamily('block', request)),
      outer = scene.parts.find(node => node.kind === 'group' && node.id === 'block:outer') as GroupMark,
      inner = outer?.children.find(({ node }) => node.kind === 'group' && node.id === 'block:inner')?.node as GroupMark,
      leaf = inner?.children.find(({ node }) => node.kind === 'group' && node.id === 'block:A')?.node as GroupMark
    expect(leaf).toBeDefined()
    const header = outer.children.find(({ node }) => node.kind === 'text')!.node
    expect(header).toMatchObject({ fontSize: 22, fontWeight: 800, paint: { fill: '#174ea6' } })
    expect(outer.children.find(({ node }) => node.kind === 'shape')!.node).toMatchObject({ geometry: { rx: 17 }, paint: { stroke: '#008800', strokeWidth: '3' } })
    expect(outer.children.find(({ node }) => node.id === 'header:outer')!.node).toMatchObject({ paint: { fill: '#fef3c7' } })
    expect(leaf.children.find(({ node }) => node.kind === 'text')!.node).toMatchObject({ paint: { fill: '#b91c1c' } })
    const svg = renderMermaidSVG(source, options)
    expect(svg).toContain('data-parent="outer"')
    expect(svg).toContain('data-parent="inner"')
    expect(verifyMermaid(source, { renderOptions: options }).ok).toBe(true)
    const darkHeader = renderMermaidSVG(source, { style: { roles: { group: { headerFillColor: '#000000' } } } })
    const headerInk = darkHeader.match(/<text\b[^>]*fill="([^"]*)"[^>]*>Outer<\/text>/)?.[1]
    expect(headerInk).toBeDefined()
    expect(wcagContrastRatio(headerInk!, '#000000')).toBeGreaterThanOrEqual(4.5)
    for (const [authored, styledInk, expectedInk] of [
      ['classDef chosen fill:#ffffff\nclass outer chosen', undefined, undefined],
      ['style outer fill:#ffffff', undefined, undefined],
      ['classDef chosen fill:#ffffff,color:#661122\nclass outer chosen', '#174ea6', '#661122'],
      ['style outer fill:#ffffff', '#174ea6', '#174ea6'],
    ] as const) {
      const authoredSource = `${source}\n${authored}`,
        renderOptions = { style: { colors: { bg: '#ffffff', fg: '#000000' }, roles: { group: { headerFillColor: '#000000', ...(styledInk ? { textColor: styledInk } : {}) } } } },
        authoredRequest = resolveRenderRequestForExecution(authoredSource, renderOptions, 'svg'),
        authoredScene = lowerPositionedFamilyScene(authoredRequest, positionResolvedFamily('block', authoredRequest)),
        authoredOuter = authoredScene.parts.find(node => node.kind === 'group' && node.id === 'block:outer') as GroupMark
      expect(authoredOuter.children.find(({ node }) => node.id === 'frame:outer')!.node).toMatchObject({ paint: { fill: '#ffffff' } })
      expect(authoredOuter.children.find(({ node }) => node.id === 'header:outer')!.node).toMatchObject({ paint: { fill: '#ffffff' } })
      if (expectedInk) expect(authoredOuter.children.find(({ node }) => node.id === 'label:outer')!.node).toMatchObject({ paint: { fill: expectedInk } })
      else {
        const actualInk = renderMermaidSVG(authoredSource, renderOptions).match(/<text\b[^>]*fill="([^"]*)"[^>]*>Outer<\/text>/)?.[1]
        expect(actualInk).toBe('#000000')
        expect(wcagContrastRatio(actualInk!, '#ffffff')).toBeGreaterThanOrEqual(4.5)
      }
    }
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
