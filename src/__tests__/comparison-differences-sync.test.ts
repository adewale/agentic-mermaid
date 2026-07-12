// Drift guard for the diagram-family coverage facts.
//
// docs/comparison.md must route readers to the runtime family inventory rather
// than copying counts or lists that silently drift from code.
//
// (The former scripts/site/differences.ts checks were retired with that Pages
// generator. The Cloudflare site's family coverage is pinned elsewhere: the
// /comparisons page renders a curated per-family COMPARISON_CASES set, the
// families-reference lead count is derived from the registry in website/build.ts,
// and both are checked by website-build.test.ts + the citizenship matrix.)

import { describe, test, expect } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { BUILTIN_FAMILY_METADATA } from '../agent/families.ts'

const REPO = join(import.meta.dir, '..', '..')
const read = (rel: string) => readFileSync(join(REPO, rel), 'utf8')
const asSet = (xs: string[]) => [...xs].map(s => s.trim().toLowerCase()).sort()

// Families upstream Beautiful Mermaid already renders. A stable external fact;
// the fork-"added" families are everything in the registry beyond these.
const UPSTREAM_BASE = ['flowchart', 'state', 'sequence', 'class', 'er', 'xychart']

const registryIds = BUILTIN_FAMILY_METADATA.map(f => String(f.id))
const forkAdded = registryIds.filter(id => !UPSTREAM_BASE.includes(id))

describe('comparison.md ↔ family registry sync', () => {
  test('UPSTREAM_BASE cleanly partitions the registry (guards this test premise)', () => {
    for (const id of UPSTREAM_BASE) expect(registryIds).toContain(id)
    expect(asSet([...UPSTREAM_BASE, ...forkAdded])).toEqual(asSet(registryIds))
  })

  test('docs/comparison.md delegates the current inventory to capabilities', () => {
    const md = read('docs/comparison.md')
    expect(md).toContain('am capabilities --json')
    expect(md).toContain('every registered family')
    expect(md).not.toMatch(/\b\d+ diagram families\b/)
    expect(md).not.toMatch(/\bbeyond the \d+ here\b/)
  })
})
