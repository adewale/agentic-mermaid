import type { Direction, Point } from '../types.ts'
import type { MarkerPaint } from './compound-marker-seating.ts'

/** Backend-neutral measured constraints. No solver implementation is loaded here. */
export interface MeasuredGraph {
  /** Ordered partitions are local to a sibling scope; omitted values use zero. */
  nodes: readonly { id: string; width: number; height: number; paintStrokeWidth?: number; paintCornerRadius?: number; /** Producer-reserved primary port pitch; final paint proofs remain required. */ minimumPortSpacing?: number; parent?: number; partition?: number; modelOrder?: number }[]
  /** Edges may address a frame at nodes.length + its group index. */
  groups?: readonly {
    id: string; parent?: number; partition?: number; modelOrder?: number; direction?: Direction; minWidth: number
    /** Measured painted header strip, excluding blank content padding. */
    paintStrokeWidth?: number
    /** Actual canonical rounded-rectangle frame radius; absent means unknown. */
    paintCornerRadius?: number
    headerHeight?: number
    padding: { top: number; right: number; bottom: number; left: number }
  }[]
  /** Label dimensions include the occupied painted body. Its own shaft is
   * masked by that body; foreign routes must stay outside it. Loop expansion
   * reserves additional space beside the arc instead of masking its shaft. */
  edges: readonly { source: number; target: number; minSpan: number; sourcePortSpan?: number; targetPortSpan?: number; short?: true; boundaryMarker?: { inset: number; height: number }; markerPaint?: MarkerPaint; visible?: boolean; label?: { width: number; height: number } }[]
  direction: Direction
  padding: number
  nodeSpacing: number
  layerSpacing: number
  edgeSpacing?: number
  /** Actual endpoint artwork lead reserved independently of peer-obstacle clearance. */
  minimumTerminalLead?: number
  nodeClearance?: number
  /** Actual maximum painted edge stroke, supplied by the producer. Absence keeps legacy routing. */
  maximumEdgeStrokeWidth?: number
  maximumEdgeBendRadius?: number
  /** Adapter permits confluent routing only for compatible plain fans. */
  shareCompleteFans?: boolean
}

export interface MeasuredPlacement {
  width: number
  height: number
  /** Positions retain input order; measured body dimensions remain authoritative. */
  nodes: { x: number; y: number }[]
  groups?: { x: number; y: number; width: number; height: number }[]
}

export interface MeasuredRoutes extends MeasuredPlacement {
  /** One route per authored input edge, in the same order. */
  edges: { points: Point[]; labelPosition?: Point }[]
}

export type MeasuredLayoutRole = 'placement' | 'routed'
export interface MeasuredLayoutRequest<R extends MeasuredLayoutRole = MeasuredLayoutRole> {
  readonly role: R
  readonly graph: MeasuredGraph
}
export type MeasuredLayoutResult<R extends MeasuredLayoutRole = MeasuredLayoutRole> =
  R extends 'placement' ? { readonly kind: 'placed'; readonly geometry: MeasuredPlacement }
    : { readonly kind: 'routed'; readonly geometry: MeasuredRoutes }

/** Dependency loading, backend selection and typed declines belong to adapters. */
export interface MeasuredLayoutAdapter<R extends MeasuredLayoutRole> {
  solve(request: MeasuredLayoutRequest<R>): MeasuredLayoutResult<R>
}
