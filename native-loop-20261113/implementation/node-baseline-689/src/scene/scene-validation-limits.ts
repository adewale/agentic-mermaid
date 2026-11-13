// Shared fixed limits, independent of admission, validation and serialization.
export const SCENE_VALIDATION_LIMITS = Object.freeze({
  maxExtent: 1_000_000,
  maxNodes: 100_000,
  maxDepth: 64,
  maxTextLength: 1_000_000,
  maxTextBytes: 2_000_000,
  maxPoints: 50_000,
  maxSerializationBytesPerNode: 5_000_000,
  maxAggregateSerializationBytes: 16_000_000,
  maxFinalSvgBytes: 8_000_000,
} as const)
