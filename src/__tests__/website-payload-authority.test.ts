import { describe, expect, test } from 'bun:test'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join, normalize, sep } from 'node:path'
import { brotliCompressSync, constants as zlibConstants, gzipSync } from 'node:zlib'
import {
  WEBSITE_PAYLOAD_COMPRESSION,
  WEBSITE_PAYLOAD_OBSERVATION_MS,
  WEBSITE_PAYLOAD_ROUTES,
  assertWebsitePayloadReportCurrent,
  publicRequestPathToFile,
  verifyWebsitePayloadBudgets,
  websitePayloadCaptureProblems,
  type WebsitePayloadReport,
} from '../../scripts/site/website-payload-authority.ts'
import { WEBSITE_PAYLOAD_BUDGETS } from '../../scripts/site/website-payload-budgets.ts'
import { ensureWebsiteBuilt } from './website-public-fixture.ts'

ensureWebsiteBuilt()

const REPO = join(import.meta.dir, '..', '..')
const PUBLIC = join(REPO, 'website', 'public')
const report = JSON.parse(readFileSync(join(REPO, 'eval', 'website-payload', 'baseline.json'), 'utf8')) as WebsitePayloadReport

// The baseline records the toolchain that produced it, and a different Bun
// emits a byte-different bundle from identical sources — 1.3.13 and 1.3.11
// differ by 11 bytes on the home document alone. Comparing locally built bytes
// against the recorded ones is therefore only meaningful on the recorded
// toolchain; elsewhere it reports a toolchain difference as a payload
// regression. The report already carried the fact needed to tell those apart
// and simply never consulted it.
//
// This does NOT weaken the gate on the recording toolchain (CI), where every
// exact byte, hash, and total is still compared. Off it, the byte comparison is
// skipped VISIBLY rather than softened: the budgets are ratcheted to zero
// headroom (each budget equals the recorded total exactly), so a "≤ budget"
// fallback would be just as toolchain-sensitive as equality, and any tolerance
// loose enough to absorb a toolchain delta would be loose enough to hide a real
// regression. There is no honest local approximation, so the test says so
// instead of pretending. Everything derived from the RECORDED report — route
// coverage, totals-versus-budget, and the budget verifier — is toolchain-
// independent and keeps running everywhere.
const RECORDED_BUN = report.toolchain.bun
const ON_RECORDING_TOOLCHAIN = Bun.version === RECORDED_BUN
const TOOLCHAIN_NOTE = `built with Bun ${Bun.version}, baseline recorded with Bun ${RECORDED_BUN}`

function independentPublicFile(requestPath: string): string {
  const pathname = new URL(requestPath, 'https://independent.invalid').pathname
  const relative = pathname === '/' ? 'index.html' : pathname.slice(1).replace(/\/$/, '/index.html')
  const absolute = normalize(join(PUBLIC, decodeURIComponent(relative)))
  if (!absolute.startsWith(normalize(PUBLIC) + sep)) throw new Error(`independent path escape: ${requestPath}`)
  return absolute
}

describe('deterministic website payload authority', () => {
  // Toolchain-independent: reads only the recorded report, so it guards route
  // coverage and the ratcheted budgets in every environment.
  test('the recorded report covers every route and matches the ratcheted budgets', () => {
    expect(report.routes.map(route => route.id)).toEqual(WEBSITE_PAYLOAD_ROUTES.map(route => route.id))
    expect(report.capture.observationAfterReadyMs).toBe(WEBSITE_PAYLOAD_OBSERVATION_MS)
    expect(report.toolchain.bun).not.toBeEmpty()
    expect(report.toolchain.playwright).not.toBeEmpty()
    expect(report.toolchain.chromium).not.toBeEmpty()
    for (const route of report.routes) {
      const budget = WEBSITE_PAYLOAD_BUDGETS[route.id]!
      expect(route.totals, route.id).toEqual({
        requests: budget.maxRequests,
        rawBytes: budget.maxRawBytes,
        gzipBytes: budget.maxGzipBytes,
        brotliBytes: budget.maxBrotliBytes,
      })
    }
    expect(verifyWebsitePayloadBudgets(report, WEBSITE_PAYLOAD_BUDGETS)).toEqual([])
  })

  test.skipIf(!ON_RECORDING_TOOLCHAIN)(`independently verifies every recorded byte, compression result, hash, and total (${TOOLCHAIN_NOTE})`, () => {
    const measurementCache = new Map<string, { sha256: string, rawBytes: number, gzipBytes: number, brotliBytes: number }>()
    for (const route of report.routes) {
      const totals = { requests: 0, rawBytes: 0, gzipBytes: 0, brotliBytes: 0 }
      for (const asset of route.requests) {
        let measured = measurementCache.get(asset.path)
        if (!measured) {
          const bytes = readFileSync(independentPublicFile(asset.path))
          measured = {
            sha256: createHash('sha256').update(bytes).digest('hex'),
            rawBytes: bytes.byteLength,
            gzipBytes: gzipSync(bytes, { level: WEBSITE_PAYLOAD_COMPRESSION.gzipLevel }).byteLength,
            brotliBytes: brotliCompressSync(bytes, { params: {
              [zlibConstants.BROTLI_PARAM_QUALITY]: WEBSITE_PAYLOAD_COMPRESSION.brotliQuality,
              [zlibConstants.BROTLI_PARAM_LGWIN]: WEBSITE_PAYLOAD_COMPRESSION.brotliLgwin,
            } }).byteLength,
          }
          measurementCache.set(asset.path, measured)
        }
        expect(measured, `${route.id} ${asset.path}`).toEqual({
          sha256: asset.sha256,
          rawBytes: asset.rawBytes,
          gzipBytes: asset.gzipBytes,
          brotliBytes: asset.brotliBytes,
        })
        totals.requests += asset.count
        totals.rawBytes += measured.rawBytes * asset.count
        totals.gzipBytes += measured.gzipBytes * asset.count
        totals.brotliBytes += measured.brotliBytes * asset.count
      }
      expect(totals, route.id).toEqual(route.totals)
    }
  }, 30_000)

  test('rejects every budget dimension, eager forbidden resources, and missing required resources', () => {
    for (const field of ['requests', 'rawBytes', 'gzipBytes', 'brotliBytes'] as const) {
      const grown = structuredClone(report)
      const home = grown.routes[0]!
      const limit = home.totals[field]
      home.totals[field] = limit + 1
      expect(verifyWebsitePayloadBudgets(grown, WEBSITE_PAYLOAD_BUDGETS), field).toContain(
        'home: ' + field + ' ' + (limit + 1) + ' exceeds ' + limit,
      )
    }

    const eager = structuredClone(report)
    eager.routes.find(route => route.id === 'examples')!.requests.push({
      path: '/examples/fragments/corpus-deadbeefdead.html', count: 1, sha256: '', rawBytes: 0, gzipBytes: 0, brotliBytes: 0,
    })
    expect(verifyWebsitePayloadBudgets(eager, WEBSITE_PAYLOAD_BUDGETS)).toContain('examples: requested forbidden /examples/fragments/')

    const missing = structuredClone(report)
    missing.routes.find(route => route.id === 'editor-empty')!.requests = []
    expect(verifyWebsitePayloadBudgets(missing, WEBSITE_PAYLOAD_BUDGETS)).toEqual(expect.arrayContaining([
      'editor-empty: missing required ^/editor/$',
      'editor-empty: missing required ^/editor/editor-[a-f0-9]{12}\\.js$',
    ]))

    const missingDemo = structuredClone(report)
    missingDemo.routes.find(route => route.id === 'demo')!.requests = []
    expect(verifyWebsitePayloadBudgets(missingDemo, WEBSITE_PAYLOAD_BUDGETS)).toEqual(expect.arrayContaining([
      'demo: missing required ^/demo/$',
      'demo: missing required ^/demo/browser-lazy/index-[a-f0-9]{12}\\.js$',
      'demo: missing required ^/demo/browser-lazy/chunks/timeline-[A-Z0-9]{8}\\.js$',
      'demo: missing required ^/generated/inline-[a-f0-9]{12}\\.js$',
    ]))
  })

  test('rejects stale reports and invalid browser captures', () => {
    const stale = structuredClone(report)
    stale.routes[0]!.requests[0]!.sha256 = 'stale'
    expect(() => assertWebsitePayloadReportCurrent(JSON.stringify(stale, null, 2) + '\n', report)).toThrow('Website payload report is stale')
    expect(() => assertWebsitePayloadReportCurrent(JSON.stringify(report, null, 2) + '\n', report)).not.toThrow()
    expect(websitePayloadCaptureProblems({
      failedRequests: ['net::ERR_FAILED /missing.js'],
      badResponses: ['404 /missing.js'],
      pageErrors: ['boom'],
    })).toEqual([
      'failed request: net::ERR_FAILED /missing.js',
      'non-success response: 404 /missing.js',
      'page error: boom',
    ])
  })

  test('independently maps route documents and fails closed on encoded traversal', () => {
    expect(independentPublicFile('/')).toBe(join(PUBLIC, 'index.html'))
    expect(independentPublicFile('/examples/')).toBe(join(PUBLIC, 'examples', 'index.html'))
    expect(independentPublicFile('/demo/')).toBe(join(PUBLIC, 'demo', 'index.html'))
    expect(independentPublicFile('/editor/')).toBe(join(PUBLIC, 'editor', 'index.html'))
    expect(independentPublicFile('/styles.css')).toBe(join(PUBLIC, 'styles.css'))
    expect(() => independentPublicFile('/..%2f..%2fpackage.json')).toThrow('independent path escape')
    expect(() => publicRequestPathToFile(PUBLIC, '/..%2f..%2fpackage.json')).toThrow('Payload request escapes website/public')
  })
})
