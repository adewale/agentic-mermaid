import { describe, expect, test } from 'bun:test'
import { parseMermaid } from '../agent/parse.ts'
import { verifyMermaid } from '../agent/verify.ts'

const CASES: Array<{ family: string; section: string; source: string }> = [
  { family: 'flowchart', section: 'flowchart', source: 'flowchart LR\n  A --> B' },
  { family: 'sequence', section: 'sequence', source: 'sequenceDiagram\n  A->>B: hi' },
  { family: 'timeline', section: 'timeline', source: 'timeline\n  2026 : Event' },
  { family: 'journey', section: 'journey', source: 'journey\n  Task: 3: Me' },
  { family: 'class', section: 'class', source: 'classDiagram\n  class A' },
  { family: 'er', section: 'er', source: 'erDiagram\n  A' },
  { family: 'architecture', section: 'architecture', source: 'architecture-beta\n  service a(server)[A]' },
  { family: 'xychart', section: 'xyChart', source: 'xychart-beta\n  bar [1, 2]' },
  { family: 'pie', section: 'pie', source: 'pie\n  "A" : 1' },
  { family: 'quadrant', section: 'quadrantChart', source: 'quadrantChart\n  A: [0.5, 0.5]' },
  { family: 'gantt', section: 'gantt', source: 'gantt\n  dateFormat YYYY-MM-DD\n  A :a, 2026-01-01, 1d' },
]

function configured(section: string, source: string): string {
  return `---\nconfig:\n  ${section}:\n    madeUpKey: 7\n---\n${source}`
}

describe('family config is exhaustive wire-or-warn', () => {
  for (const entry of CASES) {
    test(`${entry.family}: unknown keys never disappear silently`, () => {
      const parsed = parseMermaid(configured(entry.section, entry.source))
      expect(parsed.ok).toBe(true)
      if (!parsed.ok) return
      const warning = verifyMermaid(parsed.value).warnings.find(item =>
        item.code === 'INEFFECTIVE_CONFIG' && item.field === `${entry.section}.madeUpKey`)
      expect(warning).toBeDefined()
    })
  }

  test('init directives use the same classifier', () => {
    const parsed = parseMermaid('%%{init: {"flowchart": {"madeUpKey": 7}}}%%\nflowchart LR\n  A --> B')
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    expect(verifyMermaid(parsed.value).warnings).toContainEqual(expect.objectContaining({
      code: 'INEFFECTIVE_CONFIG', field: 'flowchart.madeUpKey',
    }))
  })
})
