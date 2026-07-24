import type { WebsitePayloadBudgets } from './website-payload-authority.ts'

/** Baseline ceilings are ratchets: optimization PRs may lower one route's
 * values, but measurement logic and unrelated routes stay unchanged. */
export const WEBSITE_PAYLOAD_BUDGETS: WebsitePayloadBudgets = Object.freeze({
  home: Object.freeze({
    maxRequests: 9,
    maxRawBytes: 682_608,
    maxGzipBytes: 405_988,
    maxBrotliBytes: 388_061,
    required: Object.freeze(['^/$', '^/styles\\.css$', '^/fonts/Inter-Regular\\.subset-[a-f0-9]{12}\\.woff2$', '^/fonts/Inter-Medium\\.subset-[a-f0-9]{12}\\.woff2$']),
    forbidden: Object.freeze(['/examples/fragments/', '/editor/editor-', '^/fonts/Inter-.*\\.ttf$']),
  }),
  examples: Object.freeze({
    maxRequests: 6,
    maxRawBytes: 389_584,
    maxGzipBytes: 68_117,
    maxBrotliBytes: 54_250,
    required: Object.freeze(['^/examples/$', '^/styles\\.css$', '^/examples-[a-f0-9]{12}\\.js$', '^/examples-[a-f0-9]{12}\\.css$']),
    forbidden: Object.freeze(['/examples/fragments/', '^/fonts/Inter-.*\\.ttf$']),
  }),
  'editor-empty': Object.freeze({
    maxRequests: 2,
    maxRawBytes: 3_314_070,
    maxGzipBytes: 983_405,
    maxBrotliBytes: 766_724,
    required: Object.freeze(['^/editor/$', '^/editor/editor-[a-f0-9]{12}\\.js$']),
    forbidden: Object.freeze([]),
  }),
})
