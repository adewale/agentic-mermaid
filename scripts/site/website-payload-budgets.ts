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
    // Authored Class member display changes compression by one byte while
    // leaving the route graph and raw bytes unchanged.
    maxGzipBytes: 68_607,
    maxBrotliBytes: 54_393,
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
    maxRawBytes: 734_000,
    maxGzipBytes: 275_300,
    maxBrotliBytes: 251_500,
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
    // Linux/x64 title-directive capture after the leading-space fix:
    // 3,360,477 raw / 988,202 gzip / 777,029 Brotli editor bytes. The
    // two-request graph is unchanged and all caps remain within 0.1%.
    maxRawBytes: 3_361_000,
    maxGzipBytes: 988_500,
    maxBrotliBytes: 777_300,
    required: Object.freeze(['^/editor/$', '^/editor/editor-[a-f0-9]{12}\\.js$']),
    forbidden: Object.freeze([]),
  }),
})
