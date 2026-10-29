import { expect, test } from 'bun:test'
import { execFileSync, spawnSync } from 'node:child_process'
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

test('revision extraction keeps baseline source and current runnable inputs inside scratch, leaving the shared library untouched', () => {
  const directory = mkdtempSync(join(tmpdir(), 'revision-tree-owner-'))
  const product = join(directory, 'product'), library = join(directory, 'library'), scratch = join(directory, 'scratch')
  const put = (path: string, text: string) => { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, text) }
  try {
    const shared = dirname(fileURLToPath(import.meta.resolve('trident/unified/harness-paths.ts')))
    for (const name of ['harness-paths.ts', 'trident-paths.ts']) {
      mkdirSync(join(library, 'unified'), { recursive: true })
      copyFileSync(join(shared, name), join(library, 'unified', name))
    }
    put(join(library, 'package.json'), '{"name":"trident","type":"module"}')
    put(join(library, 'node_modules/owner.txt'), 'shared dependencies remain owned by the library')
    mkdirSync(join(product, 'node_modules'), { recursive: true })
    symlinkSync(library, join(product, 'node_modules/trident'), 'dir')
    const benchmark = join(product, 'eval/benchmark')
    mkdirSync(benchmark, { recursive: true })
    copyFileSync(fileURLToPath(new URL('../revision-tree.ts', import.meta.url)), join(benchmark, 'revision-tree.ts'))
    symlinkSync(join(library, 'node_modules'), join(benchmark, 'node_modules'), 'dir')
    put(join(benchmark, 'endpoint-marker-compare.ts'), 'export const privateProductRunner = true')
    put(join(benchmark, 'optional.ts'), "export const load = () => import('../../src/current-only.ts')")
    put(join(benchmark, 'consumer.ts'), "import { value } from '../../src/value.ts'; import { input } from '../shared/input.ts'; export const observed = [value, input]")
    put(join(product, 'eval/shared/input.ts'), "export const input = 'current frozen input'")
    put(join(product, 'docs/project/policy.json'), '{"reference":"current protocol"}')
    put(join(product, 'src/value.ts'), "export const value = 'baseline production'")
    put(join(product, 'assets/fonts/fixture.txt'), 'baseline font bytes')
    put(join(product, 'tsconfig.json'), '{}')
    const git = (...args: string[]) => execFileSync('git', args, { cwd: product, encoding: 'utf8' }).trim()
    git('init', '-q'); git('add', 'src', 'assets', 'tsconfig.json')
    git('-c', 'user.name=Benchmark fixture', '-c', 'user.email=benchmark@example.invalid', '-c', 'commit.gpgsign=false', 'commit', '-qm', 'Immutable baseline')
    const baseline = git('rev-parse', 'HEAD')
    put(join(product, 'src/value.ts'), "export const value = 'candidate production'")
    put(join(product, 'src/current-only.ts'), 'export const current = true')
    put(join(product, 'assets/fonts/fixture.txt'), 'candidate font bytes')
    const runner = join(product, 'run.ts')
    put(runner, `import { extractRevisionTree } from './eval/benchmark/revision-tree.ts';
import { readFileSync, existsSync } from 'node:fs'; import { join } from 'node:path'; import { pathToFileURL } from 'node:url';
const result=extractRevisionTree(${JSON.stringify(baseline)},${JSON.stringify(scratch)},'baseline','eval/benchmark/optional.ts');
const consumer=await import(pathToFileURL(join(result.root,'eval/benchmark/consumer.ts')).href);
let missing=''; try { await import(pathToFileURL(join(result.root,'src/current-only.ts')).href) } catch(error) { missing=String(error) }
console.log(JSON.stringify({ ...result, observed:consumer.observed, policy:JSON.parse(readFileSync(join(result.root,'docs/project/policy.json'),'utf8')), font:readFileSync(join(result.root,'assets/fonts/fixture.txt'),'utf8'), missing, leaked:existsSync(${JSON.stringify(join(library, 'endpoint-marker-compare.ts'))}) }));`)
    const child = spawnSync(process.execPath, [runner], { cwd: product, encoding: 'utf8', timeout: 20_000 })
    expect(child.stderr).toBe('')
    expect(child.status).toBe(0)
    const result = JSON.parse(child.stdout)
    expect(result.root).toBe(join(scratch, 'baseline'))
    expect(result.revision).toBe(baseline)
    expect(result.observed).toEqual(['baseline production', 'current frozen input'])
    expect(result.policy).toEqual({ reference: 'current protocol' })
    expect(result.font).toBe('baseline font bytes')
    expect(result.missing).toContain('is not present at ' + baseline.slice(0, 12))
    expect(result.leaked).toBe(false)
    expect(readFileSync(join(library, 'node_modules/owner.txt'), 'utf8')).toBe('shared dependencies remain owned by the library')
  } finally { rmSync(directory, { recursive: true, force: true }) }
})
