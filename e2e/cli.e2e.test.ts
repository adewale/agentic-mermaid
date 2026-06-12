// E2E coverage for the new Loop 7 CLI verbs.
//
// Spawns the real `bin/am.ts` via `bun run` and pipes JSONL / source via
// stdin, asserting:
//   - capabilities emits well-formed JSON
//   - batch processes 5 lines (3 happy, 1 malformed JSON, 1 unknown op) and
//     keeps going after errors, exiting 0
//   - exit codes: 2 on arg error, 3 on verify-failed

import { describe, test, expect } from 'bun:test'
import { spawnSync } from 'node:child_process'
import { join } from 'node:path'

const AM = join(import.meta.dir, '..', 'bin', 'am.ts')
const SPAWN_TIMEOUT_MS = 60_000

function runAm(args: string[], stdin = '', env: NodeJS.ProcessEnv = {}): { status: number; stdout: string; stderr: string } {
  const r = spawnSync('bun', ['run', AM, ...args], {
    encoding: 'utf8',
    input: stdin,
    env: { ...process.env, ...env },
    timeout: SPAWN_TIMEOUT_MS,
  })
  return { status: r.status ?? -1, stdout: r.stdout, stderr: r.stderr }
}

describe('am capabilities', () => {
  test('emits a JSON envelope with the expected top-level keys', () => {
    const { status, stdout } = runAm(['capabilities'])
    expect(status).toBe(0)
    const payload = JSON.parse(stdout)
    expect(typeof payload.sdkVersion).toBe('string')
    expect(Array.isArray(payload.families)).toBe(true)
    expect(payload.families.length).toBeGreaterThan(0)
    expect(Array.isArray(payload.warningCodes)).toBe(true)
    expect(payload.warningCodes.length).toBeGreaterThan(0)
    expect(payload.outputFormats).toEqual(['svg', 'ascii', 'unicode', 'png', 'json'])
    const flowchart = payload.families.find((f: any) => f.id === 'flowchart')
    expect(flowchart.mutationOps).toContain('add_node')
  })
})

describe('am preview', () => {
  test('writes standalone HTML and can use a stubbed opener', () => {
    const { writeFileSync, readFileSync, existsSync, unlinkSync } = require('node:fs') as typeof import('node:fs')
    const tmpSrc = `/tmp/am-preview-input-${Date.now()}.mmd`
    const tmpOut = `/tmp/am-preview-output-${Date.now()}.html`
    writeFileSync(tmpSrc, 'flowchart LR\n  A --> B\n')
    try {
      const r = runAm(['preview', tmpSrc, '--output', tmpOut, '--open', '--json'], '', { AM_OPEN_COMMAND: 'true' })
      expect(r.status).toBe(0)
      const payload = JSON.parse(r.stdout)
      expect(payload.ok).toBe(true)
      expect(payload.path).toBe(tmpOut)
      expect(payload.opened).toBe(true)
      const html = readFileSync(tmpOut, 'utf8')
      expect(html).toContain('<!doctype html>')
      expect(html).toContain('<svg')
      expect(html).toContain('flowchart LR')
    } finally {
      if (existsSync(tmpSrc)) unlinkSync(tmpSrc)
      if (existsSync(tmpOut)) unlinkSync(tmpOut)
    }
  })

  test('invalid source returns a structured parse error', () => {
    const r = runAm(['preview', '-', '--json'], 'not a diagram')
    expect(r.status).toBe(2)
    const payload = JSON.parse(r.stdout)
    expect(payload.ok).toBe(false)
    expect(payload.error.code).toBe('PARSE_FAILED')
  })

  test('opener failures are not reported as success', () => {
    const r = runAm(['preview', '-', '--open'], 'flowchart LR\n  A --> B\n', { AM_OPEN_COMMAND: '/tmp/am-missing-opener-command' })
    expect(r.status).toBe(4)
    expect(r.stderr).toContain('open command failed')
  })
})

describe('am describe', () => {
  test('emits prose by default and AX-tree JSON on request', () => {
    const source = 'flowchart LR\n  A --> B\n'
    const text = runAm(['describe', '-'], source)
    expect(text.status).toBe(0)
    expect(text.stdout).toContain('flowchart')
    expect(text.stdout).toContain('A')
    expect(text.stdout).toContain('B')

    const json = runAm(['describe', '-', '--format', 'json'], source)
    expect(json.status).toBe(0)
    const tree = JSON.parse(json.stdout)
    expect(tree.kind).toBe('flowchart')
    expect(tree.nodes.map((n: any) => n.id).sort()).toEqual(['A', 'B'])
    expect(tree.edges).toEqual([{ from: 'A', to: 'B' }])
  })
})

describe('am render multi-input', () => {
  test('unsupported --format exits 2 instead of falling back to SVG', () => {
    const r = runAm(['render', '--format', 'nope', '-'], 'flowchart LR\n  A --> B\n')
    expect(r.status).toBe(2)
    expect(r.stderr).toContain('unsupported --format')
    expect(r.stdout).toBe('')
  })

  test('--format png rejects multiple inputs instead of ignoring extras', () => {
    const { writeFileSync, existsSync, unlinkSync } = require('node:fs') as typeof import('node:fs')
    const a = `/tmp/am-png-a-${Date.now()}.mmd`
    const b = `/tmp/am-png-b-${Date.now()}.mmd`
    const out = `/tmp/am-png-out-${Date.now()}.png`
    writeFileSync(a, 'flowchart LR\n  A --> B\n')
    writeFileSync(b, 'flowchart LR\n  C --> D\n')
    try {
      const r = runAm(['render', '--format', 'png', a, b, '--output', out])
      expect(r.status).toBe(2)
      expect(r.stderr).toContain('exactly one input')
      expect(existsSync(out)).toBe(false)
    } finally {
      if (existsSync(a)) unlinkSync(a)
      if (existsSync(b)) unlinkSync(b)
      if (existsSync(out)) unlinkSync(out)
    }
  })

  test('--format json returns layout JSON per file, not ASCII strings', () => {
    const { writeFileSync, existsSync, unlinkSync } = require('node:fs') as typeof import('node:fs')
    const a = `/tmp/am-json-a-${Date.now()}.mmd`
    const b = `/tmp/am-json-b-${Date.now()}.mmd`
    writeFileSync(a, 'flowchart LR\n  A --> B\n')
    writeFileSync(b, 'flowchart LR\n  C --> D\n')
    try {
      const r = runAm(['render', '--format', 'json', a, b])
      expect(r.status).toBe(0)
      const payload = JSON.parse(r.stdout)
      expect(payload.files.length).toBe(2)
      expect(payload.files[0].output.kind).toBe('flowchart')
      expect(Array.isArray(payload.files[0].output.nodes)).toBe(true)
    } finally {
      if (existsSync(a)) unlinkSync(a)
      if (existsSync(b)) unlinkSync(b)
    }
  })
})

describe('am batch', () => {
  test('processes mutate lines without aborting the JSONL stream', () => {
    const valid = JSON.stringify({
      op: 'mutate',
      source: 'flowchart LR\n  A --> B\n',
      mutations: [
        { kind: 'add_node', id: 'C', label: 'Cache' },
        { kind: 'add_edge', from: 'B', to: 'C' },
      ],
    })
    // An opaque-fallback body (pie with an unmodeled accTitle line) exposes no
    // structured mutation, so mutate returns UNSUPPORTED_FAMILY — and the batch
    // stream keeps going rather than aborting.
    const unsupported = JSON.stringify({ op: 'mutate', source: 'pie\n  accTitle: x\n  "A" : 60\n  "B" : 40', mutation: { kind: 'add_node', id: 'X', label: 'X' } })
    const stdin = [valid, unsupported].join('\n') + '\n'

    const { status, stdout } = runAm(['batch'], stdin)
    expect(status).toBe(0)
    const lines = stdout.trim().split('\n').map(l => JSON.parse(l))
    expect(lines.length).toBe(2)
    expect(lines[0].ok).toBe(true)
    expect(lines[0].op).toBe('mutate')
    expect(lines[0].data.source).toContain('B --> C')
    expect(lines[0].data.verify.ok).toBe(true)
    expect(lines[1].ok).toBe(false)
    expect(lines[1].error.code).toBe('UNSUPPORTED_FAMILY')
    expect(lines[1].data?.source).toBeUndefined()
  })

  test('processes 5 lines with mixed validity and exits 0', () => {
    const validRender = JSON.stringify({ op: 'render', source: 'flowchart LR\n  A --> B', options: { ascii: true } })
    const validVerify = JSON.stringify({ op: 'verify', source: 'flowchart LR\n  A --> B' })
    const malformed = '{not valid json'
    const unknownOp = JSON.stringify({ op: 'nope', source: 'x' })
    // Large source > 10KB. Use long ASCII labels rather than many nodes so the
    // layout engine doesn't blow the wallclock budget.
    const longLabel = 'x'.repeat(200)
    const big = JSON.stringify({ op: 'render', source: `flowchart LR\n  A["${longLabel}"] --> B["${longLabel}"]\n  B --> C["${longLabel}"]\n  C --> D["${longLabel}"]\n  D --> E["${longLabel}"]\n  E --> F["${longLabel}"]\n  F --> G["${longLabel}"]\n  G --> H["${longLabel}"]\n  H --> I["${longLabel}"]\n  I --> J["${longLabel}"]\n  J --> K["${longLabel}"]\n  K --> L["${longLabel}"]\n  L --> M["${longLabel}"]\n  M --> N["${longLabel}"]\n`, options: { ascii: true } })
    const stdin = [validRender, validVerify, malformed, unknownOp, big].join('\n') + '\n'

    const { status, stdout } = runAm(['batch'], stdin)
    expect(status).toBe(0)
    const lines = stdout.trim().split('\n')
    expect(lines.length).toBe(5)

    const out = lines.map(l => JSON.parse(l))
    expect(out[0].ok).toBe(true)
    expect(out[0].op).toBe('render')
    expect(typeof out[0].data.ascii).toBe('string')

    expect(out[1].ok).toBe(true)
    expect(out[1].op).toBe('verify')
    expect(Array.isArray(out[1].data.warnings)).toBe(true)

    expect(out[2].ok).toBe(false)
    expect(out[2].error.code).toBe('INVALID_JSON')

    expect(out[3].ok).toBe(false)
    expect(out[3].error.code).toBe('UNKNOWN_OP')

    expect(out[4].ok).toBe(true)
    expect(out[4].op).toBe('render')
    expect(typeof out[4].data.ascii).toBe('string')
  })

  test('an empty line is skipped silently', () => {
    const { status, stdout } = runAm(['batch'], '\n\n\n')
    expect(status).toBe(0)
    expect(stdout.trim()).toBe('')
  })
})

describe('am exit codes', () => {
  test('unknown command exits 2', () => {
    const { status } = runAm(['no-such-command'])
    expect(status).toBe(2)
  })

  test('verify on a diagram with errors exits 3', () => {
    // Empty diagram body → EMPTY_DIAGRAM (severity error) → ok=false → exit 3
    const r = runAm(['verify', '-'], 'flowchart LR\n')
    expect(r.status).toBe(3)
    const payload = JSON.parse(r.stdout)
    expect(payload.ok).toBe(false)
  })

  test('verify on a clean diagram exits 0', () => {
    const r = runAm(['verify', '-'], 'flowchart LR\n  A --> B\n')
    expect(r.status).toBe(0)
    const payload = JSON.parse(r.stdout)
    expect(payload.ok).toBe(true)
  })

  test('mutate with a missing --op flag exits 2', () => {
    const r = runAm(['mutate', '-'], 'flowchart LR\n  A --> B\n')
    expect(r.status).toBe(2)
  })

  test('mutate with malformed --op JSON exits 2', () => {
    const r = runAm(['mutate', '-', '--op', '{bad'], 'flowchart LR\n  A --> B\n')
    expect(r.status).toBe(2)
  })

  test('mutate accepts a batch of ops and verifies once before emitting source', () => {
    const ops = JSON.stringify([
      { kind: 'add_node', id: 'C', label: 'Cache' },
      { kind: 'add_edge', from: 'B', to: 'C' },
    ])
    const r = runAm(['mutate', '-', '--ops', ops, '--json'], 'flowchart LR\n  A --> B\n')
    expect(r.status).toBe(0)
    const payload = JSON.parse(r.stdout)
    expect(payload.ok).toBe(true)
    expect(payload.source).toContain('B --> C')
    expect(payload.verify.ok).toBe(true)
  })

  test('mutate accepts --ops from a file', () => {
    const { writeFileSync, existsSync, unlinkSync } = require('node:fs') as typeof import('node:fs')
    const tmpOps = `/tmp/am-mutate-ops-${Date.now()}.json`
    writeFileSync(tmpOps, JSON.stringify([{ kind: 'set_label', target: 'A', label: 'API' }]))
    try {
      const r = runAm(['mutate', '-', '--ops', tmpOps], 'flowchart LR\n  A --> B\n')
      expect(r.status).toBe(0)
      expect(r.stdout).toContain('A[API]')
    } finally {
      if (existsSync(tmpOps)) unlinkSync(tmpOps)
    }
  })

  test('mutate verifies before emitting invalid output', () => {
    const r = runAm(['mutate', '-', '--op', '{"kind":"remove_node","id":"A"}', '--json'], 'flowchart LR\n  A[Only]\n')
    expect(r.status).toBe(3)
    const payload = JSON.parse(r.stdout)
    expect(payload.ok).toBe(false)
    expect(payload.error.code).toBe('VERIFY_FAILED')
    expect(payload.source).toBeUndefined()
  })

  test('Loop 8 P: render --format png writes a valid PNG to --output file', () => {
    const { writeFileSync, readFileSync, existsSync, unlinkSync } = require('node:fs') as typeof import('node:fs')
    const tmpSrc = `/tmp/loop8-png-input-${Date.now()}.mmd`
    const tmpOut = `/tmp/loop8-png-output-${Date.now()}.png`
    writeFileSync(tmpSrc, 'flowchart LR\n  A --> B --> C\n')
    try {
      const r = runAm(['render', '--format', 'png', tmpSrc, '--output', tmpOut])
      expect(r.status).toBe(0)
      expect(existsSync(tmpOut)).toBe(true)
      const png = readFileSync(tmpOut)
      // PNG magic bytes
      expect([png[0], png[1], png[2], png[3]]).toEqual([0x89, 0x50, 0x4E, 0x47])
      expect(png.length).toBeGreaterThan(100)
    } finally {
      if (existsSync(tmpSrc)) unlinkSync(tmpSrc)
      if (existsSync(tmpOut)) unlinkSync(tmpOut)
    }
  })

  test('Loop 8 P: render --format png without --output exits 2 (would corrupt stdout)', () => {
    const { writeFileSync, existsSync, unlinkSync } = require('node:fs') as typeof import('node:fs')
    const tmpSrc = `/tmp/loop8-png-noout-${Date.now()}.mmd`
    writeFileSync(tmpSrc, 'flowchart LR\n  A --> B\n')
    try {
      const r = runAm(['render', '--format', 'png', tmpSrc])
      expect(r.status).toBe(2)
    } finally {
      if (existsSync(tmpSrc)) unlinkSync(tmpSrc)
    }
  })

  test('Loop 8 P: capabilities now advertises png in outputFormats', () => {
    const r = runAm(['capabilities', '--json'])
    expect(r.status).toBe(0)
    const cap = JSON.parse(r.stdout) as { outputFormats: string[] }
    expect(cap.outputFormats).toContain('png')
  })
})
