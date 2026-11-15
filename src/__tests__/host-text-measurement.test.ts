import { describe, expect, test } from 'bun:test'
import {
  createMermaidBrowserPNGRenderer,
  createMermaidRenderer,
  DEFAULT_TEXT_MEASUREMENT_PROFILE,
  DefaultBackend,
  measureTextWidth,
  parseRegisteredMermaid,
  registerBackend,
  renderMermaidASCIIWithReceipt,
  renderMermaidSVG,
  validateSerializableRenderOptions,
  type ProfileTextMeasurementInput,
  type RenderOptions,
  type TextMeasurementProfile,
} from '../index.ts'
import { createMermaidPNGRenderer } from '../agent/png.ts'
import { BUILTIN_FAMILY_METADATA } from '../agent/families.ts'
import { positionResolvedFamilyArtifact } from '../agent/family-layouts.ts'
import { layoutMermaidWithReceipt } from '../agent/core.ts'
import { receiptOf, resolveRenderRequestForExecution } from '../render-contract.ts'
import type { PositionedRadarChart } from '../radar/types.ts'
import { pngFixture } from './helpers/png-fixture.ts'

const SOURCE = 'flowchart TD\n  A[Hello world]'
const RADAR_SOURCE = 'radar-beta\naxis a["AB"],b["CD"],c["EF"]\ncurve v["GH"]{1,2,3}'

function profile(measure: TextMeasurementProfile['measure'] = ({ text }) => [...text].length * 10): TextMeasurementProfile {
  return { id: 'test:font-metrics', version: '1.0.0', measure }
}

describe('trusted host pixel measurement profiles', () => {
  test('the selected profile controls both node geometry and painted text advances', () => {
    const inputs: ProfileTextMeasurementInput[] = []
    const renderer = createMermaidRenderer({ textMeasurement: profile(input => {
      inputs.push(input)
      return [...input.text].length * 10
    }) })
    const { svg, receipt } = renderer.renderMermaidSVGWithReceipt(SOURCE, { font: 'Acme Sans' })
    // Eleven glyphs at ten pixels, plus the graph node's forty-pixel inset.
    expect(svg).toMatch(/<rect[^>]*width="150"/)
    expect(svg).toMatch(/<text[^>]*textLength="110"[^>]*>Hello world<\/text>/)
    expect(inputs).toContainEqual({ text: 'Hello world', fontFamily: 'Acme Sans', fontSize: 13, fontWeight: 500, fontStyle: 'normal', monospace: false })
    expect(receipt.textMeasurement).toEqual({ id: 'test:font-metrics', version: '1.0.0' })
    expect(receipt.executionDecision?.textMeasurement).toEqual(receipt.textMeasurement)
  })

  for (const family of BUILTIN_FAMILY_METADATA) {
    test(`${family.id} uses the host profile in its graphical text pipeline`, () => {
      const visible: string[] = []
      const renderer = createMermaidRenderer({ textMeasurement: profile(({ text, fontSize }) => {
        if (text.trim()) visible.push(text)
        return [...text].length * fontSize
      }) })
      const result = renderer.renderMermaidSVGWithReceipt(family.example)
      expect(visible.length).toBeGreaterThan(0)
      expect(result.svg).toContain('<svg')
      expect(result.receipt.textMeasurement?.id).toBe('test:font-metrics')
    })
  }

  test('prepared formatting and monospace members retain their actual typography', () => {
    const inputs: ProfileTextMeasurementInput[] = []
    const renderer = createMermaidRenderer({ textMeasurement: profile(input => {
      inputs.push(input)
      return [...input.text].length * input.fontSize
    }) })
    renderer.renderMermaidSVG('flowchart TD\nA["<b>bold</b> <i>italic</i>"]')
    renderer.renderMermaidSVG('classDiagram\nclass A {\n+run()\n}')
    expect(inputs.some(input => input.text === 'bold' && input.fontWeight >= 700)).toBe(true)
    expect(inputs.some(input => input.text === 'italic' && input.fontStyle === 'italic')).toBe(true)
    expect(inputs.some(input => input.monospace && input.fontFamily === 'JetBrains Mono' && input.text.includes('run'))).toBe(true)
  })

  test('the measured font follows group overrides and distinct font widths do not share a cache entry', () => {
    const inputs: ProfileTextMeasurementInput[] = []
    const renderer = createMermaidRenderer({ textMeasurement: profile(input => {
      inputs.push(input)
      return [...input.text].length * (input.fontFamily === 'Georgia' ? 30 : 10)
    }) })
    const svg = renderer.renderMermaidSVG('flowchart TD\nsubgraph S[Header]\nA[Header]\nend', {
      font: 'Inter',
      style: { roles: { node: { fontSize: 12, fontWeight: 600 }, group: { fontFamily: 'Georgia' } } },
    })
    expect(inputs).toContainEqual({ text: 'Header', fontFamily: 'Inter', fontSize: 12, fontWeight: 600, fontStyle: 'normal', monospace: false })
    expect(inputs).toContainEqual({ text: 'Header', fontFamily: 'Georgia', fontSize: 12, fontWeight: 600, fontStyle: 'normal', monospace: false })
    expect(svg).toMatch(/<text[^>]*font-family="Georgia"[^>]*textLength="180"[^>]*>Header<\/text>/)
    expect(svg).toMatch(/<text[^>]*textLength="60"[^>]*>Header<\/text>/)
  })

  test.each([
    ['architecture', 'architecture-beta\ngroup S(cloud)[Header]\nservice A(server)[Node] in S'],
    ['class', 'classDiagram\nnamespace Header {\nclass A\n}'],
    ['sequence', 'sequenceDiagram\nparticipant A\nloop Header\nA->>A: ping\nend'],
    ['journey', 'journey\nsection Header\nTask: 4: User'],
    ['timeline', 'timeline\nsection Header\n2026: Launch'],
  ])('%s measures its group text in the font it paints', (_family, source) => {
    const inputs: ProfileTextMeasurementInput[] = []
    const renderer = createMermaidRenderer({ textMeasurement: profile(input => {
      inputs.push(input)
      return [...input.text].length * 10
    }) })
    const svg = renderer.renderMermaidSVG(source, { style: { roles: { group: { fontFamily: 'Georgia' } } } })
    expect(svg).toContain('font-family="Georgia"')
    expect(inputs.some(input => input.text.includes('Header') && input.fontFamily === 'Georgia')).toBe(true)
  })

  test.each([
    ['flowchart', 'flowchart TD\nA[Node]'],
    ['state', 'stateDiagram-v2\n[*] --> Ready'],
    ['class', 'classDiagram\nclass A'],
    ['er', 'erDiagram\nA'],
    ['sequence', 'sequenceDiagram\nparticipant A'],
    ['mindmap', 'mindmap\nroot((Root))'],
    ['c4', 'C4Context\nSystem(a,"API")'],
  ])('%s measures its visible diagram title in the emitted group font', (_family, source) => {
    const inputs: ProfileTextMeasurementInput[] = []
    const renderer = createMermaidRenderer({ textMeasurement: profile(input => {
      inputs.push(input)
      return [...input.text].length * (input.fontFamily === 'Georgia' ? 30 : 10)
    }) })
    const svg = renderer.renderMermaidSVG(`---\ntitle: Runtime\n---\n${source}`, { font: 'Inter', style: { roles: { group: { fontFamily: 'Georgia' } } } })
    expect(inputs.some(input => input.text === 'Runtime' && input.fontFamily === 'Georgia')).toBe(true)
    expect(svg).toMatch(/<text[^>]*class="diagram-title"[^>]*font-family="Georgia"[^>]*textLength="210"[^>]*>Runtime<\/text>/)
  })

  test('C4 boundary metrics and emission share the configured group font', () => {
    const inputs: ProfileTextMeasurementInput[] = []
    const renderer = createMermaidRenderer({ textMeasurement: profile(input => {
      inputs.push(input)
      return [...input.text].length * (input.fontFamily === 'Georgia' ? 30 : 10)
    }) })
    const svg = renderer.renderMermaidSVG('C4Container\nSystem_Boundary(g,"Header") {\nContainer(a,"API","Go")\n}', { font: 'Inter', style: { roles: { group: { fontFamily: 'Georgia' } } } })
    expect(inputs.some(input => input.text === 'Header' && input.fontFamily === 'Georgia')).toBe(true)
    expect(svg).toMatch(/<text[^>]*font-family="Georgia"[^>]*>[\s\S]*?<tspan[^>]*textLength="180"[^>]*>Header<\/tspan>/)
  })

  test('Journey title and task font overrides are measured before their SVG text is fitted', () => {
    const inputs: ProfileTextMeasurementInput[] = []
    const renderer = createMermaidRenderer({ textMeasurement: profile(input => {
      inputs.push(input)
      return [...input.text].length * (input.fontFamily === 'Georgia' ? 30 : 10)
    }) })
    const svg = renderer.renderMermaidSVG('journey\ntitle Runtime\nsection Work\nTask: 4: User', { font: 'Inter', mermaidConfig: { journey: { titleFontFamily: 'Georgia', taskFontFamily: 'Georgia' } } })
    for (const text of ['Runtime', 'Task']) expect(inputs.some(input => input.text === text && input.fontFamily === 'Georgia')).toBe(true)
    expect(svg).toMatch(/<text[^>]*class="journey-title"[^>]*font-family="Georgia"[^>]*textLength="210"[^>]*>Runtime<\/text>/)
    expect(svg).toMatch(/<text[^>]*class="journey-task-text"[^>]*textLength="120"[^>]*>Task<\/text>/)
  })

  test('custom shaping widths and negative tracking use one measured band', () => {
    const renderer = createMermaidRenderer({ textMeasurement: profile() })
    const unicode = renderer.renderMermaidSVG('flowchart TD\nA["界é"]')
    expect(unicode).toMatch(/<rect[^>]*width="70"/)
    expect(unicode).toContain('界é')
    const tracked = renderer.renderMermaidSVG('flowchart TD\nA[abc]', {
      style: { roles: { node: { letterSpacing: -1 } } },
    })
    expect(tracked).toMatch(/<rect[^>]*width="68"/)
    expect(tracked.match(/textLength="10"/g)).toHaveLength(3)
  })

  test('snapshots host inputs and distinguishes profile versions in request receipts', () => {
    const mutable = { id: 'test:original', version: '1.0.0', measure: ({ text }: ProfileTextMeasurementInput) => text.length * 10 }
    const first = createMermaidRenderer({ textMeasurement: mutable })
    mutable.id = 'test:replacement'
    mutable.version = '9.0.0'
    mutable.measure = () => 1
    const a = first.renderMermaidSVGWithReceipt(SOURCE)
    const b = createMermaidRenderer({ textMeasurement: { ...profile(), id: 'test:original', version: '2.0.0' } }).renderMermaidSVGWithReceipt(SOURCE)
    expect(a.svg).toEqual(b.svg)
    expect(a.receipt.textMeasurement).toEqual({ id: 'test:original', version: '1.0.0' })
    expect(a.receipt.sharedRequestDigest).not.toEqual(b.receipt.sharedRequestDigest)
    expect(a.receipt.requestDigest).not.toEqual(b.receipt.requestDigest)
    expect(a.receipt.executionDecision?.digest).not.toEqual(b.receipt.executionDecision?.digest)
    expect(a.receipt.appearanceDigest).toEqual(b.receipt.appearanceDigest)
  })

  test('positioned Radar and Sankey label projections retain their selected profile', () => {
    for (const source of [RADAR_SOURCE, '---\ntitle: AB\n---\nsankey-beta\nSource,Target,2']) {
      const parsed = parseRegisteredMermaid(source)
      if (!parsed.ok) throw new Error('fixture did not parse')
      const request = resolveRenderRequestForExecution(source, {}, 'layout', undefined, {
        textMeasurement: profile(({ text }) => [...text].length * 20),
      })
      const artifact = positionResolvedFamilyArtifact(parsed.value, request)!
      const labels = artifact.rendered.nodes.filter(node => parsed.value.kind === 'radar'
        ? node.id.startsWith('axis#') : node.label === 'AB')
      expect(labels.length).toBe(parsed.value.kind === 'radar' ? 3 : 1)
      expect(labels.every(node => node.w === 40)).toBe(true)
      if (parsed.value.kind === 'radar') {
        expect((artifact.positioned as PositionedRadarChart).axes.every(axis => axis.labelWidth === 40)).toBe(true)
      }
      expect(receiptOf(request).textMeasurement).toEqual({ id: 'test:font-metrics', version: '1.0.0' })
    }
  })

  test('a nested default layout projection cannot inherit an outer backend profile', () => {
    const expected = layoutMermaidWithReceipt(RADAR_SOURCE)
    let nested: ReturnType<typeof layoutMermaidWithReceipt> | undefined
    let inspect = false
    const id = 'backend:test/nested-font-profile'
    const unregister = registerBackend({
      ...DefaultBackend,
      id,
      capabilities: DefaultBackend.capabilities.map(claim => ({ ...claim, target: id })),
      render(document, context) {
        if (inspect) nested = layoutMermaidWithReceipt(RADAR_SOURCE)
        return DefaultBackend.render(document, context)
      },
    }, {
      compatibility: { core: '^0.5.0', scene: '^2.0.0' },
      provenance: { owner: 'host-text-measurement-test', source: 'test' },
    })
    try {
      inspect = true
      const renderer = createMermaidRenderer({ textMeasurement: profile(), backendPolicy: { selectBackend: () => id } })
      expect(renderer.renderMermaidSVG(SOURCE)).toMatch(/<rect[^>]*width="150"/)
      expect(nested).toEqual(expected)
    } finally {
      unregister()
    }
  })

  test('nested default SVG and terminal renders keep their own metrics and restore on failure', () => {
    const ordinary = renderMermaidSVG(SOURCE)
    const terminal = renderMermaidASCIIWithReceipt(SOURCE)
    let nestedSvg: string | undefined
    let nestedTerminal: string | undefined
    const renderer = createMermaidRenderer({ textMeasurement: profile(input => {
      if (nestedSvg === undefined) {
        nestedSvg = renderMermaidSVG(SOURCE)
        nestedTerminal = renderMermaidASCIIWithReceipt(SOURCE).text
      }
      // Default estimates are usable inside a profile, without recursion.
      return measureTextWidth(input.text, input.fontSize, input.fontWeight) * 2
    }) })
    const custom = renderer.renderMermaidSVGWithReceipt(SOURCE)
    expect(custom.svg).not.toBe(ordinary)
    expect(nestedSvg).toBe(ordinary)
    expect(nestedTerminal).toBe(terminal.text)
    expect(terminal.receipt.textMeasurement).toBeUndefined()
    expect(() => createMermaidRenderer({ textMeasurement: profile(() => { throw new Error('font unavailable') }) }).renderMermaidSVG(SOURCE)).toThrow('font unavailable')
    expect(renderMermaidSVG(SOURCE)).toBe(ordinary)
    expect(renderMermaidASCIIWithReceipt(SOURCE)).toEqual(terminal)
    const defaultReceipt = createMermaidRenderer().renderMermaidSVGWithReceipt(SOURCE).receipt
    expect(defaultReceipt.textMeasurement).toBeUndefined()
  })

  test.each([NaN, Infinity, -1, 1_000_001, '12', Promise.resolve(12)])('rejects invalid profile width %s before output', width => {
    const renderer = createMermaidRenderer({ textMeasurement: profile(() => width as number) })
    expect(() => renderer.renderMermaidSVG(SOURCE)).toThrow(/must return a finite width/)
  })

  test('rejects malformed profiles at construction and executable inputs at the serializable boundary', () => {
    for (const invalid of [
      { ...profile(), id: '' },
      { ...profile(), id: DEFAULT_TEXT_MEASUREMENT_PROFILE.id },
      { ...profile(), version: 'latest' },
      { ...profile(), measure: 12 },
    ]) expect(() => createMermaidRenderer({ textMeasurement: invalid as TextMeasurementProfile })).toThrow(/textMeasurement/)
    const callback = profile(() => { throw new Error('untrusted callback ran') })
    expect(validateSerializableRenderOptions({ textMeasurement: callback }).length).toBeGreaterThan(0)
    expect(() => renderMermaidSVG(SOURCE, { textMeasurement: callback } as RenderOptions)).toThrow(/Invalid RenderOptions/)
    expect(() => renderMermaidSVG(SOURCE, { style: { textMeasurement: callback } } as unknown as RenderOptions)).toThrow(/Invalid RenderOptions/)
    expect(() => renderMermaidSVG(SOURCE, { mermaidConfig: { textMeasurement: callback } } as unknown as RenderOptions)).toThrow(/Invalid RenderOptions/)
    const fromSource = createMermaidRenderer().renderMermaidSVGWithReceipt(`---\nconfig:\n  textMeasurement:\n    id: test:font-metrics\n    version: 1.0.0\n---\n${SOURCE}`)
    expect(fromSource.svg).toBe(renderMermaidSVG(SOURCE))
    expect(fromSource.receipt.textMeasurement).toBeUndefined()
  })

  test('SVG and both PNG hosts use the same named graphical metrics and receipts', async () => {
    const textMeasurement = profile()
    let browserSvg = ''
    const browser = createMermaidBrowserPNGRenderer({
      textMeasurement,
      rasterize: async (svg, context) => {
        browserSvg = svg
        return { png: pngFixture(context.rasterDimensions.width, context.rasterDimensions.height) }
      },
    })
    const svg = createMermaidRenderer({ textMeasurement }).renderMermaidSVGWithReceipt(SOURCE)
    const native = createMermaidPNGRenderer({ textMeasurement }).renderMermaidPNGWithReceipt(SOURCE, { scale: 0.1, onWarning: () => {} })
    const raster = await browser.renderMermaidPNGWithReceipt(SOURCE, {}, 0.1)
    expect(browserSvg).toMatch(/<rect[^>]*width="150"/)
    expect(native.receipt).toEqual(raster.receipt)
    expect(svg.receipt.sharedRequestDigest).toBe(native.receipt.sharedRequestDigest)
    expect(native.receipt.textMeasurement).toEqual({ id: 'test:font-metrics', version: '1.0.0' })
  })
})
