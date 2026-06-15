import { describe, expect, it } from 'bun:test'
import fc from 'fast-check'

import { renderMermaidASCII } from '../ascii/index.ts'
import { convertToAsciiGraph } from '../ascii/converter.ts'
import { determineLabelLine } from '../ascii/edge-routing.ts'
import { getPath, mergePath } from '../ascii/pathfinder.ts'
import {
  EMPTY_STYLE,
  Up,
  Down,
  Left,
  Right,
  type AsciiConfig,
  type AsciiEdge,
  type AsciiGraph,
  type AsciiNode,
  gridKey,
} from '../ascii/types.ts'
import { assertNoDiagonals } from '../ascii/validate.ts'
import type { MermaidGraph, MermaidNode } from '../types.ts'

const PROPERTY_RUNS = 50
const LABEL_CHARS = [...'abcdefghijklmnopqrstuvwxyz']
const ID_HEAD = [...'ABCDEFGHIJKLMNOPQRSTUVWXYZ']
const ID_TAIL = [...'abcdefghijklmnopqrstuvwxyz0123456789']

const labelArb = fc
  .array(fc.constantFrom(...LABEL_CHARS), { minLength: 1, maxLength: 10 })
  .map(chars => chars.join(''))

const wordArb = fc
  .array(fc.constantFrom(...LABEL_CHARS), { minLength: 1, maxLength: 8 })
  .map(chars => chars.join(''))

const spacedLabelArb = fc
  .array(wordArb, { minLength: 1, maxLength: 4 })
  .map(words => words.join(' '))

const idArb = fc
  .tuple(
    fc.constantFrom(...ID_HEAD),
    fc.array(fc.constantFrom(...ID_TAIL), { maxLength: 4 }),
  )
  .map(([head, tail]) => `${head}${tail.join('')}`)

const coordArb = fc.record({
  x: fc.integer({ min: 0, max: 8 }),
  y: fc.integer({ min: 0, max: 8 }),
})

const baseConfig: AsciiConfig = {
  useAscii: true,
  paddingX: 5,
  paddingY: 5,
  boxBorderPadding: 1,
  graphDirection: 'TD',
}

type StepDir = 'R' | 'L' | 'U' | 'D'

function makeNode(name: string, index: number, gridCoord: { x: number; y: number } | null): AsciiNode {
  return {
    name,
    displayLabel: name,
    shape: 'rectangle',
    index,
    gridCoord,
    drawingCoord: null,
    drawing: null,
    drawn: false,
    styleClassName: '',
    styleClass: EMPTY_STYLE,
  }
}

function makeGraph(direction: 'TD' | 'LR' = 'TD'): AsciiGraph {
  return {
    nodes: [],
    edges: [],
    canvas: [[]],
    roleCanvas: [[]],
    grid: new Map(),
    columnWidth: new Map(),
    rowHeight: new Map(),
    subgraphs: [],
    config: { ...baseConfig, graphDirection: direction },
    offsetX: 0,
    offsetY: 0,
    bundles: [],
    trunkJunctions: [],
  }
}

function occupyNode(graph: AsciiGraph, node: AsciiNode): void {
  const gridCoord = node.gridCoord!
  for (let dx = 0; dx < 3; dx++) {
    for (let dy = 0; dy < 3; dy++) {
      graph.grid.set(gridKey({ x: gridCoord.x + dx, y: gridCoord.y + dy }), node)
    }
  }
}

function occupiedGrid(points: Array<{ x: number; y: number }>): Map<string, AsciiNode> {
  const grid = new Map<string, AsciiNode>()
  points.forEach((point, index) => grid.set(gridKey(point), makeNode(`O${index}`, index, point)))
  return grid
}

function boundedExtent(from: { x: number; y: number }, to: { x: number; y: number }, obstacles: Array<{ x: number; y: number }>): { x: number; y: number } {
  const max = obstacles.reduce(
    (acc, point) => ({ x: Math.max(acc.x, point.x), y: Math.max(acc.y, point.y) }),
    { x: Math.max(from.x, to.x), y: Math.max(from.y, to.y) },
  )
  return { x: max.x + 4, y: max.y + 4 }
}

function isOrthogonalStep(path: Array<{ x: number; y: number }>, index: number): boolean {
  const prev = path[index - 1]!
  const current = path[index]!
  return Math.abs(prev.x - current.x) + Math.abs(prev.y - current.y) === 1
}

function buildWalk(start: { x: number; y: number }, steps: Array<{ dir: StepDir; len: number }>) {
  const path = [{ ...start }]
  let current = { ...start }

  for (const step of steps) {
    for (let i = 0; i < step.len; i++) {
      if (step.dir === 'R') current = { x: current.x + 1, y: current.y }
      else if (step.dir === 'L') current = { x: current.x - 1, y: current.y }
      else if (step.dir === 'U') current = { x: current.x, y: current.y - 1 }
      else current = { x: current.x, y: current.y + 1 }
      path.push(current)
    }
  }

  return path
}

function renderNode(id: string, label: string, variant: 'rectangle' | 'rounded' | 'diamond'): string {
  if (variant === 'rounded') return `${id}(${label})`
  if (variant === 'diamond') return `${id}{${label}}`
  return `${id}[${label}]`
}

describe('property-based ASCII pathfinding', () => {
  it('returns a shortest Manhattan path on an empty grid', () => {
    fc.assert(
      fc.property(coordArb, coordArb, (from, to) => {
        const path = getPath(new Map(), from, to)

        expect(path).not.toBeNull()
        expect(path![0]).toEqual(from)
        expect(path![path!.length - 1]).toEqual(to)
        expect(path!.length).toBe(Math.abs(from.x - to.x) + Math.abs(from.y - to.y) + 1)

        for (let index = 1; index < path!.length; index++) {
          expect(isOrthogonalStep(path!, index)).toBe(true)
        }
      }),
      { numRuns: PROPERTY_RUNS },
    )
  })

  it('returns null when the target is enclosed by occupied cells', () => {
    const to = { x: 4, y: 4 }
    const grid = occupiedGrid([
      { x: 3, y: 4 },
      { x: 5, y: 4 },
      { x: 4, y: 3 },
      { x: 4, y: 5 },
    ])

    expect(getPath(grid, { x: 0, y: 0 }, to)).toBeNull()
  })

  it('treats the top/left zero boundary as closed instead of using negative detours', () => {
    const grid = occupiedGrid([
      { x: 0, y: 1 },
      { x: 1, y: 0 },
      { x: 1, y: 1 },
      { x: 1, y: 2 },
    ])

    expect(getPath(grid, { x: 0, y: 0 }, { x: 0, y: 2 })).toBeNull()
  })

  it('keeps successful paths within the computed bounded search extent', () => {
    const caseArb = fc
      .record({
        from: coordArb,
        to: coordArb,
        obstacles: fc.uniqueArray(coordArb, { maxLength: 8, selector: value => `${value.x},${value.y}` }),
      })
      .filter(({ from, to, obstacles }) => {
        const blocked = new Set(obstacles.map(point => `${point.x},${point.y}`))
        return !blocked.has(`${from.x},${from.y}`) && !blocked.has(`${to.x},${to.y}`)
      })

    fc.assert(
      fc.property(caseArb, ({ from, to, obstacles }) => {
        const path = getPath(occupiedGrid(obstacles), from, to)
        if (path === null) return
        const bound = boundedExtent(from, to, obstacles)

        for (const point of path) {
          expect(point.x).toBeGreaterThanOrEqual(0)
          expect(point.y).toBeGreaterThanOrEqual(0)
          expect(point.x).toBeLessThanOrEqual(bound.x)
          expect(point.y).toBeLessThanOrEqual(bound.y)
        }
      }),
      { numRuns: PROPERTY_RUNS },
    )
  })

  it('avoids occupied cells while staying orthogonal', () => {
    const obstacleArb = fc
      .record({
        from: coordArb,
        to: coordArb,
        obstacles: fc.uniqueArray(coordArb, { maxLength: 8, selector: value => `${value.x},${value.y}` }),
      })
      .filter(({ from, to, obstacles }) => {
        if (from.x === to.x && from.y === to.y) return false
        const blocked = new Set(obstacles.map(point => `${point.x},${point.y}`))
        return !blocked.has(`${from.x},${from.y}`) && !blocked.has(`${to.x},${to.y}`)
      })

    fc.assert(
      fc.property(obstacleArb, ({ from, to, obstacles }) => {
        const grid = new Map<string, AsciiNode>()
        obstacles.forEach((point, index) => {
          grid.set(gridKey(point), makeNode(`N${index}`, index, point))
        })

        const path = getPath(grid, from, to)
        if (path === null) return

        expect(path[0]).toEqual(from)
        expect(path[path.length - 1]).toEqual(to)

        for (let index = 1; index < path.length; index++) {
          expect(isOrthogonalStep(path, index)).toBe(true)
        }

        for (const point of path.slice(0, -1)) {
          expect(grid.has(gridKey(point))).toBe(false)
        }
      }),
      { numRuns: PROPERTY_RUNS },
    )
  })

  it('preferred direction controls first step for tied empty-grid routes', () => {
    expect(getPath(new Map(), { x: 1, y: 1 }, { x: 0, y: 0 }, Left)?.[1]).toEqual({ x: 0, y: 1 })
    expect(getPath(new Map(), { x: 1, y: 1 }, { x: 0, y: 0 }, Up)?.[1]).toEqual({ x: 1, y: 0 })
    expect(getPath(new Map(), { x: 1, y: 1 }, { x: 2, y: 2 }, Right)?.[1]).toEqual({ x: 2, y: 1 })
    expect(getPath(new Map(), { x: 1, y: 1 }, { x: 2, y: 2 }, Down)?.[1]).toEqual({ x: 1, y: 2 })
  })

  it('mergePath preserves endpoints and is idempotent', () => {
    const walkArb = fc
      .array(
        fc.record({
          dir: fc.constantFrom<StepDir>('R', 'L', 'U', 'D'),
          len: fc.integer({ min: 1, max: 3 }),
        }),
        { minLength: 1, maxLength: 8 },
      )
      .filter((steps) => {
        let previous: StepDir | null = null
        for (const step of steps) {
          if (step.dir === previous) return false
          previous = step.dir
        }
        return true
      })

    fc.assert(
      fc.property(coordArb, walkArb, (start, steps) => {
        const path = buildWalk(start, steps)
        const merged = mergePath(path)

        expect(merged[0]).toEqual(path[0])
        expect(merged[merged.length - 1]).toEqual(path[path.length - 1])
        expect(mergePath(merged)).toEqual(merged)
        expect(merged.length <= path.length).toBe(true)
      }),
      { numRuns: PROPERTY_RUNS },
    )
  })
})

describe('property-based ASCII routing helpers', () => {
  function labeledEdge(path: Array<{ x: number; y: number }>, text = 'wide'): AsciiEdge {
    return {
      from: makeNode('A', 0, path[0]!),
      to: makeNode('B', 1, path[path.length - 1]!),
      text,
      path,
      labelLine: [],
      startDir: { x: 0, y: 0 },
      endDir: { x: 0, y: 0 },
      style: 'solid',
      hasArrowStart: false,
      hasArrowEnd: true,
    }
  }

  it('prefers the widest fitting branch segment for a TD label', () => {
    const graph = makeGraph('TD')
    graph.columnWidth.set(2, 9)
    graph.columnWidth.set(8, 5)
    const edge = labeledEdge([
      { x: 0, y: 0 },
      { x: 2, y: 0 },
      { x: 2, y: 3 },
      { x: 8, y: 3 },
      { x: 8, y: 6 },
    ])

    determineLabelLine(graph, edge)

    expect(edge.labelLine).toEqual([{ x: 2, y: 0 }, { x: 2, y: 3 }])
  })

  it('lets a later wider TD branch segment beat an earlier narrower one', () => {
    const graph = makeGraph('TD')
    graph.columnWidth.set(2, 5)
    graph.columnWidth.set(8, 9)
    const edge = labeledEdge([
      { x: 0, y: 0 },
      { x: 2, y: 0 },
      { x: 2, y: 3 },
      { x: 8, y: 3 },
      { x: 8, y: 6 },
    ])

    determineLabelLine(graph, edge)

    expect(edge.labelLine).toEqual([{ x: 8, y: 3 }, { x: 8, y: 6 }])
  })

  it('selects a label segment from the path and widens the midpoint column', () => {
    const pathArb = fc.record({
      direction: fc.constantFrom<'TD' | 'LR'>('TD', 'LR'),
      x0: fc.integer({ min: 0, max: 6 }),
      y0: fc.integer({ min: 0, max: 6 }),
      length: fc.integer({ min: 2, max: 6 }),
      label: labelArb,
    })

    fc.assert(
      fc.property(pathArb, ({ direction, x0, y0, length, label }) => {
        const graph = makeGraph(direction)
        const edge: AsciiEdge = {
          from: makeNode('A', 0, { x: x0, y: y0 }),
          to: makeNode('B', 1, direction === 'TD' ? { x: x0, y: y0 + length } : { x: x0 + length, y: y0 }),
          text: label,
          path: direction === 'TD'
            ? [{ x: x0, y: y0 }, { x: x0, y: y0 + length }]
            : [{ x: x0, y: y0 }, { x: x0 + length, y: y0 }],
          labelLine: [],
          startDir: { x: 0, y: 0 },
          endDir: { x: 0, y: 0 },
          style: 'solid',
          hasArrowStart: false,
          hasArrowEnd: true,
        }

        for (let x = Math.min(edge.path[0]!.x, edge.path[1]!.x); x <= Math.max(edge.path[0]!.x, edge.path[1]!.x); x++) {
          graph.columnWidth.set(x, 1)
        }

        determineLabelLine(graph, edge)

        expect(edge.labelLine).toHaveLength(2)
        expect(edge.labelLine[0]).toEqual(edge.path[0])
        expect(edge.labelLine[1]).toEqual(edge.path[1])

        const middleX = Math.min(edge.labelLine[0]!.x, edge.labelLine[1]!.x)
          + Math.floor(Math.abs(edge.labelLine[0]!.x - edge.labelLine[1]!.x) / 2)
        expect((graph.columnWidth.get(middleX) ?? 0) >= label.length + 2).toBe(true)
      }),
      { numRuns: PROPERTY_RUNS },
    )
  })

  it('preserves insertion order and applied classes when converting to an ASCII graph', () => {
    const graphArb = fc
      .uniqueArray(
        fc.record({
          id: idArb,
          label: labelArb,
          shape: fc.constantFrom<'rectangle' | 'rounded' | 'diamond'>('rectangle', 'rounded', 'diamond'),
        }),
        { minLength: 2, maxLength: 5, selector: value => value.id },
      )
      .chain(nodes =>
        fc.record({
          nodes: fc.constant(nodes),
          classAssignments: fc.dictionary(fc.constantFrom(...nodes.map(node => node.id)), fc.constantFrom('hot', 'cold')),
        }),
      )

    fc.assert(
      fc.property(graphArb, ({ nodes, classAssignments }) => {
        const parsed: MermaidGraph = {
          direction: 'TD',
          nodes: new Map(nodes.map((node): [string, MermaidNode] => [node.id, {
            id: node.id,
            label: node.label,
            shape: node.shape,
          }])),
          edges: [],
          subgraphs: [],
          classDefs: new Map([
            ['hot', { fill: '#f00' }],
            ['cold', { fill: '#00f' }],
          ]),
          classAssignments: new Map(Object.entries(classAssignments)),
          nodeStyles: new Map(),
          linkStyles: new Map(),
        }

        const graph = convertToAsciiGraph(parsed, baseConfig)

        expect(graph.nodes.map(node => node.name)).toEqual(nodes.map(node => node.id))
        for (const node of graph.nodes) {
          const assignedClass = classAssignments[node.name]
          if (!assignedClass) {
            expect(node.styleClassName).toBe('')
            continue
          }
          expect(node.styleClassName).toBe(assignedClass)
          expect(node.styleClass.styles.fill).toBe(assignedClass === 'hot' ? '#f00' : '#00f')
        }
      }),
      { numRuns: PROPERTY_RUNS },
    )
  })
})

describe('property-based renderMermaidASCII', () => {
  it('preserves ER relationship labels instead of clipping to the connector gap', () => {
    fc.assert(
      fc.property(spacedLabelArb, fc.boolean(), (label, useAscii) => {
        const ascii = renderMermaidASCII(`erDiagram
  CUSTOMER ||--o{ ORDER : ${label}`, { colorMode: 'none', useAscii })
        expect(ascii).toContain(label)
      }),
      { numRuns: PROPERTY_RUNS },
    )
  })

  it('keeps small generated flowcharts free of diagonal edges', () => {
    const flowchartArb = fc
      .uniqueArray(
        fc.record({
          id: idArb,
          label: labelArb,
          shape: fc.constantFrom<'rectangle' | 'rounded' | 'diamond'>('rectangle', 'rounded', 'diamond'),
        }),
        { minLength: 2, maxLength: 4, selector: value => value.id },
      )
      .chain(nodes =>
        fc.record({
          nodes: fc.constant(nodes),
          edges: fc.uniqueArray(
            fc.record({
              from: fc.constantFrom(...nodes.map(node => node.id)),
              to: fc.constantFrom(...nodes.map(node => node.id)),
              label: fc.option(labelArb, { nil: undefined }),
            }).filter(edge => edge.from !== edge.to),
            {
              minLength: 1,
              maxLength: Math.min(4, nodes.length * (nodes.length - 1)),
              selector: edge => `${edge.from}->${edge.to}:${edge.label ?? ''}`,
            },
          ),
        }),
      )

    fc.assert(
      fc.property(flowchartArb, ({ nodes, edges }) => {
        const source = [
          'graph TD',
          ...nodes.map((node) => renderNode(node.id, node.label, node.shape)),
          ...edges.map((edge) => `${edge.from} -->${edge.label ? `|${edge.label}|` : ''} ${edge.to}`),
        ].join('\n')

        const ascii = renderMermaidASCII(source, { colorMode: 'none', useAscii: false })
        assertNoDiagonals(ascii)
      }),
      { numRuns: 30 },
    )
  })
})
