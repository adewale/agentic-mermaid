/** Shared physical route inputs, independent of a placement implementation. */
export interface MeasuredRouteGraph {
  readonly edges: readonly { readonly source: number; readonly target: number }[]
  readonly maximumEdgeStrokeWidth?: number
  readonly maximumEdgeBendRadius?: number
}

/** Charged physical geometry work retained by shared visibility helpers. */
export interface ChannelWork {
  pairs: number
  arcs: number
  swaps: number
}
