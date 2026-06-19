// Re-export of the production faithfulness counter (now src/agent/structural-count.ts).
// It was promoted out of eval/ when the CONTENT_DROPPED_ON_ROUNDTRIP verify lint
// began using it on every verify; eval harnesses import it from here for stability.
export {
  countStructuralElements, countsEqual, type StructuralCount,
} from '../../src/agent/structural-count.ts'
