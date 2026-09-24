import type { WebsitePayloadBudgets } from './website-payload-authority.ts'

/** Baseline ceilings are ratchets: optimization PRs may lower one route's
 * values, but measurement logic and unrelated routes stay unchanged. */
export const WEBSITE_PAYLOAD_BUDGETS: WebsitePayloadBudgets = Object.freeze({
  home: Object.freeze({
    maxRequests: 9,
    maxRawBytes: 684_338,
    // The marker-reference change updates generated homepage SVG bytes without
    // adding a request; gzip is unchanged and the other exact totals are pinned.
    // Holding every family's text to the chart-honesty contract (root-scoped
    // SVG styles, text tones that clear AA on every surface, and label halos)
    // adds 1,693 raw, 296 gzip, and 138 Brotli bytes to the prerendered
    // homepage SVGs; the request graph is unchanged.
    maxGzipBytes: 406_861,
    maxBrotliBytes: 388_134,
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
    // The chart-honesty text contract adds 2,731 raw, 423 gzip, and 346 Brotli
    // bytes to the prerendered examples page without adding a request.
    maxRawBytes: 394_266,
    maxGzipBytes: 69_029,
    maxBrotliBytes: 54_742,
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
    maxRequests: 28,
    // Timeline header diagnosis keeps the 31-request graph; these are the
    // reviewed Linux/x64 totals for the updated lazy browser chunk.
    // The chart-honesty text contract adds 4,983 raw, 1,637 gzip, and 1,159
    // Brotli bytes to the shared chunks, and its module moves regroup six small
    // shared chunks into three, so the graph drops to 28 requests.
    maxRawBytes: 737_182,
    maxGzipBytes: 276_336,
    maxBrotliBytes: 252_008,
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
    // The ER alias parser raises the reviewed Linux/x64 editor bundle by 419
    // raw, 158 gzip, and 261 Brotli bytes without a new request.
    // Timeline header diagnosis changes the editor bundle while retaining
    // the two-request graph; these are the reviewed Linux/x64 totals.
    // The chart-honesty contract (SVG style scoping, per-bar data labels,
    // contrast ink, palette repair, the LABELS_HIDDEN and
    // BAR_RANGE_EXCLUDES_ZERO lints, registered upstream config keys, and every
    // family's text tones, halos, titles, and containment) adds 21,201 raw,
    // 7,946 gzip, and 6,321 Brotli bytes without a new request.
    maxRawBytes: 3_366_925,
    maxGzipBytes: 993_599,
    maxBrotliBytes: 779_958,
    required: Object.freeze(['^/editor/$', '^/editor/editor-[a-f0-9]{12}\\.js$']),
    forbidden: Object.freeze([]),
  }),
})
