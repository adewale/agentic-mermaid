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
    // Prepared C4 text and the inherited root font rule measure 72,550 B gzip / 57,536 B Brotli.
    maxGzipBytes: 72_600,
    maxBrotliBytes: 57_600,
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
    maxRequests: 31,
    maxRawBytes: 783_000,
    maxGzipBytes: 295_000,
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
    // Native parser observations and final text/geometry checks also ship in
    // the editor: 3,667,915 raw / 1,111,755 gzip / 875,724 Brotli bytes.
    // Typed Scene serialization and bounded layout preference add 2,528 raw
    // bytes (902 gzip) on the same runner; per-change growth still gates.
    maxRawBytes: 3_674_000,
    maxGzipBytes: 1_113_000,
    maxBrotliBytes: 877_000,
    required: Object.freeze([
      '^/editor/$',
      '^/editor/editor-[a-f0-9]{12}\\.js$',
    ]),
    forbidden: Object.freeze([]),
  }),
})
