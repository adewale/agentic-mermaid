/** Shared physical route inputs, independent of a placement implementation. */
export interface MeasuredRouteGraph {
  readonly edges: readonly { readonly source: number; readonly target: number }[]
  readonly maximumEdgeStrokeWidth?: number
  readonly maximumEdgeBendRadius?: number
}
