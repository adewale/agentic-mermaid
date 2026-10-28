import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'
import { prepareTrident, assertLocalMeasurement } from '../trident/prepare.ts'
import scripts from './scripts.json' with { type: 'json' }
const root = resolve(import.meta.dirname, '../..')
const [command = 'bench', ...args] = process.argv.slice(2)
if (args.includes('--help') || command === '--help') {
  console.log('Agentic Mermaid product diagnostics\n\nbun run bench --list --profile full\nbun run bench:all [options]\nbun run bench:dave [options]\nbun run bench:test\nbun run bench:typecheck\n\nShared public-artifact comparisons: bun run bench:community:update --help\nProduct commands: ' + Object.keys(scripts).join(', '))
} else {
  assertLocalMeasurement()
  const trident = prepareTrident()
  if (command === 'corpus:export') {
    const index = args.indexOf('--out')
    if (args.length !== 2 || index !== 0 || !args[1]) throw Error('Use corpus:export --out FILE')
    await import('./unified/corpus-import.ts').then(module => console.log(module.importCommunityCorpus(root, resolve(args[1]!))))
  } else {
    if (!Object.hasOwn(scripts, command)) throw Error('Unknown product diagnostic ' + command)
    const { assertBenchmarkExecutionAllowed } = await import('trident/ci-policy.ts')
    assertBenchmarkExecutionAllowed(process.env, { mermaidOracle: !['bench:typecheck', 'bench:lint', 'bench:test'].includes(command) && !args.includes('--list') })
    const checks: Record<string, string[]> = {
      'bench:test': ['test', '--timeout', '30000', '--parallel=2', 'eval/benchmark/tests'],
      'bench:typecheck': ['x', '--no-install', 'tsc', '--noEmit', '-p', 'eval/benchmark/tsconfig.json'],
      'bench:lint': ['x', '--no-install', 'biome', 'lint', 'eval/benchmark'],
    }
    const tokens = scripts[command as keyof typeof scripts].split(' ')
    const argv = checks[command] ?? tokens.slice(tokens[1] === 'run' ? 2 : 1)
    const result = spawnSync(process.execPath, [...argv, ...args], { cwd: root, stdio: 'inherit', env: { ...process.env, TRIDENT_ROOT: trident } })
    if (result.error) throw result.error
    process.exitCode = result.status ?? 1
  }
}
