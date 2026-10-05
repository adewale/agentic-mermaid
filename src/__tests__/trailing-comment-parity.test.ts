// A `%%` comment after a statement, against pinned Mermaid 11.16's own
// database. The grammars disagree: pie, xychart, quadrant, radar, architecture
// and gitGraph end a statement at `%%`, gantt only its header and keyword
// statements, and the rest read `%%` as text. Each row's oracle is Mermaid:
// its database with the comment must equal its database without it, and ours
// must agree through both the typed parse and the rendered SVG.

import { afterAll, describe, expect, test } from 'bun:test'
import { parseRegisteredMermaid, renderMermaidSVG, verifyMermaid } from '../agent/index.ts'
import { startUpstreamMermaid } from './helpers/upstream-mermaid.ts'

const upstream = startUpstreamMermaid()
afterAll(() => upstream.close())

const COMMENT = '%% a note'

function withComment(source: string, line: number): string {
  const lines = source.split('\n')
  lines[line] = `${lines[line]} ${COMMENT}`
  return lines.join('\n')
}

/** What ours makes of a source: the typed body kind and the rendered SVG. */
function ours(source: string): { body: string; svg: string } {
  const parsed = parseRegisteredMermaid(source)
  let svg: string
  try {
    svg = renderMermaidSVG(source)
  } catch (error) {
    svg = `render error: ${error instanceof Error ? error.message : String(error)}`
  }
  return { body: parsed.ok ? parsed.value.body.kind : 'parse error', svg }
}

// [family, source, line that gains the trailing comment]
const COMMENT_ENDS_STATEMENT: ReadonlyArray<readonly [string, string, number]> = [
  ['pie', 'pie showData\n  "Dogs" : 3\n  "Cats" : 2', 0],
  ['pie', 'pie\n  "Dogs" : 3\n  "Cats" : 2', 1],
  ['pie', 'pie\n  title Bob\'s pets\n  "Dogs" : 3', 1],
  ['xychart', 'xychart-beta horizontal\n  bar [1, 2]', 0],
  ['xychart', 'xychart-beta\n  title Sales\n  bar [1, 2]', 1],
  ['xychart', 'xychart-beta\n  x-axis [a, "b c"]\n  line [1, 2]', 1],
  ['xychart', 'xychart-beta\n  bar [1, 2]\n  line [3, 4]', 1],
  ['quadrant', 'quadrantChart\n  p: [0.5, 0.5]', 0],
  ['quadrant', 'quadrantChart\n  x-axis Low --> High\n  p: [0.5, 0.5]', 1],
  ['quadrant', 'quadrantChart\n  quadrant-1 Grow\n  p: [0.5, 0.5]', 1],
  ['quadrant', 'quadrantChart\n  p: [0.5, 0.5]', 1],
  ['radar', 'radar-beta\n  axis a, b, c\n  curve x{1, 2, 3}', 0],
  ['radar', 'radar-beta\n  title Bob\'s chart\n  axis a, b, c\n  curve x{1, 2, 3}', 1],
  ['radar', 'radar-beta\n  axis a, b, c\n  curve x{1, 2, 3}', 2],
  ['architecture', 'architecture-beta\n  service a(server)[A]', 0],
  ['architecture', 'architecture-beta\n  group g(cloud)[G]\n  service a(server)[A] in g', 1],
  ['architecture', 'architecture-beta\n  service a(server)[A]\n  service b(server)[B]\n  a:R --> L:b', 3],
  ['gitgraph', 'gitGraph\n  commit\n  commit', 0],
  ['gitgraph', 'gitGraph\n  commit id: "a"\n  branch dev\n  commit id: "b"', 1],
  ['gitgraph', 'gitGraph\n  commit id: "a"\n  branch dev\n  commit id: "b"', 2],
  ['gitgraph', 'gitGraph\n  commit id: "a"\n  branch dev\n  commit id: "b"\n  checkout main\n  merge dev', 5],
  ['gantt', 'gantt\n  dateFormat YYYY-MM-DD\n  Build :a1, 2024-01-01, 3d', 0],
  ['gantt', 'gantt\n  dateFormat YYYY-MM-DD\n  inclusiveEndDates\n  Build :a1, 2024-01-01, 2024-01-03', 2],
  ['gantt', 'gantt\n  dateFormat YYYY-MM-DD\n  weekday monday\n  Build :a1, 2024-01-01, 3d', 2],
  ['gantt', 'gantt\n  dateFormat YYYY-MM-DD\n  weekend friday\n  excludes weekends\n  Build :a1, 2024-01-01, 3d', 2],
]

// `%%` that Mermaid reads as text: inside a quoted string, or after a
// statement whose grammar runs to the end of the line.
const PERCENTS_ARE_TEXT: ReadonlyArray<readonly [string, string]> = [
  ['pie', 'pie\n  "Dogs %% cats" : 3'],
  ['xychart', 'xychart-beta\n  x-axis [a, "b %% c"]\n  bar [1, 2]'],
  ['gitgraph', 'gitGraph\n  commit id: "a %% b"'],
  ['quadrant', `quadrantChart\n  title Risk ${COMMENT}\n  p: [0.5, 0.5]`],
  ['gantt', `gantt\n  dateFormat YYYY-MM-DD\n  title Plan ${COMMENT}\n  Build :a1, 2024-01-01, 3d`],
  ['gantt', `gantt\n  dateFormat YYYY-MM-DD\n  section Phase ${COMMENT}\n  Build :a1, 2024-01-01, 3d`],
]

describe('a trailing %% comment, as pinned Mermaid reads it', () => {
  test.each(COMMENT_ENDS_STATEMENT)('%s: %j ignores a comment after line %i', async (family, source, line) => {
    const commented = withComment(source, line)
    const mermaid = { without: await upstream.database(source), with: await upstream.database(commented) }
    const plain = ours(source)
    // The comment-free source must itself be accepted, typed and drawn, so an
    // equal failure on both sides cannot pass for agreement.
    expect({ accepted: mermaid.without !== undefined, typed: plain.body, drawn: !plain.svg.startsWith('render error') })
      .toEqual({ accepted: true, typed: family, drawn: true })
    expect({ mermaid: mermaid.with, ours: ours(commented) }).toEqual({ mermaid: mermaid.without, ours: plain })
  })

  test.each(PERCENTS_ARE_TEXT)('%s: %j keeps its %% as text', async (_family, source) => {
    const text = source.includes(COMMENT) ? COMMENT : '%%'
    const parsed = parseRegisteredMermaid(source)
    expect({
      mermaid: (await upstream.database(source))?.includes(text),
      typed: parsed.ok && parsed.value.body.kind !== 'opaque' && JSON.stringify(parsed.value.body).includes(text),
      renders: !ours(source).svg.startsWith('render error'),
    }).toEqual({ mermaid: true, typed: true, renders: true })
  })

  test('a comment the typed serialization drops is announced, not silently lost', () => {
    const verdict = verifyMermaid(`pie\n  "Dogs" : 3 ${COMMENT}`)
    expect(verdict.warnings).toContainEqual({ code: 'COMMENT_DROPPED', count: 1, lines: [2] })
  })
})
