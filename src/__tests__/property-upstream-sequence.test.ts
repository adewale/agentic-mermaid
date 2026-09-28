// Grammar-based differential test for sequence diagrams against the pinned
// upstream Mermaid (11.16.0), the companion of property-upstream-flowchart.
//
//   (i)   upstream accepts every generated source — validates the generator;
//   (ii)  parseRegisteredMermaid accepts it as a structured sequence diagram;
//   (iii) participants (id, label, participant/actor) and every message
//         (endpoints, arrow, text, in source order, fragments included) agree
//         with upstream's sequence DB, and the faithfulness counter reports
//         upstream's participant and message counts;
//   (iv)  parse → serialize → re-parse preserves all of the above.
//
// Fragments are generated one level deep: our typed model covers loop / alt /
// opt / par with message branches, and preserves deeper nesting (like notes)
// as lossless opaque segments by design, so nested fragments have no typed
// messages to compare.

import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import fc from 'fast-check'
import { asSequence, describeMermaidFacts, mutate, parseRegisteredMermaid, serializeMermaid } from '../agent/index.ts'
import { countStructuralElements } from '../agent/structural-count.ts'
import type { SequenceBody, SequenceMessage } from '../agent/types.ts'
import { startUpstreamMermaid, type UpstreamMermaid, type UpstreamParse } from './helpers/upstream-mermaid.ts'

// ---------------------------------------------------------------------------
// The grammar
// ---------------------------------------------------------------------------

// Our arrow spelling → upstream LINETYPE (mermaid sequenceDb).
const ARROWS = { '->>': 0, '-->>': 1, '->': 5, '-->': 6, '-x': 3, '--x': 4, '-)': 24, '--)': 25 } as const
type Arrow = keyof typeof ARROWS
const UPSTREAM_ARROW_TYPES = new Set<number>(Object.values(ARROWS))

type Message = { from: string; arrow: Arrow; to: string; text: string }
type Statement =
  | { kind: 'declare'; keyword: 'participant' | 'actor'; id: string; alias?: string }
  | { kind: 'message'; message: Message }
  | { kind: 'note'; placement: 'left of' | 'right of' | 'over'; ids: string[]; text: string }
  | { kind: 'fragment'; keyword: 'loop' | 'opt' | 'alt' | 'par'; label: string; branches: Array<{ label: string; messages: Message[] }> }

const IDS = ['A', 'B', 'Carol', 'd1', 'E_x']
const WORDS = ['hello', 'Ping', 'ack', 'load 2', 'save', 'ok!', 'retry?', 'x-y', '(maybe)', 'done.']
const textArb = fc.array(fc.constantFrom(...WORDS), { minLength: 1, maxLength: 3 }).map(words => words.join(' '))
const idArb = fc.constantFrom(...IDS)
const messageArb: fc.Arbitrary<Message> = fc.record({ from: idArb, arrow: fc.constantFrom(...(Object.keys(ARROWS) as Arrow[])), to: idArb, text: textArb })
const branchArb = (label: fc.Arbitrary<string>) => fc.record({ label, messages: fc.array(messageArb, { minLength: 1, maxLength: 3 }) })

const statementArb: fc.Arbitrary<Statement> = fc.oneof(
  { weight: 4, arbitrary: messageArb.map(message => ({ kind: 'message' as const, message })) },
  {
    weight: 1,
    arbitrary: fc.record(
      { kind: fc.constant('declare' as const), keyword: fc.constantFrom('participant' as const, 'actor' as const), id: idArb, alias: textArb },
      { requiredKeys: ['kind', 'keyword', 'id'] },
    ),
  },
  {
    weight: 1,
    arbitrary: fc.oneof(
      fc.record({ kind: fc.constant('note' as const), placement: fc.constantFrom('left of' as const, 'right of' as const), ids: idArb.map(id => [id]), text: textArb }),
      fc.record({ kind: fc.constant('note' as const), placement: fc.constant('over' as const), ids: fc.uniqueArray(idArb, { minLength: 1, maxLength: 2 }), text: textArb }),
    ),
  },
  {
    weight: 2,
    arbitrary: fc.oneof(
      fc.record({ kind: fc.constant('fragment' as const), keyword: fc.constantFrom('loop' as const, 'opt' as const), label: textArb, branches: branchArb(fc.constant('')).map(branch => [branch]) }),
      fc.record({ kind: fc.constant('fragment' as const), keyword: fc.constantFrom('alt' as const, 'par' as const), label: textArb, branches: fc.array(branchArb(textArb), { minLength: 1, maxLength: 3 }) }),
    ),
  },
)

/** Participants are declared at most once and only before any use. */
function declareBeforeUse(statements: Statement[]): Statement[] {
  const seen = new Set<string>()
  const mention = (ids: string[]) => ids.forEach(id => seen.add(id))
  return statements.flatMap((statement): Statement[] => {
    if (statement.kind === 'declare') {
      if (seen.has(statement.id)) return []
      seen.add(statement.id)
      return [statement]
    }
    if (statement.kind === 'note') mention(statement.ids)
    else if (statement.kind === 'message') mention([statement.message.from, statement.message.to])
    else for (const branch of statement.branches) for (const message of branch.messages) mention([message.from, message.to])
    return [statement]
  })
}

function printMessage(message: Message): string {
  return `${message.from}${message.arrow}${message.to}: ${message.text}`
}

function printSequence(statements: Statement[]): string {
  const lines = ['sequenceDiagram']
  for (const statement of statements) {
    if (statement.kind === 'declare') lines.push(`  ${statement.keyword} ${statement.id}${statement.alias ? ` as ${statement.alias}` : ''}`)
    else if (statement.kind === 'message') lines.push(`  ${printMessage(statement.message)}`)
    else if (statement.kind === 'note') lines.push(`  note ${statement.placement} ${statement.ids.join(',')}: ${statement.text}`)
    else {
      const separator = statement.keyword === 'alt' ? 'else' : 'and'
      statement.branches.forEach((branch, index) => {
        lines.push(index === 0 ? `  ${statement.keyword} ${statement.label}` : `  ${separator} ${branch.label}`)
        for (const message of branch.messages) lines.push(`    ${printMessage(message)}`)
      })
      lines.push('  end')
    }
  }
  return lines.join('\n')
}

const sourceArb = fc.array(statementArb, { minLength: 1, maxLength: 8 }).map(declareBeforeUse).filter(list => list.length > 0).map(printSequence)

// ---------------------------------------------------------------------------
// One comparable projection for both parsers
// ---------------------------------------------------------------------------

type Projection = { participants: string[]; messages: string[] }

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
    messages: messages.map(messageKey),
  }
}

function theirs(parsed: Extract<UpstreamParse, { ok: true }>): Projection {
  const db = parsed.sequence
  if (!db) throw new Error(`upstream diagram type ${parsed.type} exposes no sequence DB`)
  return {
    participants: db.actors.map(actor => `${actor.name} ${actor.type} : ${actor.description}`),
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
    const sources = fc.sample(sourceArb, 200).join('\n')
    const constructs: Record<string, RegExp> = {
      participant: /^ {2}participant \w+$/m,
      'participant alias': /^ {2}participant \w+ as /m,
      actor: /^ {2}actor \w+/m,
      ...Object.fromEntries(Object.keys(ARROWS).map(arrow => [arrow, new RegExp(`\\w${arrow.replace(/[-)]/g, '\\$&')}\\w`)])),
      'note left/right': /^ {2}note (?:left|right) of /m,
      'note over two': /^ {2}note over \w+,\w+:/m,
      loop: /^ {2}loop /m,
      opt: /^ {2}opt /m,
      'alt/else': /^ {2}else /m,
      'par/and': /^ {2}and /m,
    }
    const missing = Object.entries(constructs).filter(([, pattern]) => !pattern.test(sources)).map(([name]) => name)
    expect(missing).toEqual([])
  })

  test('(i)–(iv) upstream and our parser agree on every generated sequence diagram', async () => {
    await fc.assert(
      fc.asyncProperty(sourceArb, async source => {
        const upstreamParse = await upstream.parse(source)
        // (i) the generator only produces Mermaid 11.16 sequence diagrams.
        expect({ source, upstream: upstreamParse.ok ? 'accepted' : upstreamParse.error }).toEqual({ source, upstream: 'accepted' })
        if (!upstreamParse.ok) return
        // (ii) + (iii) same participants and messages as upstream's DB.
        const expected = theirs(upstreamParse)
        expect({ source, ...ours(parseOurs(source)) }).toEqual({ source, ...expected })
        const parsed = parseRegisteredMermaid(source)
        if (!parsed.ok) return
        const count = countStructuralElements(parsed.value)
        expect({ source, nodes: count?.nodes, edges: count?.edges }).toEqual({ source, nodes: expected.participants.length, edges: expected.messages.length })
        // (iv) serialize → re-parse keeps the same diagram.
        const serialized = serializeMermaid(parsed.value)
        expect({ serialized, ...ours(parseOurs(serialized)) }).toEqual({ serialized, ...expected })
      }),
      { numRuns: 100 },
    )
  }, 20_000)

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
})
