// Loop 9 M3 + M4 — `am render --format layout|unicode|ascii` round-trips.

import { describe, test, expect } from 'bun:test'
import { runCli } from '../cli/index.ts'

function capture(fn: () => number): { code: number; out: string } {
  const chunks: string[] = []
  const orig = process.stdout.write.bind(process.stdout)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ;(process.stdout as any).write = (s: string) => { chunks.push(s); return true }
  let code: number
  try { code = fn() } finally { (process.stdout as any).write = orig }
  return { code, out: chunks.join('') }
}

function withStdin<T>(input: string, fn: () => T): T {
  const orig = process.stdin
  const fakeStdin = { isTTY: false } as unknown as typeof process.stdin
  Object.defineProperty(process, 'stdin', { value: fakeStdin, configurable: true })
  // Stub readFileSync(0) by piping through the existing readSourceArg which
  // reads fd 0; instead we pass through `am batch` which expects stdin. For
  // these tests we use temp files via the FS.
  void input
  try { return fn() } finally { Object.defineProperty(process, 'stdin', { value: orig, configurable: true }) }
}
void withStdin // unused

function tmpFile(source: string): string {
  const { writeFileSync, mkdtempSync } = require('node:fs') as typeof import('node:fs')
  const { tmpdir } = require('node:os') as typeof import('node:os')
  const { join } = require('node:path') as typeof import('node:path')
  const d = mkdtempSync(join(tmpdir(), 'am-render-fmt-'))
  const p = join(d, 'in.mmd')
  writeFileSync(p, source)
  return p
}

describe('am render --format layout', () => {
  test('emits stable layout JSON for flowchart', () => {
    const f = tmpFile('flowchart TD\n  A --> B\n  B --> C\n')
    const { code, out } = capture(() => runCli(['render', '--format', 'layout', f]))
    expect(code).toBe(0)
    const payload = JSON.parse(out) as { nodes: unknown[]; edges: unknown[]; bounds: { w: number; h: number } }
    expect(Array.isArray(payload.nodes)).toBe(true)
    expect(Array.isArray(payload.edges)).toBe(true)
    expect(payload.bounds).toBeDefined()
    expect(typeof payload.bounds.w).toBe('number')
    expect(typeof payload.bounds.h).toBe('number')
    expect(payload.nodes.length).toBeGreaterThanOrEqual(3)
  })
  test('certificates flag includes route certificates without changing default JSON', () => {
    const f = tmpFile('flowchart LR\n  A --> B\n  B --> C\n')
    const regular = capture(() => runCli(['render', '--format', 'layout', f]))
    const withCerts = capture(() => runCli(['render', '--format', 'layout', '--certificates', f]))
    expect(regular.code).toBe(0)
    expect(withCerts.code).toBe(0)
    const plain = JSON.parse(regular.out) as { edges: Array<{ route?: unknown }> }
    const debug = JSON.parse(withCerts.out) as { edges: Array<{ route?: { routeClass: string; invariant: string } }> }
    expect(plain.edges.every(e => e.route === undefined)).toBe(true)
    expect(debug.edges.every(e => e.route?.routeClass === 'primary-forward')).toBe(true)
    expect(debug.edges.every(e => typeof e.route?.invariant === 'string')).toBe(true)
  })
  test('json on sequence diagram surfaces participants as nodes', () => {
    const f = tmpFile('sequenceDiagram\n  A->>B: Hi\n')
    const { code, out } = capture(() => runCli(['render', '--format', 'layout', f]))
    expect(code).toBe(0)
    const payload = JSON.parse(out) as { nodes: Array<{ id: string }>; edges: unknown[] }
    expect(payload.nodes.map(n => n.id)).toContain('A')
    expect(payload.nodes.map(n => n.id)).toContain('B')
  })
  test('parse-fail surfaces structured error', () => {
    const f = tmpFile('flowchart XX\n  A --> B')
    const { code, out } = capture(() => runCli(['render', '--format', 'layout', f]))
    expect(code).toBe(2)
    const payload = JSON.parse(out) as { ok: boolean; error?: { code: string } }
    expect(payload.ok).toBe(false)
    expect(payload.error?.code).toBe('PARSE_FAILED')
  })
})

describe('am render --format ascii vs unicode', () => {
  const SRC = 'flowchart TD\n  Alpha --> Beta\n  Beta --> Gamma\n'

  test('unicode emits box-drawing characters', () => {
    const f = tmpFile(SRC)
    const { code, out } = capture(() => runCli(['render', '--format', 'unicode', f]))
    expect(code).toBe(0)
    // Either dashes / forward arrows — but at minimum it must NOT be pure
    // ASCII. We do a permissive check: bytes above 0x7f exist.
    let hasHigh = false
    for (let i = 0; i < out.length; i++) if (out.charCodeAt(i) > 0x7f) { hasHigh = true; break }
    expect(hasHigh).toBe(true)
  })

  test('ascii emits only 7-bit characters', () => {
    const f = tmpFile(SRC)
    const { code, out } = capture(() => runCli(['render', '--format', 'ascii', f]))
    expect(code).toBe(0)
    for (let i = 0; i < out.length; i++) expect(out.charCodeAt(i)).toBeLessThan(0x80)
  })

  test('unicode and ascii produce different output for the same diagram', () => {
    const f = tmpFile(SRC)
    const a = capture(() => runCli(['render', '--format', 'unicode', f]))
    const b = capture(() => runCli(['render', '--format', 'ascii', f]))
    expect(a.out).not.toBe(b.out)
  })

  test('json wrap uses correct key per format', () => {
    const f = tmpFile(SRC)
    // Pass --json with explicit =true so the file isn't consumed as the flag value.
    const a = capture(() => runCli(['render', '--format', 'unicode', '--json=true', f]))
    const b = capture(() => runCli(['render', '--format', 'ascii', '--json=true', f]))
    expect(JSON.parse(a.out)).toHaveProperty('unicode')
    expect(JSON.parse(b.out)).toHaveProperty('ascii')
  })
})
