import { describe, expect, test } from 'bun:test'
import { asEventModeling, asZenUml, buildMermaid, describeMermaidFacts, describeMermaidTree, layoutMermaid, mutate, parseRegisteredMermaid, renderMermaidASCII, renderMermaidASCIIWithMeta, renderMermaidSVG, serializeMermaid, verifyMermaid } from '../agent/core.ts'
import { parseEventModeling, eventModelingRelations } from '../eventmodeling/parser.ts'
import { parseZenUml } from '../zenuml/parser.ts'
import { projectZenUmlSequence } from '../zenuml/projection.ts'
import { renderMermaidSVGAsync } from '../browser-lazy.ts'
import { renderMermaidPNG } from '../agent/index.ts'

const eventSource = 'eventmodeling\ntf 01 ui CartUI\ntf 02 cmd AddItem\ntf 03 evt ItemAdded'
const zenSource = 'zenuml\nAlice->John: Hello John, how are you?\nJohn->Alice: Great!'
function parsed(source: string) { const result = parseRegisteredMermaid(source); if (!result.ok) throw Error(JSON.stringify(result.error)); return result.value }

describe('native Event Modeling', () => {
  test('fractional chalkboard text metrics preserve disjoint adjacent lane boundaries', () => {
    const options = { style: 'chalkboard' }
    expect(() => renderMermaidSVG(eventSource, options)).not.toThrow()
    const groups = layoutMermaid(parsed(eventSource), options).groups.sort((a, b) => a.y - b.y)
    expect(groups).toHaveLength(3)
    for (let index = 1; index < groups.length; index++) expect(groups[index - 1]!.y + groups[index - 1]!.h).toBeLessThanOrEqual(groups[index]!.y)
  })
  test('retains frame IDs and directed information flow in model, actual layout and output', () => {
    const diagram = parsed(eventSource), native = asEventModeling(diagram)
    expect(native?.body.frames.map(frame => [frame.id, frame.entityType, frame.entity])).toEqual([['01', 'ui', 'CartUI'], ['02', 'command', 'AddItem'], ['03', 'event', 'ItemAdded']])
    expect(eventModelingRelations(native!.body).map(edge => [edge.from, edge.to, edge.inferred])).toEqual([['01', '02', true], ['02', '03', true]])
    const layout = layoutMermaid(diagram)
    expect(layout.nodes.map(node => node.id)).toEqual(['01', '02', '03'])
    expect(layout.edges.map(edge => [edge.from, edge.to])).toEqual([['01', '02'], ['02', '03']])
    expect(layout.edges.every(edge => edge.path.length >= 2)).toBe(true)
    for (const output of [renderMermaidSVG(eventSource), renderMermaidASCII(eventSource)]) for (const label of ['CartUI', 'AddItem', 'ItemAdded']) expect(output).toContain(label)
    expect(verifyMermaid(eventSource).ok).toBe(true)
  })
  test('reset breaks inference while retaining explicit sources and distinct namespace re-entry', () => {
    const body = parseEventModeling('eventmodeling\ntf 01 evt Commerce.Inventory.Changed\ntf 02 ui Shop.Other\nrf 03 rmo Commerce.Inventory.View ->> 01\ntf 04 evt Commerce.Inventory.Updated')
    expect(eventModelingRelations(body).map(edge => [edge.from, edge.to])).toEqual([['01', '02'], ['01', '03'], ['03', '04']])
    const layout = layoutMermaid(parsed('eventmodeling\ntf 01 evt Commerce.Inventory.Changed\ntf 02 ui Shop.Other\nrf 03 rmo Commerce.Inventory.View ->> 01\ntf 04 evt Commerce.Inventory.Updated'))
    expect(layout.groups.map(group => group.id)).toEqual(['lane:Commerce.Inventory · Events', 'lane:Shop · UI / Automation', 'lane:Commerce.Inventory · Command / Read Model'])
    expect(layout.groups[0]?.members).toEqual(['01', '04'])
  })
  test('preserves complete inline/referenced data, notes and Given/When/Then ownership through writes', () => {
    const source = 'eventmodeling\nentity Cart\nentity AddItem\nentity Added\ntimeframe 01 command AddItem { description: string }\nresetframe 02 event Added [[Payload]] ->> 01\ndata Payload `json`{\n"price": 20.4\n}\nnote 02 {\nKeep the final character!\n}\ngwt 02 given readmodel Cart\nwhen command AddItem\nthen event Added'
    // References precede inline data in the pinned language.
    const valid = source.replace('Added [[Payload]] ->> 01', 'Added ->> 01 [[Payload]]')
    const diagram = parsed(valid), body = asEventModeling(diagram)!.body
    expect(body.frames[0]?.data?.text).toBe(' description: string ')
    expect(body.data[0]?.value).toEqual({ type: 'json', text: '"price": 20.4' })
    expect(body.notes).toEqual([{ frame: '02', text: 'Keep the final character!' }])
    expect(body.specifications[0]).toEqual({ frame: '02', given: [{ entityType: 'readmodel', entity: 'Cart' }], when: [{ entityType: 'command', entity: 'AddItem' }], then: [{ entityType: 'event', entity: 'Added' }] })
    expect(asEventModeling(parsed(serializeMermaid(diagram)))?.body).toEqual(body)
    for (const output of [renderMermaidSVG(valid), renderMermaidASCII(valid)]) { expect(output).toContain('string'); expect(output).toContain('20.4'); expect(output).toContain('final character!') }
    const withoutWhen = valid.replace('\nwhen command AddItem', '')
    expect(renderMermaidSVG(withoutWhen)).toContain('when:')
    const terminal = renderMermaidASCII(withoutWhen)
    expect(terminal).not.toContain('when:')
    expect(terminal).toContain('given: readmodel Cart')
    expect(terminal).toContain('then: event Added')
  })
  test('domain edits are atomic and refuse dangling references or duplicate frame IDs', () => {
    const diagram = asEventModeling(parsed(eventSource))!, before = serializeMermaid(diagram)
    const changed = mutate(diagram, { kind: 'set_frame_entity', id: '02', entity: 'AddBook' })
    expect(changed.ok && describeMermaidFacts(changed.value)).toContain('frame 02 time command "AddBook"')
    expect(mutate(diagram, { kind: 'add_frame', id: '01', entityType: 'event', entity: 'Other' }).ok).toBe(false)
    expect(serializeMermaid(diagram)).toBe(before)
    expect(parseRegisteredMermaid('eventmodeling\ntf 01 ui A\ntf 01 evt B').ok).toBe(false)
    expect(asEventModeling(parsed(eventSource))?.body.frames).toHaveLength(3)
    const built = buildMermaid('eventmodeling', [{ kind: 'add_frame', id: '1', entityType: 'ui', entity: 'Cart' }, { kind: 'add_frame', id: '2', entityType: 'command', entity: 'Add' }])
    expect(built.ok && built.value.body.frames.map(frame => frame.id)).toEqual(['1', '2'])
  })
})

describe('native ZenUML', () => {
  test('visible participant declarations are verifiable while an actorless document is empty', () => {
    const source = 'zenuml\nClient\nAPI'
    expect(verifyMermaid(source).ok).toBe(true)
    expect(layoutMermaid(parsed(source)).nodes.map(node => node.id)).toEqual(['Client', 'API'])
    expect(verifyMermaid('zenuml').warnings).toContainEqual({ code: 'EMPTY_DIAGRAM' })
    expect(verifyMermaid('zenuml\n// no following interaction').warnings).toContainEqual({ code: 'EMPTY_DIAGRAM' })
  })
  test('keeps aliases, annotation glyphs and directed message ownership in public APIs', () => {
    const source = 'zenuml\ntitle Conversation\n@Actor A as Alice\n@Database J as John\nA->J: Hello John, how are you?\nJ->A: Great!'
    const diagram = parsed(source), body = asZenUml(diagram)!.body
    expect(body.participants).toEqual([{ id: 'A', label: 'Alice', type: 'actor' }, { id: 'J', label: 'John', type: 'database' }])
    expect(projectZenUmlSequence(body).messages.map(message => [message.from, message.to, message.label])).toEqual([['A', 'J', 'Hello John, how are you?'], ['J', 'A', 'Great!']])
    const layout = layoutMermaid(diagram)
    expect(layout.edges.map(edge => [edge.from, edge.to])).toEqual([['A', 'J'], ['J', 'A']])
    for (const output of [renderMermaidSVG(source), renderMermaidASCII(source)]) for (const label of ['Alice', 'John', 'Great!']) expect(output).toContain(label)
    expect(asZenUml(parsed(serializeMermaid(diagram)))?.body).toEqual(body)
    expect(verifyMermaid(source).ok).toBe(true)
  })
  test('projects nested calls and returns from their actual scope, including self calls', () => {
    const source = 'zenuml\nClient->API.checkout() {\n  Inventory.reserve() {\n    Inventory.confirm()\n    return reservation\n  }\n  return receipt\n}'
    const body = parseZenUml(source), projection = projectZenUmlSequence(body)
    expect(projection.messages.map(message => [message.from, message.to, message.label])).toEqual([['Client', 'API', 'checkout()'], ['API', 'Inventory', 'reserve()'], ['Inventory', 'Inventory', 'confirm()'], ['Inventory', 'API', 'reservation'], ['API', 'Client', 'receipt']])
    expect(projection.messages.filter(message => message.lineStyle === 'dashed')).toHaveLength(2)
    expect(verifyMermaid(source).ok).toBe(true)
    const native = asZenUml(parsed(source))!, edited = mutate(native, { kind: 'rename_participant', from: 'Inventory', to: 'Stock' })
    expect(edited.ok && projectZenUmlSequence(edited.value.body).messages.map(message => [message.from, message.to])).toEqual([['Client', 'API'], ['API', 'Stock'], ['Stock', 'Stock'], ['Stock', 'API'], ['API', 'Client']])
    expect(native.body.participants.map(item => item.id)).toContain('Inventory')
  })
  test('retains ordered loop, conditional, parallel and exception branches', () => {
    const source = 'zenuml\nwhile(active) {\n Alice->Bob: ping\n}\nif(sick) {\n Bob->Alice: Not so good :(\n} else {\n Bob->Alice: Fine\n}\npar {\n Alice->Bob: first\n Alice->John: second\n}\ntry {\n API->DB: write\n} catch {\n API->Client: failed\n} finally {\n API->DB: rollback\n}'
    const body = parseZenUml(source), projection = projectZenUmlSequence(body)
    expect(projection.blocks.map(block => block.type)).toEqual(['loop', 'alt', 'par', 'critical'])
    expect(projection.messages.map(message => message.label)).toEqual(['ping', 'Not so good :(', 'Fine', 'first', 'second', 'write', 'failed', 'rollback'])
    expect(projection.blocks[1]?.dividers.map(divider => divider.label)).toEqual(['else'])
    expect(projection.blocks[3]?.dividers.map(divider => divider.label)).toEqual(['catch', 'finally'])
    expect(asZenUml(parsed(serializeMermaid(parsed(source))))?.body).toEqual(body)
    expect(verifyMermaid(source).ok).toBe(true)
  })
  test.each([false, true])('terminal regions retain conditions and their actual owned frames (ASCII=%s)', useAscii => {
    const source = 'zenuml\nClient->API.ship() {\n while(pending) {\n  Queue.process()\n }\n if(ready) {\n  API->Client: done\n } else {\n  API->Client: waiting\n }\n}'
    const result = renderMermaidASCIIWithMeta(source, { useAscii, colorMode: 'none' })
    for (const label of ['pending', 'ready', 'process()', 'done', 'waiting', 'else']) expect(result.ascii).toContain(label)
    const regions = result.regions.filter(region => region.kind === 'compartment')
    expect(regions).toHaveLength(2)
    const loop = regions.find(region => region.projectedText === 'loop [pending]')!, alt = regions.find(region => region.projectedText === 'alt [ready]')!
    for (const region of regions) expect(region.ownedCellSpans?.length ?? 0).toBeGreaterThan(0)
    expect(result.regions.find(region => region.projectedText === 'process()')?.parentId).toBe(loop.id)
    expect(result.regions.find(region => region.projectedText === 'done')?.parentId).toBe(alt.id)
    expect(result.regions.find(region => region.projectedText === 'waiting')?.parentId).toBe(alt.id)
    expect(result.warnings.filter(warning => !['TERMINAL_CONNECTOR_DECLARED_LIMITATION', 'TERMINAL_CONNECTOR_PROJECTED'].includes(warning.code))).toEqual([])
  })
  test.each([false, true])('nested empty regions and notes preserve lexical parents at one message cursor (ASCII=%s)', useAscii => {
    const source = 'zenuml\nClient\nAPI\nif(outer) {\n if(inner) {}\n // parent note\n if(second) {}\n} else {\n // branch note\n Client->API: fallback\n}\n// outside note\nClient->API: joined'
    const result = renderMermaidASCIIWithMeta(source, { useAscii, colorMode: 'none' })
    const region = (text: string) => result.regions.find(item => item.projectedText === text)!
    for (const label of ['outer', 'inner', 'second', 'parent note', 'branch note', 'outside note', 'fallback', 'joined']) expect(result.ascii).toContain(label)
    const outer = region('alt [outer]'), inner = region('alt [inner]'), second = region('alt [second]')
    expect(result.regions.filter(item => item.kind === 'compartment')).toHaveLength(3)
    for (const child of [inner, second, region('parent note'), region('branch note'), region('fallback')]) expect(child.parentId).toBe(outer.id)
    expect(region('outside note').parentId).toBeUndefined()
    expect(region('joined').parentId).toBeUndefined()
    expect(inner.canvasRow).toBeLessThan(region('parent note').canvasRow)
    expect(region('parent note').canvasRow).toBeLessThan(second.canvasRow)
    expect(second.canvasRow).toBeLessThan(region('branch note').canvasRow)
    expect(region('branch note').canvasRow).toBeLessThan(region('outside note').canvasRow)
    expect(result.warnings.filter(warning => !['TERMINAL_CONNECTOR_DECLARED_LIMITATION', 'TERMINAL_CONNECTOR_PROJECTED'].includes(warning.code))).toEqual([])
  })
  test('parallel comments stay with their actual branches inside exception regions', () => {
    const source = 'zenuml\nClient\nAPI\nDB\ntry {\n par {\n  // first note\n  Client->API: first\n  // second note\n  Client->DB: second\n }\n} catch(error) {\n if(recover) {}\n // catch note\n API->Client: recovered\n} finally {\n API->DB: cleanup\n}'
    const result = renderMermaidASCIIWithMeta(source, { colorMode: 'none' })
    const region = (text: string) => result.regions.find(item => item.projectedText === text)!
    for (const label of ['first note', 'second note', 'catch note', 'recover', 'catch(error)', 'finally', 'recovered', 'cleanup']) expect(result.ascii).toContain(label)
    expect(result.regions.filter(item => item.kind === 'compartment')).toHaveLength(3)
    const parallel = region('par'), critical = region('critical')
    expect(parallel.parentId).toBe(critical.id)
    expect(region('alt [recover]').parentId).toBe(critical.id)
    for (const label of ['first note', 'second note', 'first', 'second']) expect(region(label).parentId).toBe(parallel.id)
    expect(region('catch note').parentId).toBe(critical.id)
    expect(region('first note').canvasRow).toBeLessThan(region('first').canvasRow)
    expect(region('first').canvasRow).toBeLessThan(region('second note').canvasRow)
    expect(region('second note').canvasRow).toBeLessThan(region('second').canvasRow)
    const svg = renderMermaidSVG(source)
    for (const label of ['first note', 'second note', 'catch note', 'recover', 'catch(error)', 'finally']) expect(svg).toContain(label)
    expect(result.warnings.filter(warning => !['TERMINAL_CONNECTOR_DECLARED_LIMITATION', 'TERMINAL_CONNECTOR_PROJECTED'].includes(warning.code))).toEqual([])
  })
  test('creation, replies, comments and failed edits retain their meaning', () => {
    const source = 'zenuml\nClient\nnew API() {\n // keep this comment above the call\n Client->API: start\n}\n@return\nAPI->Client: ready'
    const body = asZenUml(parsed(source))!.body, projection = projectZenUmlSequence(body)
    expect(projection.actors.find(actor => actor.id === 'API')?.createMessageIndex).toBe(0)
    expect(projection.messages.at(-1)).toMatchObject({ from: 'API', to: 'Client', lineStyle: 'dashed', label: 'ready' })
    expect(projection.notes.map(note => note.text)).toEqual(['keep this comment above the call'])
    const diagram = asZenUml(parsed(zenSource))!, before = serializeMermaid(diagram)
    expect(mutate(diagram, { kind: 'rename_participant', from: 'Alice', to: 'John' }).ok).toBe(false)
    expect(serializeMermaid(diagram)).toBe(before)
    expect(parseRegisteredMermaid('zenuml\nA.method() {\nB.method()').ok).toBe(false)
    expect(verifyMermaid(zenSource).ok).toBe(true)
  })
})

test('both native families execute focused browser SVG and actual PNG entry points', async () => {
  for (const source of [eventSource, zenSource]) {
    expect(await renderMermaidSVGAsync(source, { embedFontImport: false })).toContain('<svg')
    const result = await renderMermaidPNG(source)
    const bytes = result
    expect(Array.from(bytes.slice(0, 8))).toEqual([137, 80, 78, 71, 13, 10, 26, 10])
    expect(bytes.length).toBeGreaterThan(1000)
  }
})

describe('native family write and scope boundaries', () => {
  test('Event Modeling typed writes cannot introduce unrelated grammar statements', () => {
    const diagram = asEventModeling(parsed(eventSource))!, before = serializeMermaid(diagram)
    const refused = [
      { kind: 'add_entity', entity: 'Thing\ntf 99 evt Injected' },
      { kind: 'add_note', frame: '01', text: '}\ntf 99 evt Injected\nnote 01 {' },
      { kind: 'set_data', id: 'Payload', text: '}\ntf 99 evt Injected\ndata Other {' },
      { kind: 'add_frame', id: '99\n', entityType: 'ui', entity: 'Injected' },
    ]
    for (const op of refused) { expect(mutate(diagram, op as never).ok).toBe(false); expect(serializeMermaid(diagram)).toBe(before) }
    const changed = mutate(diagram, { kind: 'set_title', title: 'A // B %% C #35;' })
    expect(changed.ok && changed.value.body.title).toBe('A // B %% C #35;')
    expect(changed.ok && changed.value.body.frames.map(frame => frame.id)).toEqual(['01', '02', '03'])
    const note = mutate(diagram, { kind: 'add_note', frame: '01', text: 'Literal { braces } and // text' })
    expect(note.ok && note.value.body.notes).toEqual([{ frame: '01', text: 'Literal { braces } and // text' }])
  })
  test('Event Modeling self references remain explicit and cascade removal never invents predecessors', () => {
    const self = asEventModeling(parsed('eventmodeling\ntf 01 evt Again ->> 01'))!
    expect(eventModelingRelations(self.body).map(edge => [edge.from, edge.to])).toEqual([['01', '01']])
    expect(layoutMermaid(self).edges[0]?.path.length).toBeGreaterThanOrEqual(4)
    expect(renderMermaidSVG(self)).toContain('<svg')
    const source = 'eventmodeling\nrf 01 evt Added\nrf 02 ui Other\ntf 03 rmo View ->> 01'
    const changed = mutate(asEventModeling(parsed(source))!, { kind: 'remove_frame', id: '01', cascade: true })
    expect(changed.ok && eventModelingRelations(changed.value.body)).toEqual([])
    expect(changed.ok && changed.value.body.frames.find(frame => frame.id === '03')?.reset).toBe(true)
  })
  test('Event Modeling frame rename and specifications preserve every owned reference', () => {
    const built = buildMermaid('eventmodeling', [
      { kind: 'add_entity', entity: 'Added' },
      { kind: 'add_entity', entity: 'Cart' },
      { kind: 'add_frame', id: '1', entity: 'Added', entityType: 'event' },
      { kind: 'add_frame', id: '2', entity: 'Cart', entityType: 'readmodel', sources: ['1'] },
      { kind: 'set_specification', frame: '2', given: [{ entityType: 'event', entity: 'Added' }], then: [{ entityType: 'readmodel', entity: 'Cart' }] },
      { kind: 'add_note', frame: '2', text: 'Retain ownership' },
      { kind: 'rename_frame', from: '2', to: '20' },
    ])
    expect(built.ok).toBe(true)
    if (!built.ok) throw Error(built.error.message)
    expect(built.value.body.specifications[0]?.frame).toBe('20')
    expect(built.value.body.notes[0]?.frame).toBe('20')
    expect(eventModelingRelations(built.value.body).map(edge => [edge.from, edge.to])).toEqual([['1', '20']])
    expect(asEventModeling(parsed(serializeMermaid(built.value)))?.body).toEqual(built.value.body)
  })
  test('ZenUML raw text and escaped call parameters survive actual serialization and layout', () => {
    for (const source of ['zenuml\ntitle Demo {scope}\nA->B: payload {id: 7}', String.raw`zenuml
Client->API.call("C:\\")`]) {
      const diagram = parsed(source), saved = serializeMermaid(diagram)
      expect(asZenUml(parsed(saved))?.body).toEqual(asZenUml(diagram)?.body)
      expect(layoutMermaid(diagram).edges.length).toBeGreaterThan(0)
      expect(renderMermaidSVG(diagram)).toContain('<svg')
    }
  })
  test('ZenUML reply annotations cannot cross call or control-region boundaries', () => {
    for (const source of ['zenuml\nClient->API.call() {\n @return\n}\nOther->Cache: ping', 'zenuml\nif(active) {\n @reply\n}\nOther->Cache: ping']) expect(parseRegisteredMermaid(source).ok).toBe(false)
    const inline = asZenUml(parsed('zenuml\nClient->API.call() { return receipt }'))!
    expect(projectZenUmlSequence(inline.body).messages.map(message => [message.from, message.to, message.label])).toEqual([['Client', 'API', 'call()'], ['API', 'Client', 'receipt']])
  })
  test('ZenUML creation renames preserve dollar identifiers and exact recipient identity', () => {
    const original = asZenUml(parsed('zenuml\nnew $DB()'))!, changed = mutate(original, { kind: 'rename_participant', from: '$DB', to: 'Store' })
    expect(changed.ok).toBe(true)
    if (!changed.ok) throw Error(changed.error.message)
    expect(changed.value.body.participants.map(actor => actor.id)).toEqual(['Store'])
    expect(projectZenUmlSequence(changed.value.body).messages.map(message => message.to)).toEqual(['Store'])
    expect(serializeMermaid(changed.value)).toContain('new Store()')
    expect(serializeMermaid(original)).toContain('new $DB()')
  })
  test('ZenUML multiline comments retain every line and async heads differ from synchronous calls', () => {
    const source = 'zenuml\nClient->API.call() {\n // First line\n // Second line\n API->Store: notify\n}'
    const body = asZenUml(parsed(source))!.body, sequence = projectZenUmlSequence(body)
    expect(sequence.notes.map(note => note.text)).toEqual(['First line\nSecond line'])
    expect(sequence.messages.map(message => message.endHead)).toEqual(['filled', 'open'])
    expect(asZenUml(parsed(serializeMermaid(parsed(source))))?.body).toEqual(body)
  })
  test('both new families preserve unknown future syntax as opaque source and refuse structured edits', () => {
    for (const source of ['eventmodeling\nfuture_statement retained { bytes }\n', 'zenuml\n@FutureActor A\nA->B: retained\n']) {
      const diagram = parsed(source)
      expect(diagram.body.kind).toBe('opaque')
      expect(serializeMermaid(diagram)).toBe(source)
      expect(mutate(diagram, { kind: 'set_title', title: 'Changed' }).ok).toBe(false)
      expect(() => renderMermaidSVG(diagram)).toThrow()
    }
  })
})


test('native accessibility trees resolve every parent and endpoint, including implied lanes and callers', () => {
  for (const source of [eventSource, 'zenuml\nAPI.call()']) {
    const tree = describeMermaidTree(parsed(source)), ids = new Set(tree.nodes.map(node => node.id))
    for (const node of tree.nodes) if (node.parentId) expect(ids.has(node.parentId)).toBe(true)
    for (const edge of tree.edges) { expect(ids.has(edge.from)).toBe(true); expect(ids.has(edge.to)).toBe(true) }
  }
})


test('ZenUML keyword prefixes remain participant identities at root and nested call boundaries', () => {
  for (const id of ['ifService', 'format', 'tryClient', 'parallel', 'loopback', 'optional', 'else']) {
    for (const source of [`zenuml\n${id}.work() { return item }`, `zenuml\nClient->API.run() {\n ${id}.work() {\n  return item\n }\n}`]) {
      const diagram = asZenUml(parsed(source))!, sequence = projectZenUmlSequence(diagram.body)
      expect(diagram.body.participants.map(actor => actor.id)).toContain(id)
      expect(sequence.messages.filter(message => message.to === id && message.label === 'work()')).toHaveLength(1)
      expect(sequence.blocks).toHaveLength(0)
      expect(asZenUml(parsed(serializeMermaid(diagram)))?.body).toEqual(diagram.body)
    }
  }
})


test('ZenUML scoped builders retain nested edits and assignment replies without duplicating returns', () => {
  const built = buildMermaid('zenuml', [
    { kind: 'add_participant', id: 'Client' }, { kind: 'add_participant', id: 'API' }, { kind: 'add_participant', id: 'Store' },
    { kind: 'add_call', from: 'Client', to: 'API', method: 'load()', assignment: 'answer', assignmentType: 'Result' },
    { kind: 'add_region', parentId: 'statement:0', regionType: 'loop', label: 'active' },
    { kind: 'add_message', parentId: 'statement:1', from: 'API', to: 'Store', text: 'refresh' },
    { kind: 'add_return', parentId: 'statement:0', text: 'payload' },
    { kind: 'rename_participant', from: 'Store', to: 'Cache' },
  ])
  expect(built.ok).toBe(true)
  if (!built.ok) throw Error(built.error.message)
  const messages = projectZenUmlSequence(built.value.body).messages
  expect(messages.map(message => [message.from, message.to, message.label])).toEqual([['Client', 'API', 'load()'], ['API', 'Cache', 'refresh'], ['API', 'Client', 'Result answer = payload']])
  expect(asZenUml(parsed(serializeMermaid(built.value)))?.body).toEqual(built.value.body)
})

test('a ZenUML text edit cannot redirect a creation to a different receiver', () => {
  const diagram = asZenUml(parsed('zenuml\nnew $DB()'))!, before = serializeMermaid(diagram)
  expect(mutate(diagram, { kind: 'set_message_text', id: 'statement:0', text: 'new Other()' }).ok).toBe(false)
  expect(serializeMermaid(diagram)).toBe(before)
  const changed = mutate(diagram, { kind: 'set_message_text', id: 'statement:0', text: 'new $DB(1)' })
  expect(changed.ok && changed.value.body.participants.map(actor => actor.id)).toEqual(['$DB'])
  expect(changed.ok && projectZenUmlSequence(changed.value.body).messages[0]?.to).toBe('$DB')
})


test('Event Modeling note and data types survive round trips and independent text edits', () => {
  const source = 'eventmodeling\ntf 01 ui Screen [[Payload]] `json`{ productId: 7 }\ndata Payload `text`{\nInitial\n}\nnote 01 `md`{\n**Important**\n}'
  const diagram = asEventModeling(parsed(source))!
  expect(diagram.body.notes).toEqual([{ frame: '01', text: '**Important**', type: 'md' }])
  expect(asEventModeling(parsed(serializeMermaid(diagram)))?.body).toEqual(diagram.body)
  const note = mutate(diagram, { kind: 'set_note', index: 0, text: '**Updated**' })
  expect(note.ok && note.value.body.notes[0]).toEqual({ frame: '01', text: '**Updated**', type: 'md' })
  const data = mutate(diagram, { kind: 'set_data', id: 'Payload', text: 'Updated' })
  expect(data.ok && data.value.body.data[0]?.value).toEqual({ text: 'Updated', type: 'text' })
  const inline = mutate(diagram, { kind: 'set_frame_data', id: '01', text: ' productId: 8 ' })
  expect(inline.ok && inline.value.body.frames[0]).toMatchObject({ dataReference: 'Payload', data: { type: 'json', text: ' productId: 8 ' } })
})


test('Event Modeling emitted Scene ownership and group styles agree with its public lane model', () => {
  const svg = renderMermaidSVG(eventSource, { style: { roles: { group: { fontSize: 24, textColor: '#0055aa', borderColor: '#334455', fillColor: '#f3f4f6' } } } })
  const document: Document = new (require('jsdom').JSDOM)(svg, { contentType: 'image/svg+xml' }).window.document
  for (const [frame, lane] of [['01', 'lane:UI / Automation'], ['02', 'lane:Command / Read Model'], ['03', 'lane:Events']]) {
    const node = document.querySelector(`[data-id="${frame}"][data-role="node"]`)
    expect(node?.parentElement?.getAttribute('data-id')).toBe(lane)
    const frameBox = node?.querySelector('rect')
    const laneBox = node?.parentElement?.querySelector(':scope > rect')
    expect(laneBox?.getAttribute('stroke')).toBe('#334455')
    expect(laneBox?.getAttribute('fill')).toBe('#f3f4f6')
    expect(Number(frameBox?.getAttribute('y'))).toBeGreaterThanOrEqual(Number(laneBox?.getAttribute('y')))
  }
  expect([...document.querySelectorAll('[data-role="edge"]')].map(edge => [edge.getAttribute('data-from'), edge.getAttribute('data-to')])).toEqual([['01', '02'], ['02', '03']])
})
