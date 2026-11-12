// Loop 9 M3 + M4 — `am render --format layout|unicode|ascii` round-trips.

import { describe, test, expect } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { layoutMermaid, parseRegisteredMermaid } from '../agent/index.ts'
import { runCli } from '../cli/index.ts'
import { captureCli as capture } from './helpers/cli-capture.ts'
import { useTempDirs } from './helpers/temp-dir.ts'


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
    expect(plain.edges).toHaveLength(2)
    expect(debug.edges).toHaveLength(2)
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
    expect(out).toMatch(/[\u2500-\u257f]/)
    for (const label of ['Alpha', 'Beta', 'Gamma']) expect(out).toContain(label)
  })

  test('ascii emits only 7-bit characters', () => {
    const f = tmpFile(SRC)
    const { code, out } = capture(() => runCli(['render', '--format', 'ascii', f]))
    expect(code).toBe(0)
    for (let i = 0; i < out.length; i++) expect(out.charCodeAt(i)).toBeLessThan(0x80)
  })

  test('--json success is an ok envelope; --output keeps the plain artifact and reports the write', () => {
    const f = tmpFile(SRC)
    for (const format of ['svg', 'ascii', 'unicode', 'layout'] as const) {
      const plain = capture(() => runCli(['render', '--format', format, f]))
      // Boolean classification is authority-derived, so --json never consumes the file.
      const wrapped = JSON.parse(capture(() => runCli(['render', '--format', format, '--json', f])).out)
      expect(wrapped, format).toMatchObject({ ok: true, receipt: { sharedRequestDigest: expect.any(String) } })
      if (format !== 'layout') expect({ format, wrapsPlain: wrapped[format].length > 0 && plain.out.startsWith(wrapped[format]) }).toEqual({ format, wrapsPlain: true })
      const output = join(temp.dir('am-render-out-'), `diagram.${format}`)
      const written = capture(() => runCli(['render', '--format', format, '--output', output, '--json', f]))
      const file = readFileSync(output, 'utf8')
      expect({ format, code: written.code, file }).toEqual({ format, code: 0, file: plain.out })
      if (format === 'svg') expect(file.startsWith('<svg')).toBe(true)
      expect(JSON.parse(written.out), format).toEqual({ ok: true, path: output, bytes: Buffer.byteLength(file), receipt: wrapped.receipt, warnings: [] })
    }
  })
})
