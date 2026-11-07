import { KNOWN_EXTENSION_CONTRACT_VERSIONS } from '../shared/extension-identity.ts'
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
  type ProfileTextInkMeasurement,
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
import { createTextMeasurementExecution } from '../text-measurement-profile.ts'
import { Resvg } from '@resvg/resvg-js'
import { join } from 'node:path'

const SOURCE = 'flowchart TD\n  A[Hello world]'
const RADAR_SOURCE = 'radar-beta\naxis a["AB"],b["CD"],c["EF"]\ncurve v["GH"]{1,2,3}'

function profile(measure: TextMeasurementProfile['measure'] = ({ text }) => [...text].length * 10): TextMeasurementProfile {
  return { id: 'test:font-metrics', version: '1.0.0', measure }
}

describe('trusted host pixel measurement profiles', () => {
  test('public fitted bold ink keeps its authored glyph and allocation through Native and Scene', () => {
    const id = 'backend:test/shaped-ink-public'
    const unregister = registerBackend({ ...DefaultBackend, id, capabilities: DefaultBackend.capabilities.map(claim => ({ ...claim, target: id })) }, {
      compatibility: { core: KNOWN_EXTENSION_CONTRACT_VERSIONS.core, scene: '^2.0.0' },
      provenance: { owner: 'host-text-measurement-test', source: 'test' },
    })
    try {
      for (const execution of ['native', 'scene'] as const) {
        const host = execution === 'scene' ? { backendPolicy: { selectBackend: () => id } } : {}
        const measure = () => 18.72
        const renderer = createMermaidRenderer({ ...host, textMeasurement: { ...profile(measure), version: '2.0.0', measureInk: input => input.text === 'j' && input.fontWeight === 700 ? {
          advance: 555 / 2048 * input.fontSize,
          bounds: { x0: -50 / 2048 * input.fontSize, y0: -1572 / 2048 * input.fontSize, x1: 443 / 2048 * input.fontSize, y1: 418 / 2048 * input.fontSize },
        } : undefined } })
        const source = 'flowchart LR\nA["<b>j</b>"]', options = { font: 'Inter', style: { roles: { node: { fontSize: 48, fontWeight: 400 } } } }
        const result = renderer.renderMermaidSVGWithReceipt(source, options)
        const widthOnlySvg = createMermaidRenderer({ ...host, textMeasurement: profile(measure) }).renderMermaidSVG(source, options)
        const texts = result.svg.match(/<text\b[^>]*>[\s\S]*?<\/text>/g)!
        expect(texts).toHaveLength(1)
        expect(texts[0]).toContain('font-family="Inter"')
        expect(texts[0]).toContain('textLength="18.72"')
        expect(texts[0]).toMatch(/font-weight="(?:bold|700)"[^>]*>j<\/tspan>/)
        const font = { fontFiles: [join(import.meta.dirname, '../../assets/fonts/Inter-Bold.ttf')], loadSystemFonts: false, defaultFontFamily: 'Inter' }
        const raster = new Resvg(result.svg, { font }).render(), pixels = raster.pixels
        expect(pixels.equals(new Resvg(widthOnlySvg, { font }).render().pixels)).toBe(true)
        const absent = new Resvg(result.svg.replace(texts[0]!, ''), { font }).render().pixels
        let changed = 0
        for (let i = 0; i < pixels.length; i += 4) if (!pixels.subarray(i, i + 4).equals(absent.subarray(i, i + 4))) changed++
        expect(changed).toBeGreaterThan(0)
        expect(result.receipt.textMeasurement).toEqual({ id: 'test:font-metrics', version: '2.0.0' })
      }
    } finally { unregister() }
  })

  test('snapshots optional shaped ink once and caches it by the complete font input', () => {
    const input = { text: 'j', fontFamily: 'Inter', fontSize: 48, fontWeight: 700, fontStyle: 'normal' as const, monospace: false }
    const reads: string[] = [], calls: ProfileTextMeasurementInput[] = []
    const returned = { advance: 13, bounds: { x0: -2, y0: -37, x1: 11, y1: 10 } }
    const supplied = { ...profile(), get measureInk() {
      reads.push('callback')
      return (value: ProfileTextMeasurementInput) => {
        calls.push(value)
        if (value.text === 'unsupported') return undefined
        return { get advance() { reads.push('advance'); return returned.advance }, get bounds() {
          reads.push('bounds')
          return {
            get x0() { reads.push('x0'); return returned.bounds.x0 }, get y0() { reads.push('y0'); return returned.bounds.y0 },
            get x1() { reads.push('x1'); return returned.bounds.x1 }, get y1() { reads.push('y1'); return returned.bounds.y1 },
          }
        } }
      }
    } }
    const execution = createTextMeasurementExecution(supplied, 'Inter')!
    const first = execution.ink(input)!
    returned.advance = 99; returned.bounds.x0 = -99
    expect(execution.ink({ ...input })).toBe(first)
    expect(first).toEqual({ advance: 13, bounds: { x0: -2, y0: -37, x1: 11, y1: 10 } })
    expect(Object.isFrozen(first) && Object.isFrozen(first.bounds)).toBe(true)
    expect(reads).toEqual(['callback', 'advance', 'bounds', 'x0', 'y0', 'x1', 'y1'])
    expect(execution.ink({ ...input, text: 'unsupported' })).toBeUndefined()
    expect(execution.ink({ ...input, text: 'unsupported' })).toBeUndefined()
    execution.ink({ ...input, fontFamily: 'Other' })
    execution.ink({ ...input, fontStyle: 'italic' })
    expect(calls).toHaveLength(4)
    expect(calls.every(Object.isFrozen)).toBe(true)
    const changed = createTextMeasurementExecution({ ...supplied, version: '2.0.0' }, 'Inter')!
    expect(changed.identity).toEqual({ id: supplied.id, version: '2.0.0' })
    expect(changed.ink(input)?.advance).toBe(99)
  })

  test.each([
    null, 12, Promise.resolve({ advance: 1, bounds: null }),
    { advance: NaN, bounds: null }, { advance: -1, bounds: null }, { advance: 1_000_001, bounds: null },
    { advance: 0, bounds: { x0: 0, y0: -1, x1: 1, y1: 1 } },
    { advance: 1, bounds: { x0: 2, y0: -1, x1: 1, y1: 1 } },
    { advance: 1, bounds: { x0: 0, y0: 2, x1: 1, y1: 1 } },
    { advance: 1, bounds: { x0: -Infinity, y0: -1, x1: 1, y1: 1 } },
    { advance: 1, bounds: { x0: 0, y0: -1, x1: 1_000_001, y1: 1 } },
    { advance: 1, bounds: { x0: '0', y0: -1, x1: 1, y1: 1 } },
  ])('rejects malformed host-shaped ink %j', invalid => {
    const execution = createTextMeasurementExecution({ ...profile(), measureInk: () => invalid as ProfileTextInkMeasurement }, 'Inter')!
    expect(() => execution.ink({ text: 'j', fontSize: 48, fontWeight: 700, fontStyle: 'normal', monospace: false })).toThrow(/finite ordered ink bounds/)
  })

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

  test.each(['absent', 'undefined', 'provided'] as const)('snapshots optional shaped-ink absence before prototype changes: %s', mode => {
    const supplied: TextMeasurementProfile = { id: 'test:optional-ink-snapshot', version: '1.0.0', measure: () => 20 }
    const providedTexts: string[] = []
    if (mode !== 'absent') Object.defineProperty(supplied, 'measureInk', { value: mode === 'provided' ? (input: ProfileTextMeasurementInput) => {
      providedTexts.push(input.text)
      return { advance: 20, bounds: { x0: 0, y0: -10, x1: 20, y1: 0 } }
    } : undefined })
    const renderer = createMermaidRenderer({ textMeasurement: supplied })
    const previous = Object.getOwnPropertyDescriptor(Object.prototype, 'measureInk')
    let inheritedCalls = 0
    try {
      Object.defineProperty(Object.prototype, 'measureInk', { configurable: true, value() {
        inheritedCalls++
        return { advance: 20, bounds: { x0: 0, y0: -10, x1: 20, y1: 0 } }
      } })
      // Distinct fresh sources ensure neither a cached artifact nor one
      // request's metric cache can hide a later callback activation.
      for (const text of ['ABC', 'XYZ']) {
        const svg = renderer.renderMermaidSVG(`flowchart LR\nA[${text}]`, { embedFontImport: false })
        expect(svg).toContain(`>${text}</text>`)
      }
      expect(inheritedCalls).toBe(0)
      expect(providedTexts.includes('ABC') && providedTexts.includes('XYZ')).toBe(mode === 'provided')
    } finally {
      if (previous) Object.defineProperty(Object.prototype, 'measureInk', previous)
      else delete (Object.prototype as { measureInk?: unknown }).measureInk
    }
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
      compatibility: { core: KNOWN_EXTENSION_CONTRACT_VERSIONS.core, scene: '^2.0.0' },
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
      { ...profile(), measureInk: 12 },
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
