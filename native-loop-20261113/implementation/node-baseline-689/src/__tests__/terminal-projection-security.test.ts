import { describe, expect, test } from 'bun:test'
import { renderMermaidASCIIWithReceipt } from '../ascii/index.ts'
import { colorizeText } from '../ascii/ansi.ts'
import { DeferredDependencyError } from '../layout/certification-error.ts'
import { resolveRenderRequest } from '../render-contract.ts'
import { getStyle, knownStyles, validateStyleSpec } from '../scene/style-registry.ts'
import {
  primitiveCapabilityClaimKey,
  terminalConnectorCapabilityClaims,
  type SceneFeature,
} from '../scene/capabilities.ts'
import * as marks from '../scene/marks.ts'
import { projectTerminalStyle, type TerminalProjectionDiagnostic } from '../terminal-style.ts'
import type { RenderOptions } from '../types.ts'
import {
  getFamily,
  knownBuiltinFamilies,
  replaceFamilyForTest,
  type AsciiContext,
} from '../agent/families.ts'
import fc from 'fast-check'
import { BUILTIN_FAMILY_METADATA } from '../agent/families.ts'
import { fcParameters } from './helpers/fc-parameters.ts'
import { FAMILY_ID_SOURCES, FAMILY_LABEL_SOURCES, hostileTextArb } from './helpers/family-text-sources.ts'
import { terminalText } from './helpers/terminal-text.ts'

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
      expect(() => renderMermaidASCIIWithReceipt(SOURCE, { colorMode: 'html', [field]: HOSTILE }))
        .toThrow(`render option "${field}" must be a safe, non-fetching CSS paint`)
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
    for (const field of ['primaryTextColor', 'lineColor']) {
      expect(() => renderMermaidASCIIWithReceipt(SOURCE, {
        colorMode: 'html',
        mermaidConfig: { themeVariables: { [field]: HOSTILE } },
      })).toThrow(`themeVariables.${field}: ${JSON.stringify(HOSTILE)} is not a CSS color`)
    }
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
  test.each(['receipt', 'terminalStyle', 'diagnostic callback'] as const)('preserves provider suspension while collecting %s', access => {
    const descriptor = getFamily('flowchart')!
    const deferred = new DeferredDependencyError('Layout provider', async () => {})
    const restore = replaceFamilyForTest('flowchart', { ...descriptor, layout() { throw new Error('Layout wrapper', { cause: deferred }) } })
    try {
      expect(() => {
        const rendered = renderMermaidASCIIWithReceipt(SOURCE, {
          colorMode: 'none', ...(access === 'diagnostic callback' ? { onProjectionDiagnostic() {} } : {}),
        })
        if (access !== 'diagnostic callback') void rendered[access]
      }).toThrow(deferred)
    } finally { restore() }
  })

  test('deferred connector evidence preserves eager diagnostics and the complete style digest', () => {
    const descriptor = getFamily('flowchart')!
    for (const projection of ['scene', 'failed'] as const) {
      const restore = replaceFamilyForTest('flowchart', {
        ...descriptor,
        ...(projection === 'failed' ? { lowerScene() { throw new Error('optional evidence unavailable') } } : {}),
      })
      try {
        const source = 'flowchart LR\n A["Start\u001b"] --> B[Finish]'
        const options = { colorMode: 'html' as const, style: 'hand-drawn' as const, theme: { fg: '#123456' } }
        const deferred = renderMermaidASCIIWithReceipt(source, options)
        const callbacks: TerminalProjectionDiagnostic[] = []
        const eager = renderMermaidASCIIWithReceipt(source, { ...options, onProjectionDiagnostic(diagnostic) { callbacks.push(diagnostic) } })
        expect(deferred.text).toBe(eager.text)
        expect(deferred.terminalStyle).toEqual(eager.terminalStyle)
        expect(deferred.receipt).toEqual(eager.receipt)
        expect(callbacks).toEqual([...eager.terminalStyle.diagnostics])
        expect(deferred.terminalStyle.connectorProjection.evidence).toBe(projection === 'scene' ? 'scene' : 'unavailable')
        expect(deferred.terminalStyle.diagnostics.filter(diagnostic => diagnostic.code === 'TERMINAL_CONTROL_CHARACTERS_REPLACED')).toHaveLength(1)
        expect(JSON.stringify(deferred.terminalStyle.connectorProjection)).not.toContain('\\u001b')
        assertInertHtml(deferred.text)
      } finally { restore() }
    }
  })

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
    expect(rendered.terminalStyle.connectorProjection.capabilities).toEqual(terminalConnectorCapabilityClaims())
    expect(rendered.terminalStyle.diagnostics).toContainEqual(expect.objectContaining({
      code: 'TERMINAL_CONNECTOR_PROJECTED',
      feature: expect.stringContaining('connectors:'),
    }))
  })

  test('reports continuous local gradient paint and compositing as terminal losses', () => {
    const rendered = renderMermaidASCIIWithReceipt('sankey-beta\n  A,B,1', { colorMode: 'none' })
    expect(rendered.terminalStyle.connectorProjection.connectors).toHaveLength(1)
    expect(rendered.terminalStyle.connectorProjection.connectors[0]!.strokeLosses)
      .toEqual(expect.arrayContaining(['gradient-paint', 'mix-blend-mode']))
    expect(rendered.terminalStyle.connectorProjection.connectors[0]!.diagnostics.join(' '))
      .toContain('gradient-paint')
  })

  test('terminal connector evidence preserves every typed feature behind its per-feature claims', () => {
    const rendered = renderMermaidASCIIWithReceipt('flowchart LR\n  A[Start] -->|ships| B[Finish]', { colorMode: 'none' })
    const projection = rendered.terminalStyle.connectorProjection.connectors[0]!
    expect(projection.geometry).toMatchObject({ kind: expect.any(String) })
    expect(projection.endpoints).toMatchObject({
      from: 'A', to: 'B', start: { point: { x: expect.any(Number), y: expect.any(Number) } },
      end: { point: { x: expect.any(Number), y: expect.any(Number) } },
    })
    expect(projection.route).toMatchObject({
      ownership: 'layout', closed: false, bendRadius: expect.any(Number),
      contours: [expect.objectContaining({ start: expect.any(Object), end: expect.any(Object), closed: false })],
      labelAnchors: [expect.any(Object)],
    })
    expect(projection.stroke).toMatchObject({
      color: expect.any(String), width: expect.anything(), lineCap: expect.any(String),
      lineJoin: expect.any(String), miterLimit: expect.any(Number), nonScaling: expect.any(Boolean),
    })
    expect(projection.hit).toMatchObject({
      geometry: expect.any(Object), closed: false, strokeWidth: expect.any(Number), pointerEvents: 'stroke',
    })
    expect(projection.markerPlacements.end).toEqual([
      expect.objectContaining({ markerId: expect.any(String), contourIndex: 0, point: expect.any(Object) }),
    ])
    expect(projection.labels).toEqual([expect.objectContaining({
      text: 'ships', anchor: expect.any(Object), paint: expect.any(Object), fontSize: expect.any(Number),
      textAnchor: 'middle', visual: { kind: 'companion', markId: expect.any(String) },
    })])

    const claims = rendered.terminalStyle.connectorProjection.capabilities
    expect(new Set(claims.map(primitiveCapabilityClaimKey)).size).toBe(claims.length)
    expect(claims.every(claim => claim.operation === 'terminal-project')).toBe(true)
    expect(claims.every(claim => claim.evidence === 'src/__tests__/terminal-projection-security.test.ts')).toBe(true)
    expect(claims.filter(claim => claim.realization === 'lossy').every(claim => Boolean(claim.diagnostic))).toBe(true)
    for (const feature of ['endpoints', 'topology', 'closedness', 'bend-radius', 'hit-geometry', 'labels', 'markers', 'stroke-cap', 'dash-array', 'compositing']) {
      expect(claims.some(claim => claim.feature === feature), feature).toBe(true)
    }
  })

  test('executes one exact terminal-projection witness for every connector claim', () => {
    const marker = {
      id: 'terminal-witness-marker', shape: 'arrow' as const,
      geometry: { kind: 'polygon' as const, points: [{ x: 0, y: 0 }, { x: 8, y: 4 }, { x: 0, y: 8 }] },
      size: { width: 8, height: 8 }, viewBox: { x: 0, y: 0, width: 8, height: 8 },
      ref: { x: 8, y: 4 }, bounds: { x0: 0, y0: 0, x1: 8, y1: 8 },
      units: 'userSpaceOnUse' as const, orient: 'auto-start-reverse' as const,
      overflow: 'visible' as const, paint: { fill: '#111', stroke: '#111', strokeWidth: '1' },
    }
    const geometry = {
      kind: 'path' as const,
      d: 'M 0 0 L 5 0 L 10 0 M 20 0 L 25 0 L 30 0',
      points: [{ x: 0, y: 0 }, { x: 5, y: 0 }, { x: 10, y: 0 }, { x: 20, y: 0 }, { x: 25, y: 0 }, { x: 30, y: 0 }],
      subpaths: [
        { points: [{ x: 0, y: 0 }, { x: 5, y: 0 }, { x: 10, y: 0 }], closed: false },
        { points: [{ x: 20, y: 0 }, { x: 25, y: 0 }, { x: 30, y: 0 }], closed: false },
      ],
      markerMidpoints: [{ x: 5, y: 0 }, { x: 25, y: 0 }],
    }
    const connector = marks.connector({
      id: 'terminal-witness', role: 'edge', geometry, lineStyle: 'dashed',
      paint: {
        fill: 'none', stroke: '#123456', strokeWidth: '3', opacity: '0.5',
        strokeDasharray: '7 3', strokeDashoffset: '2', strokeLinecap: 'square',
        strokeLinejoin: 'miter', strokeMiterlimit: '8', paintOrder: 'stroke fill',
        vectorEffect: 'non-scaling-stroke',
      },
      endpoints: { from: 'alpha', to: 'omega' },
      relationship: { kind: 'dependency', direction: 'bidirectional' },
      route: { ownership: 'layout', bendRadius: 4, labelAnchors: [{ x: 15, y: -4 }] },
      stroke: {
        opacity: 0.5, dash: { array: [7, 3], offset: 2 }, lineCap: 'square',
        lineJoin: 'miter', miterLimit: 8, pathLength: 40,
        paintOrder: 'stroke fill', mixBlendMode: 'multiply', nonScaling: true,
      },
      markers: { start: marker, mid: [marker], end: marker },
      labels: [{
        id: 'terminal-witness-label', text: 'depends', anchor: { x: 15, y: -4 }, clearance: 2,
        bounds: { x0: 4, y0: -20, x1: 26, y1: 2 }, halo: { color: '#fff', width: 2 },
        paint: { fill: '#111' }, fontSize: 10, textAnchor: 'middle', visual: { kind: 'inline' },
      }],
      transform: { kind: 'rotate', angle: 90, cx: 0, cy: 0 },
    })
    const request = resolveRenderRequest(SOURCE, {}, 'ascii')
    const receipt = projectTerminalStyle(request, 'none', {}, {
      family: 'test', width: 40, height: 40, colors: { bg: '#fff', fg: '#111' }, transparent: true, parts: [connector],
    }).connectorProjection
    const projected = receipt.connectors[0]!
    const witnesses: Readonly<Partial<Record<SceneFeature, boolean>>> = {
      identity: projected.id === 'terminal-witness' && projected.role === 'edge',
      relation: projected.relationship === 'dependency',
      endpoints: projected.endpoints.from === 'alpha' && projected.endpoints.to === 'omega',
      direction: projected.direction === 'bidirectional',
      labels: projected.labels[0]?.visual?.kind === 'inline' && projected.labels[0]?.halo?.width === 2,
      markers: projected.markerPlacements.start.length === 2 && projected.markerPlacements.mid.length === 2 && projected.markerPlacements.end.length === 2,
      geometry: projected.geometry.kind === 'path' && projected.geometry.subpaths?.length === 2,
      topology: projected.topology === 'path',
      subpaths: projected.route.contours.length === 2,
      closedness: projected.route.contours.every(contour => contour.closed === false),
      'bend-radius': projected.route.bendRadius === 4,
      interaction: projected.hit.pointerEvents === 'stroke',
      'hit-geometry': projected.hit.geometry.kind === 'path' && projected.hit.strokeWidth === 6,
      stroke: projected.stroke.color === '#123456' && projected.stroke.width === '3',
      transform: projected.transform?.kind === 'rotate' && projected.transform.angle === 90,
      'stroke-opacity': projected.stroke.opacity === 0.5,
      'stroke-cap': projected.stroke.lineCap === 'square',
      'stroke-join': projected.stroke.lineJoin === 'miter',
      'stroke-miter': projected.stroke.miterLimit === 8,
      'dash-array': Array.isArray(projected.stroke.dash?.array) && projected.stroke.dash.array.join(' ') === '7 3',
      'dash-offset': projected.stroke.dash?.offset === 2,
      'dash-restart': projected.route.contours.length === 2 && projected.stroke.dash !== undefined,
      'path-length': projected.stroke.pathLength === 40,
      'paint-order': projected.stroke.paintOrder === 'stroke fill',
      compositing: projected.stroke.mixBlendMode === 'multiply'
        && projected.strokeLosses.includes('mix-blend-mode'),
      'non-scaling-stroke': projected.stroke.nonScaling,
      'marker-orientation': projected.markers.start?.orient === 'auto-start-reverse',
      'marker-overflow': projected.markers.end?.overflow === 'visible',
    }
    const witnessFeatures = Object.keys(witnesses) as SceneFeature[]
    expect(receipt.capabilities.map(claim => claim.feature).sort()).toEqual(witnessFeatures.sort())
    for (const claim of receipt.capabilities) expect(witnesses[claim.feature], claim.feature).toBe(true)
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

  test('terminal hooks receive the exact resolved style face used by Scene lowering', () => {
    const descriptor = getFamily('flowchart')!
    const lowerScene = descriptor.lowerScene!
    const renderAscii = descriptor.renderAscii!
    let sceneFace: AsciiContext['styleFace']
    let terminalFace: AsciiContext['styleFace']
    const restore = replaceFamilyForTest('flowchart', {
      ...descriptor,
      lowerScene(context) {
        sceneFace = context.resolved.styleFace
        return lowerScene(context)
      },
      renderAscii(context) {
        terminalFace = context.styleFace
        return renderAscii(context)
      },
    })
    try {
      const rendered = renderMermaidASCIIWithReceipt(SOURCE, { colorMode: 'none', style: 'status-dashboard' })
      expect(rendered.terminalStyle.connectorProjection.evidence).toBe('scene')
      expect(terminalFace).toBe(sceneFace)
      expect(terminalFace).toBeDefined()
      expect(Object.isFrozen(terminalFace)).toBe(true)
      expect(Object.isFrozen(terminalFace?.node)).toBe(true)
    } finally {
      restore()
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
    for (const [code, fields] of [
      ['TERMINAL_RENDER_OPTION_PROJECTED', ['muted', 'surface', 'font', 'transparent', 'interactive', 'shadow']],
      ['TERMINAL_RENDER_OPTION_NOT_APPLICABLE', ['padding', 'nodeSpacing', 'layerSpacing', 'wrappingWidth', 'componentSpacing', 'class', 'architecture', 'timeline', 'journey', 'gantt', 'embedFontImport', 'compact', 'idPrefix', 'security', 'seed']],
    ] as const) {
      for (const field of fields) expect(rendered.terminalStyle.diagnostics).toContainEqual(expect.objectContaining({ code, feature: `render-option:${field}` }))
    }
  })
})


test('connector receipts retain exact references while projecting inert display labels', () => {
  const source = 'classDiagram\nclass `A\tB`\nclass `A B`\nclass X\nclass Y\n`A\tB` --> X : first\u001b<br><br>last\n`A B` --> Y : second'
  for (const colorMode of ['none', 'ansi16', 'html'] as const) {
    const rendered = renderMermaidASCIIWithReceipt(source, { colorMode })
    const projection = rendered.terminalStyle.connectorProjection
    expect(projection.evidence).toBe('scene')
    expect(projection.connectors.map(connector => ({ id: connector.id, from: connector.endpoints.from, to: connector.endpoints.to }))).toEqual([
      { id: 'rel:A\tB->X#0', from: 'A\tB', to: 'X' },
      { id: 'rel:A B->Y#0', from: 'A B', to: 'Y' },
    ])
    expect(projection.connectors[0]!.labels.map(label => label.text)).toEqual(['first?\n\nlast'])
    expect(projection.connectors[1]!.labels.map(label => label.text)).toEqual(['second'])
    for (const connector of projection.connectors) for (const label of connector.labels) {
      expect(label.text).not.toContain('\u001b')
      if (label.visual?.kind === 'companion') expect(label.visual.markId).toContain(connector.endpoints.from!)
    }
  }
})

// Terminal text is displayed, not parsed: controls other than LF, the bidi
// embedding/override/isolate controls that reorder cells ("Trojan source"),
// noncharacters and lone surrogates must never reach it, in any color mode.
const UNSAFE_TERMINAL_TEXT = /[\u0000-\u0009\u000b-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069\p{Noncharacter_Code_Point}\p{Cs}]/u
const terminalSourceArb = (family: (typeof BUILTIN_FAMILY_METADATA)[number]['id']) => {
  const idSource = FAMILY_ID_SOURCES[family]
  return idSource
    ? fc.oneof(hostileTextArb.map(FAMILY_LABEL_SOURCES[family]), hostileTextArb.map(idSource))
    : hostileTextArb.map(FAMILY_LABEL_SOURCES[family])
}
const terminalOptionsArb = fc.record({
  colorMode: fc.constantFrom('none', 'ansi16', 'ansi256', 'truecolor', 'html') as fc.Arbitrary<'none' | 'ansi16' | 'ansi256' | 'truecolor' | 'html'>,
  useAscii: fc.boolean(),
})
const codePoints = (text: string) => [...text].filter(character => UNSAFE_TERMINAL_TEXT.test(character)).map(character => `U+${character.codePointAt(0)!.toString(16).toUpperCase().padStart(4, '0')}`)

describe('terminal text holds no unsafe or undisplayable code points', () => {
  test.each(BUILTIN_FAMILY_METADATA.map(({ id }) => [id] as const))('%s', family => {
    fc.assert(fc.property(terminalSourceArb(family), terminalOptionsArb, (source, options) => {
      let text: string
      try { text = renderMermaidASCIIWithReceipt(source, options).text } catch { return }
      expect({ source, options, unsafe: codePoints(terminalText(text, options.colorMode)) }).toEqual({ source, options, unsafe: [] })
    }), fcParameters({
      numRuns: 60,
      // Reduced counterexamples (V16): a right-to-left override and an
      // entity-spelled noncharacter reached terminal text raw.
      examples: [
        [FAMILY_LABEL_SOURCES[family]('a\u202eb'), { colorMode: 'none', useAscii: false }],
        [FAMILY_LABEL_SOURCES[family]('x#65534;y'), { colorMode: 'none', useAscii: true }],
      ],
    }))
  })
})

describe('terminal receipts report replaced undisplayable code points', () => {
  test.each(BUILTIN_FAMILY_METADATA.map(({ id }) => [id] as const))('%s', family => {
    const undisplayable = fc.constantFrom('\u202e', '\u2066', '\ufffe', '\ufdd0', '\u{10ffff}', '\ud800')
    fc.assert(fc.property(undisplayable, hostileTextArb, (character, text) => {
      const source = FAMILY_LABEL_SOURCES[family](`${text.slice(0, 20)}${character}`)
      // Packet's template writes its label as a JSON string, escaping a lone
      // surrogate; the receipt reports characters the authored source holds.
      if (!source.includes(character)) return
      let diagnostics: readonly TerminalProjectionDiagnostic[]
      try { diagnostics = renderMermaidASCIIWithReceipt(source).terminalStyle.diagnostics } catch { return }
      expect({ source, replaced: diagnostics.some(diagnostic => diagnostic.code === 'TERMINAL_CONTROL_CHARACTERS_REPLACED') }).toEqual({ source, replaced: true })
    }), fcParameters({ numRuns: 30 }))
  })
})
