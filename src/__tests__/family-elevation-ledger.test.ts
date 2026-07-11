import { describe, expect, test } from 'bun:test'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const PLAN = readFileSync(join(import.meta.dir, '..', '..', 'docs/design/family-elevation-plan.md'), 'utf8')

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
const STATUS = new Set(['done', 'partial', 'not-started'])
const FAMILY_ITEM_COUNTS: Record<string, number> = {
  Flowchart: 8, State: 7, Sequence: 7, Class: 6, ER: 6, Timeline: 5,
  Gantt: 6, XYChart: 5, Pie: 4, Quadrant: 4, Architecture: 6,
}
const PHASE_0_ACCEPTANCE = [
  { id: 'B01', file: 'family-elevation-ledger.test.ts', probe: 'every numbered work-plan item has a corresponding ordinal ledger ID' },
  { id: 'X1', file: 'property-all-families-fuzz.test.ts', probe: 'serializer output reparses through the agent and renderer without semantic drift' },
  { id: 'B02', file: 'opaque-unsupported-warning.test.ts', probe: 'Opaque is a lossless source-preservation contract' },
  { id: 'X7', file: 'state-config.test.ts', probe: 'the independent documented inventory is partitioned exactly once' },
  { id: 'G3', file: 'cli-gantt-today-flag.test.ts', probe: 'unknown CLI flags error instead of being silently swallowed' },
  { id: 'Q3', file: 'scene-text-fidelity.test.ts', probe: 'text geometry' },
] as const

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
    ].join('\n')
    const names = [...checked.matchAll(/`([^`]+\.test\.ts)`/g)].map(match => match[1]!)
    expect(names.length).toBeGreaterThan(20)
    for (const name of names) {
      expect(existsSync(join(import.meta.dir, name)), `documented evidence ${name}`).toBe(true)
    }
  })

  test('Phase 0 status is derived from executable acceptance IDs, not completion prose', () => {
    const byId = new Map([...rows('family-elevation-ledger'), ...rows('family-elevation-backlog')].map(row => [row.id, row]))
    for (const acceptance of PHASE_0_ACCEPTANCE) {
      expect(byId.get(acceptance.id)?.status, `${acceptance.id}: done`).toBe('done')
      const testSource = readFileSync(join(import.meta.dir, acceptance.file), 'utf8')
      expect(testSource, `${acceptance.id}: executable acceptance probe`).toContain(acceptance.probe)
    }
    const derived = PHASE_0_ACCEPTANCE.every(acceptance => byId.get(acceptance.id)?.status === 'done')
      ? '**Complete**'
      : '**Partial**'
    expect(PLAN).toContain(`| 0 — honesty + guards | ${derived} |`)
  })
})
