// Where a label's `<br>` breaks the line and where it is text follows pinned
// Mermaid 11.16. The expectations were read from 11.16 rendering each source
// in Chromium (the text nodes of its SVG and HTML labels), and they match its
// renderers: class and state notes are node labels drawn through
// `createText`, which breaks `<br>`; Gantt section titles are split on
// `common.lineBreakRegex` (`ganttRenderer.js` `vertLabels`); Gantt task text
// and titles, XYChart, GitGraph and Sankey labels are set with d3 `.text()`,
// which draws `<br/>` as text. SVG and ASCII must both show what upstream does.
import { describe, expect, it } from 'bun:test'
import { renderMermaidASCII, renderMermaidSVG } from '../index.ts'

// [context, source, the label as written, whether upstream breaks it]
const CASES: ReadonlyArray<readonly [string, string, string, boolean]> = [
  ['class note for a class', 'classDiagram\n  class A\n  note for A "Na<br/>Nb"', 'Na<br/>Nb', true],
  ['class free-standing note', 'classDiagram\n  class A\n  note "Na<br>Nb"', 'Na<br>Nb', true],
  ['state block note', 'stateDiagram-v2\n  s1\n  note right of s1\n    Na<br/>Nb\n  end note', 'Na<br/>Nb', true],
  ['state one-line note', 'stateDiagram-v2\n  s1\n  note right of s1 : Na<br/>Nb', 'Na<br/>Nb', true],
  ['Gantt section title', 'gantt\n  dateFormat YYYY-MM-DD\n  section Na<br/>Nb\n    t :a1, 2024-01-01, 1d', 'Na<br/>Nb', true],
  ['Gantt task text', 'gantt\n  dateFormat YYYY-MM-DD\n  section s\n    Na<br/>Nb :a1, 2024-01-01, 1d', 'Na<br/>Nb', false],
  ['Gantt title', 'gantt\n  title Na<br/>Nb\n  dateFormat YYYY-MM-DD\n  section s\n    t :a1, 2024-01-01, 1d', 'Na<br/>Nb', false],
  ['XYChart title', 'xychart-beta\n  title "Na<br/>Nb"\n  x-axis [a, b]\n  bar [1, 2]', 'Na<br/>Nb', false],
  ['XYChart category', 'xychart-beta\n  x-axis ["Na<br/>Nb", b]\n  bar [1, 2]', 'Na<br/>Nb', false],
  ['GitGraph commit id', 'gitGraph\n  commit id: "Na<br/>Nb"', 'Na<br/>Nb', false],
  ['Sankey node', 'sankey-beta\nNa<br/>Nb,B,10', 'Na<br/>Nb', false],
]

/** The label's pieces in drawing order: `Na` and `Nb` when the line breaks,
 * the whole spelling when it is drawn as text. */
function labelPieces(drawnLines: string[]): string[] {
  return drawnLines.flatMap(line => line.match(/Na<br\s*\/?>Nb|Na|Nb/g) ?? [])
}

/** Every drawn SVG line: each <tspan>, or a <text> without tspans. */
function svgLines(svg: string): string[] {
  const unescape = (s: string) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
  return [...svg.matchAll(/<text\b[^>]*>([\s\S]*?)<\/text>/g)].flatMap(match => {
    const spans = [...match[1]!.matchAll(/<tspan\b[^>]*>([^<]*)<\/tspan>/g)].map(span => unescape(span[1]!))
    return spans.length > 0 ? spans : [unescape(match[1]!)]
  })
}

describe('label line breaks display as pinned upstream draws them', () => {
  it.each(CASES)('%s', (context, source, written, breaks) => {
    const expected = breaks ? ['Na', 'Nb'] : [written]
    const ascii = renderMermaidASCII(source, { colorMode: 'none' }).split('\n')
    expect({ context, svg: labelPieces(svgLines(renderMermaidSVG(source))), ascii: labelPieces(ascii) })
      .toEqual({ context, svg: expected, ascii: expected })
  })
})
