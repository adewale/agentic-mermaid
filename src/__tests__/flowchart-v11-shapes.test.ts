/**
 * Mermaid v11.3+ typed-shape vocabulary (repo #44; plan §Flowchart).
 *
 * Contract:
 *  - EVERY documented `@{ shape: ... }` short name and alias (table fetched
 *    from https://mermaid.js.org/syntax/flowchart.html, 2026-07-10) normalizes
 *    through ONE table (src/flowchart-shapes.ts) to a semantic shape id plus a
 *    rendering geometry (an existing NodeShape);
 *  - exact-equivalent names (rect, rounded, stadium, cyl, diam, hex, lean-r,
 *    lean-l, trap-b, trap-t, circle, dbl-circ, fr-rect, odd, sm-circ) render
 *    the SAME geometry as the legacy bracket syntax and emit NO warning;
 *  - approximate names render the documented nearest geometry and emit a
 *    Tier-3 UNSUPPORTED_SYNTAX `flowchart_shape_substitution` lint naming the
 *    substitution (never UNKNOWN_SHAPE for a documented name);
 *  - the agent body is STRUCTURED for shape/label metadata, serialization
 *    keeps the authored spelling, and round-trip is byte-stable;
 *  - undocumented shape names and icon/img metadata keep today's opaque
 *    fallback + flowchart_node_metadata lint.
 */
import { describe, it, expect } from 'bun:test'

import { parseMermaid as parseGraph } from '../parser.ts'
import { renderMermaidSVG } from '../index.ts'
import { asFlowchart, mutate, parseRegisteredMermaid as parseMermaid, serializeMermaid, verifyMermaid } from '../agent/index.ts'
import { FLOWCHART_V11_SHAPES, normalizeV11Shape } from '../flowchart-shapes.ts'

function parseAgent(source: string) {
  const parsed = parseMermaid(source)
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.error))
  return parsed.value
}

const metaSource = (shape: string) => `flowchart TD\n  A@{ shape: ${shape}, label: "X" }\n  A --> B\n`

// The documented vocabulary, straight from the upstream shape table
// (issue #44 carries the same list). canonical → aliases.
const DOCUMENTED: Record<string, string[]> = {
  'bang': [],
  'notch-rect': ['card', 'notched-rectangle'],
  'cloud': [],
  'hourglass': ['collate'],
  'bolt': ['com-link', 'lightning-bolt'],
  'brace': ['brace-l', 'comment'],
  'brace-r': [],
  'braces': [],
  'lean-r': ['in-out', 'lean-right'],
  'lean-l': ['lean-left', 'out-in'],
  'datastore': ['data-store'],
  'cyl': ['cylinder', 'database', 'db'],
  'diam': ['decision', 'diamond', 'question'],
  'delay': ['half-rounded-rectangle'],
  'h-cyl': ['das', 'horizontal-cylinder'],
  'lin-cyl': ['disk', 'lined-cylinder'],
  'curv-trap': ['curved-trapezoid', 'display'],
  'div-rect': ['div-proc', 'divided-process', 'divided-rectangle'],
  'doc': ['document'],
  'rounded': ['event'],
  'tri': ['extract', 'triangle'],
  'fork': ['join'],
  'win-pane': ['internal-storage', 'window-pane'],
  'f-circ': ['filled-circle', 'junction'],
  'lin-doc': ['lined-document'],
  'lin-rect': ['lin-proc', 'lined-process', 'lined-rectangle', 'shaded-process'],
  'notch-pent': ['loop-limit', 'notched-pentagon'],
  'flip-tri': ['flipped-triangle', 'manual-file'],
  'sl-rect': ['manual-input', 'sloped-rectangle'],
  'trap-t': ['inv-trapezoid', 'manual', 'trapezoid-top'],
  'docs': ['documents', 'st-doc', 'stacked-document'],
  'st-rect': ['processes', 'procs', 'stacked-rectangle'],
  'odd': [],
  'flag': ['paper-tape'],
  'hex': ['hexagon', 'prepare'],
  'trap-b': ['priority', 'trapezoid', 'trapezoid-bottom'],
  'rect': ['proc', 'process', 'rectangle'],
  'circle': ['circ'],
  'sm-circ': ['small-circle', 'start'],
  'dbl-circ': ['double-circle'],
  'fr-circ': ['framed-circle', 'stop'],
  'bow-rect': ['bow-tie-rectangle', 'stored-data'],
  'fr-rect': ['framed-rectangle', 'subproc', 'subprocess', 'subroutine'],
  'cross-circ': ['crossed-circle', 'summary'],
  'tag-doc': ['tagged-document'],
  'tag-rect': ['tag-proc', 'tagged-process', 'tagged-rectangle'],
  'stadium': ['pill', 'terminal'],
  'text': [],
}

// Names whose mapped geometry is the SAME symbol the legacy syntax draws.
const EXACT: Record<string, string> = {
  'rect': 'rectangle',
  'rounded': 'rounded',
  'stadium': 'stadium',
  'cyl': 'cylinder',
  'diam': 'diamond',
  'hex': 'hexagon',
  'lean-r': 'lean-r',
  'lean-l': 'lean-l',
  'trap-b': 'trapezoid',
  'trap-t': 'trapezoid-alt',
  'circle': 'circle',
  'dbl-circ': 'doublecircle',
  'fr-rect': 'subroutine',
  'odd': 'asymmetric',
}

describe('v11 shape table — vocabulary coverage', () => {
  it('models every documented canonical name', () => {
    expect(Object.keys(FLOWCHART_V11_SHAPES).sort()).toEqual(Object.keys(DOCUMENTED).sort())
  })

  it('normalizes every documented alias to its canonical id', () => {
    for (const [canonical, aliases] of Object.entries(DOCUMENTED)) {
      expect(normalizeV11Shape(canonical)?.canonical).toBe(canonical)
      for (const alias of aliases) {
        expect(normalizeV11Shape(alias)?.canonical).toBe(canonical)
      }
    }
  })

  it('rejects undocumented names', () => {
    expect(normalizeV11Shape('zigzag')).toBeNull()
    expect(normalizeV11Shape('')).toBeNull()
  })
})

describe('v11 shapes — render parser', () => {
  it('every documented name parses to a known geometry with the semantic shape recorded', () => {
    for (const [canonical, aliases] of Object.entries(DOCUMENTED)) {
      for (const name of [canonical, ...aliases]) {
        const graph = parseGraph(metaSource(name))
        const node = graph.nodes.get('A')!
        expect(node.label).toBe('X')
        expect(node.semanticShape).toBe(canonical)
        expect(node.authoredShape).toBe(name)
        expect(typeof node.shape).toBe('string')
      }
    }
  })

  it('exact-equivalent names produce the same geometry as legacy bracket syntax', () => {
    const legacy: Record<string, string> = {
      'rect': 'flowchart TD\n  A[X]\n  A --> B\n',
      'rounded': 'flowchart TD\n  A(X)\n  A --> B\n',
      'stadium': 'flowchart TD\n  A([X])\n  A --> B\n',
      'cyl': 'flowchart TD\n  A[(X)]\n  A --> B\n',
      'diam': 'flowchart TD\n  A{X}\n  A --> B\n',
      'hex': 'flowchart TD\n  A{{X}}\n  A --> B\n',
      'lean-r': 'flowchart TD\n  A[/X/]\n  A --> B\n',
      'lean-l': 'flowchart TD\n  A[\\X\\]\n  A --> B\n',
      'trap-b': 'flowchart TD\n  A[/X\\]\n  A --> B\n',
      'trap-t': 'flowchart TD\n  A[\\X/]\n  A --> B\n',
      'circle': 'flowchart TD\n  A((X))\n  A --> B\n',
      'dbl-circ': 'flowchart TD\n  A(((X)))\n  A --> B\n',
      'fr-rect': 'flowchart TD\n  A[[X]]\n  A --> B\n',
      'odd': 'flowchart TD\n  A>X]\n  A --> B\n',
    }
    for (const [name, legacySource] of Object.entries(legacy)) {
      const viaMeta = parseGraph(metaSource(name)).nodes.get('A')!
      const viaLegacy = parseGraph(legacySource).nodes.get('A')!
      expect({ name, shape: viaMeta.shape }).toEqual({ name, shape: viaLegacy.shape })
      expect(EXACT[name]).toBe(viaMeta.shape)
    }
  })

  it('metadata keys never become nodes', () => {
    const graph = parseGraph(metaSource('cloud'))
    expect(graph.nodes.has('shape')).toBe(false)
    expect(graph.nodes.has('label')).toBe(false)
  })
})

describe('v11 shapes — verify contract', () => {
  it('documented names never emit UNKNOWN_SHAPE', () => {
    for (const canonical of Object.keys(DOCUMENTED)) {
      const warnings = verifyMermaid(metaSource(canonical)).warnings
      expect(warnings).not.toContainEqual(expect.objectContaining({ code: 'UNKNOWN_SHAPE' }))
    }
  })

  it('every documented semantic geometry is native and substitution-free', () => {
    for (const canonical of Object.keys(DOCUMENTED)) {
      const result = verifyMermaid(metaSource(canonical))
      expect(result.ok, canonical).toBe(true)
      expect(result.warnings, canonical).not.toContainEqual(expect.objectContaining({ syntax: 'flowchart_shape_substitution' }))
    }
  })

  it('formerly substituted cloud and document shapes now draw distinct semantic paths', () => {
    const cloud = renderMermaidSVG(metaSource('cloud'))
    const doc = renderMermaidSVG(metaSource('doc'))
    const path = (svg: string) => svg.match(/<g class="node"[\s\S]*?<path d="([^"]+)"/)?.[1]
    expect(path(cloud)).toBeDefined()
    expect(path(doc)).toBeDefined()
    expect(path(cloud)).not.toBe(path(doc))
  })
})

describe('v11 shapes — structured agent body + authored round-trip', () => {
  it('shape/label metadata parses structured and serializes the authored spelling verbatim', () => {
    const source = 'flowchart TD\n  A@{ shape: manual-input, label: "User Input" } --> B\n'
    const diagram = parseAgent(source)
    expect(diagram.body.kind).toBe('flowchart')
    const serialized = serializeMermaid(diagram)
    expect(serialized).toContain('A@{ shape: manual-input, label: "User Input" }')
    expect(serializeMermaid(parseAgent(serialized))).toBe(serialized)
  })

  it('multiline metadata round-trips through the canonical single-line form', () => {
    const source = 'flowchart TD\n  C@{\n    shape: delay,\n    label: "Wait"\n  }\n  C --> D\n'
    const diagram = parseAgent(source)
    expect(diagram.body.kind).toBe('flowchart')
    const serialized = serializeMermaid(diagram)
    expect(serialized).toContain('C@{ shape: delay, label: "Wait" }')
    expect(serializeMermaid(parseAgent(serialized))).toBe(serialized)
  })

  it('undocumented shape names stay opaque with the node-metadata lint', () => {
    const source = 'flowchart TD\n  A@{ shape: zigzag, label: "Mystery" }\n  A --> B\n'
    const diagram = parseAgent(source)
    expect(diagram.body.kind).toBe('opaque')
    expect(serializeMermaid(diagram)).toBe(source)
    expect(verifyMermaid(source).warnings).toContainEqual(expect.objectContaining({ syntax: 'flowchart_node_metadata' }))
  })

  it('icon/img metadata is typed, canonically round-trips, and renders natively', () => {
    const source = 'flowchart TD\n  A@{ icon: "fa:user", form: "square", label: "User Icon" }\n'
    const diagram = parseAgent(source)
    expect(diagram.body.kind).toBe('flowchart')
    if (diagram.body.kind !== 'flowchart') return
    expect(diagram.body.graph.nodes.get('A')).toMatchObject({ icon: 'fa:user', iconForm: 'square', label: 'User Icon' })
    const canonical = 'flowchart TD\n  A@{ icon: "fa:user", form: square, label: "User Icon" }\n'
    expect(serializeMermaid(diagram)).toBe(canonical)
    expect(serializeMermaid(parseAgent(canonical))).toBe(canonical)
    expect(renderMermaidSVG(source)).toContain('class="flowchart-icon')
    expect(verifyMermaid(source).warnings).not.toContainEqual(expect.objectContaining({ syntax: 'flowchart_node_metadata' }))
  })
})

describe('v11 shapes — SVG + ops', () => {
  it('the SVG names the semantic shape alongside the drawn geometry', () => {
    const svg = renderMermaidSVG(metaSource('manual-input'))
    expect(svg).toMatch(/<g class="node" data-id="A"[^>]*data-shape="[a-z-]+"[^>]*data-semantic-shape="sl-rect"/)
  })

  it('plain nodes emit no data-semantic-shape (byte stability)', () => {
    expect(renderMermaidSVG('flowchart TD\n  A[X] --> B')).not.toContain('data-semantic-shape')
  })

  it('set_shape accepts v11 names and preserves them on serialize', () => {
    const d = asFlowchart(parseAgent('flowchart TD\n  A[X] --> B\n'))!
    const shaped = mutate(d, { kind: 'set_shape', id: 'A', shape: 'manual-input' })
    if (!shaped.ok) throw new Error(shaped.error.message)
    const node = shaped.value.body.graph.nodes.get('A')!
    expect(node.semanticShape).toBe('sl-rect')
    expect(serializeMermaid(shaped.value)).toContain('A@{ shape: manual-input, label: "X" }')
  })
})
