import { describe, expect, test } from 'bun:test'
import { parseRegisteredMermaid } from '../agent/parse.ts'
import { serializeMermaid } from '../agent/serialize.ts'
import { asSequence } from '../agent/types.ts'
import { mutate } from '../agent/mutate.ts'
import { renderMermaidSVG } from '../index.ts'
import { parseSequenceDiagram, parseSequenceMessageLine } from '../sequence/parser.ts'
import { resolveRenderRequest } from '../render-contract.ts'
import { positionResolvedFamily } from '../positioning.ts'
import { lowerPositionedFamilyScene } from '../graphical-render.ts'
import type { ConnectorMark, SceneNode } from '../scene/ir.ts'

// Pinned Mermaid 11.16 sequenceDiagram.jison has eight solid and eight dotted
// half-arrow tokens. A shorter prefix must never become part of the recipient.
const CASES = [
  { arrow: '-|\\', head: 'half-top', side: 'end', dashed: false },
  { arrow: '--|\\', head: 'half-top', side: 'end', dashed: true },
  { arrow: '-|/', head: 'half-bottom', side: 'end', dashed: false },
  { arrow: '--|/', head: 'half-bottom', side: 'end', dashed: true },
  { arrow: '-\\\\', head: 'stick-top', side: 'end', dashed: false },
  { arrow: '--\\\\', head: 'stick-top', side: 'end', dashed: true },
  { arrow: '-//', head: 'stick-bottom', side: 'end', dashed: false },
  { arrow: '--//', head: 'stick-bottom', side: 'end', dashed: true },
  { arrow: '/|-', head: 'half-bottom', side: 'start', dashed: false },
  { arrow: '/|--', head: 'half-bottom', side: 'start', dashed: true },
  { arrow: '\\|-', head: 'half-top', side: 'start', dashed: false },
  { arrow: '\\|--', head: 'half-top', side: 'start', dashed: true },
  { arrow: '//-', head: 'stick-bottom', side: 'start', dashed: false },
  { arrow: '//--', head: 'stick-bottom', side: 'start', dashed: true },
  { arrow: '\\\\-', head: 'stick-top', side: 'start', dashed: false },
  { arrow: '\\\\--', head: 'stick-top', side: 'start', dashed: true },
] as const

describe('Sequence half-arrow lexical fidelity', () => {
  test('final Scene retains message arrowheads and their marker placements', () => {
    const source = 'sequenceDiagram\nA->>B: Request\nB-->>A: Reply\nA->>A: Retry\nA<<->>B: Exchange'
    for (const color of [undefined, '#123456', '#7a3b91', '#123456']) {
      const request = resolveRenderRequest(source, color ? { style: { roles: { edge: { strokeColor: color } } } } : {})
      const scene = lowerPositionedFamilyScene(request, positionResolvedFamily('sequence', request))
      const messages: ConnectorMark[] = []
      const visit = (node: SceneNode): void => {
        if (node.kind === 'connector' && node.role === 'message') messages.push(node)
        if (node.kind === 'group') for (const child of node.children) visit(child.node)
      }
      scene.parts.forEach(visit)
      expect(messages).toHaveLength(4)
      for (const message of messages) {
        expect(message.markers.end?.shape).toBe('arrow')
        expect(message.terminalProjection.markerPlacements.end).toHaveLength(1)
        expect(message.terminalProjection.markerPlacements.end[0]?.point).toEqual(message.endpoints.end?.point)
        if (color) expect(message.markers.end?.paint).toEqual({ fill: color })
      }
      expect(messages[3]!.markers.start?.shape).toBe('arrow')
      expect(messages[3]!.terminalProjection.markerPlacements.start).toHaveLength(1)
      if (color) expect(messages[3]!.markers.start?.paint).toEqual({ fill: color })
    }
  })

  for (const { arrow, head, side, dashed } of CASES) {
    test(`${JSON.stringify(arrow)} keeps exact identities and paint implication`, () => {
      const line = `A${arrow}B: witness`
      const source = `sequenceDiagram\n  ${line}`
      expect(parseSequenceMessageLine(line)).toMatchObject({ from: 'A', to: 'B', arrow })

      const native = parseSequenceDiagram(['sequenceDiagram', line])
      expect(native.actors.map(actor => actor.id)).toEqual(['A', 'B'])
      expect(native.messages).toHaveLength(1)
      expect(native.messages[0]).toMatchObject({
        from: 'A', to: 'B', lineStyle: dashed ? 'dashed' : 'solid',
        startHead: side === 'start' ? head : 'none',
        endHead: side === 'end' ? head : 'none',
      })

      const agent = parseRegisteredMermaid(source)
      expect(agent.ok).toBe(true)
      if (!agent.ok) return
      const sequence = asSequence(agent.value)
      expect(sequence).not.toBeNull()
      if (!sequence) return
      expect(sequence.body.messages[0]).toMatchObject({ from: 'A', to: 'B', arrow })
      const serialized = serializeMermaid(sequence)
      expect(serialized).toContain(`A${arrow}B: witness`)
      const agentReparse = parseRegisteredMermaid(serialized)
      expect(agentReparse.ok).toBe(true)
      if (agentReparse.ok) expect(asSequence(agentReparse.value)?.body.messages[0]?.arrow).toBe(arrow)
      expect(parseSequenceDiagram(serialized.trimEnd().split('\n').map(part => part.trim())).messages[0]).toMatchObject({
        from: 'A', to: 'B', lineStyle: dashed ? 'dashed' : 'solid',
        startHead: side === 'start' ? head : 'none', endHead: side === 'end' ? head : 'none',
      })

      const changed = mutate(sequence, { kind: 'set_message_text', index: 0, text: 'edited' })
      expect(changed.ok).toBe(true)
      if (changed.ok) expect(serializeMermaid(changed.value)).toContain(`A${arrow}B: edited`)

      const svg = renderMermaidSVG(source)
      expect(svg).toContain('data-from="A"')
      expect(svg).toContain('data-to="B"')
      expect(svg).toContain(`data-${side}-head="${head}"`)
      expect(svg).toContain(`marker-${side}="url(#seq-arrow-${head})"`)
    })
  }

  test('shorter pre-existing aliases remain distinct stroked heads', () => {
    for (const [arrow, head, side] of [
      ['-|', 'stick-top', 'end'],
      ['-/', 'stick-bottom', 'end'],
      ['|-', 'stick-top', 'start'],
      ['/-', 'stick-bottom', 'start'],
    ] as const) {
      const source = `sequenceDiagram\n  A${arrow}B: alias`
      const svg = renderMermaidSVG(source)
      expect(svg).toContain('data-from="A"')
      expect(svg).toContain('data-to="B"')
      expect(svg).toContain(`data-${side}-head="${head}"`)
      expect(svg).toContain(`marker-${side}="url(#seq-arrow-${head})"`)
    }
  })

  test('mixed heads resolve their own geometry and current request paint', () => {
    const source = String.raw`sequenceDiagram
      A->>B: filled
      B--)A: open
      A-xB: cross
      A-|\B: half top
      A-|/B: half bottom
      A-\\B: stick top
      A-//B: stick bottom
      A->B: no head
      A<<->>B: exchange` + '\n      B->>B: 自分'
    const definitions = [
      ['seq-arrow', '<polygon points="0 0, 8 2.5, 0 5"', 'filled'],
      ['seq-arrow-open', '<polyline points="0 0, 8 2.5, 0 5"', 'open'],
      ['seq-arrow-cross', '<path d="M1 1 L7 4 M1 4 L7 1"', 'cross'],
      ['seq-arrow-half-top', '<polygon points="0 0, 8 2.5, 0 2.5"', 'filled'],
      ['seq-arrow-half-bottom', '<polygon points="0 2.5, 8 2.5, 0 5"', 'filled'],
      ['seq-arrow-stick-top', '<path d="M0 0 L8 2.5"', 'stick'],
      ['seq-arrow-stick-bottom', '<path d="M0 5 L8 2.5"', 'stick'],
    ] as const
    // Revisit the first style after another request: resources belong to this
    // render, including when the message order uses all seven marker shapes.
    for (const color of ['#123456', '#7a3b91', '#123456']) {
      const svg = renderMermaidSVG(source, { style: { roles: { edge: { strokeColor: color } } } })
      expect([...svg.matchAll(/<marker\b/g)]).toHaveLength(7)
      for (const [id, geometry, kind] of definitions) {
        const marker = svg.match(new RegExp(`<marker id="${id}"[\\s\\S]*?<\\/marker>`))?.[0]
        expect(marker).toBeDefined()
        expect(marker).toContain('markerWidth="8" markerHeight="5"')
        expect(marker).toContain(`refX="${kind === 'cross' ? '4' : '8'}" refY="2.5"`)
        expect(marker).toContain(`orient="${kind === 'cross' ? 'auto' : 'auto-start-reverse'}"`)
        expect(marker).toContain(geometry)
        if (kind === 'filled') {
          expect(marker).toContain(`fill="${color}"`)
          expect(marker).not.toContain('stroke-width=')
        } else {
          expect(marker).toContain(`fill="none" stroke="${color}" stroke-width="${kind === 'open' ? '1' : '1.5'}"`)
        }
      }
      const messages = [...svg.matchAll(/<g class="message"[^>]*>[\s\S]*?<\/g>/g)].map(match => match[0])
      expect(messages).toHaveLength(10)
      const endIds = [...definitions.map(([id]) => id), undefined, 'seq-arrow', 'seq-arrow']
      const labels = ['filled', 'open', 'cross', 'half top', 'half bottom', 'stick top', 'stick bottom', 'no head', 'exchange', '自分']
      for (const [index, message] of messages.entries()) {
        const line = message.match(/<(?:line|polyline)\b[^>]*>/)?.[0]
        expect(line).toBeDefined()
        expect(line).toContain(`stroke="${color}"`)
        expect(line).toContain(`data-from="${index === 1 || index === 9 ? 'B' : 'A'}" data-to="${index === 1 ? 'A' : 'B'}"`)
        expect(message).toMatch(new RegExp(`>${labels[index]}</(?:text|tspan)>`))
        if (endIds[index]) expect(line).toContain(`marker-end="url(#${endIds[index]})"`)
        else expect(line).not.toContain('marker-end=')
        if (index === 8) expect(line).toContain('marker-start="url(#seq-arrow)"')
        else expect(line).not.toContain('marker-start=')
      }
      expect(messages[1]).toContain('stroke-dasharray="6 4"')
      expect(messages[9]).toContain('data-self="true"')
    }
  })
})
