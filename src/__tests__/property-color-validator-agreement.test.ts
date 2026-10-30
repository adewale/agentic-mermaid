// Property: a color validator admits only what the parser behind it reads.
// Each gate in front of a color parser (isHexColor before parseHex,
// isCssColorToken before a sequence box's paint, the scene's safeCssPaint
// before the renderers' contrast math) must pass only forms that parser turns
// into finite channels. Gates looser than their parsers let `constructor` (a
// named-color lookup that reached Object.prototype) throw a TypeError, a pie
// theme color of `#abcd` (#RGBA admitted by the gate, refused by the parser)
// crash the render, and `box #12345 Team` fail scene validation over a word
// Mermaid reads as a comment. End to end, an authored color in any
// color-bearing syntax renders or is refused with an error that names the
// value, so an agent can correct it from the message: a style, classDef or
// linkStyle paint or a theme color exactly when it is not a CSS color the scene
// can draw; a render option, Style palette token or Style role color when it
// is not a safe CSS paint or names no color, alike on SVG, PNG and MCP. A typed style op
// refuses the same colors as the directives when the diagram is built. Nothing
// else is thrown, and no NaN or unreadable hex is ever drawn.
// Seed pinned globally (fc-seed.preload.ts).
import { describe, expect, test } from 'bun:test'
import fc from 'fast-check'
import { fcParameters } from './helpers/fc-parameters.ts'

import { renderMermaidASCII, renderMermaidSVG } from '../index.ts'
import { buildMermaid, serializeMermaid, verifyMermaid } from '../agent/index.ts'
import { renderMermaidPNG } from '../agent/png.ts'
import { createRenderPngTool, validateMcpToolArguments } from '../mcp/tool-surface.ts'
import type { MermaidRuntimeConfig } from '../mermaid-source.ts'
import type { RenderOptions } from '../types.ts'
import { compositeCssColor, isHexColor, isSixDigitHex, parseHex, relativeLuminance, tryParseCssColor, tryParseHex } from '../shared/color-math.ts'
import { safeCssPaint } from '../shared/css-color.ts'
import { scanSvgStartTags } from '../svg-structure.ts'

import { contrastTextColor } from '../color-resolver.ts'
import { boxColorToHex, isCssColorToken } from '../sequence/colors.ts'
import { parseSequenceDiagram } from '../sequence/parser.ts'

test.each(['\n', '\r', '\r\n', '\u2028', '\u2029', ' '])('simple custom-property paints retain trimming with suffix %j', suffix => {
  expect(safeCssPaint(`var(--_line)${suffix}`)).toBe('var(--_line)')
  expect(safeCssPaint(` ${suffix}var(--_line)${suffix}`)).toBe('var(--_line)')
})

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
// These grammars carry their own admission expectation. Do not classify the
// generated colors through the validator being tested: two consumers sharing
// the same overly generous gate must not make an invalid color pass.
const byteArb = fc.integer({ min: 0, max: 255 })
const percentArb = fc.integer({ min: 0, max: 100 })
const alphaArb = fc.integer({ min: 0, max: 100 }).map(n => String(n / 100))
const validColorArb = fc.oneof(
  fc.constantFrom(3, 4, 6, 8).chain(length => fc.array(fc.constantFrom(...'0123456789abcdefABCDEF'), { minLength: length, maxLength: length })
    .map(digits => `#${digits.join('')}`)),
  fc.tuple(byteArb, byteArb, byteArb).map(([r, g, b]) => `rgb(${r}, ${g}, ${b})`),
  fc.tuple(byteArb, byteArb, byteArb, alphaArb).map(([r, g, b, a]) => `rgb(${r} ${g} ${b} / ${a})`),
  fc.tuple(byteArb, byteArb, byteArb, alphaArb).map(([r, g, b, a]) => `rgba(${r}, ${g}, ${b}, ${a})`),
  fc.tuple(fc.integer({ min: 0, max: 359 }), percentArb, percentArb, alphaArb)
    .map(([h, s, l, a]) => `hsl(${h} ${s}% ${l}% / ${a})`),
  fc.constantFrom('red', 'Aqua', 'REBECCAPURPLE', 'transparent', 'currentColor', 'var(--brand)'),
)
const invalidColorArb = fc.oneof(
  // An ASCII word with a distinctive prefix can never be a named CSS color.
  fc.array(fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz'), { minLength: 1, maxLength: 12 }).map(letters => `notacolor${letters.join('')}`),
  fc.constantFrom(1, 2, 5, 7, 9).chain(length => fc.array(fc.constantFrom(...'0123456789abcdef'), { minLength: length, maxLength: length })
    .map(digits => `#${digits.join('')}`)),
  fc.tuple(fc.constantFrom('rgb', 'rgba', 'hsl', 'hsla'), byteArb)
    .map(([name, n]) => `${name}(${n} x ${n})`),
  fc.tuple(byteArb, byteArb, byteArb, alphaArb)
    .map(([r, g, b, a]) => `rgb(${r} ${g} ${b} / ${a} / junk)`),
  fc.constantFrom('constructor', '__proto__', 'toString', 'inherit', 'url(#paint)'),
)
const classifiedColorArb = fc.oneof(
  validColorArb.map(color => ({ color, valid: true })),
  invalidColorArb.map(color => ({ color, valid: false })),
)
// The unit gates also see arbitrary text; the rendered placements stay
// color-ish so the diagram around them still parses.
const anyTextArb = fc.oneof(colorishArb, fc.string({ unit: 'binary', maxLength: 12 }))

const channelsInRange = (channels: readonly number[]): boolean =>
  channels.every(value => Number.isFinite(value) && value >= 0 && value <= 255)

describe('color validators admit only what their parsers read', () => {
  test('the hex gate, the hex parser and the CSS parser agree on hex', () => {
    fc.assert(fc.property(anyTextArb, text => {
      const admitted = isHexColor(text)
      expect(tryParseHex(text) !== null).toBe(admitted)
      if (/^#[0-9a-f]*$/i.test(text)) expect(tryParseCssColor(text) !== null).toBe(admitted)
      if (admitted) expect(channelsInRange(parseHex(text))).toBe(true)
    }), fcParameters({ numRuns: NUM_RUNS }))
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
    }), fcParameters({ numRuns: NUM_RUNS }))
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
    }), fcParameters({ numRuns: NUM_RUNS }))
  })

  test('compositing a translucent color stays within 0..255', () => {
    // Found by the property below: the blend overshot 255 by a rounding error.
    const composite = compositeCssColor('#0F05', '#ffffff')!
    expect(composite.map(Math.round)).toEqual([170, 255, 170])
    expect(channelsInRange(composite)).toBe(true)
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
    }), fcParameters({ numRuns: NUM_RUNS }))
  })
})

const FLOWCHART = 'flowchart TD\n  A --> B'
const configured = (body: string, config: MermaidRuntimeConfig): readonly [string, RenderOptions] => [body, { mermaidConfig: config }]
const PLACEMENTS: Record<string, (color: string) => readonly [source: string, options?: RenderOptions]> = {
  'flowchart style fill': color => [`${FLOWCHART}\n  style A fill:${color}`],
  'flowchart style stroke': color => [`${FLOWCHART}\n  style A stroke:${color}`],
  'flowchart style color': color => [`${FLOWCHART}\n  style A color:${color}`],
  'flowchart classDef': color => [`flowchart TD\n  A:::hot --> B\n  classDef hot fill:${color}`],
  'flowchart linkStyle': color => [`${FLOWCHART}\n  linkStyle 0 stroke:${color}`],
  'state classDef': color => [`stateDiagram-v2\n  A --> B\n  classDef hot fill:${color}\n  class A hot`],
  'state linkStyle': color => [`stateDiagram-v2\n  A --> B\n  linkStyle 0 stroke:${color}`],
  'class style fill': color => [`classDiagram\n  class A\n  style A fill:${color}`],
  'class style color': color => [`classDiagram\n  class A\n  style A color:${color}`],
  'class classDef': color => [`classDiagram\n  class A:::hot\n  classDef hot fill:${color}`],
  'er style fill': color => [`erDiagram\n  A ||--o{ B : has\n  style A fill:${color}`],
  'block style fill': color => [`block\n  A["Card"]\n  style A fill:${color}`],
  'requirement style fill': color => [`requirementDiagram\n  requirement A {\n    text: "Card"\n  }\n  style A fill:${color}`],
  'quadrant point color': color => [`quadrantChart\n  A: [0.5, 0.5] color: ${color}`],
  'c4 element color': color => [`C4Context\n  System(a,"A")\n  UpdateElementStyle(a,$bgColor=${JSON.stringify(color)})`],
  'gantt todayMarker': color => [`gantt\n  dateFormat YYYY-MM-DD\n  todayMarker stroke:${color}\n  Build : task, 2024-01-01, 3d`, { ganttToday: '2024-01-02' }],
  'sequence box': color => [`sequenceDiagram\n  box ${color} Team\n    participant A\n  end\n  A->>A: hi`],
  'sequence rect': color => [`sequenceDiagram\n  participant A\n  rect ${color}\n    A->>A: hi\n  end`],
  // One representative per family/config shape; the exhaustive key inventory
  // already belongs to theme-color-admission.test.ts.
  'pie theme color': color => configured('pie\n  "A": 1\n  "B": 2', { themeVariables: { pie1: color } }),
  'theme primaryColor': color => configured(FLOWCHART, { themeVariables: { primaryColor: color } }),
  'gitgraph theme color': color => configured('gitGraph\n  commit id:"A"', { themeVariables: { git0: color } }),
  'timeline theme color': color => configured('timeline\n  2020 : Start', { themeVariables: { cScale0: color } }),
  'timeline config color': color => configured('timeline\n  2020 : Start', { timeline: { sectionFills: [color] } }),
  'journey config color': color => configured('journey\n  title Work\n  section S\n  Task: 3: Me', { journey: { titleColor: color } }),
  'radar theme color': color => configured('radar-beta\n  axis a, b, c\n  curve x{1,2,3}\n  max 5', { themeVariables: { radar: { axisColor: color } } }),
  'architecture theme color': color => configured('architecture-beta\n  group app(cloud)[App]\n  service api(server)[API] in app', { themeVariables: { clusterBkg: color } }),
  'xychart theme color': color => configured('xychart\n  x-axis [A, B]\n  y-axis 0 --> 2\n  bar [1, 2]', { themeVariables: { xyChart: { plotColorPalette: [color] } } }),
  'xychart data label color': color => configured('xychart\n  x-axis [A, B]\n  y-axis 0 --> 2\n  bar [1, 2]', { xyChart: { showDataLabel: true }, themeVariables: { xyChart: { dataLabelColor: color } } }),
  'sankey link color': color => configured('sankey-beta\n  A,B,1', { sankey: { linkColor: color } }),
  'sankey node color': color => configured('sankey-beta\n  A,B,1', { sankey: { nodeColors: { A: color } } }),
}
// Agentic Mermaid fails closed where a browser would ignore the color. A
// style, classDef or linkStyle paint, or a theme color, is
// refused exactly when it is not a CSS color the scene can draw, and the
// message names the directive or theme key, the property and the value. A
// sequence rect, whose argument is background paint with no label to fall back
// to, also refuses colors that are not concrete.
const RECT_REFUSAL = /^SEQUENCE_RECT_COLOR_UNSUPPORTED: /
const HEX_PAINT_ATTRIBUTE = /\s(?:fill|stroke|color|stop-color|flood-color)="(#[^"]*)"/g
const HEX_CUSTOM_PROPERTY = /--[\w-]+\s*:\s*(#[^\s;"}]*)/g
const authoredPlacements = Object.keys(PLACEMENTS).filter(placement => !placement.startsWith('sequence '))
const inputFormArb = fc.constantFrom('init', 'frontmatter', 'options')

function authoredInput(placement: string, color: string, form: string): readonly [string, RenderOptions?] {
  const [body, options] = PLACEMENTS[placement]!(color)
  if (!options?.mermaidConfig || form === 'options') return [body, options]
  const config = JSON.stringify(options.mermaidConfig)
  return [form === 'init' ? `%%{init: ${config}}%%\n${body}` : `---\nconfig: ${config}\n---\n${body}`]
}

function expectFinitePaints(svg: string): void {
  expect(svg).not.toContain('NaN')
  for (const [, hex] of [...svg.matchAll(HEX_PAINT_ATTRIBUTE), ...svg.matchAll(HEX_CUSTOM_PROPERTY)]) {
    expect(hex).toMatch(/^#(?:[\da-f]{3,4}|[\da-f]{6}|[\da-f]{8})$/i)
  }
}

describe('an authored color renders, or is refused because it cannot be drawn', () => {
  test('independently valid colors render on every output and verify through each config form', () => {
    fc.assert(fc.property(fc.constantFrom(...authoredPlacements), validColorArb, inputFormArb, (placement, color, form) => {
      const [source, options] = authoredInput(placement, color, form)
      let svg = ''
      expect(() => { svg = renderMermaidSVG(source, options) }, placement).not.toThrow()
      expectFinitePaints(svg)
      for (const useAscii of [true, false]) {
        let terminal = ''
        expect(() => { terminal = renderMermaidASCII(source, { ...options, useAscii }) }, `${placement}: ${useAscii ? 'ASCII' : 'Unicode'}`).not.toThrow()
        expect(terminal.trim().length).toBeGreaterThan(0)
      }
      let png: Uint8Array = new Uint8Array()
      expect(() => { png = renderMermaidPNG(source, options) }, `${placement}: PNG`).not.toThrow()
      expect([...png.slice(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10])
      expect(verifyMermaid(source, { renderOptions: options }).warnings.filter(warning => warning.code === 'RENDER_FAILED' || warning.code === 'INTERNAL_ERROR'), `${placement}: verify`).toEqual([])
    }), fcParameters({
      // PNG materialization is bounded; the examples also guarantee every
      // placement reaches the accepted branch regardless of the seed.
      numRuns: 40,
      examples: [
        ...authoredPlacements.map(placement => [placement, '#abcd', 'init']),
        ['requirement style fill', 'var(--brand)', 'init'],
      ],
    }))
  }, 120_000)

  test('independently invalid colors are refused by value on every output and verify', () => {
    fc.assert(fc.property(fc.constantFrom(...authoredPlacements), invalidColorArb, inputFormArb, (placement, color, form) => {
      const [source, options] = authoredInput(placement, color, form)
      const refusal = `${JSON.stringify(color)} is not a CSS color`
      expect(() => renderMermaidSVG(source, options), `${placement}: SVG`).toThrow(refusal)
      expect(() => renderMermaidPNG(source, options), `${placement}: PNG`).toThrow(refusal)
      for (const useAscii of [true, false]) {
        expect(() => renderMermaidASCII(source, { ...options, useAscii }), `${placement}: ${useAscii ? 'ASCII' : 'Unicode'}`).toThrow(refusal)
      }
      const verification = verifyMermaid(source, { renderOptions: options })
      expect(verification.ok, `${placement}: verify`).toBe(false)
      expect(verification.warnings).toContainEqual(expect.objectContaining({ code: 'RENDER_FAILED', reason: expect.stringContaining(refusal) }))
    }), fcParameters({
      numRuns: 120,
      examples: authoredPlacements.flatMap(placement => [
        [placement, 'constructor', 'init'],
        [placement, 'rgb(1 2 3 / .5 / junk)', 'options'],
      ]),
    }))
  }, 120_000)

  test('sequence headers retain their distinct admission contract', () => {
    const placements = Object.keys(PLACEMENTS).filter(placement => !authoredPlacements.includes(placement))
    fc.assert(fc.property(fc.constantFrom(...placements), colorishArb, (placement, color) => {
      const [source, options] = PLACEMENTS[placement]!(color)
      let svg: string
      try {
        svg = renderMermaidSVG(source, options)
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        if (placement === 'sequence rect' && RECT_REFUSAL.test(message)) return
        expect(safeCssPaint(color)).toBeUndefined()
        expect(message).toContain(`${JSON.stringify(color)} is not a CSS color — expected `)
        return
      }
      expectFinitePaints(svg)
    }), fcParameters({
      numRuns: RENDER_RUNS,
      // Inputs that crashed before each gate agreed with its parser.
      examples: [
        ['sequence box', 'constructor'],
      ],
    }))
  }, 120_000)
})

// Request colors: render options, Style palette tokens and Style role colors.
// Each is refused up front, by every output and by the MCP argument check,
// exactly when it is unsafe or names no color: never drawn as an invalid CSS
// paint in SVG and refused (or blackened) in PNG. The message names the field,
// and the value whenever the value is safe to echo.
const REQUEST_PLACEMENTS: Record<string, { field: string; mcpField?: string; options: (color: string) => RenderOptions }> = {
  'option bg': { field: 'render option "bg"', mcpField: 'arguments.options.bg', options: color => ({ bg: color }) },
  'option fg': { field: 'render option "fg"', mcpField: 'arguments.options.fg', options: color => ({ fg: color }) },
  'option accent': { field: 'render option "accent"', mcpField: 'arguments.options.accent', options: color => ({ accent: color }) },
  'style bg': { field: 'color token "bg"', options: color => ({ style: { colors: { bg: color } } }) },
  'style accent over a look': { field: 'color token "accent"', options: color => ({ style: ['hand-drawn', { colors: { accent: color } }] }) },
  'style role border': { field: '"roles.node.borderColor"', options: color => ({ style: { roles: { node: { borderColor: color } } } }) },
}
// Host-resolved paints (var(), currentColor) are not concrete page colors a
// PNG can paint; the request-color contract is about concrete colors.
const concreteColorArb = validColorArb.filter(color => color !== 'currentColor' && !color.startsWith('var('))
const localPngTool = createRenderPngTool('local')

describe('a request color is drawn alike on every output, or refused up front', () => {
  test('independently classified colors render on SVG and PNG, or are refused by both and by MCP', () => {
    const candidateArb = fc.oneof(
      concreteColorArb.map(color => ({ color, valid: true })),
      invalidColorArb.map(color => ({ color, valid: false })),
    )
    fc.assert(fc.property(fc.constantFrom(...Object.keys(REQUEST_PLACEMENTS)), candidateArb, (placement, { color, valid }) => {
      const { field, mcpField = field, options: optionsFor } = REQUEST_PLACEMENTS[placement]!
      const options = optionsFor(color)
      const mcpProblems = validateMcpToolArguments(localPngTool, { source: FLOWCHART, options })
      if (valid) {
        let svg = ''
        expect(() => { svg = renderMermaidSVG(FLOWCHART, options) }, `${placement}: SVG`).not.toThrow()
        expectFinitePaints(svg)
        let png: Uint8Array = new Uint8Array()
        expect(() => { png = renderMermaidPNG(FLOWCHART, { ...options, scale: 0.25, minLabelPx: 0 }) }, `${placement}: PNG`).not.toThrow()
        expect([...png.slice(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10])
        expect(mcpProblems, `${placement}: MCP`).toEqual([])
        return
      }
      let refusal = ''
      try { renderMermaidSVG(FLOWCHART, options) } catch (error) { refusal = error instanceof Error ? error.message : String(error) }
      expect(refusal, `${placement}: SVG`).toContain(field)
      if (safeCssPaint(color) !== undefined) expect(refusal).toContain(JSON.stringify(color))
      expect(() => renderMermaidPNG(FLOWCHART, { ...options, scale: 0.25, minLabelPx: 0 }), `${placement}: PNG`).toThrow(refusal)
      expect(mcpProblems.join('\n'), `${placement}: MCP`).toContain(mcpField)
    }), fcParameters({
      numRuns: 120,
      // Reported: a misspelled name drew an invalid paint in SVG while PNG
      // refused it (bg) or painted black arrowheads (accent).
      examples: Object.keys(REQUEST_PLACEMENTS).flatMap(placement => [
        [placement, { color: 'notacolor', valid: false }],
        [placement, { color: 'notacolorblurple', valid: false }],
        [placement, { color: 'rgb(1 x 1)', valid: false }],
        [placement, { color: 'REBECCAPURPLE', valid: true }],
      ]),
    }))
  }, 120_000)
})

// The direct sources are independently authored counterparts to the typed ops.
// Comparing with them checks the source/agent seam, rather than asking their
// shared validator to decide what the result should have been.
const STYLE_OPS: Record<string, (style: string) => readonly [family: string, ops: readonly object[], source: string]> = {
  'flowchart define_class': style => ['flowchart', [{ kind: 'add_node', id: 'A', label: 'A' }, { kind: 'define_class', name: 'hot', style }, { kind: 'set_node_class', id: 'A', className: 'hot' }], `flowchart TD\n  A:::hot\n  classDef hot ${style}`],
  'flowchart set_node_style': style => ['flowchart', [{ kind: 'add_node', id: 'A', label: 'A' }, { kind: 'set_node_style', id: 'A', style }], `flowchart TD\n  A\n  style A ${style}`],
  'state define_class': style => ['state', [{ kind: 'add_state', id: 'A' }, { kind: 'define_class', name: 'hot', style }, { kind: 'set_state_class', id: 'A', className: 'hot' }], `stateDiagram-v2\n  A\n  classDef hot ${style}\n  class A hot`],
  'state set_state_style': style => ['state', [{ kind: 'add_state', id: 'A' }, { kind: 'set_state_style', id: 'A', style }], `stateDiagram-v2\n  A\n  style A ${style}`],
  'state set_transition_style': style => ['state', [{ kind: 'add_state', id: 'A' }, { kind: 'add_state', id: 'B' }, { kind: 'add_transition', from: 'A', to: 'B' }, { kind: 'set_transition_style', index: 0, style }], `stateDiagram-v2\n  A --> B\n  linkStyle 0 ${style}`],
  'class define_class': style => ['class', [{ kind: 'add_class', id: 'Account' }, { kind: 'define_class', name: 'hot', style }, { kind: 'set_css_class', class: 'Account', className: 'hot' }], `classDiagram\n  class Account:::hot\n  classDef hot ${style}`],
  'class set_class_style': style => ['class', [{ kind: 'add_class', id: 'Account' }, { kind: 'set_class_style', class: 'Account', style }], `classDiagram\n  class Account\n  style Account ${style}`],
  'er set_entity_style': style => ['er', [{ kind: 'add_entity', id: 'CUSTOMER' }, { kind: 'set_entity_style', entity: 'CUSTOMER', style }], `erDiagram\n  CUSTOMER\n  style CUSTOMER ${style}`],
}

/** Compare painted semantics: canonical writing may turn rgb(0, 0, 0) into
 * rgb(0 0 0), changing both source spelling and the document's CSS scope hash. */
function paintedColors(svg: string) {
  return scanSvgStartTags(svg).flatMap(tag => {
    const owner = tag.attributes.find(attribute => attribute.name === 'data-id')?.value
    return tag.attributes.filter(attribute => ['fill', 'stroke', 'color', 'stop-color', 'flood-color'].includes(attribute.name))
      .map(attribute => [tag.name, owner, attribute.name, tryParseCssColor(attribute.value) ?? attribute.value])
  })
}

describe('typed style ops and direct source agree on independently classified colors', () => {
  test('including their serialized render and the distinction between none paint and ink', () => {
    const candidateArb = fc.oneof(classifiedColorArb, fc.constant({ color: 'none', valid: true }))
    fc.assert(fc.property(fc.constantFrom(...Object.keys(STYLE_OPS)), fc.constantFrom('fill', 'stroke', 'color'), candidateArb, (op, property, candidate) => {
      const { color } = candidate
      const [family, ops, source] = STYLE_OPS[op]!(`${property}:${color}`)
      const expected = candidate.valid && !(color === 'none' && property === 'color')
      let direct: { ok: true; svg: string } | { ok: false; message: string }
      try {
        direct = { ok: true, svg: renderMermaidSVG(source) }
      } catch (error) {
        direct = { ok: false, message: error instanceof Error ? error.message : String(error) }
      }
      expect(direct.ok, `${op}: direct source with ${property}:${color}`).toBe(expected)
      const built = buildMermaid(family as never, ops as never)
      // Flowchart styleComponent has no parenthesis token: CSS-valid
      // functions remain native-readable, but cannot be written losslessly.
      // Class/State accept these tokens; ER has its own constructive escaping.
      const writable = expected && !(family === 'flowchart' && color.includes('('))
      expect(built.ok, `${op}: typed op must preserve CSS meaning within its owning Mermaid grammar`).toBe(writable)
      if (!direct.ok) {
        expect(direct.message).toContain(`${JSON.stringify(color)} is not a CSS color`)
        if (!built.ok) {
          expect(built.error.code).toBe('INVALID_OP')
          expect(built.error.message).toContain(`${property} ${JSON.stringify(color)} is not a CSS color — expected `)
        }
        return
      }
      expectFinitePaints(direct.svg)
      if (!writable) {
        if (built.ok) throw new Error('Unspellable Flowchart function was accepted')
        expect(built.error.code).toBe('INVALID_OP')
        expect(built.error.message).toContain('cannot be written losslessly')
        return
      }
      if (built.ok) {
        expect(paintedColors(renderMermaidSVG(serializeMermaid(built.value))), `${op}: serialized paint matches authored source`).toEqual(paintedColors(direct.svg))
      }
    }), fcParameters({
      numRuns: RENDER_RUNS,
      examples: [['state define_class', 'fill', { color: 'rgb(0, 0, 0)', valid: true }], ...Object.keys(STYLE_OPS).flatMap(op => [
        [op, 'fill', { color: '#abcd', valid: true }],
        [op, 'color', { color: 'constructor', valid: false }],
        [op, 'color', { color: 'none', valid: true }],
        [op, 'fill', { color: 'hsl(0 0% 0% / 0)', valid: true }],
        [op, 'stroke', { color: 'var(--brand)', valid: true }],
      ])],
    }))
  }, 120_000)
})
