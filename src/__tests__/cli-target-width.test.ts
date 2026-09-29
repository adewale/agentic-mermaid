import { describe, expect, test } from 'bun:test'
import { runCli } from '../cli/index.ts'
import { visualWidth } from '../ascii/width.ts'
import { captureCli as capture } from './helpers/p00-cli-capture.ts'
import { useTempDirs } from './helpers/p00-temp-dir.ts'

const temp = useTempDirs('am-target-width-')

function sourceFile(): string {
  return temp.file('diagram.mmd', 'flowchart TD\n  A["日本語 descriptive terminal label"] --> B[Done]\n')
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

  test('documents the value flag in render help', () => {
    const help = capture(() => runCli(['render', '--help']))
    expect(help.code).toBe(0)
    expect(help.out).toMatch(/--target-width <CELLS>/)
  })
})
