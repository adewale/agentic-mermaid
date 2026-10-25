import { spawnSync } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { assertBenchmarkExecutionAllowed } from './ci-policy.ts'

const directory = dirname(fileURLToPath(import.meta.url))
// Existing source-stage adapters and corpus paths use the repository as cwd.
const repository = resolve(process.env.AM_BENCH_REPOSITORY_ROOT ?? resolve(directory, '../..'))
const [command, ...args] = process.argv.slice(2)
const commands: Record<string, string[]> = {
  test: [process.execPath, 'test', '--timeout', '30000', '--parallel=2', resolve(directory, 'tests')],
  typecheck: [process.execPath, 'x', '--no-install', 'tsc', '--noEmit', '-p', resolve(directory, 'tsconfig.json')],
  lint: [process.execPath, 'x', '--no-install', 'biome', 'lint', '--config-path', resolve(directory, 'biome.json'), directory],
  bench: [process.execPath, 'run', resolve(directory, 'unified/run.ts')],
  community: [process.execPath, 'run', resolve(directory, 'unified/community-campaign.ts')],
  'community:update': [process.execPath, 'run', resolve(directory, 'unified/project-update.ts')],
  prs: [process.execPath, 'run', resolve(directory, 'unified/pr-campaign.ts')],
}
if (!command || !commands[command]) throw Error(`Use one of: ${Object.keys(commands).join(', ')}`)
assertBenchmarkExecutionAllowed()
const result = spawnSync(commands[command]![0]!, [...commands[command]!.slice(1), ...args], { cwd: repository, stdio: 'inherit' })
if (result.error) throw result.error
process.exitCode = result.status ?? 1
