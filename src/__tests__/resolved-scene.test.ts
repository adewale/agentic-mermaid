import { describe, expect, test } from 'bun:test'
import { parseRegisteredMermaid, renderMermaidSVG, renderResolvedScene, RESOLVED_SCENE_VERSION } from '../index.ts'
import type { SceneDoc } from '../scene/ir.ts'
import { resolveSvgScene } from '../scene/resolve-svg.ts'
import { scanSvgStartTags } from '../svg-structure.ts'
import { readFileSync } from 'node:fs'
import raynerTitles from './testdata/rayner-528/xy-axis-titles.json'
import raynerGroups from './testdata/rayner-528/architecture-groups.json'
import { createScenePartCapture } from '../scene/part-capture.ts'

describe('renderResolvedScene', () => {
  test.each([...raynerTitles, ...raynerGroups])('keeps original Rayner $id as a resolved-scene acceptance case', ({ source, style }) => {
    const result = renderResolvedScene(source, { style })
    expect(result.svg).toBe(renderMermaidSVG(source, { style }))
    expect(result.parts.flatMap(part => part.primitives).length).toBeGreaterThan(0)
    expect(result).toEqual(JSON.parse(JSON.stringify(result)))
  })

  test.each([
    { family: 'class', source: 'classDiagram\nclass A\nclass B\nA <|-- B : inherits\nclassDef default fill:#ffeecc,stroke:#112233,stroke-width:3px,stroke-dasharray:7 3\nclassDef accent fill:#bbf,stroke:#f66,stroke-width:2px\nclass B accent\nstyle B stroke-dasharray:5 5,color:#fff', a: 'class:A', b: 'class:B', relationship: 'rel:A->B#0' },
    { family: 'er', source: 'erDiagram\nA ||--o{ B : links\nclassDef default fill:#ffeecc,stroke:#112233,stroke-width:3px,stroke-dasharray:7 3\nclassDef accent fill:#bbf,stroke:#f66,stroke-width:2px\nclass B accent\nstyle B stroke-dasharray:5 5,color:#fff', a: 'entity:A', b: 'entity:B', relationship: 'rel:A-B#0' },
  ])('keeps $family authored paint and dashes identical to public SVG', ({ source, a, b, relationship }) => {
    for (const backend of ['agentic', 'elk'] as const) {
      const options = { graphLayout: { backend, fallback: 'none' as const }, bg: '#ffffff', fg: '#102030', seed: 7, compact: true, idPrefix: 'resolved-paint-', font: 'Inter' }
      const result = renderResolvedScene(source, options)
      expect(result.svg).toBe(renderMermaidSVG(source, options))
      expect(result.colors).toMatchObject({ bg: '#ffffff', fg: '#102030' })
      const first = result.parts.find(part => part.id === a)!, second = result.parts.find(part => part.id === b)!
      expect(first.node.kind).toBe('group')
      expect(second.node.kind).toBe('group')
      if (first.node.kind !== 'group' || second.node.kind !== 'group') throw new Error('Expected owned entity groups')
      const firstBox = first.node.children.find(child => child.node.kind === 'shape' && child.node.geometry.kind === 'rect')?.node
      const secondBox = second.node.children.find(child => child.node.kind === 'shape' && child.node.geometry.kind === 'rect')?.node
      if (firstBox?.kind !== 'shape' || secondBox?.kind !== 'shape') throw new Error('Expected retained body rectangles')
      expect(firstBox.paint).toMatchObject({ fill: '#ffeecc', stroke: '#112233', strokeWidth: '3', strokeDasharray: '7 3' })
      expect(secondBox.paint).toMatchObject({ fill: '#bbf', stroke: '#f66', strokeWidth: '2', strokeDasharray: '5 5' })
      expect(first.primitives.find(primitive => primitive.kind === 'path')?.paint).toMatchObject({ fill: '#ffeecc', stroke: '#112233', strokeWidth: 3, dashArray: [7, 3] })
      expect(second.primitives.find(primitive => primitive.kind === 'path')?.paint).toMatchObject({ fill: '#bbbbff', stroke: '#ff6666', strokeWidth: 2, dashArray: [5, 5] })
      expect(second.primitives).toContainEqual(expect.objectContaining({ kind: 'text', text: 'B', paint: expect.objectContaining({ fill: '#ffffff' }) }))
      const edge = result.parts.find(part => part.id === relationship)!
      expect(edge.node.kind === 'connector' && edge.node.endpoints).toMatchObject({ from: 'A', to: 'B' })
      expect(result).toEqual(JSON.parse(JSON.stringify(result)))
    }
  })

  test('preserves parallel and reciprocal connector identities beside nested Unicode labels', () => {
    const source = 'flowchart LR\nsubgraph Outer["外 é"]\nsubgraph Inner[Inner]\nA["First 界"]\nend\nB[Second]\nend\nA -->|one| B\nA -->|two| B\nB -->|back| A'
    const result = renderResolvedScene(source)
    const edges = result.parts.filter(part => part.node.kind === 'connector')
    expect(edges).toHaveLength(3)
    expect(new Set(edges.map(part => part.id)).size).toBe(3)
    expect(edges.map(part => part.node.kind === 'connector' && part.node.endpoints)).toMatchObject([
      { from: 'A', to: 'B' }, { from: 'A', to: 'B' }, { from: 'B', to: 'A' },
    ])
    expect(result.svg).toBe(renderMermaidSVG(source))
    const original = JSON.stringify(result)
    result.colors.bg = '#abcdef'
    result.parts[0]!.id = 'changed-by-consumer'
    expect(JSON.stringify(renderResolvedScene(source))).toBe(original)
  })

  test.each([
    { family: 'flowchart', header: 'flowchart LR', nodes: 'A[First<br/>line] --> B[Second]' },
    { family: 'state', header: 'stateDiagram', nodes: 'state "First<br/>line" as A\n state "Second" as B\n A --> B' },
    { family: 'state', header: 'stateDiagram-v2', nodes: 'state "First<br/>line" as A\n state "Second" as B\n A --> B' },
  ])('keeps authored $header identity and deterministic JSON without DOM globals', ({ family, header, nodes }) => {
    expect(typeof document).toBe('undefined')
    expect(typeof DOMParser).toBe('undefined')
    const source = `${header}\n accTitle: Graph & notes\n accDescr: A says <ready>\n ${nodes}`
    const parsed = parseRegisteredMermaid(source)
    if (!parsed.ok) throw new Error(`Expected a valid ${family}`)
    for (const style of [undefined, 'hand-drawn', 'excalidraw', 'pen-and-ink', 'watercolor']) {
      const options = { ...(style ? { style } : {}), seed: 7, compact: true, idPrefix: 'resolved-', font: 'Inter' }
      const result = renderResolvedScene(source, options)
      expect(result.family).toBe(family)
      expect(result.version).toBe(RESOLVED_SCENE_VERSION)
      expect(result.svg).toBe(renderMermaidSVG(source, options))
      expect(result).toEqual(JSON.parse(JSON.stringify(result)))
      expect(renderResolvedScene(source, options)).toEqual(result)
      expect(renderResolvedScene(parsed.value, options)).toEqual(result)
      const relation = result.parts.find(part => part.kind === 'connector')!
      expect(relation.node.kind === 'connector' && relation.node.endpoints).toMatchObject({ from: 'A', to: 'B' })
      expect(relation.primitives.some(primitive => primitive.kind === 'path' && primitive.marker)).toBe(true)
      const words = result.parts.flatMap(part => part.primitives).filter(primitive => primitive.kind === 'text').map(primitive => primitive.text)
      expect(words).toEqual(['First', 'line', 'Second'])
      expect(result.parts.every(part => part.kind !== 'document')).toBe(true)
    }
  })

  test('does not return clean Scene geometry in place of backend strokes', () => {
    const source = 'flowchart LR\nA-->B'
    const crisp = renderResolvedScene(source)
    const sketch = renderResolvedScene(source, { style: 'hand-drawn' })
    const paths = (scene: typeof crisp) => scene.parts.flatMap(part => part.primitives).filter(primitive => primitive.kind === 'path')
    expect(paths(sketch).length).toBeGreaterThan(paths(crisp).length)
    expect(paths(sketch).map(path => path.d)).not.toEqual(paths(crisp).map(path => path.d))
    expect(sketch.frame.some(primitive => primitive.paint.fill === sketch.colors.bg.toLowerCase())).toBe(true)
  })

  test('refuses live palettes and filters instead of returning incomplete artwork', () => {
    expect(() => renderResolvedScene('flowchart LR\nA-->B', { bg: 'var(--background)' })).toThrow(/Unresolved CSS|Unsupported color/)
    expect(() => renderResolvedScene('flowchart LR\nA-->B', { shadow: true })).toThrow(/part.*A.*filter/)
    const sankey = readFileSync(new URL('../../eval/layout-compare/fixtures/sankey-basic.mmd', import.meta.url), 'utf8')
    expect(() => renderResolvedScene(sankey)).toThrow(/part.*link.*paint server/)
  })
})

// An independent SVG witness exercises interacting presentation rules without
// relying on the current family writers to happen to emit those combinations.
const doc: SceneDoc = {
  family: 'flowchart', width: 120, height: 80, transparent: false,
  colors: { bg: '#ffffff', fg: '#000000' },
  parts: [{ id: 'owned-ink', kind: 'shape', role: 'node', geometry: { kind: 'rect', x: 0, y: 0, width: 20, height: 10 }, paint: {} }],
}
function resolve(svg: string) {
  return resolveSvgScene(svg, doc, scanSvgStartTags(svg).map(() => 0)).parts[0]!.primitives
}

describe('resolved SVG values', () => {
  test('refuses missing backend ownership instead of misclassifying a part as frame ink', () => {
    const capture = createScenePartCapture()
    capture.begin({ seed: 0 }, doc)
    expect(() => capture.finish('<svg><rect width="2" height="2" /></svg>')).toThrow(/owned-ink.*ownership/)
  })

  test('resolves tspan selectors and inheritance before projecting an independent text run', () => {
    const [run] = resolve(`<svg><style>text { fill: blue } tspan { stroke: red }</style>
      <g opacity="0.5"><text x="5" y="7" font-size="10" opacity="0.6" style="font-weight:bold">
        <tspan dy="1em" opacity="0.5" style="font-size:2em">Visible</tspan>
      </text></g></svg>`)
    expect(run).toMatchObject({ kind: 'text', text: 'Visible', x: 5, y: 27, fontSize: 20, fontWeight: 700,
      paint: { fill: '#0000ff', stroke: '#ff0000', opacity: 0.15 } })
  })

  test('retains visible descendants of hidden containers and computed custom-property aliases', () => {
    const primitives = resolve(`<svg style="--base:red;--alias:var(--base)">
      <g visibility="hidden"><rect width="2" height="2" />
        <rect visibility="visible" width="3" height="3" style="--base:blue;fill:var(--alias)" />
        <text visibility="hidden" style="fill:var(--alias)"><tspan visibility="visible">Shown</tspan><tspan>Hidden</tspan></text>
      </g></svg>`)
    expect(primitives).toHaveLength(2)
    expect(primitives[0]).toMatchObject({ kind: 'path', paint: { fill: '#ff0000' } })
    expect(primitives[1]).toMatchObject({ kind: 'text', text: 'Shown', paint: { fill: '#ff0000' } })
  })

  test('keeps rem relative to the initial document font while em follows each element', () => {
    const [rect, text] = resolve('<svg font-size="20"><rect width="1rem" height="1em" /><text x="1rem" y="1em" font-size="10">Units</text></svg>')
    expect(rect).toMatchObject({ kind: 'path', d: 'M0 0h16v20h-16Z' })
    expect(text).toMatchObject({ kind: 'text', x: 16, y: 10, fontSize: 10 })
  })

  test('ignores unused definitions but attributes an unresolved marker style to the consuming part', () => {
    const unused = '<defs><marker id="unused"><path d="M0 0L2 2" stroke-width="calc(1px + 1em)" /></marker></defs>'
    expect(resolve(`<svg>${unused}<rect width="2" height="2" /></svg>`)).toHaveLength(1)
    expect(() => resolve(`<svg>${unused}<path d="M0 0L2 2" marker-end="url(#unused)" /></svg>`))
      .toThrow(/owned-ink.*Unsupported length/)
  })

  test('cascades stylesheet, inline and inherited values with alpha and transforms', () => {
    const primitives = resolve(`<svg><style>
      svg { --ink: #ff000080; font-family: 'Example Font', serif; }
      .shape { fill: var(--ink); stroke: blue; stroke-width: 4; }
      g .shape { stroke-width: 1.468125 !important; stroke-linejoin: bevel; }
      .shape:hover { fill: green; }
    </style><g opacity="50%" fill-opacity="40%" font-size="10" stroke-width="0.1em" transform="translate(10 20)">
      <rect class="shape" x="2" y="3" width="20" height="10" opacity="0.6" paint-order="stroke fill"
        style="stroke-width:9;stroke-dasharray:2 3;stroke-dashoffset:1" transform="scale(2)" />
      <g display="none"><rect width="1" height="1" /></g>
      <rect visibility="hidden" width="1" height="1" />
      <text x="5" y="7" dy="0.35em" font-size="20" font-weight="bold" font-style="italic"
        dominant-baseline="middle" textLength="30" lengthAdjust="spacingAndGlyphs">Hi &amp; bye</text>
    </g></svg>`)
    expect(primitives).toHaveLength(2)
    expect(primitives[0]).toMatchObject({
      kind: 'path', d: 'M2 3h20v10h-20Z', matrix: [2, 0, 0, 2, 10, 20],
      paint: { fill: '#ff0000', fillOpacity: 0.4 * 128 / 255, stroke: '#0000ff', strokeWidth: 1.46812, opacity: 0.3, lineJoin: 'bevel', dashArray: [2, 3], dashOffset: 1, paintOrder: 'stroke' },
    })
    expect(primitives[1]).toMatchObject({
      kind: 'text', text: 'Hi & bye', x: 5, y: 14, fontSize: 20,
      fontFamily: ['Example Font', 'serif'], fontWeight: 700, fontStyle: 'italic', baseline: 'middle',
      textLength: 30, lengthAdjust: 'spacingAndGlyphs', matrix: [1, 0, 0, 1, 10, 20], paint: { strokeWidth: 1 },
    })
  })

  test('expands start/end markers after their path and resolves tspan overrides', () => {
    const primitives = resolve(`<svg><defs><marker id="tip" orient="auto-start-reverse"
      markerUnits="strokeWidth" markerWidth="4" markerHeight="4" viewBox="0 0 4 4" refX="4" refY="2">
      <path d="M0 0L4 2L0 4Z" fill="red" />
    </marker></defs><g opacity="0.5"><line x1="10" y1="20" x2="30" y2="20" stroke-width="2"
      marker-start="url(#tip)" marker-end="url(#tip)" />
      <text x="5" y="7" font-size="10" fill="blue"><tspan dy="1em"><tspan>One</tspan></tspan><tspan x="8" dy="2em" fill="red">Two</tspan></text>
    </g></svg>`)
    expect(primitives).toHaveLength(5)
    expect(primitives[1]).toMatchObject({ marker: true, paint: { fill: '#ff0000', opacity: 0.5 } })
    expect(primitives[1]!.matrix[0]).toBeCloseTo(-2, 10)
    expect(primitives[1]!.matrix[4]).toBeCloseTo(18, 10)
    expect(primitives[1]!.matrix[5]).toBeCloseTo(24, 10)
    expect(primitives[2]).toMatchObject({ marker: true, matrix: [2, 0, 0, 2, 22, 16] })
    expect(primitives[3]).toMatchObject({ kind: 'text', text: 'One', x: 5, y: 17, paint: { fill: '#0000ff' } })
    expect(primitives[4]).toMatchObject({ kind: 'text', text: 'Two', x: 8, y: 27, paint: { fill: '#ff0000' } })
  })

  test('matches Chromium marker orientation for nearly vertical fractional routes', () => {
    const primitives = resolve(`<svg><defs><marker id="tip" orient="auto-start-reverse">
      <path d="M0 0L12 5L0 10Z" />
    </marker></defs><path d="M145.066666667 186.1L145.067 191.1L160 191.1"
      stroke-width="2.6" marker-start="url(#tip)" /></svg>`)
    expect(primitives[1]!.matrix[0]).toBeCloseTo(0, 10)
    expect(primitives[1]!.matrix[1]).toBeCloseTo(-2.6, 10)
  })

  test.each([
    ['filter', '<g filter="url(#f)"><rect width="2" height="2" /></g>'],
    ['clip-path', '<rect width="2" height="2" clip-path="url(#c)" />'],
    ['mask', '<rect width="2" height="2" mask="url(#m)" />'],
    ['marker-mid', '<path d="M0 0L2 2L4 0" marker-mid="url(#m)" />'],
    ['paint server', '<rect width="2" height="2" fill="url(#gradient)" />'],
    ['image', '<image href="data:image/png;base64,AA==" />'],
    ['Non-finite', '<rect width="2" height="2" stroke-miterlimit="1e100" />'],
    ['Non-finite', '<g transform="scale(1e200)"><rect width="2" height="2" transform="scale(1e200)" /></g>'],
    ['Unsupported color', '<rect width="2" height="2" fill="color-mix(in srgb, red 0%, blue 0%)" />'],
  ])('names the owning part and refused %s feature', (feature, fragment) => {
    expect(() => resolve(`<svg>${fragment}</svg>`)).toThrow(new RegExp(`owned-ink.*${feature}`))
  })
})


test('unsupported resolved artwork exposes a stable code, part and feature', () => {
  try {
    renderResolvedScene('flowchart LR\n A --> B', { shadow: true })
    throw new Error('expected refusal')
  } catch (error) {
    expect(error).toMatchObject({ code: 'RESOLVED_SCENE_UNSUPPORTED_ARTWORK', partId: 'node:A', feature: 'filter' })
    expect((error as Error).message).toMatch(/part.*A.*filter/)
  }
})


test('gradient refusal carries the consuming part and paint-server feature', () => {
  const source = readFileSync(new URL('../../eval/layout-compare/fixtures/sankey-basic.mmd', import.meta.url), 'utf8')
  const ordinary = renderMermaidSVG(source)
  try { renderResolvedScene(source); throw new Error('expected gradient refusal') }
  catch (error) {
    expect(error).toMatchObject({ code: 'RESOLVED_SCENE_UNSUPPORTED_ARTWORK', feature: 'paint-server' })
    expect((error as {partId:string}).partId).toMatch(/link/)
    expect(renderMermaidSVG(source)).toBe(ordinary)
  }
})
