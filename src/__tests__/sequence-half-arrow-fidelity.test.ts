import { describe, expect, test } from 'bun:test'
import { parseRegisteredMermaid } from '../agent/parse.ts'
import { serializeMermaid } from '../agent/serialize.ts'
import { asSequence } from '../agent/types.ts'
import { mutate } from '../agent/mutate.ts'
import { renderMermaidSVG } from '../index.ts'
import { parseSequenceDiagram, parseSequenceMessageLine } from '../sequence/parser.ts'

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

  test('solid half heads are filled polygons while stick heads are strokes', () => {
    const svg = renderMermaidSVG('sequenceDiagram\n  A-|/B: filled\n  A-//B: stick')
    for (const head of ['half-top', 'half-bottom']) {
      const marker = svg.match(new RegExp(`<marker id="seq-arrow-${head}"[\\s\\S]*?<\\/marker>`))?.[0]
      expect(marker).toContain('<polygon ')
      expect(marker).not.toContain('stroke-width=')
    }
    for (const head of ['stick-top', 'stick-bottom']) {
      const marker = svg.match(new RegExp(`<marker id="seq-arrow-${head}"[\\s\\S]*?<\\/marker>`))?.[0]
      expect(marker).toContain('<path ')
      expect(marker).toContain('fill="none"')
      expect(marker).toContain('stroke-width=')
    }
  })
})
