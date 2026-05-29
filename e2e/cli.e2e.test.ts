// E2E coverage for the new Loop 7 CLI verbs.
//
// Spawns the real `bin/am.ts` via `bun run` and pipes JSONL / source via
// stdin, asserting:
//   - capabilities emits well-formed JSON
//   - batch processes 5 lines (3 happy, 1 malformed JSON, 1 unknown op) and
//     keeps going after errors, exiting 0
//   - exit codes: 2 on arg error, 3 on verify-failed

import { describe, test, expect } from 'bun:test'
import { spawnSync } from 'node:child_process'
import { join } from 'node:path'

const AM = join(import.meta.dir, '..', 'bin', 'am.ts')

function runAm(args: string[], stdin = ''): { status: number; stdout: string; stderr: string } {
  const r = spawnSync('bun', ['run', AM, ...args], {
    encoding: 'utf8',
    input: stdin,
  })
  return { status: r.status ?? -1, stdout: r.stdout, stderr: r.stderr }
}

describe('am capabilities', () => {
  test('emits a JSON envelope with the expected top-level keys', () => {
    const { status, stdout } = runAm(['capabilities'])
    expect(status).toBe(0)
    const payload = JSON.parse(stdout)
    expect(typeof payload.sdkVersion).toBe('string')
    expect(Array.isArray(payload.families)).toBe(true)
    expect(payload.families.length).toBeGreaterThan(0)
    expect(Array.isArray(payload.warningCodes)).toBe(true)
    expect(payload.warningCodes.length).toBeGreaterThan(0)
    expect(payload.outputFormats).toEqual(['svg', 'ascii', 'unicode', 'png', 'json'])
  })
})

describe('am batch', () => {
  test('processes 5 lines with mixed validity and exits 0', () => {
    const validRender = JSON.stringify({ op: 'render', source: 'flowchart LR\n  A --> B', options: { ascii: true } })
    const validVerify = JSON.stringify({ op: 'verify', source: 'flowchart LR\n  A --> B' })
    const malformed = '{not valid json'
    const unknownOp = JSON.stringify({ op: 'nope', source: 'x' })
    // Large source > 10KB. Use long ASCII labels rather than many nodes so the
    // layout engine doesn't blow the wallclock budget.
    const longLabel = 'x'.repeat(200)
    const big = JSON.stringify({ op: 'render', source: `flowchart LR\n  A["${longLabel}"] --> B["${longLabel}"]\n  B --> C["${longLabel}"]\n  C --> D["${longLabel}"]\n  D --> E["${longLabel}"]\n  E --> F["${longLabel}"]\n  F --> G["${longLabel}"]\n  G --> H["${longLabel}"]\n  H --> I["${longLabel}"]\n  I --> J["${longLabel}"]\n  J --> K["${longLabel}"]\n  K --> L["${longLabel}"]\n  L --> M["${longLabel}"]\n  M --> N["${longLabel}"]\n`, options: { ascii: true } })
    const stdin = [validRender, validVerify, malformed, unknownOp, big].join('\n') + '\n'

    const { status, stdout } = runAm(['batch'], stdin)
    expect(status).toBe(0)
    const lines = stdout.trim().split('\n')
    expect(lines.length).toBe(5)

    const out = lines.map(l => JSON.parse(l))
    expect(out[0].ok).toBe(true)
    expect(out[0].op).toBe('render')
    expect(typeof out[0].data.ascii).toBe('string')

    expect(out[1].ok).toBe(true)
    expect(out[1].op).toBe('verify')
    expect(Array.isArray(out[1].data.warnings)).toBe(true)

    expect(out[2].ok).toBe(false)
    expect(out[2].error.code).toBe('INVALID_JSON')

    expect(out[3].ok).toBe(false)
    expect(out[3].error.code).toBe('UNKNOWN_OP')

    expect(out[4].ok).toBe(true)
    expect(out[4].op).toBe('render')
    expect(typeof out[4].data.ascii).toBe('string')
  })

  test('an empty line is skipped silently', () => {
    const { status, stdout } = runAm(['batch'], '\n\n\n')
    expect(status).toBe(0)
    expect(stdout.trim()).toBe('')
  })
})

describe('am exit codes', () => {
  test('unknown command exits 2', () => {
    const { status } = runAm(['no-such-command'])
    expect(status).toBe(2)
  })

  test('verify on a diagram with errors exits 3', () => {
    // Empty diagram body → EMPTY_DIAGRAM (severity error) → ok=false → exit 3
    const r = spawnSync('bun', ['run', AM, 'verify', '-'], { encoding: 'utf8', input: 'flowchart LR\n' })
    expect(r.status).toBe(3)
    const payload = JSON.parse(r.stdout)
    expect(payload.ok).toBe(false)
  })

  test('verify on a clean diagram exits 0', () => {
    const r = spawnSync('bun', ['run', AM, 'verify', '-'], { encoding: 'utf8', input: 'flowchart LR\n  A --> B\n' })
    expect(r.status).toBe(0)
    const payload = JSON.parse(r.stdout)
    expect(payload.ok).toBe(true)
  })

  test('mutate with a missing --op flag exits 2', () => {
    const r = spawnSync('bun', ['run', AM, 'mutate', '-'], { encoding: 'utf8', input: 'flowchart LR\n  A --> B\n' })
    expect(r.status).toBe(2)
  })

  test('mutate with malformed --op JSON exits 2', () => {
    const r = spawnSync('bun', ['run', AM, 'mutate', '-', '--op', '{bad'], { encoding: 'utf8', input: 'flowchart LR\n  A --> B\n' })
    expect(r.status).toBe(2)
  })

  test('Loop 8 P: render --format png writes a valid PNG to -o file', () => {
    const { writeFileSync, readFileSync, existsSync, unlinkSync } = require('node:fs') as typeof import('node:fs')
    const tmpSrc = `/tmp/loop8-png-input-${Date.now()}.mmd`
    const tmpOut = `/tmp/loop8-png-output-${Date.now()}.png`
    writeFileSync(tmpSrc, 'flowchart LR\n  A --> B --> C\n')
    try {
      const r = spawnSync('bun', ['run', AM, 'render', '--format', 'png', tmpSrc, '--output', tmpOut], { encoding: 'utf8' })
      expect(r.status).toBe(0)
      expect(existsSync(tmpOut)).toBe(true)
      const png = readFileSync(tmpOut)
      // PNG magic bytes
      expect([png[0], png[1], png[2], png[3]]).toEqual([0x89, 0x50, 0x4E, 0x47])
      expect(png.length).toBeGreaterThan(100)
    } finally {
      if (existsSync(tmpSrc)) unlinkSync(tmpSrc)
      if (existsSync(tmpOut)) unlinkSync(tmpOut)
    }
  })

  test('Loop 8 P: render --format png without -o exits 2 (would corrupt stdout)', () => {
    const { writeFileSync, existsSync, unlinkSync } = require('node:fs') as typeof import('node:fs')
    const tmpSrc = `/tmp/loop8-png-noout-${Date.now()}.mmd`
    writeFileSync(tmpSrc, 'flowchart LR\n  A --> B\n')
    try {
      const r = spawnSync('bun', ['run', AM, 'render', '--format', 'png', tmpSrc], { encoding: 'utf8' })
      expect(r.status).toBe(2)
    } finally {
      if (existsSync(tmpSrc)) unlinkSync(tmpSrc)
    }
  })

  test('Loop 8 P: capabilities now advertises png in outputFormats', () => {
    const r = runAm(['capabilities', '--json'])
    expect(r.status).toBe(0)
    const cap = JSON.parse(r.stdout) as { outputFormats: string[] }
    expect(cap.outputFormats).toContain('png')
  })
})
