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

  test('non-TTY stdin (pipe) is consumed end-to-end', async () => {
    // A subprocess gives fd 0 a real, bounded pipe. Calling readFileSync(0)
    // inside bun:test can inherit the runner's open stdin and hang forever.
    const proc = Bun.spawn(
      [process.execPath, 'src/cli/am-bin.ts', 'render', '--format', 'ascii', '-'],
      { cwd: process.cwd(), stdin: 'pipe', stdout: 'pipe', stderr: 'pipe' },
    )
    proc.stdin.write('flowchart LR\n  A --> B\n')
    await proc.stdin.end()

    const [code, out, err] = await Promise.all([
      proc.exited,
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
    ])
    expect(code).toBe(0)
    expect(out).toContain('A')
    expect(out).toContain('B')
    expect(err).not.toContain('needs a file argument')
  })
})
