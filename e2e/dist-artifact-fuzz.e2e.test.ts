// Differential fuzz of the SHIPPED artifact. The unit suite fuzzes the engine
// from `src/` under Bun; nothing fuzzed the built `dist/` bundle that npm
// consumers actually import under plain Node. tsup bundling can drop code
// (tree-shaking), mis-resolve an external, or break ESM interop in ways no
// source-level test sees. This builds `dist/`, then drives it under Node
// against fast-check-generated diagrams and checks two properties against the
// source build (run in-process under Bun):
//
//   1. Crash parity (every registered family): the artifact throws IFF the source does.
//   2. Output equivalence (flowcharts): dist-under-Node produces byte-identical
//      layout JSON / SVG / ASCII to src-under-Bun — the same cross-runtime
//      determinism contract that agent-determinism.test.ts pins on 3 fixtures,
//      here widened to generated input.
//
// Plus a PNG crash-freedom smoke (resvg native addon via dist, under Node).
//
// Skips only when Node is unavailable (env limitation); a failed build FAILS
// the test rather than skipping, so a broken bundle cannot pass silently.
import { describe, test, expect, beforeAll } from 'bun:test'
import { spawnSync } from 'node:child_process'
import { existsSync, writeFileSync, mkdtempSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createHash } from 'node:crypto'
import fc from 'fast-check'
// Pin the fast-check seed per the repo determinism policy (the e2e bunfig does
// not load the unit-lane preload). Importing it configures the global seed and
// honors AM_FC_SEED=<int>|random.
import '../src/__tests__/fc-seed.preload.ts'
// Source build (under Bun) — the reference oracle. Same public surface the
// dist `./agent` entry exposes.
import { verifyMermaid, renderMermaidSVG, renderMermaidASCII, BUILTIN_FAMILY_METADATA } from '../src/agent/index.ts'

const REPO = join(import.meta.dir, '..')
const DIST = join(REPO, 'dist', 'agent.js')
const BUILD_TIMEOUT_MS = 180_000
const RUN_TIMEOUT_MS = 180_000
const PNG_SMOKE_N = 8

function findNodeBinary(): string | null {
  const candidates = [process.env.NODE_BINARY, 'node', '/opt/node22/bin/node'].filter((x): x is string => Boolean(x))
  for (const candidate of candidates) {
    try { if (spawnSync(candidate, ['--version'], { encoding: 'utf8' }).status === 0) return candidate } catch {}
  }
  return null
}

const NODE = findNodeBinary()

// ---------------------------------------------------------------------------
// Reference evaluation (source build, Bun). The Node driver below mirrors this
// logic byte-for-byte so the two sides are directly comparable.
// ---------------------------------------------------------------------------
const sha = (s: string) => createHash('sha256').update(s).digest('hex')
const tag = (fn: () => string): string => { try { return sha(String(fn())) } catch { return 'THREW' } }
function evalOne(src: string) {
  return {
    layout: tag(() => JSON.stringify(verifyMermaid(src).layout ?? null)),
    svg: tag(() => renderMermaidSVG(src)),
    ascii: tag(() => renderMermaidASCII(src)),
  }
}

// The Node driver: identical tag logic, run against the built dist/agent.js.
const NODE_DRIVER = `
import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
const inputs = JSON.parse(readFileSync(process.env.AM_FUZZ_INPUT, 'utf8'))
const mod = await import(process.env.AM_FUZZ_DIST)
const { verifyMermaid, renderMermaidSVG, renderMermaidASCII, renderMermaidPNG } = mod
const sha = (s) => createHash('sha256').update(s).digest('hex')
const tag = (fn) => { try { return sha(String(fn())) } catch { return 'THREW' } }
const PNG_N = Number(process.env.AM_FUZZ_PNG_N || 0)
const out = inputs.map((src, i) => {
  const r = {
    layout: tag(() => JSON.stringify(verifyMermaid(src).layout ?? null)),
    svg: tag(() => renderMermaidSVG(src)),
    ascii: tag(() => renderMermaidASCII(src)),
  }
  if (i < PNG_N) { try { r.pngLen = renderMermaidPNG(src).length } catch { r.pngLen = -1 } }
  return r
})
process.stdout.write(JSON.stringify(out))
`

// ---------------------------------------------------------------------------
// Generators. Flowcharts (equivalence arm) exercise the layout/route/ascii
// core; the mixed arm sprays every family header + garbage for crash parity.
// ---------------------------------------------------------------------------
const idArb = fc.constantFrom('A', 'B', 'C', 'D', 'E', 'F', 'G', 'Svc', 'DB', 'Cache', 'n1', 'n2')
const labelArb = fc.string({ maxLength: 10 }).filter(s => !/[[\]{}|>\n\r]/.test(s))
const edgeArb = fc.tuple(idArb, idArb, fc.option(labelArb, { nil: undefined })).map(
  ([a, b, l]) => (l ? `${a} -->|${l}| ${b}` : `${a} --> ${b}`),
)
const flowchartArb = fc.tuple(
  fc.constantFrom('flowchart TD', 'flowchart LR', 'graph TD', 'graph LR'),
  fc.array(edgeArb, { minLength: 1, maxLength: 8 }),
).map(([h, edges]) => [h, ...edges].join('\n'))

const SPECIAL_CHARS = ['[', ']', '{', '}', '(', ')', '|', ':', ';', '-', '=', '"', "'", '\\', '/', '\n', '\t', ' ', '​', '￿']
const specialCharStringArb = fc.array(fc.constantFrom(...SPECIAL_CHARS), { maxLength: 60 }).map(c => c.join(''))
// Registry-derived: a new family enters shipped-artifact crash parity without
// waiting for another hand-maintained header list to notice it.
const familyHeaderArb = fc.constantFrom(...BUILTIN_FAMILY_METADATA.map(family => family.headers[0]!))
const mixedArb = fc.oneof(
  flowchartArb,
  fc.tuple(familyHeaderArb, fc.array(fc.string({ maxLength: 30 }), { maxLength: 6 })).map(([h, b]) => [h, ...b].join('\n')),
  fc.string({ maxLength: 120 }),
  specialCharStringArb,
)

const FLOW_N = 120
const MIXED_N = 120

let haveDist = false

beforeAll(() => {
  if (!NODE) return // no Node → nothing to test the artifact under; tests skip.
  const build = spawnSync('bun', ['run', 'build'], { cwd: REPO, encoding: 'utf8', timeout: BUILD_TIMEOUT_MS })
  // A broken build must fail loudly, not skip — that is exactly what shipping
  // would break.
  if (build.status !== 0 || !existsSync(DIST)) {
    throw new Error(`\`bun run build\` failed (status ${build.status}); dist artifact fuzz cannot run.\n${build.stderr ?? ''}`)
  }
  haveDist = true
})

function runDriver(inputs: string[], pngN: number): Array<{ layout: string; svg: string; ascii: string; pngLen?: number }> {
  const work = mkdtempSync(join(tmpdir(), 'am-dist-fuzz-'))
  const inputFile = join(work, 'inputs.json')
  writeFileSync(inputFile, JSON.stringify(inputs))
  const r = spawnSync(NODE!, ['--input-type=module', '-e', NODE_DRIVER], {
    encoding: 'utf8',
    timeout: RUN_TIMEOUT_MS,
    maxBuffer: 64 * 1024 * 1024,
    env: { ...process.env, AM_FUZZ_INPUT: inputFile, AM_FUZZ_DIST: DIST, AM_FUZZ_PNG_N: String(pngN) },
  })
  if (r.status !== 0) throw new Error(`Node driver exited ${r.status}: ${r.stderr}`)
  return JSON.parse(r.stdout)
}

const fn = NODE ? test : test.skip

describe('dist artifact differential fuzz (built bundle, plain Node)', () => {
  fn('dist-under-Node matches src-under-Bun: crash parity (all families) + byte-equality (flowcharts)', () => {
    expect(haveDist).toBe(true)
    const flowInputs = fc.sample(flowchartArb, FLOW_N)
    // Deterministic success control: fuzz frequency cannot decide whether a
    // newly registered family reaches the shipped Node artifact at all.
    const canonicalInputs = BUILTIN_FAMILY_METADATA.map(family => family.example)
    const mixedInputs = fc.sample(mixedArb, MIXED_N)
    const inputs = [...flowInputs, ...canonicalInputs, ...mixedInputs]

    const ref = inputs.map(evalOne)
    const dist = runDriver(inputs, PNG_SMOKE_N)
    expect(dist.length).toBe(inputs.length)

    const crashParityViolations: Array<{ src: string; channel: string; ref: boolean; dist: boolean }> = []
    const equivalenceViolations: Array<{ src: string; channel: string; ref: string; dist: string }> = []
    for (let i = 0; i < inputs.length; i++) {
      for (const ch of ['layout', 'svg', 'ascii'] as const) {
        const refThrew = ref[i]![ch] === 'THREW'
        const distThrew = dist[i]![ch] === 'THREW'
        // (1) Crash parity — the artifact must throw exactly where source does.
        if (refThrew !== distThrew) {
          crashParityViolations.push({ src: inputs[i]!, channel: ch, ref: refThrew, dist: distThrew })
        } else if (!refThrew && i < FLOW_N && ref[i]![ch] !== dist[i]![ch]) {
          // (2) Output equivalence — flowchart arm, both produced output.
          equivalenceViolations.push({ src: inputs[i]!, channel: ch, ref: ref[i]![ch], dist: dist[i]![ch] })
        }
      }
    }
    expect(crashParityViolations).toEqual([])
    expect(equivalenceViolations).toEqual([])
    for (let i = FLOW_N; i < FLOW_N + canonicalInputs.length; i++) {
      for (const channel of ['layout', 'svg', 'ascii'] as const) {
        const family = BUILTIN_FAMILY_METADATA[i - FLOW_N]!.id
        expect(ref[i]![channel], `source ${family} ${channel}`).not.toBe('THREW')
        expect(dist[i]![channel], `dist ${family} ${channel}`).not.toBe('THREW')
      }
    }

    // (3) PNG crash-freedom of the artifact under Node (resvg native addon).
    for (let i = 0; i < PNG_SMOKE_N; i++) {
      expect(dist[i]!.pngLen).toBeGreaterThan(0)
    }
  }, RUN_TIMEOUT_MS + BUILD_TIMEOUT_MS)
})
