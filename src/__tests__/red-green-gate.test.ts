// Exercise the CI entrypoint in real two-commit repositories. A failing Bun
// process is not, by itself, evidence that a behavioral assertion ran.
import { describe, expect, test } from 'bun:test'
import { copyFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { useTempDirs } from './helpers/temp-dir.ts'

const temp = useTempDirs('am-red-green-contract-')
const gate = join(import.meta.dir, '../../scripts/ci/red-green.ts')

function check(testSource: string, baseSource = 'export const value = 1\n') {
  const root = temp.dir()
  const env = { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1', GITHUB_ACTIONS: 'false' }
  const git = (...args: string[]) => {
    const result = Bun.spawnSync(['git', ...args], { cwd: root, stdout: 'pipe', stderr: 'pipe', env })
    if (result.exitCode !== 0) throw new Error(result.stderr.toString())
    return result.stdout.toString().trim()
  }
  const put = (path: string, content: string) => {
    mkdirSync(dirname(join(root, path)), { recursive: true })
    writeFileSync(join(root, path), content)
  }
  git('init', '--quiet')
  git('config', 'user.name', 'Gate contract')
  git('config', 'user.email', 'gate@example.invalid')
  put('scripts/ci/red-green.ts', '')
  copyFileSync(gate, join(root, 'scripts/ci/red-green.ts'))
  put('src/value.ts', baseSource)
  put('src/__tests__/behavior.test.ts', "import { expect, test } from 'bun:test'\nimport { value } from '../value.ts'\ntest('base behavior', () => expect(value).toBe(1))\n")
  git('add', '.')
  git('commit', '--quiet', '-m', 'base')
  const base = git('rev-parse', 'HEAD')
  put('src/value.ts', 'export const value = 2\nexport const introduced = true\n')
  put('src/__tests__/behavior.test.ts', testSource)
  git('add', '.')
  git('commit', '--quiet', '-m', 'candidate')
  const result = Bun.spawnSync([process.execPath, 'run', 'scripts/ci/red-green.ts', '--base', base], {
    cwd: root, stdout: 'pipe', stderr: 'pipe',
    env,
  })
  return { exitCode: result.exitCode, output: result.stdout.toString() + result.stderr.toString() }
}

const imports = "import { beforeAll, expect, test } from 'bun:test'\nimport { value } from '../value.ts'\n"

describe('CI red→green proves a behavioral regression', () => {
  test('accepts a changed assertion that fails against base production', () => {
    const result = check(imports + "test('new behavior', () => expect(value).toBe(2))\n")
    expect(result.exitCode, result.output).toBe(0)
    expect(result.output).toContain('1 assertion failure')
  })

  test('rejects changed tests that still pass on base', () => {
    const result = check(imports + "test('not discriminating', () => expect(value).toBeGreaterThan(0))\n")
    expect(result.exitCode, result.output).not.toBe(0)
    expect(result.output).toContain('Every changed test passes')
  })

  test('located per-test hook assertions remain reviewable evidence, not phase-aware proof', () => {
    // Bun JUnit attributes beforeEach assertions to the test's location. The
    // gate cannot infer whether that assertion checks behavior or just setup.
    const result = check("import { beforeEach, expect, test } from 'bun:test'\nimport { value } from '../value.ts'\nbeforeEach(() => expect(value).toBe(2))\ntest('behavior', () => expect(value).toBeGreaterThan(0))\n")
    expect(result.exitCode, result.output).toBe(0)
    expect(result.output).toContain('review assertion meaning')
  })

  test.each([
    ['missing new API', "import { introduced } from '../value.ts'\nimport { expect, test } from 'bun:test'\ntest('new API', () => expect(introduced).toBe(true))\n"],
    ['failed setup', imports + "beforeAll(() => { throw new Error('fixture setup failed') })\ntest('never reaches behavior', () => expect(value).toBe(2))\n"],
    ['setup assertion after a passing test', "import { beforeAll, describe, expect, test } from 'bun:test'\nimport { value } from '../value.ts'\ntest('unrelated pass', () => expect(value).toBeGreaterThan(0))\ndescribe('fixture', () => { beforeAll(() => expect(value).toBe(2)); test('never executes', () => {}) })\n"],
    ['timeout', imports + "test('no completed assertion', async () => { if (value === 1) await new Promise(() => {}); expect(value).toBe(2) }, 1)\n"],
    ['aborted runner', imports + "process.exit(42)\n"],
  ])('does not count %s as behavioral proof', (_name, source) => {
    const result = check(source)
    expect(result.exitCode, result.output).not.toBe(0)
    expect(result.output).toContain('No completed assertion failure')
  })
})
