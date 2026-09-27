import type { WebsitePayloadBudgets } from './website-payload-authority.ts'

/** Baseline ceilings are ratchets: optimization PRs may lower one route's
 * values, but measurement logic and unrelated routes stay unchanged. */
export const WEBSITE_PAYLOAD_BUDGETS: WebsitePayloadBudgets = Object.freeze({
  home: Object.freeze({
    maxRequests: 9,
    maxRawBytes: 683_000,
    // Timeline literal-label SVG output adds a few hundred bytes to the
    // existing homepage request graph; exact Linux totals live in the baseline.
    maxGzipBytes: 406_650,
    maxBrotliBytes: 388_250,
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
    maxRawBytes: 392_000,
    // Authored Class member display changes compression by one byte while
    // leaving the route graph and raw bytes unchanged.
    maxGzipBytes: 68_700,
    maxBrotliBytes: 54_550,
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
    // The shared accDescr scanner removes one lazy chunk without changing
    // rendered pixels; the unclosed-block guard, inline-empty-Class-body
    // recognition, and literal Class-member Scene fidelity add a few bytes.
    // These are measured Linux/x64 and
    // macOS/arm64 ceilings; exact Linux totals are pinned in the baseline.
    // Pie's authored-label identity bridge adds 154 raw / 27 gzip bytes to
    // the shared render waist without changing the request graph.
    // Pie's bounded numeric-entity key prepass adds a small shared parser
    // chunk; the exact Linux totals remain pinned in the generated baseline.
    // The title-directive bridge reached 733,574 raw demo bytes on Linux/x64;
    // keep a sub-0.1% ceiling margin for regenerated bundle metadata.
    // Flowchart edge-class paint plus bounded fixed-size markers reach 734,628
    // Linux raw bytes on the shared lazy path; the request graph is unchanged.
    // Timeline literal-text Scene validation keeps the same request graph;
    // Linux/x64 measures 735,369 raw / 275,828 gzip / 251,742 Brotli bytes.
    // The bounded Timeline Scene wrapper check and width loop remain in the
    // existing lazy graph; Linux/x64 measured 735,792 raw / 275,963 gzip.
    maxRawBytes: 735_950,
    maxGzipBytes: 276_050,
    maxBrotliBytes: 251_900,
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
    // Pie's source-aware entity projection adds under 0.1% to the complete
    // editor bundle while retaining the fixed two-request graph.
    // Pie's terminal projection and source-aware title display add a small
    // shared-editor import; the complete two-request graph stays fixed.
    // The complete HTML5 named-reference table for Pie raises the all-family
    // editor bundle, but does not add a request or affect the lazy demo path.
    // Linux/x64 captured 3,392,643 raw / 1,008,476 gzip / 796,046 Brotli;
    // Authored Pie literal-metrics metadata adds 439 raw bytes on Linux/x64;
    // the two-request editor graph is unchanged and the raw ceiling retains
    // less than 0.01% headroom above the measured 3,393,082 bytes.
    // ER multi-class lexing/paint adds no request. The audited linear class
    // accumulator measured 3,394,056 raw / 1,009,119 gzip / 796,614 Brotli
    // on Linux/x64; exact hashes and totals are pinned in the baseline.
    // XYChart's fail-loud unknown-statement guard remains in these two
    // requests; Linux/x64 measured 3,394,044 raw / 1,009,119 gzip /
    // 796,674 Brotli, within the existing narrow ceilings.
    // Authored edge-class propagation and fixed-size marker variants reach
    // 3,394,829 raw / 1,009,358 gzip Linux bytes in the two-request editor.
    // Timeline's shared event-separator validation and upstream trailing-colon
    // guard measure 3,395,107 raw / 1,009,488 gzip bytes on Linux/x64. The
    // two-request graph stays fixed and both ceilings retain under 0.01% slack.
    // The shared Scene literal-text guard measures 3,395,922 raw and
    // 1,009,850 gzip bytes with the same two editor requests.
    // The same validation adds no editor request; Linux/x64 measured
    // 3,396,365 raw / 1,010,031 gzip bytes.
    maxRawBytes: 3_396_550,
    // Timeline semantic line-break normalization previously measured 1,009,565
    // gzip bytes. The shared literal-text Scene guard now measures 1,009,850
    // on Linux/x64; retain 150 bytes of headroom with no new requests.
    maxGzipBytes: 1_010_150,
    // Pie's escaped-LF painted-text projection stays in the existing two
    // requests. The tab-aware linear scanner measured 3,393,328 raw /
    // 1,008,710 gzip / 796,392 Brotli on Linux/x64; retain the narrow
    // cross-platform ceiling.
    maxBrotliBytes: 797_200,
    required: Object.freeze(['^/editor/$', '^/editor/editor-[a-f0-9]{12}\\.js$']),
    forbidden: Object.freeze([]),
  }),
})
