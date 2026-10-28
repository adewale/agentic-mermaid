import { spawnSync } from 'node:child_process'
import { join } from 'node:path'
import { prepareTrident, assertLocalMeasurement } from './prepare.ts'
const args = process.argv.slice(2)
if (!args.length || args[0] === '--help') {
  console.log('bun eval/trident/run.ts community:update|portable|build|results:publish [options]\nPublic artifact comparisons use the pinned Trident library. AM source diagnostics use bun run bench. See eval/trident/README.md.')
} else {
  if (!args.includes('--help')) assertLocalMeasurement()
  const trident = prepareTrident()
  const result = spawnSync(process.execPath, [join(trident, 'commands.ts'), ...args], { stdio: 'inherit' })
  if (result.error) throw result.error
  process.exitCode = result.status ?? 1
}
