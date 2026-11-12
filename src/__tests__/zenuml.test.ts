import { expect, test } from 'bun:test'
import { createZenUMLRenderer, renderZenUMLSVG, createUpstreamZenUMLRenderer, renderUpstreamZenUMLSVG, ZenUMLBackendError } from '../zenuml/index.ts'
import { parseRegisteredMermaid, registerStyle, renderMermaidSVG, serializeMermaid } from '../agent/core.ts'

const source = 'zenuml\nAlice->Bob: hello'

test('ZenUML has native semantics, shared styles and a separate explicit upstream capability boundary', () => {
  const parsed = parseRegisteredMermaid(source)
  expect(parsed.ok).toBe(true)
  if (!parsed.ok) return
  expect(parsed.value.body.kind).toBe('zenuml')
  expect(serializeMermaid(parsed.value)).toContain('Alice->Bob: hello')
})

test('native asynchronous entry works in Node with complete Look/Palette/role options and no backend URL', async () => {
  for (const style of [undefined, ['hand-drawn', 'dracula', { roles: { node: { fontSize: 22, paddingX: 16 }, edge: { strokeColor: '#ff0000' } } }]]) {
    const options = { embedFontImport: false, style }
    expect(await renderZenUMLSVG(source, options)).toBe(renderMermaidSVG(source, options))
  }
  expect(() => createZenUMLRenderer({ backendURL: 'https://example.test/frame.js' } as any)).toThrow(/UpstreamZenUML/)
  await expect(renderZenUMLSVG('flowchart LR\n A-->B')).rejects.toThrow()
})

test('native session captures options before awaits, keeps FIFO order and recovers after invalid input', async () => {
  const renderer = createZenUMLRenderer({ style: 'dracula', embedFontImport: false })
  const style = { colors: { bg: '#123456', fg: '#ffffff' } }
  let reads = 0
  const first = renderer.render(source, { get style() { reads++; return style } })
  style.colors.bg = '#654321'
  expect(await first).toContain('#123456')
  expect(reads).toBe(1)
  let unregister = registerStyle({ name: 'palette:test/native-zen-capture', colors: { bg: '#123456', fg: '#ffffff' } })
  try {
    const pending = renderer.render(source, { style: 'palette:test/native-zen-capture' })
    unregister()
    unregister = registerStyle({ name: 'palette:test/native-zen-capture', colors: { bg: '#654321', fg: '#ffffff' } })
    expect(await pending).toContain('#123456')
  } finally { unregister() }
  const completed: string[] = []
  const calls = [renderer.render('zenuml\nA->B: first').then(() => completed.push('first')), renderer.render('zenuml\nif (').catch(() => completed.push('invalid')), renderer.render('zenuml\nC->D: third', { style: undefined }).then(svg => { expect(svg).not.toContain('--bg:#282a36'); completed.push('third') })]
  await Promise.all(calls)
  expect(completed).toEqual(['first', 'invalid', 'third'])
  renderer.dispose()
  await expect(renderer.render(source)).rejects.toThrow(/disposed/)
})

test('native queue reserves capacity before reentrant getters and disposal rejects every admitted call', async () => {
  const renderer = createZenUMLRenderer()
  const nested: Array<Promise<unknown>> = []
  const outer = renderer.render(source, { get style() { for (let i = 0; i < 32; i++) nested.push(renderer.render(source)); return 'crisp' } })
  renderer.dispose()
  const results = await Promise.allSettled([outer, ...nested])
  expect(results).toHaveLength(33)
  expect(results.filter(result => result.status === 'rejected' && String(result.reason).includes('32 pending'))).toHaveLength(1)
  expect(results.filter(result => result.status === 'rejected' && String(result.reason).includes('disposed'))).toHaveLength(32)
})

test('explicit upstream rendering rejects a non-browser runtime before loading its backend', async () => {
  for (const invoke of [
    () => renderUpstreamZenUMLSVG(source, { backendURL: 'https://example.test/frame.js' }),
    () => createUpstreamZenUMLRenderer({ backendURL: 'https://example.test/frame.js' }),
  ]) {
    try { await invoke(); throw Error('expected runtime error') }
    catch (error) { expect(error).toBeInstanceOf(ZenUMLBackendError); expect((error as ZenUMLBackendError).code).toBe('UNSUPPORTED_RUNTIME') }
  }
})
