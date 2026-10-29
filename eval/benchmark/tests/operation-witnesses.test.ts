import { expect, test } from 'bun:test'
import * as api from '../../../src/agent/index.ts'
import { runOperationDiagnostics, runOperationWitnesses, typedBodyContains, type OperationWitnessApi } from '../unified/operation-witnesses.ts'

function parsed(source: string) {
  const result = api.parseRegisteredMermaid(source)
  if (!result.ok) throw Error(JSON.stringify(result.error))
  return result.value
}
test('a requested metadata update is checked in the typed body and serialized reading', () => {
  const diagram = parsed('pie\n"Original": 5\n')
  const result = runOperationWitnesses(api, 'pie', diagram).find(row => row.kind === 'set_title')!
  expect(result.positive.status).toBe('passed')
  expect(result.positive.requestedOperation).toEqual({ kind: 'set_title', title: 'witness_changed' })
  expect(result.positive.source).toContain('witness_changed')
  expect(result.rejection.status).toBe('passed')
  expect(result.rejection.requestedOperation).toEqual({ kind: 'set_title', title: 'witness_changed', __benchmarkUnknownField: true })
  expect(result.rejection.error).toHaveProperty('code', 'INVALID_OP')
  expect(diagram.body).not.toHaveProperty('title')
})
test('a dropped mutation never receives positive semantic credit', () => {
  const broken: OperationWitnessApi = { ...api, mutate: (diagram, operation) => (operation.kind === 'set_title' ? { ok: true, value: diagram } : api.mutate(diagram as Parameters<typeof api.mutate>[0], operation)) }
  const result = runOperationWitnesses(broken, 'pie', parsed('pie\n"Original": 5\n')).find(row => row.kind === 'set_title')!
  expect(result.positive.status).toBe('failed')
  expect(result.positive.findings).toContain('Typed mutation result does not contain the independently requested effect')
})
test('renaming preserves endpoint identities and parallel-edge multiplicity', () => {
  const diagram = parsed('flowchart LR\nA[First] --> B[Second]\nA --> B\nB --> C[Third]\n')
  const result = runOperationWitnesses(api, 'flowchart', diagram).find(row => row.kind === 'rename_node')!
  expect(result.positive.status).toBe('passed')
  const again = parsed(result.positive.source!)
  if (again.body.kind !== 'flowchart') throw Error('wrong family')
  expect(again.body.graph.edges.map(edge => [edge.source, edge.target])).toEqual([
    ['witness_changed', 'B'],
    ['witness_changed', 'B'],
    ['B', 'C'],
  ])
  const broken: OperationWitnessApi = {
    ...api,
    mutate: (value, operation) => {
      const result = api.mutate(value, operation)
      if (result.ok && operation.kind === 'rename_node' && value.body.kind === 'flowchart' && result.value.body.kind === 'flowchart') result.value.body.graph.edges = value.body.graph.edges
      return result
    },
  }
  const wrong = runOperationWitnesses(broken, 'flowchart', diagram).find(row => row.kind === 'rename_node')!
  expect(wrong.positive.status).toBe('failed')
  expect(wrong.positive.findings).toContain('Operation changed unrelated endpoint identities or relation multiplicity')
})
test('checked rejection must reject the malformed payload and preserve its input', () => {
  const accepting: OperationWitnessApi = { ...api, mutateChecked: diagram => ({ ok: true, value: diagram }) }
  expect(runOperationWitnesses(accepting, 'pie', parsed('pie\n"Original": 5\n')).find(row => row.kind === 'set_title')!.rejection.status).toBe('failed')
  const destructive: OperationWitnessApi = {
    ...api,
    mutateChecked: diagram => {
      diagram.body.title = 'Illicit change'
      return { ok: false, error: { code: 'INVALID_OP' } }
    },
  }
  const result = runOperationWitnesses(destructive, 'pie', parsed('pie\n"Original": 5\n')).find(row => row.kind === 'set_title')!
  expect(result.rejection.status).toBe('failed')
  expect(result.rejection.findings).toContain('Rejected mutation changed its input diagram')
})
test('reordering keeps numeric values and packet widths attached to the authored item', () => {
  const radar = parsed('radar-beta\naxis first["First"], second["Second"], third["Third"]\ncurve sample["Sample"]{2, 7, 4}\nmax 10\n')
  const correct = runOperationWitnesses(api, 'radar', radar).find(row => row.kind === 'reorder_axis')!
  expect(correct.positive.status).toBe('passed')
  const again = parsed(correct.positive.source!)
  if (again.body.kind !== 'radar') throw Error('wrong family')
  expect(again.body.axes.map(axis => axis.id)).toEqual(['second', 'first', 'third'])
  expect(again.body.curves[0]!.values).toEqual([7, 2, 4])
  const mixedValues: OperationWitnessApi = {
    ...api,
    mutate: (diagram, operation) => {
      const result = api.mutate(diagram as Parameters<typeof api.mutate>[0], operation)
      if (result.ok && operation.kind === 'reorder_axis' && result.value.body.kind === 'radar') result.value.body.curves = diagram.body.curves
      return result
    },
  }
  expect(runOperationWitnesses(mixedValues, 'radar', radar).find(row => row.kind === 'reorder_axis')!.positive.status).toBe('failed')
  const packet = parsed('packet\n0-7: "First"\n8-23: "Second"\n')
  expect(runOperationWitnesses(api, 'packet', packet).find(row => row.kind === 'move_field')!.positive.status).toBe('passed')
  const truncated: OperationWitnessApi = {
    ...api,
    mutate: (diagram, operation) => {
      const result = api.mutate(diagram as Parameters<typeof api.mutate>[0], operation)
      if (result.ok && operation.kind === 'move_field' && result.value.body.kind === 'packet') result.value.body.fields = result.value.body.fields.map((field, index) => ({ ...field, start: index * 8, end: index * 8 + 7 }))
      return result
    },
  }
  expect(runOperationWitnesses(truncated, 'packet', packet).find(row => row.kind === 'move_field')!.positive.status).toBe('failed')
})
test('raw source and statement sidecars do not satisfy a typed-value witness', () => {
  expect(typedBodyContains({ kind: 'opaque', source: 'witness' }, 'witness')).toBe(false)
  expect(typedBodyContains({ kind: 'c4', statements: [{ raw: 'witness', signature: 'witness' }] }, 'witness')).toBe(false)
  expect(typedBodyContains({ kind: 'sankey', links: [{ source: 'witness', target: 'Sink', value: 7 }] }, 'witness')).toBe(true)
})
test('an unrepresentable edit must reject atomically or preserve exact section ownership', () => {
  const forbidden = (operation: Record<string, any>) => operation.kind === 'move_section' || (operation.kind === 'add_section' && operation.index === 0)
  const rejecting: OperationWitnessApi = { ...api, mutate: (diagram, operation) => (forbidden(operation) ? { ok: false, error: { code: 'INVALID_OP' } } : api.mutate(diagram as Parameters<typeof api.mutate>[0], operation)) }
  const losingOwnership: OperationWitnessApi = {
    ...api,
    mutate: (diagram, operation) => {
      if (!forbidden(operation)) return api.mutate(diagram as Parameters<typeof api.mutate>[0], operation)
      const sections = operation.kind === 'move_section' ? [...diagram.body.sections].reverse() : [{ id: 'inserted', label: 'Named section', periods: [], tasks: [] }, ...diagram.body.sections]
      return { ok: true, value: { ...diagram, body: { ...diagram.body, sections } } }
    },
  }
  for (const family of ['timeline', 'journey']) {
    expect(runOperationDiagnostics(rejecting, family).map(result => result.status)).toEqual(['passed', 'passed'])
    const results = runOperationDiagnostics(losingOwnership, family)
    expect(results.map(result => result.status)).toEqual(['failed', 'failed'])
    expect(results.every(result => result.findings.join(' ').includes('lost section ownership/order'))).toBe(true)
  }
})
