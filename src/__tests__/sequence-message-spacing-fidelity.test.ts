import { afterAll, expect, test } from 'bun:test'
import { parseRegisteredMermaid, serializeMermaid, verifyMermaid } from '../agent/index.ts'
import { renderMermaidSVG } from '../index.ts'
import { parseSequenceDiagram, parseSequenceMessageLine } from '../sequence/parser.ts'
import { costRelativeToLinearScan } from './helpers/complexity.ts'
import { startUpstreamMermaid } from './helpers/upstream-mermaid.ts'

const upstream = startUpstreamMermaid()
afterAll(() => upstream.close())

const activationSource = `sequenceDiagram
  Alice-->>+Bob: Hello
  Bob-->>- Alice: Hi
`
const centralSource = `sequenceDiagram
  participant Alice
  participant Bob
  Alice ->>() Bob: Hello
`
const gallerySource = `sequenceDiagram
  participant Alice
  participant Bob
  Alice-->>+Bob: Hello
  Bob-->>- Alice: Hi
  Alice ->>() Bob: Center
`

function svgTexts(svg: string): string[] {
  return [...svg.matchAll(/<text\b[^>]*>([\s\S]*?)<\/text>/g)]
    .map(match => match[1]!.replace(/<[^>]+>/g, '').trim())
    .filter(Boolean)
}
const drawnTexts = (source: string): string[] => svgTexts(renderMermaidSVG(source))

test('pinned Mermaid 11.16 accepts spaced activation and central-connection messages', async () => {
  const messages = (source: string) => upstream.project(source, diagram => diagram.db.getMessages()
    .filter((message: any) => message.to)
    .map((message: any) => ({ from: message.from, to: message.to, text: message.message, central: Boolean(message.centralConnection) })))
  expect(await messages(activationSource)).toEqual({ ok: true, value: [
    { from: 'Alice', to: 'Bob', text: 'Hello', central: false },
    { from: 'Bob', to: 'Alice', text: 'Hi', central: false },
  ] })
  expect(await messages(centralSource)).toEqual({ ok: true, value: [{ from: 'Alice', to: 'Bob', text: 'Hello', central: true }] })
})

test('spaced activation marker retains the second message and deactivation across routes', () => {
  const native = parseSequenceDiagram(activationSource.trim().split('\n'))
  expect(native.actors.map(actor => actor.id)).toEqual(['Alice', 'Bob'])
  expect(native.messages.map(message => [message.from, message.to, message.label, message.activate, message.deactivate])).toEqual([
    ['Alice', 'Bob', 'Hello', true, undefined],
    ['Bob', 'Alice', 'Hi', undefined, true],
  ])
  expect(drawnTexts(activationSource)).toEqual(['Hello', 'Hi', 'Alice', 'Bob'])

  const parsed = parseRegisteredMermaid(activationSource)
  expect(parsed.ok).toBe(true)
  if (!parsed.ok) return
  expect(parsed.value.body.kind).toBe('sequence')
  if (parsed.value.body.kind !== 'sequence') return
  expect(parsed.value.body.messages.map(message => [message.from, message.to, message.text, message.deactivate])).toEqual([
    ['Alice', 'Bob', 'Hello', undefined],
    ['Bob', 'Alice', 'Hi', true],
  ])
  expect(verifyMermaid(parsed.value).ok).toBe(true)
  expect(drawnTexts(serializeMermaid(parsed.value))).toEqual(['Hello', 'Hi', 'Alice', 'Bob'])
})

test('spaced central connection retains its endpoint without inventing a participant', () => {
  const native = parseSequenceDiagram(centralSource.trim().split('\n'))
  expect(native.actors.map(actor => actor.id)).toEqual(['Alice', 'Bob'])
  expect(native.messages.map(message => [message.from, message.to, message.label, message.centralEnd])).toEqual([
    ['Alice', 'Bob', 'Hello', true],
  ])
  expect(drawnTexts(centralSource)).toEqual(['Hello', 'Alice', 'Bob'])

  const parsed = parseRegisteredMermaid(centralSource)
  expect(parsed.ok).toBe(true)
  if (!parsed.ok) return
  expect(parsed.value.body.kind).toBe('sequence')
  if (parsed.value.body.kind !== 'sequence') return
  expect(parsed.value.body.participants.map(participant => participant.id)).toEqual(['Alice', 'Bob'])
  expect(parsed.value.body.messages.map(message => [message.from, message.to, message.text, message.centralEnd])).toEqual([
    ['Alice', 'Bob', 'Hello', true],
  ])
  expect(verifyMermaid(parsed.value).ok).toBe(true)
  expect(drawnTexts(serializeMermaid(parsed.value))).toEqual(['Hello', 'Alice', 'Bob'])
})

test('a long malformed whitespace tail is rejected without marker backtracking', () => {
  const line = `Alice->>${' '.repeat(64_000)}:missing`
  expect(parseSequenceMessageLine(line)).toBeNull()
  // Linear rejection costs about one plain scan of the line (0.2-0.9x measured,
  // idle and under load); marker backtracking over the 64K spaces costs
  // tens of thousands of scans.
  expect(costRelativeToLinearScan(line, () => parseSequenceMessageLine(line))).toBeLessThan(100)
})

test('the reviewed gallery source draws the activation, deactivation, and central messages', () => {
  expect(drawnTexts(gallerySource)).toEqual(['Hello', 'Hi', 'Center', 'Alice', 'Bob'])
})
