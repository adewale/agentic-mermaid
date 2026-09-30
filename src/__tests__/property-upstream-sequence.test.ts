// Grammar-based differential test for sequence diagrams against the pinned
// upstream Mermaid (11.16.0), the companion of property-upstream-flowchart.
//
//   (i)   upstream accepts every generated source — validates the generator;
//   (ii)  parseRegisteredMermaid accepts it as a structured sequence diagram;
//   (iii) participants (id, label, participant/actor) agree with upstream's
//         sequence DB, and so does every typed message (endpoints, arrow,
//         text, in source order, fragments included); the faithfulness
//         counter reports upstream's participant count and the typed messages;
//   (iv)  parse → serialize → re-parse preserves all of the above;
//   (v)   relabelling any participant keeps every participant in place, for
//         our re-parse and upstream's alike.
//
// Blocks nest two deep and may hold notes and declarations. Our typed model
// covers loop / alt / opt / par blocks whose branches hold only messages; any
// other block stays a lossless opaque segment by design, so its messages are
// source rather than typed messages, while the participants it creates are
// still compared. Declarations may repeat and follow first use.

import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import fc from 'fast-check'
import { asSequence, describeMermaidFacts, mutate, parseRegisteredMermaid, serializeMermaid } from '../agent/index.ts'
import { countStructuralElements } from '../agent/structural-count.ts'
import type { SequenceBody, SequenceMessage, SequenceMutationOp } from '../agent/types.ts'
import { renderMermaidSVG } from '../index.ts'
import { parseSequenceDiagram } from '../sequence/parser.ts'
import { startUpstreamMermaid, type UpstreamMermaid, type UpstreamParse } from './helpers/upstream-mermaid.ts'

// ---------------------------------------------------------------------------
// The grammar
// ---------------------------------------------------------------------------

// Our arrow spelling → upstream LINETYPE (mermaid sequenceDb).
const ARROWS = { '->>': 0, '-->>': 1, '->': 5, '-->': 6, '-x': 3, '--x': 4, '-)': 24, '--)': 25 } as const
type Arrow = keyof typeof ARROWS
const UPSTREAM_ARROW_TYPES = new Set<number>(Object.values(ARROWS))

type Message = { from: string; arrow: Arrow; to: string; text: string }
const CONTINUATIONS = { loop: null, opt: null, break: null, rect: null, alt: 'else', par: 'and', critical: 'option' } as const
type BlockKeyword = keyof typeof CONTINUATIONS
type Statement =
  | { kind: 'declare'; keyword: 'participant' | 'actor'; id: string; alias?: string; metadata?: { type?: string; alias?: string } }
  | { kind: 'link'; id: string; label: string; href: string }
  | { kind: 'message'; message: Message }
  | { kind: 'note'; placement: 'left of' | 'right of' | 'over'; ids: string[]; text: string }
  | { kind: 'block'; keyword: BlockKeyword; label: string; branches: Array<{ label: string; statements: Statement[] }> }

const IDS = ['A', 'B', 'Carol', 'd1', 'E_x']
const WORDS = ['hello', 'Ping', 'ack', 'load 2', 'save', 'ok!', 'retry?', 'x-y', '(maybe)', 'done.']
const textArb = fc.array(fc.constantFrom(...WORDS), { minLength: 1, maxLength: 3 }).map(words => words.join(' '))
const idArb = fc.constantFrom(...IDS)
const messageArb: fc.Arbitrary<Message> = fc.record({ from: idArb, arrow: fc.constantFrom(...(Object.keys(ARROWS) as Arrow[])), to: idArb, text: textArb })
const messageStatementArb: fc.Arbitrary<Statement> = messageArb.map(message => ({ kind: 'message' as const, message }))

function statementArb(depth: number): fc.Arbitrary<Statement> {
  const leaves = [
    { weight: 4, arbitrary: messageStatementArb },
    {
      weight: 1,
      arbitrary: fc.oneof(
        {
          weight: 3,
          arbitrary: fc.record(
            { kind: fc.constant('declare' as const), keyword: fc.constantFrom('participant' as const, 'actor' as const), id: idArb, alias: textArb },
            { requiredKeys: ['kind', 'keyword', 'id'] },
          ),
        },
        {
          // `@{…}` metadata, with no `as`, an `as` text, or an `as` that
          // repeats the id, which a metadata alias overrides (BUG-14).
          weight: 1,
          arbitrary: fc.record({
            keyword: fc.constantFrom('participant' as const, 'actor' as const),
            id: idArb,
            as: fc.constantFrom('none', 'text', 'id'),
            text: textArb,
            metadata: fc.record({ type: fc.constantFrom('participant', 'database', 'queue'), alias: textArb }, { requiredKeys: [] }),
          }).map(({ keyword, id, as, text, metadata }) => ({
            kind: 'declare' as const, keyword, id, metadata, ...(as === 'none' ? {} : { alias: as === 'id' ? id : text }),
          })),
        },
        {
          // An actor-menu link; a later naming declaration resets it
          // upstream, and ours keeps it (BUG-16).
          weight: 1,
          arbitrary: fc.record({ kind: fc.constant('link' as const), id: idArb, label: fc.constantFrom('Dash', 'Home page'), href: fc.constantFrom('https://a.example/x', 'https://b.example/') }),
        },
      ),
    },
    {
      weight: 1,
      arbitrary: fc.oneof(
        fc.record({ kind: fc.constant('note' as const), placement: fc.constantFrom('left of' as const, 'right of' as const), ids: idArb.map(id => [id]), text: textArb }),
        fc.record({ kind: fc.constant('note' as const), placement: fc.constant('over' as const), ids: fc.uniqueArray(idArb, { minLength: 1, maxLength: 2 }), text: textArb }),
      ),
    },
  ]
  return depth === 0 ? fc.oneof(...leaves) : fc.oneof(...leaves, { weight: 2, arbitrary: blockArb(depth - 1) })
}

function blockArb(depth: number): fc.Arbitrary<Statement> {
  // Message-only branches keep typed fragments common; mixed branches make
  // the block preserved source.
  const branchArb = (label: fc.Arbitrary<string>) => fc.record({
    label,
    statements: fc.oneof(fc.array(messageStatementArb, { minLength: 1, maxLength: 3 }), fc.array(statementArb(depth), { minLength: 1, maxLength: 3 })),
  })
  return fc.oneof(
    fc.record({ kind: fc.constant('block' as const), keyword: fc.constantFrom('loop' as const, 'opt' as const, 'break' as const, 'rect' as const), label: textArb, branches: branchArb(fc.constant('')).map(branch => [branch]) }),
    fc.record({ kind: fc.constant('block' as const), keyword: fc.constantFrom('alt' as const, 'par' as const, 'critical' as const), label: textArb, branches: fc.array(branchArb(textArb), { minLength: 1, maxLength: 3 }) }),
  )
}

function printMessage(message: Message): string {
  return `${message.from}${message.arrow}${message.to}: ${message.text}`
}

function printStatements(statements: Statement[], indent: string, lines: string[]): void {
  for (const statement of statements) {
    if (statement.kind === 'declare') {
      const entries = Object.entries(statement.metadata ?? {}).map(([key, value]) => `"${key}": "${value}"`)
      const metadata = statement.metadata ? `@{ ${entries.join(', ')} }` : ''
      lines.push(`${indent}${statement.keyword} ${statement.id}${metadata}${statement.alias ? ` as ${statement.alias}` : ''}`)
    }
    else if (statement.kind === 'link') lines.push(`${indent}link ${statement.id}: ${statement.label} @ ${statement.href}`)
    else if (statement.kind === 'message') lines.push(`${indent}${printMessage(statement.message)}`)
    else if (statement.kind === 'note') lines.push(`${indent}note ${statement.placement} ${statement.ids.join(',')}: ${statement.text}`)
    else {
      statement.branches.forEach((branch, index) => {
        const opener = statement.keyword === 'rect' ? 'rect rgb(191, 223, 255)' : `${statement.keyword} ${statement.label}`
        lines.push(index === 0 ? `${indent}${opener}` : `${indent}${CONTINUATIONS[statement.keyword]} ${branch.label}`)
        printStatements(branch.statements, `${indent}  `, lines)
      })
      lines.push(`${indent}end`)
    }
  }
}

function printSequence(statements: Statement[]): string {
  const lines = ['sequenceDiagram']
  printStatements(statements, '  ', lines)
  return lines.join('\n')
}

/** The typed model's rule: a loop / opt / alt / par block holding only
 * messages is a typed fragment; every other block is preserved source. */
function isTypedFragment(statement: Extract<Statement, { kind: 'block' }>): boolean {
  return ['loop', 'opt', 'alt', 'par'].includes(statement.keyword)
    && statement.branches.every(branch => branch.statements.every(inner => inner.kind === 'message'))
}

/** Every generated message in source order, or only those our model types. */
function generatedMessages(statements: Statement[], scope: 'all' | 'typed'): Message[] {
  return statements.flatMap(statement => {
    if (statement.kind === 'message') return [statement.message]
    if (statement.kind !== 'block' || (scope === 'typed' && !isTypedFragment(statement))) return []
    return statement.branches.flatMap(branch => generatedMessages(branch.statements, scope))
  })
}

const generatedMessageKey = (message: Message) => `${message.from} ${message.to} ${ARROWS[message.arrow]} : ${message.text}`

/** Every generated link, per participant, merged in source order. Ours keeps
 * them all; upstream drops those a later naming declaration follows (BUG-16),
 * so links are where the two readings differ by design. */
function generatedLinks(statements: Statement[], links = new Map<string, Record<string, string>>()): Map<string, Record<string, string>> {
  for (const statement of statements) {
    if (statement.kind === 'link') links.set(statement.id, { ...links.get(statement.id), [statement.label]: statement.href })
    else if (statement.kind === 'block') for (const branch of statement.branches) generatedLinks(branch.statements, links)
  }
  return links
}

const programArb = fc.array(statementArb(2), { minLength: 1, maxLength: 8 })
const sourceArb = programArb.map(printSequence)

// ---------------------------------------------------------------------------
// One comparable projection for both parsers
// ---------------------------------------------------------------------------

type Projection = { participants: string[]; links: string[]; messages: string[] }

const linksKey = (id: string, links: Record<string, string> | undefined) =>
  links && Object.keys(links).length > 0 ? [`${id} ${JSON.stringify(Object.entries(links).sort())}`] : []

/** The upstream links ours does not also read. Ours keeps an actor's links
 * through a naming declaration where upstream drops them (BUG-16), so every
 * link upstream reads, ours reads too, but not the other way round. */
function linksOursMisses(upstreamLinks: string[], oursLinks: string[]): string[] {
  const split = (key: string) => [key.slice(0, key.indexOf(' ')), JSON.parse(key.slice(key.indexOf(' ') + 1)) as Array<[string, string]>] as const
  const mine = new Map(oursLinks.map(key => { const [id, entries] = split(key); return [id, new Map(entries)] }))
  return upstreamLinks.filter(key => {
    const [id, entries] = split(key)
    return !entries.every(([label, href]) => mine.get(id)?.get(label) === href)
  })
}

const STYLE_TYPES: Record<SequenceMessage['style'], number> = { sync: 0, reply: 1, async: 5, 'async-dashed': 6, lost: 3, 'lost-dashed': 4 }

function messageKey(message: SequenceMessage): string {
  const type = message.arrow && message.arrow in ARROWS ? ARROWS[message.arrow as Arrow] : STYLE_TYPES[message.style]
  return `${message.from} ${message.to} ${type} : ${message.text}`
}

function ours(body: SequenceBody): Projection {
  const messages = body.statements.flatMap(statement =>
    statement.kind === 'message'
      ? [body.messages[statement.ref]!]
      : statement.kind === 'fragment'
        ? statement.fragment.branches.flatMap(branch => branch.messages)
        : [],
  )
  return {
    participants: body.participants.map(p => `${p.id} ${p.kind} : ${p.label}`),
    links: body.participants.flatMap(p => linksKey(p.id, p.links)),
    messages: messages.map(messageKey),
  }
}

function theirs(parsed: Extract<UpstreamParse, { ok: true }>): Projection {
  const db = parsed.sequence
  if (!db) throw new Error(`upstream diagram type ${parsed.type} exposes no sequence DB`)
  return {
    participants: db.actors.map(actor => `${actor.name} ${actor.type} : ${actor.description}`),
    links: db.actors.flatMap(actor => linksKey(actor.name, actor.links)),
    // Notes and block open/close markers share the list; keep real arrows.
    messages: db.messages.filter(message => UPSTREAM_ARROW_TYPES.has(message.type)).map(message => `${message.from} ${message.to} ${message.type} : ${message.message}`),
  }
}

function parseOurs(source: string): SequenceBody {
  const parsed = parseRegisteredMermaid(source)
  if (!parsed.ok) throw new Error(`our parser rejected:\n${source}\n${parsed.error.map(e => e.message).join('; ')}`)
  const sequence = asSequence(parsed.value)
  if (!sequence) throw new Error(`our parser did not produce a structured sequence (${parsed.value.body.kind}):\n${source}`)
  return sequence.body
}

// ---------------------------------------------------------------------------
// Properties
// ---------------------------------------------------------------------------

describe('sequence grammar differential against pinned upstream Mermaid', () => {
  let upstream: UpstreamMermaid
  beforeAll(() => {
    upstream = startUpstreamMermaid()
  })
  afterAll(() => upstream.close())

  test('the generator covers every construct it claims', () => {
    const sources = fc.sample(sourceArb, 200)
    const constructs: Record<string, RegExp> = {
      participant: /^ {2}participant \w+$/m,
      'participant alias': /^ {2}participant \w+ as /m,
      'metadata type and alias': /^ {2}(?:participant|actor) \w+@\{ "type": "\w+", "alias": /m,
      'metadata alias overridden by `as` the id (BUG-14)': /^ {2}(?:participant|actor) (\w+)@\{[^}\n]*"alias"[^}\n]*\} as \1$/m,
      actor: /^ {2}actor \w+/m,
      link: /^ {2}link \w+: \w[\w ]* @ https:/m,
      'bare declaration after first use': /^ +(\w+)-[^\n]*\n(?:[^\n]*\n)*? +(?:participant|actor) \1$/m,
      ...Object.fromEntries(Object.keys(ARROWS).map(arrow => [arrow, new RegExp(`\\w${arrow.replace(/[-)]/g, '\\$&')}\\w`)])),
      'note left/right': /^ {2}note (?:left|right) of /m,
      'note over two': /^ {2}note over \w+,\w+:/m,
      loop: /^ {2}loop /m,
      opt: /^ {2}opt /m,
      'alt/else': /^ {2}else /m,
      'par/and': /^ {2}and /m,
      'critical/option': /^ {2}option /m,
      break: /^ {2}break /m,
      rect: /^ {2}rect /m,
      'nested block': /^ {4}(?:loop|opt|alt|par|critical|break|rect) /m,
      'note in a block': /^ {4,}note /m,
      'declaration in a block': /^ {4,}(?:participant|actor) /m,
    }
    const missing = Object.entries(constructs).filter(([, pattern]) => !sources.some(source => pattern.test(source))).map(([name]) => name)
    expect(missing).toEqual([])
  })

  test('(i)–(v) upstream and our parser agree on every generated sequence diagram', async () => {
    await fc.assert(
      fc.asyncProperty(programArb, fc.nat(), textArb, async (program, pick, label) => {
        const source = printSequence(program)
        const upstreamParse = await upstream.parse(source)
        // (i) the generator only produces Mermaid 11.16 sequence diagrams.
        expect({ source, upstream: upstreamParse.ok ? 'accepted' : upstreamParse.error }).toEqual({ source, upstream: 'accepted' })
        if (!upstreamParse.ok) return
        // (ii) + (iii) upstream's participants, and upstream's messages minus
        // those inside preserved blocks.
        const upstreamProjection = theirs(upstreamParse)
        expect({ source, messages: generatedMessages(program, 'all').map(generatedMessageKey) }).toEqual({ source, messages: upstreamProjection.messages })
        const links = generatedLinks(program)
        const expected = {
          participants: upstreamProjection.participants,
          links: upstreamProjection.participants.flatMap(entry => { const id = entry.slice(0, entry.indexOf(' ')); return linksKey(id, links.get(id)) }),
          messages: generatedMessages(program, 'typed').map(generatedMessageKey),
        }
        expect({ source, linksOursMisses: linksOursMisses(upstreamProjection.links, expected.links) }).toEqual({ source, linksOursMisses: [] })
        expect({ source, ...ours(parseOurs(source)) }).toEqual({ source, ...expected })
        const parsed = parseRegisteredMermaid(source)
        if (!parsed.ok) return
        const count = countStructuralElements(parsed.value)
        expect({ source, nodes: count?.nodes, edges: count?.edges }).toEqual({ source, nodes: expected.participants.length, edges: expected.messages.length })
        // (iv) serialize → re-parse keeps the same diagram.
        const serialized = serializeMermaid(parsed.value)
        expect({ serialized, ...ours(parseOurs(serialized)) }).toEqual({ serialized, ...expected })
        // (v) relabelling one participant changes only its label.
        const index = pick % expected.participants.length
        const id = parseOurs(source).participants[index]!.id
        const relabelled = mutate(parsed.value, { kind: 'set_participant_label', id, label })
        if (!relabelled.ok) throw new Error(`set_participant_label ${id} failed on:\n${source}`)
        const output = serializeMermaid(relabelled.value)
        const participants = expected.participants.map((entry, at) => at === index ? `${entry.slice(0, entry.indexOf(' : '))} : ${label}` : entry)
        const upstreamRelabelled = await upstream.parse(output)
        const relabelledProjection = ({ participants, links }: Projection) => ({ participants, linksOursMisses: linksOursMisses(links, expected.links) })
        expect({ output, ours: ours(parseOurs(output)), upstream: upstreamRelabelled.ok ? relabelledProjection(theirs(upstreamRelabelled)) : upstreamRelabelled.error })
          .toEqual({ output, ours: expect.objectContaining({ participants, links: expected.links }), upstream: { participants, linksOursMisses: [] } })
      }),
      { numRuns: 100 },
    )
  }, 20_000)

  // BUG-13: an edit that adds a participant, or a message naming a new one,
  // must leave the body as its own serialization re-parses (for us and for
  // upstream): the typed body is the fold of its statements' events.
  const editArb = fc.oneof(
    fc.record({ kind: fc.constant('add_participant' as const), id: fc.constantFrom('New', ...IDS), label: fc.option(textArb, { nil: undefined }), participantKind: fc.constantFrom('participant' as const, 'actor' as const) }),
    fc.record({ kind: fc.constant('add_message' as const), from: fc.constantFrom('New', ...IDS), to: fc.constantFrom('New', ...IDS), text: textArb, index: fc.nat() }),
    fc.record({ kind: fc.constant('set_participant_label' as const), pick: fc.nat(), label: textArb }),
    fc.record({ kind: fc.constant('move_message' as const), from: fc.nat(), to: fc.nat() }),
    fc.record({ kind: fc.constant('remove_message' as const), index: fc.nat() }),
    fc.record({ kind: fc.constant('remove_participant' as const), pick: fc.nat() }),
  )
  test('BUG-13: examples — a new participant comes last; a message added ahead creates its participant there', async () => {
    const cases: Array<{ source: string; op: SequenceMutationOp; output: string; participants: string[]; links?: string[] }> = [
      {
        source: 'sequenceDiagram\n  A->>B: hi', op: { kind: 'add_participant', id: 'C' },
        output: 'sequenceDiagram\n  A->>B: hi\n  participant C\n', participants: ['A', 'B', 'C'],
      },
      {
        source: 'sequenceDiagram\n  A->>B: hi', op: { kind: 'add_message', from: 'C', to: 'A', text: 'first', index: 0 },
        output: 'sequenceDiagram\n  C->>A: first\n  A->>B: hi\n', participants: ['C', 'A', 'B'],
      },
      {
        // The relabel's declaration resets A's links, so they are written again.
        source: 'sequenceDiagram\n  link A: Dash @ https://x.com\n  A->>B: hi', op: { kind: 'set_participant_label', id: 'A', label: 'Al' },
        output: 'sequenceDiagram\n  link A: Dash @ https://x.com\n  participant A as Al\n  link A: Dash @ https://x.com\n  A->>B: hi\n',
        participants: ['A', 'B'], links: ['A [["Dash","https://x.com"]]'],
      },
      {
        // B existed only through the removed message.
        source: 'sequenceDiagram\n  A->>B: hi\n  A->>A: again', op: { kind: 'remove_message', index: 0 },
        output: 'sequenceDiagram\n  A->>A: again\n', participants: ['A'],
      },
    ]
    for (const { source, op, output, participants, links = [] } of cases) {
      const parsed = parseRegisteredMermaid(source)
      if (!parsed.ok) throw new Error(`our parser rejected:\n${source}`)
      const edited = mutate(parsed.value, op)
      if (!edited.ok) throw new Error(`${op.kind} failed on:\n${source}`)
      const typed = asSequence(edited.value)!.body
      const serialized = serializeMermaid(edited.value)
      const upstreamParse = await upstream.parse(serialized)
      expect({ op, serialized, typed: typed.participants.map(p => p.id), links: ours(typed).links, upstream: upstreamParse.ok && theirs(upstreamParse).participants.map(p => p.split(' ')[0]) })
        .toEqual({ op, serialized: output, typed: participants, links, upstream: participants })
    }
  })

  test('BUG-13: a typed edit leaves the body its serialization re-parses to, for us and upstream', async () => {
    await fc.assert(
      fc.asyncProperty(programArb, editArb, async (program, edit) => {
        const source = printSequence(program)
        const parsed = parseRegisteredMermaid(source)
        if (!parsed.ok) throw new Error(`our parser rejected:\n${source}`)
        const body = parseOurs(source)
        const pickParticipant = (pick: number) => body.participants[pick % body.participants.length]!.id
        const messageAt = (index: number) => index % Math.max(body.messages.length, 1)
        const op: SequenceMutationOp = edit.kind === 'add_message' ? { ...edit, index: edit.index % (body.messages.length + 1) }
          : edit.kind === 'set_participant_label' ? { kind: edit.kind, id: pickParticipant(edit.pick), label: edit.label }
            : edit.kind === 'move_message' ? { kind: edit.kind, from: messageAt(edit.from), to: messageAt(edit.to) }
              : edit.kind === 'remove_message' ? { kind: edit.kind, index: messageAt(edit.index) }
                : edit.kind === 'remove_participant' ? { kind: edit.kind, id: pickParticipant(edit.pick) }
                  : edit
        const edited = mutate(parsed.value, op)
        if (!edited.ok) return
        const typed = asSequence(edited.value)!.body
        const output = serializeMermaid(edited.value)
        const expected = { participants: ours(typed).participants, links: ours(typed).links }
        const reparsed = ours(parseOurs(output))
        const upstreamParse = await upstream.parse(output)
        expect({ op, output, ours: { participants: reparsed.participants, links: reparsed.links }, upstream: upstreamParse.ok ? { participants: theirs(upstreamParse).participants, linksOursMisses: linksOursMisses(theirs(upstreamParse).links, expected.links) } : upstreamParse.error })
          .toEqual({ op, output, ours: expected, upstream: { participants: expected.participants, linksOursMisses: [] } })
      }),
      { numRuns: 150 },
    )
  }, 30_000)

  test('a participant only a note names is typed and ordered as upstream creates it', async () => {
    const cases = [
      { source: 'sequenceDiagram\n  note left of A: hello', participants: ['A participant : A'] },
      {
        source: 'sequenceDiagram\n  B->>C: hi\n  note over D,A: x\n  participant A as Alice',
        participants: ['B participant : B', 'C participant : C', 'D participant : D', 'A participant : Alice'],
      },
    ]
    for (const { source, participants } of cases) {
      const upstreamParse = await upstream.parse(source)
      expect({ source, participants: upstreamParse.ok && theirs(upstreamParse).participants }).toEqual({ source, participants })
      expect({ source, participants: ours(parseOurs(source)).participants }).toEqual({ source, participants })
      const parsed = parseRegisteredMermaid(source)
      if (!parsed.ok) throw new Error(`our parser rejected:\n${source}`)
      expect(countStructuralElements(parsed.value)?.nodes).toBe(participants.length)
      expect(serializeMermaid(parsed.value)).toBe(`${source}\n`)
    }
    const parsed = parseRegisteredMermaid(cases[0]!.source)
    if (!parsed.ok) throw new Error('note-only source rejected')
    expect(describeMermaidFacts(parsed.value)).toContain('participant A : A')
    // The note stays preserved source, so typed ops treat A as a known participant.
    const added = mutate(parsed.value, { kind: 'add_message', from: 'A', to: 'B', text: 'ping' })
    expect(added.ok && serializeMermaid(added.value)).toBe('sequenceDiagram\n  note left of A: hello\n  A->>B: ping\n')
    expect(added.ok && ours(parseOurs(serializeMermaid(added.value))).participants).toEqual(['A participant : A', 'B participant : B'])
    const duplicate = mutate(parsed.value, { kind: 'add_participant', id: 'A' })
    expect(!duplicate.ok && (duplicate.error as { code: string }).code).toBe('DUPLICATE_PARTICIPANT')
  })

  test('a metadata type or alias survives serialize and a relabel, as upstream reads them', async () => {
    const cases = [
      // `actor` with a metadata type other than its own is written with that type.
      { source: 'sequenceDiagram\n  actor A@{ "type": "participant" }\n  A->>A: hello', id: 'A' },
      // A metadata alias in a preserved block names A: a relabel declares after it.
      { source: 'sequenceDiagram\n  A->>A: hello\n  alt hello\n    loop hello\n      participant A@{ "alias": "hello" }\n    end\n    A->>A: hello\n  end', id: 'A' },
    ]
    for (const { source, id } of cases) {
      const parsed = parseRegisteredMermaid(source)
      if (!parsed.ok) throw new Error(`our parser rejected:\n${source}`)
      const upstreamParse = await upstream.parse(source)
      const expected = upstreamParse.ok ? theirs(upstreamParse).participants : [upstreamParse.error]
      const serialized = serializeMermaid(parsed.value)
      expect({ serialized, ours: ours(parseOurs(serialized)).participants }).toEqual({ serialized, ours: expected })
      const relabelled = mutate(parsed.value, { kind: 'set_participant_label', id, label: 'done.' })
      if (!relabelled.ok) throw new Error(`set_participant_label ${id} failed on:\n${source}`)
      const output = serializeMermaid(relabelled.value)
      const upstreamRelabelled = await upstream.parse(output)
      expect({ output, ours: ours(parseOurs(output)).participants, upstream: upstreamRelabelled.ok ? theirs(upstreamRelabelled).participants : upstreamRelabelled.error })
        .toEqual({ output, ours: [`${id} participant : done.`], upstream: [`${id} participant : done.`] })
    }
  })

  test('BUG-7: a later declaration changes a known participant only when it names it', async () => {
    const cases = [
      // Upstream ignores a bare re-declaration, whatever keyword or metadata
      // type it carries; ours keeps the inert line verbatim.
      { source: 'sequenceDiagram\n  note left of Carol: hi\n  actor Carol', participants: ['Carol participant : Carol'], verbatim: true },
      { source: 'sequenceDiagram\n  A->>B: hi\n  actor B', participants: ['A participant : A', 'B participant : B'], verbatim: true },
      { source: 'sequenceDiagram\n  actor B\n  A->>B: hi\n  participant B', participants: ['B actor : B', 'A participant : A'], verbatim: true },
      { source: 'sequenceDiagram\n  participant B as Bob\n  participant B', participants: ['B participant : Bob'], verbatim: true },
      { source: 'sequenceDiagram\n  A->>B: hi\n  participant B@{ "type": "database" }', participants: ['A participant : A', 'B participant : B'], verbatim: true },
      // A naming declaration replaces label and type, even when it names the id.
      { source: 'sequenceDiagram\n  A->>B: hi\n  actor B as B', participants: ['A participant : A', 'B actor : B'], verbatim: true },
      { source: 'sequenceDiagram\n  participant B as X\n  participant B as B', participants: ['B participant : B'], verbatim: false },
    ]
    for (const { source, participants, verbatim } of cases) {
      const upstreamParse = await upstream.parse(source)
      expect({ source, upstream: upstreamParse.ok && theirs(upstreamParse).participants }).toEqual({ source, upstream: participants })
      expect({ source, ours: ours(parseOurs(source)).participants, renderer: rendered(source) }).toEqual({ source, ours: participants, renderer: participants })
      const parsed = parseRegisteredMermaid(source)
      if (!parsed.ok) throw new Error(`our parser rejected:\n${source}`)
      const serialized = serializeMermaid(parsed.value)
      if (verbatim) expect(serialized).toBe(`${source}\n`)
      expect({ serialized, ours: ours(parseOurs(serialized)).participants }).toEqual({ serialized, ours: participants })
    }
  })

  // BUG-12: upstream's grammar hands `activate`/`deactivate` an actor id but
  // never calls `addActor` for it; only messages, notes, declarations and
  // links create participants (sequence/participants.ts).
  test('BUG-12: activate and deactivate create no participant, in the renderer and the typed body', async () => {
    const cases = [
      { source: 'sequenceDiagram\n  activate Z\n  A->>Z: hi\n  deactivate Z', ids: ['A', 'Z'] },
      { source: 'sequenceDiagram\n  rect rgb(1, 2, 3)\n    activate Z\n    A->>Z: hi\n    deactivate Z\n  end', ids: ['A', 'Z'] },
      { source: 'sequenceDiagram\n  A->>B: hi\n  activate C\n  note over D: n\n  C->>A: x\n  deactivate C', ids: ['A', 'B', 'D', 'C'] },
    ].map(({ source, ids }) => ({ source, participants: ids.map(id => `${id} participant : ${id}`) }))
    for (const { source, participants } of cases) {
      const upstreamParse = await upstream.parse(source)
      expect({ source, upstream: upstreamParse.ok && theirs(upstreamParse).participants }).toEqual({ source, upstream: participants })
      expect({ source, renderer: rendered(source), ours: ours(parseOurs(source)).participants }).toEqual({ source, renderer: participants, ours: participants })
    }
  })

  // BUG-15: `properties` and `details` hand their actor to `addActor` before
  // reading the text, as `link`/`links` do.
  test('BUG-15: properties and details lines create their participant', async () => {
    const properties = [
      { source: 'sequenceDiagram\n  properties P: {"class": "x"}\n  A->>P: hi', ids: ['P', 'A'] },
      { source: 'sequenceDiagram\n  A->>B: hi\n  loop l\n    properties C: {}\n  end\n  D->>C: x', ids: ['A', 'B', 'C', 'D'] },
    ]
    // Upstream's `addDetails` reads the page (document.getElementById), which
    // this harness lacks; this is pinned Mermaid 11.16's actor list for the
    // source with a document whose lookup finds nothing, as in a browser.
    const details = [{ source: 'sequenceDiagram\n  details D: foo\n  A->>D: hi', ids: ['D', 'A'] }]
    for (const { source, ids } of [...properties, ...details]) {
      const participants = ids.map(id => `${id} participant : ${id}`)
      if (properties.some(entry => entry.source === source)) {
        const upstreamParse = await upstream.parse(source)
        expect({ source, upstream: upstreamParse.ok && theirs(upstreamParse).participants }).toEqual({ source, upstream: participants })
      }
      expect({ source, renderer: rendered(source), ours: ours(parseOurs(source)).participants }).toEqual({ source, renderer: participants, ours: participants })
      const parsed = parseRegisteredMermaid(source)
      if (!parsed.ok) throw new Error(`our parser rejected:\n${source}`)
      expect(serializeMermaid(parsed.value)).toBe(`${source}\n`)
    }
  })

  // BUG-16: upstream's `addActor` replaces the record of an actor a naming
  // declaration describes, so `participant A as Al` drops A's links. That
  // quirk loses what the author wrote, so ours keeps them, naming or bare.
  test('BUG-16: a re-declaration keeps the links, naming or bare', () => {
    const cases: Array<{ source: string; id: string; links: Record<string, string> }> = [
      { source: 'sequenceDiagram\n  link A: Dash @ https://x.com\n  participant A as Al\n  A->>B: hi', id: 'A', links: { Dash: 'https://x.com' } },
      { source: 'sequenceDiagram\n  links A: {"x": "https://a.b"}\n  actor A as Al\n  link A: Y @ https://y.c', id: 'A', links: { x: 'https://a.b', Y: 'https://y.c' } },
      { source: 'sequenceDiagram\n  link A: Dash @ https://x.com\n  participant A\n  A->>B: hi', id: 'A', links: { Dash: 'https://x.com' } },
      { source: 'sequenceDiagram\n  A->>B: hi\n  link B: Dash @ https://x.com\n  rect rgb(1, 2, 3)\n    participant B as Bee\n  end', id: 'B', links: { Dash: 'https://x.com' } },
    ]
    for (const { source, id, links } of cases) {
      const rendererLinks = parseSequenceDiagram(source.split('\n')).actors.find(actor => actor.id === id)?.links ?? {}
      const typedLinks = parseOurs(source).participants.find(participant => participant.id === id)?.links ?? {}
      const parsed = parseRegisteredMermaid(source)
      if (!parsed.ok) throw new Error(`our parser rejected:\n${source}`)
      const roundTrip = parseOurs(serializeMermaid(parsed.value)).participants.find(participant => participant.id === id)?.links ?? {}
      expect({ source, rendererLinks, typedLinks, roundTrip })
        .toEqual({ source, rendererLinks: links, typedLinks: links, roundTrip: links })
    }
  })

  // BUG-44: a `#` starts a comment, so `A->>B: #a#` is a message with empty
  // text upstream, as `A->>B:` and `Note over A:` are; ours dropped the
  // statement and rendered an empty 0×0 SVG.
  test('BUG-44: a message or note with empty text is a statement, and `#` starts a comment in it', async () => {
    const cases = [
      { source: 'sequenceDiagram\n  A->>B: #a#', ids: ['A', 'B'], messages: ['A B 0 : '] },
      { source: 'sequenceDiagram\n  A->>B:', ids: ['A', 'B'], messages: ['A B 0 : '] },
      { source: 'sequenceDiagram\n  A->>B: hello # world', ids: ['A', 'B'], messages: ['A B 0 : hello'] },
      { source: 'sequenceDiagram\n  Note over C:\n  C-->>D: x', ids: ['C', 'D'], messages: ['C D 1 : x'] },
    ]
    for (const { source, ids, messages } of cases) {
      const participants = ids.map(id => `${id} participant : ${id}`)
      const upstreamParse = await upstream.parse(source)
      expect({ source, upstream: upstreamParse.ok && { participants: theirs(upstreamParse).participants, messages: theirs(upstreamParse).messages } })
        .toEqual({ source, upstream: { participants, messages } })
      const { participants: typed, messages: typedMessages } = ours(parseOurs(source))
      expect({ source, renderer: rendered(source), typed, typedMessages }).toEqual({ source, renderer: participants, typed: participants, typedMessages: messages })
      expect(renderMermaidSVG(source)).not.toContain('viewBox="0 0 0 0"')
    }
    expect(parseSequenceDiagram('sequenceDiagram\n  Note over C:'.split('\n')).notes.map(note => note.text)).toEqual([''])
  })

  test('participants that only preserved blocks create are typed in upstream order, blocks kept verbatim', async () => {
    const cases = [
      { source: 'sequenceDiagram\n  A->>B: hi\n  rect rgb(200, 200, 200)\n    C->>D: x\n  end\n  E->>A: y', ids: ['A', 'B', 'C', 'D', 'E'] },
      { source: 'sequenceDiagram\n  critical c\n    X->>Y: a\n  option o\n    Z->>X: b\n  end', ids: ['X', 'Y', 'Z'] },
      { source: 'sequenceDiagram\n  break b\n    P->>Q: a\n  end', ids: ['P', 'Q'] },
      { source: 'sequenceDiagram\n  loop l\n    note over N,M: hi\n    K->>L: a\n  end', ids: ['N', 'M', 'K', 'L'] },
      { source: 'sequenceDiagram\n  par p\n    loop l\n      R->>S: a\n    end\n  and q\n    note left of T: t\n  end', ids: ['R', 'S', 'T'] },
    ].map(({ source, ids }) => ({ source, participants: ids.map(id => `${id} participant : ${id}`) }))
    cases.push(
      { source: 'sequenceDiagram\n  A->>B: hi\n  rect rgb(1, 2, 3)\n    actor C\n    participant B as Bee\n    actor A\n  end', participants: ['A participant : A', 'B participant : Bee', 'C actor : C'] },
      { source: 'sequenceDiagram\n  rect rgb(1, 2, 3)\n    create participant W as Wx\n    A->>W: hi\n  end', participants: ['W participant : Wx', 'A participant : A'] },
    )
    for (const { source, participants } of cases) {
      const upstreamParse = await upstream.parse(source)
      expect({ source, upstream: upstreamParse.ok && theirs(upstreamParse).participants }).toEqual({ source, upstream: participants })
      expect({ source, ours: ours(parseOurs(source)).participants, renderer: rendered(source) }).toEqual({ source, ours: participants, renderer: participants })
      const parsed = parseRegisteredMermaid(source)
      if (!parsed.ok) throw new Error(`our parser rejected:\n${source}`)
      expect(countStructuralElements(parsed.value)?.nodes).toBe(participants.length)
      expect(serializeMermaid(parsed.value)).toBe(`${source}\n`)
    }
    // Upstream's box parsing needs a DOM this harness lacks; this is pinned
    // Mermaid 11.16's actor list for the source.
    const boxed = 'sequenceDiagram\n  V->>U: hi\n  box Grp\n    actor U as You\n    participant W\n  end'
    const boxedParticipants = ['V participant : V', 'U actor : You', 'W participant : W']
    expect({ ours: ours(parseOurs(boxed)).participants, renderer: rendered(boxed) }).toEqual({ ours: boxedParticipants, renderer: boxedParticipants })
    // Typed ops see them as known, and a preserved block that would re-create
    // one blocks its removal.
    const parsed = parseRegisteredMermaid(cases[0]!.source)
    if (!parsed.ok) throw new Error('rect source rejected')
    const duplicate = mutate(parsed.value, { kind: 'add_participant', id: 'C' })
    expect(!duplicate.ok && (duplicate.error as { code: string }).code).toBe('DUPLICATE_PARTICIPANT')
    const removed = mutate(parsed.value, { kind: 'remove_participant', id: 'D' })
    expect(!removed.ok && (removed.error as { code: string }).code).toBe('INVALID_OP')
  })

  test('relabelling a participant no declaration names keeps the participant order', async () => {
    const cases = [
      { source: 'sequenceDiagram\n  participant A as Alice\n  A->>B: one\n  B-->>A: two', id: 'B', label: 'Bobby', participants: ['A participant : Alice', 'B participant : Bobby'] },
      { source: 'sequenceDiagram\n  A->>B: hi', id: 'B', label: 'Bobby', participants: ['A participant : A', 'B participant : Bobby'] },
      { source: 'sequenceDiagram\n  A->>B: hi\n  note left of C: x\n  C->>A: y', id: 'C', label: 'Cee', participants: ['A participant : A', 'B participant : B', 'C participant : Cee'] },
      { source: 'sequenceDiagram\n  create participant W\n  A->>W: hi', id: 'W', label: 'Wx', participants: ['W participant : Wx', 'A participant : A'] },
      { source: 'sequenceDiagram\n  rect rgb(1, 2, 3)\n    actor U\n    U->>V: x\n  end', id: 'U', label: 'You', participants: ['U actor : You', 'V participant : V'] },
      // Relabelling back to the id must still name it after its first mention.
      { source: 'sequenceDiagram\n  rect rgb(1, 2, 3)\n    participant B as Bee\n  end\n  A->>B: hi', id: 'B', label: 'B', participants: ['B participant : B', 'A participant : A'] },
    ]
    for (const { source, id, label, participants } of cases) {
      const parsed = parseRegisteredMermaid(source)
      if (!parsed.ok) throw new Error(`our parser rejected:\n${source}`)
      const relabelled = mutate(parsed.value, { kind: 'set_participant_label', id, label })
      if (!relabelled.ok) throw new Error(`set_participant_label ${id} failed on:\n${source}`)
      const output = serializeMermaid(relabelled.value)
      const upstreamParse = await upstream.parse(output)
      expect({ output, ours: ours(parseOurs(output)).participants, upstream: upstreamParse.ok ? theirs(upstreamParse).participants : upstreamParse.error })
        .toEqual({ output, ours: participants, upstream: participants })
    }
  })
})

function rendered(source: string): string[] {
  return parseSequenceDiagram(source.split('\n')).actors.map(actor => `${actor.id} ${actor.type} : ${actor.label}`)
}
