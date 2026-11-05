import { expect, test } from 'bun:test'
import { parseRegisteredMermaid, serializeMermaid, mutate, layoutMermaid, verifyMermaid } from '../agent/core.ts'
import { renderMermaidSVG } from '../index.ts'
import { renderMermaidASCIIWithReceipt } from '../ascii/index.ts'
import { terminalDocumentOf } from '../ascii/terminal-document.ts'
import { parseSwimlane } from '../swimlane/parser.ts'
import { layoutSwimlane, swimlanePartitions } from '../swimlane/layout.ts'

const source = `swimlane-beta LR
subgraph Customer[Customer 👩‍💻]
  A[Browse]
  B{Pay}
end
subgraph Warehouse
  subgraph Dispatch
    C[Pick]
    D[Ship]
  end
end
A --> B
B handoff@-->|paid| C
C --> D
D -.-> B`

test('native Swimlane edits retain family, nested membership, shapes and cross-lane edge identities', () => {
  const parsed = parseRegisteredMermaid(source)
  expect(parsed.ok).toBe(true)
  if (!parsed.ok || parsed.value.body.kind !== 'swimlane') throw new Error('expected native Swimlane')
  const edited = mutate(parsed.value, { kind: 'set_label', target: 'B', label: 'Paid?' })
  expect(edited.ok).toBe(true)
  if (!edited.ok) throw new Error(edited.error.message)
  const serialized = serializeMermaid(edited.value)
  expect(serialized).toStartWith('swimlane-beta LR')
  const reparsed = parseRegisteredMermaid(serialized)
  if (!reparsed.ok || reparsed.value.body.kind !== 'swimlane') throw new Error('expected native edited Swimlane')
  const graph = reparsed.value.body.graph
  expect(graph.nodes.get('B')).toMatchObject({ label: 'Paid?', shape: 'diamond' })
  expect(graph.edges[1]).toMatchObject({ id: 'handoff', source: 'B', target: 'C', label: 'paid' })
  expect(graph.subgraphs[1]?.children[0]).toMatchObject({ id: 'Dispatch', nodeIds: ['C', 'D'] })
})

test.each(['LR', 'RL', 'TD', 'BT'] as const)('Swimlane %s retains equal bands, owned cards and connected terminal handoffs', direction => {
  const input = source.replace('LR', direction)
  const pixel = layoutSwimlane(parseSwimlane(input))
  expect(pixel.groups.map(group => group.id)).toEqual(['Customer', 'Warehouse'])
  const axis = direction === 'LR' || direction === 'RL' ? 'width' : 'height'
  expect(pixel.groups[0]![axis]).toBe(pixel.groups[1]![axis])
  expect(pixel.edges[1]).toMatchObject({ id: 'handoff', source: 'B', target: 'C' })
  expect(pixel.groups[1]?.children[0]).toMatchObject({ id: 'Dispatch', nodeIds: ['C', 'D'] })
  expect(pixel).toEqual(layoutSwimlane(parseSwimlane(input)))
  const parsed = parseRegisteredMermaid(input)
  if (!parsed.ok) throw new Error('expected native Swimlane')
  const layout = layoutMermaid(parsed.value, { regions: true })
  expect(layout.nodes.map(node => [node.id, node.parentId]).sort()).toEqual([
    ['A', 'Customer'], ['B', 'Customer'], ['C', 'Dispatch'], ['D', 'Dispatch'],
  ])
  expect(layout.groups.find(group => group.id === 'Dispatch')).toMatchObject({ parentId: 'Warehouse', members: ['C', 'D'] })
  expect(layout.regions?.find(region => region.id === 'node:C')).toMatchObject({ parentId: 'group:Dispatch' })
  const svg = renderMermaidSVG(input)
  expect(svg).toContain('data-id="handoff"')
  expect(svg).toContain('data-parent-id="Warehouse"')
  expect(svg.match(/<g\b(?=[^>]*data-id="Dispatch")[^>]*>/)?.[0]).toContain('data-parent-id="Warehouse"')
  const terminal = renderMermaidASCIIWithReceipt(input, { colorMode: 'none', layoutSafety: 'strict' })
  expect(terminal.receipt.layoutCertification?.status).toBe('passed')
  const regions = terminalDocumentOf(terminal)!.regions()
  expect(regions.find(region => region.id === 'handoff')).toMatchObject({ from: 'B', to: 'C', projectedText: 'paid' })
  expect(regions.find(region => region.id === 'C')).toMatchObject({ parentId: 'Dispatch', kind: 'node', projectedText: 'Pick' })
  expect(regions.find(region => region.id === 'Dispatch')).toMatchObject({ parentId: 'Warehouse', kind: 'subgraph' })
  const first = regions.find(region => region.id === 'Customer')!, second = regions.find(region => region.id === 'Warehouse')!
  expect(axis === 'width' ? first.canvasColEnd - first.canvasColStart : first.rowSpan).toBe(axis === 'width' ? second.canvasColEnd - second.canvasColStart : second.rowSpan)
})

test('implicit lane identities cannot collide with authored nodes and unsupported source is preserved', () => {
  const graph = parseSwimlane('swimlane-beta TD\n__swimlane_default__[Loose]\nsubgraph Team\nA[Owned]\nend\nA --> __swimlane_default__')
  expect(swimlanePartitions(graph).map(lane => lane.id)).toEqual(['Team', '__swimlane_default___'])
  const unsafe = 'swimlane-beta LR\nA --> B\nclick A callback'
  const parsed = parseRegisteredMermaid(unsafe)
  expect(parsed.ok).toBe(true)
  if (!parsed.ok) throw new Error('expected preserved source')
  expect(parsed.value.body).toMatchObject({ kind: 'opaque', family: 'swimlane' })
  expect(serializeMermaid(parsed.value).trimEnd()).toBe(unsafe)
})

test('the bare upstream graph keyword keeps its established Flowchart identity', () => {
  const legacy = parseRegisteredMermaid('swimlane LR;A-->B;')
  expect(legacy.ok && legacy.value.body.kind).toBe('flowchart')
  expect(renderMermaidSVG('swimlane LR;A-->B;')).toContain('A')
  const native = parseRegisteredMermaid('swimlane-beta LR;A-->B;')
  expect(native.ok && native.value.body.kind).toBe('swimlane')
})

test('independent lane hand-offs keep separate short routes instead of an unlabelled shared bus', () => {
  const input = ['swimlane-beta LR', ...Array.from({ length: 3 }, (_, lane) => [`subgraph L${lane}[Team ${lane}]`, ...Array.from({ length: 6 }, (_, item) => `n${lane}_${item}[Task ${lane}.${item}]`), 'end']), ...Array.from({ length: 6 }, (_, item) => [`n0_${item} --> n1_${item}`, `n1_${item} --> n2_${item}`])].flat().join('\n')
  const chart = layoutSwimlane(parseSwimlane(input)), firstLane = chart.nodes.filter(node => node.id.startsWith('n0_'))
  expect(new Set(firstLane.map(node => node.x)).size).toBe(6)
  expect(new Set(firstLane.map(node => node.y)).size).toBe(1)
  const segments = chart.edges.flatMap(edge => edge.points.slice(1).map((b, index) => ({ edge: edge.edgeIndex, a: edge.points[index]!, b })))
  for (let i = 0; i < segments.length; i++) for (let j = i + 1; j < segments.length; j++) {
    const a = segments[i]!, b = segments[j]!
    if (a.edge === b.edge) continue
    const sameVerticalTrack = a.a.x === a.b.x && b.a.x === b.b.x && a.a.x === b.a.x
    const sameHorizontalTrack = a.a.y === a.b.y && b.a.y === b.b.y && a.a.y === b.a.y
    const overlap = sameVerticalTrack ? Math.min(Math.max(a.a.y, a.b.y), Math.max(b.a.y, b.b.y)) - Math.max(Math.min(a.a.y, a.b.y), Math.min(b.a.y, b.b.y)) : sameHorizontalTrack ? Math.min(Math.max(a.a.x, a.b.x), Math.max(b.a.x, b.b.x)) - Math.max(Math.min(a.a.x, a.b.x), Math.min(b.a.x, b.b.x)) : 0
    expect(overlap).toBeLessThanOrEqual(0)
  }
  for (const edge of chart.edges) {
    const from = chart.nodes.find(node => node.id === edge.source)!, to = chart.nodes.find(node => node.id === edge.target)!
    expect(edge.points[0]?.y).toBe(from.y + from.height)
    expect(edge.points.at(-1)?.y).toBe(to.y)
  }
})

test.each(['LR', 'RL', 'TD', 'BT'] as const)('parallel and reciprocal Swimlane %s hand-offs keep separate owned labels and contacts', direction => {
  const input = `swimlane-beta ${direction}
subgraph L[Requests]
  subgraph Detail[Request handling]
    A[Submit]
  end
end
subgraph R[Operations]
  B[Review]
end
A approve@-->|approve| B
A reject@-->|reject| B
B return@-->|reconsider| A`
  const parsed = parseRegisteredMermaid(input)
  if (!parsed.ok) throw new Error('expected native Swimlane')
  const chart = layoutSwimlane(parseSwimlane(input))
  expect(chart.edges.map(edge => [edge.id, edge.source, edge.target, edge.label])).toEqual([
    ['approve', 'A', 'B', 'approve'], ['reject', 'A', 'B', 'reject'], ['return', 'B', 'A', 'reconsider'],
  ])
  expect(new Set(chart.edges.map(edge => JSON.stringify(edge.points))).size).toBe(3)
  for (const edge of chart.edges) for (const [id, point] of [[edge.source, edge.points[0]!], [edge.target, edge.points.at(-1)!]] as const) {
    const node = chart.nodes.find(node => node.id === id)!
    expect(point.x).toBeGreaterThanOrEqual(node.x - 1e-6)
    expect(point.x).toBeLessThanOrEqual(node.x + node.width + 1e-6)
    expect(point.y).toBeGreaterThanOrEqual(node.y - 1e-6)
    expect(point.y).toBeLessThanOrEqual(node.y + node.height + 1e-6)
    expect(Math.min(Math.abs(point.x - node.x), Math.abs(point.x - node.x - node.width), Math.abs(point.y - node.y), Math.abs(point.y - node.y - node.height))).toBeLessThan(1e-6)
  }
  const layout = layoutMermaid(parsed.value, { regions: true })
  expect(layout.nodes.find(node => node.id === 'A')?.parentId).toBe('Detail')
  for (let i = 0; i < layout.edges.length; i++) for (let j = i + 1; j < layout.edges.length; j++) {
    const a = layout.edges[i]!.label!.bounds!, b = layout.edges[j]!.label!.bounds!
    expect(a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y).toBe(true)
  }
  expect(verifyMermaid(parsed.value).warnings.filter(warning => warning.code === 'RENDER_FAILED' || warning.code === 'ROUTE_LABEL_ON_SHARED_TRUNK')).toEqual([])
  expect(renderMermaidSVG(input, { layoutSafety: 'strict' })).toContain('reconsider')
  expect(renderMermaidSVG(input, { style: ['hand-drawn', 'dracula'] })).toContain('reconsider')
  expect(renderMermaidASCIIWithReceipt(input, { colorMode: 'none', layoutSafety: 'strict' }).receipt.layoutCertification?.status).toBe('passed')
})

test.each(['LR', 'RL', 'TD', 'BT'] as const)('Swimlane %s occurrence channels retain group endpoints, shaped contacts and long captions at zero padding', direction => {
  for (const groupEndpoint of [true, false]) {
    const endpoint = groupEndpoint ? 'Detail' : 'A'
    const input = `swimlane-beta ${direction}
subgraph L[Requests]
  subgraph Detail[Request handling]
    A${groupEndpoint ? '[Submit]' : '{Submit?}'}
  end
end
subgraph R[Operations]
  B((Review))
end
${endpoint} approval@-->|request approval with a detailed justification| B
B return@-->|please reconsider the rejected submission| ${endpoint}`
    const parsed = parseRegisteredMermaid(input)
    if (!parsed.ok) throw new Error('expected native Swimlane')
    const layout = layoutMermaid(parsed.value, { padding: 0, regions: true })
    expect(layout.edges.map(edge => [edge.from, edge.to, edge.label?.text])).toEqual([
      [endpoint, 'B', 'request approval with a detailed justification'],
      ['B', endpoint, 'please reconsider the rejected submission'],
    ])
    for (const edge of layout.edges) {
      const bounds = edge.label!.bounds!
      expect(bounds.x).toBeGreaterThanOrEqual(0)
      expect(bounds.y).toBeGreaterThanOrEqual(0)
      expect(bounds.x + bounds.w).toBeLessThanOrEqual(layout.bounds.w)
      expect(bounds.y + bounds.h).toBeLessThanOrEqual(layout.bounds.h)
      const [x, y] = edge.from === 'B' ? edge.path[0]! : edge.path.at(-1)!
      const circle = layout.nodes.find(node => node.id === 'B')!
      expect(((x - circle.x - circle.w / 2) / (circle.w / 2)) ** 2 + ((y - circle.y - circle.h / 2) / (circle.h / 2)) ** 2).toBeCloseTo(1, 6)
    }
    expect(layout.groups.find(group => group.id === 'Detail')).toMatchObject({ parentId: 'L', members: ['A'] })
    expect(renderMermaidSVG(input, { padding: 0, layoutSafety: 'strict' })).toContain('data-id="approval"')
  }
})

test('unrelated Swimlane occurrence pairs cannot reuse the same outside caption channel', () => {
  const input = `swimlane-beta TD
subgraph Requests
  A[First request]
  C[Second request]
end
subgraph Operations
  B[First review]
  D[Second review]
end
A -->|approve| B
A -->|reject| B
B -->|reconsider| A
C -->|approve| D
D -->|reconsider| C`
  const parsed = parseRegisteredMermaid(input)
  if (!parsed.ok) throw new Error('expected native Swimlane')
  const layout = layoutMermaid(parsed.value)
  expect(layout.edges.map(edge => [edge.from, edge.to])).toEqual([['A', 'B'], ['A', 'B'], ['B', 'A'], ['C', 'D'], ['D', 'C']])
  for (let i = 0; i < layout.edges.length; i++) for (let j = i + 1; j < layout.edges.length; j++) {
    const a = layout.edges[i]!.label!.bounds!, b = layout.edges[j]!.label!.bounds!
    expect(a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y).toBe(true)
  }
  expect(renderMermaidSVG(input, { layoutSafety: 'strict' })).toContain('Second request')
})

test.each(['LR', 'RL', 'TD', 'BT'] as const)('Swimlane %s keeps titled same-lane and nested reciprocal channels below the complete title band', direction => {
  const title = 'A long authored diagram title spanning the workflow'
  const bodies = [
    `subgraph Team\nA[One]\nB[Two]\nend\nA -->|approve| B\nA -->|reject| B\nB -->|return| A`,
    `subgraph Team\nsubgraph Detail[Request handling]\nA[One]\nend\nend\nsubgraph Reviewers\nB[Two]\nend\nDetail -->|approve| B\nDetail -->|reject| B\nB -->|return| Detail`,
  ]
  for (const body of bodies) for (const padding of [0, 40]) {
    const input = `---\ntitle: ${title}\n---\nswimlane-beta ${direction}\n${body}`
    const parsed = parseRegisteredMermaid(input)
    if (!parsed.ok) throw new Error('expected native titled Swimlane')
    const layout = layoutMermaid(parsed.value, { padding, debug: true })
    expect(layout.edges.map(edge => edge.label?.text)).toEqual(['approve', 'reject', 'return'])
    expect(layout.paintCertification?.status).toBe('passed')
    expect(renderMermaidSVG(input, { padding, layoutSafety: 'strict' })).toContain(title)
    expect(renderMermaidSVG(input, { padding, style: ['hand-drawn', 'dracula'] })).toContain(title)
  }
})

test.each(['LR', 'RL', 'TD', 'BT'] as const)('Swimlane %s single and repeated self-loops retain separate shape contacts and titled captions', direction => {
  for (const [shape, declaration] of [['rectangle', '[Review]'], ['diamond', '{Review?}'], ['circle', '((Review))']] as const) for (const titled of [false, true]) for (const repeated of [false, true]) {
    const title = 'Review choices remain visible beside their complete workflow title'
    const input = `${titled ? `---\ntitle: ${title}\n---\n` : ''}swimlane-beta ${direction}
subgraph Team
  A${declaration}
end
A retry@-->|retry| A${repeated ? '\nA revise@-->|revise| A' : ''}`
    const parsed = parseRegisteredMermaid(input)
    if (!parsed.ok) throw new Error('expected native Swimlane')
    const layout = layoutMermaid(parsed.value, { debug: true, regions: true })
    expect(layout.edges.map(edge => [edge.id, edge.from, edge.to, edge.label?.text])).toEqual(repeated ? [
      ['retry', 'A', 'A', 'retry'], ['revise', 'A', 'A', 'revise'],
    ] : [['retry', 'A', 'A', 'retry']])
    expect(new Set(layout.edges.map(edge => JSON.stringify(edge.path))).size).toBe(repeated ? 2 : 1)
    const node = layout.nodes.find(node => node.id === 'A')!
    expect(node.parentId).toBe('Team')
    const contacts = layout.edges.flatMap(edge => [edge.path[0]!, edge.path.at(-1)!])
    expect(new Set(contacts.map(point => JSON.stringify(point))).size).toBe(repeated ? 4 : 2)
    for (const [x, y] of contacts) {
      const dx = Math.abs((x - node.x - node.w / 2) / (node.w / 2)), dy = Math.abs((y - node.y - node.h / 2) / (node.h / 2))
      expect(shape === 'circle' ? dx ** 2 + dy ** 2 : shape === 'diamond' ? dx + dy : Math.max(dx, dy)).toBeCloseTo(1, 6)
    }
    if (repeated) {
      const a = layout.edges[0]!.label!.bounds!, b = layout.edges[1]!.label!.bounds!
      expect(a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y).toBe(true)
    }
    expect(layout.paintCertification?.status).toBe('passed')
    expect(renderMermaidSVG(input, { layoutSafety: 'strict' })).toContain('data-id="retry"')
    expect(renderMermaidSVG(input, { style: ['hand-drawn', 'dracula'] })).toContain('data-id="retry"')
  }
})


test.each(['LR', 'RL', 'TD', 'BT'] as const)('Swimlane %s ordinary captions stay clear of nested self-loop caption paint', direction => {
  for (const declaration of ['[Review]', '{Review?}', '((Review))']) {
    const input = `---
title: Authored workflow with repeated decisions
---
swimlane-beta ${direction}
subgraph Team
  subgraph Inner
    A${declaration}
  end
  B[Continue]
end
subgraph Other
  C[Complete]
end
A next@-->|next| B
B complete@-->|complete| C
A retry@-->|retry| A
A revise@-->|revise| A
A reconsider@-->|reconsider| A`
    const parsed = parseRegisteredMermaid(input)
    if (!parsed.ok) throw new Error('expected native Swimlane')
    const layout = layoutMermaid(parsed.value, { debug: true, regions: true })
    expect(layout.edges.map(edge => [edge.id, edge.label?.text])).toEqual([
      ['next', 'next'], ['complete', 'complete'], ['retry', 'retry'], ['revise', 'revise'], ['reconsider', 'reconsider'],
    ])
    expect(layout.nodes.find(node => node.id === 'A')?.parentId).toBe('Inner')
    expect(layout.paintCertification?.status).toBe('passed')
    expect(renderMermaidSVG(input, { layoutSafety: 'strict' })).toContain('data-id="complete"')
    expect(renderMermaidSVG(input, { style: ['hand-drawn', 'dracula'] })).toContain('data-id="next"')
  }
})
