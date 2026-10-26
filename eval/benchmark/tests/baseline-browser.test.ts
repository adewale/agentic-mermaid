import { expect, test } from 'bun:test'
import { createRequire } from 'node:module'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { baselineBrowserAction } from '../unified/baseline-browser-worker.mjs'
import { baselineBrowserCases, baselineRoleOrder, qualifyBaselineBrowser, unsupportedByFamilyProbe, type BaselineBrowserCase } from '../unified/baseline-browser.ts'
import type { BenchmarkObservation } from '../unified/types.ts'
import { runRetainedSuite } from '../unified/retained-suite.ts'
import { chromiumExecutable } from './helpers/environment.ts'

const witness: BaselineBrowserCase = { id: 'independent-label-witness', family: 'flowchart', source: 'flowchart LR\nA[Alpha] --> B[Beta]', cohorts: ['test'], expected: { accept: true, labels: ['Alpha', 'Beta'] } }
const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 40"><text>Alpha Beta</text></svg>'

test('full browser case identity admits optional edit preludes before collection and reuses the completed record', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'browser-baseline-identity-'))
  try {
    let collections = 0
    const options = {
      out: join(directory, 'out'), records: join(directory, 'records'),
      identity: () => ({ project: 'fixture/browser-baseline', lane: 'pinned-browser-baseline', protocol: { rendererRounds: 5, startupSamplesPerRole: 25, resourcePassesPerRole: 5, cases: baselineBrowserCases() }, artifact: { fixture: true }, measurement: { fixture: true } }),
      measure: async () => {
        collections++
        return { id: 'pinned-browser-baseline', status: 'passed' as const, startedAt: '2026-10-25T00:00:00Z', finishedAt: '2026-10-25T00:00:01Z', observations: [{ suite: 'pinned-browser-baseline', surface: 'fixture', runtime: 'fixture', family: 'flowchart', caseId: 'identity-admission', operation: 'prepare', format: 'json', mode: 'fixture', status: 'passed' as const }], gaps: [] }
      },
    }
    const first = await runRetainedSuite(options)
    expect(first.status).toBe('passed')
    expect(collections).toBe(1)
    const repeated = await runRetainedSuite(options)
    expect(repeated.observations).toEqual(first.observations)
    expect(collections).toBe(1)
    expect(JSON.parse(readFileSync(join(options.out, 'cache.json'), 'utf8')).reused).toBe(true)
  } finally { rmSync(directory, { recursive: true, force: true }) }
})

test('baseline public-result gate checks authored SVG independently and never treats infrastructure failure as expected rejection', () => {
  expect(qualifyBaselineBrowser(witness, { accepted: true, svg, sidecarsComplete: true }).status).toBe('passed')
  expect(qualifyBaselineBrowser(witness, { accepted: true, svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 40"><text>Wrong</text></svg>', sidecarsComplete: true }).status).toBe('failed')
  expect(qualifyBaselineBrowser(witness, { accepted: true, svg, sidecarsComplete: false, unsupportedSidecars: ['$.cycle'] }).status).toBe('failed')
  const invalid = { ...witness, expected: { accept: false, labels: [] } }
  expect(qualifyBaselineBrowser(invalid, { accepted: false, error: 'Error: Parse error on line 2: unexpected end of source', errorPhase: 'public-call' }).status).toBe('passed')
  expect(qualifyBaselineBrowser(invalid, { accepted: false, error: 'Network module load failed: parse diagram unavailable', errorPhase: 'public-call' }).status).toBe('failed')
  expect(qualifyBaselineBrowser(invalid, { accepted: false, error: 'Parse error', errorPhase: 'consumption' }).status).toBe('failed')
  expect(qualifyBaselineBrowser(invalid, { accepted: true, svg, sidecarsComplete: true }).status).toBe('failed')
  expect(qualifyBaselineBrowser(invalid, { accepted: false, error: 'BrowserFamilyDetectionError: Unsupported Mermaid family in async browser renderer: invalid', errorPhase: 'public-call' }).status).toBe('passed')
  expect(qualifyBaselineBrowser(invalid, { accepted: false, error: 'Error: SEQUENCE_UNSUPPORTED_STATEMENT: line 2: A->>', errorPhase: 'public-call' }).status).toBe('passed')
  for (const errorName of ['TypeError', 'ReferenceError', 'RangeError', 'AbortError', 'TimeoutError']) expect(qualifyBaselineBrowser(invalid, { accepted: false, errorName, error: `${errorName}: Cannot read parser state`, errorPhase: 'public-call' }).status).toBe('failed')
  expect(qualifyBaselineBrowser(witness, { accepted: true, svg, sidecarsComplete: true }, [{ status: 'failed', findings: ['Previous invalid source was accepted'] }])).toMatchObject({ status: 'blocked', findings: ['Authored prelude admission failed; final latency is diagnostic only', 'Previous invalid source was accepted'] })
  expect(qualifyBaselineBrowser(invalid, { accepted: false, errorName: 'Error', error: 'Error: parser backend was not configured', errorPhase: 'public-call' }).status).toBe('failed')
})

test('counterbalancing rotates all four roles and keeps sample order deterministic', () => {
  expect([1, 2, 3, 4, 5].map(round => baselineRoleOrder(round)[0])).toEqual(['mermaid-a0', 'agentic', 'pele', 'mermaid-a1', 'mermaid-a0'])
  expect(baselineRoleOrder(1, 2)).toEqual(baselineRoleOrder(2, 1))
  expect(new Set(baselineRoleOrder(4)).size).toBe(4)
})

test('real browser consumer includes module initialization and traverses Map/Set sidecars, while recording excluded callbacks', async () => {
  const require = createRequire(join(process.cwd(), 'eval/benchmark/package.json')), { chromium } = require('playwright')
  const browser = await chromium.launch({ headless: true, executablePath: chromiumExecutable })
  try {
    const page = await browser.newPage()
    const module = `await new Promise(r=>setTimeout(r,25));let calls=0,configuration;export default{async initialize(value){await new Promise(r=>setTimeout(r,25));configuration=value},async render(){if(++calls!==1)throw Error('Unexpected extra render/warmup');await new Promise(r=>setTimeout(r,25));return{svg:${JSON.stringify(svg)},bindFunctions(){},metadata:new Map([['large-payload','x'.repeat(4096)],['nested',new Set(['first','second'])],['security',configuration.securityLevel]])}}}`
    const ready = await page.evaluate(baselineBrowserAction, { type: 'initialize', kind: 'mermaid', url: 'data:text/javascript,' + encodeURIComponent(module), configuration: { startOnLoad: false, securityLevel: 'strict' } })
    expect(ready.moduleImportMs).toBeGreaterThanOrEqual(15)
    expect(ready.initializationMs).toBeGreaterThanOrEqual(15)
    expect(ready.moduleThroughReadyMs).toBeGreaterThanOrEqual(ready.moduleImportMs! + ready.initializationMs! - 2)
    const result = await page.evaluate(baselineBrowserAction, { type: 'render', source: witness.source, renderId: 'fixture' })
    expect(result.accepted).toBe(true)
    expect(result.publicApiMs).toBeGreaterThanOrEqual(15)
    expect(result.totalBytes).toBeGreaterThan(svg.length + 4096)
    expect(result.sidecarsComplete).toBe(true)
    expect(result.excludedCallbacks).toEqual(['$.bindFunctions'])
    const sidecars = JSON.parse(result.sidecarJson!)
    expect(sidecars.metadata.map).toContainEqual(['nested', { set: ['first', 'second'] }])
    expect(sidecars.metadata.map).toContainEqual(['security', 'strict'])
    expect(qualifyBaselineBrowser(witness, result).status).toBe('passed')
    await page.evaluate(baselineBrowserAction, { type: 'release' })
    expect(await page.evaluate(() => (globalThis as any).__baselineBrowserSink)).toBeUndefined()
    const repeated = await page.evaluate(baselineBrowserAction, { type: 'render', source: witness.source, renderId: 'fixture-2' })
    expect(repeated.accepted).toBe(false)
    expect(repeated.error).toContain('Unexpected extra render')
    await page.evaluate((svg: string) => {
      ;(globalThis as any).__baselineBrowser = { kind: 'agentic', method: 'renderMermaidSVGAsync', configuration: {}, api: { renderMermaidSVGAsync(_source: string, options: any) { if ('fontSize' in options) throw Error('Unknown top-level option fontSize'); return { svg, appliedFontSize: options.style.roles.node.fontSize } } } }
    }, svg)
    const configured = await page.evaluate(baselineBrowserAction, { type: 'render', source: witness.source, renderId: 'configured', renderOptions: { fontSize: 14 } })
    expect(configured.accepted).toBe(true)
    expect(JSON.parse(configured.sidecarJson!).appliedFontSize).toBe(14)
    expect(configured.resolvedRenderOptions).toEqual({ security: 'strict', style: { roles: { node: { fontSize: 14 }, edge: { fontSize: 14 }, group: { fontSize: 14 } } } })
  } finally { await browser.close() }
}, 20_000)

test('only a rejected canonical family case makes that family unsupported; rejection messages decide nothing', () => {
  const row = (caseId: string, family: string, accepted: boolean, detail = 'Error: Invalid mermaid header'): BenchmarkObservation => ({ suite: 'pinned-browser-baseline', surface: 'baseline-browser:pele', runtime: 'chromium', family, caseId, operation: 'public-svg', format: 'svg', mode: 'reused-page-render', status: accepted ? 'passed' : 'failed', detail, metrics: { accepted, expectedAccepted: true } })
  const rows = [row('family:pie', 'pie', false), row('scaling:pie:8', 'pie', false), row('family:flowchart', 'flowchart', true), row('adversarial:flowchart', 'flowchart', false, 'Error: unsupported graph direction')]
  expect(qualifyBaselineBrowser(witness, { accepted: false, error: 'Error: unsupported diagram', errorPhase: 'public-call' }).status).toBe('failed')
  unsupportedByFamilyProbe(rows)
  expect(rows.map(value => [value.caseId, value.status])).toEqual([['family:pie', 'unsupported'], ['scaling:pie:8', 'unsupported'], ['family:flowchart', 'passed'], ['adversarial:flowchart', 'failed']])
})
