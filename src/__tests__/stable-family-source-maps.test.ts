import { describe, expect, test } from 'bun:test'
import { asBlock, asRequirement, mutate, parseRegisteredMermaid, serializeMermaid } from '../agent/core.ts'
import type { SourceMap, SourceSpan, ValidDiagram } from '../agent/types.ts'

function parsed(source: string): ValidDiagram {
  const result = parseRegisteredMermaid(source)
  if (!result.ok || result.value.body.kind === 'opaque') throw new Error('Source-map fixture must have a native body')
  return result.value as ValidDiagram
}
function text(source: string, span: SourceSpan | undefined): string {
  if (!span) throw new Error('Expected an authored source span')
  return source.slice(span.start.offset, span.end.offset)
}
function span(source: string, diagram: ValidDiagram, category: 'nodes' | 'edges' | 'groups' | 'labels', key: string): string {
  return text(source, diagram.source.spans?.[category].get(key))
}

function keys(map: SourceMap['nodes']): string[] {
  return [...map.keys()]
}

describe('stable-family authored declaration source maps', () => {
  test('Kanban native label offsets retain metadata-looking text and leading payload newlines', () => {
    const source = 'kanban\ncol["A@{B\nC"]\n  task["\nA"]@{ assigned: "A" }', diagram = parsed(source)
    expect(span(source, diagram, 'labels', 'group:col')).toBe('A@{B\nC')
    expect(span(source, diagram, 'labels', 'node:task')).toBe('\nA')
  })
  test('Packet repeated labels map to their own bit fields after wrappers and title', () => {
    const source = '---\ntitle: Same\n---\n%% Same before the family\npacket\ntitle Same\n0-7: "Same"\n8-15: "Same"\n',
      diagram = parsed(source)
    expect(keys(diagram.source.nodes)).toEqual(['field-0', 'field-1'])
    expect(span(source, diagram, 'nodes', 'field-0')).toBe('0-7: "Same"')
    expect(span(source, diagram, 'nodes', 'field-1')).toBe('8-15: "Same"')
    expect(span(source, diagram, 'labels', 'node:field-0')).toBe('Same')
    expect(span(source, diagram, 'labels', 'node:field-1')).toBe('Same')
    expect(diagram.source.spans?.nodes.get('field-0')?.start.line).toBe(7)
    expect(text(source, diagram.source.spans?.preserved.header)).toBe('packet')
  })
  test('Kanban columns are groups and repeated task source IDs remain distinct', () => {
    const source = '---\ntitle: Same\n---\nkanban\n  todo[Same]\n    task[Same]@{ assigned: "Same", priority: High }\n  done[Same]\n    task[Same]\n',
      diagram = parsed(source)
    expect(keys(diagram.source.groups)).toEqual(['todo', 'done'])
    expect(keys(diagram.source.nodes)).toEqual(['task', 'task#2'])
    expect(span(source, diagram, 'groups', 'todo')).toBe('todo[Same]')
    expect(span(source, diagram, 'groups', 'done')).toBe('done[Same]')
    expect(span(source, diagram, 'nodes', 'task')).toBe('task[Same]@{ assigned: "Same", priority: High }')
    expect(span(source, diagram, 'nodes', 'task#2')).toBe('task[Same]')
    expect(diagram.source.spans?.nodes.get('task')?.start.line).toBe(6)
    expect(diagram.source.spans?.nodes.get('task#2')?.start.line).toBe(8)
    for (const key of ['group:todo', 'group:done', 'node:task', 'node:task#2']) expect(span(source, diagram, 'labels', key)).toBe('Same')
    const metadata = diagram.source.spans?.metadata?.get('task')
    expect(text(source, metadata?.get('assigned')?.key)).toBe('assigned')
    expect(text(source, metadata?.get('assigned')?.value)).toBe('"Same"')
    expect(text(source, metadata?.get('priority')?.value)).toBe('High')
    const entitySource = 'kanban\nTodo\n  task[Work]@{ assigned: #quot;Iris#quot;, ticket: "GW-1" }', entityMap = parsed(entitySource).source.spans?.metadata?.get('task')
    expect(text(entitySource, entityMap?.get('assigned')?.value)).toBe('#quot;Iris#quot;')
    expect(text(entitySource, entityMap?.get('ticket')?.value)).toBe('"GW-1"')
  })
  test('Kanban multiline metadata preserves exact quoted keys, collections and repeated item ownership', () => {
    const source = '---\ntitle: Delivery\n---\nkanban\n  Todo\n    task[Work]@{\n      "assigned": "Iris"\n      tags: [parser, "日本"]\n      priority: High\n    }\n  Done\n    task[Review]@{ ticket: "GW-1" }\n',
      diagram = parsed(source),
      metadata = diagram.source.spans?.metadata
    expect(text(source, metadata?.get('task')?.get('assigned')?.key)).toBe('"assigned"')
    expect(text(source, metadata?.get('task')?.get('assigned')?.value)).toBe('"Iris"')
    expect(text(source, metadata?.get('task')?.get('tags')?.value)).toBe('[parser, "日本"]')
    expect(text(source, metadata?.get('task#2')?.get('ticket')?.value)).toBe('"GW-1"')
    expect(metadata?.get('task')?.get('tags')?.value.start.line).toBe(8)
    expect(span(source, diagram, 'nodes', 'task')).toBe('task[Work]@{\n      "assigned": "Iris"\n      tags: [parser, "日本"]\n      priority: High\n    }')
  })
  test.each(['\n', '\r\n'])('Kanban folded metadata spans retain authored blocks and repeated owners through %j cleanup', newline => {
    const card = 'card[Work]@{\n      folded: >-\n        one\n        two&#10;        three\n      nested: &shared\n        note: |+\n          keep\n\n      alias: *shared\n      scalar: &scalar !!str 23\n      scalarAlias: *scalar\n      "quoted #quot;": "A&amp;amp; B"\n    }'
    const source = ['---', 'title: Delivery', '---', '%% wrapper', 'kanban', '  Todo', '%%{init: {"theme":"base"}}%%', `    ${card}`, '  Done', '    card[Review]@{ assigned: "Iris" }'].join('\n').replaceAll('\n', newline)
    const diagram = parsed(source)
    if (diagram.body.kind !== 'kanban') throw new Error('Expected Kanban body')
    expect(diagram.body.columns[0]!.tasks[0]!.metadata).toEqual({ folded: 'one two three', nested: { note: 'keep\n\n' }, alias: { note: 'keep\n\n' }, scalar: '23', scalarAlias: '23', 'quoted #quot;': 'A&amp; B' })
    expect(span(source, diagram, 'nodes', 'card')).toBe(card.replaceAll('\n', newline))
    expect(span(source, diagram, 'labels', 'node:card')).toBe('Work')
    expect(span(source, diagram, 'nodes', 'card#2')).toBe('card[Review]@{ assigned: "Iris" }')
    const fields = diagram.source.spans?.metadata?.get('card')
    expect(text(source, fields?.get('folded')?.key)).toBe('folded')
    expect(text(source, fields?.get('folded')?.value)).toBe('>-\n        one\n        two&#10;        three\n'.replaceAll('\n', newline))
    expect(text(source, fields?.get('nested')?.value)).toBe('&shared\n        note: |+\n          keep\n\n'.replaceAll('\n', newline))
    expect(text(source, fields?.get('alias')?.value)).toBe('*shared')
    expect(text(source, fields?.get('scalar')?.value)).toBe('&scalar !!str 23')
    expect(text(source, fields?.get('scalarAlias')?.value)).toBe('*scalar')
    expect(text(source, fields?.get('quoted #quot;')?.key)).toBe('"quoted #quot;"')
    expect(text(source, fields?.get('quoted #quot;')?.value)).toBe('"A&amp;amp; B"')
    expect(text(source, diagram.source.spans?.metadata?.get('card#2')?.get('assigned')?.value)).toBe('"Iris"')
  })
  test.each(['>-', '|'])('Kanban %s metadata ending beside its closing brace excludes synthetic YAML framing from the value span', indicator => {
    const source = `kanban\nTodo\n  task[Work]@{\n    content: ${indicator}\n      one}`
    const diagram = parsed(source)
    if (diagram.body.kind !== 'kanban') throw new Error('Expected Kanban body')
    expect(diagram.body.columns[0]!.tasks[0]!.metadata).toEqual({ content: indicator === '>-' ? 'one' : 'one\n' })
    expect(text(source, diagram.source.spans?.metadata?.get('task')?.get('content')?.value)).toBe(`${indicator}\n      one`)
    expect(span(source, diagram, 'nodes', 'task')).toBe(`task[Work]@{\n    content: ${indicator}\n      one}`)
  })
  test('Kanban authored spans compose adjacent directive deletions and XML-created lines', () => {
    const source = 'kanban\r\nTodo%%{init: {}}%%%%{init: {}}%%\r\n  card["A &amp; B"]@{ assigned: &person !!str "Iris&#10;Lee", "key&#10;name": value, alias: *person }'
    const diagram = parsed(source)
    if (diagram.body.kind !== 'kanban') throw new Error('Expected Kanban body')
    expect(diagram.body.columns[0]!.tasks[0]).toMatchObject({ id: 'card', label: 'A & B', metadata: { assigned: 'Iris<br/>Lee', 'key<br/>name': 'value', alias: 'Iris<br/>Lee' } })
    expect(span(source, diagram, 'groups', 'Todo')).toBe('Todo')
    expect(span(source, diagram, 'nodes', 'card')).toBe('card["A &amp; B"]@{ assigned: &person !!str "Iris&#10;Lee", "key&#10;name": value, alias: *person }')
    expect(span(source, diagram, 'labels', 'node:card')).toBe('A &amp; B')
    const fields = diagram.source.spans?.metadata?.get('card')
    expect(text(source, fields?.get('assigned')?.value)).toBe('&person !!str "Iris&#10;Lee"')
    expect(text(source, fields?.get('key<br/>name')?.key)).toBe('"key&#10;name"')
    expect(text(source, fields?.get('alias')?.value)).toBe('*person')
  })
  test('Kanban XML-created grammar lines retain native spans and authored comments through edits', () => {
    const source = 'kanban\r\n%%{init: {}}%%%%{init: {}}%%Todo&#10;  card["A&#10;B"]@{ assigned: Iris } %% Keep &amp; text'
    const diagram = parsed(source)
    if (diagram.body.kind !== 'kanban') throw new Error('Expected Kanban body')
    expect(diagram.body.columns[0]!.tasks[0]).toMatchObject({ id: 'card', label: 'A\nB', metadata: { assigned: 'Iris' } })
    expect(span(source, diagram, 'groups', 'Todo')).toBe('Todo')
    expect(span(source, diagram, 'labels', 'node:card')).toBe('A&#10;B')
    expect(text(source, diagram.source.spans?.metadata?.get('card')?.get('assigned')?.value)).toBe('Iris')
    expect(diagram.meta.bodyComments).toContainEqual(expect.objectContaining({ raw: '%% Keep &amp; text' }))
    expect(diagram.meta.droppedComments).toBeUndefined()
    const edited = mutate(diagram, { kind: 'set_task_label', id: 'card', label: 'Renamed' })
    if (!edited.ok) throw new Error(JSON.stringify(edited.error))
    const saved = serializeMermaid(edited.value)
    expect(saved).toContain('%% Keep &amp; text')
    const reloaded = parsed(saved)
    if (reloaded.body.kind !== 'kanban') throw new Error('Expected saved Kanban body')
    expect(reloaded.body.columns[0]!.tasks[0]).toMatchObject({ id: 'card', label: 'Renamed', metadata: { assigned: 'Iris' } })
  })
  test.each([
    ['kanban\n%%{init: {}}%%Todo\n  card[Work]', 'Todo', 1],
    ['kanban\rTodo\r  card[Work]', 'Todo', 1],
    ['kanban\nR&amp;D[Name]\n  card[Work]', 'R&D', 9],
  ] as const)('Kanban native provenance retains canonical locations after %j preparation', (source, id, col) => {
    const diagram = parsed(source)
    expect(diagram.source.groups.get(id)).toEqual({ line: 2, col: 1 })
    expect(diagram.source.labels.get(`group:${id}`)).toEqual({ line: 2, col })
    expect(diagram.source.nodes.get('card')).toEqual({ line: 3, col: 1 })
    expect(diagram.source.labels.get('node:card')).toEqual({ line: 3, col: 6 })
  })
  test('Requirement fields and repeated relations use declaration identities rather than label matches', () => {
    const source = '---\ntitle: proof\n---\nrequirementDiagram\n  requirement r1 {\n    text: "Same"\n    risk: high\n  }\n  requirement r2 {\n    text: "Same"\n  }\n  element proof {\n    type: "Same"\n  }\n  proof - verifies -> r1\n  proof - verifies -> r1\n  r2 <- traces - r1\n',
      diagram = parsed(source),
      body = asRequirement(diagram)
    if (!body) throw new Error('Expected Requirement body')
    expect(keys(diagram.source.nodes)).toEqual(['r1', 'r2', 'proof'])
    expect(diagram.source.groups.size).toBe(0)
    expect(span(source, diagram, 'nodes', 'proof')).toBe('element proof {')
    expect(span(source, diagram, 'labels', 'node:r1:text')).toBe('Same')
    expect(span(source, diagram, 'labels', 'node:r1:risk')).toBe('high')
    expect(span(source, diagram, 'labels', 'node:proof:type')).toBe('Same')
    expect(body.body.relations.map(edge => span(source, diagram, 'edges', edge.id))).toEqual(['proof - verifies -> r1', 'proof - verifies -> r1', 'r2 <- traces - r1'])
    expect(diagram.source.spans?.edges.get(body.body.relations[0]!.id)?.start.line).toBe(15)
    expect(diagram.source.spans?.edges.get(body.body.relations[1]!.id)?.start.line).toBe(16)
    expect(span(source, diagram, 'labels', 'edge#2:r1->r2')).toBe('traces')
    const renamed = mutate(body, { kind: 'rename_node', from: 'proof', to: 'evidence' })
    expect(renamed.ok).toBe(true)
    if (renamed.ok) expect(span(renamed.value.canonicalSource, renamed.value, 'nodes', 'evidence')).toContain('element "evidence"')
  })
  test('Block maps named and anonymous composite groups, same-line declarations and labeled edges', () => {
    const source = 'block-beta\ncolumns 2\nblock:container["Same"]:2\n  columns 2\n  A["Same"] B["Same"]\n  block\n    C["Same"]\n  end\nend\nA -- "Same" --> B\nB --> C\n',
      diagram = parsed(source),
      body = asBlock(diagram)
    if (!body) throw new Error('Expected Block body')
    const anonymous = [...diagram.source.groups.keys()].find(id => id !== 'container')
    if (!anonymous) throw new Error('Expected anonymous composite identity')
    expect(keys(diagram.source.nodes)).toEqual(['A', 'B', 'C'])
    expect(diagram.source.groups.size).toBe(2)
    expect(span(source, diagram, 'groups', 'container')).toBe('block:container["Same"]:2')
    expect(span(source, diagram, 'groups', anonymous)).toBe('block')
    expect(span(source, diagram, 'labels', 'group:container')).toBe('Same')
    for (const id of ['A', 'B', 'C']) expect(span(source, diagram, 'labels', `node:${id}`)).toBe('Same')
    expect(body.body.edges.map(edge => span(source, diagram, 'edges', edge.id))).toEqual(['A -- "Same" --> B', 'B --> C'])
    expect(span(source, diagram, 'labels', 'edge#0:A->B')).toBe('Same')
    expect(diagram.source.nodes.get('B')!.col).toBeGreaterThan(diagram.source.nodes.get('A')!.col)
  })
  test('Treemap sections are groups and duplicate quantities and labels retain their own declarations', () => {
    const source = '---\ntitle: Same\n---\ntreemap-beta\n  "Same"\n    "Same": 4\n  "Same"\n    "Same": 4\n',
      diagram = parsed(source)
    expect(keys(diagram.source.groups)).toEqual(['treemap-0', 'treemap-2'])
    expect(keys(diagram.source.nodes)).toEqual(['treemap-1', 'treemap-3'])
    expect(diagram.source.spans?.groups.get('treemap-0')?.start.line).toBe(5)
    expect(diagram.source.spans?.groups.get('treemap-2')?.start.line).toBe(7)
    expect(diagram.source.spans?.nodes.get('treemap-1')?.start.line).toBe(6)
    expect(diagram.source.spans?.nodes.get('treemap-3')?.start.line).toBe(8)
    for (const key of ['group:treemap-0', 'group:treemap-2', 'node:treemap-1', 'node:treemap-3']) expect(span(source, diagram, 'labels', key)).toBe('Same')
  })
  test('Treemap same-line siblings retain distinct token locations after wrappers', () => {
    const source = '---\ntitle: First\n---\ntreemap-beta\n  "Category"\n    "First": 1 "Second": 2\n    "Repeated": 3 "Repeated": 4\n',
      diagram = parsed(source)
    expect(span(source, diagram, 'labels', 'node:treemap-1')).toBe('First')
    expect(span(source, diagram, 'labels', 'node:treemap-2')).toBe('Second')
    expect(span(source, diagram, 'labels', 'node:treemap-3')).toBe('Repeated')
    expect(span(source, diagram, 'labels', 'node:treemap-4')).toBe('Repeated')
    const first = diagram.source.spans?.labels.get('node:treemap-3'),
      second = diagram.source.spans?.labels.get('node:treemap-4')
    expect(first?.start.line).toBe(7)
    expect(second?.start.line).toBe(7)
    expect(second?.start.offset).toBeGreaterThan(first?.end.offset ?? Infinity)
    expect(diagram.source.nodes.get('treemap-2')?.col).toBeGreaterThan(diagram.source.nodes.get('treemap-1')?.col ?? Infinity)
  })
  test('Ishikawa repeated causes and implicit branch sources follow causal record identity', () => {
    const source = 'ishikawa\n  Same\n  Same\n    Same\n  Same\n',
      diagram = parsed(source)
    expect(keys(diagram.source.nodes)).toEqual(['effect', 'cause-1', 'cause-2', 'cause-3'])
    expect(keys(diagram.source.edges)).toEqual(['branch:cause-1', 'branch:cause-2', 'branch:cause-3'])
    expect(diagram.source.spans?.edges.get('branch:cause-2')?.start.line).toBe(4)
    expect(diagram.source.spans?.nodes.get('cause-3')?.start.line).toBe(5)
  })
})
