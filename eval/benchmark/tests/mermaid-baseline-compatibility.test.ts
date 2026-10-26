import { expect, test } from 'bun:test'
import { groupParserInputs, parseMermaidBaselineOptions } from '../unified/mermaid-baseline-compatibility.ts'
import { classifyParserReturn, classifyParserThrow } from '../unified/mermaid-baseline-parser-worker.mjs'

test('public parser failures distinguish grammar rejection from backend crashes and forged error codes', () => {
  for (const error of [new TypeError('DOMPurify.addHook is not a function'), new TypeError('Parse error on line 1'), new ReferenceError('document is not defined'), new Error('driver startup failed')]) {
    const actual = classifyParserThrow(error, 'mermaid')
    expect(actual.accepted).toBeNull()
    expect(actual.syntaxRejected).toBe(false)
  }
  expect(classifyParserThrow(new Error('Parse error on line 1: unexpected arrow'), 'mermaid').syntaxRejected).toBe(true)
  class PublicPeleError extends Error {
    code = 'syntax'
  }
  expect(classifyParserThrow(new PublicPeleError('Bad syntax'), 'pele', PublicPeleError).accepted).toBe(false)
  expect(classifyParserThrow(Object.assign(new Error('Backend crashed'), { code: 'syntax' }), 'pele', PublicPeleError).accepted).toBeNull()
  const unsupported = new PublicPeleError('Unsupported public diagram')
  unsupported.code = 'unsupported-diagram'
  expect(classifyParserThrow(unsupported, 'pele', PublicPeleError).unsupported).toBe(true)
  expect(classifyParserThrow(unsupported, 'pele', PublicPeleError).syntaxRejected).toBe(false)
})

test('forward-compatible preservation is not native admission or a negative syntax rejection', () => {
  const preserved = classifyParserReturn({ ok: true, value: { kind: 'family:upstream/future', body: { kind: 'preserved' } } }, 'agentic')
  expect(preserved.publicAccepted).toBe(true)
  expect(preserved.accepted).toBeNull()
  expect(preserved.preserved).toBe(true)
  expect(preserved.syntaxRejected).toBe(false)
  expect(classifyParserReturn({ ok: false, error: [{ code: 'PARSE_ERROR', message: 'Expected endpoint' }] }, 'agentic').syntaxRejected).toBe(true)
  expect(classifyParserReturn({ ok: false, error: [{ code: 'PARSE_FAILED', message: 'Expected endpoint' }] }, 'agentic').syntaxRejected).toBe(true)
  expect(classifyParserReturn({ ok: false, error: [{ code: 'FAMILY_DESCRIPTOR_CONTRACT', message: 'Broken plugin' }] }, 'agentic').accepted).toBeNull()
})

test('identical source/prelude corpus membership aliases one invocation without shrinking conflicting expectations', () => {
  const input = { bindingId: 'authored/first', caseId: 'first', cohort: 'family', family: 'flowchart', source: 'flowchart LR\nA --> B', expectedAccepted: true, expectedTypes: ['flowchart'] }
  const grouped = groupParserInputs([input, { ...input, bindingId: 'required/first', cohort: 'required' }])
  expect(grouped).toHaveLength(1)
  expect(grouped[0]!.bindings.map(row => row.bindingId)).toEqual(['authored/first', 'required/first'])
  expect(groupParserInputs([input, { ...input, prelude: [{ source: 'flowchart TB\nC --> D', accept: true }] }])).toHaveLength(2)
  expect(() => groupParserInputs([input, { ...input, expectedAccepted: false }])).toThrow('conflicting')
})

test('parser baseline invocation rejects unknown and duplicate switches instead of silently changing its samples', () => {
  expect(parseMermaidBaselineOptions(['--startup-samples', '25', '--resource-samples', '5']).parserStartupSamples).toBe(25)
  expect(() => parseMermaidBaselineOptions(['--startup-samples', '0'])).toThrow('positive integer')
  expect(() => parseMermaidBaselineOptions(['--startup-samples', '25', '--startup-samples', '30'])).toThrow('Duplicate')
  expect(() => parseMermaidBaselineOptions(['--unreviewed-adapter', 'private'])).toThrow('Invalid')
})
