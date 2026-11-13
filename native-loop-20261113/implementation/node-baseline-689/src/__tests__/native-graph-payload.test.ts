import { expect, test } from 'bun:test'
import { parseRegisteredMermaid, serializeMermaid, synthesizeFromGraph } from '../agent/core.ts'
import type { ValidDiagramPayload } from '../agent/types.ts'

const sources = [
  'swimlane-beta LR\nsubgraph team[Team]\nA[Start]\nB{Done?}\nend\nA handoff@--> B\nclassDef active fill:red\nclass A active',
  'agentflow-beta LR\nconnector api[API]\nglobal\nguide[Guide]@{ shape: refdoc }\nend\nflow team[Team]\nA[Draft]@{ shape: tool, connectorRef: api.chat, custom: retained }\nend\nA --> guide',
]

test.each(sources)('graph dialect payloads retain graph ownership and family records across JSON', source => {
  const parsed = parseRegisteredMermaid(source)
  if (!parsed.ok) throw new Error(parsed.error.map(error => error.message).join('; '))
  const payload = JSON.parse(JSON.stringify(parsed.value, (_key, value) => value instanceof Map ? Object.fromEntries(value) : value instanceof Set ? [...value] : value)) as ValidDiagramPayload
  const restored = synthesizeFromGraph(payload)
  if (!restored.ok) throw new Error(restored.error.map(error => error.message).join('; '))
  expect(restored.value.body.kind).toBe(parsed.value.body.kind)
  expect(serializeMermaid(restored.value)).toBe(serializeMermaid(parsed.value))
  if (parsed.value.body.kind === 'agentflow' && restored.value.body.kind === 'agentflow') {
    expect(restored.value.body.connectors).toEqual(parsed.value.body.connectors)
    expect(restored.value.body.globals).toEqual(parsed.value.body.globals)
    expect(restored.value.body.metadata).toEqual(parsed.value.body.metadata)
  }
})
