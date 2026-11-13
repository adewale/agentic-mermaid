import { describe, expect, test } from 'bun:test'
import { decodeXML } from 'entities'
import { Resvg } from '@resvg/resvg-js'
import { join } from 'node:path'
import '../index.ts'
import * as marks from '../scene/marks.ts'
import { sceneNodeSerialization } from '../scene/serialization.ts'
import { connectorInlineLabelVisualBounds } from '../scene/bounds.ts'
import { preparePixelText } from '../shared/prepared-text.ts'
import { prepareDisplayText, replaceDisplayTextTokens } from '../shared/display-text.ts'
import { decodeMermaidEntities } from '../shared/mermaid-entity-display.ts'
import { nodeProblems } from '../scene/fidelity.ts'
import { projectTerminalStyle } from '../terminal-style.ts'
import { resolveRenderRequest } from '../render-contract.ts'
import type { ConnectorLabelDescriptor } from '../scene/ir.ts'

function connector(label: ConnectorLabelDescriptor) {
  return marks.connector({
    id: 'inline-text', role: 'edge',
    geometry: { kind: 'line', x1: 160, y1: 130, x2: 240, y2: 130 },
    lineStyle: 'solid', paint: { stroke: '#111', strokeWidth: '1' }, endpoints: { from: 'a', to: 'b' }, labels: [label],
  })
}

const placed = { anchor: { x: 200, y: 100 }, fontSize: 24, textAnchor: 'middle' as const, paint: { fill: '#111' }, visual: { kind: 'inline' as const } }

describe('connector-owned prepared text', () => {
  test('emits multiline literal text with resolved weight and tracking', () => {
    const label = { ...placed, text: '<b>literal</b>\nsecond line', fontWeight: 800, letterSpacing: 2, display: 'literal' as const }
    const svg = sceneNodeSerialization(connector(label))
    expect(svg).toContain('font-weight="800"')
    expect(svg).toContain('letter-spacing="2"')
    expect(svg).toContain('<tspan')
    expect(decodeXML(svg.match(/<text\b[\s\S]*?<\/text>/)![0].replace(/<[^>]*>/g, ''))).toBe('<b>literal</b>second line')
    const bounds = connectorInlineLabelVisualBounds(label)!
    const single = connectorInlineLabelVisualBounds({ ...label, text: 'second line' })!
    expect(bounds.y1 - bounds.y0).toBeGreaterThan(single.y1 - single.y0)
    expect(bounds.x1 - bounds.x0).toBeGreaterThan(connectorInlineLabelVisualBounds({ ...label, fontWeight: 400, letterSpacing: 0 })!.x1 - connectorInlineLabelVisualBounds({ ...label, fontWeight: 400, letterSpacing: 0 })!.x0)
  })

  test('uses a supplied prepared block without interpreting or capitalizing its content again', () => {
    const text = 'foo<b>bar</b>baz'
    const block = preparePixelText(text, { display: 'formatted', transform: 'capitalize', fontSize: 24, fontWeight: 600 })
    const svg = sceneNodeSerialization(connector({ ...placed, text, block }))
    const visible = decodeXML(svg.match(/<text\b[\s\S]*?<\/text>/)![0].replace(/<[^>]*>/g, ''))
    expect(visible).toBe('Foobarbaz')
    expect(svg).toContain('aria-label="a to b: Foobarbaz"')
    expect(svg).toMatch(/font-weight="(?:bold|700)"/)
  })

  test('retains literal entity text beside genuine formatting in SVG, fidelity and terminal receipts', () => {
    const source = '#lt;b#gt;X#lt;/b#gt; <b>Y</b> #92;n\nEND'
    const text = decodeMermaidEntities(source)
    const prepared = replaceDisplayTextTokens(prepareDisplayText(source), /#\w+;/g, decodeMermaidEntities)
    const block = preparePixelText(prepared, { fontSize: 24, fontWeight: 600 })
    const mark = connector({ ...placed, text, textContent: { value: text, prepared }, block })
    const svg = sceneNodeSerialization(mark)
    expect(svg).toContain('&lt;b&gt;X&lt;/b&gt;')
    expect(svg).toMatch(/<tspan\b[^>]*\bfont-weight="(?:bold|700)"[^>]*>Y<\/tspan>/)
    const problems: string[] = []
    nodeProblems(mark, 'inline-text', problems)
    expect(problems).toEqual([])
    const terminal = projectTerminalStyle(resolveRenderRequest('flowchart LR\nA-->B', {}, 'ascii'), 'none', {}, {
      family: 'test', width: 400, height: 200, colors: { bg: '#fff', fg: '#111' }, transparent: true, parts: [mark],
    })
    expect(terminal.connectorProjection.connectors[0]!.labels[0]!.text).toBe('<b>X</b> Y \\n\nEND')
    expect(terminal.diagnostics.some(diagnostic => diagnostic.code === 'TERMINAL_CONTROL_CHARACTERS_REPLACED')).toBe(false)
  })

  test('multiline bounds contain independently rasterized CJK, combining marks and emoji', () => {
    const label = { ...placed, text: 'First line\n第二行 👩‍💻 é', fontWeight: 800, letterSpacing: 2, clearance: 4, halo: { color: '#fff', width: 3 } }
    const bounds = connectorInlineLabelVisualBounds(label)!
    expect(bounds.y1 - bounds.y0).toBeGreaterThan(48)
    const text = sceneNodeSerialization(connector(label)).match(/<text\b[\s\S]*?<\/text>/)![0]
    const image = new Resvg(`<svg xmlns="http://www.w3.org/2000/svg" width="400" height="200"><style>text{font-family:Inter}</style>${text}</svg>`, {
      font: { loadSystemFonts: false, fontDirs: [join(import.meta.dir, '..', '..', 'assets', 'fonts')], defaultFontFamily: 'Inter' },
    }).render()
    const pixels = image.pixels
    let count = 0
    let left = image.width, right = -1, top = image.height, bottom = -1
    for (let y = 0; y < image.height; y++) for (let x = 0; x < image.width; x++) {
      if (pixels[(y * image.width + x) * 4 + 3]! < 128) continue
      count++
      left = Math.min(left, x); right = Math.max(right, x)
      top = Math.min(top, y); bottom = Math.max(bottom, y)
    }
    expect(count).toBeGreaterThan(100)
    expect(left).toBeGreaterThanOrEqual(Math.floor(bounds.x0) - 1)
    expect(right).toBeLessThanOrEqual(Math.ceil(bounds.x1) + 1)
    expect(top).toBeGreaterThanOrEqual(Math.floor(bounds.y0) - 1)
    expect(bottom).toBeLessThanOrEqual(Math.ceil(bounds.y1) + 1)
  })
})
