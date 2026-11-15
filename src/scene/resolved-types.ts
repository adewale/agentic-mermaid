import type { DiagramColors } from '../theme.ts'
import type { SceneNode, SceneRole } from './ir.ts'

/** Increment when a resolved field changes meaning or is removed. */
export const RESOLVED_SCENE_VERSION = 2 as const

export type Matrix = [a: number, b: number, c: number, d: number, e: number, f: number]

export interface ResolvedScene {
  version: typeof RESOLVED_SCENE_VERSION
  /** Registered family of the input diagram, independent of shared Scene lowering. */
  family: string
  width: number
  height: number
  /** Byte-identical to renderMermaidSVG with the same input and options. */
  svg: string
  colors: DiagramColors
  /** Identified Scene parts paired with the artwork painted for each part. */
  parts: ResolvedPart[]
  /** Resolved primitives outside those parts, including style backdrops. */
  frame: ResolvedPrimitive[]
}

/** One Scene part and its backend-painted paths/text; not a source node. */
export interface ResolvedPart {
  /** Scene part ID; source-facing identity, when available, is node.identity. */
  id: string
  role: SceneRole
  kind: SceneNode['kind']
  node: SceneNode
  primitives: ResolvedPrimitive[]
}

/** A painted path or text run, distinct from pre-paint Scene geometry.
 * No independent stable ID. Entries in part.primitives are part-associated;
 * entries in scene.frame have no containing part. */
export type ResolvedPrimitive = ResolvedPath | ResolvedText

export interface ResolvedPaint {
  fill: string
  fillOpacity: number
  stroke: string
  strokeOpacity: number
  strokeWidth: number
  opacity: number
  lineCap: 'butt' | 'round' | 'square'
  lineJoin: 'miter' | 'round' | 'bevel' | 'arcs' | 'miter-clip'
  miterLimit: number
  fillRule: 'nonzero' | 'evenodd'
  paintOrder: string
  dashArray?: number[]
  dashOffset?: number
}

export interface ResolvedPath {
  kind: 'path'
  d: string
  matrix: Matrix
  paint: ResolvedPaint
  marker?: true
}

export interface ResolvedText {
  kind: 'text'
  text: string
  x: number
  y: number
  fontSize: number
  fontFamily: string[]
  fontWeight: number
  fontStyle: 'normal' | 'italic' | 'oblique'
  anchor: 'start' | 'middle' | 'end'
  baseline?: string
  textLength?: number
  lengthAdjust?: 'spacing' | 'spacingAndGlyphs'
  letterSpacing?: number
  matrix: Matrix
  paint: ResolvedPaint
}


/** Shared discovery for the existing runtime-neutral projection. */
export const RESOLVED_SCENE_CAPABILITY = Object.freeze({
  api: 'renderResolvedScene', version: RESOLVED_SCENE_VERSION,
  synchronous: true, runtime: 'runtime-neutral', coordinates: 'primitive-local', matrix: 'local-to-root-user-space',
  geometry: 'backend-painted', unsupportedArtwork: 'refused-atomically',
  discovery: Object.freeze({ tool: 'describe_sdk', arguments: Object.freeze({ capability: 'resolved-scene' }) }),
} as const)
