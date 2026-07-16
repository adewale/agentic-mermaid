// State pseudostates (plan §State 2; repo #118 state half).
//
// (a) `[H]` history transitions must survive parse (they vanished silently) —
//     preserved transition + Tier-3 warning at minimum; this implementation
//     also RENDERS the standard (H)/(H*) circle (Feature(beyond): upstream only
//     has open PR #5700).
// (b) `<<fork>>`/`<<join>>` render as bars, `<<choice>>` as a diamond —
//     upstream's own rendering has been broken since 2021 (#2514).
// (c) `--` concurrency separators split composite regions and render dashed
//     separators instead of merging the regions.
// Invariant gates: fork bar spans its outgoing lanes; region separators sit
// strictly between the region boxes.

import { describe, test, expect } from 'bun:test'
import { parseMermaid as parseLegacy } from '../parser.ts'
import { layoutGraphSync } from '../layout-engine.ts'
import { renderMermaidSVG } from '../index.ts'
import { parseRegisteredMermaid as parseMermaid } from '../agent/parse.ts'
import { serializeMermaid } from '../agent/serialize.ts'
import { verifyMermaid } from '../agent/verify.ts'
import { asState } from '../agent/types.ts'

const FORK_SRC = `stateDiagram-v2
  state fork1 <<fork>>
  state join1 <<join>>
  state choice1 <<choice>>
  [*] --> fork1
  fork1 --> A
  fork1 --> B
  A --> join1
  B --> join1
  join1 --> choice1
  choice1 --> C : yes
  choice1 --> D : no
`

const HISTORY_SRC = `stateDiagram-v2
  [*] --> Working
  Working --> Paused
  Paused --> Working[H]
  Working --> [*]
`

const CONC_SRC = `stateDiagram-v2
  [*] --> Active
  state Active {
    [*] --> NumLockOff
    NumLockOff --> NumLockOn : EvNumLockPressed
    --
    [*] --> CapsLockOff
    CapsLockOff --> CapsLockOn : EvCapsLockPressed
  }
`

// ---------------------------------------------------------------------------
describe('fork / join / choice — parse + render', () => {
  test('stereotype declarations set dedicated shapes (not plain boxes)', () => {
    const graph = parseLegacy(FORK_SRC)
    expect(graph.nodes.get('fork1')?.shape).toBe('state-fork')
    expect(graph.nodes.get('join1')?.shape).toBe('state-join')
    expect(graph.nodes.get('choice1')?.shape).toBe('state-choice')
    // Bars and choice diamonds carry no visible label text.
    expect(graph.nodes.get('fork1')?.label).toBe('')
    expect(graph.nodes.get('choice1')?.label).toBe('')
  })

  test('declaration order does not matter (transition-first still upgrades the shape)', () => {
    const graph = parseLegacy(`stateDiagram-v2
  [*] --> f1
  state f1 <<fork>>
  f1 --> A
`)
    expect(graph.nodes.get('f1')?.shape).toBe('state-fork')
  })

  test('fork bar is a bar (wide and thin in TB) and spans its outgoing lanes', () => {
    const p = layoutGraphSync(parseLegacy(FORK_SRC))
    const bar = p.nodes.find(n => n.id === 'fork1')!
    expect(bar.width).toBeGreaterThan(bar.height * 3)
    for (const e of p.edges.filter(e => e.source === 'fork1')) {
      const start = e.points[0]!
      expect(start.x).toBeGreaterThanOrEqual(bar.x - 1)
      expect(start.x).toBeLessThanOrEqual(bar.x + bar.width + 1)
    }
  })

  test('SVG: bars render filled, choice renders as a diamond polygon', () => {
    const svg = renderMermaidSVG(FORK_SRC)
    expect(svg).toContain('data-shape="state-fork"')
    expect(svg).toContain('data-shape="state-join"')
    const choice = svg.split('\n').find(l => l.includes('data-shape="state-choice"'))
    expect(choice).toBeDefined()
    expect(svg).toMatch(/data-shape="state-choice"[\s\S]{0,400}?<polygon/)
  })

  test('agent body models stereotypes structured (no opaque fallback)', () => {
    const r = parseMermaid(FORK_SRC)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const d = asState(r.value)
    expect(d).not.toBeNull()
    if (!d) return
    expect(d.body.states.find(s => s.id === 'fork1')?.stereotype).toBe('fork')
    expect(d.body.states.find(s => s.id === 'join1')?.stereotype).toBe('join')
    expect(d.body.states.find(s => s.id === 'choice1')?.stereotype).toBe('choice')
    const s1 = serializeMermaid(d)
    expect(s1).toContain('state fork1 <<fork>>')
    const r2 = parseMermaid(s1)
    expect(r2.ok).toBe(true)
    if (r2.ok) expect(serializeMermaid(r2.value)).toBe(s1)
  })
})

// ---------------------------------------------------------------------------
describe('history pseudostates — [H] endpoints and <<history>> declarations', () => {
  test('a [H] transition SURVIVES parse (was silently dropped)', () => {
    const graph = parseLegacy(HISTORY_SRC)
    expect(graph.edges.some(e => e.source === 'Paused' && e.target === 'Working[H]')).toBe(true)
    const h = graph.nodes.get('Working[H]')
    expect(h?.shape).toBe('state-history')
    expect(h?.label).toBe('H')
  })

  test('deep history [H*] carries the H* label', () => {
    const graph = parseLegacy(`stateDiagram-v2
  A --> B[H*]
`)
    expect(graph.nodes.get('B[H*]')?.label).toBe('H*')
    expect(graph.nodes.get('B[H*]')?.shape).toBe('state-history')
  })

  test('PR #5700 declaration forms parse: <<history>> / <<H>> / <<deephistory>> / <<H*>>', () => {
    const graph = parseLegacy(`stateDiagram-v2
  state h1 <<history>>
  state h2 <<H>>
  state d1 <<deephistory>>
  state d2 <<H*>>
  A --> h1
`)
    expect(graph.nodes.get('h1')?.shape).toBe('state-history')
    expect(graph.nodes.get('h2')?.label).toBe('H')
    expect(graph.nodes.get('d1')?.label).toBe('H*')
    expect(graph.nodes.get('d2')?.label).toBe('H*')
  })

  test('verify announces history with a Tier-3 warning and stays ok', () => {
    const v = verifyMermaid(HISTORY_SRC)
    const w = v.warnings.find(w => w.code === 'UNSUPPORTED_SYNTAX' && w.syntax === 'state_history')
    expect(w).toBeDefined()
    expect(v.ok).toBe(true)
  })

  test('agent body preserves the [H] endpoint and round-trips', () => {
    const r = parseMermaid(HISTORY_SRC)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const d = asState(r.value)
    expect(d).not.toBeNull()
    if (!d) return
    expect(d.body.transitions).toContainEqual({ from: 'Paused', to: 'Working[H]' })
    const s1 = serializeMermaid(d)
    expect(s1).toContain('Paused --> Working[H]')
    const r2 = parseMermaid(s1)
    expect(r2.ok).toBe(true)
    if (r2.ok) expect(serializeMermaid(r2.value)).toBe(s1)
  })

  test('history renders as a circle containing H', () => {
    const svg = renderMermaidSVG(HISTORY_SRC)
    expect(svg).toContain('data-shape="state-history"')
    expect(svg).toMatch(/data-shape="state-history"[\s\S]{0,400}?<circle/)
    expect(svg).toMatch(/>H</)
  })
})

// ---------------------------------------------------------------------------
describe('concurrency regions (--) — split, contain, and separate', () => {
  test('regions parse as concurrency-region subgraphs instead of merging', () => {
    const graph = parseLegacy(CONC_SRC)
    const active = graph.subgraphs.find(sg => sg.id === 'Active')!
    expect(active.children.length).toBe(2)
    expect(active.children.every(c => c.concurrencyRegion === true)).toBe(true)
    const [r1, r2] = active.children
    expect(r1!.nodeIds).toContain('NumLockOff')
    expect(r1!.nodeIds).toContain('NumLockOn')
    expect(r2!.nodeIds).toContain('CapsLockOff')
    expect(r2!.nodeIds).toContain('CapsLockOn')
    // The composite's own direct members all live in regions now.
    expect(active.nodeIds).toEqual([])
  })

  test('regions lay out disjointly inside the composite', () => {
    const p = layoutGraphSync(parseLegacy(CONC_SRC))
    const active = p.groups.find(g => g.id === 'Active')!
    expect(active.children.length).toBe(2)
    const [a, b] = active.children
    const xo = Math.min(a!.x + a!.width, b!.x + b!.width) - Math.max(a!.x, b!.x)
    const yo = Math.min(a!.y + a!.height, b!.y + b!.height) - Math.max(a!.y, b!.y)
    expect(Math.min(xo, yo)).toBeLessThanOrEqual(0)
    // Containment: both regions inside the composite box.
    for (const r of [a!, b!]) {
      expect(r.x).toBeGreaterThanOrEqual(active.x - 0.5)
      expect(r.y).toBeGreaterThanOrEqual(active.y - 0.5)
      expect(r.x + r.width).toBeLessThanOrEqual(active.x + active.width + 0.5)
      expect(r.y + r.height).toBeLessThanOrEqual(active.y + active.height + 0.5)
    }
  })

  test('SVG: a dashed separator is drawn between regions, no region boxes', () => {
    const svg = renderMermaidSVG(CONC_SRC)
    const sep = svg.match(/<line class="region-separator"[^>]*>/)
    expect(sep).not.toBeNull()
    expect(sep![0]).toContain('stroke-dasharray')
    // Regions draw no header band of their own (only the composite's).
    expect(svg).not.toContain('data-id="Active__r1" data-region="subgraph"')
  })

  test('the separator line sits strictly between the two region boxes', () => {
    const p = layoutGraphSync(parseLegacy(CONC_SRC))
    const [a, b] = p.groups.find(g => g.id === 'Active')!.children
    const svg = renderMermaidSVG(CONC_SRC)
    const m = svg.match(/<line class="region-separator" x1="([\d.]+)" y1="([\d.]+)" x2="([\d.]+)" y2="([\d.]+)"/)
    expect(m).not.toBeNull()
    const x1 = Number(m![1]), x2 = Number(m![3])
    if (Math.abs(x1 - x2) < 0.01) {
      // Vertical separator between side-by-side regions.
      const lo = Math.min(a!.x + a!.width, b!.x + b!.width)
      const hi = Math.max(a!.x, b!.x)
      expect(x1).toBeGreaterThanOrEqual(lo - 0.5)
      expect(x1).toBeLessThanOrEqual(hi + 0.5)
    } else {
      const y1 = Number(m![2])
      const lo = Math.min(a!.y + a!.height, b!.y + b!.height)
      const hi = Math.max(a!.y, b!.y)
      expect(y1).toBeGreaterThanOrEqual(lo - 0.5)
      expect(y1).toBeLessThanOrEqual(hi + 0.5)
    }
  })

  test('three regions yield two separators', () => {
    const svg = renderMermaidSVG(`stateDiagram-v2
  state S {
    a1 --> a2
    --
    b1 --> b2
    --
    c1 --> c2
  }
`)
    expect(svg.match(/class="region-separator"/g)?.length).toBe(2)
  })

  test('agent body models concurrency regions and round-trips them stably', () => {
    const r = parseMermaid(CONC_SRC)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.value.body.kind).toBe('state')
    if (r.value.body.kind === 'state') expect(r.value.body.states.find(state => state.id === 'Active')?.regions).toHaveLength(2)
    expect(verifyMermaid(r.value).warnings.some(w => w.code === 'UNSUPPORTED_SYNTAX' && 'syntax' in w && w.syntax === 'state_opaque')).toBe(false)
    const canonical = serializeMermaid(r.value)
    const reparsed = parseMermaid(canonical)
    expect(reparsed.ok).toBe(true)
    if (reparsed.ok) expect(serializeMermaid(reparsed.value)).toBe(canonical)
  })
})

// Readability-audit finding: a QUOTED alias label on a pseudostate
// (`state "Fan out" as f1 <<fork>>`) is author-written display text, but
// bars/diamonds/H-circles are anonymous glyphs (UML + upstream) and carry no
// text. P4: the dropped label must be announced, never silently invisible.
describe('pseudostate alias labels are announced, not silently invisible', () => {
  const SRC = `stateDiagram-v2
  state "Fan out" as f1 <<fork>>
  state "Pick one" as c1 <<choice>>
  [*] --> f1
  f1 --> A
  f1 --> c1
  c1 --> B : yes
`

  test('verify names each pseudostate whose label will not be drawn', () => {
    const v = verifyMermaid(SRC)
    expect(v.ok).toBe(true)
    const dropped = v.warnings.filter(w => w.code === 'UNSUPPORTED_SYNTAX' && (w as { syntax?: string }).syntax === 'state_pseudostate_label')
    expect(dropped.map(w => (w as { node?: string }).node).sort()).toEqual(['c1', 'f1'])
    expect((dropped[0] as { message: string }).message).toContain('"Fan out"')
  })

  test('the glyphs still render anonymous and the label survives round-trip', () => {
    const svg = renderMermaidSVG(SRC)
    expect(/<text[^>]*>[^<]*Fan out/.test(svg)).toBe(false)
    const r = parseMermaid(SRC)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(serializeMermaid(r.value)).toContain('state "Fan out" as f1 <<fork>>')
  })

  test('unlabeled pseudostates stay lint-free', () => {
    const v = verifyMermaid('stateDiagram-v2\n  state f2 <<fork>>\n  [*] --> f2\n  f2 --> A')
    expect(v.warnings.filter(w => (w as { syntax?: string }).syntax === 'state_pseudostate_label')).toEqual([])
  })
})
