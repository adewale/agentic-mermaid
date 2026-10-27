import { expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseZenUML, type ZenUMLSourceObservation } from '../zenuml/native-parser.ts'
import { mutateZenUML, serializeZenUML, validateZenUML, zenUMLMeaning } from '../zenuml/native-body.ts'
import { projectZenUMLSequence } from '../zenuml/native-sequence.ts'
import { getSequenceBlockBoundaries, getSequenceBlockScope } from '../sequence/parser.ts'
import { preparedDisplayTextValue } from '../shared/display-text.ts'
import { mutateChecked, parseRegisteredMermaid, serializeMermaid } from '../agent/core.ts'

const rich = `zenuml
title Checkout ownership
@Actor Buyer as "Customer & guest"
@Database <<inventory>> Stock
API
@Starter(Buyer)
API.checkout(order) {
  // Reserve the actual stock.
  result = Stock.reserve(order) {
    if (available) {
      return accepted
    } else if (backorder) {
      return pending
    } else {
      return rejected
    }
  }
  cached = cache(order)
  ticket = new Ticket(order) {
    register()
  }
  API->Buyer: ready
}`
test('native Zen owns aliases, call stacks, branch returns, assignments, self calls and created objects', () => {
  const body = parseZenUML(rich), sequence = projectZenUMLSequence(body)
  expect(body.participants.map(p => [p.id, p.label, p.annotations, p.stereotype])).toEqual([
    ['Buyer', 'Customer & guest', ['Actor'], undefined], ['Stock', 'Stock', ['Database'], 'inventory'], ['API', 'API', [], undefined],
  ])
  expect(sequence.actors.map(a => [a.id, a.type, a.external])).toEqual([
    ['Buyer', 'actor', undefined], ['Stock', 'database', undefined], ['API', 'participant', undefined], ['ticket:Ticket', 'participant', undefined],
  ])
  expect(sequence.messages.map(m => [m.from, m.to, m.label, m.lineStyle])).toEqual([
    ['Buyer', 'API', 'checkout(order)', 'solid'], ['API', 'Stock', 'reserve(order)', 'solid'],
    ['Stock', 'API', 'accepted', 'dashed'], ['Stock', 'API', 'pending', 'dashed'], ['Stock', 'API', 'rejected', 'dashed'],
    ['API', 'API', 'cached = cache(order)', 'solid'], ['API', 'ticket:Ticket', '«order»', 'solid'],
    ['ticket:Ticket', 'ticket:Ticket', 'register()', 'solid'], ['ticket:Ticket', 'API', 'ticket', 'dashed'], ['API', 'Buyer', 'ready', 'solid'],
  ])
  expect(sequence.actors.find(a => a.id === 'ticket:Ticket')!.createMessageIndex).toBe(6)
  expect(sequence.messages[0]!.endHead).toBe('filled')
  expect(sequence.messages.at(-1)!.endHead).toBe('open')
  expect(sequence.blocks[0]!.dividers.map(d => [d.index, d.label])).toEqual([[3, 'else if (backorder)'], [4, 'else']])
  expect(sequence.messages.slice(2, 5).map(m => m.parentId)).toEqual(Array(3).fill(sequence.blocks[0]!.id))
  expect(sequence.notes.map(n => [n.text, n.actorIds, n.afterIndex])).toEqual([['Reserve the actual stock.', ['API', 'Stock'], 0]])
  expect(zenUMLMeaning(parseZenUML(serializeZenUML(body)))).toBe(zenUMLMeaning(body))
})

test('explicit callback callers and annotated or arrow replies retain actual return direction', () => {
  const body = parseZenUML(`zenuml
Client->API.request() {
  Worker.work() {
    API->Callback.notify() {
      if (done) {
        return callbackResult
      }
    }
    return workerResult
    @return
    API->Client: early
  }
  T result = Store.load()
  Store-->API: additional
}`)
  expect(projectZenUMLSequence(body).messages.map(m => [m.from, m.to, m.label, m.lineStyle])).toEqual([
    ['Client', 'API', 'request()', 'solid'], ['API', 'Worker', 'work()', 'solid'], ['API', 'Callback', 'notify()', 'solid'],
    ['Callback', 'API', 'callbackResult', 'dashed'], ['Worker', 'API', 'workerResult', 'dashed'], ['API', 'Client', 'early', 'dashed'],
    ['API', 'Store', 'load()', 'solid'], ['Store', 'API', 'result:T', 'dashed'], ['Store', 'API', 'additional', 'dashed'],
  ])
  const canonical = serializeZenUML(body)
  expect(canonical).toContain('API-->Client: early')
  expect(zenUMLMeaning(parseZenUML(canonical))).toBe(zenUMLMeaning(body))
})

test('loops, parallel statements and try branches preserve lexical empty and note-only scopes', () => {
  const body = parseZenUML(`zenuml
@Starter(User)
forEach (item in items) {
  if (ok) {
    // note in an empty branch
  } else {
    opt {
    }
  }
}
par {
  A.first() {
    B.inner()
  }
  A->B: second
}
try {
  A.work()
} catch (error) {
  A->User: failed
} finally {
  A.clean()
}`)
  const sequence = projectZenUMLSequence(body)
  expect(sequence.blocks.map(b => [b.type, b.label, b.startIndex, b.endIndex])).toEqual([
    ['loop', 'forEach (item in items)', 0, -1], ['alt', 'ok', 0, -1], ['opt', '', 0, -1], ['par', '', 0, 2], ['break', 'try', 3, 5],
  ])
  const outer = getSequenceBlockScope(sequence.blocks[0]!)!, conditional = getSequenceBlockScope(sequence.blocks[1]!)!
  expect(outer.childBlockIndices).toEqual([1])
  expect(outer.noteIndices).toEqual([0])
  expect(conditional.childBlockIndices).toEqual([2])
  expect(conditional.childSectionIndices).toEqual([1])
  expect(conditional.dividerNoteIndices).toEqual([1])
  expect(sequence.blocks[3]!.dividers.map(d => d.index)).toEqual([2])
  expect(sequence.blocks[4]!.dividers.map(d => [d.index, d.label])).toEqual([[4, 'catch (error)'], [5, 'finally']])
  expect(getSequenceBlockBoundaries(sequence)?.filter(b => b.blockIndex === 1).map(b => [b.kind, b.messageIndex, b.noteIndex])).toEqual([['open', 0, 0], ['divider', 0, 1], ['close', 0, 1]])
  expect(zenUMLMeaning(parseZenUML(serializeZenUML(body)))).toBe(zenUMLMeaning(body))
})

test('declaration comments remain ignored while message comments retain their ownership', () => {
  const body = parseZenUML(`zenuml
// ignored participant comment
BookService
// shown above the message
// **Markdown** remains authored text
BookService.getBook()`)
  expect(body.participants[0]!.comments).toEqual(['ignored participant comment'])
  const notes = projectZenUMLSequence(body).notes
  expect(notes.map(n => n.text)).toEqual(['shown above the message', '<b>Markdown</b> remains authored text'])
  expect(preparedDisplayTextValue(notes[1]!.textContent!.prepared)).toBe('Markdown remains authored text')
  expect(notes[1]!.textContent!.prepared.lines[0]![0]!.bold).toBe(true)
  const reparsed = parseZenUML(serializeZenUML(body))
  expect(zenUMLMeaning(reparsed)).toBe(zenUMLMeaning(body))
  expect(projectZenUMLSequence(reparsed).notes.map(n => n.text)).toEqual(notes.map(n => n.text))
})

test('checked edits rename implicit and nested identities without mutating the prior body', () => {
  const body = parseZenUML('zenuml\nClient->API.request() {\n  Worker.work() {\n    API->Worker: update\n  }\n  return complete\n}')
  const before = serializeZenUML(body)
  const renamed = mutateZenUML(body, { kind: 'rename_participant', id: 'API', newId: 'Gateway' })
  expect(renamed.ok).toBe(true)
  if (!renamed.ok) throw Error(renamed.error.message)
  expect(renamed.value.participants).toEqual([])
  expect(projectZenUMLSequence(renamed.value).messages.map(m => [m.from, m.to])).toEqual([['Client', 'Gateway'], ['Gateway', 'Worker'], ['Gateway', 'Worker'], ['Gateway', 'Client']])
  expect(serializeZenUML(body)).toBe(before)
  const addressName = mutateZenUML(body, { kind: 'rename_participant', id: 'API', newId: 'statement:1' })
  expect(addressName.ok).toBe(true)
  if (addressName.ok) {
    const p = projectZenUMLSequence(addressName.value)
    const ids = [...p.actors, ...p.messages, ...p.blocks, ...p.notes].map(value => value.id)
    expect(new Set(ids).size).toBe(ids.length)
  }
  for (const op of [{ kind: 'rename_participant', id: 'API', newId: 'Worker' }, { kind: 'remove_participant', id: 'API' }, { kind: 'remove_statement', id: 'missing' }] as const) expect(mutateZenUML(body, op).ok).toBe(false)
  expect(serializeZenUML(body)).toBe(before)
})

test('checked statement and metadata writes are portable and reject malformed edits atomically', () => {
  const body = parseZenUML('zenuml\n@Starter(Client)\nAPI.request() {\n  if (ready) {\n  } else {\n  }\n}')
  const call = body.statements[0]!, fragment = call.kind === 'call' ? call.children[0]! : undefined
  if (fragment?.kind !== 'fragment') throw Error('Expected authored fragment')
  const inserted = mutateZenUML(body, { kind: 'insert_statement', parentId: fragment.id, branchIndex: 1, statement: { kind: 'message', id: 'new-message', from: 'API', to: 'Client', label: 'unavailable', reply: false } })
  expect(inserted.ok).toBe(true)
  if (!inserted.ok) throw Error(inserted.error.message)
  expect(projectZenUMLSequence(inserted.value).messages.at(-1)?.label).toBe('unavailable')
  const title = mutateZenUML(inserted.value, { kind: 'set_title', title: 'Changed title' })
  expect(title.ok).toBe(true)
  const invalid = mutateZenUML(body, { kind: 'set_statement', id: call.id, statement: { kind: 'return', id: 'wrong-id', label: 'bad' } })
  expect(invalid.ok).toBe(false)
  expect(projectZenUMLSequence(body).messages).toHaveLength(1)
})

test('created instance and constructor renames preserve coupled nested references', () => {
  const body = parseZenUML('zenuml\n@Starter(Client)\nticket = new Ticket(order) {\n  register()\n}\n"ticket:Ticket".confirm()')
  const changed = mutateZenUML(body, { kind: 'rename_participant', id: 'ticket:Ticket', newId: 'voucher:Ticket' })
  expect(changed.ok).toBe(true)
  if (!changed.ok) throw Error(changed.error.message)
  expect(projectZenUMLSequence(changed.value).actors.map(a => a.id)).toEqual(['Client', 'voucher:Ticket'])
  expect(projectZenUMLSequence(changed.value).messages.at(-1)?.to).toBe('voucher:Ticket')
  expect(mutateZenUML(body, { kind: 'rename_participant', id: 'ticket:Ticket', newId: 'unrepresentable' }).ok).toBe(false)
  const constructor = mutateZenUML(parseZenUML('zenuml\nnew Ticket\nTicket.confirm()'), { kind: 'rename_participant', id: 'Ticket', newId: 'Voucher' })
  expect(constructor.ok).toBe(true)
  if (constructor.ok) expect(projectZenUMLSequence(constructor.value).messages.map(m => m.to)).toEqual(['Voucher', 'Voucher'])
})

test('unsupported source remains whole and refuses partial render or typed rewriting', () => {
  const source = 'zenuml\nA->B: supported prefix\nref(OtherDiagram, A, B)\nB->A: supported suffix\n'
  const body = parseZenUML(source)
  expect(body.unsupportedSource).toBe(source)
  expect(serializeZenUML(body)).toBe(source)
  expect(() => projectZenUMLSequence(body)).toThrow('Unsupported ZenUML')
  expect(mutateZenUML(body, { kind: 'set_title', title: 'Do not drop the ref' }).ok).toBe(false)
})

test('generated ownership addresses never coalesce with authored names or outside endpoints', () => {
  const body = parseZenUML('zenuml\n"statement:1"\n"zenuml:outside"\nA.work() {\n  "statement:1".nested()\n}')
  const sequence = projectZenUMLSequence(body)
  const ids = [...sequence.actors, ...sequence.messages, ...sequence.blocks, ...sequence.notes].map(v => v.id)
  expect(new Set(ids).size).toBe(ids.length)
  expect(sequence.actors.find(a => a.external)?.id).not.toBe('zenuml:outside')
  expect(sequence.messages[0]!.from).toBe(sequence.actors.find(a => a.external)!.id)
  expect(sequence.actors.find(a => a.id === 'zenuml:outside')!.external).toBeUndefined()
  expect(projectZenUMLSequence(parseZenUML('zenuml')).actors).toEqual([])
})

test('source observations retain actual authored token offsets through wrapper, accessibility and CRLF', () => {
  const source = '---\r\ntitle: Wrapped\r\n---\r\nzenuml\r\naccTitle: Native accessibility\r\n@Actor A as Alice\r\nA->B.work("https://example.com/{literal}") {\r\n  B->A: https://example.com/{payload}\r\n}\r\n'
  const events: ZenUMLSourceObservation[] = []
  const body = parseZenUML(source, event => events.push(event))
  expect(body.title).toBe('Wrapped')
  expect(body.accessibilityTitle).toBe('Native accessibility')
  expect(source.slice(events.find(e => e.kind === 'nodes' && e.id === 'A')!.start, events.find(e => e.kind === 'nodes' && e.id === 'A')!.end)).toBe('@Actor A as Alice')
  for (const event of events.filter(e => e.kind === 'edges')) expect(source.slice(event.start, event.end)).toMatch(/^(A->B\.work|B->A:)/)
  expect(projectZenUMLSequence(body).messages.at(-1)!.label).toBe('https://example.com/{payload}')
})

test('title edits preserve one wrapper and unrelated metadata while rejecting coupled YAML aliases', () => {
  for (const title of ['title: Old # retained\n', 'title: |\n  First\n  Second\n', '']) {
    const source = `---\n${title}config:\n  theme: dark\n# untouched\n---\n%% leading comment\nzenuml\nA->B: hello`
    const parsed = parseRegisteredMermaid(source)
    if (!parsed.ok || parsed.value.body.kind !== 'zenuml') throw Error('Expected native Zen')
    expect(zenUMLMeaning(parseZenUML(serializeZenUML(parsed.value.body)))).toBe(zenUMLMeaning(parsed.value.body))
    const changed = mutateChecked(parsed.value, { kind: 'set_title', title: 'Changed title' })
    if (!changed.ok) throw Error(changed.error.message)
    const written = serializeMermaid(changed.value)
    expect(written.match(/^---$/gm)).toHaveLength(2)
    expect(written).toContain('config:\n  theme: dark\n# untouched')
    expect(written).toContain('%% leading comment')
    const cleared = mutateChecked(changed.value, { kind: 'set_title' })
    if (!cleared.ok || cleared.value.body.kind !== 'zenuml') throw Error('Expected native title removal')
    expect(cleared.value.body.title).toBeUndefined()
  }
  const aliased = parseRegisteredMermaid('---\ntitle: &shared Old\nconfig:\n  theme: dark\n  fontFamily: *shared\n---\nzenuml\nA->B: hello')
  if (!aliased.ok) throw Error('Expected source')
  const before = serializeMermaid(aliased.value)
  expect(mutateChecked(aliased.value, { kind: 'set_title', title: 'Changed' }).ok).toBe(false)
  expect(serializeMermaid(aliased.value)).toBe(before)
})

test('existing Checkout fixture keeps its authored semantics through canonical native reload', () => {
  const body = parseZenUML(readFileSync(join(import.meta.dir, 'testdata/zenuml-checkout.mmd'), 'utf8'))
  expect(body.unsupportedSource).toBeUndefined()
  const sequence = projectZenUMLSequence(body)
  expect(sequence.actors.map(a => a.id)).toEqual(['Buyer', 'API', 'Store'])
  expect(sequence.messages.map(m => [m.from, m.to, m.label])).toEqual([['Buyer', 'API', 'placeOrder()'], ['API', 'Store', 'reserve()'], ['API', 'Buyer', 'confirmation'], ['API', 'Buyer', 'unavailable'], ['API', 'Buyer', 'accepted']])
  validateZenUML(body, true)
  expect(zenUMLMeaning(parseZenUML(serializeZenUML(body)))).toBe(zenUMLMeaning(body))
})
