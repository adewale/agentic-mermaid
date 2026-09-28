import { describe, expect, test } from 'bun:test'
import { normalizePackagePath, publishPackageProblems } from '../../scripts/ci/verify-publish-package.ts'

const packageJson = {
  exports: {
    '.': { types: './dist/index.d.ts', import: './dist/index.js' },
    './package.json': './package.json',
  },
  bin: { am: 'dist/am.js' },
}
const base = [
  'package.json', 'README.md', 'LICENSE', 'THIRD_PARTY_NOTICES.md',
  'LICENSES/Apache-2.0.txt', 'server.json', 'dist/index.d.ts',
  'dist/index.js', 'dist/am.js',
]

describe('publish package manifest', () => {
  test('accepts a complete public package', () => {
    expect(publishPackageProblems(packageJson, base, base)).toEqual([])
  })

  test('requires declared exports/bins and rejects private or source-map files', () => {
    const files = [
      ...base.filter(path => path !== 'dist/index.js' && path !== 'dist/am.js'),
      'dist/index.js.map',
      'skill-evals/private/probe.txt',
      'website/public/index.html',
    ]
    expect(publishPackageProblems(packageJson, files, base)).toEqual([
      'npm package has unexpected file: dist/index.js.map',
      'npm package has unexpected file: skill-evals/private/probe.txt',
      'npm package has unexpected file: website/public/index.html',
      'npm package is missing expected file: dist/am.js',
      'npm package is missing expected file: dist/index.js',
      'npm package is missing required file: dist/am.js',
      'npm package is missing required file: dist/index.js',
      'npm package leaked private evaluation material: skill-evals/private/probe.txt',
      'npm package leaked website-only material: website/public/index.html',
      'npm package must not ship source maps: dist/index.js.map',
    ])
  })

  test('fails closed on arbitrary files outside the reviewed manifest', () => {
    expect(publishPackageProblems(packageJson, [
      ...base,
      '.env',
      'src/internal.ts',
      'eval/private-secrets.json',
    ], base)).toEqual([
      'npm package has unexpected file: .env',
      'npm package has unexpected file: eval/private-secrets.json',
      'npm package has unexpected file: src/internal.ts',
    ])
  })

  test('content-hashed chunk renames pass, but adding or losing a chunk does not', () => {
    const expected = [...base, 'dist/chunk-[hash].js', 'dist/chunk-[hash].js', 'dist/index-[hash].d.ts']
    const renamed = [...base, 'dist/chunk-3PBMBDZH.js', 'dist/chunk-ZVH2XEHZ.js', 'dist/index-B26PImUM.d.ts']
    expect(publishPackageProblems(packageJson, renamed, expected)).toEqual([])
    expect(publishPackageProblems(packageJson, [...renamed, 'dist/chunk-QOFQZA7W.js'], expected))
      .toEqual(['npm package has unexpected file: dist/chunk-[hash].js (expected 2, found 3)'])
    expect(publishPackageProblems(packageJson, renamed.filter(path => path !== 'dist/chunk-ZVH2XEHZ.js'), expected))
      .toEqual(['npm package is missing expected file: dist/chunk-[hash].js (expected 2, found 1)'])
  })

  test('only hash-shaped suffixes are normalized', () => {
    expect(normalizePackagePath('dist/browser-lazy/chunks/render-core-WUVDAAI7.js')).toBe('dist/browser-lazy/chunks/render-core-[hash].js')
    expect(normalizePackagePath('dist/mcp-cli-TL7YE3YV.js')).toBe('dist/mcp-cli-[hash].js')
    expect(normalizePackagePath('dist/agent-core.js')).toBe('dist/agent-core.js')
    expect(normalizePackagePath('docs/examples-overview.md')).toBe('docs/examples-overview.md')
    expect(normalizePackagePath('dist/something-sequence.js')).toBe('dist/something-sequence.js')
  })
})
