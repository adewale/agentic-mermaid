// Loop 12 M1: CLI error envelope carries structured ParseError[] in `details`
// rather than JSON-stringifying it into `message`.

import { describe, test, expect } from 'bun:test'
import { runCli } from '../cli/index.ts'
import { captureCli as capture } from './helpers/cli-capture.ts'
import { useTempDirs } from './helpers/temp-dir.ts'

const temp = useTempDirs('am-cli-err-')
const tmp = (content: string): string => temp.file('input.mmd', content)

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

  test('am render --format layout error: same structured shape', () => {
    const { code, out } = capture(() => runCli(['render', '--format', 'layout', tmp('flowchart XX\n  A --> B')]))
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
    const { code, out } = capture(() => runCli(['render', '--format', 'layout', tmp(source)]))
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
