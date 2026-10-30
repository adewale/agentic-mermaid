/**
 * Sequence op-menu widening — family-elevation-plan §Sequence item 6, journey
 * conventions from PR #141: validated indices, prescriptive errors, and every
 * succeeding op must survive serialize → re-parse.
 *
 * New ops under test:
 *   - add_message gains optional `index` (top-level insert position)
 *   - move_message { from, to } (top-level indices)
 *   - set_participant_label { id, label }
 */
import { afterAll, beforeAll, describe, test, expect } from 'bun:test'
import fc from 'fast-check'
import { fcParameters } from './helpers/fc-parameters.ts'
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
      const d = sequence(['sequenceDiagram', ...(preserved ? ['rect rgb(1, 2, 3)', ...lines, 'end'] : lines)].join('\n'))
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
    fc.assert(fc.property(fc.constantFrom(...ARROW_CASES), fc.constantFrom(...STYLE_CASES), fc.boolean(), (from, to, self) => {
      const d = sequence(`sequenceDiagram\n  A${from.arrow}${self ? 'A' : 'B'}: x`)
      d.body.messages[0]!.style = to.style
      const reread = sequence(serializeMermaid(d))
      // A half-arrow keeps its operator while its shaft's style is unchanged.
      const kept = 'half' in from && from.style === to.style ? from : to
      expect({ style: reread.body.messages[0]!.style, arrow: reread.body.messages[0]!.arrow, drawn: drawnMessages(renderMermaidSVG(d)) })
        .toEqual({ style: kept.style, arrow: kept.arrow, drawn: [drawn(kept)] })
    }), fcParameters({ numRuns: 60 }))
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
