import { expect, test } from 'bun:test'
import { parseRegisteredMermaid, mutate, serializeMermaid, verifyMermaid } from '../agent/core.ts'
import type { TreemapValidDiagram } from '../agent/types.ts'

test('a structural Treemap edit publishes the identities seen by its rendered and reloaded artifact', () => {
  const parsed = parseRegisteredMermaid('treemap\n"Root"\n  "First": 10\n  "Branch"\n    "Retained": 20')
  if (!parsed.ok) throw Error('fixture did not parse')
  expect(parsed.value.body.kind).toBe('treemap')
  const changed = mutate(parsed.value as TreemapValidDiagram, { kind: 'remove_node', id: 'treemap-1' })
  if (!changed.ok) throw Error(changed.error.message)
  expect(changed.value.body.nodes.map(node => [node.label, node.parentId === undefined ? undefined : changed.value.body.nodes.find(parent => parent.id === node.parentId)?.label]))
    .toEqual([['Root', undefined], ['Branch', 'Root'], ['Retained', 'Branch']])
  const loaded = parseRegisteredMermaid(serializeMermaid(changed.value))
  if (!loaded.ok) throw Error('edit did not reload')
  expect(loaded.value.body).toEqual(changed.value.body)
  const layout = verifyMermaid(changed.value).layout
  expect([...layout.nodes, ...layout.groups].map(node => node.id).sort()).toEqual(changed.value.body.nodes.map(node => node.id).sort())
})
