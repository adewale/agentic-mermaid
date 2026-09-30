import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { renderMermaidSVG } from '../index.ts'
import { normalizeSvg } from './helpers/svg-normalize.ts'

const snapshotDir = join(import.meta.dir, 'testdata', 'svg')

// Reviewed whole-SVG goldens: they pin the exact geometry and markup of the
// architecture renderer, so any drift (layout, routing, labels, theming) needs
// a deliberate regeneration. Semantic properties of the same scenes are
// asserted in architecture-integration.test.ts.

describe('renderMermaidSVG – architecture snapshots', () => {
  // Groups, a junction, a side-anchored edge, and a labelled edge into the junction.
  it('matches the representative architecture golden SVG', () => {
    const actual = renderMermaidSVG(`architecture-beta
      group edge(cloud)[Edge]
      group app(server)[Application]
      service api(server)[Public API] in app
      junction bus in app
      service db(database)[Primary DB]
      api:R --> L:db
      api:B -["async fan-out"]-> T:bus`)

    const expected = readFileSync(join(snapshotDir, 'architecture-representative.svg'), 'utf-8')
    expect(normalizeSvg(actual)).toBe(normalizeSvg(expected))
  })

  // Frontmatter theme + themeVariables overridden by an init directive, the
  // architecture config block, and escaped markup in group, service and edge labels.
  it('matches the themed architecture golden SVG', () => {
    const actual = renderMermaidSVG(`---
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
    api:R -["reads <records>"]-> L:db`)

    const expected = readFileSync(join(snapshotDir, 'architecture-themed-config.svg'), 'utf-8')
    expect(normalizeSvg(actual)).toBe(normalizeSvg(expected))
  })
})
