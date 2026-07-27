import type { WebsitePayloadBudgets } from './website-payload-authority.ts'

/** Baseline ceilings are ratchets: optimization PRs may lower one route's
 * values, but measurement logic and unrelated routes stay unchanged. */
export const WEBSITE_PAYLOAD_BUDGETS: WebsitePayloadBudgets = Object.freeze({
  home: Object.freeze({
    maxRequests: 9,
    maxRawBytes: 682_619,
    maxGzipBytes: 406_566,
    // Re-recorded exactly for 0.3.1. The raw total is unchanged; the same-length
    // projected version string slightly improves compression. These ceilings
    // intentionally match the checked-in payload capture for this toolchain.
    maxBrotliBytes: 387_928,
    required: Object.freeze([
      '^/$', '^/styles\\.css$',
      '^/fonts/Inter-Regular\\.subset-[a-f0-9]{12}\\.woff2$',
      '^/fonts/Inter-Medium\\.subset-[a-f0-9]{12}\\.woff2$',
    ]),
    forbidden: Object.freeze(['/examples/fragments/', '/editor/editor-', '^/fonts/Inter-.*\\.ttf$']),
  }),
  examples: Object.freeze({
    maxRequests: 6,
    maxRawBytes: 380_391,
    maxGzipBytes: 66_937,
    // The 0.3.1 release identity changes only compressed back-references on
    // this route; raw and gzip totals remain byte-for-byte at their ratchets.
    maxBrotliBytes: 53_151,
    required: Object.freeze([
      '^/examples/$', '^/styles\\.css$', '^/examples-[a-f0-9]{12}\\.js$', '^/examples-[a-f0-9]{12}\\.css$',
    ]),
    forbidden: Object.freeze(['/examples/fragments/', '^/fonts/Inter-.*\\.ttf$']),
  }),
  demo: Object.freeze({
    // The lazy Timeline graph uses more cacheable requests than the monolith,
    // but avoids every other family and the shared ELK chunk. Exact byte totals
    // are ratcheted from the browser capture below, including the canonical
    // appearance path shared with the complete browser bundle.
    maxRequests: 30,
    maxRawBytes: 718_098,
    maxGzipBytes: 269_734,
    maxBrotliBytes: 246_214,
    required: Object.freeze([
      '^/demo/$',
      '^/demo/browser-lazy/index-[a-f0-9]{12}\\.js$',
      '^/demo/browser-lazy/chunks/timeline-[A-Z0-9]{8}\\.js$',
      '^/generated/inline-[a-f0-9]{12}\\.js$',
    ]),
    forbidden: Object.freeze(['/examples/fragments/', '/editor/editor-', '^/demo/browser-[a-f0-9]{12}\\.js$']),
  }),
  'editor-empty': Object.freeze({
    maxRequests: 2,
    // The editor still exercises the complete API; BUILD-31's registry seam
    // accounts for this bounded compatibility-path delta. These exact totals
    // include the shared code-point comparator used by family routing.
    maxRawBytes: 3_289_905,
    maxGzipBytes: 967_139,
    maxBrotliBytes: 760_057,
    required: Object.freeze(['^/editor/$', '^/editor/editor-[a-f0-9]{12}\\.js$']),
    forbidden: Object.freeze([]),
  }),
})
