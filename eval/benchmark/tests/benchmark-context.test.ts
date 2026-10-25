import { expect, test } from 'bun:test'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { benchmarkContext } from '../unified/benchmark-context.ts'

test('private transport dependency byte changes invalidate context without a package-version change', () => {
  const root = mkdtempSync(join(tmpdir(), 'benchmark-sdk-context-'))
  try {
    const manifest = join(root, 'eval/benchmark/package.json')
    const modules = join(dirname(manifest), 'node_modules')
    const sdk = join(modules, '@modelcontextprotocol/sdk')
    mkdirSync(join(sdk, 'client'), { recursive: true })
    writeFileSync(manifest, JSON.stringify({ name: 'private-benchmark-fixture', version: '1.0.0', devDependencies: { '@modelcontextprotocol/sdk': '1.32.1' } }))
    writeFileSync(join(sdk, 'package.json'), JSON.stringify({ name: '@modelcontextprotocol/sdk', version: '1.32.1', exports: { './client/index.js': './client/index.js' } }))
    const entry = join(sdk, 'client/index.js')
    writeFileSync(entry, 'export const transport="first artifact"\n')
    const require = createRequire(import.meta.url)
    symlinkSync(dirname(require.resolve('typescript/package.json')), join(modules, 'typescript'), 'dir')
    writeFileSync(join(root, 'entry.ts'), 'export const protocol="fixture"\n')
    const git = (...args: string[]) => execFileSync('git', args, { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] })
    git('init', '-q')
    git('add', 'entry.ts')
    git('-c', 'user.name=Benchmark fixture', '-c', 'user.email=benchmark@example.invalid', '-c', 'commit.gpgsign=false', 'commit', '-qm', 'Fixture producer')
    const node = execFileSync('node', ['-p', 'process.execPath'], { encoding: 'utf8' }).trim()
    const before = benchmarkContext(root, node, ['entry.ts'], ['@modelcontextprotocol/sdk/client/index.js'])
    writeFileSync(entry, 'export const transport="changed artifact, same version"\n')
    const after = benchmarkContext(root, node, ['entry.ts'], ['@modelcontextprotocol/sdk/client/index.js'])
    expect(before.dependencies).toEqual(after.dependencies)
    expect(before.producers).toEqual(after.producers)
    expect(before.optionalTools[0]!.entry).toBe(entry)
    expect(before.optionalTools).not.toEqual(after.optionalTools)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
