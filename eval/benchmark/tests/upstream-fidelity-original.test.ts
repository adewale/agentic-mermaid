import { expect, test } from 'bun:test'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { captureUpstreamTransformDependencies, runUpstreamOriginalSuite, summarizeOriginalVitest } from '../unified/upstream-fidelity-original.ts'
import { runUpstreamFidelitySuite } from '../unified/upstream-fidelity.ts'
import { snapshotMermaidDatabase } from '../unified/upstream-fidelity-projection.mjs'

const census = { counts: { files: 2, declarations: 2, disabledOrTodoDeclarations: 0 }, scope: 'fixture', files: [{ path: 'packages/mermaid/src/diagrams/flowchart/flow.spec.ts', family: 'flowchart', declarations: [{ name: 'keeps an endpoint', line: 4, endLine: 6, modifiers: [] }] }, { path: 'e2e/rendering/flowchart.spec.ts', family: 'flowchart', declarations: [{ name: 'renders paint', line: 8, endLine: 9, modifiers: [] }] }] }

test('native Vitest callback accounting preserves module failures and never reports callbacks as assertion counts', () => {
  const report: any = { success: false, startTime: 1, numTotalTests: 2, numPassedTests: 1, numFailedTests: 1, numPendingTests: 0, numTodoTests: 0, numTotalTestSuites: 3, numPassedTestSuites: 1, numFailedTestSuites: 2, testResults: [
    { name: '/source/packages/mermaid/src/diagrams/flowchart/flow.spec.ts', status: 'failed', startTime: 1, endTime: 2, assertionResults: [{ title: 'keeps an endpoint', fullName: 'flow keeps an endpoint', status: 'passed', location: { line: 4, column: 1 }, failureMessages: [] }, { title: 'other', fullName: 'flow other', status: 'failed', location: { line: 7, column: 1 }, failureMessages: ['expected B, received C'] }] },
    { name: '/source/packages/mermaid/src/diagrams/class/class.spec.ts', status: 'failed', startTime: 1, endTime: 2, message: 'Failed to resolve import "genuine-required-package"', assertionResults: [] },
  ] }
  const result = summarizeOriginalVitest(report, '/source', census)
  expect(result.rawOriginalCounts).toMatchObject({ totalCallbacks: 2, passedCallbacks: 1, failedCallbacks: 1 })
  expect(result.actualAssertionCount).toBeNull()
  expect(result.unavailableFiles).toBe(1)
  expect(result.declarations.map(row => row.status)).toEqual(['passed', 'outside-core-project-discovery'])
  expect(() => summarizeOriginalVitest({ ...report, numPassedTests: 2 }, '/source', census)).toThrow('counts differ')
})

test('snapshotting a public Mermaid DB keeps earlier prepared source independent of singleton resets', () => {
  let vertices = new Map([['A', { text: 'Alpha' }]])
  const db = { getVertices() { return vertices }, getClass(_id: string) { throw Error('not a zero-argument observation') }, addVertex() { throw Error('private mutation must not be called') } }
  const first = snapshotMermaidDatabase(db)
  vertices = new Map([['B', { text: 'Beta' }]])
  const second = snapshotMermaidDatabase(db)
  expect([...first.getVertices!().keys()]).toEqual(['A'])
  expect([...second.getVertices!().keys()]).toEqual(['B'])
  first.getVertices!().get('A').text = 'changed consumer copy'
  expect(first.getVertices!().get('A').text).toBe('Alpha')
  expect(first.addVertex).toBeUndefined()
})

test('source transform admission binds an ESM-only installed package without requiring a CommonJS export', () => {
  const directory = mkdtempSync(join(tmpdir(), 'upstream-esm-runtime-'))
  try {
    const pkg = join(directory, 'node_modules/esm-only'); mkdirSync(pkg, { recursive: true })
    writeFileSync(join(directory, 'package.json'), '{"name":"upstream"}')
    writeFileSync(join(pkg, 'package.json'), JSON.stringify({ name: 'esm-only', version: '1.0.0', type: 'module', exports: { '.': { import: './index.js' } } }))
    writeFileSync(join(pkg, 'index.js'), 'export const meaning=1\n')
    const first = captureUpstreamTransformDependencies(directory, ['esm-only'])
    expect(first[0]?.files.files.some(file => file.path === 'index.js')).toBe(true)
    writeFileSync(join(pkg, 'index.js'), 'export const meaning=2\n')
    expect(captureUpstreamTransformDependencies(directory, ['esm-only'])).not.toEqual(first)
    expect(() => captureUpstreamTransformDependencies(directory, ['missing-runtime'])).toThrow('Cannot locate installed')
  } finally { rmSync(directory, { recursive: true, force: true }) }
})

test('selecting only a peer never prepares or executes the unrelated Mermaid original runner', async () => {
  const nonexistent = join(tmpdir(), 'upstream-not-selected-' + crypto.randomUUID())
  const result = await runUpstreamOriginalSuite({ root: nonexistent, out: join(nonexistent, 'out'), mermaidDir: join(nonexistent, 'source'), referenceDir: join(nonexistent, 'reference'), nodeExecutable: join(nonexistent, 'must-not-execute'), upstreamRunnerRoot: join(nonexistent, 'runtime'), profile: 'full', rounds: 1, communityProjects: ['obsidianmd/pele'] })
  expect(result.status).toBe('not-applicable')
  expect(result.observations).toEqual([])
  expect(existsSync(nonexistent)).toBe(false)
})


test('selecting a community-only peer skips original public projection before source, runtime and output admission', async () => {
  const nonexistent = join(tmpdir(), 'upstream-public-not-selected-' + crypto.randomUUID())
  const result = await runUpstreamFidelitySuite({ root: nonexistent, out: join(nonexistent, 'out'), mermaidDir: join(nonexistent, 'source'), referenceDir: join(nonexistent, 'reference'), nodeExecutable: join(nonexistent, 'must-not-execute'), profile: 'full', rounds: 1, communityProjects: ['marco-orru/mermaid-ascii'] })
  expect(result.status).toBe('not-applicable')
  expect(result.observations).toEqual([])
  expect(existsSync(nonexistent)).toBe(false)
})
