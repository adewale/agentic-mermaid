import type { WebsitePayloadBudgets } from './website-payload-authority.ts'

/** Baseline ceilings are ratchets: optimization PRs may lower one route's
 * values, but measurement logic and unrelated routes stay unchanged. */
export const WEBSITE_PAYLOAD_BUDGETS: WebsitePayloadBudgets = Object.freeze({
  home: Object.freeze({
    maxRequests: 9,
    maxRawBytes: 682_619,
    maxGzipBytes: 406_567,
    // 387_889 -> 388_564 (+675) from the 0.3.0 bump, with NO content added: the
    // homepage is byte-identical in size (264_916 raw both before and after) and
    // differs in exactly two characters, `0.2.0` -> `0.3.0` in the JSON-LD
    // softwareVersion and the footer. Raw and gzip are unchanged; only Brotli
    // moved, because those digits broke back-reference matches the old string
    // shared. Attributed by diffing the built homepage against origin/main.
    maxBrotliBytes: 388_564,
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
    maxBrotliBytes: 53_143,
    required: Object.freeze([
      '^/examples/$', '^/styles\\.css$', '^/examples-[a-f0-9]{12}\\.js$', '^/examples-[a-f0-9]{12}\\.css$',
    ]),
    forbidden: Object.freeze(['/examples/fragments/', '^/fonts/Inter-.*\\.ttf$']),
  }),
  demo: Object.freeze({
    maxRequests: 8,
    maxRawBytes: 3_172_915,
    maxGzipBytes: 1_002_825,
    maxBrotliBytes: 808_169,
    required: Object.freeze([
      '^/demo/$', '^/demo/browser-[a-f0-9]{12}\\.js$', '^/generated/inline-[a-f0-9]{12}\\.js$',
    ]),
    forbidden: Object.freeze(['/examples/fragments/', '/editor/editor-']),
  }),
  'editor-empty': Object.freeze({
    maxRequests: 2,
    maxRawBytes: 3_288_608,
    maxGzipBytes: 965_577,
    maxBrotliBytes: 760_028,
    required: Object.freeze(['^/editor/$', '^/editor/editor-[a-f0-9]{12}\\.js$']),
    forbidden: Object.freeze([]),
  }),
})
