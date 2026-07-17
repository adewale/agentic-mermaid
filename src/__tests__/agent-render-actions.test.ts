import { describe, expect, test } from 'bun:test'
import { parseRegisteredMermaid, renderMermaidWithActions } from '../agent/index.ts'
import { ParsedDiagramFamilyMismatchError } from '../render-contract.ts'
import type { ParsedDiagram } from '../agent/types.ts'
import { renderMermaidASCIIWithMeta } from '../ascii/meta.ts'

const SOURCE = `flowchart LR
  A[Docs] --> B[Done]
  click A href "https://example.com/docs"
`

describe('renderer-neutral action surface', () => {
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

  test('callback actions remain metadata-only on every surface', () => {
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

  test('duplicate terminal labels retain distinct hit regions', () => {
    const rendered = renderMermaidWithActions(
      'flowchart LR\n  A[Same] --> B[Same]\n  click B href "https://example.com"',
      { format: 'unicode', options: { colorMode: 'none' } },
    )
    expect(rendered.format).toBe('unicode')
    if (rendered.format !== 'unicode') throw new Error('expected Unicode artifact')
    const actionRegion = rendered.actionSurface.actions[0]!.region!
    expect(actionRegion.id).toBe('node:B')
    const labelRow = rendered.output.split('\n').find(line => line.includes('Same'))!
    expect(actionRegion.bounds.x).toBeGreaterThan(labelRow.indexOf('Same'))
  })

  test('duplicate flowchart labels follow final BT and normalized RL terminal placement', () => {
    const bt = renderMermaidWithActions(
      'flowchart BT\n  A[Same] --> B[Same]\n  click B href "https://example.com"',
      { format: 'unicode', options: { colorMode: 'none' } },
    )
    expect(Number(bt.actionSurface.actions[0]!.region?.bounds.y)).toBe(2)

    const rl = renderMermaidWithActions(
      'flowchart RL\n  A[Same] --> B[Same]\n  click B href "https://example.com"',
      { format: 'unicode', options: { colorMode: 'none' } },
    )
    if (rl.format !== 'unicode') throw new Error('expected Unicode artifact')
    const row = rl.output.split('\n').find(line => line.includes('Same'))!
    expect(rl.actionSurface.actions[0]!.region?.bounds.x).toBeGreaterThan(row.indexOf('Same'))
  })

  test('duplicate Class and State labels follow terminal topology', () => {
    const cls = renderMermaidWithActions(
      'classDiagram\n class A["Same"]\n class B["Same"]\n B <|-- A\n click B href "https://example.com"',
      { format: 'unicode', options: { colorMode: 'none' } },
    )
    expect(cls.format).toBe('unicode')
    if (cls.format === 'unicode') {
      expect(cls.actionSurface.actions[0]!.region).toEqual(expect.objectContaining({
        id: 'node:B', bounds: expect.objectContaining({ y: 1 }),
      }))
    }

    const state = renderMermaidASCIIWithMeta(
      'stateDiagram-v2\n direction BT\n state "Same" as A\n state "Same" as B\n A --> B',
      { colorMode: 'none' },
    )
    const region = state.regions.find(candidate => candidate.id === 'B')
    expect(region).toEqual(expect.objectContaining({ canvasRow: 2 }))
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
      expect(Number(action.region?.bounds.y)).toBe(rows.at(-1)!)
    }
  })

  test('class and namespace sharing an id retain separate terminal identities', () => {
    const source = 'classDiagram\n namespace A["A"] {\n class A["A"]\n }\n click A href "https://example.com"'
    const meta = renderMermaidASCIIWithMeta(source, { colorMode: 'none' })
    const namespace = meta.regions.find(region => region.id === 'A' && region.kind === 'cluster')
    const cls = meta.regions.find(region => region.id === 'A' && region.kind === 'node')
    expect(namespace).toBeDefined()
    expect(cls).toBeDefined()
    expect(cls!.canvasRow).toBeGreaterThan(namespace!.canvasRow)

    const rendered = renderMermaidWithActions(source, { format: 'unicode', options: { colorMode: 'none' } })
    expect(rendered.actionSurface.actions[0]!.region).toEqual(expect.objectContaining({
      id: 'node:A', bounds: expect.objectContaining({ y: cls!.canvasRow }),
    }))
  })

  test('terminal failures throw instead of returning an unmarked empty artifact', () => {
    expect(() => renderMermaidWithActions('not a diagram', { format: 'ascii' })).toThrow(/failed/i)
  })

  test('terminal action regions survive wrapped, markdown, entity, and explicit-break labels', () => {
    const cases = [
      { node: 'A["\`Target\`"]', options: {} },
      { node: 'A["Line<br>Break"]', options: {} },
      { node: 'A["Map&#x3C;K,V&#x3E;"]', options: {} },
      { node: 'A[This is a very long action label that must wrap]', options: { targetWidth: 40 } },
    ]
    for (const { node, options } of cases) {
      const rendered = renderMermaidWithActions(
        `flowchart LR\n  ${node} --> B[Done]\n  click A href "https://example.com"`,
        { format: 'unicode', options: { colorMode: 'none', ...options } },
      )
      expect(rendered.actionSurface.actions[0]).toEqual(expect.objectContaining({
        target: 'A', region: expect.objectContaining({ id: 'node:A' }),
      }))
    }
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
