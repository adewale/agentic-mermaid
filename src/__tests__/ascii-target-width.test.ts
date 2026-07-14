import { describe, expect, test } from 'bun:test'
import { AsciiWidthError, renderMermaidASCII } from '../ascii/index.ts'
import { visualWidth } from '../ascii/width.ts'
import { METAMORPHIC_FAMILIES } from './helpers/metamorphic-families.ts'
import { createTracingMermaid } from '../mcp/facade.ts'
import type { DiagramKind } from '../agent/types.ts'

const outputWidth = (output: string): number => Math.max(0, ...output.split('\n').map(line => visualWidth(line)))
const htmlDisplayWidth = (output: string): number => outputWidth(output
  .replace(/<\/?span(?:\s[^>]*)?>/g, '')
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&'))

const LONG_FEASIBLE_SOURCE: Record<DiagramKind, string> = {
  flowchart: 'flowchart TD\n  A["A very descriptive flowchart node label with several words"]',
  state: 'stateDiagram-v2\n  A\n  note right of A : A very descriptive state note with several words',
  sequence: 'sequenceDiagram\n  participant A as A very descriptive participant label\n  A->>A: a descriptive self message with several words',
  timeline: 'timeline\n  2026 : A very descriptive timeline event with several words',
  class: 'classDiagram\n  class A {\n    +aVeryDescriptiveMethodWithSeveralWords()\n  }',
  er: 'erDiagram\n  A {\n    string descriptive_attribute_name "a descriptive attribute comment with several words"\n  }',
  journey: 'journey\n  section Delivery\n    A very descriptive journey task with several words: 4: Agent',
  architecture: 'architecture-beta\n  service api(server)[A very descriptive architecture service label with several words]',
  xychart: 'xychart-beta\n  title A very descriptive chart title with several words\n  x-axis [Alpha, Beta]\n  bar [1, 2]',
  pie: 'pie\n  "A very descriptive pie slice label with several words" : 2\n  "Short" : 1',
  quadrant: 'quadrantChart\n  title A very descriptive quadrant title with several words\n  A very descriptive point label with several words: [0.3, 0.4]',
  gantt: 'gantt\n  dateFormat YYYY-MM-DD\n  section Delivery\n  A very descriptive gantt task with several words :a, 2026-01-01, 1d',
  mindmap: 'mindmap\n  root[A very descriptive mindmap root label with several words]',
  gitgraph: 'gitGraph\n  commit id:"base" msg:"A very descriptive commit message with several words"',
  radar: 'radar-beta\n  title A descriptive radar comparison\n  axis quality["A descriptive quality axis"], speed["Speed"], cost["Cost"]\n  curve now["A descriptive current curve"]{4, 3, 2}\n  max 5',
}

describe('targetWidth hard terminal contract', () => {
  test('fits a long mixed-width flowchart without mutating caller source', () => {
    const source = 'flowchart TD\n  A["日本語 👩‍💻 descriptive label with many words"] --> B["Done"]'
    const before = source
    const output = renderMermaidASCII(source, { targetWidth: 32, colorMode: 'none' })
    expect(source).toBe(before)
    expect(outputWidth(output)).toBeLessThanOrEqual(32)
    expect(output).toContain('日本語')
    expect(output).toContain('👩‍💻')
  })

  test('every registered family shrinks a feasible long label below natural width', () => {
    expect(Object.keys(LONG_FEASIBLE_SOURCE).sort()).toEqual(Object.keys(METAMORPHIC_FAMILIES).sort())
    for (const entry of Object.values(METAMORPHIC_FAMILIES)) {
      const source = LONG_FEASIBLE_SOURCE[entry.family]
      const naturalWidth = outputWidth(renderMermaidASCII(source, { colorMode: 'none' }))
      const candidates = [...new Set([
        naturalWidth - 1,
        ...[0.9, 0.8, 0.7, 0.6, 0.5].map(ratio => Math.max(2, Math.floor(naturalWidth * ratio))),
      ])].filter(bound => bound > 1 && bound < naturalWidth)
      let fitted: { bound: number; width: number; output: string } | undefined
      for (const bound of candidates) {
        try {
          const output = renderMermaidASCII(source, { targetWidth: bound, colorMode: 'none' })
          const width = outputWidth(output)
          if (width < naturalWidth && width <= bound) { fitted = { bound, width, output }; break }
        } catch (error) {
          expect(error, entry.family).toBeInstanceOf(AsciiWidthError)
        }
      }
      expect(fitted, `${entry.family}: natural width ${naturalWidth}`).toBeDefined()
      expect(fitted!.output.toLowerCase(), `${entry.family}: constrained output preserves its distinctive label`).toContain('descriptive')
    }
  })

  test('every registered family returns the typed diagnostic below minimum geometry', () => {
    for (const entry of Object.values(METAMORPHIC_FAMILIES)) {
      try {
        renderMermaidASCII(LONG_FEASIBLE_SOURCE[entry.family], { targetWidth: 1, colorMode: 'none' })
        throw new Error(`${entry.family} unexpectedly fit one terminal cell`)
      } catch (error) {
        expect(error, entry.family).toBeInstanceOf(AsciiWidthError)
        expect(error, entry.family).toMatchObject({
          code: 'ASCII_TARGET_WIDTH_IMPOSSIBLE', requestedWidth: 1, family: entry.family,
        })
      }
    }
  })

  test('auto-fits long labels in sequence, Class, ER, Pie, and Quadrant', () => {
    const cases = [
      ['sequence', `sequenceDiagram
  participant A as Extremely descriptive participant label
  participant B as Another descriptive participant label
  A->>B: an extremely descriptive message label`, 60, 'descriptive'],
      ['class', `classDiagram
  class A {
    +anExtremelyDescriptiveMethodNameWithUnicode日本語()
  }`, 40, '日本語'],
      ['er', `erDiagram
  A {
    string descriptiveAttributeName PK "an extremely descriptive comment 日本語"
  }`, 44, '日本語'],
      ['pie', `pie
  "An extremely descriptive pie slice label 日本語" : 2
  "Short" : 1`, 52, '日本語'],
      ['quadrant', `quadrantChart
  title An extremely descriptive quadrant title 日本語
  A very descriptive point label 日本語: [0.2, 0.3]`, 50, '日本語'],
    ] as const
    for (const [family, source, targetWidth, token] of cases) {
      const output = renderMermaidASCII(source, { targetWidth, colorMode: 'none' })
      expect(outputWidth(output), family).toBeLessThanOrEqual(targetWidth)
      expect(output, family).toContain(token)
    }
  })

  test('measures HTML color output after renderer-owned escaping', () => {
    for (const [label, targetWidth] of [['Tom & Jerry', 9], ['A < B > C', 7]] as const) {
      const source = `flowchart TD\n  A["${label}"]`
      const plain = renderMermaidASCII(source, { targetWidth, colorMode: 'none' })
      const html = renderMermaidASCII(source, { targetWidth, colorMode: 'html' })
      expect(htmlDisplayWidth(html), label).toBe(outputWidth(plain))
      expect(htmlDisplayWidth(html), label).toBeLessThanOrEqual(targetWidth)
    }
  })

  test('throws a typed actionable error instead of exceeding an impossible bound', () => {
    expect(() => renderMermaidASCII('flowchart TD\n  A[🙂]', { targetWidth: 1 })).toThrow(AsciiWidthError)
    try {
      renderMermaidASCII('flowchart TD\n  A[🙂]', { targetWidth: 1 })
      throw new Error('expected targetWidth failure')
    } catch (error) {
      expect(error).toBeInstanceOf(AsciiWidthError)
      const widthError = error as AsciiWidthError
      expect(widthError.code).toBe('ASCII_TARGET_WIDTH_IMPOSSIBLE')
      expect(widthError.requestedWidth).toBe(1)
      expect(widthError.requiredWidth).toBeGreaterThan(1)
      expect(widthError.family).toBe('flowchart')
      expect(widthError.reason).toBe('UNBREAKABLE_GRAPHEME')
    }
  })

  test('is available through the hardened Code Mode SDK facade', () => {
    const sdk = createTracingMermaid()
    const output = sdk.renderMermaidASCII('flowchart TD\n  A["Code Mode long label"] --> B', {
      targetWidth: 24,
    })
    expect(outputWidth(output)).toBeLessThanOrEqual(24)
    try {
      sdk.renderMermaidASCII('flowchart TD\n  A[🙂]', { targetWidth: 1 })
      throw new Error('expected width failure')
    } catch (error) {
      expect(error).toMatchObject({
        code: 'ASCII_TARGET_WIDTH_IMPOSSIBLE',
        requestedWidth: 1,
        family: 'flowchart',
      })
    }
  })

  test('rejects ambiguous legacy maxWidth plus targetWidth', () => {
    expect(() => renderMermaidASCII('flowchart TD\n  A', { maxWidth: 40, targetWidth: 40 }))
      .toThrow(AsciiWidthError)
  })
})
