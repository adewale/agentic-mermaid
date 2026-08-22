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
  websitePayloadRecordingToolchainMatches,
  type WebsitePayloadReport,
} from '../../scripts/site/website-payload-authority.ts'
import { WEBSITE_PAYLOAD_BUDGETS } from '../../scripts/site/website-payload-budgets.ts'
import { ensureWebsiteBuilt } from './website-public-fixture.ts'

ensureWebsiteBuilt()

const REPO = join(import.meta.dir, '..', '..')
const PUBLIC = join(REPO, 'website', 'public')
const report = JSON.parse(readFileSync(join(REPO, 'eval', 'website-payload', 'baseline.json'), 'utf8')) as WebsitePayloadReport

// The baseline records the toolchain that produced it. Different Bun versions
// emit byte-different bundles from identical sources, and d3-sankey exposed the
// same effect across operating systems and CPU architectures on Bun 1.3.13.
// Comparing locally built bytes against the recorded ones is therefore only
// meaningful on the recorded Bun version, platform, and architecture; elsewhere
// the check reports the toolchain mismatch instead of a false payload regression.
//
// This does NOT weaken the gate on the recording toolchain (CI), where every
// exact byte, hash, and total is still compared. Off it, the byte comparison is
// skipped VISIBLY rather than softened. The route budgets keep running and use
// reviewed cross-platform ceilings. A tolerance in the exact comparator would hide
// whether a delta came from the toolchain or a real regression, so there is no
// pretend approximation there. Route coverage and budget verification remain
// platform-independent and keep running everywhere.
const RECORDED_BUN = report.toolchain.bun
const RECORDED_PLATFORM = report.toolchain.platform
const RECORDED_ARCH = report.toolchain.arch
const ON_RECORDING_TOOLCHAIN = websitePayloadRecordingToolchainMatches(
  { bun: RECORDED_BUN, platform: RECORDED_PLATFORM, arch: RECORDED_ARCH },
  { bun: Bun.version, platform: process.platform, arch: process.arch },
)
const TOOLCHAIN_NOTE = `built with Bun ${Bun.version} on ${process.platform}/${process.arch}, baseline recorded with Bun ${RECORDED_BUN} on ${RECORDED_PLATFORM}/${RECORDED_ARCH}`

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
    expect(report.toolchain.platform).not.toBeEmpty()
    expect(report.toolchain.arch).not.toBeEmpty()
    for (const route of report.routes) {
      const budget = WEBSITE_PAYLOAD_BUDGETS[route.id]!
      expect(route.totals.requests, `${route.id} requests`).toBeLessThanOrEqual(budget.maxRequests)
      expect(route.totals.rawBytes, `${route.id} rawBytes`).toBeLessThanOrEqual(budget.maxRawBytes)
      expect(route.totals.gzipBytes, `${route.id} gzipBytes`).toBeLessThanOrEqual(budget.maxGzipBytes)
      expect(route.totals.brotliBytes, `${route.id} brotliBytes`).toBeLessThanOrEqual(budget.maxBrotliBytes)
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

  test('requires the recorded Bun version, platform, and architecture for exact-byte comparisons', () => {
    const recorded = { bun: '1.2.3', platform: 'linux' as const, arch: 'x64' as const }
    expect(websitePayloadRecordingToolchainMatches(recorded, recorded)).toBe(true)
    expect(websitePayloadRecordingToolchainMatches(recorded, { ...recorded, bun: '1.2.4' })).toBe(false)
    expect(websitePayloadRecordingToolchainMatches(recorded, { ...recorded, platform: 'darwin' })).toBe(false)
    expect(websitePayloadRecordingToolchainMatches(recorded, { ...recorded, arch: 'arm64' })).toBe(false)
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
