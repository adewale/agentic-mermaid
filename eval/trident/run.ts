import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const enabled = (value: string | undefined) => value !== undefined && value !== '' && !/^(?:0|false|no)$/i.test(value)
const active = ['CI', 'GITHUB_ACTIONS', 'GITLAB_CI', 'BUILDKITE', 'CIRCLECI', 'TF_BUILD', 'JENKINS_URL', 'TEAMCITY_VERSION'].filter(name => enabled(process.env[name]))
if (active.length) throw Error(`Benchmarks are excluded from CI (${active.join(', ')}). Run them locally.`)
const args = process.argv.slice(2)
if (!args.length || args[0] === '--help') {
  console.log('bun eval/trident/run.ts agentic [options]\nUses the pinned adewale/trident revision; set TRIDENT_ROOT to an installed checkout of that revision. See eval/trident/README.md. Benchmarks never run in CI.')
} else {
  const config = JSON.parse(readFileSync(join(root, 'eval/trident/config.json'), 'utf8')) as { repository: string; revision: string }
  if (!/^[a-f0-9]{40}$/.test(config.revision) || config.repository !== 'https://github.com/adewale/trident.git') throw Error('Invalid pinned Trident configuration')
  const explicit = process.env.TRIDENT_ROOT
  const trident = resolve(explicit ?? join(root, 'bench-report/.trident', config.revision))
  const git = (values: string[]) => execFileSync('git', values, { cwd: trident, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
  if (!existsSync(join(trident, 'package.json'))) {
    if (explicit) throw Error('TRIDENT_ROOT must name an installed checkout of the pinned Trident revision')
    mkdirSync(trident, { recursive: true })
    git(['init', '-q'])
    git(['remote', 'add', 'origin', config.repository])
    git(['fetch', '--depth=1', 'origin', config.revision])
    git(['checkout', '--detach', 'FETCH_HEAD'])
  }
  if (git(['rev-parse', 'HEAD']) !== config.revision || JSON.parse(readFileSync(join(trident, 'package.json'), 'utf8')).name !== 'trident') throw Error('Trident checkout differs from the configured revision: ' + config.revision)
  if (git(['status', '--porcelain', '--untracked-files=no'])) throw Error('Pinned Trident checkout has working changes; commit or restore them before delegation')
  if (!existsSync(join(trident, 'node_modules/.trident-installed')) && !explicit) {
    const install = spawnSync(process.execPath, ['install', '--frozen-lockfile'], { cwd: trident, stdio: 'inherit' })
    if (install.error) throw install.error
    if (install.status !== 0) process.exit(install.status ?? 1)
    writeFileSync(join(trident, 'node_modules/.trident-installed'), config.revision + '\n')
  }
  const result = spawnSync(process.execPath, [join(trident, 'commands.ts'), ...args], { cwd: root, stdio: 'inherit', env: { ...process.env, TRIDENT_AGENTIC_ROOT: root } })
  if (result.error) throw result.error
  process.exitCode = result.status ?? 1
}
