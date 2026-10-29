// Readable relationship ends in Flowchart layout (#566).
//
// Each case is laid out exactly as the renderer lays it out (default style and
// the report's publication styling) and checked against painted geometry the
// renderer owns: its marker regions and its rounded path projection.
//
// - Two relationships that paint differently, or that both carry a caption,
//   keep separate arrowheads at their shared target.
// - The painted terminal shaft is straight under the whole arrowhead, so a
//   marker never hangs off a rounded or square corner.
// - A caption's opaque halo leaves visible line between itself and the nodes
//   it connects, and never covers its own arrowhead.
// - A fan-out from one source to two leaf peers on one rank emits at mirrored
//   offsets and seats both captions level, whatever their lengths.

import { describe, expect, test } from 'bun:test'
import { renderMermaidSVG } from '../index.ts'
import { parseMermaid } from '../parser.ts'
import { layoutGraphSync } from '../layout-engine.ts'
import { resolveRenderRequest } from '../render-contract.ts'
import { resolveRenderStyle } from '../styles.ts'
import { graphEdgeMarkerPaintRegions, graphEdgePathProjection } from '../graph-connectors.ts'
import { terminalHookLength } from '../layout/route-geometry.ts'
import { labelHaloExtension, labelRect } from '../shared/edge-label-geometry.ts'
import type { Point, PositionedEdge, PositionedGraph, PositionedNode } from '../types.ts'

const LINEAGE = `flowchart TD
  subgraph MermaidFamily[Mermaid lineage]
    Mermaid[Mermaid.js]
    Beautiful[Beautiful Mermaid]
    Dart[Mermaid Dart]
    Agentic[Agentic Mermaid]
    Zombie[Zombie Mermaid]
    ASCII[Mermaid ASCII]
    Mermaid -->|derivative| Beautiful
    Mermaid -->|Dart port| Dart
    Beautiful -->|fork| Agentic
    Beautiful -->|fork| Zombie
    ASCII -.->|ASCII component port| Beautiful
  end
  subgraph OtherEngines[Other implementation lineages]
    Pele[Pele]
    Ondine[Ondine]
    Bezel[Bezel]
    Franken[Frankenmermaid]
    Pele -->|Rust port| Ondine
    Pele -->|port| Bezel
  end`

// #584 pins the later drawing, where Dart and Flutter are separate nodes.
const REVISED_LINEAGE = LINEAGE
  .replace('    Dart[Mermaid Dart]', '    Dart[Mermaid Dart]\n    Flutter[Mermaid Flutter]')
  .replace('    Beautiful -->|fork| Agentic', '    Dart -->|native Flutter renderer| Flutter\n    Beautiful -->|fork| Agentic')

const CASES: Array<{ name: string; source: string }> = [
  { name: 'the reported lineage', source: LINEAGE },
  { name: 'fan-in of a solid and a dotted caption', source: 'flowchart TD\nMermaid[Mermaid.js] -->|derivative| Beautiful[Beautiful Mermaid]\nASCII[Mermaid ASCII] -.->|ASCII component port| Beautiful' },
  { name: 'fan-in of two captions beside a straight entry', source: 'flowchart LR\n  D{MFA enabled?} -- No --> G[Create session]\n  D -- Yes --> E[Enter code]\n  E --> F{Code valid?}\n  F -- Yes --> G' },
  { name: 'fan-out with long and short captions', source: 'flowchart TD\n  P[Pele] -->|Rust port| O[Ondine]\n  P -->|port| B[Bezel]' },
  { name: 'grouped fan-out with long and short captions', source: 'flowchart TD\n  subgraph G[Group]\n  P[Pele] -->|Rust port| O[Ondine]\n  P -->|port| B[Bezel]\n  end' },
  { name: 'fan-out with short captions', source: 'flowchart TD\n  A -->|yes| B\n  A -->|no| C' },
  ...(['TD', 'BT'] as const).map(direction => ({ name: `grouped fan-out with two wide captions (${direction})`, source: `flowchart ${direction}\nsubgraph G[Group]\nA -->|A very long alpha caption| B\nA -->|A very long beta caption| C\nend` })),
  ...(['LR', 'RL'] as const).flatMap(direction => [false, true].map(grouped => ({
    name: `thick and dotted fan-in (${direction}, ${grouped ? 'grouped' : 'root'})`,
    source: `flowchart ${direction}\n${grouped ? 'subgraph G[Group]\n' : ''}A[Source] ==> C[Target]\nB[Other source] -.-> C${grouped ? '\nend' : ''}`,
  }))),
]

const PUBLICATION = {
  style: ['publication-figure', 'nord-light', {
    font: 'Inter',
    roles: {
      node: { fontSize: 18, fontWeight: 600, fillColor: '#fffdf8', borderColor: '#7891a6', textColor: '#233448' },
      edge: { fontSize: 14, strokeColor: '#5e81ac', textColor: '#456079' },
      group: { fontSize: 15, fontWeight: 700, borderColor: '#a3b4c3' },
    },
  }],
}

const STYLES: Array<{ name: string; options: Record<string, unknown> }> = [
  { name: 'default', options: {} },
  { name: 'publication', options: PUBLICATION },
]

type Box = { x0: number; y0: number; x1: number; y1: number }

function laidOut(source: string, options: Record<string, unknown>) {
  const styleFace = resolveRenderRequest(source, options, 'svg').appearance.face
  const graph = parseMermaid(source)
  const positioned = layoutGraphSync(graph, { ...options, styleFace })
  return { positioned, horizontal: graph.direction === 'LR' || graph.direction === 'RL', style: resolveRenderStyle(options, undefined, styleFace) }
}

function nodeBox(node: PositionedNode): Box {
  return { x0: node.x, y0: node.y, x1: node.x + node.width, y1: node.y + node.height }
}

function gap(a: Box, b: Box): number {
  const dx = Math.max(a.x0 - b.x1, b.x0 - a.x1), dy = Math.max(a.y0 - b.y1, b.y0 - a.y1)
  return dx < 0 && dy < 0 ? Math.max(dx, dy) : Math.hypot(Math.max(dx, 0), Math.max(dy, 0))
}

function overlaps(a: Box, b: Box): boolean {
  return a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1
}

function endMarker(edge: PositionedEdge, style: ReturnType<typeof resolveRenderStyle>): Box {
  const box = graphEdgeMarkerPaintRegions(edge, style).find(region => region.position === 'end')?.bounds
  if (!box) throw new Error(`${edge.source}->${edge.target} paints no end marker`)
  return box
}

/** The straight final piece of the path the renderer paints. */
function paintedTerminalRun(edge: PositionedEdge, style: ReturnType<typeof resolveRenderStyle>): [Point, Point] {
  const d = graphEdgePathProjection(edge, style)?.geometry.d
  if (!d) return [edge.points.at(-2)!, edge.points.at(-1)!]
  const ends = [...d.matchAll(/[MLQ]([^MLQ]*)/g)].map(match => {
    const values = match[1]!.trim().split(/[\s,]+/).map(Number)
    return { x: values.at(-2)!, y: values.at(-1)! }
  })
  expect(d.trimEnd()).toMatch(/L[^MLQ]*$/)
  return [ends.at(-2)!, ends.at(-1)!]
}

function expectReadableEnds(positioned: PositionedGraph, horizontal: boolean, style: ReturnType<typeof resolveRenderStyle>): void {
  const nodes = new Map(positioned.nodes.map(node => [node.id, node]))
  const visible = positioned.edges.filter(edge => edge.style !== 'invisible' && edge.hasArrowEnd)

  for (let i = 0; i < visible.length; i++) for (let j = i + 1; j < visible.length; j++) {
    const a = visible[i]!, b = visible[j]!
    if (a.target !== b.target || a.source === b.source) continue
    if (a.style === b.style && !(a.label && b.label)) continue
    expect(overlaps(endMarker(a, style), endMarker(b, style)), `${a.source} and ${b.source} share an arrowhead into ${a.target}`).toBe(false)
  }

  for (const edge of visible) {
    const [from, to] = paintedTerminalRun(edge, style)
    const marker = endMarker(edge, style)
    const vertical = Math.abs(from.x - to.x) < 0.01
    const sign = Math.sign(vertical ? to.y - from.y : to.x - from.x)
    const back = vertical ? (sign > 0 ? marker.y0 : marker.y1) : (sign > 0 ? marker.x0 : marker.x1)
    // Stroke beyond the endpoint is not part of the shaft behind the marker.
    const visibleShaft = (back - (vertical ? from.y : from.x)) * sign
    expect(visibleShaft, `${edge.source}->${edge.target} arrowhead overhangs its straight shaft`).toBeGreaterThan(1)
    if (style.edgeBendRadius > 0 || style.lineWidth > 1 || edge.style === 'thick') {
      expect(visibleShaft, 'painted marker leaves 4px of visible straight shaft').toBeGreaterThanOrEqual(3.9998)
    }
  }

  for (const edge of positioned.edges) {
    const pill = labelRect(edge, style)
    if (!pill) continue
    const halo = labelHaloExtension(edge, style.lineWidth)
    const painted = { x0: pill.x - halo, y0: pill.y - halo, x1: pill.x + pill.w + halo, y1: pill.y + pill.h + halo }
    for (const id of [edge.source, edge.target]) {
      expect(gap(painted, nodeBox(nodes.get(id)!)), `"${edge.label}" crowds ${id}`).toBeGreaterThanOrEqual(6)
    }
    for (const group of positioned.groups) {
      if (!group.nodeIds?.includes(edge.source) || !group.nodeIds.includes(edge.target)) continue
      expect(painted.x0, 'caption halo clears its group border').toBeGreaterThan(group.x)
      expect(painted.x1).toBeLessThan(group.x + group.width)
      expect(painted.y0).toBeGreaterThan(group.y)
      expect(painted.y1).toBeLessThan(group.y + group.height)
    }
    if (edge.hasArrowEnd) expect(overlaps(painted, endMarker(edge, style)), `"${edge.label}" covers its arrowhead`).toBe(false)
  }

  const cross = horizontal ? 'y' : 'x', main = horizontal ? 'x' : 'y'
  for (const source of positioned.nodes) {
    const fan = positioned.edges.filter(edge => edge.source === source.id)
    if (fan.length !== 2 || !fan.every(edge => edge.label && edge.labelPosition)) continue
    const leaves = fan.map(edge => nodes.get(edge.target)!)
    if (leaves.some(leaf => positioned.edges.some(edge => (edge.source === leaf.id || edge.target === leaf.id) && !fan.includes(edge)))) continue
    if (Math.abs(leaves[0]![main] - leaves[1]![main]) > 0.5) continue
    const centre = source[cross] + (horizontal ? source.height : source.width) / 2
    const [first, second] = fan
    expect(Math.abs(first!.points[0]![cross] - centre + second!.points[0]![cross] - centre), `${source.id} emits asymmetrically`).toBeLessThanOrEqual(0.5)
    expect(Math.abs(first!.labelPosition![main] - second!.labelPosition![main]), `${source.id} seats its captions unevenly`).toBeLessThanOrEqual(0.5)
  }
}

describe('Flowchart relationship ends stay readable (#566)', () => {
  test('eleven-project lineage leaves straight shaft behind the rounded derivative arrow (#584)', () => {
    const source = REVISED_LINEAGE
    const { positioned, horizontal, style } = laidOut(source, PUBLICATION)
    // Inspect the public SVG too: a 12px raw hook used to become a 6px
    // straight segment after rounding, under an 11.6px stroke-scaled head.
    const svg = renderMermaidSVG(source, PUBLICATION)
    const edge = svg.match(/<path class="edge"[^>]*data-label="derivative"[^>]*>/)?.[0]
    expect(edge).toBeDefined()
    const d = edge!.match(/\bd="([^"]+)"/)![1]!
    expect(d).toContain('Q')
    const terminal = d.match(/Q[^MLQ]*? ([\d.-]+),([\d.-]+) L([\d.-]+),([\d.-]+)$/)
    expect(terminal).not.toBeNull()
    const [, x0, y0, x1, y1] = terminal!.map(Number)
    const length = Math.hypot(x1! - x0!, y1! - y0!)
    const width = Number(edge!.match(/stroke-width="([^"]+)"/)![1])
    const id = edge!.match(/marker-end="url\(#([^)]*)\)"/)![1]!
    const marker = svg.match(new RegExp(`<marker id="${id}"[^>]*>[\\s\\S]*?</marker>`))![0]
    expect(marker).toContain('markerWidth="8"')
    expect(marker).toContain('refX="8"')
    expect(marker).not.toContain('markerUnits="userSpaceOnUse"')
    const markerStroke = Number(marker.match(/stroke-width="([^"]+)"/)![1])
    // Include the round-joined polygon's stroke behind its nominal base.
    expect(length - (8 + markerStroke / 2) * width).toBeGreaterThanOrEqual(3.9998)
    expectReadableEnds(positioned, horizontal, style)
  })

  test.each([
    { name: 'stroke-scaled arrow', thick: false, fixed: false },
    { name: 'thick arrow', thick: true, fixed: false },
    { name: 'fixed-size custom-width arrow', thick: false, fixed: true },
  ])('a reduced rounded hook seats its $name on a straight shaft (#584)', ({ thick, fixed }) => {
    const style = { ...resolveRenderStyle(), lineWidth: 1.45, edgeBendRadius: 8 }
    const edge: PositionedEdge = {
      source: 'A', target: 'B', style: thick ? 'thick' : 'solid',
      hasArrowStart: false, hasArrowEnd: true, points: [],
      ...(fixed ? { inlineStyle: { 'stroke-width': '4px' } } : {}),
    }
    const hook = terminalHookLength(style, edge)
    // A single elbow isolates the old 12px-hook / 6px-rounded-tail failure.
    edge.points = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: hook }]
    const [from, to] = paintedTerminalRun(edge, style)
    const marker = endMarker(edge, style)
    expect(to).toEqual(edge.points.at(-1)!)
    expect(from.x).toBe(to.x)
    expect(marker.y0 - from.y).toBeGreaterThanOrEqual(3.9998)
  })

  test.each([3, 12])('a %dpx edge style reserves its thick marker stroke', lineWidth => {
    const { positioned, horizontal, style } = laidOut('flowchart LR\nA[Source] ==> C[Target]\nB[Other source] -.-> C', { style: { roles: { edge: { lineWidth, bendRadius: 8 } } } })
    expectReadableEnds(positioned, horizontal, style)
  })
  for (const { name, source } of CASES) {
    for (const style of STYLES) {
      test(`${name}, ${style.name} styling`, () => {
        const { positioned, horizontal, style: resolved } = laidOut(source, style.options)
        expectReadableEnds(positioned, horizontal, resolved)
      })
    }
  }

  test.each([
    {
      // "3" sits beside the arrowhead 9 paints into Alpha, between the lanes
      // of 9 and its parallel sibling 4: no seat off 9's marker avoids 4's line.
      name: "a caption kept clear of a neighbour's arrowhead",
      options: {},
      caption: '3',
      source: 'flowchart TD\n  Z[Start] -->|long 1| A[Alpha]\n  Z -->|long 2| A\n  A -->|3| B[Beta]\n  A -->|4| B\n'
        + '  B -->|5| C[Gamma]\n  B -->|6| D[Delta]\n  C -->|7| D\n  D -->|8| E[End]\n  B -->|9| A\n  C -->|10| A\n  D -->|11| A\n  C -->|13| B\n  D -->|14| B',
    },
    {
      // Keeping 9/11 and 13/14 on separate arrowheads seats captions 11 and 14
      // on either side of the free seat above 12's loop: only moving both
      // together uncovers 11's line.
      name: 'a self-loop caption blocked by two captions at once',
      options: {},
      caption: '12',
      source: 'flowchart TD\n  B -->|9| A\n  D -->|11| A\n  B -->|12| B\n  C -->|13| B\n  D -->|14| B\n  C -->|18| C',
    },
    {
      name: 'a grouped fan-out with two wide captions',
      options: { style: 'publication-figure' },
      caption: 'A very long alpha caption',
      source: 'flowchart TD\nsubgraph G[Group]\nA -->|A very long alpha caption| B\nA -->|A very long beta caption| C\nend',
    },
  ])('$name covers no other relationship\'s line', ({ caption, source, options }) => {
    const { positioned, style } = laidOut(source, options)
    const subject = positioned.edges.find(edge => edge.label === caption)!
    const pill = labelRect(subject, style)!
    const box = { x0: pill.x, y0: pill.y, x1: pill.x + pill.w, y1: pill.y + pill.h }
    for (const other of positioned.edges) {
      if (other === subject) continue
      for (let i = 1; i < other.points.length; i++) {
        const a = other.points[i - 1]!, b = other.points[i]!
        const run = { x0: Math.min(a.x, b.x), y0: Math.min(a.y, b.y), x1: Math.max(a.x, b.x), y1: Math.max(a.y, b.y) }
        expect(run.x1 > box.x0 && run.x0 < box.x1 && run.y1 > box.y0 && run.y0 < box.y1, `"${caption}" covers the line of ${other.label ?? `${other.source}->${other.target}`}`).toBe(false)
      }
    }
  })
})
