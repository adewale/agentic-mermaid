import './ci-policy-enforce.ts'
// Advisory competitiveness scorecard. All renderers consume the same complete
// upstream inventory in one Chromium tab. Candidate JS comes from the verified
// publication tarball, never a separately rebuilt source bundle.
import { execFileSync, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { appendFileSync, existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { cpus, release, tmpdir } from 'node:os'
import { join, resolve, sep } from 'node:path'
import { gzipSync } from 'node:zlib'
import { chromium, type Page } from 'playwright'
import { officialCorpusInventory } from '../shared/official-fences.ts'
import { frozenRuntimePolicy, installAgenticRuntime, installedNpmPackagePin, installNormalizedNpmBaseline, assertNormalizedNpmRuntimes, assertMatchedAgenticRuntimes, type BaselineLock, type RuntimePolicy, type RuntimeReceipt } from './release-baseline.ts'
import { workingRevision } from './revision-tree.ts'
import { browserPerformanceOptions, configureAgenticEngines, configureBrowserPage, type BrowserElkCache } from './browser-config.ts'
import { browserMemoryDiagnostics, sharedMemoryInputs } from './browser-memory.ts'
import { bezelEngine } from './bezel.ts'
import { assertBenchmarkSetVersions, assertBenchmarkToolVersion, benchmarkToolPins } from './tool-versions.ts'

export interface Engine {
  label: string
  name: string
  version: string
  root: string
  kind: 'agentic' | 'pele' | 'mermaid' | 'dart' | 'bezel'
  bundle: string
  global: string
  experiments?: string
  identity: { integrity: string; tarballSha256?: string; bundleSha256?: string; revision?: string; runtime?: RuntimeReceipt }
}
export interface BrowserSample {
  engine: string
  round: number
  id: string
  ms: number
  ok: boolean
  error?: string
}
const median = (values: number[]) => [...values].sort((a, b) => a - b)[values.length >> 1]!
const sum = (values: number[]) => values.reduce((a, b) => a + b, 0)

/** Validate optional diagnostics before installing packages or starting a server. */
export function browserDiagnosticsOptions(options: Map<string, string>) {
  const requestedPasses = options.get('memory-passes') ?? '0'
  const passes = Number(requestedPasses)
  if (!/^\d+$/.test(requestedPasses) || !Number.isSafeInteger(passes) || passes < 0) throw new Error('--memory-passes must be a nonnegative integer')
  const dartKeys = ['dart-bundle', 'dart-sha256', 'dart-revision']
  if (!dartKeys.some(key => options.has(key))) return { memoryPasses: passes }
  if (!dartKeys.every(key => options.has(key))) throw new Error('Provide dart-bundle, dart-sha256 and dart-revision together')
  const sha256 = options.get('dart-sha256')!, revision = options.get('dart-revision')!
  if (!/^[a-f0-9]{64}$/.test(sha256)) throw new Error('--dart-sha256 must be a lowercase SHA-256 digest')
  if (!revision.trim() || revision.length > 200 || /[\x00-\x1f\x7f]/.test(revision)) throw new Error('--dart-revision must be a printable revision label')
  const bytes = readFileSync(resolve(options.get('dart-bundle')!))
  if (createHash('sha256').update(bytes).digest('hex') !== sha256) throw new Error('Dart bundle SHA-256 mismatch')
  return { memoryPasses: passes, dart: { bytes, sha256, revision } }
}

/** Acceptance and timing have separate denominators. Fast rejection never
 * contributes to the same-input speed comparison. Preserve paired rounds. */
export function browserScorecard(samples: BrowserSample[], labels: string[], rounds: number, population: number) {
  // Index actual input/round cells once. Duplicate receipts cannot replace a
  // missing round or a missing input, even when their total count looks right.
  const observations = new Map(labels.map(label => {
    const rows = samples.filter(row => row.engine === label)
    const cells = new Map<string, Map<number, BrowserSample[]>>()
    for (const row of rows) {
      const roundsById = cells.get(row.id) ?? new Map<number, BrowserSample[]>()
      roundsById.set(row.round, [...(roundsById.get(row.round) ?? []), row])
      cells.set(row.id, roundsById)
    }
    const accepted = new Set([...cells].filter(([, byRound]) => Array.from({ length: rounds }, (_, i) => byRound.get(i + 1)).every(cell => cell?.length === 1 && cell[0]!.ok)).map(([id]) => id))
    const complete = cells.size === population && rows.length === population * rounds && rows.every(row =>
      Number.isInteger(row.round) && row.round >= 1 && row.round <= rounds && cells.get(row.id)!.get(row.round)!.length === 1)
    return [label, { accepted, complete }] as const
  }))
  const complete = (label: string) => observations.get(label)!.complete
  const successful = new Map(labels.map(label => [label, observations.get(label)!.accepted]))
  const totals = (label: string, ids: Set<string>) => Array.from({ length: rounds }, (_, i) => sum(samples.filter(row => row.engine === label && row.round === i + 1 && ids.has(row.id)).map(row => row.ms)))
  const engines = labels.map(label => ({
    label, accepted: successful.get(label)!.size, population,
    complete: complete(label),
    attemptMs: Array.from({ length: rounds }, (_, i) => sum(samples.filter(row => row.engine === label && row.round === i + 1).map(row => row.ms))),
    failures: samples.filter(row => row.engine === label && row.round === 1 && !row.ok).map(({ id, error }) => ({ id, error,
      category: /No diagram type detected|UnknownDiagramError|Unrecognized Mermaid header|(?:unsupported|inventory-only) in Agentic Mermaid/.test(error ?? '') ? 'unsupported' : /EncodingError|source image|image.*decod/i.test(error ?? '') ? 'asset' : 'render_error' })),
  }))
  const matched = labels.filter(label => label !== 'candidate').map(label => {
    const ids = new Set(complete('candidate') && complete(label) ? [...successful.get('candidate')!].filter(id => successful.get(label)!.has(id)) : [])
    const candidateMs = totals('candidate', ids), comparatorMs = totals(label, ids)
    const ratios = ids.size ? candidateMs.map((value, i) => comparatorMs[i]! > 0 ? value / comparatorMs[i]! : undefined) : []
    return { comparator: label, inputIds: [...ids], candidateMs, comparatorMs, ratios, medianRatio: ratios.length && ratios.every(value => value !== undefined) ? median(ratios as number[]) : undefined }
  })
  return { engines, matched }
}

function install(spec: string, name: string, label: string, parent: string, expectedIntegrity?: string, runtimePolicy?: RuntimePolicy, out?: string): Engine {
  const prefix = join(parent, label)
  const acquired = runtimePolicy ? installAgenticRuntime(spec, prefix, runtimePolicy, out!, label, expectedIntegrity, 180_000) : undefined
  if (!acquired) {
    const child = spawnSync('npm', ['install', '--prefix', prefix, '--ignore-scripts', '--no-audit', '--no-fund', spec], { encoding: 'utf8', timeout: 180_000 })
    if (child.status !== 0) throw new Error(`${label}: package installation failed: ${child.stderr || child.error?.message}`)
  }
  const root = join(prefix, 'node_modules', name)
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as { name: string; version: string }
  assertBenchmarkToolVersion(name, pkg.version, `${label} installed artifact`)
  const { integrity } = installedNpmPackagePin(prefix, root, name, pkg.version, join(prefix, 'package-lock.json'))
  if (expectedIntegrity && expectedIntegrity !== integrity) throw new Error(`${label}: package identity differs from the requested artifact`)
  return { label, name, version: pkg.version, root, kind: name === 'agentic-mermaid' ? 'agentic' : name as 'pele' | 'mermaid',
    bundle: name === 'agentic-mermaid' ? 'dist/browser.global.js' : name === 'pele' ? 'dist/pele.global.js' : 'dist/mermaid.min.js',
    global: name === 'agentic-mermaid' ? 'agenticMermaid' : name, identity: { integrity, ...(acquired ? { runtime: acquired.runtime } : {}) } }
}

function size(paths: string[]) {
  return { requests: paths.length, files: paths.map(path => {
    const bytes = readFileSync(path)
    return { file: path, raw: bytes.byteLength, gzip: gzipSync(bytes, { level: 9 }).byteLength }
  }) }
}

async function lazyPayload(page: Page, engine: Engine, origin: string, elkCache: BrowserElkCache) {
  const fetched = new Set<string>()
  const listener = (request: { url(): string }) => {
    const url = new URL(request.url())
    if (url.origin === origin && url.pathname.startsWith(`/${engine.label}/`) && url.pathname.endsWith('.js')) fetched.add(url.pathname)
  }
  page.on('request', listener)
  try {
    await page.goto(`${origin}/blank`)
    await configureBrowserPage(page, engine.experiments, elkCache)
    const initial = await page.evaluate(async url => {
      const started = performance.now()
      const api = await import(url)
      ;(globalThis as unknown as { lazyApi: typeof api }).lazyApi = api
      return performance.now() - started
    }, `${origin}/${engine.label}/dist/browser-lazy/index.js`)
    const initialFiles = [...fetched]
    const firstFlowMs = await page.evaluate(async () => {
      const started = performance.now()
      await (globalThis as unknown as { lazyApi: { renderMermaidSVGAsync(source: string): Promise<string> } }).lazyApi.renderMermaidSVGAsync('flowchart LR\n  API --> DB')
      return performance.now() - started
    })
    const transfer = (urls: string[]) => {
      const measured = size(urls.map(url => join(engine.root, url.slice(engine.label.length + 2))))
      return { requests: measured.requests, raw: sum(measured.files.map(file => file.raw)), gzip: sum(measured.files.map(file => file.gzip)), files: measured.files.map((file, i) => ({ ...file, file: urls[i]! })) }
    }
    return { initial: transfer(initialFiles), throughFirstFlow: transfer([...fetched]), localImportMs: initial, localFirstFlowMs: firstFlowMs }
  } finally {
    page.off('request', listener)
  }
}

export async function renderPass(page: Page, engine: Engine, origin: string, inputs: Array<{ id: string; source: string }>, round: number, warmupCount: number, elkCache: BrowserElkCache = 'off'): Promise<BrowserSample[]> {
  await page.goto(`${origin}/blank`)
  await configureBrowserPage(page, engine.experiments, elkCache)
  await page.addScriptTag({ url: `${origin}/${engine.label}/${engine.bundle}` })
  return page.evaluate(async ({ engine, inputs, round, warmupCount }) => {
    type Api = { render(source: string, id?: string): { svg: string } | Promise<{ svg: string }>; renderMermaidSVG(source: string): string; initialize(options: { startOnLoad: boolean }): void }
    const api = (globalThis as unknown as Record<string, Api>)[engine.global]!
    if (!api || ((engine.kind === 'dart' || engine.kind === 'bezel') && typeof api !== 'function')) throw new Error(`${engine.label}: renderer initialization failed`)
    if (engine.kind === 'mermaid') api.initialize({ startOnLoad: false })
    const render = async (source: string, id: string) => {
      const start = performance.now()
      let output: string | undefined, error: string | undefined
      try {
        const value = engine.kind === 'agentic' ? api.renderMermaidSVG(source)
          : engine.kind === 'dart' || engine.kind === 'bezel' ? (api as unknown as (source: string) => string)(source)
          : engine.kind === 'mermaid' ? api.render(id, source) : api.render(source)
        const result = value && typeof (value as Promise<unknown>).then === 'function' ? await value : value
        output = typeof result === 'string' ? result : (result as { svg: string }).svg
      } catch (e) { error = String(e) }
      const ms = performance.now() - start
      // Inspection and cleanup are outside the timer; no painting is measured.
      if (!error && (typeof output !== 'string' || !output.includes('<svg'))) error = 'Renderer returned no SVG string'
      for (const div of document.querySelectorAll('body > div')) div.remove()
      return { ms, ok: !error, ...(error ? { error } : {}) }
    }
    // The Dave-style comparison uses 30 warm-ups; we choose an identical
    // prefix including unsupported families. Publication defaults to all.
    for (let i = 0; i < Math.min(warmupCount, inputs.length); i++) await render(inputs[i]!.source, `warm${round}x${i}`)
    const rows = []
    for (let i = 0; i < inputs.length; i++) rows.push({ engine: engine.label, round, id: inputs[i]!.id, ...await render(inputs[i]!.source, `render${round}x${i}`) })
    return rows
  }, { engine: { label: engine.label, global: engine.global, kind: engine.kind }, inputs, round, warmupCount })
}

async function main() {
  const options = new Map<string, string>()
  const allowed = new Set(['candidate-tarball', 'candidate-sha256', 'baseline-lock', 'baseline-tarball', 'baseline-sha256', 'out', 'rounds', 'case', 'executable', 'warmup', 'features', 'dart-bundle', 'dart-sha256', 'dart-revision', 'memory-passes', 'elk-cache', 'bezel-dir', 'runtime-source', 'runtime-comparison'])
  for (let i = 2; i < process.argv.length; i += 2) {
    const flag = process.argv[i]!.replace(/^--/, ''), value = process.argv[i + 1]
    if (!allowed.has(flag) || value === undefined || (value === '' && flag !== 'features') || value.startsWith('--') || options.has(flag)) throw new Error(`Invalid option ${process.argv[i]}`)
    options.set(flag, value)
  }
  if (options.has('baseline-tarball') && options.has('baseline-lock')) throw new Error('Use baseline-tarball or baseline-lock, not both')
  const diagnostics = browserDiagnosticsOptions(options)
  const bezel = options.has('bezel-dir') ? bezelEngine(options.get('bezel-dir')!) : undefined
  if (bezel && diagnostics.memoryPasses) throw new Error('Bezel WASM is outside the JS-memory diagnostic; run timing and memory separately')
  const { features, elkCache } = browserPerformanceOptions(options)
  if (options.has('baseline-tarball') !== options.has('baseline-sha256')) throw new Error('Provide both baseline-tarball and baseline-sha256')
  const comparisonMode = options.get('runtime-comparison') ?? 'matched'
  if (!['matched', 'normalized-npm-compound'].includes(comparisonMode)) throw new Error('--runtime-comparison must be matched or normalized-npm-compound')
  if (comparisonMode === 'normalized-npm-compound' && !options.has('baseline-lock')) throw new Error('Normalized npm comparison requires --baseline-lock; Git/tarball comparisons remain strict')
  if (options.has('elk-cache') && !['on', 'off'].includes(options.get('elk-cache')!)) throw new Error('--elk-cache must be on or off')
  const startedAt = new Date().toISOString()
  const policy = { runtimeComparisonMode: comparisonMode, elkCache, sceneAssertions: 'off', aplEnvironment: {}, hostAplEnvironment: Object.fromEntries(Object.entries(process.env).filter(([key]) => key.startsWith('APL_'))) }
  const out = resolve(options.get('out') ?? 'bench-report')
  mkdirSync(out, { recursive: true })
  const reportPath = join(out, 'browser-report.json')
  writeFileSync(reportPath, JSON.stringify({ status: 'incomplete', advisory: true, startedAt, policy }))
  writeFileSync(join(out, 'browser-samples.jsonl'), '')
  const temporary = mkdtempSync(join(tmpdir(), 'am-release-browser-'))
  const server = createServer()
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined
  try {
    const tarball = options.get('candidate-tarball'), expectedSha = options.get('candidate-sha256')
    if (!tarball || !expectedSha || !/^[a-f0-9]{64}$/.test(expectedSha)) throw new Error('Provide --candidate-tarball and its --candidate-sha256')
    const bytes = readFileSync(resolve(tarball))
    if (createHash('sha256').update(bytes).digest('hex') !== expectedSha) throw new Error('Candidate tarball SHA-256 mismatch')
    const rounds = Number(options.get('rounds') ?? 3)
    if (!Number.isSafeInteger(rounds) || rounds < 1) throw new Error('--rounds must be a positive integer')
    const inventory = officialCorpusInventory()
    writeFileSync(join(out, 'corpus.json'), `${JSON.stringify(inventory, null, 2)}\n`)
    const selected = options.get('case')?.split(',')
    if (selected?.some(id => !inventory.occurrences.some(input => input.id === id))) throw new Error('--case must name an occurrence ID in corpus.json')
    const inputs = selected ? inventory.occurrences.filter(input => selected.includes(input.id)) : inventory.occurrences
    const warmup = options.get('warmup')
    const warmupCount = warmup === undefined || warmup === 'all' ? inputs.length : Number(warmup)
    if (!Number.isSafeInteger(warmupCount) || warmupCount < 0) throw new Error('--warmup must be all or a nonnegative integer')
    // Exact competitor versions are intentionally advisory, independently
    // installed and pinned; they are not new library/runtime dependencies.
    const runtimePolicy = frozenRuntimePolicy(options.get('runtime-source') ?? resolve(import.meta.dir, '../..'))
    // Node and browser commands share a workflow report directory. Preserve
    // each actual installation's policy and both locks without overwriting.
    const acquisitionOut = join(out, 'browser-acquisition')
    const candidate = install(resolve(tarball), 'agentic-mermaid', 'candidate', temporary, `sha512-${createHash('sha512').update(bytes).digest('base64')}`, runtimePolicy, acquisitionOut)
    candidate.identity.tarballSha256 = expectedSha
    const engines = [candidate]
    if (options.has('baseline-tarball')) {
      const baselineBytes = readFileSync(resolve(options.get('baseline-tarball')!))
      const sha256 = createHash('sha256').update(baselineBytes).digest('hex')
      if (sha256 !== options.get('baseline-sha256')) throw new Error('Baseline tarball SHA-256 mismatch')
      const baseline = install(resolve(options.get('baseline-tarball')!), 'agentic-mermaid', 'baseline', temporary, `sha512-${createHash('sha512').update(baselineBytes).digest('base64')}`, runtimePolicy, acquisitionOut)
      baseline.identity.tarballSha256 = sha256
      engines.push(baseline)
    }
    const lockPath = options.get('baseline-lock')
    if (lockPath) {
      const lock = JSON.parse(readFileSync(lockPath, 'utf8')) as BaselineLock
      if (!/^\d+\.\d+\.\d+(?:-[\w.-]+)?$/.test(lock.version) || !lock.integrity) throw new Error('Invalid baseline lock')
      if (comparisonMode === 'normalized-npm-compound') {
        const acquired = installNormalizedNpmBaseline(lock, join(temporary, 'baseline'), runtimePolicy, join(out, 'browser-npm-acquisition'), 'baseline', 180_000)
        engines.push({ label: 'baseline', name: 'agentic-mermaid', version: lock.version, root: acquired.root, kind: 'agentic',
          bundle: 'dist/browser.global.js', global: 'agenticMermaid', identity: { integrity: acquired.integrity, runtime: acquired.runtime } })
      } else engines.push(install(`agentic-mermaid@${lock.version}`, 'agentic-mermaid', 'baseline', temporary, lock.integrity, runtimePolicy, acquisitionOut))
    }
    const runtimeComparison = comparisonMode === 'normalized-npm-compound'
      ? assertNormalizedNpmRuntimes(engines.find(engine => engine.label === 'baseline')!.identity.runtime!, candidate.identity.runtime!)
      : (assertMatchedAgenticRuntimes(engines.map(engine => engine.identity.runtime!)), { mode: 'matched' as const })
    writeFileSync(join(out, 'browser-runtime-comparison.json'), `${JSON.stringify(runtimeComparison, null, 2)}\n`)
    engines.push(install(`pele@${benchmarkToolPins['obsidianmd/pele'].version}`, 'pele', 'pele', temporary), install(`mermaid@${benchmarkToolPins['mermaid-js/mermaid'].version}`, 'mermaid', 'mermaid', temporary))
    if (bezel) engines.push(bezel)
    if (diagnostics.dart) {
      const root = join(temporary, 'dart')
      mkdirSync(root)
      writeFileSync(join(root, 'dart.js'), diagnostics.dart.bytes)
      engines.push({ label: 'dart', name: 'mermaid-dart', version: diagnostics.dart.revision, root, kind: 'dart', bundle: 'dart.js', global: 'mermaidDartRender',
        identity: { integrity: `sha256-${Buffer.from(diagnostics.dart.sha256, 'hex').toString('base64')}`, bundleSha256: diagnostics.dart.sha256, revision: diagnostics.dart.revision } })
    }
    configureAgenticEngines(engines, features)
    server.on('request', (req, res) => {
      const url = new URL(req.url ?? '/', 'http://localhost')
      if (url.pathname === '/blank') { res.setHeader('content-type', 'text/html'); res.end('<!doctype html><meta charset="utf-8"><body>'); return }
      const engine = engines.find(value => url.pathname.startsWith(`/${value.label}/`))
      const file = engine && resolve(engine.root, decodeURIComponent(url.pathname.slice(engine.label.length + 2)))
      if (!engine || !file?.startsWith(engine.root + sep) || !existsSync(file)) { res.writeHead(404).end(); return }
      res.setHeader('content-type', 'text/javascript')
      res.end(readFileSync(file))
    })
    await new Promise<void>(done => server.listen(0, '127.0.0.1', done))
    const address = server.address() as { port: number }
    const origin = `http://127.0.0.1:${address.port}`
    browser = await chromium.launch({ headless: true, ...(options.has('executable') ? { executablePath: options.get('executable') } : {}) })
    const browserVersion = browser.version()
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } })
    // Set policy before any bundle imports, including the lazy payload probe.
    await context.addInitScript(cache => {
      const host = globalThis as Record<string, unknown>
      host.AGENTIC_MERMAID_ELK_CACHE = cache === 'on' ? '1' : '0'
      host.AGENTIC_MERMAID_SCENE_ASSERTIONS = '0'
    }, elkCache)
    // Make remote assets a declared environment restriction, never an
    // unbounded network fetch hidden inside a renderer timing.
    await context.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort())
    const payload: Record<string, unknown> = {}
    // Measure a real consumer bundle from the installed publication artifact.
    // It is distinct from the complete shipped IIFE and lazy request graph.
    let focusedGzip: number | undefined
    for (const engine of engines) {
      const bundle = readFileSync(join(engine.root, engine.bundle))
      const page = await context.newPage()
      const monolithic = { file: engine.bundle, raw: bundle.byteLength, gzip: gzipSync(bundle, { level: 9 }).byteLength, sha256: createHash('sha256').update(bundle).digest('hex') }
      let focusedConsumer: { entry: string; bundler: string; raw: number; gzip: number; sha256: string } | undefined
      const focusedEntry = join(engine.root, 'dist/svg.js')
      if (engine.kind === 'agentic' && existsSync(focusedEntry)) {
        const build = await Bun.build({ entrypoints: [focusedEntry], target: 'browser', format: 'esm', minify: true })
        if (!build.success || build.outputs.length !== 1) throw new Error(`${engine.label}: focused SVG consumer bundle failed`)
        const bytes = Buffer.from(await build.outputs[0]!.arrayBuffer())
        focusedConsumer = { entry: 'agentic-mermaid/svg', bundler: `Bun ${Bun.version}`, raw: bytes.byteLength, gzip: gzipSync(bytes, { level: 9 }).byteLength, sha256: createHash('sha256').update(bytes).digest('hex') }
        writeFileSync(join(out, engine.label === 'candidate' ? 'focused-svg-consumer.js' : `focused-svg-consumer-${engine.label}.js`), bytes)
        if (engine.label === 'candidate') { payload.focusedConsumer = focusedConsumer; focusedGzip = focusedConsumer.gzip }
      }
      payload[engine.label] = { monolithic, ...(engine.kind === 'agentic' ? {
        ...(focusedConsumer ? { focusedConsumer } : {}),
        lazy: await lazyPayload(page, engine, origin, elkCache),
      } : {}) }
      await page.close()
    }
    const page = await context.newPage()
    const samples: BrowserSample[] = []
    for (let round = 1; round <= rounds; round++) {
      const order = round % 2 ? engines : [...engines].reverse()
      for (const engine of order) {
        console.log(`browser round ${round}/${rounds}: ${engine.label} ${engine.version} (${inputs.length} inputs)`)
        const rows = await renderPass(page, engine, origin, inputs, round, warmupCount, elkCache)
        samples.push(...rows)
        for (const row of rows) appendFileSync(join(out, 'browser-samples.jsonl'), `${JSON.stringify(row)}\n`)
      }
    }
    const summary = browserScorecard(samples, engines.map(engine => engine.label), rounds, inputs.length)
    // A separate process per engine prevents preceding engines' JIT/heap state
    // from entering the JS-memory comparison. Timings above remain untouched.
    if (diagnostics.memoryPasses > 0) { await browser.close(); browser = undefined }
    const memory = diagnostics.memoryPasses > 0 ? await browserMemoryDiagnostics({ engines, origin,
      inputs: sharedMemoryInputs(inputs, samples, engines.map(engine => engine.label), rounds), rounds, passes: diagnostics.memoryPasses, out,
      executablePath: options.get('executable'), elkCache }) : undefined
    const harnessRuntime = { name: process.versions.bun ? 'bun' : 'node', version: process.versions.bun ?? process.versions.node, nodeCompatibilityVersion: process.versions.node }
    const report = { status: memory && memory.status !== 'completed' ? 'incomplete' : 'completed', advisory: true, startedAt, finishedAt: new Date().toISOString(), sourceRevision: process.env.GITHUB_SHA ?? workingRevision(), browser: browserVersion, node: process.versions.node, harnessRuntime,
      environment: { os: release(), arch: process.arch, cpu: cpus()[0]?.model, logicalCpus: cpus().length,
        cpuQuota: existsSync('/sys/fs/cgroup/cpu.max') ? readFileSync('/sys/fs/cgroup/cpu.max', 'utf8').trim() : undefined,
        memoryLimit: existsSync('/sys/fs/cgroup/memory.max') ? readFileSync('/sys/fs/cgroup/memory.max', 'utf8').trim() : undefined },
      policy: { ...policy, features: features ?? null, featureConfiguration: features === undefined ? 'artifact defaults' : 'same explicit list on agentic candidate and baseline', rounds, warmup: `${Math.min(warmupCount, inputs.length)} selected-corpus attempts before each engine/round`, warmupRequested: warmup ?? 'all', elkCache: elkCache === 'off' ? 'disabled before library load; duplicate inputs still measure layout' : 'enabled before library load; artifact cache bounds and eligibility apply', ordering: 'reverse engine order on alternate rounds; one tab, fresh document per engine pass', viewport: { width: 1440, height: 1000 }, remoteAssets: 'blocked; image/asset errors are environment outcomes, not syntax failures', timing: 'public render call through SVG return; excludes inspection/cleanup/paint', compression: 'gzip level 9 of each shipped/fetched JS file', fullInventory: inventory.occurrenceCount, measured: inputs.length },
      runtimeComparison, payload, ...(memory ? { memory } : {}), ...summary }
    // Keep artifact identity separate from per-engine acceptance summaries.
    const identities = engines.map(({ root, ...engine }) => engine)
    const toolVersions = assertBenchmarkSetVersions(identities.map(engine => ({ tool: engine.name, version: engine.version, source: `Dave ${engine.label}`, ...(engine.name === 'agentic-mermaid' && engine.label !== 'candidate' ? { variant: engine.label } : {}) })))
    writeFileSync(reportPath, `${JSON.stringify({ ...report, identities, toolVersions }, null, 2)}\n`)
    const lines = ['# Browser and competitor scorecard (advisory)', '',
      ...(comparisonMode === 'normalized-npm-compound' ? ['> Normalized npm compound comparison, not an isolated PR gain. Only the external consumer dependency graph is normalized to current frozen pins; original IIFE/lazy bundles are unchanged and their embedded dependency equality is not established.', ''] : []),
      `${inputs.length}/${inventory.occurrenceCount} upstream fence occurrences, ${inventory.distinctCount} distinct examples across ${inventory.pages.length} pages. Chromium ${browserVersion}; ${rounds} counterbalanced rounds.`, '',
      `Policy: ELK cache **${elkCache}**; built-in Scene assertions **off**; browser APL environment empty (host APL variables are not applied).`, '',
      `Harness runtime: **${harnessRuntime.name} ${harnessRuntime.version}**. The legacy node field records Node API compatibility version ${harnessRuntime.nodeCompatibilityVersion}; browser execution uses Chromium above.`, '',
      '| Engine | Returns SVG in every round | Median all-attempt call time | Complete bundle gzip |', '|---|---:|---:|---:|']
    for (const engine of engines) {
      const row = summary.engines.find(row => row.label === engine.label)!
      const bundle = readFileSync(join(engine.root, engine.bundle))
      lines.push(`| ${engine.label} ${engine.version} | ${row.accepted}/${inputs.length} | ${median(row.attemptMs).toFixed(1)} ms | ${(gzipSync(bundle, { level: 9 }).byteLength / 1024).toFixed(1)} KiB |`)
    }
    lines.push('', 'All-attempt totals include rejections and are not a speed score. Ratios below exclude failures in either engine across any round.', '', '| Comparator | Shared successes | Candidate / comparator, by round | Median ratio |', '|---|---:|---|---:|')
    for (const row of summary.matched) lines.push(`| ${row.comparator} | ${row.inputIds.length} | ${row.ratios.map(value => value?.toFixed(2) ?? 'unmeasurable').join(' / ')} | ${row.medianRatio?.toFixed(2) ?? 'not compared'}× |`)
    lines.push('', '## First-round failures', '', '| Engine | Unsupported | Asset/environment | Other render errors |', '|---|---:|---:|---:|')
    for (const row of summary.engines) lines.push(`| ${row.label} | ${row.failures.filter(failure => failure.category === 'unsupported').length} | ${row.failures.filter(failure => failure.category === 'asset').length} | ${row.failures.filter(failure => failure.category === 'render_error').length} |`)
    lines.push('', '## Candidate/baseline lazy delivery', '', '| Engine | Initial JS gzip / requests | Through first flow gzip / requests |', '|---|---:|---:|')
    for (const engine of engines.filter(engine => engine.kind === 'agentic')) {
      const value = payload[engine.label] as { lazy: Awaited<ReturnType<typeof lazyPayload>> }
      lines.push(`| ${engine.label} | ${(value.lazy.initial.gzip / 1024).toFixed(1)} KiB / ${value.lazy.initial.requests} | ${(value.lazy.throughFirstFlow.gzip / 1024).toFixed(1)} KiB / ${value.lazy.throughFirstFlow.requests} |`)
    }
    if (focusedGzip !== undefined) lines.push('', `Bundled focused SVG ESM consumer (Bun ${Bun.version}): **${(focusedGzip / 1024).toFixed(1)} KiB gzip**. This excludes optional sketch backends, terminal output and typed editing; it is a consumer build from the installed tarball, not a second shipped IIFE. The complete-bundle comparison above retains the full API.`)
    const focusedEngines = engines.filter(engine => (payload[engine.label] as { focusedConsumer?: unknown }).focusedConsumer)
    if (focusedEngines.length) {
      lines.push('', '| Engine | Focused SVG consumer raw | Focused SVG consumer gzip |', '|---|---:|---:|')
      for (const engine of focusedEngines) {
        const focused = (payload[engine.label] as { focusedConsumer: { raw: number; gzip: number } }).focusedConsumer
        lines.push(`| ${engine.label} | ${(focused.raw / 1024).toFixed(1)} KiB | ${(focused.gzip / 1024).toFixed(1)} KiB |`)
      }
    }
    if (memory) lines.push('', `Separate JS-memory diagnostics: **${memory.status}**, ${memory.inputs.length} jointly successful distinct sources, ${rounds} fresh-process rounds, ${diagnostics.memoryPasses} discarded and retained passes. Forced-GC heap checkpoints and 4096-byte allocation profiles are in the JSON report and companion heapprofile files. These measure V8 JS heap and sampled allocation, not peak/native/process memory. All diagnostic failures remain in the report.`)
    lines.push('', 'Acceptance means returned SVG, not semantic or visual fidelity. Complete bundles are measured separately from lazy delivery; an unloaded loader is not a usable renderer. Cold lazy timings include localhost module fetches and are diagnostic, not network or paint benchmarks. Remote images/fonts are blocked and failures remain in the denominator. Full failures, per-round samples, fetched module paths, compression sizes and package identities accompany this report. No competitor threshold gates publication.', '')
    const markdown = lines.join('\n')
    writeFileSync(join(out, 'browser-report.md'), markdown)
    if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, markdown)
    console.log(markdown)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    writeFileSync(reportPath, JSON.stringify({ status: 'failed', advisory: true, startedAt, policy, error: message }, null, 2))
    writeFileSync(join(out, 'browser-report.md'), `# Browser scorecard: incomplete (advisory)\n\n${message}\n`)
    throw error
  } finally {
    await browser?.close()
    if (server.listening) await new Promise<void>(done => server.close(() => done()))
    rmSync(temporary, { recursive: true, force: true })
  }
}

if (import.meta.main) await main()
