import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { mutateMindmap, parseMindmapBody, renderMindmapBody, verifyMindmap } from '../agent/mindmap-body.ts'
import { mutate, parseRegisteredMermaid, renderMermaidASCII, renderMermaidSVG, serializeMermaid, verifyMermaid } from '../agent/index.ts'
import { startUpstreamMermaid } from './helpers/upstream-mermaid.ts'
import type { MindmapBody, MindmapMutationOp, MutationError, Result } from '../agent/types.ts'
import { projectEntityMarkers } from '../shared/mermaid-entity-display.ts'

function body(): MindmapBody {
  return {
    kind: 'mindmap',
    root: {
      id: 'root', label: 'root', shape: 'default',
      children: [
        { id: 'a', label: 'a', shape: 'default', children: [
          { id: 'leaf', label: 'leaf', shape: 'default', children: [] },
        ] },
        { id: 'box', label: 'Box label', shape: 'rect', icon: 'old-icon', className: 'old-class', children: [] },
        { id: 'dest', label: 'dest', shape: 'default', children: [] },
      ],
    },
  }
}

function apply(op: MindmapMutationOp, input = body()): MindmapBody {
  const result = mutateMindmap(input, op)
  expect(result.ok).toBe(true)
  if (!result.ok) throw new Error(result.error.message)
  return result.value
}

function expectError(
  op: MindmapMutationOp,
  code: MutationError['code'],
  message: string,
  input = body(),
): void {
  const result = mutateMindmap(input, op)
  expect(result).toEqual({ ok: false, error: { code, message } })
}

function child(input: MindmapBody, id: string) {
  const stack = [input.root]
  while (stack.length) {
    const node = stack.pop()!
    if (node.id === id) return node
    stack.push(...node.children)
  }
  return undefined
}

describe('Mindmap typed operations — discriminating mutation contract', () => {
  test('add_node inserts at the requested index, trims values, and does not mutate the input', () => {
    const input = body()
    const added = apply({ kind: 'add_node', id: '  inset  ', label: '  Inset label  ', parent: 'dest', shape: 'rounded', index: 0 }, input)
    expect(child(added, 'inset')).toEqual({ id: 'inset', label: 'Inset label', shape: 'rounded', children: [] })
    expect(child(added, 'dest')?.children.map(node => node.id)).toEqual(['inset'])
    expect(child(input, 'inset')).toBeUndefined()

    const appended = apply({ kind: 'add_node', id: 'tail', label: 'tail', parent: 'dest' }, added)
    expect(child(appended, 'dest')?.children.map(node => node.id)).toEqual(['inset', 'tail'])

    const decorated = { ...body(), accessibilityTitle: 'Title', accessibilityDescription: 'Description' }
    const withPreservedA11y = apply({ kind: 'add_node', id: 'extra', label: 'extra', parent: 'root' }, decorated)
    expect({ title: withPreservedA11y.accessibilityTitle, description: withPreservedA11y.accessibilityDescription })
      .toEqual({ title: 'Title', description: 'Description' })
  })

  test('add_node rejects every invalid identity, parent, shape, and index branch', () => {
    expectError({ kind: 'add_node', id: 42 as never, label: 'x', parent: 'root' }, 'INVALID_OP', 'Mindmap node id must be a non-empty single-line string')
    expectError({ kind: 'add_node', id: ' ', label: 'x', parent: 'root' }, 'INVALID_OP', 'Mindmap node id must be a non-empty single-line string')
    expectError({ kind: 'add_node', id: 'x', label: 'bad\nlabel', parent: 'root' }, 'INVALID_OP', 'Mindmap label must be a non-empty single-line string')
    expectError({ kind: 'add_node', id: 'a', label: 'a', parent: 'root' }, 'DUPLICATE_NODE', "Mindmap node 'a' already exists")
    expectError({ kind: 'add_node', id: 'x', label: 'x', parent: 'missing' }, 'NODE_NOT_FOUND', "Mindmap parent 'missing' not found")
    expectError({ kind: 'add_node', id: 'x', label: 'x', parent: 'root', shape: 'triangle' as never }, 'INVALID_OP', 'Mindmap shape must be one of: default, rect, rounded, circle, cloud, bang, hexagon')
    expectError({ kind: 'add_node', id: 'stable', label: 'Display', parent: 'root' }, 'INVALID_OP', 'A default mindmap node uses its label as identity; choose a bordered shape when id and label differ')
    for (const index of [-1, 0.5, 4]) {
      expectError({ kind: 'add_node', id: `x${index}`, label: `x${index}`, parent: 'root', index }, 'INVALID_OP', `Mindmap child index ${index} is out of range`)
    }
  })

  test('remove_node handles leaf, recursive subtree, missing, root, and non-recursive guards', () => {
    expect(child(apply({ kind: 'remove_node', id: 'leaf' }), 'leaf')).toBeUndefined()
    const recursive = apply({ kind: 'remove_node', id: 'a', recursive: true })
    expect(child(recursive, 'a')).toBeUndefined()
    expect(child(recursive, 'leaf')).toBeUndefined()
    expectError({ kind: 'remove_node', id: 'missing' }, 'NODE_NOT_FOUND', "Mindmap node 'missing' not found")
    expectError({ kind: 'remove_node', id: 'root' }, 'INVALID_OP', 'The mindmap root cannot be removed')
    expectError({ kind: 'remove_node', id: 'a' }, 'INVALID_OP', "Mindmap node 'a' has children; pass recursive:true to remove its subtree")
  })

  test('rename_node updates implicit labels but preserves explicit bordered labels', () => {
    const implicit = apply({ kind: 'rename_node', from: 'a', to: '  renamed  ' })
    expect(child(implicit, 'renamed')).toMatchObject({ label: 'renamed', shape: 'default' })
    const explicit = apply({ kind: 'rename_node', from: 'box', to: 'panel' })
    expect(child(explicit, 'panel')).toMatchObject({ label: 'Box label', shape: 'rect' })
    const equalExplicit = body()
    child(equalExplicit, 'box')!.label = 'box'
    expect(child(apply({ kind: 'rename_node', from: 'box', to: 'panel' }, equalExplicit), 'panel')?.label).toBe('box')
    expectError({ kind: 'rename_node', from: 'missing', to: 'x' }, 'NODE_NOT_FOUND', "Mindmap node 'missing' not found")
    expectError({ kind: 'rename_node', from: 'a', to: '\n' }, 'INVALID_OP', 'Mindmap rename target must be a non-empty single-line string')
    expectError({ kind: 'rename_node', from: 'a', to: 'dest' }, 'DUPLICATE_NODE', "Mindmap node 'dest' already exists")
  })

  test('set_label keeps bordered identity but intentionally renames default-shape identity', () => {
    expect(child(apply({ kind: 'set_label', id: 'a', label: 'a' }), 'a')?.label).toBe('a')
    const implicit = apply({ kind: 'set_label', id: 'a', label: 'renamed by label' })
    expect(child(implicit, 'renamed by label')).toMatchObject({ label: 'renamed by label', shape: 'default' })
    expect(child(implicit, 'a')).toBeUndefined()
    const explicit = apply({ kind: 'set_label', id: 'box', label: 'New display' })
    expect(child(explicit, 'box')?.label).toBe('New display')
    // A bordered node may display another node's id without changing identity.
    expect(child(apply({ kind: 'set_label', id: 'box', label: 'dest' }), 'box')?.label).toBe('dest')
    expectError({ kind: 'set_label', id: 'missing', label: 'x' }, 'NODE_NOT_FOUND', "Mindmap node 'missing' not found")
    expectError({ kind: 'set_label', id: 'a', label: ' ' }, 'INVALID_OP', 'Mindmap label must be a non-empty single-line string')
    expectError({ kind: 'set_label', id: 'a', label: 'dest' }, 'DUPLICATE_NODE', "Mindmap node 'dest' already exists")
  })

  test('default-node edits refuse escapes that would rename their bare identity token', () => {
    const unstable = ['A[B]', 'A(B)', 'A((B))', 'A{{B}}', 'A)B(', 'A))B((', '**A**', '"A"', '%%']
    for (const value of unstable) {
      for (const op of [
        { kind: 'rename_node', from: 'a', to: value },
        { kind: 'set_label', id: 'a', label: value },
        { kind: 'add_node', id: value, label: value, parent: 'root' },
      ] as const) {
        const input = body()
        expect(mutateMindmap(input, op).ok).toBe(false)
        expect(input).toEqual(body())
      }
    }

    const formatted = apply({ kind: 'add_node', id: 'formatted', label: '*Label*', parent: 'root', shape: 'rect' })
    expect(child(formatted, 'formatted')?.label).toBe('*Label*')
    expect(parseMindmapBody(renderMindmapBody(formatted))).toEqual(formatted)

    for (const value of ['A%%comment', 'a %% b']) {
      const edited = apply({ kind: 'set_label', id: 'a', label: value })
      expect(child(edited, value)?.label).toBe(value)
      expect(parseMindmapBody(renderMindmapBody(edited))).toEqual(edited)
    }

    const renamed = apply({ kind: 'rename_node', from: 'a', to: 'stable words' })
    expect(parseMindmapBody(renderMindmapBody(renamed))).toEqual(renamed)
  })

  test('move_node re-parents and orders nodes while rejecting missing, root, cycles, and bad indexes', () => {
    const moved = apply({ kind: 'move_node', id: 'leaf', parent: 'root', index: 1 })
    expect(moved.root.children.map(node => node.id)).toEqual(['a', 'leaf', 'box', 'dest'])
    expect(child(moved, 'a')?.children).toEqual([])
    const appended = apply({ kind: 'move_node', id: 'leaf', parent: 'dest' })
    expect(child(appended, 'dest')?.children.map(node => node.id)).toEqual(['leaf'])
    expectError({ kind: 'move_node', id: 'missing', parent: 'root' }, 'NODE_NOT_FOUND', "Mindmap node 'missing' not found")
    expectError({ kind: 'move_node', id: 'leaf', parent: 'missing' }, 'NODE_NOT_FOUND', "Mindmap parent 'missing' not found")
    expectError({ kind: 'move_node', id: 'root', parent: 'dest' }, 'INVALID_OP', 'The mindmap root cannot be moved')
    expectError({ kind: 'move_node', id: 'a', parent: 'leaf' }, 'INVALID_OP', "Cannot move 'a' into its own subtree")
    for (const index of [-1, 0.5, 1]) {
      expectError({ kind: 'move_node', id: 'leaf', parent: 'dest', index }, 'INVALID_OP', `Mindmap child index ${index} is out of range`)
    }
  })

  test('set_shape covers valid shapes and default-shape identity constraints', () => {
    for (const shape of ['rounded', 'circle', 'cloud', 'bang', 'hexagon', 'rect'] as const) {
      expect(child(apply({ kind: 'set_shape', id: 'a', shape }), 'a')?.shape).toBe(shape)
    }
    expect(child(apply({ kind: 'set_shape', id: 'a', shape: 'default' }), 'a')?.shape).toBe('default')
    expect(child(apply({ kind: 'set_shape', id: 'box', shape: 'circle' }), 'box')?.shape).toBe('circle')
    expectError({ kind: 'set_shape', id: 'missing', shape: 'rect' }, 'NODE_NOT_FOUND', "Mindmap node 'missing' not found")
    expectError({ kind: 'set_shape', id: 'a', shape: 'triangle' as never }, 'INVALID_OP', 'Mindmap shape must be one of: default, rect, rounded, circle, cloud, bang, hexagon')
    expectError({ kind: 'set_shape', id: 'box', shape: 'default' }, 'INVALID_OP', 'Default mindmap shape requires id and label to match')
    const delimiterId = parseMindmapBody('mindmap\n  (A[B)\n')
    const changedShape = apply({ kind: 'set_shape', id: 'A[B', shape: 'rect' }, delimiterId)
    expect(changedShape.root).toMatchObject({ id: 'A[B', label: 'A[B', shape: 'rect' })
    expect(parseMindmapBody(renderMindmapBody(changedShape))).toEqual(changedShape)
  })

  test('icon and class operations set, trim, clear, and validate', () => {
    expect(child(apply({ kind: 'set_icon', id: 'box', icon: '  mdi:cloud  ' }), 'box')?.icon).toBe('mdi:cloud')
    expect(child(apply({ kind: 'set_icon', id: 'box', icon: null }), 'box')?.icon).toBeUndefined()
    expectError({ kind: 'set_icon', id: 'missing', icon: 'x' }, 'NODE_NOT_FOUND', "Mindmap node 'missing' not found")
    expectError({ kind: 'set_icon', id: 'box', icon: 'bad\nicon' }, 'INVALID_OP', 'Mindmap icon must be a non-empty single-line string')
    for (const icon of ['mdi:bad)']) {
      expectError({ kind: 'set_icon', id: 'box', icon }, 'INVALID_OP', `Mindmap icon '${icon}' is not serialization-stable`)
    }

    expect(child(apply({ kind: 'set_node_class', id: 'box', className: '  critical  ' }), 'box')?.className).toBe('critical')
    expect(child(apply({ kind: 'set_node_class', id: 'box', className: null }), 'box')?.className).toBeUndefined()
    expectError({ kind: 'set_node_class', id: 'missing', className: 'x' }, 'NODE_NOT_FOUND', "Mindmap node 'missing' not found")
    expectError({ kind: 'set_node_class', id: 'box', className: '' }, 'INVALID_OP', 'Mindmap class must be a non-empty single-line string')
    for (const className of ['hot  cold']) {
      expectError({ kind: 'set_node_class', id: 'box', className }, 'INVALID_OP', `Mindmap class '${className}' is not serialization-stable`)
    }

    const decorated = apply({ kind: 'set_node_class', id: 'box', className: 'hot%%cut' }, apply({ kind: 'set_icon', id: 'box', icon: 'mdi:x%%cut' }))
    expect(parseMindmapBody(renderMindmapBody(decorated))).toEqual(decorated)
  })

  test('accessibility operations set, trim, clear, and validate independently', () => {
    const titled = apply({ kind: 'set_accessibility_title', title: '  Product map  ' })
    expect(titled.accessibilityTitle).toBe('Product map')
    expect(apply({ kind: 'set_accessibility_title', title: null }, titled).accessibilityTitle).toBeUndefined()
    expectError({ kind: 'set_accessibility_title', title: '\n' }, 'INVALID_OP', 'Mindmap accessibility title must be non-empty text')
    expect(apply({ kind: 'set_accessibility_title', title: 'Product%%cut' }).accessibilityTitle).toBe('Product%%cut')

    const described = apply({ kind: 'set_accessibility_description', description: '  Product hierarchy  ' })
    expect(described.accessibilityDescription).toBe('Product hierarchy')
    expect(apply({ kind: 'set_accessibility_description', description: null }, described).accessibilityDescription).toBeUndefined()
    expectError({ kind: 'set_accessibility_description', description: '' }, 'INVALID_OP', 'Mindmap accessibility description must be non-empty text')
    expect(apply({ kind: 'set_accessibility_description', description: 'Hierarchy%%cut' }).accessibilityDescription).toBe('Hierarchy%%cut')
  })

  test('unknown operations fail prescriptively', () => {
    const result = mutateMindmap(body(), { kind: 'teleport' } as never) as Result<MindmapBody, MutationError>
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.code).toBe('INVALID_OP')
      expect(result.error.message).toBe('Unknown mindmap op "teleport" — valid ops: add_node, remove_node, rename_node, set_label, move_node, set_shape, set_icon, set_node_class, set_accessibility_title, set_accessibility_description')
    }
  })

  test('verification walks nested nodes and honors the configured label cap', () => {
    const warnings = verifyMindmap(body(), { labelCharCap: 3 })
    expect(warnings.map(warning => warning.code)).toEqual([
      'LABEL_OVERFLOW', 'LABEL_OVERFLOW', 'LABEL_OVERFLOW', 'LABEL_OVERFLOW',
    ])
    expect(warnings.map(warning => warning.code === 'LABEL_OVERFLOW' ? warning.target : '')).toEqual(['root', 'leaf', 'box', 'dest'])
    expect(verifyMindmap(body(), { labelCharCap: 100 })).toEqual([])
  })
})


describe('Mindmap grammar escapes keep identity and native drawing', () => {
  let upstream: ReturnType<typeof startUpstreamMermaid>
  beforeAll(() => { upstream = startUpstreamMermaid() })
  afterAll(() => upstream.close())

  test('complete node productions protect style prepasses across identity and label fields', async () => {
    for (const [id, originalLabel, label] of [
      ['n', 'Child', 'style:a&'],
      ['style', 'Child', 'a:&'],
      ['classDef', 'Child', 'a:#35;'],
      ['n', '"`Child`"', 'style:a&'],
    ]) {
      const input = parseMindmapBody(`mindmap\nroot(Root)\n  ${id}[${originalLabel}]`)
      const next = apply({ kind: 'set_label', id: id!, label: label! }, input)
      const written = renderMindmapBody(next)
      expect(await upstream.publicAccepts('mindmap\nroot(Root)')).toBe(true)
      const result = await upstream.project(written, diagram => {
        const node = diagram.db.getMindmap().children[0]
        return { id: node.nodeId, label: node.descr }
      })
      expect(result.ok).toBe(true)
      if (!result.ok) throw new Error(result.error)
      expect(result.value.id).toBe(id!)
      expect(projectEntityMarkers(result.value.label)).toBe(label!)
      expect(parseMindmapBody(written)).toEqual(next)
    }
  })

  test('bare identity tokens retain benign ampersands and hashes without introducing entities', async () => {
    for (const name of ['R & D', 'A #B', 'style:a&', 'A]B', 'Say "hi" `tick`']) {
      const source = `mindmap\nroot\n  ${name}\n    Child`
      const parsed = parseRegisteredMermaid(source)
      if (!parsed.ok || parsed.value.body.kind !== 'mindmap') throw new Error('Expected typed Mindmap')
      const written = serializeMermaid(parsed.value)
      for (const candidate of [source, written]) {
        const result = await upstream.project(candidate, diagram => {
          const node = diagram.db.getMindmap().children[0]
          return { id: node.nodeId, label: node.descr, child: node.children[0].nodeId }
        })
        expect(result.ok).toBe(true)
        if (!result.ok) throw new Error(result.error)
        expect(result.value).toEqual({ id: name, label: name, child: 'Child' })
      }
      expect(parseMindmapBody(written)).toEqual(parsed.value.body)
      expect(renderMermaidSVG(parsed.value)).toBe(renderMermaidSVG(source))
      expect(renderMermaidASCII(parsed.value)).toBe(renderMermaidASCII(source))
    }
  })

  test('bare line-break tags keep their pinned identity through unrelated edits', async () => {
    for (const tag of ['<br/>', '<br>', '<BR >']) {
      const source = `mindmap\nroot(Root)\n  On effectiveness${tag}and features\n    Child\n    ::icon(fa fa-book)`
      const parsed = parseRegisteredMermaid(source)
      if (!parsed.ok || parsed.value.body.kind !== 'mindmap') throw new Error('Expected typed Mindmap')
      expect(parsed.value.body.root.children[0]).toMatchObject({ id: 'On effectiveness\nand features', label: 'On effectiveness\nand features' })
      const edited = mutate(parsed.value, { kind: 'set_label', id: 'root', label: 'Edited root' })
      if (!edited.ok || edited.value.body.kind !== 'mindmap') throw new Error('Expected typed edit')
      const written = serializeMermaid(edited.value)
      for (const candidate of [source, written]) {
        const reference = await upstream.project(candidate, diagram => {
          const node = diagram.db.getMindmap().children[0]
          return { id: node.nodeId, label: node.descr, children: node.children.map((child: any) => ({ id: child.nodeId, icon: child.icon })) }
        })
        expect(reference.ok).toBe(true)
        if (!reference.ok) throw new Error(reference.error)
        expect(reference.value).toEqual({ id: 'On effectiveness<br>and features', label: 'On effectiveness<br>and features', children: [{ id: 'Child', icon: 'fa fa-book' }] })
      }
      expect(parseMindmapBody(written)).toEqual(edited.value.body)
      expect(renderMermaidSVG(written)).toBe(renderMermaidSVG(edited.value))
      expect(renderMermaidASCII(written)).toBe(renderMermaidASCII(edited.value))
    }
  })

  test('unreconstructable bare identities retain source and refuse typed renaming', async () => {
    for (const name of ['R #35; D', 'R &amp; D', '**Bold**']) {
      const source = `mindmap\nroot\n  ${name}\n`
      expect(await upstream.publicAccepts(source)).toBe(true)
      const parsed = parseRegisteredMermaid(source)
      if (!parsed.ok) throw new Error(JSON.stringify(parsed.error))
      expect(parsed.value.body.kind).toBe('opaque')
      expect(serializeMermaid(parsed.value)).toBe(source)
      expect(mutate(parsed.value, { kind: 'rename_node', from: 'root', to: 'Edited' }).ok).toBe(false)
      expect(verifyMermaid(parsed.value).warnings).toContainEqual(expect.objectContaining({ code: 'UNSUPPORTED_SYNTAX', syntax: 'mindmap_nonportable_text' }))
      expect(renderMermaidSVG(parsed.value)).toBe(renderMermaidSVG(source))
      expect(renderMermaidASCII(parsed.value)).toBe(renderMermaidASCII(source))
    }
    for (const value of ['literal #35;', 'style:a# B;']) {
      const result = mutateMindmap(body(), { kind: 'add_node', id: value, label: value, parent: 'root' })
      expect(result.ok).toBe(false)
    }
  })

  test.each([
    'mindmap\n["```"]',
    'mindmap\nroot\n  ["`Say "hi"`"]\n    nested[Child]',
    'mindmap\nroot\n  {{%%{t}}\n    nested[Child]',
    'mindmap [%%{g]',
  ])('repairs label delimiters without changing source meaning: %s', async source => {
    expect(await upstream.accepts(source)).toBe(false)
    const parsed = parseRegisteredMermaid(source)
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) throw new Error(JSON.stringify(parsed.error))
    expect(parsed.value.body.kind).toBe('mindmap')
    const written = serializeMermaid(parsed.value)
    expect(await upstream.accepts(written)).toBe(true)
    if (parsed.value.body.kind !== 'mindmap') throw new Error('Expected Mindmap')
    expect(parseMindmapBody(written).root).toEqual(parsed.value.body.root)
    expect(renderMermaidSVG(written)).toBe(renderMermaidSVG(source))
    expect(renderMermaidASCII(written)).toBe(renderMermaidASCII(source))
    expect(renderMermaidSVG(parsed.value)).toBe(renderMermaidSVG(source))
    expect(renderMermaidASCII(parsed.value)).toBe(renderMermaidASCII(source))
    expect(verifyMermaid(parsed.value).warnings).toContainEqual(expect.objectContaining({ code: 'UNSUPPORTED_SYNTAX', syntax: 'mindmap_nonportable_text' }))
  })

  const unwritable: MindmapMutationOp[] = [
    { kind: 'set_icon', id: 'box', icon: 'fa:%%{text' },
    { kind: 'set_node_class', id: 'box', className: '%%{text' },
  ]
  test.each(unwritable)('typed edits cannot introduce a directive opener: %j', op => {
    const input = body()
    const before = renderMindmapBody(input)
    expect(mutateMindmap(input, op)).toMatchObject({ ok: false, error: { code: 'INVALID_OP' } })
    expect(renderMindmapBody(input)).toBe(before)
  })

  test.each(['Say "hi"', 'Use `tick`', '%%{text'])('Markdown edits retain literal delimiters: %s', async label => {
    const input = parseMindmapBody('mindmap\nroot["`Root`"]\n  child["`Child`"]')
    const next = apply({ kind: 'set_label', id: 'child', label }, input)
    const written = renderMindmapBody(next)
    expect(await upstream.accepts(written)).toBe(true)
    expect(parseMindmapBody(written)).toEqual(next)
    expect(child(next, 'child')?.label).toBe(label)
  })

  test('HTML formatting retains its syntax mode through unrelated edits and reloads', async () => {
    for (const label of ['<b>Bold</b>', '&lt;i&gt;Italic&lt;/i&gt; literal #42;star#42;']) {
      const source = `mindmap\nroot(${label})\n  child["\`**Markdown**\`"]`
      const input = parseMindmapBody(source)
      expect(input.root.markdown).toBeUndefined()
      expect(input.root.children[0]!.markdown).toBe(true)
      const written = renderMindmapBody(input)
      expect(parseMindmapBody(written)).toEqual(input)
      expect(await upstream.publicAccepts(written)).toBe(true)
      expect(renderMermaidSVG(written)).toBe(renderMermaidSVG(source))
      expect(renderMermaidASCII(written)).toBe(renderMermaidASCII(source))
      let next = apply({ kind: 'set_icon', id: 'root', icon: 'fa fa-tree' }, input)
      next = apply({ kind: 'set_node_class', id: 'root', className: 'highlight' }, next)
      expect(next.root).toEqual({ ...input.root, icon: 'fa fa-tree', className: 'highlight' })
      const exported = renderMindmapBody(next)
      expect(await upstream.publicAccepts(exported)).toBe(true)
      expect(parseMindmapBody(exported)).toEqual(next)
      // Accessibility is a documented native extension in this family.
      const titled = apply({ kind: 'set_accessibility_title', title: 'Formatted tree' }, next)
      expect(titled.root).toEqual(next.root)
      expect(titled.accessibilityTitle).toBe('Formatted tree')
      expect(parseMindmapBody(renderMindmapBody(titled))).toEqual(titled)
      expect(verifyMermaid(renderMindmapBody(titled)).warnings).toContainEqual(expect.objectContaining({ code: 'UNSUPPORTED_SYNTAX', syntax: 'mindmap_accessibility' }))
    }
  })

  test('ordinary quotes, percent text, nested identity and Markdown emphasis remain portable', async () => {
    let input = parseMindmapBody('mindmap\nroot["`Root`"]\n  child["`Child`"]\n    nested[Grandchild]')
    input = apply({ kind: 'set_label', id: 'child', label: '<b>Bold</b> %% text' }, input)
    input = apply({ kind: 'set_label', id: 'nested', label: 'Say "hi"' }, input)
    const written = renderMindmapBody(input)
    expect(await upstream.accepts(written)).toBe(true)
    expect(parseMindmapBody(written)).toEqual(input)
    expect(input.root.children[0]!.children[0]!.id).toBe('nested')
  })
})
