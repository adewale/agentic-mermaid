import { expect, test } from 'bun:test'
import { PERFORMANCE_EXPERIMENTS, withPerformanceExperiments as experiments } from '../experimental-performance.ts'
import { preparePixelText, type PixelTextOptions } from '../shared/prepared-text.ts'
import { renderMermaidSVG } from '../index.ts'
import { createTextMeasurementExecution, withTextMeasurementExecution } from '../text-measurement-profile.ts'
import { resolveRenderRequestForExecution } from '../render-contract.ts'
import { positionResolvedFamily } from '../positioning.ts'
import { withSvgInspectionCache } from '../svg-inspection-cache.ts'
import { transformSvgAttributes, transformSvgCssValues } from '../svg-structure.ts'
import { applyOutputSecurityPolicy } from '../output-security.ts'
import { EXTERNAL_SCENE_INPUT_SNAPSHOT_LIMITS, snapshotBoundedExternalData } from '../scene/external-data-snapshot.ts'
import { prepareDisplayText, replaceDisplayTextTokens, type PreparedDisplayText } from '../shared/display-text.ts'
import { measureSystemFontSafeTextWidth, measureTextWidth } from '../text-metrics.ts'
import type { PositionedGraph } from '../types.ts'

test('text reuse keys consumed typography even when it is provided by prototype accessors', () => {
  class Typography implements PixelTextOptions {
    #size: number
    constructor(size: number) { this.#size = size }
    get fontSize(): number { return this.#size }
    get fontWeight(): number { return 400 }
  }
  experiments(['text-spans'], () => {
    const small = preparePixelText('Accessor typography audit', new Typography(12))
    const large = preparePixelText('Accessor typography audit', new Typography(48))
    expect(small.fontSize).toBe(12)
    expect(large.fontSize).toBe(48)
    expect(large.width).toBeGreaterThan(small.width * 3)
  })
})

test('text reuse ignores caller serialization hooks and snapshots consumed getters once', () => {
  let getterReads = 0
  let serialized = 0
  const options = {
    get fontSize(): number { getterReads++; return 19 },
    fontWeight: 400,
    toJSON(): unknown { serialized++; throw new Error('Typography is not a wire format') },
  }
  const block = experiments(['text-spans'], () => preparePixelText('No serialization hook', options))
  expect(block.fontSize).toBe(19)
  expect(getterReads).toBe(1)
  expect(serialized).toBe(0)
})

test('ASCII prefix fitting keeps exact wrap ties and system-font W/M padding across suffixes', () => {
  const source = 'WMWMiii rrr   WWWMMMiiii WWW MMM iii rrr punctuation!'.repeat(3)
  for (const fontSize of [1, 13, 37.5]) for (const fontWeight of [400, 500, 600]) for (const safeFont of [false, true]) {
    const tiedWidth = (safeFont ? measureSystemFontSafeTextWidth : measureTextWidth)('WMWMiii', fontSize, fontWeight)
    for (const maxWidth of [0.1, 2, 14, 43, 63.125, tiedWidth, tiedWidth * (1 - 1e-12), tiedWidth * (1 + 1e-12)]) {
      const options = { fontSize, fontWeight, safeFont, maxWidth }
      const baseline = experiments([], () => preparePixelText(source, options))
      expect(experiments(['text-spans'], () => preparePixelText(source, options))).toEqual(baseline)
    }
  }
})

test('ASCII fitting preserves entity and transformed source spans and falls back without exact clusters', () => {
  const arbitrary: PreparedDisplayText = {
    source: '..........ABCD EFGH', display: 'literal', lineStarts: [0],
    lines: [[{ text: 'ABCD EFGH', bold: false, italic: false, underline: false, strikethrough: false, sourceStart: 10, sourceEnd: 19 }]],
  }
  const combined: PreparedDisplayText = {
    source: '&letters; EFGH', display: 'literal', lineStarts: [0],
    lines: [[{ text: 'ABCD EFGH', bold: false, italic: false, underline: false, strikethrough: false, sourceStart: 0, sourceEnd: 14,
      clusters: [{ text: 'ABCD', sourceStart: 0, sourceEnd: 9 }, { text: ' ', sourceStart: 9, sourceEnd: 10 }, ...Array.from('EFGH', (text, index) => ({ text, sourceStart: 10 + index, sourceEnd: 11 + index }))] }]],
  }
  const entity = replaceDisplayTextTokens(prepareDisplayText('&amp; ABCD WMWM iii', 'literal'), /&amp;/g, () => '&')
  const expanded = prepareDisplayText('ß abcdefg ßß WMWM', 'literal', 'uppercase')
  for (const source of [arbitrary, combined, entity, expanded]) for (const maxWidth of [8, 19, 31, 45]) {
    const options = { fontSize: 13, fontWeight: 400, maxWidth }
    expect(experiments(['text-spans'], () => preparePixelText(source, options))).toEqual(experiments([], () => preparePixelText(source, options)))
  }
  for (const offset of [0.5, -10, 2 ** 32 + 100]) {
    const text = 'ABCDEFGHIJKLM'
    const source: PreparedDisplayText = {
      source: text, display: 'literal', lineStarts: [0],
      lines: [[{ text, bold: false, italic: false, underline: false, strikethrough: false, sourceStart: offset, sourceEnd: offset + text.length,
        clusters: Array.from(text, (text, index) => ({ text, sourceStart: offset + index, sourceEnd: offset + index + 1 })) }]],
    }
    const options = { fontSize: 12, fontWeight: 400, maxWidth: 30 }
    const result = experiments(['text-spans'], () => preparePixelText(source, options))
    expect(result.breaks.map(value => value.sourceOffset)).toEqual([offset + 3, offset + 6, offset + 9, offset + 12])
    expect(result).toEqual(experiments([], () => preparePixelText(source, options)))
  }
})

test('ASCII fitting retains general shaping for styled, tracked, monospace and custom-metric wrapping', () => {
  for (const source of ['WMWM **bold** WWW iii', '<i>WMWM iii</i> WWW iii', 'plain WWW iii']) {
    for (const settings of [{}, { letterSpacing: -2 }, { letterSpacing: 3 }, { monospace: true }]) {
      const options = { fontSize: 17, fontWeight: 600, maxWidth: 39, ...settings }
      expect(experiments(['text-spans'], () => preparePixelText(source, options))).toEqual(experiments([], () => preparePixelText(source, options)))
    }
  }
  const options = { fontSize: 17, fontWeight: 400, maxWidth: 29 }
  const measured = () => withTextMeasurementExecution(createTextMeasurementExecution({ id: 'adversarial:nonadditive', version: '1.0.0',
    measure: ({ text }) => text.length > 3 ? 100 : text.length * 8,
  }, 'Inter'), () => preparePixelText('WMWM iii MMM', options))
  expect(experiments(['text-spans'], measured)).toEqual(experiments([], measured))
})

test('combined reuse cannot retain custom metrics from a reentrant profile or another request', () => {
  const source = 'Reentrant 界 👩‍💻 e\u0301'
  const options = { fontSize: 16, fontWeight: 400 }
  experiments(PERFORMANCE_EXPERIMENTS, () => {
    const normal = preparePixelText(source, options)
    const measured = (width: number) => withTextMeasurementExecution(createTextMeasurementExecution({
      id: `adversarial:${width}`, version: '1.0.0', measure: () => {
        expect(preparePixelText(source, options)).toBe(normal)
        expect(renderMermaidSVG('flowchart LR\nNestedA --> NestedB')).toContain('<svg')
        return width
      },
    }, 'Inter'), () => preparePixelText(source, options))
    const wide = measured(400)
    const narrow = measured(80)
    expect(wide.width).toBeGreaterThan(narrow.width)
    expect(preparePixelText(source, options)).toBe(normal)
  })
})

test('position reuse never shares mutable returned geometry or loses prepared Unicode text evidence', () => {
  const prior = process.env.AGENTIC_MERMAID_ELK_CACHE
  process.env.AGENTIC_MERMAID_ELK_CACHE = '1'
  try {
    experiments(PERFORMANCE_EXPERIMENTS, () => {
      const input = 'flowchart LR\nAuditA[Read 界 👩‍💻] --> AuditB[Untouched]'
      const request = resolveRenderRequestForExecution(input, {}, 'svg')
      const original = renderMermaidSVG(input)
      const first = positionResolvedFamily('flowchart', request).positioned as PositionedGraph
      first.nodes[0]!.width = 98765
      const second = positionResolvedFamily('flowchart', request).positioned as PositionedGraph
      expect(second.nodes[0]!.width).not.toBe(98765)
      second.nodes[0]!.label = 'Poisoned cached clone'
      expect(renderMermaidSVG(input)).toBe(original)
      expect(renderMermaidSVG(input, { padding: 48 })).not.toBe(original)
    })
  } finally {
    if (prior === undefined) delete process.env.AGENTIC_MERMAID_ELK_CACHE
    else process.env.AGENTIC_MERMAID_ELK_CACHE = prior
  }
})

test('selected optimizations retain XML/security admission after malicious transformed attributes or style content', () => {
  experiments(PERFORMANCE_EXPERIMENTS, () => withSvgInspectionCache(() => {
    const source = '<svg xmlns="http://www.w3.org/2000/svg"><style>.x{fill:red}</style><rect fill="red"/></svg>'
    const activeAttribute = transformSvgAttributes(source, attribute => attribute.name === 'fill' ? 'red" onload="alert(1)' : undefined)
    expect(() => applyOutputSecurityPolicy(activeAttribute)).toThrow('active content')
    const activeStyle = transformSvgCssValues(source, css => css.includes('.x') ? '</style><script>alert(1)</script><style>' : css)
    expect(() => applyOutputSecurityPolicy(activeStyle)).toThrow('active content')
  }))
})

test('selected optimizations keep external accessors inert and repeated UTF8 property keys within aggregate limits', () => {
  let invoked = 0
  experiments(PERFORMANCE_EXPERIMENTS, () => {
    const input = { get secret(): string { invoked++; return 'should not be read' } }
    expect(() => snapshotBoundedExternalData(input, EXTERNAL_SCENE_INPUT_SNAPSHOT_LIMITS)).toThrow()
    expect(invoked).toBe(0)
    const limits = { ...EXTERNAL_SCENE_INPUT_SNAPSHOT_LIMITS, maxAggregatePropertyKeyBytes: 6 }
    expect(() => snapshotBoundedExternalData([{ '界': 1 }, { '界': 2 }, { '界': 3 }], limits)).toThrow('aggregate 6-byte limit')
  })
})
