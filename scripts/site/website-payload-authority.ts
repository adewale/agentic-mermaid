import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { join, normalize, sep } from 'node:path'
import { brotliCompressSync, constants as zlibConstants, gzipSync } from 'node:zlib'
import { compareCodePointStrings } from '../../src/shared/deterministic-order.ts'

export const WEBSITE_PAYLOAD_SCHEMA_VERSION = 1
export const WEBSITE_PAYLOAD_AUTHORITY = 'deterministic-route-request-graph-v1'
export const WEBSITE_PAYLOAD_OBSERVATION_MS = 1_500
export const WEBSITE_PAYLOAD_COMPRESSION = Object.freeze({
  gzipLevel: 9,
  brotliQuality: 11,
  brotliLgwin: 22,
})

export const WEBSITE_PAYLOAD_ROUTES = Object.freeze([
  Object.freeze({ id: 'home', url: '/', viewport: Object.freeze({ width: 390, height: 844 }) }),
  Object.freeze({ id: 'examples', url: '/examples/', viewport: Object.freeze({ width: 390, height: 844 }) }),
  Object.freeze({ id: 'editor-empty', url: '/editor/?empty=1', viewport: Object.freeze({ width: 390, height: 844 }) }),
] as const)

export interface WebsitePayloadAsset {
  path: string
  count: number
  sha256: string
  rawBytes: number
  gzipBytes: number
  brotliBytes: number
}

export interface WebsitePayloadRouteReport {
  id: string
  url: string
  viewport: { width: number, height: number }
  requests: WebsitePayloadAsset[]
  totals: { requests: number, rawBytes: number, gzipBytes: number, brotliBytes: number }
}

export interface WebsitePayloadReport {
  schemaVersion: number
  authority: string
  compression: typeof WEBSITE_PAYLOAD_COMPRESSION
  capture: { observationAfterReadyMs: number }
  toolchain: { bun: string, playwright: string, chromium: string }
  routes: WebsitePayloadRouteReport[]
}

export interface WebsitePayloadRouteBudget {
  maxRequests: number
  maxRawBytes: number
  maxGzipBytes: number
  maxBrotliBytes: number
  required: readonly string[]
  forbidden: readonly string[]
}

export type WebsitePayloadBudgets = Readonly<Record<string, WebsitePayloadRouteBudget>>

export interface WebsitePayloadCaptureDiagnostics {
  failedRequests: readonly string[]
  badResponses: readonly string[]
  pageErrors: readonly string[]
}

export function websitePayloadCaptureProblems(diagnostics: WebsitePayloadCaptureDiagnostics): string[] {
  return [
    ...diagnostics.failedRequests.map(value => `failed request: ${value}`),
    ...diagnostics.badResponses.map(value => `non-success response: ${value}`),
    ...diagnostics.pageErrors.map(value => `page error: ${value}`),
  ]
}

export function assertWebsitePayloadReportCurrent(recorded: string, current: WebsitePayloadReport): void {
  if (recorded !== stablePayloadJson(current)) {
    throw new Error('Website payload report is stale; run bun run website:payload:write and review every route delta')
  }
}

export function measurePayloadBytes(bytes: Uint8Array) {
  const input = Buffer.from(bytes)
  return {
    sha256: createHash('sha256').update(input).digest('hex'),
    rawBytes: input.byteLength,
    gzipBytes: gzipSync(input, { level: WEBSITE_PAYLOAD_COMPRESSION.gzipLevel }).byteLength,
    brotliBytes: brotliCompressSync(input, {
      params: {
        [zlibConstants.BROTLI_PARAM_QUALITY]: WEBSITE_PAYLOAD_COMPRESSION.brotliQuality,
        [zlibConstants.BROTLI_PARAM_LGWIN]: WEBSITE_PAYLOAD_COMPRESSION.brotliLgwin,
      },
    }).byteLength,
  }
}

export function publicRequestPathToFile(publicRoot: string, requestPath: string): string {
  const pathname = new URL(requestPath, 'https://agentic-mermaid.invalid').pathname
  const decoded = decodeURIComponent(pathname)
  const relative = decoded === '/' ? 'index.html' : decoded.replace(/^\//, '').replace(/\/$/, '/index.html')
  const absolute = normalize(join(publicRoot, relative))
  const rootPrefix = normalize(publicRoot) + sep
  if (absolute !== normalize(join(publicRoot, 'index.html')) && !absolute.startsWith(rootPrefix)) {
    throw new Error(`Payload request escapes website/public: ${requestPath}`)
  }
  if (!existsSync(absolute)) throw new Error(`Payload request has no generated asset: ${requestPath} -> ${relative}`)
  return absolute
}

export function buildWebsitePayloadReport(
  publicRoot: string,
  captured: Readonly<Record<string, readonly string[]>>,
  toolchain: WebsitePayloadReport['toolchain'],
): WebsitePayloadReport {
  const routes = WEBSITE_PAYLOAD_ROUTES.map(route => {
    const counts = new Map<string, number>()
    for (const requestPath of captured[route.id] ?? []) counts.set(requestPath, (counts.get(requestPath) ?? 0) + 1)
    const requests = Array.from(counts, ([path, count]) => {
      const bytes = readFileSync(publicRequestPathToFile(publicRoot, path))
      return { path, count, ...measurePayloadBytes(bytes) }
    }).sort((left, right) => compareCodePointStrings(left.path, right.path))
    const totals = requests.reduce((sum, asset) => ({
      requests: sum.requests + asset.count,
      rawBytes: sum.rawBytes + asset.rawBytes * asset.count,
      gzipBytes: sum.gzipBytes + asset.gzipBytes * asset.count,
      brotliBytes: sum.brotliBytes + asset.brotliBytes * asset.count,
    }), { requests: 0, rawBytes: 0, gzipBytes: 0, brotliBytes: 0 })
    return { id: route.id, url: route.url, viewport: route.viewport, requests, totals }
  })
  return {
    schemaVersion: WEBSITE_PAYLOAD_SCHEMA_VERSION,
    authority: WEBSITE_PAYLOAD_AUTHORITY,
    compression: WEBSITE_PAYLOAD_COMPRESSION,
    capture: { observationAfterReadyMs: WEBSITE_PAYLOAD_OBSERVATION_MS },
    toolchain,
    routes,
  }
}

export function verifyWebsitePayloadBudgets(report: WebsitePayloadReport, budgets: WebsitePayloadBudgets): string[] {
  const problems: string[] = []
  if (report.schemaVersion !== WEBSITE_PAYLOAD_SCHEMA_VERSION) problems.push(`unsupported payload schema ${report.schemaVersion}`)
  if (report.authority !== WEBSITE_PAYLOAD_AUTHORITY) problems.push(`unexpected payload authority ${report.authority}`)
  for (const route of report.routes) {
    const budget = budgets[route.id]
    if (!budget) { problems.push(`${route.id}: missing budget`); continue }
    for (const [field, actual, maximum] of [
      ['requests', route.totals.requests, budget.maxRequests],
      ['rawBytes', route.totals.rawBytes, budget.maxRawBytes],
      ['gzipBytes', route.totals.gzipBytes, budget.maxGzipBytes],
      ['brotliBytes', route.totals.brotliBytes, budget.maxBrotliBytes],
    ] as const) if (actual > maximum) problems.push(`${route.id}: ${field} ${actual} exceeds ${maximum}`)
    const paths = route.requests.map(request => request.path)
    for (const pattern of budget.required) if (!paths.some(path => new RegExp(pattern).test(path))) problems.push(`${route.id}: missing required ${pattern}`)
    for (const pattern of budget.forbidden) if (paths.some(path => new RegExp(pattern).test(path))) problems.push(`${route.id}: requested forbidden ${pattern}`)
  }
  for (const id of Object.keys(budgets)) if (!report.routes.some(route => route.id === id)) problems.push(`${id}: budget has no route report`)
  return problems
}

export function stablePayloadJson(report: WebsitePayloadReport): string {
  return JSON.stringify(report, null, 2) + '\n'
}
