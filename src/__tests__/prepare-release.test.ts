import { describe, expect, test } from 'bun:test'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { parseReleasePreparation, prepareRelease } from '../../scripts/prepare-release.ts'
import { useTempDirs } from './helpers/temp-dir.ts'

const temp = useTempDirs('release-preparation-')

function fixture(notes = '### Fixed\n\n- Retain every relationship.') {
  const root = temp.dir()
  execFileSync('git', ['init', '--quiet', root])
  const write = (path: string, text: string) => {
    mkdirSync(dirname(join(root, path)), { recursive: true })
    writeFileSync(join(root, path), text)
  }
  write('package.json', '{"name":"example","version":"1.2.3","private":true}\n')
  write('server.json', '{"name":"example/server","version":"1.2.3","packages":[{"registryType":"npm","identifier":"example","version":"1.2.3"}]}\n')
  write('src/version.ts', "// Runtime-safe version.\nexport const PACKAGE_VERSION = '1.2.3'\n")
  write('CHANGELOG.md', `# Changelog\n\n## Unreleased\n\n${notes}\n\n## 1.2.3 — 2026-10-29\n\nEarlier notes.\n`)
  write('docs/api.md', 'A pre-existing local edit.\n')
  write('src/browser-lazy/generated/existing.ts', 'original generated data\n')
  const read = (path: string) => readFileSync(join(root, path), 'utf8')
  const original = new Map(['package.json', 'server.json', 'src/version.ts', 'CHANGELOG.md', 'docs/api.md', 'src/browser-lazy/generated/existing.ts'].map(path => [path, read(path)]))
  return { root, write, read, original }
}

describe('release preparation', () => {
  test('updates all existing version projections and runs the owning generators without finalizing notes', () => {
    const f = fixture(), calls: string[] = []
    const changed = prepareRelease(f.root, { version: '1.2.4' }, script => {
      calls.push(script)
      expect(JSON.parse(f.read('package.json')).version).toBe('1.2.4')
      expect(f.read('src/version.ts')).toContain("PACKAGE_VERSION = '1.2.4'")
    })
    expect(JSON.parse(f.read('server.json'))).toEqual({ name: 'example/server', version: '1.2.4', packages: [{ registryType: 'npm', identifier: 'example', version: '1.2.4' }] })
    expect(JSON.parse(f.read('package.json')).private).toBe(true)
    expect(f.read('CHANGELOG.md')).toBe(f.original.get('CHANGELOG.md')!)
    expect(calls).toEqual(['generate:browser-families', 'doc-blocks', 'agent-doc-artifacts'])
    expect(changed).toEqual(['package.json', 'server.json', 'src/version.ts'])
    expect(execFileSync('git', ['ls-files', '--stage'], { cwd: f.root, encoding: 'utf8' })).toBe('')
  })

  test('dates exactly one section, preserves older notes, and is repeatable', () => {
    const f = fixture()
    prepareRelease(f.root, { version: '1.2.4', date: '2026-10-30' }, () => {})
    expect(f.read('CHANGELOG.md')).toBe('# Changelog\n\n## Unreleased\n\n## 1.2.4 — 2026-10-30\n\n### Fixed\n\n- Retain every relationship.\n\n## 1.2.3 — 2026-10-29\n\nEarlier notes.\n')
    expect(prepareRelease(f.root, { version: '1.2.4', date: '2026-10-30' }, () => {})).toEqual([])
    expect(prepareRelease(f.root, { version: '1.2.4' }, () => {})).toEqual([])
  })

  test.each([
    { version: '01.2.4' },
    { version: '1.2.4-beta.1' },
    { version: '1.2.2' },
    { version: '1.2.4', date: '2026-02-29' },
    { version: '1.2.4', date: '2026-13-01' },
  ])('rejects invalid or downgraded preparation before changing any file: %j', options => {
    const f = fixture()
    expect(() => prepareRelease(f.root, options, () => { throw new Error('Generation must not run') })).toThrow()
    for (const [path, text] of f.original) expect(f.read(path)).toBe(text)
  })

  test('refuses empty release notes or adding notes to an existing release', () => {
    const empty = fixture('')
    expect(() => prepareRelease(empty.root, { version: '1.2.4', date: '2026-10-30' }, () => {})).toThrow('Unreleased must contain release notes')
    const existing = fixture()
    expect(() => prepareRelease(existing.root, { version: '1.2.3', date: '2026-10-29' }, () => {})).toThrow('newer than the latest')
  })

  test('rolls back generated edits and additions while retaining earlier local edits', () => {
    const f = fixture()
    expect(() => prepareRelease(f.root, { version: '1.2.4', date: '2026-10-30' }, script => {
      if (script === 'generate:browser-families') {
        f.write('src/browser-lazy/generated/existing.ts', 'partly regenerated\n')
        f.write('src/browser-lazy/generated/new.ts', 'new generated data\n')
      } else {
        f.write('docs/api.md', 'partly regenerated documentation\n')
        f.write('src/cli/agent-instructions.ts', 'partly generated instructions\n')
        throw new Error('Generator failed')
      }
    })).toThrow('Generator failed')
    for (const [path, text] of f.original) expect(f.read(path)).toBe(text)
    expect(existsSync(join(f.root, 'src/browser-lazy/generated/new.ts'))).toBe(false)
    expect(existsSync(join(f.root, 'src/cli/agent-instructions.ts'))).toBe(false)
  })

  test.each([[], ['1.2.4', '--publish'], ['1.2.4', '--date'], ['1.2.4', '--date', '2026-10-30', '--publish']].map(args => ({ args })))('rejects unsupported CLI arguments: $args', ({ args }) => {
    expect(() => parseReleasePreparation(args)).toThrow('Usage:')
  })
})
