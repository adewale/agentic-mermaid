import { describe, expect, test } from 'bun:test'
import { renderMermaidASCIIWithReceipt } from '../ascii/index.ts'
import { colorizeText } from '../ascii/ansi.ts'
import {
  SHARED_RENDER_OPTION_FIELD_DESCRIPTORS,
  type SharedRenderOptionField,
} from '../render-contract.ts'
import { getStyle, knownStyles, validateStyleSpec } from '../scene/style-registry.ts'
import type { RenderOptions } from '../types.ts'
import {
  getFamily,
  knownBuiltinFamilies,
  replaceFamilyForTest,
  type AsciiContext,
} from '../agent/families.ts'

const SOURCE = 'flowchart LR\n  A[Start] --> B[Finish]'
const HOSTILE = 'red" onmouseover="alert(1);background:url(https://evil.invalid/x)'

function assertInertHtml(html: string): void {
  expect(html).not.toContain('onmouseover')
  expect(html).not.toContain('evil.invalid')
  expect(html).not.toContain('background:url')
  expect(html).not.toContain('#NaN')
}

describe('terminal projection color security', () => {
  test('rejects every public appearance color before HTML emission', () => {
    for (const field of ['bg', 'fg', 'line', 'accent', 'muted', 'surface', 'border'] as const) {
      const rendered = renderMermaidASCIIWithReceipt(SOURCE, { colorMode: 'html', [field]: HOSTILE })
      assertInertHtml(rendered.text)
      expect(rendered.terminalStyle.diagnostics).toContainEqual(expect.objectContaining({
        code: 'TERMINAL_UNSAFE_COLOR_REJECTED',
        feature: `appearance.${field}`,
      }))
    }
  })

  test('rejects every terminal-theme override and reports its exact source field', () => {
    for (const field of ['fg', 'border', 'line', 'arrow', 'accent', 'bg', 'corner', 'junction'] as const) {
      const rendered = renderMermaidASCIIWithReceipt(SOURCE, {
        colorMode: 'html',
        theme: { [field]: HOSTILE },
      })
      assertInertHtml(rendered.text)
      expect(rendered.terminalStyle.diagnostics).toContainEqual(expect.objectContaining({
        code: 'TERMINAL_UNSAFE_COLOR_REJECTED',
        feature: `terminal-theme.${field}`,
      }))
    }
  })

  test('rejects hostile Mermaid theme variables and the direct per-series sink', () => {
    const rendered = renderMermaidASCIIWithReceipt(SOURCE, {
      colorMode: 'html',
      mermaidConfig: { themeVariables: { primaryTextColor: HOSTILE, lineColor: HOSTILE } },
    })
    assertInertHtml(rendered.text)
    expect(rendered.terminalStyle.diagnostics.filter(diagnostic => diagnostic.code === 'TERMINAL_UNSAFE_COLOR_REJECTED').length).toBeGreaterThanOrEqual(2)
    assertInertHtml(colorizeText('<unsafe>', HOSTILE, 'html'))
    expect(colorizeText('plain', HOSTILE, 'truecolor')).toBe('plain')
  })

  test('architecture consumes the resolved terminal theme without re-merging raw source colors', () => {
    const source = `architecture-beta
  service api(server)[API]`
    const rendered = renderMermaidASCIIWithReceipt(source, {
      colorMode: 'truecolor',
      fg: '#0000ff',
      mermaidConfig: { themeVariables: { primaryTextColor: '#ff0000' } },
    })
    expect(rendered.terminalStyle.theme.fg).toBe('#0000ff')
    expect(rendered.text).toContain('\u001b[38;2;0;0;255m')
    expect(rendered.text).not.toContain('\u001b[38;2;255;0;0m')
  })

  test('custom styles reject hostile colors and every built-in style projects safely', () => {
    expect(validateStyleSpec({ name: 'hostile', colors: { fg: HOSTILE } })).toContain('color token "fg" must be a safe non-fetching CSS color')
    expect(() => renderMermaidASCIIWithReceipt(SOURCE, {
      colorMode: 'html',
      style: { name: 'hostile', colors: { fg: HOSTILE } },
    })).toThrow()
    for (const style of knownStyles()) {
      const spec = getStyle(style)
      if (spec) expect(validateStyleSpec(spec)).toEqual([])
      assertInertHtml(renderMermaidASCIIWithReceipt(SOURCE, { colorMode: 'html', style }).text)
    }
  })
})

describe('canonical terminal field applicability', () => {
  test('consumes connector terminalProjection from the family Scene descriptor', () => {
    const rendered = renderMermaidASCIIWithReceipt(SOURCE, { colorMode: 'none' })
    expect(rendered.terminalStyle.connectorProjection.evidence).toBe('scene')
    expect(rendered.terminalStyle.connectorProjection.count).toBe(1)
    expect(Object.values(rendered.terminalStyle.connectorProjection.topologies).reduce((sum, count) => sum + count, 0)).toBe(1)
    expect(rendered.terminalStyle.connectorProjection.directions).toEqual(['forward'])
    expect(rendered.terminalStyle.connectorProjection.markerPositions.end).toBe(1)
    expect(rendered.terminalStyle.connectorProjection.connectors[0]).toMatchObject({
      direction: 'forward',
      relationship: 'flowchart-edge',
      markers: { mid: [], end: { shape: 'arrow' } },
      topology: expect.any(String),
      strokeLosses: expect.arrayContaining(['continuous-geometry', 'stroke-width']),
    })
    expect(rendered.terminalStyle.diagnostics).toContainEqual(expect.objectContaining({
      code: 'TERMINAL_CONNECTOR_PROJECTED',
      feature: expect.stringContaining('connectors:'),
    }))
  })

  test('every registered terminal renderer receives the typed connector adapter it receipts', () => {
    for (const id of knownBuiltinFamilies()) {
      const descriptor = getFamily(id)!
      expect(descriptor.example, `${id} example`).toBeDefined()
      expect(descriptor.renderAscii, `${id} terminal renderer`).toBeDefined()
      if (!descriptor.example || !descriptor.renderAscii) continue
      const original = descriptor.renderAscii
      let observed: AsciiContext['connectorProjection'] | undefined
      const restore = replaceFamilyForTest(id, {
        ...descriptor,
        renderAscii(context) {
          observed = context.connectorProjection
          return original(context)
        },
      })
      try {
        const rendered = renderMermaidASCIIWithReceipt(descriptor.example, { colorMode: 'none' })
        const receipt = rendered.terminalStyle.connectorProjection
        expect(observed, `${id} adapter delivery`).toEqual(receipt.connectors)
        expect(receipt.evidence, `${id} connector evidence`).toBe('scene')
        expect(receipt.count, `${id} connector count`).toBe(receipt.connectors.length)
        expect(receipt.labelCount, `${id} label count`).toBe(
          receipt.connectors.reduce((sum, connector) => sum + connector.labels.length, 0),
        )
        for (const connector of receipt.connectors) {
          expect(connector.relationship.trim().length, `${id}/${connector.id} relationship`).toBeGreaterThan(0)
          expect(connector.markers.mid, `${id}/${connector.id} mid markers`).toBeArray()
          expect(connector.strokeLosses.length, `${id}/${connector.id} stroke losses`).toBeGreaterThan(0)
          expect(connector.diagnostics.length, `${id}/${connector.id} diagnostics`).toBeGreaterThan(0)
        }
      } finally {
        restore()
      }
    }
  })

  test('every explicit non-consumed shared field emits its stable field diagnostic', () => {
    const options: RenderOptions = {
      muted: '#666666', surface: '#eeeeee', font: 'Georgia', padding: 12,
      nodeSpacing: 20, layerSpacing: 30, wrappingWidth: 120, componentSpacing: 22,
      transparent: true, interactive: true, shadow: true,
      class: { hierarchicalNamespaces: false },
      architecture: {},
      timeline: { maxWidth: 300 }, journey: { experienceCurve: false },
      gantt: { dependencyArrows: true, criticalPath: true },
      embedFontImport: false, compact: true, idPrefix: 'terminal-', security: 'strict', seed: 7,
    }
    const rendered = renderMermaidASCIIWithReceipt(SOURCE, { ...options, colorMode: 'none' })
    const features = new Set(rendered.terminalStyle.diagnostics.map(diagnostic => diagnostic.feature))
    for (const [field, descriptor] of Object.entries(SHARED_RENDER_OPTION_FIELD_DESCRIPTORS) as Array<[SharedRenderOptionField, (typeof SHARED_RENDER_OPTION_FIELD_DESCRIPTORS)[SharedRenderOptionField]]>) {
      if (options[field] === undefined) continue
      if (descriptor.terminal === 'consumed') expect(features.has(`render-option:${field}`)).toBe(false)
      else expect(features.has(`render-option:${field}`), field).toBe(true)
    }
  })
})
