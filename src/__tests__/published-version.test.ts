import { describe, expect, test } from 'bun:test'
import { spawnSync } from 'node:child_process'
import { chmodSync, cpSync, existsSync, mkdirSync, readFileSync, readdirSync, readlinkSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { useTempDirs } from './helpers/temp-dir.ts'

const temp = useTempDirs('am-published-version-')
const script = readFileSync(new URL('../../scripts/ci/published-version.ts', import.meta.url), 'utf8')
const npm = Bun.which('npm')
if (!npm) throw new Error('The immutable-package boundary requires npm')
let published: { source: string; tarball: string } | undefined

function publishedFixture() {
  if (published) return published
  const source = temp.dir()
  mkdirSync(join(source, 'dist'))
  mkdirSync(join(source, 'docs'))
  writeFileSync(join(source, 'package.json'), JSON.stringify({
    name: 'agentic-mermaid', version: '1.2.3', files: ['dist/', 'docs/*.md'],
    scripts: { prepack: 'node -e "require(\'fs\').writeFileSync(\'lifecycle-ran\', \'unexpected\')"' },
  }))
  writeFileSync(join(source, 'README.md'), '# Published package\n')
  writeFileSync(join(source, 'docs', 'api.md'), '# Published API\n')
  writeFileSync(join(source, 'dist', 'index.js'), 'export const version = "1.2.3"\n')
  const archive = temp.dir()
  const packed = spawnSync(npm!, ['pack', '--ignore-scripts', '--json', '--pack-destination', archive], {
    cwd: source, encoding: 'utf8', timeout: 20_000,
  })
  if (packed.status !== 0) throw new Error(packed.stderr)
  published = { source, tarball: join(archive, JSON.parse(packed.stdout)[0].filename) }
  return published
}

function fixture(options: { full?: boolean; registry?: 'absent' | 'unavailable'; packFailure?: boolean; concurrentDist?: 'before' | 'after' } = {}) {
  const dir = temp.dir()
  const root = join(dir, 'checkout')
  const bin = join(dir, 'bin')
  const temporary = join(dir, 'tmp')
  const baseline = publishedFixture()
  cpSync(baseline.source, root, { recursive: true })
  if (!options.full) rmSync(join(root, 'dist'), { recursive: true })
  mkdirSync(join(root, 'scripts', 'ci'), { recursive: true })
  writeFileSync(join(root, 'scripts', 'ci', 'published-version.ts'), script)
  mkdirSync(bin)
  mkdirSync(temporary)
  writeFileSync(join(bin, 'npm'), `#!/usr/bin/env bash
set -euo pipefail
printf '%s\\n' "$*" >> "$MOCK_CALLS"
case "$1" in
  view)
    case "$MOCK_REGISTRY" in
      absent) echo 'npm error code E404' >&2; exit 1 ;;
      unavailable) echo 'npm error code ETIMEDOUT' >&2; exit 1 ;;
      *) printf '"1.2.3"\\n' ;;
    esac
    ;;
  pack)
    if [[ "\${2:-}" == 'agentic-mermaid@1.2.3' ]]; then
      while [[ "$#" -gt 0 ]]; do
        if [[ "$1" == --pack-destination ]]; then
          cp "$MOCK_PUBLISHED" "$2/published.tgz"
          printf '[{"filename":"published.tgz"}]\\n'
          exit 0
        fi
        shift
      done
      exit 65
    fi
    if [[ "$MOCK_PACK_FAILURE" == true ]]; then echo 'fixture local pack failure' >&2; exit 17; fi
    replace_dist() {
      rm -rf dist
      mkdir dist
      printf 'external build output\\n' > dist/other-build.js
    }
    if [[ "$MOCK_CONCURRENT_DIST" == before ]]; then replace_dist; fi
    if [[ "$MOCK_CONCURRENT_DIST" == after ]]; then
      "$REAL_NPM" "$@"
      replace_dist
    else exec "$REAL_NPM" "$@"; fi
    ;;
  *) exit 64 ;;
esac
`)
  chmodSync(join(bin, 'npm'), 0o755)
  return {
    root,
    run(args = options.full ? [] : ['--docs-only']) {
      const result = spawnSync(process.execPath, [join(root, 'scripts', 'ci', 'published-version.ts'), ...args], {
        cwd: root, encoding: 'utf8', timeout: 20_000,
        env: {
          ...process.env, PATH: `${bin}:${process.env.PATH}`, TMPDIR: temporary,
          NODE_DISABLE_COMPILE_CACHE: '1', REAL_NPM: npm!, MOCK_CALLS: join(dir, 'calls'), MOCK_PUBLISHED: baseline.tarball,
          MOCK_REGISTRY: options.registry ?? 'published', MOCK_PACK_FAILURE: String(options.packFailure ?? false),
          MOCK_CONCURRENT_DIST: options.concurrentDist ?? 'none',
        },
      })
      const calls = existsSync(join(dir, 'calls')) ? readFileSync(join(dir, 'calls'), 'utf8').trim().split('\n') : []
      return { ...result, calls, temporary: readdirSync(temporary) }
    },
  }
}

describe('premerge immutable npm version CLI', () => {
  test('unchanged authored files reuse published runtime without executing lifecycle scripts', () => {
    const local = fixture()
    const result = local.run()
    expect({ status: result.status, stderr: result.stderr }).toEqual({ status: 0, stderr: '' })
    expect(result.calls[0]).toBe('view agentic-mermaid@1.2.3 version --json')
    expect(result.calls[1]).toStartWith('pack agentic-mermaid@1.2.3 --ignore-scripts --json ')
    expect(result.calls[2]).toStartWith('pack --ignore-scripts --json ')
    expect(existsSync(join(local.root, 'lifecycle-ran'))).toBe(false)
    expect(existsSync(join(local.root, 'dist'))).toBe(false)
    expect(result.temporary).toEqual([])
  })

  test.each([
    ['changed README', (root: string) => writeFileSync(join(root, 'README.md'), '# Changed README\n')],
    ['changed packaged doc', (root: string) => writeFileSync(join(root, 'docs', 'api.md'), '# Changed API\n')],
    ['new packaged doc', (root: string) => writeFileSync(join(root, 'docs', 'new.md'), '# New API\n')],
    ['deleted packaged doc', (root: string) => rmSync(join(root, 'docs', 'api.md'))],
  ])('rejects %s under a published version and cleans its comparison scratch', (_name, change) => {
    const local = fixture()
    change(local.root)
    const result = local.run()
    expect(result.status).not.toBe(0)
    expect(result.stderr).toContain('bump the package version before merging')
    expect(existsSync(join(local.root, 'dist'))).toBe(false)
    expect(result.temporary).toEqual([])
  })

  test('repository-only documents remain outside npm package identity', () => {
    const local = fixture()
    mkdirSync(join(local.root, 'docs', 'project'))
    writeFileSync(join(local.root, 'docs', 'project', 'release-record.md'), '# Repository-only update\n')
    expect(local.run().status).toBe(0)
  })

  test.each(['directory', 'file', 'symlink'] as const)('refuses an existing dist %s without overwriting or deleting it', kind => {
    const local = fixture()
    const dist = join(local.root, 'dist')
    const sentinel = join(local.root, 'sentinel')
    writeFileSync(sentinel, 'keep these bytes')
    if (kind === 'directory') {
      mkdirSync(dist)
      writeFileSync(join(dist, 'original.js'), 'keep these bytes')
    } else if (kind === 'file') writeFileSync(dist, 'keep these bytes')
    else symlinkSync(sentinel, dist)
    const result = local.run()
    expect(result.status).not.toBe(0)
    expect(result.stderr).toContain('requires dist to be absent')
    expect(readFileSync(kind === 'directory' ? join(dist, 'original.js') : dist, 'utf8')).toBe('keep these bytes')
    expect(result.calls).toEqual(['view agentic-mermaid@1.2.3 version --json'])
    if (kind === 'symlink') expect(readlinkSync(dist)).toBe(sentinel)
  })

  test('a failed local pack cleans comparison scratch without changing authored files', () => {
    const local = fixture({ packFailure: true })
    const result = local.run()
    expect(result.status).not.toBe(0)
    expect(result.stderr).toContain('fixture local pack failure')
    expect(existsSync(join(local.root, 'dist'))).toBe(false)
    expect(result.temporary).toEqual([])
    expect(readFileSync(join(local.root, 'README.md'), 'utf8')).toBe('# Published package\n')
  })

  test.each(['before', 'after'] as const)('preserves another build replacing workspace dist %s the real local pack', when => {
    const local = fixture({ concurrentDist: when })
    const result = local.run()
    expect(result.status === 0).toBe(when === 'after')
    if (when === 'before') expect(result.stderr).toContain('local package contains dist')
    const otherBuild = join(local.root, 'dist', 'other-build.js')
    expect(existsSync(otherBuild)).toBe(true)
    expect(readFileSync(otherBuild, 'utf8')).toBe('external build output\n')
    expect(result.temporary).toEqual([])
  })

  test.each([false, true])('an unpublished version returns before packing with full=%s', full => {
    const local = fixture({ full, registry: 'absent' })
    const result = local.run()
    expect(result.status).toBe(0)
    expect(result.calls).toEqual(['view agentic-mermaid@1.2.3 version --json'])
    expect(existsSync(join(local.root, 'dist'))).toBe(full)
  })

  test('an unreadable registry cannot masquerade as an unpublished version', () => {
    const result = fixture({ registry: 'unavailable' }).run()
    expect(result.status).not.toBe(0)
    expect(result.calls).toEqual(['view agentic-mermaid@1.2.3 version --json'])
  })

  test.each([false, true])('full mode retains the existing build and packing order when changed=%s', changed => {
    const local = fixture({ full: true })
    if (changed) writeFileSync(join(local.root, 'dist', 'index.js'), 'export const version = "changed"\n')
    const result = local.run()
    expect(result.status === 0).toBe(!changed)
    expect(result.calls[1]).toStartWith('pack --ignore-scripts --json ')
    expect(result.calls[2]).toStartWith('pack agentic-mermaid@1.2.3 --ignore-scripts --json ')
    expect(readFileSync(join(local.root, 'dist', 'index.js'), 'utf8')).toContain(changed ? 'changed' : '1.2.3')
    expect(result.temporary).toEqual([])
  })
})
