import type { WebsitePayloadBudgets } from './website-payload-authority.ts'

/** Route budgets checked on every PR by `bun run website:payload:check`.
 *
 * maxRequests, required, and forbidden are the structural contract: which
 * resources each route may and must load. Byte ceilings follow the ceiling rule
 * in docs/project/website-payload-plan.md (measured + 5%, rounded up to 1,000
 * bytes; measured on Linux/Bun 1.4.4 for 0.5.7): they bound accumulated drift,
 * and per-PR growth is decided by scripts/ci/payload-delta.ts. */
export const WEBSITE_PAYLOAD_BUDGETS: WebsitePayloadBudgets = Object.freeze({
  home: Object.freeze({
    maxRequests: 9,
    maxRawBytes: 739_000,
    maxGzipBytes: 429_000,
    // Capped by the Brotli stop gate (70% of the pre-optimization 557,024
    // bytes; website-font-subsets.test.ts), not the usual 5% headroom.
    maxBrotliBytes: 389_900,
    required: Object.freeze([
      '^/$',
      '^/styles\\.css$',
      '^/fonts/Inter-Regular\\.subset-[a-f0-9]{12}\\.woff2$',
      '^/fonts/Inter-Medium\\.subset-[a-f0-9]{12}\\.woff2$',
    ]),
    forbidden: Object.freeze([
      '/examples/fragments/',
      '/editor/editor-',
      '^/fonts/Inter-.*\\.ttf$',
    ]),
  }),
  examples: Object.freeze({
    maxRequests: 6,
    maxRawBytes: 250_000,
    maxGzipBytes: 43_000,
    maxBrotliBytes: 34_000,
    required: Object.freeze([
      '^/examples/$',
      '^/styles\\.css$',
      '^/examples-[a-f0-9]{12}\\.js$',
      '^/examples-[a-f0-9]{12}\\.css$',
    ]),
    forbidden: Object.freeze([
      '/examples/fragments/',
      '^/fonts/Inter-.*\\.ttf$',
    ]),
  }),
  demo: Object.freeze({
    // Recorded native layout delivery used 38 requests; allow one more.
    maxRequests: 39,
    // Optional sketch code stays out of the default Timeline delivery graph.
    maxRawBytes: 753_000,
    maxGzipBytes: 292_000,
    maxBrotliBytes: 259_000,
    required: Object.freeze([
      '^/demo/$',
      '^/demo/browser-lazy/index-[a-f0-9]{12}\\.js$',
      '^/demo/browser-lazy/chunks/timeline-[A-Z0-9]{8}\\.js$',
      '^/generated/inline-[a-f0-9]{12}\\.js$',
    ]),
    forbidden: Object.freeze([
      '/examples/fragments/',
      '/editor/editor-',
      '^/demo/browser-[a-f0-9]{12}\\.js$',
    ]),
  }),
  'editor-empty': Object.freeze({
    maxRequests: 3,
    // App plus schema/bootstrap; engines and feature modules wait for work.
    maxRawBytes: 462_000,
    maxGzipBytes: 133_000,
    maxBrotliBytes: 115_000,
    required: Object.freeze([
      '^/editor/$',
      '^/editor/editor-[a-f0-9]{12}\\.js$',
      '^/editor/runtime/browser-hosted-[a-z0-9]{8}\\.js$',
    ]),
    forbidden: Object.freeze([]),
  }),
})
