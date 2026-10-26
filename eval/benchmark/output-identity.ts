import './ci-policy-enforce.ts'
// Output identity across revisions: render the official syntax examples, the
// docs corpus, the release scaling cases and the micro-benchmark workloads in
// several output modes at two revisions, and report every output that differs.
// Use it to show that a refactor or performance change preserves bytes.
//
//   bun run eval/benchmark/output-identity.ts                   # vs origin/main
//   bun run eval/benchmark/output-identity.ts --baseline <ref> --jobs 3 --show 5
//
// Inputs are deduplicated by source; most docs-corpus entries repeat an
// official example. Modes cover each Scene backend and every whole-document
// SVG pass: default SVG; the rough (`excalidraw`), hybrid (`watercolor`) and
// palette (`tokyo-night`) styles; `idPrefix` + `compact`; live CSS-variable
// colors; an uncalibrated host font with `security: 'strict'` (text fitting
// and the strict policy); ASCII; Unicode; and `verifyMermaid` results. A thrown error is an output
// too, so failing inputs must fail identically. Only SHA-256 digests of
// outputs are kept; `--show N` re-renders the first N differences on both
// sides and prints where they diverge. Each run records the baseline digests
// under node_modules/.cache/; `--reuse-baseline` reuses them for the same
// revision, inputs and modes. Reuse is opt-in because the baseline renders
// with the current harness and node_modules: after either changes, rerender.

import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { availableParallelism, tmpdir } from 'node:os'
import { join } from 'node:path'
import { MICRO_WORKLOADS } from './micro-bench-cases.ts'
import { releaseBenchCases } from './release-bench-cases.ts'
import { extractRevisionTree, ROOT, shortRevision, workingRevision } from './revision-tree.ts'

const MODES = ['svg', 'svg:excalidraw', 'svg:watercolor', 'svg:tokyo-night', 'svg:prefixed-compact', 'svg:live-vars', 'svg:host-font-strict', 'ascii', 'unicode', 'verify'] as const
type Mode = (typeof MODES)[number]
type Input = readonly [id: string, source: string]
type Digests = Record<string, string>

const SCRIPT_PATH = 'eval/benchmark/output-identity.ts'
const CACHE_DIR = join(ROOT, 'node_modules/.cache/agentic-mermaid-identity')

function parseArgs(argv: readonly string[]): Map<string, string> {
  const flags = new Set(['child', 'reuse-baseline'])
  const valued = new Set(['baseline', 'jobs', 'modes', 'show', 'inputs', 'out', 'emit', 'keys'])
  const options = new Map<string, string>()
  for (let i = 0; i < argv.length; i++) {
    const key = argv[i]!.replace(/^--/, '')
    if (flags.has(key)) options.set(key, 'true')
    else if (valued.has(key) && argv[i + 1] !== undefined) options.set(key, argv[++i]!)
    else throw new Error(`Unknown or incomplete option ${argv[i]}`)
  }
  return options
}

async function loadInputs(): Promise<Input[]> {
  const { extractOfficialCorpus } = await import('../shared/official-fences.ts')
  const docs = JSON.parse(readFileSync(join(ROOT, 'eval/mermaid-docs-corpus/corpus.json'), 'utf8')) as Array<{ source: string }>
  const all: Input[] = [
    ...extractOfficialCorpus().map(fence => [fence.id, fence.source] as const),
    ...docs.map((entry, index) => [`docs-corpus#${index}`, entry.source] as const),
    ...releaseBenchCases().map(input => [`release:${input.id}`, input.source] as const),
    ...Object.entries(MICRO_WORKLOADS).map(([id, source]) => [`micro:${id}`, source] as const),
  ]
  const distinct = new Map<string, Input>()
  for (const input of all) if (!distinct.has(input[1])) distinct.set(input[1], input)
  return [...distinct.values()]
}

const key = (id: string, mode: Mode) => `${id} | ${mode}`

// ---------------------------------------------------------------------------
// Child: render inputs at this tree's src/
// ---------------------------------------------------------------------------

async function renderers(): Promise<Record<Mode, (source: string) => string>> {
  const [lib, agent] = await Promise.all([import('../../src/index.ts'), import('../../src/agent/index.ts')])
  const svg = (options: Parameters<typeof lib.renderMermaidSVG>[1]) => (source: string) => lib.renderMermaidSVG(source, options)
  return {
    svg: svg({}),
    'svg:excalidraw': svg({ style: 'excalidraw' }),
    'svg:watercolor': svg({ style: 'watercolor' }),
    'svg:tokyo-night': svg({ style: 'tokyo-night' }),
    'svg:prefixed-compact': svg({ idPrefix: 'am-', compact: true }),
    'svg:live-vars': svg({ bg: 'var(--bg)', fg: 'var(--fg)', transparent: true }),
    'svg:host-font-strict': svg({ font: 'Georgia, serif', security: 'strict' }),
    // An explicit colorMode, so the terminal running the check cannot change the bytes.
    ascii: source => lib.renderMermaidASCII(source, { useAscii: true, colorMode: 'none' }),
    unicode: source => lib.renderMermaidASCII(source, { colorMode: 'none' }),
    verify: source => JSON.stringify(agent.verifyMermaid(source)),
  }
}

function output(render: (source: string) => string, source: string): string {
  try {
    return render(source)
  } catch (error) {
    return `error: ${error instanceof Error ? `${error.name}: ${error.message.split('\n')[0]}` : String(error)}`
  }
}

async function runChild(args: Map<string, string>): Promise<void> {
  const inputs = JSON.parse(readFileSync(args.get('inputs')!, 'utf8')) as Input[]
  const modes = args.get('modes')!.split(',') as Mode[]
  const render = await renderers()
  const wanted = args.has('keys') ? new Set(JSON.parse(readFileSync(args.get('keys')!, 'utf8')) as string[]) : undefined
  const digests: Digests = {}
  const emitted: Record<string, string> = {}
  for (const [id, source] of inputs) {
    for (const mode of modes) {
      const k = key(id, mode)
      if (wanted && !wanted.has(k)) continue
      const text = output(render[mode], source)
      if (wanted) emitted[k] = text
      // UTF-16 code units: a UTF-8 encoding would map distinct lone surrogates to U+FFFD.
      else digests[k] = createHash('sha256').update(Buffer.from(text, 'utf16le')).digest('hex')
    }
  }
  writeFileSync(args.get('out')!, JSON.stringify(wanted ? emitted : digests))
}

// ---------------------------------------------------------------------------
// Parent: shard inputs across children per side, compare digests
// ---------------------------------------------------------------------------

function runChildProcess(root: string, extra: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn('bun', [join(root, SCRIPT_PATH), '--child', ...extra], { cwd: root, stdio: ['ignore', 'ignore', 'inherit'] })
    child.on('error', reject)
    child.on('exit', code => (code === 0 ? resolve() : reject(new Error(`identity child in ${root} exited with ${code}`))))
  })
}

async function digestSide(root: string, inputs: Input[], modes: Mode[], jobs: number, scratch: string, label: string): Promise<Digests> {
  const size = Math.ceil(inputs.length / jobs)
  const shards = Array.from({ length: jobs }, (_, index) => inputs.slice(index * size, (index + 1) * size)).filter(shard => shard.length)
  const results = await Promise.all(
    shards.map(async (shard, index) => {
      const inputFile = join(scratch, `${label}-inputs-${index}.json`)
      const out = join(scratch, `${label}-digests-${index}.json`)
      writeFileSync(inputFile, JSON.stringify(shard))
      await runChildProcess(root, ['--inputs', inputFile, '--modes', modes.join(','), '--out', out])
      return JSON.parse(readFileSync(out, 'utf8')) as Digests
    }),
  )
  const digests: Digests = Object.assign({}, ...results)
  const missing = inputs.flatMap(([id]) => modes.map(mode => key(id, mode))).filter(k => !(k in digests))
  if (missing.length || Object.keys(digests).length !== inputs.length * modes.length) {
    throw new Error(`${label} produced ${Object.keys(digests).length} of ${inputs.length * modes.length} digests; missing e.g. ${missing.slice(0, 3).join(', ')}`)
  }
  return digests
}

/** A missing or unreadable cache means rerender. */
function readCache(file: string): { modes: Mode[]; inputs: Input[]; digests: Digests } | undefined {
  try {
    return JSON.parse(readFileSync(file, 'utf8')) as { modes: Mode[]; inputs: Input[]; digests: Digests }
  } catch {
    return undefined
  }
}

function positiveInteger(name: string, value: string | undefined, fallback: number, minimum = 1): number {
  if (value === undefined) return fallback
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed < minimum) throw new Error(`--${name} must be an integer ≥ ${minimum}, got ${value}`)
  return parsed
}

async function emitOutputs(root: string, inputs: Input[], modes: Mode[], keys: string[], scratch: string, label: string): Promise<Record<string, string>> {
  const inputFile = join(scratch, `${label}-show-inputs.json`)
  const keyFile = join(scratch, `${label}-show-keys.json`)
  const out = join(scratch, `${label}-show.json`)
  const ids = new Set(keys.map(k => k.split(' | ')[0]))
  writeFileSync(inputFile, JSON.stringify(inputs.filter(([id]) => ids.has(id))))
  writeFileSync(keyFile, JSON.stringify(keys))
  await runChildProcess(root, ['--inputs', inputFile, '--modes', modes.join(','), '--keys', keyFile, '--out', out])
  return JSON.parse(readFileSync(out, 'utf8')) as Record<string, string>
}

function firstDifference(before: string, after: string): string {
  let index = 0
  while (index < before.length && before[index] === after[index]) index++
  const from = Math.max(0, index - 60)
  return `at ${index} of ${before.length}→${after.length}\n    before: …${JSON.stringify(before.slice(from, index + 80))}\n    after:  …${JSON.stringify(after.slice(from, index + 80))}`
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2))
  if (args.has('child')) return runChild(args)
  const modes = [...new Set(args.get('modes')?.split(',') ?? MODES)] as Mode[]
  const unknown = modes.filter(mode => !MODES.includes(mode))
  if (unknown.length) throw new Error(`Unknown mode(s): ${unknown.join(', ')}; known: ${MODES.join(', ')}`)
  const show = positiveInteger('show', args.get('show'), 5, 0)
  const inputs = await loadInputs()
  // More children than CPUs or inputs only adds contention and memory.
  const jobs = Math.min(positiveInteger('jobs', args.get('jobs'), 3), availableParallelism(), inputs.length)
  const scratch = mkdtempSync(join(tmpdir(), 'agentic-mermaid-identity-'))
  try {
    const baseline = extractRevisionTree(args.get('baseline') ?? 'origin/main', scratch, 'baseline')
    const cacheFile = join(CACHE_DIR, `${baseline.revision}.json`)
    const cached = args.has('reuse-baseline') ? readCache(cacheFile) : undefined
    let before: Digests
    if (cached && JSON.stringify(cached.modes) === JSON.stringify(modes) && JSON.stringify(cached.inputs) === JSON.stringify(inputs)) {
      console.error(`baseline ${shortRevision(baseline.revision)}: cached digests`)
      before = cached.digests
    } else {
      console.error(`baseline ${shortRevision(baseline.revision)}: rendering ${inputs.length} inputs × ${modes.length} modes`)
      before = await digestSide(baseline.root, inputs, modes, jobs, scratch, 'baseline')
      mkdirSync(CACHE_DIR, { recursive: true })
      // Written whole, then renamed, so an interrupted run cannot leave a truncated cache.
      const partial = `${cacheFile}.${process.pid}.tmp`
      writeFileSync(partial, JSON.stringify({ modes, inputs, digests: before }))
      renameSync(partial, cacheFile)
    }
    const candidateRevision = workingRevision()
    console.error(`candidate ${shortRevision(candidateRevision)}: rendering ${inputs.length} inputs × ${modes.length} modes`)
    const after = await digestSide(ROOT, inputs, modes, jobs, scratch, 'candidate')

    const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])]
    const differing = keys.filter(k => before[k] !== after[k])
    const perMode = new Map(modes.map(mode => [mode, differing.filter(k => k.endsWith(` | ${mode}`)).length]))
    console.log(`\n${keys.length} outputs (${inputs.length} inputs × ${modes.length} modes), baseline ${shortRevision(baseline.revision)} vs candidate ${shortRevision(candidateRevision)}`)
    console.log(modes.map(mode => `${mode}: ${perMode.get(mode) ? `${perMode.get(mode)} differ` : 'identical'}`).join('\n'))
    if (differing.length && show > 0) {
      const sample = differing.slice(0, show)
      const [old, now] = await Promise.all([emitOutputs(baseline.root, inputs, modes, sample, scratch, 'baseline'), emitOutputs(ROOT, inputs, modes, sample, scratch, 'candidate')])
      for (const k of sample) console.log(`\n  ${k}\n    ${firstDifference(old[k] ?? '', now[k] ?? '')}`)
    }
    if (differing.length) {
      console.error(`\n${differing.length} output(s) differ`)
      process.exitCode = 1
    } else console.log('\nAll outputs are byte-identical.')
  } finally {
    rmSync(scratch, { recursive: true, force: true })
  }
}

await main()
