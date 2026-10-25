import './ci-policy-enforce.ts'
import { benchmarkToolPins } from './tool-versions.ts'
// Everyday entry to the existing exact-artifact browser scorecard. Keep the
// implementation shared with the local release browser suite; warm-up differs.
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { ROOT } from './revision-tree.ts'
import { PERFORMANCE_EXPERIMENTS } from '../../src/experimental-performance.ts'

function main() {
  const args = process.argv.slice(2)
  if (args.includes('--help')) {
    console.log(`bun run bench:dave [--out DIR] [--rounds N] [--case ID,...] [--executable CHROMIUM] [--features NAME,...] [--bezel-dir DIR]\nBuilds and packs this checkout, then renders every official syntax fence with AM, Pele ${benchmarkToolPins['obsidianmd/pele'].version} and Mermaid 12.2.0. Add the verified Rust/WASM wrapper directory to include Bezel. Three rounds, 30 warm-up attempts. Results are advisory; no diagrams are excluded from coverage. Use release-browser-bench.ts directly for baseline tarballs, pinned Dart wrappers and separate memory diagnostics.`)
    return
  }
  // Validate options before the build or any network work.
  const options = new Map<string, string>()
  const allowed = new Set(['out', 'rounds', 'case', 'executable', 'features', 'bezel-dir'])
  for (let i = 0; i < args.length; i += 2) {
    const flag = args[i]!, key = flag.slice(2), value = args[i + 1]
    if (!flag.startsWith('--') || !allowed.has(key) || !value || value.startsWith('--') || options.has(key)) throw new Error(`Invalid Dave benchmark option: ${flag}`)
    options.set(key, value)
  }
  const rounds = Number(options.get('rounds') ?? 3)
  if (!Number.isSafeInteger(rounds) || rounds < 1) throw new Error('--rounds must be a positive integer')
  const features = options.get('features')?.split(',') ?? []
  if (features.some(feature => !PERFORMANCE_EXPERIMENTS.some(name => name === feature)) || new Set(features).size !== features.length) throw new Error('Invalid experimental feature selection')
  const env = { ...process.env, npm_config_cache: process.env.npm_config_cache ?? join(tmpdir(), 'am-benchmark-npm') }
  const run = (command: string, argv: string[], capture = false): string => {
    const result = spawnSync(command, argv, { cwd: ROOT, env, encoding: 'utf8', stdio: capture ? 'pipe' : 'inherit', maxBuffer: 8 * 1024 * 1024 })
    if (result.status !== 0) throw new Error(`${command} ${argv[0]} failed: ${result.error?.message ?? result.stderr ?? result.status}`)
    return result.stdout ?? ''
  }
  const scratch = mkdtempSync(join(tmpdir(), 'am-dave-'))
  try {
    run(process.execPath, ['run', 'build'])
    const packed = JSON.parse(run('npm', ['pack', '--ignore-scripts', '--json', '--pack-destination', scratch], true)) as Array<{ filename: string }>
    if (packed.length !== 1 || !packed[0]?.filename) throw new Error('npm pack returned no unique candidate artifact')
    const candidate = resolve(scratch, packed[0].filename)
    const sha256 = createHash('sha256').update(readFileSync(candidate)).digest('hex')
    run(process.execPath, ['run', 'eval/benchmark/release-browser-bench.ts', '--candidate-tarball', candidate, '--candidate-sha256', sha256,
      '--out', options.get('out') ?? 'bench-report/dave', '--rounds', String(rounds), '--warmup', '30',
      ...[...options].filter(([key]) => key !== 'out' && key !== 'rounds').flatMap(([key, value]) => [`--${key}`, value])])
  } finally {
    rmSync(scratch, { recursive: true, force: true })
  }
}

if (import.meta.main) main()
