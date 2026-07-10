/**
 * Mermaid markdown strings — backtick-quoted labels (repo #102, layer 1).
 *
 * Contract:
 *  - the render parser accepts `A["`**bold** text`"]` node labels and
 *    `-- "`…`" -->` / `-->|"`…`"|` edge labels: the backticks are consumed and
 *    the emphasis markers (**, *) are STRIPPED — the label renders as plain
 *    text (layer 2, styled runs, is out of scope and announced by the lint);
 *  - explicit line breaks inside a markdown string (real newlines in the
 *    source, or <br>) become label line breaks;
 *  - markdown labels auto-wrap at flowchart.wrappingWidth (upstream default
 *    200 — markdown strings are the one place upstream defaults wrapping on);
 *  - the agent parser keeps the source opaque (verbatim round-trip) and the
 *    existing UNSUPPORTED_SYNTAX flowchart_markdown_string lint still fires;
 *  - verify's render-parity gate passes (no more RENDER-visible backticks).
 */
import { describe, it, expect } from 'bun:test'

import { parseMermaid as parseGraph } from '../parser.ts'
import { renderMermaidSVG } from '../index.ts'
import { parseMermaid, serializeMermaid, verifyMermaid } from '../agent/index.ts'

function parseAgent(source: string) {
  const parsed = parseMermaid(source)
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.error))
  return parsed.value
}

describe('markdown strings — node labels', () => {
  it('strips backticks and emphasis markers to plain text', () => {
    const graph = parseGraph('flowchart TD\n  A["`hello **world**`"] --> B\n')
    const node = graph.nodes.get('A')!
    expect(node.label).toBe('hello world')
    expect(node.markdownLabel).toBe(true)
    expect(graph.edges.map(e => `${e.source}->${e.target}`)).toEqual(['A->B'])
  })

  it('italic markers strip too', () => {
    const graph = parseGraph('flowchart TD\n  A["`The *bat* in the chat`"] --> B\n')
    expect(graph.nodes.get('A')!.label).toBe('The bat in the chat')
  })

  it('non-markdown labels keep today\'s pipeline (bold tags, quotes)', () => {
    const graph = parseGraph('flowchart TD\n  A["plain **bold**"] --> B\n')
    expect(graph.nodes.get('A')!.label).toBe('plain <b>bold</b>')
    expect(graph.nodes.get('A')!.markdownLabel).toBeUndefined()
  })

  it('markdown strings work on non-rectangle shapes single-line', () => {
    const graph = parseGraph('flowchart TD\n  A{"`Is **it**?`"} --> B\n')
    const node = graph.nodes.get('A')!
    expect(node.shape).toBe('diamond')
    expect(node.label).toBe('Is it?')
  })
})

describe('markdown strings — edge labels', () => {
  it('text-arrow markdown labels strip to plain text', () => {
    const graph = parseGraph('flowchart TD\n  A-- "`The *bat* in the chat`" -->B\n')
    expect(graph.edges[0]!.label).toBe('The bat in the chat')
  })

  it('pipe markdown labels strip to plain text', () => {
    const graph = parseGraph('flowchart TD\n  A-->|"`**yes** please`"|B\n')
    expect(graph.edges[0]!.label).toBe('yes please')
  })
})

describe('markdown strings — explicit line breaks', () => {
  it('a real newline inside the backtick string becomes a label line break', () => {
    const graph = parseGraph('flowchart LR\n  A["`Line one\n  Line two`"] --> B\n')
    expect(graph.nodes.get('A')!.label).toBe('Line one\nLine two')
  })

  it('renders one tspan per explicit line', () => {
    const svg = renderMermaidSVG('flowchart LR\n  A["`Line one\n  Line two`"] --> B\n')
    const nodeText = svg.split('data-id="A"')[1]!.split('</g>')[0]!
    expect(nodeText).toContain('Line one')
    expect(nodeText).toContain('Line two')
    expect(nodeText).not.toContain('`')
  })
})

describe('markdown strings — auto-wrap at wrappingWidth', () => {
  const LONG = 'flowchart TD\n  A["`This markdown paragraph is easily long enough that upstream would wrap it onto several lines automatically`"] --> B\n'

  it('markdown labels wrap by default at the upstream 200px width', () => {
    const graph = parseGraph(LONG)
    expect(graph.nodes.get('A')!.markdownLabel).toBe(true)
    const svg = renderMermaidSVG(LONG)
    const nodeText = svg.split('data-id="A"')[1]!.split('</g>')[0]!
    expect(nodeText).toContain('<tspan')
  })

  it('an explicit wrappingWidth overrides the default budget', () => {
    const wide = renderMermaidSVG(`---\nconfig:\n  flowchart:\n    wrappingWidth: 800\n---\n${LONG}`)
    const nodeText = wide.split('data-id="A"')[1]!.split('</g>')[0]!
    expect(nodeText).not.toContain('<tspan')
  })
})

describe('markdown strings — agent contract (#102 layer 1)', () => {
  const SOURCE = 'flowchart TD\n  A["`**bold** text`"] --> B\n'

  it('agent parse stays opaque and round-trips verbatim', () => {
    const diagram = parseAgent(SOURCE)
    expect(diagram.body.kind).toBe('opaque')
    expect(serializeMermaid(diagram)).toBe(SOURCE)
  })

  it('verify is clean apart from the markdown lint (render parity passes)', () => {
    const verify = verifyMermaid(SOURCE)
    expect(verify.ok).toBe(true)
    expect(verify.warnings).toContainEqual(expect.objectContaining({
      code: 'UNSUPPORTED_SYNTAX',
      syntax: 'flowchart_markdown_string',
    }))
  })

  it('the #102 sample (with a direction header) renders all nodes and edges', () => {
    const source = 'flowchart TD\nA["`The cat in **the** hat`"]-- "`The *bat* in the chat`" -->B["The dog in the hog"] -- "The rat in the mat" -->C;\n'
    const graph = parseGraph(source)
    expect([...graph.nodes.keys()]).toEqual(['A', 'B', 'C'])
    expect(graph.nodes.get('A')!.label).toBe('The cat in the hat')
    expect(graph.edges.map(e => e.label)).toEqual(['The bat in the chat', 'The rat in the mat'])
    const svg = renderMermaidSVG(source)
    expect(svg).toContain('The cat in the hat')
    expect(svg).not.toContain('`')
  })
})
