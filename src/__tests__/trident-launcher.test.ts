import { expect, test } from 'bun:test'
import { execFileSync, spawnSync } from 'node:child_process'
import { cpSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { useTempDirs } from './helpers/temp-dir.ts'

const temp = useTempDirs('am-trident-launcher-')
const launcher = resolve(import.meta.dir, '../../eval/trident/run.ts')
function fixture() {
  // macOS links /var to /private/var; the child reports the resolved path.
  const root = realpathSync(temp.dir()), source = join(root, 'agentic'), trident = join(root, 'trident')
  mkdirSync(join(source, 'eval/trident'), { recursive: true }); mkdirSync(trident)
  cpSync(launcher, join(source, 'eval/trident/run.ts'))
  cpSync(resolve(import.meta.dir, '../../eval/trident/prepare.ts'), join(source, 'eval/trident/prepare.ts'))
  writeFileSync(join(source, 'package.json'), '{"name":"agentic-mermaid"}')
  writeFileSync(join(trident, 'package.json'), '{"name":"trident"}')
  writeFileSync(join(trident, 'commands.ts'), 'console.log(JSON.stringify({args:process.argv.slice(2),source:process.env.TRIDENT_AGENTIC_ROOT,cwd:process.cwd()}));process.exitCode=23')
  const git = (args: string[]) => execFileSync('git', args, { cwd: trident, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
  git(['init', '-q']); git(['add', '.']); git(['-c', 'user.name=fixture', '-c', 'user.email=fixture@localhost', 'commit', '-qm', 'fixture'])
  const revision = git(['rev-parse', 'HEAD'])
  mkdirSync(join(trident, 'node_modules'))
  writeFileSync(join(trident, 'node_modules/.trident-installed'), revision + '\n')
  writeFileSync(join(source, 'eval/trident/config.json'), JSON.stringify({ repository: 'https://github.com/adewale/trident.git', revision }))
  const env: NodeJS.ProcessEnv = { ...process.env, TRIDENT_ROOT: trident, TRIDENT_AGENTIC_ROOT: 'explicit-unrelated-value' }
  for (const name of ['CI', 'GITHUB_ACTIONS', 'GITLAB_CI', 'BUILDKITE', 'CIRCLECI', 'TF_BUILD', 'JENKINS_URL', 'TEAMCITY_VERSION']) delete env[name]
  const run = (...args: string[]) => spawnSync(process.execPath, [join(source, 'eval/trident/run.ts'), ...args], { cwd: root, env, encoding: 'utf8', timeout: 10_000 })
  return { root, source, trident, env, run, revision }
}

test('the public Trident launcher forwards arguments and exit status without injecting an AM source target', () => {
  const f = fixture(), result = f.run('community:update', '--projects', 'owner/tool', '--out', 'results with spaces')
  expect(result.status).toBe(23)
  expect(JSON.parse(result.stdout)).toEqual({ args: ['community:update', '--projects', 'owner/tool', '--out', 'results with spaces'], source: 'explicit-unrelated-value', cwd: f.root })
})

test('a different Trident revision is rejected before delegation', () => {
  const f = fixture(), config = join(f.source, 'eval/trident/config.json')
  writeFileSync(config, JSON.stringify({ ...JSON.parse(readFileSync(config, 'utf8')), revision: '0'.repeat(40) }))
  const result = f.run('community:update', '--projects', 'owner/tool')
  expect(result.status).not.toBe(0)
  expect(result.stdout).toBe('')
  expect(result.stderr).toContain('differs from the configured revision')
  writeFileSync(config, JSON.stringify({ repository: 'https://github.com/adewale/trident.git', revision: f.revision }))
  writeFileSync(join(f.trident, 'commands.ts'), 'throw Error(\"Changed protocol must not run\")')
  const dirty = f.run('community:update', '--projects', 'owner/tool')
  expect(dirty.status).not.toBe(0)
  expect(dirty.stdout).toBe('')
  expect(dirty.stderr).toContain('working changes')
})

test('CI is rejected before reading configuration or acquiring Trident', () => {
  const f = fixture()
  f.env.CI = 'true'
  f.env.TRIDENT_ROOT = join(f.root, 'missing-install')
  const result = f.run('community:update', '--projects', 'owner/tool')
  expect(result.status).not.toBe(0)
  expect(result.stderr).toContain('Benchmarks are excluded from CI')
  expect(result.stdout).toBe('')
})

test('preparation preserves unrelated dependency paths instead of replacing them', () => {
  const f = fixture(), dependency = join(f.source, 'node_modules/trident')
  mkdirSync(dependency, { recursive: true })
  writeFileSync(join(dependency, 'notes.txt'), 'Preserve the user-installed package')
  const result = f.run('community:update', '--projects', 'owner/tool')
  expect(result.status).not.toBe(0)
  expect(result.stderr).toContain('An unrelated dependency occupies')
  expect(readFileSync(join(dependency, 'notes.txt'), 'utf8')).toBe('Preserve the user-installed package')
})
