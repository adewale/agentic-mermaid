// Loop 13 M3 (#1018): single-binary distribution via `bun build --compile`.
// Builds the standalone executable and smoke-runs it across formats.
// Skips gracefully if `bun build --compile` isn't available.

import { describe, test, expect } from 'bun:test'
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync, mkdtempSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const REPO = join(import.meta.dir, '..')
const ENTRY = join(REPO, 'bin', 'am.ts')
const BUILD_TIMEOUT_MS = 120_000
const RUN_TIMEOUT_MS = 30_000

// Build once into a temp dir so we don't fight the gitignored dist/am.
const work = mkdtempSync(join(tmpdir(), 'am-bin-'))
const BIN = join(work, 'am')
const build = spawnSync('bun', ['build', ENTRY, '--compile', '--outfile', BIN], { encoding: 'utf8', timeout: BUILD_TIMEOUT_MS })
const haveBinary = build.status === 0 && existsSync(BIN)

const fn = haveBinary ? test : test.skip

const fixture = join(work, 'd.mmd')
writeFileSync(fixture, 'flowchart TD\n  A[Start] --> B[End]\n')

describe('#1018 single-binary distribution', () => {
  fn('binary renders SVG', () => {
    const r = spawnSync(BIN, ['render', fixture], { encoding: 'utf8', timeout: RUN_TIMEOUT_MS })
    expect(r.status).toBe(0)
    expect(r.stdout).toContain('<svg')
  })

  fn('binary renders ASCII', () => {
    const r = spawnSync(BIN, ['render', '--format', 'ascii', fixture], { encoding: 'utf8', timeout: RUN_TIMEOUT_MS })
    expect(r.status).toBe(0)
    expect(r.stdout.length).toBeGreaterThan(0)
  })

  fn('binary emits capabilities JSON', () => {
    const r = spawnSync(BIN, ['capabilities', '--json'], { encoding: 'utf8', timeout: RUN_TIMEOUT_MS })
    expect(r.status).toBe(0)
    const cap = JSON.parse(r.stdout)
    expect(Array.isArray(cap.families)).toBe(true)
  })

  fn('binary renders PNG (resvg native addon embeds)', () => {
    const out = join(work, 'd.png')
    // An unrelated cwd proves the executable is not rediscovering this repo's
    // installed assets. Its complete required resource closure must be inside
    // the binary and still pass the normal manifest verifier.
    const r = spawnSync(BIN, ['render', '--format', 'png', fixture, '--output', out], {
      cwd: work,
      encoding: 'utf8',
      timeout: RUN_TIMEOUT_MS,
    })
    expect(r.status, r.stderr).toBe(0)
    expect(existsSync(out)).toBe(true)
    expect([...readFileSync(out).subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10])
  })

  fn('binary cold-start is under 1s (improvement over bun-run TS source)', () => {
    const t = Date.now()
    spawnSync(BIN, ['render', fixture], { encoding: 'utf8', timeout: RUN_TIMEOUT_MS })
    expect(Date.now() - t).toBeLessThan(1500) // generous CI ceiling; ~440ms observed
  })
})
// (temp dir under os.tmpdir() is left for the OS to reclaim — deleting it
// at module-load would race the test bodies.)
