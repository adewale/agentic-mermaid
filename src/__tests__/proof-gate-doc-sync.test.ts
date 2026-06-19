// Move 9: keep docs/testing-strategy.md's proof-gate map honest by PARSING the
// markdown table and cross-checking every row against the workflow files —
// rather than spot-checking a handful of anchored rows. Testing-tools learning
// #2: the doc once claimed browser e2e was not gated when the e2e job runs it
// on every PR. A doc that can drift from reality is worse than no doc.
//
// The test parses each table row into {label, perPR, nightly, manual} marks,
// asserts structural invariants over ALL rows, and for every row whose label
// matches a known evidence rule, verifies the claimed column against ci.yml /
// the nightly workflow. A row with no matching rule still must mark a column;
// adding a row the rules don't recognize is allowed, but a row that claims
// per-PR/nightly for something the workflows contradict fails here.

import { describe, test, expect } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = join(import.meta.dir, '..', '..')
const read = (rel: string) => readFileSync(join(ROOT, rel), 'utf8')

const ci = read('.github/workflows/ci.yml')
const nightly = read('.github/workflows/nightly-route-mutation.yml')
const doc = read('docs/testing-strategy.md')

interface Row { label: string; perPR: boolean; nightly: boolean; manual: boolean }

/** Parse the "Gate | Per-PR | Nightly | Manual" table out of the strategy doc. */
function parseProofGateTable(md: string): Row[] {
  const lines = md.split('\n')
  const header = lines.findIndex(l => /^\|\s*Gate\s*\|/.test(l))
  expect(header).toBeGreaterThan(-1)
  const rows: Row[] = []
  for (let i = header + 2; i < lines.length; i++) {  // +2 skips the |---| separator
    const line = lines[i]!
    if (!line.trim().startsWith('|')) break  // table ended
    const cells = line.split('|').slice(1, -1).map(c => c.trim())
    if (cells.length < 4) continue
    const has = (c: string) => c.includes('✅')
    rows.push({ label: cells[0]!, perPR: has(cells[1]!), nightly: has(cells[2]!), manual: has(cells[3]!) })
  }
  return rows
}

// label-substring → assertions to run when that column is claimed.
const EVIDENCE: Array<{ match: RegExp; perPR?: () => void; nightly?: () => void }> = [
  {
    match: /e2e/i,
    perPR: () => { expect(ci).toContain('browser.test.ts'); expect(ci).toMatch(/e2e:\s*\n\s*runs-on/) },
  },
  {
    match: /incremental lane/i,
    perPR: () => { expect(ci).toContain('mutation-test:incremental'); expect(ci).toMatch(/mutation-incremental:\s*\n\s*runs-on/) },
  },
  {
    match: /broad route\/ascii lanes|sabotage/i,
    nightly: () => { expect(nightly).toContain('mutation-test'); expect(nightly).toContain('sabotage') },
  },
  {
    match: /metamorphic/i,
    perPR: () => expect(read('src/__tests__/property-layout-metamorphic.test.ts').length).toBeGreaterThan(0),
  },
  {
    match: /heuristic-tracker/i,
    perPR: () => expect(read('src/__tests__/heuristic-tracker.test.ts').length).toBeGreaterThan(0),
  },
  {
    match: /corpus|count-oracle/i,
    perPR: () => expect(read('src/__tests__/agent-mermaid-corpus.test.ts')).toContain('countStructuralElements'),
  },
  {
    match: /hero/i,
    perPR: () => expect(ci).toContain('hero:check'),
  },
]

describe('proof-gate map ↔ workflow reality (parsed)', () => {
  const rows = parseProofGateTable(doc)

  test('the table parses into multiple rows', () => {
    expect(rows.length).toBeGreaterThanOrEqual(8)
  })

  test('every row marks at least one column (no orphan rows)', () => {
    const orphans = rows.filter(r => !r.perPR && !r.nightly && !r.manual).map(r => r.label)
    expect(orphans).toEqual([])
  })

  test('every per-PR / nightly claim that has an evidence rule matches the workflows', () => {
    const checked: string[] = []
    for (const row of rows) {
      for (const rule of EVIDENCE) {
        if (!rule.match.test(row.label)) continue
        if (row.perPR && rule.perPR) { rule.perPR(); checked.push(`${row.label} [per-PR]`) }
        if (row.nightly && rule.nightly) { rule.nightly(); checked.push(`${row.label} [nightly]`) }
      }
    }
    // Guard against the rules silently matching nothing (e.g. the table was
    // restructured): the high-value claims must still be exercised.
    expect(checked.length).toBeGreaterThanOrEqual(4)
  })

  test('mutation is NEVER claimed per-PR for the broad lanes, and ci.yml proves it', () => {
    // The broad Stryker lanes must not run on the PR gate; only the incremental
    // lane may. ci.yml runs `mutation-test:incremental` but no broad lane.
    expect(ci).not.toContain('mutation-test:routes')
    expect(ci.toLowerCase()).not.toContain('stryker run stryker.config')
    const broad = rows.find(r => /broad route\/ascii/i.test(r.label))
    expect(broad?.perPR ?? false).toBe(false)
  })
})
