import { describe, expect, it } from 'bun:test'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { renderMermaidSVG } from '../index.ts'
import {
  bluePixel,
  colorPixelBox,
  colorPixelCount,
  hexPixel,
  nonWhitePixel,
} from './helpers/raster.ts'

const visualSnapshotDir = join(import.meta.dir, '..', '..', 'docs', 'layout-characterization', 'visual-snapshots')
const visualSnapshotFiles = readdirSync(visualSnapshotDir).filter(file => file.endsWith('.svg')).sort()

describe('visual rendering contracts', () => {
  it('renders linkStyle stroke color and width as visible pixels, not just SVG attributes', () => {
    const plain = renderMermaidSVG('graph LR\n  A --> B', { embedFontImport: false })
    const styled = renderMermaidSVG('graph LR\n  A --> B\n  linkStyle 0 stroke:#ff0000,stroke-width:4px', {
      embedFontImport: false,
    })

    expect(colorPixelCount(plain, hexPixel('#ff0000'))).toBe(0)
    expect(colorPixelCount(styled, hexPixel('#ff0000'))).toBeGreaterThan(80)

    const redBox = colorPixelBox(styled, hexPixel('#ff0000'))
    expect(redBox.width).toBeGreaterThan(40)
    expect(redBox.height).toBeGreaterThanOrEqual(4)
  })

  it('renders themed accent colors into real endpoint/icon pixels across arrow families', () => {
    const cases = [
      ['flowchart', 'graph LR\n  A --> B', 12],
      ['sequence', 'sequenceDiagram\n  Alice->>Bob: Hello', 12],
      ['class', 'classDiagram\n  Animal <|-- Dog', 6],
      ['architecture', 'architecture-beta\n  service api(server)[API]\n  service db(database)[DB]\n  api:R --> L:db', 24],
    ] as const

    for (const [name, source, minAccentPixels] of cases) {
      const svg = renderMermaidSVG(source, {
        bg: '#ffffff',
        fg: '#111111',
        line: '#555555',
        accent: '#ff0000',
        embedFontImport: false,
      })

      expect(colorPixelCount(svg, hexPixel('#ff0000')), `${name} accent pixels`).toBeGreaterThanOrEqual(minAccentPixels)
      expect(colorPixelCount(svg, bluePixel), `${name} should not render default-blue accent pixels`).toBe(0)
    }
  })

  it('renders architecture group borders from named style faces as visible pixels after color inlining', () => {
    const svg = renderMermaidSVG(
      `architecture-beta
  group edge(cloud)[Edge]
  service web(server)[Web] in edge`,
      {
        embedFontImport: false,
        style: 'accessible-high-contrast',
      },
    )

    expect(colorPixelCount(svg, hexPixel('#050505')), 'architecture group border pixels').toBeGreaterThan(100)
  })

  for (const file of visualSnapshotFiles) {
    it(`rasterizes ${file} into a nonblank inspectable surface`, () => {
      const svg = readFileSync(join(visualSnapshotDir, file), 'utf8')
      const visible = colorPixelBox(svg, nonWhitePixel)
      expect(visible.width, `${file} visible width`).toBeGreaterThan(16)
      expect(visible.height, `${file} visible height`).toBeGreaterThan(16)
      expect(colorPixelCount(svg, nonWhitePixel), `${file} visible pixels`).toBeGreaterThan(100)
    })
  }
})
