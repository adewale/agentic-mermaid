/**
 * Sequence op-menu widening — family-elevation-plan §Sequence item 6, journey
 * conventions from PR #141: validated indices, prescriptive errors, and every
 * succeeding op must survive serialize → re-parse.
 *
 * New ops under test:
 *   - add_message gains optional `index` (top-level insert position)
 *   - move_message { from, to } (top-level indices)
 *   - set_participant_label { id, label }
 *   - add_note / remove_note / set_note_text / move_note (top-level notes)
 */
import { afterAll, beforeAll, describe, test, expect } from 'bun:test'
import { parseRegisteredMermaid as parseMermaid } from '../agent/parse.ts'
import { serializeMermaid } from '../agent/serialize.ts'
import { mutate } from '../agent/mutate.ts'
import { asSequence } from '../agent/types.ts'
import type { SequenceValidDiagram, SequenceMutationOp } from '../agent/types.ts'
import { MUTATION_OPS_BY_FAMILY } from '../agent/mutation-ops.ts'
import { describeOps } from '../agent/op-schema.ts'
import { describeMermaidFacts } from '../agent/facts.ts'
import { startUpstreamMermaid } from './helpers/upstream-mermaid.ts'
import { projectEntityMarkers } from '../shared/mermaid-entity-display.ts'
import { mermaidEntityPrepass } from '../shared/mermaid-entities.ts'
import { verifyMermaid } from '../agent/verify.ts'
import { parseSequenceDiagram } from '../sequence/parser.ts'
import { renderMermaidASCII, renderMermaidSVG } from '../index.ts'

function sequence(src: string): SequenceValidDiagram {
  const r = parseMermaid(src)
  if (!r.ok) throw new Error('parse: ' + JSON.stringify(r.error))
  const s = asSequence(r.value)
  if (!s) throw new Error('not a structured sequence body')
  return s
}

function apply(d: SequenceValidDiagram, op: SequenceMutationOp): SequenceValidDiagram {
  const r = mutate(d, op)
  if (!r.ok) throw new Error(`${r.error.code}: ${r.error.message}`)
  return r.value
}

function messageTexts(d: SequenceValidDiagram): string[] {
  return d.body.messages.map(m => m.text)
}

const SRC = 'sequenceDiagram\n  participant A as Alice\n  A->>B: one\n  B-->>A: two\n  A->>B: three'

describe('Sequence text survives edits and source delimiters', () => {
  let upstream: ReturnType<typeof startUpstreamMermaid>
  beforeAll(() => { upstream = startUpstreamMermaid() })
  afterAll(async () => { await upstream.close() })

  test.each(['one; two', 'one # tail', '#quot;', '*x* y', '<b>x</b>', String.raw`x\ny`, '  padded  ', 'style:x#', 'classDef:x;', 'style:x#quot;'])
  ('message and alias mutation values round-trip: %j', async text => {
    const message = apply(sequence(SRC), { kind: 'set_message_text', index: 0, text })
    const written = serializeMermaid(message)
    expect(sequence(written).body.messages[0]!.text).toBe(text)
    expect(describeMermaidFacts(sequence(written))).toEqual(describeMermaidFacts(message))
    const upstreamMessage = await upstream.parse(written)
    expect(upstreamMessage.ok).toBe(true)
    if (!upstreamMessage.ok || !upstreamMessage.sequence) throw new Error('upstream rejected Sequence message')
    expect(projectEntityMarkers(upstreamMessage.sequence.messages[0]!.message)).toBe(text)
    const participant = apply(sequence(SRC), { kind: 'set_participant_label', id: 'A', label: text })
    const aliasSource = serializeMermaid(participant)
    expect(participant.body.participants[0]!.label).toBe(text.trim())
    expect(sequence(aliasSource).body.participants[0]!.label).toBe(text.trim())
    expect(await upstream.accepts(aliasSource)).toBe(true)
  })

  test('physical message line endings become canonical authored breaks at admission', async () => {
    const changed = apply(sequence(SRC), { kind: 'set_message_text', index: 0, text: 'one\r\ntwo\rthree\nfour' })
    expect(changed.body.messages[0]!.text).toBe('one<br/>two<br/>three<br/>four')
    const added = apply(changed, { kind: 'add_message', from: 'B', to: 'A', text: 'five\nsix' })
    expect(added.body.messages.at(-1)!.text).toBe('five<br/>six')
    const written = serializeMermaid(added)
    expect(messageTexts(sequence(written))).toEqual(messageTexts(added))
    expect(describeMermaidFacts(sequence(written))).toEqual(describeMermaidFacts(added))
    expect(await upstream.accepts(written)).toBe(true)
  })

  test('style-like participant IDs do not consume escaped message text', async () => {
    const parsed = sequence('sequenceDiagram\nparticipant style\nparticipant classDef\nstyle->>classDef: old')
    for (const text of ['', '#;', '  #;  ', 'style:x#', 'classDef:x;', ' style:x#']) {
      const edited = apply(parsed, { kind: 'set_message_text', index: 0, text })
      const written = serializeMermaid(edited)
      expect(mermaidEntityPrepass(written)).toBe(written)
      const upstreamResult = await upstream.parse(written)
      if (!upstreamResult.ok || !upstreamResult.sequence) throw new Error('upstream rejected style-like participants')
      expect(upstreamResult.sequence.actors.map(actor => actor.name)).toEqual(['style', 'classDef'])
      expect(projectEntityMarkers(upstreamResult.sequence.messages[0]!.message)).toBe(text)
      expect(sequence(written).body.messages[0]!.text).toBe(text)
    }
  })

  test('parsed entity text keeps authored formatting and preserved source parts', async () => {
    const source = 'sequenceDiagram\n  participant A as *x* #lt;b#gt;Y#lt;/b#gt;\n  A->>B: #42;literal#42; *styled* #92;n\n  Note over B: #lt;b#gt;note#lt;/b#gt;'
    const parsed = sequence(source)
    expect(parsed.body.participants[0]!.label).toBe('*x* <b>Y</b>')
    expect(parsed.body.messages[0]!.text).toBe(String.raw`*literal* *styled* \n`)
    const edited = apply(parsed, { kind: 'add_message', from: 'B', to: 'A', text: '#quot;' })
    const written = serializeMermaid(edited)
    expect(written).toContain('participant A as *x* #lt;b#gt;Y#lt;/b#gt;')
    expect(written).toContain('  Note over B: #lt;b#gt;note#lt;/b#gt;')
    expect(sequence(written).body.messages.map(message => message.text)).toEqual(edited.body.messages.map(message => message.text))
    expect(describeMermaidFacts(sequence(written))).toEqual(describeMermaidFacts(edited))
    expect(await upstream.accepts(written)).toBe(true)
  })

  test('fragment edits retain parsed captions and encode new branch/message values', async () => {
    const source = 'sequenceDiagram\nalt #42;literal#42;\nA->>B: #lt;b#gt;message#lt;/b#gt;\nelse *styled*\nB->>A: end\nend'
    let edited = apply(sequence(source), { kind: 'add_fragment_message', fragmentIndex: 0, branchIndex: 0, from: 'B', to: 'A', text: '#quot;\nline; two' })
    edited = apply(edited, { kind: 'set_fragment_branch_label', fragmentIndex: 0, branchIndex: 1, label: '#quot; # tail; end' })
    const written = serializeMermaid(edited)
    expect(written).toContain('alt #42;literal#42;')
    expect(written).toContain('A->>B: #lt;b#gt;message#lt;/b#gt;')
    expect(describeMermaidFacts(sequence(written))).toEqual(describeMermaidFacts(edited))
    expect(await upstream.accepts(written)).toBe(true)
  })

  test('overflow counts decoded literal tags and visible entities', () => {
    const literal = sequence('sequenceDiagram\nparticipant A as #lt;b#gt;X#lt;/b#gt;\nA->>B: #lt;b#gt;Y#lt;/b#gt;')
    const warnings = verifyMermaid(literal, { labelCharCap: 2 }).warnings.filter(warning => warning.code === 'LABEL_OVERFLOW')
    expect(warnings).toContainEqual({ code: 'LABEL_OVERFLOW', target: 'A', charCount: 8, limit: 2 })
    expect(warnings).toContainEqual({ code: 'LABEL_OVERFLOW', target: 'msg#0:A->B', charCount: 8, limit: 2 })
    const entity = sequence('sequenceDiagram\nparticipant A as #9829;\nA->>B: #9829;\nNote over A: #9829;')
    expect(verifyMermaid(entity, { labelCharCap: 2 }).warnings.filter(warning => warning.code === 'LABEL_OVERFLOW')).toEqual([])
  })

  test.each(['#lt;b#gt;X#lt;/b#gt;', '#42;x#42;', '#35;quot#59;'])
  ('identical value edits retain parsed literal intent: %s', payload => {
    const original = sequence(`sequenceDiagram\nparticipant A as ${payload}\nA->>B: ${payload}\nalt ${payload}\nA->>B: ${payload}\nelse ${payload}\nB->>A: end\nend`)
    const text = original.body.messages[0]!.text
    let edited = apply(original, { kind: 'set_participant_label', id: 'A', label: text })
    edited = apply(edited, { kind: 'set_message_text', index: 0, text })
    edited = apply(edited, { kind: 'set_fragment_label', index: 0, label: text })
    edited = apply(edited, { kind: 'set_fragment_branch_label', fragmentIndex: 0, branchIndex: 0, label: text })
    edited = apply(edited, { kind: 'set_fragment_branch_label', fragmentIndex: 0, branchIndex: 1, label: text })
    edited = apply(edited, { kind: 'set_fragment_message_text', fragmentIndex: 0, index: 0, text })
    const written = serializeMermaid(edited)
    expect(written).toContain(payload)
    expect(describeMermaidFacts(sequence(written))).toEqual(describeMermaidFacts(original))
    expect(renderMermaidASCII(written, { colorMode: 'none' })).toBe(renderMermaidASCII(serializeMermaid(original), { colorMode: 'none' }))
  })

  test.each([
    ['opener', 0, { kind: 'set_fragment_label', index: 0, label: 'changed' }],
    ['first branch', 0, { kind: 'set_fragment_branch_label', fragmentIndex: 0, branchIndex: 0, label: 'changed' }],
    ['continuation', 1, { kind: 'set_fragment_branch_label', fragmentIndex: 0, branchIndex: 1, label: 'changed' }],
  ] as const)('a matching %s label setter discards source made stale by a direct edit', (_context, branchIndex, op) => {
    for (const payload of ['old', '#lt;b#gt;old#lt;/b#gt;']) {
      const original = sequence(`sequenceDiagram\nalt ${payload}\nA->>B: first\nelse ${payload}\nB->>A: second\nend`)
      const statement = original.body.statements.find(statement => statement.kind === 'fragment')!
      const target = branchIndex === 0 ? statement.fragment : statement.fragment.branches[branchIndex]!
      target.label = 'changed'
      const edited = apply(original, op)
      const fragment = edited.body.statements.find(statement => statement.kind === 'fragment')!.fragment
      const changed = branchIndex === 0 ? fragment : fragment.branches[branchIndex]!
      expect(changed.label).toBe('changed')
      expect(changed.labelContent).toBeUndefined()
      expect(describeMermaidFacts(edited)).toContain(`fragment#0 branch#${branchIndex} : changed`)
      const written = serializeMermaid(edited)
      expect(written).toContain(`${branchIndex === 0 ? 'alt' : 'else'} changed`)
      expect(describeMermaidFacts(sequence(written))).toEqual(describeMermaidFacts(edited))
      const svgText = [...renderMermaidSVG(edited).matchAll(/<text\b[^>]*>([\s\S]*?)<\/text>/g)]
        .map(match => match[1]!.replace(/<[^>]+>/g, '')).join('\n')
      expect(svgText).toContain('[changed]')
      expect(renderMermaidASCII(edited, { colorMode: 'none' })).toContain('changed')
    }
  })

  test('a stale sidecar does not revive after a direct string edit', () => {
    const original = sequence('sequenceDiagram\nA->>B: #lt;b#gt;X#lt;/b#gt;')
    original.body.messages[0]!.text = 'changed directly'
    const edited = apply(original, { kind: 'set_message_text', index: 0, text: '<b>X</b>' })
    expect(edited.body.messages[0]!.textContent).toBeUndefined()
    expect(serializeMermaid(edited)).toContain('A->>B: <b>X</b>')
  })
})

// ============================================================================
// Message style ↔ Mermaid arrow ↔ drawn heads
// ============================================================================

// Mermaid 12.2.0's sequence arrows (sequenceDiagram.jison), the typed style
// each one is, and what it draws: shaft and the head at each end. A
// half-arrow's style records only its shaft, so its operator is a fact too.
const ARROW_CASES = [
  { arrow: '->>', style: 'sync', dashed: false, start: 'none', end: 'filled' },
  { arrow: '-->>', style: 'reply', dashed: true, start: 'none', end: 'filled' },
  { arrow: '->', style: 'line', dashed: false, start: 'none', end: 'none' },
  { arrow: '-->', style: 'line-dashed', dashed: true, start: 'none', end: 'none' },
  { arrow: '-)', style: 'async', dashed: false, start: 'none', end: 'open' },
  { arrow: '--)', style: 'async-dashed', dashed: true, start: 'none', end: 'open' },
  { arrow: '-x', style: 'lost', dashed: false, start: 'none', end: 'cross' },
  { arrow: '--x', style: 'lost-dashed', dashed: true, start: 'none', end: 'cross' },
  { arrow: '<<->>', style: 'bidirectional', dashed: false, start: 'filled', end: 'filled' },
  { arrow: '<<-->>', style: 'bidirectional-dashed', dashed: true, start: 'filled', end: 'filled' },
  { arrow: '-|\\', style: 'sync', dashed: false, start: 'none', end: 'half-top', half: true },
  { arrow: '--|/', style: 'reply', dashed: true, start: 'none', end: 'half-bottom', half: true },
  { arrow: '--\\\\', style: 'reply', dashed: true, start: 'none', end: 'stick-top', half: true },
  { arrow: '-//', style: 'sync', dashed: false, start: 'none', end: 'stick-bottom', half: true },
  { arrow: '/|--', style: 'reply', dashed: true, start: 'half-bottom', end: 'none', half: true },
  { arrow: '\\\\-', style: 'sync', dashed: false, start: 'stick-top', end: 'none', half: true },
] as const
const STYLE_CASES = ARROW_CASES.filter(c => !('half' in c))

/** Shaft and heads of every drawn message, in message order. */
function drawnMessages(svg: string): string[] {
  return [...svg.matchAll(/<g class="message"[^>]*data-line-style="(\w+)" data-start-head="([\w-]+)" data-end-head="([\w-]+)"/g)]
    .map(([, line, start, end]) => `${line} ${start} ${end}`)
}
const drawn = (c: (typeof ARROW_CASES)[number]) => `${c.dashed ? 'dashed' : 'solid'} ${c.start} ${c.end}`
const arrowFacts = (subject: string, c: (typeof ARROW_CASES)[number]) =>
  [...('half' in c ? [`${subject} arrow ${c.arrow}`] : []), ...(c.style === 'sync' ? [] : [`${subject} style ${c.style}`])]

describe('sequence message style names the arrow Mermaid reads and ours draws', () => {
  let upstream: ReturnType<typeof startUpstreamMermaid>
  beforeAll(() => { upstream = startUpstreamMermaid() })
  afterAll(async () => { await upstream.close() })

  test('every parsed arrow: typed style, facts, written arrow and drawn heads agree', () => {
    const lines = ARROW_CASES.map((c, i) => `A${c.arrow}B: m${i}`)
    for (const preserved of [false, true]) {
      // An activation is outside the typed fragment model, so this rect stays preserved source.
      const d = sequence(['sequenceDiagram', ...(preserved ? ['rect rgb(1, 2, 3)', ...lines, 'activate A', 'end'] : lines)].join('\n'))
      const facts = describeMermaidFacts(d)
      const subject = (i: number) => preserved ? `preserved-message#0.${i + 1}` : `message#${i}`
      ARROW_CASES.forEach((c, i) => {
        expect({ arrow: c.arrow, facts: facts.filter(f => f.startsWith(`${subject(i)} style `) || f.startsWith(`${subject(i)} arrow `)) })
          .toEqual({ arrow: c.arrow, facts: arrowFacts(subject(i), c) })
        if (!preserved) expect({ arrow: c.arrow, style: d.body.messages[i]!.style }).toEqual({ arrow: c.arrow, style: c.style })
      })
      expect(serializeMermaid(d).split('\n').filter(line => / m\d+$/.test(line)).map(line => line.trim())).toEqual(lines)
      expect(drawnMessages(renderMermaidSVG(d))).toEqual(ARROW_CASES.map(drawn))
    }
  })

  test('each op style writes its Mermaid arrow, which Mermaid accepts, and draws its heads', async () => {
    let d = sequence('sequenceDiagram\n  participant A\n  participant B')
    for (const c of STYLE_CASES) d = apply(d, { kind: 'add_message', from: 'A', to: 'B', text: c.style, style: c.style })
    const written = serializeMermaid(d)
    expect(written.split('\n').filter(line => line.includes(':')).map(line => line.trim())).toEqual(STYLE_CASES.map(c => `A${c.arrow}B: ${c.style}`))
    expect(await upstream.accepts(written)).toBe(true)
    expect(drawnMessages(renderMermaidSVG(d))).toEqual(STYLE_CASES.map(drawn))
    expect(describeMermaidFacts(sequence(written))).toEqual(describeMermaidFacts(d))
  })

  test('a style edited on a parsed message is written, not its stale operator', () => {
    // A finite table (every arrow × every style × self or not), so every case runs.
    for (const from of ARROW_CASES) {
      for (const to of STYLE_CASES) {
        for (const self of [false, true]) {
          const d = sequence(`sequenceDiagram\n  A${from.arrow}${self ? 'A' : 'B'}: x`)
          d.body.messages[0]!.style = to.style
          const reread = sequence(serializeMermaid(d))
          // A half-arrow keeps its operator while its shaft's style is unchanged.
          const kept = 'half' in from && from.style === to.style ? from : to
          expect({ from: from.arrow, to: to.style, self, style: reread.body.messages[0]!.style, arrow: reread.body.messages[0]!.arrow, drawn: drawnMessages(renderMermaidSVG(d)) })
            .toEqual({ from: from.arrow, to: to.style, self, style: kept.style, arrow: kept.arrow, drawn: [drawn(kept)] })
        }
      }
    }
  })
})

// ============================================================================
// Notes: typed top-level statements with add/remove/set text/move ops
// ============================================================================

describe('sequence notes are typed statements that ops add, remove, edit and move', () => {
  let upstream: ReturnType<typeof startUpstreamMermaid>
  beforeAll(() => { upstream = startUpstreamMermaid() })
  afterAll(async () => { await upstream.close() })

  const NOTES = 'sequenceDiagram\n  participant A\n  participant B\n  A->>B: one\n  Note over A,B: shared\n  create participant C\n  B->>C: two\n  alt ok\n    C-->>A: three\n  end\n  A->>B: four\n'

  /** Messages and notes in drawing order, as Mermaid's database holds them. */
  const mermaidTimeline = (source: string) => upstream.project(source, diagram => diagram.db.getMessages()
    .filter((m: { from?: string; type: number }) => m.from !== undefined)
    .map((m: { from: string; to: string; type: number; placement: number; message: string }) => m.type === diagram.db.LINETYPE.NOTE
      ? `note ${['left', 'right', 'over'][m.placement]} ${m.from === m.to ? m.from : `${m.from},${m.to}`}: ${m.message}`
      : `${m.from}->${m.to}: ${m.message}`))
  /** Mermaid keeps a line break as written; the renderer reads it as one. */
  const breaks = (text: string) => projectEntityMarkers(text).replace(/<br\s*\/?>/gi, '\n')

  /** The same timeline as the renderer's parser reads it. */
  function ourTimeline(source: string): string[] {
    const diagram = parseSequenceDiagram(source.split('\n').map(line => line.trim()).filter(Boolean))
    const notesAfter = (index: number) => diagram.notes.filter(note => note.afterIndex === index)
      .map(note => `note ${note.position} ${note.actorIds.join(',')}: ${note.text}`)
    return [...notesAfter(-1), ...diagram.messages.flatMap((m, index) => [`${m.from}->${m.to}: ${m.label}`, ...notesAfter(index)])]
  }

  test.each([
    ['after a message', { kind: 'add_note', position: 'right', actorIds: ['B'], text: 'got it', afterMessage: 0 }, '  A->>B: one\n  Note over A,B: shared\n  Note right of B: got it\n  create participant C\n'],
    ['before a message, above the create line bound to it', { kind: 'add_note', position: 'left', actorIds: ['A'], text: 'about to create', beforeMessage: 1 }, '  Note over A,B: shared\n  Note left of A: about to create\n  create participant C\n'],
    ['at the end, over two participants, wrapped and on two lines', { kind: 'add_note', position: 'over', actorIds: ['B', 'C'], text: 'all\ndone', wrap: true }, '  A->>B: four\n  Note over B,C: wrap: all<br/>done\n'],
    ['with text that looks like a statement separator or comment', { kind: 'add_note', position: 'over', actorIds: ['A'], text: 'a; b #c %% d', afterMessage: 2 }, '  A->>B: four\n  Note over A: a#59; b #35;c %#37; d\n'],
    ['removed', { kind: 'remove_note', index: 0 }, '  A->>B: one\n  create participant C\n'],
    ['with new text', { kind: 'set_note_text', index: 0, text: 'both <b>see</b> it' }, '  Note over A,B: both <b>see</b> it\n'],
    ['moved before the first message', { kind: 'move_note', index: 0, beforeMessage: 0 }, '  participant B\n  Note over A,B: shared\n  A->>B: one\n  create participant C\n'],
    ['moved after the last message', { kind: 'move_note', index: 0, afterMessage: 2 }, '  A->>B: four\n  Note over A,B: shared\n'],
  ] as const)('a note %s is written as Mermaid reads it', async (_name, op, written) => {
    const edited = apply(sequence(NOTES), op as SequenceMutationOp)
    const output = serializeMermaid(edited)
    expect(output).toContain(written)
    expect(serializeMermaid(sequence(output))).toBe(output)
    expect(describeMermaidFacts(sequence(output))).toEqual(describeMermaidFacts(edited))
    const notes = edited.body.statements.filter(statement => statement.kind === 'note')
    notes.forEach((note, index) => expect(describeMermaidFacts(edited).filter(fact => fact.startsWith(`note#${index} ${note.position === 'over' ? 'over' : `${note.position} of`} ${note.actorIds.join(',')} : `))).toHaveLength(1))
    const read = await mermaidTimeline(output)
    if (!read.ok) throw new Error(read.error)
    expect(read.value.map(breaks)).toEqual(ourTimeline(output))
  })

  test.each([
    ['a third participant', { kind: 'add_note', position: 'over', actorIds: ['A', 'B', 'C'], text: 'x' }, 'INVALID_OP'],
    ['two participants beside', { kind: 'add_note', position: 'left', actorIds: ['A', 'B'], text: 'x' }, 'INVALID_OP'],
    ['no participant', { kind: 'add_note', position: 'over', actorIds: [], text: 'x' }, 'INVALID_OP'],
    ['an unknown participant', { kind: 'add_note', position: 'over', actorIds: ['Z'], text: 'x' }, 'PARTICIPANT_NOT_FOUND'],
    ['an id Mermaid reads as another token', { kind: 'add_note', position: 'over', actorIds: ['accDescr'], text: 'x' }, 'INVALID_OP'],
    ['both anchors', { kind: 'add_note', position: 'over', actorIds: ['A'], text: 'x', afterMessage: 0, beforeMessage: 1 }, 'INVALID_OP'],
    ['an anchor past the top-level messages', { kind: 'add_note', position: 'over', actorIds: ['A'], text: 'x', afterMessage: 3 }, 'MESSAGE_NOT_FOUND'],
    ['a missing note', { kind: 'set_note_text', index: 1, text: 'x' }, 'INVALID_OP'],
    ['a missing note to move', { kind: 'move_note', index: 1 }, 'INVALID_OP'],
  ] as const)('an op naming %s is refused', (_name, op, code) => {
    const parsed = sequence(NOTES)
    const result = mutate(parsed, op as SequenceMutationOp)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe(code)
    expect(serializeMermaid(parsed)).toBe(NOTES)
  })

  test('removing a participant a note names is refused until the note is removed', () => {
    const parsed = sequence('sequenceDiagram\n  A->>B: hi\n  Note over A,B: shared\n  B->>C: on')
    const refused = mutate(parsed, { kind: 'remove_participant', id: 'A' })
    expect(!refused.ok && refused.error).toEqual({ code: 'INVALID_OP', message: expect.stringContaining('note 0') })
    const removed = apply(apply(parsed, { kind: 'remove_note', index: 0 }), { kind: 'remove_participant', id: 'A' })
    expect(removed.body.participants.map(p => p.id)).toEqual(['B', 'C'])
  })

  test('each placement keeps its authored spelling apart from canonical case and spacing', async () => {
    const source = 'sequenceDiagram\n  A->>B: x\n  note LEFT OF A : l\n  Note right of B: nowrap: r<br>two\n  Note over A,B:#35; both\n'
    const parsed = sequence(source)
    expect(parsed.body.statements.map(statement => statement.kind === 'note' ? statement.position : statement.kind)).toEqual(['message', 'left', 'right', 'over'])
    const written = serializeMermaid(parsed)
    expect(written).toBe('sequenceDiagram\n  A->>B: x\n  Note left of A: l\n  Note right of B: nowrap: r<br>two\n  Note over A,B: #35; both\n')
    const read = await mermaidTimeline(written)
    if (!read.ok) throw new Error(read.error)
    expect(read.value.map(breaks)).toEqual(ourTimeline(source))
  })
})

// ============================================================================
// Facts state the index each message op takes
// ============================================================================

describe('facts give each sequence message the address its ops take', () => {
  // message# counts fragment messages too, so it differs from the top-level
  // index after the first fragment and from the branch index inside one.
  const NESTED = 'sequenceDiagram\n  A->>B: one\n  alt ok\n    B->>A: two\n  else no\n    B->>A: three\n    B->>A: four\n  end\n  A->>B: five\n  loop again\n    A->>B: six\n  end\n  A->>B: seven\n'

  /** The op address facts state for the message whose text is `text`. */
  function address(d: SequenceValidDiagram, text: string): Record<string, number> {
    const facts = describeMermaidFacts(d)
    const subject = facts.find(fact => /^message#\d+ /.test(fact) && fact.endsWith(` : ${text}`))!.split(' ')[0]!
    const fields = facts.find(fact => fact.startsWith(`${subject} op `))!.slice(`${subject} op `.length).split(' ')
    return Object.fromEntries(fields.flatMap((field, i) => i % 2 === 0 ? [[field, Number(fields[i + 1])]] : []))
  }

  test.each(['one', 'two', 'three', 'four', 'five', 'six', 'seven'])('the address facts give "%s" edits that message and no other', text => {
    const d = sequence(NESTED)
    const at = address(d, text)
    const op = 'fragmentIndex' in at
      ? { kind: 'set_fragment_message_text', fragmentIndex: at.fragmentIndex!, branchIndex: at.branchIndex!, index: at.index!, text: 'edited' } as const
      : { kind: 'set_message_text', index: at.index!, text: 'edited' } as const
    const texts = (diagram: SequenceValidDiagram) => describeMermaidFacts(diagram).filter(fact => /^message#\d+ (?:top-level|fragment#)/.test(fact)).map(fact => fact.slice(fact.lastIndexOf(' : ') + 3))
    const before = texts(d)
    expect(texts(apply(d, op))).toEqual(before.map(t => t === text ? 'edited' : t))
  })

  test('a note and a message placed by the facts address land next to the message the agent read', () => {
    let d = sequence(NESTED)
    d = apply(d, { kind: 'add_note', position: 'over', actorIds: ['B'], text: 'after five', afterMessage: address(d, 'five').index! })
    d = apply(d, { kind: 'add_message', from: 'B', to: 'A', text: 'before seven', index: address(d, 'seven').index! })
    d = apply(d, { kind: 'add_fragment_message', fragmentIndex: address(d, 'four').fragmentIndex!, branchIndex: address(d, 'four').branchIndex!, index: address(d, 'four').index!, from: 'A', to: 'B', text: 'before four' })
    const written = serializeMermaid(d)
    expect(written).toContain('  A->>B: five\n  Note over B: after five\n  loop again\n')
    expect(written).toContain('  B->>A: before seven\n  A->>B: seven\n')
    expect(written).toContain('  A->>B: before four\n  B->>A: four\n')
  })
})

// ============================================================================
// critical / break / rect fragments
// ============================================================================

describe('critical, break and rect fragments are typed like alt, opt, loop and par', () => {
  let upstream: ReturnType<typeof startUpstreamMermaid>
  beforeAll(() => { upstream = startUpstreamMermaid() })
  afterAll(async () => { await upstream.close() })

  /** Messages and fragment markers in order, as Mermaid's database holds them. */
  const mermaidSignals = (source: string) => upstream.project(source, diagram => {
    const names = Object.fromEntries(Object.entries(diagram.db.LINETYPE as Record<string, number>).map(([name, type]) => [type, name]))
    return diagram.db.getMessages().map((m: { from?: string; to?: string; message: unknown; type: number }) => m.from === undefined
      ? `${names[m.type]} ${typeof m.message === 'string' ? m.message : ''}`.trim()
      : `${m.from}->${m.to}: ${m.message}`)
  })

  test.each([
    ['a critical fragment with option branches', [
      { kind: 'add_fragment', fragmentKind: 'critical', label: 'connect' },
      { kind: 'add_fragment_branch', fragmentIndex: 0, label: 'timeout' },
      { kind: 'add_fragment_message', fragmentIndex: 0, from: 'A', to: 'B', text: 'try' },
      { kind: 'add_fragment_message', fragmentIndex: 0, branchIndex: 1, from: 'B', to: 'A', text: 'retry' },
    ], '  critical connect\n  A->>B: try\n  option timeout\n  B->>A: retry\n  end\n', ['CRITICAL_START connect', 'A->B: try', 'CRITICAL_OPTION timeout', 'B->A: retry', 'CRITICAL_END']],
    ['a break fragment', [
      { kind: 'add_fragment', fragmentKind: 'break', label: 'when full' },
      { kind: 'add_fragment_message', fragmentIndex: 0, from: 'B', to: 'A', text: 'full' },
    ], '  break when full\n  B->>A: full\n  end\n', ['BREAK_START when full', 'B->A: full', 'BREAK_END']],
    ['a rect fragment with a fill color', [
      { kind: 'add_fragment', fragmentKind: 'rect', label: 'rgb(200, 220, 255)' },
      { kind: 'add_fragment_message', fragmentIndex: 0, from: 'A', to: 'B', text: 'inside' },
    ], '  rect rgb(200, 220, 255)\n  A->>B: inside\n  end\n', ['RECT_START rgb(200, 220, 255)', 'A->B: inside', 'RECT_END']],
    ['a rect fragment recolored', [
      { kind: 'add_fragment', fragmentKind: 'rect' },
      { kind: 'set_fragment_label', index: 0, label: 'lightyellow' },
    ], '  rect lightyellow\n  end\n', ['RECT_START lightyellow', 'RECT_END']],
  ] as const)('%s is written as Mermaid reads it and re-reads typed', async (_name, ops, written, signals) => {
    let d = sequence('sequenceDiagram\n  A->>B: hi\n')
    for (const op of ops) d = apply(d, op as SequenceMutationOp)
    const output = serializeMermaid(d)
    expect(output).toBe(`sequenceDiagram\n  A->>B: hi\n${written}`)
    expect(sequence(output).body.statements.map(statement => statement.kind)).toEqual(['message', 'fragment'])
    expect(describeMermaidFacts(sequence(output))).toEqual(describeMermaidFacts(d))
    const read = await mermaidSignals(output)
    if (!read.ok) throw new Error(read.error)
    expect(read.value.map(projectEntityMarkers)).toEqual(['A->B: hi', ...signals])
  })

  test.each([
    ['a rect color the renderer cannot read', { kind: 'add_fragment', fragmentKind: 'rect', label: 'not a color' }],
    ['a rect recolored with text', { kind: 'set_fragment_label', index: 0, label: 'Heading' }],
    ['a second branch in a break', { kind: 'add_fragment_branch', fragmentIndex: 1 }],
    ['a second branch in a rect', { kind: 'add_fragment_branch', fragmentIndex: 0 }],
  ] as const)('an op asking for %s is refused', (_name, op) => {
    const parsed = sequence('sequenceDiagram\n  rect rgb(1, 2, 3)\n    A->>B: in\n  end\n  break stop\n    A->>B: out\n  end\n')
    const result = mutate(parsed, op as SequenceMutationOp)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('INVALID_OP')
  })

  test.each([
    ['a rect whose argument is a # comment', 'rect #ff0000'],
    ['a rect holding another fragment', 'rect rgb(1, 2, 3)\n    alt yes\n      A->>B: x\n    end'],
  ])('%s stays preserved source', (_name, block) => {
    const source = `sequenceDiagram\n  A->>B: hi\n  ${block}\n  end\n`
    expect(sequence(source).body.statements.map(statement => statement.kind)).toEqual(['message', 'opaque-block'])
    expect(serializeMermaid(sequence(source))).toBe(source)
  })
})

// ============================================================================
// add_message index
// ============================================================================

describe('sequence add_message with index', () => {
  test('inserts at a top-level position', () => {
    const d = apply(sequence(SRC), { kind: 'add_message', from: 'A', to: 'B', text: 'early', index: 1 })
    expect(messageTexts(d)).toEqual(['one', 'early', 'two', 'three'])
    // Serialized order matches
    const out = serializeMermaid(d)
    expect(out.indexOf('early')).toBeGreaterThan(out.indexOf('one'))
    expect(out.indexOf('early')).toBeLessThan(out.indexOf('two'))
    // Serialize → re-parse preserves the edit (P3 fidelity contract)
    const back = sequence(out)
    expect(messageTexts(back)).toEqual(['one', 'early', 'two', 'three'])
  })

  test('index 0 prepends; index === length appends', () => {
    const first = apply(sequence(SRC), { kind: 'add_message', from: 'B', to: 'A', text: 'zeroth', index: 0 })
    expect(messageTexts(first)).toEqual(['zeroth', 'one', 'two', 'three'])
    const last = apply(sequence(SRC), { kind: 'add_message', from: 'B', to: 'A', text: 'fourth', index: 3 })
    expect(messageTexts(last)).toEqual(['one', 'two', 'three', 'fourth'])
  })

  test('omitting index keeps the append behavior', () => {
    const d = apply(sequence(SRC), { kind: 'add_message', from: 'A', to: 'B', text: 'tail' })
    expect(messageTexts(d)).toEqual(['one', 'two', 'three', 'tail'])
  })

  test('out-of-range index is a prescriptive error', () => {
    const r = mutate(sequence(SRC), { kind: 'add_message', from: 'A', to: 'B', text: 'x', index: 7 })
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.error.code).toBe('INVALID_OP')
    expect(r.error.message).toContain('7')
    expect(r.error.message).toContain('0..3')
  })

  test('non-integer index rejected', () => {
    const r = mutate(sequence(SRC), { kind: 'add_message', from: 'A', to: 'B', text: 'x', index: 1.5 })
    expect(r.ok).toBe(false)
  })

  test('insert lands before an opaque segment boundary correctly', () => {
    const src = 'sequenceDiagram\n  A->>B: one\n  Note over A: mid\n  A->>B: two'
    const d = apply(sequence(src), { kind: 'add_message', from: 'B', to: 'A', text: 'between', index: 1 })
    expect(messageTexts(d)).toEqual(['one', 'between', 'two'])
    const out = serializeMermaid(d)
    // The note keeps its anchoring after message one
    expect(out.indexOf('Note over A: mid')).toBeGreaterThan(out.indexOf('one'))
    const back = sequence(out)
    expect(messageTexts(back)).toEqual(['one', 'between', 'two'])
    expect(out).toContain('Note over A: mid')
  })
})

// ============================================================================
// move_message
// ============================================================================

describe('sequence move_message', () => {
  test('moves a top-level message to a new position', () => {
    const d = apply(sequence(SRC), { kind: 'move_message', from: 2, to: 0 })
    expect(messageTexts(d)).toEqual(['three', 'one', 'two'])
    const back = sequence(serializeMermaid(d))
    expect(messageTexts(back)).toEqual(['three', 'one', 'two'])
  })

  test('moves forward as well as backward', () => {
    const d = apply(sequence(SRC), { kind: 'move_message', from: 0, to: 2 })
    expect(messageTexts(d)).toEqual(['two', 'three', 'one'])
  })

  test('move is stable across opaque segments (box/notes preserved verbatim)', () => {
    const src = 'sequenceDiagram\n  A->>B: one\n  Note over A: mid\n  A->>B: two'
    const d = apply(sequence(src), { kind: 'move_message', from: 1, to: 0 })
    expect(messageTexts(d)).toEqual(['two', 'one'])
    const out = serializeMermaid(d)
    expect(out).toContain('Note over A: mid')
    const back = sequence(out)
    expect(messageTexts(back)).toEqual(['two', 'one'])
  })

  test('from out of range is a prescriptive error', () => {
    const r = mutate(sequence(SRC), { kind: 'move_message', from: 9, to: 0 })
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.error.code).toBe('MESSAGE_NOT_FOUND')
    expect(r.error.message).toContain('9')
    expect(r.error.message).toContain('0..2')
  })

  test('to out of range is a prescriptive error', () => {
    const r = mutate(sequence(SRC), { kind: 'move_message', from: 0, to: 3 })
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.error.code).toBe('MESSAGE_NOT_FOUND')
    expect(r.error.message).toContain('0..2')
  })

  test('from === to is a no-op success', () => {
    const d = apply(sequence(SRC), { kind: 'move_message', from: 1, to: 1 })
    expect(messageTexts(d)).toEqual(['one', 'two', 'three'])
  })
})

// ============================================================================
// set_participant_label
// ============================================================================

describe('sequence set_participant_label', () => {
  test('updates a declared participant label and round-trips', () => {
    const d = apply(sequence(SRC), { kind: 'set_participant_label', id: 'A', label: 'Alicia' })
    expect(d.body.participants.find(p => p.id === 'A')!.label).toBe('Alicia')
    const out = serializeMermaid(d)
    expect(out).toContain('participant A as Alicia')
    const back = sequence(out)
    expect(back.body.participants.find(p => p.id === 'A')!.label).toBe('Alicia')
  })

  test('labels an implicit (message-only) participant by adding a declaration', () => {
    const d = apply(sequence(SRC), { kind: 'set_participant_label', id: 'B', label: 'Bobby' })
    const out = serializeMermaid(d)
    expect(out).toContain('participant B as Bobby')
    const back = sequence(out)
    expect(back.body.participants.find(p => p.id === 'B')!.label).toBe('Bobby')
  })

  test('setting the label back to the id serializes a bare declaration', () => {
    const d = apply(sequence(SRC), { kind: 'set_participant_label', id: 'A', label: 'A' })
    const out = serializeMermaid(d)
    expect(out).not.toContain(' as ')
    const back = sequence(out)
    expect(back.body.participants.find(p => p.id === 'A')!.label).toBe('A')
  })

  test('unknown participant is a prescriptive error', () => {
    const r = mutate(sequence(SRC), { kind: 'set_participant_label', id: 'Z', label: 'Zed' })
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.error.code).toBe('PARTICIPANT_NOT_FOUND')
    expect(r.error.message).toContain('Z')
  })

  test('empty and multi-line labels rejected (would not survive re-parse)', () => {
    for (const label of ['', '   ', 'two\nlines']) {
      const r = mutate(sequence(SRC), { kind: 'set_participant_label', id: 'A', label })
      expect(r.ok).toBe(false)
      if (!r.ok) expect(r.error.code).toBe('INVALID_OP')
    }
  })
})

// ============================================================================
// Registry wiring
// ============================================================================

describe('sequence op registry wiring', () => {
  test('new ops are in MUTATION_OPS_BY_FAMILY', () => {
    expect(MUTATION_OPS_BY_FAMILY.sequence).toContain('move_message')
    expect(MUTATION_OPS_BY_FAMILY.sequence).toContain('set_participant_label')
  })

  test('op-schema knows the new shapes', () => {
    const docs = describeOps('sequence')
    expect(Object.keys(docs)).toContain('move_message')
    expect(Object.keys(docs)).toContain('set_participant_label')
    expect(docs.add_message!.map(f => f.name)).toContain('index')
  })
})
