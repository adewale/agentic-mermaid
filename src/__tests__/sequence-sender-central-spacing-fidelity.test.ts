import { afterAll, expect, test } from 'bun:test'
import { parseRegisteredMermaid, serializeMermaid, verifyMermaid } from '../agent/index.ts'
import { renderMermaidSVG } from '../index.ts'
import { parseSequenceDiagram, parseSequenceMessageLine } from '../sequence/parser.ts'
import { costRelativeToLinearScan } from './helpers/complexity.ts'
import { startUpstreamMermaid } from './helpers/upstream-mermaid.ts'

const upstream = startUpstreamMermaid()
afterAll(() => upstream.close())

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

test('pinned Mermaid 11.16 treats sender-spaced central markers as messages', async () => {
  expect(await upstream.project(source, diagram => diagram.db.getMessages()
    .filter((message: any) => message.to)
    .map((message: any) => ({ from: message.from, to: message.to, text: message.message, central: Boolean(message.centralConnection) })))).toEqual({ ok: true, value: [
    { from: 'Alice', to: 'Bob', text: 'Reverse', central: true },
    { from: 'Alice', to: 'Bob', text: 'Dual', central: true },
  ] })
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
  const line = `Alice ${' '.repeat(64_000)}() ${' '.repeat(64_000)}:missing`
  expect(parseSequenceMessageLine(line)).toBeNull()
  // Linear rejection costs a few plain scans of the line (3.5-7.5x measured,
  // idle and under load); backtracking over either space run costs tens of
  // thousands.
  expect(costRelativeToLinearScan(line, () => parseSequenceMessageLine(line))).toBeLessThan(100)
})

test('sender-spaced central fallback does not accept forms Mermaid rejects', async () => {
  const rejected = [
    'Alice ()->>+Bob: Invalid activation',
    'Alice ()->>-Bob: Invalid deactivation',
    'Alice ()->>()+Bob: Invalid dual activation',
    'Alice() ()->> Bob: Invalid duplicate sender marker',
    'A+B ()->> Bob: Invalid plus in sender',
    'A<B ()->> Bob: Invalid angle in sender',
    'A>B ()->> Bob: Invalid angle in sender',
    'participant ()->> Bob: Invalid directive sender',
    'Note ()->> Bob: Invalid note sender',
    'over ()->> Bob: Invalid reserved sender',
    'properties ()->> Bob: Invalid reserved sender',
    '1 ()->> Bob: Invalid numeric sender',
    '1.1 ()->> Bob: Invalid decimal sender',
    'Alice ()->> B+B: Invalid plus in receiver',
    'Alice ()->> B<B: Invalid angle in receiver',
    'Alice ()->> B>B: Invalid angle in receiver',
    'Alice ()->> B(): Invalid central-looking receiver',
    'Alice ()->> participant: Invalid directive receiver',
    'Alice ()->> accDescr: Invalid accessibility receiver',
  ]
  expect(await Promise.all(rejected.map(line => upstream.accepts(`sequenceDiagram\n  participant Alice\n  participant Bob\n  ${line}`))))
    .toEqual(rejected.map(() => false))
  for (const line of rejected) expect(parseSequenceMessageLine(line)).toBeNull()
})

test('a title-like line is not promoted to a central message', async () => {
  const line = 'title ()->> Bob: A title, not a message'
  expect(await upstream.project(`sequenceDiagram\n  ${line}`, diagram => diagram.db.getMessages().filter((message: any) => message.to).length))
    .toEqual({ ok: true, value: 0 })
  expect(parseSequenceMessageLine(line)).toBeNull()
})

const centralMessages = (senders: readonly string[]) => upstream.projectAll(senders.map(sender => `sequenceDiagram\n  ${sender} ()->> Bob: x`), diagram => {
  const message = diagram.db.getMessages().find((candidate: any) => candidate.to)
  return { from: message.from, central: Boolean(message.centralConnection) }
})

test('ambiguous punctuation senders do not gain a false central-connection claim', async () => {
  const senders = ['A-B', 'A/B', 'A(B)']
  expect(await centralMessages(senders)).toEqual(senders.map(from => ({ from: `${from} ()`, central: false })))
  for (const sender of senders) expect(parseSequenceMessageLine(`${sender} ()->> Bob: x`)).toBeNull()
})

test('non-numeric punctuation and alphanumeric senders retain upstream central meaning', async () => {
  const senders = ['.', '1.', '..', '1..', '1A', 'A_B', 'é']
  expect(await centralMessages(senders)).toEqual(senders.map(from => ({ from, central: true })))
  for (const sender of senders) expect(parseSequenceMessageLine(`${sender} ()->> Bob: x`)).toMatchObject({ from: sender, centralStart: true })
})
