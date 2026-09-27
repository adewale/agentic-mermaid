import type { WebsitePayloadBudgets } from './website-payload-authority.ts'

/** Baseline ceilings are ratchets: optimization PRs may lower one route's
 * values, but measurement logic and unrelated routes stay unchanged. */
export const WEBSITE_PAYLOAD_BUDGETS: WebsitePayloadBudgets = Object.freeze({
  home: Object.freeze({
    maxRequests: 9,
    maxRawBytes: 685_098,
    // The marker-reference change updates generated homepage SVG bytes without
    // adding a request; gzip is unchanged and the other exact totals are pinned.
    // Holding every family's text to the chart-honesty contract (root-scoped
    // SVG styles with a 64-bit scope class, text tones that clear AA on every
    // surface, and label halos) adds 2,453 raw, 433 gzip, and 398 Brotli bytes
    // to the prerendered homepage SVGs; the request graph is unchanged.
    maxGzipBytes: 406_998,
    maxBrotliBytes: 388_394,
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
    // The chart-honesty text contract adds 4,130 raw, 558 gzip, and 509 Brotli
    // bytes to the prerendered examples page without adding a request.
    maxRawBytes: 395_665,
    // Authored Class member display changes compression by one byte while
    // leaving the route graph and raw bytes unchanged.
    maxGzipBytes: 69_165,
    maxBrotliBytes: 54_902,
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
    maxRequests: 29,
    // The shared accDescr scanner removes one lazy chunk without changing
    // rendered pixels; the unclosed-block guard, inline-empty-Class-body
    // recognition, and literal Class-member Scene fidelity add a few bytes.
    // These are measured Linux/x64 and
    // macOS/arm64 ceilings; exact Linux totals are pinned in the baseline.
    // The chart-honesty text contract, with its checks that name an invalid
    // authored color, adds 7,861 raw, 3,098 gzip, and 2,442 Brotli bytes to the
    // shared chunks, and its module moves regroup the small shared chunks, so
    // the graph drops from 30 to 29 requests. Each ceiling keeps main's
    // allowance above the Linux total for the macOS recording.
    maxRawBytes: 740_374,
    maxGzipBytes: 277_849,
    maxBrotliBytes: 253_281,
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
    // The Journey extension audit fixes retain authored line provenance and
    // move extension evidence outside the upstream capability projection.
    // The shared accDescr scanner, unclosed-block guard, and inline-empty-Class
    // recognition leave the two-request graph unchanged. Exact Linux totals
    // are pinned in the baseline.
    // Authored Class member text and complete literal Scene fidelity raise the
    // complete Bun 1.4.2 editor bundle without changing its two-request graph.
    // The shared Sequence marker-spacing parser raises the reviewed ceilings by
    // 198 raw and 32 gzip bytes. The measured Linux total rises 229 raw bytes
    // with no additional requests; gzip remains under its reviewed ceiling.
    // Sender-side central-marker support and its Mermaid-invalid-form guards
    // keep the two-request graph fixed. The guarded parser adds 581 raw editor
    // bytes versus the earlier capture. These ceilings remain within 0.1% of
    // the current Linux totals, which are pinned exactly in the baseline.
    // The chart-honesty contract (SVG style scoping, per-bar data labels,
    // contrast ink, palette repair, the LABELS_HIDDEN and
    // BAR_RANGE_EXCLUDES_ZERO lints, registered upstream config keys, and every
    // family's text tones, halos, titles, and containment, and the checks that
    // name an invalid authored color, the node-fill ink, and the
    // VALUES_OUTSIDE_RANGE lint) adds 25,422 raw, 9,431 gzip, and 6,902 Brotli
    // bytes to the Linux/x64 editor bundle without a new request. Each ceiling
    // keeps main's allowance above the Linux total.
    maxRawBytes: 3_381_422,
    maxGzipBytes: 995_931,
    maxBrotliBytes: 782_902,
    required: Object.freeze(['^/editor/$', '^/editor/editor-[a-f0-9]{12}\\.js$']),
    forbidden: Object.freeze([]),
  }),
})
