import { describe, expect, it } from 'bun:test'
import { renderMermaidSVG } from '../index.ts'
import { builtinFamilyMetadata, knownBuiltinFamilies } from '../agent/families.ts'
import {
  bluePixel,
  colorPixelBox,
  colorPixelBoxInRaster,
  colorPixelCount,
  colorPixelCountInRaster,
  hexPixel,
  nonWhitePixel,
  renderSvgPixels,
} from './helpers/raster.ts'

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

  // The current render of every registered family's example, not a committed
  // snapshot: a regression that blanks a family must fail here.
  for (const family of knownBuiltinFamilies()) {
    const example = builtinFamilyMetadata(family)?.example
    it(`rasterizes the ${family} example into a nonblank inspectable surface`, () => {
      expect(example, `${family} registers an example`).toBeDefined()
      const raster = renderSvgPixels(renderMermaidSVG(example!, { embedFontImport: false }))
      const visible = colorPixelBoxInRaster(raster, nonWhitePixel)
      expect(visible.width, `${family} visible width`).toBeGreaterThan(16)
      expect(visible.height, `${family} visible height`).toBeGreaterThan(16)
      expect(colorPixelCountInRaster(raster, nonWhitePixel), `${family} visible pixels`).toBeGreaterThan(100)
    })
  }
})
