import { beforeAll, expect, test } from 'bun:test'
import { spawnSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { useTempDirs } from './helpers/temp-dir.ts'

const temp = useTempDirs('am-peer-benchmark-')
const worker = join(temp.dir(), 'worker.mjs')
beforeAll(async () => {
  const built = await Bun.build({ entrypoints: [resolve('eval/benchmark/peer-bench.ts')], target: 'node', format: 'esm' })
  expect(built.success).toBe(true)
  writeFileSync(worker, await built.outputs[0]!.text())
})

function sample(module: string, expected = ['retained']) {
  const root = temp.dir(), entry = join(root, 'peer.mjs'), job = join(root, 'job.json'), out = join(root, 'out.jsonl'), svgDirectory = join(root, 'svg')
  writeFileSync(entry, module)
  writeFileSync(job, JSON.stringify({
    peer: 'agentic-native', output: 'svg', entry, svgDirectory,
    timing: { warmCalls: 2, warmupMs: 0, samples: 3, minSampleMs: 0, maxCaseMs: 1000 },
    workloads: [{ id: 'witness', source: 'flowchart LR\n A --> B', expected, svgLabelPrefixes: expected.includes('Requirement 1') ? ['Text: '] : [] }],
  }))
  const run = spawnSync('node', ['--expose-gc', worker, '--child', '--job', job, '--out', out], { encoding: 'utf8', timeout: 10_000 })
  expect(run.status, run.stderr).toBe(0)
  const lines = readFileSync(out, 'utf8').trim().split('\n').map(line => JSON.parse(line))
  return { result: lines.find(line => line.type === 'result'), svgDirectory }
}

test('sampling uses strict native, validates changing output and retains its first SVG', () => {
  const { result, svgDirectory } = sample(`
    let calls = 0;
    export function renderMermaidSVG(source, options) {
      if (options.graphLayout.backend !== 'agentic' || options.graphLayout.fallback !== 'none') throw Error('wrong backend');
      return '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><text>retained</text><desc>' + (++calls) + '</desc></svg>';
    }
  `)
  expect(result.status).toBe('ok')
  expect(result.warmCalls).toBeGreaterThanOrEqual(2)
  expect(result.samplesMs).toHaveLength(3)
  const first = readFileSync(join(svgDirectory, 'witness.svg'), 'utf8')
  expect(first).toContain('<desc>1</desc>')
})

test('a fast invalid result after a valid first render cannot become a timing success', () => {
  const { result } = sample(`
    let calls = 0;
    export function renderMermaidSVG() { return ++calls === 1 ? '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><text>retained</text></svg>' : undefined; }
  `)
  expect(result.status).toBe('error')
  expect(result.detail).toContain('returned no SVG string')
  expect(result.medianMs).toBeUndefined()
})

test('lost labels remain enrolled and captured without a successful timing', () => {
  const { result, svgDirectory } = sample(`export function renderMermaidSVG() { return '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><text>wrong label</text></svg>'; }`)
  expect(result.status).toBe('lost-labels')
  expect(result.missing).toBe(1)
  expect(result.medianMs).toBeUndefined()
  expect(readFileSync(join(svgDirectory, 'witness.svg'), 'utf8')).toContain('wrong label')
})

test('changing SVG cannot lose required labels after its first successful call', () => {
  const { result } = sample(`
    let calls = 0;
    export function renderMermaidSVG() { return ++calls === 1 ? '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><text>retained</text></svg>' : '<svg/>'; }
  `)
  expect(result.status).toBe('lost-labels')
  expect(result.missing).toBe(1)
  expect(result.medianMs).toBeUndefined()
})

test.each([
  ['<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><text>Text: Requirement 1</text></svg>', 'ok'],
  ['<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><foreignObject><p>Text: Requirement 1</p></foreignObject></svg>', 'ok'],
  ['<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><text>Text: Requirement 10</text></svg>', 'lost-labels'],
  ['<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><desc>Requirement 1</desc><text>Requirement 10</text></svg>', 'lost-labels'],
])('visible field phrase gate handles %s', (svg, status) => {
  const { result } = sample(`export function renderMermaidSVG() { return ${JSON.stringify(svg)}; }`, ['Requirement 1'])
  expect(result.status).toBe(status)
})
