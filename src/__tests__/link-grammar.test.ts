// Mermaid link grammar: variable-length operators and the invisible link.
// The audit (docs/design/issue-26-audit.md) recorded these as parser gaps —
// `~~~` silently dropped, `---->` misparsed into a phantom `-` node, and
// `-..->`/`====>` dropped entirely. These tests pin the fix: every supported
// link length and the invisible link parse into a correct edge, render
// faithfully, and round-trip without corruption.
import { describe, expect, it } from 'bun:test'
import { parseMermaid } from '../parser.ts'
import { renderMermaidSVG } from '../index.ts'
import { parseMermaid as agentParse, serializeMermaid, verifyMermaid } from '../agent/index.ts'

function edges(src: string) {
  return parseMermaid(src).edges
}
function nodeIds(src: string) {
  return [...parseMermaid(src).nodes.keys()]
}
/** Canonical re-serialization of a flowchart through the agent round-trip. */
function serialized(src: string): string {
  const d = agentParse(src)
  if (!d.ok) throw new Error(`parse failed: ${JSON.stringify(d.error)}`)
  return serializeMermaid(d.value)
}

describe('invisible links (~~~)', () => {
  it('parses ~~~ as an edge with no endpoints dropped', () => {
    expect(nodeIds('flowchart LR\n  A ~~~ B')).toEqual(['A', 'B'])
    const e = edges('flowchart LR\n  A ~~~ B')
    expect(e.length).toBe(1)
    expect(e[0]!.style).toBe('invisible')
    expect(e[0]!.hasArrowEnd).toBe(false)
    expect(e[0]!.hasArrowStart).toBe(false)
  })

  it('renders the invisible link with no visible stroke', () => {
    const svg = renderMermaidSVG('flowchart LR\n  A ~~~ B')
    // Both node labels still render; the edge contributes no <path>/<line> stroke.
    expect(svg).toContain('>A<')
    expect(svg).toContain('>B<')
    const visiblePaths = svg.match(/class="edge"/g) ?? []
    expect(visiblePaths.length).toBe(0)
  })

  it('round-trips ~~~ as invisible, never as a solid line', () => {
    const out = serialized('flowchart LR\n  A ~~~ B')
    expect(out).toContain('~~~')
    expect(edges(out)[0]!.style).toBe('invisible')
  })
})

describe('variable-length links preserve style and direction', () => {
  const cases: Array<[string, 'solid' | 'dotted' | 'thick', boolean]> = [
    ['A --> B', 'solid', true],
    ['A ----> B', 'solid', true],
    ['A ------> B', 'solid', true],
    ['A --- B', 'solid', false],
    ['A ----- B', 'solid', false],
    ['A -.-> B', 'dotted', true],
    ['A -..-> B', 'dotted', true],
    ['A -...-> B', 'dotted', true],
    ['A -.- B', 'dotted', false],
    ['A ==> B', 'thick', true],
    ['A ====> B', 'thick', true],
    ['A === B', 'thick', false],
    ['A ===== B', 'thick', false],
  ]
  it.each(cases)('%s parses to one clean edge (no phantom node)', (link, style, arrow) => {
    const src = `flowchart LR\n  ${link}`
    expect(nodeIds(src)).toEqual(['A', 'B'])
    const e = edges(src)
    expect(e.length).toBe(1)
    expect(e[0]!.style).toBe(style)
    expect(e[0]!.hasArrowEnd).toBe(arrow)
    expect(e[0]!.source).toBe('A')
    expect(e[0]!.target).toBe('B')
  })
})

describe('link length is preserved through round-trip', () => {
  it.each([
    'flowchart LR\n  A ----> B',
    'flowchart LR\n  A -..-> B',
    'flowchart LR\n  A ====> B',
    'flowchart LR\n  A ~~~~ B',
  ])('%s re-serializes to the same operator length', src => {
    const op = src.split('  ')[1]!.trim().replace(/[AB ]/g, '')
    expect(serialized(src)).toContain(op)
  })

  it.each([
    ['flowchart LR\n  A -- No ----> B', '---->|No|', 3],
    ['flowchart LR\n  A -. Maybe ..-> B', '-..->|Maybe|', 2],
    ['flowchart LR\n  A -.. Maybe .-> B', '-..->|Maybe|', 2],
    ['flowchart LR\n  A == Sure ====> B', '====>|Sure|', 3],
    ['flowchart LR\n  A -- note ---- B', '----|note|', 2],
  ] as const)('text-embedded label length survives canonical serialization: %s', (src, op, length) => {
    const graph = parseMermaid(src)
    expect(graph.edges[0]!.length).toBe(length)
    const out = serialized(src)
    expect(out).toContain(op)
    expect(parseMermaid(out).edges[0]!.length).toBe(length)
  })

  it('base-form operators serialize byte-identically (no churn for length 1)', () => {
    for (const [src, op] of [
      ['flowchart LR\n  A --> B', '-->'],
      ['flowchart LR\n  A --- B', '---'],
      ['flowchart LR\n  A -.-> B', '-.->'],
      ['flowchart LR\n  A ==> B', '==>'],
    ] as const) {
      const out = serialized(src)
      expect(out).toContain(op)
      // a base solid arrow must NOT pick up extra dashes
      if (op === '-->') expect(out).not.toContain('--->')
    }
  })
})

describe('link length affects layout rank distance', () => {
  it('a longer LR arrow places the target farther away than a base arrow', () => {
    const { layoutGraphSync } = require('../layout-engine.ts') as typeof import('../layout-engine.ts')
    const base = layoutGraphSync(parseMermaid('flowchart LR\n  A[One] --> B[Two]'))
    const long = layoutGraphSync(parseMermaid('flowchart LR\n  A[One] ----> B[Two]'))
    const gap = (g: typeof base): number => {
      const a = g.nodes.find(n => n.id === 'A')!
      const b = g.nodes.find(n => n.id === 'B')!
      return b.x - (a.x + a.width)
    }
    expect(gap(long)).toBeGreaterThan(gap(base) + 40)
    expect(long.edges[0]!.routeCertificate?.routeClass).toBe('primary-forward')
  })

  it('long-link rank spacing keeps verification clean on a simple chain in every direction', () => {
    for (const dir of ['LR', 'RL', 'TD', 'BT'] as const) {
      const verify = verifyMermaid(`flowchart ${dir}\n  A ----> B\n  B --> C`)
      expect(verify.ok).toBe(true)
      expect(verify.warnings.filter(w => w.code.startsWith('ROUTE_'))).toEqual([])
      expect(verify.warnings.filter(w => w.code === 'OFF_CANVAS')).toEqual([])
      const a = verify.layout.nodes.find(n => n.id === 'A')!
      const b = verify.layout.nodes.find(n => n.id === 'B')!
      const c = verify.layout.nodes.find(n => n.id === 'C')!
      if (dir === 'LR') {
        expect(b.x).toBeGreaterThan(a.x + a.w + 80)
        expect(c.x).toBeGreaterThan(b.x + b.w)
      } else if (dir === 'RL') {
        expect(b.x + b.w).toBeLessThan(a.x - 80)
        expect(c.x + c.w).toBeLessThan(b.x)
      } else if (dir === 'TD') {
        expect(b.y).toBeGreaterThan(a.y + a.h + 80)
        expect(c.y).toBeGreaterThan(b.y + b.h)
      } else {
        expect(b.y + b.h).toBeLessThan(a.y - 80)
        expect(c.y + c.h).toBeLessThan(b.y)
      }
    }
  })
})

describe('variable-length links interact correctly with the straightener', () => {
  it('a long dotted arrow still straightens and keeps its dotted style', () => {
    const pos = parseMermaid('flowchart LR\n  A[One] -..-> B[Two]')
    const positioned = (require('../layout-engine.ts').layoutGraphSync)(pos)
    const e = positioned.edges[0]!
    expect(e.style).toBe('dotted')
    expect(e.points.length).toBe(2) // straight
  })
})
