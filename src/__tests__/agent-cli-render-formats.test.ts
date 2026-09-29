// Loop 9 M3 + M4 — `am render --format layout|unicode|ascii` round-trips.

import { describe, test, expect } from 'bun:test'
import { layoutMermaid, parseRegisteredMermaid } from '../agent/index.ts'
import { runCli } from '../cli/index.ts'
import { captureCli as capture } from './helpers/p00-cli-capture.ts'
import { useTempDirs } from './helpers/p00-temp-dir.ts'


const temp = useTempDirs('am-render-fmt-')
const tmpFile = (source: string): string => temp.file('in.mmd', source)

describe('am render --format layout', () => {
  test('emits the library layout JSON for flowchart (CLI ≡ layoutMermaid, plus a receipt)', () => {
    const source = 'flowchart TD\n  A --> B\n  B --> C\n'
    const { code, out } = capture(() => runCli(['render', '--format', 'layout', tmpFile(source)]))
    expect(code).toBe(0)
    const { receipt, ...layout } = JSON.parse(out) as { receipt: unknown }
    expect(receipt).toEqual(expect.objectContaining({ sharedRequestDigest: expect.any(String) }))
    const parsed = parseRegisteredMermaid(source)
    if (!parsed.ok) throw new Error('fixture must parse')
    expect(layout).toEqual(JSON.parse(JSON.stringify(layoutMermaid(parsed.value))))
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
    // Boolean classification is authority-derived, so --json never consumes the file.
    const a = capture(() => runCli(['render', '--format', 'unicode', '--json', f]))
    const b = capture(() => runCli(['render', '--format', 'ascii', '--json', f]))
    expect(JSON.parse(a.out)).toHaveProperty('unicode')
    expect(JSON.parse(b.out)).toHaveProperty('ascii')
  })
})
