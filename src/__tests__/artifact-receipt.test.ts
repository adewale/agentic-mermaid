import { describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { fileReceiptEntries, hashFileTree, runtimeDependencyClosure, sourceDependencyGraph, sortRepositoryPaths, transitiveLocalInputs } from '../../scripts/pr-assets/artifact-receipt.ts'

const REPO = join(import.meta.dir, '..', '..')

describe('generated-artifact receipt kernel', () => {
  test('orders by normalized repository path rather than caller or locale order', () => {
    const root = '/repo'
    expect(sortRepositoryPaths(root, ['/repo/z.ts', '/repo/a/b.ts', '/repo/A.ts']))
      .toEqual(['/repo/A.ts', '/repo/a/b.ts', '/repo/z.ts'])
  })

  test('a one-byte input change invalidates both entry and tree hashes', () => {
    const root = mkdtempSync(join(tmpdir(), 'am-receipt-'))
    const file = join(root, 'input.txt')
    writeFileSync(file, 'one')
    const beforeEntry = fileReceiptEntries(root, [file])
    const beforeTree = hashFileTree(root, [file])
    writeFileSync(file, 'two')
    expect(fileReceiptEntries(root, [file])).not.toEqual(beforeEntry)
    expect(hashFileTree(root, [file])).not.toBe(beforeTree)
  })

  test('walks the exact local import graph without enrolling unrelated source files', () => {
    const root = mkdtempSync(join(tmpdir(), 'am-receipt-graph-'))
    mkdirSync(join(root, 'src'))
    writeFileSync(join(root, 'entry.ts'), `import { value } from './src/a.ts'\nexport default value\n`)
    writeFileSync(join(root, 'src', 'a.ts'), `export { value } from './b.js'\n`)
    writeFileSync(join(root, 'src', 'b.ts'), `export const value = 1\n`)
    writeFileSync(join(root, 'src', 'unrelated.test.ts'), `throw new Error('must not enroll')\n`)

    expect(transitiveLocalInputs(root, [join(root, 'entry.ts')]).map(path => path.slice(root.length + 1)))
      .toEqual(['entry.ts', 'src/a.ts', 'src/b.ts'])
  })

  test('captures external package roots while ignoring built-ins', () => {
    const root = mkdtempSync(join(tmpdir(), 'am-receipt-packages-'))
    writeFileSync(join(root, 'entry.ts'), `import 'node:fs'\nimport '@scope/runtime/subpath'\nimport './local.ts'\n`)
    writeFileSync(join(root, 'local.ts'), `import 'plain-runtime/feature'\n`)
    expect(sourceDependencyGraph(root, [join(root, 'entry.ts')]).externalPackages)
      .toEqual(['@scope/runtime', 'plain-runtime'])
  })

  test('hashes only the imported package closure, not unrelated tooling', () => {
    const root = mkdtempSync(join(tmpdir(), 'am-receipt-lock-'))
    writeFileSync(join(root, 'entry.ts'), `import 'runtime/feature'\n`)
    const lock = {
      lockfileVersion: 1,
      workspaces: {
        '': {
          dependencies: { runtime: '^1.0.0', unused: '1.0.0' },
          devDependencies: { formatter: '1.0.0' },
        },
      },
      packages: {
        runtime: ['runtime@1.2.0', '', { dependencies: { transitive: '^2.0.0' } }, 'sha-runtime'],
        transitive: ['transitive@2.1.0', '', {}, 'sha-transitive'],
        unused: ['unused@1.0.0', '', {}, 'sha-unused'],
        formatter: ['formatter@1.0.0', '', {}, 'sha-formatter'],
      },
    }
    writeFileSync(join(root, 'bun.lock'), `${JSON.stringify(lock, null, 2)}\n`)
    const before = runtimeDependencyClosure(root, [join(root, 'entry.ts')])
    expect(before.roots).toEqual(['runtime'])
    expect(before.packages.map(entry => entry.key)).toEqual(['runtime', 'transitive'])

    lock.workspaces[''].devDependencies.formatter = '2.0.0'
    lock.packages.formatter = ['formatter@2.0.0', '', {}, 'sha-formatter-2']
    writeFileSync(join(root, 'bun.lock'), `${JSON.stringify(lock, null, 2)}\n`)
    expect(runtimeDependencyClosure(root, [join(root, 'entry.ts')]).sha256).toBe(before.sha256)

    lock.packages.transitive = ['transitive@2.1.0', '', {}, 'sha-transitive-changed']
    writeFileSync(join(root, 'bun.lock'), `${JSON.stringify(lock, null, 2)}\n`)
    expect(runtimeDependencyClosure(root, [join(root, 'entry.ts')]).sha256).not.toBe(before.sha256)
  })

  test('fails closed on unresolved or escaping local imports', () => {
    const root = mkdtempSync(join(tmpdir(), 'am-receipt-invalid-'))
    writeFileSync(join(root, 'missing.ts'), `import './nope.ts'\n`)
    expect(() => transitiveLocalInputs(root, [join(root, 'missing.ts')])).toThrow(/Cannot resolve local artifact dependency/)
    expect(() => transitiveLocalInputs(root, [join(root, '..', 'outside.ts')])).toThrow(/escapes repository root/)
  })

  test('visual receipt graphs include production dependencies but exclude unrelated tests', () => {
    const generators: Record<string, string[]> = {
      'pie-highlightslice-evidence.ts': [],
      'mermaid-doc-showcase-gallery.ts': [],
      'mindmap-gitgraph-content-gallery.ts': [],
      'section-b-brand-evidence.ts': [],
      'palette-rollout-evidence.ts': [],
      'palette-harmony-experiment.ts': [],
      'linkrank-feedback-packing-evidence.ts': [
        'src/parser.ts',
        'src/layout-engine.ts',
        'src/index.ts',
      ],
    }
    for (const [generator, dynamicRoots] of Object.entries(generators)) {
      const inputs = transitiveLocalInputs(REPO, [
        join(REPO, 'scripts', 'pr-assets', generator),
        ...dynamicRoots.map(path => join(REPO, path)),
      ]).map(path => path.slice(REPO.length + 1).replaceAll('\\', '/'))
      expect(inputs.some(path => path.startsWith('src/') && !path.startsWith('src/__tests__/')), generator).toBe(true)
      expect(inputs.filter(path => path.startsWith('src/__tests__/')), generator).toEqual([])
      expect(inputs).toContain(`scripts/pr-assets/${generator}`)
      expect(inputs).toContain('scripts/pr-assets/artifact-receipt.ts')
    }
  })
})
