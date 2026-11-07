import { afterAll, describe, expect, test } from 'bun:test'
import { mutate, parseRegisteredMermaid, renderMermaidASCII, renderMermaidSVG, serializeMermaid } from '../agent/core.ts'
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
    const copied = parseRegisteredMermaid(parsed.value.canonicalSource)
    if (!copied.ok) throw new Error('Expected executable copied TreeView source')
    expect(copied.value.body).toEqual(parsed.value.body)
    expect(parsed.value.source.edges.size).toBe(3)
    expect(renderMermaidSVG(parsed.value.canonicalSource)).toBe(renderMermaidSVG(source))
    expect(renderMermaidASCII(parsed.value.canonicalSource)).toBe(renderMermaidASCII(source))
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
    expect(chart.rows[1]!.icon?.text).toBe('R')
    expect(chart.rows[1]!.iconGraphic?.kind).toBe('fallback')
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

  test.each([
    ['    "same.txt" ## first', '    "same.txt" icon(none)', '"same.txt" ## first', 5],
    ['├── "same.txt" ## first', '└── leaf/', '├── "same.txt" ## first', 1],
  ] as const)('source owners retain complete TreeView productions: %s', (first, second, statement, col) => {
    const authored = ['---', 'theme: dark', '---', '%%{init: {"theme":"dark"}}%%', 'treeView-beta', 'accTitle: Files', 'root/', first, second].join('\r\n')
    const parsed = parseRegisteredMermaid(authored)
    if (!parsed.ok || parsed.value.body.kind !== 'treeview') throw Error('Expected wrapped TreeView')
    expect(parsed.value.source.nodes.size).toBe(3)
    expect(parsed.value.source.edges.size).toBe(2)
    for (const [kind, id] of [['nodes', 'treeview-1'], ['labels', 'node:treeview-1'], ['edges', 'branch:treeview-1']] as const) {
      const span = parsed.value.source.spans![kind].get(id)!
      expect(authored.slice(span.start.offset, span.end.offset)).toBe(statement)
      expect(span.start).toEqual({ line: 8, col, offset: authored.indexOf(statement) })
      expect(Object.isFrozen(span)).toBe(true)
      expect(Object.isFrozen(span.start)).toBe(true)
      expect(Object.isFrozen(span.end)).toBe(true)
    }
    const nodeLocation = parsed.value.source.nodes.get('treeview-1')!, labelLocation = parsed.value.source.labels.get('node:treeview-1')!, branchLocation = parsed.value.source.edges.get('branch:treeview-1')!
    expect(nodeLocation).toEqual(labelLocation)
    expect(nodeLocation).toEqual(branchLocation)
    nodeLocation.col = 999
    expect(labelLocation.col).toBe(col)
    expect(branchLocation.col).toBe(col)
    const copied = parseRegisteredMermaid(parsed.value.canonicalSource)
    if (!copied.ok) throw Error('Expected copied TreeView')
    expect(copied.value.body).toEqual(parsed.value.body)
  })

  test.each([
    ['LF', ['\n', '\n', '\n']],
    ['CRLF', ['\r\n', '\r\n', '\r\n']],
    ['CR', ['\r', '\r', '\r']],
    ['mixed', ['\r\n', '\r', '\n']],
  ] as const)('TreeView native and public coordinates retain %s physical rows', (_name, endings) => {
    const authored = `treeView-beta${endings[0]}src/${endings[1]}  child/${endings[2]}    "leaf.txt" ## Note`
    const native = parseTreeviewDiagram(authored)
    expect(native.nodes.map(({ label, parentId }) => ({ label, parentId }))).toEqual([
      { label: 'src', parentId: undefined }, { label: 'child', parentId: 'treeview-0' }, { label: 'leaf.txt', parentId: 'treeview-1' },
    ])
    const parsed = parseRegisteredMermaid(authored)
    if (!parsed.ok || parsed.value.body.kind !== 'treeview') throw Error('Expected TreeView physical rows')
    expect(parsed.value.body).toEqual(native)
    expect(parsed.value.source.edges.size).toBe(2)
    expect(parsed.value.source.nodes.get('treeview-2')).toEqual({ line: 4, col: 5 })
    for (const [kind, id] of [['nodes', 'treeview-2'], ['labels', 'node:treeview-2'], ['edges', 'branch:treeview-2']] as const) {
      const span = parsed.value.source.spans![kind].get(id)!
      expect(authored.slice(span.start.offset, span.end.offset)).toBe('"leaf.txt" ## Note')
      expect(span.start).toEqual({ line: 4, col: 5, offset: authored.indexOf('"leaf.txt"') })
    }
    const copied = parseRegisteredMermaid(parsed.value.canonicalSource)
    if (!copied.ok) throw Error('Expected copied TreeView physical rows')
    expect(copied.value.body).toEqual(native)
  })
})

test('empty TreeView description annotation has no description payload', () => {
  expect(parseTreeviewDiagram('treeView-beta\nroot ##').nodes[0]!.description).toBeUndefined()
})

test('TreeView structural edits return the canonical positional identities after moving into a later sibling', async () => {
  const source = `treeView-beta
title Workspace
accTitle: Files
accDescr: Keep annotations
first/
    twin.ts :::highlight icon(logos:react) ## Move this file
    stay.ts ## Keep this file
later/
    twin.ts icon(file) ## Keep the later twin
last.md icon(none)`
  const parsed = parseRegisteredMermaid(source)
  if (!parsed.ok || parsed.value.body.kind !== 'treeview') throw Error('Expected native TreeView')
  const original = structuredClone(parsed.value.body)
  const moved = mutate(parsed.value, { kind: 'move_node', id: 'treeview-1', parentId: 'treeview-3', index: 0 })
  if (!moved.ok || moved.value.body.kind !== 'treeview') throw Error(JSON.stringify(moved))
  const written = serializeMermaid(moved.value),
    again = parseRegisteredMermaid(written)
  if (!again.ok || again.value.body.kind !== 'treeview') throw Error('Expected native TreeView roundtrip')
  expect(moved.value.body).toEqual(again.value.body)
  expect(parsed.value.body).toEqual(original)
  const meaning = (body: typeof original) => body.nodes.map(node => ({ ...node, id: undefined, parentId: body.nodes.find(parent => parent.id === node.parentId)?.label }))
  expect(meaning(moved.value.body)).toEqual([
    { label: 'first', nodeType: 'directory', id: undefined, parentId: undefined },
    { label: 'stay.ts', nodeType: 'file', description: 'Keep this file', id: undefined, parentId: 'first' },
    { label: 'later', nodeType: 'directory', id: undefined, parentId: undefined },
    { label: 'twin.ts', nodeType: 'file', className: 'highlight', icon: 'logos:react', description: 'Move this file', id: undefined, parentId: 'later' },
    { label: 'twin.ts', nodeType: 'file', icon: 'file', description: 'Keep the later twin', id: undefined, parentId: 'later' },
    { label: 'last.md', nodeType: 'file', icon: 'none', id: undefined, parentId: undefined },
  ])
  expect(moved.value.body.title).toBe('Workspace')
  expect(moved.value.body.accessibilityTitle).toBe('Files')
  expect(moved.value.body.accessibilityDescription).toBe('Keep annotations')
  expect(renderMermaidSVG(moved.value)).toBe(renderMermaidSVG(written))
  expect(renderMermaidASCII(moved.value)).toBe(renderMermaidASCII(written))
  expect(await upstream.publicAccepts(written)).toBe(true)
  const later = moved.value.body.nodes.find(node => node.label === 'later')!
  const reordered = mutate(moved.value, { kind: 'move_node', id: later.id, index: 0 })
  if (!reordered.ok || reordered.value.body.kind !== 'treeview') throw Error(JSON.stringify(reordered))
  expect(reordered.value.body.nodes.map(node => node.label)).toEqual(['later', 'twin.ts', 'twin.ts', 'first', 'stay.ts', 'last.md'])
  expect(parseTreeviewDiagram(renderTreeview(reordered.value.body))).toEqual(reordered.value.body)
  const movedFile = reordered.value.body.nodes.find(node => node.description === 'Move this file')!
  const removed = mutate(reordered.value, { kind: 'remove_node', id: movedFile.id })
  if (!removed.ok || removed.value.body.kind !== 'treeview') throw Error(JSON.stringify(removed))
  const saved = serializeMermaid(removed.value),
    reloaded = parseRegisteredMermaid(saved)
  if (!reloaded.ok || reloaded.value.body.kind !== 'treeview') throw Error('Expected native TreeView after deletion')
  expect(removed.value.body).toEqual(reloaded.value.body)
  expect(removed.value.body.nodes.map(node => [node.id, node.label, node.parentId])).toEqual([
    ['treeview-0', 'later', undefined],
    ['treeview-1', 'twin.ts', 'treeview-0'],
    ['treeview-2', 'first', undefined],
    ['treeview-3', 'stay.ts', 'treeview-2'],
    ['treeview-4', 'last.md', undefined],
  ])
  expect(removed.value.body.nodes[1]).toMatchObject({ icon: 'file', description: 'Keep the later twin' })
  for (const node of removed.value.body.nodes) {
    const location = removed.value.source.nodes.get(node.id)
    if (!location) throw Error(`Missing canonical source address for ${node.id}`)
    const line = saved.split('\n')[location.line - 1]!
    expect(line).toContain(node.label)
    if (node.description) expect(line).toContain(node.description)
  }
  expect(renderMermaidSVG(removed.value)).toBe(renderMermaidSVG(saved))
  expect(renderMermaidASCII(removed.value)).toBe(renderMermaidASCII(saved))
})

test('TreeView renders offline icon artwork and compact honest fallbacks without token-sized layout', () => {
  const input = 'treeView-beta\nassets/ icon(folder)\n    database.ts icon(mdi:database)\n    unknown.ts icon(logos:react)\n    plain.ts icon(file)', svg = renderMermaidSVG(input)
  expect(svg).toContain('data-icon-realization="folder"')
  expect(svg).toContain('data-icon-realization="file"')
  expect(svg).toContain('data-icon-realization="bundled"')
  expect(svg).toContain('data-icon-realization="fallback"')
  expect(svg).toContain('data-icon="logos:react"')
  expect(svg).not.toContain('[logos:react]')
  expect(svg).not.toContain('[mdi:database]')
  expect(renderMermaidASCII(input)).toContain('[logos:react]')
})
