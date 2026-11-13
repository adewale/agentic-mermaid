import { describe, expect, test } from 'bun:test'
import { parseFlowchart } from 'mermaid-ast'

import { parseMermaid } from '../parser.ts'

type ExpectedStyle = 'solid' | 'dotted' | 'thick'

const LINK_CASES = [
  ['plain arrow', 'flowchart LR\n  A --> B', 'solid', true, 1, undefined],
  ['long arrow', 'flowchart LR\n  A ----> B', 'solid', true, 3, undefined],
  ['open line', 'flowchart LR\n  A --- B', 'solid', false, 1, undefined],
  ['dotted arrow', 'flowchart LR\n  A -.-> B', 'dotted', true, 1, undefined],
  ['thick arrow', 'flowchart LR\n  A ====> B', 'thick', true, 3, undefined],
  ['text label with right-side length', 'flowchart LR\n  A -- No ----> B', 'solid', true, 3, 'No'],
] as const satisfies ReadonlyArray<readonly [string, string, ExpectedStyle, boolean, number, string | undefined]>

function mermaidAstLink(source: string) {
  const ast = parseFlowchart(source)
  const link = ast.links[0]
  if (!link) throw new Error(`mermaid-ast produced no link for ${source}`)
  return link
}

function normalizedAstStyle(stroke: string): ExpectedStyle {
  if (stroke === 'dotted') return 'dotted'
  if (stroke === 'thick') return 'thick'
  return 'solid'
}

describe('Mermaid flowchart link grammar conformance', () => {
  test.each(LINK_CASES)('%s matches mermaid-ast for supported link fields', (_name, source, style, hasArrowEnd, length, label) => {
    const ours = parseMermaid(source).edges[0]!
    const theirs = mermaidAstLink(source)

    expect(ours.source).toBe(theirs.source)
    expect(ours.target).toBe(theirs.target)
    expect(ours.style).toBe(style)
    expect(normalizedAstStyle(theirs.stroke)).toBe(style)
    expect(ours.hasArrowEnd).toBe(hasArrowEnd)
    expect(theirs.type === 'arrow_point').toBe(hasArrowEnd)
    expect(ours.length ?? 1).toBe(length)
    expect(theirs.length).toBe(length)
    expect(ours.label).toBe(label)
    expect(theirs.text?.text).toBe(label)
  })
})
