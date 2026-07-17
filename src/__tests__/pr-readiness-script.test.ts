import { afterEach, describe, expect, test } from 'bun:test'
import { cpSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { spawnSync } from 'node:child_process'

const SCRIPT = join(import.meta.dir, '..', '..', 'scripts', 'ci', 'check-pr-readiness.sh')
const directories: string[] = []

function run(cwd: string, command: string[]) {
  return spawnSync(command[0]!, command.slice(1), { cwd, encoding: 'utf8', env: process.env })
}

function fixture(): string {
  const directory = mkdtempSync(join(tmpdir(), 'pr-readiness-'))
  directories.push(directory)
  writeFileSync(join(directory, 'README.md'), 'base\n')
  cpSync(SCRIPT, join(directory, 'check.sh'))
  for (const command of [
    ['git', 'init', '-b', 'main'],
    ['git', 'config', 'user.email', 'test@example.com'],
    ['git', 'config', 'user.name', 'Test'],
    ['git', 'add', '.'],
    ['git', 'commit', '-m', 'base'],
  ]) expect(run(directory, command).status).toBe(0)
  return directory
}

function commit(directory: string, file: string, content: string): void {
  expect(run(directory, ['git', 'switch', '-c', 'feature']).status).toBe(0)
  writeFileSync(join(directory, file), content)
  expect(run(directory, ['git', 'add', '.']).status).toBe(0)
  expect(run(directory, ['git', 'commit', '-m', 'change']).status).toBe(0)
}

afterEach(() => {
  while (directories.length > 0) rmSync(directories.pop()!, { recursive: true, force: true })
})

describe('PR readiness script exit contract', () => {
  test('ordinary non-UI changes complete successfully when grep finds no tests or UI files', () => {
    const directory = fixture()
    commit(directory, 'README.md', 'changed\n')
    const result = run(directory, ['bash', 'check.sh', 'main'])
    expect(result.status).toBe(0)
    expect(result.stdout).toContain('No test files modified')
    expect(result.stdout).toContain('No UI files changed')
    expect(result.stdout).toContain('Done.')
  })

  test('no diff and possible secrets produce explicit hard failures', () => {
    const noDiff = fixture()
    const empty = run(noDiff, ['bash', 'check.sh', 'main'])
    expect(empty.status).toBe(1)
    expect(empty.stdout).toContain('No changes detected')

    const secret = fixture()
    commit(secret, 'config.ts', 'const api_key = "do-not-commit"\n')
    const exposed = run(secret, ['bash', 'check.sh', 'main'])
    expect(exposed.status).toBe(1)
    expect(exposed.stdout).toContain('Possible secrets in diff')
  })

  test('UI changes warn but do not become accidental hard failures', () => {
    const directory = fixture()
    commit(directory, 'style.css', 'body { color: red; }\n')
    const result = run(directory, ['bash', 'check.sh', 'main'])
    expect(result.status).toBe(0)
    expect(result.stdout).toContain('UI-related files changed')
    expect(result.stdout).toContain('Done.')
  })
})
