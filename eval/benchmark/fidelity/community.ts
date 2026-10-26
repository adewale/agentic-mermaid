import { writeBenchmarkDocument } from '../portable/project-records.ts'
import { fidelityCriteriaProtocol } from './protocol.ts'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { createRequire } from 'node:module'
import { extname, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { gzipSync } from 'node:zlib'
import { assertBenchmarkExecutionAllowed } from '../ci-policy.ts'
import { assertBenchmarkSetVersions } from '../tool-versions.ts'
import { baselineMeasurementContext } from '../unified/baseline-measurement-context.ts'
import { defaultChromium, executableIdentity } from '../unified/benchmark-context.ts'
import type { PreparedCommunityBrowser, CommunityBrowserEngine } from '../unified/community-browser.ts'
import { qualifyOutput } from '../unified/qualification.ts'
import { runRetainedSuite } from '../unified/retained-suite.ts'
import { stableValue } from '../portable/project-records.ts'
import type { BenchmarkObservation, UnifiedSuiteResult } from '../unified/types.ts'
import { communityFidelityBrowserAction } from './community-browser-helper.ts'
import { planFidelityCriteria, completeCriterionLedger } from './ledger.ts'
import { inspectFidelityPaint } from './paint.ts'
import { inspectQuantitativePaint } from './paint-values.ts'
import { expandedFidelityCases } from './cases.ts'
import type { FidelityRunOptions } from './run.ts'

export interface CommunityFidelityOptions extends FidelityRunOptions { communityFidelityPng?: 'basic-families' | 'none' }
const core = new Set(['adewale/agentic-mermaid', 'obsidianmd/pele', 'mermaid-js/mermaid'])
const write = (path: string, value: unknown) => writeFileSync(path, JSON.stringify(value) + '\n')
const digest = (path: string) => createHash('sha256').update(readFileSync(path)).digest('hex')
async function bounded<T>(operation: Promise<T>, cancel: () => void, milliseconds = 20_000): Promise<T> { let timer: ReturnType<typeof setTimeout> | undefined; try { return await Promise.race([operation, new Promise<never>((_, reject) => { timer = setTimeout(() => { cancel(); const error = Error('Browser transport exceeded its declared20s deadline'); error.name = 'TimeoutError'; reject(error) }, milliseconds) })]) } finally { if (timer) clearTimeout(timer) } }

/** Admission checks frozen shipped bytes before any peer code executes. */
export function admitPreparedFidelityEngine(peer: PreparedCommunityBrowser) {
  const engine = peer.browser
  if (peer.browserStatus !== 'prepared' || !engine) throw Error(peer.browserDetail ?? peer.error ?? 'No prepared public SVG browser artifact')
  if ((engine.output ?? 'svg') !== 'svg') throw Error('Prepared artifact does not expose SVG output')
  const root = resolve(engine.root), entry = resolve(root, engine.entry)
  if (!entry.startsWith(root + sep) || !existsSync(entry) || !statSync(entry).isFile()) throw Error('Prepared entry is missing or outside its artifact root')
  if (digest(entry) !== engine.artifactSha256) throw Error('Prepared browser entry bytes changed')
  if (!engine.files?.length || !engine.files.some(file => resolve(file.path) === entry && file.sha256 === engine.artifactSha256)) throw Error('Prepared sealed files do not own the actual browser entry')
  const files = engine.files.map(file => { if (!existsSync(file.path) || !statSync(file.path).isFile() || digest(file.path) !== file.sha256) throw Error('Prepared executable asset changed or disappeared: ' + file.path); return { path: resolve(file.path), sha256: file.sha256, bytes: statSync(file.path).size } })
  const version = engine.version
  if (!version || peer.artifact?.version && peer.artifact.version !== version && engine.kind !== 'merman') throw Error('Prepared artifact and browser versions disagree')
  const manifests = [...new Set([join(root, 'package.json'), ...(peer.artifact?.root ? [join(peer.artifact.root, 'package.json')] : [])])].filter(existsSync).map(path => { const manifest = JSON.parse(readFileSync(path, 'utf8')); if (manifest.version && manifest.version !== version) throw Error('Actual package version differs from prepared browser version'); return { path, name: manifest.name ?? null, version: manifest.version ?? null, sha256: digest(path) } })
  assertBenchmarkSetVersions([{ tool: peer.node.id, version, source: entry }])
  return { root, entry, version, manifests, files, artifactSha256: engine.artifactSha256, revision: engine.revision ?? peer.artifact?.revision ?? null, integrity: engine.integrity ?? peer.artifact?.integrity ?? null, versionScope: manifests.length ? 'Actual installed package manifests plus sealed prepared executable bytes' : 'Frozen prepared distribution version/revision and sealed executable bytes; no embedded runtime version API is claimed' }
}

/** Collects new functionality evidence only. It never acquires peers, runs old
 * timing suites or interprets absent SVG capability as a rendering failure. */
export async function runCommunityFidelitySuite(options: CommunityFidelityOptions): Promise<UnifiedSuiteResult> {
  assertBenchmarkExecutionAllowed()
  const startedAt = new Date().toISOString(), root = resolve(options.harnessRoot ?? options.root), out = resolve(options.out)
  if (!options.communityBrowserPreparedFile) throw Error('Community fidelity requires an explicit existing frozen browser-prepared manifest')
  const preparedFile = resolve(options.communityBrowserPreparedFile), prepared = JSON.parse(readFileSync(preparedFile, 'utf8')) as PreparedCommunityBrowser[]
  const catalogFile = resolve(options.communityCatalogFile ?? join(root, 'docs/mermaid-community.json')), catalog = JSON.parse(readFileSync(catalogFile, 'utf8'))
  const nodes = catalog.nodes as PreparedCommunityBrowser['node'][]
  if (!Array.isArray(prepared) || !Array.isArray(nodes) || new Set(nodes.map(node => node.id)).size !== nodes.length || new Set(prepared.map(peer => peer.node.id)).size !== prepared.length) throw Error('Community catalog/prepared identities must be unique arrays')
  const unknown = options.communityProjects?.filter(id => !nodes.some(node => node.id === id)); if (unknown?.length) throw Error('Unknown community projects: ' + unknown.join(', '))
  const cases = expandedFidelityCases(), missing = options.fidelityCaseIds?.filter(id => !cases.some(value => value.id === id)); if (missing?.length) throw Error('Unknown authored fidelity cases: ' + missing.join(', '))
  const selectedCases = cases.filter((value, index) => options.fidelityCaseIds ? options.fidelityCaseIds.includes(value.id) : options.profile !== 'smoke' || cases.findIndex(candidate => candidate.family === value.family) === index)
  if (!selectedCases.length) throw Error('No authored fidelity cases selected')
  const planned = planFidelityCriteria(selectedCases), boundaries: any[] = [], targets: { peer: PreparedCommunityBrowser; admission: ReturnType<typeof admitPreparedFidelityEngine> }[] = []
  mkdirSync(out, { recursive: true })
  for (const node of nodes) {
    const peer = prepared.find(peer => peer.node.id === node.id), selected = !options.communityProjects || options.communityProjects.includes(node.id)
    let status = 'blocked', reason = peer?.browserDetail ?? peer?.error ?? 'No frozen prepared public SVG browser artifact; no acquisition attempted'
    if (core.has(node.id)) { status = 'delegated'; reason = 'Fresh core3 fidelity lane owns this project; community collector does not duplicate its calls' }
    else if (!selected) { status = 'not-selected'; reason = 'Project selection limits execution before loading any peer code' }
    else if (!node.outputs.includes('svg')) { status = 'not-applicable'; reason = 'Catalog boundary exposes terminal/parser/text/other outputs, not a public SVG engine' }
    else if (peer?.browserStatus === 'not-applicable') { status = 'not-applicable'; reason = peer.browserDetail ?? reason }
    else if (peer?.browserStatus === 'prepared') {
      try { const admission = admitPreparedFidelityEngine(peer); targets.push({ peer, admission }); status = 'admitted'; reason = 'Actual frozen public SVG artifact and sealed file bytes verified' } catch (error) { reason = String(error) }
    }
    boundaries.push({ project: node.id, selected, catalogOutputs: node.outputs, status, reason, ...(peer?.browser ? { kind: peer.browser.kind, version: peer.browser.version, artifactSha256: peer.browser.artifactSha256 } : {}) })
  }
  const toolVersions = assertBenchmarkSetVersions(targets.map(({ peer, admission }) => ({ tool: peer.node.id, version: admission.version, source: admission.entry })))
  const require = createRequire(join(root, 'eval/benchmark/package.json')), { chromium } = require('playwright'), executable = options.executable ?? defaultChromium(chromium)
  let browser: any
  const getBrowser = async () => browser ??= await chromium.launch({ headless: true, executablePath: executable })
  const results: UnifiedSuiteResult[] = [], aliases = new Map<string, { project: string; result: UnifiedSuiteResult }>()
  const producerContext = () => baselineMeasurementContext(root, options.nodeExecutable ?? process.execPath, ['eval/benchmark/fidelity/community.ts'])
  try {
    for (const target of targets) {
      const { peer, admission } = target, engine = peer.browser!, project = peer.node.id, projectOut = join(out, Buffer.from(project).toString('base64url'))
      const aliasKey = stableValue({ kind: engine.kind, global: engine.global ?? null, version: engine.version, legacy: engine.legacyMermaid ?? false, syncLegacy: engine.synchronousLegacyRender ?? false, scriptType: engine.scriptType ?? null, entry: engine.entry, wasm: engine.wasm ?? null, files: admission.files.filter(file => file.path.startsWith(admission.root + sep)).map(file => ({ path: relative(admission.root, file.path), sha256: file.sha256 })).sort((a, b) => a.path.localeCompare(b.path)) })
      const identity = () => JSON.parse(JSON.stringify({ project, lane: 'community-fidelity', protocol: producerContext(), artifact: admitPreparedFidelityEngine(peer), measurement: { kind: engine.kind, global: engine.global ?? null, entry: engine.entry, scriptType: engine.scriptType ?? null, legacyMermaid: engine.legacyMermaid ?? false, synchronousLegacyRender: engine.synchronousLegacyRender ?? false, wasm: engine.wasm ?? null, cases: selectedCases.map(value => value.id), browser: executableIdentity(executable), screenshots: options.communityFidelityPng ?? 'basic-families', deadlineMs: 20000 } }))
      const measure = async (directory: string): Promise<UnifiedSuiteResult> => {
        mkdirSync(directory, { recursive: true })
        const prior = aliases.get(aliasKey)
        if (prior) {
          const receipt = join(directory, 'artifact-alias.json'); write(receipt, { project, sourceProject: prior.project, admission, sourceArtifacts: prior.result.artifacts, scope: 'Exactly equal public adapter settings and all executable asset bytes; actual source-project observations reused, no independent experiment claimed' })
          return { ...prior.result, observations: prior.result.observations.map(row => ({ ...row, metrics: { ...row.metrics, implementation: project, project, artifactAliasSource: prior.project } })), artifacts: [...(prior.result.artifacts ?? []), receipt], gaps: [...prior.result.gaps, 'Actual SVG evidence reuses identical browser artifact from ' + prior.project + '; this is not another independent engine experiment'] }
        }
        const began = new Date().toISOString(), observations: BenchmarkObservation[] = [], artifacts: string[] = [], rows: any[] = [], blockedRequests = new Set<string>(), fetched = new Set<string>()
        const server = createServer((request, response) => {
          const pathname = new URL(request.url ?? '/', 'http://localhost').pathname
          if (pathname === '/blank' || pathname === '/observer') { response.setHeader('content-type', 'text/html'); if (pathname === '/observer') response.setHeader('content-security-policy', "default-src 'none'; script-src 'none'; style-src 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data: blob:; connect-src 'none'; object-src 'none'; frame-src 'none'; base-uri 'none'"); response.end('<!doctype html><meta charset="utf-8"><body>'); return }
          let file: string; try { file = resolve(admission.root, '.' + decodeURIComponent(pathname)) } catch { response.writeHead(400).end(); return }
          if (!file.startsWith(admission.root + sep) || !existsSync(file) || !statSync(file).isFile()) { response.writeHead(404).end(); return }
          const sealed = admission.files.find(asset => asset.path === file)
          if (!sealed || digest(file) !== sealed.sha256) { response.writeHead(403).end('Unsealed or changed asset'); return }
          fetched.add(relative(admission.root, file)); response.setHeader('content-type', ({ '.js': 'text/javascript', '.mjs': 'text/javascript', '.wasm': 'application/wasm', '.json': 'application/json', '.css': 'text/css', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.ttf': 'font/ttf' } as Record<string, string>)[extname(file)] ?? 'application/octet-stream'); response.end(readFileSync(file))
        })
        await new Promise<void>(done => server.listen(0, '127.0.0.1', done)); const origin = 'http://127.0.0.1:' + (server.address() as { port: number }).port
        const context = await (await getBrowser()).newContext({ viewport: { width: 1400, height: 1000 }, serviceWorkers: 'block' }); let page = await context.newPage(), observer = await context.newPage(), healthy = false
        await context.route('**/*', async (route: any) => { const url = route.request().url(); if (url.startsWith(origin + '/') || /^(?:data:|blob:|about:blank)/.test(url)) await route.continue(); else { blockedRequests.add(url); await route.abort() } })
        page.setDefaultTimeout(20_000)
        const diagnostics = new Map<string, any[]>()
        const add = (testCase: typeof selectedCases[number], surface: string, criterion: string, status: string, actual: unknown, _expected: unknown, scope: string) => {
          if (status !== 'passed') { const findings = diagnostics.get(testCase.id) ?? []; findings.push({ criterion, status, actual, scope }); diagnostics.set(testCase.id, findings) }
          observations.push({ suite: 'mermaid-fidelity', surface, runtime: 'Chromium', family: testCase.family, caseId: testCase.id + ':' + criterion, operation: criterion, format: 'svg', mode: 'independent-authored-criteria', status: status === 'unavailable' ? 'blocked' : status as BenchmarkObservation['status'], metrics: { implementation: project, criterion, authoredCase: testCase.id, required: testCase.required } })
        }
        const classify = (result: any) => result.kind === 'returned' ? 'passed' : result.kind === 'invalid-return' ? 'failed' : /^(?:UnknownDiagramError:|Error: Unsupported diagram|(?:Error: )?Unsupported (?:diagram|Mermaid)|(?:PeleError|Error): No diagram type)/.test(result.error ?? '') ? 'unsupported' : /^(?:Error: (?:Parse error on line|Lexical error on line|Parsing failed|Parser rejected source:))/.test(result.error ?? '') ? 'failed' : 'unavailable'
        let initialized = false, capabilities: any, initializationError: string | undefined
        const initialize = async () => {
          if (page.isClosed() || !healthy && initialized) { void page.close().catch(() => {}); page = await context.newPage() }
          await page.goto(origin + '/blank')
          if (engine.kind === 'franken' || engine.kind === 'merman') capabilities = await bounded(page.evaluate(communityFidelityBrowserAction, { type: 'initialize-module', kind: engine.kind, url: origin + '/' + engine.entry, wasm: engine.wasm ? origin + '/' + engine.wasm : undefined }), () => { void page.close().catch(() => {}) })
          else { await page.addScriptTag({ url: origin + '/' + engine.entry, ...(engine.scriptType ? { type: engine.scriptType } : {}) }); capabilities = await bounded(page.evaluate(communityFidelityBrowserAction, { type: 'initialize-global', engine }), () => { void page.close().catch(() => {}) }) }
          initialized = healthy = true
        }
        const render = async (input: any): Promise<any> => { try { if (!healthy || page.isClosed()) await initialize(); return await bounded<any>(page.evaluate(communityFidelityBrowserAction, input), () => { healthy = false; void page.close().catch(() => {}) }) } catch (error: any) { return { kind: 'exception', error: String(error), errorName: error?.name ?? 'Error' } } }
        try {
          await initialize(); await observer.goto(origin + '/observer')
          for (const [index, testCase] of selectedCases.entries()) {
            try {
            if (!healthy || page.isClosed()) await initialize()
            await bounded(page.evaluate(communityFidelityBrowserAction, { type: 'configure' }), () => { healthy = false; void page.close().catch(() => {}) })
            const preludes: any[] = []
            for (const [number, prelude] of (testCase.prelude ?? []).entries()) {
              const result = await render({ type: 'render', source: prelude.source, id: `community-prelude-${index}-${number}`, options: (prelude as any).renderOptions })
              const passed = prelude.accept ? result.kind === 'returned' : result.kind === 'exception' && /^(?:Error: Parse error on line|UnknownDiagramError: No diagram type)/.test(result.error ?? '')
              add(testCase, 'browser-public-api', 'prelude-' + number, passed ? 'passed' : classify(result) === 'unavailable' ? 'unavailable' : 'failed', { kind: result.kind, error: result.error }, prelude.accept, 'Actual public configured-source prelude; unknown runtime errors earn no rejection credit'); preludes.push({ kind: result.kind, error: result.error })
            }
            const result = await render({ type: 'render', source: testCase.source, id: `community-fidelity-${index}`, options: testCase.renderOptions })
            add(testCase, 'browser-public-api', 'public-svg-admission', classify(result), result.error ?? result.kind, 'actual public SVG string', 'Actual frozen public browser API invocation; generic exceptions/timeouts remain unavailable, not grammar rejection')
            const details: any = { caseId: testCase.id, family: testCase.family, publicResult: { kind: result.kind, error: result.error }, preludes }
            if (result.kind === 'returned') {
              const qualification = qualifyOutput({ id: testCase.id, family: testCase.family, source: testCase.source, expectedLabels: testCase.expected.labels, features: testCase.features, provenance: testCase.provenance }, result.svg, 'svg')
              add(testCase, 'browser-public-api', 'standalone-svg-and-labels', qualification.ok ? 'passed' : 'failed', qualification.findings, [], qualification.scope)
              const stem = `${index}-${testCase.id.replace(/[^a-zA-Z0-9_.-]/g, '_')}`, svgPath = join(directory, stem + '.svg.gz'); writeFileSync(svgPath, gzipSync(result.svg)); artifacts.push(svgPath)
              details.svgEvidence = { path: svgPath, encoding: 'gzip', bytes: Buffer.byteLength(result.svg), sha256: createHash('sha256').update(result.svg).digest('hex'), scope: 'Lossless actual public SVG output, never an input/corpus digest' }
              if (observer.isClosed()) { observer = await context.newPage(); await observer.goto(origin + '/observer') }
              await observer.setContent(result.svg); await observer.evaluate(() => { document.body.style.margin = '0'; document.body.style.background = '#fff' })
              const paint = await bounded<any>(observer.evaluate(inspectFidelityPaint, { family: testCase.family, expected: testCase.expected, paint: testCase.paint }), () => { void observer.close().catch(() => {}) })
              for (const item of paint.checks) { const unavailableOption = item.criterion === 'computed-authored-font-size' && !capabilities.fontOptions; add(testCase, 'browser-owned-ink', item.criterion, unavailableOption ? 'unavailable' : item.status, item.actual, item.expected, unavailableOption ? 'This prepared public adapter has no reviewed font-size option mapping; default matching font sizes do not earn configuration credit' : item.scope) }
              for (const item of await bounded<any>(observer.evaluate(inspectQuantitativePaint, { family: testCase.family, expected: testCase.expected, source: testCase.source, nodes: paint.nodes }), () => { void observer.close().catch(() => {}) })) add(testCase, 'browser-owned-ink', item.criterion, item.status, item.actual, item.expected, item.scope)
              if ((options.communityFidelityPng ?? 'basic-families') !== 'none' && testCase.id.startsWith('meaning:family:') && !testCase.id.includes(':configuration-reset') && await observer.locator('svg').count() > 0) {
                const pngPath = join(directory, stem + '.png'); try { await observer.locator('svg').first().screenshot({ path: pngPath, timeout: 10_000 }); artifacts.push(pngPath) } catch (error) { details.screenshotError = String(error) }
              }
            }
            details.findings = diagnostics.get(testCase.id) ?? []; rows.push(details)
            } catch (error) { rows.push({ caseId: testCase.id, family: testCase.family, collectionError: String(error), scope: 'This case observer failed; missing planned checks remain unavailable, collection continues to later cases' }) }
          }
        } catch (error) { initializationError = String(error) }
        finally { await context.close(); await new Promise<void>(done => server.close(() => done())) }
        const completed = completeCriterionLedger(planned, observations, project).map(row => row.surface === 'native-public-api' ? { ...row, detail: 'No reviewed native model adapter; no native call or passing evidence claimed' } : row)
        const receipt = join(directory, 'community-fidelity-cases.json'); write(receipt, { project, admission, capabilities, initialized, initializationError, fetched: [...fetched], blockedRequests: [...blockedRequests], rows, nativeScope: 'No reviewed native model adapter for this peer; every planned native criterion remains unavailable, independent of SVG success' }); artifacts.push(receipt)
        return { id: 'mermaid-fidelity', startedAt: began, finishedAt: new Date().toISOString(), status: completed.some(row => row.status === 'failed') ? 'failed' : 'blocked', observations: completed, artifacts, gaps: ['Native public-model criteria are unavailable for this noncore peer; public SVG success supplies no model passes.', 'Quantitative and graph projections are bounded reviewed checks, not whole-family visual equivalence.', ...(initializationError ? ['Collection interrupted: ' + initializationError + '; every missing planned criterion remains unavailable'] : []), ...[...blockedRequests].map(url => 'Blocked external resource: ' + url)] }
      }
      const result = options.fidelityDiagnostic ? await measure(projectOut) : await runRetainedSuite({ out: projectOut, records: options.benchmarkRecordStore ?? options.communityRecordStore ?? join(out, 'records'), force: options.benchmarkForce ?? options.communityForce, identity, measure })
      results.push(result); if (!aliases.has(aliasKey)) aliases.set(aliasKey, { project, result })
      write(join(out, 'community-fidelity-progress.json'), { completed: results.length, selected: targets.length, project, observations: result.observations.length })
    }
  } finally { await browser?.close() }
  const observations = results.flatMap(result => result.observations), report = { id: 'mermaid-fidelity', status: observations.some(row => row.status === 'failed') ? 'failed' : 'blocked', startedAt, finishedAt: new Date().toISOString(), observations, artifacts: results.flatMap(result => result.artifacts ?? []), gaps: [...new Set(results.flatMap(result => result.gaps))], toolVersions, criteriaProtocol: options.fidelityDiagnostic ? null : fidelityCriteriaProtocol(root, executable), catalogFile, preparedFile, boundaries, selectedCaseIds: selectedCases.map(value => value.id), scope: 'New SVG functionality collection on frozen prepared artifacts, no timing/startup/memory claims; core3 delegated; all missing native projections remain unavailable' }
  writeBenchmarkDocument(join(out, 'community-fidelity-report.json'), report)
  return report as UnifiedSuiteResult
}

if (import.meta.main) {
  const args = new Map<string, string>(), flags = new Set<string>(); for (let i = 2; i < process.argv.length; i++) { const key = process.argv[i]!.replace(/^--/, ''); if (['diagnostic', 'force', 'no-png'].includes(key)) flags.add(key); else args.set(key, process.argv[++i]!) }
  const root = args.get('root') ?? resolve(fileURLToPath(new URL('../../..', import.meta.url)))
  const result = await runCommunityFidelitySuite({ root, harnessRoot: root, out: resolve(args.get('out')!), profile: args.get('profile') === 'smoke' ? 'smoke' : 'full', rounds: 1, executable: args.get('browser'), nodeExecutable: args.get('node'), communityBrowserPreparedFile: args.get('prepared'), communityCatalogFile: args.get('catalog'), communityProjects: args.get('projects')?.split(','), fidelityCaseIds: args.get('cases')?.split(','), fidelityDiagnostic: flags.has('diagnostic'), benchmarkForce: flags.has('force'), benchmarkRecordStore: args.get('records'), communityFidelityPng: flags.has('no-png') ? 'none' : 'basic-families' })
  console.log(JSON.stringify({ status: result.status, observations: result.observations.length }))
}
