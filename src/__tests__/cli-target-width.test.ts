import { describe, expect, test } from 'bun:test'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { FLAG_SPECS, runCli } from '../cli/index.ts'
import { visualWidth } from '../ascii/width.ts'

function capture(fn: () => number): { code: number; out: string; err: string } {
  const out: string[] = []
  const err: string[] = []
  const originalOut = process.stdout.write.bind(process.stdout)
  const originalErr = process.stderr.write.bind(process.stderr)
  ;(process.stdout as any).write = (chunk: string) => { out.push(chunk); return true }
  ;(process.stderr as any).write = (chunk: string) => { err.push(chunk); return true }
  try { return { code: fn(), out: out.join(''), err: err.join('') } }
  finally {
    ;(process.stdout as any).write = originalOut
    ;(process.stderr as any).write = originalErr
  }
}

function sourceFile(): string {
  const path = join(mkdtempSync(join(tmpdir(), 'am-target-width-')), 'diagram.mmd')
  writeFileSync(path, 'flowchart TD\n  A["日本語 descriptive terminal label"] --> B[Done]\n')
  return path
}

describe('am render --target-width', () => {
  test('enforces display-cell width for terminal output', () => {
    const result = capture(() => runCli(['render', sourceFile(), '--format', 'unicode', '--target-width', '28']))
    expect(result.code).toBe(0)
    expect(Math.max(...result.out.trimEnd().split('\n').map(visualWidth))).toBeLessThanOrEqual(28)
    expect(result.out).toContain('日本語')
  })

  test('returns the typed width error as JSON', () => {
    const result = capture(() => runCli(['render', sourceFile(), '--format', 'unicode', '--target-width', '1', '--json']))
    expect(result.code).toBe(2)
    const payload = JSON.parse(result.out) as { error: Record<string, unknown> }
    expect(payload.error.code).toBe('ASCII_TARGET_WIDTH_IMPOSSIBLE')
    expect(payload.error.requestedWidth).toBe(1)
    expect(payload.error.family).toBe('flowchart')
  })

  test('rejects invalid widths and non-terminal formats', () => {
    expect(capture(() => runCli(['render', sourceFile(), '--target-width', '20'])).code).toBe(2)
    expect(capture(() => runCli(['render', sourceFile(), '--format', 'ascii', '--target-width', '0'])).code).toBe(2)
  })

  test('registers and documents the value flag', () => {
    expect(FLAG_SPECS['target-width']).toEqual({ arg: 'CELLS' })
  })
})
