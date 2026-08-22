import type { WebsitePayloadBudgets } from './website-payload-authority.ts'

/** Baseline ceilings are ratchets: optimization PRs may lower one route's
 * values, but measurement logic and unrelated routes stay unchanged. */
export const WEBSITE_PAYLOAD_BUDGETS: WebsitePayloadBudgets = Object.freeze({
  home: Object.freeze({
    maxRequests: 9,
    maxRawBytes: 682_619,
    // Re-recorded with the current generated payload; raw bytes and requests
    // are unchanged while cross-file compression improves slightly.
    maxGzipBytes: 406_565,
    maxBrotliBytes: 387_993,
    required: Object.freeze([
      '^/$', '^/styles\\.css$',
      '^/fonts/Inter-Regular\\.subset-[a-f0-9]{12}\\.woff2$',
      '^/fonts/Inter-Medium\\.subset-[a-f0-9]{12}\\.woff2$',
    ]),
    forbidden: Object.freeze(['/examples/fragments/', '/editor/editor-', '^/fonts/Inter-.*\\.ttf$']),
  }),
  examples: Object.freeze({
    maxRequests: 6,
    // Sixteenth-family enrollment adds the Sankey example and metadata to the
    // registry-driven gallery; no new request is introduced.
    maxRawBytes: 391_117,
    maxGzipBytes: 68_589,
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
    maxRequests: 30,
    // The shared lazy catalog now advertises Sankey; Timeline remains the only
    // family chunk fetched by this route and the request ceiling is unchanged.
    maxRawBytes: 725_390,
    maxGzipBytes: 271_572,
    // The same Bun build differs by three compressed bytes across Linux and
    // macOS; exact hashes remain enforced on the recorded Linux toolchain.
    maxBrotliBytes: 247_932,
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
    // The editor exercises the complete API, so its bounded delta includes the
    // Sankey parser/renderer, d3-sankey, and typed gradient-resource support —
    // and now the BELOW_READABLE_SIZE legibility gate (minLabelPx policy field
    // plus the shared warning builder) in the bundled PNG contract.
    maxRawBytes: 3_330_367,
    maxGzipBytes: 980_492,
    maxBrotliBytes: 769_608,
    required: Object.freeze(['^/editor/$', '^/editor/editor-[a-f0-9]{12}\\.js$']),
    forbidden: Object.freeze([]),
  }),
})
