/**
 * Sequence `create participant` / `destroy` — family-elevation-plan §Sequence
 * item 4 (feature stage). Upstream semantics
 * (https://mermaid.js.org/syntax/sequenceDiagram.html §Actor creation and
 * destruction): a `create` directive binds the participant's appearance to the
 * next message it receives (aliases supported); `destroy` ends the lifeline at
 * the next message the actor sends or receives, drawn as an X cross.
 */
import { describe, it, expect } from 'bun:test'
import { parseSequenceDiagram } from '../sequence/parser.ts'
import { layoutSequenceDiagram } from '../sequence/layout.ts'
import { renderMermaidSVG, renderMermaidSVGWithReceipt } from '../index.ts'

function parse(text: string) {
  const lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 0 && !l.startsWith('%%'))
  return parseSequenceDiagram(lines)
}

const SRC = `sequenceDiagram
  participant A as Alice
  participant B as Bob
  A->>B: start
  create actor D as Donald
  A->>D: welcome
  D-->>A: thanks
  destroy D
  A-xD: goodbye
  A->>B: done`

describe('parseSequenceDiagram – create/destroy', () => {
  it('binds creation only to the next inbound message for that actor', () => {
    const d = parse(`sequenceDiagram
  participant A
  create participant C
  C->>A: outgoing
  A->>C: received`)
    expect(d.actors.find(actor => actor.id === 'C')?.createMessageIndex).toBe(1)
  })

  it('binds creation to the next message and respects the alias', () => {
    const d = parse(SRC)
    const donald = d.actors.find(a => a.id === 'D')!
    expect(donald).toBeDefined()
    expect(donald.label).toBe('Donald')
    expect(donald.type).toBe('actor')
    expect(donald.createMessageIndex).toBe(1) // "A->>D: welcome"
  })

  it('binds destruction to the next message involving the actor', () => {
    const d = parse(SRC)
    const donald = d.actors.find(a => a.id === 'D')!
    expect(donald.destroyMessageIndex).toBe(3) // "A-xD: goodbye"
  })

  it('create participant (box form) works too', () => {
    const d = parse(`sequenceDiagram
      A->>B: hi
      create participant C
      A->>C: spawn`)
    const c = d.actors.find(a => a.id === 'C')!
    expect(c.type).toBe('participant')
    expect(c.label).toBe('C')
    expect(c.createMessageIndex).toBe(1)
  })

  // A directive binds to the next message that involves its participant;
  // one no later message involves binds where its stack ends, at the message
  // right after it, as Mermaid binds every directive of a stack.
  it.each([
    ['stacked destroys at a message from the last', 'participant Alice\nparticipant Bob\nparticipant Carl\nAlice->>Carl: hi\ndestroy Carl\ndestroy Bob\nBob->>Alice: bye', { destroy: { Carl: 1, Bob: 1 } }],
    ['stacked creates at a message to the last', 'participant A\ncreate participant X\ncreate participant Y\nA->>Y: make\nY->>A: ok', { create: { X: 0, Y: 0 } }],
    ['a stacked create and destroy', 'A->>B: hi\ncreate participant Y\ndestroy A\nB->>Y: make', { create: { Y: 1 }, destroy: { A: 1 } }],
    ['a stacked destroy whose participant has a later message', 'A->>B: hi\nA->>C: hey\ndestroy C\ndestroy B\nB->>A: bye\nC->>A: later', { destroy: { B: 2, C: 3 } }],
    ['a stacked create whose participant receives a later message', 'participant A\ncreate participant X\ncreate participant Y\nA->>Y: make\nA->>X: later', { create: { X: 1, Y: 0 } }],
    ['a lone destroy no later message involves', 'A->>B: hi\nA->>C: hey\ndestroy C\nA->>B: bye', { destroy: { C: 2 } }],
    ['a create of a participant that already exists', 'A->>X: early\ncreate participant X\nA->>X: later', {}],
  ] as const)('binds %s', (_name, body, expected: { create?: Record<string, number>; destroy?: Record<string, number> }) => {
    const d = parse(`sequenceDiagram\n${body}`)
    const at = (key: 'createMessageIndex' | 'destroyMessageIndex') => Object.fromEntries(d.actors.flatMap(actor => actor[key] === undefined ? [] : [[actor.id, actor[key]]]))
    expect(at('createMessageIndex')).toEqual(expected.create ?? {})
    expect(at('destroyMessageIndex')).toEqual(expected.destroy ?? {})
  })

  it('create/destroy with no following message stays inert (full lifeline)', () => {
    const d = parse(`sequenceDiagram
      A->>B: hi
      destroy B`)
    expect(d.actors.find(a => a.id === 'B')!.destroyMessageIndex).toBeUndefined()
  })
})

describe('sequence create/destroy layout', () => {
  it('created lifeline starts at the create message; destroyed ends at the destroy message', () => {
    const p = layoutSequenceDiagram(parse(SRC))
    const donaldLife = p.lifelines.find(l => l.actorId === 'D')!
    const aliceLife = p.lifelines.find(l => l.actorId === 'A')!
    const createMsg = p.messages[1]!
    const destroyMsg = p.messages[3]!

    // Alice's lifeline spans the whole diagram; Donald's starts at the create
    // message and ends at the destroy message.
    expect(donaldLife.topY).toBeGreaterThan(aliceLife.topY)
    expect(donaldLife.topY).toBeGreaterThanOrEqual(createMsg.y)
    expect(donaldLife.bottomY).toBeGreaterThan(destroyMsg.y)
    expect(donaldLife.bottomY).toBeLessThan(p.messages[4]!.y)
    expect(donaldLife.bottomY).toBeLessThan(aliceLife.bottomY)

    // The created actor's header box sits on the create message row.
    const donald = p.actors.find(a => a.id === 'D')!
    expect(donald.y).toBeGreaterThan(p.actors.find(a => a.id === 'A')!.y)
    expect(createMsg.y).toBeGreaterThanOrEqual(donald.y)
    expect(createMsg.y).toBeLessThanOrEqual(donald.y + donald.height)
  })

  // A creation message ends where its head meets the created header's
  // outline, a participant card's side or the stick figure's outer circle,
  // with the head's ink outside it, so the header covers none of the head and
  // strict layout safety certifies the diagram (the Mermaid documentation
  // example creates the actor `D as Donald` this way).
  const creationHeads = [['filled', '->>'], ['dotted', '-->>'], ['open', '->'], ['cross', '-x'], ['async', '-)'], ['bidirectional', '<<->>']] as const
  it.each(['participant', 'actor'].flatMap(type => creationHeads.flatMap(([head, arrow]) => [
    [type, head, 'right', `participant A\ncreate ${type} C as Created\nA${arrow}C: Welcome`],
    [type, head, 'left', `create ${type} C as Created\nA${arrow}C: Welcome`],
  ])))('a creation message meets the created %s header with a %s head from the %s', (type, _head, _direction, body) => {
    const source = `sequenceDiagram\n${body}\nC-->>A: back`
    const p = layoutSequenceDiagram(parse(source))
    const message = p.messages[0]!, sender = p.actors.find(actor => actor.id === 'A')!, target = p.actors.find(actor => actor.id === 'C')!
    expect(message).toMatchObject({ from: 'A', to: 'C', label: 'Welcome', x1: sender.x })
    expect(message.points.at(-1)).toEqual({ x: message.x2, y: message.y })
    const { svg, receipt } = renderMermaidSVGWithReceipt(source, { layoutSafety: 'strict' })
    expect(receipt.layoutCertification?.status).toBe('passed')
    // The drawn outline on the message row: the card's side, or the icon's
    // outer circle (radius 9 of its 24-unit box), each with a 1px stroke.
    const icon = svg.match(/<g transform="translate\(([-\d.]+),([-\d.]+)\) scale\(([-\d.]+)\)">/)
    const outline = type === 'actor' ? 9 * Number(icon![3]) + 0.5 : target.width / 2 + 0.5
    if (type === 'actor') {
      expect(Number(icon![1]) + 12 * Number(icon![3])).toBe(target.x)
      expect(Number(icon![2]) + 12 * Number(icon![3])).toBe(message.y)
    } else expect(target.y + target.height / 2).toBe(message.y)
    const reach = Math.abs(target.x - message.x2)
    expect(reach).toBeGreaterThanOrEqual(outline)
    expect(reach).toBeLessThanOrEqual(outline + 7)
    expect(Math.sign(target.x - message.x2)).toBe(Math.sign(target.x - sender.x))
    expect(message.labelPosition.bounds.x).toBeGreaterThanOrEqual(Math.min(message.x1, message.x2))
    expect(message.labelPosition.bounds.x + message.labelPosition.bounds.width).toBeLessThanOrEqual(Math.max(message.x1, message.x2))
  })

  it('certifies the Mermaid documentation example under strict safety', () => {
    const source = 'sequenceDiagram\nAlice->>Bob: Hello Bob, how are you ?\nBob->>Alice: Fine, thank you. And you?\ncreate participant Carl\nAlice->>Carl: Hi Carl!\ncreate actor D as Donald\nCarl->>D: Hi!\ndestroy Carl\nAlice-xCarl: We are too many\ndestroy Bob\nBob->>Alice: I agree'
    expect(renderMermaidSVGWithReceipt(source, { layoutSafety: 'strict' }).receipt.layoutCertification?.status).toBe('passed')
  })

  // A stacked directive whose participant is not in its message still acts at
  // that message's row: a destroyed lifeline ends at a cross level with the
  // message's own, and a created header starts just below the message, clear
  // of the arrow and label crossing its column. Strict safety certifies both.
  it.each([
    ['a destroy beside the destroyed sender', 'participant A\nparticipant C\nparticipant B\nA->>B: hi\ndestroy C\ndestroy B\nB->>A: bye\nA->>A: tail', 1],
    ['a destroy beside the destroyed receiver', 'participant A\nparticipant C\nparticipant B\nA->>C: hi\ndestroy C\ndestroy B\nA-xB: bye\nA->>A: tail', 1],
    ['a create beside the created receiver', 'participant A\ncreate participant X\ncreate participant Y\nA->>Y: make\nY->>A: ok', 0],
    ['a create beside a created actor', 'participant A\ncreate actor X\ncreate participant Y\nA->>Y: make\nY->>A: ok', 0],
    ['a create beside a destroy', 'participant A\nparticipant C\ncreate participant X\ndestroy C\nA->>C: last\nX->>A: ok', 0],
  ] as const)('acts on %s at the stack\'s message row', (_name, body, row) => {
    const source = `sequenceDiagram\n${body}`
    const d = parse(source)
    const p = layoutSequenceDiagram(d)
    const message = p.messages[row]!
    const messageBottom = message.bounds.y + message.bounds.height
    for (const actor of d.actors) {
      const lifeline = p.lifelines.find(l => l.actorId === actor.id)!
      if (actor.destroyMessageIndex === row) {
        const cross = p.destructions.find(c => c.actorId === actor.id)!
        expect(cross.y).toBe(p.destructions.find(c => c.actorId === message.from || c.actorId === message.to)?.y ?? cross.y)
        expect(cross.y).toBeGreaterThan(message.y)
        expect(cross.y).toBeLessThan(p.messages[row + 1]!.y)
        expect(lifeline.bottomY).toBe(cross.y)
      }
      if (actor.createMessageIndex === row && actor.id !== message.to) {
        const header = p.actors.find(a => a.id === actor.id)!
        expect(header.bounds.y).toBeGreaterThan(messageBottom)
        expect(header.bounds.y + header.bounds.height).toBeLessThan(p.messages[row + 1]!.bounds.y)
        expect(lifeline.topY).toBe(header.bounds.y + header.bounds.height)
      }
    }
    expect(d.actors.filter(actor => actor.id !== message.from && actor.id !== message.to && (actor.createMessageIndex === row || actor.destroyMessageIndex === row))).not.toEqual([])
    expect(renderMermaidSVGWithReceipt(source, { layoutSafety: 'strict' }).receipt.layoutCertification?.status).toBe('passed')
  })

  it('emits an X cross at the destroy point', () => {
    const p = layoutSequenceDiagram(parse(SRC))
    expect(p.destructions).toHaveLength(1)
    const cross = p.destructions[0]!
    const donaldLife = p.lifelines.find(l => l.actorId === 'D')!
    expect(cross.actorId).toBe('D')
    expect(cross.x).toBe(donaldLife.x)
    expect(cross.y).toBe(donaldLife.bottomY)
  })

  // An activation still open on a destroyed participant ends with its lifeline
  // at the cross, however late it is closed; one the destroy message closes
  // ends on that message's row, above the cross.
  it.each([
    ['opened before the destroy', 'A->>+B: open\ndestroy B\nA->>B: bye', 1, 'cross'],
    ['nested around a destroyed self-message', 'A->>+B: open\nactivate B\ndestroy B\nB->>B: bye', 2, 'cross'],
    ['open across a destroyed self-message', 'A->>+B: open\ndestroy B\nB->>B: bye', 1, 'cross'],
    ['closed by a deactivate after the destroy', 'A->>+B: open\ndestroy B\nA->>B: bye\nA->>A: later\ndeactivate B', 1, 'cross'],
    ['closed by the destroy message', 'A->>+B: open\ndestroy B\nB-->>-A: bye', 1, 'message'],
    ['opened by the destroy message', 'A->>B: hi\ndestroy B\nA->>+B: bye', 1, 'cross'],
  ] as const)('ends the destroyed participant\'s activation %s at its cross', (_name, body, count, end) => {
    const source = `sequenceDiagram\nparticipant A\nparticipant B\n${body}\nA->>A: tail`
    const p = layoutSequenceDiagram(parse(source))
    const cross = p.destructions.find(d => d.actorId === 'B')!
    const destroyMessage = p.messages[p.messages.length - 2]!
    const owned = p.activations.filter(a => a.actorId === 'B')
    expect(owned).toHaveLength(count)
    for (const activation of owned) {
      expect(activation.topY).toBeLessThan(cross.y)
      expect(activation.bottomY).toBe(end === 'cross' ? cross.y : destroyMessage.y)
    }

    // The drawn bars are exactly those activations and none runs past the
    // drawn end of the lifeline.
    const svg = renderMermaidSVG(source)
    const attr = (tag: string, name: string) => Number(tag.match(new RegExp(`\\b${name}="([^"]+)"`))![1])
    const lifeline = svg.match(/<line class="lifeline" data-actor="B"[^>]*>/)![0]
    const bars = [...svg.matchAll(/<rect class="activation" data-actor="B"[^>]*>/g)].map(([tag]) => ({ top: attr(tag, 'y'), bottom: attr(tag, 'y') + attr(tag, 'height') }))
    expect(svg.match(/class="activation" data-actor="B"/g)?.length ?? 0).toBe(count)
    expect(bars.map(bar => [bar.top, bar.bottom]).sort()).toEqual(owned.map(a => [a.topY, a.bottomY]).sort())
    for (const bar of bars) expect(bar.bottom).toBeLessThanOrEqual(attr(lifeline, 'y2'))
  })

  // The cross ends the lifeline below the destroy message's last contact with
  // it (a self-message's return), clear of that contact's endpoint marker, so
  // the head stays visible and unambiguous (a cross head is not swallowed by
  // the destroy cross) and strict layout safety certifies the diagram.
  const heads = [['filled', '->>'], ['open', '->'], ['dotted', '-->>'], ['async', '-)'], ['cross', '-x'], ['bidirectional', '<<->>']] as const
  const roles = [
    ['receiver', (arrow: string) => `destroy B\nA${arrow}B: bye`],
    ['sender', (arrow: string) => `destroy B\nB${arrow}A: bye`],
    ['self-message', (arrow: string) => `destroy B\nB${arrow}B: bye`],
  ] as const
  const wide = { style: { roles: { edge: { lineWidth: 3 } } } }
  it.each([
    ...heads.flatMap(([head, arrow]) => roles.map(([role, body]) => [head, role, `participant A\nparticipant B\nparticipant C\nA->>B: hi\n${body(arrow)}\nA->>C: across the destroyed lifeline`, {}] as const)),
    ['filled', 'receiver with wide edges', 'A->>B: hi\ndestroy B\nA->>B: bye\nA->>A: tail', wide],
    ['cross', 'self-message with wide edges', 'A->>B: hi\ndestroy B\nB-xB: bye\nA->>A: tail', wide],
    ['filled', 'receiver followed by a note over it', 'A->>B: hi\ndestroy B\nA->>B: bye\nNote over B: gone', {}],
    ['async', 'receiver closing an alt branch', 'A->>B: hi\nalt yes\ndestroy B\nA-)B: bye\nelse no\nA->>C: long label over B\nend', {}],
    ['open', 'self-message ending a loop', 'A->>B: hi\nloop again\ndestroy B\nB->B: bye\nend\nA->>C: later', {}],
  ] as const)('keeps the %s head of a destroyed %s clear of the cross under strict safety', (_head, _role, body, options) => {
    const { svg, receipt } = renderMermaidSVGWithReceipt(`sequenceDiagram\n${body}`, { ...options, layoutSafety: 'strict' })
    expect(receipt.layoutCertification?.status).toBe('passed')

    const num = (tag: string, name: string) => Number(tag.match(new RegExp(`\\s${name}="([^"]+)"`))![1])
    const [, actor, path, crossStroke] = svg.match(/<path class="destroy-cross" data-actor="([^"]+)" d="([^"]+)"[^>]*stroke-width="([^"]+)"/)!
    const coords = path!.match(/-?[\d.]+/g)!.map(Number)
    const xs = coords.filter((_, i) => i % 2 === 0), ys = coords.filter((_, i) => i % 2 === 1)
    const crossX = (Math.min(...xs) + Math.max(...xs)) / 2
    const crossY = (Math.min(...ys) + Math.max(...ys)) / 2
    const crossTop = Math.min(...ys) - Number(crossStroke) / 2
    const lifeline = svg.match(new RegExp(`<line class="lifeline" data-actor="${actor}"[^>]*>`))![0]
    expect(num(lifeline, 'x1')).toBe(crossX)
    expect(num(lifeline, 'y2')).toBe(crossY)
    for (const [tag] of svg.matchAll(new RegExp(`<rect class="activation" data-actor="${actor}"[^>]*>`, 'g'))) expect(num(tag, 'y') + num(tag, 'height')).toBeLessThanOrEqual(crossY)

    // Every message point on the destroyed lifeline, widened by its marker's
    // painted half-height, lies above the cross's ink.
    const markerHalf = new Map([...svg.matchAll(/<marker id="([^"]+)"[^>]*markerHeight="([^"]+)"/g)].map(([, id, h]) => [id!, Number(h) / 2]))
    let contacts = 0
    for (const [tag] of svg.matchAll(/<(?:line|polyline) [^>]*data-relationship="sequence-message"[^>]*>/g)) {
      const points = tag.startsWith('<line')
        ? [[num(tag, 'x1'), num(tag, 'y1')], [num(tag, 'x2'), num(tag, 'y2')]]
        : tag.match(/points="([^"]+)"/)![1]!.trim().split(/\s+/).map(pair => pair.split(',').map(Number))
      const width = num(tag, 'stroke-width')
      const half = Math.max(width / 2, ...[...tag.matchAll(/marker-(?:start|end)="url\(#([^)]+)\)"/g)].map(([, id]) => markerHalf.get(id!)! * width))
      for (const [x, y] of points) if (x === crossX) {
        contacts++
        expect(y! + half).toBeLessThan(crossTop)
      }
    }
    expect(contacts).toBeGreaterThan(0)
  })

  it('boxless/plain diagrams have no destructions', () => {
    const p = layoutSequenceDiagram(parse('sequenceDiagram\n  A->>B: hi'))
    expect(p.destructions).toHaveLength(0)
  })
})

describe('sequence create/destroy SVG rendering', () => {
  it('renders the alias label and a destroy cross marker', () => {
    const svg = renderMermaidSVG(SRC)
    expect(svg).toContain('Donald')
    expect(svg).toContain('class="destroy-cross"')
    expect(svg).toContain('data-actor="D"')
  })

  it('plain diagrams render no destroy cross', () => {
    const svg = renderMermaidSVG('sequenceDiagram\n  A->>B: hi')
    expect(svg).not.toContain('destroy-cross')
  })
})
