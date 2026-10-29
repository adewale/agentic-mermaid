import { mkdirSync, readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs'
import { resolve, join, dirname } from 'node:path'
import { createRequire } from 'node:module'
import { spawnSync } from 'node:child_process'
import { upstreamSpecFiles } from './inventory.ts'
import { assertionReport, reportMarkdown } from './report.ts'

const root = resolve(import.meta.dirname, '../..')
const args = process.argv.slice(2)
const option = (name: string, fallback: string): string => {
  const index = args.indexOf(name)
  if (index < 0) return fallback
  if (!args[index + 1] || args[index + 1]!.startsWith('--')) throw new Error(`Missing value for ${name}`)
  return args[index + 1]!
}
const upstream = resolve(option('--upstream', join(root, '../mermaid')))
const reference = resolve(option('--reference', join(root, '../mermaid-reference')))
const out = resolve(option('--out', join(root, 'eval/mermaid-upstream-assertions/results')))
const policy = JSON.parse(readFileSync(join(root, 'docs/project/upstream-mermaid-policy.json'), 'utf8'))
const defaultFamilies = policy.families.filter((family: any) => family.headers.some((header: any) => header.agenticStatus === 'native')).map((family: any) => family.id).join(',')
const families = option('--families', defaultFamilies).split(',')
const revision = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: upstream, encoding: 'utf8' })
if (revision.status !== 0 || revision.stdout.trim() !== policy.pin.commit) throw new Error(`Upstream must be the pinned source ${policy.pin.commit}; run bun run reference:mermaid`)
const dirty = spawnSync('git', ['status', '--porcelain', '--untracked-files=no'], { cwd: upstream, encoding: 'utf8' })
if (dirty.status !== 0 || dirty.stdout.trim()) throw new Error('Upstream tracked source must be clean: original assertions must remain unchanged')
const referenceRequire = createRequire(join(reference, 'package.json'))
const versions: Record<string, string> = {}
for (const [name, expected] of [['mermaid', policy.pin.version], ['@mermaid-js/parser', JSON.parse(readFileSync(join(upstream, 'packages/parser/package.json'), 'utf8')).version], ['jsdom', '26.1.0']]) {
  const manifest = referenceRequire.resolve.paths(name)?.map(directory => join(directory, name, 'package.json')).find(existsSync)
  if (!manifest) throw new Error(`Missing independent reference dependency ${name}`)
  versions[name] = JSON.parse(readFileSync(manifest, 'utf8')).version
  if (versions[name] !== expected) throw new Error(`Expected ${name}@${expected}; found ${versions[name]}`)
}
mkdirSync(out, { recursive: true })
const specs = upstreamSpecFiles(upstream, families)
const require = createRequire(join(root, 'package.json'))
const cli = join(dirname(require.resolve('vitest/package.json')), 'vitest.mjs')
for (const mode of ['reference', 'candidate']) {
  console.error(`Running ${mode}: ${specs.length} original source files`)
  const audit = join(out, `${mode}-audit.jsonl`)
  writeFileSync(audit, '')
  const resultPath = join(out, `${mode}-vitest.json`)
  rmSync(resultPath, { force: true })
  const run = spawnSync('node', [cli, 'run', '--config', join(import.meta.dirname, 'vitest.config.ts')], {
    cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024,
    env: { ...process.env, AM_ASSERT_UPSTREAM: upstream, AM_ASSERT_REFERENCE: reference, AM_ASSERT_FAMILIES: families.join(','), AM_ASSERT_MODE: mode, AM_ASSERT_AUDIT: audit, AM_ASSERT_RESULTS: resultPath },
  })
  writeFileSync(join(out, `${mode}.log`), `${run.stdout ?? ''}${run.stderr ?? ''}`)
  if (run.error || run.signal || !existsSync(resultPath)) throw new Error(`${mode} did not produce a result; see ${join(out, `${mode}.log`)}: ${run.error ?? run.status}`)
  const collected = JSON.parse(readFileSync(resultPath, 'utf8'))
  if (!collected.numTotalTests) throw new Error(`${mode} collected no original tests; see ${join(out, `${mode}.log`)} and ${resultPath}`)
}
const report = assertionReport(upstream, specs, join(out, 'candidate-vitest.json'), join(out, 'reference-vitest.json'), join(out, 'candidate-audit.jsonl'), join(out, 'reference-audit.jsonl'))
const candidateHead = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).stdout.trim()
const candidateStatus = spawnSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' }).stdout
const result = { pin: policy.pin, versions, candidate: { baseCommit: candidateHead, workingTreeModified: Boolean(candidateStatus.trim()), nativeEntry: process.env.AM_ASSERT_NATIVE_ENTRY ?? 'working tree' }, nodeVersion: spawnSync('node', ['--version'], { encoding: 'utf8' }).stdout.trim(), generatedAt: new Date().toISOString(), ...report }
writeFileSync(join(out, 'report.json'), JSON.stringify(result, null, 2) + '\n')
writeFileSync(join(out, 'report.md'), reportMarkdown(report))
console.log(JSON.stringify({ report: join(out, 'report.json'), ...report.totals }, null, 2))
