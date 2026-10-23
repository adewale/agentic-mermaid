// Prepared-artifact integration comparison; reuses maintained browser owners.
// Advisory comparison only: this is not the stock publication/peer scorecard.
import { createHash } from 'node:crypto'
import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, lstatSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const options = new Map<string, string>()
for (let i = 2; i < process.argv.length; i += 2) {
  const key = process.argv[i]!, value = process.argv[i + 1]
  if (!['--repo', '--acquisition', '--out', '--elk-cache', '--rounds', '--memory-passes', '--executable'].includes(key) || !value || value.startsWith('--') || options.has(key)) throw Error(`Invalid option ${key}`)
  options.set(key, value)
}
if (!options.has('--out')) throw Error('Provide a fresh --out directory')
if (!options.has('--acquisition')) throw Error('Provide the verified --acquisition receipt')
const out = resolve(options.get('--out')!)
if (existsSync(out)) throw Error(`Refusing to overwrite ${out}`)
const repo = resolve(options.get('--repo') ?? join(dirname(fileURLToPath(import.meta.url)), '../../..'))
const load = <T>(path: string): Promise<T> => import(pathToFileURL(join(repo, path)).href)
const [{ chromium }, { renderPass, browserScorecard }, { benchmarkHost }, { configureBrowserPage }, { browserMemoryDiagnostics, sharedMemoryInputs }, { officialCorpusInventory }] = await Promise.all([
  load<typeof import('playwright')>('node_modules/playwright/index.mjs'), load<typeof import('../release-browser-bench.ts')>('eval/benchmark/release-browser-bench.ts'), load<typeof import('../browser-bench-host.ts')>('eval/benchmark/browser-bench-host.ts'),
  load<typeof import('../browser-config.ts')>('eval/benchmark/browser-config.ts'), load<typeof import('../browser-memory.ts')>('eval/benchmark/browser-memory.ts'), load<typeof import('../../shared/official-fences.ts')>('eval/shared/official-fences.ts'),
])
type BrowserElkCache = 'off' | 'on'
interface BrowserSample { engine: string; round: number; id: string; ms: number; ok: boolean; error?: string }
const elkCache = options.get('--elk-cache') ?? 'off'
if (elkCache !== 'off' && elkCache !== 'on') throw Error('--elk-cache must be off or on')
const rounds = Number(options.get('--rounds') ?? 3), memoryPasses = Number(options.get('--memory-passes') ?? 0)
if (!Number.isSafeInteger(rounds) || rounds < 1 || !Number.isSafeInteger(memoryPasses) || memoryPasses < 0) throw Error('Invalid rounds or memory-passes')
const executable = options.get('--executable') ?? chromium.executablePath()
const acquisitionPath = resolve(options.get('--acquisition')!)
const acquisitionBytes = readFileSync(acquisitionPath)
const acquisition = JSON.parse(acquisitionBytes.toString('utf8'))
const hash = (bytes: Uint8Array | string) => createHash('sha256').update(bytes).digest('hex')
const check = (condition: unknown, reason: string) => { if (!condition) throw Error(reason) }
check(acquisition.status === 'passed' && acquisition.dependencyGraphIdentical, 'Acquisition is not qualified')
check(hash(readFileSync(acquisition.lock.path)) === acquisition.lock.sha256, 'Frozen dependency lock changed')
// Verify the immutable extracted bytes again immediately before browser launch.
for (const label of ['baseline', 'candidate']) {
  const artifact = acquisition[label]
  check(hash(readFileSync(artifact.archive.path)) === artifact.archive.sha256, `${label}: archive changed`)
  for (const file of artifact.files) {
    const bytes = readFileSync(join(artifact.root, file.path))
    check(bytes.length === file.bytes && hash(bytes) === file.sha256, `${label}: extracted artifact changed: ${file.path}`)
  }
}
for (const node of acquisition.candidateGraph.nodes) {
  const files: Array<{ path: string; bytes: number; sha256: string }> = []
  const visit = (directory: string, prefix = '') => {
    for (const name of readdirSync(directory).sort()) {
      if (name === 'node_modules') continue
      const path = join(directory, name), relative = prefix ? `${prefix}/${name}` : name, stat = lstatSync(path)
      if (stat.isDirectory()) visit(path, relative)
      else {
        check(stat.isFile(), `Dependency has non-regular file: ${path}`)
        const bytes = readFileSync(path)
        files.push({ path: relative, bytes: bytes.length, sha256: hash(bytes) })
      }
    }
  }
  visit(node.resolvedPath)
  files.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0)
  check(hash(JSON.stringify(files)) === node.installedFileInventorySha256, `Dependency bytes changed: ${node.id}`)
}
const engines = ['candidate', 'baseline'].map(label => {
  const artifact = acquisition[label]
  const pkg = JSON.parse(readFileSync(join(artifact.root, 'package.json'), 'utf8'))
  return { label, name: pkg.name, version: pkg.version, root: artifact.root, kind: 'agentic' as const, bundle: 'dist/browser.global.js', global: 'agenticMermaid',
    identity: { integrity: artifact.archive.integrity, tarballSha256: artifact.archive.sha256, revision: artifact.sourceRevision } }
})
const inventory = officialCorpusInventory(), inputs = inventory.occurrences
mkdirSync(out, { recursive: true })
writeFileSync(join(out, 'acquisition.json'), acquisitionBytes)
writeFileSync(join(out, 'corpus.json'), `${JSON.stringify(inventory, null, 2)}\n`)
const startedAt = new Date().toISOString()
const baseReport = {
  schemaVersion: 1, kind: 'prepared-artifact-browser-integration', advisory: true, startedAt,
  acquisition: { path: acquisitionPath },
  identities: engines.map(({ root, ...engine }) => engine),
  environment: { bun: Bun.version, nodeCompatibility: process.versions.node, platform: process.platform, arch: process.arch, executable, maintainedHarnessRoot: repo },
  policy: { features: 'artifact defaults; no explicit experiment override', elkCache, rounds, warmup: 'all corpus occurrences before each engine/round',
    ordering: 'candidate/baseline in odd rounds; baseline/candidate in even rounds', document: 'new page and document per engine/round; maintained renderPass consumes the full ordered corpus in that document',
    timedWork: 'maintained public SVG render call through return; inspection, cleanup, encoding and fingerprinting outside clock',
    oracle: 'separate untimed full-corpus pass per engine, full SVG UTF-8 hash and complete serialized receipt hash',
    memoryPasses, remoteAssets: 'blocked outside local artifact origin', occurrenceCount: inputs.length, distinctCount: inventory.distinctCount },
  limitations: ['Candidate and baseline only; peer competitiveness is outside this PR comparison.', 'Local Chromium evidence; not hosted CI, publication qualification, network latency or paint timing.',
    'Timing measures SVG return only; complete receipt consumption is checked outside timing and has separate packed Node measurements.',
    'Browser memory, when requested, measures sampled V8 JavaScript allocation and heap checkpoints, not native/process peak memory.'],
}
writeFileSync(join(out, 'browser-report.json'), `${JSON.stringify({ ...baseReport, status: 'running' }, null, 2)}\n`)
const host = await benchmarkHost(Object.fromEntries(engines.map(engine => [`/${engine.label}/`, engine.root])), { '/blank': '<!doctype html><meta charset="utf-8"><body>' })
let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined
const samples: BrowserSample[] = []
try {
  browser = await chromium.launch({ headless: true, executablePath: executable })
  const browserVersion = browser.version()
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } })
  await context.route('**/*', route => new URL(route.request().url()).origin === host.origin ? route.continue() : route.abort())
  const pageErrors: Array<{ engine: string; phase: string; error: string }> = []
  for (let round = 1; round <= rounds; round++) {
    for (const engine of round % 2 ? engines : [...engines].reverse()) {
      console.log(`browser ${elkCache} round ${round}/${rounds}: ${engine.label} (${inputs.length} occurrences)`)
      const page = await context.newPage()
      page.on('pageerror', error => pageErrors.push({ engine: engine.label, phase: `timing:${round}`, error: String(error) }))
      try {
        const rows = await renderPass(page, engine, host.origin, inputs, round, inputs.length, elkCache as BrowserElkCache)
        samples.push(...rows)
        for (const row of rows) appendFileSync(join(out, 'browser-samples.jsonl'), `${JSON.stringify(row)}\n`)
      } finally { await page.close() }
    }
  }
  // Separate untimed production-API oracle; hashes complete consumed values.
  const oracle: Record<string, Array<{ id: string; ok: boolean; svgSha256?: string; svgBytes?: number; receiptSha256?: string; receiptBytes?: number; error?: string }>> = {}
  for (const engine of engines) {
    console.log(`browser ${elkCache} untimed full SVG/receipt oracle: ${engine.label}`)
    const page = await context.newPage()
    page.on('pageerror', error => pageErrors.push({ engine: engine.label, phase: 'oracle', error: String(error) }))
    try {
      await page.goto(`${host.origin}/blank`)
      await configureBrowserPage(page, undefined, elkCache as BrowserElkCache)
      await page.addScriptTag({ url: `${host.origin}/${engine.label}/${engine.bundle}` })
      oracle[engine.label] = await page.evaluate(async ({ inputs, global }) => {
        const api = (globalThis as unknown as Record<string, { renderMermaidSVGWithReceipt(source: string): { svg: string; receipt: unknown } }>)[global]!
        const encoder = new TextEncoder()
        const fingerprint = async (text: string) => {
          const bytes = encoder.encode(text), digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))
          return { bytes: bytes.length, sha256: [...digest].map(value => value.toString(16).padStart(2, '0')).join('') }
        }
        const rows = []
        for (const input of inputs) {
          try {
            const result = api.renderMermaidSVGWithReceipt(input.source)
            if (typeof result.svg !== 'string' || !result.svg.includes('<svg')) throw Error('No SVG returned')
            const receipt = JSON.stringify(result.receipt)
            if (!receipt || !receipt.includes('requestDigest')) throw Error('No complete request receipt returned')
            const svgPrint = await fingerprint(result.svg), receiptPrint = await fingerprint(receipt)
            rows.push({ id: input.id, ok: true, svgSha256: svgPrint.sha256, svgBytes: svgPrint.bytes, receiptSha256: receiptPrint.sha256, receiptBytes: receiptPrint.bytes })
          } catch (error) { rows.push({ id: input.id, ok: false, error: String(error) }) }
          finally { for (const div of document.querySelectorAll('body > div')) div.remove() }
        }
        return rows
      }, { inputs, global: engine.global })
      for (const row of oracle[engine.label]!) appendFileSync(join(out, 'browser-oracle.jsonl'), `${JSON.stringify({ engine: engine.label, ...row })}\n`)
    } finally { await page.close() }
  }
  const summary = browserScorecard(samples, engines.map(engine => engine.label), rounds, inputs.length)
  const baselineOracle = new Map(oracle.baseline!.map(row => [row.id, row]))
  const lost = oracle.candidate!.filter(row => baselineOracle.get(row.id)?.ok && !row.ok)
  const shared = oracle.candidate!.filter(row => row.ok && baselineOracle.get(row.id)?.ok)
  const differences = shared.filter(row => { const base = baselineOracle.get(row.id)!; return row.svgSha256 !== base.svgSha256 || row.svgBytes !== base.svgBytes || row.receiptSha256 !== base.receiptSha256 || row.receiptBytes !== base.receiptBytes })
  const timedLost = inputs.filter(input => samples.filter(row => row.engine === 'baseline' && row.id === input.id && row.ok).length === rounds && samples.filter(row => row.engine === 'candidate' && row.id === input.id && row.ok).length !== rounds).map(input => input.id)
  await browser.close(); browser = undefined
  const memory = memoryPasses ? await browserMemoryDiagnostics({ engines, origin: host.origin, inputs: sharedMemoryInputs(inputs, samples, engines.map(engine => engine.label), rounds), rounds, passes: memoryPasses, out, executablePath: executable, elkCache: elkCache as BrowserElkCache }) : undefined
  const checks = { allTimingRowsComplete: summary.engines.every(engine => engine.complete), allOracleRowsComplete: engines.every(engine => oracle[engine.label]?.length === inputs.length), noLostTimedSuccesses: !timedLost.length, noLostReceiptOracleSuccesses: !lost.length, sharedOutputAndReceiptExact: shared.length > 0 && !differences.length, noPageErrors: !pageErrors.length, optionalMemoryComplete: !memory || memory.status === 'completed' }
  const ok = Object.values(checks).every(Boolean)
  const report = { ...baseReport, status: 'completed', ok, finishedAt: new Date().toISOString(), browser: browserVersion, checks, ...summary,
    oracle: { sharedSuccessfulOccurrences: shared.length, lost, differences, failures: Object.fromEntries(engines.map(engine => [engine.label, oracle[engine.label]!.filter(row => !row.ok)])) }, timedLost, pageErrors, ...(memory ? { memory } : {}) }
  writeFileSync(join(out, 'browser-report.json'), `${JSON.stringify(report, null, 2)}\n`)
  writeFileSync(join(out, 'browser-report.md'), `# Prepared-artifact browser comparison

Cache ${elkCache}; Chromium ${browserVersion}; ${rounds} rounds; ${inputs.length} occurrences.

Integration checks: ${ok ? 'pass' : 'FAIL'}. Shared complete SVG/receipt outputs: ${shared.length}; mismatches: ${differences.length}; lost successes: ${lost.length}.

${summary.matched.map(row => `${row.comparator}: candidate/baseline median ${row.medianRatio ?? 'unavailable'}; paired ratios ${JSON.stringify(row.ratios)}; ${row.inputIds.length} shared successful occurrences.`).join('\n\n')}

Timing is advisory and has no invented performance pass threshold. Unsupported baseline/candidate inputs and every sample remain in JSON. Peer competitiveness and canonical publication qualification are outside this comparison.
`)
  console.log(JSON.stringify({ out, ok, cache: elkCache, browser: browserVersion, samples: samples.length, sharedOracle: shared.length, differences: differences.length, checks, matched: summary.matched.map(row => ({ comparator: row.comparator, shared: row.inputIds.length, ratios: row.ratios, medianRatio: row.medianRatio })) }))
  if (!ok) process.exitCode = 1
} catch (error) {
  writeFileSync(join(out, 'browser-report.json'), `${JSON.stringify({ ...baseReport, status: 'failed', ok: false, finishedAt: new Date().toISOString(), error: String(error), completedTimingRows: samples.length }, null, 2)}\n`)
  throw error
} finally {
  await browser?.close()
  await host.close()
}
