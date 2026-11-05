import { afterAll, describe, expect, test } from 'bun:test'
import { parseRegisteredMermaid, renderMermaidASCII, renderMermaidSVG, serializeMermaid } from '../agent/core.ts'
import type { AsciiContext } from '../agent/families.ts'
import { mutateTreeview, renderTreeview, TREEVIEW_SOURCE_HOOKS } from '../agent/treeview-body.ts'
import { serializeTerminalArtifact } from '../ascii/terminal-artifact.ts'
import { renderTreeviewTerminal } from '../ascii/treeview.ts'
import { treeviewRows } from '../treeview/hierarchy.ts'
import { layoutTreeviewDiagram } from '../treeview/layout.ts'
import { parseTreeviewDiagram } from '../treeview/parser.ts'
import { startUpstreamMermaid } from './helpers/upstream-mermaid.ts'

const upstream = startUpstreamMermaid()
afterAll(() => upstream.close())

const source = `treeView-beta
title Project
src/
    App.tsx :::highlight icon(logos:react) ## main component
    widgets/
        按钮.ts
README.md icon(none)`
const facts = (text: string) => parseTreeviewDiagram(text).nodes.map(({ id, ...node }) => node)

describe('native TreeView', () => {
  test('public parsing and rendering agree on typed hierarchy and preserve unknown source', () => {
    const parsed = parseRegisteredMermaid(source)
    if (!parsed.ok || parsed.value.body.kind !== 'treeview') throw new Error('Expected native TreeView')
    expect(renderMermaidASCII(parsed.value)).toBe(renderMermaidASCII(source))
    expect(renderMermaidSVG(parsed.value)).toBe(renderMermaidSVG(source))
    expect(facts(serializeMermaid(parsed.value))).toEqual(facts(source))
    const unknown = parseRegisteredMermaid('treeView-beta\n\"file\" unsupported(foo)')
    expect(unknown.ok && unknown.value.body).toMatchObject({ kind: 'opaque', family: 'treeview' })
  })
  test('indentation and box drawing preserve ordered hierarchy and annotations', () => {
    const box = `treeView-beta
title Project
src/
├── App.tsx :::highlight icon(logos:react) ## main component
└── widgets/
    └── 按钮.ts
README.md icon(none)`
    expect(parseTreeviewDiagram(box)).toEqual(parseTreeviewDiagram(source))
    expect(facts(source)).toEqual([
      { label: 'src', nodeType: 'directory', parentId: undefined },
      { label: 'App.tsx', nodeType: 'file', className: 'highlight', icon: 'logos:react', description: 'main component', parentId: 'treeview-0' },
      { label: 'widgets', nodeType: 'directory', parentId: 'treeview-0' },
      { label: '按钮.ts', nodeType: 'file', parentId: 'treeview-2' },
      { label: 'README.md', nodeType: 'file', icon: 'none', parentId: undefined },
    ])
    expect(() => parseTreeviewDiagram('treeView-beta\n"bad" unsupported(foo)')).toThrow('annotation')
    expect(() => parseTreeviewDiagram('treeView-beta\nroot\n└──')).toThrow('Empty')
  })

  test('portable writer protects control punctuation and retains metadata', async () => {
    const body = parseTreeviewDiagram(source)
    body.accessibilityTitle = 'File tree'
    body.accessibilityDescription = 'Names\nand descriptions'
    body.nodes[1]!.label = 'a "quote" #35; %%{ title'
    body.nodes[1]!.description = 'literal ## tags, 100% & #10;'
    const written = renderTreeview(body)
    expect(parseTreeviewDiagram(written)).toEqual(body)
    expect(await upstream.publicAccepts(written)).toBe(true)
  })

  test('typed subtree moves preserve children and reject cycles without mutation', () => {
    const body = parseTreeviewDiagram(source),
      before = structuredClone(body)
    const cycle = mutateTreeview(body, { kind: 'move_node', id: 'treeview-0', parentId: 'treeview-3' })
    expect(cycle.ok).toBe(false)
    expect(body).toEqual(before)
    const edited = mutateTreeview(body, { kind: 'move_node', id: 'treeview-2', index: 0 })
    expect(edited.ok).toBe(true)
    if (!edited.ok) return
    expect(treeviewRows(edited.value.nodes).map(row => row.node.label)).toEqual(['widgets', '按钮.ts', 'src', 'App.tsx', 'README.md'])
    expect(parseTreeviewDiagram(renderTreeview(edited.value)).nodes.map(node => node.label)).toEqual(['widgets', '按钮.ts', 'src', 'App.tsx', 'README.md'])
    const removed = mutateTreeview(body, { kind: 'remove_node', id: 'treeview-2' })
    expect(removed.ok && removed.value.nodes.map(node => node.label)).toEqual(['src', 'App.tsx', 'README.md'])
  })

  test('pixel rows reserve descriptions, preserve text and retain parent guides', () => {
    const body = parseTreeviewDiagram(source),
      chart = layoutTreeviewDiagram(body)
    expect(layoutTreeviewDiagram(body)).toEqual(chart)
    expect(chart.guides.map(guide => [guide.from, guide.to])).toEqual([
      ['treeview-0', 'treeview-1'],
      ['treeview-0', 'treeview-2'],
      ['treeview-2', 'treeview-3'],
    ])
    for (const [index, row] of chart.rows.entries()) {
      expect(row.x + row.width).toBeLessThan(chart.width)
      if (row.description) expect(row.descriptionX!).toBeGreaterThan(row.labelX + row.label.width)
      if (index) expect(row.y).toBeGreaterThanOrEqual(chart.rows[index - 1]!.y + chart.rows[index - 1]!.height)
    }
    expect(chart.rows[1]!.icon?.text).toBe('[logos:react]')
  })

  test('terminal tree draws sibling continuation guides and publishes parent ownership', () => {
    const artifact = renderTreeviewTerminal({ source: { familyBody: source, config: {} }, config: { useAscii: false }, options: {}, colorMode: 'none' } as AsciiContext)
    const text = serializeTerminalArtifact(artifact)
    expect(text).toContain('├── [logos:react] App.tsx  — main component')
    expect(text).toContain('└── widgets/')
    expect(text).toContain('    └── 按钮.ts')
    expect(artifact.document.regions().find(region => region.id === 'treeview-3')).toMatchObject({ parentId: 'treeview-2', projectedText: '按钮.ts' })
  })

  test('source maps follow authored rows through accessibility metadata', () => {
    const authored = 'treeView-beta\naccTitle: Files\nsrc/\n    main.ts'
    const map = TREEVIEW_SOURCE_HOOKS.buildSourceMap!(parseTreeviewDiagram(authored), authored)
    expect(map.nodes.get('treeview-0')).toEqual({ line: 3, col: 1 })
    expect(map.nodes.get('treeview-1')).toEqual({ line: 4, col: 5 })
  })
})

test('empty TreeView description annotation has no description payload', () => {
  expect(parseTreeviewDiagram('treeView-beta\nroot ##').nodes[0]!.description).toBeUndefined()
})
