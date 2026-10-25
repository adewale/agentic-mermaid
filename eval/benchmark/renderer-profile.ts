import './ci-policy-enforce.ts'
// Advisory: packaged timing/coverage, source-only stage attribution, and sampled
// CPU profiles are separate passes. Never compare instrumented calls to Bezel.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { chromium, type Page } from 'playwright'
import { officialCorpusInventory } from '../shared/official-fences.ts'
import { bezelEngine } from './bezel.ts'
import { benchmarkHost, benchmarkOptions, driverRevision, percentile, positiveOption, sha256 } from './browser-bench-host.ts'
import { configureBrowserPage } from './browser-config.ts'
import { browserScorecard, renderPass, type BrowserSample, type Engine } from './release-browser-bench.ts'

const options = benchmarkOptions(['--agentic-root', '--bezel-dir', '--out', '--executable', '--rounds', '--timing-report'], ['--agentic-root', '--bezel-dir', '--out'])
const out = resolve(options.get('--out')!), root = resolve(options.get('--agentic-root')!)
mkdirSync(out, { recursive: true })
const reportPath = join(out, 'renderer-profile.json')
const prior = options.has('--timing-report') ? JSON.parse(readFileSync(resolve(options.get('--timing-report')!), 'utf8')) : undefined
writeFileSync(reportPath, JSON.stringify({ status: 'incomplete' }) + '\n')
const rounds = positiveOption(options, '--rounds', 3)
const inventory = officialCorpusInventory(), bezel = bezelEngine(options.get('--bezel-dir')!)
const agenticBytes = readFileSync(join(root, 'dist/browser.global.js'))
const agentic: Engine = { label: 'candidate', name: 'agentic-mermaid', version: JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version,
  root, kind: 'agentic', global: 'agenticMermaid', bundle: 'dist/browser.global.js', identity: { integrity: `sha256-${Buffer.from(sha256(agenticBytes), 'hex').toString('base64')}`, bundleSha256: sha256(agenticBytes) } }
if (prior && (prior.status !== 'completed' || prior.rounds !== rounds || [agentic, bezel].some(engine => prior.engines.find((p: Engine) => p.label === engine.label)?.identity.bundleSha256 !== engine.identity.bundleSha256))) throw new Error('Timing report must be complete and use identical artifacts and rounds')
const entry = `import { renderMermaidSVGWithReceipt } from '${resolve(import.meta.dir, '../../src/svg.ts')}';
import { withRenderStageObserver } from '${resolve(import.meta.dir, '../../src/render-stages.ts')}';
import { clearElkLayoutCache } from '${resolve(import.meta.dir, '../../src/elk-instance.ts')}';
globalThis.amRaw = source => renderMermaidSVGWithReceipt(source).svg;
globalThis.amStages = (source, consumedReceipt = false) => { const stages = []; clearElkLayoutCache(); let error; const start = performance.now();
try { withRenderStageObserver(sample => stages.push(sample), () => { const artifact = renderMermaidSVGWithReceipt(source); if (consumedReceipt) JSON.stringify(artifact.receipt); }); } catch(e) { error = String(e); }
return { totalMs: performance.now() - start, stages, error }; };`
const build = await Bun.build({ entrypoints: ['diagnostic'], target: 'browser', format: 'iife', minify: false,
  plugins: [{ name: 'diagnostic', setup(b) {
    b.onResolve({ filter: /^diagnostic$/ }, () => ({ path: 'diagnostic.js', namespace: 'diagnostic' }))
    b.onLoad({ filter: /.*/, namespace: 'diagnostic' }, () => ({ contents: entry, loader: 'js' }))
  } }] })
if (!build.success) throw new AggregateError(build.logs, 'Diagnostic bundle failed')
const diagnostic = await build.outputs[0]!.text()
writeFileSync(join(out, 'diagnostic.js'), diagnostic)
const host = await benchmarkHost({ '/candidate/': root, '/bezel/': bezel.root }, { '/blank': '<!doctype html><body>', '/diagnostic.js': diagnostic })
const browser = await chromium.launch({ headless: true, executablePath: options.get('--executable') })
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } })
  await context.route('**/*', route => new URL(route.request().url()).origin === host.origin ? route.continue() : route.abort())
  const page = await context.newPage()
  const samples: BrowserSample[] = prior ? JSON.parse(readFileSync(resolve(options.get('--timing-report')!, '../samples.json'), 'utf8')) : []
  if (prior && (samples.length !== inventory.occurrenceCount * rounds * 2 || inventory.occurrences.some(input => [agentic, bezel].some(engine => Array.from({ length: rounds }, (_, r) => r + 1).some(round => samples.filter(s => s.id === input.id && s.engine === engine.label && s.round === round).length !== 1))))) throw new Error('Timing samples do not cover the current inventory exactly once per engine/round')
  for (let round = 1; !prior && round <= rounds; round++) {
    for (const engine of round % 2 ? [agentic, bezel] : [bezel, agentic]) {
      samples.push(...await renderPass(page, engine, host.origin, inventory.occurrences, round, 30, 'off'))
      console.log(`Completed timing round ${round}: ${engine.label}`)
    }
  }
  writeFileSync(join(out, 'samples.json'), JSON.stringify(samples) + '\n')
  const coverage = [...new Set(inventory.occurrences.map(input => input.family))].map(family => {
    const inputs = inventory.occurrences.filter(input => input.family === family), ids = new Set(inputs.map(input => input.id))
    const rows = samples.filter(sample => ids.has(sample.id))
    const accepted = (engine: string, id: string) => rows.filter(r => r.engine === engine && r.id === id && r.ok).length === rounds
    return { family, occurrences: inputs.length, distinct: new Set(inputs.map(i => i.source.trim())).size,
      scorecard: browserScorecard(rows, ['candidate', 'bezel'], rounds, inputs.length),
      differential: inputs.filter(i => accepted('candidate', i.id) !== accepted('bezel', i.id)).map(i => ({ id: i.id, source: i.source,
        agentic: accepted('candidate', i.id), bezel: accepted('bezel', i.id), errors: rows.filter(r => r.id === i.id && !r.ok).map(r => ({ engine: r.engine, error: r.error })) })) }
  })
  await page.goto(host.origin + '/blank')
  await configureBrowserPage(page, undefined, 'off')
  await page.addScriptTag({ url: host.origin + '/diagnostic.js' })
  // A distinct-source pass prevents repeated docs fences overweighting attribution.
  const distinct = inventory.occurrences.filter((input, i, all) => all.findIndex(other => other.source.trim() === input.source.trim()) === i)
  const stages = await page.evaluate(({ inputs, rounds }) => {
    for (const input of inputs) (globalThis as any).amStages(input.source, true)
    return [false, true].flatMap(consumedReceipt => Array.from({ length: rounds }, (_, round) => inputs.map(input => ({ id: input.id, family: input.family, round: round + 1, consumedReceipt,
      ...(globalThis as any).amStages(input.source, consumedReceipt) }))).flat())
  }, { inputs: distinct, rounds }) as Array<{ id: string; family: string; consumedReceipt: boolean; totalMs: number; stages: Array<{ stage: string; ms: number }>; error?: string }>
  writeFileSync(join(out, 'stage-samples.json'), JSON.stringify(stages) + '\n')
  const stageSummary = [false, true].flatMap(consumedReceipt => [...new Set(stages.map(s => s.family))].map(family => {
    const rows = stages.filter(s => s.family === family && s.consumedReceipt === consumedReceipt && !s.error)
    const totalMs = rows.reduce((n, r) => n + r.totalMs, 0), byStage: Record<string, number> = {}
    for (const row of rows) for (const s of row.stages) byStage[s.stage] = (byStage[s.stage] ?? 0) + s.ms
    return { family, consumedReceipt, successfulDistinct: new Set(rows.map(r => r.id)).size, calls: rows.length, totalMs, byStage, medianMs: percentile(rows.map(r => r.totalMs), .5) }
  }))
  const profiles = []
  for (const family of ['flowchart', 'sequence', 'class', 'er', 'state', 'gantt', 'mindmap', 'pie']) {
    // Pick the slowest shared-success input by median packaged AM cost.
    const candidates = distinct.filter(i => i.family === family && samples.filter(s => s.id === i.id && s.ok).length === rounds * 2)
    candidates.sort((a, b) => (percentile(samples.filter(s => s.id === b.id && s.engine === 'candidate').map(s => s.ms), .5) ?? 0) - (percentile(samples.filter(s => s.id === a.id && s.engine === 'candidate').map(s => s.ms), .5) ?? 0))
    const input = candidates[0]
    if (!input) continue
    for (const engine of [agentic, bezel]) profiles.push(await cpuProfile(page, engine, input))
    profiles.push(await cpuProfile(page, agentic, input, true))
  }
  const report = { status: 'completed', advisory: true, driverRevision: driverRevision(), browser: browser.version(), rounds,
    policy: { timing: 'packed public SVG call; 30 warmups; ELK cache off; reverse order on alternate rounds', acceptance: 'SVG return, not semantic or visual fidelity',
      stages: `separate unminified source build, ${rounds} passes over distinct sources after full distinct-corpus warmup; layout contains ELK; stages may overlap; not paired timing`,
      cpu: 'separate 500ms sampled loop on slowest shared-success input per selected family; samples are attribution, not benchmark timing', remoteAssets: 'blocked' },
    engines: [agentic, bezel], sourceDiagnosticSha256: sha256(Buffer.from(diagnostic)), reusedTimingReport: options.get('--timing-report'), bezelManifest: JSON.parse(readFileSync(join(bezel.root, 'manifest.json'), 'utf8')),
    inventory: { upstream: inventory.upstream, occurrences: inventory.occurrenceCount, distinct: inventory.distinctCount },
    scorecard: browserScorecard(samples, ['candidate', 'bezel'], rounds, inventory.occurrenceCount), coverage, stageSummary, profiles }
  writeFileSync(reportPath, JSON.stringify(report, null, 2) + '\n')
  console.log(reportPath)
} catch (error) {
  writeFileSync(reportPath, JSON.stringify({ status: 'failed', error: String(error) }) + '\n'); throw error
} finally { await browser.close(); await host.close() }

async function cpuProfile(page: Page, engine: Engine, input: { id: string; source: string }, sourceDiagnostic = false) {
  await page.goto(host.origin + '/blank')
  await configureBrowserPage(page, undefined, 'off')
  await page.addScriptTag({ url: sourceDiagnostic ? host.origin + '/diagnostic.js' : `${host.origin}/${engine.label}/${engine.bundle}` })
  const cdp = await page.context().newCDPSession(page)
  await cdp.send('Profiler.enable')
  await cdp.send('Profiler.setSamplingInterval', { interval: 500 })
  await cdp.send('Profiler.start')
  const result = await page.evaluate(({ source, global, kind, sourceDiagnostic }) => {
    const api = (globalThis as any)[global], run = () => sourceDiagnostic ? (globalThis as any).amRaw(source) : kind === 'agentic' ? api.renderMermaidSVG(source) : api(source)
    const start = performance.now(); let calls = 0, svg = ''
    do { svg = run(); calls++ } while (performance.now() - start < 500)
    return { calls, svgBytes: new TextEncoder().encode(svg).length }
  }, { source: input.source, global: engine.global, kind: engine.kind, sourceDiagnostic })
  const { profile } = await cdp.send('Profiler.stop')
  await cdp.detach()
  const file = `${engine.label}${sourceDiagnostic ? '-source' : ''}-${input.id.replace(/[^a-zA-Z0-9-]/g, '_')}.cpuprofile`
  writeFileSync(join(out, file), JSON.stringify(profile))
  const sampleCount = profile.samples?.length ?? 0
  // V8 repeats the same function at different call-tree positions. Aggregate
  // self samples by frame, while retaining the complete tree in the profile.
  const frames = new Map<string, { function: string; url: string; line: number; samples: number }>()
  for (const node of profile.nodes) {
    const f = node.callFrame, key = JSON.stringify([f.functionName, f.url, f.lineNumber, f.columnNumber])
    const frame = frames.get(key) ?? { function: f.functionName, url: f.url, line: f.lineNumber + 1, samples: 0 }
    frame.samples += node.hitCount ?? 0; frames.set(key, frame)
  }
  const top = [...frames.values()].sort((a, b) => b.samples - a.samples).slice(0, 15).map(frame => ({ ...frame, fraction: frame.samples / sampleCount }))
  return { engine: engine.label, sourceDiagnostic, input: input.id, ...result, file, sampleCount, top }
}
