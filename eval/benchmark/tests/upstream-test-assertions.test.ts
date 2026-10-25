import { expect, test } from 'bun:test'
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { classifyPeleParseFailure, executeUpstreamSpecs, publicDatabaseView } from '../unified/upstream-test-assertions.mjs'
import { inventoryUpstreamTests } from '../unified/upstream-test-inventory.ts'
import { runUpstreamTestScoreSuite } from '../unified/upstream-test-score.ts'

const fixture = (text: string, family = 'mindmap') => [{ family, path: 'authored-upstream-control.spec.ts', text }]

test('original empty-tag assertion rejects the historical candidate-derived empty string', async () => {
  const path = join(import.meta.dir, '../../mermaid-upstream-suite-bench/upstream-f3dea583/gitGraph.spec.ts')
  const files = [{ family: 'gitgraph', path, text: readFileSync(path, 'utf8') }]
  const run = async (tags: string[]) =>
    executeUpstreamSpecs(files, async () => ({
      accepted: true,
      view: {
        getCommits: () =>
          new Map([
            ['ZERO', { branch: 'main', tags: [] }],
            ['A', { branch: 'develop', tags: [] }],
            ['picked', { branch: 'main', tags }],
          ]),
      },
    }))
  const row = (result: Awaited<ReturnType<typeof run>>) => result.callbacks.find((entry: { name: string }) => entry.name === 'should support cherry-picking commits with no tag')!
  const correct = row(await run([])),
    incorrect = row(await run(['']))
  expect(correct.status).toBe('passed')
  expect(correct.assertions[0]!.expected).toEqual([])
  expect(incorrect.status).toBe('failed')
  expect(incorrect.assertions[0]!.actual).toEqual([''])
})

test('a missing projection cannot satisfy an upstream expected-error assertion', async () => {
  const result = await executeUpstreamSpecs(fixture(String.raw`import { parser as mindmap } from './parser/mindmap.jison'; it('negative', () => { expect(() => mindmap.yy.missing()).toThrow(); });`), async () => ({ accepted: false, error: 'bad source' }))
  expect(result.callbacks[0]!.status).toBe('unavailable')
  expect(result.callbacks[0]!.targetRejections).toBe(0)
})

test('preparation failures remain unavailable even inside a broad expected rejection', async () => {
  const result = await executeUpstreamSpecs(fixture(String.raw`import { parser as mindmap } from './parser/mindmap.jison'; it('negative', () => { expect(() => mindmap.parse('mindmap\n bad')).toThrow(); });`), async () => {
    throw new TypeError('adapter is broken')
  })
  expect(result.callbacks[0]!.status).toBe('unavailable')
  expect(result.callbacks[0]!.targetRejections).toBe(0)
})

test('only observed target rejection can pass the original invalid-input assertion', async () => {
  const result = await executeUpstreamSpecs(fixture(String.raw`import { parser as mindmap } from './parser/mindmap.jison'; it('negative', () => { expect(() => mindmap.parse('mindmap\n bad')).toThrow('one root'); });`), async () => ({ accepted: false, error: 'There can be only one root' }))
  expect(result.callbacks[0]!.status).toBe('passed')
  expect(result.callbacks[0]!.targetRejections).toBe(1)
})

test('swallowing an unavailable private API in upstream code does not turn it into a pass', async () => {
  const result = await executeUpstreamSpecs(fixture(String.raw`import { parser as mindmap } from './parser/mindmap.jison'; it('catch', () => { try { mindmap.yy.getConfig(); } catch { expect(true).toBe(true); } });`), async () => ({ accepted: true }))
  expect(result.callbacks[0]!.assertions[0]!.passed).toBe(true)
  expect(result.callbacks[0]!.status).toBe('unavailable')
})

test('wrong native root text fails an unchanged original assertion', async () => {
  const files = fixture(String.raw`import { parser as mindmap } from './parser/mindmap.jison'; it('root', () => { mindmap.parse('mindmap\n root'); expect(mindmap.yy.getMindmap().descr).toEqual('root'); });`)
  const run = (label: string) => executeUpstreamSpecs(files, async () => ({ accepted: true, view: publicDatabaseView('agentic', { root: { id: 'root', label, shape: 'default', children: [] } }, 'mindmap') }))
  expect((await run('root')).callbacks[0]!.status).toBe('passed')
  expect((await run('wrong')).callbacks[0]!.status).toBe('failed')
})

test('case-local preparation binds each exact requested source and does not reuse across callbacks', async () => {
  const calls: string[] = []
  const files = fixture(
    String.raw`import { parser as mindmap } from './parser/mindmap.jison'; for (const name of ['one','two']) it(name, () => { mindmap.parse('mindmap\n A'); expect(mindmap.yy.getMindmap().descr).toBe('A'); mindmap.parse('mindmap\n B'); expect(mindmap.yy.getMindmap().descr).toBe('B'); mindmap.parse('mindmap\n A'); expect(mindmap.yy.getMindmap().descr).toBe('A'); });`,
  )
  const result = await executeUpstreamSpecs(files, async (source: string) => {
    calls.push(source)
    return { accepted: true, view: { getMindmap: () => ({ descr: source.endsWith('A') ? 'A' : 'B' }) } }
  })
  expect(result.callbacks.map((row: { status: string }) => row.status)).toEqual(['passed', 'passed'])
  expect(calls).toHaveLength(4)
  expect(result.callbacks.map((row: { requestedParseCalls?: number }) => row.requestedParseCalls)).toEqual([3, 3])
  expect(result.callbacks.map((row: { preparedParseCalls?: number }) => row.preparedParseCalls)).toEqual([2, 2])
})

test('original async rejection and branch controls distinguish wrong projections', async () => {
  const files = fixture(
    String.raw`import { parser } from './gitGraphParser.js'; import { db } from './gitGraphAst.js'; it('positive', async () => { await parser.parse('gitGraph\n commit'); expect(db.getCurrentBranch()).toBe('main'); }); it('negative', async () => { await expect(parser.parse('gitGraph\n checkout missing')).rejects.toThrow('missing'); });`,
    'gitgraph',
  )
  const result = await executeUpstreamSpecs(files, async (source: string) => (source.includes('missing') ? { accepted: false, error: 'branch missing' } : { accepted: true, view: { getCurrentBranch: () => 'wrong' } }))
  expect(result.callbacks.map((row: { status: string }) => row.status)).toEqual(['failed', 'passed'])
})

test('upstream census retains disabled/table/dynamic declarations without crediting describe or step helpers', () => {
  const root = mkdtempSync(join(tmpdir(), 'upstream-census-control-'))
  try {
    mkdirSync(join(root, 'packages/mermaid/src/docs/syntax'), { recursive: true })
    mkdirSync(join(root, 'packages/mermaid/src/diagrams/flowchart'), { recursive: true })
    mkdirSync(join(root, 'packages/parser/src'), { recursive: true })
    writeFileSync(
      join(root, 'packages/mermaid/src/diagrams/flowchart/source.spec.ts'),
      "test.describe('group', () => { test('public', () => parse('flowchart LR\\nA-->B')); test.skip('disabled', () => parse('flowchart LR\\nC-->D')); test.each([1,2])('table', () => parse('flowchart LR\\nE-->F')); test('dynamic', () => parse(`flowchart ${direction}`)); test.step('helper', () => {}); });",
    )
    writeFileSync(join(root, 'packages/parser/src/parser.test.ts'), "it('parser helper', () => {});")
    execFileSync('git', ['init', '--quiet', root])
    execFileSync('git', ['-C', root, 'add', '.'])
    const result = inventoryUpstreamTests(root)
    expect(result.counts.files).toBe(2)
    expect(result.counts.declarations).toBe(5)
    expect(result.counts.disabledOrTodoDeclarations).toBe(1)
    expect(result.counts.literalSources).toBe(3)
    expect(result.files.flatMap(file => file.declarations).map(row => row.name)).not.toContain('helper')
    expect(result.files.flatMap(file => file.declarations).map(row => row.name)).not.toContain('group')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('unsupported backends, resource limits and unknown errors cannot pass a negative syntax assertion', async () => {
  class PeerError extends Error {
    constructor(public code: string) {
      super('invalid source')
    }
  }
  const files = fixture(String.raw`import { parser as mindmap } from './parser/mindmap.jison'; it('negative', () => { expect(() => mindmap.parse('mindmap\n bad')).toThrow('invalid source'); });`)
  for (const code of ['unsupported-diagram', 'limit', 'unknown']) {
    const result = await executeUpstreamSpecs(files, async () => classifyPeleParseFailure(new PeerError(code), PeerError))
    expect(result.callbacks[0]!.status).toBe('unavailable')
    expect(result.callbacks[0]!.targetRejections).toBe(0)
  }
  for (const code of ['syntax', 'semantic']) {
    const result = await executeUpstreamSpecs(files, async () => classifyPeleParseFailure(new PeerError(code), PeerError))
    expect(result.callbacks[0]!.status).toBe('passed')
  }
  expect(classifyPeleParseFailure(new TypeError('invalid source'), PeerError).unavailable).toBeDefined()
})

test('direct benchmark invocation refuses CI before artifact or output preparation', async () => {
  const previous = process.env.CI
  process.env.CI = 'true'
  try {
    await expect(runUpstreamTestScoreSuite({ root: '/nonexistent', out: '/nonexistent', profile: 'full', rounds: 1 })).rejects.toThrow('Benchmarks are excluded from CI')
  } finally {
    if (previous === undefined) delete process.env.CI
    else process.env.CI = previous
  }
})

test('direct worker invocation refuses CI before reading even a missing job', () => {
  const result = spawnSync('node', [join(import.meta.dir, '../unified/upstream-test-worker.mjs'), '/nonexistent-upstream-job.json'], { env: { ...process.env, CI: 'true' }, encoding: 'utf8' })
  expect(result.status).not.toBe(0)
  expect(result.stderr).toContain('Benchmarks are excluded from CI')
  expect(result.stderr).not.toContain('ENOENT')
})
