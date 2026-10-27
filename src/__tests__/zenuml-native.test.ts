import { expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseZenUML, type ZenUMLSourceObservation } from '../zenuml/native-parser.ts'
import { mutateZenUML, serializeZenUML, validateZenUML, zenUMLMeaning } from '../zenuml/native-body.ts'
import { projectZenUMLSequence } from '../zenuml/native-sequence.ts'
import { getSequenceBlockBoundaries, getSequenceBlockScope } from '../sequence/parser.ts'
import { preparedDisplayTextValue } from '../shared/display-text.ts'
import { checkMermaid, describeMermaid, describeMermaidFacts, describeMermaidTree, mutateChecked, parseRegisteredMermaid, serializeMermaid } from '../agent/core.ts'

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
    ['Buyer', 'API', 'checkout(order)', 'solid'], ['API', 'Stock', 'result = reserve(order)', 'solid'],
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

test('explicit callers, returns and assignments retain identities and actual direction', () => {
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

  const assignments = [
    { statement: 'T result = Store.read() { return data }', messages: [['API', 'Store', 'result:T = read()'], ['Store', 'API', 'data']] },
    { statement: 'result = Store.read() { if (ready) { return data } else { Store.wait() } }', messages: [['API', 'Store', 'result = read()'], ['Store', 'API', 'data'], ['Store', 'Store', 'wait()']] },
    { statement: 'outer = Store.read() { inner = Cache.load() { return cached } }', messages: [['API', 'Store', 'read()'], ['Store', 'Cache', 'inner = load()'], ['Cache', 'Store', 'cached'], ['Store', 'API', 'outer']] },
    { statement: 'T local = API.self() { return localData }', messages: [['API', 'API', 'local:T = self()'], ['API', 'API', 'localData']] },
    { statement: 'Token ticket = new Ticket(order) { return issued }', messages: [['API', 'ticket:Ticket', 'ticket:Token = «order»'], ['ticket:Ticket', 'API', 'issued']] },
    { statement: 'T result = Store.read() { Store-->API: data\n }', messages: [['API', 'Store', 'result:T = read()'], ['Store', 'API', 'data']] },
    { statement: 'result = Store.read() { Other-->Callback: notice\n }', messages: [['API', 'Store', 'read()'], ['Other', 'Callback', 'notice'], ['Store', 'API', 'result']] },
  ]
  for (const { statement, messages } of assignments) {
    const source = `zenuml\nClient->API.request() {\n ${statement}\n}`
    const parsed = parseRegisteredMermaid(source)
    if (!parsed.ok || parsed.value.body.kind !== 'zenuml') throw Error(`Expected native assignment: ${statement}`)
    const model = projectZenUMLSequence(parsed.value.body)
    expect(model.messages.map(m => [m.from, m.to, m.label])).toEqual([['Client', 'API', 'request()'], ...messages])
    expect(describeMermaidTree(parsed.value).edges.map(m => [m.from, m.to, m.label])).toEqual([['Client', 'API', 'request()'], ...messages])
    const reloaded = parseRegisteredMermaid(serializeMermaid(parsed.value))
    if (!reloaded.ok) throw Error('Expected canonical assignment')
    expect(describeMermaidFacts(reloaded.value)).toEqual(describeMermaidFacts(parsed.value))
  }
  const assigned = parseRegisteredMermaid('zenuml\nClient->API.request() {\n first = Store.read() { return data }\n}')
  if (!assigned.ok || assigned.value.body.kind !== 'zenuml') throw Error('Expected assigned call')
  const call = assigned.value.body.statements[0]
  if (call?.kind !== 'call' || call.children[0]?.kind !== 'call') throw Error('Expected nested assigned call')
  const changed = mutateChecked(assigned.value, { kind: 'set_statement', id: call.children[0].id, statement: { ...call.children[0], assignment: { name: 'second' } } })
  if (!changed.ok) throw Error('Expected checked assignment edit')
  expect(checkMermaid(changed.value, { include: describeMermaidFacts(assigned.value), exact: true }).ok).toBe(false)
  expect(describeMermaidTree(changed.value).edges.some(edge => edge.label === 'second = read()')).toBe(true)
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
    expect(written).not.toMatch(/^title /m)
    const reloaded = parseRegisteredMermaid(written)
    expect(reloaded.ok && reloaded.value.body.kind === 'zenuml' && reloaded.value.body.title).toBe('Changed title')
    expect(written).toContain('config:\n  theme: dark\n# untouched')
    expect(written).toContain('%% leading comment')
    const cleared = mutateChecked(changed.value, { kind: 'set_title' })
    if (!cleared.ok || cleared.value.body.kind !== 'zenuml') throw Error('Expected native title removal')
    expect(cleared.value.body.title).toBeUndefined()
  }
  const override = parseRegisteredMermaid('---\ntitle: &shared Old\nconfig:\n  fontFamily: *shared\n---\nzenuml\ntitle New\nA->B: hello')
  if (!override.ok) throw Error('Expected authored title override')
  for (const wrapper of ['verbatim', 'canonical'] as const) {
    const saved = serializeMermaid(override.value, { wrapper })
    const again = parseRegisteredMermaid(saved)
    expect(again.ok && again.value.body.kind === 'zenuml' && again.value.body.title).toBe('New')
    expect(again.ok && again.value.meta.frontmatter?.fontFamily).toBe('Old')
  }
  const renamed = mutateChecked(override.value, { kind: 'rename_participant', id: 'B', newId: 'C' })
  expect(renamed.ok).toBe(true)
  if (renamed.ok) {
    expect(serializeMermaid(renamed.value)).toContain('title: &shared Old')
    expect(serializeMermaid(renamed.value)).toContain('A->C: hello')
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

test('public Zen facts retain branch guards, membership, call ancestry and message kind', () => {
  const parse = (source: string) => {
    const result = parseRegisteredMermaid(source)
    if (!result.ok || result.value.body.kind !== 'zenuml') throw Error('Expected native Zen')
    return result.value
  }
  const source = 'zenuml\nClient->API.request() {\n if (ready) {\n  API.accept()\n } else {\n  API.reject()\n }\n}'
  const moved = 'zenuml\nClient->API.request() {\n if (ready) {\n  API.accept()\n  API.reject()\n } else {\n }\n}'
  const original = parse(source), changed = parse(moved), facts = describeMermaidFacts(original)
  expect(checkMermaid(changed, { include: facts, exact: true }).ok).toBe(false)
  expect(facts).toContain('fragment#statement:2 branch#1 else')
  expect(facts).toContain('message#statement:4 fragment#statement:2 branch#1')
  expect(describeMermaidFacts(changed)).toContain('message#statement:4 fragment#statement:2 branch#0')
  const guard = 'zenuml\nA->API.work() {\n if (ready) {\n } else if (backorder) {\n  API.wait()\n }\n}'
  expect(describeMermaidFacts(parse(guard))).not.toEqual(describeMermaidFacts(parse(guard.replace('backorder', 'unavailable'))))
  expect(describeMermaidFacts(parse('zenuml\nA->API.foo()'))).not.toEqual(describeMermaidFacts(parse('zenuml\nA->API: foo()')))
  const nested = parse('zenuml\nClient->API.request() {\n API->Store.write()\n}')
  const flat = parse('zenuml\nClient->API.request()\nAPI->Store.write()')
  expect(describeMermaidFacts(nested)).not.toEqual(describeMermaidFacts(flat))
  expect(describeMermaidFacts(nested)).toContain('message#statement:2 call-parent statement:1')
})

test('public Zen accessibility tree retains external calls and explicit branch context', () => {
  const parsed = parseRegisteredMermaid('zenuml\nAPI.request() {\n if (ready) {\n  Store.load()\n } else {\n  Store.wait()\n }\n}')
  if (!parsed.ok) throw Error('Expected source')
  const tree = describeMermaidTree(parsed.value)
  expect(tree.edges.map(edge => edge.label)).toEqual(['request()', 'load()', 'wait()'])
  expect(tree.nodes.filter(node => !node.external).map(node => node.id)).toEqual(['API', 'Store'])
  const outside = tree.nodes.find(node => node.external)!
  expect(outside).toBeDefined()
  expect(tree.edges[0]!.from).toBe(outside.id)
  expect(tree.edges[1]!.zenuml?.scopes.at(-1)?.branchIndex).toBe(0)
  expect(tree.edges[2]!.zenuml?.scopes.at(-1)?.branchIndex).toBe(1)

  const noted = (title: string, text: string, alternate = false) => {
    const result = parseRegisteredMermaid(`zenuml
title ${title}
@Actor "statement:1" as Visitor
@Database Store
API.request() {
 if (ready) {
 ${alternate ? '' : `// ${text}`}
 } else {
 ${alternate ? `// ${text}` : ''}
 }
 Store.load()
}`)
    if (!result.ok) throw Error('Expected note-only branch source')
    return result.value
  }
  const first = noted('First', 'first **note**'), second = noted('Second', 'second **note**'), moved = noted('First', 'first **note**', true)
  const firstFacts = describeMermaidFacts(first), firstTree = describeMermaidTree(first)
  expect(firstFacts).toContain('title "First"')
  expect(firstFacts).toContain('participant Store type database')
  expect(firstFacts).toContain('note#statement:4 over "API" after-index 0 : first note')
  expect(firstFacts).toContain('note#statement:4 call-parent statement:2')
  expect(firstFacts).toContain('note#statement:4 fragment#statement:3 branch#0')
  expect(firstFacts).not.toEqual(describeMermaidFacts(second))
  expect(firstFacts).not.toEqual(describeMermaidFacts(moved))
  expect(checkMermaid(moved, { include: firstFacts, exact: true }).ok).toBe(false)
  expect(firstTree.title).toBe('First')
  expect(describeMermaid(first)).toContain('"First"')
  expect(firstTree).not.toEqual(describeMermaidTree(second))
  const note = firstTree.nodes.find(node => node.zenuml?.kind === 'note')!
  expect(note).toMatchObject({ id: 'statement:4', label: 'first note', parentId: 'statement:3', zenuml: {
    kind: 'note', sourceId: 'statement:4', actorIds: ['API'], position: 'over', afterIndex: 0, callAncestors: ['statement:2'],
    scopes: [{ fragmentId: 'statement:3', fragmentIndex: 0, type: 'if', branchIndex: 0, branchKind: 'body', condition: 'ready' }],
  } })
  expect(describeMermaidTree(moved).nodes.find(node => node.zenuml?.kind === 'note')).toMatchObject({ zenuml: { scopes: [{ branchIndex: 1, branchKind: 'else' }] } })
  expect(firstTree.nodes.find(node => node.id === 'Store')).toMatchObject({ zenuml: { kind: 'participant', type: 'database' } })
  expect(firstTree.nodes.filter(node => node.zenuml?.kind === 'participant').map(node => node.id)).toEqual(['statement:1', 'Store', 'API'])
  expect(new Set(firstTree.nodes.map(node => node.id)).size).toBe(firstTree.nodes.length)
  expect(firstTree.edges.map(edge => [edge.from, edge.to])).toEqual([[firstTree.nodes.find(node => node.external)!.id, 'API'], ['API', 'Store']])
})
