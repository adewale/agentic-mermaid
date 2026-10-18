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
    // The new C4 example contributes build-time SVG/HTML, not an eager runtime.
    maxRawBytes: 425_000,
    // C4's prepared legend heading and semantic swatches measured 72,546 B.
    maxGzipBytes: 72_600,
    maxBrotliBytes: 57_500,
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
    maxRequests: 29,
    maxRawBytes: 783_000,
    maxGzipBytes: 293_000,
    maxBrotliBytes: 267_500,
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
    maxRequests: 2,
    // The synchronous editor adapter includes all native graphical/terminal
    // families. With C4: 3,590,858 raw / 1,089,260 gzip / 859,297 Brotli bytes;
    // keep tight headroom. Per-change growth still has its own delta gate.
    maxRawBytes: 3_610_000,
    // Shared text preservation measured 1,096,447 gzip bytes; the per-PR
    // delta gate still checks growth against the actual base request graph.
    maxGzipBytes: 1_100_000,
    maxBrotliBytes: 865_000,
    required: Object.freeze([
      '^/editor/$',
      '^/editor/editor-[a-f0-9]{12}\\.js$',
    ]),
    forbidden: Object.freeze([]),
  }),
})
