import type { WebsitePayloadBudgets } from './website-payload-authority.ts'

/** Baseline ceilings are ratchets: optimization PRs may lower one route's
 * values, but measurement logic and unrelated routes stay unchanged. */
export const WEBSITE_PAYLOAD_BUDGETS: WebsitePayloadBudgets = Object.freeze({
  home: Object.freeze({
    maxRequests: 9,
    maxRawBytes: 682_645,
    // The marker-reference change updates generated homepage SVG bytes without
    // adding a request; gzip is unchanged and the other exact totals are pinned.
    maxGzipBytes: 406_565,
    maxBrotliBytes: 387_996,
    required: Object.freeze([
      '^/$', '^/styles\\.css$',
      '^/fonts/Inter-Regular\\.subset-[a-f0-9]{12}\\.woff2$',
      '^/fonts/Inter-Medium\\.subset-[a-f0-9]{12}\\.woff2$',
    ]),
    forbidden: Object.freeze(['/examples/fragments/', '/editor/editor-', '^/fonts/Inter-.*\\.ttf$']),
  }),
  examples: Object.freeze({
    maxRequests: 6,
    // Sequence half-arrow examples add bytes without changing the six-request
    // graph; these are the reviewed Linux/x64 totals.
    maxRawBytes: 391_535,
    maxGzipBytes: 68_606,
    maxBrotliBytes: 54_406,
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
    maxRequests: 31,
    // Sequence statement handling keeps the request graph; these ceilings
    // cover the larger of reviewed Linux/x64 and macOS/arm64 recordings.
    maxRawBytes: 732_000,
    maxGzipBytes: 275_000,
    maxBrotliBytes: 251_000,
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
    // The editor exercises the complete API. Shared Unicode identifier
    // validation is already in the base. The PNG legibility policy and shared
    // warning builder add 2,393 raw, 746 gzip, and 680 Brotli bytes. The rebased
    // editor bundle adds 14 raw and 9 gzip bytes while reducing Brotli by 96.
    // The public fidelity report changes the generated editor document; these
    // ceilings cover the larger of the Linux/x64 and macOS/arm64 recordings
    // while the exact Linux hashes and totals remain pinned in the baseline.
    // The browser adapter must stay mutable for the editor's render hooks;
    // its bundle change raises the editor Brotli total by 152 bytes. The
    // two-request graph stays fixed.
    // The shared Sequence statement splitter keeps the two-request graph;
    // these are the measured Linux/x64 and macOS/arm64 maxima.
    maxRawBytes: 3_343_000,
    maxGzipBytes: 985_000,
    maxBrotliBytes: 774_000,
    required: Object.freeze(['^/editor/$', '^/editor/editor-[a-f0-9]{12}\\.js$']),
    forbidden: Object.freeze([]),
  }),
})
