import { describe, expect, test } from 'bun:test'
import { renderMermaidASCIIWithReceipt } from '../ascii/index.ts'
import { colorizeText } from '../ascii/ansi.ts'
import {
  SHARED_RENDER_OPTION_FIELD_DESCRIPTORS,
  resolveRenderRequest,
  type SharedRenderOptionField,
} from '../render-contract.ts'
import { getStyle, knownStyles, validateStyleSpec } from '../scene/style-registry.ts'
import {
  primitiveCapabilityClaimKey,
  terminalConnectorCapabilityClaims,
  type SceneFeature,
} from '../scene/capabilities.ts'
import * as marks from '../scene/marks.ts'
import { projectTerminalStyle } from '../terminal-style.ts'
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
    expect(rendered.terminalStyle.connectorProjection.capabilities).toEqual(terminalConnectorCapabilityClaims())
    expect(rendered.terminalStyle.diagnostics).toContainEqual(expect.objectContaining({
      code: 'TERMINAL_CONNECTOR_PROJECTED',
      feature: expect.stringContaining('connectors:'),
    }))
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
    for (const feature of ['endpoints', 'topology', 'closedness', 'bend-radius', 'hit-geometry', 'labels', 'markers', 'stroke-cap', 'dash-array']) {
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
        paintOrder: 'stroke fill', nonScaling: true,
      },
      markers: { start: marker, mid: [marker], end: marker },
      labels: [{
        id: 'terminal-witness-label', text: 'depends', anchor: { x: 15, y: -4 }, clearance: 2,
        bounds: { x0: 4, y0: -20, x1: 26, y1: 2 }, halo: { color: '#fff', width: 2 },
        paint: { fill: '#111' }, fontSize: 10, textAnchor: 'middle', visual: { kind: 'inline' },
      }],
      transform: { kind: 'rotate', angle: 90, cx: 0, cy: 0 },
    }, '<path d="M 0 0 L 5 0 L 10 0 M 20 0 L 25 0 L 30 0" fill="none" stroke="#123456" stroke-width="3" stroke-opacity="0.5" stroke-dasharray="7 3" stroke-dashoffset="2" stroke-linecap="square" stroke-linejoin="miter" stroke-miterlimit="8" pathLength="40" paint-order="stroke fill" vector-effect="non-scaling-stroke" marker-start="url(#terminal-witness-marker)" marker-mid="url(#terminal-witness-marker)" marker-end="url(#terminal-witness-marker)" />')
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
      transform: projected.transform?.angle === 90,
      'stroke-opacity': projected.stroke.opacity === 0.5,
      'stroke-cap': projected.stroke.lineCap === 'square',
      'stroke-join': projected.stroke.lineJoin === 'miter',
      'stroke-miter': projected.stroke.miterLimit === 8,
      'dash-array': Array.isArray(projected.stroke.dash?.array) && projected.stroke.dash.array.join(' ') === '7 3',
      'dash-offset': projected.stroke.dash?.offset === 2,
      'dash-restart': projected.route.contours.length === 2 && projected.stroke.dash !== undefined,
      'path-length': projected.stroke.pathLength === 40,
      'paint-order': projected.stroke.paintOrder === 'stroke fill',
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
      renderMermaidASCIIWithReceipt(SOURCE, { colorMode: 'none', style: 'status-dashboard' })
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
    const features = new Set(rendered.terminalStyle.diagnostics.map(diagnostic => diagnostic.feature))
    for (const [field, descriptor] of Object.entries(SHARED_RENDER_OPTION_FIELD_DESCRIPTORS) as Array<[SharedRenderOptionField, (typeof SHARED_RENDER_OPTION_FIELD_DESCRIPTORS)[SharedRenderOptionField]]>) {
      if (options[field] === undefined) continue
      if (descriptor.terminal === 'consumed') expect(features.has(`render-option:${field}`)).toBe(false)
      else expect(features.has(`render-option:${field}`), field).toBe(true)
    }
  })
})
