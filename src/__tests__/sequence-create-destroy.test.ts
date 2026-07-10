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
import { renderMermaidSVG } from '../index.ts'

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
    expect(donaldLife.bottomY).toBe(destroyMsg.y)
    expect(donaldLife.bottomY).toBeLessThan(aliceLife.bottomY)

    // The created actor's header box sits on the create message row.
    const donald = p.actors.find(a => a.id === 'D')!
    expect(donald.y).toBeGreaterThan(p.actors.find(a => a.id === 'A')!.y)
    expect(createMsg.y).toBeGreaterThanOrEqual(donald.y)
    expect(createMsg.y).toBeLessThanOrEqual(donald.y + donald.height)
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
