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

  it.each([
    ['right', 'participant A\ncreate participant C as Created\nA->>C: Welcome'],
    ['left', 'create participant C as Created\nA->>C: Welcome'],
  ])('creation arrows meet the %s participant header without losing their labels', (_direction, body) => {
    const p = layoutSequenceDiagram(parse(`sequenceDiagram\n${body}`))
    const message = p.messages[0]!, source = p.actors.find(actor => actor.id === 'A')!, target = p.actors.find(actor => actor.id === 'C')!
    const attachment = source.x < target.x ? target.bounds.x : target.bounds.x + target.bounds.width
    expect(message.x1).toBe(source.x)
    expect(message.x2).toBe(attachment)
    expect(message.x2).not.toBe(target.x)
    expect(message.points.at(-1)).toEqual({ x: attachment, y: message.y })
    expect(message).toMatchObject({ from: 'A', to: 'C', endHead: 'filled', label: 'Welcome' })
    expect(renderMermaidSVGWithReceipt(`sequenceDiagram\n${body}`, { layoutSafety: 'strict' }).receipt.layoutCertification?.status).toBe('passed')
    expect(message.labelPosition.bounds.x).toBeGreaterThanOrEqual(Math.min(message.x1, message.x2))
    expect(message.labelPosition.bounds.x + message.labelPosition.bounds.width).toBeLessThanOrEqual(Math.max(message.x1, message.x2))
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
