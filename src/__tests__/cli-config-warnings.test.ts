import { describe, expect, test } from 'bun:test'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runCli } from '../cli/index.ts'

const SOURCE = `---
config:
  state:
    titleTopMargin: 10
---
stateDiagram-v2
  A --> B
`

function fixture(): { source: string; png: string } {
  const dir = mkdtempSync(join(tmpdir(), 'am-config-warning-'))
  const source = join(dir, 'state.mmd')
  writeFileSync(source, SOURCE)
  return { source, png: join(dir, 'state.png') }
}

function capture(fn: () => number): { code: number; out: string; err: string } {
  const out: string[] = []
  const err: string[] = []
  const originalOut = process.stdout.write.bind(process.stdout)
  const originalErr = process.stderr.write.bind(process.stderr)
  ;(process.stdout as any).write = (chunk: string) => { out.push(chunk); return true }
  ;(process.stderr as any).write = (chunk: string) => { err.push(chunk); return true }
  try { return { code: fn(), out: out.join(''), err: err.join('') } } finally {
    ;(process.stdout as any).write = originalOut
    ;(process.stderr as any).write = originalErr
  }
}

describe('CLI render config diagnostics', () => {
  test('SVG warns on stderr and includes the qualified warning in --json', () => {
    const { source } = fixture()
    const plain = capture(() => runCli(['render', source]))
    expect(plain.code).toBe(0)
    expect(plain.err).toContain('INEFFECTIVE_CONFIG (state.titleTopMargin)')

    const json = capture(() => runCli(['render', source, '--json']))
    expect(json.code).toBe(0)
    expect(JSON.parse(json.out).warnings).toContainEqual(expect.objectContaining({ field: 'state.titleTopMargin' }))
  })

  test('PNG combines source config diagnostics with raster warnings in its JSON envelope', () => {
    const { source, png } = fixture()
    const result = capture(() => runCli(['render', source, '--format', 'png', '--output', png, '--json']))
    expect(result.code).toBe(0)
    expect(result.err.match(/state\.titleTopMargin/g)).toHaveLength(1)
    expect(JSON.parse(result.out).warnings).toContainEqual(expect.objectContaining({ field: 'state.titleTopMargin' }))
  })
})
