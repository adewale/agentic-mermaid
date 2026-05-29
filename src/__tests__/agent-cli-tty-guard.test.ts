// Loop 9 M5 — TTY-stdin guard. The CLI should fail fast (exit 2, clear
// message) when called without a file argument AND stdin is an interactive
// terminal — otherwise it blocks forever waiting for the user to paste.
//
// node-pty is the canonical way to verify this end-to-end. Skipped here
// because node-pty isn't in dev-deps; the unit test mocks process.stdin.isTTY
// directly.

import { describe, test, expect } from 'bun:test'
import { runCli } from '../cli/index.ts'

describe('TTY-stdin guard', () => {
  function withTty<T>(isTTY: boolean, fn: () => T): T {
    const prev = (process.stdin as { isTTY?: boolean }).isTTY
    Object.defineProperty(process.stdin, 'isTTY', { value: isTTY, configurable: true })
    try { return fn() } finally {
      Object.defineProperty(process.stdin, 'isTTY', { value: prev, configurable: true })
    }
  }

  function captureErr(fn: () => number): { code: number; err: string } {
    const chunks: string[] = []
    const orig = process.stderr.write.bind(process.stderr)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(process.stderr as any).write = (s: string) => { chunks.push(s); return true }
    let code: number
    try { code = fn() } finally { (process.stderr as any).write = orig }
    return { code, err: chunks.join('') }
  }

  test('no arg + TTY stdin → exit 2 with hint', () => {
    const r = withTty(true, () => captureErr(() => runCli(['render'])))
    expect(r.code).toBe(2)
    expect(r.err).toContain('needs a file argument or piped stdin')
  })

  test("'-' + TTY stdin → exit 2 with hint", () => {
    const r = withTty(true, () => captureErr(() => runCli(['render', '-'])))
    expect(r.code).toBe(2)
    expect(r.err).toContain('needs a file argument or piped stdin')
  })

  test('non-TTY stdin (pipe) is allowed through', () => {
    // We don't need to verify the actual read — just that the TTY guard
    // doesn't fire. We allow the call to proceed; the actual file read
    // happens on fd 0 which is fine under the test runner.
    const r = withTty(false, () => {
      // Wrap in try because the actual stdin under bun:test is not a real
      // pipe and may error or hang; we just need to confirm the guard
      // doesn't throw the "needs a file argument" message immediately.
      const chunks: string[] = []
      const errChunks: string[] = []
      const origOut = process.stdout.write.bind(process.stdout)
      const origErr = process.stderr.write.bind(process.stderr)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ;(process.stdout as any).write = (s: string) => { chunks.push(s); return true }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ;(process.stderr as any).write = (s: string) => { errChunks.push(s); return true }
      try {
        const code = runCli(['render', '-'])
        return { code, err: errChunks.join('') }
      } finally {
        (process.stdout as any).write = origOut
        ;(process.stderr as any).write = origErr
      }
    })
    expect(r.err).not.toContain('needs a file argument')
  })
})
