// Determinism: in-process grid + REAL cross-process check + drift sentinel.
// No seed apparatus (it did nothing); determinism is structural to ELK.

import { describe, test, expect } from 'bun:test'
import { spawnSync } from 'node:child_process'
import { join } from 'node:path'
import { verifyMermaid } from '../agent/verify.ts'

const DIRECTIONS = ['TD', 'BT', 'LR', 'RL'] as const
const NODE_COUNTS = [2, 3, 4, 5, 6, 7, 8, 9, 10, 12]
const DENSITY = ['sparse', 'dense', 'star'] as const

function makeDiagram(direction: string, n: number, density: 'sparse' | 'dense' | 'star'): string {
  const ids = Array.from({ length: n }, (_, i) => `N${i}`)
  const lines = [`flowchart ${direction}`]
  if (density === 'star') { for (let i = 1; i < n; i++) lines.push(`  ${ids[0]} --> ${ids[i]}`); return lines.join('\n') }
  for (let i = 0; i < n - 1; i++) lines.push(`  ${ids[i]} --> ${ids[i + 1]}`)
  if (density === 'dense') for (let i = 2; i < n; i++) lines.push(`  ${ids[0]} --> ${ids[i]}`)
  return lines.join('\n')
}

describe('determinism grid (in-process)', () => {
  for (const dir of DIRECTIONS) for (const n of NODE_COUNTS) for (const density of DENSITY) {
    test(`${dir} ${n} ${density}`, () => {
      const src = makeDiagram(dir, n, density)
      expect(JSON.stringify(verifyMermaid(src).layout)).toEqual(JSON.stringify(verifyMermaid(src).layout))
    })
  }
})

describe('determinism — REAL cross-process (the test I claimed but never wrote before)', () => {
  // Spawn separate `bun` processes and compare layout JSON. This is the honest
  // determinism check: pure-function-in-one-process is not the same as
  // reproducible-across-invocations.
  const RUNNER = join(import.meta.dir, 'helpers', 'layout-runner.ts')
  const samples = [
    'flowchart LR\n  A --> B\n  A --> C\n  B --> D\n  C --> D\n  D --> E\n  E --> A',
    'flowchart TD\n  ' + Array.from({ length: 10 }, (_, i) => `N${i} --> N${(i + 1) % 10}`).join('\n  '),
  ]
  for (const src of samples) {
    test(`identical across 3 child processes: ${src.slice(0, 24).replace(/\n/g, ' ')}…`, () => {
      const run = () => spawnSync('bun', ['run', RUNNER, src], { encoding: 'utf8' }).stdout
      const a = run(), b = run(), c = run()
      expect(a.length).toBeGreaterThan(2)
      expect(b).toEqual(a)
      expect(c).toEqual(a)
    })
  }
})

describe('determinism — cross-runtime (bun vs node)', () => {
  // Determinism in the prior loop was tested cross-PROCESS on bun only.
  // This loop tightens the claim: layout JSON is identical when emitted by
  // bun AND by node, on the same machine. Run via the built `dist/agent.js`
  // so node can consume it without TS resolution issues.
  const NODE = '/opt/node22/bin/node'
  const DIST = join(import.meta.dir, '..', '..', 'dist', 'agent.js')
  const haveNode = (() => {
    try { return spawnSync(NODE, ['--version'], { encoding: 'utf8' }).status === 0 } catch { return false }
  })()
  const haveDist = (() => { try { return require('node:fs').existsSync(DIST) } catch { return false } })()

  const fn = haveNode && haveDist ? test : test.skip
  for (const src of [
    'flowchart LR\n  A --> B',
    'flowchart TD\n  A --> B\n  B --> C\n  C --> D',
    'flowchart LR\n  A --> B\n  A --> C\n  B --> D\n  C --> D\n  D --> E\n  E --> A',
  ]) {
    fn(`bun layout ≡ node layout for: ${src.slice(0, 30).replace(/\n/g, ' ')}…`, () => {
      const bunLayout = verifyMermaid(src).layout
      const nodeOut = spawnSync(NODE, ['-e', `
        const { verifyMermaid } = require('${DIST}')
        process.stdout.write(JSON.stringify(verifyMermaid(${JSON.stringify(src)}).layout))
      `], { encoding: 'utf8' })
      expect(nodeOut.status).toBe(0)
      // Compare structurally (parsed JSON), immune to whitespace differences.
      const nodeLayout = JSON.parse(nodeOut.stdout)
      expect(nodeLayout).toEqual(bunLayout)
    })
  }
})

describe('determinism — cross-runtime PNG (Loop 8)', () => {
  // PNG-determinism extension. Renders the same fixture in bun and node,
  // compares SHA-256 byte-hashes. Per Loop 8 critic 2 pre-declared threshold:
  // if >0 bytes diverge, this test fails — we drop the cross-runtime PNG
  // claim and document in DIVERGENCES (don't fake-pass it).
  //
  // resvg-js is napi-rs based, so both runtimes call into the SAME prebuilt
  // .node binary; p(this passes) ~= 0.9 per Loop 8 critic 1. If it fails,
  // we still ship deterministic-per-runtime PNG (the in-process test in
  // agent-png-determinism.test.ts proves that).
  const NODE = '/opt/node22/bin/node'
  const DIST = join(import.meta.dir, '..', '..', 'dist', 'agent.js')
  const haveNode = (() => {
    try { return spawnSync(NODE, ['--version'], { encoding: 'utf8' }).status === 0 } catch { return false }
  })()
  const haveDist = (() => { try { return require('node:fs').existsSync(DIST) } catch { return false } })()
  const haveResvg = (() => {
    try { require('@resvg/resvg-js'); return true } catch { return false }
  })()

  const fn = haveNode && haveDist && haveResvg ? test : test.skip
  fn('bun PNG SHA-256 ≡ node PNG SHA-256 (with warm-up)', async () => {
    // Module-level import already gives us renderMermaidPNG; import lazily so
    // skip path doesn't fail on environments without resvg.
    const { renderMermaidPNG } = await import('../agent/png.ts')
    const src = 'flowchart LR\n  A[Start] --> B[End]'

    // Warm-up render in bun, then take the second hash.
    renderMermaidPNG(src)
    const bunBytes = renderMermaidPNG(src)
    const bunHash = require('node:crypto').createHash('sha256').update(bunBytes).digest('hex')

    // Same warm-up pattern in the node subprocess.
    const script = `
      const m = require('${DIST}');
      m.renderMermaidPNG(${JSON.stringify(src)});  // warm-up
      const png = m.renderMermaidPNG(${JSON.stringify(src)});
      process.stdout.write(require('node:crypto').createHash('sha256').update(png).digest('hex'))
    `
    const r = spawnSync(NODE, ['-e', script], { encoding: 'utf8' })
    expect(r.status).toBe(0)
    const nodeHash = r.stdout.trim()

    // Honest comparison. Pre-declared threshold: any byte divergence fails.
    expect(nodeHash).toBe(bunHash)
  })
})

describe('drift sentinel', () => {
  const SENTINELS = [
    'flowchart TD\n  A --> B',
    'flowchart LR\n  A --> B\n  B --> C',
    'flowchart TD\n  A[Alpha] --> B[Beta]\n  B --> C[Gamma]',
    'flowchart TD\n  A{Decision} --> B[Yes]\n  A --> C[No]',
    'flowchart LR\n  A --> B\n  A --> C\n  B --> D\n  C --> D',
    'flowchart TD\n  A((Start)) --> B[Step]\n  B --> C((End))',
    'flowchart TD\n  A --> B\n  B --> C\n  C --> A',
    'flowchart LR\n  A1 --> A2\n  A2 --> A3\n  A3 --> A4\n  A4 --> A5',
  ]
  for (const src of SENTINELS) {
    test(`sentinel: ${src.replace(/\n/g, ' / ').slice(0, 60)}`, () => {
      expect(verifyMermaid(src).layout).toMatchSnapshot()
    })
  }
})
