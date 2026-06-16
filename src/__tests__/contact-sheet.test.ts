// The contact-sheet scenarios as a visual-regression gate: every lettered
// scenario from `eval/visual-rubric/scenarios.ts` (rendered for humans by
// `bun run contact:sheet`) is pinned here twice over —
//   1. the rubric's HARD metrics must be zero (endpoints on outlines, no
//      diagonals, no unexplained bends, no hitches, no overlaps, labels on
//      their routes, no edge-through-node), and
//   2. the full layout geometry is snapshot-pinned (drift sentinel), so any
//      change to these drawings fails CI until deliberately re-pinned with
//      `bun test --update-snapshots` AND re-reviewed via the contact sheet.
import { describe, expect, it } from 'bun:test'
import { contactSheetScenarios } from '../../eval/visual-rubric/scenarios.ts'
import { layoutGraphSync } from '../layout-engine.ts'
import { assessLayout } from '../layout-rubric.ts'
import { parseMermaid } from '../parser.ts'
import { verifyMermaid } from '../agent/verify.ts'

function snapshotSafeLabel(label: string | undefined): string | undefined {
  return label?.replace(/\n/g, '\\n')
}

function snapshotSafeLayout(source: string) {
  const layout = verifyMermaid(source).layout
  return {
    ...layout,
    nodes: layout.nodes.map(node => ({ ...node, label: snapshotSafeLabel(node.label) })),
    edges: layout.edges.map(edge => ({
      ...edge,
      label: edge.label ? { ...edge.label, text: snapshotSafeLabel(edge.label.text) } : edge.label,
    })),
  }
}

describe('contact sheet — hard rubric metrics stay zero', () => {
  for (const sc of contactSheetScenarios()) {
    it(`${sc.letter} — ${sc.title}`, () => {
      const graph = parseMermaid(sc.source)
      const result = assessLayout(graph, layoutGraphSync(graph))
      expect(result.violations).toEqual([])
    })
  }
})

describe('contact sheet — pinned geometry (re-pin deliberately, review the sheet)', () => {
  for (const sc of contactSheetScenarios()) {
    it(`${sc.letter} — ${sc.title}`, () => {
      expect(snapshotSafeLayout(sc.source)).toMatchSnapshot()
    })
  }
})
