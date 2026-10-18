import { parseC4Diagram } from '../c4/parser.ts'
import { describe, expect, test } from 'bun:test'
import { parseArchitectureDiagram } from '../architecture/parser.ts'
import { parseErDiagram } from '../er/parser.ts'
import { parseGanttModel } from '../gantt/parser.ts'
import { parseGitGraph } from '../gitgraph/parser.ts'
import { parseJourneyDiagram } from '../journey/parser.ts'
import { parseMindmap } from '../mindmap/parser.ts'
import { parseTimelineDiagram } from '../timeline/parser.ts'
import { withParserObservation, type ParserObservation } from '../shared/parser-observation.ts'

function observe<T>(family: string, parse: () => T): { result: T; events: Readonly<ParserObservation>[] } {
  const events: Readonly<ParserObservation>[] = []
  const result = withParserObservation(family, event => events.push(event), parse)
  return { result, events }
}

describe('line-family native parser observation', () => {
  test('C4 consumes physical chunks and snapshots declarations before deferred styles and generated IDs', () => {
    const source = 'C4Container\nSystem_Boundary(outer, "Outer") {\nContainer(a, "Alpha", "TS")\nContainerDb_Ext(b, "Beta", "SQL", "Store")\n}\nRel_Back(a, b, "Reads", "HTTP")\nUpdateElementStyle(a, $bgColor="red")\nUpdateElementStyle(a, $bgColor="blue")\nUpdateRelStyle(a, b, $lineColor="green")'
    const { result, events } = observe('c4', () => parseC4Diagram(source))
    expect(result).toEqual(parseC4Diagram(source))
    expect(events.find(event => event.kind === 'add-element')?.value).toMatchObject({ id: 'a', label: 'Alpha', parentId: 'outer', style: {} })
    expect(events.filter(event => event.kind === 'set-element-style').map(event => event.value)).toEqual([
      { id: 'a', style: { bgColor: 'red' } }, { id: 'a', style: { bgColor: 'blue' } },
    ])
    expect(events.find(event => event.kind === 'add-relationship')?.value).toMatchObject({ id: '', from: 'a', to: 'b', source: 'b', target: 'a', reversed: true, bidirectional: false })
    expect(events.find(event => event.kind === 'set-relationship-identity')?.value).toEqual({ id: 'c4-rel-1', order: 1 })
    expect(events.filter(event => event.kind === 'close-boundary').map(event => event.value)).toEqual([{ id: 'outer' }])
    const chunks = events.filter(event => event.unit === 'token')
    expect(chunks.map(event => event.text).join('')).toBe(source)
    for (const chunk of chunks) {
      expect(chunk.source?.unit).toBe('physical')
      expect(source.slice(chunk.source!.offset, chunk.source!.endOffset)).toBe(chunk.text!)
    }
  })

  test('C4 observation retains completed writes when later endpoint validation rejects', () => {
    const events: ParserObservation[] = []
    expect(() => withParserObservation('c4', event => events.push(event), () => parseC4Diagram('C4Context\nPerson(a, "Alice")\nRel(a, missing, "Lost")'))).toThrow('undeclared endpoint')
    expect(events.filter(event => event.kind === 'add-element').map(event => event.value)).toEqual([expect.objectContaining({ id: 'a', label: 'Alice', style: {} })])
    expect(events.filter(event => event.kind === 'reset-presentation')).toEqual([])
    expect(events.find(event => event.kind === 'set-relationship-identity')).toBeDefined()
  })

  test('architecture records declaration snapshots before attachments and preserves group endpoint markers', () => {
    const lines = ['architecture-beta', 'group cloud(cloud)[Cloud]', 'service api(server)[API] in cloud', 'service db(database)[DB]', 'api{group}:R <--> L:db']
    const { result, events } = observe('architecture', () => parseArchitectureDiagram(lines))
    expect(result).toEqual(parseArchitectureDiagram(lines))
    expect(events.find(event => event.kind === 'addGroup')?.value).toEqual({ id: 'cloud', label: 'Cloud', icon: 'cloud', children: [] })
    expect(events.filter(event => event.kind === 'attachChild').map(event => event.value)).toEqual([
      { kind: 'group', id: 'cloud' }, { kind: 'service', id: 'api', parentId: 'cloud' }, { kind: 'service', id: 'db' },
    ])
    expect(events.find(event => event.kind === 'addEdge')).toMatchObject({
      value: { source: { id: 'api', boundary: 'group', side: 'R' }, target: { id: 'db', boundary: 'item', side: 'L' }, hasArrowStart: true, hasArrowEnd: true },
      source: { line: 5, unit: 'normalized' },
    })
  })

  test('ER records actual declaration and nested owner resolution without overwriting the first alias', () => {
    const lines = ['erDiagram', 'subgraph Outer', 'subgraph Inner[Inner label]', 'A[First] {', 'int id PK', '}', 'end', 'B', 'end', 'A[Later]', 'A ||--o{ B : owns']
    const { result, events } = observe('er', () => parseErDiagram(lines))
    expect(result).toEqual(parseErDiagram(lines))
    expect(events.filter(event => event.kind === 'declareEntity').map(event => event.value)).toEqual([
      { id: 'A', alias: 'First', groupId: 'Inner' }, { id: 'B', groupId: 'Outer' }, { id: 'A', alias: 'Later' },
    ])
    expect(events.find(event => event.kind === 'createEntity')?.value).toEqual({ id: 'A', label: 'A', attributes: [] })
    expect(events.find(event => event.kind === 'addAttribute')).toMatchObject({ value: { entityId: 'A', attribute: { type: 'int', name: 'id', keys: ['PK'] } }, source: { line: 5, unit: 'normalized' } })
    expect<unknown>(events.filter(event => event.kind === 'resolveEntity').map(event => event.value)).toEqual(result.entities)
    expect<unknown>(events.filter(event => event.kind === 'resolveGroup').map(event => event.value)).toEqual(result.groups)
    expect(result.entities[0]).toMatchObject({ id: 'A', label: 'First', groupId: 'Inner' })
    expect(result.groups[1]).toMatchObject({ id: 'Inner', parentId: 'Outer', entityIds: ['A'] })
  })

  test('Gantt records task references and section membership at their append sites', () => {
    const lines = ['gantt', 'dateFormat YYYY-MM-DD', 'section Build', 'First :a, 2025-01-01, 2d', 'Next :b, after a, 1d']
    const { result, events } = observe('gantt', () => parseGanttModel(lines))
    expect(result).toEqual(parseGanttModel(lines))
    expect(events.find(event => event.kind === 'addSection')?.value).toEqual({ index: 1, label: 'Build', taskIndexes: [], line: 3 })
    expect<unknown>(events.filter(event => event.kind === 'addTask').map(event => event.value)).toEqual(result.tasks)
    expect(events.findLast(event => event.kind === 'addTask')).toMatchObject({ value: { id: 'b', start: { kind: 'after', refs: ['a'] }, sectionIndex: 1 }, source: { line: 5, unit: 'normalized' } })
    expect(events.filter(event => event.kind === 'attachTask').map(event => event.value)).toEqual([{ sectionIndex: 1, taskIndex: 0, taskId: 'a' }, { sectionIndex: 1, taskIndex: 1, taskId: 'b' }])
  })

  test('GitGraph records parent identities and branch head writes before later checkout and merge', () => {
    const source = 'gitGraph\ncommit id:"a"\nbranch feature\ncommit id:"b"\ncheckout main\ncommit id:"c"\nmerge feature id:"m"'
    const { result, events } = observe('gitgraph', () => parseGitGraph(source))
    expect(result).toEqual(parseGitGraph(source))
    expect(events.find(event => event.kind === 'addBranch')?.value).toEqual({ name: 'feature', order: 0.1, sequence: 1, head: 'a' })
    expect(events.filter(event => event.kind === 'setCurrentBranch').map(event => event.value)).toEqual(['feature', 'main'])
    expect<unknown>(events.filter(event => event.kind === 'addCommit').map(event => event.value)).toEqual(result.commits)
    expect(events.findLast(event => event.kind === 'addCommit')).toMatchObject({ value: { id: 'm', branch: 'main', parents: ['c', 'b'], type: 'MERGE' }, source: { line: 7, unit: 'normalized' } })
    expect(events.filter(event => event.kind === 'appendStatement').map(event => event.value)).toEqual(result.statements)
  })

  test('Journey records overwritten titles and task ownership through actual walker callbacks', () => {
    const lines = ['journey', 'title First', 'Before: 3: Alice', 'title Last', 'section Checkout', 'Pay: 5: Alice, Bob; Leave: 4: Bob']
    const { result, events } = observe('journey', () => parseJourneyDiagram(lines))
    expect(result).toEqual(parseJourneyDiagram(lines))
    expect(events.filter(event => event.kind === 'setTitle').map(event => event.value)).toEqual(['First', 'Last'])
    expect(events.find(event => event.kind === 'addImplicitSection')?.value).toEqual({ id: 'section-0', tasks: [] })
    expect(events.filter(event => event.kind === 'addTask').map(event => event.value)).toEqual([
      { id: 'task-0', text: 'Before', score: 3, actors: ['Alice'], sectionId: 'section-0' },
      { id: 'task-1', text: 'Pay', score: 5, actors: ['Alice', 'Bob'], sectionId: 'section-1' },
      { id: 'task-2', text: 'Leave', score: 4, actors: ['Bob'], sectionId: 'section-1' },
    ])
    expect(events.filter(event => event.unit === 'statement' && event.kind === 'task').map(event => event.source)).toEqual([{ line: 3, unit: 'normalized' }, { line: 6, unit: 'normalized' }, { line: 6, unit: 'normalized' }])
  })

  test('Timeline retains actual event-before-period construction and continuation ownership', () => {
    const lines = ['timeline TD', '2025 : Launch', ': Follow up', 'section Future', '2026 : Expansion']
    const { result, events } = observe('timeline', () => parseTimelineDiagram(lines))
    expect(result).toEqual(parseTimelineDiagram(lines))
    const mutations = events.filter(event => event.unit === 'mutation')
    expect(mutations.findIndex(event => event.kind === 'addEvent')).toBeLessThan(mutations.findIndex(event => event.kind === 'addPeriod'))
    expect(mutations.filter(event => event.kind === 'addEvent').map(event => event.value)).toEqual([
      { id: 'event-0', text: 'Launch', periodId: 'period-0' }, { id: 'event-1', text: 'Follow up', periodId: 'period-0' }, { id: 'event-2', text: 'Expansion', periodId: 'period-1' },
    ])
    expect(mutations.find(event => event.kind === 'addPeriod')?.value).toEqual({ id: 'period-0', label: '2025', events: [{ id: 'event-0', text: 'Launch' }], sectionId: 'section-0' })
  })

  test('Mindmap records parent and decoration writes while preserving earlier node snapshots', () => {
    const source = 'mindmap\n  root((Root))\n    child["`Line one\nLine two`"]\n      ::icon(fa fa-book)\n      :::hot'
    const { result, events } = observe('mindmap', () => parseMindmap(source))
    expect(result).toEqual(parseMindmap(source))
    expect(events.filter(event => event.kind === 'createNode').map(event => event.value)).toEqual([
      { id: 'root', label: 'Root', shape: 'circle', children: [] },
      { id: 'child', label: 'Line one\nLine two', shape: 'rect', markdown: true, children: [] },
    ])
    expect(events.find(event => event.kind === 'attachChild')).toMatchObject({ value: { id: 'child', parentId: 'root' }, source: { line: 3, unit: 'normalized' } })
    expect(events.find(event => event.kind === 'setIcon')?.value).toEqual({ id: 'child', icon: 'fa fa-book' })
    expect(events.find(event => event.kind === 'setClass')?.value).toEqual({ id: 'child', className: 'hot' })
  })

  test('architecture retains completed writes when a later endpoint is rejected', () => {
    const events: Readonly<ParserObservation>[] = []
    expect(() => withParserObservation('architecture', event => events.push(event), () => parseArchitectureDiagram(['architecture-beta', 'service api(server)[API]', 'api:R --> L:missing']))).toThrow('Unknown architecture item')
    expect(events.filter(event => event.kind === 'addService')).toHaveLength(1)
    expect(events.filter(event => event.kind === 'addEdge')).toHaveLength(0)
  })
})
