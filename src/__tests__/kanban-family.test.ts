import { expect, test } from 'bun:test'
import fc from 'fast-check'
import { collectActionRecords } from '../agent/analyze.ts'
import { asKanban, mutate, parseRegisteredMermaid, serializeMermaid, verifyMermaid } from '../agent/index.ts'
import { mutateKanban, parseKanbanBody, renderKanban } from '../agent/kanban-body.ts'
import { renderMermaidASCII } from '../ascii/index.ts'
import { renderMermaidSVG } from '../index.ts'
import { kanbanTicketUrl } from '../kanban/config.ts'
import { layoutKanbanDiagram } from '../kanban/layout.ts'
import { parseKanbanDiagram } from '../kanban/parser.ts'
import { fcParameters } from './helpers/fc-parameters.ts'

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
  const labels = fc.array(fc.constantFrom('plain', '界', 'emoji 🛠', 'é', 'commas, colons: and braces }', 'a "quoted" label'), { minLength: 0, maxLength: 14 })
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
