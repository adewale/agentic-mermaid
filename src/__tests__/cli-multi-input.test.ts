// Loop 13 M4 (#959) + M5 (#930): multi-input rendering + watch re-render step.

import { describe, test, expect } from 'bun:test'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { runCli, renderFileOnce } from '../cli/index.ts'

function tmp(content: string): string {
  const p = join(tmpdir(), `mi-${Date.now()}-${Math.random().toString(36).slice(2)}.mmd`)
  writeFileSync(p, content)
  return p
}
function capture(fn: () => number): { code: number; out: string } {
  const chunks: string[] = []
  const orig = process.stdout.write.bind(process.stdout)
  process.stdout.write = ((s: string) => { chunks.push(String(s)); return true }) as typeof process.stdout.write
  let code = -1
  try { code = fn() } finally { process.stdout.write = orig }
  return { code, out: chunks.join('') }
}

describe('#959 multi-input rendering', () => {
  test('renders multiple files, emits a results array, skips bad ones', () => {
    const a = tmp('flowchart TD\n A --> B')
    const b = tmp('flowchart LR\n X --> Y')
    const bad = tmp('not a diagram')
    const { code, out } = capture(() => runCli(['render', a, b, bad, '--ascii']))
    expect(code).toBe(0)
    const payload = JSON.parse(out)
    expect(payload.files.length).toBe(3)
    expect(payload.files[0].ok).toBe(true)
    expect(payload.files[1].ok).toBe(true)
    expect(payload.files[2].ok).toBe(false)
    expect(payload.files[2].error.code).toBe('RENDER_FAILED')
  })

  test('single input keeps single-output behavior (no results array)', () => {
    const a = tmp('flowchart TD\n A --> B')
    const { code, out } = capture(() => runCli(['render', a, '--ascii']))
    expect(code).toBe(0)
    expect(() => JSON.parse(out)).toThrow() // raw ASCII, not a JSON envelope
  })
})

describe('#930 watch re-render step (renderFileOnce)', () => {
  test('re-renders SVG from the current file contents', () => {
    const f = tmp('flowchart TD\n A[One] --> B[Two]')
    expect(renderFileOnce(f, 'svg')).toContain('<svg')
  })

  test('reflects file changes on re-invocation (the watch loop core)', () => {
    const f = tmp('flowchart TD\n A[Before]')
    expect(renderFileOnce(f, 'ascii')).toContain('Before')
    writeFileSync(f, 'flowchart TD\n A[After]')
    expect(renderFileOnce(f, 'ascii')).toContain('After')
  })

  test('json format returns layout', () => {
    const f = tmp('flowchart TD\n A --> B')
    const out = JSON.parse(renderFileOnce(f, 'json'))
    expect(out.kind).toBe('flowchart')
  })
})
