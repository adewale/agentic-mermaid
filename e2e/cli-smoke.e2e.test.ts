// Loop 9 M6 — per-family CLI smoke matrix.
//
// Picks one fixture per family from eval/mermaid-docs-corpus/corpus.json
// and spawns `bun run bin/am.ts render <fixture>` against a temp file.
// Asserts exit 0 + non-empty stdout per family.

import { describe, test, expect } from 'bun:test'
import { spawnSync } from 'node:child_process'
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { BUILTIN_FAMILY_METADATA } from '../src/agent/families.ts'

const AM = join(import.meta.dir, '..', 'bin', 'am.ts')
const CORPUS = join(import.meta.dir, '..', 'eval', 'mermaid-docs-corpus', 'corpus.json')
const SPAWN_TIMEOUT_MS = 60_000

interface Fixture { family: string; source: string; origin: string; index: number }

function pickOnePerFamily(): Map<string, Fixture> {
  const corpus = JSON.parse(readFileSync(CORPUS, 'utf8')) as Fixture[]
  const out = new Map<string, Fixture>()
  for (const f of corpus) if (!out.has(f.family)) out.set(f.family, f)
  // The harvested docs corpus intentionally contains only real upstream docs
  // examples. Families absent there still need shipped-CLI coverage, so use
  // the checked built-in metadata example rather than fabricating corpus rows.
  for (const [index, family] of BUILTIN_FAMILY_METADATA.entries()) {
    if (!out.has(family.id)) out.set(family.id, {
      family: family.id, source: family.example, origin: 'BUILTIN_FAMILY_METADATA', index,
    })
  }
  return out
}

const PICKS = pickOnePerFamily()

function spawnAm(args: string[]): { status: number; stdout: string; stderr: string } {
  const r = spawnSync('bun', ['run', AM, ...args], { encoding: 'utf8', timeout: SPAWN_TIMEOUT_MS })
  return { status: r.status ?? -1, stdout: r.stdout, stderr: r.stderr }
}

function writeTmp(source: string): string {
  const d = mkdtempSync(join(tmpdir(), 'am-smoke-'))
  const p = join(d, 'in.mmd')
  writeFileSync(p, source)
  return p
}

describe('am render — per-family smoke', () => {
  test('the CLI matrix covers the built-in registry exactly', () => {
    expect([...PICKS.keys()].sort()).toEqual(BUILTIN_FAMILY_METADATA.map(family => family.id).sort())
  })

  for (const family of [...PICKS.keys()].sort()) {
    test(`${family} renders to SVG without error`, () => {
      const fixture = PICKS.get(family)!
      const file = writeTmp(fixture.source)
      const { status, stdout, stderr } = spawnAm(['render', file])
      expect(status).toBe(0)
      expect(stdout.length).toBeGreaterThan(0)
      // SVG output should start with the standard prelude. For opaque
      // families the renderer may emit a fallback SVG; we only assert
      // the non-empty-stdout contract.
      void stderr
    })
  }
})
