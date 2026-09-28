import { describe, expect, test } from 'bun:test'
import { join, normalize, sep } from 'node:path'
import {
  WEBSITE_PAYLOAD_AUTHORITY,
  WEBSITE_PAYLOAD_COMPRESSION,
  WEBSITE_PAYLOAD_OBSERVATION_MS,
  WEBSITE_PAYLOAD_ROUTES,
  WEBSITE_PAYLOAD_SCHEMA_VERSION,
  publicRequestPathToFile,
  verifyWebsitePayloadBudgets,
  websitePayloadCaptureProblems,
  type WebsitePayloadReport,
} from '../../scripts/site/website-payload-authority.ts'
import { WEBSITE_PAYLOAD_BUDGETS } from '../../scripts/site/website-payload-budgets.ts'

const REPO = join(import.meta.dir, '..', '..')
const PUBLIC = join(REPO, 'website', 'public')

// A synthetic capture that satisfies every route budget. The live capture is
// checked against the same budgets by `bun run website:payload:check` in the
// browser lane; these tests exercise the checker itself.
const SAMPLE_REQUESTS: Record<string, string[]> = {
  home: ['/', '/styles.css', '/fonts/Inter-Regular.subset-0123456789ab.woff2', '/fonts/Inter-Medium.subset-0123456789ab.woff2'],
  examples: ['/examples/', '/styles.css', '/examples-0123456789ab.js', '/examples-0123456789ab.css'],
  demo: ['/demo/', '/demo/browser-lazy/index-0123456789ab.js', '/demo/browser-lazy/chunks/timeline-ABCD2345.js', '/generated/inline-0123456789ab.js'],
  'editor-empty': ['/editor/', '/editor/editor-0123456789ab.js'],
}

function sampleReport(): WebsitePayloadReport {
  return {
    schemaVersion: WEBSITE_PAYLOAD_SCHEMA_VERSION,
    authority: WEBSITE_PAYLOAD_AUTHORITY,
    compression: WEBSITE_PAYLOAD_COMPRESSION,
    capture: { observationAfterReadyMs: WEBSITE_PAYLOAD_OBSERVATION_MS },
    toolchain: { bun: Bun.version, playwright: 'test', chromium: 'test', platform: process.platform, arch: process.arch },
    routes: WEBSITE_PAYLOAD_ROUTES.map(route => {
      const budget = WEBSITE_PAYLOAD_BUDGETS[route.id]!
      const requests = SAMPLE_REQUESTS[route.id]!.map(path => ({ path, count: 1, sha256: '0'.repeat(64), rawBytes: 1, gzipBytes: 1, brotliBytes: 1 }))
      return {
        id: route.id,
        url: route.url,
        viewport: { ...route.viewport },
        requests,
        totals: {
          requests: requests.length,
          rawBytes: Math.floor(budget.maxRawBytes / 2),
          gzipBytes: Math.floor(budget.maxGzipBytes / 2),
          brotliBytes: Math.floor(budget.maxBrotliBytes / 2),
        },
      }
    }),
  }
}
const report = sampleReport()

function independentPublicFile(requestPath: string): string {
  const pathname = new URL(requestPath, 'https://independent.invalid').pathname
  const relative = pathname === '/' ? 'index.html' : pathname.slice(1).replace(/\/$/, '/index.html')
  const absolute = normalize(join(PUBLIC, decodeURIComponent(relative)))
  if (!absolute.startsWith(normalize(PUBLIC) + sep)) throw new Error(`independent path escape: ${requestPath}`)
  return absolute
}

describe('website payload budget authority', () => {
  test('every captured route has a budget and the sample capture satisfies all of them', () => {
    expect(Object.keys(WEBSITE_PAYLOAD_BUDGETS).sort()).toEqual(WEBSITE_PAYLOAD_ROUTES.map(route => route.id).sort())
    expect(verifyWebsitePayloadBudgets(report, WEBSITE_PAYLOAD_BUDGETS)).toEqual([])
  })

  test('rejects every budget dimension, eager forbidden resources, and missing required resources', () => {
    for (const field of ['requests', 'rawBytes', 'gzipBytes', 'brotliBytes'] as const) {
      const grown = structuredClone(report)
      const home = grown.routes[0]!
      const budgetField = {
        requests: 'maxRequests',
        rawBytes: 'maxRawBytes',
        gzipBytes: 'maxGzipBytes',
        brotliBytes: 'maxBrotliBytes',
      } as const
      const limit = WEBSITE_PAYLOAD_BUDGETS.home![budgetField[field]]
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

  test('reports invalid browser captures', () => {
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
