import { describe, expect, test } from 'bun:test'
import { renderMermaidASCII, renderMermaidSVG, verifyNoExternalRefs } from '../index.ts'
import { layoutMindmap } from '../mindmap/layout.ts'
import { parseMindmap } from '../mindmap/parser.ts'
import { parseSequenceDiagram } from '../sequence/parser.ts'
import { parseClassDiagram } from '../class/parser.ts'
import { layoutClassDiagram } from '../class/layout.ts'
import { parseErDiagram } from '../er/parser.ts'
import { layoutErDiagram } from '../er/layout.ts'
import { parseXYChart } from '../xychart/parser.ts'
import { toMermaidLines } from '../mermaid-source.ts'
import { parseQuadrantChart } from '../quadrant/parser.ts'
import { layoutQuadrantChart } from '../quadrant/layout.ts'
import { parseMermaid, serializeMermaid, verifyMermaid } from '../agent/index.ts'
import { BUILTIN_FAMILY_METADATA, getFamily } from '../agent/families.ts'
import { parseGitGraph } from '../gitgraph/parser.ts'
import { layoutGitGraph } from '../gitgraph/layout.ts'
import { measureTextWidth } from '../text-metrics.ts'
import { explicitFamilyConfigDiagnostics } from '../shared/family-config-diagnostics.ts'

const lines = (source: string) => source.split('\n').map(line => line.trim()).filter(Boolean)

describe('Closing The Gap — official Mermaid 11.16 contracts', () => {
  test('flowchart metadata produces native icon/image marks and modeled edge presentation', () => {
    const source = `flowchart LR
  A@{ icon: "fa fa-book", form: "circle", label: "Docs" }
  B@{ img: "https://example.invalid/picture.png", label: "Preview" }
  A e1@--> B
  e1@{ curve: natural, animate: true, animation: fast }
  click A href "https://example.com/docs"`
    const svg = renderMermaidSVG(source, { embedFontImport: false })
    expect(svg).toContain('class="flowchart-icon"')
    expect(svg).toContain('class="flowchart-image-placeholder"')
    expect(svg).toContain('data-image-src="https://example.invalid/picture.png"')
    expect(svg).toContain('data-curve="natural"')
    expect(svg).toContain('data-animate="true"')
    expect(svg).toContain('data-animation="fast"')
    expect(svg).toContain('stroke-dasharray="8 4"')
    expect(svg).not.toContain('<animate')
    expect(svg).toContain('data-href="https://example.com/docs" role="link"')
    const agent = parseMermaid(source)
    expect(agent.ok).toBe(true)
    if (!agent.ok) return
    expect(agent.value.body.kind).toBe('flowchart')
    expect(serializeMermaid(agent.value)).toContain('click A href "https://example.com/docs"')
    expect(verifyMermaid(agent.value).warnings).toContainEqual(expect.objectContaining({ syntax: 'flowchart_image_placeholder' }))
    expect(verifyNoExternalRefs(renderMermaidSVG(source, { security: 'strict' }))).toEqual({ ok: true, refs: [] })
  })

  test('mindmap default is central and bilateral while tidy-tree remains an explicit one-sided alternate', () => {
    const source = `mindmap
  Root
    Strategy
      Research
    Delivery
      Build
    People
      Hiring
    Operations
      Reliability`
    const radial = layoutMindmap(parseMindmap(source))
    const root = radial.nodes.find(node => node.id === 'Root')!
    const children = radial.nodes.filter(node => node.parentId === root.id)
    expect(children.some(node => node.x + node.width < root.x)).toBe(true)
    expect(children.some(node => node.x > root.x + root.width)).toBe(true)
    expect(root.x + root.width / 2).toBeGreaterThan(radial.width * 0.3)
    expect(root.x + root.width / 2).toBeLessThan(radial.width * 0.7)

    const tidy = layoutMindmap(parseMindmap(source), { layout: 'tidy-tree' })
    const tidyRoot = tidy.nodes.find(node => node.id === 'Root')!
    expect(tidy.nodes.filter(node => node.parentId).every(node => node.x > tidyRoot.x)).toBe(true)
  })

  test('mindmap renders curved branches and local pictograms instead of icon-name text', () => {
    const svg = renderMermaidSVG(`mindmap
  Root
    Docs
    ::icon(fa fa-book)
    Risk
    ::icon(mdi mdi-skull-outline)`, { embedFontImport: false })
    expect(svg).toContain('class="mindmap-edge"')
    expect(svg).toMatch(/<path class="mindmap-edge"[^>]+ d="M [^"]+ C /)
    expect(svg).toContain('class="mindmap-icon-glyph"')
    expect(svg).not.toContain('>fa fa-book<')
    expect(svg).not.toContain('>mdi mdi-skull-outline<')
  })

  test('sequence uses closed actor and message-endpoint vocabularies for current official syntax', () => {
    const source = `sequenceDiagram
  participant DB@{ "type": "database", "alias": "Data" }
  participant Q@{ "type": "queue" }
  link DB: Dashboard @ https://example.com/db
  DB<<->>Q: sync
  DB-xQ: cancel
  DB->>()Q: publish`
    const diagram = parseSequenceDiagram(lines(source))
    expect(diagram.actors.map(actor => [actor.id, actor.type, actor.label])).toEqual([
      ['DB', 'database', 'Data'],
      ['Q', 'queue', 'Q'],
    ])
    expect(diagram.actors[0]?.links).toEqual({ Dashboard: 'https://example.com/db' })
    expect(diagram.messages.map(message => [message.startHead, message.endHead, message.centralStart, message.centralEnd])).toEqual([
      ['filled', 'filled', false, false],
      ['none', 'cross', false, false],
      ['none', 'filled', false, true],
    ])
    const agent = parseMermaid(source)
    expect(agent.ok).toBe(true)
    if (!agent.ok) return
    expect(agent.value.body.kind).toBe('sequence')
    if (agent.value.body.kind === 'sequence') {
      expect(agent.value.body.participants.map(participant => participant.kind)).toEqual(['database', 'queue'])
      expect(agent.value.body.messages.map(message => message.arrow)).toEqual(['<<->>', '-x', '->>'])
      expect(agent.value.body.statements?.some(statement => statement.kind === 'opaque-block')).toBe(false)
    }
    const canonical = serializeMermaid(agent.value)
    const reparsed = parseMermaid(canonical)
    expect(reparsed.ok).toBe(true)
    if (reparsed.ok) expect(serializeMermaid(reparsed.value)).toBe(canonical)
    expect(() => parseSequenceDiagram(lines('sequenceDiagram\n  participant X@{ "type": "unknown-shape" }'))).toThrow(/Unknown sequence actor type/)

    const svg = renderMermaidSVG(source, { embedFontImport: false })
    expect(svg).toContain('sequence-actor-database')
    expect(svg).toContain('data-start-head="filled" data-end-head="filled"')
    expect(svg).toContain('sequence-central-connection')
    expect(svg).toContain('data-links="{&quot;Dashboard&quot;:&quot;https://example.com/db&quot;}"')
    expect(getFamily('sequence')?.scenePrimitiveEvidence).toContainEqual(expect.objectContaining({
      role: 'chrome',
      primitive: 'shape',
      applicability: 'applicable',
      realization: 'native',
    }))
  })

  test('class diagrams render two-ended relations, lollipop interfaces, and notes', () => {
    const source = `classDiagram
  Animal <|--|> Zebra
  Whole *--o Part
  Caller <..> Callee
  Searchable ()-- Index
  note for Animal "base type"
  click Animal href "https://example.com/animal"`
    const parsed = parseClassDiagram(lines(source))
    expect(parsed.relationships[0]).toMatchObject({ markerAt: 'both' })
    expect(parsed.relationships[1]).toMatchObject({ markerAt: 'both', fromType: 'composition', toType: 'aggregation' })
    expect(parsed.relationships[2]).toMatchObject({ markerAt: 'both', fromType: 'dependency', toType: 'dependency' })
    expect(parsed.relationships[3]).toMatchObject({ type: 'lollipop', markerAt: 'from' })
    expect(parsed.notes).toEqual([{ text: 'base type', for: 'Animal' }])
    const agent = parseMermaid(source)
    expect(agent.ok).toBe(true)
    if (!agent.ok) return
    expect(agent.value.body.kind).toBe('class')
    if (agent.value.body.kind === 'class') {
      expect(agent.value.body.relations).toEqual(expect.arrayContaining([
        expect.objectContaining({ markerAt: 'both', fromKind: 'composition', toKind: 'aggregation' }),
        expect.objectContaining({ markerAt: 'both', fromKind: 'dependency', toKind: 'dependency' }),
        expect.objectContaining({ kind: 'lollipop', markerAt: 'from' }),
      ]))
      expect(agent.value.body.classes.find(cls => cls.id === 'Animal')?.href).toBe('https://example.com/animal')
    }
    const canonical = serializeMermaid(agent.value)
    expect(parseMermaid(canonical).ok).toBe(true)
    expect(canonical).toContain('Whole *--o Part')
    expect(canonical).toContain('Caller <..> Callee')

    const collisionLayout = layoutClassDiagram(parseClassDiagram(lines('classDiagram\n  A --> B\n  note for A "a deliberately wide note that used to cover B"')))
    const note = collisionLayout.notes[0]!
    for (const cls of collisionLayout.classes) {
      const overlaps = note.x < cls.x + cls.width && note.x + note.width > cls.x && note.y < cls.y + cls.height && note.y + note.height > cls.y
      expect(overlaps, `note must clear class ${cls.id}`).toBe(false)
    }
    const terminal = renderMermaidASCII(source)
    expect(terminal).toContain('base type')
    expect(terminal).toContain('link Animal: https://example.com/animal')

    const svg = renderMermaidSVG(source, { embedFontImport: false })
    expect(svg).toContain('class="class-note"')
    expect(svg).toContain('data-relation-type="lollipop"')
    expect(svg).toContain('marker-start=')
    expect(svg).toContain('marker-end=')
    expect(svg).toContain('data-href="https://example.com/animal" role="link"')
    expect(verifyNoExternalRefs(renderMermaidSVG(source, { security: 'strict' }))).toEqual({ ok: true, refs: [] })
  })

  test('ER preserves nested subgraph identity and renders Markdown labels', () => {
    const source = `erDiagram
  subgraph commerce [Commerce Domain]
    CUSTOMER
    subgraph orders [Order Domain]
      ORDER
    end
  end
  commerce ||--o{ orders : contains
  "This **is** _Markdown_"`
    const parsed = parseErDiagram(lines(source))
    expect(parsed.groups.map(group => ({ id: group.id, label: group.label, parentId: group.parentId }))).toEqual([
      { id: 'commerce', label: 'Commerce Domain', parentId: undefined },
      { id: 'orders', label: 'Order Domain', parentId: 'commerce' },
    ])
    const agent = parseMermaid(source)
    expect(agent.ok).toBe(true)
    if (!agent.ok) return
    expect(agent.value.body.kind).toBe('er')
    if (agent.value.body.kind === 'er') {
      expect(agent.value.body.groups?.map(group => group.id)).toEqual(['commerce', 'orders'])
      expect(agent.value.body.entities.some(entity => entity.id === 'commerce' || entity.id === 'orders')).toBe(false)
      expect(agent.value.body.relations[0]).toMatchObject({ from: 'commerce', to: 'orders' })
    }
    const canonical = serializeMermaid(agent.value)
    expect(parseMermaid(canonical).ok).toBe(true)

    const routed = layoutErDiagram(parseErDiagram(lines(`erDiagram
  subgraph local
    direction TB
    A ||--|| B : local
  end
  C ||--|| D : unrelated`)))
    const unrelated = routed.relationships.find(relation => relation.entity1 === 'C' && relation.entity2 === 'D')!
    const withoutScopedDirection = layoutErDiagram(parseErDiagram(lines(`erDiagram
  subgraph local
    A ||--|| B : local
  end
  C ||--|| D : unrelated`))).relationships.find(relation => relation.entity1 === 'C' && relation.entity2 === 'D')!
    expect(unrelated.points).toEqual(withoutScopedDirection.points)
    for (let index = 1; index < unrelated.points.length; index++) {
      const a = unrelated.points[index - 1]!, b = unrelated.points[index]!
      expect(Math.abs(a.x - b.x) < 0.01 || Math.abs(a.y - b.y) < 0.01).toBe(true)
    }
    const groupOnly = layoutErDiagram(parseErDiagram(lines(`erDiagram
  subgraph a [Alpha]
  end
  subgraph b [Beta]
  end
  a ||--|| b : contains`)))
    expect(groupOnly.groups.map(group => group.id)).toEqual(['a', 'b'])
    expect(groupOnly.relationships[0]?.points.length).toBeGreaterThanOrEqual(2)
    expect(groupOnly.width).toBeGreaterThan(0)
    expect(groupOnly.height).toBeGreaterThan(0)

    const svg = renderMermaidSVG(source, { embedFontImport: false })
    expect(svg).toContain('class="er-subgraph"')
    expect(svg).toContain('data-id="commerce"')
    expect(svg).toContain('font-weight="bold"')
    expect(svg).toContain('font-style="italic"')
  })

  test('XYChart retains and renders Mermaid 11.16 per-point labels in both orientations and terminal output', () => {
    const source = `xychart
  x-axis [Q1, Q2, Q3]
  y-axis 0 --> 100
  line [25 "Launch", 45, 90 "Target Hit"]`
    const chart = parseXYChart(toMermaidLines(source))
    expect(chart.series[0]?.pointLabels).toEqual(['Launch', undefined, 'Target Hit'])
    const agent = parseMermaid(source)
    expect(agent.ok).toBe(true)
    if (!agent.ok) return
    expect(agent.value.body.kind).toBe('xychart')
    if (agent.value.body.kind === 'xychart') expect(agent.value.body.series[0]?.pointLabels).toEqual(['Launch', undefined, 'Target Hit'])
    expect(serializeMermaid(agent.value)).toContain('25 "Launch"')
    const svg = renderMermaidSVG(source, { embedFontImport: false })
    expect(svg).toContain('class="xychart-point-label')
    expect(svg).toContain('>Launch</text>')
    expect(svg).toContain('>Target Hit</text>')
    const horizontal = renderMermaidSVG(source.replace('xychart', 'xychart horizontal'), { embedFontImport: false })
    expect(horizontal).toContain('data-label-position="right"')
    expect(renderMermaidASCII(source)).toContain('Launch')
  })

  test('Pie highlightSlice is a static cross-format emphasis semantic', () => {
    const source = `---
config:
  pie:
    highlightSlice: Cats
---
pie
  "Dogs" : 3
  "Cats" : 2`
    const svg = renderMermaidSVG(source, { embedFontImport: false })
    expect(svg).toContain('class="pie-slice highlighted"')
    expect(svg).toContain('data-highlighted="true"')
    expect(renderMermaidASCII(source)).toMatch(/>\s*Cats/)
  })

  test('State retains choice, note, and terminal semantics from official syntax', () => {
    const source = `stateDiagram-v2\n  [*] --> Choice\n  state Choice <<choice>>\n  Choice --> [*]\n  note right of Choice : decide`
    const svg = renderMermaidSVG(source, { embedFontImport: false })
    expect(svg).toContain('state-choice')
    expect(svg).toContain('state-note')
    expect(renderMermaidASCII(source)).toContain('decide')
  })

  test('Timeline retains rail, period, section, event, and terminal chronology semantics', () => {
    const source = `timeline\n  title Launch\n  section Build\n  2026 : Beta : General availability`
    const svg = renderMermaidSVG(source, { embedFontImport: false })
    expect(svg).toContain('timeline-rail')
    expect(svg).toContain('timeline-event')
    expect(renderMermaidASCII(source)).toContain('Beta')
    expect(renderMermaidASCII(source)).toContain('General availability')
  })

  test('Journey retains baseline, task, score, actor, and terminal projection semantics', () => {
    const source = `journey\n  title Adoption\n  section Discover\n  Try product: 4: User`
    const svg = renderMermaidSVG(source, { embedFontImport: false })
    expect(svg).toContain('journey-baseline')
    expect(svg).toContain('journey-task')
    expect(renderMermaidASCII(source)).toContain('scores:')
    expect(renderMermaidASCII(source)).toContain('Try product')
  })

  test('Architecture resolves bounded local icons and makes unknown-pack fallback explicit', () => {
    const svg = renderMermaidSVG(`architecture-beta
  service known(mdi:database)[Database]
  service unknown(custom:rocket)[Rocket]
  known:R --> L:unknown`, { embedFontImport: false })
    expect(svg).toContain('data-icon="mdi:database" data-icon-source="@iconify-json/mdi@1.2.3"')
    expect(svg).toContain('data-icon="custom:rocket"')
    expect(svg).toContain('architecture-icon-fallback')
    expect(svg).not.toContain('<image')
    expect(svg).not.toContain('data-image-src')
  })

  test('Quadrant dense-label leaders are pairwise non-crossing by construction', () => {
    const source = ['quadrantChart', '  quadrant-1 Invest', '  quadrant-2 Explore', '  quadrant-3 Avoid', '  quadrant-4 Maintain',
      ...Array.from({ length: 22 }, (_, index) => `  Point ${index}: [${0.48 + (index % 3) * 0.01}, ${0.48 + (index % 4) * 0.008}]`),
    ].join('\n')
    const layout = layoutQuadrantChart(parseQuadrantChart(toMermaidLines(source)))
    const leaders = layout.points.flatMap(point => point.leader ? [point.leader] : [])
    expect(leaders.length).toBeGreaterThan(2)
    const pointDistance = (x: number, y: number, line: typeof leaders[number]) => {
      const dx = line.x2 - line.x1, dy = line.y2 - line.y1
      const t = Math.max(0, Math.min(1, ((x - line.x1) * dx + (y - line.y1) * dy) / (dx * dx + dy * dy || 1)))
      return Math.hypot(x - line.x1 - t * dx, y - line.y1 - t * dy)
    }
    for (let i = 0; i < leaders.length; i++) for (let j = i + 1; j < leaders.length; j++) {
      const a = leaders[i]!, b = leaders[j]!
      if (Math.hypot(a.x1 - b.x1, a.y1 - b.y1) <= 0.5) continue
      expect(Math.min(pointDistance(a.x1, a.y1, b), pointDistance(a.x2, a.y2, b), pointDistance(b.x1, b.y1, a), pointDistance(b.x2, b.y2, a))).toBeGreaterThanOrEqual(3)
    }
    for (const leader of leaders) for (const region of layout.regions.filter(region => region.label)) {
      const labelWidth = measureTextWidth(region.label!, layout.visual.quadrantLabelFontSize ?? 16, 600)
      const box = { x0: region.labelX - labelWidth / 2 - 4, x1: region.labelX + labelWidth / 2 + 4, y0: region.labelY - 18, y1: region.labelY + 4 }
      const samples = Array.from({ length: 21 }, (_, index) => ({ x: leader.x1 + (leader.x2 - leader.x1) * index / 20, y: leader.y1 + (leader.y2 - leader.y1) * index / 20 }))
      expect(samples.some(point => point.x >= box.x0 && point.x <= box.x1 && point.y >= box.y0 && point.y <= box.y1)).toBe(false)
    }
  })

  test('Gantt exposes safe href metadata while callbacks and unsafe schemes remain inert', () => {
    const source = `gantt
  dateFormat YYYY-MM-DD
  section Work
  Safe :safe, 2026-01-01, 2d
  Callback :call, after safe, 1d
  Unsafe :unsafe, after call, 1d
  click safe href "https://example.com/task"
  click call call alert()
  click unsafe href "javascript:alert(1)"`
    const svg = renderMermaidSVG(source, { embedFontImport: false })
    expect(svg).toContain('data-task="safe" data-href="https://example.com/task"')
    expect(svg).not.toMatch(/data-task="safe"[^>]+(?:role="link"|tabindex=)/)
    expect(svg).not.toContain('javascript:')
    expect(svg).not.toContain('alert()')
    expect(svg).not.toContain('data-href="call')

    const validAxis = parseMermaid(`---\nconfig:\n  gantt:\n    axisFormat: "%Y"\n---\n${source}`)
    expect(validAxis.ok).toBe(true)
    if (validAxis.ok) expect(verifyMermaid(validAxis.value).warnings).not.toContainEqual(expect.objectContaining({ field: 'gantt.axisFormat' }))
    const noops = parseMermaid(`%%{init: {"gantt":{"weekday":"monday","todayMarker":"stroke:red"}}}%%\n${source}`)
    expect(noops.ok).toBe(true)
    if (noops.ok) expect(verifyMermaid(noops.value).warnings).toEqual(expect.arrayContaining([
      expect.objectContaining({ field: 'gantt.weekday' }), expect.objectContaining({ field: 'gantt.todayMarker' }),
    ]))
    expect(explicitFamilyConfigDiagnostics('gantt', { gantt: { weekday: 'monday' } })).toContainEqual(expect.objectContaining({ field: 'gantt.weekday' }))
    expect(explicitFamilyConfigDiagnostics('gantt', { gantt: { axisFormat: '' } })).toEqual([expect.objectContaining({ field: 'gantt.axisFormat' })])
    expect(explicitFamilyConfigDiagnostics('gantt', { gantt: { tickInterval: '2week' } })).toEqual([])
    expect(explicitFamilyConfigDiagnostics('gantt', { gantt: { tickInterval: '2weeks' } })).toEqual([expect.objectContaining({ field: 'gantt.tickInterval', message: expect.stringContaining('"2week"') })])
  })

  test('GitGraph gives branches distinct deterministic colors and honors documented theme variables', () => {
    const source = `---
themeVariables:
  git0: "#ff0000"
  git1: "#00aa00"
  gitBranchLabel0: "#ffffff"
  gitInv1: "#000000"
  commitLabelColor: "#123456"
  commitLabelBackground: "#eeeeee"
  commitLabelFontSize: "16px"
---
gitGraph
  commit id:"base"
  branch feature
  commit id:"work" type:HIGHLIGHT`
    const svg = renderMermaidSVG(source, { embedFontImport: false })
    expect(svg).toContain('stroke="#ff0000"')
    expect(svg).toContain('stroke="#00aa00"')
    expect(svg).toContain('fill="#123456"')
    expect(svg).toContain('fill="#eeeeee"')
    expect(svg).toContain('font-size="16"')

    const hugeFont = 80
    const positioned = layoutGitGraph(parseGitGraph(`gitGraph LR\n  commit id:"wide" tag:"Unicode-界"`), { commitLabelFontSize: hugeFont })
    for (const commit of positioned.commits) {
      const label = commit.message || commit.id
      const labelWidth = measureTextWidth(label, hugeFont, 500)
      const origin = { x: commit.x, y: commit.y + 24 }
      const radians = Math.PI / 4
      const corners = [[-labelWidth / 2, -hugeFont], [labelWidth / 2, -hugeFont], [-labelWidth / 2, hugeFont * 0.28], [labelWidth / 2, hugeFont * 0.28]]
        .map(([x, y]) => ({ x: origin.x + x! * Math.cos(radians) - y! * Math.sin(radians), y: origin.y + x! * Math.sin(radians) + y! * Math.cos(radians) }))
      expect(Math.min(...corners.map(point => point.x))).toBeGreaterThanOrEqual(0)
      expect(Math.min(...corners.map(point => point.y))).toBeGreaterThanOrEqual(0)
      expect(Math.max(...corners.map(point => point.x))).toBeLessThanOrEqual(positioned.width)
      expect(Math.max(...corners.map(point => point.y))).toBeLessThanOrEqual(positioned.height)
    }
  })

  test('every registered family satisfies the Closing The Gap render contract', () => {
    for (const family of BUILTIN_FAMILY_METADATA) {
      const parsed = parseMermaid(family.example)
      expect(parsed.ok, family.id).toBe(true)
      expect(renderMermaidSVG(family.example, { embedFontImport: false }), family.id).toContain('<svg')
      expect(renderMermaidASCII(family.example), family.id).not.toBe('')
    }
  })
})
