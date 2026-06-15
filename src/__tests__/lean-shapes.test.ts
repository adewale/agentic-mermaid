// ============================================================================
// Slanted-family workstream: parallelogram parsing (lean-r / lean-l) and the
// PORT_EXACT promotion of the slanted shapes (trapezoid, trapezoid-alt,
// asymmetric, lean-r, lean-l).
//
// Red-first TDD battery:
//   1. parser: [/x/] → lean-r, [\x\] → lean-l, trapezoids unchanged;
//      serializer round-trips the canonical source to the same shapes.
//   2. shapePorts: slant midpoints for the trapezoid/lean family (exact
//      numbers on a hand-built node); regression-pinned bbox midpoints for
//      rectangle/diamond/circle.
//   3. fan-in integration (like the existing 'PORT_EXACT shapes' test):
//      trapezoid and lean trios in LR get a two-point port-to-port straight
//      and both edges enter the same exact W port.
//   4. rubric: chains of each promoted shape in all four directions have
//      zero hard violations.
// ============================================================================

import { describe, expect, it } from 'bun:test'
import { layoutGraphSync } from '../layout-engine.ts'
import { parseMermaid } from '../parser.ts'
import { shapePorts } from '../route-contracts.ts'
import { renderFlowchart } from '../agent/flowchart-body.ts'
import { assessLayout } from '../layout-rubric.ts'
import type { PositionedEdge, PositionedNode } from '../types.ts'

describe('parser — parallelogram (lean) shapes', () => {
  it('parses A[/text/] as lean-r (Mermaid lean_right, the flowchart I/O symbol)', () => {
    const g = parseMermaid('flowchart LR\n  A[/Input/]')
    expect(g.nodes.get('A')!.shape).toBe('lean-r')
    expect(g.nodes.get('A')!.label).toBe('Input')
  })

  it('parses A[\\text\\] as lean-l', () => {
    const g = parseMermaid('flowchart LR\n  A[\\Output\\]')
    expect(g.nodes.get('A')!.shape).toBe('lean-l')
    expect(g.nodes.get('A')!.label).toBe('Output')
  })

  it('keeps the trapezoids unchanged: [/x\\] and [\\x/]', () => {
    const g = parseMermaid('flowchart LR\n  A[/Trap\\]\n  B[\\Alt/]')
    expect(g.nodes.get('A')!.shape).toBe('trapezoid')
    expect(g.nodes.get('A')!.label).toBe('Trap')
    expect(g.nodes.get('B')!.shape).toBe('trapezoid-alt')
    expect(g.nodes.get('B')!.label).toBe('Alt')
  })

  it('disambiguates parallelograms from trapezoids in chained edge lines', () => {
    const g = parseMermaid('flowchart LR\n  A[/In/] --> B[/Trap\\] --> C[\\Out\\] --> D[\\Alt/]')
    expect(g.nodes.get('A')!.shape).toBe('lean-r')
    expect(g.nodes.get('B')!.shape).toBe('trapezoid')
    expect(g.nodes.get('C')!.shape).toBe('lean-l')
    expect(g.nodes.get('D')!.shape).toBe('trapezoid-alt')
  })

  it('serializer round-trips: canonical source re-parses to the same shapes and labels', () => {
    const g = parseMermaid('flowchart LR\n  A[/In/] --> B[\\Out\\]\n  B --> C[/Trap\\]\n  C --> D[\\Alt/]')
    const canonical = renderFlowchart(g, 'flowchart')
    const g2 = parseMermaid(canonical)
    for (const [id, shape, label] of [
      ['A', 'lean-r', 'In'],
      ['B', 'lean-l', 'Out'],
      ['C', 'trapezoid', 'Trap'],
      ['D', 'trapezoid-alt', 'Alt'],
    ] as const) {
      expect(g2.nodes.get(id)!.shape).toBe(shape)
      expect(g2.nodes.get(id)!.label).toBe(label)
    }
    // And the canonical source is a fixed point.
    expect(renderFlowchart(g2, 'flowchart')).toBe(canonical)
  })
})

describe('shapePorts — slanted family puts E/W on the slant midpoints', () => {
  // Hand-built node: x=100, y=50, w=80, h=40 → inset = 80 * 0.15 = 12,
  // cx=140, cy=70. Slant midpoints at cy: E = x+w-i/2 = 174, W = x+i/2 = 106.
  const mk = (shape: PositionedNode['shape']): PositionedNode =>
    ({ id: 'X', label: 'X', shape, x: 100, y: 50, width: 80, height: 40 })

  it.each(['trapezoid', 'trapezoid-alt', 'lean-r', 'lean-l'] as const)(
    '%s: E=(174,70), W=(106,70), N=(140,50), S=(140,90)',
    shape => {
      const ports = shapePorts(mk(shape))
      expect(ports.E).toEqual({ x: 174, y: 70 })
      expect(ports.W).toEqual({ x: 106, y: 70 })
      expect(ports.N).toEqual({ x: 140, y: 50 })
      expect(ports.S).toEqual({ x: 140, y: 90 })
    },
  )

  it('asymmetric: W is the flag point at (x, cy); E/N/S stay at the bbox midpoints', () => {
    const ports = shapePorts(mk('asymmetric'))
    expect(ports.W).toEqual({ x: 100, y: 70 })
    expect(ports.E).toEqual({ x: 180, y: 70 })
    expect(ports.N).toEqual({ x: 140, y: 50 })
    expect(ports.S).toEqual({ x: 140, y: 90 })
  })

  it.each(['rectangle', 'diamond', 'circle'] as const)(
    'regression: %s ports stay EXACTLY at the bbox side midpoints',
    shape => {
      const ports = shapePorts(mk(shape))
      expect(ports.N).toEqual({ x: 140, y: 50 })
      expect(ports.E).toEqual({ x: 180, y: 70 })
      expect(ports.S).toEqual({ x: 140, y: 90 })
      expect(ports.W).toEqual({ x: 100, y: 70 })
    },
  )
})

describe('PORT_EXACT promotion — slanted fan-ins get the port-to-port composition', () => {
  function findEdge(edges: PositionedEdge[], from: string, to: string): PositionedEdge {
    const e = edges.find(e => e.source === from && e.target === to)
    if (!e) throw new Error(`edge ${from}->${to} not found`)
    return e
  }

  it.each([
    ['parallelograms (lean-r)', '[/One/]', '[/Hub/]', '[/Two/]'],
    ['parallelograms (lean-l)', '[\\One\\]', '[\\Hub\\]', '[\\Two\\]'],
    ['trapezoids', '[/One\\]', '[/Hub\\]', '[/Two\\]'],
  ] as const)(
    'the slanted family: %s fan-in merges symmetrically at the exact port',
    (_name, a, t, b) => {
      // Active fan-in centering: both peer edges leave their E port and
      // converge mirror-symmetric at T's single exact W port.
      const positioned = layoutGraphSync(parseMermaid(
        `flowchart LR\n  A${a} --> T${t}\n  B${b} --> T`))
      const at = findEdge(positioned.edges, 'A', 'T')
      const bt = findEdge(positioned.edges, 'B', 'T')
      for (const e of [at, bt]) {
        expect(e.routeCertificate?.sourcePort).toBe('E')
        expect(e.routeCertificate?.targetPort).toBe('W')
      }
      // Both edges enter through the same exact W port (fan-in merge).
      const lastA = at.points[at.points.length - 1]!
      const lastB = bt.points[bt.points.length - 1]!
      expect(Math.abs(lastA.x - lastB.x)).toBeLessThanOrEqual(0.5)
      expect(Math.abs(lastA.y - lastB.y)).toBeLessThanOrEqual(0.5)
      // Hub centered → merge point at the source barycenter (symmetric).
      const A = positioned.nodes.find(n => n.id === 'A')!
      const B = positioned.nodes.find(n => n.id === 'B')!
      const bary = ((A.y + A.height / 2) + (B.y + B.height / 2)) / 2
      expect(Math.abs(lastA.y - bary)).toBeLessThanOrEqual(1.5)
    },
  )
})

describe('rubric — slanted-family chains have zero hard violations in all directions', () => {
  const WRAPPERS = [
    ['trapezoid', (l: string) => `[/${l}\\]`],
    ['trapezoid-alt', (l: string) => `[\\${l}/]`],
    ['asymmetric', (l: string) => `>${l}]`],
    ['lean-r', (l: string) => `[/${l}/]`],
    ['lean-l', (l: string) => `[\\${l}\\]`],
  ] as const

  for (const [name, wrap] of WRAPPERS) {
    for (const dir of ['LR', 'TD', 'RL', 'BT'] as const) {
      it(`${name} chain in ${dir}`, () => {
        const graph = parseMermaid(
          `flowchart ${dir}\n  A${wrap('Aa')} --> B${wrap('Bb')} --> C${wrap('Cc')}`)
        const result = assessLayout(graph, layoutGraphSync(graph))
        expect(result.violations).toEqual([])
      })
    }
  }
})
