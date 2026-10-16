/**
 * Layout tests for sequence diagrams — verify that block headers and dividers
 * get extra vertical space so they don't overlap with messages.
 *
 * These tests call parseSequenceDiagram + layoutSequenceDiagram directly
 * to inspect Y coordinates, rather than checking SVG output.
 */
import { describe, it, expect } from 'bun:test'
import fc from 'fast-check'
import { parseSequenceDiagram } from '../sequence/parser.ts'
import { layoutSequenceDiagram } from '../sequence/layout.ts'
import type { PositionedSequenceDiagram } from '../sequence/types.ts'
import { resolveStyleStackWithFace } from '../scene/style-registry.ts'
import { estimateTextWidth } from '../styles.ts'
import { renderMermaidSVG } from '../index.ts'
import { parseRegisteredMermaid as parseMermaid, layoutMermaid } from '../agent/index.ts'

/** Helper: parse and layout a sequence diagram from source lines */
function layout(source: string) {
  return layoutStyled(source)
}

function layoutStyled(source: string, style?: string) {
  const lines = source
    .split('\n')
    .map(l => l.trim())
    .filter(l => l.length > 0 && !l.startsWith('%%'))
  const face = style ? resolveStyleStackWithFace(style).face : undefined
  return layoutSequenceDiagram(parseSequenceDiagram(lines), {}, {}, face)
}

interface Rect {
  x: number
  y: number
  width: number
  height: number
}

function overlaps(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y
}

function actorRect(actor: PositionedSequenceDiagram['actors'][number]): Rect {
  return { x: actor.x - actor.width / 2, y: actor.y, width: actor.width, height: actor.height }
}

function expectFiniteRect(rect: Rect): void {
  expect(Number.isFinite(rect.x)).toBe(true)
  expect(Number.isFinite(rect.y)).toBe(true)
  expect(Number.isFinite(rect.width)).toBe(true)
  expect(Number.isFinite(rect.height)).toBe(true)
  expect(rect.width).toBeGreaterThan(0)
  expect(rect.height).toBeGreaterThan(0)
}

const PROPERTY_ACTORS = ['A', 'B', 'C', 'D'] as const
const NOTE_POSITIONS = ['left of', 'right of', 'over'] as const

function generatedSequenceSource(input: {
  actorCount: number
  messageCount: number
  noteMask: boolean[]
  notePicks: number[]
  selfMask: boolean[]
}): string {
  const actors = PROPERTY_ACTORS.slice(0, input.actorCount)
  const activeActor = actors[1]!
  const lines = [
    'sequenceDiagram',
    ...actors.map(a => `  participant ${a}`),
    `  ${actors[0]}->>+${activeActor}: open`,
    '  alt Primary',
  ]
  const dividerAfter = Math.max(1, Math.floor(input.messageCount / 2))
  for (let i = 0; i < input.messageCount; i++) {
    if (i === dividerAfter) lines.push('  else Fallback')
    const from = actors[(i + 1) % actors.length]!
    const to = input.selfMask[i] ? from : actors[(i + 2) % actors.length]!
    const arrow = i % 2 === 0 ? '->>' : '-->>'
    lines.push(`  ${from}${arrow}${to}: m${i}`)
    if (input.noteMask[i]) {
      const pos = NOTE_POSITIONS[input.notePicks[i]! % NOTE_POSITIONS.length]!
      const noteActors = pos === 'over' && input.actorCount > 2 && i % 3 === 0 ? `${from},${to}` : from
      lines.push(`  Note ${pos} ${noteActors}: note ${i}`)
    }
  }
  lines.push('  end')
  lines.push(`  ${activeActor}-->>-${actors[0]}: close`)
  return lines.join('\n')
}

describe('sequence layout – standalone activation events', () => {
  it('renders positive-height standalone activation rectangles', () => {
    const positioned = layout(`sequenceDiagram
      participant A
      activate A
      A->>A: work
      deactivate A`)
    expect(positioned.activations).toHaveLength(1)
    expect(positioned.activations[0]!.actorId).toBe('A')
    expect(positioned.activations[0]!.bottomY).toBeGreaterThan(positioned.activations[0]!.topY)
  })

  it('shares one nested stack between standalone and message +/- syntax', () => {
    const positioned = layout(`sequenceDiagram
      participant A
      participant B
      activate B
      A->>+B: nested
      B-->>-A: inner done
      deactivate B`)
    expect(positioned.activations).toHaveLength(2)
    expect(new Set(positioned.activations.map(activation => activation.x)).size).toBe(2)
    expect(positioned.activations.every(activation => activation.bottomY > activation.topY)).toBe(true)
  })
})

describe('sequence layout – block spacing', () => {
  it('messages outside blocks are spaced at the base row height', () => {
    const result = layout(`sequenceDiagram
      A->>B: First
      B->>A: Second
      A->>B: Third`)

    // Three messages with no blocks — uniform spacing
    expect(result.messages).toHaveLength(3)
    const gap1 = result.messages[1]!.y - result.messages[0]!.y
    const gap2 = result.messages[2]!.y - result.messages[1]!.y
    // Both gaps should be identical (base messageRowHeight, 40px)
    expect(gap1).toBe(gap2)
    expect(gap1).toBe(40) // SEQ.messageRowHeight
  })

  it('first message in a loop block gets extra header space', () => {
    const result = layout(`sequenceDiagram
      A->>B: Before loop
      loop Every 5s
        A->>B: Inside loop
      end`)

    expect(result.messages).toHaveLength(2)
    const gap = result.messages[1]!.y - result.messages[0]!.y
    // Should be baseRowHeight + blockHeaderExtra = 40 + 28 = 68
    expect(gap).toBe(40 + 28)
  })

  it('first message in an alt block gets extra header space', () => {
    const result = layout(`sequenceDiagram
      A->>B: Login
      alt Success
        B->>A: 200
      end`)

    expect(result.messages).toHaveLength(2)
    const gap = result.messages[1]!.y - result.messages[0]!.y
    expect(gap).toBe(40 + 28)
  })

  it('messages after else dividers get extra divider space', () => {
    const result = layout(`sequenceDiagram
      A->>B: Login
      alt Valid
        B->>A: 200 OK
      else Invalid
        B->>A: 401
      end`)

    expect(result.messages).toHaveLength(3)
    // msg[0] → msg[1]: base + blockHeaderExtra (first message in alt block)
    const gap01 = result.messages[1]!.y - result.messages[0]!.y
    expect(gap01).toBe(40 + 28)

    // msg[1] → msg[2]: base + dividerExtra (message after "else Invalid")
    const gap12 = result.messages[2]!.y - result.messages[1]!.y
    expect(gap12).toBe(40 + 24)
  })

  it('multiple else dividers each get extra space', () => {
    const result = layout(`sequenceDiagram
      C->>S: Login
      alt Valid credentials
        S-->>C: 200 OK
      else Invalid
        S-->>C: 401 Unauthorized
      else Account locked
        S-->>C: 403 Forbidden
      end`)

    expect(result.messages).toHaveLength(4)

    // msg[0] → msg[1]: base + blockHeaderExtra
    const gap01 = result.messages[1]!.y - result.messages[0]!.y
    expect(gap01).toBe(40 + 28)

    // msg[1] → msg[2]: base + dividerExtra (else Invalid)
    const gap12 = result.messages[2]!.y - result.messages[1]!.y
    expect(gap12).toBe(40 + 24)

    // msg[2] → msg[3]: base + dividerExtra (else Account locked)
    const gap23 = result.messages[3]!.y - result.messages[2]!.y
    expect(gap23).toBe(40 + 24)
  })

  it('par block with and dividers gets correct spacing', () => {
    // Messages: Validate (idx 0), Get user (idx 1), Get orders (idx 2)
    // Block: startIndex=1, dividers=[{index:2}]
    const result = layout(`sequenceDiagram
      G->>A: Validate
      par Fetch user
        G->>U: Get user
      and Fetch orders
        G->>O: Get orders
      end`)

    expect(result.messages).toHaveLength(3)

    // msg[0] → msg[1]: base + blockHeaderExtra (first in par block)
    const gap01 = result.messages[1]!.y - result.messages[0]!.y
    expect(gap01).toBe(40 + 28)

    // msg[1] → msg[2]: base + dividerExtra (and Fetch orders)
    const gap12 = result.messages[2]!.y - result.messages[1]!.y
    expect(gap12).toBe(40 + 24)
  })

  it('opt block header gets extra space', () => {
    const result = layout(`sequenceDiagram
      A->>B: Request
      opt Cache available
        B-->>A: Cached response
      end`)

    expect(result.messages).toHaveLength(2)
    const gap = result.messages[1]!.y - result.messages[0]!.y
    expect(gap).toBe(40 + 28)
  })

  it('critical block header gets extra space', () => {
    const result = layout(`sequenceDiagram
      A->>DB: BEGIN
      critical Transaction
        A->>DB: UPDATE
      end`)

    expect(result.messages).toHaveLength(2)
    const gap = result.messages[1]!.y - result.messages[0]!.y
    expect(gap).toBe(40 + 28)
  })

  it('messages after a block return to normal spacing', () => {
    const result = layout(`sequenceDiagram
      A->>B: Before
      loop Retry
        A->>B: Attempt
      end
      A->>B: After`)

    expect(result.messages).toHaveLength(3)
    // msg[1] → msg[2]: no block boundary, just base row height
    const gap12 = result.messages[2]!.y - result.messages[1]!.y
    expect(gap12).toBe(40)
  })
})

describe('sequence layout – spacing properties (over random sequences)', () => {
  const ACTORS = ['A', 'B', 'C', 'D'] as const

  // Generalizes "messages outside blocks are spaced at the base row height":
  // for ANY block-free sequence, every consecutive message gap is exactly 40.
  it('block-free sequences space every message at exactly the base row height', () => {
    const arb = fc.record({
      actorCount: fc.integer({ min: 2, max: 4 }),
      msgs: fc.array(fc.record({ f: fc.nat(3), t: fc.nat(3), dash: fc.boolean() }), { minLength: 2, maxLength: 8 }),
    })
    fc.assert(
      fc.property(arb, ({ actorCount, msgs }) => {
        const actors = ACTORS.slice(0, actorCount)
        const lines = ['sequenceDiagram', ...actors.map(a => `  participant ${a}`)]
        for (const m of msgs) {
          const from = actors[m.f % actorCount]!, to = actors[m.t % actorCount]!
          if (from === to) continue
          lines.push(`  ${from}${m.dash ? '-->>' : '->>'}${to}: x`)
        }
        const result = layout(lines.join('\n'))
        for (let i = 1; i < result.messages.length; i++) {
          if (result.messages[i]!.y - result.messages[i - 1]!.y !== 40) return false
        }
        return true
      }),
      { numRuns: 400 },
    )
  })

  // Robustness over the richer generator (blocks, dividers, notes, self-calls):
  // message rows stay finite and strictly ordered, never spaced tighter than the
  // base row height — blocks/dividers/notes only ever ADD space.
  it('messages stay finite and ordered with gaps never below the base height', () => {
    const arb = fc.record({
      actorCount: fc.integer({ min: 2, max: 4 }),
      messageCount: fc.integer({ min: 1, max: 6 }),
      noteMask: fc.array(fc.boolean(), { minLength: 6, maxLength: 6 }),
      notePicks: fc.array(fc.nat(2), { minLength: 6, maxLength: 6 }),
      selfMask: fc.array(fc.boolean(), { minLength: 6, maxLength: 6 }),
    })
    fc.assert(
      fc.property(arb, input => {
        const result = layout(generatedSequenceSource(input))
        for (const m of result.messages) if (!Number.isFinite(m.y)) return false
        for (let i = 1; i < result.messages.length; i++) {
          // 1e-6 tolerance: gaps accumulate through block/divider offsets, so a
          // genuine 40 can land at 39.9999… in floating point.
          if (!(result.messages[i]!.y - result.messages[i - 1]!.y >= 40 - 1e-6)) return false
        }
        return true
      }),
      { numRuns: 400 },
    )
  })
})

describe('sequence layout – block positioning', () => {
  it('block top is above the first message with room for the header', () => {
    const result = layout(`sequenceDiagram
      A->>B: Before
      loop Retry
        A->>B: Inside
      end`)

    const block = result.blocks[0]!
    const firstMsg = result.messages[1]! // msg at index 1 is startIndex
    // Block top should be above message Y by blockPadTop (40px)
    expect(block.y).toBeLessThan(firstMsg.y)
    expect(firstMsg.y - block.y).toBe(40) // SEQ.blockPadTop
  })

  it('divider Y is between the messages it separates', () => {
    const result = layout(`sequenceDiagram
      A->>B: Login
      alt Success
        B->>A: 200
      else Failure
        B->>A: 500
      end`)

    const block = result.blocks[0]!
    expect(block.dividers).toHaveLength(1)
    const divY = block.dividers[0]!.y
    const msg1Y = result.messages[1]!.y // 200
    const msg2Y = result.messages[2]!.y // 500

    // Divider should be between the two messages
    expect(divY).toBeGreaterThan(msg1Y)
    expect(divY).toBeLessThan(msg2Y)
  })

  it('multiple dividers are each between their respective messages', () => {
    const result = layout(`sequenceDiagram
      C->>S: Login
      alt Valid
        S-->>C: 200
      else Invalid
        S-->>C: 401
      else Locked
        S-->>C: 403
      end`)

    const block = result.blocks[0]!
    expect(block.dividers).toHaveLength(2)

    // First divider between msg[1] (200) and msg[2] (401)
    expect(block.dividers[0]!.y).toBeGreaterThan(result.messages[1]!.y)
    expect(block.dividers[0]!.y).toBeLessThan(result.messages[2]!.y)

    // Second divider between msg[2] (401) and msg[3] (403)
    expect(block.dividers[1]!.y).toBeGreaterThan(result.messages[2]!.y)
    expect(block.dividers[1]!.y).toBeLessThan(result.messages[3]!.y)
  })

  it('block height encompasses all its messages', () => {
    const result = layout(`sequenceDiagram
      A->>B: Before
      alt Yes
        B->>A: Response 1
      else No
        B->>A: Response 2
      end`)

    const block = result.blocks[0]!
    const firstMsgY = result.messages[1]!.y
    const lastMsgY = result.messages[2]!.y

    // Block top is above first message
    expect(block.y).toBeLessThan(firstMsgY)
    // Block bottom is below last message
    expect(block.y + block.height).toBeGreaterThan(lastMsgY)
  })
})

describe('sequence layout – diagram dimensions', () => {
  it('diagram height increases with block extra space', () => {
    // Diagram without blocks
    const plain = layout(`sequenceDiagram
      A->>B: One
      B->>A: Two
      A->>B: Three`)

    // Diagram with same messages but wrapped in a loop block
    const withBlock = layout(`sequenceDiagram
      A->>B: One
      loop Repeat
        B->>A: Two
      end
      A->>B: Three`)

    // The block version should be taller due to header extra space
    expect(withBlock.height).toBeGreaterThan(plain.height)
    expect(withBlock.height - plain.height).toBe(28) // blockHeaderExtra
  })

  it('diagram with multiple dividers is taller than one with none', () => {
    const noDividers = layout(`sequenceDiagram
      A->>B: M1
      B->>A: M2
      A->>B: M3
      B->>A: M4`)

    const withDividers = layout(`sequenceDiagram
      A->>B: M1
      alt Case1
        B->>A: M2
      else Case2
        A->>B: M3
      else Case3
        B->>A: M4
      end`)

    // blockHeaderExtra (28) + 2 × dividerExtra (24 each) = 76 extra
    expect(withDividers.height - noDividers.height).toBe(28 + 24 + 24)
  })
})

// ============================================================================
// Clearance tests — verify that block headers, divider labels, and message
// labels don't overlap at the rendered pixel level.
//
// The renderer draws:
//   - Block header tab:  top at block.y, bottom at block.y + 18
//   - Header label text: at block.y + 9 (dominant-baseline central)
//   - Divider line:      at divider.y
//   - Divider label:     baseline at divider.y + 14
//   - Message arrow:     at msg.y
//   - Message label:     at msg.y - 10 (above the arrow)
// ============================================================================

describe('sequence layout – render clearance', () => {
  it('keeps adjacent official alt/opt fragments disjoint under role-driven group padding', () => {
    const source = `sequenceDiagram
      Alice->>Bob: Hello Bob, how are you?
      alt is sick
        Bob->>Alice: Not so good :(
      else is well
        Bob->>Alice: Feeling fresh like a daisy
      end
      opt Extra response
        Bob->>Alice: Thanks for asking
      end`

    for (const style of ['accessible-high-contrast', 'status-dashboard', 'publication-figure']) {
      const result = layoutStyled(source, style)
      expect(result.blocks).toHaveLength(2)
      const [alt, opt] = result.blocks
      expect(alt!.y + alt!.height, style).toBeLessThanOrEqual(opt!.y)
      for (const message of result.messages) {
        if (message.isSelf) continue
        const labelWidth = estimateTextWidth(message.label, style === 'accessible-high-contrast' ? 14 : 12, style === 'accessible-high-contrast' ? 700 : 600)
        expect(Math.abs(message.x2 - message.x1), `${style}: ${message.label}`).toBeGreaterThanOrEqual(labelWidth + 16)
      }
    }
  })

  it('paints fragment headers after lifelines so dashed lines cannot occlude their labels', () => {
    const svg = renderMermaidSVG(`sequenceDiagram
      Alice->>Bob: Hello
      alt is sick
        Bob->>Alice: Recover
      end`, { style: 'accessible-high-contrast', embedFontImport: false })
    const lifeline = svg.indexOf('class="lifeline"')
    const overlay = svg.indexOf('class="sequence-block-header-overlay"')
    const message = svg.indexOf('class="message"')

    expect(lifeline).toBeGreaterThan(0)
    expect(overlay).toBeGreaterThan(lifeline)
    expect(message).toBeGreaterThan(overlay)
  })

  it('block header tab bottom is above the first message label', () => {
    // The header tab has height 18, drawn starting at block.y.
    // The message label is at msg.y - 6.
    // We need: block.y + 18 < firstMsg.y - 6
    const result = layout(`sequenceDiagram
      A->>B: Before
      loop Repeat
        A->>B: Inside
      end`)

    const block = result.blocks[0]!
    const firstMsg = result.messages[1]!
    const tabBottom = block.y + 18
    const msgLabel = firstMsg.y - 6

    expect(tabBottom).toBeLessThan(msgLabel)
    // Verify at least 10px of clearance
    expect(msgLabel - tabBottom).toBeGreaterThanOrEqual(10)
  })

  it('block header tab does not overlap the previous message arrow', () => {
    // The previous message arrow is at prevMsg.y.
    // The block header tab starts at block.y.
    // We need: prevMsg.y < block.y (header starts below previous arrow)
    const result = layout(`sequenceDiagram
      A->>B: Previous
      alt Valid
        B->>A: Response
      end`)

    const prevMsg = result.messages[0]!
    const block = result.blocks[0]!

    expect(prevMsg.y).toBeLessThan(block.y)
    // Verify at least 20px clearance between previous arrow and block top
    expect(block.y - prevMsg.y).toBeGreaterThanOrEqual(20)
  })

  it('divider label does not overlap the message label below it', () => {
    // Divider label baseline at divider.y + 14 (approx bottom of text).
    // Message label at msg.y - 6.
    // We need: divider.y + 14 < msg.y - 6
    const result = layout(`sequenceDiagram
      A->>B: Login
      alt Success
        B->>A: 200
      else Failure
        B->>A: 500
      end`)

    const block = result.blocks[0]!
    const divider = block.dividers[0]!
    const msg2 = result.messages[2]! // 500 (after divider)

    const divLabelBottom = divider.y + 14
    const msgLabel = msg2.y - 6

    expect(divLabelBottom).toBeLessThan(msgLabel)
  })

  it('divider line does not overlap the previous message arrow', () => {
    // The previous message arrow is at prevMsg.y.
    // The divider line is at divider.y.
    // We need: prevMsg.y < divider.y
    const result = layout(`sequenceDiagram
      A->>B: Login
      alt Success
        B->>A: 200 OK
      else Failure
        B->>A: 500 Error
      end`)

    const block = result.blocks[0]!
    const divider = block.dividers[0]!
    const prevMsg = result.messages[1]! // 200 OK (before divider)

    expect(prevMsg.y).toBeLessThan(divider.y)
    // Verify at least 10px clearance
    expect(divider.y - prevMsg.y).toBeGreaterThanOrEqual(10)
  })

  it('alt block with 3 else: no overlap at any boundary', () => {
    const result = layout(`sequenceDiagram
      C->>S: Login
      alt Valid
        S-->>C: 200
      else Invalid
        S-->>C: 401
      else Locked
        S-->>C: 403
      end`)

    const block = result.blocks[0]!

    // Header tab bottom vs first message label
    const tabBottom = block.y + 18
    const firstMsgLabel = result.messages[1]!.y - 6
    expect(tabBottom).toBeLessThan(firstMsgLabel)

    // Each divider label vs its message label
    for (let d = 0; d < block.dividers.length; d++) {
      const divider = block.dividers[d]!
      // The message after this divider is at index (d + 2):
      // msg[0]=Login, msg[1]=200 (start), msg[2]=401 (div0), msg[3]=403 (div1)
      const msgAfter = result.messages[d + 2]!
      const divLabelBottom = divider.y + 14
      const msgLabelTop = msgAfter.y - 6
      expect(divLabelBottom).toBeLessThan(msgLabelTop)
    }

    // Each divider line is below the previous message arrow
    expect(block.dividers[0]!.y).toBeGreaterThan(result.messages[1]!.y)
    expect(block.dividers[1]!.y).toBeGreaterThan(result.messages[2]!.y)
  })

  it('long divider labels get extra offset to avoid overlapping message labels', () => {
    // "Account locked" is long enough that "[Account locked]" (left-aligned at
    // the block edge) overlaps horizontally with "403 Forbidden" (centered
    // between actors). The layout should detect this and use a larger vertical
    // offset so the two text elements don't collide.
    const result = layout(`sequenceDiagram
      participant C as Client
      participant S as Server
      C->>S: Login
      alt Valid credentials
        S-->>C: 200 OK
      else Account locked
        S-->>C: 403 Forbidden
      end`)

    const block = result.blocks[0]!
    expect(block.dividers).toHaveLength(1)

    const divider = block.dividers[0]!
    const msgAfter = result.messages[2]! // "403 Forbidden"

    // With the overlap-aware offset (36 instead of default 28), the divider
    // label baseline (divider.y + 14) should be further from the message
    // label baseline (msg.y - 6), giving at least 14px baseline clearance.
    const divLabelBaseline = divider.y + 14
    const msgLabelBaseline = msgAfter.y - 6
    const baselineClearance = msgLabelBaseline - divLabelBaseline

    expect(baselineClearance).toBeGreaterThanOrEqual(14)
  })

  it('short divider labels keep the default offset (no unnecessary extra space)', () => {
    // "No" is short enough that "[No]" doesn't reach the centered message
    // label — no overlap, so the default offset (28) is used.
    const result = layout(`sequenceDiagram
      A->>B: Login
      alt Yes
        B->>A: 200
      else No
        B->>A: 500
      end`)

    const block = result.blocks[0]!
    const divider = block.dividers[0]!
    const msgAfter = result.messages[2]!

    // Default offset 28: baseline clearance = (msg.y - 6) - (msg.y - 28 + 14) = 8
    const baselineClearance = (msgAfter.y - 6) - (divider.y + 14)
    expect(baselineClearance).toBe(8)
  })
})

// ============================================================================
// Bounding-box tests — verify that notes positioned outside the actor columns
// are fully contained within the diagram viewport after the post-processing
// shift-and-expand step (layout.ts step 6).
//
// The layout engine positions actors first, then notes may extend left of the
// first actor ("left of") or right of the last actor ("right of"). The
// bounding-box post-processing shifts all elements right if needed and expands
// the diagram width so every element has at least SEQ.padding (30px) margin.
// ============================================================================

describe('sequence layout – note bounding box', () => {
  it('note "right of" last actor is within diagram width', () => {
    const result = layout(`sequenceDiagram
      A->>B: Hello
      Note right of B: Right-side note
      B-->>A: Hi`)

    // Every note must fit within the diagram width with padding margin
    for (const note of result.notes) {
      expect(note.x).toBeGreaterThanOrEqual(0)
      expect(note.x + note.width).toBeLessThanOrEqual(result.width)
    }
  })

  it('note "left of" first actor is within diagram width', () => {
    const result = layout(`sequenceDiagram
      A->>B: Hello
      Note left of A: Left-side note
      B-->>A: Hi`)

    // Left note should have been shifted right so x >= padding (30)
    for (const note of result.notes) {
      expect(note.x).toBeGreaterThanOrEqual(0)
      expect(note.x + note.width).toBeLessThanOrEqual(result.width)
    }
  })

  it('both left and right notes are within diagram width', () => {
    const result = layout(`sequenceDiagram
      A->>B: Hello
      Note left of A: Left note
      Note right of B: Right note
      B-->>A: Hi`)

    expect(result.notes).toHaveLength(2)
    for (const note of result.notes) {
      expect(note.x).toBeGreaterThanOrEqual(0)
      expect(note.x + note.width).toBeLessThanOrEqual(result.width)
    }
  })

  it('note "over" actor stays centered and within bounds', () => {
    const result = layout(`sequenceDiagram
      A->>B: Hello
      Note over A: Centered note
      B-->>A: Hi`)

    for (const note of result.notes) {
      expect(note.x).toBeGreaterThanOrEqual(0)
      expect(note.x + note.width).toBeLessThanOrEqual(result.width)
    }
  })

  it('shift preserves relative positions of all elements', () => {
    // A "left of" note on the first actor triggers a right-shift.
    // Verify that after the shift, messages still connect the correct actors
    // (i.e. message x1/x2 match actor x positions).
    const result = layout(`sequenceDiagram
      A->>B: Hello
      Note left of A: This shifts everything
      B-->>A: Reply`)

    // Build actor lookup
    const actorX = new Map<string, number>()
    for (const a of result.actors) actorX.set(a.id, a.x)

    // Each message's x1/x2 should match its from/to actor center X
    for (const msg of result.messages) {
      expect(msg.x1).toBe(actorX.get(msg.from)!)
      expect(msg.x2).toBe(actorX.get(msg.to)!)
    }

    // Lifelines should align with their actors
    for (const ll of result.lifelines) {
      expect(ll.x).toBe(actorX.get(ll.actorId)!)
    }
  })

  it('diagram without notes has no unnecessary shift', () => {
    // No notes → no shift needed. Actors should start near SEQ.padding (30).
    const result = layout(`sequenceDiagram
      A->>B: Hello
      B-->>A: Hi`)

    // First actor center should be near the padding
    // (actorWidth/2 + padding = ~70, but the key check is no extra shift)
    const firstActorX = result.actors[0]!.x
    const firstActorLeft = firstActorX - result.actors[0]!.width / 2

    // Left edge should be at exactly SEQ.padding (30) — no shift applied
    expect(firstActorLeft).toBe(30)
  })

  it('diagram width expands for right-side notes beyond actors', () => {
    // Compare diagram with and without a right-side note
    const withoutNote = layout(`sequenceDiagram
      A->>B: Hello
      B-->>A: Hi`)

    const withNote = layout(`sequenceDiagram
      A->>B: Hello
      Note right of B: Extra wide note text here
      B-->>A: Hi`)

    // The diagram with the right-side note should be wider
    expect(withNote.width).toBeGreaterThan(withoutNote.width)
  })

  it('left-side note shifts actors right, expanding diagram width', () => {
    const withoutNote = layout(`sequenceDiagram
      A->>B: Hello
      B-->>A: Hi`)

    const withNote = layout(`sequenceDiagram
      A->>B: Hello
      Note left of A: Left note
      B-->>A: Hi`)

    // Actors should have shifted right in the note version
    expect(withNote.actors[0]!.x).toBeGreaterThan(withoutNote.actors[0]!.x)

    // The left note's left edge should be at or near padding
    const leftNote = withNote.notes[0]!
    expect(leftNote.x).toBeGreaterThanOrEqual(0)
  })
})

// ============================================================================
// Note positioning tests — verify that notes after self-messages clear the
// loop, consecutive notes stack vertically, and notes push subsequent
// messages down so nothing overlaps.
// ============================================================================

describe('sequence layout – note positioning', () => {
  it('note after a self-message is positioned below the loop', () => {
    const result = layout(`sequenceDiagram
      A->>A: Process
      Note over A: Done`)

    const msg = result.messages[0]!
    const note = result.notes[0]!

    // Self-message loop bottom is at msg.y + selfMessageHeight (30).
    // Note must start below that.
    expect(note.y).toBeGreaterThan(msg.y + 30)
  })

  it('note after a normal message has clearance from the arrow', () => {
    const result = layout(`sequenceDiagram
      A->>B: Hello
      Note over A: Noted`)

    const msg = result.messages[0]!
    const note = result.notes[0]!

    // Note should be below the message arrow
    expect(note.y).toBeGreaterThan(msg.y)
  })

  it('consecutive notes after the same message are stacked vertically', () => {
    const result = layout(`sequenceDiagram
      A->>B: Hello
      Note over A: First
      Note over A: Second
      Note over A: Third`)

    expect(result.notes).toHaveLength(3)

    // Each note starts at or below the previous note's bottom edge
    for (let i = 1; i < result.notes.length; i++) {
      const prev = result.notes[i - 1]!
      const curr = result.notes[i]!
      expect(curr.y).toBeGreaterThanOrEqual(prev.y + prev.height)
    }
  })

  it('consecutive notes after a self-message clear the loop and each other', () => {
    const result = layout(`sequenceDiagram
      A->>A: Process
      Note over A: Step 1
      Note over A: Step 2`)

    const msg = result.messages[0]!
    const note1 = result.notes[0]!
    const note2 = result.notes[1]!

    // First note below loop
    expect(note1.y).toBeGreaterThan(msg.y + 30)
    // Second note below first
    expect(note2.y).toBeGreaterThanOrEqual(note1.y + note1.height)
  })

  it('messages after notes are pushed down to avoid overlap', () => {
    // Multiple notes overflow the default self-message vertical space (70px),
    // forcing the next message to shift down.
    const withNotes = layout(`sequenceDiagram
      A->>A: Self
      Note over A: Note 1
      Note over A: Note 2
      Note over A: Note 3
      A->>B: Next`)

    const withoutNotes = layout(`sequenceDiagram
      A->>A: Self
      A->>B: Next`)

    // Gap between messages should be larger when multiple notes are present
    const gapWith = withNotes.messages[1]!.y - withNotes.messages[0]!.y
    const gapWithout = withoutNotes.messages[1]!.y - withoutNotes.messages[0]!.y

    expect(gapWith).toBeGreaterThan(gapWithout)

    // Every note's bottom edge must be above the next message's label
    const lastNote = withNotes.notes[withNotes.notes.length - 1]!
    const nextMsg = withNotes.messages[1]!
    expect(lastNote.y + lastNote.height).toBeLessThan(nextMsg.y - 10) // -10 is label offset
  })

  it('notes inside alt blocks with self-messages have no overlap', () => {
    const result = layout(`sequenceDiagram
      participant A
      participant B
      alt Case 1
        A->>A: handle()
        Note over A: Handled
      else Case 2
        B->>B: process()
        Note over B: Processed
      end`)

    // Each note must be below its self-message's loop
    for (let i = 0; i < result.notes.length; i++) {
      const note = result.notes[i]!
      const refMsg = result.messages[i]!
      expect(note.y).toBeGreaterThan(refMsg.y + 30)
    }
  })

  it('diagram height increases to accommodate notes', () => {
    const withNotes = layout(`sequenceDiagram
      A->>A: Process
      Note over A: Note 1
      Note over A: Note 2
      A->>B: Done`)

    const withoutNotes = layout(`sequenceDiagram
      A->>A: Process
      A->>B: Done`)

    expect(withNotes.height).toBeGreaterThan(withoutNotes.height)
  })

  it('all notes remain within diagram bounds', () => {
    const result = layout(`sequenceDiagram
      A->>A: Self message
      Note over A: Note 1
      Note right of A: Right note
      Note left of A: Left note`)

    for (const note of result.notes) {
      expect(note.x).toBeGreaterThanOrEqual(0)
      expect(note.x + note.width).toBeLessThanOrEqual(result.width)
      expect(note.y).toBeGreaterThanOrEqual(0)
      expect(note.y + note.height).toBeLessThanOrEqual(result.height)
    }
  })
})

// upstream: mermaid-js/mermaid#1765 — control multiple/overlapping activations
describe('sequence layout – activation/note/block properties', () => {
  it('generated activation, note, and block cases keep chrome clear of structural boxes', () => {
    fc.assert(
      fc.property(
        fc.record({
          actorCount: fc.integer({ min: 2, max: 4 }),
          messageCount: fc.integer({ min: 3, max: 8 }),
          noteMask: fc.array(fc.boolean(), { minLength: 8, maxLength: 8 }),
          notePicks: fc.array(fc.nat(2), { minLength: 8, maxLength: 8 }),
          selfMask: fc.array(fc.boolean(), { minLength: 8, maxLength: 8 }),
        }),
        input => {
          const result = layout(generatedSequenceSource(input))
          const actorBoxes = result.actors.map(actorRect)
          const noteBoxes = result.notes.map(n => ({ x: n.x, y: n.y, width: n.width, height: n.height }))

          for (let i = 1; i < result.messages.length; i++) {
            expect(result.messages[i]!.y).toBeGreaterThan(result.messages[i - 1]!.y)
          }

          for (const note of noteBoxes) {
            expectFiniteRect(note)
            expect(note.x).toBeGreaterThanOrEqual(0)
            expect(note.y).toBeGreaterThanOrEqual(0)
            expect(note.x + note.width).toBeLessThanOrEqual(result.width)
            expect(note.y + note.height).toBeLessThanOrEqual(result.height)
            for (const actor of actorBoxes) expect(overlaps(note, actor)).toBe(false)
          }
          for (let i = 0; i < noteBoxes.length; i++) {
            for (let j = i + 1; j < noteBoxes.length; j++) {
              expect(overlaps(noteBoxes[i]!, noteBoxes[j]!)).toBe(false)
            }
          }

          for (const activation of result.activations) {
            const rect = { x: activation.x, y: activation.topY, width: activation.width, height: activation.bottomY - activation.topY }
            expectFiniteRect(rect)
            expect(activation.bottomY).toBeGreaterThanOrEqual(activation.topY)
            expect(activation.topY).toBeGreaterThanOrEqual(Math.min(...result.lifelines.map(l => l.topY)))
            expect(activation.bottomY).toBeLessThanOrEqual(result.height)
            for (const actor of actorBoxes) expect(overlaps(rect, actor)).toBe(false)
          }

          for (const block of result.blocks) {
            const rect = { x: block.x, y: block.y, width: block.width, height: block.height }
            expectFiniteRect(rect)
            for (const actor of actorBoxes) expect(overlaps(rect, actor)).toBe(false)
            for (const divider of block.dividers) {
              expect(divider.y).toBeGreaterThan(block.y)
              expect(divider.y).toBeLessThan(block.y + block.height)
              const previous = result.messages.filter(m => m.y < divider.y).at(-1)
              const next = result.messages.find(m => m.y > divider.y)
              expect(previous).toBeDefined()
              expect(next).toBeDefined()
              expect(previous!.y).toBeLessThan(divider.y)
              expect(next!.y).toBeGreaterThan(divider.y)
            }
          }
        },
      ),
      { numRuns: 60 },
    )
  })
})

describe('sequence layout – complete painted bounds (#385)', () => {
  it('resolves the exact #385 opening reproduction without self-message overlap, header tab overflow, or return-arrow clipping', () => {
    const source = `sequenceDiagram
      participant A
      participant B
      loop A very long block header that must remain within the enclosing fragment
        A->>A: This very long self message should have clear space before B
      end
      A->>B: done`
    const result = layout(source)
    const selfMsg = result.messages[0]!
    const lifelineB = result.lifelines[1]!
    const loopBlock = result.blocks[0]!

    // 1. Self-message label has clear space before B's lifeline
    expect(selfMsg.labelPosition.bounds.x + selfMsg.labelPosition.bounds.width + 12).toBeLessThanOrEqual(lifelineB.x)

    // 2. Fragment header tab remains within the enclosing fragment, which remains within the canvas
    expect(loopBlock.header).toBeDefined()
    expect(loopBlock.header!.x + loopBlock.header!.width).toBeLessThanOrEqual(loopBlock.x + loopBlock.width)
    expect(loopBlock.x + loopBlock.width).toBeLessThanOrEqual(result.width - 30 + 1e-6)

    // 3. Self-message return arrow at y + 20 clears the bottom of the fragment frame
    expect(selfMsg.y + 20).toBeLessThan(loopBlock.y + loopBlock.height)
  })

  it('widens adjacent lifelines so middle-actor self-message labels do not intersect neighboring lifelines or activation bars', () => {
    const source = `sequenceDiagram
      participant A as Alice
      participant B as Service
      participant C as Worker
      A->>+B: Dispatch
      B->>B: Signal for throat clearance and audit logging
      B->>+C: Forward
      C-->>-B: Ack
      B-->>-A: Complete`
    const result = layout(source)
    const selfMsg = result.messages.find(m => m.isSelf)!
    const nextLifeline = result.lifelines[2]!
    const nextActivation = result.activations.find(a => a.actorId === 'C')!

    const selfRight = selfMsg.bounds.x + selfMsg.bounds.width
    expect(selfRight + 12).toBeLessThanOrEqual(nextLifeline.x)
    expect(selfRight).toBeLessThan(nextActivation.x)
  })

  it('keeps last-actor self-message loops and labels inside the SVG viewBox', () => {
    const source = `sequenceDiagram
      participant A
      participant B
      A->>B: Start
      B->>B: Very long self-message label on the rightmost participant`
    const result = layout(source)
    const selfMsg = result.messages[1]!
    expect(selfMsg.bounds.x + selfMsg.bounds.width).toBeLessThanOrEqual(result.width - 30 + 1e-6)
  })

  it('sizes fragments to contain long header tabs, wide divider labels, owned notes, self-messages, created participants, and nested fragments', () => {
    const source = `sequenceDiagram
      participant A
      participant B
      critical Establish a fault-tolerant quorum session across replicas
        Note left of A: Pre-flight quorum note inside critical
        A->>A: Validate local lease and epoch state
        opt Secondary verification with an extra-wide fragment header tab
          B->>B: Verify remote attestation token
          Note right of B: Right-hand audit note inside opt
        end
      option Network partition or quorum timeout while awaiting replica acknowledgements
        create actor C as Ephemeral<br/>Recovery<br/>Agent
        A->>C: Spawn recovery agent
      end`
    const result = layout(source)
    expect(result.blocks).toHaveLength(2)
    const optBlock = result.blocks.find(b => b.type === 'opt')!
    const critBlock = result.blocks.find(b => b.type === 'critical')!

    // Header tabs fit inside their own fragment widths
    expect(optBlock.header).toBeDefined()
    expect(optBlock.header!.x + optBlock.header!.width).toBeLessThanOrEqual(optBlock.x + optBlock.width + 1e-6)
    expect(critBlock.header).toBeDefined()
    expect(critBlock.header!.x + critBlock.header!.width).toBeLessThanOrEqual(critBlock.x + critBlock.width + 1e-6)

    // Wide divider label fits inside critical fragment width
    const divider = critBlock.dividers[0]!
    expect(divider.labelPosition).toBeDefined()
    expect(divider.labelPosition!.bounds.x + divider.labelPosition!.bounds.width).toBeLessThanOrEqual(critBlock.x + critBlock.width - 10 + 1e-6)

    // Owned self-messages (including return arrow at y + 20) fit inside their fragments
    const selfA = result.messages[0]!
    const selfB = result.messages[1]!
    expect(selfB.y + 20).toBeLessThanOrEqual(optBlock.y + optBlock.height - 8 + 1e-6)
    expect(selfB.bounds.x + selfB.bounds.width).toBeLessThanOrEqual(optBlock.x + optBlock.width - 10 + 1e-6)
    expect(selfA.bounds.x + selfA.bounds.width).toBeLessThanOrEqual(critBlock.x + critBlock.width - 10 + 1e-6)

    // Created icon participant C (and its 3-line below-icon label) fits inside critical fragment
    const actorC = result.actors.find(a => a.id === 'C')!
    expect(actorC.bounds.x).toBeGreaterThanOrEqual(critBlock.x + 10 - 1e-6)
    expect(actorC.bounds.x + actorC.bounds.width).toBeLessThanOrEqual(critBlock.x + critBlock.width - 10 + 1e-6)
    expect(actorC.bounds.y + actorC.bounds.height).toBeLessThanOrEqual(critBlock.y + critBlock.height - 8 + 1e-6)

    // Owned notes fit inside their fragments
    const leftNote = result.notes[0]!
    const rightNote = result.notes[1]!
    expect(leftNote.x).toBeGreaterThanOrEqual(critBlock.x + 10 - 1e-6)
    expect(leftNote.y).toBeGreaterThanOrEqual(critBlock.y)
    expect(rightNote.x + rightNote.width).toBeLessThanOrEqual(optBlock.x + optBlock.width - 10 + 1e-6)
    expect(rightNote.y + rightNote.height).toBeLessThanOrEqual(optBlock.y + optBlock.height - 8 + 1e-6)

    // Enclosing fragment contains nested fragment with declared padding
    expect(critBlock.x).toBeLessThanOrEqual(optBlock.x - 10 + 1e-6)
    expect(critBlock.x + critBlock.width).toBeGreaterThanOrEqual(optBlock.x + optBlock.width + 10 - 1e-6)
    expect(critBlock.y).toBeLessThanOrEqual(optBlock.y - 8 + 1e-6)
    expect(critBlock.y + critBlock.height).toBeGreaterThanOrEqual(optBlock.y + optBlock.height + 8 - 1e-6)
  })

  it('sizes single-message self-loop fragments so the return arrow at y + 20 stays inside the fragment bottom', () => {
    const result = layout(`sequenceDiagram
      participant A
      loop Self check
        A->>A: Ping self
      end`)
    const block = result.blocks[0]!
    const msg = result.messages[0]!
    expect(block.y + block.height).toBeGreaterThanOrEqual(msg.y + 20 + 12)
  })

  it('reserves header bounds for icon participants and multiline labels without enlarging the icon glyph', () => {
    const types = ['actor', 'boundary', 'control', 'entity', 'database', 'collections', 'queue'] as const
    for (const type of types) {
      const decl = type === 'actor' ? 'actor A as Support<br/>Engineer<br/>On call' : `participant A@{ "type": "${type}" } as Support<br/>Engineer<br/>On call`
      const source = `sequenceDiagram
        ${decl}
        participant B as Backend
        A->>B: Escalate incident`
      const result = layout(source)
      const actor = result.actors[0]!
      const lifeline = result.lifelines[0]!
      const firstMsg = result.messages[0]!

      // Glyph height stays compact (40px), while complete header bounds cover the 3-line label below it
      expect(actor.height, type).toBe(40)
      expect(actor.bounds.height, type).toBeGreaterThan(actor.height + 30)

      // First line top clears the glyph bottom (y + height)
      expect(actor.labelPosition.bounds.y, type).toBeGreaterThanOrEqual(actor.y + actor.height)

      // Lifeline starts below the full header bounds, not through the label
      const headerBottom = actor.bounds.y + actor.bounds.height
      expect(lifeline.topY, type).toBeGreaterThanOrEqual(headerBottom)

      // First message label clears the actor label
      expect(firstMsg.labelPosition.bounds.y, type).toBeGreaterThan(headerBottom)
    }
  })

  it('uses resolved metrics for custom font size, weight, tracking, uppercase capitalization, and padding', () => {
    const source = `sequenceDiagram
      actor A as Support<br/>Engineer
      participant B as Service
      alt Primary route with long header
        A->>A: Local self check before dispatch
      else Fallback route with wide section label
        A->>B: Dispatch request
      end`
    const lines = source
      .split('\n')
      .map(l => l.trim())
      .filter(l => l.length > 0)
    const parsed = parseSequenceDiagram(lines)
    const defaultPos = layoutSequenceDiagram(parsed)
    const customPos = layoutSequenceDiagram(parsed, {}, {}, {
      node: {
        fontSize: 16,
        fontWeight: 700,
        letterSpacing: 1.5,
        textTransform: 'uppercase',
        paddingX: 24,
        paddingY: 16,
      },
      edge: {
        fontSize: 15,
        fontWeight: 600,
        letterSpacing: 1.2,
        textTransform: 'uppercase',
      },
      group: {
        fontSize: 15,
        fontWeight: 700,
        letterSpacing: 1.5,
        textTransform: 'uppercase',
        paddingX: 18,
        paddingY: 14,
      },
    })

    // Custom metrics and uppercase transform widen and heighten actors, self-loops, and fragments
    expect(customPos.actors[0]!.labelPosition.text).toBe('SUPPORT\nENGINEER')
    expect(customPos.actors[0]!.bounds.width).toBeGreaterThan(defaultPos.actors[0]!.bounds.width)
    expect(customPos.actors[0]!.bounds.height).toBeGreaterThan(defaultPos.actors[0]!.bounds.height)

    // Self-message clears B's lifeline under larger font + tracking + uppercase
    const selfMsg = customPos.messages[0]!
    const lifelineB = customPos.lifelines[1]!
    expect(selfMsg.labelPosition.text).toBe('LOCAL SELF CHECK BEFORE DISPATCH')
    expect(selfMsg.bounds.x + selfMsg.bounds.width + 12).toBeLessThanOrEqual(lifelineB.x)

    // Fragment header tab and divider label respect custom group padding and stay inside block
    const block = customPos.blocks[0]!
    expect(block.header).toBeDefined()
    expect(block.header!.label.x).toBe(block.x + 18)
    expect(block.header!.label.bounds.x + block.header!.label.bounds.width).toBeLessThanOrEqual(block.header!.x + block.header!.width)
    expect(block.header!.x + block.header!.width).toBeLessThanOrEqual(block.x + block.width - 18 + 1e-6)

    const divider = block.dividers[0]!
    expect(divider.labelPosition).toBeDefined()
    expect(divider.labelPosition!.x).toBe(block.x + 8)
    expect(divider.labelPosition!.bounds.x + divider.labelPosition!.bounds.width).toBeLessThanOrEqual(block.x + block.width - 18 + 1e-6)
    expect(divider.labelPosition!.bounds.y + divider.labelPosition!.bounds.height).toBeLessThan(customPos.messages[1]!.labelPosition.bounds.y)
  })

  it('preserves contrast and opaque/translucent nested rect layering across crisp and styled looks', () => {
    const source = `sequenceDiagram
      box DarkSlateBlue Core Services
        participant A as Gateway
        participant B as Auth
      end
      alt Authenticated
        rect rgba(16, 185, 129, 0.22)
          A->>B: Verify token
        end
      else Unauthenticated
        B-->>A: 401 Unauthorized
      end`
    for (const style of [undefined, 'accessible-high-contrast', 'blueprint']) {
      const svg = renderMermaidSVG(source, { ...(style ? { style } : {}), embedFontImport: false })
      // Enclosing alt background paints before nested rect, and alt frame/dividers paint above rect fill
      const altBgIdx = svg.indexOf('data-type="alt"')
      const rectBgIdx = svg.indexOf('data-type="rect"')
      const frameOverlayIdx = svg.indexOf('class="sequence-block-frame-overlay"')
      const dividerOverlayIdx = svg.indexOf('class="sequence-block-divider-overlay"')
      const lifelineIdx = svg.indexOf('class="lifeline"')
      expect(altBgIdx).toBeGreaterThan(0)
      expect(rectBgIdx).toBeGreaterThan(altBgIdx)
      expect(frameOverlayIdx).toBeGreaterThan(rectBgIdx)
      expect(dividerOverlayIdx).toBeGreaterThan(rectBgIdx)
      expect(lifelineIdx).toBeGreaterThan(dividerOverlayIdx)
    }
  })

  it('projects complete actor and fragment bounds through layoutMermaid()', () => {
    const source = `sequenceDiagram
      actor A as Support<br/>Engineer<br/>On call
      participant B as Backend
      loop Health check with a very long fragment header tab
        A->>B: Ping
      end`
    const pos = layout(source)
    const parsed = parseMermaid(source)
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    const projected = layoutMermaid(parsed.value)
    const nodeA = projected.nodes.find(n => n.id === 'A')!
    const group0 = projected.groups[0]!

    expect(Number(nodeA.h)).toBe(Math.round(pos.actors[0]!.bounds.height))
    expect(Number(group0.w)).toBe(Math.round(pos.blocks[0]!.bounds.width))
  })

  it('emits final SVG geometry whose <rect>, <line>, <polyline>, <text>, <tspan>, and transform attributes satisfy non-overlap invariants', () => {
    const source = `sequenceDiagram
      actor A as Support<br/>Engineer<br/>On call
      participant B as API Gateway
      participant C as Worker
      loop HealthCheck
        B->>B: Validate token and refresh lease
        opt Nested verification with a long header label
          A->>B: Ping
          Note right of B: Gateway note
        end
      end
      B->>C: Forward`
    const svg = renderMermaidSVG(source, { embedFontImport: false })

    // 1. Parse viewBox
    const vbMatch = svg.match(/viewBox="0 0 ([0-9.]+) ([0-9.]+)"/)
    expect(vbMatch).not.toBeNull()
    const svgWidth = Number(vbMatch![1])
    const svgHeight = Number(vbMatch![2])

    // 2. Actor icon transform + label tspans + lifeline topY
    const actorGroupMatch = svg.match(/<g class="actor" data-id="A"[\s\S]*?<\/text>\s*<\/g>/)
    expect(actorGroupMatch).not.toBeNull()
    const translateMatch = actorGroupMatch![0].match(/transform="translate\(([0-9.]+),([0-9.]+)\) scale\(([0-9.]+)\)"/)
    expect(translateMatch).not.toBeNull()
    const iconTopY = Number(translateMatch![2])
    const iconScale = Number(translateMatch![3])
    const iconBottomY = iconTopY + 24 * iconScale

    const actorTextMatch = actorGroupMatch![0].match(/<text x="([0-9.]+)" y="([0-9.]+)"[^>]*font-size="([0-9.]+)"[^>]*>([\s\S]*?)<\/text>/)
    expect(actorTextMatch).not.toBeNull()
    const actorTextY = Number(actorTextMatch![2])
    const actorFontSize = Number(actorTextMatch![3])
    const tspanCount = (actorTextMatch![4]!.match(/<tspan /g) ?? []).length
    expect(tspanCount).toBe(3)
    const firstTspanDyMatch = actorTextMatch![4]!.match(/<tspan [^>]*dy="([-0-9.]+)"/)
    const firstLineCenterY = actorTextY + Number(firstTspanDyMatch?.[1] ?? 0)
    const lastLineCenterY = firstLineCenterY + (tspanCount - 1) * actorFontSize * 1.3
    expect(firstLineCenterY - actorFontSize / 2).toBeGreaterThanOrEqual(iconBottomY)

    const lifelineAMatch = svg.match(/<line class="lifeline" data-actor="A" x1="([0-9.]+)" y1="([0-9.]+)" x2="([0-9.]+)" y2="([0-9.]+)"/)
    expect(lifelineAMatch).not.toBeNull()
    const lifelineATopY = Number(lifelineAMatch![2])
    expect(lifelineATopY).toBeGreaterThan(lastLineCenterY + actorFontSize / 2)

    // 3. Self-message polyline + label clear lifeline C
    const lifelineCMatch = svg.match(/<line class="lifeline" data-actor="C" x1="([0-9.]+)"/)
    expect(lifelineCMatch).not.toBeNull()
    const lifelineCX = Number(lifelineCMatch![1])

    const selfMsgMatch = svg.match(/<g class="message" data-label="Validate token and refresh lease"[\s\S]*?<polyline points="([^"]+)"[\s\S]*?<text x="([0-9.]+)" y="([0-9.]+)"[^>]*font-size="([0-9.]+)"/)
    expect(selfMsgMatch).not.toBeNull()
    const polyXs = selfMsgMatch![1]!
      .trim()
      .split(/\s+/)
      .map(pt => Number(pt.split(',')[0]))
    const selfLabelX = Number(selfMsgMatch![2])
    const selfFontSize = Number(selfMsgMatch![4])
    const selfLabelRight = selfLabelX + estimateTextWidth('Validate token and refresh lease', selfFontSize, 400)
    expect(Math.max(...polyXs)).toBeLessThan(lifelineCX)
    expect(selfLabelRight).toBeLessThan(lifelineCX)

    // 4. Fragment <rect> elements contain their header tabs and stay within viewBox
    const blockRects = [...svg.matchAll(/<g class="block" data-type="([^"]+)"[^>]*>\s*<rect x="([0-9.]+)" y="([0-9.]+)" width="([0-9.]+)" height="([0-9.]+)"/g)].map(m => ({
      type: m[1]!,
      x: Number(m[2]),
      y: Number(m[3]),
      width: Number(m[4]),
      height: Number(m[5]),
    }))
    const headerRects = [...svg.matchAll(/<g class="sequence-block-header-overlay"[^>]*>\s*<rect x="([0-9.]+)" y="([0-9.]+)" width="([0-9.]+)" height="([0-9.]+)"/g)].map(m => ({
      x: Number(m[1]),
      y: Number(m[2]),
      width: Number(m[3]),
      height: Number(m[4]),
    }))
    expect(blockRects).toHaveLength(2)
    expect(headerRects).toHaveLength(2)
    for (let i = 0; i < blockRects.length; i++) {
      const b = blockRects[i]!
      const h = headerRects[i]!
      expect(b.x).toBeGreaterThanOrEqual(0)
      expect(b.y).toBeGreaterThanOrEqual(0)
      expect(b.x + b.width).toBeLessThanOrEqual(svgWidth + 1e-6)
      expect(b.y + b.height).toBeLessThanOrEqual(svgHeight + 1e-6)
      expect(h.x + h.width).toBeLessThanOrEqual(b.x + b.width + 1e-6)
    }
  })
})
