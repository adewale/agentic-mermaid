import type { WebsitePayloadBudgets } from './website-payload-authority.ts'

/** Baseline ceilings are ratchets: optimization PRs may lower one route's
 * values, but measurement logic and unrelated routes stay unchanged. */
export const WEBSITE_PAYLOAD_BUDGETS: WebsitePayloadBudgets = Object.freeze({
  home: Object.freeze({
    maxRequests: 9,
    maxRawBytes: 1_252_938,
    maxGzipBytes: 642_665,
    maxBrotliBytes: 557_024,
    required: Object.freeze(['^/$', '^/styles\\.css$']),
    forbidden: Object.freeze(['/examples/fragments/', '/editor/editor-']),
  }),
  examples: Object.freeze({
    maxRequests: 11,
    maxRawBytes: 3_283_215,
    maxGzipBytes: 1_007_440,
    maxBrotliBytes: 821_122,
    required: Object.freeze(['^/examples/$', '^/styles\\.css$']),
    forbidden: Object.freeze(['/examples/fragments/']),
  }),
  'editor-empty': Object.freeze({
    maxRequests: 2,
    maxRawBytes: 3_314_199,
    maxGzipBytes: 974_886,
    maxBrotliBytes: 767_057,
    required: Object.freeze(['^/editor/$', '^/editor/editor-[a-f0-9]{12}\\.js$']),
    forbidden: Object.freeze([]),
  }),
})
