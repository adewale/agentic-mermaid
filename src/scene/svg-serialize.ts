import type { Geometry } from './ir.ts'

/** Geometry serialized as one SVG primitive; compound owners lower their pieces. */
export type SerializableShapeGeometry = Exclude<Geometry, { kind: 'compound' }>
