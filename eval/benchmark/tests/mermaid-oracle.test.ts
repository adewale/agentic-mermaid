import { expect, test } from 'bun:test'
import { assertMermaidOracle, assertOracleAgrees } from '../portable/mermaid-oracle.ts'

test('the pinned Mermaid refuses authored expectations it contradicts and types the sources it accepts', async () => {
  const oracle = assertMermaidOracle()
  const valid = { id: 'valid-flowchart', source: 'flowchart LR\nA --> B', accept: true }
  expect(await assertOracleAgrees(oracle, [valid, { id: 'invalid-arrow', source: 'flowchart LR\n --> -->', accept: false }])).toEqual({ 'valid-flowchart': 'flowchart-v2' })
  await expect(assertOracleAgrees(oracle, [valid, { id: 'claimed-valid', source: 'flowchart LR\n --> -->', accept: true }, { id: 'claimed-invalid', source: 'pie\n"A" : 1', accept: false }])).rejects.toThrow(/claimed-valid \(rejected: .+\); claimed-invalid \(accepted\)/)
})
