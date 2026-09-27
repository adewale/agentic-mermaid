import { expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseRegisteredMermaid, serializeMermaid, verifyMermaid } from '../agent/index.ts'
import { renderMermaidSVG } from '../index.ts'
import { parseSequenceDiagram, parseSequenceMessageLine } from '../sequence/parser.ts'

const source = `sequenceDiagram
  participant Alice
  participant Bob
  Alice ()-->> Bob: Reverse
  Alice ()->>() Bob: Dual
`

function texts(svg: string): string[] {
  return [...svg.matchAll(/<text\b[^>]*>([\s\S]*?)<\/text>/g)]
    .map(match => match[1]!.replace(/<[^>]+>/g, '').trim())
    .filter(Boolean)
}

test('pinned Mermaid 11.16 treats sender-spaced central markers as messages', () => {
  const script = `
    import DOMPurify from 'dompurify'
    DOMPurify.addHook = () => {}
    DOMPurify.sanitize = text => text
    const { default: mermaid } = await import('mermaid')
    mermaid.initialize({ startOnLoad: false })
    const diagram = await mermaid.mermaidAPI.getDiagramFromText(${JSON.stringify(source)})
    process.stdout.write(JSON.stringify(diagram.db.getMessages()
      .filter(message => message.to)
      .map(message => ({ from: message.from, to: message.to, text: message.message, central: Boolean(message.centralConnection) }))))
  `
  const probe = Bun.spawnSync({ cmd: [process.execPath, '-e', script], cwd: process.cwd(), stdout: 'pipe', stderr: 'pipe' })
  expect(probe.exitCode).toBe(0)
  expect(JSON.parse(new TextDecoder().decode(probe.stdout))).toEqual([
    { from: 'Alice', to: 'Bob', text: 'Reverse', central: true },
    { from: 'Alice', to: 'Bob', text: 'Dual', central: true },
  ])
})

test('native and agent retain sender-spaced central messages and exactly two actors', () => {
  const native = parseSequenceDiagram(source.trim().split('\n'))
  expect(native.actors.map(actor => actor.id)).toEqual(['Alice', 'Bob'])
  expect(native.messages.map(message => [message.from, message.to, message.label, message.centralStart, message.centralEnd])).toEqual([
    ['Alice', 'Bob', 'Reverse', true, false],
    ['Alice', 'Bob', 'Dual', true, true],
  ])
  expect(texts(renderMermaidSVG(source))).toEqual(['Reverse', 'Dual', 'Alice', 'Bob'])

  const parsed = parseRegisteredMermaid(source)
  expect(parsed.ok).toBe(true)
  if (!parsed.ok) return
  expect(parsed.value.body.kind).toBe('sequence')
  if (parsed.value.body.kind !== 'sequence') return
  expect(parsed.value.body.participants.map(participant => participant.id)).toEqual(['Alice', 'Bob'])
  expect(parsed.value.body.messages.map(message => [message.from, message.to, message.text, message.centralStart, message.centralEnd])).toEqual([
    ['Alice', 'Bob', 'Reverse', true, undefined],
    ['Alice', 'Bob', 'Dual', true, true],
  ])
  expect(verifyMermaid(parsed.value).ok).toBe(true)
  expect(texts(renderMermaidSVG(serializeMermaid(parsed.value)))).toEqual(['Reverse', 'Dual', 'Alice', 'Bob'])
})

test('spaced central-start parsing stays bounded on malformed long tails', () => {
  const started = performance.now()
  expect(parseSequenceMessageLine(`Alice ${' '.repeat(64_000)}() ${' '.repeat(64_000)}:missing`)).toBeNull()
  expect(performance.now() - started).toBeLessThan(500)
})

test('reviewer-facing before and after SVGs match the missing and recovered messages', () => {
  const asset = (which: 'before' | 'after') => readFileSync(
    join(import.meta.dir, `../../docs/pr-assets/issue-248-sequence-sender-central-spacing-${which}.svg`), 'utf8')
  expect(texts(asset('before'))).toEqual(['Alice', 'Bob'])
  expect(asset('after')).toBe(renderMermaidSVG(source))
  expect(texts(asset('after'))).toEqual(['Reverse', 'Dual', 'Alice', 'Bob'])
})
