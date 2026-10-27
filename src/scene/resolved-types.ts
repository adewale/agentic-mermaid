import type { DiagramColors } from '../theme.ts'
import type { SceneNode, SceneRole } from './ir.ts'

/** Increment when a resolved field changes meaning or is removed. */
export const RESOLVED_SCENE_VERSION = 1 as const

export type Matrix = [a: number, b: number, c: number, d: number, e: number, f: number]

export interface ResolvedScene {
  version: typeof RESOLVED_SCENE_VERSION
  family: string
  width: number
  height: number
  /** Byte-identical to renderMermaidSVG with the same input and options. */
  svg: string
  colors: DiagramColors
  parts: ResolvedPart[]
  frame: ResolvedPrimitive[]
}

export interface ResolvedPart {
  id: string
  role: SceneRole
  kind: SceneNode['kind']
  node: SceneNode
  primitives: ResolvedPrimitive[]
}

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
