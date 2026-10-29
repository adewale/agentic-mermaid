import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, lstatSync, mkdirSync, readFileSync, readlinkSync, realpathSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')

/** Refuse measurements before the shared library can be fetched or installed.
 * Static repository typechecks call preparation directly and remain CI-safe. */
export function assertLocalMeasurement(): void {
  const active = ['CI', 'GITHUB_ACTIONS', 'GITLAB_CI', 'BUILDKITE', 'CIRCLECI', 'TF_BUILD', 'JENKINS_URL', 'TEAMCITY_VERSION'].filter(name => {
    const value = process.env[name]
    return name === 'CI' ? value !== undefined && value !== '' : value !== undefined && value !== '' && !/^(?:0|false|no)$/i.test(value)
  })
  if (active.length) throw Error(`Benchmarks are excluded from CI (${active.join(', ')}). Run them locally.`)
}

/** Fetch the reviewed shared library. Preparation and typechecking may run in
 * CI; benchmark commands enforce the separate no-measurements-in-CI policy. */
export function prepareTrident(): string {
  const config = JSON.parse(readFileSync(join(root, 'eval/trident/config.json'), 'utf8')) as { repository: string; revision: string }
  if (!/^[a-f0-9]{40}$/.test(config.revision) || config.repository !== 'https://github.com/adewale/trident.git') throw Error('Invalid pinned Trident configuration')
  const explicit = process.env.TRIDENT_ROOT
  const trident = resolve(explicit ?? join(root, 'bench-report/.trident', config.revision))
  const git = (values: string[]) => execFileSync('git', values, { cwd: trident, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
  if (!existsSync(join(trident, 'package.json'))) {
    if (explicit) throw Error('TRIDENT_ROOT must name an installed checkout of the pinned Trident revision')
    mkdirSync(trident, { recursive: true })
    git(['init', '-q'])
    let origin: string | undefined
    try { origin = git(['config', '--get', 'remote.origin.url']) } catch {}
    if (origin && origin !== config.repository) throw Error('Cached Trident remote differs from the configured repository')
    if (!origin) git(['remote', 'add', 'origin', config.repository])
    git(['fetch', '--depth=1', 'origin', config.revision])
    git(['checkout', '--detach', 'FETCH_HEAD'])
  }
  if (git(['rev-parse', 'HEAD']) !== config.revision || JSON.parse(readFileSync(join(trident, 'package.json'), 'utf8')).name !== 'trident') throw Error('Trident checkout differs from the configured revision: ' + config.revision)
  if (git(['status', '--porcelain', '--untracked-files=no'])) throw Error('Pinned Trident checkout has working changes; commit or restore them before delegation')
  if (!existsSync(join(trident, 'node_modules/.trident-installed'))) {
    const install = spawnSync(process.execPath, ['install', '--frozen-lockfile'], { cwd: trident, stdio: 'inherit' })
    if (install.error) throw install.error
    if (install.status !== 0) process.exit(install.status ?? 1)
    writeFileSync(join(trident, 'node_modules/.trident-installed'), config.revision + '\n')
  }
  const receiptFile = join(root, 'bench-report/.trident/library-links.json')
  const previous = existsSync(receiptFile) ? JSON.parse(readFileSync(receiptFile, 'utf8')) as Record<string, string> : {}
  const links = [[join(root, 'node_modules/trident'), trident], [join(root, 'eval/benchmark/node_modules'), join(trident, 'node_modules')]] as const
  for (const [link, target] of links) {
    mkdirSync(dirname(link), { recursive: true })
    let present = false
    try { lstatSync(link); present = true } catch {}
    if (present) {
      if (!lstatSync(link).isSymbolicLink()) throw Error('An unrelated dependency occupies ' + link)
      const actual = existsSync(link) ? realpathSync(link) : resolve(dirname(link), readlinkSync(link))
      if (actual === realpathSync(target)) continue
      if (!previous[link] || actual !== previous[link]) throw Error('An unrelated dependency occupies ' + link)
      unlinkSync(link)
    }
    symlinkSync(target, link, 'dir')
  }
  mkdirSync(dirname(receiptFile), { recursive: true })
  writeFileSync(receiptFile, JSON.stringify(Object.fromEntries(links.map(([link, target]) => [link, realpathSync(target)])), null, 2) + '\n')
  return trident
}
if (import.meta.main) console.log(prepareTrident())
