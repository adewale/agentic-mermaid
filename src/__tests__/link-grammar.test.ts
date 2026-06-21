// Mermaid link grammar: variable-length operators and the invisible link.
// The audit (docs/design/system/issue-26-audit.md) recorded these as parser gaps —
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

// A back edge (`C --> A` closing a cycle) classifies as `feedback`; it does not
// constrain forward rank distance. PR #54 bailed out of link-length honoring for
// the whole graph the moment any non-`primary-forward` edge appeared, so a
// lengthened forward edge inside a cycle was silently ignored. The forward
// sub-DAG still has a well-defined flow axis, so the lengthened link must push
// its target the requested extra ranks while the back edge re-routes cleanly.
describe('link length is honored across a feedback (back) edge', () => {
  const cyclic = (dir: string, op: string) =>
    `flowchart ${dir}\n  A[One] ${op} B[Two]\n  B --> C[Three]\n  C --> A`

  it('a lengthened forward edge still pushes its target despite a back edge (LR)', () => {
    const { layoutGraphSync } = require('../layout-engine.ts') as typeof import('../layout-engine.ts')
    const base = layoutGraphSync(parseMermaid(cyclic('LR', '-->')))
    const long = layoutGraphSync(parseMermaid(cyclic('LR', '---->')))
    const gap = (g: typeof base): number => {
      const a = g.nodes.find(n => n.id === 'A')!
      const b = g.nodes.find(n => n.id === 'B')!
      return b.x - (a.x + a.width)
    }
    expect(gap(long)).toBeGreaterThan(gap(base) + 40)
    expect(long.edges[0]!.routeCertificate?.routeClass).toBe('primary-forward')
    expect(long.edges[2]!.routeCertificate?.routeClass).toBe('feedback')
  })

  it('honors the extra rank in every direction and keeps verification clean', () => {
    for (const dir of ['LR', 'RL', 'TD', 'BT'] as const) {
      const base = verifyMermaid(cyclic(dir, '-->'))
      const long = verifyMermaid(cyclic(dir, '---->'))
      expect(long.ok).toBe(true)
      expect(long.warnings.filter(w => w.code.startsWith('ROUTE_'))).toEqual([])
      expect(long.warnings.filter(w => w.code === 'OFF_CANVAS')).toEqual([])
      const gapAB = (v: typeof long): number => {
        const a = v.layout.nodes.find(n => n.id === 'A')!
        const b = v.layout.nodes.find(n => n.id === 'B')!
        switch (dir) {
          case 'LR': return b.x - (a.x + a.w)
          case 'RL': return a.x - (b.x + b.w)
          case 'TD': return b.y - (a.y + a.h)
          default: return a.y - (b.y + b.h)
        }
      }
      expect(gapAB(long)).toBeGreaterThan(gapAB(base) + 40)
    }
  })
})

// Link length inside a subgraph: PR #54 bailed the moment a graph had any
// subgraph, so a lengthened link enclosed in a container was ignored and the
// container never widened to honor it. The forward sub-DAG inside the container
// has a well-defined flow axis, so the lengthened link must push its target the
// requested extra ranks AND the enclosing container box must grow to keep the
// moved nodes inside it.
describe('link length is honored inside a subgraph (container grows to fit)', () => {
  const enclosed = (dir: string, op: string) =>
    `flowchart ${dir}\n  subgraph S [Group]\n    A[One] ${op} B[Two]\n    B --> C[Three]\n  end`

  it('a lengthened link inside a container pushes its target and widens the box (LR)', () => {
    const base = verifyMermaid(enclosed('LR', '-->'))
    const long = verifyMermaid(enclosed('LR', '---->'))
    const gap = (v: typeof long): number => {
      const a = v.layout.nodes.find(n => n.id === 'A')!
      const b = v.layout.nodes.find(n => n.id === 'B')!
      return b.x - (a.x + a.w)
    }
    expect(gap(long)).toBeGreaterThan(gap(base) + 40)

    // The container must still enclose every member after the widening.
    const group = long.layout.groups.find(g => g.id === 'S')!
    for (const id of ['A', 'B', 'C']) {
      const n = long.layout.nodes.find(node => node.id === id)!
      expect(n.x).toBeGreaterThanOrEqual(group.x - 0.5)
      expect(n.x + n.w).toBeLessThanOrEqual(group.x + group.w + 0.5)
      expect(n.y).toBeGreaterThanOrEqual(group.y - 0.5)
      expect(n.y + n.h).toBeLessThanOrEqual(group.y + group.h + 0.5)
    }
    // and it must actually be wider than the base box (the link length took effect).
    const baseGroup = base.layout.groups.find(g => g.id === 'S')!
    expect(group.w).toBeGreaterThan(baseGroup.w + 40)
  })

  it('honors the extra rank in every direction inside a container with clean verification', () => {
    for (const dir of ['LR', 'RL', 'TD', 'BT'] as const) {
      const base = verifyMermaid(enclosed(dir, '-->'))
      const long = verifyMermaid(enclosed(dir, '---->'))
      expect(long.ok).toBe(true)
      expect(long.warnings.filter(w => w.code.startsWith('ROUTE_'))).toEqual([])
      expect(long.warnings.filter(w => w.code === 'OFF_CANVAS')).toEqual([])
      const gapAB = (v: typeof long): number => {
        const a = v.layout.nodes.find(n => n.id === 'A')!
        const b = v.layout.nodes.find(n => n.id === 'B')!
        switch (dir) {
          case 'LR': return b.x - (a.x + a.w)
          case 'RL': return a.x - (b.x + b.w)
          case 'TD': return b.y - (a.y + a.h)
          default: return a.y - (b.y + b.h)
        }
      }
      expect(gapAB(long)).toBeGreaterThan(gapAB(base) + 40)
    }
  })
})

// The last bucket of #32: links that CROSS a subgraph boundary — `cross-hierarchy`
// (node in one scope to a node in another) and `container` (an endpoint IS a
// subgraph). These set rank distance just like a plain forward link. A subgraph
// is laid out as a unit, so a boundary-crossing link moves the whole enclosing
// box rigidly rather than shearing one inner node out of it.
describe('link length is honored across subgraph boundaries', () => {
  const mainGap = (v: { layout: { nodes: any[]; groups: any[] } }, dir: string, aId: string, bId: string): number => {
    const find = (id: string) => v.layout.nodes.find(n => n.id === id) ?? v.layout.groups.find(g => g.id === id)
    const a = find(aId)!, b = find(bId)!
    switch (dir) {
      case 'LR': return b.x - (a.x + a.w)
      case 'RL': return a.x - (b.x + b.w)
      case 'TD': return b.y - (a.y + a.h)
      default: return a.y - (b.y + b.h)
    }
  }

  it('a cross-hierarchy link between two subgraphs pushes its target every direction', () => {
    const tpl = (dir: string, op: string) =>
      `flowchart ${dir}\n  subgraph S1\n    A[One]\n  end\n  subgraph S2\n    B[Two]\n  end\n  A ${op} B`
    for (const dir of ['LR', 'RL', 'TD', 'BT'] as const) {
      const base = verifyMermaid(tpl(dir, '-->'))
      const long = verifyMermaid(tpl(dir, '---->'))
      expect(long.ok).toBe(true)
      expect(long.warnings.filter(w => w.code.startsWith('ROUTE_'))).toEqual([])
      expect(long.warnings.filter(w => w.code === 'OFF_CANVAS')).toEqual([])
      expect(mainGap(long, dir, 'A', 'B')).toBeGreaterThan(mainGap(base, dir, 'A', 'B') + 40)
    }
    // route class is unchanged — still a cross-hierarchy link, just spaced further.
    const { layoutGraphSync } = require('../layout-engine.ts') as typeof import('../layout-engine.ts')
    const pos = layoutGraphSync(parseMermaid(tpl('LR', '---->')))
    expect(pos.edges[0]!.routeCertificate?.routeClass).toBe('cross-hierarchy')
  })

  it('a container link (subgraph → node) pushes its target every direction', () => {
    const tpl = (dir: string, op: string) =>
      `flowchart ${dir}\n  subgraph S1\n    A[One]\n  end\n  S1 ${op} T[End]`
    for (const dir of ['LR', 'RL', 'TD', 'BT'] as const) {
      const base = verifyMermaid(tpl(dir, '-->'))
      const long = verifyMermaid(tpl(dir, '---->'))
      expect(long.ok).toBe(true)
      expect(long.warnings.filter(w => w.code.startsWith('ROUTE_'))).toEqual([])
      expect(mainGap(long, dir, 'S1', 'T')).toBeGreaterThan(mainGap(base, dir, 'S1', 'T') + 40)
    }
    const { layoutGraphSync } = require('../layout-engine.ts') as typeof import('../layout-engine.ts')
    const pos = layoutGraphSync(parseMermaid(tpl('LR', '---->')))
    expect(pos.edges[0]!.routeCertificate?.routeClass).toBe('container')
  })

  it('a link crossing into a direction-override subgraph moves the whole box, not one node', () => {
    // mermaid#2509 shape: TB stacking inside an LR flow. The lengthened external
    // link must keep top/bottom stacked in the same column (the box moved as one).
    const layout = (op: string) => verifyMermaid(
      `flowchart LR\n  subgraph S2\n    direction TB\n    top[top] ${op} bottom[bottom]\n  end\n  outside ----> top`,
    )
    const long = layout('-->')
    expect(long.ok).toBe(true)
    const top = long.layout.nodes.find(n => n.id === 'top')!
    const bottom = long.layout.nodes.find(n => n.id === 'bottom')!
    const outside = long.layout.nodes.find(n => n.id === 'outside')!
    // Internal TB stacking survived the shove: bottom below top, same column.
    expect(bottom.y).toBeGreaterThan(top.y + top.h / 2)
    expect(Math.abs(bottom.x - top.x)).toBeLessThan(top.w)
    // And the external long link actually pushed the box well clear of `outside`.
    const base = verifyMermaid('flowchart LR\n  subgraph S2\n    direction TB\n    top[top] --> bottom[bottom]\n  end\n  outside --> top')
    const gap = (v: typeof long) => v.layout.nodes.find(n => n.id === 'top')!.x - (outside.x + outside.w)
    expect(top.x - (outside.x + outside.w)).toBeGreaterThan(gap(base) + 40)
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
