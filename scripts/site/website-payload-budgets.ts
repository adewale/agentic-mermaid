import type { WebsitePayloadBudgets } from './website-payload-authority.ts'

/** Baseline ceilings are ratchets: optimization PRs may lower one route's
 * values, but measurement logic and unrelated routes stay unchanged. */
export const WEBSITE_PAYLOAD_BUDGETS: WebsitePayloadBudgets = Object.freeze({
  home: Object.freeze({
    maxRequests: 9,
    // The marker-reference change updates generated homepage SVG bytes without
    // adding a request. Scoping each inline SVG's style rules to its own root
    // (so diagrams on one page cannot repaint each other) adds 1,259 raw,
    // 281 gzip, and 150 Brotli bytes of prefixed selectors to the prerendered
    // homepage SVGs; the request graph is unchanged.
    maxRawBytes: 683_904,
    maxGzipBytes: 406_846,
    maxBrotliBytes: 388_146,
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
    // The marker-reference change updates generated example metadata without
    // adding a request. Root-scoped inline SVG styles add 2,047 raw, 337 gzip,
    // and 266 Brotli bytes to the prerendered examples page.
    maxRawBytes: 393_177,
    maxGzipBytes: 68_916,
    maxBrotliBytes: 54_665,
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
    // The Sequence rect slice keeps the 31-request graph and raw total while
    // slightly reducing compressed bytes in the reviewed Linux/x64 capture.
    // Cached shape-profile validation and point ownership add 308 raw bytes to
    // the existing shared Timeline route; no request or family is added. The
    // shared SVG style scoper, the black-or-white ink rule, the sketch
    // backend's page ink, and the categorical palette's separation repair add
    // 2,420 raw, 949 gzip, and 759 Brotli bytes to the shared chunks; the
    // request graph is unchanged.
    // Exact hashes remain enforced on the recorded Linux toolchain.
    maxRawBytes: 732_122,
    maxGzipBytes: 274_602,
    maxBrotliBytes: 250_650,
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
    // The Sequence rect paint/frame code raises the reviewed Linux/x64 editor
    // bundle by 1,538 raw, 622 gzip, and 388 Brotli bytes without a new request.
    // editor bundle adds 14 raw and 9 gzip bytes while reducing Brotli by 96;
    // the two-request graph stays fixed. The chart-honesty fixes (SVG style
    // scoping, per-bar data labels, contrast ink, palette repair, the
    // LABELS_HIDDEN and BAR_RANGE_EXCLUDES_ZERO lints, and the registered
    // upstream config keys) add 7,022 raw, 2,821 gzip, and 2,169 Brotli bytes.
    maxRawBytes: 3_346_060,
    maxGzipBytes: 986_057,
    maxBrotliBytes: 774_399,
    required: Object.freeze(['^/editor/$', '^/editor/editor-[a-f0-9]{12}\\.js$']),
    forbidden: Object.freeze([]),
  }),
})
