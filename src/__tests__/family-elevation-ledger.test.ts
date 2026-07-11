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

  test('Phase 0 cannot regress to a qualified completion claim', () => {
    expect(PLAN).toContain('| 0 — honesty + guards | **Complete** |')
    expect(PLAN).not.toContain('| 0 — honesty + guards | **Substantially complete** |')
  })
})
