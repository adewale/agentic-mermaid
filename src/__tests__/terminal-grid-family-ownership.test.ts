import { describe, expect, test } from 'bun:test'
import { renderArchitectureAscii } from '../ascii/architecture.ts'
import { renderClassAscii } from '../ascii/class-diagram.ts'
import { renderErAscii } from '../ascii/er-diagram.ts'
import { renderGitGraphAscii } from '../ascii/gitgraph.ts'
import { renderMindmapAscii } from '../ascii/mindmap.ts'
import { renderSequenceAscii } from '../ascii/sequence.ts'
import { DEFAULT_ASCII_THEME } from '../ascii/ansi.ts'
import { beginTerminalCapture, capturedTerminalDocument } from '../ascii/terminal-document.ts'
import type { AsciiConfig } from '../ascii/types.ts'
import { visualWidth } from '../ascii/width.ts'
import { parseGitGraph } from '../gitgraph/parser.ts'
import { parseMindmap } from '../mindmap/parser.ts'
import { renderMermaidWithActions } from '../agent/index.ts'

function capture(render: (config: AsciiConfig) => string, useAscii = false) {
  const config: AsciiConfig = { useAscii, paddingX: 1, paddingY: 1, boxBorderPadding: 1, graphDirection: 'TD' }
  beginTerminalCapture(config)
  const output = render(config)
  const doc = capturedTerminalDocument(config)!
  const regions = doc.regions()
  const region = (id: string) => regions.find(item => item.id === id)!
  return { output, doc, regions, region }
}

describe('Terminal grid family adapters emit owned primitives', () => {
  test('native title fallbacks share each family display policy and inline titles retain priority', () => {
    const renderers = [
      ['classDiagram', 'class A', (source: string, config: AsciiConfig) => renderClassAscii(source, config)],
      ['sequenceDiagram', 'participant A', (source: string, config: AsciiConfig) => renderSequenceAscii(source, config)],
      ['architecture-beta', 'service a(server)[A]', (source: string, config: AsciiConfig) => renderArchitectureAscii(source.split('\n'), config)],
    ] as const
    for (const [header, body, renderer] of renderers) {
      const fallback = capture(config => { config.title = '**Front**<br/>Heading'; return renderer(`${header}\n${body}`, config) })
      expect(fallback.region('title').projectedText).toBe('Front\nHeading')
      const inline = capture(config => { config.title = '**Front**<br/>Heading'; return renderer(`${header}\ntitle Inline\n${body}`, config) })
      expect(inline.region('title').projectedText).toBe('Inline')
      expect(inline.output).not.toContain('Front')
    }
    const er = capture(config => { config.title = '**Front**<br/>Heading'; return renderErAscii('erDiagram\nA', config) })
    expect(er.region('title').projectedText).toBe('Front\nHeading')
    expect(er.region('A').canvasRow).toBeGreaterThan(er.region('title').canvasRow + 2)
    const emptyEr = capture(config => { config.title = '**Title**'; return renderErAscii('erDiagram', config) })
    expect(emptyEr.output).toBe('Title')
    const gitgraph = capture(config => { config.title = '**Literal**'; return renderGitGraphAscii(parseGitGraph('gitGraph\ncommit id:"A"'), config, 'none', DEFAULT_ASCII_THEME) })
    expect(gitgraph.region('title').projectedText).toBe('**Literal**')
  })

  test.each([false, true])('Class owns namespace, cards, compartments, relationships and notes (ASCII=%s)', useAscii => {
    const source = `classDiagram
namespace Domain {
  class A["Wide 界👩‍🔬"] {
    +String name
    +work(value) Result
  }
  class B
}
A "1" --> "*" B : uses
note for A "owned note with é and 🙂"`
    const { output, doc, region } = capture(config => renderClassAscii(source, config), useAscii)
    expect(output).toContain('Wide 界👩‍🔬')
    expect(output).toContain('owned note with é and 🙂')
    expect(region('Domain').kind).toBe('cluster')
    expect(region('A').parentId).toBe('Domain')
    expect(region('A:compartment:1')).toMatchObject({ kind: 'compartment', parentId: 'A' })
    expect(region('A:compartment:2')).toMatchObject({ kind: 'compartment', parentId: 'A' })
    expect(region('A:compartment:1').ownedCellSpans.length).toBeGreaterThan(0)
    expect(region('A:compartment:2').ownedCellSpans.length).toBeGreaterThan(0)
    expect(region('relationship:0').kind).toBe('edge')
    expect(region('relationship:0').ownedCellSpans.length).toBeGreaterThan(1)
    expect(region('note:0').parentId).toBe('A')
    for (const [, , cell] of doc.entries()) if (cell.kind === 'text') expect(cell.owners.length).toBeGreaterThan(0)
    expect(doc.diagnostics.filter(item => item.code === 'TERMINAL_TEXT_COLLISION')).toEqual([])
  })

  test('Class applies authored text and stroke colors while retaining typed cell roles', () => {
    const { doc, output } = capture(config => renderClassAscii(`classDiagram
class A {
 +String name
}
classDef hot color:#ff0000,stroke:#00ff00
class A hot`, config, 'none'))
    expect(output).not.toContain('\x1b[')
    const cells = [...doc.entries()].filter(([, , cell]) => cell.owners.some(owner => owner.id === 'A'))
    expect(cells.some(([, , cell]) => cell.kind === 'text' && cell.color === '#ff0000')).toBe(true)
    expect(cells.some(([, , cell]) => cell.kind === 'stroke' && cell.color === '#00ff00')).toBe(true)
  })

  test('Class reports only actual authored style projections and retains empty native captures', () => {
    const styled = capture(config => renderClassAscii('classDiagram\nclass A\nstyle A fill:#f00,stroke-width:4px', config))
    expect(styled.doc.diagnostics).toContainEqual(expect.objectContaining({ code: 'TERMINAL_FAMILY_PROJECTION', feature: 'class.A.style.fill' }))
    expect(styled.doc.diagnostics).toContainEqual(expect.objectContaining({ code: 'TERMINAL_FAMILY_PROJECTION', feature: 'class.A.style.stroke-width' }))
    expect(capture(config => renderClassAscii('classDiagram\nclass A', config)).doc.diagnostics).toEqual([])
    const empty = capture(config => renderClassAscii('classDiagram', config))
    expect(empty.output).toBe('')
    expect(empty.doc.regions()).toEqual([])
    const titled = capture(config => renderClassAscii('classDiagram\ntitle Only title', config))
    expect(titled.output).toBe('Only title')
    expect(titled.region('title').projectedText).toBe('Only title')
  })

  test('legal escaped Class IDs cannot alias generated notes, relationships or action targets', () => {
    const source = 'classDiagram\nclass `note:0`["Authored"]\nclass `relationship:0`\n`note:0` --> `relationship:0` : authored edge\nnote for `note:0` "Generated note"\nclick `note:0` href "https://example.com/docs"'
    const { output, regions, region } = capture(config => renderClassAscii(source, config))
    expect(output).toContain('Authored')
    expect(output).toContain('Generated note')
    expect(region('note:0').projectedText).toBe('Authored')
    expect(region('note:0#1').projectedText).toBe('Generated note')
    expect(region('note:0#1').parentId).toBe('note:0')
    expect(region('relationship:0').kind).toBe('node')
    expect(region('relationship:0#1').kind).toBe('edge')
    expect(new Set(regions.map(item => `${item.kind}:${item.id}`)).size).toBe(regions.length)
    const artifact = renderMermaidWithActions(source, { format: 'ascii', options: { colorMode: 'none' } })
    expect(artifact.actionSurface.actions[0]).toMatchObject({ target: 'note:0', href: 'https://example.com/docs', executable: false })
  })

  test('Class reserves the complete namespace header and emits a separate inline title band', () => {
    const { output, doc, region } = capture(config => renderClassAscii(`classDiagram
title Diagram title
namespace Domain["First<br/>Second<br/>Third"] {
  class A
}`, config))
    const rows = output.split('\n')
    expect(rows[0]).toContain('Diagram title')
    expect(rows.findIndex(row => row.includes('First'))).toBeLessThan(rows.findIndex(row => row.includes('Second')))
    expect(rows.findIndex(row => row.includes('Second'))).toBeLessThan(rows.findIndex(row => row.includes('Third')))
    expect(rows.findIndex(row => row.includes('Third'))).toBeLessThan(region('A').canvasRow)
    expect(region('title').kind).toBe('label')
    expect(doc.diagnostics.filter(item => item.code === 'TERMINAL_TEXT_COLLISION')).toEqual([])
  })

  test('ER owns groups, entities, attributes, cardinality markers and relationship labels', () => {
    const { output, doc, region } = capture(config => renderErAscii(`erDiagram
subgraph Domain["Data domain"]
  A["顧客🙂"] {
    string name PK "label 👩‍💻"
  }
  B {
    int id PK
  }
end
A ||--o{ B : "owns é"`, config))
    expect(output).toContain('Data domain')
    expect(output).toContain('顧客🙂')
    expect(output).toContain('label 👩‍💻')
    expect(output).toContain('owns é')
    expect(region('Domain')).toMatchObject({ kind: 'group', members: ['A', 'B'] })
    expect(region('A').parentId).toBe('Domain')
    expect(region('A:compartment:1')).toMatchObject({ kind: 'compartment', parentId: 'A' })
    expect(region('A:compartment:1').ownedCellSpans.length).toBeGreaterThan(0)
    expect(region('relationship:0').ownedCellSpans.length).toBeGreaterThan(0)
    const relationCells = [...doc.entries()].filter(([, , cell]) => cell.owners.some(owner => owner.id === 'relationship:0'))
    expect(relationCells.some(([, , cell]) => cell.kind === 'marker')).toBe(true)
    expect(relationCells.some(([, , cell]) => cell.kind === 'text')).toBe(true)
    for (const [, , cell] of doc.entries()) if (cell.kind === 'text') expect(cell.owners.length).toBeGreaterThan(0)
    expect(doc.diagnostics.filter(item => item.code === 'TERMINAL_TEXT_COLLISION')).toEqual([])
  })

  test('ER native groups retain frames, local directions and actual group-boundary relationship ports', () => {
    const { output, doc, region } = capture(config => renderErAscii(`erDiagram
subgraph G["Domain"]
direction TB
A
B
end
C
G ||--o{ C : boundary`, config))
    expect(output).toContain('Domain')
    expect(output).toContain('boundary')
    expect(region('B').canvasRow).toBeGreaterThan(region('A').canvasRow)
    expect(region('G').members).toEqual(['A', 'B'])
    const ports = region('relationship:0').ports!
    expect(ports).toHaveLength(2)
    expect(ports.find(port => port.end === 'start')?.nodeId).toBe('G')
    expect(ports.find(port => port.end === 'end')?.nodeId).toBe('C')
    expect(doc.diagnostics.filter(item => item.code === 'TERMINAL_TEXT_COLLISION')).toEqual([])
    const emptyGroups = capture(config => renderErAscii('erDiagram\nsubgraph First\nend\nsubgraph Second\nend\nFirst ||--|| Second : group only', config))
    expect(emptyGroups.output).toContain('group only')
    expect(emptyGroups.region('First').kind).toBe('group')
    expect(emptyGroups.region('Second').kind).toBe('group')
    expect(emptyGroups.region('relationship:0').ports?.map(port => port.nodeId)).toEqual(['First', 'Second'])
  })

  test('Architecture owns group geometry, ports, services, junctions and routes without serialization inference', () => {
    const source = `architecture-beta
group cloud(cloud)[Cloud]
service api(server)[API 👩‍🔬] in cloud
service db(database)[Database] in cloud
junction bus in cloud
api:R --> L:bus
bus:R --> L:db`
    const { output, doc, region } = capture(config => renderArchitectureAscii(source.split('\n'), config))
    expect(output).toContain('API 👩‍🔬')
    expect(output).toContain('Database')
    expect(region('cloud')).toMatchObject({ kind: 'group', members: ['api', 'db', 'bus'] })
    expect(region('api').parentId).toBe('cloud')
    expect(region('bus').parentId).toBe('cloud')
    expect(region('edge:0').kind).toBe('edge')
    expect(region('edge:1').kind).toBe('edge')
    expect(region('edge:0').ownedCellSpans.length).toBeGreaterThan(0)
    for (const [, , cell] of doc.entries()) if (cell.kind === 'text') expect(cell.owners.length).toBeGreaterThan(0)
    expect(doc.diagnostics.filter(item => item.code === 'TERMINAL_TEXT_COLLISION')).toEqual([])
  })

  test('Architecture reserves crowded authored faces and never crops top-side ports', () => {
    const source = `architecture-beta\nservice a(server)[A]\nservice b(server)[B]\n${Array.from({ length: 6 }, (_, index) => `a:R -[parallel${index}]-> L:b`).join('\n')}`
    const { output, doc, regions } = capture(config => renderArchitectureAscii(source.split('\n'), config))
    const sourcePorts = regions.filter(item => item.kind === 'edge').flatMap(item => item.ports ?? []).filter(port => port.end === 'start')
    expect(new Set(sourcePorts.map(port => `${port.x},${port.y}`)).size).toBe(6)
    for (let index = 0; index < 6; index++) expect(output).toContain(`parallel${index}`)
    expect(doc.diagnostics).toEqual([])
    const top = capture(config => renderArchitectureAscii('architecture-beta\nservice a(server)[A]\nservice b(server)[B]\na:T --> T:b'.split('\n'), config))
    expect(top.region('edge:0').ports).toHaveLength(2)
    for (const port of top.region('edge:0').ports!) { expect(port.y).toBeGreaterThanOrEqual(0); expect(port.x).toBeGreaterThanOrEqual(0) }
    expect(top.doc.diagnostics).toEqual([])
  })

  test.each([false, true])('Architecture separates sibling frames and fits every nested child before painting (ASCII=%s)', useAscii => {
    const source = `architecture-beta
group edge(cloud)[Edge]
group app(server)[Application]
service api(server)[Public API] in app
junction bus in app
service db(database)[Primary DB]
api:R --> L:db
api:B -["async fan-out"]-> T:bus`
    const siblings = capture(config => renderArchitectureAscii(source.split('\n'), config), useAscii)
    const edge = siblings.region('edge'), app = siblings.region('app')
    expect(edge.canvasRow + (edge.rowSpan ?? 1)).toBeLessThan(app.canvasRow)
    expect(siblings.output).toContain('(cloud) Edge')
    expect(siblings.output).toContain('(server) Application')
    expect(siblings.doc.diagnostics).toEqual([])

    const nested = capture(config => renderArchitectureAscii(`architecture-beta
group outer(cloud)[Outer header]
group inner(server)[First header<br/>Second complete header] in outer
service api(server)[A child much wider than its initial slot] in inner
junction bus in inner
service db(database)[Database] in outer
api:R --> L:bus
db:L --> R:api`.split('\n'), config), useAscii)
    for (const [parentId, childId] of [['outer', 'inner'], ['outer', 'db'], ['inner', 'api'], ['inner', 'bus']]) {
      const parent = nested.region(parentId!), child = nested.region(childId!)
      expect(child.parentId).toBe(parentId)
      expect(child.canvasColStart).toBeGreaterThan(parent.canvasColStart)
      expect(child.canvasColEnd).toBeLessThan(parent.canvasColEnd)
      expect(child.canvasRow).toBeGreaterThan(parent.canvasRow)
      expect(child.canvasRow + (child.rowSpan ?? 1)).toBeLessThan(parent.canvasRow + (parent.rowSpan ?? 1))
    }
    expect(nested.region('outer').members).toEqual(['inner', 'db'])
    expect(nested.region('inner').projectedText).toBe('(server) First header\nSecond complete header')
    expect(nested.region('api').canvasRow).toBeGreaterThan(nested.region('inner').canvasRow + 2)
    expect(nested.output).toContain('A child much wider than its initial slot')
    expect(nested.doc.diagnostics).toEqual([])
  })

  test('Mindmap keeps equal visible labels under distinct semantic owners and emits branch roles', () => {
    const diagram = parseMindmap(`mindmap
root((Root))
  first[Repeated 🙂]
    leaf{{Leaf é}}
      ::icon(mdi:lightbulb)
  second(Repeated 🙂)`)
    const { output, doc, region } = capture(config => renderMindmapAscii(diagram, config, 'none', DEFAULT_ASCII_THEME, 44))
    expect(output.match(/Repeated 🙂/g)).toHaveLength(2)
    expect(output).toContain('mdi:lightbulb')
    expect(output).toContain('((Root))')
    expect(Math.max(...output.split('\n').map(visualWidth))).toBeLessThanOrEqual(44)
    expect(region('first').parentId).toBe('root')
    expect(region('second').parentId).toBe('root')
    expect(region('leaf').parentId).toBe('first')
    expect(region('edge:leaf').kind).toBe('edge')
    expect([...doc.entries()].some(([, , cell]) => cell.kind === 'stroke' && cell.role === 'line')).toBe(true)
    for (const [, , cell] of doc.entries()) if (cell.kind === 'text') expect(cell.owners.length).toBeGreaterThan(0)
  })

  test('soft maxWidth wraps display labels while semantic IDs and original literal text remain intact', () => {
    for (const [id, render] of [
      ['A', (config: AsciiConfig) => renderClassAscii('classDiagram\nclass A["Every label word must remain visible"]', config)],
      ['A', (config: AsciiConfig) => renderErAscii('erDiagram\nA["Every label word must remain visible"]', config)],
      ['root', (config: AsciiConfig) => renderMindmapAscii(parseMindmap('mindmap\nroot[Every label word must remain visible]'), config, 'none', DEFAULT_ASCII_THEME)],
    ] as const) {
      const { output, region } = capture(config => { config.maxWidth = 24; return render(config) })
      expect(output).not.toContain('Every label word must remain visible')
      for (const word of ['Every', 'label', 'word', 'must', 'remain', 'visible']) expect(output).toContain(word)
      expect(region(id).kind).toBe('node')
    }
  })

  test.each(['TB', 'BT', 'LR', 'RL'])('Class and ER allocate %s geometry while keeping labels and compartment order readable', direction => {
    for (const renderer of [renderClassAscii, renderErAscii]) {
      const source = renderer === renderClassAscii
        ? `classDiagram\ndirection ${direction}\nclass A["Alpha 界"] {\n +String name\n}\nA "0..1" --> "1..*" B : reads`
        : `erDiagram\ndirection ${direction}\nA["Alpha 界"] {\n string name\n}\nA ||--o{ B : reads`
      const { output, doc, region } = capture(config => renderer(source, config))
      expect(output).toContain('Alpha 界')
      expect(output).toContain('name')
      expect(output).toContain('reads')
      const a = region('A'), b = region('B')
      if (direction === 'TB') expect(b.canvasRow).toBeGreaterThan(a.canvasRow)
      if (direction === 'BT') expect(b.canvasRow).toBeLessThan(a.canvasRow)
      if (direction === 'LR') expect(b.canvasColStart).toBeGreaterThan(a.canvasColStart)
      if (direction === 'RL') expect(b.canvasColStart).toBeLessThan(a.canvasColStart)
      const rows = output.split('\n')
      expect(rows.findIndex(row => row.includes('Alpha 界'))).toBeLessThan(rows.findIndex(row => row.includes('name')))
      expect(doc.diagnostics.filter(item => item.code === 'TERMINAL_TEXT_COLLISION')).toEqual([])
    }
  })

  test('Class retains both endpoint marker types and every multiplicity under relationship ownership', () => {
    const { output, doc, region } = capture(config => renderClassAscii('classDiagram\nA "0..1" o--|> "1..*" B : membership', config))
    expect(output).toContain('0..1')
    expect(output).toContain('1..*')
    expect(output).toContain('membership')
    expect(region('relationship:0:from-cardinality').parentId).toBe('relationship:0')
    expect(region('relationship:0:to-cardinality').parentId).toBe('relationship:0')
    const markers = [...doc.entries()].filter(([, , cell]) => cell.kind === 'marker' && cell.owners.some(owner => owner.id === 'relationship:0')).map(([, , cell]) => cell.glyph)
    expect(markers).toContain('◇')
    expect(markers).toContain('▽')
    expect(doc.diagnostics).toEqual([])
  })

  test('Class and ER self relations have complete exterior loops and owned labels', () => {
    for (const source of ['classDiagram\nA --> A : recursive', 'erDiagram\nA ||--o{ A : recursive']) {
      const { output, doc, region } = capture(config => source.startsWith('class') ? renderClassAscii(source, config) : renderErAscii(source, config))
      expect(output).toContain('recursive')
      const node = region('A'), route = region('relationship:0')
      expect(route.ownedCellSpans.length).toBeGreaterThan(3)
      const cells = [...doc.entries()].filter(([, , cell]) => cell.kind === 'stroke' && cell.owners.some(owner => owner.id === route.id))
      expect(cells.length).toBeGreaterThan(5)
      expect(cells.some(([x, y]) => x >= node.canvasColEnd || y >= node.canvasRow + (node.rowSpan ?? 1))).toBe(true)
      expect(doc.diagnostics.filter(item => item.code === 'TERMINAL_TEXT_COLLISION')).toEqual([])
    }
  })

  test('parallel Class and ER relationships allocate separate face ports and preserve all labels', () => {
    for (const source of ['classDiagram\nA --> B : first\nA --> B : second\nA --> B : third', 'erDiagram\nA ||--o{ B : first\nA ||--o{ B : second\nA ||--o{ B : third']) {
      const { output, doc, region } = capture(config => source.startsWith('class') ? renderClassAscii(source, config) : renderErAscii(source, config))
      for (const label of ['first', 'second', 'third']) expect(output).toContain(label)
      for (let index = 0; index < 3; index++) expect(region(`relationship:${index}`).ownedCellSpans.length).toBeGreaterThan(0)
      expect(doc.diagnostics).toEqual([])
    }
  })

  test.each(['LR', 'TB', 'BT'])('GitGraph %s preserves commit labels, tags, parent edges and branch ownership', direction => {
    const diagram = parseGitGraph(`gitGraph ${direction}:
commit id:"base" msg:"Base 界"
branch topic
commit id:"work" msg:"Repeated 🙂" tag:"alpha" tag:"beta"
checkout main
commit id:"release" msg:"Repeated 🙂" type:REVERSE
merge topic id:"join" tag:"v1"`, { title: 'Release title' })
    const { output, doc, region } = capture(config => renderGitGraphAscii(diagram, config, 'none', DEFAULT_ASCII_THEME))
    expect(output.split('\n')[0]).toContain('Release title')
    expect(output.match(/Repeated 🙂/g)).toHaveLength(2)
    expect(output).toContain('[tag: alpha]')
    expect(output).toContain('[tag: beta]')
    expect(output.indexOf('[tag: alpha]')).toBeLessThan(output.indexOf('[tag: beta]'))
    expect(region('title').kind).toBe('label')
    expect(region('work').parentId).toBe('branch:topic')
    expect(region('release').parentId).toBe('branch:main')
    for (const commit of diagram.commits) for (const parent of commit.parents) expect(region(`edge:${parent}:${commit.id}`).kind).toBe('edge')
    const branch = region('branch:topic')
    expect(branch.members).toContain('work')
    expect([...doc.entries()].some(([, , cell]) => cell.color !== undefined)).toBe(true)
    expect(doc.diagnostics.filter(item => item.code === 'TERMINAL_TEXT_COLLISION')).toEqual([])
  })
})
