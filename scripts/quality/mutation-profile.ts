import { MUTATION_PROFILES } from '../../stryker.config.mjs'

const [requested = 'core', ...passthrough] = process.argv.slice(2)
if (requested === '--list') {
  process.stdout.write(`${Object.keys(MUTATION_PROFILES).join('\n')}\n`)
  process.exit(0)
}
if (!Object.hasOwn(MUTATION_PROFILES, requested)) {
  process.stderr.write(`Unknown mutation profile "${requested}". Run \`bun run mutation-test -- --list\`.\n`)
  process.exit(2)
}

const child = Bun.spawnSync(['npx', 'stryker', 'run', 'stryker.config.mjs', ...passthrough], {
  cwd: new URL('../..', import.meta.url).pathname,
  env: { ...process.env, AM_MUTATION_PROFILE: requested },
  stdin: 'inherit',
  stdout: 'inherit',
  stderr: 'inherit',
})
process.exit(child.exitCode)
