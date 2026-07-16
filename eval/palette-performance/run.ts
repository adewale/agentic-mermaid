#!/usr/bin/env bun
import { execFileSync } from 'node:child_process'
import { cpus } from 'node:os'
import { readFileSync, writeFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { categoricalPalette, categoricalPaletteWithDiagnostics } from '../../src/shared/categorical-palette.ts'
import { THEMES } from '../../src/theme.ts'
import { fileReceiptEntries, hashFileTree } from '../../scripts/pr-assets/artifact-receipt.ts'

const ROOT = join(import.meta.dir, '..', '..')
const REPORT = join(import.meta.dir, 'report.json')
const COUNTS = Array.from({ length: 18 }, (_unused, index) => index + 7)
const LARGE_COUNTS = [25, 64, 256, 1000] as const
const WARMUP_CALLS = 200
const SAMPLES_PER_FIXTURE = 20
const ORDER_SEED = 179
const INPUTS = [
  'package.json',
  'bun.lock',
  'scripts/pr-assets/artifact-receipt.ts',
  'src/palette-catalog.ts',
  'src/shared/categorical-palette.ts',
  'src/shared/color-math.ts',
  'src/shared/css-named-colors.ts',
  'src/shared/perceptual-color.ts',
  'src/theme.ts',
  'src/xychart/colors.ts',
  'eval/palette-performance/run.ts',
].map(path => join(ROOT, path))

const repoPath = (path: string): string => relative(ROOT, path).replaceAll('\\', '/')
const round = (value: number): number => Math.round(value * 1_000_000) / 1_000_000
const percentile = (sorted: number[], p: number): number => sorted[Math.floor((sorted.length - 1) * p)] ?? 0
const summarize = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b)
  return {
    samples: values.length,
    p50: round(percentile(sorted, 0.50)),
    mean: round(values.reduce((sum, value) => sum + value, 0) / values.length),
    p95: round(percentile(sorted, 0.95)),
  }
}

function seededShuffle<T>(values: readonly T[], seed: number): T[] {
  const out = [...values]
  let state = seed >>> 0
  const random = (): number => {
    state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0
    return state / 0x1_0000_0000
  }
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1))
    ;[out[i], out[j]] = [out[j]!, out[i]!]
  }
  return out
}

function complexityEvidence() {
  const themes = Object.entries(THEMES)
  return LARGE_COUNTS.map(count => {
    let maxCandidateEvaluations = 0
    for (const [themeName, theme] of themes) {
      const inputs = { accent: theme.accent ?? theme.fg, bg: theme.bg }
      const { colors, diagnostics } = categoricalPaletteWithDiagnostics(count, inputs)
      if (diagnostics.path !== 'linear-tail') throw new Error(`${themeName}/${count}: linear tail did not engage`)
      if (diagnostics.pairDistanceChecks !== 0) throw new Error(`${themeName}/${count}: pair repair leaked into linear tail`)
      if (diagnostics.tailItems !== count || diagnostics.emittedCount !== count || colors.length !== count) {
        throw new Error(`${themeName}/${count}: output/work count mismatch`)
      }
      if (new Set(colors).size !== count) throw new Error(`${themeName}/${count}: duplicate output colors`)
      // The implementation has fixed-size visibility and collision searches.
      // This operation-count ceiling is portable; elapsed milliseconds are not.
      if (diagnostics.candidateEvaluations > 1_201 * count) {
        throw new Error(`${themeName}/${count}: candidate work exceeded the linear ceiling`)
      }
      maxCandidateEvaluations = Math.max(maxCandidateEvaluations, diagnostics.candidateEvaluations)
    }
    return {
      count,
      themes: themes.length,
      path: 'linear-tail',
      maxCandidateEvaluations,
      candidateEvaluationCeiling: 1_201 * count,
      maxPairDistanceChecks: 0,
    }
  })
}

function assertCleanWorktree(): void {
  const status = execFileSync('git', ['status', '--porcelain'], { cwd: ROOT, encoding: 'utf8' }).trim()
  if (status) throw new Error('Refusing to record palette timings from a dirty worktree; commit the benchmark inputs first')
}

function record(): void {
  assertCleanWorktree()
  const fixtures = Object.entries(THEMES).flatMap(([theme, colors]) => COUNTS.map(count => ({
    theme,
    count,
    inputs: { accent: colors.accent ?? colors.fg, bg: colors.bg },
  })))
  const ordered = seededShuffle(fixtures, ORDER_SEED)
  for (let index = 0; index < WARMUP_CALLS; index++) {
    const fixture = ordered[index % ordered.length]!
    categoricalPalette(fixture.count, fixture.inputs)
  }

  const timings: Array<{ theme: string; count: number; milliseconds: number }> = []
  for (let repetition = 0; repetition < SAMPLES_PER_FIXTURE; repetition++) {
    for (const fixture of seededShuffle(ordered, ORDER_SEED + repetition + 1)) {
      const started = performance.now()
      categoricalPalette(fixture.count, fixture.inputs)
      timings.push({ ...fixture, milliseconds: performance.now() - started })
    }
  }
  const all = timings.map(item => item.milliseconds)
  const sourceCommit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim()
  const cpu = cpus()
  const report = {
    schemaVersion: 1,
    validity: {
      claim: 'Warmed single-process palette-generation latency on the recorded environment.',
      warrant: 'A fixed built-in-theme by peer-count fixture matrix, repeated in deterministic shuffled orders.',
      backing: 'Recorded protocol, exact input hashes, runtime/CPU metadata, latency distribution, and deterministic operation counts.',
      rebuttal: 'Absolute timings are observational, are not portable across machines, and are not a CI threshold.',
    },
    provenance: {
      sourceCommit,
      sourceTreeSha256: hashFileTree(ROOT, INPUTS),
      dirty: false,
      inputs: fileReceiptEntries(ROOT, INPUTS),
    },
    environment: {
      runtime: `Bun ${Bun.version}`,
      os: process.platform,
      arch: process.arch,
      cpuModel: cpu[0]?.model ?? 'unknown',
      logicalCpus: cpu.length,
    },
    protocol: {
      command: 'bun run benchmark:palette',
      clock: 'performance.now monotonic high-resolution clock',
      themes: Object.keys(THEMES).length,
      counts: '7..24',
      fixtureCount: fixtures.length,
      warmupCalls: WARMUP_CALLS,
      samplesPerFixture: SAMPLES_PER_FIXTURE,
      totalSamples: timings.length,
      orderSeed: ORDER_SEED,
    },
    complexity: {
      regimes: {
        '0..6': 'O(n) time and O(n) output space',
        '7..24': 'bounded O(M*n^2) worst case, where n<=24 and the visible-candidate corpus M is fixed',
        '>24': 'expected O(n) time and O(n) output space, relying on average O(1) Set membership',
      },
      deterministicLargeCountEvidence: complexityEvidence(),
    },
    results: {
      unit: 'milliseconds per palette-generation call',
      overall: summarize(all),
      byCount: COUNTS.map(count => ({ count, ...summarize(timings.filter(item => item.count === count).map(item => item.milliseconds)) })),
    },
    limitations: [
      'This measures palette generation, not an entire diagram render.',
      'Most controlled families generate one peer-category channel; Journey independently generates section and actor palettes.',
      'No cross-machine latency guarantee follows from this report.',
      'CI checks source freshness and deterministic complexity invariants, but does not gate on wall-clock time.',
    ],
  }
  writeFileSync(REPORT, `${JSON.stringify(report, null, 2)}\n`)
  console.log(`Recorded ${timings.length} palette samples in ${repoPath(REPORT)}`)
}

function check(): void {
  const report = JSON.parse(readFileSync(REPORT, 'utf8')) as any
  if (report.schemaVersion !== 1) throw new Error('Unsupported palette performance report schema')
  if (report.provenance?.dirty !== false) throw new Error('Palette performance report does not attest a clean source tree')
  if (report.provenance?.sourceTreeSha256 !== hashFileTree(ROOT, INPUTS)) {
    throw new Error('Palette performance report inputs are stale; record on a clean committed tree')
  }
  if (JSON.stringify(report.provenance.inputs) !== JSON.stringify(fileReceiptEntries(ROOT, INPUTS))) {
    throw new Error('Palette performance report input manifest is stale')
  }
  const commit = String(report.provenance.sourceCommit ?? '')
  if (!/^[0-9a-f]{40}$/.test(commit)) throw new Error('Palette performance source commit must be a full SHA')
  execFileSync('git', ['cat-file', '-e', `${commit}^{commit}`], { cwd: ROOT, stdio: 'ignore' })
  execFileSync('git', ['merge-base', '--is-ancestor', commit, 'HEAD'], { cwd: ROOT, stdio: 'ignore' })
  if (JSON.stringify(report.complexity?.deterministicLargeCountEvidence) !== JSON.stringify(complexityEvidence())) {
    throw new Error('Palette deterministic complexity evidence is stale')
  }
  if (report.validity?.rebuttal !== 'Absolute timings are observational, are not portable across machines, and are not a CI threshold.') {
    throw new Error('Palette timing validity limitation is missing')
  }
  console.log('Palette performance report provenance and deterministic complexity evidence pass')
}

if (process.argv.includes('--check')) check()
else if (process.argv.includes('--record')) record()
else throw new Error('Use --record or --check')
