import { expect, test } from 'bun:test'
import { createExtraCommunityApi } from '../unified/community-extra-adapters.mjs'

const fixture = (name: string, module: unknown) => createExtraCommunityApi({ module, artifact: { kind: 'node', root: '/unused-fixture', version: 'fixture', runtime: 'Node' }, node: { id: 'authored-adapter-fixture' }, config: { package: name }, output: 'react-flow', cleanups: [] })
const input = { id: 'authored-edge-label', family: 'flowchart', source: 'flowchart LR\n A[Start] -->|approved| B[End]', features: [], provenance: 'independently authored public IR label expectations', expectedLabels: ['Start', 'End', 'approved'] }

test('native React Flow edge labels retain authored edge text without source sidecars', async () => {
  const adapter = await fixture('mermaid-reactflow-render', { convertMermaidToReactFlow() {} })
  if (!adapter.qualify) throw Error('React Flow public adapter has no qualifier')
  const qualify = adapter.qualify
  const value = {
    nodes: [
      { id: 'a', data: { label: 'Start' } },
      { id: 'b', data: { label: 'End' } },
    ],
    edges: [{ source: 'a', target: 'b', label: 'approved' }],
  }
  expect(qualify(value, input)).toContain('native node/edge fields')
  expect(() => qualify({ ...value, edges: [{ source: 'a', target: 'b' }], source: input.source }, input)).toThrow('approved')
  expect(() => qualify({ ...value, edges: [{ source: 'a', target: 'b', label: 'rejected' }] }, input)).toThrow('approved')
})

test('the Rusty public qualifier receives the independently valid core workload', async () => {
  const adapter = await fixture('rusty-mermaid', { validateMermaid() {} })
  if (!adapter.qualify) throw Error('Rusty public adapter has no qualifier')
  const qualify = adapter.qualify
  const core = { ...input, features: ['core-graph-batch'] }
  expect(qualify({ valid: true, diagramType: 'flowchart', errors: [] }, core)).toContain('zero error findings')
  expect(() => qualify({ valid: false, diagramType: 'flowchart', errors: [{ severity: 'error', message: 'rejected' }] }, core)).toThrow('independently valid')
})
