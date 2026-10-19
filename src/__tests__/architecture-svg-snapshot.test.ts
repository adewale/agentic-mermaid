import { beforeAll, describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { decodeXML } from 'entities'
import { renderMermaidSVG } from '../index.ts'
import { layoutMermaidWithReceipt } from '../agent/index.ts'
import { normalizeSvg } from './helpers/svg-normalize.ts'
import { measureRenderedText, renderedTextReady, requiredContrast } from './helpers/rendered-text.ts'
import { scanSvgStartTags } from '../svg-structure.ts'
import { renderSvgPixels } from './helpers/raster.ts'

const snapshotDir = join(import.meta.dir, 'testdata', 'svg')
beforeAll(renderedTextReady)

function expectAuthoredMeaning(source: string, svg: string, expected: {
  nodes: Array<{ id: string; label?: string }>
  groups: Array<{ id: string; label: string; members: string[] }>
  edges: Array<{ from: string; to: string; label?: string; fromSide: 'L' | 'R' | 'T' | 'B'; toSide: 'L' | 'R' | 'T' | 'B' }>
}): void {
  const layout = layoutMermaidWithReceipt(source).layout
  const byId = <T extends { id: string }>(items: T[]) => items.sort((a, b) => a.id.localeCompare(b.id))
  expect(byId(layout.nodes.map(({ id, label }) => ({ id, label })))).toEqual(byId(expected.nodes.map(({ id, label }) => ({ id, label }))))
  expect(byId(layout.groups.map(({ id, label, members }) => ({ id, label, members: [...members].sort() }))))
    .toEqual(byId(expected.groups.map(group => ({ ...group, members: [...group.members].sort() }))))
  expect(layout.edges.map(({ from, to, label }) => ({ from, to, label: label?.text })))
    .toEqual(expected.edges.map(({ from, to, label }) => ({ from, to, label })))
  const tags = scanSvgStartTags(svg).map(tag => ({ ...tag, attrs: Object.fromEntries(tag.attributes.map(attribute => [attribute.name, decodeXML(attribute.value)])) }))
  const subjectIds = [...expected.nodes, ...expected.groups].map(subject => subject.id)
  const subjects = tags.filter(tag => tag.name === 'g' && subjectIds.includes(tag.attrs['data-id']!))
  expect(subjects.map(subject => subject.attrs['data-id']).sort()).toEqual([...subjectIds].sort())
  for (const [index, subject] of subjects.entries()) {
    const id = subject.attrs['data-id']!
    const node = layout.nodes.find(candidate => candidate.id === id)
    const box = node ?? layout.groups.find(candidate => candidate.id === id)!
    const end = subjects[index + 1]?.start ?? svg.length
    const frames = tags.filter(tag => tag.start > subject.start && tag.start < end
      && tag.attrs['data-role'] === subject.attrs['data-role']
      && (tag.name === 'rect' || tag.name === 'circle'))
    expect(frames.length, `${id} draws its frame`).toBeGreaterThan(0)
    for (const frame of frames) {
      // Bind emitted frames to the same coordinate system as the connector
      // attachments. A separately correct layout cannot bless a moved SVG card.
      const fields = frame.name === 'circle'
        ? { cx: box.x + box.w / 2, cy: box.y + box.h / 2 }
        : { x: box.x, y: box.y, width: box.w, height: box.h }
      for (const [field, value] of Object.entries(fields)) {
        expect(Math.abs(Number(frame.attrs[field]) - value), `${id}.${field}`).toBeLessThanOrEqual(1)
      }
    }
  }
  const drawnEdges = tags.filter(tag => tag.attrs['data-role'] === 'edge').map(tag => tag.attrs)
  expect(drawnEdges.map(attrs => ({ from: attrs['data-from'], to: attrs['data-to'], label: attrs['data-label'], fromSide: attrs['data-from-side'], toSide: attrs['data-to-side'] })))
    .toEqual(expected.edges.map(({ from, to, label, fromSide, toSide }) => ({ from, to, label, fromSide, toSide })))
  const actualPixels = renderSvgPixels(svg).pixels
  for (const edge of drawnEdges) {
    // These crisp golden scenes emit polylines. Check attachment, not any
    // particular interior route or number of bends.
    expect(edge.points).toBeDefined()
    const coordinates = edge.points!.trim().split(/[\s,]+/).map(Number)
    expect(coordinates.length).toBeGreaterThanOrEqual(4)
    expect(coordinates.length % 2).toBe(0)
    expect(coordinates.every(Number.isFinite)).toBe(true)
    for (const [id, side, x, y] of [
      [edge['data-from'], edge['data-from-side'], coordinates[0]!, coordinates[1]!],
      [edge['data-to'], edge['data-to-side'], coordinates.at(-2)!, coordinates.at(-1)!],
    ] as const) {
      const node = layout.nodes.find(candidate => candidate.id === id)
      expect(node, `drawn endpoint ${id}`).toBeDefined()
      expect(x).toBeGreaterThanOrEqual(node!.x - 1)
      expect(x).toBeLessThanOrEqual(node!.x + node!.w + 1)
      expect(y).toBeGreaterThanOrEqual(node!.y - 1)
      expect(y).toBeLessThanOrEqual(node!.y + node!.h + 1)
      if (side === 'L' || side === 'R') expect(Math.abs(x - (node!.x + (side === 'R' ? node!.w : 0)))).toBeLessThanOrEqual(1)
      else expect(Math.abs(y - (node!.y + (side === 'B' ? node!.h : 0)))).toBeLessThanOrEqual(1)
    }
    // Hiding this emitted connector must change the original image. Unlike
    // recoloring a synthetic mask, this cannot create ink for an invisible edge.
    const hidden = svg.replace('</svg>', `<style>[data-role="edge"][data-from="${edge['data-from']}"][data-to="${edge['data-to']}"] { opacity: 0 !important; }</style></svg>`)
    const hiddenPixels = renderSvgPixels(hidden).pixels
    expect(actualPixels.some((value, index) => value !== hiddenPixels[index]), `${edge['data-from']} to ${edge['data-to']} paints ink`).toBe(true)
  }
  for (const group of layout.groups) for (const member of group.members) {
    const node = layout.nodes.find(candidate => candidate.id === member)
    expect(node, `${group.id} retains ${member}`).toBeDefined()
    // Public layout coordinates are rounded to integer pixels.
    expect(node!.x).toBeGreaterThanOrEqual(group.x - 1)
    expect(node!.y).toBeGreaterThanOrEqual(group.y - 1)
    expect(node!.x + node!.w).toBeLessThanOrEqual(group.x + group.w + 1)
    expect(node!.y + node!.h).toBeLessThanOrEqual(group.y + group.h + 1)
  }
  const texts = measureRenderedText(svg).texts
  const labels = [...expected.nodes, ...expected.groups, ...expected.edges]
    .flatMap(item => item.label === undefined ? [] : [item.label.replace(/\s+/g, ' ')])
  expect(texts.map(text => text.content).sort()).toEqual(labels.sort())
  for (const text of texts) {
    expect(text.pixels, text.content).toBeGreaterThan(0)
    expect(text.offCanvasPixels, text.content).toBe(0)
    // Synthetic glyph occupancy alone also counts opacity=0 text. Contrast
    // is measured against the original image and therefore requires visible ink.
    expect(text.contrast, text.content).toBeDefined()
    expect(text.contrast!, text.content).toBeGreaterThanOrEqual(requiredContrast(text))
  }
}

// Reviewed whole-SVG goldens: they pin the exact geometry and markup of the
// architecture renderer, so any drift (layout, routing, labels, theming) needs
// a deliberate regeneration. Semantic properties of the same scenes are
// asserted in architecture-integration.test.ts.

describe('renderMermaidSVG – architecture snapshots', () => {
  // Groups, a junction, a side-anchored edge, and a labelled edge into the junction.
  it('matches the representative architecture golden SVG', () => {
    const source = `architecture-beta
      group edge(cloud)[Edge]
      group app(server)[Application]
      service api(server)[Public API] in app
      junction bus in app
      service db(database)[Primary DB]
      api:R --> L:db
      api:B -["async fan-out"]-> T:bus`
    const actual = renderMermaidSVG(source)
    expectAuthoredMeaning(source, actual, {
      nodes: [{ id: 'api', label: 'Public API' }, { id: 'bus' }, { id: 'db', label: 'Primary DB' }],
      groups: [{ id: 'edge', label: 'Edge', members: [] }, { id: 'app', label: 'Application', members: ['api', 'bus'] }],
      edges: [{ from: 'api', to: 'db', fromSide: 'R', toSide: 'L' }, { from: 'api', to: 'bus', label: 'async fan-out', fromSide: 'B', toSide: 'T' }],
    })

    const expected = readFileSync(join(snapshotDir, 'architecture-representative.svg'), 'utf-8')
    expect(normalizeSvg(actual)).toBe(normalizeSvg(expected))
  })

  // Frontmatter theme + themeVariables overridden by an init directive, the
  // architecture config block, and escaped markup in group, service and edge labels.
  it('matches the themed architecture golden SVG', () => {
    const source = `---
config:
  theme: forest
  themeVariables:
    background: "#0b1120"
    mainBkg: "#0f172a"
    clusterBkg: "#111827"
    clusterBorder: "#38bdf8"
    fontFamily: IBM Plex Sans
---
%%{init: {
  "theme": "neutral",
  "themeVariables": {
    "lineColor": "#f59e0b",
    "primaryColor": "#38bdf8",
    "primaryBorderColor": "#7dd3fc"
  },
  "architecture": {
    "padding": 60,
    "iconSize": 26,
    "fontSize": 16
  }
}}%%
    architecture-beta
    group edge(cloud)["Edge<br/>Layer"]
    service api(server)["API & <Gateway>"] in edge
    service db(database)[Primary DB]
    api:R -["reads <records>"]-> L:db`
    const actual = renderMermaidSVG(source)
    expectAuthoredMeaning(source, actual, {
      nodes: [{ id: 'api', label: 'API & <Gateway>' }, { id: 'db', label: 'Primary DB' }],
      groups: [{ id: 'edge', label: 'Edge\nLayer', members: ['api'] }],
      edges: [{ from: 'api', to: 'db', label: 'reads <records>', fromSide: 'R', toSide: 'L' }],
    })

    const expected = readFileSync(join(snapshotDir, 'architecture-themed-config.svg'), 'utf-8')
    expect(normalizeSvg(actual)).toBe(normalizeSvg(expected))
  })
})
