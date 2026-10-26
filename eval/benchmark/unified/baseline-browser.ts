import { writeBenchmarkDocument } from '../portable/project-records.ts'
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { createRequire } from 'node:module'
import { dirname, extname, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { gzipSync } from 'node:zlib'
import { randomUUID } from 'node:crypto'
import { admitCurrentReference } from '../../mermaid-modern-compat/reference.ts'
import { assertBenchmarkExecutionAllowed } from '../ci-policy.ts'
import { assertBenchmarkToolVersion } from '../tool-versions.ts'
import { portableCases, type Json } from '../portable/cohorts.ts'
import { byteDigest } from '../portable/artifacts.ts'
import { deliveredArtifactIdentity, executableIdentity } from './benchmark-context.ts'
import { baselineMeasurementContext } from './baseline-measurement-context.ts'
import { baselineBrowserAction } from './baseline-browser-worker.mjs'
import { qualifyOutput } from './qualification.ts'
import { requiredFamilyWorkloads } from './required-family-cases.ts'
import { runRetainedSuite } from './retained-suite.ts'
import type { BenchmarkObservation, BenchmarkStatus, UnifiedSuiteResult } from './types.ts'

export const BASELINE_BROWSER_PROTOCOL = 'pinned-browser-public-svg-v1'
export const BASELINE_BROWSER_PRODUCERS = [fileURLToPath(import.meta.url), fileURLToPath(new URL('./baseline-browser-worker.mjs', import.meta.url)), 'docs/project/upstream-mermaid-policy.json']
export type BaselineRole = 'mermaid-a0' | 'agentic' | 'pele' | 'mermaid-a1'
export interface BaselineBrowserCase {
  id: string
  family: string
  source: string
  cohorts: string[]
  expected: { accept: boolean; labels: string[] }
  renderOptions?: Record<string, Json>
  prelude?: { source: string; accept: boolean; renderOptions?: Record<string, Json> }[]
  parentCaseId?: string
}
export interface BaselineBrowserOptions {
  root: string
  out: string
  agenticRoot: string
  peleRoot: string
  referenceRoot: string
  upstreamRoot: string
  browserExecutable?: string
  nodeExecutable?: string
  records?: string
  force?: boolean
  projects?: string[]
  mode?: 'plan' | 'smoke' | 'full'
  /** The protocol records this request; full sampling remains five rounds. */
  rounds?: number
}
export interface BaselineBrowserIdentity {
  tool: string
  kind: 'mermaid' | 'agentic' | 'pele'
  version: string
  packageRoot: string
  entry: string
  sourcePin?: unknown
}
export interface BaselineBrowserObservation extends BenchmarkObservation {
  tool: string
  role: BaselineRole
  round: number
  sample: number
}
export interface BaselineBrowserReport extends UnifiedSuiteResult {
  settings: Record<string, unknown>
  identities: BaselineBrowserIdentity[]
  cases: BaselineBrowserCase[]
  executionPlan: { stage: string; round: number; sample: number; roles: BaselineRole[] }[]
  rolling: boolean
  collectionId?: string
}
const write = (file: string, value: unknown) => writeFileSync(file, JSON.stringify(value, null, 2) + '\n')
const roleOrder: BaselineRole[] = ['mermaid-a0', 'agentic', 'pele', 'mermaid-a1']
const toolFor = (role: BaselineRole): string => role.startsWith('mermaid') ? 'mermaid-js/mermaid' : role === 'agentic' ? 'adewale/agentic-mermaid' : 'obsidianmd/pele'

/** Shared cases keep their original identities and both cohort annotations. */
export function baselineBrowserCases(): BaselineBrowserCase[] {
  const cases: BaselineBrowserCase[] = portableCases().map(value => ({ id: value.id, family: value.family, source: value.source, cohorts: [value.cohort], expected: { accept: value.expected.accept, labels: value.expected.labels }, ...(value.renderOptions ? { renderOptions: value.renderOptions } : {}), ...(value.prelude ? { prelude: value.prelude } : {}) }))
  for (const family of requiredFamilyWorkloads()) {
    const existing = cases.find(value => value.id === family.id)
    if (existing) {
      if (existing.source !== family.source || JSON.stringify(existing.expected.labels) !== JSON.stringify(family.expectedLabels ?? [])) throw Error('Shared authored family witness differs: ' + family.id)
      existing.cohorts.push('required-family')
    } else cases.push({ id: family.id, family: family.family, source: family.source, cohorts: ['required-family'], expected: { accept: true, labels: [...(family.expectedLabels ?? [])] } })
  }
  for (const parent of portableCases().filter(value => value.edit)) {
    const edit = parent.edit!
    cases.push({ id: parent.id + ':edit', family: parent.family, source: edit.source, parentCaseId: parent.id, cohorts: [parent.cohort, 'edit'], expected: { accept: edit.expected.accept, labels: edit.expected.labels }, ...(edit.renderOptions ? { renderOptions: edit.renderOptions } : {}), prelude: [...(parent.prelude ?? []), { source: parent.source, accept: parent.expected.accept, ...(parent.renderOptions ? { renderOptions: parent.renderOptions } : {}) }] })
  }
  return cases
}
export function baselineRoleOrder(round: number, sample = 1): BaselineRole[] {
  const offset = (round + sample - 2) % roleOrder.length
  return [...roleOrder.slice(offset), ...roleOrder.slice(0, offset)]
}
function sourceRejection(error: string, errorName: string): boolean {
  if (/^(?:TypeError|ReferenceError|RangeError|AbortError|TimeoutError)$/.test(errorName) || /^(?:TypeError|ReferenceError|RangeError|AbortError|TimeoutError):/.test(error)) return false
  // Reviewed public source-validation signatures for the pinned adapters.
  // A word such as "parser" or "syntax" in a backend failure earns no credit.
  return /^(?:Error|PeleError): Parse error on line [1-9]\d*:/.test(error)
    || /^UnknownDiagramError: No diagram type detected matching given configuration for text:/.test(error)
    || /^PeleError: No diagram type detected for the given text\./.test(error)
    || /^(?:BrowserFamilyDetectionError|MermaidFamilyDetectionError): Unsupported Mermaid family in async browser renderer:/.test(error)
    || /^Error: Invalid mermaid header:/.test(error)
    || /^Error: SEQUENCE_UNSUPPORTED_STATEMENT: line [1-9]\d*:/.test(error)
}
/** Authored expectations are independent of each renderer's accepted output. */
export function qualifyBaselineBrowser(testCase: BaselineBrowserCase, result: any, preludes: readonly { status: BenchmarkStatus; findings: string[] }[] = []): { status: BenchmarkStatus; findings: string[]; scope: string } {
  const failedSetup = preludes.filter(value => value.status !== 'passed')
  if (failedSetup.length) return { status: 'blocked', findings: ['Authored prelude admission failed; final latency is diagnostic only', ...failedSetup.flatMap(value => value.findings)], scope: 'Workflow setup unqualified; no recovery/edit or paired cost credit' }
  if (!result.accepted) {
    const detail = String(result.error ?? 'No public result')
    if (!testCase.expected.accept && result.errorPhase === 'public-call' && sourceRejection(detail, String(result.errorName ?? 'Error'))) return { status: 'passed', findings: [], scope: 'recognized source rejection; no positive SVG credit' }
    return { status: testCase.expected.accept && /unsupported|not supported|unknown diagram|no diagram type|not registered|diagram.*not found/i.test(detail) ? 'unsupported' : 'failed', findings: [detail], scope: 'public operation did not produce expected SVG' }
  }
  if (!testCase.expected.accept) return { status: 'failed', findings: ['Expected source rejection; public renderer accepted it'], scope: 'negative source control' }
  const qualification = qualifyOutput({ id: testCase.id, family: testCase.family, source: testCase.source, expectedLabels: testCase.expected.labels, features: testCase.cohorts, provenance: 'Independent authored portable/required-family literal' }, result.svg, 'svg')
  if (result.sidecarsComplete !== true) qualification.findings.push('Structured sidecar could not be fully consumed: ' + JSON.stringify(result.unsupportedSidecars))
  return { status: qualification.findings.length ? 'failed' : 'passed', findings: qualification.findings, scope: 'SVG namespace/canvas/XML and authored text; native semantics/CSS/paint unmeasured; nonserializable callbacks excluded explicitly' }
}

export function planBaselineBrowser(options: BaselineBrowserOptions) {
  assertBenchmarkExecutionAllowed()
  const mode = options.mode ?? 'plan'
  if (!['plan', 'smoke', 'full'].includes(mode)) throw Error('Browser baseline mode must be plan, smoke or full')
  const sourcePin = admitCurrentReference(options.upstreamRoot, resolve(options.referenceRoot, '../..'))
  const targets = [
    { tool: 'mermaid-js/mermaid', kind: 'mermaid' as const, root: options.referenceRoot, exportName: './dist/mermaid.esm.min.mjs' },
    { tool: 'adewale/agentic-mermaid', kind: 'agentic' as const, root: options.agenticRoot, exportName: './browser/lazy' },
    { tool: 'obsidianmd/pele', kind: 'pele' as const, root: options.peleRoot, exportName: './lazy' },
  ]
  const identities: BaselineBrowserIdentity[] = targets.map(target => {
    const pkg = JSON.parse(readFileSync(join(target.root, 'package.json'), 'utf8'))
    assertBenchmarkToolVersion(target.tool, pkg.version, join(target.root, 'package.json'))
    if (target.kind === 'mermaid' && pkg.version !== sourcePin.version) throw Error('Browser Mermaid version differs from the admitted source pin')
    if (pkg.name !== (target.kind === 'mermaid' ? 'mermaid' : target.kind === 'agentic' ? 'agentic-mermaid' : 'pele')) throw Error('Actual package name differs from the declared browser adapter')
    const spec = pkg.exports?.[target.exportName]
    const entry = target.kind === 'mermaid' ? target.exportName.slice(2) : typeof spec === 'string' ? spec : spec?.import ?? spec?.default
    if (typeof entry !== 'string' || !existsSync(resolve(target.root, entry))) throw Error('Actual published browser entry missing: ' + target.tool)
    return { tool: target.tool, kind: target.kind, version: pkg.version, packageRoot: resolve(target.root), entry, ...(target.kind === 'mermaid' ? { sourcePin } : {}) }
  })
  if (options.projects?.some(project => !identities.some(target => target.tool === project))) throw Error('Project selection has no reviewed browser baseline adapter')
  const settings = {
    protocol: BASELINE_BROWSER_PROTOCOL, mode,
    rendererRounds: mode === 'full' ? 5 : 1,
    startupSamplesPerRole: mode === 'full' ? 25 : 1,
    resourcePassesPerRole: mode === 'full' ? 5 : 1,
    requestedUnifiedRounds: options.rounds ?? null,
    roundsOverride: options.rounds !== undefined && options.rounds !== (mode === 'full' ? 5 : 1) ? 'Protocol sampling overrides requested unified rounds explicitly' : null,
    configuration: { startOnLoad: false, securityLevel: 'strict' },
    viewport: { width: 1440, height: 1000 },
    controlToleranceRatio: .10, controlMinimumPairs: 5,
    controlDecisionPolicy: 'Require at least5 qualified round pairs and A1/A0 median within[0.9,1.1]. Tool/A0 ratio envelope=[minimum qualified round ratio/1.1,maximum/0.9]; lower cost only if upper<1, higher only if lower>1, otherwise unresolved. This is a predeclared repeatability guard, not a confidence interval or causal proof. Mixed/rolling collection windows cannot qualify as paired-fresh comparisons.',
    schedule: 'Four-role rotating order; five rounds gives each role a first position and A0 one extra. Filter missing projects after fixed order; mixed retained windows are rolling/unqualified for fresh paired claims.',
    rendererClock: 'configured public SVG workflow through fully consumed SVG and enumerable structured sidecars; public options initialization when needed included; independent qualification/DOM cleanup excluded',
    startupClock: 'before Chromium launch through page/module/public initialization and first fully consumed result transferred to controller; prepared HTTP server excluded',
    memoryScope: 'separate fresh browser document V8 heap only; worker/native/GPU/whole browser peak unmeasured; module state retained after consumer release',
    deliveryScope: 'actual unique requested shipped files; uncompressed file bodies and per-file gzip estimates, no HTTP overhead/assumed compressed transfer',
    configurationScope: 'Base public Mermaid site configuration reset outside each reused-page case; authored renderOptions applied by public adapter; layout/font-option effects are unmeasured beyond labels.',
    adapterConfiguration: { mermaid: { startOnLoad: false, securityLevel: 'strict' }, agentic: { security: 'strict' }, pele: { options: 'actual public defaults; no equivalent securityLevel switch exposed' } },
    logicalOptionMapping: 'Authored fontSize stays in literal inputs; Mermaid uses public initialize.fontSize, Pele public render options.fontSize, Agentic documented style.roles.node/edge/group.fontSize. Actual resolved options are recorded; paint/font effects unmeasured.',
    filesystemCache: 'Uncontrolled; artifact-byte admission reads shipped files before clocks. Fresh browser is not a cold filesystem claim.',
  }
  return { settings, identities, cases: baselineBrowserCases(), selected: identities.filter(target => target.kind === 'mermaid' || !options.projects || options.projects.includes(target.tool)) }
}

interface Collector { identity: BaselineBrowserIdentity; directory: string; observations: BaselineBrowserObservation[]; artifacts: string[]; gaps: string[]; startedAt: string; resolve: (value: BaselineBrowserReport) => void; reject: (error: unknown) => void }
function rowFor(target: BaselineBrowserIdentity, role: BaselineRole, testCase: BaselineBrowserCase, mode: string, round: number, sample: number): BaselineBrowserObservation {
  return { suite: 'pinned-browser-baseline', tool: target.tool, role, round, sample, surface: 'baseline-browser:' + role, runtime: 'chromium:unobserved', family: testCase.family, caseId: testCase.id, operation: 'public-svg', format: 'svg', mode, status: 'passed', metrics: { implementation: target.tool, role, round, sample, expectedAccepted: testCase.expected.accept } }
}
export async function runBaselineBrowserSuite(options: BaselineBrowserOptions): Promise<BaselineBrowserReport> {
  const plan = planBaselineBrowser(options), startedAt = new Date().toISOString()
  const collectionId = randomUUID()
  mkdirSync(options.out, { recursive: true })
  if (plan.settings.mode === 'plan') {
    const result: BaselineBrowserReport = { id: 'pinned-browser-baseline', status: 'blocked', startedAt, finishedAt: new Date().toISOString(), observations: [], gaps: ['Plan only; no renderer or browser API invoked'], settings: plan.settings, identities: plan.identities, cases: plan.cases, executionPlan: [], rolling: true }
    write(join(options.out, 'plan.json'), result)
    return result
  }
  const require = createRequire(join(options.root, 'eval/benchmark/package.json')), { chromium } = require('playwright')
  const executable = options.browserExecutable ?? '/usr/bin/chromium'
  const node = options.nodeExecutable ?? 'node'
  const collectors = new Map<string, Collector>(), tickets: Promise<UnifiedSuiteResult>[] = [], cached: string[] = []
  const executionPlan: BaselineBrowserReport['executionPlan'] = []
  for (const target of plan.selected) {
    const out = join(options.out, Buffer.from(target.tool).toString('base64url'))
    if (plan.settings.mode === 'smoke') {
      mkdirSync(out, { recursive: true })
      tickets.push(new Promise<BaselineBrowserReport>((resolveResult, reject) => collectors.set(target.tool, { identity: target, directory: out, observations: [], artifacts: [], gaps: ['Unpublished smoke; tail/control qualifications unavailable'], startedAt: new Date().toISOString(), resolve: resolveResult, reject })))
      continue
    }
    let registered!: () => void
    const ready = new Promise<void>(resolveReady => { registered = resolveReady })
    let active = false
    let registrationError: unknown
    const ticket = runRetainedSuite({ out, records: options.records ?? join(options.out, 'records'), force: options.force,
      identity: () => {
        const { requestedUnifiedRounds: _request, roundsOverride: _override, ...measuredSettings } = plan.settings
        return { project: target.tool, lane: 'pinned-browser-baseline', protocol: { context: baselineMeasurementContext(options.root, node, BASELINE_BROWSER_PRODUCERS.map(path => path.startsWith('/') ? relative(options.root, path) : path)), settings: measuredSettings, cases: plan.cases }, artifact: { target, manifest: JSON.parse(readFileSync(join(target.packageRoot, 'package.json'), 'utf8')), delivered: deliveredArtifactIdentity(join(target.packageRoot, 'dist'), true) }, measurement: { browser: executableIdentity(executable), publicEntry: { path: target.entry, sha256: byteDigest(resolve(target.packageRoot, target.entry)) }, locale: process.env.LANG ?? null } }
      },
      measure: async directory => await new Promise<BaselineBrowserReport>((resolveResult, reject) => { active = true; collectors.set(target.tool, { identity: target, directory, observations: [], artifacts: [], gaps: [], startedAt: new Date().toISOString(), resolve: resolveResult, reject }); registered() }),
    })
    ticket.then(() => { if (!active) { cached.push(target.tool); registered() } }, error => { registrationError = error; registered() })
    tickets.push(ticket)
    await ready
    if (registrationError !== undefined) { for (const collector of collectors.values()) collector.reject(registrationError); await Promise.allSettled(tickets); throw registrationError }
  }
  const rolling = cached.length > 0 || plan.selected.length !== plan.identities.length
  const server = createServer((request, response) => {
    const url = new URL(request.url!, 'http://localhost')
    if (url.pathname === '/blank') { response.setHeader('content-type', 'text/html'); response.end('<!doctype html><meta charset="utf-8"><body>'); return }
    const match = /^\/package\/([^/]+)\/(.*)$/.exec(url.pathname), target = plan.identities.find(value => value.kind === match?.[1])
    const file = target && match ? resolve(target.packageRoot, decodeURIComponent(match[2]!)) : undefined
    if (!target || !file || !file.startsWith(target.packageRoot + sep) || !existsSync(file) || !statSync(file).isFile()) { response.writeHead(404).end(); return }
    response.setHeader('content-type', ({ '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json', '.css': 'text/css', '.woff2': 'font/woff2', '.woff': 'font/woff', '.ttf': 'font/ttf', '.svg': 'image/svg+xml', '.wasm': 'application/wasm' } as Record<string, string>)[extname(file)] ?? 'application/octet-stream')
    response.setHeader('cache-control', 'no-store'); response.end(readFileSync(file))
  })
  await new Promise<void>(resolveListen => server.listen(0, '127.0.0.1', resolveListen))
  const origin = 'http://127.0.0.1:' + (server.address() as { port: number }).port
  let renderId = 0
  const startupCase = plan.cases.find(value => value.id === 'family:flowchart')!
  const activeRoles = (round: number, sample = 1) => baselineRoleOrder(round, sample).filter(role => collectors.has(toolFor(role)))
  const delivery = (paths: Set<string>, target: BaselineBrowserIdentity) => [...paths].sort().map(url => {
    const prefix = '/package/' + target.kind + '/', path = decodeURIComponent(url.slice(prefix.length)), file = resolve(target.packageRoot, path)
    if (!url.startsWith(prefix) || !file.startsWith(target.packageRoot + sep) || !existsSync(file) || !statSync(file).isFile()) return { url, missing: true, bytes: 0, gzipBytes: 0 }
    const bytes = readFileSync(file)
    return { url, bytes: bytes.byteLength, gzipBytes: gzipSync(bytes, { level: 9 }).byteLength }
  })
  const contextRun = async (role: BaselineRole, stage: 'renderer' | 'startup' | 'resource', round: number, sample: number) => {
    const collector = collectors.get(toolFor(role))!, target = collector.identity, paths = new Set<string>(), blockedRequests: string[] = [], pageErrors: string[] = [], snapshots: Record<string, unknown> = {}
    const launchStart = performance.now(), browser = await chromium.launch({ headless: true, executablePath: executable })
    let context: any
    let activeCase = startupCase
    try {
      context = await browser.newContext({ viewport: plan.settings.viewport, serviceWorkers: 'block' })
      await context.route('**/*', (route: any) => { const url = new URL(route.request().url()); if (url.origin !== origin) { blockedRequests.push(url.href); return route.abort() } return route.continue() })
      context.on('request', (request: any) => { const url = new URL(request.url()); if (url.origin === origin && url.pathname.startsWith('/package/' + target.kind + '/')) paths.add(url.pathname) })
      const page = await context.newPage(); page.setDefaultTimeout(60_000); page.on('pageerror', (error: Error) => pageErrors.push(String(error)))
      const evaluate = async (action: Record<string, unknown>) => {
        let timeout: ReturnType<typeof setTimeout> | undefined
        try { return await Promise.race([page.evaluate(baselineBrowserAction, action), new Promise<never>((_, reject) => { timeout = setTimeout(() => reject(Error('Public browser operation timed out; no source-rejection credit')), 60_000) })]) }
        finally { if (timeout) clearTimeout(timeout) }
      }
      await page.goto(origin + '/blank')
      const snapshot = async (name: string, gc = false) => { const session = await context.newCDPSession(page); if (gc) await session.send('HeapProfiler.collectGarbage'); snapshots[name] = await session.send('Runtime.getHeapUsage'); await session.detach() }
      if (stage === 'resource') await snapshot('beforeTargetImport')
      const initialized = await evaluate({ type: 'initialize', kind: target.kind, url: origin + '/package/' + target.kind + '/' + target.entry.replace(/^\.\//, ''), configuration: plan.settings.configuration })
      const launchToApiReadyMs = performance.now() - launchStart, initialPaths = new Set(paths)
      if (stage === 'resource') await snapshot('apiReady')
      let resourceResultRow: BaselineBrowserObservation | undefined
      const render = async (testCase: BaselineBrowserCase, mode: string, sampleIndex = sample, preludes: { status: BenchmarkStatus; findings: string[] }[] = []) => {
        activeCase = testCase
        const result = await evaluate({ type: 'render', source: testCase.source, renderOptions: testCase.renderOptions, renderId: 'baseline-' + ++renderId })
        if (stage === 'startup') Buffer.from(JSON.stringify(result))
        const launchToFirstResultMs = performance.now() - launchStart
        const q = qualifyBaselineBrowser(testCase, result, preludes), row = rowFor(target, role, testCase, mode, round, sampleIndex)
        row.runtime = 'chromium:' + browser.version(); row.status = q.status; row.findings = q.findings; row.bytes = result.totalBytes ?? 0
        if (stage !== 'resource' && mode !== 'prelude-admission') row.samplesMs = [stage === 'startup' ? launchToFirstResultMs : result.consumedMs]
        row.metrics = { ...row.metrics, collectionId, accepted: result.accepted, actualApi: result.actualApi, qualificationScope: q.scope, excludedCallbacks: JSON.stringify(result.excludedCallbacks ?? []), sidecarsComplete: result.sidecarsComplete ?? false, publicApiMs: result.publicApiMs ?? null, consumedMs: result.consumedMs ?? null, moduleImportMs: initialized.moduleImportMs, initializationMs: initialized.initializationMs, launchToApiReadyMs, resolvedRenderOptions: JSON.stringify(result.resolvedRenderOptions ?? null), clock: stage === 'startup' ? plan.settings.startupClock : plan.settings.rendererClock, rolling, callbacksScope: 'Nonserializable bind/interaction callbacks recorded as exclusions; no DOM bind or pixel paint claim', renderOptionsScope: testCase.renderOptions ? 'Public options applied; effects unmeasured beyond authored SVG labels' : 'Pinned public site defaults' }
        if (!result.accepted) row.detail = String(result.error)
        collector.observations.push(row)
        return { result, row }
      }
      if (stage === 'renderer') {
        const offset = ((round - 1) * 11) % plan.cases.length, cases = [...plan.cases.slice(offset), ...plan.cases.slice(0, offset)]
        for (const testCase of cases) {
          await evaluate({ type: 'configure' })
          const preludes: { status: BenchmarkStatus; findings: string[] }[] = []
          for (const [index, prelude] of (testCase.prelude ?? []).entries()) {
            const admitted = await render({ id: testCase.id + ':prelude-' + index, family: testCase.family, source: prelude.source, expected: { accept: prelude.accept, labels: [] }, renderOptions: prelude.renderOptions, cohorts: ['prelude'] }, 'prelude-admission', index + 1)
            preludes.push({ status: admitted.row.status, findings: admitted.row.findings ?? [] })
            await evaluate({ type: 'release' })
          }
          await render(testCase, 'reused-page-render', sample, preludes)
          await evaluate({ type: 'release' })
        }
      } else {
        const returned = await render(startupCase, stage === 'startup' ? 'fresh-browser-first-result' : 'browser-document-resource')
        resourceResultRow = returned.row
        if (stage === 'resource') { await snapshot('afterConsumed'); await snapshot('outputHeldAfterGc', true); await evaluate({ type: 'release' }); await snapshot('afterConsumerReleaseAfterGc', true) }
      }
      const files = delivery(paths, target), initial = delivery(initialPaths, target), file = join(collector.directory, `${role}-${stage}-${round}-${sample}-browser.json`)
      write(file, { tool: target.tool, role, stage, round, sample, browser: browser.version(), snapshots, initialFiles: initial, files, blockedRequests, pageErrors, configuration: plan.settings.configuration })
      if (resourceResultRow) resourceResultRow.metrics = { ...resourceResultRow.metrics, rawEvidence: file }
      collector.artifacts.push(file)
      const metadata = rowFor(target, role, startupCase, stage === 'resource' ? 'browser-document-resource-checkpoints' : 'delivery', round, sample)
      metadata.runtime = 'chromium:' + browser.version(); metadata.operation = stage === 'resource' ? 'document-heap-checkpoints' : 'requested-module-closure'
      metadata.metrics = { ...metadata.metrics, checkpoint: stage, initialBytes: initial.reduce((sum, item) => sum + item.bytes, 0), deliveredBytes: files.reduce((sum, item) => sum + item.bytes, 0), perFileGzipBytes: files.reduce((sum, item) => sum + item.gzipBytes, 0), uniqueRequestedPaths: files.length, scope: stage === 'resource' ? plan.settings.memoryScope : plan.settings.deliveryScope, rawEvidence: file, rolling }
      collector.observations.push(metadata)
    } catch (error) {
      const row = rowFor(target, role, activeCase, 'context-failure:' + stage, round, sample)
      row.runtime = 'chromium:' + browser.version(); row.status = 'failed'; row.detail = String(error); collector.observations.push(row)
    } finally { if (context) await context.close(); await browser.close() }
  }
  try {
    if (collectors.size) {
      for (let round = 1; round <= plan.settings.rendererRounds; round++) {
        const roles = activeRoles(round); executionPlan.push({ stage: 'renderer', round, sample: 1, roles })
        for (const role of roles) await contextRun(role, 'renderer', round, 1)
      }
      const samplesPerRound = plan.settings.mode === 'full' ? 5 : 1
      for (let round = 1; round <= plan.settings.rendererRounds; round++) for (let sample = 1; sample <= samplesPerRound; sample++) {
        const roles = activeRoles(round, sample); executionPlan.push({ stage: 'startup', round, sample, roles })
        for (const role of roles) await contextRun(role, 'startup', round, sample)
      }
      for (let round = 1; round <= plan.settings.resourcePassesPerRole; round++) {
        const roles = activeRoles(round); executionPlan.push({ stage: 'resource', round, sample: 1, roles })
        for (const role of roles) await contextRun(role, 'resource', round, 1)
      }
    }
    for (const collector of collectors.values()) {
      collector.gaps.push('Admission proves XML/namespace/canvas/authored labels only; native relationships and CSS/paint fidelity unmeasured.', 'Document V8 heap excludes native/GPU/worker/whole-browser process peak. No monetary/model-token cost inferred.', 'A0/A1 are same-artifact controls, not independent tools. Five renderer rounds provide repeatability diagnostics, not p95 or causal proof.')
      const result: BaselineBrowserReport = { id: 'pinned-browser-baseline', status: collector.observations.some(row => row.status === 'failed') ? 'failed' : 'blocked', startedAt: collector.startedAt, finishedAt: new Date().toISOString(), observations: collector.observations, gaps: collector.gaps, artifacts: collector.artifacts, settings: plan.settings, identities: [collector.identity], cases: plan.cases, executionPlan, rolling, collectionId }
      write(join(collector.directory, 'browser-baseline-result.json'), result); collector.resolve(result)
    }
    const results = await Promise.all(tickets)
    const windows = new Set(results.map(result => (result as BaselineBrowserReport).collectionId).filter(Boolean)), sameWindow = windows.size === 1 && results.every(result => (result as BaselineBrowserReport).collectionId) && plan.selected.length === plan.identities.length
    const report: BaselineBrowserReport = { id: 'pinned-browser-baseline', status: results.some(result => result.status === 'failed') ? 'failed' : 'blocked', startedAt, finishedAt: new Date().toISOString(), observations: results.flatMap(result => result.observations) as BaselineBrowserObservation[], gaps: [...new Set(results.flatMap(result => result.gaps))], artifacts: results.flatMap(result => result.artifacts ?? []), settings: plan.settings, identities: plan.identities, cases: plan.cases, executionPlan, rolling: !sameWindow, ...(sameWindow ? { collectionId: [...windows][0] } : {}) }
    writeBenchmarkDocument(join(options.out, 'result.json'), report)
    return report
  } catch (error) { for (const collector of collectors.values()) collector.reject(error); await Promise.allSettled(tickets); throw error }
  finally { await new Promise<void>(resolveClose => server.close(() => resolveClose())) }
}

if (import.meta.main) {
  const values: Record<string, string> = {}, flags = new Set<string>()
  for (let index = 2; index < process.argv.length; index++) { const key = process.argv[index]!.replace(/^--/, ''); if (key === 'force') flags.add(key); else values[key] = process.argv[++index]! }
  for (const key of ['out', 'agentic-root', 'pele-root', 'reference-root', 'upstream-root']) if (!values[key]) throw Error('Required explicit flag: --' + key)
  const result = await runBaselineBrowserSuite({ root: values.root ?? resolve(dirname(fileURLToPath(import.meta.url)), '../../..'), out: resolve(values.out!), agenticRoot: resolve(values['agentic-root']!), peleRoot: resolve(values['pele-root']!), referenceRoot: resolve(values['reference-root']!), upstreamRoot: resolve(values['upstream-root']!), browserExecutable: values.browser, nodeExecutable: values.node, records: values.records, force: flags.has('force'), projects: values.projects?.split(','), mode: (values.mode ?? 'plan') as BaselineBrowserOptions['mode'], rounds: values.rounds ? Number(values.rounds) : undefined })
  process.stdout.write(JSON.stringify({ status: result.status, observations: result.observations.length, out: values.out, rolling: result.rolling }) + '\n')
}
