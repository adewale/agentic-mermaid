import type { WebsitePayloadBudgets } from './website-payload-authority.ts'

/** Route budgets checked on every PR by `bun run website:payload:check`.
 *
 * maxRequests, required, and forbidden are the structural contract: which
 * resources each route may and must load. Byte ceilings sit about 5% above the
 * measured Linux/Bun 1.4.2 totals so ordinary changes do not need a ceiling bump;
 * per-PR growth is judged against the base branch by scripts/ci/payload-delta.ts.
 * Raise a ceiling deliberately when growth accumulates; lower one after an
 * optimization. */
export const WEBSITE_PAYLOAD_BUDGETS: WebsitePayloadBudgets = Object.freeze({
  home: Object.freeze({
    maxRequests: 9,
    maxRawBytes: 718_000,
    maxGzipBytes: 427_000,
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
    // The six new stable-family examples add build-time SVG/HTML. The 23-family
    // gallery measures 481,905 raw / 80,386 gzip / 63,351 Brotli, with 5% headroom.
    maxRawBytes: 507_000,
    maxGzipBytes: 84_500,
    maxBrotliBytes: 66_600,
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
    maxRequests: 36,
    // Optional sketch code stays out of the default Timeline delivery graph.
    // Measured on macOS/Bun 1.4.2: 778,563 raw / 298,991 gzip / 272,548 Brotli.
    maxRawBytes: 780_000,
    maxGzipBytes: 300_000,
    // Shared cleanup provenance adds about 2.5 KB gzip; the per-PR delta
    // remains below 2%. Retain the same request graph and growth gate.
    maxBrotliBytes: 274_000,
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
    // Measured on macOS/Bun 1.4.2: 710,160 raw / 214,483 gzip / 184,291 Brotli.
    // Shared source provenance adds about 7.7 KB raw / 2.8 KB gzip.
    maxRawBytes: 712_000,
    maxGzipBytes: 215_000,
    maxBrotliBytes: 185_000,
    required: Object.freeze([
      '^/editor/$',
      '^/editor/editor-[a-f0-9]{12}\\.js$',
      '^/editor/runtime/browser-hosted-[a-z0-9]{8}\\.js$',
    ]),
    forbidden: Object.freeze([]),
  }),
})
