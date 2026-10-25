/**
 * Tests for the Mermaid parser.
 *
 * Covers:
 * - Flowcharts: graph headers, node shapes (all 13), edge styles, chained edges,
 *   subgraphs (basic + nested), classDef/class, ::: shorthand, style statements,
 *   direction override, & parallel links, no-arrow edges, bidirectional arrows
 * - State diagrams: transitions, [*] pseudostates, composite states,
 *   state aliases, direction override
 * - Comments and error cases
 */
import { describe, it, expect } from 'bun:test'
import fc from 'fast-check'
import { fcParameters } from './helpers/fc-parameters.ts'
import { join } from 'node:path'
import { parseMermaid } from '../parser.ts'
import { DIAGRAM_WORK_LIMITS } from '../shared/diagram-limits.ts'
import { parseRegisteredMermaid, renderMermaidSVG, serializeMermaid, verifyMermaid } from '../agent/index.ts'
import { useTestChildren } from './helpers/test-child.ts'

const runChild = useTestChildren(20_000)

// ============================================================================
// Graph header parsing
// ============================================================================

describe('parseMermaid – graph header', () => {
  it('parses graph families in a fresh process without registry side effects', async () => {
    const script = `
      const { parseMermaid } = await import('./src/parser.ts')
      const flowchart = parseMermaid('flowchart LR\\n  A --> B')
      const state = parseMermaid('stateDiagram-v2\\n  [*] --> Ready')
      if (flowchart.direction !== 'LR' || state.direction !== 'TD') process.exit(1)
    `
    const result = await runChild('bun', ['-e', script], { cwd: join(import.meta.dir, '..', '..') })
    expect(result.status, result.stderr || result.stdout).toBe(0)
  })

  it('parses "graph TD" header', () => {
    const g = parseMermaid('graph TD\n  A --> B')
    expect(g.direction).toBe('TD')
  })

  it('parses "flowchart LR" header', () => {
    const g = parseMermaid('flowchart LR\n  A --> B')
    expect(g.direction).toBe('LR')
  })

  it.each(['TD', 'TB', 'LR', 'BT', 'RL'] as const)('accepts direction %s', (dir) => {
    const g = parseMermaid(`graph ${dir}\n  A --> B`)
    expect(g.direction).toBe(dir)
  })

  it.each([
    ['>', 'LR'],
    ['<', 'RL'],
    ['^', 'BT'],
    ['v', 'TB'],
  ] as const)('accepts Mermaid direction shorthand %s', (raw, dir) => {
    const g = parseMermaid(`graph ${raw};A-->B;`)
    expect(g.direction).toBe(dir)
    expect(g.edges).toHaveLength(1)
  })

  it('accepts a semicolon-packed header and first statement', () => {
    const g = parseMermaid('graph TD;A-->B;')
    expect(g.direction).toBe('TD')
    expect(g.nodes.has('A')).toBe(true)
    expect(g.nodes.has('B')).toBe(true)
    expect(g.edges).toHaveLength(1)
  })

  it('accepts swimlane as a flowchart header alias', () => {
    const g = parseMermaid('swimlane LR;A-->B;')
    expect(g.direction).toBe('LR')
    expect(g.nodes.has('A')).toBe(true)
    expect(g.nodes.has('B')).toBe(true)
    expect(g.edges).toHaveLength(1)
  })

  it('parses quoted rectangle labels containing bracket characters', () => {
    const g = parseMermaid('graph TD;A["chimpansen hoppar ()[]"] --> C;')
    expect(g.nodes.get('A')?.label).toBe('chimpansen hoppar ()[]')
    expect(g.edges).toHaveLength(1)
  })

  it('is case-insensitive for the keyword', () => {
    const g = parseMermaid('graph td\n  A --> B')
    expect(g.direction).toBe('TD')
  })

  it('throws on empty input', () => {
    expect(() => parseMermaid('')).toThrow('Empty mermaid diagram')
  })

  it('throws on invalid header', () => {
    expect(() => parseMermaid('sequenceDiagram\n  A ->> B')).toThrow('is not a graph family')
  })

  it('throws on header without direction', () => {
    expect(() => parseMermaid('graph\n  A --> B')).toThrow('Invalid mermaid header')
  })
})

// ============================================================================
// Original node shapes
// ============================================================================

describe('parseMermaid – node shapes (original)', () => {
  it.each([
    ['Hello World', 'Hello World'],
    ['é 家 👨‍👩‍👧', 'é 家 👨‍👩‍👧'],
    ['<b>bold</b><br/>tail', '<b>bold</b>\ntail'],
    ['#amp;', '&'],
    ['ﬂ°°65¶ß', 'A'],
    ['ﬂ°amp¶ß', '&'],
    ['ﬂ°°', 'ﬂ°°'],
    ['ﬂ°bad¶', 'ﬂ°bad¶'],
  ])('parses rectangle label %s', (authored, label) => {
    const g = parseMermaid(`graph TD\n  A["${authored}"]`)
    const node = g.nodes.get('A')
    expect(node).toBeDefined()
    expect(node!.shape).toBe('rectangle')
    expect(node!.label).toBe(label)
  })

  it.each(['#1;', 'ﬂ°°1¶ß'])('refuses rectangle label entity %s that projects a terminal control', authored => {
    expect(() => parseMermaid(`graph TD\n  A["${authored}"]`)).toThrow('projects a terminal control character')
  })

  it('parses rounded nodes: A(Label)', () => {
    const g = parseMermaid('graph TD\n  A(Rounded)')
    expect(g.nodes.get('A')!.shape).toBe('rounded')
    expect(g.nodes.get('A')!.label).toBe('Rounded')
  })

  it('parses diamond nodes: A{Label}', () => {
    const g = parseMermaid('graph TD\n  A{Decision}')
    expect(g.nodes.get('A')!.shape).toBe('diamond')
    expect(g.nodes.get('A')!.label).toBe('Decision')
  })

  it('parses stadium nodes: A([Label])', () => {
    const g = parseMermaid('graph TD\n  A([Stadium])')
    expect(g.nodes.get('A')!.shape).toBe('stadium')
    expect(g.nodes.get('A')!.label).toBe('Stadium')
  })

  it('parses circle nodes: A((Label))', () => {
    const g = parseMermaid('graph TD\n  A((Circle))')
    expect(g.nodes.get('A')!.shape).toBe('circle')
    expect(g.nodes.get('A')!.label).toBe('Circle')
  })

  it('creates a default rectangle for bare node references', () => {
    const g = parseMermaid('graph TD\n  A --> B')
    expect(g.nodes.get('A')!.shape).toBe('rectangle')
    expect(g.nodes.get('A')!.label).toBe('A')
    expect(g.nodes.get('B')!.shape).toBe('rectangle')
    expect(g.nodes.get('B')!.label).toBe('B')
  })

  it('supports hyphenated node IDs', () => {
    const g = parseMermaid('graph TD\n  my-node[My Node]')
    expect(g.nodes.get('my-node')).toBeDefined()
    expect(g.nodes.get('my-node')!.label).toBe('My Node')
  })

  // Upstream's node string (flow.jison NODE_STRING) holds `!"#$%&'*+.`?\/`,
  // and its id grammar `:`, besides letters, digits, `_` and `-`; a `"` only
  // after an id's first character. Its AMP token is an id token too, so a
  // lone `&` is a node, and `& ` after a node joins a list. An `x` or `o`
  // right after id characters is the id's, not a link's marker.
  it.each([
    ['A.B --> C', ['A.B', 'C']],
    ['A.-B', ['A.-B']],
    ['C`"', ['C`"']],
    ['A"B --> C"', ['A"B', 'C"']],
    ["A!B & A#B & A$B & A%B & A'B & A*B --> A+B & A?B & A\\B & A/B", ["A!B", 'A#B', 'A$B', 'A%B', "A'B", 'A*B', 'A+B', 'A?B', 'A\\B', 'A/B']],
    ['A&B --> C & D', ['A&B', 'C', 'D']],
    ['A:B:::c --> C', ['A:B', 'C']],
    [':a --> &b & C & &&', [':a', '&b', 'C', '&&']],
    ['& --> B & &', ['&', 'B']],
    ['.A --> B. --> 1.5', ['.A', 'B.', '1.5']],
    ['é.b[label] --> c', ['é.b', 'c']],
    ['Xo--xY', ['Xo', 'Y']],
    // Upstream's node string ends before `->`, but its id grammar takes the
    // `-` in before the `>` that opens shape text.
    ['A-->odd->Text] --> B-', ['A', 'odd-', 'B-']],
  ])('reads %j with the node ids upstream reads, and writes them back', (statement, ids) => {
    const source = `flowchart LR\n  ${statement}\n  style ${ids[0]} fill:#f00\n  class ${ids.at(-1)} c`
    expect([...parseMermaid(source).nodes.keys()]).toEqual(ids)
    const parsed = parseRegisteredMermaid(source)
    if (!parsed.ok) throw new Error(JSON.stringify(parsed.error))
    const written = parseMermaid(serializeMermaid(parsed.value))
    expect([...written.nodes.keys()].sort()).toEqual([...ids].sort())
    expect([...written.nodeStyles.keys()]).toEqual([ids[0]!])
    expect(written.classAssignments.has(ids.at(-1)!)).toBe(true)
  })

  // In shape text a `"` is written `#quot;`, which upstream keeps in its raw
  // label: an orphan labelled by an id that holds one is written bare.
  it.each(['C`"', 'A"B'])('writes the orphan %s as its bare id', id => {
    const parsed = parseRegisteredMermaid(`flowchart LR\n  ${id}`)
    if (!parsed.ok) throw new Error(JSON.stringify(parsed.error))
    expect(serializeMermaid(parsed.value)).toBe(`flowchart LR\n  ${id}\n`)
  })

  it('first definition wins for shape and label', () => {
    const g = parseMermaid('graph TD\n  A[Start] --> B\n  A --> B')
    expect(g.nodes.get('A')!.shape).toBe('rectangle')
    expect(g.nodes.get('A')!.label).toBe('Start')
  })
})

// ============================================================================
// Batch 1 node shapes
// ============================================================================

describe('parseMermaid – node shapes (Batch 1)', () => {
  it('parses subroutine nodes: A[[Label]]', () => {
    const g = parseMermaid('graph TD\n  A[[Subroutine]]')
    expect(g.nodes.get('A')!.shape).toBe('subroutine')
    expect(g.nodes.get('A')!.label).toBe('Subroutine')
  })

  it('parses double circle nodes: A(((Label)))', () => {
    const g = parseMermaid('graph TD\n  A(((Double)))')
    expect(g.nodes.get('A')!.shape).toBe('doublecircle')
    expect(g.nodes.get('A')!.label).toBe('Double')
  })

  it('parses hexagon nodes: A{{Label}}', () => {
    const g = parseMermaid('graph TD\n  A{{Hexagon}}')
    expect(g.nodes.get('A')!.shape).toBe('hexagon')
    expect(g.nodes.get('A')!.label).toBe('Hexagon')
  })
})

// ============================================================================
// Batch 2 node shapes
// ============================================================================

describe('parseMermaid – node shapes (Batch 2)', () => {
  it('parses cylinder / database nodes: A[(Label)]', () => {
    const g = parseMermaid('graph TD\n  A[(Database)]')
    expect(g.nodes.get('A')!.shape).toBe('cylinder')
    expect(g.nodes.get('A')!.label).toBe('Database')
  })

  it('parses asymmetric / flag nodes: A>Label]', () => {
    const g = parseMermaid('graph TD\n  A>Flag Shape]')
    expect(g.nodes.get('A')!.shape).toBe('asymmetric')
    expect(g.nodes.get('A')!.label).toBe('Flag Shape')
  })

  it('parses trapezoid nodes: A[/Label\\]', () => {
    const g = parseMermaid('graph TD\n  A[/Trapezoid\\]')
    expect(g.nodes.get('A')!.shape).toBe('trapezoid')
    expect(g.nodes.get('A')!.label).toBe('Trapezoid')
  })

  it('parses trapezoid-alt nodes: A[\\Label/]', () => {
    const g = parseMermaid('graph TD\n  A[\\Alt Trapezoid/]')
    expect(g.nodes.get('A')!.shape).toBe('trapezoid-alt')
    expect(g.nodes.get('A')!.label).toBe('Alt Trapezoid')
  })
})

// ============================================================================
// All shapes in one diagram — ensures no regex conflicts
// ============================================================================

describe('parseMermaid – all shapes combined', () => {
  it('parses all 13 shapes correctly in one diagram', () => {
    const g = parseMermaid(`graph TD
      A[Rectangle]
      B(Rounded)
      C{Diamond}
      D([Stadium])
      E((Circle))
      F[[Subroutine]]
      G(((DoubleCircle)))
      H{{Hexagon}}
      I[(Cylinder)]
      J>Asymmetric]
      K[/Trapezoid\\]
      L[\\TrapAlt/]`)

    expect(g.nodes.get('A')!.shape).toBe('rectangle')
    expect(g.nodes.get('B')!.shape).toBe('rounded')
    expect(g.nodes.get('C')!.shape).toBe('diamond')
    expect(g.nodes.get('D')!.shape).toBe('stadium')
    expect(g.nodes.get('E')!.shape).toBe('circle')
    expect(g.nodes.get('F')!.shape).toBe('subroutine')
    expect(g.nodes.get('G')!.shape).toBe('doublecircle')
    expect(g.nodes.get('H')!.shape).toBe('hexagon')
    expect(g.nodes.get('I')!.shape).toBe('cylinder')
    expect(g.nodes.get('J')!.shape).toBe('asymmetric')
    expect(g.nodes.get('K')!.shape).toBe('trapezoid')
    expect(g.nodes.get('L')!.shape).toBe('trapezoid-alt')
  })
})

// ============================================================================
// Edge parsing — original arrows
// ============================================================================

describe('parseMermaid – edges (original)', () => {
  it('parses a solid edge: -->', () => {
    const g = parseMermaid('graph TD\n  A --> B')
    expect(g.edges).toHaveLength(1)
    expect(g.edges[0]!.source).toBe('A')
    expect(g.edges[0]!.target).toBe('B')
    expect(g.edges[0]!.style).toBe('solid')
    expect(g.edges[0]!.label).toBeUndefined()
  })

  it('parses a dotted edge: -.->', () => {
    const g = parseMermaid('graph TD\n  A -.-> B')
    expect(g.edges[0]!.style).toBe('dotted')
  })

  it('parses a thick edge: ==>', () => {
    const g = parseMermaid('graph TD\n  A ==> B')
    expect(g.edges[0]!.style).toBe('thick')
  })

  it('parses edge label: -->|label|', () => {
    const g = parseMermaid('graph TD\n  A -->|Yes| B')
    expect(g.edges[0]!.label).toBe('Yes')
  })

  it('parses edge label on dotted edges', () => {
    const g = parseMermaid('graph TD\n  A -.->|Maybe| B')
    expect(g.edges[0]!.label).toBe('Maybe')
    expect(g.edges[0]!.style).toBe('dotted')
  })

  it('parses chained edges: A --> B --> C', () => {
    const g = parseMermaid('graph TD\n  A --> B --> C')
    expect(g.edges).toHaveLength(2)
    expect(g.edges[0]!.source).toBe('A')
    expect(g.edges[0]!.target).toBe('B')
    expect(g.edges[1]!.source).toBe('B')
    expect(g.edges[1]!.target).toBe('C')
  })

  it('parses chained edges with shapes: A[Start] --> B{Check} --> C(End)', () => {
    const g = parseMermaid('graph TD\n  A[Start] --> B{Check} --> C(End)')
    expect(g.edges).toHaveLength(2)
    expect(g.nodes.get('A')!.shape).toBe('rectangle')
    expect(g.nodes.get('B')!.shape).toBe('diamond')
    expect(g.nodes.get('C')!.shape).toBe('rounded')
  })

  it('handles multiple edge lines', () => {
    const g = parseMermaid('graph TD\n  A --> B\n  B --> C\n  C --> D')
    expect(g.edges).toHaveLength(3)
  })

  it('sets hasArrowEnd=true for arrow operators (-->)', () => {
    const g = parseMermaid('graph TD\n  A --> B')
    expect(g.edges[0]!.hasArrowEnd).toBe(true)
    expect(g.edges[0]!.hasArrowStart).toBe(false)
  })
})

// ============================================================================
// No-arrow edges (Batch 1.1)
// ============================================================================

describe('parseMermaid – no-arrow edges', () => {
  it('parses solid line without arrow: ---', () => {
    const g = parseMermaid('graph TD\n  A --- B')
    expect(g.edges).toHaveLength(1)
    expect(g.edges[0]!.style).toBe('solid')
    expect(g.edges[0]!.hasArrowEnd).toBe(false)
    expect(g.edges[0]!.hasArrowStart).toBe(false)
  })

  it('parses dotted line without arrow: -.-', () => {
    const g = parseMermaid('graph TD\n  A -.- B')
    expect(g.edges[0]!.style).toBe('dotted')
    expect(g.edges[0]!.hasArrowEnd).toBe(false)
  })

  it('parses thick line without arrow: ===', () => {
    const g = parseMermaid('graph TD\n  A === B')
    expect(g.edges[0]!.style).toBe('thick')
    expect(g.edges[0]!.hasArrowEnd).toBe(false)
  })

  it('parses no-arrow with label: ---|text|', () => {
    const g = parseMermaid('graph TD\n  A ---|connects| B')
    expect(g.edges[0]!.label).toBe('connects')
    expect(g.edges[0]!.hasArrowEnd).toBe(false)
  })
})

// ============================================================================
// Bidirectional arrows (Batch 2.4)
// ============================================================================

describe('parseMermaid – bidirectional arrows', () => {
  it('parses solid bidirectional: <-->', () => {
    const g = parseMermaid('graph TD\n  A <--> B')
    expect(g.edges).toHaveLength(1)
    expect(g.edges[0]!.style).toBe('solid')
    expect(g.edges[0]!.hasArrowStart).toBe(true)
    expect(g.edges[0]!.hasArrowEnd).toBe(true)
  })

  it('parses dotted bidirectional: <-.->',  () => {
    const g = parseMermaid('graph TD\n  A <-.-> B')
    expect(g.edges[0]!.style).toBe('dotted')
    expect(g.edges[0]!.hasArrowStart).toBe(true)
    expect(g.edges[0]!.hasArrowEnd).toBe(true)
  })

  it('parses thick bidirectional: <==>', () => {
    const g = parseMermaid('graph TD\n  A <==> B')
    expect(g.edges[0]!.style).toBe('thick')
    expect(g.edges[0]!.hasArrowStart).toBe(true)
    expect(g.edges[0]!.hasArrowEnd).toBe(true)
  })

  it('parses bidirectional with label: <-->|text|', () => {
    const g = parseMermaid('graph TD\n  A <-->|sync| B')
    expect(g.edges[0]!.label).toBe('sync')
    expect(g.edges[0]!.hasArrowStart).toBe(true)
    expect(g.edges[0]!.hasArrowEnd).toBe(true)
  })
})

// ============================================================================
// Circle/cross endpoint markers (--o/--x)
// ============================================================================

describe('parseMermaid – circle/cross endpoint markers', () => {
  it('parses --o and --x as target markers without dropping the target node', () => {
    const circle = parseMermaid('graph LR\n  A --o B')
    expect(circle.nodes.has('B')).toBe(true)
    expect(circle.edges[0]).toMatchObject({ source: 'A', target: 'B', endMarker: 'circle', hasArrowEnd: true })

    const cross = parseMermaid('graph LR\n  A --x B')
    expect(cross.nodes.has('B')).toBe(true)
    expect(cross.edges[0]).toMatchObject({ source: 'A', target: 'B', endMarker: 'cross', hasArrowEnd: true })
  })

  it('parses mixed source and target circle/cross markers', () => {
    const graph = parseMermaid('graph LR\n  A o--x B\n  C x--o D')
    expect(graph.edges[0]).toMatchObject({ startMarker: 'circle', endMarker: 'cross', hasArrowStart: true, hasArrowEnd: true })
    expect(graph.edges[1]).toMatchObject({ startMarker: 'cross', endMarker: 'circle', hasArrowStart: true, hasArrowEnd: true })
  })

  it('keeps default arrow marker semantics for existing arrow syntax', () => {
    const graph = parseMermaid('graph LR\n  A <--> B')
    expect(graph.edges[0]).toMatchObject({ startMarker: 'arrow', endMarker: 'arrow' })
  })

  it('parses labels on circle/cross marker edges', () => {
    const graph = parseMermaid('graph LR\n  A --o|maybe| B')
    expect(graph.edges[0]).toMatchObject({ label: 'maybe', endMarker: 'circle' })
  })
})

// ============================================================================
// Text-embedded edge labels (fixes #32)
// Based on PR #36 by @liuxiaopai-ai
// ============================================================================

describe('parseMermaid – text-embedded edge labels', () => {
  it('parses solid arrow with text label: -- Yes -->', () => {
    const g = parseMermaid('graph TD\n  A -- Yes --> B')
    expect(g.edges).toHaveLength(1)
    expect(g.edges[0]!.label).toBe('Yes')
    expect(g.edges[0]!.style).toBe('solid')
    expect(g.edges[0]!.hasArrowEnd).toBe(true)
  })

  it('parses solid line with text label: -- text ---', () => {
    const g = parseMermaid('graph TD\n  A -- related --- B')
    expect(g.edges[0]!.label).toBe('related')
    expect(g.edges[0]!.style).toBe('solid')
    expect(g.edges[0]!.hasArrowEnd).toBe(false)
  })

  it('parses dotted arrow with text label: -. Maybe .->', () => {
    const g = parseMermaid('graph TD\n  A -. Maybe .-> B')
    expect(g.edges[0]!.label).toBe('Maybe')
    expect(g.edges[0]!.style).toBe('dotted')
    expect(g.edges[0]!.hasArrowEnd).toBe(true)
  })

  it('parses thick arrow with text label: == Sure ==>', () => {
    const g = parseMermaid('graph TD\n  A == Sure ==> B')
    expect(g.edges[0]!.label).toBe('Sure')
    expect(g.edges[0]!.style).toBe('thick')
    expect(g.edges[0]!.hasArrowEnd).toBe(true)
  })

  it('parses multi-word text labels', () => {
    const g = parseMermaid('graph TD\n  A -- This is a label --> B')
    expect(g.edges[0]!.label).toBe('This is a label')
  })

  it('parses shaped nodes with text-embedded labels', () => {
    const g = parseMermaid('graph TD\n  A[Start] -- Yes --> B(End)')
    expect(g.edges[0]!.label).toBe('Yes')
    expect(g.nodes.get('A')!.shape).toBe('rectangle')
    expect(g.nodes.get('B')!.shape).toBe('rounded')
  })

  it('produces same result as pipe syntax (issue #32)', () => {
    const pipe = parseMermaid(`graph TD
      A --> B
      B -->|Yes| C`)
    const text = parseMermaid(`graph TD
      A --> B
      B -- Yes --> C`)
    expect(pipe.edges[1]!.label).toBe(text.edges[1]!.label)
    expect(pipe.edges[1]!.style).toBe(text.edges[1]!.style)
    expect(pipe.edges[1]!.hasArrowEnd).toBe(text.edges[1]!.hasArrowEnd)
  })

  it('handles the exact issue #32 scenario', () => {
    const g = parseMermaid(`flowchart TD
      A(Start) --> B{Is it sunny?}
      B -- Yes --> C[Go to the park]
      B -- No --> D[Stay indoors]
      C --> E[Finish]
      D --> E`)
    expect(g.edges).toHaveLength(5)
    expect(g.edges[1]!.label).toBe('Yes')
    expect(g.edges[2]!.label).toBe('No')
  })
})

// ============================================================================
// Parallel links with & (Batch 2.6)
// ============================================================================

describe('parseMermaid – parallel links (&)', () => {
  it('expands A & B --> C to two edges', () => {
    const g = parseMermaid('graph TD\n  A & B --> C')
    expect(g.edges).toHaveLength(2)
    expect(g.edges[0]!.source).toBe('A')
    expect(g.edges[0]!.target).toBe('C')
    expect(g.edges[1]!.source).toBe('B')
    expect(g.edges[1]!.target).toBe('C')
  })

  it('expands A --> C & D to two edges', () => {
    const g = parseMermaid('graph TD\n  A --> C & D')
    expect(g.edges).toHaveLength(2)
    expect(g.edges[0]!.source).toBe('A')
    expect(g.edges[0]!.target).toBe('C')
    expect(g.edges[1]!.source).toBe('A')
    expect(g.edges[1]!.target).toBe('D')
  })

  it('expands A & B --> C & D to four edges (Cartesian product)', () => {
    const g = parseMermaid('graph TD\n  A & B --> C & D')
    expect(g.edges).toHaveLength(4)
    const edgePairs = g.edges.map(e => `${e.source}->${e.target}`)
    expect(edgePairs).toContain('A->C')
    expect(edgePairs).toContain('A->D')
    expect(edgePairs).toContain('B->C')
    expect(edgePairs).toContain('B->D')
  })
})

// ============================================================================
// ::: class shorthand (Batch 1.2)
// ============================================================================

describe('parseMermaid – quoted shape labels and Unicode identifiers', () => {
  const quotedShapes = [
    ['A("Retry (up to 3x)") --> B', 'rounded', 'Retry (up to 3x)'],
    ['A{{"Choose {A or B}"}} --> B', 'hexagon', 'Choose {A or B}'],
    ['A(("Wait (30s)")) --> B', 'circle', 'Wait (30s)'],
    ['A{"Is [ready]?"} --> B', 'diamond', 'Is [ready]?'],
  ] as const

  for (const [source, shape, label] of quotedShapes) {
    it(`keeps delimiters inside a quoted ${shape} label`, () => {
      const graph = parseMermaid(`flowchart TD\n  ${source}`)
      expect(graph.nodes.get('A')?.shape).toBe(shape)
      expect(graph.nodes.get('A')?.label).toBe(label)
      expect(graph.edges.map(edge => `${edge.source}->${edge.target}`)).toEqual(['A->B'])
    })
  }

  it('preserves arbitrary balanced-delimiter text inside quoted rounded labels', () => {
    fc.assert(fc.property(
      fc.array(fc.constantFrom('a', 'Z', ' ', '(', ')', '[', ']', '{', '}'), { minLength: 1, maxLength: 30 }),
      chars => {
        const label = chars.join('')
        const graph = parseMermaid(`flowchart TD\n  A("${label}") --> B`)
        // Boundary whitespace trims, as in upstream's flowchart DB.
        expect(graph.nodes.get('A')?.label).toBe(label.trim())
        expect(graph.edges).toHaveLength(1)
      },
    ), fcParameters({ numRuns: 60 }))
  })

  it('parses bare and shaped CJK identifiers without producing an empty graph', () => {
    const graph = parseMermaid('flowchart TD\n  開始("開始 (確認)") --> 終了')
    expect([...graph.nodes.keys()]).toEqual(['開始', '終了'])
    expect(graph.edges.map(edge => `${edge.source}->${edge.target}`)).toEqual(['開始->終了'])
    expect(graph.nodes.get('開始')?.label).toBe('開始 (確認)')
  })
})

describe('parseMermaid – ::: class shorthand', () => {
  it('assigns class via ::: on shaped nodes', () => {
    const g = parseMermaid('graph TD\n  A[Start]:::highlight --> B')
    expect(g.classAssignments.get('A')).toBe('highlight')
  })

  it('assigns class via ::: on bare nodes', () => {
    const g = parseMermaid('graph TD\n  A:::important --> B')
    expect(g.classAssignments.get('A')).toBe('important')
  })

  it('works in chained edges', () => {
    const g = parseMermaid('graph TD\n  A:::start --> B:::mid --> C:::end')
    expect(g.classAssignments.get('A')).toBe('start')
    expect(g.classAssignments.get('B')).toBe('mid')
    expect(g.classAssignments.get('C')).toBe('end')
  })
})

// ============================================================================
// Inline style statements (Batch 2.5)
// ============================================================================

describe('parseMermaid – style statements', () => {
  it('parses style for a single node', () => {
    const g = parseMermaid('graph TD\n  A --> B\n  style A fill:#ff0000,stroke:#333')
    expect(g.nodeStyles.get('A')).toEqual({ fill: '#ff0000', stroke: '#333' })
  })

  it('parses style for multiple nodes', () => {
    const g = parseMermaid('graph TD\n  A --> B\n  style A,B fill:#0f0')
    expect(g.nodeStyles.get('A')).toEqual({ fill: '#0f0' })
    expect(g.nodeStyles.get('B')).toEqual({ fill: '#0f0' })
  })

  it('merges multiple style statements for same node', () => {
    const g = parseMermaid('graph TD\n  A --> B\n  style A fill:#f00\n  style A stroke:#333')
    expect(g.nodeStyles.get('A')).toEqual({ fill: '#f00', stroke: '#333' })
  })
})

// ============================================================================
// Subgraph direction override (Batch 2.7)
// ============================================================================

describe('parseMermaid – subgraph direction override', () => {
  it('parses direction override inside subgraph', () => {
    const g = parseMermaid(`graph TD
      subgraph sub1 [Left-Right Group]
        direction LR
        A --> B
      end`)
    expect(g.subgraphs[0]!.direction).toBe('LR')
  })

  it('applies a root direction override to the graph', () => {
    const g = parseMermaid('graph TD\n  direction LR\n  A --> B')
    expect(g.direction).toBe('LR')
    expect([...g.nodes.keys()]).toEqual(['A', 'B'])
  })
})

// ============================================================================
// Subgraphs
// ============================================================================

describe('parseMermaid – subgraphs', () => {
  it('parses a basic subgraph', () => {
    const g = parseMermaid(`graph TD
      subgraph Backend
        A --> B
      end`)
    expect(g.subgraphs).toHaveLength(1)
    expect(g.subgraphs[0]!.label).toBe('Backend')
    expect(g.subgraphs[0]!.nodeIds).toContain('A')
    expect(g.subgraphs[0]!.nodeIds).toContain('B')
  })

  it('parses subgraph with bracket ID syntax: subgraph id [Label]', () => {
    const g = parseMermaid(`graph TD
      subgraph be [Backend Services]
        A --> B
      end`)
    expect(g.subgraphs[0]!.id).toBe('be')
    expect(g.subgraphs[0]!.label).toBe('Backend Services')
  })

  it('parses subgraph bracket syntax with hyphenated ID: subgraph us-east [US East]', () => {
    const g = parseMermaid(`graph TD
      subgraph us-east [US East Region]
        A --> B
      end`)
    expect(g.subgraphs[0]!.id).toBe('us-east')
    expect(g.subgraphs[0]!.label).toBe('US East Region')
  })

  it('slugifies label as id when bracket syntax is not used', () => {
    const g = parseMermaid(`graph TD
      subgraph My Group
        A --> B
      end`)
    expect(g.subgraphs[0]!.id).toBe('My_Group')
    expect(g.subgraphs[0]!.label).toBe('My Group')
  })

  // A subgraph id, written or a title upstream reads as one, follows the node
  // id rule, so a link to it ends at the subgraph rather than at a new node.
  // A markdown title's id is its text.
  it.each([
    ['a.b', 'a.b', 'a.b'],
    ['a.b[Title]', 'a.b', 'Title'],
    ['"a.b"', 'a.b', 'a.b'],
    ['a&b', 'a&b', 'a&b'],
    ['**Two**', '**Two**', '**Two**'],
    ['"`**Two**`"', '**Two**', '<b>Two</b>'],
  ])('reads `subgraph %s` with the id upstream reads, which a link names', (title, id, label) => {
    const source = `flowchart TD\n  subgraph ${title}\n    A\n  end\n  X --> ${id}`
    const parsed = parseRegisteredMermaid(source)
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) throw new Error('Expected the public subgraph source to parse')
    for (const g of [parseMermaid(source), parseMermaid(serializeMermaid(parsed.value))]) {
      expect(g.subgraphs.map(s => [s.id, s.label, s.nodeIds])).toEqual([[id, label, ['A']]])
      expect([...g.nodes.keys()]).toEqual(['A', 'X'])
      expect(g.edges.map(edge => [edge.source, edge.target])).toEqual([['X', id]])
    }
  })

  // A title that runs across lines joins them with `<br>`; neither that nor
  // an authored tag is id text.
  it.each(['"a<br>b"', '"a\nb"', '"a<br/>b"'])('slugifies the title %j with its line break as `_`', title => {
    const g = parseMermaid(`graph TD\n  subgraph ${title}\n    A\n  end`)
    expect(g.subgraphs[0]!.id).toBe('a_b')
    expect(g.subgraphs[0]!.label).toBe('a\nb')
  })

  it('parses nested subgraphs', () => {
    const g = parseMermaid(`graph TD
      subgraph Outer
        subgraph Inner
          A --> B
        end
        C --> D
      end`)
    expect(g.subgraphs).toHaveLength(1) // only top-level
    const outer = g.subgraphs[0]!
    expect(outer.label).toBe('Outer')
    expect(outer.children).toHaveLength(1)
    expect(outer.children[0]!.label).toBe('Inner')
    expect(outer.children[0]!.nodeIds).toContain('A')
    expect(outer.children[0]!.nodeIds).toContain('B')
    expect(outer.nodeIds).toContain('C')
    expect(outer.nodeIds).toContain('D')
  })

  it('treats bare references to declared subgraph ids as group endpoints', () => {
    const g = parseMermaid(`flowchart TB
      subgraph B
        c
      end
      a-->c
      subgraph A
        b-->B
        a
      end`)
    const a = g.subgraphs.find(s => s.id === 'A')
    expect(g.nodes.has('B')).toBe(false)
    // References collect membership independently of declaration order.
    expect(a?.nodeIds).toEqual(['b', 'a'])
    expect(g.subgraphs.map(s => s.id)).toEqual(['A'])
    expect(a?.children.map(s => s.id)).toEqual(['B'])
    expect(g.edges).toContainEqual(expect.objectContaining({ source: 'b', target: 'B' }))
  })

  it('collects known edge endpoints in their first owning subgraph before serialization', () => {
    const source = 'flowchart TB\nc1-->a2\nsubgraph one\na1-->a2\nend\nsubgraph three\nc1-->c2\nend'
    const members = (text: string) => parseMermaid(text).subgraphs.map(s => [s.id, [...s.nodeIds].sort()])
    const expected = [['one', ['a1', 'a2']], ['three', ['c1', 'c2']]]
    expect(members(source)).toEqual(expected)
    const parsed = parseRegisteredMermaid(source)
    if (!parsed.ok) throw new Error(JSON.stringify(parsed.error))
    expect(members(serializeMermaid(parsed.value))).toEqual(expected)
  })

  // Upstream's subgraph.spec.js "should handle nested subgraphs 2": ids alone
  // in a body list their nodes and subgraphs there, and the writer keeps it.
  it('lists the nodes and subgraphs a body names alone, even when known', () => {
    const source = `flowchart TB
    b-->B
    a-->c
    subgraph B
      c
    end
    subgraph A
        a
        b
        B
    end`
    const tree = (subgraphs: ReturnType<typeof parseMermaid>['subgraphs']): unknown[] =>
      subgraphs.map(s => ({ id: s.id, nodeIds: s.nodeIds, children: tree(s.children) }))
    const expected = [{ id: 'A', nodeIds: ['a', 'b'], children: [{ id: 'B', nodeIds: ['c'], children: [] }] }]
    expect(tree(parseMermaid(source).subgraphs)).toEqual(expected)
    const parsed = parseRegisteredMermaid(source)
    if (!parsed.ok) throw new Error(JSON.stringify(parsed.error))
    expect(tree(parseMermaid(serializeMermaid(parsed.value)).subgraphs)).toEqual(expected)
  })

  // Mermaid rejects a subgraph with no `end`; ours closes it at the end of
  // the source, with what it holds (verify reports flowchart_unclosed_subgraph).
  it('closes the subgraphs still open at the end of the source', () => {
    const g = parseMermaid('flowchart TB\n  subgraph S\n    A\n    subgraph T\n      B\n    end\n    C --> D')
    const tree = (subgraphs: typeof g.subgraphs): unknown[] =>
      subgraphs.map(s => ({ id: s.id, nodeIds: s.nodeIds, children: tree(s.children) }))
    expect(tree(g.subgraphs)).toEqual([{ id: 'S', nodeIds: ['A', 'C', 'D'], children: [{ id: 'T', nodeIds: ['B'], children: [] }] }])
  })

  it('nests a listed subgraph once, in the first lister to close, never in itself', () => {
    const tree = (source: string): unknown[] => {
      const walk = (subgraphs: ReturnType<typeof parseMermaid>['subgraphs']): unknown[] =>
        subgraphs.map(s => [s.id, ...walk(s.children)])
      return walk(parseMermaid(source).subgraphs)
    }
    // Listed before it is declared, as upstream nests it.
    expect(tree('flowchart TB\n  subgraph A\n    B\n  end\n  subgraph B\n    c\n  end')).toEqual([['A', ['B']]])
    // Two listers: the first to close keeps it.
    expect(tree('flowchart TB\n  subgraph X\n    x\n  end\n  subgraph P\n    X\n  end\n  subgraph Q\n    X\n  end'))
      .toEqual([['P', ['X']], ['Q']])
    // Each lists the other: upstream makes each the other's parent; ours nests once.
    expect(tree('flowchart TB\n  subgraph A\n    B\n  end\n  subgraph B\n    A\n  end')).toEqual([['A', ['B']]])
  })

  it('does NOT track nodes in subgraphs where they are merely referenced (regression)', () => {
    // This diagram has cross-subgraph edges:
    // - B is defined in "clients" but referenced in "services"
    // - D, E, F are defined in "services" but referenced in "data"
    // Nodes should only belong to the subgraph where they are FIRST DEFINED.
    const g = parseMermaid(`graph LR
      subgraph clients [Client Layer]
        A([Web App]) --> B[API Gateway]
        C([Mobile App]) --> B
      end
      subgraph services [Service Layer]
        B --> D[Auth Service]
        B --> E[User Service]
        B --> F[Order Service]
      end
      subgraph data [Data Layer]
        D --> G[(Auth DB)]
        E --> H[(User DB)]
        F --> I[(Order DB)]
        F --> J([Message Queue])
      end`)

    const clients = g.subgraphs.find(sg => sg.id === 'clients')!
    const services = g.subgraphs.find(sg => sg.id === 'services')!
    const data = g.subgraphs.find(sg => sg.id === 'data')!

    // B should ONLY be in clients (where it's defined), NOT in services
    expect(clients.nodeIds).toContain('B')
    expect(services.nodeIds).not.toContain('B')

    // D, E, F should ONLY be in services, NOT in data
    expect(services.nodeIds).toContain('D')
    expect(services.nodeIds).toContain('E')
    expect(services.nodeIds).toContain('F')
    expect(data.nodeIds).not.toContain('D')
    expect(data.nodeIds).not.toContain('E')
    expect(data.nodeIds).not.toContain('F')

    // Data layer should only have its own nodes
    expect(data.nodeIds).toContain('G')
    expect(data.nodeIds).toContain('H')
    expect(data.nodeIds).toContain('I')
    expect(data.nodeIds).toContain('J')
  })
})

// ============================================================================
// classDef and class assignments
// ============================================================================

describe('parseMermaid – classDef and class', () => {
  it('parses classDef with properties', () => {
    const g = parseMermaid(`graph TD
      classDef highlight fill:#f96,stroke:#333
      A --> B`)
    expect(g.classDefs.has('highlight')).toBe(true)
    const props = g.classDefs.get('highlight')!
    expect(props['fill']).toBe('#f96')
    expect(props['stroke']).toBe('#333')
  })

  it('parses class assignments to single node', () => {
    const g = parseMermaid(`graph TD
      A --> B
      class A highlight`)
    expect(g.classAssignments.get('A')).toBe('highlight')
  })

  it('parses class assignments to multiple nodes', () => {
    const g = parseMermaid(`graph TD
      A --> B --> C
      class A,B highlight`)
    expect(g.classAssignments.get('A')).toBe('highlight')
    expect(g.classAssignments.get('B')).toBe('highlight')
  })
})

// ============================================================================
// Comments
// ============================================================================

describe('parseMermaid – comments', () => {
  it('ignores lines starting with %%', () => {
    const g = parseMermaid(`graph TD
      %% This is a comment
      A --> B
      %% Another comment`)
    expect(g.nodes.size).toBe(2)
    expect(g.edges).toHaveLength(1)
  })
})

// ============================================================================
// Edge cases
// ============================================================================

describe('parseMermaid – edge cases', () => {
  it('handles extra whitespace', () => {
    const g = parseMermaid('  graph TD  \n    A  -->  B  ')
    expect(g.edges).toHaveLength(1)
    expect(g.nodes.size).toBe(2)
  })

  it('handles empty lines between definitions', () => {
    const g = parseMermaid('graph TD\n\n  A --> B\n\n  B --> C')
    expect(g.edges).toHaveLength(2)
  })

  it('handles diagram with only nodes (no edges)', () => {
    const g = parseMermaid('graph TD\n  A[Only Node]')
    expect(g.nodes.size).toBe(1)
    expect(g.edges).toHaveLength(0)
  })

  it('preserves node order in the map', () => {
    const g = parseMermaid('graph TD\n  Z[Last] --> A[First]')
    const ids = [...g.nodes.keys()]
    expect(ids[0]).toBe('Z')
    expect(ids[1]).toBe('A')
  })

  it.each([
    // Upstream rejects it too (property-upstream-flowchart.test.ts). Whether
    // `A--a` is an id or a link label is unclear, so ours rejects it.
    ['an id holding `--`', 'graph TD\n  A--a --> A--a', /"--a" opens a link label that no link closes/],
    // Upstream's edge text holds no `--` but the link that closes it, and its
    // lexer rejects one there.
    ['a link label holding `--`', 'graph TD\n  A -- x -- y --> B', /link label in "-- x -- y --> B" holds a `--` before the link that closes it/],
    // Upstream's id grammar takes a `,` into the id (`A,B` is one node);
    // ours reads none, since `style` and `class` read it as a separator.
    ['an id holding `,`', 'graph TD\n  A --> B,C', /upstream reads the "," before "C" as part of one node id/],
    ['an id starting with `,`', 'graph TD\n  ,A --> B', /upstream reads the "," before "A --> B" as part of one node id/],
    // Upstream's grammar has a subgraph with no id or title, which its DB
    // fails to read.
    // Upstream reads a link label with an `x` start and another end as a
    // link of no type.
    ['a link label with an `x` start and an arrow end', 'graph TD\n  A x--e1@--> B', /starts with an `x` marker and ends otherwise/],
    ['a subgraph with no title', 'graph TD\n  subgraph\n    A\n  end', /a subgraph needs an id or a title/],
  ])('names the construct when rejecting %s', (_construct, source, message) => {
    expect(() => parseMermaid(source)).toThrow(message)
  })

  // Mermaid rejects each of these, but what it means is clear, so ours reads
  // it, draws it, and verify reports it: a linkStyle index past the links
  // above it, a text-arrow label closed by a link of another stroke, a
  // space before or inside `@{`, an `end` with no subgraph open, and a
  // subgraph no `end` closes, which holds the rest of the source.
  // [construct, source, text the render draws, syntax verify reports, its line]
  const FLOWCHART_READ_GENEROUSLY: ReadonlyArray<readonly [string, string, string, string, number]> = [
    ['a linkStyle index that names no link', 'flowchart TD\n  A --> B\n  linkStyle 99 stroke:#ff0000', '>B<', 'flowchart_link_style_index', 3],
    ['a linkStyle before the link it styles', 'flowchart TD\n  linkStyle 0 stroke:#ff0000\n  A --> B', '#ff0000', 'flowchart_link_style_index', 2],
    ['a solid label closed by a thick link', 'flowchart LR\n  A -- b ==> B', '>b<', 'flowchart_mixed_link_label', 2],
    ['a dotted label closed by a solid link', 'flowchart LR\n  A-.b --> B', '>b<', 'flowchart_mixed_link_label', 2],
    ['a thick label closed by a solid link', 'flowchart LR\n  A == b --> B', '>b<', 'flowchart_mixed_link_label', 2],
    ['a space inside @{', 'flowchart LR\n  A@ {label: "Start"}', '>Start<', 'flowchart_metadata_spacing', 2],
    ['a space before @{', 'flowchart LR\n  A @{label: "Start"} --> B', '>Start<', 'flowchart_metadata_spacing', 2],
    ['a space between a shape and @{', 'flowchart LR\n  A[a] @{ label: b }', '>b<', 'flowchart_metadata_spacing', 2],
    ['an end with no subgraph open', 'flowchart LR\n  subgraph S\n    A\n  end\n  end', '>A<', 'flowchart_stray_end', 5],
    ['a statement after an end with no subgraph open', 'flowchart LR\n  end B --> C', '>C<', 'flowchart_stray_end', 2],
    ['a subgraph no end closes', 'flowchart LR\n  A\n  subgraph S[Stage]\n    B --> C', '>Stage<', 'flowchart_unclosed_subgraph', 3],
  ]

  it.each(FLOWCHART_READ_GENEROUSLY)('%s is read, drawn and reported', (_construct, source, drawn, syntax, line) => {
    const parsed = parseRegisteredMermaid(source)
    expect({
      typed: parsed.ok && parsed.value.body.kind,
      draws: renderMermaidSVG(source).includes(drawn),
      reported: verifyMermaid(source).warnings.flatMap(warning => warning.code === 'UNSUPPORTED_SYNTAX' ? [`${warning.syntax}@${warning.line}`] : []),
    }).toEqual({ typed: 'flowchart', draws: true, reported: expect.arrayContaining([`${syntax}@${line}`]) })
  })
})

// ============================================================================
// State diagram parsing (Batch 3)
// ============================================================================

describe('parseMermaid – state diagrams', () => {
  it('detects stateDiagram-v2 header', () => {
    const g = parseMermaid('stateDiagram-v2\n  s1 --> s2')
    expect(g.direction).toBe('TD')
  })

  it('detects stateDiagram header (without -v2)', () => {
    const g = parseMermaid('stateDiagram\n  s1 --> s2')
    expect(g.direction).toBe('TD')
  })

  it('parses basic state transitions', () => {
    const g = parseMermaid(`stateDiagram-v2
      Idle --> Active
      Active --> Done`)
    expect(g.edges).toHaveLength(2)
    expect(g.edges[0]!.source).toBe('Idle')
    expect(g.edges[0]!.target).toBe('Active')
    expect(g.edges[1]!.source).toBe('Active')
    expect(g.edges[1]!.target).toBe('Done')
    // State nodes default to rounded shape
    expect(g.nodes.get('Idle')!.shape).toBe('rounded')
  })

  it('parses transition labels', () => {
    const g = parseMermaid(`stateDiagram-v2
      Idle --> Active : start`)
    expect(g.edges[0]!.label).toBe('start')
  })

  it('parses [*] start pseudostate', () => {
    const g = parseMermaid(`stateDiagram-v2
      [*] --> Idle`)
    // [*] as source becomes _start with state-start shape
    const startNode = g.nodes.get('_start')
    expect(startNode).toBeDefined()
    expect(startNode!.shape).toBe('state-start')
    expect(g.edges[0]!.source).toBe('_start')
  })

  it('parses [*] end pseudostate', () => {
    const g = parseMermaid(`stateDiagram-v2
      Done --> [*]`)
    const endNode = g.nodes.get('_end')
    expect(endNode).toBeDefined()
    expect(endNode!.shape).toBe('state-end')
    expect(g.edges[0]!.target).toBe('_end')
  })

  it('shares a contextual start node across transitions in the same scope', () => {
    const g = parseMermaid(`stateDiagram-v2
      [*] --> A
      [*] --> B`)
    // Both references name the same initial node in this scope.
    expect(g.nodes.has('_start')).toBe(true)
    expect(g.nodes.has('_start2')).toBe(false)
    expect(g.edges[0]!.source).toBe(g.edges[1]!.source)
  })

  it('parses state description: s1 : Description', () => {
    const g = parseMermaid(`stateDiagram-v2
      s1 : Idle State
      s1 --> s2`)
    expect(g.nodes.get('s1')!.label).toBe('Idle State')
    expect(g.nodes.get('s1')!.shape).toBe('rounded')
  })

  it('consumes state ::: class shorthand without corrupting the visible label', () => {
    const g = parseMermaid(`stateDiagram-v2
      A : Alpha
      A:::urgent
      A --> B:::target
      classDef urgent fill:#f00
      classDef target fill:#0f0`)
    expect([...g.nodes.keys()]).toEqual(['A', 'B'])
    expect(g.nodes.get('A')!.label).toBe('Alpha')
    expect(g.nodes.get('B')!.label).toBe('B')
    expect(g.classAssignments.get('A')).toBe('urgent')
    expect(g.classAssignments.get('B')).toBe('target')
    expect(g.edges.map(edge => `${edge.source}->${edge.target}`)).toEqual(['A->B'])
  })

  it('parses state alias: state "Description" as s1', () => {
    const g = parseMermaid(`stateDiagram-v2
      state "Waiting for input" as waiting
      waiting --> active`)
    expect(g.nodes.get('waiting')!.label).toBe('Waiting for input')
  })

  it('parses composite states', () => {
    const g = parseMermaid(`stateDiagram-v2
      state Processing {
        parse --> validate
        validate --> execute
      }`)
    expect(g.subgraphs).toHaveLength(1)
    expect(g.subgraphs[0]!.id).toBe('Processing')
    expect(g.subgraphs[0]!.label).toBe('Processing')
    expect(g.subgraphs[0]!.nodeIds).toContain('parse')
    expect(g.subgraphs[0]!.nodeIds).toContain('validate')
    expect(g.subgraphs[0]!.nodeIds).toContain('execute')
  })

  it('a state belongs to the first composite or region that mentions it, and a transition reaches across', () => {
    type Group = { id: string; nodeIds: string[]; children: Group[] }
    const tree = (group: Group): string => `${group.id}(${group.nodeIds.join(',')})${group.children.length ? `{${group.children.map(tree).join(' ')}}` : ''}`
    for (const [source, groups] of [
      ['stateDiagram-v2\n  state B {\n    y\n  }\n  state A {\n    x --> y\n  }', 'B(y) A(x)'],
      ['stateDiagram-v2\n  state A {\n    x --> y\n  }\n  state B {\n    y\n  }', 'A(x,y) B()'],
      ['stateDiagram-v2\n  state A {\n    x\n    --\n    y\n  }\n  state B {\n    x --> z\n  }', 'A(){A__r1(x) A__r2(y)} B(z)'],
      ['stateDiagram-v2\n  state A {\n    x --> y\n    --\n    y --> z\n  }', 'A(){A__r1(x,y) A__r2(z)}'],
      // A top-level mention first places nothing, as in Mermaid.
      ['stateDiagram-v2\n  y\n  state A {\n    x --> y\n  }', 'A(x,y)'],
    ] as const) {
      expect({ source, groups: parseMermaid(source).subgraphs.map(tree).join(' ') }).toEqual({ source, groups })
      expect(() => renderMermaidSVG(source)).not.toThrow()
    }
  })

  it('a reopened composite state continues the one state and renders', () => {
    const members = (source: string) => {
      type Group = { id: string; nodeIds: string[]; children: Group[] }
      const tree = (group: Group): unknown => ({ id: group.id, nodeIds: group.nodeIds, children: group.children.map(tree) })
      expect(() => renderMermaidSVG(source)).not.toThrow()
      return parseMermaid(source).subgraphs.map(tree)
    }
    expect(members('stateDiagram-v2\n  [*] --> A\n  state A {\n    x --> y\n  }\n  state "Again" as A {\n    y --> z\n  }\n  A --> [*]'))
      .toEqual([{ id: 'A', nodeIds: ['x', 'y', 'z'], children: [] }])
    // Reopened inside another reopened parent, and continuing a region split.
    expect(members('stateDiagram-v2\n  state P {\n    state A {\n      x\n    }\n  }\n  state P {\n    state A {\n      w\n    }\n  }'))
      .toEqual([{ id: 'P', nodeIds: [], children: [{ id: 'A', nodeIds: ['x', 'w'], children: [] }] }])
    expect(members('stateDiagram-v2\n  state A {\n    a1 --> a2\n    --\n    b1\n  }\n  state A {\n    b2\n  }'))
      .toEqual([{ id: 'A', nodeIds: [], children: [{ id: 'A__r1', nodeIds: ['a1', 'a2'], children: [] }, { id: 'A__r2', nodeIds: ['b1', 'b2'], children: [] }] }])
    // One-line blocks reopen the same way.
    expect(members('stateDiagram-v2\n  state A { x }\n  state A { y }')).toEqual([{ id: 'A', nodeIds: ['x', 'y'], children: [] }])
    expect(members('stateDiagram-v2\nstate A { x }\nstate P { state A { y } }'))
      .toEqual([{ id: 'A', nodeIds: ['x', 'y'], children: [] }, { id: 'P', nodeIds: [], children: [] }])
    // A label in a later block, or a description or alias between blocks,
    // labels the one composite; a second label is another line of it, as a
    // description under a label is. The first block to set a direction keeps it.
    for (const between of ['A : Described', 'state "Described" as A']) {
      expect(parseMermaid(`stateDiagram-v2\n  state A {\n    x\n  }\n  ${between}\n  state A {\n    y\n  }`).subgraphs[0]!.label).toBe('Described')
    }
    expect(parseMermaid('stateDiagram-v2\n  state "Again" as A {\n    x\n  }\n  state "Later" as A {\n    y\n  }').subgraphs[0]!.label).toBe('Again\nLater')
    expect(parseMermaid('stateDiagram-v2\n  state A {\n    direction LR\n    x\n  }\n  state A {\n    direction TB\n    y\n  }').subgraphs[0]!.direction).toBe('LR')
    // Reopening continues a state at its depth in the tree, which the nesting
    // limit measures, however shallow each written block is.
    let chain = 'stateDiagram-v2\n  state S0 {\n    x\n  }'
    for (let i = 1; i <= DIAGRAM_WORK_LIMITS.nesting; i++) chain += `\n  state S${i - 1} {\n    state S${i} {\n      x${i}\n    }\n  }`
    expect(() => parseMermaid(chain)).toThrow(/nesting/)
  })

  it('parses composite states with alias', () => {
    const g = parseMermaid(`stateDiagram-v2
      state "Active Processing" as AP {
        inner1 --> inner2
      }`)
    expect(g.subgraphs[0]!.id).toBe('AP')
    expect(g.subgraphs[0]!.label).toBe('Active Processing')
  })

  it('parses direction override in state diagrams', () => {
    const g = parseMermaid(`stateDiagram-v2
      direction LR
      s1 --> s2`)
    expect(g.direction).toBe('LR')
  })

  it('parses direction override inside composite state', () => {
    const g = parseMermaid(`stateDiagram-v2
      state Processing {
        direction LR
        parse --> validate
      }`)
    expect(g.subgraphs[0]!.direction).toBe('LR')
  })

  it('parses CJK (Chinese) state names in transitions', () => {
    const g = parseMermaid(`stateDiagram-v2
      [*] --> 空闲
      空闲 --> 完成`)
    expect(g.edges).toHaveLength(2)
    expect(g.edges[0]!.target).toBe('空闲')
    expect(g.edges[1]!.source).toBe('空闲')
    expect(g.edges[1]!.target).toBe('完成')
    expect(g.nodes.get('空闲')!.shape).toBe('rounded')
  })

  it('parses CJK state names with transition labels', () => {
    const g = parseMermaid(`stateDiagram-v2
      空闲 --> 处理中 : 提交`)
    expect(g.edges[0]!.source).toBe('空闲')
    expect(g.edges[0]!.target).toBe('处理中')
    expect(g.edges[0]!.label).toBe('提交')
  })

  it('parses CJK state descriptions', () => {
    const g = parseMermaid(`stateDiagram-v2
      空闲 : 等待输入
      空闲 --> 完成`)
    expect(g.nodes.get('空闲')!.label).toBe('等待输入')
  })

  it('parses Japanese state names', () => {
    const g = parseMermaid(`stateDiagram-v2
      [*] --> 待機
      待機 --> 処理中 : 開始
      処理中 --> 完了`)
    expect(g.edges).toHaveLength(3)
    expect(g.nodes.has('待機')).toBe(true)
    expect(g.nodes.has('処理中')).toBe(true)
    expect(g.nodes.has('完了')).toBe(true)
  })

  it('handles full state diagram with start/end and composites', () => {
    const g = parseMermaid(`stateDiagram-v2
      [*] --> Idle
      Idle --> Processing : submit
      state Processing {
        parse --> validate
        validate --> execute
      }
      Processing --> Complete : done
      Complete --> [*]`)

    expect(g.nodes.has('_start')).toBe(true)
    expect(g.nodes.has('_end')).toBe(true)
    expect(g.nodes.has('Idle')).toBe(true)
    expect(g.nodes.has('Complete')).toBe(true)
    expect(g.subgraphs).toHaveLength(1)
    expect(g.subgraphs[0]!.id).toBe('Processing')
    // Should have transitions for: [*]→Idle, Idle→Processing, parse→validate,
    // validate→execute, Processing→Complete, Complete→[*]
    expect(g.edges).toHaveLength(6)
  })
})
