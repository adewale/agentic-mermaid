import { describe, expect, test } from 'bun:test'
import { publishPackageProblems } from '../../scripts/ci/verify-publish-package.ts'

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
})
