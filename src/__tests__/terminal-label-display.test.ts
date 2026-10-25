// The terminal draws a label's display text: the formatting tags that style
// SVG runs (<b>, <i>, markdown-lite emphasis in the families that render it,
// markdown strings) are not characters, so ASCII/Unicode cells never show
// them, and the ASCII meta `projectedText` states exactly what the cells show.
//
// Oracle (metamorphic): in a formatted label, formatting carries no
// characters, so a source whose labels hold formatting renders the same
// terminal text as the source with the formatting removed. Literal contexts
// (Gantt, XYChart, GitGraph, Timeline, Pie, Radar) draw tags as text, as
// their SVG does; they are covered by the meta check only.
import { describe, expect, it } from 'bun:test'
import fc from 'fast-check'
import { fcParameters } from './helpers/fc-parameters.ts'
import { renderMermaidASCII, renderMermaidASCIIWithReceipt, renderMermaidSVG } from '../index.ts'
import { decodeXML } from 'entities'
import { parseRegisteredMermaid, mutate, serializeMermaid } from '../agent/core.ts'
import { renderMermaidASCIIWithMeta, type AsciiRegion } from '../ascii/meta.ts'
import { visualWidth } from '../ascii/multiline-utils.ts'

// [family, source with formatting, the same source with the formatting removed]
const FORMATTED: ReadonlyArray<readonly [string, string, string]> = [
  ['flowchart tags', 'graph TD\n  A[Qa <b>Qb</b>] -->|Ea <i>Eb</i>| B\n  subgraph S[Sa <u>Sb</u>]\n    C\n  end', 'graph TD\n  A[Qa Qb] -->|Ea Eb| B\n  subgraph S[Sa Sb]\n    C\n  end'],
  ['flowchart markdown string', 'graph LR\n  A["`**Qa** *Qb* ~~Qc~~`"] --> B', 'graph LR\n  A["`Qa Qb Qc`"] --> B'],
  ['sequence emphasis', 'sequenceDiagram\n  participant A as **Pa** Pb\n  A->>B: *Ma* <b>Mb</b>\n  Note over A: ~~Na~~ Nb\n  loop <i>La</i> Lb\n    B->>A: x\n  end', 'sequenceDiagram\n  participant A as Pa Pb\n  A->>B: Ma Mb\n  Note over A: Na Nb\n  loop La Lb\n    B->>A: x\n  end'],
  ['state emphasis', 'stateDiagram-v2\n  s1 : **Sa** Sb\n  s1 --> s2 : *Ta* Tb\n  note right of s1 : <b>Na</b> Nb', 'stateDiagram-v2\n  s1 : Sa Sb\n  s1 --> s2 : Ta Tb\n  note right of s1 : Na Nb'],
  ['class labels and notes', 'classDiagram\n  class C["**Ca** Cb"]\n  C <|-- D : <i>Ra</i> Rb\n  note for C "*Na* Nb"', 'classDiagram\n  class C["Ca Cb"]\n  C <|-- D : Ra Rb\n  note for C "Na Nb"'],
  ['ER labels', 'erDiagram\n  A["<b>Ea</b> Eb"]\n  A ||--o{ B : "*Ra* Rb"', 'erDiagram\n  A["Ea Eb"]\n  A ||--o{ B : "Ra Rb"'],
  ['architecture labels', 'architecture-beta\n  group g(cloud)["<b>Ga</b> Gb"]\n  service api(server)["*Sa* Sb"] in g', 'architecture-beta\n  group g(cloud)[Ga Gb]\n  service api(server)[Sa Sb] in g'],
  ['quadrant labels', 'quadrantChart\n  title **Ta** Tb\n  x-axis "<i>Xa</i>" --> Xb\n  quadrant-1 *Qa* Qb\n  *Pa* Pb: [0.3, 0.6]', 'quadrantChart\n  title Ta Tb\n  x-axis Xa --> Xb\n  quadrant-1 Qa Qb\n  Pa Pb: [0.3, 0.6]'],
  ['sankey nodes', 'sankey-beta\nQa <b>Qb</b>,B,10', 'sankey-beta\nQa Qb,B,10'],
]

// Region columns are terminal display cells, not string indices.
function cellSlice(line: string, start: number, end: number): string {
  let column = 0
  let out = ''
  for (const { segment } of new Intl.Segmenter().segment(line)) {
    if (column >= start && column < end) out += segment
    column += visualWidth(segment)
  }
  return out
}

/** Read exact authored coordinates, independently of a container's frame bounds. */
function regionText(ascii: string, region: AsciiRegion): string {
  const lines = ascii.split('\n')
  let text = '', row: number | undefined
  for (const cell of region.authoredTextCells ?? []) {
    if (row !== undefined && row !== cell.row) text += '\n'
    text += cellSlice(lines[cell.row] ?? '', cell.column, cell.column + visualWidth(cell.glyph))
    row = cell.row
  }
  return text.replace(/\s+/g, ' ').trim()
}

/** Every region that claims projected text, with what its cells show. */
function claims(source: string): Array<{ id: string; projectedText: string; drawn: string }> {
  const { ascii, regions } = renderMermaidASCIIWithMeta(source, { colorMode: 'none' })
  return regions.flatMap(region => region.projectedText === undefined ? [] : [{
    id: region.id,
    projectedText: region.projectedText.replace(/\s+/g, ' ').trim(),
    drawn: regionText(ascii, region),
  }])
}

describe('terminal labels draw their display text', () => {
  const svgText = (source: string) => [...renderMermaidSVG(source).matchAll(/<text\b[^>]*>([\s\S]*?)<\/text>/g)]
    .map(match => decodeXML(match[1]!.replace(/<[^>]+>/g, '')))

  it('Sequence encoded tags remain literal in every formatted label context', () => {
    const tag = (text: string) => `#lt;b#gt;${text}#lt;/b#gt;`
    const source = `sequenceDiagram
title ${tag('Title')}
box transparent ${tag('Box')}
participant A@{ "type": "boundary" } as ${tag('Alias')}
participant B
end
autonumber
alt ${tag('Header')}
A->>B: ${tag('Message')}
Note over A: ${tag('Note')}
else ${tag('Divider')}
B->>A: done
end`
    // Box frames and control frames have independent terminal placement. Test
    // the text contexts separately so overlap does not become a text oracle.
    const withoutBox = source.replace(`box transparent ${tag('Box')}\n`, '').replace('participant B\nend', 'participant B')
    const drawn = svgText(source).join('\n')
    for (const name of ['Title', 'Box', 'Alias', 'Header', 'Message', 'Note', 'Divider']) {
      const literal = `<b>${name}</b>`
      expect(drawn).toContain(literal)
      const terminalSource = name === 'Header' || name === 'Divider' ? withoutBox : source
      for (const useAscii of [false, true]) expect(renderMermaidASCII(terminalSource, { colorMode: 'none', useAscii })).toContain(literal)
    }
    for (const claim of claims(withoutBox)) expect(claim.projectedText).toBe(claim.drawn)
  })

  it('Sequence entities cannot create emphasis or line breaks after decoding', () => {
    const payload = '#42;literal#42; *styled* #92;n #lt;br#gt;'
    const source = `sequenceDiagram\nparticipant A as ${payload}\nA->>B: ${payload}\nNote over B: ${payload}`
    const visible = String.raw`*literal* styled \n <br>`
    expect(svgText(source).filter(text => text === visible)).toHaveLength(3)
    expect(renderMermaidASCII(source, { colorMode: 'none' })).toContain(visible)
    for (const claim of claims(source)) expect(claim.projectedText).toBe(claim.drawn)
  })

  it.each([
    ['Sequence', 'message', 'sequenceDiagram\nautonumber\nA->>B: #lt;b#gt;literal#lt;/b#gt; *real*\nB->>B: #42;literal#42; <b>real</b>\nB->>A: MiXeD ß *word*', ['1. <b>literal</b> real', '2. *literal* real', '3. MiXeD ß word']],
    ['Flowchart ordinary', 'edge', 'flowchart LR\nA -->|<b>MiXeD</b>| B', ['MiXeD']],
    ['Flowchart literal', 'edge', 'flowchart LR\nA -->|#lt;b#gt;literal#lt;/b#gt; <b>MiXeD</b>| B', ['<b>literal</b> MiXeD']],
    ['ER ordinary', 'relationship', 'erDiagram\nA ||--o{ B : "**MiXeD**"', ['MiXeD']],
    ['ER literal', 'relationship', 'erDiagram\nA ||--o{ B : "#lt;b#gt;literal#lt;/b#gt; **MiXeD**"', ['<b>literal</b> MiXeD']],
    ['Class ordinary', 'relationship', 'classDiagram\nA --> B : **MiXeD**', ['MiXeD']],
    ['Class literal', 'relationship', 'classDiagram\nA --> B : #lt;b#gt;literal#lt;/b#gt; **MiXeD**', ['<b>literal</b> MiXeD']],
  ] as const)('%s connector receipts keep untransformed display text', (_family, role, source, expected) => {
    for (const useAscii of [false, true]) {
      for (const style of [undefined, { roles: { edge: { textTransform: 'uppercase' as const, letterSpacing: 2 } } }]) {
        const rendered = renderMermaidASCIIWithReceipt(source, { colorMode: 'none', useAscii, style })
        const messages = rendered.terminalStyle.connectorProjection.connectors.filter(connector => connector.role === role)
        expect(messages.flatMap(message => message.labels.map(label => label.text))).toEqual([...expected])
        for (const label of expected) expect(rendered.text).toContain(label)
      }
    }
    for (const claim of claims(source)) expect(claim.projectedText).toBe(claim.drawn)
  })

  it('Sequence typed strings interpret formatting but keep entity-looking text literal', () => {
    const parsed = parseRegisteredMermaid('sequenceDiagram\nA->>B: #lt;b#gt;X#lt;/b#gt;')
    if (!parsed.ok) throw new Error('Sequence fixture failed')
    expect(svgText(serializeMermaid(parsed.value))).toContain('<b>X</b>')
    const styled = mutate(parsed.value, { kind: 'set_message_text', index: 0, text: '<b>Y</b>' })
    if (!styled.ok) throw new Error(styled.error.message)
    expect(svgText(serializeMermaid(styled.value))).toContain('Y')
    expect(svgText(serializeMermaid(styled.value))).not.toContain('<b>Y</b>')
    const literal = mutate(styled.value, { kind: 'set_message_text', index: 0, text: '#quot;\nnext' })
    if (!literal.ok) throw new Error(literal.error.message)
    const exported = serializeMermaid(literal.value)
    expect(svgText(exported)).toContain('#quot;next')
    expect(renderMermaidASCII(exported, { colorMode: 'none' })).toContain('#quot;')
    expect(renderMermaidASCII(exported, { colorMode: 'none' })).toContain('next')
  })

  it.each(FORMATTED)('%s: formatting adds no characters', (family, formatted, plain) => {
    for (const useAscii of [false, true]) {
      expect({ family, useAscii, ascii: renderMermaidASCII(formatted, { colorMode: 'none', useAscii }) })
        .toEqual({ family, useAscii, ascii: renderMermaidASCII(plain, { colorMode: 'none', useAscii }) })
    }
  })

  // A quadrant region is one row of the frame; a line break in its (quoted)
  // label shows as a space rather than a newline written into the grid.
  it('a one-row quadrant slot shows a line break as a space', () => {
    const rows = renderMermaidASCII('quadrantChart\n  quadrant-1 "Qa<br/>Qb"\n  quadrant-2 c', { colorMode: 'none' }).split('\n')
    const frame = rows.filter(row => /^[│├┌└]/.test(row))
    expect({
      label: rows.filter(row => row.includes('Qa')).map(row => row.includes('Qa Qb')),
      frameWidths: [...new Set(frame.map(visualWidth))],
    }).toEqual({ label: [true], frameWidths: [visualWidth(frame[0]!)] })
  })

  const META_SOURCES: ReadonlyArray<readonly [string, string]> = [
    ...FORMATTED.map(([family, formatted]) => [family, formatted] as const),
    ['Gantt literal text', 'gantt\n  dateFormat YYYY-MM-DD\n  section Sa <b>Sb</b>\n    Ta **Tb** :a1, 2024-01-01, 1d'],
    ['XYChart literal text', 'xychart-beta\n  title "Ta <b>Tb</b>"\n  x-axis ["Ca *Cb*", b]\n  bar [1, 2]'],
    ['GitGraph literal text', 'gitGraph\n  commit id: "Ca <i>Cb</i>"'],
  ]

  // The same invariant over generated labels mixing text with formatting tags,
  // markdown-lite markers and line breaks, in each drawer that formats.
  it('projectedText is what the cells show for generated formatted labels', () => {
    const PIECES = ['Qa', 'Qb', 'Zed', ' ', '<b>', '</b>', '<i>', '</i>', '**', '*', '~~', '<br/>', 'c<d>e']
    const labelArb = fc.array(fc.constantFrom(...PIECES), { minLength: 1, maxLength: 6 })
      .map(pieces => pieces.join('').trim())
      .filter(label => /[A-Za-z]/.test(label.replace(/<[^>]*>/g, '')))
    const SOURCES: ReadonlyArray<(label: string) => string> = [
      label => `graph TD\n  A[${label}] --> B[Plain]`,
      label => `sequenceDiagram\n  participant A as ${label}\n  A->>B: hi`,
      label => `stateDiagram-v2\n  s1 : ${label}\n  s1 --> s2`,
    ]
    let checked = 0
    fc.assert(fc.property(labelArb, fc.integer({ min: 0, max: SOURCES.length - 1 }), (label, which) => {
      const source = SOURCES[which]!(label)
      const regions = claims(source)
      expect(regions.length, source).toBeGreaterThan(0)
      for (const region of regions) {
        checked++
        expect({ source, id: region.id, projectedText: region.projectedText })
          .toEqual({ source, id: region.id, projectedText: region.drawn })
      }
    }), fcParameters({ numRuns: 60 }))
    expect(checked).toBeGreaterThan(0)
  })

  it.each(META_SOURCES)('%s: projectedText is what the cells show', (family, source) => {
    const regions = claims(source)
    expect({ family, claimed: regions.length > 0 }).toEqual({ family, claimed: true })
    for (const region of regions) {
      expect({ family, id: region.id, projectedText: region.projectedText })
        .toEqual({ family, id: region.id, projectedText: region.drawn })
    }
  })
})
