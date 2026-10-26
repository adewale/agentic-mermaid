import { writeBenchmarkDocument } from '../portable/project-records.ts'
import { fidelityCriteriaProtocol } from './protocol.ts'
import { createServer } from 'node:http'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { extname, join, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { admitCurrentReference } from '../../mermaid-modern-compat/reference.ts'
import { captureInstalledDependencyClosure } from '../portable/artifact-dependencies.ts'
import { assertBenchmarkExecutionAllowed } from '../ci-policy.ts'
import { assertBenchmarkSetVersions, benchmarkToolPins } from '../tool-versions.ts'
import { baselineBrowserAction } from '../unified/baseline-browser-worker.mjs'
import { baselineMeasurementContext } from '../unified/baseline-measurement-context.ts'
import { deliveredArtifactIdentity, executableIdentity } from '../unified/benchmark-context.ts'
import { runRetainedSuite } from '../unified/retained-suite.ts'
import { qualifyOutput } from '../unified/qualification.ts'
import type { BenchmarkObservation, UnifiedRunOptions, UnifiedSuiteResult } from '../unified/types.ts'
import { createMeaningAdapter, normalizeMeaning, type MeaningTool } from './adapters.ts'
import { fidelityCoreProjects as projects, selectsCoreFidelity } from './selection.ts'
import { expandedFidelityCases } from './cases.ts'
export { expandedFidelityCases } from './cases.ts'
import { planFidelityCriteria, completeCriterionLedger, compareFidelityCriteria } from './ledger.ts'
import { inspectQuantitativePaint } from './paint-values.ts'
import { assessMeaning, type AuthoredFidelityCase } from './meaning.ts'
import { inspectFidelityPaint } from './paint.ts'

export interface FidelityRunOptions extends UnifiedRunOptions { fidelityDiagnostic?: boolean; fidelityCaseIds?: string[] }
const write = (path: string, value: unknown) => writeFileSync(path, JSON.stringify(value, null, 2) + '\n')
const packageNames: Record<MeaningTool, string> = { agentic: 'agentic-mermaid', pele: 'pele', mermaid: 'mermaid' }


export async function runFidelityCampaign(options: FidelityRunOptions): Promise<UnifiedSuiteResult> {
  assertBenchmarkExecutionAllowed()
  const startedAt = new Date().toISOString(), root = options.harnessRoot ?? options.root, out = options.out
  if (!selectsCoreFidelity(options.communityProjects)) return { id: 'mermaid-fidelity', startedAt, finishedAt: startedAt, status: 'not-applicable', observations: [], artifacts: [], gaps: ['No core public-model project was selected; no source, reference, runtime, browser or output directory was prepared.'] }
  mkdirSync(out, { recursive: true })
  const reference = options.referenceDir ?? resolve(root, '../mermaid-reference'), upstream = options.mermaidDir ?? resolve(root, '../mermaid')
  const sourcePin = admitCurrentReference(upstream, reference)
  const targets: Array<{ tool: MeaningTool; project: string; packageRoot: string; entry: string; version: string }> = []
  for (const tool of ['mermaid', 'agentic', 'pele'] as const) {
    const project = projects[tool]
    if (options.communityProjects && !options.communityProjects.includes(project)) continue
    const packageRoot = tool === 'mermaid' ? join(reference, 'node_modules/mermaid') : tool === 'agentic' ? options.packageRoot ?? root : options.portableArtifactRoot ?? join(root, `node_modules/.cache/unified-community/pele@${benchmarkToolPins['obsidianmd/pele'].version}/node_modules/pele`)
    const manifest = JSON.parse(readFileSync(join(packageRoot, 'package.json'), 'utf8'))
    if (manifest.name !== packageNames[tool]) throw Error('Wrong actual installed package for ' + project + ': ' + manifest.name)
    const exported = manifest.exports?.[tool === 'agentic' ? './browser/lazy' : './lazy']
    const entry = tool === 'mermaid' ? 'dist/mermaid.esm.min.mjs' : typeof exported === 'string' ? exported : exported?.import ?? exported?.default
    if (typeof entry !== 'string' || !existsSync(resolve(packageRoot, entry))) throw Error('Actual public browser entry unavailable for ' + project)
    targets.push({ tool, project, packageRoot: resolve(packageRoot), entry, version: manifest.version })
  }
  if (!targets.length) return { id: 'mermaid-fidelity', startedAt, finishedAt: new Date().toISOString(), status: 'blocked', observations: [], artifacts: [], gaps: ['No selected project exposes a supported core public-model adapter; use community-fidelity for other prepared SVG implementations.'] }
  const addonRoot = targets.some(target => target.tool === 'mermaid') ? options.fidelityZenumlRoot ?? process.env.MERMAID_ZENUML_BENCHMARK_ROOT : undefined
  const addon = addonRoot ? { root: resolve(addonRoot), manifest: JSON.parse(readFileSync(join(addonRoot, 'package.json'), 'utf8')), entry: 'dist/mermaid-zenuml.esm.min.mjs' } : undefined
  if (addon && addon.manifest.name !== '@mermaid-js/mermaid-zenuml') throw Error('Wrong declared ZenUML reference backend package')
  const toolVersions = assertBenchmarkSetVersions([...targets.map(target => ({ tool: target.project, version: target.version, source: join(target.packageRoot, 'package.json') })), ...(addon ? [{ tool: addon.manifest.name, version: addon.manifest.version, source: join(addon.root, 'package.json') }] : [])])
  const allCases = expandedFidelityCases()
  if (new Set(allCases.map(value => value.id)).size !== allCases.length) throw Error('Duplicate authored fidelity case identity')
  const unknownCases = options.fidelityCaseIds?.filter(id => !allCases.some(value => value.id === id))
  if (unknownCases?.length) throw Error('Unknown authored fidelity cases: ' + unknownCases.join(', '))
  const selectedCases = allCases.filter((value, index) => options.fidelityCaseIds ? options.fidelityCaseIds.includes(value.id) : options.profile !== 'smoke' || allCases.findIndex(candidate => candidate.family === value.family) === index)
  if (!selectedCases.length) throw Error('No authored fidelity cases selected')
  const planned = planFidelityCriteria(selectedCases)
  const request = createRequire(join(root, 'eval/benchmark/package.json')), { chromium } = request('playwright')
  const browserExecutable = options.executable ?? '/usr/bin/chromium', node = options.nodeExecutable ?? process.execPath
  let browser: any
  const getBrowser = async () => browser ??= await chromium.launch({ headless: true, executablePath: browserExecutable })
  const server = createServer((request, response) => {
    if (request.url === '/blank' || request.url === '/observer') { response.setHeader('content-type', 'text/html'); if (request.url === '/observer') response.setHeader('content-security-policy', "default-src 'none'; script-src 'none'; style-src 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data: blob:; connect-src 'none'; object-src 'none'; frame-src 'none'; base-uri 'none'"); response.end('<!doctype html><meta charset="utf-8"><body>'); return }
    if (addon && request.url?.startsWith('/addon/')) { const path = resolve(addon.root, decodeURIComponent(request.url.slice(7))); if (!path.startsWith(addon.root + sep) || !existsSync(path)) { response.writeHead(404).end(); return }; response.setHeader('content-type', 'text/javascript'); response.end(readFileSync(path)); return }
    const match = /^\/package\/([^/]+)\/(.*)$/.exec(new URL(request.url!, 'http://localhost').pathname), target = targets.find(value => value.tool === match?.[1])
    const path = target && match ? resolve(target.packageRoot, decodeURIComponent(match[2]!)) : undefined
    if (!target || !path || !path.startsWith(target.packageRoot + sep) || !existsSync(path)) { response.writeHead(404).end(); return }
    response.setHeader('content-type', ['.js', '.mjs'].includes(extname(path)) ? 'text/javascript' : extname(path) === '.css' ? 'text/css' : 'application/octet-stream')
    response.end(readFileSync(path))
  })
  await new Promise<void>(done => server.listen(0, '127.0.0.1', done))
  const origin = 'http://127.0.0.1:' + (server.address() as { port: number }).port
  const results: UnifiedSuiteResult[] = []
  try {
    for (const target of targets) {
      const projectOut = join(out, Buffer.from(target.project).toString('base64url'))
      const measure = async (directory: string): Promise<UnifiedSuiteResult> => {
        const began = new Date().toISOString(), observations: BenchmarkObservation[] = [], rows: unknown[] = [], artifacts: string[] = []
        mkdirSync(directory, { recursive: true })
        const adapter = await createMeaningAdapter({ tool: target.tool, packageRoot: target.packageRoot, ...(target.tool === 'mermaid' ? { referenceRoot: reference } : {}) })
        const referenceAdapter = target.tool === 'agentic' ? await createMeaningAdapter({ tool: 'mermaid', packageRoot: join(reference, 'node_modules/mermaid'), referenceRoot: reference }) : undefined
        const context = await (await getBrowser()).newContext({ viewport: { width: 1400, height: 1000 }, serviceWorkers: 'block' }), page = await context.newPage(), observer = await context.newPage()
        const blockedRequests: string[] = [], collectionErrors: string[] = []
        try {
        await context.route('**/*', async (route: any) => { const url = route.request().url(); if (url.startsWith(origin + '/') || url.startsWith('data:') || url === 'about:blank') await route.continue(); else { blockedRequests.push(url); await route.abort() } })
        await page.goto(origin + '/blank')
        await observer.goto(origin + '/observer')
        await page.evaluate(baselineBrowserAction, { type: 'initialize', kind: target.tool, url: `${origin}/package/${target.tool}/${target.entry.replace(/^\.\//, '')}`, configuration: { startOnLoad: false, securityLevel: 'strict', logLevel: 'fatal' } })
        if (target.tool === 'mermaid' && addon) await page.evaluate(async (url: string) => { const api = (globalThis as any).__baselineBrowser.api, plugin = await import(url); await api.registerExternalDiagrams([plugin.default]) }, origin + '/addon/' + addon.entry)
          for (const [index, testCase] of selectedCases.entries()) {
            const add = (surface: string, criterion: string, status: string, actual: unknown, expected: unknown, scope: string) => observations.push({ suite: 'mermaid-fidelity', surface, runtime: surface === 'native-public-api' ? `${process.versions.bun ? 'Bun ' + process.versions.bun : 'Node ' + process.versions.node}:public-model-host` : 'Chromium', family: testCase.family, caseId: testCase.id + ':' + criterion, operation: criterion, format: surface === 'native-public-api' ? 'structured' : 'svg', mode: 'independent-authored-criteria', status: status === 'unavailable' ? 'blocked' : status === 'rejected' ? 'failed' : status as BenchmarkObservation['status'], detail: scope, metrics: { implementation: target.project, criterion, authoredCase: testCase.id, required: testCase.required, expected: JSON.stringify(expected ?? null), actual: JSON.stringify(actual ?? null), scope } })
            try {
            for (const [preludeIndex, prelude] of (testCase.prelude ?? []).entries()) {
              const result = await adapter.parse(prelude.source, testCase.family)
              const accepted = result.status === 'accepted', rejected = result.publicAccepted === false
              add('native-public-api', 'prelude-' + preludeIndex, (prelude.accept ? accepted : rejected) ? 'passed' : result.status === 'unavailable' ? 'unavailable' : 'failed', result.status, prelude.accept ? 'native admission' : 'native non-admission', result.scope)
            }
            let acquired = await adapter.parse(testCase.source, testCase.family)
            await page.evaluate(baselineBrowserAction, { type: 'release' })
            await page.evaluate(baselineBrowserAction, { type: 'configure' })
            const preludeResults: unknown[] = []
            for (const [preludeIndex, prelude] of (testCase.prelude ?? []).entries()) {
              const result = await page.evaluate(baselineBrowserAction, { type: 'render', source: prelude.source, renderId: `prelude-${target.tool}-${index}-${preludeIndex}`, renderOptions: (prelude as { renderOptions?: unknown }).renderOptions })
              const passed = prelude.accept ? result.accepted : !result.accepted && /^(?:Error: Parse error on line|UnknownDiagramError: No diagram type|PeleError: (?:Parse error on line|No diagram type)|(?:BrowserFamilyDetectionError|MermaidFamilyDetectionError): Unsupported Mermaid family|Error: SEQUENCE_UNSUPPORTED_STATEMENT:)/.test(result.error ?? '')
              preludeResults.push(result); add('browser-public-api', 'prelude-' + preludeIndex, passed ? 'passed' : 'failed', { accepted: result.accepted, error: result.error }, prelude.accept, 'Actual configured browser recovery/setup operation; runtime faults earn no rejection credit')
              await page.evaluate(baselineBrowserAction, { type: 'release' })
            }
            const rendered = await page.evaluate(baselineBrowserAction, { type: 'render', source: testCase.source, renderId: `fidelity-${target.tool}-${index}`, renderOptions: target.tool === 'mermaid' && testCase.renderOptions?.fontSize !== undefined ? { ...testCase.renderOptions, themeVariables: { fontSize: String(testCase.renderOptions.fontSize) + 'px' } } : testCase.renderOptions })
            if (target.tool === 'mermaid' && testCase.family === 'eventmodeling') {
              try {
                const state = await page.evaluate(async (source: string) => {
                  const api = (globalThis as any).__baselineBrowser.api, diagram = await api.mermaidAPI.getDiagramFromText(source), state = diagram.db.getState()
                  return { boxes: state.boxes.map((box: any) => ({ frame: { name: box.frame.name, entityIdentifier: box.frame.entityIdentifier } })), relations: state.relations.map((relation: any) => ({ sourceBox: { frame: { name: relation.sourceBox.frame.name } }, targetBox: { frame: { name: relation.targetBox.frame.name } } })) }
                }, testCase.source)
                acquired = { status: 'accepted', publicAccepted: true, meaning: normalizeMeaning('mermaid', testCase.family, { getState: () => state, getDiagramTitle: () => '' }), scope: 'Actual public getState values captured in Chromium; no simulated SVG measurement or private facade' }
              } catch (error) { acquired = { ...acquired, error: String(error) } }
            }
            const meaning = assessMeaning(testCase, acquired.meaning)
            add('native-public-api', 'native-admission', acquired.status === 'accepted' ? 'passed' : acquired.status, acquired.error ?? acquired.scope, 'native public meaning', acquired.scope)
            for (const item of meaning.checks) add('native-public-api', item.criterion, acquired.meaning ? item.status : acquired.status === 'unsupported' ? 'unsupported' : acquired.status === 'rejected' ? 'failed' : 'unavailable', item.actual, item.expected, acquired.meaning ? item.scope : acquired.scope + ': ' + (acquired.error ?? 'No native projection'))
            let paint: Awaited<ReturnType<typeof inspectFidelityPaint>> | undefined
            add('browser-public-api', 'public-svg-admission', rendered.accepted ? 'passed' : ['TypeError', 'ReferenceError', 'RangeError', 'TimeoutError', 'AbortError'].includes(rendered.errorName) ? 'unavailable' : /^(?:UnknownDiagramError:|(?:BrowserFamilyDetectionError|MermaidFamilyDetectionError):|PeleError: No diagram type)/.test(rendered.error ?? '') ? 'unsupported' : 'failed', rendered.error ?? 'Returned public SVG', 'usable public SVG', 'Actual public browser admission; native meaning and paint are separate criteria')
            if (rendered.accepted) {
              const qualification = qualifyOutput({ id: testCase.id, family: testCase.family, source: testCase.source, expectedLabels: testCase.expected.labels, features: testCase.features, provenance: testCase.provenance }, rendered.svg, 'svg')
              add('browser-public-api', 'standalone-svg-and-labels', qualification.ok ? 'passed' : 'failed', qualification.findings, [], qualification.scope)
              await observer.setContent(rendered.svg)
              await observer.evaluate(() => { document.body.style.margin = '0'; document.body.style.background = '#fff' })
              paint = await observer.evaluate(inspectFidelityPaint, { family: testCase.family, expected: testCase.expected, paint: testCase.paint })
              for (const item of paint!.checks) add('browser-owned-ink', item.criterion, item.status, item.actual, item.expected, item.scope)
              const quantitative = await observer.evaluate(inspectQuantitativePaint, { family: testCase.family, expected: testCase.expected, source: testCase.source, nodes: paint!.nodes })
              for (const item of quantitative) add('browser-owned-ink', item.criterion, item.status, item.actual, item.expected, item.scope)
              const stem = `${index}-${testCase.id.replace(/[^a-zA-Z0-9_.-]/g, '_')}`, svgPath = join(directory, stem + '.svg'), pngPath = join(directory, stem + '.png')
              writeFileSync(svgPath, rendered.svg); await observer.locator('svg').first().screenshot({ path: pngPath, timeout: 20_000 }); artifacts.push(svgPath, pngPath)
            }
            if (adapter.serialize && acquired.status === 'accepted') {
              try { const source = await adapter.serialize(testCase.source), readback = await adapter.parse(source, testCase.family), result = assessMeaning(testCase, readback.meaning); add('native-public-api', 'serialized-meaning-readback', result.passed ? 'passed' : !result.complete ? 'unavailable' : readback.status === 'unsupported' ? 'unsupported' : 'failed', result.checks, 'same authored meaning', 'Actual public serialization and reparsing; every authored criterion survives') }
              catch (error) { add('native-public-api', 'serialized-meaning-readback', 'failed', String(error), 'valid public serialized source', 'Actual public serializer, not an export-name witness') }
              if (referenceAdapter) try {
                const source = await adapter.serialize(testCase.source), referenceReadback = await referenceAdapter.parse(source, testCase.family), checked = assessMeaning(testCase, referenceReadback.meaning)
                add('native-public-api', 'serialized-pinned-reference-readback', checked.passed ? 'passed' : !checked.complete ? 'unavailable' : 'failed', checked.checks, 'Pinned Mermaid reads the same authored meaning', 'Actual public serialization followed by pinned Mermaid public parsing and independent authored checks')
              } catch (error) { add('native-public-api', 'serialized-pinned-reference-readback', 'failed', String(error), 'Pinned Mermaid readable output', 'Actual public serializer and independent reference readback') }
            }
            rows.push({ caseId: testCase.id, family: testCase.family, required: testCase.required, features: testCase.features, source: testCase.source, provenance: testCase.provenance, native: { status: acquired.status, meaning: acquired.meaning, error: acquired.error, scope: acquired.scope, checks: meaning.checks }, browser: { accepted: rendered.accepted, error: rendered.error, preludeResults, paint } })
            } catch (error) { collectionErrors.push(testCase.id + ': ' + String(error)); rows.push({ caseId: testCase.id, family: testCase.family, collectionError: String(error) }) }
          }
        } catch (error) {
          collectionErrors.push('Browser setup: ' + String(error))
          rows.push({ setupOrCollectionError: String(error), scope: 'Collection stopped; every remaining planned criterion is retained as unavailable. Completed rows remain raw evidence.' })
        } finally { await context.close() }
        observations.splice(0, observations.length, ...completeCriterionLedger(planned, observations, target.project))
        write(join(directory, 'fidelity-cases.json'), { target, sourcePin, rows, blockedRequests, featureTagsScope: 'Authored stimulus only; per-criterion evidence determines coverage. Tags never supply passes.' }); artifacts.push(join(directory, 'fidelity-cases.json'))
        return { id: 'mermaid-fidelity', startedAt: began, finishedAt: new Date().toISOString(), status: observations.some(row => row.status === 'failed') ? 'failed' : observations.some(row => ['blocked', 'unsupported'].includes(row.status)) ? 'blocked' : 'passed', observations, artifacts, gaps: ['The declared authored feature matrix is bounded, not exhaustive syntax or a pixel-equivalence specification.', 'Actual screenshots support visible-output review; automatic geometry checks do not prove every aspect of typography or aesthetic quality.', ...collectionErrors.map(error => 'Unavailable collection evidence: ' + error), ...blockedRequests.map(url => 'External resource request blocked by the declared fixture host: ' + url)] }
      }
      const result = options.fidelityDiagnostic ? await measure(projectOut) : await runRetainedSuite({ out: projectOut, records: options.benchmarkRecordStore ?? join(out, 'records'), force: options.benchmarkForce, identity: () => JSON.parse(JSON.stringify({ project: target.project, lane: 'semantic-paint-fidelity-v1', protocol: { sourcePin: admitCurrentReference(upstream, reference), cases: selectedCases, context: baselineMeasurementContext(root, node, ['eval/benchmark/fidelity/run.ts', 'eval/benchmark/fidelity/worker.mjs', 'eval/benchmark/unified/fidelity-suite.ts']) }, artifact: { target, dependencies: captureInstalledDependencyClosure(target.packageRoot), ...(['mermaid', 'agentic'].includes(target.tool) ? { referenceHost: captureInstalledDependencyClosure(reference) } : {}), delivered: deliveredArtifactIdentity(join(target.packageRoot, 'dist'), true), ...(target.tool === 'mermaid' && addon ? { addon: { name: addon.manifest.name, version: addon.manifest.version, files: deliveredArtifactIdentity(join(addon.root, 'dist'), true) } } : {}) }, measurement: { browser: executableIdentity(browserExecutable), publicModelHost: { executable: process.execPath, versions: process.versions }, mode: 'functional and owned-ink qualification only; no latency samples' } })), measure })
      results.push(result)
    }
  } finally { if (browser) await browser.close(); await new Promise<void>(done => server.close(() => done())) }
  const observations = results.flatMap(result => result.observations)
  const calibration = compareFidelityCriteria(observations, targets.map(target => target.project))
  const report = { id: 'mermaid-fidelity', status: results.some(result => result.status === 'failed') ? 'failed' : results.some(result => result.status === 'blocked') ? 'blocked' : 'passed', startedAt, finishedAt: new Date().toISOString(), observations, artifacts: results.flatMap(result => result.artifacts ?? []), gaps: [...new Set(results.flatMap(result => result.gaps))], toolVersions, calibration, criteriaProtocol: options.fidelityDiagnostic ? null : fidelityCriteriaProtocol(root, browserExecutable), cases: selectedCases, targets, sourcePin, addon: addon ? { name: addon.manifest.name, version: addon.manifest.version, root: addon.root, scope: 'Explicit pinned first-party browser addon; core Node parser remains a separate host/capability' } : null }
  writeBenchmarkDocument(join(out, 'fidelity-report.json'), report)
  writeFileSync(join(out, 'index.html'), '<!doctype html><meta charset="utf-8"><title>Authored Mermaid fidelity evidence</title><style>body{font:16px system-ui;margin:2rem}img{max-width:100%;max-height:600px}figure{border-bottom:1px solid #ccc;padding:1rem}</style><h1>Actual rendered fidelity evidence</h1><p>Layouts belong to each renderer. Compare authored meaning, clipping, ownership and visible content; these are not pixel-equality goldens.</p>' + report.artifacts.filter(path => path.endsWith('.png')).map(path => `<figure><figcaption>${path.slice(out.length + 1)}</figcaption><img loading="lazy" src="${path.slice(out.length + 1)}"></figure>`).join(''))
  return report as UnifiedSuiteResult
}

if (import.meta.main) {
  const values = new Map<string, string>(), flags = new Set<string>()
  for (let index = 2; index < process.argv.length; index++) { const key = process.argv[index]!.replace(/^--/, ''); if (['diagnostic', 'force'].includes(key)) flags.add(key); else values.set(key, process.argv[++index]!) }
  const root = values.get('root') ?? resolve(fileURLToPath(new URL('../../..', import.meta.url)))
  const result = await runFidelityCampaign({ root, out: resolve(values.get('out')!), profile: values.get('profile') === 'smoke' ? 'smoke' : 'full', rounds: 1, harnessRoot: root, packageRoot: values.get('package-root'), portableArtifactRoot: values.get('pele-root'), referenceDir: values.get('reference-dir'), fidelityZenumlRoot: values.get('zenuml-root'), mermaidDir: values.get('mermaid-dir'), executable: values.get('browser'), nodeExecutable: values.get('node'), benchmarkRecordStore: values.get('records'), benchmarkForce: flags.has('force'), communityProjects: values.get('projects')?.split(','), fidelityDiagnostic: flags.has('diagnostic'), fidelityCaseIds: values.get('cases')?.split(',') })
  console.log(JSON.stringify({ status: result.status, observations: result.observations.length }))
  process.exitCode = result.status === 'failed' ? 1 : 0
}
