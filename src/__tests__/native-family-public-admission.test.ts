import { expect, test } from 'bun:test'
import { parseRegisteredMermaid } from '../agent/core.ts'

// This entry point predates these families. Keep the admission assertion
// runnable on the base revision: an unsupported-family exception must become a
// completed behavioral assertion failure, rather than an import/setup error.
for (const [kind, source] of [
  ['eventmodeling', 'eventmodeling\ntf 01 ui Cart\ntf 02 cmd AddItem\ntf 03 evt ItemAdded'],
  ['zenuml', 'zenuml\nClient->API.checkout() { return receipt }'],
] as const) test(`${kind} public admission returns a native body without an unsupported-family exception`, () => {
  expect(() => parseRegisteredMermaid(source)).not.toThrow()
  const result = parseRegisteredMermaid(source)
  expect(result.ok).toBe(true)
  if (result.ok) expect(result.value.body.kind).toBe(kind)
})
