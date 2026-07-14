// Loop 12 M1: CLI error envelope carries structured ParseError[] in `details`
// rather than JSON-stringifying it into `message`.

import { describe, test, expect } from 'bun:test'
import { runCli } from '../cli/index.ts'

function capture(fn: () => number): { code: number; out: string } {
  const chunks: string[] = []
  const orig = process.stdout.write.bind(process.stdout)
  process.stdout.write = ((s: string) => { chunks.push(typeof s === 'string' ? s : String(s)); return true }) as typeof process.stdout.write
  let code = -1
  try { code = fn() } finally { process.stdout.write = orig }
  return { code, out: chunks.join('') }
}

import { writeFileSync } from 'node:fs'
function tmp(content: string): string {
  const p = `/tmp/cli-err-${Date.now()}-${Math.random().toString(36).slice(2)}.mmd`
  writeFileSync(p, content)
  return p
}

describe('M1 CLI structured error envelope', () => {
  test('am parse error: message is a human string, details is the ParseError[]', () => {
    const { code, out } = capture(() => runCli(['parse', tmp('flowchart XX\n  A --> B')]))
    expect(code).toBe(2)
    const payload = JSON.parse(out)
    expect(payload.ok).toBe(false)
    expect(payload.error.code).toBe('PARSE_FAILED')
    // message is a short human string, NOT a JSON-stringified array
    expect(typeof payload.error.message).toBe('string')
    expect(payload.error.message.startsWith('[')).toBe(false)
    // details is the structured array an agent can consume directly
    expect(Array.isArray(payload.error.details)).toBe(true)
    expect(payload.error.details[0].code).toBe('PARSE_FAILED')
  })

  test('am render --format json error: same structured shape', () => {
    const { code, out } = capture(() => runCli(['render', '--format', 'json', tmp('flowchart XX\n  A --> B')]))
    expect(code).toBe(2)
    const payload = JSON.parse(out)
    expect(payload.error.code).toBe('PARSE_FAILED')
    expect(Array.isArray(payload.error.details)).toBe(true)
  })

  test('unknown headers parse into a preserved forward-compatible envelope', () => {
    const source = 'futureDiagram-v99\n  untouched payload\n'
    const { code, out } = capture(() => runCli(['parse', tmp(source)]))
    expect(code).toBe(0)
    const payload = JSON.parse(out)
    expect(payload).toMatchObject({
      kind: 'family:unknown',
      body: {
        kind: 'preserved',
        source,
        diagnostic: { code: 'UNKNOWN_HEADER' },
        preservation: { classification: 'unknown', source },
      },
    })
  })

  test('unknown headers remain a structured capability failure on render', () => {
    const source = 'futureDiagram-v99\n  payload'
    const { code, out } = capture(() => runCli(['render', '--format', 'json', tmp(source)]))
    expect(code).toBe(2)
    const payload = JSON.parse(out)
    expect(payload).toMatchObject({
      ok: false,
      error: {
        code: 'UNKNOWN_HEADER',
        line: 1,
        preservation: { source, header: 'futureDiagram-v99' },
        help: expect.stringContaining('source was preserved unchanged'),
      },
    })
  })

  test('successful am parse still emits the bare ValidDiagram (pipe contract intact)', () => {
    const { code, out } = capture(() => runCli(['parse', tmp('flowchart TD\n A --> B')]))
    expect(code).toBe(0)
    const payload = JSON.parse(out)
    // success path is NOT wrapped in {ok,error} — it's the diagram itself
    expect(payload.ok).toBeUndefined()
    expect(payload.kind).toBe('flowchart')
  })
})
