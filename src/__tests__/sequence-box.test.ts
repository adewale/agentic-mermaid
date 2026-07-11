/**
 * Sequence `box ... end` groups — family-elevation-plan §Sequence item 4.
 *
 * Three layers, red-first:
 *   1. Agent body FIX: `box ... end` must no longer collapse parseSequenceBody
 *      to the whole-body opaque fallback (its bare `end` used to hit the
 *      stray-`end` rule). Boxed diagrams keep their typed ops; the box rides
 *      along as a preserved opaque-block segment, verbatim.
 *   2. Renderer parser FEATURE: `box <color?> <label?>` ... `end` parses into
 *      SequenceDiagram.boxes with color / label / member actor ids
 *      (upstream: https://mermaid.js.org/syntax/sequenceDiagram.html §Grouping/Box).
 *   3. Layout + SVG FEATURE: a background frame + title behind the boxed
 *      participants, theme-aware fill by default, WCAG-guarded title ink when
 *      an explicit color is set (journey precedent).
 */
import { describe, it, expect } from 'bun:test'
import { parseSequenceDiagram } from '../sequence/parser.ts'
import { layoutSequenceDiagram } from '../sequence/layout.ts'
import { renderMermaidSVG } from '../index.ts'
import { parseSequenceBody } from '../agent/sequence-body.ts'
import { parseMermaid } from '../agent/parse.ts'
import { serializeMermaid } from '../agent/serialize.ts'
import { mutate } from '../agent/mutate.ts'
import { asSequence } from '../agent/types.ts'
import { wcagContrastRatio } from '../shared/color-math.ts'

function parse(text: string) {
  const lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 0 && !l.startsWith('%%'))
  return parseSequenceDiagram(lines)
}

const BOXED = `sequenceDiagram
  box Aqua Team A
    participant A as Alice
    participant B as Bob
  end
  A->>B: Hello
  B-->>A: Hi`

// ============================================================================
// 1. Agent body: box must not collapse the structured body to opaque
// ============================================================================

describe('parseSequenceBody – box ... end (fix)', () => {
  it('parses a boxed diagram to a structured body (not null)', () => {
    const lines = BOXED.split('\n').slice(1).map(l => l.trim())
    const body = parseSequenceBody(lines)
    expect(body).not.toBeNull()
    expect(body!.messages.map(m => m.text)).toEqual(['Hello', 'Hi'])
  })

  it('keeps the box verbatim as an opaque-block segment', () => {
    const d = parseMermaid(BOXED)
    expect(d.ok).toBe(true)
    if (!d.ok) return
    expect(d.value.body.kind).toBe('sequence')
    expect(asSequence(d.value)).not.toBeNull()
    const out = serializeMermaid(d.value).trimEnd()
    expect(out.split('\n').map(l => l.trim())).toEqual(BOXED.split('\n').map(l => l.trim()))
  })

  it('typed ops still work on a boxed diagram', () => {
    const d = parseMermaid(BOXED)
    if (!d.ok) throw new Error('parse failed')
    const s = asSequence(d.value)
    expect(s).not.toBeNull()
    const r = mutate(s!, { kind: 'set_message_text', index: 0, text: 'Hey' })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const out = serializeMermaid(r.value)
    expect(out).toContain('A->>B: Hey')
    expect(out).toContain('box Aqua Team A')
    expect(out).toContain('end')
  })

  it('remove_participant rejects when a preserved box would resurrect the actor', () => {
    const parsed = parseMermaid(BOXED)
    if (!parsed.ok) throw new Error('parse failed')
    const sequence = asSequence(parsed.value)!
    const before = sequence.canonicalSource
    const result = mutate(sequence, { kind: 'remove_participant', id: 'A' })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.code).toBe('INVALID_OP')
      expect(result.error.message).toContain('preserved sequence syntax')
    }
    expect(sequence.canonicalSource).toBe(before)
  })

  it('a stray end without any open block still falls back to opaque', () => {
    const body = parseSequenceBody(['A->>B: hi', 'end'])
    expect(body).toBeNull()
  })
})

// ============================================================================
// 2. Renderer parser: box groups
// ============================================================================

describe('parseSequenceDiagram – box groups', () => {
  it('parses box with color and label', () => {
    const d = parse(BOXED)
    expect(d.boxes).toHaveLength(1)
    expect(d.boxes![0]!.color).toBe('Aqua')
    expect(d.boxes![0]!.label).toBe('Team A')
    expect(d.boxes![0]!.actorIds).toEqual(['A', 'B'])
    // Membership does not disturb ordinary parsing
    expect(d.actors.map(a => a.label)).toEqual(['Alice', 'Bob'])
    expect(d.messages).toHaveLength(2)
  })

  it('parses box transparent <label that looks like a color>', () => {
    const d = parse(`sequenceDiagram
      box transparent Aqua
        participant A
      end
      A->>A: ping`)
    expect(d.boxes![0]!.color).toBe('transparent')
    expect(d.boxes![0]!.label).toBe('Aqua')
  })

  it('parses box rgb(...) colors', () => {
    const d = parse(`sequenceDiagram
      box rgb(33,66,99) Ops
        participant A
      end
      A->>A: ping`)
    expect(d.boxes![0]!.color).toBe('rgb(33,66,99)')
    expect(d.boxes![0]!.label).toBe('Ops')
  })

  it('treats a non-color first word as plain label text', () => {
    const d = parse(`sequenceDiagram
      box Backend Services
        participant A
      end
      A->>A: ping`)
    expect(d.boxes![0]!.color).toBeUndefined()
    expect(d.boxes![0]!.label).toBe('Backend Services')
  })

  it('box end does not interfere with block end', () => {
    const d = parse(`sequenceDiagram
      box Team
        participant A
        participant B
      end
      loop retry
        A->>B: poll
      end`)
    expect(d.boxes).toHaveLength(1)
    expect(d.blocks).toHaveLength(1)
    expect(d.blocks[0]!.type).toBe('loop')
  })
})

// ============================================================================
// 3. Layout + SVG rendering
// ============================================================================

describe('sequence box layout', () => {
  it('frames the boxed actors and their lifelines', () => {
    const p = layoutSequenceDiagram(parse(BOXED))
    expect(p.boxes).toHaveLength(1)
    const box = p.boxes[0]!
    const members = p.actors.filter(a => a.id === 'A' || a.id === 'B')
    for (const a of members) {
      expect(box.x).toBeLessThanOrEqual(a.x - a.width / 2)
      expect(box.x + box.width).toBeGreaterThanOrEqual(a.x + a.width / 2)
      expect(box.y).toBeLessThan(a.y)
    }
    const lifelines = p.lifelines.filter(l => l.actorId === 'A' || l.actorId === 'B')
    for (const l of lifelines) {
      expect(box.y + box.height).toBeGreaterThanOrEqual(l.bottomY)
    }
    // Box stays inside the canvas
    expect(box.x).toBeGreaterThanOrEqual(0)
    expect(box.x + box.width).toBeLessThanOrEqual(p.width)
    expect(box.y).toBeGreaterThanOrEqual(0)
    expect(box.y + box.height).toBeLessThanOrEqual(p.height)
  })

  it('unboxed diagrams keep their geometry (no reserved title band)', () => {
    const plain = layoutSequenceDiagram(parse('sequenceDiagram\n  A->>B: Hello'))
    expect(plain.boxes).toHaveLength(0)
    expect(plain.actors[0]!.y).toBe(30) // SEQ.padding — unchanged for boxless diagrams
  })
})

describe('sequence box SVG rendering', () => {
  it('renders a box frame rect + title behind the participants', () => {
    const svg = renderMermaidSVG(BOXED)
    expect(svg).toContain('class="box"')
    expect(svg).toContain('data-label="Team A"')
    expect(svg).toContain('Team A')
    // Frame must be painted BEFORE (behind) the actor boxes
    const boxAt = svg.indexOf('class="box"')
    const actorAt = svg.indexOf('class="actor"')
    expect(boxAt).toBeGreaterThan(-1)
    expect(actorAt).toBeGreaterThan(boxAt)
  })

  it('uses a theme-aware fill when no explicit color is given', () => {
    const src = `sequenceDiagram
      box Team
        participant A
      end
      A->>A: ping`
    const boxRectFill = (svg: string): string => {
      const chunk = svg.slice(svg.indexOf('class="box"'))
      const m = chunk.match(/<rect[^>]*fill="([^"]+)"/)
      expect(m).not.toBeNull()
      return m![1]!
    }
    // Derived from theme fg/bg, not a hardcoded literal: a dark theme yields a
    // different (dark-mixed) fill than the light default.
    const lightFill = boxRectFill(renderMermaidSVG(src))
    const darkFill = boxRectFill(renderMermaidSVG(src, { bg: '#1a1b26', fg: '#a9b1d6' }))
    expect(lightFill).not.toBe(darkFill)
  })

  it('guards the title ink against an explicit dark fill (WCAG >= 4.5)', () => {
    const svg = renderMermaidSVG(`sequenceDiagram
      box #1f2a44 Night Ops
        participant A
      end
      A->>A: ping`)
    expect(svg).toContain('#1f2a44')
    // Title ink must clear AA against the explicit fill (the title is the
    // <text> mark whose content is the box label)
    const inkMatch = svg.match(/<text[^>]*fill="(#[0-9a-fA-F]{6})"[^>]*>Night Ops</i)
    expect(inkMatch).not.toBeNull()
    const ink = inkMatch![1]!
    const ratio = wcagContrastRatio(ink, '#1f2a44')
    expect(ratio).not.toBeNull()
    expect(ratio!).toBeGreaterThanOrEqual(4.5)
  })

  it('renders transparent boxes with no fill', () => {
    const svg = renderMermaidSVG(`sequenceDiagram
      box transparent Ghost
        participant A
      end
      A->>A: ping`)
    const boxChunk = svg.slice(svg.indexOf('class="box"'), svg.indexOf('class="box"') + 400)
    expect(boxChunk).toContain('fill="none"')
  })
})
