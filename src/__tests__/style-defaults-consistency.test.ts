/**
 * Layout must measure text at the weight the renderer actually draws.
 *
 * Class and ER titles are drawn bold (font-weight 700) by the renderer, so
 * the layout has to size header boxes with the same weight — heavier weights
 * measure wider (see textBaseRatio in text-metrics.ts). When the two style
 * tables diverge, long titles are drawn wider than the box they sit in.
 */
import { describe, it, expect } from 'bun:test'
import { renderMermaidSVG } from '../index.ts'
import { parseClassDiagram } from '../class/parser.ts'
import { layoutClassDiagram } from '../class/layout.ts'
import { parseErDiagram } from '../er/parser.ts'
import { layoutErDiagram } from '../er/layout.ts'
import { measureTextWidth } from '../text-metrics.ts'
import { FONT_SIZES } from '../styles.ts'

const LONG_NAME =
  'ExtremelyLongDescriptiveDomainAggregateRootRepositoryNameForTheCustomerBillingReconciliationLedger'

function toLines(text: string): string[] {
  return text.split('\n').map(l => l.trim()).filter(l => l.length > 0 && !l.startsWith('%%'))
}

/** The font-weight the rendered SVG declares on the element containing `text`. */
function drawnWeight(svg: string, text: string): number {
  const el = svg.match(new RegExp(`<text[^>]*>[^<]*${text}`))
  expect(el).not.toBeNull()
  const m = el![0].match(/font-weight="(\d+)"/)
  expect(m).not.toBeNull()
  return Number(m![1])
}

describe('layout sizes titles at the weight the renderer draws', () => {
  it('class: header box fits the title at its drawn weight', () => {
    const source = `classDiagram\n  class ${LONG_NAME}`
    const svg = renderMermaidSVG(source)
    const weight = drawnWeight(svg, LONG_NAME)

    const positioned = layoutClassDiagram(parseClassDiagram(toLines(source)))
    const node = positioned.classes.find(c => c.label === LONG_NAME)
    expect(node).toBeDefined()
    // Padding on each side gives slack beyond the raw text width; if layout
    // measures at a lighter weight than the renderer draws, a title this long
    // outgrows that slack and overflows the box.
    expect(node!.width).toBeGreaterThanOrEqual(
      measureTextWidth(LONG_NAME, FONT_SIZES.nodeLabel, weight)
    )
  })

  it('er: entity header box fits the title at its drawn weight', () => {
    const source = `erDiagram\n  ${LONG_NAME} {\n    string id\n  }`
    const svg = renderMermaidSVG(source)
    const weight = drawnWeight(svg, LONG_NAME)

    const positioned = layoutErDiagram(parseErDiagram(toLines(source)))
    const node = positioned.entities.find(e => e.label === LONG_NAME)
    expect(node).toBeDefined()
    expect(node!.width).toBeGreaterThanOrEqual(
      measureTextWidth(LONG_NAME, FONT_SIZES.nodeLabel, weight)
    )
  })
})
