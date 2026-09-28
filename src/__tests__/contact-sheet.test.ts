// The contact-sheet scenarios as a visual-regression gate: every lettered
// scenario from `eval/visual-rubric/scenarios.ts` (rendered for humans by
// `bun run contact:sheet`) is pinned here twice over —
//   1. the rubric's HARD metrics must be zero (endpoints on outlines, no
//      diagonals, no unexplained bends, no hitches, no overlaps, labels on
//      their routes, no edge-through-node), and
//   2. the full public layout geometry is pinned in a readable golden
//      (testdata/contact-sheet-geometry.json: one node, edge or group per
//      line), so any change to these drawings fails CI with the lines that
//      moved, and its review diff shows the same lines.
//
// Regenerate after an INTENTIONAL geometry change, then review the golden diff
// against the contact sheet:
//   UPDATE_CONTACT_SHEET_GEOMETRY=1 bun test src/__tests__/contact-sheet.test.ts
// The golden lives under src/__tests__/testdata/, so the golden-drift CI gate
// requires an [approve-goldens] commit line.
import { describe, expect, it } from 'bun:test'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { contactSheetScenarios } from '../../eval/visual-rubric/scenarios.ts'
import { layoutGraphSync } from '../layout-engine.ts'
import { assessLayout } from '../layout-rubric.ts'
import { parseMermaid } from '../parser.ts'
import { verifyMermaid } from '../agent/verify.ts'
import type { RenderedLayout } from '../agent/types.ts'

const GOLDEN = join(import.meta.dir, 'testdata', 'contact-sheet-geometry.json')
const UPDATE = process.env.UPDATE_CONTACT_SHEET_GEOMETRY === '1'

type ScenarioGeometry = {
  title: string
  shell: Omit<RenderedLayout, 'nodes' | 'edges' | 'groups'>
  nodes: RenderedLayout['nodes']
  edges: RenderedLayout['edges']
  groups: RenderedLayout['groups']
}

function geometryOf(title: string, source: string): ScenarioGeometry {
  const { nodes, edges, groups, ...shell } = verifyMermaid(source).layout
  return { title, shell, nodes, edges, groups }
}

/** One block per scenario and one node, edge or group per line, so a moved
 *  element is a one-line diff. Blocks follow the contact-sheet order. */
function serializeGolden(entries: ReadonlyArray<readonly [string, ScenarioGeometry]>): string {
  const list = (items: readonly unknown[]): string =>
    items.length === 0 ? '[]' : `[\n${items.map(item => `      ${JSON.stringify(item)}`).join(',\n')}\n    ]`
  const blocks = entries.map(([letter, geometry]) => [
    `  ${JSON.stringify(letter)}: {`,
    `    "title": ${JSON.stringify(geometry.title)},`,
    `    "shell": ${JSON.stringify(geometry.shell)},`,
    `    "nodes": ${list(geometry.nodes)},`,
    `    "edges": ${list(geometry.edges)},`,
    `    "groups": ${list(geometry.groups)}`,
    '  }',
  ].join('\n'))
  return `{\n${blocks.join(',\n')}\n}\n`
}

function geometryLines(geometry: ScenarioGeometry): string[] {
  return [
    `title ${JSON.stringify(geometry.title)}`,
    `shell ${JSON.stringify(geometry.shell)}`,
    ...geometry.nodes.map(node => `node ${JSON.stringify(node)}`),
    ...geometry.edges.map(edge => `edge ${JSON.stringify(edge)}`),
    ...geometry.groups.map(group => `group ${JSON.stringify(group)}`),
  ]
}

/** The golden lines a scenario lost and the current lines it gained. */
function describeDrift(letter: string, golden: ScenarioGeometry | undefined, current: ScenarioGeometry): string | undefined {
  if (!golden) return `${letter} — ${current.title}: absent from the golden`
  const before = geometryLines(golden)
  const after = geometryLines(current)
  if (before.join('\n') === after.join('\n')) return undefined
  const removed = before.filter(line => !after.includes(line)).map(line => `    - ${line}`)
  const added = after.filter(line => !before.includes(line)).map(line => `    + ${line}`)
  const detail = removed.length + added.length > 0 ? [...removed, ...added] : ['    (same elements, different order)']
  return [`${letter} — ${current.title}:`, ...detail].join('\n')
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
  it('every scenario matches the readable geometry golden', () => {
    const current = contactSheetScenarios().map(sc => [sc.letter, geometryOf(sc.title, sc.source)] as const)
    const serialized = serializeGolden(current)
    if (UPDATE) {
      writeFileSync(GOLDEN, serialized)
      console.log(`[contact-sheet] wrote geometry golden: ${current.length} scenarios`)
      return
    }
    const committed = readFileSync(GOLDEN, 'utf8')
    if (committed === serialized) return
    const golden = JSON.parse(committed) as Record<string, ScenarioGeometry>
    const drift = current.flatMap(([letter, geometry]) => describeDrift(letter, golden[letter], geometry) ?? [])
    const letters = new Set(current.map(([letter]) => letter))
    const stale = Object.keys(golden).filter(letter => !letters.has(letter)).map(letter => `${letter}: no longer a contact-sheet scenario`)
    const problems = [...drift, ...stale]
    const more = problems.length > 10 ? `\n…and ${problems.length - 10} more` : ''
    throw new Error(
      `${problems.length === 0 ? 'the golden file is not in canonical form' : `${problems.length} contact-sheet scenario(s) diverged from the geometry golden`}:\n` +
      `${problems.slice(0, 10).join('\n')}${more}\n\n` +
      'If intentional: UPDATE_CONTACT_SHEET_GEOMETRY=1 bun test src/__tests__/contact-sheet.test.ts, ' +
      'review the golden diff against the contact sheet, and approve it with an [approve-goldens] commit line.',
    )
  })
})
