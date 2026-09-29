/**
 * Consolidation gate — keeps eliminated duplication from creeping back.
 *
 * The 2026-07 consolidation audit (open items live in TODO.md §5; audit retired)
 * found the same primitives re-implemented across families, and several of the
 * copies had silently diverged (class/er measured titles at the wrong weight,
 * four escapeAttr copies dropped the apostrophe escape, two luminance formulas
 * disagreed). The shared behaviour is checked here on rendered output for
 * every family (label escaping, measured-vs-drawn boxes; the SVG root
 * accessibility wiring is svg-a11y-conformance.test.ts). Duplication with no
 * cheap rendered oracle (hex colour math, luma weights, the family union) is
 * a rule in source-lint.test.ts.
 */
import { describe, it, expect } from 'bun:test'
import { decodeXML } from 'entities'
import { BUILTIN_FAMILY_METADATA } from '../agent/families.ts'
import { mutate, parseRegisteredMermaid, renderMermaidSVG } from '../agent/index.ts'
import type { AnyMutationOp, DiagramKind, MutableValidDiagram, ParsedDiagram } from '../agent/types.ts'
import * as agentTypes from '../agent/types.ts'

/** A label-carrying edit each family accepts; `text` is the label under test. */
const LABEL_EDIT_BY_FAMILY: Record<DiagramKind, (text: string) => Record<string, unknown>> = {
  flowchart: text => ({ kind: 'add_node', id: 'Zebra', label: text }),
  state: text => ({ kind: 'add_state', id: 'Zebra', label: text }),
  sequence: text => ({ kind: 'add_message', from: 'U', to: 'S', text }),
  timeline: text => ({ kind: 'add_period', sectionIndex: 0, label: text }),
  class: text => ({ kind: 'add_class', id: 'Zebra', label: text }),
  er: text => ({ kind: 'add_entity', id: 'ZEBRA', label: text }),
  journey: text => ({ kind: 'add_section', label: text }),
  architecture: text => ({ kind: 'add_service', id: 'zebra', label: text }),
  xychart: text => ({ kind: 'set_title', title: text }),
  pie: text => ({ kind: 'add_slice', label: text, value: 5 }),
  quadrant: text => ({ kind: 'add_point', label: text, x: 0.5, y: 0.5 }),
  gantt: text => ({ kind: 'add_section', label: text }),
  mindmap: text => ({ kind: 'add_node', id: 'Zebra', label: text, parent: 'root', shape: 'rect' }),
  gitgraph: text => ({ kind: 'append_commit', id: 'zebra', message: text }),
  radar: text => ({ kind: 'add_axis', id: 'zebra', label: text }),
  sankey: text => ({ kind: 'add_link', source: text, target: 'Industry', value: 1 }),
}

function renderWithLabel(family: (typeof BUILTIN_FAMILY_METADATA)[number], text: string): string {
  const parsed = parseRegisteredMermaid(family.example)
  if (!parsed.ok) throw new Error(`${family.id} example does not parse`)
  const narrow = (agentTypes as unknown as Record<string, (d: ParsedDiagram) => MutableValidDiagram | null>)[family.narrower]!
  const edited = mutate(narrow(parsed.value)!, LABEL_EDIT_BY_FAMILY[family.id](text) as AnyMutationOp)
  if (!edited.ok) throw new Error(`${family.id} rejected the label edit: ${edited.error.message}`)
  return renderMermaidSVG(edited.value)
}

describe('consolidation gate — shared primitives stay single-sourced', () => {
  it('every family escapes apostrophes and ampersands in rendered labels', () => {
    // The old per-renderer escape copies dropped the apostrophe escape. Every
    // family must emit label text only in escaped form (any valid entity),
    // and the decoded SVG must still carry the label. xychart titles are bare
    // text without quotes, so they carry only the ampersand.
    for (const family of BUILTIN_FAMILY_METADATA) {
      const label = family.id === 'xychart' ? 'Q2&Q3' : "Q1'Q2&Q3"
      const svg = renderWithLabel(family, label)
      expect({ family: family.id, raw: ["Q1'Q2", 'Q2&Q3'].filter(fragment => svg.includes(fragment)), decoded: decodeXML(svg).includes(label) })
        .toEqual({ family: family.id, raw: [], decoded: true })
    }
  })

  it('class and ER boxes contain every line drawn in them', () => {
    // Layout (sizing) and renderer (drawing) must resolve the same style: a
    // renderer that measures its text heavier than layout did draws past the
    // box edge (the measured-vs-drawn divergence that undersized class/er
    // title boxes). Drawn text is fitted to its textLength, so its horizontal
    // extent is exact.
    const sources = [
      'classDiagram\n  class VeryLongAccountNameForTesting {\n    +identifierWithALongName: string\n    +close() void\n  }',
      'erDiagram\n  VERY_LONG_CUSTOMER_ENTITY_NAME {\n    string identifier_with_a_long_name\n  }',
    ]
    const attr = (tag: string, name: string) => new RegExp(`\\s${name}="([^"]*)"`).exec(tag)?.[1]
    let lines = 0
    for (const source of sources) {
      const svg = renderMermaidSVG(source)
      for (const group of svg.matchAll(/<g [^>]*data-role="(?:class-box|entity)"[^>]*>([\s\S]*?)<\/g>/g)) {
        const rect = /<rect [^>]*>/.exec(group[1]!)![0]
        const left = Number(attr(rect, 'x'))
        const right = left + Number(attr(rect, 'width'))
        for (const [text] of group[1]!.matchAll(/<text [^>]*textLength="[^"]*"[^>]*>/g)) {
          const x = Number(attr(text, 'x'))
          const length = Number(attr(text, 'textLength'))
          const anchor = attr(text, 'text-anchor') ?? 'start'
          const start = anchor === 'middle' ? x - length / 2 : anchor === 'end' ? x - length : x
          expect({ line: attr(text, 'data-id') ?? 'title', inside: start >= left - 0.01 && start + length <= right + 0.01 })
            .toEqual({ line: attr(text, 'data-id') ?? 'title', inside: true })
          lines++
        }
      }
    }
    expect(lines).toBeGreaterThanOrEqual(5)
  })
})
