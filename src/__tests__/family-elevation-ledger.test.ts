import { describe, expect, test } from 'bun:test'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const ARCHIVE = join(import.meta.dir, '..', '..', 'docs/project/archive/pr-149')
const PLAN = readFileSync(join(ARCHIVE, 'family-elevation-plan.md'), 'utf8')
const ACCEPTANCE = readFileSync(join(ARCHIVE, 'family-elevation-acceptance.md'), 'utf8')
const FINAL_AUDIT_URL = 'https://github.com/adewale/agentic-mermaid/pull/149#issuecomment-4949151500'

const EXPECTED_LEDGER_IDS = [
  ...Array.from({ length: 8 }, (_, i) => `F${i + 1}`),
  ...Array.from({ length: 7 }, (_, i) => `S${i + 1}`),
  ...Array.from({ length: 7 }, (_, i) => `SE${i + 1}`),
  ...Array.from({ length: 6 }, (_, i) => `CL${i + 1}`),
  ...Array.from({ length: 6 }, (_, i) => `ER${i + 1}`),
  ...Array.from({ length: 5 }, (_, i) => `T${i + 1}`),
  ...Array.from({ length: 6 }, (_, i) => `G${i + 1}`),
  ...Array.from({ length: 5 }, (_, i) => `XY${i + 1}`),
  ...Array.from({ length: 4 }, (_, i) => `P${i + 1}`),
  ...Array.from({ length: 4 }, (_, i) => `Q${i + 1}`),
  ...Array.from({ length: 6 }, (_, i) => `A${i + 1}`),
  ...Array.from({ length: 8 }, (_, i) => `X${i + 1}`),
].sort()

const EXPECTED_COMPLETION_PACKAGES = Array.from({ length: 18 }, (_, i) => `B${String(i + 1).padStart(2, '0')}`).sort()
const EXPECTED_CLOSING_GAP_IDS = Array.from({ length: 15 }, (_, i) => `CG${String(i + 1).padStart(2, '0')}`).sort()
const STATUS = new Set(['done', 'partial', 'not-started'])
const FAMILY_ITEM_COUNTS: Record<string, number> = {
  Flowchart: 8, State: 7, Sequence: 7, Class: 6, ER: 6, Timeline: 5,
  Gantt: 6, XYChart: 5, Pie: 4, Quadrant: 4, Architecture: 6,
}
const PHASE_0_IDS = ['B01', 'X1', 'B02', 'X7', 'G3', 'Q3'] as const
const ROOT = join(import.meta.dir, '..', '..')
interface AcceptanceEvidence { id: string; file: string; title: string }
const EVIDENCE = JSON.parse(readFileSync(join(ARCHIVE, 'family-elevation-evidence.json'), 'utf8')) as {
  schemaVersion: number
  entries: AcceptanceEvidence[]
}

function declaredTestTitles(file: string): string[] {
  const testSource = readFileSync(join(ROOT, file), 'utf8')
  return [...testSource.matchAll(/\b(?:test|it)\(\s*['"`]([^'"`]+)['"`]/g)].map(match => match[1]!)
}

function rows(marker: string): Array<{ id: string; phase: string; status: string; detail: string }> {
  const section = PLAN.split(`<!-- ${marker}:start -->`)[1]?.split(`<!-- ${marker}:end -->`)[0]
  expect(section, `${marker} marker block`).toBeDefined()
  return [...(section ?? '').matchAll(/^\| ([A-Z]+\d+) \| ([^|]+) \| ([^|]+) \| ([^|]+) \|$/gm)]
    .map(match => ({ id: match[1]!, phase: match[2]!.trim(), status: match[3]!.trim(), detail: match[4]!.trim() }))
}

function expectMechanicalRows(actual: ReturnType<typeof rows>, expectedIds: string[]): void {
  expect(actual.map(row => row.id).sort()).toEqual(expectedIds)
  expect(new Set(actual.map(row => row.id)).size).toBe(actual.length)
  for (const row of actual) {
    expect(STATUS.has(row.status), `${row.id}: known status`).toBe(true)
    expect(row.phase.length, `${row.id}: phase`).toBeGreaterThan(0)
    expect(row.detail.length, `${row.id}: evidence or remainder`).toBeGreaterThan(8)
    if (row.status === 'done') expect(row.detail).toMatch(/`[^`]+`/)
    else expect(row.detail.toLowerCase()).toMatch(/remain|need|defer|missing|not yet|partial|finish|audit/)
  }
}

describe('family elevation plan is a mechanically complete ledger', () => {
  test('every numbered family item and X1–X8 has exactly one checked status row', () => {
    expectMechanicalRows(rows('family-elevation-ledger'), EXPECTED_LEDGER_IDS)
  })

  test('the execution backlog captures every residual completion package', () => {
    expectMechanicalRows(rows('family-elevation-backlog'), EXPECTED_COMPLETION_PACKAGES)
  })

  test('Closing The Gap captures every audited family and cross-family acceptance', () => {
    expectMechanicalRows(rows('family-elevation-closing-gap'), EXPECTED_CLOSING_GAP_IDS)
  })

  test('every numbered work-plan item has a corresponding ordinal ledger ID', () => {
    const workPlan = PLAN.split('## Work plan by family')[1]?.split('## Cross-cutting workstreams')[0] ?? ''
    for (const [family, count] of Object.entries(FAMILY_ITEM_COUNTS)) {
      const section = workPlan.split(`### ${family}\n`)[1]?.split('\n### ')[0] ?? ''
      const ordinals = [...section.matchAll(/^(\d+)\. \*\*/gm)].map(match => Number(match[1]))
      expect(ordinals, family).toEqual(Array.from({ length: count }, (_, index) => index + 1))
    }
    const cross = PLAN.split('## Cross-cutting workstreams')[1]?.split('## Phases')[0] ?? ''
    expect([...cross.matchAll(/^- \*\*X(\d+) /gm)].map(match => Number(match[1]))).toEqual([1, 2, 3, 4, 5, 6, 7, 8])
  })

  test('every cited test file exists', () => {
    const checked = [
      PLAN.split('<!-- family-elevation-ledger:start -->')[1]?.split('<!-- family-elevation-ledger:end -->')[0] ?? '',
      PLAN.split('<!-- family-elevation-backlog:start -->')[1]?.split('<!-- family-elevation-backlog:end -->')[0] ?? '',
      PLAN.split('<!-- family-elevation-closing-gap:start -->')[1]?.split('<!-- family-elevation-closing-gap:end -->')[0] ?? '',
    ].join('\n')
    const names = [...checked.matchAll(/`([^`]+\.test\.ts)`/g)].map(match => match[1]!)
    expect(names.length).toBeGreaterThan(20)
    for (const name of names) {
      const exists = existsSync(join(import.meta.dir, name)) || existsSync(join(ROOT, name))
      expect(exists, `documented evidence ${name}`).toBe(true)
    }
  })

  test('every done claim resolves to an exact executable title in a cited test file', () => {
    expect(EVIDENCE.schemaVersion).toBe(1)
    const allRows = [...rows('family-elevation-ledger'), ...rows('family-elevation-backlog'), ...rows('family-elevation-closing-gap')]
    const done = allRows.filter(row => row.status === 'done')
    expect(EVIDENCE.entries.map(entry => entry.id).sort()).toEqual(done.map(row => row.id).sort())
    expect(new Set(EVIDENCE.entries.map(entry => entry.id)).size).toBe(EVIDENCE.entries.length)

    const byId = new Map(allRows.map(row => [row.id, row]))
    for (const acceptance of EVIDENCE.entries) {
      const row = byId.get(acceptance.id)!
      expect(acceptance.title.length, `${acceptance.id}: non-empty exact title`).toBeGreaterThan(0)
      expect(existsSync(join(ROOT, acceptance.file)), `${acceptance.id}: evidence file exists`).toBe(true)
      expect(row.detail, `${acceptance.id}: evidence file is cited by the plan row`).toContain(`\`${acceptance.file.split('/').at(-1)}\``)
      expect(declaredTestTitles(acceptance.file), `${acceptance.id}: exact executable acceptance title`).toContain(acceptance.title)
    }
  })

  test('B18 closure cites the stable final-head audit record', () => {
    const b18 = rows('family-elevation-backlog').find(row => row.id === 'B18')
    expect(b18?.status).toBe('done')
    expect(b18?.detail).toContain(FINAL_AUDIT_URL)
    expect(ACCEPTANCE).toContain('Status: **B18 complete')
    expect(ACCEPTANCE).toContain(FINAL_AUDIT_URL)
  })

  test('Phase 0 status is derived from its exact-evidence rows', () => {
    const byId = new Map([...rows('family-elevation-ledger'), ...rows('family-elevation-backlog')].map(row => [row.id, row]))
    const derived = PHASE_0_IDS.every(id => byId.get(id)?.status === 'done') ? '**Complete**' : '**Partial**'
    expect(PLAN).toContain(`| 0 — honesty + guards | ${derived} |`)
  })
})
