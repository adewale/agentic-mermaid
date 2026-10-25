// CLI --gantt-today flag + unknown-flag rejection (family-elevation-plan
// §Gantt item 3): the ganttToday RenderOption existed but was unreachable
// from the CLI, and unknown flags were silently swallowed (probe: `am render
// x.mmd --gantt-toady 2024-01-05` exited 0 with no marker and no complaint).

import { describe, test, expect } from 'bun:test'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { runCli } from '../cli/index.ts'
import { decodePng } from './helpers/png-pixels.ts'
import { useTempDirs } from './helpers/temp-dir.ts'

const temp = useTempDirs()

function capture(fn: () => number | Promise<number>): { code: number; out: string; err: string } {
  const outChunks: string[] = []
  const errChunks: string[] = []
  const origOut = process.stdout.write.bind(process.stdout)
  const origErr = process.stderr.write.bind(process.stderr)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ;(process.stdout as any).write = (s: string) => { outChunks.push(s); return true }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ;(process.stderr as any).write = (s: string) => { errChunks.push(s); return true }
  let code: number
  try {
    const result = fn()
    if (typeof result !== 'number') throw new Error('Expected a synchronous command')
    code = result
  } finally {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(process.stdout as any).write = origOut
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(process.stderr as any).write = origErr
  }
  return { code, out: outChunks.join(''), err: errChunks.join('') }
}

function tmpFile(source: string): string {
  const p = join(temp.dir('am-gantt-cli-'), 'in.mmd')
  writeFileSync(p, source)
  return p
}

// Two tasks so the time range extends past each bar — the today column must
// land on track cells (ASCII draws the marker only where no bar covers it).
const GANTT = 'gantt\n  dateFormat YYYY-MM-DD\n  A :a, 2024-01-01, 5d\n  B :b, after a, 5d\n'

describe('am render --gantt-today', () => {
  test('draws the today marker in SVG output', () => {
    const MARKER = '<line class="gantt-today-marker"'
    const f = tmpFile(GANTT)
    const without = capture(() => runCli(['render', f]))
    expect(without.code).toBe(0)
    expect(without.out).not.toContain(MARKER)
    const withFlag = capture(() => runCli(['render', f, '--gantt-today', '2024-01-08']))
    expect(withFlag.code).toBe(0)
    expect(withFlag.out).toContain(MARKER)
  })

  test('--gantt-today=DATE form works and reaches the unicode renderer', () => {
    const f = tmpFile(GANTT)
    const r = capture(() => runCli(['render', '--format', 'unicode', `--gantt-today=2024-01-08`, f]))
    expect(r.code).toBe(0)
    expect(r.out).toContain('╎') // the unicode today column glyph
  })

})

describe('unknown CLI flags error instead of being silently swallowed', () => {
  test('removed render --ascii shorthand exits 2', () => {
    const f = tmpFile(GANTT)
    const r = capture(() => runCli(['render', f, '--ascii']))
    expect(r.code).toBe(2)
    expect(r.err).toContain('--ascii')
    expect(r.out).not.toContain('<svg')
  })

  test('removed layout spelling --format json exits 2', () => {
    const f = tmpFile(GANTT)
    const r = capture(() => runCli(['render', f, '--format', 'json']))
    expect(r.code).toBe(2)
    expect(r.err).toContain('json')
    expect(r.out).not.toContain('<svg')
  })

  test('a typo flag exits 2 and names itself', () => {
    const f = tmpFile(GANTT)
    const r = capture(() => runCli(['render', f, '--gantt-toady', '2024-01-05']))
    expect(r.code).toBe(2)
    expect(r.err).toContain('--gantt-toady')
    expect(r.out).not.toContain('<svg')
  })

  test('unknown boolean-looking flags error too', () => {
    const f = tmpFile(GANTT)
    const r = capture(() => runCli(['render', f, '--frobnicate']))
    expect(r.code).toBe(2)
    expect(r.err).toContain('--frobnicate')
  })

  test('with --json the error is a structured envelope', () => {
    const f = tmpFile(GANTT)
    const r = capture(() => runCli(['render', f, '--json', '--frobnicate']))
    expect(r.code).toBe(2)
    const payload = JSON.parse(r.out) as { ok: boolean; error: { code: string; message: string } }
    expect(payload.ok).toBe(false)
    expect(payload.error.message).toContain('--frobnicate')
  })

  test('previously-undocumented but real flags (--scale, --bg, --o) stay accepted', () => {
    const file = tmpFile(GANTT)
    const basePath = join(temp.dir('am-gantt-png-'), 'base.png')
    const scaledPath = join(temp.dir('am-gantt-png-'), 'scaled.png')
    expect(capture(() => runCli(['render', file, '--format', 'png', '--o', basePath, '--scale', '1'])).code).toBe(0)
    expect(capture(() => runCli(['render', file, '--format', 'png', '--o', scaledPath, '--scale', '2', '--bg', '#102030'])).code).toBe(0)
    const base = decodePng(readFileSync(basePath))
    const scaled = decodePng(readFileSync(scaledPath))
    // Scaling happens before each output's independent integer rounding.
    for (const [baseSize, scaledSize] of [[base.width, scaled.width], [base.height, scaled.height]] as const) {
      expect(scaledSize).toBeGreaterThanOrEqual(baseSize * 2 - 1)
      expect(scaledSize).toBeLessThanOrEqual(baseSize * 2)
    }
    expect(Array.from(scaled.rgba.slice(0, 4))).toEqual([16, 32, 48, 255])
  })

  test('--help still works and known commands are unaffected', () => {
    const r = capture(() => runCli(['--help']))
    expect(r.code).toBe(0)
    expect(r.out).toContain('Usage: am')
  })
})
