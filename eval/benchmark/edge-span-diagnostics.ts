// Source diagnostics only. Never use these instrumented time/heap observations
// as packaged benchmark results or allocated-byte/instantaneous-peak evidence.
import { assertBenchmarkExecutionAllowed } from './ci-policy.ts'
import { createHash } from 'node:crypto'
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { releaseBenchCases } from './release-bench-cases.ts'
import { instrumentExpansionSource, instrumentedModules, type SourceTransform } from './edge-span-diagnostics-transform.ts'
import { summarizeExpansionTrace, type Trace } from './edge-span-diagnostics-collector.ts'
import type { MeasuredGraph } from '../../src/layout/agentic-layered-core.ts'

const root = resolve(import.meta.dir, '../..')
const sha = (value: string | Uint8Array) => createHash('sha256').update(value).digest('hex')
interface Input { id: string; family: string; mode: 'public' | 'raw'; source?: string; input?: MeasuredGraph }
export function diagnosticInputs(): Input[] {
  const bad = new Set(['11', '15', '19', '9', '13', '18-cuts'].map(n => `flowchart:cyclic-labelled-${n}`))
  const workloads = releaseBenchCases().filter(input => bad.has(input.id) || input.family === 'architecture')
    .map(input => ({ id: input.id, family: input.family, source: input.source, mode: 'public' as const }))
  if (workloads.filter(input => bad.has(input.id)).length !== 6) throw new Error('Missing mandatory cyclic diagnostic input')
  const corpus = JSON.parse(readFileSync(join(root, 'eval/mermaid-docs-corpus/corpus.json'), 'utf8')) as { family: string; source: string; index: number }[]
  const architecture = corpus.filter(row => row.family === 'architecture').map(row => ({ id: `corpus/architecture/${row.index}`, family: row.family, source: row.source, mode: 'public' as const }))
  const fixtures = join(root, 'eval/layout-compare/fixtures')
  const targeted = readdirSync(fixtures).filter(name => /^architecture.*\.mmd$/.test(name)).sort().map(name =>
    ({ id: `fixture/${name}`, family: 'architecture', source: readFileSync(join(fixtures, name), 'utf8'), mode: 'public' as const }))
  const raw = (count: number, labelled: boolean, minSpan = 1): MeasuredGraph => ({
    nodes: Array.from({ length: count }, (_, i) => ({ id: `n${i}`, width: 40, height: 24 })),
    edges: [...Array.from({ length: count - 1 }, (_, i) => ({ source: i, target: i + 1, minSpan: 1 })),
      { source: 0, target: count - 1, minSpan, ...(labelled ? { label: { width: 60, height: 20 } } : {}) }],
    direction: 'TB', padding: 12, nodeSpacing: 12, layerSpacing: 24,
  })
  const calibration: Input[] = [
    { id: 'calibration/long-edge', family: 'flowchart', mode: 'raw', input: raw(6, false) },
    { id: 'calibration/labelled-long-edge', family: 'flowchart', mode: 'raw', input: raw(6, true) },
    { id: 'calibration/compact-long-edge', family: 'flowchart', mode: 'raw', input: { ...raw(6, false), compactPrivateRanks: true } },
    { id: 'calibration/compact-labelled', family: 'flowchart', mode: 'raw', input: { ...raw(6, true), compactPrivateRanks: true } },
    { id: 'calibration/loop', family: 'flowchart', mode: 'raw', input: { ...raw(3, false), edges: [{ source: 0, target: 0, minSpan: 1, label: { width: 30, height: 10 } }] } },
    { id: 'calibration/invalid-endpoint', family: 'flowchart', mode: 'raw', input: { ...raw(2, false), edges: [{ source: 0, target: 99, minSpan: 1 }] } },
    { id: 'calibration/rank-limit', family: 'flowchart', mode: 'raw', input: raw(3, true, 4096) },
    ...[8, 64, 256].flatMap(span => [false, true].map(labelled => ({ id: `stress/nodes-16/label-${labelled}/span-${span}`, family: 'flowchart', mode: 'raw' as const, input: raw(16, labelled, span) }))),
    ...[false, true].map(compact => ({ id: `stress/all-labels/compact-${compact}`, family: 'flowchart', mode: 'raw' as const, input: { ...raw(32, true, 64), compactPrivateRanks: compact, edges: raw(32, true, 64).edges.map(edge => ({...edge, label: {width:60,height:20}})) } })),
    ...[16, 64, 128].flatMap(count => [false, true].map(labelled => ({ id: `stress/nodes-${count}/label-${labelled}/span-16`, family: 'flowchart', mode: 'raw' as const, input: raw(count, labelled, 16) }))),
  ]
  return [...calibration, ...workloads, ...architecture, ...targeted]
}
interface Run { outcome: { ok: boolean; value?: unknown; error?: unknown }; trace: Trace }
interface DiagnosticModule { run(input: Input): Run }
export async function runDiagnostics(out: string): Promise<void> {
  mkdirSync(out, { recursive: true })
  if (readdirSync(out).length) throw new Error('Diagnostic output directory must be empty')
  process.env.AGENTIC_MERMAID_ELK_CACHE = '0'
  const transforms: SourceTransform[] = []
  const collector = join(import.meta.dir, 'edge-span-diagnostics-collector.ts')
  const entry = `import { renderMermaidSVGWithReceipt } from ${JSON.stringify(join(root, 'src/svg.ts'))};
import { layoutLayeredGraph } from ${JSON.stringify(join(root, 'src/layout/agentic-layered-core.ts'))};
import { withExpansionTrace } from ${JSON.stringify(collector)};
export function run(input) { return withExpansionTrace({id:input.id, family:input.family}, () => { try {
const value = input.mode === 'raw' ? layoutLayeredGraph(input.input, () => undefined, reason => { throw new Error(reason) }) : renderMermaidSVGWithReceipt(input.source, {idPrefix:'span-', graphLayout:{backend:'agentic', fallback:'none'}});
return {ok:true, value}; } catch(error) {return {ok:false,error:{name:error?.name,code:error?.code,message:String(error)}}} }); }
`
  // Keep the scope wrapper shared in both arms; it is empty without transforms.
  const wrapper = entry.replace('return withExpansionTrace(', 'const result = withExpansionTrace(').replace('}); }\n', '}); return {outcome:result.value,trace:result.trace}; }\n')
  for (const instrumented of [false, true]) {
    const build = await Bun.build({ entrypoints: ['span-diagnostic'], target: 'bun', format: 'esm', minify: false,
      plugins: [{ name: 'edge-span-diagnostics', setup(builder) {
        builder.onResolve({ filter: /^span-diagnostic$/ }, () => ({ path: 'entry.ts', namespace: 'span' }))
        builder.onResolve({ filter: /^#elk-constructor$/ }, () => ({ path: join(root, 'src/elk-constructor.node.js') }))
        builder.onLoad({ filter: /.*/, namespace: 'span' }, () => ({ contents: wrapper, loader: 'ts' }))
        if (instrumented) builder.onLoad({ filter: /(?:agentic-layered-core|cycle-layout-search|agentic-compound-core|agentic-producer-core)\.ts$/ }, args => {
          const record = instrumentExpansionSource(args.path, readFileSync(args.path, 'utf8'), collector)
          transforms.push(record); return { contents: record.after, loader: 'ts' }
        })
      } }] })
    if (!build.success) throw new AggregateError(build.logs, 'Diagnostic source build failed')
    writeFileSync(join(out, instrumented ? 'instrumented.mjs' : 'plain.mjs'), await build.outputs[0]!.text())
  }
  if (new Set(transforms.map(t => basename(t.path))).size !== instrumentedModules.length) throw new Error('Instrumentation module coverage mismatch')
  const patchDir = join(out, 'source-patches'); mkdirSync(patchDir)
  for (const record of transforms) {
    const name = basename(record.path), before = join(patchDir, name + '.before'), after = join(patchDir, name + '.after')
    writeFileSync(before, record.before); writeFileSync(after, record.after)
    const diff = spawnSync('diff', ['-u', before, after], { encoding: 'utf8' })
    if (diff.status !== 1) throw new Error(`Expected nonempty diagnostic patch for ${name}`)
    writeFileSync(join(patchDir, name + '.patch'), diff.stdout)
  }
  const plain = await import(pathToFileURL(join(out, 'plain.mjs')).href) as DiagnosticModule
  const instrumented = await import(pathToFileURL(join(out, 'instrumented.mjs')).href) as DiagnosticModule
  const inputs = diagnosticInputs()
  writeFileSync(join(out, 'inputs.json'), JSON.stringify(inputs, null, 2) + '\n')
  const observations = []
  const expectedPrivate: Record<string, number> = { 'calibration/long-edge': 14, 'calibration/labelled-long-edge': 14, 'calibration/compact-long-edge': 4, 'calibration/compact-labelled': 4, 'calibration/loop': 2 }
  for (const input of inputs) {
    const baseline = plain.run(input), observed = instrumented.run(input)
    const baselineHash = sha(JSON.stringify(baseline.outcome)), observedHash = sha(JSON.stringify(observed.outcome))
    const issues: string[] = []
    if (baselineHash !== observedHash) issues.push('instrumentation changed outcome')
    for (const frame of observed.trace.frames) {
      if (!frame.ended) issues.push(`unclosed frame ${frame.id}`)
      const expansion = frame.phases.find(p => p.name === 'normalization')?.data as { privateVertices: number; expectedExpanded: number; predictedExpanded: number; expandedArcs: number } | undefined
      const normalized = frame.events.find(e => e.name === 'normalized')?.data as { actualPrivate: number; actualExpanded: number; actualExpandedArcs: number; labelVertices: number; nonLabelPrivate: number } | undefined
      if (expansion && normalized && (expansion.privateVertices !== normalized.actualPrivate || expansion.expectedExpanded !== normalized.actualExpanded || expansion.predictedExpanded !== normalized.actualExpanded || expansion.expandedArcs !== normalized.actualExpandedArcs || normalized.labelVertices + normalized.nonLabelPrivate !== normalized.actualPrivate)) issues.push(`normalization algebra mismatch ${frame.id}`)
    }
    const summary = summarizeExpansionTrace(observed.trace)
    if (expectedPrivate[input.id] !== undefined && summary.physicalPrivateVertices !== expectedPrivate[input.id]) issues.push('calibration private-vertex count changed')
    if (input.id === 'calibration/rank-limit' && observed.outcome.ok) issues.push('rank-limit calibration did not decline')
    const row = { id: input.id, family: input.family, mode: input.mode,
      inputSha256: sha(input.source ?? JSON.stringify(input.input)), baselineHash, observedHash,
      ok: observed.outcome.ok, error: observed.outcome.error, issues, summary, trace: observed.trace }
    observations.push(row)
    writeFileSync(join(out, input.id.replace(/[^a-zA-Z0-9_-]/g, '_') + '.json'), JSON.stringify(row, null, 2) + '\n')
    console.log(JSON.stringify({ id: row.id, ok: row.ok, frames: row.trace.frames.length, issues }))
  }
  const report = { protocol: 'edge-span-source-diagnostics@1', advisory: true,
    limitations: 'Evaluator-only source transform. Time and heap snapshots include instrumentation and concurrent build contention; no latency, allocated-byte or instantaneous peak claim. Failed inputs remain enrolled.',
    revision: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
    dirty: execFileSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' }).trim(),
    harness: ['edge-span-diagnostics.ts', 'edge-span-diagnostics-transform.ts', 'edge-span-diagnostics-collector.ts', 'tests/edge-span-diagnostics.test.ts'].map(file => ({ file, sha256: sha(readFileSync(join(import.meta.dir, file))) })),
    bundles: ['plain.mjs', 'instrumented.mjs'].map(file => ({ file, sha256: sha(readFileSync(join(out, file))) })),
    sourceTransforms: transforms.map(({ before: _before, after: _after, ...record }) => ({ ...record, patchSha256: sha(readFileSync(join(patchDir, basename(record.path) + '.patch'))) })),
    inputs: inputs.map(input => ({ id: input.id, family: input.family, mode: input.mode, sha256: sha(input.source ?? JSON.stringify(input.input)) })),
    observations, issues: observations.flatMap(row => row.issues.map(issue => ({ id: row.id, issue }))) }
  writeFileSync(join(out, 'report.json'), JSON.stringify(report, null, 2) + '\n')
  if (report.issues.length) throw new Error('Diagnostic characterization failed; see retained report')
}
if (import.meta.main) {
  assertBenchmarkExecutionAllowed()
  await runDiagnostics(resolve(process.argv[2] ?? '/tmp/edge-span-diagnostics'))
}
