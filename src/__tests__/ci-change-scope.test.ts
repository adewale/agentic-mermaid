import { describe, expect, test } from 'bun:test'
import { join } from 'node:path'
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { parse as parseYaml } from 'yaml'
import { useTempDirs } from './helpers/temp-dir.ts'

const command = join(import.meta.dir, '../../scripts/ci/change-scope.ts')
const temporary = useTempDirs('ci-scope-')
function scope(paths: string[], args: string[] = [], output = '') {
  const result = Bun.spawnSync([process.execPath, command, ...args], {
    stdin: Buffer.from(paths.join('\0') + '\0'), stdout: 'pipe', stderr: 'pipe',
    env: { ...process.env, GITHUB_OUTPUT: output },
  })
  expect(result.exitCode, result.stderr.toString()).toBe(0)
  return JSON.parse(result.stdout.toString())
}

describe('CI change routing through its executable', () => {
  test.each([
    [['docs/api.md', 'README.md'], { full: false }],
    [['docs/project/release notes.md', 'skills/diagram/SKILL.md'], { full: false }],
    [['src/parser.ts', 'docs/api.md'], { full: true }],
    [['docs/api.md', 'unknown\ninput'], { full: true }],
    [['docs/api.md', 'src/deleted.ts'], { full: true }],
    [['src/mcp/server.ts'], { full: true }],
    [['.github/workflows/ci.yml'], { full: true }],
    [['unrecognized/input'], { full: true }],
    [['src/runtime.md'], { full: true }],
    [['package.json'], { full: true }],
    [[], { full: true }],
  ] as const)('classifies %j conservatively', (paths, expected) => {
    expect(scope([...paths])).toEqual(expected)
  })
  test('explicit qualification requests override documentation scope', () => {
    expect(scope(['docs/api.md'], ['--full'])).toEqual({ full: true })
  })
  test('Actions receives the same decision as the CLI result', () => {
    const output = join(temporary.dir(), 'outputs')
    expect(scope(['docs/api.md'], [], output)).toEqual({ full: false })
    expect(readFileSync(output, 'utf8')).toBe('full=false\n')
  })
})

describe('CI selects the diff of its actual Git checkout', () => {
  const workflow = parseYaml(readFileSync(join(import.meta.dir, '../../.github/workflows/ci.yml'), 'utf8'))
  const shell = workflow.jobs.scope.steps.find((step: { id?: string }) => step.id === 'scope').run as string

  function repository() {
    const root = temporary.dir()
    const env = { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' }
    const git = (...args: string[]) => {
      const result = Bun.spawnSync(['git', ...args], { cwd: root, env, stdout: 'pipe', stderr: 'pipe' })
      expect(result.exitCode, result.stderr.toString()).toBe(0)
      return result.stdout.toString().trim()
    }
    git('init', '-q', '-b', 'main')
    git('config', 'user.name', 'Scope contract')
    git('config', 'user.email', 'scope@example.invalid')
    mkdirSync(join(root, 'scripts/ci'), { recursive: true })
    mkdirSync(join(root, 'src'))
    copyFileSync(command, join(root, 'scripts/ci/change-scope.ts'))
    writeFileSync(join(root, 'README.md'), 'Initial documentation\n')
    writeFileSync(join(root, 'src/value.ts'), 'export const value = 1\n')
    const commit = (message: string) => { git('add', '.'); git('commit', '-qm', message); return git('rev-parse', 'HEAD') }
    const base = commit('base')
    const run = (event: string, before = base) => {
      const payload = join(temporary.dir(), 'event.json')
      writeFileSync(payload, JSON.stringify({ before }))
      const result = Bun.spawnSync(['bash', '-e', '-o', 'pipefail', '-c', shell], {
        cwd: root, stdout: 'pipe', stderr: 'pipe',
        env: { ...env, GITHUB_OUTPUT: '', GITHUB_EVENT_NAME: event, GITHUB_EVENT_PATH: payload },
      })
      expect(result.exitCode, result.stderr.toString()).toBe(0)
      return JSON.parse(result.stdout.toString())
    }
    return { root, git, commit, base, run }
  }

  test('a documentation PR uses its current merge parent instead of an old event base', () => {
    const repo = repository()
    repo.git('checkout', '-qb', 'topic')
    writeFileSync(join(repo.root, 'README.md'), 'Changed documentation\n')
    repo.commit('docs')
    repo.git('checkout', '-q', 'main')
    writeFileSync(join(repo.root, 'src/value.ts'), 'export const value = 2\n')
    repo.commit('base advanced')
    repo.git('merge', '--no-ff', '-qm', 'tested merge', 'topic')
    expect(repo.run('pull_request')).toEqual({ full: false })
  })
  test('a runtime file renamed into documentation still receives full qualification', () => {
    const repo = repository()
    mkdirSync(join(repo.root, 'docs'))
    repo.git('mv', 'src/value.ts', 'docs/value.md')
    repo.commit('rename')
    expect(repo.run('push')).toEqual({ full: true })
  })
  test('manual qualification and unavailable history cannot take the docs shortcut', () => {
    const repo = repository()
    writeFileSync(join(repo.root, 'README.md'), 'Changed documentation\n')
    repo.commit('docs')
    expect(repo.run('workflow_dispatch')).toEqual({ full: true })
    expect(repo.run('push', '0'.repeat(40))).toEqual({ full: true })
  })

  test('manual layout review requires and checks out its explicit baseline', () => {
    const repo = repository()
    writeFileSync(join(repo.root, 'bun.lock'), 'shared dependency fixture\n')
    const base = repo.commit('review base')
    writeFileSync(join(repo.root, 'README.md'), 'Current head\n')
    repo.commit('review head')
    repo.git('remote', 'add', 'origin', repo.root)
    mkdirSync(join(repo.root, 'node_modules'))
    const directory = temporary.dir()
    const envFile = join(directory, 'env')
    const prepare = workflow.jobs['layout-evidence'].steps.find((step: { name?: string }) => step.name === 'Prepare the immutable base for layout review')
    expect(prepare.env.LAYOUT_BASE_SHA).toBe('${{ inputs.layout_base }}')
    const run = (baseline: string) => Bun.spawnSync(['bash', '-e', '-o', 'pipefail', '-c', prepare.run], {
      cwd: repo.root, stdout: 'pipe', stderr: 'pipe',
      env: { ...process.env, LAYOUT_BASE_SHA: baseline, RUNNER_TEMP: directory, GITHUB_WORKSPACE: repo.root, GITHUB_ENV: envFile },
    })
    expect(run('').exitCode).not.toBe(0)
    expect(run('main').exitCode).not.toBe(0)
    const result = run(base)
    expect(result.exitCode, result.stderr.toString()).toBe(0)
    expect(readFileSync(join(directory, 'layout-review-base', 'README.md'), 'utf8')).toBe('Initial documentation\n')
    expect(readFileSync(envFile, 'utf8')).toBe(`LAYOUT_BASE_ROOT=${directory}/layout-review-base\n`)
  })
})
