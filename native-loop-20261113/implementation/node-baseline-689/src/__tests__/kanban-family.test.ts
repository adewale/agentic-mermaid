import { expect, test } from 'bun:test'
import fc from 'fast-check'
import { collectActionRecords } from '../agent/analyze.ts'
import { asKanban, layoutMermaidWithReceipt, mutate, parseRegisteredMermaid, serializeMermaid, verifyMermaid } from '../agent/index.ts'
import { mutateKanban, parseKanbanBody, renderKanban } from '../agent/kanban-body.ts'
import { renderMermaidASCIIWithMeta } from '../ascii/meta.ts'
import { decodedSvgAttributeValue, scanSvgStartTags } from '../svg-structure.ts'
import { renderMermaidASCII } from '../ascii/index.ts'
import { renderMermaidSVG } from '../index.ts'
import { kanbanTicketUrl } from '../kanban/config.ts'
import { layoutKanbanDiagram } from '../kanban/layout.ts'
import { withParserObservation } from '../shared/parser-observation.ts'
import { normalizeMermaidSource } from '../mermaid-source.ts'
import { kanbanStatementEnds, parseKanbanDiagram } from '../kanban/parser.ts'
import { fcParameters } from './helpers/fc-parameters.ts'
import { startUpstreamMermaid } from './helpers/upstream-mermaid.ts'
import { projectEntityMarkers } from '../shared/mermaid-entity-display.ts'

test('Kanban nested metadata aliases remain writable after an edit shares nested values', async () => {
  const upstream = startUpstreamMermaid()
  try {
    const source = 'kanban\nTodo\n  card[Work]@{\n    first: &shared\n      value: A&amp;amp; B\n    second: *shared\n  }'
    const parsed = parseRegisteredMermaid(source)
    if (!parsed.ok) throw Error('Kanban alias metadata must parse')
    const diagram = asKanban(parsed.value)!
    expect(diagram.body.columns[0]!.tasks[0]!.metadata).toEqual({ first: { value: 'A&amp; B' }, second: { value: 'A&amp; B' } })
    const shared = { value: 'A&amp; B' }
    const edited = mutate(diagram, { kind: 'set_task_metadata', id: 'card', metadata: { first: shared, second: shared } })
    expect(edited.ok).toBe(true)
    if (!edited.ok) throw Error(edited.error.message)
    const saved = serializeMermaid(edited.value, { wrapper: 'canonical' })
    expect(await upstream.publicAccepts(saved)).toBe(true)
    const reloaded = parseRegisteredMermaid(saved)
    if (!reloaded.ok) throw Error('Saved Kanban metadata must parse')
    expect(asKanban(reloaded.value)!.body.columns[0]!.tasks[0]!.metadata).toEqual({ first: { value: 'A&amp; B' }, second: { value: 'A&amp; B' } })
  } finally { upstream.close() }
})

test('Kanban metadata preserves literal entity markers and authored codes through YAML and public edits', async () => {
  const upstream = startUpstreamMermaid()
  try {
    const parsed = parseRegisteredMermaid('kanban\nTodo\n  card[Work]')
    if (!parsed.ok) throw Error('Kanban must parse')
    const strings = ['ﬂ°°35¶ß', 'ﬂ°quot¶ß', 'ﬂ°', '¶ß', '#35;', '#quot;', '\uE00035\uE000', '\\uFB02°°35¶ß', 'ﬂ°°35¶ß "a}b" #quot; & %%{text}']
    for (const nested of [false, true]) {
      const metadata = Object.fromEntries(strings.map(value => [value, nested ? { [value]: [value, { value }] } : value]))
      const edited = mutate(asKanban(parsed.value)!, { kind: 'set_task_metadata', id: 'card', metadata })
      if (!edited.ok) throw Error(edited.error.message)
      const saved = serializeMermaid(edited.value, { wrapper: 'canonical' })
      expect(await upstream.publicAccepts(saved)).toBe(true)
      expect(parseKanbanDiagram(saved).columns[0]!.tasks[0]!.metadata).toEqual(metadata)
      const reloaded = parseRegisteredMermaid(saved)
      if (!reloaded.ok) throw Error('Saved Kanban metadata must parse')
      expect(asKanban(reloaded.value)!.body.columns[0]!.tasks[0]!.metadata).toEqual(metadata)
    }
    const source = 'kanban\nTodo\n  card[Work]@{ "ﬂ°°35¶ß": "literal ﬂ°quot¶ß", "\\uFB02°°35¶ß escaped": "\\uFB02°°35¶ß", code: #quot;, collision: "\\uE00035\\uE000", numeric: #35; }'
    const expected = { 'ﬂ°°35¶ß': 'literal ﬂ°quot¶ß', 'ﬂ°°35¶ß escaped': 'ﬂ°°35¶ß', code: '#quot;', collision: '\uE00035\uE000', numeric: '#35;' }
    expect(parseKanbanDiagram(source).columns[0]!.tasks[0]!.metadata).toEqual(expected)
    const observed = parseRegisteredMermaid(source)
    if (!observed.ok) throw Error('Authored Kanban metadata must parse')
    expect(asKanban(observed.value)!.body.columns[0]!.tasks[0]!.metadata).toEqual(expected)
    for (const [key, fragment] of [['ﬂ°°35¶ß', '"literal ﬂ°quot¶ß"'], ['ﬂ°°35¶ß escaped', '"\\uFB02°°35¶ß"'], ['code', '#quot;'], ['numeric', '#35;']]) {
      const span = observed.value.source.spans?.metadata?.get('card')?.get(key!)?.value
      expect(span).toBeDefined()
      expect(source.slice(span!.start.offset, span!.end.offset)).toBe(fragment!)
    }
    const aliases = 'kanban\nTodo\n  card[Work]@{\n first: &shared\n  "ﬂ°°35¶ß": #quot;\n second: *shared\n}'
    expect(parseKanbanDiagram(aliases).columns[0]!.tasks[0]!.metadata).toEqual({ first: { 'ﬂ°°35¶ß': '#quot;' }, second: { 'ﬂ°°35¶ß': '#quot;' } })
    for (const [label, display] of [['Override', 'Override'], ['ﬂ°°35¶ß', 'ﬂ°°35¶ß'], ['#35;', '#'], ['#quot;', '"']]) {
      const metadata = label === '#35;' ? { label, details: { note: 'ﬂ°°35¶ß' } } : { label }
      const edited = mutate(asKanban(parsed.value)!, { kind: 'set_task_metadata', id: 'card', metadata })
      if (!edited.ok) throw Error(edited.error.message)
      expect(asKanban(edited.value)!.body.columns[0]!.tasks[0]!.label).toBe(display!)
      const saved = serializeMermaid(edited.value, { wrapper: 'canonical' })
      expect(await upstream.publicAccepts(saved)).toBe(true)
      if (label !== 'ﬂ°°35¶ß') {
        const reference = await upstream.project(saved, diagram => diagram.db.getData().nodes.find((node: any) => node.id === 'card').label)
        if (!reference.ok) throw Error(reference.error)
        expect(projectEntityMarkers(String(reference.value))).toBe(display!)
      }
      expect(parseKanbanDiagram(saved).columns[0]!.tasks[0]).toMatchObject({ label: display, metadata: { label } })
      const reloaded = parseRegisteredMermaid(saved)
      if (!reloaded.ok) throw Error('Metadata label must reload')
      expect(asKanban(reloaded.value)!.body.columns[0]!.tasks[0]).toMatchObject({ label: display, metadata: { label } })
      const added = mutate(asKanban(parsed.value)!, { kind: 'add_task', id: 'new', column: 'Todo', label: 'Declaration', metadata: { ...metadata, icon: 'star' } })
      if (!added.ok) throw Error(added.error.message)
      expect(asKanban(added.value)!.body.columns[0]!.tasks[1]).toMatchObject({ label: display, icon: 'star', metadata: { label } })
      expect(parseKanbanDiagram(serializeMermaid(added.value, { wrapper: 'canonical' })).columns[0]!.tasks[1]).toMatchObject({ label: display, metadata: { label } })
      const implicit = parseRegisteredMermaid('kanban\nTodo\n [Implicit]')
      if (!implicit.ok) throw Error('Implicit card must parse')
      const renamed = mutate(asKanban(implicit.value)!, { kind: 'set_task_label', id: 'Implicit', label: label! })
      if (!renamed.ok) throw Error(renamed.error.message)
      expect(parseKanbanDiagram(serializeMermaid(renamed.value, { wrapper: 'canonical' })).columns[0]!.tasks[0]).toMatchObject({ sourceId: 'Implicit', label })
    }
    for (const body of ['"#35;": first, "\\x2335;": last', 'nested:\n  "#35;": first\n  "\\x2335;": last']) {
      expect(() => parseKanbanDiagram(`kanban\nTodo\n card[Work]@{${body}}`)).toThrow('duplicate metadata key')
    }
  } finally { upstream.close() }
})

test('Kanban XML transport references retain displayed identities, parents and metadata through saving and editing', async () => {
  const upstream = startUpstreamMermaid()
  try {
    for (const [source, id, label] of [
      ['kanban\nr&#35;oot\n  child[Child]', 'r#oot', 'r#oot'],
      ['kanban\n&#35;    root@{ i }', '#    root', '#    root'],
      ["kanban\n&#35;    root@{ icon: star, label: 'x things' }", '#    root', 'x things'],
      ['kanban\nr&amp;amp;oot\n  child[Child]@{assigned: "A&amp;amp; B"}', 'r&amp;oot', 'r&amp;oot'],
    ] as const) {
      const parsed = parseRegisteredMermaid(source)
      if (!parsed.ok) throw Error('Kanban must parse')
      const diagram = asKanban(parsed.value)!
      expect(diagram.body.columns[0]).toMatchObject({ id, sourceId: id, label })
      const span = diagram.source.spans?.labels.get(`group:${id}`)
      expect(span).toBeDefined()
      expect(source.slice(span!.start.offset, span!.end.offset)).toBe(source.split('\n')[1]!.split('@{')[0]!)
      const saved = serializeMermaid(diagram, { wrapper: 'canonical' })
      expect(await upstream.publicAccepts(saved)).toBe(true)
      const records = (text: string) => scanSvgStartTags(renderMermaidSVG(text)).filter(tag => tag.name === 'g' && decodedSvgAttributeValue(tag, 'data-id') !== undefined).map(tag => [decodedSvgAttributeValue(tag, 'data-id'), decodedSvgAttributeValue(tag, 'data-parent')])
      expect(records(saved)).toEqual(records(source))
      expect(renderMermaidSVG(saved)).toContain(label.replaceAll('&', '&amp;'))
      if (diagram.body.columns[0]!.tasks.length) {
        expect(diagram.body.columns[0]!.tasks[0]!.id).toBe('child')
        if (source.includes('assigned:')) {
          expect(diagram.body.columns[0]!.tasks[0]!.metadata.assigned).toBe('A&amp; B')
          const reloaded = parseRegisteredMermaid(saved)
          if (!reloaded.ok) throw Error('Saved Kanban must parse')
          expect(asKanban(reloaded.value)!.body.columns[0]!.tasks[0]!.metadata.assigned).toBe('A&amp; B')
        }
        const edited = mutate(diagram, { kind: 'set_task_label', id: 'child', label: 'Edited' })
        if (!edited.ok) throw Error(edited.error.message)
        expect(records(serializeMermaid(edited.value))).toEqual([[id, undefined], ['child', id]])
        const terminal = renderMermaidASCIIWithMeta(edited.value, { colorMode: 'none' })
        expect(terminal.regions.filter(region => region.kind === 'band').map(region => region.id)).toEqual([id])
        expect(terminal.ascii).toContain('Edited')
      } else expect(diagram.body.columns[0]!.metadata).toEqual(source.includes('icon:') ? { icon: 'star', label: 'x things' } : { i: null })
    }
  } finally { upstream.close() }
})

test('Kanban group padding reserves real space around cards independently of node padding', () => {
  const source = 'kanban\n  todo[To do]\n    work[日本 delivery]@{assigned: "Alice"}\n  done[Done]',
    style = { roles: { group: { paddingX: 40, paddingY: 37 }, node: { paddingX: 12, paddingY: 11 } } },
    layout = layoutMermaidWithReceipt(source, { style }).layout,
    group = layout.groups.find(group => group.id === 'todo')!,
    card = layout.nodes.find(node => node.id === 'work')!
  expect(card.x - group.x).toBe(40)
  expect(group.x + group.w - card.x - card.w).toBe(40)
  expect(card.y - group.y).toBeGreaterThanOrEqual(37 + 32)
  expect(group.y + group.h - card.y - card.h).toBeGreaterThanOrEqual(37)
  expect(renderMermaidSVG(source, { style })).toContain('日本 delivery')
})

test('Kanban explicit viewport width wraps columns in authored order without shrinking text or losing membership', () => {
  const source = 'kanban\nBacklog\n  a[日本 gateway]\nActive\n  b[Deliver API]@{assigned: Iris}\nReview\n  c[Verify]\nDone\n  d[Shipped]',
    body = parseKanbanDiagram(source),
    horizontal = layoutKanbanDiagram(body),
    wrapped = layoutKanbanDiagram(body, { kanban: { maxWidth: 560 } })
  expect(wrapped.width).toBeLessThanOrEqual(560)
  expect(wrapped.columns.map(column => column.id)).toEqual(['Backlog', 'Active', 'Review', 'Done'])
  expect(wrapped.columns.map(column => column.tasks.map(task => [task.id, task.parentId]))).toEqual([[['a', 'Backlog']], [['b', 'Active']], [['c', 'Review']], [['d', 'Done']]])
  expect(wrapped.columns[0]!.y).toBe(wrapped.columns[1]!.y)
  expect(wrapped.columns[2]!.y).toBeGreaterThan(wrapped.columns[0]!.y + wrapped.columns[0]!.height)
  expect(wrapped.columns[2]!.x).toBe(wrapped.columns[0]!.x)
  for (const column of wrapped.columns)
    for (const task of column.tasks) {
      const original = horizontal.columns.flatMap(group => group.tasks).find(card => card.id === task.id)!
      expect(task.texts.map(text => text.block.fontSize)).toEqual(original.texts.map(text => text.block.fontSize))
      expect(task.x).toBeGreaterThanOrEqual(column.x)
      expect(task.y + task.height).toBeLessThanOrEqual(column.y + column.height)
    }
  const narrow = layoutKanbanDiagram(body, { kanban: { maxWidth: 240 } })
  expect(narrow.width).toBeLessThanOrEqual(240)
  expect(new Set(narrow.columns.map(column => column.y)).size).toBe(4)
  expect(renderMermaidSVG(source, { kanban: { maxWidth: 560 } })).toContain('data-parent="Review"')
  expect(layoutKanbanDiagram(body, { kanban: {} })).toEqual(horizontal)
  expect(renderMermaidASCII(source, { kanban: { maxWidth: 560 } })).toBe(renderMermaidASCII(source))
})

test('Kanban duplicate authored IDs remain distinct across columns and generated-looking identities', () => {
  const body = parseKanbanDiagram('kanban\nTodo\n  same[First]\nDone\n  same[Second]\n  same#2[Third]')
  const tasks = body.columns.flatMap(column => column.tasks)
  expect(new Set([...body.columns, ...tasks].map(item => item.id)).size).toBe(5)
  expect(tasks.map(task => task.sourceId)).toEqual(['same', 'same', 'same#2'])
  expect(parseKanbanDiagram(renderKanban(body))).toEqual(body)
  const layout = layoutKanbanDiagram(body)
  expect(layout.columns.flatMap(column => column.tasks).map(task => task.parentId)).toEqual(['Todo', 'Done', 'Done'])
})

test('Kanban authored IDs that resemble private artwork retain unique public identities', () => {
  const source = 'kanban\nTodo\n  t[First]\n  t:surface[Second]\n  Todo:surface[Third]\n  t:text-0[Fourth]'
  const parsed = parseRegisteredMermaid(source)
  if (!parsed.ok) throw new Error('Kanban parse failed')
  expect(verifyMermaid(parsed.value).ok).toBe(true)
  for (const style of [undefined, 'hand-drawn']) {
    const ids = [...renderMermaidSVG(source, { style }).matchAll(/data-id="([^"]*)"/g)].map(match => match[1]!)
    expect(new Set(ids).size).toBe(ids.length)
    expect(ids.sort()).toEqual(['Todo', 't', 't:surface', 'Todo:surface', 't:text-0'].sort())
  }
})

test('Kanban cards move atomically and nonempty columns require explicit deletion', () => {
  const body = parseKanbanDiagram('kanban\nTodo\n  t[Work]@{assigned: Alice, ticket: ID-42}\nDone')
  const moved = mutateKanban(body, { kind: 'move_task', id: 't', column: 'Done' })
  expect(moved.ok).toBe(true)
  if (!moved.ok) throw new Error(moved.error.message)
  expect(moved.value.columns.map(column => column.tasks.length)).toEqual([0, 1])
  expect(moved.value.columns[1]!.tasks[0]!.metadata).toEqual({ assigned: 'Alice', ticket: 'ID-42' })
  expect(mutateKanban(body, { kind: 'remove_column', id: 'Todo' }).ok).toBe(false)
  expect(body.columns[0]!.tasks).toHaveLength(1)
  expect(parseKanbanBody('kanban\nTodo\n  task[Unclosed')).toBeNull()
})

test('Kanban malformed delimiters report the source opening and expected closing token', () => {
  for (const [source, expected] of [
    ['kanban\nTodo\n  task[Unclosed', 'line 3, column 7'],
    ['kanban\nTodo\n  task["Unclosed', 'line 3, column 8'],
    ['kanban\nTodo\n  task[Work]@{ assigned: "Alice"', 'line 3, column 13'],
  ])
    expect(() => parseKanbanDiagram(source!)).toThrow(expected!)
  const wrapped = '---\ntitle: Board\n---\n%% comment\nkanban\naccTitle: Accessible board\nTodo\n  task[Missing'
  for (const render of [renderMermaidSVG, renderMermaidASCII]) expect(() => render(wrapped)).toThrow('line 8, column 7')
})

test('Kanban wrapped cards and headers own sufficient geometry for all metadata', () => {
  const body = parseKanbanDiagram('kanban\nTodo[A very long column heading that should wrap neatly]\n  t[A long multilingual task with 界 and é and a great deal of explanatory detail]@{assigned: Alice, ticket: ID-42, priority: High}')
  const layout = layoutKanbanDiagram(body)
  for (const column of layout.columns)
    for (const task of column.tasks) {
      expect(task.x).toBeGreaterThan(column.x)
      expect(task.y + task.height).toBeLessThan(column.y + column.height)
      for (const text of task.texts) {
        expect(text.x + text.block.width).toBeLessThanOrEqual(task.x + task.width)
        expect(text.y + text.block.height / 2).toBeLessThanOrEqual(task.y + task.height)
      }
    }
  expect(layout.columns[0]!.tasks[0]!.texts.map(text => text.kind)).toEqual(['label', 'ticket', 'assigned', 'priority'])
})

test('Kanban public wrapper, typed mutation and native terminal preserve task meaning', () => {
  const prefix = '---\ntitle: Delivery board\nconfig:\n  kanban:\n    ticketBaseUrl: https://example.com/#TICKET#\n---\n%% retained\n'
  const source = prefix + 'kanban\nTodo\n  t[Ship 界]@{assigned: Alice, ticket: ID-42, priority: High}\nDone\n'
  const parsed = parseRegisteredMermaid(source)
  expect(parsed.ok).toBe(true)
  if (!parsed.ok) throw new Error('Kanban parse failed')
  const narrowed = asKanban(parsed.value)
  expect(narrowed).not.toBeNull()
  if (!narrowed) throw new Error('Kanban narrowing failed')
  const changed = mutate(narrowed, { kind: 'move_task', id: 't', column: 'Done' })
  expect(changed.ok).toBe(true)
  if (!changed.ok) throw new Error('Kanban mutation failed')
  const serialized = serializeMermaid(changed.value)
  expect(serialized.startsWith(prefix)).toBe(true)
  const svg = renderMermaidSVG(serialized)
  expect(svg).toContain('data-parent="Done"')
  for (const text of ['Alice', 'ID-42', 'High', '界']) {
    expect(svg).toContain(text)
    expect(renderMermaidASCII(serialized)).toContain(text)
  }
})

test('Kanban ticket links use safe encoded actions and respect strict rendering', () => {
  const source = '---\nconfig:\n  kanban:\n    ticketBaseUrl: https://tracker.example/issues/#TICKET#\n---\nkanban\nTodo\n  task[Ship parser]@{ticket: "ID/42?detail"}'
  const parsed = parseRegisteredMermaid(source)
  if (!parsed.ok) throw new Error('Kanban parse failed')
  const href = 'https://tracker.example/issues/ID%2F42%3Fdetail'
  expect(collectActionRecords(parsed.value)).toMatchObject([{ family: 'kanban', target: 'task', action: 'href', href, security: 'safe', executable: false }])
  expect(renderMermaidSVG(source)).toContain(`data-href="${href}"`)
  expect(renderMermaidSVG(source, { security: 'strict' })).not.toContain('data-href=')
  expect(kanbanTicketUrl('javascript:alert(#TICKET#)', '42')).toBeUndefined()
  expect(kanbanTicketUrl('data:text/html,#TICKET#', '42')).toBeUndefined()
  expect(kanbanTicketUrl('https://tracker.example/issues/#TICKET#', 'A B')).toBe('https://tracker.example/issues/A%20B')
})

test('Kanban canonical round trips retain order, quoting, identity and metadata', () => {
  const labels = fc.array(fc.constantFrom('plain', '界', 'emoji 🛠', 'é', 'commas, colons: and braces }', 'a "quoted" label', 'line\nbreak', 'retained\rreturn', 'retained\r\r\nnewline'), { minLength: 0, maxLength: 14 })
  fc.assert(
    fc.property(labels, values => {
      const source = 'kanban\nTodo\n' + values.map((label, index) => `  task${index}["${label.replaceAll('"', '#quot;')}"]@{assigned: Alice, ticket: ID-${index}}`).join('\n')
      const body = parseKanbanDiagram(source),
        canonical = renderKanban(body)
      expect(parseKanbanDiagram(canonical)).toEqual(body)
      expect(renderKanban(parseKanbanDiagram(canonical))).toBe(canonical)
    }),
    fcParameters({ numRuns: 50, seed: 1202002 }),
  )
})

test('Kanban directive-like labels and metadata remain literal through portable writes', async () => {
  const upstream = startUpstreamMermaid()
  try {
    const source = 'kanban\n[%%{f]\n task[Card]'
    const parsed = parseRegisteredMermaid(source)
    if (!parsed.ok) throw Error(JSON.stringify(parsed.error))
    const written = serializeMermaid(parsed.value)
    const reference = await upstream.project(written, diagram => diagram.db.getData().nodes.map((node: Record<string, unknown>) => ({ id: node.id, label: node.label, parentId: node.parentId })))
    expect(reference.ok).toBe(true)
    if (!reference.ok) throw Error(reference.error)
    expect(reference.value.map((node: Record<string, unknown>) => ({
      id: projectEntityMarkers(String(node.id)), label: projectEntityMarkers(String(node.label)),
      ...(node.parentId === undefined ? {} : { parentId: projectEntityMarkers(String(node.parentId)) }),
    }))).toEqual([{ id: '%%{f', label: '%%{f' }, { id: 'task', label: 'Card', parentId: '%%{f' }])
    const edited = mutate(asKanban(parsed.value)!, { kind: 'set_task_metadata', id: 'task', metadata: { ticket: '%%{ticket', details: { note: '%%{deep' } } })
    if (!edited.ok) throw Error(edited.error.message)
    const editedSource = serializeMermaid(edited.value)
    expect(await upstream.publicAccepts(editedSource)).toBe(true)
    expect(parseKanbanDiagram(editedSource).columns[0]!.tasks[0]!.metadata).toEqual({ ticket: '%%{ticket', details: { note: '%%{deep' } })
    for (const ticket of ['%%{ticket', '%%{init: {"theme":"dark"}}%%', '100% done']) {
      const flat = mutate(asKanban(parsed.value)!, { kind: 'set_task_metadata', id: 'task', metadata: { ticket } })
      if (!flat.ok) throw Error(flat.error.message)
      const flatSource = serializeMermaid(flat.value)
      expect(await upstream.project(flatSource, diagram => diagram.db.getData().nodes.find((node: any) => node.id === 'task').ticket)).toEqual({ ok: true, value: ticket })
      const reloaded = parseRegisteredMermaid(flatSource)
      if (!reloaded.ok) throw Error(JSON.stringify(reloaded.error))
      expect(reloaded.value.meta.initDirectives).toEqual([])
    }
  } finally { upstream.close() }
})

test('Kanban typed writes preserve keyword-like identities, labels and membership in Mermaid', async () => {
  const upstream = startUpstreamMermaid()
  try {
    for (const id of ['kanban', 'KANBAN', 'kanban-board', 'kanbané', 'kanban1', 'kanban_1']) {
      const parsed = parseRegisteredMermaid('kanban\n  todo[Todo]')
      if (!parsed.ok) throw Error(JSON.stringify(parsed.error))
      const addedColumn = mutate(asKanban(parsed.value)!, { kind: 'add_column', id, label: 'Doing' })
      if (!addedColumn.ok) throw Error(addedColumn.error.message)
      const addedTask = mutate(addedColumn.value, { kind: 'add_task', column: id, id: `${id}-task`, label: 'Ship', metadata: { assigned: 'Iris', ticket: 'ID-42' } })
      if (!addedTask.ok) throw Error(addedTask.error.message)
      const source = serializeMermaid(addedTask.value)
      if (id === 'kanban1' || id === 'kanban_1') expect(source).toContain(`${id}["Doing"]`)
      const expected = [
        { id: 'todo', label: 'Todo', parentId: undefined, assigned: undefined, ticket: undefined },
        { id, label: 'Doing', parentId: undefined, assigned: undefined, ticket: undefined },
        { id: `${id}-task`, label: 'Ship', parentId: id, assigned: 'Iris', ticket: 'ID-42' },
      ]
      const reference = await upstream.project(source, diagram => diagram.db.getData().nodes.map((node: Record<string, unknown>) => ({ id: node.id, label: node.label, parentId: node.parentId, assigned: node.assigned, ticket: node.ticket })))
      expect(reference).toEqual({ ok: true, value: expected })
      const reloaded = parseRegisteredMermaid(source)
      if (!reloaded.ok) throw Error(JSON.stringify(reloaded.error))
      const body = asKanban(reloaded.value)!.body
      expect(body.columns.flatMap(column => [
        { id: column.id, label: column.label, parentId: undefined, assigned: column.metadata.assigned, ticket: column.metadata.ticket },
        ...column.tasks.map(task => ({ id: task.id, label: task.label, parentId: column.id, assigned: task.metadata.assigned, ticket: task.metadata.ticket })),
      ])).toEqual(expected)
      expect(serializeMermaid(reloaded.value)).toBe(source)
      const renamed = mutate(asKanban(reloaded.value)!, { kind: 'set_task_label', id: `${id}-task`, label: 'Shipped' })
      if (!renamed.ok) throw Error(renamed.error.message)
      const renamedSource = serializeMermaid(renamed.value)
      expect(await upstream.project(renamedSource, diagram => diagram.db.getData().nodes.map((node: Record<string, unknown>) => ({ id: node.id, label: node.label, parentId: node.parentId })))).toEqual({ ok: true, value: [
        { id: 'todo', label: 'Todo', parentId: undefined }, { id, label: 'Doing', parentId: undefined }, { id: `${id}-task`, label: 'Shipped', parentId: id },
      ] })
      expect(asKanban(parsed.value)!.body.columns.map(column => column.id)).toEqual(['todo'])
    }
  } finally {
    upstream.close()
  }
})


test('Kanban implicit identities retain payload CR across structural endings and public surfaces', () => {
  const ids = ['A\rB', 'A\nB', 'A\r\nB', 'A\nB#2']
  for (const ending of ['\n', '\r', '\r\n']) {
    const wrapper = ['---', 'title: Identity board', '---', '%%{init: {}}%%', ''].join(ending)
    const source = wrapper + [
      'kanban', 'accTitle: Distinct columns',
      '["A\rB"]', '  ["Task\rOne"]@{ assigned: Iris }',
      '["A\nB"]', '  ["Task\nOne"]',
      '["A\r\r\nB"]', '["A\r\nB"]',
    ].join(ending)
    const parsed = parseRegisteredMermaid(source)
    if (!parsed.ok) throw Error(JSON.stringify(parsed.error))
    const narrowed = asKanban(parsed.value)
    if (!narrowed) throw Error('Expected native Kanban')
    expect(narrowed.body.columns.map(column => column.id)).toEqual(ids)
    expect(narrowed.body.columns.map(column => column.sourceId)).toEqual(['A\rB', 'A\nB', 'A\r\nB', 'A\nB'])
    expect(narrowed.meta.wrapperSource).toBe(wrapper)
    for (const [index, authored] of ['A\rB', 'A\nB', 'A\r\r\nB', 'A\r\nB'].entries()) {
      const span = narrowed.source.spans?.labels.get(`group:${ids[index]}`)
      expect(span).toBeDefined()
      expect(source.slice(span!.start.offset, span!.end.offset)).toBe(authored)
    }
    const again = parseRegisteredMermaid(serializeMermaid(narrowed))
    if (!again.ok) throw Error(JSON.stringify(again.error))
    expect(again.value.body).toEqual(narrowed.body)
    const layout = layoutMermaidWithReceipt(narrowed).layout
    expect(layout.groups.map(group => group.id)).toEqual(ids)
    expect(layout.nodes.map(node => [node.id, node.parentId])).toEqual([['Task\rOne', ids[0]], ['Task\nOne', ids[1]]])
    const tags = scanSvgStartTags(renderMermaidSVG(source, { embedFontImport: false }))
    expect(tags.filter(tag => decodedSvgAttributeValue(tag, 'data-id') !== undefined && decodedSvgAttributeValue(tag, 'data-id') !== 'diagram-title').map(tag => decodedSvgAttributeValue(tag, 'data-id'))).toEqual([ids[0], 'Task\rOne', ids[1], 'Task\nOne', ids[2], ids[3]])
    for (const input of [source, narrowed]) {
      const terminal = renderMermaidASCIIWithMeta(input, { colorMode: 'none' })
      expect(terminal.warnings).not.toContainEqual(expect.objectContaining({ code: 'ASCII_RENDER_FAILED' }))
      expect(terminal.regions.filter(region => region.kind === 'band').map(region => region.id)).toEqual(ids)
      expect(terminal.regions.filter(region => region.kind === 'node').map(region => region.id)).toEqual(['Task\rOne', 'Task\nOne'])
    }
    const changed = mutateKanban(narrowed.body, { kind: 'set_column_label', id: ids[0]!, label: 'Renamed\r\ncolumn' })
    if (!changed.ok) throw Error(changed.error.message)
    const roundTrip = parseKanbanDiagram(renderKanban(changed.value))
    expect(roundTrip.columns[0]?.id).toBe(ids[0])
    expect(roundTrip.columns[0]?.label).toBe('Renamed\r\ncolumn')
  }
})

test('Kanban payload parsing decodes transport XML once and preserves authored label spans', () => {
  const source = 'kanban\n["A&amp;amp;@{literal\rB"]\n  ["Task&amp;amp;\rOne"]'
  const parsed = parseRegisteredMermaid(source)
  if (!parsed.ok) throw Error(JSON.stringify(parsed.error))
  const body = asKanban(parsed.value)!.body
  expect(body.columns[0]?.sourceId).toBe('A&amp;@{literal\rB')
  const span = parsed.value.source.spans?.labels.get('group:A&amp;@{literal\rB')
  expect(span).toBeDefined()
  expect(source.slice(span!.start.offset, span!.end.offset)).toBe('A&amp;amp;@{literal\rB')
  const expected = ['A&amp;@{literal\rB', 'Task&amp;\rOne']
  for (const renderedSource of [source, source.replace('kanban', 'kanb&#97;n')]) {
    const tags = scanSvgStartTags(renderMermaidSVG(renderedSource, { embedFontImport: false }))
    expect(tags.filter(tag => decodedSvgAttributeValue(tag, 'data-id') !== undefined && decodedSvgAttributeValue(tag, 'data-id') !== 'diagram-title').map(tag => decodedSvgAttributeValue(tag, 'data-id'))).toEqual(expected)
    expect(renderMermaidASCIIWithMeta(renderedSource, { colorMode: 'none' }).regions.filter(region => region.kind === 'band' || region.kind === 'node').map(region => region.id)).toEqual(expected)
  }
})


test('Kanban universal accessibility respects native consumed payload records without observer leaks', () => {
  const source = 'kanban\n["A\raccTitle: hidden\rB"]\naccDescr: Real description'
  const events: string[] = []
  withParserObservation('kanban', event => {
    events.push(event.kind)
  }, () => {
    expect(kanbanStatementEnds(source.replaceAll('\r', '\n').split('\n'))).toEqual([0, 3, 2, 3, 4])
    expect(events).toEqual([])
    expect(normalizeMermaidSource(source).accessibility).toEqual({ descr: 'Real description' })
    expect(events).toEqual([])
    parseKanbanDiagram('kanban\nVisible')
    expect(events).toContain('add-column')
  })
  const parsed = parseRegisteredMermaid(source)
  if (!parsed.ok) throw Error(JSON.stringify(parsed.error))
  const body = asKanban(parsed.value)!.body
  expect(body.columns[0]?.sourceId).toBe('A\raccTitle: hidden\rB')
  expect(body.accessibilityTitle).toBeUndefined()
  expect(body.accessibilityDescription).toBe('Real description')
})
