import type { WebsitePayloadBudgets } from './website-payload-authority.ts'

/** Baseline ceilings are ratchets: optimization PRs may lower one route's
 * values, but measurement logic and unrelated routes stay unchanged. */
export const WEBSITE_PAYLOAD_BUDGETS: WebsitePayloadBudgets = Object.freeze({
  home: Object.freeze({
    maxRequests: 9,
    maxRawBytes: 682_619,
    maxGzipBytes: 406_567,
    maxBrotliBytes: 387_899,
    required: Object.freeze([
      '^/$', '^/styles\\.css$',
      '^/fonts/Inter-Regular\\.subset-[a-f0-9]{12}\\.woff2$',
      '^/fonts/Inter-Medium\\.subset-[a-f0-9]{12}\\.woff2$',
    ]),
    forbidden: Object.freeze(['/examples/fragments/', '/editor/editor-', '^/fonts/Inter-.*\\.ttf$']),
  }),
  examples: Object.freeze({
    maxRequests: 11,
    maxRawBytes: 2_426_844,
    maxGzipBytes: 648_659,
    maxBrotliBytes: 564_048,
    required: Object.freeze([
      '^/examples/$', '^/styles\\.css$',
      '^/fonts/Inter-Medium\\.subset-[a-f0-9]{12}\\.woff2$',
      '^/fonts/Inter-SemiBold\\.subset-[a-f0-9]{12}\\.woff2$',
      '^/fonts/Inter-Bold\\.subset-[a-f0-9]{12}\\.woff2$',
    ]),
    forbidden: Object.freeze(['/examples/fragments/', '^/fonts/Inter-.*\\.ttf$']),
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
