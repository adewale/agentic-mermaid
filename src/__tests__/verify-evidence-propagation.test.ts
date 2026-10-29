import { expect, test } from 'bun:test'
import { parseRegisteredMermaid, verifyMermaid } from '../agent/index.ts'
import { BUILTIN_FAMILY_METADATA } from '../agent/families.ts'
import type { ParsedDiagram, VerifyOptions } from '../agent/types.ts'

/** Model a loss already discovered by admission, independently of whether a
 * particular family still has a lossy serializer. */
function knownLoss(source: string): ParsedDiagram {
  const parsed = parseRegisteredMermaid(source)
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.error))
  return { ...parsed.value, meta: { ...parsed.value.meta, droppedComments: [{ text: 'already lost', line: 2 }] } }
}

const OPTIONS: VerifyOptions[] = [
  {},
  { suppress: ['COMMENT_DROPPED'] },
  { renderOptions: { mermaidConfig: { themeVariables: { background: 'notacolor()' } } } },
  { renderOptions: { mermaidConfig: { themeVariables: { background: 'notacolor()' } } }, suppress: ['COMMENT_DROPPED', 'RENDER_FAILED', 'INTERNAL_ERROR'] },
]

for (const family of BUILTIN_FAMILY_METADATA) {
  test(`${family.id}: already known source loss survives all suppression and config outcomes`, () => {
    const parsed = knownLoss(family.example)
    for (const options of OPTIONS) {
      const result = verifyMermaid(parsed, options)
      expect(result.checks?.sourceLoss).toBe('detected')
      expect(result.checks?.taskCorrectness).toBe('not-checked')
      expect(result.warnings.some(warning => warning.code === 'COMMENT_DROPPED')).toBe(!options.suppress?.includes('COMMENT_DROPPED'))
    }
  })
}

test.each(['flowchart TD', 'notARegisteredDiagram\n payload'])('early empty/preserved return cannot discard known source loss: %s', source => {
  for (const options of OPTIONS) {
    const result = verifyMermaid(knownLoss(source), options)
    expect(result.checks?.sourceLoss).toBe('detected')
    expect(result.warnings.some(warning => warning.code === 'COMMENT_DROPPED')).toBe(!options.suppress?.includes('COMMENT_DROPPED'))
  }
})

test('structural loss remains visible when configuration rejects before layout', () => {
  const parsed = parseRegisteredMermaid('flowchart LR\n A --> B')
  if (!parsed.ok || parsed.value.body.kind !== 'flowchart') throw new Error('expected Flowchart')
  // Simulate a faulty producer: two model entries serialize to the same
  // authored identity, so reparsing demonstrably loses one node.
  parsed.value.body.graph.nodes.set('extra', { ...parsed.value.body.graph.nodes.get('A')! })
  const result = verifyMermaid(parsed.value, {
    renderOptions: { mermaidConfig: { themeVariables: { background: 'notacolor()' } } },
    suppress: ['CONTENT_DROPPED_ON_ROUNDTRIP'],
  })
  expect(result.warnings.some(warning => warning.code === 'CONTENT_DROPPED_ON_ROUNDTRIP')).toBe(false)
  expect(result.checks).toEqual({ renderability: 'failed', sourceLoss: 'detected', taskCorrectness: 'not-checked' })
})

test('an invalid externally assembled model cannot make source-evidence collection throw', () => {
  const parsed = knownLoss('flowchart LR\n A --> B')
  if (parsed.body.kind !== 'flowchart') throw new Error('expected Flowchart')
  parsed.body.graph.nodes = undefined as never
  const result = verifyMermaid(parsed, { suppress: ['COMMENT_DROPPED'] })
  expect(result.checks).toEqual({ renderability: 'failed', sourceLoss: 'detected', taskCorrectness: 'not-checked' })
  expect(result.warnings.some(warning => warning.code === 'INTERNAL_ERROR')).toBe(true)
})
