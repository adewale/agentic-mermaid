// Property: a color validator admits only what the parser behind it reads.
// Each gate in front of a color parser (isHexColor before parseHex,
// isCssColorToken before a sequence box's paint, the scene's safeCssPaint
// before the renderers' contrast math) must pass only forms that parser turns
// into finite channels. Gates looser than their parsers let `constructor` (a
// named-color lookup that reached Object.prototype) throw a TypeError, a pie
// theme color of `#abcd` (#RGBA admitted by the gate, refused by the parser)
// crash the render, and `box #12345 Team` fail scene validation over a word
// Mermaid reads as a comment. End to end, an authored color in any
// color-bearing syntax renders or, when it is not a safe CSS paint, is refused
// with an error that names the value, so an agent can correct it from the
// message; a typed style op refuses the same colors when the diagram is built.
// It never throws anything else and never draws NaN or an unreadable hex.
// Seed pinned globally (fc-seed.preload.ts).
import { describe, expect, test } from 'bun:test'
import fc from 'fast-check'

import { renderMermaidSVG } from '../index.ts'
import { buildMermaid, serializeMermaid } from '../agent/index.ts'
import type { RenderOptions } from '../types.ts'
import { compositeCssColor, isHexColor, isSixDigitHex, parseHex, relativeLuminance, tryParseCssColor, tryParseHex } from '../shared/color-math.ts'
import { safeCssPaint } from '../shared/css-color.ts'
import { contrastTextColor } from '../color-resolver.ts'
import { boxColorToHex, isCssColorToken } from '../sequence/colors.ts'
import { parseSequenceDiagram } from '../sequence/parser.ts'

const NUM_RUNS = 500
const RENDER_RUNS = 300

// Color-ish words: every hex length from 1 to 9 digits; color functions with
// in-range, out-of-range, malformed and modern-syntax arguments; named colors;
// Object.prototype member names; and safe words that are not colors.
const hexArb = fc.array(fc.constantFrom(...'0123456789abcdefABCDEF'), { minLength: 1, maxLength: 9 })
  .map(digits => `#${digits.join('')}`)
const argumentArb = fc.constantFrom('0', '12', '255', '256', '-1', '300', '50%', '101%', '0.5', '1.5', '.25', '120deg', '0.5turn', 'none', 'x', '')
const functionArb = fc.record({
  name: fc.constantFrom('rgb', 'rgba', 'hsl', 'hsla', 'RGB', 'hwb', 'color-mix', 'url', 'var'),
  args: fc.array(argumentArb, { maxLength: 5 }),
  separator: fc.constantFrom(', ', ',', ' '),
  alpha: fc.option(argumentArb, { nil: undefined }),
}).map(({ name, args, separator, alpha }) => `${name}(${args.join(separator)}${alpha === undefined ? '' : ` / ${alpha}`})`)
const wordArb = fc.constantFrom(
  'red', 'Aqua', 'REBECCAPURPLE', 'transparent', 'currentColor', 'inherit', 'none', 'notacolor',
  'constructor', '__proto__', 'toString', 'hasOwnProperty', 'valueOf',
)
const colorishArb = fc.oneof(hexArb, functionArb, wordArb)
// The unit gates also see arbitrary text; the rendered placements stay
// color-ish so the diagram around them still parses.
const anyTextArb = fc.oneof(colorishArb, fc.string({ maxLength: 12 }))

const channelsInRange = (channels: readonly number[]): boolean =>
  channels.every(value => Number.isFinite(value) && value >= 0 && value <= 255)

describe('color validators admit only what their parsers read', () => {
  test('the hex gate, the hex parser and the CSS parser agree on hex', () => {
    fc.assert(fc.property(anyTextArb, text => {
      const admitted = isHexColor(text)
      expect(tryParseHex(text) !== null).toBe(admitted)
      if (/^#[0-9a-f]*$/i.test(text)) expect(tryParseCssColor(text) !== null).toBe(admitted)
      if (admitted) expect(channelsInRange(parseHex(text))).toBe(true)
    }), { numRuns: NUM_RUNS })
  })

  test('a box header color is one the box painter and the scene can read', () => {
    fc.assert(fc.property(anyTextArb, text => {
      if (!isCssColorToken(text)) return
      const rgba = tryParseCssColor(text)
      expect(rgba).not.toBeNull()
      expect(channelsInRange(rgba!.slice(0, 3))).toBe(true)
      expect(rgba![3] >= 0 && rgba![3] <= 1).toBe(true)
      expect(safeCssPaint(text)).toBeDefined()
      const hex = boxColorToHex(text)
      if (hex !== null) expect(isSixDigitHex(hex)).toBe(true)
    }), { numRuns: NUM_RUNS })
  })

  test('a box header takes a color only through the gate and otherwise keeps its words', () => {
    fc.assert(fc.property(colorishArb, color => {
      const header = `${color} Team`
      const [box] = parseSequenceDiagram(['sequenceDiagram', `box ${header}`, 'participant A', 'end']).boxes!
      if (box!.color === undefined) {
        // A `#` that does not start a color starts a comment, as Mermaid lexes it.
        expect(box!.label).toBe(header.split('#')[0]!.trim() || undefined)
      } else {
        expect(isCssColorToken(box!.color)).toBe(true)
        expect(box!.label).toBe('Team')
      }
    }), { numRuns: NUM_RUNS })
  })

  test('whatever the scene admits, the contrast math reads without throwing', () => {
    fc.assert(fc.property(anyTextArb, text => {
      if (safeCssPaint(text) === undefined) return
      const rgba = tryParseCssColor(text)
      if (rgba !== null) expect(rgba.every(Number.isFinite)).toBe(true)
      const luminance = relativeLuminance(text)
      if (luminance !== null) expect(luminance >= 0 && luminance <= 1).toBe(true)
      const composite = compositeCssColor(text, '#ffffff')
      if (composite !== null) expect(channelsInRange(composite)).toBe(true)
      expect([undefined, '#000000', '#FFFFFF']).toContain(contrastTextColor(text))
    }), { numRuns: NUM_RUNS })
  })
})

const FLOWCHART = 'flowchart TD\n  A --> B'
const PLACEMENTS: Record<string, (color: string) => readonly [source: string, options?: RenderOptions]> = {
  'flowchart style fill': color => [`${FLOWCHART}\n  style A fill:${color}`],
  'flowchart style stroke': color => [`${FLOWCHART}\n  style A stroke:${color}`],
  'flowchart style color': color => [`${FLOWCHART}\n  style A color:${color}`],
  'flowchart classDef': color => [`flowchart TD\n  A:::hot --> B\n  classDef hot fill:${color}`],
  'flowchart linkStyle': color => [`${FLOWCHART}\n  linkStyle 0 stroke:${color}`],
  'state classDef': color => [`stateDiagram-v2\n  A --> B\n  classDef hot fill:${color}\n  class A hot`],
  'class style fill': color => [`classDiagram\n  class A\n  style A fill:${color}`],
  'class style color': color => [`classDiagram\n  class A\n  style A color:${color}`],
  'class classDef': color => [`classDiagram\n  class A:::hot\n  classDef hot fill:${color}`],
  'er style fill': color => [`erDiagram\n  A ||--o{ B : has\n  style A fill:${color}`],
  'sequence box': color => [`sequenceDiagram\n  box ${color} Team\n    participant A\n  end\n  A->>A: hi`],
  'sequence rect': color => [`sequenceDiagram\n  participant A\n  rect ${color}\n    A->>A: hi\n  end`],
  'pie theme color': color => [`%%{init: {"themeVariables": {"pie1": ${JSON.stringify(color)}}}}%%\npie\n  "A": 1\n  "B": 2`],
  'theme primaryColor': color => [`%%{init: {"themeVariables": {"primaryColor": ${JSON.stringify(color)}}}}%%\n${FLOWCHART}`],
  'option bg': color => [FLOWCHART, { bg: color }],
  'option fg': color => [FLOWCHART, { fg: color }],
  'option accent': color => [FLOWCHART, { accent: color }],
}
// Agentic Mermaid fails closed on a color that is not a safe CSS paint, where a
// browser would ignore it. RenderOptions admission names the option; a style,
// classDef or linkStyle directive names itself, the property and the value. A
// sequence rect, whose argument is background paint with no label to fall back
// to, also refuses colors that are not concrete.
const OPTION_REFUSAL = /^Invalid RenderOptions: render option "(?:bg|fg|accent)" must be a safe, non-fetching CSS paint/
const RECT_REFUSAL = /^SEQUENCE_RECT_COLOR_UNSUPPORTED: /
const HEX_PAINT_ATTRIBUTE = /\s(?:fill|stroke|color|stop-color|flood-color)="(#[^"]*)"/g
const HEX_CUSTOM_PROPERTY = /--[\w-]+\s*:\s*(#[^\s;"}]*)/g

describe('an authored color renders, or is refused because it is not a safe paint', () => {
  test('in every color-bearing syntax, with no NaN or unreadable hex drawn', () => {
    fc.assert(fc.property(fc.constantFrom(...Object.keys(PLACEMENTS)), colorishArb, (placement, color) => {
      const [source, options] = PLACEMENTS[placement]!(color)
      let svg: string
      try {
        svg = renderMermaidSVG(source, options)
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        if (placement === 'sequence rect' && RECT_REFUSAL.test(message)) return
        expect(safeCssPaint(color)).toBeUndefined()
        if (placement.startsWith('option ')) expect(message).toMatch(OPTION_REFUSAL)
        else expect(message).toContain(`${JSON.stringify(color)} is not a CSS color — expected `)
        return
      }
      expect(svg).not.toContain('NaN')
      for (const [, hex] of [...svg.matchAll(HEX_PAINT_ATTRIBUTE), ...svg.matchAll(HEX_CUSTOM_PROPERTY)]) {
        expect(isHexColor(hex!)).toBe(true)
      }
    }), {
      numRuns: RENDER_RUNS,
      // Inputs that crashed before each gate agreed with its parser.
      examples: [
        ['class style fill', 'constructor'],
        ['theme primaryColor', 'constructor'],
        ['option accent', 'constructor'],
        ['sequence box', 'constructor'],
        ['pie theme color', '#abcd'],
      ],
    })
  }, 120_000)
})

// Each family's typed style ops, building a diagram whose one style carries
// the generated paint.
const STYLE_OPS: Record<string, (style: string) => readonly [family: string, ops: readonly object[]]> = {
  'flowchart define_class': style => ['flowchart', [{ kind: 'add_node', id: 'A', label: 'A' }, { kind: 'define_class', name: 'hot', style }, { kind: 'set_node_class', id: 'A', className: 'hot' }]],
  'flowchart set_node_style': style => ['flowchart', [{ kind: 'add_node', id: 'A', label: 'A' }, { kind: 'set_node_style', id: 'A', style }]],
  'state set_state_style': style => ['state', [{ kind: 'add_state', id: 'A' }, { kind: 'set_state_style', id: 'A', style }]],
  'class set_class_style': style => ['class', [{ kind: 'add_class', id: 'Account' }, { kind: 'set_class_style', class: 'Account', style }]],
  'er set_entity_style': style => ['er', [{ kind: 'add_entity', id: 'CUSTOMER' }, { kind: 'set_entity_style', entity: 'CUSTOMER', style }]],
}

describe('a typed style op accepts a color exactly when the scene can paint it', () => {
  test('and a diagram built from accepted ops renders', () => {
    fc.assert(fc.property(fc.constantFrom(...Object.keys(STYLE_OPS)), fc.constantFrom('fill', 'stroke', 'color'), colorishArb, (op, property, color) => {
      const [family, ops] = STYLE_OPS[op]!(`${property}:${color}`)
      const built = buildMermaid(family as never, ops as never)
      if (safeCssPaint(color) === undefined) {
        expect(built.ok).toBe(false)
        if (!built.ok) {
          expect(built.error.code).toBe('INVALID_OP')
          expect(built.error.message).toContain(`${property} ${JSON.stringify(color)} is not a CSS color — expected `)
        }
        return
      }
      expect(built.ok).toBe(true)
      if (built.ok) expect(() => renderMermaidSVG(serializeMermaid(built.value))).not.toThrow()
    }), { numRuns: RENDER_RUNS })
  }, 120_000)
})
