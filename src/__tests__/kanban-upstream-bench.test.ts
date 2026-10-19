import { describe, expect, test } from 'bun:test'
import cases from '../../eval/mermaid-kanban-bench/cases.json'
import { renderKanban } from '../agent/kanban-body.ts'
import { renderMermaidSVG } from '../index.ts'
import { parseKanbanDiagram } from '../kanban/parser.ts'
import { normalizeMermaidSource } from '../mermaid-source.ts'

describe('Kanban pinned Mermaid 12.2.0 harvest', () => {
  for (const fixture of cases)
    test(`${fixture.id}: ${fixture.upstreamTest}`, () => {
      const source = normalizeMermaidSource(fixture.source),
        parse = () => parseKanbanDiagram(source.familyBody)
      if (!fixture.reference.ok) {
        expect(parse).toThrow()
        return
      }
      const model = parse(),
        expected = fixture.reference.snapshot!.data
      expect(model.columns.map(column => ({ id: column.sourceId, label: column.label }))).toEqual(expected.getSections!.map(column => ({ id: column.id, label: column.label })))
      for (const [index, column] of model.columns.entries()) {
        const official = expected.getSections![index]! as Record<string, unknown>
        if ('icon' in official) expect(column.icon).toBe(official.icon as string)
        if ('cssClasses' in official) expect(column.className).toBe(official.cssClasses as string)
        for (const key of ['assigned', 'ticket', 'priority'] as const) if (key in official) expect(column.metadata[key] as unknown).toEqual(official[key] as unknown)
      }
      const actualTasks: unknown = model.columns.flatMap(column => column.tasks.map(task => ({ id: task.sourceId, parentId: column.sourceId, label: task.label, ticket: task.metadata.ticket, assigned: task.metadata.assigned, priority: task.metadata.priority })))
      expect(actualTasks).toEqual((expected.getData!.nodes as Array<Record<string, unknown>>).filter(node => !node.isGroup).map(node => ({ id: node.id, parentId: node.parentId, label: node.label, ticket: node.ticket, assigned: node.assigned, priority: node.priority })))
      const canonical = renderKanban(model)
      expect(renderKanban(parseKanbanDiagram(canonical))).toBe(canonical)
      expect(renderMermaidSVG(fixture.source)).toContain('<svg')
    })
})
