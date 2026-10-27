import { expect, test } from 'bun:test'
import { renderZenUMLSVG, ZenUMLBackendError, ZENUML_CAPABILITIES } from '../zenuml/index.ts'
import { parseRegisteredMermaid, serializeMermaid } from '../agent/core.ts'

test('ZenUML source preservation does not claim native semantic editing', () => {
  const source = 'zenuml\n  title Demo\n  Alice->John: Hello John'
  const parsed = parseRegisteredMermaid(source)
  expect(parsed.ok).toBe(true)
  if (!parsed.ok) return
  expect(parsed.value.body.kind).toBe('preserved')
  expect(serializeMermaid(parsed.value)).toBe(source)
  expect(ZENUML_CAPABILITIES.nativeParse).toBe(false)
  expect(ZENUML_CAPABILITIES.typedEditing).toBe(false)
})
test('optional ZenUML rejects a non-browser runtime before loading dependencies', async () => {
  try {
    await renderZenUMLSVG('zenuml\nAlice->Bob: hello', { backendURL: 'https://example.test/frame.js' })
    throw Error('expected runtime error')
  } catch (error) {
    expect(error).toBeInstanceOf(ZenUMLBackendError)
    expect((error as ZenUMLBackendError).code).toBe('UNSUPPORTED_RUNTIME')
  }
})
