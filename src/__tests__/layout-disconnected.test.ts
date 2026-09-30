/**
 * Integration tests for disconnected component layout.
 *
 * These tests verify that the full layout pipeline correctly handles
 * graphs with multiple disconnected components (subgraphs or nodes
 * with no edges connecting them).
 *
 * The key invariant: disconnected components should NEVER overlap.
 */
import { describe, it, expect } from 'bun:test'
import { renderMermaidSVG } from '../index.ts'
import { parseMermaid } from '../parser.ts'
import { layoutGraphSync } from '../layout-engine.ts'

// ============================================================================
// Test helpers
// ============================================================================

/** Check if two rectangles overlap */
function rectanglesOverlap(
  r1: { x: number; y: number; width: number; height: number },
  r2: { x: number; y: number; width: number; height: number }
): boolean {
  return !(
    r1.x + r1.width <= r2.x ||   // r1 is left of r2
    r2.x + r2.width <= r1.x ||   // r2 is left of r1
    r1.y + r1.height <= r2.y ||  // r1 is above r2
    r2.y + r2.height <= r1.y     // r2 is above r1
  )
}

/** Get bounding box from positioned elements */
function getBoundingBox(items: Array<{ x: number; y: number; width: number; height: number }>) {
  if (items.length === 0) return { x: 0, y: 0, width: 0, height: 0 }

  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  for (const item of items) {
    minX = Math.min(minX, item.x)
    minY = Math.min(minY, item.y)
    maxX = Math.max(maxX, item.x + item.width)
    maxY = Math.max(maxY, item.y + item.height)
  }

  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY }
}

type Box = { x: number; y: number; width: number; height: number }

/** How two boxes sit relative to each other: side by side (x ranges disjoint,
 *  y ranges shared), stacked (the reverse), or anything else. */
function arrangement(a: Box, b: Box): 'side-by-side' | 'stacked' | 'other' {
  const xDisjoint = a.x + a.width <= b.x || b.x + b.width <= a.x
  const yDisjoint = a.y + a.height <= b.y || b.y + b.height <= a.y
  if (xDisjoint && !yDisjoint) return 'side-by-side'
  if (yDisjoint && !xDisjoint) return 'stacked'
  return 'other'
}

// ============================================================================
// Two disconnected subgraphs (the original bug)
// ============================================================================

describe('layoutGraph – two disconnected subgraphs', () => {
  it('renders without overlap in LR direction', () => {
    const source = `graph LR
      subgraph Today [Today]
        A[AI Response] --> B[Markdown]
        B --> C[User reads]
        C --> D[User acts]
      end

      subgraph Tomorrow [Next Wave]
        E[AI Response] --> F[Widget]
        F --> G[User acts]
      end`

    const parsed = parseMermaid(source)
    const result = layoutGraphSync(parsed)

    // Find the two top-level groups
    const today = result.groups.find(g => g.label === 'Today')
    const tomorrow = result.groups.find(g => g.label === 'Next Wave')

    expect(today).toBeDefined()
    expect(tomorrow).toBeDefined()

    // They should NOT overlap
    expect(rectanglesOverlap(today!, tomorrow!)).toBe(false)
  })

  it('renders without overlap in TD direction', () => {
    const source = `graph TD
      subgraph Today [Today]
        A --> B --> C
      end

      subgraph Tomorrow [Tomorrow]
        D --> E --> F
      end`

    const parsed = parseMermaid(source)
    const result = layoutGraphSync(parsed)

    const today = result.groups.find(g => g.label === 'Today')
    const tomorrow = result.groups.find(g => g.label === 'Tomorrow')

    expect(today).toBeDefined()
    expect(tomorrow).toBeDefined()
    expect(rectanglesOverlap(today!, tomorrow!)).toBe(false)
  })

  it('respects direction for stacking (LR = vertical)', () => {
    // Perpendicular stacking: LR flows horizontally → stack vertically
    const source = `graph LR
      subgraph S1 [First]
        A --> B
      end
      subgraph S2 [Second]
        C --> D
      end`

    const parsed = parseMermaid(source)
    const result = layoutGraphSync(parsed)

    const s1 = result.groups.find(g => g.label === 'First')!
    const s2 = result.groups.find(g => g.label === 'Second')!

    // In LR mode, subgraphs should be stacked vertically (perpendicular to flow)
    expect(arrangement(s1, s2)).toBe('stacked')
  })

  it('respects direction for stacking (TD = horizontal)', () => {
    // Perpendicular stacking: TD flows vertically → stack horizontally
    const source = `graph TD
      subgraph S1 [First]
        A --> B
      end
      subgraph S2 [Second]
        C --> D
      end`

    const parsed = parseMermaid(source)
    const result = layoutGraphSync(parsed)

    const s1 = result.groups.find(g => g.label === 'First')!
    const s2 = result.groups.find(g => g.label === 'Second')!

    // In TD mode, subgraphs should sit side by side (perpendicular to flow)
    expect(arrangement(s1, s2)).toBe('side-by-side')
  })
})

// ============================================================================
// Three+ disconnected components
// ============================================================================

describe('layoutGraph – multiple disconnected components', () => {
  it('renders three disconnected subgraphs without overlap', () => {
    const source = `graph LR
      subgraph A [Alpha]
        A1 --> A2
      end
      subgraph B [Beta]
        B1 --> B2
      end
      subgraph C [Gamma]
        C1 --> C2
      end`

    const parsed = parseMermaid(source)
    const result = layoutGraphSync(parsed)

    const alpha = result.groups.find(g => g.label === 'Alpha')!
    const beta = result.groups.find(g => g.label === 'Beta')!
    const gamma = result.groups.find(g => g.label === 'Gamma')!

    // No pair should overlap
    expect(rectanglesOverlap(alpha, beta)).toBe(false)
    expect(rectanglesOverlap(beta, gamma)).toBe(false)
    expect(rectanglesOverlap(alpha, gamma)).toBe(false)
  })

  it('renders five disconnected nodes without overlap', () => {
    // Five completely isolated nodes
    const source = `graph LR
      A[Node A]
      B[Node B]
      C[Node C]
      D[Node D]
      E[Node E]`

    const parsed = parseMermaid(source)
    const result = layoutGraphSync(parsed)

    // All nodes should exist
    expect(result.nodes.length).toBe(5)

    // No pair of nodes should overlap
    for (let i = 0; i < result.nodes.length; i++) {
      for (let j = i + 1; j < result.nodes.length; j++) {
        const overlap = rectanglesOverlap(result.nodes[i]!, result.nodes[j]!)
        expect(
          overlap,
          `Nodes ${result.nodes[i]!.id} and ${result.nodes[j]!.id} overlap`
        ).toBe(false)
      }
    }
  })
})

// ============================================================================
// Mixed: connected + disconnected
// ============================================================================

describe('layoutGraph – mixed connected and disconnected', () => {
  it('renders two connected subgraphs + one disconnected', () => {
    const source = `graph LR
      subgraph Frontend [Frontend]
        FE1 --> FE2
      end
      subgraph Backend [Backend]
        BE1 --> BE2
      end
      subgraph Isolated [Isolated]
        I1 --> I2
      end
      FE2 --> BE1`

    const parsed = parseMermaid(source)
    const result = layoutGraphSync(parsed)

    const frontend = result.groups.find(g => g.label === 'Frontend')!
    const backend = result.groups.find(g => g.label === 'Backend')!
    const isolated = result.groups.find(g => g.label === 'Isolated')!

    // None should overlap
    expect(rectanglesOverlap(frontend, backend)).toBe(false)
    expect(rectanglesOverlap(backend, isolated)).toBe(false)
    expect(rectanglesOverlap(frontend, isolated)).toBe(false)
  })

  it('renders connected nodes + isolated node', () => {
    const source = `graph LR
      A --> B --> C
      D[Isolated]`

    const parsed = parseMermaid(source)
    const result = layoutGraphSync(parsed)

    expect(result.nodes.map(n => n.id).sort()).toEqual(['A', 'B', 'C', 'D'])

    // The isolated node is its own component; no two nodes overlap
    const overlapping: string[] = []
    for (let i = 0; i < result.nodes.length; i++) {
      for (let j = i + 1; j < result.nodes.length; j++) {
        if (rectanglesOverlap(result.nodes[i]!, result.nodes[j]!)) overlapping.push(`${result.nodes[i]!.id}/${result.nodes[j]!.id}`)
      }
    }
    expect(overlapping).toEqual([])
  })
})

// ============================================================================
// Layout quality preservation
// ============================================================================

describe('layoutGraph – quality preservation', () => {
  it('each component looks identical to standalone rendering', () => {
    // Render a single subgraph standalone
    const standalone = `graph LR
      subgraph S [Section]
        A --> B --> C
      end`

    const standaloneParsed = parseMermaid(standalone)
    const standaloneResult = layoutGraphSync(standaloneParsed)

    // Render the same subgraph as part of a disconnected graph
    const combined = `graph LR
      subgraph S [Section]
        A --> B --> C
      end
      subgraph Other [Other]
        X --> Y
      end`

    const combinedParsed = parseMermaid(combined)
    const combinedResult = layoutGraphSync(combinedParsed)

    // The "Section" group should have the same dimensions
    const standaloneGroup = standaloneResult.groups.find(g => g.label === 'Section')!
    const combinedGroup = combinedResult.groups.find(g => g.label === 'Section')!

    expect(combinedGroup.width).toBe(standaloneGroup.width)
    expect(combinedGroup.height).toBe(standaloneGroup.height)
  })
})

// ============================================================================
// Edge cases
// ============================================================================

describe('layoutGraph – disconnected edge cases', () => {
  it('handles empty subgraph with disconnected nodes', () => {
    const source = `graph LR
      subgraph Empty
      end
      A --> B`

    const parsed = parseMermaid(source)
    const result = layoutGraphSync(parsed)

    expect(result.groups.length).toBe(1)
    expect(result.nodes.length).toBe(2)
  })

  it('handles subgraph containing entire component', () => {
    const source = `graph LR
      subgraph Component1
        A --> B --> C
      end
      D --> E`

    const parsed = parseMermaid(source)
    const result = layoutGraphSync(parsed)

    const group = result.groups.find(g => g.label === 'Component1')!
    const nodeD = result.nodes.find(n => n.id === 'D')!
    const nodeE = result.nodes.find(n => n.id === 'E')!

    // Group and D/E nodes should not overlap
    expect(rectanglesOverlap(group, nodeD)).toBe(false)
    expect(rectanglesOverlap(group, nodeE)).toBe(false)
  })
})

// ============================================================================
// Full render tests (SVG output)
// ============================================================================

describe('renderMermaidSVG – disconnected components', () => {
  it('renders two disconnected subgraphs to valid SVG', () => {
    const source = `graph LR
      subgraph Today [Today]
        A --> B
      end
      subgraph Tomorrow [Tomorrow]
        C --> D
      end`

    const svg = renderMermaidSVG(source)

    expect(svg).toContain('<svg')
    expect(svg).toContain('</svg>')
    expect(svg).toContain('>Today</text>')
    expect(svg).toContain('>Tomorrow</text>')
    expect(svg).toContain('>A</text>')
    expect(svg).toContain('>B</text>')
    expect(svg).toContain('>C</text>')
    expect(svg).toContain('>D</text>')
  })

  it('renders isolated nodes to valid SVG', () => {
    const source = `graph LR
      A[First]
      B[Second]
      C[Third]`

    const svg = renderMermaidSVG(source)

    expect(svg).toContain('<svg')
    expect(svg).toContain('</svg>')
    expect(svg).toContain('>First</text>')
    expect(svg).toContain('>Second</text>')
    expect(svg).toContain('>Third</text>')
  })
})
