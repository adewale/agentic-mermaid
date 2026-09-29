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

const REPO = join(import.meta.dir, '..', '..')
const read = (rel: string) => readFileSync(join(REPO, rel), 'utf8')

describe('comparison.md ↔ family registry sync', () => {
  test('docs/comparison.md delegates the current inventory to capabilities', () => {
    const md = read('docs/comparison.md')
    expect(md).toContain('am capabilities --json')
    expect(md).toContain('every registered family')
    expect(md).not.toMatch(/\b\d+ diagram families\b/)
    expect(md).not.toMatch(/\bbeyond the \d+ here\b/)
  })
})
