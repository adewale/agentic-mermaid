import { describe, expect, test } from 'bun:test'
import { cpSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { useTempDirs } from './helpers/temp-dir.ts'

const temp = useTempDirs()

const SCRIPT = join(import.meta.dir, '..', '..', 'scripts', 'ci', 'check-pr-readiness.sh')

function run(cwd: string, command: string[]) {
  return spawnSync(command[0]!, command.slice(1), { cwd, encoding: 'utf8', env: process.env })
}

function fixture(): string {
  const directory = temp.dir('pr-readiness-')
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

    const credentialRepo = fixture()
    commit(credentialRepo, 'config.ts', ['const api', 'key = "do-not-commit"\n'].join('_'))
    const exposed = run(credentialRepo, ['bash', 'check.sh', 'main'])
    expect(exposed.status).toBe(1)
    expect(exposed.stdout).toContain('Possible secrets in diff')
  })

  test('rename-only changes are real diffs even with zero changed text lines', () => {
    const directory = fixture()
    expect(run(directory, ['git', 'switch', '-c', 'feature']).status).toBe(0)
    renameSync(join(directory, 'README.md'), join(directory, 'GUIDE.md'))
    expect(run(directory, ['git', 'add', '-A']).status).toBe(0)
    expect(run(directory, ['git', 'commit', '-m', 'rename']).status).toBe(0)
    const result = run(directory, ['bash', 'check.sh', 'main'])
    expect(result.status).toBe(0)
    expect(result.stdout).toContain('Diff size: 0 text lines changed')
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
