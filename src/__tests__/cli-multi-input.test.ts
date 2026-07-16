// Loop 13 M4 (#959) + M5 (#930): multi-input rendering + watch re-render step.

import { describe, test, expect } from 'bun:test'
import { readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { runCli, renderFileOnce, watchPathForChanges } from '../cli/index.ts'

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

describe('#930 pathname watch lifecycle', () => {
  test('observes atomic rename-over saves and subsequent writes to the replacement inode', async () => {
    const input = tmp('flowchart TD\n A --> B')
    const replacement = `${input}.replacement`
    const observed: string[] = []
    let notify: (() => void) | undefined
    const waitForChange = () => new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('watch change timed out')), 2_000)
      notify = () => { clearTimeout(timeout); resolve() }
    })
    const handle = watchPathForChanges(input, () => {
      observed.push(readFileSync(input, 'utf8'))
      notify?.()
      notify = undefined
    }, 5)
    try {
      const atomic = waitForChange()
      writeFileSync(replacement, 'flowchart TD\n A --> C')
      renameSync(replacement, input)
      await atomic

      const subsequent = waitForChange()
      writeFileSync(input, 'flowchart TD\n A --> D')
      await subsequent
      expect(observed).toEqual(['flowchart TD\n A --> C', 'flowchart TD\n A --> D'])
    } finally {
      handle.close()
    }
  })
})

describe('#959 multi-input rendering', () => {
  test('renders multiple files, emits a results array, skips bad ones', () => {
    const a = tmp('flowchart TD\n A --> B')
    const b = tmp('flowchart LR\n X --> Y')
    const bad = tmp('not a diagram')
    const { code, out } = capture(() => runCli(['render', a, b, bad, '--format', 'ascii']))
    expect(code).toBe(0)
    const payload = JSON.parse(out)
    expect(payload.files.length).toBe(3)
    expect(payload.files[0].ok).toBe(true)
    expect(payload.files[1].ok).toBe(true)
    expect(payload.files[2].ok).toBe(false)
    expect(payload.files[2].error.code).toBe('UNKNOWN_HEADER')
  })

  test('multi-input json parse errors expose structured details, not stringified blobs', () => {
    const good = tmp('flowchart TD\n A --> B')
    const bad = tmp('flowchart XX\n  A --> B')
    const { code, out } = capture(() => runCli(['render', good, bad, '--format', 'layout']))
    expect(code).toBe(0)
    const payload = JSON.parse(out)
    expect(payload.files[1].ok).toBe(false)
    expect(payload.files[1].error.code).toBe('PARSE_FAILED')
    expect(Array.isArray(payload.files[1].error.details)).toBe(true)
    expect(payload.files[1].error.message).not.toContain('"details"')
  })

  test('single input keeps single-output behavior (no results array)', () => {
    const a = tmp('flowchart TD\n A --> B')
    const { code, out } = capture(() => runCli(['render', a, '--format', 'ascii']))
    expect(code).toBe(0)
    expect(() => JSON.parse(out)).toThrow() // raw ASCII, not a JSON envelope
  })

  test('--security strict applies to multi-input SVG renders', () => {
    const a = tmp('flowchart TD\n A --> B')
    const b = tmp('flowchart LR\n X --> Y')
    const { code, out } = capture(() => runCli(['render', a, b, '--format', 'svg', '--security', 'strict']))
    expect(code).toBe(0)
    const payload = JSON.parse(out)
    expect(payload.files.every((f: any) => f.ok && !f.output.includes('fonts.googleapis.com'))).toBe(true)
  })

  test('invalid --security values are rejected instead of silently using default mode', () => {
    const a = tmp('flowchart TD\n A --> B')
    expect(runCli(['render', a, '--security', 'stric'])).toBe(2)
  })

  test('--watch rejects multiple inputs instead of doing a one-shot multi-render', () => {
    const a = tmp('flowchart TD\n A --> B')
    const b = tmp('flowchart LR\n X --> Y')
    expect(runCli(['render', a, b, '--watch'])).toBe(2)
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

  test('layout format returns layout', () => {
    const f = tmp('flowchart TD\n A --> B')
    const out = JSON.parse(renderFileOnce(f, 'layout'))
    expect(out.kind).toBe('flowchart')
  })

  test('strict SVG option applies to the watch render core', () => {
    const f = tmp('flowchart TD\n A --> B')
    expect(renderFileOnce(f, 'svg', { security: 'strict' })).not.toContain('fonts.googleapis.com')
  })

  test('watch re-renders serialize family diagnostics instead of printing an undefined message', () => {
    for (const fixture of [
      {
        source: 'futureDiagram&#45;v99\n  payload',
        code: 'UNKNOWN_HEADER',
        authoredHeader: 'futureDiagram&#45;v99',
      },
      {
        source: 'C4&#68;eployment\n  Deployment_Node(a, "A")',
        code: 'UNSUPPORTED_FAMILY',
        authoredHeader: 'C4&#68;eployment',
      },
    ]) {
      const payload = JSON.parse(renderFileOnce(tmp(fixture.source), 'svg'))
      expect(payload).toMatchObject({
        ok: false,
        error: {
          code: fixture.code,
          line: 1,
          preservation: { source: fixture.source },
          help: expect.stringContaining('source was preserved unchanged'),
        },
      })
      expect(payload.error.message).not.toContain('undefined')
      const span = payload.error.preservation.spans.header
      expect(fixture.source.slice(span.start.offset, span.end.offset)).toBe(fixture.authoredHeader)
    }
  })

  test('watch mode rejects PNG instead of writing SVG to a PNG path', () => {
    const f = tmp('flowchart TD\n A --> B')
    const code = runCli(['render', f, '--format', 'png', '--output', `${f}.png`, '--watch'])
    expect(code).toBe(2)
  })

  test('PNG rejects non-positive and non-finite scales as argument errors', () => {
    const f = tmp('flowchart TD\n A --> B')
    const output = `${f}.png`
    for (const scale of ['0', '-1', 'NaN', 'Infinity']) {
      expect(runCli(['render', f, '--format', 'png', '--output', output, '--scale', scale])).toBe(2)
    }
  })
})
