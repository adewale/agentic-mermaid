// Output identity across revisions: render the official syntax examples, the
// docs corpus, the release scaling cases and the micro-benchmark workloads in
// several output modes at two revisions, and report every output that differs.
// Use it to show that a refactor or performance change preserves bytes.
//
//   bun run eval/benchmark/output-identity.ts                   # vs origin/main
//   bun run eval/benchmark/output-identity.ts --baseline <ref> --jobs 3 --show 5
//
// Modes cover each Scene backend and every whole-document SVG pass: default
// SVG; the rough (`excalidraw`), hybrid (`watercolor`) and palette
// (`tokyo-night`) styles; `idPrefix` + `compact`; live CSS-variable colors;
// ASCII; Unicode; and `verifyMermaid` results. A thrown error is an output
// too, so failing inputs must fail identically. Only SHA-256 digests of
// outputs are kept; `--show N` re-renders the first N differences on both
// sides and prints where they diverge. Baseline digests are cached per
// revision under node_modules/.cache/ and reused while inputs and modes match.

import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { MICRO_WORKLOADS } from './micro-bench-cases.ts'
import { releaseBenchCases } from './release-bench-cases.ts'
import { extractRevisionTree, ROOT, workingRevision } from './revision-tree.ts'

const MODES = ['svg', 'svg:excalidraw', 'svg:watercolor', 'svg:tokyo-night', 'svg:prefixed-compact', 'svg:live-vars', 'ascii', 'unicode', 'verify'] as const
type Mode = (typeof MODES)[number]
type Input = readonly [id: string, source: string]
type Digests = Record<string, string>

const SCRIPT_PATH = 'eval/benchmark/output-identity.ts'
const CACHE_DIR = join(ROOT, 'node_modules/.cache/agentic-mermaid-identity')

function parseArgs(argv: readonly string[]): Map<string, string> {
  const flags = new Set(['child'])
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
  return [
    ...extractOfficialCorpus().map(fence => [fence.id, fence.source] as const),
    ...docs.map((entry, index) => [`docs-corpus#${index}`, entry.source] as const),
    ...releaseBenchCases().map(input => [`release:${input.id}`, input.source] as const),
    ...Object.entries(MICRO_WORKLOADS).map(([id, source]) => [`micro:${id}`, source] as const),
  ]
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
    ascii: source => lib.renderMermaidASCII(source, { useAscii: true }),
    unicode: source => lib.renderMermaidASCII(source),
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
      else digests[k] = createHash('sha256').update(text).digest('hex')
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
  return Object.assign({}, ...results)
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
  const modes = (args.get('modes')?.split(',') ?? [...MODES]) as Mode[]
  const unknown = modes.filter(mode => !MODES.includes(mode))
  if (unknown.length) throw new Error(`Unknown mode(s): ${unknown.join(', ')}; known: ${MODES.join(', ')}`)
  const jobs = Math.max(1, Number(args.get('jobs') ?? 3))
  const show = Number(args.get('show') ?? 5)
  const inputs = await loadInputs()
  const scratch = mkdtempSync(join(tmpdir(), 'agentic-mermaid-identity-'))
  try {
    const baseline = extractRevisionTree(args.get('baseline') ?? 'origin/main', scratch, 'baseline')
    const cacheFile = join(CACHE_DIR, `${baseline.revision}.json`)
    const cached = existsSync(cacheFile) ? (JSON.parse(readFileSync(cacheFile, 'utf8')) as { modes: Mode[]; inputs: Input[]; digests: Digests }) : undefined
    let before: Digests
    if (cached && JSON.stringify(cached.modes) === JSON.stringify(modes) && JSON.stringify(cached.inputs) === JSON.stringify(inputs)) {
      console.error(`baseline ${baseline.revision.slice(0, 12)}: cached digests`)
      before = cached.digests
    } else {
      console.error(`baseline ${baseline.revision.slice(0, 12)}: rendering ${inputs.length} inputs × ${modes.length} modes`)
      before = await digestSide(baseline.root, inputs, modes, jobs, scratch, 'baseline')
      mkdirSync(CACHE_DIR, { recursive: true })
      writeFileSync(cacheFile, JSON.stringify({ modes, inputs, digests: before }))
    }
    const candidateRevision = workingRevision()
    console.error(`candidate ${candidateRevision.slice(0, 12)}: rendering ${inputs.length} inputs × ${modes.length} modes`)
    const after = await digestSide(ROOT, inputs, modes, jobs, scratch, 'candidate')

    const differing = Object.keys(before).filter(k => before[k] !== after[k])
    const perMode = new Map(modes.map(mode => [mode, differing.filter(k => k.endsWith(` | ${mode}`)).length]))
    console.log(`\n${Object.keys(before).length} outputs (${inputs.length} inputs × ${modes.length} modes), baseline ${baseline.revision.slice(0, 12)} vs candidate ${candidateRevision.slice(0, 12)}`)
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
