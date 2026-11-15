import { describe, expect, test } from 'bun:test'
import { layoutMermaidWithReceipt, parseRegisteredMermaid, renderMermaidWithActions, renderMermaidSVG, renderMermaidPNG, toFinite } from '../agent/index.ts'
import { ParsedDiagramFamilyMismatchError } from '../render-contract.ts'
import type { ParsedDiagram } from '../agent/types.ts'
import { renderMermaidASCIIWithMeta } from '../ascii/meta.ts'
import { withPerformanceObserver } from '../performance-observations.ts'

const SOURCE = `flowchart LR
  A[Docs] --> B[Done]
  click A href "https://example.com/docs"
`

describe('renderer-neutral action surface', () => {
  test.each(['svg', 'png'] as const)('%s captures geometry options once for output and action regions', format => {
    let reads = 0
    const options = { get padding() { reads++; return 54 + (reads - 1) * 33 }, embedFontImport: false }
    let lookups = 0
    const artifact = withPerformanceObserver(event => {
      if (event.kind === 'cache' && event.owner === 'positioned-layout') lookups++
    }, () => renderMermaidWithActions(SOURCE, { format, options }))
    expect(reads).toBe(1)
    expect(lookups).toBe(1)
    const expected = format === 'svg'
      ? renderMermaidSVG(SOURCE, { padding: 54, embedFontImport: false })
      : renderMermaidPNG(SOURCE, { padding: 54, embedFontImport: false })
    expect(artifact.output).toEqual(expected)
    if (artifact.format === 'svg') {
      const drawn = /<rect x="([\d.]+)" y="([\d.]+)" width="([\d.]+)" height="([\d.]+)"[^>]*data-id="node-shape:A"/.exec(artifact.output)!.slice(1).map(Number)
      const { x, y, w, h } = artifact.actionSurface.actions[0]!.region!.bounds
      for (const [index, value] of [x, y, w, h].entries()) expect(Math.abs(value - drawn[index]!)).toBeLessThan(1)
    }
    const reference = renderMermaidWithActions(SOURCE, { format, options: { padding: 54, embedFontImport: false } })
    expect(artifact.actionSurface).toEqual(reference.actionSurface)
  })

  test('mutating returned action regions cannot change later layout or output', () => {
    const before = renderMermaidWithActions(SOURCE, { format: 'svg' })
    before.actionSurface.regions[0]!.bounds.w = toFinite(99999)
    const after = renderMermaidWithActions(SOURCE, { format: 'svg' })
    expect(after.output).toBe(before.output)
    expect(after.actionSurface.regions[0]!.bounds.w).not.toBe(99999)
    expect(layoutMermaidWithReceipt(SOURCE, { regions: true }).layout.regions).toEqual(expect.arrayContaining(after.actionSurface.regions))
  })

  test('SVG, PNG, and terminal output carry the same inert action and target region', () => {
    const svg = renderMermaidWithActions(SOURCE, { format: 'svg' })
    const png = renderMermaidWithActions(SOURCE, { format: 'png' })
    const ascii = renderMermaidWithActions(SOURCE, { format: 'ascii', options: { colorMode: 'none' } })

    expect(svg.output).toContain('<svg')
    expect([...png.output.slice(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10])
    expect(ascii.output).toContain('Docs')

    expect(svg.actionSurface.actions).toContainEqual(expect.objectContaining({
      target: 'A', href: 'https://example.com/docs', disposition: 'embedded-inert', executable: false,
      region: expect.objectContaining({ id: 'node:A' }),
    }))
    for (const artifact of [png, ascii]) {
      expect(artifact.actionSurface.actions).toContainEqual(expect.objectContaining({
        target: 'A', href: 'https://example.com/docs', disposition: 'sidecar-only', executable: false,
        region: expect.objectContaining({ id: 'node:A' }),
      }))
    }
    expect(svg.actionSurface.coordinateSpace).toBe('pixel')
    expect(png.actionSurface.coordinateSpace).toBe('pixel')
    expect(ascii.actionSurface.coordinateSpace).toBe('cell')
    const svgRegion = svg.actionSurface.actions[0]!.region!
    const pngRegion = png.actionSurface.actions[0]!.region!
    expect(pngRegion.bounds.w / svgRegion.bounds.w).toBeCloseTo(2, 1)
    expect(pngRegion.bounds.h / svgRegion.bounds.h).toBeCloseTo(2, 1)
  })

  test('callback actions remain metadata-only in SVG output', () => {
    const call = renderMermaidWithActions('flowchart LR\n  A\n  click A call doThing()', { format: 'svg' })
    expect(call.actionSurface.actions).toContainEqual(expect.objectContaining({
      action: 'call', disposition: 'sidecar-only', executable: false,
    }))
    const callback = renderMermaidWithActions('flowchart LR\n  A\n  click A myHandler(1)', { format: 'svg' })
    expect(callback.output).not.toContain('data-href=')
    expect(callback.actionSurface.actions).toContainEqual(expect.objectContaining({
      action: 'callback', raw: 'myHandler(1)', security: 'source-only',
      disposition: 'sidecar-only', executable: false,
    }))
  })

  test('quoted relative links retain href identity as inert sidecars', () => {
    for (const [href, security] of [
      ['click.html', 'safe'],
      ['javascript:alert(1)', 'unsafe'],
    ] as const) {
      const source = `flowchart LR\n  A\n  click A "${href}" "tooltip"`
      for (const format of ['svg', 'png', 'ascii'] as const) {
        const rendered = format === 'ascii'
          ? renderMermaidWithActions(source, { format, options: { colorMode: 'none' } })
          : renderMermaidWithActions(source, { format })
        expect(rendered.actionSurface.actions[0]).toEqual(expect.objectContaining({
          target: 'A', action: 'href', href, security,
          disposition: 'sidecar-only', executable: false,
        }))
      }
    }
  })

  test('class calls stay source-only while generic and backtick links share renderer identity', () => {
    const call = renderMermaidWithActions('classDiagram\n  class A\n  click A call doThing()', { format: 'svg' })
    expect(call.actionSurface.actions).toContainEqual(expect.objectContaining({
      target: 'A', action: 'call', security: 'source-only', disposition: 'sidecar-only',
    }))
    expect(call.output).not.toContain('data-href="call"')

    for (const target of ['List~T~', '`List Box`']) {
      const linked = renderMermaidWithActions(`classDiagram\n  class ${target}\n  click ${target} href "https://example.com/list"`, { format: 'svg' })
      expect(linked.actionSurface.actions[0]).toEqual(expect.objectContaining({
        target: target.startsWith('`') ? 'List Box' : 'List',
        disposition: 'embedded-inert',
        region: expect.objectContaining({ id: `node:${target.startsWith('`') ? 'List Box' : 'List'}` }),
      }))
    }
  })

  test('opaque Class actions retain visible terminal target regions', () => {
    const sources = [
      'classDiagram\n  class A\n  callback A "fn"',
      'classDiagram\n  class A\n  click A call fn()',
      'classDiagram\n  class A\n  link A "javascript:alert(1)"',
    ]
    for (const source of sources) {
      for (const format of ['ascii', 'unicode'] as const) {
        const rendered = renderMermaidWithActions(source, { format, options: { colorMode: 'none' } })
        expect(rendered.output).toContain('A')
        expect(rendered.actionSurface.actions[0]).toEqual(expect.objectContaining({
          target: 'A', disposition: 'sidecar-only', executable: false,
          region: expect.objectContaining({ id: 'node:A' }),
        }))
      }
    }
  })

  test('opaque Class actions retain nested terminal namespace identities', () => {
    const source = `classDiagram
  namespace Outer {
    namespace Inner {
      class A
    }
  }
  callback A "fn"`
    const meta = renderMermaidASCIIWithMeta(source, { colorMode: 'none' })
    expect(meta.regions).toContainEqual(expect.objectContaining({ id: 'Outer', kind: 'cluster' }))
    expect(meta.regions).toContainEqual(expect.objectContaining({ id: 'Outer.Inner', kind: 'cluster' }))
  })

  test('a target region covers its drawn target under a frontmatter title', () => {
    const rendered = renderMermaidWithActions(`---\ntitle: Docs flow\n---\n${SOURCE}`, { format: 'svg' })
    if (rendered.format !== 'svg') throw new Error('expected SVG artifact')
    const drawn = /<rect x="([\d.]+)" y="([\d.]+)" width="([\d.]+)" height="([\d.]+)"[^>]*data-id="node-shape:A"/.exec(rendered.output)!.slice(1).map(Number)
    const { x, y, w, h } = rendered.actionSurface.actions[0]!.region!.bounds
    for (const [index, value] of [x, y, w, h].entries()) expect(Math.abs(value - drawn[index]!)).toBeLessThan(1)
  })

  test('SVG disposition requires actual embedded metadata and a rendered target', () => {
    const missing = renderMermaidWithActions('flowchart LR\n  A\n  click Missing href "https://example.com"', { format: 'svg' })
    expect(missing.actionSurface.actions[0]).toEqual(expect.objectContaining({
      target: 'Missing', disposition: 'sidecar-only',
    }))
    expect(missing.actionSurface.actions[0]!.region).toBeUndefined()
  })

  test('strict SVG strips inert href text for flowchart and class targets', () => {
    for (const source of [
      'flowchart LR\n  A\n  click A href "https://secret.example/path"',
      'classDiagram\n  class A\n  click A href "https://secret.example/path"',
    ]) {
      const rendered = renderMermaidWithActions(source, { format: 'svg', options: { security: 'strict' } })
      expect(rendered.output).not.toContain('https://secret.example/path')
      expect(rendered.actionSurface.actions[0]).toEqual(expect.objectContaining({
        target: 'A', disposition: 'sidecar-only', executable: false,
      }))
    }
  })

  test('compound flowchart and compact namespace class links retain embedded action records', () => {
    const sources = [
      'flowchart LR\n  A; click A href "https://example.com/flow"',
      'classDiagram\n  namespace X { class A; click A href "https://example.com/class" }',
    ]
    for (const source of sources) {
      const rendered = renderMermaidWithActions(source, { format: 'svg' })
      expect(rendered.output).toContain('data-href="https://example.com/')
      expect(rendered.actionSurface.actions).toHaveLength(1)
      expect(rendered.actionSurface.actions[0]).toEqual(expect.objectContaining({
        target: 'A', disposition: 'embedded-inert', executable: false,
      }))
    }
  })

  test('Gantt href disposition matches data-task metadata when semantic data-id is also present', () => {
    const rendered = renderMermaidWithActions(`gantt
  dateFormat YYYY-MM-DD
  Build :build, 2024-01-01, 1d
  click build href https://example.com/build
`, { format: 'svg' })
    expect(rendered.output).toContain('data-task="build" data-href="https://example.com/build"')
    expect(rendered.actionSurface.actions[0]).toEqual(expect.objectContaining({
      target: 'build', disposition: 'embedded-inert', executable: false,
    }))
  })

  test.each([
    { direction: 'LR', axis: 'x' as const, sign: 1 },
    { direction: 'RL', axis: 'x' as const, sign: -1 },
    { direction: 'TD', axis: 'y' as const, sign: 1 },
    { direction: 'BT', axis: 'y' as const, sign: -1 },
  ])('duplicate terminal labels retain distinct hit regions in $direction', ({ direction, axis, sign }) => {
    const rendered = renderMermaidWithActions(
      `flowchart ${direction}\n A[Same] --> B[Same]\n click A href "https://example.com/a"\n click B href "https://example.com/b"`,
      { format: 'unicode', options: { colorMode: 'none' } },
    )
    if (rendered.format !== 'unicode') throw new Error('expected Unicode artifact')
    const a = rendered.actionSurface.actions.find(action => action.target === 'A')!.region!
    const b = rendered.actionSurface.actions.find(action => action.target === 'B')!.region!
    expect([a.id, b.id]).toEqual(['node:A', 'node:B'])
    expect((b.bounds[axis] - a.bounds[axis]) * sign).toBeGreaterThan(0)
    for (const region of [a, b]) {
      expect(region.cellSpans!.map(span => rendered.output.split('\n')[span.row]!.slice(span.start, span.end)).join('\n')).toContain('Same')
    }
    const aCells = new Set(a.cellSpans!.flatMap(span => Array.from({ length: span.end - span.start }, (_, offset) => `${span.row}:${span.start + offset}`)))
    expect(b.cellSpans!.some(span => Array.from({ length: span.end - span.start }, (_, offset) => aCells.has(`${span.row}:${span.start + offset}`)).some(Boolean))).toBe(false)
  })

  test('duplicate Class and State labels follow terminal topology', () => {
    const cls = renderMermaidWithActions(
      'classDiagram\n class A["Same"]\n class B["Same"]\n B <|-- A\n click A href "https://example.com/a"\n click B href "https://example.com/b"',
      { format: 'unicode', options: { colorMode: 'none' } },
    )
    expect(cls.format).toBe('unicode')
    if (cls.format === 'unicode') {
      const parent = cls.actionSurface.actions.find(action => action.target === 'B')!.region!
      const child = cls.actionSurface.actions.find(action => action.target === 'A')!.region!
      expect(parent.id).toBe('node:B')
      expect(parent.bounds.y + parent.bounds.h).toBeLessThan(child.bounds.y)
      expect(parent.cellSpans!.map(span => cls.output.split('\n')[span.row]!.slice(span.start, span.end)).join('\n')).toContain('Same')
    }

    const state = renderMermaidASCIIWithMeta(
      'stateDiagram-v2\n direction BT\n state "Same" as A\n state "Same" as B\n A --> B',
      { colorMode: 'none' },
    )
    const a = state.regions.find(candidate => candidate.id === 'A')!
    const b = state.regions.find(candidate => candidate.id === 'B')!
    expect(b.canvasRow).toBeLessThan(a.canvasRow)
    for (const region of [a, b]) expect(region.authoredTextCells!.map(cell => state.ascii.split('\n')[cell.row]![cell.column]).join('')).toBe('Same')
  })

  test('duplicate node/container text reserves container headers before action nodes', () => {
    for (const source of [
      'flowchart LR\n subgraph G[Same]\n A[Same]\n end\n click A href "https://example.com"',
      'classDiagram\n namespace N["Same"] {\n class A["Same"]\n }\n click A href "https://example.com"',
      'classDiagram\n namespace Outer["Same"] {\n namespace Inner {\n class A["Same"]\n }\n }\n click A href "https://example.com"',
    ]) {
      const rendered = renderMermaidWithActions(source, { format: 'unicode', options: { colorMode: 'none' } })
      expect(rendered.format).toBe('unicode')
      if (rendered.format !== 'unicode') continue
      const action = rendered.actionSurface.actions[0]!
      const rows = rendered.output.split('\n')
        .map((line, row) => line.includes('Same') ? row : -1)
        .filter(row => row >= 0)
      expect(rows.length).toBeGreaterThanOrEqual(2)
      const region = action.region!
      const nodeLabelRow = rows.at(-1)!
      expect(region.bounds.y).toBeLessThanOrEqual(nodeLabelRow)
      expect(region.bounds.y + region.bounds.h).toBeGreaterThan(nodeLabelRow)
      expect(region.cellSpans!.some(span => span.row === nodeLabelRow && rendered.output.split('\n')[span.row]!.slice(span.start, span.end).includes('Same'))).toBe(true)
      expect(region.cellSpans!.some(span => span.row === rows[0])).toBe(false)
    }
  })

  test.each([
    { id: 'A', parent: 'A', source: 'classDiagram\n namespace A["A"] {\n class A["A"]\n }\n click A href "https://example.com"' },
    { id: 'Outer.Inner', parent: 'Outer.Inner', source: 'classDiagram\n namespace Outer {\n namespace Inner {\n class `Outer.Inner`["Target"]\n }\n }\n click `Outer.Inner` href "https://example.com"' },
    { id: 'A', parent: 'Outer.Inner', source: 'classDiagram\n namespace Outer {\n namespace Inner {\n class A["Target"]\n }\n }\n click A href "https://example.com"' },
  ])('class $id and namespace $parent retain typed terminal parent identities', ({ id, parent, source }) => {
    const meta = renderMermaidASCIIWithMeta(source, { colorMode: 'none' })
    const namespace = meta.regions.find(region => region.id === parent && region.kind === 'cluster')
    const cls = meta.regions.find(region => region.id === id && region.kind === 'node')
    expect(namespace).toBeDefined()
    expect(cls).toBeDefined()
    expect(cls!.canvasRow).toBeGreaterThan(namespace!.canvasRow)
    expect(cls!.parentId).toBe(parent)
    for (const format of ['ascii', 'unicode'] as const) {
      const rendered = renderMermaidWithActions(source, { format, options: { colorMode: 'none' } })
      const region = rendered.actionSurface.actions[0]!.region!
      expect(region).toEqual(expect.objectContaining({
        id: `node:${id}`, parentId: `group:${parent}`, bounds: expect.objectContaining({ y: cls!.canvasRow }),
      }))
      expect(region.parentId).not.toBe(region.id)
    }
  })

  test('terminal failures throw instead of returning an unmarked empty artifact', () => {
    expect(() => renderMermaidWithActions('not a diagram', { format: 'ascii' })).toThrow(/failed/i)
  })

  test('escaped quoted hrefs match the inert SVG metadata they produced', () => {
    for (const authored of ['https://example.com/a\\"b', 'https://example.com/a\\\\b']) {
      const rendered = renderMermaidWithActions(
        `flowchart LR\n  A\n  click A href "${authored}"`,
        { format: 'svg' },
      )
      expect(rendered.actionSurface.actions[0]).toEqual(expect.objectContaining({ disposition: 'embedded-inert' }))
    }
  })

  test('backtick-bearing actions retain exact payload and embedded evidence', () => {
    const href = renderMermaidWithActions(
      'flowchart LR\n  A\n  click A href "https://example.com/`segment`"',
      { format: 'svg' },
    )
    expect(href.actionSurface.actions[0]).toEqual(expect.objectContaining({
      href: 'https://example.com/`segment`', disposition: 'embedded-inert',
    }))
    const call = renderMermaidWithActions(
      'flowchart LR\n  A\n  click A call doThing(`x`)',
      { format: 'svg' },
    )
    expect(call.actionSurface.actions[0]).toEqual(expect.objectContaining({
      action: 'call', raw: 'doThing(`x`)', disposition: 'sidecar-only',
    }))
  })

  test('class callbacks and sequence actor menus stay inert across renderers', () => {
    const cls = renderMermaidWithActions(
      'classDiagram\n class Shape\n callback Shape "callbackFunction" "tip"',
      { format: 'svg' },
    )
    expect(cls.actionSurface.actions[0]).toEqual(expect.objectContaining({
      target: 'Shape', action: 'callback', disposition: 'sidecar-only',
      region: expect.objectContaining({ id: 'node:Shape' }),
    }))

    const source = 'sequenceDiagram\n participant Alice\n link Alice: Dashboard @ https://example.com/dash'
    for (const format of ['svg', 'png', 'unicode'] as const) {
      const rendered = format === 'unicode'
        ? renderMermaidWithActions(source, { format, options: { colorMode: 'none' } })
        : renderMermaidWithActions(source, { format })
      expect(rendered.actionSurface.actions[0]).toEqual(expect.objectContaining({
        family: 'sequence', target: 'Alice', href: 'https://example.com/dash',
        disposition: format === 'svg' ? 'embedded-inert' : 'sidecar-only',
        region: expect.objectContaining({ id: 'node:Alice' }),
      }))
    }
    const strict = renderMermaidWithActions(source, { format: 'svg', options: { security: 'strict' } })
    expect(strict.output).not.toContain('https://example.com/dash')
    expect(strict.output).not.toContain('data-links=')
    expect(strict.actionSurface.actions[0]).toEqual(expect.objectContaining({ disposition: 'sidecar-only' }))
  })

  test('parsed family identity is enforced on every action-rendering surface', () => {
    const parsed = parseRegisteredMermaid('flowchart LR\n  A --> B')
    expect(parsed.ok).toBe(true)
    if (!parsed.ok || parsed.value.body.kind === 'extension' || parsed.value.body.kind === 'preserved') return
    const forged = { ...parsed.value, kind: 'class' as const } as ParsedDiagram
    for (const format of ['svg', 'png', 'ascii', 'unicode'] as const) {
      expect(() => renderMermaidWithActions(forged, { format } as Parameters<typeof renderMermaidWithActions>[1]))
        .toThrow(ParsedDiagramFamilyMismatchError)
    }
  })
})
