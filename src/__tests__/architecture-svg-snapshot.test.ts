import { beforeAll, describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { renderMermaidSVG } from '../index.ts'
import { layoutMermaidWithReceipt } from '../agent/index.ts'
import { normalizeSvg } from './helpers/svg-normalize.ts'
import { measureRenderedText, renderedTextReady } from './helpers/rendered-text.ts'

const snapshotDir = join(import.meta.dir, 'testdata', 'svg')
beforeAll(renderedTextReady)

function expectAuthoredMeaning(source: string, svg: string, expected: {
  nodes: Array<{ id: string; label?: string }>
  groups: Array<{ id: string; label: string; members: string[] }>
  edges: Array<{ from: string; to: string; label?: string }>
}): void {
  const layout = layoutMermaidWithReceipt(source).layout
  const byId = <T extends { id: string }>(items: T[]) => items.sort((a, b) => a.id.localeCompare(b.id))
  expect(byId(layout.nodes.map(({ id, label }) => ({ id, label })))).toEqual(byId(expected.nodes.map(({ id, label }) => ({ id, label }))))
  expect(byId(layout.groups.map(({ id, label, members }) => ({ id, label, members: [...members].sort() }))))
    .toEqual(byId(expected.groups.map(group => ({ ...group, members: [...group.members].sort() }))))
  expect(layout.edges.map(({ from, to, label }) => ({ from, to, label: label?.text })))
    .toEqual(expected.edges.map(({ from, to, label }) => ({ from, to, label })))
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
      edges: [{ from: 'api', to: 'db' }, { from: 'api', to: 'bus', label: 'async fan-out' }],
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
      edges: [{ from: 'api', to: 'db', label: 'reads <records>' }],
    })

    const expected = readFileSync(join(snapshotDir, 'architecture-themed-config.svg'), 'utf-8')
    expect(normalizeSvg(actual)).toBe(normalizeSvg(expected))
  })
})
