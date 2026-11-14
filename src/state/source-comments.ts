// The State comment and block-note reading the shared source normalizer
// applies to a stateDiagram source. The lazy browser build swaps this facade
// for source-comments.lazy.ts, so families other than State and the graph
// families do not download the State scanner with the render core.
export { scanStateComments } from './comment.ts'
